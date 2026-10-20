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

    document.dispatchEvent(
      new CustomEvent("ubyu:player-response", {
        detail: JSON.stringify({ id, player, config: cfg }),
      })
    );
  });
})();
