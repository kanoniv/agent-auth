"""Backend interface for agent-trust storage."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class AgentRecord:
    name: str
    did: str  # did:key:z6Mk...
    capabilities: list[str] = field(default_factory=list)
    description: str | None = None
    scopes: list[str] = field(default_factory=list)  # current delegation scopes
    registered_at: float = 0.0


@dataclass
class ProvenanceRecord:
    agent: str
    agent_did: str
    action: str
    entity_ids: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    signature: str | None = None  # Ed25519 signature
    verified: bool = False
    created_at: float = 0.0


@dataclass
class Outcome:
    agent: str
    action: str
    result: str  # success, failure, partial
    reward: float
    content: str = ""
    reporter: str = "system"
    provenance_id: str | None = None  # links to the signed provenance
    created_at: float = 0.0


@dataclass
class Delegation:
    grantor: str  # who granted
    agent: str  # who received
    scopes: list[str] = field(default_factory=list)
    caveats: dict = field(default_factory=dict)  # e.g. {"max_cost": 100, "resource": "docs/*"}
    expires_at: float | None = None  # unix timestamp, None = never expires
    revoked: bool = False
    created_at: float = 0.0


class Backend(Protocol):
    """Storage backend interface."""

    # Agents
    def register(
        self, name: str, did: str, capabilities: list[str], description: str | None
    ) -> AgentRecord: ...

    def get_agent(self, name: str) -> AgentRecord | None: ...

    # Provenance
    def record_provenance(
        self,
        agent: str,
        agent_did: str,
        action: str,
        entity_ids: list[str],
        metadata: dict,
        signature: str | None,
        verified: bool,
    ) -> ProvenanceRecord: ...

    def get_provenance(
        self, agent: str, limit: int = 50, verified_only: bool = False
    ) -> list[ProvenanceRecord]: ...

    # Outcomes (derived from verified provenance)
    def record_outcome(
        self,
        agent: str,
        action: str,
        result: str,
        reward: float,
        content: str,
        reporter: str,
        provenance_id: str | None,
    ) -> Outcome: ...

    def get_outcomes(self, agent: str, limit: int = 50) -> list[Outcome]: ...

    # Delegations
    def grant_delegation(
        self, grantor: str, agent: str, scopes: list[str],
        caveats: dict | None = None, expires_at: float | None = None,
    ) -> Delegation: ...

    def revoke_delegation(self, grantor: str, agent: str) -> Delegation | None: ...

    def restrict_delegation(
        self, grantor: str, agent: str, scopes: list[str]
    ) -> Delegation | None: ...

    def get_delegations(self, agent: str) -> list[Delegation]: ...
