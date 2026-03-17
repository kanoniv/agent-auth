# Introducing agent-auth: Cryptographic Identity and Delegation for AI Agents

**We submitted `did:agent:` to the W3C DID registry and proposed a delegation proof mechanism to the MCP specification. Here's why, and what we built.**

---

## The problem nobody's fixing

A recent audit of 30 AI agent projects found that **93% use unscoped API keys** with no per-agent identity, no consent, and no revocation. OWASP confirmed this in December 2025 when they published their Top 10 for Agentic Applications — ranking Identity & Privilege Abuse (ASI03) as a top risk.

The root cause is simple: **MCP has no delegation model.**

When a human grants an agent access to tools via MCP, that agent gets full access. It can't prove who it is. It can't prove what it's allowed to do. It can't sub-delegate to another agent with narrower permissions. And MCP servers can't verify any of this even if it existed.

Every agent framework — CrewAI, LangGraph, AutoGen, OpenAI Agents SDK — has the same gap. Child agents either inherit the parent's full credentials or get independent API keys. No scope narrowing. No depth limits. No cascade revocation. No audit trail linking actions back to a human grant.

## What we did

We built the missing layer and submitted it to the standards bodies that matter:

**1. `did:agent:` — submitted to W3C DID Spec Registry**

A new DID method purpose-built for AI agents. Self-issued Ed25519 keys, no ledger or registry required. An agent generates a keypair and derives a deterministic DID:

```
did:agent:21fe31dfa154a261626bf854046fd227
```

That's it. No enrollment, no external dependency, no phone-home. The DID is the SHA-256 hash of the public key, truncated to 128 bits. It's verifiable by anyone with the public key.

**2. MCP delegation proofs — proposed to the MCP specification**

A `_proof` field that agents attach to every MCP tool call. The proof contains the full delegation chain — who the agent is, what it's allowed to do, who granted that authority, and every signature in between. MCP servers verify locally with no external lookups.

```
Agent Framework (CrewAI, LangGraph, AutoGen, Claude, OpenAI...)
     |
     v
  MCP Tool Call + _proof (delegation chain + signatures)
     |
     v
  MCP Server -> verify_mcp_call() -> execute or reject
```

**3. `kanoniv-agent-auth` — the reference implementation, shipping today**

Open source (MIT), available in Rust, TypeScript, and Python. All three produce byte-identical outputs for the same inputs — verified through shared cross-language test fixtures.

## How it works

### MCP server side: 5 lines

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

### Agent side: attach proofs to tool calls

```typescript
import { generateKeyPair, createRootDelegation, McpProof } from "@kanoniv/agent-auth";

// Human grants agent scoped authority
const root = generateKeyPair();
const agent = generateKeyPair();
const delegation = createRootDelegation(root, agent.identity.did, [
  { type: "action_scope", value: ["resolve", "search"] },
  { type: "max_cost", value: 5.0 },
]);

// Agent creates proof for each tool call
const proof = McpProof.create(agent, "resolve", { source: "crm" }, delegation);
const args = McpProof.inject(proof, { source: "crm", external_id: "123" });
// _proof field is verified by the MCP server automatically
```

### Delegation chains: authority only narrows

```
Root (Human)
  |-- delegates to Manager: [resolve, search, merge], max_cost=$100
      |-- delegates to Worker: [resolve], max_cost=$50
          |-- calls MCP tool with proof
              |-- server verifies entire chain back to root
```

Caveats accumulate at each delegation step. A sub-agent can never have more authority than its parent. Six caveat types ship today: `action_scope`, `expires_at`, `max_cost`, `resource` (glob patterns), `context` (key/value match), and `custom`.

## Framework integrations

Drop-in delegation for four major agent frameworks, each wrapping the existing framework API. The framework doesn't need to know about the crypto:

| Framework | Pattern |
|-----------|---------|
| CrewAI | `DelegatedCrewManager` manages delegation chains for crews |
| LangGraph | `@requires_delegation` decorator gates graph nodes |
| OpenAI Agents SDK | `DelegatedRunner` + `@delegated_tool` with handoff support |
| AutoGen | `DelegatedAgent` + `AuthorityManager` with sub-delegation |

## Design decisions

**Self-contained proofs.** Every `_proof` includes the full delegation chain with embedded public keys. Verification requires zero external lookups — no key server, no registry, no network call. This matters for agents operating across organizational boundaries.

**Macaroon-style attenuation.** Inspired by Google's Macaroons research, but using Ed25519 public-key signatures instead of HMAC. This gives you offline verification without needing to contact the issuing service.

**Cross-language by design.** The Rust core, TypeScript implementation, and Python bindings all produce byte-identical DIDs, signatures, content hashes, and MCP proofs from the same inputs. A delegation created in Python is verifiable in Rust. The `fixtures/` directory is the source of truth.

**Max chain depth of 32.** DoS protection. In practice, delegation chains rarely exceed 3-4 levels.

## What this is not

This is not a replacement for OAuth. If your MCP server already authenticates human users via OAuth 2.1, that's great — agent-auth adds the layer below that: which *agent* is acting, with what *scope*, granted by *whom*.

This is not a blockchain. DIDs are self-issued from Ed25519 keypairs. No ledger, no gas fees, no consensus mechanism.

This is not theoretical. The library is published, the spec is formal, and the proposals are submitted.

## Install

```bash
# Rust
cargo add kanoniv-agent-auth

# TypeScript / JavaScript
npm install @kanoniv/agent-auth

# Python
pip install kanoniv-agent-auth
```

## Links

- **GitHub**: [github.com/kanoniv/agent-auth](https://github.com/kanoniv/agent-auth)
- **Specification**: [spec/AGENT-IDENTITY.md](https://github.com/kanoniv/agent-auth/blob/main/spec/AGENT-IDENTITY.md)
- **MCP server example**: [examples/mcp-server-auth/](https://github.com/kanoniv/agent-auth/tree/main/examples/mcp-server-auth)
- **Framework integrations**: [integrations/](https://github.com/kanoniv/agent-auth/tree/main/integrations)
- **License**: MIT

---

*We believe the agentic web needs authentication that's as composable as the agents themselves. If you're building agents, MCP servers, or frameworks — we'd love your feedback.*
