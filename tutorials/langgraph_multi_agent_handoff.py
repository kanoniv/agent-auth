"""
Tutorial: Multi-Agent Handoff with Scoped Authority
====================================================

LangGraph agents can call tools. But tools cannot verify who the agent
is, whether it is authorized, or what budget it has.

This tutorial adds cryptographic delegation to LangGraph workflows.
Each specialist node is gated by a single decorator:

    @requires_delegation(actions=["draft"], require_cost=True)
    def draft_node(state):
        ...

Delegation chain:

    Human
      |
      +-- Coordinator (max $10)
            |
            +-- Researcher (search, summarize | $5)
            +-- Writer (draft, edit | $3)
            +-- Reviewer (review | $1)

The graph uses conditional routing to hand off between specialists.
If an agent lacks authority, the graph routes to an error handler
instead of proceeding.

Run:
    pip install kanoniv-agent-auth langgraph
    python tutorials/langgraph_multi_agent_handoff.py
"""

import json
import functools
from typing import Any

from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

from kanoniv_agent_auth import (
    AgentKeyPair,
    Delegation,
    Invocation,
    verify_invocation,
)


# ---------------------------------------------------------------------------
# DelegationContext + @requires_delegation (from integrations/langgraph_auth)
# ---------------------------------------------------------------------------

class DelegationContext:
    """Holds delegation state for a LangGraph execution."""

    def __init__(self, agent_keypair, delegation, root_identity):
        self.agent_keypair = agent_keypair
        self.delegation = delegation
        self.root_identity = root_identity
        self.invocations = []


