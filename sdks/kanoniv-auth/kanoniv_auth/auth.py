"""Sudo for AI agents.

Three functions. That's it.

    token = delegate(scopes=["deploy.staging"], ttl="4h")
    verify(action="deploy.staging", token=token)   # works
    verify(action="deploy.prod", token=token)       # raises ScopeViolation

Delegation tokens are self-contained, cryptographically signed,
and verifiable without any network call. Scopes can only narrow
through a delegation chain - never widen.
"""

from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path
from typing import Any

from kanoniv_auth.crypto import KeyPair, generate_keys, load_keys, verify_signature
from kanoniv_auth.errors import (
    AuthError,
    ChainTooDeep,
    NoRootKey,
    ScopeViolation,
    SignatureInvalid,
    TokenExpired,
    TokenParseError,
)

MAX_CHAIN_DEPTH = 32
DEFAULT_KEY_DIR = "~/.kanoniv"

# Module-level root key (set by init_root or load_root)
_root_keys: KeyPair | None = None


def init_root(path: str | None = None) -> KeyPair:
    """Generate a new root key pair and save it.

    The root key is the master authority. Treat it like an SSH key.

    Args:
        path: Where to save. Defaults to ~/.kanoniv/root.key

    Returns:
        The generated KeyPair (also set as module-level root).
    """
    global _root_keys
    keys = generate_keys()
    save_path = path or str(Path(DEFAULT_KEY_DIR).expanduser() / "root.key")
    keys.save(save_path)
    _root_keys = keys
    return keys


def load_root(path: str | None = None) -> KeyPair:
    """Load root key pair from disk.

    Args:
        path: Key file path. Defaults to ~/.kanoniv/root.key

    Returns:
        The loaded KeyPair (also set as module-level root).
    """
    global _root_keys
    load_path = path or str(Path(DEFAULT_KEY_DIR).expanduser() / "root.key")
    keys = KeyPair.load(load_path)
    _root_keys = keys
    return keys


def delegate(
    scopes: list[str],
    ttl: str | float | None = None,
    to: str | None = None,
    root: KeyPair | None = None,
    parent_token: str | None = None,
) -> str:
    """Issue a delegation token.

    Args:
        scopes: What the agent is allowed to do. e.g. ["deploy.staging"]
        ttl: How long the token is valid.
             String: "4h", "30m", "1d", "3600s"
             Float: seconds
             None: no expiry
        to: DID of the agent receiving the delegation.
            If None, generates a new agent identity.
        root: Root key pair. If None, uses module-level root.
        parent_token: For sub-delegation. The parent's token.
                      Scopes must be a subset of the parent's scopes.

    Returns:
        Base64-encoded JSON token string.

    Raises:
        AuthError: If no root key is loaded.
        ScopeViolation: If sub-delegation tries to widen scopes.
    """
    if not scopes:
        raise AuthError("scopes cannot be empty")

    # Resolve signing key
    if parent_token:
        parent = _decode_token(parent_token)
        parent_chain = parent.get("chain", [])
        parent_scopes = _effective_scopes(parent)

        # Sub-delegation can only narrow
        invalid = [s for s in scopes if s not in parent_scopes]
        if invalid:
            raise ScopeViolation(
                scope=invalid[0],
                has=parent_scopes,
                delegator_did=parent.get("issuer_did"),
            )

        # Check chain depth
        if len(parent_chain) + 1 >= MAX_CHAIN_DEPTH:
            raise ChainTooDeep(len(parent_chain) + 1, MAX_CHAIN_DEPTH)

        # The parent's agent key becomes the issuer for sub-delegation
        signing_keys = _get_agent_keys(parent)
        issuer_did = parent.get("agent_did", signing_keys.did)
    else:
        signing_keys = root or _root_keys
        if signing_keys is None:
            raise NoRootKey()
        issuer_did = signing_keys.did
        parent_chain = []

    # Generate agent identity for the delegate
    if to:
        agent_did = to
    else:
        agent_keys = generate_keys()
        agent_did = agent_keys.did

    # Compute expiry
    expires_at = None
    if ttl is not None:
        ttl_seconds = _parse_ttl(ttl)
        expires_at = time.time() + ttl_seconds
        # Cannot exceed parent's expiry
        if parent_token:
            parent_expires = parent.get("expires_at")
            if parent_expires is not None:
                expires_at = min(expires_at, parent_expires)

    # Build the delegation link
    link = {
        "issuer_did": issuer_did,
        "agent_did": agent_did,
        "scopes": sorted(scopes),
        "created_at": time.time(),
    }
    if expires_at is not None:
        link["expires_at"] = expires_at

    # Sign the link
    payload = json.dumps(link, sort_keys=True, separators=(",", ":")).encode()
    link["signature"] = signing_keys.sign(payload)
    link["issuer_public_key"] = signing_keys.export_public()

    # Build the token
    token_data: dict[str, Any] = {
        "version": 1,
        "chain": parent_chain + [link],
        "agent_did": agent_did,
        "scopes": sorted(scopes),
    }
    if expires_at is not None:
        token_data["expires_at"] = expires_at

    # If we generated agent keys, embed them so the agent can sub-delegate and sign
    if not to:
        token_data["agent_private_key"] = agent_keys.export_private()

    return _encode_token(token_data)


