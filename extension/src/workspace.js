/**
 * The notes page: what a finished chapter becomes.
 *
 * A note run produces data — chapters, sections, key points, timestamps — and this
 * turns that data into one self-contained HTML file. Self-contained is the point:
 * the reader downloads one file, it opens with no server anywhere, and the only
 * thing it reaches out for is the video it is about — by a link the reader clicks,
 * never by a request the page makes on its own. There is no session to expire and
 * no account to be deleted, because there is nothing on a server to hold.
 *
 * Two shapes of page come out of here, and the only difference is whether the
 * lecture plays beside the notes:
 *
 *   - Notes only, the default. No player, no iframe API, no pane to break: each
 *     timestamp is a link that opens YouTube at that second, and the notes get the
 *     whole window. This is the page a reader downloads.
 *   - Notes and video, when `options.player` is set. The player sits beside the
 *     notes, which needs an address YouTube will accept — a page served over
 *     http(s), never a file opened from disk — so it is never the default and the
 *     page says so plainly if it is refused.
 *
 * The stylesheet is the server page's, lifted by tools/extract-assets.js, so this
 * is the same design rather than a second design that resembles it. The body is
 * ported from templates/base_workspace.html, minus the parts that only made sense
 * with a server behind them: the chat assistant, "Ask AI" per section, the Current
 * Frame button, and the brand link home.
 *
 * Three deliberate departures from the server page:
 *
 *   - The explanation is rendered to HTML here, by a whitelist renderer, instead
 *     of being handed to `marked` in the browser. See src/markdown.js.
 *   - Pitfalls are shown. The composer has always asked the model for them and the
 *     server page never displayed them, so a section's most useful paragraph was
 *     being paid for and thrown away.
 *   - Nothing is loaded from anywhere. The stylesheet used to `@import` a font
 *     stylesheet and name a font CDN as a fallback; both are gone, and printing
 *     uses the browser's own printer rather than a PDF library to paste in.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./core.js"),
      require("./markdown.js"),
      require("./assets.js")
    );
  } else {
    root.UBYU_WORKSPACE = factory(root.UBYU, root.UBYU_MARKDOWN, root.UBYU_ASSETS);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, markdown, assets) {
  "use strict";

  const escapeHtml = markdown.escapeHtml;
  const renderMarkdown = markdown.renderMarkdown;
  const clock = core.clock;

  /**
   * LaTeX delimiters, made readable as text.
   *
   * The model writes equations as `\( ... \)` and `\[ ... \]`. Nothing on this page
   * renders LaTeX — a math renderer is another megabyte, another thing that has to
   * load before the notes can be read, and one more dependency that can fail on a
   * page opened offline — so the delimiters come off and the equation is left as
   * the text it also always was: `\(h_{t-1}\)` reads as `h_{t-1}`, which is what a
   * reader needs in order to follow the sentence around it. The delimiters stay in
   * the document, so a renderer that does have real math can still use them.
   */
  function readableMath(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\(|\\\)/g, "")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1");
  }

  /** Text as the page shows it: escaped for HTML, then made readable. Attributes
   *  keep plain escapeHtml, since LaTeX in an attribute is not read by anyone. */
  function text(value) {
    return readableMath(escapeHtml(value));
  }

  // Version 1 was the page file itself. Version 2 is the data the page is drawn
  // from, which is what this module builds and renders.
  const SCHEMA_VERSION = 2;

  // ---------------------------------------------------------------------------
  // The document
  // ---------------------------------------------------------------------------

  const VIDEO_FIELDS = ["video_id", "title", "channel", "duration_str", "duration", "thumbnail"];

  /** Copy only the named fields that are present, so nothing rides along by accident. */
  function pickFields(source, fields) {
    const out = {};
    if (!source || typeof source !== "object") return out;
    for (const name of fields) {
      if (source[name] !== undefined && source[name] !== null) out[name] = source[name];
    }
    return out;
  }

  /**
   * A chapter heading as a reader wants it.
   *
   * The card already says "Chapter 4", so a title that repeats it is redundant:
   * "Chapter 4: Gating" reads as "Chapter 4  Chapter 4: Gating". Only the label is
   * removed, never words — a title that is nothing but a label is left alone.
   */
  function displayTitle(title, order) {
    const text = String(title || "").trim();
    const stripped = text
      .replace(new RegExp(`^\\s*chapter\\s*0*${order}\\s*[:.\\-–—)]\\s*`, "i"), "")
      .replace(/^\s*chapter\s+\d+\s*[:.\-–—)]\s*(?=\S)/i, "")
      .trim();
    return stripped || text;
  }

  /**
   * Build the storable, re-renderable document from a finished run.
   *
   * The field names are the ones the page reads, kept identical to the Python
   * document of the same schema, so notes written by either pipeline render with
   * either renderer.
   */
  function buildNotesDocument({ video = {}, chapters = [], meta = {} } = {}) {
    const metadata = pickFields(
      {
        video_id: video.video_id || video.id,
        title: video.title,
        channel: video.channel || video.author,
        duration_str: video.duration_str,
        duration: video.duration,
        thumbnail: video.thumbnail,
      },
      VIDEO_FIELDS
    );

    const built = (chapters || []).map((chapter, index) => {
      const order = Number(chapter.chapter_order || chapter.order || index + 1);
      const chapterId = chapter.chapter_id || `chapter-${order}`;
      const seconds = Number(chapter.timestamp_seconds || 0);
      const title = chapter.chapter_title || chapter.title || `Chapter ${order}`;

      const sections = (chapter.sections || []).map((section, sectionIndex) => {
        const sectionOrder = Number(section.section_order || section.order || sectionIndex + 1);
        const at = Number(section.timestamp_seconds || 0);
        const examples = (section.examples || []).map((example) =>
          typeof example === "string" ? { text: example } : example
        );
        return {
          section_id: section.section_id || `${chapterId}-section-${sectionOrder}`,
          section_order: sectionOrder,
          section_title: section.section_title || section.title || `Section ${sectionOrder}`,
          time_reference: section.time_reference || clock(at),
          timestamp_seconds: at,
          theory_block: {
            explanation: section.explanation || "",
            analogies: section.analogies || (section.analogy ? [section.analogy] : []),
          },
          key_points: section.key_points || [],
          pitfalls: section.pitfalls || [],
          examples,
          code_blocks: section.code_blocks || [],
          visual_diagrams: section.visual_diagrams || [],
          supplement_block: section.supplement_block || null,
          // Not in the Python document. Kept because the page has to be able to
          // say out loud which sections are notices rather than notes.
          degraded: Boolean(section.degraded),
        };
      });

      return {
        chapter_id: chapterId,
        chapter_order: order,
        chapter_title: title,
        display_title: displayTitle(title, order),
        timestamp_seconds: seconds,
        timestamp_str: chapter.timestamp_str || clock(seconds),
        overview: chapter.overview || "",
        chapter_summary: chapter.chapter_summary || chapter.summary || "",
        sections,
      };
    });

    return {
      schema_version: SCHEMA_VERSION,
      video_id: String(metadata.video_id || ""),
      video_metadata: metadata,
      generated_at: meta.generated_at || new Date().toISOString(),
      provider: meta.provider || "",
      model: meta.model || "",
      calls: meta.calls || 0,
      chapters: built,
    };
  }

  /** Reasons this document would render as a blank page. An empty list is good. */
  function validateNotesDocument(document) {
    if (!document || typeof document !== "object") return ["no notes were produced"];

    const problems = [];
    if (!document.video_id) problems.push("no video id");

    const chapters = document.chapters;
    if (!Array.isArray(chapters) || !chapters.length) {
      problems.push("no chapters");
      return problems;
    }

    const empty = chapters
      .filter((chapter) => !chapter || !Array.isArray(chapter.sections) || !chapter.sections.length)
      .map((chapter) => String((chapter && (chapter.chapter_title || chapter.title)) || "untitled"));
    if (empty.length) {
      problems.push(
        `${empty.length} of ${chapters.length} chapter(s) have no sections: ${empty.slice(0, 3).join(", ")}`
      );
    }
    return problems;
  }

  /** Read a document that may have come back as JSON text from storage. */
  function coerceNotesDocument(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).length ? value : null;
    }
    if (typeof value === "string") {
      try {
        const decoded = JSON.parse(value);
        return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : null;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function notesDocumentToJson(document) {
    return JSON.stringify(document);
  }

  /** How many sections of a document are notices rather than notes. */
  function degradedSections(document) {
    const out = [];
    for (const chapter of (document && document.chapters) || []) {
      for (const section of chapter.sections || []) {
        if (section.degraded) out.push(`${chapter.chapter_title} › ${section.section_title}`);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The page
  // ---------------------------------------------------------------------------

  const PAGE_STYLE = [
    "/* The extension's page has no chat assistant, so the right-hand column holds",
    "   only the player. Confined to desktop widths: below 961px the stylesheet's",
    "   own mobile tabs take over. */",
    "@media (min-width: 961px) {",
    "  #app-workspace { display: flex !important; }",
    "  /* These two are the interface for a phone: a tab bar and a button that",
    "     restores the video. Left in the flow on a desktop they were laid out as",
    "     flex items and took 197px of the video column's width, which is why the",
    "     player came out narrow and off-centre. Hidden and pinned instead. */",
    "  #app-workspace #mobile-nav-bar { display: none !important; }",
    "  #app-workspace #floating-companion-fab {",
    "    position: fixed !important; right: 1.1rem !important; bottom: 1.1rem !important;",
    "    z-index: 6000 !important;",
    "  }",
    "  /* Focus mode. `toggleSidebar` has always toggled a `sidebar-collapsed` class",
    "     that no rule in the stylesheet answered, so the button did nothing and the",
    "     notes could never be given the whole window. Here it means what it says. */",
    "  #app-workspace.sidebar-collapsed #handbook-pane {",
    "    flex: 1 1 100% !important; width: 100% !important; max-width: 100% !important;",
    "  }",
    "  #app-workspace.sidebar-collapsed .right-column,",
    "  #app-workspace.sidebar-collapsed #v-resizer { display: none !important; }",
    "  #app-workspace.sidebar-collapsed #floating-companion-fab { display: inline-flex !important; }",
    "  #app-workspace #handbook-pane {",
    "    flex: 0 0 var(--left-pane-width, 58%) !important;",
    "    width: var(--left-pane-width, 58%) !important;",
    "    max-width: var(--left-pane-width, 58%) !important;",
    "  }",
    "  #app-workspace .right-column {",
    "    display: flex !important; flex: 1 1 auto !important; flex-direction: column !important;",
    "    width: auto !important; min-width: 0 !important; height: 100vh !important;",
    "  }",
    "  #app-workspace #video-pane {",
    "    display: flex !important; flex: 1 1 auto !important; height: auto !important;",
    "    align-items: center !important; justify-content: center !important; padding: 0.7rem !important;",
    "  }",
    "  #app-workspace .video-wrapper {",
    "    width: 100% !important; max-width: 100% !important; aspect-ratio: 16 / 9;",
    "    background: #000 !important; border-radius: 14px; overflow: hidden;",
    "    box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55);",
    "  }",
    "  #app-workspace .video-wrapper iframe, #app-workspace .video-wrapper > div {",
    "    display: block !important; width: 100% !important; height: 100% !important; border: 0 !important;",
    "  }",
    "}",
    "/* The floating button exists to bring the video back after it has been folded",
    "   away, and the stylesheet never gave it a display, so it sat over the notes at",
    "   all times instead. On a phone the tab bar already switches to the video. */",
    "#app-workspace #floating-companion-fab { display: none !important; }",
    ".degraded-badge {",
    "  display: inline-block; margin-left: 0.5rem; padding: 0.15rem 0.5rem; border-radius: 9999px;",
    "  font-size: 0.64rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;",
    "  color: #fca5a5; background: rgba(220, 38, 38, 0.16); border: 1px solid rgba(248, 113, 113, 0.4);",
    "  vertical-align: middle;",
    "}",
    ".notes-provenance { margin: 0.35rem 0 0.6rem 0; font-size: 0.7rem; color: #9ba5b1; line-height: 1.5; }",
    ".notes-banner {",
    "  margin: 0.35rem 0 1rem 0; padding: 0.6rem 0.8rem; border-radius: 12px; font-size: 0.78rem;",
    "  line-height: 1.55; color: #fde68a; background: rgba(180, 120, 20, 0.14);",
    "  border: 1px solid rgba(217, 164, 65, 0.35);",
    "}",
    "/* The message shown when YouTube refuses to play inside a page opened from",
    "   disk. It replaces the player, so it is styled as something to read. */",
    ".embed-refused {",
    "  max-width: 30rem; margin: 0 auto; padding: 1.4rem 1.5rem; border-radius: 14px;",
    "  background: rgba(44, 47, 53, 0.55); border: 1px solid rgba(229, 229, 229, 0.12);",
    "  color: #e6e6e6; font-size: 0.86rem; line-height: 1.65; text-align: left;",
    "}",
    ".embed-refused h2 { margin: 0 0 0.6rem 0; font-size: 1rem; color: #fbbf24; }",
    ".embed-refused p { margin: 0 0 0.7rem 0; }",
    ".embed-refused code { font-size: 0.78rem; color: #fca5a5; }",
    ".embed-refused a { color: #76ABAE; }",
    "/* The search controller offers to ask the study assistant about whatever you",
    "   typed. This page has no assistant, so that row is removed by the page's glue",
    "   and hidden here in case it is ever rendered before the glue runs. */",
    ".suggestion-item.suggestion-ai-ask { display: none !important; }",
    "/* On the notes-only page nothing sits beside the notes, so they take the whole",
    "   window instead of the 58% a video column would leave them. The id and the",
    "   class together outweigh the stylesheet's own width rules at every width. */",
    "#app-workspace.notes-only #handbook-pane {",
    "  flex: 1 1 100% !important; width: 100% !important; max-width: 100% !important;",
    "}",
    "/* A timestamp on this page is a link to YouTube at that second. It has to look",
    "   exactly like the button it replaces, which means no underline and no colour",
    "   change on hover — it is a jump, not a citation. */",
    "a.ts-pill, a.ts-pill-sm, a.ts-pill:hover, a.ts-pill-sm:hover {",
    "  text-decoration: none !important; cursor: pointer;",
    "}",
    "/* What the notes say when the search matches nothing. Saying so is better than",
    "   an empty column, which reads as a broken page. */",
    ".search-empty {",
    "  margin: 0.5rem 0 2rem 0; padding: 0.9rem 1.1rem; border-radius: 12px;",
    "  font-size: 0.85rem; line-height: 1.6; color: #cbd5e1;",
    "  background: rgba(148, 163, 184, 0.1); border: 1px dashed rgba(148, 163, 184, 0.35);",
    "}",
    ".search-empty[hidden] { display: none !important; }",
    "/* Folding the index. `toggleTocFold` has always added a `toc-folded` class that",
    "   no rule in the stylesheet answered, so the button looked broken. */",
    "#handbook-toc .toc-fold-icon { transition: transform 0.2s ease; }",
    "#handbook-toc.toc-folded .toc-list { display: none !important; }",
    "#handbook-toc.toc-folded .toc-fold-icon { transform: rotate(-90deg); }",
    "/* An equation with its delimiters off is still an equation, so it gets the",
    "   monospace face rather than the prose one. */",
    ".math-display-card {",
    "  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
    "}",
    "/* -------------------------------------------------------------------------",
    "   Printing — which is also how a reader saves a PDF, because that is what a",
    "   browser's print dialog does. The stylesheet above is built for a dark screen",
    "   and ink is white; these rules apply only while printing, so nothing on screen",
    "   changes. Every selector is anchored to an id so it outranks the !important",
    "   rules the screen stylesheet sets on classes. */",
    "@media print {",
    "  @page { margin: 14mm; }",
    "  /* Anchored to the body's own class as well as the elements, because the",
    "     screen sheet sets the dark background on `.workspace-body` with !important",
    "     and a bare `html body` loses that fight. */",
    "  html, html body.workspace-body,",
    "  html body.workspace-body #app-workspace,",
    "  html body.workspace-body #handbook-pane {",
    "    background: #ffffff !important; color: #111827 !important;",
    "  }",
    "  /* One window's worth of interface, and the panes that only exist beside a",
    "     reader in a browser. None of it belongs on paper. */",
    "  #constellation-bg-canvas, #mobile-nav-bar, #floating-companion-fab, #v-resizer,",
    "  #right-column, #sync-toast, .handbook-controls, #search-suggestions-dropdown,",
    "  .search-empty { display: none !important; }",
    "  /* Paper is not a window with a scrollbar: the page has to be able to be as",
    "     long as it needs to be. */",
    "  html body #app-workspace, html body #handbook-pane, html body #handbook-chapters {",
    "    display: block !important; position: static !important;",
    "    height: auto !important; max-height: none !important; overflow: visible !important;",
    "    width: 100% !important; max-width: 100% !important; flex: none !important;",
    "  }",
    "  html body #handbook-toc {",
    "    position: static !important; max-height: none !important; overflow: visible !important;",
    "    break-inside: avoid; break-after: page;",
    "  }",
    "  /* Ink on white, so nothing prints as a pale block on a pale block. */",
    "  html body #handbook-pane * {",
    "    color: #1f2937 !important; background-color: transparent !important;",
    "    background-image: none !important; box-shadow: none !important;",
    "    text-shadow: none !important; backdrop-filter: none !important;",
    "    border-color: #d1d5db !important;",
    "  }",
    "  html body #handbook-pane .chapter-heading,",
    "  html body #handbook-pane .section-heading,",
    "  html body #handbook-pane .video-title, html body #handbook-pane h1,",
    "  html body #handbook-pane h2, html body #handbook-pane h3,",
    "  html body #handbook-pane h4 { color: #111827 !important; }",
    "  html body #handbook-pane a { color: #1d4ed8 !important; text-decoration: underline !important; }",
    "  html body #handbook-pane .ts-pill, html body #handbook-pane .ts-pill-sm,",
    "  html body #handbook-pane .chapter-num, html body #handbook-pane .degraded-badge {",
    "    background: #f3f4f6 !important; border: 1px solid #d1d5db !important;",
    "    color: #374151 !important;",
    "  }",
    "  html body #handbook-pane .theory-block,",
    "  html body #handbook-pane .keypoints-card,",
    "  html body #handbook-pane .analogy-card,",
    "  html body #handbook-pane .example-card,",
    "  html body #handbook-pane .supplement-card,",
    "  html body #handbook-pane .chapter-card,",
    "  html body #handbook-pane .math-display-card {",
    "    background: #ffffff !important; border: 1px solid #e5e7eb !important;",
    "  }",
    "  /* Chapters start on their own page, and the small cards are not split across",
    "     one. A section is allowed to be long, so it may break where it must. */",
    "  article.chapter-card + article.chapter-card { break-before: page; }",
    "  .keypoints-card, .analogy-card, .example-card, .supplement-card,",
    "  .math-display-card, .section-header { break-inside: avoid; }",
    "  .chapter-heading, .section-heading { break-after: avoid; }",
    "  .handbook-toc .toc-list { columns: 2; }",
    "}",
  ].join("\n");

  /**
   * The shims the page needs before the stylesheet's own scripts run.
   *
   * A downloaded page is opened from disk, where one browser refuses localStorage
   * outright. The page's scripts use it to remember pane widths and folded
   * sections — session state, not the notes — but an exception there stops the
   * whole script, so the search and the seek buttons would die with it. A shim that
   * remembers nothing keeps them alive; remembering a pane width was never worth
   * a broken page.
   */
  const PAGE_PRELUDE = `
(function () {
  try {
    window.localStorage.getItem("4uby_probe");
  } catch (error) {
    var memory = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: function (key) { return memory.has(String(key)) ? memory.get(String(key)) : null; },
        setItem: function (key, value) { memory.set(String(key), String(value)); },
        removeItem: function (key) { memory.delete(String(key)); },
        clear: function () { memory.clear(); },
        key: function (index) { return Array.from(memory.keys())[index] || null; },
        get length() { return memory.size; }
      }
    });
  }
})();
`;

  /**
   * The page's own glue, after the stylesheet's scripts have defined the rest.
   *
   * Two things happen here. On a page opened without an origin — a downloaded file,
   * where the browser reports the origin as the string "null" — the player is
   * created here rather than by the controller, because YouTube refuses to embed
   * with origin "null" and the controller always sets it. And `seekVideoTo` is
   * published, because the search index has always called it to jump the video and
   * nothing ever defined it — clicking a suggested topic scrolled the notes and
   * left the video where it was.
   */
  const PAGE_EPILOGUE = `
(function () {
  // A downloaded page is opened from disk, and a page like that reports its origin
  // as the string "null". Asking YouTube to embed a player with origin "null" is
  // what produces "Video unavailable" on a page that otherwise works, and the
  // accepted fix is to ask without the parameter at all. Any page that is not
  // served over http(s) has this problem, not only file:// ones.
  var originless = window.location.protocol === "file:" || window.location.origin === "null";

  if (originless) {
    // The controller inlined above sets that parameter itself, and the API installs
    // its player constructor in more than one step, so wrapping the constructor is
    // a race this page loses: the player came out with origin=null in its URL and
    // never became ready. So on a page with no real origin the player is created
    // here, with the same options minus the origin, and handed to the controller
    // through the binding its seek and ticker functions already read.
    window.onYouTubeIframeAPIReady = function () {
      var frame = document.getElementById("yt-player-frame");
      if (!frame || !window.YT || !window.YT.Player) return;
      var videoId = frame.dataset.videoId;
      if (!videoId) return;
      ytPlayer = new window.YT.Player("yt-player-frame", {
        videoId: videoId,
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, enablejsapi: 1 },
        events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange }
      });

      // A page opened from disk is a page YouTube cannot identify, and it may refuse
      // the embed outright — "embedder.identity.missing.referrer" — which leaves a
      // pane that looks broken for no visible reason. When the player says that,
      // this page says it too, in words, and offers the click that does work. It is
      // checked rather than assumed, so a machine where the embed is allowed shows
      // no notice at all.
      var checks = 0;
      var watcher = setInterval(function () {
        checks += 1;
        var data = ytPlayer && ytPlayer.getVideoData ? ytPlayer.getVideoData() : null;
        if (data && data.errorCode) {
          clearInterval(watcher);
          explainRefusedEmbed(videoId, data.errorCode);
        } else if ((data && data.isPlayable) || checks > 24) {
          clearInterval(watcher);
        }
      }, 250);
    };
  }

  function escapeText(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function explainRefusedEmbed(videoId, code) {
    var pane = document.getElementById("video-pane");
    if (!pane) return;
    pane.innerHTML =
      '<div class="embed-refused">' +
      "<h2>The video would not play here</h2>" +
      "<p>YouTube refused to play inside a page opened from disk, because a page " +
      "like that has no address for it to identify. It said " +
      "<code>" + escapeText(code) + "</code>.</p>" +
      "<p>The notes are complete. Every timestamp now opens the lecture on YouTube " +
      "at that moment instead of seeking a player that is not here, which is the " +
      "one thing a downloaded page cannot do by itself.</p>" +
      '<p><a href="https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) +
      '" target="_blank" rel="noopener noreferrer">Open the lecture on YouTube</a></p>' +
      "</div>";

    // Every timestamp button was written to seek this player. Rather than leave
    // them quietly doing nothing, each one opens the lecture at its own second.
    // The table of contents is left alone: it still scrolls, which is its other
    // job, and a scroll should not also open a tab.
    var stamps = document.querySelectorAll("button[data-seconds]");
    for (var index = 0; index < stamps.length; index += 1) {
      (function (element) {
        var at = Number(element.getAttribute("data-seconds") || 0);
        element.onclick = function () {
          window.open(
            "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId) + "&t=" + at + "s",
            "_blank",
            "noopener"
          );
        };
      })(stamps[index]);
    }

    // Auto-sync and the running clock describe a player, and there is none.
    var syncButton = document.querySelector(".btn-sync-toggle");
    if (syncButton) syncButton.style.display = "none";
    var runningClock = document.getElementById("current-playback-time");
    if (runningClock) runningClock.style.display = "none";
  }

  if (typeof window.seekVideo === "function") window.seekVideoTo = window.seekVideo;

  // The search dropdown is built by the controller and always appends an
  // "Ask Study Assistant about ..." row. There is no assistant on this page, and
  // a row that does nothing when clicked is worse than no row, so it is removed
  // as soon as the list is drawn.
  (function dropTheAssistantRow() {
    var original = window.renderSuggestions;
    if (typeof original !== "function") return;
    window.renderSuggestions = function () {
      var result = original.apply(this, arguments);
      var rows = document.querySelectorAll(".suggestion-item.suggestion-ai-ask");
      for (var index = 0; index < rows.length; index += 1) rows[index].remove();
      return result;
    };
  })();

  /** Copy a code block, which the stylesheet's buttons have always offered and
   *  nothing ever implemented. */
  window.copyCodeBlock = function (button) {
    var card = button.closest(".code-card");
    var code = card && card.querySelector("pre code");
    if (!code) return;
    var text = code.innerText;
    var label = button.querySelector(".copy-text");
    var done = function () {
      if (!label) return;
      label.innerText = "Copied";
      setTimeout(function () { label.innerText = "Copy"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
    } else {
      var area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); done(); } catch (error) {}
      document.body.removeChild(area);
    }
  };
})();
`;

  /**
   * The wire for the notes-only page: search, and folding the index. Nothing else.
   *
   * The server page's splitter and sync controller exist to run a player, a chat
   * pane, a phone's tab bar and a draggable gutter. This page has none of those, so
   * it does not carry them: 29 KB of script describing panes that are not here is
   * 29 KB whose only possible contribution is a defect. What is left is the two
   * things a reader does with the notes — filter them as they type, and fold the
   * index — published under the same names the markup already calls, which is how
   * the controller was wired to it too.
   */
  const NOTES_SCRIPT = `
(function () {
  "use strict";

  var chapters = document.getElementById("handbook-chapters");
  var empty = document.getElementById("search-empty");
  var clearButton = document.getElementById("search-clear-btn");

  function filter() {
    var input = document.getElementById("notes-search");
    if (!input || !chapters) return;
    var query = String(input.value || "").toLowerCase().trim();
    var cards = chapters.querySelectorAll("article.chapter-card");
    var shown = 0;
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var hit = false;
      var title = String(card.getAttribute("data-chapter-title") || "").toLowerCase();
      if (query && title.indexOf(query) !== -1) hit = true;
      var own = card.querySelectorAll(".section-block");
      for (var j = 0; j < own.length; j += 1) {
        var match = !query || own[j].textContent.toLowerCase().indexOf(query) !== -1;
        own[j].style.display = match ? "" : "none";
        if (match) { hit = true; shown += 1; }
      }
      card.style.display = hit ? "" : "none";
    }
    // An empty column reads as a broken page, so it is said out loud instead.
    if (empty) empty.hidden = !(query && shown === 0);
  }

  window.handleSearchInput = function (value) {
    if (clearButton) clearButton.style.display = value && value.length ? "block" : "none";
    filter();
  };

  // There is nothing to suggest. The notes filter as you type, which is the job.
  window.handleSearchFocus = function () {};

  window.clearHandbookSearch = function () {
    var input = document.getElementById("notes-search");
    if (input) { input.value = ""; input.focus(); }
    if (clearButton) clearButton.style.display = "none";
    filter();
  };

  window.toggleTocFold = function () {
    var toc = document.getElementById("handbook-toc");
    if (!toc) return;
    var folded = toc.classList.toggle("toc-folded");
    var hint = document.getElementById("toc-fold-hint");
    if (hint) hint.innerText = folded ? "(Click to expand)" : "(Click to fold)";
    try { localStorage.setItem("4u_toc_folded", folded ? "true" : "false"); } catch (error) {}
  };

  try {
    if (localStorage.getItem("4u_toc_folded") === "true") {
      var toc = document.getElementById("handbook-toc");
      var hint = document.getElementById("toc-fold-hint");
      if (toc) toc.classList.add("toc-folded");
      if (hint) hint.innerText = "(Click to expand)";
    }
  } catch (error) {}
})();
`;

  /**
   * Where a timestamp goes on a page with no player: YouTube, at that second.
   *
   * The link is written into the markup rather than wired up afterwards, so it
   * works before any script has run, works if a script does not run at all, opens
   * in a new tab, and shows its destination in the status bar on hover. A player
   * seeks silently; a link is honest about what clicking it will do.
   */
  function watchUrl(videoId, seconds) {
    if (!videoId) return "";
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(
      0,
      Math.round(Number(seconds) || 0)
    )}s`;
  }

  /** One timestamp, as the button the stylesheet draws or as a link to the lecture. */
  function renderTimestamp(view, seconds, label, className) {
    const at = Number(seconds || 0);
    const label_html = `▶ ${escapeHtml(label)}`;
    if (view.player) {
      return `<button class="${className}" data-seconds="${at}" onclick="seekVideo(${at})">${label_html}</button>`;
    }
    const href = watchUrl(view.videoId, at);
    if (!href) return `<span class="${className}" data-seconds="${at}">${label_html}</span>`;
    return (
      `<a class="${className} ts-link" data-seconds="${at}" href="${escapeHtml(href)}" ` +
      `target="_blank" rel="noopener noreferrer" ` +
      `title="Open the lecture on YouTube at this moment">${label_html}</a>`
    );
  }

  function renderToc(view, document) {
    const items = (document.chapters || [])
      .map(
        (chapter) => `      <li>
        <a class="toc-link" href="#${escapeHtml(chapter.chapter_id)}"${
          // On a page with a player the index also seeks it. On a page without one
          // it only scrolls: the timestamps beside the notes already open YouTube,
          // and a scroll that also opened a tab would be obnoxious.
          view.player ? ` onclick="seekVideo(${Number(chapter.timestamp_seconds || 0)})"` : ""
        }>
          <span class="toc-order">${escapeHtml(chapter.chapter_order)}.</span>
          <span class="toc-title">${text(chapter.display_title || chapter.chapter_title)}</span>
          <span class="toc-ts">[${escapeHtml(chapter.timestamp_str)}]</span>
        </a>
      </li>`
      )
      .join("\n");

    return `    <nav class="handbook-toc" id="handbook-toc">
      <div class="toc-header" onclick="toggleTocFold()" title="Click to Fold / Expand Table of Contents">
        <div class="toc-header-left">
          <svg class="toc-fold-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <h3>Table of Contents</h3>
        </div>
        <div class="toc-header-right">
          <span class="toc-count">${(document.chapters || []).length} Chapters</span>
          <span class="toc-fold-hint" id="toc-fold-hint">(Click to fold)</span>
        </div>
      </div>
      <ol class="toc-list">
${items}
      </ol>
    </nav>`;
  }

  function renderSection(view, section) {
    const seconds = Number(section.timestamp_seconds || 0);
    const theory = section.theory_block || {};
    const analogies = (theory.analogies || [])
      .map(
        (analogy) => `          <div class="analogy-card">
            <div class="analogy-icon">💡</div>
            <div class="analogy-body">
              <div class="analogy-title">Mental Model &amp; Intuition</div>
              <div class="analogy-text">${text(analogy)}</div>
            </div>
          </div>`
      )
      .join("\n");

    const keyPoints = (section.key_points || []).length
      ? `          <div class="keypoints-card">
            <h4>Key Takeaways</h4>
            <ul>
${section.key_points.map((point) => `              <li>${text(point)}</li>`).join("\n")}
            </ul>
          </div>`
      : "";

    // The composer has always written these and the server page never showed them.
    const pitfalls = (section.pitfalls || []).length
      ? `          <div class="keypoints-card pitfalls-card">
            <h4>Common Mistakes</h4>
            <ul>
${section.pitfalls.map((point) => `              <li>${text(point)}</li>`).join("\n")}
            </ul>
          </div>`
      : "";

    const examples = (section.examples || [])
      .map(
        (example) => `          <div class="example-card">
            <span class="example-text">${text(example.text || example)}</span>
          </div>`
      )
      .join("\n");

    const supplement = section.supplement_block
      ? `          <div class="supplement-card">
            <div class="supplement-badge">${text(section.supplement_block.external_label || "Further reading")}</div>
            <p>${text(section.supplement_block.content || "")}</p>
          </div>`
      : "";

    return `          <section class="section-block" data-chapter-title="${escapeHtml(
      section.section_title
    )}" data-timestamp-seconds="${seconds}" id="${escapeHtml(section.section_id)}">
            <div class="section-header">
              <h3 class="section-heading">${text(section.section_title)}${
                section.degraded ? `<span class="degraded-badge">Not written up</span>` : ""
              }</h3>
              <div class="section-tools">
                ${renderTimestamp(view, seconds, section.time_reference, "ts-pill-sm")}
              </div>
            </div>
            <div class="theory-block">
              <div class="theory-content">${readableMath(renderMarkdown(theory.explanation))}</div>
${analogies}
            </div>
${keyPoints}
${pitfalls}
${examples}
${supplement}
          </section>`;
  }

  function renderChapters(view, document) {
    return (document.chapters || [])
      .map((chapter) => {
        const seconds = Number(chapter.timestamp_seconds || 0);
        const sections = (chapter.sections || []).map((section) => renderSection(view, section)).join("\n");
        const overview = chapter.overview
          ? `<p class="chapter-overview">${text(chapter.overview)}</p>`
          : "";
        const summary = chapter.chapter_summary
          ? `<div class="chapter-summary-footer"><strong>Summary:</strong> ${text(
              chapter.chapter_summary
            )}</div>`
          : "";
        return `        <article class="chapter-card" data-chapter-title="${escapeHtml(
          chapter.chapter_title
        )}" data-timestamp-seconds="${seconds}" id="${escapeHtml(chapter.chapter_id)}">
          <div class="chapter-header">
            <div class="chapter-title-group">
              <span class="chapter-num">Chapter ${escapeHtml(chapter.chapter_order)}</span>
              <h2 class="chapter-heading">${text(
                chapter.display_title || chapter.chapter_title
              )}</h2>
            </div>
            ${renderTimestamp(view, seconds, chapter.timestamp_str, "ts-pill")}
          </div>
${overview}
          <div class="sections-list">
${sections}
          </div>
${summary}
        </article>`;
      })
      .join("\n");
  }

  function renderVideoColumn(document) {
    const videoId = String(document.video_id || "");
    return `    <aside class="right-column" id="right-column">
      <section class="video-pane" id="video-pane">
        <div class="video-wrapper">
${
  videoId
    ? `<div data-video-id="${escapeHtml(videoId)}" id="yt-player-frame"></div>`
    : `<div style="padding:1.5rem;color:#9ba5b1;font-size:0.85rem;line-height:1.6;">
            This document has no video id, so there is nothing to play beside the notes.
          </div>`
}
        </div>
      </section>
    </aside>`;
  }

  function renderHeader(view, document) {
    const metadata = document.video_metadata || {};
    const title = metadata.title || "Lecture notes";
    const meta = [
      metadata.channel ? `<span>Instructor: ${text(metadata.channel)}</span>` : "",
      metadata.duration_str ? `<span>Duration: ${text(metadata.duration_str)}</span>` : "",
      `<span>${(document.chapters || []).length} Chapters</span>`,
    ]
      .filter(Boolean)
      .join(" ");

    // What sits to the right of the search box depends on what the page can do. A
    // page with no player has no playback time to show, nothing for Auto-Sync to
    // sync, and no sidebar to give the notes; offering those buttons would be three
    // controls that do nothing. What it can always do is be printed, which is also
    // how a reader gets a PDF, so that is the button it gets.
    const actions = view.player
      ? `            <span id="current-playback-time" class="time-pill" title="Live Video Playback Time">00:00</span>
            <button class="btn-toggle active btn-sync-toggle" id="toggle-autofollow" onclick="toggleAutoSync()" title="Toggle Video &amp; Handbook Sync">Auto-Sync</button>
            <button type="button" class="btn-tool-sm btn-sidebar-toggle" id="btn-toggle-sidebar" onclick="toggleSidebar()" title="Toggle Sidebar (Expand Notes to Fullscreen)">
              <svg class="sidebar-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>
              <span id="sidebar-toggle-text">Focus Mode</span>
            </button>`
      : `            <button type="button" class="btn-tool-sm" id="btn-print" onclick="window.print()" title="Print this page, or save it as a PDF">
              <svg class="print-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              <span>Save as PDF</span>
            </button>`;

    return `      <header class="handbook-header">
        <div class="header-top">
          <div class="workspace-brand-area">
            <span class="brand-link" style="text-decoration: none; display: flex; flex-direction: column;">
              <span class="brand-title-animated">4U BY U</span>
              <span class="brand-subtitle-animated">FOR YOU BY YOU</span>
            </span>
          </div>
        </div>
        <h1 class="video-title">${text(title)}</h1>
        <div class="video-meta">${meta}</div>
        <div class="handbook-controls minimal-toolbar">
          <div class="search-input-wrapper" id="search-input-wrapper">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input id="notes-search" oninput="handleSearchInput(this.value)" onfocus="handleSearchFocus()" placeholder="Search concepts, topics, or code..." type="text" autocomplete="off"/>
            <button type="button" id="search-clear-btn" class="search-clear-btn" onclick="clearHandbookSearch()" style="display: none;" title="Clear Search">&times;</button>${
              view.player
                ? `
            <div class="search-suggestions-dropdown" id="search-suggestions-dropdown" style="display: none;">
              <div class="suggestions-header">
                <span class="suggestions-title">Jump to a topic</span>
                <span class="suggestions-hint">Click to jump the video</span>
              </div>
              <div class="suggestions-list" id="suggestions-list"></div>
            </div>`
                : ""
            }
          </div>
          <div class="toolbar-actions">
${actions}
          </div>
        </div>
      </header>`;
  }

  /** Honest, quiet provenance: what made these notes, and what is missing from them. */
  function renderProvenance(view, document) {
    const metadata = document.video_metadata || {};
    const when = document.generated_at ? String(document.generated_at).replace("T", " ").slice(0, 16) : "";
    const by = [document.provider, document.model].filter(Boolean).join(" / ");
    const parts = [
      when ? `Written ${escapeHtml(when)} UTC` : "",
      by ? `by ${escapeHtml(by)}` : "",
      metadata.title ? `from the captions of “${text(metadata.title)}”` : "",
      // On a page with no player, a timestamp that looks like a button but opens a
      // tab is worth one line of explanation rather than a surprise.
      view.player ? "" : "each timestamp opens the lecture on YouTube at that moment",
    ].filter(Boolean);

    const degraded = degradedSections(document);
    const banner = degraded.length
      ? `<div class="notes-banner">${degraded.length} of ${
          (document.chapters || []).reduce((count, chapter) => count + (chapter.sections || []).length, 0)
        } sections could not be written up, and say why in place. Nothing was invented to fill them in.</div>`
      : "";

    return `<div class="notes-provenance">${parts.join(" · ")}</div>${banner}`;
  }

  /**
   * The whole page, as one string.
   *
   * `options.player` decides whether the lecture plays beside the notes. It is off
   * unless it is asked for, because a page with a player depends on two things that
   * are not this file — youtube.com answering, and an address YouTube will accept —
   * and a reader who downloaded the notes should not depend on either.
   *
   * `options.css` exists so a test can render without the 250 KB stylesheet, and
   * so a future page can be styled differently without touching this file.
   */
  function renderNotesHtml(document, options = {}) {
    const css = options.css === undefined ? assets.WORKSPACE_CSS : options.css;
    const scripts = assets.PAGE_SCRIPTS || {};
    const metadata = document.video_metadata || {};
    const title = metadata.title || "Lecture notes";
    const provenance = assets.SOURCE
      ? `stylesheet from ${assets.SOURCE.template} (sha ${assets.SOURCE.css_sha256_12})`
      : "stylesheet";
    const view = { player: Boolean(options.player), videoId: String(document.video_id || "") };

    // Everything that only exists to run a player, a second pane, or a phone's tab
    // bar. Left out of the notes-only page entirely, rather than rendered and hidden:
    // markup nobody can see is markup nobody can break.
    const playerOnly = `
    <div class="resizer v-resizer" id="v-resizer" title="Drag to resize Notes vs. Video">
      <div class="resizer-handle"></div>
    </div>
${renderVideoColumn(document)}
  <button type="button" class="floating-companion-fab" id="floating-companion-fab" onclick="toggleSidebar()" title="Show the video beside the notes">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
    <span>Show the video</span>
  </button>
  <nav class="mobile-nav-bar" id="mobile-nav-bar" aria-label="Mobile Navigation">
    <button type="button" class="mobile-tab-btn active" id="tab-btn-notes" onclick="setMobileView('notes')" aria-label="Study Notes">
      <span class="tab-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg></span>
      <span class="tab-label">Notes</span>
    </button>
    <button type="button" class="mobile-tab-btn" id="tab-btn-video" onclick="setMobileView('video')" aria-label="Video Player">
      <span class="tab-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"></rect><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"></polygon></svg></span>
      <span class="tab-label">Video</span>
      <span class="tab-badge" id="mobile-time-badge">00:00</span>
    </button>
  </nav>
<div class="sync-toast hidden" id="sync-toast"></div>`;

    const pageScripts = view.player
      ? `<script src="https://www.youtube.com/iframe_api"></script>
<script>${scripts.constellation || ""}</script>
<script>${scripts.splitter || ""}</script>
<script>${scripts.youtube || ""}</script>
<script>${PAGE_EPILOGUE}</script>`
      : `<script>${scripts.constellation || ""}</script>
<script>${NOTES_SCRIPT}</script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — 4 U By U</title>
<meta name="generator" content="4 U By U notes page (${escapeHtml(provenance)})"/>
<style id="4ubyu-workspace-stylesheet">
${css}
</style>
<style id="4ubyu-page-stylesheet">
${PAGE_STYLE}
</style>
</head>
<body class="workspace-body">
<canvas id="constellation-bg-canvas" class="constellation-bg-canvas"></canvas>
<div class="workspace-container${view.player ? "" : " notes-only"}" id="app-workspace">
<main class="handbook-pane" id="handbook-pane">
${renderHeader(view, document)}
${renderToc(view, document)}
      <div class="handbook-chapters" id="handbook-chapters">
${renderProvenance(view, document)}
<div class="search-empty" id="search-empty" hidden>No section of these notes mentions that. The search looks at the notes themselves, not the lecture.</div>
${renderChapters(view, document)}
      </div>
</main>${view.player ? playerOnly : ""}
</div>
<script>${PAGE_PRELUDE}</script>
${pageScripts}
</body>
</html>
`;
  }

  return {
    SCHEMA_VERSION,
    buildNotesDocument,
    validateNotesDocument,
    coerceNotesDocument,
    notesDocumentToJson,
    degradedSections,
    displayTitle,
    renderNotesHtml,
    PAGE_PRELUDE,
    PAGE_EPILOGUE,
    NOTES_SCRIPT,
    PAGE_STYLE,
    readableMath,
  };
});
