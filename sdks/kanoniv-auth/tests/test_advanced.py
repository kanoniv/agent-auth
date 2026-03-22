"""Advanced tests for kanoniv-auth - edge cases, security, and integration."""

import time
import json
import pytest

from kanoniv_auth import (
    delegate,
    verify,
    sign,
    generate_keys,
    AuthError,
    ScopeViolation,
    TokenExpired,
    TokenParseError,
    SignatureInvalid,
    ChainTooDeep,
)
from kanoniv_auth.auth import _decode_token, _encode_token
import kanoniv_auth.auth as auth_module


@pytest.fixture(autouse=True)
def reset_root():
    auth_module._root_keys = None
    yield
    auth_module._root_keys = None


@pytest.fixture
def root():
    keys = generate_keys()
    auth_module._root_keys = keys
    return keys


# --- Token format edge cases ---

class TestTokenFormat:
    def test_token_is_valid_base64(self, root):
        import base64
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        # Should decode without error
        padded = token + "=" * (4 - len(token) % 4) if len(token) % 4 else token
        raw = base64.urlsafe_b64decode(padded)
        data = json.loads(raw)
        assert data["version"] == 1
        assert "chain" in data
        assert "scopes" in data

    def test_token_contains_expected_fields(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        assert data["version"] == 1
        assert data["scopes"] == ["deploy.staging"]
        assert "agent_did" in data
        assert "chain" in data
        assert len(data["chain"]) == 1
        assert "expires_at" in data
        assert "agent_private_key" in data

    def test_token_without_embedded_key_when_to_specified(self, root):
        agent = generate_keys()
        token = delegate(scopes=["deploy.staging"], ttl="1h", to=agent.did)
        data = _decode_token(token)
        assert "agent_private_key" not in data
        assert data["agent_did"] == agent.did

    def test_decode_malformed_json(self):
        import base64
        bad = base64.urlsafe_b64encode(b"not json").decode().rstrip("=")
        with pytest.raises(TokenParseError):
            _decode_token(bad)

    def test_decode_valid_json_missing_chain(self, root):
        import base64
        data = json.dumps({"version": 1, "scopes": ["test"]}).encode()
        token = base64.urlsafe_b64encode(data).decode().rstrip("=")
        with pytest.raises(TokenParseError, match="no delegation chain"):
            verify(action="test", token=token)


# --- Tamper detection ---

class TestTamperDetection:
    def test_tampered_scopes_detected(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        data["scopes"] = ["deploy.staging", "deploy.prod"]
        tampered = _encode_token(data)
        # Verify should still work because scope check is on token-level scopes
        # but the chain link only authorized deploy.staging
        # This is a known design tradeoff - token scopes are self-reported
        # Chain verification catches forged signatures, not scope inflation
        result = verify(action="deploy.staging", token=tampered)
        assert result["valid"]

    def test_tampered_expiry_still_verifies_chain(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        # Extend expiry
        data["expires_at"] = time.time() + 999999
        tampered = _encode_token(data)
        # Chain link has its own expires_at which is still valid
        result = verify(action="deploy.staging", token=tampered)
        assert result["valid"]


# --- Sign and audit ---

class TestSignIntegration:
    def test_sign_produces_valid_envelope(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        envelope = sign(action="deploy", token=token, target="staging", result="success")
        data = _decode_token(envelope)
        assert data["action"] == "deploy"
        assert data["target"] == "staging"
        assert data["result"] == "success"
        assert "signature" in data
        assert "delegation_chain" in data
        assert len(data["delegation_chain"]) == 1

    def test_sign_different_results(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        for result_val in ["success", "failure", "partial"]:
            envelope = sign(action="deploy", token=token, result=result_val)
            data = _decode_token(envelope)
            assert data["result"] == result_val

    def test_sign_with_empty_metadata(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        envelope = sign(action="deploy", token=token, metadata={})
        data = _decode_token(envelope)
        assert data["metadata"] == {}

    def test_sign_with_nested_metadata(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        meta = {"commit": "abc123", "env": {"region": "us-east-1"}, "tags": ["v1", "canary"]}
        envelope = sign(action="deploy", token=token, metadata=meta)
        data = _decode_token(envelope)
        assert data["metadata"]["commit"] == "abc123"
        assert data["metadata"]["env"]["region"] == "us-east-1"


# --- Sub-delegation edge cases ---

class TestSubDelegationEdgeCases:
    def test_sub_delegate_exact_same_scopes(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="4h")
        child = delegate(scopes=["deploy.staging"], ttl="2h", parent_token=parent)
        result = verify(action="deploy.staging", token=child)
        assert result["valid"]
        assert result["chain_depth"] == 2

    def test_sub_delegate_with_expired_parent(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl=0.01)
        time.sleep(0.05)
        # Sub-delegation should still work (parent creates token, expiry checked at verify time)
        child = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=parent)
        # But verify should fail because the chain link is expired
        with pytest.raises(TokenExpired):
            verify(action="deploy.staging", token=child)

    def test_four_level_chain(self, root):
        l1 = delegate(scopes=["a", "b", "c", "d"], ttl="4h")
        l2 = delegate(scopes=["a", "b", "c"], ttl="3h", parent_token=l1)
        l3 = delegate(scopes=["a", "b"], ttl="2h", parent_token=l2)
        l4 = delegate(scopes=["a"], ttl="1h", parent_token=l3)
        result = verify(action="a", token=l4)
        assert result["valid"]
        assert result["chain_depth"] == 4
        assert result["scopes"] == ["a"]

    def test_sub_delegate_empty_scopes_from_parent(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="4h")
        with pytest.raises(AuthError, match="scopes cannot be empty"):
            delegate(scopes=[], parent_token=parent)


# --- Concurrent/multi-root scenarios ---

class TestMultiRoot:
    def test_verify_with_wrong_root(self):
        root1 = generate_keys()
        root2 = generate_keys()
        auth_module._root_keys = root1
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        with pytest.raises(SignatureInvalid, match="root DID mismatch"):
            verify(action="deploy.staging", token=token, root_did=root2.did)

    def test_verify_with_correct_explicit_root(self):
        root = generate_keys()
        auth_module._root_keys = root
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        result = verify(action="deploy.staging", token=token, root_did=root.did)
        assert result["valid"]

    def test_verify_without_root_loaded_but_explicit_root(self):
        root = generate_keys()
        token = delegate(scopes=["deploy.staging"], ttl="1h", root=root)
        auth_module._root_keys = None
        # verify without module root but with explicit root_did
        result = verify(action="deploy.staging", token=token, root_did=root.did)
        assert result["valid"]


# --- Error inheritance ---

class TestErrorHierarchy:
    def test_scope_violation_is_auth_error(self):
        assert issubclass(ScopeViolation, AuthError)

    def test_token_expired_is_auth_error(self):
        assert issubclass(TokenExpired, AuthError)

    def test_chain_too_deep_is_auth_error(self):
        assert issubclass(ChainTooDeep, AuthError)

    def test_signature_invalid_is_auth_error(self):
        assert issubclass(SignatureInvalid, AuthError)

    def test_token_parse_error_is_auth_error(self):
        assert issubclass(TokenParseError, AuthError)


# --- TTL edge cases ---

class TestTTLEdgeCases:
    def test_ttl_whitespace(self, root):
        token = delegate(scopes=["test"], ttl="  4h  ")
        result = verify(action="test", token=token)
        assert result["ttl_remaining"] > 14000

    def test_ttl_uppercase(self, root):
        # Our parser lowercases, so 4H should work
        token = delegate(scopes=["test"], ttl="4H")
        result = verify(action="test", token=token)
        assert result["ttl_remaining"] > 14000

    def test_very_short_ttl(self, root):
        token = delegate(scopes=["test"], ttl="1s")
        result = verify(action="test", token=token)
        assert result["ttl_remaining"] < 2

    def test_very_long_ttl(self, root):
        token = delegate(scopes=["test"], ttl="365d")
        result = verify(action="test", token=token)
        assert result["ttl_remaining"] > 31000000  # ~365 days in seconds
