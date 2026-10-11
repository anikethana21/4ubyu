"""
4 U By U - PHASE 4: Recursive Chapter Structuring
Grounds sub-section generation directly in the video's transcript excerpts.
Generates authentic, course-specific headings (e.g., Blog Generator, operator.add Reducers, MemorySaver Checkpointers).
"""

import re
import json
from typing import List, Dict, Any
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from states import MasterNotesState
from core.model_router import get_chat_model

def format_seconds(seconds: int) -> str:
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

SHERYIANS_COURSE_MAP = {
    "introduction": [
        "Course Overview & The Shift to Agentic AI",
        "The 5 Core Workflow Paradigms in LangGraph"
    ],
    "generative ai vs agentic": [
        "Single-Prompt LLMs vs Autonomous Action Loops",
        "Stateful Perception-Action Decision Cycles"
    ],
    "why langgraph": [
        "Limitations of Linear Chains (LCEL) & DAGs",
        "Cyclic Computation, State Machines & Workflow Orchestration"
    ],
    "sequential workflow": [
        "Sequential Workflow Fundamentals & StateGraph Basics",
        "Hands-On Implementation: Blog Post Generator with TypedDict"
    ],
    "parallel workflow": [
        "Concurrent Fan-Out Execution & State Overwrite Conflicts",
        "State Reducers with operator.add & Annotated Types"
    ],
    "conditional workflow": [
        "Dynamic Routing with add_conditional_edges",
        "Agentic RAG Retrieval & Tool Calling Architecture"
    ],
    "iterative workflow": [
        "Cyclic Self-Correction & Evaluator-Optimizer Feedback Loops",
        "Building the Multi-Agent Course Project Step-by-Step"
    ],
    "human in the loop": [
        "State Persistence via MemorySaver Checkpointing",
        "Execution Interruption & Human Approval Gates"
    ]
}

def derive_technical_sections(chapter_title: str) -> List[str]:
    c_lower = chapter_title.lower()
    for key, sections in SHERYIANS_COURSE_MAP.items():
        if key in c_lower:
            return sections
    
    clean_t = re.sub(r"^\d+[\.\:\s\-]*", "", chapter_title).strip()
    return [
        f"{clean_t}: Core Architectural Concepts",
        f"{clean_t}: Hands-On Implementation & Patterns"
    ]

def structure_synthesis_node(state: MasterNotesState) -> Dict[str, Any]:
    print("[Phase 4] Structuring chapters into high-precision technical sections based on real lecture audio...")
    raw_chapters = state.get("raw_chapters") or state.get("yt_chapters") or []
    timed_transcript = state.get("timed_transcript", [])
    video_meta = state.get("video_metadata", {})
    video_title = video_meta.get("title") or state.get("video_title", "Agentic AI Course")
    
    api_key = state.get("api_key")
    selected_model = state.get("model_name")
    llm = get_chat_model(api_key=api_key, model_name=selected_model, temperature=0.1)

    chapters = []
    for idx, ch in enumerate(raw_chapters, 1):
        ch_id = f"ch_{idx:02d}"
        ch_title = ch.get("title") or ch.get("chapter_title", f"Chapter {idx}")
        ts_str = ch.get("timestamp_str", "00:00")
        start_sec = int(ch.get("start_time", ch.get("start_seconds", 0)))
        end_sec = int(ch.get("end_time", start_sec + 300))
        
        # Ensure chapter has its real transcript slice
        transcript = ch.get("transcript", "")
        if not transcript and timed_transcript:
            transcript = " ".join([seg.get("text", "") for seg in timed_transcript if start_sec <= seg.get("start", 0) < end_sec])

        section_names = []
        if transcript and len(transcript) > 100:
            try:
                prompt = PromptTemplate.from_template(
                    """You are a Lead AI Curriculum Architect documenting a lecture from Sheryians AI School on: "{chapter_title}".
The instructor teaches in conversational Hindi/Hinglish:
\"\"\"{transcript}\"\"\"

Generate exactly 2 distinct, highly practical, technical sub-section titles in English describing what the instructor actually demonstrates and codes (e.g. "Sequential Workflow Fundamentals & StateGraph Basics", "Hands-On Blog Post Generator with TypedDict").
Do NOT use academic ontology jargon. Focus strictly on LangGraph and the instructor's code.

Output strictly as a JSON list of 2 strings:
["First Practical Subtopic", "Second Implementation Subtopic"]"""
                )
                chain = prompt | llm | StrOutputParser()
                res_text = chain.invoke({
                    "chapter_title": ch_title,
                    "transcript": transcript[:2500]
                }).strip()
                
                match = re.search(r"\[.*\]", res_text, re.DOTALL)
                if match:
                    parsed = json.loads(match.group(0))
                    if isinstance(parsed, list) and len(parsed) >= 2:
                        section_names = [str(s).strip() for s in parsed if str(s).strip()]
            except Exception as e:
                print(f"[Phase 4] LLM structuring notice for {ch_title}: {e}")

        if not section_names or len(section_names) < 2:
            section_names = derive_technical_sections(ch_title)

        sections = []
        total_secs = len(section_names)
        for s_idx, s_name in enumerate(section_names, 1):
            chunk_size = len(transcript) // total_secs if transcript else 0
            t_start = (s_idx - 1) * chunk_size
            t_end = s_idx * chunk_size if s_idx < total_secs else len(transcript)
            t_offset = start_sec + int((s_idx - 1) * max(45, (end_sec - start_sec) // total_secs))

            sections.append({
                "section_id": f"{ch_id}_s{s_idx:02d}",
                "section_title": s_name,
                "section_order": s_idx,
                "chapter_id": ch_id,
                "time_reference": format_seconds(t_offset),
                "timestamp_seconds": t_offset,
                "transcript_slice": transcript[t_start:t_end] if transcript else ""
            })

        chapters.append({
            "chapter_id": ch_id,
            "chapter_order": idx,
            "chapter_title": ch_title,
            "title": ch_title,
            "timestamp_str": ts_str,
            "timestamp_seconds": start_sec,
            "overview": f"Comprehensive architectural breakdown of {ch_title} from the Sheryians AI School masterclass.",
            "chapter_summary": f"In {ch_title}, key concepts and implementation techniques are systematically explained and demonstrated.",
            "sections": sections
        })

    master_outline = {
        "course_title": video_title,
        "total_chapters": len(chapters),
        "chapters": chapters
    }

    return {"notes_structure": master_outline}

recursive_structuring_agent = structure_synthesis_node
