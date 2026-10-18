"""One model call per section, instead of five agents asking the same transcript.

The old fan-out asked four separate agents one question each — theory, key points,
pitfalls, examples — and a fifth for a diagram. Every one of them re-sent the same
lecture excerpt, and every one had its own hardcoded fallback that invented
content when the call failed. On a provider metering tokens per minute that is
five times the cost for one section's worth of notes, and three extra chances to
fabricate something.

This module asks once, in a shape simple enough that no agent can drift: a short
list of plain headings. The answer is split on those headings, tolerating however
the model decorated them, because a model that writes `**EXPLANATION**` instead of
`EXPLANATION:` has still answered the question — discarding that answer over
punctuation wastes the call that paid for it.
"""

import re
from typing import Any, Dict, List

from core.llm_failures import degraded_section_notice, invoke_reading_transcript
from core.model_router import get_usable_chat_model

LABELS = ("EXPLANATION", "ANALOGY", "KEY POINTS", "PITFALLS", "EXAMPLE")

# Below this, an "explanation" is a stub rather than notes.
MIN_EXPLANATION_CHARS = 150


def _label_pattern(label: str) -> re.Pattern:
    """Match a heading however the model dressed it up, and nothing else.

    Accepts `EXPLANATION`, `EXPLANATION:`, `**EXPLANATION**`, `### Explanation`,
    `KEY POINTS`, `Key-Points`. The line must contain only the heading, so prose
    that merely mentions the words is not mistaken for one.
    """
    joined = r"[ _\-]*".join(re.escape(word) for word in label.split())
    return re.compile(rf"(?im)^[ \t>*#]*\**\s*{joined}\s*\**\s*:?[ \t]*$")


def split_labeled_blocks(text: str) -> Dict[str, str]:
    """Split a model answer on its own headings.

    Returns label -> body, plus `""` for anything written before the first
    heading. Text under a missing heading simply has no entry.
    """
    text = text or ""
    found = []
    for label in LABELS:
        for match in _label_pattern(label).finditer(text):
            found.append((match.start(), match.end(), label))
    found.sort()

    if not found:
        return {"": text.strip()}

    blocks: Dict[str, str] = {}
    if found[0][0] > 0:
        blocks[""] = text[: found[0][0]].strip()
    for index, (_start, end, label) in enumerate(found):
        stop = found[index + 1][0] if index + 1 < len(found) else len(text)
        body = text[end:stop].strip()
        if not blocks.get(label):
            blocks[label] = body
    return blocks


_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")
_NOTHING = {"NONE", "N/A", "NONE.", "NOTHING", "-"}


def _items(block: str, limit: int = 6) -> List[str]:
    """Read a block as a list, whether or not the model used bullets."""
    text = (block or "").strip()
    if not text:
        return []
    items: List[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        bullet = _BULLET.match(line)
        if bullet:
            items.append(bullet.group(1).strip())
        elif items:
            items[-1] = f"{items[-1]} {line}".strip()
        else:
            items.append(line)
    return [i for i in items if i and i.upper() not in _NOTHING][:limit]


def parse_section_composition(text: str) -> Dict[str, Any]:
    """Turn the model's answer into the fields a section is rendered from."""
    blocks = split_labeled_blocks(text or "")
    explanation = (blocks.get("EXPLANATION") or "").strip()
    if not explanation:
        # No recognised heading. If the model still wrote a real answer, it is
        # still grounded notes about this lecture — keep it rather than throw
        # away a call that has already been paid for.
        explanation = (blocks.get("") or "").strip()
    return {
        "explanation": explanation,
        "analogy": (blocks.get("ANALOGY") or "").strip(),
        "key_points": _items(blocks.get("KEY POINTS", "")),
        "pitfalls": _items(blocks.get("PITFALLS", ""), limit=3),
        "examples": _items(blocks.get("EXAMPLE", ""), limit=2),
    }


COMPOSER_PROMPT = (
    "You are writing study notes for one section of a recorded lecture, so that a student "
    "who attended it can revise from your notes alone.\n\n"
    "Write ONLY from the transcript below. Leave out anything the transcript does not cover "
    "rather than filling the gap from general knowledge — a missing point is far better than "
    "an invented one.\n\n"
    'Section: "{title}"\n'
    'Chapter: "{chapter_title}"\n'
    "Subject: {domain}\n\n"
    "Transcript of this part of the lecture:\n---\n{transcript}\n---\n\n"
    "Answer in exactly this shape. Write each heading on its own line, with nothing else on "
    "that line:\n\n"
    "EXPLANATION\n"
    "Three or four short markdown paragraphs on what the instructor taught, in the order they "
    "taught it. Keep their terms and examples.\n\n"
    "ANALOGY\n"
    "One vivid mental model for the central idea of this section.\n\n"
    "KEY POINTS\n"
    "- three to five one-line takeaways, each starting with \"- \"\n\n"
    "PITFALLS\n"
    "- one or two mistakes students make with this material, as \"mistake -> fix\" or \"NONE\"\n\n"
    "EXAMPLE\n"
    "- one concrete example the instructor actually used, or \"NONE\"\n"
)


def _degraded(reason: str, transcript: str) -> Dict[str, Any]:
    return {
        "explanation": degraded_section_notice(reason, transcript),
        "analogy": "",
        "key_points": [],
        "pitfalls": [],
        "examples": [],
        "degraded": True,
    }


def compose_section(
    title: str,
    chapter_title: str,
    transcript: str,
    api_key: str = None,
    model_name: str = None,
    domain: str = "machine_learning",
) -> Dict[str, Any]:
    """Write one section's notes in a single call.

    Returns the render fields plus `degraded`, which is True when the notice was
    used instead of notes so a run can report itself honestly.
    """
    llm = get_usable_chat_model(api_key=api_key, model_name=model_name)
    if not llm:
        return _degraded("no model was available, so no attempt was made", transcript)

    answer, failure = invoke_reading_transcript(
        llm,
        COMPOSER_PROMPT,
        {"title": title, "chapter_title": chapter_title, "domain": domain},
        transcript,
        on_attempt=lambda chars, message: print(
            f"[Composer] {title}: {chars} chars of context refused — {message[:140]}"
        ),
    )
    if not answer:
        return _degraded(failure, transcript)

    parsed = parse_section_composition(answer)
    if len(parsed["explanation"]) < MIN_EXPLANATION_CHARS:
        return _degraded(
            failure or "the model's answer was too short to be usable", transcript
        )
    parsed["degraded"] = False
    return parsed
