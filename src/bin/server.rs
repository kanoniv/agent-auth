//! Delegation Service - lightweight Axum + SQLite server.
//!
//! `kanoniv-auth serve` runs this. Issues real cryptographic delegation
//! tokens, verifies chains, manages revocation. Built-in /dashboard.
//!
//! Flow:
//!   POST /delegate -> issues base64 token (same format as CLI)
//!   POST /verify   -> verifies token chain + checks revocation
//!   POST /revoke   -> revokes by delegation ID, kills all downstream tokens
//!   GET  /delegations -> list active/revoked delegations
//!   GET  /dashboard   -> HTML dashboard
//!
//! Free tier: local SQLite. Paid tier: Kanoniv Cloud (Postgres, webhooks).

use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

use kanoniv_agent_auth::{AgentKeyPair, Caveat, Delegation};

// --- Types ---

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<rusqlite::Connection>>,
    root_keypair: Arc<AgentKeyPair>,
    root_did: String,
    api_key: Option<String>,
}

#[derive(Deserialize)]
pub struct DelegateRequest {
    scopes: Vec<String>,
    ttl_seconds: Option<i64>,
}

#[derive(Deserialize)]
pub struct VerifyTokenRequest {
    token: String,
    scope: String,
}

#[derive(Deserialize)]
pub struct RevokeRequest {
    delegation_id: String,
}

#[derive(Serialize, Clone)]
pub struct DelegationRecord {
    id: String,
    agent_did: String,
    root_did: String,
    scopes: Vec<String>,
    token: String,
    created_at: String,
    expires_at: Option<String>,
    revoked: bool,
}

#[derive(Serialize)]
pub struct ApiResponse<T: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn success(data: T) -> Json<Self> {
        Json(Self {
            ok: true,
            data: Some(data),
            error: None,
        })
    }
}

fn check_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Option<(StatusCode, Json<ApiResponse<()>>)> {
    if let Some(ref expected) = state.api_key {
        let provided = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        match provided {
            // Constant-time comparison to prevent timing attacks on the API key
            Some(key)
                if key.len() == expected.len()
                    && key
                        .bytes()
                        .zip(expected.bytes())
                        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                        == 0 =>
            {
                None
            }
            _ => Some((
                StatusCode::UNAUTHORIZED,
                Json(ApiResponse {
                    ok: false,
                    data: None,
                    error: Some("Unauthorized. Set Authorization: Bearer <api-key>".to_string()),
                }),
            )),
        }
    } else {
        None // No API key configured, allow all
    }
}

fn error_response(msg: &str) -> (StatusCode, Json<ApiResponse<()>>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ApiResponse {
            ok: false,
            data: None,
            error: Some(msg.to_string()),
        }),
    )
}

// --- Token helpers (same format as CLI) ---

fn encode_token(data: &serde_json::Value) -> String {
    let raw = serde_json::to_string(data).unwrap();
    URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

fn decode_token(token: &str) -> Result<serde_json::Value, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(token.trim())
        .map_err(|e| format!("Invalid token encoding: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid token JSON: {e}"))
}

// --- Database ---

fn init_db(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS delegations (
            id TEXT PRIMARY KEY,
            agent_did TEXT NOT NULL,
            root_did TEXT NOT NULL,
            scopes TEXT NOT NULL,
            token TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            delegation_id TEXT,
            agent_did TEXT,
            scope TEXT,
            details TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_did);
        CREATE INDEX IF NOT EXISTS idx_delegations_revoked ON delegations(revoked);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);",
    )
}

fn log_audit(
    conn: &rusqlite::Connection,
    action: &str,
    delegation_id: Option<&str>,
    agent_did: Option<&str>,
    scope: Option<&str>,
    details: &str,
) {
    let _ = conn.execute(
        "INSERT INTO audit_log (timestamp, action, delegation_id, agent_did, scope, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            chrono::Utc::now().to_rfc3339(),
            action,
            delegation_id,
            agent_did,
            scope,
            details,
        ],
    );
}

// --- Handlers ---

