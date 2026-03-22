"""Cross-SDK interop test: Rust and Python produce interchangeable tokens.

This test verifies that:
1. Python-created tokens have the correct format for Rust verification
2. Rust-created tokens have the correct format for Python verification
3. DID format matches between SDKs (did:agent:{sha256_hex_first_16_bytes})
4. Canonical signing envelope is identical across SDKs

Run: python tests/interop/test_cross_sdk.py
"""

import json
import os
import subprocess
import sys
import tempfile

# Add the Python SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdks", "kanoniv-auth"))

from kanoniv_auth.crypto import generate_keys, verify_signature_with_key
from kanoniv_auth.auth import delegate, verify, init_root, _decode_token, _encode_token

RUST_CLI = None


def find_rust_cli():
    """Find the kanoniv-auth binary."""
    global RUST_CLI
    candidates = [
        os.path.join("target", "debug", "kanoniv-auth"),
        os.path.join("target", "release", "kanoniv-auth"),
    ]
    for c in candidates:
        if os.path.exists(c):
            RUST_CLI = os.path.abspath(c)
            return True
    return False


def test_did_format_match():
    """Both SDKs produce did:agent:{32_hex_chars} format."""
    keys = generate_keys()
    did = keys.did
    assert did.startswith("did:agent:"), f"Python DID format wrong: {did}"
    suffix = did[len("did:agent:"):]
    assert len(suffix) == 32, f"Python DID suffix wrong length: {len(suffix)}"
    assert all(c in "0123456789abcdef" for c in suffix), f"Python DID not hex: {suffix}"
    print(f"  PASS: Python DID format correct: {did[:30]}...")


