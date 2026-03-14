//! Agent cryptographic identity - Ed25519 keypairs and `did:agent:` identifiers.

use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::CryptoError;

/// An agent's Ed25519 keypair used for signing messages and proving identity.
pub struct AgentKeyPair {
    signing_key: SigningKey,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Public identity derived from a keypair - safe to share and store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentIdentity {
    /// Decentralized identifier: `did:agent:{hex(sha256(pubkey)[..16])}`
    pub did: String,
    /// Raw public key bytes (32 bytes, Ed25519)
    pub public_key_bytes: Vec<u8>,
    /// When this key was created (if known). Used for trust freshness policies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A service endpoint for a DID Document (W3C DID Core specification).
///
/// Describes how to communicate with or reach the agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceEndpoint {
    /// Fragment ID (e.g. "#messaging") or full URI. Fragments are auto-prefixed with the DID.
    pub id: String,
    /// Service type (e.g. "AgentMessaging", "KanonivResolve", "DIDCommMessaging")
    pub service_type: String,
    /// The endpoint URL
    pub endpoint: String,
}

impl ServiceEndpoint {
    /// Create a new service endpoint.
    pub fn new(
        id: impl Into<String>,
        service_type: impl Into<String>,
        endpoint: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            service_type: service_type.into(),
            endpoint: endpoint.into(),
        }
    }
}

impl AgentKeyPair {
    /// Generate a new random Ed25519 keypair with current timestamp.
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        Self {
            signing_key,
            created_at: chrono::Utc::now(),
        }
    }

    /// Reconstruct from existing secret key bytes (32 bytes).
    ///
    /// Use `from_bytes_with_created_at` if the original creation time is known.
    pub fn from_bytes(secret: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(secret);
        Self {
            signing_key,
            created_at: chrono::Utc::now(),
        }
    }

    /// Reconstruct from secret key bytes with a known creation time.
    pub fn from_bytes_with_created_at(
        secret: &[u8; 32],
        created_at: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        let signing_key = SigningKey::from_bytes(secret);
        Self {
            signing_key,
            created_at,
        }
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
        let ts = self
            .created_at
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        AgentIdentity::from_public_key_with_created_at(&verifying_key, Some(ts))
    }

    /// Get the key creation timestamp.
    pub fn created_at(&self) -> &chrono::DateTime<chrono::Utc> {
        &self.created_at
    }
}

impl AgentIdentity {
    /// Create an identity from a public verifying key (no creation timestamp).
    pub fn from_public_key(key: &VerifyingKey) -> Self {
        Self::from_public_key_with_created_at(key, None)
    }

    /// Create an identity from a public verifying key with optional creation timestamp.
    pub fn from_public_key_with_created_at(key: &VerifyingKey, created_at: Option<String>) -> Self {
        let public_key_bytes = key.to_bytes().to_vec();
        let did = Self::compute_did(&public_key_bytes);
        Self {
            did,
            public_key_bytes,
            created_at,
        }
    }

