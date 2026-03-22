"""kanoniv-auth CLI - Sudo for AI agents.

Usage:
    kanoniv-auth init [--output PATH]
    kanoniv-auth delegate --scopes X --ttl 4h
    kanoniv-auth verify --scope X [--token TOKEN]
    kanoniv-auth sign --action X [--token TOKEN]
    kanoniv-auth whoami [--token TOKEN]
"""

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
    AuthError,
    ScopeViolation,
    TokenExpired,
)
from kanoniv_auth.auth import _decode_token, _parse_ttl
import kanoniv_auth.auth as auth_module


def _get_token(token: str | None) -> str:
    """Get token from arg, env, or fail."""
    t = token or os.environ.get("KANONIV_TOKEN")
    if not t:
        click.echo("Error: No token. Pass --token or set KANONIV_TOKEN.", err=True)
        sys.exit(1)
    return t


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
@click.option("--key", "-k", default=None, help="Root key file path")
@click.option("--parent", default=None, help="Parent token for sub-delegation")
@click.option("--dry-run", is_flag=True, help="Show what would happen without signing")
def delegate_cmd(scopes: str, ttl: str | None, key: str | None, parent: str | None, dry_run: bool):
    """Issue a delegation token."""
    scope_list = [s.strip() for s in scopes.split(",") if s.strip()]
    if not scope_list:
        click.echo("Error: --scopes is required.", err=True)
        sys.exit(1)

    if dry_run:
        click.secho("[DRY RUN] Would create delegation:", fg="yellow", bold=True)
        click.echo(f"  Scopes:  {scope_list}")
        click.echo(f"  TTL:     {ttl or 'no expiry'}")
        click.echo(f"  Type:    {'sub-delegation' if parent else 'root delegation'}")
        return

    try:
        if not parent:
            # Load root key
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

        token = delegate(scopes=scope_list, ttl=ttl, parent_token=parent)
        click.echo(token)
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("verify")
@click.option("--scope", "-s", required=True, help="Scope to verify")
@click.option("--token", "-t", default=None, help="Delegation token (or $KANONIV_TOKEN)")
def verify_cmd(scope: str, token: str | None):
    """Verify a delegation token against an action."""
    token = _get_token(token)
    try:
        result = verify(action=scope, token=token)
        data = _decode_token(token)
        chain = data.get("chain", [])
        root_did = chain[0].get("issuer_did", "?") if chain else "?"

        ttl_str = f"{_format_duration(result['ttl_remaining'])} remaining" if result["ttl_remaining"] else "no expiry"

        click.secho("VERIFIED", fg="green", bold=True)
        click.echo(f"  Agent:   {result['agent_did']}")
        click.echo(f"  Root:    {root_did}")
        click.echo(f"  Scopes:  {result['scopes']}")
        click.echo(f"  Expires: {ttl_str}")
        click.echo(f"  Chain:   {result['chain_depth']} link(s)")
    except (ScopeViolation, TokenExpired, AuthError) as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command("sign")
@click.option("--action", "-a", required=True, help="Action performed")
@click.option("--token", "-t", default=None, help="Delegation token (or $KANONIV_TOKEN)")
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
@click.option("--token", "-t", default=None, help="Delegation token (or $KANONIV_TOKEN)")
def whoami_cmd(token: str | None):
    """Show the identity behind a token."""
    token = _get_token(token)
    try:
        data = _decode_token(token)
        chain = data.get("chain", [])
        scopes = data.get("scopes", [])
        agent_did = data.get("agent_did", "unknown")
        root_did = chain[0].get("issuer_did", "?") if chain else "?"

        click.secho("Agent Identity", bold=True)
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
                click.echo(f"{indent}|-- {d_short}")

            click.echo()
            click.echo(f"  Chain depth: {len(chain)}")
        else:
            click.echo("  No delegation chain found.")
    except AuthError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


def main():
    cli()


if __name__ == "__main__":
    main()
