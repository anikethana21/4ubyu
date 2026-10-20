/**
 * 4 U By U — the note-writing pipeline, running in the browser.
 *
 * This is the port of the Python pipeline that used to run on a server. It runs
 * here instead because there was never anything server-shaped about it: the
 * captions already come from the page the video is playing on, and the model
 * provider accepts a browser request directly (`api.groq.com` answers with
 * `access-control-allow-origin: *`), so a server only ever added a place for the
 * user's key to live and a machine to pay for.
 *
 * What is deliberately unchanged from the Python:
 *
 * - The prompts, word for word. They are the product.
 * - One model call per section, not five agents, because the provider meters
 *   tokens and five agents asked the same excerpt five times.
 * - The answer is read tolerantly. A model that writes `**EXPLANATION**` instead
 *   of `EXPLANATION:` has still answered the question, and discarding that answer
 *   over punctuation throws away a call that has already been paid for.
 * - Nothing is invented when a call fails. The reader gets the failure, plainly
 *   named, and the instructor's own words for that part of the lecture.
 *
 * One file, so the tests can `require` it and the userscript can use it without a
 * module loader. The DOM lives in `panel.js`; nothing here touches the page.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UBYU = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "2.0.0";

  // -------------------------------------------------------------------------
  // Reading a provider's refusal correctly
  // -------------------------------------------------------------------------

  // How much of the lecture a section is written from, and how much it is
  // shortened to when the provider says the request was too big for its meter.
  const EXCERPT_STEPS = [6000, 3000, 1500];

  // How much of the lecture a degraded section quotes back to the reader.
  const NOTICE_EXCERPT_CHARS = 2400;

  // Below this, an "explanation" is a stub rather than notes.
  const MIN_EXPLANATION_CHARS = 150;

  /** True when the provider refused because one request exceeded its meter. */
  function isRequestTooLarge(message) {
    const text = message || "";
    return text.includes("413") || text.includes("Request too large");
  }

  /**
   * True when the day's allowance is spent rather than the minute's.
   *
   * The two are reported the same way (429, `rate_limit_exceeded`) but need
   * opposite advice: a per-minute allowance refills while you wait, a daily one
   * does not, and "wait a minute and try again" wastes the reader's evening.
   */
  function isDailyLimit(message) {
    const lowered = (message || "").toLowerCase();
    return (
      lowered.includes("tokens per day") ||
      lowered.includes("tpd") ||
      lowered.includes("per day")
    );
  }

  /**
   * True when this minute's allowance is spent.
   *
   * Kept exclusive of the size check and the daily check: all three arrive tagged
   * `rate_limit_exceeded`, but one must send less, one must wait a minute, and one
   * must wait for the day to reset, so both of the others take precedence.
   */
  function isRateLimit(message) {
    if (isRequestTooLarge(message) || isDailyLimit(message)) return false;
    const text = message || "";
    return (
      text.includes("429") ||
      text.includes("rate_limit_exceeded") ||
      text.includes("TPM Rate Limit")
    );
  }

  /** A short, human reason for a failed call, with the payload stripped out. */
  function describeFailure(message) {
    if (isRequestTooLarge(message)) {
      return "the request asked for more tokens in one minute than the provider allows";
    }
    if (isDailyLimit(message)) {
      return "the provider's daily token allowance for this model is spent";
    }
    if (isRateLimit(message)) {
      return (
        "the provider's per-minute token allowance was already spent when this " +
        "request was made"
      );
    }
    const text = message || "";
    if (text.includes("401") || text.includes("invalid_api_key")) {
      return "the provider rejected the API key";
    }
    if (!text.trim()) return "the provider returned nothing usable";
    return text.replace(/\s+/g, " ").trim().slice(0, 200) || "the provider gave no reason";
  }

  /** What the reader can actually do about a failed call. */
  function adviseOnFailure(message) {
    if (isRequestTooLarge(message)) {
      return (
        "This is a provider quota, not a problem with your notes. Pick fewer chapters at " +
        "once, or move to a provider plan with a larger tokens-per-minute allowance."
      );
    }
    if (isDailyLimit(message)) {
      return (
        "This is a provider quota, not a problem with your notes. The daily allowance " +
        "resets tomorrow; until then, use a different model or provider, or generate " +
        "fewer chapters at a time. Retrying in a minute will not help."
      );
    }
    if (isRateLimit(message)) {
      return (
        "This is a provider quota, not a problem with your notes. Wait about a minute and " +
        "generate this chapter again, pick fewer chapters at once, or move to a provider " +
        "plan with a larger tokens-per-minute allowance."
      );
    }
    const text = message || "";
    if (text.includes("401") || text.includes("invalid_api_key")) {
      return "Check that the API key in Settings is still valid and has not been rotated.";
    }
    if (text.includes("Could not reach the provider")) {
      return "Check the connection, then try again. Nothing was charged for a request that did not arrive.";
    }
    return "Generate this chapter again; if it keeps failing the provider may be having an outage.";
  }

  /**
   * A representative excerpt of a long transcript, not just its first part.
   *
   * Cutting a two-hour chapter off at the start would lose whatever the section
   * concluded, and conclusions are usually the point. The head, the middle and
   * the tail are kept, and the seams are marked so the model is not handed three
   * unrelated passages as though they were contiguous.
   */
  function balancedExcerpt(transcript, maxChars = 14000) {
    const text = (transcript || "").trim();
    if (text.length <= maxChars) return text;

    const part = Math.floor(maxChars / 3);
    const midStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(part / 2));
    const midEnd = Math.min(text.length, midStart + part);
    return (
      text.slice(0, part) +
      "\n\n--- [mid-lecture excerpt] ---\n\n" +
      text.slice(midStart, midEnd) +
      "\n\n--- [late-lecture excerpt] ---\n\n" +
      text.slice(-part)
    );
  }

  /**
   * The note a reader gets when a section could not be written.
   *
   * It states the failure, names the cause, says what to do, and then shows the
   * instructor's own words for that part of the lecture. Nothing is invented, so
   * the reader can still study the section and can tell that the summary is
   * missing rather than wrong.
   *
   * The cause is whatever the caller recorded. This used to substitute "no model
   * was available" whenever the failure text was empty — a cause nothing had
   * checked, printed under a heading that promises the reason. An empty failure
   * now reads as an empty failure.
   */
  function degradedNotice(failure, transcript) {
    const excerpt = balancedExcerpt(transcript, NOTICE_EXCERPT_CHARS);
    return (
      "### This section could not be written up\n\n" +
      "4 U By U asks a language model to turn the instructor's own words into notes, and no " +
      "usable notes came back for this section. Nothing has been invented to fill the gap.\n\n" +
      `**Why:** ${describeFailure(failure)}.\n\n` +
      `**What to do:** ${adviseOnFailure(failure)}\n\n` +
      "**What the instructor actually said in this part of the lecture** " +
      "(verbatim transcript, trimmed):\n\n" +
      `> ${excerpt || "This section has no transcript."}\n`
    );
  }

  /** What a thrown value says, or its name when it says nothing. */
  function describeThrown(error) {
    if (!error) return "an error with no message";
    const text = String(error.message || error).trim();
    if (text) return text;
    return `${(error && error.name) || "Error"} with no message`;
  }

  // -------------------------------------------------------------------------
  // Reading the model's answer to the composer prompt
  // -------------------------------------------------------------------------

  const LABELS = ["EXPLANATION", "ANALOGY", "KEY POINTS", "PITFALLS", "EXAMPLE", "DIAGRAM HINT"];

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Match a heading however the model dressed it up, and nothing else.
   *
   * Accepts `EXPLANATION`, `EXPLANATION:`, `**EXPLANATION**`, `**EXPLANATION:**`,
   * `### Explanation`, `> EXPLANATION`, `KEY POINTS`, `Key-Points`. The line must
   * contain only the heading, so prose that merely mentions the words is not
   * mistaken for one.
   *
   * The trailing emphasis is allowed to close after the colon as well as before
   * it: models write `**EXPLANATION:**` often enough, and the Python version would
   * have missed that line and lost the answer beneath it.
   */
  function labelPattern(label) {
    const joined = label.split(/\s+/).map(escapeRegExp).join("[ _\\-]*");
    return new RegExp(
      `^[ \\t>*#_]*\\**[ \\t]*${joined}[ \\t]*\\**[ \\t]*:?[ \\t]*\\**[ \\t]*$`,
      "gim"
    );
  }

  /**
   * Split a model answer on its own headings.
   *
   * Returns label -> body, plus "" for anything written before the first heading.
   * Text under a missing heading simply has no entry.
   */
  function splitLabeledBlocks(text) {
    const source = text || "";
    const found = [];
    for (const label of LABELS) {
      const pattern = labelPattern(label);
      let match;
      while ((match = pattern.exec(source)) !== null) {
        found.push({ start: match.index, end: match.index + match[0].length, label });
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      }
    }
    found.sort((a, b) => a.start - b.start);

    if (!found.length) return { "": source.trim() };

    const blocks = {};
    if (found[0].start > 0) blocks[""] = source.slice(0, found[0].start).trim();
    found.forEach((entry, index) => {
      const stop = index + 1 < found.length ? found[index + 1].start : source.length;
      const body = source.slice(entry.end, stop).trim();
      // The first answer for a label wins, so a model that repeats itself cannot
      // bury a good explanation under a worse one.
      if (!blocks[entry.label]) blocks[entry.label] = body;
    });
    return blocks;
  }

  const BULLET = /^\s*(?:[-*\u2022]|\d+[.)])\s+(.*)$/;
  const NOTHING = new Set(["NONE", "N/A", "NONE.", "NOTHING", "-"]);

  /** Read a block as a list, whether or not the model used bullets. */
  function items(block, limit = 6) {
    const text = (block || "").trim();
    if (!text) return [];
    const out = [];
    for (const raw of text.split(/\r\n|\r|\n|\u2028|\u2029/)) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = line.match(BULLET);
      if (bullet) out.push(bullet[1].trim());
      else if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${line}`.trim();
      else out.push(line);
    }
    return out.filter((entry) => entry && !NOTHING.has(entry.toUpperCase())).slice(0, limit);
  }

  /** Turn the model's answer into the fields a section is rendered from. */
  function parseComposition(text) {
    const blocks = splitLabeledBlocks(text || "");
    let explanation = (blocks["EXPLANATION"] || "").trim();
    if (!explanation) {
      // No recognised heading. If the model still wrote a real answer, it is still
      // grounded notes about this lecture — keep it rather than throw away a call
      // that has already been paid for.
      explanation = (blocks[""] || "").trim();
    }
    return {
      explanation,
      analogy: (blocks["ANALOGY"] || "").trim(),
      key_points: items(blocks["KEY POINTS"] || ""),
      pitfalls: items(blocks["PITFALLS"] || "", 3),
      examples: items(blocks["EXAMPLE"] || "", 2),
      // The composer is told to write NONE when no diagram helps; that is an
      // absence, not a diagram.
      diagram: /^none\b/i.test((blocks["DIAGRAM HINT"] || "").trim())
        ? ""
        : (blocks["DIAGRAM HINT"] || "").trim(),
    };
  }

  /**
   * Read a list a model numbered for us.
   *
   * Batching is what keeps a run inside a free provider quota — one request that
   * asks for six chapter titles instead of six requests — but a batched answer can
   * only be read safely if the numbers are respected. Numbering means a missing or
   * reordered line costs its own title instead of shifting every later title onto
   * the wrong chapter.
   */
  const NUMBERED_LINE = /^\s*(?:[>#*\-]\s*)*\**\s*(\d{1,3})\s*[.):\-]\s*\**\s*(.+?)\s*\**\s*$/;

  function numberedItems(text) {
    const out = {};
    for (const line of (text || "").split(/\r\n|\r|\n|\u2028|\u2029/)) {
      const match = line.match(NUMBERED_LINE);
      if (!match) continue;
      const number = Number(match[1]);
      const value = (match[2] || "").trim();
      if (value && out[number] === undefined) out[number] = value;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // The prompts
  // -------------------------------------------------------------------------

  const COMPOSER_PROMPT =
    "You are writing a chapter section for a professional engineer-grade study handbook. " +
    "Write directly TO the student as if YOU are teaching them. Do NOT write in third person " +
    "about what an instructor said. Write as the teacher: 'You will learn...', 'Here is how...', " +
    "'Notice that...', 'The key insight is...'. Never write 'The instructor explained...' or " +
    "'The lecture covers...'. You ARE the explainer.\n\n" +
    "Write ONLY from the transcript below. Leave out anything the transcript does not cover " +
    "rather than filling the gap from general knowledge — a missing point is far better than " +
    "an invented one. If a crucial concept is absent from the transcript but essential to " +
    "understanding the section, you MAY add it but MUST mark it explicitly with " +
    "[OUTSIDE SYLLABUS] at the start of the relevant paragraph.\n\n" +
    'Section: "{title}"\n' +
    'Chapter: "{chapter_title}"\n' +
    "Subject: {domain}\n\n" +
    "Transcript of this part of the lecture:\n---\n{transcript}\n---\n\n" +
    "Answer in exactly this shape. Write each heading on its own line, with nothing else on " +
    "that line:\n\n" +
    "EXPLANATION\n" +
    "A thorough, detailed explanation written directly to the student. Use second person: " +
    "'You will see...', 'Here is what happens...', 'The key point is...'. " +
    "Write multiple substantial paragraphs. Preserve the instructor's own terminology, " +
    "variable names, function names, and examples. If code or algorithms are discussed, " +
    "describe the logic step by step. If mathematical concepts appear, explain the intuition " +
    "and the formula. Do not summarize — explain. Write MORE not less; depth is the goal.\n\n" +
    "CODE\n" +
    "If the transcript contains code, algorithmic pseudocode, configuration, command-line " +
    "snippets, or concrete implementation steps, extract them here as annotated code blocks. " +
    "Each block must include: the language tag, inline comments explaining non-obvious lines, " +
    "and a brief preamble saying what the code does and where it fits. If the transcript " +
    "mentions a file, class, or function name, include it. If the transcript is missing code " +
    "that the instructor clearly wrote on screen, write [CODE NOT IN TRANSCRIPT] and describe " +
    "what was shown. If no code appears in this section, write NONE.\n\n" +
    "ANALOGY\n" +
    "One vivid, precise mental model for the central idea of this section. Avoid clichés. " +
    "The analogy must map concretely to the mechanism (e.g., \"gradient descent is a hiker " +
    "in fog taking steps downhill by feeling the slope with their feet\" not just " +
    "\"it's like walking downhill\"). If no good analogy exists, write NONE.\n\n" +
    "KEY TAKEAWAYS\n" +
    "Five to seven substantive takeaways, each a full sentence starting with \"- \". " +
    "Each must be something a student would write on a cheat sheet before an exam. " +
    "Prefer: \"- The learning rate scales the gradient step; too large diverges, too small " +
    "stalls — start at 1/sqrt(n_features) and tune by factors of 10.\" over " +
    " \"- Learning rate matters.\"\n\n" +
    "COMMON MISTAKES\n" +
    "Two to three specific mistakes students make with this exact material, written as " +
    "\"Mistake: ... -> Fix: ...\". Be concrete: reference the exact function, parameter, " +
    "or step from the transcript. If none come to mind, write NONE.\n\n" +
    "CONCRETE EXAMPLES\n" +
    "Every example the instructor actually used in this section, with enough detail to " +
    "reproduce it. If the instructor ran code with specific inputs/outputs, include them. " +
    "If they walked through a numerical example, show the numbers. Write NONE if the " +
    "transcript has no examples here.\n\n" +
    "DIAGRAM HINT\n" +
    "If a diagram would genuinely help this section (architecture, data flow, state " +
    "machine, mathematical relationship, tree/graph structure), write the Mermaid source " +
    "itself, starting on its own line with the Mermaid diagram type (for example " +
    "'flowchart TD'). No triple-backtick fence, no explanation around it, no prose before " +
    "or after it — the reader pastes exactly what you write into mermaid.live. " +
    "Write NONE if no diagram adds value. " +
    "Do not force diagrams everywhere — only where they clarify something text cannot.";

  /** Fill a prompt's `{placeholders}` from a values object, leaving others alone. */
  function fillTemplate(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
    );
  }

  // -------------------------------------------------------------------------
  // Asking, shrinking when told to, and never guessing at what went wrong
  // -------------------------------------------------------------------------

  /** Sleep, in both the browser and Node, so a rate limit can be waited out. */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Run a prompt over a transcript excerpt, sending less when told to.
   *
   * Resolves `{answer, failure}`. A 413 means the request was larger than the
   * provider's whole per-minute allowance, so the excerpt shrinks and the attempt
   * is repeated; a 429 means the allowance is spent, and sending less cannot help,
   * so the caller is told instead of being made to wait.
   */
  async function invokeReadingTranscript({
    call,
    promptTemplate,
    variables,
    transcript,
    steps = EXCERPT_STEPS,
    onAttempt,
  }) {
    let failure = "";
    for (const maxChars of steps) {
      const prompt = fillTemplate(promptTemplate, {
        ...variables,
        transcript: balancedExcerpt(transcript, maxChars),
      });
      let answer = "";
      try {
        answer = await call({ messages: [{ role: "user", content: prompt }] });
      } catch (error) {
        failure = describeThrown(error);
        if (onAttempt) onAttempt(maxChars, failure);
        if (!isRequestTooLarge(failure)) break;
        continue;
      }
      if (answer && answer.trim()) return { answer, failure: "" };
      // The call succeeded and returned nothing usable. That is a different
      // situation from a refusal, and it says so rather than leaving the reason
      // blank for a caller to guess at.
      failure = failure || "the model returned an empty answer";
      break;
    }
    return { answer: "", failure };
  }

  function degradedSection(reason, transcript) {
    return {
      explanation: degradedNotice(reason, transcript),
      analogy: "",
      key_points: [],
      pitfalls: [],
      examples: [],
      degraded: true,
    };
  }

  /**
   * Write one section's notes in a single call.
   *
   * Resolves the render fields plus `degraded`, which is true when the notice was
   * used instead of notes, so a run can report itself honestly.
   */
  async function composeSection(
    { title, chapterTitle, transcript, domain = "machine_learning" },
    { call, steps = EXCERPT_STEPS, onAttempt } = {}
  ) {
    if (!call) return degradedSection("no model was available, so no attempt was made", transcript);

    const { answer, failure } = await invokeReadingTranscript({
      call,
      promptTemplate: COMPOSER_PROMPT,
      variables: { title, chapter_title: chapterTitle || title, domain },
      transcript,
      steps,
      onAttempt,
    });
    if (!answer) return degradedSection(failure, transcript);

    const parsed = parseComposition(answer);
    if (parsed.explanation.length < MIN_EXPLANATION_CHARS) {
      return degradedSection(failure || "the model's answer was too short to be usable", transcript);
    }
    parsed.degraded = false;
    return parsed;
  }

  // -------------------------------------------------------------------------
  // Talking to the provider
  // -------------------------------------------------------------------------

  const PROVIDERS = {
    groq: {
      label: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      modelsUrl: "https://api.groq.com/openai/v1/models",
      defaultModel: "openai/gpt-oss-120b",
      lighterModel: "openai/gpt-oss-20b",
    },
  };

  /**
   * A reasoning model spends reasoning tokens out of the same response budget as
   * the answer, so a budget that fits a plain chat model can be gone before the
   * first word of the answer is written — the provider then returns HTTP 200 with
   * empty content. This leaves room for both. It is an upper bound, not a request
   * to write more: answers here run to roughly 1,200 tokens.
   */
  const MAX_COMPLETION_TOKENS = 3072;

  function snippet(text, limit = 300) {
    return String(text || "").slice(0, limit);
  }

  /**
   * The answer text, or a refusal that says why there is none.
   *
   * An empty 200 used to be handed back as an empty string, which reached the
   * reader as "the model returned an empty answer" — true, but it hides the two
   * facts that make it fixable: whether the answer was cut off at the budget, and
   * how much of it the reasoning used. Throwing says both.
   */
  function answerFromResponse(response, model) {
    const payload = response.payload || {};
    const choice = (payload.choices || [{}])[0] || {};
    const message = choice.message || {};
    const text = message.content || "";
    if (text.trim()) return text;

    const usage = payload.usage || {};
    const reasoning = (usage.completion_tokens_details || {}).reasoning_tokens;
    throw new Error(
      `Groq returned no answer for ${model}: finish_reason=${choice.finish_reason}, ` +
        `completion_tokens=${usage.completion_tokens}, reasoning_tokens=${reasoning}. ` +
        "The response budget may have been spent before the answer began."
    );
  }

  /**
   * A caller bound to one key, or null when there is no key to call with.
   *
   * Returning null rather than a stub is the whole point: a stub that answers
   * with a quota notice reads as content to everything downstream. A section whose
   * notes are a rate-limit message, or a chapter named after one, is worse than a
   * section that says it could not be written.
   */
  function createCaller({ apiKey, provider = "groq", model, fetchImpl, timeoutMs = 90000, sleepImpl = sleep, onUsage = null } = {}) {
    const send = fetchImpl || (typeof fetch === "function" ? fetch : null);
    const key = (apiKey || "").trim();
    if (!key || !send) return null;

    const config = PROVIDERS[provider] || PROVIDERS.groq;
    let target = model || config.defaultModel;
    let calls = 0;

    async function request(body, timeout = timeoutMs) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
      calls += 1;
      try {
        const response = await send(config.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        });
        const text = await response.text();
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          // A refusal is sometimes plain text; the status code still stands.
          payload = null;
        }
        // What was actually billed, reported before the answer is returned. A
        // meter that throws must never turn a good answer into a failure.
        if (response.status === 200 && payload && payload.usage && typeof onUsage === "function") {
          try {
            onUsage({ model: body.model, usage: payload.usage });
          } catch (error) {
            /* metering is bookkeeping, not part of the call */
          }
        }
        return { status: response.status, text, payload };
      } catch (error) {
        const reason =
          error && error.name === "AbortError"
            ? `the request took longer than ${Math.round(timeout / 1000)} seconds`
            : `the request could not be completed (${describeThrown(error)})`;
        throw new Error(`Could not reach the provider: ${reason}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function call({ messages, maxCompletionTokens = MAX_COMPLETION_TOKENS, temperature = 0.2 }) {
      const body = {
        model: target,
        messages,
        temperature,
        max_completion_tokens: maxCompletionTokens,
      };

      const first = await request(body);
      if (first.status === 200) return answerFromResponse(first, target);
      if (first.status === 401) {
        throw new Error(`The provider rejected the API key (401). ${snippet(first.text)}`);
      }
      if (first.status === 413) {
        // Bigger than the provider's whole per-minute allowance, so no amount of
        // waiting will help — the caller has to send less. Saying so precisely
        // lets it shrink instead of inventing content to fill the gap.
        throw new Error(
          `Request too large (413): request too large for ${target}. ${snippet(first.text)}`
        );
      }
      if (first.status === 429) {
        // Two different allowances answer with 429. A per-minute one refills, so
        // waiting buys a real retry. A daily one does not refill until tomorrow,
        // so waiting is time spent to arrive at the same refusal — and the lighter
        // model is metered separately, so it is worth trying either way.
        const daily = isDailyLimit(first.text);
        if (!daily) {
          for (const delay of [6000, 20000]) {
            await sleepImpl(delay);
            const retry = await request(body);
            if (retry.status === 200) return answerFromResponse(retry, target);
          }
        }
        body.model = config.lighterModel;
        const lighter = await request(body);
        if (lighter.status === 200) return answerFromResponse(lighter, config.lighterModel);

        const quota = daily ? "tokens per day (TPD)" : "tokens per minute (TPM)";
        throw new Error(`${config.label} ${quota} Rate Limit (429). ${snippet(first.text)}`);
      }

      // Anything else: the lighter model is metered separately and sometimes
      // answers when the larger one is having trouble.
      body.model = config.lighterModel;
      const lighter = await request(body);
      if (lighter.status === 200) return answerFromResponse(lighter, config.lighterModel);
      throw new Error(`${config.label} API Error ${first.status}: ${snippet(first.text)}`);
    }

    return {
      call,
      provider,
      model: target,
      get calls() {
        return calls;
      },
      setModel: (next) => {
        target = next;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Which models this key can actually use
  // -------------------------------------------------------------------------

  /**
   * The models the user's own key is allowed to call, asked of the provider.
   *
   * The list is not written down here, and that is deliberate. A hardcoded list is
   * a guess about someone else's service: it goes stale the week a model is
   * retired, it cannot know what this particular key is entitled to, and it offers
   * choices that answer 404 when picked. Asking the provider costs one request,
   * returns exactly the models this key has, and doubles as the way to find out
   * whether the key works at all — a rejected key fails here, before any notes are
   * paid for.
   *
   * Resolves a list of `{id, contextWindow, maxCompletionTokens}` in the provider's
   * own order, with deactivated models left out.
   */
  /**
   * Which model deserves the top of the list.
   *
   * The provider returns its models alphabetically, which is no order at all for
   * a reader deciding what should write their notes. This is a quality order: the
   * models that reliably write a long, structured chapter come first, then the
   * smaller ones, and the safety-tuned one last, because it tends to decline.
   * A model this list has never heard of is placed by the parameter count in its
   * id, so a new release lands in roughly the right place without a change here.
   */
  const MODEL_ORDER = [
    "openai/gpt-oss-120b",
    "moonshotai/kimi-k2-instruct",
    "llama-3.3-70b-versatile",
    "qwen/qwen3-32b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
    "openai/gpt-oss-safeguard-20b",
  ];

  // Endpoints that cannot write a chapter at all, whatever order they are in.
  const NOT_A_WRITER = /\b(whisper|tts|text-to-speech|embed|moderation)\b|llama-guard/i;

  /** Billions of parameters from an id like `llama-3.3-70b`, or 0 when it says nothing. */
  function parameterSize(id) {
    const match = String(id || "").match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i);
    return match ? Number(match[1]) : 0;
  }

  /** Lower is better. Models this build knows are ordered by hand. */
  function modelRank(id) {
    const known = MODEL_ORDER.indexOf(String(id));
    return known === -1 ? MODEL_ORDER.length : known;
  }

  /**
   * Best first: known quality order, then the largest unknown model, then the
   * rest alphabetically. Tools that cannot write are dropped before this runs.
   */
  function sortModels(models) {
    return (models || [])
      .filter((model) => model && model.id && !NOT_A_WRITER.test(String(model.id)))
      .slice()
      .sort((left, right) => {
        const byRank = modelRank(left.id) - modelRank(right.id);
        if (byRank !== 0) return byRank;
        const bySize = parameterSize(right.id) - parameterSize(left.id);
        if (bySize !== 0) return bySize;
        return String(left.id).localeCompare(String(right.id));
      });
  }

  async function listModels({ apiKey, provider = "groq", fetchImpl, timeoutMs = 30000 } = {}) {
    const send = fetchImpl || (typeof fetch === "function" ? fetch : null);
    const key = (apiKey || "").trim();
    const config = PROVIDERS[provider] || PROVIDERS.groq;
    if (!key) throw new Error("No API key has been saved yet.");
    if (!send) throw new Error("This browser cannot make the request to the provider.");

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await send(config.modelsUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      const reason =
        error && error.name === "AbortError"
          ? `the request took longer than ${Math.round(timeoutMs / 1000)} seconds`
          : describeThrown(error);
      throw new Error(`Could not reach ${config.label}: ${reason}`);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${config.label} rejected this API key (${response.status}). Check the key, and that it ` +
          `has not been rotated or revoked. ${snippet(text)}`
      );
    }
    if (response.status !== 200) {
      throw new Error(`${config.label} answered ${response.status} when asked for its models. ${snippet(text)}`);
    }

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`${config.label} answered with something that is not JSON. ${snippet(text)}`);
    }
    const data = (payload && payload.data) || [];
    const models = sortModels(
      data
        .filter((entry) => entry && entry.id && entry.active !== false)
        .map((entry) => ({
          id: String(entry.id),
          contextWindow: Number(entry.context_window) || 0,
          maxCompletionTokens: Number(entry.max_completion_tokens) || 0,
        }))
    );
    if (!models.length) {
      throw new Error(
        `${config.label} answered with no usable models. The key may be valid but not entitled to ` +
          "any model yet."
      );
    }
    return models;
  }

  // -------------------------------------------------------------------------
  // Running a chapter
  // -------------------------------------------------------------------------

  /** Run `worker` over `items`, at most `limit` at a time, keeping the order. */
  async function mapWithLimit(list, limit, worker) {
    const results = new Array(list.length);
    let next = 0;
    const runners = new Array(Math.max(1, Math.min(limit, list.length || 1)))
      .fill(null)
      .map(async () => {
        for (;;) {
          const index = next++;
          if (index >= list.length) return;
          results[index] = await worker(list[index], index);
        }
      });
    await Promise.all(runners);
    return results;
  }

  /**
   * Write the notes for one chapter's sections.
   *
   * Resolves `{sections, degraded}` where `degraded` names the sections that could
   * not be written, so the run can report itself instead of leaving the reader to
   * notice a missing section.
   */
  async function writeChapter({ title, sections }, { call, concurrency = 4, onSection, steps } = {}) {
    const written = await mapWithLimit(sections || [], concurrency, async (section) => {
      const notes = await composeSection(
        {
          title: section.title,
          chapterTitle: title,
          transcript: section.transcript || "",
          domain: section.domain,
        },
        { call, steps }
      );
      if (onSection) onSection(section, notes);
      return { ...section, ...notes };
    });

    return {
      title,
      sections: written,
      degraded: written.filter((section) => section.degraded).map((section) => section.title),
    };
  }

  /**
   * The transcript text spoken between two times, joined as one passage.
   *
   * The caption lines arrive as short fragments, one per phrase, because that is
   * what they are on screen. Joined by spaces they read as the lecture did; joined
   * by newlines the model reads a poem.
   */
  function segmentsToText(segments, startSeconds, endSeconds) {
    return (segments || [])
      .filter((segment) => {
        const at = Number(segment.start);
        return Number.isFinite(at) && at >= startSeconds && at < endSeconds;
      })
      .map((segment) => String(segment.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** "12:34" for 754 seconds — the clock a learner reads off the video. */
  function clock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const mmss = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    return hours ? `${hours}:${mmss}` : mmss;
  }

  return {
    VERSION,
    EXCERPT_STEPS,
    NOTICE_EXCERPT_CHARS,
    MIN_EXPLANATION_CHARS,
    LABELS,
    COMPOSER_PROMPT,
    MAX_COMPLETION_TOKENS,
    PROVIDERS,
    isRequestTooLarge,
    isDailyLimit,
    isRateLimit,
    describeFailure,
    adviseOnFailure,
    describeThrown,
    balancedExcerpt,
    degradedNotice,
    degradedSection,
    splitLabeledBlocks,
    parseComposition,
    numberedItems,
    items,
    fillTemplate,
    invokeReadingTranscript,
    composeSection,
    createCaller,
    answerFromResponse,
    listModels,
    MODEL_ORDER,
    sortModels,
    modelRank,
    parameterSize,
    mapWithLimit,
    writeChapter,
    segmentsToText,
    clock,
    sleep,
  };
});
