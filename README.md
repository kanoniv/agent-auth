# Sudo for AI Agents

**Your AI agents currently have keys. We give them math instead.**

AI agents are being given SSH keys and API tokens like it's 1999. Kanoniv agent-auth replaces long-lived credentials with cryptographic delegation tokens that are scope-confined, time-bounded, and fully auditable.

```python
pip install kanoniv-auth
```

```python
from kanoniv_auth import delegate, verify

token = delegate(scopes=["deploy.staging"], ttl="4h")

verify(action="deploy.staging", token=token)  # works
verify(action="deploy.prod", token=token)     # raises ScopeViolation
```

That second line doesn't just fail. It **cannot** succeed. Not policy-blocked, not RBAC-blocked - cryptographically impossible without the root key.

## Why This Exists

A typical AI-assisted deploy flow today:

1. Developer tells Copilot/Devin/Claude to "fix the bug and deploy it"
2. The agent gets a long-lived API token with broad permissions
3. It pushes code, triggers the pipeline, maybe touches infra
4. Nobody has a clean audit trail of what the agent decided vs what the human approved

The "solution" most teams have is vibes. A slightly restricted token and hope.

## What This Solves

| Problem | How kanoniv-auth solves it |
|---------|---------------------------|
| Agents have broad permissions | Scope confinement - `deploy.staging` cannot touch prod |
| Leaked tokens are valid forever | `expires_at` - hard ceiling, default 4h |
| No audit trail for agent actions | Every action is signed with its delegation chain |
| Agents can't delegate to sub-agents safely | Delegation chains only narrow, never widen |

## The Demo Workflow

```
Human engineer
    |-- signs delegation token
          scopes: ["build", "test", "deploy.staging"]
          ttl: 4h

    Pipeline Orchestrator Agent (receives token)
          |-- sub-delegates to Deploy Agent
                scopes: ["deploy.staging"]  (can only narrow, never widen)

    Deploy Agent executes
          |-- signs execution envelope
                action: deploy, target: staging
                delegation_proof: <full chain>
                result: success

    Audit log = execution envelope hash
    (verifiable without trusting any single system)
```

The prod environment never trusts the agent directly. It only verifies the math on the token chain.

## CLI

```bash
# Install
cargo install kanoniv-agent-auth --features cli

# Generate root key (treat like an SSH key)
kanoniv-auth init

# Issue a delegation token
kanoniv-auth delegate --scopes deploy.staging,build --ttl 4h
# outputs: eyJhZ2VudF9kaWQ...

# Agent verifies it has authority
kanoniv-auth verify --scope deploy.staging --token $KANONIV_TOKEN
# VERIFIED
#   Agent:   did:agent:b15b9019...
#   Scopes:  ["deploy.staging", "build"]
#   Expires: 3h47m remaining

# Agent tries to touch prod
kanoniv-auth verify --scope deploy.prod --token $KANONIV_TOKEN
# error: DENIED: scope "deploy.prod" not in delegation
#
#   You have:  [deploy.staging, build]
#   You need:  ["deploy.prod"]

# Agent signs an execution envelope (audit trail)
kanoniv-auth sign --action deploy --target staging --token $KANONIV_TOKEN

# Inspect any token or envelope
kanoniv-auth whoami --token $KANONIV_TOKEN
kanoniv-auth audit <envelope>
```

## Python API

```python
from kanoniv_auth import delegate, verify, sign, init_root, load_root

# Generate root key (once)
root = init_root("~/.kanoniv/root.key")

# Issue delegation
token = delegate(
    scopes=["deploy.staging", "build"],
    ttl="4h",
)

# Verify (agent-side)
result = verify(action="deploy.staging", token=token)
# {"valid": True, "scopes": [...], "ttl_remaining": 14380.0, ...}

# Sub-delegate (narrowing only)
sub_token = delegate(
    scopes=["deploy.staging"],
    ttl="1h",
    parent_token=token,
)

# Sign execution (audit trail)
envelope = sign(
    action="deploy",
    token=token,
    target="staging",
    result="success",
    metadata={"commit": "abc123"},
)
```

### Error Handling

Every error tells you what happened and how to fix it:

```python
try:
    verify(action="deploy.prod", token=token)
except ScopeViolation as e:
    print(e)
    # DENIED: scope "deploy.prod" not in delegation
    #
    #   You have:  ["deploy.staging"]
    #   You need:  ["deploy.prod"]
    #
    #   To request escalation:
    #     kanoniv-auth request-scope --scope deploy.prod --from did:agent:abc...
```

## How It Works

**Ed25519 signatures.** Every delegation is a signed message from the delegator to the delegate. The chain is self-contained - verification requires no network call, no database lookup, no trust in any third party.

**Scope narrowing.** A delegation can only grant a subset of the parent's scopes. Root grants `[build, test, deploy.staging]`. Sub-delegation can grant `[deploy.staging]` but cannot add `deploy.prod`. This is enforced by the math, not by policy.

**Token format.** Base64-encoded JSON containing the delegation chain, agent DID, scopes, and expiry. Each link in the chain includes the issuer's public key and signature. Self-contained, verifiable offline.

## Competitive Landscape

| Feature | Vault | OPA | GH OIDC | AWS IAM | kanoniv-auth |
|---------|-------|-----|---------|---------|-------------|
| Secret management | Y | N | N | Y | N |
| Policy engine | N | Y | N | Y | N |
| Agent-specific delegation | N | N | N | N | **Y** |
| Scope narrowing chains | N | N | N | N | **Y** |
| Cryptographic audit trail | N | N | N | N | **Y** |
| Short-lived tokens | Y | N | Y | Y | **Y** |
| Offline verification | Y | N | N | N | **Y** |
| MCP auth | N | N | N | N | **Y** |

None of them have "agent delegates to sub-agent with attenuated scope." That's the gap.

## Architecture

```
Developer (root key)
  |
  +-- Python CLI (pip install kanoniv-auth)
  +-- Rust CLI (cargo install kanoniv-agent-auth --features cli)
  +-- GitHub Action (kanoniv/auth-action@v1)
  |
  delegate / verify / sign
  |
  +-- OFFLINE: local Ed25519 verify (no network)
  +-- SERVICE: kanoniv-auth serve (Axum + SQLite)
  +-- CLOUD: api.kanoniv.com (Postgres, revocation webhooks)
```

## Packages

| Package | Registry | Install |
|---------|----------|---------|
| `kanoniv-agent-auth` | crates.io | `cargo install kanoniv-agent-auth --features cli` |
| `kanoniv-auth` | PyPI | `pip install kanoniv-auth` |
| `@kanoniv/agent-auth` | npm | `npm install @kanoniv/agent-auth` |

## Agent Trust Observatory

For teams that want a visual dashboard: [trust.kanoniv.com](https://trust.kanoniv.com)

The Observatory shows agent reputation, delegation chains, provenance audit trails, and cross-engine interop verification. Docker Compose for self-hosting:

```bash
cd apps/observatory && docker compose up
```

## Cross-Engine Interop

Three independent agent systems have cross-verified each other's delegation chains on this repo:

| Verifier / Chain | Kanoniv | APS | AIP |
|---|---|---|---|
| Kanoniv | -- | verified | verified |
| APS | verified | -- | verified |
| AIP | verified | verified | -- |

See [spec/CROSS-ENGINE-VERIFICATION.md](spec/CROSS-ENGINE-VERIFICATION.md) and [interop thread](https://github.com/kanoniv/agent-auth/issues/2).

## License

MIT