def verify(
    action: str,
    token: str,
    root_did: str | None = None,
) -> dict:
    """Verify a delegation token against an action.

    Checks:
    1. Token is not expired
    2. Action scope is in the delegation
    3. Every signature in the chain is valid
    4. Chain depth is within limits
    5. Scopes only narrow through the chain

    Args:
        action: The scope being claimed. e.g. "deploy.staging"
        token: The base64 JSON token from delegate().
        root_did: Expected root DID. If None, uses module-level root's DID.

    Returns:
        Dict with verification details:
        {
            "valid": True,
            "agent_did": "did:key:...",
            "root_did": "did:key:...",
            "scopes": ["deploy.staging"],
            "expires_at": 1234567890.0 or None,
            "ttl_remaining": 3600.0 or None,
            "chain_depth": 2,
        }

    Raises:
        ScopeViolation: Action not in delegated scopes.
        TokenExpired: Token has expired.
        SignatureInvalid: A chain link has a bad signature.
        ChainTooDeep: Chain exceeds max depth.
        TokenParseError: Token is malformed.
    """
    data = _decode_token(token)
    chain = data.get("chain", [])

    # Check chain depth
    if len(chain) > MAX_CHAIN_DEPTH:
        raise ChainTooDeep(len(chain), MAX_CHAIN_DEPTH)

    if not chain:
        raise TokenParseError("token has no delegation chain")

    # Check expiry
    expires_at = data.get("expires_at")
    now = time.time()
    if expires_at is not None and now > expires_at:
        raise TokenExpired(now - expires_at)

    # Check scope
    token_scopes = data.get("scopes", [])
    if action not in token_scopes:
        root_link = chain[0] if chain else {}
        raise ScopeViolation(
            scope=action,
            has=token_scopes,
            delegator_did=root_link.get("issuer_did"),
        )

    # Verify every signature in the chain
    expected_root = root_did or (_root_keys.did if _root_keys else None)
    prev_scopes: list[str] | None = None

    for i, link in enumerate(chain):
        # Verify signature
        issuer_pub_b64 = link.get("issuer_public_key")
        if not issuer_pub_b64:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "missing issuer_public_key")

        sig = link.get("signature")
        if not sig:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "missing signature")

        # Reconstruct the signed payload (everything except signature and public key)
        verify_link = {k: v for k, v in link.items() if k not in ("signature", "issuer_public_key")}
        payload = json.dumps(verify_link, sort_keys=True, separators=(",", ":")).encode()

        if not verify_signature(link.get("issuer_did", ""), payload, sig):
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"))

        # Verify root DID on first link
        if i == 0 and expected_root and link.get("issuer_did") != expected_root:
            raise SignatureInvalid(
                0, link.get("issuer_did", "unknown"),
                f"root DID mismatch: expected {expected_root}",
            )

        # Verify scopes only narrow
        link_scopes = link.get("scopes", [])
        if prev_scopes is not None:
            widened = [s for s in link_scopes if s not in prev_scopes]
            if widened:
                raise ScopeViolation(
                    scope=widened[0],
                    has=prev_scopes,
                    delegator_did=link.get("issuer_did"),
                )
        prev_scopes = link_scopes

        # Verify per-link expiry
        link_expires = link.get("expires_at")
        if link_expires is not None and now > link_expires:
            raise TokenExpired(now - link_expires)

    ttl_remaining = (expires_at - now) if expires_at else None

    return {
        "valid": True,
        "agent_did": data.get("agent_did"),
        "root_did": chain[0].get("issuer_did") if chain else None,
        "scopes": token_scopes,
        "expires_at": expires_at,
        "ttl_remaining": ttl_remaining,
        "chain_depth": len(chain),
    }


