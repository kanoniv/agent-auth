import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateKeyPair,
  keyPairFromBytes,
  hexToBytes,
  signMessage,
  verifyMessage,
  contentHash,
} from "../index.js";

describe("SignedMessage", () => {
  it("signs and verifies", () => {
    const kp = generateKeyPair();
    const payload = { action: "merge", entity_id: "abc123" };
    const signed = signMessage(kp, payload);

    assert.doesNotThrow(() => verifyMessage(signed, kp.identity));
  });

  it("tampered payload fails", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, { action: "merge" });
    signed.payload = { action: "split" };

    assert.throws(() => verifyMessage(signed, kp.identity));
  });

  it("tampered nonce fails", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, { data: "test" });
    signed.nonce = "tampered-nonce";

    assert.throws(() => verifyMessage(signed, kp.identity));
  });

  it("wrong identity fails", () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const signed = signMessage(kp1, { data: "test" });

    assert.throws(() => verifyMessage(signed, kp2.identity));
  });

  it("nonces are unique", () => {
    const kp = generateKeyPair();
    const s1 = signMessage(kp, { data: "test" });
    const s2 = signMessage(kp, { data: "test" });
    assert.notEqual(s1.nonce, s2.nonce);
  });

  it("signature is 128 hex chars", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    assert.equal(signed.signature.length, 128);
    assert.ok(/^[0-9a-f]+$/.test(signed.signature));
  });

  it("signer_did is populated", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    assert.ok(signed.signer_did.startsWith("did:kanoniv:"));
    assert.equal(signed.signer_did, kp.identity.did);
  });

  it("timestamp ends with Z", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    assert.ok(signed.timestamp.endsWith("Z"));
  });

  it("content hash is deterministic", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, { x: 1 });
    assert.equal(contentHash(signed), contentHash(signed));
  });

  it("content hash is 64 hex chars (SHA-256)", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    const hash = contentHash(signed);
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(hash));
  });

  it("serialization roundtrip preserves verification", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, { key: "value" });
    const json = JSON.stringify(signed);
    const deserialized = JSON.parse(json);
    assert.doesNotThrow(() => verifyMessage(deserialized, kp.identity));
  });

  it("invalid hex signature throws", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    signed.signature = "not-hex!";
    assert.throws(() => verifyMessage(signed, kp.identity));
  });

  it("tampered timestamp fails", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, { x: 1 });
    signed.timestamp = "2020-01-01T00:00:00.000Z";
    assert.throws(() => verifyMessage(signed, kp.identity));
  });

  it("tampered signer_did fails", () => {
    const kp = generateKeyPair();
    const signed = signMessage(kp, {});
    signed.signer_did = "did:kanoniv:0000000000000000000000000000fake";
    assert.throws(() => verifyMessage(signed, kp.identity));
  });
});

describe("Cross-language interop - signing", () => {
  it("verifies Rust-signed message", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const keypairPath = path.resolve(
      import.meta.dirname,
      "../../../fixtures/test-keypair.json",
    );
    const signedPath = path.resolve(
      import.meta.dirname,
      "../../../fixtures/test-signed-message.json",
    );

    const keypairFixture = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const signedFixture = JSON.parse(fs.readFileSync(signedPath, "utf-8"));

    const secret = hexToBytes(keypairFixture.secret_key_hex);
    const kp = keyPairFromBytes(secret);

    // Verify the Rust-signed message using the JS implementation
    const rustMessage = signedFixture.signed_message;
    assert.doesNotThrow(() => verifyMessage(rustMessage, kp.identity));
  });
});
