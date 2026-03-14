"""Type stubs for the native Rust extension."""

class AgentKeyPair:
    """An agent's Ed25519 keypair."""

    @staticmethod
    def generate() -> AgentKeyPair:
        """Generate a new random keypair."""
        ...

    @staticmethod
    def from_bytes(secret: bytes) -> AgentKeyPair:
        """Reconstruct from 32-byte secret key."""
        ...

    def secret_bytes(self) -> bytes:
        """Export the 32-byte secret key."""
        ...

    def identity(self) -> AgentIdentity:
        """Derive the public identity."""
        ...

    def sign(self, payload_json: str) -> SignedMessage:
        """Sign a JSON payload."""
        ...

class AgentIdentity:
    """Public identity derived from a keypair."""

    @property
    def did(self) -> str:
        """The DID string."""
        ...

    @property
    def public_key_bytes(self) -> bytes:
        """The raw 32-byte public key."""
        ...

    @staticmethod
    def from_bytes(bytes: bytes) -> AgentIdentity:
        """Reconstruct from raw public key bytes."""
        ...

    def did_document(self) -> str:
        """Generate a W3C DID Document as JSON string."""
        ...

class SignedMessage:
    """A cryptographically signed message envelope."""

    @property
    def payload(self) -> str:
        """The payload as JSON string."""
        ...

    @property
    def signer_did(self) -> str:
        """The signer's DID."""
        ...

    @property
    def nonce(self) -> str:
        """The nonce."""
        ...

    @property
    def timestamp(self) -> str:
        """The timestamp."""
        ...

    @property
    def signature(self) -> str:
        """Hex-encoded Ed25519 signature."""
        ...

    def verify(self, identity: AgentIdentity) -> None:
        """Verify against a known identity. Raises ValueError on failure."""
        ...

    def content_hash(self) -> str:
        """Compute the SHA-256 content hash."""
        ...

    def to_json(self) -> str:
        """Serialize to JSON string."""
        ...

    @staticmethod
    def from_json(json: str) -> SignedMessage:
        """Deserialize from JSON string."""
        ...

class ProvenanceEntry:
    """A signed provenance entry in the audit chain."""

    @staticmethod
    def create(
        keypair: AgentKeyPair,
        action: str,
        entity_ids: list[str],
        parent_ids: list[str],
        metadata_json: str,
    ) -> ProvenanceEntry:
        """Create and sign a new provenance entry."""
        ...

    @property
    def agent_did(self) -> str: ...

    @property
    def action(self) -> str: ...

    @property
    def entity_ids(self) -> list[str]: ...

    @property
    def parent_ids(self) -> list[str]: ...

    @property
    def metadata(self) -> str: ...

    @property
    def signed_envelope(self) -> SignedMessage: ...

    def verify(self, identity: AgentIdentity) -> None:
        """Verify against a known identity."""
        ...

    def content_hash(self) -> str:
        """Get the content hash (usable as parent_id)."""
        ...
