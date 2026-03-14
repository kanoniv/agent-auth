//! # kanoniv-agent-auth
//!
//! Cryptographic identity primitives for AI agents.
//!
//! This crate provides Ed25519 keypair generation, `did:kanoniv:` decentralized
//! identifiers, signed message envelopes, and provenance entries for building
//! trustworthy agent-to-agent communication.
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
//! ## Provenance
//!
//! ```rust
//! use kanoniv_agent_auth::{AgentKeyPair, ProvenanceEntry, ActionType};
//!
//! let keypair = AgentKeyPair::generate();
//!
//! // Create a signed provenance entry
//! let entry = ProvenanceEntry::create(
//!     &keypair,
//!     ActionType::Merge,
//!     vec!["entity-1".into(), "entity-2".into()],
//!     vec![],  // no parents (root entry)
//!     serde_json::json!({"reason": "duplicate detected"}),
//! ).unwrap();
//!
//! // Chain entries via content hash
//! let next = ProvenanceEntry::create(
//!     &keypair,
//!     ActionType::Resolve,
//!     vec!["entity-3".into()],
//!     vec![entry.content_hash()],  // links to parent
//!     serde_json::json!({}),
//! ).unwrap();
//! ```

pub mod error;
pub mod identity;
pub mod signing;
pub mod provenance;

pub use error::CryptoError;
pub use identity::{AgentIdentity, AgentKeyPair};
pub use signing::SignedMessage;
pub use provenance::{ActionType, ProvenanceEntry};
