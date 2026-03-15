//! MCP (Model Context Protocol) authentication middleware.
//!
//! Adds cryptographic agent identity and delegation verification to any MCP server.
//! Agents attach a `_proof` field to tool arguments containing a self-contained
//! invocation proof. The MCP server extracts and verifies the proof before executing
//! the tool - no external key resolver needed.
//!
//! # For MCP server authors (5 lines to add auth)
//!
//! ```rust
//! use kanoniv_agent_auth::mcp::{McpProof, verify_mcp_call};
//! use kanoniv_agent_auth::AgentIdentity;
//!
//! # fn example(args: serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
//! // Your root authority (the server operator's identity)
//! let root = AgentIdentity::from_bytes(&[0u8; 32])?; // load from config
//!
//! // Extract proof from tool arguments
//! let (proof, clean_args) = McpProof::extract(&args);
//!
//! // Verify if present
//! if let Some(proof) = proof {
//!     let result = verify_mcp_call(&proof, &root)?;
//!     println!("Verified agent: {} (chain depth: {})", result.invoker_did, result.depth);
//! }
//!
//! // Use clean_args (proof stripped out) for your tool logic
//! # Ok(())
//! # }
//! ```
//!
//! # For agents (attaching proofs to MCP calls)
//!
//! ```rust
//! use kanoniv_agent_auth::{AgentKeyPair, Delegation, Caveat};
//! use kanoniv_agent_auth::mcp::McpProof;
//!
//! # fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let agent = AgentKeyPair::generate();
//! let root = AgentKeyPair::generate();
//!
//! // Get a delegation from the root authority
//! let delegation = Delegation::create_root(
//!     &root,
//!     &agent.identity().did,
//!     vec![Caveat::ActionScope(vec!["resolve".into()])],
//! )?;
//!
//! // Create proof for a tool call
//! let proof = McpProof::create(
//!     &agent,
//!     "resolve",
//!     serde_json::json!({"source": "crm", "external_id": "123"}),
//!     delegation,
//! )?;
//!
//! // Inject into tool arguments
//! let mut args = serde_json::json!({"source": "crm", "external_id": "123"});
//! proof.inject(&mut args);
//! // args now contains "_proof" field - send to MCP server
//! # Ok(())
//! # }
//! ```

use serde::{Deserialize, Serialize};

use crate::delegation::{
    verify_invocation_with_revocation, Delegation, Invocation, VerificationResult,
};
use crate::error::CryptoError;
use crate::identity::{AgentIdentity, AgentKeyPair};

/// A self-contained invocation proof for MCP transport.
///
/// Contains everything an MCP server needs to verify the agent's identity
/// and authority without any external key resolver or database lookup.
/// The invoker's public key is embedded so the server can reconstruct
/// the identity and verify the signature chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpProof {
    /// The invocation (action + args + delegation chain + signature)
    pub invocation: Invocation,
    /// The invoker's Ed25519 public key as hex string (64 chars).
    /// Hex encoding ensures cross-language compatibility (Rust/TS/Python
    /// all produce identical JSON).
    pub invoker_public_key: String,
}

impl McpProof {
    /// Create an MCP proof for a tool call.
    ///
    /// The agent signs an invocation proving they have authority (via the
    /// delegation chain) to perform the given action with the given arguments.
    pub fn create(
        invoker_keypair: &AgentKeyPair,
        action: &str,
        args: serde_json::Value,
        delegation: Delegation,
    ) -> Result<Self, CryptoError> {
        let invocation = Invocation::create(invoker_keypair, action, args, delegation)?;
        let invoker_identity = invoker_keypair.identity();

        Ok(Self {
            invocation,
            invoker_public_key: hex::encode(&invoker_identity.public_key_bytes),
        })
    }

    /// Extract an MCP proof from tool arguments.
    ///
    /// Looks for a `_proof` field in the arguments object. Returns the proof
    /// (if present) and a copy of the arguments with `_proof` stripped out.
    /// If `_proof` is absent or cannot be deserialized, returns `None` and
    /// the original arguments unchanged.
    pub fn extract(args: &serde_json::Value) -> (Option<Self>, serde_json::Value) {
        let proof_value = args.get("_proof");

        let proof = proof_value.and_then(|v| serde_json::from_value::<Self>(v.clone()).ok());

        // Always strip _proof from args - it's a reserved protocol field
        // and should never be forwarded to tool handlers or upstream APIs.
        let clean_args = if let serde_json::Value::Object(map) = args {
            if map.contains_key("_proof") {
                let mut clean = map.clone();
                clean.remove("_proof");
                serde_json::Value::Object(clean)
            } else {
                args.clone()
            }
        } else {
            args.clone()
        };

        (proof, clean_args)
    }

