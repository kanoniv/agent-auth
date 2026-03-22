# How It Works

## Ed25519 Signatures

Every delegation and execution is signed with [Ed25519](https://ed25519.cr.yp.to/), the same algorithm used by SSH keys, Signal, and Bitcoin. Signatures are 64 bytes, verification is fast, and the math is well-understood.

## DID Identity

Every agent gets a decentralized identifier:

```
did:agent:b15b9019a4c8e73fa2413adc5205c474
```

This is `sha256(public_key)[..16]` encoded as hex. Deterministic, collision-resistant, and derived entirely from the public key. No registry needed.

## Delegation Chains

A delegation is a signed statement: "I grant agent X the ability to do Y, with restrictions Z."

```
Root (did:agent:aaa...)
  |
  signs: "did:agent:bbb may [build, test, deploy.staging] until 2026-03-22T22:00:00Z"
  |
  Agent B (did:agent:bbb...)
    |
    signs: "did:agent:ccc may [deploy.staging] until 2026-03-22T20:00:00Z"
    |
    Agent C (did:agent:ccc...)
```

Each link includes:
- **issuer_did** - who is granting authority
- **delegate_did** - who receives authority
- **issuer_public_key** - embedded for self-verifying chains
- **caveats** - scope restrictions, expiry
- **proof** - Ed25519 signature over the canonical envelope

## Scope Narrowing

A sub-delegation can only grant a subset of the parent's scopes. If root grants `[build, test, deploy.staging]`, a sub-delegation can grant `[deploy.staging]` but cannot add `deploy.prod`.

This is enforced by the math, not by policy. The chain verifier checks that every link's scopes are a subset of its parent's scopes.

## Token Format

Tokens are base64url-encoded JSON:

```json
{
  "version": 1,
  "chain": [
    {
      "issuer_did": "did:agent:aaa...",
      "delegate_did": "did:agent:bbb...",
      "issuer_public_key": [32 bytes as int array],
      "caveats": [
        {"type": "action_scope", "value": ["deploy.staging"]},
        {"type": "expires_at", "value": "2026-03-22T22:00:00.000Z"}
      ],
      "proof": {
        "nonce": "uuid",
        "payload": { "issuer_did": "...", "delegate_did": "...", "caveats": [...] },
        "signature": "hex-encoded Ed25519 signature",
        "signer_did": "did:agent:aaa...",
        "timestamp": "2026-03-22T18:00:00.000Z"
      }
    }
  ],
  "agent_did": "did:agent:bbb...",
  "scopes": ["deploy.staging"],
  "expires_at": 1742680800.0
}
```

Tokens are self-contained. Verification requires no network call.

## Canonical Signing

The signed envelope uses sorted-key JSON for deterministic serialization:

```json
{"nonce":"...","payload":{...},"signer_did":"...","timestamp":"..."}
```

This ensures that Rust, Python, TypeScript, and the browser (WebCrypto) all produce and verify the same signatures.

## Verification

To verify a token:

1. Decode the base64url JSON
2. Check `expires_at` against current time
3. Check requested `action` is in `scopes`
4. For each chain link:
   - Reconstruct issuer identity from `issuer_public_key`
   - Verify `issuer_public_key` produces the claimed `issuer_did`
   - Verify the Ed25519 signature on the proof
   - Check chain linkage (each issuer was the previous delegate)
5. Verify the chain terminates at the expected root authority

All of this happens locally. No server, no database, no network.
