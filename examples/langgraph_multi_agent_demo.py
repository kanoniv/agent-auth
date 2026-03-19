"""
Agent Trust + LangGraph - Multi-Agent Demo

Real multi-agent architecture using the agent-trust SDK:
- TrustAgent handles identity, reputation, delegation, and enforcement
- Orchestrator uses trust.select() with UCB exploration
- Researcher and Writer are create_react_agent subgraphs with real tools
- All outcomes flow through verified provenance

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    cd sdks/python && pip install -e .
    python examples/langgraph_multi_agent_demo.py
"""

import os
import json
import warnings

from typing import TypedDict, Literal

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain_anthropic import ChatAnthropic

from agent_trust import TrustAgent

warnings.filterwarnings("ignore", category=UserWarning, module="langchain_core")

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

llm = ChatAnthropic(
    model="claude-haiku-4-5-20251001",
    api_key=ANTHROPIC_KEY,
    max_tokens=1024,
    temperature=0.3,
)

# ---------------------------------------------------------------------------
# Trust layer - the protocol
# ---------------------------------------------------------------------------

trust = TrustAgent(db_path=".agent-trust-demo.db")

# Register agents with verified identity
trust.register("researcher", capabilities=["search", "analyze"])
trust.register("writer", capabilities=["write", "summarize"])

# Grant scoped delegation
trust.delegate("researcher", scopes=["search", "analyze"])
trust.delegate("writer", scopes=["write", "summarize"])


# ---------------------------------------------------------------------------
# Domain tools - Researcher
# ---------------------------------------------------------------------------

@tool
def search_web(query: str) -> str:
    """Search the web for information on a topic."""
    results = {
        "competitor": (
            "Search results for: {q}\n\n"
            "1. Langfuse - OSS LLM observability. 8.2K GitHub stars. No identity/trust.\n"
            "2. AgentOps - Python agent monitoring. YC W24. No delegation/reputation.\n"
            "3. Traccia - Agent governance. No cryptographic DIDs. Enterprise only.\n"
            "4. Patronus AI - LLM evaluation/security. No agent identity.\n"
            "5. Arize Phoenix - OSS tracing. Weak on multi-agent coordination."
        ),
        "did": (
            "Search results for: {q}\n\n"
            "1. W3C DID Core v1.0 - Decentralized Identifiers. Methods: did:key, did:web, did:pkh.\n"
            "2. Key rotation strategies: pre-rotation (KERI), document update (did:web), delegation chains.\n"
            "3. did:key - Static keys, no rotation. Best for ephemeral agent identities.\n"
            "4. For long-lived agents, did:web with controller rotation is pragmatic.\n"
            "5. Key rotation must propagate to all delegation chains."
        ),
        "pricing": (
            "Search results for: {q}\n\n"
            "1. Langfuse: Free OSS, Pro $59/mo, Team $199/mo. Most developer-friendly.\n"
            "2. AgentOps: Free tier, Developer $49/seat/mo, Team $99/seat/mo.\n"
            "3. Traccia: Enterprise only, no public pricing. Est. $2K-5K/mo."
        ),
    }
    q_lower = query.lower()
    for key, template in results.items():
        if key in q_lower:
            return template.format(q=query)
    return f"Search results for: {query}\n\nFound relevant results about '{query}'."


@tool
def analyze_data(topic: str, raw_findings: str) -> str:
    """Analyze raw research findings into a structured analysis."""
    return f"Analysis of: {topic}\nBased on: {len(raw_findings)} chars of findings"


# ---------------------------------------------------------------------------
# Domain tools - Writer
# ---------------------------------------------------------------------------

@tool
def draft_content(topic: str, style: str, key_points: str) -> str:
    """Draft content given a topic, style, and key points."""
    return f"Drafting {style} content about: {topic}\nKey points: {key_points}"


@tool
def refine_text(text: str, instruction: str) -> str:
    """Refine text based on an instruction."""
    return f"Refining ({len(text)} chars) with: {instruction}"


# ---------------------------------------------------------------------------
# Agent subgraphs
# ---------------------------------------------------------------------------

researcher_graph = create_react_agent(
    llm,
    [search_web, analyze_data],
    prompt="You are a research agent. Use search_web to find information, then synthesize your findings. Be thorough but concise.",
    name="researcher",
)

writer_graph = create_react_agent(
    llm,
    [draft_content, refine_text],
    prompt="You are a writing agent. Use draft_content to create initial content, then refine_text to polish it. Write clearly and professionally.",
    name="writer",
)


# ---------------------------------------------------------------------------
# Parent graph state
# ---------------------------------------------------------------------------

class PipelineState(TypedDict):
    task: str
    round_num: int
    total_rounds: int
    chosen_agent: str
    explore_forced: bool
    agent_output: str
    quality_score: float
    evaluation_result: str


# ---------------------------------------------------------------------------
# Orchestrator - uses TrustAgent for selection
# ---------------------------------------------------------------------------

