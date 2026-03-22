"""kanoniv-auth CLI - Sudo for AI agents."""

from __future__ import annotations

import os
import sys
import time

import click

from kanoniv_auth import (
    delegate,
    verify,
    sign,
    init_root,
    load_root,
    load_token,
    list_tokens,
    AuthError,
    ScopeViolation,
    TokenExpired,
)
from kanoniv_auth.auth import _decode_token
import kanoniv_auth.auth as auth_module


def _get_token(token: str | None, agent: str | None = None) -> str:
    """Get token from arg, agent name, env, or local storage."""
    if token:
        return token
    if agent:
        # Load most recent token for this agent from token dir
        from pathlib import Path
        token_dir = Path(auth_module.DEFAULT_TOKEN_DIR).expanduser()
        from kanoniv_auth.registry import get_agent_did
        agent_did = get_agent_did(agent)
        if agent_did and token_dir.exists():
            did_short = agent_did.split(":")[-1][:12]
            for f in sorted(token_dir.glob(f"*{did_short}*.token"), reverse=True):
                return f.read_text().strip()
        click.echo(f"Error: No token found for agent '{agent}'.", err=True)
        sys.exit(1)
    env = os.environ.get("KANONIV_TOKEN")
    if env:
        return env
    try:
        return load_token()
    except AuthError:
        click.echo("Error: No token. Pass --token, --agent, set KANONIV_TOKEN, or delegate first.", err=True)
        sys.exit(1)


def _format_duration(secs: float) -> str:
    if secs < 60:
        return f"{secs:.0f}s"
    elif secs < 3600:
        return f"{secs / 60:.0f}m"
    else:
        return f"{secs / 3600:.1f}h"


@click.group()
@click.version_option(version=__import__("kanoniv_auth").__version__)
def cli():
    """Sudo for AI agents. Replace API keys with cryptographic delegation."""
    pass


@cli.command()
@click.option("--output", "-o", default=None, help="Output path for key file")
@click.option("--force", is_flag=True, help="Overwrite existing key")
def init(output: str | None, force: bool):
    """Generate a new root key pair."""
    from pathlib import Path

    path = output or str(Path("~/.kanoniv/root.key").expanduser())
    if Path(path).exists() and not force:
        click.echo(f"Key already exists at {path}. Use --force to overwrite.", err=True)
        sys.exit(1)

    keys = init_root(path)
    click.secho("Root key generated.", fg="green", bold=True)
    click.echo(f"  DID:  {keys.did}")
    click.echo(f"  Path: {path}")
    click.echo()
    click.secho("  WARNING: Treat this like an SSH key. Don't share it.", fg="yellow", bold=True)


@cli.command("install-skill")
def install_skill_cmd():
    """Install /delegate, /audit, and /status skills into Claude Code."""
    from pathlib import Path
    import shutil
    import importlib.resources

    skills_dir = Path.home() / ".claude" / "skills"
    pkg_skill = Path(__file__).parent / "skill"

    if not pkg_skill.exists():
        click.echo("Error: skill files not found in package. Reinstall: pip install kanoniv-auth", err=True)
        sys.exit(1)

    # Install /delegate
    delegate_dir = skills_dir / "delegate" / "bin"
    delegate_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pkg_skill / "delegate.md", skills_dir / "delegate" / "SKILL.md")
    for script in ["check-scope.sh", "check-edit-scope.sh", "log-action.sh"]:
        dest = delegate_dir / script
        shutil.copy2(pkg_skill / "bin" / script, dest)
        dest.chmod(0o755)

    # Install /audit
    audit_dir = skills_dir / "audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pkg_skill / "audit" / "SKILL.md", audit_dir / "SKILL.md")

    # Install /status
    status_dir = skills_dir / "status"
    status_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(pkg_skill / "status" / "SKILL.md", status_dir / "SKILL.md")

    click.secho("Installed 3 kanoniv-auth skills:", fg="green", bold=True)
    click.echo()
    click.echo("  /delegate  - Start a scoped session (with enforcement hooks)")
    click.echo("  /audit     - View the agent audit trail")
    click.echo("  /status    - Check current delegation status")
    click.echo()
    click.echo("Start Claude Code and type /delegate to begin.")


