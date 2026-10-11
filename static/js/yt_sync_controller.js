// 4 U By U - Master YouTube Video & Handbook Two-Way Synchronization Controller
// Handles iframe embedding, bidirectional timestamp seeks, reading-aware scroll highlights,
// and the sliding minimized navbar burger effect on scroll.

let ytPlayer = null;
let autoSyncMode = "TWO_WAY"; // Options: "TWO_WAY", "VIDEO_FOLLOW", "MANUAL"
let isProgrammaticScroll = false;
let seekDebounceTimer = null;

// 1. YouTube Iframe API Initialization
function onYouTubeIframeAPIReady() {
  const frameEl = document.getElementById("yt-player-frame");
  if (!frameEl) return;
  const videoId = frameEl.dataset.videoId;
  if (!videoId) return;

  ytPlayer = new YT.Player("yt-player-frame", {
    videoId: videoId,
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      enablejsapi: 1,
      origin: window.location.origin
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
}

function onPlayerReady(event) {
  setInterval(trackVideoPlaybackTime, 500);
}

function onPlayerStateChange(event) {
  // Can handle play/pause sync if needed
}

// 2. Deep-Link Seek Function
function seekVideo(seconds) {
  if (ytPlayer && typeof ytPlayer.seekTo === "function") {
    ytPlayer.seekTo(seconds, true);
    if (typeof ytPlayer.playVideo === "function") {
      ytPlayer.playVideo();
    }
    showSyncToast("Jumped video to " + formatSec(seconds));
  }
}

// 3. Ticker: Video Playback -> Notes Highlight
function trackVideoPlaybackTime() {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
  const currentTime = ytPlayer.getCurrentTime();
  
  const timeDisplay = document.getElementById("current-playback-time");
  if (timeDisplay) timeDisplay.textContent = formatSec(currentTime);

  if (autoSyncMode === "MANUAL") return;

  const chapterCards = document.querySelectorAll(".chapter-card");
  let activeCard = null;

  chapterCards.forEach(function(card) {
    const ts = Number(card.dataset.timestampSeconds || 0);
    if (currentTime >= ts) {
      activeCard = card;
    }
  });

  if (activeCard && !activeCard.classList.contains("active-reading")) {
    chapterCards.forEach(function(c) { c.classList.remove("active-reading"); });
    activeCard.classList.add("active-reading");

    if (autoSyncMode === "TWO_WAY" && !isProgrammaticScroll) {
      isProgrammaticScroll = true;
      activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(function() { isProgrammaticScroll = false; }, 1000);
    }
  }
}

// 4. Header Minimization & Reading-Aware Auto-Seek
(function initNavbarBurger() {
  function setup() {
    const handbookPane = document.getElementById("handbook-pane");
    const header = document.querySelector(".handbook-header");
    if (!header) return;

    function handleNavbarBurgerScroll() {
      const scrollPos = (handbookPane ? handbookPane.scrollTop : 0) || window.pageYOffset || document.documentElement.scrollTop || 0;
      if (scrollPos > 25) {
        if (!header.classList.contains("is-compact")) {
          header.classList.add("is-compact");
        }
      } else {
        if (header.classList.contains("is-compact")) {
          header.classList.remove("is-compact");
        }
      }
    }

    if (handbookPane) {
      handbookPane.addEventListener("scroll", handleNavbarBurgerScroll, { passive: true });
    }
    window.addEventListener("scroll", handleNavbarBurgerScroll, { passive: true });
    document.addEventListener("scroll", handleNavbarBurgerScroll, { passive: true });
    handleNavbarBurgerScroll();

    if (handbookPane && window.IntersectionObserver) {
      const sectionBlocks = handbookPane.querySelectorAll(".chapter-card, .section-block");
      const readingObserver = new IntersectionObserver(function(entries) {
        if (autoSyncMode !== "TWO_WAY" || isProgrammaticScroll) return;

        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            const secSeconds = entry.target.dataset.timestampSeconds;
            const title = entry.target.dataset.chapterTitle || "Topic";

            if (secSeconds !== undefined) {
              clearTimeout(seekDebounceTimer);
              seekDebounceTimer = setTimeout(function() {
                if (ytPlayer && typeof ytPlayer.seekTo === "function") {
                  const cur = typeof ytPlayer.getCurrentTime === "function" ? ytPlayer.getCurrentTime() : 0;
                  if (Math.abs(cur - Number(secSeconds)) > 4) {
                    ytPlayer.seekTo(Number(secSeconds), true);
                    showSyncToast("Synced to " + title + " (" + formatSec(Number(secSeconds)) + ")");
                  }
                }
              }, 600);
            }
          }
        });
      }, {
        root: handbookPane,
        rootMargin: "-15% 0px -65% 0px",
        threshold: 0.1
      });

      sectionBlocks.forEach(function(el) { readingObserver.observe(el); });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();

// 5. Auto-Sync Toggle Control
function toggleAutoSync() {
  const btn = document.getElementById("toggle-autofollow");
  if (!btn) return;
  if (autoSyncMode === "TWO_WAY") {
    autoSyncMode = "VIDEO_FOLLOW";
    btn.textContent = "Auto-Sync: VIDEO-FOLLOW";
    btn.classList.add("active");
  } else if (autoSyncMode === "VIDEO_FOLLOW") {
    autoSyncMode = "MANUAL";
    btn.textContent = "Auto-Sync: MANUAL";
    btn.classList.remove("active");
  } else {
    autoSyncMode = "TWO_WAY";
    btn.textContent = "Auto-Sync";
    btn.classList.add("active");
  }
}

// Helper: Show Sync Toast
function showSyncToast(text) {
  const toast = document.getElementById("sync-toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() {
    toast.classList.add("hidden");
  }, 2200);
}

// Helper: Format seconds to MM:SS
function formatSec(s) {
  const sec = Math.floor(s || 0);
  const m = Math.floor(sec / 60);
  const remainingS = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(remainingS).padStart(2, "0");
}

// Search filter in handbook
function filterHandbook() {
  const input = document.getElementById("notes-search");
  if (!input) return;
  const q = input.value.toLowerCase();
  const sections = document.querySelectorAll(".section-block");
  sections.forEach(function(s) {
    const text = s.textContent.toLowerCase();
    s.style.display = text.includes(q) ? "block" : "none";
  });
}
