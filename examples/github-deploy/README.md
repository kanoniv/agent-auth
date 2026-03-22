# GitHub Deploy Example

Before and after: securing an AI agent deploy pipeline with kanoniv-auth.

## Before (how most teams do it today)

```yaml
# .github/workflows/agent-deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Agent deploys to staging
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}  # long-lived, broad scope
        run: |
          # Agent has full deploy access. To staging AND prod.
          # If this token leaks, everything is exposed.
          # No audit trail of what the agent decided.
          ./deploy.sh staging
```

Problems:
- Token is long-lived (rotated... eventually)
- Token has broad scope (staging AND prod access)
- No audit trail of agent decisions
- If the agent is compromised, the token works everywhere

## After (with kanoniv-auth)

```yaml
# .github/workflows/agent-deploy-secure.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install kanoniv-auth
        run: pip install kanoniv-auth

      - name: Delegate scoped authority to agent
        run: |
          python3 examples/github-deploy/delegate.py
        env:
          KANONIV_ROOT_KEY: ${{ secrets.KANONIV_ROOT_KEY }}

      - name: Agent deploys (scoped to staging only)
        run: |
          python3 examples/github-deploy/deploy.py
        env:
          KANONIV_TOKEN: ${{ steps.delegate.outputs.token }}

      - name: Verify audit trail
        run: |
          python3 examples/github-deploy/audit.py
```

What changed:
- Agent gets a 4-hour token scoped to `deploy.staging` only
- `deploy.prod` is **cryptographically impossible** - not just policy-blocked
- Every action is signed with the delegation chain
- Audit trail is verifiable without trusting any single system

## Run Locally

```bash
# 1. Generate a root key
pip install kanoniv-auth
python3 delegate.py

# 2. Agent uses the token
KANONIV_TOKEN=$(cat /tmp/agent-token.txt) python3 deploy.py

# 3. Check the audit trail
python3 audit.py
```
