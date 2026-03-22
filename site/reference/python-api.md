# Python API Reference

```bash
pip install kanoniv-auth
```

## Core Functions

### `delegate()`

Issue a delegation token.

```python
from kanoniv_auth import delegate

token = delegate(
    scopes=["deploy.staging", "build"],  # required
    ttl="4h",                            # optional: "30m", "1d", 3600
    name="claude-code",                  # optional: persistent agent identity
    to="did:agent:...",                  # optional: delegate to specific DID
    root=keypair,                        # optional: override module-level root
    parent_token="eyJ...",               # optional: sub-delegation
)
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scopes` | `list[str]` | Yes | Scopes to grant. Cannot be empty. |
| `ttl` | `str \| float \| None` | No | Time-to-live. Strings: `"4h"`, `"30m"`, `"1d"`, `"3600s"`. Numbers: seconds. |
| `name` | `str \| None` | No | Agent name for persistent identity. Same name = same DID across sessions. Stored in `~/.kanoniv/agents.json`. |
| `to` | `str \| None` | No | Delegate to a specific DID. If omitted, generates a new agent identity. |
| `root` | `KeyPair \| None` | No | Root key pair. If omitted, uses module-level key (set by `init_root`/`load_root`). |
| `parent_token` | `str \| None` | No | Parent token for sub-delegation. Scopes can only narrow. |

**Scope matching is hierarchical.** A scope of `git.push` covers `git.push.myrepo.main`. A scope of `git.push.myrepo` covers `git.push.myrepo.main` but not `git.push.other`. See [How It Works - Hierarchical Scopes](/guide/how-it-works#hierarchical-scopes).

**Returns:** `str` - Base64url-encoded token.

**Raises:**
- `AuthError` - scopes empty
- `NoRootKey` - no root key available
- `ScopeViolation` - sub-delegation tries to widen scope
- `ChainTooDeep` - chain exceeds 32 links

---

### `verify()`

Verify a token against an action.

```python
from kanoniv_auth import verify

result = verify(
    action="deploy.staging",   # required
    token="eyJ...",            # required
    root_did="did:agent:...",  # optional: expected root DID
)
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `str` | Yes | The action to verify against the token's scopes. |
| `token` | `str` | Yes | Base64url-encoded delegation token. |
| `root_did` | `str \| None` | No | Expected root authority DID. If provided, verification fails if chain root doesn't match. |

**Returns:** `dict` with:

```python
{
    "valid": True,
    "agent_did": "did:agent:...",
    "root_did": "did:agent:...",
    "scopes": ["deploy.staging", "build"],
    "expires_at": 1742680800.0,
    "ttl_remaining": 14380.0,
    "chain_depth": 1,
}
```

**Raises:**
- `ScopeViolation` - action not in token's scopes
- `TokenExpired` - token has expired
- `SignatureInvalid` - chain signature verification failed
- `ChainTooDeep` - chain exceeds 32 links
- `TokenParseError` - malformed token

---

### `sign()`

Sign an execution envelope for the audit trail.

```python
from kanoniv_auth import sign

envelope = sign(
    action="deploy",           # required
    token="eyJ...",            # required
    target="staging",          # optional
    result="success",          # optional: "success", "failure", "partial"
    metadata={"commit": "abc"},  # optional
)
```

**Returns:** `str` - Base64url-encoded signed envelope containing the action, delegation chain, and Ed25519 signature.

---

## Key Management

### `init_root(path=None)`

Generate and save a new root key pair.

```python
from kanoniv_auth import init_root

keys = init_root()                     # saves to ~/.kanoniv/root.key
keys = init_root("/path/to/root.key")  # custom path
```

### `load_root(path=None)`

Load an existing root key pair.

```python
from kanoniv_auth import load_root

keys = load_root()                     # loads from ~/.kanoniv/root.key
keys = load_root("/path/to/root.key")
```

### `load_token(path=None)`

Load a saved token from disk.

```python
from kanoniv_auth import load_token

token = load_token()                        # loads ~/.kanoniv/tokens/latest.token
token = load_token("/path/to/my.token")
```

### `list_tokens()`

List all saved tokens with metadata.

```python
from kanoniv_auth import list_tokens

for t in list_tokens():
    print(t["agent_did"], t["scopes"], t["expired"])
```

---

## Agent Registry

Persistent named identities stored in `~/.kanoniv/agents.json`. Same name = same DID across sessions.

### `register_agent(name)`

Register a new named agent or return the existing one.

```python
from kanoniv_auth import register_agent

keys = register_agent("claude-code")
print(keys.did)  # did:agent:5e0641c3749e...
```

If the name already exists, returns the existing keypair. If new, generates a fresh Ed25519 keypair and stores it.

### `get_agent(name)`

Get a named agent's keypair, or `None` if not registered.

```python
from kanoniv_auth import get_agent

keys = get_agent("claude-code")
if keys:
    print(keys.did)
```

### `list_agents()`

List all registered agents.

```python
from kanoniv_auth import list_agents

for agent in list_agents():
    print(agent["name"], agent["did"], agent["created_at"])
```

Returns a list of dicts with `name`, `did`, and `created_at` fields.

### `resolve_name(did)`

Reverse lookup: find the agent name for a DID.

```python
from kanoniv_auth import resolve_name

name = resolve_name("did:agent:5e0641c3749e...")
print(name)  # "claude-code" or None
```

---

## Errors

All errors inherit from `AuthError`.

```python
from kanoniv_auth import (
    AuthError,        # base class
    ScopeViolation,   # action not in delegation scope
    TokenExpired,     # token past expires_at
    SignatureInvalid,  # Ed25519 signature check failed
    ChainTooDeep,     # delegation chain > 32 links
    TokenParseError,  # malformed base64 or JSON
    NoRootKey,        # no root key loaded
)
```

### ScopeViolation

```python
try:
    verify(action="deploy.prod", token=token)
except ScopeViolation as e:
    print(e)
    # DENIED: scope "deploy.prod" not in delegation
    #
    #   You have:  ["deploy.staging"]
    #   You need:  ["deploy.prod"]
    #
    #   To request escalation:
    #     kanoniv-auth request-scope --scope deploy.prod --from did:agent:...
```

### TokenExpired

```python
try:
    verify(action="deploy.staging", token=expired_token)
except TokenExpired as e:
    print(e)
    # Token expired 2h ago. Re-delegate:
    #   kanoniv-auth delegate --scopes deploy.staging --ttl 4h
```

---

## Crypto Primitives

```python
from kanoniv_auth.crypto import generate_keys, KeyPair

keys = generate_keys()
print(keys.did)                # did:agent:...
print(keys.public_key_bytes)   # 32 bytes
sig = keys.sign(b"message")    # hex-encoded Ed25519 signature
keys.save("~/.kanoniv/my.key") # Rust-compatible key file format
```