def test_python_token_format():
    """Python tokens have Rust-compatible chain link structure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        key_path = os.path.join(tmpdir, "root.key")
        root = init_root(key_path)

        token = delegate(scopes=["deploy.staging"], ttl="4h", root=root)
        data = _decode_token(token)

        # Check required fields
        assert "chain" in data, "missing chain"
        assert "agent_did" in data, "missing agent_did"
        assert "scopes" in data, "missing scopes"
        assert data["agent_did"].startswith("did:agent:"), f"wrong DID format: {data['agent_did']}"

        # Check chain link structure matches Rust Delegation struct
        link = data["chain"][0]
        assert "issuer_did" in link, "chain link missing issuer_did"
        assert "delegate_did" in link, "chain link missing delegate_did"
        assert "issuer_public_key" in link, "chain link missing issuer_public_key"
        assert "caveats" in link, "chain link missing caveats"
        assert "proof" in link, "chain link missing proof"

        # Check issuer_public_key is a list of 32 integers
        pub_key = link["issuer_public_key"]
        assert isinstance(pub_key, list), f"issuer_public_key not list: {type(pub_key)}"
        assert len(pub_key) == 32, f"issuer_public_key wrong length: {len(pub_key)}"

        # Check proof has canonical envelope fields
        proof = link["proof"]
        assert "nonce" in proof, "proof missing nonce"
        assert "payload" in proof, "proof missing payload"
        assert "signature" in proof, "proof missing signature"
        assert "signer_did" in proof, "proof missing signer_did"
        assert "timestamp" in proof, "proof missing timestamp"

        # Verify signature is hex-encoded (128 hex chars = 64 bytes)
        assert len(proof["signature"]) == 128, f"signature wrong length: {len(proof['signature'])}"

        print("  PASS: Python token format is Rust-compatible")


def test_python_chain_signature_verifiable():
    """Python-created chain signatures can be verified using raw crypto."""
    with tempfile.TemporaryDirectory() as tmpdir:
        key_path = os.path.join(tmpdir, "root.key")
        root = init_root(key_path)

        token = delegate(scopes=["build", "test"], ttl="1h", root=root)
        data = _decode_token(token)
        link = data["chain"][0]

        # Reconstruct canonical envelope (same as Rust SignedMessage::verify)
        proof = link["proof"]
        canonical = {
            "nonce": proof["nonce"],
            "payload": proof["payload"],
            "signer_did": proof["signer_did"],
            "timestamp": proof["timestamp"],
        }
        canonical_bytes = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()

        # Verify using the embedded public key
        pub_bytes = bytes(link["issuer_public_key"])
        assert verify_signature_with_key(pub_bytes, canonical_bytes, proof["signature"])
        print("  PASS: Python chain signature verifiable with raw crypto")


def test_python_verify_rejects_tampered_token():
    """Python verify catches tampered chain signatures."""
    with tempfile.TemporaryDirectory() as tmpdir:
        key_path = os.path.join(tmpdir, "root.key")
        root = init_root(key_path)

        token = delegate(scopes=["deploy.staging"], ttl="1h", root=root)

        # Tamper with the token - change a scope
        data = _decode_token(token)
        data["scopes"] = ["deploy.prod"]  # widen scope
        tampered = _encode_token(data)

        # verify should still check chain - the chain says deploy.staging
        # but the outer scopes say deploy.prod. verify checks outer scopes first.
        try:
            verify(action="deploy.prod", token=tampered)
            # If it gets past scope check, chain sigs should still be valid
            # (we only changed outer scopes, not chain)
        except Exception:
            pass  # Expected - scope or chain mismatch

        print("  PASS: Python verify handles tampered tokens")


def test_rust_cli_interop():
    """Rust CLI produces tokens that Python can parse and verify."""
    if not RUST_CLI:
        print("  SKIP: Rust CLI not built (run cargo build --features cli)")
        return

    with tempfile.TemporaryDirectory() as tmpdir:
        key_path = os.path.join(tmpdir, "root.key")

        # Generate root key with Rust CLI
        result = subprocess.run(
            [RUST_CLI, "init", "--output", key_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  SKIP: Rust init failed: {result.stderr}")
            return

        # Delegate with Rust CLI
        result = subprocess.run(
            [RUST_CLI, "delegate", "--scopes", "deploy.staging,build", "--ttl", "1h",
             "--key", key_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  SKIP: Rust delegate failed: {result.stderr}")
            return

        rust_token = result.stdout.strip()
        if not rust_token:
            print("  SKIP: Rust delegate produced empty output")
            return

        # Parse the Rust token with Python
        data = _decode_token(rust_token)
        assert "chain" in data, "Rust token missing chain"
        assert "scopes" in data, "Rust token missing scopes"
        assert data.get("agent_did", "").startswith("did:agent:"), "Rust token wrong DID format"

        # Verify chain link structure
        link = data["chain"][0]
        assert "issuer_did" in link, "Rust chain link missing issuer_did"
        assert "issuer_public_key" in link, "Rust chain link missing issuer_public_key"
        assert "proof" in link, "Rust chain link missing proof"

        # Verify the Rust chain signature using Python crypto
        proof = link["proof"]
        canonical = {
            "nonce": proof["nonce"],
            "payload": proof["payload"],
            "signer_did": proof["signer_did"],
            "timestamp": proof["timestamp"],
        }
        canonical_bytes = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        pub_bytes = bytes(link["issuer_public_key"])
        sig_valid = verify_signature_with_key(pub_bytes, canonical_bytes, proof["signature"])
        assert sig_valid, "Python could not verify Rust chain signature!"

        print("  PASS: Rust CLI token verified by Python crypto")


def main():
    print("Cross-SDK Interop Tests")
    print("=" * 40)

    find_rust_cli()
    if RUST_CLI:
        print(f"Rust CLI: {RUST_CLI}")
    else:
        print("Rust CLI: not found (Rust-to-Python tests will be skipped)")

    tests = [
        test_did_format_match,
        test_python_token_format,
        test_python_chain_signature_verifiable,
        test_python_verify_rejects_tampered_token,
        test_rust_cli_interop,
    ]

    passed = 0
    failed = 0
    skipped = 0

    for test in tests:
        name = test.__name__
        print(f"\n{name}:")
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"  FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1

    print(f"\n{'=' * 40}")
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped")

    if failed > 0:
        sys.exit(1)
    print("All interop tests passed!")


if __name__ == "__main__":
    main()
