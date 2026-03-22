"""Sudo for AI agents.

Three functions. That's it.

    token = delegate(scopes=["deploy.staging"], ttl="4h")
    verify(action="deploy.staging", token=token)   # works
    verify(action="deploy.prod", token=token)       # raises ScopeViolation

Token format matches the Rust kanoniv-agent-auth crate exactly.
Tokens are interoperable between Python CLI, Rust CLI, and the
delegation service.
"""

from __future__ import annotations

import base64
import datetime
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from kanoniv_auth.crypto import (
    KeyPair,
    generate_keys,
    load_keys,
    load_keys_from_hex,
    verify_signature_with_key,
)
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
DEFAULT_TOKEN_DIR = "~/.kanoniv/tokens"

# Module-level root key (set by init_root or load_root)
_root_keys: KeyPair | None = None


def init_root(path: str | None = None) -> KeyPair:
    """Generate a new root key pair and save it.

    The root key is the master authority. Treat it like an SSH key.
    """
    global _root_keys
    keys = generate_keys()
    save_path = path or str(Path(DEFAULT_KEY_DIR).expanduser() / "root.key")
    keys.save(save_path)
    _root_keys = keys
    return keys


def load_root(path: str | None = None) -> KeyPair:
    """Load root key pair from disk."""
    global _root_keys
    load_path = path or str(Path(DEFAULT_KEY_DIR).expanduser() / "root.key")
    keys = KeyPair.load(load_path)
    _root_keys = keys
    return keys


