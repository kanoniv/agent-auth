#!/usr/bin/env bash
# One-line installer for kanoniv-auth Claude Code skills
# curl -fsSL https://raw.githubusercontent.com/kanoniv/agent-auth/main/skill/bin/install-remote.sh | bash
set -euo pipefail

REPO="https://raw.githubusercontent.com/kanoniv/agent-auth/main"
SKILLS_DIR="${HOME}/.claude/skills"

echo "Installing kanoniv-auth skills for Claude Code..."

# Check if kanoniv-auth CLI is available
if ! which kanoniv-auth >/dev/null 2>&1; then
  echo "Installing kanoniv-auth Python package..."
  pip install kanoniv-auth 2>/dev/null || pip3 install kanoniv-auth 2>/dev/null || {
    echo ""
    echo "Could not auto-install kanoniv-auth."
    echo "Install manually: pip install kanoniv-auth"
    echo "Then re-run this script."
    exit 1
  }
fi

# Download and install /delegate skill
mkdir -p "$SKILLS_DIR/delegate/bin"
curl -fsSL "$REPO/skill/SKILL.md" > "$SKILLS_DIR/delegate/SKILL.md"
curl -fsSL "$REPO/skill/bin/check-scope.sh" > "$SKILLS_DIR/delegate/bin/check-scope.sh"
curl -fsSL "$REPO/skill/bin/check-edit-scope.sh" > "$SKILLS_DIR/delegate/bin/check-edit-scope.sh"
curl -fsSL "$REPO/skill/bin/log-action.sh" > "$SKILLS_DIR/delegate/bin/log-action.sh"
chmod +x "$SKILLS_DIR/delegate/bin/"*.sh

# Download and install /audit skill
mkdir -p "$SKILLS_DIR/audit"
curl -fsSL "$REPO/skill/audit/SKILL.md" > "$SKILLS_DIR/audit/SKILL.md"

# Download and install /status skill
mkdir -p "$SKILLS_DIR/status"
curl -fsSL "$REPO/skill/status/SKILL.md" > "$SKILLS_DIR/status/SKILL.md"

echo ""
echo "Installed 3 skills:"
echo ""
echo "  /delegate  - Start a scoped session (with enforcement hooks)"
echo "  /audit     - View the agent audit trail"
echo "  /status    - Check current delegation status"
echo ""
echo "Start Claude Code and type /delegate to begin."
