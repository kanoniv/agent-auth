//! kanoniv-auth CLI - Sudo for AI agents.
//!
//! Replace API keys with cryptographic delegation.

use std::fs;
use std::path::PathBuf;
use std::process;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use clap::{Parser, Subcommand};
use colored::*;
use kanoniv_agent_auth::{AgentKeyPair, Caveat, Delegation, SignedMessage};

#[cfg(feature = "server")]
mod server;
mod wrap_mcp;

#[derive(Parser)]
#[command(
    name = "kanoniv-auth",
    about = "Sudo for AI agents. Replace API keys with cryptographic delegation.",
    version,
    after_help = "Your AI agents currently have keys. We give them math instead."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a new root key pair
    Init {
        /// Output path for the key file
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Overwrite existing key without prompting
        #[arg(long)]
        force: bool,
    },

    /// Issue a delegation token
    Delegate {
        /// Comma-separated scopes (e.g. "deploy.staging,build")
        #[arg(short, long, value_delimiter = ',')]
        scopes: Vec<String>,
        /// Time-to-live (e.g. "4h", "30m", "1d")
        #[arg(short, long)]
        ttl: Option<String>,
        /// DID of the agent receiving the delegation
        #[arg(long)]
        to: Option<String>,
        /// Root key file path
        #[arg(short, long)]
        key: Option<PathBuf>,
        /// Parent token for sub-delegation
        #[arg(long)]
        parent: Option<String>,
        /// Show what would happen without signing
        #[arg(long)]
        dry_run: bool,
    },

    /// Verify a delegation token against an action
    Verify {
        /// The scope to verify (e.g. "deploy.staging")
        #[arg(short, long)]
        scope: String,
        /// The delegation token (or reads $KANONIV_TOKEN)
        #[arg(short, long, env = "KANONIV_TOKEN")]
        token: String,
    },

    /// Sign an execution envelope
    Sign {
        /// Action performed (e.g. "deploy")
        #[arg(short, long)]
        action: String,
        /// The delegation token
        #[arg(short, long, env = "KANONIV_TOKEN")]
        token: String,
        /// Target of the action (e.g. "staging")
        #[arg(long, default_value = "")]
        target: String,
        /// Result of the action
        #[arg(long, default_value = "success")]
        result: String,
    },

    /// Show the identity behind a token
    Whoami {
        /// The delegation token
        #[arg(short, long, env = "KANONIV_TOKEN")]
        token: String,
    },

    /// Pretty-print a delegation chain or execution envelope
    Audit {
        /// Base64-encoded token or envelope
        data: String,
    },

    /// Wrap an MCP server with delegation verification
    #[command(name = "wrap-mcp")]
    WrapMcp {
        /// Verification mode: strict (deny without proof), warn (default), audit (log only)
        #[arg(short, long, default_value = "warn")]
        mode: String,
        /// Root key file for proof verification
        #[arg(short = 'k', long)]
        root_key: Option<String>,
        /// The MCP server command to wrap
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },

    /// Start the delegation service (Axum + SQLite)
    #[cfg(feature = "server")]
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "7400")]
        port: u16,
        /// SQLite database path
        #[arg(long, default_value = "kanoniv-auth.db")]
        db: String,
        /// Root key file path
        #[arg(short, long)]
        key: Option<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init { output, force } => cmd_init(output, force),
        Commands::Delegate {
            scopes,
            ttl,
            to,
            key,
            parent,
            dry_run,
        } => cmd_delegate(scopes, ttl, to, key, parent, dry_run),
        Commands::Verify { scope, token } => cmd_verify(scope, token),
        Commands::Sign {
            action,
            token,
            target,
            result,
        } => cmd_sign(action, token, target, result),
        Commands::Whoami { token } => cmd_whoami(token),
        Commands::Audit { data } => cmd_audit(data),
        Commands::WrapMcp {
            mode,
            root_key,
            command,
        } => match wrap_mcp::WrapMode::from_str(&mode) {
            Ok(wrap_mode) => wrap_mcp::run_wrapper(command, wrap_mode, root_key),
            Err(e) => Err(e),
        },
        #[cfg(feature = "server")]
        Commands::Serve { port, db, key } => {
            let key_path = key
                .unwrap_or_else(default_key_path)
                .to_string_lossy()
                .to_string();
            match tokio::runtime::Runtime::new() {
                Ok(rt) => rt.block_on(server::run_server(port, &db, &key_path)),
                Err(e) => Err(format!("Failed to create runtime: {e}")),
            }
        }
    };

    if let Err(e) = result {
        eprintln!("{} {}", "error:".red().bold(), e);
        process::exit(1);
    }
}

