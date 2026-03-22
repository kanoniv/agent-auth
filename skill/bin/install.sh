#!/usr/bin/env bash
# Install the /delegate skill into Claude Code
set -euo pipefail

SKILL_DIR="${HOME}/.claude/skills/delegate"

# Check if kanoniv-auth is installed
if ! which kanoniv-auth >/dev/null 2>&1; then
  echo "Installing kanoniv-auth..."
  pip install kanoniv-auth 2>/dev/null || pip3 install kanoniv-auth 2>/dev/null || {
    echo "Error: Could not install kanoniv-auth. Install manually: pip install kanoniv-auth"
    exit 1
  }
fi

# Copy skill files
mkdir -p "$SKILL_DIR/bin"
cp "$(dirname "$0")/../SKILL.md" "$SKILL_DIR/SKILL.md"
cp "$(dirname "$0")/check-scope.sh" "$SKILL_DIR/bin/check-scope.sh"
chmod +x "$SKILL_DIR/bin/check-scope.sh"

echo "Installed /delegate skill to $SKILL_DIR"
echo ""
echo "Usage:"
echo "  1. Start Claude Code"
echo "  2. Type: /delegate"
echo "  3. Choose your scopes"
echo "  4. Claude Code is now scope-enforced"
echo ""
echo "Commands:"
echo "  /delegate  - Start a scoped session"
echo "  /audit     - View session audit log"
echo "  /status    - Check current delegation"
