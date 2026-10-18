// ==UserScript==
// @name         4 U By U — Lecture to Study Notes
// @namespace    https://four-u-by-u-workspace.onrender.com
// @version      1.0.0
// @description  Turns the YouTube lecture you are already watching into a chapterised study handbook. Captures the transcript in your own browser and hands it to your 4 U By U workspace.
// @author       Anikethana
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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
    button: null,
    label: null,
    hint: null,
  };

  // -------------------------------------------------------------------------
  // Settings (stored by the userscript manager, never sent anywhere else)
  // -------------------------------------------------------------------------

  const getSetting = (key) => GM_getValue(key, DEFAULTS[key]);
  const setSetting = (key, value) => GM_setValue(key, value);

  function registerMenu() {
    GM_registerMenuCommand("⚙️ Set 4 U By U server URL", () => {
      const current = getSetting("serverUrl");
      const next = prompt(
        "Where is your 4 U By U workspace running?\n\n" +
          "Locally:  http://127.0.0.1:8000\n" +
          "Deployed: https://four-u-by-u-workspace.onrender.com",
        current
      );
      if (next && next.trim()) {
        setSetting("serverUrl", next.trim().replace(/\/+$/, ""));
        toast("Server URL saved.", "ok");
      }
    });

    GM_registerMenuCommand("🔑 Set 4 U By U ingest token", () => {
      const next = prompt(
        "Paste your ingest token.\n\n" +
          "On your server this is the EXTENSION_INGEST_TOKEN value.\n" +
          "It is sent only to your own 4 U By U server.",
        getSetting("ingestToken")
      );
      if (next !== null) {
        setSetting("ingestToken", next.trim());
        toast(next.trim() ? "Ingest token saved." : "Ingest token cleared.", "ok");
      }
    });

    GM_registerMenuCommand("ℹ️ Show 4 U By U settings", () => {
      alert(
        "4 U By U settings\n\n" +
          "Server: " + getSetting("serverUrl") + "\n" +
          "Token : " + (getSetting("ingestToken") ? "set (" + getSetting("ingestToken").slice(0, 6) + "…)" : "NOT SET — required") +
          "\n\nNothing is read from this page except the video's own caption\n" +
          "track and public metadata. Cookies never leave your browser."
      );
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
      min-width: 268px; max-width: 340px;
      padding: 14px 16px; border-radius: 16px;
      background: rgba(20, 22, 34, 0.72);
      -webkit-backdrop-filter: blur(16px) saturate(140%);
      backdrop-filter: blur(16px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
      color: #eef1fb; opacity: 0; transform: translateY(8px) scale(0.98);
      transition: opacity .18s ease, transform .18s ease;
      pointer-events: none;
    }
    #fubyu-card.visible { opacity: 1; transform: none; pointer-events: auto; }
    #fubyu-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; font-weight: 700; letter-spacing: .09em;
      text-transform: uppercase; color: #9fb0d8; margin-bottom: 7px;
    }
    #fubyu-hint { font-size: 12.5px; line-height: 1.5; color: #cfd8ef; }
    #fubyu-hint.error { color: #ffb4b4; }
    #fubyu-hint.ok { color: #a7f3c4; }
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
        <div id="fubyu-title"><span>4 U By U</span></div>
        <div id="fubyu-hint">Reading this lecture's captions…</div>
      </div>
      <button id="fubyu-button" type="button">
        <span id="fubyu-spinner"></span>
        <span id="fubyu-label">Generate Study Notes</span>
      </button>
    `;
    document.body.appendChild(root);

    state.root = root;
    state.button = root.querySelector("#fubyu-button");
    state.label = root.querySelector("#fubyu-label");
    state.hint = root.querySelector("#fubyu-hint");
    state.button.addEventListener("click", run);
  }

  function unmount() {
    if (state.root && state.root.parentNode) state.root.parentNode.removeChild(state.root);
    state.root = state.button = state.label = state.hint = null;
  }

  function showHint(message, kind) {
    if (!state.hint || !state.root) return;
    state.hint.textContent = message;
    state.hint.className = kind || "";
    state.root.querySelector("#fubyu-card").classList.add("visible");
  }

  function toast(message, kind) {
    showHint(message, kind);
    // Auto-hide informational toasts; errors stay until the next attempt.
    if (kind !== "error") {
      setTimeout(() => {
        const card = state.root && state.root.querySelector("#fubyu-card");
        if (card) card.classList.remove("visible");
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
    let translated = false;
    let language = chosen.languageCode || "unknown";

    if (!isEnglish(chosen) && chosen.isTranslatable && url) {
      // YouTube's own machine translation — better than nothing, and free.
      url += (url.includes("?") ? "&" : "?") + "tlang=en";
      translated = true;
      language = language + " → en (auto-translated by YouTube)";
    }

    return {
      url,
      language,
      translated,
      label: chosen.name ? chosen.name.simpleText || chosen.name.runs?.[0]?.text : language,
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
          if (res.status >= 200 && res.status < 300) resolve(res.responseText || "");
          else reject(new Error("YouTube returned HTTP " + res.status + " for the caption track."));
        },
        onerror: () => reject(new Error("Could not reach YouTube for the caption track.")),
        ontimeout: () => reject(new Error("Timed out reading the caption track.")),
      });
    });
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

  function tidy(text) {
    return decodeEntities(String(text || "")).replace(/\s+/g, " ").trim();
  }

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
    const nodes = doc.querySelectorAll("text, p");
    const segments = [];
    nodes.forEach((node) => {
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

  async function fetchTranscript(track) {
    const withFormat = track.url + (track.url.includes("?") ? "&" : "?") + "fmt=json3";
    try {
      const raw = await gmGet(withFormat);
      if (raw && raw.trim()) {
        const segments = parseJson3(raw);
        if (segments.length) return segments;
      }
    } catch (err) { /* fall through to the XML shape */ }

    const raw = await gmGet(track.url);
    if (raw && raw.trim()) {
      const segments = parseTimedTextXml(raw);
      if (segments.length) return segments;
    }
    throw new Error(
      "YouTube returned an empty caption track. Open the video's \"Show transcript\" " +
        "panel once, then try again."
    );
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
      const seconds = (parseInt(match[1] || "0", 10) * 3600) + (parseInt(match[2], 10) * 60) + parseInt(match[3], 10);
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
        new Error(
          "No ingest token configured. Click the Tampermonkey icon → " +
            "\"Set 4 U By U ingest token\" and paste your server's EXTENSION_INGEST_TOKEN."
        )
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
            reject(new Error("Your ingest token was rejected. Re-check it in the userscript menu."));
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
        onerror: () => reject(new Error("Could not reach " + serverUrl + ". Is the server running and the URL correct?")),
        ontimeout: () => reject(new Error("The server took too long to accept the transcript.")),
      });
    });
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

    setBusy(true, "Reading captions…");
    showHint("Finding this lecture's caption track…");

    try {
      const playerResponse = getPlayerResponse(videoId);
      if (!playerResponse) {
        throw new Error("Could not read this page's video data. Reload the page and try again.");
      }

      const track = pickCaptionTrack(playerResponse);
      if (!track || !track.url) {
        throw new Error(
          "This video has no captions available, so there is nothing to turn into notes. " +
            "Try a lecture that has subtitles."
        );
      }

      showHint("Downloading the transcript (" + track.language + ")…");
      const segments = await fetchTranscript(track);
      if (segments.length < 5) {
        throw new Error("Only " + segments.length + " caption lines found — this looks like a trailer, not a lecture.");
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
      showHint(
        "Done — " + body.segments + " lines (" + Math.round(body.transcript_chars / 1000) + "k chars) accepted. " +
          "Opening your workspace…",
        "ok"
      );
      window.open(serverUrl + "/?ingest=" + body.ingest_id, "_blank");
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
      if (state.hint && !state.hint.textContent) {
        showHint("Captions are read locally in your browser. Nothing else on this page is touched.");
      }
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
