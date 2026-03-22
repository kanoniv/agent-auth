//! MCP Hardening Wrapper
//!
//! Spawns an MCP server process and intercepts all JSON-RPC tool calls
//! on stdin/stdout. Extracts `_proof` from tool arguments, verifies
//! against root authority, and forwards clean args to the real server.
//!
//! Usage:
//!   kanoniv-auth wrap-mcp --root-key ~/.kanoniv/root.key -- npx my-mcp-server
//!
//! Modes:
//!   --mode strict  No proof = reject tool call (JSON-RPC error)
//!   --mode warn    No proof = log warning, forward anyway (default)
//!   --mode audit   No verification, just log everything

use std::io::{self, BufRead, Write};
use std::process::{Command, Stdio};

use kanoniv_agent_auth::mcp::McpProof;
use kanoniv_agent_auth::{AgentIdentity, AgentKeyPair};
use serde_json::Value;

pub enum WrapMode {
    Strict,
    Warn,
    Audit,
}

impl WrapMode {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "strict" => Ok(Self::Strict),
            "warn" => Ok(Self::Warn),
            "audit" => Ok(Self::Audit),
            _ => Err(format!("Unknown mode: {s}. Use strict, warn, or audit.")),
        }
    }
}

fn load_root_identity(path: &str) -> Result<AgentIdentity, String> {
    let data: Value = serde_json::from_str(
        &std::fs::read_to_string(path).map_err(|e| format!("Failed to read root key: {e}"))?,
    )
    .map_err(|e| format!("Invalid key file: {e}"))?;

    let priv_hex = data["private_key"]
        .as_str()
        .ok_or("Key file missing private_key field")?;
    let bytes = hex::decode(priv_hex).map_err(|e| format!("Invalid private key hex: {e}"))?;
    let arr: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Private key must be 32 bytes".to_string())?;
    let keypair = AgentKeyPair::from_bytes(&arr);
    Ok(keypair.identity())
}

fn verify_proof(args: &Value, root_identity: &AgentIdentity) -> Result<String, String> {
    let (proof, _clean) = McpProof::extract(args);
    match proof {
        Some(p) => kanoniv_agent_auth::mcp::verify_mcp_call(&p, root_identity)
            .map(|result| result.invoker_did.clone())
            .map_err(|e| format!("{e}")),
        None => Err("no proof attached".to_string()),
    }
}

