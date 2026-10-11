// 4 U By U - Docked RAG Chat Assistant Client
// Connects to /api/chat with token streaming, full Markdown parsing, timestamp seeking,
// interactive suggestions rendered as clean chips, zero emojis, and zero horizontal scrollbars.

document.addEventListener("DOMContentLoaded", function() {
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-query");
  const msgList = document.getElementById("chat-messages");

  if (!chatForm || !chatInput || !msgList) return;

  const frameEl = document.getElementById("yt-player-frame");
  const videoId = frameEl ? (frameEl.dataset.videoId || "") : "";
  const storageKey = "4ubyu_chat_" + (videoId || "general");

  // 1. Auto-read saved chat history from user's local PC
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (saved && saved.length > 0) {
      saved.forEach(function(msg) {
        if (msg.role === "user") appendUserMessage(msg.text);
        else if (msg.role === "ai") appendAiMessage(formatChatContent(msg.text));
      });
    }
  } catch (e) {
    console.warn("Could not load local chat history:", e);
  }

  function saveChatMessage(role, text) {
    if (!videoId) return;
    try {
      const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
      history.push({ role: role, text: text, timestamp: new Date().toISOString() });
      if (history.length > 40) history.shift();
      localStorage.setItem(storageKey, JSON.stringify(history));
    } catch (e) {}
  }

  chatForm.addEventListener("submit", async function(e) {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;

    chatInput.value = "";
    appendUserMessage(query);
    saveChatMessage("user", query);

    const aiBubble = appendAiMessage("<em>Analyzing notes and formulating answer...</em>");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: videoId,
          question: query
        })
      });

      if (!response.ok) {
        throw new Error("Unable to contact study assistant.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      aiBubble.innerHTML = "";

      let fullText = "";
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = decoder.decode(result.value, { stream: true });
        fullText += chunk;
        aiBubble.innerHTML = formatChatContent(fullText);
        msgList.scrollTop = msgList.scrollHeight;
      }

      saveChatMessage("ai", fullText);

    } catch (err) {
      aiBubble.innerHTML = '<span style="color: #ef4444;">Notice: ' + (err.message || "Failed to reach server") + '</span>';
    }
  });

  function appendUserMessage(text) {
    const el = document.createElement("div");
    el.className = "chat-msg user-msg";
    el.textContent = text;
    msgList.appendChild(el);
    msgList.scrollTop = msgList.scrollHeight;
  }

  function appendAiMessage(initialHtmlOrText) {
    const el = document.createElement("div");
    el.className = "chat-msg ai-msg";
    el.innerHTML = initialHtmlOrText;
    msgList.appendChild(el);
    msgList.scrollTop = msgList.scrollHeight;
    return el;
  }

  function formatChatContent(text) {
    if (!text) return "";

    // 1. Strip all emojis (bulb, check, rocket, robot, etc.)
    let cleanText = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1FFFF}]/gu, "");
    cleanText = cleanText.replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, "");
    cleanText = cleanText.replace(/💡/g, "");

    // 2. Parse Markdown if available
    let html = "";
    if (window.marked && window.marked.parse) {
      try {
        html = window.marked.parse(cleanText);
      } catch (e) {
        html = cleanText.replace(/\n/g, "<br>");
      }
    } else {
      html = cleanText.replace(/\n/g, "<br>");
    }

    // 3. Replace [TS MM:SS] or [MM:SS] with clickable video seek pills
    html = html.replace(/\[?(?:TS\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\]?/g, function(match, ts) {
      const parts = ts.split(":").map(Number);
      let totalSec = 0;
      if (parts.length === 3) {
        totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else {
        totalSec = parts[0] * 60 + parts[1];
      }
      return '<button type="button" class="ts-pill-sm" onclick="if(window.seekVideo) seekVideo(' + totalSec + '); else if(window.ytPlayer) ytPlayer.seekTo(' + totalSec + ', true); return false;">' + ts + '</button>';
    });

    // 4. Replace [Jump to Section #id] with smooth anchor scroller
    html = html.replace(/\[Jump to Section #([^\]]+)\]/g, function(match, anchorId) {
      return '<a href="#" class="anchor-jump-pill" onclick="jumpToNotesAnchor(\'' + anchorId + '\'); return false;">Jump to #' + anchorId + '</a>';
    });

    // 5. Robust suggestion chips parser:
    const suggRegex = /(?:<p>|<div>)?\s*(?:(?:Suggested\s+(?:Follow-?ups?|Topics?|Questions?)|SUGGESTIONS|Suggestions)\s*:?)\s*([\s\S]*?)(?:$|(?=<h[1-6]>))/i;
    const match = html.match(suggRegex);
    if (match) {
      const listBlock = match[1];
      const liMatches = listBlock.match(/<li>([\s\S]*?)<\/li>/gi);
      let rawItems = [];
      if (liMatches && liMatches.length > 0) {
        rawItems = liMatches.map(function(li) { return li.replace(/<\/?li>/gi, "").trim(); });
      } else {
        const lineMatches = listBlock.match(/(?:^|<br>|\n)\s*(?:[-* ]|\d+\.)\s*\[?(.*?)\]?\s*(?=(?:<br>|\n|$))/gi);
        if (lineMatches) {
          rawItems = lineMatches.map(function(l) {
            return l.replace(/^(?:<br>|\n)\s*(?:[-* ]|\d+\.)\s*\[?/, "").replace(/\]?\s*$/, "").trim();
          });
        }
      }

      let validChips = [];
      rawItems.forEach(function(item) {
        let clean = item.replace(/<[^>]+>/g, "").replace(/^[-\s*\[]+/, "").replace(/[\]\s*]+$/, "").trim();
        clean = clean.replace(/💡/g, "").trim();
        if (clean && clean.length > 2 && clean.length < 80) {
          validChips.push(clean);
        }
      });

      if (validChips.length > 0) {
        let chipsHtml = '<div class="reply-chips-container"><div class="reply-chips-label">Suggestions:</div><div class="reply-chips-wrap">';
        validChips.forEach(function(chip) {
          const esc = chip.replace(/'/g, "\\'");
          chipsHtml += '<button type="button" class="reply-chip-btn" onclick="sendPrompt(\'' + esc + '\')">' + chip + '</button>';
        });
        chipsHtml += '</div></div>';
        html = html.replace(match[0], chipsHtml);
      } else {
        html = html.replace(match[0], "");
      }
    }

    // Clean up any remaining stray empty labels or empty paragraphs
    html = html.replace(/<p>\s*(?:SUGGESTIONS|Suggestions|Suggested Follow-ups:?)\s*<\/p>/gi, "");
    html = html.replace(/<p>\s*<\/p>/gi, "");
    html = html.replace(/<hr>\s*💡?\s*<p>\s*SUGGESTIONS:?\s*<\/p>/gi, "");
    html = html.replace(/💡/g, "");

    return html;
  }
});

