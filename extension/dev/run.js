#!/usr/bin/env node
/**
 * Run one chapter of a captured lecture through the pipeline, from the terminal.
 *
 * The browser is a slow place to find out that a prompt or a parse is wrong, and
 * the userscript cannot be stepped through. This runs the same `core.js` the page
 * will run, over the transcript the userscript already captured, so the pipeline
 * can be developed and checked with no YouTube tab, no video, and no download.
 *
 *   node extension/dev/run.js --fake        no key, no network, no cost
 *   node extension/dev/run.js               one real chapter (a handful of calls)
 *   node extension/dev/run.js --window 600 --length 900 --sections 4
 *   node extension/dev/run.js --json        the notes as data, not as markdown
 *
 * --fake wires a stub in place of the provider that echoes the transcript it was
 * handed. That is the point: it proves which words reached which section, and the
 * notes it prints are the lecture's own words rather than invented ones.
 */

const fs = require("node:fs");
const path = require("node:path");

const ubyu = require("../src/core.js");
const workspace = require("../src/workspace.js");

const ROOT = path.join(__dirname, "..", "..");
const INGEST_DIR = path.join(ROOT, "storage", "ingest");
const DEFAULT_INGEST = "a3b72fed-6e36-4ae6-baae-001c297fce9e";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) return true;
  return value;
}

/** The key from the project's .env, so the command needs no setup. */
function readKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

/** A stand-in for the provider that echoes back what it was given. */
function fakeCaller() {
  let calls = 0;
  return {
    model: "fake-provider",
    provider: "fake",
    get calls() {
      return calls;
    },
    call: async ({ messages }) => {
      calls += 1;
      const prompt = messages[0].content;
      const body = prompt.split("---\n")[1] || prompt;
      return (
        "EXPLANATION\n" +
        body.trim().slice(0, 900) +
        "\n\nKEY POINTS\n- (fake provider: the words above are the lecture's, echoed back)\n"
      );
    },
  };
}

/** The stretch of lecture with the most words in it — a chapter worth running. */
function densestWindow(segments, lengthSeconds) {
  const last = Number(segments[segments.length - 1].start);
  let best = { chars: 0, start: 0 };
  for (let start = 300; start < last - lengthSeconds - 60; start += 60) {
    let chars = 0;
    for (const segment of segments) {
      const at = Number(segment.start);
      if (at >= start && at < start + lengthSeconds) chars += String(segment.text || "").length;
    }
    if (chars > best.chars) best = { chars, start };
  }
  return best.start;
}

