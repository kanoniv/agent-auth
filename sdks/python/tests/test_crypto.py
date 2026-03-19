"""Tests for agent_trust.crypto - Ed25519 identity and provenance signing."""

import pytest
from agent_trust.crypto import (
    generate_keys,
    load_keys,
    sign_provenance,
    verify_provenance,
    verify_signature,
    _canonical_payload,
    _public_key_to_did,
    _did_to_public_key,
    _base58btc_encode,
    _base58btc_decode,
)


# -- key generation --

class TestKeyGeneration:
    def test_generates_unique_dids(self):
        k1 = generate_keys()
        k2 = generate_keys()
        assert k1.did != k2.did

    def test_did_format(self):
        keys = generate_keys()
        assert keys.did.startswith("did:key:z")
        # Multicodec prefix z + base58 encoded ed25519 key
        assert len(keys.did) > 20

    def test_export_import_roundtrip(self):
        original = generate_keys()
        exported = original.export_private()
        restored = load_keys(exported)
        assert original.did == restored.did

    def test_export_import_signing_works(self):
        original = generate_keys()
        restored = load_keys(original.export_private())
        msg = b"roundtrip test"
        sig = original.sign(msg)
        assert verify_signature(restored.did, msg, sig)
        sig2 = restored.sign(msg)
        assert verify_signature(original.did, msg, sig2)

    def test_export_public_key(self):
        keys = generate_keys()
        pub = keys.export_public()
        assert len(pub) > 0
        assert isinstance(pub, str)


# -- signing and verification --

class TestSigningVerification:
    def test_sign_and_verify_basic(self):
        keys = generate_keys()
        msg = b"hello"
        sig = keys.sign(msg)
        assert verify_signature(keys.did, msg, sig)

    def test_verify_rejects_wrong_message(self):
        keys = generate_keys()
        sig = keys.sign(b"original")
        assert not verify_signature(keys.did, b"tampered", sig)

    def test_verify_rejects_wrong_key(self):
        k1 = generate_keys()
        k2 = generate_keys()
        sig = k1.sign(b"message")
        assert not verify_signature(k2.did, b"message", sig)

    def test_verify_rejects_invalid_signature(self):
        keys = generate_keys()
        assert not verify_signature(keys.did, b"message", "not-a-valid-sig")

    def test_verify_rejects_invalid_did(self):
        assert not verify_signature("did:invalid:xyz", b"msg", "sig")

    def test_verify_empty_message(self):
        keys = generate_keys()
        sig = keys.sign(b"")
        assert verify_signature(keys.did, b"", sig)

    def test_sign_large_message(self):
        keys = generate_keys()
        msg = b"x" * 10000
        sig = keys.sign(msg)
        assert verify_signature(keys.did, msg, sig)


# -- provenance signing --

class TestProvenanceSigning:
    def test_sign_and_verify_provenance(self):
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", ["e1", "e2"], {"score": 0.95}, ts)
        assert verify_provenance(keys.did, "merge", ["e1", "e2"], {"score": 0.95}, ts, sig)

    def test_tampered_action_fails(self):
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", ["e1"], {}, ts)
        assert not verify_provenance(keys.did, "split", ["e1"], {}, ts, sig)

    def test_tampered_entity_ids_fails(self):
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", ["e1"], {}, ts)
        assert not verify_provenance(keys.did, "merge", ["e1", "e2"], {}, ts, sig)

    def test_tampered_metadata_fails(self):
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", [], {"key": "val"}, ts)
        assert not verify_provenance(keys.did, "merge", [], {"key": "changed"}, ts, sig)

    def test_tampered_timestamp_fails(self):
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", [], {}, ts)
        assert not verify_provenance(keys.did, "merge", [], {}, ts + 1.0, sig)

    def test_entity_ids_order_independent(self):
        """entity_ids are sorted before signing, so order shouldn't matter."""
        keys = generate_keys()
        ts = 1710000000.0
        sig = sign_provenance(keys, "merge", ["b", "a", "c"], {}, ts)
        # Verify with different input order - should still pass (sorted internally)
        assert verify_provenance(keys.did, "merge", ["c", "a", "b"], {}, ts, sig)

    def test_nested_metadata(self):
        keys = generate_keys()
        ts = 1710000000.0
        meta = {"scores": {"name": 0.9, "email": 0.8}, "threshold": 6.0}
        sig = sign_provenance(keys, "resolve", ["e1"], meta, ts)
        assert verify_provenance(keys.did, "resolve", ["e1"], meta, ts, sig)

    def test_empty_provenance(self):
        keys = generate_keys()
        ts = 0.0
        sig = sign_provenance(keys, "", [], {}, ts)
        assert verify_provenance(keys.did, "", [], {}, ts, sig)


# -- canonical payload determinism --

class TestCanonicalPayload:
    def test_deterministic_serialization(self):
        """Same inputs must produce identical bytes every time."""
        p1 = _canonical_payload("did:key:z123", "merge", ["e1"], {"a": 1}, 100.0)
        p2 = _canonical_payload("did:key:z123", "merge", ["e1"], {"a": 1}, 100.0)
        assert p1 == p2

    def test_entity_ids_sorted(self):
        """entity_ids ordering should not affect the payload."""
        p1 = _canonical_payload("did:key:z1", "a", ["b", "a"], {}, 0.0)
        p2 = _canonical_payload("did:key:z1", "a", ["a", "b"], {}, 0.0)
        assert p1 == p2

    def test_metadata_key_order_irrelevant(self):
        """Metadata keys sorted via json.dumps(sort_keys=True)."""
        p1 = _canonical_payload("did:key:z1", "a", [], {"z": 1, "a": 2}, 0.0)
        p2 = _canonical_payload("did:key:z1", "a", [], {"a": 2, "z": 1}, 0.0)
        assert p1 == p2


# -- DID encoding --

class TestDidEncoding:
    def test_roundtrip(self):
        keys = generate_keys()
        pub = keys.public_key
        did = _public_key_to_did(pub)
        recovered = _did_to_public_key(did)
        # Compare raw bytes
        from cryptography.hazmat.primitives import serialization
        orig_bytes = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        recovered_bytes = recovered.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        assert orig_bytes == recovered_bytes

    def test_invalid_did_prefix(self):
        with pytest.raises(ValueError, match="Unsupported DID method"):
            _did_to_public_key("did:web:example.com")

    def test_invalid_did_no_z(self):
        with pytest.raises(ValueError, match="Unsupported DID method"):
            _did_to_public_key("did:key:abc")


# -- base58btc --

class TestBase58:
    def test_roundtrip(self):
        data = b"\xed\x01" + b"\x42" * 32
        encoded = _base58btc_encode(data)
        decoded = _base58btc_decode(encoded)
        assert decoded == data

    def test_leading_zeros_preserved(self):
        data = b"\x00\x00\x01"
        encoded = _base58btc_encode(data)
        decoded = _base58btc_decode(encoded)
        assert decoded == data

    def test_single_byte(self):
        for b in [0, 1, 57, 58, 255]:
            data = bytes([b])
            assert _base58btc_decode(_base58btc_encode(data)) == data