def delegate(
    scopes: list[str],
    ttl: str | float | None = None,
    to: str | None = None,
    name: str | None = None,
    root: KeyPair | None = None,
    parent_token: str | None = None,
) -> str:
    """Issue a delegation token.

    If ``name`` is provided, the agent gets a persistent identity from the
    local registry. Same name = same DID across sessions.

    Returns a base64-encoded JSON token interoperable with the Rust CLI
    and delegation service.
    """
    if not scopes:
        raise AuthError("scopes cannot be empty")

    # Resolve signing key
    if parent_token:
        parent = _decode_token(parent_token)
        parent_chain = parent.get("chain", [])
        parent_scopes = parent.get("scopes", [])

        # Sub-delegation can only narrow (hierarchical: git.push covers git.push.repo)
        invalid = [s for s in scopes if not _scope_matches(s, parent_scopes)]
        if invalid:
            raise ScopeViolation(
                scope=invalid[0],
                has=parent_scopes,
                delegator_did=parent.get("agent_did"),
            )

        # Check chain depth
        if len(parent_chain) + 1 >= MAX_CHAIN_DEPTH:
            raise ChainTooDeep(len(parent_chain) + 1, MAX_CHAIN_DEPTH)

        # Parent's agent key becomes issuer for sub-delegation
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
        agent_keys = None
    elif name:
        from kanoniv_auth.registry import register_agent
        agent_keys = register_agent(name)
        agent_did = agent_keys.did
    else:
        agent_keys = generate_keys()
        agent_did = agent_keys.did

    # Compute expiry
    ttl_seconds = _parse_ttl(ttl) if ttl is not None else None
    expires_at: float | None = None
    if ttl_seconds is not None:
        expires_at = time.time() + ttl_seconds
        # Cannot exceed parent's expiry
        if parent_token:
            parent_expires = parent.get("expires_at")
            if parent_expires is not None:
                expires_at = min(expires_at, parent_expires)

    # Build caveats (Rust-compatible format)
    caveats = [{"type": "action_scope", "value": sorted(scopes)}]
    if expires_at is not None:
        exp_dt = datetime.datetime.fromtimestamp(expires_at, tz=datetime.timezone.utc)
        caveats.append({
            "type": "expires_at",
            "value": exp_dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{exp_dt.microsecond // 1000:03d}Z",
        })

    # Build the delegation link (Rust Delegation struct format)
    # Sign the payload: {issuer_did, delegate_did, caveats, parent_hash}
    nonce = str(uuid.uuid4())
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.datetime.now(datetime.timezone.utc).microsecond // 1000:03d}Z"

    signed_payload = {
        "caveats": caveats,
        "delegate_did": agent_did,
        "issuer_did": issuer_did,
        "parent_hash": None,
    }
    # Sign the canonical envelope: {nonce, payload, signer_did, timestamp}
    # This matches the Rust SignedMessage::sign() canonical form exactly.
    canonical = {
        "nonce": nonce,
        "payload": signed_payload,
        "signer_did": issuer_did,
        "timestamp": ts,
    }
    canonical_bytes = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    signature = signing_keys.sign(canonical_bytes)

    proof = {
        "nonce": nonce,
        "payload": signed_payload,
        "signature": signature,
        "signer_did": issuer_did,
        "timestamp": ts,
    }

    link = {
        "issuer_did": issuer_did,
        "delegate_did": agent_did,
        "issuer_public_key": list(signing_keys.public_key_bytes),
        "caveats": caveats,
        "parent_proof": None,
        "proof": proof,
    }

    # Build the token
    token_data: dict[str, Any] = {
        "version": 1,
        "chain": parent_chain + [link],
        "agent_did": agent_did,
        "scopes": sorted(scopes),
    }
    if expires_at is not None:
        token_data["expires_at"] = expires_at
    if name:
        token_data["agent_name"] = name

    # Embed agent keys for sub-delegation and signing
    if agent_keys is not None:
        token_data["agent_private_key"] = agent_keys.export_private()

    # Save token locally
    _save_token(token_data)

    # Audit log
    from kanoniv_auth.audit import log_event
    scopes_str = ",".join(sorted(scopes))
    ttl_str = f"ttl={ttl}" if ttl else "no-expiry"
    log_event(
        action="delegate",
        detail=f"scopes=[{scopes_str}] {ttl_str}",
        agent_name=name,
        agent_did=agent_did,
    )

    return _encode_token(token_data)


def verify(
    action: str,
    token: str,
    root_did: str | None = None,
) -> dict:
    """Verify a delegation token against an action.

    Checks expiry, scope, chain signatures, and scope narrowing.
    """
    data = _decode_token(token)
    chain = data.get("chain", [])

    if len(chain) > MAX_CHAIN_DEPTH:
        raise ChainTooDeep(len(chain), MAX_CHAIN_DEPTH)

    if not chain:
        raise TokenParseError("token has no delegation chain")

    # Check expiry
    expires_at = data.get("expires_at")
    now = time.time()
    if expires_at is not None and now > expires_at:
        raise TokenExpired(now - expires_at)

    # Check scope (hierarchical: git.push grants git.push.repo.branch)
    token_scopes = data.get("scopes", [])
    if not _scope_matches(action, token_scopes):
        root_link = chain[0] if chain else {}
        raise ScopeViolation(
            scope=action,
            has=token_scopes,
            delegator_did=root_link.get("issuer_did"),
        )

    # Verify chain signatures
    expected_root = root_did or (_root_keys.did if _root_keys else None)

    for i, link in enumerate(chain):
        # Get issuer public key from link
        issuer_pub = link.get("issuer_public_key")
        if not issuer_pub:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "missing issuer_public_key")

        # Convert public key to bytes
        if isinstance(issuer_pub, list):
            pub_bytes = bytes(issuer_pub)
        elif isinstance(issuer_pub, str):
            pub_bytes = bytes.fromhex(issuer_pub)
        else:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "invalid issuer_public_key format")

        # Verify the proof signature
        proof = link.get("proof")
        if proof is None:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "missing proof")

        sig = proof.get("signature")
        if not sig:
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"), "missing signature in proof")

        # Reconstruct the canonical envelope for verification.
        # Rust signs: {nonce, payload, signer_did, timestamp} as sorted-key JSON.
        signed_payload = proof.get("payload")
        if signed_payload is None:
            signed_payload = {
                "caveats": link.get("caveats", []),
                "delegate_did": link.get("delegate_did", ""),
                "issuer_did": link.get("issuer_did", ""),
                "parent_hash": None,
            }

        canonical = {
            "nonce": proof.get("nonce", ""),
            "payload": signed_payload,
            "signer_did": proof.get("signer_did", link.get("issuer_did", "")),
            "timestamp": proof.get("timestamp", ""),
        }
        payload_bytes = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()

        if not verify_signature_with_key(pub_bytes, payload_bytes, sig):
            raise SignatureInvalid(i, link.get("issuer_did", "unknown"))

        # Verify root DID on first link
        if i == 0 and expected_root and link.get("issuer_did") != expected_root:
            raise SignatureInvalid(
                0, link.get("issuer_did", "unknown"),
                f"root DID mismatch: expected {expected_root}",
            )

        # Check per-link expiry from caveats
        for caveat in link.get("caveats", []):
            if caveat.get("type") == "expires_at":
                try:
                    exp_str = caveat["value"]
                    exp_dt = datetime.datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
                    if now > exp_dt.timestamp():
                        raise TokenExpired(now - exp_dt.timestamp())
                except (ValueError, KeyError):
                    pass

    ttl_remaining = (expires_at - now) if expires_at else None

    # Audit log
    from kanoniv_auth.audit import log_event
    agent_name = data.get("agent_name")
    if not agent_name:
        from kanoniv_auth.registry import resolve_name
        agent_name = resolve_name(data.get("agent_did", ""))
    log_event(
        action="verify",
        detail=f"scope={action}",
        result="PASS",
        agent_name=agent_name,
        agent_did=data.get("agent_did"),
    )

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
    """Sign an execution envelope using the agent's delegated key."""
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

    payload = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()
    envelope["signature"] = agent_keys.sign(payload)
    envelope["delegation_chain"] = data.get("chain", [])

    # Audit log
    from kanoniv_auth.audit import log_event
    agent_name = data.get("agent_name")
    if not agent_name:
        from kanoniv_auth.registry import resolve_name
        agent_name = resolve_name(data.get("agent_did", ""))
    target_str = f"target={target}" if target else ""
    log_event(
        action="sign",
        detail=f"action={action} {target_str} result={result}".strip(),
        agent_name=agent_name,
        agent_did=data.get("agent_did"),
    )

    return _encode_token(envelope)


