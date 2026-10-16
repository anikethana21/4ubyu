// 4 U By U — Responsive Workspace, Dual-Axis Resizing & Foldable Companion Engine
// Supports:
// 1. Mobile responsive view switcher (Notes, Video, AI Chat) with immediate touch response
// 2. Desktop Fullscreen Focus Mode (completely collapsible sidebar)
// 3. Dedicated Chat Minimization & Expand
// 4. Foldable Table of Contents
// 5. Dual-axis resizer splitters for desktop view

(function() {
  // Global View Functions declared immediately so inline HTML onclicks never fail
  window.setMobileView = function(view) {
    const workspace = document.getElementById("app-workspace");
    const handbookPane = document.getElementById("handbook-pane");
    const chatPane = document.getElementById("chat-pane");

    if (workspace) {
      workspace.setAttribute("data-mobile-view", view);
    }
    try {
      localStorage.setItem("4u_mobile_view", view);
    } catch (e) {}

    // Update Tab Buttons Active State
    const tabs = ["notes", "video", "chat"];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      if (btn) {
        if (t === view) {
          btn.classList.add("active");
          btn.setAttribute("aria-selected", "true");
        } else {
          btn.classList.remove("active");
          btn.setAttribute("aria-selected", "false");
        }
      }
    });

    // Mobile scroll reset to top when switching to notes view
    if (view === "notes") {
      if (handbookPane) handbookPane.scrollTop = 0;
      window.scrollTo(0, 0);
    }

    // If switching to chat on mobile, ensure it is not minimized
    if (view === "chat" && chatPane) {
      chatPane.classList.remove("chat-minimized");
      if (typeof window.updateChatMinimizeBtn === "function") {
        window.updateChatMinimizeBtn(false);
      }
    }
  };

  window.toggleSidebar = function() {
    const workspace = document.getElementById("app-workspace");
    if (!workspace) return;
    const isNowCollapsed = workspace.classList.toggle("sidebar-collapsed");
    try {
      localStorage.setItem("4u_sidebar_collapsed", isNowCollapsed ? "true" : "false");
    } catch (e) {}
    if (typeof window.updateSidebarBtn === "function") {
      window.updateSidebarBtn(isNowCollapsed);
    }
  };

  window.updateSidebarBtn = function(isCollapsed) {
    const textEl = document.getElementById("sidebar-toggle-text");
    const btn = document.getElementById("btn-toggle-sidebar");
    if (textEl) {
      textEl.innerText = isCollapsed ? "Show Companion" : "Focus Mode";
    }
    if (btn) {
      btn.title = isCollapsed ? "Show Video & Chat Companion" : "Focus on Notes (Hide Sidebar)";
    }
  };

  window.toggleChatMinimize = function(fromBrandClick) {
    const chatPane = document.getElementById("chat-pane");
    if (!chatPane) return;

    if (fromBrandClick && !chatPane.classList.contains("chat-minimized")) {
      return;
    }

    const isNowMinimized = chatPane.classList.toggle("chat-minimized");
    try {
      localStorage.setItem("4u_chat_minimized", isNowMinimized ? "true" : "false");
    } catch (e) {}
    if (typeof window.updateChatMinimizeBtn === "function") {
      window.updateChatMinimizeBtn(isNowMinimized);
    }
  };

  window.updateChatMinimizeBtn = function(isMinimized) {
    const btn = document.getElementById("btn-minimize-chat");
    if (btn) {
      btn.innerHTML = isMinimized
        ? `<svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`
        : `<svg class="minimize-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
      btn.title = isMinimized ? "Expand Chat Assistant" : "Minimize Chat Assistant";
    }
  };

  window.toggleTocFold = function() {
    const tocNav = document.getElementById("handbook-toc");
    if (!tocNav) return;
    const isNowFolded = tocNav.classList.toggle("toc-folded");
    const hint = document.getElementById("toc-fold-hint");
    if (hint) {
      hint.innerText = isNowFolded ? "(Click to expand)" : "(Click to fold)";
    }
    try {
      localStorage.setItem("4u_toc_folded", isNowFolded ? "true" : "false");
    } catch (e) {}
  };

  function initWorkspace() {
    const vResizer = document.getElementById("v-resizer");
    const hResizer = document.getElementById("h-resizer");
    const handbookPane = document.getElementById("handbook-pane");
    const chatPane = document.getElementById("chat-pane");
    const rightCol = document.getElementById("right-column");
    const workspace = document.getElementById("app-workspace");
    const tocNav = document.getElementById("handbook-toc");

    // Attach direct click and pointer listeners to mobile tabs for immediate touch response
    ["notes", "video", "chat"].forEach(function(view) {
      const btn = document.getElementById(`tab-btn-${view}`);
      if (btn) {
        btn.addEventListener("click", function(e) {
          e.preventDefault();
          window.setMobileView(view);
        });
        btn.addEventListener("pointerdown", function(e) {
          window.setMobileView(view);
        });
      }
    });

    const isMobile = window.innerWidth <= 960;

    if (isMobile) {
      // Always initialize with notes view on mobile load so study content is immediately visible & scrollable
      window.setMobileView("notes");
    } else {
      const savedVSplit = localStorage.getItem("4u_v_split");
      const savedHSplit = localStorage.getItem("4u_h_split");
      if (savedVSplit) document.documentElement.style.setProperty("--left-pane-width", savedVSplit);
      if (savedHSplit) document.documentElement.style.setProperty("--video-pane-height", savedHSplit);

      const savedSidebarCollapsed = localStorage.getItem("4u_sidebar_collapsed") === "true";
      if (savedSidebarCollapsed && workspace) {
        workspace.classList.add("sidebar-collapsed");
        window.updateSidebarBtn(true);
      }

      const savedChatMinimized = localStorage.getItem("4u_chat_minimized") === "true";
      if (savedChatMinimized && chatPane) {
        chatPane.classList.add("chat-minimized");
        window.updateChatMinimizeBtn(true);
      }
    }

    const savedTocFolded = localStorage.getItem("4u_toc_folded") === "true";
    if (savedTocFolded && tocNav) {
      tocNav.classList.add("toc-folded");
      const hint = document.getElementById("toc-fold-hint");
      if (hint) hint.innerText = "(Click to expand)";
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        window.toggleSidebar();
      } else if (e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        window.toggleChatMinimize(false);
      }
    });

    window.addEventListener("resize", () => {
      const mobileNow = window.innerWidth <= 960;
      if (mobileNow) {
        if (!workspace.getAttribute("data-mobile-view")) {
          window.setMobileView("notes");
        }
      }
    });

    const setIframeShield = (active) => {
      const iframes = document.querySelectorAll("iframe");
      iframes.forEach(f => {
        f.style.pointerEvents = active ? "none" : "auto";
      });
    };

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
  }

  
    // Desktop Wheel Scroll Delegation & Focus Support
    const hp = document.getElementById("handbook-pane");
    if (hp && !hp.hasAttribute("tabindex")) {
      hp.setAttribute("tabindex", "0");
      hp.style.outline = "none";
    }

    window.addEventListener("wheel", function(e) {
      if (window.innerWidth <= 960) return;
      const handbookPane = document.getElementById("handbook-pane");
      if (!handbookPane) return;
      const chatMessages = document.getElementById("chat-messages");
      if (chatMessages && (e.target === chatMessages || chatMessages.contains(e.target))) {
        return;
      }
      if (e.target.closest && e.target.closest("pre, code, textarea, input, .search-suggestions-dropdown")) {
        return;
      }
      if (handbookPane.contains(e.target) || e.target === handbookPane) {
        return;
      }
      handbookPane.scrollTop += e.deltaY;
    }, { passive: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWorkspace);
  } else {
    initWorkspace();
  }
})();
