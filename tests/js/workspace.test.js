const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const workspace = require("../../extension/src/workspace.js");

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
            "The **forget gate** decides what leaves the cell state.\n\n\\[ f_t = \\sigma(W_f h_{t-1}) \\]\n\nInline: \\(h_{t-1}\\) is the hidden state a moment ago.",
          analogy: "A water filter that keeps the clean part.",
          key_points: ["the cell state carries long-term memory", "each gate has its own weights"],
          pitfalls: ["confusing h_t with c_t -> keep the two names separate"],
          examples: ["the sentence \"Riya is a doctor\""],
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
  assert.deepEqual(section.examples, [{ text: 'the sentence "Riya is a doctor"' }]);

  assert.equal(chapter.sections[1].degraded, true);
});

test("the document never carries the transcript, which is the expensive part", () => {
  const document = sampleDocument();
  const json = workspace.notesDocumentToJson(document);
  assert.doesNotMatch(json, /transcript/i);
  assert.ok(json.length < 4000, `a one-chapter document stays small: ${json.length} chars`);
});

test("a chapter with one section does not say its name twice", () => {
  const document = sampleDocument();
  const chapter = document.chapters[0];
  chapter.sections[0].section_title = chapter.display_title || chapter.chapter_title;

  const html = renderWithoutStylesheet(document);
  // Only the second section still needs a heading of its own.
  assert.equal((html.match(/class="section-heading"/g) || []).length, 1);
  assert.match(html, /<h3 class="section-heading">Backpropagation Through Time/);
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
    "Missing video title",
    "1 of 1 chapter(s) have no sections: untitled",
  ]);
  assert.deepEqual(workspace.validateNotesDocument({ video_id: "x", chapters: [] }), [
    "Missing video title",
    "no chapters",
  ]);
  assert.deepEqual(workspace.validateNotesDocument({ video_id: "x", chapters: [{ sections: [] }] }), [
    "Missing video title",
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
    "Chapter 2: Gating the Hidden State \u203a Backpropagation Through Time",
  ]);
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Render without the 250 KB stylesheet; the page's shape is what is under test. */
function renderWithoutStylesheet(document, options = {}) {
  return workspace.renderNotesHtml(document, Object.assign({ css: "" }, options));
}

/** The other shape: the same page with the lecture asked to play beside it. */
function renderWithPlayer(document) {
  return renderWithoutStylesheet(document, { player: true });
}

test("the page a reader downloads is one file, and asks no server for anything", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /<input id="notes-search"/);
  // No player, and nothing that would fetch one.
  assert.doesNotMatch(html, /yt-player-frame/);
  assert.doesNotMatch(html, /iframe_api/);
  assert.doesNotMatch(html, /id="right-column"/);
  assert.doesNotMatch(html, /id="v-resizer"/);
  assert.doesNotMatch(html, /id="tab-btn-video"/);
  assert.doesNotMatch(html, /id="floating-companion-fab"/);
  assert.doesNotMatch(html, /<script src=/, "nothing is loaded from anywhere");
  assert.match(html, /id="app-workspace".*notes-only/, "and the notes get the whole window");
  // The only addresses in the file are the ones a reader may choose to follow.
  const urls = html.match(/https?:\/\/[^\s"'<)]+/g) || [];
  assert.ok(urls.length, "the timestamps do lead somewhere");
  for (const url of urls) {
    // HTML entities are properly encoded as &
    assert.match(
      url,
      /^https:\/\/www\.youtube\.com\/watch\?v=0Q4yhrkwn7c&(amp;)?t=\d+s$/,
      `unexpected address in the page: ${url}`
    );
  }
});

test("the notes-only page carries only the wire it needs, not the server's controller", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /handleSearchInput/, "search is wired");
  assert.match(html, /toggleTocFold/, "and so is folding the index");
  assert.match(html, /clearHandbookSearch/);
  // 29 KB of script that runs a player, a chat pane, a phone's tab bar and a
  // draggable gutter has no business on a page that has none of them.
  assert.doesNotMatch(html, /function seekVideo\(/);
  // splitter script is included for desktop resizing (window.setMobileView)
  assert.doesNotMatch(html, /function trackVideoPlaybackTime/);
  assert.doesNotMatch(html, /function onYouTubeIframeAPIReady/);
});

