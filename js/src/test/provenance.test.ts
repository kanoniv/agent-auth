import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateKeyPair,
  createProvenanceEntry,
  verifyProvenanceEntry,
  provenanceContentHash,
} from "../index.js";

describe("ProvenanceEntry", () => {
  it("creates and verifies", () => {
    const kp = generateKeyPair();
    const entry = createProvenanceEntry(
      kp,
      "merge",
      ["entity-1", "entity-2"],
      [],
      { reason: "duplicate detected" },
    );

    assert.equal(entry.agent_did, kp.identity.did);
    assert.equal(entry.action, "merge");
    assert.equal(entry.entity_ids.length, 2);
    assert.doesNotThrow(() => verifyProvenanceEntry(entry, kp.identity));
  });

  it("chains entries via content hash", () => {
    const kp = generateKeyPair();

    const entry1 = createProvenanceEntry(
      kp,
      "resolve",
      ["entity-1"],
      [],
      {},
    );

    const entry2 = createProvenanceEntry(
      kp,
      "merge",
      ["entity-1", "entity-2"],
      [provenanceContentHash(entry1)],
      {},
    );

    assert.equal(entry2.parent_ids.length, 1);
    assert.equal(entry2.parent_ids[0], provenanceContentHash(entry1));
    assert.doesNotThrow(() => verifyProvenanceEntry(entry2, kp.identity));
  });

  it("cross-agent verification fails", () => {
    const kpA = generateKeyPair();
    const kpB = generateKeyPair();

    const entry = createProvenanceEntry(kpA, "delegate", [], [], {
      delegated_to: kpB.identity.did,
    });

    assert.doesNotThrow(() => verifyProvenanceEntry(entry, kpA.identity));
    assert.throws(() => verifyProvenanceEntry(entry, kpB.identity));
  });

  it("different entries have different content hashes", () => {
    const kp = generateKeyPair();
    const e1 = createProvenanceEntry(kp, "resolve", ["e1"], [], {});
    const e2 = createProvenanceEntry(kp, "merge", ["e2"], [], {});
    assert.notEqual(provenanceContentHash(e1), provenanceContentHash(e2));
  });

  it("content hash is deterministic", () => {
    const kp = generateKeyPair();
    const entry = createProvenanceEntry(kp, "resolve", ["e1"], [], {});
    assert.equal(provenanceContentHash(entry), provenanceContentHash(entry));
  });

  it("multi-parent chaining", () => {
    const kp = generateKeyPair();
    const e1 = createProvenanceEntry(kp, "resolve", ["a"], [], {});
    const e2 = createProvenanceEntry(kp, "resolve", ["b"], [], {});
    const e3 = createProvenanceEntry(
      kp,
      "merge",
      ["a", "b"],
      [provenanceContentHash(e1), provenanceContentHash(e2)],
      { merge_of: ["a", "b"] },
    );

    assert.equal(e3.parent_ids.length, 2);
    assert.doesNotThrow(() => verifyProvenanceEntry(e3, kp.identity));
  });
});
