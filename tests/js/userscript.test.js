/**
 * The built userscript, loaded the way a script manager would load it.
 *
 * Two things can go wrong here that nothing else would catch: the modules can be
 * folded in wrongly (a marker left in place, an asset not regenerated, a module
 * that fails to register), and the shell can ask for something that does not exist
 * — and both are invisible until a real user installs the file on a real lecture.
 * So the built file is executed against a stand-in page and asked to prove it
 * produced a panel.
 *
 * The stand-in is only as big as what the shell touches at load: a document that
 * can make elements and append them, a location, and the script manager's
 * functions. Nothing here reaches the network.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILT = path.join(ROOT, "4ubyu.user.js");
const STORE = path.join(ROOT, "extension", "dist", "store");

/** The smallest element the shell can be fooled with. */
function fakeElement(tag) {
  const found = new Map();
  const node = {
    tagName: String(tag || "div").toUpperCase(),
    className: "",
    id: "",
    hidden: false,
    value: "",
    innerHTML: "",
    textContent: "",
    style: {},
    children: [],
    attributes: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    closest: () => null,
    matches: () => false,
    querySelectorAll: () => [],
    querySelector(selector) {
      if (!found.has(selector)) found.set(selector, fakeElement("div"));
      return found.get(selector);
    },
  };
  return node;
}

function standInPage({ url = "https://www.youtube.com/watch?v=abc" } = {}) {
  const page = {
    title: "Linear regression — YouTube",
    head: fakeElement("head"),
    body: fakeElement("body"),
    getElementById: () => null,
    querySelector: () => null,
    createElement: (tag) => fakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  return { page, url };
}

function loadBuiltScript(options = {}) {
  assert.ok(fs.existsSync(BUILT), "run `npm run build` first — 4ubyu.user.js is missing");
  const code = fs.readFileSync(BUILT, "utf8");
  const { page, url } = standInPage(options);

  const settings = new Map();
  const menu = [];
  const commands = [];
  const sandbox = {
    document: page,
    location: { pathname: url.replace("https://www.youtube.com", "") || "/", href: url },
    window: { addEventListener() {}, open: () => null },
    navigator: { userAgent: "node" },
    URLSearchParams,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    console,
    GM_getValue: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback),
    GM_setValue: (key, value) => settings.set(key, value),
    GM_deleteValue: (key) => settings.delete(key),
    GM_registerMenuCommand: (label, run) => {
      menu.push(label);
      commands.push(run);
    },
    GM_xmlhttpRequest: () => {
      throw new Error("the test must not reach the network");
    },
    GM_openInTab: () => null,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window.document = page;

  // A separate global object, so a module that registers itself and a shell that
  // sets a global can be inspected without leaking a half-loaded pipeline into
  // the test process.
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: BUILT });

  return {
    sandbox,
    page,
    settings,
    menu,
    commands,
    panelNode: page.body.children.find((child) => String(child.className).includes("ubyu-panel")),
    fabNode: page.body.children.find((child) => String(child.className).includes("ubyu-fab")),
  };
}

/**
 * The store package, loaded the way Chrome loads a content script: a `chrome`
 * object with storage, and the manifest that says what it may reach.
 */