// --- Helpers ---

fn default_key_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".kanoniv")
        .join("root.key")
}

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

fn load_root_key(key_path: Option<PathBuf>) -> Result<AgentKeyPair, String> {
    let path = key_path.unwrap_or_else(default_key_path);
    if !path.exists() {
        return Err(format!(
            "No root key found at {}.\n\n  Generate one:\n    kanoniv-auth init",
            path.display()
        ));
    }
    let data: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|e| format!("Failed to read key: {e}"))?,
    )
    .map_err(|e| format!("Invalid key file: {e}"))?;

    let priv_hex = data["private_key"]
        .as_str()
        .ok_or("Key file missing private_key field")?;
    let bytes = hex::decode(priv_hex).map_err(|e| format!("Invalid private key hex: {e}"))?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Private key must be 32 bytes".to_string())?;
    Ok(AgentKeyPair::from_bytes(&arr))
}

fn keypair_from_b64(b64: &str) -> Result<AgentKeyPair, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(b64)
        .map_err(|e| format!("Invalid key encoding: {e}"))?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Key must be 32 bytes".to_string())?;
    Ok(AgentKeyPair::from_bytes(&arr))
}

fn parse_ttl(ttl: &str) -> Result<f64, String> {
    let ttl = ttl.trim().to_lowercase();

    // Try simple number (seconds)
    if let Ok(v) = ttl.parse::<f64>() {
        if v <= 0.0 {
            return Err("TTL must be positive".to_string());
        }
        return Ok(v);
    }

    // Try with unit suffix
    let (num_str, unit) = if ttl.ends_with('h') {
        (&ttl[..ttl.len() - 1], 3600.0)
    } else if ttl.ends_with('m') {
        (&ttl[..ttl.len() - 1], 60.0)
    } else if ttl.ends_with('d') {
        (&ttl[..ttl.len() - 1], 86400.0)
    } else if ttl.ends_with('s') {
        (&ttl[..ttl.len() - 1], 1.0)
    } else {
        return Err(format!(
            "Invalid TTL: \"{ttl}\". Use \"4h\", \"30m\", \"1d\", or \"3600s\"."
        ));
    };

    let value: f64 = num_str
        .parse()
        .map_err(|_| format!("Invalid TTL number: \"{num_str}\""))?;
    let result = value * unit;
    if result <= 0.0 {
        return Err("TTL must be positive".to_string());
    }
    Ok(result)
}

fn format_duration(secs: f64) -> String {
    if secs < 60.0 {
        format!("{:.0}s", secs)
    } else if secs < 3600.0 {
        format!("{:.0}m", secs / 60.0)
    } else {
        format!("{:.1}h", secs / 3600.0)
    }
}

// --- Commands ---

