//! Agent cryptographic identity - Ed25519 keypairs and `did:kanoniv:` identifiers.

use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::CryptoError;

/// An agent's Ed25519 keypair used for signing messages and proving identity.
pub struct AgentKeyPair {
    signing_key: SigningKey,
}

/// Public identity derived from a keypair - safe to share and store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentIdentity {
    /// Decentralized identifier: `did:kanoniv:{hex(sha256(pubkey)[..16])}`
    pub did: String,
    /// Raw public key bytes (32 bytes, Ed25519)
    pub public_key_bytes: Vec<u8>,
}

impl AgentKeyPair {
    /// Generate a new random Ed25519 keypair.
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self { signing_key }
    }

    /// Reconstruct from existing secret key bytes (32 bytes).
    pub fn from_bytes(secret: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(secret);
        Self { signing_key }
    }

    /// Export the secret key bytes for persistence (e.g. to a key file).
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Get the signing key reference (used internally for signing).
    pub(crate) fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// Derive the public identity from this keypair.
    pub fn identity(&self) -> AgentIdentity {
        let verifying_key = self.signing_key.verifying_key();
        AgentIdentity::from_public_key(&verifying_key)
    }
}

impl AgentIdentity {
    /// Create an identity from a public verifying key.
    pub fn from_public_key(key: &VerifyingKey) -> Self {
        let public_key_bytes = key.to_bytes().to_vec();
        let did = Self::compute_did(&public_key_bytes);
        Self {
            did,
            public_key_bytes,
        }
    }

