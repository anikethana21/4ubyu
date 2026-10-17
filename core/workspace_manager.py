"""
4 U By U - User Workspace & Storage Manager
Provides strictly isolated workspace CRUD, local + Supabase Storage persistence,
and user-encrypted settings vault.
Guaranteed to operate cleanly even when cloud database is offline or unconfigured.
"""

import os
import uuid
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any
from config import BASE_DIR, OUTPUT_DIR
from core.db import get_supabase_client
from core.cipher import encrypt_secret, decrypt_secret, mask_secret

try:
    STORAGE_USERS_DIR = BASE_DIR / "storage" / "users"
    STORAGE_USERS_DIR.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    STORAGE_USERS_DIR = Path(tempfile.gettempdir()) / "4ubyu" / "storage" / "users"
    STORAGE_USERS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# WORKSPACE CRUD & ISOLATED STORAGE
# ---------------------------------------------------------------------------

def save_user_workspace(
    user_id: str,
    youtube_url: str,
    video_id: str,
    video_title: str,
    channel_name: Optional[str],
    duration: Optional[str],
    chapter_count: int,
    html_content: str
) -> Dict[str, Any]:
    """Saves generated workspace privately for user in local storage, Supabase Storage, and DB."""
    client = get_supabase_client()
    workspace_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{workspace_id}.html"

    # 1. Local user-partitioned file
    try:
        user_ws_dir = STORAGE_USERS_DIR / user_id / "workspaces"
        user_ws_dir.mkdir(parents=True, exist_ok=True)
    except (OSError, PermissionError):
        user_ws_dir = Path(tempfile.gettempdir()) / "4ubyu" / "storage" / "users" / user_id / "workspaces"
        user_ws_dir.mkdir(parents=True, exist_ok=True)

    local_file_path = user_ws_dir / f"{workspace_id}.html"
    try:
        with open(local_file_path, "w", encoding="utf-8") as f:
            f.write(html_content)
    except Exception as e:
        print(f"[WorkspaceManager] Local file write notice: {e}")

    # 2. Also keep in output/ for backward compatibility
    legacy_file = OUTPUT_DIR / f"notes_{video_id}.html"
    try:
        with open(legacy_file, "w", encoding="utf-8") as f:
            f.write(html_content)
    except Exception:
        pass

    # 3. Supabase Storage upload (if client connected)
    if client:
        try:
            html_bytes = html_content.encode("utf-8")
            client.storage.from_("workspaces").upload(
                storage_path,
                html_bytes,
                file_options={"content-type": "text/html; charset=utf-8", "upsert": "true"}
            )
        except Exception as e:
            print(f"[WorkspaceManager] Supabase Storage upload notice: {e}")

        # 4. Insert DB record
        try:
            record = {
                "id": workspace_id,
                "user_id": user_id,
                "youtube_url": youtube_url,
                "video_id": video_id,
                "video_title": video_title,
                "channel_name": channel_name or "YouTube",
                "duration": duration or "00:00",
                "chapter_count": chapter_count,
                "status": "completed",
                "storage_path": storage_path
            }
            client.table("workspaces").insert(record).execute()
        except Exception as e:
            print(f"[WorkspaceManager] Supabase DB record insert notice: {e}")

    return {
        "workspace_id": workspace_id,
        "video_id": video_id,
        "title": video_title,
        "channel": channel_name,
        "duration": duration,
        "chapter_count": chapter_count,
        "workspace_url": f"/api/workspaces/{workspace_id}/view"
    }


def list_user_workspaces(user_id: str) -> List[Dict[str, Any]]:
    """Retrieves all workspaces belonging exclusively to the current user."""
    client = get_supabase_client()
    if not client:
        # Fallback to local user partition
        workspaces = []
        user_ws_dir = STORAGE_USERS_DIR / user_id / "workspaces"
        if user_ws_dir.exists():
            for f in user_ws_dir.glob("*.html"):
                ws_id = f.stem
                workspaces.append({
                    "id": ws_id,
                    "user_id": user_id,
                    "video_title": f"Workspace {ws_id[:8]}",
                    "channel_name": "Local Storage",
                    "duration": "00:00",
                    "chapter_count": 1,
                    "view_url": f"/api/workspaces/{ws_id}/view"
                })
        return workspaces

    try:
        res = client.table("workspaces").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
        workspaces = res.data or []
        for ws in workspaces:
            ws["view_url"] = f"/api/workspaces/{ws['id']}/view"
        return workspaces
    except Exception as e:
        print(f"[WorkspaceManager] List workspaces error: {e}")
        return []


