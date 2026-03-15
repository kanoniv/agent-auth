# MCP SDK Middleware (TypeScript)

Add cryptographic agent delegation to any MCP server built with the official `@modelcontextprotocol/sdk`.

## Install

```bash
npm install @kanoniv/agent-auth @modelcontextprotocol/sdk
```

## Usage

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { withDelegationAuth } from "./index.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Add delegation auth - one line
const auth = withDelegationAuth(server, {
  rootPublicKey: process.env.KANONIV_ROOT_PUBLIC_KEY!,
  mode: "required",
  onVerified: (result, tool) => {
    console.error(`[auth] ${tool}: ${result.invoker_did} (depth ${result.depth})`);
  },
  onDenied: (err, tool) => {
    console.error(`[auth] ${tool} DENIED: ${err.message}`);
  },
});

// Register tools normally - auth is automatic
server.registerTool(
  "search",
  {
    description: "Search for records",
    inputSchema: z.object({ query: z.string() }),
  },
  async ({ query }) => {
    // query is clean (no _proof field)
    return { content: [{ type: "text", text: `Results for: ${query}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Auth Modes

- `"required"` - Reject tool calls without a valid delegation proof
- `"optional"` - Verify if `_proof` is present, allow unauthenticated calls
- `"disabled"` - Skip verification, strip `_proof` from args

## How It Works

The middleware patches `server.registerTool()` to wrap every tool handler with delegation verification. When a tool is called:

1. Extracts `_proof` from tool arguments
2. Verifies the delegation chain against the root public key
3. Strips `_proof` from arguments before passing to your handler
4. If verification fails in `required` mode, returns an error without calling your handler

Your tool handlers never see the `_proof` field - they receive clean, verified arguments.
