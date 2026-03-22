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


def _get_token(token: str | None) -> str:
    """Get token from arg, env, or local storage."""
    if token:
        return token
    env = os.environ.get("KANONIV_TOKEN")
    if env:
        return env
    try:
        return load_token()
    except AuthError:
        click.echo("Error: No token. Pass --token, set KANONIV_TOKEN, or run delegate first.", err=True)
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


@cli.command("delegate")
@click.option("--scopes", "-s", required=True, help="Comma-separated scopes")
@click.option("--ttl", "-t", default=None, help='Time-to-live (e.g. "4h", "30m")')
@click.option("--name", "-n", default=None, help="Agent name (persistent identity across sessions)")
@click.option("--key", "-k", default=None, help="Root key file path")
@click.option("--parent", default=None, help="Parent token for sub-delegation")
@click.option("--dry-run", is_flag=True, help="Show what would happen without signing")
def delegate_cmd(scopes: str, ttl: str | None, name: str | None, key: str | None, parent: str | None, dry_run: bool):
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
                default = str(Path("~/.kanoniv/root.key").expanduser())
                if Path(default).exists():
                    load_root(default)
                else:
                    click.echo(f"No root key at {default}. Run: kanoniv-auth init", err=True)
                    sys.exit(1)

        token = delegate(scopes=scope_list, ttl=ttl, name=name, parent_token=parent)
        click.echo(token)
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("verify")
@click.option("--scope", "-s", required=True, help="Scope to verify")
@click.option("--token", "-t", default=None, help="Delegation token (or $KANONIV_TOKEN or latest)")
def verify_cmd(scope: str, token: str | None):
    """Verify a delegation token against an action."""
    token = _get_token(token)
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
@click.option("--target", default="", help="Target of the action")
@click.option("--result", "result_", default="success", help="Result (success/failure/partial)")
def sign_cmd(action: str, token: str | None, target: str, result_: str):
    """Sign an execution envelope."""
    token = _get_token(token)
    try:
        envelope = sign(action=action, token=token, target=target, result=result_)
        click.echo(envelope)
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("whoami")
@click.option("--token", "-t", default=None, help="Delegation token")
def whoami_cmd(token: str | None):
    """Show the identity behind a token."""
    token = _get_token(token)
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
