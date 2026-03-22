"""Advanced tests - edge cases, security, interop."""

import time
import json
import pytest

from kanoniv_auth import (
    delegate, verify, sign, generate_keys, load_token, list_tokens,
    AuthError, ScopeViolation, TokenExpired, TokenParseError, SignatureInvalid, ChainTooDeep,
)
from kanoniv_auth.auth import _decode_token, _encode_token
import kanoniv_auth.auth as auth_module


@pytest.fixture(autouse=True)
def reset_root(tmp_path):
    auth_module._root_keys = None
    auth_module.DEFAULT_TOKEN_DIR = str(tmp_path / "tokens")
    yield
    auth_module._root_keys = None


@pytest.fixture
def root():
    keys = generate_keys()
    auth_module._root_keys = keys
    return keys


class TestInteroperability:
    def test_did_format_matches_rust(self, root):
        """DID must be did:agent:{32 hex chars}."""
        token = delegate(scopes=["test"], ttl="1h")
        data = _decode_token(token)
        did = data["agent_did"]
        assert did.startswith("did:agent:")
        hex_part = did.split(":")[-1]
        assert len(hex_part) == 32
        int(hex_part, 16)  # must be valid hex

    def test_chain_link_has_rust_fields(self, root):
        """Chain links must have all fields from Rust Delegation struct."""
        token = delegate(scopes=["test"], ttl="1h")
        data = _decode_token(token)
        link = data["chain"][0]
        required_fields = ["issuer_did", "delegate_did", "issuer_public_key", "caveats", "proof", "parent_proof"]
        for field in required_fields:
            assert field in link, f"missing field: {field}"

    def test_issuer_public_key_is_byte_array(self, root):
        """issuer_public_key must be a list of ints (byte array), matching Rust Vec<u8> serialization."""
        token = delegate(scopes=["test"], ttl="1h")
        data = _decode_token(token)
        pub_key = data["chain"][0]["issuer_public_key"]
        assert isinstance(pub_key, list)
        assert len(pub_key) == 32
        assert all(isinstance(b, int) and 0 <= b <= 255 for b in pub_key)

    def test_caveats_format(self, root):
        """Caveats must use {type, value} format matching Rust Caveat enum."""
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        caveats = data["chain"][0]["caveats"]
        assert len(caveats) == 2  # action_scope + expires_at
        assert caveats[0]["type"] == "action_scope"
        assert caveats[0]["value"] == ["deploy.staging"]
        assert caveats[1]["type"] == "expires_at"
        assert isinstance(caveats[1]["value"], str)  # ISO timestamp

    def test_proof_has_signed_message_fields(self, root):
        """Proof must have nonce, payload, signature, signer_did, timestamp."""
        token = delegate(scopes=["test"], ttl="1h")
        data = _decode_token(token)
        proof = data["chain"][0]["proof"]
        assert "nonce" in proof
        assert "payload" in proof
        assert "signature" in proof
        assert "signer_did" in proof
        assert "timestamp" in proof


class TestChainSignatureVerification:
    def test_tampered_payload_caught(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        # Tamper with the signed payload
        data["chain"][0]["proof"]["payload"]["delegate_did"] = "did:agent:tampered"
        tampered = _encode_token(data)
        with pytest.raises(SignatureInvalid):
            verify(action="deploy.staging", token=tampered)

    def test_tampered_signature_caught(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        data["chain"][0]["proof"]["signature"] = "ab" * 64
        tampered = _encode_token(data)
        with pytest.raises(SignatureInvalid):
            verify(action="deploy.staging", token=tampered)

    def test_swapped_public_key_caught(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        # Replace issuer public key with a different key
        other = generate_keys()
        data["chain"][0]["issuer_public_key"] = list(other.public_key_bytes)
        tampered = _encode_token(data)
        with pytest.raises(SignatureInvalid):
            verify(action="deploy.staging", token=tampered)


class TestLocalStorage:
    def test_delegate_saves_token(self, root):
        delegate(scopes=["deploy.staging"], ttl="1h")
        tokens = list_tokens()
        assert len(tokens) == 1
        assert tokens[0]["scopes"] == ["deploy.staging"]

    def test_load_latest_token(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        loaded = load_token()
        assert loaded == token

    def test_multiple_tokens_stored(self, root):
        delegate(scopes=["deploy.staging"], ttl="1h")
        delegate(scopes=["build"], ttl="2h")
        tokens = list_tokens()
        assert len(tokens) == 2

    def test_verify_without_explicit_token(self, root):
        """verify() should auto-load latest token when not specified."""
        delegate(scopes=["deploy.staging"], ttl="1h")
        token = load_token()
        result = verify(action="deploy.staging", token=token)
        assert result["valid"]


class TestSubDelegationEdgeCases:
    def test_four_level_chain(self, root):
        l1 = delegate(scopes=["a", "b", "c", "d"], ttl="4h")
        l2 = delegate(scopes=["a", "b", "c"], ttl="3h", parent_token=l1)
        l3 = delegate(scopes=["a", "b"], ttl="2h", parent_token=l2)
        l4 = delegate(scopes=["a"], ttl="1h", parent_token=l3)
        result = verify(action="a", token=l4)
        assert result["chain_depth"] == 4

    def test_sub_delegate_with_expired_parent(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl=0.01)
        time.sleep(0.05)
        child = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=parent)
        with pytest.raises(TokenExpired):
            verify(action="deploy.staging", token=child)


class TestErrorHierarchy:
    def test_all_errors_inherit_auth_error(self):
        for cls in [ScopeViolation, TokenExpired, ChainTooDeep, SignatureInvalid, TokenParseError]:
            assert issubclass(cls, AuthError)
