"""kanoniv-auth: Sudo for AI agents.

Replace API keys with cryptographic delegation.

    from kanoniv_auth import delegate, verify, sign

    token = delegate(scopes=["deploy.staging"], ttl="4h")
    verify(action="deploy.staging", token=token)   # works
    verify(action="deploy.prod", token=token)       # raises ScopeViolation
"""

from kanoniv_auth.auth import delegate, verify, sign, init_root, load_root
from kanoniv_auth.errors import (
    AuthError,
    ScopeViolation,
    TokenExpired,
    ChainTooDeep,
    SignatureInvalid,
    TokenParseError,
)
from kanoniv_auth.crypto import KeyPair, generate_keys, load_keys

__version__ = "0.1.0"
__all__ = [
    "delegate",
    "verify",
    "sign",
    "init_root",
    "load_root",
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
