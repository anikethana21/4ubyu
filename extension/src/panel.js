/**
 * The panel that turns a lecture into notes, on the page the lecture is playing on.
 *
 * Everything that decides what the notes say lives in core.js and pipeline.js. This
 * is the part a person sees: where the key goes, which model will do the work, what
 * it will cost before it is spent, what is happening while it runs, and where the
 * finished page is. It holds no prompts and makes no decisions about content.
 *
 * Three rules shape it:
 *
 *   - The model list is asked of the provider with the user's own key, never
 *     written down here. A hardcoded list is a guess about someone else's service,
 *     and a wrong guess offers a model that answers 404.
 *   - The cost is shown before it is spent: how many calls, roughly how many
 *     tokens, and how many lectures of this size the chosen model's day holds. A
 *     free tier is a real constraint, and a user who is told it can plan around it;
 *     one who discovers it at 60% has lost the work.
 *   - A run that cannot finish says so in words, in the panel, with the provider's
 *     own reason — and what was written is kept, so nothing already paid for is
 *     thrown away. Closing the tab mid-run loses nothing: pipeline.js keeps every
 *     planned window and written section under its own key.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"), require("./pipeline.js"), require("./workspace.js"));
  } else {
    root.UBYU_PANEL = factory(root.UBYU, root.UBYU_PIPELINE, root.UBYU_WORKSPACE);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, pipeline, workspace) {
  "use strict";

  const VERSION = "2.0.0";

  /** Everything the panel remembers between visits lives under one prefix. */
  const KEY_API = "apiKey";
  const KEY_MODEL = "model";
  const KEY_PLAYER = "player";
  const KEY_LIBRARY = "library";
  const noteKey = (id) => `note:${id}`;

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const CSS = `
.ubyu-fab {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 999px; border: 1px solid rgba(226, 232, 240, 0.22);
  background: linear-gradient(135deg, rgba(28, 32, 40, 0.96), rgba(17, 20, 26, 0.96));
  color: #f8fafc; font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  cursor: pointer; box-shadow: 0 10px 30px rgba(2, 6, 23, 0.45);
}
.ubyu-fab:hover { border-color: rgba(250, 204, 21, 0.55); }
.ubyu-fab[hidden] { display: none; }
.ubyu-panel {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483001;
  width: 372px; max-width: calc(100vw - 24px); max-height: min(78vh, 720px);
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: 16px; border: 1px solid rgba(226, 232, 240, 0.16);
  background: linear-gradient(160deg, rgba(24, 27, 34, 0.985), rgba(14, 17, 23, 0.985));
  color: #e2e8f0; font: 13px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 24px 60px rgba(2, 6, 23, 0.6);
}
.ubyu-panel[data-open="false"] { display: none; }
.ubyu-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid rgba(226, 232, 240, 0.1);
}
.ubyu-brand { font-weight: 800; letter-spacing: 0.08em; font-size: 12px; color: #facc15; }
.ubyu-brand small { display: block; font-weight: 500; letter-spacing: 0.16em; color: #94a3b8; font-size: 8px; }
.ubyu-close {
  border: 0; background: transparent; color: #94a3b8; font-size: 18px; line-height: 1;
  cursor: pointer; padding: 2px 6px; border-radius: 6px;
}
.ubyu-close:hover { color: #e2e8f0; background: rgba(148, 163, 184, 0.12); }
.ubyu-body { padding: 14px; overflow-y: auto; }
.ubyu-body p { margin: 0 0 10px; }
.ubyu-muted { color: #94a3b8; font-size: 12px; }
.ubyu-note {
  border: 1px solid rgba(148, 163, 184, 0.28); border-left: 3px solid #38bdf8;
  border-radius: 8px; padding: 8px 10px; margin: 0 0 10px; font-size: 12px; color: #cbd5e1;
}
.ubyu-note.warn { border-left-color: #f59e0b; }
.ubyu-note.bad { border-left-color: #f87171; }
.ubyu-note.good { border-left-color: #34d399; }
.ubyu-field { margin: 0 0 10px; }
.ubyu-field label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 4px; }
.ubyu-input, .ubyu-select {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.3); background: rgba(15, 18, 24, 0.9);
  color: #e2e8f0; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ubyu-select { font-family: system-ui, sans-serif; }
.ubyu-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ubyu-btn {
  border: 1px solid rgba(226, 232, 240, 0.18); border-radius: 9px; padding: 8px 12px;
  background: rgba(148, 163, 184, 0.12); color: #e2e8f0; cursor: pointer;
  font: 600 12px/1 system-ui, sans-serif;
}
.ubyu-btn:hover { border-color: rgba(250, 204, 21, 0.5); }
.ubyu-btn[disabled] { opacity: 0.5; cursor: default; }
.ubyu-btn.primary { background: linear-gradient(135deg, #facc15, #f59e0b); color: #1f2937; border-color: transparent; }
.ubyu-btn.link { border: 0; background: transparent; color: #93c5fd; padding: 4px 2px; }
.ubyu-bar { height: 6px; border-radius: 999px; background: rgba(148, 163, 184, 0.2); overflow: hidden; margin: 8px 0; }
.ubyu-bar span { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #38bdf8, #facc15); transition: width 0.3s ease; }
.ubyu-log { margin: 10px 0 0; padding: 0; list-style: none; font: 11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color: #94a3b8; }
.ubyu-log li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ubyu-quote {
  min-height: 36px; margin: 0 0 10px; padding: 8px 12px;
  display: flex; align-items: center; justify-content: center; text-align: center;
  border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(148, 163, 184, 0.06);
  color: #cbd5e1; font: italic 12px/1.5 Georgia, "Times New Roman", serif;
  opacity: 0; transform: translateY(3px);
  transition: opacity 420ms ease, transform 420ms ease;
}
.ubyu-quote[data-visible="1"] { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .ubyu-quote { transition: opacity 120ms linear; transform: none; }
}
.ubyu-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px dashed rgba(148, 163, 184, 0.16); }
.ubyu-row:last-child { border-bottom: 0; }
.ubyu-row b { font-weight: 600; color: #f8fafc; }
.ubyu-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #cbd5e1; margin: 0 0 10px; }
`;

  /**
   * Install the panel and return its handle.
   *
   * Everything it needs from its surroundings is passed in, so the panel can be
   * driven from a test harness with a fake lecture and a fake provider, and so the
   * userscript keeps owning the parts that only make sense inside a userscript:
   * reading YouTube's own data, and storing things in the script manager.
   */
  function install({
    capture,
    store,
    download = defaultDownload,
    fetchImpl,
    openOnStart = false,
    now = () => new Date(),
  } = {}) {
    const doc = (typeof document !== "undefined" && document) || null;
    if (!doc) throw new Error("the panel needs a document to live in");
    if (typeof capture !== "function") throw new Error("the panel needs a way to read the lecture");

    const state = {
      open: Boolean(openOnStart),
      // False on a page that is not a lecture: there is nothing to make notes from
      // on YouTube's home page, so the button is not offered there.
      available: true,
      step: "setup",
      // Which lecture the panel is currently holding. YouTube changes the URL
      // without reloading the document, so this is how the panel notices that
      // the lecture underneath it is no longer the one it read.
      videoId: "",
      apiKey: String(store.get(KEY_API, "") || ""),
      provider: "groq",
      model: String(store.get(KEY_MODEL, "") || ""),
      player: Boolean(store.get(KEY_PLAYER, false)),
      models: [],
      modelsError: "",
      lecture: null,
      lectureError: "",
      reading: false,
      estimate: null,
      fit: null,
      allowance: null,
      elsewhere: [],
      percent: 0,
      log: [],
      document: null,
      stats: null,
      runError: "",
      stopped: "",
      running: false,
      cancel: false,
      quoteText: "",
      quoteVisible: false,
      library: Array.isArray(store.get(KEY_LIBRARY, [])) ? store.get(KEY_LIBRARY, []) : [],
    };

    const node = doc.createElement("div");
    node.className = "ubyu-panel";
    node.setAttribute("data-open", "false");
    node.innerHTML = `<div class="ubyu-head">
      <span class="ubyu-brand">4 U BY U<small>FOR YOU BY YOU</small></span>
      <button type="button" class="ubyu-close" title="Close" data-act="close">&times;</button>
    </div>
    <div class="ubyu-body" data-body></div>`;

    const fab = doc.createElement("button");
    fab.type = "button";
    fab.className = "ubyu-fab";
    fab.title = "Turn this lecture into study notes";
    fab.innerHTML = "✦ 4 U BY U · Make notes";

    if (!doc.getElementById("ubyu-panel-style")) {
      const style = doc.createElement("style");
      style.id = "ubyu-panel-style";
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    doc.body.appendChild(fab);
    doc.body.appendChild(node);

    const body = node.querySelector("[data-body]");

    // -----------------------------------------------------------------------
    // The waiting line
    //
    // A run is paced by the provider's tokens-per-minute allowance, so there
    // are real minutes where the honest thing to show is the log and nothing
    // else. This puts one calm line above it, holds it for three seconds, lets
    // it go, and brings the next one. It is deliberately not a spinner and not
    // a promise: it is something to read while the work happens.
    // -----------------------------------------------------------------------

    const LOADING_LINES = [
      "Good things take time.",
      "Slow is smooth; smooth is fast.",
      "An hour of lecture is an hour of thinking. The notes take what they take.",
      "Nothing here is invented — that is why it is not instant.",
      "One section at a time, in the order you would have heard it.",
      "The captions are already read. The writing is the part that takes minutes.",
      "Patience is part of quality.",
      "Written once, studied many times.",
      "A careful explanation cannot be rushed.",
      "Every section is written from the transcript, never from memory.",
      "You are paying for notes you will keep, not for a progress bar.",
      "The page is being built slowly so it opens instantly later.",
      "Depth is the goal; speed is only the constraint.",
      "Wait for the good part. It is being written now.",
    ];

    let quoteTimer = null;
    let quoteIndex = 0;

    function paintQuote() {
      const element = body.querySelector("#ubyu-quote");
      if (!element) return;
      element.textContent = state.quoteText;
      element.setAttribute("data-visible", state.quoteVisible ? "1" : "0");
    }

    function startQuotes() {
      stopQuotes();
      quoteIndex = Math.floor(Math.random() * LOADING_LINES.length);
      state.quoteText = LOADING_LINES[quoteIndex];
      state.quoteVisible = true;
      paintQuote();
      // Three seconds on, three seconds off. The first line is visible at once
      // so the space is never an empty box while a call is warming up.
      quoteTimer = setInterval(() => {
        if (state.quoteVisible) {
          state.quoteVisible = false;
        } else {
          quoteIndex = (quoteIndex + 1) % LOADING_LINES.length;
          state.quoteText = LOADING_LINES[quoteIndex];
          state.quoteVisible = true;
        }
        paintQuote();
      }, 3000);
    }

    function stopQuotes() {
      if (quoteTimer) {
        clearInterval(quoteTimer);
        quoteTimer = null;
      }
      state.quoteVisible = false;
      paintQuote();
    }

    // -----------------------------------------------------------------------
    // Storing and getting files
    // -----------------------------------------------------------------------

    function pageFor(document) {
      return workspace.renderNotesHtml(document, { player: state.player });
    }

    function fileName(type, id) {
      const stamp = String(id || "lecture").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "lecture";
      return type === "page" ? `4ubyu-notes-${stamp}.html` : `4ubyu-notes-${stamp}.json`;
    }

    /** Keep the document in the library, so a second download costs nothing. */
    function saveToLibrary(document, stats) {
      const id = document.video_id || "lecture";
      store.set(noteKey(id), document);
      const entry = {
        id,
        title: document.video_metadata ? document.video_metadata.title : "Lecture notes",
        at: now().toISOString(),
        sections: (document.chapters || []).reduce((count, chapter) => count + chapter.sections.length, 0),
        degraded: workspace.degradedSections(document).length,
        calls: (stats && stats.calls) || 0,
      };
      const rest = state.library.filter((item) => item.id !== id);
      state.library = [entry, ...rest].slice(0, 50);
      store.set(KEY_LIBRARY, state.library);
      return entry;
    }

    // -----------------------------------------------------------------------
    // Reading the lecture and pricing the run
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Reading the lecture and pricing the run
    // -----------------------------------------------------------------------

    async function readLecture() {
      state.reading = true;
      state.lectureError = "";
      render();
      try {
        const lecture = await capture();
        state.lecture = lecture;
        price();
        if (state.step === "setup" && state.apiKey) state.step = "ready";
        if (state.step !== "running" && state.step !== "done" && state.step !== "library") {
          state.step = state.apiKey ? "ready" : "setup";
        }
      } catch (error) {
        state.lecture = null;
        state.lectureError = error && error.message ? error.message : String(error);
      } finally {
        state.reading = false;
        render();
      }
    }

    /** What this lecture will cost, what is left today, and where else it fits. */
    function price() {
      if (!state.lecture || !(state.lecture.segments || []).length) {
        state.estimate = null;
        state.fit = null;
        state.allowance = null;
        state.elsewhere = [];
        return;
      }
      state.estimate = pipeline.estimateRun({ segments: state.lecture.segments });
      state.fit = state.model ? pipeline.fitsInDay(state.estimate, state.model) : null;
      state.allowance = state.model
        ? pipeline.allowanceFor({ estimate: state.estimate, model: state.model, store })
        : null;
      state.elsewhere = state.model
        ? pipeline.modelsThatFit({ estimate: state.estimate, store, exclude: state.model })
        : [];
    }

    async function checkKey() {
      if (state.running) return;
      const field = node.querySelector("[data-key]");
      state.apiKey = (field ? field.value : state.apiKey).trim();
      if (!state.apiKey) {
        state.modelsError = "Paste your API key first.";
        render();
        return;
      }
      store.set(KEY_API, state.apiKey);
      state.modelsError = "";
      state.models = [];
      state.percent = 0;
      render();
      try {
        const models = await core.listModels({ apiKey: state.apiKey, provider: state.provider, fetchImpl });
        state.models = models;
        const preferred = core.PROVIDERS[state.provider].defaultModel;
        const ids = models.map((model) => model.id);
        if (!ids.includes(state.model)) state.model = ids.includes(preferred) ? preferred : ids[0];
        store.set(KEY_MODEL, state.model);
        price();
        state.step = state.lecture ? "ready" : "setup";
        state.log = [
          `Key accepted. ${models.length} model${models.length === 1 ? "" : "s"} available to it.`,
          `Using ${state.model}.`,
        ];
      } catch (error) {
        state.modelsError = error && error.message ? error.message : String(error);
      }
      render();
      // A saved key is not the same thing as a readable lecture. If the captions
      // were never captured, try again now — otherwise the button looks like it
      // did nothing and the panel sits on this screen forever.
      if (!state.modelsError && !state.lecture && !state.reading && typeof capture === "function") {
        await readLecture();
      }
    }

    // -----------------------------------------------------------------------
    // The run
    // -----------------------------------------------------------------------

    function line(text) {
      state.log = [text, ...state.log].slice(0, 7);
    }

    async function generate() {
      if (state.running || !state.lecture) return;
      // The stop happens here, before a single token is spent: a run that cannot
      // finish today is refused with what is left and what would fit instead.
      if (state.allowance && !state.allowance.fits) {
        state.runError =
          `This lecture needs about ${Math.round(state.allowance.needTokens / 1000)}k tokens, and ` +
          `this model has ${Math.round(state.allowance.tokensLeft / 1000)}k left today. ` +
          (state.elsewhere.length
            ? `Switch to ${state.elsewhere[0].model}, which has ${Math.round(
                state.elsewhere[0].tokensLeft / 1000
              )}k left.`
            : "Nothing already written is lost; the rest can be finished tomorrow.");
        render();
        return;
      }
      const caller = core.createCaller({
        apiKey: state.apiKey,
        provider: state.provider,
        model: state.model,
        fetchImpl,
        // The provider reports what it billed; that is what goes in the ledger.
        onUsage: ({ model, usage }) => {
          const tokens =
            (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
          pipeline.recordUsage(store, model || state.model, { tokens, calls: 1 });
        },
      });
      if (!caller) {
        state.runError = "No API key is saved, so there is nothing to call. Add one first.";
        render();
        return;
      }

      state.running = true;
      state.cancel = false;
      state.step = "running";
      state.percent = 0;
      state.log = [];
      state.document = null;
      state.stats = null;
      state.runError = "";
      state.stopped = "";
      render();
      startQuotes();

      const limits = pipeline.MODEL_LIMITS[state.model];
      const call = pipeline.createPacer({
        call: caller.call,
        tokensPerMinute: limits ? limits.tokensPerMinute : 0,
        usage: () => caller.usage,
        onWait: (ms) => {
          line(`Waiting ${Math.ceil(ms / 1000)}s for the minute's allowance…`);
          render();
        },
      });

      const total = (state.estimate && state.estimate.sections) || 0;
      let planned = 0;

      try {
        const result = await pipeline.runLecture({
          segments: state.lecture.segments,
          video: {
            ...state.lecture.video,
            provider: state.provider,
            model: state.model,
          },
          call,
          store,
          shouldStop: () => state.cancel,
          onEvent: (event) => {
            if (event.type === "plan") {
              const label = `${core.clock(event.window.start)}–${core.clock(event.window.end)}`;
              line(
                event.skipped
                  ? `No captions between ${label}`
                  : event.cached
                    ? `Reused the plan for ${label}`
                    : `Reading ${label} (part ${event.index} of ${event.total})`
              );
            }
            if (event.type === "plan-done") {
              planned += 1;
              line(
                event.plan.planned
                  ? `${event.plan.title} — ${event.plan.sections.length} topic${event.plan.sections.length === 1 ? "" : "s"}`
                  : `Part ${event.index} could not be planned`
              );
            }
            if (event.type === "section") {
              line(`Writing “${event.section.title}”…`);
              state.percent = total ? Math.min(95, Math.round((event.index - 1) / Math.max(1, total) * 100)) : 0;
            }
            if (event.type === "done") {
              state.percent = 100;
            }
            render();
          },
        });

        state.document = result.document;
        state.stats = result.stats;
        state.stopped = result.stats.stopped || "";
        state.runError = result.failure || "";
        if (core.isDailyLimit(`${result.failure || ""} ${result.stats.stopped || ""}`)) {
          // Remember the refusal, so the next click does not spend a call to hear it.
          pipeline.recordUsage(store, state.model, { exhausted: true });
        }
        if (result.document) {
          const entry = saveToLibrary(result.document, result.stats);
          state.step = "done";
          line(`Saved “${entry.title}” to your library.`);
        } else {
          state.step = "ready";
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        state.runError = message;
        if (core.isDailyLimit(message)) {
          pipeline.recordUsage(store, state.model, { exhausted: true });
        }
        state.step = "ready";
      } finally {
        state.running = false;
        stopQuotes();
        // The ledger has just grown; the next estimate must see the new total.
        price();
        render();
      }
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    function modelOptions() {
      if (!state.models.length) {
        return state.model
          ? `<option value="${escapeHtml(state.model)}" selected>${escapeHtml(state.model)}</option>`
          : "";
      }
      // Best first. A model already chosen is kept even if it is not one this
      // build would have ranked first, because choosing it was a decision.
      const sorted = core.sortModels(state.models);
      const ids = sorted.map((model) => model.id);
      const models =
        state.model && !ids.includes(state.model) ? [{ id: state.model }, ...sorted] : sorted;
      return models
        .map((model, index) => {
          const label =
            index === 0 && models.length > 1 ? `${model.id} — best for notes` : model.id;
          return (
            `<option value="${escapeHtml(model.id)}"${model.id === state.model ? " selected" : ""}>` +
            `${escapeHtml(label)}</option>`
          );
        })
        .join("");
    }

    function costBlock() {
      if (!state.estimate) return "";
      const estimate = state.estimate;
      const minutes = Math.max(1, Math.round(estimate.duration / 60));
      const fit = state.fit;
      const fitLine = fit
        ? fit.lectures >= 1
          ? `This model's free day holds about <b>${fit.lectures}</b> lecture${
              fit.lectures === 1 ? "" : "s"
            } this size, at roughly ${fit.minutesPerLecture} minutes each.`
          : `This lecture needs about <b>${Math.round(estimate.tokens / 1000)}k tokens</b>, which is ` +
            `more than this model's free day (${Math.round(fit.tokensPerDay / 1000)}k). Pick another ` +
            "model, or a shorter stretch of the lecture."
        : "This model's allowance is not one this build knows, so it will not be paced — the " +
          "provider's own limit message will say if it is reached.";

      const allowance = state.allowance;
      const left = allowance
        ? allowance.exhausted
          ? "Today's allowance for this model is already spent; it refills after midnight."
          : `Today: <b>${Math.round(allowance.tokensLeft / 1000)}k</b> of ` +
            `${Math.round(allowance.limits.tokensPerDay / 1000)}k tokens left on this model` +
            (allowance.used.tokens
              ? ` (${Math.round(allowance.used.tokens / 1000)}k already used).`
              : ".")
        : "";

      // The stop that the reader is owed before spending anything: a lecture that
      // cannot finish today is said now, with what would fit instead.
      let blocked = "";
      if (allowance && !allowance.fits) {
        const alternatives = state.elsewhere
          .slice(0, 3)
          .map(
            (option) => `<button type="button" class="ubyu-btn link" data-act="use-model"
              data-id="${escapeHtml(option.model)}">Use ${escapeHtml(option.model)}
              (${Math.round(option.tokensLeft / 1000)}k left)</button>`
          )
          .join(" · ");
        blocked = `<div class="ubyu-note bad">
          <b>This lecture cannot be written today on this model.</b><br/>
          It needs about <b>${Math.round(allowance.needTokens / 1000)}k tokens</b>; this model has
          <b>${Math.round(allowance.tokensLeft / 1000)}k</b> left${
            allowance.shortBy ? ` — short by ${Math.round(allowance.shortBy / 1000)}k` : ""
          }.${
            allowance.exhausted ? " The provider has already refused this model for today." : ""
          }<br/>
          ${
            state.elsewhere.length
              ? `Another model still has room for the whole lecture: ${alternatives}`
              : "No model this build knows still has room for the whole lecture. Anything already written is kept, so the rest can be finished tomorrow."
          }
        </div>`;
      }

      return `<div class="ubyu-note">
        <b>${minutes} min of lecture</b> · ${estimate.windows} part${estimate.windows === 1 ? "" : "s"} ·
        about ${estimate.calls} calls · roughly ${Math.round(estimate.tokens / 1000)}k tokens<br/>
        ${fitLine}${left ? `<br/>${left}` : ""}
      </div>
      ${blocked}`;
    }

    function libraryBlock() {
      if (!state.library.length) {
        return `<p class="ubyu-muted">No notes yet. Every lecture you finish is kept here, so its page
        can be drawn again without paying for it twice.</p>`;
      }
      return state.library
        .map(
          (item) => `<div class="ubyu-row">
            <span>${escapeHtml(item.title)}
              <br/><span class="ubyu-muted">${escapeHtml(String(item.at).slice(0, 16).replace("T", " "))} ·
              ${item.sections} section${item.sections === 1 ? "" : "s"}${
                item.degraded ? ` · ${item.degraded} not written up` : ""
              }</span>
            </span>
            <span class="ubyu-actions">
              <button type="button" class="ubyu-btn link" data-act="open-note" data-id="${escapeHtml(item.id)}">Page</button>
              <button type="button" class="ubyu-btn link" data-act="data-note" data-id="${escapeHtml(item.id)}">Data</button>
              <button type="button" class="ubyu-btn link" data-act="forget-note" data-id="${escapeHtml(item.id)}">Remove</button>
            </span>
          </div>`
        )
        .join("");
    }

    function setupView() {
      const models = state.models.length
        ? `<div class="ubyu-field">
             <label for="ubyu-model">Model to write with</label>
             <select class="ubyu-select" id="ubyu-model" data-model>${modelOptions()}</select>
           </div>
           ${costBlock()}`
        : "";
      return `<p>Paste your own API key. It is kept in this browser by your userscript manager and
        never leaves it except to the provider you chose.</p>
        <div class="ubyu-field">
          <label for="ubyu-key">Groq API key</label>
          <input class="ubyu-input" id="ubyu-key" data-key type="password" placeholder="gsk_…"
            value="${escapeHtml(state.apiKey)}" autocomplete="off" spellcheck="false"/>
        </div>
        <p class="ubyu-muted">A free key from console.groq.com is enough. Notes stay free to make.</p>
        ${state.modelsError ? `<div class="ubyu-note bad">${escapeHtml(state.modelsError)}</div>` : ""}
        ${state.reading ? `<div class="ubyu-note">Reading this lecture's captions…</div>` : ""}
        ${
          state.lectureError
            ? `<div class="ubyu-note bad"><b>This lecture's captions could not be read, so there is nothing to write notes from yet.</b><br/>
                ${escapeHtml(state.lectureError)}<br/>
                <span class="ubyu-muted">A saved key alone cannot fix this — the transcript is what is missing.</span></div>
                <div class="ubyu-actions">
                  <button type="button" class="ubyu-btn" data-act="recheck-lecture">Read this lecture again</button>
                </div>`
            : ""
        }
        ${models}
        <div class="ubyu-actions">
          <button type="button" class="ubyu-btn primary" data-act="check-key">
            ${state.models.length ? "Save this key" : "Check the key and list models"}
          </button>
          ${state.models.length ? "" : `<button type="button" class="ubyu-btn link" data-act="library">My notes</button>`}
        </div>`;
    }

    function readyView() {
      const lecture = state.lecture;
      const metadata = lecture.video || {};
      const title = metadata.title || "this lecture";
      return `<div class="ubyu-note good">
          <b>${escapeHtml(title)}</b><br/>
          <span class="ubyu-muted">${(lecture.segments || []).length} caption lines ·
          ${escapeHtml(metadata.channel || "unknown channel")}${
            metadata.duration ? ` · ${core.clock(metadata.duration)}` : ""
          }${metadata.chapters && metadata.chapters.length ? ` · ${metadata.chapters.length} chapters in the description` : ""}</span>
        </div>
        ${costBlock()}
        <div class="ubyu-field">
          <label for="ubyu-model">Model to write with</label>
          <select class="ubyu-select" id="ubyu-model" data-model>${modelOptions()}</select>
        </div>
        <label class="ubyu-check">
          <input type="checkbox" data-player${state.player ? " checked" : ""}/>
          Put the video beside the notes (needs a page served over the web, not a file)
        </label>
        ${state.runError ? `<div class="ubyu-note bad">${escapeHtml(state.runError)}</div>` : ""}
        ${state.stopped ? `<div class="ubyu-note warn">${escapeHtml(state.stopped)}</div>` : ""}
        <div class="ubyu-actions">
          <button type="button" class="ubyu-btn primary" data-act="generate"${
            state.reading || !state.lecture || (state.allowance && !state.allowance.fits)
              ? " disabled"
              : ""
          }>Generate notes</button>
          <button type="button" class="ubyu-btn link" data-act="recheck">Change key or model</button>
          <button type="button" class="ubyu-btn link" data-act="library">My notes</button>
        </div>`;
    }

    function runningView() {
      return `<div class="ubyu-quote" id="ubyu-quote" data-visible="${state.quoteVisible ? "1" : "0"}">${escapeHtml(state.quoteText)}</div>
        <p><b>Writing your notes.</b> Nothing is invented: anything the model cannot write up is
        marked as a notice, with the lecture's own words underneath.</p>
        <div class="ubyu-bar"><span style="width: ${state.percent}%"></span></div>
        <ul class="ubyu-log">${state.log.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>
        <div class="ubyu-actions" style="margin-top: 12px">
          <button type="button" class="ubyu-btn" data-act="stop">Stop</button>
          <span class="ubyu-muted">Closing this tab is also safe — finished parts are kept.</span>
        </div>`;
    }

    function doneView() {
      const stats = state.stats || {};
      const chapters = state.document ? state.document.chapters.length : 0;
      const degraded = state.document ? workspace.degradedSections(state.document).length : 0;
      return `<div class="ubyu-note good">
          <b>Your notes are ready.</b><br/>
          ${chapters} chapter${chapters === 1 ? "" : "s"} · ${stats.sections || 0} section${
            stats.sections === 1 ? "" : "s"
          } · ${stats.calls || 0} model call${stats.calls === 1 ? "" : "s"} · ${stats.seconds || 0}s${
            stats.fromCache ? ` · ${stats.fromCache} reused from earlier` : ""
          }
        </div>
        ${degraded ? `<div class="ubyu-note warn">${degraded} section${
          degraded === 1 ? " was" : "s were"
        } left as a notice rather than invented. Each one says why, and shows what was said in
          that part of the lecture.</div>` : ""}
        ${state.stopped ? `<div class="ubyu-note warn">${escapeHtml(state.stopped)}</div>` : ""}
        <p class="ubyu-muted">The page opens from your own disk with no server anywhere. To keep it as a
        PDF, open it and use the “Save as PDF” button — that is your browser's own printer.</p>
        <div class="ubyu-actions">
          <button type="button" class="ubyu-btn primary" data-act="open-page">Open the page</button>
          <button type="button" class="ubyu-btn" data-act="save-page">Download the page</button>
          <button type="button" class="ubyu-btn link" data-act="save-data">Download the notes data</button>
          <button type="button" class="ubyu-btn link" data-act="library">My notes</button>
        </div>`;
    }

    function libraryView() {
      return `<p>Notes you have already paid for. Drawing a page again costs nothing.</p>
        ${libraryBlock()}
        <div class="ubyu-actions" style="margin-top: 10px">
          <button type="button" class="ubyu-btn" data-act="back">Back</button>
        </div>`;
    }

    function render() {
      node.setAttribute("data-open", String(state.open && state.available));
      fab.hidden = state.open || !state.available;
      const views = {
        setup: setupView,
        ready: readyView,
        running: runningView,
        done: doneView,
        library: libraryView,
      };
      const view = views[state.step] || setupView;
      body.innerHTML = view();
      const modelSelect = body.querySelector("[data-model]");
      if (modelSelect) {
        modelSelect.value = state.model;
      }
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    function open(step) {
      state.open = true;
      if (step) state.step = step;
      if (state.step === "running" && !state.running) state.step = state.document ? "done" : "ready";
      render();
      if (!state.apiKey) {
        state.step = "setup";
        render();
      }
      if (!state.lecture && !state.reading && typeof capture === "function") readLecture();
      // Reopening mid-run puts the waiting line back without touching the work.
      if (state.running) startQuotes();
    }

    function close() {
      state.open = false;
      // A closed panel has nothing to read the quote, and a run that is still
      // going will restart it if it is opened again.
      if (quoteTimer) {
        clearInterval(quoteTimer);
        quoteTimer = null;
      }
      render();
    }

    fab.addEventListener("click", () => open());

    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-key]")) {
        event.preventDefault();
        checkKey();
      }
    });

    node.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("[data-model]")) {
        state.model = target.value;
        store.set(KEY_MODEL, state.model);
        price();
        render();
      }
      if (target.matches("[data-player]")) {
        state.player = Boolean(target.checked);
        store.set(KEY_PLAYER, state.player);
      }
    });

    node.addEventListener("click", (event) => {
      const button = event.target.closest("[data-act]");
      if (!button) return;
      const act = button.getAttribute("data-act");
      const id = button.getAttribute("data-id");
      if (act === "close") return close();
      if (act === "check-key") return void checkKey();
      if (act === "generate") return void generate();
      if (act === "recheck") {
        state.step = "setup";
        state.modelsError = "";
        return render();
      }
      if (act === "recheck-lecture") {
        if (!state.reading && typeof capture === "function") void readLecture();
        return undefined;
      }
      if (act === "use-model") {
        state.model = id;
        store.set(KEY_MODEL, state.model);
        state.log = [];
        price();
        return render();
      }
      if (act === "stop") {
        state.cancel = true;
        line("Stopping after this section…");
        return render();
      }
      if (act === "library") {
        state.step = "library";
        return render();
      }
      if (act === "back") {
        state.step = state.document ? "done" : state.lecture && state.apiKey ? "ready" : "setup";
        return render();
      }
      if (act === "open-page") {
        return openPage(state.document, true);
      }
      if (act === "save-page") {
        return download(fileName("page", state.document && state.document.video_id), pageFor(state.document), "text/html");
      }
      if (act === "save-data") {
        return download(
          fileName("data", state.document && state.document.video_id),
          workspace.notesDocumentToJson(state.document),
          "application/json"
        );
      }
      if (act === "open-note") {
        const document = store.get(noteKey(id), null);
        if (!document) return;
        return openPage(document, true);
      }
      if (act === "data-note") {
        const document = store.get(noteKey(id), null);
        if (!document) return;
        return download(fileName("data", id), workspace.notesDocumentToJson(document), "application/json");
      }
      if (act === "forget-note") {
        store.remove(noteKey(id));
        state.library = state.library.filter((item) => item.id !== id);
        store.set(KEY_LIBRARY, state.library);
        return render();
      }
      return undefined;
    });

    function openPage(document, openInTab) {
      if (!document) return undefined;
      const html = pageFor(document);
      if (!openInTab) return download(fileName("page", document.video_id), html, "text/html");
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const tab = typeof GM_openInTab === "function" ? null : window.open(url, "_blank");
      if (typeof GM_openInTab === "function") {
        GM_openInTab(url, { active: true, insert: true });
      } else if (!tab) {
        line("Your browser blocked the new tab. Use Download the page instead.");
        render();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return undefined;
    }

    render();

    return {
      VERSION,
      open,
      close,
      node,
      fab,
      /** The current state, for tests and for the menu commands. */
      state,
      render,
      readLecture,
      checkKey,
      generate,
      pageFor,
      /** Whether this page is a lecture that notes could be made from. */
      setAvailable(available) {
        state.available = Boolean(available);
        if (!state.available) state.open = false;
        render();
      },
      /**
       * Tell the panel which lecture is on screen now.
       *
       * YouTube swaps videos without reloading the document. Without this, the
       * panel keeps the first lecture it read and will not read another until
       * the whole browser is restarted. When the id changes, everything that
       * belonged to the old lecture is dropped.
       */
      setVideo(videoId) {
        const id = String(videoId || "");
        if (id === state.videoId) return;
        state.videoId = id;
        state.lecture = null;
        state.lectureError = "";
        state.estimate = null;
        state.fit = null;
        state.document = null;
        state.stats = null;
        state.runError = "";
        state.stopped = "";
        state.percent = 0;
        state.log = [];
        // A run started on the old lecture must not keep writing.
        if (state.running) state.cancel = true;
        if (state.step === "running" || state.step === "done" || state.step === "library") {
          state.step = state.apiKey ? "ready" : "setup";
        }
        render();
        if (state.open && id && !state.running && typeof capture === "function") {
          void readLecture();
        }
      },
    };
  }

  /** A download that needs no permissions: an anchor and a blob URL. */
  function defaultDownload(name, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return { VERSION, install, defaultDownload };
});
