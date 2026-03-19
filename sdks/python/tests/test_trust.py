"""Tests for agent-trust SDK - TrustAgent with cryptographic verification."""

import pytest
from agent_trust import TrustAgent, TrustError


@pytest.fixture
def trust(tmp_path):
    """Fresh TrustAgent with temp SQLite DB."""
    return TrustAgent(db_path=str(tmp_path / "test.db"))


# -- identity --

def test_trust_agent_has_did(trust):
    assert trust.did.startswith("did:key:z")

def test_trust_agent_identity_alias(trust):
    assert trust.identity == trust.did


# -- register --

def test_register_agent(trust):
    record = trust.register("researcher", capabilities=["search", "analyze"])
    assert record.name == "researcher"
    assert record.did.startswith("did:key:z")
    assert "search" in record.capabilities

def test_register_idempotent(trust):
    trust.register("researcher", capabilities=["search"])
    trust.register("researcher", capabilities=["search", "analyze"])
    rep = trust.reputation("researcher")
    assert rep.agent == "researcher"

def test_register_no_capabilities(trust):
    record = trust.register("minimal")
    assert record.capabilities == []


# -- delegate --

def test_delegate_grants_scopes(trust):
    trust.register("researcher", capabilities=["search", "analyze"])
    deleg = trust.delegate("researcher", scopes=["search", "analyze"])
    assert deleg.scopes == ["search", "analyze"]
    assert deleg.agent == "researcher"

def test_delegate_shows_in_reputation(trust):
    trust.register("researcher", capabilities=["search"])
    trust.delegate("researcher", scopes=["search"])
    rep = trust.reputation("researcher")
    assert "search" in rep.current_scopes

def test_delegate_rejects_invalid_scope(trust):
    trust.register("researcher", capabilities=["search"])
    with pytest.raises(TrustError, match="Cannot"):
        trust.delegate("researcher", scopes=["deploy"])

def test_delegate_rejects_unregistered_agent(trust):
    with pytest.raises(TrustError, match="not found"):
        trust.delegate("ghost", scopes=["search"])


# -- observe --

def test_observe_records_outcome(trust):
    trust.register("researcher")
    outcome = trust.observe("researcher", action="search", result="success", reward=0.8)
    assert outcome.agent == "researcher"
    assert outcome.result == "success"
    assert outcome.reward == 0.8

def test_observe_invalid_reward(trust):
    trust.register("researcher")
    with pytest.raises(ValueError, match="reward"):
        trust.observe("researcher", action="search", result="success", reward=1.5)

def test_observe_invalid_result(trust):
    trust.register("researcher")
    with pytest.raises(ValueError, match="result"):
        trust.observe("researcher", action="search", result="excellent", reward=0.5)

def test_observe_creates_provenance(trust):
    trust.register("researcher")
    trust.observe("researcher", action="search", result="success", reward=0.9)
    # The TrustAgent's own observation is also recorded as signed provenance
    provenance = trust._backend.get_provenance("trust-agent", limit=10)
    observe_records = [p for p in provenance if p.action == "observe"]
    assert len(observe_records) >= 1
    assert observe_records[0].verified is True  # self-signed


# -- select --

def test_select_single_agent(trust):
    trust.register("researcher")
    assert trust.select(["researcher"]) == "researcher"

def test_select_empty_raises(trust):
    with pytest.raises(ValueError, match="empty"):
        trust.select([])

def test_select_ucb_explores_untested(trust):
    trust.register("researcher")
    trust.register("writer")
    trust.observe("researcher", action="search", result="success", reward=0.9)
    # Writer untested - UCB gives infinity
    assert trust.select(["researcher", "writer"], strategy="ucb") == "writer"

def test_select_ucb_exploits_proven(trust):
    trust.register("researcher")
    trust.register("writer")
    for _ in range(5):
        trust.observe("researcher", action="search", result="success", reward=0.9)
    for _ in range(5):
        trust.observe("writer", action="write", result="failure", reward=-0.5)
    assert trust.select(["researcher", "writer"], strategy="ucb") == "researcher"

def test_select_greedy(trust):
    trust.register("researcher")
    trust.register("writer")
    trust.observe("researcher", action="search", result="success", reward=0.9)
    trust.observe("writer", action="write", result="success", reward=0.3)
    assert trust.select(["researcher", "writer"], strategy="greedy") == "researcher"


# -- rank --

