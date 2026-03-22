//! Delegation Service - lightweight Axum + SQLite server.
//!
//! `kanoniv-auth serve` runs this. Manages delegation token lifecycle:
//! create, verify, revoke, list. Built-in /dashboard HTML page.
//!
//! Free tier: local SQLite. Paid tier: Kanoniv Cloud (Postgres, webhooks).

use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

use kanoniv_agent_auth::{AgentIdentity, AgentKeyPair, Caveat};

// --- Types ---

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<rusqlite::Connection>>,
    root_identity: AgentIdentity,
}

#[derive(Deserialize)]
pub struct DelegateRequest {
    scopes: Vec<String>,
    ttl_seconds: Option<i64>,
    agent_did: Option<String>,
}

#[derive(Deserialize)]
pub struct VerifyRequest {
    token_id: String,
    scope: String,
}

#[derive(Deserialize)]
pub struct RevokeRequest {
    token_id: String,
}

#[derive(Serialize)]
pub struct DelegationRecord {
    id: String,
    agent_did: String,
    scopes: Vec<String>,
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

// --- Database ---

fn init_db(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS delegations (
            id TEXT PRIMARY KEY,
            agent_did TEXT NOT NULL,
            scopes TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0,
            delegation_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            delegation_id TEXT,
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
    details: &str,
) {
    let _ = conn.execute(
        "INSERT INTO audit_log (timestamp, action, delegation_id, details) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            chrono::Utc::now().to_rfc3339(),
            action,
            delegation_id,
            details,
        ],
    );
}

// --- Handlers ---

async fn handle_delegate(
    State(state): State<AppState>,
    Json(req): Json<DelegateRequest>,
) -> impl IntoResponse {
    if req.scopes.is_empty() {
        return error_response("scopes cannot be empty").into_response();
    }

    let agent_keys = AgentKeyPair::generate();
    let agent_did = req
        .agent_did
        .unwrap_or_else(|| agent_keys.identity().did.clone());
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    let mut caveats = vec![Caveat::ActionScope(req.scopes.clone())];
    let expires_at = req.ttl_seconds.map(|secs| {
        let exp = now + chrono::Duration::seconds(secs);
        caveats.push(Caveat::ExpiresAt(
            exp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ));
        exp.to_rfc3339()
    });

    let scopes_json = serde_json::to_string(&req.scopes).unwrap_or_default();

    let db = match state.db.lock() {
        Ok(db) => db,
        Err(e) => return error_response(&format!("internal error: {e}")).into_response(),
    };
    if let Err(e) = db.execute(
        "INSERT INTO delegations (id, agent_did, scopes, created_at, expires_at, revoked, delegation_json) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        rusqlite::params![
            id,
            agent_did,
            scopes_json,
            now.to_rfc3339(),
            expires_at,
            "{}",
        ],
    ) {
        return error_response(&format!("failed to create delegation: {e}")).into_response();
    }
    log_audit(&db, "delegate", Some(&id), &format!("scopes={scopes_json}"));

    let record = DelegationRecord {
        id: id.clone(),
        agent_did,
        scopes: req.scopes,
        created_at: now.to_rfc3339(),
        expires_at,
        revoked: false,
    };

    ApiResponse::success(record).into_response()
}

async fn handle_verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> impl IntoResponse {
    let db = match state.db.lock() {
        Ok(db) => db,
        Err(e) => return error_response(&format!("internal error: {e}")).into_response(),
    };
    let result = db.query_row(
        "SELECT agent_did, scopes, expires_at, revoked FROM delegations WHERE id = ?1",
        [&req.token_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, bool>(3)?,
            ))
        },
    );

    match result {
        Ok((agent_did, scopes_json, expires_at, revoked)) => {
            if revoked {
                return error_response("delegation has been revoked").into_response();
            }

            if let Some(ref exp_str) = expires_at {
                if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
                    if chrono::Utc::now() > exp {
                        return error_response("delegation has expired").into_response();
                    }
                }
            }

            let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();

            if !scopes.contains(&req.scope) {
                let msg = format!(
                    "DENIED: scope \"{}\" not in delegation. You have: {:?}",
                    req.scope, scopes
                );
                return error_response(&msg).into_response();
            }

            log_audit(
                &db,
                "verify",
                Some(&req.token_id),
                &format!("scope={} result=ok", req.scope),
            );

            #[derive(Serialize)]
            struct VerifyResult {
                valid: bool,
                agent_did: String,
                scopes: Vec<String>,
            }

            ApiResponse::success(VerifyResult {
                valid: true,
                agent_did,
                scopes,
            })
            .into_response()
        }
        Err(_) => error_response("delegation not found").into_response(),
    }
}

