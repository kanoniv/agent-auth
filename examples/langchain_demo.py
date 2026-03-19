"""
Agent Trust - LangChain ReAct Agent Demo

A ReAct agent that manages AI agents through the Agent Trust system.
LangChain tools wrap Agent Trust operations: register, delegate, observe,
select, and recall - all backed by Ed25519 identity and signed provenance.

Setup:
    pip install langchain langchain-anthropic agent-trust
    export ANTHROPIC_API_KEY=sk-ant-...
    docker compose up -d  # agent-trust API on :4100
    python examples/langchain_demo.py
"""

import os
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from agent_trust import TrustAgent

trust = TrustAgent(db_path=":memory:")

# -- LangChain tools wrapping Agent Trust operations -----------------------

@tool
def register_agent_tool(name: str, capabilities: str, description: str) -> str:
    """Register a new agent with verified Ed25519 identity.
    Args:
        name: Unique agent name (e.g. "researcher")
        capabilities: Comma-separated capabilities (e.g. "search,analyze")
        description: What this agent does
    """
    caps = [c.strip() for c in capabilities.split(",")]
    record = trust.register(name, capabilities=caps, description=description)
    return f"Registered '{name}' with DID {record.did}. Capabilities: {caps}"

@tool
def delegate_tool(agent: str, scopes: str) -> str:
    """Grant scoped delegation to an agent. Cryptographic, not advisory.
    Args:
        agent: Agent name to delegate to
        scopes: Comma-separated scopes (must be subset of capabilities)
    """
    scope_list = [s.strip() for s in scopes.split(",")]
    trust.delegate(agent, scopes=scope_list)
    return f"Delegated {scope_list} to '{agent}'. Signed by TrustAgent."

@tool
def observe_tool(agent: str, action: str, result: str, reward: float, content: str) -> str:
    """Record an observed outcome for an agent's action.
    Args:
        agent: Agent that performed the action
        action: What the agent did (e.g. "search", "draft")
        result: "success", "failure", or "partial"
        reward: Quality signal from -1.0 (terrible) to 1.0 (excellent)
        content: Brief description of what happened
    """
    trust.observe(agent, action=action, result=result, reward=reward, content=content)
    return f"Recorded outcome for '{agent}': {result} (reward={reward}). Signed provenance."

@tool
def select_agent_tool(agents: str, strategy: str = "ucb") -> str:
    """Select the best agent from a list based on verified reputation.
    Uses UCB (explore/exploit balance) by default.
    Args:
        agents: Comma-separated agent names to choose from
        strategy: "ucb" or "greedy"
    """
    agent_list = [a.strip() for a in agents.split(",")]
    best = trust.select(agent_list, strategy=strategy)
    ranking = trust.rank(agent_list, strategy=strategy)
    lines = [f"Selected: {best} (strategy={strategy})", "Full ranking:"]
    for i, name in enumerate(ranking, 1):
        rep = trust.reputation(name)
        lines.append(
            f"  {i}. {name} - score={rep.score:.0f}/100, "
            f"success_rate={rep.success_rate or 0:.0%}, trend={rep.trend}"
        )
    return "\n".join(lines)

@tool
def recall_tool(agent: str) -> str:
    """Get an agent's RL context - learning history from verified outcomes.
    Returns strengths, weaknesses, trend, and guidance for prompt injection.
    Args:
        agent: Agent name to recall context for
    """
    ctx = trust.recall(agent)
    return (
        f"RL Context for '{agent}': {ctx.total_outcomes} outcomes, "
        f"success_rate={ctx.success_rate or 0:.0%}, avg_reward={ctx.avg_reward or 0:.2f}, "
        f"trend={ctx.trend}, strengths={ctx.strengths or 'none yet'}, "
        f"weaknesses={ctx.weaknesses or 'none yet'}. {ctx.guidance}"
    )

# -- ReAct agent -----------------------------------------------------------

