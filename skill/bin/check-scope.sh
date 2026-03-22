#!/usr/bin/env bash
# check-scope.sh - PreToolUse hook for /delegate skill
# MUST always exit 0 with valid JSON. Any crash = "hook error" in Claude Code.
set +e
trap 'echo "{}"; exit 0' ERR

INPUT=$(cat 2>/dev/null || true)

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

CMD=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get("tool_input", {}).get("command", ""))
except Exception:
    print("")
' 2>/dev/null || true)

if [ -z "$CMD" ]; then
  echo '{}'
  exit 0
fi

CMD_LOWER=$(printf '%s' "$CMD" | tr '[:upper:]' '[:lower:]')
SCOPE=""

# Git write operations
if printf '%s' "$CMD_LOWER" | grep -qE 'git\s+push' 2>/dev/null; then
  SCOPE="git.push"
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+commit' 2>/dev/null; then
  SCOPE="git.commit"
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+(add|rm|reset|checkout|rebase|merge|cherry-pick)' 2>/dev/null; then
  SCOPE="git.commit"

# Test commands
elif printf '%s' "$CMD_LOWER" | grep -qE '(cargo\s+test|pytest|npm\s+test|npm\s+run\s+test|vitest|jest|rspec|go\s+test)' 2>/dev/null; then
  SCOPE="test.run"

# Build commands
elif printf '%s' "$CMD_LOWER" | grep -qE '(cargo\s+build|cargo\s+check|npm\s+run\s+build|make\b|cmake)' 2>/dev/null; then
  SCOPE="code.edit"

# Always allowed: read-only commands
elif printf '%s' "$CMD_LOWER" | grep -qE '^(cat|head|tail|less|more|wc|ls|find|grep|rg|tree|file|stat|du|df|echo|printf|pwd|whoami|which|type|env|printenv|date|uname|rm|mkdir|touch|cp|mv|chmod|sed|awk|sort|uniq|curl|wget|dig|sleep)(\s|$)' 2>/dev/null; then
  echo '{}'
  exit 0

# Always allowed: shell tests, conditionals
elif printf '%s' "$CMD_LOWER" | grep -qE '^\[|^test\s|^if\s|^command\s' 2>/dev/null; then
  echo '{}'
  exit 0

# Always allowed: git read-only
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+(status|log|diff|show|branch|tag|remote|fetch|stash\s+list)' 2>/dev/null; then
  echo '{}'
  exit 0

# Always allowed: package managers, pip, cargo, npm info
elif printf '%s' "$CMD_LOWER" | grep -qE '(pip\s+install|pip3\s+install|pip\s+list|pip\s+show|npm\s+list|npm\s+install|cargo\s+install|cargo\s+--version|python|node\s+--version)' 2>/dev/null; then
  echo '{}'
  exit 0

# Always allowed: kanoniv-auth itself
elif printf '%s' "$CMD_LOWER" | grep -qE 'kanoniv-auth' 2>/dev/null; then
  echo '{}'
  exit 0

# Default: require code.edit
else
  SCOPE="code.edit"
fi

# Verify the scope
if [ -n "$SCOPE" ]; then
  RESULT=$(kanoniv-auth verify --scope "$SCOPE" --token "$TOKEN" 2>&1) || {
    ERROR=$(echo "$RESULT" | head -5)
    ERROR_JSON=$(printf '%s' "$ERROR" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null | sed 's/^"//;s/"$//' || echo "$ERROR")
    echo "{\"permissionDecision\":\"block\",\"message\":\"SCOPE DENIED: requires '$SCOPE'\\n\\n$ERROR_JSON\\n\\nRe-delegate:\\n  kanoniv-auth delegate --name claude-code --scopes ...,$SCOPE --ttl 4h\"}"
    exit 0
  }
fi

echo '{}'
exit 0
