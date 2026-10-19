/**
 * The notes page, and the document it is drawn from.
 *
 * Two things are worth pinning here. The document is the thing that outlives the
 * page — it is what a library keeps and what a future renderer would read — so its
 * shape is tested rather than assumed. And the page has to be honest: a section
 * that could not be written up must look different from one that was, and a run
 * that degraded must say so at the top rather than leaving the reader to notice a
 * missing paragraph.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../../extension/src/core.js");
const workspace = require("../../extension/src/workspace.js");
const assets = require("../../extension/src/assets.js");

/** A run shaped like the one `writeChapter` produces. */
function sampleChapters() {
  return [
    {
      title: "Chapter 2: Gating the Hidden State",
      timestamp_seconds: 7020,
      summary: "",
      sections: [
        {
          title: "Forget, Input and Output Gates",
          timestamp_seconds: 7080,
          explanation:
            "The **forget gate** decides what leaves the cell state.\n\n\\[ f_t = \\sigma(W_f h_{t-1}) \\]",
          analogy: "A water filter that keeps the clean part.",
          key_points: ["the cell state carries long-term memory", "each gate has its own weights"],
          pitfalls: ["confusing h_t with c_t -> keep the two names separate"],
          examples: ["the sentence “Riya is a doctor”"],
          degraded: false,
        },
        {
          title: "Backpropagation Through Time",
          timestamp_seconds: 7500,
          explanation:
            "### This section could not be written up\n\n**Why:** the provider's daily token allowance for this model is spent.",
          key_points: [],
          pitfalls: [],
          examples: [],
          degraded: true,
        },
      ],
    },
  ];
}

function sampleDocument() {
  return workspace.buildNotesDocument({
    video: {
      video_id: "0Q4yhrkwn7c",
      title: "Deep Learning Complete Course | Part 3",
      channel: "CampusX",
      duration_str: "2:10:00",
    },
    chapters: sampleChapters(),
    meta: { provider: "groq", model: "openai/gpt-oss-120b", generated_at: "2026-10-19T06:30:00.000Z" },
  });
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

test("a run becomes a document with the fields the page reads, and no more", () => {
  const document = sampleDocument();

  assert.equal(document.schema_version, 2);
  assert.equal(document.video_id, "0Q4yhrkwn7c");
  assert.equal(document.video_metadata.channel, "CampusX");
  assert.equal(document.chapters.length, 1);

  const chapter = document.chapters[0];
  assert.equal(chapter.chapter_id, "chapter-1", "ids are made when the run does not have them");
  assert.equal(chapter.chapter_order, 1);
  assert.equal(chapter.timestamp_str, "1:57:00");

  const section = chapter.sections[0];
  assert.equal(section.section_id, "chapter-1-section-1");
  assert.equal(section.section_title, "Forget, Input and Output Gates");
  assert.equal(section.time_reference, "1:58:00");
  assert.equal(section.theory_block.explanation.includes("forget gate"), true);
  assert.deepEqual(section.theory_block.analogies, ["A water filter that keeps the clean part."]);
  assert.deepEqual(section.examples, [{ text: "the sentence “Riya is a doctor”" }]);

  assert.equal(chapter.sections[1].degraded, true);
});

test("the document never carries the transcript, which is the expensive part", () => {
  const document = sampleDocument();
  const json = workspace.notesDocumentToJson(document);
  assert.doesNotMatch(json, /transcript/i);
  assert.ok(json.length < 4000, `a one-chapter document stays small: ${json.length} chars`);
});

test("a redundant chapter label is not shown twice", () => {
  assert.equal(workspace.displayTitle("Chapter 2: Gating the Hidden State", 2), "Gating the Hidden State");
  assert.equal(workspace.displayTitle("Chapter 7 - Long Short-Term Memory", 7), "Long Short-Term Memory");
  assert.equal(workspace.displayTitle("Gating the Hidden State", 2), "Gating the Hidden State");
  assert.equal(workspace.displayTitle("Chapter 2", 2), "Chapter 2", "a title that is only a label is left alone");
});

test("a document that would render blank is refused in words", () => {
  assert.deepEqual(workspace.validateNotesDocument(null), ["no notes were produced"]);
  assert.deepEqual(workspace.validateNotesDocument({ chapters: [{ sections: [] }] }), [
    "no video id",
    "1 of 1 chapter(s) have no sections: untitled",
  ]);
  assert.deepEqual(workspace.validateNotesDocument({ video_id: "x", chapters: [] }), ["no chapters"]);
  assert.deepEqual(workspace.validateNotesDocument({ video_id: "x", chapters: [{ sections: [] }] }), [
    "1 of 1 chapter(s) have no sections: untitled",
  ]);
  assert.deepEqual(workspace.validateNotesDocument(sampleDocument()), []);
});

test("a document read back from storage is accepted in either shape", () => {
  const document = sampleDocument();
  assert.equal(workspace.coerceNotesDocument(document), document);
  assert.equal(workspace.coerceNotesDocument(JSON.stringify(document)).video_id, "0Q4yhrkwn7c");
  assert.equal(workspace.coerceNotesDocument("not json"), null);
  assert.equal(workspace.coerceNotesDocument({}), null);
  assert.equal(workspace.coerceNotesDocument("[1,2]"), null);
  assert.equal(workspace.coerceNotesDocument(null), null);
});

test("which sections are notices rather than notes is answerable from the document", () => {
  assert.deepEqual(workspace.degradedSections(sampleDocument()), [
    "Chapter 2: Gating the Hidden State › Backpropagation Through Time",
  ]);
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Render without the 128 KB stylesheet; the page's shape is what is under test. */
function renderWithoutStylesheet(document) {
  return workspace.renderNotesHtml(document, { css: "" });
}

test("the page is one self-contained file", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<div data-video-id="0Q4yhrkwn7c" id="yt-player-frame"><\/div>/);
  assert.match(html, /<script src="https:\/\/www\.youtube\.com\/iframe_api"><\/script>/);
  assert.match(html, /id="notes-search"oninput|<input id="notes-search"/);
  assert.match(html, /id="tab-btn-notes"/);
  assert.match(html, /id="tab-btn-video"/);
});

test("the page shows the notes, the timestamps and the takeaways", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Chapter 2: Gating the Hidden State/, "the chapter is titled");
  assert.match(html, /Gating the Hidden State<\/h2>/, "without repeating the label");
  assert.match(html, /<strong>forget gate<\/strong>/, "the explanation is rendered markdown");
  assert.match(html, /class="math-display-card"/, "and the equation is left for MathJax");
  assert.match(html, /the cell state carries long-term memory/, "key points are shown");
  assert.match(html, /onclick="seekVideo\(7080\)"/, "a timestamp seeks the video");
  assert.match(html, /▶ 1:58:00/);
});

