"""Ed25519 cryptographic primitives.

Key generation, DID creation, signing, and verification.
Self-contained - no dependency on kanoniv-trust.

DID method: did:agent:{sha256_hex_first_16_bytes}
Matches the Rust kanoniv-agent-auth crate exactly.
"""

from __future__ import annotations

import base64
import hashlib
import datetime
import json
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidSignature
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
    did: str  # did:agent:{hash}
    public_key_bytes: bytes  # raw 32-byte public key

    def sign(self, message: bytes) -> str:
        """Sign a message. Returns hex-encoded signature."""
        sig = self.private_key.sign(message)
        return sig.hex()

    def sign_b64(self, message: bytes) -> str:
        """Sign a message. Returns base64url-encoded signature."""
        sig = self.private_key.sign(message)
        return base64.urlsafe_b64encode(sig).decode()

    def export_private(self) -> str:
        """Export private key as base64url."""
        raw = self.private_key.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    def export_private_hex(self) -> str:
        """Export private key as hex (matches Rust key file format)."""
        raw = self.private_key.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        return raw.hex()

    def export_public(self) -> str:
        """Export public key as base64url."""
        return base64.urlsafe_b64encode(self.public_key_bytes).decode().rstrip("=")

    def export_public_hex(self) -> str:
        """Export public key as hex."""
        return self.public_key_bytes.hex()

    def save(self, path: str) -> None:
        """Save key pair to a JSON file (Rust-compatible format)."""
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "did": self.did,
            "public_key": self.export_public_hex(),
            "private_key": self.export_private_hex(),
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }, indent=2))
        p.chmod(0o600)

    @classmethod
    def load(cls, path: str) -> "KeyPair":
        """Load key pair from a JSON file (Rust-compatible format)."""
        data = json.loads(Path(path).expanduser().read_text())
        if "private_key" in data:
            priv_hex = data["private_key"]
            # Support both hex (Rust format) and base64 (old Python format)
            try:
                raw = bytes.fromhex(priv_hex)
            except ValueError:
                raw = base64.urlsafe_b64decode(priv_hex + "==")
            return load_keys_from_bytes(raw)
        raise ValueError("Key file missing private_key field")


def generate_keys() -> KeyPair:
    """Generate a new Ed25519 key pair with a did:agent identifier."""
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    pub_bytes = public.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    did = _compute_did(pub_bytes)
    return KeyPair(private_key=private, public_key=public, did=did, public_key_bytes=pub_bytes)


def load_keys(private_key_b64: str) -> KeyPair:
    """Load a key pair from a base64url-encoded private key."""
    # Add padding if needed
    padded = private_key_b64 + "=" * (4 - len(private_key_b64) % 4) if len(private_key_b64) % 4 else private_key_b64
    raw = base64.urlsafe_b64decode(padded)
    return load_keys_from_bytes(raw)


def load_keys_from_bytes(raw: bytes) -> KeyPair:
    """Load a key pair from raw private key bytes."""
    private = Ed25519PrivateKey.from_private_bytes(raw)
    public = private.public_key()
    pub_bytes = public.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    did = _compute_did(pub_bytes)
    return KeyPair(private_key=private, public_key=public, did=did, public_key_bytes=pub_bytes)


def load_keys_from_hex(hex_str: str) -> KeyPair:
    """Load a key pair from hex-encoded private key (Rust key file format)."""
    return load_keys_from_bytes(bytes.fromhex(hex_str))


def verify_signature(did: str, message: bytes, signature_hex: str) -> bool:
    """Verify a hex-encoded signature against a DID's public key."""
    try:
        sig = bytes.fromhex(signature_hex)
        # We need the public key - but did:agent only has a hash
        # Verification requires the public key bytes directly
        # This function works when called with public_key_bytes available
        return False  # Cannot verify from DID alone with did:agent method
    except (InvalidSignature, ValueError, IndexError):
        return False


def verify_signature_with_key(public_key_bytes: bytes, message: bytes, signature_hex: str) -> bool:
    """Verify a hex-encoded signature with raw public key bytes."""
    try:
        public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
        sig = bytes.fromhex(signature_hex)
        public_key.verify(sig, message)
        return True
    except (InvalidSignature, ValueError, IndexError):
        return False


def _compute_did(public_key_bytes: bytes) -> str:
    """Compute did:agent DID from public key bytes.

    Uses SHA-256 hash, first 16 bytes as hex. Matches Rust crate exactly.
    """
    h = hashlib.sha256(public_key_bytes).digest()
    short_hash = h[:16].hex()
    return f"did:agent:{short_hash}"