    /// Reconstruct from raw public key bytes (32 bytes, no creation timestamp).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidKeyLength(bytes.len()));
        }
        let did = Self::compute_did(bytes);
        Ok(Self {
            did,
            public_key_bytes: bytes.to_vec(),
            created_at: None,
        })
    }

    /// Get the Ed25519 verifying key for signature verification.
    pub fn verifying_key(&self) -> Result<VerifyingKey, CryptoError> {
        let bytes: [u8; 32] = self
            .public_key_bytes
            .clone()
            .try_into()
            .map_err(|_| CryptoError::InvalidKeyLength(self.public_key_bytes.len()))?;
        VerifyingKey::from_bytes(&bytes).map_err(|_| CryptoError::InvalidPublicKey)
    }

    /// Generate a W3C DID Document for this identity (no service endpoints).
    pub fn did_document(&self) -> serde_json::Value {
        self.did_document_with_services(&[])
    }

    /// Generate a W3C DID Document with optional service endpoints.
    ///
    /// Service endpoints allow agent frameworks to discover how to
    /// communicate with this agent (messaging, API, coordination).
    pub fn did_document_with_services(&self, services: &[ServiceEndpoint]) -> serde_json::Value {
        let pk_multibase = Self::encode_multibase_ed25519(&self.public_key_bytes);
        let mut vm = serde_json::json!({
            "id": format!("{}#key-1", self.did),
            "type": "Ed25519VerificationKey2020",
            "controller": self.did,
            "publicKeyMultibase": pk_multibase
        });
        if let Some(ref ts) = self.created_at {
            vm["created"] = serde_json::Value::String(ts.clone());
        }
        let mut doc = serde_json::json!({
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://w3id.org/security/suites/ed25519-2020/v1"
            ],
            "id": self.did,
            "verificationMethod": [vm],
            "authentication": [format!("{}#key-1", self.did)],
            "assertionMethod": [format!("{}#key-1", self.did)]
        });

        if !services.is_empty() {
            let svc_array: Vec<serde_json::Value> = services
                .iter()
                .map(|s| {
                    let id = if s.id.starts_with('#') {
                        format!("{}{}", self.did, s.id)
                    } else {
                        s.id.clone()
                    };
                    serde_json::json!({
                        "id": id,
                        "type": s.service_type,
                        "serviceEndpoint": s.endpoint,
                    })
                })
                .collect();
            doc["service"] = serde_json::Value::Array(svc_array);
        }

        doc
    }

    /// Compute the DID string from public key bytes.
    /// Format: `did:agent:{hex(sha256(pubkey)[..16])}`
    fn compute_did(public_key_bytes: &[u8]) -> String {
        let hash = Sha256::digest(public_key_bytes);
        let short_hash = hex::encode(&hash[..16]);
        format!("did:agent:{}", short_hash)
    }

    /// Encode a public key as multibase (z + base58btc(multicodec_prefix + key)).
    ///
    /// Ed25519 multicodec prefix: 0xed 0x01
    /// Multibase prefix for base58btc: 'z'
    fn encode_multibase_ed25519(public_key_bytes: &[u8]) -> String {
        let mut prefixed = Vec::with_capacity(2 + public_key_bytes.len());
        prefixed.extend_from_slice(&[0xed, 0x01]); // ed25519-pub multicodec
        prefixed.extend_from_slice(public_key_bytes);
        format!("z{}", bs58::encode(&prefixed).into_string())
    }

    /// Decode a multibase-encoded Ed25519 public key.
    ///
    /// Expects format: z{base58btc(0xed01 + 32_bytes)}
    pub fn from_multibase(multibase: &str) -> Result<Self, CryptoError> {
        let stripped = multibase.strip_prefix('z').ok_or_else(|| {
            CryptoError::InvalidSignatureEncoding(
                "multibase must start with 'z' (base58btc)".into(),
            )
        })?;
        let decoded = bs58::decode(stripped).into_vec().map_err(|e| {
            CryptoError::InvalidSignatureEncoding(format!("invalid base58btc: {}", e))
        })?;
        if decoded.len() != 34 || decoded[0] != 0xed || decoded[1] != 0x01 {
            return Err(CryptoError::InvalidSignatureEncoding(
                "expected ed25519-pub multicodec prefix (0xed01) + 32 bytes".into(),
            ));
        }
        Self::from_bytes(&decoded[2..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        assert!(identity.did.starts_with("did:agent:"));
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
        // did:agent:<32 hex chars>
        assert!(did.starts_with("did:agent:"));
        let suffix = &did["did:agent:".len()..];
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
        let pk_mb = vm["publicKeyMultibase"].as_str().unwrap();
        assert!(pk_mb.starts_with('z'), "multibase must start with 'z'");
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
        assert!(identity.did.starts_with("did:agent:"));
        assert_eq!(identity.public_key_bytes.len(), 32);
    }

    #[test]
    fn test_did_document_multibase_roundtrip() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();

        let pk_mb = doc["verificationMethod"][0]["publicKeyMultibase"]
            .as_str()
            .unwrap();
        // Decode multibase back to an identity and verify it matches
        let restored = AgentIdentity::from_multibase(pk_mb).unwrap();
        assert_eq!(restored.did, identity.did);
        assert_eq!(restored.public_key_bytes, identity.public_key_bytes);
    }

    #[test]
    fn test_multibase_encoding_format() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();
        let pk_mb = doc["verificationMethod"][0]["publicKeyMultibase"]
            .as_str()
            .unwrap();

        // Must start with 'z' (base58btc multibase prefix)
        assert!(pk_mb.starts_with('z'));
        // Decode base58btc (strip 'z' prefix)
        let decoded = bs58::decode(&pk_mb[1..]).into_vec().unwrap();
        // First two bytes are ed25519-pub multicodec (0xed 0x01)
        assert_eq!(decoded[0], 0xed);
        assert_eq!(decoded[1], 0x01);
        // Remaining 32 bytes are the public key
        assert_eq!(&decoded[2..], &identity.public_key_bytes);
    }

    #[test]
    fn test_from_multibase_invalid_prefix() {
        let result = AgentIdentity::from_multibase("m_not_base58btc");
        assert!(result.is_err());
    }

    #[test]
    fn test_from_multibase_invalid_base58() {
        let result = AgentIdentity::from_multibase("z!!!invalid!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_from_multibase_wrong_codec() {
        // Valid base58btc but wrong multicodec prefix (not ed25519)
        let wrong_prefix = bs58::encode(&[0x00u8; 34]).into_string();
        let result = AgentIdentity::from_multibase(&format!("z{}", wrong_prefix));
        assert!(result.is_err());
    }

    #[test]
    fn test_did_document_authentication_and_assertion() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();

        let expected_key_ref = format!("{}#key-1", identity.did);
        assert_eq!(doc["authentication"][0].as_str().unwrap(), expected_key_ref);
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
        let suffix = &did["did:agent:".len()..];
        assert_eq!(suffix, suffix.to_lowercase());
    }

    #[test]
    fn test_did_document_no_services_has_no_service_field() {
        let kp = AgentKeyPair::generate();
        let doc = kp.identity().did_document();
        assert!(doc.get("service").is_none());
    }

    #[test]
    fn test_did_document_with_services() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let services = vec![
            ServiceEndpoint::new(
                "#messaging",
                "AgentMessaging",
                "https://example.com/agent/msg",
            ),
            ServiceEndpoint::new(
                "#resolve",
                "KanonivResolve",
                "https://api.kanoniv.com/v1/resolve",
            ),
        ];
        let doc = identity.did_document_with_services(&services);

        let svc = doc["service"].as_array().unwrap();
        assert_eq!(svc.len(), 2);

        // Fragment IDs get prefixed with the DID
        assert_eq!(
            svc[0]["id"].as_str().unwrap(),
            format!("{}#messaging", identity.did)
        );
        assert_eq!(svc[0]["type"].as_str().unwrap(), "AgentMessaging");
        assert_eq!(
            svc[0]["serviceEndpoint"].as_str().unwrap(),
            "https://example.com/agent/msg"
        );

        assert_eq!(
            svc[1]["id"].as_str().unwrap(),
            format!("{}#resolve", identity.did)
        );
        assert_eq!(svc[1]["type"].as_str().unwrap(), "KanonivResolve");
    }

    #[test]
    fn test_did_document_with_full_uri_service_id() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let services = vec![ServiceEndpoint::new(
            "https://example.com/services/agent-1",
            "AgentMessaging",
            "https://example.com/agent/msg",
        )];
        let doc = identity.did_document_with_services(&services);

        let svc = doc["service"].as_array().unwrap();
        // Full URI is NOT prefixed with DID
        assert_eq!(
            svc[0]["id"].as_str().unwrap(),
            "https://example.com/services/agent-1"
        );
    }

    #[test]
    fn test_did_document_empty_services_no_service_field() {
        let kp = AgentKeyPair::generate();
        let doc = kp.identity().did_document_with_services(&[]);
        assert!(doc.get("service").is_none());
    }

    #[test]
    fn test_service_endpoint_serialization() {
        let svc = ServiceEndpoint::new("#messaging", "AgentMessaging", "https://example.com");
        let json = serde_json::to_string(&svc).unwrap();
        let restored: ServiceEndpoint = serde_json::from_str(&json).unwrap();
        assert_eq!(svc, restored);
    }

    #[test]
    fn test_created_at_from_generate() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        assert!(identity.created_at.is_some());
        // Should be a valid RFC 3339 timestamp
        let ts = identity.created_at.as_ref().unwrap();
        assert!(ts.ends_with('Z'));
        chrono::DateTime::parse_from_rfc3339(ts).unwrap();
    }

    #[test]
    fn test_created_at_in_did_document() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let doc = identity.did_document();
        let vm = &doc["verificationMethod"][0];
        let created = vm["created"].as_str().unwrap();
        assert!(created.ends_with('Z'));
        assert_eq!(created, identity.created_at.as_ref().unwrap());
    }

    #[test]
    fn test_created_at_absent_from_bytes() {
        let identity = AgentIdentity::from_bytes(&[0u8; 32]).unwrap();
        assert!(identity.created_at.is_none());
        // DID Document should not have "created" field
        let doc = identity.did_document();
        let vm = &doc["verificationMethod"][0];
        assert!(vm.get("created").is_none());
    }

    #[test]
    fn test_from_bytes_with_created_at() {
        let kp = AgentKeyPair::generate();
        let secret = kp.secret_bytes();
        let ts = chrono::Utc::now();
        let kp2 = AgentKeyPair::from_bytes_with_created_at(&secret, ts);
        assert_eq!(kp.identity().did, kp2.identity().did);
        assert!(kp2.identity().created_at.is_some());
    }

    #[test]
    fn test_created_at_serialization_roundtrip() {
        let kp = AgentKeyPair::generate();
        let identity = kp.identity();
        let json = serde_json::to_string(&identity).unwrap();
        let restored: AgentIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(identity.created_at, restored.created_at);
        assert_eq!(identity.did, restored.did);
    }

    #[test]
    fn test_created_at_not_in_json_when_none() {
        let identity = AgentIdentity::from_bytes(&[0u8; 32]).unwrap();
        let json = serde_json::to_string(&identity).unwrap();
        assert!(!json.contains("created_at"));
    }
}
