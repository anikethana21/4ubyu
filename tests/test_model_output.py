"""Reading a model's numbered answer, and not inventing names when it gives none.

Two related failures lived here. A batched answer is decorated — `**1. Title**`,
`### 1) Title` — and the strict pattern that read it accepted only `1. Title`, so
every real section title was dropped and a canned one took its place. The canned
names were the worse half: a keyword table that answered "Core Foundations &
Practical Implementation" for anything machine-learning, so an RNN lecture came
back with sections named after exploratory data analysis.
"""

import pathlib

import phase4_structure as p4
from core.model_output import numbered_items


def test_plain_numbered_lines_are_read():
    items = numbered_items("1. Hidden state\n2. Gating\n3. Backpropagation through time")
    assert items == {1: "Hidden state", 2: "Gating", 3: "Backpropagation through time"}


def test_bold_and_headed_numbers_are_read_the_same_way():
    """The decoration is what the old parser choked on."""
    for text in (
        "**1. Hidden state**\n**2. Gating**",
        "### 1) Hidden state\n### 2) Gating",
        "- 1. Hidden state\n- 2. Gating",
        "> 1. Hidden state\n> 2. Gating",
        "1: Hidden state\n2: Gating",
        "1 - Hidden state\n2 - Gating",
    ):
        assert numbered_items(text)[1] == "Hidden state", text
        assert numbered_items(text)[2] == "Gating", text


def test_a_number_inside_a_sentence_is_not_a_list_item():
    """The prompt is full of 'Sub-Section 1 (0:00 - 1:00):' style text."""
    items = numbered_items(
        "Sub-Section 1 (00:00 - 05:00):\n"
        "No transcript excerpt\n"
        "Section 2 of the chapter covers gating\n"
    )
    assert items == {}


def test_the_first_answer_for_a_number_wins():
    items = numbered_items("1. Hidden state\n1. Something the model added later")
    assert items[1] == "Hidden state"


def test_a_number_beyond_the_batch_is_ignored_by_the_caller():
    items = numbered_items("1. Hidden state\n7. A title for another batch")
    assert 1 in items and 7 in items  # numbering is honoured, not position


def test_a_section_falls_back_to_the_chapters_real_name():
    """No canned suffix, and nothing that pretends to be a topic name."""
    assert (
        p4.derive_grounded_section_title("Recurrent network mechanics", "machine_learning", "Course")
        == "Recurrent network mechanics"
    )
    assert p4.derive_grounded_section_title("04. Long Short-Term Memory", "machine_learning", "Course") == (
        "Long Short-Term Memory"
    )
    assert p4.derive_grounded_section_title("", "general_tech", "Course") == "Overview"


def test_the_canned_section_name_tables_are_gone():
    source = pathlib.Path(p4.__file__).read_text(encoding="utf-8")
    for invented in (
        "ML_TOPIC_SYNTHESIS",
        "AGENTIC_TOPIC_SYNTHESIS",
        "Core Foundations & Practical Implementation",
        "Exploratory Data Analysis & Visual Diagnostics",
        "Mathematical Formulations & Statistical Foundations",
        "Diagnostics, Edge Cases & Production Patterns",
    ):
        assert invented not in source, invented
