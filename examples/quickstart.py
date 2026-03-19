"""
Agent Trust Quickstart - Zero dependencies, zero infra.

pip install kanoniv-trust
python quickstart.py
"""
from agent_trust import TrustAgent

# Create a trust orchestrator (SQLite, in-memory for this demo)
trust = TrustAgent(db_path=":memory:")
print(f"TrustAgent DID: {trust.did}\n")

# --- Register agents with verified identity (Ed25519 DIDs) ---
researcher = trust.register("researcher", capabilities=["search", "analyze"])
writer = trust.register("writer", capabilities=["draft", "edit"])
print(f"Researcher: {researcher.did}")
print(f"Writer:     {writer.did}\n")

# --- Grant scoped delegation ---
trust.delegate("researcher", scopes=["search", "analyze"])
trust.delegate("writer", scopes=["draft", "edit"])
print("Delegations granted.\n")

# --- Simulate work: researcher is reliable, writer struggles ---
outcomes = [
    ("researcher", "search",  "success", 0.9),
    ("researcher", "search",  "success", 0.8),
    ("researcher", "analyze", "success", 0.7),
    ("writer",     "draft",   "failure", 0.1),
    ("writer",     "draft",   "success", 0.6),
    ("writer",     "edit",    "failure", 0.2),
]

for agent, action, result, reward in outcomes:
    trust.observe(agent, action=action, result=result, reward=reward)

print("Recorded 6 outcomes with signed provenance.\n")

# --- Check reputation ---
for name in ["researcher", "writer"]:
    rep = trust.reputation(name)
    print(f"{name}:")
    print(f"  Score:        {rep.score:.0f}/100")
    print(f"  Success rate: {rep.success_rate:.0%}")
    print(f"  Avg reward:   {rep.avg_reward:.2f}")
    print(f"  Trend:        {rep.trend}")
    print(f"  Strengths:    {rep.top_strengths}")
    print(f"  Weaknesses:   {rep.top_weaknesses}")
    print()

# --- Trust-based selection (UCB) ---
best = trust.select(["researcher", "writer"], strategy="ucb")
print(f"UCB selected: {best}")

ranking = trust.rank(["researcher", "writer"])
print(f"Full ranking: {ranking}\n")

# --- Enforce: restrict the underperformer ---
trust.restrict("writer", scopes=["edit"])
print("Writer restricted to [edit] only - no more drafting.\n")

# --- Revoke entirely if needed ---
trust.revoke("writer")
print("Writer delegation revoked entirely.")
print("\nDone. Every action above was signed with Ed25519 and anchored to a DID.")
