/**
 * The extension's window into YouTube's own world.
 *
 * A content script runs in an isolated world: it shares the page's DOM, but not
 * its JavaScript. `window.ytInitialPlayerResponse` and the player element's
 * methods live on the page's side of that line, and a userscript never meets the
 * line because `unsafeWindow` is handed to it. The extension does, so this file
 * is declared as a `"world": "MAIN"` content script: it runs as part of the page,
 * can read the player object, and answers the isolated script over the DOM.
 *
 * Only strings cross between the worlds — a CustomEvent's `detail` carrying an
 * object is not shared, and silently arrives empty. So the reply is JSON text.
 *
 * `extension/build.js` copies this file into the package as `page-bridge.js` and
 * adds it to the manifest. It is not part of the userscript.
 */
(function () {
  "use strict";

  /** The player response for the video in the address bar, if the page has one. */
  function playerResponse(videoId) {
    const wanted = videoId || new URLSearchParams(location.search).get("v") || "";
    const matches = (candidate) =>
      candidate &&
      candidate.videoDetails &&
      (!wanted || candidate.videoDetails.videoId === wanted);

    const candidates = [];
    try {
      if (window.ytInitialPlayerResponse) candidates.push(window.ytInitialPlayerResponse);
    } catch (error) {
      /* nothing to add */
    }
    try {
      const args = window.ytplayer && window.ytplayer.config && window.ytplayer.config.args;
      if (args && args.player_response) candidates.push(JSON.parse(args.player_response));
    } catch (error) {
      /* nothing to add */
    }

    const direct = candidates.find(matches);
    if (direct) return direct;

    // After YouTube's own single-page navigation the bootstrap object is the
    // previous video's; the live player is the only source that has moved on.
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const live = player.getPlayerResponse();
        if (matches(live)) return live;
      }
    } catch (error) {
      /* the player is not ready, or has no response yet */
    }

    return null;
  }

  /** The page's InnerTube credentials, which a content script cannot otherwise see. */
  function config() {
    try {
      const cfg = window.ytcfg;
      if (!cfg || typeof cfg.get !== "function") return null;
      return {
        key: cfg.get("INNERTUBE_API_KEY") || "",
        version: cfg.get("INNERTUBE_CLIENT_VERSION") || "",
        context: cfg.get("INNERTUBE_CONTEXT") || null,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Turn captions on in the player.
   *
   * This is the one action that makes YouTube fetch its own signed caption URL:
   * the player adds a proof-of-origin token, the request lands in the page's
   * resource timings, and the content script can reuse that exact URL. A
   * content script cannot call the player's methods — they are page functions —
   * so the nudge has to happen here.
   */
  function nudgeCaptions() {
    let player = null;
    try {
      player = document.getElementById("movie_player");
    } catch (error) {
      player = null;
    }
    if (!player) return "no player element on the page";

    let tracks = [];
    try {
      tracks = (typeof player.getOption === "function" && player.getOption("captions", "tracklist")) || [];
    } catch (error) {
      tracks = [];
    }
    if (!tracks.length && typeof player.toggleSubtitles === "function") {
      try {
        player.toggleSubtitles();
        tracks = player.getOption("captions", "tracklist") || [];
      } catch (error) {
        tracks = [];
      }
    }
    if (!tracks.length) return "the player has no caption track";

    // A human-written track first, then the auto-generated one: the notes are
    // better from real captions, but the automatic ones are enough to start.
    const track = tracks.find((t) => t.kind !== "asr") || tracks.find((t) => t.kind === "asr") || tracks[0];
    try {
      player.setOption("captions", "track", track);
      return "the player's caption API";
    } catch (error) {
      return "the player refused the caption track";
    }
  }

  /** One reply shape for every question, so each answer carries its own id. */
  function answer(type, id, payload) {
    document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(Object.assign({ id }, payload)) }));
  }

  document.addEventListener("ubyu:want-player", (event) => {
    const id = String((event && event.detail) || "");
    if (!id) return;

    let player = null;
    try {
      player = playerResponse();
    } catch (error) {
      player = null;
    }
    let cfg = null;
    try {
      cfg = config();
    } catch (error) {
      cfg = null;
    }

    answer("ubyu:player-response", id, { player, config: cfg });
  });

  document.addEventListener("ubyu:want-captions", (event) => {
    const id = String((event && event.detail) || "");
    if (!id) return;
    let method = "";
    try {
      method = nudgeCaptions();
    } catch (error) {
      method = "";
    }
    answer("ubyu:captions-response", id, { method });
  });
})();