    /// Inject the proof into tool arguments.
    ///
    /// Adds the proof as a `_proof` field on the arguments object.
    /// The arguments must be a JSON object.
    pub fn inject(&self, args: &mut serde_json::Value) {
        if let serde_json::Value::Object(ref mut map) = args {
            if let Ok(proof_value) = serde_json::to_value(self) {
                map.insert("_proof".to_string(), proof_value);
            }
        }
    }
}

/// Verify an MCP proof against a root authority.
///
/// This is the main entry point for MCP server authors. It:
/// 1. Reconstructs the invoker's identity from the embedded public key
/// 2. Verifies the public key matches the claimed invoker DID
/// 3. Verifies the invocation signature
/// 4. Walks the entire delegation chain back to the root
/// 5. Checks every caveat against the invocation action/args
///
/// No external lookups needed - everything is in the proof.
pub fn verify_mcp_call(
    proof: &McpProof,
    root_identity: &AgentIdentity,
) -> Result<VerificationResult, CryptoError> {
    verify_mcp_call_with_revocation(proof, root_identity, |_| false)
}

/// Verify an MCP proof with optional revocation checking.
///
/// Same as `verify_mcp_call` but accepts a callback to check if any
/// delegation in the chain has been revoked. The callback receives
/// the delegation's content hash and returns `true` if revoked.
pub fn verify_mcp_call_with_revocation(
    proof: &McpProof,
    root_identity: &AgentIdentity,
    is_revoked: impl Fn(&str) -> bool,
) -> Result<VerificationResult, CryptoError> {
    // Reconstruct invoker identity from embedded public key (hex-encoded)
    let pk_bytes = hex::decode(&proof.invoker_public_key).map_err(|_| {
        CryptoError::DelegationChainBroken("invalid hex in invoker_public_key".into())
    })?;
    let invoker_identity = AgentIdentity::from_bytes(&pk_bytes).map_err(|_| {
        CryptoError::DelegationChainBroken("invalid Ed25519 public key in proof".into())
    })?;

    // Verify the embedded key matches the claimed invoker DID
    if invoker_identity.did != proof.invocation.invoker_did {
        return Err(CryptoError::DelegationChainBroken(format!(
            "embedded public key produces DID '{}' but invocation claims '{}'",
            invoker_identity.did, proof.invocation.invoker_did
        )));
    }

    verify_invocation_with_revocation(
        &proof.invocation,
        &invoker_identity,
        root_identity,
        is_revoked,
    )
}

/// MCP auth mode for server configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpAuthMode {
    /// Reject tool calls without a valid proof.
    Required,
    /// Verify proof if present, allow unauthenticated calls.
    Optional,
    /// Skip all proof verification.
    Disabled,
}

impl McpAuthMode {
    /// Parse from string (e.g. environment variable).
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "required" | "enforce" | "strict" => Self::Required,
            "disabled" | "off" | "none" => Self::Disabled,
            _ => Self::Optional,
        }
    }
}

/// Result of MCP auth verification for a single tool call.
///
/// Returned by `verify_mcp_tool_call` to give the server both the
/// verification outcome and cleaned arguments in one call.
#[derive(Debug)]
pub struct McpAuthOutcome {
    /// The verified identity chain, if a proof was present and valid.
    pub verified: Option<VerificationResult>,
    /// The tool arguments with `_proof` stripped out.
    pub args: serde_json::Value,
}

/// All-in-one MCP tool call verification.
///
/// Combines proof extraction, verification, and argument cleaning into
/// one call. Respects the auth mode:
/// - `Required`: returns error if no proof or invalid proof
/// - `Optional`: verifies if present, passes through if absent
/// - `Disabled`: always passes through, strips proof if present
///
/// This is the recommended entry point for MCP server middleware.
pub fn verify_mcp_tool_call(
    tool_name: &str,
    args: &serde_json::Value,
    root_identity: &AgentIdentity,
    mode: McpAuthMode,
) -> Result<McpAuthOutcome, CryptoError> {
    verify_mcp_tool_call_with_revocation(tool_name, args, root_identity, mode, |_| false)
}

