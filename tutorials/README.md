# Tutorials

## Multi-Agent Handoff with Scoped Authority

[`langgraph_multi_agent_handoff.py`](langgraph_multi_agent_handoff.py)

LangGraph agents can call tools. But tools cannot verify who the agent is, whether it is authorized, or what budget it has.

This tutorial adds cryptographic delegation to a LangGraph `StateGraph`. Each specialist node is gated by a single decorator:

```python
@requires_delegation(actions=["draft"], require_cost=True)
def draft_node(state):
    ...
```

### Delegation chain

```
Human
  |
  +-- Coordinator (max $10)
        |
        +-- Researcher (search, summarize | $5)
        +-- Writer (draft, edit | $3)
        +-- Reviewer (review | $1)
```

### What it demonstrates

- **Identity** - each agent has an Ed25519 keypair and `did:agent:` DID
- **Delegation** - authority flows Human -> Coordinator -> Specialists, narrowing at each step
- **Budget constraints** - each agent has a max cost caveat enforced cryptographically
- **Scope enforcement** - agents are blocked when acting outside their delegated actions
- **Error routing** - denied actions route to an error handler, not silent failures

### Run

```bash
pip install kanoniv-agent-auth langgraph
python tutorials/langgraph_multi_agent_handoff.py
```
