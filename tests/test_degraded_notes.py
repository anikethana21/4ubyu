"""A failed model call must produce an honest notice, never invented notes.

The theory agent used to answer a failed call with a hardcoded block of
scikit-learn prose — regardless of which lecture was being processed — so a
four-hour RNN course came back with identical paragraphs about ColumnTransformers
and data leakage in every single chapter, presented as though the instructor had
said them. The block was reached on every run, too, because the success path
imported a function that does not exist.

These tests hold the two fixes in place: the failure is stated plainly with the
instructor's own words attached, and the old filler can never resurface.
"""

import pytest
from langchain_core.runnables import RunnableLambda

import phase5_chapter_agents as p5

TOO_LARGE = (
    "Groq API Error 413: request too large for openai/gpt-oss-120b. "
    '{"error":{"message":"Request too large for model on tokens per minute (TPM): '
    'Limit 8000, Requested 8240","type":"tokens","code":"rate_limit_exceeded"}}'
)
RATE_LIMITED = "Groq TPM Rate Limit (429). rate_limit_exceeded"

LECTURE = (
    "Recurrent neural networks carry a hidden state from one timestep to the next. "
    "That hidden state is what lets the network remember earlier words in the sentence. "
) * 60


def _state():
    return {
        "section_title": "Hidden State and Sequence Memory",
        "chapter_structure": {"title": "Recurrent Neural Networks"},
        "transcript_slice": LECTURE,
        "domain": "machine_learning",
        "api_key": "test-key",
        "selected_model": "",
    }


def _fake_llm(behaviour):
    """A LangChain runnable standing in for the provider, recording every prompt."""
    prompts = []

    def _run(prompt_value):
        text = prompt_value.to_string() if hasattr(prompt_value, "to_string") else str(prompt_value)
        prompts.append(text)
        return behaviour(len(prompts), text)

    return RunnableLambda(_run), prompts


@pytest.fixture(autouse=True)
def _clean_record():
    p5.reset_degraded_sections()
    yield
    p5.reset_degraded_sections()


def test_oversized_request_is_retried_with_less_context(monkeypatch):
    """A 413 means the request was bigger than the whole per-minute meter.

    Waiting cannot help, so the agent must send less context and try again.
    """

    def behaviour(attempt, text):
        if attempt == 1:
            raise RuntimeError(TOO_LARGE)
        return (
            "EXPLANATION:\n### Hidden state\n"
            "The hidden state is carried across timesteps, and that is precisely what "
            "lets the network remember earlier words in the sentence instead of seeing "
            "each word in isolation.\n\n"
            "ANALOGY:\nA rolling snowball that grows as it travels downhill."
        )

    llm, prompts = _fake_llm(behaviour)
    monkeypatch.setattr(p5, "get_chat_model", lambda **kwargs: llm)

    out = p5.theory_agent_node(_state())

    assert "carried across timesteps" in out["explanation"]
    assert "could not be written up" not in out["explanation"]
    assert len(prompts) == 2
    assert len(prompts[1]) < len(prompts[0]), "the retry must send less context"
    assert p5.DEGRADED_SECTIONS == []


def test_a_failed_call_yields_an_honest_notice_not_invented_notes(monkeypatch):
    """When the model cannot answer, say so and quote the lecture instead."""

    def behaviour(attempt, text):
        raise RuntimeError(RATE_LIMITED)

    llm, _ = _fake_llm(behaviour)
    monkeypatch.setattr(p5, "get_chat_model", lambda **kwargs: llm)

    out = p5.theory_agent_node(_state())
    explanation = out["explanation"]

    assert "could not be written up" in explanation
    assert "per-minute token allowance" in explanation
    # The instructor's own words survive, so the section is still readable.
    assert "hidden state is what lets the network" in explanation
    assert p5.DEGRADED_SECTIONS == ["Hidden State and Sequence Memory"]
    # No mental model is invented to fill the gap either.
    assert out["theory_block"]["analogies"] == []


def test_the_old_fabrication_cannot_return(monkeypatch):
    """The scikit-learn filler must not reappear through any code path."""

    def behaviour(attempt, text):
        raise RuntimeError("Groq API Error 500: upstream failure")

    llm, _ = _fake_llm(behaviour)
    monkeypatch.setattr(p5, "get_chat_model", lambda **kwargs: llm)

    explanation = p5.theory_agent_node(_state())["explanation"]

    for invented in (
        "Scikit-Learn",
        "ColumnTransformer",
        "bias-variance",
        "Precision-Recall curves",
        "train-test split boundaries",
    ):
        assert invented not in explanation
    assert "could not be written up" in explanation


def test_a_missing_key_is_named(monkeypatch):
    """No key is a different situation from a quota, and says so."""
    monkeypatch.setattr(p5, "get_chat_model", lambda **kwargs: None)

    explanation = p5.theory_agent_node(_state())["explanation"]

    assert "could not be written up" in explanation
    assert "no API key is configured" in explanation


def test_helpers_classify_provider_refusals():
    assert p5.is_request_too_large(TOO_LARGE)
    assert not p5.is_request_too_large(RATE_LIMITED)
    assert p5.is_rate_limit(RATE_LIMITED)
    assert not p5.is_rate_limit(TOO_LARGE)
    # Neither classifier may claim a plain outage.
    assert not p5.is_request_too_large("Groq API Error 500")
    assert not p5.is_rate_limit("Groq API Error 500")


def test_a_too_large_request_is_not_advised_to_wait():
    """A 413 and a 429 need opposite advice, and the notice must respect that."""
    advice = p5.advise_on_llm_failure(TOO_LARGE)
    assert "Wait" not in advice
    assert "fewer chapters" in advice
    assert "Wait" in p5.advise_on_llm_failure(RATE_LIMITED)


def test_describe_strips_the_provider_payload():
    """The notice is shown to users, so the raw error must not leak through."""
    described = p5.describe_llm_failure(RATE_LIMITED)
    assert "org_" not in described
    assert "gpt-oss" not in described
    assert "429" not in described
    assert described