    /// Reconstruct from raw public key bytes (32 bytes).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(bytes.len()));
        }
        let did = Self::compute_did(bytes);
        Ok(Self {
            did,
            public_key_bytes: bytes.to_vec(),
        })
    }

    /// Get the Ed25519 verifying key for signature verification.
    pub fn verifying_key(&self) -> Result<VerifyingKey, CryptoError> {
        let bytes: [u8; 32] = self.public_key_bytes.clone().try_into().map_err(|_| {
            CryptoError::InvalidKeyLength(self.public_key_bytes.len())
        })?;
        VerifyingKey::from_bytes(&bytes).map_err(|_| CryptoError::InvalidPublicKey)
    }

    /// Generate a W3C DID Document for this identity.
    pub fn did_document(&self) -> serde_json::Value {
        let pk_base64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &self.public_key_bytes,
        );
        serde_json::json!({
            "@context": ["https://www.w3.org/ns/did/v1"],
            "id": self.did,
            "verificationMethod": [{
                "id": format!("{}#key-1", self.did),
                "type": "Ed25519VerificationKey2020",
                "controller": self.did,
                "publicKeyBase64": pk_base64
            }],
            "authentication": [format!("{}#key-1", self.did)],
            "assertionMethod": [format!("{}#key-1", self.did)]
        })
    }

    /// Compute the DID string from public key bytes.
    /// Format: `did:kanoniv:{hex(sha256(pubkey)[..16])}`
    fn compute_did(public_key_bytes: &[u8]) -> String {
        let hash = Sha256::digest(public_key_bytes);
        let short_hash = hex::encode(&hash[..16]);
        format!("did:kanoniv:{}", short_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        assert!(identity.did.starts_with("did:kanoniv:"));
        assert_eq!(identity.public_key_bytes.len(), 32);
    }

    #[test]
    fn test_did_determinism() {
        let kp = AgentKeyPair::generate();
        let id1 = kp.identity();
        let id2 = kp.identity();
        assert_eq!(id1.did, id2.did);
        assert_eq!(id1.public_key_bytes, id2.public_key_bytes);
    }

    #[test]
    fn test_different_keys_different_dids() {
        let kp1 = AgentKeyPair::generate();
        let kp2 = AgentKeyPair::generate();
        assert_ne!(kp1.identity().did, kp2.identity().did);
    }

    #[test]
    fn test_did_format() {
        let kp = AgentKeyPair::generate();
        let did = kp.identity().did;
        // did:kanoniv:<32 hex chars>
        assert!(did.starts_with("did:kanoniv:"));
        let suffix = &did["did:kanoniv:".len()..];
        assert_eq!(suffix.len(), 32); // 16 bytes = 32 hex chars
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_roundtrip_secret_bytes() {
        let kp1 = AgentKeyPair::generate();
        let secret = kp1.secret_bytes();
        let kp2 = AgentKeyPair::from_bytes(&secret);
        assert_eq!(kp1.identity().did, kp2.identity().did);
    }

    #[test]
    fn test_identity_from_bytes() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let restored = AgentIdentity::from_bytes(&identity.public_key_bytes).unwrap();
        assert_eq!(identity.did, restored.did);
    }

    #[test]
    fn test_identity_from_bytes_wrong_length() {
        let result = AgentIdentity::from_bytes(&[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_verifying_key_roundtrip() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let vk = identity.verifying_key().unwrap();
        assert_eq!(vk.to_bytes().to_vec(), identity.public_key_bytes);
    }

    #[test]
    fn test_did_document_structure() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();

        assert_eq!(doc["id"].as_str().unwrap(), identity.did);
        assert!(doc["@context"].as_array().is_some());
        let vm = &doc["verificationMethod"][0];
        assert_eq!(vm["type"].as_str().unwrap(), "Ed25519VerificationKey2020");
        assert_eq!(vm["controller"].as_str().unwrap(), identity.did);
        assert!(vm["publicKeyBase64"].as_str().is_some());
    }

    #[test]
    fn test_identity_serialization() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let json = serde_json::to_string(&identity).unwrap();
        let deserialized: AgentIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(identity, deserialized);
    }

    #[test]
    fn test_identity_from_bytes_empty() {
        let result = AgentIdentity::from_bytes(&[]);
        assert!(result.is_err());
        match result {
            Err(CryptoError::InvalidKeyLength(len)) => assert_eq!(len, 0),
            other => panic!("Expected InvalidKeyLength(0), got {:?}", other),
        }
    }

    #[test]
    fn test_identity_from_bytes_too_long() {
        let result = AgentIdentity::from_bytes(&[0u8; 64]);
        assert!(result.is_err());
        match result {
            Err(CryptoError::InvalidKeyLength(len)) => assert_eq!(len, 64),
            other => panic!("Expected InvalidKeyLength(64), got {:?}", other),
        }
    }

    #[test]
    fn test_identity_from_bytes_exactly_32() {
        let result = AgentIdentity::from_bytes(&[0u8; 32]);
        assert!(result.is_ok());
        let identity = result.unwrap();
        assert!(identity.did.starts_with("did:kanoniv:"));
        assert_eq!(identity.public_key_bytes.len(), 32);
    }

    #[test]
    fn test_did_document_base64_roundtrip() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();

        let pk_b64 = doc["verificationMethod"][0]["publicKeyBase64"]
            .as_str()
            .unwrap();
        let decoded = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            pk_b64,
        )
        .unwrap();
        assert_eq!(decoded, identity.public_key_bytes);
    }

    #[test]
    fn test_did_document_authentication_and_assertion() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();

        let expected_key_ref = format!("{}#key-1", identity.did);
        assert_eq!(
            doc["authentication"][0].as_str().unwrap(),
            expected_key_ref
        );
        assert_eq!(
            doc["assertionMethod"][0].as_str().unwrap(),
            expected_key_ref
        );
    }

    #[test]
    fn test_secret_bytes_length() {
        let kp = AgentKeyPair::generate();
        let secret = kp.secret_bytes();
        assert_eq!(secret.len(), 32);
    }

    #[test]
    fn test_two_keypairs_different_secrets() {
        let kp1 = AgentKeyPair::generate();
        let kp2 = AgentKeyPair::generate();
        assert_ne!(kp1.secret_bytes(), kp2.secret_bytes());
    }

    #[test]
    fn test_did_is_lowercase_hex() {
        let kp = AgentKeyPair::generate();
        let did = kp.identity().did;
        let suffix = &did["did:kanoniv:".len()..];
        assert_eq!(suffix, suffix.to_lowercase());
    }
}
