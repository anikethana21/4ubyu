// 4 U By U — Landing Page Controller

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
          <option value="openai/gpt-oss-120b">Groq Groq GPT-OSS 120B [100% FREE]</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash [100% FREE TIER]</option>
        `;
      }
    }
  };

  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", updateModelDropdown);
  }

  // Form Submission
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

      if (btnGenerate) btnGenerate.disabled = true;
      if (progressBox) progressBox.classList.remove("hidden");

      const steps = [
        { pct: 15, text: "Phase 1: Ingesting video metadata and subtitles..." },
        { pct: 35, text: "Phase 2: Running parallel branches (Desc, Labels, Search)..." },
        { pct: 50, text: "Phase 3 & 4: HITL verification and outline synthesis..." },
        { pct: 75, text: "Phase 5: Generating multi-agent chapters with visuals..." },
        { pct: 90, text: "Phase 6 & 7: Compiling tri-pane interactive workspace..." }
      ];

      let stepIdx = 0;
      const timer = setInterval(() => {
        if (stepIdx < steps.length) {
          if (progressFill) progressFill.style.width = `${steps[stepIdx].pct}%`;
          if (progressPct) progressPct.textContent = `${steps[stepIdx].pct}%`;
          if (progressText) progressText.textContent = steps[stepIdx].text;
          stepIdx++;
        }
      }, 1500);

      try {
        const resp = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtube_url: url,
            api_key: apiKey || null,
            model_name: model,
            color_palette: theme,
            visual_preference: visual,
            output_format: format,
            eraser_api_key: eraserKey || null
          })
        });

        clearInterval(timer);
        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.detail || "Generation failed.");
        }

        // Auto-save handbook metadata to user's local PC storage (IndexedDB)
        if (window.LocalLibrary && data.video_id) {
          try {
            await window.LocalLibrary.saveHandbookLocally({
              id: data.video_id,
              title: data.title || "Interactive Study Handbook",
              channel: data.channel || "YouTube",
              duration: data.duration || "Course",
              thumbnail: `https://img.youtube.com/vi/${data.video_id}/maxresdefault.jpg`,
              chapters_count: data.chapters_count || 1,
              file_name: `notes_${data.video_id}.html`,
              workspace_url: data.workspace_url,
              color_palette: theme
            });
          } catch(e) {
            console.warn("Local DB save notice:", e);
          }
        }

        if (progressFill) progressFill.style.width = "100%";
        if (progressPct) progressPct.textContent = "100%";
        if (progressText) progressText.textContent = "Complete! Launching workspace...";

        setTimeout(() => {
          window.location.href = data.workspace_url;
        }, 800);

      } catch (err) {
        clearInterval(timer);
        if (btnGenerate) btnGenerate.disabled = false;
        alert(`Error: ${err.message}`);
        if (progressBox) progressBox.classList.add("hidden");
      }
    });
  }
});

// Delete handbook from local library
async function deleteHandbook(videoId) {
  if (!confirm("Are you sure you want to delete these study notes?")) return;
  try {
    if (window.LocalLibrary) {
      await window.LocalLibrary.deleteLocalHandbook(videoId);
    }
    const res = await fetch(`/api/library/${videoId}`, { method: "DELETE" });
    const card = document.getElementById(`card-${videoId}`);
    if (card) card.remove();
  } catch (e) {
    console.warn("Deletion error:", e);
    const card = document.getElementById(`card-${videoId}`);
    if (card) card.remove();
  }
}
