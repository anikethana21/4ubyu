"""
Transcript-first chapter detection (primary syllabus source).

Runs immediately after timed transcript is available. YouTube chapter markers
are optional hints only — not the source of truth.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from core.model_router import get_chat_model
from core.transcriber import format_seconds
from core.transcript_segmentation import (
    build_timed_windows,
    cluster_windows_to_segments,
)


def _slice_transcript(
    timed_transcript: List[Dict[str, Any]], start: float, end: float
) -> str:
    parts = [
        seg["text"]
        for seg in timed_transcript
        if start <= seg["start"] < end
    ]
    return " ".join(parts).strip()


def _normalize_end_times(
    chapters: List[Dict[str, Any]], video_duration: float
) -> List[Dict[str, Any]]:
    if not chapters:
        return chapters

    sorted_ch = sorted(chapters, key=lambda c: float(c.get("start_time", 0)))
    for i, ch in enumerate(sorted_ch):
        start = float(ch.get("start_time", 0))
        end = float(ch.get("end_time", 0))
        if i + 1 < len(sorted_ch):
            next_start = float(sorted_ch[i + 1].get("start_time", start + 300))
            if end <= start or end > next_start:
                ch["end_time"] = next_start
        else:
            if end <= start:
                ch["end_time"] = max(start + 60, video_duration or start + 300)
            elif video_duration and end > video_duration:
                ch["end_time"] = float(video_duration)
    return sorted_ch


def _split_oversized_chapters(
    chapters: List[Dict[str, Any]],
    timed_transcript: List[Dict[str, Any]],
    max_duration_sec: float = 720,
) -> List[Dict[str, Any]]:
    """Split chapters longer than max_duration using secondary semantic windows."""
    result: List[Dict[str, Any]] = []
    for ch in chapters:
        start = float(ch.get("start_time", 0))
        end = float(ch.get("end_time", start + 300))
        duration = end - start
        if duration <= max_duration_sec:
            result.append(ch)
            continue

        sub_timed = [
            seg for seg in timed_transcript if start <= seg["start"] < end
        ]
        if len(sub_timed) < 8:
            result.append(ch)
            continue

        relative_timed = []
        for seg in sub_timed:
            rel = dict(seg)
            rel_start = float(seg["start"]) - start
            rel["start"] = rel_start
            rel["end"] = float(seg.get("end", seg["start"])) - start
            relative_timed.append(rel)

        windows = build_timed_windows(relative_timed, window_sec=90)
        sub_segments = cluster_windows_to_segments(windows, distance_threshold=0.32)
        if len(sub_segments) < 2:
            result.append(ch)
            continue

        for j, seg in enumerate(sub_segments):
            seg_start = start + float(seg["start_sec"])
            if j + 1 < len(sub_segments):
                seg_end = start + float(sub_segments[j + 1]["start_sec"])
            else:
                seg_end = end
            part_num = j + 1
            result.append(
                {
                    "title": f"{ch.get('title', 'Section')} — Part {part_num}",
                    "start_time": seg_start,
                    "end_time": seg_end,
                    "timestamp_str": format_seconds(seg_start),
                    "transcript": _slice_transcript(timed_transcript, seg_start, seg_end),
                    "source": "transcript_split",
                }
            )
    return result


def _synthesize_chapter_title(
    cluster_text: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> str:
    if not cluster_text.strip():
        return "Lecture Segment"

    prompt = PromptTemplate.from_template(
        """Analyze this educational video transcript segment.
Return ONE specific chapter title (max 10 words) describing what the instructor teaches here.
Avoid generic titles like "Introduction" or "Overview" unless the segment is truly only an intro.
Do not mention timestamps or part numbers.

Transcript (first 800 chars):
{text}

