// 4 U By U - Dual Mode RAG Study Assistant Client
// Features:
// - Seamless Grounded vs Open Mode toggle
// - Full Markdown parsing (Tables, Lists, Bold, Headings)
// - MathJax LaTeX equation typesetting
// - Prism syntax-highlighted code cards with 1-click Copy button
// - Interactive clickable video timestamp seek pills
// - Auto-rendering of follow-up suggestion chips
// - Zero character encoding corruption & resilient videoId detection

window.currentChatMode = localStorage.getItem("4ubyu_chat_mode") || "grounded";

window.setChatMode = function(mode) {
  window.currentChatMode = mode;
  localStorage.setItem("4ubyu_chat_mode", mode);
  const groundedBtn = document.getElementById("mode-grounded-btn");
  const openBtn = document.getElementById("mode-open-btn");
  const chatInput = document.getElementById("chat-query");
  
  if (groundedBtn && openBtn) {
    if (mode === "grounded") {
      groundedBtn.classList.add("active");
      openBtn.classList.remove("active");
      if (chatInput) chatInput.placeholder = "Ask about lecture notes, formulas, or timestamps...";
    } else {
      openBtn.classList.add("active");
      groundedBtn.classList.remove("active");
      if (chatInput) chatInput.placeholder = "Ask open AI questions, frameworks, algorithms, or code...";
    }
  }
};

function getActiveVideoId() {
  if (window.COURSE_VIDEO_ID) return window.COURSE_VIDEO_ID;
  const meta = document.querySelector('meta[name="video-id"]');
  if (meta && meta.content) return meta.content;
  const frameEl = document.getElementById("yt-player-frame");
  if (frameEl && frameEl.dataset && frameEl.dataset.videoId) return frameEl.dataset.videoId;
  const m = window.location.pathname.match(/notes_([a-zA-Z0-9_-]+)\.html/);
  if (m) return m[1];
  return "";
}

// 1-Click Copy for Chat Code Blocks
window.copyChatCode = function(btn) {
  const card = btn.closest(".chat-code-card");
  if (!card) return;
  const codeEl = card.querySelector("code") || card.querySelector("pre");
  if (!codeEl) return;
  
  const text = codeEl.innerText || codeEl.textContent;
  navigator.clipboard.writeText(text).then(function() {
    const orig = btn.innerText;
    btn.innerText = "Copied!";
    btn.style.color = "#2dd4bf";
    btn.style.borderColor = "#2dd4bf";
    setTimeout(function() {
      btn.innerText = orig;
      btn.style.color = "";
      btn.style.borderColor = "";
    }, 2000);
  }).catch(function() {
    btn.innerText = "Error";
  });
};

