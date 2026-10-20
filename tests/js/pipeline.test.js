/**
 * Chapterisation and the run that drives it.
 *
 * Everything here is checked without a key, a network or a lecture. The parts
 * worth pinning are the ones a model's answer is allowed to be wrong about: times
 * it invents, topics it repeats, prose where a list was asked for. A planner that
 * answers badly must produce fewer notes, never wrong ones — a wrong timestamp
 * sends a reader to the wrong minute of a two-hour video, which is worse than a
 * missing sentence.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../../extension/src/core.js");
const workspace = require("../../extension/src/workspace.js");
const pipeline = require("../../extension/src/pipeline.js");

/** A lecture whose captions cover `minutes`, three seconds apart. */
function lecture(minutes, { captionGap = null } = {}) {
  const segments = [];
  for (let at = 0; at < minutes * 60; at += 3) {
    if (captionGap && at >= captionGap[0] && at < captionGap[1]) continue;
    segments.push({
      start: at,
      duration: 3,
      text: at % 9 === 0 ? "the gradient of the loss" : "and then the hidden state carries it forward",
    });
  }
  return segments;
}

/**
 * A stand-in for the provider, answering the two prompts by name.
 *
 * The planning answer is derived from the window it was asked about, so a run
 * over a real timeline produces timelines in the notes and a test can check that
 * the times a reader clicks really are the times the captions were at.
 */
function fakeProvider({ planFor = null, failPlanning = null, composerAnswer = null } = {}) {
  const seen = { planning: [], composing: [] };
  const call = async ({ messages }) => {
    const prompt = messages[0].content;
    if (/SECTIONS\n/.test(prompt) && /TITLE/.test(prompt)) {
      seen.planning.push(prompt);
      const from = prompt.match(/Stretch: ([\d:]+) to /);
      const start = pipeline.parseClock(from ? from[1] : "0:00") || 0;
      if (failPlanning) {
        const error = new Error(failPlanning);
        error.status = failPlanning.includes("per day") ? 429 : 500;
        throw error;
      }
      if (planFor) return planFor(start, prompt);
      const end = pipeline.parseClock((prompt.match(/ to ([\d:]+)\n/) || [])[1] || "24:00") || start + 720;
      const first = core.clock(start);
      const second = core.clock(start + 360);
      // Only what is really inside the stretch: a planner that answered about a
      // minute it was not asked about is what `parsePlan` refuses, not what this
      // stand-in should be imitating.
      return (
        "TITLE\nThe gates and the cell state\n\n" +
        "SECTIONS\n" +
        `${first} | Forget gate behaviour | What the forget gate does to the cell state.\n` +
        (start + 360 < end
          ? `${second} | Input and output gates | How writing and reading are decided.\n`
          : "")
      );
    }
    seen.composing.push(prompt);
    return (
      composerAnswer ||
      "EXPLANATION\nThe instructor begins by naming the **forget gate**, which decides what leaves " +
        "the cell state, and then walks through what each of the other gates writes into it. " +
        "The point of the example that follows is that the cell state is the thing carrying " +
        "information from the beginning of the sentence to the end of it.\n\n" +
        "ANALOGY\nA water filter that keeps the clean part.\n\n" +
        "KEY POINTS\n- the cell state carries long-term memory\n- each gate has its own weights\n\n" +
        "PITFALLS\n- mixing up h_t and c_t -> keep the two names apart\n\n" +
        "EXAMPLE\n- the sentence Riya is a doctor\n"
    );
  };
  call.seen = seen;
  return call;
}

/** A store in memory, shaped like the userscript's. */
function store() {
  const values = new Map();
  return {
    values,
    get: (key) => (values.has(key) ? JSON.parse(values.get(key)) : null),
    set: (key, value) => values.set(key, JSON.stringify(value)),
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

test("a time the model wrote is read, or refused rather than guessed at", () => {
  assert.equal(pipeline.parseClock("12:30"), 750);
  assert.equal(pipeline.parseClock("1:07:20"), 4040);
  assert.equal(pipeline.parseClock("0:05"), 5);
  assert.equal(pipeline.parseClock(" 3:09 "), 189);
  assert.equal(pipeline.parseClock("12:99"), null, "ninety-nine seconds is not a time");
  assert.equal(pipeline.parseClock("about twelve minutes"), null);
  assert.equal(pipeline.parseClock(""), null);
  assert.equal(pipeline.parseClock(null), null);
});

test("a lecture is cut into windows that own their own minutes", () => {
  const windows = pipeline.windowsFor(1800);
  assert.equal(windows.length, 3);
  assert.deepEqual(
    windows.map((window) => [window.start, window.end]),
    [
      [0, 720],
      [720, 1440],
      [1440, 1800],
    ]
  );
  assert.equal(windows[1].contextStart, 675, "each window is shown a little of the one before it");
  assert.equal(windows[0].contextStart, 0);
});

test("a last window of seconds is given to the window before it", () => {
  const windows = pipeline.windowsFor(726);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].end, 726);
  assert.deepEqual(pipeline.windowsFor(0), []);
});