Title:"""
    )
    try:
        llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.1)
        chain = prompt | llm | StrOutputParser()
        title = chain.invoke({"text": cluster_text[:800]}).strip()
        title = title.strip("\"'`").split("\n")[0].strip()
        title = re.sub(r"^(title|chapter)\s*:\s*", "", title, flags=re.I)
        return title if len(title) > 3 else "Lecture Segment"
    except Exception:
        words = cluster_text.split()[:8]
        return " ".join(words) + "..." if words else "Lecture Segment"


def _segments_to_chapters(
    segments: List[Dict[str, Any]],
    timed_transcript: List[Dict[str, Any]],
    video_duration: float,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    chapters: List[Dict[str, Any]] = []
    for i, seg in enumerate(segments):
        start = float(seg["start_sec"])
        end = (
            float(segments[i + 1]["start_sec"])
            if i + 1 < len(segments)
            else (video_duration or start + 600)
        )
        transcript = _slice_transcript(timed_transcript, start, end)
        if not transcript and seg.get("text"):
            transcript = seg["text"]

        title = _synthesize_chapter_title(
            transcript or seg.get("text", ""),
            api_key=api_key,
            model_name=model_name,
        )
        chapters.append(
            {
                "title": title,
                "start_time": start,
                "end_time": end,
                "timestamp_str": format_seconds(start),
                "transcript": transcript,
                "source": "transcript_detected",
            }
        )
    return _normalize_end_times(chapters, video_duration)


def _detect_chapters_with_nn_model(
    timed_transcript: List[Dict[str, Any]],
    video_duration: float,
    window_sec: int,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> Optional[List[Dict[str, Any]]]:
    """
    Optional neural-boundary chapterization (opt-in via USE_NN_CHAPTERIZER=1).
    Uses the trained ChapterBoundaryMLP to label windows, then merges adjacent
    positive windows into chapter spans. Returns None when the model cannot be
    loaded so callers can fall back to embedding clustering.
    """
    try:
        import os
        if os.environ.get("USE_NN_CHAPTERIZER", "0").lower() not in ("1", "true", "yes"):
            return None
        from core.chapter_classifier_nn import ChapterClassifierModel

        model = ChapterClassifierModel()
        if not model.load():
            return None

        windows = build_timed_windows(timed_transcript, window_sec=window_sec)
        if not windows:
            return None

        preds = model.predict_boundaries(windows)
        boundary_starts = [w["start_sec"] for w, p in zip(windows, preds) if p == 1]
        if not boundary_starts:
            return None

        # Always treat lecture start as a chapter start
        if boundary_starts[0] != 0:
            boundary_starts = [0] + boundary_starts

        segments = []
        for i, start in enumerate(boundary_starts):
            end = boundary_starts[i + 1] if i + 1 < len(boundary_starts) else video_duration
            if end <= start:
                end = start + 60
            segments.append({"start_sec": start, "end_sec": end,
                             "timestamp_str": format_seconds(start), "text": ""})
        if len(segments) < 2:
            return None

        print(f"[ChapterDetector] NN model proposed {len(segments)} chapter boundaries.")
        return _segments_to_chapters(
            segments, timed_transcript, video_duration,
            api_key=api_key, model_name=model_name,
        )
    except Exception as e:
        print(f"[ChapterDetector] NN chapterizer unavailable, using clustering fallback: {e}")
        return None


def detect_chapters_from_transcript(
    timed_transcript: List[Dict[str, Any]],
    full_transcript: str,
    video_duration: float = 0,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    yt_chapters_hint: Optional[List[Dict[str, Any]]] = None,
    min_chapters: int = 4,
    max_chapter_duration_sec: float = 720,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Primary chapterization from English (or translated) timed transcript.
    Returns (chapters, source_label).
    """
    if not timed_transcript:
        if full_transcript.strip():
            return [
                {
                    "title": "Full Lecture",
                    "start_time": 0.0,
                    "end_time": video_duration or 3600.0,
                    "timestamp_str": "00:00",
                    "transcript": full_transcript[:120000],
                    "source": "transcript_fallback",
                }
            ], "transcript_fallback"
        return [], "empty"

    if not video_duration:
        last = timed_transcript[-1]
        video_duration = float(last.get("end", last["start"] + last.get("duration", 0)))

    # Tune clustering: longer videos → slightly more granular chapters
    duration_min = max(1, video_duration / 60)
    if duration_min > 120:
        distance_threshold = 0.34
        window_sec = 45
    elif duration_min > 45:
        distance_threshold = 0.36
        window_sec = 60
    else:
        distance_threshold = 0.38
        window_sec = 60

    windows = build_timed_windows(timed_transcript, window_sec=window_sec)

    # Opt-in neural boundary model (USE_NN_CHAPTERIZER=1); falls back to clustering
    nn_chapters = _detect_chapters_with_nn_model(
        timed_transcript, video_duration, window_sec,
        api_key=api_key, model_name=model_name,
    )
    if nn_chapters and len(nn_chapters) >= 2:
        chapters = nn_chapters
        chapters = _split_oversized_chapters(
            chapters, timed_transcript, max_duration_sec=max_chapter_duration_sec
        )
        chapters = _normalize_end_times(chapters, video_duration)
        for ch in chapters:
            if not ch.get("transcript"):
                s = float(ch["start_time"])
                e = float(ch["end_time"])
                ch["transcript"] = _slice_transcript(timed_transcript, s, e)
        print(
            f"[ChapterDetector] NN-model chapterization: {len(chapters)} chapters "
            f"(duration ~{int(video_duration)}s)."
        )
        return chapters, "transcript_nn_model"

    segments = cluster_windows_to_segments(windows, distance_threshold=distance_threshold)

    chapters = _segments_to_chapters(
        segments,
        timed_transcript,
        video_duration,
        api_key=api_key,
        model_name=model_name,
    )

    # If clustering produced too few chapters for a long video, tighten threshold once
    if len(chapters) < min_chapters and duration_min > 30:
        segments = cluster_windows_to_segments(windows, distance_threshold=0.30)
        chapters = _segments_to_chapters(
            segments,
            timed_transcript,
            video_duration,
            api_key=api_key,
            model_name=model_name,
        )

    chapters = _split_oversized_chapters(
        chapters, timed_transcript, max_duration_sec=max_chapter_duration_sec
    )
    chapters = _normalize_end_times(chapters, video_duration)

    for ch in chapters:
        if not ch.get("transcript"):
            s = float(ch["start_time"])
            e = float(ch["end_time"])
            ch["transcript"] = _slice_transcript(timed_transcript, s, e)

    print(
        f"[ChapterDetector] Transcript-first detection: {len(chapters)} chapters "
        f"(duration ~{int(video_duration)}s, threshold={distance_threshold})."
    )
    return chapters, "transcript_detected"


