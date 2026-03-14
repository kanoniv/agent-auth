"""Nostr publisher — advertises agent DID documents on Nostr relays.

Agents publish their DID documents and service endpoints as Nostr events
so other agents (including from other teams) can discover them on the
decentralized network.

Uses NIP-01 kind:30078 (parameterized replaceable events) for agent profiles.
"""

import hashlib
import json
import time
import secrets
from coincurve import PrivateKey

# Public Nostr relays
RELAYS = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
]

# Nostr event kinds
KIND_AGENT_PROFILE = 30078  # Parameterized replaceable event


def _generate_nostr_keypair():
    """Generate a Nostr keypair (secp256k1 Schnorr)."""
    sk_bytes = secrets.token_bytes(32)
    sk = PrivateKey(sk_bytes)
    pk = sk.public_key.format(compressed=True)[1:]  # 32-byte x-only pubkey
    return sk, sk_bytes.hex(), pk.hex()


def _create_event(sk_hex: str, pubkey_hex: str, kind: int, content: str,
                  tags: list | None = None) -> dict:
    """Create and sign a Nostr event (NIP-01)."""
    sk = PrivateKey(bytes.fromhex(sk_hex))
    created_at = int(time.time())
    tags = tags or []

    # Serialize for signing: [0, pubkey, created_at, kind, tags, content]
    serialized = json.dumps(
        [0, pubkey_hex, created_at, kind, tags, content],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    event_id = hashlib.sha256(serialized.encode()).hexdigest()

    # Schnorr signature (BIP-340)
    sig = sk.sign_schnorr(bytes.fromhex(event_id))

    return {
        "id": event_id,
        "pubkey": pubkey_hex,
        "created_at": created_at,
        "kind": kind,
        "tags": tags,
        "content": content,
        "sig": sig.hex(),
    }


def publish_agent_to_nostr(agent_identity, keypair_ed25519) -> dict:
    """Publish an agent's DID document to Nostr relays.

    Returns the Nostr event and publish results.
    """
    import websocket

    # Generate a Nostr keypair for this agent (transport layer)
    nostr_sk, nostr_sk_hex, nostr_pk_hex = _generate_nostr_keypair()

    # Build the content: agent's DID document with service endpoints
    did_doc = agent_identity.to_did_document()
    content = json.dumps({
        "type": "kanoniv-agent-profile",
        "version": "1.0",
        "did_document": did_doc,
        "network": "kanoniv-hackathon",
        "description": f"Trustworthy AI agent: {agent_identity.name}",
    }, indent=2)

    # Tags for discoverability
    tags = [
        ["d", agent_identity.did],  # unique identifier for replaceable event
        ["t", "kanoniv"],
        ["t", "multi-agent"],
        ["t", "trustworthy-ai"],
        ["t", agent_identity.name],
        ["L", "did"],
        ["l", agent_identity.did, "did"],
    ]
    for cap in agent_identity.capabilities:
        tags.append(["t", cap])

    event = _create_event(nostr_sk_hex, nostr_pk_hex, KIND_AGENT_PROFILE, content, tags)

    # Publish to relays
    results = []
    for relay_url in RELAYS:
        try:
            ws = websocket.create_connection(relay_url, timeout=5)
            msg = json.dumps(["EVENT", event])
            ws.send(msg)
            response = ws.recv()
            ws.close()
            results.append({
                "relay": relay_url,
                "status": "published",
                "response": response,
            })
        except Exception as e:
            results.append({
                "relay": relay_url,
                "status": "failed",
                "error": str(e),
            })

    return {
        "nostr_event": event,
        "nostr_pubkey": nostr_pk_hex,
        "did": agent_identity.did,
        "agent_name": agent_identity.name,
        "relays": results,
        "published_count": sum(1 for r in results if r["status"] == "published"),
    }


def publish_all_agents(agents_with_keypairs: list) -> list:
    """Publish all agents to Nostr. Takes list of (AgentIdentity, KeyPair) tuples."""
    results = []
    for identity, kp in agents_with_keypairs:
        result = publish_agent_to_nostr(identity, kp)
        results.append(result)
    return results


def discover_agents(tags: list[str] | None = None) -> list[dict]:
    """Discover agents on Nostr relays by searching for kanoniv-tagged events.

    Returns a list of discovered agent profiles with their DID documents.
    """
    import websocket

    tags = tags or ["kanoniv"]
    discovered = []
    seen_dids = set()

    for relay_url in RELAYS:
        try:
            ws = websocket.create_connection(relay_url, timeout=10)
            # NIP-01 REQ: subscribe to events matching our tags
            sub_id = f"kanoniv-discover-{secrets.token_hex(4)}"
            filters = {"#t": tags, "kinds": [KIND_AGENT_PROFILE], "limit": 50}
            ws.send(json.dumps(["REQ", sub_id, filters]))

            # Read events until EOSE (end of stored events)
            while True:
                raw = ws.recv()
                msg = json.loads(raw)
                if msg[0] == "EOSE":
                    break
                if msg[0] == "EVENT" and len(msg) >= 3:
                    event = msg[2]
                    try:
                        content = json.loads(event.get("content", "{}"))
                        did_doc = content.get("did_document", {})
                        did = did_doc.get("id", "")
                        if did and did not in seen_dids:
                            seen_dids.add(did)
                            discovered.append({
                                "did": did,
                                "name": did_doc.get("kanoniv", {}).get("name", "unknown"),
                                "capabilities": did_doc.get("kanoniv", {}).get("capabilities", []),
                                "did_document": did_doc,
                                "network": content.get("network", ""),
                                "relay": relay_url,
                                "nostr_pubkey": event.get("pubkey", ""),
                                "published_at": event.get("created_at", 0),
                            })
                    except (json.JSONDecodeError, KeyError):
                        continue

            ws.send(json.dumps(["CLOSE", sub_id]))
            ws.close()
        except Exception:
            continue

    return discovered
