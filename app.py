"""
4 U By U - FastAPI Web Application & Streaming Server
Serves the Landing Page, Study Library Dashboard, Generation API, SSE Streaming Chat,
Persistent User Authentication, Encrypted Settings Vault, and Private Workspaces.
"""

import os
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response, Depends, status
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, EmailStr

from config import BASE_DIR, OUTPUT_DIR, APP_MODE
from core.library_manager import get_library_entries, remove_library_entry, check_capacity_limits
from phase8_chatbot import ask_rag_stream
from main import run_master_notes_pipeline, inspect_video_for_hitl
from core.handbook_rag import stream_handbook_chat_response, get_suggestive_questions

# Auth, DB, Security & Workspace Isolation
# Auth, DB, Security & Workspace Isolation
from core.db import get_supabase_client

def require_supabase_client():
    client = get_supabase_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Cloud Database / Authentication service is not configured. Please set SUPABASE_URL and SUPABASE_KEY in Vercel environment variables."
        )
    return client

from core.security import hash_password, verify_password, create_access_token, blacklist_token
from core.auth_dependency import get_current_user, get_optional_current_user
from core.workspace_manager import (
    save_user_workspace,
    list_user_workspaces,
    get_user_workspace_html,
    delete_user_workspace,
    get_or_create_user_settings,
    get_user_settings_decrypted,
    get_user_settings_safe_preview,
    update_user_settings_vault
)

app = FastAPI(title="4 U By U - Educational Workspace Generator")

# Baseline Middleware: CORS Cross-Origin Support
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Static & Output Directories
static_dir = BASE_DIR / "static"
templates_dir = BASE_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")

templates = Jinja2Templates(directory=str(templates_dir))

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Serves brand logo icon for browser tab."""
    favicon_path = static_dir / "images" / "logo.png"
    if not favicon_path.exists():
        favicon_path = static_dir / "logo.png"
    if favicon_path.exists():
        return FileResponse(str(favicon_path))
    return Response(status_code=204)

# ---------------------------------------------------------------------------
# PYDANTIC SCHEMAS
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class SettingsUpdateRequest(BaseModel):
    default_model: Optional[str] = None
    preferred_theme: Optional[str] = None
    groq_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    eraser_api_key: Optional[str] = None

class InspectRequest(BaseModel):
    youtube_url: str
    api_key: Optional[str] = None
    model_name: Optional[str] = None

class SynthesizeRequest(BaseModel):
    youtube_url: str
    video_id: str
    approved_chapters: List[Dict[str, Any]]
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    eraser_api_key: Optional[str] = None
    color_palette: str = "dark_academic"
    visual_preference: str = "auto"
    output_format: str = "html"

class GenerateRequest(BaseModel):
    youtube_url: str
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    eraser_api_key: Optional[str] = None
    color_palette: str = "dark_academic"
    visual_preference: str = "auto"
    output_format: str = "html"

class ChatRequest(BaseModel):
    video_id: str
    question: str
    mode: Optional[str] = "grounded"
    api_key: Optional[str] = None
    model_name: Optional[str] = None

class HandbookChatRequest(BaseModel):
    question: str
    api_key: Optional[str] = None
    model_name: Optional[str] = None

# ---------------------------------------------------------------------------
# AUTHENTICATION & SESSION ENDPOINTS
# ---------------------------------------------------------------------------

@app.post("/api/auth/register")
async def register_user(req: RegisterRequest, response: Response):
    """Registers a new user, hashes password, creates default settings, and returns persistent JWT."""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    client = require_supabase_client()
    # Check if email is already registered
    existing = client.table("users").select("id").eq("email", email).execute()
    if existing.data and len(existing.data) > 0:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    import uuid
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(req.password)

    client.table("users").insert({
        "id": user_id,
        "email": email,
        "password_hash": pw_hash,
        "token_version": 1
    }).execute()

    # Initialize user settings
    get_or_create_user_settings(user_id)

    # Persistent 30-day JWT session token
    token = create_access_token(user_id=user_id, email=email, token_version=1)

    # Set HTTP-only cookie for frictionless direct links
    response.set_cookie(
        key="auth_token",
        value=token,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False  # Set True in production HTTPS
    )

    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user_id,
            "email": email
        }
    }

@app.post("/api/auth/login")
async def login_user(req: LoginRequest, response: Response):
    """Authenticates user with bcrypt, returns persistent JWT and sets session cookie."""
    email = req.email.strip().lower()
    client = require_supabase_client()
    res = client.table("users").select("*").eq("email", email).execute()
    if not res.data or len(res.data) == 0:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user = res.data[0]
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token_version = user.get("token_version", 1)
    token = create_access_token(user_id=user["id"], email=user["email"], token_version=token_version)

    response.set_cookie(
        key="auth_token",
        value=token,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False
    )

    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"]
        }
    }

@app.get("/api/auth/me")
async def get_current_user_profile(user: Dict[str, Any] = Depends(get_current_user)):
    """Returns profile for currently authenticated user."""
    return {
        "id": user["id"],
        "email": user["email"],
        "created_at": user.get("created_at")
    }

@app.post("/api/auth/logout")
async def logout_user(response: Response, user: Dict[str, Any] = Depends(get_current_user)):
    """Blacklists the JWT token, increments token_version to invalidate stale sessions, and clears cookie."""
    jti = user.get("jti")
    user_id = user.get("id")
    exp = user.get("token_exp")
    if jti:
        blacklist_token(jti, user_id, exp)

    # Invalidate other copies of token
    client = require_supabase_client()
    client.table("users").update({"token_version": user.get("token_version", 1) + 1}).eq("id", user_id).execute()

    response.delete_cookie("auth_token")
    return {"status": "logged_out"}

# ---------------------------------------------------------------------------
# USER SETTINGS VAULT (ENCRYPTED)
# ---------------------------------------------------------------------------

@app.get("/api/user/settings")
async def get_user_settings(user: Dict[str, Any] = Depends(get_current_user)):
    """Returns safe masked preview of user's saved API keys and preferences."""
    return get_user_settings_safe_preview(user["id"])

