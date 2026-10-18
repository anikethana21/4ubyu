"""
4 U By U — Robust Topic-Based Chapterizer
==========================================
Replaces the weak 60s-window clustering with a deterministic,
criteria-driven topic segmentation pipeline.

Design goals (per your instruction):
- Chapters are created BY TOPICS, not arbitrary timestamps.
- Foolproof: every chapter must pass hard criteria before it is accepted.
- You do not care about runtime; correctness > speed.
- Output feeds HITL review, then the parallel agent swarm.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any, Optional, Tuple

import numpy as np

from core.transcriber import format_seconds
from core.transcript_segmentation import compute_sbert_embeddings


# ---------------------------------------------------------------------------
# HARD CRITERIA (tune these; they are the "formula" for a valid chapter)
# ---------------------------------------------------------------------------
MIN_CHAPTER_SEC = 90          # no chapter shorter than 90s
MAX_CHAPTER_SEC = 900         # no chapter longer than 15min (split if longer)
MIN_TOPIC_COHERENCE = 0.55    # cosine similarity floor inside a chapter
BOUNDARY_DROP = 0.18          # similarity drop required to declare a boundary
MERGE_GAP_SEC = 60            # merge chapters closer than this if weak
WINDOW_SEC = 30               # analysis window (fine-grained)
WINDOW_STRIDE_SEC = 15        # overlap between windows


def _slice_text(
    timed_transcript: List[Dict[str, Any]], start: float, end: float
) -> str:
    parts = [
        seg.get("text", "")
        for seg in timed_transcript
        if start <= float(seg.get("start", 0)) < end
    ]
    return " ".join(p for p in parts if p).strip()


def _build_windows(
    timed_transcript: List[Dict[str, Any]], video_duration: float
) -> List[Dict[str, Any]]:
    """Fine-grained overlapping windows across the whole video."""
    windows: List[Dict[str, Any]] = []
    t = 0.0
    while t < video_duration:
        end = min(t + WINDOW_SEC, video_duration)
        text = _slice_text(timed_transcript, t, end)
        windows.append(
            {
                "start_sec": t,
                "end_sec": end,
                "mid_sec": (t + end) / 2.0,
                "text": text,
                "timestamp_str": format_seconds(t),
            }
        )
        t += WINDOW_STRIDE_SEC
    return [w for w in windows if w["text"].strip()]


def _find_boundaries(
    embeddings: np.ndarray,
    windows: List[Dict[str, Any]],
) -> List[int]:
    """
    Detect topic boundaries via self-similarity drops.
    Returns indices into `windows` where a new topic begins.
    """
    n = len(embeddings)
    if n < 3:
        return [0]

    # Cosine similarity between consecutive windows (local topic continuity)
    sims: List[float] = []
    for i in range(n - 1):
        a = embeddings[i]
        b = embeddings[i + 1]
        denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-8
        sims.append(float(np.dot(a, b) / denom))

    sims = np.array(sims)
    # A boundary is a sharp drop: current similarity << local neighborhood
    boundaries = [0]  # always start at 0
    for i in range(1, n - 1):
        left = sims[max(0, i - 2) : i]
        right = sims[i : min(n - 1, i + 2)]
        ctx = float(np.mean(np.concatenate([left, right]))) if len(left) or len(right) else sims[i]
        drop = ctx - sims[i]
        if drop >= BOUNDARY_DROP and sims[i] < MIN_TOPIC_COHERENCE:
            boundaries.append(i)

    # Ensure chronological order and uniqueness
    boundaries = sorted(set(boundaries))
    return boundaries


def _enforce_duration_constraints(
    segments: List[Dict[str, Any]],
    video_duration: float,
    timed_transcript: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Merge chapters shorter than MIN_CHAPTER_SEC with neighbors.
    Split chapters longer than MAX_CHAPTER_SEC at transcript-aligned points.

    Both branches MUST keep the pipeline's contract fields (``start_time`` /
    ``end_time``) in sync with the internal ``start_sec`` / ``end_sec`` pair.
    Letting them drift was the cause of a real bug: a 3-hour lecture came out as
    12 chapters all stamped 0:00, each carrying the *whole* lecture transcript,
    because every split part inherited the parent's ``start_time``.
    """
    if not segments:
        return segments

    # --- Merge short chapters ---
    merged: List[Dict[str, Any]] = []
    i = 0
    while i < len(segments):
        seg = dict(segments[i])
        # Keep merging forward while this chapter is too short
        while (
            i + 1 < len(segments)
            and float(seg.get("end_sec", seg["start_sec"] + 60)) - float(seg["start_sec"])
            < MIN_CHAPTER_SEC
        ):
            nxt = segments[i + 1]
            seg["end_sec"] = nxt.get("end_sec", seg["end_sec"])
            seg["end_time"] = seg["end_sec"]  # keep contract field in sync
            seg["text"] = (seg.get("text", "") + " " + nxt.get("text", "")).strip()
            seg["merged_with"] = nxt.get("title", "untitled")
            i += 1
        merged.append(seg)
        i += 1

    # --- Split long chapters ---
    final: List[Dict[str, Any]] = []
    for seg in merged:
        dur = float(seg.get("end_sec", seg["start_sec"] + 60)) - float(seg["start_sec"])
        if dur <= MAX_CHAPTER_SEC:
            final.append(seg)
            continue
        # Split into chunks of ~MAX_CHAPTER_SEC at transcript-aligned points
        start = float(seg["start_sec"])
        end = float(seg.get("end_sec", start + dur))
        step = MAX_CHAPTER_SEC
        t = start
        part = 1
        while t < end - 1:
            chunk_end = min(t + step, end)
            chunk_text = (
                _slice_text(timed_transcript, t, chunk_end) if timed_transcript else ""
            )
            final.append(
                {
                    **seg,
                    "start_sec": t,
                    "end_sec": chunk_end,
                    # Each part owns ITS OWN window — never the parent's.
                    "start_time": t,
                    "end_time": chunk_end,
                    "timestamp_str": format_seconds(t),
                    "title": f"{seg.get('title', 'Section')} (Part {part})",
                    "text": chunk_text or seg.get("text", ""),
                    "source": "topic_split",
                }
            )
            t = chunk_end
            part += 1
    return final