async fn handle_delegate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<DelegateRequest>,
) -> impl IntoResponse {
    if let Some(err) = check_auth(&state, &headers) {
        return err.into_response();
    }
    if req.scopes.is_empty() {
        return error_response("scopes cannot be empty").into_response();
    }

    // Generate agent keypair
    let agent_keys = AgentKeyPair::generate();
    let agent_did = agent_keys.identity().did.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    // Build caveats
    let mut caveats = vec![Caveat::ActionScope(req.scopes.clone())];
    let expires_at = req.ttl_seconds.map(|secs| {
        let exp = now + chrono::Duration::seconds(secs);
        caveats.push(Caveat::ExpiresAt(
            exp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ));
        exp.to_rfc3339()
    });

    // Create real cryptographic delegation
    let delegation = match Delegation::create_root(&state.root_keypair, &agent_did, caveats) {
        Ok(d) => d,
        Err(e) => return error_response(&format!("delegation failed: {e}")).into_response(),
    };

    // Build self-contained token (same format as CLI)
    let mut token_data = serde_json::json!({
        "version": 1,
        "delegation_id": id,
        "chain": [delegation],
        "agent_did": agent_did,
        "scopes": req.scopes,
        "agent_private_key": URL_SAFE_NO_PAD.encode(agent_keys.secret_bytes()),
    });
    if let Some(secs) = req.ttl_seconds {
        token_data["expires_at"] = serde_json::Value::from(now.timestamp() as f64 + secs as f64);
    }

    let token = encode_token(&token_data);
    let scopes_json = serde_json::to_string(&req.scopes).unwrap_or_default();

    // Store in DB for lifecycle management
    let db = match state.db.lock() {
        Ok(db) => db,
        Err(e) => return error_response(&format!("internal error: {e}")).into_response(),
    };
    if let Err(e) = db.execute(
        "INSERT INTO delegations (id, agent_did, root_did, scopes, token, created_at, expires_at, revoked) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        rusqlite::params![id, agent_did, state.root_did, scopes_json, token, now.to_rfc3339(), expires_at],
    ) {
        return error_response(&format!("failed to store delegation: {e}")).into_response();
    }
    log_audit(
        &db,
        "delegate",
        Some(&id),
        Some(&agent_did),
        None,
        &format!("scopes={scopes_json}"),
    );

    #[derive(Serialize)]
    struct DelegateResult {
        delegation_id: String,
        agent_did: String,
        scopes: Vec<String>,
        token: String,
        expires_at: Option<String>,
    }

    ApiResponse::success(DelegateResult {
        delegation_id: id,
        agent_did,
        scopes: req.scopes,
        token,
        expires_at,
    })
    .into_response()
}