@app.put("/api/user/settings")
async def update_user_settings(req: SettingsUpdateRequest, user: Dict[str, Any] = Depends(get_current_user)):
    """Securely encrypts and updates user API keys, default model, and theme in Supabase."""
    updated = update_user_settings_vault(
        user_id=user["id"],
        default_model=req.default_model,
        preferred_theme=req.preferred_theme,
        groq_api_key=req.groq_api_key,
        gemini_api_key=req.gemini_api_key,
        eraser_api_key=req.eraser_api_key
    )
    return {"status": "updated", "settings": updated}

# ---------------------------------------------------------------------------
# PRIVATE USER WORKSPACES
# ---------------------------------------------------------------------------

@app.get("/api/workspaces")
async def get_user_workspaces(user: Dict[str, Any] = Depends(get_current_user)):
    """Returns only workspaces owned by the authenticated user."""
    workspaces = list_user_workspaces(user["id"])
    return {"workspaces": workspaces}

@app.get("/api/workspaces/{workspace_id}/view", response_class=HTMLResponse)
async def view_user_workspace(workspace_id: str, request: Request, user: Dict[str, Any] = Depends(get_current_user)):
    """Verifies ownership and serves the private 3-pane interactive handbook HTML."""
    html = get_user_workspace_html(workspace_id, user["id"])
    if not html:
        raise HTTPException(status_code=404, detail="Workspace not found or unauthorized.")
    return HTMLResponse(content=html, media_type="text/html; charset=utf-8")

