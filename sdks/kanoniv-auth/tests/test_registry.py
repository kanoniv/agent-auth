"""Tests for agent registry - persistent identity for named agents."""

import os
import pytest

from kanoniv_auth.registry import (
    register_agent,
    get_agent,
    get_agent_did,
    list_agents,
    remove_agent,
    rename_agent,
    resolve_name,
)
from kanoniv_auth import delegate, verify, init_root
import kanoniv_auth.auth as auth_mod
import kanoniv_auth.registry as registry_mod


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Isolate registry and keys to tmp directory."""
    key_dir = str(tmp_path / "keys")
    token_dir = str(tmp_path / "tokens")
    registry_path = str(tmp_path / "agents.json")
    os.makedirs(key_dir, exist_ok=True)
    os.makedirs(token_dir, exist_ok=True)

    monkeypatch.setattr(auth_mod, "DEFAULT_KEY_DIR", key_dir)
    monkeypatch.setattr(auth_mod, "DEFAULT_TOKEN_DIR", token_dir)
    monkeypatch.setattr(auth_mod, "_root_keys", None)
    monkeypatch.setattr(registry_mod, "DEFAULT_REGISTRY_PATH", registry_path)

    return tmp_path


@pytest.fixture
def root_key(isolate):
    key_path = str(isolate / "keys" / "root.key")
    return init_root(key_path)


class TestRegisterAgent:
    def test_creates_new_agent(self):
        keys = register_agent("claude-code")
        assert keys.did.startswith("did:agent:")

    def test_returns_same_keys_for_same_name(self):
        keys1 = register_agent("claude-code")
        keys2 = register_agent("claude-code")
        assert keys1.did == keys2.did

    def test_different_names_get_different_dids(self):
        k1 = register_agent("claude-code")
        k2 = register_agent("review-bot")
        assert k1.did != k2.did


class TestGetAgent:
    def test_returns_none_for_unknown(self):
        assert get_agent("nonexistent") is None

    def test_returns_keys_for_known(self):
        register_agent("my-agent")
        keys = get_agent("my-agent")
        assert keys is not None
        assert keys.did.startswith("did:agent:")

    def test_get_agent_did(self):
        keys = register_agent("my-agent")
        did = get_agent_did("my-agent")
        assert did == keys.did

    def test_get_agent_did_unknown(self):
        assert get_agent_did("nonexistent") is None


class TestListAgents:
    def test_empty_registry(self):
        assert list_agents() == []

    def test_lists_all_agents(self):
        register_agent("agent-a")
        register_agent("agent-b")
        agents = list_agents()
        names = [a["name"] for a in agents]
        assert "agent-a" in names
        assert "agent-b" in names

    def test_includes_did_and_created_at(self):
        register_agent("test-agent")
        agents = list_agents()
        assert agents[0]["did"].startswith("did:agent:")
        assert agents[0]["created_at"] != ""


class TestRemoveAgent:
    def test_remove_existing(self):
        register_agent("temp-agent")
        assert remove_agent("temp-agent") is True
        assert get_agent("temp-agent") is None

    def test_remove_nonexistent(self):
        assert remove_agent("ghost") is False


class TestRenameAgent:
    def test_rename_preserves_did(self):
        keys = register_agent("old-name")
        assert rename_agent("old-name", "new-name") is True
        assert get_agent("old-name") is None
        new_keys = get_agent("new-name")
        assert new_keys is not None
        assert new_keys.did == keys.did

    def test_rename_nonexistent_fails(self):
        assert rename_agent("ghost", "new") is False

    def test_rename_to_existing_fails(self):
        register_agent("a")
        register_agent("b")
        assert rename_agent("a", "b") is False


class TestResolveName:
    def test_resolve_known_did(self):
        keys = register_agent("claude-code")
        assert resolve_name(keys.did) == "claude-code"

    def test_resolve_unknown_did(self):
        assert resolve_name("did:agent:0000000000000000") is None


class TestDelegateWithName:
    def test_delegate_with_name_persists_identity(self, root_key):
        token1 = delegate(scopes=["code.edit"], ttl="1h", name="claude-code")
        token2 = delegate(scopes=["test.run"], ttl="1h", name="claude-code")

        from kanoniv_auth.auth import _decode_token
        d1 = _decode_token(token1)
        d2 = _decode_token(token2)

        assert d1["agent_did"] == d2["agent_did"]
        assert d1["agent_name"] == "claude-code"
        assert d2["agent_name"] == "claude-code"

    def test_delegate_with_name_is_verifiable(self, root_key):
        token = delegate(scopes=["code.edit", "test.run"], ttl="1h", name="my-agent")
        result = verify(action="code.edit", token=token)
        assert result["valid"] is True

    def test_different_names_different_dids(self, root_key):
        from kanoniv_auth.auth import _decode_token

        t1 = delegate(scopes=["code.edit"], ttl="1h", name="agent-a")
        t2 = delegate(scopes=["code.edit"], ttl="1h", name="agent-b")
        assert _decode_token(t1)["agent_did"] != _decode_token(t2)["agent_did"]

    def test_name_embedded_in_token(self, root_key):
        from kanoniv_auth.auth import _decode_token

        token = delegate(scopes=["deploy.staging"], ttl="4h", name="deploy-bot")
        data = _decode_token(token)
        assert data["agent_name"] == "deploy-bot"

    def test_delegate_without_name_still_works(self, root_key):
        from kanoniv_auth.auth import _decode_token

        token = delegate(scopes=["code.edit"], ttl="1h")
        data = _decode_token(token)
        assert "agent_name" not in data
        assert data["agent_did"].startswith("did:agent:")