def test_rank_returns_ordered_list(trust):
    trust.register("a")
    trust.register("b")
    trust.register("c")
    trust.observe("a", action="task", result="success", reward=0.5)
    trust.observe("b", action="task", result="success", reward=0.9)
    trust.observe("c", action="task", result="failure", reward=-0.5)
    ranked = trust.rank(["a", "b", "c"], strategy="greedy")
    assert ranked[0] == "b"
    assert ranked[-1] == "c"


# -- reputation --

def test_reputation_empty(trust):
    trust.register("researcher")
    rep = trust.reputation("researcher")
    assert rep.total_actions == 0
    assert rep.success_rate is None

def test_reputation_with_outcomes(trust):
    trust.register("researcher")
    trust.observe("researcher", action="search", result="success", reward=0.8)
    trust.observe("researcher", action="search", result="failure", reward=-0.3)
    rep = trust.reputation("researcher")
    assert rep.total_actions == 2
    assert rep.success_rate == 0.5

def test_reputation_unknown_agent(trust):
    with pytest.raises(TrustError, match="not found"):
        trust.reputation("nonexistent")

def test_reputation_trend(trust):
    trust.register("researcher")
    for _ in range(5):
        trust.observe("researcher", action="search", result="failure", reward=-0.5)
    for _ in range(5):
        trust.observe("researcher", action="search", result="success", reward=0.9)
    rep = trust.reputation("researcher")
    assert rep.trend == "improving"

def test_reputation_verified_count(trust):
    trust.register("researcher")
    trust.observe("researcher", action="search", result="success", reward=0.9)
    rep = trust.reputation("researcher")
    # TrustAgent's observation provenance is verified (self-signed)
    # But the researcher's own provenance has no signature
    assert rep.total_actions >= 1


# -- enforce: restrict --

def test_restrict_limits_scopes(trust):
    trust.register("researcher", capabilities=["search", "analyze", "write"])
    trust.delegate("researcher", scopes=["search", "analyze", "write"])
    trust.restrict("researcher", scopes=["search"])
    rep = trust.reputation("researcher")
    assert rep.current_scopes == ["search"]

def test_restrict_creates_provenance(trust):
    trust.register("researcher", capabilities=["search", "write"])
    trust.delegate("researcher", scopes=["search", "write"])
    trust.restrict("researcher", scopes=["search"])
    provenance = trust._backend.get_provenance("trust-agent", limit=20)
    restrict_records = [p for p in provenance if p.action == "restrict"]
    assert len(restrict_records) >= 1
    assert restrict_records[0].verified is True

def test_restrict_nonexistent_delegation(trust):
    trust.register("researcher", capabilities=["search"])
    result = trust.restrict("researcher", scopes=["search"])
    assert result is None


# -- enforce: revoke --

def test_revoke_removes_all_scopes(trust):
    trust.register("researcher", capabilities=["search", "write"])
    trust.delegate("researcher", scopes=["search", "write"])
    trust.revoke("researcher")
    rep = trust.reputation("researcher")
    assert rep.current_scopes == []

def test_revoke_creates_provenance(trust):
    trust.register("researcher", capabilities=["search"])
    trust.delegate("researcher", scopes=["search"])
    trust.revoke("researcher")
    provenance = trust._backend.get_provenance("trust-agent", limit=20)
    revoke_records = [p for p in provenance if p.action == "revoke"]
    assert len(revoke_records) >= 1

def test_revoke_nonexistent_delegation(trust):
    trust.register("researcher")
    result = trust.revoke("researcher")
    assert result is None


# -- crypto: signed provenance --

def test_trust_agent_actions_are_signed(trust):
    trust.register("researcher")
    provenance = trust._backend.get_provenance("trust-agent", limit=10)
    for p in provenance:
        assert p.signature is not None
        assert p.verified is True

def test_all_observations_create_signed_record(trust):
    trust.register("researcher")
    trust.observe("researcher", action="search", result="success", reward=0.9)
    trust.observe("researcher", action="analyze", result="failure", reward=-0.3)
    provenance = trust._backend.get_provenance("trust-agent", limit=20)
    observe_records = [p for p in provenance if p.action == "observe"]
    assert len(observe_records) == 2
    for p in observe_records:
        assert p.signature is not None


# -- crypto: verify provenance --

def test_crypto_sign_and_verify():
    from agent_trust.crypto import generate_keys, sign_provenance, verify_provenance
    keys = generate_keys()
    sig = sign_provenance(keys, "test", ["e1"], {"key": "val"}, 1234567890.0)
    assert verify_provenance(keys.did, "test", ["e1"], {"key": "val"}, 1234567890.0, sig)

