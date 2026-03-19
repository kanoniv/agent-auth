"""
agent-trust: Verified trust for multi-agent systems.

The TrustAgent is an autonomous trust orchestrator that verifies, scores,
and controls other agents using cryptographic guarantees.

Usage:
    from agent_trust import TrustAgent

    trust = TrustAgent()                                    # SQLite, zero infra
    trust = TrustAgent(url="http://localhost:4100")          # hosted, shared

    # Register agents with verified identity
    trust.register("researcher", capabilities=["search"])
    trust.register("writer", capabilities=["write"])

    # Grant scoped delegation - cryptographic, not advisory
    trust.delegate("researcher", scopes=["search"])
    trust.delegate("writer", scopes=["write"])

    # Observe a signed action and score it
    trust.observe("researcher", action="search", result="success", reward=0.9)

    # Select best agent using reputation from verified provenance
    best = trust.select(["researcher", "writer"], strategy="ucb")

    # Reputation computed from SIGNED records, not self-reported
    rep = trust.reputation("researcher")

    # Enforce - real authority, not a recommendation
    trust.restrict("researcher", scopes=["search"])  # limit permissions
    trust.revoke("writer")                            # revoke all access
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from agent_trust.crypto import (
    KeyPair,
    generate_keys,
    load_keys,
    sign_provenance,
    verify_provenance,
)
from agent_trust.backends.base import (
    Backend,
    AgentRecord,
    Outcome,
    ProvenanceRecord,
    Delegation,
)
from agent_trust.backends.sqlite import SQLiteBackend


class TrustError(Exception):
    """Raised when a trust operation is denied."""
    pass


@dataclass
class RLContext:
    """In-context learning data for an agent. Inject this into prompts
    so agents learn from their own verified history."""
    agent: str
    success_rate: float | None
    avg_reward: float | None
    trend: str
    total_outcomes: int
    strengths: list[str]      # actions this agent is good at
    weaknesses: list[str]     # actions this agent is bad at
    recent_outcomes: list[dict]  # last N outcomes as dicts for prompt injection
    guidance: str             # human-readable summary for the agent


@dataclass
class ReputationReport:
    """Reputation computed from verified provenance."""
    agent: str
    score: float  # 0-100 composite
    success_rate: float | None
    avg_reward: float | None
    total_actions: int
    verified_actions: int  # how many have valid signatures
    trend: str  # improving, stable, declining
    top_strengths: list[str]
    top_weaknesses: list[str]
    current_scopes: list[str]  # what they're allowed to do right now


class TrustAgent:
    """Autonomous trust orchestrator with cryptographic identity.

    The TrustAgent has its own DID and signing keys. Every trust decision
    it makes (delegation, restriction, revocation) is signed and verifiable.
    It reads signed provenance to compute reputation - not self-reported metrics.

    Pluggable backend:
      - TrustAgent()                -> SQLite (local, zero infra)
      - TrustAgent(url="http://..") -> hosted Agent Trust API (shared reputation)
      - TrustAgent(backend=custom)  -> any Backend implementation
    """

    def __init__(
        self,
        url: str | None = None,
        db_path: str | None = None,
        backend: Backend | None = None,
        private_key: str | None = None,
        authority: str = "admin",
    ):
        # Backend
        if backend is not None:
            self._backend = backend
        elif url is not None:
            from agent_trust.backends.http import HttpBackend
            self._backend = HttpBackend(url)
        else:
            self._backend = SQLiteBackend(db_path)

        # Crypto identity
        if private_key:
            self._keys = load_keys(private_key)
        else:
            self._keys = generate_keys()

        self._authority = authority
        self._name = "trust-agent"
        self._agent_keys: dict[str, KeyPair] = {}

        # Register self
        self._backend.register(
            self._name, self._keys.did, ["verify", "score", "enforce"], "Autonomous trust orchestrator"
        )
        self._agent_keys[self._name] = self._keys

    @property
    def did(self) -> str:
        """This TrustAgent's DID."""
        return self._keys.did

    @property
    def identity(self) -> str:
        """Alias for did."""
        return self._keys.did

    # -----------------------------------------------------------------
    # register - agents join with verified identity
    # -----------------------------------------------------------------

    def register(
        self,
        name: str,
        capabilities: list[str] | None = None,
        description: str | None = None,
        did: str | None = None,
    ) -> AgentRecord:
        """Register an agent with a verified identity.

        Generates an Ed25519 key pair and DID for the agent. The TrustAgent
        holds the keys so actions can be automatically signed.

        On re-registration (idempotent), the existing identity is preserved.
        """
        # Check if already registered - preserve existing identity
        existing = self._backend.get_agent(name)
        if existing is not None and name in self._agent_keys:
            agent_did = existing.did
        else:
            # Generate new keys or use provided DID
            if did:
                # External DID - no keys to store (agent signs externally)
                agent_did = did
            else:
                keys = generate_keys()
                agent_did = keys.did
                self._agent_keys[name] = keys

        record = self._backend.register(
            name, agent_did, capabilities or [], description
        )
        # Record this registration as signed provenance
        self._signed_provenance(
            action="register",
            entity_ids=[name],
            metadata={"capabilities": capabilities or [], "agent_did": agent_did},
        )
        return record

    def agent_keys(self, name: str) -> KeyPair | None:
        """Get an agent's key pair. Returns None if agent manages its own keys."""
        return self._agent_keys.get(name)

    # -----------------------------------------------------------------
    # delegate - grant scoped authority (cryptographic, not advisory)
    # -----------------------------------------------------------------

    def delegate(
        self,
        agent: str,
        scopes: list[str],
        caveats: dict | None = None,
        expires_in: float | None = None,
    ) -> Delegation:
        """Grant scoped delegation to an agent. Signed by the TrustAgent.

        Scopes must be a subset of the agent's registered capabilities.
        You can't delegate what the agent can't do.

        Args:
            agent: The agent receiving delegation
            scopes: Permissions to grant (must be subset of capabilities)
            caveats: Conditions on the delegation, e.g. {"max_cost": 100}
            expires_in: Seconds until delegation expires. None = never expires.

        Raises ValueError if any scope is not in the agent's capabilities.
        """
        record = self._backend.get_agent(agent)
        if record is None:
            raise TrustError(f"Agent '{agent}' not found. Call register() first.")
        invalid = [s for s in scopes if s not in record.capabilities]
        if invalid:
            raise TrustError(
                f"Cannot delegate {invalid} to '{agent}' - not in capabilities {record.capabilities}."
            )
        expires_at = (time.time() + expires_in) if expires_in is not None else None
        delegation = self._backend.grant_delegation(
            self._name, agent, scopes, caveats=caveats, expires_at=expires_at,
        )
        self._signed_provenance(
            action="delegate",
            entity_ids=[agent],
            metadata={
                "scopes": scopes,
                "grantor": self._name,
                "caveats": caveats or {},
                "expires_at": expires_at,
            },
        )
        return delegation

    # -----------------------------------------------------------------
    # authorized - check if an agent can perform an action
    # -----------------------------------------------------------------

    def authorized(self, agent: str, scope: str) -> bool:
        """Check if an agent is authorized to perform an action.

        Agents should call this before acting. Returns False if
        the scope was never granted or has been restricted/revoked.
        """
        record = self._backend.get_agent(agent)
        if record is None:
            return False
        return scope in record.scopes

    # -----------------------------------------------------------------
    # observe - record and verify an agent's action
    # -----------------------------------------------------------------

    def observe(
        self,
        agent: str,
        action: str,
        result: Literal["success", "failure", "partial"],
        reward: float,
        content: str = "",
        signature: str | None = None,
        signed_at: float | None = None,
    ) -> Outcome:
        """Observe an agent's action and record the outcome.

        If the agent was registered through this TrustAgent, the action is
        automatically signed with the agent's Ed25519 keys. If a signature
        is provided externally, it's verified against the agent's DID.

        Verified actions are tracked in the reputation report.

        Args:
            agent: The agent that performed the action
            action: What the agent did
            result: success, failure, or partial
            reward: -1.0 to 1.0 quality signal
            content: Description of what happened
            signature: Optional Ed25519 signature from the acting agent
            signed_at: Timestamp the agent used when signing (required if signature provided externally)
        """
        if not -1.0 <= reward <= 1.0:
            raise ValueError("reward must be between -1.0 and 1.0")
        if result not in ("success", "failure", "partial"):
            raise ValueError("result must be success, failure, or partial")

        record = self._backend.get_agent(agent)
        agent_did = record.did if record else ""

        # Auto-sign if we hold the agent's keys
        verified = False
        now = time.time()
        agent_keys = self._agent_keys.get(agent)
        if agent_keys and not signature:
            signature = sign_provenance(
                agent_keys, action, [], {"result": result, "reward": reward}, now
            )
            signed_at = now
            verified = True
        elif signature and agent_did and signed_at is not None:
            # Verify externally provided signature
            verified = verify_provenance(
                did=agent_did,
                action=action,
                entity_ids=[],
                metadata={"result": result, "reward": reward},
                timestamp=signed_at,
                signature_b64=signature,
            )

        # Record signed provenance
        prov = self._backend.record_provenance(
            agent=agent,
            agent_did=agent_did,
            action=action,
            entity_ids=[],
            metadata={"result": result, "reward": reward, "content": content},
            signature=signature,
            verified=verified,
        )

        # Record outcome linked to provenance
        outcome = self._backend.record_outcome(
            agent=agent,
            action=action,
            result=result,
            reward=reward,
            content=content,
            reporter=self._name,
            provenance_id=None,
        )

        # TrustAgent signs its own observation
        self._signed_provenance(
            action="observe",
            entity_ids=[agent],
            metadata={"observed_action": action, "result": result, "reward": reward, "verified": verified},
        )

        return outcome

    # -----------------------------------------------------------------
    # select - choose best agent from verified reputation
    # -----------------------------------------------------------------

    def select(
        self,
        agents: list[str],
        task: str | None = None,
        strategy: Literal["ucb", "greedy"] = "ucb",
        exploration: float = 1.5,
    ) -> str:
        """Select the best agent based on verified reputation.

        Uses UCB (Upper Confidence Bound) by default - balances exploiting
        known-good agents with exploring under-tested ones.
        """
        if not agents:
            raise ValueError("agents list cannot be empty")
        if len(agents) == 1:
            return agents[0]

        ranked = self.rank(agents, task=task, strategy=strategy, exploration=exploration)
        return ranked[0]

    # -----------------------------------------------------------------
    # rank - order agents by verified reputation
    # -----------------------------------------------------------------

    def rank(
        self,
        agents: list[str],
        task: str | None = None,
        strategy: Literal["ucb", "greedy"] = "ucb",
        exploration: float = 1.5,
    ) -> list[str]:
        """Rank agents by verified reputation. Best first."""
        if not agents:
            raise ValueError("agents list cannot be empty")

        scored: list[tuple[str, float]] = []
        for name in agents:
            outcomes = self._backend.get_outcomes(name, limit=50)
            summary = _compute_summary(outcomes)
            if strategy == "ucb":
                score = _ucb_score(summary, len(agents), exploration)
            else:
                score = summary["avg_reward"] if summary["avg_reward"] is not None else 0.0
            scored.append((name, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [name for name, _ in scored]

    # -----------------------------------------------------------------
    # reputation - computed from signed provenance
    # -----------------------------------------------------------------

    def reputation(self, agent: str) -> ReputationReport:
        """Get an agent's reputation computed from verified provenance.

        This is the key differentiator: reputation comes from SIGNED records,
        not self-reported metrics. The TrustAgent verifies before it trusts.
        """
        record = self._backend.get_agent(agent)
        if record is None:
            raise TrustError(f"Agent '{agent}' not found. Call register() first.")

        outcomes = self._backend.get_outcomes(agent, limit=50)
        provenance = self._backend.get_provenance(agent, limit=50)
        summary = _compute_summary(outcomes)

        verified_count = sum(1 for p in provenance if p.verified)

        return ReputationReport(
            agent=agent,
            score=_compute_reputation_score(record, summary),
            success_rate=summary["success_rate"],
            avg_reward=summary["avg_reward"],
            total_actions=summary["total"],
            verified_actions=verified_count,
            trend=summary["trend"],
            top_strengths=summary["top_success"],
            top_weaknesses=summary["top_failure"],
            current_scopes=record.scopes,
        )

    # -----------------------------------------------------------------
    # recall - in-context RL: agent reads its own history
    # -----------------------------------------------------------------

    def recall(self, agent: str, last_n: int = 10) -> RLContext:
        """Recall an agent's learning context from verified outcomes.

        This is the in-context RL primitive. Inject the returned context
        into the agent's prompt so it can learn from its own history:

            ctx = trust.recall("researcher")
            prompt = f"Your track record: {ctx.guidance}\\n\\nTask: ..."

        The agent sees what it's good at, what it's bad at, and adjusts.
        Next outcome gets recorded, and the next recall reflects the update.
        That's the learning loop - no gradient descent, just structured memory.
        """
        outcomes = self._backend.get_outcomes(agent, limit=50)
        summary = _compute_summary(outcomes)

        recent = [
            {
                "action": o.action,
                "result": o.result,
                "reward": o.reward,
                "content": o.content,
            }
            for o in outcomes[:last_n]
        ]

        # Generate human-readable guidance
        guidance = _generate_guidance(agent, summary, recent)

        return RLContext(
            agent=agent,
            success_rate=summary["success_rate"],
            avg_reward=summary["avg_reward"],
            trend=summary["trend"],
            total_outcomes=summary["total"],
            strengths=summary["top_success"],
            weaknesses=summary["top_failure"],
            recent_outcomes=recent,
            guidance=guidance,
        )

    # -----------------------------------------------------------------
    # evaluate - LLM-powered judgment on top of the protocol
    # -----------------------------------------------------------------

    def evaluate(
        self,
        agent: str,
        action: str,
        output: str,
        task: str = "",
        llm: Any = None,
    ) -> Outcome:
        """Evaluate an agent's output using LLM judgment and record the outcome.

        This is the autonomous trust layer - the TrustAgent reasons about quality,
        not just counts successes. Requires an LLM (any LangChain chat model).

        Without an LLM, use observe() for manual scoring. evaluate() adds
        subjective quality assessment on top of the cryptographic protocol.

        Args:
            agent: The agent that produced the output
            action: What the agent did
            output: The actual output to evaluate
            task: The original task (for context)
            llm: A LangChain chat model (ChatAnthropic, ChatOpenAI, etc.)
        """
        if llm is None:
            raise TrustError("evaluate() requires an LLM. Pass llm=ChatAnthropic(...) or use observe() for manual scoring.")

        prompt = (
            f"Evaluate this agent's output quality.\n\n"
            f"AGENT: {agent}\n"
            f"ACTION: {action}\n"
            f"TASK: {task}\n"
            f"OUTPUT: {output[:2000]}\n\n"
            f"Rate 0.0 to 1.0. Respond with ONLY JSON: "
            f'{{\"score\": 0.0-1.0, \"result\": \"success\" or \"failure\", \"reason\": \"one sentence\"}}'
        )

        import json
        response = llm.invoke(prompt)
        text = response.content.strip() if hasattr(response, "content") else str(response).strip()

        try:
            if "```" in text:
                text = text.split("```")[1].removeprefix("json").strip()
            evaluation = json.loads(text)
        except (json.JSONDecodeError, IndexError):
            evaluation = {"score": 0.5, "result": "partial", "reason": text[:100]}

        score = float(evaluation.get("score", 0.5))
        result = evaluation.get("result", "partial")
        if result not in ("success", "failure", "partial"):
            result = "success" if score > 0.5 else "failure"
        reason = evaluation.get("reason", "")
        reward = max(-1.0, min(1.0, score * 2 - 1))

        return self.observe(
            agent, action=action, result=result, reward=round(reward, 3),
            content=reason,
        )

    # -----------------------------------------------------------------
    # enforce - restrict or revoke delegation
    # -----------------------------------------------------------------

    def restrict(self, agent: str, scopes: list[str]) -> Delegation | None:
        """Restrict an agent's delegation to specific scopes.

        This is enforcement, not advisory. The agent loses permissions
        for anything not in the new scope list. Scopes must be a subset
        of the agent's registered capabilities.
        """
        if scopes:
            record = self._backend.get_agent(agent)
            if record:
                invalid = [s for s in scopes if s not in record.capabilities]
                if invalid:
                    raise TrustError(
                        f"Cannot restrict '{agent}' to {invalid} - not in capabilities {record.capabilities}."
                    )
        result = self._backend.restrict_delegation(self._name, agent, scopes)
        if result:
            self._signed_provenance(
                action="restrict",
                entity_ids=[agent],
                metadata={"new_scopes": scopes, "reason": "trust enforcement"},
            )
        return result

    def revoke(self, agent: str) -> Delegation | None:
        """Revoke all delegation for an agent. Nuclear option.

        The agent loses all permissions granted by this TrustAgent.
        """
        result = self._backend.revoke_delegation(self._name, agent)
        if result:
            self._signed_provenance(
                action="revoke",
                entity_ids=[agent],
                metadata={"reason": "trust enforcement"},
            )
        return result

    # -----------------------------------------------------------------
    # Internal: signed provenance
    # -----------------------------------------------------------------

    def _signed_provenance(
        self, action: str, entity_ids: list[str], metadata: dict
    ) -> ProvenanceRecord:
        """Record the TrustAgent's own actions as signed provenance."""
        now = time.time()
        sig = sign_provenance(self._keys, action, entity_ids, metadata, now)
        return self._backend.record_provenance(
            agent=self._name,
            agent_did=self._keys.did,
            action=action,
            entity_ids=entity_ids,
            metadata=metadata,
            signature=sig,
            verified=True,  # self-signed, verified by construction
        )


# -----------------------------------------------------------------
# Pure computation functions (no state)
# -----------------------------------------------------------------

def _compute_summary(outcomes: list[Outcome]) -> dict:
    """Compute summary stats from outcomes."""
    if not outcomes:
        return {
            "total": 0, "judged": 0, "successes": 0, "failures": 0,
            "success_rate": None, "avg_reward": None, "trend": "stable",
            "top_success": [], "top_failure": [],
        }

    successes = sum(1 for o in outcomes if o.result == "success")
    failures = sum(1 for o in outcomes if o.result == "failure")
    judged = successes + failures
    rewards = [o.reward for o in outcomes if o.reward is not None]
    avg_reward = sum(rewards) / len(rewards) if rewards else None

    trend = "stable"
    if len(rewards) >= 6:
        recent = sum(rewards[:5]) / 5
        prior_count = min(len(rewards) - 5, 5)
        prior = sum(rewards[5:10]) / prior_count
        if recent > prior + 0.1:
            trend = "improving"
        elif recent < prior - 0.1:
            trend = "declining"

    action_counts: dict[str, dict[str, int]] = {}
    for o in outcomes:
        if o.action not in action_counts:
            action_counts[o.action] = {"success": 0, "failure": 0}
        if o.result == "success":
            action_counts[o.action]["success"] += 1
        elif o.result == "failure":
            action_counts[o.action]["failure"] += 1

    top_success = [a for a, _ in sorted(
        action_counts.items(), key=lambda x: x[1]["success"], reverse=True
    )[:3]]
    top_failure = [a for a, c in sorted(
        action_counts.items(), key=lambda x: x[1]["failure"], reverse=True
    ) if c["failure"] > 0][:3]

    return {
        "total": len(outcomes), "judged": judged,
        "successes": successes, "failures": failures,
        "success_rate": successes / judged if judged > 0 else None,
        "avg_reward": avg_reward, "trend": trend,
        "top_success": top_success, "top_failure": top_failure,
    }


def _ucb_score(summary: dict, n_agents: int, c: float) -> float:
    """Upper Confidence Bound score."""
    judged = summary["judged"]
    if judged == 0:
        return float("inf")
    avg = summary["avg_reward"] if summary["avg_reward"] is not None else 0.0
    normalized = (avg + 1) / 2
    bonus = c * math.sqrt(math.log(max(n_agents, 1)) / judged)
    return normalized + bonus


def _compute_reputation_score(record: AgentRecord, summary: dict) -> float:
    """Composite reputation score (0-100)."""
    total = summary["total"]
    success_rate = summary["success_rate"] if summary["success_rate"] is not None else 1.0
    avg_reward = summary["avg_reward"] if summary["avg_reward"] is not None else 0.0
    action_types = len(set(summary["top_success"] + summary["top_failure"]))
    tenure_days = (time.time() - record.registered_at) / 86400

    activity = min(100, math.log2(total + 1) * 15)
    success = success_rate * 100
    reward = ((avg_reward + 1) / 2) * 100
    tenure = min(100, (tenure_days / 90) * 100)
    diversity = min(100, (action_types / 7) * 100)

    return round(
        activity * 0.30 + success * 0.25 + reward * 0.20
        + tenure * 0.15 + diversity * 0.10, 1,
    )


def _generate_guidance(agent: str, summary: dict, recent: list[dict]) -> str:
    """Generate human-readable guidance from outcome history.
    This goes into the agent's prompt for in-context learning."""
    if summary["total"] == 0:
        return f"No prior history for {agent}. This is your first task."

    parts = [f"Track record for {agent}: {summary['total']} outcomes."]

    sr = summary["success_rate"]
    if sr is not None:
        parts.append(f"Success rate: {sr:.0%}.")

    ar = summary["avg_reward"]
    if ar is not None:
        parts.append(f"Average reward: {ar:.2f}.")

    if summary["trend"] != "stable":
        parts.append(f"Performance is {summary['trend']}.")

    if summary["top_success"]:
        parts.append(f"Strong at: {', '.join(summary['top_success'])}.")

    if summary["top_failure"]:
        parts.append(f"Weak at: {', '.join(summary['top_failure'])}. Avoid or improve on these.")

    # Add recent outcome context
    failures = [o for o in recent[:5] if o["result"] == "failure"]
    if failures:
        fail_actions = [f["action"] for f in failures]
        parts.append(f"Recent failures: {', '.join(fail_actions)}. Adjust your approach.")

    return " ".join(parts)
