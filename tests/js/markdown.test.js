/**
 * The markdown renderer's whole job is to emit tags it typed itself.
 *
 * These tests exist mostly for the last ones: a model's answer is written from a
 * transcript supplied by a stranger's video, and the page shows it. Anything the
 * model writes must come out as text or as one of a handful of fixed tags — never
 * as markup it chose.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const markdown = require("../../extension/src/markdown.js");
const { renderMarkdown, escapeHtml } = markdown;

test("nothing renders as an empty string or a crash", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(undefined), "");
  assert.equal(renderMarkdown("   \n  \n"), "");
});

test("HTML in an answer is text, not markup", () => {
  const html = renderMarkdown('Before <script>alert("x")</script> <img src=x onerror="alert(1)"> after');
  assert.doesNotMatch(html, /<script/i, "the tag never becomes a tag");
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  // The words survive as text, but the quote that would close an attribute is
  // escaped, so `onerror` here can never be an attribute of a real element.
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("paragraphs, bold, italics and code are rendered from the fixed tag set", () => {
  const html = renderMarkdown("The **gate** is *not* a `switch`, it is a **filter**.");
  assert.equal(
    html,
    "<p>The <strong>gate</strong> is <em>not</em> a <code>switch</code>, it is a <strong>filter</strong>.</p>"
  );
});

test("emphasis markers inside code are left alone", () => {
  const html = renderMarkdown("Use `a ** b` for power.");
  assert.equal(html, "<p>Use <code>a ** b</code> for power.</p>");
});

test("headings become headings, at the level the model asked for", () => {
  const html = renderMarkdown("### This section could not be written up\n\nSome body.");
  assert.match(html, /<h3>This section could not be written up<\/h3>/);
  assert.match(html, /<p>Some body\.<\/p>/);
});

test("lists are lists, with or without a leading marker style", () => {
  const bullets = renderMarkdown("- one\n- two\n- three");
  assert.equal(bullets, "<ul><li>one</li><li>two</li><li>three</li></ul>");

  const numbered = renderMarkdown("1. first\n2. second");
  assert.equal(numbered, "<ol><li>first</li><li>second</li></ol>");
});

test("a quoted transcript stays a quotation", () => {
  const html = renderMarkdown("> the instructor said this\n> and then this");
  assert.match(html, /<blockquote>the instructor said this<br\/>and then this<\/blockquote>/);
});

test("fenced code is shown as written, never parsed as markdown", () => {
  const html = renderMarkdown("```python\nx = **not bold**\n```");
  assert.equal(html, '<pre><code class="language-python">x = **not bold**</code></pre>');
});

test("a comparison table becomes a table", () => {
  const html = renderMarkdown("| Gate | Role |\n|---|---|\n| Forget | drops state |\n| Input | adds state |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>Gate<\/th>/);
  assert.match(html, /<td>Input<\/td>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});

test("links only become links when a reader can safely follow them", () => {
  assert.match(
    renderMarkdown("[the paper](https://arxiv.org/abs/1409.3215)"),
    /<a href="https:\/\/arxiv\.org\/abs\/1409\.3215" target="_blank" rel="noopener noreferrer">the paper<\/a>/
  );
  const dangerous = renderMarkdown("[click](javascript:alert(1))");
  assert.doesNotMatch(dangerous, /<a /);
  assert.match(dangerous, /\[click\]\(javascript:alert\(1\)\)/);
});

test("LaTeX survives, inline and displayed, with its delimiters intact", () => {
  const html = renderMarkdown("The state is \\(h_t = \\tanh(W x_t)\\) at each step.");
  assert.match(html, /\\\(h_t = \\tanh\(W x_t\)\\\)/, "MathJax needs the delimiters exactly as written");
  assert.doesNotMatch(html, /<em>/, "and the underscores in math are not emphasis");
});

test("display equations get the card, and the asterisks inside them are not emphasis", () => {
  const html = renderMarkdown("\\[ a * b = c \\]");
  assert.equal(html, '<div class="math-display-card">\\[ a * b = c \\]</div>');
});

test("an equation cannot smuggle markup either", () => {
  const html = renderMarkdown("\\( <script>alert(1)</script> \\)");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;/);
});

test("escapeHtml covers the five characters that can begin markup", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});
