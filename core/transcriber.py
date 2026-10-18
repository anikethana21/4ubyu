"""
4 U By U — Dual-Engine Transcription Service
Uses youtube-transcript-api for instant, free subtitle extraction,
supporting modern FetchedTranscriptSnippet objects, multi-language detection,
and robust time-aligned segment extraction.
"""

import re
from typing import List, Dict, Any, Tuple

def extract_video_id(url: str) -> str:
    """Extracts YouTube 11-char ID from various standard URL shapes."""
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"embed\/([0-9A-Za-z_-]{11})"
    ]
    for p in patterns:
        match = re.search(p, url)
        if match:
            return match.group(1)
    if len(url) == 11 and re.match(r"^[0-9A-Za-z_-]{11}$", url):
        return url
    raise ValueError(f"Invalid YouTube URL or Video ID: {url}")

def format_seconds(seconds: float) -> str:
    """Formats float/int seconds into MM:SS or HH:MM:SS string."""
    s = int(seconds)
    hours = s // 3600
    minutes = (s % 3600) // 60
    secs = s % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

def _normalize_segments(raw_segments: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
    """Normalizes heterogeneous transcript dicts to the pipeline's segment shape."""
    timed: List[Dict[str, Any]] = []
    parts: List[str] = []
    for item in raw_segments:
        start = float(item.get("start", 0.0) or 0.0)
        dur = float(item.get("duration", 0.0) or 0.0)
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        timed.append({
            "start": start,
            "duration": dur,
            "end": start + dur,
            "timestamp_str": format_seconds(start),
            "text": text,
        })
        parts.append(text)
    return " ".join(parts), timed


def _transcript_via_api(video_id: str) -> Tuple[str, List[Dict[str, Any]]]:
    """Primary source: youtube-transcript-api (official/auto subtitles)."""
    from youtube_transcript_api import YouTubeTranscriptApi

    ytt = YouTubeTranscriptApi()
    transcript_list = ytt.list(video_id)

    target_t = None
    for lang in ["en", "en-US", "en-GB"]:
        try:
            target_t = transcript_list.find_transcript([lang])
            if target_t:
                break
        except Exception:
            pass

    if not target_t:
        for t in transcript_list:
            try:
                target_t = t.translate("en")
                print(f"[Transcriber] Translated transcript from "
                      f"'{getattr(t, 'language_code', 'auto')}' → English.")
                break
            except Exception:
                continue

    if not target_t:
        for t in transcript_list:
            target_t = t
            break

    if not target_t:
        return "", []

    data = target_t.fetch()
    raws: List[Dict[str, Any]] = []
    for item in data:
        start = float(getattr(item, 'start', 0.0) if not isinstance(item, dict) else item.get('start', 0.0))
        dur = float(getattr(item, 'duration', 0.0) if not isinstance(item, dict) else item.get('duration', 0.0))
        text = str(getattr(item, 'text', '') if not isinstance(item, dict) else item.get('text', '')).strip()
        raws.append({"start": start, "duration": dur, "text": text})
    return _normalize_segments(raws)


def fetch_youtube_transcript(video_id: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Fetches official or auto-generated timed transcript using layered sources so
    datacenter / serverless IP gating never yields a silent empty result:

      1. youtube-transcript-api
      2. InnerTube caption tracks (core.youtube_fetch)
      3. yt-dlp subtitle download (core.youtube_fetch)
    """
    # 1. Primary: youtube-transcript-api
    try:
        full_text, timed_segments = _transcript_via_api(video_id)
        if timed_segments:
            print(f"[Transcriber] Successfully fetched {len(timed_segments)} subtitle "
                  f"segments ({len(full_text)} chars) for {video_id} (transcript-api)!")
            return full_text, timed_segments
    except Exception as e:
        print(f"[Transcriber] Transcript-API notice: {e}")

    # 2. InnerTube caption tracks
    try:
        from core.youtube_fetch import fetch_captions

        caps = fetch_captions(video_id)
        if caps:
            full_text, timed_segments = _normalize_segments(caps)
            if timed_segments:
                print(f"[Transcriber] InnerTube captions: {len(timed_segments)} "
                      f"segments ({len(full_text)} chars) for {video_id}.")
                return full_text, timed_segments
    except Exception as e:
        print(f"[Transcriber] InnerTube caption notice: {e}")

    # 3. Last resort: yt-dlp subtitles
    try:
        from core.youtube_fetch import fetch_subtitles_ytdlp

        subs = fetch_subtitles_ytdlp(video_id)
        if subs:
            full_text, timed_segments = _normalize_segments(subs)
            if timed_segments:
                print(f"[Transcriber] yt-dlp subtitles: {len(timed_segments)} "
                      f"segments ({len(full_text)} chars) for {video_id}.")
                return full_text, timed_segments
    except Exception as e:
        print(f"[Transcriber] yt-dlp subtitle notice: {e}")

    print(f"[Transcriber] All transcript sources failed for {video_id}.")
    return "", []