async function main() {
  const ingestId = String(arg("ingest", DEFAULT_INGEST));
  const lengthSeconds = Number(arg("length", 720));
  const fake = Boolean(arg("fake"));
  const asJson = Boolean(arg("json"));

  const fixture = path.join(INGEST_DIR, `${ingestId}.json`);
  if (!fs.existsSync(fixture)) {
    console.error(`No captured transcript at ${fixture}`);
    console.error("Capture one from the userscript, or pass --ingest <id>.");
    process.exit(1);
  }
  const record = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const payload = record.payload || record;
  const segments = payload.timed_transcript || [];
  if (!segments.length) {
    console.error("That capture holds no transcript segments.");
    process.exit(1);
  }

  const start = Number(arg("window", densestWindow(segments, lengthSeconds)));
  const end = start + lengthSeconds;
  const transcript = ubyu.segmentsToText(segments, start, end);

  const wanted = Math.max(1, Number(arg("sections", 3)));
  const metadata = payload.video_metadata || payload.metadata || {};
  const chapterTitle = metadata.title || `Lecture ${ingestId.slice(0, 8)}`;

  console.log(`captured lecture : ${ingestId} (${segments.length} segments)`);
  console.log(`video            : ${chapterTitle}`);
  console.log(`window           : ${ubyu.clock(start)}–${ubyu.clock(end)} (${transcript.length.toLocaleString()} chars)`);
  console.log(`sections         : ${wanted}, split evenly — topical sectioning is not ported yet`);

  let caller = fake ? fakeCaller() : null;
  if (!fake) {
    const key = readKey();
    if (!key) {
      console.error("\nNo GROQ_API_KEY in .env or the environment. Use --fake to run without one.");
      process.exit(1);
    }
    caller = ubyu.createCaller({ apiKey: key });
    console.log(`provider         : ${caller.provider} / ${caller.model}`);
  } else {
    console.log("provider         : fake (no key, no network, no cost)");
  }
  console.log("");

  const span = lengthSeconds / wanted;
  const sections = Array.from({ length: wanted }, (unused, index) => ({
    title: `Part ${index + 1}`,
    timestamp_seconds: Math.round(start + index * span),
    transcript: ubyu.segmentsToText(segments, start + index * span, start + (index + 1) * span),
  }));

  const began = Date.now();
  const written = await ubyu.writeChapter(
    { title: chapterTitle, sections },
    {
      call: caller.call,
      concurrency: Math.min(4, wanted),
      onSection: (section, notes) => {
        const state = notes.degraded ? "honest notice instead of notes" : `${notes.key_points.length} key points`;
        console.log(`  ${section.title} (${section.transcript.length.toLocaleString()} chars) -> ${state}`);
      },
    }
  );
  const seconds = ((Date.now() - began) / 1000).toFixed(1);

  const calls = caller.calls;
  console.log("");
  console.log(
    `${calls} model call${calls === 1 ? "" : "s"} for ${wanted} section${wanted === 1 ? "" : "s"}, ` +
      `${written.degraded.length} honest notice${written.degraded.length === 1 ? "" : "s"}, ${seconds}s`
  );

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `notes-${ingestId.slice(0, 8)}-${start}.json`);

  // The page the reader actually opens, built from the same data a library would
  // keep, so this is the real renderer being exercised, not a preview of it.
  const document = workspace.buildNotesDocument({
    video: {
      // The capture names the video at the payload level; the metadata block has
      // the title, channel and duration but not the id.
      video_id: String(payload.video_id || metadata.video_id || metadata.id || ""),
      title: metadata.title,
      channel: metadata.channel || metadata.author,
      duration_str: metadata.duration_str,
      duration: metadata.duration,
    },
    chapters: [
      {
        title: chapterTitle,
        timestamp_seconds: start,
        overview:
          `Captions ${ubyu.clock(start)}–${ubyu.clock(end)}, split into ${wanted} equal part` +
          `${wanted === 1 ? "" : "s"}. Topical chapterization is not ported yet, so the ` +
          "boundaries here are the clock's, not the lecture's.",
        sections: written.sections,
      },
    ],
    meta: { provider: caller.provider, model: caller.model, calls, generated_at: new Date().toISOString() },
  });

  const problems = workspace.validateNotesDocument(document);
  if (problems.length) {
    console.error(`the notes are not renderable: ${problems.join("; ")}`);
    process.exit(1);
  }
  const pagePath = path.join(outDir, `page-${ingestId.slice(0, 8)}-${start}.html`);
  const withPlayer = Boolean(arg("player"));
  fs.writeFileSync(pagePath, workspace.renderNotesHtml(document, { player: withPlayer }), "utf8");
  // What is saved is the document, not this run: the page is a rendering of it, and
  // `render.js` can draw it again without a model. A saved run that could not be
  // re-rendered would be a screenshot of the work rather than the work.
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2), "utf8");

  if (asJson) {
    console.log(JSON.stringify(written, null, 2));
  } else {
    for (const section of written.sections) {
      console.log(`\n${"=".repeat(72)}\n## ${section.title}\n`);
      console.log(section.explanation);
      if (section.analogy) console.log(`\n**Analogy:** ${section.analogy}`);
      if (section.key_points.length) {
        console.log("\n**Key points**");
        for (const point of section.key_points) console.log(`- ${point}`);
      }
      if (section.pitfalls.length) {
        console.log("\n**Pitfalls**");
        for (const pitfall of section.pitfalls) console.log(`- ${pitfall}`);
      }
      if (section.examples.length) {
        console.log("\n**Examples**");
        for (const example of section.examples) console.log(`- ${example}`);
      }
    }
  }
  console.log(`\nnotes data written to ${path.relative(ROOT, outPath)}`);
  console.log(`page written to       ${path.relative(ROOT, pagePath)}`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
