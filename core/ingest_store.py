"""
4 U By U — Externally Ingested Transcript Store
===============================================

Persists transcript payloads captured *client-side* by the browser
extension / userscript (and, later, by the audio-upload path) so that
Phases 2-8 can run without the server ever contacting YouTube.

Why this exists
---------------
YouTube bot-gates datacenter IPs (Render, Vercel), so server-side transcript
retrieval is unreliable and cannot be fixed with code alone. The browser,
however, is already sitting on the user's own residential IP *and* already
holds a signed caption URL inside the page's ``ytInitialPlayerResponse``.
Letting the client do the fetching removes the need for proxies, for
server-side cookies, and for storing anybody's Google session.

Security posture
----------------
* **Never** accepts or stores browser cookies, credentials, or authorization
  headers. A payload is transcript text plus public video metadata only.
* Hard caps on payload size, segment count, and per-field length, so a hostile
  client cannot exhaust memory or storage through this endpoint.
* Control characters are stripped from every string; free-text metadata fields
  additionally have HTML tags removed (defense in depth — transcripts are NOT
  tag-stripped because coding lectures legitimately contain angle brackets, and
  escaping happens at render time instead).
* Payloads are owner-scoped and expire automatically (default 24h).

Storage
-------
Supabase is the primary store. When Supabase is not configured the module falls
back to a local JSON directory so the whole path stays testable offline.
"""

import datetime
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from config import BASE_DIR, APP_MODE
from core.db import get_supabase_client

# ---------------------------------------------------------------------------
# HARD LIMITS (reject, never truncate silently)
# ---------------------------------------------------------------------------

MAX_SEGMENTS = 30_000          # a 4h lecture is ~4-6k segments; 30k is generous
MAX_CHARS = 2_000_000          # ~2 MB of transcript text (3h ≈ 300 KB)
MAX_TITLE = 500
MAX_CHANNEL = 200
MAX_DESCRIPTION = 20_000
MAX_SEGMENT_TEXT = 2_000
TTL_HOURS = int(os.getenv("INGEST_TTL_HOURS", "24"))
IDEMPOTENCY_WINDOW_MIN = 10    # same user+video within N minutes reuses the id

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# YouTube renders every timestamp twice: the visible "0:07" and a screen-reader
# label such as "7 seconds". A capture that picks up the label instead of the
# caption produces a transcript made entirely of timestamps, which would
# otherwise ingest cleanly and then yield chapters with nothing inside them.
TIMESTAMP_LIKE_RE = re.compile(
    r"^(?:\d{1,2}:\d{2}(?::\d{2})?"
    r"|(?:\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|s|m|h)(?:\s*,\s*|\s+)?)+)$",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)

LOCAL_INGEST_DIR = BASE_DIR / "storage" / "ingest"


class IngestValidationError(ValueError):
    """Raised when an ingest payload is malformed or exceeds a hard limit."""


# ---------------------------------------------------------------------------
# TEXT SANITIZATION
# ---------------------------------------------------------------------------

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TAG_RE = re.compile(r"<[^>]{0,400}>")


def strip_control_chars(text: str) -> str:
    """Removes control characters (keeps newlines/tabs) and collapses whitespace."""
    cleaned = _CONTROL_RE.sub("", text)
    return re.sub(r"[ \t\r\f\v]+", " ", cleaned).strip()


def clean_text(value: Any, limit: int, strip_tags: bool = False) -> str:
    """Coerces any value to safe, length-capped plain text."""
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    if strip_tags:
        text = _TAG_RE.sub(" ", text)
    return strip_control_chars(text)[:limit]