@app.delete("/api/workspaces/{workspace_id}")
async def remove_user_workspace(workspace_id: str, user: Dict[str, Any] = Depends(get_current_user)):
    """Deletes workspace from database, local partition, and Supabase Storage."""
    deleted = delete_user_workspace(workspace_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found or unauthorized.")
    return {"status": "deleted", "workspace_id": workspace_id}

@app.get("/api/workspace/{video_id}/notebook")
async def export_workspace_notebook(video_id: str):
    """
    Converts a generated tri-pane HTML handbook into a Jupyter notebook (.ipynb)
    and returns it as a file download. Re-export is idempotent per call.
    """
    from core.notebook_exporter import HandbookNotebookConverter

    html_path = OUTPUT_DIR / f"notes_{video_id}.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"No generated handbook for video {video_id}.")

    try:
        nb_path = HandbookNotebookConverter.html_to_notebook(
            html_path, OUTPUT_DIR / "notebooks" / f"notes_{video_id}.ipynb"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Notebook export failed: {e}")

    nb_bytes = Path(nb_path).read_bytes()
    return Response(
        content=nb_bytes,
        media_type="application/x-ipynb+json",
        headers={
            "Content-Disposition": f'attachment; filename="notes_{video_id}.ipynb"'
        },
    )

# ---------------------------------------------------------------------------
# PRIMARY LANDING & PIPELINE ENDPOINTS
# ---------------------------------------------------------------------------

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def landing_page(request: Request):
    """Renders the primary landing page."""
    entries = get_library_entries()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "request": request,
            "library_entries": entries,
            "app_mode": APP_MODE
        }
    )

