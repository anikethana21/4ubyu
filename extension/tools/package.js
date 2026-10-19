#!/usr/bin/env node
/**
 * Zip the built extension package for the Chrome Web Store.
 *
 * The store takes a zip whose root holds `manifest.json` — not a folder
 * containing it — so this zips the *contents* of `extension/dist/store/`. The zip
 * itself is scratch: it is reproducible from the build in one command, and what is
 * committed is the package that produces it.
 *
 *   node extension/tools/package.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const EXTENSION = path.join(__dirname, "..");
const STORE = path.join(EXTENSION, "dist", "store");
const OUT = path.join(EXTENSION, "dist", "4ubyu-extension.zip");

if (!fs.existsSync(path.join(STORE, "manifest.json"))) {
  console.error("run `npm run build` first — there is nothing to package.");
  process.exit(1);
}

fs.rmSync(OUT, { force: true });

if (process.platform === "win32") {
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Compress-Archive -Path '${STORE}\\*' -DestinationPath '${OUT}' -Force`],
    { stdio: "inherit" }
  );
} else {
  // `zip` is not installed everywhere, so say which one is missing rather than
  // failing with a shell error nobody can read.
  try {
    execFileSync("zip", ["-r", "-q", OUT, "."], { cwd: STORE, stdio: "inherit" });
  } catch (error) {
    console.error("`zip` is needed for this on macOS and Linux: install it, or zip extension/dist/store/ yourself.");
    process.exit(1);
  }
}

const files = fs.readdirSync(STORE).sort();
console.log(`wrote extension/dist/4ubyu-extension.zip — ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
console.log(`contains ${files.join(", ")}`);
