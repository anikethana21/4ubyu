"""
4 U By U — Master End-to-End Orchestrator
Executes all 8 phases sequentially and in parallel batches.
Handbook Pattern: Multi-Agent Orchestrator Pipeline
"""

import asyncio
from typing import Dict, Any, Optional
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

async def run_master_notes_pipeline(
    youtube_url: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    eraser_api_key: Optional[str] = None,
    color_palette: str = "dark_academic",
    visual_preference: str = "auto",
    output_format: str = "html"
) -> Dict[str, Any]:
    """
    Executes all phases end-to-end for a given YouTube tutorial.
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
        "yt_chapters": [],
        "full_transcript": "",
        "timed_transcript": [],
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

    # PHASE 1: Ingestion (Sequential)
    print("[4 U By U] Phase 1: Ingesting metadata and subtitles...")
    phase1_app = build_phase1_graph()
    state = await phase1_app.ainvoke(initial_state)

    # PHASE 2: Parallel Fan-Out (Desc + Labels + Search with clustering)
    print("[4 U By U] Phase 2: Running parallel branches with semantic clustering...")
    phase2_app = build_phase2_graph()
    state = await phase2_app.ainvoke(state)

    # PHASE 3: HITL Topic Review Checkpoint
    print("[4 U By U] Phase 3: HITL verification checkpoint...")
    hitl_res = hitl_review_node(state)
    state.update(hitl_res)

    # PHASE 4: Master Outline Synthesis
    print("[4 U By U] Phase 4: Synthesizing master course outline with LLM section structuring...")
    struct_res = structure_synthesis_node(state)
    state.update(struct_res)

    # PHASE 4.5: Grounded Code Procurement & Temporal Settlement Agent
    print("[4 U By U] Phase 4.5: Grounding code from repository & calculating section settlement...")
    try:
        from core.code_settlement_agent import extract_github_repos, fetch_github_code_files, settle_procured_code
        repos = extract_github_repos(state.get("video_description", ""))
        if repos:
            repo_url = repos[0]
            print(f"[4 U By U] Procuring ground-truth code from {repo_url}...")
            code_files = fetch_github_code_files(repo_url, local_fallback_dir=r"C:\Users\anike\Desktop\Agentic-AI\langgraph\Agentic-AI-youtube")
            if code_files and "notes_structure" in state and "chapters" in state["notes_structure"]:
                state["notes_structure"]["chapters"] = settle_procured_code(
                    state["notes_structure"]["chapters"],
                    code_files,
                    state.get("timed_transcript", [])
                )
                print(f"[4 U By U] Successfully settled ground-truth repository code across {len(state['notes_structure']['chapters'])} chapters.")
    except Exception as e:
        print(f"[4 U By U] Code Settlement Agent notice: {e}")

    # PHASE 5: Batched Chapter Agents + Visual Architect
    print(f"[4 U By U] Phase 5: Generating {len(state['notes_structure']['chapters'])} chapters with 6 specialist sub-agents...")
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

    # PHASE 8: RAG Indexing
    print("[4 U By U] Phase 8: Building local ChromaDB vector index...")
    rag_res = build_rag_index_node(state)
    state.update(rag_res)

    print(f"[4 U By U] Pipeline complete! Output saved to: {state['output_html_path']}")
    return state
