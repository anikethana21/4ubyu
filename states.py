"""
4 U By U — Unified Graph State & Lossless Reducers
Contains state schemas for LangGraph orchestrators and sub-agents.
Non-destructive merge reducers ensure zero state loss during fan-out and fan-in.
"""

from typing import TypedDict, Annotated, Optional, List, Dict, Any
from langgraph.graph.message import add_messages


# ═══════════════════════════════════════════════════════════════════
# REDUCERS: Lossless State Accumulation Functions
# ═══════════════════════════════════════════════════════════════════

def merge_dict_reducer(existing: Optional[dict], new_dict: Optional[dict]) -> dict:
    """Safely merges dictionary keys without mutating prior state."""
    merged = dict(existing or {})
    if new_dict:
        merged.update(new_dict)
    return merged

def merge_section_contents(existing: Optional[dict], new_data: Optional[dict]) -> dict:
    """Merges sub-agent outputs into a unified SectionContent dictionary."""
    base = dict(existing or {})
    if new_data:
        base.update(new_data)
    return base

def merge_chapters(existing: Optional[list], new_items: Optional[list]) -> list:
    """Combines chapter content blocks preserving order."""
    res = list(existing or [])
    if new_items:
        res.extend(new_items)
    return res

def merge_list_reducer(existing: Optional[list], new_items: Optional[list]) -> list:
    """Safely appends items to a list without mutating or failing on None."""
    res = list(existing or [])
    if new_items:
        res.extend(new_items)
    return res


# ═══════════════════════════════════════════════════════════════════
# SECTION & CHAPTER DATA STRUCTURES (Lossless Intermediate Representation)
# ═══════════════════════════════════════════════════════════════════

class SectionContent(TypedDict):
    section_id: str             # e.g., "ch01_s02"
    section_title: str          # e.g., "add_messages Reducer"
    section_order: int          # Order index within chapter
    chapter_id: str             # e.g., "ch_01"
    time_reference: str         # Timestamp string e.g., "04:23"
    timestamp_seconds: int      # Exact integer seconds for YouTube seeking

    # Sub-agent outputs
    theory_block: dict          # Explanation, analogies, core insights
    visual_diagram: Optional[dict]   # Primary diagram (backwards compatibility)
    visual_diagrams: list[dict]      # List of 0 to 3 diagrams/schematics/keyframes
    code_blocks: list[dict]     # Syntax-highlighted code blocks
    key_points: list[str]       # Explicitly stated factual takeaways
    examples: list[dict]        # Real-world examples & analogies
    supplement_block: Optional[dict] # External docs/gaps filled if video was incomplete

    is_complete: bool
    external_label: Optional[str]

class ChapterContent(TypedDict):
    chapter_id: str
    chapter_title: str
    chapter_order: int
    timestamp_str: str
    timestamp_seconds: int
    overview: str
    sections: list[SectionContent]
    chapter_summary: str
    has_external: bool

# ═══════════════════════════════════════════════════════════════════
# SUBGRAPH STATES (Per-Section & Per-Chapter Execution)
# ═══════════════════════════════════════════════════════════════════

class SectionState(TypedDict):
    section_id: str
    section_title: str
    section_order: int
    chapter_id: str
    video_id: str
    time_reference: str
    timestamp_seconds: int
    transcript_slice: str
    chapter_structure: dict
    visual_preference: str      # "auto" | "force" | "disabled"
    color_palette: str          # "dark_academic" | "light_minimal" | "vibrant"
    api_key: Optional[str]
    model_name: Optional[str]
    eraser_api_key: Optional[str]
    previous_diagrams: list[dict] # Historical list of diagrams in this chapter

    # Parallel Sub-agent write slots
    theory_block: Annotated[dict, merge_section_contents]
    visual_diagram: Annotated[dict, merge_section_contents]
    visual_diagrams: Annotated[list, merge_list_reducer]
    code_blocks: Annotated[list, merge_list_reducer]
    key_points: Annotated[list, merge_list_reducer]
    examples: Annotated[list, merge_list_reducer]
    supplement_block: Annotated[dict, merge_section_contents]

    # Evaluated flags
    theory_coverage: str        # "complete" | "partial" | "missing"
    needs_code: bool
    github_available: bool
    importance: str             # "core" | "critical" | "supplementary"
    section_content: Optional[SectionContent]

class ChapterState(TypedDict):
    chapter_id: str
    chapter_title: str
    chapter_order: int
    video_id: str
    timestamp_str: str
    timestamp_seconds: int
    color_palette: str
    chapter_structure: dict
    sections: Annotated[list, merge_list_reducer]
    overview: str
    chapter_summary: str
    has_external: bool
    chapter_content: Optional[ChapterContent]

# ═══════════════════════════════════════════════════════════════════
# MASTER GRAPH STATE (End-to-End Orchestrator)
# ═══════════════════════════════════════════════════════════════════

class MasterNotesState(TypedDict):
    # Phase 0: User & Environment Inputs
    youtube_url: str
    output_format: str          # "html" | "pdf"
    color_palette: str          # "dark_academic" | "light_minimal" | "vibrant"
    api_key: Optional[str]
    model_name: Optional[str]
    eraser_api_key: Optional[str]
    human_sources: list[str]
    visual_preference: str      # "auto" | "force" | "disabled"

    # Phase 1: Ingestion
    video_id: str
    video_metadata: dict        # title, channel, duration, upload_date, etc.
    video_description: str
    yt_chapters: list[dict]
    full_transcript: str
    timed_transcript: list[dict] # [{start: float, duration: float, text: str}]
    audio_path: Optional[str]

    # Phase 2: Parallel Fan-Out (Merge reducers ensure zero overwrite)
    description_resources: Annotated[dict, merge_dict_reducer]
    labeled_transcript: Annotated[list, merge_list_reducer]
    online_search_results: Annotated[dict, merge_dict_reducer]
    topic_outline: Annotated[list, merge_list_reducer]
    missing_topics: Annotated[list, merge_list_reducer]

    # Phase 3: HITL Review
    hitl_approved: bool
    human_topic_decision: dict  # {include: [...], skip: [...]}

    # Phase 4: Master Outline
    notes_structure: dict       # Hierarchical TOC & chapter specifications

    # Phase 5: Batched Chapter Generation
    chapter_contents: Annotated[list, merge_chapters]

    # Phase 6 & 7: Compilation & Rendering
    compiled_html: str
    output_html_path: str
    output_pdf_path: Optional[str]

    # Phase 8: RAG Chatbot
    vector_db_path: str
    rag_ready: bool
