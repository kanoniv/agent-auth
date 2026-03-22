"""Tests for DX features: exec, status, audit-log, --export, --agent."""

import os

import pytest
from click.testing import CliRunner

from kanoniv_auth.cli import cli
import kanoniv_auth.auth as auth_mod
import kanoniv_auth.registry as registry_mod
import kanoniv_auth.audit as audit_mod


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    key_dir = str(tmp_path / "keys")
    token_dir = str(tmp_path / "tokens")
    registry_path = str(tmp_path / "agents.json")
    audit_path = str(tmp_path / "audit.log")
    os.makedirs(key_dir, exist_ok=True)
    os.makedirs(token_dir, exist_ok=True)

    monkeypatch.setattr(auth_mod, "DEFAULT_KEY_DIR", key_dir)
    monkeypatch.setattr(auth_mod, "DEFAULT_TOKEN_DIR", token_dir)
    monkeypatch.setattr(auth_mod, "_root_keys", None)
    monkeypatch.setattr(registry_mod, "DEFAULT_REGISTRY_PATH", registry_path)
    monkeypatch.setattr(audit_mod, "DEFAULT_AUDIT_PATH", audit_path)

    return tmp_path


@pytest.fixture
def root_key(isolate, runner):
    key_path = str(isolate / "keys" / "root.key")
    runner.invoke(cli, ["init", "-o", key_path])
    return key_path


@pytest.fixture
def named_token(root_key, runner):
    result = runner.invoke(cli, [
        "delegate", "-s", "code.edit,test.run,git.push",
        "-t", "4h", "-n", "claude-code", "-k", root_key,
    ])
    assert result.exit_code == 0
    return result.output.strip()


class TestExec:
    def test_exec_success(self, runner, named_token, isolate):
        result = runner.invoke(cli, [
            "exec", "-s", "code.edit", "-t", named_token, "--", "echo", "hello",
        ])
        assert result.exit_code == 0
        assert "AUTHORIZED" in result.output
        assert "claude-code" in result.output
        assert "SIGNED" in result.output
        assert "success" in result.output

    def test_exec_denied(self, runner, named_token):
        result = runner.invoke(cli, [
            "exec", "-s", "deploy.prod", "-t", named_token, "--", "echo", "hello",
        ])
        assert result.exit_code != 0
        assert "DENIED" in result.output

    def test_exec_captures_failure(self, runner, named_token, isolate):
        result = runner.invoke(cli, [
            "exec", "-s", "code.edit", "-t", named_token, "--", "false",
        ])
        assert result.exit_code != 0
        assert "SIGNED" in result.output
        assert "failure" in result.output

    def test_exec_with_agent_flag(self, runner, named_token, isolate):
        result = runner.invoke(cli, [
            "exec", "-s", "code.edit", "--agent", "claude-code", "--", "echo", "hi",
        ])
        assert result.exit_code == 0
        assert "AUTHORIZED" in result.output


class TestStatus:
    def test_status_active(self, runner, named_token, isolate):
        result = runner.invoke(cli, ["status", "-t", named_token])
        assert result.exit_code == 0
        assert "ACTIVE" in result.output
        assert "claude-code" in result.output
        assert "code.edit" in result.output

    def test_status_no_token(self, runner, isolate):
        result = runner.invoke(cli, ["status"])
        assert "NO TOKEN" in result.output

    def test_status_with_agent(self, runner, named_token, isolate):
        result = runner.invoke(cli, ["status", "--agent", "claude-code"])
        assert result.exit_code == 0
        assert "ACTIVE" in result.output


class TestExport:
    def test_export_outputs_shell(self, runner, root_key, isolate):
        result = runner.invoke(cli, [
            "delegate", "-s", "code.edit", "-t", "1h", "-k", root_key, "--export",
        ])
        assert result.exit_code == 0
        assert result.output.startswith("export KANONIV_TOKEN=")

    def test_export_with_name(self, runner, root_key, isolate):
        result = runner.invoke(cli, [
            "delegate", "-s", "code.edit", "-t", "1h", "-n", "my-agent",
            "-k", root_key, "--export",
        ])
        assert result.exit_code == 0
        assert "export KANONIV_TOKEN=" in result.output


class TestAuditLog:
    def test_shows_entries(self, runner, named_token, isolate):
        # Verify to generate audit entry
        runner.invoke(cli, ["verify", "-s", "code.edit", "-t", named_token])
        result = runner.invoke(cli, ["audit-log"])
        assert result.exit_code == 0
        assert "event(s)" in result.output

    def test_filter_by_agent(self, runner, root_key, isolate):
        # Create two agents
        runner.invoke(cli, ["delegate", "-s", "a", "-t", "1h", "-n", "agent-a", "-k", root_key])
        runner.invoke(cli, ["delegate", "-s", "b", "-t", "1h", "-n", "agent-b", "-k", root_key])
        result = runner.invoke(cli, ["audit-log", "--agent", "agent-a"])
        assert result.exit_code == 0
        # Should only show agent-a events
        assert "agent-a" in result.output

    def test_filter_by_action(self, runner, named_token, isolate):
        runner.invoke(cli, ["verify", "-s", "code.edit", "-t", named_token])
        result = runner.invoke(cli, ["audit-log", "--action", "verify"])
        assert result.exit_code == 0

    def test_empty_log(self, runner, isolate):
        result = runner.invoke(cli, ["audit-log"])
        assert "No audit log entries" in result.output


class TestAgentTokenLoading:
    def test_verify_with_agent_flag(self, runner, named_token, isolate):
        result = runner.invoke(cli, ["verify", "-s", "code.edit", "--agent", "claude-code"])
        assert result.exit_code == 0
        assert "VERIFIED" in result.output

    def test_whoami_with_agent_flag(self, runner, named_token, isolate):
        result = runner.invoke(cli, ["whoami", "--agent", "claude-code"])
        assert result.exit_code == 0
        assert "claude-code" in result.output

    def test_sign_with_agent_flag(self, runner, named_token, isolate):
        result = runner.invoke(cli, ["sign", "-a", "deploy", "--agent", "claude-code"])
        assert result.exit_code == 0
