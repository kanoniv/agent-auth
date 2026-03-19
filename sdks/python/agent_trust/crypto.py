"""Cryptographic identity and provenance signing.

Ed25519 key generation, DID creation, message signing and verification.
This is the foundation - every trust decision rests on verified signatures.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization


@dataclass
class KeyPair:
    """Ed25519 key pair with DID."""
    private_key: Ed25519PrivateKey
    public_key: Ed25519PublicKey
    did: str  # did:key:z6Mk...

    def sign(self, message: bytes) -> str:
        """Sign a message. Returns base64url-encoded signature."""
        sig = self.private_key.sign(message)
        return base64.urlsafe_b64encode(sig).decode()

    def export_private(self) -> str:
        """Export private key as base64."""
        raw = self.private_key.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        return base64.urlsafe_b64encode(raw).decode()

    def export_public(self) -> str:
        """Export public key as base64."""
        raw = self.public_key.public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        return base64.urlsafe_b64encode(raw).decode()


class AgentIdentity:
    """Portable agent identity. Agents carry this across services.

    Production usage:
        # Agent creates identity once
        identity = AgentIdentity.generate("researcher")
        identity.save("~/.agent-trust/researcher.key")

        # On every startup, load from disk
        identity = AgentIdentity.load("~/.agent-trust/researcher.key")

        # Register with any TrustAgent
        trust.register("researcher", did=identity.did, capabilities=["search"])

        # Agent signs its own actions
        sig, ts = identity.sign_action("search", result="success", reward=0.9)
        trust.observe("researcher", action="search", result="success",
                      reward=0.9, signature=sig, signed_at=ts)
    """

    def __init__(self, name: str, keys: KeyPair):
        self.name = name
        self.keys = keys

    @property
    def did(self) -> str:
        return self.keys.did

    @classmethod
    def generate(cls, name: str) -> "AgentIdentity":
        """Generate a new agent identity."""
        return cls(name, generate_keys())

    @classmethod
    def load(cls, path: str) -> "AgentIdentity":
        """Load identity from a key file."""
        import json as _json
        from pathlib import Path
        data = _json.loads(Path(path).expanduser().read_text())
        keys = load_keys(data["private_key"])
        return cls(data["name"], keys)

    def save(self, path: str) -> None:
        """Save identity to a key file."""
        import json as _json
        from pathlib import Path
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(_json.dumps({
            "name": self.name,
            "did": self.did,
            "private_key": self.keys.export_private(),
        }, indent=2))

    def sign_action(
        self,
        action: str,
        result: str,
        reward: float,
        entity_ids: list[str] | None = None,
    ) -> tuple[str, float]:
        """Sign an action for submission to a TrustAgent.

        Returns (signature, timestamp) tuple. Pass both to trust.observe().
        """
        import time
        ts = time.time()
        sig = sign_provenance(
            self.keys, action, entity_ids or [],
            {"result": result, "reward": reward}, ts,
        )
        return sig, ts


def generate_keys() -> KeyPair:
    """Generate a new Ed25519 key pair with a did:key identifier."""
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    did = _public_key_to_did(public)
    return KeyPair(private_key=private, public_key=public, did=did)


def load_keys(private_key_b64: str) -> KeyPair:
    """Load a key pair from a base64-encoded private key."""
    raw = base64.urlsafe_b64decode(private_key_b64)
    private = Ed25519PrivateKey.from_private_bytes(raw)
    public = private.public_key()
    did = _public_key_to_did(public)
    return KeyPair(private_key=private, public_key=public, did=did)


def verify_signature(did: str, message: bytes, signature_b64: str) -> bool:
    """Verify a signature against a DID's public key.

    Returns True if the signature is valid, False otherwise.
    Never raises on invalid signatures - returns False.
    """
    try:
        public_key = _did_to_public_key(did)
        sig = base64.urlsafe_b64decode(signature_b64)
        public_key.verify(sig, message)
        return True
    except Exception:
        return False


def sign_provenance(
    keys: KeyPair,
    action: str,
    entity_ids: list[str],
    metadata: dict,
    timestamp: float,
) -> str:
    """Sign a provenance record. Returns base64url-encoded signature.

    The signed payload is a canonical JSON of the provenance fields,
    ensuring deterministic serialization for verification.
    """
    payload = _canonical_payload(
        did=keys.did,
        action=action,
        entity_ids=entity_ids,
        metadata=metadata,
        timestamp=timestamp,
    )
    return keys.sign(payload)


def verify_provenance(
    did: str,
    action: str,
    entity_ids: list[str],
    metadata: dict,
    timestamp: float,
    signature_b64: str,
) -> bool:
    """Verify a signed provenance record."""
    payload = _canonical_payload(
        did=did,
        action=action,
        entity_ids=entity_ids,
        metadata=metadata,
        timestamp=timestamp,
    )
    return verify_signature(did, payload, signature_b64)


def _canonical_payload(
    did: str,
    action: str,
    entity_ids: list[str],
    metadata: dict,
    timestamp: float,
) -> bytes:
    """Deterministic JSON serialization for signing."""
    obj = {
        "did": did,
        "action": action,
        "entity_ids": sorted(entity_ids),
        "metadata": json.dumps(metadata, sort_keys=True, separators=(",", ":")),
        "timestamp": timestamp,
    }
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def _public_key_to_did(public_key: Ed25519PublicKey) -> str:
    """Convert an Ed25519 public key to a did:key identifier.

    Uses the multicodec prefix 0xed01 for Ed25519 public keys,
    then base58btc encodes with the 'z' prefix per the did:key spec.
    """
    raw = public_key.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    # Multicodec: 0xed = ed25519-pub, varint encoded as 0xed 0x01
    multicodec = b"\xed\x01" + raw
    encoded = _base58btc_encode(multicodec)
    return f"did:key:z{encoded}"


def _did_to_public_key(did: str) -> Ed25519PublicKey:
    """Extract Ed25519 public key from a did:key identifier."""
    if not did.startswith("did:key:z"):
        raise ValueError(f"Unsupported DID method: {did}")
    encoded = did[len("did:key:z"):]
    decoded = _base58btc_decode(encoded)
    if decoded[:2] != b"\xed\x01":
        raise ValueError(f"Not an Ed25519 key: unexpected multicodec prefix")
    raw = decoded[2:]
    return Ed25519PublicKey.from_public_bytes(raw)


# Base58btc (Bitcoin alphabet)
_B58_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _base58btc_encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    result = []
    while n > 0:
        n, r = divmod(n, 58)
        result.append(_B58_ALPHABET[r:r + 1])
    # Preserve leading zeros
    for byte in data:
        if byte == 0:
            result.append(b"1")
        else:
            break
    return b"".join(reversed(result)).decode()


def _base58btc_decode(s: str) -> bytes:
    n = 0
    for char in s.encode():
        n = n * 58 + _B58_ALPHABET.index(char)
    # Calculate byte length
    byte_length = (n.bit_length() + 7) // 8
    result = n.to_bytes(byte_length, "big") if byte_length > 0 else b""
    # Restore leading zeros
    pad = 0
    for char in s.encode():
        if char == _B58_ALPHABET[0]:
            pad += 1
        else:
            break
    return b"\x00" * pad + result
