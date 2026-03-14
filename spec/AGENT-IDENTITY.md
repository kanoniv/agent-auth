# Kanoniv Agent Identity Specification

**Version:** 0.1.0
**Status:** Draft
**Authors:** Kanoniv

## 1. Overview

This document specifies the cryptographic identity primitives used by Kanoniv for AI agent authentication, message signing, and provenance tracking. The specification covers four primitives:

1. **Agent Keypair** - Ed25519 key generation and persistence
2. **Agent DID** - Decentralized identifier derivation
3. **Signed Message Envelope** - Canonical JSON signing and verification
4. **Provenance Entry** - Signed audit trail with DAG chaining

All implementations MUST produce identical outputs for identical inputs across languages.

## 2. Key Algorithm

**Algorithm:** Ed25519 (RFC 8032)
**Key size:** 256-bit (32-byte secret key, 32-byte public key)
**Signature size:** 512-bit (64 bytes)

### 2.1 Key Generation

Generate a random 32-byte secret key using a cryptographically secure random number generator (`CSPRNG`). Derive the Ed25519 signing key and corresponding verifying (public) key per RFC 8032.

### 2.2 Key Persistence

Secret keys are exported as raw 32-byte arrays. Implementations SHOULD support:
- `from_bytes(secret: [u8; 32]) -> AgentKeyPair`
- `secret_bytes() -> [u8; 32]`

Storage of secret keys is the responsibility of the caller. Keys SHOULD be stored encrypted at rest.

## 3. DID Method: `did:kanoniv`

### 3.1 DID Format

```
did:kanoniv:<identifier>
```

Where `<identifier>` is computed as:

```
identifier = hex_encode(SHA-256(public_key_bytes)[0..16])
```

- `public_key_bytes`: The 32-byte Ed25519 public key
- `SHA-256`: Applied to the raw public key bytes
- `[0..16]`: First 16 bytes of the hash (128-bit truncation)
- `hex_encode`: Lowercase hexadecimal encoding

The resulting DID is always exactly `did:kanoniv:` followed by 32 lowercase hex characters.

**Example:**
```
Public key (hex): d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
SHA-256 of key:   21fe31dfa154a261626bf854046fd227...
DID:              did:kanoniv:21fe31dfa154a261626bf854046fd227
```

### 3.2 DID Document

Implementations MUST generate a W3C-compatible DID Document:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:kanoniv:21fe31dfa154a261626bf854046fd227",
  "verificationMethod": [{
    "id": "did:kanoniv:21fe31dfa154a261626bf854046fd227#key-1",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:kanoniv:21fe31dfa154a261626bf854046fd227",
    "publicKeyBase64": "<base64-standard-encoded-public-key>"
  }],
  "authentication": ["did:kanoniv:21fe31dfa154a261626bf854046fd227#key-1"],
  "assertionMethod": ["did:kanoniv:21fe31dfa154a261626bf854046fd227#key-1"]
}
```

- `publicKeyBase64`: Standard Base64 encoding (RFC 4648) of the 32-byte public key
- Verification method ID: `<did>#key-1`

## 4. Signed Message Envelope

### 4.1 Envelope Structure

