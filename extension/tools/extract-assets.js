#!/usr/bin/env node
/**
 * Lift the workspace page's stylesheet and browser scripts out of the server's
 * template, verbatim, into a module the extension can use.
 *
 * The stylesheet is the product's face: about 3,900 lines of glassmorphic layout
 * that took real work to get right. Rewriting it by hand for the extension would
 * mean re-earning all of that, and then two stylesheets to keep in step. So the
 * extension reuses it exactly as it is, and this script is how it gets there:
 * mechanically, with the source hashed, so `--check` can say whether the copy in
 * the repo still matches the template it came from.
 *
 * What is copied:
 *   - every <style> block in templates/base_workspace.html, in order
 *   - static/js/constellation_grid.js   (decorative background)
 *   - static/js/workspace_splitter.js   (panes, sidebar, table-of-contents fold)
 *   - static/js/yt_sync_controller.js   (player, seeking, handbook search)
 *
 * What is not: rag_chat_client.js, which talks to the server's chat endpoint. The
 * extension has no server and no chatbot.
 *
 * One thing is changed rather than copied: the stylesheet points at two third-party
 * font servers, and both references are removed. A downloaded page is opened from
 * disk with no server behind it, and a page that quietly calls out to a font CDN
 * gives the reader's address to a stranger for a serif, and then renders whatever
 * comes back. Neither font is load-bearing: the brand face is already embedded as
 * bytes (see inlineLocalUrls), and every other font in the stack has a substitute
 * one step behind it. Removing them makes the page's network behaviour a property
 * that can be checked rather than hoped for, so this script now *asserts* that the
 * stylesheet mentions no address at all.
 *
 *   node extension/tools/extract-assets.js           write extension/src/assets.js
 *   node extension/tools/extract-assets.js --check   fail if it is out of date
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..", "..");
const TEMPLATE = path.join(ROOT, "templates", "base_workspace.html");
const OUT = path.join(ROOT, "extension", "src", "assets.js");

const PAGE_SCRIPTS = {
  constellation: path.join(ROOT, "static", "js", "constellation_grid.js"),
  splitter: path.join(ROOT, "static", "js", "workspace_splitter.js"),
  youtube: path.join(ROOT, "static", "js", "yt_sync_controller.js"),
};

function digest(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

/**
 * Embed every local file the stylesheet points at.
 *
 * The stylesheet refers to the brand font as `/static/fonts/gagalin-regular.woff2`,
 * which is the server's own path — on a downloaded page there is no server, so the
 * request 404s and the brand title falls back to a substitute. The font is 94 KB;
 * as a data URI it costs about a third more and is then *in* the file, which is the
 * whole point of the file. A referenced file that cannot be found is fatal here:
 * silently shipping a page that 404s on its own chrome is exactly the kind of
 * failure this project keeps having to fix.
 */
