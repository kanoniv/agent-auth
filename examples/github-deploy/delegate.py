"""Step 1: Human delegates scoped authority to the pipeline agent.

This runs before the agent gets control. The root key stays with
the human/CI secret store. The agent only gets a scoped, time-bounded token.
"""

import os
import sys

from kanoniv_auth import delegate, init_root, load_root

ROOT_KEY_PATH = "/tmp/kanoniv-demo-root.key"
TOKEN_PATH = "/tmp/agent-token.txt"


def main():
    # In CI, the root key comes from a secret. Locally, we generate one.
    root_key_b64 = os.environ.get("KANONIV_ROOT_KEY")
    if root_key_b64:
        from kanoniv_auth.crypto import load_keys
        import kanoniv_auth.auth as auth_module
        auth_module._root_keys = load_keys(root_key_b64)
        print("Loaded root key from KANONIV_ROOT_KEY secret")
    else:
        if os.path.exists(ROOT_KEY_PATH):
            load_root(ROOT_KEY_PATH)
            print(f"Loaded root key from {ROOT_KEY_PATH}")
        else:
            init_root(ROOT_KEY_PATH)
            print(f"Generated new root key at {ROOT_KEY_PATH}")

    # Delegate: the agent can build, test, and deploy to staging.
    # It CANNOT deploy to prod. That's not a policy - it's math.
    token = delegate(
        scopes=["build", "test", "deploy.staging"],
        ttl="4h",
    )

    # Save token for the agent step
    with open(TOKEN_PATH, "w") as f:
        f.write(token)

    print(f"\nDelegation issued:")
    print(f"  Scopes:  ['build', 'test', 'deploy.staging']")
    print(f"  TTL:     4 hours")
    print(f"  Token:   {token[:60]}...")
    print(f"  Saved:   {TOKEN_PATH}")
    print(f"\n  The agent can now use this token. It cannot escalate.")


if __name__ == "__main__":
    main()