// ---------------------------------------------------------------------------
// Reading the model's answer
// ---------------------------------------------------------------------------

test("a window is shown to the model as passages with the time they were said", () => {
  const segments = lecture(2);
  const outline = pipeline.buildOutline(segments, 0, 120, 12);
  const lines = outline.split("\n");
  assert.ok(lines.length >= 8 && lines.length <= 12, `one line every twelve seconds: ${lines.length}`);
  assert.match(lines[0], /^00:00 the gradient of the loss/);
  assert.ok(lines.every((line) => /^\d+:\d{2} /.test(line)), "every line says when it was said");
});

test("the planner's answer becomes sections with the times it gave", () => {
  const window = { start: 720, end: 1440, contextStart: 675 };
  const answer =
    "TITLE\nGating the hidden state\n\nSECTIONS\n" +
    "12:00 | Forget gate behaviour | What leaves the cell state.\n" +
    "12:34 | Input and output gates | Writing and reading.\n" +
    "18:00 | Backpropagation through time | How the gradient flows back.\n";
  const plan = pipeline.parsePlan(answer, window);
  assert.equal(plan.planned, true);
  assert.equal(plan.title, "Gating the hidden state");
  assert.deepEqual(
    plan.sections.map((section) => [section.start, section.title]),
    [
      [720, "Forget gate behaviour"],
      [754, "Input and output gates"],
      [1080, "Backpropagation through time"],
    ]
  );
  assert.equal(plan.sections[0].gist, "What leaves the cell state.");
});

test("times the model invented are dropped, and topics too close together are merged", () => {
  const window = { start: 720, end: 1440, contextStart: 675 };
  const answer =
    "TITLE\nGates\n\nSECTIONS\n" +
    "10:00 | Before the window | Not in this stretch at all.\n" +
    "12:00 | Forget gate | Real.\n" +
    "12:20 | Forget gate again | Twenty seconds later, which is not a new topic.\n" +
    "25:00 | After the window | Past the end of the stretch.\n";
  const plan = pipeline.parsePlan(answer, window);
  assert.deepEqual(
    plan.sections.map((section) => [section.start, section.title]),
    [[720, "Forget gate"]],
    "only the topic inside the stretch survives"
  );
});

test("the topic that begins a window starts at the window, not at the model's best guess", () => {
  const window = { start: 720, end: 1440, contextStart: 675 };
  const plan = pipeline.parsePlan(
    "TITLE\nGates\n\nSECTIONS\n12:03 | Forget gate | x\n12:40 | Input gate | y\n",
    window
  );
  assert.equal(plan.sections[0].start, 720);
  assert.equal(plan.sections[1].start, 760);
});

test("prose where a list was asked for is not read as a plan", () => {
  const window = { start: 0, end: 720, contextStart: 0 };
  const plan = pipeline.parsePlan(
    "This stretch of the lecture is about gating, and the instructor spends most of it on the " +
      "forget gate before moving on to the input gate.",
    window
  );
  assert.equal(plan.planned, false);
  assert.deepEqual(plan.sections, []);
});

test("a model that answered with only a heading still names the chapter", () => {
  const window = { start: 0, end: 720, contextStart: 0 };
  const plan = pipeline.parsePlan("TITLE\nRecurrent networks\n\nSECTIONS\n", window);
  assert.equal(plan.title, "Recurrent networks");
  assert.equal(plan.planned, false);
});

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