test("pitfalls are shown, which the server's page never did", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Common Mistakes/);
  assert.match(html, /confusing h_t with c_t/);
});

test("a section that could not be written up is marked as such, in place and at the top", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /<span class="degraded-badge">Not written up<\/span>/);
  assert.match(html, /class="notes-banner"/);
  assert.match(html, /1 of 2 sections could not be written up/);
  assert.match(html, /Nothing was invented to fill them in/);
});

test("the page carries no assistant, because there is no server to answer it", () => {
  // Scoped to the page's own markup: the inlined controller still mentions the
  // assistant defensively (`if (chatPane) { ... }`), which is right — it should not
  // throw on a page that has no chat pane, and it does not assume one exists.
  const html = renderWithoutStylesheet(sampleDocument());
  const markup = html.split("<script")[0];
  assert.doesNotMatch(markup, /class="chat-pane"/);
  assert.doesNotMatch(markup, /id="chat-query"/);
  assert.doesNotMatch(markup, /Ask AI/);
  assert.doesNotMatch(markup, /Current Frame/);
});

test("every section is reachable from the table of contents", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(document);
  for (const chapter of document.chapters) {
    assert.match(html, new RegExp(`href="#${chapter.chapter_id}"`));
    for (const section of chapter.sections) {
      assert.match(html, new RegExp(`id="${section.section_id}"`));
    }
  }
});

test("a title from a stranger's video cannot become markup", () => {
  const document = sampleDocument();
  document.video_metadata.title = '<script>alert(1)</script>';
  document.chapters[0].chapter_title = '"><img src=x onerror=alert(1)>';
  const html = renderWithoutStylesheet(document);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;/);
});

test("a document with no video id still renders, and says there is nothing to play", () => {
  const document = sampleDocument();
  document.video_id = "";
  document.video_metadata = { title: "Untitled" };
  const html = renderWithoutStylesheet(document);
  assert.match(html, /nothing to play beside the notes/);
  assert.match(html, /<h1 class="video-title">Untitled<\/h1>/);
});

