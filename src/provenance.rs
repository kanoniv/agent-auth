//! Provenance entries - signed audit trail for agent actions.
//!
//! Each provenance entry records what an agent did, to which entities,
//! with a cryptographic signature proving the agent's authorship.
//! Entries form a directed acyclic graph (DAG) via parent_ids, enabling
//! tamper-evident chaining of agent actions.

use serde::{Deserialize, Serialize};

use crate::identity::AgentKeyPair;
use crate::signing::SignedMessage;
use crate::CryptoError;

/// The type of action recorded in a provenance entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    Resolve,
    Merge,
    Split,
    Mutate,
    Ingest,
    Delegate,
    Revoke,
    Custom(String),
}

impl std::fmt::Display for ActionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActionType::Resolve => write!(f, "resolve"),
            ActionType::Merge => write!(f, "merge"),
            ActionType::Split => write!(f, "split"),
            ActionType::Mutate => write!(f, "mutate"),
            ActionType::Ingest => write!(f, "ingest"),
            ActionType::Delegate => write!(f, "delegate"),
            ActionType::Revoke => write!(f, "revoke"),
            ActionType::Custom(s) => write!(f, "custom:{}", s),
        }
    }
}

/// A signed provenance entry in the audit chain.
///
/// Entries link to parents via `parent_ids`, forming a DAG.
/// Use `content_hash()` as the parent_id when chaining entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceEntry {
    /// The DID of the agent that performed the action
    pub agent_did: String,
    /// What action was performed
    pub action: ActionType,
    /// Entity IDs affected by this action
    pub entity_ids: Vec<String>,
    /// Parent provenance entry content hashes (for DAG chaining)
    pub parent_ids: Vec<String>,
    /// Additional context
    pub metadata: serde_json::Value,
    /// The signed envelope proving authenticity
    pub signed_envelope: SignedMessage,
}

impl ProvenanceEntry {
    /// Create and sign a new provenance entry.
    pub fn create(
        keypair: &AgentKeyPair,
        action: ActionType,
        entity_ids: Vec<String>,
        parent_ids: Vec<String>,
        metadata: serde_json::Value,
    ) -> Result<Self, CryptoError> {
        let identity = keypair.identity();

        let payload = serde_json::json!({
            "agent_did": identity.did,
            "action": action,
            "entity_ids": entity_ids,
            "parent_ids": parent_ids,
            "metadata": metadata,
        });

        let signed_envelope = SignedMessage::sign(keypair, payload)?;

        Ok(Self {
            agent_did: identity.did,
            action,
            entity_ids,
            parent_ids,
            metadata,
            signed_envelope,
        })
    }

    /// Verify this provenance entry: signature AND outer field integrity.
    ///
    /// Checks that:
    /// 1. The signature is valid for the given identity
    /// 2. The outer fields (agent_did, action, entity_ids, parent_ids, metadata)
    ///    match what was actually signed in the envelope payload
    ///
    /// This prevents tampering with outer fields after signing.
    pub fn verify(&self, identity: &crate::AgentIdentity) -> Result<(), CryptoError> {
        // 1. Verify the cryptographic signature
        self.signed_envelope.verify(identity)?;

        // 2. Verify outer fields match the signed payload
        let payload = &self.signed_envelope.payload;

        if payload.get("agent_did").and_then(|v| v.as_str()) != Some(&self.agent_did) {
            return Err(CryptoError::IntegrityMismatch("agent_did".into()));
        }

        // Compare action: serialize both to JSON for consistent comparison
        let signed_action = payload.get("action");
        let outer_action = serde_json::to_value(&self.action).ok();
        if signed_action != outer_action.as_ref() {
            return Err(CryptoError::IntegrityMismatch("action".into()));
        }

        let signed_entities = payload.get("entity_ids");
        let outer_entities = serde_json::to_value(&self.entity_ids).ok();
        if signed_entities != outer_entities.as_ref() {
            return Err(CryptoError::IntegrityMismatch("entity_ids".into()));
        }

        let signed_parents = payload.get("parent_ids");
        let outer_parents = serde_json::to_value(&self.parent_ids).ok();
        if signed_parents != outer_parents.as_ref() {
            return Err(CryptoError::IntegrityMismatch("parent_ids".into()));
        }

        if payload.get("metadata") != Some(&self.metadata) {
            return Err(CryptoError::IntegrityMismatch("metadata".into()));
        }

        Ok(())
    }

