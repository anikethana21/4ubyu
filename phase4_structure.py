"""
4 U By U - PHASE 4: Grounded Chapter Structuring
Grounds section generation strictly in the authentic video domain and real lecture timestamps.
Eliminates synthetic offsets and cross-course topic contamination.
"""

import re
import json
from typing import List, Dict, Any, Optional
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from states import MasterNotesState
from core.model_router import get_chat_model

def format_seconds(seconds: int) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

def detect_course_domain(video_title: str, video_desc: str = "", chapters_text: str = "") -> str:
    """Accurately detects whether the lecture is Machine Learning, Agentic AI, or General Tech."""
    combined = f"{video_title} {video_desc} {chapters_text}".lower()
    
    if any(k in combined for k in ["langgraph", "langchain", "agentic", "multi-agent", "ai agent", "stategraph", "memorysaver"]):
        return "agentic_ai"
    elif any(k in combined for k in ["machine learning", "deep learning", "data science", "scikit-learn", "sklearn", "pandas", "numpy", "classification", "regression", "eda", "sheryians", "pankaj"]):
        return "machine_learning"
    return "general_tech"

ML_TOPIC_SYNTHESIS = {
    "introduction": "Course Welcome, Prerequisites & Machine Learning Foundations",
    "content": "Curriculum Roadmap, Tools & Development Environment Setup",
    "roadmap": "Curriculum Roadmap, Tools & Development Environment Setup",
    "what is machine learning": "Core Philosophy of Machine Learning & Statistical Induction",
    "applications": "Real-World Industrial Applications: Recommenders, Vision & Analytics",
    "traditional programming": "Rule-Based Determinism vs Data-Driven Paradigm Shift",
    "difference b/w ai,ml,dl": "Taxonomic Hierarchy: Artificial Intelligence vs Machine Learning vs Deep Learning",
    "types of machine learning": "Taxonomy of ML: Supervised, Unsupervised & Reinforcement Learning",
    "steps for making a machine learning model": "The Complete Machine Learning Engineering Lifecycle",
    "eda": "Exploratory Data Analysis: Statistical Distributions & Visual Diagnostics",
    "data cleaning": "Data Cleaning: Missing Value Imputation & Outlier Remediation",
    "data preprocessing": "Data Preprocessing: Categorical Feature Encoding & Feature Scaling",
    "feature engineering": "Feature Engineering: Interaction Features & Domain Transformations",
    "feature selection": "Feature Selection: Filter, Wrapper & Embedded Methods",
    "project 1": "End-to-End Supervised ML Pipeline: Ingestion to Validation",
    "project 2": "Advanced Real-World ML Pipeline: Hyperparameter Tuning & Evaluation",
    "outro": "Course Summary, Key Takeaways & Production Best Practices"
}

AGENTIC_TOPIC_SYNTHESIS = {
    "introduction": "Course Overview & The Shift to Agentic AI Architectures",
    "generative ai vs agentic": "Single-Prompt LLMs vs Autonomous Action Loops",
    "why langgraph": "Cyclic Computation, State Machines & Workflow Orchestration",
    "sequential workflow": "Sequential Workflow Fundamentals & StateGraph Basics",
    "parallel workflow": "Concurrent Fan-Out Execution & State Reducer Patterns",
    "conditional workflow": "Dynamic Routing & Tool Calling Architectures",
    "iterative workflow": "Cyclic Self-Correction & Evaluator-Optimizer Feedback Loops",
    "human in the loop": "State Persistence via MemorySaver Checkpointing & Human Review"
}

def derive_grounded_section_title(chapter_title: str, domain: str, video_title: str) -> str:
    """Derives a rich, domain-grounded section title without foreign topic leakage."""
    c_lower = chapter_title.lower()
    
    if domain == "machine_learning":
        for key, title in ML_TOPIC_SYNTHESIS.items():
            if key in c_lower:
                return title
        clean_t = re.sub(r"^\d+[\.\:\s\-]*", "", chapter_title).strip()
        return f"{clean_t}: Core Foundations & Practical Implementation"
        
    elif domain == "agentic_ai":
        for key, title in AGENTIC_TOPIC_SYNTHESIS.items():
            if key in c_lower:
                return title
        clean_t = re.sub(r"^\d+[\.\:\s\-]*", "", chapter_title).strip()
        return f"{clean_t}: Agentic Architecture & Workflow Implementation"
        
    else:
        clean_t = re.sub(r"^\d+[\.\:\s\-]*", "", chapter_title).strip()
        return f"{clean_t}: Concepts & Practical Walkthrough"

