#!/usr/bin/env node
/**
 * kanoniv-agent-auth CLI
 *
 * Cryptographic identity and delegation for AI agents.
 *
 * Commands:
 *   generate   - Generate an Ed25519 keypair and did:agent: DID
 *   delegate   - Create a delegation from root to agent
 *   prove      - Create an MCP proof for a tool call
 *   verify     - Verify a delegation proof
 *   inspect    - Inspect a delegation or proof file
 *   did        - Show DID Document for a key
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateKeyPair,
  keyPairFromBytes,
  identityFromBytes,
  bytesToHex,
  hexToBytes,
  didDocument,
  createRootDelegation,
  delegateAuthority,
  McpProof,
  verifyMcpCall,
  type AgentKeyPair,
  type Delegation,
  type Caveat,
} from "./index.js";

const KEYS_DIR = path.join(os.homedir(), ".kanoniv", "keys");

function ensureKeysDir() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

function saveKey(name: string, keypair: AgentKeyPair): string {
  ensureKeysDir();
  const keyPath = path.join(KEYS_DIR, `${name}.key`);
  const data = {
    did: keypair.identity.did,
    public_key: bytesToHex(keypair.identity.publicKeyBytes),
    secret_key: bytesToHex(keypair.secretKey),
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(keyPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  return keyPath;
}

function loadKey(nameOrPath: string): AgentKeyPair {
  let keyPath: string;
  if (fs.existsSync(nameOrPath)) {
    keyPath = nameOrPath;
  } else {
    keyPath = path.join(KEYS_DIR, `${nameOrPath}.key`);
  }
  if (!fs.existsSync(keyPath)) {
    error(`Key not found: ${keyPath}`);
  }
  const data = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return keyPairFromBytes(hexToBytes(data.secret_key));
}

function loadPublicKey(didOrPath: string) {
  // If it looks like a DID, search keys dir
  if (didOrPath.startsWith("did:agent:")) {
    const files = fs.existsSync(KEYS_DIR) ? fs.readdirSync(KEYS_DIR) : [];
    for (const f of files) {
      if (!f.endsWith(".key")) continue;
      const data = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, f), "utf-8"));
      if (data.did === didOrPath) {
        return identityFromBytes(hexToBytes(data.public_key));
      }
    }
    error(`No key found for DID: ${didOrPath}`);
  }
  // Otherwise load as file
  const keypair = loadKey(didOrPath);
  return keypair.identity;
}

function error(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseCaveats(args: string[]): Caveat[] {
  const caveats: Caveat[] = [];

  const scope = getFlag(args, "--scope");
  if (scope) {
    caveats.push({ type: "action_scope", value: scope.split(",") });
  }

  const maxCost = getFlag(args, "--max-cost");
  if (maxCost) {
    caveats.push({ type: "max_cost", value: parseFloat(maxCost) });
  }

  const expires = getFlag(args, "--expires");
  if (expires) {
    let expiryDate: string;
    if (expires.endsWith("h")) {
      const hours = parseInt(expires);
      expiryDate = new Date(Date.now() + hours * 3600000).toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
    } else if (expires.endsWith("d")) {
      const days = parseInt(expires);
      expiryDate = new Date(Date.now() + days * 86400000).toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
    } else {
      expiryDate = expires; // Assume ISO 8601
    }
    caveats.push({ type: "expires_at", value: expiryDate });
  }

  const resource = getFlag(args, "--resource");
  if (resource) {
    caveats.push({ type: "resource", value: resource });
  }

  return caveats;
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// --- Commands ---

function cmdGenerate(args: string[]) {
  const name = getFlag(args, "--name") || "agent";
  const keypair = generateKeyPair();
  const keyPath = saveKey(name, keypair);

  console.log(keypair.identity.did);
  console.error(`Secret key saved to ${keyPath}`);
}

function cmdDelegate(args: string[]) {
  const toDidOrName = getFlag(args, "--to");
  const fromName = getFlag(args, "--from") || "root";
  const output = getFlag(args, "--output") || "delegation.json";

  if (!toDidOrName) error("--to is required (DID or key name)");

  const fromKeypair = loadKey(fromName);
  let toDid: string;
  if (toDidOrName!.startsWith("did:agent:")) {
    toDid = toDidOrName!;
  } else {
    const toKeypair = loadKey(toDidOrName!);
    toDid = toKeypair.identity.did;
  }

  const parentFile = getFlag(args, "--parent");
  const caveats = parseCaveats(args);

  let delegation: Delegation;
  if (parentFile) {
    const parent = JSON.parse(fs.readFileSync(parentFile, "utf-8")) as Delegation;
    delegation = delegateAuthority(fromKeypair, toDid, caveats, parent);
  } else {
    delegation = createRootDelegation(fromKeypair, toDid, caveats);
  }

  fs.writeFileSync(output, JSON.stringify(delegation, null, 2) + "\n");

  console.log(`Delegation saved to ${output}`);
  console.error(`  from: ${fromKeypair.identity.did}`);
  console.error(`  to:   ${toDid}`);
  if (caveats.length > 0) {
    for (const c of caveats) {
      console.error(`  caveat: ${c.type} = ${JSON.stringify(c.value)}`);
    }
  }
}

function cmdProve(args: string[]) {
  const action = getFlag(args, "--action");
  const argsJson = getFlag(args, "--args") || "{}";
  const delegationFile = getFlag(args, "--delegation") || "delegation.json";
  const keyName = getFlag(args, "--key") || "agent";
  const output = getFlag(args, "--output");

  if (!action) error("--action is required");

  const keypair = loadKey(keyName);
  const delegation = JSON.parse(fs.readFileSync(delegationFile, "utf-8")) as Delegation;
  const parsedArgs = JSON.parse(argsJson);

  const proof = McpProof.create(keypair, action!, parsedArgs, delegation);
  const proofJson = JSON.stringify(proof, null, 2);

  if (output) {
    fs.writeFileSync(output, proofJson + "\n");
    console.error(`Proof saved to ${output}`);
  } else {
    console.log(proofJson);
  }
}

function cmdVerify(args: string[]) {
  const proofFile = getFlag(args, "--proof");
  const rootDid = getFlag(args, "--root");
  const rootKey = getFlag(args, "--root-key");

  if (!proofFile) error("--proof is required");

  const proof = JSON.parse(fs.readFileSync(proofFile!, "utf-8"));

  let rootIdentity;
  if (rootKey) {
    rootIdentity = identityFromBytes(hexToBytes(rootKey));
  } else if (rootDid) {
    rootIdentity = loadPublicKey(rootDid);
  } else {
    error("--root (DID) or --root-key (hex public key) is required");
  }

  try {
    const result = verifyMcpCall(proof, rootIdentity!);
    console.log(`VERIFIED`);
    console.log(`  invoker: ${result.invoker_did}`);
    console.log(`  root:    ${result.root_did}`);
    console.log(`  depth:   ${result.depth}`);
    console.log(`  chain:   ${result.chain.join(" -> ")}`);
  } catch (err: any) {
    console.log(`DENIED`);
    console.log(`  reason: ${err.message}`);
    process.exit(1);
  }
}

function cmdInspect(args: string[]) {
  const file = args[1];
  if (!file) error("Usage: inspect <file.json>");

  const data = JSON.parse(fs.readFileSync(file, "utf-8"));

  if (data.invocation && data.invoker_public_key) {
    // McpProof
    console.log("Type: McpProof");
    console.log(`  invoker_did:  ${data.invocation.invoker_did}`);
    console.log(`  action:       ${data.invocation.action}`);
    console.log(`  public_key:   ${data.invoker_public_key.slice(0, 16)}...`);
    console.log(`  delegation:`);
    console.log(`    issuer:     ${data.invocation.delegation.issuer_did}`);
    console.log(`    delegate:   ${data.invocation.delegation.delegate_did}`);
    console.log(`    depth:      ${countDepth(data.invocation.delegation)}`);
    console.log(`    caveats:    ${data.invocation.delegation.caveats.length}`);
    for (const c of data.invocation.delegation.caveats) {
      console.log(`      ${c.type}: ${JSON.stringify(c.value)}`);
    }
  } else if (data.issuer_did && data.delegate_did) {
    // Delegation
    console.log("Type: Delegation");
    console.log(`  issuer:     ${data.issuer_did}`);
    console.log(`  delegate:   ${data.delegate_did}`);
    console.log(`  depth:      ${countDepth(data)}`);
    console.log(`  caveats:    ${data.caveats.length}`);
    for (const c of data.caveats) {
      console.log(`    ${c.type}: ${JSON.stringify(c.value)}`);
    }
  } else {
    console.log("Unknown file format");
    console.log(JSON.stringify(data, null, 2));
  }
}

function countDepth(delegation: any): number {
  let depth = 0;
  let current = delegation;
  while (current.parent_proof) {
    depth++;
    current = current.parent_proof;
  }
  return depth;
}

function cmdDid(args: string[]) {
  const name = getFlag(args, "--key") || "agent";
  const keypair = loadKey(name);
  const doc = didDocument(keypair.identity);
  console.log(JSON.stringify(doc, null, 2));
}

function cmdHelp() {
  console.log(`kanoniv-agent-auth - Cryptographic identity and delegation for AI agents

Commands:
  generate                    Generate an Ed25519 keypair and did:agent: DID
    --name <name>             Key name (default: "agent")

  delegate                    Create a delegation chain
    --from <name>             Issuer key name (default: "root")
    --to <did|name>           Delegate DID or key name (required)
    --scope <a,b,c>           Allowed actions (comma-separated)
    --max-cost <n>            Maximum cost per invocation
    --expires <24h|7d|ISO>    Expiry (hours, days, or ISO 8601)
    --resource <pattern>      Resource glob pattern
    --parent <file>           Parent delegation file (for chaining)
    --output <file>           Output file (default: delegation.json)

  prove                       Create an MCP proof for a tool call
    --action <name>           Tool/action name (required)
    --args <json>             Tool arguments as JSON (default: "{}")
    --delegation <file>       Delegation file (default: delegation.json)
    --key <name>              Agent key name (default: "agent")
    --output <file>           Output file (default: stdout)

  verify                      Verify a delegation proof
    --proof <file>            Proof file (required)
    --root <did>              Root authority DID
    --root-key <hex>          Root authority public key (hex)

  inspect <file>              Inspect a delegation or proof file

  did                         Show DID Document
    --key <name>              Key name (default: "agent")

  help                        Show this help

Examples:
  $ npx @kanoniv/agent-auth generate --name root
  $ npx @kanoniv/agent-auth generate --name agent
  $ npx @kanoniv/agent-auth delegate --from root --to agent --scope resolve,search --max-cost 5 --expires 24h
  $ npx @kanoniv/agent-auth prove --action resolve --args '{"query":"AI"}' --key agent
  $ npx @kanoniv/agent-auth verify --proof proof.json --root did:agent:4a1b...
`);
}

// --- Main ---

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "generate":
    cmdGenerate(args);
    break;
  case "delegate":
    cmdDelegate(args);
    break;
  case "prove":
    cmdProve(args);
    break;
  case "verify":
    cmdVerify(args);
    break;
  case "inspect":
    cmdInspect(args);
    break;
  case "did":
    cmdDid(args);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    cmdHelp();
    break;
  default:
    error(`Unknown command: ${command}. Run 'npx @kanoniv/agent-auth help' for usage.`);
}
