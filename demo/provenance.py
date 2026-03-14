"""Provenance graph — append-only audit trail of all agent actions."""

import json
import uuid
import base64
from datetime import datetime, timezone
from identity import KeyPair


class ProvenanceEntry:
    """A single signed entry in the provenance log."""

    def __init__(self, entry_id: str, agent_did: str, action: str,
                 task_id: str | None, artifact_id: str | None,
                 metadata: dict, timestamp: str, signature: str):
        self.id = entry_id
        self.agent_did = agent_did
        self.action = action
        self.task_id = task_id
        self.artifact_id = artifact_id
        self.metadata = metadata
        self.timestamp = timestamp
        self.signature = signature

    @classmethod
    def create(cls, agent_did: str, action: str, keypair: KeyPair,
               task_id: str | None = None, artifact_id: str | None = None,
               metadata: dict | None = None) -> "ProvenanceEntry":
        entry_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        metadata = metadata or {}

        signable = {
            "id": entry_id,
            "agent_did": agent_did,
            "action": action,
            "task_id": task_id,
            "artifact_id": artifact_id,
            "metadata": metadata,
            "timestamp": timestamp,
        }
        canonical = json.dumps(signable, sort_keys=True, separators=(",", ":")).encode()
        sig = keypair.sign(canonical)

        return cls(
            entry_id=entry_id,
            agent_did=agent_did,
            action=action,
            task_id=task_id,
            artifact_id=artifact_id,
            metadata=metadata,
            timestamp=timestamp,
            signature=base64.b64encode(sig).decode(),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "agent_did": self.agent_did,
            "action": self.action,
            "task_id": self.task_id,
            "artifact_id": self.artifact_id,
            "metadata": self.metadata,
            "timestamp": self.timestamp,
            "signature": self.signature,
        }


class ProvenanceGraph:
    """Append-only provenance graph tracking all agent actions."""

    def __init__(self):
        self.entries: list[ProvenanceEntry] = []
        self.nodes: dict[str, dict] = {}  # id -> {type, label}
        self.edges: list[dict] = []  # {from, to, action, entry_id}

    def record(self, entry: ProvenanceEntry):
        """Record an entry and update the graph."""
        # Ensure agent node
        if entry.agent_did not in self.nodes:
            self.nodes[entry.agent_did] = {"type": "agent", "label": entry.agent_did}

        # Ensure task node and edge
        if entry.task_id:
            if entry.task_id not in self.nodes:
                self.nodes[entry.task_id] = {"type": "task", "label": entry.task_id}
            self.edges.append({
                "from": entry.agent_did,
                "to": entry.task_id,
                "action": entry.action,
                "entry_id": entry.id,
                "timestamp": entry.timestamp,
            })

        # Ensure artifact node and edge
        if entry.artifact_id:
            if entry.artifact_id not in self.nodes:
                self.nodes[entry.artifact_id] = {"type": "artifact", "label": entry.artifact_id}
            self.edges.append({
                "from": entry.agent_did,
                "to": entry.artifact_id,
                "action": entry.action,
                "entry_id": entry.id,
                "timestamp": entry.timestamp,
            })

        self.entries.append(entry)

    def export(self) -> dict:
        """Export the full graph for visualization."""
        return {
            "nodes": [{"id": k, **v} for k, v in self.nodes.items()],
            "edges": self.edges,
            "entries": [e.to_dict() for e in self.entries],
            "total_entries": len(self.entries),
        }

    def entries_for_task(self, task_id: str) -> list[ProvenanceEntry]:
        return [e for e in self.entries if e.task_id == task_id]
