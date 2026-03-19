//! Generate cross-language test fixtures.
//!
//! Run with: cargo run --example generate_fixtures

use kanoniv_agent_auth::{
    ActionType, AgentKeyPair, Caveat, Delegation, Invocation, ProvenanceEntry, SignedMessage,
};

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

    // ---------------------------------------------------------------
    // Delegation + Invocation + Caveat Enforcement Fixtures
    // ---------------------------------------------------------------

    // Second keypair for the delegate agent
    let delegate_secret: [u8; 32] = [
        0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18, 0x29, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f,
        0x90, 0x01, 0x12, 0x23, 0x34, 0x45, 0x56, 0x67, 0x78, 0x89, 0x9a, 0xab, 0xbc, 0xcd, 0xde,
        0xef, 0xf0,
    ];
    let delegate_keypair = AgentKeyPair::from_bytes(&delegate_secret);
    let delegate_identity = delegate_keypair.identity();

    // Root delegation: issuer -> delegate with action_scope + max_cost caveats
    let root_delegation = Delegation::create_root(
        &keypair,
        &delegate_identity.did,
        vec![
            Caveat::ActionScope(vec!["write".into(), "edit".into(), "publish".into()]),
            Caveat::MaxCost(500.0),
        ],
    )
    .unwrap();

    let root_delegation_hash = root_delegation.proof.content_hash();

    // Invocation that should PASS (action in scope, cost under limit)
    let pass_invocation = Invocation::create(
        &delegate_keypair,
        "write",
        serde_json::json!({"topic": "blog post", "cost": 50}),
        root_delegation.clone(),
    )
    .unwrap();

    let pass_result =
        kanoniv_agent_auth::verify_invocation(&pass_invocation, &delegate_identity, &identity)
            .unwrap();

    // Sub-delegation: delegate -> sub_delegate with narrower scope
    let sub_secret: [u8; 32] = [
        0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
        0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0,
        0xf0, 0x01,
    ];
    let sub_keypair = AgentKeyPair::from_bytes(&sub_secret);
    let sub_identity = sub_keypair.identity();

    let sub_delegation = Delegation::delegate(
        &delegate_keypair,
        &sub_identity.did,
        vec![
            Caveat::ActionScope(vec!["write".into()]),
            Caveat::MaxCost(100.0),
        ],
        root_delegation.clone(),
    )
    .unwrap();

    let sub_delegation_hash = sub_delegation.proof.content_hash();

    // Sub-delegate invocation that should PASS
    let sub_pass_invocation = Invocation::create(
        &sub_keypair,
        "write",
        serde_json::json!({"topic": "draft", "cost": 75}),
        sub_delegation.clone(),
    )
    .unwrap();

    let sub_pass_result =
        kanoniv_agent_auth::verify_invocation(&sub_pass_invocation, &sub_identity, &identity)
            .unwrap();

    let delegation_fixture = serde_json::json!({
        "description": "Delegation chain with caveat enforcement test vectors. Root -> Delegate (write/edit/publish, $500) -> SubDelegate (write, $100).",
        "root_keypair": {
            "secret_key_hex": hex::encode(secret),
            "public_key_hex": hex::encode(&identity.public_key_bytes),
            "did": identity.did,
        },
        "delegate_keypair": {
            "secret_key_hex": hex::encode(delegate_secret),
            "public_key_hex": hex::encode(&delegate_identity.public_key_bytes),
            "did": delegate_identity.did,
        },
        "sub_delegate_keypair": {
            "secret_key_hex": hex::encode(sub_secret),
            "public_key_hex": hex::encode(&sub_identity.public_key_bytes),
            "did": sub_identity.did,
        },
        "root_delegation": root_delegation,
        "root_delegation_content_hash": root_delegation_hash,
        "sub_delegation": sub_delegation,
        "sub_delegation_content_hash": sub_delegation_hash,
        "test_cases": {
            "pass_in_scope": {
                "agent": "delegate",
                "action": "write",
                "args": {"topic": "blog post", "cost": 50},
                "expected": "pass",
                "expected_depth": pass_result.depth,
            },
            "pass_sub_delegate": {
                "agent": "sub_delegate",
                "action": "write",
                "args": {"topic": "draft", "cost": 75},
                "expected": "pass",
                "expected_depth": sub_pass_result.depth,
            },
            "fail_wrong_scope": {
                "agent": "delegate",
                "action": "spend",
                "args": {"platform": "ads", "cost": 50},
                "expected": "fail",
                "expected_reason": "action_scope",
            },
            "fail_over_budget": {
                "agent": "delegate",
                "action": "write",
                "args": {"topic": "expensive", "cost": 600},
                "expected": "fail",
                "expected_reason": "max_cost",
            },
            "fail_sub_over_budget": {
                "agent": "sub_delegate",
                "action": "write",
                "args": {"topic": "too expensive", "cost": 150},
                "expected": "fail",
                "expected_reason": "max_cost",
            },
            "fail_sub_wrong_scope": {
                "agent": "sub_delegate",
                "action": "edit",
                "args": {"topic": "not allowed", "cost": 10},
                "expected": "fail",
                "expected_reason": "action_scope",
            },
        },
    });
    let delegation_json = serde_json::to_string_pretty(&delegation_fixture).unwrap();
    std::fs::write("fixtures/test-delegation-chain.json", &delegation_json).unwrap();
    println!("\nWrote fixtures/test-delegation-chain.json");
}
