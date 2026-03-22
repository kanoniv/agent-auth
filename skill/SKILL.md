---
name: delegate
version: 0.1.0
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
---

# /delegate - Cryptographic Scope Enforcement

Sudo for AI agents. This session is now running under a cryptographic delegation
token. Every tool call is verified against your authorized scopes before execution.

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

Print: "Delegation active. All tool calls will be verified against your authorized scopes.
Run /audit anytime to see what happened."

## Scope Mapping

The hook maps Claude Code tool names to kanoniv-auth scopes:

| Tool | Scope Required |
|------|---------------|
| Bash (git push/commit) | git.push, git.commit |
| Bash (test commands) | test.run |
| Bash (other) | code.edit |
| Edit | code.edit |
| Write | code.edit |
| Read | code.read (always allowed) |

If a tool call requires a scope the token doesn't have, the hook returns
a block message explaining what's denied and what scope is needed.

## During the Session

The PreToolUse hook runs on every Bash, Edit, and Write call. It:
1. Reads the tool input from stdin (JSON)
2. Maps the tool/command to a required scope
3. Runs `kanoniv-auth verify --scope <required> --agent claude-code`
4. If PASS: returns `{}` (allow)
5. If DENIED: returns `{"permissionDecision":"block","message":"DENIED: ..."}` with the scope violation details

This is invisible to the user unless a scope violation occurs.

## /audit

When the user runs /audit, show the session audit log:

```bash
kanoniv-auth audit-log --agent claude-code --since $(date -u +%Y-%m-%dT00:00:00)
```

## /status

When the user runs /status, show the current delegation:

```bash
kanoniv-auth status --agent claude-code
```
