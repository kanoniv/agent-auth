"""Tests for kanoniv-auth: delegate, verify, sign."""

import time
import pytest

from kanoniv_auth import (
    delegate,
    verify,
    sign,
    init_root,
    load_root,
    generate_keys,
    AuthError,
    ScopeViolation,
    TokenExpired,
    ChainTooDeep,
    SignatureInvalid,
    TokenParseError,
)
from kanoniv_auth.auth import _parse_ttl, _root_keys
import kanoniv_auth.auth as auth_module


@pytest.fixture(autouse=True)
def reset_root():
    """Reset module-level root key before each test."""
    auth_module._root_keys = None
    yield
    auth_module._root_keys = None


@pytest.fixture
def root():
    """Generate a fresh root key pair."""
    keys = generate_keys()
    auth_module._root_keys = keys
    return keys


# --- delegate() ---

class TestDelegate:
    def test_basic_delegation(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        assert isinstance(token, str)
        assert len(token) > 50  # base64 encoded, not trivially short

    def test_multiple_scopes(self, root):
        token = delegate(scopes=["build", "test", "deploy.staging"], ttl="1h")
        result = verify(action="build", token=token)
        assert result["valid"]
        assert sorted(result["scopes"]) == ["build", "deploy.staging", "test"]

    def test_empty_scopes_raises(self, root):
        with pytest.raises(AuthError, match="scopes cannot be empty"):
            delegate(scopes=[], ttl="4h")

    def test_no_root_key_raises(self):
        with pytest.raises(AuthError, match="No root key"):
            delegate(scopes=["deploy.staging"], ttl="4h")

    def test_explicit_root_key(self):
        keys = generate_keys()
        token = delegate(scopes=["deploy.staging"], ttl="4h", root=keys)
        result = verify(action="deploy.staging", token=token, root_did=keys.did)
        assert result["valid"]

    def test_ttl_string_hours(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        result = verify(action="deploy.staging", token=token)
        assert result["ttl_remaining"] is not None
        assert 14300 < result["ttl_remaining"] < 14500  # ~4 hours

    def test_ttl_string_minutes(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="30m")
        result = verify(action="deploy.staging", token=token)
        assert 1700 < result["ttl_remaining"] < 1900  # ~30 min

    def test_ttl_string_days(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1d")
        result = verify(action="deploy.staging", token=token)
        assert 86300 < result["ttl_remaining"] < 86500  # ~1 day

    def test_ttl_float_seconds(self, root):
        token = delegate(scopes=["deploy.staging"], ttl=3600.0)
        result = verify(action="deploy.staging", token=token)
        assert 3500 < result["ttl_remaining"] < 3700

    def test_no_ttl_no_expiry(self, root):
        token = delegate(scopes=["deploy.staging"])
        result = verify(action="deploy.staging", token=token)
        assert result["expires_at"] is None
        assert result["ttl_remaining"] is None

    def test_delegate_to_specific_did(self, root):
        agent = generate_keys()
        token = delegate(scopes=["deploy.staging"], ttl="1h", to=agent.did)
        # Token was issued to a specific DID - no embedded keys
        result = verify(action="deploy.staging", token=token)
        assert result["agent_did"] == agent.did


# --- Sub-delegation ---

class TestSubDelegation:
    def test_sub_delegate_narrower_scopes(self, root):
        parent = delegate(scopes=["build", "test", "deploy.staging"], ttl="4h")
        child = delegate(
            scopes=["deploy.staging"],
            ttl="1h",
            parent_token=parent,
        )
        result = verify(action="deploy.staging", token=child)
        assert result["valid"]
        assert result["chain_depth"] == 2
        assert result["scopes"] == ["deploy.staging"]

    def test_sub_delegate_cannot_widen(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="4h")
        with pytest.raises(ScopeViolation) as exc_info:
            delegate(
                scopes=["deploy.prod"],
                ttl="1h",
                parent_token=parent,
            )
        assert "deploy.prod" in str(exc_info.value)
        assert "deploy.staging" in str(exc_info.value)

    def test_sub_delegate_ttl_capped_by_parent(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="1h")
        child = delegate(
            scopes=["deploy.staging"],
            ttl="4h",  # longer than parent
            parent_token=parent,
        )
        result = verify(action="deploy.staging", token=child)
        # Should be capped at parent's expiry (~1h, not 4h)
        assert result["ttl_remaining"] < 3700

    def test_three_level_chain(self, root):
        l1 = delegate(scopes=["build", "test", "deploy.staging"], ttl="4h")
        l2 = delegate(scopes=["test", "deploy.staging"], ttl="2h", parent_token=l1)
        l3 = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=l2)

        result = verify(action="deploy.staging", token=l3)
        assert result["valid"]
        assert result["chain_depth"] == 3
        assert result["scopes"] == ["deploy.staging"]

    def test_three_level_chain_scope_violation(self, root):
        l1 = delegate(scopes=["build", "test", "deploy.staging"], ttl="4h")
        l2 = delegate(scopes=["deploy.staging"], ttl="2h", parent_token=l1)
        l3 = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=l2)

        with pytest.raises(ScopeViolation):
            verify(action="build", token=l3)


# --- verify() ---

class TestVerify:
    def test_valid_scope(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        result = verify(action="deploy.staging", token=token)
        assert result["valid"] is True
        assert result["chain_depth"] == 1
        assert result["root_did"] == root.did

    def test_wrong_scope_raises(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        with pytest.raises(ScopeViolation) as exc_info:
            verify(action="deploy.prod", token=token)
        err = exc_info.value
        assert err.scope == "deploy.prod"
        assert "deploy.staging" in err.has
        assert "You have:" in str(err)
        assert "You need:" in str(err)

    def test_expired_token_raises(self, root):
        token = delegate(scopes=["deploy.staging"], ttl=0.01)
        time.sleep(0.05)
        with pytest.raises(TokenExpired) as exc_info:
            verify(action="deploy.staging", token=token)
        assert "EXPIRED" in str(exc_info.value)

    def test_invalid_token_string(self, root):
        with pytest.raises(TokenParseError):
            verify(action="deploy.staging", token="not-a-valid-token!!!")

    def test_empty_token(self, root):
        with pytest.raises(TokenParseError):
            verify(action="deploy.staging", token="")

    def test_root_did_mismatch(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        other = generate_keys()
        with pytest.raises(SignatureInvalid, match="root DID mismatch"):
            verify(action="deploy.staging", token=token, root_did=other.did)

    def test_verify_returns_ttl_remaining(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="2h")
        result = verify(action="deploy.staging", token=token)
        assert result["ttl_remaining"] is not None
        assert 7100 < result["ttl_remaining"] < 7300


# --- sign() ---

class TestSign:
    def test_basic_sign(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        envelope = sign(
            action="deploy",
            token=token,
            target="staging",
            result="success",
        )
        assert isinstance(envelope, str)
        assert len(envelope) > 100

    def test_sign_with_metadata(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        envelope = sign(
            action="deploy",
            token=token,
            target="staging",
            result="success",
            metadata={"commit": "abc123", "duration_ms": 4500},
        )
        # Decode and check metadata is included
        from kanoniv_auth.auth import _decode_token
        data = _decode_token(envelope)
        assert data["metadata"]["commit"] == "abc123"
        assert data["action"] == "deploy"
        assert data["target"] == "staging"
        assert data["result"] == "success"
        assert "signature" in data
        assert "delegation_chain" in data

    def test_sign_without_agent_keys_raises(self, root):
        agent = generate_keys()
        token = delegate(scopes=["deploy.staging"], ttl="4h", to=agent.did)
        with pytest.raises(AuthError, match="does not contain agent keys"):
            sign(action="deploy", token=token)


# --- TTL parsing ---

class TestParseTTL:
    def test_hours(self):
        assert _parse_ttl("4h") == 14400

    def test_minutes(self):
        assert _parse_ttl("30m") == 1800

    def test_days(self):
        assert _parse_ttl("1d") == 86400

    def test_seconds_explicit(self):
        assert _parse_ttl("3600s") == 3600

    def test_seconds_implicit(self):
        assert _parse_ttl("3600") == 3600

    def test_float_passthrough(self):
        assert _parse_ttl(3600.0) == 3600.0

    def test_invalid_format(self):
        with pytest.raises(AuthError, match="Invalid TTL"):
            _parse_ttl("forever")

    def test_zero_raises(self):
        with pytest.raises(AuthError, match="positive"):
            _parse_ttl(0)

    def test_negative_raises(self):
        with pytest.raises(AuthError, match="positive"):
            _parse_ttl(-1)


# --- Error formatting ---

class TestErrorMessages:
    def test_scope_violation_message(self):
        err = ScopeViolation(
            scope="deploy.prod",
            has=["deploy.staging"],
            delegator_did="did:key:z6MkTest",
        )
        msg = str(err)
        assert 'scope "deploy.prod" not in delegation' in msg
        assert "You have:" in msg
        assert "You need:" in msg
        assert "request-scope" in msg
        assert "did:key:z6MkTest" in msg

    def test_token_expired_seconds(self):
        err = TokenExpired(30.0)
        assert "30s ago" in str(err)

    def test_token_expired_minutes(self):
        err = TokenExpired(300.0)
        assert "5m ago" in str(err)

    def test_token_expired_hours(self):
        err = TokenExpired(7200.0)
        assert "2.0h ago" in str(err)

    def test_chain_too_deep(self):
        err = ChainTooDeep(33, 32)
        assert "33" in str(err)
        assert "32" in str(err)

    def test_signature_invalid(self):
        err = SignatureInvalid(2, "did:key:z6MkBad")
        assert "link 2" in str(err)
        assert "did:key:z6MkBad" in str(err)


# --- Key persistence ---

class TestKeyPersistence:
    def test_init_and_load_root(self, tmp_path):
        key_path = str(tmp_path / "root.key")
        keys = init_root(key_path)
        loaded = load_root(key_path)
        assert keys.did == loaded.did

    def test_delegate_after_load(self, tmp_path):
        key_path = str(tmp_path / "root.key")
        init_root(key_path)

        # Reset and reload
        auth_module._root_keys = None
        load_root(key_path)

        token = delegate(scopes=["deploy.staging"], ttl="1h")
        result = verify(action="deploy.staging", token=token)
        assert result["valid"]
