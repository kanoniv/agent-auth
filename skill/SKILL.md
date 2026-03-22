---
name: delegate
version: 0.2.0
description: |
  Cryptographic delegation for AI agents. Scope-confines what Claude Code can do
  in this session using Ed25519 delegation tokens. Every action is verified before
  execution and signed for the audit trail. Use when asked to "delegate",
  "restrict scope", "authorize", or "sudo mode".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-scope.sh"
          statusMessage: "Verifying delegation scope..."
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-edit-scope.sh"
          statusMessage: "Verifying edit scope..."
    - matcher: "Write"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-edit-scope.sh"
          statusMessage: "Verifying edit scope..."
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/log-action.sh"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/log-action.sh"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/log-action.sh"
---

# /delegate - Cryptographic Scope Enforcement

Sudo for AI agents. This session is now running under a cryptographic delegation
token. Every tool call is verified against your authorized scopes before execution.
Every action is auto-logged to `~/.kanoniv/audit.log`.

## Setup

```bash
# Install kanoniv-auth if not present
which kanoniv-auth >/dev/null 2>&1 || pip install kanoniv-auth 2>/dev/null

# Init root key if not present
[ -f ~/.kanoniv/root.key ] || kanoniv-auth init
```

After the setup block, ask the user what scopes to grant. Use AskUserQuestion:

"What should Claude Code be allowed to do this session?"

Options:
- A) Full dev - code.edit, test.run, git.commit, git.push (Recommended)
- B) Read-only + test - code.read, test.run
- C) Custom scopes - I'll specify

If A: run `kanoniv-auth delegate --name claude-code --scopes code.edit,test.run,git.commit,git.push --ttl 4h --export`
If B: run `kanoniv-auth delegate --name claude-code --scopes code.read,test.run --ttl 4h --export`
If C: ask for comma-separated scopes, then run delegate with those scopes.

Capture the output and parse the token. Store it:

```bash
export KANONIV_TOKEN=<token from delegate output>
echo "$KANONIV_TOKEN" > /tmp/.kanoniv-session-token
```

Then show the status:

```bash
kanoniv-auth status --agent claude-code
```

Print: "Delegation active. All tool calls will be verified and logged.
Run /audit anytime to see the full trail."

## Scope Mapping

The hook maps Claude Code tool names to kanoniv-auth scopes:

| Tool | Scope Required |
|------|---------------|
| Bash (git push/commit) | git.push, git.commit |
| Bash (test commands) | test.run |
| Bash (other) | code.edit |
| Edit | code.edit |
| Write | code.edit |
| Read | always allowed |

If a tool call requires a scope the token doesn't have, the hook returns
a block message explaining what's denied and what scope is needed.

## During the Session

**PreToolUse** hook runs on every Bash, Edit, and Write call:
1. Reads the tool input from stdin (JSON)
2. Maps the tool/command to a required scope
3. Runs `kanoniv-auth verify --scope <required>`
4. If PASS: returns `{}` (allow)
5. If DENIED: returns `{"permissionDecision":"block","message":"DENIED: ..."}` with scope violation details

**PostToolUse** hook runs after every allowed action:
1. Logs the tool name, command/file, and result to `~/.kanoniv/audit.log`
2. Silent - no output to the user

Both hooks are invisible unless a scope violation occurs.

## Audit Trail

Every tool call that passes scope verification is auto-logged:

```
2026-03-22 19:15:03  claude-code  did:agent:5e06...  tool:bash   git commit -m "feat: ..."         ok
2026-03-22 19:15:05  claude-code  did:agent:5e06...  tool:bash   cargo test --lib                   ok
2026-03-22 19:15:08  claude-code  did:agent:5e06...  tool:edit   src/lib.rs                         ok
2026-03-22 19:15:12  claude-code  did:agent:5e06...  tool:bash   git push origin main               DENIED
```

View anytime:

```bash
kanoniv-auth audit-log --agent claude-code
```

## /audit

When the user types /audit or asks to see what happened, run:

```bash
kanoniv-auth audit-log --agent claude-code --since $(date -u +%Y-%m-%dT00:00:00)
```

Show the output formatted. If no entries, say "No actions logged yet this session."

## /status

When the user types /status or asks about current delegation, run:

```bash
kanoniv-auth status --agent claude-code
```

Show the output. If expired, suggest re-delegating.
