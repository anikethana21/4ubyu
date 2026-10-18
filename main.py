"""
4 U By U — Master End-to-End Orchestrator
Executes all 8 phases sequentially and in parallel batches.
Supports true Human-in-the-Loop (Phase 3) inspection and approved synthesis.
Handbook Pattern: Multi-Agent Orchestrator Pipeline
"""

import asyncio
import os
from typing import Dict, Any, Optional, List
from states import MasterNotesState
from phase1_ingestion import build_phase1_graph
from phase2_parallel import build_phase2_graph
from phase3_hitl import hitl_review_node
from phase4_structure import structure_synthesis_node
from phase5_chapter_agents import run_all_chapters_batched
from phase6_compilation import compile_and_compare_node
from phase7_renderer import html_tri_pane_workspace_renderer
from phase8_chatbot import build_rag_index_node
from core.library_manager import check_capacity_limits

async def inspect_video_for_hitl(
    youtube_url: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """Runs Phase 1 & 2 to extract metadata and chapters for Human-in-the-Loop review."""
    initial_state: MasterNotesState = {
        "youtube_url": youtube_url,
        "output_format": "html",
        "color_palette": "dark_academic",
        "api_key": api_key,
        "model_name": model_name,
        "eraser_api_key": None,
        "human_sources": [],
        "visual_preference": "auto",
        "video_id": "",
        "video_metadata": {},
        "video_description": "",
        "yt_chapters": [],
        "full_transcript": "",
        "timed_transcript": [],
        "translation_info": {},
        "audio_path": None,
        "description_resources": {},
        "labeled_transcript": [],
        "online_search_results": {},
        "topic_outline": [],
        "missing_topics": [],
        "hitl_approved": False,
        "human_topic_decision": {},
        "notes_structure": {},
        "chapter_contents": [],
        "compiled_html": "",
        "output_html_path": "",
        "output_pdf_path": None,
        "vector_db_path": "",
        "rag_ready": False
    }

    print("[4 U By U HITL] Phase 1: Ingesting video metadata and timestamps...")
    phase1_app = build_phase1_graph()
    state = await phase1_app.ainvoke(initial_state)

    try:
        print("[4 U By U HITL] Phase 2: Detecting syllabus coverage & potential topic gaps...")
        phase2_app = build_phase2_graph()
        state = await phase2_app.ainvoke(state)
    except Exception as e:
        print(f"[4 U By U HITL] Phase 2 warning: {e}")

    transcript = state.get("full_transcript", "") or ""
    syllabus_source = state.get("syllabus_source", "unknown")
    warning = None
    if not transcript.strip():
        from core.youtube_fetch import ingestion_hint

        warning = (
            "No transcript could be retrieved from YouTube: this host's IP is "
            "gated by YouTube's bot check (datacenter hosts such as Render and "
            "Vercel are affected alike). Chapters can only come from the video "
            "description. " + ingestion_hint()
        )

    try:
        from core.youtube_fetch import probe

        ingestion_debug = probe(state.get("video_id") or "")
    except Exception as e:
        ingestion_debug = {"error": str(e)}

    return {
        "status": "hitl_required",
        "video_id": state.get("video_id"),
        "metadata": state.get("video_metadata", {}),
        "chapters": state.get("yt_chapters", []),
        "missing_topics": state.get("missing_topics", []),
        "syllabus_source": syllabus_source,
        "transcript_chars": len(transcript),
        "translation": state.get("translation_info", {}) or {},
        "warning": warning,
        "ingestion_debug": ingestion_debug,
    }

async def run_master_notes_pipeline(
    youtube_url: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    eraser_api_key: Optional[str] = None,
    color_palette: str = "dark_academic",
    visual_preference: str = "auto",
    output_format: str = "html",
    approved_chapters: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Executes all phases end-to-end for a given YouTube tutorial.
    If approved_chapters is provided, enforces the human-reviewed syllabus.
    """
    # 0. Check Capacity Limits
    allowed, msg = check_capacity_limits()
    if not allowed:
        raise RuntimeError(msg)

    initial_state: MasterNotesState = {
        "youtube_url": youtube_url,
        "output_format": output_format,
        "color_palette": color_palette,
        "api_key": api_key,
        "model_name": model_name,
        "eraser_api_key": eraser_api_key,
        "human_sources": [],
        "visual_preference": visual_preference,
        "video_id": "",
        "video_metadata": {},
        "video_description": "",
        "yt_chapters": approved_chapters or [],
        "full_transcript": "",
        "timed_transcript": [],
        "translation_info": {},
        "audio_path": None,
        "description_resources": {},
        "labeled_transcript": [],
        "online_search_results": {},
        "topic_outline": [],
        "missing_topics": [],
        "hitl_approved": bool(approved_chapters),
        "human_topic_decision": {},
        "notes_structure": {},
        "chapter_contents": [],
        "compiled_html": "",
        "output_html_path": "",
        "output_pdf_path": None,
        "vector_db_path": "",
        "rag_ready": False
    }

    # PHASE 1: Ingestion (Sequential)
    print("[4 U By U] Phase 1: Ingesting metadata and subtitles...")
    phase1_app = build_phase1_graph()
    state = await phase1_app.ainvoke(initial_state)

    # If human provided approved chapters, override/enforce them
    if approved_chapters:
        state["yt_chapters"] = approved_chapters
        state["raw_chapters"] = approved_chapters
        state["hitl_approved"] = True

    # PHASE 2: Parallel Fan-Out (Desc + Labels + Search with clustering)
    print("[4 U By U] Phase 2: Running parallel branches with semantic clustering...")
    try:
        phase2_app = build_phase2_graph()
        state = await phase2_app.ainvoke(state)
    except Exception as e:
        print(f"[4 U By U] Phase 2 notice: {e}")

    # PHASE 3: HITL Topic Review Checkpoint
    if not state.get("hitl_approved"):
        print("[4 U By U] Phase 3: HITL auto-checkpoint evaluation...")
        hitl_res = hitl_review_node(state)
        state.update(hitl_res)
    else:
        print(f"[4 U By U] Phase 3: Enforcing {len(state.get('yt_chapters', []))} human-approved syllabus topics.")

    # PHASE 4: Master Outline Synthesis
    print("[4 U By U] Phase 4: Synthesizing master course outline with section structuring...")
    struct_res = structure_synthesis_node(state)
    state.update(struct_res)

    # PHASE 4.5: Grounded Code Procurement & Temporal Settlement Agent
    print("[4 U By U] Phase 4.5: Grounding code from repository & calculating section settlement...")
    code_files = {}
    try:
        from core.code_settlement_agent import extract_github_repos, fetch_github_code_files, settle_procured_code
        repos = extract_github_repos(state.get("video_description", ""))
        if repos:
            repo_url = repos[0]
            print(f"[4 U By U] Procuring ground-truth code from {repo_url}...")
            local_fallback = os.environ.get("CODE_REPO_MIRROR") or None
            code_files = fetch_github_code_files(repo_url, local_fallback_dir=local_fallback)
            if code_files and "notes_structure" in state and "chapters" in state["notes_structure"]:
                state["notes_structure"]["chapters"] = settle_procured_code(
                    state["notes_structure"]["chapters"],
                    code_files,
                    state.get("timed_transcript", [])
                )
                print(f"[4 U By U] Successfully settled ground-truth repository code across {len(state['notes_structure']['chapters'])} chapters.")
    except Exception as e:
        print(f"[4 U By U] Code Settlement Agent notice: {e}")
    state["github_files"] = code_files

    # PHASE 5: Batched Chapter Agents + Visual Architect
    total_chaps = len(state.get("notes_structure", {}).get("chapters", []))
    print(f"[4 U By U] Phase 5: Generating {total_chaps} chapters with specialist sub-agents...")
    chapters_content = await run_all_chapters_batched(state["notes_structure"], state)
    state["chapter_contents"] = chapters_content

    # PHASE 6: Compilation + Comparator
    print("[4 U By U] Phase 6: Compiling chapters and verifying chronological integrity...")
    comp_res = compile_and_compare_node(state)
    state.update(comp_res)

    # PHASE 7: Tri-Pane HTML Renderer
    print("[4 U By U] Phase 7: Rendering interactive tri-pane workspace...")
    render_res = html_tri_pane_workspace_renderer(state)
    state.update(render_res)

    # PHASE 7.5: Jupyter Notebook Export (best-effort, non-fatal)
    if str(state.get("output_format", "")).lower() == "ipynb" or os.environ.get("EXPORT_NOTEBOOK", "1").lower() == "1":
        print("[4 U By U] Phase 7.5: Exporting Jupyter notebook (.ipynb)...")
        try:
            from core.notebook_exporter import export_state_to_notebook
            nb_path = export_state_to_notebook(state)
            if nb_path:
                state["output_notebook_path"] = nb_path
        except Exception as e:
            print(f"[4 U By U] Phase 7.5 notebook export notice: {e}")

    # PHASE 8: RAG Indexing
    print("[4 U By U] Phase 8: Building local ChromaDB vector index...")
    try:
        rag_res = build_rag_index_node(state)
        state.update(rag_res)
    except Exception as e:
        print(f"[4 U By U] Phase 8 notice: {e}")

    print(f"[4 U By U] Pipeline complete! Output saved to: {state['output_html_path']}")
    if state.get("output_notebook_path"):
        print(f"[4 U By U] Notebook exported to: {state['output_notebook_path']}")
    return state
