# kanoniv-agent-auth

Cryptographic identity and delegation for AI agents. The missing auth layer for MCP.

One library, three languages, byte-identical outputs.

## The Problem

MCP servers currently rely on API keys and implicit trust. Any agent can call any tool with no identity, no delegation chain, and no audit trail.

## The Solution

Agents carry **verifiable authority**. Every MCP tool call includes a cryptographic proof that the server verifies - who the agent is, what it's allowed to do, and who granted that authority. No external lookups needed.

```
Agent Framework (CrewAI, LangGraph, AutoGen, Claude, OpenAI...)
     |
     v
  MCP Tool Call + _proof (delegation chain + signature)
     |
     v
  MCP Server -> verify_mcp_call() -> execute or reject
```

## Install

```bash
# Rust
cargo add kanoniv-agent-auth

# TypeScript / JavaScript
npm install @kanoniv/agent-auth

# Python
pip install kanoniv-agent-auth
```

## MCP Server Auth (5 lines)

### TypeScript

```typescript
import { McpProof, verifyMcpCall } from "@kanoniv/agent-auth";

function handleToolCall(args: Record<string, unknown>) {
  const { proof, cleanArgs } = McpProof.extract(args);
  if (proof) {
    const result = verifyMcpCall(proof, rootIdentity);
    console.log(`Agent ${result.invoker_did} verified (depth: ${result.depth})`);
  }
  // use cleanArgs for your tool logic
}
```

### Rust

```rust
use kanoniv_agent_auth::mcp::{McpProof, verify_mcp_call};

let (proof, clean_args) = McpProof::extract(&args);
if let Some(proof) = proof {
    let result = verify_mcp_call(&proof, &root_identity)?;
    println!("Agent {} verified", result.invoker_did);
}
```

### Python

```python
from kanoniv_agent_auth import McpProof, verify_mcp_call, extract_mcp_proof

proof, clean_args = extract_mcp_proof(args_json)
if proof:
    invoker_did, root_did, chain, depth = verify_mcp_call(proof, root_identity)
    print(f"Agent {invoker_did} verified (depth: {depth})")
```

## Agent Side (attaching proofs to tool calls)

```typescript
import { generateKeyPair, createRootDelegation, McpProof } from "@kanoniv/agent-auth";

// Human grants agent authority: resolve only, max $5 cost
const root = generateKeyPair();
const agent = generateKeyPair();
const delegation = createRootDelegation(root, agent.identity.did, [
  { type: "action_scope", value: ["resolve", "search"] },
  { type: "max_cost", value: 5.0 },
]);

// Agent creates proof for each tool call
const proof = McpProof.create(agent, "resolve", { source: "crm" }, delegation);
const args = McpProof.inject(proof, { source: "crm", external_id: "123" });
// Send args to MCP server - _proof field is verified automatically
```

## Delegation Chains

Authority flows from root to agent to sub-agent, narrowing at each step:

```
Root (Human)
  |-- delegates to Manager: [resolve, search, merge]
      |-- delegates to Worker: [resolve] (narrower)
          |-- calls MCP tool with proof
              |-- server verifies entire chain back to root
```

Caveats accumulate - you can only narrow authority, never widen it.

### Caveat Types

| Caveat | Description |
|--------|-------------|
| `action_scope` | Allowed actions (e.g. `["resolve", "search"]`) |
| `expires_at` | RFC 3339 expiry timestamp |
| `max_cost` | Cost ceiling for the operation |
| `resource` | Resource glob pattern (e.g. `"entity:customer:*"`) |
| `context` | Key/value context match (e.g. `session_id`) |
| `custom` | Arbitrary key/value constraint |

## Auth Modes

MCP servers can choose their enforcement level:

| Mode | Behavior |
|------|----------|
| `required` | Reject calls without valid proof |
| `optional` | Verify if present, allow unauthenticated |
| `disabled` | Skip verification |

```typescript
import { verifyMcpToolCall } from "@kanoniv/agent-auth";

const outcome = verifyMcpToolCall("resolve", args, rootIdentity, "required");
// outcome.verified: VerificationResult | null
// outcome.args: cleaned args (no _proof)
```

## What's Inside

| Primitive | Description |
|-----------|-------------|
| `AgentKeyPair` | Ed25519 keypair generation and persistence |
| `AgentIdentity` | `did:agent:` DID derivation and W3C DID Documents |
| `SignedMessage` | Canonical JSON signing with nonce and timestamp |
| `Delegation` | Attenuated authority with 6 caveat types |
| `Invocation` | Exercise delegated authority with proof |
| `McpProof` | Self-contained proof for MCP transport |
| `ProvenanceEntry` | Signed audit trail with DAG chaining |

## DID Format

```
did:agent:{hex(sha256(public_key)[..16])}
```

32-character hex identifier derived from the SHA-256 hash of the Ed25519 public key. W3C DID method registration pending (PR #681).

## Framework Integrations

Drop-in delegation for popular agent frameworks. Each integration wraps the existing framework API - the framework doesn't need to know about the crypto.

| Framework | Integration | Pattern |
|-----------|------------|---------|
| [CrewAI](https://crewai.com) | `integrations/crewai_auth.py` | `DelegatedCrewManager` manages delegation chains for crews |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | `integrations/langgraph_auth.py` | `@requires_delegation` decorator gates graph nodes |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | `integrations/openai_agents_auth.py` | `DelegatedRunner` + `@delegated_tool` with handoff and revocation |
| [AutoGen](https://github.com/microsoft/autogen) | `integrations/autogen_auth.py` | `DelegatedAgent` + `AuthorityManager` with sub-delegation |

See [integrations/README.md](integrations/README.md) for usage examples.

## Cross-Language Interop

All three implementations produce byte-identical:
- DIDs from the same public key
- Canonical JSON for signing
- Content hashes for chaining
- MCP proofs (hex-encoded public keys, deterministic JSON)

The `fixtures/` directory contains test vectors generated from a known secret key. Every implementation is tested against these fixtures.

## Specification

See [spec/AGENT-IDENTITY.md](spec/AGENT-IDENTITY.md) for the formal specification.

## License

MIT