def sign(
    action: str,
    token: str,
    target: str = "",
    result: str = "success",
    metadata: dict | None = None,
) -> str:
    """Sign an execution envelope using the agent's delegated key.

    Creates a signed record of what the agent did, provable from the
    delegation chain. This is the audit trail entry.

    Args:
        action: What was done. e.g. "deploy"
        token: The agent's delegation token.
        target: What it was done to. e.g. "staging"
        result: Outcome. "success", "failure", or "partial".
        metadata: Additional context to include in the signed envelope.

    Returns:
        Base64-encoded JSON execution envelope.
    """
    data = _decode_token(token)
    agent_keys = _get_agent_keys(data)

    envelope = {
        "version": 1,
        "agent_did": data.get("agent_did"),
        "action": action,
        "target": target,
        "result": result,
        "timestamp": time.time(),
        "scopes": data.get("scopes", []),
        "chain_depth": len(data.get("chain", [])),
        "metadata": metadata or {},
    }

    # Sign the envelope
    payload = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()
    envelope["signature"] = agent_keys.sign(payload)
    envelope["delegation_chain"] = data.get("chain", [])

    return _encode_token(envelope)


# --- Token encoding ---

def _encode_token(data: dict) -> str:
    """Encode token data as base64 JSON."""
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_token(token: str) -> dict:
    """Decode a base64 JSON token."""
    try:
        # Add back padding
        padded = token + "=" * (4 - len(token) % 4) if len(token) % 4 else token
        raw = base64.urlsafe_b64decode(padded)
        return json.loads(raw)
    except Exception as e:
        raise TokenParseError(str(e))


def _effective_scopes(token_data: dict) -> list[str]:
    """Get the effective scopes from a decoded token."""
    return token_data.get("scopes", [])


def _get_agent_keys(token_data: dict) -> KeyPair:
    """Extract the agent's signing keys from a token."""
    priv = token_data.get("agent_private_key")
    if not priv:
        raise AuthError(
            "Token does not contain agent keys. "
            "This token was issued to a specific DID - the agent must sign with its own key."
        )
    return load_keys(priv)


def _parse_ttl(ttl: str | float) -> float:
    """Parse a TTL value into seconds.

    Accepts:
        "4h" -> 14400
        "30m" -> 1800
        "1d" -> 86400
        "3600s" -> 3600
        "3600" -> 3600
        3600.0 -> 3600.0
    """
    if isinstance(ttl, (int, float)):
        if ttl <= 0:
            raise AuthError(f"TTL must be positive, got {ttl}")
        return float(ttl)

    match = re.match(r"^(\d+(?:\.\d+)?)\s*([smhd]?)$", ttl.strip().lower())
    if not match:
        raise AuthError(
            f'Invalid TTL format: "{ttl}". '
            'Use "4h", "30m", "1d", "3600s", or a number of seconds.'
        )

    value = float(match.group(1))
    unit = match.group(2) or "s"

    multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    result = value * multipliers[unit]

    if result <= 0:
        raise AuthError(f"TTL must be positive, got {result}s")

    return result
