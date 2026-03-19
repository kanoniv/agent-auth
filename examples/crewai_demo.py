"""
Agent Trust + CrewAI - Trust-Aware Multi-Agent Demo

Three CrewAI agents (researcher, writer, editor) work through content tasks.
The TrustAgent checks reputation via UCB before each delegation and records
outcomes after completion. Over rounds, higher-reputation agents get chosen more.

Setup:
    pip install crewai agent-trust
    docker compose up -d  # agent-trust API on :4100
    python examples/crewai_demo.py
"""

import os
import random
from crewai import Agent, Task, Crew, Process
from agent_trust import TrustAgent

# ---------------------------------------------------------------------------
# Trust layer - cryptographic identity, delegation, reputation
# ---------------------------------------------------------------------------

API_URL = os.environ.get("AGENT_TRUST_API", "http://localhost:4100")
trust = TrustAgent(url=API_URL)

# Register agents with capabilities and grant scoped delegations
for name, caps in [
    ("researcher", ["research", "analyze", "fact-check"]),
    ("writer", ["write", "summarize", "draft"]),
    ("editor", ["edit", "review", "proofread"]),
]:
    trust.register(name, capabilities=caps)
    trust.delegate(name, scopes=caps)

# ---------------------------------------------------------------------------
# CrewAI agents
# ---------------------------------------------------------------------------

AGENT_MAP = {
    "researcher": Agent(
        role="Senior Researcher",
        goal="Find accurate, comprehensive information on the given topic",
        backstory="Expert research analyst with deep information synthesis skills.",
        verbose=False, allow_delegation=False,
    ),
    "writer": Agent(
        role="Content Writer",
        goal="Write clear, engaging content based on research findings",
        backstory="Skilled technical writer who turns complex topics into readable prose.",
        verbose=False, allow_delegation=False,
    ),
    "editor": Agent(
        role="Editor",
        goal="Review and improve content for clarity, accuracy, and style",
        backstory="Meticulous editor ensuring every piece meets high quality standards.",
        verbose=False, allow_delegation=False,
    ),
}

# ---------------------------------------------------------------------------
# Content tasks - 3 rounds, 3 tasks each
# ---------------------------------------------------------------------------

ROUNDS = [
    ("Cryptographic identity for AI agents", [
        ("research", "Research how Ed25519 DIDs provide verifiable identity for AI agents"),
        ("write", "Write a 2-paragraph summary of cryptographic agent identity"),
        ("edit", "Review the summary for technical accuracy and clarity"),
    ]),
    ("Agent delegation patterns", [
        ("research", "Research scoped delegation models in multi-agent systems"),
        ("write", "Write a comparison of delegation approaches: RBAC vs capability-based"),
        ("edit", "Edit the comparison for balance and factual accuracy"),
    ]),
    ("Reputation systems for AI", [
        ("research", "Analyze how UCB exploration balances trust vs discovery in agents"),
        ("write", "Draft a technical blog intro on reputation-driven orchestration"),
        ("edit", "Proofread and tighten the blog intro"),
    ]),
]

# ---------------------------------------------------------------------------
# Trust-aware task execution
# ---------------------------------------------------------------------------

def _simulated_quality(agent: str, round_num: int) -> float:
    """Simulate varying quality. Researcher is reliable, writer improves, editor starts weak.
    In production, replace with trust.evaluate(agent, action, output, llm=llm)."""
    base = {"researcher": 0.82, "writer": 0.45, "editor": 0.35}
    growth = {"researcher": 0.02, "writer": 0.12, "editor": 0.05}
    noise = random.uniform(-0.08, 0.08)
    return min(1.0, max(0.0, base[agent] + growth[agent] * (round_num - 1) + noise))


