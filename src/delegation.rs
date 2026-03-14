//! Cryptographic delegation with attenuated capabilities.
//!
//! Implements Macaroon-style delegation where an agent can grant another agent
//! a subset of its authority, with constraints (caveats). Delegations chain:
//! Agent A delegates to B, who delegates to C, each adding restrictions.
//! Verification walks the chain back to the root, checking every signature
//! and every caveat. No server calls required.
//!
//! # Concepts
//!
//! - **Delegation**: "I grant you power X with restrictions Y" (reusable)
//! - **Invocation**: "I'm using power X, here's my proof" (single-use action)
//! - **Caveat**: A constraint on what the delegated power can do
//! - **Chain**: A linked list of delegations from invoker back to root authority

use serde::{Deserialize, Serialize};

use crate::identity::{AgentIdentity, AgentKeyPair};
use crate::signing::SignedMessage;
use crate::CryptoError;

/// A constraint on delegated authority.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum Caveat {
    /// Restrict to specific actions (e.g. ["resolve", "search"]).
    #[serde(rename = "action_scope")]
    ActionScope(Vec<String>),

    /// Delegation expires at this RFC 3339 timestamp.
    #[serde(rename = "expires_at")]
    ExpiresAt(String),

    /// Maximum cost ceiling for the delegated operation.
    #[serde(rename = "max_cost")]
    MaxCost(f64),

    /// Resource pattern the delegation applies to (glob-style).
    /// E.g. "entity:customer:*", "source:crm:*"
    #[serde(rename = "resource")]
    Resource(String),

    /// Restrict to a specific context (e.g. task_id, session_id).
    #[serde(rename = "context")]
    Context { key: String, value: String },

    /// Arbitrary user-defined caveat.
    #[serde(rename = "custom")]
    Custom {
        key: String,
        value: serde_json::Value,
    },
}

/// A cryptographic delegation of authority from one agent to another.
///
/// Delegations form a chain: each delegation optionally references a parent
/// delegation that granted the issuer their authority. The chain terminates
/// at the root authority (who needs no parent delegation).
/// Maximum delegation chain depth to prevent DoS via deeply nested chains.
pub const MAX_CHAIN_DEPTH: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delegation {
    /// DID of the agent granting authority
    pub issuer_did: String,
    /// DID of the agent receiving authority
    pub delegate_did: String,
    /// Issuer's public key bytes (for self-verifying chains without key resolver)
    pub issuer_public_key: Vec<u8>,
    /// Constraints on the delegated authority
    pub caveats: Vec<Caveat>,
    /// Parent delegation proving the issuer's authority (None for root)
    pub parent_proof: Option<Box<Delegation>>,
    /// Cryptographic proof (signed by issuer)
    pub proof: SignedMessage,
}

impl Delegation {
    /// Create and sign a new root delegation (no parent).
    ///
    /// The issuer is the root authority and does not need a parent delegation.
    pub fn create_root(
        issuer_keypair: &AgentKeyPair,
        delegate_did: &str,
        caveats: Vec<Caveat>,
    ) -> Result<Self, CryptoError> {
        let issuer_identity = issuer_keypair.identity();
        Self::create_inner(
            issuer_keypair,
            &issuer_identity.did,
            delegate_did,
            caveats,
            None,
        )
    }

    /// Create and sign a delegated delegation (with parent chain).
    ///
    /// The issuer must have been granted authority via the parent delegation.
    /// Additional caveats can only narrow the authority, never widen it.
    pub fn delegate(
        issuer_keypair: &AgentKeyPair,
        delegate_did: &str,
        additional_caveats: Vec<Caveat>,
        parent: Delegation,
    ) -> Result<Self, CryptoError> {
        let issuer_identity = issuer_keypair.identity();

        // Issuer must be the delegate of the parent delegation
        if parent.delegate_did != issuer_identity.did {
            return Err(CryptoError::DelegationChainBroken(
                "issuer is not the delegate of parent delegation".into(),
            ));
        }

        // Merge parent caveats with additional caveats (union of restrictions)
        let mut all_caveats = parent.caveats.clone();
        all_caveats.extend(additional_caveats);

        Self::create_inner(
            issuer_keypair,
            &issuer_identity.did,
            delegate_did,
            all_caveats,
            Some(Box::new(parent)),
        )
    }

