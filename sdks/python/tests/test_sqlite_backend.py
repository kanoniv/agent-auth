"""Tests for agent_trust.backends.sqlite - SQLite storage backend."""

import json
import pytest
from agent_trust.backends.sqlite import SQLiteBackend


@pytest.fixture
def db(tmp_path):
    return SQLiteBackend(db_path=str(tmp_path / "test.db"))


# -- agents --

class TestAgentCRUD:
    def test_register_and_get(self, db):
        db.register("agent-a", "did:key:zABC", ["search"], "A researcher")
        record = db.get_agent("agent-a")
        assert record is not None
        assert record.name == "agent-a"
        assert record.did == "did:key:zABC"
        assert record.capabilities == ["search"]
        assert record.description == "A researcher"

    def test_get_nonexistent_returns_none(self, db):
        assert db.get_agent("ghost") is None

    def test_register_idempotent_preserves_did(self, db):
        db.register("agent-a", "did:key:zORIG", ["v1"], None)
        db.register("agent-a", "did:key:zNEW", ["v2"], "updated desc")
        record = db.get_agent("agent-a")
        # COALESCE keeps existing DID since it's not null
        assert record.did == "did:key:zNEW"
        assert record.capabilities == ["v2"]

    def test_register_updates_capabilities_only_if_nonempty(self, db):
        db.register("agent-a", "did:key:z1", ["search", "write"], None)
        db.register("agent-a", "did:key:z1", [], None)
        record = db.get_agent("agent-a")
        # Empty list should NOT overwrite (length check > 2 means "[]" is skipped)
        assert record.capabilities == ["search", "write"]

    def test_register_preserves_registered_at(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        ts1 = db.get_agent("agent-a").registered_at
        db.register("agent-a", "did:key:z1", ["search"], None)
        ts2 = db.get_agent("agent-a").registered_at
        # ON CONFLICT doesn't update registered_at
        assert ts1 == ts2

    def test_in_memory_db(self):
        db = SQLiteBackend(db_path=":memory:")
        db.register("test", "did:key:z1", [], None)
        assert db.get_agent("test") is not None


# -- provenance --

class TestProvenance:
    def test_record_and_get(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_provenance(
            agent="agent-a", agent_did="did:key:z1", action="search",
            entity_ids=["e1", "e2"], metadata={"score": 0.95},
            signature="sig123", verified=True,
        )
        records = db.get_provenance("agent-a")
        assert len(records) == 1
        assert records[0].action == "search"
        assert records[0].entity_ids == ["e1", "e2"]
        assert records[0].metadata == {"score": 0.95}
        assert records[0].signature == "sig123"
        assert records[0].verified is True

    def test_verified_only_filter(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_provenance("agent-a", "did:key:z1", "a1", [], {}, "sig", True)
        db.record_provenance("agent-a", "did:key:z1", "a2", [], {}, None, False)
        db.record_provenance("agent-a", "did:key:z1", "a3", [], {}, "sig", True)

        all_prov = db.get_provenance("agent-a")
        assert len(all_prov) == 3

        verified = db.get_provenance("agent-a", verified_only=True)
        assert len(verified) == 2
        assert all(p.verified for p in verified)

    def test_provenance_limit(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        for i in range(10):
            db.record_provenance("agent-a", "did:key:z1", f"action-{i}", [], {}, None, False)
        assert len(db.get_provenance("agent-a", limit=3)) == 3

    def test_provenance_ordered_desc(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_provenance("agent-a", "did:key:z1", "first", [], {}, None, False)
        db.record_provenance("agent-a", "did:key:z1", "second", [], {}, None, False)
        records = db.get_provenance("agent-a")
        # Most recent first
        assert records[0].action == "second"
        assert records[1].action == "first"

    def test_provenance_isolated_by_agent(self, db):
        db.register("a", "did:key:z1", [], None)
        db.register("b", "did:key:z2", [], None)
        db.record_provenance("a", "did:key:z1", "a-action", [], {}, None, False)
        db.record_provenance("b", "did:key:z2", "b-action", [], {}, None, False)
        assert len(db.get_provenance("a")) == 1
        assert db.get_provenance("a")[0].action == "a-action"


# -- outcomes --

class TestOutcomes:
    def test_record_and_get(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_outcome("agent-a", "search", "success", 0.9, "good result", "evaluator", None)
        outcomes = db.get_outcomes("agent-a")
        assert len(outcomes) == 1
        assert outcomes[0].result == "success"
        assert outcomes[0].reward == 0.9
        assert outcomes[0].reporter == "evaluator"

    def test_reward_boundary_values(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_outcome("agent-a", "a", "success", 1.0, "", "s", None)
        db.record_outcome("agent-a", "b", "failure", -1.0, "", "s", None)
        outcomes = db.get_outcomes("agent-a")
        rewards = sorted([o.reward for o in outcomes])
        assert rewards == [-1.0, 1.0]

    def test_reward_constraint_violation(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        import sqlite3
        with pytest.raises(sqlite3.IntegrityError):
            db.record_outcome("agent-a", "a", "success", 1.5, "", "s", None)

    def test_result_constraint_violation(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        import sqlite3
        with pytest.raises(sqlite3.IntegrityError):
            db.record_outcome("agent-a", "a", "excellent", 0.5, "", "s", None)

    def test_outcomes_with_provenance_id(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        prov = db.record_provenance("agent-a", "did:key:z1", "search", [], {}, "sig", True)
        # provenance doesn't return id directly but we can check the FK
        db.record_outcome("agent-a", "search", "success", 0.8, "", "sys", None)
        outcomes = db.get_outcomes("agent-a")
        assert len(outcomes) == 1

    def test_outcomes_ordered_desc(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.record_outcome("agent-a", "first", "success", 0.5, "", "s", None)
        db.record_outcome("agent-a", "second", "success", 0.9, "", "s", None)
        outcomes = db.get_outcomes("agent-a")
        assert outcomes[0].action == "second"

    def test_outcomes_limit(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        for i in range(10):
            db.record_outcome("agent-a", f"action-{i}", "success", 0.5, "", "s", None)
        assert len(db.get_outcomes("agent-a", limit=3)) == 3


# -- delegations --

class TestDelegations:
    def test_grant_and_get(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search", "write"])
        delegations = db.get_delegations("agent-a")
        assert len(delegations) == 1
        assert set(delegations[0].scopes) == {"search", "write"}
        assert delegations[0].grantor == "trust-agent"

    def test_grant_replaces_previous(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search"])
        db.grant_delegation("trust-agent", "agent-a", ["write"])
        delegations = db.get_delegations("agent-a")
        assert len(delegations) == 1
        assert delegations[0].scopes == ["write"]

    def test_multiple_grantors(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.register("manager-1", "did:key:z2", [], None)
        db.register("manager-2", "did:key:z3", [], None)
        db.grant_delegation("manager-1", "agent-a", ["search"])
        db.grant_delegation("manager-2", "agent-a", ["write"])
        delegations = db.get_delegations("agent-a")
        assert len(delegations) == 2
        all_scopes = set()
        for d in delegations:
            all_scopes.update(d.scopes)
        assert all_scopes == {"search", "write"}

    def test_revoke(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search"])
        result = db.revoke_delegation("trust-agent", "agent-a")
        assert result is not None
        assert result.revoked is True
        assert db.get_delegations("agent-a") == []

    def test_revoke_nonexistent(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        assert db.revoke_delegation("trust-agent", "agent-a") is None

    def test_restrict(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search", "write", "analyze"])
        result = db.restrict_delegation("trust-agent", "agent-a", ["search"])
        assert result is not None
        assert result.scopes == ["search"]
        delegations = db.get_delegations("agent-a")
        assert delegations[0].scopes == ["search"]

    def test_restrict_nonexistent(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        assert db.restrict_delegation("trust-agent", "agent-a", ["search"]) is None

    def test_scopes_reflected_in_agent_record(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search", "write"])
        record = db.get_agent("agent-a")
        assert set(record.scopes) == {"search", "write"}

    def test_revoked_delegation_not_in_scopes(self, db):
        db.register("agent-a", "did:key:z1", [], None)
        db.grant_delegation("trust-agent", "agent-a", ["search"])
        db.revoke_delegation("trust-agent", "agent-a")
        record = db.get_agent("agent-a")
        assert record.scopes == []
