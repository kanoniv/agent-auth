import type { AgentIdentity, AgentKeyPair } from "./identity.js";
import {
  type SignedMessage,
  signMessage,
  verifyMessage,
  contentHash,
} from "./signing.js";
import { CryptoError } from "./error.js";

/** A signed reputation claim issued by one DID about another. */
export interface ReputationClaim {
  /** DID of the system or agent issuing the claim (e.g. Kanoniv) */
  issuer_did: string;
  /** DID of the agent being rated */
  subject_did: string;
  /** Domain of the reputation (e.g. "trading", "research", "merge_quality") */
  domain: string;
  /** Multi-dimensional scores (e.g. {"composite": 87, "success_rate": 0.94}) */
  scores: Record<string, number>;
  /** SHA-256 hash of the evidence data (addressable reference) */
  evidence_hash: string;
  /** RFC 3339 timestamp of when the claim was issued */
  issued_at: string;
  /** Optional RFC 3339 expiry timestamp */
  expires_at?: string;
  /** Ed25519 signature proving authenticity */
  signed_envelope: SignedMessage;
}

/**
 * Create and sign a new reputation claim.
 *
 * The issuer signs a claim about a subject's reputation in a specific domain.
 * The evidence_hash references the underlying data (e.g. memory:kanoniv:<hash>)
 * so the claim is verifiable without embedding the full evidence.
 */
export function createReputationClaim(
  issuerKeypair: AgentKeyPair,
  subjectDid: string,
  domain: string,
  scores: Record<string, number>,
  evidenceHash: string,
  expiresAt?: string,
): ReputationClaim {
  const issuedAt = new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");

  const payload = {
    issuer_did: issuerKeypair.identity.did,
    subject_did: subjectDid,
    domain,
    scores,
    evidence_hash: evidenceHash,
    issued_at: issuedAt,
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
  };

  const signedEnvelope = signMessage(issuerKeypair, payload);

  return {
    issuer_did: issuerKeypair.identity.did,
    subject_did: subjectDid,
    domain,
    scores,
    evidence_hash: evidenceHash,
    issued_at: issuedAt,
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    signed_envelope: signedEnvelope,
  };
}

/**
 * Verify a reputation claim: signature AND outer field integrity.
 *
 * Checks that the signature is valid and that outer fields match
 * what was actually signed in the envelope payload.
 */
export function verifyReputationClaim(
  claim: ReputationClaim,
  issuerIdentity: AgentIdentity,
): void {
  // 1. Verify the cryptographic signature
  verifyMessage(claim.signed_envelope, issuerIdentity);

  // 2. Verify outer fields match the signed payload
  const payload = claim.signed_envelope.payload as Record<string, unknown>;

  if (payload.issuer_did !== claim.issuer_did) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'issuer_did' does not match signed payload",
    );
  }

  if (payload.subject_did !== claim.subject_did) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'subject_did' does not match signed payload",
    );
  }

  if (payload.domain !== claim.domain) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'domain' does not match signed payload",
    );
  }

  if (JSON.stringify(payload.scores) !== JSON.stringify(claim.scores)) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'scores' does not match signed payload",
    );
  }

  if (payload.evidence_hash !== claim.evidence_hash) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'evidence_hash' does not match signed payload",
    );
  }

  if (payload.issued_at !== claim.issued_at) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'issued_at' does not match signed payload",
    );
  }

  if (JSON.stringify(payload.expires_at) !== JSON.stringify(claim.expires_at)) {
    throw new CryptoError(
      "SIGNATURE_INVALID",
      "Integrity check failed: outer field 'expires_at' does not match signed payload",
    );
  }
}

/**
 * Verify only the cryptographic signature, without checking field integrity.
 *
 * Use verifyReputationClaim() instead unless you have a specific reason
 * to skip integrity checks.
 */
export function verifyReputationClaimSignatureOnly(
  claim: ReputationClaim,
  issuerIdentity: AgentIdentity,
): void {
  verifyMessage(claim.signed_envelope, issuerIdentity);
}

/** Get the content hash of a reputation claim (for chaining/referencing). */
export function reputationClaimContentHash(claim: ReputationClaim): string {
  return contentHash(claim.signed_envelope);
}