fn cmd_init(output: Option<PathBuf>, force: bool) -> Result<(), String> {
    let path = output.unwrap_or_else(default_key_path);

    if path.exists() && !force {
        return Err(format!(
            "Key already exists at {}. Use --force to overwrite.",
            path.display()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    let keypair = AgentKeyPair::generate();
    let identity = keypair.identity();

    let key_data = serde_json::json!({
        "did": identity.did,
        "public_key": hex::encode(&identity.public_key_bytes),
        "private_key": hex::encode(keypair.secret_bytes()),
        "created_at": chrono::Utc::now().to_rfc3339(),
    });

    fs::write(&path, serde_json::to_string_pretty(&key_data).unwrap())
        .map_err(|e| format!("Failed to write key: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to set permissions: {e}"))?;
    }

    println!("{}", "Root key generated.".green().bold());
    println!("  DID:  {}", identity.did);
    println!("  Path: {}", path.display());
    println!();
    println!(
        "  {} Treat this like an SSH key. Don't share it.",
        "WARNING:".yellow().bold()
    );

    Ok(())
}

fn cmd_delegate(
    scopes: Vec<String>,
    ttl: Option<String>,
    _to: Option<String>,
    key: Option<PathBuf>,
    parent: Option<String>,
    dry_run: bool,
) -> Result<(), String> {
    if scopes.is_empty() {
        return Err("--scopes is required. Example: --scopes deploy.staging,build".to_string());
    }

    let ttl_seconds = ttl.as_deref().map(parse_ttl).transpose()?;

    if dry_run {
        println!("{}", "[DRY RUN] Would create delegation:".yellow().bold());
        println!("  Scopes:  {:?}", scopes);
        if let Some(ttl_str) = &ttl {
            println!("  TTL:     {}", ttl_str);
        } else {
            println!("  TTL:     no expiry");
        }
        if parent.is_some() {
            println!("  Type:    sub-delegation (narrowing from parent)");
        } else {
            println!("  Type:    root delegation");
        }
        return Ok(());
    }

    // Build caveats
    let mut caveats = vec![Caveat::ActionScope(scopes.clone())];
    if let Some(secs) = ttl_seconds {
        let expires = chrono::Utc::now() + chrono::Duration::seconds(secs as i64);
        caveats.push(Caveat::ExpiresAt(
            expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        ));
    }

    if let Some(ref parent_token) = parent {
        // Sub-delegation
        let parent_data = decode_token(parent_token)?;
        let parent_scopes: Vec<String> = parent_data["scopes"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Check narrowing
        for s in &scopes {
            if !parent_scopes.contains(s) {
                return Err(format!(
                    "{}\n\n  You have:  [{}]\n  You need:  [\"{}\"]",
                    format!("DENIED: scope \"{s}\" not in parent delegation").red(),
                    parent_scopes.join(", "),
                    s
                ));
            }
        }

        let priv_key_b64 = parent_data["agent_private_key"]
            .as_str()
            .ok_or("Parent token has no agent keys for sub-delegation")?;
        let signing_keys = keypair_from_b64(priv_key_b64)?;
        let agent_keys = AgentKeyPair::generate();

        let delegation =
            Delegation::create_root(&signing_keys, &agent_keys.identity().did, caveats)
                .map_err(|e| format!("Delegation failed: {e}"))?;

        let mut parent_chain: Vec<serde_json::Value> =
            parent_data["chain"].as_array().cloned().unwrap_or_default();
        let link =
            serde_json::to_value(&delegation).map_err(|e| format!("Serialization error: {e}"))?;
        parent_chain.push(link);

        let mut token_data = serde_json::json!({
            "version": 1,
            "chain": parent_chain,
            "agent_did": agent_keys.identity().did,
            "scopes": scopes,
            "agent_private_key": URL_SAFE_NO_PAD.encode(agent_keys.secret_bytes()),
        });

        if let Some(secs) = ttl_seconds {
            let parent_expires = parent_data["expires_at"].as_f64();
            let now = chrono::Utc::now().timestamp() as f64;
            let my_expires = now + secs;
            let effective = parent_expires.map_or(my_expires, |pe| my_expires.min(pe));
            token_data["expires_at"] = serde_json::Value::from(effective);
        }

        println!("{}", encode_token(&token_data));
    } else {
        // Root delegation
        let root = load_root_key(key)?;
        let agent_keys = AgentKeyPair::generate();

        let delegation = Delegation::create_root(&root, &agent_keys.identity().did, caveats)
            .map_err(|e| format!("Delegation failed: {e}"))?;

        let mut token_data = serde_json::json!({
            "version": 1,
            "chain": [delegation],
            "agent_did": agent_keys.identity().did,
            "scopes": scopes,
            "agent_private_key": URL_SAFE_NO_PAD.encode(agent_keys.secret_bytes()),
        });

        if let Some(secs) = ttl_seconds {
            let now = chrono::Utc::now().timestamp() as f64;
            token_data["expires_at"] = serde_json::Value::from(now + secs);
        }

        println!("{}", encode_token(&token_data));
    }

    Ok(())
}

fn cmd_verify(scope: String, token: String) -> Result<(), String> {
    let data = decode_token(&token)?;
    let chain = data["chain"].as_array().ok_or("Token has no chain")?;
    let token_scopes: Vec<String> = data["scopes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // Check expiry
    if let Some(expires) = data["expires_at"].as_f64() {
        let now = chrono::Utc::now().timestamp() as f64;
        if now > expires {
            return Err(format!(
                "{}\n\n  Re-delegate:\n    kanoniv-auth delegate --scopes {} --ttl <ttl>",
                format!(
                    "EXPIRED: token expired {} ago",
                    format_duration(now - expires)
                )
                .red(),
                token_scopes.join(",")
            ));
        }
    }

    // Check scope
    if !token_scopes.contains(&scope) {
        return Err(format!(
            "{}\n\n  You have:  [{}]\n  You need:  [\"{}\"]",
            format!("DENIED: scope \"{scope}\" not in delegation").red(),
            token_scopes.join(", "),
            scope
        ));
    }

    // Report
    let agent_did = data["agent_did"].as_str().unwrap_or("unknown");
    let first_issuer = chain
        .first()
        .and_then(|l| l["issuer_did"].as_str())
        .unwrap_or("unknown");

    let ttl_str = if let Some(expires) = data["expires_at"].as_f64() {
        let remaining = expires - chrono::Utc::now().timestamp() as f64;
        format!("{} remaining", format_duration(remaining))
    } else {
        "no expiry".to_string()
    };

    println!("{}", "VERIFIED".green().bold());
    println!("  Agent:   {}", agent_did);
    println!("  Root:    {}", first_issuer);
    println!("  Scopes:  {:?}", token_scopes);
    println!("  Expires: {}", ttl_str);
    println!("  Chain:   {} link(s)", chain.len());

    Ok(())
}

fn cmd_sign(action: String, token: String, target: String, result: String) -> Result<(), String> {
    let data = decode_token(&token)?;

    let priv_key_b64 = data["agent_private_key"]
        .as_str()
        .ok_or("Token does not contain agent keys")?;
    let agent_keys = keypair_from_b64(priv_key_b64)?;

    let envelope = serde_json::json!({
        "version": 1,
        "agent_did": data["agent_did"],
        "action": action,
        "target": target,
        "result": result,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "scopes": data["scopes"],
        "chain_depth": data["chain"].as_array().map(|a| a.len()).unwrap_or(0),
    });

    let signed =
        SignedMessage::sign(&agent_keys, envelope).map_err(|e| format!("Signing failed: {e}"))?;

    let mut output =
        serde_json::to_value(&signed).map_err(|e| format!("Serialization error: {e}"))?;
    output["delegation_chain"] = data["chain"].clone();

    println!("{}", encode_token(&output));

    Ok(())
}

fn cmd_whoami(token: String) -> Result<(), String> {
    let data = decode_token(&token)?;
    let chain = data["chain"].as_array();
    let scopes: Vec<String> = data["scopes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let agent_did = data["agent_did"].as_str().unwrap_or("unknown");
    let chain_depth = chain.map(|c| c.len()).unwrap_or(0);
    let root_did = chain
        .and_then(|c| c.first())
        .and_then(|l| l["issuer_did"].as_str())
        .unwrap_or("unknown");

    println!("{}", "Agent Identity".bold());
    println!("  DID:     {}", agent_did);
    println!("  Root:    {}", root_did);
    println!("  Scopes:  {:?}", scopes);
    println!("  Chain:   {} link(s)", chain_depth);

    if let Some(expires) = data["expires_at"].as_f64() {
        let now = chrono::Utc::now().timestamp() as f64;
        let remaining = expires - now;
        if remaining > 0.0 {
            println!(
                "  TTL:     {}",
                format!("{} remaining", format_duration(remaining)).green()
            );
        } else {
            println!(
                "  TTL:     {}",
                format!("expired {} ago", format_duration(-remaining)).red()
            );
        }
    } else {
        println!("  TTL:     no expiry");
    }

    if data.get("agent_private_key").is_some() {
        println!("  Keys:    embedded (can sub-delegate and sign)");
    } else {
        println!("  Keys:    external (signing requires own key)");
    }

    Ok(())
}

fn cmd_audit(data_str: String) -> Result<(), String> {
    let data = decode_token(&data_str)?;

    // Detect execution envelope vs delegation token
    if data.get("action").is_some() {
        println!("{}", "Execution Envelope".bold());
        println!("  Agent:   {}", data["agent_did"].as_str().unwrap_or("?"));
        println!("  Action:  {}", data["action"].as_str().unwrap_or("?"));
        println!("  Target:  {}", data["target"].as_str().unwrap_or(""));
        println!("  Result:  {}", data["result"].as_str().unwrap_or("?"));
        if let Some(ts) = data["timestamp"].as_str() {
            println!("  Time:    {}", ts);
        }
        println!();
    }

    // Print delegation chain as tree
    let chain = data
        .get("delegation_chain")
        .or_else(|| data.get("chain"))
        .and_then(|c| c.as_array());

    if let Some(chain) = chain {
        println!("{}", "Delegation Chain".bold());
        for (i, link) in chain.iter().enumerate() {
            let issuer = link["issuer_did"].as_str().unwrap_or("?");
            let delegate = link["delegate_did"].as_str().unwrap_or("?");
            let indent = "  ".repeat(i + 1);

            if i == 0 {
                let short = if issuer.len() > 30 {
                    format!("{}...", &issuer[..27])
                } else {
                    issuer.to_string()
                };
                println!("  {} {}", short, "(root)".dimmed());
            }

            let delegate_short = if delegate.len() > 30 {
                format!("{}...", &delegate[..27])
            } else {
                delegate.to_string()
            };

            // Extract scopes from caveats
            let scope_str = link["caveats"]
                .as_array()
                .and_then(|cavs| {
                    cavs.iter().find_map(|c| {
                        if c["type"] == "action_scope" {
                            c["value"].as_array().map(|v| {
                                v.iter()
                                    .filter_map(|s| s.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            })
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or_default();

            println!(
                "{}|-- {}{}",
                indent,
                delegate_short,
                if scope_str.is_empty() {
                    String::new()
                } else {
                    format!(" [{}]", scope_str)
                }
            );
        }

        println!();
        println!("  Chain depth: {}", chain.len());
    } else {
        println!("  No delegation chain found.");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ttl_hours() {
        assert_eq!(parse_ttl("4h").unwrap(), 14400.0);
    }

    #[test]
    fn test_parse_ttl_minutes() {
        assert_eq!(parse_ttl("30m").unwrap(), 1800.0);
    }

    #[test]
    fn test_parse_ttl_days() {
        assert_eq!(parse_ttl("1d").unwrap(), 86400.0);
    }

    #[test]
    fn test_parse_ttl_seconds_explicit() {
        assert_eq!(parse_ttl("3600s").unwrap(), 3600.0);
    }

    #[test]
    fn test_parse_ttl_seconds_numeric() {
        assert_eq!(parse_ttl("3600").unwrap(), 3600.0);
    }

    #[test]
    fn test_parse_ttl_with_whitespace() {
        assert_eq!(parse_ttl("  4h  ").unwrap(), 14400.0);
    }

    #[test]
    fn test_parse_ttl_uppercase() {
        assert_eq!(parse_ttl("4H").unwrap(), 14400.0);
    }

    #[test]
    fn test_parse_ttl_zero_rejects() {
        assert!(parse_ttl("0").is_err());
    }

    #[test]
    fn test_parse_ttl_negative_rejects() {
        assert!(parse_ttl("-1").is_err());
    }

    #[test]
    fn test_parse_ttl_invalid_format() {
        assert!(parse_ttl("forever").is_err());
    }

    #[test]
    fn test_parse_ttl_empty_string() {
        assert!(parse_ttl("").is_err());
    }

    #[test]
    fn test_parse_ttl_just_unit() {
        assert!(parse_ttl("h").is_err());
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let data = serde_json::json!({"version": 1, "scopes": ["test"]});
        let encoded = encode_token(&data);
        let decoded = decode_token(&encoded).unwrap();
        assert_eq!(decoded["version"], 1);
        assert_eq!(decoded["scopes"][0], "test");
    }

    #[test]
    fn test_decode_invalid_base64() {
        assert!(decode_token("not-valid!!!").is_err());
    }

    #[test]
    fn test_decode_valid_base64_invalid_json() {
        let encoded = URL_SAFE_NO_PAD.encode(b"not json");
        assert!(decode_token(&encoded).is_err());
    }

    #[test]
    fn test_decode_strips_whitespace() {
        let data = serde_json::json!({"ok": true});
        let encoded = format!("  {}  ", encode_token(&data));
        let decoded = decode_token(&encoded).unwrap();
        assert_eq!(decoded["ok"], true);
    }

    #[test]
    fn test_format_duration_seconds() {
        assert_eq!(format_duration(30.0), "30s");
    }

    #[test]
    fn test_format_duration_minutes() {
        assert_eq!(format_duration(300.0), "5m");
    }

    #[test]
    fn test_format_duration_hours() {
        assert_eq!(format_duration(7200.0), "2.0h");
    }

    #[test]
    fn test_keypair_from_b64_valid() {
        let kp = AgentKeyPair::generate();
        let b64 = URL_SAFE_NO_PAD.encode(kp.secret_bytes());
        let loaded = keypair_from_b64(&b64).unwrap();
        assert_eq!(loaded.identity().did, kp.identity().did);
    }

    #[test]
    fn test_keypair_from_b64_invalid() {
        assert!(keypair_from_b64("not-valid").is_err());
    }

    #[test]
    fn test_keypair_from_b64_wrong_length() {
        let b64 = URL_SAFE_NO_PAD.encode(b"too short");
        assert!(keypair_from_b64(&b64).is_err());
    }
}
