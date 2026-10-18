"""
4 U By U — Ingest store tests.

Run either way:
    python tests/test_ingest_store.py
    pytest tests/test_ingest_store.py -v

These tests isolate the module from any real Supabase project: the client is
stubbed to None and the local store is redirected to a temp directory, so
running them can never touch production data.
"""

import contextlib
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from core.ingest_store import (  # noqa: E402
    IngestValidationError,
    load_ingest_payload,
    normalize_payload,
    save_ingest_payload,
)


@contextlib.contextmanager
def isolated_store():
    """Stubs Supabase away and points the local store at a temp directory.

    Also snapshots the module-level limits, because several tests tighten them
    to stay fast — without this, one test's limit would leak into the next.
    """
    import core.ingest_store as store

    original_client = store.get_supabase_client
    original_dir = store.LOCAL_INGEST_DIR
    original_limits = (store.MAX_SEGMENTS, store.MAX_CHARS, store.TTL_HOURS)
    with tempfile.TemporaryDirectory() as tmp:
        store.get_supabase_client = lambda: None
        store.LOCAL_INGEST_DIR = pathlib.Path(tmp)
        try:
            yield store
        finally:
            store.get_supabase_client = original_client
            store.LOCAL_INGEST_DIR = original_dir
            store.MAX_SEGMENTS, store.MAX_CHARS, store.TTL_HOURS = original_limits


def _segments(count=5, word="alpha"):
    return [
        {"start": float(i * 3), "duration": 3.0, "text": f"{word} segment {i} content"}
        for i in range(count)
    ]