function loadStorePackage(options = {}) {
  const content = path.join(STORE, "content.js");
  const manifestFile = path.join(STORE, "manifest.json");
  assert.ok(fs.existsSync(content), "run `npm run build` first — the store package is missing");
  const { page, url } = standInPage(options);

  const stored = { ...(options.stored || {}) };
  const asked = [];
  const sandbox = {
    document: page,
    location: { pathname: url.replace("https://www.youtube.com", "") || "/", href: url },
    window: { addEventListener() {}, open: () => null },
    navigator: { userAgent: "node" },
    URLSearchParams,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    console,
    chrome: {
      storage: {
        // Chrome answers asynchronously; this answers at once with what is there.
        local: {
          get: (keys, done) => done({ ...stored }),
          set: (values, done) => {
            Object.assign(stored, values);
            if (done) done();
          },
          remove: (key, done) => {
            delete stored[key];
            if (done) done();
          },
        },
      },
      runtime: {
        lastError: null,
        sendMessage: (message, done) => {
          asked.push(message);
          done({ ok: true, status: 200, text: "{}" });
        },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window.document = page;

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(content, "utf8"), context, { filename: content });

  return {
    sandbox,
    page,
    stored,
    asked,
    manifest: JSON.parse(fs.readFileSync(manifestFile, "utf8")),
    panelNode: page.body.children.find((child) => String(child.className).includes("ubyu-panel")),
    fabNode: page.body.children.find((child) => String(child.className).includes("ubyu-fab")),
  };
}

test("the built userscript registers the whole pipeline, not part of it", () => {
  // The modules register themselves on the global object, which is how the shell
  // finds them; a module left out of build.js would be missing here.
  const loaded = loadBuiltScript();
  for (const name of ["UBYU", "UBYU_MARKDOWN", "UBYU_WORKSPACE", "UBYU_PIPELINE", "UBYU_PANEL"]) {
    assert.ok(loaded.sandbox[name], `${name} was not registered by the built file`);
  }
  assert.equal(loaded.sandbox.UBYU_PANEL.VERSION, "2.0.0");
  // The panel is installed and listening: it has to have been handed both halves
  // of the split the build rejoins.
  assert.ok(typeof loaded.sandbox.UBYU_PIPELINE.runLecture === "function");
  assert.ok(typeof loaded.sandbox.UBYU_WORKSPACE.renderNotesHtml === "function");
});

test("the built userscript puts a panel and a button on the lecture page", () => {
  const loaded = loadBuiltScript();
  const tags = loaded.page.body.children.map((child) => child.className);
  assert.ok(
    tags.some((name) => String(name).includes("ubyu-panel")),
    `no panel was added to the page: ${JSON.stringify(tags)}`
  );
  assert.ok(
    tags.some((name) => String(name).includes("ubyu-fab")),
    `no button was added to the page: ${JSON.stringify(tags)}`
  );
  const style = loaded.page.head.children.map((child) => child.id);
  assert.ok(style.includes("ubyu-panel-style"), "the panel's stylesheet was not added");
  assert.equal(loaded.fabNode.hidden, false, "the button is offered on a lecture");
});

test("YouTube's own pages are left alone", () => {
  const loaded = loadBuiltScript({ url: "https://www.youtube.com/feed/subscriptions" });
  assert.equal(loaded.fabNode.hidden, true, "there is nothing to make notes from on the feed");
});

test("the userscript menu offers the two things a person would look for", () => {
  const loaded = loadBuiltScript();
  assert.equal(loaded.menu.length, 2);
  assert.match(loaded.menu[0], /notes/i);
  assert.match(loaded.menu[1], /already made/i);
  assert.equal(loaded.commands.length, 2);
});

test("both builds are what build.js would write today", () => {
  // A stale build is how a fix reaches the tests and not the users.
  const output = execFileSync(process.execPath, [path.join(ROOT, "extension", "build.js"), "--check"], {
    encoding: "utf8",
  });
  assert.match(output, /builds are current/);
});

// ---------------------------------------------------------------------------
// The same program, as a Chrome extension
// ---------------------------------------------------------------------------

test("the store package is a manifest and one content script, with no remote code", () => {
  const loaded = loadStorePackage();
  const manifest = loaded.manifest;
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.content_scripts[0].matches[0], /youtube\.com/);
  assert.equal(manifest.background.service_worker, "background.js");
  // The permission that reaches outside the browser is named, and it is the
  // provider's address and nothing else.
  assert.deepEqual(manifest.host_permissions, ["https://www.youtube.com/*", "https://api.groq.com/*"]);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(!/https?:/.test(manifest.content_scripts[0].js.join(" ")), "no remote script is loaded");
});

test("the content script installs the same panel the userscript does", () => {
  const loaded = loadStorePackage();
  assert.ok(loaded.sandbox.UBYU_PANEL, "the pipeline was not folded into the content script");
  assert.ok(loaded.panelNode, "the content script did not add a panel to the page");
  assert.ok(loaded.fabNode, "the content script did not add a button to the page");
  assert.equal(loaded.fabNode.hidden, false, "the button is offered on a lecture");
});

test("the content script has the stored key before it draws anything", () => {
  // The pipeline's cache is read synchronously and chrome.storage is not, so the
  // content script has to have copied storage into memory before it starts. A key
  // saved on an earlier visit must be there without being asked for twice — the
  // test is that it is already on screen.
  const loaded = loadStorePackage();
  assert.equal(loaded.stored["ubyu:apiKey"], undefined, "nothing is written by merely loading");

  const seeded = loadStorePackage({ stored: { "ubyu:apiKey": JSON.stringify("gsk_stored_earlier") } });
  const body = seeded.panelNode.querySelector("[data-body]");
  assert.match(String(body.innerHTML), /gsk_stored_earlier/, "the saved key was not read back from storage");
});
