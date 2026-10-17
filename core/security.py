"""
4 U By U - Authentication & Security Engine
Handles bcrypt password hashing, persistent JWT generation, token verification,
and real-time token blacklisting/revocation for manual logout.
"""

import os
import uuid
import datetime
from typing import Optional, Dict, Any
import bcrypt
import jwt
from dotenv import load_dotenv
from core.db import get_supabase_client

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-4ubyu-jwt-key")
JWT_ALGORITHM = "HS256"
SESSION_DURATION_DAYS = 30  # Persistent session: stays active until manual logout

def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a bcrypt hash."""
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
        "sub": str(user_id),
        "email": email,
        "token_version": token_version,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp())
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates JWT signature and expiration."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def is_token_blacklisted(jti: str) -> bool:
    """Checks whether the token JTI exists in the token_blacklist table."""
    try:
        client = get_supabase_client()
        res = client.table("token_blacklist").select("id").eq("token_jti", jti).execute()
        return bool(res.data and len(res.data) > 0)
    except Exception:
        return False

def blacklist_token(jti: str, user_id: Optional[str], exp_timestamp: Optional[int]) -> bool:
    """Adds the token JTI to token_blacklist to revoke it immediately upon logout."""
    try:
        client = get_supabase_client()
        if exp_timestamp:
            expires_at = datetime.datetime.fromtimestamp(exp_timestamp, tz=datetime.timezone.utc).isoformat()
        else:
            expires_at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=SESSION_DURATION_DAYS)).isoformat()
        client.table("token_blacklist").insert({
            "token_jti": jti,
            "user_id": user_id,
            "expires_at": expires_at
        }).execute()
        return True
    except Exception as e:
        print(f"Error blacklisting token: {e}")
        return False
