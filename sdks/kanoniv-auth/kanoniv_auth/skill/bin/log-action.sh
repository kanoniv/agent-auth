#!/usr/bin/env bash
# log-action.sh - PostToolUse hook for /delegate skill
# MUST never fail. Any error = "hook error" in Claude Code.
set +e

TOKEN_FILE="/tmp/.kanoniv-session-token"
if [ ! -f "$TOKEN_FILE" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)
if [ -z "$INPUT" ]; then
  exit 0
fi

INFO=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    data = json.loads(sys.stdin.read())
    tool = data.get("tool_name", "unknown")
    ti = data.get("tool_input", {})
    if tool == "Bash":
        detail = ti.get("command", "")[:60]
    elif tool in ("Edit", "Write"):
        detail = ti.get("file_path", "").rsplit("/", 1)[-1] if "/" in ti.get("file_path", "") else ti.get("file_path", "")
    else:
        detail = tool
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

AGENT_INFO=$(python3 -c "
import base64, json
token = open('/tmp/.kanoniv-session-token').read().strip()
padded = token + '=' * (4 - len(token) % 4) if len(token) % 4 else token
data = json.loads(base64.urlsafe_b64decode(padded))
print(data.get('agent_name', '-') + '\t' + data.get('agent_did', '-'))
" 2>/dev/null || echo "-	-")

AGENT_NAME=$(echo "$AGENT_INFO" | cut -f1)
DID_SHORT=$(echo "$AGENT_INFO" | cut -f2 | cut -c1-24)

AUDIT_LOG="${HOME}/.kanoniv/audit.log"
mkdir -p "$(dirname "$AUDIT_LOG")" 2>/dev/null || true
TS=$(date -u +"%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "unknown")
TOOL_LOWER=$(echo "$TOOL" | tr '[:upper:]' '[:lower:]')

printf "%s  %-16s  %-24s  %-12s  %-40s  %s\n" \
  "$TS" "$AGENT_NAME" "${DID_SHORT}..." "tool:$TOOL_LOWER" "${DETAIL:0:40}" "$STATUS" \
  >> "$AUDIT_LOG" 2>/dev/null || true

exit 0