@cli.command("install-hook")
@click.option("--repo", "-r", default=".", help="Path to git repository")
@click.option("--force", is_flag=True, help="Overwrite existing pre-push hook")
def install_hook_cmd(repo: str, force: bool):
    """Install Git pre-push hook for scope enforcement.

    Adds a pre-push hook that verifies git.push.{repo}.{branch} scope
    before allowing pushes. Works invisibly - just git push as normal.
    """
    from pathlib import Path
    import shutil
    import subprocess

    # Find git root
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=repo, capture_output=True, text=True,
        )
        if result.returncode != 0:
            click.echo(f"Error: '{repo}' is not a git repository.", err=True)
            sys.exit(1)
        git_root = Path(result.stdout.strip())
    except FileNotFoundError:
        click.echo("Error: git not found.", err=True)
        sys.exit(1)

    hooks_dir = git_root / ".git" / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook_dest = hooks_dir / "pre-push"

    if hook_dest.exists() and not force:
        # Check if it's already our hook
        content = hook_dest.read_text()
        if "kanoniv-auth" in content:
            click.echo("kanoniv-auth pre-push hook already installed.")
            return
        click.echo(f"A pre-push hook already exists at {hook_dest}. Use --force to overwrite.", err=True)
        sys.exit(1)

    # Copy our hook
    hook_src = Path(__file__).parent / "hooks" / "pre-push"
    if not hook_src.exists():
        click.echo("Error: hook file not found in package. Reinstall: pip install kanoniv-auth", err=True)
        sys.exit(1)

    shutil.copy2(hook_src, hook_dest)
    hook_dest.chmod(0o755)

    repo_name = git_root.name
    click.secho(f"Installed pre-push hook for {repo_name}", fg="green", bold=True)
    click.echo()
    click.echo("  Every git push will now verify scope before pushing.")
    click.echo(f"  Required scope format: git.push.{repo_name}.<branch>")
    click.echo()
    click.echo("  Example delegation:")
    click.echo(f"    kanoniv-auth delegate --scopes git.push.{repo_name}.main --ttl 4h")
    click.echo()
    click.echo("  Remove: rm .git/hooks/pre-push")


@cli.command("delegate")
@click.option("--scopes", "-s", required=True, help="Comma-separated scopes")
@click.option("--ttl", "-t", default=None, help='Time-to-live (e.g. "4h", "30m")')
@click.option("--name", "-n", default=None, help="Agent name (persistent identity across sessions)")
@click.option("--key", "-k", default=None, help="Root key file path")
@click.option("--parent", default=None, help="Parent token for sub-delegation")
@click.option("--export", is_flag=True, help="Output as shell export (eval-able)")
@click.option("--dry-run", is_flag=True, help="Show what would happen without signing")
def delegate_cmd(scopes: str, ttl: str | None, name: str | None, key: str | None, parent: str | None, export: bool, dry_run: bool):
    """Issue a delegation token."""
    scope_list = [s.strip() for s in scopes.split(",") if s.strip()]
    if not scope_list:
        click.echo("Error: --scopes is required.", err=True)
        sys.exit(1)

    if dry_run:
        click.secho("[DRY RUN] Would create delegation:", fg="yellow", bold=True)
        click.echo(f"  Scopes:  {scope_list}")
        click.echo(f"  TTL:     {ttl or 'no expiry'}")
        if name:
            click.echo(f"  Agent:   {name} (persistent identity)")
        click.echo(f"  Type:    {'sub-delegation' if parent else 'root delegation'}")
        return

    try:
        if not parent:
            if key:
                load_root(key)
            else:
                from pathlib import Path
                default = str(Path(auth_module.DEFAULT_KEY_DIR).expanduser() / "root.key")
                if Path(default).exists():
                    load_root(default)
                else:
                    click.echo(f"No root key at {default}. Run: kanoniv-auth init", err=True)
                    sys.exit(1)

        token = delegate(scopes=scope_list, ttl=ttl, name=name, parent_token=parent)
        if export:
            click.echo(f"export KANONIV_TOKEN={token}")
        else:
            click.echo(token)
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("verify")
@click.option("--scope", "-s", required=True, help="Scope to verify")
@click.option("--token", "-t", default=None, help="Delegation token (or $KANONIV_TOKEN or latest)")
@click.option("--agent", "-a", default=None, help="Load token by agent name")
def verify_cmd(scope: str, token: str | None, agent: str | None):
    """Verify a delegation token against an action."""
    token = _get_token(token, agent=agent)
    try:
        result = verify(action=scope, token=token)
        ttl_str = f"{_format_duration(result['ttl_remaining'])} remaining" if result["ttl_remaining"] else "no expiry"

        click.secho("VERIFIED", fg="green", bold=True)
        click.echo(f"  Agent:   {result['agent_did']}")
        click.echo(f"  Root:    {result['root_did']}")
        click.echo(f"  Scopes:  {result['scopes']}")
        click.echo(f"  Expires: {ttl_str}")
        click.echo(f"  Chain:   {result['chain_depth']} link(s)")
    except (ScopeViolation, TokenExpired, AuthError) as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("sign")
