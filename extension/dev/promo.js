#!/usr/bin/env node
/**
 * Draw the two promo tiles at exactly their advertised sizes.
 *
 *   node extension/dev/promo.js
 *
 * This is the cheap half of `shots.js`: no pipeline, no lecture, no dev server.
 * Each tile is a plain local HTML file drawn at its own pixel size, so the type
 * stays sharp instead of being a scaled crop of a bigger page.
 *
 *   store/promo/promo.html     -> store/promo/promo-440x280.png
 *   store/promo/marquee.html   -> store/promo/promo-1400x560.png
 *
 * CDP and not `chrome --screenshot`: on Windows, headless Chrome treats
 * `--window-size` as the size of a window, not of the page, so the capture
 * comes back smaller than asked. Emulation sets the viewport itself.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const PORT = 9334;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TILES = [
  { file: "promo.html", out: "promo-440x280.png", width: 440, height: 280 },
  { file: "marquee.html", out: "promo-1400x560.png", width: 1400, height: 560 },
];

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
    close() {
      socket.close();
    },
  };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ubyu-promo-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
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
  try {
    const page = await waitForDevtools();
    client = await connect(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    for (const tile of TILES) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: tile.width,
        height: tile.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await client.send("Page.navigate", {
        url:
          "file:///" +
          path.join(ROOT, "store", "promo", tile.file).replace(/\\/g, "/"),
      });
      await sleep(1200);
      const { data } = await client.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const out = path.join(ROOT, "store", "promo", tile.out);
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      const png = fs.readFileSync(out);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      if (width !== tile.width || height !== tile.height) {
        throw new Error(`${tile.out} came back ${width}x${height}, not ${tile.width}x${tile.height}`);
      }
      console.log(`wrote store/promo/${tile.out} — ${width}x${height}`);
    }
  } finally {
    if (client) client.close();
    chrome.kill();
    await Promise.race([exited, sleep(4000)]);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      // Windows holds the profile open for a moment after exit.
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
