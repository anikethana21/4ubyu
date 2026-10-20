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
 * Notes-only mode: no player, no iframe API. Each timestamp is a link that opens
 * YouTube at that second. The notes get the whole window.
 *
 * The stylesheet is embedded (lifted from templates/base_workspace.html by
 * tools/extract-assets.js). No external fonts, no CDN, no external requests.
 * KaTeX is embedded for math rendering.
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

  // ---------------------------------------------------------------------------
  // LaTeX/KaTeX handling
  // ---------------------------------------------------------------------------

  /**
   * Convert LaTeX delimiters to KaTeX-ready format.
   * The model writes \(...\) and \[...\]. We keep them for KaTeX to render.
   * Also handle $...$ and $$...$$ for inline/block math.
   */
  function prepareMath(value) {
    return String(value === undefined || value === null ? "" : value);
  }

  /**
   * Strip inline math delimiters \(...\) and $...$ but preserve display math \[...\] and $$...$$ for KaTeX.
   * Inline math delimiters \(...\) are replaced with parentheses (...) for readability.
   * $...$ delimiters are removed entirely.
   * Display math \[...\] and $$...$$ are protected and restored.
   */
  function stripInlineMath(value) {
    const str = String(value === undefined || value === null ? "" : value);
    // Protect display math \[...\] and $$...$$ by replacing with placeholders
    const displayMathBlocks = [];
    let protectedStr = str.replace(/\\\[([\s\S]*?)\\\]/g, (match) => {
      const placeholder = `__DISPLAY_MATH_${displayMathBlocks.length}__`;
      displayMathBlocks.push(match);
      return placeholder;
    })
      .replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        const placeholder = `__DISPLAY_MATH_${displayMathBlocks.length}__`;
        displayMathBlocks.push(match);
        return placeholder;
      });
    // Strip inline math delimiters
    let result = protectedStr
      .replace(/\\\(([\s\S]*?)\\\)/g, "($1)")
      .replace(/\$([^\$\n]+?)\$/g, "$1");
    // Restore display math blocks
    displayMathBlocks.forEach((block, index) => {
      result = result.replace(`__DISPLAY_MATH_${index}__`, block);
    });
    return result;
  }

  /** Text as the page shows it: escaped for HTML, math delimiters preserved for KaTeX. */
  function text(value) {
    return escapeHtml(prepareMath(value));
  }

  /** Text with inline math delimiters stripped for readable display. */
  function textPlain(value) {
    return escapeHtml(stripInlineMath(value));
  }

  /**
   * Mermaid is not loaded into the page. Shipping the renderer would add a
   * large script and a second thing that can fail to load, and the notes are
   * meant to open with no network at all. So a diagram is shown as the source
   * that was written, labelled with where to paste it, rather than as a broken
   * picture. ```` ```mermaid ```` fences are unwrapped first, so the reader gets
   * the diagram text and not three backticks in the middle of a paragraph.
   */
  function mermaidBlocks(value) {
    const raw = String(value === undefined || value === null ? "" : value);
    const blocks = [];
    const rest = raw.replace(/```mermaid[ \t]*\r?\n([\s\S]*?)```/g, (match, code) => {
      blocks.push(code.trim());
      return "";
    });
    const remainder = rest.trim();
    // A hint field often holds the diagram with no fence around it at all.
    if (!blocks.length && /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline)\b/m.test(remainder)) {
      blocks.push(remainder);
      return { text: "", blocks };
    }
    return { text: remainder, blocks };
  }

  function mermaidCard(code) {
    return `<div class="code-block-card glass-card">
            <p class="code-preamble">Diagram source — paste it into mermaid.live to draw it</p>
            <pre><code class="language-mermaid">${escapeHtml(code)}</code></pre>
          </div>`;
  }

  // Version 2 is the data the page is drawn from.
  const SCHEMA_VERSION = 2;

  // ---------------------------------------------------------------------------
  // The document
  // ---------------------------------------------------------------------------

  const VIDEO_FIELDS = ["video_id", "title", "channel", "duration_str", "duration", "thumbnail"];

  function pickFields(source, fields) {
    const out = {};
    if (!source || typeof source !== "object") return out;
    for (const name of fields) {
      if (source[name] !== undefined && source[name] !== null) out[name] = source[name];
    }
    return out;
  }

  function displayTitle(title, order) {
    const textStr = String(title || "").trim();
    const stripped = textStr
      .replace(new RegExp(`^\\s*chapter\\s*0*${order}\\s*[:.\\-–—)]\\s*`, "i"), "")
      .replace(/^\s*chapter\s+\d+\s*[:.\-–—)]\s*(?=\S)/i, "")
      .trim();
    return stripped || textStr;
  }

  /**
   * Build the storable, re-renderable document from a finished run.
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
        const theoryBlock = section.theory_block || {
          explanation: section.explanation || "",
          analogies: section.analogies || (section.analogy ? [section.analogy] : []),
          key_points: section.key_points || section.key_takeaways || [],
          pitfalls: section.pitfalls || section.common_mistakes || [],
          examples: examples,
          code: section.code || [],
          diagram_hint: section.diagram_hint || "",
        };
        return {
          section_id: section.section_id || `${chapterId}-section-${sectionOrder}`,
          section_order: sectionOrder,
          section_title: section.title || section.section_title || `Section ${sectionOrder}`,
          timestamp_seconds: at,
          time_reference: clock(at),
          theory_block: theoryBlock,
          // Backward compatibility: also expose at section level
          examples: theoryBlock.examples,
          key_points: theoryBlock.key_points,
          pitfalls: theoryBlock.pitfalls,
          analogies: theoryBlock.analogies,
          code: theoryBlock.code,
          diagram_hint: theoryBlock.diagram_hint,
          explanation: theoryBlock.explanation,
          analogy: theoryBlock.analogies?.[0],
          degraded: Boolean(section.degraded),
        };
      });

      return {
        chapter_id: chapterId,
        chapter_order: order,
        chapter_title: title,
        display_title: displayTitle(title, order),
        timestamp_seconds: seconds,
        timestamp_str: clock(seconds),
        overview: chapter.overview || "",
        chapter_summary: chapter.chapter_summary || "",
        sections,
        planned: chapter.planned !== false,
      };
    });

    return {
      schema_version: SCHEMA_VERSION,
      video_id: metadata.video_id || "",
      video_metadata: metadata,
      chapters: built,
      meta: {
        provider: meta.provider,
        model: meta.model,
        calls: meta.calls,
        generated_at: meta.generated_at || new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validateNotesDocument(doc) {
    const problems = [];
    if (!doc || typeof doc !== "object") {
      problems.push("no notes were produced");
      return problems;
    }
    // Only check schema version if explicitly provided
    if (doc.schema_version !== undefined && doc.schema_version !== SCHEMA_VERSION) {
      problems.push(`Schema version mismatch: expected ${SCHEMA_VERSION}, got ${doc.schema_version}`);
    }
    if (!doc.video_id) problems.push("no video id");
    if (!doc.video_metadata || !doc.video_metadata.title) problems.push("Missing video title");
    if (!Array.isArray(doc.chapters) || doc.chapters.length === 0) {
      problems.push("no chapters");
    }
    const empty = doc.chapters
      .filter((ch) => !ch || !Array.isArray(ch.sections) || ch.sections.length === 0)
      .map((ch) => String((ch && (ch.chapter_title || ch.title)) || "untitled"));
    if (empty.length) {
      problems.push(`${empty.length} of ${empty.length} chapter(s) have no sections: ${empty.join(", ")}`);
    }
    return problems;
  }

  function coerceNotesDocument(doc) {
    if (typeof doc === "string") {
      try {
        doc = JSON.parse(doc);
      } catch {
        return null;
      }
    }
    if (!doc || typeof doc !== "object") return null;
    if (doc.schema_version === SCHEMA_VERSION && Array.isArray(doc.chapters)) return doc;
    // Old shape: {title, sections, video_id, ...}
    if (doc.title && Array.isArray(doc.sections)) {
      return buildNotesDocument({
        video: {
          video_id: doc.video_id || "",
          title: doc.title,
          channel: doc.channel,
          duration_str: doc.duration_str,
        },
        chapters: [
          {
            chapter_title: doc.title,
            timestamp_seconds: 0,
            sections: doc.sections,
          },
        ],
        meta: {
          provider: doc.provider,
          model: doc.model,
          calls: doc.calls,
          generated_at: doc.generated_at,
        },
      });
    }
    return null;
  }

  function notesDocumentToJson(doc) {
    return JSON.stringify(doc, null, 2);
  }

  function degradedSections(doc) {
    const out = [];
    for (const ch of doc.chapters || []) {
      for (const sec of ch.sections || []) {
        if (sec.degraded) out.push(`${ch.chapter_title} › ${sec.section_title}`);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  function watchUrl(videoId, seconds) {
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Number(seconds || 0)}s`;
  }

  function renderTimestamp(view, seconds, label, className) {
    const at = Number(seconds || 0);
    const labelHtml = `▶ ${escapeHtml(label)}`;
    if (view.player) {
      return `<span class="${className}" data-seconds="${at}" onclick="seekVideo(${at})" style="cursor: pointer;">${labelHtml}</span>`;
    }
    const href = watchUrl(view.videoId, at);
    if (!href) return `<span class="${className}" data-seconds="${at}">${labelHtml}</span>`;
    return `<a class="${className} ts-link" data-seconds="${at}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="Open the lecture on YouTube at this moment">${labelHtml}</a>`;
  }

  // ---------------------------------------------------------------------------
  // Table of Contents (Sidebar)
  // ---------------------------------------------------------------------------

  function renderToc(view, document) {
    const items = (document.chapters || [])
      .map(
        (chapter) => `      <li>
        <a class="toc-link" href="#${escapeHtml(chapter.chapter_id)}">
          <span class="toc-order">${escapeHtml(chapter.chapter_order)}.</span>
          <span class="toc-title">${text(chapter.display_title || chapter.chapter_title)}</span>
          <span class="toc-ts">[${escapeHtml(chapter.timestamp_str)}]</span>
        </a>
      </li>`
      )
      .join("\n");

    return `    <nav class="handbook-toc glass-card" id="handbook-toc">
      <div class="toc-header" onclick="toggleTocFold()" title="Click to Fold / Expand Table of Contents">
        <div class="toc-header-left">
          <svg class="toc-fold-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <h3>Contents</h3>
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

  // ---------------------------------------------------------------------------
  // Section rendering — GeeksforGeeks style
  // ---------------------------------------------------------------------------

  function renderSection(view, section) {
    const seconds = Number(section.timestamp_seconds || 0);
    const theory = section.theory_block || {};

    // Analogy card
    const analogies = (theory.analogies || [])
      .filter((a) => {
        const s = String(a || "").trim().toLowerCase();
        return s && s !== "none" && s !== "n/a" && s !== "na";
      })
      .map(
        (analogy) => `          <div class="analogy-card glass-card">
            <div class="analogy-icon">💡</div>
            <div class="analogy-body">
              <div class="analogy-title">Mental Model & Intuition</div>
              <div class="analogy-text">${renderMarkdown(text(analogy))}</div>
            </div>
          </div>`
      )
      .join("\n");

    // Key Takeaways
    const keyPoints = (section.key_points || []).length
      ? `          <div class="keypoints-card glass-card">
            <h4>Key Takeaways</h4>
            <ul>
${section.key_points.map((point) => `              <li>${renderMarkdown(text(point))}</li>`).join("\n")}
            </ul>
          </div>`
      : "";

    // Common Mistakes
    const mistakes = (theory.pitfalls || theory.common_mistakes || []).length
      ? `          <div class="keypoints-card pitfalls-card glass-card">
            <h4>Common Mistakes</h4>
            <ul>
${(theory.pitfalls || theory.common_mistakes || []).map((point) => `              <li>${renderMarkdown(text(point))}</li>`).join("\n")}
            </ul>
          </div>`
      : "";

    // Concrete Examples
    const concreteExamples = (theory.examples || theory.concrete_examples || [])
      .map(
        (example) => `          <div class="example-card glass-card">
            <span class="example-text">${renderMarkdown(text(example.text || example))}</span>
          </div>`
      )
      .join("\n");

    // Code blocks
    const codeBlocks = (theory.code || [])
      .map(
        (block) => `          <div class="code-block-card glass-card">
            ${block.preamble ? `<p class="code-preamble">${renderMarkdown(text(block.preamble))}</p>` : ""}
            <pre><code class="language-${block.language || "text"}">${escapeHtml(block.code)}</code></pre>
          </div>`
      )
      .join("\n");

    // The diagram hint holds the diagram. It may or may not still be wrapped in
    // ```mermaid fences, so both shapes are accepted.
    const hintedDiagram = mermaidBlocks(theory.diagram_hint || "");
    const diagram =
      hintedDiagram.blocks.length || hintedDiagram.text
        ? `          <div class="diagram-card glass-card">
            <h4>Diagram</h4>
            ${hintedDiagram.blocks.map(mermaidCard).join("\n")}
            ${hintedDiagram.text ? `<p>${text(hintedDiagram.text)}</p>` : ""}
          </div>`
        : "";

    const supplement = section.supplement_block
      ? `          <div class="supplement-card glass-card">
            <div class="supplement-badge">${text(section.supplement_block.external_label || "Further reading")}</div>
            <p>${renderMarkdown(text(section.supplement_block.content || ""))}</p>
          </div>`
      : "";

    // Explanation, with any diagram fences lifted out of the prose and shown as
    // labelled source underneath it.
    const explainedDiagram = mermaidBlocks(theory.explanation || "");
    const explanationHtml = renderMarkdown(textPlain(explainedDiagram.text || ""));
    const explanationCards = explainedDiagram.blocks.map(mermaidCard).join("\n");

    return `          <section class="section-block glass-card" data-chapter-title="${escapeHtml(
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
              <div class="theory-content">${explanationHtml}${explanationCards}</div>
${analogies}
            </div>
${codeBlocks}
${diagram}
${keyPoints}
${mistakes}
${concreteExamples}
${supplement}
          </section>`;
  }

  function renderChapters(view, document) {
    return (document.chapters || [])
      .map((chapter) => {
        const seconds = Number(chapter.timestamp_seconds || 0);
        const sections = (chapter.sections || []).map((section) => renderSection(view, section)).join("\n");
        const overview = chapter.overview
          ? `<p class="chapter-overview">${renderMarkdown(text(chapter.overview))}</p>`
          : "";
        const summary = chapter.chapter_summary
          ? `<div class="chapter-summary-footer"><strong>Summary:</strong> ${renderMarkdown(text(chapter.chapter_summary))}</div>`
          : "";
        return `        <article class="chapter-card glass-card" data-chapter-title="${escapeHtml(
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
${videoId
    ? `<div data-video-id="${escapeHtml(videoId)}" id="yt-player-frame"></div>`
    : `<div class="video-placeholder" style="padding:1.5rem;color:#9ba5b1;font-size:0.85rem;line-height:1.6;text-align:center;">
            This document has no video id, so there is nothing to play beside the notes.
          </div>`}
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
      .join(" · ");

    return `      <header class="handbook-header glass-card">
        <div class="header-top">
          <div class="workspace-brand-area">
            <a class="brand-link" href="#" style="text-decoration: none; display: flex; flex-direction: column;">
              <span class="brand-title">4U BY U</span>
              <span class="brand-subtitle">FOR YOU BY YOU</span>
            </a>
          </div>
        </div>
        <h1 class="video-title">${text(title)}</h1>
        <div class="video-meta">${meta}</div>
        <div class="handbook-controls minimal-toolbar">
          <div class="search-input-wrapper" id="search-input-wrapper">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input id="notes-search" oninput="handleSearchInput(this.value)" onfocus="handleSearchFocus()" placeholder="Search concepts, topics, or code..." type="text" autocomplete="off"/>
            <button type="button" id="search-clear-btn" class="search-clear-btn" onclick="clearHandbookSearch()" style="display: none;" title="Clear Search">&times;</button>
          </div>
          <div class="toolbar-actions">
            ${view.player ? `
            <div class="tab-bar" role="tablist" aria-label="View modes">
              <button type="button" class="tab-btn" id="tab-btn-notes" role="tab" aria-selected="true" onclick="setMobileView('notes')" title="Notes">Notes</button>
              <button type="button" class="tab-btn" id="tab-btn-video" role="tab" aria-selected="false" onclick="setMobileView('video')" title="Video">Video</button>
              <button type="button" class="tab-btn" id="tab-btn-chat" role="tab" aria-selected="false" onclick="setMobileView('chat')" title="Chat">Chat</button>
            </div>` : ''}
            <button type="button" class="btn-tool-sm" id="btn-print" onclick="window.print()" title="Print this page, or save it as a PDF">
              <svg class="print-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
              <span>Save as PDF</span>
            </button>
          </div>
        </div>
      </header>`;
  }

  function renderProvenance(view, document) {
    const metadata = document.video_metadata || {};
    const when = document.generated_at ? String(document.generated_at).replace("T", " ").slice(0, 16) : "";
    const by = [document.provider, document.model].filter(Boolean).join(" / ");
    const parts = [
      when ? `Written ${escapeHtml(when)} UTC` : "",
      by ? `by ${escapeHtml(by)}` : "",
      metadata.title ? `from the captions of “${text(metadata.title)}”` : "",
      "each timestamp opens the lecture on YouTube at that moment",
    ].filter(Boolean);

    const degraded = degradedSections(document);
    const banner = degraded.length
      ? `<div class="notes-banner glass-card">${degraded.length} of ${
          (document.chapters || []).reduce((count, chapter) => count + (chapter.sections || []).length, 0)
        } sections could not be written up, and say why in place. Nothing was invented to fill them in.</div>`
      : "";

    return `<div class="notes-provenance">${parts.join(" · ")}</div>${banner}`;
  }

  // ---------------------------------------------------------------------------
  // The whole page
  // ---------------------------------------------------------------------------

  function renderNotesHtml(document, options = {}) {
    const css = options.css === undefined ? assets.WORKSPACE_CSS : options.css;
    // Add missing CSS rules for TOC folding
    const extraCss = `
    /* TOC fold fix */
    #handbook-toc.toc-folded .toc-list { display: none !important; }
    `;
    const fullCss = css + extraCss;

    const metadata = document.video_metadata || {};
    const title = metadata.title || "Lecture notes";
    const view = { player: Boolean(options.player), videoId: String(document.video_id || "") };

    const toc = renderToc(view, document);
    const chaptersHtml = renderChapters(view, document);
    const header = renderHeader(view, document);
    const provenance = renderProvenance(view, document);

    // KaTeX auto-render script (embedded, no CDN)
    const katexAutoRender = `
    (function() {
      if (window.renderMathInElement) {
        window.renderMathInElement(document.body, {
          delimiters: [
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
          ],
          throwOnError: false,
          trust: true
        });
      }
    })();`;

    // Include constellation background script
    const constellationScript = assets.PAGE_SCRIPTS?.constellation || "";

    // Include splitter script for desktop resizing
    const splitterScript = assets.PAGE_SCRIPTS?.splitter || "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — 4 U By U</title>
  <meta name="generator" content="4 U By U notes page (stylesheet from templates/base_workspace.html (sha ${assets.SOURCE?.css_sha256_12?.slice(0,12) || "unknown"}))" />
  <style>${css}

    /* TOC fold fix */
    #handbook-toc.toc-folded .toc-list { display: none !important; }
  </style>
</head>
<body class="workspace-body">
  <div id="app-workspace" class="${view.player ? "" : "notes-only"}">
    ${header}
    <div class="handbook-main">
      <aside class="handbook-sidebar" id="handbook-sidebar">
        ${toc}
        <div id="search-empty" class="search-empty" style="display: none;">No matching topics found.</div>
      </aside>
      <main class="handbook-pane" id="handbook-pane">
        ${provenance}
        <div class="chapters-container" id="handbook-chapters">
${chaptersHtml}
        </div>
      </main>
      ${view.player ? renderVideoColumn(document) : ""}
    </div>
    ${view.player ? `<div class="resizer v-resizer" id="v-resizer" title="Drag to resize Notes vs. Video"><div class="resizer-handle"></div></div>` : ""}
  </div>
  ${view.player ? `<button type="button" class="floating-companion-fab" id="floating-companion-fab" onclick="toggleSidebar()" title="Show the video beside the notes"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg><span>Show the video</span></button>` : ""}
  ${view.player ? `<script src="https://www.youtube.com/iframe_api"></script>` : ""}
    ${view.player ? `<script>${assets.PAGE_SCRIPTS?.youtube || ""}</script>` : ""}
    <script>
    // Constellation background
    ${constellationScript}

    // Splitter for desktop
    ${splitterScript}

    // KaTeX auto-render
    (function() {
      if (window.renderMathInElement) {
        window.renderMathInElement(document.body, {
          delimiters: [
            {left: '\\\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '\$\$', right: '\$\$', display: true},
            {left: '\$', right: '\$', display: false}
          ],
          throwOnError: false,
          trust: true
        });
      }
    })();

    // Search filter
    const searchInput = document.getElementById('notes-search');
    const clearBtn = document.getElementById('search-clear-btn');
    const sections = document.querySelectorAll('.section-block');
    const chapters = document.querySelectorAll('.chapter-card');
    const tocLinks = document.querySelectorAll('.toc-link');
    const emptyMsg = document.getElementById('search-empty');

    function handleSearchInput(value) {
      const query = value.trim().toLowerCase();
      clearBtn.style.display = query ? 'block' : 'none';
      if (!query) {
        sections.forEach(s => s.style.display = '');
        chapters.forEach(c => c.style.display = '');
        tocLinks.forEach(l => l.style.display = '');
        if (emptyMsg) emptyMsg.style.display = 'none';
        return;
      }
      let visibleCount = 0;
      sections.forEach(section => {
        const text = section.textContent.toLowerCase();
        const match = text.includes(query);
        section.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });
      chapters.forEach(chapter => {
        const hasVisible = chapter.querySelector('.section-block[style=""]') ||
                           chapter.querySelector('.section-block:not([style*="display: none"])');
        chapter.style.display = hasVisible ? '' : 'none';
      });
      tocLinks.forEach(link => {
        const chapterId = link.getAttribute('href').slice(1);
        const chapter = document.getElementById(chapterId);
        const hasVisible = chapter && chapter.querySelector('.section-block[style=""]');
        link.style.display = hasVisible ? '' : 'none';
      });
      if (emptyMsg) emptyMsg.style.display = visibleCount ? 'none' : 'block';
    }

    function clearHandbookSearch() {
      searchInput.value = '';
      handleSearchInput('');
      searchInput.focus();
    }

    function handleSearchFocus() {
      searchInput.select();
    }

    // TOC fold
    function toggleTocFold() {
      const toc = document.getElementById('handbook-toc');
      const hint = document.getElementById('toc-fold-hint');
      if (toc) {
        toc.classList.toggle('toc-folded');
        if (hint) hint.textContent = toc.classList.contains('toc-folded') ? '(Click to expand)' : '(Click to fold)';
      }
    }

    // Sidebar toggle
    function toggleSidebar() {
      const workspace = document.getElementById('app-workspace');
      if (workspace) {
        workspace.classList.toggle('sidebar-collapsed');
      }
    }

    // Smooth scroll for TOC links
    document.querySelectorAll('.toc-link').forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.pushState(null, '', this.getAttribute('href'));
        }
      });
    });

    // Print handling
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('.section-block, .chapter-card').forEach(el => {
        el.style.breakInside = 'avoid';
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === 'Escape') {
        searchInput.blur();
      }
    });
  </script>
</body>
</html>`;

    return html;
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
    PAGE_PRELUDE: "",
    PAGE_EPILOGUE: "",
    NOTES_SCRIPT: "",
    PAGE_STYLE: assets.WORKSPACE_CSS + `
    /* TOC fold fix */
    #handbook-toc.toc-folded .toc-list { display: none !important; }
    `,
    readableMath: prepareMath,
  };
});