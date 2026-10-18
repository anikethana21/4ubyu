"""
4 U By U — HITL chapter contract tests.

Regression cover for a field-name mismatch between the HITL review UI and the
pipeline:

  * the UI posts back ``start_seconds`` / ``end_seconds``
  * Phase 1 read only ``start_time`` / ``end_time``

So every human-approved chapter fell back to 0 and was re-sliced from the first
5 minutes of the lecture. Twelve approved chapters produced twelve copies of the
introduction. Chapter timestamps are the project's core guarantee, so this gets
locked down.

Run either way:
    python tests/test_hitl_chapter_contract.py
    pytest tests/test_hitl_chapter_contract.py -v
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from phase1_ingestion import transcribe_node  # noqa: E402


def _transcript(total=600, step=10):
    return [
        {"start": float(t), "duration": float(step), "text": f"seg{t:04d}"}
        for t in range(0, total, step)
    ]


def _state(chapters, total=600):
    segments = _transcript(total=total)
    return {
        "video_id": "dQw4w9WgXcQ",
        "api_key": None,
        "model_name": None,
        "full_transcript": " ".join(s["text"] for s in segments),
        "timed_transcript": segments,
        "video_metadata": {"duration": total},
        "yt_chapters": chapters,
        "hitl_approved": True,
        "ingest_source": "userscript",
    }


def test_hitl_chapters_posted_as_start_seconds_keep_their_window():
    """The exact shape the UI sends: start_seconds/end_seconds and nothing else."""
    approved = [
        {"title": "First", "start_seconds": 0, "end_seconds": 120, "timestamp_str": "00:00"},
        {"title": "Second", "start_seconds": 120, "end_seconds": 300, "timestamp_str": "02:00"},
        {"title": "Third", "start_seconds": 300, "end_seconds": 600, "timestamp_str": "05:00"},
    ]
    out = transcribe_node(_state(approved))
    chapters = out["yt_chapters"]

    starts = [c["start_time"] for c in chapters]
    assert starts == [0.0, 120.0, 300.0], f"windows were not preserved: {starts}"

    for chapter, expected_start in zip(chapters, (0, 120, 300)):
        blob = chapter["transcript"]
        assert f"seg{expected_start:04d}" in blob, (
            f"chapter {chapter['title']!r} is missing its own opening segment"
        )


def test_hitl_chapters_do_not_all_reuse_the_first_five_minutes():
    """The reported bug: 12 approved chapters, 12 identical transcript slices."""
    approved = [
        {"title": f"Topic {i}", "start_seconds": i * 60, "end_seconds": (i + 1) * 60,
         "timestamp_str": "00:00"}
        for i in range(10)
    ]
    chapters = transcribe_node(_state(approved, total=600))["yt_chapters"]

    slices = [c["transcript"] for c in chapters]
    assert len(set(slices)) == len(slices), "approved chapters still share one transcript"

    whole = len(" ".join(s["text"] for s in _transcript(total=600)))
    for chapter in chapters:
        assert len(chapter["transcript"]) < whole, (
            f"chapter {chapter['title']!r} carries the entire lecture"
        )


def test_both_field_spellings_are_published():
    """Downstream phases and clients must be able to read either name."""
    approved = [{"title": "Only", "start_seconds": 60, "end_seconds": 180}]
    chapter = transcribe_node(_state(approved))["yt_chapters"][0]

    assert chapter["start_time"] == 60.0
    assert chapter["end_time"] == 180.0
    assert chapter["start_seconds"] == 60
    assert chapter["end_seconds"] == 180


def test_missing_end_time_falls_back_instead_of_collapsing():
    """A chapter with no usable end must not produce an empty transcript."""
    approved = [{"title": "Open Ended", "start_seconds": 120, "end_seconds": 0}]
    chapter = transcribe_node(_state(approved))["yt_chapters"][0]

    assert chapter["end_time"] > chapter["start_time"]
    assert chapter["transcript"], "chapter transcript came back empty"


def test_start_time_style_chapters_still_work():
    """Auto-detected chapters use start_time/end_time — must not regress."""
    approved = [
        {"title": "A", "start_time": 0.0, "end_time": 240.0},
        {"title": "B", "start_time": 240.0, "end_time": 600.0},
    ]
    chapters = transcribe_node(_state(approved))["yt_chapters"]
    assert [c["start_time"] for c in chapters] == [0.0, 240.0]
    assert len({c["transcript"] for c in chapters}) == 2


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
