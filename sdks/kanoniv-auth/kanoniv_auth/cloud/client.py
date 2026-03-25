"""Cloud client for the Kanoniv Trust API (kanoniv-auth cloud mode).

Usage:
    from kanoniv_auth.cloud import TrustClient

    # Authenticated (your own tenant)
    client = TrustClient(api_key="kt_live_...")

    # Demo mode (read-only public access)
    client = TrustClient()
"""

from __future__ import annotations

import httpx
from typing import Any

DEFAULT_URL = "https://trust.kanoniv.com"


class TrustClient:
    """Synchronous client for the Kanoniv Trust API."""

    def __init__(self, api_key: str | None = None, url: str = DEFAULT_URL, timeout: float = 10.0):
        self.url = url.rstrip("/")
        headers = {}
        if api_key:
            headers["X-API-Key"] = api_key
        self._http = httpx.Client(base_url=f"{self.url}/v1", timeout=timeout, headers=headers)

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _request(self, method: str, path: str, **kwargs) -> Any:
        r = self._http.request(method, path, **kwargs)
        if r.status_code == 403:
            return r.json()
        r.raise_for_status()
        return r.json()

    # --- Auth ---

    def signup(self, email: str, password: str, name: str) -> dict:
        """Create a new account. Returns api_key (shown once) + tenant info."""
        r = self._http.post("/v1/auth/signup", json={"email": email, "password": password, "name": name})
        r.raise_for_status()
        return r.json()

    def login(self, email: str, password: str) -> dict:
        """Log in and get a new API key."""
        r = self._http.post("/v1/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return r.json()

    def me(self) -> dict:
        """Get current tenant info and usage stats."""
        return self._request("GET", "/auth/me")

    # --- Agents ---

    def register(self, name: str, *, capabilities: list[str] | None = None,
                 description: str | None = None, did: str | None = None) -> dict:
        if did is None:
            import secrets
            did = f"did:agent:{name}-{secrets.token_hex(4)}"
        return self._request("POST", "/agents/register", json={
            "name": name, "capabilities": capabilities or [],
            "description": description, "did": did,
        })

    def agents(self) -> list[dict]:
        return self._request("GET", "/agents")

    def agent(self, name: str) -> dict:
        return self._request("GET", f"/agents/{name}")

    # --- Delegations ---

    def delegate(self, from_agent: str, to_agent: str, scopes: list[str], *,
                 expires_in_hours: int | None = None, metadata: dict | None = None) -> dict:
        body: dict[str, Any] = {"grantor_name": from_agent, "agent_name": to_agent, "scopes": scopes}
        if expires_in_hours:
            from datetime import datetime, timedelta, timezone
            body["expires_at"] = (datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)).isoformat()
        if metadata:
            body["metadata"] = metadata
        return self._request("POST", "/delegations", json=body)

    def delegations(self, agent_name: str | None = None) -> list[dict]:
        params = {"agent_name": agent_name} if agent_name else {}
        return self._request("GET", "/delegations", params=params)

    def revoke(self, delegation_id: str, *, agent_name: str = "system") -> dict:
        return self._request("DELETE", f"/delegations/{delegation_id}",
                             headers={"X-Agent-Name": agent_name})

    def update_scopes(self, delegation_id: str, scopes: list[str]) -> dict:
        return self._request("PUT", f"/delegations/{delegation_id}", json={"scopes": scopes})

    # --- Provenance ---

    def action(self, agent_name: str, action: str, *, metadata: dict | None = None,
               entity_ids: list[str] | None = None, signature: str | None = None) -> dict:
        return self._request("POST", "/provenance", json={
            "action": action, "entity_ids": entity_ids or [],
            "metadata": metadata or {}, "signature": signature,
        }, headers={"X-Agent-Name": agent_name})

    def provenance(self, limit: int = 50) -> list[dict]:
        return self._request("GET", "/provenance", params={"limit": limit})

    # --- Memory ---

    def memorize(self, agent_name: str, title: str, *, content: str = "",
                 entry_type: str = "decision", metadata: dict | None = None) -> dict:
        return self._request("POST", "/memory", json={
            "entry_type": entry_type, "title": title, "content": content,
            "author": f"agent:{agent_name}", "metadata": metadata or {},
        })

    def memories(self, *, entry_type: str | None = None, author: str | None = None,
                 limit: int = 30) -> list[dict]:
        params: dict[str, Any] = {"limit": limit}
        if entry_type: params["entry_type"] = entry_type
        if author: params["author"] = author
        return self._request("GET", "/memory", params=params)

    def recall(self, agent_did: str) -> dict:
        return self._request("GET", "/memory/recall", params={"did": agent_did})

    # --- Feedback ---

    def feedback(self, agent_did: str, action: str, result: str, *,
                 reward_signal: float = 0.5, content: str | None = None) -> dict:
        body: dict[str, Any] = {
            "subject_did": agent_did, "action": action, "result": result,
            "reward_signal": reward_signal,
        }
        if content: body["content"] = content
        return self._request("POST", "/memory/feedback", json=body)

    def trend(self, agent_did: str, window: str = "7d") -> dict:
        return self._request("GET", "/memory/trend", params={"did": agent_did, "window": window})


class AsyncTrustClient:
    """Async client for the Kanoniv Trust API."""

    def __init__(self, api_key: str | None = None, url: str = DEFAULT_URL, timeout: float = 10.0):
        self.url = url.rstrip("/")
        headers = {}
        if api_key:
            headers["X-API-Key"] = api_key
        self._http = httpx.AsyncClient(base_url=f"{self.url}/v1", timeout=timeout, headers=headers)

    async def close(self):
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        r = await self._http.request(method, path, **kwargs)
        if r.status_code == 403:
            return r.json()
        r.raise_for_status()
        return r.json()

    async def signup(self, email: str, password: str, name: str) -> dict:
        r = await self._http.post("/v1/auth/signup", json={"email": email, "password": password, "name": name})
        r.raise_for_status()
        return r.json()

    async def login(self, email: str, password: str) -> dict:
        r = await self._http.post("/v1/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        return r.json()

    async def me(self) -> dict:
        return await self._request("GET", "/auth/me")

    async def register(self, name: str, *, capabilities: list[str] | None = None,
                       description: str | None = None, did: str | None = None) -> dict:
        if did is None:
            import secrets
            did = f"did:agent:{name}-{secrets.token_hex(4)}"
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
        if metadata: body["metadata"] = metadata
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
            "action": action, "entity_ids": entity_ids or [],
            "metadata": metadata or {}, "signature": signature,
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

    async def recall(self, agent_did: str) -> dict:
        return await self._request("GET", "/memory/recall", params={"did": agent_did})

    async def feedback(self, agent_did: str, action: str, result: str, *,
                       reward_signal: float = 0.5) -> dict:
        return await self._request("POST", "/memory/feedback", json={
            "subject_did": agent_did, "action": action, "result": result,
            "reward_signal": reward_signal,
        })

    async def trend(self, agent_did: str, window: str = "7d") -> dict:
        return await self._request("GET", "/memory/trend", params={"did": agent_did, "window": window})
