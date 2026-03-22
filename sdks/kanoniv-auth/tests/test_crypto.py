"""Tests for kanoniv_auth.crypto - Ed25519 primitives."""

import pytest
from kanoniv_auth.crypto import (
    KeyPair,
    generate_keys,
    load_keys,
    verify_signature,
    did_to_public_key,
    _base58btc_encode,
    _base58btc_decode,
)


class TestKeyGeneration:
    def test_generate_produces_valid_did(self):
        keys = generate_keys()
        assert keys.did.startswith("did:key:z6Mk")
        assert len(keys.did) > 20

    def test_two_keys_have_different_dids(self):
        k1 = generate_keys()
        k2 = generate_keys()
        assert k1.did != k2.did

    def test_export_import_roundtrip(self):
        original = generate_keys()
        exported = original.export_private()
        loaded = load_keys(exported)
        assert loaded.did == original.did

    def test_export_public_is_deterministic(self):
        keys = generate_keys()
        assert keys.export_public() == keys.export_public()

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


class TestSigning:
    def test_sign_and_verify(self):
        keys = generate_keys()
        msg = b"deploy to staging"
        sig = keys.sign(msg)
        assert verify_signature(keys.did, msg, sig)

    def test_verify_wrong_message_fails(self):
        keys = generate_keys()
        sig = keys.sign(b"original message")
        assert not verify_signature(keys.did, b"tampered message", sig)

    def test_verify_wrong_did_fails(self):
        k1 = generate_keys()
        k2 = generate_keys()
        sig = k1.sign(b"test message")
        assert not verify_signature(k2.did, b"test message", sig)

    def test_verify_garbage_signature_fails(self):
        keys = generate_keys()
        assert not verify_signature(keys.did, b"test", "garbage-signature")

    def test_verify_empty_signature_fails(self):
        keys = generate_keys()
        assert not verify_signature(keys.did, b"test", "")

    def test_verify_invalid_did_fails(self):
        assert not verify_signature("did:key:invalid", b"test", "sig")

    def test_verify_unsupported_did_method_fails(self):
        assert not verify_signature("did:web:example.com", b"test", "sig")


class TestDIDConversion:
    def test_roundtrip_did_to_key(self):
        keys = generate_keys()
        pub_key = did_to_public_key(keys.did)
        raw = pub_key.public_bytes_raw()
        assert len(raw) == 32

    def test_invalid_did_prefix(self):
        with pytest.raises(ValueError, match="Unsupported DID"):
            did_to_public_key("did:web:example.com")

    def test_invalid_multicodec(self):
        # Valid base58 but wrong multicodec prefix
        with pytest.raises(ValueError, match="Not an Ed25519"):
            did_to_public_key("did:key:z" + "1" * 44)


class TestBase58:
    def test_encode_decode_roundtrip(self):
        data = b"\xed\x01" + b"\x00" * 32
        encoded = _base58btc_encode(data)
        decoded = _base58btc_decode(encoded)
        assert decoded == data

    def test_leading_zeros_preserved(self):
        data = b"\x00\x00\x01"
        encoded = _base58btc_encode(data)
        decoded = _base58btc_decode(encoded)
        assert decoded == data

    def test_empty_input(self):
        assert _base58btc_encode(b"") == ""