```json
{
  "payload": <any JSON value>,
  "signer_did": "did:kanoniv:<identifier>",
  "nonce": "<uuid-v4>",
  "timestamp": "<rfc3339-millis-utc>",
  "signature": "<hex-encoded-ed25519-signature>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `payload` | JSON value | Arbitrary message content |
| `signer_did` | string | DID of the signing agent |
| `nonce` | string | UUID v4 for replay protection |
| `timestamp` | string | RFC 3339 with milliseconds, UTC (`Z` suffix) |
| `signature` | string | Lowercase hex-encoded 64-byte Ed25519 signature |

### 4.2 Canonical Serialization

The signature covers a **canonical byte representation** of the envelope, computed as follows:

1. Construct an ordered map with exactly four keys in this order:
   - `"nonce"` -> JSON string of the nonce
   - `"payload"` -> the payload value **as-is** (not recursively sorted)
   - `"signer_did"` -> JSON string of the DID
   - `"timestamp"` -> JSON string of the timestamp

2. Serialize the ordered map to JSON bytes (UTF-8, no trailing newline, compact form).

**Critical:** Only the top-level envelope keys are sorted. The `payload` value is included in its original serialization form. Implementations MUST NOT recursively sort keys within the payload.

**Example canonical form:**
```json
{"nonce":"<uuid>","payload":{"z":1,"a":2},"signer_did":"did:kanoniv:...","timestamp":"2026-01-01T00:00:00.000Z"}
```

Note: payload keys `z` and `a` retain their original order.

### 4.3 Signing Algorithm

1. Generate nonce: UUID v4
2. Generate timestamp: current UTC time in RFC 3339 with milliseconds and `Z` suffix
3. Compute canonical bytes per Section 4.2
4. Sign canonical bytes with Ed25519 secret key
5. Hex-encode the 64-byte signature (lowercase)

### 4.4 Verification Algorithm

1. Check `signer_did` matches the expected identity's DID. If not, fail.
2. Recompute canonical bytes from `{payload, signer_did, nonce, timestamp}` per Section 4.2
3. Decode hex signature to 64 bytes
4. Verify Ed25519 signature against canonical bytes using the identity's public key

### 4.5 Content Hash

The content hash of a signed message is:

```
hex_encode(SHA-256(json_serialize(signed_message)))
```

Where `json_serialize` is the standard (non-canonical) JSON serialization of the entire `SignedMessage` struct. This hash is used as a unique identifier for the message, notably for provenance chaining.

## 5. Provenance Entry

### 5.1 Entry Structure

```json
{
  "agent_did": "did:kanoniv:<identifier>",
  "action": "<action_type>",
  "entity_ids": ["<id>", ...],
  "parent_ids": ["<content_hash>", ...],
  "metadata": <any JSON value>,
  "signed_envelope": <SignedMessage>
}
```

| Field | Type | Description |
|-------|------|-------------|
| `agent_did` | string | DID of the acting agent |
| `action` | string | Action type (see below) |
| `entity_ids` | string[] | Entity IDs affected |
| `parent_ids` | string[] | Content hashes of parent entries (DAG links) |
| `metadata` | JSON value | Arbitrary context |
| `signed_envelope` | SignedMessage | Cryptographic proof |

### 5.2 Action Types

Standard action types (serialized as lowercase strings):

| Action | Description |
|--------|-------------|
| `resolve` | Identity resolution |
| `merge` | Entity merge |
| `split` | Entity split |
| `mutate` | Entity field update |
| `ingest` | Data ingestion |
| `delegate` | Permission delegation |
| `revoke` | Permission revocation |
| `custom:<name>` | User-defined action |

Custom actions are serialized as `{"custom": "<name>"}`.

### 5.3 Signed Payload

The `signed_envelope` contains a payload with ALL provenance fields:

```json
{
  "agent_did": "...",
  "action": "...",
  "entity_ids": [...],
  "parent_ids": [...],
  "metadata": {...}
}
```

This ensures that tampering with the outer fields (e.g. `entity_ids`) can be detected by comparing against the signed payload.

### 5.4 DAG Chaining

Entries form a directed acyclic graph (DAG) via `parent_ids`. Each parent ID is the `content_hash()` of a prior entry's `signed_envelope`.

- **Root entries**: `parent_ids = []`
- **Linear chains**: `parent_ids = [<single_hash>]`
- **Merge entries**: `parent_ids = [<hash_a>, <hash_b>, ...]` (multiple parents)

This model supports richer topologies than a linear chain. Merge operations naturally reference multiple parent entries.

## 6. Cross-Language Interoperability

### 6.1 Test Vectors

The `fixtures/` directory contains deterministic test vectors generated from a known secret key:

```
Secret: 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60
Public: d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
DID:    did:kanoniv:21fe31dfa154a261626bf854046fd227
```

### 6.2 Interop Requirements

All implementations MUST:

1. Derive the same DID from the same public key bytes
2. Verify signatures produced by any other implementation
3. Produce canonical bytes that are byte-identical across implementations
4. Compute the same content hashes for the same signed messages

### 6.3 Canonical JSON Implementation Notes

- **Rust**: Use `BTreeMap<&str, Value>` for deterministic key ordering
- **TypeScript**: Construct JSON string by concatenating keys in order (do NOT use `JSON.stringify` on an object, as key order is implementation-dependent for integer keys)
- **Python**: Use `collections.OrderedDict` or manually construct the JSON string

## 7. Security Considerations

- **Nonce reuse**: Each signed message MUST use a fresh UUID v4 nonce. Reusing nonces enables replay attacks.
- **Timestamp drift**: Verifiers MAY reject messages with timestamps too far in the past or future. The signed envelope format includes the timestamp for this purpose, but enforcement is application-specific.
- **Key storage**: Secret keys MUST be stored securely. This specification does not mandate a storage mechanism.
- **DID collision**: The 128-bit truncation provides adequate collision resistance for practical use (birthday bound at ~2^64 identities).
