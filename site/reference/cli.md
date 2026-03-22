# CLI Reference

```bash
pip install kanoniv-auth        # Python CLI
# or
cargo install kanoniv-agent-auth --features cli  # Rust CLI
```

Both CLIs produce identical tokens. Use whichever fits your workflow.

## Commands

### `kanoniv-auth init`

Generate a new root key pair.

```bash
kanoniv-auth init [--output PATH] [--force]
```

| Flag | Description |
|------|-------------|
| `--output`, `-o` | Output path (default: `~/.kanoniv/root.key`) |
| `--force` | Overwrite existing key |

---

### `kanoniv-auth delegate`

Issue a delegation token.

```bash
kanoniv-auth delegate --scopes SCOPES [--ttl TTL] [--key PATH] [--parent TOKEN] [--dry-run]
```

| Flag | Description |
|------|-------------|
| `--scopes`, `-s` | Comma-separated scopes (required) |
| `--ttl`, `-t` | Time-to-live: `4h`, `30m`, `1d`, `3600s` |
| `--key`, `-k` | Root key file path |
| `--parent` | Parent token for sub-delegation |
| `--dry-run` | Show what would happen without signing |

Outputs the base64 token to stdout. The token is also saved to `~/.kanoniv/tokens/`.

**Examples:**

```bash
# Basic delegation
kanoniv-auth delegate --scopes deploy.staging,build --ttl 4h

# Sub-delegation (narrowing only)
kanoniv-auth delegate --scopes deploy.staging --ttl 1h --parent $PARENT_TOKEN

# Dry run
kanoniv-auth delegate --scopes deploy.prod --ttl 2h --dry-run
```

---

### `kanoniv-auth verify`

Verify a token against an action.

```bash
kanoniv-auth verify --scope SCOPE [--token TOKEN]
```

| Flag | Description |
|------|-------------|
| `--scope`, `-s` | Action to verify (required) |
| `--token`, `-t` | Token (or `$KANONIV_TOKEN`, or latest saved) |

**Token resolution order:** `--token` flag > `$KANONIV_TOKEN` env > `~/.kanoniv/tokens/latest.token`

**Success output:**

```
VERIFIED
  Agent:   did:agent:5e0641c3749e...
  Root:    did:agent:b15b9019a4c8...
  Scopes:  ["deploy.staging", "build"]
  Expires: 3h47m remaining
  Chain:   1 link(s)
```

**Failure output:**

```
Error: DENIED: scope "deploy.prod" not in delegation

  You have:  ["deploy.staging", "build"]
  You need:  ["deploy.prod"]
```

---

### `kanoniv-auth sign`

Sign an execution envelope.

```bash
kanoniv-auth sign --action ACTION [--token TOKEN] [--target TARGET] [--result RESULT]
```

| Flag | Description |
|------|-------------|
| `--action`, `-a` | Action performed (required) |
| `--token`, `-t` | Delegation token |
| `--target` | Target of the action (e.g., "staging") |
| `--result` | Result: `success`, `failure`, `partial` (default: `success`) |

Outputs the signed envelope to stdout.

---

### `kanoniv-auth whoami`

Show the identity behind a token.

```bash
kanoniv-auth whoami [--token TOKEN]
```

```
Agent Identity
  DID:     did:agent:5e0641c3749e...
  Root:    did:agent:b15b9019a4c8...
  Scopes:  ["deploy.staging", "build"]
  Chain:   1 link(s)
  TTL:     3h47m remaining
  Keys:    embedded (can sub-delegate and sign)
```

---

### `kanoniv-auth audit`

Pretty-print a delegation chain or execution envelope.

```bash
kanoniv-auth audit <TOKEN_OR_ENVELOPE>
```

```
Delegation Chain
  did:agent:b15b9019a4c8e73f... (root)
    |-- did:agent:5e0641c3749e... [deploy.staging, build]

  Chain depth: 1
```

---

### `kanoniv-auth tokens`

List saved delegation tokens.

```bash
kanoniv-auth tokens
```

```
2 saved token(s):

  deploy_staging_5e0641c3749e.token
    Agent:  did:agent:5e0641c3749e...
    Scopes: [deploy.staging]
    TTL:    3h47m remaining  [active]

  build_b15b9019a4c8.token
    Agent:  did:agent:b15b9019a4c8...
    Scopes: [build]
    TTL:    expired 2h ago  [expired]
```

---

### `kanoniv-auth revoke`

Revoke a delegation token.

```bash
# Local: delete token file
kanoniv-auth revoke --token TOKEN

# Via delegation service
kanoniv-auth revoke --service http://localhost:7400 --delegation-id UUID
```

| Flag | Description |
|------|-------------|
| `--token`, `-t` | Token to revoke (deletes from local storage) |
| `--service` | Delegation service URL |
| `--delegation-id` | Delegation ID to revoke on service |

---

### `kanoniv-auth --version`

```bash
kanoniv-auth --version
# kanoniv-auth, version 0.2.0
```
