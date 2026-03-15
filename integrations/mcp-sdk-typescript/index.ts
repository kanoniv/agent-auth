/**
 * kanoniv-agent-auth middleware for the official MCP TypeScript SDK.
 *
 * Adds cryptographic agent identity and delegation verification
 * to any MCP server built with @modelcontextprotocol/sdk.
 *
 *     npm install @kanoniv/agent-auth @modelcontextprotocol/sdk
 *
 * Usage:
 *
 *     import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 *     import { withDelegationAuth } from "./index.js";
 *
 *     const server = new McpServer({ name: "my-server", version: "1.0.0" });
 *
 *     // Wrap tool registration with auth
 *     const auth = withDelegationAuth(server, {
 *       rootPublicKey: process.env.KANONIV_ROOT_PUBLIC_KEY!,
 *       mode: "required",  // "required" | "optional" | "disabled"
 *     });
 *
 *     // Register tools normally - auth is automatic
 *     server.registerTool("search", { ... }, async (args) => {
 *       // args are clean (no _proof)
 *       // auth.lastVerified has the chain info if proof was present
 *       return { content: [{ type: "text", text: "results" }] };
 *     });
 */

import {
  generateKeyPair,
  identityFromBytes,
  McpProof,
  verifyMcpCall,
  verifyMcpToolCall,
  type AgentIdentity,
  type McpAuthMode,
  type McpAuthOutcome,
  type McpProofData,
  type VerificationResult,
} from "@kanoniv/agent-auth";

export interface DelegationAuthOptions {
  /** Hex-encoded Ed25519 public key of the root authority (64 chars). */
  rootPublicKey: string;
  /** Auth enforcement mode. Default: "optional". */
  mode?: McpAuthMode;
  /** Called after successful verification. Use for logging/audit. */
  onVerified?: (result: VerificationResult, toolName: string) => void;
  /** Called when verification fails. Use for logging. */
  onDenied?: (error: Error, toolName: string) => void;
}

export interface DelegationAuth {
  /** The root identity derived from the public key. */
  rootIdentity: AgentIdentity;
  /** The last verification result (null if no proof or disabled). */
  lastVerified: VerificationResult | null;
  /**
   * Verify a tool call manually. Use this if you need custom logic
   * beyond the automatic middleware.
   */
  verify: (toolName: string, args: Record<string, unknown>) => McpAuthOutcome;
}

/**
 * Add delegation auth to an MCP server.
 *
 * This patches the server's tool call handling to automatically
 * extract and verify delegation proofs from tool arguments.
 *
 * The _proof field is stripped from arguments before they reach
 * your tool handler. If mode is "required" and no valid proof
 * is present, the tool call is rejected with an error.
 */
export function withDelegationAuth(
  server: any, // McpServer - using any to avoid import issues
  options: DelegationAuthOptions,
): DelegationAuth {
  const pkBytes = hexToBytes(options.rootPublicKey);
  const rootIdentity = identityFromBytes(pkBytes);
  const mode = options.mode ?? "optional";

  const auth: DelegationAuth = {
    rootIdentity,
    lastVerified: null,
    verify: (toolName: string, args: Record<string, unknown>) => {
      return verifyMcpToolCall(toolName, args, rootIdentity, mode);
    },
  };

  // Monkey-patch registerTool to wrap handlers with auth verification
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = (
    name: string,
    config: any,
    handler: (...handlerArgs: any[]) => any,
  ) => {
    const wrappedHandler = (...handlerArgs: any[]) => {
      // The first argument is the parsed tool input
      const toolInput = handlerArgs[0];

      if (toolInput && typeof toolInput === "object") {
        try {
          const outcome = verifyMcpToolCall(
            name,
            toolInput as Record<string, unknown>,
            rootIdentity,
            mode,
          );

          auth.lastVerified = outcome.verified;

          if (outcome.verified && options.onVerified) {
            options.onVerified(outcome.verified, name);
          }

          // Replace the first arg with cleaned args
          handlerArgs[0] = outcome.args;
        } catch (err: any) {
          if (options.onDenied) {
            options.onDenied(err, name);
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Delegation verification failed: ${err.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      return handler(...handlerArgs);
    };

    return originalRegisterTool(name, config, wrappedHandler);
  };

  return auth;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
