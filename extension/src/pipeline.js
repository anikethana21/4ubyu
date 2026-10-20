/**
 * A whole lecture, from captions to a notes document.
 *
 * The bookkeeping that turns one transcript into chapters, sections and one
 * finished document lives here — not in the page, and not in the userscript's
 * panel. Everything in this file that can be decided without a model is a plain
 * function of its arguments, so it can be tested without a key, a network or a
 * lecture.
 *
 * How a lecture is read
 * ---------------------
 * A two-hour lecture is around 24,000 tokens of transcript. Free tiers meter
 * tokens per minute (Groq's is 8,000), so sending it in one request is a 429
 * before the model has seen a word. It is read the way a person reads a long
 * chapter: a stretch at a time, with the previous stretch's ending still in view.
 *
 *   1. The lecture is cut into windows of about twelve minutes.
 *   2. Each window gets one planning call, over a timestamped outline of that
 *      window, which comes back naming the topics in it and where they start.
 *      That is where the topics come from: the lecture's own turning points, not
 *      the clock's. One call per window, and the window's title with it.
 *   3. Each topic is written up by one composer call over the words spoken in it
 *      (core.composeSection, lean mode).
 *
 * If the video has chapters of its own — the creator's, from the description —
 * those are the chapters, because they are the best answer to what this lecture
 * is divided into. The planner then only names the topics inside each of them.
 *
 * What happens when something fails
 * ---------------------------------
 * Nothing is invented, ever. A window the model could not plan becomes a chapter
 * that says so, in the words of the error, with the transcript of that stretch
 * shown underneath. A section that could not be written becomes the notice
 * core.composeSection already produces. And when the failure is a spent daily
 * allowance, the run stops early instead of burning the rest of the calls on
 * requests that cannot succeed, and says how far it got.
 *
 * Cost is bounded before it is spent: `estimateRun` counts the calls and the
 * tokens a lecture will take, so the user can be told what it will cost while
 * they can still decide not to spend it.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./core.js"), require("./workspace.js"));
  } else {
    root.UBYU_PIPELINE = factory(root.UBYU, root.UBYU_WORKSPACE);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, workspace) {
  "use strict";

  const VERSION = "1.0.0";

  /**
   * The defaults, chosen to fit a free tier rather than to be clever.
   *
   * `windowSeconds` is the size of one planning call: twelve minutes is around
   * 2,400 tokens of outline, which leaves room for the answer under an 8,000
   * token-per-minute allowance. `leadInSeconds` is how much of the previous
   * window the planner is shown for context — it is context only, never claimed
   * as this window's own, so a topic that straddles a boundary is named once.
   */
  const DEFAULT_OPTIONS = {
    windowSeconds: 720,
    leadInSeconds: 45,
    outlineStepSeconds: 12,
    // Raised from 30s: a 30-second "section" is usually just the tail of the
    // previous topic. 180s (3 minutes) forces real topical boundaries and halves
    // the section count for a typical lecture.
    minSectionSeconds: 180,
    maxSectionSeconds: 780,
    minWindowChars: 200,
    sectionsPerWindow: 2,
    concurrency: 2,
  };

  // ---------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------

  /**
   * "1:07:20", "7:20" or "7:20" with stray words around it, as seconds.
   *
   * Models write times in every shape except the one you asked for, so this takes
   * the ones a lecture actually uses and refuses the rest — a time that cannot be
   * read is not guessed at, because a guessed timestamp sends a reader to the
   * wrong part of the video.
   */
  function parseClock(value) {
    const match = String(value === undefined || value === null ? "" : value)
      .trim()
      .match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
    if (!match) return null;
    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  /** The last moment the captions cover. */
  function transcriptEnd(segments) {
    let end = 0;
    for (const segment of segments || []) {
      const start = Number(segment.start);
      if (!Number.isFinite(start)) continue;
      const duration = Number(segment.duration) || 0;
      end = Math.max(end, start + duration);
    }
    return Math.round(end);
  }

  /** How many characters of caption text sit between two times. */
  function charsBetween(segments, start, end) {
    let chars = 0;
    for (const segment of segments || []) {
      const at = Number(segment.start);
      if (!Number.isFinite(at) || at < start || at >= end) continue;
      chars += String(segment.text || "").length;
    }
    return chars;
  }

  /**
   * The lecture, cut into the stretches the planner is asked about one at a time.
   *
   * Windows do not overlap in what they own: `start` and `end` are this window's
   * own range, and `contextStart` is where the transcript shown to the model
   * begins, a little earlier, so a sentence that began in the previous window can
   * still be read whole. Ownership is what keeps a topic at a boundary from being
   * written up twice.
   */
  function windowsFor(durationSeconds, options = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const duration = Math.max(0, Math.round(Number(durationSeconds) || 0));
    const windows = [];
    if (!duration) return windows;
    const step = Math.max(60, settings.windowSeconds);
    for (let start = 0; start < duration; start += step) {
      const end = Math.min(duration, start + step);
      // A last window shorter than a minute is the end of a sentence, not a
      // stretch of lecture: it is given to the window before it.
      if (end - start < 60 && windows.length) {
        windows[windows.length - 1].end = end;
        break;
      }
      windows.push({
        start,
        end,
        contextStart: Math.max(0, start - Math.max(0, settings.leadInSeconds)),
      });
    }
    return windows;
  }

  /**
   * A window as the planner reads it: one line every few seconds, each with the
   * time it was said.
   *
   * The captions arrive as fragments of two or three words. Left as they are, a
   * twelve-minute window is several hundred lines of fragments — more tokens than
   * the words in it, and past the per-minute allowance on its own. Joined into
   * passages of ten or twelve seconds they read as speech, and the timestamps are
   * what the planner names the topics with.
   */
  function buildOutline(segments, start, end, stepSeconds = DEFAULT_OPTIONS.outlineStepSeconds) {
    const step = Math.max(4, Number(stepSeconds) || DEFAULT_OPTIONS.outlineStepSeconds);
    const lines = [];
    let bucketStart = null;
    let words = [];
    const flush = () => {
      if (bucketStart === null || !words.length) return;
      lines.push(`${core.clock(bucketStart)} ${words.join(" ")}`);
    };
    for (const segment of segments || []) {
      const at = Number(segment.start);
      if (!Number.isFinite(at) || at < start || at >= end) continue;
      const text = String(segment.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (bucketStart === null) bucketStart = at;
      if (at - bucketStart >= step) {
        flush();
        bucketStart = at;
        words = [];
      }
      words.push(text);
    }
    flush();
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // The prompts
  // ---------------------------------------------------------------------------

  const PLANNER_PROMPT =
    "You are the editor of the study handbook for a recorded lecture. Below is one stretch " +
    "of that lecture, as the words spoken, each passage marked with the time it was said.\n\n" +
    "Stretch: {from} to {to}\n\n" +
    "---\n{outline}\n---\n\n" +
    "Say what this stretch of the lecture is about, and where each topic in it begins. Use " +
    "the instructor's own terms, and only what is written above — do not add topics the " +
    "lecture has not reached, and do not skip one it has.\n\n" +
    "Answer in exactly this shape, with the two headings on their own lines:\n\n" +
    "TITLE\n" +
    "The topic of this stretch, at most eight words, no chapter number and no quotes.\n\n" +
    "SECTIONS\n" +
    "{min_sections} to {max_sections} lines, one per topic, in the order they are taught. Each " +
    "line is: the time the topic starts (as mm:ss or h:mm:ss), then a pipe, then the topic " +
    "title (at most eight words), then a pipe, then one sentence on what the instructor " +
    "covers there. Example:\n" +
    "12:30 | Why the gradient vanishes | The chain of multiplications that shrinks the signal.";

  const TITLE_HEADING = /^\s*TITLE\s*:?\s*$/i;
  const SECTIONS_HEADING = /^\s*SECTIONS?\s*:?\s*$/i;
  /**
   * One line of the planner's answer, taken apart.
   *
   * The prompt asks for `mm:ss | title | gist`, and a good model writes exactly
   * that. A small one writes something close: a bold timestamp, an em dash where
   * the pipe should be, brackets, a numbered list, the gist attached with a dash.
   * Those are the same answer, and refusing them is not a small loss — a plan that
   * cannot be read leaves nothing to hang the sections on, so the whole run
   * produces no notes. So the timestamp is peeled off first, and the rest is split
   * on a pipe or on a dash that has spaces around it (a dash inside a word is part
   * of the word).
   */
  const PLAN_TIME = /^(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))?\s*[|:\u2013\u2014-]?\s*(.*)$/;

  function splitPlanLine(line) {
    const match = line.match(PLAN_TIME);
    if (!match) return null;
    const at = parseClock(match[1]);
    if (at === null) return null;

    let rest = match[2] || "";
    let gist = "";
    const pipe = rest.indexOf("|");
    if (pipe >= 0) {
      gist = rest.slice(pipe + 1).trim();
      rest = rest.slice(0, pipe);
    } else {
      const dash = rest.match(/\s+[\u2013\u2014-]\s+/);
      if (dash) {
        gist = rest.slice(dash.index + dash[0].length).trim();
        rest = rest.slice(0, dash.index);
      }
    }

    const name = rest.trim().replace(/^["'`*]+|["'`*]+$/g, "");
    if (!name) return null;
    return { at, name, gist };
  }

  /**
   * What the planner answered, as sections with real times.
   *
   * Every rule here exists because a model will otherwise put a topic at 3:40 in a
   * stretch that starts at 3:20, name two topics for the same minute, or answer
   * with prose. Times outside the stretch are dropped rather than clamped — a
   * wrong timestamp is worse than a missing one — the first topic is pinned to the
   * window's start because something begins there, and topics closer together than
   * `minSectionSeconds` are merged into the one before them, since a thirty-second
   * topic is usually the end of the previous sentence.
   */
  function parsePlan(text, window, options = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const answer = String(text || "");
    const lines = answer.split(/\r\n|\r|\n/);

    let title = "";
    const kept = [];
    let inSections = false;

    for (const line of lines) {
      const trimmed = line
        .trim()
        .replace(/\*\*|__|`/g, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .trim();
      if (!trimmed) continue;
      if (TITLE_HEADING.test(trimmed)) {
        inSections = false;
        continue;
      }
      if (SECTIONS_HEADING.test(trimmed)) {
        inSections = true;
        continue;
      }
      if (!inSections && !title) {
        title = trimmed.replace(/^["'`*]+|["'`*]+$/g, "").replace(/^#+\s*/, "").trim();
        continue;
      }
      const match = splitPlanLine(trimmed);
      if (!match) continue;
      if (match.at < window.start || match.at >= window.end) continue;
      kept.push({ title: match.name, start: match.at, gist: match.gist });
    }

    kept.sort((left, right) => left.start - right.start);
    const sections = [];
    for (const item of kept) {
      const previous = sections[sections.length - 1];
      if (!previous) {
        sections.push({ ...item, start: window.start });
        continue;
      }
      if (item.start - previous.start < Math.max(20, settings.minSectionSeconds)) continue;
      sections.push(item);
    }
    if (!sections.length) return { title, sections: [], planned: false };

    return { title, sections, planned: true };
  }

  // ---------------------------------------------------------------------------
  // Chapters
  // ---------------------------------------------------------------------------

  /**
   * The creator's own chapters, if the video has them.
   *
   * YouTube chapters come from the person who made the lecture, so they are a
   * better answer to "what is this lecture divided into" than anything a model can
   * infer. They are used as given when there are at least two of them and they
   * fall inside the video; anything less is not a chapter list.
   */
  function usableChapters(chapters, durationSeconds) {
    const clean = (chapters || [])
      .map((chapter) => ({
        title: String(chapter.title || chapter.chapter_title || "").trim(),
        start: Number(chapter.timestamp_seconds !== undefined ? chapter.timestamp_seconds : chapter.start) || 0,
      }))
      .filter((chapter) => chapter.title && chapter.start >= 0 && chapter.start < Math.max(durationSeconds, 1));
    clean.sort((left, right) => left.start - right.start);
    return clean.length >= 2 ? clean : [];
  }

  /**
   * The sections of a window, hung on either the creator's chapters or the window.
   *
   * A section belongs to the chapter its start time falls in. That is a plain
   * rule, and it is the honest one: the section's own timestamp is what a reader
   * clicks, and it does not move because of which heading it sits under.
   */
  function chaptersFromPlans(plans, youtubeChapters, durationSeconds) {
    const chapters = usableChapters(youtubeChapters, durationSeconds);
    if (!chapters.length) {
      // One chapter per window, named by the topic the planner found there. A
      // window nobody could read does not become an empty "Part 4", which helps no
      // one: its failure is carried into the next chapter that could be read, so
      // the notes say what is missing and where.
      const out = [];
      let pending = [];
      plans.forEach((plan, index) => {
        if (plan.planned) {
          out.push({
            title: plan.title || `Part ${index + 1}`,
            timestamp_seconds: plan.window.start,
            sections: plan.sections,
            overview: pending.join(" "),
            planned: true,
          });
          pending = [];
          return;
        }
        pending.push(
          `The stretch from ${core.clock(plan.window.start)} to ${core.clock(plan.window.end)} ` +
            `could not be written up: ${plan.failure}`
        );
      });
      if (pending.length && out.length) {
        const last = out[out.length - 1];
        last.overview = [last.overview, ...pending].join(" ");
      }
      return out;
    }

    const owned = chapters.map((chapter, index) => ({
      title: chapter.title,
      timestamp_seconds: chapter.start,
      sections: [],
      overview: "",
      planned: true,
      endsAt: index + 1 < chapters.length ? chapters[index + 1].start : durationSeconds,
    }));

    for (const plan of plans) {
      for (const section of plan.sections) {
        let target = owned[0];
        for (const chapter of owned) {
          if (section.start >= chapter.timestamp_seconds) target = chapter;
        }
        // The topic's own start decides, but a chapter's title can also be wrong
        // about a section that ends before the chapter begins; the section is
        // given to the chapter it starts in either way, since that is where the
        // reader will be sent.
        target.sections.push(section);
      }
      if (!plan.planned) {
        const target = owned.find((chapter) => plan.window.start < (chapter.endsAt || Infinity)) || owned[0];
        target.overview = [target.overview, plan.failure].filter(Boolean).join(" ");
      }
    }

    return owned.map(({ endsAt, ...chapter }) => chapter).filter((chapter) => chapter.sections.length);
  }

  /** Attach to each section the words spoken during it, which is what gets written up. */
  function attachTranscripts(chapters, segments) {
    return (chapters || []).map((chapter) => ({
      ...chapter,
      sections: (chapter.sections || []).map((section) => ({
        ...section,
        transcript: core.segmentsToText(segments, section.start, section.end),
      })),
    }));
  }

  /** Give every section an end: the next section's start, or the chapter's end. */
  function closeSections(sections, windowEnd) {
    return (sections || []).map((section, index) => ({
      ...section,
      end: index + 1 < sections.length ? sections[index + 1].start : windowEnd,
    }));
  }

  // ---------------------------------------------------------------------------
  // Pacing, so the allowance is respected rather than tripped
  // ---------------------------------------------------------------------------

  /**
   * Wrap a `call` so that it never sends more than `tokensPerMinute` in a minute.
   *
   * Free tiers meter tokens per minute and answer a fresh request with a 429 the
   * moment the minute's allowance is gone. Waiting is therefore not a workaround,
   * it is the design: the wrapper estimates each request's tokens (characters over
   * four, plus room for the answer), keeps a minute's worth in view, and sleeps
   * until the oldest of them has aged out. A run that is told to wait is a run
   * that finishes, which is the whole difference from a run that dies at 60%.
   *
   * A 429 that arrives anyway — the estimate was low, or another tab made a call —
   * is still handled: `core.invokeReadingTranscript` reports it, and `runLecture`
   * stops on a daily limit and carries on after a per-minute one.
   */
  function createPacer({ call, tokensPerMinute = 0, sleepImpl = core.sleep, onWait, now = () => Date.now(), usage = null } = {}) {
    const limit = Number(tokensPerMinute) || 0;
    const spent = [];

    /**
     * How many output tokens to reserve for a request.
     *
     * This used to always be the completion ceiling (3,072), and that one
     * choice made every run about twice as slow as it needed to be: two
     * requests at ~1,700 in + 3,072 reserved is over 8,000, so the pacer
     * allowed exactly one call per minute even though the answers were half
     * that size. Reserving a measured answer plus a small margin lets two
     * calls share a minute, which is the difference between 15 minutes and 8
     * for an hour of lecture.
     *
     * The first call still reserves the ceiling, because nothing has been
     * measured yet. If the provider reports a large answer, the reserve stays
     * large and behaviour is exactly what it was before. A 429 that slips
     * through is still handled by the caller, so this trades a little risk for
     * a measured speedup, not a guess.
     */
    function outputReserve() {
      if (typeof usage !== "function") return core.MAX_COMPLETION_TOKENS;
      let reported = null;
      try {
        reported = usage();
      } catch (error) {
        reported = null;
      }
      const completion = Number(reported && reported.completion_tokens) || 0;
      if (!(completion > 0)) return core.MAX_COMPLETION_TOKENS;
      return Math.min(
        core.MAX_COMPLETION_TOKENS,
        Math.max(700, Math.ceil(completion * 1.08))
      );
    }

    function tokensFor(prompt) {
      const chars = typeof prompt === "string" ? prompt.length : JSON.stringify(prompt || "").length;
      return Math.ceil(chars / 4) + outputReserve();
    }

    async function paced(request) {
      const prompt = ((request && request.messages) || []).map((message) => message.content).join("\n");
      const tokens = tokensFor(prompt);
      if (!limit) return call(request);

      for (;;) {
        const at = now();
        while (spent.length && at - spent[0].at >= 60000) spent.shift();
        const used = spent.reduce((total, entry) => total + entry.tokens, 0);
        // One request that is larger than the whole minute cannot be paced, only
        // sent: the provider will answer 413 and the caller shrinks it.
        if (!spent.length || used + tokens <= limit) break;
        const wait = Math.max(250, 60000 - (at - spent[0].at));
        if (onWait) onWait(wait, used, limit);
        await sleepImpl(wait);
      }

      spent.push({ at: now(), tokens });
      return call(request);
    }

    paced.report = () => ({
      tokensInWindow: spent.reduce((total, entry) => total + entry.tokens, 0),
      inWindow: spent.length,
    });
    return paced;
  }

  /**
   * The provider's published free-tier numbers, as they were when this was written.
   *
   * These are used to pace a run and to warn before it starts, and they are not
   * treated as the truth: the provider is the truth, and its own error message
   * corrects these the moment it disagrees. A model that is not in this table is
   * not refused — it is simply run without pacing, and the first 429 explains
   * itself the way any other failure does.
   */
  const MODEL_LIMITS = {
    "openai/gpt-oss-120b": { tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 },
    "openai/gpt-oss-20b": { tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 },
    "openai/gpt-oss-safeguard-20b": { tokensPerMinute: 8000, requestsPerDay: 1000, tokensPerDay: 200000 },
    "llama-3.3-70b-versatile": { tokensPerMinute: 12000, requestsPerDay: 1000, tokensPerDay: 100000 },
    "llama-3.1-8b-instant": { tokensPerMinute: 6000, requestsPerDay: 14400, tokensPerDay: 500000 },
    "qwen/qwen3-32b": { tokensPerMinute: 6000, requestsPerDay: 1000, tokensPerDay: 500000 },
    "moonshotai/kimi-k2-instruct": { tokensPerMinute: 10000, requestsPerDay: 1000, tokensPerDay: 300000 },
  };

  // ---------------------------------------------------------------------------
  // What a lecture will cost, before it is spent
  // ---------------------------------------------------------------------------

  /**
   * The calls and tokens a lecture will take, counted rather than guessed at.
   *
   * The section count cannot be known before the planner has answered, so it is
   * estimated from the lecture's length: the planner is asked for a few topics per
   * window and usually finds about that many. The answer is labelled as an
   * estimate everywhere it is shown, because it is one.
   */
  function estimateRun({ segments, options = {} } = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const duration = transcriptEnd(segments) || 0;
    const windows = windowsFor(duration, settings);
    let outlineChars = 0;
    let speechChars = 0;
    for (const window of windows) {
      const chars = charsBetween(segments, window.contextStart, window.end);
      outlineChars += chars;
      speechChars += charsBetween(segments, window.start, window.end);
    }
    const sections = Math.max(windows.length, Math.round(windows.length * settings.sectionsPerWindow));
    const planningTokens = Math.ceil(outlineChars / 4) + windows.length * 250;
    const writingTokens = Math.ceil(speechChars / Math.max(1, sections) / 4) * sections + sections * 900;
    const calls = windows.length + sections;
    return {
      duration,
      windows: windows.length,
      sections,
      calls,
      // Both directions, as a provider bills them.
      tokens: planningTokens + writingTokens,
      tokensIn: Math.ceil((outlineChars + speechChars) / 4),
      tokensOut: windows.length * 250 + sections * 900,
    };
  }

  /**
   * How many lectures of this size a model's daily allowance can hold.
   *
   * This is the number that decides which model to pick, so it is shown as a
   * sentence rather than a percentage. `null` when the model is not one this file
   * knows about — an unknown model is not called unlimited.
   */
  function fitsInDay(estimate, model) {
    const limits = MODEL_LIMITS[model];
    if (!limits) return null;
    const tokens = Math.max(1, estimate.tokens);
    const byTokens = Math.floor(limits.tokensPerDay / tokens);
    const byCalls = Math.floor(limits.requestsPerDay / Math.max(1, estimate.calls));
    const lectures = Math.max(0, Math.min(byTokens, byCalls));
    const minutes = Math.ceil(
      (estimate.tokens / Math.max(1, limits.tokensPerMinute)) + estimate.calls * 0.6
    );
    return {
      lectures,
      byTokens,
      byCalls,
      tokensPerLecture: tokens,
      minutesPerLecture: minutes,
      tokensPerDay: limits.tokensPerDay,
      requestsPerDay: limits.requestsPerDay,
    };
  }

  // ---------------------------------------------------------------------------
  // What has already been spent today
  // ---------------------------------------------------------------------------

  /**
   * A local ledger of the day's metered use, kept beside the notes.
   *
   * The provider's own numbers arrive with every answer (`usage.prompt_tokens`
   * and `usage.completion_tokens`), so what is recorded here is what was billed,
   * not a guess. It is not a mirror of the provider's account — anything spent in
   * another tab or another tool is invisible — so it is used to *warn before*
   * spending, and the provider's 429 remains the final word.
   */
  const USAGE_KEY = "usage-v1";

  /** The day the provider would bill this against: the reader's own day. */
  function dayKey(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function readLedger(store) {
    if (!store || typeof store.get !== "function") return {};
    const raw = store.get(USAGE_KEY, null);
    if (raw && typeof raw === "object") return raw;
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (error) {
        return {};
      }
    }
    return {};
  }

  /** Tokens and calls recorded against `model` today. */
  function usageToday(store, model, now = new Date()) {
    const day = readLedger(store)[dayKey(now)] || {};
    const entry = day[model] || {};
    return {
      tokens: Number(entry.tokens) || 0,
      calls: Number(entry.calls) || 0,
      // A daily-limit answer from the provider is remembered, so tomorrow's first
      // click does not have to spend a call to be told the same thing today.
      exhausted: Boolean(entry.exhausted),
    };
  }

  /**
   * Add to today's total. Called with the provider's real usage after each answer.
   * Kept to two days: a ledger is only useful while it can say "that was today".
   */
  function recordUsage(store, model, { tokens = 0, calls = 0, exhausted = false } = {}, now = new Date()) {
    if (!store || typeof store.set !== "function" || !model) return;
    const ledger = readLedger(store);
    const key = dayKey(now);
    ledger[key] = ledger[key] || {};
    const entry = ledger[key][model] || { tokens: 0, calls: 0, exhausted: false };
    entry.tokens = (Number(entry.tokens) || 0) + Math.max(0, Number(tokens) || 0);
    entry.calls = (Number(entry.calls) || 0) + Math.max(0, Number(calls) || 0);
    if (exhausted) entry.exhausted = true;
    entry.at = now.toISOString();
    ledger[key][model] = entry;
    const kept = {};
    for (const day of Object.keys(ledger).sort().slice(-2)) kept[day] = ledger[day];
    store.set(USAGE_KEY, kept);
  }

  /**
   * Whether this lecture can be written today on this model, and what is left.
   *
   * `null` when the model's allowance is not known to this build: an unknown model
   * is not called unlimited, it is simply not gated here — the provider still is.
   */
  function allowanceFor({ estimate, model, store, now = new Date() } = {}) {
    const limits = MODEL_LIMITS[model];
    if (!limits || !estimate) return null;
    const used = usageToday(store, model, now);
    const tokensLeft = Math.max(0, limits.tokensPerDay - used.tokens);
    const callsLeft = Math.max(0, limits.requestsPerDay - used.calls);
    const needTokens = Math.max(1, Math.round(estimate.tokens));
    const needCalls = Math.max(1, Math.round(estimate.calls));
    return {
      model,
      limits,
      used,
      tokensLeft,
      callsLeft,
      needTokens,
      needCalls,
      fits: !used.exhausted && tokensLeft >= needTokens && callsLeft >= needCalls,
      exhausted: used.exhausted,
      shortBy: Math.max(0, needTokens - tokensLeft),
      minutes: Math.ceil(needTokens / Math.max(1, limits.tokensPerMinute)),
    };
  }

  /** The models whose own daily allowance still holds this lecture, roomiest first. */
  function modelsThatFit({ estimate, store, exclude = "", now = new Date() } = {}) {
    const out = [];
    for (const model of Object.keys(MODEL_LIMITS)) {
      if (model === exclude) continue;
      const allowance = allowanceFor({ estimate, model, store, now });
      if (allowance && allowance.fits) {
        out.push({ model, tokensLeft: allowance.tokensLeft, minutes: allowance.minutes });
      }
    }
    return out.sort((left, right) => right.tokensLeft - left.tokensLeft);
  }

  // ---------------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------------

  /** A cache that remembers nothing, for a run that was given no store. */
  const NO_CACHE = { get: () => null, set: () => {} };

  /**
   * Plan and write a whole lecture.
   *
   * `onEvent` is called with plain objects as the run proceeds, so the panel can
   * show what is happening instead of a spinner that means nothing. `store` is any
   * `{get, set}` — the userscript gives it its own storage — and it is what makes
   * a run resumable: a planned window and a written section are each kept under a
   * key of their own, so a rate limit, a closed tab or a dead laptop costs the
   * work done so far and nothing more.
   *
   * Resolves `{document, stats}`; never resolves with invented notes.
   */
  async function runLecture({
    segments,
    video = {},
    call,
    options = {},
    store = NO_CACHE,
    onEvent = () => {},
    shouldStop = () => false,
    title,
  } = {}) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    const began = Date.now();
    const videoId = String(video.video_id || video.id || "");
    const events = [];
    let lastActivity = Date.now();
    const emit = (event) => {
      // Any progress at all means the run is alive, and the watchdog resets.
      lastActivity = Date.now();
      events.push(event);
      onEvent(event);
    };

    // A run is not cut off at a fixed wall clock. A four-hour lecture genuinely
    // takes over an hour at eight thousand tokens a minute, so a flat "five
    // minutes and stop" would kill work that was going perfectly well. What is
    // caught here is a run that has *stopped making progress* — the failure that
    // really does leave a panel sitting there forever.
    const stallTimeoutMs = Number(options.stallTimeoutMs) || 180000;
    const runController = typeof AbortController === "function" ? new AbortController() : null;
    let stallTimer = null;
    const stalled = new Promise((_, reject) => {
      const tick = Math.max(250, Math.min(15000, Math.floor(stallTimeoutMs / 4)));
      stallTimer = setInterval(() => {
        const idle = Date.now() - lastActivity;
        if (idle < stallTimeoutMs) return;
        if (stallTimer) {
          clearInterval(stallTimer);
          stallTimer = null;
        }
        if (runController) runController.abort();
        reject(new Error(`no progress for ${Math.max(1, Math.round(idle / 1000))} seconds`));
      }, tick);
    });
    const runPromise = (async () => {
      try {
        return await _runLecture();
      } finally {
        if (stallTimer) {
          clearInterval(stallTimer);
          stallTimer = null;
        }
      }
    })();
    try {
      return await Promise.race([runPromise, stalled]);
    } finally {
      // Whichever way the race ended, nothing may be left ticking behind it.
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    }

    async function _runLecture() {

    const duration = Number(video.duration) || transcriptEnd(segments) || 0;
    const windows = windowsFor(duration, settings);
    const stats = {
      videoId,
      duration,
      windows: windows.length,
      plannedWindows: 0,
      unplannedWindows: 0,
      emptyWindows: 0,
      sections: 0,
      written: 0,
      abandoned: 0,
      degraded: [],
      fromCache: 0,
      calls: 0,
      stopped: "",
      startedAt: new Date(began).toISOString(),
      seconds: 0,
    };

    if (!videoId) return { document: null, stats, failure: "this video has no id, so its notes have nowhere to point" };
    if (!windows.length) {
      return { document: null, stats, failure: "there are no captions in this video, so there is nothing to write notes from" };
    }

    const cacheKey = (kind, at) => `ubyu:doc:${videoId}:${kind}:${at}`;

    // ---- 1. Plan each window -------------------------------------------------
    const plans = [];
    let stopped = "";
    for (let index = 0; index < windows.length; index += 1) {
      if (shouldStop()) {
        stopped = stopped || "you stopped this run, so the rest of the lecture was not read";
        break;
      }
      const window = windows[index];
      const label = `${core.clock(window.start)}–${core.clock(window.end)}`;
      const cached = store.get(cacheKey("plan", window.start));
      if (cached && cached.sections) {
        plans.push({ ...cached, window, cached: true });
        stats.fromCache += 1;
        emit({ type: "plan", index: index + 1, total: windows.length, window, cached: true });
        continue;
      }

      const chars = charsBetween(segments, window.start, window.end);
      if (chars < settings.minWindowChars) {
        emit({ type: "plan", index: index + 1, total: windows.length, window, skipped: true });
        stats.emptyWindows += 1;
        plans.push({
          window,
          title: "",
          sections: [],
          planned: false,
          failure: `Nothing was said between ${label} — the captions are empty here.`,
        });
        continue;
      }

      emit({ type: "plan", index: index + 1, total: windows.length, window, label });
      const outline = buildOutline(segments, window.contextStart, window.end, settings.outlineStepSeconds);
      const prompt = core.fillTemplate(PLANNER_PROMPT, {
        from: core.clock(window.start),
        to: core.clock(window.end),
        outline,
        min_sections: 1,
        max_sections: Math.max(2, Math.min(4, Math.round((window.end - window.start) / 180))),
      });
      let answer = "";
      let failure = "";
      try {
        stats.calls += 1;
        answer = await call({ messages: [{ role: "user", content: prompt }] });
      } catch (error) {
        failure = core.describeThrown(error);
      }

      if (!answer || !String(answer).trim()) {
        failure = failure || "the model answered with nothing";
      }
      let plan = failure
        ? { window, title: "", sections: [], planned: false, failure }
        : { window, ...parsePlan(answer, window, settings) };

      // A plan nobody can read is not a gap in the notes, it is no notes at all:
      // sections are hung on topics, and without topics there is nothing to
      // write. That is worth one more call, with the shape spelled out and
      // nothing else repeated. A planning call is a few hundred tokens; a
      // lecture that produces nothing is the whole day's allowance.
      if (!plan.planned && !failure) {
        stats.calls += 1;
        try {
          const again = await call({
            messages: [
              {
                role: "user",
                content:
                  prompt +
                  "\n\nYour previous answer could not be read. Reply again with only the TITLE block " +
                  "and the SECTIONS block, exactly in the shape of the example: TITLE, the topic on the " +
                  "next line, SECTIONS, then one line per topic as mm:ss | title | one sentence. " +
                  "No JSON, no code fence, no commentary.",
              },
            ],
          });
          if (again && String(again).trim()) {
            const retried = parsePlan(again, window, settings);
            if (retried.planned) plan = { window, ...retried };
          }
        } catch (error) {
          /* keep the first answer's plan; the failure below explains it */
        }
      }

      if (!plan.planned && !failure) {
        plan.failure =
          "The model's answer could not be read as topics, so this stretch is shown as it was said " +
          "rather than invented.";
      }

      if (plan.planned) {
        plan.sections = closeSections(plan.sections, window.end);
        store.set(cacheKey("plan", window.start), {
          title: plan.title,
          planned: true,
          sections: plan.sections,
        });
        stats.plannedWindows += 1;
      } else {
        stats.unplannedWindows += 1;
        // The reason is the provider's own words, described, and the sentence after
        // it is what a reader can do about it. A failure nobody can name is a
        // failure nobody can act on.
        const reason = failure || plan.failure;
        plan.failure = [core.describeFailure(reason), core.adviseOnFailure(reason)]
          .filter(Boolean)
          .join(" ");
      }

      emit({ type: "plan-done", index: index + 1, total: windows.length, window, plan });
      plans.push(plan);

      // A spent daily allowance cannot be waited out, so the rest of the planning
      // would be calls that cannot succeed. Stop, and say how far the run got.
      if (core.isDailyLimit(failure)) {
        stopped = `The ${video.model || "model"}'s daily allowance is spent (${failure}). ` +
          `${plans.length} of ${windows.length} parts of the lecture were planned; ` +
          "the sections that were written are in the notes below, and the rest can be added tomorrow.";
        break;
      }
      if (core.isRateLimit(failure)) {
        // A per-minute limit is worth waiting out rather than abandoning.
        emit({ type: "waiting", reason: failure });
        await core.sleep(15000);
      }
    }

    // ---- 2. Hang the sections on chapters ------------------------------------
    const chapters = chaptersFromPlans(plans, video.chapters, duration);
    const withTranscripts = attachTranscripts(chapters, segments);
    stats.sections = withTranscripts.reduce((count, chapter) => count + chapter.sections.length, 0);

    if (!stats.sections) {
      stats.seconds = Math.round((Date.now() - began) / 1000);
      // Three different things look the same from here — no words at all, words
      // nobody could read, and a model whose answers could not be read — and they
      // are not the same thing to the person who asked for notes. So the reason
      // the plans gave is carried into the sentence rather than left in the log.
      const reasons = [...new Set(plans.map((plan) => plan.failure).filter(Boolean))];
      stats.stopped =
        stopped ||
        (stats.emptyWindows === windows.length
          ? "there are no captions in this range of the video, so there is nothing to write notes from"
          : `no topics could be read from this lecture's captions, so there is nothing to write notes about${
              reasons.length ? ` — ${reasons[0]}` : ""
            }`);
      return { document: null, stats, failure: stats.stopped };
    }

    // ---- 3. Write each section ----------------------------------------------
    const flat = [];
    for (const chapter of withTranscripts) {
      for (const section of chapter.sections) flat.push({ chapter, section });
    }

    let done = 0;
    const written = await core.mapWithLimit(flat, Math.max(1, settings.concurrency), async ({ chapter, section }) => {
      // A stop is a person changing their mind, not a failure: the section is
      // dropped from the notes rather than written up as a notice about itself.
      if (shouldStop()) {
        stopped = stopped || "you stopped this run, so the rest of the lecture was not written up";
        return { ...section, abandoned: true };
      }
      const key = cacheKey("section", section.start);
      const cached = store.get(key);
      if (cached && cached.notes) {
        done += 1;
        stats.fromCache += 1;
        emit({ type: "section-done", index: done, total: flat.length, section, cached: true });
        return { ...section, ...cached.notes };
      }
      emit({ type: "section", index: done + 1, total: flat.length, section, chapter: chapter.title });
      stats.calls += 1;
      const notes = await core.composeSection(
        {
          title: section.title,
          chapterTitle: chapter.title,
          transcript: section.transcript,
          domain: settings.domain,
        },
        { call, steps: settings.steps }
      );
      done += 1;
      if (notes.degraded) {
        stats.degraded.push(`${chapter.title} › ${section.title}`);
        if (core.isDailyLimit(notes.explanation)) stopped = stopped || "the model's daily allowance was spent during the writing";
      } else {
        store.set(key, { notes });
      }
      emit({ type: "section-done", index: done, total: flat.length, section, notes, cached: false });
      return { ...section, ...notes };
    });

    // Put the written sections back where they came from, keeping only the ones
    // that were written: a stopped run's notes are the part of the lecture that was
    // finished, not a page of apologies for the part that was not.
    let cursor = 0;
    for (const chapter of withTranscripts) {
      const count = chapter.sections.length;
      const slice = written.slice(cursor, cursor + count);
      chapter.sections = slice.filter((section) => !section.abandoned);
      cursor += count;
    }
    stats.abandoned = written.filter((section) => section.abandoned).length;
    stats.sections = withTranscripts.reduce((total, chapter) => total + chapter.sections.length, 0);
    stats.written = written.filter((section) => !section.degraded && !section.abandoned).length;

    if (!stats.sections) {
      stats.seconds = Math.round((Date.now() - began) / 1000);
      stats.stopped = stopped || "the run was stopped before any section was written";
      return { document: null, stats, failure: stats.stopped };
    }

    // ---- 4. The document -----------------------------------------------------
    const chaptersOut = withTranscripts
      .filter((chapter) => chapter.sections.length)
      .map((chapter) => ({
        title: chapter.title || `Part ${chapter.chapter_order || 1}`,
        timestamp_seconds: chapter.timestamp_seconds,
        overview: chapter.overview || "",
        sections: chapter.sections.map((section) => ({
          title: section.title,
          timestamp_seconds: section.start,
          explanation: section.explanation,
          analogies: section.analogy ? [section.analogy] : section.analogies || [],
          key_points: section.key_points || [],
          pitfalls: section.pitfalls || [],
          examples: section.examples || [],
          diagram_hint: section.diagram || section.diagram_hint || "",
          degraded: Boolean(section.degraded),
        })),
      }));

    const document = workspace.buildNotesDocument({
      video: {
        video_id: videoId,
        title: video.title || title,
        channel: video.channel,
        duration_str: video.duration_str || core.clock(duration),
        duration,
        thumbnail: video.thumbnail,
      },
      chapters: chaptersOut,
      meta: {
        provider: video.provider,
        model: video.model,
        calls: stats.calls,
        generated_at: new Date().toISOString(),
      },
    });

    stats.seconds = Math.round((Date.now() - began) / 1000);
    stats.stopped = stopped;
    emit({ type: "done", stats, document });
    return { document, stats, failure: "" };
    }
  }

  return {
    VERSION,
    DEFAULT_OPTIONS,
    MODEL_LIMITS,
    PLANNER_PROMPT,
    parseClock,
    transcriptEnd,
    charsBetween,
    windowsFor,
    buildOutline,
    parsePlan,
    usableChapters,
    chaptersFromPlans,
    attachTranscripts,
    closeSections,
    createPacer,
    estimateRun,
    fitsInDay,
    USAGE_KEY,
    usageToday,
    recordUsage,
    allowanceFor,
    modelsThatFit,
    runLecture,
  };
});
