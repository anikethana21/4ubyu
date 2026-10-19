#!/usr/bin/env node
/**
 * Serve the generated pages over HTTP, for looking at them.
 *
 * A downloaded page is meant to be opened from disk, and it works that way — but
 * the browser used during development will not open a `file://` address, so this
 * puts the same files on a local port. It serves `extension/dev/out/` and nothing
 * else, resolves every request inside that directory, and sends `no-store` so a
 * page that was just regenerated is never the previous page.
 *
 *   node extension/dev/serve.js          http://127.0.0.1:8787/
 *   node extension/dev/serve.js 9000
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.argv[2] || 8787);
const DIR = path.resolve(path.join(__dirname, "out"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Where a request is looked for, in order.
 *
 * The generated pages are at the root; `/src/` is the pipeline the harness page
 * loads the way the userscript does; `/dev/` is the harness page itself. Every
 * path is still resolved inside its own directory, so none of these can be used to
 * read anything else.
 */
const MOUNTS = [
  ["/src/", path.join(__dirname, "..", "src")],
  ["/dev/", __dirname],
  ["/", DIR],
];

function listing(res, note) {
  const pages = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((name) => name.endsWith(".html")).sort()
    : [];
  res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
  res.end(
    `<!DOCTYPE html><meta charset="utf-8"/><title>4 U By U — generated pages</title>` +
      `<body style="font:14px/1.6 system-ui;background:#1e242c;color:#eee;padding:2rem">` +
      `<h1 style="font-size:1.1rem">Generated pages</h1>` +
      (note ? `<p style="color:#fde68a">${note}</p>` : "") +
      (pages.length
        ? `<ul>${pages.map((name) => `<li><a style="color:#76ABAE" href="/${name}">${name}</a></li>`).join("")}</ul>`
        : `<p>Nothing here yet. Run: node extension/dev/run.js --fake</p>`) +
      `</body>`
  );
}

http
  .createServer((request, response) => {
    const wanted = decodeURIComponent(String(request.url || "/").split("?")[0]);
    const name = wanted.replace(/^\/+/, "");
    if (!name) {
      listing(response, "");
      return;
    }

    const mount = MOUNTS.find(([prefix]) => wanted.startsWith(prefix));
    const base = mount ? mount[1] : DIR;
    const file = path.resolve(base, name.slice(Math.max(0, mount[0].length - 1)));
    // Only ever serve what is inside one of those directories, however the path
    // was written.
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      listing(response, `No file named ${name}.`);
      return;
    }

    response.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      // Development only: lets a page in an origin-less context (about:blank, which
      // is how the downloaded file's behaviour is checked here) fetch a page to
      // test against. A downloaded notes page never asks a server for anything.
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(file).pipe(response);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${PORT}/  serving ${path.relative(process.cwd(), DIR)}`);
  });
