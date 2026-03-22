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
---

# /delegate - Cryptographic Scope Enforcement

Sudo for AI agents. This session is now running under a cryptographic delegation
token. Every tool call is verified against your authorized scopes before execution.
Every action is auto-logged to `~/.kanoniv/audit.log`.

## Setup

First, clear any previous session token so hooks don't interfere with setup:

```bash
rm -f /tmp/.kanoniv-session-token
```

Then check prerequisites:

```bash
# Install kanoniv-auth if not present
which kanoniv-auth >/dev/null 2>&1 || pip install kanoniv-auth 2>/dev/null

# Init root key if not present
[ -f ~/.kanoniv/root.key ] || kanoniv-auth init
```

After setup, ask TWO questions using AskUserQuestion:

**Question 1: Agent name and TTL**

"Name this agent and set the session duration."

Default agent name: `claude-code`. Default TTL: `4h`.
Let the user type a custom name and/or TTL if they want.

Options:
- A) claude-code, 4h (Recommended)
- B) Custom - I'll specify name and TTL

If B: ask for the agent name (string, e.g. "deploy-bot") and TTL (e.g. "2h", "30m", "8h").

**Question 2: Scopes**

"What should {agent_name} be allowed to do this session?"

Options:
- A) Full dev - code.edit, test.run, git.commit, git.push (Recommended)
- B) Read-only + test - code.read, test.run
- C) Custom scopes - I'll specify

If C: ask for comma-separated scopes.

**Then delegate:**

Run `kanoniv-auth delegate --name {agent_name} --scopes {scopes} --ttl {ttl} --export`

Capture the output, parse the token from the `export KANONIV_TOKEN=...` line.
Store it:

```bash
echo "{token}" > /tmp/.kanoniv-session-token
```

Then show the status:

```bash
kanoniv-auth status --agent {agent_name}
```

Print: "Delegation active for {agent_name}. All tool calls will be verified and logged.
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

## Related Skills

- `/audit` - View the full audit trail (separate skill)
- `/status` - Check current delegation status (separate skill)
