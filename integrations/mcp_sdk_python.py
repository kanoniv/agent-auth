"""
kanoniv-agent-auth middleware for the official MCP Python SDK (FastMCP).

Adds cryptographic agent delegation to any MCP server built with
the `mcp` package's FastMCP class.

    pip install kanoniv-agent-auth mcp

Usage:

    from mcp.server.fastmcp import FastMCP
    from integrations.mcp_sdk_python import with_delegation_auth

    mcp = FastMCP("my-server")

    # Add delegation auth - one line
    auth = with_delegation_auth(mcp, root_public_key=os.environ["KANONIV_ROOT_PUBLIC_KEY"])

    @mcp.tool()
    def search(query: str) -> str:
        # query is clean (no _proof). Auth was verified before this runs.
        return f"Results for: {query}"
"""

import json
import functools
import os
from typing import Callable, Optional

from kanoniv_agent_auth import (
    AgentKeyPair,
    AgentIdentity,
    McpProof,
    verify_mcp_call,
    extract_mcp_proof,
    inject_mcp_proof,
)


class DelegationAuth:
    """Holds delegation auth state for an MCP server."""

    def __init__(self, root_identity, mode="optional"):
        self.root_identity = root_identity
        self.mode = mode
        self.last_verified = None

    def verify(self, args_json):
        """Verify a tool call's delegation proof.

        Returns (proof_result_or_none, clean_args_json).
        Raises ValueError if mode is 'required' and no valid proof.
        """
        proof, clean_json = extract_mcp_proof(args_json)

        if proof is not None:
            try:
                result = verify_mcp_call(proof, self.root_identity)
                self.last_verified = result
                return result, clean_json
            except ValueError as e:
                self.last_verified = None
                raise ValueError(f"Delegation verification failed: {e}") from e

        if self.mode == "required":
            raise ValueError(
                "Delegation proof required but no _proof found in tool arguments"
            )

        self.last_verified = None
        return None, clean_json


def with_delegation_auth(
    mcp_server,
    root_public_key: str,
    mode: str = "optional",
    on_verified: Optional[Callable] = None,
    on_denied: Optional[Callable] = None,
) -> DelegationAuth:
    """Add delegation auth to a FastMCP server.

    Patches the server's tool decorator to wrap every tool handler
    with delegation proof verification.

    Args:
        mcp_server: A FastMCP instance.
        root_public_key: Hex-encoded Ed25519 public key (64 chars).
        mode: "required" | "optional" | "disabled". Default: "optional".
        on_verified: Called with (result_tuple, tool_name) on success.
        on_denied: Called with (error, tool_name) on failure.

    Returns:
        DelegationAuth instance for manual verification or inspection.
    """
    pk_bytes = bytes.fromhex(root_public_key)
    root_identity = AgentIdentity.from_bytes(pk_bytes)
    auth = DelegationAuth(root_identity, mode)

    if mode == "disabled":
        return auth

    # Patch the @mcp.tool() decorator
    original_tool = mcp_server.tool

    def patched_tool(*args, **kwargs):
        decorator = original_tool(*args, **kwargs)

        def wrapper(func):
            @functools.wraps(func)
            def auth_wrapper(**tool_kwargs):
                # Check if _proof is in the kwargs
                proof_data = tool_kwargs.pop("_proof", None)

                if proof_data is not None:
                    # Reconstruct the args with _proof for verification
                    args_with_proof = {**tool_kwargs, "_proof": proof_data}
                    args_json = json.dumps(args_with_proof)
                    try:
                        result, clean_json = auth.verify(args_json)
                        if result and on_verified:
                            on_verified(result, func.__name__)
                        # Use cleaned kwargs (without _proof)
                        clean_kwargs = json.loads(clean_json)
                        return func(**clean_kwargs)
                    except ValueError as e:
                        if on_denied:
                            on_denied(e, func.__name__)
                        raise
                elif mode == "required":
                    err = ValueError(
                        "Delegation proof required but no _proof in arguments"
                    )
                    if on_denied:
                        on_denied(err, func.__name__)
                    raise err

                return func(**tool_kwargs)

            return decorator(auth_wrapper)

        return wrapper

    mcp_server.tool = patched_tool
    return auth


if __name__ == "__main__":
    print("=== MCP SDK (Python) Delegation Auth Demo ===\n")

    # Generate test keys
    root = AgentKeyPair.generate()
    agent = AgentKeyPair.generate()
    root_hex = root.identity().public_key_bytes.hex()

    print(f"Root DID:  {root.identity().did}")
    print(f"Agent DID: {agent.identity().did}")
    print(f"Root key:  {root_hex[:16]}...")

    # Simulate FastMCP-style usage
    from kanoniv_agent_auth import Delegation

    # Create delegation
    d = Delegation.create_root(
        root, agent.identity().did,
        '[{"type": "action_scope", "value": ["search"]}]'
    )

    # Create proof
    proof = McpProof.create(agent, "search", '{"query": "AI agents"}', d)

    # Verify via DelegationAuth
    auth = DelegationAuth(root.identity(), mode="required")

    args_with_proof = inject_mcp_proof(proof, '{"query": "AI agents"}')
    result, clean = auth.verify(args_with_proof)

    print(f"\n[1] Verified: invoker={result[0][:30]}... depth={result[3]}")

    clean_parsed = json.loads(clean)
    print(f"[2] Clean args: {clean_parsed}")
    print(f"[3] _proof stripped: {'_proof' not in clean_parsed}")

    # Test required mode without proof
    print("\n[4] No proof in required mode...")
    try:
        auth.verify('{"query": "no proof here"}')
    except ValueError as e:
        print(f"    Blocked: {e}")

    print("\nDone.")
