"""
4 U By U - FastAPI Authentication Dependencies
Extracts and validates persistent user sessions from Authorization headers or cookies.
"""

from typing import Optional, Dict, Any
from fastapi import Request, HTTPException, status
from core.security import decode_access_token, is_token_blacklisted
from core.db import get_supabase_client

async def extract_token_from_request(request: Request) -> Optional[str]:
    """Extracts bearer token from Authorization header or auth_token cookie."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    cookie_token = request.cookies.get("auth_token")
    if cookie_token:
        return cookie_token.strip()
    return None

async def get_current_user(request: Request) -> Dict[str, Any]:
    """Strict dependency: requires a valid, non-blacklisted authenticated user session."""
    token = await extract_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    jti = payload.get("jti")
    if jti and is_token_blacklisted(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been logged out. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    client = get_supabase_client()
    try:
        res = client.table("users").select("id, email, token_version, created_at").eq("id", user_id).execute()
        if not res.data or len(res.data) == 0:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account not found.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user = res.data[0]
        if user.get("token_version", 1) != payload.get("token_version", 1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to password change or logout.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user["jti"] = jti
        user["token_exp"] = payload.get("exp")
        user["token"] = token
        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database authentication error: {str(e)}"
        )

async def get_optional_current_user(request: Request) -> Optional[Dict[str, Any]]:
    """Lenient dependency: returns current user if authenticated, or None if guest."""
    try:
        return await get_current_user(request)
    except HTTPException:
        return None
