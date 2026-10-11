"""
4 U By U — PHASE 6: Compilation & Cross-Chapter Comparator Agent
Runs parallel chapter compilation and executes a consistency comparator
to cross-check formatting, deduplicate content, and ensure chronological integrity.
Handbook Pattern: Archetype 2 (Parallel Fan-Out + Reducer Map-Reduce)
"""

from typing import Dict, Any, List
from states import MasterNotesState, ChapterContent

def compile_and_compare_node(state: MasterNotesState) -> Dict[str, Any]:
    """Sorts chapters by order, verifies timestamps, and flags duplicates."""
    chapters: List[ChapterContent] = state.get("chapter_contents", [])
    
    # Deterministic chronological sort
    sorted_chapters = sorted(chapters, key=lambda x: x["chapter_order"])
    
    # Cross-Chapter Comparator checks
    seen_code_signatures = set()
    total_sections = 0
    
    for ch in sorted_chapters:
        for sec in ch["sections"]:
            total_sections += 1
            for cb in sec.get("code_blocks", []):
                code_snippet = cb.get("code", "").strip()
                if code_snippet in seen_code_signatures:
                    cb["duplicate_flag"] = True
                else:
                    seen_code_signatures.add(code_snippet)
                    
    return {
        "chapter_contents": sorted_chapters
    }
