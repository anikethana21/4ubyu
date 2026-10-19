"""
4 U By U - User Workspace & Storage Manager
Provides strictly isolated workspace CRUD over stored notes data (local file +
Supabase row, re-rendered on request), and a user-encrypted settings vault.
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
from core.notes_document import (
    NOTES_SCHEMA_VERSION,
    coerce_notes_document,
    notes_document_to_json,
    render_notes_html,
    validate_notes_document,
)

try:
    STORAGE_USERS_DIR = BASE_DIR / "storage" / "users"
    STORAGE_USERS_DIR.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    STORAGE_USERS_DIR = Path(tempfile.gettempdir()) / "4ubyu" / "storage" / "users"
    STORAGE_USERS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# WORKSPACE CRUD & ISOLATED STORAGE
#
# A workspace is stored as its notes data and drawn back into HTML on request.
# The page itself is a function of that data, more than half of it is the same
# stylesheet copied into every workspace, and a stored page cannot be improved
# later; the data can.
# ---------------------------------------------------------------------------

def _user_workspace_dir(user_id: str, create: bool = True) -> Path:
    """The user's own directory, so one user's id can never name another's file."""
    for base in (STORAGE_USERS_DIR, Path(tempfile.gettempdir()) / "4ubyu" / "storage" / "users"):
        path = base / user_id / "workspaces"
        try:
            if create:
                path.mkdir(parents=True, exist_ok=True)
            if path.exists():
                return path
        except (OSError, PermissionError):
            continue
    return STORAGE_USERS_DIR / user_id / "workspaces"


def _write_local_document(user_id: str, workspace_id: str, document: Dict[str, Any]) -> None:
    try:
        path = _user_workspace_dir(user_id) / f"{workspace_id}.json"
        path.write_text(notes_document_to_json(document), encoding="utf-8")
    except Exception as e:
        print(f"[WorkspaceManager] Local notes write notice: {e}")


def _read_local_document(user_id: str, workspace_id: str) -> Optional[Dict[str, Any]]:
    path = _user_workspace_dir(user_id, create=False) / f"{workspace_id}.json"
    if not path.exists():
        return None
    try:
        return coerce_notes_document(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[WorkspaceManager] Local notes read notice: {e}")
        return None


def save_user_workspace(
    user_id: str,
    youtube_url: str,
    video_id: str,
    video_title: str,
    channel_name: Optional[str],
    duration: Optional[str],
    chapter_count: int,
    notes_document: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Saves generated notes privately for the user, locally and in Supabase."""
    client = get_supabase_client()
    workspace_id = str(uuid.uuid4())
    document = notes_document or {}

    problems = validate_notes_document(document)
    if problems:
        print(
            f"[WorkspaceManager] Workspace {workspace_id} saved with notes that "
            f"cannot be rendered yet: {'; '.join(problems)}"
        )

    # 1. Local copy, so a local run reads its own notes without a database
    _write_local_document(user_id, workspace_id, document)

    # 2. The row itself, carrying the notes
    if client:
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
                "notes_schema_version": NOTES_SCHEMA_VERSION,
                "notes_data": document,
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
        # Fallback to the local partition. Both shapes are listed: workspaces
        # stored as notes data, and pages saved before that was the case.
        workspaces = []
        user_ws_dir = _user_workspace_dir(user_id, create=False)
        if user_ws_dir.exists():
            for f in sorted(user_ws_dir.glob("*.json")):
                ws_id = f.stem
                document = _read_local_document(user_id, ws_id) or {}
                meta = document.get("video_metadata") or {}
                workspaces.append({
                    "id": ws_id,
                    "user_id": user_id,
                    "video_title": meta.get("title") or f"Workspace {ws_id[:8]}",
                    "channel_name": meta.get("channel") or "Local Storage",
                    "duration": meta.get("duration_str") or "00:00",
                    "chapter_count": len(document.get("chapters") or []),
                    "view_url": f"/api/workspaces/{ws_id}/view"
                })
            for f in sorted(user_ws_dir.glob("*.html")):
                if f.stem in {w["id"] for w in workspaces}:
                    continue
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
        # The notes themselves are deliberately not selected: they are the bulk of
        # the row, and a library listing does not render them.
        res = (
            client.table("workspaces")
            .select(
                "id, user_id, youtube_url, video_id, video_title, channel_name, "
                "duration, chapter_count, status, created_at"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        workspaces = res.data or []
        for ws in workspaces:
            ws["view_url"] = f"/api/workspaces/{ws['id']}/view"
        return workspaces
    except Exception as e:
        print(f"[WorkspaceManager] List workspaces error: {e}")
        return []


def get_user_workspace_html(workspace_id: str, user_id: str) -> Optional[str]:
    """Returns the workspace page for its owner, drawn from the stored notes."""
    client = get_supabase_client()

    # The row is fetched first when there is a database, because it is also the
    # ownership check.
    row: Dict[str, Any] = {}
    if client:
        try:
            res = client.table("workspaces").select("*").eq("id", workspace_id).eq("user_id", user_id).execute()
            row = (res.data or [{}])[0]
        except Exception as e:
            print(f"[WorkspaceManager] Workspace lookup notice: {e}")
        if not row:
            return None

    # 1. The notes data: local copy first, since a local run has no database.
    document = _read_local_document(user_id, workspace_id)
    if document is None:
        document = coerce_notes_document(row.get("notes_data"))
        if document is not None:
            _write_local_document(user_id, workspace_id, document)

    if document is not None:
        problems = validate_notes_document(document)
        if problems:
            print(
                f"[WorkspaceManager] Workspace {workspace_id} has notes that cannot be "
                f"rendered: {'; '.join(problems)}"
            )
        try:
            return render_notes_html(document)
        except Exception as e:
            print(f"[WorkspaceManager] Workspace {workspace_id} render notice: {e}")

    # 2. Workspaces written before the notes were kept as data. Readable, but
    # they cannot be re-rendered — only the page was kept.
    legacy_paths = [
        _user_workspace_dir(user_id, create=False) / f"{workspace_id}.html",
        OUTPUT_DIR / f"notes_{row.get('video_id')}.html" if row.get("video_id") else None,
    ]
    for path in legacy_paths:
        if path and path.exists():
            try:
                return path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"[WorkspaceManager] Legacy workspace read notice: {e}")

    if client and row.get("storage_path"):
        try:
            return client.storage.from_("workspaces").download(row["storage_path"]).decode("utf-8")
        except Exception as e:
            print(f"[WorkspaceManager] Storage download notice: {e}")

    return None


def delete_user_workspace(workspace_id: str, user_id: str) -> bool:
    """Deletes workspace notes from the database and the local partition."""
    # 1. Local copies, both shapes
    user_ws_dir = _user_workspace_dir(user_id, create=False)
    for suffix in (".json", ".html"):
        local_file = user_ws_dir / f"{workspace_id}{suffix}"
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

        # Workspaces saved before this change may still have their page in
        # Storage; removing it keeps the deletion complete.
        if ws.get("storage_path"):
            try:
                client.storage.from_("workspaces").remove([ws["storage_path"]])
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
