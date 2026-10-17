"""
4 U By U — PHASE 7: Interactive Tri-Pane Workspace Renderer
Converts structured ChapterContent JSON into a modern 3-segment responsive workspace:
1. Left Pane: Full-height educational handbook instrument with auto-seeking timestamps
2. Top-Right Pane: Resizable YouTube video player window with IFrame API sync
3. Bottom-Right Pane: Docked contextual RAG study assistant chatbot
Handbook Pattern: Deterministic Zero-Inference Renderer
"""

import json
from pathlib import Path
from typing import Dict, Any, List
from jinja2 import Environment, FileSystemLoader
from states import MasterNotesState, ChapterContent
from config import OUTPUT_DIR, BASE_DIR
from core.library_manager import add_library_entry

def html_tri_pane_workspace_renderer(state: MasterNotesState) -> Dict[str, Any]:
    """Renders compiled chapters into the Tri-Pane HTML workspace."""
    video_id = state["video_id"]
    meta = state.get("video_metadata", {})
    chapters: List[ChapterContent] = state.get("chapter_contents", [])
    color_palette = state.get("color_palette", "dark_academic")
    
    # Deduplicate leading chapter numbers for clean Table of Contents
    import re
    for ch in chapters:
        c_title = ch.get("title") or ch.get("chapter_title", "")
        clean_title = re.sub(r"^\s*\d+[\.\:\-\)\s]+", "", c_title).strip()
        if isinstance(ch, dict):
            ch["chapter_clean_title"] = clean_title or c_title
        else:
            setattr(ch, "chapter_clean_title", clean_title or c_title)

    # Pre-render structured Theory Markdown & LaTeX Equations
    from core.theory_formatter import format_theory_content
    for ch in chapters:
        sections = ch.get('sections', []) if isinstance(ch, dict) else getattr(ch, 'sections', [])
        for sec in sections:
            tb = sec.get('theory_block') if isinstance(sec, dict) else getattr(sec, 'theory_block', None)
            if tb:
                if isinstance(tb, dict) and 'explanation' in tb:
                    tb['explanation_html'] = format_theory_content(tb['explanation'])
                elif hasattr(tb, 'explanation'):
                    setattr(tb, 'explanation_html', format_theory_content(tb.explanation))

    # Load Jinja2 templates
    templates_dir = BASE_DIR / "templates"
    env = Environment(loader=FileSystemLoader(str(templates_dir)))
    template = env.get_template("base_workspace.html")
    
    rendered_html = template.render(
        video_id=video_id,
        video_metadata=meta,
        chapters=chapters,
        color_palette=color_palette,
        total_chapters=len(chapters),
        suggestive_questions=state.get("suggestive_questions", [])
    )
    
    file_name = f"notes_{video_id}.html"
    out_file = OUTPUT_DIR / file_name
    
    try:
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(rendered_html)
    except (OSError, PermissionError):
        import tempfile
        tmp_dir = Path(tempfile.gettempdir()) / "4ubyu" / "output"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        out_file = tmp_dir / file_name
        try:
            with open(out_file, "w", encoding="utf-8") as f:
                f.write(rendered_html)
        except Exception:
            pass
        
    # Register in Local Library
    library_entry = {
        "id": video_id,
        "title": meta.get("title", f"Notes for {video_id}"),
        "channel": meta.get("channel", "YouTube"),
        "duration": meta.get("duration_str", "00:00"),
        "thumbnail": meta.get("thumbnail", f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"),
        "chapters_count": len(chapters),
        "file_name": file_name,
        "color_palette": color_palette,
        "size_mb": round(len(rendered_html.encode('utf-8')) / (1024 * 1024), 2)
    }
    add_library_entry(library_entry)
    
    return {
        "compiled_html": rendered_html,
        "output_html_path": str(out_file)
    }
