"""A model failure message must never become a chapter name.

Without a usable key the model router hands back a stub that answers every
prompt with a "[Study Assistant Notice]" block. That first line was accepted as
a chapter title, so a four-hour lecture came back as 34 identically named
chapters and nothing anywhere said that titling had failed.
"""

from core.topic_chapterizer import _ensure_usable_titles, is_placeholder_title


def test_fallback_notice_is_not_a_title():
    assert is_placeholder_title("> **[Study Assistant Notice]**")
    assert is_placeholder_title("[Study Assistant Notice]")
    assert is_placeholder_title("Temporary inference delay")


def test_clock_times_are_not_titles():
    assert is_placeholder_title("00:00")
    assert is_placeholder_title("58:45")
    assert is_placeholder_title("01:59:45")
    # The duration splitter names split parts after the raw timestamp, and the
    # "(Part n)" suffix must not hide the placeholder underneath it.
    assert is_placeholder_title("58:45 (Part 1)")
    assert is_placeholder_title("01:59:45 (Part 2)")


def test_markdown_and_empty_values_are_not_titles():
    assert is_placeholder_title("**Important**")
    assert is_placeholder_title("# Heading")
    assert is_placeholder_title("")
    assert is_placeholder_title(None)
    assert is_placeholder_title("ab")


def test_real_topics_survive():
    for title in (
        "Backpropagation and Gradient Descent",
        "API Key Management",
        "RNN Implementation in PyTorch",
        "Attention Mechanisms",
        "Section-by-Section Walkthrough of a Transformer",
    ):
        assert not is_placeholder_title(title), title


def test_a_bare_section_number_is_not_a_topic_name():
    """It is the label this chapterizer gives a chapter it could not name."""
    assert is_placeholder_title("Section 4")
    assert is_placeholder_title("section 12")
    assert is_placeholder_title("Section 4 (Part 1)")


def test_ensure_usable_titles_replaces_only_placeholders():
    segments = [
        {"title": "00:00", "timestamp_str": "00:00"},
        {"title": "Attention Mechanisms", "timestamp_str": "05:00"},
        {"title": "58:45 (Part 1)", "timestamp_str": "58:45"},
    ]

    out = _ensure_usable_titles(segments)

    assert [s["title"] for s in out] == [
        "Section 1",
        "Attention Mechanisms",
        "Section 3",
    ]
    assert [s["title_source"] for s in out] == ["fallback", "llm", "fallback"]
