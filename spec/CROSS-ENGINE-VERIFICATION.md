# Cross-Engine Delegation Verification

**Version:** 0.1.0
**Status:** Proven (Round 1 complete)
**Engines verified:** Kanoniv, APS, AIP

## 1. Overview

This document specifies how AI agent systems built on different identity engines can cross-verify delegation chains and decision artifacts. It codifies results from the cross-engine interop test (kanoniv/agent-auth#2), where three independent implementations verified each other's Ed25519 delegation signatures.

The key insight: **trust artifacts are already portable across agent systems**. Different DID methods, key encodings, and canonical forms all resolve to the same Ed25519 verification. This spec documents the interop surface so other engines can participate.

## 2. Participants

| Engine | DID Method | Key Encoding | Canonical Form | Signature Encoding |
|--------|-----------|-------------|---------------|-------------------|
| Kanoniv | `did:key` (multicodec `0xed01`) | base64url | `json.dumps(sort_keys=True)` (spaced) | base64url |
| APS | `did:aps` (hex public key) | hex | `JSON.stringify` sorted keys, compact `(',',':')` | hex |
| AIP | `did:aip` (live registry) | base64url | `json.dumps(sort_keys=True)` (spaced) | base64url |

## 3. Common Ground

All engines agree on:

- **Algorithm:** Ed25519 (RFC 8032)
- **Key size:** 32-byte public key, 64-byte signature
- **Signed payload:** Delegation fields minus signature metadata, serialized as canonical JSON
- **Scope narrowing:** Sub-delegations MUST be a strict subset of parent scopes
- **Expiry:** Delegations carry `expires_at` timestamps; verifiers MUST reject expired chains

All engines differ on:

- DID method (resolution path to public key bytes)
- Key and signature encoding (base64url vs hex)
- Canonical JSON separators (spaced vs compact)
- Field names (snake_case vs camelCase)
- Which fields are included in the signed payload

**These differences are transport-level, not protocol-level.** Verification works because the public key material resolves to the same 32 bytes regardless of encoding.

## 4. Delegation Structure

A delegation chain is a sequence of signed grants from delegator to delegate, each narrowing the scope of authority.

### 4.1 Minimum Required Fields

Every delegation MUST include at minimum:

| Field | Type | Description |
|-------|------|-------------|
| `delegator` | string | DID or public key identifier of the granting agent |
| `delegate` | string | DID or public key identifier of the receiving agent |
| `scopes` | string[] | Permissions granted |
| `created_at` | string | ISO 8601 / RFC 3339 timestamp |
| `expires_at` | string | ISO 8601 / RFC 3339 expiry |
| `signature` | string | Ed25519 signature over canonical payload |
| `public_key` | string | Public key of the delegator (for verification) |

### 4.2 Optional Fields

Engines MAY include additional fields in the signed payload:

| Field | Used By | Description |
|-------|---------|-------------|
| `parent_delegation` | AIP | Reference to parent delegation ID |
| `maxDepth` | APS | Maximum chain depth |
| `currentDepth` | APS | Current position in chain |
| `spendLimit` | APS | Cost ceiling |
| `spentAmount` | APS | Amount spent so far |
| `delegationId` | APS | Unique delegation identifier |

### 4.3 Canonical Form Rules

The signed payload is the delegation object with signature metadata removed, serialized as canonical JSON.

**Fields excluded from signing:**
- `signature`
- `public_key`
- Engine-specific metadata fields (`revoked`, `revokedAt`, `revokedReason` for APS)

**Serialization:**

| Engine | Separator | Key Order | Null Handling | Field Names |
|--------|-----------|-----------|---------------|-------------|
| Kanoniv | Default (spaced: `", "`, `": "`) | `sort_keys=True` | Include | snake_case |
| APS | Compact (`','`, `':'`) | Sorted | Omit null/undefined | camelCase |
| AIP | Default (spaced) | `sort_keys=True` | Include | snake_case |

**Cross-engine verifiers** MUST reconstruct the payload using the originating engine's canonical form. The encoding is specified per-engine, not universal.

## 5. Verification Protocol

To verify a delegation chain from another engine:

### Step 1: Decode the public key

| Encoding | Decode Method |
|----------|---------------|
| base64url | `base64.urlsafe_b64decode(key + '=' * (4 - len(key) % 4))` |
| hex | `bytes.fromhex(key)` |
| `did:key` | Strip multicodec prefix `0xed01`, base58btc decode |
| `did:aip` | Resolve via `GET https://aip-service.fly.dev/resolve/{did}`, extract public key |

The result MUST be exactly 32 bytes (Ed25519 public key).

### Step 2: Reconstruct the signed payload

1. Take the delegation object
2. Remove fields excluded from signing (Section 4.3)
3. Serialize using the originating engine's canonical form (Section 4.3)
4. Encode to UTF-8 bytes

### Step 3: Decode the signature

| Encoding | Decode Method |
|----------|---------------|
| base64url | `base64.urlsafe_b64decode(sig + '=' * (4 - len(sig) % 4))` |
| hex | `bytes.fromhex(sig)` |

The result MUST be exactly 64 bytes (Ed25519 signature).

### Step 4: Verify

```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

pub_key = Ed25519PublicKey.from_public_bytes(pub_bytes)  # 32 bytes
pub_key.verify(sig_bytes, payload_bytes)  # raises on failure
```

### Step 5: Verify scope narrowing

For each delegation in the chain after the root:

```python
assert set(child_scopes).issubset(set(parent_scopes))
```

### Step 6: Verify expiry

```python
from datetime import datetime, timezone
assert datetime.fromisoformat(delegation["expires_at"]) > datetime.now(timezone.utc)
```

## 6. DID Method Interop

Three DID methods have been verified interoperable:

### 6.1 `did:key`

Self-resolving. Public key is embedded in the identifier.

```
did:key:z6Mk... -> base58btc decode -> strip 0xed01 prefix -> 32-byte Ed25519 public key
```

No network resolution required. Used by Kanoniv and AIP (for delegates).

### 6.2 `did:aps`

Public key is the hex-encoded identifier itself.

```
did:aps:0c8cde5278f7... -> the hex string after "did:aps:" IS the public key
```

Decode: `bytes.fromhex(did.split(":")[2])` -> 32-byte Ed25519 public key.

### 6.3 `did:aip`

Registry-resolved. Public key is fetched from a live service.

```
did:aip:c1965a89866e... -> GET https://aip-service.fly.dev/resolve/did:aip:c1965a89866e...
                        -> response.publicKey -> base64 decode -> 32-byte Ed25519 public key
```

This adds a third verification path: the public key can be independently confirmed via the registry, not just trusted from the delegation payload.

## 7. Decision Artifacts (Round X)

Beyond delegation verification, engines can produce signed **decision artifacts** that prove an authorization decision was made and can be independently verified.

### 7.1 Minimal Artifact Shape

```json
{
  "scenario_id": "round-x-001-permit",
  "engine": "<engine-name>",
  "action": "<requested-action>",
  "resource": "<target-resource>",
  "agent_did": "<agent-did>",
  "delegation_ref": {
    "delegator": "<delegator-did>",
    "scopes": ["<scope>", "..."],
    "signature": "<delegation-signature>",
    "public_key": "<delegator-public-key>"
  },
  "decision": "permit | deny",
  "reason": "<human-readable-explanation>",
  "trust_context": {
    "<engine>": { "...engine-specific-trust-signals..." }
  },
  "evaluated_at": "<rfc3339-timestamp>",
  "evaluator_did": "<evaluator-did>",
  "signature": "<evaluator-signature>",
  "public_key": "<evaluator-public-key>"
}
```

### 7.2 Signed Fields

The evaluator signs all fields except `signature`, `public_key`, and `evaluator_did`. Canonical JSON with sorted keys.

### 7.3 Trust Context

Each engine contributes its own trust signals. These are engine-specific and opaque to other verifiers - they verify the signature and decision, not the trust model.

| Engine | Trust Signals |
|--------|--------------|
| Kanoniv | `reputation_score`, `reputation_threshold`, `total_outcomes` |
| APS | `delegation_chain_depth`, `spend_remaining`, `floor_attestation` |
| AIP | `pdr_score`, `vouch_chain_depth` |

### 7.4 Convergence Test

The strongest interop proof is when multiple engines independently evaluate the same scenario and arrive at the same decision using different trust signals:

1. Define a common scenario (`scenario_id`, `action`, `resource`, delegation)
2. Each engine produces a signed decision artifact
3. Cross-verify: confirm signatures, confirm decisions match
4. Compare trust contexts to understand why each engine reached the same conclusion

## 8. Verification Matrix

Living record of cross-engine verification status.

### Round 1: Delegation Chain Verification (Complete)

| Verifier | Kanoniv | APS | AIP |
|----------|---------|-----|-----|
| **Kanoniv** | -- | Verified | Verified |
| **APS** | Verified | -- | Verified |
| **AIP** | Verified | Verified (D1), Pending (D2) | -- |

**Thread:** https://github.com/kanoniv/agent-auth/issues/2

### Round X: Decision Artifact Verification (In Progress)

Status: Artifacts designed. Verification pending.

## 9. Adding a New Engine

To join the cross-engine verification:

1. **Generate a delegation chain** - root -> coordinator -> researcher with scope narrowing
2. **Post to kanoniv/agent-auth#2** - include the chain JSON, public keys, and verification instructions
3. **Verify existing chains** - verify at least one other engine's chain and post results
4. **Document your canonical form** - which fields are signed, serialization rules, encoding

Requirements:
- Ed25519 signatures (mandatory - this is the common denominator)
- Public key material accessible for verification (embedded, resolvable, or both)
- Scope narrowing enforcement on sub-delegations

## 10. References

- [RFC 8032 - Ed25519](https://datatracker.ietf.org/doc/html/rfc8032)
- [DID Core Specification](https://www.w3.org/TR/did-core/)
- [did:key Method](https://w3c-ccg.github.io/did-method-key/)
- [Kanoniv Agent Identity Spec](./AGENT-IDENTITY.md)
- [Interop Thread](https://github.com/kanoniv/agent-auth/issues/2)
