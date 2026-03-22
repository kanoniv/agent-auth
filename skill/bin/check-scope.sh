#!/usr/bin/env bash
# check-scope.sh - PreToolUse hook for /delegate skill
# Reads JSON from stdin, maps the tool call to a required scope,
# verifies the delegation token, blocks if denied.
set -euo pipefail

# Read stdin (JSON with tool_input)
INPUT=$(cat)

# Check if delegation is active
TOKEN_FILE="/tmp/.kanoniv-session-token"
if [ ! -f "$TOKEN_FILE" ]; then
  # No delegation active - allow everything (skill not initialized yet)
  echo '{}'
  exit 0
fi

TOKEN=$(cat "$TOKEN_FILE")
if [ -z "$TOKEN" ]; then
  echo '{}'
  exit 0
fi

# Extract the command from tool_input
CMD=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    data = json.loads(sys.stdin.read())
    ti = data.get("tool_input", {})
    # Bash tool: check command field
    cmd = ti.get("command", "")
    print(cmd)
except Exception:
    print("")
' 2>/dev/null || true)

# If no command extracted, allow (might be a non-Bash tool routed here)
if [ -z "$CMD" ]; then
  echo '{}'
  exit 0
fi

# Map command to required scope
CMD_LOWER=$(printf '%s' "$CMD" | tr '[:upper:]' '[:lower:]')

SCOPE=""

# Git operations
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

# Read-only commands (always allowed)
elif printf '%s' "$CMD_LOWER" | grep -qE '^(cat|head|tail|less|more|wc|ls|find|grep|rg|tree|file|stat|du|df|echo|printf|pwd|whoami|which|type|env|printenv|date|uname)(\s|$)' 2>/dev/null; then
  echo '{}'
  exit 0

# Shell test/check commands (always allowed - used by skill setup)
elif printf '%s' "$CMD_LOWER" | grep -qE '^\[|^test\s|^if\s|^which\s|^command\s' 2>/dev/null; then
  echo '{}'
  exit 0

# pip/cargo install (always allowed - needed for setup)
elif printf '%s' "$CMD_LOWER" | grep -qE '^pip\s+install|^pip3\s+install|^cargo\s+install' 2>/dev/null; then
  echo '{}'
  exit 0

# Git read-only (always allowed)
elif printf '%s' "$CMD_LOWER" | grep -qE 'git\s+(status|log|diff|show|branch|tag|remote|fetch|stash\s+list)' 2>/dev/null; then
  echo '{}'
  exit 0

# Package manager read (always allowed)
elif printf '%s' "$CMD_LOWER" | grep -qE '(pip\s+list|pip\s+show|npm\s+list|cargo\s+--version|python\s+--version|node\s+--version)' 2>/dev/null; then
  echo '{}'
  exit 0

# kanoniv-auth commands (always allowed - meta)
elif printf '%s' "$CMD_LOWER" | grep -qE 'kanoniv-auth' 2>/dev/null; then
  echo '{}'
  exit 0

# Default: require code.edit for any unrecognized command
else
  SCOPE="code.edit"
fi

# Verify the scope
if [ -n "$SCOPE" ]; then
  RESULT=$(kanoniv-auth verify --scope "$SCOPE" --token "$TOKEN" 2>&1) || {
    # Verification failed - block the command
    # Extract the error message
    ERROR=$(echo "$RESULT" | grep -v "^$" | head -5)

    # Escape for JSON
    ERROR_JSON=$(printf '%s' "$ERROR" | python3 -c '
import sys, json
print(json.dumps(sys.stdin.read()))
' 2>/dev/null | sed 's/^"//;s/"$//')

    cat <<BLOCK
{"permissionDecision":"block","message":"SCOPE DENIED: requires '$SCOPE'\n\n$ERROR_JSON\n\nTo add this scope, re-delegate:\n  kanoniv-auth delegate --name claude-code --scopes ...,${SCOPE} --ttl 4h"}
BLOCK
    exit 0
  }
fi

# Scope verified or not required - allow
echo '{}'
