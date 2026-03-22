"""Ed25519 cryptographic primitives.

Key generation, DID creation, signing, and verification.
Self-contained - no dependency on kanoniv-trust.
"""

from __future__ import annotations

import base64
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

    def save(self, path: str) -> None:
        """Save key pair to a JSON file."""
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "did": self.did,
            "private_key": self.export_private(),
        }, indent=2))
        p.chmod(0o600)

    @classmethod
    def load(cls, path: str) -> "KeyPair":
        """Load key pair from a JSON file."""
        data = json.loads(Path(path).expanduser().read_text())
        return load_keys(data["private_key"])


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
    """Verify a signature against a DID's public key. Returns False on failure."""
    try:
        public_key = _did_to_public_key(did)
        sig = base64.urlsafe_b64decode(signature_b64)
        public_key.verify(sig, message)
        return True
    except (InvalidSignature, ValueError, IndexError):
        return False


def did_to_public_key(did: str) -> Ed25519PublicKey:
    """Extract Ed25519 public key from a did:key identifier."""
    return _did_to_public_key(did)


# --- Internal helpers ---

def _public_key_to_did(public_key: Ed25519PublicKey) -> str:
    """Convert an Ed25519 public key to a did:key identifier."""
    raw = public_key.public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
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
        raise ValueError("Not an Ed25519 key: unexpected multicodec prefix")
    return Ed25519PublicKey.from_public_bytes(decoded[2:])


_B58_ALPHABET = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _base58btc_encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    result = []
    while n > 0:
        n, r = divmod(n, 58)
        result.append(_B58_ALPHABET[r:r + 1])
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
    byte_length = (n.bit_length() + 7) // 8
    result = n.to_bytes(byte_length, "big") if byte_length > 0 else b""
    pad = 0
    for char in s.encode():
        if char == _B58_ALPHABET[0]:
            pad += 1
        else:
            break
    return b"\x00" * pad + result