# --- Token storage ---

def _save_token(token_data: dict) -> None:
    """Save token to ~/.kanoniv/tokens/."""
    token_dir = Path(DEFAULT_TOKEN_DIR).expanduser()
    token_dir.mkdir(parents=True, exist_ok=True)

    agent_did = token_data.get("agent_did", "unknown")
    # Use short hash of agent_did as filename
    short = agent_did.split(":")[-1][:12] if ":" in agent_did else agent_did[:12]
    scopes = token_data.get("scopes", [])
    scope_tag = "-".join(s.replace(".", "_") for s in scopes[:3])
    filename = f"{scope_tag}_{short}.token" if scope_tag else f"{short}.token"

    token_path = token_dir / filename
    token_path.write_text(_encode_token(token_data))

    # Also save as "latest"
    latest_path = token_dir / "latest.token"
    latest_path.write_text(_encode_token(token_data))


def load_token(path: str | None = None) -> str:
    """Load a token from disk. Defaults to ~/.kanoniv/tokens/latest.token."""
    if path:
        return Path(path).expanduser().read_text().strip()
    latest = Path(DEFAULT_TOKEN_DIR).expanduser() / "latest.token"
    if latest.exists():
        return latest.read_text().strip()
    raise AuthError(
        "No token found. Delegate first:\n"
        "  kanoniv-auth delegate --scopes deploy.staging --ttl 4h"
    )


def list_tokens() -> list[dict]:
    """List all saved tokens with their metadata."""
    token_dir = Path(DEFAULT_TOKEN_DIR).expanduser()
    if not token_dir.exists():
        return []
    tokens = []
    for f in sorted(token_dir.glob("*.token")):
        if f.name == "latest.token":
            continue
        try:
            data = _decode_token(f.read_text().strip())
            expires = data.get("expires_at")
            expired = expires is not None and time.time() > expires
            tokens.append({
                "file": f.name,
                "agent_did": data.get("agent_did", "?"),
                "scopes": data.get("scopes", []),
                "expires_at": expires,
                "expired": expired,
                "chain_depth": len(data.get("chain", [])),
            })
        except Exception:
            pass
    return tokens


# --- Scope matching ---

def _scope_matches(action: str, token_scopes: list[str]) -> bool:
    """Check if an action is covered by the token's scopes.

    Hierarchical: a scope of "git.push" covers "git.push.myrepo.main".
    A scope of "git.push.myrepo" covers "git.push.myrepo.main" but NOT "git.push.other".
    Exact match always works: "code.edit" covers "code.edit".
    """
    for scope in token_scopes:
        if action == scope:
            return True
        # Hierarchical: scope is a prefix of the action
        if action.startswith(scope + "."):
            return True
        # Reverse: action is a parent of a granted scope (not allowed -
        # you can't use git.push if you only have git.push.myrepo)
    return False


# --- Token encoding ---

def _encode_token(data: dict) -> str:
    """Encode token data as base64url JSON (no padding)."""
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_token(token: str) -> dict:
    """Decode a base64url JSON token."""
    try:
        padded = token.strip()
        padded += "=" * (4 - len(padded) % 4) if len(padded) % 4 else ""
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
    """Parse a TTL value into seconds."""
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
