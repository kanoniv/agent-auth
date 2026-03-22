# Token Format Specification

Tokens are base64url-encoded JSON. This page documents the exact format for interoperability with custom implementations.

## Encoding

Base64url (RFC 4648) without padding. To decode:

```python
import base64, json
padded = token + "=" * (4 - len(token) % 4) if len(token) % 4 else token
data = json.loads(base64.urlsafe_b64decode(padded))
```

## Token Structure

```json
{
  "version": 1,
  "chain": [ /* array of Delegation links */ ],
  "agent_did": "did:agent:5e0641c3749e...",
  "scopes": ["deploy.staging", "build"],
  "expires_at": 1742680800.0,
  "agent_private_key": "base64url-encoded Ed25519 private key"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | `int` | Always `1` |
| `chain` | `array` | Delegation chain, ordered root-first |
| `agent_did` | `string` | DID of the token holder |
| `scopes` | `string[]` | Effective scopes (sorted) |
| `expires_at` | `float?` | Unix timestamp. Null = no expiry. |
| `agent_private_key` | `string?` | Base64url Ed25519 private key. Present when the agent can sub-delegate. |

::: warning
Tokens containing `agent_private_key` are sensitive like SSH keys. Do not log, commit, or expose them.
:::

## Chain Link (Delegation)

Each element in the `chain` array:

```json
{
  "issuer_did": "did:agent:b15b9019a4c8...",
  "delegate_did": "did:agent:5e0641c3749e...",
  "issuer_public_key": [174, 23, 89, ...],
  "caveats": [
    {"type": "action_scope", "value": ["deploy.staging", "build"]},
    {"type": "expires_at", "value": "2026-03-22T22:00:00.000Z"}
  ],
  "parent_proof": null,
  "proof": {
    "nonce": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "payload": {
      "issuer_did": "did:agent:b15b9019...",
      "delegate_did": "did:agent:5e0641c3...",
      "caveats": [...],
      "parent_hash": null
    },
    "signature": "a1b2c3d4...128 hex chars...",
    "signer_did": "did:agent:b15b9019...",
    "timestamp": "2026-03-22T18:00:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `issuer_did` | `string` | DID of the granting authority |
| `delegate_did` | `string` | DID of the receiving agent |
| `issuer_public_key` | `int[]` | 32-byte Ed25519 public key as integer array |
| `caveats` | `array` | Restrictions on the delegation |
| `parent_proof` | `object?` | Parent delegation (null for root) |
| `proof` | `object` | Signed envelope proving the delegation |

## Caveat Types

| Type | Value | Description |
|------|-------|-------------|
| `action_scope` | `string[]` | Allowed actions (sorted) |
| `expires_at` | `string` | ISO 8601 expiry timestamp |
| `max_cost` | `float` | Maximum cost ceiling |
| `resource` | `string` | Resource glob pattern |
| `context` | `{key, value}` | Context restriction |
| `custom` | `{key, value}` | User-defined caveat |

## Proof (Signed Envelope)

The proof is an Ed25519 signature over the canonical JSON:

```json
{"nonce":"...","payload":{...},"signer_did":"...","timestamp":"..."}
```

**Canonical form:**
- Top-level keys sorted alphabetically
- Compact separators (no spaces): `separators=(",", ":")`
- UTF-8 encoded

The signature is hex-encoded (128 hex chars = 64 bytes).

## DID Format

```
did:agent:{hex(sha256(public_key_bytes)[..16])}
```

- `public_key_bytes`: 32-byte Ed25519 public key
- SHA-256 hash, first 16 bytes, hex-encoded (32 hex chars)
- Deterministic: same key always produces same DID

## Verification Algorithm

```
function verify(token, action, expected_root_did):
  1. Decode base64url JSON
  2. Check expires_at > now
  3. Check action in scopes
  4. For each link in chain:
     a. Reconstruct identity from issuer_public_key
     b. Check sha256(issuer_public_key)[..16] == claimed issuer_did
     c. Build canonical JSON: {nonce, payload, signer_did, timestamp}
     d. Verify Ed25519 signature against issuer_public_key
     e. If not first link: check issuer_did == previous delegate_did
  5. Check first link's issuer_did == expected_root_did
  6. Return valid
```

## Cross-SDK Interoperability

Tokens produced by any SDK (Rust, Python, TypeScript) are interchangeable. The canonical signing envelope ensures deterministic serialization across languages.

| SDK | Package | Registry |
|-----|---------|----------|
| Rust | `kanoniv-agent-auth` | crates.io |
| Python | `kanoniv-auth` | PyPI |
| TypeScript | `@kanoniv/agent-auth` | npm |
