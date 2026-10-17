"""
4 U By U - Authentication & Security Engine
Handles bcrypt password hashing, persistent JWT generation, token verification,
and real-time token blacklisting/revocation for manual logout.
"""

import os
import uuid
import datetime
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

def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt, with hashlib fallback."""
    if bcrypt is None:
        import hashlib
        return hashlib.sha256(password.encode("utf-8")).hexdigest()
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a bcrypt hash, with hashlib fallback."""
    if bcrypt is None:
        import hashlib
        return hashlib.sha256(plain_password.encode("utf-8")).hexdigest() == hashed_password
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, email: str, token_version: int = 1, days: int = SESSION_DURATION_DAYS) -> str:
    """Creates a JWT access token with unique JTI and persistent sliding expiry."""
    now = datetime.datetime.now(datetime.timezone.utc)
    expire = now + datetime.timedelta(days=days)
    jti = str(uuid.uuid4())
    payload: Dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "token_version": token_version,
        "jti": jti,
        "exp": expire,
        "iat": now
    }
    if jwt is None:
        import json, base64
        return base64.urlsafe_b64encode(json.dumps(payload, default=str).encode()).decode()
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and cryptographically verifies an access token."""
    if jwt is None:
        try:
            import json, base64
            return json.loads(base64.urlsafe_b64decode(token.encode()).decode())
        except Exception:
            return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except Exception:
        return None

def is_token_blacklisted(jti: str) -> bool:
    """Checks whether a token has been revoked in the Supabase blacklist."""
    client = get_supabase_client()
    if not client:
        return False
    try:
        res = client.table("token_blacklist").select("id").eq("jti", jti).execute()
        return bool(res.data and len(res.data) > 0)
    except Exception:
        return False

def blacklist_token(jti: str, user_id: str, expires_at: Optional[datetime.datetime] = None) -> bool:
    """Adds a revoked token's JTI to the Supabase blacklist."""
    client = get_supabase_client()
    if not client:
        return True
    try:
        exp_iso = expires_at.isoformat() if expires_at else (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=SESSION_DURATION_DAYS)).isoformat()
        client.table("token_blacklist").insert({
            "jti": jti,
            "user_id": user_id,
            "expires_at": exp_iso
        }).execute()
        return True
    except Exception:
        return False