test("the full page ships the stylesheet and the scripts that make it live", () => {
  const html = workspace.renderNotesHtml(sampleDocument());
  assert.match(html, /<style id="4ubyu-workspace-stylesheet">/);
  assert.match(html, /glassmorphic|backdrop-filter|--theme-accent/, "the real stylesheet is in there");
  assert.match(html, /function seekVideo\(/, "the player controller is inlined");
  assert.match(html, /window.toggleSidebar = function/, "the pane splitter is inlined");
  assert.match(html, /window.seekVideoTo = window.seekVideo/, "and the search index's jump works");
  assert.match(html, /class ConstellationGrid|constellation/i, "the background is inlined");
  assert.ok(html.length > 100000, `a self-contained page is large but complete: ${html.length}`);
});

test("the stylesheet comes from the template, and says which revision", () => {
  assert.ok(assets.WORKSPACE_CSS.length > 100000);
  assert.match(assets.SOURCE.css_sha256_12, /^[0-9a-f]{12}$/);
  assert.equal(assets.SOURCE.css_blocks, 5);
  assert.match(workspace.renderNotesHtml(sampleDocument()), new RegExp(assets.SOURCE.css_sha256_12));
});

test("the stylesheet carries the files it points at instead of a path to a server", () => {
  // The brand font is the only local file the stylesheet referenced, and on a
  // downloaded page `/static/fonts/...` is a 404. It is embedded as a data URI.
  assert.doesNotMatch(assets.WORKSPACE_CSS, /url\(["']?\/static\//, "no server paths survive");
  assert.match(assets.WORKSPACE_CSS, /url\("data:font\/woff2;base64,[A-Za-z0-9+/=]{100,}"\)/);
  assert.ok(
    assets.SOURCE.embedded.some((entry) => entry.path === "/static/fonts/gagalin-regular.woff2"),
    "and the generator recorded what it embedded"
  );
});

test("focus mode and the button that undoes it are actually wired", () => {
  // `toggleSidebar` toggles `sidebar-collapsed`; the template answered that class
  // nowhere, so the button had no effect. These rules are what make it mean
  // something, so a rename of the class has to fail here rather than silently
  // leave a dead button in the notes page.
  const css = workspace.PAGE_STYLE;
  assert.match(css, /#app-workspace\.sidebar-collapsed #handbook-pane \{[^}]*flex: 1 1 100%/);
  assert.match(css, /#app-workspace\.sidebar-collapsed \.right-column,[^}]*#v-resizer \{ display: none !important; \}/);
  assert.match(css, /#app-workspace #floating-companion-fab \{ display: none !important; \}/);
  assert.match(css, /#app-workspace\.sidebar-collapsed #floating-companion-fab \{ display: inline-flex !important; \}/);
  assert.match(css, /#app-workspace #mobile-nav-bar \{ display: none !important; \}/);
});

test("a page opened without an origin creates its own player, and explains a refusal in words", () => {
  // Verified against a real refusal in an origin-less page: the embed reports
  // `embedder.identity.missing.referrer` and the pane would otherwise sit there
  // looking broken for a reason nobody can see. The page checks for that and says
  // it, which is the difference between a broken product and a limited one.
  const epilogue = workspace.PAGE_EPILOGUE;
  assert.match(epilogue, /window\.location\.origin === "null"/, "it knows when it has no origin");
  assert.match(epilogue, /ytPlayer = new window\.YT\.Player/, "and creates the player itself");
  assert.doesNotMatch(epilogue, /origin: window\.location\.origin/, "without handing YouTube a null origin");
  assert.match(epilogue, /data\.errorCode/, "it asks the player whether the embed was refused");
  assert.match(epilogue, /explainRefusedEmbed/);
  assert.match(epilogue, /refused to play inside a page opened from disk/);
  assert.match(epilogue, /youtube\.com\/watch\?v=/, "and offers the link that does work");
  assert.match(epilogue, /button\[data-seconds\]/, "the timestamps keep doing something useful");
  assert.match(epilogue, /"&t=" \+ at \+ "s"/, "by opening the lecture at their own second");
  assert.match(epilogue, /btn-sync-toggle/, "and the player-only controls stand down");
  assert.match(workspace.PAGE_STYLE, /\.embed-refused \{/);
});

// ---------------------------------------------------------------------------
// The real output of the pipeline, if it is on this machine
// ---------------------------------------------------------------------------

const OUT_DIR = path.join(__dirname, "..", "..", "extension", "dev", "out");

/** The newest saved notes on this machine, whatever the run was called. */
function newestSavedNotes() {
  if (!fs.existsSync(OUT_DIR)) return null;
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((name) => /^notes-.*\.json$/.test(name))
    .map((name) => path.join(OUT_DIR, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return files.length ? files[0] : null;
}

test("a chapter the pipeline actually wrote renders with nothing missing", (t) => {
  const saved = newestSavedNotes();
  if (!saved) {
    t.skip("no recorded pipeline output on this machine");
    return;
  }
  const value = JSON.parse(fs.readFileSync(saved, "utf8"));
  // A saved run is a notes document. An earlier one may still be a run's output,
  // which is the same data before it was given a video and a chapter to hang on.
  const document = Array.isArray(value.chapters)
    ? value
    : workspace.buildNotesDocument({
        video: { video_id: "a3b72fed", title: value.title, channel: "CampusX" },
        chapters: [{ title: value.title, timestamp_seconds: 7020, sections: value.sections }],
        meta: { provider: "groq" },
      });

  assert.deepEqual(workspace.validateNotesDocument(document), []);
  const html = workspace.renderNotesHtml(document, { css: "" });
  // Only the page's own markup: the inlined controller legitimately writes
  // `secSeconds !== undefined` internally, and that is not a hole in the page.
  const markup = html.split("<script")[0];
  assert.doesNotMatch(markup, /undefined/, "no template left a hole");
  assert.doesNotMatch(markup, /\[object Object\]/);
  for (const section of document.chapters[0].sections) {
    assert.match(html, new RegExp(`id="${section.section_id}"`));
  }
  assert.equal(core.clock(7020), "1:57:00");
});