test("the creator's own chapters are used when the video has them", () => {
  const chapters = pipeline.usableChapters(
    [
      { title: "Introduction", timestamp_seconds: 0 },
      { title: "The vanishing gradient", timestamp_seconds: 600 },
      { title: "LSTM gates", timestamp_seconds: 1500 },
    ],
    3600
  );
  assert.equal(chapters.length, 3);
  assert.equal(pipeline.usableChapters([{ title: "Only one", timestamp_seconds: 0 }], 3600).length, 0,
    "one chapter is not a division of anything");
  assert.equal(pipeline.usableChapters([], 3600).length, 0);
});

test("sections land in the chapter their own timestamp falls in", () => {
  const plans = [
    {
      window: { start: 0, end: 720 },
      title: "Warm-up",
      planned: true,
      sections: [
        { title: "What a sequence is", start: 0, end: 300, gist: "" },
        { title: "Why recurrence", start: 400, end: 660, gist: "" },
      ],
    },
  ];
  const chapters = pipeline.chaptersFromPlans(
    plans,
    [
      { title: "Introduction", timestamp_seconds: 0 },
      { title: "Recurrence", timestamp_seconds: 360 },
    ],
    1800
  );
  assert.deepEqual(
    chapters.map((chapter) => [chapter.title, chapter.sections.map((section) => section.title)]),
    [
      ["Introduction", ["What a sequence is"]],
      ["Recurrence", ["Why recurrence"]],
    ]
  );
});

test("with no chapters in the video, each window is a chapter named after its topic", () => {
  const plans = [
    { window: { start: 0, end: 720 }, title: "Recurrent networks", planned: true, sections: [{ title: "A", start: 0, end: 300 }] },
    { window: { start: 720, end: 1440 }, title: "The gates", planned: true, sections: [{ title: "B", start: 720, end: 900 }] },
  ];
  const chapters = pipeline.chaptersFromPlans(plans, [], 1440);
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["Recurrent networks", "The gates"]);
  assert.deepEqual(chapters.map((chapter) => chapter.timestamp_seconds), [0, 720]);
});

