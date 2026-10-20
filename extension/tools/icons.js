#!/usr/bin/env node
/**
 * Rasterise `extension/assets/icon.svg` at the sizes Chrome and the store ask for.
 *
 * The store wants 128 px, the extensions page draws 48, the toolbar draws 32 and
 * 16. Rather than keep four hand-made PNGs in step, one vector file carries the
 * mark and this script draws it at each size.
 *
 * The drawing happens in a canvas inside Chrome rather than through
 * `--screenshot`, because Chrome will not produce a screenshot smaller than its
 * own minimum window: asking for 128 px gives a 128 px crop of a ~500 px page,
 * which is a corner of the tile and not the icon. A canvas has no such floor, so
 * each size is drawn at 4x and scaled down in one step for a clean edge.
 *
 *   node extension/tools/icons.js
 *
 * Chrome is found in the usual places, or set CHROME_PATH. Nothing in
 * `extension/src/` depends on this script: the PNGs it writes are what the build
 * copies into the package.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const EXTENSION = path.join(__dirname, "..");
const SOURCE = path.join(EXTENSION, "assets", "icon.svg");
const OUT = path.join(EXTENSION, "assets", "icons");
const SIZES = [16, 32, 48, 128];

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
  console.error(
    "Chrome was not found. Set CHROME_PATH to it, or rasterise extension/assets/icon.svg " +
      "at 16, 32, 48 and 128 px yourself and put the PNGs in extension/assets/icons/."
  );
  process.exit(1);
}

/** The page that draws the sizes and writes them out as data URLs. */
function renderPage(svgDataUrl) {
  return `<!doctype html><html><body><script>
(async () => {
  const sizes = ${JSON.stringify(SIZES)};
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = ${JSON.stringify(svgDataUrl)};
  });
  const out = {};
  for (const size of sizes) {
    // 4x, then one high-quality downscale: SVG text rasterised straight at 16 px
    // loses the counters in the 4 and turns into a smudge.
    const big = document.createElement("canvas");
    big.width = size * 4;
    big.height = size * 4;
    big.getContext("2d").drawImage(image, 0, 0, size * 4, size * 4);

    const small = document.createElement("canvas");
    small.width = size;
    small.height = size;
    const ctx = small.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, size, size);
    out[size] = small.toDataURL("image/png");
  }
  document.body.textContent = JSON.stringify(out);
})();
</script></body></html>`;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`the icon source is missing: ${SOURCE}`);
    process.exit(1);
  }
  const chrome = findChrome();
  const svgDataUrl =
    "data:image/svg+xml;base64," + fs.readFileSync(SOURCE).toString("base64");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ubyu-icons-"));
  const page = path.join(scratch, "icons.html");
  fs.writeFileSync(page, renderPage(svgDataUrl), "utf8");

  // --dump-dom prints the finished page, which is where the data URLs are.
  const dom = execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--user-data-dir=" + path.join(scratch, "profile"),
      "--virtual-time-budget=8000",
      "--dump-dom",
      "file:///" + page.replace(/\\/g, "/"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
  );

  const match = dom.match(/\{"16":.*?\}/s);
  if (!match) {
    console.error("Chrome did not return the drawn icons — nothing was written.");
    process.exit(1);
  }
  const drawn = JSON.parse(match[0]);

  fs.mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    const dataUrl = drawn[String(size)];
    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
      console.error(`no image came back for ${size} px — nothing was written.`);
      process.exit(1);
    }
    const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== size || height !== size) {
      console.error(`Chrome drew ${width}x${height} where ${size}x${size} was asked for.`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(OUT, `icon${size}.png`), bytes);
    console.log(`wrote extension/assets/icons/icon${size}.png — ${bytes.length} bytes`);
  }

  fs.rmSync(scratch, { recursive: true, force: true });
}

main();
