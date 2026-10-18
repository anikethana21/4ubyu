"""Chapter titling: batched, short excerpts, and no fabricated work anywhere else.

Titling is the only stage where a chapter costs a model call, so it is asked for
in batches rather than one chapter per request — a four-hour course used to make
sixty-odd calls, nearly all of that time spent waiting on request latency.

These tests also pin the two pieces of work that were removed because nothing
consumed them: Phase 2's cluster titling (which filled `labeled_transcript`, read
by no one) and the placeholder gap-topics it invented when a call failed.
"""

import pytest
from langchain_core.runnables import RunnableLambda

import core.model_router as router
import core.topic_chapterizer as tc
import phase2_parallel as p2


def _segments(count):
    return [
        {"text": f"Lecture content for part {i}. " * 20, "start": float(i * 60)}
        for i in range(1, count + 1)
    ]


def _fake_llm(behaviour):
    calls = []

    def _run(prompt_value):
        text = prompt_value.to_string() if hasattr(prompt_value, "to_string") else str(prompt_value)
        calls.append(text)
        return behaviour(len(calls), text)

    return RunnableLambda(_run), calls


@pytest.fixture(autouse=True)
def _restore_batch_size():
    original = tc.TITLE_BATCH
    yield
    tc.TITLE_BATCH = original


def test_titles_are_requested_in_batches(monkeypatch):
    """Thirteen chapters at six per call is three requests, not thirteen."""
    tc.TITLE_BATCH = 6

    def behaviour(attempt, text):
        return "\n".join(
            f"{n}. Topic number {n} explained" for n in range(1, 7)
        )

    llm, calls = _fake_llm(behaviour)
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    segments = _segments(13)
    tc._refine_titles(segments, api_key="k", model_name="")

    assert len(calls) == 3, "13 chapters should take 3 batched requests"
    # Every chapter in a full batch gets the title that carries its own number.
    assert [s["title"] for s in segments[:6]] == [
        f"Topic number {n} explained" for n in range(1, 7)
    ]
    assert segments[0]["title_source"] == "llm"


def test_one_missing_title_does_not_shift_the_others(monkeypatch):
    """Answers are matched by number, so a dropped line costs exactly one title."""
    tc.TITLE_BATCH = 3

    def behaviour(attempt, text):
        # The model skips number 2 entirely.
        return "1. First real topic name\n3. Third real topic name"

    llm, _ = _fake_llm(behaviour)
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    segments = _segments(3)
    tc._refine_titles(segments, api_key="k", model_name="")

    assert segments[0]["title"] == "First real topic name"
    assert segments[1].get("title") is None
    assert segments[2]["title"] == "Third real topic name"


def test_a_model_failure_message_never_becomes_a_title(monkeypatch):
    """A chapter must never be named after the model's own error notice."""
    tc.TITLE_BATCH = 2

    llm, _ = _fake_llm(
        lambda attempt, text: "1. Study Assistant Notice\n2. Gating in Recurrent Networks"
    )
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    segments = _segments(2)
    tc._refine_titles(segments, api_key="k", model_name="")

    assert segments[0].get("title") is None, "an error notice is not a chapter name"
    assert segments[1]["title"] == "Gating in Recurrent Networks"


def test_a_failed_batch_leaves_the_other_batches_alone(monkeypatch):
    tc.TITLE_BATCH = 2

    def behaviour(attempt, text):
        if attempt == 1:
            raise RuntimeError("Groq API Error 429: rate_limit_exceeded")
        return "1. Later topic one\n2. Later topic two"

    llm, calls = _fake_llm(behaviour)
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    segments = _segments(4)
    tc._refine_titles(segments, api_key="k", model_name="")

    assert len(calls) == 2, "one failed batch must not abandon the next one"
    assert segments[0].get("title") is None
    assert segments[1].get("title") is None
    assert segments[2]["title"] == "Later topic one"
    assert segments[3]["title"] == "Later topic two"


def test_titles_are_read_from_short_excerpts(monkeypatch):
    """The prompt carries the opening of each slice, not fifteen minutes of it."""
    tc.TITLE_BATCH = 1
    seen = {}

    def behaviour(attempt, text):
        seen["prompt"] = text
        return "1. A real topic name"

    llm, _ = _fake_llm(behaviour)
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    long_segment = [{"text": "x" * 5000, "start": 0.0}]
    tc._refine_titles(long_segment, api_key="k", model_name="")

    assert "x" * tc.TITLE_EXCERPT_CHARS in seen["prompt"]
    assert "x" * (tc.TITLE_EXCERPT_CHARS + 1) not in seen["prompt"]


def test_phase2_does_not_pay_for_cluster_titles_nothing_reads():
    """`labeled_transcript` has no reader, so its per-cluster calls are gone."""
    assert "branch_label_node" not in p2.build_phase2_graph().get_graph().nodes


TOO_LARGE = (
    "Groq API Error 413: request too large for openai/gpt-oss-120b. "
    '{"error":{"message":"Request too large for model on tokens per minute (TPM): '
    'Limit 8000, Requested 8240","type":"tokens","code":"rate_limit_exceeded"}}'
)


def test_a_failed_title_batch_records_why_titles_are_missing(monkeypatch):
    """The reader is told the failure that happened, not a guess between two."""
    tc.TITLE_BATCH = 2
    llm, _ = _fake_llm(
        lambda attempt, text: (_ for _ in ()).throw(RuntimeError(TOO_LARGE))
    )
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: llm)

    tc._refine_titles(_segments(2), api_key="k", model_name="")

    assert tc.TITLE_FAILURE and "tokens in one minute" in tc.TITLE_FAILURE


def test_no_usable_model_records_that_as_the_reason(monkeypatch):
    monkeypatch.setattr(router, "get_usable_chat_model", lambda **kwargs: None)

    segments = _segments(3)
    tc._refine_titles(segments, api_key="", model_name="")

    assert tc.TITLE_FAILURE == "no usable model was available, so no titles were requested"
    assert all(s.get("title") is None for s in segments)


def test_a_failed_gap_analysis_invents_no_topics(monkeypatch):
    """No model answer means no gap list — not two generic stand-ins."""
    monkeypatch.setattr(
        p2,
        "get_chat_model",
        lambda **kwargs: RunnableLambda(
            lambda prompt_value: (_ for _ in ()).throw(RuntimeError("Groq API Error 500"))
        ),
    )

    out = p2.branch_online_search_node(
        {"full_transcript": "Neural networks " * 200, "api_key": "k", "model_name": ""}
    )

    assert out["missing_topics"] == []