test("a stretch nobody could read is said out loud, not shown as a blank chapter", () => {
  const plans = [
    { window: { start: 0, end: 720 }, title: "Recurrent networks", planned: true, sections: [{ title: "A", start: 0, end: 300 }] },
    {
      window: { start: 720, end: 1440 },
      title: "",
      planned: false,
      failure: "the model's daily token allowance is spent",
      sections: [],
    },
  ];
  const chapters = pipeline.chaptersFromPlans(plans, [], 1440);
  assert.equal(chapters.length, 1, "no empty chapter");
  assert.match(chapters[0].overview, /The stretch from 12:00 to 24:00 could not be written up/);
  assert.match(chapters[0].overview, /allowance is spent/);
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

test("calls are paced so the minute's allowance is not tripped", async () => {
  const waited = [];
  let clock = 0;
  const sent = [];
  const paced = pipeline.createPacer({
    call: async (request) => {
      sent.push(clock);
      return "ok";
    },
    tokensPerMinute: 9000,
    now: () => clock,
    sleepImpl: async (ms) => {
      waited.push(ms);
      clock += ms;
    },
    onWait: (ms) => waited.push(ms),
  });

  // Each request is ~1000 tokens in and MAX_COMPLETION_TOKENS out, so two fit in a
  // minute's allowance and the third has to wait for the first to age out.
  const request = { messages: [{ role: "user", content: "x".repeat(4000) }] };
  await paced(request);
  await paced(request);
  await paced(request);
  assert.equal(sent.length, 3);
  assert.equal(sent[0], 0);
  assert.equal(sent[1], 0);
  assert.ok(sent[2] >= 60000, `the third waited for the window: ${sent[2]}`);
  assert.ok(waited.length, "and the wait was reported rather than silent");
});

test("with no allowance to respect, a call is passed straight through", async () => {
  let calls = 0;
  const paced = pipeline.createPacer({ call: async () => { calls += 1; return "ok"; } });
  await paced({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(calls, 1);
  assert.deepEqual(paced.report(), { tokensInWindow: 0, inWindow: 0 });
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

test("the cost of a lecture is counted before it is spent", () => {
  const estimate = pipeline.estimateRun({ segments: lecture(120) });
  assert.equal(estimate.windows, 10);
  assert.ok(estimate.calls >= 10, "at least one planning call per window");
  assert.ok(estimate.tokens > 10000 && estimate.tokens < 400000, `a sane estimate: ${estimate.tokens}`);
  assert.ok(estimate.tokensIn > 0 && estimate.tokensOut > 0);
});

test("a model's day is turned into a number of lectures, or admitted unknown", () => {
  const estimate = pipeline.estimateRun({ segments: lecture(60) });
  const fit = pipeline.fitsInDay(estimate, "openai/gpt-oss-120b");
  assert.ok(fit.lectures >= 1, "an hour of lecture fits in a free day");
  assert.ok(fit.minutesPerLecture >= 1);
  assert.equal(fit.tokensPerDay, 200000);
  assert.equal(pipeline.fitsInDay(estimate, "some/model-nobody-has-heard-of"), null);
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

test("a lecture becomes a document whose timestamps are the lecture's own", async () => {
  const segments = lecture(30);
  const call = fakeProvider();
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "0Q4yhrkwn7c", title: "Deep Learning, part 3", channel: "CampusX", duration: 1800 },
    call,
  });

  assert.equal(result.failure, "");
  assert.deepEqual(workspace.validateNotesDocument(result.document), []);
  assert.equal(result.document.video_id, "0Q4yhrkwn7c");
  assert.equal(result.document.video_metadata.title, "Deep Learning, part 3");

  const chapters = result.document.chapters;
  assert.ok(chapters.length >= 3, `a 30 minute lecture is more than one part: ${chapters.length}`);
  assert.ok(chapters.every((chapter) => chapter.sections.length), "and every part has notes in it");

  const sections = chapters.flatMap((chapter) => chapter.sections);
  assert.ok(sections.length >= 5, `topics, not one summary: ${sections.length}`);
  assert.ok(
    sections.every((section) => section.theory_block.explanation.includes("forget gate") || section.degraded)
  );
  assert.ok(
    sections.every((section) => section.timestamp_seconds < 1800),
    "no timestamp points past the end of the lecture"
  );
  assert.equal(result.stats.calls, result.stats.windows + sections.length, "one planning call per window, one writing call per topic");
  assert.deepEqual(call.seen.composing.length, sections.length);
});

test("a run that has already been done costs nothing the second time", async () => {
  const segments = lecture(15);
  const shared = store();
  const first = fakeProvider();
  const one = await pipeline.runLecture({
    segments,
    video: { video_id: "v1", title: "Lecture", duration: 900 },
    call: first,
    store: shared,
  });
  assert.ok(first.seen.planning.length > 0);

  const second = fakeProvider();
  const two = await pipeline.runLecture({
    segments,
    video: { video_id: "v1", title: "Lecture", duration: 900 },
    call: second,
    store: shared,
  });
  assert.equal(second.seen.planning.length, 0, "no planning call was made");
  assert.equal(second.seen.composing.length, 0, "and nothing was written again");
  assert.equal(two.stats.fromCache, one.stats.windows + one.stats.sections);
  assert.equal(two.document.chapters.length, one.document.chapters.length);
  assert.deepEqual(
    two.document.chapters.map((chapter) => chapter.chapter_title),
    one.document.chapters.map((chapter) => chapter.chapter_title)
  );
});

test("a spent daily allowance stops the run instead of spending the calls it has left", async () => {
  const segments = lecture(30);
  const call = fakeProvider({ failPlanning: "429 Too Many Requests: rate limit exceeded per day" });
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v2", title: "Lecture", duration: 1800 },
    call,
  });
  assert.equal(result.document, null);
  assert.match(result.stats.stopped, /daily allowance/);
  assert.equal(call.seen.planning.length, 1, "it did not keep asking");
  assert.equal(result.stats.calls, 1);
});

test("a planner the model mangled produces an honest page, not invented notes", async () => {
  const segments = lecture(15);
  const call = fakeProvider({ planFor: () => "I think this part is mainly about gating." });
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v3", title: "Lecture", duration: 900 },
    call,
  });
  assert.equal(result.document, null, "with nothing readable there is no document to download");
  assert.match(result.stats.stopped, /no topics could be read/);
  assert.equal(result.stats.unplannedWindows, result.stats.windows);
});

test("a window that fails while others succeed is reported in the chapter that follows it", async () => {
  const segments = lecture(30);
  let seenPlanning = 0;
  const call = fakeProvider({
    planFor: (start) => {
      seenPlanning += 1;
      if (seenPlanning === 2) throw new Error("500 Internal Server Error while reading the transcript");
      return (
        "TITLE\nThe gates\n\nSECTIONS\n" +
        `${core.clock(start)} | Forget gate | What leaves the cell.\n` +
        `${core.clock(start + 300)} | Input gate | What enters it.\n`
      );
    },
  });
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v4", title: "Lecture", duration: 1800 },
    call,
  });
  assert.equal(result.failure, "");
  const html = workspace.renderNotesHtml(result.document, { css: "" });
  assert.match(html, /could not be written up/, "the page says which stretch is missing");
  assert.match(html, /Internal Server Error/, "and quotes the real reason");
  assert.match(html, /the cell state carries long-term memory/, "while the parts that worked are there");
});

