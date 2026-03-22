"""Local agent registry - persistent identity for named agents.

Maps human-readable names to Ed25519 keypairs so the same agent
keeps the same DID across sessions.

Storage: ~/.kanoniv/agents.json
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from kanoniv_auth.crypto import KeyPair, generate_keys, load_keys

DEFAULT_REGISTRY_PATH = "~/.kanoniv/agents.json"


def _registry_path(path: str | None = None) -> Path:
    return Path(path or DEFAULT_REGISTRY_PATH).expanduser()


def _load_registry(path: str | None = None) -> dict[str, Any]:
    p = _registry_path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _save_registry(data: dict[str, Any], path: str | None = None) -> None:
    p = _registry_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2))


def register_agent(name: str, path: str | None = None) -> KeyPair:
    """Register a new named agent or return existing one.

    If the agent name already exists, returns the existing keypair.
    If new, generates a fresh Ed25519 keypair and stores it.
    """
    registry = _load_registry(path)

    if name in registry:
        # Return existing keypair
        entry = registry[name]
        return load_keys(entry["private_key"])

    # Generate new identity
    keys = generate_keys()
    registry[name] = {
        "did": keys.did,
        "private_key": keys.export_private(),
        "public_key": keys.export_public_hex(),
        "created_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    }
    _save_registry(registry, path)
    return keys


def get_agent(name: str, path: str | None = None) -> KeyPair | None:
    """Get a named agent's keypair, or None if not registered."""
    registry = _load_registry(path)
    entry = registry.get(name)
    if not entry:
        return None
    return load_keys(entry["private_key"])


def get_agent_did(name: str, path: str | None = None) -> str | None:
    """Get a named agent's DID without loading the full keypair."""
    registry = _load_registry(path)
    entry = registry.get(name)
    return entry["did"] if entry else None


def list_agents(path: str | None = None) -> list[dict[str, str]]:
    """List all registered agents."""
    registry = _load_registry(path)
    return [
        {
            "name": name,
            "did": entry["did"],
            "created_at": entry.get("created_at", ""),
        }
        for name, entry in registry.items()
    ]


def remove_agent(name: str, path: str | None = None) -> bool:
    """Remove a named agent. Returns True if it existed."""
    registry = _load_registry(path)
    if name not in registry:
        return False
    del registry[name]
    _save_registry(registry, path)
    return True


def rename_agent(old_name: str, new_name: str, path: str | None = None) -> bool:
    """Rename an agent. Returns True if successful."""
    registry = _load_registry(path)
    if old_name not in registry or new_name in registry:
        return False
    registry[new_name] = registry.pop(old_name)
    _save_registry(registry, path)
    return True


def resolve_name(did: str, path: str | None = None) -> str | None:
    """Reverse lookup: find the agent name for a DID."""
    registry = _load_registry(path)
    for name, entry in registry.items():
        if entry["did"] == did:
            return name
    return None
