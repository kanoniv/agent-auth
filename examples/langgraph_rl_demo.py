"""
Agent Trust - In-Context RL Demo with LangGraph

Three agents (orchestrator, researcher, writer) interact via the Agent Trust API.
The orchestrator reads each agent's rl_context before delegating, and submits
feedback after each task. Over multiple rounds, the orchestrator learns to
favor the more reliable agent.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    docker compose up -d   # agent-trust API on :4100
    python examples/langgraph_rl_demo.py
"""

import os
import json
import math
import httpx
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

API = os.environ.get("AGENT_TRUST_API", "http://localhost:4100")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

llm = ChatAnthropic(
    model="claude-haiku-4-5-20251001",
    api_key=ANTHROPIC_KEY,
    max_tokens=512,
    temperature=0.3,
)

# ---------------------------------------------------------------------------
# Agent Trust API helpers
# ---------------------------------------------------------------------------

def api(method, path, **kwargs):
    """Call the Agent Trust API."""
    headers = kwargs.pop("headers", {})
    r = httpx.request(method, f"{API}{path}", headers=headers, **kwargs)
    r.raise_for_status()
    return r.json()

def register(name, did, capabilities, description):
    return api("POST", "/v1/agents/register", json={
        "name": name, "did": did,
        "capabilities": capabilities, "description": description,
    })

def get_agent(name):
    return api("GET", f"/v1/agents/{name}")

def feedback(reporter, subject_did, action, result, reward, content):
    return api("POST", "/v1/memory/feedback",
        headers={"X-Agent-Name": reporter},
        json={
            "subject_did": subject_did,
            "action": action,
            "result": result,
            "reward_signal": reward,
            "content": content,
        })

# ---------------------------------------------------------------------------
# LangGraph State
# ---------------------------------------------------------------------------

class TaskState(TypedDict):
    task: str
    round: int
    total_rounds: int
    chosen_agent: str
    explore_forced: bool     # True if UCB forced exploration
    agent_context: str       # rl_context injected here
    agent_output: str
    quality_score: float
    feedback_submitted: bool

# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def ucb_score(summary, total_rounds, c=1.5):
    """Upper Confidence Bound score for an agent.
    Agents with fewer observations get a confidence bonus.
    c controls exploration vs exploitation (higher = more exploration)."""
    judged = summary.get("judged", 0)
    if judged == 0:
        return float("inf")  # never tested = must explore
    avg = summary.get("avg_reward", 0) or 0
    # Normalize avg_reward from [-1,1] to [0,1] for UCB
    normalized = (avg + 1) / 2
    bonus = c * math.sqrt(math.log(max(total_rounds, 1)) / judged)
    return normalized + bonus

def orchestrator_decide(state: TaskState) -> TaskState:
    """Orchestrator reads rl_context for both agents. UCB decides explore vs exploit."""
    researcher_info = get_agent("researcher")
    writer_info = get_agent("writer")

    r_summary = researcher_info.get("rl_context", {}).get("summary", {})
    w_summary = writer_info.get("rl_context", {}).get("summary", {})

    r_ctx = json.dumps(researcher_info.get("rl_context", {}), indent=2)
    w_ctx = json.dumps(writer_info.get("rl_context", {}), indent=2)

    total = state["total_rounds"]
    r_ucb = ucb_score(r_summary, total)
    w_ucb = ucb_score(w_summary, total)

    # UCB picks the agent with the highest score (reward + uncertainty bonus)
    ucb_choice = "researcher" if r_ucb >= w_ucb else "writer"
    # Check if UCB is forcing exploration (picking the agent with worse avg_reward)
    r_avg = r_summary.get("avg_reward", 0) or 0
    w_avg = w_summary.get("avg_reward", 0) or 0
    exploit_choice = "researcher" if r_avg >= w_avg else "writer"
    exploring = ucb_choice != exploit_choice

    r_judged = r_summary.get("judged", 0)
    w_judged = w_summary.get("judged", 0)
    print(f"  [UCB] researcher: {r_ucb:.3f} (avg={r_avg:.2f}, n={r_judged}) | writer: {w_ucb:.3f} (avg={w_avg:.2f}, n={w_judged})")

    if exploring:
        # UCB says explore - tell the LLM why
        chosen = ucb_choice
        reasoning = f"EXPLORING: {chosen} has only {r_judged if chosen == 'researcher' else w_judged} judged outcomes. Gathering fresh data to update their track record."
        print(f"  [orchestrator] Round {state['round']}: EXPLORE -> {chosen}")
        print(f"                 {reasoning}")
        agent_ctx = r_ctx if chosen == "researcher" else w_ctx

        return {
            **state,
            "chosen_agent": chosen,
            "explore_forced": True,
            "agent_context": agent_ctx,
        }

    # UCB agrees with exploitation - let the LLM decide with full context
    prompt = f"""You are an orchestrator agent. You need to delegate a task to one of two agents.

TASK: {state['task']}

RESEARCHER track record:
{r_ctx}

WRITER track record:
{w_ctx}

Based on their track records, choose which agent should handle this task.
Consider their success rates, recent trends, and what actions they are strong/weak at.

Respond with ONLY a JSON object: {{"choice": "researcher" or "writer", "reasoning": "one sentence why"}}"""

    response = llm.invoke([
        SystemMessage(content="You are a delegation orchestrator. Choose the best agent for the task based on their RL context."),
        HumanMessage(content=prompt),
    ])

    text = response.content.strip()
    try:
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        decision = json.loads(text)
    except json.JSONDecodeError:
        decision = {
            "choice": "researcher" if "researcher" in text.lower() else "writer",
            "reasoning": text[:100],
        }

    chosen = decision["choice"]
    reasoning = decision.get("reasoning", "")
    agent_ctx = r_ctx if chosen == "researcher" else w_ctx

    print(f"  [orchestrator] Round {state['round']}: EXPLOIT -> {chosen}")
    print(f"                 Reason: {reasoning}")

    return {
        **state,
        "chosen_agent": chosen,
        "explore_forced": False,
        "agent_context": agent_ctx,
    }

