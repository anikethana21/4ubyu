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
 *
 * It writes the zip itself rather than shelling out to `Compress-Archive` or
 * `zip`. Both are present on this machine, and both caused the same quiet fault:
 * PowerShell 5's `Compress-Archive` stores Windows paths (`icons\icon128.png`),
 * and a name is not a path to a zip reader — Chrome would look for a file called
 * `icons\icon128.png` at the root, not find the icon, and say nothing. Thirty
 * lines of zip is cheaper than an icon that silently disappears.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const EXTENSION = path.join(__dirname, "..");
const STORE = path.join(EXTENSION, "dist", "store");
const OUT = path.join(EXTENSION, "dist", "4ubyu-extension.zip");

/** Every file in the package, relative to its root, with forward slashes. */
function collect(directory, prefix = "") {
  const entries = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const full = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) entries.push(...collect(full, relative));
    else entries.push({ name: relative, data: fs.readFileSync(full), mtime: fs.statSync(full).mtime });
  }
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Zip's own date and time fields: the same instant, in 1980-flavoured pieces. */
function dosStamps(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { time, day } = dosStamps(entry.mtime);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // no extra field

    locals.push(header, name, deflated);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(day, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(deflated.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);

    central.push(record, name);
    offset += header.length + name.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

if (!fs.existsSync(path.join(STORE, "manifest.json"))) {
  console.error("run `npm run build` first — there is nothing to package.");
  process.exit(1);
}

const entries = collect(STORE);
if (!entries.some((entry) => entry.name === "manifest.json")) {
  console.error("the package has no manifest.json at its root — the store will not take it.");
  process.exit(1);
}

fs.rmSync(OUT, { force: true });
fs.writeFileSync(OUT, buildZip(entries));

console.log(`wrote extension/dist/4ubyu-extension.zip — ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
console.log(`contains ${entries.map((entry) => entry.name).join(", ")}`);
