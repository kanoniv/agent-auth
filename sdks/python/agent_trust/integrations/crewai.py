"""
CrewAI integration for agent-trust.

Replaces CrewAI's hardcoded delegation with trust-based agent selection.
The TrustManager is a CrewAI-compatible manager agent that uses verified
reputation and UCB exploration to route tasks.

Before (hardcoded):
    crew = Crew(
        agents=[researcher, writer],
        process=Process.hierarchical,
        manager_agent=manager,
    )

After (trust-based):
    from agent_trust.integrations.crewai import TrustManager

    trust_manager = TrustManager()
    crew = Crew(
        agents=[researcher, writer],
        process=Process.hierarchical,
        manager_agent=trust_manager.as_agent(),
    )

Requires: pip install agent-trust[crewai]
"""

from __future__ import annotations

from typing import Any, Callable

from agent_trust.core import TrustAgent

try:
    from crewai import Agent, Task, Crew
except ImportError:
    Agent = None  # type: ignore
    Task = None  # type: ignore
    Crew = None  # type: ignore


class TrustManager:
    """Trust-based manager for CrewAI hierarchical crews.

    Wraps a TrustAgent and exposes it as a CrewAI manager agent.
    Automatically observes task outcomes and adjusts delegation
    based on verified reputation.
    """

    def __init__(
        self,
        trust: TrustAgent | None = None,
        db_path: str | None = None,
        url: str | None = None,
        strategy: str = "ucb",
        auto_revoke_threshold: float = -0.5,
    ):
        """
        Args:
            trust: Existing TrustAgent instance (or one is created)
            db_path: SQLite path (if creating a new TrustAgent)
            url: Hosted Agent Trust API URL (if creating a new TrustAgent)
            strategy: Selection strategy - "ucb" or "greedy"
            auto_revoke_threshold: Revoke delegation if avg_reward drops below this
        """
        if Agent is None:
            raise ImportError(
                "crewai is required for this integration. "
                "Install it with: pip install agent-trust[crewai]"
            )

        self._trust = trust or TrustAgent(db_path=db_path, url=url)
        self._strategy = strategy
        self._auto_revoke_threshold = auto_revoke_threshold
        self._agent_map: dict[str, Agent] = {}

    @property
    def trust(self) -> TrustAgent:
        """Access the underlying TrustAgent."""
        return self._trust

    def register_crew(self, crew_agents: list[Agent]) -> None:
        """Register all crew agents with the trust system.

        Call this before crew.kickoff() to set up identity and delegation.
        """
        for agent in crew_agents:
            name = self._agent_name(agent)
            self._agent_map[name] = agent
            self._trust.register(name, capabilities=[agent.role])
            self._trust.delegate(name, scopes=["execute", agent.role])

    def select_for_task(self, task_description: str) -> Agent:
        """Select the best agent for a task based on reputation.

        Use this as a custom delegation function in CrewAI.
        """
        agent_names = list(self._agent_map.keys())
        if not agent_names:
            raise ValueError("No agents registered. Call register_crew() first.")

        best_name = self._trust.select(
            agent_names, task=task_description, strategy=self._strategy
        )
        return self._agent_map[best_name]

    def record_outcome(
        self,
        agent: Agent,
        action: str,
        result: str,
        reward: float,
        content: str = "",
    ) -> None:
        """Record a task outcome and enforce trust policies.

        Call this in a task_callback or after evaluating output quality.
        Automatically revokes delegation if performance drops below threshold.
        """
        name = self._agent_name(agent)
        self._trust.observe(name, action=action, result=result, reward=reward, content=content)

        # Auto-enforcement: revoke if avg_reward drops below threshold
        rep = self._trust.reputation(name)
        if rep.avg_reward is not None and rep.avg_reward < self._auto_revoke_threshold:
            self._trust.restrict(name, scopes=[])  # remove all scopes

    def rank_agents(self, task_description: str = "") -> list[str]:
        """Rank all registered agents by reputation. Best first."""
        return self._trust.rank(
            list(self._agent_map.keys()),
            task=task_description,
            strategy=self._strategy,
        )

    def as_agent(self, llm: Any = None) -> Agent:
        """Create a CrewAI Agent that acts as the trust-based manager.

        This agent uses the TrustAgent internally to make delegation decisions.
        Pass it as manager_agent to a hierarchical Crew.
        """
        return Agent(
            role="Trust Manager",
            goal=(
                "Delegate tasks to the most capable agent based on their verified "
                "track record. Use reputation data to make informed delegation decisions. "
                "Restrict or revoke access for consistently underperforming agents."
            ),
            backstory=(
                "You are an autonomous trust orchestrator with cryptographic identity. "
                "You verify agent actions through signed provenance, score outcomes "
                "using both objective metrics and quality assessment, and enforce "
                "delegation policies. Your decisions are backed by verifiable evidence, "
                "not opinions."
            ),
            allow_delegation=True,
            verbose=True,
            **({"llm": llm} if llm else {}),
        )

    def task_callback(self, output) -> None:
        """CrewAI task callback - automatically records outcomes.

        Usage:
            crew = Crew(
                agents=[...],
                tasks=[...],
                task_callback=trust_manager.task_callback,
            )
        """
        # CrewAI TaskOutput has .agent (str), .raw (str), .description
        agent_name = getattr(output, "agent", None)
        if agent_name and agent_name in self._agent_map:
            # Simple heuristic: non-empty output = success
            raw = getattr(output, "raw", "") or ""
            if len(raw.strip()) > 10:
                self._trust.observe(
                    agent_name, action="task", result="success",
                    reward=0.7, content=raw[:200],
                )
            else:
                self._trust.observe(
                    agent_name, action="task", result="failure",
                    reward=-0.3, content="Output too short or empty",
                )

    def _agent_name(self, agent: Agent) -> str:
        """Extract a consistent name from a CrewAI agent."""
        return getattr(agent, "role", "unknown").lower().replace(" ", "-")
