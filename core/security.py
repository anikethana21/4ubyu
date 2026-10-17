"""
4 U By U - Authentication & Security Engine
Handles bcrypt password hashing, persistent JWT generation, token verification,
and real-time token blacklisting/revocation for manual logout.
Features cryptographically secure PBKDF2-HMAC-SHA256 and pure HMAC-SHA256
token fallbacks when external C-extensions are missing or restricted.
"""

import os
import uuid
import datetime
import json
import base64
import hmac
import hashlib
import secrets
from typing import Optional, Dict, Any
from dotenv import load_dotenv
from core.db import get_supabase_client

load_dotenv()

try:
    import bcrypt
except ImportError:
    bcrypt = None

try:
    import jwt
except ImportError:
    jwt = None

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-4ubyu-jwt-key")
JWT_ALGORITHM = "HS256"
SESSION_DURATION_DAYS = 30  # Persistent session: stays active until manual logout


# ---------------------------------------------------------------------------
# PASSWORD HASHING & VERIFICATION (BCRYPT + PBKDF2 SECURE FALLBACK)
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt, with salted PBKDF2-HMAC-SHA256 fallback."""
    if bcrypt is not None:
        try:
            salt = bcrypt.gensalt(rounds=12)
            hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
            return hashed.decode("utf-8")
        except Exception:
            pass

    # High-security standard library fallback (100,000 iterations, 16-byte random salt)
    salt_hex = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_hex.encode("utf-8"), 100000)
    return f"pbkdf2:sha256:100000${salt_hex}${dk.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plaintext password against bcrypt, PBKDF2, or legacy hashes
    using constant-time comparison to prevent timing attacks.
    """
    if not plain_password or not hashed_password:
        return False

    # 1. Bcrypt hash format ($2a$, $2b$, $2y$)
    if hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        if bcrypt is not None:
            try:
                return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
            except Exception:
                return False
        return False

    # 2. PBKDF2 format: pbkdf2:sha256:100000$<salt>$<hash>
    if hashed_password.startswith("pbkdf2:sha256:"):
        try:
            parts = hashed_password.split("$")
            if len(parts) == 3:
                rounds_part, salt_hex, expected_hex = parts
                rounds = int(rounds_part.split(":")[-1])
                dk = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt_hex.encode("utf-8"), rounds)
                return hmac.compare_digest(dk.hex(), expected_hex)
        except Exception:
            return False

    # 3. Legacy SHA-256 fallback (backward compatibility with previous version)
    try:
        legacy_hash = hashlib.sha256(plain_password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy_hash, hashed_password)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT GENERATION & VERIFICATION (PYJWT + HMAC-SHA256 CRYPTO FALLBACK)
# ---------------------------------------------------------------------------

def _b64url_encode(data: bytes) -> str:
    """Base64URL encoding without trailing padding."""
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    """Base64URL decoding with reinstated padding."""
    rem = len(s) % 4
    if rem:
        s += "=" * (4 - rem)
    return base64.urlsafe_b64decode(s.encode("utf-8"))


def create_access_token(user_id: str, email: str, token_version: int = 1, days: int = SESSION_DURATION_DAYS) -> str:
    """Creates a cryptographically signed JWT access token with JTI and sliding expiry."""
    now = datetime.datetime.now(datetime.timezone.utc)
    expire = now + datetime.timedelta(days=days)
    jti = str(uuid.uuid4())
    now_ts = int(now.timestamp())
    exp_ts = int(expire.timestamp())

    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "token_version": token_version,
        "jti": jti,
        "iat": now_ts,
        "exp": exp_ts
    }

    if jwt is not None:
        try:
            return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        except Exception:
            pass

    # Pure standard library RFC 7519 HMAC-SHA256 implementation
    header = {"alg": "HS256", "typ": "JWT"}
    h_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    p_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    h_b64 = _b64url_encode(h_bytes)
    p_b64 = _b64url_encode(p_bytes)
    sig_input = f"{h_b64}.{p_b64}".encode("utf-8")
    sig = hmac.new(JWT_SECRET.encode("utf-8"), sig_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(sig)

    return f"{h_b64}.{p_b64}.{sig_b64}"


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes, verifies signature, and checks expiry for access token."""
    if not token or not isinstance(token, str):
        return None

    if jwt is not None:
        try:
            return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except Exception:
            # Fall through to pure implementation in case format differs
            pass

    # Pure standard library verification
    try:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return None
        h_b64, p_b64, sig_b64 = parts

        # Verify HMAC-SHA256 signature
        sig_input = f"{h_b64}.{p_b64}".encode("utf-8")
        expected_sig = hmac.new(JWT_SECRET.encode("utf-8"), sig_input, hashlib.sha256).digest()
        actual_sig = _b64url_decode(sig_b64)

        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        # Parse and validate payload
        payload_bytes = _b64url_decode(p_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))

        # Verify expiration
        exp = payload.get("exp")
        if exp is not None:
            now_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            if now_ts > int(exp):
                return None  # Expired

        return payload
    except Exception:
        return None


# ---------------------------------------------------------------------------
# TOKEN BLACKLIST & REVOCATION
# ---------------------------------------------------------------------------

def is_token_blacklisted(jti: str) -> bool:
    """Checks whether a token has been revoked in the Supabase blacklist."""
    if not jti:
        return False
    client = get_supabase_client()
    if not client:
        return False
    try:
        res = client.table("token_blacklist").select("id").eq("jti", jti).execute()
        return bool(res.data and len(res.data) > 0)
    except Exception:
        return False


def blacklist_token(jti: str, user_id: str, expires_at: Optional[Any] = None) -> bool:
    """Adds a revoked token's JTI to the Supabase blacklist."""
    if not jti:
        return False
    client = get_supabase_client()
    if not client:
        return True  # If client is None, proceed without error
    try:
        if isinstance(expires_at, (int, float)):
            exp_iso = datetime.datetime.fromtimestamp(expires_at, tz=datetime.timezone.utc).isoformat()
        elif isinstance(expires_at, datetime.datetime):
            exp_iso = expires_at.isoformat()
        else:
            exp_iso = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=SESSION_DURATION_DAYS)).isoformat()

        client.table("token_blacklist").insert({
            "jti": jti,
            "user_id": str(user_id),
            "expires_at": exp_iso
        }).execute()
        return True
    except Exception:
        return False
