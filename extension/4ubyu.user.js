// ==UserScript==
// @name         4 U By U — Lecture to Study Notes
// @namespace    https://four-u-by-u-workspace.onrender.com
// @version      1.7.0
// @description  Turns the YouTube lecture you are already watching into a chapterised study handbook. Captures the transcript in your own browser and hands it to your 4 U By U workspace.
// @author       Anikethana
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

/* eslint-disable no-undef */
(function () {
  "use strict";

  const DEFAULTS = {
    serverUrl: "http://127.0.0.1:8000",
    ingestToken: "",
  };

  const state = {
    busy: false,
    root: null,
    card: null,
    button: null,
    label: null,
    hint: null,
    settings: null,
    settingsOpen: false,
    autoOpened: false,
  };

  // -------------------------------------------------------------------------
  // Settings (stored by the userscript manager, never sent anywhere else)
  // -------------------------------------------------------------------------

  const getSetting = (key) => (GM_getValue(key, DEFAULTS[key]) || "").trim();
  const setSetting = (key, value) => GM_setValue(key, String(value || "").trim());

  const isConfigured = () => Boolean(getSetting("ingestToken"));

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  const CSS = `
    #fubyu-root {
      position: fixed; right: 22px; bottom: 22px; z-index: 2147483000;
      font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
    }
    #fubyu-root * { box-sizing: border-box; }
    #fubyu-card {
      min-width: 300px; max-width: 372px;
      padding: 14px 16px; border-radius: 16px;
      background: rgba(20, 22, 34, 0.78);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
      color: #eef1fb;
      transition: opacity .18s ease, transform .18s ease;
    }
    #fubyu-title {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      font-size: 12px; font-weight: 700; letter-spacing: .09em;
      text-transform: uppercase; color: #9fb0d8; margin-bottom: 7px;
    }
    #fubyu-gear {
      appearance: none; background: rgba(255,255,255,.08); cursor: pointer;
      border: 1px solid rgba(255,255,255,.16); border-radius: 8px;
      color: #dfe6fb; font-size: 13px; line-height: 1;
      padding: 4px 7px;
    }
    #fubyu-gear:hover { background: rgba(255,255,255,.16); }
    #fubyu-hint { font-size: 12.5px; line-height: 1.5; color: #cfd8ef; }
    #fubyu-hint.error { color: #ffb4b4; }
    #fubyu-hint.ok { color: #a7f3c4; }
    #fubyu-hint.warn { color: #ffd79a; }

    #fubyu-settings { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.12); }
    #fubyu-settings[hidden] { display: none; }
    #fubyu-settings label {
      display: block; font-size: 11px; letter-spacing: .05em; text-transform: uppercase;
      color: #93a2c7; margin: 9px 0 4px;
    }
    #fubyu-settings input {
      width: 100%; padding: 8px 10px; border-radius: 9px; font-size: 12.5px;
      background: rgba(10, 12, 20, 0.85); color: #eef1fb;
      border: 1px solid rgba(255,255,255,.18); outline: none;
      font-family: ui-monospace, Consolas, monospace;
    }
    #fubyu-settings input:focus { border-color: rgba(140,160,255,.85); }
    #fubyu-row { display: flex; gap: 8px; margin-top: 12px; }
    #fubyu-row button {
      flex: 1; appearance: none; cursor: pointer; padding: 9px 10px;
      border-radius: 9px; font-size: 12.5px; font-weight: 650; color: #fff;
      border: 1px solid rgba(255,255,255,.18);
      background: linear-gradient(135deg, rgba(96,120,255,.95), rgba(158,86,255,.95));
    }
    #fubyu-row button.secondary {
      background: rgba(255,255,255,.09); font-weight: 600;
    }
    #fubyu-row button:hover { filter: brightness(1.1); }
    #fubyu-test-result { font-size: 12px; line-height: 1.5; margin-top: 9px; color: #cfd8ef; }
    #fubyu-test-result.ok { color: #a7f3c4; }
    #fubyu-test-result.error { color: #ffb4b4; }

    #fubyu-button {
      appearance: none; border: 1px solid rgba(255,255,255,0.18); cursor: pointer;
      padding: 12px 20px; border-radius: 999px; font-size: 13.5px; font-weight: 650;
      letter-spacing: .01em; color: #fff;
      background: linear-gradient(135deg, rgba(96,120,255,.96), rgba(158,86,255,.96));
      box-shadow: 0 14px 34px rgba(84, 78, 255, 0.42);
      display: inline-flex; align-items: center; gap: 9px;
      transition: transform .15s ease, filter .15s ease, opacity .15s ease;
    }
    #fubyu-button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
    #fubyu-button:disabled { opacity: .62; cursor: progress; }
    #fubyu-spinner {
      width: 13px; height: 13px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
      animation: fubyu-spin .7s linear infinite; display: none;
    }
    #fubyu-button.busy #fubyu-spinner { display: inline-block; }
    @keyframes fubyu-spin { to { transform: rotate(360deg); } }
  `;

  function injectStyle() {
    if (document.getElementById("fubyu-style")) return;
    const style = document.createElement("style");
    style.id = "fubyu-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function mount() {
    if (state.root) return;
    injectStyle();

    const root = document.createElement("div");
    root.id = "fubyu-root";
    root.innerHTML = `
      <div id="fubyu-card">
        <div id="fubyu-title">
          <span>4 U By U</span>
          <button id="fubyu-gear" type="button" title="Settings">⚙️ Setup</button>
        </div>
        <div id="fubyu-hint"></div>

        <div id="fubyu-settings" hidden>
          <label for="fubyu-server">Server URL</label>
          <input id="fubyu-server" type="text" spellcheck="false"
                 placeholder="http://127.0.0.1:8000">
          <label for="fubyu-token">Ingest token</label>
          <input id="fubyu-token" type="password" spellcheck="false"
                 placeholder="paste your EXTENSION_INGEST_TOKEN">
          <div id="fubyu-row">
            <button id="fubyu-save" type="button">Save</button>
            <button id="fubyu-test" class="secondary" type="button">Test</button>
          </div>
          <div id="fubyu-test-result"></div>
        </div>
      </div>
      <button id="fubyu-button" type="button">
        <span id="fubyu-spinner"></span>
        <span id="fubyu-label">Generate Study Notes</span>
      </button>
    `;
    document.body.appendChild(root);

    state.root = root;
    state.card = root.querySelector("#fubyu-card");
    state.button = root.querySelector("#fubyu-button");
    state.label = root.querySelector("#fubyu-label");
    state.hint = root.querySelector("#fubyu-hint");
    state.settings = root.querySelector("#fubyu-settings");

    state.button.addEventListener("click", run);
    root.querySelector("#fubyu-gear").addEventListener("click", toggleSettings);
    root.querySelector("#fubyu-save").addEventListener("click", saveSettings);
    root.querySelector("#fubyu-test").addEventListener("click", testConnection);

    // Stop YouTube's own handlers from swallowing clicks inside our UI.
    root.addEventListener("click", (event) => event.stopPropagation());

    loadSettingsIntoForm();
    renderConfigState();
  }

  function unmount() {
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = state.card = state.button = state.label = state.hint = null;
    state.settings = null;
    state.settingsOpen = false;
    state.autoOpened = false;
  }

  function loadSettingsIntoForm() {
    if (!state.root) return;
    state.root.querySelector("#fubyu-server").value = getSetting("serverUrl");
    state.root.querySelector("#fubyu-token").value = getSetting("ingestToken");
  }

  function toggleSettings(force) {
    if (!state.settings) return;
    state.settingsOpen = typeof force === "boolean" ? force : !state.settingsOpen;
    state.settings.hidden = !state.settingsOpen;
    if (state.settingsOpen) {
      loadSettingsIntoForm();
      const tokenInput = state.root.querySelector("#fubyu-token");
      tokenInput.focus();
      tokenInput.select();
    }
  }

  function saveSettings() {
    if (!state.root) return;
    const server = state.root.querySelector("#fubyu-server").value
      .trim().replace(/\/+$/, "") || DEFAULTS.serverUrl;
    const token = state.root.querySelector("#fubyu-token").value.trim();

    setSetting("serverUrl", server);
    setSetting("ingestToken", token);

    renderConfigState();
    const result = state.root.querySelector("#fubyu-test-result");
    if (token) {
      result.className = "ok";
      result.textContent = "Saved. Click Test to verify the server accepts this token.";
    } else {
      result.className = "error";
      result.textContent = "Token is empty — the server will reject the request.";
    }
  }

  function setResult(message, kind) {
    if (!state.root) return;
    const result = state.root.querySelector("#fubyu-test-result");
    result.className = kind || "";
    result.textContent = message;
  }

  /**
   * Proves the whole handshake before the user wastes time on a long lecture.
   *   /health              -> is a 4 U By U server actually listening?
   *   POST with junk body  -> 422 means the token is GOOD, 401 means it is wrong.
   *                           The junk body fails validation, so nothing is stored.
   */
  function testConnection() {
    const server = (state.root.querySelector("#fubyu-server").value.trim() ||
      DEFAULTS.serverUrl).replace(/\/+$/, "");
    const token = state.root.querySelector("#fubyu-token").value.trim();

    if (!token) {
      setResult("Paste your ingest token first.", "error");
      return;
    }
    setResult("Checking " + server + " …");

    GM_xmlhttpRequest({
      method: "GET",
      url: server + "/health",
      timeout: 15000,
      onload: (res) => {
        if (res.status < 200 || res.status >= 300) {
          setResult("Server answered HTTP " + res.status + ". Is that the right URL?", "error");
          return;
        }
        GM_xmlhttpRequest({
          method: "POST",
          url: server + "/api/ingest/transcript",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          data: JSON.stringify({ video_id: "invalid" }),
          timeout: 20000,
          onload: (authRes) => {
            if (authRes.status === 401) {
              setResult("Server reached, but the token was REJECTED. It must match the server's EXTENSION_INGEST_TOKEN exactly.", "error");
            } else if (authRes.status === 422) {
              setResult("All good — server reachable and the token is accepted. ✅", "ok");
            } else if (authRes.status === 503) {
              setResult("Server reachable, but its database is unconfigured. That is fine for local use.", "warn");
            } else {
              setResult("Unexpected response: HTTP " + authRes.status + ".", "error");
            }
          },
          onerror: () => setResult("Reached /health but the ingest endpoint refused the connection.", "error"),
          ontimeout: () => setResult("The ingest endpoint timed out.", "error"),
        });
      },
      onerror: () => setResult("Cannot reach " + server + ". Is the server running?", "error"),
      ontimeout: () => setResult("Timed out reaching " + server + ".", "error"),
    });
  }

  /** Keeps the headline status honest about whether setup is complete. */
  function renderConfigState() {
    if (!state.hint) return;
    if (!isConfigured()) {
      state.hint.className = "warn";
      state.hint.textContent = "Setup needed: paste your ingest token below, then Save.";
      // Open the panel once, so the fix is impossible to miss — but don't yank
      // focus back every time the SPA fires a navigation event.
      if (!state.autoOpened) {
        state.autoOpened = true;
        toggleSettings(true);
      }
      return;
    }
    state.hint.className = "";
    state.hint.textContent =
      "Ready. Captions are read locally in your browser; cookies never leave it.";
  }

  function showHint(message, kind) {
    if (!state.hint) return;
    state.hint.textContent = message;
    state.hint.className = kind || "";
  }

  function toast(message, kind) {
    showHint(message, kind);
    if (kind !== "error") {
      setTimeout(() => {
        if (isConfigured()) renderConfigState();
      }, 6000);
    }
  }

  function setBusy(busy, label) {
    state.busy = busy;
    if (!state.button) return;
    state.button.disabled = busy;
    state.button.classList.toggle("busy", busy);
    state.label.textContent = label || (busy ? "Working…" : "Generate Study Notes");
  }

  // -------------------------------------------------------------------------
  // Menu commands — now they just open the panel instead of using prompt(),
  // which some Chromium builds silently block inside a userscript sandbox.
  // -------------------------------------------------------------------------

  function registerMenu() {
    GM_registerMenuCommand("⚙️ 4 U By U settings", () => {
      mount();
      if (state.root) state.root.querySelector("#fubyu-card").scrollIntoView({ block: "nearest" });
      toggleSettings(true);
    });

    GM_registerMenuCommand("🔌 Test 4 U By U connection", () => {
      mount();
      toggleSettings(true);
      testConnection();
    });

    GM_registerMenuCommand("▶️ Grab this lecture's transcript", () => {
      if (location.pathname !== "/watch") {
        alert("Open a YouTube video first.");
        return;
      }
      run();
    });
  }

  // -------------------------------------------------------------------------
  // Reading the page: player response + caption track
  // -------------------------------------------------------------------------

  /** Pulls the JSON object that starts at the first "{" after `marker`. */
  function extractJsonAfter(html, marker) {
    const at = html.indexOf(marker);
    if (at < 0) return null;
    const start = html.indexOf("{", at);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch (err) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function currentVideoId() {
    const params = new URLSearchParams(location.search);
    return params.get("v") || "";
  }

  /** Gets the live player response for the *currently open* video. */
  function getPlayerResponse(videoId) {
    const candidates = [];
    try {
      if (unsafeWindow.ytInitialPlayerResponse) candidates.push(unsafeWindow.ytInitialPlayerResponse);
    } catch (err) { /* sandboxed window is fine to skip */ }
    try {
      const args = unsafeWindow.ytplayer && unsafeWindow.ytplayer.config && unsafeWindow.ytplayer.config.args;
      if (args && args.player_response) candidates.push(JSON.parse(args.player_response));
    } catch (err) { /* ignore */ }

    for (const candidate of candidates) {
      if (!candidate || !candidate.videoDetails) continue;
      if (!videoId || candidate.videoDetails.videoId === videoId) return candidate;
    }
    // A response for a different video (stale after SPA navigation) is worse
    // than re-reading the bootstrap below.
    const fromHtml = extractJsonAfter(document.documentElement.innerHTML, "ytInitialPlayerResponse");
    if (fromHtml && fromHtml.videoDetails) {
      if (!videoId || fromHtml.videoDetails.videoId === videoId) return fromHtml;
    }
    return candidates.find((c) => c && c.videoDetails) || null;
  }

  const isEnglish = (track) => (track.languageCode || "").toLowerCase().startsWith("en");
  const isManual = (track) => !track.kind || track.kind !== "asr";

  /**
   * Prefers a human-made English track, then any English track (auto-generated
   * included), then asks YouTube itself to translate a non-English track.
   */
  function pickCaptionTrack(playerResponse) {
    const renderer =
      playerResponse.captions &&
      playerResponse.captions.playerCaptionsTracklistRenderer;
    const tracks = (renderer && renderer.captionTracks) || [];
    if (!tracks.length) return null;

    const chosen =
      tracks.find((t) => isEnglish(t) && isManual(t)) ||
      tracks.find(isEnglish) ||
      tracks.find((t) => t.isTranslatable) ||
      tracks[0];

    let url = chosen.baseUrl || "";
    let language = chosen.languageCode || "unknown";

    if (!isEnglish(chosen) && chosen.isTranslatable && url) {
      // YouTube's own machine translation — better than nothing, and free.
      url += (url.includes("?") ? "&" : "?") + "tlang=en";
      language = language + " → en (auto-translated by YouTube)";
    }

    return { url, language };
  }

  // -------------------------------------------------------------------------
  // Caption transport
  //
  // The timedtext endpoint only answers with real data when the request carries
  // the viewer's own YouTube session cookies. A plain same-origin fetch() from
  // the page is the most faithful way to send them, so it is tried first;
  // GM_xmlhttpRequest stays as a fallback for when the page's CSP blocks fetch.
  // Every attempt is recorded so a failure explains itself.
  // -------------------------------------------------------------------------

  async function browserGet(url) {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    return {
      status: res.status,
      text: (await res.text()) || "",
      type: res.headers.get("content-type") || "unknown",
      via: "fetch",
    };
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        withCredentials: true, // the user's own YouTube session; never sent to our server
        timeout: 60000,
        onload: (res) => {
          const headers = res.responseHeaders || "";
          const type = (headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || "unknown";
          resolve({ status: res.status, text: res.responseText || "", type, via: "GM_xmlhttpRequest" });
        },
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("no response within 60s")),
      });
    });
  }

  /** Accepts either the json3 or the XML shape, whichever YouTube hands back. */
  function parseCaptionBody(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    if (text[0] === "{") {
      try {
        const segments = parseJson3(text);
        if (segments.length) return segments;
      } catch (err) { /* not the JSON shape we hoped for — try XML below */ }
    }
    if (text[0] === "<") return parseTimedTextXml(text);
    return [];
  }

  /** Swaps the fmt parameter without disturbing the signature/expire params. */
  function setFormat(url, fmt) {
    if (/[?&]fmt=/.test(url)) return url.replace(/([?&]fmt=)[^&]*/, "$1" + fmt);
    return url + (url.includes("?") ? "&" : "?") + "fmt=" + fmt;
  }

  function decodeEntities(text) {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  const tidy = (text) => decodeEntities(String(text || "")).replace(/\s+/g, " ").trim();

  function parseJson3(raw) {
    const data = JSON.parse(raw);
    const segments = [];
    for (const event of data.events || []) {
      if (!event.segs) continue;
      const text = tidy(event.segs.map((s) => s.utf8 || "").join(""));
      if (!text) continue;
      segments.push({
        start: (event.tStartMs || 0) / 1000,
        duration: (event.dDurationMs || 0) / 1000,
        text,
      });
    }
    return segments;
  }

  function parseTimedTextXml(raw) {
    const doc = new DOMParser().parseFromString(raw, "text/xml");
    const segments = [];
    doc.querySelectorAll("text, p").forEach((node) => {
      const start = parseFloat(node.getAttribute("start") || node.getAttribute("t") || "0");
      const duration = parseFloat(node.getAttribute("dur") || node.getAttribute("d") || "0");
      const text = tidy(node.textContent);
      if (!text) return;
      segments.push({
        start: node.getAttribute("t") ? start / 1000 : start,
        duration: node.getAttribute("d") ? duration / 1000 : duration,
        text,
      });
    });
    return segments;
  }

  // -------------------------------------------------------------------------
  // InnerTube fallback — required since YouTube's 2025 caption lockdown
  //
  // Many caption tracks are now gated behind a proof-of-origin token ("pot")
  // minted by BotGuard inside the player's own JavaScript. Such a track carries
  // an "exp=xpe" parameter, and /api/timedtext then answers HTTP 200 with an
  // empty body — a silent failure that looks identical to "no captions".
  //
  // The transcript panel does not use timedtext: it calls InnerTube's
  // get_transcript endpoint with a params blob handed out by /next. That is an
  // ordinary same-origin API call, needs no token, and is what we fall back to.
  // -------------------------------------------------------------------------

  /** Depth-first search for the first nested object satisfying `predicate`. */
  function findDeep(node, predicate, depth) {
    if (!node || typeof node !== "object" || (depth || 0) > 14) return null;
    if (predicate(node)) return node;
    for (const value of Object.values(node)) {
      const hit = findDeep(value, predicate, (depth || 0) + 1);
      if (hit) return hit;
    }
    return null;
  }

  /** The page's own InnerTube credentials, so our calls resemble the page's own. */
  function innertubeConfig() {
    const html = document.documentElement.innerHTML;
    let key = "";
    let version = "";
    let context = null;
    try {
      if (unsafeWindow.ytcfg && typeof unsafeWindow.ytcfg.get === "function") {
        key = unsafeWindow.ytcfg.get("INNERTUBE_API_KEY") || "";
        version = unsafeWindow.ytcfg.get("INNERTUBE_CLIENT_VERSION") || "";
        context = unsafeWindow.ytcfg.get("INNERTUBE_CONTEXT") || null;
      }
    } catch (err) { /* the page may not have exposed ytcfg yet */ }

    if (!key) {
      const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (match) key = match[1];
    }
    if (!version) {
      const match = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
      if (match) version = match[1];
    }
    version = version || "2.20240101.00.00";

    // Prefer the page's real context (it carries visitorData); else synth one.
    if (!context || !context.client) {
      context = { client: { clientName: "WEB", clientVersion: version, hl: "en", gl: "US" } };
    }
    return { key, version, context };
  }

  async function innertube(path, body, cfg) {
    const url =
      "https://www.youtube.com/youtubei/v1/" + path + "?prettyPrint=false" +
      (cfg.key ? "&key=" + encodeURIComponent(cfg.key) : "");
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Youtube-Client-Name": "1",
        "X-Youtube-Client-Version": cfg.version,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("InnerTube /" + path + " -> HTTP " + res.status);
    return await res.json();
  }

  /** "1:23" or "1:02:03" -> seconds. */
  function clockToSeconds(text) {
    const parts = String(text || "").trim().split(":").map((n) => parseInt(n, 10));
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
  }

  /** Turns the transcript panel's segment renderers into our segment shape. */
  function parseTranscriptPanel(data) {
    const holder = findDeep(data, (node) => node.transcriptSegmentListRenderer);
    if (!holder) return [];
    const items = holder.transcriptSegmentListRenderer.initialSegments || [];

    const found = [];
    for (const item of items) {
      const renderer = item && item.transcriptSegmentRenderer;
      if (!renderer) continue;

      const runs = (renderer.snippet && renderer.snippet.runs) || [];
      const text = tidy(
        runs.length
          ? runs.map((r) => r.text || "").join("")
          : (renderer.snippet && renderer.snippet.simpleText) || ""
      );
      if (!text) continue;

      let start = renderer.startMs != null ? Number(renderer.startMs) / 1000 : null;
      const end = renderer.endMs != null ? Number(renderer.endMs) / 1000 : null;
      if (start == null || !Number.isFinite(start)) {
        start = clockToSeconds(renderer.startTimeText && renderer.startTimeText.simpleText);
      }
      if (start == null || !Number.isFinite(start)) continue;

      found.push({ start, end, text });
    }

    // Each line needs a duration: its own endMs, else the next line's start.
    for (let i = 0; i < found.length; i++) {
      const current = found[i];
      const next = found[i + 1];
      let duration =
        current.end != null && current.end > current.start ? current.end - current.start : 0;
      if (!duration && next) duration = Math.max(0, next.start - current.start);
      if (!duration) duration = 2;
      current.duration = duration;
    }

    return found.map((s) => ({ start: s.start, duration: s.duration, text: s.text }));
  }

  /**
   * Asks /next for the transcript panel's params, then pulls the transcript
   * through /get_transcript. The request is always keyed to the videoId we pass
   * in, so a stale page can never yield a different video's text.
   */
  async function fetchViaTranscriptPanel(videoId) {
    const cfg = innertubeConfig();
    const next = await innertube("next", { context: cfg.context, videoId }, cfg);

    const holder = findDeep(
      next,
      (node) => node.getTranscriptEndpoint && node.getTranscriptEndpoint.params
    );
    const params = holder && holder.getTranscriptEndpoint.params;
    if (!params) throw new Error("this video exposes no transcript panel");

    const data = await innertube("get_transcript", { context: cfg.context, params }, cfg);
    const segments = parseTranscriptPanel(data);
    if (!segments.length) throw new Error("the transcript panel came back empty");
    return segments;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** querySelectorAll that also pierces open shadow roots. */
  function deepQueryAll(selector) {
    const found = [];
    const visit = (node) => {
      if (!node || typeof node.querySelectorAll !== "function") return;
      node.querySelectorAll(selector).forEach((el) => found.push(el));
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot);
      });
    };
    visit(document);
    return found;
  }

  /**
   * YouTube creates the transcript panel lazily, and newer components attach
   * CLOSED shadow roots, which no query can reach. Forcing every shadow root
   * open before the panel is built makes it readable. Harmless if it fails.
   */
  function forceOpenShadowRoots() {
    try {
      const win = unsafeWindow;
      if (!win || win.__fubyuShadowPatched) return;
      const original = win.Element && win.Element.prototype && win.Element.prototype.attachShadow;
      if (typeof original !== "function") return;
      win.Element.prototype.attachShadow = function (init) {
        return original.call(this, Object.assign({}, init, { mode: "open" }));
      };
      win.__fubyuShadowPatched = true;
    } catch (err) { /* the page may forbid it; the selectors below still apply */ }
  }

  /** Locates YouTube's own "Show transcript" control, whatever it is called today. */
  function findTranscriptButton() {
    const direct = deepQueryAll(
      "ytd-video-description-transcript-section-renderer button, " +
        "ytd-video-description-transcript-section-renderer ytd-button-renderer button, " +
        "yt-video-description-transcript-section-renderer button, " +
        "button[aria-label*='transcript' i]"
    );
    if (direct.length) return direct[0];
    return deepQueryAll("button, tp-yt-paper-button").find((el) =>
      /show transcript/i.test(el.textContent || "")
    );
  }

  /** The transcript panel itself, found by its target-id or its search box. */
  function findTranscriptPanel() {
    const selectors = [
      "[target-id*='transcript']",
      "ytd-engagement-panel-section-list-renderer[target-id*='transcript']",
      "yt-engagement-panel-section-list-renderer[target-id*='transcript']",
    ];
    for (const selector of selectors) {
      const hit = document.querySelector(selector) || deepQueryAll(selector)[0];
      if (hit) return hit;
    }
    const search = deepQueryAll("input").find((el) =>
      /search transcript/i.test(el.getAttribute("placeholder") || "")
    );
    if (!search) return null;
    let node = search.parentElement;
    for (let i = 0; i < 12 && node && node.parentElement; i += 1) {
      if (node.querySelectorAll("*").length > 30) return node;
      node = node.parentElement;
    }
    return search.parentElement;
  }

  /**
   * Segment containers, by tag name. YouTube ships both the old ytd- and the
   * newer yt- spelling depending on rollout, so both are listed.
   */
  function collectSegmentRows() {
    const selectors = [
      "ytd-transcript-segment-renderer",
      "yt-transcript-segment-renderer",
      "[class*='transcript-segment-renderer']",
      "[class*='transcript-segment']",
    ];
    for (const selector of selectors) {
      const rows = document.querySelectorAll(selector);
      if (rows.length) return Array.from(rows);
      const deep = deepQueryAll(selector);
      if (deep.length) return deep;
    }
    return [];
  }

  const CLOCK_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

  /**
   * YouTube renders every timestamp twice: the visible "0:07" and a screen-reader
   * label such as "7 seconds" or "1 minute, 6 seconds". That label sits beside the
   * clock and reads as ordinary prose to a naive sibling match, so it must be
   * excluded explicitly or it is captured in place of the caption.
   */
  const SPOKEN_TIME_RE =
    /^(?:\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|s|m|h)(?:\s*,\s*|\s+)?)+$/i;

  function looksLikeTimestampLabel(value) {
    const text = (value || "").trim();
    return !text || CLOCK_RE.test(text) || SPOKEN_TIME_RE.test(text);
  }

  /** The longest text in a subtree that is not a timestamp in disguise. */
  function longestCaption(root) {
    let best = "";
    const nodes = [root].concat(Array.from(root.querySelectorAll("*")));
    for (const node of nodes) {
      const value = (node.textContent || "").trim();
      if (value.length > best.length && !looksLikeTimestampLabel(value)) {
        best = value;
      }
    }
    return best;
  }

  /** The first clock reading in a subtree: "0:07" outranks its "7 seconds" label. */
  function findClockIn(root) {
    const nodes = [root].concat(Array.from(root.querySelectorAll("*")));
    for (const node of nodes) {
      const value = (node.textContent || "").trim();
      if (CLOCK_RE.test(value)) return clockToSeconds(value);
    }
    return null;
  }

  /** True when any element at or below ``root`` reads as a clock. */
  function containsClock(root) {
    for (const node of [root].concat(Array.from(root.querySelectorAll("*")))) {
      if (CLOCK_RE.test((node.textContent || "").trim())) return true;
    }
    return false;
  }

  /**
   * True when an ancestor already spans more than one transcript row.
   *
   * A row holds exactly one clock reading, so the first ancestor whose children
   * carry two of them is the list itself, where the prose belongs to other lines.
   */
  function spansManyRows(node) {
    let withClock = 0;
    for (const child of Array.from(node.children)) {
      if (containsClock(child)) {
        withClock += 1;
        if (withClock > 1) return true;
      }
    }
    return false;
  }

  /**
   * The caption that belongs to one clock reading.
   *
   * YouTube puts the visible clock beside a screen-reader label ("0:07" next to
   * "7 seconds") inside the timestamp cell, while the caption sits in a cousin
   * element under the same row. So the caption is NOT necessarily a sibling of the
   * clock: climb a level at a time and take the first branch that carries prose,
   * skipping the branch that holds the clock itself.
   */
  function captionForClock(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      // Never reach past the row: prose taken from the list belongs to other
      // lines, and grafting it on is worse than finding nothing at all.
      if (spansManyRows(node)) break;
      let best = "";
      for (const child of Array.from(node.children)) {
        if (child.contains(el)) continue;
        const candidate = longestCaption(child);
        if (candidate.length > best.length) best = candidate;
      }
      if (best) return best;
    }
    return "";
  }

  /**
   * Structure-blind fallback: any element whose entire text is a clock reading,
   * paired with the caption found beside or above it. Survives renamed tags.
   */
  function collectSegmentsStructurally() {
    const panel = findTranscriptPanel() || document.body;
    const found = [];

    for (const el of panel.querySelectorAll("*")) {
      const stamp = (el.textContent || "").trim();
      if (!CLOCK_RE.test(stamp)) continue;

      const start = clockToSeconds(stamp);
      if (start == null) continue;

      const text = captionForClock(el);
      if (!text) continue;

      found.push({ start, text: tidy(text) });
    }
    return found;
  }

  /** Reports which transcript-ish elements exist, when everything else failed. */
  function describeTranscriptDom() {
    const tags = new Set();
    document.querySelectorAll("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes("transcript") || tag.includes("segment")) tags.add(tag);
    });
    return tags.size ? " [elements present: " + Array.from(tags).slice(0, 12).join(", ") + "]" : "";
  }

  function readRenderedSegments() {
    const rows = collectSegmentRows();
    if (rows.length) {
      const found = [];
      let misread = false;
      for (const row of rows) {
        const stampEl = row.querySelector("#timestamp, .segment-timestamp");
        const textEl = row.querySelector("#text, .segment-text");
        // The timestamp cell wraps the clock and its screen-reader label, so look
        // inside it for the clock instead of reading its concatenated text.
        const start = stampEl ? findClockIn(stampEl) : null;
        const text = tidy(textEl ? textEl.textContent : "");
        // A selector can land on the screen-reader timestamp instead of the
        // caption. Treat that as a miss so the structural pass can try.
        if (!text || looksLikeTimestampLabel(text)) {
          misread = true;
          break;
        }
        if (start == null) continue;
        found.push({ start, text });
      }
      if (found.length && !misread) return found;
    }
    return collectSegmentsStructurally();
  }

  /**
   * Last resort: read the transcript straight out of YouTube's own panel.
   *
   * Immune to the PO-token and FAILED_PRECONDITION gateways, because the page
   * has already paid that cost itself — we only read the lines it rendered.
   * This is literally the same text the user can see on screen.
   */
  async function fetchViaRenderedPanel() {
    forceOpenShadowRoots();

    if (!collectSegmentRows().length) {
      const expanders = deepQueryAll("#expand");
      if (expanders.length) {
        expanders[0].click();
        await wait(700);
      }
      const button = findTranscriptButton();
      if (button) button.click();
      else throw new Error("no \"Show transcript\" control found on this page");
    }

    let segments = [];
    for (let attempt = 0; attempt < 60 && !segments.length; attempt++) {
      segments = readRenderedSegments();
      if (!segments.length) await wait(250);
    }

    if (!segments.length) {
      throw new Error(
        "YouTube did not render a transcript panel" +
          (findTranscriptPanel() ? " (a panel exists but held no readable lines)" : "") +
          describeTranscriptDom()
      );
    }

    for (let i = 0; i < segments.length; i++) {
      const next = segments[i + 1];
      segments[i].duration =
        next && next.start > segments[i].start ? next.start - segments[i].start : 2;
    }

    return segments.map((s) => ({ start: s.start, duration: s.duration, text: s.text }));
  }

  /**
   * The signed caption URL the player itself used, if it is still on the timeline.
   *
   * YouTube's caption URLs carry `exp=xpe`, which announces that a proof-of-origin
   * token is required — fetching one ourselves only earns an empty 200. The player
   * has already solved that: it fetches captions with a `pot` token attached, and
   * the browser records every URL it requested. Reusing that exact URL returns the
   * same bytes the player downloaded, at no extra cost and with no token juggling.
   */
  function findPlayerCaptionUrl(videoId) {
    let entries = [];
    try {
      entries = performance.getEntriesByType("resource") || [];
    } catch (err) {
      return null;
    }
    let best = null;
    for (const entry of entries) {
      const url = entry.name || "";
      if (!url.includes("/api/timedtext")) continue;
      if (videoId && !url.includes("v=" + videoId)) continue;
      best = url; // the last one is the most recent attempt
    }
    return best;
  }

  /** Makes the player fetch captions, so its signed URL lands on the timeline. */
  function nudgePlayerCaptions() {
    const player = document.getElementById("movie_player");
    try {
      if (player && player.getOption) {
        const tracks = player.getOption("captions", "tracklist") || [];
        const track = tracks.find((t) => t.kind === "asr") || tracks[0];
        if (track) {
          player.setOption("captions", "track", track);
          return "the player's caption API";
        }
      }
    } catch (err) { /* fall through to the panel */ }
    const button = findTranscriptButton();
    if (button) {
      button.click();
      return "the \"Show transcript\" control";
    }
    return null;
  }

  /**
   * Strategy 1: reuse the player's own signed caption URL.
   *
   * The cleanest source inside the page. It is YouTube's own request, made with its
   * own proof-of-origin token, so it works on the videos where every hand-built
   * request is refused.
   */
  async function fetchViaPlayerUrl(videoId, track) {
    let url = findPlayerCaptionUrl(videoId);
    if (!url) {
      const nudged = nudgePlayerCaptions();
      const deadline = Date.now() + 8000;
      while (!url && Date.now() < deadline) {
        await wait(250);
        url = findPlayerCaptionUrl(videoId);
      }
      if (!url) {
        throw new Error(
          "the player never fetched captions" +
            (nudged ? " (tried " + nudged + ")" : " (found no way to start it)")
        );
      }
    }

    url = setFormat(url, "json3");
    const language = (track && track.languageCode) || "";
    const candidates = [];
    if (!/^en/i.test(language)) candidates.push(url + "&tlang=en"); // ask YouTube for English
    candidates.push(url);

    const attempts = [];
    for (const candidate of candidates) {
      for (const transport of [browserGet, gmGet]) {
        let result;
        try {
          result = await transport(candidate);
        } catch (err) {
          attempts.push(transport.name + ": " + (err.message || err));
          continue;
        }
        const segments = parseCaptionBody(result.text);
        if (segments.length) return segments;
        attempts.push(
          "player's own URL" +
            (candidate.includes("tlang=") ? " (English)" : "") +
            " " + result.via + " -> HTTP " + result.status + ", " + result.text.length + " bytes"
        );
      }
    }
    throw new Error(attempts.join(" ; "));
  }

  async function fetchTranscript(track, videoId) {
    const attempts = [];

    try {
      const segments = await fetchViaPlayerUrl(videoId, track);
      if (segments.length) return segments;
      attempts.push("player's own URL -> empty");
    } catch (err) {
      attempts.push("player's own URL -> " + (err.message || err));
    }

    // Strategy 2: the signed timedtext URL from the player response. Skipped
    // outright when exp=xpe announces that a PO token is required, because
    // YouTube would only answer with an empty 200 and waste a round trip.
    const trackUrl = (track && track.url) || "";
    if (!trackUrl) {
      attempts.push("no caption track in the player response");
    } else if (/[?&]exp=xpe/.test(trackUrl)) {
      attempts.push("timedtext skipped (exp=xpe: proof-of-origin token required)");
    } else {
      for (const url of [setFormat(trackUrl, "json3"), trackUrl]) {
        for (const transport of [browserGet, gmGet]) {
          let result;
          try {
            result = await transport(url);
          } catch (err) {
            attempts.push(transport.name + ": " + (err.message || err));
            continue;
          }
          const segments = parseCaptionBody(result.text);
          if (segments.length) return segments;

          const preview = result.text.slice(0, 70).replace(/\s+/g, " ").trim();
          attempts.push(
            result.via + " " + result.type + " -> HTTP " + result.status + ", " +
              result.text.length + " bytes" + (preview ? ' ["' + preview + '"]' : " [empty body]")
          );
        }
      }
    }

    // Strategy 3: the transcript panel's own InnerTube endpoint. Called from
    // the real page with the real session, which may satisfy the newer
    // integrity checks that reject a plain server-side request.
    try {
      const segments = await fetchViaTranscriptPanel(videoId);
      if (segments.length) return segments;
      attempts.push("get_transcript -> empty");
    } catch (err) {
      attempts.push("get_transcript -> " + (err.message || err));
    }

    // Strategy 4: read YouTube's own rendered transcript panel.
    try {
      const segments = await fetchViaRenderedPanel();
      if (segments.length) return segments;
      attempts.push("rendered panel -> empty");
    } catch (err) {
      attempts.push("rendered panel -> " + (err.message || err));
    }

    throw new Error("Could not read this video's captions. " + attempts.join(" ; "));
  }

  /**
   * Chapters typed into the description as "00:00 Title". The server re-derives
   * topics from the transcript regardless; these are only a hint.
   */
  function parseChaptersFromDescription(description) {
    if (!description) return [];
    const lineRe = /^\s*(?:[-•*]\s*)?\(?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\)?\s*[-–—:)\].]?\s*(.+?)\s*$/;
    const found = [];
    for (const line of description.split(/\r?\n/)) {
      const match = line.match(lineRe);
      if (!match) continue;
      const seconds =
        parseInt(match[1] || "0", 10) * 3600 +
        parseInt(match[2], 10) * 60 +
        parseInt(match[3], 10);
      const title = match[4].replace(/\s+/g, " ").trim();
      if (!title || title.length > 120) continue;
      found.push({ title, start_time: seconds, end_time: 0 });
    }
    if (found.length < 2) return [];
    found.sort((a, b) => a.start_time - b.start_time);
    found.forEach((chapter, index) => {
      chapter.end_time = index + 1 < found.length ? found[index + 1].start_time : 0;
    });
    return found;
  }

  function postToServer(payload) {
    const serverUrl = getSetting("serverUrl");
    const token = getSetting("ingestToken");
    if (!token) {
      return Promise.reject(
        new Error("No ingest token set. Click ⚙️ Setup and paste your token.")
      );
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: serverUrl + "/api/ingest/transcript",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        data: JSON.stringify(payload),
        timeout: 180000,
        onload: (res) => {
          let body = null;
          try { body = JSON.parse(res.responseText || "{}"); } catch (err) { body = null; }
          if (res.status === 201 && body && body.ingest_id) {
            resolve({ body, serverUrl });
            return;
          }
          if (res.status === 401) {
            reject(new Error("Your ingest token was rejected. Open ⚙️ Setup and press Test."));
            return;
          }
          if (res.status === 413) {
            reject(new Error("This transcript is too large for the server to accept."));
            return;
          }
          if (res.status === 429) {
            reject(new Error((body && body.detail) || "The server is at capacity. Try again shortly."));
            return;
          }
          const detail = (body && body.detail) || res.responseText || "";
          reject(new Error("Ingest failed (HTTP " + res.status + "). " + String(detail).slice(0, 300)));
        },
        onerror: () => reject(new Error("Could not reach " + serverUrl + ". Check ⚙️ Setup.")),
        ontimeout: () => reject(new Error("The server took too long to accept the transcript.")),
      });
    });
  }

  /**
   * Opens the workspace tab.
   *
   * window.open() is called after several awaits, so the page no longer has a
   * user gesture — many browsers silently block it. GM_openInTab is not subject
   * to that, so it is tried first, and the caller is told whether anything
   * actually opened rather than assuming success.
   */
  function openWorkspace(url) {
    try {
      if (typeof GM_openInTab === "function") {
        GM_openInTab(url, { active: true, insert: true, setParent: true });
        return true;
      }
    } catch (err) { /* fall through to window.open */ }

    try {
      const handle = window.open(url, "_blank");
      return Boolean(handle);
    } catch (err) {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Main flow
  // -------------------------------------------------------------------------

  async function run() {
    if (state.busy) return;
    const videoId = currentVideoId();
    if (!videoId) {
      showHint("Open a YouTube video first.", "error");
      return;
    }
    if (!isConfigured()) {
      showHint("Setup needed: paste your ingest token first.", "warn");
      toggleSettings(true);
      return;
    }

    setBusy(true, "Reading captions…");
    showHint("Finding this lecture's caption track…");

    try {
      const playerResponse = getPlayerResponse(videoId);
      if (!playerResponse) {
        throw new Error("Could not read this page's video data. Reload the page and try again.");
      }

      // A missing caption track is no longer fatal: the InnerTube transcript
      // panel can still have one, so fall through and let fetchTranscript try.
      const track = pickCaptionTrack(playerResponse) || { url: "", language: "" };

      showHint(
        "Reading the transcript" + (track.language ? " (" + track.language + ")" : "") +
          "… YouTube may briefly open its own transcript panel."
      );
      const segments = await fetchTranscript(track, videoId);
      if (segments.length < 5) {
        throw new Error(
          "Only " + segments.length + " caption lines were found, which is too few to build notes from."
        );
      }

      const details = playerResponse.videoDetails || {};
      const description = details.shortDescription || "";
      const payload = {
        video_id: videoId,
        title: details.title || document.title.replace(/ - YouTube$/, ""),
        channel: details.author || "",
        description,
        duration: parseInt(details.lengthSeconds || "0", 10) || 0,
        youtube_url: "https://www.youtube.com/watch?v=" + videoId,
        chapters: parseChaptersFromDescription(description),
        transcript: segments,
        source: "userscript",
      };

      showHint("Sending " + segments.length + " caption lines to your workspace…");
      setBusy(true, "Sending…");
      const { body, serverUrl } = await postToServer(payload);

      setBusy(false);
      const workspaceUrl = serverUrl + "/?ingest=" + body.ingest_id;
      const opened = openWorkspace(workspaceUrl);
      showHint(
        "Done — " + body.segments + " lines (" + Math.round(body.transcript_chars / 1000) +
          "k chars) accepted. " +
          (opened
            ? "Opening your workspace…"
            : "Your browser blocked the new tab — open this link to continue: " + workspaceUrl),
        opened ? "ok" : "warn"
      );
    } catch (err) {
      setBusy(false);
      showHint(err.message || String(err), "error");
    }
  }

  // -------------------------------------------------------------------------
  // YouTube is a single-page app: mount/unmount as the user navigates
  // -------------------------------------------------------------------------

  function syncVisibility() {
    const onWatchPage = /^\/watch/.test(location.pathname);
    if (onWatchPage) {
      mount();
      renderConfigState();
    } else if (state.root) {
      unmount();
    }
  }

  registerMenu();
  syncVisibility();

  document.addEventListener("yt-navigate-finish", syncVisibility);
  window.addEventListener("popstate", syncVisibility);
  // Belt and braces for when neither event fires.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      syncVisibility();
    }
  }, 1200);
})();
