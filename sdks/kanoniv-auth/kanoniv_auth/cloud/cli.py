"""kanoniv-auth cloud CLI - cloud commands for the Trust Observatory."""

from __future__ import annotations

import json
import os
import time

import click

from kanoniv_auth.cloud.client import TrustClient

DEFAULT_URL = "https://trust.kanoniv.com"
KEY_FILE = os.path.expanduser("~/.kanoniv/cloud.key")


def _load_api_key(ctx_key: str | None) -> str | None:
    """Load API key from: ctx option > env > saved file."""
    if ctx_key:
        return ctx_key
    env_key = os.environ.get("KT_API_KEY")
    if env_key:
        return env_key
    try:
        if os.path.exists(KEY_FILE):
            return open(KEY_FILE).read().strip()
    except Exception:
        pass
    return None


def _save_api_key(key: str):
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "w") as f:
        f.write(key)


def _client(ctx) -> TrustClient:
    api_key = _load_api_key(ctx.obj.get("api_key"))
    url = ctx.obj.get("url", DEFAULT_URL)
    return TrustClient(api_key=api_key, url=url)


@click.group()
@click.option("--url", default=DEFAULT_URL, envvar="KT_URL", help="Trust API URL")
@click.option("--api-key", default=None, envvar="KT_API_KEY", help="API key")
@click.pass_context
def cloud(ctx, url, api_key):
    """Cloud trust layer - agent registry, delegation, provenance, reputation."""
    ctx.ensure_object(dict)
    ctx.obj["url"] = url
    ctx.obj["api_key"] = api_key


# Also expose as standalone `kt` entry point
@click.group()
@click.option("--url", default=DEFAULT_URL, envvar="KT_URL", help="Trust API URL")
@click.option("--api-key", default=None, envvar="KT_API_KEY", help="API key")
@click.version_option(package_name="kanoniv-auth")
@click.pass_context
def main(ctx, url, api_key):
    """kt - Trust layer CLI for AI agents."""
    ctx.ensure_object(dict)
    ctx.obj["url"] = url
    ctx.obj["api_key"] = api_key


# --- Auth ---

@click.command()
@click.option("--email", "-e", prompt=True)
@click.option("--password", "-p", prompt=True, hide_input=True)
@click.option("--name", "-n", prompt="Team name")
@click.pass_context
def signup(ctx, email, password, name):
    """Create a new account."""
    with _client(ctx) as t:
        result = t.signup(email, password, name)
        api_key = result.get("api_key", "")
        _save_api_key(api_key)
        click.secho(f"Account created!", fg="green")
        click.echo(f"  API Key: {api_key}")
        click.echo(f"  Saved to: {KEY_FILE}")
        click.secho("  Save this key - you will not see it again.", fg="yellow")


@click.command()
@click.option("--email", "-e", prompt=True)
@click.option("--password", "-p", prompt=True, hide_input=True)
@click.pass_context
def login(ctx, email, password):
    """Log in and get an API key."""
    with _client(ctx) as t:
        result = t.login(email, password)
        api_key = result.get("api_key", "")
        _save_api_key(api_key)
        click.secho(f"Logged in as {result['tenant']['name']}", fg="green")
        click.echo(f"  API Key saved to: {KEY_FILE}")


@click.command("me")
@click.pass_context
def me_cmd(ctx):
    """Show current tenant info and usage."""
    with _client(ctx) as t:
        data = t.me()
        tenant = data["tenant"]
        usage = data["usage"]
        click.echo(f"  Tenant:  {tenant['name']} ({tenant['email']})")
        click.echo(f"  Plan:    {tenant['plan']}")
        click.echo(f"  Agents:  {usage['agents']['current']}/{usage['agents']['limit']}")
        click.echo(f"  Actions: {usage['actions_this_month']['current']}/{usage['actions_this_month']['limit']}")


# --- Agents ---

@click.command()
@click.pass_context
def agents(ctx):
    """List all registered agents."""
    with _client(ctx) as t:
        for a in t.agents():
            score = a.get("reputation", {}).get("composite_score", "?")
            status = a.get("status", "?")
            caps = ", ".join(a.get("capabilities", []))
            did = a.get("did", "")
            short_did = f"  {did[-12:]}" if did else ""
            click.echo(f"  [{score:>3}] {a['name']:20s} {status:8s} {caps}{short_did}")


@click.command()
@click.argument("name")
@click.option("--cap", "-c", default="", help="Capabilities (comma-separated)")
@click.option("--desc", "-d", default=None, help="Description")
@click.pass_context
def register(ctx, name, cap, desc):
    """Register a new agent."""
    caps = [c.strip() for c in cap.split(",") if c.strip()] if cap else []
    with _client(ctx) as t:
        result = t.register(name, capabilities=caps, description=desc)
        click.secho(f"Registered: {result['name']}", fg="green")
        click.echo(f"  DID:    {result.get('did', 'none')}")
        click.echo(f"  Score:  {result.get('reputation', {}).get('composite_score', '?')}")


@click.command("agent")
@click.argument("name")
@click.pass_context
def get_agent(ctx, name):
    """Get agent details."""
    with _client(ctx) as t:
        click.echo(json.dumps(t.agent(name), indent=2, default=str))


# --- Delegations ---