async fn handle_verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyTokenRequest>,
) -> impl IntoResponse {
    // Decode the token
    let data = match decode_token(&req.token) {
        Ok(d) => d,
        Err(e) => return error_response(&format!("invalid token: {e}")).into_response(),
    };

    let token_scopes: Vec<String> = data["scopes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let agent_did = data["agent_did"].as_str().unwrap_or("unknown").to_string();

    // Check revocation via delegation_id in DB
    if let Some(delegation_id) = data["delegation_id"].as_str() {
        let db = match state.db.lock() {
            Ok(db) => db,
            Err(e) => return error_response(&format!("internal error: {e}")).into_response(),
        };
        let revoked = db
            .query_row(
                "SELECT revoked FROM delegations WHERE id = ?1",
                [delegation_id],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false);

        if revoked {
            log_audit(
                &db,
                "verify",
                Some(delegation_id),
                Some(&agent_did),
                Some(&req.scope),
                "result=denied_revoked",
            );
            return error_response("DENIED: delegation has been revoked").into_response();
        }
    }

    // Check expiry
    if let Some(expires) = data["expires_at"].as_f64() {
        let now = chrono::Utc::now().timestamp() as f64;
        if now > expires {
            let ago = now - expires;
            let ago_str = if ago < 60.0 {
                format!("{:.0}s", ago)
            } else if ago < 3600.0 {
                format!("{:.0}m", ago / 60.0)
            } else {
                format!("{:.1}h", ago / 3600.0)
            };
            return error_response(&format!("EXPIRED: token expired {ago_str} ago"))
                .into_response();
        }
    }

    // Check scope
    if !token_scopes.contains(&req.scope) {
        return error_response(&format!(
            "DENIED: scope \"{}\" not in delegation. You have: {:?}",
            req.scope, token_scopes
        ))
        .into_response();
    }

    // Verify chain signatures cryptographically
    let chain = data["chain"].as_array();
    if chain.is_none() || chain.unwrap().is_empty() {
        return error_response("token has no delegation chain").into_response();
    }
    let chain_links = chain.unwrap();

    // Check root DID matches
    let chain_root = chain_links
        .first()
        .and_then(|l| l["issuer_did"].as_str())
        .unwrap_or("");
    if chain_root != state.root_did {
        return error_response(&format!(
            "DENIED: token was issued by {}, not by this service ({})",
            chain_root, state.root_did
        ))
        .into_response();
    }

    // Verify each chain link's Ed25519 signature using embedded public keys
    for (i, link) in chain_links.iter().enumerate() {
        // Deserialize the delegation link
        let delegation: kanoniv_agent_auth::Delegation = match serde_json::from_value(link.clone())
        {
            Ok(d) => d,
            Err(e) => {
                return error_response(&format!("invalid chain link {i}: {e}")).into_response()
            }
        };

        // Reconstruct issuer identity from embedded public key
        let issuer_identity =
            match kanoniv_agent_auth::AgentIdentity::from_bytes(&delegation.issuer_public_key) {
                Ok(id) => id,
                Err(_) => {
                    return error_response(&format!(
                        "chain link {i}: invalid embedded public key for '{}'",
                        delegation.issuer_did
                    ))
                    .into_response()
                }
            };

        // Verify the embedded public key matches the claimed DID
        if issuer_identity.did != delegation.issuer_did {
            return error_response(&format!(
                "chain link {i}: public key produces DID '{}' but claims '{}'",
                issuer_identity.did, delegation.issuer_did
            ))
            .into_response();
        }

        // Verify the Ed25519 signature
        if let Err(e) = delegation.proof.verify(&issuer_identity) {
            return error_response(&format!(
                "chain link {i}: signature verification failed: {e}"
            ))
            .into_response();
        }

        // Verify chain linkage: each link's issuer must be the previous link's delegate
        if i > 0 {
            let prev_delegate = chain_links[i - 1]
                .get("delegate_did")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if delegation.issuer_did != prev_delegate {
                return error_response(&format!(
                    "chain link {i}: issuer '{}' is not the delegate of link {}",
                    delegation.issuer_did,
                    i - 1
                ))
                .into_response();
            }
        }
    }

    let ttl_remaining = data["expires_at"]
        .as_f64()
        .map(|e| e - chrono::Utc::now().timestamp() as f64);

    // Log successful verification
    if let Some(delegation_id) = data["delegation_id"].as_str() {
        let db = state.db.lock().unwrap_or_else(|e| e.into_inner());
        log_audit(
            &db,
            "verify",
            Some(delegation_id),
            Some(&agent_did),
            Some(&req.scope),
            "result=ok",
        );
    }

    #[derive(Serialize)]
    struct VerifyResult {
        valid: bool,
        agent_did: String,
        root_did: String,
        scopes: Vec<String>,
        chain_depth: usize,
        ttl_remaining: Option<f64>,
    }

    ApiResponse::success(VerifyResult {
        valid: true,
        agent_did,
        root_did: state.root_did.clone(),
        scopes: token_scopes,
        chain_depth: chain_links.len(),
        ttl_remaining,
    })
    .into_response()
}

async fn handle_revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RevokeRequest>,
) -> impl IntoResponse {
    if let Some(err) = check_auth(&state, &headers) {
        return err.into_response();
    }
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());

    // Get agent_did before revoking (for audit)
    let agent_did: String = db
        .query_row(
            "SELECT agent_did FROM delegations WHERE id = ?1",
            [&req.delegation_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "unknown".to_string());

    let updated = db
        .execute(
            "UPDATE delegations SET revoked = 1 WHERE id = ?1 AND revoked = 0",
            [&req.delegation_id],
        )
        .unwrap_or(0);

    if updated == 0 {
        return error_response("delegation not found or already revoked").into_response();
    }

    log_audit(
        &db,
        "revoke",
        Some(&req.delegation_id),
        Some(&agent_did),
        None,
        "revoked by operator",
    );

    #[derive(Serialize)]
    struct RevokeResult {
        revoked: bool,
        delegation_id: String,
        agent_did: String,
    }

    ApiResponse::success(RevokeResult {
        revoked: true,
        delegation_id: req.delegation_id,
        agent_did,
    })
    .into_response()
}

