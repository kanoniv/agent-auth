import type { AgentIdentity, AgentKeyPair } from "./identity.js";
import {
  type SignedMessage,
  signMessage,
  verifyMessage,
  contentHash,
} from "./signing.js";

/** Standard action types. */
export const ACTION_TYPES = [
  "resolve",
  "merge",
  "split",
  "mutate",
  "ingest",
  "delegate",
  "revoke",
] as const;

/** Action type - either a standard type or a custom string. */
export type ActionType = (typeof ACTION_TYPES)[number] | { custom: string };

/** A signed provenance entry in the audit chain. */
export interface ProvenanceEntry {
  /** The DID of the agent that performed the action */
  agent_did: string;
  /** What action was performed */
  action: ActionType;
  /** Entity IDs affected by this action */
  entity_ids: string[];
  /** Parent provenance entry content hashes (for DAG chaining) */
  parent_ids: string[];
  /** Additional context */
  metadata: unknown;
  /** The signed envelope proving authenticity */
  signed_envelope: SignedMessage;
}

/** Serialize an action type for the signed payload. */
function serializeAction(action: ActionType): unknown {
  if (typeof action === "string") return action;
  return action;
}

/** Create and sign a new provenance entry. */
export function createProvenanceEntry(
  keypair: AgentKeyPair,
  action: ActionType,
  entityIds: string[],
  parentIds: string[],
  metadata: unknown,
): ProvenanceEntry {
  const payload = {
    agent_did: keypair.identity.did,
    action: serializeAction(action),
    entity_ids: entityIds,
    parent_ids: parentIds,
    metadata,
  };

  const signedEnvelope = signMessage(keypair, payload);

  return {
    agent_did: keypair.identity.did,
    action,
    entity_ids: entityIds,
    parent_ids: parentIds,
    metadata,
    signed_envelope: signedEnvelope,
  };
}

/** Verify a provenance entry's signature against a known identity. */
export function verifyProvenanceEntry(
  entry: ProvenanceEntry,
  identity: AgentIdentity,
): void {
  verifyMessage(entry.signed_envelope, identity);
}

/** Get the content hash of a provenance entry (usable as parent_id). */
export function provenanceContentHash(entry: ProvenanceEntry): string {
  return contentHash(entry.signed_envelope);
}
