# Claude Code Skill

Scope enforcement for Claude Code sessions. Every tool call is verified against your delegation token before execution.

## Install

**Option A:** From the Python package (recommended):

```bash
pip install kanoniv-auth
kanoniv-auth install-skill
```

**Option B:** One-liner from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/kanoniv/agent-auth/main/skill/bin/install-remote.sh | bash
```

Both install three skills into `~/.claude/skills/`:

- `/delegate` - Start a scoped session with enforcement hooks
- `/audit` - View the agent audit trail
- `/status` - Check current delegation status

## Usage

### `/delegate`

Start Claude Code and type `/delegate`. You'll be asked two questions:

1. **Agent name and TTL** - default: `claude-code`, `4h`
2. **Scopes** - pick from presets or specify custom scopes

```
User: /delegate
Claude: Name this agent and set the session duration.
  A) claude-code, 4h (Recommended)
  B) Custom

User: A

Claude: What should claude-code be allowed to do?
  A) Full dev - code.edit, test.run, git.commit, git.push
  B) Read-only + test - code.read, test.run
  C) Repo-scoped - code.edit, test.run, git.push.{repo}.{branch}
  D) Custom scopes

User: C
```

Option C auto-detects the current repo and branch, then builds a hierarchical scope like `git.push.agent-auth.main`.

### `/audit`

View the audit trail anytime. Supports the same filters as the CLI:

```
User: /audit
Claude: 12 events:
  19:15:03  verify    claude-code  scope=code.edit    PASS
  19:15:05  tool:bash claude-code  cargo test --lib    ok
  19:15:08  tool:edit claude-code  src/lib.rs          ok
  19:15:12  tool:bash claude-code  git push origin main DENIED
```

### `/status`

Quick check on the current delegation:

```
User: /status
Claude: ACTIVE
  Agent:  claude-code
  DID:    did:agent:5e0641c3749e...
  Scopes: code.edit, test.run, git.commit
  TTL:    3h47m
```

## How the PreToolUse Hook Works

The `/delegate` skill defines a `PreToolUse` hook on Bash, Edit, and Write tools. On every tool call:

1. The hook reads the tool input from stdin (JSON with `command` or `file_path`)
2. Maps the tool/command to a required scope (see table below)
3. Runs `kanoniv-auth verify --scope <required>`
4. If PASS: returns `{}` (allow - invisible to the user)
5. If DENIED: returns a block message with the scope violation

The hook is invisible unless a scope violation occurs.

## Scope Mapping

| Tool / Command | Scope Required |
|---------------|---------------|
| `git push origin main` | `git.push.{repo}.main` |
| `git push origin dev` | `git.push.{repo}.dev` |
| `git commit`, `git add` | `git.commit.{repo}` |
| `cargo test`, `pytest`, `npm test` | `test.run` |
| `cargo build`, `npm run build` | `code.edit` |
| Edit, Write | `code.edit` |
| `ls`, `cat`, `grep`, `git status` | always allowed |
| Other bash commands | `code.edit` |

`{repo}` is auto-detected from `git rev-parse --show-toplevel`.

## Hierarchical Git Scopes

Scopes are hierarchical - a broader scope covers all narrower ones:

```
git.push                          -- all repos, all branches
  git.push.agent-auth             -- all branches in agent-auth
    git.push.agent-auth.main      -- only main in agent-auth
    git.push.agent-auth.dev       -- only dev in agent-auth
  git.push.other-repo             -- all branches in other-repo
```

The hook tries the most specific scope first (`git.push.agent-auth.main`), then walks up the hierarchy (`git.push.agent-auth`, `git.push`) until it finds a match or runs out of parents.

This means:
- Delegating `git.push` allows pushing to any repo and branch
- Delegating `git.push.agent-auth` allows any branch in agent-auth but nothing else
- Delegating `git.push.agent-auth.main` restricts to exactly main in agent-auth

## Session Token

The delegation token is stored at `/tmp/.kanoniv-session-token` for the duration of the session. The PreToolUse hook reads from this file. The token is also saved to `~/.kanoniv/tokens/` for persistence.