@click.option("--action", "-a", required=True, help="Action performed")
@click.option("--token", "-t", default=None, help="Delegation token")
@click.option("--agent", default=None, help="Load token by agent name")
@click.option("--target", default="", help="Target of the action")
@click.option("--result", "result_", default="success", help="Result (success/failure/partial)")
def sign_cmd(action: str, token: str | None, agent: str | None, target: str, result_: str):
    """Sign an execution envelope."""
    token = _get_token(token, agent=agent)
    try:
        envelope = sign(action=action, token=token, target=target, result=result_)
        click.echo(envelope)
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("whoami")
@click.option("--token", "-t", default=None, help="Delegation token")
@click.option("--agent", "-a", default=None, help="Load token by agent name")
def whoami_cmd(token: str | None, agent: str | None):
    """Show the identity behind a token."""
    token = _get_token(token, agent=agent)
    try:
        data = _decode_token(token)
        chain = data.get("chain", [])
        scopes = data.get("scopes", [])
        agent_did = data.get("agent_did", "unknown")
        root_did = chain[0].get("issuer_did", "?") if chain else "?"

        agent_name = data.get("agent_name")
        # Also try reverse lookup from registry
        if not agent_name:
            from kanoniv_auth.registry import resolve_name
            agent_name = resolve_name(agent_did)

        click.secho("Agent Identity", bold=True)
        if agent_name:
            click.secho(f"  Name:    {agent_name}", fg="cyan", bold=True)
        click.echo(f"  DID:     {agent_did}")
        click.echo(f"  Root:    {root_did}")
        click.echo(f"  Scopes:  {scopes}")
        click.echo(f"  Chain:   {len(chain)} link(s)")

        expires = data.get("expires_at")
        if expires:
            remaining = expires - time.time()
            if remaining > 0:
                click.secho(f"  TTL:     {_format_duration(remaining)} remaining", fg="green")
            else:
                click.secho(f"  TTL:     expired {_format_duration(-remaining)} ago", fg="red")
        else:
            click.echo("  TTL:     no expiry")

        if data.get("agent_private_key"):
            click.echo("  Keys:    embedded (can sub-delegate and sign)")
        else:
            click.echo("  Keys:    external (signing requires own key)")
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("audit")
@click.argument("data")
def audit_cmd(data: str):
    """Pretty-print a delegation chain or execution envelope."""
    try:
        decoded = _decode_token(data)

        if decoded.get("action"):
            click.secho("Execution Envelope", bold=True)
            click.echo(f"  Agent:   {decoded.get('agent_did', '?')}")
            click.echo(f"  Action:  {decoded.get('action', '?')}")
            click.echo(f"  Target:  {decoded.get('target', '')}")
            click.echo(f"  Result:  {decoded.get('result', '?')}")
            click.echo()

        chain = decoded.get("delegation_chain") or decoded.get("chain", [])
        if chain:
            click.secho("Delegation Chain", bold=True)
            for i, link in enumerate(chain):
                issuer = link.get("issuer_did", "?")
                deleg = link.get("delegate_did", "?")
                indent = "  " * (i + 1)

                if i == 0:
                    short = issuer[:30] + "..." if len(issuer) > 30 else issuer
                    click.echo(f"  {short} (root)")

                d_short = deleg[:30] + "..." if len(deleg) > 30 else deleg

                # Extract scopes from caveats
                scope_str = ""
                for c in link.get("caveats", []):
                    if c.get("type") == "action_scope":
                        scope_str = ", ".join(c.get("value", []))

                click.echo(f"{indent}|-- {d_short}" + (f" [{scope_str}]" if scope_str else ""))

            click.echo()
            click.echo(f"  Chain depth: {len(chain)}")
        else:
            click.echo("  No delegation chain found.")
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("tokens")
def tokens_cmd():
    """List saved delegation tokens."""
    tokens = list_tokens()
    if not tokens:
        click.echo("No saved tokens. Run: kanoniv-auth delegate --scopes <scopes> --ttl <ttl>")
        return

    click.secho(f"{len(tokens)} saved token(s):", bold=True)
    click.echo()
    for t in tokens:
        status = click.style("expired", fg="red") if t["expired"] else click.style("active", fg="green")
        scopes = ", ".join(t["scopes"])
        ttl = ""
        if t["expires_at"]:
            remaining = t["expires_at"] - time.time()
            ttl = _format_duration(abs(remaining)) + (" remaining" if remaining > 0 else " ago")
        else:
            ttl = "no expiry"
        click.echo(f"  {t['file']}")
        click.echo(f"    Agent:  {t['agent_did']}")
        click.echo(f"    Scopes: [{scopes}]")
        click.echo(f"    TTL:    {ttl}  [{status}]")
        click.echo()