def structure_synthesis_node(state: MasterNotesState) -> Dict[str, Any]:
    print("[Phase 4] Structuring chapters with 100% video-grounded topics and synchronized timestamps...")
    raw_chapters = state.get("raw_chapters") or state.get("yt_chapters") or []
    timed_transcript = state.get("timed_transcript", [])
    video_meta = state.get("video_metadata", {})
    video_title = video_meta.get("title") or state.get("video_title", "Technical Course Notes")
    video_desc = state.get("video_description", "")
    
    chapters_text = " ".join([ch.get("title") or ch.get("chapter_title", "") for ch in raw_chapters])
    domain = detect_course_domain(video_title, video_desc, chapters_text)
    print(f"[Phase 4] Detected course domain: '{domain}' for course '{video_title}'")
    
    api_key = state.get("api_key")
    selected_model = state.get("model_name")
    llm = None
    if api_key:
        try:
            llm = get_chat_model(api_key=api_key, model_name=selected_model, temperature=0.1)
        except Exception:
            llm = None

    chapters = []
    for idx, ch in enumerate(raw_chapters, 1):
        ch_id = f"ch_{idx:02d}"
        ch_title = ch.get("title") or ch.get("chapter_title", f"Chapter {idx}")
        start_sec = int(ch.get("start_time", ch.get("start_seconds", 0)))
        end_sec = int(ch.get("end_time", start_sec + 300))
        ts_str = ch.get("timestamp_str") or format_seconds(start_sec)
        
        # Attach transcript slice for this chapter
        transcript = ch.get("transcript", "")
        if not transcript and timed_transcript:
            transcript = " ".join([seg.get("text", "") for seg in timed_transcript if start_sec <= seg.get("start", 0) < end_sec])

        # Synthesize grounded section title
        section_title = derive_grounded_section_title(ch_title, domain, video_title)
        
        # If LLM is available and transcript is substantial, allow contextual refinement strictly in-domain
        if llm and transcript and len(transcript) > 150:
            try:
                prompt_str = (
                    'You are a Lead Curriculum Architect documenting a lecture on: "' + ch_title + '".\n'
                    'Course: "' + video_title + '" (Subject Domain: ' + domain + ')\n'
                    'Lecture Excerpt:\n'
                    '---\n{transcript}\n---\n\n'
                    'Generate exactly 1 high-grade, professional technical title for this topic in English describing what the instructor demonstrates.\n'
                    'STRICT RULE: Focus 100% on what is actually taught in this lecture segment. Do NOT introduce external frameworks (e.g. do not mention LangGraph or agentic frameworks if this is Machine Learning).\n'
                    'Output strictly the title string:'
                )
                prompt = PromptTemplate.from_template(prompt_str)
                chain = prompt | llm | StrOutputParser()
                candidate = chain.invoke({
                    "transcript": transcript[:2000]
                }).strip()
                candidate = candidate.strip("\"'`").split("\n")[0].strip()
                
                # Reject candidate if foreign domain keywords leak
                if domain == "machine_learning" and any(bad in candidate.lower() for bad in ["langgraph", "agentic", "agent"]):
                    print(f"[Phase 4] Rejected leaked foreign title for {ch_title}: {candidate}")
                elif len(candidate) > 5:
                    section_title = candidate
            except Exception as e:
                print(f"[Phase 4] LLM structuring notice for {ch_title}: {e}")

        # Build section object strictly anchored to the authentic chapter start time
        sections = [{
            "section_id": f"{ch_id}_s01",
            "section_title": section_title,
            "section_order": 1,
            "chapter_id": ch_id,
            "time_reference": ts_str,
            "timestamp_seconds": start_sec,
            "transcript_slice": transcript,
            "domain": domain
        }]

        chapters.append({
            "chapter_id": ch_id,
            "chapter_order": idx,
            "chapter_title": ch_title,
            "title": ch_title,
            "timestamp_str": ts_str,
            "timestamp_seconds": start_sec,
            "overview": f"Comprehensive architectural breakdown of {ch_title}.",
            "chapter_summary": f"In {ch_title}, key concepts and implementation techniques are systematically explained and demonstrated.",
            "sections": sections,
            "domain": domain
        })

    master_outline = {
        "course_title": video_title,
        "total_chapters": len(chapters),
        "chapters": chapters,
        "domain": domain
    }

    return {"notes_structure": master_outline}

recursive_structuring_agent = structure_synthesis_node
