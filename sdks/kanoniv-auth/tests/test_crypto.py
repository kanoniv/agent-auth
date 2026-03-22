"""Tests for kanoniv_auth.crypto - Ed25519 primitives."""

import pytest
from kanoniv_auth.crypto import (
    KeyPair,
    generate_keys,
    load_keys,
    load_keys_from_hex,
    verify_signature_with_key,
)


class TestKeyGeneration:
    def test_generate_produces_did_agent(self):
        keys = generate_keys()
        assert keys.did.startswith("did:agent:")
        assert len(keys.did) > 15

    def test_two_keys_have_different_dids(self):
        k1 = generate_keys()
        k2 = generate_keys()
        assert k1.did != k2.did

    def test_export_import_roundtrip_b64(self):
        original = generate_keys()
        exported = original.export_private()
        loaded = load_keys(exported)
        assert loaded.did == original.did

    def test_export_import_roundtrip_hex(self):
        original = generate_keys()
        exported = original.export_private_hex()
        loaded = load_keys_from_hex(exported)
        assert loaded.did == original.did

    def test_public_key_bytes_are_32(self):
        keys = generate_keys()
        assert len(keys.public_key_bytes) == 32

    def test_load_invalid_key_raises(self):
        with pytest.raises(Exception):
            load_keys("not-valid-base64!!!")


class TestKeyPersistence:
    def test_save_and_load(self, tmp_path):
        path = str(tmp_path / "test.key")
        original = generate_keys()
        original.save(path)
        loaded = KeyPair.load(path)
        assert loaded.did == original.did

    def test_save_creates_parent_dirs(self, tmp_path):
        path = str(tmp_path / "deep" / "nested" / "dir" / "test.key")
        keys = generate_keys()
        keys.save(path)
        loaded = KeyPair.load(path)
        assert loaded.did == keys.did

    def test_save_sets_permissions(self, tmp_path):
        import os
        import stat
        path = str(tmp_path / "test.key")
        keys = generate_keys()
        keys.save(path)
        mode = os.stat(path).st_mode
        assert stat.S_IMODE(mode) == 0o600

    def test_save_format_is_rust_compatible(self, tmp_path):
        import json
        path = str(tmp_path / "test.key")
        keys = generate_keys()
        keys.save(path)
        data = json.loads(open(path).read())
        assert "did" in data
        assert "private_key" in data
        assert "public_key" in data
        assert data["did"].startswith("did:agent:")
        # Hex-encoded keys (Rust format)
        assert len(data["private_key"]) == 64  # 32 bytes hex
        assert len(data["public_key"]) == 64


class TestSigning:
    def test_sign_and_verify(self):
        keys = generate_keys()
        msg = b"deploy to staging"
        sig = keys.sign(msg)  # hex signature
        assert verify_signature_with_key(keys.public_key_bytes, msg, sig)

    def test_verify_wrong_message_fails(self):
        keys = generate_keys()
        sig = keys.sign(b"original message")
        assert not verify_signature_with_key(keys.public_key_bytes, b"tampered", sig)

    def test_verify_wrong_key_fails(self):
        k1 = generate_keys()
        k2 = generate_keys()
        sig = k1.sign(b"test message")
        assert not verify_signature_with_key(k2.public_key_bytes, b"test message", sig)

    def test_verify_garbage_signature_fails(self):
        keys = generate_keys()
        assert not verify_signature_with_key(keys.public_key_bytes, b"test", "garbage")

    def test_verify_empty_signature_fails(self):
        keys = generate_keys()
        assert not verify_signature_with_key(keys.public_key_bytes, b"test", "")


class TestDIDComputation:
    def test_did_is_deterministic(self):
        keys = generate_keys()
        # Reload from same private key
        loaded = load_keys(keys.export_private())
        assert loaded.did == keys.did

    def test_did_format(self):
        keys = generate_keys()
        # did:agent:{32 hex chars}
        parts = keys.did.split(":")
        assert parts[0] == "did"
        assert parts[1] == "agent"
        assert len(parts[2]) == 32  # 16 bytes hex