def _hms(seconds: float) -> str:
    """Formats seconds as MM:SS or H:MM:SS."""
    total = max(0, int(seconds or 0))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def _as_float(value: Any, field: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise IngestValidationError(f"{field} must be a number, got {value!r}.")


# ---------------------------------------------------------------------------
# VALIDATION + NORMALIZATION
# ---------------------------------------------------------------------------

def _is_timestamp_only(segments: List[Dict[str, Any]]) -> bool:
    """True when a captured transcript carries timestamps but no caption text.

    The screen-reader label beside each clock ("7 seconds") looks like an
    ordinary sibling of the caption, so a DOM capture can silently collect 1,800
    of them instead of the lecture. That payload passes every structural check
    and then yields chapters with no content behind them, so it is rejected here.
    """
    if len(segments) < 10:
        return False
    stamp_like = 0
    for seg in segments:
        text = str(seg.get("text") or "").strip().strip(".,;:")
        if not text or TIMESTAMP_LIKE_RE.match(text):
            stamp_like += 1
    return stamp_like / len(segments) >= 0.8


def normalize_payload(body: Dict[str, Any], source: str = "extension") -> Dict[str, Any]:
    """
    Validates an untrusted ingest body and returns a canonical payload.

    Raises IngestValidationError with a human-readable reason. Never mutates
    the input, never logs the transcript, and never returns anything derived
    from browser credentials (there are none in the contract by design).
    """
    if not isinstance(body, dict):
        raise IngestValidationError("Payload must be a JSON object.")

    video_id = clean_text(body.get("video_id"), 32)
    if not VIDEO_ID_RE.match(video_id):
        raise IngestValidationError(
            "video_id must be an 11-character YouTube video id (e.g. 'dQw4w9WgXcQ')."
        )

    raw_segments = body.get("transcript")
    if raw_segments is None:
        raw_segments = body.get("timed_transcript")
    if not isinstance(raw_segments, list):
        raise IngestValidationError("transcript must be a list of timed segments.")
    if not raw_segments:
        raise IngestValidationError("transcript is empty — there is nothing to ingest.")
    if len(raw_segments) > MAX_SEGMENTS:
        raise IngestValidationError(
            f"transcript has {len(raw_segments)} segments (limit {MAX_SEGMENTS})."
        )

    segments: List[Dict[str, Any]] = []
    total_chars = 0
    for index, raw in enumerate(raw_segments):
        if not isinstance(raw, dict):
            raise IngestValidationError(f"segment {index} is not an object.")
        start = _as_float(raw.get("start", 0) or 0, f"segment {index} start")
        duration = _as_float(raw.get("duration", 0) or 0, f"segment {index} duration")
        if start < 0 or duration < 0:
            raise IngestValidationError(f"segment {index} has a negative timestamp.")
        text = clean_text(raw.get("text"), MAX_SEGMENT_TEXT)
        if not text:
            continue
        total_chars += len(text)
        if total_chars > MAX_CHARS:
            raise IngestValidationError(
                f"transcript text exceeds the {MAX_CHARS:,} character limit."
            )
        segments.append(
            {"start": round(start, 3), "duration": round(duration, 3), "text": text}
        )

    if not segments:
        raise IngestValidationError("transcript contained no usable text.")
    if _is_timestamp_only(segments):
        raise IngestValidationError(
            "transcript contains only timestamps, not caption text: YouTube's "
            "screen-reader timestamp labels were captured instead of the captions. "
            "Update the userscript/extension, open the video's transcript panel on "
            "the page, and capture again."
        )
    segments.sort(key=lambda seg: seg["start"])
    # Re-close small gaps so chapter slicing never drops trailing words.
    for i, seg in enumerate(segments[:-1]):
        if seg["duration"] <= 0:
            gap = segments[i + 1]["start"] - seg["start"]
            seg["duration"] = round(max(gap, 0.0), 3)

    full_transcript = " ".join(seg["text"] for seg in segments)
    last = segments[-1]
    transcript_end = float(last["start"]) + float(last["duration"])

    raw_meta = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    title = clean_text(body.get("title") or raw_meta.get("title"), MAX_TITLE, strip_tags=True)
    channel = clean_text(
        body.get("channel") or raw_meta.get("channel"), MAX_CHANNEL, strip_tags=True
    )
    description = clean_text(
        body.get("description") or raw_meta.get("description"),
        MAX_DESCRIPTION,
        strip_tags=True,
    )

    duration_hint = body.get("duration")
    if duration_hint is None:
        duration_hint = raw_meta.get("duration")
    try:
        duration = int(float(duration_hint))
    except (TypeError, ValueError):
        duration = 0
    duration = max(duration, int(transcript_end))

    youtube_url = clean_text(body.get("youtube_url"), 300)
    if not _URL_RE.match(youtube_url):
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"

    chapters = _normalize_chapters(body.get("chapters"))

    return {
        "video_id": video_id,
        "youtube_url": youtube_url,
        "metadata": {
            "title": title or f"YouTube Lecture {video_id}",
            "channel": channel or "YouTube",
            "duration": duration,
            "duration_str": _hms(duration),
            "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
        },
        "description": description,
        "chapters": chapters,
        "full_transcript": full_transcript,
        "timed_transcript": segments,
        "char_count": len(full_transcript),
        "segment_count": len(segments),
        "source": clean_text(source, 32) or "extension",
        "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def _normalize_chapters(raw: Any) -> List[Dict[str, Any]]:
    """Optional: YouTube description chapters scraped by the client."""
    if not isinstance(raw, list) or not raw:
        return []
    out: List[Dict[str, Any]] = []
    for index, chapter in enumerate(raw[:200]):
        if not isinstance(chapter, dict):
            continue
        title = clean_text(chapter.get("title"), MAX_TITLE, strip_tags=True)
        if not title:
            continue
        start = _as_float(chapter.get("start_time", 0) or 0, f"chapter {index} start_time")
        end = _as_float(chapter.get("end_time", 0) or 0, f"chapter {index} end_time")
        out.append(
            {
                "title": title,
                "start_time": max(0.0, start),
                "end_time": max(0.0, end),
                "timestamp_str": _hms(start),
            }
        )
    out.sort(key=lambda c: c["start_time"])
    return out


# ---------------------------------------------------------------------------
# PERSISTENCE — Supabase primary, local file fallback
# ---------------------------------------------------------------------------

def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _expires_at() -> str:
    return (_now() + datetime.timedelta(hours=TTL_HOURS)).isoformat()


def _local_path(ingest_id: str) -> Path:
    return LOCAL_INGEST_DIR / f"{ingest_id}.json"


def _local_write(record: Dict[str, Any]) -> None:
    LOCAL_INGEST_DIR.mkdir(parents=True, exist_ok=True)
    path = _local_path(record["id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)  # atomic


def _local_read(ingest_id: str) -> Optional[Dict[str, Any]]:
    path = _local_path(ingest_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _is_expired(record: Dict[str, Any]) -> bool:
    raw = record.get("expires_at")
    if not raw:
        return False
    try:
        expires = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=datetime.timezone.utc)
    return _now() > expires


def save_ingest_payload(
    payload: Dict[str, Any],
    user_id: Optional[str] = None,
    source: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persists a normalized payload. Returns {'ingest_id', 'expires_at', ...}.

    Idempotent: the same user re-ingesting the same video within
    IDEMPOTENCY_WINDOW_MIN returns the existing ingest_id instead of
    creating a duplicate job.
    """
    ingest_id = str(uuid.uuid4())
    source = source or payload.get("source") or "extension"
    user_key = str(user_id) if user_id else None
    record = {
        "id": ingest_id,
        "user_id": user_key,
        "video_id": payload["video_id"],
        "source": source,
        "char_count": payload["char_count"],
        "segment_count": payload["segment_count"],
        "created_at": _now().isoformat(),
        "expires_at": _expires_at(),
        "payload": payload,
    }

    summary = {
        "video_id": payload["video_id"],
        "char_count": payload["char_count"],
        "segment_count": payload["segment_count"],
    }

    existing = _find_recent(user_key, payload["video_id"])
    if existing:
        return {**summary, "ingest_id": existing["id"],
                "expires_at": existing.get("expires_at"), "deduplicated": True}

    client = get_supabase_client()
    if client is not None:
        try:
            client.table("ingest_payloads").insert(record).execute()
            return {**summary, "ingest_id": ingest_id,
                    "expires_at": record["expires_at"], "deduplicated": False}
        except Exception as exc:  # noqa: BLE001 - fall back to local, never 500
            print(f"[IngestStore] Supabase write notice, using local store: {exc}")

    _local_write(record)
    return {**summary, "ingest_id": ingest_id, "expires_at": record["expires_at"],
            "deduplicated": False, "storage": "local"}


def _find_recent(user_id: Optional[str], video_id: str) -> Optional[Dict[str, Any]]:
    """Returns {'id', 'expires_at'} for a recent duplicate, else None."""
    client = get_supabase_client()
    if client is not None:
        since = (_now() - datetime.timedelta(minutes=IDEMPOTENCY_WINDOW_MIN)).isoformat()
        try:
            query = client.table("ingest_payloads").select("id, expires_at").eq(
                "video_id", video_id
            ).gte("created_at", since)
            query = query.is_("user_id", "null") if not user_id else query.eq("user_id", user_id)
            res = query.limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            return None
        except Exception:
            pass  # fall through to the local store

    if not LOCAL_INGEST_DIR.exists():
        return None
    cutoff = _now() - datetime.timedelta(minutes=IDEMPOTENCY_WINDOW_MIN)
    for path in LOCAL_INGEST_DIR.glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if record.get("video_id") != video_id:
            continue
        if (record.get("user_id") or None) != (user_id or None):
            continue
        try:
            created = datetime.datetime.fromisoformat(record["created_at"])
        except Exception:
            continue
        if created.tzinfo is None:
            created = created.replace(tzinfo=datetime.timezone.utc)
        if created >= cutoff and not _is_expired(record):
            return {"id": record["id"], "expires_at": record.get("expires_at")}
    return None


def load_ingest_payload(ingest_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Loads a payload by id, enforcing ownership.

    An owned payload is only visible to its owner. An unowned payload (created
    with the shared EXTENSION_INGEST_TOKEN) is only visible while the server runs
    in private/single-user mode. Expired payloads are deleted on read.
    """
    if not ingest_id or not isinstance(ingest_id, str):
        return None

    client = get_supabase_client()
    record: Optional[Dict[str, Any]] = None
    if client is not None:
        try:
            res = client.table("ingest_payloads").select("*").eq("id", ingest_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                record = res.data[0]
        except Exception as exc:  # noqa: BLE001
            print(f"[IngestStore] Supabase read notice: {exc}")

    if record is None:
        record = _local_read(ingest_id)
    if record is None:
        return None

    if _is_expired(record):
        _delete_record(ingest_id)
        return None

    owner = record.get("user_id") or None
    if owner and str(owner) != str(user_id or ""):
        return None
    if not owner and APP_MODE != "private":
        # Shared-token ingest while serving the public: refuse rather than
        # risk handing one visitor another visitor's transcript.
        return None

    payload = record.get("payload")
    return payload if isinstance(payload, dict) else None


def _delete_record(ingest_id: str) -> None:
    client = get_supabase_client()
    if client is not None:
        try:
            client.table("ingest_payloads").delete().eq("id", ingest_id).execute()
            return
        except Exception:
            pass
    try:
        _local_path(ingest_id).unlink(missing_ok=True)
    except Exception:
        pass


def purge_expired() -> int:
    """Deletes expired payloads. Safe to call from a scheduled job."""
    removed = 0
    client = get_supabase_client()
    if client is not None:
        try:
            res = (
                client.table("ingest_payloads")
                .delete()
                .lt("expires_at", _now().isoformat())
                .execute()
            )
            removed += len(res.data or [])
        except Exception:
            pass
    if LOCAL_INGEST_DIR.exists():
        for path in LOCAL_INGEST_DIR.glob("*.json"):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if _is_expired(record):
                    path.unlink(missing_ok=True)
                    removed += 1
            except Exception:
                continue
    return removed


def summarize(record: Dict[str, Any]) -> Dict[str, Any]:
    """Client-safe summary. Never includes transcript text."""
    meta = record.get("metadata", {}) if isinstance(record.get("metadata"), dict) else {}
    return {
        "video_id": record.get("video_id"),
        "title": meta.get("title"),
        "channel": meta.get("channel"),
        "duration_str": meta.get("duration_str"),
        "char_count": record.get("char_count"),
        "segment_count": record.get("segment_count"),
        "source": record.get("source"),
    }