test("composing a section that fails shows the lecture's own words instead of prose", async () => {
  const segments = lecture(15);
  let written = 0;
  const call = fakeProvider({
    composerAnswer: "",
  });
  const original = call;
  const wrapped = async (request) => {
    const prompt = request.messages[0].content;
    if (/SECTIONS\n/.test(prompt) && /TITLE/.test(prompt)) return original(request);
    written += 1;
    throw new Error("429 Too Many Requests: rate limit exceeded, tokens per minute");
  };
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v5", title: "Lecture", duration: 900 },
    call: wrapped,
    options: { concurrency: 1 },
  });
  assert.equal(written > 0, true);
  const sections = result.document.chapters.flatMap((chapter) => chapter.sections);
  const degraded = sections.filter((section) => section.degraded);
  assert.ok(degraded.length, "the section is marked as a notice");
  assert.match(degraded[0].theory_block.explanation, /allowance/, "naming the real cause");
  assert.match(
    degraded[0].theory_block.explanation,
    /the gradient of the loss|hidden state/,
    "with the words that were said"
  );
  assert.ok(result.stats.degraded.length);
});

test("a silent stretch is skipped, and said to have been skipped", async () => {
  const segments = lecture(24, { captionGap: [720, 1440] });
  const call = fakeProvider();
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v6", title: "Lecture", duration: 1440 },
    call,
  });
  assert.equal(result.failure, "");
  assert.equal(result.stats.plannedWindows, 1);
  const html = workspace.renderNotesHtml(result.document, { css: "" });
  assert.match(html, /the captions are empty here/, "the quiet stretch is named");
});

test("a video with no captions at all fails before any call is made", async () => {
  const call = fakeProvider();
  const result = await pipeline.runLecture({
    segments: [],
    video: { video_id: "v7", title: "Lecture", duration: 600 },
    call,
  });
  assert.equal(result.document, null);
  assert.equal(result.stats.calls, 0);
  assert.match(result.failure, /no captions/);
});

test("stopping a run keeps the sections it had already written", async () => {
  const segments = lecture(30);
  let written = 0;
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v8", title: "Lecture", duration: 1800 },
    call: fakeProvider(),
    options: { concurrency: 1 },
    // Stop as soon as the second section has been written: what is already paid
    // for is kept, and nothing is invented for the rest.
    shouldStop: () => written >= 2,
    onEvent: (event) => {
      if (event.type === "section-done" && !event.cached) written += 1;
    },
  });
  assert.ok(result.document, "a stopped run still produces the notes it wrote");
  assert.equal(result.stats.sections, 2);
  assert.ok(result.stats.abandoned > 0);
  assert.match(result.stats.stopped, /stopped this run/);
  assert.deepEqual(workspace.validateNotesDocument(result.document), []);
  assert.match(result.stats.stopped, /stopped/);
});

test("a run that stops making progress is reported instead of hanging forever", async () => {
  const segments = lecture(15);
  // A provider that accepts the request and never answers: the shape of hang that
  // used to leave the panel spinning with nothing said.
  const call = () => new Promise(() => {});
  const began = Date.now();
  await assert.rejects(
    () =>
      pipeline.runLecture({
        segments,
        video: { video_id: "v9", title: "Lecture", duration: 900 },
        call,
        options: { stallTimeoutMs: 300 },
      }),
    /no progress for/
  );
  assert.ok(Date.now() - began < 5000, "and it gives up quickly once nothing is coming back");
});