def agent_execute(state: TaskState) -> TaskState:
    """The chosen agent attempts the task. Quality varies by agent."""
    agent = state["chosen_agent"]

    prompt = f"""You are the {agent} agent. Complete this task concisely (1-2 sentences).
TASK: {state['task']}"""

    response = llm.invoke([
        SystemMessage(content=f"You are a {agent} agent. Be concise."),
        HumanMessage(content=prompt),
    ])

    output = response.content.strip()
    print(f"  [{agent}] Output: {output[:80]}...")

    return {
        **state,
        "agent_output": output,
    }

def evaluate_and_feedback(state: TaskState) -> TaskState:
    """Orchestrator evaluates the output quality and submits feedback."""
    agent = state["chosen_agent"]

    # LLM evaluates the quality
    prompt = f"""Rate the quality of this agent's output for the given task.

TASK: {state['task']}
AGENT: {agent}
OUTPUT: {state['agent_output']}

Respond with ONLY a JSON object: {{"score": 0.0 to 1.0, "result": "success" or "failure", "reason": "one sentence"}}
Score > 0.6 = success, <= 0.6 = failure."""

    response = llm.invoke([
        SystemMessage(content="You are a quality evaluator. Be honest and critical."),
        HumanMessage(content=prompt),
    ])

    text = response.content.strip()
    try:
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        evaluation = json.loads(text)
    except json.JSONDecodeError:
        evaluation = {"score": 0.5, "result": "partial", "reason": text[:100]}

    score = float(evaluation.get("score", 0.5))
    result = evaluation.get("result", "partial")
    reason = evaluation.get("reason", "")

    # Clamp reward to [-1, 1]
    reward = max(-1.0, min(1.0, score * 2 - 1))  # map 0-1 to -1 to 1

    # Submit feedback to Agent Trust API
    agent_info = get_agent(agent)
    did = agent_info.get("did", "")

    if did:
        feedback("orchestrator", did, "task", result, reward, reason)

    print(f"  [evaluator] Score: {score:.2f}, Result: {result}, Reward: {reward:.2f}")
    print(f"              Reason: {reason}")

    return {
        **state,
        "quality_score": score,
        "feedback_submitted": True,
    }

# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------

graph = StateGraph(TaskState)
graph.add_node("decide", orchestrator_decide)
graph.add_node("execute", agent_execute)
graph.add_node("evaluate", evaluate_and_feedback)

graph.add_edge(START, "decide")
graph.add_edge("decide", "execute")
graph.add_edge("execute", "evaluate")
graph.add_edge("evaluate", END)

app = graph.compile()

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

TASKS = [
    "Research the top 3 competitors in the AI agent infrastructure space and summarize their key features",
    "Write a technical blog post introduction about deterministic identity resolution for AI agents",
    "Analyze the pricing models of Langfuse, AgentOps, and Traccia - which is most developer-friendly?",
    "Write documentation for a REST API endpoint that returns agent reputation scores",
    "Research what W3C DID standards say about key rotation and summarize the implications for agent systems",
]

def main():
    # Register agents
    print("=== Registering agents ===")
    register("orchestrator", "did:key:z6MkOrchDemo001", ["delegate", "evaluate"], "Orchestration agent")
    register("researcher", "did:key:z6MkResDemo001", ["search", "analyze", "research"], "Research agent")
    register("writer", "did:key:z6MkWriteDemo001", ["write", "summarize", "document"], "Writing agent")
    print()

    total = len(TASKS)
    choices = {"researcher": 0, "writer": 0}
    explores = 0

    for i, task in enumerate(TASKS):
        print(f"=== Round {i+1}/{total} ===")
        print(f"  Task: {task[:70]}...")
        print()

        result = app.invoke({
            "task": task,
            "round": i + 1,
            "total_rounds": total,
            "chosen_agent": "",
            "explore_forced": False,
            "agent_context": "",
            "agent_output": "",
            "quality_score": 0.0,
            "feedback_submitted": False,
        })

        choices[result["chosen_agent"]] += 1
        if result["explore_forced"]:
            explores += 1
        print()

    # Final summary
    print("=== Final Agent States ===")
    for name in ["researcher", "writer"]:
        info = get_agent(name)
        ctx = info.get("rl_context", {})
        summary = ctx.get("summary", {})
        ucb = ucb_score(summary, total)
        print(f"  {name}:")
        print(f"    Delegated to: {choices[name]} times")
        print(f"    Success rate: {summary.get('success_rate', 'N/A')}")
        print(f"    Avg reward: {summary.get('avg_reward', 'N/A')}")
        print(f"    Trend: {summary.get('recent_trend', 'N/A')}")
        print(f"    Judged: {summary.get('judged', 0)}")
        print(f"    UCB score: {ucb:.3f}")
    print(f"\n  Exploration rounds: {explores}/{total}")
    print()

if __name__ == "__main__":
    main()