#[derive(Deserialize, Default)]
pub struct ListQuery {
    agent_did: Option<String>,
    active_only: Option<bool>,
}

async fn handle_list(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());

    let mut sql = "SELECT id, agent_did, root_did, scopes, token, created_at, expires_at, revoked FROM delegations WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    if let Some(ref did) = query.agent_did {
        sql.push_str(" AND agent_did = ?");
        params.push(Box::new(did.clone()));
    }
    if query.active_only.unwrap_or(false) {
        sql.push_str(" AND revoked = 0");
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT 100");

    let mut stmt = match db.prepare(&sql) {
        Ok(s) => s,
        Err(e) => return error_response(&format!("query error: {e}")).into_response(),
    };
    let records: Vec<DelegationRecord> = stmt
        .query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| {
                let scopes_json: String = row.get(3)?;
                let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();
                Ok(DelegationRecord {
                    id: row.get(0)?,
                    agent_did: row.get(1)?,
                    root_did: row.get(2)?,
                    scopes,
                    token: row.get(4)?,
                    created_at: row.get(5)?,
                    expires_at: row.get(6)?,
                    revoked: row.get(7)?,
                })
            },
        )
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    ApiResponse::success(records).into_response()
}

async fn handle_health() -> impl IntoResponse {
    Json(serde_json::json!({"status": "ok", "service": "kanoniv-auth"}))
}

async fn handle_metrics(State(state): State<AppState>) -> impl IntoResponse {
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());

    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM delegations", [], |row| row.get(0))
        .unwrap_or(0);
    let active: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM delegations WHERE revoked = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let verifications: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'verify'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let body = format!(
        "# HELP delegations_total Total delegations created\n\
         # TYPE delegations_total counter\n\
         delegations_total {total}\n\
         # HELP delegations_active Currently active delegations\n\
         # TYPE delegations_active gauge\n\
         delegations_active {active}\n\
         # HELP delegations_revoked Total revoked delegations\n\
         # TYPE delegations_revoked counter\n\
         delegations_revoked {}\n\
         # HELP verifications_total Total verification checks\n\
         # TYPE verifications_total counter\n\
         verifications_total {verifications}\n",
        total - active,
    );

    (
        StatusCode::OK,
        [("content-type", "text/plain; version=0.0.4")],
        body,
    )
}

