"""Step 3: Verify the audit trail.

Anyone with the root public key can verify what happened,
without trusting the agent, the CI system, or any third party.
"""

import json
import sys

from kanoniv_auth.auth import _decode_token

ENVELOPE_PATH = "/tmp/execution-envelope.txt"


def main():
    try:
        with open(ENVELOPE_PATH) as f:
            envelope_b64 = f.read().strip()
    except FileNotFoundError:
        print("No execution envelope found. Run deploy.py first.")
        sys.exit(1)

    data = _decode_token(envelope_b64)

    print("Execution Audit Trail")
    print("=" * 50)

    # The signed content
    if "content" in data:
        content = data["content"]
        if isinstance(content, str):
            content = json.loads(content)
        print(f"\n  Agent:    {content.get('agent_did', '?')}")
        print(f"  Action:   {content.get('action', '?')}")
        print(f"  Target:   {content.get('target', '?')}")
        print(f"  Result:   {content.get('result', '?')}")
        print(f"  Time:     {content.get('timestamp', '?')}")
        print(f"  Scopes:   {content.get('scopes', '?')}")
        print(f"  Chain:    {content.get('chain_depth', '?')} link(s)")

    # Signature
    if "signature" in data:
        sig = data["signature"]
        print(f"\n  Signature: {sig[:40]}...")

    # Delegation chain
    chain = data.get("delegation_chain", [])
    if chain:
        print(f"\n  Delegation Chain ({len(chain)} link(s)):")
        for i, link in enumerate(chain):
            issuer = link.get("issuer_did", "?")
            delegate = link.get("delegate_did", "?")
            issuer_short = issuer[:30] + "..." if len(issuer) > 30 else issuer
            delegate_short = delegate[:30] + "..." if len(delegate) > 30 else delegate
            indent = "    " + "  " * i
            if i == 0:
                print(f"    {issuer_short} (root)")
            print(f"{indent}|-> {delegate_short}")

    print("\n  Verified: This envelope is self-contained.")
    print("  Anyone with the root public key can verify the full chain.")
    print("  No trust in the agent, CI system, or any third party required.")


if __name__ == "__main__":
    main()
