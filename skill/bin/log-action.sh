#!/usr/bin/env bash
# log-action.sh - PostToolUse hook for /delegate skill
# Logs every tool action to ~/.kanoniv/audit.log after execution.
# Reads JSON from stdin with tool_name, tool_input, tool_result.
# Must never fail - PostToolUse errors confuse the user.
set +e

TOKEN_FILE="/tmp/.kanoniv-session-token"
if [ ! -f "$TOKEN_FILE" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_FILE")
if [ -z "$TOKEN" ]; then
  exit 0
fi

# Read stdin (PostToolUse JSON)
INPUT=$(cat)

# Extract tool info
INFO=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    data = json.loads(sys.stdin.read())
    tool = data.get("tool_name", "unknown")
    ti = data.get("tool_input", {})

    # Extract meaningful detail based on tool type
    if tool == "Bash":
        detail = ti.get("command", "")[:60]
    elif tool in ("Edit", "Write"):
        detail = ti.get("file_path", "")
        # Shorten to filename
        if "/" in detail:
            detail = detail.rsplit("/", 1)[-1]
    else:
        detail = tool

    # Check result
    result = data.get("tool_result", {})
    is_error = result.get("is_error", False) if isinstance(result, dict) else False
    status = "error" if is_error else "ok"

    print(f"{tool}\t{detail}\t{status}")
except Exception:
    print("unknown\t\tok")
' 2>/dev/null || echo "unknown		ok")

TOOL=$(echo "$INFO" | cut -f1)
DETAIL=$(echo "$INFO" | cut -f2)
STATUS=$(echo "$INFO" | cut -f3)

# Get agent info from token
AGENT_INFO=$(python3 -c "
import base64, json, sys
token = '''$TOKEN'''
try:
    padded = token.strip()
    padded += '=' * (4 - len(padded) % 4) if len(padded) % 4 else ''
    data = json.loads(base64.urlsafe_b64decode(padded))
    name = data.get('agent_name', '-')
    did = data.get('agent_did', '-')
    print(f'{name}\t{did}')
except Exception:
    print('-\t-')
" 2>/dev/null || echo "-	-")

AGENT_NAME=$(echo "$AGENT_INFO" | cut -f1)
AGENT_DID=$(echo "$AGENT_INFO" | cut -f2)

# Truncate DID for log readability
DID_SHORT="${AGENT_DID:0:24}..."

# Append to audit log
AUDIT_LOG="${HOME}/.kanoniv/audit.log"
mkdir -p "$(dirname "$AUDIT_LOG")"
TS=$(date -u +"%Y-%m-%d %H:%M:%S")
TOOL_LOWER=$(echo "$TOOL" | tr '[:upper:]' '[:lower:]')

printf "%s  %-16s  %-24s  %-12s  %-40s  %s\n" \
  "$TS" "$AGENT_NAME" "$DID_SHORT" "tool:$TOOL_LOWER" "${DETAIL:0:40}" "$STATUS" \
  >> "$AUDIT_LOG"