def choose_syllabus_chapters(
    timed_transcript: List[Dict[str, Any]],
    full_transcript: str,
    video_duration: float,
    yt_chapters: List[Dict[str, Any]],
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    prefer_transcript: bool = True,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Picks syllabus: transcript-first by default; YouTube chapters only if transcript detection fails.
    """
    detected, src = detect_chapters_from_transcript(
        timed_transcript,
        full_transcript,
        video_duration=video_duration,
        api_key=api_key,
        model_name=model_name,
        yt_chapters_hint=yt_chapters,
    )

    if prefer_transcript and detected:
        return detected, src

    if yt_chapters:
        normalized = []
        for ch in yt_chapters:
            start = float(ch.get("start_time", ch.get("start_seconds", 0)))
            end = float(ch.get("end_time", 0))
            normalized.append(
                {
                    "title": ch.get("title") or ch.get("chapter_title", "Chapter"),
                    "start_time": start,
                    "end_time": end,
                    "timestamp_str": ch.get("timestamp_str") or format_seconds(start),
                    "transcript": ch.get("transcript")
                    or _slice_transcript(timed_transcript, start, end if end > start else start + 300),
                    "source": "youtube",
                }
            )
        return _normalize_end_times(normalized, video_duration), "youtube"

    return detected, src
