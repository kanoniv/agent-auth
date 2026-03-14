//! Signed message envelopes with Ed25519 signatures.
//!
//! Provides tamper-proof message signing and verification using canonical
//! JSON serialization and nonce-based replay protection.

use ed25519_dalek::Signer;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::identity::{AgentIdentity, AgentKeyPair};
use crate::CryptoError;

/// A cryptographically signed message envelope.
///
/// Contains the payload, signer's DID, a nonce for replay protection,
/// timestamp, and the Ed25519 signature over the canonical representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage {
    /// The message payload (arbitrary JSON)
    pub payload: serde_json::Value,
    /// DID of the signer
    pub signer_did: String,
    /// Unique nonce for replay protection
    pub nonce: String,
    /// ISO 8601 timestamp
    pub timestamp: String,
    /// Hex-encoded Ed25519 signature
    pub signature: String,
}

impl SignedMessage {
    /// Sign a payload with the given keypair.
    pub fn sign(keypair: &AgentKeyPair, payload: serde_json::Value) -> Result<Self, CryptoError> {
        let identity = keypair.identity();
        let nonce = uuid::Uuid::new_v4().to_string();
        let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let canonical = canonical_bytes(&payload, &identity.did, &nonce, &timestamp)?;
        let signature = keypair.signing_key().sign(&canonical);
        let signature_hex = hex::encode(signature.to_bytes());

        Ok(Self {
            payload,
            signer_did: identity.did,
            nonce,
            timestamp,
            signature: signature_hex,
        })
    }

    /// Verify this message against a known public identity.
    ///
    /// Returns `Ok(())` if the signature is valid, `Err` otherwise.
    pub fn verify(&self, identity: &AgentIdentity) -> Result<(), CryptoError> {
        if self.signer_did != identity.did {
            return Err(CryptoError::SignatureInvalid);
        }

        let verifying_key = identity.verifying_key()?;
        let canonical = canonical_bytes(
            &self.payload,
            &self.signer_did,
            &self.nonce,
            &self.timestamp,
        )?;

        let sig_bytes = hex::decode(&self.signature)
            .map_err(|e| CryptoError::InvalidSignatureEncoding(e.to_string()))?;
        let sig_array: [u8; 64] = sig_bytes
            .try_into()
            .map_err(|_| CryptoError::InvalidSignatureEncoding("expected 64 bytes".into()))?;
        let signature = ed25519_dalek::Signature::from_bytes(&sig_array);

        ed25519_dalek::Verifier::verify(&verifying_key, &canonical, &signature)
            .map_err(|_| CryptoError::SignatureInvalid)
    }

    /// Compute the SHA-256 content hash of this signed message.
    ///
    /// Uses canonical field ordering (alphabetical) to ensure cross-language
    /// determinism: {nonce, payload, signature, signer_did, timestamp}.
    pub fn content_hash(&self) -> String {
        let mut map = std::collections::BTreeMap::new();
        map.insert("nonce", serde_json::json!(&self.nonce));
        map.insert("payload", self.payload.clone());
        map.insert("signature", serde_json::json!(&self.signature));
        map.insert("signer_did", serde_json::json!(&self.signer_did));
        map.insert("timestamp", serde_json::json!(&self.timestamp));
        let serialized = serde_json::to_string(&map).unwrap_or_default();
        let hash = Sha256::digest(serialized.as_bytes());
        hex::encode(hash)
    }
}

