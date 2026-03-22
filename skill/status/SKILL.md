---
name: status
version: 0.1.0
description: |
  Check the current kanoniv-auth delegation status. Shows agent name, DID,
  scopes, TTL remaining, and whether the token is active or expired.
  Use when asked to "check delegation", "am I authorized", "token status",
  or "status".
allowed-tools:
  - Bash
  - Read
---

# /status - Check Delegation Status

Quick check: is there an active delegation? What scopes? How much time left?

## Run

```bash
# Check kanoniv-auth is installed
which kanoniv-auth >/dev/null 2>&1 || { echo "kanoniv-auth not installed. Run: pip install kanoniv-auth"; exit 1; }
```

Then check status:

```bash
kanoniv-auth status --agent claude-code
```

If no `claude-code` agent exists, try without the agent flag:

```bash
kanoniv-auth status
```

## Interpreting the Output

**ACTIVE** - Token is valid. Show the scopes and remaining TTL.

**EXPIRED** - Token has expired. Suggest re-delegating:
"Your delegation expired. To re-authorize, run /delegate or:
  kanoniv-auth delegate --name claude-code --scopes <scopes> --ttl 4h"

**NO TOKEN** - No delegation found. Suggest starting one:
"No active delegation. Run /delegate to start a scoped session."

## Also Show

After the status output, show a one-line summary of recent activity:

```bash
kanoniv-auth audit-log --agent claude-code --limit 5
```

If there are recent entries, say: "Last 5 actions:" and show them.
If no entries, skip this section.
