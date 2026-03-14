use pyo3::prelude::*;
use pyo3::exceptions::PyValueError;

/// Python wrapper around AgentKeyPair.
#[pyclass]
struct AgentKeyPair {
    inner: kanoniv_agent_auth::AgentKeyPair,
}

#[pymethods]
impl AgentKeyPair {
    /// Generate a new random Ed25519 keypair.
    #[staticmethod]
    fn generate() -> Self {
        Self {
            inner: kanoniv_agent_auth::AgentKeyPair::generate(),
        }
    }

    /// Reconstruct from 32-byte secret key.
    #[staticmethod]
    fn from_bytes(secret: &[u8]) -> PyResult<Self> {
        let arr: [u8; 32] = secret.try_into().map_err(|_| {
            PyValueError::new_err(format!(
                "Expected 32 bytes, got {}",
                secret.len()
            ))
        })?;
        Ok(Self {
            inner: kanoniv_agent_auth::AgentKeyPair::from_bytes(&arr),
        })
    }

    /// Export the 32-byte secret key.
    fn secret_bytes(&self) -> Vec<u8> {
        self.inner.secret_bytes().to_vec()
    }

    /// Derive the public AgentIdentity.
    fn identity(&self) -> AgentIdentity {
        let id = self.inner.identity();
        AgentIdentity { inner: id }
    }

    /// Sign a JSON payload, returning a SignedMessage.
    fn sign(&self, payload_json: &str) -> PyResult<SignedMessage> {
        let payload: serde_json::Value = serde_json::from_str(payload_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
        let signed = kanoniv_agent_auth::SignedMessage::sign(&self.inner, payload)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(SignedMessage { inner: signed })
    }
}

/// Python wrapper around AgentIdentity.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct AgentIdentity {
    inner: kanoniv_agent_auth::AgentIdentity,
}

#[pymethods]
impl AgentIdentity {
    /// The DID string.
    #[getter]
    fn did(&self) -> String {
        self.inner.did.clone()
    }

    /// The raw public key bytes.
    #[getter]
    fn public_key_bytes(&self) -> Vec<u8> {
        self.inner.public_key_bytes.clone()
    }

    /// Reconstruct from raw public key bytes.
    #[staticmethod]
    fn from_bytes(bytes: &[u8]) -> PyResult<Self> {
        let inner = kanoniv_agent_auth::AgentIdentity::from_bytes(bytes)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// Generate a W3C DID Document as a JSON string.
    fn did_document(&self) -> String {
        serde_json::to_string_pretty(&self.inner.did_document()).unwrap()
    }

    fn __repr__(&self) -> String {
        format!("AgentIdentity(did='{}')", self.inner.did)
    }
}

/// Python wrapper around SignedMessage.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct SignedMessage {
    inner: kanoniv_agent_auth::SignedMessage,
}

#[pymethods]
impl SignedMessage {
    /// The payload as a JSON string.
    #[getter]
    fn payload(&self) -> String {
        serde_json::to_string(&self.inner.payload).unwrap()
    }

    /// The signer's DID.
    #[getter]
    fn signer_did(&self) -> String {
        self.inner.signer_did.clone()
    }

    /// The nonce.
    #[getter]
    fn nonce(&self) -> String {
        self.inner.nonce.clone()
    }

    /// The timestamp.
    #[getter]
    fn timestamp(&self) -> String {
        self.inner.timestamp.clone()
    }

    /// The hex-encoded signature.
    #[getter]
    fn signature(&self) -> String {
        self.inner.signature.clone()
    }

