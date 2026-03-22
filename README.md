# Sudo for AI Agents

**Your AI agents currently have keys. We give them math instead.**

```bash
pip install kanoniv-auth
```

```python
from kanoniv_auth import delegate, verify

token = delegate(scopes=["deploy.staging"], ttl="4h")

verify(action="deploy.staging", token=token)  # works
verify(action="deploy.prod", token=token)     # raises ScopeViolation
```

That second line doesn't just fail. It **cannot** succeed. Not policy-blocked, not RBAC-blocked - cryptographically impossible without the root key.

## Claude Code Skill

Scope-enforce your AI coding agent in one command:

```bash
kanoniv-auth install-skill
```

Then in Claude Code:

```
/delegate
> What should Claude Code be allowed to do?
> A) Full dev - code.edit, test.run, git.commit, git.push
```

Every tool call is now verified. If Claude tries to exceed its scope:

```
SCOPE DENIED: requires git.push

  You have:  ["code.edit", "test.run"]
  You need:  ["git.push"]
```

The command never runs. Type `/audit` to see every action the agent took. Type `/status` to check the current delegation.

## Named Agents

Agents keep the same identity across sessions:

```bash
kanoniv-auth delegate --name claude-code --scopes code.edit,test.run --ttl 4h
kanoniv-auth delegate --name deploy-bot --scopes deploy.staging --ttl 1h
```

Same name = same DID every time. Your audit trail shows a consistent history.

## Hierarchical Scopes

Scopes are dot-separated and hierarchical:

```
git.push                          # any repo, any branch
git.push.agent-auth               # agent-auth only
git.push.agent-auth.main          # agent-auth main only
```

`git.push` grants everything below it. `git.push.agent-auth.main` grants only that specific repo and branch.

## Git Pre-Push Hook

Invisible enforcement at the git level:

```bash
kanoniv-auth install-hook
```

Now `git push` verifies `git.push.{repo}.{branch}` scope before allowing the push. No wrapper needed - just push as normal.

## Exec Wrapper

Verify, run, sign in one command:

```bash
kanoniv-auth exec --scope deploy.staging -- ./deploy.sh staging
```

If the scope check fails, the command never runs. If it succeeds, the result is signed for the audit trail.

## Audit Trail

Every delegate, verify, sign, and exec is auto-logged:

```bash
kanoniv-auth audit-log --agent claude-code
```

```
19:15:03  claude-code  tool:bash   git commit -m "feat: ..."     ok
19:15:05  claude-code  tool:bash   cargo test --lib               ok
19:15:08  claude-code  tool:edit   src/lib.rs                     ok
19:15:12  claude-code  tool:bash   git push origin main           DENIED
```

## How It Works

**Ed25519 signatures.** Every delegation is a signed message. The chain is self-contained - verification requires no network call, no database, no trust in any third party.

**Scope narrowing.** Delegations can only narrow, never widen. Root grants `[build, test, deploy.staging]`. Sub-delegation can grant `[deploy.staging]` but cannot add `deploy.prod`. Enforced by the math, not by policy.

**Offline verification.** Base64-encoded JSON tokens containing the delegation chain, agent DID, scopes, and expiry. Each chain link includes the issuer's public key and signature. Verifiable anywhere.

## Install

```bash
pip install kanoniv-auth                              # Python SDK + CLI
kanoniv-auth install-skill                            # Claude Code skills
kanoniv-auth install-hook                             # Git pre-push enforcement
```

Or with Rust:

```bash
cargo install kanoniv-agent-auth --features cli       # Rust CLI
```

## Docs

Full documentation at [auth.kanoniv.com](https://auth.kanoniv.com):

- [Getting Started](https://auth.kanoniv.com/guide/getting-started)
- [Claude Code Skill](https://auth.kanoniv.com/guide/claude-code-skill)
- [CLI Reference](https://auth.kanoniv.com/reference/cli)
- [Python API](https://auth.kanoniv.com/reference/python-api)
- [Token Format Spec](https://auth.kanoniv.com/reference/token-format)

## License

MIT
