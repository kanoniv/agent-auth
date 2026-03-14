//! Generate cross-language test fixtures.
//!
//! Run with: cargo run --example generate_fixtures

use kanoniv_agent_auth::{ActionType, AgentKeyPair, ProvenanceEntry, SignedMessage};

fn main() {
    // Deterministic keypair from known secret bytes
    let secret: [u8; 32] = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c,
        0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae,
        0x7f, 0x60,
    ];
    let keypair = AgentKeyPair::from_bytes(&secret);
    let identity = keypair.identity();

    // Generate keypair fixture
    let keypair_fixture = serde_json::json!({
        "secret_key_hex": hex::encode(secret),
        "public_key_hex": hex::encode(&identity.public_key_bytes),
        "did": identity.did,
        "did_document": identity.did_document(),
    });
    let keypair_json = serde_json::to_string_pretty(&keypair_fixture).unwrap();
    std::fs::write("fixtures/test-keypair.json", &keypair_json).unwrap();
    println!("Wrote fixtures/test-keypair.json");
    println!("{}", keypair_json);

    // Sign a deterministic message (with fixed nonce and timestamp for reproducibility)
    // For cross-language testing, we serialize the signed message as-is
    let payload = serde_json::json!({
        "action": "resolve",
        "entity_id": "entity-abc-123",
        "source": "crm"
    });
    let signed = SignedMessage::sign(&keypair, payload.clone()).unwrap();

    let signed_fixture = serde_json::json!({
        "description": "Signed message for cross-language verification. Verify using the public key from test-keypair.json.",
        "signed_message": signed,
        "expected": {
            "signer_did": identity.did,
            "payload": payload,
            "signature_length_hex": 128,
            "content_hash_length_hex": 64,
            "content_hash": signed.content_hash(),
        }
    });
    let signed_json = serde_json::to_string_pretty(&signed_fixture).unwrap();
    std::fs::write("fixtures/test-signed-message.json", &signed_json).unwrap();
    println!("\nWrote fixtures/test-signed-message.json");
    println!("{}", signed_json);

    // Generate a provenance chain fixture
    let entry1 = ProvenanceEntry::create(
        &keypair,
        ActionType::Resolve,
        vec!["entity-abc-123".into()],
        vec![],
        serde_json::json!({"source": "crm"}),
    )
    .unwrap();

    let entry2 = ProvenanceEntry::create(
        &keypair,
        ActionType::Merge,
        vec!["entity-abc-123".into(), "entity-def-456".into()],
        vec![entry1.content_hash()],
        serde_json::json!({"reason": "duplicate detected", "confidence": 0.95}),
    )
    .unwrap();

    let provenance_fixture = serde_json::json!({
        "description": "Two-entry provenance chain. Entry 2 is parented to entry 1 via content_hash.",
        "entries": [entry1, entry2],
        "expected": {
            "entry_0_agent_did": identity.did,
            "entry_0_parent_count": 0,
            "entry_1_parent_count": 1,
            "entry_1_parent_is_entry_0_hash": true,
        }
    });
    let provenance_json = serde_json::to_string_pretty(&provenance_fixture).unwrap();
    std::fs::write("fixtures/test-provenance-chain.json", &provenance_json).unwrap();
    println!("\nWrote fixtures/test-provenance-chain.json");
}
