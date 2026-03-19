import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateKeyPair,
  createReputationClaim,
  verifyReputationClaim,
  verifyReputationClaimSignatureOnly,
  reputationClaimContentHash,
} from "../index.js";

describe("ReputationClaim", () => {
  it("creates and verifies", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87, success_rate: 0.94 },
      "abc123hash",
    );

    assert.equal(claim.issuer_did, issuer.identity.did);
    assert.equal(claim.subject_did, subject.identity.did);
    assert.equal(claim.domain, "trading");
    assert.equal(claim.scores.composite, 87);
    assert.equal(claim.scores.success_rate, 0.94);
    assert.equal(claim.evidence_hash, "abc123hash");
    assert.ok(claim.issued_at);
    assert.equal(claim.expires_at, undefined);
    assert.doesNotThrow(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("verifies with expiry", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "research",
      { composite: 95 },
      "evidence-hash-456",
      expiresAt,
    );

    assert.equal(claim.expires_at, expiresAt);
    assert.doesNotThrow(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("expired claim still verifiable (caller decides policy)", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 50 },
      "old-evidence",
      pastDate,
    );

    // Cryptographically still valid - expiry is a policy decision
    assert.doesNotThrow(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("multi-issuer verification", () => {
    const kanoniv = generateKeyPair();
    const enterprise = generateKeyPair();
    const subject = generateKeyPair();

    const kanonivClaim = createReputationClaim(
      kanoniv,
      subject.identity.did,
      "merge_quality",
      { composite: 88 },
      "kanoniv-evidence",
    );

    const enterpriseClaim = createReputationClaim(
      enterprise,
      subject.identity.did,
      "merge_quality",
      { composite: 92 },
      "enterprise-evidence",
    );

    // Each claim verifiable with its own issuer
    assert.doesNotThrow(() =>
      verifyReputationClaim(kanonivClaim, kanoniv.identity),
    );
    assert.doesNotThrow(() =>
      verifyReputationClaim(enterpriseClaim, enterprise.identity),
    );

    // Cross-verification fails
    assert.throws(() =>
      verifyReputationClaim(kanonivClaim, enterprise.identity),
    );
    assert.throws(() =>
      verifyReputationClaim(enterpriseClaim, kanoniv.identity),
    );
  });

  it("tampered scores fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.scores = { composite: 99 };
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
    // Signature-only still passes
    assert.doesNotThrow(() =>
      verifyReputationClaimSignatureOnly(claim, issuer.identity),
    );
  });

  it("tampered subject_did fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.subject_did = "did:agent:tampered";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("tampered domain fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.domain = "tampered_domain";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("tampered evidence_hash fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.evidence_hash = "tampered-hash";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("tampered issuer_did fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.issuer_did = "did:agent:tampered";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("content hash is deterministic", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    assert.equal(
      reputationClaimContentHash(claim),
      reputationClaimContentHash(claim),
    );
  });

  it("different claims have different content hashes", () => {
    const issuer = generateKeyPair();
    const subjectA = generateKeyPair();
    const subjectB = generateKeyPair();

    const claimA = createReputationClaim(
      issuer,
      subjectA.identity.did,
      "trading",
      { composite: 87 },
      "evidence-a",
    );

    const claimB = createReputationClaim(
      issuer,
      subjectB.identity.did,
      "research",
      { composite: 50 },
      "evidence-b",
    );

    assert.notEqual(
      reputationClaimContentHash(claimA),
      reputationClaimContentHash(claimB),
    );
  });

  it("content hash usable as reference", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    const hash = reputationClaimContentHash(claim);
    assert.ok(hash.length === 64, "Content hash should be 64 hex chars");
    assert.ok(/^[0-9a-f]{64}$/.test(hash), "Content hash should be hex");
  });

  it("handles empty scores object", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      {},
      "evidence-hash",
    );

    assert.deepEqual(claim.scores, {});
    assert.doesNotThrow(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("handles many score dimensions", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const scores = {
      composite: 87,
      success_rate: 0.94,
      latency_p99: 42.5,
      throughput: 1200,
      error_rate: 0.001,
    };
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "performance",
      scores,
      "perf-evidence",
    );

    assert.equal(Object.keys(claim.scores).length, 5);
    assert.doesNotThrow(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("tampered issued_at fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    claim.issued_at = "2020-01-01T00:00:00.000Z";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("tampered expires_at fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
      expiresAt,
    );

    claim.expires_at = "2099-12-31T23:59:59.000Z";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("adding expires_at to claim without it fails verify", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();
    // Created without expiresAt
    const claim = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "evidence-hash",
    );

    assert.equal(claim.expires_at, undefined);
    // Tamper: add an expires_at that was not signed
    claim.expires_at = "2099-12-31T23:59:59.000Z";
    assert.throws(() => verifyReputationClaim(claim, issuer.identity));
  });

  it("same issuer different domains produce different hashes", () => {
    const issuer = generateKeyPair();
    const subject = generateKeyPair();

    const claim1 = createReputationClaim(
      issuer,
      subject.identity.did,
      "trading",
      { composite: 87 },
      "same-evidence",
    );

    const claim2 = createReputationClaim(
      issuer,
      subject.identity.did,
      "research",
      { composite: 87 },
      "same-evidence",
    );

    assert.notEqual(
      reputationClaimContentHash(claim1),
      reputationClaimContentHash(claim2),
    );
  });
});
