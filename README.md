# kanoniv-agent-auth

Cryptographic identity and delegation for AI agents.

Agents carry verifiable authority - who they are, what they're allowed to do, and who granted it. Every action is signed. Every delegation narrows. Every decision is auditable.

```bash
cargo add kanoniv-agent-auth    # Rust
npm install @kanoniv/agent-auth # TypeScript
pip install kanoniv-agent-auth  # Python
```

## MCP Server Auth (5 lines)

Agents carry self-contained proofs. No auth server, no network calls.

```typescript
import { McpProof, verifyMcpCall } from "@kanoniv/agent-auth";

function handleToolCall(args: Record<string, unknown>) {
  const { proof, cleanArgs } = McpProof.extract(args);
  if (proof) {
    const result = verifyMcpCall(proof, rootIdentity);
    console.log(`Agent ${result.invoker_did} verified (depth: ${result.depth})`);
  }
}
```

```rust
use kanoniv_agent_auth::mcp::{McpProof, verify_mcp_call};

let (proof, clean_args) = McpProof::extract(&args);
if let Some(proof) = proof {
    let result = verify_mcp_call(&proof, &root_identity)?;
    println!("Agent {} verified", result.invoker_did);
}
```

```python
from kanoniv_agent_auth import McpProof, verify_mcp_call, extract_mcp_proof

proof, clean_args = extract_mcp_proof(args_json)
if proof:
    invoker_did, root_did, chain, depth = verify_mcp_call(proof, root_identity)
    print(f"Agent {invoker_did} verified (depth: {depth})")
```

## Agent Side (attaching proofs)

```typescript
import { generateKeyPair, createRootDelegation, McpProof } from "@kanoniv/agent-auth";

const root = generateKeyPair();
const agent = generateKeyPair();
const delegation = createRootDelegation(root, agent.identity.did, [
  { type: "action_scope", value: ["resolve", "search"] },
  { type: "max_cost", value: 5.0 },
]);

// Agent creates proof for each tool call
const proof = McpProof.create(agent, "resolve", { source: "crm" }, delegation);
const args = McpProof.inject(proof, { source: "crm", external_id: "123" });
// _proof field is verified server-side
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

Caveats accumulate - you can only narrow, never widen.

| Caveat | Description |
|--------|-------------|
| `action_scope` | Allowed actions (e.g. `["resolve", "search"]`) |
| `expires_at` | RFC 3339 expiry timestamp |
| `max_cost` | Cost ceiling for the operation |
| `resource` | Resource glob pattern (e.g. `"entity:customer:*"`) |
| `context` | Key/value context match (e.g. `session_id`) |
| `custom` | Arbitrary key/value constraint |

## Provenance

Every action produces a signed `ProvenanceEntry` linked into a DAG. Each entry references the previous entry's hash, forming a tamper-evident chain.

```python
from kanoniv_agent_auth import sign_provenance_entry

entry = sign_provenance_entry(
    agent_keypair,
    action="search",
    inputs={"query": "customer records"},
    outputs={"results": 47},
    parent_hash="abc123..."  # links to previous entry
)
# entry.signature is Ed25519 over canonical JSON
# entry.hash chains into the next entry
```

Any verifier can walk the chain and recompute every hash independently. Provenance is auditable, not declared.

## Cross-Engine Interop

Three independent agent identity systems have cross-verified Ed25519 delegation chains on this repo:

| Engine | DID Method | Trust Signal |
|--------|-----------|-------------|
| **Kanoniv** | `did:key` | Outcome-based reputation (provenance-derived) |
| **Agent Passport System** | `did:aps` | Structural authorization (spend budget, chain depth) |
| **Agent Intent Protocol** | `did:aip` | Behavioral trust (PDR, vouch chains) |

Full 3x3 verification matrix - every engine verified every other engine's delegation chains. Different DID methods, different encodings, different canonical forms. Same verification result.

**Round X** (in progress): Decision artifact verification - testing whether independent engines arrive at the same permit/deny decisions from different trust inputs.

See the [full verification thread](https://github.com/kanoniv/agent-auth/issues/2) and [cross-engine spec](spec/CROSS-ENGINE-VERIFICATION.md).

## Trust Agent (high-level Python SDK)

For agent selection, reputation tracking, and in-context RL on top of the crypto primitives:

```bash
pip install kanoniv-trust
```

```python
from agent_trust import TrustAgent

trust = TrustAgent()  # SQLite, zero infra

# Each agent gets an Ed25519 key pair and DID
trust.register("researcher", capabilities=["search", "analyze"])
trust.register("writer", capabilities=["draft", "edit", "publish"])

# Scoped delegation - cryptographic, not advisory
trust.delegate("researcher", scopes=["search", "analyze"])

# Every action is signed with the agent's keys
trust.observe("researcher", action="search", result="success", reward=0.9)
trust.observe("writer", action="draft", result="failure", reward=-0.5)

# UCB picks the proven agent based on verified outcomes
best = trust.select(["researcher", "writer"])  # -> "researcher"

# Reputation computed from signed provenance, not self-reported
rep = trust.reputation("researcher")
rep.score            # 72.5/100 composite
rep.success_rate     # 0.87
rep.verified_actions # 8 (all signed with Ed25519)
```

## What's Inside

| Primitive | Description |
|-----------|-------------|
| `AgentKeyPair` | Ed25519 keypair generation and persistence |
| `AgentIdentity` | DID derivation and W3C DID Documents |
| `SignedMessage` | Canonical JSON signing with nonce and timestamp |
| `Delegation` | Attenuated authority with 6 caveat types |
| `Invocation` | Exercise delegated authority with proof |
| `McpProof` | Self-contained proof for MCP transport |
| `ProvenanceEntry` | Signed audit trail with DAG chaining |

All three implementations produce byte-identical DIDs, canonical JSON, content hashes, and MCP proofs. Test vectors in `fixtures/`.

## Auth Modes

MCP servers choose their enforcement level:

| Mode | Behavior |
|------|----------|
| `required` | Reject calls without valid proof |
| `optional` | Verify if present, allow unauthenticated |
| `disabled` | Skip verification |

## Framework Integrations

| Framework | Integration | Pattern |
|-----------|------------|---------|
| [CrewAI](https://crewai.com) | `integrations/crewai_auth.py` | `DelegatedCrewManager` manages delegation chains for crews |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | `integrations/langgraph_auth.py` | `@requires_delegation` decorator gates graph nodes |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | `integrations/openai_agents_auth.py` | `DelegatedRunner` + `@delegated_tool` with handoff and revocation |
| [AutoGen](https://github.com/microsoft/autogen) | `integrations/autogen_auth.py` | `DelegatedAgent` + `AuthorityManager` with sub-delegation |

## Observatory

Visual dashboard for agent trust state. Agents, trust graph, delegation management, provenance timeline, and cross-engine interop verification with live Ed25519 in the browser.

```bash
docker compose up
# Open http://localhost:4173
```

Live instance: [trust.kanoniv.com](https://trust.kanoniv.com)

## Specifications

- [Agent Identity](spec/AGENT-IDENTITY.md) - Ed25519 keys, DID derivation, signed envelopes, provenance DAGs
- [Cross-Engine Verification](spec/CROSS-ENGINE-VERIFICATION.md) - Interop protocol, canonical forms, decision artifacts

## License

MIT