    fn create_inner(
        issuer_keypair: &AgentKeyPair,
        issuer_did: &str,
        delegate_did: &str,
        caveats: Vec<Caveat>,
        parent: Option<Box<Delegation>>,
    ) -> Result<Self, CryptoError> {
        // Check chain depth limit
        if let Some(ref p) = parent {
            if p.depth() >= MAX_CHAIN_DEPTH {
                return Err(CryptoError::DelegationChainBroken(format!(
                    "chain depth exceeds maximum of {}",
                    MAX_CHAIN_DEPTH
                )));
            }
        }

        let issuer_identity = issuer_keypair.identity();
        let parent_hash = parent.as_ref().map(|p| p.proof.content_hash());

        let payload = serde_json::json!({
            "issuer_did": issuer_did,
            "delegate_did": delegate_did,
            "caveats": caveats,
            "parent_hash": parent_hash,
        });

        let proof = SignedMessage::sign(issuer_keypair, payload)?;

        Ok(Self {
            issuer_did: issuer_did.to_string(),
            delegate_did: delegate_did.to_string(),
            issuer_public_key: issuer_identity.public_key_bytes.clone(),
            caveats,
            parent_proof: parent,
            proof,
        })
    }

    /// Get the chain depth (0 for root, 1 for first delegation, etc.)
    pub fn depth(&self) -> usize {
        let mut depth = 0;
        let mut current = self;
        while let Some(ref parent) = current.parent_proof {
            depth += 1;
            current = parent;
        }
        depth
    }
}

/// An invocation: an agent exercising delegated authority.
///
/// Combines the action being performed with the delegation chain
/// that proves the agent has authority to perform it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invocation {
    /// DID of the agent performing the action
    pub invoker_did: String,
    /// The action being performed
    pub action: String,
    /// Action arguments / context
    pub args: serde_json::Value,
    /// The delegation chain proving authority
    pub delegation: Delegation,
    /// Cryptographic proof (signed by invoker)
    pub proof: SignedMessage,
}

impl Invocation {
    /// Create and sign an invocation.
    ///
    /// The invoker must be the delegate of the delegation.
    pub fn create(
        invoker_keypair: &AgentKeyPair,
        action: &str,
        args: serde_json::Value,
        delegation: Delegation,
    ) -> Result<Self, CryptoError> {
        let invoker_identity = invoker_keypair.identity();

        if delegation.delegate_did != invoker_identity.did {
            return Err(CryptoError::DelegationChainBroken(
                "invoker is not the delegate of the delegation".into(),
            ));
        }

        let payload = serde_json::json!({
            "invoker_did": invoker_identity.did,
            "action": action,
            "args": args,
            "delegation_hash": delegation.proof.content_hash(),
        });

        let proof = SignedMessage::sign(invoker_keypair, payload)?;

        Ok(Self {
            invoker_did: invoker_identity.did,
            action: action.to_string(),
            args,
            delegation,
            proof,
        })
    }
}

/// Result of a successful verification, containing the full authority chain.
#[derive(Debug)]
pub struct VerificationResult {
    /// The invoker's DID
    pub invoker_did: String,
    /// The root authority's DID
    pub root_did: String,
    /// The chain of DIDs from invoker back to root
    pub chain: Vec<String>,
    /// The chain depth
    pub depth: usize,
}

/// Verify an invocation's entire authority chain (no revocation check).
///
/// For revocation support, use `verify_invocation_with_revocation` instead.
pub fn verify_invocation(
    invocation: &Invocation,
    invoker_identity: &AgentIdentity,
    root_identity: &AgentIdentity,
) -> Result<VerificationResult, CryptoError> {
    verify_invocation_with_revocation(invocation, invoker_identity, root_identity, |_| false)
}

