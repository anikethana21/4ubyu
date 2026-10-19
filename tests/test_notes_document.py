"""A workspace is its notes, so the page can be drawn again later.

Saving the finished page meant storing about 226 KB per lecture — more than half
of it the same inlined stylesheet copied into every workspace — and there was no
way back from it: a stored page cannot be re-rendered when the template improves,
and it cannot be read by anything but a browser. What is kept now is the data the
renderer consumed, and the page is drawn from it on request.

These tests hold the two things that makes safe: the document contains everything
the page needs (and nothing the transcript would add), and it renders to the same
bytes after a round trip through JSON — which is exactly what storage is.
"""

import json
import types

import phase7_renderer as p7
from core import notes_document as nd
from core import workspace_manager as wm


def _state():
    """A finished run, including the things that must not be stored."""
    lecture = "the whole lecture, word for word " * 4000
    return {
        "video_id": "abc123",
        "video_metadata": {
            "title": "Recurrent Networks, Clearly Explained",
            "channel": "StatQuest",
            "duration_str": "16:37",
            "duration": 997,
            "thumbnail": "https://img.youtube.com/vi/abc123/maxresdefault.jpg",
            "description": "a long description that no page renders " * 200,
        },
        "color_palette": "dark_academic",
        "suggestive_questions": ["What is a hidden state?", "Why tanh?"],
        "chapter_contents": [
            {
                "chapter_id": "ch_01",
                "chapter_order": 1,
                "chapter_title": "01. The Hidden State",
                "timestamp_str": "00:00",
                "timestamp_seconds": 0,
                "overview": "How the hidden state carries information forward.",
                "chapter_summary": "Sequence modelling from the ground up.",
                "transcript_slice": lecture,
                "sections": [
                    {
                        "section_id": "sec_01",
                        "section_title": "Gating the hidden state",
                        "time_reference": "00:00",
                        "timestamp_seconds": 0,
                        "theory_block": {
                            "explanation": "The **hidden state** is updated with tanh.",
                            "analogies": ["Like a rolling average of everything read so far."],
                        },
                        "key_points": [
                            "tanh bounds the state",
                            "the previous state still matters",
                        ],
                        "examples": [{"text": "Riya is a doctor has four words."}],
                        "pitfalls": ["Do not mix up h_t and h_{t-1}"],
                        "code_blocks": [],
                        "visual_diagram": None,
                        "visual_diagrams": [],
                        "transcript_slice": lecture,
                    }
                ],
            }
        ],
    }


# ---------------------------------------------------------------------------
# The document holds the notes, and not the lecture
# ---------------------------------------------------------------------------

def test_the_document_keeps_what_the_page_draws():
    document = nd.build_notes_document(_state())

    assert document["schema_version"] == nd.NOTES_SCHEMA_VERSION
    assert document["video_id"] == "abc123"
    assert document["video_metadata"]["title"] == "Recurrent Networks, Clearly Explained"
    assert document["video_metadata"]["duration_str"] == "16:37"

    chapter = document["chapters"][0]
    assert chapter["timestamp_str"] == "00:00"
    assert chapter["overview"].startswith("How the hidden state")

    section = chapter["sections"][0]
    assert section["section_title"] == "Gating the hidden state"
    assert section["key_points"] == ["tanh bounds the state", "the previous state still matters"]
    assert section["theory_block"]["explanation"].startswith("The **hidden state**")


def test_the_transcript_is_not_copied_into_storage():
    """The lecture is the largest thing in a run and nothing renders it."""
    state = _state()
    document = nd.build_notes_document(state)
    stored = nd.notes_document_to_json(document)

    assert "transcript_slice" not in stored
    assert "the whole lecture, word for word" not in stored
    # The state carries ~230 KB of transcript; the notes are a fraction of that.
    assert len(stored) < 4000, len(stored)


def test_unrendered_metadata_does_not_ride_along():
    document = nd.build_notes_document(_state())
    assert "description" not in document["video_metadata"]


# ---------------------------------------------------------------------------
# What is stored can be drawn again
# ---------------------------------------------------------------------------

