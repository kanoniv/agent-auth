export { CryptoError } from "./error.js";
export {
  type AgentIdentity,
  type AgentKeyPair,
  generateKeyPair,
  keyPairFromBytes,
  computeDid,
  identityFromBytes,
  didDocument,
  bytesToHex,
  hexToBytes,
} from "./identity.js";
export {
  type SignedMessage,
  signMessage,
  verifyMessage,
  contentHash,
} from "./signing.js";
export {
  type ActionType,
  type ProvenanceEntry,
  createProvenanceEntry,
  verifyProvenanceEntry,
  provenanceContentHash,
  ACTION_TYPES,
} from "./provenance.js";