    /// Verify only the cryptographic signature, without checking field integrity.
    ///
    /// Use `verify()` instead unless you have a specific reason to skip integrity checks.
    pub fn verify_signature_only(
        &self,
        identity: &crate::AgentIdentity,
    ) -> Result<(), CryptoError> {
        self.signed_envelope.verify(identity)
    }

    /// Get the content hash of this entry (usable as a parent_id for chaining).
    pub fn content_hash(&self) -> String {
        self.signed_envelope.content_hash()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_keypair() -> AgentKeyPair {
        AgentKeyPair::generate()
    }

    #[test]
    fn test_create_and_verify_provenance() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Merge,
            vec!["entity-1".into(), "entity-2".into()],
            vec![],
            serde_json::json!({"reason": "duplicate detected"}),
        )
        .unwrap();

        assert_eq!(entry.agent_did, kp.identity().did);
        assert_eq!(entry.action, ActionType::Merge);
        assert_eq!(entry.entity_ids.len(), 2);
        assert!(entry.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_provenance_chaining() {
        let kp = test_keypair();

        let entry1 = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        let entry2 = ProvenanceEntry::create(
            &kp,
            ActionType::Merge,
            vec!["entity-1".into(), "entity-2".into()],
            vec![entry1.content_hash()],
            serde_json::json!({}),
        )
        .unwrap();

        assert_eq!(entry2.parent_ids.len(), 1);
        assert_eq!(entry2.parent_ids[0], entry1.content_hash());
        assert!(entry2.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_tampered_entity_ids_fails_verify() {
        let kp = test_keypair();
        let mut entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        entry.entity_ids = vec!["entity-999".into()];

        // verify() catches the tampered outer field
        assert!(matches!(
            entry.verify(&kp.identity()),
            Err(CryptoError::IntegrityMismatch(ref field)) if field == "entity_ids"
        ));

        // verify_signature_only() still passes (signature is valid)
        assert!(entry.verify_signature_only(&kp.identity()).is_ok());
    }

    #[test]
    fn test_tampered_agent_did_fails_verify() {
        let kp = test_keypair();
        let mut entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        entry.agent_did = "did:agent:tampered".into();

        assert!(matches!(
            entry.verify(&kp.identity()),
            Err(CryptoError::IntegrityMismatch(ref field)) if field == "agent_did"
        ));
    }

    #[test]
    fn test_tampered_action_fails_verify() {
        let kp = test_keypair();
        let mut entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        entry.action = ActionType::Merge;

        assert!(matches!(
            entry.verify(&kp.identity()),
            Err(CryptoError::IntegrityMismatch(ref field)) if field == "action"
        ));
    }

    #[test]
    fn test_tampered_metadata_fails_verify() {
        let kp = test_keypair();
        let mut entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({"original": true}),
        )
        .unwrap();

        entry.metadata = serde_json::json!({"tampered": true});

        assert!(matches!(
            entry.verify(&kp.identity()),
            Err(CryptoError::IntegrityMismatch(ref field)) if field == "metadata"
        ));
    }

    #[test]
    fn test_action_type_display() {
        assert_eq!(ActionType::Resolve.to_string(), "resolve");
        assert_eq!(ActionType::Merge.to_string(), "merge");
        assert_eq!(ActionType::Split.to_string(), "split");
        assert_eq!(ActionType::Custom("test".into()).to_string(), "custom:test");
    }

    #[test]
    fn test_action_type_serialization() {
        let action = ActionType::Merge;
        let json = serde_json::to_string(&action).unwrap();
        assert_eq!(json, "\"merge\"");

        let deserialized: ActionType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ActionType::Merge);
    }

    #[test]
    fn test_provenance_serialization() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Ingest,
            vec!["e1".into()],
            vec![],
            serde_json::json!({"source": "crm"}),
        )
        .unwrap();

