/**
 * Turning a model's answer into HTML the page can show, without trusting it.
 *
 * The server's page emitted the model's explanation as escaped text and then had
 * `marked` re-parse it in the browser, with the result assigned to `innerHTML`.
 * `marked` passes raw HTML through, so an answer containing `<img onerror=...>`
 * would run in the page — and the answer is written from a transcript that a
 * stranger's video supplies. That is a small hole, but it is a real one, and it
 * costs nothing to close.
 *
 * So the markdown is rendered here instead, by hand, emitting only a fixed set of
 * tags. Nothing the model writes can become a tag that was not in the list below:
 * text is escaped first, and every tag in the output was typed in this file.
 *
 * The other reason it is rendered here is that the page then needs no markdown
 * library. A downloaded copy of the notes works with no network at all, apart
 * from the video itself.
 *
 * LaTeX survives: `\(...\)` and `\[...\]` are lifted out before any other rule
 * runs, so `**` inside an equation is not read as emphasis, and they are put back
 * exactly as the model wrote them for MathJax to typeset. The extraction happens
 * after escaping, so an equation containing `<script>` is inert too — MathJax
 * reads the node's text content, which escaping leaves intact.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UBYU_MARKDOWN = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** Escape the five characters that can start markup. Everything else is text. */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // A character no model writes, so a placeholder can never collide with text.
  const MARK = "\u0000";

  function stash(store, html) {
    return `${MARK}${store.push(html) - 1}${MARK}`;
  }

  function unstash(text, store) {
    // One pass, looping until nothing is left: a placeholder may itself hold
    // stored fragments (a code span containing an inline link, for instance).
    let out = text;
    for (let pass = 0; pass < 6 && out.includes(MARK); pass += 1) {
      out = out.replace(
        new RegExp(`${MARK}(\\d+)${MARK}`, "g"),
        (whole, index) => (store[Number(index)] === undefined ? whole : store[Number(index)])
      );
    }
    return out;
  }

  const HEADING = /^(#{1,6})\s+(.*)$/;
  const BULLET = /^[-*+]\s+(.*)$/;
  const NUMBERED = /^\d+[.)]\s+(.*)$/;
  const RULE = /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/;
  const TABLE_DIVIDER = /^\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/;

  /** Inline markup, applied to already-escaped text. */
  function inline(text, store) {
    let out = text;

    // Code spans first, so `**this**` inside backticks stays literal.
    out = out.replace(/`([^`]+)`/g, (whole, code) => stash(store, `<code>${code}</code>`));

    // Links, but only to schemes a reader can safely follow. Anything else is
    // left as the text the model wrote rather than becoming a live link.
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      if (!/^(https?:|mailto:)/i.test(href)) return whole;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

    return out;
  }

  /** Split a table row on pipes, trimming one leading and trailing pipe. */
  function tableCells(line) {
    return line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  /**
   * Render markdown to HTML using only the tags listed in this file.
   *
   * Supported: paragraphs, `#`..`######` headings, `-`/`*`/`+` and `1.` lists,
   * `>` quotes, fenced code blocks, horizontal rules, pipe tables, and the inline
   * forms above. Anything else is text, which is exactly what should happen to
   * something this file does not understand.
   */
  function renderMarkdown(text) {
    if (text === null || text === undefined) return "";
    const source = String(text).replace(/\r\n?/g, "\n");
    if (!source.trim()) return "";

    const store = [];

    // Placeholder indices that are block-level, so a display equation is not
    // wrapped in a paragraph — a `<div class="math-display-card">` inside a `<p>`
    // is invalid markup and renders with the wrong spacing.
    const blockPlaceholders = new Set();

    // 1. Escape everything, so nothing below can emit a tag that is not written here.
    let body = escapeHtml(source);

    // 2. Lift LaTeX out. Display equations get the card the stylesheet styles;
    //    inline equations are left as the delimiters MathJax looks for.
    body = body.replace(/\\\[([\s\S]*?)\\\]/g, (whole, math) => {
      const index = store.push(`<div class="math-display-card">\\[${math}\\]</div>`) - 1;
      blockPlaceholders.add(index);
      return `${MARK}${index}${MARK}`;
    });
    body = body.replace(/\\\(([\s\S]*?)\\\)/g, (whole, math) => stash(store, `\\(${math}\\)`));

    const lines = body.split("\n");
    const out = [];
    let paragraph = [];

    const flush = () => {
      if (!paragraph.length) return;
      out.push(`<p>${paragraph.map((line) => inline(line, store)).join("\n")}</p>`);
      paragraph = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        flush();
        continue;
      }

      // A display equation standing on its own line is a block, not a sentence.
      const soleMath = trimmed.match(/^\u0000(\d+)\u0000$/);
      if (soleMath && blockPlaceholders.has(Number(soleMath[1]))) {
        flush();
        out.push(trimmed);
        continue;
      }

      // Fenced code: taken as written, and deliberately not rendered as markdown.
      const fence = trimmed.match(/^```+\s*([\w+-]*)\s*$/);
      if (fence) {
        flush();
        const language = fence[1] || "";
        const code = [];
        index += 1;
        while (index < lines.length && !lines[index].trim().startsWith("```")) {
          code.push(lines[index]);
          index += 1;
        }
        out.push(
          `<pre><code${language ? ` class="language-${language}"` : ""}>${code.join("\n")}</code></pre>`
        );
        continue;
      }

      if (RULE.test(trimmed)) {
        flush();
        out.push("<hr/>");
        continue;
      }

      const heading = trimmed.match(HEADING);
      if (heading) {
        flush();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2].trim(), store)}</h${level}>`);
        continue;
      }

      // A table: a row of cells, then a divider row, then more rows.
      if (trimmed.includes("|") && lines[index + 1] && TABLE_DIVIDER.test(lines[index + 1].trim())) {
        flush();
        const header = tableCells(trimmed);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim().includes("|")) {
          rows.push(tableCells(lines[index].trim()));
          index += 1;
        }
        index -= 1;
        const head = header.map((cell) => `<th>${inline(cell, store)}</th>`).join("");
        const body_rows = rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inline(cell, store)}</td>`).join("")}</tr>`
          )
          .join("");
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body_rows}</tbody></table>`);
        continue;
      }

      if (BULLET.test(trimmed)) {
        flush();
        const cells = [];
        while (index < lines.length && BULLET.test(lines[index].trim())) {
          cells.push(BULLET.exec(lines[index].trim())[1]);
          index += 1;
        }
        index -= 1;
        out.push(`<ul>${cells.map((cell) => `<li>${inline(cell, store)}</li>`).join("")}</ul>`);
        continue;
      }

      if (NUMBERED.test(trimmed)) {
        flush();
        const cells = [];
        while (index < lines.length && NUMBERED.test(lines[index].trim())) {
          cells.push(NUMBERED.exec(lines[index].trim())[1]);
          index += 1;
        }
        index -= 1;
        out.push(`<ol>${cells.map((cell) => `<li>${inline(cell, store)}</li>`).join("")}</ol>`);
        continue;
      }

      if (trimmed.startsWith("&gt;")) {
        flush();
        const quoted = [];
        while (index < lines.length && lines[index].trim().startsWith("&gt;")) {
          quoted.push(lines[index].trim().replace(/^&gt;\s?/, ""));
          index += 1;
        }
        index -= 1;
        out.push(`<blockquote>${quoted.map((line) => inline(line, store)).join("<br/>")}</blockquote>`);
        continue;
      }

      paragraph.push(trimmed);
    }
    flush();

    return unstash(out.join("\n"), store);
  }

  /** Markdown for a card body: same renderer, trimmed. */
  function renderInlineText(text) {
    return renderMarkdown(String(text || "").trim());
  }

  return { escapeHtml, renderMarkdown, renderInlineText };
});