def _valid_body(**overrides):
    body = {
        "video_id": "dQw4w9WgXcQ",
        "title": "A Real Lecture",
        "channel": "Some Channel",
        "duration": 0,
        "transcript": _segments(),
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_normalize_accepts_valid_payload():
    payload = normalize_payload(_valid_body())
    assert payload["video_id"] == "dQw4w9WgXcQ"
    assert payload["segment_count"] == 5
    assert payload["char_count"] == len(payload["full_transcript"])
    assert payload["metadata"]["title"] == "A Real Lecture"
    assert payload["youtube_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert "alpha segment 0 content" in payload["full_transcript"]


def test_normalize_rejects_bad_video_id():
    for bad in ("", "short", "way-too-long-to-be-real", "has space!"):
        try:
            normalize_payload(_valid_body(video_id=bad))
        except IngestValidationError:
            continue
        raise AssertionError(f"expected rejection for video_id={bad!r}")


def test_normalize_rejects_empty_transcript():
    for empty in ([], None):
        try:
            normalize_payload(_valid_body(transcript=empty))
        except IngestValidationError:
            continue
        raise AssertionError("expected rejection for an empty transcript")


def test_normalize_rejects_too_many_segments():
    with isolated_store() as store:
        store.MAX_SEGMENTS = 4
        try:
            normalize_payload(_valid_body(transcript=_segments(10)))
        except IngestValidationError as exc:
            assert "segments" in str(exc)
            return
    raise AssertionError("expected a segment-count rejection")


def test_normalize_rejects_oversized_text():
    with isolated_store() as store:
        store.MAX_CHARS = 40
        try:
            normalize_payload(_valid_body(transcript=_segments(20)))
        except IngestValidationError as exc:
            assert "character limit" in str(exc)
            return
    raise AssertionError("expected a text-size rejection")


def test_normalize_rejects_non_numeric_timestamps():
    body = _valid_body(transcript=[{"start": "not-a-number", "duration": 3, "text": "hi"}])
    try:
        normalize_payload(body)
    except IngestValidationError as exc:
        assert "number" in str(exc)
        return
    raise AssertionError("expected a timestamp rejection")


def test_normalize_strips_html_from_metadata_but_not_transcript():
    """Titles/channels are rendered into HTML, so tags are removed there.

    Transcript text is NOT tag-stripped: a coding lecture legitimately contains
    angle brackets. Escaping for transcripts happens at render time.
    """
    body = _valid_body(
        title="<script>alert(1)</script>Real Title",
        channel="<img src=x onerror=alert(1)>Chan",
        transcript=[{"start": 0, "duration": 2, "text": "use <div> and </div> here"}],
    )
    payload = normalize_payload(body)
    assert "<script>" not in payload["metadata"]["title"]
    assert "Real Title" in payload["metadata"]["title"]
    assert "<img" not in payload["metadata"]["channel"]
    assert "<div>" in payload["full_transcript"]


def test_normalize_strips_control_characters():
    body = _valid_body(transcript=[{"start": 0, "duration": 1, "text": "bad\x00chars\x07here"}])
    payload = normalize_payload(body)
    assert "\x00" not in payload["full_transcript"]
    assert "\x07" not in payload["full_transcript"]


def test_normalize_derives_duration_from_transcript():
    """A 3h lecture on a bot-gated host has no metadata — the transcript wins.

    _segments(40) ends at 117s + 3s duration = 120s, so the derived runtime
    must be 120s even though the caller reported duration=0.
    """
    payload = normalize_payload(_valid_body(duration=0, transcript=_segments(40)))
    assert payload["metadata"]["duration"] == 120
    assert payload["metadata"]["duration_str"] == "02:00"


def test_normalize_sorts_segments_and_fills_gaps():
    body = _valid_body(
        transcript=[
            {"start": 10, "duration": 0, "text": "second"},
            {"start": 0, "duration": 0, "text": "first"},
        ]
    )
    payload = normalize_payload(body)
    assert [s["text"] for s in payload["timed_transcript"]] == ["first", "second"]
    assert payload["timed_transcript"][0]["duration"] == 10.0  # gap closed


def test_normalize_drops_empty_segments():
    body = _valid_body(
        transcript=[
            {"start": 0, "duration": 1, "text": "  "},
            {"start": 1, "duration": 1, "text": "real"},
        ]
    )
    payload = normalize_payload(body)
    assert payload["segment_count"] == 1


def test_normalize_keeps_chapters_when_provided():
    body = _valid_body(
        chapters=[
            {"title": "Second", "start_time": 60, "end_time": 120},
            {"title": "First", "start_time": 0, "end_time": 60},
        ]
    )
    payload = normalize_payload(body)
    assert [c["title"] for c in payload["chapters"]] == ["First", "Second"]


# ---------------------------------------------------------------------------
# Persistence, ownership, expiry, idempotency
# ---------------------------------------------------------------------------

def test_save_and_load_roundtrip():
    with isolated_store():
        payload = normalize_payload(_valid_body())
        saved = save_ingest_payload(payload, user_id="user-A")
        loaded = load_ingest_payload(saved["ingest_id"], user_id="user-A")
        assert loaded is not None
        assert loaded["segment_count"] == payload["segment_count"]
        assert loaded["full_transcript"] == payload["full_transcript"]


def test_load_enforces_ownership():
    with isolated_store():
        payload = normalize_payload(_valid_body())
        saved = save_ingest_payload(payload, user_id="user-A")
        assert load_ingest_payload(saved["ingest_id"], user_id="user-B") is None
        assert load_ingest_payload(saved["ingest_id"], user_id=None) is None
        assert load_ingest_payload(saved["ingest_id"], user_id="user-A") is not None


def test_unowned_payload_is_private_mode_only():
    """Shared EXTENSION_INGEST_TOKEN payloads are readable only in private mode."""
    import core.ingest_store as store

    with isolated_store():
        payload = normalize_payload(_valid_body())
        saved = save_ingest_payload(payload, user_id=None)
        original_mode = store.APP_MODE
        try:
            store.APP_MODE = "private"
            assert load_ingest_payload(saved["ingest_id"], user_id=None) is not None
            store.APP_MODE = "public"
            assert load_ingest_payload(saved["ingest_id"], user_id=None) is None
        finally:
            store.APP_MODE = original_mode


def test_expired_payload_is_not_returned():
    with isolated_store() as store:
        original_ttl = store.TTL_HOURS
        try:
            store.TTL_HOURS = -1  # write an already-expired record
            payload = normalize_payload(_valid_body())
            saved = save_ingest_payload(payload, user_id="user-A")
            assert load_ingest_payload(saved["ingest_id"], user_id="user-A") is None
        finally:
            store.TTL_HOURS = original_ttl


def test_idempotent_within_window():
    """Double-clicking the extension button must not create two jobs."""
    with isolated_store():
        payload = normalize_payload(_valid_body())
        first = save_ingest_payload(payload, user_id="user-A")
        second = save_ingest_payload(payload, user_id="user-A")
        assert first["ingest_id"] == second["ingest_id"]
        assert second["deduplicated"] is True
        # A different user is a different job.
        third = save_ingest_payload(payload, user_id="user-B")
        assert third["ingest_id"] != first["ingest_id"]


def test_unknown_ingest_id_returns_none():
    with isolated_store():
        assert load_ingest_payload("00000000-0000-0000-0000-000000000000", user_id="A") is None
        assert load_ingest_payload("", user_id="A") is None
        assert load_ingest_payload(None, user_id="A") is None


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  FAIL  {name}\n        {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed.")
    sys.exit(1 if failures else 0)
