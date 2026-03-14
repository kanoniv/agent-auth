import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { v4 as uuidv4 } from "uuid";
import type { AgentIdentity, AgentKeyPair } from "./identity.js";
import { bytesToHex, hexToBytes } from "./identity.js";
import { CryptoError } from "./error.js";

/** A cryptographically signed message envelope. */
export interface SignedMessage {
  /** The message payload (arbitrary JSON) */
  payload: unknown;
  /** DID of the signer */
  signer_did: string;
  /** Unique nonce for replay protection */
  nonce: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Hex-encoded Ed25519 signature */
  signature: string;
}

/**
 * Produce the canonical byte representation for signing/verification.
 *
 * Canonical form: sorted-key JSON of {nonce, payload, signer_did, timestamp}.
 * Only the top-level envelope keys are sorted. The payload is serialized as-is.
 */
function canonicalBytes(
  payload: unknown,
  signerDid: string,
  nonce: string,
  timestamp: string,
): Uint8Array {
  // Build canonical JSON string with keys in alphabetical order.
  // We manually construct this to guarantee key ordering (not relying on
  // JS object key ordering which is implementation-dependent for integer keys).
  const payloadJson = JSON.stringify(payload);
  const canonical =
    `{"nonce":${JSON.stringify(nonce)}` +
    `,"payload":${payloadJson}` +
    `,"signer_did":${JSON.stringify(signerDid)}` +
    `,"timestamp":${JSON.stringify(timestamp)}}`;
  return new TextEncoder().encode(canonical);
}

/** Sign a payload with the given keypair. */
export function signMessage(
  keypair: AgentKeyPair,
  payload: unknown,
): SignedMessage {
  const nonce = uuidv4();
  const now = new Date();
  const timestamp = now.toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");

  const canonical = canonicalBytes(
    payload,
    keypair.identity.did,
    nonce,
    timestamp,
  );
  const signature = ed.sign(canonical, keypair.secretKey);
  const signatureHex = bytesToHex(signature);

  return {
    payload,
    signer_did: keypair.identity.did,
    nonce,
    timestamp,
    signature: signatureHex,
  };
}

/** Verify a signed message against a known public identity. */
export function verifyMessage(
  message: SignedMessage,
  identity: AgentIdentity,
): void {
  if (message.signer_did !== identity.did) {
    throw CryptoError.signatureInvalid();
  }

  const canonical = canonicalBytes(
    message.payload,
    message.signer_did,
    message.nonce,
    message.timestamp,
  );

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(message.signature);
  } catch {
    throw CryptoError.invalidSignatureEncoding("invalid hex");
  }

  if (sigBytes.length !== 64) {
    throw CryptoError.invalidSignatureEncoding("expected 64 bytes");
  }

  const valid = ed.verify(sigBytes, canonical, identity.publicKeyBytes);
  if (!valid) {
    throw CryptoError.signatureInvalid();
  }
}

/** Compute the SHA-256 content hash of a signed message. */
export function contentHash(message: SignedMessage): string {
  const serialized = JSON.stringify(message);
  const hash = sha256(new TextEncoder().encode(serialized));
  return bytesToHex(hash);
}
