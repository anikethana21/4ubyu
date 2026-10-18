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
from core.model_router import get_usable_chat_model
from core.model_output import numbered_items

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

def derive_grounded_section_title(chapter_title: str, domain: str, video_title: str) -> str:
    """The name a section falls back to: the chapter's own topic name.

    This used to append a phrase picked by keyword from a fixed table — "Core
    Foundations & Practical Implementation" for anything machine-learning, so an
    RNN lecture came back with sections named after preprocessing pipelines. The
    chapter's real topic name says less, but it says nothing untrue.
    """
    clean = re.sub(r"^\d+[\.\:\s\-]*", "", str(chapter_title or "")).strip()
    return clean or "Overview"


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

            # Read the answer by number, and tolerate decoration: the model writes
            # "**1. Title**" as readily as "1. Title", and the strict pattern that
            # used to be here rejected the bold form — which silently dropped every
            # real title and left the canned fallback names in the notes.
            proposed = numbered_items(resp)
            for position in range(1, len(sub_slices) + 1):
                t_clean = proposed.get(position, "").strip().strip("\"'")
                if len(t_clean) > 5 and not any(
                    bad in t_clean.lower()
                    for bad in ["langgraph", "agentic"]
                    if domain == "machine_learning"
                ):
                    sub_titles.append(t_clean)
                else:
                    sub_titles.append(f"Section {position}")
        except Exception as e:
            print(f"[Phase 4] LLM sub-section titling notice for {ch_title}: {e}")

    # Any section the model did not name keeps an honest label. It is not given a
    # topic name invented from a keyword table, because a wrong section title is
    # indistinguishable from a right one once it is in the notes.
    while len(sub_titles) < len(sub_slices):
        sub_titles.append(f"Section {len(sub_titles) + 1}")

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
    # No `if api_key:` gate: the router falls back to the server's own key, which
    # is how the rest of the pipeline runs in local mode. Gating here silently
    # skipped section titling whenever the request carried no key of its own.
    llm = None
    try:
        llm = get_usable_chat_model(
            api_key=api_key, model_name=selected_model, temperature=0.1
        )
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
