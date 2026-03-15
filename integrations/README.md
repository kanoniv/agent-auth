# Framework Integrations

Drop-in delegation for popular agent frameworks. Each integration adds cryptographic identity and attenuated authority to an existing framework with minimal code changes.

## Available Integrations

| Framework | File | Key Class | What it adds |
|-----------|------|-----------|-------------|
| [CrewAI](https://crewai.com) | `crewai_auth.py` | `DelegatedCrewManager` | Human delegates to crew, crew sub-delegates to agents with narrower caveats |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | `langgraph_auth.py` | `@requires_delegation` | Decorator that gates graph nodes behind delegation verification |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | `openai_agents_auth.py` | `DelegatedRunner` + `@delegated_tool` | Tool-level delegation with agent-to-agent handoff and revocation |
| [AutoGen](https://github.com/microsoft/autogen) | `autogen_auth.py` | `DelegatedAgent` + `AuthorityManager` | Agents carry DIDs, sub-delegate, revocable by root authority |

## Quick Start

```bash
pip install kanoniv-agent-auth
```

### CrewAI

```python
from kanoniv_agent_auth import AgentKeyPair
from integrations.crewai_auth import DelegatedCrewManager

human = AgentKeyPair.generate()
manager = DelegatedCrewManager()
researcher = AgentKeyPair.generate()

# Human -> Crew -> Researcher
manager.delegate_to_crew(human, actions=["search", "summarize"], max_cost=10.0)
manager.delegate_to_agent(researcher.identity().did, actions=["search"], max_cost=5.0)

# Verified execution
invocation, result = manager.execute_with_proof(
    researcher, "search", {"query": "AI safety", "cost": 0.50}, human.identity()
)
```

### LangGraph

```python
from integrations.langgraph_auth import requires_delegation, DelegationContext

@requires_delegation(actions=["search"], require_cost=True)
def search_node(state):
    return {**state, "results": do_search(state["args"]["query"])}
```

### OpenAI Agents SDK

```python
from integrations.openai_agents_auth import DelegatedRunner, delegated_tool

runner = DelegatedRunner(human_keypair)

@delegated_tool(actions=["web_search"], require_cost=True)
def web_search(query, cost, **kw):
    return search(query)

runner.register_tool(web_search)
runner.authorize_agent(agent, actions=["web_search"], max_cost=5.0)
result = runner.run_tool(agent, "web_search", {"query": "AI", "cost": 0.5})
```

### AutoGen

```python
from integrations.autogen_auth import DelegatedAgent, AuthorityManager

authority = AuthorityManager(human_keypair)
researcher = DelegatedAgent("researcher", actions=["search"], max_cost=5.0)
authority.authorize(researcher)

# Sub-delegation
helper = DelegatedAgent("helper")
researcher.delegate_to(helper, actions=["search"], max_cost=2.0)
```

## Run the Demos

Each file is self-contained and runnable:

```bash
python integrations/crewai_auth.py
python integrations/langgraph_auth.py
python integrations/openai_agents_auth.py
python integrations/autogen_auth.py
```

## How It Works

All integrations follow the same pattern:

1. **Root authority** (human) creates a keypair
2. **Delegates** to framework-level manager/runner with caveats
3. **Manager sub-delegates** to individual agents with narrower scope
4. **Every action** creates an `Invocation`, verified against the delegation chain
5. **Caveats accumulate** - authority can only narrow, never widen

The framework doesn't need to know about the crypto. The integration wraps the existing API and handles proof creation/verification transparently.

## MCP Server Auth

For MCP servers (not agent frameworks), use the built-in MCP module instead:

```python
from kanoniv_agent_auth import verify_mcp_call, extract_mcp_proof

proof, clean_args = extract_mcp_proof(args_json)
if proof:
    verify_mcp_call(proof, root_identity)
```

See the [MCP Auth docs](https://kanoniv.com/docs/mcp/) for details.