def select_and_execute(action: str, description: str, round_num: int):
    """Select best agent via trust, execute CrewAI task, record outcome."""
    candidates = list(AGENT_MAP.keys())

    # Display reputation context
    for name in candidates:
        rep = trust.reputation(name)
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        ar = f"{rep.avg_reward:.2f}" if rep.avg_reward is not None else "N/A"
        print(f"    [{name}] score={rep.score:.0f} success={sr} reward={ar} trend={rep.trend}")

    # UCB selection - balances exploitation of proven agents with exploration
    chosen = trust.select(candidates, task=action, strategy="ucb")

    # Verify delegation is still active
    if not trust.authorized(chosen, action):
        print(f"    [trust] {chosen} not authorized for '{action}', falling back")
        ranked = trust.rank(candidates, task=action, strategy="ucb")
        chosen = next((a for a in ranked if trust.authorized(a, action)), ranked[0])

    rep = trust.reputation(chosen)
    mode = "explore" if rep.total_actions == 0 else "exploit"
    print(f"    [trust] -> {chosen} ({mode})")

    # Build and run CrewAI task with the selected agent
    task = Task(description=description, expected_output="A concise, well-structured response.",
                agent=AGENT_MAP[chosen])
    crew = Crew(agents=[AGENT_MAP[chosen]], tasks=[task], process=Process.sequential, verbose=False)

    try:
        result = crew.kickoff()
        output = str(result)[:200]
        quality = _simulated_quality(chosen, round_num)
        reward = round(quality * 2 - 1, 3)  # map 0-1 to -1..1
        outcome = "success" if quality > 0.5 else "failure"
        print(f"    [{chosen}] output: {output[:80]}...")
    except Exception as e:
        quality, reward, outcome = 0.1, -0.8, "failure"
        print(f"    [{chosen}] failed: {e!s:.80}")

    # Record outcome with signed provenance
    trust.observe(chosen, action=action, result=outcome, reward=reward,
                  content=f"Round {round_num}: {description[:60]}")
    print(f"    [outcome] {outcome} (quality={quality:.2f}, reward={reward:.2f})")
    return chosen


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Agent Trust + CrewAI Demo")
    print(f"TrustAgent DID: {trust.did}")
    print("=" * 60)

    selections = {name: 0 for name in AGENT_MAP}
    round_selections = []

    for i, (topic, tasks) in enumerate(ROUNDS):
        round_num = i + 1
        print(f"\n{'=' * 60}")
        print(f"Round {round_num}/{len(ROUNDS)}: {topic}")
        print("=" * 60)

        round_choices = []
        for action, description in tasks:
            print(f"\n  Task: {description[:65]}...")
            chosen = select_and_execute(action, description, round_num)
            selections[chosen] += 1
            round_choices.append(chosen)
        round_selections.append(round_choices)

    # --- Final reputation report ---
    print(f"\n{'=' * 60}")
    print("FINAL REPUTATION REPORT")
    print("=" * 60)
    for name in AGENT_MAP:
        rep = trust.reputation(name)
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        ar = f"{rep.avg_reward:.2f}" if rep.avg_reward is not None else "N/A"
        print(f"  {name}: score={rep.score:.0f}/100 success={sr} reward={ar}"
              f" trend={rep.trend} delegations={selections[name]} scopes={rep.current_scopes}")

    # --- Selection drift: show how UCB shifted choices over rounds ---
    print(f"\n{'SELECTION DRIFT':=^60}")
    for i, choices in enumerate(round_selections):
        print(f"  Round {i + 1}: {' -> '.join(choices)}")

    ranking = trust.rank(list(AGENT_MAP.keys()), strategy="ucb")
    print(f"\nFinal UCB ranking: {' > '.join(ranking)}")

    # Restrict the lowest-ranked agent if underperforming
    worst = ranking[-1]
    rep = trust.reputation(worst)
    if rep.success_rate is not None and rep.success_rate < 0.5:
        trust.restrict(worst, scopes=[rep.current_scopes[0]] if rep.current_scopes else [])
        print(f"Restricted {worst} to minimal scopes due to low success rate.")

    print("\nDone. Every delegation and outcome was cryptographically signed.")


if __name__ == "__main__":
    main()