@click.command()
@click.argument("from_agent")
@click.argument("to_agent")
@click.option("--scopes", "-s", required=True, help="Scopes (comma-separated)")
@click.option("--expires", "-e", type=int, default=None, help="Expiry in hours")
@click.pass_context
def delegate(ctx, from_agent, to_agent, scopes, expires):
    """Grant a delegation from one agent to another."""
    scope_list = [s.strip() for s in scopes.split(",")]
    with _client(ctx) as t:
        result = t.delegate(from_agent, to_agent, scope_list, expires_in_hours=expires)
        click.secho(f"Delegated: {from_agent} -> {to_agent}", fg="green")
        click.echo(f"  Scopes: {', '.join(result['scopes'])}")


@click.command()
@click.argument("agent_name", required=False, default=None)
@click.pass_context
def delegations(ctx, agent_name):
    """List active delegations."""
    with _client(ctx) as t:
        for d in t.delegations(agent_name):
            scopes = ", ".join(d.get("scopes", []))
            click.echo(f"  {d['grantor_name']:15s} -> {d['agent_name']:15s}  [{scopes}]")


@click.command()
@click.argument("delegation_id")
@click.pass_context
def revoke(ctx, delegation_id):
    """Revoke a delegation."""
    with _client(ctx) as t:
        result = t.revoke(delegation_id)
        click.secho(f"Revoked: {result['grantor_name']} -> {result['agent_name']}", fg="red")


# --- Provenance ---

@click.command()
@click.argument("agent_name")
@click.argument("action_name")
@click.option("--meta", "-m", default="{}", help="Metadata as JSON")
@click.pass_context
def action(ctx, agent_name, action_name, meta):
    """Record a provenance entry."""
    metadata = json.loads(meta)
    with _client(ctx) as t:
        result = t.action(agent_name, action_name, metadata=metadata)
        if "error" in result:
            click.secho(f"DENIED: {result.get('reason', result['error'])}", fg="red")
        else:
            click.secho(f"Recorded: {agent_name} -> {action_name}", fg="green")


@click.command()
@click.option("--limit", "-n", default=15, help="Number of entries")
@click.pass_context
def log(ctx, limit):
    """Show recent provenance log."""
    with _client(ctx) as t:
        for p in t.provenance(limit):
            ts = p["created_at"][:19].replace("T", " ")
            meta = json.dumps(p.get("metadata", {}))
            if len(meta) > 60:
                meta = meta[:57] + "..."
            click.echo(f"  {ts}  {p['agent_name']:15s}  {p['action']:15s}  {meta}")


# --- Memory ---

@click.command()
@click.argument("agent_name")
@click.argument("title")
@click.option("--content", "-c", default="", help="Memory content")
@click.option("--type", "-t", "entry_type", default="decision", help="Entry type")
@click.pass_context
def memorize(ctx, agent_name, title, content, entry_type):
    """Save a memory entry for an agent."""
    with _client(ctx) as t:
        t.memorize(agent_name, title, content=content, entry_type=entry_type)
        click.secho(f"Memorized: {title}", fg="green")


@click.command()
@click.option("--type", "-t", "entry_type", default=None)
@click.option("--author", "-a", default=None)
@click.option("--limit", "-n", default=15)
@click.pass_context
def memories(ctx, entry_type, author, limit):
    """List memory entries."""
    with _client(ctx) as t:
        for m in t.memories(entry_type=entry_type, author=author, limit=limit):
            auth = m.get("author", "?")
            click.echo(f"  [{m['entry_type']:10s}] {m['title'][:50]:50s}  by {auth}")


# --- Feedback ---

@click.command()
@click.argument("agent_did")
@click.argument("action_name")
@click.argument("result", type=click.Choice(["success", "failure", "partial"]))
@click.option("--reward", "-r", type=float, default=0.5)
@click.pass_context
def feedback(ctx, agent_did, action_name, result, reward):
    """Submit feedback for an agent action."""
    with _client(ctx) as t:
        t.feedback(agent_did, action_name, result, reward_signal=reward)
        color = "green" if result == "success" else "red" if result == "failure" else "yellow"
        click.secho(f"Feedback: {action_name} = {result} (reward: {reward})", fg=color)


# --- Demo ---

@click.command()
@click.pass_context
def demo(ctx):
    """Run a live demo scenario."""
    click.secho("\n  Agent Trust - Live Demo", bold=True, fg="yellow")
    click.secho("  Watch: trust.kanoniv.com\n", fg="bright_black")

    with _client(ctx) as t:
        steps = [
            ("Register coordinator", lambda: t.register("coordinator", capabilities=["orchestrate", "delegate", "admin"])),
            ("Register payment agent", lambda: t.register("payment-agent", capabilities=["payments.send", "payments.read"])),
            ("Delegate payment scope ($100 cap)", lambda: t.delegate("coordinator", "payment-agent", ["payments.send", "payments.read"], expires_in_hours=1, metadata={"max_amount": 100})),
            ("$40 payment (allowed)", lambda: t.action("payment-agent", "payments.send", metadata={"amount": 40, "currency": "USD"})),
            ("$200 payment (blocked)", lambda: t.action("payment-agent", "payments.send", metadata={"amount": 200, "currency": "USD"})),
        ]

        for i, (label, fn) in enumerate(steps, 1):
            click.secho(f"  Step {i}: {label}...", fg="bright_black")
            result = fn()
            if isinstance(result, dict) and "error" in result:
                click.secho(f"    BLOCKED: {result.get('reason', result['error'])}", fg="red")
            else:
                click.secho(f"    Done.", fg="green")
            time.sleep(2)

    click.secho("\n  Demo complete!", bold=True, fg="green")


# Register all commands on both groups
for cmd in [signup, login, me_cmd, agents, register, get_agent, delegate, delegations,
            revoke, action, log, memorize, memories, feedback, demo]:
    cloud.add_command(cmd)
    main.add_command(cmd)