async fn handle_revoke(
    State(state): State<AppState>,
    Json(req): Json<RevokeRequest>,
) -> impl IntoResponse {
    let db = state.db.lock().unwrap_or_else(|e| e.into_inner());
    let updated = db
        .execute(
            "UPDATE delegations SET revoked = 1 WHERE id = ?1 AND revoked = 0",
            [&req.token_id],
        )
        .unwrap_or(0);

    if updated == 0 {
        return error_response("delegation not found or already revoked").into_response();
    }

    log_audit(&db, "revoke", Some(&req.token_id), "");

    #[derive(Serialize)]
    struct RevokeResult {
        revoked: bool,
        token_id: String,
    }

    ApiResponse::success(RevokeResult {
        revoked: true,
        token_id: req.token_id,
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

    let mut sql =
        "SELECT id, agent_did, scopes, created_at, expires_at, revoked FROM delegations WHERE 1=1"
            .to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];

    if let Some(ref did) = query.agent_did {
        sql.push_str(" AND agent_did = ?");
        params.push(Box::new(did.clone()));
    }
    if query.active_only.unwrap_or(false) {
        sql.push_str(" AND revoked = 0");
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT 100");

    let mut stmt = db.prepare(&sql).unwrap();
    let records: Vec<DelegationRecord> = stmt
        .query_map(
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| {
                let scopes_json: String = row.get(2)?;
                let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();
                Ok(DelegationRecord {
                    id: row.get(0)?,
                    agent_did: row.get(1)?,
                    scopes,
                    created_at: row.get(3)?,
                    expires_at: row.get(4)?,
                    revoked: row.get(5)?,
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
    let revoked: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM delegations WHERE revoked = 1",
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
         delegations_revoked {revoked}\n"
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
        table_rows.push_str(&format!(
            "<tr><td><code>{id_short}</code></td><td><code>{did_short}</code></td><td>{scopes}</td><td>{}</td><td>{status}</td></tr>\n",
            expires.as_deref().unwrap_or("never"),
        ));
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html><head>
<title>kanoniv-auth dashboard</title>
<style>
  body {{ font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; background: #0d1117; color: #c9d1d9; }}
  h1 {{ color: #f0c674; }}
  .stats {{ display: flex; gap: 20px; margin: 20px 0; }}
  .stat {{ background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 24px; }}
  .stat-value {{ font-size: 2em; font-weight: bold; color: #f0c674; }}
  .stat-label {{ color: #8b949e; font-size: 0.9em; }}
  table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
  th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #30363d; }}
  th {{ color: #8b949e; font-size: 0.85em; text-transform: uppercase; }}
  code {{ background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }}
  .footer {{ color: #484f58; margin-top: 40px; font-size: 0.85em; }}
</style>
</head><body>
<h1>kanoniv-auth</h1>
<p style="color: #8b949e;">Delegation service dashboard. Sudo for AI agents.</p>

<div class="stats">
  <div class="stat"><div class="stat-value">{total}</div><div class="stat-label">Total delegations</div></div>
  <div class="stat"><div class="stat-value">{active}</div><div class="stat-label">Active</div></div>
  <div class="stat"><div class="stat-value">{}</div><div class="stat-label">Revoked</div></div>
</div>

<h2 style="color: #c9d1d9;">Recent Delegations</h2>
<table>
  <thead><tr><th>ID</th><th>Agent</th><th>Scopes</th><th>Expires</th><th>Status</th></tr></thead>
  <tbody>{table_rows}</tbody>
</table>

<div class="footer">
  kanoniv-auth delegation service | <a href="/health" style="color: #58a6ff;">/health</a> | <a href="/metrics" style="color: #58a6ff;">/metrics</a>
</div>
</body></html>"#,
        total - active,
    );

    Html(html)
}

// --- Server startup ---

pub async fn run_server(port: u16, db_path: &str, root_key_path: &str) -> Result<(), String> {
    // Load root key
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
    let root_identity = keypair.identity();

    // Open SQLite
    let conn =
        rusqlite::Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
        .map_err(|e| format!("Failed to set pragmas: {e}"))?;
    init_db(&conn).map_err(|e| format!("Failed to init database: {e}"))?;

    let root_did = root_identity.did.clone();

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        root_identity,
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
    eprintln!("  Root DID:  {}", root_did);
    eprintln!("  Database:  {db_path}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind {addr}: {e}"))?;
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {e}"))?;

    Ok(())
}
