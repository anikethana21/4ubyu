// 4 U By U — Dual-Axis Resizing Engine (Splitters)

document.addEventListener("DOMContentLoaded", () => {
  const vResizer = document.getElementById("v-resizer");
  const hResizer = document.getElementById("h-resizer");
  const handbookPane = document.getElementById("handbook-pane");
  const videoPane = document.getElementById("video-pane");
  const workspace = document.getElementById("app-workspace");

  // Restore saved splits from localStorage if available
  const savedVSplit = localStorage.getItem("4u_v_split");
  const savedHSplit = localStorage.getItem("4u_h_split");
  if (savedVSplit) document.documentElement.style.setProperty("--left-pane-width", savedVSplit);
  if (savedHSplit) document.documentElement.style.setProperty("--video-pane-height", savedHSplit);

  // Helper to disable pointer events on iframes during drag
  const setIframeShield = (active) => {
    const iframes = document.querySelectorAll("iframe");
    iframes.forEach(f => {
      f.style.pointerEvents = active ? "none" : "auto";
    });
  };

  // 1. VERTICAL RESIZER (Left vs Right)
  if (vResizer) {
    let isVDragging = false;

    vResizer.addEventListener("pointerdown", (e) => {
      isVDragging = true;
      vResizer.setPointerCapture(e.pointerId);
      vResizer.classList.add("is-active");
      setIframeShield(true);
      document.body.style.cursor = "col-resize";
    });

    vResizer.addEventListener("pointermove", (e) => {
      if (!isVDragging) return;
      const totalWidth = workspace.clientWidth;
      const clientX = e.clientX;

      // Defensive Clamping Constraints (Never zero or invisible)
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

    // Double-click resets to default 62%
    vResizer.addEventListener("dblclick", () => {
      document.documentElement.style.setProperty("--left-pane-width", "62%");
      localStorage.setItem("4u_v_split", "62%");
    });
  }

  // 2. HORIZONTAL RESIZER (Top Video vs Bottom Chat)
  if (hResizer) {
    let isHDragging = false;
    const rightCol = document.getElementById("right-column");

    hResizer.addEventListener("pointerdown", (e) => {
      isHDragging = true;
      hResizer.setPointerCapture(e.pointerId);
      hResizer.classList.add("is-active");
      setIframeShield(true);
      document.body.style.cursor = "row-resize";
    });

    hResizer.addEventListener("pointermove", (e) => {
      if (!isHDragging) return;
      const colRect = rightCol.getBoundingClientRect();
      const relativeY = e.clientY - colRect.top;
      const totalHeight = colRect.height;

      // Defensive Clamping Constraints
      const minTopPx = 180;
      const maxTopPx = totalHeight - 160;

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

    // Double-click resets to default 45%
    hResizer.addEventListener("dblclick", () => {
      document.documentElement.style.setProperty("--video-pane-height", "45%");
      localStorage.setItem("4u_h_split", "45%");
    });
  }
});
