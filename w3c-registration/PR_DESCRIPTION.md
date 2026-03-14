### DID Method Registration

As a DID method registrant, I have ensured that my DID method registration complies with the following statements:

- [x] The DID Method specification [defines the DID Method Syntax](https://w3c.github.io/did-core/#method-syntax).
- [x] The DID Method specification [defines the Create, Read, Update, and Deactivate DID Method Operations](https://w3c.github.io/did-core/#method-operations).
- [x] The DID Method specification [contains a Security Considerations section](https://w3c.github.io/did-core/#security-requirements).
- [x] The DID Method specification [contains a Privacy Considerations section](https://w3c.github.io/did-core/#privacy-requirements).
- [x] The JSON file I am submitting has [passed all automated validation tests below](#partial-pull-merging).
- [ ] The JSON file contains a `contactEmail` address [OPTIONAL].
- [x] The JSON file contains a `verifiableDataRegistry` entry [OPTIONAL].

## Summary

This PR registers the `did:agent:` DID method for AI agent identity and delegation.

**Method:** `did:agent:<identifier>` where identifier is `hex(sha256(ed25519_public_key)[0..16])`

**Key properties:**
- Self-issued Ed25519 keys (no ledger, no registry)
- Multibase-encoded public keys (`publicKeyMultibase` per Ed25519VerificationKey2020)
- Designed for AI agent-to-agent authentication, signed message envelopes, and cryptographic delegation with attenuated capabilities
- Three implementations (Rust, TypeScript, Python) with cross-language interoperability verified via shared test fixtures

**Specification:** https://github.com/kanoniv/agent-auth/blob/main/spec/AGENT-IDENTITY.md

**Repository:** https://github.com/kanoniv/agent-auth (MIT licensed)