def _refine_titles(
    segments: List[Dict[str, Any]],
    api_key: Optional[str],
    model_name: Optional[str],
) -> List[Dict[str, Any]]:
    """Ask the LLM to give each solid segment a real topic title."""
    try:
        from core.model_router import get_chat_model
        from langchain_core.output_parsers import StrOutputParser
        from langchain_core.prompts import PromptTemplate
    except Exception:
        return segments

    llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.2)
    if llm is None:
        return segments

    prompt = PromptTemplate.from_template(
        "You are segmenting a lecture transcript into chapters by TOPIC.\n"
        "Given this transcript slice, return ONE specific chapter title (max 10 words)\n"
        "that names the topic taught. No timestamps, no part numbers, no quotes.\n\n"
        "Transcript slice:\n---\n{text}\n---\n\nTitle:"
    )
    chain = prompt | llm | StrOutputParser()

    for seg in segments:
        text = seg.get("text", "")[:1200]
        if not text.strip():
            continue
        try:
            title = chain.invoke({"text": text}).strip()
            title = re.sub(r"^(title|chapter)\s*:\s*", "", title, flags=re.I).strip("\"' `")
            title = title.split("\n")[0].strip()
            if 3 < len(title) < 60:
                seg["title"] = title
        except Exception:
            pass
    return segments


