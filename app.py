"""
4 U By U — FastAPI Web Application & Streaming Server
Serves the Landing Page, Study Library Dashboard, Generation API, and SSE Streaming Chat.
"""

from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from config import BASE_DIR, OUTPUT_DIR, APP_MODE
from core.library_manager import get_library_entries, remove_library_entry, check_capacity_limits
from phase8_chatbot import ask_rag_stream
from main import run_master_notes_pipeline, inspect_video_for_hitl
from core.handbook_rag import stream_handbook_chat_response, get_suggestive_questions

app = FastAPI(title="4 U By U — Educational Workspace Generator")

# Mount Static & Output Directories
static_dir = BASE_DIR / "static"
templates_dir = BASE_DIR / "templates"

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")

templates = Jinja2Templates(directory=str(templates_dir))

# ═══════════════════════════════════════════════════════════════════
# REQUEST SCHEMAS
# ═══════════════════════════════════════════════════════════════════

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
    api_key: Optional[str] = None
    model_name: Optional[str] = None

class HandbookChatRequest(BaseModel):
    question: str
    api_key: Optional[str] = None
    model_name: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def landing_page(request: Request):
    """Renders the primary landing page and personal study library."""
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
async def hitl_inspect(req: InspectRequest):
    """Phase 1 & 2: Ingests video and halts at Phase 3 Human-in-the-Loop review."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    try:
        data = await inspect_video_for_hitl(
            youtube_url=req.youtube_url,
            api_key=req.api_key,
            model_name=req.model_name
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pipeline/synthesize")
async def hitl_synthesize(req: SynthesizeRequest):
    """Phase 4-8: Synthesizes rich notes based on the human-approved syllabus."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    try:
        res = await run_master_notes_pipeline(
            youtube_url=req.youtube_url,
            api_key=req.api_key,
            model_name=req.model_name,
            eraser_api_key=req.eraser_api_key,
            color_palette=req.color_palette,
            visual_preference=req.visual_preference,
            output_format=req.output_format,
            approved_chapters=req.approved_chapters
        )
        video_id = res["video_id"]
        meta = res.get("video_metadata", {})
        return {
            "status": "success",
            "video_id": video_id,
            "title": meta.get("title", f"Notes for {video_id}"),
            "channel": meta.get("channel", "YouTube"),
            "duration": meta.get("duration_str", "00:00"),
            "chapters_count": len(res.get("chapter_contents", [])),
            "workspace_url": f"/output/notes_{video_id}.html"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_notes(req: GenerateRequest):
    """Executes the master pipeline directly (auto-approved fallback)."""
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)

    try:
        res = await run_master_notes_pipeline(
            youtube_url=req.youtube_url,
            api_key=req.api_key,
            model_name=req.model_name,
            eraser_api_key=req.eraser_api_key,
            color_palette=req.color_palette,
            visual_preference=req.visual_preference,
            output_format=req.output_format
        )
        video_id = res["video_id"]
        meta = res.get("video_metadata", {})
        return {
            "status": "success",
            "video_id": video_id,
            "title": meta.get("title", f"Notes for {video_id}"),
            "channel": meta.get("channel", "YouTube"),
            "duration": meta.get("duration_str", "00:00"),
            "chapters_count": len(res.get("chapter_contents", [])),
            "workspace_url": f"/output/notes_{video_id}.html"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_notes(req: ChatRequest):
    """Streams token-by-token RAG answer for the docked bottom-right pane."""
    if not req.video_id or not req.question:
        raise HTTPException(status_code=400, detail="Missing video_id or question.")

    async def event_generator():
        async for chunk in ask_rag_stream(req.video_id, req.question, req.api_key, req.model_name):
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
    """Health endpoint for monitoring."""
    allowed, status_msg = check_capacity_limits()
    return {
        "app": "4 U By U",
        "mode": APP_MODE,
        "capacity_status": status_msg
    }

if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("app:app", host=host, port=port, reload=False)