def orchestrator_decide(state: PipelineState) -> dict:
    """Use TrustAgent to select the best agent via UCB."""
    agents = ["researcher", "writer"]

    # Get reputation context for display
    for name in agents:
        rep = trust.reputation(name)
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        ar = f"{rep.avg_reward:.2f}" if rep.avg_reward is not None else "N/A"
        print(f"  [{name}] score={rep.score:.0f} success={sr} avg_reward={ar} trend={rep.trend}")

    # TrustAgent selects using UCB - one line
    chosen = trust.select(agents, task=state["task"], strategy="ucb")

    rep = trust.reputation(chosen)
    exploring = rep.total_actions == 0
    print(f"  [trust] -> {chosen} ({'explore' if exploring else 'exploit'})")

    return {"chosen_agent": chosen, "explore_forced": exploring}


# ---------------------------------------------------------------------------
# Subgraph wrappers
# ---------------------------------------------------------------------------

def _run_subgraph(graph, agent_name: str, state: PipelineState) -> dict:
    task_msg = HumanMessage(content=f"Complete this task:\n\n{state['task']}")
    result = graph.invoke({"messages": [task_msg]})

    output = ""
    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage) and msg.content and not msg.tool_calls:
            output = msg.content
            break

    if not output:
        output = f"[{agent_name} produced no final summary]"

    print(f"  [{agent_name}] {output[:100]}...")
    return {"agent_output": output}


def run_researcher(state: PipelineState) -> dict:
    return _run_subgraph(researcher_graph, "researcher", state)


def run_writer(state: PipelineState) -> dict:
    return _run_subgraph(writer_graph, "writer", state)


# ---------------------------------------------------------------------------
# Evaluator - records outcome through TrustAgent
# ---------------------------------------------------------------------------

def evaluate_and_feedback(state: PipelineState) -> dict:
    agent = state["chosen_agent"]

    # LLM evaluates quality
    response = llm.invoke([
        {"role": "system", "content": "Rate this output. Respond with ONLY JSON: {\"score\": 0.0-1.0, \"result\": \"success\" or \"failure\", \"reason\": \"one sentence\"}"},
        {"role": "user", "content": f"TASK: {state['task']}\nOUTPUT: {state['agent_output'][:500]}"},
    ])

    text = response.content.strip()
    try:
        if "```" in text:
            text = text.split("```")[1].removeprefix("json").strip()
        evaluation = json.loads(text)
    except json.JSONDecodeError:
        evaluation = {"score": 0.5, "result": "failure", "reason": text[:100]}

    score = float(evaluation.get("score", 0.5))
    result = evaluation.get("result", "failure")
    reason = evaluation.get("reason", "")
    reward = max(-1.0, min(1.0, score * 2 - 1))

    # Record through TrustAgent - creates signed provenance
    trust.observe(agent, action="task_completion", result=result, reward=round(reward, 3), content=reason)

    print(f"  [evaluator] {result} (score={score:.2f}, reward={reward:.2f}): {reason}")
    return {"quality_score": score, "evaluation_result": result}


# ---------------------------------------------------------------------------
# Conditional router
# ---------------------------------------------------------------------------

def route_to_agent(state: PipelineState) -> str:
    return state["chosen_agent"]


# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------

parent = StateGraph(PipelineState)
parent.add_node("decide", orchestrator_decide)
parent.add_node("researcher", run_researcher)
parent.add_node("writer", run_writer)
parent.add_node("evaluate", evaluate_and_feedback)

parent.add_edge(START, "decide")
parent.add_conditional_edges("decide", route_to_agent, {"researcher": "researcher", "writer": "writer"})
parent.add_edge("researcher", "evaluate")
parent.add_edge("writer", "evaluate")
parent.add_edge("evaluate", END)

pipeline = parent.compile()


# ---------------------------------------------------------------------------
# Tasks and main
# ---------------------------------------------------------------------------

TASKS = [
    "Research the top 3 competitors in the AI agent infrastructure space",
    "Write a technical blog intro about why AI agents need cryptographic identity",
    "Analyze pricing models of Langfuse, AgentOps, and Traccia",
    "Write API documentation for a POST /v1/memory/feedback endpoint",
    "Research W3C DID standards on key rotation for agent systems",
    "Write a comparison table of agent observability tools",
    "Research how UCB exploration works for agent delegation",
]


def main():
    print("=" * 60)
    print("Agent Trust + LangGraph Multi-Agent Demo")
    print(f"TrustAgent DID: {trust.did}")
    print("=" * 60)

    for i, task in enumerate(TASKS):
        print(f"\n{'=' * 60}")
        print(f"Round {i + 1}/{len(TASKS)}: {task}")
        print("=" * 60)

        result = pipeline.invoke({
            "task": task,
            "round_num": i + 1,
            "total_rounds": len(TASKS),
            "chosen_agent": "",
            "explore_forced": False,
            "agent_output": "",
            "quality_score": 0.0,
            "evaluation_result": "",
        })

    # Final report
    print(f"\n{'=' * 60}")
    print("RESULTS")
    print("=" * 60)
    for name in ["researcher", "writer"]:
        rep = trust.reputation(name)
        sr = f"{rep.success_rate:.0%}" if rep.success_rate is not None else "N/A"
        ar = f"{rep.avg_reward:.2f}" if rep.avg_reward is not None else "N/A"
        print(f"  {name}:")
        print(f"    Reputation: {rep.score:.0f}/100")
        print(f"    Success rate: {sr}")
        print(f"    Avg reward: {ar}")
        print(f"    Trend: {rep.trend}")
        print(f"    Verified actions: {rep.verified_actions}")
        print(f"    Scopes: {rep.current_scopes}")


if __name__ == "__main__":
    main()
