"""
LangChain integration for agent-trust.

Provides tools and callbacks that wire trust into any LangChain agent.
Drop-in: add TrustTools to your agent's toolset, add TrustCallbackHandler
to your callbacks, and trust-based routing works automatically.

Usage:
    from agent_trust import TrustAgent
    from agent_trust.integrations.langchain import trust_tools, TrustCallbackHandler

    trust = TrustAgent()
    trust.register("researcher", capabilities=["search"])
    trust.register("writer", capabilities=["write"])
    trust.delegate("researcher", scopes=["search"])
    trust.delegate("writer", scopes=["write"])

    # Add trust tools to any LangChain agent
    tools = trust_tools(trust) + [your_other_tools...]

    # Auto-observe outcomes via callback
    handler = TrustCallbackHandler(trust, agent_name="researcher")
    agent.invoke({"input": "..."}, config={"callbacks": [handler]})
"""

from __future__ import annotations

from typing import Any

from agent_trust.core import TrustAgent

try:
    from langchain_core.tools import tool as lc_tool
    from langchain_core.callbacks import BaseCallbackHandler
except ImportError:
    lc_tool = None  # type: ignore
    BaseCallbackHandler = object  # type: ignore


def trust_tools(trust: TrustAgent) -> list:
    """Create LangChain tools from a TrustAgent.

    Returns tools that any LangChain agent can use:
    - select_agent: pick the best agent for a task
    - check_reputation: get an agent's track record
    - record_outcome: report how an agent performed

    These let agents make trust-aware delegation decisions natively.
    """
    if lc_tool is None:
        raise ImportError(
            "langchain-core is required. Install with: pip install langchain-core"
        )

    @lc_tool
    def select_agent(agent_names: str, task: str = "") -> str:
        """Select the best agent for a task based on verified reputation.
        agent_names should be comma-separated, e.g. 'researcher,writer'."""
        names = [n.strip() for n in agent_names.split(",") if n.strip()]
        if not names:
            return "Error: provide comma-separated agent names"
        chosen = trust.select(names, task=task)
        rep = trust.reputation(chosen)
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        return f"Selected: {chosen} (reputation: {rep.score:.0f}/100, success rate: {sr})"

    @lc_tool
    def check_reputation(agent_name: str) -> str:
        """Check an agent's reputation - score, success rate, trend, and current permissions."""
        try:
            rep = trust.reputation(agent_name)
        except ValueError:
            return f"Agent '{agent_name}' not found."
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        ar = f"{rep.avg_reward:.2f}" if rep.avg_reward is not None else "N/A"
        return (
            f"Agent: {agent_name}\n"
            f"  Score: {rep.score:.0f}/100\n"
            f"  Success rate: {sr}\n"
            f"  Avg reward: {ar}\n"
            f"  Trend: {rep.trend}\n"
            f"  Strengths: {rep.top_strengths}\n"
            f"  Weaknesses: {rep.top_weaknesses}\n"
            f"  Scopes: {rep.current_scopes}"
        )

    @lc_tool
    def record_outcome(agent_name: str, action: str, result: str, reward: float, content: str = "") -> str:
        """Record how an agent performed. result must be 'success', 'failure', or 'partial'. reward is -1.0 to 1.0."""
        try:
            trust.observe(agent_name, action=action, result=result, reward=reward, content=content)
            return f"Recorded: {agent_name} {action} -> {result} (reward: {reward})"
        except ValueError as e:
            return f"Error: {e}"

    return [select_agent, check_reputation, record_outcome]


class TrustCallbackHandler(BaseCallbackHandler):
    """LangChain callback that auto-records outcomes for an agent.

    Attach to any agent invocation to automatically observe successes
    and failures without manual trust.observe() calls.

    Usage:
        handler = TrustCallbackHandler(trust, agent_name="researcher")
        agent.invoke({"input": "..."}, config={"callbacks": [handler]})
    """

    def __init__(self, trust: TrustAgent, agent_name: str):
        self._trust = trust
        self._agent_name = agent_name
        self._current_action: str = ""

    def on_chain_start(self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any) -> None:
        self._current_action = inputs.get("input", "chain")[:100] if isinstance(inputs, dict) else "chain"

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        output = ""
        if isinstance(outputs, dict):
            output = str(outputs.get("output", outputs.get("text", "")))
        elif isinstance(outputs, str):
            output = outputs

        if len(output.strip()) > 10:
            self._trust.observe(
                self._agent_name,
                action=self._current_action[:50] or "task",
                result="success",
                reward=0.7,
                content=output[:200],
            )

    def on_chain_error(self, error: BaseException, **kwargs: Any) -> None:
        self._trust.observe(
            self._agent_name,
            action=self._current_action[:50] or "task",
            result="failure",
            reward=-0.5,
            content=str(error)[:200],
        )
