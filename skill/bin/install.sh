#!/usr/bin/env bash
# Install kanoniv-auth skills into Claude Code
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="${HOME}/.claude/skills"

# Check if kanoniv-auth is installed
if ! which kanoniv-auth >/dev/null 2>&1; then
  echo "Installing kanoniv-auth..."
  pip install kanoniv-auth 2>/dev/null || pip3 install kanoniv-auth 2>/dev/null || {
    echo "Error: Could not install kanoniv-auth. Install manually: pip install kanoniv-auth"
    exit 1
  }
fi

# Install /delegate skill (with hooks)
mkdir -p "$SKILLS_DIR/delegate/bin"
cp "$SCRIPT_DIR/SKILL.md" "$SKILLS_DIR/delegate/SKILL.md"
cp "$SCRIPT_DIR/bin/check-scope.sh" "$SKILLS_DIR/delegate/bin/check-scope.sh"
cp "$SCRIPT_DIR/bin/check-edit-scope.sh" "$SKILLS_DIR/delegate/bin/check-edit-scope.sh"
cp "$SCRIPT_DIR/bin/log-action.sh" "$SKILLS_DIR/delegate/bin/log-action.sh"
chmod +x "$SKILLS_DIR/delegate/bin/"*.sh

# Install /audit skill
mkdir -p "$SKILLS_DIR/audit"
cp "$SCRIPT_DIR/audit/SKILL.md" "$SKILLS_DIR/audit/SKILL.md"

# Install /status skill
mkdir -p "$SKILLS_DIR/status"
cp "$SCRIPT_DIR/status/SKILL.md" "$SKILLS_DIR/status/SKILL.md"

echo "Installed 3 kanoniv-auth skills:"
echo ""
echo "  /delegate  - Start a scoped session (with scope enforcement hooks)"
echo "  /audit     - View the agent audit trail"
echo "  /status    - Check current delegation status"
echo ""
echo "Usage:"
echo "  1. Start Claude Code"
echo "  2. Type: /delegate"
echo "  3. Choose your scopes"
echo "  4. Every tool call is now verified and logged"
echo ""
echo "  Type /audit anytime to see what happened"
echo "  Type /status to check your current delegation"
