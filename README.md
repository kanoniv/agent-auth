# kanoniv-agent-auth

Cryptographic identity primitives for AI agents. Ed25519 keypairs, `did:kanoniv:` decentralized identifiers, signed message envelopes, and provenance entries.

One library, three languages, byte-identical outputs.

## Install

```bash
# Rust
cargo add kanoniv-agent-auth

# TypeScript / JavaScript
npm install @kanoniv/agent-auth

# Python
pip install kanoniv-agent-auth
```

## Quick Start

### Rust

```rust
use kanoniv_agent_auth::{AgentKeyPair, SignedMessage, ProvenanceEntry, ActionType};

// Generate identity
let keypair = AgentKeyPair::generate();
let identity = keypair.identity();
println!("DID: {}", identity.did);
// did:kanoniv:21fe31dfa154a261626bf854046fd227

// Sign a message
let payload = serde_json::json!({"action": "merge", "entity_id": "abc123"});
let signed = SignedMessage::sign(&keypair, payload).unwrap();

// Verify
signed.verify(&identity).unwrap();

// Provenance chain
let entry = ProvenanceEntry::create(
    &keypair,
    ActionType::Merge,
    vec!["entity-1".into(), "entity-2".into()],
    vec![],
    serde_json::json!({"reason": "duplicate"}),
).unwrap();

// Chain entries
let next = ProvenanceEntry::create(
    &keypair,
    ActionType::Resolve,
    vec!["entity-3".into()],
    vec![entry.content_hash()],
    serde_json::json!({}),
).unwrap();
```

### TypeScript

```typescript
import {
  generateKeyPair,
  signMessage,
  verifyMessage,
  createProvenanceEntry,
  provenanceContentHash,
} from "@kanoniv/agent-auth";

// Generate identity
const keypair = generateKeyPair();
console.log("DID:", keypair.identity.did);

// Sign and verify
const signed = signMessage(keypair, { action: "merge", entity_id: "abc123" });
verifyMessage(signed, keypair.identity); // throws on failure

// Provenance chain
const entry = createProvenanceEntry(
  keypair,
  "merge",
  ["entity-1", "entity-2"],
  [],
  { reason: "duplicate" },
);

const next = createProvenanceEntry(
  keypair,
  "resolve",
  ["entity-3"],
  [provenanceContentHash(entry)],
  {},
);
```

### Python

```python
from kanoniv_agent_auth import AgentKeyPair, ProvenanceEntry
import json

# Generate identity
keypair = AgentKeyPair.generate()
identity = keypair.identity()
print(f"DID: {identity.did}")

# Sign and verify
signed = keypair.sign('{"action": "merge", "entity_id": "abc123"}')
signed.verify(identity)  # raises ValueError on failure

# Provenance chain
entry = ProvenanceEntry.create(
    keypair, "merge",
    ["entity-1", "entity-2"], [],
    '{"reason": "duplicate"}',
)

next_entry = ProvenanceEntry.create(
    keypair, "resolve",
    ["entity-3"], [entry.content_hash()],
    "{}",
)
```

## What's Inside

| Primitive | Description |
|-----------|-------------|
| `AgentKeyPair` | Ed25519 keypair generation and persistence |
| `AgentIdentity` | `did:kanoniv:` DID derivation and DID Documents |
| `SignedMessage` | Canonical JSON signing with nonce and timestamp |
| `ProvenanceEntry` | Signed audit trail with DAG chaining |

## DID Format

```
did:kanoniv:{hex(sha256(public_key)[..16])}
```

32-character hex identifier derived from the SHA-256 hash of the Ed25519 public key, truncated to 128 bits.

## Cross-Language Interop

All three implementations produce byte-identical:
- DIDs from the same public key
- Canonical JSON for signing
- Content hashes for provenance chaining

The `fixtures/` directory contains test vectors generated from a known secret key. Every implementation is tested against these fixtures.

## Specification

See [spec/AGENT-IDENTITY.md](spec/AGENT-IDENTITY.md) for the formal specification.

## License

MIT