test("a run that keeps making progress is not cut off by a fixed wall-clock cap", async () => {
  // The watchdog is reset by progress, so a slow run survives well past the
  // window that would trip it in one go. That is what a long lecture needs: the
  // eight-thousand-tokens-a-minute pacing makes an hour of lecture take far
  // longer than any flat five-minute limit would allow.
  const segments = lecture(30);
  const provider = fakeProvider();
  const slowCall = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return provider(request);
  };
  const began = Date.now();
  const result = await pipeline.runLecture({
    segments,
    video: { video_id: "v10", title: "Lecture", duration: 1800 },
    call: slowCall,
    options: { stallTimeoutMs: 150 },
  });
  assert.ok(result.document, "the run finished rather than being killed at the limit");
  assert.ok(Date.now() - began > 150, "and it really did outlast the stall window");
});

/** A store with no browser behind it, shaped like the one the panel passes in. */
function memoryStore() {
  const memory = new Map();
  return {
    get: (key, fallback) => (memory.has(key) ? memory.get(key) : fallback),
    set: (key, value) => memory.set(key, value),
    memory,
  };
}

test("the day's ledger adds up per model, and starts again on the next day", () => {
  const store = memoryStore();
  const monday = new Date(2026, 9, 20, 10, 0, 0);
  const tuesday = new Date(2026, 9, 21, 10, 0, 0);

  pipeline.recordUsage(store, "openai/gpt-oss-120b", { tokens: 50000, calls: 12 }, monday);
  pipeline.recordUsage(store, "openai/gpt-oss-120b", { tokens: 20000, calls: 4 }, monday);

  assert.deepEqual(
    {
      tokens: pipeline.usageToday(store, "openai/gpt-oss-120b", monday).tokens,
      calls: pipeline.usageToday(store, "openai/gpt-oss-120b", monday).calls,
    },
    { tokens: 70000, calls: 16 },
    "two answers are added, not replaced"
  );
  assert.equal(
    pipeline.usageToday(store, "llama-3.1-8b-instant", monday).tokens,
    0,
    "each model has its own meter"
  );
  assert.equal(
    pipeline.usageToday(store, "openai/gpt-oss-120b", tuesday).tokens,
    0,
    "a new day starts from zero"
  );
});

test("a lecture that cannot finish today is refused before anything is spent", () => {
  const store = memoryStore();
  const now = new Date(2026, 9, 20, 10, 0, 0);
  const estimate = pipeline.estimateRun({ segments: lecture(240) });

  // Almost a full day already gone, so a four-hour lecture no longer fits.
  pipeline.recordUsage(store, "openai/gpt-oss-120b", { tokens: 160000, calls: 60 }, now);
  const allowance = pipeline.allowanceFor({
    estimate,
    model: "openai/gpt-oss-120b",
    store,
    now,
  });

  assert.equal(allowance.fits, false, "the run is refused");
  assert.ok(allowance.shortBy > 0, "and the shortfall is a number, not a shrug");
  assert.equal(allowance.tokensLeft, 40000);

  const elsewhere = pipeline.modelsThatFit({ estimate, store, exclude: "openai/gpt-oss-120b", now });
  assert.ok(elsewhere.length > 0, "a roomier model is offered instead");
  assert.ok(
    elsewhere.every((option) => option.tokensLeft >= allowance.needTokens),
    "and every one of them really can hold the lecture"
  );
});

test("a model the provider has already refused today is not tried again", () => {
  const store = memoryStore();
  const now = new Date(2026, 9, 20, 10, 0, 0);
  const estimate = pipeline.estimateRun({ segments: lecture(15) });

  pipeline.recordUsage(store, "openai/gpt-oss-120b", { exhausted: true }, now);
  const allowance = pipeline.allowanceFor({
    estimate,
    model: "openai/gpt-oss-120b",
    store,
    now,
  });

  assert.equal(allowance.fits, false, "even a tiny lecture is refused");
  assert.equal(allowance.exhausted, true);
  assert.ok(allowance.tokensLeft > 0, "although its token counter still has room");
});

test("an unknown model is not gated on a guessed limit", () => {
  const store = memoryStore();
  const estimate = pipeline.estimateRun({ segments: lecture(15) });
  assert.equal(
    pipeline.allowanceFor({ estimate, model: "some/new-model", store }),
    null,
    "no limit is invented for it"
  );
});


