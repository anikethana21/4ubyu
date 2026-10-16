// 4 U By U ? Responsive Workspace, Dual-Axis Resizing & Foldable Companion Engine
// Supports:
// 1. Mobile responsive view switcher (Notes, Video, AI Chat)
// 2. Desktop Fullscreen Focus Mode (completely collapsible sidebar)
// 3. Dedicated Chat Minimization & Expand
// 4. Foldable Table of Contents
// 5. Dual-axis resizer splitters for desktop view

document.addEventListener("DOMContentLoaded", () => {
  const vResizer = document.getElementById("v-resizer");
  const hResizer = document.getElementById("h-resizer");
  const handbookPane = document.getElementById("handbook-pane");
  const videoPane = document.getElementById("video-pane");
  const chatPane = document.getElementById("chat-pane");
  const rightCol = document.getElementById("right-column");
  const workspace = document.getElementById("app-workspace");
  const tocNav = document.getElementById("handbook-toc");

  // =========================================================================
  // 1. RESTORE PERSISTED STATES
  // =========================================================================
  const isMobile = window.innerWidth <= 960;

  if (isMobile) {
    // On mobile, default to Notes view
    const savedMobileView = localStorage.getItem("4u_mobile_view") || "notes";
    setMobileView(savedMobileView);
  } else {
    // Restore saved splitters
    const savedVSplit = localStorage.getItem("4u_v_split");
    const savedHSplit = localStorage.getItem("4u_h_split");
    if (savedVSplit) document.documentElement.style.setProperty("--left-pane-width", savedVSplit);
    if (savedHSplit) document.documentElement.style.setProperty("--video-pane-height", savedHSplit);

    // Restore desktop sidebar collapsed state
    const savedSidebarCollapsed = localStorage.getItem("4u_sidebar_collapsed") === "true";
    if (savedSidebarCollapsed && workspace) {
      workspace.classList.add("sidebar-collapsed");
      updateSidebarBtn(true);
    }

    // Restore chat minimized state
    const savedChatMinimized = localStorage.getItem("4u_chat_minimized") === "true";
    if (savedChatMinimized && chatPane) {
      chatPane.classList.add("chat-minimized");
      updateChatMinimizeBtn(true);
    }
  }

  // Restore TOC folded state
  const savedTocFolded = localStorage.getItem("4u_toc_folded") === "true";
  if (savedTocFolded && tocNav) {
    tocNav.classList.add("toc-folded");
    const hint = document.getElementById("toc-fold-hint");
    if (hint) hint.innerText = "(Click to expand)";
  }

  // =========================================================================
  // 2. SIDEBAR COLLAPSE / FOCUS MODE CONTROLLER
  // =========================================================================
  window.toggleSidebar = function() {
    if (!workspace) return;
    const isNowCollapsed = workspace.classList.toggle("sidebar-collapsed");
    localStorage.setItem("4u_sidebar_collapsed", isNowCollapsed ? "true" : "false");
    updateSidebarBtn(isNowCollapsed);
  };

  function updateSidebarBtn(isCollapsed) {
    const textEl = document.getElementById("sidebar-toggle-text");
    const btn = document.getElementById("btn-toggle-sidebar");
    if (textEl) {
      textEl.innerText = isCollapsed ? "Show Companion" : "Focus Mode";
    }
    if (btn) {
      btn.title = isCollapsed ? "Show Video & Chat Companion" : "Focus on Notes (Hide Sidebar)";
    }
  }

  // =========================================================================
  // 3. CHAT ASSISTANT MINIMIZE / EXPAND CONTROLLER
  // =========================================================================
  window.toggleChatMinimize = function(fromBrandClick = false) {
    if (!chatPane) return;

    if (fromBrandClick && !chatPane.classList.contains("chat-minimized")) {
      // Don't minimize if just clicking brand title in expanded mode
      return;
    }

    const isNowMinimized = chatPane.classList.toggle("chat-minimized");
    localStorage.setItem("4u_chat_minimized", isNowMinimized ? "true" : "false");
    updateChatMinimizeBtn(isNowMinimized);
  };

  function updateChatMinimizeBtn(isMinimized) {
    const btn = document.getElementById("btn-minimize-chat");
    if (btn) {
      btn.innerHTML = isMinimized
        ? `<svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`
        : `<svg class="minimize-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
      btn.title = isMinimized ? "Expand Chat Assistant" : "Minimize Chat Assistant";
    }
  }

  // =========================================================================
  // 4. TABLE OF CONTENTS FOLD CONTROLLER
  // =========================================================================
  window.toggleTocFold = function() {
    if (!tocNav) return;
    const isNowFolded = tocNav.classList.toggle("toc-folded");
    const hint = document.getElementById("toc-fold-hint");
    if (hint) {
      hint.innerText = isNowFolded ? "(Click to expand)" : "(Click to fold)";
    }
    localStorage.setItem("4u_toc_folded", isNowFolded ? "true" : "false");
  };

  // =========================================================================
  // 5. MOBILE VIEW SWITCHER CONTROLLER (NOTES / VIDEO / CHAT)
  // =========================================================================
  window.setMobileView = function(view) {
    if (!workspace) return;
    workspace.setAttribute("data-mobile-view", view);
    localStorage.setItem("4u_mobile_view", view);

    // Update Tab Buttons Active State
    const tabs = ["notes", "video", "chat"];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      if (btn) {
        if (t === view) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    });

    // Mobile scroll reset to top when switching views
    if (view === "notes" && handbookPane) {
      handbookPane.scrollTop = 0;
    }

    // If switching to chat on mobile, ensure it's not minimized
    if (view === "chat" && chatPane) {
      chatPane.classList.remove("chat-minimized");
      updateChatMinimizeBtn(false);
    }
  };

  // =========================================================================
  // 6. KEYBOARD SHORTCUTS (<kbd>Alt+F</kbd> Focus, <kbd>Alt+C</kbd> Chat)
  // =========================================================================
  document.addEventListener("keydown", (e) => {
    // Avoid triggering when user is typing in search or chat input
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

    if (e.altKey && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      window.toggleSidebar();
    } else if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      window.toggleChatMinimize();
    }
  });

  // Window resize handler: auto-adjust if crossing 960px breakpoint
  window.addEventListener("resize", () => {
    const mobileNow = window.innerWidth <= 960;
    if (mobileNow) {
      if (!workspace.getAttribute("data-mobile-view")) {
        setMobileView("notes");
      }
    }
  });

  // Helper to disable pointer events on iframes during drag
  const setIframeShield = (active) => {
    const iframes = document.querySelectorAll("iframe");
    iframes.forEach(f => {
      f.style.pointerEvents = active ? "none" : "auto";
    });
  };

  // =========================================================================
  // 7. DUAL-AXIS DESKTOP RESIZER SPLITTERS
  // =========================================================================
  if (vResizer) {
    let isVDragging = false;

    vResizer.addEventListener("pointerdown", (e) => {
      if (window.innerWidth <= 960) return;
      isVDragging = true;
      vResizer.setPointerCapture(e.pointerId);
      vResizer.classList.add("is-active");
      setIframeShield(true);
      document.body.style.cursor = "col-resize";
    });

    vResizer.addEventListener("pointermove", (e) => {
      if (!isVDragging || window.innerWidth <= 960) return;
      const totalWidth = workspace.clientWidth;
      const clientX = e.clientX;

      const minLeftPx = 340;
      const maxLeftPx = totalWidth - 320;

      const clampedX = Math.max(minLeftPx, Math.min(clientX, maxLeftPx));
      const newPct = (clampedX / totalWidth) * 100;
      const valStr = `${newPct.toFixed(2)}%`;

      document.documentElement.style.setProperty("--left-pane-width", valStr);
      localStorage.setItem("4u_v_split", valStr);
    });

    const stopVDrag = (e) => {
      if (!isVDragging) return;
      isVDragging = false;
      vResizer.classList.remove("is-active");
      setIframeShield(false);
      document.body.style.cursor = "default";
    };

    vResizer.addEventListener("pointerup", stopVDrag);
    vResizer.addEventListener("pointercancel", stopVDrag);

    vResizer.addEventListener("dblclick", () => {
      document.documentElement.style.setProperty("--left-pane-width", "62%");
      localStorage.setItem("4u_v_split", "62%");
    });
  }

  if (hResizer) {
    let isHDragging = false;

    hResizer.addEventListener("pointerdown", (e) => {
      if (window.innerWidth <= 960) return;
      isHDragging = true;
      hResizer.setPointerCapture(e.pointerId);
      hResizer.classList.add("is-active");
      setIframeShield(true);
      document.body.style.cursor = "row-resize";
    });

    hResizer.addEventListener("pointermove", (e) => {
      if (!isHDragging || window.innerWidth <= 960) return;
      const colRect = rightCol.getBoundingClientRect();
      const relativeY = e.clientY - colRect.top;
      const totalHeight = colRect.height;

      const minTopPx = 180;
      const maxTopPx = totalHeight - 140;

      const clampedY = Math.max(minTopPx, Math.min(relativeY, maxTopPx));
      const newPct = (clampedY / totalHeight) * 100;
      const valStr = `${newPct.toFixed(2)}%`;

      document.documentElement.style.setProperty("--video-pane-height", valStr);
      localStorage.setItem("4u_h_split", valStr);
    });

    const stopHDrag = (e) => {
      if (!isHDragging) return;
      isHDragging = false;
      hResizer.classList.remove("is-active");
      setIframeShield(false);
      document.body.style.cursor = "default";
    };

    hResizer.addEventListener("pointerup", stopHDrag);
    hResizer.addEventListener("pointercancel", stopHDrag);

    hResizer.addEventListener("dblclick", () => {
      document.documentElement.style.setProperty("--video-pane-height", "45%");
      localStorage.setItem("4u_h_split", "45%");
    });
  }
});
