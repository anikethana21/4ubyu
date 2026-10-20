/**
 * The ported pipeline's guarantees, held by tests that need no network at all.
 *
 * The Python version earned four properties that are worth as much as the notes
 * themselves: one call per section, a tolerant read of the answer, an honest
 * notice naming the real cause, and the instruction never to invent content to
 * cover a failure. Re-earning them here is the point of this file — the browser
 * has no pytest and a much slower loop, so the behaviour is pinned in Node before
 * anything is wired into a page.
 *
 * Run: node --test tests/js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ubyu = require("../../extension/src/core.js");

const LECTURE =
  "Recurrent neural networks carry a hidden state from one timestep to the next. " +
  "That hidden state is what lets the network remember earlier words in the sentence. ".repeat(
    60
  );

const GOOD_ANSWER =
  "**EXPLANATION**\n" +
  "The hidden state is carried across timesteps, which is precisely what lets the network " +
  "remember earlier words instead of seeing each word in isolation.\n\n" +
  "ANALOGY\nA rolling snowball that grows as it travels downhill.\n\n" +
  "### KEY POINTS\n" +
  "- the hidden state carries information forward\n" +
  "- the same weights are reused at every timestep\n" +
  "- the state is bounded, so long sequences fade\n\n" +
  "PITFALLS\n" +
  "- treating h_t and h_{t-1} as the same thing -> keep the timestep explicit\n\n" +
  "EXAMPLE\n" +
  '- the sentence "Riya is a doctor", which has four words\n';

const DAILY_LIMIT =
  "Groq tokens per day (TPD) Rate Limit (429). " +
  '{"error":{"message":"Rate limit reached for model on tokens per day (TPD): Limit ' +
  '200000, Used 198971, Requested 2265","type":"tokens","code":"rate_limit_exceeded"}}';

const MINUTE_LIMIT = 'Groq tokens per minute (TPM) Rate Limit (429). {"code":"rate_limit_exceeded"}';

const TOO_LARGE =
  "Groq API Error 413: request too large. " +
  '{"error":{"message":"Request too large for model on tokens per minute (TPM): ' +
  'Limit 8000, Requested 8240","code":"rate_limit_exceeded"}}';

/** A fetch that records what was asked and answers from a table. */
function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const reply = handler(body, calls.length);
    return {
      status: reply.status,
      text: async () => reply.text,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function groqPayload(content, extra = {}) {
  return JSON.stringify({
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { completion_tokens: 120 },
    ...extra,
  });
}

/** A `call` for composeSection that records the prompts it was given. */
function fakeCall(behaviour) {
  const prompts = [];
  const call = async ({ messages }) => {
    const prompt = messages[0].content;
    prompts.push(prompt);
    return behaviour(prompts.length, prompt);
  };
  call.prompts = prompts;
  return call;
}

// ---------------------------------------------------------------------------
// Reading a refusal
// ---------------------------------------------------------------------------

test("the three quotas are told apart, because they need different answers", () => {
  assert.equal(ubyu.isRequestTooLarge(TOO_LARGE), true);
  assert.equal(ubyu.isRateLimit(TOO_LARGE), false, "sending less is the fix, not waiting");
  assert.equal(ubyu.isDailyLimit(TOO_LARGE), false);

  assert.equal(ubyu.isDailyLimit(DAILY_LIMIT), true);
  assert.equal(ubyu.isRateLimit(DAILY_LIMIT), false, "a day does not refill in a minute");
  assert.equal(ubyu.isRequestTooLarge(DAILY_LIMIT), false);

  assert.equal(ubyu.isRateLimit(MINUTE_LIMIT), true);
  assert.equal(ubyu.isDailyLimit(MINUTE_LIMIT), false);
});

test("a daily quota is not advised as a minute-long wait", () => {
  assert.match(ubyu.describeFailure(DAILY_LIMIT), /daily token allowance/);
  const advice = ubyu.adviseOnFailure(DAILY_LIMIT);
  assert.match(advice, /resets tomorrow/);
  assert.doesNotMatch(advice, /Wait about a minute/);

  assert.match(ubyu.describeFailure(MINUTE_LIMIT), /per-minute token allowance/);
  assert.match(ubyu.adviseOnFailure(MINUTE_LIMIT), /Wait about a minute/);
});

test("an empty failure is reported as empty, not as a missing model", () => {
  assert.equal(ubyu.describeFailure(""), "the provider returned nothing usable");
  assert.equal(ubyu.describeFailure("   "), "the provider returned nothing usable");
});

test("a refusal with no recognisable cause keeps the provider's own words", () => {
  assert.match(ubyu.describeFailure("upstream Boom 500"), /upstream Boom 500/);
  assert.ok(ubyu.describeFailure("x".repeat(500)).length <= 200, "but not the whole payload");
});

// ---------------------------------------------------------------------------
// The excerpt a section is written from
// ---------------------------------------------------------------------------

test("a short transcript is used as it is", () => {
  assert.equal(ubyu.balancedExcerpt("a short lecture", 100), "a short lecture");
});

test("a long transcript keeps its head, middle and end, and says where the seams are", () => {
  const transcript = Array.from({ length: 600 }, (unused, index) => `word${index}`).join(" ");
  const excerpt = ubyu.balancedExcerpt(transcript, 900);

  assert.ok(excerpt.length <= 900 + 80, `an excerpt must stay near its budget: ${excerpt.length}`);
  assert.match(excerpt, /word0\b/, "the opening is kept");
  assert.match(excerpt, /\[mid-lecture excerpt\]/);
  assert.match(excerpt, /\[late-lecture excerpt\]/);
  assert.match(excerpt, /word599\b/, "the conclusion is kept, because conclusions are the point");
});

// ---------------------------------------------------------------------------
// Reading the model's answer
// ---------------------------------------------------------------------------

test("headings are recognised however the model decorated them", () => {
  const blocks = ubyu.splitLabeledBlocks(GOOD_ANSWER);
  assert.match(blocks["EXPLANATION"], /hidden state is carried across timesteps/);
  assert.match(blocks["ANALOGY"], /snowball/);
  assert.match(blocks["KEY POINTS"], /carries information forward/);
  assert.match(blocks["PITFALLS"], /h_\{t-1\}/);
  assert.match(blocks["EXAMPLE"], /Riya is a doctor/);
});

test("every decoration a model uses for a heading is read as one", () => {
  const headings = [
    ["EXPLANATION", "EXPLANATION"],
    ["EXPLANATION:", "EXPLANATION"],
    ["**EXPLANATION**", "EXPLANATION"],
    ["**EXPLANATION:**", "EXPLANATION"],
    ["### Explanation", "EXPLANATION"],
    ["> **EXPLANATION:**", "EXPLANATION"],
    ["## KEY POINTS", "KEY POINTS"],
    ["Key-Points", "KEY POINTS"],
    ["**Key Points:**", "KEY POINTS"],
  ];

  for (const [heading, label] of headings) {
    const blocks = ubyu.splitLabeledBlocks(`${heading}\nthe body of the section\n`);
    assert.equal(
      (blocks[label] || "").trim(),
      "the body of the section",
      `${heading} was not read as a heading`
    );
  }
});

test("prose that merely mentions a heading is not a heading", () => {
  const answer = "This explanation of the KEY POINTS idea is not a heading at all.\n";
  const blocks = ubyu.splitLabeledBlocks(answer);
  assert.deepEqual(Object.keys(blocks), [""], "it must stay one unnamed block");
});

test("an answer with no headings at all is still kept", () => {
  const notes = ubyu.parseComposition("The hidden state is a running summary of the sentence so far. ".repeat(5));
  assert.match(notes.explanation, /running summary/);
  assert.deepEqual(notes.key_points, []);
});

test("lists are read with or without bullets, and NONE means none", () => {
  const notes = ubyu.parseComposition(GOOD_ANSWER);
  assert.equal(notes.key_points.length, 3);
  assert.equal(notes.key_points[0], "the hidden state carries information forward");
  assert.equal(notes.pitfalls.length, 1);
  assert.equal(notes.examples.length, 1);

  const blank = ubyu.parseComposition("EXPLANATION\nThe lecture was about gating the state. ".repeat(6) + "\n\nPITFALLS\nNONE\n\nEXAMPLE\nNONE\n");
  assert.deepEqual(blank.pitfalls, []);
  assert.deepEqual(blank.examples, []);
});

test("a numbered list a model wrote is read by its numbers", () => {
  const items = ubyu.numberedItems("**1. The Hidden State**\n### 2) Gating\n3 - Backpropagation through time\n2. A second answer for two\n");
  assert.equal(items[1], "The Hidden State");
  assert.equal(items[2], "Gating", "the first answer for a number wins");
  assert.equal(items[3], "Backpropagation through time");
});

// ---------------------------------------------------------------------------
// One call per section, and never a word the instructor did not say
// ---------------------------------------------------------------------------

test("a section is written from one call", async () => {
  const call = fakeCall(() => GOOD_ANSWER);
  const notes = await ubyu.composeSection(
    { title: "Gating the hidden state", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call }
  );

  assert.equal(call.prompts.length, 1, "five agents asking the same excerpt was the old cost");
  assert.equal(notes.degraded, false);
  assert.match(notes.explanation, /carried across timesteps/);
  assert.match(call.prompts[0], /Section: "Gating the hidden state"/);
});

test("no model is said to be missing, in those words, and nothing is invented", async () => {
  const notes = await ubyu.composeSection(
    { title: "Gating", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call: null }
  );

  assert.equal(notes.degraded, true);
  assert.match(notes.explanation, /could not be written up/);
  assert.match(notes.explanation, /no model was available/);
  assert.match(notes.explanation, /hidden state is what lets the network/, "the lecture is quoted instead");
  assert.deepEqual(notes.key_points, []);
});

test("an oversized request is retried with less context", async () => {
  const call = fakeCall((attempt) => {
    if (attempt === 1) throw new Error(TOO_LARGE);
    return GOOD_ANSWER;
  });

  const notes = await ubyu.composeSection(
    { title: "Gating", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call }
  );

  assert.equal(notes.degraded, false);
  assert.equal(call.prompts.length, 2);
  assert.ok(call.prompts[1].length < call.prompts[0].length, "the retry must send less");
});

test("a spent daily allowance is not retried with less context", async () => {
  const call = fakeCall(() => {
    throw new Error(DAILY_LIMIT);
  });

  const notes = await ubyu.composeSection(
    { title: "Gating", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call }
  );

  assert.equal(call.prompts.length, 1, "sending less cannot help a metered day");
  assert.match(notes.explanation, /daily token allowance/);
  assert.match(notes.explanation, /Retrying in a minute will not help/);
});

test("an empty answer is not reported as a missing model", async () => {
  const notes = await ubyu.composeSection(
    { title: "Gating", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call: fakeCall(() => "   \n  ") }
  );

  assert.match(notes.explanation, /empty answer/);
  assert.doesNotMatch(notes.explanation, /no model was available/);
});

test("an answer too short to be notes is reported as too short", async () => {
  const notes = await ubyu.composeSection(
    { title: "Gating", chapterTitle: "Recurrent Networks", transcript: LECTURE },
    { call: fakeCall(() => "EXPLANATION\nIt is about gates.\n") }
  );

  assert.equal(notes.degraded, true);
  assert.match(notes.explanation, /too short to be usable/);
  assert.doesNotMatch(
    notes.explanation,
    /did not succeed/,
    "the call did succeed; it just came back with too little to be notes"
  );
});

// ---------------------------------------------------------------------------
// Talking to the provider
// ---------------------------------------------------------------------------

test("a caller needs a key, and says so by not existing", () => {
  assert.equal(ubyu.createCaller({ apiKey: "" }), null);
  assert.equal(ubyu.createCaller({ apiKey: "   " }), null);
  assert.ok(ubyu.createCaller({ apiKey: "gsk_x", fetchImpl: async () => null }));
});

// ---------------------------------------------------------------------------
// Which models this key can use
// ---------------------------------------------------------------------------

/** A fetch that answers the models endpoint, for listModels. */
function modelsFetch(status, body) {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push({ url, method: options.method, authorization: options.headers.Authorization });
    return { status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
  fetchImpl.asked = asked;
  return fetchImpl;
}

test("the models offered are the ones this key has, asked of the provider", async () => {
  const fetchImpl = modelsFetch(200, {
    object: "list",
    data: [
      { id: "openai/gpt-oss-120b", active: true, context_window: 131072, max_completion_tokens: 32766 },
      { id: "llama-3.1-8b-instant", active: true, context_window: 131072 },
      { id: "retired-model", active: false },
      { object: "model" },
    ],
  });
  const models = await ubyu.listModels({ apiKey: "gsk_test", fetchImpl });
  assert.deepEqual(models.map((model) => model.id), ["openai/gpt-oss-120b", "llama-3.1-8b-instant"],
    "a retired model is not offered, and an entry with no id is not a model");
  assert.equal(models[0].contextWindow, 131072);
  assert.equal(models[0].maxCompletionTokens, 32766);
  assert.equal(fetchImpl.asked.length, 1);
  assert.match(fetchImpl.asked[0].url, /\/openai\/v1\/models$/);
  assert.equal(fetchImpl.asked[0].method, "GET");
  assert.equal(fetchImpl.asked[0].authorization, "Bearer gsk_test");
});

test("a rejected key is found out here, before any notes are paid for", async () => {
  const fetchImpl = modelsFetch(401, { error: { message: "Invalid API Key" } });
  await assert.rejects(() => ubyu.listModels({ apiKey: "gsk_bad", fetchImpl }), /rejected this API key/);
  await assert.rejects(
    () => ubyu.listModels({ apiKey: "gsk_bad", fetchImpl: modelsFetch(200, { data: [] }) }),
    /no usable models/
  );
  await assert.rejects(() => ubyu.listModels({ apiKey: "" }), /No API key/);
});

test("a provider that cannot be reached is reported as unreachable", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  await assert.rejects(() => ubyu.listModels({ apiKey: "k", fetchImpl }), /Could not reach Groq/);
  const nonsense = modelsFetch(200, "<html>not json</html>");
  await assert.rejects(() => ubyu.listModels({ apiKey: "k", fetchImpl: nonsense }), /not JSON/);
});

test("an answer is taken from the response and handed back as written", async () => {
  const fetchImpl = recordingFetch(() => ({ status: 200, text: groqPayload("the notes") }));
  const caller = ubyu.createCaller({ apiKey: "k", fetchImpl });

  const answer = await caller.call({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(answer, "the notes");
  assert.equal(fetchImpl.calls[0].body.model, "openai/gpt-oss-120b");
  assert.equal(
    fetchImpl.calls[0].body.max_completion_tokens,
    ubyu.MAX_COMPLETION_TOKENS,
    "a reasoning model needs room for the answer as well as the reasoning"
  );
});

test("what the provider billed is reported as it arrives", async () => {
  const seen = [];
  const fetchImpl = recordingFetch(() => ({
    status: 200,
    text: groqPayload("the notes", { usage: { prompt_tokens: 900, completion_tokens: 120 } }),
  }));
  const caller = ubyu.createCaller({
    apiKey: "k",
    fetchImpl,
    onUsage: (entry) => seen.push(entry),
  });

  await caller.call({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(seen.length, 1, "one answer, one billing report");
  assert.equal(seen[0].model, "openai/gpt-oss-120b");
  assert.equal(seen[0].usage.prompt_tokens, 900);
  assert.equal(seen[0].usage.completion_tokens, 120);
});

test("a meter that throws does not turn a good answer into a failure", async () => {
  const fetchImpl = recordingFetch(() => ({ status: 200, text: groqPayload("the notes") }));
  const caller = ubyu.createCaller({
    apiKey: "k",
    fetchImpl,
    onUsage: () => {
      throw new Error("the ledger is full");
    },
  });

  assert.equal(
    await caller.call({ messages: [{ role: "user", content: "hello" }] }),
    "the notes",
    "bookkeeping is not allowed to break a call"
  );
});

test("an empty 200 is a refusal that names the budget, not a silent empty answer", () => {
  assert.throws(
    () =>
      ubyu.answerFromResponse(
        {
          payload: {
            choices: [{ message: { content: "" }, finish_reason: "length" }],
            usage: { completion_tokens: 3072, completion_tokens_details: { reasoning_tokens: 3072 } },
          },
        },
        "openai/gpt-oss-120b"
      ),
    /finish_reason=length.*reasoning_tokens=3072/s
  );
});

test("a daily limit is not waited out, and the lighter model is tried instead", async () => {
  const slept = [];
  const fetchImpl = recordingFetch(() => ({
    status: 429,
    text: '{"error":{"message":"Rate limit reached on tokens per day (TPD)","code":"rate_limit_exceeded"}}',
  }));
  const caller = ubyu.createCaller({
    apiKey: "k",
    fetchImpl,
    sleepImpl: async (ms) => slept.push(ms),
  });

  await assert.rejects(
    () => caller.call({ messages: [{ role: "user", content: "hello" }] }),
    /tokens per day \(TPD\)/
  );

  assert.deepEqual(slept, [], "waiting out a day is time spent to arrive at the same refusal");
  assert.deepEqual(
    fetchImpl.calls.map((entry) => entry.body.model),
    ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    "the lighter model is metered separately, so it is worth a try"
  );
});

test("a per-minute limit is waited out, then the lighter model is tried", async () => {
  const slept = [];
  const fetchImpl = recordingFetch((body) =>
    body.model === "openai/gpt-oss-20b"
      ? { status: 200, text: groqPayload("the notes from the lighter model") }
      : { status: 429, text: MINUTE_LIMIT }
  );
  const caller = ubyu.createCaller({
    apiKey: "k",
    fetchImpl,
    sleepImpl: async (ms) => slept.push(ms),
  });

  const answer = await caller.call({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(answer, "the notes from the lighter model");
  assert.deepEqual(slept, [6000, 20000], "a minute's allowance needs time to refill");
});

test("a rejected key is named as a rejected key", async () => {
  const fetchImpl = recordingFetch(() => ({ status: 401, text: '{"error":"invalid_api_key"}' }));
  const caller = ubyu.createCaller({ apiKey: "k", fetchImpl });

  await assert.rejects(
    () => caller.call({ messages: [{ role: "user", content: "hello" }] }),
    /rejected the API key \(401\)/
  );
});

test("a request the meter cannot fit is reported in a way the caller can act on", async () => {
  const fetchImpl = recordingFetch(() => ({ status: 413, text: '{"error":"too large"}' }));
  const caller = ubyu.createCaller({ apiKey: "k", fetchImpl });

  await assert.rejects(
    () => caller.call({ messages: [{ role: "user", content: "hello" }] }),
    /too large/
  );
});

test("an unreachable provider is reported as unreachable, not as bad notes", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  const caller = ubyu.createCaller({ apiKey: "k", fetchImpl });

  await assert.rejects(
    () => caller.call({ messages: [{ role: "user", content: "hello" }] }),
    /Could not reach the provider/
  );
});

// ---------------------------------------------------------------------------
// Running a chapter
// ---------------------------------------------------------------------------

test("a chapter's sections are written with a bounded number of calls in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  const call = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return GOOD_ANSWER;
  };

  const sections = Array.from({ length: 9 }, (unused, index) => ({
    title: `Section ${index + 1}`,
    transcript: LECTURE,
  }));
  const written = await ubyu.writeChapter({ title: "Recurrent Networks", sections }, { call, concurrency: 3 });

  assert.equal(written.sections.length, 9);
  assert.equal(written.degraded.length, 0);
  assert.ok(peak <= 3, `at most three calls at once, saw ${peak}`);
});

test("a chapter reports which of its sections are missing rather than staying quiet", async () => {
  const call = fakeCall(() => {
    throw new Error(DAILY_LIMIT);
  });

  const written = await ubyu.writeChapter(
    {
      title: "Recurrent Networks",
      sections: [
        { title: "Gating", transcript: LECTURE },
        { title: "Backprop through time", transcript: LECTURE },
      ],
    },
    { call, concurrency: 1 }
  );

  assert.deepEqual(written.degraded, ["Gating", "Backprop through time"]);
});

// ---------------------------------------------------------------------------
// Working on a real captured lecture
// ---------------------------------------------------------------------------

const FIXTURE = path.join(
  __dirname,
  "..",
  "..",
  "storage",
  "ingest",
  "a3b72fed-6e36-4ae6-baae-001c297fce9e.json"
);

test("a real captured lecture can be sliced into a chapter window", (t) => {
  if (!fs.existsSync(FIXTURE)) {
    t.skip("the captured transcript fixture is not on this machine");
    return;
  }
  const record = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const segments = record.payload.timed_transcript;
  assert.ok(segments.length > 1000, "the capture holds a whole lecture");

  const text = ubyu.segmentsToText(segments, 7020, 7740);

  assert.ok(text.length > 5000, `a twelve-minute window is a real passage: ${text.length}`);
  assert.match(text, /[a-z]{3,} [a-z]{3,}/, "and it reads as English, not as fragments");
  assert.ok(!text.includes("\n"), "captions are joined into prose, not left as lines");
  assert.equal(ubyu.clock(7740), "2:09:00");
  assert.equal(ubyu.clock(754), "12:34");
});