SYSTEM_PROMPT = """\
You are a trust orchestrator managing a team of AI agents via the Agent Trust system.
Every action is cryptographically signed (Ed25519) and anchored to a DID.
Reputation is computed from signed provenance, not self-reported metrics.

Workflow: register agents -> grant delegations -> record outcomes -> select/recall.
Rewards: 0.7-1.0 for good work, 0.3-0.6 for mediocre, -1.0 to 0.2 for poor work."""

TOOLS = [register_agent_tool, delegate_tool, observe_tool, select_agent_tool, recall_tool]

SCENARIO = (
    "Register a research team with three agents: a researcher (search, analyze), "
    "a writer (draft, edit), and a reviewer (review, verify). "
    "Delegate appropriate scopes to each.\n\n"
    "Then simulate some work history:\n"
    "- The researcher did 3 searches: two excellent (0.9), one good (0.7)\n"
    "- The writer drafted twice: one was great (0.85), one was poor (0.2)\n"
    "- The reviewer verified once: solid work (0.75)\n\n"
    "Record all those outcomes. Then check each agent's RL context, "
    "select the most reliable agent overall, and explain your trust reasoning."
)

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("Set ANTHROPIC_API_KEY to run with a real LLM.")
        print("Running the deterministic demo path instead.\n")
        run_deterministic_demo()
        return

    llm = ChatAnthropic(
        model="claude-haiku-4-5-20251001", api_key=api_key,
        max_tokens=2048, temperature=0.2,
    )
    agent = create_react_agent(llm, TOOLS, prompt=SYSTEM_PROMPT)

    print("=== LangChain ReAct Agent with Agent Trust ===\n")
    print(f"Scenario: {SCENARIO}\n")
    print("-" * 60)

    result = agent.invoke({"messages": [("human", SCENARIO)]})
    for msg in result["messages"]:
        if hasattr(msg, "content") and msg.content and msg.type == "ai":
            if not hasattr(msg, "tool_calls") or not msg.tool_calls:
                print(f"\n{'=' * 60}")
                print("Agent's conclusion:")
                print(msg.content)

def run_deterministic_demo():
    """Exercise all tools without an LLM."""
    print("=== Deterministic LangChain Tool Demo ===\n")

    # Register agents
    for name, caps, desc in [
        ("researcher", "search,analyze", "Research agent"),
        ("writer", "draft,edit", "Writing agent"),
        ("reviewer", "review,verify", "Review agent"),
    ]:
        print(register_agent_tool.invoke(
            {"name": name, "capabilities": caps, "description": desc}
        ))

    # Delegate
    print()
    for name, scopes in [("researcher", "search,analyze"), ("writer", "draft,edit"), ("reviewer", "review,verify")]:
        print(delegate_tool.invoke({"agent": name, "scopes": scopes}))

    # Record outcomes
    print()
    for agent, action, result, reward, content in [
        ("researcher", "search", "success", 0.9, "Found comprehensive competitor analysis"),
        ("researcher", "search", "success", 0.9, "Excellent literature review"),
        ("researcher", "analyze", "success", 0.7, "Good analysis, minor gaps"),
        ("writer", "draft", "success", 0.85, "Well-structured blog post"),
        ("writer", "draft", "failure", 0.2, "Missed key requirements, incomplete"),
        ("reviewer", "review", "success", 0.75, "Thorough review with actionable feedback"),
    ]:
        print(observe_tool.invoke({
            "agent": agent, "action": action, "result": result,
            "reward": reward, "content": content,
        }))

    # Recall RL context
    print()
    for name in ["researcher", "writer", "reviewer"]:
        print(recall_tool.invoke({"agent": name}))

    # Select best agent
    print()
    print(select_agent_tool.invoke({"agents": "researcher,writer,reviewer", "strategy": "ucb"}))
    print("\nDone. Every operation was signed with Ed25519 and anchored to a DID.")

if __name__ == "__main__":
    main()