function inlineLocalUrls(css) {
  const embedded = [];
  const missing = [];
  const pattern = /url\((['"]?)(\/(?!\/)[^)'"]*)\1\)/g;

  const out = css.replace(pattern, (whole, quote, urlPath) => {
    const candidates = [
      path.join(ROOT, urlPath.replace(/^\//, "").replace(/^static\//, "static/")),
      path.join(ROOT, "static", urlPath.replace(/^\//, "")),
      path.join(ROOT, urlPath.replace(/^\//, "")),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!found) {
      missing.push(urlPath);
      return whole;
    }
    const bytes = fs.readFileSync(found);
    const mime = MIME[path.extname(found).toLowerCase()] || "application/octet-stream";
    embedded.push({ path: urlPath, from: path.relative(ROOT, found), bytes: bytes.length, mime });
    return `url("data:${mime};base64,${bytes.toString("base64")}")`;
  });

  if (missing.length) {
    console.error(
      `The stylesheet points at files that do not exist, so a page built from it ` +
        `would 404: ${missing.join(", ")}`
    );
    process.exit(1);
  }
  return { css: out, embedded };
}

/**
 * Remove every reference the stylesheet makes to another server.
 *
 * Two shapes occur: a remote stylesheet pulled in with `@import`, and a remote
 * fallback inside an `@font-face src` list that already has the embedded font in
 * front of it. The second is the more dangerous of the two, because it looks
 * harmless — the browser only reaches it if the first source fails — while a page
 * opened off a laptop with a flaky connection is exactly where a data URI is most
 * likely to be the one that did load. Both go, and what went is recorded in the
 * provenance so the removal is visible rather than silent.
 */
function stripRemoteRequests(css) {
  const removed = [];

  let out = css.replace(
    /@import\s+url\((['"]?)(https?:[^)'"]+)\1\)\s*;?/gi,
    (whole, quote, url) => {
      removed.push({ kind: "import", url });
      // The address deliberately does not appear in the comment: the point of this
      // function is that the finished stylesheet contains no address, and a comment
      // is part of the stylesheet.
      return "/* a remote font stylesheet was removed here by extract-assets.js */";
    }
  );

  out = out.replace(
    /,?\s*url\((['"]?)(https?:[^)'"]+)\1\)(\s*format\((['"])[^'"]*\4\))?/gi,
    (whole, quote, url) => {
      removed.push({ kind: "font-src", url });
      return "";
    }
  );

  // The invariant, stated as code. If a future edit to the template adds a third
  // remote reference, this says so instead of shipping a page that phones home.
  const stillRemote = out.match(/https?:\/\/[^\s)"']+/g) || [];
  if (stillRemote.length) {
    console.error(
      "The stylesheet would still request these addresses, and a downloaded page must " +
        `request none: ${stillRemote.join(", ")}`
    );
    process.exit(1);
  }
  return { css: out, removed };
}

function read(file) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(ROOT, file)} — run this from the project root.`);
    process.exit(1);
  }
  return fs.readFileSync(file, "utf8");
}

function main() {
  const template = read(TEMPLATE);

  // Every <style> block, in the order the browser would apply them. Later blocks
  // override earlier ones, so the order is part of the stylesheet's meaning.
  const cssBlocks = [...template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
  if (!cssBlocks.length) {
    console.error("No <style> blocks found in the template — refusing to write an unstyled page.");
    process.exit(1);
  }
  const rawCss = cssBlocks.join("\n");
  const inlined = inlineLocalUrls(rawCss);
  const stripped = stripRemoteRequests(inlined.css);
  const css = stripped.css;
  const embedded = inlined.embedded;
  const removed = stripped.removed;

  const scripts = {};
  for (const [name, file] of Object.entries(PAGE_SCRIPTS)) {
    scripts[name] = read(file);
  }

  const banner =
    `/**\n` +
    ` * Generated by extension/tools/extract-assets.js — do not edit by hand.\n` +
    ` *\n` +
    ` * Copied verbatim from the server's workspace page so the extension's page and the\n` +
    ` * one the server drew are the same design, not two designs that resemble each other.\n` +
    ` * Re-run the generator after changing templates/base_workspace.html or static/js/.\n` +
    ` */\n`;

  const body =
    banner +
    `(function (root, factory) {\n` +
    `  const api = factory();\n` +
    `  if (typeof module === "object" && module.exports) module.exports = api;\n` +
    `  else root.UBYU_ASSETS = api;\n` +
    `})(typeof globalThis !== "undefined" ? globalThis : this, function () {\n` +
    `  "use strict";\n\n` +
    `  const WORKSPACE_CSS = ${JSON.stringify(css)};\n\n` +
    `  const PAGE_SCRIPTS = {\n` +
    `    constellation: ${JSON.stringify(scripts.constellation)},\n` +
    `    splitter: ${JSON.stringify(scripts.splitter)},\n` +
    `    youtube: ${JSON.stringify(scripts.youtube)},\n` +
    `  };\n\n` +
    `  // Provenance: which template this copy came from, so a stale copy is visible.\n` +
    `  const SOURCE = ${JSON.stringify(
      {
        template: "templates/base_workspace.html",
        css_blocks: cssBlocks.length,
        css_chars: css.length,
        css_sha256_12: digest(css),
        // Addresses deliberately removed: the page fetches nothing.
        remote_removed: removed,
        embedded: embedded.map((entry) => ({
          path: entry.path,
          from: entry.from,
          bytes: entry.bytes,
        })),
        scripts: Object.fromEntries(
          Object.entries(scripts).map(([name, text]) => [
            name,
            { chars: text.length, sha256_12: digest(text) },
          ])
        ),
      },
      null,
      2
    ).replace(/\n/g, "\n  ")};\n\n` +
    `  return { WORKSPACE_CSS, PAGE_SCRIPTS, SOURCE };\n` +
    `});\n`;

  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    const currentCss = current.match(/const WORKSPACE_CSS = ("(?:[^"\\]|\\.)*");/);
    const same =
      currentCss && JSON.parse(currentCss[1]) === css ? true : false;
    if (!same) {
      console.error(
        `extension/src/assets.js is out of date with ${path.relative(ROOT, TEMPLATE)} ` +
          `(css ${digest(css)}). Re-run: node extension/tools/extract-assets.js`
      );
      process.exit(1);
    }
    console.log(`assets.js is current (css ${digest(css)})`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, "utf8");
  const kb = (text) => `${Math.round(text.length / 1024)} KB`;
  console.log(`${path.relative(ROOT, OUT)} written`);
  console.log(`  stylesheet : ${cssBlocks.length} blocks, ${kb(css)}, sha ${digest(css)}`);
  for (const entry of embedded) {
    console.log(`  embedded   : ${entry.path} (${kb("x".repeat(entry.bytes))} from ${entry.from})`);
  }
  for (const entry of removed) {
    console.log(`  not fetched: ${entry.url} (${entry.kind})`);
  }
  for (const [name, text] of Object.entries(scripts)) {
    console.log(`  ${name.padEnd(11)}: ${kb(text)}, sha ${digest(text)}`);
  }
}

main();
