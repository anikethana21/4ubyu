/**
 * 4 U By U - Interactive Educational Handbook Generator
 * Landing Page Orchestration, Authentication, Encrypted Vault & Multi-Agent Swarm Workplace
 */

document.addEventListener("DOMContentLoaded", () => {
  // ---------------------------------------------------------------------------
  // STATE MANAGEMENT
  // ---------------------------------------------------------------------------
  let currentUser = null;
  let userSettings = {
    default_model: "openai/gpt-oss-120b",
    preferred_theme: "dark_academic",
    has_groq_key: false,
    has_gemini_key: false,
    has_eraser_key: false
  };
  let userWorkspaces = [];
  let currentInspection = null;
  let timerInterval = null;
  let secondsElapsed = 0;

  // ---------------------------------------------------------------------------
  // DOM REFERENCES
  // ---------------------------------------------------------------------------
  const authGuestBar = document.getElementById("auth-guest-bar");
  const authUserBar = document.getElementById("auth-user-bar");
  const userEmailBadge = document.getElementById("user-email-badge");
  const btnOpenLogin = document.getElementById("btn-open-login");
  const btnOpenRegister = document.getElementById("btn-open-register");
  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnLogout = document.getElementById("btn-logout");

  const generateForm = document.getElementById("generate-form");
  const ytUrlInput = document.getElementById("yt-url");
  const btnPasteUrl = document.getElementById("btn-paste-url");
  const btnGenerate = document.getElementById("btn-generate");
  const heroVaultText = document.getElementById("hero-vault-text");
  const heroChangeSettingsLink = document.getElementById("hero-change-settings-link");
  const progressBox = document.getElementById("progress-container");
  const progressFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-step-text");
  const progressPct = document.getElementById("progress-pct");

  const handbookGrid = document.getElementById("handbook-grid");
  const totalWorkspacesBadge = document.getElementById("total-workspaces-badge");
  const guestPromptBanner = document.getElementById("guest-prompt-banner");

  const authModal = document.getElementById("auth-modal");
  const btnCloseAuthModal = document.getElementById("btn-close-auth-modal");
  const authModalTitle = document.getElementById("auth-modal-title");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const authForm = document.getElementById("auth-form");
  const authEmailInput = document.getElementById("auth-email");
  const authPasswordInput = document.getElementById("auth-password");
  const groupConfirmPassword = document.getElementById("group-confirm-password");
  const authConfirmPasswordInput = document.getElementById("auth-confirm-password");
  const btnSubmitAuth = document.getElementById("btn-submit-auth");
  const btnAuthText = document.getElementById("btn-auth-text");
  const btnAuthSpinner = document.getElementById("btn-auth-spinner");
  const authErrorBox = document.getElementById("auth-error-box");
  const authSuccessBox = document.getElementById("auth-success-box");
  let authMode = "login";

  const settingsModal = document.getElementById("settings-modal");
  const btnCloseSettingsModal = document.getElementById("btn-close-settings-modal");
  const btnCancelSettings = document.getElementById("btn-cancel-settings");
  const settingsForm = document.getElementById("settings-form");
  const settingsModelSelect = document.getElementById("settings-model-select");
  const settingsThemeSelect = document.getElementById("settings-theme-select");
  const settingsGroqKey = document.getElementById("settings-groq-key");
  const settingsGeminiKey = document.getElementById("settings-gemini-key");
  const settingsEraserKey = document.getElementById("settings-eraser-key");
  const badgeGroqStatus = document.getElementById("badge-groq-status");
  const badgeGeminiStatus = document.getElementById("badge-gemini-status");
  const badgeEraserStatus = document.getElementById("badge-eraser-status");
  const settingsFeedbackBox = document.getElementById("settings-feedback-box");

  function formatSeconds(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function getModelLabel(val) {
    if (!val) return "Groq 120B";
    if (val.includes("120b")) return "Groq 120B";
    if (val.includes("20b")) return "Groq 20B";
    if (val.includes("qwen")) return "Groq Qwen 27B";
    if (val.includes("gemini-2.0")) return "Gemini 2.0 Flash";
    if (val.includes("gemini-1.5")) return "Gemini 1.5 Flash";
    if (val.includes(":free")) return "OpenRouter Free";
    return val;
  }

  function updateHeroVaultLabel() {
    if (currentUser) {
      const modelName = getModelLabel(userSettings.default_model);
      const themeName = userSettings.preferred_theme ? userSettings.preferred_theme.replace("_", " ").toUpperCase() : "DARK ACADEMIC";
      heroVaultText.textContent = `Model: ${modelName} • Theme: ${themeName} • Vault Active`;
    } else {
      heroVaultText.textContent = "Free Tier: Groq 120B • Dark Academic";
    }
  }

  if (btnPasteUrl && ytUrlInput) {
    btnPasteUrl.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && (text.includes("youtube.com") || text.includes("youtu.be"))) {
          ytUrlInput.value = text.trim();
          ytUrlInput.focus();
        } else if (text) {
          ytUrlInput.value = text.trim();
        }
      } catch (err) {
        ytUrlInput.focus();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & SESSION HANDLING
  // ---------------------------------------------------------------------------
  async function checkAuthStatus() {
    try {
      const resp = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (resp.ok) {
        currentUser = await resp.json();
        renderAuthenticatedUI();
        await loadUserSettings();
        await loadUserWorkspaces();
      } else {
        currentUser = null;
        renderGuestUI();
      }
    } catch (e) {
      currentUser = null;
      renderGuestUI();
    }
  }

  function renderAuthenticatedUI() {
    if (authGuestBar) authGuestBar.classList.add("hidden");
    if (authUserBar) authUserBar.classList.remove("hidden");
    if (userEmailBadge) userEmailBadge.textContent = currentUser.email;
    if (guestPromptBanner) guestPromptBanner.classList.add("hidden");
    updateHeroVaultLabel();

    const tooltipUser = document.getElementById("tooltip-user-email");
    if (tooltipUser) tooltipUser.textContent = currentUser.email;

    const dialogEmail = document.getElementById("dialog-user-email");
    if (dialogEmail) dialogEmail.textContent = currentUser.email;

    const dialogAvatar = document.getElementById("dialog-user-avatar");
    if (dialogAvatar) {
      dialogAvatar.textContent = (currentUser.email[0] || "U").toUpperCase();
    }

    const dialogStatus = document.getElementById("dialog-account-tier");
    if (dialogStatus) dialogStatus.textContent = "Personal Vault • Authenticated";

    const dialogActions = document.getElementById("dialog-auth-actions");
    if (dialogActions) {
      dialogActions.innerHTML = `
        <button type="button" id="btn-dialog-logout" class="btn-dialog-logout" title="Sign Out of Account">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          <span>Sign Out</span>
        </button>
      `;
      const btnDialogLogout = document.getElementById("btn-dialog-logout");
      if (btnDialogLogout) {
        btnDialogLogout.addEventListener("click", async () => {
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch (e) {}
          currentUser = null;
          renderGuestUI();
        });
      }
    }
  }

  function renderGuestUI() {
    if (authUserBar) authUserBar.classList.add("hidden");
    if (authGuestBar) authGuestBar.classList.remove("hidden");
    if (guestPromptBanner) guestPromptBanner.classList.remove("hidden");
    updateHeroVaultLabel();
    loadGuestWorkspaces();

    const tooltipUser = document.getElementById("tooltip-user-email");
    if (tooltipUser) tooltipUser.textContent = "Sign in to view";

    const dialogEmail = document.getElementById("dialog-user-email");
    if (dialogEmail) dialogEmail.textContent = "Guest Session (Unsaved)";

    const dialogAvatar = document.getElementById("dialog-user-avatar");
    if (dialogAvatar) dialogAvatar.textContent = "G";

    const dialogStatus = document.getElementById("dialog-account-tier");
    if (dialogStatus) dialogStatus.textContent = "Local Session • Sign in to save";

    const dialogActions = document.getElementById("dialog-auth-actions");
    if (dialogActions) {
      dialogActions.innerHTML = `
        <button type="button" id="btn-dialog-login" class="btn-dialog-login" title="Sign In or Register">
          <span>Sign In / Register</span>
        </button>
      `;
      const btnDialogLogin = document.getElementById("btn-dialog-login");
      if (btnDialogLogin) {
        btnDialogLogin.addEventListener("click", () => {
          closeSettingsModal();
          openAuthModal("login");
        });
      }
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    authErrorBox.classList.add("hidden");
    authSuccessBox.classList.add("hidden");
    if (mode === "login") {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      authModalTitle.textContent = "Sign In to 4 U By U";
      btnAuthText.textContent = "Sign In";
      groupConfirmPassword.classList.add("hidden");
      authConfirmPasswordInput.removeAttribute("required");
    } else {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      authModalTitle.textContent = "Create Free 4 U By U Account";
      btnAuthText.textContent = "Create Account";
      groupConfirmPassword.classList.remove("hidden");
      authConfirmPasswordInput.setAttribute("required", "required");
    }
  }

  if (tabLogin) tabLogin.addEventListener("click", () => setAuthMode("login"));
  if (tabRegister) tabRegister.addEventListener("click", () => setAuthMode("register"));

  function openAuthModal(mode = "login") {
    setAuthMode(mode);
    authModal.classList.remove("hidden");
    authEmailInput.focus();
  }

  function closeAuthModal() {
    authModal.classList.add("hidden");
    authForm.reset();
    authErrorBox.classList.add("hidden");
    authSuccessBox.classList.add("hidden");
  }

  if (btnOpenLogin) btnOpenLogin.addEventListener("click", () => openAuthModal("login"));
  if (btnOpenRegister) btnOpenRegister.addEventListener("click", () => openAuthModal("register"));
  if (btnCloseAuthModal) btnCloseAuthModal.addEventListener("click", closeAuthModal);

  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      authErrorBox.classList.add("hidden");
      authSuccessBox.classList.add("hidden");

      const email = authEmailInput.value.trim();
      const password = authPasswordInput.value;

      if (authMode === "register") {
        const confirmPw = authConfirmPasswordInput.value;
        if (password !== confirmPw) {
          authErrorBox.textContent = "Passwords do not match.";
          authErrorBox.classList.remove("hidden");
          return;
        }
      }

      btnSubmitAuth.disabled = true;
      btnAuthSpinner.classList.remove("hidden");

      try {
        const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.detail || "Authentication request failed.");
        }

        currentUser = data.user;
        authSuccessBox.textContent = authMode === "login" ? "Signed in successfully!" : "Account created successfully!";
        authSuccessBox.classList.remove("hidden");

        setTimeout(() => {
          closeAuthModal();
          renderAuthenticatedUI();
          loadUserSettings();
          loadUserWorkspaces();
        }, 500);

      } catch (err) {
        authErrorBox.textContent = err.message;
        authErrorBox.classList.remove("hidden");
      } finally {
        btnSubmitAuth.disabled = false;
        btnAuthSpinner.classList.add("hidden");
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch (e) {}
      currentUser = null;
      renderGuestUI();
    });
  }

  // ---------------------------------------------------------------------------
  // SETTINGS VAULT HANDLING
  // ---------------------------------------------------------------------------
  async function loadUserSettings() {
    if (!currentUser) return;
    try {
      const resp = await fetch("/api/user/settings");
      if (resp.ok) {
        userSettings = await resp.json();
        updateSettingsUI();
        updateHeroVaultLabel();
      }
    } catch (e) {}
  }

  function updateSettingsUI() {
    if (settingsModelSelect && userSettings.default_model) {
      settingsModelSelect.value = userSettings.default_model;
    }
    if (settingsThemeSelect && userSettings.preferred_theme) {
      settingsThemeSelect.value = userSettings.preferred_theme;
    }

    if (badgeGroqStatus) {
      if (userSettings.has_groq_key) {
        badgeGroqStatus.textContent = `Configured (${userSettings.groq_key_preview})`;
        badgeGroqStatus.className = "key-status-pill configured";
      } else {
        badgeGroqStatus.textContent = "Not Set (Uses Built-in)";
        badgeGroqStatus.className = "key-status-pill unconfigured";
      }
    }

    if (badgeGeminiStatus) {
      if (userSettings.has_gemini_key) {
        badgeGeminiStatus.textContent = `Configured (${userSettings.gemini_key_preview})`;
        badgeGeminiStatus.className = "key-status-pill configured";
      } else {
        badgeGeminiStatus.textContent = "Not Set";
        badgeGeminiStatus.className = "key-status-pill unconfigured";
      }
    }

    if (badgeEraserStatus) {
      if (userSettings.has_eraser_key) {
        badgeEraserStatus.textContent = `Configured (${userSettings.eraser_key_preview})`;
        badgeEraserStatus.className = "key-status-pill configured";
      } else {
        badgeEraserStatus.textContent = "Optional";
        badgeEraserStatus.className = "key-status-pill unconfigured";
      }
    }
  }

  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;

  function openSettingsModal() {
    settingsFeedbackBox.classList.add("hidden");
    settingsModal.classList.remove("hidden");
    updateSettingsUI();
    if (currentUser) {
      renderAuthenticatedUI();
    } else {
      renderGuestUI();
    }
  }

  function closeSettingsModal() {
    settingsModal.classList.add("hidden");
    settingsForm.reset();
  }

  if (btnOpenSettings) btnOpenSettings.addEventListener("click", openSettingsModal);
  const btnAnimatedSettings = document.getElementById("btn-animated-settings");
  if (btnAnimatedSettings) {
    btnAnimatedSettings.addEventListener("click", () => {
      openSettingsModal();
    });
  }

  if (heroChangeSettingsLink) {
    heroChangeSettingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  }
  if (btnCloseSettingsModal) btnCloseSettingsModal.addEventListener("click", closeSettingsModal);
  if (btnCancelSettings) btnCancelSettings.addEventListener("click", closeSettingsModal);

  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const model = settingsModelSelect.value;
      const theme = settingsThemeSelect.value;
      const groqKey = settingsGroqKey.value.trim() || undefined;
      const geminiKey = settingsGeminiKey.value.trim() || undefined;
      const eraserKey = settingsEraserKey.value.trim() || undefined;

      try {
        const resp = await fetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            default_model: model,
            preferred_theme: theme,
            groq_api_key: groqKey,
            gemini_api_key: geminiKey,
            eraser_api_key: eraserKey
          })
        });
        const data = await resp.json();
        if (resp.ok) {
          userSettings = data.settings;
          updateSettingsUI();
          updateHeroVaultLabel();
          settingsFeedbackBox.textContent = "Settings saved & keys encrypted successfully in Supabase vault!";
          settingsFeedbackBox.classList.remove("hidden");
          setTimeout(() => {
            closeSettingsModal();
          }, 900);
        } else {
          alert(`Error saving settings: ${data.detail || "Server error"}`);
        }
      } catch (err) {
        alert(`Error saving settings: ${err.message}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // WORKSPACES DASHBOARD
  // ---------------------------------------------------------------------------
  async function loadUserWorkspaces() {
    if (!currentUser) return;
    try {
      const resp = await fetch("/api/workspaces");
      if (resp.ok) {
        const data = await resp.json();
        userWorkspaces = data.workspaces || [];
        renderWorkspaces(userWorkspaces);
      }
    } catch (e) {}
  }

  function loadGuestWorkspaces() {
    totalWorkspacesBadge.textContent = "0 Workspaces";
    handbookGrid.innerHTML = `
      <div class="empty-library" style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
        <div class="empty-icon" style="font-size: 2.5rem; margin-bottom: 0.75rem;">🔒</div>
        <h3 style="color: #f8fafc; font-size: 1.25rem; margin-bottom: 0.5rem;">Private Workspaces Locked</h3>
        <p style="color: #94a3b8; max-width: 480px; margin: 0 auto 1.5rem;">
          To ensure strict data privacy, study handbooks are partitioned and visible only to the account that generated them.
        </p>
        <button class="btn-primary" style="padding: 0.7rem 1.5rem;" onclick="document.getElementById('btn-open-login').click()">
          Sign In to Access Your Workspaces
        </button>
      </div>
    `;
  }

  function renderWorkspaces(workspaces) {
    totalWorkspacesBadge.textContent = `${workspaces.length} Private Workspaces`;
    if (!workspaces || workspaces.length === 0) {
      handbookGrid.innerHTML = `
        <div class="empty-library" style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
          <div class="empty-icon" style="font-size: 2.5rem; margin-bottom: 0.75rem;">📚</div>
          <h3 style="color: #f8fafc; font-size: 1.25rem; margin-bottom: 0.5rem;">No Workspaces Created Yet</h3>
          <p style="color: #94a3b8; max-width: 480px; margin: 0 auto 1.5rem;">
            Paste any YouTube tutorial URL above to synthesize your first private interactive study handbook.
          </p>
        </div>
      `;
      return;
    }

    handbookGrid.innerHTML = workspaces.map(ws => `
      <div class="handbook-card" id="card-${ws.id}">
        <div class="card-thumb-wrap">
          <img src="https://img.youtube.com/vi/${ws.video_id}/maxresdefault.jpg" alt="${ws.video_title}" class="card-thumb" onerror="this.src='https://placehold.co/600x400/0a140f/10b981?text=4+U+By+U'">
          <span class="card-duration">${ws.duration || "00:00"}</span>
        </div>
        <div class="card-content">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.4rem;">
            <span class="workspace-badge-private">🔒 Private Vault</span>
          </div>
          <h3 class="card-title">${ws.video_title}</h3>
          <div class="card-meta">
            <span>${ws.channel_name || "YouTube"}</span> •
            <span>${ws.chapter_count || 1} Chapters</span>
          </div>
          <div class="card-actions">
            <a href="${ws.view_url}" target="_blank" class="btn-card-open">Open Workspace</a>
            <button class="btn-card-del" onclick="window.deleteWorkspace('${ws.id}')">Delete</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  window.deleteWorkspace = async function(workspaceId) {
    if (!confirm("Are you sure you want to delete this private workspace? This action cannot be undone.")) return;
    try {
      const resp = await fetch(`/api/workspaces/${workspaceId}`, { method: "DELETE" });
      if (resp.ok) {
        const card = document.getElementById(`card-${workspaceId}`);
        if (card) {
          card.style.opacity = "0";
          card.style.transform = "scale(0.95)";
          setTimeout(() => {
            card.remove();
            userWorkspaces = userWorkspaces.filter(w => w.id !== workspaceId);
            renderWorkspaces(userWorkspaces);
          }, 250);
        }
      } else {
        alert("Failed to delete workspace.");
      }
    } catch (e) {
      alert(`Error deleting workspace: ${e.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // GENERATION PIPELINE ORCHESTRATION
  // ---------------------------------------------------------------------------
  const hitlModal = document.getElementById("hitl-modal");
  const hitlContainer = document.getElementById("hitl-chapters-container");
  const hitlSelectedCount = document.getElementById("hitl-selected-count");
  const hitlSelectAllCb = document.getElementById("hitl-select-all-cb");
  const hitlCancelBtn = document.getElementById("hitl-cancel-btn");
  const hitlApproveBtn = document.getElementById("hitl-approve-btn");
  const hitlThumb = document.getElementById("hitl-video-thumb");
  const hitlTitle = document.getElementById("hitl-video-title");
  const hitlChannel = document.getElementById("hitl-video-channel");
  const hitlDuration = document.getElementById("hitl-video-duration");
  const hitlCount = document.getElementById("hitl-video-count");
  const hitlTitleWarning = document.getElementById("hitl-title-warning");

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

  if (generateForm) {
    generateForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = ytUrlInput.value.trim();
      if (!url) return;

      btnGenerate.disabled = true;
      btnGenerate.querySelector(".btn-spinner").classList.remove("hidden");
      btnGenerate.querySelector(".btn-text").textContent = "Ingesting Video...";
      progressBox.classList.remove("hidden");
      progressFill.style.width = "25%";
      progressPct.textContent = "25%";
      progressText.textContent = "Parsing YouTube metadata and downloading synchronized transcript...";

      try {
        const resp = await fetch("/api/pipeline/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtube_url: url,
            api_key: userSettings.groq_api_key || userSettings.gemini_api_key || null,
            model_name: userSettings.default_model || null
          })
        });

        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.detail || "Video inspection failed.");
        }

        currentInspection = data;
        openHitlModal(data);

      } catch (err) {
        alert(`Pipeline Ingestion Error: ${err.message}`);
      } finally {
        btnGenerate.disabled = false;
        btnGenerate.querySelector(".btn-spinner").classList.add("hidden");
        btnGenerate.querySelector(".btn-text").textContent = "Generate Educational Handbook";
        progressBox.classList.add("hidden");
      }
    });
  }

  function openHitlModal(data, ingestId) {
    const meta = data.metadata || {};
    const chapters = data.suggested_chapters || data.chapters || [];
    currentInspection = {
      // Prefer the server-resolved URL: on the userscript hand-off the input box
      // is empty because the URL came from the extension, not the user.
      url: data.url || (ytUrlInput ? ytUrlInput.value.trim() : ""),
      video_id: data.video_id,
      metadata: meta,
      chapters: chapters,
      suggested_chapters: chapters,
      title: meta.title || data.title || "Untitled Video",
      ingest_id: ingestId || null
    };

    if (hitlThumb) hitlThumb.src = meta.thumbnail || data.thumbnail || `https://img.youtube.com/vi/${data.video_id}/maxresdefault.jpg`;
    if (hitlTitle) hitlTitle.textContent = meta.title || data.title || "Untitled Video";
    if (hitlChannel) hitlChannel.textContent = meta.channel || data.channel || "YouTube";
    if (hitlDuration) hitlDuration.textContent = meta.duration_str || data.duration || "00:00";
    if (hitlCount) hitlCount.textContent = `${chapters.length} Topics Extracted`;

    // Say so when titles are generic. Showing placeholder names with no
    // explanation reads as a broken feature rather than a missing key.
    if (hitlTitleWarning) {
      const titleWarning = data.title_warning || "";
      hitlTitleWarning.textContent = titleWarning;
      hitlTitleWarning.classList.toggle("hidden", !titleWarning);
    }

    renderHitlChapters(chapters);
    if (hitlModal) hitlModal.classList.remove("hidden");
  }

  /**
   * Chapter titles are model output derived from a video's captions, i.e.
   * attacker-influenced text. They get interpolated into HTML below, so they
   * must be escaped or a crafted title could break out of the attribute.
   */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderHitlChapters(chapters) {
    hitlContainer.innerHTML = chapters.map((ch, idx) => `
      <div class="hitl-chapter-row" id="hitl-row-${idx}">
        <input type="checkbox" class="hitl-chapter-cb" data-idx="${idx}" checked>
        <span class="hitl-chapter-num">${idx + 1}</span>
        <span class="hitl-timestamp-pill">${escapeHtml(ch.timestamp_str || "00:00")}</span>
        <input type="text" class="hitl-topic-input" data-idx="${idx}" value="${escapeHtml(ch.title)}">
      </div>
    `).join("");

    updateHitlSelectedCount();

    hitlContainer.querySelectorAll(".hitl-chapter-cb").forEach(cb => {
      cb.addEventListener("change", updateHitlSelectedCount);
    });
  }

  function updateHitlSelectedCount() {
    const total = hitlContainer.querySelectorAll(".hitl-chapter-cb").length;
    const selected = hitlContainer.querySelectorAll(".hitl-chapter-cb:checked").length;
    hitlSelectedCount.textContent = `${selected} of ${total}`;
    hitlApproveBtn.disabled = selected === 0;
  }

  if (hitlSelectAllCb) {
    hitlSelectAllCb.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      hitlContainer.querySelectorAll(".hitl-chapter-cb").forEach(cb => {
        cb.checked = isChecked;
      });
      updateHitlSelectedCount();
    });
  }

  if (hitlCancelBtn) {
    hitlCancelBtn.addEventListener("click", () => {
      hitlModal.classList.add("hidden");
    });
  }

  function logTerminal(agent, message, type = "info") {
    if (!workplaceTerminal) return;
    const line = document.createElement("div");
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-agent">[${agent}]</span> ${message}`;
    workplaceTerminal.appendChild(line);
    workplaceTerminal.scrollTop = workplaceTerminal.scrollHeight;
  }

  function setAgentStatus(cardEl, statusEl, text, statusClass) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = `agent-status ${statusClass}`;
    }
    if (cardEl) {
      cardEl.classList.remove("active", "completed");
      if (statusClass === "active") cardEl.classList.add("active");
      if (statusClass === "completed") cardEl.classList.add("completed");
    }
  }

  if (hitlApproveBtn) {
    hitlApproveBtn.addEventListener("click", async () => {
      const rows = hitlContainer.querySelectorAll(".hitl-chapter-row");
      const approvedChapters = [];

      rows.forEach(row => {
        const cb = row.querySelector(".hitl-chapter-cb");
        if (cb && cb.checked) {
          const idx = parseInt(cb.dataset.idx);
          const titleInput = row.querySelector(".hitl-topic-input");
          const chaps = currentInspection.suggested_chapters || currentInspection.chapters || [];
          const original = chaps[idx] || {};
          const startSec = original.start_time ?? original.start_seconds ?? 0;
          const endSec = original.end_time ?? original.end_seconds ?? 0;
          approvedChapters.push({
            title: titleInput ? titleInput.value.trim() : original.title,
            // Send both spellings. The pipeline's contract is start_time/end_time;
            // sending only start_seconds used to zero every approved chapter.
            start_time: startSec,
            end_time: endSec,
            start_seconds: Math.round(startSec),
            end_seconds: Math.round(endSec),
            timestamp_str: original.timestamp_str || "00:00"
          });
        }
      });

      if (approvedChapters.length === 0) {
        alert("Please approve at least one chapter.");
        return;
      }

      hitlModal.classList.add("hidden");
      workplaceModal.classList.remove("hidden");

      workplaceTitle.textContent = currentInspection.title || "Synthesizing Interactive Educational Handbook";
      workplaceModelBadge.textContent = getModelLabel(userSettings.default_model);
      const totalChapters = approvedChapters.length;
      workplaceChapterCounter.textContent = `0 / ${totalChapters}`;
      workplaceTerminal.innerHTML = "";

      secondsElapsed = 0;
      workplaceTimer.textContent = "00:00";
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        secondsElapsed++;
        workplaceTimer.textContent = formatSeconds(secondsElapsed);
      }, 1000);

      logTerminal("SYSTEM", "Multi-Agent Swarm Workplace activated.", "system");
      logTerminal("SYSTEM", `User: ${currentUser ? currentUser.email : "Guest Session (Free Tier)"}`, "system");
      logTerminal("SYSTEM", `Selected Engine: ${userSettings.default_model}`, "system");

      let isSynthesisDone = false;
      let synthResultData = null;
      let synthError = null;

      const synthesisPromise = fetch("/api/pipeline/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_url: currentInspection.url,
          video_id: currentInspection.video_id,
          approved_chapters: approvedChapters,
          // Keeps synthesis on the same captured transcript, so YouTube is never
          // re-fetched (that is what the bot gate blocks on a cloud host).
          ingest_id: currentInspection.ingest_id || null,
          model_name: userSettings.default_model,
          color_palette: userSettings.preferred_theme || "dark_academic"
        })
      })
      .then(async resp => {
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || "Synthesis failed.");
        synthResultData = data;
        isSynthesisDone = true;
      })
      .catch(err => {
        synthError = err;
        isSynthesisDone = true;
      });

      try {
        setAgentStatus(agentCardCluster, statusAgentCluster, "ACTIVE", "active");
        if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Clustering Agent aligning transcripts and timestamps...";
        logTerminal("Clustering Agent", `Applying chapter cluster threshold across ${totalChapters} sections...`, "cluster");
        await new Promise(r => setTimeout(r, 1000));
        setAgentStatus(agentCardCluster, statusAgentCluster, "COMPLETED", "completed");

        for (let chIdx = 0; chIdx < totalChapters; chIdx++) {
          if (isSynthesisDone) break;
          const ch = approvedChapters[chIdx];
          const chNum = chIdx + 1;
          const basePct = 10 + Math.floor((chIdx / totalChapters) * 75);

          if (workplaceChapterCounter) workplaceChapterCounter.textContent = `${chNum} / ${totalChapters}`;
          if (workplaceProgressFill) workplaceProgressFill.style.width = `${basePct}%`;
          if (workplacePctText) workplacePctText.textContent = `${basePct}%`;

          setAgentStatus(agentCardCode, statusAgentCode, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Code Cleaning Agent scanning transcript...`;
          logTerminal("Code Agent", `Chapter ${chNum} ("${ch.title}"): Cleaning syntax and extracting code...`, "code");
          await new Promise(r => setTimeout(r, 700));
          setAgentStatus(agentCardCode, statusAgentCode, "COMPLETED", "completed");

          setAgentStatus(agentCardTheory, statusAgentTheory, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Synthesizing deep theory & mathematics...`;
          logTerminal("Theory Agent", `Chapter ${chNum}: Deep theory formulation complete.`, "theory");
          await new Promise(r => setTimeout(r, 800));
          setAgentStatus(agentCardTheory, statusAgentTheory, "COMPLETED", "completed");

          setAgentStatus(agentCardVisual, statusAgentVisual, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = `[Chapter ${chNum}/${totalChapters}] Visual Architect evaluating diagrams...`;
          logTerminal("Visual Architect", `Chapter ${chNum}: Generated dedicated architectural diagrams.`, "visual");
          await new Promise(r => setTimeout(r, 600));
          setAgentStatus(agentCardVisual, statusAgentVisual, "COMPLETED", "completed");
        }

        if (!isSynthesisDone) {
          setAgentStatus(agentCardCompiler, statusAgentCompiler, "ACTIVE", "active");
          if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Tri-Pane Compiler Agent packaging private workspace...";
          if (workplaceProgressFill) workplaceProgressFill.style.width = "90%";
          if (workplacePctText) workplacePctText.textContent = "90%";
          await synthesisPromise;
        }

        clearInterval(timerInterval);

        if (synthError) {
          logTerminal("ERROR", `Pipeline Error: ${synthError.message}`, "system");
          alert(`Synthesis Error: ${synthError.message}`);
          return;
        }

        setAgentStatus(agentCardCluster, statusAgentCluster, "COMPLETED", "completed");
        setAgentStatus(agentCardCode, statusAgentCode, "COMPLETED", "completed");
        setAgentStatus(agentCardTheory, statusAgentTheory, "COMPLETED", "completed");
        setAgentStatus(agentCardVisual, statusAgentVisual, "COMPLETED", "completed");
        setAgentStatus(agentCardCompiler, statusAgentCompiler, "COMPLETED", "completed");

        if (workplaceChapterCounter) workplaceChapterCounter.textContent = `${totalChapters} / ${totalChapters}`;
        if (workplaceProgressFill) workplaceProgressFill.style.width = "100%";
        if (workplacePctText) workplacePctText.textContent = "100%";
        if (workplaceCurrentTask) workplaceCurrentTask.textContent = "Interactive Educational Handbook Synthesized Successfully!";

        logTerminal("SUCCESS", `Complete workspace ready at ${synthResultData.workspace_url}`, "success");
        logTerminal("SUCCESS", "Launching workspace...", "success");

        if (currentUser) {
          loadUserWorkspaces();
        }

        setTimeout(() => {
          window.location.href = synthResultData.workspace_url;
        }, 1200);

      } catch (err) {
        clearInterval(timerInterval);
        alert(`Synthesis Swarm Error: ${err.message}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // BROWSER-USCRIPT HAND-OFF  (/?ingest=<id>)
  // ---------------------------------------------------------------------------
  // The userscript captures the transcript on YouTube (the user's own
  // residential IP, where YouTube is not bot-gating) and redirects here with an
  // ingest id. We pick it up immediately instead of asking for a URL.
  async function handleIngestHandoff() {
    // The server stamps the id into the page (see the "/" route), so the
    // hand-off survives even if the query string has already been rewritten.
    let ingestId = "";
    try {
      ingestId = window.__FUBYU_INGEST_ID__ || "";
    } catch (err) { /* no server bootstrap: fall back to the query string */ }

    if (!ingestId) {
      try {
        ingestId = new URLSearchParams(window.location.search).get("ingest") || "";
      } catch (err) {
        return;
      }
    }
    if (!ingestId) return;

    // Drop the parameter immediately so a refresh cannot re-trigger the job.
    try {
      history.replaceState({}, "", window.location.pathname);
    } catch (err) { /* older browsers: harmless */ }

    if (btnGenerate) btnGenerate.disabled = true;
    if (progressBox) progressBox.classList.remove("hidden");
    if (progressFill) progressFill.style.width = "35%";
    if (progressPct) progressPct.textContent = "35%";
    if (progressText) {
      progressText.textContent = "Transcript received from your browser — detecting topics by content…";
    }
    // Bring the box into view: it sits below the button, so a failure reported
    // there is easy to miss on a short window.
    if (progressBox && progressBox.scrollIntoView) {
      progressBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    let failed = false;
    try {
      const resp = await fetch("/api/pipeline/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingest_id: ingestId,
          api_key: userSettings.groq_api_key || userSettings.gemini_api_key || null,
          model_name: userSettings.default_model || null
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.detail || `The server rejected the captured transcript (HTTP ${resp.status}).`);
      }
      if (!data.transcript_chars) {
        throw new Error(data.warning || "The captured transcript came back empty.");
      }

      openHitlModal(data, ingestId);
    } catch (err) {
      failed = true;
      showHandoffError(err.message || String(err));
    } finally {
      if (btnGenerate) btnGenerate.disabled = false;
      // Keep the box on screen when something went wrong: the message is the
      // whole point, and hiding it is what made this failure invisible before.
      if (progressBox && !failed) progressBox.classList.add("hidden");
    }
  }

  /**
   * Reports a hand-off failure inline, in the progress box, instead of with an
   * alert(). An alert is dismissed in a reflex and leaves nothing to look at,
   * which is precisely how a failure becomes invisible.
   */
  function showHandoffError(message) {
    if (!progressBox) {
      alert(`4 U By U: ${message}`);
      return;
    }
    progressBox.classList.remove("hidden");
    if (progressFill) {
      progressFill.style.width = "100%";
      progressFill.style.background = "#d9534f";
    }
    if (progressPct) progressPct.textContent = "!";
    if (progressText) {
      progressText.style.color = "#ff9d9d";
      progressText.textContent = `Could not start from the captured transcript — ${message}`;
    }
    if (progressBox.scrollIntoView) {
      progressBox.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // ---------------------------------------------------------------------------
  // INITIAL BOOTSTRAP
  // ---------------------------------------------------------------------------
  (async () => {
    try {
      await checkAuthStatus();
    } catch (err) {
      // Guests can still generate; the vault simply has no keys to offer.
      console.warn("[4 U By U] Auth bootstrap skipped:", err);
    }
    await handleIngestHandoff();
  })();
});