def requires_delegation(actions=None, require_cost=False, require_resource=False):
    """Decorator: gate a LangGraph node behind delegation verification."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(state):
            ctx = state.get("delegation_context")
            if ctx is None:
                return {**state, "error": "No delegation context."}

            action = state.get("action", func.__name__)
            args = state.get("args", {})

            if require_cost and "cost" not in args:
                return {**state, "error": f"Node '{action}' requires 'cost' in args."}
            if require_resource and "resource" not in args:
                return {**state, "error": f"Node '{action}' requires 'resource' in args."}

            try:
                invocation = Invocation.create(ctx.agent_keypair, action, json.dumps(args), ctx.delegation)
                result = verify_invocation(invocation, ctx.agent_keypair.identity(), ctx.root_identity)
                ctx.invocations.append({"action": action, "chain": result[2], "depth": result[3]})
            except ValueError as e:
                return {**state, "error": f"Delegation denied: {e}"}

            return func(state)

        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Step 1: Define the graph state
# ---------------------------------------------------------------------------
# LangGraph nodes communicate through a typed state dict. We include
# delegation_context so every node can verify its authority, plus fields
# for data flowing through the pipeline.

class PipelineState(TypedDict, total=False):
    # Delegation fields
    delegation_context: Any
    action: str
    args: dict
    error: str
    # Pipeline data
    search_results: list[str]
    summary: str
    draft: str
    final_draft: str
    review_status: str
    review_notes: str
    # Routing
    current_phase: str


# ---------------------------------------------------------------------------
# Step 2: Create identities and delegation chains
# ---------------------------------------------------------------------------

def setup_agents():
    """Create keypairs and delegation chains for all agents."""
    human = AgentKeyPair.generate()
    coordinator = AgentKeyPair.generate()
    researcher = AgentKeyPair.generate()
    writer = AgentKeyPair.generate()
    reviewer = AgentKeyPair.generate()

    print("Identities:")
    print(f"  Human (root):   {human.identity().did}")
    print(f"  Coordinator:    {coordinator.identity().did}")
    print(f"  Researcher:     {researcher.identity().did}")
    print(f"  Writer:         {writer.identity().did}")
    print(f"  Reviewer:       {reviewer.identity().did}")

    # Human -> Coordinator: broad authority
    coordinator_del = Delegation.create_root(
        human,
        coordinator.identity().did,
        json.dumps([
            {"type": "action_scope", "value": [
                "search", "summarize", "draft", "edit", "review",
            ]},
            {"type": "max_cost", "value": 10.0},
        ]),
    )
    print("\nDelegation chains:")
    print("  Human -> Coordinator: search, summarize, draft, edit, review (max $10)")

    # Coordinator -> Researcher: narrow
    researcher_del = Delegation.delegate(
        coordinator, researcher.identity().did,
        json.dumps([
            {"type": "action_scope", "value": ["search", "summarize"]},
            {"type": "max_cost", "value": 5.0},
        ]),
        coordinator_del,
    )
    print("  Coordinator -> Researcher: search, summarize (max $5)")

    # Coordinator -> Writer: narrow
    writer_del = Delegation.delegate(
        coordinator, writer.identity().did,
        json.dumps([
            {"type": "action_scope", "value": ["draft", "edit"]},
            {"type": "max_cost", "value": 3.0},
        ]),
        coordinator_del,
    )
    print("  Coordinator -> Writer: draft, edit (max $3)")

    # Coordinator -> Reviewer: narrowest
    reviewer_del = Delegation.delegate(
        coordinator, reviewer.identity().did,
        json.dumps([
            {"type": "action_scope", "value": ["review"]},
            {"type": "max_cost", "value": 1.0},
        ]),
        coordinator_del,
    )
    print("  Coordinator -> Reviewer: review (max $1)")

    return {
        "human": human,
        "coordinator": coordinator,
        "researcher": (researcher, researcher_del),
        "writer": (writer, writer_del),
        "reviewer": (reviewer, reviewer_del),
    }


# ---------------------------------------------------------------------------
# Step 3: Define graph nodes
# ---------------------------------------------------------------------------
# Each specialist node is gated by @requires_delegation. The decorator
# verifies the invocation against the delegation chain before the node
# body executes. If denied, it sets state["error"] instead.

@requires_delegation(actions=["search"], require_cost=True)
def search_node(state: PipelineState) -> PipelineState:
    """Researcher searches for information."""
    query = state["args"].get("query", "")
    print(f"    [search] Querying: '{query}'")
    return {
        **state,
        "search_results": [
            f"Result 1 for '{query}'",
            f"Result 2 for '{query}'",
            f"Result 3 for '{query}'",
        ],
        "current_phase": "summarize",
    }


@requires_delegation(actions=["summarize"])
def summarize_node(state: PipelineState) -> PipelineState:
    """Researcher summarizes search results."""
    results = state.get("search_results", [])
    topic = state["args"].get("topic", "topic")
    print(f"    [summarize] Condensing {len(results)} results")
    return {
        **state,
        "summary": f"Summary of {len(results)} findings on '{topic}'",
        "current_phase": "draft",
    }


@requires_delegation(actions=["draft"], require_cost=True)
def draft_node(state: PipelineState) -> PipelineState:
    """Writer drafts content based on summary."""
    summary = state.get("summary", "")
    print(f"    [draft] Writing based on: {summary[:50]}...")
    return {
        **state,
        "draft": f"Draft article based on: {summary}",
        "current_phase": "edit",
    }


@requires_delegation(actions=["edit"])
def edit_node(state: PipelineState) -> PipelineState:
    """Writer edits the draft."""
    draft = state.get("draft", "")
    print(f"    [edit] Polishing draft ({len(draft)} chars)")
    return {
        **state,
        "final_draft": f"[Edited] {draft}",
        "current_phase": "review",
    }


@requires_delegation(actions=["review"])
def review_node(state: PipelineState) -> PipelineState:
    """Reviewer approves or rejects the final draft."""
    final = state.get("final_draft", "")
    print(f"    [review] Reviewing final draft ({len(final)} chars)")
    return {
        **state,
        "review_status": "approved",
        "review_notes": "Looks good. Clear and accurate.",
        "current_phase": "done",
    }


def error_node(state: PipelineState) -> PipelineState:
    """Handles delegation failures."""
    print(f"    [error] {state.get('error', 'Unknown error')}")
    return {**state, "current_phase": "done"}


# ---------------------------------------------------------------------------
# Step 4: Routing logic
# ---------------------------------------------------------------------------
# The coordinator node decides which specialist to hand off to based on
# current_phase. Each specialist sets the next phase after completing work.

def coordinator_node(state: PipelineState) -> PipelineState:
    """Coordinator routes to the appropriate specialist."""
    phase = state.get("current_phase", "search")
    print(f"  [coordinator] Routing to phase: {phase}")
    return {**state, "current_phase": phase}


def route_after_coordinator(state: PipelineState) -> str:
    """Conditional edge: route based on current phase."""
    phase = state.get("current_phase", "search")
    if phase in ("search", "summarize", "draft", "edit", "review"):
        return phase
    return "done"


def route_after_specialist(state: PipelineState) -> str:
    """After a specialist runs, check for errors or continue."""
    if "error" in state and state["error"]:
        return "error"
    return "coordinator"


# ---------------------------------------------------------------------------
# Step 5: Build the StateGraph
# ---------------------------------------------------------------------------

def build_graph():
    """Wire up the LangGraph StateGraph with delegation-gated nodes."""
    graph = StateGraph(PipelineState)

    # Add nodes
    graph.add_node("coordinator", coordinator_node)
    graph.add_node("search", search_node)
    graph.add_node("summarize", summarize_node)
    graph.add_node("draft", draft_node)
    graph.add_node("edit", edit_node)
    graph.add_node("review", review_node)
    graph.add_node("error", error_node)

    # Entry: start at coordinator
    graph.add_edge(START, "coordinator")

    # Coordinator routes to the right specialist
    graph.add_conditional_edges("coordinator", route_after_coordinator, {
        "search": "search",
        "summarize": "summarize",
        "draft": "draft",
        "edit": "edit",
        "review": "review",
        "done": END,
    })

    # Each specialist either loops back to coordinator or hits error
    for node in ("search", "summarize", "draft", "edit", "review"):
        graph.add_conditional_edges(node, route_after_specialist, {
            "coordinator": "coordinator",
            "error": "error",
        })

    # Error always ends
    graph.add_edge("error", END)

    return graph.compile()


# ---------------------------------------------------------------------------
# Step 6: Run the pipeline
# ---------------------------------------------------------------------------
# LangGraph doesn't have middleware hooks, so we step through phases
# manually, invoking the graph for each phase with the correct agent's
# delegation context injected before each call.

def run_pipeline(agents):
    """Execute the full pipeline, stepping through each phase."""
    human_id = agents["human"].identity()

    phase_to_agent = {
        "search": agents["researcher"],
        "summarize": agents["researcher"],
        "draft": agents["writer"],
        "edit": agents["writer"],
        "review": agents["reviewer"],
    }

    phase_actions = {
        "search": {"query": "cryptographic agent identity", "cost": 0.50},
        "summarize": {"topic": "cryptographic agent identity", "cost": 0.25},
        "draft": {"topic": "agent auth", "cost": 1.0},
        "edit": {"style": "concise", "cost": 0.50},
        "review": {"criteria": "accuracy", "cost": 0.25},
    }

    phase_order = ["search", "summarize", "draft", "edit", "review"]

    state: PipelineState = {}

    print("\n--- Running LangGraph Pipeline ---\n")

    for phase in phase_order:
        # Inject the correct agent's delegation context for this phase
        keypair, delegation = phase_to_agent[phase]
        ctx = DelegationContext(keypair, delegation, human_id)

        state = {
            **state,
            "current_phase": phase,
            "action": phase,
            "args": phase_actions[phase],
            "delegation_context": ctx,
            "error": "",
        }

        # Invoke the graph: coordinator -> specialist -> back to coordinator -> END
        app = build_graph()
        state = app.invoke(state)

        if state.get("error"):
            print(f"    Pipeline halted: {state['error']}")
            break

    return state


# ---------------------------------------------------------------------------
# Step 7: Test authority boundaries
# ---------------------------------------------------------------------------
# Run the graph with agents attempting actions outside their scope.

def test_boundary(agents, label, agent_key, action, args):
    """Run a single boundary test through the graph."""
    human_id = agents["human"].identity()
    keypair, delegation = agents[agent_key]
    ctx = DelegationContext(keypair, delegation, human_id)

    app = build_graph()

    state: PipelineState = {
        "current_phase": action,
        "action": action,
        "args": args,
        "delegation_context": ctx,
    }

    print(f"\n[{label}]")
    result = app.invoke(state)

    if "error" in result and result["error"]:
        print(f"    Correctly blocked: {result['error']}")
    else:
        print("    UNEXPECTED: action was allowed")


def test_boundaries(agents):
    print("\n--- Authority Boundary Tests ---")

    # Researcher tries to draft (not in scope)
    test_boundary(
        agents, "A: Researcher tries to draft", "researcher",
        "draft", {"topic": "sneaky draft", "cost": 1.0},
    )

    # Writer tries to search (not in scope)
    test_boundary(
        agents, "B: Writer tries to search", "writer",
        "search", {"query": "off limits", "cost": 0.5},
    )

    # Reviewer tries to edit (not in scope)
    test_boundary(
        agents, "C: Reviewer tries to edit", "reviewer",
        "edit", {"style": "verbose", "cost": 0.25},
    )

    # Writer exceeds budget ($5 > $3 max)
    test_boundary(
        agents, "D: Writer tries $5 draft (exceeds $3 budget)", "writer",
        "draft", {"topic": "expensive", "cost": 5.0},
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("Tutorial: Multi-Agent Handoff with Scoped Authority")
    print("=" * 60)

    agents = setup_agents()

    # Happy path: full pipeline through the graph
    state = run_pipeline(agents)

    print(f"\n  Final review: {state.get('review_status', 'N/A')}")
    print(f"  Notes: {state.get('review_notes', 'N/A')}")

    # Boundary tests: agents blocked outside their scope
    test_boundaries(agents)

    print("\n" + "=" * 60)
    print("Done. Every node was cryptographically verified via LangGraph.")
    print("=" * 60)
