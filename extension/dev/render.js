#!/usr/bin/env node
/**
 * Draw a notes page from notes data, without asking a model for anything.
 *
 * This is the point of keeping the notes as data: the page is a rendering of the
 * document, so a document on disk can be drawn again — a second time, with a fixed
 * renderer, on another machine, or years later — and it costs nothing, because no
 * model is involved. It is also how the page is checked during development, where
 * paying for a run every time a stylesheet changed would be absurd.
 *
 * Two shapes are accepted, because both are lying around after a run:
 *
 *   - a notes document (`{chapters: [...]}`), which is what a library keeps
 *   - a run's output (`{title, sections: [...]}`), which is what `run.js` writes
 *
 *   node extension/dev/render.js extension/dev/out/notes-a3b72fed-7020.json
 *   node extension/dev/render.js notes.json --out page.html
 */

const fs = require("node:fs");
const path = require("node:path");

const workspace = require("../src/workspace.js");

const ROOT = path.join(__dirname, "..", "..");

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node extension/dev/render.js <notes.json> [--out page.html]");
  process.exit(1);
}

function parseArgs(argv) {
  const files = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      out = argv[index + 1];
      if (!out) usage("--out needs a path");
      index += 1;
    } else if (arg.startsWith("--")) {
      usage(`unknown option ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return { files, out };
}

/** Turn either shape into a notes document, or say why it cannot. */
function toDocument(value) {
  if (value && Array.isArray(value.chapters)) return value;

  if (value && Array.isArray(value.sections)) {
    // A run's output: one chapter, whose title is the video's. Chapterization is
    // not part of this tool, so it does not pretend the boundaries are topical.
    return workspace.buildNotesDocument({
      video: {
        video_id: value.video_id || "",
        title: value.title,
        channel: value.channel,
        duration_str: value.duration_str,
      },
      chapters: [
        {
          title: value.title || "Notes",
          timestamp_seconds: Number(value.timestamp_seconds || 0),
          sections: value.sections,
        },
      ],
      meta: { provider: value.provider, model: value.model, calls: value.calls },
    });
  }

  return null;
}

const { files, out } = parseArgs(process.argv.slice(2));
if (!files.length) usage();

for (const file of files) {
  const input = path.resolve(file);
  if (!fs.existsSync(input)) usage(`no such file: ${file}`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(input, "utf8"));
  } catch (error) {
    console.error(`${file}: not JSON — ${error.message}`);
    process.exit(1);
  }

  const document = toDocument(parsed);
  if (!document) {
    console.error(`${file}: neither a notes document nor a run's output`);
    process.exit(1);
  }

  const problems = workspace.validateNotesDocument(document);
  if (problems.length) {
    console.error(`${file}: not renderable — ${problems.join("; ")}`);
    process.exit(1);
  }

  const target = out
    ? path.resolve(out)
    : path.join(path.dirname(input), path.basename(input).replace(/\.json$/i, "") + ".html");
  fs.writeFileSync(target, workspace.renderNotesHtml(document), "utf8");

  const sections = document.chapters.reduce((count, chapter) => count + chapter.sections.length, 0);
  const notices = workspace.degradedSections(document).length;
  console.log(
    `${path.relative(ROOT, input)} → ${path.relative(ROOT, target)}  ` +
      `(${document.chapters.length} chapter(s), ${sections} section(s)` +
      `${notices ? `, ${notices} written as a notice` : ""})`
  );
}