@app.post("/api/pipeline/inspect")
async def hitl_inspect(req: InspectRequest, request: Request):
    """Phase 1 & 2: Ingests video and halts at Phase 3 Human-in-the-Loop review."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    # Use authenticated user vault defaults if available
    current_user = await get_optional_current_user(request)
    api_key = req.api_key
    model_name = req.model_name
    if current_user:
        vault = get_user_settings_decrypted(current_user["id"])
        if not api_key:
            api_key = vault.get("groq_api_key") or vault.get("gemini_api_key")
        if not model_name:
            model_name = vault.get("default_model")

    try:
        data = await inspect_video_for_hitl(
            youtube_url=req.youtube_url,
            api_key=api_key,
            model_name=model_name
        )
        chaps = data.get("chapters", [])
        data["suggested_chapters"] = chaps
        meta = data.get("metadata", {})
        data["title"] = meta.get("title", f"Notes for {data.get('video_id')}")
        data["channel"] = meta.get("channel", "YouTube")
        data["duration"] = meta.get("duration_str", "00:00")
        data["thumbnail"] = meta.get("thumbnail", f"https://img.youtube.com/vi/{data.get('video_id')}/hqdefault.jpg")
        data["url"] = req.youtube_url
        # Surface ingestion degradation (e.g. YouTube blocked the transcript
        # request from this host) so the UI can inform the user clearly.
        data["warning"] = data.get("warning")
        data["syllabus_source"] = data.get("syllabus_source")
        data["transcript_chars"] = data.get("transcript_chars", 0)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pipeline/synthesize")
async def hitl_synthesize(req: SynthesizeRequest, request: Request):
    """Phase 4-8: Synthesizes rich notes based on the human-approved syllabus."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    current_user = await get_optional_current_user(request)
    api_key = req.api_key
    model_name = req.model_name
    eraser_api_key = req.eraser_api_key
    color_palette = req.color_palette

    if current_user:
        vault = get_user_settings_decrypted(current_user["id"])
        if not api_key:
            api_key = vault.get("groq_api_key") or vault.get("gemini_api_key")
        if not model_name:
            model_name = vault.get("default_model")
        if not eraser_api_key:
            eraser_api_key = vault.get("eraser_api_key")
        if color_palette == "dark_academic" and vault.get("preferred_theme"):
            color_palette = vault.get("preferred_theme")

    try:
        res = await run_master_notes_pipeline(
            youtube_url=req.youtube_url,
            api_key=api_key,
            model_name=model_name,
            eraser_api_key=eraser_api_key,
            color_palette=color_palette,
            visual_preference=req.visual_preference,
            output_format=req.output_format,
            approved_chapters=req.approved_chapters
        )
        video_id = res["video_id"]
        meta = res.get("video_metadata", {})
        title = meta.get("title", f"Notes for {video_id}")
        channel = meta.get("channel", "YouTube")
        duration = meta.get("duration_str", "00:00")
        chapters_count = len(res.get("chapter_contents", []))
        html_content = res.get("compiled_html", "")

        # If html_content not in memory, read from generated file
        if not html_content and res.get("output_html_path"):
            with open(res["output_html_path"], "r", encoding="utf-8") as f:
                html_content = f.read()

        workspace_url = f"/output/notes_{video_id}.html"
        workspace_id = None

        # Private user workspace isolation
        if current_user and html_content:
            ws_meta = save_user_workspace(
                user_id=current_user["id"],
                youtube_url=req.youtube_url,
                video_id=video_id,
                video_title=title,
                channel_name=channel,
                duration=duration,
                chapter_count=chapters_count,
                html_content=html_content
            )
            workspace_url = ws_meta["workspace_url"]
            workspace_id = ws_meta["workspace_id"]

        return {
            "status": "success",
            "video_id": video_id,
            "workspace_id": workspace_id,
            "title": title,
            "channel": channel,
            "duration": duration,
            "chapters_count": chapters_count,
            "workspace_url": workspace_url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_notes(req: GenerateRequest, request: Request):
    """Executes the master pipeline directly (auto-approved fallback)."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    current_user = await get_optional_current_user(request)
    api_key = req.api_key
    model_name = req.model_name
    eraser_api_key = req.eraser_api_key
    color_palette = req.color_palette

    if current_user:
        vault = get_user_settings_decrypted(current_user["id"])
        if not api_key:
            api_key = vault.get("groq_api_key") or vault.get("gemini_api_key")
        if not model_name:
            model_name = vault.get("default_model")
        if not eraser_api_key:
            eraser_api_key = vault.get("eraser_api_key")
        if color_palette == "dark_academic" and vault.get("preferred_theme"):
            color_palette = vault.get("preferred_theme")

    try:
        res = await run_master_notes_pipeline(
            youtube_url=req.youtube_url,
            api_key=api_key,
            model_name=model_name,
            eraser_api_key=eraser_api_key,
            color_palette=color_palette,
            visual_preference=req.visual_preference,
            output_format=req.output_format
        )
        video_id = res["video_id"]
        meta = res.get("video_metadata", {})
        title = meta.get("title", f"Notes for {video_id}")
        channel = meta.get("channel", "YouTube")
        duration = meta.get("duration_str", "00:00")
        chapters_count = len(res.get("chapter_contents", []))
        html_content = res.get("compiled_html", "")

        if not html_content and res.get("output_html_path"):
            with open(res["output_html_path"], "r", encoding="utf-8") as f:
                html_content = f.read()

        workspace_url = f"/output/notes_{video_id}.html"
        workspace_id = None

        if current_user and html_content:
            ws_meta = save_user_workspace(
                user_id=current_user["id"],
                youtube_url=req.youtube_url,
                video_id=video_id,
                video_title=title,
                channel_name=channel,
                duration=duration,
                chapter_count=chapters_count,
                html_content=html_content
            )
            workspace_url = ws_meta["workspace_url"]
            workspace_id = ws_meta["workspace_id"]

        return {
            "status": "success",
            "video_id": video_id,
            "workspace_id": workspace_id,
            "title": title,
            "channel": channel,
            "duration": duration,
            "chapters_count": chapters_count,
            "workspace_url": workspace_url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_notes(req: ChatRequest):
    """Streams token-by-token RAG answer for the docked bottom-right pane."""
    if not req.question:
        raise HTTPException(status_code=400, detail="Missing question.")

    video_id = (req.video_id or "").strip()
    if not video_id:
        from config import OUTPUT_DIR
        notes_files = list(OUTPUT_DIR.glob("notes_*.html"))
        if notes_files:
            video_id = notes_files[0].stem.replace("notes_", "")
        else:
            video_id = "general"

    async def event_generator():
        async for chunk in ask_rag_stream(
            video_id=req.video_id,
            question=req.question,
            mode=req.mode or "grounded",
            api_key=req.api_key,
            model_name=req.model_name
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/plain")

@app.api_route("/handbook", methods=["GET", "HEAD"], response_class=HTMLResponse)
@app.api_route("/agentic_ai_interactive_handbook.html", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def serve_interactive_handbook():
    """Serves the Agentic AI & LangGraph Engineering Handbook."""
    handbook_path = static_dir / "agentic_ai_interactive_handbook.html"
    if not handbook_path.exists():
        handbook_path = Path(r"C:\Users\anike\Desktop\Agentic-AI\Agentic_AI_and_LangGraph_Engineering_Handbook.html")
    if not handbook_path.exists():
        raise HTTPException(status_code=404, detail="Handbook HTML file not found.")
    with open(handbook_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/api/handbook/questions")
async def handbook_suggestive_questions():
    """Returns preloaded questions that operate directly on the handbook HTML."""
    return {"questions": get_suggestive_questions()}

@app.post("/api/handbook/chat")
async def handbook_interactive_chat(req: HandbookChatRequest):
    """Streams HTML RAG + Real-Time Web Fallback answer with superior prompt engineering."""
    if not req.question:
        raise HTTPException(status_code=400, detail="Missing question.")

    async def event_generator():
        async for chunk in stream_handbook_chat_response(
            question=req.question,
            api_key=req.api_key,
            model_name=req.model_name
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/plain")

@app.get("/api/workspace/{video_id}/topics")
async def get_workspace_search_topics(video_id: str):
    """Returns indexed chapters, sections, and topics for the AI-suggestive search bar."""
    from phase8_chatbot import get_in_memory_html_chunks
    docs = get_in_memory_html_chunks(video_id)
    topics = []
    seen = set()
    for d in docs:
        sec = d.metadata.get("section_title")
        ch = d.metadata.get("chapter_title")
        ts = d.metadata.get("timestamp_str", "00:00")
        sec_id = d.metadata.get("section_id", "")
        sec_sec = d.metadata.get("timestamp_seconds", 0)
        if sec and sec not in seen:
            seen.add(sec)
            topics.append({
                "title": sec,
                "chapter": ch,
                "timestamp_str": ts,
                "timestamp_sec": sec_sec,
                "section_id": sec_id,
                "type": "section"
            })
    return {"topics": topics}

@app.get("/api/workspace/{video_id}/questions")
async def get_workspace_questions(video_id: str):
    """Returns preloaded suggestive questions extracted from the HTML notes."""
    from phase8_chatbot import get_workspace_suggestive_questions
    questions = get_workspace_suggestive_questions(video_id)
    return {"questions": questions}

@app.delete("/api/library/{video_id}")
async def delete_handbook(video_id: str):
    """Removes handbook from library catalog and deletes its file."""
    success = remove_library_entry(video_id)
    if not success:
        raise HTTPException(status_code=404, detail="Handbook not found.")
    return {"status": "deleted", "video_id": video_id}

@app.get("/health")
async def health_check():
    """Health endpoint for monitoring and uptime probes."""
    allowed, status_msg = check_capacity_limits()
    client = get_supabase_client()
    db_connected = False
    if client:
        try:
            client.table("users").select("count", count="exact").limit(1).execute()
            db_connected = True
        except Exception:
            db_connected = False

    key_env = os.getenv("GROQ_API_KEY", "")
    from config import DEFAULT_GROQ_KEY
    return {
        "status": "healthy",
        "app": "4 U By U",
        "mode": APP_MODE,
        "database_connected": db_connected,
        "capacity_status": status_msg,
        "has_env_key": bool(key_env),
        "env_key_prefix": key_env[:10] if key_env else "",
        "default_key_prefix": DEFAULT_GROQ_KEY[:10] if DEFAULT_GROQ_KEY else ""
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("app:app", host=host, port=port, reload=False)

