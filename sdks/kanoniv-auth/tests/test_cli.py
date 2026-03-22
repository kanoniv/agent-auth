"""Tests for kanoniv-auth CLI commands."""

import os

import pytest
from click.testing import CliRunner

from kanoniv_auth.cli import cli


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def tmp_kanoniv(tmp_path, monkeypatch):
    """Set up a temporary kanoniv directory for keys and tokens."""
    import kanoniv_auth.auth as auth_mod

    key_dir = str(tmp_path / "keys")
    token_dir = str(tmp_path / "tokens")
    os.makedirs(key_dir, exist_ok=True)
    os.makedirs(token_dir, exist_ok=True)

    monkeypatch.setattr(auth_mod, "DEFAULT_KEY_DIR", key_dir)
    monkeypatch.setattr(auth_mod, "DEFAULT_TOKEN_DIR", token_dir)
    monkeypatch.setattr(auth_mod, "_root_keys", None)

    return tmp_path


@pytest.fixture
def root_key(tmp_kanoniv, runner):
    """Generate a root key and return the path."""
    key_path = str(tmp_kanoniv / "keys" / "root.key")
    result = runner.invoke(cli, ["init", "-o", key_path])
    assert result.exit_code == 0, f"init failed: {result.output}"
    return key_path


@pytest.fixture
def token(root_key, runner):
    """Delegate a token with deploy.staging scope."""
    result = runner.invoke(cli, ["delegate", "-s", "deploy.staging", "-t", "4h", "-k", root_key])
    assert result.exit_code == 0, f"delegate failed: {result.output}"
    return result.output.strip()


class TestInit:
    def test_generates_root_key(self, runner, tmp_kanoniv):
        key_path = str(tmp_kanoniv / "keys" / "root.key")
        result = runner.invoke(cli, ["init", "-o", key_path])
        assert result.exit_code == 0
        assert "Root key generated" in result.output
        assert os.path.exists(key_path)

    def test_refuses_overwrite_without_force(self, runner, tmp_kanoniv):
        key_path = str(tmp_kanoniv / "keys" / "root.key")
        runner.invoke(cli, ["init", "-o", key_path])
        result = runner.invoke(cli, ["init", "-o", key_path])
        assert result.exit_code != 0
        assert "already exists" in result.output

    def test_force_overwrites(self, runner, tmp_kanoniv):
        key_path = str(tmp_kanoniv / "keys" / "root.key")
        runner.invoke(cli, ["init", "-o", key_path])
        result = runner.invoke(cli, ["init", "-o", key_path, "--force"])
        assert result.exit_code == 0
        assert "Root key generated" in result.output


class TestDelegate:
    def test_creates_token(self, runner, root_key, tmp_kanoniv):
        result = runner.invoke(cli, ["delegate", "-s", "deploy.staging", "-t", "4h", "-k", root_key])
        assert result.exit_code == 0
        token = result.output.strip()
        assert len(token) > 50

    def test_empty_scopes_fails(self, runner, root_key):
        result = runner.invoke(cli, ["delegate", "-s", "", "-k", root_key])
        assert result.exit_code != 0

    def test_multiple_scopes(self, runner, root_key, tmp_kanoniv):
        result = runner.invoke(cli, ["delegate", "-s", "build,test,deploy.staging", "-t", "1h", "-k", root_key])
        assert result.exit_code == 0

    def test_dry_run(self, runner, root_key, tmp_kanoniv):
        result = runner.invoke(cli, ["delegate", "-s", "deploy.staging", "-t", "4h", "--dry-run"])
        assert result.exit_code == 0
        assert "DRY RUN" in result.output
        assert "deploy.staging" in result.output

    def test_no_root_key_fails(self, runner, tmp_kanoniv):
        result = runner.invoke(cli, ["delegate", "-s", "deploy.staging"])
        assert result.exit_code != 0


class TestVerify:
    def test_valid_token(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["verify", "-s", "deploy.staging", "-t", token])
        assert result.exit_code == 0
        assert "VERIFIED" in result.output

    def test_wrong_scope_denied(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["verify", "-s", "deploy.prod", "-t", token])
        assert result.exit_code != 0


class TestSign:
    def test_signs_envelope(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["sign", "-a", "deploy", "-t", token, "--target", "staging"])
        assert result.exit_code == 0
        assert len(result.output.strip()) > 50


class TestWhoami:
    def test_shows_identity(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["whoami", "-t", token])
        assert result.exit_code == 0
        assert "Agent Identity" in result.output
        assert "did:agent:" in result.output


class TestAudit:
    def test_shows_chain(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["audit", token])
        assert result.exit_code == 0
        assert "Delegation Chain" in result.output
        assert "(root)" in result.output

    def test_shows_execution_envelope(self, runner, token, tmp_kanoniv):
        sign_result = runner.invoke(cli, ["sign", "-a", "deploy", "-t", token])
        envelope = sign_result.output.strip()
        result = runner.invoke(cli, ["audit", envelope])
        assert result.exit_code == 0
        assert "Execution Envelope" in result.output


class TestTokens:
    def test_lists_saved_tokens(self, runner, root_key, tmp_kanoniv):
        runner.invoke(cli, ["delegate", "-s", "build", "-t", "1h", "-k", root_key])
        runner.invoke(cli, ["delegate", "-s", "deploy.staging", "-t", "2h", "-k", root_key])
        result = runner.invoke(cli, ["tokens"])
        assert result.exit_code == 0
        assert "saved token" in result.output

    def test_empty_token_list(self, runner, tmp_kanoniv):
        result = runner.invoke(cli, ["tokens"])
        assert result.exit_code == 0
        assert "No saved tokens" in result.output


class TestRevoke:
    def test_revoke_local_token(self, runner, root_key, tmp_kanoniv):
        result = runner.invoke(cli, ["delegate", "-s", "deploy.staging", "-t", "4h", "-k", root_key])
        token = result.output.strip()
        result = runner.invoke(cli, ["revoke", "-t", token])
        assert result.exit_code == 0
        assert "Deleted" in result.output

    def test_revoke_missing_token_fails(self, runner, tmp_kanoniv):
        result = runner.invoke(cli, ["revoke", "-t", "nonexistent-token"])
        assert result.exit_code != 0

    def test_revoke_no_args_fails(self, runner, tmp_kanoniv):
        result = runner.invoke(cli, ["revoke"])
        assert result.exit_code != 0


class TestEnvToken:
    def test_reads_from_env(self, runner, token, tmp_kanoniv):
        result = runner.invoke(cli, ["verify", "-s", "deploy.staging"], env={"KANONIV_TOKEN": token})
        assert result.exit_code == 0
        assert "VERIFIED" in result.output


class TestVersion:
    def test_version_flag(self, runner):
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "0.2.1" in result.output
