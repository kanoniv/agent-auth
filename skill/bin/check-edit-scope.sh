#!/usr/bin/env bash
# check-edit-scope.sh - PreToolUse hook for Edit/Write tools
# MUST always exit 0 with valid JSON.
set +e
trap 'echo "{}"; exit 0' ERR

TOKEN_FILE="/tmp/.kanoniv-session-token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo '{}'
  exit 0
fi

TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  echo '{}'
  exit 0
fi

RESULT=$(kanoniv-auth verify --scope code.edit --token "$TOKEN" 2>&1) || {
  ERROR=$(printf '%s' "$RESULT" | head -3 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null | sed 's/^"//;s/"$//' || echo "scope denied")
  echo "{\"permissionDecision\":\"block\",\"message\":\"SCOPE DENIED: file editing requires 'code.edit'\\n\\n$ERROR\"}"
  exit 0
}

echo '{}'
exit 0
