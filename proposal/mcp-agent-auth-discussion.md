# Proposal: Agent Identity and Delegation for MCP Tool Calls

## Problem

MCP has a robust authorization spec for the human-to-server relationship: OAuth 2.1 handles "which human authorized this client to access this server." This works well for the HTTP transport.

But there is no standard mechanism for **agent-to-agent authorization** in tool calls. When Agent A delegates a task to Agent B, and Agent B calls an MCP tool, the server has no way to answer:

- **Who is this agent?** (not the human - the specific agent instance)
- **What is it authorized to do?** (which tools, what cost limits, what resources)
- **Who granted that authority?** (the delegation chain back to a human or root)

This gap is especially acute for:

1. **stdio transport** - The auth spec explicitly says stdio should "retrieve credentials from the environment." There is no per-call authorization.
2. **Multi-agent systems** - When agents delegate to sub-agents (CrewAI crews, LangGraph subgraphs, AutoGen teams), the sub-agent's authority should be verifiable and narrower than its parent's.
3. **Tool approval propagation** - Discussion [#1203](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1203) describes nested agents needing approval from the original user. A delegation chain solves this - the proof carries the approval.

Today, MCP servers must fall back to API keys, environment variables, or custom headers. None of these support delegation, attenuation, or cryptographic verification.

## Proposed Extension

Add an optional `auth` field to `params._meta` on `tools/call` requests:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_contacts",
    "arguments": {
      "query": "Alice Smith"
    },
    "_meta": {
      "auth": {
        "type": "delegation-proof",
        "version": "1",
        "invoker_did": "did:agent:4a1b2c3d...",
        "invoker_public_key": "a1b2c3d4e5f6...",
        "proof": "<base64-encoded invocation proof>"
      }
    }
  }
}
```

**Design principles:**

- **Optional** - Clients may omit `_meta.auth`. Servers choose whether to require, accept, or ignore it.
- **Transport-agnostic** - Works on stdio, HTTP, and SSE because the proof travels with the message.
- **Self-contained** - The proof includes the full delegation chain. No external lookups needed. The server verifies using only the data in the proof and its own root public key.
- **Complementary to OAuth** - OAuth handles human-to-server auth. This handles agent-to-agent delegation. They work together.
- **Backward compatible** - `_meta` is already part of the spec. Servers that don't understand `auth` ignore it. Clients that don't support it send calls without it.

## How It Works

### Setup (one-time)

A human or organization creates a root authority (Ed25519 keypair) and delegates to agents with constraints:

```
Root Authority (Human)
  |
  +-- delegates to Manager Agent: [search, resolve, merge], expires 2026-04-01
      |
      +-- delegates to Worker Agent: [search, resolve], max_cost: $5
          |
          +-- calls MCP tool with proof
```

Each delegation is signed by the issuer. Caveats (action scope, expiry, cost limits, resource patterns) accumulate and can only narrow - never widen.

### Per-call flow

1. Agent creates an invocation proof containing: the action, the arguments, and the delegation chain
2. Agent signs the proof with its Ed25519 key
3. Client attaches the proof to `params._meta.auth`
4. Server extracts the proof, verifies every signature in the chain back to the root, checks all caveats, and executes or rejects

### Server verification (5 lines)

TypeScript:
```typescript
import { verifyMcpCall, McpProof } from "@kanoniv/agent-auth";

const { proof, cleanArgs } = McpProof.extract(args);
if (proof) {
  const result = verifyMcpCall(proof, rootIdentity);
  // result.invoker_did, result.chain, result.depth
}
```

Python:
```python
from kanoniv_agent_auth import verify_mcp_call, extract_mcp_proof

proof, clean_args = extract_mcp_proof(args_json)
if proof:
    invoker_did, root_did, chain, depth = verify_mcp_call(proof, root_identity)
```

Rust:
```rust
use kanoniv_agent_auth::mcp::{McpProof, verify_mcp_call};

let (proof, clean_args) = McpProof::extract(&args);
if let Some(proof) = proof {
    let result = verify_mcp_call(&proof, &root_identity)?;
}
```

## Caveat Types

Delegation proofs support constraints that are checked at verification time:

| Caveat | Example | Description |
|--------|---------|-------------|
| `action_scope` | `["search", "resolve"]` | Restrict to specific tool names |
| `expires_at` | `"2026-04-01T00:00:00Z"` | Time-limited delegation |
| `max_cost` | `5.0` | Cost ceiling per invocation |
| `resource` | `"entity:customer:*"` | Glob pattern on resource |
| `context` | `{"session_id": "abc"}` | Must match specific context |
| `custom` | `{"org": "acme"}` | Arbitrary key/value |

Caveats accumulate through the chain. A sub-agent inherits all parent caveats plus any additional restrictions. This means delegation can only narrow authority, never widen it.

## Security Properties

- **Cryptographic identity** - Agents have Ed25519 keypairs and `did:agent:` identifiers. No central registry required.
- **Tamper-proof** - Caveats are extracted from signed payloads, not outer fields. Modifying caveats after signing breaks verification.
- **Chain depth limit** - Maximum 32 delegations to prevent DoS via deeply nested chains.
- **Revocation hook** - Verification accepts a callback `is_revoked(delegation_hash) -> bool`. Implementations can plug in any revocation backend.
- **No trust in intermediaries** - Every signature in the chain is independently verified. A compromised intermediate agent cannot forge its parent's authority.
- **Fail-closed** - Missing required fields (e.g., `cost` when `max_cost` caveat is present) result in rejection, not silent bypass.

## What This Does NOT Do

- **Replace OAuth** - OAuth handles the human-to-server relationship. This handles agent-to-agent delegation. Use both.
- **Mandate a specific DID method** - The reference implementation uses `did:agent:` but the proof format is DID-method-agnostic.
- **Require server changes to MCP core** - This uses the existing `_meta` field. No protocol-level changes needed.
- **Force servers to verify** - Auth is optional. Servers choose their enforcement level (required, optional, or disabled).

## Reference Implementation

An MIT-licensed library implementing this proposal is available in three languages:

- **Rust**: [kanoniv-agent-auth](https://crates.io/crates/kanoniv-agent-auth) (v0.2.0, 137 tests)
- **TypeScript**: [@kanoniv/agent-auth](https://www.npmjs.com/package/@kanoniv/agent-auth) (v0.2.0, 80 tests)
- **Python**: [kanoniv-agent-auth](https://pypi.org/project/kanoniv-agent-auth/) (v0.2.0, 48 tests)

All three produce byte-identical proofs and can cross-verify (sign in Python, verify in Rust).

Source: [github.com/kanoniv/agent-auth](https://github.com/kanoniv/agent-auth)

## Related Discussions

- [#64 - Authentication](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/64) - Original auth discussion; mentions DIDs and cryptographic proofs
- [#804 - Gateway-Based Authorization Model](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/804) - JWT assertions for identity propagation (18 upvotes)
- [#1203 - Tool Approval Propagation](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1203) - Nested agent approval chains (unanswered)
- [#234 - Multi-user Authorization](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/234) - Multi-tenant auth patterns
- [#1228 - Extra fixed parameters](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/1228) - Passing client context to servers without LLM involvement
