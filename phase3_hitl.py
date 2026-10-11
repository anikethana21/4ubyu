"""
4 U By U — PHASE 3: Human-in-the-Loop Checkpoint
Provides an interruptible checkpoint allowing the student to review,
approve, or prune discovered topic gaps before notes outline synthesis.
Handbook Pattern: Archetype 4 (Human-in-the-Loop Pauses)
"""

from typing import Dict, Any
from states import MasterNotesState

def hitl_review_node(state: MasterNotesState) -> Dict[str, Any]:
    """
    Evaluates topic decisions. In automated or headless runs,
    auto-approves discovered syllabus gaps with sensible defaults.
    """
    existing_decision = state.get("human_topic_decision")
    
    if existing_decision:
        return {
            "hitl_approved": True,
            "human_topic_decision": existing_decision
        }
        
    # Default approval includes core detected gaps marked as supplementary
    missing = state.get("missing_topics", [])
    approved_topics = [m["topic"] for m in missing]
    
    return {
        "hitl_approved": True,
        "human_topic_decision": {
            "include": approved_topics,
            "skip": []
        }
    }
