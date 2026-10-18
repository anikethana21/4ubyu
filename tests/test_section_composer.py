"""One call per section, and never a word the instructor did not say.

The section fan-out used to ask five agents one question each about the same
excerpt, and each agent had its own canned fallback: an RNN lecture came back
with paragraphs about ColumnTransformers and data leakage because three agents
had failed and were quietly answering with fixed text. On a provider metering
tokens per minute that was also five times the price of one section.

These tests hold the replacement in place: a single call whose answer is split on
the model's own headings, however it decorates them, with an honest notice — and
nothing invented — when the call does not succeed.
"""

import pathlib

import pytest
from langchain_core.runnables import RunnableLambda

import phase5_chapter_agents as p5
from core import section_composer as sc

ANSWER = (
    "**EXPLANATION**\n"
    "### Hidden state\n"
    "The hidden state carries information from earlier timesteps, which is what lets the "
    "network remember the order of words instead of seeing each one alone.\n\n"
    "**ANALOGY**\n"
    "A snowball growing as it rolls downhill.\n\n"
    "**KEY POINTS**\n"
    "- The hidden state is the network's memory\n"
    "- The same weights are reused at every timestep\n\n"
    "**PITFALLS**\n"
    "- Vanishing gradients -> use gating such as an LSTM\n\n"
    "**EXAMPLE**\n"
    "- Predicting the next word in \"the lion roars\"\n"
)

LECTURE = (
    "Recurrent neural networks carry a hidden state from one timestep to the next. "
    "The hidden state is what lets the network remember earlier words. "
) * 40


def _fake_llm(behaviour):
    """A runnable standing in for the provider, counting every call."""
    calls = []

    def _run(prompt_value):
        text = prompt_value.to_string() if hasattr(prompt_value, "to_string") else str(prompt_value)
        calls.append(text)
        return behaviour(len(calls), text)

    return RunnableLambda(_run), calls


@pytest.fixture(autouse=True)
def _clean_record():
    p5.reset_degraded_sections()
    yield
    p5.reset_degraded_sections()


def test_bold_headings_are_accepted(monkeypatch):
    """`**EXPLANATION**` is an answer, not a formatting error.

    Demanding the exact string "EXPLANATION:" once discarded a complete 3,232
    character answer and replaced it with an apology — throwing away both the
    notes and the call that had already been paid for.
    """
    parsed = sc.parse_section_composition(ANSWER)

    assert "hidden state carries information" in parsed["explanation"]
    assert "EXPLANATION" not in parsed["explanation"]
    assert parsed["analogy"] == "A snowball growing as it rolls downhill."
    assert len(parsed["key_points"]) == 2
    assert len(parsed["pitfalls"]) == 1
    assert len(parsed["examples"]) == 1
    assert "ANALOGY" not in parsed["analogy"]


def test_heading_variants_are_all_read_the_same_way():
    for heading in ("EXPLANATION", "EXPLANATION:", "## Explanation", "### EXPLANATION"):
        parsed = sc.parse_section_composition(f"{heading}\nThe lecture explained gating.")
        assert "gating" in parsed["explanation"], heading


def test_an_answer_without_headings_is_kept_not_discarded():
    """If the model ignores the format, its answer is still grounded notes."""
    parsed = sc.parse_section_composition(
        "The instructor spent this section on why a plain network cannot see order."
    )
    assert "cannot see order" in parsed["explanation"]


def test_prose_mentioning_the_headings_is_not_mistaken_for_one():
    """Only a heading on its own line may split the answer."""
    parsed = sc.parse_section_composition(
        "EXPLANATION\n"
        "This lecture gives an explanation of the key points behind gating, and the pitfalls "
        "of forgetting the cell state.\n"
    )
    assert "explanation of the key points behind gating" in parsed["explanation"]


