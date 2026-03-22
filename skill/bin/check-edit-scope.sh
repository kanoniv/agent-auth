#!/usr/bin/env bash
# check-edit-scope.sh - PreToolUse hook for Edit/Write tools
set -euo pipefail

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

if ! kanoniv-auth verify --scope code.edit --token "$TOKEN" >/dev/null 2>&1; then
  printf '{"permissionDecision":"block","message":"SCOPE DENIED: file editing requires code.edit scope"}\n'
  exit 0
fi

echo '{}'
