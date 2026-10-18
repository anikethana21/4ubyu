"""
4 U By U — PHASE 1: Sequential Ingestion Pipeline
Fetches YouTube metadata, extracts chapters, downloads timed transcript,
and accurately slices transcripts for each chapter.
Uses dual-engine extraction: robust cloud extractor + yt-dlp fallback.
"""

from typing import Dict, Any
from langgraph.graph import StateGraph, START, END
from states import MasterNotesState
from core.transcriber import extract_video_id, fetch_youtube_transcript, format_seconds
from core.transcript_normalizer import normalize_transcript
from core.robust_ingestion import extract_robust_metadata
from core.chapter_detector import choose_syllabus_chapters

def yt_fetch_node(state: MasterNotesState) -> Dict[str, Any]:
    """Fetches high-level metadata and chapters with 100% cloud reliability."""
    # ── Externally ingested seam ────────────────────────────────────────────
    # When the transcript was captured client-side (browser extension/userscript
    # or the audio-upload path), the payload already carries metadata, chapters
    # and text. Never touch the network in that case — that is the whole point
    # of the seam: it lets ingestion happen where YouTube cannot bot-gate it.
    if (state.get("full_transcript") or "").strip():
        print("[Phase 1] Externally ingested payload detected — skipping YouTube metadata fetch.")
        return {}

    url = state["youtube_url"]
    video_id = extract_video_id(url)
    
    metadata = {}
    description = ""
    yt_chapters = []
    
    # Primary: Fast, 100% cloud-reliable metadata and chapter extraction
    try:
        vid, meta, chaps = extract_robust_metadata(url)
        if meta and meta.get("title"):
            video_id = vid or video_id
            metadata = meta
            yt_chapters = chaps if chaps else []
            print(f"[Phase 1] Robust extractor succeeded: {len(yt_chapters)} description chapters, duration {metadata.get('duration_str')}")
    except Exception as e:
        print(f"[Phase 1] Robust extractor warning: {e}")

    # Fallback to yt-dlp if needed or to enrich description
    if not yt_chapters:
        try:
            import yt_dlp
            ydl_opts = {
                'skip_download': True,
                'extract_flat': False,
                'quiet': True,
                'no_warnings': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if not metadata or metadata.get("duration", 0) == 0:
                    metadata = {
                        "title": info.get("title", f"Tutorial {video_id}"),
                        "channel": info.get("uploader", info.get("channel", "Unknown Channel")),
                        "duration": info.get("duration", 0),
                        "duration_str": format_seconds(info.get("duration", 0)),
                        "view_count": info.get("view_count", 0),
                        "thumbnail": info.get("thumbnail", f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"),
                        "upload_date": info.get("upload_date", "")
                    }
                description = info.get("description", description)
                
                raw_chapters = info.get("chapters") or []
                for ch in raw_chapters:
                    yt_chapters.append({
                        "title": ch.get("title", "Untitled Section"),
                        "start_time": float(ch.get("start_time", 0.0)),
                        "end_time": float(ch.get("end_time", 0.0)),
                        "timestamp_str": format_seconds(ch.get("start_time", 0.0))
                    })
        except Exception as e:
            print(f"[Phase 1] yt-dlp metadata notice: {e}")

    if not metadata:
        metadata = {
            "title": f"Educational Study Guide ({video_id})",
            "channel": "YouTube Creator",
            "duration": 0,
            "duration_str": "00:00",
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
        }
        
    return {
        "video_id": video_id,
        "video_metadata": metadata,
        "video_description": description,
        "yt_chapters": yt_chapters,
        "raw_chapters": yt_chapters
    }

def transcribe_node(state: MasterNotesState) -> Dict[str, Any]:
    """Retrieves timed subtitle segments and complete transcript."""
    video_id = state["video_id"]
    api_key = state.get("api_key")
    model_name = state.get("model_name")

    # ── Externally ingested seam ────────────────────────────────────────────
    # A client-side capture (extension/userscript) or the upload path supplies
    # the transcript directly. Skip every network source — YouTube never sees
    # this request, so the datacenter bot gate cannot break it.
    external_text = (state.get("full_transcript") or "").strip()
    external_segments = list(state.get("timed_transcript") or [])

    if external_text and external_segments:
        full_text, timed_segments = external_text, external_segments
        print(
            f"[Phase 1] Using externally ingested transcript "
            f"({len(timed_segments)} segments, {len(full_text)} chars) — no network fetch."
        )
    else:
        full_text, timed_segments = fetch_youtube_transcript(video_id)


    # Normalize non-Latin transcripts (Hindi/Hinglish, CJK, Arabic, Cyrillic …)
    # to English *before* chapterization, so an English handbook is never built
    # on Devanagari/Kana/Han source text. No-op for English transcripts, and it
    # degrades to the original text if translation is unavailable.
    full_text, timed_segments, translation_info = normalize_transcript(
        full_text, timed_segments, api_key=api_key, model_name=model_name
    )

    metadata = dict(state.get("video_metadata", {}) or {})
    yt_chapters = state.get("yt_chapters", [])
    video_duration = float(metadata.get("duration", 0) or 0)

    # Derive duration from the transcript when metadata extraction failed
    # (e.g. YouTube bot-gated the watch page on a datacenter IP). This keeps the
    # HITL badge and chapter end-times accurate instead of showing 00:00.
    if timed_segments:
        last = timed_segments[-1]
        derived = float(last.get("end", last["start"] + last.get("duration", 0)))
        if derived > video_duration:
            video_duration = derived
            metadata["duration"] = int(derived)
            metadata["duration_str"] = format_seconds(derived)
            print(f"[Phase 1] Derived duration {metadata['duration_str']} from transcript.")

    if state.get("hitl_approved") and yt_chapters:
        syllabus = yt_chapters
        syllabus_source = "hitl_approved"
        print(f"[Phase 1] Using {len(syllabus)} human-approved chapters (skipping auto-detection).")
    else:
        # Transcript-first syllabus (primary); YouTube markers are hints only
        syllabus, syllabus_source = choose_syllabus_chapters(
            timed_transcript=timed_segments,
            full_transcript=full_text,
            video_duration=video_duration,
            yt_chapters=yt_chapters,
            api_key=api_key,
            model_name=model_name,
            prefer_transcript=True,
        )

    for ch in syllabus:
        s = float(ch.get("start_time", 0))
        e = float(ch.get("end_time", s + 300))
        if not ch.get("transcript") and timed_segments:
            ch_text = " ".join(
                seg["text"] for seg in timed_segments if s <= seg["start"] < e
            )
            ch["transcript"] = ch_text
        ch["start_seconds"] = int(s)
        print(
            f"[Phase 1] Chapter '{ch.get('title')}' ({syllabus_source}) "
            f"→ {len(ch.get('transcript', ''))} transcript chars."
        )

    return {
        "full_transcript": full_text,
        "timed_transcript": timed_segments,
        "video_metadata": metadata,
        "yt_chapters": syllabus,
        "raw_chapters": syllabus,
        "syllabus_source": syllabus_source,
        "translation_info": translation_info,
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