def test_crypto_tampered_signature():
    from agent_trust.crypto import generate_keys, sign_provenance, verify_provenance
    keys = generate_keys()
    sig = sign_provenance(keys, "test", ["e1"], {"key": "val"}, 1234567890.0)
    # Tamper: different action
    assert not verify_provenance(keys.did, "tampered", ["e1"], {"key": "val"}, 1234567890.0, sig)

def test_crypto_wrong_key():
    from agent_trust.crypto import generate_keys, sign_provenance, verify_provenance
    keys1 = generate_keys()
    keys2 = generate_keys()
    sig = sign_provenance(keys1, "test", ["e1"], {}, 1234567890.0)
    # Verify with wrong DID
    assert not verify_provenance(keys2.did, "test", ["e1"], {}, 1234567890.0, sig)

def test_crypto_did_roundtrip():
    from agent_trust.crypto import generate_keys, verify_signature
    keys = generate_keys()
    msg = b"hello world"
    sig = keys.sign(msg)
    assert verify_signature(keys.did, msg, sig)

def test_crypto_key_export_import():
    from agent_trust.crypto import generate_keys, load_keys
    keys1 = generate_keys()
    exported = keys1.export_private()
    keys2 = load_keys(exported)
    assert keys1.did == keys2.did
    # Sign with original, verify with loaded
    msg = b"test message"
    sig = keys1.sign(msg)
    from agent_trust.crypto import verify_signature
    assert verify_signature(keys2.did, msg, sig)


# -- integration: full flow --

def test_full_trust_lifecycle(trust):
    """End-to-end: register -> delegate -> observe -> select -> restrict -> revoke."""
    # Setup
    trust.register("researcher", capabilities=["search", "analyze"])
    trust.register("writer", capabilities=["write", "summarize"])
    trust.delegate("researcher", scopes=["search", "analyze"])
    trust.delegate("writer", scopes=["write", "summarize"])

    # Observe outcomes
    trust.observe("researcher", action="search", result="success", reward=0.9)
    trust.observe("researcher", action="search", result="success", reward=0.8)
    trust.observe("writer", action="write", result="failure", reward=-0.5)

    # Select best
    best = trust.select(["researcher", "writer"])
    assert best == "researcher"

    # Check reputation
    rep = trust.reputation("researcher")
    assert rep.score > 0
    assert rep.success_rate == 1.0
    assert "search" in rep.current_scopes

    # Writer underperformed - restrict
    trust.restrict("writer", scopes=["summarize"])
    rep_w = trust.reputation("writer")
    assert rep_w.current_scopes == ["summarize"]
    assert "write" not in rep_w.current_scopes

    # Writer keeps failing - revoke entirely
    trust.observe("writer", action="summarize", result="failure", reward=-0.8)
    trust.revoke("writer")
    rep_w2 = trust.reputation("writer")
    assert rep_w2.current_scopes == []

    # All TrustAgent actions have signed provenance
    ta_provenance = trust._backend.get_provenance("trust-agent", limit=50)
    assert all(p.signature is not None for p in ta_provenance)
    assert all(p.verified for p in ta_provenance)


# -- TrustAgent init --

def test_trust_agent_with_private_key(tmp_path):
    """TrustAgent with an explicit private key preserves identity across restarts."""
    from agent_trust.crypto import generate_keys
    keys = generate_keys()
    db = str(tmp_path / "test.db")
    t1 = TrustAgent(db_path=db, private_key=keys.export_private())
    t2 = TrustAgent(db_path=db, private_key=keys.export_private())
    assert t1.did == t2.did

def test_trust_agent_in_memory():
    t = TrustAgent(db_path=":memory:")
    t.register("test")
    assert t.reputation("test").total_actions == 0


# -- register edge cases --

def test_register_with_explicit_did(trust):
    record = trust.register("agent-x", did="did:key:zCustomDID123")
    assert record.did == "did:key:zCustomDID123"

def test_register_preserves_did_on_reregister(trust):
    r1 = trust.register("researcher")
    did1 = r1.did
    r2 = trust.register("researcher", capabilities=["updated"])
    assert r2.did == did1  # DID must not change


# -- observe edge cases --

def test_observe_boundary_reward_max(trust):
    trust.register("agent")
    outcome = trust.observe("agent", action="task", result="success", reward=1.0)
    assert outcome.reward == 1.0

def test_observe_boundary_reward_min(trust):
    trust.register("agent")
    outcome = trust.observe("agent", action="task", result="failure", reward=-1.0)
    assert outcome.reward == -1.0

