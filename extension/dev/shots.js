#!/usr/bin/env node
/**
 * Capture the screenshots the Chrome Web Store listing needs, at the exact size
 * the store accepts (1280x800), from the real panel and a real notes page.
 *
 *   node extension/dev/serve.js          # in one terminal
 *   node extension/dev/shots.js          # in another
 *
 * Why CDP and not `chrome --screenshot`: on Windows, headless Chrome treats
 * `--window-size` as the size of a window, not of the page, so asking for
 * 1280x800 produced a 1262x704 viewport inside a 1280x800 image and cut the
 * panel off at the bottom. Emulation sets the viewport itself.
 *
 * The lecture, the captions and the provider are the harness's stand-ins, and
 * the notes page is written by the real pipeline from that one run — the same
 * code path a user's lecture takes, with the network replaced.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "store", "screenshots");
const SCRATCH = path.join(__dirname, "out");
const PORT = 9333;
const BASE = "http://127.0.0.1:8787";
const VIEWPORT = { width: 1280, height: 800 };
const HARNESS = `${BASE}/dev/panel-harness.html`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  console.error("Chrome was not found. Set CHROME_PATH.");
  process.exit(1);
}

async function waitForDevtools() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch (error) {
      // Chrome is still coming up.
    }
    await sleep(150);
  }
  throw new Error("Chrome did not open a debugging port.");
}

/** A very small CDP client: one socket, requests matched by id. */
async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    /** Run an expression in the page and return its JSON value. */
    async eval(expression, timeout = 40000) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "the page threw while evaluating");
      }
      return result.result.value;
    },
    close() {
      socket.close();
    },
  };
}

/** Resolve once the panel has passed a point in its run. */
function untilRun(percent, { quote = false, timeout = 180000 } = {}) {
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const state = window.PANEL && window.PANEL.state;
      const chip = document.querySelector("#ubyu-quote");
      const visible = chip && chip.getAttribute("data-visible") === "1";
      const ready = state && state.percent >= ${percent} && state.step === "running" && (${quote} ? visible : true);
      if (ready) { clearInterval(tick); resolve(state.percent); }
      else if (Date.now() - started > ${timeout}) { clearInterval(tick); reject(new Error("the run did not reach ${percent}%")); }
    }, 120);
  })`;
}

/** Resolve once the run is finished and the page is in hand. */
function untilDone(timeout = 600000) {
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const state = window.PANEL && window.PANEL.state;
      if (state && state.step === "done" && state.document) { clearInterval(tick); resolve(true); }
      else if (Date.now() - started > ${timeout}) { clearInterval(tick); reject(new Error("the run did not finish")); }
    }, 200);
  })`;
}

async function main() {
  try {
    const probe = await fetch(`${BASE}/preview-layout.html`, { method: "HEAD" });
    if (!probe.ok) throw new Error("not ok");
  } catch (error) {
    console.error(`The dev server is not answering on ${BASE}.\nRun \`node extension/dev/serve.js\` first.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SCRATCH, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ubyu-shots-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const exited = new Promise((resolve) => chrome.on("exit", resolve));

  let client;
  const shots = [];
  const capture = async (name, note) => {
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    const png = fs.readFileSync(file);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
      throw new Error(`${name} came back ${width}x${height}, not 1280x800`);
    }
    shots.push({ name, note });
    console.log(`wrote store/screenshots/${name}.png — ${width}x${height} · ${note}`);
  };

  try {
    const page = await waitForDevtools();
    client = await connect(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // 1. Ready to run: the estimate, before any tokens are spent.
    await client.send("Page.navigate", { url: `${HARNESS}?demo=1&shot=lecture` });
    await sleep(2400);
    await capture("01-estimate", "the panel ready to run, with the estimate before anything is spent");

    // 2 and 3. One run, watched twice: mid-way for the progress, the quote and
    //    the log, then again when it finishes. The pacing is real here — it waits
    //    for the minute's allowance the way it would on a free key — so this pair
    //    takes a few minutes of wall clock.
    await client.send("Page.navigate", { url: `${HARNESS}?demo=1&run=1&shot=lecture` });
    await sleep(2200);
    await client.eval(untilRun(12, { quote: true }));
    await sleep(450);
    await capture("02-writing", "mid-run: progress, the quote, and the log of what it is doing");

    await client.eval(untilDone());
    await sleep(400);
    await capture("03-done", "the run finished: one file, ready to download");

    // The notes page is written by the real pipeline from that same run, rather
    // than by the layout fixture, so the screenshots show what a run produces.
    const document = await client.eval("JSON.stringify(window.PANEL.state.document)");
    const notesFile = path.join(SCRATCH, "harness-notes.html");
    const workspace = require(path.join(__dirname, "..", "src", "workspace.js"));
    fs.writeFileSync(notesFile, workspace.renderNotesHtml(JSON.parse(document), {}), "utf8");

    // 4. The page it downloads.
    await client.send("Page.navigate", { url: `${BASE}/harness-notes.html` });
    await sleep(1400);
    await capture("04-notes-page", "the study page the run downloads, in one self-contained file");

    // 5. The notes themselves, further down the same page.
    await client.send("Page.navigate", { url: `${BASE}/harness-notes.html#chapter-3` });
    await sleep(1700);
    await capture("05-notes-sections", "the notes themselves, one section per idea");

    // The small promo tile is drawn at its own size rather than cropped from a
    // bigger page, so the type stays sharp at 440 px.
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 440,
      height: 280,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Page.navigate", {
      url: "file:///" + path.join(ROOT, "store", "promo", "promo.html").replace(/\\/g, "/"),
    });
    await sleep(900);
    const promo = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const promoFile = path.join(ROOT, "store", "promo", "promo-440x280.png");
    fs.writeFileSync(promoFile, Buffer.from(promo.data, "base64"));
    const promoPng = fs.readFileSync(promoFile);
    if (promoPng.readUInt32BE(16) !== 440 || promoPng.readUInt32BE(20) !== 280) {
      throw new Error("the promo tile did not come back 440x280");
    }
    console.log("wrote store/promo/promo-440x280.png — 440x280 · the small promo tile");
  } finally {
    if (client) client.close();
    chrome.kill();
    await Promise.race([exited, sleep(4000)]);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      // Windows holds the profile open for a moment after exit; the scratch
      // directory is in the temp folder and costs nothing to leave behind.
    }
  }

  fs.writeFileSync(
    path.join(OUT, "shots.json"),
    JSON.stringify({ viewport: VIEWPORT, shots }, null, 2) + "\n",
    "utf8"
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