def test_compose_section_asks_the_model_once(monkeypatch):
    llm, calls = _fake_llm(lambda attempt, text: ANSWER)
    monkeypatch.setattr(sc, "get_usable_chat_model", lambda **kwargs: llm)

    out = sc.compose_section(
        title="Hidden State",
        chapter_title="Recurrent Neural Networks",
        transcript=LECTURE,
        api_key="test-key",
    )

    assert len(calls) == 1, "a section costs one call, not five"
    assert out["degraded"] is False
    assert "hidden state carries information" in out["explanation"]
    assert out["key_points"] and out["pitfalls"] and out["examples"]


def test_compose_section_prompt_forbids_writing_beyond_the_transcript():
    assert "Write ONLY from the transcript" in sc.COMPOSER_PROMPT
    # The order the model is asked to answer in must match the parser's labels.
    for label in sc.LABELS:
        assert label in sc.COMPOSER_PROMPT


def test_a_failed_compose_yields_a_notice_and_no_invented_fragments(monkeypatch):
    llm, calls = _fake_llm(
        lambda attempt, text: (_ for _ in ()).throw(
            RuntimeError("Groq API Error 429: rate_limit_exceeded")
        )
    )
    monkeypatch.setattr(sc, "get_usable_chat_model", lambda **kwargs: llm)

    out = sc.compose_section(
        title="Hidden State",
        chapter_title="Recurrent Neural Networks",
        transcript=LECTURE,
    )

    assert out["degraded"] is True
    assert "could not be written up" in out["explanation"]
    assert "carry a hidden state" in out["explanation"], "the lecture itself is quoted back"
    assert out["key_points"] == []
    assert out["pitfalls"] == []
    assert out["examples"] == []
    assert len(calls) == 1, "a spent allowance does not recover by retrying immediately"


def test_a_missing_model_is_not_blamed_on_the_key(monkeypatch):
    monkeypatch.setattr(sc, "get_usable_chat_model", lambda **kwargs: None)

    out = sc.compose_section("Hidden State", "RNNs", LECTURE)

    assert out["degraded"] is True
    assert "no model was available" in out["explanation"]
    assert "no API key is configured" not in out["explanation"]


def test_phase5_lean_path_makes_one_call_and_invents_nothing(monkeypatch):
    seen = []

    def fake_compose_section(**kwargs):
        seen.append(kwargs)
        return {
            "explanation": "The instructor covered gating in detail. " * 10,
            "analogy": "A tap controlling the flow of water.",
            "key_points": ["Gating controls what the memory keeps"],
            "pitfalls": [],
            "examples": [],
            "degraded": False,
        }

    monkeypatch.setattr(p5, "compose_section", fake_compose_section)
    monkeypatch.setattr(p5, "PHASE5_MODE", "lean")

    out = p5.generate_section_sync(
        {
            "section_id": "sec-1",
            "section_title": "Gating",
            "section_order": 1,
            "transcript_slice": LECTURE,
        },
        {"chapter_id": "ch-1", "chapter_title": "Recurrent Neural Networks"},
        "test-key",
        "",
    )

    assert len(seen) == 1, "the lean path must not fall back into the five-agent fan-out"
    assert out["theory_block"]["explanation"].startswith("The instructor covered gating")
    assert out["theory_block"]["analogies"] == ["A tap controlling the flow of water."]
    assert out["key_points"] == ["Gating controls what the memory keeps"]
    # Diagrams and code used to be the two most invention-prone fields.
    assert out["visual_diagrams"] == []
    assert out["code_blocks"] == []
    assert out["examples"] == []
    assert out["pitfalls"] == []


def test_the_canned_scikit_learn_tables_are_gone():
    """The fixed filler must not be recoverable from the module at all."""
    source = pathlib.Path(p5.__file__).read_text(encoding="utf-8")
    for invented in (
        "FALLBACK_ML_CODE",
        "FALLBACK_AGENTIC_CODE",
        "ColumnTransformer",
        "Data Leakage across Validation Split",
        "Production Pattern: In",
    ):
        assert invented not in source, invented
