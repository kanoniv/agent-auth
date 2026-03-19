"""HTTP backend - connects to a hosted Agent Trust API for shared reputation."""

from __future__ import annotations

import time

from agent_trust.backends.base import AgentRecord, Delegation, Outcome, ProvenanceRecord

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore


class HttpBackend:
    """HTTP storage backend. Connects to a hosted Agent Trust API.

    Requires httpx: pip install agent-trust[hosted]
    """

    def __init__(self, url: str, api_key: str | None = None):
        if httpx is None:
            raise ImportError(
                "httpx is required for the hosted backend. "
                "Install it with: pip install agent-trust[hosted]"
            )
        self._url = url.rstrip("/")
        self._client = httpx.Client(base_url=self._url, timeout=30)
        self._api_key = api_key

    def _headers(self, agent_name: str = "system") -> dict:
        h: dict[str, str] = {"X-Agent-Name": agent_name}
        if self._api_key:
            h["Authorization"] = f"Bearer {self._api_key}"
        return h

    # -- Agents --

    def register(
        self, name: str, did: str, capabilities: list[str], description: str | None
    ) -> AgentRecord:
        r = self._client.post(
            "/v1/agents/register",
            json={"name": name, "did": did, "capabilities": capabilities, "description": description},
            headers=self._headers(name),
        )
        r.raise_for_status()
        data = r.json()
        return _parse_agent(data)

    def get_agent(self, name: str) -> AgentRecord | None:
        r = self._client.get(f"/v1/agents/{name}", headers=self._headers())
        if r.status_code == 404:
            return None
        r.raise_for_status()
        agent = _parse_agent(r.json())
        # Compute active scopes from delegations (API doesn't include them)
        delegations = self.get_delegations(name)
        import time
        now = time.time()
        all_scopes: list[str] = []
        for d in delegations:
            if d.expires_at is not None and d.expires_at < now:
                continue
            all_scopes.extend(d.scopes)
        agent.scopes = list(set(all_scopes))
        return agent

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
        r = self._client.post(
            "/v1/provenance",
            json={
                "action": action,
                "entity_ids": entity_ids,
                "metadata": {**metadata, "agent_did": agent_did, "verified": verified},
                "signature": signature,
            },
            headers=self._headers(agent),
        )
        r.raise_for_status()
        data = r.json()
        return ProvenanceRecord(
            agent=agent,
            agent_did=agent_did,
            action=action,
            entity_ids=entity_ids,
            metadata=metadata,
            signature=signature,
            verified=verified,
            created_at=_parse_ts(data.get("created_at")),
        )

    def get_provenance(
        self, agent: str, limit: int = 50, verified_only: bool = False
    ) -> list[ProvenanceRecord]:
        r = self._client.get(
            "/v1/provenance",
            params={"limit": limit},
            headers=self._headers(),
        )
        r.raise_for_status()
        entries = r.json() if isinstance(r.json(), list) else []
        results = []
        for e in entries:
            if e.get("agent_name") != agent:
                continue
            meta = e.get("metadata", {})
            verified = meta.get("verified", False)
            if verified_only and not verified:
                continue
            results.append(ProvenanceRecord(
                agent=e.get("agent_name", agent),
                agent_did=e.get("agent_did", meta.get("agent_did", "")),
                action=e.get("action", ""),
                entity_ids=e.get("entity_ids", []),
                metadata=meta,
                signature=e.get("signature"),
                verified=verified,
                created_at=_parse_ts(e.get("created_at")),
            ))
        return results[:limit]

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
        # Look up agent DID for feedback endpoint
        agent_data = self._client.get(
            f"/v1/agents/{agent}", headers=self._headers()
        )
        agent_data.raise_for_status()
        did = agent_data.json().get("did", "")

        r = self._client.post(
            "/v1/memory/feedback",
            json={
                "subject_did": did,
                "action": action,
                "result": result,
                "reward_signal": reward,
                "content": content,
            },
            headers=self._headers(reporter),
        )
        r.raise_for_status()
        data = r.json()
        return Outcome(
            agent=agent,
            action=action,
            result=result,
            reward=reward,
            content=content,
            reporter=reporter,
            provenance_id=provenance_id,
            created_at=_parse_ts(data.get("created_at")),
        )

    def get_outcomes(self, agent: str, limit: int = 50) -> list[Outcome]:
        agent_data = self._client.get(
            f"/v1/agents/{agent}", headers=self._headers()
        )
        if agent_data.status_code == 404:
            return []
        agent_data.raise_for_status()
        did = agent_data.json().get("did", "")
        if not did:
            return []

        r = self._client.get(
            "/v1/memory/recall",
            params={"did": did, "entry_type": "outcome", "limit": limit},
            headers=self._headers(),
        )
        r.raise_for_status()
        data = r.json()
        entries = data.get("entries", [])
        outcomes = []
        for e in entries:
            meta = e.get("metadata", {})
            outcomes.append(Outcome(
                agent=agent,
                action=meta.get("action", "unknown"),
                result=meta.get("result", "partial"),
                reward=meta.get("reward_signal", 0.0),
                content=e.get("content", ""),
                reporter=meta.get("reported_by", "system"),
                provenance_id=None,
                created_at=_parse_ts(e.get("created_at")),
            ))
        return outcomes

    # -- Delegations --

    def grant_delegation(
        self, grantor: str, agent: str, scopes: list[str],
        caveats: dict | None = None, expires_at: float | None = None,
    ) -> Delegation:
        body: dict = {"agent_name": agent, "scopes": scopes}
        if caveats:
            body["metadata"] = caveats
        if expires_at is not None:
            from datetime import datetime, timezone
            body["expires_at"] = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()
        r = self._client.post(
            "/v1/delegations",
            json=body,
            headers=self._headers(grantor),
        )
        r.raise_for_status()
        data = r.json()
        return Delegation(
            grantor=grantor,
            agent=agent,
            scopes=scopes,
            caveats=caveats or {},
            expires_at=expires_at,
            created_at=_parse_ts(data.get("created_at")),
        )

    def revoke_delegation(self, grantor: str, agent: str) -> Delegation | None:
        # Find ALL active delegations from this grantor and revoke them all
        r = self._client.get(
            "/v1/delegations",
            params={"agent_name": agent},
            headers=self._headers(),
        )
        r.raise_for_status()
        delegations = r.json() if isinstance(r.json(), list) else []
        last = None
        for d in delegations:
            if d.get("grantor_name") == grantor and d.get("revoked_at") is None:
                self._client.delete(
                    f"/v1/delegations/{d['id']}",
                    headers=self._headers(grantor),
                )
                last = d
        if not last:
            return None
        return Delegation(
            grantor=grantor,
            agent=agent,
            scopes=last.get("scopes", []),
            revoked=True,
            created_at=_parse_ts(last.get("created_at")),
        )

    def restrict_delegation(
        self, grantor: str, agent: str, scopes: list[str]
    ) -> Delegation | None:
        # Revoke all existing, then grant new restricted delegation
        r = self._client.get(
            "/v1/delegations",
            params={"agent_name": agent},
            headers=self._headers(),
        )
        r.raise_for_status()
        delegations = r.json() if isinstance(r.json(), list) else []
        found = False
        for d in delegations:
            if d.get("grantor_name") == grantor and d.get("revoked_at") is None:
                self._client.delete(
                    f"/v1/delegations/{d['id']}",
                    headers=self._headers(grantor),
                )
                found = True
        if not found:
            return None

        # Grant new delegation with restricted scopes
        return self.grant_delegation(grantor, agent, scopes)

    def get_delegations(self, agent: str) -> list[Delegation]:
        r = self._client.get(
            "/v1/delegations",
            params={"agent_name": agent},
            headers=self._headers(),
        )
        r.raise_for_status()
        delegations = r.json() if isinstance(r.json(), list) else []
        return [
            Delegation(
                grantor=d.get("grantor_name", ""),
                agent=agent,
                scopes=d.get("scopes", []),
                revoked=d.get("revoked_at") is not None,
                created_at=_parse_ts(d.get("created_at")),
            )
            for d in delegations
            if d.get("revoked_at") is None
        ]


def _parse_agent(data: dict) -> AgentRecord:
    return AgentRecord(
        name=data["name"],
        did=data.get("did", ""),
        capabilities=data.get("capabilities", []),
        description=data.get("description"),
        scopes=[],  # scopes computed from delegations, not stored on agent
        registered_at=_parse_ts(data.get("registered_at")),
    )


def _parse_ts(val) -> float:
    """Parse a timestamp from the API into unix time."""
    if val is None:
        return time.time()
    if isinstance(val, (int, float)):
        return float(val)
    from datetime import datetime
    try:
        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, AttributeError):
        return time.time()