    /// Verify against a known identity. Raises ValueError on failure.
    fn verify(&self, identity: &AgentIdentity) -> PyResult<()> {
        self.inner
            .verify(&identity.inner)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// Compute the SHA-256 content hash.
    fn content_hash(&self) -> String {
        self.inner.content_hash()
    }

    /// Serialize to JSON string.
    fn to_json(&self) -> String {
        serde_json::to_string(&self.inner).unwrap()
    }

    /// Deserialize from JSON string.
    #[staticmethod]
    fn from_json(json: &str) -> PyResult<Self> {
        let inner: kanoniv_agent_auth::SignedMessage = serde_json::from_str(json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
        Ok(Self { inner })
    }

    fn __repr__(&self) -> String {
        format!(
            "SignedMessage(signer_did='{}', nonce='{}')",
            self.inner.signer_did, self.inner.nonce
        )
    }
}

/// Python wrapper around ProvenanceEntry.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct ProvenanceEntry {
    inner: kanoniv_agent_auth::ProvenanceEntry,
}

#[pymethods]
impl ProvenanceEntry {
    /// Create and sign a new provenance entry.
    #[staticmethod]
    fn create(
        keypair: &AgentKeyPair,
        action: &str,
        entity_ids: Vec<String>,
        parent_ids: Vec<String>,
        metadata_json: &str,
    ) -> PyResult<Self> {
        let action_type = parse_action_type(action)?;
        let metadata: serde_json::Value = serde_json::from_str(metadata_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;

        let inner = kanoniv_agent_auth::ProvenanceEntry::create(
            &keypair.inner,
            action_type,
            entity_ids,
            parent_ids,
            metadata,
        )
        .map_err(|e| PyValueError::new_err(e.to_string()))?;

        Ok(Self { inner })
    }

    /// The agent's DID.
    #[getter]
    fn agent_did(&self) -> String {
        self.inner.agent_did.clone()
    }

    /// The action type as a string.
    #[getter]
    fn action(&self) -> String {
        self.inner.action.to_string()
    }

    /// Entity IDs affected.
    #[getter]
    fn entity_ids(&self) -> Vec<String> {
        self.inner.entity_ids.clone()
    }

    /// Parent entry content hashes.
    #[getter]
    fn parent_ids(&self) -> Vec<String> {
        self.inner.parent_ids.clone()
    }

    /// Metadata as JSON string.
    #[getter]
    fn metadata(&self) -> String {
        serde_json::to_string(&self.inner.metadata).unwrap()
    }

    /// The signed envelope.
    #[getter]
    fn signed_envelope(&self) -> SignedMessage {
        SignedMessage {
            inner: self.inner.signed_envelope.clone(),
        }
    }

    /// Verify against a known identity.
    fn verify(&self, identity: &AgentIdentity) -> PyResult<()> {
        self.inner
            .verify(&identity.inner)
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// Get the content hash (usable as parent_id).
    fn content_hash(&self) -> String {
        self.inner.content_hash()
    }

    fn __repr__(&self) -> String {
        format!(
            "ProvenanceEntry(agent_did='{}', action='{}')",
            self.inner.agent_did, self.inner.action
        )
    }
}

fn parse_action_type(s: &str) -> PyResult<kanoniv_agent_auth::ActionType> {
    match s {
        "resolve" => Ok(kanoniv_agent_auth::ActionType::Resolve),
        "merge" => Ok(kanoniv_agent_auth::ActionType::Merge),
        "split" => Ok(kanoniv_agent_auth::ActionType::Split),
        "mutate" => Ok(kanoniv_agent_auth::ActionType::Mutate),
        "ingest" => Ok(kanoniv_agent_auth::ActionType::Ingest),
        "delegate" => Ok(kanoniv_agent_auth::ActionType::Delegate),
        "revoke" => Ok(kanoniv_agent_auth::ActionType::Revoke),
        s if s.starts_with("custom:") => {
            Ok(kanoniv_agent_auth::ActionType::Custom(s[7..].to_string()))
        }
        _ => Err(PyValueError::new_err(format!("Unknown action type: {}", s))),
    }
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<AgentKeyPair>()?;
    m.add_class::<AgentIdentity>()?;
    m.add_class::<SignedMessage>()?;
    m.add_class::<ProvenanceEntry>()?;
    Ok(())
}
