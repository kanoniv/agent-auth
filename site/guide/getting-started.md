# Getting Started

Install the Python SDK and secure your first agent pipeline in under 5 minutes.

## Install

```bash
pip install kanoniv-auth
```

This installs the `kanoniv-auth` CLI and the Python library. No Rust toolchain needed.

::: tip Rust CLI
If you prefer a native binary: `cargo install kanoniv-agent-auth --features cli`
:::

## 1. Generate a Root Key

The root key is the master authority. Treat it like an SSH key.

```bash
kanoniv-auth init
```

```
Root key generated.
  DID:  did:agent:b15b9019a4c8e73f...
  Path: ~/.kanoniv/root.key

  WARNING: Treat this like an SSH key. Don't share it.
```

## 2. Delegate to an Agent

Issue a scoped, time-bounded token:

```bash
kanoniv-auth delegate --scopes deploy.staging,build --ttl 4h
```

This outputs a base64 token. Set it as an environment variable:

```bash
export KANONIV_TOKEN=eyJhZ2VudF9kaWQ...
```

## 3. Verify Authority

On the agent side, verify before acting:

```bash
kanoniv-auth verify --scope deploy.staging
# VERIFIED
#   Agent:   did:agent:5e0641c3749e...
#   Scopes:  ["deploy.staging", "build"]
#   Expires: 3h58m remaining
#   Chain:   1 link(s)
```

Try an unauthorized scope:

```bash
kanoniv-auth verify --scope deploy.prod
# Error: DENIED: scope "deploy.prod" not in delegation
#
#   You have:  ["deploy.staging", "build"]
#   You need:  ["deploy.prod"]
```

## 4. Sign an Execution Envelope

After performing an action, sign it for the audit trail:

```bash
kanoniv-auth sign --action deploy --target staging
```

This produces a signed envelope with the full delegation chain. Anyone can verify it offline.

## Python API

The same workflow in Python:

```python
from kanoniv_auth import init_root, delegate, verify, sign

# Once: generate root key
root = init_root()

# Issue token
token = delegate(scopes=["deploy.staging"], ttl="4h")

# Agent verifies
result = verify(action="deploy.staging", token=token)
print(result["agent_did"])   # did:agent:...
print(result["ttl_remaining"])  # 14380.0

# Agent signs execution
envelope = sign(action="deploy", token=token, target="staging")
```

## Sub-Delegation

Agents can delegate to other agents. Scopes can only narrow, never widen:

```python
# Orchestrator has build + test + deploy.staging
orchestrator_token = delegate(
    scopes=["build", "test", "deploy.staging"],
    ttl="4h",
)

# Sub-delegate to deploy agent: only deploy.staging
deploy_token = delegate(
    scopes=["deploy.staging"],
    ttl="1h",
    parent_token=orchestrator_token,
)

# This would raise ScopeViolation:
# delegate(scopes=["deploy.prod"], parent_token=orchestrator_token)
```

## What's Next

- [How It Works](/guide/how-it-works) - Ed25519 signatures, delegation chains, token format
- [GitHub Action](/guide/github-action) - Add to your CI/CD pipeline
- [Python API Reference](/reference/python-api) - Full API docs
- [CLI Reference](/reference/cli) - All commands