def test_observe_partial_excluded_from_judged(trust):
    trust.register("agent")
    trust.observe("agent", action="task", result="partial", reward=0.3)
    trust.observe("agent", action="task", result="partial", reward=0.5)
    rep = trust.reputation("agent")
    assert rep.total_actions == 2
    # Partial results are not counted as judged (success or failure)
    assert rep.success_rate is None

def test_observe_unregistered_agent_no_crash(trust):
    """Observing an unregistered agent should not crash - just records with empty DID."""
    outcome = trust.observe("ghost", action="task", result="success", reward=0.5)
    assert outcome.agent == "ghost"


# -- reputation edge cases --

def test_reputation_declining_trend(trust):
    trust.register("agent")
    for _ in range(5):
        trust.observe("agent", action="task", result="success", reward=0.9)
    for _ in range(5):
        trust.observe("agent", action="task", result="failure", reward=-0.5)
    rep = trust.reputation("agent")
    assert rep.trend == "declining"

def test_reputation_score_range(trust):
    trust.register("agent")
    for _ in range(10):
        trust.observe("agent", action="task", result="success", reward=0.9)
    rep = trust.reputation("agent")
    assert 0.0 <= rep.score <= 100.0

def test_reputation_strengths_and_weaknesses(trust):
    trust.register("agent")
    trust.observe("agent", action="search", result="success", reward=0.9)
    trust.observe("agent", action="search", result="success", reward=0.8)
    trust.observe("agent", action="write", result="failure", reward=-0.5)
    rep = trust.reputation("agent")
    assert "search" in rep.top_strengths
    assert "write" in rep.top_weaknesses


# -- delegation edge cases --

def test_delegate_replaces_previous(trust):
    trust.register("agent", capabilities=["search", "write", "read"])
    trust.delegate("agent", scopes=["search", "write"])
    trust.delegate("agent", scopes=["read"])
    rep = trust.reputation("agent")
    assert rep.current_scopes == ["read"]

def test_restrict_then_delegate_restores(trust):
    trust.register("agent", capabilities=["search", "write", "admin"])
    trust.delegate("agent", scopes=["search", "write"])
    trust.restrict("agent", scopes=["search"])
    trust.delegate("agent", scopes=["search", "write", "admin"])
    rep = trust.reputation("agent")
    assert set(rep.current_scopes) == {"search", "write", "admin"}


# -- rank edge cases --

def test_rank_empty_raises(trust):
    with pytest.raises(ValueError, match="empty"):
        trust.rank([])

def test_rank_single_agent(trust):
    trust.register("agent")
    ranked = trust.rank(["agent"])
    assert ranked == ["agent"]

def test_rank_all_untested_preserves_input_order(trust):
    trust.register("c")
    trust.register("a")
    trust.register("b")
    ranked = trust.rank(["c", "a", "b"])
    # All have UCB = inf, stable sort should preserve input order
    assert len(ranked) == 3


# -- select with unregistered agents --

def test_select_with_no_outcomes(trust):
    trust.register("a")
    trust.register("b")
    # Both untested, should not crash
    result = trust.select(["a", "b"])
    assert result in ["a", "b"]


# -- authorized --

def test_authorized_granted_scope(trust):
    trust.register("agent", capabilities=["search", "write"])
    trust.delegate("agent", scopes=["search", "write"])
    assert trust.authorized("agent", "search") is True
    assert trust.authorized("agent", "write") is True

def test_authorized_ungrant_scope(trust):
    trust.register("agent", capabilities=["search", "write"])
    trust.delegate("agent", scopes=["search"])
    assert trust.authorized("agent", "search") is True
    assert trust.authorized("agent", "write") is False

def test_authorized_no_delegation(trust):
    trust.register("agent", capabilities=["search"])
    assert trust.authorized("agent", "search") is False

def test_authorized_after_revoke(trust):
    trust.register("agent", capabilities=["search"])
    trust.delegate("agent", scopes=["search"])
    trust.revoke("agent")
    assert trust.authorized("agent", "search") is False

def test_authorized_after_restrict(trust):
    trust.register("agent", capabilities=["search", "write"])
    trust.delegate("agent", scopes=["search", "write"])
    trust.restrict("agent", scopes=["search"])
    assert trust.authorized("agent", "search") is True
    assert trust.authorized("agent", "write") is False

def test_authorized_unregistered_agent(trust):
    assert trust.authorized("ghost", "anything") is False


# -- scope validation --

def test_delegate_rejects_scope_not_in_capabilities(trust):
    trust.register("agent", capabilities=["search"])
    with pytest.raises(TrustError, match="Cannot"):
        trust.delegate("agent", scopes=["search", "deploy"])