// Jump smoothly to notes section anchor
function jumpToNotesAnchor(anchorId) {
  const target = document.getElementById(anchorId) || document.querySelector('[name="' + anchorId + '"]');
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.style.outline = "2px solid #76ABAE";
    setTimeout(function() { target.style.outline = "none"; }, 2500);
  } else {
    window.location.hash = anchorId;
  }
}

// Quick prompt caller from suggestive question chips
function sendPrompt(text) {
  const input = document.getElementById("chat-query");
  if (input) {
    input.value = text;
    const form = document.getElementById("chat-form");
    if (form) form.dispatchEvent(new Event("submit"));
  }
}

// Ask about specific section
function askAboutSection(title, timeRef) {
  sendPrompt("Explain the concept of '" + title + "' discussed at " + timeRef + " in detail.");
}

// Ask about current video playback time
function askCurrentMoment() {
  let sec = 0;
  if (window.ytPlayer && typeof window.ytPlayer.getCurrentTime === "function") {
    sec = Math.floor(window.ytPlayer.getCurrentTime()) || 0;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const tsStr = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  sendPrompt("Explain the concept and code demonstrated by the instructor at timestamp [" + tsStr + "] in detail.");
}

// Clears chat messages back to welcoming state
function clearChatMessages() {
  const msgList = document.getElementById("chat-messages");
  const frameEl = document.getElementById("yt-player-frame");
  const videoId = frameEl ? (frameEl.dataset.videoId || "") : "";
  const storageKey = "4ubyu_chat_" + (videoId || "general");
  try {
    localStorage.removeItem(storageKey);
  } catch (e) {}
  if (msgList) {
    msgList.innerHTML = '<div class="chat-msg ai-msg">Hello! I am your study assistant. Ask me anything about the lecture notes, diagrams, or code.</div>';
  }
}
