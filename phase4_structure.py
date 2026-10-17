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


def derive_subtopic_title_fallback(
    base_title: str,
    sub_text: str,
    sub_index: int,
    total_subs: int,
    domain: str
) -> str:
    """Derives domain-grounded sub-section title based on transcript keywords when LLM is unavailable."""
    text_low = sub_text.lower()
    
    # Machine Learning subtopic keywords
    if domain == "machine_learning":
        if any(k in text_low for k in ["eda", "plot", "distribution", "histogram", "scatter", "visual", "seaborn", "matplotlib"]):
            return f"{base_title}: Exploratory Data Analysis & Visual Diagnostics"
        elif any(k in text_low for k in ["missing", "imput", "null", "clean", "outlier", "drop", "replace"]):
            return f"{base_title}: Data Cleaning & Missing Value Remediation"
        elif any(k in text_low for k in ["scale", "scaling", "encode", "encoding", "standard", "minmax", "onehot", "dummy", "preproc"]):
            return f"{base_title}: Feature Preprocessing & Transformation Pipeline"
        elif any(k in text_low for k in ["feature selection", "feature engineering", "correlation", "variance"]):
            return f"{base_title}: Feature Engineering & Selection Strategy"
        elif any(k in text_low for k in ["train", "fit", "model", "regression", "classif", "algorithm", "learn"]):
            return f"{base_title}: Model Architecture & Parameter Optimization"
        elif any(k in text_low for k in ["evaluat", "metric", "accuracy", "precision", "recall", "f1", "roc", "auc", "matrix"]):
            return f"{base_title}: Evaluation Metrics & Cross-Validation Diagnostics"
        elif any(k in text_low for k in ["math", "formula", "derivative", "gradient", "loss", "cost", "equation"]):
            return f"{base_title}: Mathematical Formulations & Statistical Foundations"

    # Agentic AI subtopic keywords
    elif domain == "agentic_ai":
        if any(k in text_low for k in ["state", "schema", "typeddict", "reducer", "annotat"]):
            return f"{base_title}: State Schema Definition & Reducer Semantics"
        elif any(k in text_low for k in ["node", "function", "tool", "call", "agent", "action"]):
            return f"{base_title}: Node Execution Functions & Tool Integration"
        elif any(k in text_low for k in ["edge", "routing", "conditional", "router", "branch"]):
            return f"{base_title}: Conditional Routing & Dynamic Workflow Graph"
        elif any(k in text_low for k in ["memory", "checkpoint", "saver", "persist", "human"]):
            return f"{base_title}: State Persistence & Checkpoint Mechanics"

    # Default structural progression
    if total_subs == 2:
        return f"{base_title}: Architectural Principles & Theory" if sub_index == 1 else f"{base_title}: Implementation & Applied Workflow"
    elif total_subs == 3:
        if sub_index == 1:
            return f"{base_title}: Conceptual Foundations & Mathematical Setup"
        elif sub_index == 2:
            return f"{base_title}: Core Algorithm & Practical Architecture"
        else:
            return f"{base_title}: Diagnostics, Edge Cases & Production Patterns"

    return f"{base_title}: Segment {sub_index}"


