# TODOS

## P2: OIDC Root Key Provisioning

**What:** Cloud endpoint `POST /v1/auth/oidc/root-key` that exchanges a GitHub OIDC token for a delegation token, eliminating the need to store root keys as GitHub secrets.

**Why:** Production CI security. Root keys stored as `$KANONIV_ROOT_KEY` GitHub secret is the current approach, but OIDC token exchange is the gold standard for CI/CD authentication (see: GitHub Actions OIDC for AWS, GCP, Azure). Platform engineers expect this pattern.

**Current state:** The GitHub Action (`action/action.yml`) has placeholder code for OIDC. The client-side token request exists but there is no server endpoint to receive it. The delegation service (`src/bin/server.rs`) runs on SQLite locally - the Cloud endpoint would need to live in the Kanoniv Cloud API (cannon-api).

**Effort:** M (human: ~1 week / CC: ~30min)

**Depends on:** Stable delegation service, Kanoniv Cloud API integration.
