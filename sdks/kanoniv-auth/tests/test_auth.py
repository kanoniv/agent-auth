"""Tests for kanoniv-auth: delegate, verify, sign."""

import time
import pytest

from kanoniv_auth import (
    delegate,
    verify,
    sign,
    init_root,
    load_root,
    load_token,
    list_tokens,
    generate_keys,
    AuthError,
    ScopeViolation,
    TokenExpired,
    ChainTooDeep,
    SignatureInvalid,
    TokenParseError,
)
from kanoniv_auth.auth import _parse_ttl, _decode_token
import kanoniv_auth.auth as auth_module


@pytest.fixture(autouse=True)
def reset_root(tmp_path):
    """Reset module-level root key and token dir before each test."""
    auth_module._root_keys = None
    auth_module.DEFAULT_TOKEN_DIR = str(tmp_path / "tokens")
    yield
    auth_module._root_keys = None


@pytest.fixture
def root():
    keys = generate_keys()
    auth_module._root_keys = keys
    return keys


# --- delegate() ---

class TestDelegate:
    def test_basic_delegation(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        assert isinstance(token, str)
        assert len(token) > 50

    def test_token_uses_did_agent(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        assert data["agent_did"].startswith("did:agent:")

    def test_token_has_rust_compatible_chain(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        data = _decode_token(token)
        chain = data["chain"]
        assert len(chain) == 1
        link = chain[0]
        # Rust Delegation struct fields
        assert "issuer_did" in link
        assert "delegate_did" in link
        assert "issuer_public_key" in link
        assert "caveats" in link
        assert "proof" in link
        # Proof has signature
        assert "signature" in link["proof"]
        assert "payload" in link["proof"]

    def test_multiple_scopes(self, root):
        token = delegate(scopes=["build", "test", "deploy.staging"], ttl="1h")
        result = verify(action="build", token=token)
        assert result["valid"]

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
        assert 14300 < result["ttl_remaining"] < 14500

    def test_no_ttl_no_expiry(self, root):
        token = delegate(scopes=["deploy.staging"])
        result = verify(action="deploy.staging", token=token)
        assert result["expires_at"] is None

    def test_token_saved_locally(self, root, tmp_path):
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        tokens = list_tokens()
        assert len(tokens) >= 1
        latest = load_token()
        assert latest == token


# --- Sub-delegation ---

class TestSubDelegation:
    def test_sub_delegate_narrower_scopes(self, root):
        parent = delegate(scopes=["build", "test", "deploy.staging"], ttl="4h")
        child = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=parent)
        result = verify(action="deploy.staging", token=child)
        assert result["valid"]
        assert result["chain_depth"] == 2

    def test_sub_delegate_cannot_widen(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="4h")
        with pytest.raises(ScopeViolation):
            delegate(scopes=["deploy.prod"], ttl="1h", parent_token=parent)

    def test_sub_delegate_ttl_capped_by_parent(self, root):
        parent = delegate(scopes=["deploy.staging"], ttl="1h")
        child = delegate(scopes=["deploy.staging"], ttl="4h", parent_token=parent)
        result = verify(action="deploy.staging", token=child)
        assert result["ttl_remaining"] < 3700

    def test_three_level_chain(self, root):
        l1 = delegate(scopes=["build", "test", "deploy.staging"], ttl="4h")
        l2 = delegate(scopes=["test", "deploy.staging"], ttl="2h", parent_token=l1)
        l3 = delegate(scopes=["deploy.staging"], ttl="1h", parent_token=l2)
        result = verify(action="deploy.staging", token=l3)
        assert result["valid"]
        assert result["chain_depth"] == 3


# --- verify() ---

class TestVerify:
    def test_valid_scope(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        result = verify(action="deploy.staging", token=token)
        assert result["valid"]
        assert result["root_did"] == root.did

    def test_wrong_scope_raises(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        with pytest.raises(ScopeViolation) as exc_info:
            verify(action="deploy.prod", token=token)
        assert "deploy.prod" in str(exc_info.value)
        assert "You have:" in str(exc_info.value)
        assert "You need:" in str(exc_info.value)

    def test_expired_token_raises(self, root):
        token = delegate(scopes=["deploy.staging"], ttl=0.01)
        time.sleep(0.05)
        with pytest.raises(TokenExpired):
            verify(action="deploy.staging", token=token)

    def test_invalid_token(self, root):
        with pytest.raises(TokenParseError):
            verify(action="deploy.staging", token="not-valid!!!")

    def test_root_did_mismatch(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        other = generate_keys()
        with pytest.raises(SignatureInvalid, match="root DID mismatch"):
            verify(action="deploy.staging", token=token, root_did=other.did)

    def test_chain_signature_verified(self, root):
        """Tampered chain signature should be caught."""
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        data = _decode_token(token)
        # Tamper with the signature
        data["chain"][0]["proof"]["signature"] = "00" * 64
        from kanoniv_auth.auth import _encode_token
        tampered = _encode_token(data)
        with pytest.raises(SignatureInvalid):
            verify(action="deploy.staging", token=tampered)


# --- sign() ---

class TestSign:
    def test_basic_sign(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        envelope = sign(action="deploy", token=token, target="staging")
        data = _decode_token(envelope)
        assert data["action"] == "deploy"
        assert data["target"] == "staging"
        assert "signature" in data
        assert "delegation_chain" in data

    def test_sign_with_metadata(self, root):
        token = delegate(scopes=["deploy.staging"], ttl="4h")
        envelope = sign(action="deploy", token=token, metadata={"commit": "abc123"})
        data = _decode_token(envelope)
        assert data["metadata"]["commit"] == "abc123"


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


# --- Error messages ---

class TestErrors:
    def test_scope_violation_message(self):
        err = ScopeViolation("deploy.prod", ["deploy.staging"], "did:agent:abc")
        assert "You have:" in str(err)
        assert "You need:" in str(err)
        assert "request-scope" in str(err)

    def test_token_expired_message(self):
        assert "30s ago" in str(TokenExpired(30.0))
        assert "5m ago" in str(TokenExpired(300.0))


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
        auth_module._root_keys = None
        load_root(key_path)
        token = delegate(scopes=["deploy.staging"], ttl="1h")
        result = verify(action="deploy.staging", token=token)
        assert result["valid"]

    def test_rust_key_file_compatible(self, tmp_path):
        """Keys saved by Python can be loaded and produce same DID."""
        import json
        key_path = str(tmp_path / "root.key")
        keys = init_root(key_path)
        data = json.loads(open(key_path).read())
        # Rust format: hex-encoded private_key
        assert len(data["private_key"]) == 64
        # Reload from hex
        from kanoniv_auth.crypto import load_keys_from_hex
        reloaded = load_keys_from_hex(data["private_key"])
        assert reloaded.did == keys.did
