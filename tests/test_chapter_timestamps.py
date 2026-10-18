"""
4 U By U — Chapter timestamp integrity tests.

Regression tests for a bug found during the hybrid-ingest end-to-end run:
when the chapterizer had to split an over-long chapter, every split part
inherited the PARENT's ``start_time``/``end_time``, so a 3-hour lecture came out
as 12 chapters all stamped 0:00 with identical transcript slices.

That is a silent failure of the project's core guarantee — chapters must be
real, distinct, navigable topic blocks.

Run either way:
    python tests/test_chapter_timestamps.py
    pytest tests/test_chapter_timestamps.py -v
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from core.topic_chapterizer import (  # noqa: E402
    MAX_CHAPTER_SEC,
    MIN_CHAPTER_SEC,
    topic_chapterize,
    _enforce_duration_constraints,
)


def _long_segment(duration_sec):
    return {
        "title": "One Very Long Topic",
        "start_time": 0.0,
        "end_time": float(duration_sec),
        "timestamp_str": "00:00",
        "text": "filler words repeated many times " * 50,
        "start_sec": 0.0,
        "end_sec": float(duration_sec),
        "source": "topic_detected",
    }


def test_split_parts_get_distinct_start_times():
    """The bug: every part used to report the parent's start (0.0)."""
    total = MAX_CHAPTER_SEC * 3.0
    parts = _enforce_duration_constraints([_long_segment(total)], total)

    assert len(parts) >= 3, f"expected a split, got {len(parts)} part(s)"
    starts = [float(p["start_time"]) for p in parts]
    assert len(set(starts)) == len(starts), f"duplicate start_time values: {starts}"
    assert starts == sorted(starts), f"start_times out of order: {starts}"


def test_split_parts_span_the_whole_video_without_gaps():
    total = MAX_CHAPTER_SEC * 3.0
    parts = _enforce_duration_constraints([_long_segment(total)], total)

    assert float(parts[0]["start_time"]) == 0.0
    assert float(parts[-1]["end_time"]) == total
    for earlier, later in zip(parts, parts[1:]):
        assert float(earlier["end_time"]) == float(later["start_time"]), "gap between parts"


def test_split_parts_stay_within_the_maximum_duration():
    total = MAX_CHAPTER_SEC * 3.0
    parts = _enforce_duration_constraints([_long_segment(total)], total)
    for part in parts:
        length = float(part["end_time"]) - float(part["start_time"])
        assert length <= MAX_CHAPTER_SEC + 0.01, f"part too long: {length}s"


def test_split_parts_carry_their_own_transcript_slice():
    """Each part must hold only its own text — not the entire lecture."""
    total = MAX_CHAPTER_SEC * 2.0
    transcript = [
        {"start": float(t), "duration": 10.0, "text": f"marker-{int(t)}"}
        for t in range(0, int(total), 10)
    ]
    chapters, source = topic_chapterize(
        transcript,
        " ".join(s["text"] for s in transcript),
        total,
        api_key=None,
        model_name=None,
        min_chapters=1,
    )
    assert chapters, f"chapterizer produced nothing (source={source})"

    # Every chapter must start at a distinct, plausible timestamp.
    starts = [float(c["start_time"]) for c in chapters]
    assert len(set(starts)) == len(starts), f"duplicate chapter start times: {starts}"

    # And its transcript must not be the whole lecture.
    whole = len(" ".join(s["text"] for s in transcript))
    for chapter in chapters:
        assert len(chapter.get("transcript", "")) < whole, (
            f"chapter {chapter.get('title')!r} contains the entire lecture transcript"
        )


def test_short_chapters_still_merge():
    """The merge half of the same function must keep working."""
    segments = [
        {"title": "Tiny A", "start_time": 0.0, "end_time": 30.0,
         "start_sec": 0.0, "end_sec": 30.0, "text": "a"},
        {"title": "Tiny B", "start_time": 30.0, "end_time": 60.0,
         "start_sec": 30.0, "end_sec": 60.0, "text": "b"},
    ]
    assert MIN_CHAPTER_SEC > 60, "test assumes two 30s chapters are below the minimum"
    merged = _enforce_duration_constraints(segments, 60.0)
    assert len(merged) == 1, f"expected a merge, got {len(merged)}"
    assert float(merged[0]["end_time"]) == 60.0


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
