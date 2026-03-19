export { CryptoError } from "./error.js";
export {
  type AgentIdentity,
  type AgentKeyPair,
  type ServiceEndpoint,
  generateKeyPair,
  keyPairFromBytes,
  computeDid,
  identityFromBytes,
  identityFromMultibase,
  encodeMultibaseEd25519,
  didDocument,
  didDocumentWithServices,
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
  verifyProvenanceSignatureOnly,
  provenanceContentHash,
  ACTION_TYPES,
} from "./provenance.js";
export {
  type Caveat,
  type Delegation,
  type Invocation,
  type VerificationResult,
  MAX_CHAIN_DEPTH,
  createRootDelegation,
  delegateAuthority,
  createInvocation,
  verifyInvocation,
  verifyInvocationWithRevocation,
} from "./delegation.js";
export {
  type McpProofData,
  type McpAuthMode,
  type McpAuthOutcome,
  McpProof,
  verifyMcpCall,
  verifyMcpCallWithRevocation,
  verifyMcpToolCall,
  verifyMcpToolCallWithRevocation,
} from "./mcp.js";
export {
  type ReputationClaim,
  createReputationClaim,
  verifyReputationClaim,
  verifyReputationClaimSignatureOnly,
  reputationClaimContentHash,
} from "./reputation.js";