pub fn run_wrapper(
    command: Vec<String>,
    mode: WrapMode,
    root_key_path: Option<String>,
) -> Result<(), String> {
    if command.is_empty() {
        return Err("No command specified. Usage: kanoniv-auth wrap-mcp -- <command>".to_string());
    }

    let root_identity = if !matches!(mode, WrapMode::Audit) {
        if let Some(path) = &root_key_path {
            Some(load_root_identity(path)?)
        } else {
            eprintln!(
                "[kanoniv-auth] warning: no --root-key specified, proof verification disabled"
            );
            None
        }
    } else {
        None
    };

    // Spawn the MCP server
    let mut child = Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {e}", command[0]))?;

    let child_stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
    let child_stdout = child.stdout.take().ok_or("Failed to open child stdout")?;

    // Forward stdout from child to our stdout (in a thread)
    let stdout_handle = std::thread::spawn(move || {
        let reader = io::BufReader::new(child_stdout);
        let mut stdout = io::stdout().lock();
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    let _ = writeln!(stdout, "{l}");
                    let _ = stdout.flush();
                }
                Err(_) => break,
            }
        }
    });

    // Read stdin, intercept tool calls, forward to child
    let stdin = io::stdin();
    let mut child_writer = io::BufWriter::new(child_stdin);

    for line in stdin.lock().lines() {
        let line = line.map_err(|e| format!("stdin read error: {e}"))?;

        // Try to parse as JSON-RPC
        if let Ok(mut msg) = serde_json::from_str::<Value>(&line) {
            let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

            // Only intercept tools/call (MCP tool invocation)
            if method == "tools/call" {
                let tool_name = msg
                    .pointer("/params/name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");

                let args = msg
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::new()));

                let has_proof = args.get("_proof").is_some();

                match mode {
                    WrapMode::Strict => {
                        if !has_proof {
                            // No proof at all - reject
                            let id = msg.get("id").cloned().unwrap_or(Value::Null);
                            let error_response = serde_json::json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32600,
                                    "message": format!(
                                        "DENIED: tool '{}' called without delegation proof. Attach _proof to arguments.",
                                        tool_name
                                    )
                                }
                            });
                            let mut stdout = io::stdout().lock();
                            let _ = writeln!(
                                stdout,
                                "{}",
                                serde_json::to_string(&error_response).unwrap()
                            );
                            let _ = stdout.flush();
                            eprintln!(
                                "[kanoniv-auth] DENIED: {} - no proof (strict mode)",
                                tool_name
                            );
                            continue;
                        }

                        // Proof present - verify cryptographically
                        if let Some(ref root_id) = root_identity {
                            match verify_proof(&args, root_id) {
                                Ok(invoker_did) => {
                                    eprintln!(
                                        "[kanoniv-auth] VERIFIED: {} - invoker {}",
                                        tool_name,
                                        &invoker_did[..20.min(invoker_did.len())]
                                    );
                                }
                                Err(e) => {
                                    let id = msg.get("id").cloned().unwrap_or(Value::Null);
                                    let error_response = serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "id": id,
                                        "error": {
                                            "code": -32600,
                                            "message": format!(
                                                "DENIED: tool '{}' proof verification failed: {}",
                                                tool_name, e
                                            )
                                        }
                                    });
                                    let mut stdout = io::stdout().lock();
                                    let _ = writeln!(
                                        stdout,
                                        "{}",
                                        serde_json::to_string(&error_response).unwrap()
                                    );
                                    let _ = stdout.flush();
                                    eprintln!(
                                        "[kanoniv-auth] DENIED: {} - invalid proof: {}",
                                        tool_name, e
                                    );
                                    continue;
                                }
                            }
                        } else {
                            // No root key - presence check only
                            eprintln!(
                                "[kanoniv-auth] OK: {} - proof present (no root key to verify against)",
                                tool_name
                            );
                        }
                    }
                    WrapMode::Warn => {
                        if !has_proof {
                            eprintln!("[kanoniv-auth] WARNING: {} - no proof attached", tool_name);
                        } else if let Some(ref root_id) = root_identity {
                            match verify_proof(&args, root_id) {
                                Ok(did) => eprintln!(
                                    "[kanoniv-auth] VERIFIED: {} - invoker {}",
                                    tool_name,
                                    &did[..20.min(did.len())]
                                ),
                                Err(e) => eprintln!(
                                    "[kanoniv-auth] WARNING: {} - proof invalid: {}",
                                    tool_name, e
                                ),
                            }
                        } else {
                            eprintln!("[kanoniv-auth] OK: {} - proof present", tool_name);
                        }
                    }
                    WrapMode::Audit => {
                        eprintln!(
                            "[kanoniv-auth] AUDIT: {} - proof={}",
                            tool_name,
                            if has_proof { "yes" } else { "no" }
                        );
                    }
                }

                // Strip _proof before forwarding (never send to the real server)
                if has_proof {
                    if let Some(args_val) = msg.pointer_mut("/params/arguments") {
                        if let Some(obj) = args_val.as_object_mut() {
                            obj.remove("_proof");
                        }
                    }
                }
            }

            // Forward (possibly modified) message to child
            let forwarded = serde_json::to_string(&msg).unwrap();
            writeln!(child_writer, "{forwarded}")
                .map_err(|e| format!("Failed to write to child: {e}"))?;
            child_writer
                .flush()
                .map_err(|e| format!("Failed to flush to child: {e}"))?;
        } else {
            // Not JSON - forward as-is
            writeln!(child_writer, "{line}")
                .map_err(|e| format!("Failed to write to child: {e}"))?;
            child_writer
                .flush()
                .map_err(|e| format!("Failed to flush to child: {e}"))?;
        }
    }

    // Clean up
    drop(child_writer);
    let _ = stdout_handle.join();
    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for child: {e}"))?;

    if !status.success() {
        eprintln!(
            "[kanoniv-auth] MCP server exited with status: {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}
