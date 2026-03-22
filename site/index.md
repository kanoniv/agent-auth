---
layout: home

hero:
  name: "kanoniv-auth"
  text: "Sudo for AI Agents"
  tagline: "Your AI agents currently have keys. We give them math instead."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kanoniv/agent-auth

features:
  - title: Scope Confinement
    details: deploy.staging cannot touch prod. Not policy-blocked, not RBAC-blocked - cryptographically impossible without the root key.
    icon: "\U0001F512"
  - title: Short-Lived Authority
    details: Tokens expire. Default 4 hours. Compare to a leaked AWS IAM key valid until someone notices.
    icon: "\u23F1\uFE0F"
  - title: Cryptographic Audit Trail
    details: Every action is signed with its delegation chain. Who authorized what, when, with what scope.
    icon: "\U0001F4DC"
  - title: Offline Verification
    details: Ed25519 signatures. No network call, no database lookup, no trust in any third party.
    icon: "\u2708\uFE0F"
---

<style>
.demo-section {
  max-width: 768px;
  margin: 0 auto;
  padding: 48px 24px;
}
.demo-section h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 8px;
}
.demo-section .subtitle {
  color: var(--vp-c-text-2);
  margin-bottom: 24px;
}
.comparison-table {
  max-width: 768px;
  margin: 0 auto;
  padding: 24px 24px 64px;
}
.comparison-table h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 24px;
}
.comparison-table table {
  width: 100%;
  border-collapse: collapse;
}
.comparison-table th, .comparison-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 0.9rem;
}
.comparison-table th {
  font-weight: 600;
}
.install-section {
  max-width: 768px;
  margin: 0 auto;
  padding: 24px 24px 64px;
  text-align: center;
}
.install-section h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 16px;
}
.workflow-section {
  max-width: 768px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}
.workflow-section h2 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 24px;
}
</style>

<div class="demo-section">

## The Demo

<p class="subtitle">Two function calls. That's the whole API.</p>

```python
from kanoniv_auth import delegate, verify

token = delegate(scopes=["deploy.staging"], ttl="4h")

verify(action="deploy.staging", token=token)  # works
verify(action="deploy.prod", token=token)     # raises ScopeViolation
```

That second line doesn't just fail. It **cannot** succeed. The scope is enforced by Ed25519 math, not by policy.

</div>

<div class="workflow-section">

## How Agents Use It

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

    Audit log = execution envelope hash
    (verifiable without trusting any single system)
```

The prod environment never trusts the agent directly. It only verifies the math on the token chain.

</div>

<div class="comparison-table">

## Why Not Just Use...

| Feature | Vault | OPA | GH OIDC | AWS IAM | kanoniv-auth |
|---------|-------|-----|---------|---------|-------------|
| Agent-specific delegation | | | | | **Yes** |
| Scope narrowing chains | | | | | **Yes** |
| Cryptographic audit trail | | | | | **Yes** |
| Short-lived tokens | Yes | | Yes | Yes | **Yes** |
| Offline verification | Yes | | | | **Yes** |
| MCP auth | | | | | **Yes** |

None of them have "agent delegates to sub-agent with attenuated scope."

</div>

<div class="install-section">

## Get Started in 30 Seconds

```bash
pip install kanoniv-auth
```

Or with Rust:

```bash
cargo install kanoniv-agent-auth --features cli
```

[Read the guide](/guide/getting-started) | [Python API reference](/reference/python-api) | [CLI reference](/reference/cli)

</div>
