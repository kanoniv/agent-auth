"""Local audit log - append-only record of all auth operations.

Every delegate, verify, sign, and exec call auto-appends a line to
~/.kanoniv/audit.log. Human-readable, grep-friendly, one line per event.

Format: TIMESTAMP  AGENT_NAME  AGENT_DID  ACTION  DETAIL  RESULT
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Any

DEFAULT_AUDIT_PATH = "~/.kanoniv/audit.log"


def _audit_path(path: str | None = None) -> Path:
    return Path(path or DEFAULT_AUDIT_PATH).expanduser()


def log_event(
    action: str,
    detail: str = "",
    result: str = "ok",
    agent_name: str | None = None,
    agent_did: str | None = None,
    path: str | None = None,
) -> None:
    """Append an audit event to the log."""
    p = _audit_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)

    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    name = agent_name or "-"
    did_short = agent_did[:20] + "..." if agent_did and len(agent_did) > 20 else (agent_did or "-")

    line = f"{ts}  {name:<16}  {did_short:<24}  {action:<12}  {detail:<40}  {result}\n"

    with open(p, "a") as f:
        f.write(line)


def read_log(
    agent: str | None = None,
    action: str | None = None,
    since: str | None = None,
    limit: int = 50,
    path: str | None = None,
) -> list[dict[str, str]]:
    """Read and filter audit log entries."""
    p = _audit_path(path)
    if not p.exists():
        return []

    entries = []
    for line in p.read_text().splitlines():
        if not line.strip():
            continue

        parts = line.split("  ")
        # Minimum: timestamp + 5 fields separated by double-space
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) < 6:
            continue

        entry = {
            "timestamp": parts[0],
            "agent_name": parts[1],
            "agent_did": parts[2],
            "action": parts[3],
            "detail": parts[4],
            "result": parts[5],
        }

        # Apply filters
        if agent and agent != entry["agent_name"]:
            continue
        if action and action != entry["action"]:
            continue
        if since:
            try:
                since_dt = datetime.datetime.fromisoformat(since)
                entry_dt = datetime.datetime.strptime(entry["timestamp"], "%Y-%m-%d %H:%M:%S")
                if entry_dt < since_dt:
                    continue
            except (ValueError, TypeError):
                pass

        entries.append(entry)

    # Return most recent first, limited
    return list(reversed(entries[-limit:]))


def clear_log(path: str | None = None) -> None:
    """Clear the audit log."""
    p = _audit_path(path)
    if p.exists():
        p.unlink()
