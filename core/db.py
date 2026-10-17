"""
4 U By U - Supabase Database & Storage Client
Provides unified, thread-safe access to Supabase PostgreSQL and Storage.
"""

import os
from typing import Optional, Any
from dotenv import load_dotenv

load_dotenv()

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = Any

_supabase_client: Optional[Any] = None

def get_supabase_client() -> Optional[Any]:
    """Returns a singleton Supabase client instance, or None if unconfigured/unavailable."""
    global _supabase_client
    if create_client is None:
        return None
    if _supabase_client is None:
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            return None
        try:
            _supabase_client = create_client(supabase_url, supabase_key)
        except Exception as e:
            print(f"[Supabase] Initialization notice: {e}")
            return None
    return _supabase_client
