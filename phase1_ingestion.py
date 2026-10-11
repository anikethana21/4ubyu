"""
4 U By U — PHASE 1: Sequential Ingestion Pipeline
Fetches YouTube metadata, extracts chapters, downloads timed transcript,
and accurately slices transcripts for each chapter.
"""

import yt_dlp
from typing import Dict, Any
from langgraph.graph import StateGraph, START, END
from states import MasterNotesState
from core.transcriber import extract_video_id, fetch_youtube_transcript, format_seconds

def yt_fetch_node(state: MasterNotesState) -> Dict[str, Any]:
    """Fetches high-level metadata and chapters via yt-dlp."""
    url = state["youtube_url"]
    video_id = extract_video_id(url)
    
    ydl_opts = {
        'skip_download': True,
        'extract_flat': False,
        'quiet': True,
        'no_warnings': True,
    }
    
    metadata = {}
    description = ""
    yt_chapters = []
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            metadata = {
                "title": info.get("title", f"Tutorial {video_id}"),
                "channel": info.get("uploader", info.get("channel", "Unknown Channel")),
                "duration": info.get("duration", 0),
                "duration_str": format_seconds(info.get("duration", 0)),
                "view_count": info.get("view_count", 0),
                "thumbnail": info.get("thumbnail", f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"),
                "upload_date": info.get("upload_date", "")
            }
            description = info.get("description", "")
            
            raw_chapters = info.get("chapters") or []
            for ch in raw_chapters:
                yt_chapters.append({
                    "title": ch.get("title", "Untitled Section"),
                    "start_time": float(ch.get("start_time", 0.0)),
                    "end_time": float(ch.get("end_time", 0.0)),
                    "timestamp_str": format_seconds(ch.get("start_time", 0.0))
                })
    except Exception as e:
        print(f"[Phase 1] yt-dlp metadata warning: {e}")
        metadata = {
            "title": f"YouTube Study Guide ({video_id})",
            "channel": "Sheryians AI School",
            "duration": 0,
            "duration_str": "00:00",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        }
        
    return {
        "video_id": video_id,
        "video_metadata": metadata,
        "video_description": description,
        "yt_chapters": yt_chapters
    }

def transcribe_node(state: MasterNotesState) -> Dict[str, Any]:
    """Retrieves timed subtitle segments and complete transcript."""
    video_id = state["video_id"]
    full_text, timed_segments = fetch_youtube_transcript(video_id)
    
    yt_chapters = state.get("yt_chapters", [])
    
    # Attach actual transcript slices to each chapter
    if timed_segments and yt_chapters:
        for idx, ch in enumerate(yt_chapters):
            s = ch.get("start_time", 0.0)
            e = ch.get("end_time", 999999.0)
            ch_text = " ".join([seg["text"] for seg in timed_segments if s <= seg["start"] < e])
            ch["transcript"] = ch_text
            ch["start_seconds"] = int(s)
            print(f"[Phase 1] Chapter '{ch.get('title')}' mapped to {len(ch_text)} transcript chars.")
            
    return {
        "full_transcript": full_text,
        "timed_transcript": timed_segments,
        "yt_chapters": yt_chapters,
        "raw_chapters": yt_chapters
    }

def build_phase1_graph():
    """Compiles the Phase 1 Sequential StateGraph."""
    graph = StateGraph(MasterNotesState)
    graph.add_node("yt_fetch_node", yt_fetch_node)
    graph.add_node("transcribe_node", transcribe_node)
    
    graph.add_edge(START, "yt_fetch_node")
    graph.add_edge("yt_fetch_node", "transcribe_node")
    graph.add_edge("transcribe_node", END)
    
    return graph.compile()