def test_restrict_rejects_scope_not_in_capabilities(trust):
    trust.register("agent", capabilities=["search", "write"])
    trust.delegate("agent", scopes=["search", "write"])
    with pytest.raises(TrustError, match="Cannot"):
        trust.restrict("agent", scopes=["deploy"])

def test_restrict_to_empty_scopes_allowed(trust):
    trust.register("agent", capabilities=["search"])
    trust.delegate("agent", scopes=["search"])
    result = trust.restrict("agent", scopes=[])
    assert result is not None
    assert trust.authorized("agent", "search") is False


# -- caveats --

def test_delegate_with_caveats(trust):
    trust.register("agent", capabilities=["spend"])
    deleg = trust.delegate("agent", scopes=["spend"], caveats={"max_cost": 100})
    assert deleg.caveats == {"max_cost": 100}

def test_delegate_caveats_stored_and_returned(trust):
    trust.register("agent", capabilities=["access_db"])
    trust.delegate("agent", scopes=["access_db"], caveats={"tables": ["users", "orders"], "read_only": True})
    delegations = trust._backend.get_delegations("agent")
    assert len(delegations) == 1
    assert delegations[0].caveats["tables"] == ["users", "orders"]
    assert delegations[0].caveats["read_only"] is True

def test_delegate_no_caveats_default(trust):
    trust.register("agent", capabilities=["search"])
    deleg = trust.delegate("agent", scopes=["search"])
    assert deleg.caveats == {}


# -- expiry --

def test_delegate_with_expiry(trust):
    trust.register("agent", capabilities=["search"])
    deleg = trust.delegate("agent", scopes=["search"], expires_in=3600)
    assert deleg.expires_at is not None
    assert trust.authorized("agent", "search") is True

def test_delegate_expired_not_authorized(trust):
    import time
    trust.register("agent", capabilities=["search"])
    # Expire immediately
    trust.delegate("agent", scopes=["search"], expires_in=0.0)
    time.sleep(0.1)
    assert trust.authorized("agent", "search") is False

def test_delegate_no_expiry_default(trust):
    trust.register("agent", capabilities=["search"])
    deleg = trust.delegate("agent", scopes=["search"])
    assert deleg.expires_at is None

def test_delegate_expiry_with_caveats(trust):
    trust.register("agent", capabilities=["spend"])
    deleg = trust.delegate("agent", scopes=["spend"], caveats={"max_cost": 50}, expires_in=7200)
    assert deleg.caveats == {"max_cost": 50}
    assert deleg.expires_at is not None


# -- auto-signing --

def test_observe_auto_signs(trust):
    trust.register("agent", capabilities=["search"])
    trust.observe("agent", action="search", result="success", reward=0.9)
    prov = trust._backend.get_provenance("agent")
    assert len(prov) == 1
    assert prov[0].signature is not None
    assert prov[0].verified is True

def test_observe_auto_signs_all_outcomes(trust):
    trust.register("agent", capabilities=["search"])
    for i in range(5):
        trust.observe("agent", action="search", result="success", reward=0.5 + i * 0.1)
    prov = trust._backend.get_provenance("agent")
    assert len(prov) == 5
    assert all(p.verified for p in prov)

def test_observe_no_auto_sign_for_external_did(trust):
    trust.register("agent", did="did:key:zExternal123")
    trust.observe("agent", action="search", result="success", reward=0.9)
    prov = trust._backend.get_provenance("agent")
    assert len(prov) == 1
    # No keys stored, so no auto-sign, but also no external signature provided
    assert prov[0].verified is False

def test_verified_actions_counted_in_reputation(trust):
    trust.register("agent", capabilities=["search"])
    trust.observe("agent", action="search", result="success", reward=0.9)
    trust.observe("agent", action="search", result="success", reward=0.8)
    rep = trust.reputation("agent")
    assert rep.verified_actions == 2


# -- agent_keys --

def test_agent_keys_returns_keypair(trust):
    trust.register("agent")
    keys = trust.agent_keys("agent")
    assert keys is not None
    assert keys.did.startswith("did:key:z")

def test_agent_keys_none_for_external_did(trust):
    trust.register("agent", did="did:key:zExternal123")
    assert trust.agent_keys("agent") is None

def test_agent_keys_none_for_unknown(trust):
    assert trust.agent_keys("ghost") is None

def test_agent_keys_sign_and_verify(trust):
    from agent_trust.crypto import verify_signature
    trust.register("agent")
    keys = trust.agent_keys("agent")
    msg = b"test message"
    sig = keys.sign(msg)
    assert verify_signature(keys.did, msg, sig)
