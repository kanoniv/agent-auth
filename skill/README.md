# /delegate - Claude Code Skill

Cryptographic scope enforcement for Claude Code sessions.

## Install

```bash
cd skill && bash bin/install.sh
```

Or manually copy to `~/.claude/skills/delegate/`.

## Usage

In Claude Code, type `/delegate`. Choose your scopes. Done.

```
User: /delegate
Claude: What should Claude Code be allowed to do this session?
  A) Full dev - code.edit, test.run, git.commit, git.push
  B) Read-only + test - code.read, test.run
  C) Custom scopes

User: A

Claude: Delegation active.
  Agent:  claude-code (did:agent:5e06...)
  Scopes: code.edit, test.run, git.commit, git.push
  TTL:    4h
```

Now every tool call is verified. If Claude tries to exceed its scope:

```
SCOPE DENIED: requires 'deploy.prod'

  You have:  ["code.edit", "test.run", "git.commit", "git.push"]
  You need:  ["deploy.prod"]

  To add this scope, re-delegate:
    kanoniv-auth delegate --name claude-code --scopes ...,deploy.prod --ttl 4h
```

## How It Works

- `SKILL.md` defines a `PreToolUse` hook on Bash, Edit, and Write tools
- `bin/check-scope.sh` reads the tool input, maps the command to a scope, and verifies against the delegation token
- The token is stored at `/tmp/.kanoniv-session-token` for the session
- Every operation is auto-logged to `~/.kanoniv/audit.log`

## Scope Mapping

| Command Pattern | Scope |
|----------------|-------|
| `git push` | git.push |
| `git commit`, `git add` | git.commit |
| `cargo test`, `pytest`, `npm test` | test.run |
| `cargo build`, `npm run build` | code.edit |
| `ls`, `cat`, `grep`, `git status` | always allowed |
| Everything else | code.edit |

## Requirements

- Python 3.10+
- `pip install kanoniv-auth`