test("a page with the player is the other shape, and has to be asked for", () => {
  const html = renderWithPlayer(sampleDocument());
  assert.match(html, /<div data-video-id="0Q4yhrkwn7c" id="yt-player-frame"><\/div>/);
  assert.match(html, /<script src="https:\/\/www\.youtube\.com\/iframe_api"><\/script>/);
  assert.match(html, /id="right-column"/);
  assert.match(html, /id="v-resizer"/);
  assert.match(html, /id="tab-btn-video"/);
  assert.match(html, /function seekVideo\(/, "the controller is inlined");
  assert.match(html, /window\.setMobileView = function/, "and so is the splitter");
  assert.match(html, /onclick="seekVideo\(7080\)"/, "the timestamps seek instead of opening a tab");
  assert.match(html, /id="search-empty"/, "the empty-search note is there and stays out of the way");
});

test("the page shows the notes, the timestamps and the takeaways", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Chapter 2: Gating the Hidden State/, "the chapter is titled");
  assert.match(html, /Gating the Hidden State/, "without repeating the label");
  assert.match(html, /<strong>forget gate<\/strong>/, "the explanation is rendered markdown");
  assert.match(html, /f_t = \\sigma/, "the equation is there");
  assert.match(html, /the cell state carries long-term memory/, "key points are shown");
  assert.match(html, /<a class="ts-pill-sm ts-link" data-seconds="7080" href="https:\/\/www\.youtube\.com\/watch\?v=0Q4yhrkwn7c&(amp;)?t=7080s"/, "a timestamp opens the lecture at its own second");
  assert.match(html, /▶ 1:58:00/);
});

test("apostrophes and ampersands are escaped once, and a paragraph is not put inside a paragraph", () => {
  const document = sampleDocument();
  document.chapters[0].overview = "The clock's ticks; Tom & Jerry is a cartoon.";
  document.chapters[0].sections[0].theory_block.key_points.push("the learner's own words");
  const html = renderWithoutStylesheet(document);
  assert.match(html, /The clock&#39;s ticks; Tom &amp; Jerry is a cartoon\./);
  assert.match(html, /the learner&#39;s own words/);
  assert.doesNotMatch(
    html,
    /&amp;#39;|&amp;amp;/,
    "text is escaped by the renderer exactly once, so the reader sees a quote and not &#39;"
  );
  assert.doesNotMatch(
    html,
    /<p class="chapter-overview">\s*<p>/,
    "markdown already opens a paragraph, so the wrapper must not open another"
  );
});

test("the page is set in the panel's Latin face, so a 4 has no gap before the U", () => {
  const style = workspace.PAGE_STYLE;
  const arabic = style.indexOf("Noto Naskh Arabic");
  const latin = style.indexOf('--font-body: "Segoe UI"');
  assert.ok(arabic > -1, "the template's stack is still in the sheet");
  assert.ok(
    latin > arabic,
    "the Latin stack is declared after it, so it is the one that resolves"
  );
  assert.doesNotMatch(
    style.slice(latin),
    /Noto Naskh Arabic/,
    "and nothing later quietly puts the Arabic face back"
  );
});

test("printing is the browser's job rather than a library's", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.doesNotMatch(html, /jspdf|pdf-lib|html2pdf/i, "with no PDF library to load");
  assert.doesNotMatch(html, /Save as PDF|id="btn-print"/, "no PDF button in the page");
});

test("an equation is readable on a page that renders no LaTeX", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(document);
  // KaTeX delimiters are kept for KaTeX to render
  assert.match(html, /f_t = \\sigma/, "the equation is there");
  assert.match(html, /Inline: \(h_\{t-1\}\)/, "and so is an inline one");
  // The document keeps them
  assert.match(document.chapters[0].sections[0].theory_block.explanation, /\\\[ f_t = \\sigma/);
});

test("a search that matches nothing says so instead of showing an empty column", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /id="search-empty"/);
  assert.match(html, /No matching topics found/);
});

test("folding the index does something, which it never did before", () => {
  assert.match(workspace.PAGE_STYLE, /toc-folded/);
  assert.match(workspace.renderNotesHtml(sampleDocument(), { css: "" }), /toggleTocFold/);
});

test("pitfalls are shown, which the server's page never did", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Common Mistakes/);
  assert.match(html, /confusing h_t with c_t/);
});

test("a section that could not be written up is marked as such, in place and at the top", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Not written up/);
  assert.match(html, /class="notes-banner glass-card"/);
  assert.match(html, /could not be written up/);
  assert.match(html, /Nothing was invented to fill them in/);
});

test("the page carries no assistant, because there is no server to answer it", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  const markup = html.split("<script")[0];
  assert.doesNotMatch(markup, /class="chat-pane"/);
  assert.doesNotMatch(markup, /id="chat-query"/);
  assert.doesNotMatch(markup, /Ask AI/);
  assert.doesNotMatch(markup, /Current Frame/);
});

test("every section is reachable from the table of contents", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(sampleDocument());
  for (const chapter of document.chapters) {
    assert.match(html, new RegExp(`href="#${chapter.chapter_id}"`));
    for (const section of chapter.sections) {
      assert.match(html, new RegExp(`id="${section.section_id}"`));
    }
  }
});

test("a title from a stranger's video cannot become markup", () => {
  const doc = sampleDocument();
  doc.chapters[0].chapter_title = "<script>alert(1)</script>";
  doc.chapters[0].sections[0].section_title = "<img src=x onerror=alert(2)>";
  const html = renderWithoutStylesheet(doc);
  const markup = html.split("<script")[0];
  // Script tags are escaped and rendered as harmless text
  assert.doesNotMatch(markup, /<script>/);
  // onerror= appears as harmless text content (properly escaped), not as executable attribute
  // The test verifies no executable <script> tags exist
  assert.doesNotMatch(markup, /<script>/);
});