@cli.command("revoke")
@click.option("--token", "-t", default=None, help="Token to revoke")
@click.option("--service", default=None, help="Delegation service URL (e.g. http://localhost:7400)")
@click.option("--delegation-id", default=None, help="Delegation ID to revoke on service")
def revoke_cmd(token: str | None, service: str | None, delegation_id: str | None):
    """Revoke a delegation token."""
    import json
    from pathlib import Path

    if service and delegation_id:
        # Revoke via service API
        import urllib.request
        try:
            req = urllib.request.Request(
                f"{service.rstrip('/')}/revoke",
                data=json.dumps({"delegation_id": delegation_id}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req)
            result = json.loads(resp.read())
            if result.get("ok"):
                click.secho(f"Revoked delegation {delegation_id}", fg="green")
            else:
                click.echo(f"Error: {result.get('error', 'unknown')}", err=True)
                sys.exit(1)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)
    else:
        # Local revoke: delete token file
        token_dir = Path(auth_module.DEFAULT_TOKEN_DIR).expanduser()
        if token:
            # Find and delete the token file matching this token
            deleted = False
            for f in token_dir.glob("*.token"):
                if f.read_text().strip() == token.strip():
                    f.unlink()
                    click.secho(f"Deleted local token: {f.name}", fg="green")
                    deleted = True
            if not deleted:
                click.echo("Token not found in local storage.", err=True)
                sys.exit(1)
        else:
            click.echo("Specify --token or --service + --delegation-id", err=True)
            sys.exit(1)