/// All-in-one MCP tool call verification with revocation support.
pub fn verify_mcp_tool_call_with_revocation(
    _tool_name: &str,
    args: &serde_json::Value,
    root_identity: &AgentIdentity,
    mode: McpAuthMode,
    is_revoked: impl Fn(&str) -> bool,
) -> Result<McpAuthOutcome, CryptoError> {
    let (proof, clean_args) = McpProof::extract(args);

    match mode {
        McpAuthMode::Disabled => Ok(McpAuthOutcome {
            verified: None,
            args: clean_args,
        }),
        McpAuthMode::Optional => match proof {
            Some(p) => {
                let result = verify_mcp_call_with_revocation(&p, root_identity, is_revoked)?;
                Ok(McpAuthOutcome {
                    verified: Some(result),
                    args: clean_args,
                })
            }
            None => Ok(McpAuthOutcome {
                verified: None,
                args: clean_args,
            }),
        },
        McpAuthMode::Required => match proof {
            Some(p) => {
                let result = verify_mcp_call_with_revocation(&p, root_identity, is_revoked)?;
                Ok(McpAuthOutcome {
                    verified: Some(result),
                    args: clean_args,
                })
            }
            None => Err(CryptoError::DelegationChainBroken(
                "MCP auth required but no _proof provided in tool arguments".into(),
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delegation::Caveat;

    fn keypair() -> AgentKeyPair {
        AgentKeyPair::generate()
    }

    #[test]
    fn test_create_and_verify_mcp_proof() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        let result = verify_mcp_call(&proof, &root.identity()).unwrap();
        assert_eq!(result.invoker_did, agent.identity().did);
        assert_eq!(result.root_did, root.identity().did);
    }

    #[test]
    fn test_extract_and_inject() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        // Inject into args
        let mut args = serde_json::json!({"source": "crm", "external_id": "123"});
        proof.inject(&mut args);
        assert!(args.get("_proof").is_some());
        assert!(args.get("source").is_some());

        // Extract from args
        let (extracted, clean_args) = McpProof::extract(&args);
        assert!(extracted.is_some());
        assert!(clean_args.get("_proof").is_none());
        assert_eq!(clean_args.get("source").unwrap(), "crm");
        assert_eq!(clean_args.get("external_id").unwrap(), "123");

        // Verify the extracted proof
        let result = verify_mcp_call(&extracted.unwrap(), &root.identity()).unwrap();
        assert_eq!(result.invoker_did, agent.identity().did);
    }

    #[test]
    fn test_extract_no_proof() {
        let args = serde_json::json!({"source": "crm", "external_id": "123"});
        let (proof, clean_args) = McpProof::extract(&args);
        assert!(proof.is_none());
        assert_eq!(clean_args, args);
    }

    #[test]
    fn test_extract_invalid_proof() {
        let args = serde_json::json!({"source": "crm", "_proof": "not-valid-json"});
        let (proof, clean_args) = McpProof::extract(&args);
        assert!(proof.is_none());
        // Invalid proof is still stripped - _proof is a reserved protocol field
        assert!(clean_args.get("_proof").is_none());
        assert_eq!(clean_args.get("source").unwrap(), "crm");
    }

    #[test]
    fn test_wrong_invoker_key_rejected() {
        let root = keypair();
        let agent = keypair();
        let impersonator = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Tamper: replace invoker public key with impersonator's
        let tampered = McpProof {
            invoker_public_key: hex::encode(&impersonator.identity().public_key_bytes),
            ..proof
        };

        let result = verify_mcp_call(&tampered, &root.identity());
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_root_rejected() {
        let root = keypair();
        let fake_root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_mcp_call(&proof, &fake_root.identity());
        assert!(result.is_err());
    }

    #[test]
    fn test_caveat_enforcement_through_mcp() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![
                Caveat::ActionScope(vec!["resolve".into()]),
                Caveat::MaxCost(5.0),
            ],
        )
        .unwrap();

        // Action allowed, cost within limit
        let proof_ok = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"cost": 3.0}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_mcp_call(&proof_ok, &root.identity()).is_ok());

        // Action not allowed
        let proof_bad_action = McpProof::create(
            &agent,
            "merge",
            serde_json::json!({"cost": 1.0}),
            delegation.clone(),
        )
        .unwrap();
        assert!(matches!(
            verify_mcp_call(&proof_bad_action, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));

        // Cost exceeded
        let proof_bad_cost = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"cost": 10.0}),
            delegation,
        )
        .unwrap();
        assert!(matches!(
            verify_mcp_call(&proof_bad_cost, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    #[test]
    fn test_chained_delegation_through_mcp() {
        let root = keypair();
        let manager = keypair();
        let worker = keypair();

        let d1 = Delegation::create_root(
            &root,
            &manager.identity().did,
            vec![Caveat::ActionScope(vec![
                "resolve".into(),
                "search".into(),
                "merge".into(),
            ])],
        )
        .unwrap();

        // Manager narrows: worker can only resolve
        let d2 = Delegation::delegate(
            &manager,
            &worker.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
            d1,
        )
        .unwrap();

        let proof = McpProof::create(&worker, "resolve", serde_json::json!({}), d2).unwrap();

        let result = verify_mcp_call(&proof, &root.identity()).unwrap();
        assert_eq!(result.invoker_did, worker.identity().did);
        assert_eq!(result.root_did, root.identity().did);
        assert_eq!(result.depth, 2); // worker -> manager -> root
    }

    #[test]
    fn test_revocation_through_mcp() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();
        let revoked_hash = delegation.proof.content_hash();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Without revocation - passes
        assert!(verify_mcp_call(&proof, &root.identity()).is_ok());

        // With revocation - fails
        let result =
            verify_mcp_call_with_revocation(&proof, &root.identity(), |hash| hash == revoked_hash);
        assert!(matches!(result, Err(CryptoError::DelegationRevoked(_))));
    }

    // --- McpAuthMode tests ---

    #[test]
    fn test_auth_mode_required_no_proof() {
        let root = keypair();
        let args = serde_json::json!({"source": "crm"});

        let result =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Required);
        assert!(matches!(result, Err(CryptoError::DelegationChainBroken(_))));
    }

    #[test]
    fn test_auth_mode_required_with_valid_proof() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        let mut args = serde_json::json!({"source": "crm"});
        proof.inject(&mut args);

        let outcome =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Required)
                .unwrap();
        assert!(outcome.verified.is_some());
        assert!(outcome.args.get("_proof").is_none());
    }

    #[test]
    fn test_auth_mode_optional_no_proof() {
        let root = keypair();
        let args = serde_json::json!({"source": "crm"});

        let outcome =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Optional)
                .unwrap();
        assert!(outcome.verified.is_none());
    }

    #[test]
    fn test_auth_mode_optional_with_proof() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        let mut args = serde_json::json!({"source": "crm"});
        proof.inject(&mut args);

        let outcome =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Optional)
                .unwrap();
        assert!(outcome.verified.is_some());
    }

    #[test]
    fn test_auth_mode_disabled() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        let mut args = serde_json::json!({"source": "crm"});
        proof.inject(&mut args);

        let outcome =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Disabled)
                .unwrap();
        // Disabled mode: no verification even with proof present
        assert!(outcome.verified.is_none());
        // But proof is still stripped from args
        assert!(outcome.args.get("_proof").is_none());
    }

    #[test]
    fn test_auth_mode_from_str() {
        assert_eq!(
            McpAuthMode::from_str_lossy("required"),
            McpAuthMode::Required
        );
        assert_eq!(
            McpAuthMode::from_str_lossy("enforce"),
            McpAuthMode::Required
        );
        assert_eq!(McpAuthMode::from_str_lossy("strict"), McpAuthMode::Required);
        assert_eq!(
            McpAuthMode::from_str_lossy("disabled"),
            McpAuthMode::Disabled
        );
        assert_eq!(McpAuthMode::from_str_lossy("off"), McpAuthMode::Disabled);
        assert_eq!(
            McpAuthMode::from_str_lossy("optional"),
            McpAuthMode::Optional
        );
        assert_eq!(
            McpAuthMode::from_str_lossy("anything"),
            McpAuthMode::Optional
        );
    }

    // --- Error path tests ---

    #[test]
    fn test_create_fails_when_invoker_not_delegate() {
        let root = keypair();
        let agent = keypair();
        let wrong_agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        // wrong_agent is not the delegate of this delegation
        let result = McpProof::create(&wrong_agent, "resolve", serde_json::json!({}), delegation);
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_invalid_hex_public_key() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let mut proof =
            McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Replace with invalid hex
        proof.invoker_public_key = "not-valid-hex!@#$".to_string();

        let result = verify_mcp_call(&proof, &root.identity());
        assert!(matches!(result, Err(CryptoError::DelegationChainBroken(_))));
        if let Err(CryptoError::DelegationChainBroken(msg)) = result {
            assert!(msg.contains("invalid hex"), "got: {}", msg);
        }
    }

    #[test]
    fn test_verify_wrong_length_public_key() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let mut proof =
            McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Replace with valid hex but wrong length (16 bytes instead of 32)
        proof.invoker_public_key = hex::encode(&[0u8; 16]);

        let result = verify_mcp_call(&proof, &root.identity());
        assert!(matches!(result, Err(CryptoError::DelegationChainBroken(_))));
        if let Err(CryptoError::DelegationChainBroken(msg)) = result {
            assert!(msg.contains("invalid Ed25519"), "got: {}", msg);
        }
    }

    #[test]
    fn test_verify_tampered_invocation_signature() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let mut proof =
            McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Tamper with the invocation signature
        proof.invocation.proof.signature = "00".repeat(64);

        let result = verify_mcp_call(&proof, &root.identity());
        assert!(
            result.is_err(),
            "tampered signature should fail verification"
        );
    }

    #[test]
    fn test_invoker_public_key_is_64_char_hex() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // Ed25519 public key = 32 bytes = 64 hex chars
        assert_eq!(proof.invoker_public_key.len(), 64);
        assert!(proof
            .invoker_public_key
            .chars()
            .all(|c| c.is_ascii_hexdigit()));
    }

    // --- extract() edge cases ---

    #[test]
    fn test_extract_non_object_args() {
        // Array
        let (proof, clean) = McpProof::extract(&serde_json::json!([1, 2, 3]));
        assert!(proof.is_none());
        assert_eq!(clean, serde_json::json!([1, 2, 3]));

        // String
        let (proof, clean) = McpProof::extract(&serde_json::json!("hello"));
        assert!(proof.is_none());
        assert_eq!(clean, serde_json::json!("hello"));

        // Null
        let (proof, clean) = McpProof::extract(&serde_json::Value::Null);
        assert!(proof.is_none());
        assert_eq!(clean, serde_json::Value::Null);

        // Number
        let (proof, clean) = McpProof::extract(&serde_json::json!(42));
        assert!(proof.is_none());
        assert_eq!(clean, serde_json::json!(42));
    }

    #[test]
    fn test_extract_proof_object_wrong_shape() {
        // _proof is an object but not a valid McpProof
        let args = serde_json::json!({
            "source": "crm",
            "_proof": {"wrong": "shape"}
        });
        let (proof, clean_args) = McpProof::extract(&args);
        assert!(proof.is_none());
        // Still stripped - reserved field
        assert!(clean_args.get("_proof").is_none());
        assert_eq!(clean_args.get("source").unwrap(), "crm");
    }

    #[test]
    fn test_extract_proof_null_value() {
        let args = serde_json::json!({"source": "crm", "_proof": null});
        let (proof, clean_args) = McpProof::extract(&args);
        assert!(proof.is_none());
        assert!(clean_args.get("_proof").is_none());
    }

    #[test]
    fn test_extract_empty_object() {
        let args = serde_json::json!({});
        let (proof, clean_args) = McpProof::extract(&args);
        assert!(proof.is_none());
        assert_eq!(clean_args, serde_json::json!({}));
    }

    // --- inject() edge cases ---

    #[test]
    fn test_inject_non_object_is_noop() {
        let root = keypair();
        let agent = keypair();
        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();
        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        // inject on non-object should be a no-op
        let mut arr = serde_json::json!([1, 2, 3]);
        proof.inject(&mut arr);
        assert_eq!(arr, serde_json::json!([1, 2, 3]));

        let mut s = serde_json::json!("hello");
        proof.inject(&mut s);
        assert_eq!(s, serde_json::json!("hello"));
    }

    // --- Auth mode with invalid proofs ---

    #[test]
    fn test_auth_mode_required_with_invalid_proof_fails() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let mut proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        // Tamper with signature
        proof.invocation.proof.signature = "ff".repeat(64);

        let mut args = serde_json::json!({"source": "crm"});
        proof.inject(&mut args);

        let result =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Required);
        assert!(
            result.is_err(),
            "invalid proof in required mode should fail"
        );
    }

    #[test]
    fn test_auth_mode_optional_with_invalid_proof_fails() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let mut proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        // Tamper with signature
        proof.invocation.proof.signature = "ff".repeat(64);

        let mut args = serde_json::json!({"source": "crm"});
        proof.inject(&mut args);

        // Optional mode: if proof IS present but invalid, should still fail
        let result =
            verify_mcp_tool_call("resolve", &args, &root.identity(), McpAuthMode::Optional);
        assert!(
            result.is_err(),
            "invalid proof in optional mode should fail (proof was present)"
        );
    }

    // --- Caveat types through MCP ---

    #[test]
    fn test_expires_at_caveat_through_mcp() {
        let root = keypair();
        let agent = keypair();

        // Expired delegation
        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::ExpiresAt("2020-01-01T00:00:00.000Z".into())],
        )
        .unwrap();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        assert!(matches!(
            verify_mcp_call(&proof, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    #[test]
    fn test_expires_at_future_passes() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::ExpiresAt("2099-12-31T23:59:59.999Z".into())],
        )
        .unwrap();

        let proof = McpProof::create(&agent, "resolve", serde_json::json!({}), delegation).unwrap();

        assert!(verify_mcp_call(&proof, &root.identity()).is_ok());
    }

    #[test]
    fn test_resource_caveat_through_mcp() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::Resource("entity:customer:*".into())],
        )
        .unwrap();

        // Matching resource
        let proof_ok = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"resource": "entity:customer:123"}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_mcp_call(&proof_ok, &root.identity()).is_ok());

        // Non-matching resource
        let proof_bad = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"resource": "entity:order:456"}),
            delegation,
        )
        .unwrap();
        assert!(matches!(
            verify_mcp_call(&proof_bad, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    #[test]
    fn test_context_caveat_through_mcp() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::Context {
                key: "session_id".into(),
                value: "sess-abc".into(),
            }],
        )
        .unwrap();

        // Correct context
        let proof_ok = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"session_id": "sess-abc"}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_mcp_call(&proof_ok, &root.identity()).is_ok());

        // Wrong context
        let proof_bad = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"session_id": "sess-xyz"}),
            delegation,
        )
        .unwrap();
        assert!(matches!(
            verify_mcp_call(&proof_bad, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    #[test]
    fn test_multiple_caveats_all_checked() {
        let root = keypair();
        let agent = keypair();

        // action_scope + max_cost + resource - all must pass
        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![
                Caveat::ActionScope(vec!["resolve".into()]),
                Caveat::MaxCost(10.0),
                Caveat::Resource("entity:*".into()),
            ],
        )
        .unwrap();

        // All caveats satisfied
        let proof_ok = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"cost": 5.0, "resource": "entity:123"}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_mcp_call(&proof_ok, &root.identity()).is_ok());

        // Wrong action (first caveat fails)
        let proof_bad = McpProof::create(
            &agent,
            "merge",
            serde_json::json!({"cost": 5.0, "resource": "entity:123"}),
            delegation,
        )
        .unwrap();
        assert!(matches!(
            verify_mcp_call(&proof_bad, &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    // --- Cross-language JSON format ---

    #[test]
    fn test_proof_json_format_cross_language() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(&root, &agent.identity().did, vec![]).unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        let json: serde_json::Value = serde_json::to_value(&proof).unwrap();

        // invoker_public_key must be a string (hex), not an array of numbers
        assert!(
            json["invoker_public_key"].is_string(),
            "invoker_public_key must serialize as hex string, got: {}",
            json["invoker_public_key"]
        );
        let pk_str = json["invoker_public_key"].as_str().unwrap();
        assert_eq!(pk_str.len(), 64, "hex-encoded 32-byte key = 64 chars");
        assert!(
            pk_str.chars().all(|c| c.is_ascii_hexdigit()),
            "must be valid hex: {}",
            pk_str
        );
    }

    #[test]
    fn test_serialization_roundtrip() {
        let root = keypair();
        let agent = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let proof = McpProof::create(
            &agent,
            "resolve",
            serde_json::json!({"source": "crm"}),
            delegation,
        )
        .unwrap();

        // Serialize and deserialize
        let json = serde_json::to_string(&proof).unwrap();
        let restored: McpProof = serde_json::from_str(&json).unwrap();

        // Verify the restored proof
        let result = verify_mcp_call(&restored, &root.identity()).unwrap();
        assert_eq!(result.invoker_did, agent.identity().did);
    }
}
