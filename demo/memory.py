"""Shared memory — cross-agent knowledge store mirroring Kanoniv's memory API.

Agents memorize decisions, findings, and patterns. Any agent can recall
or search what other agents stored. All entries are attributed to the
agent that created them.
"""

import uuid
from datetime import datetime, timezone


class MemoryEntry:
    """A single memory entry."""

    def __init__(self, agent_did: str, agent_name: str, entry_type: str,
                 title: str, content: str, entity_id: str | None = None,
                 tags: list[str] | None = None):
        self.id = str(uuid.uuid4())
        self.agent_did = agent_did
        self.agent_name = agent_name
        self.entry_type = entry_type  # decision, investigation, pattern, knowledge, expertise
        self.title = title
        self.content = content
        self.entity_id = entity_id
        self.tags = tags or []
        self.timestamp = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "agent_did": self.agent_did,
            "agent_name": self.agent_name,
            "entry_type": self.entry_type,
            "title": self.title,
            "content": self.content,
            "entity_id": self.entity_id,
            "tags": self.tags,
            "timestamp": self.timestamp,
        }


class SharedMemory:
    """Cross-agent shared memory store.

    Mirrors Kanoniv's memory API: memorize, recall, search_memory.
    In production this would be backed by Kanoniv Cloud — here it's
    in-process for the demo.
    """

    def __init__(self):
        self.entries: list[MemoryEntry] = []

    def memorize(self, agent_did: str, agent_name: str, entry_type: str,
                 title: str, content: str, entity_id: str | None = None,
                 tags: list[str] | None = None) -> MemoryEntry:
        """Store a memory entry. Any agent can later recall or search it."""
        entry = MemoryEntry(
            agent_did=agent_did,
            agent_name=agent_name,
            entry_type=entry_type,
            title=title,
            content=content,
            entity_id=entity_id,
            tags=tags,
        )
        self.entries.append(entry)
        return entry

    def recall(self, entity_id: str | None = None,
               agent_did: str | None = None) -> list[MemoryEntry]:
        """Recall memories, optionally filtered by entity or agent."""
        results = self.entries
        if entity_id:
            results = [e for e in results if e.entity_id == entity_id]
        if agent_did:
            results = [e for e in results if e.agent_did == agent_did]
        return results

    def search(self, query: str, entry_type: str | None = None) -> list[MemoryEntry]:
        """Full-text search across all memory entries."""
        q = query.lower()
        results = []
        for e in self.entries:
            if q in e.title.lower() or q in e.content.lower() or any(q in t.lower() for t in e.tags):
                if entry_type is None or e.entry_type == entry_type:
                    results.append(e)
        return results

    def all_entries(self) -> list[dict]:
        """Export all entries for the UI."""
        return [e.to_dict() for e in self.entries]

    def count(self) -> int:
        return len(self.entries)