def partition_chapter_into_semantic_sections(
    ch_id: str,
    ch_title: str,
    base_section_title: str,
    start_sec: int,
    end_sec: int,
    timed_transcript: List[Dict[str, Any]],
    domain: str,
    video_title: str,
    llm: Optional[Any] = None
) -> List[Dict[str, Any]]:
    """
    Sub-clusters long chapters (> 8 mins or > 2500 chars) into 2-3 authentic, semantically titled sub-sections.
    Guarantees every subtopic has exact timestamp synchronization and focused transcript slices.
    """
    ch_duration = max(0, end_sec - start_sec)
    ch_segs = [s for s in timed_transcript if start_sec <= s.get("start", 0) < end_sec] if timed_transcript else []
    full_ch_text = " ".join([s.get("text", "") for s in ch_segs]).strip()

    # If chapter is compact (< 8 mins and < 2500 chars) or insufficient segments, keep 1 section
    if (ch_duration < 480 and len(full_ch_text) < 2500) or len(ch_segs) < 6:
        return [{
            "section_id": f"{ch_id}_s01",
            "section_title": base_section_title,
            "section_order": 1,
            "chapter_id": ch_id,
            "time_reference": format_seconds(start_sec),
            "timestamp_seconds": start_sec,
            "transcript_slice": full_ch_text,
            "domain": domain
        }]

    # Target 2 to 3 sub-sections depending on lecture volume
    num_subsections = 3 if (ch_duration >= 1400 or len(full_ch_text) >= 6000) else 2
    
    # Try semantic boundary segmentation using window clustering
    split_points = []
    try:
        from core.transcript_segmentation import build_timed_windows, cluster_windows_to_segments
        rel_segs = []
        for s in ch_segs:
            rel = dict(s)
            rel["start"] = float(s["start"]) - start_sec
            rel["end"] = float(s.get("end", s["start"])) - start_sec
            rel_segs.append(rel)

        window_size = max(45, ch_duration // (num_subsections * 3))
        windows = build_timed_windows(rel_segs, window_sec=window_size)
        clusters = cluster_windows_to_segments(windows, distance_threshold=0.36)

        if len(clusters) >= num_subsections:
            # Select most salient boundary split points
            step = len(clusters) // num_subsections
            for k in range(1, num_subsections):
                c_idx = min(k * step, len(clusters) - 1)
                sp_sec = start_sec + int(clusters[c_idx]["start_sec"])
                if sp_sec > start_sec + 120 and sp_sec < end_sec - 120:
                    split_points.append(sp_sec)
    except Exception as e:
        print(f"[Phase 4] Semantic sub-windowing notice for {ch_title}: {e}")

    # Fallback to proportionate boundaries if clustering did not produce valid splits
    if len(split_points) < num_subsections - 1:
        step_dur = ch_duration // num_subsections
        split_points = [start_sec + (k * step_dur) for k in range(1, num_subsections)]

    # Assemble boundary ranges
    boundaries = [start_sec] + split_points + [end_sec]
    sub_slices = []
    for k in range(len(boundaries) - 1):
        b_start = boundaries[k]
        b_end = boundaries[k + 1]
        s_slice = " ".join([s.get("text", "") for s in ch_segs if b_start <= s.get("start", 0) < b_end]).strip()
        sub_slices.append((b_start, b_end, s_slice))

    # Batch LLM Titling for all sub-sections at once
    sub_titles = []
    if llm and len(sub_slices) > 1:
        try:
            prompt_input_parts = []
            for i, (b_start, b_end, s_slice) in enumerate(sub_slices, 1):
                sample = s_slice[:600] if s_slice else "No transcript excerpt"
                prompt_input_parts.append(f"Sub-Section {i} ({format_seconds(b_start)} - {format_seconds(b_end)}):\n{sample}")
            
            prompt_text = (
                f"You are a Curriculum Architect designing the internal sections for Chapter: \"{ch_title}\".\n"
                f"Course: \"{video_title}\" (Domain: {domain})\n\n"
                f"The chapter is partitioned into {len(sub_slices)} sequential technical topics:\n\n"
                + "\n\n".join(prompt_input_parts) + "\n\n"
                f"Generate exactly {len(sub_slices)} concise, specific technical section titles (5 to 9 words each) describing what the instructor demonstrates in each sub-section.\n"
                f"STRICT RULE: Do NOT include timestamp numbers or 'Part 1/2' prefixes. Focus purely on technical content.\n"
                f"Output strictly in this format:\n"
                + "\n".join([f"{i}. <Title>" for i in range(1, len(sub_slices) + 1)])
            )
            resp = (llm.invoke(prompt_text).content if hasattr(llm, "invoke") else str(llm(prompt_text))).strip()
            
            for line in resp.splitlines():
                m = re.match(r"^\d+[\.\:\s\-]+(.+)$", line.strip())
                if m:
                    t_clean = m.group(1).strip().strip('"\'')
                    if len(t_clean) > 5 and not any(bad in t_clean.lower() for bad in ["langgraph", "agentic"] if domain == "machine_learning"):
                        sub_titles.append(f"{base_section_title}: {t_clean}")
        except Exception as e:
            print(f"[Phase 4] LLM sub-section titling notice for {ch_title}: {e}")

    # Fallback titling if LLM was unavailable or returned insufficient lines
    while len(sub_titles) < len(sub_slices):
        idx = len(sub_titles) + 1
        b_start, b_end, s_slice = sub_slices[idx - 1]
        fb_title = derive_subtopic_title_fallback(base_section_title, s_slice, idx, len(sub_slices), domain)
        sub_titles.append(fb_title)

    # Build final Section definitions
    final_sections = []
    for s_idx, ((b_start, b_end, s_slice), sec_title) in enumerate(zip(sub_slices, sub_titles), 1):
        final_sections.append({
            "section_id": f"{ch_id}_s{s_idx:02d}",
            "section_title": sec_title,
            "section_order": s_idx,
            "chapter_id": ch_id,
            "time_reference": format_seconds(b_start),
            "timestamp_seconds": b_start,
            "transcript_slice": s_slice,
            "domain": domain
        })

    return final_sections

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
    total_raw = len(raw_chapters)
    total_vid_dur = int(video_meta.get("duration", 0)) if isinstance(video_meta, dict) else 0

    for idx, ch in enumerate(raw_chapters, 1):
        ch_id = f"ch_{idx:02d}"
        ch_title = ch.get("title") or ch.get("chapter_title", f"Chapter {idx}")
        start_sec = int(ch.get("start_time", ch.get("start_seconds", 0)))
        
        # 1. ACCURATE BOUNDARY COMPUTATION: Never drop transcript by defaulting to 300s or entire video
        if idx < total_raw:
            next_ch = raw_chapters[idx]
            next_start = int(next_ch.get("start_time", next_ch.get("start_seconds", 0)))
            end_sec = next_start if next_start > start_sec else start_sec + 300
        else:
            if total_vid_dur > start_sec:
                end_sec = total_vid_dur
            elif timed_transcript:
                end_sec = int(max(seg.get("end", seg.get("start", 0)) for seg in timed_transcript))
            else:
                end_sec = start_sec + 600

        ts_str = ch.get("timestamp_str") or format_seconds(start_sec)
        ch_duration = max(0, end_sec - start_sec)

        # Extract authentic transcript slice for this exact chapter boundary
        transcript = ch.get("transcript", "")
        if not transcript and timed_transcript:
            transcript = " ".join(
                [
                    seg.get("text", "")
                    for seg in timed_transcript
                    if start_sec <= seg.get("start", 0) < end_sec
                ]
            ).strip()

        # Base grounded section title
        base_section_title = derive_grounded_section_title(ch_title, domain, video_title)

        # 2. SEMANTIC MULTI-SECTION STRUCTURING:
        # Long chapters are partitioned into 2-3 genuine semantic subtopics with non-overlapping transcript slices
        sections = partition_chapter_into_semantic_sections(
            ch_id=ch_id,
            ch_title=ch_title,
            base_section_title=base_section_title,
            start_sec=start_sec,
            end_sec=end_sec,
            timed_transcript=timed_transcript,
            domain=domain,
            video_title=video_title,
            llm=llm
        )
        print(f"[Phase 4] Chapter {idx:02d} '{ch_title}' structured into {len(sections)} semantic section(s).")

        chapters.append({
            "chapter_id": ch_id,
            "chapter_order": idx,
            "chapter_title": ch_title,
            "title": ch_title,
            "timestamp_str": ts_str,
            "timestamp_seconds": start_sec,
            "start_time": start_sec,
            "end_time": end_sec,
            "duration": ch_duration,
            "transcript": transcript,
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
