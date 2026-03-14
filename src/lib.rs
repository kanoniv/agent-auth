//! # kanoniv-agent-auth
//!
//! Cryptographic identity and delegation for AI agents.
//!
//! This crate provides Ed25519 keypair generation, `did:agent:` decentralized
//! identifiers, signed message envelopes, provenance entries, and attenuated
//! delegation with recursive chain verification.
//!
//! ## Quick Start
//!
//! ```rust
//! use kanoniv_agent_auth::{AgentKeyPair, SignedMessage};
//!
//! // Generate a new agent identity
//! let keypair = AgentKeyPair::generate();
//! let identity = keypair.identity();
//! println!("Agent DID: {}", identity.did);
//!
//! // Sign a message
//! let payload = serde_json::json!({"action": "merge", "entity_id": "abc123"});
//! let signed = SignedMessage::sign(&keypair, payload).unwrap();
//!
//! // Verify the message
//! signed.verify(&identity).unwrap();
//! ```
//!
//! ## Delegation
//!
//! ```rust
//! use kanoniv_agent_auth::{AgentKeyPair, Delegation, Invocation, Caveat, verify_invocation};
//!
//! let root = AgentKeyPair::generate();
//! let agent = AgentKeyPair::generate();
//!
//! // Root delegates to agent: resolve only, max cost $5
//! let delegation = Delegation::create_root(
//!     &root,
//!     &agent.identity().did,
//!     vec![
//!         Caveat::ActionScope(vec!["resolve".into()]),
//!         Caveat::MaxCost(5.0),
//!     ],
//! ).unwrap();
//!
//! // Agent invokes the delegated power
//! let invocation = Invocation::create(
//!     &agent,
//!     "resolve",
//!     serde_json::json!({"entity_id": "123", "cost": 2.0}),
//!     delegation,
//! ).unwrap();
//!
//! // Verify the full chain (no server calls)
//! let result = verify_invocation(&invocation, &agent.identity(), &root.identity()).unwrap();
//! assert_eq!(result.root_did, root.identity().did);
//! ```

pub mod delegation;
pub mod error;
pub mod identity;
pub mod provenance;
pub mod signing;

pub use delegation::{
    verify_delegation_chain, verify_delegation_chain_with_revocation, verify_invocation,
    verify_invocation_with_revocation, Caveat, Delegation, Invocation, VerificationResult,
    MAX_CHAIN_DEPTH,
};
pub use error::CryptoError;
pub use identity::{AgentIdentity, AgentKeyPair, ServiceEndpoint};
pub use provenance::{ActionType, ProvenanceEntry};
pub use signing::SignedMessage;