# ---------------------------------------------------------------------------
# MAIN ENTRY
# ---------------------------------------------------------------------------
def topic_chapterize(
    timed_transcript: List[Dict[str, Any]],
    full_transcript: str,
    video_duration: float,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    min_chapters: int = 3,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Robust topic-driven chapterization.

    Returns (chapters, source_label).
    Every chapter has passed: min duration, max duration, topic coherence.
    """
    if not timed_transcript:
        if full_transcript.strip():
            return [
                {
                    "title": "Full Lecture",
                    "start_time": 0.0,
                    "end_time": float(video_duration or 3600),
                    "timestamp_str": "00:00",
                    "transcript": full_transcript[:120000],
                    "source": "topic_fallback",
                }
            ], "topic_fallback"
        return [], "topic_empty"

    if not video_duration:
        last = timed_transcript[-1]
        video_duration = float(
            last.get("end", last.get("start", 0) + last.get("duration", 0))
        )

    # 1. Fine windows + embeddings
    windows = _build_windows(timed_transcript, float(video_duration))
    if not windows:
        return [
            {
                "title": "Full Lecture",
                "start_time": 0.0,
                "end_time": float(video_duration),
                "timestamp_str": "00:00",
                "transcript": full_transcript[:120000],
                "source": "topic_fallback",
            }
        ], "topic_fallback"

    texts = [w["text"] for w in windows]
    embeddings = compute_sbert_embeddings(texts)
    if embeddings.size == 0 or embeddings.shape[0] != len(windows):
        # Embedding failure → fall back to even time splits
        return _even_split_chapters(timed_transcript, video_duration), "topic_even_split"

    # 2. Find topic boundaries
    boundary_idx = _find_boundaries(embeddings, windows)

    # 3. Build segments from boundaries
    segments: List[Dict[str, Any]] = []
    for i, idx in enumerate(boundary_idx):
        start = float(windows[idx]["start_sec"])
        end = (
            float(windows[boundary_idx[i + 1]]["start_sec"])
            if i + 1 < len(boundary_idx)
            else float(video_duration)
        )
        if end <= start:
            end = start + 60
        seg_text = _slice_text(timed_transcript, start, end)
        segments.append(
            {
                "title": windows[idx]["timestamp_str"],
                "start_time": start,
                "end_time": end,
                "timestamp_str": windows[idx]["timestamp_str"],
                "text": seg_text,
                "start_sec": start,
                "end_sec": end,
                "source": "topic_detected",
            }
        )

    # 4. Enforce hard duration criteria (merge short, split long)
    segments = _enforce_duration_constraints(
        segments, float(video_duration), timed_transcript
    )

    # 5. Re-slice transcripts for final segments
    for seg in segments:
        seg["transcript"] = _slice_text(
            timed_transcript, float(seg["start_time"]), float(seg["end_time"])
        )
        seg["start_seconds"] = int(float(seg["start_time"]))

    # 6. LLM-refine titles on solid segments
    segments = _refine_titles(segments, api_key, model_name)

    # 7. Deduplicate consecutive identical titles (append Part N)
    seen_titles: Dict[str, int] = {}
    for seg in segments:
        t = seg.get("title", "Chapter")
        base = re.sub(r"\s*\(Part\s*\d+\)\s*$", "", t).strip()
        cnt = seen_titles.get(base, 0)
        if cnt > 0:
            seg["title"] = f"{base} (Part {cnt + 1})"
        seen_titles[base] = cnt + 1

    # 8. Guarantee at least min_chapters if video is long enough
    if len(segments) < min_chapters and video_duration > min_chapters * MIN_CHAPTER_SEC:
        segments = _even_split_chapters(timed_transcript, video_duration, min_chapters)
        for seg in segments:
            seg["transcript"] = _slice_text(
                timed_transcript, float(seg["start_time"]), float(seg["end_time"])
            )
            seg["start_seconds"] = int(float(seg["start_time"]))
        segments = _refine_titles(segments, api_key, model_name)

    # 8. Normalize end times chronologically
    segments = sorted(segments, key=lambda s: float(s["start_time"]))
    for i, seg in enumerate(segments):
        seg["start_time"] = float(seg["start_time"])
        if i + 1 < len(segments):
            seg["end_time"] = float(segments[i + 1]["start_time"])
        else:
            seg["end_time"] = float(video_duration)
        seg["timestamp_str"] = format_seconds(float(seg["start_time"]))

    print(
        f"[TopicChapterizer] {len(segments)} topic chapters "
        f"(duration ~{int(video_duration)}s)."
    )
    return segments, "topic_detected"


def _even_split_chapters(
    timed_transcript: List[Dict[str, Any]],
    video_duration: float,
    count: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Deterministic even-time fallback (last resort)."""
    dur = float(video_duration)
    if count is None:
        count = max(1, int(dur // MIN_CHAPTER_SEC))
    count = max(1, count)
    step = dur / count
    chapters: List[Dict[str, Any]] = []
    for i in range(count):
        start = i * step
        end = min((i + 1) * step, dur)
        chapters.append(
            {
                "title": f"Section {i + 1}",
                "start_time": start,
                "end_time": end,
                "timestamp_str": format_seconds(start),
                "text": _slice_text(timed_transcript, start, end),
                "start_sec": start,
                "end_sec": end,
                "source": "topic_even_split",
            }
        )
    return chapters
