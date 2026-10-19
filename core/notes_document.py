"""A workspace is its notes, not the HTML page it was first drawn into.

Notes used to be persisted as finished HTML: about 226 KB per lecture, more than
half of it the same inlined stylesheet copied once per workspace, and nothing
could be read back out of it without parsing HTML. What is actually worth keeping
is the data the renderer consumed — the chapters, their sections, the timestamps
and the video's own metadata. This module names that document, builds it from a
finished run, and checks it before it is stored, so a workspace saved now can be
rendered again later instead of depending on the file it once produced.

Only the fields `templates/base_workspace.html` reads are copied. A finished run
also holds the transcript, its embeddings and each section's own scratch state;
carrying those into every stored row would multiply storage for data nothing
renders. The transcript is kept where it is needed — in the 24-hour ingest
payload the extension posts — and not copied into the notes.
"""

import json
from typing import Any, Dict, List, Optional

# Version 1 was the rendered HTML file itself. Version 2 is this document.
NOTES_SCHEMA_VERSION = 2

# Exactly what the workspace template reads. Listing them here means a state key
# added to the pipeline later cannot quietly start riding along in storage.
_VIDEO_FIELDS = (
    "video_id",
    "title",
    "channel",
    "duration_str",
    "duration",
    "thumbnail",
)

_CHAPTER_FIELDS = (
    "chapter_id",
    "chapter_order",
    "chapter_title",
    "title",
    "timestamp_str",
    "timestamp_seconds",
    "overview",
    "chapter_summary",
)

_SECTION_FIELDS = (
    "section_id",
    "section_title",
    "section_order",
    "time_reference",
    "timestamp_seconds",
    "theory_block",
    "visual_diagram",
    "visual_diagrams",
    "code_blocks",
    "key_points",
    "examples",
    "pitfalls",
    "supplement_block",
)


def _pick(source: Any, fields: tuple) -> Dict[str, Any]:
    """Copy the named fields that are actually present.

    A missing key is left missing rather than written as None: the template
    already treats absent and empty the same way, and the difference is worth
    keeping in the stored JSON.
    """
    if not isinstance(source, dict):
        return {}
    return {name: source[name] for name in fields if source.get(name) is not None}


def build_notes_document(state: Dict[str, Any]) -> Dict[str, Any]:
    """The storable, re-renderable form of a finished run."""
    chapters: List[Dict[str, Any]] = []
    for chapter in state.get("chapter_contents") or []:
        entry = _pick(chapter, _CHAPTER_FIELDS)
        sections = chapter.get("sections") if isinstance(chapter, dict) else None
        entry["sections"] = [_pick(section, _SECTION_FIELDS) for section in sections or []]
        chapters.append(entry)

    return {
        "schema_version": NOTES_SCHEMA_VERSION,
        "video_id": str(state.get("video_id") or ""),
        "video_metadata": _pick(state.get("video_metadata") or {}, _VIDEO_FIELDS),
        "color_palette": state.get("color_palette") or "dark_academic",
        "suggestive_questions": list(state.get("suggestive_questions") or []),
        "chapters": chapters,
    }


def validate_notes_document(document: Any) -> List[str]:
    """Reasons this document would render as a blank page. An empty list is good.

    The point is to fail at save time, in words, rather than at read time as an
    empty workspace — a reader cannot tell an empty page from a broken one.
    """
    if not isinstance(document, dict) or not document:
        return ["no notes were produced"]

    problems: List[str] = []
    if not document.get("video_id"):
        problems.append("no video id")

    chapters = document.get("chapters")
    if not chapters:
        problems.append("no chapters")
        return problems

    empty = [
        str(c.get("chapter_title") or c.get("title") or "untitled")
        for c in chapters
        if not (isinstance(c, dict) and c.get("sections"))
    ]
    if empty:
        problems.append(
            f"{len(empty)} of {len(chapters)} chapter(s) have no sections: "
            + ", ".join(empty[:3])
        )
    return problems


def coerce_notes_document(stored: Any) -> Optional[Dict[str, Any]]:
    """Read a document that may be jsonb from Postgres or text from a local file."""
    if isinstance(stored, dict):
        return stored or None
    if isinstance(stored, (str, bytes, bytearray)):
        try:
            decoded = json.loads(stored)
        except (ValueError, TypeError):
            return None
        return decoded if isinstance(decoded, dict) else None
    return None


def notes_document_to_json(document: Dict[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False)


def render_notes_html(document: Dict[str, Any]) -> str:
    """Draw the stored notes back into the tri-pane workspace page.

    Imported here rather than at module level so that reading a document and
    rendering it stay separable: a caller that only inspects or validates notes
    does not need the template engine loaded.
    """
    from phase7_renderer import render_workspace_html

    return render_workspace_html(
        video_id=document.get("video_id", ""),
        video_metadata=document.get("video_metadata") or {},
        chapters=document.get("chapters") or [],
        color_palette=document.get("color_palette") or "dark_academic",
        suggestive_questions=document.get("suggestive_questions") or [],
    )
