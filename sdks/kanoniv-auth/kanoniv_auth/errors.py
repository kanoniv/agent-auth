"""Rich error types for delegation failures.

Every error tells you what happened, what you have, what you need,
and how to fix it. Not just 'denied' - a teaching moment.
"""

from __future__ import annotations


class AuthError(Exception):
    """Base error for kanoniv-auth operations."""
    pass


class ScopeViolation(AuthError):
    """Agent tried to use a scope not in its delegation.

    The error message shows exactly what scopes the agent has,
    what scope it tried to use, and how to request escalation.
    """

    def __init__(self, scope: str, has: list[str], delegator_did: str | None = None):
        self.scope = scope
        self.has = has
        self.delegator_did = delegator_did
        super().__init__(self._format())

    def _format(self) -> str:
        lines = [
            f'DENIED: scope "{self.scope}" not in delegation',
            "",
            f"  You have:  {self.has}",
            f'  You need:  ["{self.scope}"]',
        ]
        if self.delegator_did:
            lines.extend([
                "",
                "  To request escalation:",
                f"    kanoniv-auth request-scope --scope {self.scope} --from {self.delegator_did}",
            ])
        return "\n".join(lines)


class TokenExpired(AuthError):
    """Delegation token has expired.

    Shows how long ago it expired and suggests re-delegation.
    """

    def __init__(self, expired_seconds_ago: float):
        self.expired_seconds_ago = expired_seconds_ago
        super().__init__(self._format())

    def _format(self) -> str:
        ago = self.expired_seconds_ago
        if ago < 60:
            ago_str = f"{ago:.0f}s ago"
        elif ago < 3600:
            ago_str = f"{ago / 60:.0f}m ago"
        else:
            ago_str = f"{ago / 3600:.1f}h ago"
        return (
            f"EXPIRED: token expired {ago_str}\n"
            "\n"
            "  Re-delegate:\n"
            "    kanoniv-auth delegate --scopes <scopes> --ttl <ttl>"
        )


class ChainTooDeep(AuthError):
    """Delegation chain exceeds maximum depth."""

    def __init__(self, depth: int, max_depth: int = 32):
        self.depth = depth
        self.max_depth = max_depth
        super().__init__(
            f"DENIED: delegation chain depth {depth} exceeds maximum {max_depth}"
        )


class SignatureInvalid(AuthError):
    """A signature in the delegation chain failed verification."""

    def __init__(self, depth: int, signer_did: str, reason: str = ""):
        self.depth = depth
        self.signer_did = signer_did
        self.reason = reason
        super().__init__(
            f"DENIED: signature invalid at chain link {depth} (signer: {signer_did})"
            + (f" - {reason}" if reason else "")
        )


class TokenParseError(AuthError):
    """Token string could not be decoded."""

    def __init__(self, detail: str = ""):
        super().__init__(
            f"DENIED: invalid token format"
            + (f" - {detail}" if detail else "")
            + "\n\n  Tokens are base64-encoded JSON from 'kanoniv-auth delegate'"
        )


class NoRootKey(AuthError):
    """No root key loaded. Cannot delegate."""

    def __init__(self):
        super().__init__(
            "No root key loaded.\n"
            "\n"
            "  Generate one:\n"
            "    kanoniv-auth init\n"
            "\n"
            "  Or load from file:\n"
            "    from kanoniv_auth import load_root\n"
            '    root = load_root("~/.kanoniv/root.key")'
        )
