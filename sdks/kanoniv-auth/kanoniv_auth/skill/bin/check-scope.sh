#!/usr/bin/env bash
# check-scope.sh - PreToolUse hook for /delegate skill
# Matches the pattern from gstack's /careful hook exactly.
set -euo pipefail

# Read stdin (JSON with tool_input)
INPUT=$(cat)

# No token = no enforcement
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

# Extract "command" from tool_input using grep/sed (same as /careful)
CMD=$(printf '%s' "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//' || true)

if [ -z "$CMD" ]; then
  echo '{}'
  exit 0
fi

CMD_LOWER=$(printf '%s' "$CMD" | tr '[:upper:]' '[:lower:]')
SCOPE=""

# Git write operations
if printf '%s' "$CMD_LOWER" | grep -qE 'git\s+push' 2>/dev/null; then
  SCOPE="git.push"
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+(commit|add|rm|reset|checkout|rebase|merge|cherry-pick)' 2>/dev/null; then
  SCOPE="git.commit"
# Test commands
elif printf '%s' "$CMD_LOWER" | grep -qE '(cargo\s+test|pytest|npm\s+test|npm\s+run\s+test|vitest|jest)' 2>/dev/null; then
  SCOPE="test.run"
# Build commands
elif printf '%s' "$CMD_LOWER" | grep -qE '(cargo\s+build|cargo\s+check|npm\s+run\s+build)' 2>/dev/null; then
  SCOPE="code.edit"
# Always allowed patterns
elif printf '%s' "$CMD_LOWER" | grep -qE 'kanoniv-auth' 2>/dev/null; then
  echo '{}'; exit 0
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+(status|log|diff|show|branch|tag|remote|fetch)' 2>/dev/null; then
  echo '{}'; exit 0
elif printf '%s' "$CMD_LOWER" | grep -qE '^(cat|head|tail|ls|find|grep|echo|printf|pwd|which|type|env|date|wc|rm|mkdir|touch|cp|mv|chmod|sed|awk|sort|curl|sleep|pip|python|node|cargo\s+--version)' 2>/dev/null; then
  echo '{}'; exit 0
elif printf '%s' "$CMD_LOWER" | grep -qE '^\[|^test\s|^if\s|^command\s' 2>/dev/null; then
  echo '{}'; exit 0
# Default: require code.edit
else
  SCOPE="code.edit"
fi

# Verify scope
if [ -n "$SCOPE" ]; then
  if ! kanoniv-auth verify --scope "$SCOPE" --token "$TOKEN" >/dev/null 2>&1; then
    SCOPES=$(kanoniv-auth whoami --token "$TOKEN" 2>/dev/null | grep "Scopes:" | sed 's/.*Scopes:\s*//' || echo "unknown")
    printf '{"permissionDecision":"block","message":"SCOPE DENIED: requires %s\\n\\nYou have: %s\\n\\nRe-delegate with: kanoniv-auth delegate --name claude-code --scopes ...,%s --ttl 4h"}\n' "$SCOPE" "$SCOPES" "$SCOPE"
    exit 0
  fi
fi

echo '{}'
