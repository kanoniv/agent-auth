# agent-trust

Add one agent that controls every other agent. An autonomous agent that verifies, scores, and enforces what other agents are allowed to do - using cryptographic proof.

**Langfuse can tell you an agent failed. Agent Trust can prove it failed and revoke its permissions before it fails again.**

```
pip install kanoniv-trust
```

## Quick Start

```python
from agent_trust import TrustAgent

trust = TrustAgent()  # SQLite, zero infra

# Register agents with verified identity (Ed25519 DIDs)
trust.register("researcher", capabilities=["search"])
trust.register("writer", capabilities=["write"])

# Grant scoped delegation - cryptographic, not advisory
trust.delegate("researcher", scopes=["search", "analyze"])
trust.delegate("writer", scopes=["write", "summarize"])

# Observe outcomes - creates signed provenance
trust.observe("researcher", action="search", result="success", reward=0.9)
trust.observe("writer", action="write", result="failure", reward=-0.5)

# Select best agent - UCB exploration, verified reputation
best = trust.select(["researcher", "writer"])  # -> "researcher"

# Enforce - real authority, not a recommendation
trust.restrict("writer", scopes=["summarize"])  # limit permissions
trust.revoke("writer")                           # revoke all access

# Reputation from verified, signed outcomes - not self-reported metrics
trust.reputation("writer")
# -> ReputationReport(score=18, success_rate=0.0, trend="declining", current_scopes=[])
```

## CrewAI Integration

```python
from crewai import Agent, Crew, Process
from agent_trust.integrations.crewai import TrustManager

# Create agents
researcher = Agent(role="Researcher", goal="Find information", backstory="Expert researcher")
writer = Agent(role="Writer", goal="Write content", backstory="Expert writer")

# Trust-based manager replaces hardcoded delegation
manager = TrustManager()
manager.register_crew([researcher, writer])

crew = Crew(
    agents=[researcher, writer],
    tasks=[...],
    process=Process.hierarchical,
    manager_agent=manager.as_agent(),
    task_callback=manager.task_callback,  # auto-records outcomes
)

# Before: allowed_agents=["researcher", "writer"]  -> random/first-match
# After:  trust.select(["researcher", "writer"])    -> earned reputation
```

## How It Works

```
Agents produce actions
       |
Protocol verifies actions (signed provenance, DIDs, delegation)
       |
TrustAgent interprets + enforces (reputation, UCB, restrict/revoke)
```

Every trust decision rests on cryptographic verification:

- **Identity**: Each agent gets an Ed25519 key pair and a `did:key` identifier
- **Provenance**: Every action is signed. Tamper-proof audit trail.
- **Delegation**: Scoped permissions that can be restricted or revoked in real time
- **Reputation**: Computed from verified, signed outcomes - not self-reported metrics or LLM judgment
- **Selection**: UCB (Upper Confidence Bound) balances exploiting proven agents with exploring under-tested ones

## API Reference

### `TrustAgent(db_path=None, url=None, private_key=None)`

Create a trust orchestrator. It has its own DID and signing keys.

- `TrustAgent()` - SQLite at `~/.agent-trust/trust.db`
- `TrustAgent(db_path=":memory:")` - in-memory (testing)
- `TrustAgent(url="http://...")` - hosted backend (shared reputation)
- `TrustAgent(private_key="base64...")` - persistent identity across restarts

### Methods

| Method | Description |
|--------|-------------|
| `register(name, capabilities)` | Register an agent with verified identity |
| `delegate(agent, scopes)` | Grant scoped delegation (signed) |
| `observe(agent, action, result, reward)` | Record outcome with signed provenance |
| `select(agents, strategy="ucb")` | Select best agent from verified reputation |
| `rank(agents, strategy="ucb")` | Rank agents by reputation (best first) |
| `reputation(agent)` | Get full reputation report |
| `restrict(agent, scopes)` | Limit an agent's permissions |
| `revoke(agent)` | Revoke all delegation |

### Selection Strategies

- **`ucb`** (default) - Upper Confidence Bound. Balances exploiting known-good agents with exploring under-tested ones. Mathematically principled.
- **`greedy`** - Always picks the highest avg reward. No exploration. Can get stuck.

## What Makes This Different

|  | Langfuse | AgentOps | CrewAI | Agent Trust |
|--|---------|---------|--------|-------------|
| Agent Identity (DIDs) | No | No | No | Yes |
| Signed Provenance | No | No | No | Yes |
| Scoped Delegation | No | No | Hardcoded | Cryptographic |
| Reputation Scoring | No | No | No | Yes |
| RL / Adaptive Routing | No | No | No | UCB |
| Enforcement (restrict/revoke) | No | No | No | Yes |

## Hosted Backend

Local SQLite is great for development. For shared reputation across teams and systems:

```python
trust = TrustAgent(url="http://your-agent-trust-api:4100")
```

Same API, shared persistence. An agent's reputation follows it across systems.

```
pip install kanoniv-trust[hosted]  # adds httpx
```

## License

MIT
