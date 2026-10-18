"""
4 U By U — Phase 1 ingestion-seam tests.

Proves the single most important property of the hybrid architecture:

    When a transcript is supplied by the user's browser, Phase 1 performs
    ZERO network calls.

That is what lets ingestion happen where YouTube cannot bot-gate it, with no
proxy and no stored cookies.

Run either way:
    python tests/test_phase1_seam.py
    pytest tests/test_phase1_seam.py -v
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import phase1_ingestion  # noqa: E402


class NetworkTouched(AssertionError):
    """Raised by the stubs below if any network path is entered."""


def _boom(*args, **kwargs):
    raise NetworkTouched("Phase 1 hit the network — the ingest seam did not apply.")


def _stub_syllabus(*args, **kwargs):
    return (
        [
            {
                "title": "Stub Chapter",
                "start_time": 0.0,
                "end_time": 60.0,
                "timestamp_str": "00:00",
            }
        ],
        "stub",
    )


class _BoomYoutubeDL:
    """Stand-in for yt_dlp.YoutubeDL that fails if the fallback path is entered."""

    def __init__(self, *args, **kwargs):
        raise NetworkTouched("yt-dlp fallback would have hit the network")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _base_state(**overrides):
    state = {
        "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "video_id": "dQw4w9WgXcQ",
        "video_metadata": {
            "title": "Ingested Lecture",
            "channel": "Chan",
            "duration": 60,
            "duration_str": "01:00",
        },
        "video_description": "desc",
        "full_transcript": "",
        "timed_transcript": [],
        "yt_chapters": [],
        "api_key": None,
        "model_name": None,
        "hitl_approved": False,
        "ingest_source": "server",
    }
    state.update(overrides)
    return state


def _segments(count=5):
    return [
        {"start": float(i * 3), "duration": 3.0, "text": f"English words number {i}"}
        for i in range(count)
    ]


def _patch_and_run(state):
    """Runs the real Phase 1 graph with every network path stubbed to explode."""
    import types

    original = {
        "extract_robust_metadata": phase1_ingestion.extract_robust_metadata,
        "fetch_youtube_transcript": phase1_ingestion.fetch_youtube_transcript,
        "choose_syllabus_chapters": phase1_ingestion.choose_syllabus_chapters,
    }
    sentinel = object()
    had_ytdlp = sys.modules.get("yt_dlp", sentinel)
    fake_ytdlp = types.ModuleType("yt_dlp")
    fake_ytdlp.YoutubeDL = _BoomYoutubeDL

    phase1_ingestion.extract_robust_metadata = _boom
    phase1_ingestion.fetch_youtube_transcript = _boom
    phase1_ingestion.choose_syllabus_chapters = _stub_syllabus
    sys.modules["yt_dlp"] = fake_ytdlp
    try:
        return phase1_ingestion.build_phase1_graph().invoke(state)
    finally:
        for name, fn in original.items():
            setattr(phase1_ingestion, name, fn)
        if had_ytdlp is sentinel:
            sys.modules.pop("yt_dlp", None)
        else:
            sys.modules["yt_dlp"] = had_ytdlp


def test_seam_skips_all_network_when_transcript_present():
    """The headline guarantee: a client-supplied transcript never touches YouTube."""
    state = _base_state(full_transcript="English words number 0", timed_transcript=_segments())
    result = _patch_and_run(state)
    assert result["full_transcript"].startswith("English words number 0")
    assert len(result["timed_transcript"]) == 5
    assert result["yt_chapters"], "chapters must still be produced"
    assert result["syllabus_source"] == "stub"


def test_yt_fetch_node_returns_early_when_transcript_present():
    """Unit-level check of the guard itself."""
    state = _base_state(full_transcript="already here", timed_transcript=_segments())
    assert phase1_ingestion.yt_fetch_node(state) == {}


def test_seam_still_works_without_metadata():
    """A bot-gated host has no metadata; the transcript alone must be enough."""
    state = _base_state(
        video_metadata={},
        video_description="",
        full_transcript="English words number 0",
        timed_transcript=_segments(),
    )
    result = _patch_and_run(state)
    assert result["full_transcript"]
    assert result["yt_chapters"]


def test_network_is_still_used_when_no_transcript_supplied():
    """Negative control: without the seam, the network path IS entered.

    Without this test, the other tests could pass simply because the graph
    never runs the fetch node at all.
    """
    state = _base_state()  # no full_transcript, no timed_transcript
    try:
        _patch_and_run(state)
    except NetworkTouched:
        return
    raise AssertionError(
        "expected the network path to be entered when no transcript was supplied"
    )


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
