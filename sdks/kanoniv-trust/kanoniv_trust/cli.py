"""kt - CLI for the Kanoniv Trust Layer.

Usage:
    kt agents                                       List agents
    kt register <name> [--cap resolve,search]        Register agent
    kt delegate <from> <to> --scopes resolve,merge   Grant delegation
    kt revoke <delegation-id>                        Revoke delegation
    kt delegations [agent]                           List delegations
    kt action <agent> <action> [--meta '{}']         Record provenance
    kt memorize <agent> <title> [--content ...]      Save memory
    kt feedback <did> <action> <result> [--reward]   Feedback (reputation)
    kt log [--limit 20]                              Provenance log
    kt demo                                          Run live demo scenario
"""

from __future__ import annotations

import json
import time
import sys

import click

from kanoniv_trust.client import TrustClient

DEFAULT_URL = "https://trust.kanoniv.com"


def _client(ctx) -> TrustClient:
    return TrustClient(url=ctx.obj.get("url", DEFAULT_URL))


def _json_out(data, compact: bool = False):
    if compact and isinstance(data, list):
        for item in data:
            click.echo(json.dumps(item, default=str))
    else:
        click.echo(json.dumps(data, indent=2, default=str))


@click.group()
@click.option("--url", default=DEFAULT_URL, envvar="KT_URL", help="Trust API URL")
@click.version_option(package_name="kanoniv-trust")
@click.pass_context
def main(ctx, url):
    """kt - Trust layer CLI for AI agents."""
    ctx.ensure_object(dict)
    ctx.obj["url"] = url


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

@main.command()
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


@main.command()
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
        click.echo(f"  Status: {result['status']}")


@main.command("agent")
@click.argument("name")
@click.pass_context
def get_agent(ctx, name):
    """Get agent details."""
    with _client(ctx) as t:
        _json_out(t.agent(name))


# ---------------------------------------------------------------------------
# Delegations
# ---------------------------------------------------------------------------

@main.command()
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
        click.echo(f"  ID:     {result['id'][:12]}...")


@main.command()
@click.argument("agent_name", required=False, default=None)
@click.pass_context
def delegations(ctx, agent_name):
    """List active delegations."""
    with _client(ctx) as t:
        for d in t.delegations(agent_name):
            scopes = ", ".join(d.get("scopes", []))
            click.echo(f"  {d['grantor_name']:15s} -> {d['agent_name']:15s}  [{scopes}]")


@main.command()
@click.argument("delegation_id")
@click.pass_context
def revoke(ctx, delegation_id):
    """Revoke a delegation."""
    with _client(ctx) as t:
        result = t.revoke(delegation_id)
        click.secho(f"Revoked: {result['grantor_name']} -> {result['agent_name']}", fg="red")


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

@main.command()
@click.argument("agent_name")
@click.argument("action_name")
@click.option("--meta", "-m", default="{}", help="Metadata as JSON")
@click.pass_context
def action(ctx, agent_name, action_name, meta):
    """Record a provenance entry (agent performed an action)."""
    metadata = json.loads(meta)
    with _client(ctx) as t:
        result = t.action(agent_name, action_name, metadata=metadata)
        click.secho(f"Recorded: {agent_name} -> {action_name}", fg="green")
        click.echo(f"  ID: {result['id'][:12]}...")


@main.command()
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


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

@main.command()
@click.argument("agent_name")
@click.argument("title")
@click.option("--content", "-c", default="", help="Memory content")
@click.option("--type", "-t", "entry_type", default="decision", help="Entry type")
@click.pass_context
def memorize(ctx, agent_name, title, content, entry_type):
    """Save a memory entry for an agent."""
    with _client(ctx) as t:
        result = t.memorize(agent_name, title, content=content, entry_type=entry_type)
        click.secho(f"Memorized: {title}", fg="green")
        click.echo(f"  Author: agent:{agent_name}")
        click.echo(f"  Type:   {entry_type}")