@cli.command("exec")
@click.option("--scope", "-s", required=True, help="Required scope for this command")
@click.option("--token", "-t", default=None, help="Delegation token")
@click.option("--agent", "-a", default=None, help="Load token by agent name")
@click.argument("command", nargs=-1, required=True)
def exec_cmd(scope: str, token: str | None, agent: str | None, command: tuple[str, ...]):
    """Verify scope, run a command, sign the result. The 'sudo' experience.

    Usage: kanoniv-auth exec --scope deploy.staging -- ./deploy.sh staging
    """
    import subprocess

    token_str = _get_token(token, agent=agent)

    # Step 1: Verify
    try:
        result = verify(action=scope, token=token_str)
    except (ScopeViolation, TokenExpired, AuthError) as e:
        click.secho("DENIED", fg="red", bold=True)
        click.echo(f"  {e}", err=True)
        sys.exit(1)

    agent_name = None
    try:
        data = _decode_token(token_str)
        agent_name = data.get("agent_name")
    except Exception:
        pass

    name_display = f" ({agent_name})" if agent_name else ""
    click.secho(f"AUTHORIZED{name_display}", fg="green", bold=True)
    click.echo(f"  Scope: {scope}")
    click.echo(f"  Agent: {result['agent_did'][:30]}...")
    click.echo()

    # Step 2: Execute
    cmd_str = " ".join(command)
    click.echo(f"  $ {cmd_str}")
    click.echo()

    proc = subprocess.run(list(command), capture_output=False)
    exit_code = proc.returncode
    exec_result = "success" if exit_code == 0 else f"failure(exit={exit_code})"

    click.echo()

    # Step 3: Sign
    try:
        envelope = sign(action=scope, token=token_str, target=cmd_str, result=exec_result)
        click.secho(f"SIGNED (result={exec_result})", fg="green" if exit_code == 0 else "red", bold=True)

        # Log the exec event
        from kanoniv_auth.audit import log_event
        log_event(
            action="exec",
            detail=f"scope={scope} cmd={cmd_str[:30]} exit={exit_code}",
            result=exec_result,
            agent_name=agent_name,
            agent_did=result.get("agent_did"),
        )
    except AuthError as e:
        click.echo(f"  Warning: could not sign envelope: {e}", err=True)

    sys.exit(exit_code)


@cli.command("status")
@click.option("--token", "-t", default=None, help="Delegation token")
@click.option("--agent", "-a", default=None, help="Load token by agent name")
def status_cmd(token: str | None, agent: str | None):
    """Quick check: is the current token valid and what can it do?"""
    try:
        token_str = _get_token(token, agent=agent)
    except SystemExit:
        click.secho("NO TOKEN", fg="red", bold=True)
        click.echo("  No active token. Delegate one:")
        click.echo("    kanoniv-auth delegate --name <agent> --scopes <scopes> --ttl 4h")
        return

    try:
        data = _decode_token(token_str)
        scopes = data.get("scopes", [])
        agent_did = data.get("agent_did", "?")
        agent_name = data.get("agent_name")
        if not agent_name:
            from kanoniv_auth.registry import resolve_name
            agent_name = resolve_name(agent_did)

        expires = data.get("expires_at")
        if expires:
            remaining = expires - time.time()
            if remaining <= 0:
                click.secho("EXPIRED", fg="red", bold=True)
                if agent_name:
                    click.echo(f"  Agent:  {agent_name}")
                click.echo(f"  DID:    {agent_did[:30]}...")
                click.echo(f"  Died:   {_format_duration(-remaining)} ago")
                click.echo()
                click.echo("  Re-delegate:")
                name_flag = f" --name {agent_name}" if agent_name else ""
                click.echo(f"    kanoniv-auth delegate{name_flag} --scopes {','.join(scopes)} --ttl 4h")
                return
            ttl_str = _format_duration(remaining)
        else:
            ttl_str = "no expiry"

        click.secho("ACTIVE", fg="green", bold=True)
        if agent_name:
            click.secho(f"  Agent:  {agent_name}", fg="cyan", bold=True)
        click.echo(f"  DID:    {agent_did[:30]}...")
        click.echo(f"  Scopes: {', '.join(scopes)}")
        click.secho(f"  TTL:    {ttl_str}", fg="green")
    except AuthError as e:
        click.secho("INVALID", fg="red", bold=True)
        click.echo(f"  {e}", err=True)


