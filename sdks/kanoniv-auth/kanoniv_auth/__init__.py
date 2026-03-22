"""kanoniv-auth: Sudo for AI agents.

Replace API keys with cryptographic delegation.

    from kanoniv_auth import delegate, verify, sign

    token = delegate(scopes=["deploy.staging"], ttl="4h")
    verify(action="deploy.staging", token=token)   # works
    verify(action="deploy.prod", token=token)       # raises ScopeViolation
"""

from kanoniv_auth.auth import delegate, verify, sign, init_root, load_root, load_token, list_tokens
from kanoniv_auth.errors import (
    AuthError,
    ScopeViolation,
    TokenExpired,
    ChainTooDeep,
    SignatureInvalid,
    TokenParseError,
)
from kanoniv_auth.crypto import KeyPair, generate_keys, load_keys
from kanoniv_auth.registry import register_agent, get_agent, list_agents, resolve_name

__version__ = "0.2.0"
__all__ = [
    "delegate",
    "verify",
    "sign",
    "init_root",
    "load_root",
    "load_token",
    "list_tokens",
    "register_agent",
    "get_agent",
    "list_agents",
    "resolve_name",
    "AuthError",
    "ScopeViolation",
    "TokenExpired",
    "ChainTooDeep",
    "SignatureInvalid",
    "TokenParseError",
    "KeyPair",
    "generate_keys",
    "load_keys",
]