document.addEventListener("DOMContentLoaded", function() {
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-query");
  const msgList = document.getElementById("chat-messages");

  if (!chatForm || !chatInput || !msgList) return;

  // Restore saved chat mode
  if (window.setChatMode) {
    window.setChatMode(window.currentChatMode || "grounded");
  }

  const videoId = getActiveVideoId();
  const storageKey = "4ubyu_chat_" + (videoId || "general");

  // Load saved chat history
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (saved && saved.length > 0) {
      saved.forEach(function(msg) {
        if (msg.role === "user") {
          appendUserMessage(msg.text);
        } else if (msg.role === "ai") {
          const aiEl = appendAiMessage(formatChatContent(msg.text));
          postProcessAiBubble(aiEl);
        }
      });
    }
  } catch (e) {
    console.warn("Could not load local chat history:", e);
  }

  function saveChatMessage(role, text) {
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

    const mode = window.currentChatMode || "grounded";
    const statusText = mode === "grounded" 
      ? "Searching lecture notes and formulating grounded answer..." 
      : "Consulting AI Engineering Tutor...";
    
    const aiBubble = appendAiMessage('<div class="chat-thinking"><span class="thinking-spinner"></span> ' + statusText + '</div>');

    try {
      const activeVid = getActiveVideoId();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: activeVid,
          question: query,
          mode: mode
        })
      });

      if (!response.ok) {
        throw new Error("Unable to contact study assistant (Status " + response.status + ").");
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
      postProcessAiBubble(aiBubble);

    } catch (err) {
      aiBubble.innerHTML = '<div class="chat-error-notice">Notice: ' + (err.message || "Failed to reach server") + '</div>';
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

  // Formats raw text/markdown into structured semantic HTML
  function formatChatContent(text) {
    if (!text) return "";

    // 1. Math Protection (preserve LaTeX equations before markdown transforms them)
    const mathMap = {};
    let safeText = text;

    safeText = safeText.replace(/\\\[([\s\S]*?)\\\]/g, function(match) {
      const k = "@@MATH_BLOCK_" + Object.keys(mathMap).length + "@@";
      mathMap[k] = match;
      return "\n\n" + k + "\n\n";
    });

    safeText = safeText.replace(/\\\(([\s\S]*?)\\\)/g, function(match) {
      const k = "@@MATH_INLINE_" + Object.keys(mathMap).length + "@@";
      mathMap[k] = match;
      return k;
    });

    // 2. Parse Markdown if available
    let html = "";
    if (window.marked && typeof window.marked.parse === "function") {
      try {
        html = window.marked.parse(safeText);
      } catch (e) {
        html = safeText.replace(/\n/g, "<br>");
      }
    } else {
      html = safeText.replace(/\n/g, "<br>");
    }

    // 3. Restore Protected Math
    Object.keys(mathMap).forEach(function(k) {
      if (k.includes("BLOCK")) {
        html = html.replace(k, '<div class="chat-math-block">' + mathMap[k] + '</div>');
      } else {
        html = html.replace(k, '<span class="chat-math-inline">' + mathMap[k] + '</span>');
      }
    });

    // 4. Transform Mode Badges into sleek pill tags
    html = html.replace(/<blockquote>\s*<p><strong>\[(Grounded[^\]]+)\]<\/strong><\/p>\s*<\/blockquote>/gi, function(match, t) {
      return '<div class="chat-mode-badge badge-grounded"><span class="badge-dot"></span> ' + t.replace(/•/g, "·") + '</div>';
    });
    html = html.replace(/<blockquote>\s*<p><strong>\[(Open Mode[^\]]+)\]<\/strong><\/p>\s*<\/blockquote>/gi, function(match, t) {
      return '<div class="chat-mode-badge badge-open"><span class="badge-dot"></span> ' + t.replace(/•/g, "·") + '</div>';
    });
    html = html.replace(/<blockquote>\s*<p><strong>\[(Video Timestamp[^\]]+)\]<\/strong><\/p>\s*<\/blockquote>/gi, function(match, t) {
      return '<div class="chat-mode-badge badge-grounded"><span class="badge-dot"></span> ' + t.replace(/•/g, "·") + '</div>';
    });

    // 5. Replace [TS MM:SS] or [MM:SS] with clickable seek buttons (avoid replacing inside code)
    html = html.replace(/\[(?:TS\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\]/gi, function(match, ts) {
      const parts = ts.split(":").map(Number);
      let totalSec = 0;
      if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else totalSec = parts[0] * 60 + parts[1];
      return '<button type="button" class="ts-pill-sm" onclick="if(window.seekVideo) seekVideo(' + totalSec + '); return false;">⏱️ ' + ts + '</button>';
    });

    // 6. Replace [Jump to Section #id] with smooth anchor links
    html = html.replace(/\[Jump to Section #([^\]]+)\]/gi, function(match, anchorId) {
      return '<a href="#" class="anchor-jump-pill" onclick="jumpToNotesAnchor(\'' + anchorId + '\'); return false;">Jump to #' + anchorId + '</a>';
    });

    // 7. Parse Follow-up Suggestion Chips
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

      const validChips = [];
      rawItems.forEach(function(item) {
        let clean = item.replace(/<[^>]+>/g, "").replace(/^[-\s*\[]+/, "").replace(/[\]\s*]+$/, "").trim();
        if (clean && clean.length > 2 && clean.length < 80) {
          validChips.push(clean);
        }
      });

      if (validChips.length > 0) {
        let chipsHtml = '<div class="reply-chips-container"><div class="reply-chips-label">Suggested Follow-ups</div><div class="reply-chips-wrap">';
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

    return html;
  }

  // Post-processing on completed AI messages (Code highlight wrapper + MathJax)
  function postProcessAiBubble(bubbleEl) {
    if (!bubbleEl) return;

    // Wrap <pre> in sleek code card with copy button
    bubbleEl.querySelectorAll("pre").forEach(function(preEl) {
      if (preEl.closest(".chat-code-card")) return;
      const codeEl = preEl.querySelector("code");
      
      let lang = "CODE";
      if (codeEl) {
        const cls = codeEl.className || "";
        const m = cls.match(/language-(\w+)/);
        if (m) lang = m[1].toUpperCase();
      }

      const wrapper = document.createElement("div");
      wrapper.className = "chat-code-card";
      wrapper.innerHTML = 
        '<div class="chat-code-header">' +
          '<span class="chat-code-lang">' + lang + '</span>' +
          '<button type="button" class="btn-copy-chat-code" onclick="copyChatCode(this)" title="Copy Code">Copy</button>' +
        '</div>';
      
      preEl.parentNode.insertBefore(wrapper, preEl);
      wrapper.appendChild(preEl);
    });

    // Syntax Highlighting
    if (window.Prism && typeof window.Prism.highlightAllUnder === "function") {
      try {
        window.Prism.highlightAllUnder(bubbleEl);
      } catch (e) {}
    }

    // MathJax Rendering
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      try {
        window.MathJax.typesetPromise([bubbleEl]).catch(function() {});
      } catch (e) {}
    }

    msgList.scrollTop = msgList.scrollHeight;
  }
});

// Jump smoothly to notes section anchor
function jumpToNotesAnchor(anchorId) {
  const target = document.getElementById(anchorId) || document.querySelector('[name="' + anchorId + '"]');
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.style.outline = "2px solid #38bdf8";
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
  sendPrompt("Explain the concept demonstrated by the instructor at timestamp [" + tsStr + "] in detail.");
}

// Clears chat messages back to welcoming state
function clearChatMessages() {
  const msgList = document.getElementById("chat-messages");
  const videoId = getActiveVideoId();
  const storageKey = "4ubyu_chat_" + (videoId || "general");
  try {
    localStorage.removeItem(storageKey);
  } catch (e) {}
  if (msgList) {
    msgList.innerHTML = '<div class="chat-msg ai-msg">Hello! I am your study assistant. Ask me anything about the lecture notes, formulas, diagrams, or code.</div>';
  }
}
