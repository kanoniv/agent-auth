import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { CryptoError } from "./error.js";

// ed25519 requires sha512 for internal operations
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

/** Convert bytes to lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert hex string to bytes. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Public identity derived from a keypair - safe to share and store. */
export interface AgentIdentity {
  /** Decentralized identifier: did:kanoniv:{hex(sha256(pubkey)[..16])} */
  did: string;
  /** Raw public key bytes (32 bytes, Ed25519) */
  publicKeyBytes: Uint8Array;
}

/** Compute the DID from public key bytes. */
export function computeDid(publicKeyBytes: Uint8Array): string {
  const hash = sha256(publicKeyBytes);
  const shortHash = bytesToHex(hash.slice(0, 16));
  return `did:kanoniv:${shortHash}`;
}

/** Create an AgentIdentity from public key bytes. */
export function identityFromBytes(bytes: Uint8Array): AgentIdentity {
  if (bytes.length !== 32) {
    throw CryptoError.invalidKeyLength(bytes.length);
  }
  return {
    did: computeDid(bytes),
    publicKeyBytes: new Uint8Array(bytes),
  };
}

/** An agent's Ed25519 keypair. */
export interface AgentKeyPair {
  /** 32-byte secret key */
  secretKey: Uint8Array;
  /** Derived public identity */
  identity: AgentIdentity;
}

/** Generate a new random Ed25519 keypair. */
export function generateKeyPair(): AgentKeyPair {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(secretKey);
  const identity: AgentIdentity = {
    did: computeDid(publicKey),
    publicKeyBytes: publicKey,
  };
  return { secretKey, identity };
}

/** Reconstruct a keypair from 32-byte secret key. */
export function keyPairFromBytes(secret: Uint8Array): AgentKeyPair {
  if (secret.length !== 32) {
    throw CryptoError.invalidKeyLength(secret.length);
  }
  const publicKey = ed.getPublicKey(secret);
  const identity: AgentIdentity = {
    did: computeDid(publicKey),
    publicKeyBytes: publicKey,
  };
  return { secretKey: new Uint8Array(secret), identity };
}

/** Generate a W3C DID Document for an identity. */
export function didDocument(identity: AgentIdentity): Record<string, unknown> {
  const pkBase64 = Buffer.from(identity.publicKeyBytes).toString("base64");
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: identity.did,
    verificationMethod: [
      {
        id: `${identity.did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: identity.did,
        publicKeyBase64: pkBase64,
      },
    ],
    authentication: [`${identity.did}#key-1`],
    assertionMethod: [`${identity.did}#key-1`],
  };
}