@main.command()
@click.option("--type", "-t", "entry_type", default=None, help="Filter by type")
@click.option("--author", "-a", default=None, help="Filter by author")
@click.option("--limit", "-n", default=15, help="Number of entries")
@click.pass_context
def memories(ctx, entry_type, author, limit):
    """List memory entries."""
    with _client(ctx) as t:
        for m in t.memories(entry_type=entry_type, author=author, limit=limit):
            author_str = m.get("author", "?")
            click.echo(f"  [{m['entry_type']:10s}] {m['title'][:50]:50s}  by {author_str}")


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

@main.command()
@click.argument("agent_did")
@click.argument("action_name")
@click.argument("result", type=click.Choice(["success", "failure", "partial"]))
@click.option("--reward", "-r", type=float, default=0.5, help="Reward signal (-1 to 1)")
@click.pass_context
def feedback(ctx, agent_did, action_name, result, reward):
    """Submit feedback for an agent action. Affects reputation."""
    with _client(ctx) as t:
        t.feedback(agent_did, action_name, result, reward_signal=reward)
        color = "green" if result == "success" else "red" if result == "failure" else "yellow"
        click.secho(f"Feedback: {action_name} = {result} (reward: {reward})", fg=color)


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

@main.command()
@click.pass_context
def demo(ctx):
    """Run a live demo scenario - register agent, delegate, act, memorize."""
    click.secho("\n  Agent Trust Observatory - Live Demo", bold=True, fg="yellow")
    click.secho("  Watch: trust.kanoniv.com\n", fg="bright_black")

    with _client(ctx) as t:
        steps = [
            ("Register SDR agent", lambda: t.register(
                "sdr-agent",
                capabilities=["resolve", "search", "memory.read"],
                description="Sales Development Representative - qualifies leads via chat",
            )),
            ("Coordinator delegates resolve + search to SDR", lambda: t.delegate(
                "coordinator", "sdr-agent", ["resolve", "search", "memory.read"],
            )),
            ("SDR resolves a contact identity", lambda: t.action(
                "sdr-agent", "resolve",
                metadata={"entity": "john@acme.com", "result": "merge", "confidence": 0.94, "entity_id": "e3a1f9c2"},
            )),
            ("SDR records memory about the contact", lambda: t.memorize(
                "sdr-agent",
                "Resolved john@acme.com - merged with entity e3a1f9c2",
                content="Contact previously seen from support channel as john.doe@acme.com. "
                        "Merged with 94% confidence based on email domain + company match.",
                entry_type="decision",
            )),
            ("SDR attempts merge (blocked - no merge scope)", lambda: t.action(
                "sdr-agent", "merge_attempt",
                metadata={"target": "e3a1f9c2", "result": "blocked", "reason": "missing merge scope"},
            )),
            ("Coordinator grants merge scope after review", lambda: t.delegate(
                "coordinator", "sdr-agent", ["merge"],
            )),
            ("SDR performs the merge", lambda: t.action(
                "sdr-agent", "merge",
                metadata={"entities": ["e3a1f9c2", "b7d2e4a1"], "result": "success", "fields_updated": 3},
            )),
        ]

        for i, (label, fn) in enumerate(steps, 1):
            click.secho(f"  Step {i}: {label}...", fg="bright_black")
            result = fn()
            click.secho(f"    Done.", fg="green")
            time.sleep(2)

        # Feedback step
        click.secho("  Step 8: Positive feedback on merge (affects reputation)...", fg="bright_black")
        agent_data = t.agent("sdr-agent")
        did = agent_data.get("did")
        if did:
            t.feedback(did, "merge", "success", reward_signal=0.8)
            click.secho("    Done.", fg="green")
        else:
            click.secho("    Skipped (no DID)", fg="yellow")

    click.echo()
    click.secho("  Demo complete! Check trust.kanoniv.com", bold=True, fg="green")
    click.echo("    /agents     - see sdr-agent with delegations")
    click.echo("    /provenance - see the full action trail")
    click.echo("    /graph      - see delegation chains")
    click.echo()
