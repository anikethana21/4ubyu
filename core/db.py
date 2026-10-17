"""
4 U By U - Supabase Database & Storage Client
Provides unified, thread-safe access to Supabase PostgreSQL and Storage.
"""

import os
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_supabase_client: Optional[Client] = None

def get_supabase_client() -> Client:
    """Returns a singleton Supabase client instance."""
    global _supabase_client
    if _supabase_client is None:
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in environment.")
        _supabase_client = create_client(supabase_url, supabase_key)
    return _supabase_client
