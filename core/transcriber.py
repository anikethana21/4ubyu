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

def fetch_youtube_transcript(video_id: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Fetches official or auto-generated timed transcript.
    Returns (full_text, timed_segments_list)
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()
        transcript_list = ytt.list(video_id)
        
        target_t = None
        for lang in ['en', 'en-US', 'en-GB']:
            try:
                target_t = transcript_list.find_transcript([lang])
                if target_t:
                    break
            except Exception:
                pass
                
        if not target_t:
            for t in transcript_list:
                target_t = t
                break

        if not target_t:
            print("[Transcriber] No transcripts available.")
            return "", []

        data = target_t.fetch()
        
        timed_segments = []
        full_text_parts = []
        
        for item in data:
            start_sec = float(getattr(item, 'start', 0.0) if not isinstance(item, dict) else item.get('start', 0.0))
            duration_sec = float(getattr(item, 'duration', 0.0) if not isinstance(item, dict) else item.get('duration', 0.0))
            text = str(getattr(item, 'text', '') if not isinstance(item, dict) else item.get('text', '')).strip()
            
            if text:
                timed_segments.append({
                    "start": start_sec,
                    "duration": duration_sec,
                    "end": start_sec + duration_sec,
                    "timestamp_str": format_seconds(start_sec),
                    "text": text
                })
                full_text_parts.append(text)
            
        full_transcript = " ".join(full_text_parts)
        print(f"[Transcriber] Successfully fetched {len(timed_segments)} subtitle segments ({len(full_transcript)} chars) for {video_id}!")
        return full_transcript, timed_segments

    except Exception as e:
        print(f"[Transcriber] Warning: Transcript fetch error: {e}")
        return "", []
