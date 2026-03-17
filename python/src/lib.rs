use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

/// Python wrapper around AgentKeyPair.
#[pyclass(frozen)]
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
            PyValueError::new_err(format!("Expected 32 bytes, got {}", secret.len()))
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

    /// When this key was created (RFC 3339), or None if unknown.
    #[getter]
    fn created_at(&self) -> Option<String> {
        self.inner.created_at.clone()
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

    /// Generate a W3C DID Document with service endpoints.
    ///
    /// Each service is a dict with keys: id, service_type, endpoint.
    /// Fragment IDs (starting with #) are auto-prefixed with the DID.
    fn did_document_with_services(&self, services: Vec<PyServiceEndpoint>) -> String {
        let svc: Vec<kanoniv_agent_auth::ServiceEndpoint> = services
            .into_iter()
            .map(|s| kanoniv_agent_auth::ServiceEndpoint::new(s.id, s.service_type, s.endpoint))
            .collect();
        serde_json::to_string_pretty(&self.inner.did_document_with_services(&svc)).unwrap()
    }

    fn __repr__(&self) -> String {
        format!("AgentIdentity(did='{}')", self.inner.did)
    }
}

/// A service endpoint for DID Documents.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct PyServiceEndpoint {
    #[pyo3(get)]
    id: String,
    #[pyo3(get)]
    service_type: String,
    #[pyo3(get)]
    endpoint: String,
}

#[pymethods]
impl PyServiceEndpoint {
    #[new]
    fn new(id: String, service_type: String, endpoint: String) -> Self {
        Self {
            id,
            service_type,
            endpoint,
        }
    }