def test_a_document_survives_json_and_renders_the_same_page():
    document = nd.build_notes_document(_state())

    round_tripped = nd.coerce_notes_document(nd.notes_document_to_json(document))
    assert round_tripped == json.loads(json.dumps(document))

    first = nd.render_notes_html(document)
    second = nd.render_notes_html(round_tripped)
    assert first == second, "the page must be a function of the stored notes"


def test_the_page_reads_everything_the_notes_carry():
    page = nd.render_notes_html(nd.build_notes_document(_state()))

    assert "Recurrent Networks, Clearly Explained" in page
    assert "Gating the hidden state" in page            # section title
    assert "tanh bounds the state" in page              # key point
    assert "<strong>hidden state</strong>" in page      # explanation, rendered
    assert "rolling average" in page                    # analogy
    assert "Riya is a doctor" in page                   # example
    assert "00:00" in page                              # timestamp
    assert "the whole lecture, word for word" not in page


def test_the_chapter_number_is_removed_at_render_time():
    """A derived field, not a stored fact: one copy of the title, not two."""
    document = nd.build_notes_document(_state())
    stored = nd.notes_document_to_json(document)
    assert "chapter_clean_title" not in stored
    assert "explanation_html" not in stored  # derived from the explanation, too

    page = nd.render_notes_html(document)
    assert "The Hidden State" in page


def test_the_page_is_drawn_from_the_document_alone():
    """No pipeline state, no run: exactly the two arguments storage has."""
    document = nd.build_notes_document(_state())
    page = p7.render_workspace_html(
        video_id=document["video_id"],
        video_metadata=document["video_metadata"],
        chapters=document["chapters"],
        color_palette=document["color_palette"],
        suggestive_questions=document["suggestive_questions"],
    )
    assert page == nd.render_notes_html(document)


# ---------------------------------------------------------------------------
# A document that cannot be drawn says so
# ---------------------------------------------------------------------------

def test_a_document_without_chapters_is_reported_in_words():
    assert nd.validate_notes_document(None) == ["no notes were produced"]
    assert nd.validate_notes_document({}) == ["no notes were produced"]

    problems = nd.validate_notes_document({"video_id": "abc123", "chapters": []})
    assert problems == ["no chapters"]


def test_a_chapter_without_sections_is_named_in_the_report():
    document = {
        "video_id": "abc123",
        "chapters": [
            {"chapter_title": "Named but empty", "sections": []},
            {"chapter_title": "Fine", "sections": [{"section_title": "A"}]},
        ],
    }
    problems = nd.validate_notes_document(document)
    assert len(problems) == 1
    assert "1 of 2 chapter(s) have no sections" in problems[0]
    assert "Named but empty" in problems[0]


def test_a_stored_document_is_read_from_jsonb_text_or_not_at_all():
    assert nd.coerce_notes_document({"a": 1}) == {"a": 1}
    assert nd.coerce_notes_document('{"a": 1}') == {"a": 1}
    assert nd.coerce_notes_document(b'{"a": 1}') == {"a": 1}
    for junk in (None, "", "not json", "[]", 0, []):
        assert nd.coerce_notes_document(junk) is None, junk


# ---------------------------------------------------------------------------
# Storage keeps the notes, and reads them back as a page
# ---------------------------------------------------------------------------

class _Query:
    def __init__(self, client):
        self.client = client
        self.mode = None
        self.filters = {}
        self.payload = None

    def insert(self, record):
        self.mode = "insert"
        self.payload = record
        return self

    def select(self, *args, **_kwargs):
        self.mode = "select"
        self.client.selected_columns = args[0] if args else None
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.mode == "insert":
            self.client.inserted.append(self.payload)
            self.client.rows.append(self.payload)
            return types.SimpleNamespace(data=[self.payload])
        rows = [
            row
            for row in self.client.rows
            if all(row.get(key) == value for key, value in self.filters.items())
        ]
        return types.SimpleNamespace(data=rows)


