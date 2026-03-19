"""SQLite backend - zero infra, works out of the box."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path

from agent_trust.backends.base import (
    AgentRecord,
    Delegation,
    Outcome,
    ProvenanceRecord,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
    name TEXT PRIMARY KEY,
    did TEXT UNIQUE NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    registered_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS provenance (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL REFERENCES agents(name),
    agent_did TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_ids TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    signature TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prov_agent ON provenance(agent, created_at DESC);

CREATE TABLE IF NOT EXISTS outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL REFERENCES agents(name),
    action TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'partial')),
    reward REAL NOT NULL CHECK (reward >= -1.0 AND reward <= 1.0),
    content TEXT NOT NULL DEFAULT '',
    reporter TEXT NOT NULL DEFAULT 'system',
    provenance_id TEXT REFERENCES provenance(id),
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_agent ON outcomes(agent, created_at DESC);

CREATE TABLE IF NOT EXISTS delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grantor TEXT NOT NULL,
    agent TEXT NOT NULL REFERENCES agents(name),
    scopes TEXT NOT NULL DEFAULT '[]',
    caveats TEXT NOT NULL DEFAULT '{}',
    expires_at REAL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleg_agent ON delegations(agent);
"""


class SQLiteBackend:
    """SQLite storage backend. Zero dependencies beyond the stdlib."""

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            db_path = str(Path.home() / ".agent-trust" / "trust.db")
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)

    # -- Agents --

    def register(
        self, name: str, did: str, capabilities: list[str], description: str | None
    ) -> AgentRecord:
        now = time.time()
        self._conn.execute(
            """INSERT INTO agents (name, did, capabilities, description, registered_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                 did = COALESCE(?, agents.did),
                 capabilities = CASE WHEN length(?) > 2 THEN ? ELSE agents.capabilities END,
                 description = COALESCE(?, agents.description)""",
            [name, did, json.dumps(capabilities), description, now,
             did, json.dumps(capabilities), json.dumps(capabilities), description],
        )
        self._conn.commit()
        return self._get_agent_record(name)

    def get_agent(self, name: str) -> AgentRecord | None:
        row = self._conn.execute(
            "SELECT * FROM agents WHERE name = ?", [name]
        ).fetchone()
        if not row:
            return None
        return self._row_to_agent(row)

    # -- Provenance --

    def record_provenance(
        self,
        agent: str,
        agent_did: str,
        action: str,
        entity_ids: list[str],
        metadata: dict,
        signature: str | None,
        verified: bool,
    ) -> ProvenanceRecord:
        now = time.time()
        prov_id = str(uuid.uuid4())
        self._conn.execute(
            """INSERT INTO provenance (id, agent, agent_did, action, entity_ids, metadata, signature, verified, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [prov_id, agent, agent_did, action, json.dumps(entity_ids),
             json.dumps(metadata), signature, int(verified), now],
        )
        self._conn.commit()
        return ProvenanceRecord(
            agent=agent,
            agent_did=agent_did,
            action=action,
            entity_ids=entity_ids,
            metadata=metadata,
            signature=signature,
            verified=verified,
            created_at=now,
        )

    def get_provenance(
        self, agent: str, limit: int = 50, verified_only: bool = False
    ) -> list[ProvenanceRecord]:
        query = "SELECT * FROM provenance WHERE agent = ?"
        params: list = [agent]
        if verified_only:
            query += " AND verified = 1"
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = self._conn.execute(query, params).fetchall()
        return [self._row_to_provenance(r) for r in rows]

    # -- Outcomes --

    def record_outcome(
        self,
        agent: str,
        action: str,
        result: str,
        reward: float,
        content: str,
        reporter: str,
        provenance_id: str | None,
    ) -> Outcome:
        now = time.time()
        self._conn.execute(
            """INSERT INTO outcomes (agent, action, result, reward, content, reporter, provenance_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [agent, action, result, reward, content, reporter, provenance_id, now],
        )
        self._conn.commit()
        return Outcome(
            agent=agent, action=action, result=result, reward=reward,
            content=content, reporter=reporter, provenance_id=provenance_id,
            created_at=now,
        )

    def get_outcomes(self, agent: str, limit: int = 50) -> list[Outcome]:
        rows = self._conn.execute(
            "SELECT * FROM outcomes WHERE agent = ? ORDER BY created_at DESC LIMIT ?",
            [agent, limit],
        ).fetchall()
        return [
            Outcome(
                agent=row["agent"], action=row["action"], result=row["result"],
                reward=row["reward"], content=row["content"], reporter=row["reporter"],
                provenance_id=row["provenance_id"], created_at=row["created_at"],
            )
            for row in rows
        ]

    # -- Delegations --

    def grant_delegation(
        self, grantor: str, agent: str, scopes: list[str],
        caveats: dict | None = None, expires_at: float | None = None,
    ) -> Delegation:
        now = time.time()
        # Revoke any existing active delegation from this grantor
        self._conn.execute(
            "UPDATE delegations SET revoked = 1 WHERE grantor = ? AND agent = ? AND revoked = 0",
            [grantor, agent],
        )
        self._conn.execute(
            "INSERT INTO delegations (grantor, agent, scopes, caveats, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [grantor, agent, json.dumps(scopes), json.dumps(caveats or {}), expires_at, now],
        )
        self._conn.commit()
        return Delegation(
            grantor=grantor, agent=agent, scopes=scopes,
            caveats=caveats or {}, expires_at=expires_at, created_at=now,
        )

    def revoke_delegation(self, grantor: str, agent: str) -> Delegation | None:
        row = self._conn.execute(
            "SELECT * FROM delegations WHERE grantor = ? AND agent = ? AND revoked = 0",
            [grantor, agent],
        ).fetchone()
        if not row:
            return None
        self._conn.execute(
            "UPDATE delegations SET revoked = 1 WHERE grantor = ? AND agent = ? AND revoked = 0",
            [grantor, agent],
        )
        self._conn.commit()
        return Delegation(
            grantor=grantor, agent=agent,
            scopes=json.loads(row["scopes"]),
            caveats=json.loads(row["caveats"]),
            expires_at=row["expires_at"],
            revoked=True, created_at=row["created_at"],
        )

    def restrict_delegation(
        self, grantor: str, agent: str, scopes: list[str]
    ) -> Delegation | None:
        row = self._conn.execute(
            "SELECT * FROM delegations WHERE grantor = ? AND agent = ? AND revoked = 0",
            [grantor, agent],
        ).fetchone()
        if not row:
            return None
        self._conn.execute(
            "UPDATE delegations SET scopes = ? WHERE grantor = ? AND agent = ? AND revoked = 0",
            [json.dumps(scopes), grantor, agent],
        )
        self._conn.commit()
        return Delegation(
            grantor=grantor, agent=agent, scopes=scopes,
            caveats=json.loads(row["caveats"]),
            expires_at=row["expires_at"],
            created_at=row["created_at"],
        )

    def get_delegations(self, agent: str) -> list[Delegation]:
        rows = self._conn.execute(
            "SELECT * FROM delegations WHERE agent = ? AND revoked = 0 ORDER BY created_at DESC",
            [agent],
        ).fetchall()
        return [
            Delegation(
                grantor=row["grantor"], agent=row["agent"],
                scopes=json.loads(row["scopes"]),
                caveats=json.loads(row["caveats"]),
                expires_at=row["expires_at"],
                revoked=bool(row["revoked"]), created_at=row["created_at"],
            )
            for row in rows
        ]

    # -- Internal --

    def _get_agent_record(self, name: str) -> AgentRecord:
        row = self._conn.execute("SELECT * FROM agents WHERE name = ?", [name]).fetchone()
        return self._row_to_agent(row)

    def _row_to_agent(self, row: sqlite3.Row) -> AgentRecord:
        # Compute current scopes from active, non-expired delegations
        now = time.time()
        deleg_rows = self._conn.execute(
            "SELECT scopes, expires_at FROM delegations WHERE agent = ? AND revoked = 0",
            [row["name"]],
        ).fetchall()
        all_scopes: list[str] = []
        for d in deleg_rows:
            expires = d["expires_at"]
            if expires is not None and expires < now:
                continue  # expired
            all_scopes.extend(json.loads(d["scopes"]))
        return AgentRecord(
            name=row["name"],
            did=row["did"],
            capabilities=json.loads(row["capabilities"]),
            description=row["description"],
            scopes=list(set(all_scopes)),
            registered_at=row["registered_at"],
        )

    def _row_to_provenance(self, row: sqlite3.Row) -> ProvenanceRecord:
        return ProvenanceRecord(
            agent=row["agent"],
            agent_did=row["agent_did"],
            action=row["action"],
            entity_ids=json.loads(row["entity_ids"]),
            metadata=json.loads(row["metadata"]),
            signature=row["signature"],
            verified=bool(row["verified"]),
            created_at=row["created_at"],
        )
