"""Tests for kanoniv-agent-auth Python bindings."""

import json
import os
import pytest
from kanoniv_agent_auth import AgentKeyPair, AgentIdentity, SignedMessage, ProvenanceEntry


class TestAgentKeyPair:
    def test_generate(self):
        kp = AgentKeyPair.generate()
        identity = kp.identity()
        assert identity.did.startswith("did:kanoniv:")
        assert len(identity.public_key_bytes) == 32

    def test_from_bytes_roundtrip(self):
        kp1 = AgentKeyPair.generate()
        secret = kp1.secret_bytes()
        assert len(secret) == 32
        kp2 = AgentKeyPair.from_bytes(secret)
        assert kp1.identity().did == kp2.identity().did

    def test_did_determinism(self):
        kp = AgentKeyPair.generate()
        assert kp.identity().did == kp.identity().did

    def test_different_keys_different_dids(self):
        kp1 = AgentKeyPair.generate()
        kp2 = AgentKeyPair.generate()
        assert kp1.identity().did != kp2.identity().did


class TestAgentIdentity:
    def test_from_bytes(self):
        kp = AgentKeyPair.generate()
        identity = kp.identity()
        restored = AgentIdentity.from_bytes(identity.public_key_bytes)
        assert restored.did == identity.did

    def test_from_bytes_wrong_length(self):
        with pytest.raises(ValueError):
            AgentIdentity.from_bytes(b"\x00" * 16)

    def test_did_document(self):
        kp = AgentKeyPair.generate()
        identity = kp.identity()
        doc = json.loads(identity.did_document())
        assert doc["id"] == identity.did
        assert doc["verificationMethod"][0]["type"] == "Ed25519VerificationKey2020"


class TestSignedMessage:
    def test_sign_and_verify(self):
        kp = AgentKeyPair.generate()
        signed = kp.sign('{"action": "merge", "entity_id": "abc123"}')
        signed.verify(kp.identity())  # should not raise

    def test_tampered_payload_fails(self):
        kp = AgentKeyPair.generate()
        signed = kp.sign('{"action": "merge"}')
        # Deserialize, tamper, re-serialize
        data = json.loads(signed.to_json())
        data["payload"] = {"action": "split"}
        tampered = SignedMessage.from_json(json.dumps(data))
        with pytest.raises(ValueError):
            tampered.verify(kp.identity())

    def test_wrong_identity_fails(self):
        kp1 = AgentKeyPair.generate()
        kp2 = AgentKeyPair.generate()
        signed = kp1.sign('{"data": "test"}')
        with pytest.raises(ValueError):
            signed.verify(kp2.identity())

    def test_content_hash_deterministic(self):
        kp = AgentKeyPair.generate()
        signed = kp.sign('{"x": 1}')
        assert signed.content_hash() == signed.content_hash()
        assert len(signed.content_hash()) == 64

    def test_serialization_roundtrip(self):
        kp = AgentKeyPair.generate()
        signed = kp.sign('{"key": "value"}')
        json_str = signed.to_json()
        restored = SignedMessage.from_json(json_str)
        restored.verify(kp.identity())  # should not raise


class TestProvenanceEntry:
    def test_create_and_verify(self):
        kp = AgentKeyPair.generate()
        entry = ProvenanceEntry.create(
            kp, "merge",
            ["entity-1", "entity-2"],
            [],
            '{"reason": "duplicate detected"}',
        )
        assert entry.agent_did == kp.identity().did
        assert entry.action == "merge"
        assert len(entry.entity_ids) == 2
        entry.verify(kp.identity())

    def test_chaining(self):
        kp = AgentKeyPair.generate()
        e1 = ProvenanceEntry.create(kp, "resolve", ["e1"], [], "{}")
        e2 = ProvenanceEntry.create(
            kp, "merge", ["e1", "e2"],
            [e1.content_hash()], "{}",
        )
        assert len(e2.parent_ids) == 1
        assert e2.parent_ids[0] == e1.content_hash()
        e2.verify(kp.identity())

    def test_cross_agent_verification(self):
        kp_a = AgentKeyPair.generate()
        kp_b = AgentKeyPair.generate()
        entry = ProvenanceEntry.create(kp_a, "delegate", [], [], "{}")
        entry.verify(kp_a.identity())
        with pytest.raises(ValueError):
            entry.verify(kp_b.identity())

    def test_custom_action(self):
        kp = AgentKeyPair.generate()
        entry = ProvenanceEntry.create(
            kp, "custom:audit_review", ["e1"], [], "{}",
        )
        assert entry.action == "custom:audit_review"
        entry.verify(kp.identity())


class TestCrossLanguageInterop:
    def test_keypair_fixture(self):
        fixture_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "fixtures", "test-keypair.json"
        )
        with open(fixture_path) as f:
            fixture = json.load(f)

        secret = bytes.fromhex(fixture["secret_key_hex"])
        kp = AgentKeyPair.from_bytes(secret)
        assert kp.identity().did == fixture["did"]
        assert kp.identity().public_key_bytes.hex() == fixture["public_key_hex"]

    def test_verify_rust_signed_message(self):
        keypair_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "fixtures", "test-keypair.json"
        )
        signed_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "fixtures", "test-signed-message.json"
        )
        with open(keypair_path) as f:
            keypair_fixture = json.load(f)
        with open(signed_path) as f:
            signed_fixture = json.load(f)

        secret = bytes.fromhex(keypair_fixture["secret_key_hex"])
        kp = AgentKeyPair.from_bytes(secret)

        rust_message = SignedMessage.from_json(
            json.dumps(signed_fixture["signed_message"])
        )
        rust_message.verify(kp.identity())  # should not raise