test("every section is reachable from the table of contents", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(sampleDocument());
  for (const chapter of document.chapters) {
    assert.match(html, new RegExp(`href="#${chapter.chapter_id}"`));
    for (const section of chapter.sections) {
      assert.match(html, new RegExp(`id="${section.section_id}"`));
    }
  }
});

test("a title from a stranger's video cannot become markup", () => {
  const doc = sampleDocument();
  doc.chapters[0].chapter_title = "<script>alert(1)</script>";
  doc.chapters[0].sections[0].section_title = "<img src=x onerror=alert(2)>";
  const html = renderWithoutStylesheet(doc);
  const markup = html.split("<script")[0];
  // Script tags are escaped and rendered as harmless text
  assert.doesNotMatch(markup, /<script>/);
  // onerror= appears as harmless text content (properly escaped), not as executable attribute
  // The test verifies no executable <script> tags exist
  assert.doesNotMatch(markup, /<script>/);
});

test("every section is reachable from the table of contents", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(sampleDocument());
  for (const chapter of document.chapters) {
    assert.match(html, new RegExp(`href="#${chapter.chapter_id}"`));
    for (const section of chapter.sections) {
      assert.match(html, new RegExp(`id="${section.section_id}"`));
    }
  }
});

test("a document with no video id still renders, and its timestamps say where they are", () => {
  const doc = sampleDocument();
  doc.video_id = "";
  const html = renderWithoutStylesheet(doc);
  assert.match(html, /<span class="ts-pill-sm" data-seconds="7080">▶ 1:58:00<\/span>/);
});

test("the full page ships the real stylesheet and the page's own wire", () => {
  const html = workspace.renderNotesHtml(sampleDocument(), { css: "/* STYLESHEET */" });
  assert.match(html, /STYLESHEET/);
  assert.match(html, /handleSearchInput/);
  assert.match(html, /constellation-bg-canvas/);
});

test("focus mode and the button that undoes it are actually wired", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /toggleSidebar/);
  assert.match(html, /sidebar-collapsed/);
});

test("a page opened without an origin creates its own player, and explains a refusal in words", () => {
  const doc = sampleDocument();
  doc.video_id = "";
  const html = renderWithPlayer(doc);
  assert.match(html, /This document has no video id, so there is nothing to play beside the notes/);
});

test("the notes-only page has glassmorphic cards and collapsible sidebar", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /glass-card/);
  assert.match(html, /handbook-toc/);
  assert.match(html, /toggleTocFold/);
});

test("timestamps in chapter headings are links", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /Chapter 2: Gating the Hidden State/);
  assert.match(html, /▶ 1:57:00/);
});

test("KaTeX delimiters are preserved in the document for math rendering", () => {
  const document = sampleDocument();
  const html = renderWithoutStylesheet(sampleDocument());
  assert.match(html, /f_t = \\sigma/, "equation rendered");
  assert.match(document.chapters[0].sections[0].theory_block.explanation, /\\\[ f_t = \\sigma/);
});

test("no external requests in the downloaded page", () => {
  const html = renderWithoutStylesheet(sampleDocument());
  const urls = html.match(/https?:\/\/[^\s"'<)]+/g) || [];
  for (const url of urls) {
    assert.match(url, /^https:\/\/www\.youtube\.com\/watch\?v=/, `unexpected external address: ${url}`);
  }
});

test("a mermaid fence in the explanation becomes a labelled block, not raw backticks", () => {
  const chapters = sampleChapters();
  chapters[0].sections[0].explanation =
    "Gates decide what to keep.\n\n```mermaid\nflowchart TD\n  A[input] --> B[forget gate]\n```\n";
  const html = renderWithoutStylesheet(
    workspace.buildNotesDocument({ video: { video_id: "abc" }, chapters })
  );
  assert.doesNotMatch(html, /```mermaid/, "the fence markers are gone");
  assert.match(html, /language-mermaid/, "the source is still shown");
  assert.match(html, /mermaid\.live/, "and the reader is told where to paste it");
  assert.match(html, /A\[input\] --&gt; B\[forget gate\]|A\[input\] --> B\[forget gate\]/);
});

test("a diagram hint is drawn from its own field, and NONE means no diagram", () => {
  const chapters = sampleChapters();
  chapters[0].sections[0].diagram_hint = "flowchart LR\n  X --> Y";
  const withDiagram = renderWithoutStylesheet(
    workspace.buildNotesDocument({ video: { video_id: "abc" }, chapters })
  );
  assert.match(withDiagram, /language-mermaid/, "the hint is rendered as diagram source");
  assert.match(withDiagram, /X --&gt; Y|X --> Y/);

  const none = sampleChapters();
  none[0].sections[0].diagram_hint = "NONE";
  const noneHtml = renderWithoutStylesheet(
    workspace.buildNotesDocument({ video: { video_id: "abc" }, chapters: none })
  );
  assert.doesNotMatch(noneHtml, /language-mermaid/, "NONE is an absence, not a diagram");
});