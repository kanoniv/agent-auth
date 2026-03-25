"""Trust layer client - SDK for the Agent Trust Observatory API."""

from __future__ import annotations

import httpx
from typing import Any


class TrustClient:
    """Synchronous client for the Kanoniv Trust API.

    Usage:
        from kanoniv_trust import TrustClient

        trust = TrustClient()  # defaults to https://trust.kanoniv.com
        trust.register("sdr-agent", capabilities=["resolve", "search"])
        trust.delegate("coordinator", "sdr-agent", scopes=["resolve", "merge"])
        trust.action("sdr-agent", "resolve", metadata={"entity": "john@acme.com"})
    """

    def __init__(self, url: str = "https://trust.kanoniv.com", timeout: float = 10.0):
        self.url = url.rstrip("/")
        self._http = httpx.Client(base_url=f"{self.url}/v1", timeout=timeout)

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _request(self, method: str, path: str, **kwargs) -> Any:
        r = self._http.request(method, path, **kwargs)
        if r.status_code == 403:
            # Delegation denied - return the denial response, don't raise
            return r.json()
        r.raise_for_status()
        return r.json()

    # --- Agents ---

    def register(
        self,
        name: str,
        *,
        capabilities: list[str] | None = None,
        description: str | None = None,
        did: str | None = None,
    ) -> dict:
        """Register or update an agent."""
        if did is None:
            import secrets
            did = f"did:agent:{name}-{secrets.token_hex(4)}"
        return self._request("POST", "/agents/register", json={
            "name": name,
            "capabilities": capabilities or [],
            "description": description,
            "did": did,
        })

    def agents(self) -> list[dict]:
        """List all registered agents."""
        return self._request("GET", "/agents")

    def agent(self, name: str) -> dict:
        """Get agent details including RL context."""
        return self._request("GET", f"/agents/{name}")

    # --- Delegations ---

    def delegate(
        self,
        from_agent: str,
        to_agent: str,
        scopes: list[str],
        *,
        expires_in_hours: int | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Grant a delegation from one agent to another."""
        body: dict[str, Any] = {
            "grantor_name": from_agent,
            "agent_name": to_agent,
            "scopes": scopes,
        }
        if expires_in_hours:
            from datetime import datetime, timedelta, timezone
            body["expires_at"] = (
                datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
            ).isoformat()
        if metadata:
            body["metadata"] = metadata
        return self._request("POST", "/delegations", json=body)

    def delegations(self, agent_name: str | None = None) -> list[dict]:
        """List active delegations, optionally filtered by agent."""
        params = {"agent_name": agent_name} if agent_name else {}
        return self._request("GET", "/delegations", params=params)

    def revoke(self, delegation_id: str, *, agent_name: str = "system") -> dict:
        """Revoke a delegation."""
        return self._request(
            "DELETE", f"/delegations/{delegation_id}",
            headers={"X-Agent-Name": agent_name},
        )

    def update_scopes(self, delegation_id: str, scopes: list[str]) -> dict:
        """Update scopes on an existing delegation."""
        return self._request("PUT", f"/delegations/{delegation_id}", json={"scopes": scopes})

    # --- Provenance ---

    def action(
        self,
        agent_name: str,
        action: str,
        *,
        metadata: dict | None = None,
        entity_ids: list[str] | None = None,
        signature: str | None = None,
    ) -> dict:
        """Record a provenance entry (agent performed an action)."""
        return self._request("POST", "/provenance", json={
            "action": action,
            "entity_ids": entity_ids or [],
            "metadata": metadata or {},
            "signature": signature,
        }, headers={"X-Agent-Name": agent_name})

    def provenance(self, limit: int = 50) -> list[dict]:
        """Get recent provenance entries."""
        return self._request("GET", "/provenance", params={"limit": limit})

    # --- Memory ---

    def memorize(
        self,
        agent_name: str,
        title: str,
        *,
        content: str = "",
        entry_type: str = "decision",
        metadata: dict | None = None,
    ) -> dict:
        """Save a memory entry."""
        return self._request("POST", "/memory", json={
            "entry_type": entry_type,
            "title": title,
            "content": content,
            "author": f"agent:{agent_name}",
            "metadata": metadata or {},
        })

    def memories(
        self,
        *,
        entry_type: str | None = None,
        author: str | None = None,
        limit: int = 30,
    ) -> list[dict]:
        """List memory entries."""
        params: dict[str, Any] = {"limit": limit}
        if entry_type:
            params["entry_type"] = entry_type
        if author:
            params["author"] = author
        return self._request("GET", "/memory", params=params)

    def recall(self, agent_did: str) -> dict:
        """Get recall context for an agent (reputation + history summary)."""
        return self._request("GET", "/memory/recall", params={"did": agent_did})

    # --- Feedback (affects reputation) ---

    def feedback(
        self,
        agent_did: str,
        action: str,
        result: str,
        *,
        reward_signal: float = 0.5,
        content: str | None = None,
    ) -> dict:
        """Submit feedback for an agent action. Affects reputation score.

        Args:
            result: "success", "failure", or "partial"
            reward_signal: float between -1 and 1
        """
        body: dict[str, Any] = {
            "subject_did": agent_did,
            "action": action,
            "result": result,
            "reward_signal": reward_signal,
        }
        if content:
            body["content"] = content
        return self._request("POST", "/memory/feedback", json=body)

    def trend(self, agent_did: str, window: str = "7d") -> dict:
        """Get reputation trend for an agent."""
        return self._request("GET", "/memory/trend", params={
            "did": agent_did, "window": window,
        })


class AsyncTrustClient:
    """Async client for the Kanoniv Trust API.

    Usage:
        from kanoniv_trust import AsyncTrustClient

        async with AsyncTrustClient() as trust:
            await trust.register("sdr-agent", capabilities=["resolve"])
    """

    def __init__(self, url: str = "https://trust.kanoniv.com", timeout: float = 10.0):
        self.url = url.rstrip("/")
        self._http = httpx.AsyncClient(base_url=f"{self.url}/v1", timeout=timeout)

    async def close(self):
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        r = await self._http.request(method, path, **kwargs)
        r.raise_for_status()
        return r.json()

    async def register(self, name: str, *, capabilities: list[str] | None = None,
                       description: str | None = None, did: str | None = None) -> dict:
        return await self._request("POST", "/agents/register", json={
            "name": name, "capabilities": capabilities or [],
            "description": description, "did": did,
        })

    async def agents(self) -> list[dict]:
        return await self._request("GET", "/agents")

    async def agent(self, name: str) -> dict:
        return await self._request("GET", f"/agents/{name}")

    async def delegate(self, from_agent: str, to_agent: str, scopes: list[str], *,
                       expires_in_hours: int | None = None, metadata: dict | None = None) -> dict:
        body: dict[str, Any] = {"grantor_name": from_agent, "agent_name": to_agent, "scopes": scopes}
        if expires_in_hours:
            from datetime import datetime, timedelta, timezone
            body["expires_at"] = (datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)).isoformat()
        if metadata:
            body["metadata"] = metadata
        return await self._request("POST", "/delegations", json=body)

    async def delegations(self, agent_name: str | None = None) -> list[dict]:
        params = {"agent_name": agent_name} if agent_name else {}
        return await self._request("GET", "/delegations", params=params)

    async def revoke(self, delegation_id: str, *, agent_name: str = "system") -> dict:
        return await self._request("DELETE", f"/delegations/{delegation_id}",
                                   headers={"X-Agent-Name": agent_name})

    async def action(self, agent_name: str, action: str, *, metadata: dict | None = None,
                     entity_ids: list[str] | None = None, signature: str | None = None) -> dict:
        return await self._request("POST", "/provenance", json={
            "action": action, "entity_ids": entity_ids or [], "metadata": metadata or {},
            "signature": signature,
        }, headers={"X-Agent-Name": agent_name})

    async def provenance(self, limit: int = 50) -> list[dict]:
        return await self._request("GET", "/provenance", params={"limit": limit})

    async def memorize(self, agent_name: str, title: str, *, content: str = "",
                       entry_type: str = "decision", metadata: dict | None = None) -> dict:
        return await self._request("POST", "/memory", json={
            "entry_type": entry_type, "title": title, "content": content,
            "author": f"agent:{agent_name}", "metadata": metadata or {},
        })

    async def memories(self, *, entry_type: str | None = None, author: str | None = None,
                       limit: int = 30) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if entry_type: params["entry_type"] = entry_type
        if author: params["author"] = author
        return await self._request("GET", "/memory", params=params)

    async def feedback(self, agent_did: str, action: str, result: str, *,
                       reward_signal: float = 0.5) -> dict:
        return await self._request("POST", "/memory/feedback", json={
            "subject_did": agent_did, "action": action, "result": result,
            "reward_signal": reward_signal,
        })