@cli.command("audit-log")
@click.option("--agent", "-a", default=None, help="Filter by agent name")
@click.option("--action", default=None, help="Filter by action (delegate, verify, sign, exec)")
@click.option("--since", default=None, help="Show entries since (ISO date, e.g. 2026-03-22)")
@click.option("--limit", "-n", default=50, help="Max entries to show")
def audit_log_cmd(agent: str | None, action: str | None, since: str | None, limit: int):
    """View the local audit log."""
    from kanoniv_auth.audit import read_log

    entries = read_log(agent=agent, action=action, since=since, limit=limit)
    if not entries:
        click.echo("No audit log entries." + (" Try without filters." if agent or action or since else ""))
        return

    click.secho(f"{len(entries)} event(s):", bold=True)
    click.echo()

    for e in entries:
        action_colors = {"delegate": "green", "verify": "blue", "sign": "yellow", "exec": "cyan"}
        color = action_colors.get(e["action"], "white")
        result_color = "green" if e["result"] in ("ok", "PASS", "success") else "red"

        name = e["agent_name"] if e["agent_name"] != "-" else ""
        ts = e["timestamp"][11:19] if len(e["timestamp"]) > 11 else e["timestamp"]

        action_str = click.style(e["action"].ljust(12), fg=color)
        agent_str = click.style((name or e["agent_did"][:16]).ljust(18), fg="cyan")
        detail_str = e["detail"][:40].ljust(40)
        result_str = click.style(e["result"], fg=result_color)
        click.echo(f"  {ts}  {action_str}  {agent_str}  {detail_str}  {result_str}")


@cli.group("agents")
def agents_group():
    """Manage registered agents (persistent identities)."""
    pass


@agents_group.command("list")
def agents_list_cmd():
    """List all registered agents."""
    from kanoniv_auth.registry import list_agents

    agents = list_agents()
    if not agents:
        click.echo("No registered agents. Use: kanoniv-auth delegate --name <agent-name> --scopes ...")
        return

    click.secho(f"{len(agents)} registered agent(s):", bold=True)
    click.echo()
    for a in agents:
        did_short = a["did"][:30] + "..." if len(a["did"]) > 30 else a["did"]
        click.echo(f"  {click.style(a['name'], fg='cyan', bold=True)}")
        click.echo(f"    DID:     {did_short}")
        if a["created_at"]:
            click.echo(f"    Created: {a['created_at'][:19]}")
        click.echo()


@agents_group.command("show")
@click.argument("name")
def agents_show_cmd(name: str):
    """Show details for a named agent."""
    from kanoniv_auth.registry import get_agent

    keys = get_agent(name)
    if not keys:
        click.echo(f"Agent '{name}' not found. Run: kanoniv-auth agents list", err=True)
        sys.exit(1)

    click.secho(f"Agent: {name}", fg="cyan", bold=True)
    click.echo(f"  DID:        {keys.did}")
    click.echo(f"  Public Key: {keys.export_public_hex()}")


@agents_group.command("remove")
@click.argument("name")
@click.confirmation_option(prompt="This will remove the agent identity permanently. Continue?")
def agents_remove_cmd(name: str):
    """Remove a registered agent."""
    from kanoniv_auth.registry import remove_agent

    if remove_agent(name):
        click.secho(f"Removed agent '{name}'", fg="green")
    else:
        click.echo(f"Agent '{name}' not found.", err=True)
        sys.exit(1)


@agents_group.command("rename")
@click.argument("old_name")
@click.argument("new_name")
def agents_rename_cmd(old_name: str, new_name: str):
    """Rename a registered agent (keeps the same DID)."""
    from kanoniv_auth.registry import rename_agent

    if rename_agent(old_name, new_name):
        click.secho(f"Renamed '{old_name}' -> '{new_name}'", fg="green")
    else:
        click.echo(f"Failed: '{old_name}' not found or '{new_name}' already exists.", err=True)
        sys.exit(1)


def main():
    cli()


if __name__ == "__main__":
    main()
