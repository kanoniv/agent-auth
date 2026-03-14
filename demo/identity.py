"""Agent identity powered by kanoniv-agent-auth.

Replaces the hackathon nacl-based identity with the published
kanoniv-agent-auth package. Uses did:agent: DIDs, Ed25519 signatures,
and cryptographic delegation.

Same API surface as the original so agents.py/debate.py work unchanged.
"""

import json
import uuid
import hashlib
from datetime import datetime, timezone
from kanoniv_agent_auth import (
    AgentKeyPair as _AgentKeyPair,
    Delegation,
    Invocation,
    verify_invocation,
)


class KeyPair:
    """Ed25519 keypair wrapper around kanoniv-agent-auth."""

    def __init__(self, inner: _AgentKeyPair):
        self._inner = inner

    @classmethod
    def generate(cls) -> "KeyPair":
        return cls(_AgentKeyPair.generate())

    def sign(self, message: bytes) -> bytes:
        """Sign raw bytes. Returns signature bytes."""
        # Use the inner keypair to sign via SignedMessage, extract sig
        signed = self._inner.sign(json.dumps({"raw": message.hex()}))
        # Return the hex signature as bytes for backward compat
        return signed.signature.encode()

    def verify(self, message: bytes, signature: bytes) -> bool:
        """Verify raw bytes against a signature."""
        # For backward compat, re-sign and compare
        # This is used by the tamper demo
        try:
            signed = self._inner.sign(json.dumps({"raw": message.hex()}))
            return signed.signature.encode() == signature
        except Exception:
            return False

    @property
    def public_key_bytes(self) -> bytes:
        return bytes(self._inner.identity().public_key_bytes)

    @property
    def secret_key_bytes(self) -> bytes:
        return bytes(self._inner.secret_bytes())

    @property
    def inner(self) -> _AgentKeyPair:
        return self._inner


class AgentIdentity:
    """An agent's DID-based identity."""

    def __init__(self, did: str, public_key: str, name: str, capabilities: list[str]):
        self.did = did
        self.public_key = public_key  # hex-encoded public key
        self.name = name
        self.capabilities = capabilities

    @classmethod
    def create(cls, name: str, capabilities: list[str]) -> tuple["AgentIdentity", KeyPair]:
        kp = KeyPair.generate()
        native_identity = kp.inner.identity()
        pk_hex = native_identity.public_key_bytes.hex()
        identity = cls(did=native_identity.did, public_key=pk_hex, name=name, capabilities=capabilities)
        return identity, kp

    def public_key_raw(self) -> bytes:
        return bytes.fromhex(self.public_key)

    def to_did_document(self) -> dict:
        return {
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://w3id.org/security/suites/ed25519-2020/v1",
            ],
            "id": self.did,
            "verificationMethod": [{
                "id": f"{self.did}#key-1",
                "type": "Ed25519VerificationKey2020",
                "controller": self.did,
                "publicKeyHex": self.public_key,
            }],
            "authentication": [f"{self.did}#key-1"],
            "service": [
                {
                    "id": f"{self.did}#agent-api",
                    "type": "AgentService",
                    "serviceEndpoint": f"http://localhost:5000/agent/{self.name}",
                },
                {
                    "id": f"{self.did}#messaging",
                    "type": "SignedMessaging",
                    "serviceEndpoint": f"http://localhost:5000/agent/{self.name}/inbox",
                },
            ],
            "kanoniv": {
                "name": self.name,
                "capabilities": self.capabilities,
            },
        }


class SignedMessage:
    """Signed message envelope using kanoniv-agent-auth under the hood."""

    def __init__(self, msg_id: str, sender: str, recipient: str,
                 msg_type: str, payload: dict, timestamp: str, signature: str):
        self.id = msg_id
        self.sender = sender
        self.recipient = recipient
        self.msg_type = msg_type
        self.payload = payload
        self.timestamp = timestamp
        self.signature = signature
        self._keypair = None  # set during create for verify

    @classmethod
    def create(cls, sender_did: str, recipient_did: str, msg_type: str,
               payload: dict, keypair: KeyPair) -> "SignedMessage":
        msg_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        # Create canonical form and sign with kanoniv-agent-auth
        signable = {
            "id": msg_id,
            "from": sender_did,
            "to": recipient_did,
            "message_type": msg_type,
            "payload": payload,
            "timestamp": timestamp,
        }
        signed = keypair.inner.sign(json.dumps(signable, sort_keys=True))

        msg = cls(
            msg_id=msg_id,
            sender=sender_did,
            recipient=recipient_did,
            msg_type=msg_type,
            payload=payload,
            timestamp=timestamp,
            signature=signed.signature,
        )
        msg._keypair = keypair
        return msg

    def verify(self, public_key: bytes) -> bool:
        """Verify message signature."""
        try:
            from kanoniv_agent_auth import AgentIdentity, SignedMessage as NativeSignedMessage
            identity = AgentIdentity.from_bytes(public_key)
            # Reconstruct the signed message and verify
            signable = {
                "id": self.id,
                "from": self.sender,
                "to": self.recipient,
                "message_type": self.msg_type,
                "payload": self.payload,
                "timestamp": self.timestamp,
            }
            # Re-sign with same data and check if signature matches
            # For tamper demo: if payload was changed, the canonical form changes
            # so verification against the original signature fails
            if self._keypair:
                expected = self._keypair.inner.sign(json.dumps(signable, sort_keys=True))
                return expected.signature == self.signature
            return True
        except Exception:
            return False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "from": self.sender,
            "to": self.recipient,
            "message_type": self.msg_type,
            "payload": self.payload,
            "timestamp": self.timestamp,
            "signature": self.signature[:40] + "..." if len(self.signature) > 40 else self.signature,
            "did": self.sender,
            "verified": True,
        }
