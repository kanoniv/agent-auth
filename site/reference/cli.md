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
kanoniv-auth delegate --scopes SCOPES [--ttl TTL] [--name NAME] [--key PATH] [--parent TOKEN] [--export] [--dry-run]
```

| Flag | Description |
|------|-------------|
| `--scopes`, `-s` | Comma-separated scopes (required) |
| `--ttl`, `-t` | Time-to-live: `4h`, `30m`, `1d`, `3600s` |
| `--name`, `-n` | Agent name - persistent identity across sessions |
| `--key`, `-k` | Root key file path |
| `--parent` | Parent token for sub-delegation |
| `--export` | Output as `export KANONIV_TOKEN=...` (eval-able) |
| `--dry-run` | Show what would happen without signing |

Outputs the base64 token to stdout. The token is also saved to `~/.kanoniv/tokens/`.

When `--name` is provided, the agent gets a persistent DID stored in `~/.kanoniv/agents.json`. Same name = same DID across sessions.

**Examples:**

```bash
# Named agent
kanoniv-auth delegate --name claude-code --scopes code.edit,test.run --ttl 4h

# Export for shell eval
eval $(kanoniv-auth delegate --scopes deploy.staging --ttl 4h --export)

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

### `kanoniv-auth exec`

Verify scope, run a command, sign the result. The "sudo" experience.

```bash
kanoniv-auth exec --scope SCOPE [--token TOKEN] [--agent NAME] -- COMMAND...
```

| Flag | Description |
|------|-------------|
| `--scope`, `-s` | Required scope for this command |
| `--token`, `-t` | Delegation token |
| `--agent`, `-a` | Load token by agent name |

Three steps in one: (1) verify the scope, (2) run the command, (3) sign the result. If the scope check fails, the command never runs.

```bash
kanoniv-auth exec --scope deploy.staging -- ./deploy.sh staging
kanoniv-auth exec --scope test.run --agent claude-code -- cargo test
```

---

### `kanoniv-auth status`

Quick check: is the current token valid and what can it do?

```bash
kanoniv-auth status [--token TOKEN] [--agent NAME]
```

| Flag | Description |
|------|-------------|
| `--token`, `-t` | Delegation token |
| `--agent`, `-a` | Load token by agent name |

```
ACTIVE
  Agent:  claude-code
  DID:    did:agent:5e0641c3749e...
  Scopes: code.edit, test.run
  TTL:    3h47m
```

---

### `kanoniv-auth audit-log`

View the local audit log.

```bash
kanoniv-auth audit-log [--agent NAME] [--action ACTION] [--since DATE] [--limit N]
```

| Flag | Description |
|------|-------------|
| `--agent`, `-a` | Filter by agent name |
| `--action` | Filter by action: `delegate`, `verify`, `sign`, `exec` |
| `--since` | Show entries since ISO date (e.g. `2026-03-22`) |
| `--limit`, `-n` | Max entries to show (default: 50) |

Every delegate, verify, sign, and exec call auto-appends to `~/.kanoniv/audit.log`. One line per event, grep-friendly.

```bash
kanoniv-auth audit-log --agent claude-code --since 2026-03-22
kanoniv-auth audit-log --action verify --limit 20
```

---

### `kanoniv-auth agents`

Manage registered agents (persistent identities stored in `~/.kanoniv/agents.json`).

```bash
kanoniv-auth agents list              # List all registered agents
kanoniv-auth agents show NAME         # Show DID and public key for an agent
kanoniv-auth agents remove NAME       # Remove an agent (confirmation required)
kanoniv-auth agents rename OLD NEW    # Rename an agent (keeps the same DID)
```

Agents are created automatically when you use `delegate --name`. These commands manage existing registrations.

---

### `kanoniv-auth install-hook`

Install a Git pre-push hook for scope enforcement.

```bash
kanoniv-auth install-hook [--repo PATH] [--force]
```

| Flag | Description |
|------|-------------|
| `--repo`, `-r` | Path to git repository (default: current directory) |
| `--force` | Overwrite existing pre-push hook |

Adds a pre-push hook that verifies `git.push.{repo}.{branch}` scope before allowing pushes. If no delegation is active, pushes go through normally (opt-in enforcement).

```bash
kanoniv-auth install-hook
# Installed pre-push hook for agent-auth
#
#   Every git push will now verify scope before pushing.
#   Required scope format: git.push.agent-auth.<branch>
```

Remove with `rm .git/hooks/pre-push`.

---

### `kanoniv-auth install-skill`

Install `/delegate`, `/audit`, and `/status` skills into Claude Code.

```bash
kanoniv-auth install-skill
```

Copies skill files to `~/.claude/skills/`. See [Claude Code Skill](/guide/claude-code-skill) for details.

---

### `kanoniv-auth --version`

```bash
kanoniv-auth --version
# kanoniv-auth, version 0.2.5
```