def get_user_workspace_html(workspace_id: str, user_id: str) -> Optional[str]:
    """Retrieves HTML content after verifying ownership."""
    # 1. Check local cache first
    local_file = STORAGE_USERS_DIR / user_id / "workspaces" / f"{workspace_id}.html"
    if local_file.exists():
        try:
            with open(local_file, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass

    client = get_supabase_client()
    if not client:
        return None

    try:
        res = client.table("workspaces").select("*").eq("id", workspace_id).eq("user_id", user_id).execute()
        if not res.data or len(res.data) == 0:
            return None
        ws = res.data[0]

        # 2. Fallback to output/ directory
        legacy_file = OUTPUT_DIR / f"notes_{ws.get('video_id')}.html"
        if legacy_file.exists():
            with open(legacy_file, "r", encoding="utf-8") as f:
                return f.read()

        # 3. Download from Supabase Storage
        storage_path = ws.get("storage_path") or f"{user_id}/{workspace_id}.html"
        data = client.storage.from_("workspaces").download(storage_path)
        content = data.decode("utf-8")
        # Cache locally for future requests
        try:
            local_file.parent.mkdir(parents=True, exist_ok=True)
            with open(local_file, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass
        return content
    except Exception as e:
        print(f"[WorkspaceManager] Fetch workspace HTML error: {e}")
        return None


def delete_user_workspace(workspace_id: str, user_id: str) -> bool:
    """Deletes workspace from database, local storage, and Supabase Storage."""
    # 1. Delete local file
    local_file = STORAGE_USERS_DIR / user_id / "workspaces" / f"{workspace_id}.html"
    if local_file.exists():
        try:
            local_file.unlink()
        except Exception:
            pass

    client = get_supabase_client()
    if not client:
        return True

    try:
        res = client.table("workspaces").select("*").eq("id", workspace_id).eq("user_id", user_id).execute()
        if not res.data or len(res.data) == 0:
            return False
        ws = res.data[0]

        # Delete from Supabase Storage
        try:
            storage_path = ws.get("storage_path") or f"{user_id}/{workspace_id}.html"
            client.storage.from_("workspaces").remove([storage_path])
        except Exception as e:
            print(f"[WorkspaceManager] Storage remove notice: {e}")

        # Delete DB record
        client.table("workspaces").delete().eq("id", workspace_id).eq("user_id", user_id).execute()
        return True
    except Exception as e:
        print(f"[WorkspaceManager] Delete workspace error: {e}")
        return False


# ---------------------------------------------------------------------------
# USER SETTINGS VAULT (ENCRYPTED)
# ---------------------------------------------------------------------------

DEFAULT_USER_SETTINGS = {
    "default_model": "openai/gpt-oss-120b",
    "preferred_theme": "dark_academic",
    "encrypted_groq_key": None,
    "encrypted_gemini_key": None,
    "encrypted_eraser_key": None
}

def get_or_create_user_settings(user_id: str) -> Dict[str, Any]:
    """Loads user settings, ensuring record exists with defaults."""
    client = get_supabase_client()
    if not client:
        fallback = dict(DEFAULT_USER_SETTINGS)
        fallback["user_id"] = user_id
        return fallback

    try:
        res = client.table("user_settings").select("*").eq("user_id", user_id).execute()
        if not res.data or len(res.data) == 0:
            default_settings = dict(DEFAULT_USER_SETTINGS)
            default_settings["user_id"] = user_id
            client.table("user_settings").insert(default_settings).execute()
            return default_settings
        return res.data[0]
    except Exception as e:
        print(f"[WorkspaceManager] Settings lookup notice: {e}")
        fallback = dict(DEFAULT_USER_SETTINGS)
        fallback["user_id"] = user_id
        return fallback


def get_user_settings_decrypted(user_id: str) -> Dict[str, Any]:
    """Retrieves settings with decrypted API keys for backend LLM operations."""
    settings = get_or_create_user_settings(user_id)
    return {
        "user_id": user_id,
        "default_model": settings.get("default_model") or "openai/gpt-oss-120b",
        "preferred_theme": settings.get("preferred_theme") or "dark_academic",
        "groq_api_key": decrypt_secret(settings.get("encrypted_groq_key")),
        "gemini_api_key": decrypt_secret(settings.get("encrypted_gemini_key")),
        "eraser_api_key": decrypt_secret(settings.get("encrypted_eraser_key"))
    }


def get_user_settings_safe_preview(user_id: str) -> Dict[str, Any]:
    """Retrieves settings with masked previews suitable for frontend display."""
    decrypted = get_user_settings_decrypted(user_id)
    return {
        "user_id": user_id,
        "default_model": decrypted["default_model"],
        "preferred_theme": decrypted["preferred_theme"],
        "has_groq_key": bool(decrypted["groq_api_key"]),
        "groq_key_preview": mask_secret(decrypted["groq_api_key"]),
        "has_gemini_key": bool(decrypted["gemini_api_key"]),
        "gemini_key_preview": mask_secret(decrypted["gemini_api_key"]),
        "has_eraser_key": bool(decrypted["eraser_api_key"]),
        "eraser_key_preview": mask_secret(decrypted["eraser_api_key"]),
    }


def update_user_settings_vault(
    user_id: str,
    default_model: Optional[str] = None,
    preferred_theme: Optional[str] = None,
    groq_api_key: Optional[str] = None,
    gemini_api_key: Optional[str] = None,
    eraser_api_key: Optional[str] = None
) -> Dict[str, Any]:
    """Updates settings, encrypting any newly provided API keys."""
    client = get_supabase_client()
    current = get_or_create_user_settings(user_id)
    updates: Dict[str, Any] = {}

    if default_model is not None:
        updates["default_model"] = default_model
    if preferred_theme is not None:
        updates["preferred_theme"] = preferred_theme

    if groq_api_key is not None:
        if groq_api_key.strip():
            updates["encrypted_groq_key"] = encrypt_secret(groq_api_key.strip())
        elif groq_api_key == "":
            updates["encrypted_groq_key"] = None

    if gemini_api_key is not None:
        if gemini_api_key.strip():
            updates["encrypted_gemini_key"] = encrypt_secret(gemini_api_key.strip())
        elif gemini_api_key == "":
            updates["encrypted_gemini_key"] = None

    if eraser_api_key is not None:
        if eraser_api_key.strip():
            updates["encrypted_eraser_key"] = encrypt_secret(eraser_api_key.strip())
        elif eraser_api_key == "":
            updates["encrypted_eraser_key"] = None

    if client and updates:
        try:
            client.table("user_settings").update(updates).eq("user_id", user_id).execute()
        except Exception as e:
            print(f"[WorkspaceManager] Settings update notice: {e}")

    # Return safe preview of updated settings
    current.update(updates)
    return get_user_settings_safe_preview(user_id)
