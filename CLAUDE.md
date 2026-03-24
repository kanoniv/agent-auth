# CLAUDE.md - agent-auth Project Guide

## What This Is

**Sudo for AI agents.** Cryptographic delegation tokens that replace long-lived API keys with scope-confined, time-bounded, auditable authority chains. Ed25519 signatures, `did:agent:` identifiers, offline verification.

## Repository Structure

```
agent-auth/
  src/                         # Rust crate (kanoniv-agent-auth)
    lib.rs                     # Public API: identity, signing, delegation, mcp, provenance
    identity.rs                # AgentKeyPair, AgentIdentity, did:agent:{sha256_hex[..16]}
    signing.rs                 # SignedMessage with canonical JSON envelope
    delegation.rs              # Delegation chains with Caveat enum, verify_invocation()
    provenance.rs              # ProvenanceEntry for audit trails
    mcp.rs                     # McpProof for MCP server auth
    error.rs                   # CryptoError enum
    bin/
      main.rs                  # Rust CLI (kanoniv-auth) - requires feature "cli"
      server.rs                # Delegation service (Axum + SQLite) - requires feature "server"
      wrap_mcp.rs              # MCP stdin/stdout proxy with proof verification
  sdks/
    kanoniv-auth/              # Python SDK (pip install kanoniv-auth)
      kanoniv_auth/
        auth.py                # delegate(), verify(), sign() - the 3-function API
        crypto.py              # Ed25519 key generation, DID computation, signing
        errors.py              # ScopeViolation, TokenExpired, etc.
        cli.py                 # Click CLI (kanoniv-auth command)
      tests/                   # 67+ pytest tests
  js/                          # TypeScript SDK (@kanoniv/agent-auth on npm)
  python/                      # Python PyO3 bindings (wraps Rust via maturin)
  apps/observatory/            # React frontend (trust.kanoniv.com)
  action/                      # GitHub Action (kanoniv/auth-action)
  tests/interop/               # Cross-SDK interop tests
```

## Key Invariants

### DID Format
`did:agent:{hex(sha256(pubkey)[..16])}` - 32 hex chars. Must be identical across all SDKs.
Rust: `identity.rs:209-212`. Python: `crypto.py:158-165`.

### Canonical Signing Envelope
Signed messages use sorted-key JSON: `{nonce, payload, signer_did, timestamp}`.
Compact separators (no spaces). BTreeMap in Rust, sort_keys=True in Python.
Rust: `signing.rs:100-112`. Python: `auth.py:157-163`.

### Token Format
Base64url JSON (no padding). Contains: version, chain[], agent_did, scopes[], expires_at, agent_private_key.
Chain links match the Rust `Delegation` struct: issuer_did, delegate_did, issuer_public_key (list of 32 ints), caveats, proof.

### Scope Narrowing
Delegations can only narrow scopes, never widen. Enforced by: Rust `delegation.rs` caveat checks, Python `auth.py:94` sub-delegation validation.

## Build and Test

```bash
# Rust
cargo test --verbose              # 137+ tests
cargo build --features cli        # Build CLI
cargo build --features full       # Build CLI + server

# Python SDK
cd sdks/kanoniv-auth
pip install cryptography pytest click
pytest tests/ -v                  # 67+ tests

# TypeScript
cd js && npm install && npm test

# Cross-SDK interop
cargo build --features cli
python tests/interop/test_cross_sdk.py
```

## Conventions

- **No em dashes** in any files
- **No Co-Authored-By** in commits unless from a human collaborator
- Sort by external_id where determinism matters
- Token format must be interoperable across all SDKs - run interop tests before publishing
- Private keys are embedded in tokens to enable sub-delegation - tokens are sensitive like SSH keys

## Feature Flags (Rust)

- `default = []` - library only
- `cli` - clap CLI (kanoniv-auth binary)
- `server` - Axum delegation service + SQLite
- `full` - cli + server

## Published Packages

| Package | Registry | Version |
|---------|----------|---------|
| kanoniv-agent-auth | crates.io | Check Cargo.toml |
| kanoniv-auth | PyPI | Check sdks/kanoniv-auth/pyproject.toml |
| @kanoniv/agent-auth | npm | Check js/package.json |

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
