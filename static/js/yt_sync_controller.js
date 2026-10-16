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
  const mobileTimeBadge = document.getElementById("mobile-time-badge");
  if (mobileTimeBadge) mobileTimeBadge.textContent = formatSec(currentTime);

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

// 4. Reading-Aware Auto-Seek
(function initReadingSync() {
  function setup() {
    const handbookPane = document.getElementById("handbook-pane");
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
  const q = input.value.toLowerCase().trim();
  const sections = document.querySelectorAll(".section-block");
  const chapters = document.querySelectorAll("article.chapter-card");

  if (!q) {
    sections.forEach(function(s) { s.style.display = "block"; });
    chapters.forEach(function(c) { c.style.display = "block"; });
    return;
  }

  chapters.forEach(function(ch) {
    let hasMatch = false;
    const chTitle = (ch.getAttribute("data-chapter-title") || "").toLowerCase();
    if (chTitle.includes(q)) hasMatch = true;

    const chSections = ch.querySelectorAll(".section-block");
    chSections.forEach(function(s) {
      const match = s.textContent.toLowerCase().includes(q);
      s.style.display = match ? "block" : "none";
      if (match) hasMatch = true;
    });

    ch.style.display = hasMatch ? "block" : "none";
  });
}

// =========================================================================
// 4 U By U ? AI-BASED PREDICTIVE TOPIC SEARCH & INTELLIGENT AUTOCOMPLETE
// Indexes chapters, sections, algorithms, concepts, and pre-seeded questions.
// Provides instantaneous jump-to-timestamp and direct AI Assistant queries.
// =========================================================================

let _topicIndex = [];
let _activeSuggestionIndex = -1;

function buildTopicIndex() {
  _topicIndex = [];
  const seenTitles = new Set();

  // 1. Index Chapters
  const chapters = document.querySelectorAll("article.chapter-card");
  chapters.forEach(function(ch, idx) {
    const title = ch.getAttribute("data-chapter-title") || (ch.querySelector("h2") ? ch.querySelector("h2").innerText.trim() : "Chapter " + (idx + 1));
    const sec = parseInt(ch.getAttribute("data-timestamp-seconds") || "0", 10);
    const id = ch.id || "chapter-" + (idx + 1);
    if (!seenTitles.has(title.toLowerCase())) {
      seenTitles.add(title.toLowerCase());
      _topicIndex.push({
        title: title,
        type: "chapter",
        typeLabel: "Chapter",
        badgeClass: "badge-chapter",
        id: id,
        timestampSec: sec,
        timestampStr: formatSec(sec)
      });
    }

    // 2. Index Sections inside Chapter
    const sections = ch.querySelectorAll("section.section-block");
    sections.forEach(function(s, sIdx) {
      const sTitle = s.getAttribute("data-chapter-title") || (s.querySelector("h3") ? s.querySelector("h3").innerText.trim() : "Section " + (sIdx + 1));
      const sSec = parseInt(s.getAttribute("data-timestamp-seconds") || String(sec), 10);
      const sId = s.id || id + "-sec-" + (sIdx + 1);

      if (!seenTitles.has(sTitle.toLowerCase())) {
        seenTitles.add(sTitle.toLowerCase());
        _topicIndex.push({
          title: sTitle,
          type: "section",
          typeLabel: "Topic",
          badgeClass: "badge-section",
          chapterTitle: title,
          id: sId,
          timestampSec: sSec,
          timestampStr: formatSec(sSec)
        });
      }

      // Check for code implementations
      const codeHeading = s.querySelector("h4, .code-title, .code-lang");
      if (codeHeading) {
        const cText = codeHeading.innerText.trim();
        if (cText && !seenTitles.has(cText.toLowerCase())) {
          seenTitles.add(cText.toLowerCase());
          _topicIndex.push({
            title: cText,
            type: "code",
            typeLabel: "Code",
            badgeClass: "badge-code",
            chapterTitle: title,
            id: sId,
            timestampSec: sSec,
            timestampStr: formatSec(sSec)
          });
        }
      }
    });
  });

  // 3. Fallback check for table of contents
  if (_topicIndex.length === 0) {
    const tocItems = document.querySelectorAll(".toc-item");
    tocItems.forEach(function(item) {
      const title = item.querySelector(".toc-title") ? item.querySelector(".toc-title").innerText.trim() : item.innerText.trim();
      const timeEl = item.querySelector(".toc-time");
      const timeStr = timeEl ? timeEl.innerText.replace(/[\[\]]/g, "").trim() : "00:00";
      const parts = timeStr.split(":").map(Number);
      const sec = parts.length === 2 ? parts[0] * 60 + parts[1] : (parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0);
      const href = item.getAttribute("href") || "";
      const id = href.replace("#", "");

      _topicIndex.push({
        title: title,
        type: "chapter",
        typeLabel: "Chapter",
        badgeClass: "badge-chapter",
        id: id,
        timestampSec: sec,
        timestampStr: timeStr
      });
    });
  }
}

function handleSearchFocus() {
  const input = document.getElementById("notes-search");
  if (!input) return;
  if (_topicIndex.length === 0) buildTopicIndex();
  renderSuggestions(input.value.trim());
}

function handleSearchInput(query) {
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = query.length > 0 ? "block" : "none";

  filterHandbook();
  renderSuggestions(query.trim());
}

function clearHandbookSearch() {
  const input = document.getElementById("notes-search");
  const clearBtn = document.getElementById("search-clear-btn");
  if (input) {
    input.value = "";
    input.focus();
  }
  if (clearBtn) clearBtn.style.display = "none";
  filterHandbook();
  renderSuggestions("");
}

function renderSuggestions(query) {
  const dropdown = document.getElementById("search-suggestions-dropdown");
  const list = document.getElementById("suggestions-list");
  if (!dropdown || !list) return;

  if (_topicIndex.length === 0) buildTopicIndex();

  let matches = [];
  const q = query.toLowerCase();

  if (!q) {
    // Show top 6 recommended curriculum topics
    matches = _topicIndex.slice(0, 6);
  } else {
    // Filter matching topics
    matches = _topicIndex.filter(function(t) {
      return t.title.toLowerCase().includes(q) || (t.chapterTitle && t.chapterTitle.toLowerCase().includes(q));
    }).slice(0, 7);
  }

  list.innerHTML = "";
  _activeSuggestionIndex = -1;

  if (matches.length === 0 && !q) {
    dropdown.style.display = "none";
    return;
  }

  // Render topic matches
  matches.forEach(function(item, idx) {
    const row = document.createElement("div");
    row.className = "suggestion-item";
    row.dataset.index = String(idx);

    let displayTitle = item.title;
    if (q) {
      const reg = new RegExp("(" + q.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + ")", "gi");
      displayTitle = displayTitle.replace(reg, "<mark class='match-mark'>$1</mark>");
    }

    const chapterSubtitle = item.chapterTitle ? `<span class="suggestion-ch">${item.chapterTitle}</span>` : "";

    row.innerHTML = `
      <div class="suggestion-left">
        <span class="suggestion-badge ${item.badgeClass}">${item.typeLabel}</span>
        <div class="suggestion-texts">
          <span class="suggestion-title">${displayTitle}</span>
          ${chapterSubtitle}
        </div>
      </div>
      <div class="suggestion-right">
        <span class="suggestion-ts">[${item.timestampStr}]</span>
      </div>
    `;

    row.addEventListener("click", function() {
      selectSuggestion(item);
    });

    list.appendChild(row);
  });

  // Always append "Ask AI Assistant" option if user entered a query
  if (q) {
    const aiRow = document.createElement("div");
    aiRow.className = "suggestion-item suggestion-ai-ask";
    aiRow.innerHTML = `
      <div class="suggestion-left">
        <span class="suggestion-badge badge-ai">? Ask AI</span>
        <div class="suggestion-texts">
          <span class="suggestion-title">Ask Study Assistant about: "<strong>${escapeHtml(query)}</strong>"</span>
        </div>
      </div>
      <div class="suggestion-right">
        <span class="suggestion-key">Enter ?</span>
      </div>
    `;
    aiRow.addEventListener("click", function() {
      askStudyAssistant(query);
      closeSearchDropdown();
    });
    list.appendChild(aiRow);
  }

  dropdown.style.display = "block";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function selectSuggestion(item) {
  closeSearchDropdown();

  // 1. Seek YouTube Video
  if (window.seekVideoTo && typeof window.seekVideoTo === "function") {
    window.seekVideoTo(item.timestampSec);
  } else {
    const player = window.ytPlayerInstance;
    if (player && typeof player.seekTo === "function") {
      player.seekTo(item.timestampSec, true);
    }
  }

  // 2. Scroll to Target Section in Handbook
  const targetEl = document.getElementById(item.id);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    targetEl.classList.remove("highlight-pulse");
    void targetEl.offsetWidth; // trigger reflow
    targetEl.classList.add("highlight-pulse");
    setTimeout(function() {
      targetEl.classList.remove("highlight-pulse");
    }, 2800);
  }
}

function askStudyAssistant(query) {
  const chatInput = document.getElementById("chat-query");
  const chatForm = document.getElementById("chat-form");
  if (chatInput && chatForm) {
    chatInput.value = query;
    if (typeof sendPrompt === "function") {
      sendPrompt(query);
    } else {
      chatForm.dispatchEvent(new Event("submit"));
    }
  }
}

function closeSearchDropdown() {
  const dropdown = document.getElementById("search-suggestions-dropdown");
  if (dropdown) dropdown.style.display = "none";
}

// Global click outside to dismiss search suggestions
document.addEventListener("click", function(e) {
  const wrapper = document.getElementById("search-input-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    closeSearchDropdown();
  }
});

// Keyboard navigation in searchbar
document.addEventListener("keydown", function(e) {
  const input = document.getElementById("notes-search");
  const dropdown = document.getElementById("search-suggestions-dropdown");
  if (!input || !dropdown || dropdown.style.display === "none") return;

  if (document.activeElement !== input) return;

  const items = dropdown.querySelectorAll(".suggestion-item");
  if (items.length === 0) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    _activeSuggestionIndex = (_activeSuggestionIndex + 1) % items.length;
    updateActiveSuggestion(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    _activeSuggestionIndex = (_activeSuggestionIndex - 1 + items.length) % items.length;
    updateActiveSuggestion(items);
  } else if (e.key === "Enter") {
    if (_activeSuggestionIndex >= 0 && _activeSuggestionIndex < items.length) {
      e.preventDefault();
      items[_activeSuggestionIndex].click();
    }
  } else if (e.key === "Escape") {
    closeSearchDropdown();
  }
});

function updateActiveSuggestion(items) {
  items.forEach(function(it, idx) {
    if (idx === _activeSuggestionIndex) {
      it.classList.add("active");
      it.scrollIntoView({ block: "nearest" });
    } else {
      it.classList.remove("active");
    }
  });
}

