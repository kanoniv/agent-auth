#!/usr/bin/env bash
# check-edit-scope.sh - PreToolUse hook for Edit/Write tools
# Simply verifies code.edit scope is present in the delegation token.
set -eo pipefail

TOKEN_FILE="/tmp/.kanoniv-session-token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo '{}'
  exit 0
fi

TOKEN=$(cat "$TOKEN_FILE")
if [ -z "$TOKEN" ]; then
  echo '{}'
  exit 0
fi

# Verify code.edit scope
RESULT=$(kanoniv-auth verify --scope code.edit --token "$TOKEN" 2>&1) || {
  ERROR=$(printf '%s' "$RESULT" | head -3 | python3 -c '
import sys, json
print(json.dumps(sys.stdin.read()))
' 2>/dev/null | sed 's/^"//;s/"$//')

  cat <<BLOCK
{"permissionDecision":"block","message":"SCOPE DENIED: file editing requires 'code.edit' scope\n\n$ERROR\n\nRe-delegate with code.edit:\n  kanoniv-auth delegate --name claude-code --scopes code.edit,... --ttl 4h"}
BLOCK
  exit 0
}

echo '{}'