        let json = serde_json::to_string(&entry).unwrap();
        let restored: ProvenanceEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.agent_did, entry.agent_did);
        assert_eq!(restored.action, entry.action);
        assert!(restored.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_content_hash_deterministic() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["e1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        let h1 = entry.content_hash();
        let h2 = entry.content_hash();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 = 32 bytes = 64 hex chars
    }

    #[test]
    fn test_cross_agent_verification() {
        let kp_a = test_keypair();
        let kp_b = test_keypair();

        let entry = ProvenanceEntry::create(
            &kp_a,
            ActionType::Delegate,
            vec![],
            vec![],
            serde_json::json!({"delegated_to": kp_b.identity().did}),
        )
        .unwrap();

        // Agent A's identity verifies
        assert!(entry.verify(&kp_a.identity()).is_ok());
        // Agent B's identity does not
        assert!(entry.verify(&kp_b.identity()).is_err());
    }

    #[test]
    fn test_all_action_types_serialize_roundtrip() {
        let actions = vec![
            ActionType::Resolve,
            ActionType::Merge,
            ActionType::Split,
            ActionType::Mutate,
            ActionType::Ingest,
            ActionType::Delegate,
            ActionType::Revoke,
            ActionType::Custom("my_action".into()),
        ];
        for action in actions {
            let json = serde_json::to_string(&action).unwrap();
            let restored: ActionType = serde_json::from_str(&json).unwrap();
            assert_eq!(restored, action, "Roundtrip failed for {:?}", action);
        }
    }

    #[test]
    fn test_all_action_types_display() {
        assert_eq!(ActionType::Mutate.to_string(), "mutate");
        assert_eq!(ActionType::Ingest.to_string(), "ingest");
        assert_eq!(ActionType::Delegate.to_string(), "delegate");
        assert_eq!(ActionType::Revoke.to_string(), "revoke");
    }

    #[test]
    fn test_provenance_empty_entity_list() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec![],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        assert!(entry.entity_ids.is_empty());
        assert!(entry.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_provenance_custom_action() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Custom("audit_review".into()),
            vec!["e1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        assert_eq!(entry.action, ActionType::Custom("audit_review".into()));
        assert!(entry.verify(&kp.identity()).is_ok());

        let json = serde_json::to_string(&entry).unwrap();
        let restored: ProvenanceEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.action, ActionType::Custom("audit_review".into()));
    }

    #[test]
    fn test_provenance_multi_parent_chaining() {
        let kp = test_keypair();

        let e1 = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["a".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        let e2 = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["b".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        let e3 = ProvenanceEntry::create(
            &kp,
            ActionType::Merge,
            vec!["a".into(), "b".into()],
            vec![e1.content_hash(), e2.content_hash()],
            serde_json::json!({"merge_of": ["a", "b"]}),
        )
        .unwrap();

        assert_eq!(e3.parent_ids.len(), 2);
        assert!(e3.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_different_entries_different_content_hashes() {
        let kp = test_keypair();

        let e1 = ProvenanceEntry::create(
            &kp,
            ActionType::Resolve,
            vec!["entity-1".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        let e2 = ProvenanceEntry::create(
            &kp,
            ActionType::Merge,
            vec!["entity-2".into()],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        assert_ne!(e1.content_hash(), e2.content_hash());
    }

    #[test]
    fn test_provenance_metadata_preserved() {
        let kp = test_keypair();
        let meta = serde_json::json!({
            "source": "crm",
            "confidence": 0.95,
            "tags": ["duplicate", "auto-merged"]
        });
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Merge,
            vec!["e1".into(), "e2".into()],
            vec![],
            meta.clone(),
        )
        .unwrap();

        assert_eq!(entry.metadata, meta);
        assert_eq!(entry.signed_envelope.payload["metadata"], meta);
    }

    #[test]
    fn test_provenance_agent_did_matches_keypair() {
        let kp = test_keypair();
        let entry = ProvenanceEntry::create(
            &kp,
            ActionType::Ingest,
            vec![],
            vec![],
            serde_json::json!({}),
        )
        .unwrap();

        assert_eq!(entry.agent_did, kp.identity().did);
        assert_eq!(
            entry.signed_envelope.payload["agent_did"].as_str().unwrap(),
            kp.identity().did
        );
        assert_eq!(entry.signed_envelope.signer_did, kp.identity().did);
    }
}