class _Client:
    """Enough of the Supabase client to save and read a workspace."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.inserted = []
        self.storage_used = False
        self.selected_columns = None

    def table(self, _name):
        return _Query(self)

    @property
    def storage(self):
        self.storage_used = True
        raise AssertionError("the page is drawn from data, not fetched as a file")


def _isolated(tmp_path, monkeypatch, rows=None):
    client = _Client(rows)
    monkeypatch.setattr(wm, "get_supabase_client", lambda: client)
    monkeypatch.setattr(wm, "STORAGE_USERS_DIR", tmp_path / "users")
    return client


def _save(document, user_id="user-A"):
    return wm.save_user_workspace(
        user_id=user_id,
        youtube_url="https://www.youtube.com/watch?v=abc123",
        video_id="abc123",
        video_title="Recurrent Networks, Clearly Explained",
        channel_name="StatQuest",
        duration="16:37",
        chapter_count=1,
        notes_document=document,
    )


def test_a_saved_workspace_stores_notes_not_a_page(tmp_path, monkeypatch):
    client = _isolated(tmp_path, monkeypatch)
    meta = _save(nd.build_notes_document(_state()))

    assert len(client.inserted) == 1
    record = client.inserted[0]
    assert record["id"] == meta["workspace_id"]
    assert record["notes_schema_version"] == nd.NOTES_SCHEMA_VERSION
    assert record["notes_data"]["chapters"][0]["sections"][0]["section_title"] == "Gating the hidden state"

    # Nothing that only makes sense for a stored file.
    assert "storage_path" not in record
    assert "compiled_html" not in record
    assert client.storage_used is False

    local = tmp_path / "users" / "user-A" / "workspaces" / f"{meta['workspace_id']}.json"
    assert local.exists()
    assert local.read_text(encoding="utf-8").startswith("{")


def test_a_stored_workspace_is_drawn_again_from_its_notes(tmp_path, monkeypatch):
    client = _isolated(tmp_path, monkeypatch)
    document = nd.build_notes_document(_state())
    meta = _save(document)

    # Simulate a fresh machine: only the row survives.
    local = tmp_path / "users" / "user-A" / "workspaces" / f"{meta['workspace_id']}.json"
    local.unlink()

    page = wm.get_user_workspace_html(meta["workspace_id"], "user-A")

    assert page is not None
    assert "Gating the hidden state" in page
    assert "tanh bounds the state" in page
    assert local.exists(), "a re-rendered page is cached as notes, not as HTML"


def test_another_user_cannot_read_a_workspace(tmp_path, monkeypatch):
    _isolated(tmp_path, monkeypatch)
    meta = _save(nd.build_notes_document(_state()))

    assert wm.get_user_workspace_html(meta["workspace_id"], "user-B") is None


def test_a_workspace_saved_before_this_change_still_opens(tmp_path, monkeypatch):
    """Those rows hold a page instead of notes; opening it is still possible."""
    workspace_id = "11111111-1111-1111-1111-111111111111"
    _isolated(
        tmp_path,
        monkeypatch,
        rows=[{"id": workspace_id, "user_id": "user-A", "video_id": "abc123"}],
    )
    legacy = tmp_path / "users" / "user-A" / "workspaces" / f"{workspace_id}.html"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_text("<html>a page saved before</html>", encoding="utf-8")

    page = wm.get_user_workspace_html(workspace_id, "user-A")

    assert page == "<html>a page saved before</html>"


def test_the_local_library_lists_workspaces_by_their_real_title(tmp_path, monkeypatch):
    """With no database, the folder of notes is the library."""
    monkeypatch.setattr(wm, "get_supabase_client", lambda: None)
    monkeypatch.setattr(wm, "STORAGE_USERS_DIR", tmp_path / "users")
    meta = _save(nd.build_notes_document(_state()))

    listed = wm.list_user_workspaces("user-A")

    assert [w["id"] for w in listed] == [meta["workspace_id"]]
    assert listed[0]["video_title"] == "Recurrent Networks, Clearly Explained"
    assert listed[0]["channel_name"] == "StatQuest"
    assert listed[0]["chapter_count"] == 1


def test_listing_workspaces_does_not_download_every_lecture(tmp_path, monkeypatch):
    """The notes are the bulk of a row, and a library list does not render them."""
    client = _isolated(tmp_path, monkeypatch)
    _save(nd.build_notes_document(_state()))

    listed = wm.list_user_workspaces("user-A")

    assert [w["video_title"] for w in listed] == ["Recurrent Networks, Clearly Explained"]
    assert client.selected_columns, "the listing must name its columns"
    assert "notes_data" not in client.selected_columns
