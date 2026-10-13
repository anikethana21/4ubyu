/**
 * 4 U By U - Interactive Educational Handbook Generator
 * Landing Page Orchestration & Translucent Multi-Agent Swarm Workplace
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements - Main Form
  const apiKeyInput = document.getElementById("api-key");
  const keyBadge = document.getElementById("key-provider-badge");
  const modelSelect = document.getElementById("model-select");
  const generateForm = document.getElementById("generate-form");
  const btnGenerate = document.getElementById("btn-generate");
  const progressBox = document.getElementById("progress-container");
  const progressFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-step-text");
  const progressPct = document.getElementById("progress-pct");

  // DOM Elements - Human-in-the-Loop Review Modal (Phase 3)
  const hitlModal = document.getElementById("hitl-modal");
  const hitlContainer = document.getElementById("hitl-chapters-container");
  const hitlSelectedCount = document.getElementById("hitl-selected-count");
  const hitlSelectAllCb = document.getElementById("hitl-select-all-cb");
  const hitlCancelBtn = document.getElementById("hitl-cancel-btn");
  const hitlApproveBtn = document.getElementById("hitl-approve-btn");
  const hitlAddTopicBtn = document.getElementById("hitl-add-topic-btn");

  const hitlThumb = document.getElementById("hitl-video-thumb");
  const hitlTitle = document.getElementById("hitl-video-title");
  const hitlChannel = document.getElementById("hitl-video-channel");
  const hitlDuration = document.getElementById("hitl-video-duration");
  const hitlCount = document.getElementById("hitl-video-count");

  // DOM Elements - Translucent Multi-Agent Swarm Workplace Modal (Phases 4-8)
  const workplaceModal = document.getElementById("workplace-modal");
  const workplaceTimer = document.getElementById("workplace-live-timer");
  const workplaceTitle = document.getElementById("workplace-title");
  const workplaceSubtitle = document.getElementById("workplace-subtitle");
  const workplaceModelBadge = document.getElementById("workplace-model-badge");
  const workplaceChapterCounter = document.getElementById("workplace-chapter-counter");
  const workplaceCurrentTask = document.getElementById("workplace-current-task");
  const workplacePctText = document.getElementById("workplace-pct-text");
  const workplaceProgressFill = document.getElementById("workplace-progress-fill");
  const workplaceTerminal = document.getElementById("workplace-terminal");
  const workplaceFooterStatus = document.getElementById("workplace-footer-status");

  // Agent Cards
  const agentCardCluster = document.getElementById("agent-card-cluster");
  const agentCardCode = document.getElementById("agent-card-code");
  const agentCardTheory = document.getElementById("agent-card-theory");
  const agentCardVisual = document.getElementById("agent-card-visual");
  const agentCardCompiler = document.getElementById("agent-card-compiler");

  const statusAgentCluster = document.getElementById("status-agent-cluster");
  const statusAgentCode = document.getElementById("status-agent-code");
  const statusAgentTheory = document.getElementById("status-agent-theory");
  const statusAgentVisual = document.getElementById("status-agent-visual");
  const statusAgentCompiler = document.getElementById("status-agent-compiler");

  // State cache
  let currentInspection = null;
  let timerInterval = null;
  let secondsElapsed = 0;

  // Helper: Format Seconds to MM:SS
  function formatSeconds(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // Helper: Get Model Friendly Label
  function getModelLabel(val) {
    if (val.includes("120b")) return "Groq 120B";
    if (val.includes("qwen")) return "Groq Qwen";
    if (val.includes("20b")) return "Groq 20B";
    if (val.includes("llama")) return "Groq LLaMA 3.3";
    if (val.includes("gemini-2.0")) return "Gemini 2.0 Flash";
    if (val.includes("gemini")) return "Gemini Pro";
    if (val.includes("4o-mini")) return "GPT-4o Mini";
    if (val.includes("4o")) return "GPT-4o";
    if (val.includes("claude")) return "Claude 3.5";
    return val;
  }

  // Dynamic API Key placeholder based on model
  if (modelSelect && apiKeyInput) {
    const updateKeyPlaceholder = () => {
      const val = modelSelect.value;
      if (val.startsWith("openai/gpt") || val.startsWith("qwen") || val.startsWith("llama")) {
        apiKeyInput.placeholder = "Paste Groq API key (gsk_...) [Leave blank for default 120B high-capacity tier]";
      } else if (val.startsWith("gemini")) {
        apiKeyInput.placeholder = "Paste Google Gemini API key (AIza...) [Leave blank for free tier]";
      } else if (val.startsWith("gpt-")) {
        apiKeyInput.placeholder = "Paste OpenAI API key (sk-...)";
      } else if (val.startsWith("claude")) {
        apiKeyInput.placeholder = "Paste Anthropic Claude API key (sk-ant-...)";
      }
    };
    modelSelect.addEventListener("change", updateKeyPlaceholder);
    updateKeyPlaceholder();
  }

  // Detect Key Provider dynamically on typing
  if (apiKeyInput && keyBadge) {
    apiKeyInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if (!val) {
        keyBadge.className = "provider-badge hidden";
        keyBadge.textContent = "";
        return;
      }
      keyBadge.classList.remove("hidden");
      if (val.startsWith("gsk_")) {
        keyBadge.textContent = "Groq Cloud (Sub-second)";
        keyBadge.className = "provider-badge provider-groq";
      } else if (val.startsWith("AIza")) {
        keyBadge.textContent = "Google Gemini (1M Context)";
        keyBadge.className = "provider-badge provider-gemini";
      } else if (val.startsWith("sk-ant-")) {
        keyBadge.textContent = "Anthropic Claude";
        keyBadge.className = "provider-badge provider-claude";
      } else if (val.startsWith("sk-")) {
        keyBadge.textContent = "OpenAI GPT-4o";
        keyBadge.className = "provider-badge provider-openai";
      } else {
        keyBadge.textContent = "Custom Key";
        keyBadge.className = "provider-badge";
      }
    });
  }

  // Terminal logging utility
  function logTerminal(role, msg, type = "system") {
    if (!workplaceTerminal) return;
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    line.textContent = `[${timeStr}] [${role}] ${msg}`;
    workplaceTerminal.appendChild(line);
    workplaceTerminal.scrollTop = workplaceTerminal.scrollHeight;
  }

  // Update Agent Status
  function setAgentStatus(card, statusElem, stateText, stateType) {
    if (!card || !statusElem) return;
    statusElem.textContent = stateText;
    card.classList.remove("active", "completed");
    if (stateType === "active") card.classList.add("active");
    if (stateType === "completed") card.classList.add("completed");
  }

  // Render Human-in-the-Loop Syllabus List
  function renderHitlChapters(chapters) {
    if (!hitlContainer) return;
    hitlContainer.innerHTML = "";

    if (!chapters || chapters.length === 0) {
      hitlContainer.innerHTML = `<div class="hitl-empty">No chapters detected. Click "+ Add Custom Topic" to create one.</div>`;
      updateSelectionSummary();
      return;
    }

    chapters.forEach((ch, idx) => {
      const item = document.createElement("div");
      item.className = "hitl-item";
      item.dataset.index = idx;
      item.dataset.startTime = ch.start_time || 0;
      item.dataset.endTime = ch.end_time || (ch.start_time + 300);

      item.innerHTML = `
        <input type="checkbox" class="hitl-item-cb" id="ch-cb-${idx}" checked>
        <span class="hitl-item-ts">${ch.timestamp_str || "00:00"}</span>
        <input type="text" class="hitl-item-input" value="${ch.title || `Chapter ${idx + 1}`}" placeholder="Chapter Title">
        <button type="button" class="hitl-item-del" title="Remove Topic">×</button>
      `;

      const cb = item.querySelector(".hitl-item-cb");
      cb.addEventListener("change", updateSelectionSummary);

      const delBtn = item.querySelector(".hitl-item-del");
      delBtn.addEventListener("click", () => {
        item.remove();
        updateSelectionSummary();
      });

      hitlContainer.appendChild(item);
    });

    updateSelectionSummary();
  }

  function updateSelectionSummary() {
    if (!hitlContainer || !hitlSelectedCount) return;
    const all = hitlContainer.querySelectorAll(".hitl-item");
    const checked = hitlContainer.querySelectorAll(".hitl-item-cb:checked");
    hitlSelectedCount.textContent = `${checked.length} of ${all.length}`;
    if (hitlSelectAllCb) {
      hitlSelectAllCb.checked = (all.length > 0 && checked.length === all.length);
    }
  }

  if (hitlSelectAllCb) {
    hitlSelectAllCb.addEventListener("change", (e) => {
      const cbs = hitlContainer.querySelectorAll(".hitl-item-cb");
      cbs.forEach(cb => cb.checked = e.target.checked);
      updateSelectionSummary();
    });
  }

  if (hitlAddTopicBtn) {
    hitlAddTopicBtn.addEventListener("click", () => {
      const idx = hitlContainer.querySelectorAll(".hitl-item").length;
      const item = document.createElement("div");
      item.className = "hitl-item";
      item.dataset.index = idx;
      item.dataset.startTime = idx * 300;
      item.dataset.endTime = (idx + 1) * 300;

      item.innerHTML = `
        <input type="checkbox" class="hitl-item-cb" id="ch-cb-${idx}" checked>
        <span class="hitl-item-ts">${formatSeconds(idx * 300)}</span>
        <input type="text" class="hitl-item-input" value="Custom Topic ${idx + 1}" placeholder="Chapter Title">
        <button type="button" class="hitl-item-del" title="Remove Topic">×</button>
      `;

      item.querySelector(".hitl-item-cb").addEventListener("change", updateSelectionSummary);
      item.querySelector(".hitl-item-del").addEventListener("click", () => {
        item.remove();
        updateSelectionSummary();
      });

      hitlContainer.appendChild(item);
      updateSelectionSummary();
    });
  }

  if (hitlCancelBtn) {
    hitlCancelBtn.addEventListener("click", () => {
      if (hitlModal) hitlModal.classList.add("hidden");
      if (btnGenerate) btnGenerate.disabled = false;
      const btnText = btnGenerate ? btnGenerate.querySelector(".btn-text") : null;
      if (btnText) btnText.textContent = "Generate Educational Handbook";
    });
  }

  // Step 1: Form Submit -> Trigger Inspection for Human-in-the-Loop Review
  if (generateForm) {
    generateForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const urlInput = document.getElementById("yt-url");
      const url = urlInput ? urlInput.value.trim() : "";
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";
      const model = modelSelect ? modelSelect.value : "openai/gpt-oss-120b";
      const theme = document.getElementById("theme-select") ? document.getElementById("theme-select").value : "dark_academic";
      const visual = document.getElementById("visual-pref") ? document.getElementById("visual-pref").value : "auto";
      const format = document.getElementById("format-select") ? document.getElementById("format-select").value : "html";
      const eraserKey = document.getElementById("eraser-key") ? document.getElementById("eraser-key").value.trim() : null;

      if (!url) {
        alert("Please enter a valid YouTube video URL.");
        return;
      }

      const btnText = btnGenerate ? btnGenerate.querySelector(".btn-text") : null;
      const btnSpinner = btnGenerate ? btnGenerate.querySelector(".btn-spinner") : null;

      if (btnGenerate) btnGenerate.disabled = true;
      if (btnText) btnText.textContent = "Inspecting Video & Extracting Syllabus...";
      if (btnSpinner) btnSpinner.classList.remove("hidden");

      try {
        const resp = await fetch("/api/pipeline/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtube_url: url,
            api_key: apiKey || null,
            model_name: model
          })
        });

        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.detail || "Video inspection failed.");
        }

        // Cache parameters for Phase 4-8 synthesis
        currentInspection = {
          url: url,
          apiKey: apiKey || null,
          model: model,
          theme: theme,
          visual: visual,
          format: format,
          eraserKey: eraserKey || null,
          video_id: data.video_id,
          metadata: data.metadata,
          chapters: data.chapters || []
        };

        // Populate HITL Modal with extracted video details
        const meta = data.metadata || {};
        if (hitlThumb) hitlThumb.src = meta.thumbnail || `https://img.youtube.com/vi/${data.video_id}/hqdefault.jpg`;
        if (hitlTitle) hitlTitle.textContent = meta.title || `Tutorial (${data.video_id})`;
        if (hitlChannel) hitlChannel.textContent = meta.channel || "YouTube Creator";
        if (hitlDuration) hitlDuration.textContent = `⏱ ${meta.duration_str || "00:00"}`;
        if (hitlCount) hitlCount.textContent = `📑 ${data.chapters.length} Detected Chapters`;

        renderHitlChapters(data.chapters);

        // Open the Human-in-the-Loop review modal
        if (hitlModal) hitlModal.classList.remove("hidden");

        if (btnText) btnText.textContent = "Awaiting Syllabus Approval...";
        if (btnSpinner) btnSpinner.classList.add("hidden");

      } catch (err) {
        if (btnGenerate) btnGenerate.disabled = false;
        if (btnText) btnText.textContent = "Generate Educational Handbook";
        if (btnSpinner) btnSpinner.classList.add("hidden");
        alert(`Inspection Error: ${err.message}`);
      }
    });
  }

  // Step 2: Human Approves Syllabus -> Activate Translucent Multi-Agent Swarm Workplace
  if (hitlApproveBtn) {
    hitlApproveBtn.addEventListener("click", async () => {
      if (!currentInspection) return;

      // Extract only human-approved chapters
      const items = hitlContainer.querySelectorAll(".hitl-item");
      const approvedChapters = [];

      items.forEach((item, idx) => {
        const cb = item.querySelector(".hitl-item-cb");
        if (cb && cb.checked) {
          const input = item.querySelector(".hitl-item-input");
          const ts = item.querySelector(".hitl-item-ts");
          approvedChapters.push({
            title: input ? input.value.trim() : `Chapter ${idx + 1}`,
            start_time: parseFloat(item.dataset.startTime || 0),
            end_time: parseFloat(item.dataset.endTime || 300),
            timestamp_str: ts ? ts.textContent.trim() : "00:00"
          });
        }
      });

      if (approvedChapters.length === 0) {
        alert("Please select at least 1 chapter or topic to synthesize.");
        return;
      }

      // Close HITL modal and display Translucent Swarm Workplace Modal
      if (hitlModal) hitlModal.classList.add("hidden");
      if (workplaceModal) workplaceModal.classList.remove("hidden");

      // Reset Workplace UI state
      secondsElapsed = 0;
      if (workplaceTimer) workplaceTimer.textContent = "00:00";
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        secondsElapsed++;
        if (workplaceTimer) workplaceTimer.textContent = formatSeconds(secondsElapsed);
      }, 1000);

      const totalChapters = approvedChapters.length;
      if (workplaceModelBadge) workplaceModelBadge.textContent = getModelLabel(currentInspection.model);
      if (workplaceChapterCounter) workplaceChapterCounter.textContent = `0 / ${totalChapters}`;
      if (workplaceTitle) workplaceTitle.textContent = currentInspection.metadata?.title || "Educational Handbook Synthesis";
      if (workplaceSubtitle) workplaceSubtitle.textContent = `Autonomous Multi-Agent Swarm processing ${totalChapters} chapters using ${getModelLabel(currentInspection.model)}...`;

      // Clear terminal logs
      if (workplaceTerminal) workplaceTerminal.innerHTML = "";
      logTerminal("SYSTEM", "Multi-Agent Swarm workplace activated.", "system");
      logTerminal("SYSTEM", `Target Video: ${currentInspection.video_id} | ${totalChapters} approved chapters.`, "system");
      logTerminal("SYSTEM", `Model Engine: ${currentInspection.model} (Direct HTTP Router)`, "system");

      // Initialize all agents to Standby
      setAgentStatus(agentCardCluster, statusAgentCluster, "STANDBY", "standby");
      setAgentStatus(agentCardCode, statusAgentCode, "STANDBY", "standby");
      setAgentStatus(agentCardTheory, statusAgentTheory, "STANDBY", "standby");
      setAgentStatus(agentCardVisual, statusAgentVisual, "STANDBY", "standby");
      setAgentStatus(agentCardCompiler, statusAgentCompiler, "STANDBY", "standby");

      // Launch simulated multi-agent step progression while the real backend executes
      let isSynthesisDone = false;
      let synthResultData = null;
      let synthError = null;

      // Start Backend Synthesis
      const synthesisPromise = fetch("/api/pipeline/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_url: currentInspection.url,
          video_id: currentInspection.video_id,
          approved_chapters: approvedChapters,
          api_key: currentInspection.apiKey,
          model_name: currentInspection.model,
          color_palette: currentInspection.theme,
          visual_preference: currentInspection.visual,
          output_format: currentInspection.format,
          eraser_api_key: currentInspection.eraserKey
        })
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Synthesis failed.");
        synthResultData = data;
        isSynthesisDone = true;
      }).catch((err) => {
        synthError = err;
        isSynthesisDone = true;
      });

      // Swarm Workplace Live Orchestration Runner
      async function runWorkplaceOrchestrator() {
        // Step 1: Ingestion & Threshold Clustering
        setAgentStatus(agentCardCluster, statusAgentCluster, "ACTIVE", "active");
        if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Clustering lecture transcript audio & thresholding code blocks...";
        if (workplaceProgressFill) workplaceProgressFill.style.width = "10%";
        if (workplacePctText) workplacePctText.textContent = "10%";
        logTerminal("Clustering Agent", `Applying chapter cluster threshold (score 8.0) across ${totalChapters} sections...`, "cluster");
        await new Promise(r => setTimeout(r, 1200));

        logTerminal("Clustering Agent", "Audio timestamps aligned with whisper/vtt subtitles.", "cluster");
        setAgentStatus(agentCardCluster, statusAgentCluster, "COMPLETED", "completed");

        // Iterate through approved chapters with live multi-agent updates
        for (let chIdx = 0; chIdx < totalChapters; chIdx++) {
          if (isSynthesisDone) break;
          const ch = approvedChapters[chIdx];
          const chNum = chIdx + 1;
          const basePct = 10 + Math.floor((chIdx / totalChapters) * 75);

          if (workplaceChapterCounter) workplaceChapterCounter.textContent = `${chNum} / ${totalChapters}`;
          if (workplaceProgressFill) workplaceProgressFill.style.width = `${basePct}%`;
          if (workplacePctText) workplacePctText.textContent = `${basePct}%`;

          // Code Cleaning Agent Active
          setAgentStatus(agentCardCode, statusAgentCode, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Code Cleaning Agent scanning transcript & matching GitHub repo...`;
          logTerminal("Code Cleaning Agent", `Chapter ${chNum} ("${ch.title}"): Extracting fragmented transcript tokens...`, "code");
          await new Promise(r => setTimeout(r, 800));

          logTerminal("Code Cleaning Agent", `Searching linked GitHub repositories for verified code files matching "${ch.title}"...`, "code");
          await new Promise(r => setTimeout(r, 900));

          logTerminal("Code Cleaning Agent", `Stitching, cleaning syntax, and generating production commented code block for Chapter ${chNum}.`, "code");
          setAgentStatus(agentCardCode, statusAgentCode, "COMPLETED", "completed");

          // Deep Technical Theory Agent Active
          setAgentStatus(agentCardTheory, statusAgentTheory, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Synthesizing multi-section deep theory & mathematical foundations...`;
          logTerminal("Theory Agent", `Chapter ${chNum}: Formulating I. Foundations & Math, II. Dataflow Walkthrough, III. Production Guidelines.`, "theory");
          await new Promise(r => setTimeout(r, 1200));
          setAgentStatus(agentCardTheory, statusAgentTheory, "COMPLETED", "completed");

          // Visual Architect Agent Active
          setAgentStatus(agentCardVisual, statusAgentVisual, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Visual Architect evaluating diagram necessity...`;
          if (ch.title.toLowerCase().includes("intro") || ch.title.toLowerCase().includes("roadmap")) {
            logTerminal("Visual Architect", `Chapter ${chNum}: Conceptual topic - suppressed redundant diagram to avoid visual clutter.`, "visual");
          } else {
            logTerminal("Visual Architect", `Chapter ${chNum}: Generated dedicated architectural SVG/Mermaid workflow diagram.`, "visual");
          }
          await new Promise(r => setTimeout(r, 700));
          setAgentStatus(agentCardVisual, statusAgentVisual, "COMPLETED", "completed");
        }

        // Wait for backend promise to finish if not yet complete
        if (!isSynthesisDone) {
          setAgentStatus(agentCardCompiler, statusAgentCompiler, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Tri-Pane Compiler Agent packaging workspace, interactive quizzes & vector index...";
          if (workplaceProgressFill) workplaceProgressFill.style.width = "90%";
          if (workplacePctText) workplacePctText.textContent = "90%";
          logTerminal("Compiler Agent", "Linking interactive notes with video timestamp player & RAG search engine...", "compiler");
          
          await synthesisPromise;
        }

        clearInterval(timerInterval);

        // Handle Result
        if (synthError) {
          logTerminal("ERROR", `Synthesis Pipeline Failed: ${synthError.message}`, "system");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Synthesis encountered an error.";
          if (workplaceFooterStatus) workplaceFooterStatus.textContent = "Pipeline failed. Check terminal stream above.";
          alert(`Synthesis Error: ${synthError.message}`);
          return;
        }

        // Synthesis Succeeded
        setAgentStatus(agentCardCluster, statusAgentCluster, "COMPLETED", "completed");
        setAgentStatus(agentCardCode, statusAgentCode, "COMPLETED", "completed");
        setAgentStatus(agentCardTheory, statusAgentTheory, "COMPLETED", "completed");
        setAgentStatus(agentCardVisual, statusAgentVisual, "COMPLETED", "completed");
        setAgentStatus(agentCardCompiler, statusAgentCompiler, "COMPLETED", "completed");

        if (workplaceChapterCounter) workplaceChapterCounter.textContent = `${totalChapters} / ${totalChapters}`;
        if (workplaceProgressFill) workplaceProgressFill.style.width = "100%";
        if (workplacePctText) workplacePctText.textContent = "100%";
        if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Interactive Educational Handbook Synthesized Successfully!";
        logTerminal("SUCCESS", `Complete handbook written to ${synthResultData.workspace_url}`, "success");
        logTerminal("SUCCESS", "Instant launch engaging in 1.5 seconds...", "success");

        // Save handbook to client's IndexedDB
        if (window.LocalLibrary && synthResultData.video_id) {
          try {
            await window.LocalLibrary.saveHandbookLocally({
              id: synthResultData.video_id,
              title: synthResultData.title || "Interactive Study Handbook",
              channel: synthResultData.channel || "YouTube",
              duration: synthResultData.duration || "Course",
              thumbnail: `https://img.youtube.com/vi/${synthResultData.video_id}/maxresdefault.jpg`,
              chapters_count: synthResultData.chapters_count || approvedChapters.length,
              file_name: `notes_${synthResultData.video_id}.html`,
              workspace_url: synthResultData.workspace_url,
              color_palette: currentInspection.theme
            });
          } catch(e) {
            console.warn("Local DB save notice:", e);
          }
        }

        setTimeout(() => {
          window.location.href = synthResultData.workspace_url;
        }, 1500);
      }

      runWorkplaceOrchestrator();
    });
  }
});