    fn __repr__(&self) -> String {
        format!(
            "ServiceEndpoint(id='{}', type='{}')",
            self.id, self.service_type
        )
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

/// Python wrapper around Delegation.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct Delegation {
    inner: kanoniv_agent_auth::Delegation,
}

#[pymethods]
impl Delegation {
    /// Create a root delegation.
    #[staticmethod]
    fn create_root(
        issuer_keypair: &AgentKeyPair,
        delegate_did: &str,
        caveats_json: &str,
    ) -> PyResult<Self> {
        let caveats: Vec<kanoniv_agent_auth::Caveat> = serde_json::from_str(caveats_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid caveats JSON: {}", e)))?;
        let inner = kanoniv_agent_auth::Delegation::create_root(
            &issuer_keypair.inner,
            delegate_did,
            caveats,
        )
        .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// Delegate authority to another agent (with parent chain).
    #[staticmethod]
    fn delegate(
        issuer_keypair: &AgentKeyPair,
        delegate_did: &str,
        additional_caveats_json: &str,
        parent: &Delegation,
    ) -> PyResult<Self> {
        let caveats: Vec<kanoniv_agent_auth::Caveat> =
            serde_json::from_str(additional_caveats_json)
                .map_err(|e| PyValueError::new_err(format!("Invalid caveats JSON: {}", e)))?;
        let inner = kanoniv_agent_auth::Delegation::delegate(
            &issuer_keypair.inner,
            delegate_did,
            caveats,
            parent.inner.clone(),
        )
        .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    #[getter]
    fn issuer_did(&self) -> String {
        self.inner.issuer_did.clone()
    }

    #[getter]
    fn delegate_did(&self) -> String {
        self.inner.delegate_did.clone()
    }

    #[getter]
    fn depth(&self) -> usize {
        self.inner.depth()
    }

    /// Get the content hash of this delegation's proof (for revocation).
    fn content_hash(&self) -> String {
        self.inner.proof.content_hash()
    }

    fn __repr__(&self) -> String {
        format!(
            "Delegation(issuer='{}', delegate='{}')",
            self.inner.issuer_did, self.inner.delegate_did
        )
    }
}

/// Python wrapper around Invocation.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct Invocation {
    inner: kanoniv_agent_auth::Invocation,
}

#[pymethods]
impl Invocation {
    /// Create an invocation exercising delegated authority.
    #[staticmethod]
    fn create(
        invoker_keypair: &AgentKeyPair,
        action: &str,
        args_json: &str,
        delegation: &Delegation,
    ) -> PyResult<Self> {
        let args: serde_json::Value = serde_json::from_str(args_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
        let inner = kanoniv_agent_auth::Invocation::create(
            &invoker_keypair.inner,
            action,
            args,
            delegation.inner.clone(),
        )
        .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    #[getter]
    fn invoker_did(&self) -> String {
        self.inner.invoker_did.clone()
    }

    #[getter]
    fn action(&self) -> String {
        self.inner.action.clone()
    }

    fn __repr__(&self) -> String {
        format!(
            "Invocation(invoker='{}', action='{}')",
            self.inner.invoker_did, self.inner.action
        )
    }
}

/// Verify an invocation's full authority chain. Returns (invoker_did, root_did, chain, depth).
#[pyfunction]
fn verify_invocation(
    invocation: &Invocation,
    invoker_identity: &AgentIdentity,
    root_identity: &AgentIdentity,
) -> PyResult<(String, String, Vec<String>, usize)> {
    let result = kanoniv_agent_auth::verify_invocation(
        &invocation.inner,
        &invoker_identity.inner,
        &root_identity.inner,
    )
    .map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok((
        result.invoker_did,
        result.root_did,
        result.chain,
        result.depth,
    ))
}

// ---------------------------------------------------------------------------
// MCP Auth
// ---------------------------------------------------------------------------

/// Self-contained invocation proof for MCP transport.
///
/// Contains everything an MCP server needs to verify the agent's identity
/// and authority without any external key resolver.
#[pyclass(frozen, from_py_object)]
#[derive(Clone)]
struct McpProof {
    inner: kanoniv_agent_auth::McpProof,
}

#[pymethods]
impl McpProof {
    /// Create an MCP proof for a tool call.
    #[staticmethod]
    fn create(
        invoker_keypair: &AgentKeyPair,
        action: &str,
        args_json: &str,
        delegation: &Delegation,
    ) -> PyResult<Self> {
        let args: serde_json::Value = serde_json::from_str(args_json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
        let inner = kanoniv_agent_auth::McpProof::create(
            &invoker_keypair.inner,
            action,
            args,
            delegation.inner.clone(),
        )
        .map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(Self { inner })
    }

    /// The invoker's public key as hex string (64 chars).
    #[getter]
    fn invoker_public_key(&self) -> String {
        self.inner.invoker_public_key.clone()
    }

    /// The invoker's DID.
    #[getter]
    fn invoker_did(&self) -> String {
        self.inner.invocation.invoker_did.clone()
    }

    /// The action this proof authorizes.
    #[getter]
    fn action(&self) -> String {
        self.inner.invocation.action.clone()
    }

    /// Serialize to JSON string (for embedding in MCP tool arguments).
    fn to_json(&self) -> PyResult<String> {
        serde_json::to_string(&self.inner)
            .map_err(|e| PyValueError::new_err(format!("Serialization failed: {}", e)))
    }

    /// Deserialize from JSON string.
    #[staticmethod]
    fn from_json(json: &str) -> PyResult<Self> {
        let inner: kanoniv_agent_auth::McpProof = serde_json::from_str(json)
            .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
        Ok(Self { inner })
    }

    fn __repr__(&self) -> String {
        format!(
            "McpProof(invoker='{}', action='{}')",
            self.inner.invocation.invoker_did, self.inner.invocation.action
        )
    }
}

/// Verify an MCP proof against a root authority.
///
/// Returns (invoker_did, root_did, chain, depth).
/// Raises ValueError on verification failure.
#[pyfunction]
fn verify_mcp_call(
    proof: &McpProof,
    root_identity: &AgentIdentity,
) -> PyResult<(String, String, Vec<String>, usize)> {
    let result =
        kanoniv_agent_auth::mcp::verify_mcp_call(&proof.inner, &root_identity.inner)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok((
        result.invoker_did,
        result.root_did,
        result.chain,
        result.depth,
    ))
}

/// Extract an MCP proof from a JSON arguments string.
///
/// Returns (proof_json_or_none, clean_args_json).
/// The _proof field is always stripped from the returned args.
#[pyfunction]
fn extract_mcp_proof(args_json: &str) -> PyResult<(Option<McpProof>, String)> {
    let args: serde_json::Value = serde_json::from_str(args_json)
        .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
    let (proof, clean_args) = kanoniv_agent_auth::McpProof::extract(&args);
    let clean_json = serde_json::to_string(&clean_args).unwrap();
    Ok((proof.map(|p| McpProof { inner: p }), clean_json))
}

/// Inject an MCP proof into tool arguments JSON.
///
/// Returns the arguments JSON string with _proof field added.
#[pyfunction]
fn inject_mcp_proof(proof: &McpProof, args_json: &str) -> PyResult<String> {
    let mut args: serde_json::Value = serde_json::from_str(args_json)
        .map_err(|e| PyValueError::new_err(format!("Invalid JSON: {}", e)))?;
    proof.inner.inject(&mut args);
    Ok(serde_json::to_string(&args).unwrap())
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<AgentKeyPair>()?;
    m.add_class::<AgentIdentity>()?;
    m.add_class::<SignedMessage>()?;
    m.add_class::<ProvenanceEntry>()?;
    m.add_class::<PyServiceEndpoint>()?;
    m.add_class::<Delegation>()?;
    m.add_class::<Invocation>()?;
    m.add_class::<McpProof>()?;
    m.add_function(pyo3::wrap_pyfunction!(verify_invocation, m)?)?;
    m.add_function(pyo3::wrap_pyfunction!(verify_mcp_call, m)?)?;
    m.add_function(pyo3::wrap_pyfunction!(extract_mcp_proof, m)?)?;
    m.add_function(pyo3::wrap_pyfunction!(inject_mcp_proof, m)?)?;
    Ok(())
}
