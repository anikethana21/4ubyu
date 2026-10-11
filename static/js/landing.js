// 4 U By U — Modern Landing Page Controller with Phase 3 Human-in-the-Loop (HITL) Review Gate

document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key");
  const modelSelect = document.getElementById("model-select");
  const providerBadge = document.getElementById("key-provider-badge");
  const generateForm = document.getElementById("generate-form");
  const progressBox = document.getElementById("progress-container");
  const progressFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-step-text");
  const progressPct = document.getElementById("progress-pct");
  const btnGenerate = document.getElementById("btn-generate");

  // HITL Elements
  const hitlModal = document.getElementById("hitl-modal");
  const hitlThumb = document.getElementById("hitl-video-thumb");
  const hitlTitle = document.getElementById("hitl-video-title");
  const hitlChannel = document.getElementById("hitl-video-channel");
  const hitlDuration = document.getElementById("hitl-video-duration");
  const hitlCount = document.getElementById("hitl-video-count");
  const hitlContainer = document.getElementById("hitl-chapters-container");
  const hitlSelectAllCb = document.getElementById("hitl-select-all-cb");
  const hitlAddTopicBtn = document.getElementById("hitl-add-topic-btn");
  const hitlSelectedCount = document.getElementById("hitl-selected-count");
  const hitlCancelBtn = document.getElementById("hitl-cancel-btn");
  const hitlApproveBtn = document.getElementById("hitl-approve-btn");

  let currentInspection = null;

  // Dynamic Key Regex Detector
  const detectKey = (key) => {
    const k = (key || "").trim();
    if (!k) return null;
    if (/^gsk_[a-zA-Z0-9]{48,}$/.test(k)) {
      return {
        provider: "Groq",
        models: [
          { id: "openai/gpt-oss-120b", name: "Groq GPT-OSS 120B [100% FREE]" },
          { id: "openai/gpt-oss-20b", name: "Groq GPT-OSS 20B [100% FREE]" },
          { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B [100% FREE]" }
        ]
      };
    } else if (/^AIzaSy[a-zA-Z0-9_-]{33}$/.test(k)) {
      return {
        provider: "Google Gemini",
        models: [
          { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash [100% FREE TIER]" },
          { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash [100% FREE TIER]" },
          { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro [FREE TIER / RATE-LIMITED]" }
        ]
      };
    } else if (/^sk-ant-[a-zA-Z0-9_-]+$/.test(k)) {
      return {
        provider: "Anthropic Claude",
        models: [
          { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet [PAID CREDITS]" },
          { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku [PAID CREDITS]" }
        ]
      };
    } else if (/^sk-[a-zA-Z0-9]{48,}$/.test(k) || /^sk-proj-[a-zA-Z0-9_-]+$/.test(k)) {
      return {
        provider: "OpenAI",
        models: [
          { id: "gpt-4o-mini", name: "GPT-4o Mini [PAID CREDITS]" },
          { id: "gpt-4o", name: "GPT-4o [PAID CREDITS]" }
        ]
      };
    }
    return null;
  };

  const updateModelDropdown = () => {
    const key = apiKeyInput ? apiKeyInput.value : "";
    const detected = detectKey(key);

    if (detected) {
      if (providerBadge) {
        providerBadge.textContent = detected.provider;
        providerBadge.classList.remove("hidden");
      }
      if (modelSelect) {
        modelSelect.innerHTML = "";
        detected.models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id;
          opt.textContent = m.name;
          modelSelect.appendChild(opt);
        });
      }
    } else {
      if (providerBadge) providerBadge.classList.add("hidden");
      if (modelSelect) {
        modelSelect.innerHTML = `
          <option value="openai/gpt-oss-120b">Groq GPT-OSS 120B [100% FREE]</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash [100% FREE TIER]</option>
        `;
      }
    }
  };

  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", updateModelDropdown);
  }

  // Helper to update selection count in HITL modal
  const updateHitlCount = () => {
    if (!hitlContainer) return;
    const items = hitlContainer.querySelectorAll(".hitl-item");
    const active = hitlContainer.querySelectorAll(".hitl-item-cb:checked");
    if (hitlSelectedCount) {
      hitlSelectedCount.textContent = `${active.length} of ${items.length}`;
    }
    if (hitlSelectAllCb) {
      hitlSelectAllCb.checked = active.length === items.length && items.length > 0;
    }
  };

  // Render chapters in HITL Modal
  const renderHitlChapters = (chapters) => {
    if (!hitlContainer) return;
    hitlContainer.innerHTML = "";

    chapters.forEach((ch, idx) => {
      const item = document.createElement("div");
      item.className = "hitl-item";
      item.dataset.index = idx;
      item.dataset.startTime = ch.start_time || 0;
      item.dataset.endTime = ch.end_time || (ch.start_time || 0) + 300;

      item.innerHTML = `
        <input type="checkbox" class="hitl-item-cb" checked>
        <span class="hitl-item-idx">${idx + 1}</span>
        <span class="hitl-item-ts">${ch.timestamp_str || "00:00"}</span>
        <input type="text" class="hitl-item-input" value="${ch.title || `Chapter ${idx + 1}`}">
        <button type="button" class="hitl-item-del" title="Exclude topic">✕</button>
      `;

      const cb = item.querySelector(".hitl-item-cb");
      cb.addEventListener("change", () => {
        item.classList.toggle("excluded", !cb.checked);
        updateHitlCount();
      });

      const delBtn = item.querySelector(".hitl-item-del");
      delBtn.addEventListener("click", () => {
        cb.checked = !cb.checked;
        item.classList.toggle("excluded", !cb.checked);
        updateHitlCount();
      });

      hitlContainer.appendChild(item);
    });

    updateHitlCount();
  };

  // Select/Deselect All Checkbox
  if (hitlSelectAllCb) {
    hitlSelectAllCb.addEventListener("change", () => {
      const isChecked = hitlSelectAllCb.checked;
      const cbs = hitlContainer.querySelectorAll(".hitl-item-cb");
      cbs.forEach(cb => {
        cb.checked = isChecked;
        cb.closest(".hitl-item").classList.toggle("excluded", !isChecked);
      });
      updateHitlCount();
    });
  }

  // Add Custom Topic Button
  if (hitlAddTopicBtn) {
    hitlAddTopicBtn.addEventListener("click", () => {
      const items = hitlContainer.querySelectorAll(".hitl-item");
      const nextIdx = items.length + 1;
      const item = document.createElement("div");
      item.className = "hitl-item";
      item.dataset.index = items.length;
      item.dataset.startTime = 0;
      item.dataset.endTime = 600;

      item.innerHTML = `
        <input type="checkbox" class="hitl-item-cb" checked>
        <span class="hitl-item-idx">${nextIdx}</span>
        <span class="hitl-item-ts">+NEW</span>
        <input type="text" class="hitl-item-input" placeholder="Enter custom section title (e.g. Real-World Case Studies)" value="Custom Section ${nextIdx}">
        <button type="button" class="hitl-item-del" title="Remove">✕</button>
      `;

      const cb = item.querySelector(".hitl-item-cb");
      cb.addEventListener("change", () => {
        item.classList.toggle("excluded", !cb.checked);
        updateHitlCount();
      });

      item.querySelector(".hitl-item-del").addEventListener("click", () => {
        item.remove();
        updateHitlCount();
      });

      hitlContainer.appendChild(item);
      updateHitlCount();
      item.querySelector(".hitl-item-input").focus();
    });
  }

  // Cancel Button in HITL Modal
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
      if (btnText) btnText.textContent = "Analyzing Lecture & Extracting Syllabus...";
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

  // Step 2: Human Approves Syllabus -> Execute Multi-Agent Synthesis (Phases 4-8)
  if (hitlApproveBtn) {
    hitlApproveBtn.addEventListener("click", async () => {
      if (!currentInspection) return;

      // Extract only human-approved chapters with edited titles
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

      // Close HITL modal and show rich progress bar
      if (hitlModal) hitlModal.classList.add("hidden");
      if (progressBox) progressBox.classList.remove("hidden");

      const steps = [
        { pct: 15, text: "Phase 3: Syllabus approved! Initializing multi-agent swarm..." },
        { pct: 35, text: "Phase 4: Structuring sections from real lecture audio..." },
        { pct: 55, text: "Phase 5: Generating deep theory, code, and Mermaid flowcharts..." },
        { pct: 80, text: "Phase 6 & 7: Compiling tri-pane interactive workspace..." },
        { pct: 95, text: "Phase 8: Building local ChromaDB vector index..." }
      ];

      let stepIdx = 0;
      const timer = setInterval(() => {
        if (stepIdx < steps.length) {
          if (progressFill) progressFill.style.width = `${steps[stepIdx].pct}%`;
          if (progressPct) progressPct.textContent = `${steps[stepIdx].pct}%`;
          if (progressText) progressText.textContent = steps[stepIdx].text;
          stepIdx++;
        }
      }, 1800);

      try {
        const resp = await fetch("/api/pipeline/synthesize", {
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
        });

        clearInterval(timer);
        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.detail || "Synthesis failed.");
        }

        // Save handbook to client's IndexedDB
        if (window.LocalLibrary && data.video_id) {
          try {
            await window.LocalLibrary.saveHandbookLocally({
              id: data.video_id,
              title: data.title || "Interactive Study Handbook",
              channel: data.channel || "YouTube",
              duration: data.duration || "Course",
              thumbnail: `https://img.youtube.com/vi/${data.video_id}/maxresdefault.jpg`,
              chapters_count: data.chapters_count || approvedChapters.length,
              file_name: `notes_${data.video_id}.html`,
              workspace_url: data.workspace_url,
              color_palette: currentInspection.theme
            });
          } catch(e) {
            console.warn("Local DB save notice:", e);
          }
        }

        if (progressFill) progressFill.style.width = "100%";
        if (progressPct) progressPct.textContent = "100%";
        if (progressText) progressText.textContent = "Synthesis Complete! Launching workspace...";

        setTimeout(() => {
          window.location.href = data.workspace_url;
        }, 700);

      } catch (err) {
        clearInterval(timer);
        if (progressBox) progressBox.classList.add("hidden");
        if (btnGenerate) btnGenerate.disabled = false;
        const btnText = btnGenerate ? btnGenerate.querySelector(".btn-text") : null;
        if (btnText) btnText.textContent = "Generate Educational Handbook";
        alert(`Synthesis Error: ${err.message}`);
      }
    });
  }
});
