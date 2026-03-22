# GitHub Action

Add cryptographic delegation to your CI/CD pipeline with one step.

## Basic Usage

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: kanoniv/auth-action@v1
        with:
          root_key: ${{ secrets.KANONIV_ROOT_KEY }}
          scopes: "deploy.staging,build"
          ttl: "4h"

      # KANONIV_TOKEN is now in the environment
      - run: |
          kanoniv-auth verify --scope deploy.staging
          ./deploy.sh staging
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `root_key` | Yes | - | Root key JSON (store in GitHub Secrets) |
| `scopes` | Yes | - | Comma-separated scope list |
| `ttl` | No | `4h` | Token time-to-live |
| `post_audit` | No | `true` | Post delegation summary as PR comment |

## Setup

### 1. Generate a root key

```bash
kanoniv-auth init --output root.key
cat root.key
```

### 2. Add to GitHub Secrets

Go to your repo Settings > Secrets > Actions, add `KANONIV_ROOT_KEY` with the contents of `root.key`.

### 3. Add the action to your workflow

The action installs `kanoniv-auth`, delegates a token with the specified scopes and TTL, and sets `KANONIV_TOKEN` in the environment for subsequent steps.

## PR Audit Comment

When `post_audit: true` (default), the action posts a comment on the PR showing:

```
## Delegation Audit

Agent: did:agent:5e0641c3749e...
Root:  did:agent:b15b9019a4c8...
Scopes: deploy.staging, build
TTL: 4h
Chain: 1 link(s)
```

This gives reviewers visibility into what authority the pipeline agent has.

## Scope Enforcement

If your deploy script tries to exceed its delegation:

```bash
kanoniv-auth verify --scope deploy.prod
# Error: DENIED: scope "deploy.prod" not in delegation
```

The pipeline fails. The agent cannot exceed its scope.
