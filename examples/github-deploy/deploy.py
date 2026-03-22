"""Step 2: Agent deploys using its scoped delegation token.

The agent verifies it has authority before acting, then signs
its execution for the audit trail.
"""

import os
import sys

from kanoniv_auth import verify, sign, ScopeViolation, TokenExpired

TOKEN_PATH = "/tmp/agent-token.txt"


def main():
    # Load token from env or file
    token = os.environ.get("KANONIV_TOKEN")
    if not token:
        try:
            with open(TOKEN_PATH) as f:
                token = f.read().strip()
        except FileNotFoundError:
            print("No token found. Run delegate.py first.")
            sys.exit(1)

    # --- The agent's workflow ---

    # 1. Verify we're authorized to deploy staging
    print("Verifying delegation for deploy.staging...")
    try:
        result = verify(action="deploy.staging", token=token)
        print(f"  AUTHORIZED: {result['scopes']}")
        print(f"  TTL: {result['ttl_remaining']:.0f}s remaining")
    except ScopeViolation as e:
        print(f"  {e}")
        sys.exit(1)
    except TokenExpired as e:
        print(f"  {e}")
        sys.exit(1)

    # 2. Try to deploy to prod (this MUST fail)
    print("\nAttempting deploy.prod (should fail)...")
    try:
        verify(action="deploy.prod", token=token)
        print("  ERROR: This should have failed!")
        sys.exit(1)
    except ScopeViolation as e:
        print(f"  Correctly denied:")
        print(f"  {e}")

    # 3. Do the actual deploy (simulated)
    print("\nDeploying to staging...")
    print("  [simulated] kubectl apply -f deployment.yaml")
    print("  [simulated] deployment/app-staging scaled to 3 replicas")

    # 4. Sign the execution envelope (audit trail)
    envelope = sign(
        action="deploy",
        token=token,
        target="staging",
        result="success",
        metadata={
            "commit": "abc123",
            "replicas": 3,
            "duration_ms": 4500,
        },
    )

    # Save envelope for audit step
    envelope_path = "/tmp/execution-envelope.txt"
    with open(envelope_path, "w") as f:
        f.write(envelope)

    print(f"\nExecution signed and saved to {envelope_path}")
    print("  This envelope contains:")
    print("    - What was done (deploy to staging)")
    print("    - Who did it (agent DID)")
    print("    - The full delegation chain (proof of authority)")
    print("    - Ed25519 signature (tamper-proof)")


if __name__ == "__main__":
    main()
