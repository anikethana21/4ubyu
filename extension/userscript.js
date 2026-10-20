// ==UserScript==
// @name         4 U By U — Lecture to Study Notes
// @namespace    https://github.com/anikethana21/4ubyu
// @version      2.1.1
// @description  Turns the YouTube lecture you are already watching into a chapterised study handbook. Captures the captions in your own browser, writes the notes with your own API key, and downloads one self-contained HTML page. No server, no account, no upload.
// @author       Anikethana
// @license      MIT
// @homepageURL  https://github.com/anikethana21/4ubyu
// @supportURL   https://github.com/anikethana21/4ubyu/issues
// @downloadURL  https://anikethana21.github.io/4ubyu/4ubyu.user.js
// @updateURL    https://anikethana21.github.io/4ubyu/4ubyu.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      api.groq.com
// ==/UserScript==

/* eslint-disable no-undef */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // This script is one file, and this file is not the whole program.
  //
  // The pipeline — reading the provider's answers, planning topics, writing the
  // page — lives in extension/src/*.js, where it is tested by `npm test` with no
  // browser involved. `node extension/build.js` folds those files in at the marker
  // below, so the thing a user installs is exactly the thing that was tested.
  //
  // What stays here is the part that only makes sense inside a userscript: reading
  // YouTube's own player data, and storing things through the script manager.
  // -------------------------------------------------------------------------

  /**
   * Settings and finished notes, kept by the userscript manager.
   *
   * Values are stored as JSON text rather than as objects, because what a manager
   * does with a stored object is its own business and differs between them; a
   * string is a string everywhere. Nothing here is sent anywhere: the panel asks
   * the provider, with the key the user pasted, and nothing else.
   */
  const store = {
    get(key, fallback = null) {
      try {
        const raw = GM_getValue("ubyu:" + key, null);
        if (raw === null || raw === undefined || raw === "") return fallback;
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        GM_setValue("ubyu:" + key, JSON.stringify(value));
      } catch (error) {
        /* a full quota is not a reason to lose the notes already on screen */
      }
    },
    remove(key) {
      try {
        GM_deleteValue("ubyu:" + key);
      } catch (error) {}
    },
  };

  // <<<UBYU_MODULES>>>

  /** The finished, tested pipeline, exactly as the tests ran it. */
  const UBYU = globalThis.UBYU;
  const UBYU_PIPELINE = globalThis.UBYU_PIPELINE;
  const UBYU_WORKSPACE = globalThis.UBYU_WORKSPACE;
  const UBYU_PANEL = globalThis.UBYU_PANEL;


  // -------------------------------------------------------------------------
  // The panel, and the one thing the page cannot do for itself
  // -------------------------------------------------------------------------

  /**
   * A request to the provider, made from this page.
   *
   * `fetch` is tried first, because Groq answers a browser request directly and
   * that is one less moving part. If the page's own Content-Security-Policy
   * refuses it, the same request goes out through the script manager instead,
   * which is not subject to the page's policy. Both return the same two things the
   * pipeline asks of a response: a status, and the body as text.
   */
  function providerFetch(url, options = {}) {
    const plain = typeof fetch === "function" ? fetch : null;
    if (!plain) return gmFetch(url, options);
    const timeoutMs = options.timeoutMs || 60000;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const plainPromise = plain(url, { ...options, signal: controller ? controller.signal : undefined });
    const timeoutPromise = new Promise((resolve, reject) => {
      if (!timer) return reject(new Error("no timer"));
      timer.ref ? timer.ref() : null;
      setTimeout(() => reject(new Error(`the request took longer than ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
    });
    return Promise.race([plainPromise, timeoutPromise]).catch((error) =>
      gmFetch(url, options).catch(() => Promise.reject(error))
    );
  }

  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        headers: options.headers || {},
        data: options.body,
        timeout: 180000,
        onload: (response) =>
          resolve({
            status: response.status,
            text: async () => response.responseText || "",
          }),
        onerror: () => reject(new Error("the request could not be made")),
        ontimeout: () => reject(new Error("the request timed out")),
      });
    });
  }

  /**
   * The panel. It owns the key, the model list, the cost, the progress and the
   * page; the only thing it asks of this file is the lecture itself.
   */
  const panel = UBYU_PANEL.install({
    capture: captureLecture,
    store,
    fetchImpl: providerFetch,
  });


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
    // Ask YouTube for English first, then the original. Auto-generated tracks are
    // often labelled with the page's language while the audio is in another one,
    // and handing the pipeline a Hindi transcript costs it a translation pass over
    // the whole lecture plus far more tokens per character inside every agent.
    const candidates = [url + "&tlang=en", url];

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
      // Field names must match usableChapters: timestamp_seconds, not start_time
      found.push({ title, timestamp_seconds: seconds, end_time: 0 });
    }
    if (found.length < 2) return [];
    found.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
    found.forEach((chapter, index) => {
      chapter.end_time = index + 1 < found.length ? found[index + 1].timestamp_seconds : 0;
    });
    return found;
  }

  /**
   * YouTube native chapters from the player response.
   * These are set by the creator in YouTube Studio and are more reliable than
   * description parsing. The player response may have them in several places.
   */
  function parseNativeChapters(playerResponse) {
    const sources = [
      // Standard location in newer player responses
      playerResponse?.chapters,
      // Microformat location (older)
      playerResponse?.microformat?.playerMicroformatRenderer?.chapters,
      // Sometimes in videoDetails
      playerResponse?.videoDetails?.chapters,
    ];

    for (const src of sources) {
      const arr = Array.isArray(src) ? src : (src?.chapters || []);
      const found = [];
      for (const chapter of arr) {
        const title = String(chapter?.title || chapter?.chapter_title || "").trim();
        const start = Number(
          chapter?.timestamp_seconds ??
          chapter?.start_time ??
          chapter?.start ??
          chapter?.startTime ??
          0
        );
        if (title && start >= 0) {
          found.push({ title, timestamp_seconds: start, end_time: 0 });
        }
      }
      if (found.length >= 2) {
        found.sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
        found.forEach((chapter, index) => {
          chapter.end_time = index + 1 < found.length ? found[index + 1].timestamp_seconds : 0;
        });
        return found;
      }
    }
    return [];
  }

  // -------------------------------------------------------------------------
  // Reading this lecture
  // -------------------------------------------------------------------------

  /**
   * The lecture playing in this tab, in the shape the pipeline wants.
   *
   * This is the part that cannot be tested outside a browser and cannot be worked
   * out from the URL: YouTube's player data is a JavaScript object buried in the
   * page, the caption track may be behind a signed URL, and the transcript panel
   * may only exist once something has opened it. `fetchTranscript` tries four
   * routes, in order of how little each disturbs the page.
   */
  async function captureLecture() {
    const videoId = currentVideoId();
    if (!videoId) throw new Error("Open a YouTube video first.");

    const playerResponse = getPlayerResponse(videoId);
    if (!playerResponse) {
      throw new Error("Could not read this page's video data. Reload the page and try again.");
    }

    // A missing caption track on the player response is not fatal: the transcript
    // panel can still have one, so this falls through with an empty track.
    const track = pickCaptionTrack(playerResponse) || { url: "", language: "" };
    const segments = await fetchTranscript(track, videoId);
    if (segments.length < 5) {
      throw new Error(
        "Only " + segments.length + " caption line" + (segments.length === 1 ? "" : "s") +
          " could be found. Open the video's transcript panel once, then try again."
      );
    }

    // The notes are written in English, from English speech. A non-English
    // transcript is refused here, before a single API call is spent, with the
    // real reason and a number rather than a vague "could not read this".
    const spokenText = segments.map((segment) => segment.text || "").join(" ");
    const language = UBYU.isEnglishTranscript(spokenText);
    if (!language.english) {
      const percent = Math.round(language.share * 100);
      throw new Error(
        "These captions are not in English, and 4 U By U only writes English notes. " +
          "Only " + percent + "% of the letters in this transcript are Latin, so the words " +
          "would have to be machine-translated before they could be explained — and technical " +
          "terms do not survive that. Choose a lecture with English captions" +
          (track.language ? " (this track is labelled \"" + track.language + "\")" : "") +
          ". YouTube's own auto-translate is used when a track offers it; this one does not."
      );
    }

    const details = playerResponse.videoDetails || {};
    const description = details.shortDescription || "";
    const stated = parseInt(details.lengthSeconds || "0", 10) || 0;
    const last = segments[segments.length - 1] || {};
    const spoken = Math.ceil((last.start || 0) + (last.duration || 0));
    const duration = Math.max(stated, spoken);
    const thumbnails = (details.thumbnail && details.thumbnail.thumbnails) || [];

    // Prefer YouTube native chapters (set by creator in Studio), fall back to description
    const nativeChapters = parseNativeChapters(playerResponse);
    const descriptionChapters = parseChaptersFromDescription(description);
    const chapters = nativeChapters.length ? nativeChapters : descriptionChapters;

    return {
      segments,
      video: {
        video_id: videoId,
        title: details.title || document.title.replace(/ - YouTube$/, ""),
        channel: details.author || "",
        duration,
        duration_str: UBYU.clock(duration),
        thumbnail: thumbnails.length ? thumbnails[thumbnails.length - 1].url : "",
        chapters,
      },
    };
  }


  // -------------------------------------------------------------------------
  // Where it lives, and how it survives YouTube's navigation
  // -------------------------------------------------------------------------

  /**
   * YouTube is a single-page app: the URL changes without the document being
   * reloaded, so a button added once to the page would be left behind on the next
   * video. `yt-navigate-finish` is the event that says a video has arrived;
   * the two others are there for the times it does not fire.
   */
  function refresh() {
    const onWatch = /^\/watch/.test(location.pathname);
    panel.setAvailable(onWatch);
    // Every YouTube video has the same pathname (/watch); only ?v= changes.
    // So the panel is told which lecture is on screen; when that id changes it
    // drops the old transcript instead of holding it hostage until a restart.
    if (typeof panel.setVideo === "function") panel.setVideo(onWatch ? currentVideoId() : "");
  }

  GM_registerMenuCommand("✦ Turn this lecture into notes", () => panel.open());
  GM_registerMenuCommand("📚 Notes I have already made", () => panel.open("library"));

  refresh();
  document.addEventListener("yt-navigate-finish", refresh);
  window.addEventListener("popstate", refresh);
  // The query string is watched too: moving from one lecture to the next keeps
  // the pathname at /watch, so watching only the pathname would never fire.
  let lastUrl = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== lastUrl) {
      lastUrl = now;
      refresh();
    }
  }, 800);
})();