/// Verify an invocation's entire authority chain with optional revocation check.
///
/// Checks:
/// 1. Invocation signature is valid for the invoker
/// 2. Invoker is the delegate of the delegation
/// 3. **Every** delegation signature is verified (using embedded public keys)
/// 4. Each delegation's issuer is the delegate of its parent
/// 5. Embedded public keys match their DIDs
/// 6. No delegation in the chain has been revoked
/// 7. The chain terminates at the expected root authority
/// 8. All caveats are satisfied for the invoked action
///
/// The `is_revoked` callback receives a delegation's content hash and returns
/// `true` if that delegation has been revoked. Use `|_| false` to skip
/// revocation checks, or provide a lookup against your revocation service.
pub fn verify_invocation_with_revocation(
    invocation: &Invocation,
    invoker_identity: &AgentIdentity,
    root_identity: &AgentIdentity,
    is_revoked: impl Fn(&str) -> bool,
) -> Result<VerificationResult, CryptoError> {
    // 1. Verify invocation signature
    invocation.proof.verify(invoker_identity)?;

    // 2. Verify invoker matches delegation delegate
    if invocation.invoker_did != invocation.delegation.delegate_did {
        return Err(CryptoError::DelegationChainBroken(
            "invoker is not the delegate of the delegation".into(),
        ));
    }

    // 3. Walk and verify the full delegation chain
    let mut chain = vec![invocation.invoker_did.clone()];
    let mut current = &invocation.delegation;
    let mut all_caveats: Vec<Caveat> = Vec::new();
    let mut steps = 0usize;

    loop {
        steps += 1;
        if steps > MAX_CHAIN_DEPTH {
            return Err(CryptoError::DelegationChainBroken(format!(
                "chain depth exceeds maximum of {}",
                MAX_CHAIN_DEPTH
            )));
        }

        chain.push(current.issuer_did.clone());

        // Reconstruct issuer identity from embedded public key
        let issuer_identity =
            AgentIdentity::from_bytes(&current.issuer_public_key).map_err(|_| {
                CryptoError::DelegationChainBroken(format!(
                    "invalid embedded public key for '{}'",
                    current.issuer_did
                ))
            })?;

        // Verify the embedded public key matches the claimed DID
        if issuer_identity.did != current.issuer_did {
            return Err(CryptoError::DelegationChainBroken(format!(
                "embedded public key produces DID '{}' but delegation claims '{}'",
                issuer_identity.did, current.issuer_did
            )));
        }

        // Verify this delegation's signature using the embedded public key
        current.proof.verify(&issuer_identity)?;

        // Check if this delegation has been revoked
        let delegation_hash = current.proof.content_hash();
        if is_revoked(&delegation_hash) {
            return Err(CryptoError::DelegationRevoked(delegation_hash));
        }

        // Extract caveats from the SIGNED PAYLOAD (not outer fields) to prevent tampering
        if let Some(signed_caveats) = current.proof.payload.get("caveats") {
            if let Ok(caveats) = serde_json::from_value::<Vec<Caveat>>(signed_caveats.clone()) {
                all_caveats.extend(caveats);
            }
        }

        // Check chain linkage
        if current.issuer_did == root_identity.did {
            // Reached root - verify it matches the expected root identity
            if issuer_identity.public_key_bytes != root_identity.public_key_bytes {
                return Err(CryptoError::DelegationChainBroken(
                    "root public key mismatch".into(),
                ));
            }
            break;
        }

        // Not root - must have a parent proof
        match &current.parent_proof {
            Some(parent) => {
                if parent.delegate_did != current.issuer_did {
                    return Err(CryptoError::DelegationChainBroken(format!(
                        "delegation issuer '{}' is not the delegate of parent delegation '{}'",
                        current.issuer_did, parent.delegate_did
                    )));
                }
                current = parent;
            }
            None => {
                return Err(CryptoError::DelegationChainBroken(format!(
                    "chain terminates at '{}', expected root '{}'",
                    current.issuer_did, root_identity.did
                )));
            }
        }
    }

    // 4. Check all caveats (from signed payloads) against the invocation
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    for caveat in &all_caveats {
        check_caveat(caveat, &invocation.action, &invocation.args, &now)?;
    }

    let depth = chain.len() - 1;
    Ok(VerificationResult {
        invoker_did: invocation.invoker_did.clone(),
        root_did: root_identity.did.clone(),
        chain,
        depth,
    })
}

/// Verify a delegation chain without an invocation (no revocation check).
pub fn verify_delegation_chain(
    delegation: &Delegation,
    root_identity: &AgentIdentity,
) -> Result<Vec<String>, CryptoError> {
    verify_delegation_chain_with_revocation(delegation, root_identity, |_| false)
}