/// Produce the canonical byte representation for signing/verification.
///
/// Canonical form: sorted-key JSON of {nonce, payload, signer_did, timestamp}.
/// Only the top-level envelope keys are sorted. The payload is serialized as-is.
/// This ensures deterministic serialization regardless of insertion order.
pub(crate) fn canonical_bytes(
    payload: &serde_json::Value,
    signer_did: &str,
    nonce: &str,
    timestamp: &str,
) -> Result<Vec<u8>, CryptoError> {
    let mut map = std::collections::BTreeMap::new();
    map.insert("nonce", serde_json::json!(nonce));
    map.insert("payload", payload.clone());
    map.insert("signer_did", serde_json::json!(signer_did));
    map.insert("timestamp", serde_json::json!(timestamp));

    serde_json::to_vec(&map).map_err(|e| CryptoError::SerializationError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_keypair() -> AgentKeyPair {
        AgentKeyPair::generate()
    }

    #[test]
    fn test_sign_and_verify() {
        let kp = test_keypair();
        let payload = serde_json::json!({"action": "merge", "entity_id": "abc123"});
        let signed = SignedMessage::sign(&kp, payload).unwrap();

        let identity = kp.identity();
        assert!(signed.verify(&identity).is_ok());
    }

    #[test]
    fn test_tampered_payload_fails() {
        let kp = test_keypair();
        let payload = serde_json::json!({"action": "merge"});
        let mut signed = SignedMessage::sign(&kp, payload).unwrap();

        signed.payload = serde_json::json!({"action": "split"});

        let identity = kp.identity();
        assert!(signed.verify(&identity).is_err());
    }

    #[test]
    fn test_tampered_nonce_fails() {
        let kp = test_keypair();
        let payload = serde_json::json!({"data": "test"});
        let mut signed = SignedMessage::sign(&kp, payload).unwrap();

        signed.nonce = "tampered-nonce".to_string();

        let identity = kp.identity();
        assert!(signed.verify(&identity).is_err());
    }

    #[test]
    fn test_wrong_identity_fails() {
        let kp1 = test_keypair();
        let kp2 = test_keypair();
        let payload = serde_json::json!({"data": "test"});
        let signed = SignedMessage::sign(&kp1, payload).unwrap();

        let wrong_identity = kp2.identity();
        assert!(signed.verify(&wrong_identity).is_err());
    }

    #[test]
    fn test_nonce_is_unique() {
        let kp = test_keypair();
        let payload = serde_json::json!({"data": "test"});
        let s1 = SignedMessage::sign(&kp, payload.clone()).unwrap();
        let s2 = SignedMessage::sign(&kp, payload).unwrap();
        assert_ne!(s1.nonce, s2.nonce);
    }

    #[test]
    fn test_signature_is_hex_128_chars() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        assert_eq!(signed.signature.len(), 128); // 64 bytes = 128 hex chars
        assert!(signed.signature.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_signer_did_populated() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        assert!(signed.signer_did.starts_with("did:agent:"));
        assert_eq!(signed.signer_did, kp.identity().did);
    }

    #[test]
    fn test_timestamp_is_rfc3339() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        assert!(signed.timestamp.ends_with('Z'));
        chrono::DateTime::parse_from_rfc3339(&signed.timestamp).unwrap();
    }

    #[test]
    fn test_content_hash_deterministic() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({"x": 1})).unwrap();
        let h1 = signed.content_hash();
        let h2 = signed.content_hash();
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_serialization_roundtrip() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({"key": "value"})).unwrap();
        let json = serde_json::to_string(&signed).unwrap();
        let deserialized: SignedMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(signed.signer_did, deserialized.signer_did);
        assert_eq!(signed.nonce, deserialized.nonce);
        assert_eq!(signed.signature, deserialized.signature);

        let identity = kp.identity();
        assert!(deserialized.verify(&identity).is_ok());
    }

    #[test]
    fn test_invalid_signature_hex() {
        let kp = test_keypair();
        let mut signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        signed.signature = "not-hex!".to_string();

        let identity = kp.identity();
        assert!(matches!(
            signed.verify(&identity),
            Err(CryptoError::InvalidSignatureEncoding(_))
        ));
    }

    #[test]
    fn test_canonical_ordering_deterministic() {
        let payload = serde_json::json!({"z": 1, "a": 2, "m": 3});
        let b1 = canonical_bytes(&payload, "did:agent:test", "nonce1", "ts1").unwrap();
        let b2 = canonical_bytes(&payload, "did:agent:test", "nonce1", "ts1").unwrap();
        assert_eq!(b1, b2);
    }

    #[test]
    fn test_tampered_timestamp_fails() {
        let kp = test_keypair();
        let mut signed = SignedMessage::sign(&kp, serde_json::json!({"x": 1})).unwrap();
        signed.timestamp = "2020-01-01T00:00:00.000Z".to_string();

        let identity = kp.identity();
        assert!(signed.verify(&identity).is_err());
    }

    #[test]
    fn test_tampered_signer_did_fails() {
        let kp = test_keypair();
        let mut signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        signed.signer_did = "did:agent:0000000000000000000000000000fake".to_string();

        let identity = kp.identity();
        assert!(matches!(
            signed.verify(&identity),
            Err(CryptoError::SignatureInvalid)
        ));
    }

    #[test]
    fn test_empty_payload_sign_verify() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        assert!(signed.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_large_payload_sign_verify() {
        let kp = test_keypair();
        let large_array: Vec<i32> = (0..1000).collect();
        let payload = serde_json::json!({
            "records": large_array,
            "nested": {"deep": {"value": "test"}}
        });
        let signed = SignedMessage::sign(&kp, payload).unwrap();
        assert!(signed.verify(&kp.identity()).is_ok());
    }

    #[test]
    fn test_signature_wrong_length_fails() {
        let kp = test_keypair();
        let mut signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        signed.signature = "aa".repeat(32);

        let identity = kp.identity();
        assert!(matches!(
            signed.verify(&identity),
            Err(CryptoError::InvalidSignatureEncoding(_))
        ));
    }

    #[test]
    fn test_different_messages_different_content_hashes() {
        let kp = test_keypair();
        let s1 = SignedMessage::sign(&kp, serde_json::json!({"a": 1})).unwrap();
        let s2 = SignedMessage::sign(&kp, serde_json::json!({"a": 2})).unwrap();
        assert_ne!(s1.content_hash(), s2.content_hash());
    }

    #[test]
    fn test_content_hash_is_sha256_hex() {
        let kp = test_keypair();
        let signed = SignedMessage::sign(&kp, serde_json::json!({})).unwrap();
        let hash = signed.content_hash();
        assert_eq!(hash.len(), 64); // 32 bytes = 64 hex chars
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_canonical_bytes_different_payloads_differ() {
        let b1 = canonical_bytes(
            &serde_json::json!({"x": 1}),
            "did:agent:test",
            "nonce1",
            "ts1",
        )
        .unwrap();
        let b2 = canonical_bytes(
            &serde_json::json!({"x": 2}),
            "did:agent:test",
            "nonce1",
            "ts1",
        )
        .unwrap();
        assert_ne!(b1, b2);
    }

    #[test]
    fn test_canonical_bytes_different_nonces_differ() {
        let payload = serde_json::json!({"x": 1});
        let b1 = canonical_bytes(&payload, "did:agent:test", "nonce-a", "ts1").unwrap();
        let b2 = canonical_bytes(&payload, "did:agent:test", "nonce-b", "ts1").unwrap();
        assert_ne!(b1, b2);
    }

    #[test]
    fn test_crypto_error_display() {
        let err = CryptoError::InvalidKeyLength(16);
        assert!(err.to_string().contains("16"));
        assert!(err.to_string().contains("32"));

        let err = CryptoError::SignatureInvalid;
        assert!(err.to_string().contains("verification failed"));
    }
}
