---
name: audit
version: 0.1.0
description: |
  View the kanoniv-auth audit trail. Shows every action the agent took -
  delegations, scope verifications, tool calls, and results. Filter by
  agent, action type, or time range. Use when asked to "show audit log",
  "what happened", "show the trail", or "audit".
allowed-tools:
  - Bash
  - Read
---

# /audit - View the Agent Audit Trail

Show the audit log from `~/.kanoniv/audit.log`. This is an append-only record
of every kanoniv-auth operation: delegations, verifications, signed actions,
and tool calls (when the /delegate skill is active).

## Run

```bash
# Check kanoniv-auth is installed
which kanoniv-auth >/dev/null 2>&1 || { echo "kanoniv-auth not installed. Run: pip install kanoniv-auth"; exit 1; }
```

Then run the audit log command with appropriate filters:

```bash
kanoniv-auth audit-log
```

**Filters** (apply based on what the user asks):
- If user asks about a specific agent: `kanoniv-auth audit-log --agent claude-code`
- If user asks about a specific action: `kanoniv-auth audit-log --action verify` (or delegate, sign, exec, tool:bash, tool:edit)
- If user asks about today only: `kanoniv-auth audit-log --since $(date -u +%Y-%m-%dT00:00:00)`
- If user asks for more entries: `kanoniv-auth audit-log --limit 100`

If the audit log is empty, say: "No audit entries yet. Actions are logged
automatically when /delegate is active, or when using kanoniv-auth delegate/verify/sign directly."

## Formatting

Present the output in a readable table. Group by time if there are many entries.
Highlight DENIED or error results. For large logs, summarize:
- Total actions
- Breakdown by action type
- Any denied/failed actions (show these first)