/// Verify a delegation chain with optional revocation check.
///
/// Verifies every signature in the chain using embedded public keys.
pub fn verify_delegation_chain_with_revocation(
    delegation: &Delegation,
    root_identity: &AgentIdentity,
    is_revoked: impl Fn(&str) -> bool,
) -> Result<Vec<String>, CryptoError> {
    let mut chain = Vec::new();
    let mut current = delegation;
    let mut steps = 0usize;

    loop {
        steps += 1;
        if steps > MAX_CHAIN_DEPTH {
            return Err(CryptoError::DelegationChainBroken(format!(
                "chain depth exceeds maximum of {}",
                MAX_CHAIN_DEPTH
            )));
        }

        chain.push(current.delegate_did.clone());
        chain.push(current.issuer_did.clone());

        // Verify signature using embedded public key
        let issuer_identity =
            AgentIdentity::from_bytes(&current.issuer_public_key).map_err(|_| {
                CryptoError::DelegationChainBroken(format!(
                    "invalid embedded public key for '{}'",
                    current.issuer_did
                ))
            })?;

        if issuer_identity.did != current.issuer_did {
            return Err(CryptoError::DelegationChainBroken(format!(
                "embedded public key produces DID '{}' but delegation claims '{}'",
                issuer_identity.did, current.issuer_did
            )));
        }

        current.proof.verify(&issuer_identity)?;

        let delegation_hash = current.proof.content_hash();
        if is_revoked(&delegation_hash) {
            return Err(CryptoError::DelegationRevoked(delegation_hash));
        }

        if current.issuer_did == root_identity.did {
            if issuer_identity.public_key_bytes != root_identity.public_key_bytes {
                return Err(CryptoError::DelegationChainBroken(
                    "root public key mismatch".into(),
                ));
            }
            break;
        }

        match &current.parent_proof {
            Some(parent) => {
                if parent.delegate_did != current.issuer_did {
                    return Err(CryptoError::DelegationChainBroken(
                        "chain linkage broken: issuer not delegate of parent".into(),
                    ));
                }
                current = parent;
            }
            None => {
                return Err(CryptoError::DelegationChainBroken(format!(
                    "chain terminates at '{}', expected root '{}'",
                    current.issuer_did, root_identity.did
                )));
            }
        }
    }

    chain.dedup();
    Ok(chain)
}

fn check_caveat(
    caveat: &Caveat,
    action: &str,
    args: &serde_json::Value,
    now: &str,
) -> Result<(), CryptoError> {
    match caveat {
        Caveat::ActionScope(allowed) => {
            if !allowed.iter().any(|a| a == action) {
                return Err(CryptoError::CaveatViolation(format!(
                    "action '{}' not in allowed scope {:?}",
                    action, allowed
                )));
            }
        }
        Caveat::ExpiresAt(expiry) => {
            if now > expiry.as_str() {
                return Err(CryptoError::CaveatViolation(format!(
                    "delegation expired at {}",
                    expiry
                )));
            }
        }
        Caveat::MaxCost(max) => match args.get("cost").and_then(|v| v.as_f64()) {
            Some(cost) if cost > *max => {
                return Err(CryptoError::CaveatViolation(format!(
                    "cost {} exceeds max {}",
                    cost, max
                )));
            }
            None => {
                return Err(CryptoError::CaveatViolation(
                    "max_cost caveat requires 'cost' field in args".into(),
                ));
            }
            _ => {}
        },
        Caveat::Resource(pattern) => match args.get("resource").and_then(|v| v.as_str()) {
            Some(resource) if !matches_glob(pattern, resource) => {
                return Err(CryptoError::CaveatViolation(format!(
                    "resource '{}' does not match pattern '{}'",
                    resource, pattern
                )));
            }
            None => {
                return Err(CryptoError::CaveatViolation(
                    "resource caveat requires 'resource' field in args".into(),
                ));
            }
            _ => {}
        },
        Caveat::Context { key, value } => {
            let actual = args.get(key).and_then(|v| v.as_str());
            if actual != Some(value.as_str()) {
                return Err(CryptoError::CaveatViolation(format!(
                    "context '{}' expected '{}', got '{}'",
                    key,
                    value,
                    actual.unwrap_or("<missing>")
                )));
            }
        }
        Caveat::Custom { key, value } => {
            let actual = args.get(key);
            if actual != Some(value) {
                return Err(CryptoError::CaveatViolation(format!(
                    "custom caveat '{}' not satisfied",
                    key
                )));
            }
        }
    }
    Ok(())
}