async fn handle_dashboard(State(state): State<AppState>) -> Html<String> {
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());

    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM delegations", [], |row| row.get(0))
        .unwrap_or(0);
    let active: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM delegations WHERE revoked = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let verifications: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'verify'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let mut stmt = db
        .prepare("SELECT id, agent_did, scopes, created_at, expires_at, revoked FROM delegations ORDER BY created_at DESC LIMIT 20")
        .unwrap();
    let rows: Vec<(String, String, String, String, Option<String>, bool)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut table_rows = String::new();
    for (id, did, scopes, _created, expires, revoked) in &rows {
        let status = if *revoked {
            "<span style='color:#e74c3c'>revoked</span>"
        } else {
            "<span style='color:#2ecc71'>active</span>"
        };
        let did_short = if did.len() > 24 {
            format!("{}...", &did[..21])
        } else {
            did.clone()
        };
        let id_short = if id.len() > 8 { &id[..8] } else { id };
        let scopes_parsed: Vec<String> = serde_json::from_str(scopes).unwrap_or_default();
        let scopes_display = scopes_parsed.join(", ");
        table_rows.push_str(&format!(
            "<tr><td><code>{id_short}</code></td><td><code>{did_short}</code></td><td>{scopes_display}</td><td>{}</td><td>{status}</td></tr>\n",
            expires.as_deref().unwrap_or("never"),
        ));
    }

    // Recent audit log
    let mut audit_stmt = db
        .prepare("SELECT timestamp, action, agent_did, scope, details FROM audit_log ORDER BY id DESC LIMIT 10")
        .unwrap();
    #[allow(clippy::type_complexity)]
    let audit_rows: Vec<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = audit_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut audit_table = String::new();
    for (ts, action, agent, scope, _details) in &audit_rows {
        let action_color = match action.as_str() {
            "delegate" => "#3fb950",
            "verify" => "#58a6ff",
            "revoke" => "#e74c3c",
            _ => "#8b949e",
        };
        let agent_short = agent
            .as_deref()
            .map(|d| {
                if d.len() > 20 {
                    format!("{}...", &d[..17])
                } else {
                    d.to_string()
                }
            })
            .unwrap_or_default();
        let ts_short = &ts[11..19]; // HH:MM:SS
        audit_table.push_str(&format!(
            "<tr><td>{ts_short}</td><td style='color:{action_color}'>{action}</td><td><code>{agent_short}</code></td><td>{}</td></tr>\n",
            scope.as_deref().unwrap_or(""),
        ));
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html><head>
<title>kanoniv-auth dashboard</title>
<meta http-equiv="refresh" content="5">
<style>
  body {{ font-family: -apple-system, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; background: #0d1117; color: #c9d1d9; }}
  h1 {{ color: #f0c674; margin-bottom: 4px; }}
  h2 {{ color: #c9d1d9; margin-top: 32px; }}
  .subtitle {{ color: #8b949e; margin-bottom: 24px; }}
  .stats {{ display: flex; gap: 16px; margin: 20px 0; }}
  .stat {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 24px; min-width: 120px; }}
  .stat-value {{ font-size: 2em; font-weight: bold; color: #f0c674; }}
  .stat-label {{ color: #8b949e; font-size: 0.85em; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; }}
  th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; }}
  th {{ color: #8b949e; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; }}
  code {{ background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }}
  .footer {{ color: #484f58; margin-top: 40px; font-size: 0.85em; }}
  a {{ color: #58a6ff; text-decoration: none; }}
  .two-col {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
  @media (max-width: 768px) {{ .two-col {{ grid-template-columns: 1fr; }} }}
</style>
</head><body>
<h1>kanoniv-auth</h1>
<p class="subtitle">Delegation service dashboard. Sudo for AI agents.</p>

<div class="stats">
  <div class="stat"><div class="stat-value">{total}</div><div class="stat-label">Delegations</div></div>
  <div class="stat"><div class="stat-value">{active}</div><div class="stat-label">Active</div></div>
  <div class="stat"><div class="stat-value">{}</div><div class="stat-label">Revoked</div></div>
  <div class="stat"><div class="stat-value">{verifications}</div><div class="stat-label">Verifications</div></div>
</div>

<div class="two-col">
<div>
<h2>Delegations</h2>
<table>
  <thead><tr><th>ID</th><th>Agent</th><th>Scopes</th><th>Expires</th><th>Status</th></tr></thead>
  <tbody>{table_rows}</tbody>
</table>
</div>

<div>
<h2>Audit Log</h2>
<table>
  <thead><tr><th>Time</th><th>Action</th><th>Agent</th><th>Scope</th></tr></thead>
  <tbody>{audit_table}</tbody>
</table>
</div>
</div>

<div class="footer">
  Root: <code>{root_did}</code> | <a href="/health">/health</a> | <a href="/metrics">/metrics</a> | Auto-refreshes every 5s
</div>
</body></html>"#,
        total - active,
        root_did = state.root_did,
    );

    Html(html)
}

// --- Server startup ---

pub async fn run_server(
    port: u16,
    db_path: &str,
    root_key_path: &str,
    api_key: Option<String>,
) -> Result<(), String> {
    let data: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root_key_path)
            .map_err(|e| format!("Failed to read root key: {e}"))?,
    )
    .map_err(|e| format!("Invalid key file: {e}"))?;

    let priv_hex = data["private_key"]
        .as_str()
        .ok_or("Key file missing private_key")?;
    let bytes = hex::decode(priv_hex).map_err(|e| format!("Invalid key hex: {e}"))?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Key must be 32 bytes".to_string())?;
    let keypair = AgentKeyPair::from_bytes(&arr);
    let root_did = keypair.identity().did.clone();

    let conn =
        rusqlite::Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("Failed to set pragmas: {e}"))?;
    init_db(&conn).map_err(|e| format!("Failed to init database: {e}"))?;

    let auth_status = if api_key.is_some() {
        "enabled"
    } else {
        "disabled (use --api-key to secure)"
    };

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        root_keypair: Arc::new(keypair),
        root_did: root_did.clone(),
        api_key,
    };

    let app = Router::new()
        .route("/delegate", post(handle_delegate))
        .route("/verify", post(handle_verify))
        .route("/revoke", post(handle_revoke))
        .route("/delegations", get(handle_list))
        .route("/health", get(handle_health))
        .route("/metrics", get(handle_metrics))
        .route("/dashboard", get(handle_dashboard))
        .route("/", get(handle_dashboard))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    eprintln!("kanoniv-auth delegation service");
    eprintln!("  Listening: http://localhost:{port}");
    eprintln!("  Dashboard: http://localhost:{port}/dashboard");
    eprintln!("  Root DID:  {root_did}");
    eprintln!("  Database:  {db_path}");
    eprintln!("  Auth:      {auth_status}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind {addr}: {e}"))?;
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {e}"))?;

    Ok(())
}

#[cfg(test)]
#[cfg(feature = "server")]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    /// Build an AppState with an in-memory SQLite DB and a freshly generated root keypair.
    /// Returns (AppState, root_keypair_clone) so tests can reference the root DID.
    fn test_state(api_key: Option<String>) -> AppState {
        let conn = rusqlite::Connection::open_in_memory().expect("open in-memory db");
        init_db(&conn).expect("init db");
        let root_keypair = AgentKeyPair::generate();
        let root_did = root_keypair.identity().did.clone();
        AppState {
            db: Arc::new(Mutex::new(conn)),
            root_keypair: Arc::new(root_keypair),
            root_did,
            api_key,
        }
    }

    /// Build the same router that run_server() uses.
    fn test_router(state: AppState) -> Router {
        Router::new()
            .route("/delegate", post(handle_delegate))
            .route("/verify", post(handle_verify))
            .route("/revoke", post(handle_revoke))
            .route("/delegations", get(handle_list))
            .route("/health", get(handle_health))
            .route("/metrics", get(handle_metrics))
            .route("/dashboard", get(handle_dashboard))
            .route("/", get(handle_dashboard))
            .layer(CorsLayer::permissive())
            .with_state(state)
    }

    /// Helper: send a POST request with a JSON body and return (status, parsed JSON).
    async fn post_json(
        app: &mut Router,
        path: &str,
        body: serde_json::Value,
        bearer: Option<&str>,
    ) -> (StatusCode, serde_json::Value) {
        let mut builder = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json");
        if let Some(token) = bearer {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let req = builder
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        (status, json)
    }

    /// Helper: send a GET request and return (status, raw body bytes).
    async fn get_raw(app: &mut Router, path: &str) -> (StatusCode, Vec<u8>) {
        let req = Request::builder()
            .method("GET")
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        (status, bytes.to_vec())
    }

    /// Helper: delegate with given scopes and optional TTL. Returns the full JSON response data.
    async fn delegate_scopes(
        app: &mut Router,
        scopes: Vec<&str>,
        ttl_seconds: Option<i64>,
    ) -> serde_json::Value {
        let mut body = serde_json::json!({
            "scopes": scopes,
        });
        if let Some(ttl) = ttl_seconds {
            body["ttl_seconds"] = serde_json::json!(ttl);
        }
        let (status, json) = post_json(app, "/delegate", body, None).await;
        assert_eq!(status, StatusCode::OK, "delegate failed: {json}");
        assert!(json["ok"].as_bool().unwrap(), "delegate not ok: {json}");
        json
    }

    // 1. POST /delegate with valid scopes returns token
    #[tokio::test]
    async fn test_delegate_creates_token() {
        let state = test_state(None);
        let mut app = test_router(state.clone());

        let json = delegate_scopes(&mut app, vec!["deploy", "build"], None).await;
        let data = &json["data"];

        assert!(data["delegation_id"].as_str().is_some());
        assert!(data["agent_did"]
            .as_str()
            .unwrap()
            .starts_with("did:agent:"));
        assert_eq!(data["scopes"][0].as_str().unwrap(), "deploy");
        assert_eq!(data["scopes"][1].as_str().unwrap(), "build");
        assert!(data["token"].as_str().is_some());
        assert!(!data["token"].as_str().unwrap().is_empty());
    }

    // 2. POST /delegate with empty scopes returns error
    #[tokio::test]
    async fn test_delegate_empty_scopes_fails() {
        let state = test_state(None);
        let mut app = test_router(state);

        let body = serde_json::json!({"scopes": []});
        let (status, json) = post_json(&mut app, "/delegate", body, None).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"]
            .as_str()
            .unwrap()
            .contains("scopes cannot be empty"));
    }

    // 3. Delegate then verify succeeds
    #[tokio::test]
    async fn test_verify_valid_token() {
        let state = test_state(None);
        let mut app = test_router(state);

        let del = delegate_scopes(&mut app, vec!["deploy"], None).await;
        let token = del["data"]["token"].as_str().unwrap();

        let verify_body = serde_json::json!({
            "token": token,
            "scope": "deploy",
        });
        let (status, json) = post_json(&mut app, "/verify", verify_body, None).await;

        assert_eq!(status, StatusCode::OK);
        assert!(json["ok"].as_bool().unwrap());
        assert!(json["data"]["valid"].as_bool().unwrap());
        assert_eq!(json["data"]["chain_depth"].as_u64().unwrap(), 1);
    }

    // 4. Delegate with scope A, verify with scope B fails
    #[tokio::test]
    async fn test_verify_wrong_scope_denied() {
        let state = test_state(None);
        let mut app = test_router(state);

        let del = delegate_scopes(&mut app, vec!["deploy"], None).await;
        let token = del["data"]["token"].as_str().unwrap();

        let verify_body = serde_json::json!({
            "token": token,
            "scope": "admin",
        });
        let (status, json) = post_json(&mut app, "/verify", verify_body, None).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"].as_str().unwrap().contains("DENIED"));
        assert!(json["error"].as_str().unwrap().contains("admin"));
    }

    // 5. Delegate with 1-second TTL, wait, verify fails
    #[tokio::test]
    async fn test_verify_expired_token() {
        let state = test_state(None);
        let mut app = test_router(state);

        let del = delegate_scopes(&mut app, vec!["deploy"], Some(1)).await;
        let token = del["data"]["token"].as_str().unwrap().to_string();

        // Wait for the token to expire
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let verify_body = serde_json::json!({
            "token": token,
            "scope": "deploy",
        });
        let (status, json) = post_json(&mut app, "/verify", verify_body, None).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"].as_str().unwrap().contains("EXPIRED"));
    }

    // 6. Construct a token with fake chain, verify rejects
    #[tokio::test]
    async fn test_verify_forged_chain_rejected() {
        let state = test_state(None);
        let mut app = test_router(state.clone());

        // Create a legitimate delegation to get the token format right
        let del = delegate_scopes(&mut app, vec!["deploy"], None).await;
        let original_token = del["data"]["token"].as_str().unwrap();

        // Decode the token, tamper with the chain by replacing the issuer with a different key
        let token_data = decode_token(original_token).unwrap();

        // Generate a completely different keypair (attacker)
        let attacker_keys = AgentKeyPair::generate();
        let attacker_did = attacker_keys.identity().did.clone();

        // Build a forged chain link that claims to be from the root but signed by the attacker
        let forged_delegation = Delegation::create_root(
            &attacker_keys,
            &token_data["agent_did"].as_str().unwrap(),
            vec![Caveat::ActionScope(vec!["deploy".into()])],
        )
        .unwrap();

        // Replace the chain with the forged one but keep the rest of the token intact
        let mut forged_token_data = token_data.clone();
        forged_token_data["chain"] = serde_json::json!([forged_delegation]);

        let forged_b64 = encode_token(&forged_token_data);

        let verify_body = serde_json::json!({
            "token": forged_b64,
            "scope": "deploy",
        });
        let (status, json) = post_json(&mut app, "/verify", verify_body, None).await;

        // Should be rejected - the forged chain's root DID does not match the server's root DID
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json["ok"].as_bool().unwrap());
        let error = json["error"].as_str().unwrap();
        // Either "DENIED: token was issued by" (wrong root DID) or signature failure
        assert!(
            error.contains("DENIED") || error.contains("signature"),
            "unexpected error message: {error}"
        );
        // The attacker's DID should NOT match the server root
        assert_ne!(attacker_did, state.root_did);
    }

    // 7. Delegate, revoke, then verify fails
    #[tokio::test]
    async fn test_revoke_then_verify_denied() {
        let state = test_state(None);
        let mut app = test_router(state);

        let del = delegate_scopes(&mut app, vec!["deploy"], None).await;
        let token = del["data"]["token"].as_str().unwrap().to_string();
        let delegation_id = del["data"]["delegation_id"].as_str().unwrap().to_string();

        // Revoke
        let revoke_body = serde_json::json!({"delegation_id": delegation_id});
        let (status, json) = post_json(&mut app, "/revoke", revoke_body, None).await;
        assert_eq!(status, StatusCode::OK);
        assert!(json["ok"].as_bool().unwrap());
        assert!(json["data"]["revoked"].as_bool().unwrap());

        // Verify should now fail
        let verify_body = serde_json::json!({
            "token": token,
            "scope": "deploy",
        });
        let (status, json) = post_json(&mut app, "/verify", verify_body, None).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"].as_str().unwrap().contains("revoked"));
    }

    // 8. GET /health returns ok
    #[tokio::test]
    async fn test_health_endpoint() {
        let state = test_state(None);
        let mut app = test_router(state);

        let (status, body) = get_raw(&mut app, "/health").await;
        assert_eq!(status, StatusCode::OK);

        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"].as_str().unwrap(), "ok");
        assert_eq!(json["service"].as_str().unwrap(), "kanoniv-auth");
    }

    // 9. GET /metrics returns Prometheus format
    #[tokio::test]
    async fn test_metrics_endpoint() {
        let state = test_state(None);
        let mut app = test_router(state);

        // Create a delegation first so metrics have something to report
        delegate_scopes(&mut app, vec!["test"], None).await;

        let (status, body) = get_raw(&mut app, "/metrics").await;
        assert_eq!(status, StatusCode::OK);

        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("delegations_total"));
        assert!(text.contains("delegations_active"));
        assert!(text.contains("delegations_revoked"));
        assert!(text.contains("verifications_total"));
        // Should show at least 1 delegation
        assert!(text.contains("delegations_total 1"));
    }

    // 10. If api_key set, delegate without Bearer fails
    #[tokio::test]
    async fn test_auth_required_for_delegate() {
        let state = test_state(Some("secret-key-123".to_string()));
        let mut app = test_router(state);

        // No auth header
        let body = serde_json::json!({"scopes": ["deploy"]});
        let (status, json) = post_json(&mut app, "/delegate", body.clone(), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"].as_str().unwrap().contains("Unauthorized"));

        // Wrong key
        let (status, json) =
            post_json(&mut app, "/delegate", body.clone(), Some("wrong-key")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!json["ok"].as_bool().unwrap());

        // Correct key
        let (status, json) = post_json(&mut app, "/delegate", body, Some("secret-key-123")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(json["ok"].as_bool().unwrap());
    }

    // 11. If api_key set, revoke without Bearer fails
    #[tokio::test]
    async fn test_auth_required_for_revoke() {
        let state = test_state(Some("my-api-key".to_string()));
        let mut app = test_router(state);

        // First, create a delegation with proper auth
        let del_body = serde_json::json!({"scopes": ["deploy"]});
        let (_, del_json) = post_json(&mut app, "/delegate", del_body, Some("my-api-key")).await;
        let delegation_id = del_json["data"]["delegation_id"]
            .as_str()
            .unwrap()
            .to_string();

        // Revoke without auth - should fail
        let revoke_body = serde_json::json!({"delegation_id": delegation_id});
        let (status, json) = post_json(&mut app, "/revoke", revoke_body.clone(), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!json["ok"].as_bool().unwrap());
        assert!(json["error"].as_str().unwrap().contains("Unauthorized"));

        // Revoke with correct auth - should succeed
        let (status, json) = post_json(&mut app, "/revoke", revoke_body, Some("my-api-key")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(json["ok"].as_bool().unwrap());
        assert!(json["data"]["revoked"].as_bool().unwrap());
    }
}