/// Simple glob matching: supports trailing * only.
/// E.g. "entity:customer:*" matches "entity:customer:123"
fn matches_glob(pattern: &str, value: &str) -> bool {
    if let Some(prefix) = pattern.strip_suffix('*') {
        value.starts_with(prefix)
    } else {
        pattern == value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> AgentKeyPair {
        AgentKeyPair::generate()
    }

    // --- Delegation creation ---

    #[test]
    fn test_root_delegation() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into(), "search".into()])],
        )
        .unwrap();

        assert_eq!(delegation.issuer_did, root.identity().did);
        assert_eq!(delegation.delegate_did, agent_b.identity().did);
        assert_eq!(delegation.depth(), 0);
        assert!(delegation.parent_proof.is_none());
    }

    #[test]
    fn test_chained_delegation() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let d1 = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into(), "search".into()])],
        )
        .unwrap();

        let d2 = Delegation::delegate(
            &agent_b,
            &agent_c.identity().did,
            vec![], // no additional restrictions
            d1,
        )
        .unwrap();

        assert_eq!(d2.issuer_did, agent_b.identity().did);
        assert_eq!(d2.delegate_did, agent_c.identity().did);
        assert_eq!(d2.depth(), 1);
        assert!(d2.parent_proof.is_some());
    }

    #[test]
    fn test_delegate_must_be_parent_delegate() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();
        let unrelated = keypair();

        let d1 = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        // Agent C tries to delegate using Agent B's delegation (but C is not B)
        let result = Delegation::delegate(&unrelated, &agent_c.identity().did, vec![], d1);
        assert!(result.is_err());
    }

    // --- Invocation ---

    #[test]
    fn test_invocation_basic() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let invocation = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"entity_id": "123"}),
            delegation,
        )
        .unwrap();

        assert_eq!(invocation.invoker_did, agent_b.identity().did);
        assert_eq!(invocation.action, "resolve");
    }

    #[test]
    fn test_invocation_must_be_delegation_delegate() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let delegation = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        // Agent C tries to invoke using Agent B's delegation
        let result = Invocation::create(&agent_c, "resolve", serde_json::json!({}), delegation);
        assert!(result.is_err());
    }

    // --- Verification ---

    #[test]
    fn test_verify_root_invocation() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity()).unwrap();

        assert_eq!(result.invoker_did, agent_b.identity().did);
        assert_eq!(result.root_did, root.identity().did);
        assert_eq!(result.depth, 1); // invoker -> root
    }

    #[test]
    fn test_verify_chained_invocation() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let d1 = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into(), "search".into()])],
        )
        .unwrap();

        let d2 = Delegation::delegate(
            &agent_b,
            &agent_c.identity().did,
            vec![], // inherit parent's caveats
            d1,
        )
        .unwrap();

        let invocation =
            Invocation::create(&agent_c, "resolve", serde_json::json!({}), d2).unwrap();

        let result = verify_invocation(&invocation, &agent_c.identity(), &root.identity()).unwrap();

        assert_eq!(result.invoker_did, agent_c.identity().did);
        assert_eq!(result.root_did, root.identity().did);
        assert_eq!(result.depth, 2); // C -> B -> root
    }

    #[test]
    fn test_verify_wrong_root_fails() {
        let root = keypair();
        let agent_b = keypair();
        let fake_root = keypair();

        let delegation = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &fake_root.identity());
        assert!(result.is_err());
    }

    // --- Caveat enforcement ---

    #[test]
    fn test_action_scope_caveat_passes() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into(), "search".into()])],
        )
        .unwrap();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        assert!(verify_invocation(&invocation, &agent_b.identity(), &root.identity()).is_ok());
    }

    #[test]
    fn test_action_scope_caveat_blocks() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let invocation = Invocation::create(
            &agent_b,
            "merge", // not in allowed scope
            serde_json::json!({}),
            delegation,
        )
        .unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_expires_at_caveat_blocks() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ExpiresAt("2020-01-01T00:00:00.000Z".into())],
        )
        .unwrap();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_max_cost_caveat_passes() {
        let root = keypair();
        let agent_b = keypair();

        let delegation =
            Delegation::create_root(&root, &agent_b.identity().did, vec![Caveat::MaxCost(5.0)])
                .unwrap();

        let invocation = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"cost": 3.50}),
            delegation,
        )
        .unwrap();

        assert!(verify_invocation(&invocation, &agent_b.identity(), &root.identity()).is_ok());
    }

    #[test]
    fn test_max_cost_caveat_blocks() {
        let root = keypair();
        let agent_b = keypair();

        let delegation =
            Delegation::create_root(&root, &agent_b.identity().did, vec![Caveat::MaxCost(5.0)])
                .unwrap();

        let invocation = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"cost": 10.0}),
            delegation,
        )
        .unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_resource_caveat_glob() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::Resource("entity:customer:*".into())],
        )
        .unwrap();

        // Matching resource
        let inv_ok = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"resource": "entity:customer:123"}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_invocation(&inv_ok, &agent_b.identity(), &root.identity()).is_ok());

        // Non-matching resource
        let inv_bad = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"resource": "entity:order:456"}),
            delegation,
        )
        .unwrap();
        let result = verify_invocation(&inv_bad, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_context_caveat() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::Context {
                key: "task_id".into(),
                value: "task-abc".into(),
            }],
        )
        .unwrap();

        // Correct context
        let inv_ok = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"task_id": "task-abc"}),
            delegation.clone(),
        )
        .unwrap();
        assert!(verify_invocation(&inv_ok, &agent_b.identity(), &root.identity()).is_ok());

        // Wrong context
        let inv_bad = Invocation::create(
            &agent_b,
            "resolve",
            serde_json::json!({"task_id": "task-xyz"}),
            delegation,
        )
        .unwrap();
        assert!(matches!(
            verify_invocation(&inv_bad, &agent_b.identity(), &root.identity()),
            Err(CryptoError::CaveatViolation(_))
        ));
    }

    #[test]
    fn test_attenuation_narrows_not_widens() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        // Root gives B: resolve + search
        let d1 = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into(), "search".into()])],
        )
        .unwrap();

        // B gives C: only resolve (narrower)
        let d2 = Delegation::delegate(
            &agent_b,
            &agent_c.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
            d1,
        )
        .unwrap();

        // C tries to search - blocked by C's caveat
        let inv = Invocation::create(&agent_c, "search", serde_json::json!({}), d2).unwrap();

        let result = verify_invocation(&inv, &agent_c.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_three_level_chain() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();
        let agent_d = keypair();

        let d1 = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let d2 = Delegation::delegate(&agent_b, &agent_c.identity().did, vec![], d1).unwrap();

        let d3 = Delegation::delegate(&agent_c, &agent_d.identity().did, vec![], d2).unwrap();

        let inv = Invocation::create(&agent_d, "resolve", serde_json::json!({}), d3).unwrap();

        let result = verify_invocation(&inv, &agent_d.identity(), &root.identity()).unwrap();
        assert_eq!(result.depth, 3); // D -> C -> B -> root
    }

    #[test]
    fn test_verify_delegation_chain() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let d1 = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        let d2 = Delegation::delegate(&agent_b, &agent_c.identity().did, vec![], d1).unwrap();

        let chain = verify_delegation_chain(&d2, &root.identity()).unwrap();
        assert!(chain.contains(&root.identity().did));
        assert!(chain.contains(&agent_b.identity().did));
        assert!(chain.contains(&agent_c.identity().did));
    }

    #[test]
    fn test_delegation_serialization_roundtrip() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![
                Caveat::ActionScope(vec!["resolve".into()]),
                Caveat::ExpiresAt("2030-01-01T00:00:00.000Z".into()),
                Caveat::MaxCost(10.0),
            ],
        )
        .unwrap();

        let json = serde_json::to_string(&delegation).unwrap();
        let restored: Delegation = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.issuer_did, delegation.issuer_did);
        assert_eq!(restored.delegate_did, delegation.delegate_did);
        assert_eq!(restored.caveats.len(), 3);
    }

    #[test]
    fn test_caveat_serialization_roundtrip() {
        let caveats = vec![
            Caveat::ActionScope(vec!["resolve".into(), "search".into()]),
            Caveat::ExpiresAt("2030-01-01T00:00:00.000Z".into()),
            Caveat::MaxCost(5.0),
            Caveat::Resource("entity:*".into()),
            Caveat::Context {
                key: "task_id".into(),
                value: "t1".into(),
            },
            Caveat::Custom {
                key: "org".into(),
                value: serde_json::json!("acme"),
            },
        ];

        for caveat in &caveats {
            let json = serde_json::to_string(caveat).unwrap();
            let restored: Caveat = serde_json::from_str(&json).unwrap();
            assert_eq!(&restored, caveat, "Roundtrip failed for {:?}", caveat);
        }
    }

    #[test]
    fn test_glob_matching() {
        assert!(matches_glob("entity:*", "entity:customer:123"));
        assert!(matches_glob("entity:customer:*", "entity:customer:123"));
        assert!(!matches_glob("entity:customer:*", "entity:order:456"));
        assert!(matches_glob("exact", "exact"));
        assert!(!matches_glob("exact", "other"));
        assert!(matches_glob("*", "anything"));
    }

    #[test]
    fn test_max_cost_missing_field_fails() {
        let root = keypair();
        let agent_b = keypair();

        let delegation =
            Delegation::create_root(&root, &agent_b.identity().did, vec![Caveat::MaxCost(5.0)])
                .unwrap();

        // No cost field in args - should fail (not silently pass)
        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_resource_missing_field_fails() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::Resource("entity:*".into())],
        )
        .unwrap();

        // No resource field in args - should fail
        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_embedded_public_key_present() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        assert_eq!(
            delegation.issuer_public_key,
            root.identity().public_key_bytes
        );
    }

    #[test]
    fn test_tampered_delegation_caveats_detected() {
        let root = keypair();
        let agent_b = keypair();

        let mut delegation = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        // Tamper with outer caveats to widen scope
        delegation.caveats = vec![Caveat::ActionScope(vec!["resolve".into(), "merge".into()])];

        let invocation =
            Invocation::create(&agent_b, "merge", serde_json::json!({}), delegation).unwrap();

        // Should fail because verification reads caveats from signed payload,
        // not from the tampered outer field
        let result = verify_invocation(&invocation, &agent_b.identity(), &root.identity());
        assert!(matches!(result, Err(CryptoError::CaveatViolation(_))));
    }

    #[test]
    fn test_intermediate_signature_verified() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let d1 = Delegation::create_root(
            &root,
            &agent_b.identity().did,
            vec![Caveat::ActionScope(vec!["resolve".into()])],
        )
        .unwrap();

        let mut d2 = Delegation::delegate(&agent_b, &agent_c.identity().did, vec![], d1).unwrap();

        // Tamper with d2's proof signature (corrupt it)
        d2.proof.signature = "00".repeat(64);

        let invocation =
            Invocation::create(&agent_c, "resolve", serde_json::json!({}), d2).unwrap();

        // Should fail because B's delegation signature is now verified
        let result = verify_invocation(&invocation, &agent_c.identity(), &root.identity());
        assert!(result.is_err());
    }

    // --- Revocation ---

    #[test]
    fn test_revocation_blocks_invocation() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        let revoked_hash = delegation.proof.content_hash();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        // Without revocation - passes
        assert!(verify_invocation(&invocation, &agent_b.identity(), &root.identity()).is_ok());

        // With revocation - fails
        let result = verify_invocation_with_revocation(
            &invocation,
            &agent_b.identity(),
            &root.identity(),
            |hash| hash == revoked_hash,
        );
        assert!(matches!(result, Err(CryptoError::DelegationRevoked(_))));
    }

    #[test]
    fn test_revocation_in_chain_blocks() {
        let root = keypair();
        let agent_b = keypair();
        let agent_c = keypair();

        let d1 = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        let revoked_hash = d1.proof.content_hash();

        let d2 = Delegation::delegate(&agent_b, &agent_c.identity().did, vec![], d1).unwrap();

        let invocation =
            Invocation::create(&agent_c, "resolve", serde_json::json!({}), d2).unwrap();

        // Revoking the root delegation blocks the entire chain
        let result = verify_invocation_with_revocation(
            &invocation,
            &agent_c.identity(),
            &root.identity(),
            |hash| hash == revoked_hash,
        );
        assert!(matches!(result, Err(CryptoError::DelegationRevoked(_))));
    }

    #[test]
    fn test_no_revocation_callback_passes() {
        let root = keypair();
        let agent_b = keypair();

        let delegation = Delegation::create_root(&root, &agent_b.identity().did, vec![]).unwrap();

        let invocation =
            Invocation::create(&agent_b, "resolve", serde_json::json!({}), delegation).unwrap();

        // Default (no revocation) always passes
        let result = verify_invocation_with_revocation(
            &invocation,
            &agent_b.identity(),
            &root.identity(),
            |_| false,
        );
        assert!(result.is_ok());
    }
}
