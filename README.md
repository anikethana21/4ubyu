# 4 U By U

> **Turn the YouTube lecture you are already watching into a chapterised study handbook.**
> In your own browser. With your own API key. Saved as one HTML page.
> No server, no account, no upload, no database — and nothing to sign up for.

**Install it:** [anikethana21.github.io/4ubyu](https://anikethana21.github.io/4ubyu/) — one click, and it
updates itself from that page afterwards.

Open a lecture on YouTube, press **✦ Make notes** in the corner, paste a free API key once, and the lecture
comes back as a handbook: chapters divided **by topic** (not by equal slices of the clock), a summary of what
each part is about, the points worth keeping, the mistakes to avoid, and timestamps that jump to the exact
minute in the video. The result is a single self-contained HTML file you can keep, search, print, or save as
a PDF in one click.

It runs entirely in your browser. The captions are read from the page you are already on, the notes are
written by a model you choose and pay for with your own key, and the page opens from your own disk. There is
no backend of ours to go down, no ingest token to leak, and no service that can stop the product working.

---

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [What it costs](#what-it-costs-before-it-is-spent)
- [The decisions that mattered](#the-decisions-that-mattered)
- [What it will not do](#what-it-will-not-do)
- [Install](#install)
- [Development](#development)
- [Tests](#tests)
- [Security and privacy](#security-and-privacy)
- [Repository layout](#repository-layout)

---

## What it does

| | |
|---|---|
| **Chapters by topic** | A two-hour lecture is read in twelve-minute stretches, and each stretch is asked *what is this about, and where does each topic begin*. Chapters are the topics the lecturer actually taught, with their own titles in the lecturer's own terms. |
| **Notes, not a transcript** | Each topic gets one written explanation, an analogy, key points, pitfalls, and an example. LaTeX in the explanation is stripped to readable text rather than left as noise. |
| **Timestamps that work** | Every chapter and section timestamp is a real link to `youtube.com/watch?v=…&t=…`, opening in a new tab. When you render the page with the player, they scroll the video instead. |
| **One file you own** | The notes are a plain document; the page is a rendering of it. The page carries its own stylesheet, font and scripts — **zero external requests** — so it still works in ten years, offline, on a laptop with no network. |
| **PDF in one click** | *Save as PDF* in the page uses the browser's own printer with a `@media print` stylesheet. No PDF library, no file-size inflation, no second program. |
| **A floating index, a reading column** | The contents are a glass panel pinned to the left of the page — one floating column, not a strip above the text. It tracks where you are as you scroll, and the notes read in their own column beside it. On a narrow screen the index moves above the notes and the page becomes one column. |
| **A library that costs nothing to reopen** | Every finished lecture is kept in your script manager's storage. Drawing the page again — next week, on another machine, in a different shape — costs **zero** model calls. |
| **Free-tier honest** | More than 8,000 tokens a minute cannot be sent to a free tier, so a run is paced rather than refused, and the panel tells you how many lectures of this size the model's day holds *before* you spend anything. |

## How it works

```text
  YouTube page (captions, player data, description chapters)
        │   read in the page, never uploaded
        ▼
  twelve-minute windows ──► one planning call each ──► topics with start times
        │                                                   │
        │  (a window with chapters of its own in the        │
        │   description uses those as its chapter)          ▼
        │                                    one writing call per topic
        ▼                                                   │
  notes document  { video metadata, chapters[], sections[] }─┘
        │   the document is the data; the page is a rendering of it
        ▼
  one self-contained HTML page  ──►  your disk  ──►  print to PDF
```

The split in the source follows the split in the risk:

| Where | What lives there | How it is checked |
|---|---|---|
| `extension/src/core.js` | Reading a model's answer, refusing to invent, classifying every failure, the composer and the writer, the provider caller | `npm test`, no browser, no key, no network |
| `extension/src/pipeline.js` | Windowing, the planner prompt and parser, topic boundaries, the pacer, the estimate, the resumable run | `npm test`, with a stand-in model whose answers are wrong in specific ways |
| `extension/src/workspace.js`, `markdown.js` | The notes document's schema, the page, the print stylesheet, LaTeX-to-text | `npm test` against the page's markup |
| `extension/src/panel.js` | The key, the model list, the cost, the progress, the download. Draws and reports; decides nothing about content | driven in a browser harness (`dev/panel-harness.html`) with a stand-in lecture and provider |
| `extension/userscript.js` | Reading YouTube's own player data and captions — the only part that cannot be tested anywhere but YouTube | `npm run try` against a saved transcript, plus use |

The userscript is built from those files by `node extension/build.js`: the same modules the tests ran, folded
into one file. The Chrome extension is the *same program* with three script-manager functions swapped for
browser ones. A fix in the pipeline therefore reaches both builds, and cannot reach one without the other.

## What it costs, before it is spent

The panel shows, before you press Generate: how many parts of the lecture will be read, how many calls that
is, roughly how many tokens, and — for a model whose free-tier numbers are known — **how many lectures this
size the model's day holds**, and roughly how long each takes.

Groq's free tier meters tokens per minute, and a two-hour lecture is far more than one minute's worth. So the
run is *paced*: each request's tokens are estimated, the minute's allowance is kept in view, and the run waits
rather than tripping a 429 and losing everything. A 429 that happens anyway is classified — a per-minute
allowance refills, a daily one does not — and the advice differs accordingly.

Numbers are never invented: they come from the same function the panel displays (`estimateRun`, `fitsInDay`),
so the estimate and the run cannot disagree about what a lecture costs.

### The limits, stated plainly

There is no cap on video length in the app. The real limit is the model's **daily token allowance**. Measured
with the shipped estimator (`estimateRun`) against captions at ~150 words per minute:

| Lecture | Parts | Calls | Tokens | Wall clock at 8k/min | Fits in one day |
|---|---|---|---|---|---|
| 15 min | 2 | 8 | 13k | ~7 min | 15 |
| 30 min | 3 | 12 | 23k | ~11 min | 8 |
| 1 hour | 5 | 20 | 42k | ~18 min | 4 |
| 2 hours | 10 | 40 | 85k | ~35 min | 2 |
| 4 hours | 20 | 80 | 170k | ~70 min | 1, with little headroom |
| 6 hours | 30 | 90 | 255k | ~104 min | 0 — over 200k/day |

On Groq's free tier, per model: **8,000 tokens/minute**, **1,000 requests/day**, **200,000 tokens/day**
(`gpt-oss` models and `openai/gpt-oss-safeguard-20b`) — except `llama-3.1-8b-instant` and `qwen/qwen3-32b`,
which allow **500,000 tokens/day** at 6,000/minute. So a six-hour lecture fits on one of those, not on the
default model.

Context is not a limit: the transcript is read in twelve-minute parts, so no single request ever holds the
whole lecture. Requests are not a limit either — four hours is 80 calls against a thousand.

### English captions only

The notes are written in English, from English captions. This is a deliberate limit, not an oversight: the
prompts, the chapter schema, the notice wording and the failure messages are all English, and a lecture in
another script produced mixed-language notes that were worse than none. So the app checks the captions
**before the first API call** and, if fewer than 70% of the letters are Latin, stops with:

> *This lecture's captions are not in English (only 4% of the letters are Latin). 4ubyu writes English notes
> from English captions, so it will not spend a call on this one. Use a lecture with English captions, or turn
> on YouTube's auto-translated English captions and try again.*

What that check does and does not catch:

| Captions | Result |
|---|---|
| English, including auto-generated | works |
| Hindi, Arabic, Chinese, Japanese, Korean, Russian, Greek, Hebrew, Thai | refused before spending, with the real percentage shown |
| French, Spanish, German, Portuguese, Italian, Turkish, Vietnamese (Latin script) | **not detected** — the check passes, and the notes will be written in English from non-English captions, which usually reads badly |

The reason for the last row is that the check measures script, not language: a Latin-script lecture is
indistinguishable from English by counting letters. There is no offline language classifier in the build, and
adding one would mean shipping a model file, which the no-dependency rule forbids. If you study in a
Latin-script language, translate the captions to English first (YouTube can do this on the video page) and the
notes will be written from that track.

### It stops before it spends, not after

The day's use is written down as it happens, from the provider's own `usage` figures on every answer, in
`usage-v1` next to your notes. Before a run starts, the panel compares that ledger with the estimate:

- if the lecture fits, it runs;
- if it does not, **Generate is disabled** and the panel says how much is left, how much the lecture needs,
  and which other models still have room — with a one-click switch to one of them;
- if the provider has already refused a model for the day, that is remembered, so the next click does not
  spend a call to hear the same refusal.

The ledger is not a mirror of your provider account: anything spent in another tab, another tool, or on
groq.com is invisible to it. It is there to warn *before* spending, and the provider's own 429 remains the
final word. A run that stops at the daily limit keeps every section already written, so it continues from
there tomorrow rather than starting again.

The model list is ordered **best first** — the models that reliably write a long, structured chapter at the
top, marked *best for notes* — rather than in the alphabetical order the provider returns. Transcription and
embedding endpoints, which cannot write a chapter at all, are not offered. A model this build has not seen is
placed by the parameter count in its id.

## The decisions that mattered

1. **Chapters come from topics, not from the clock.** Splitting a lecture every ten minutes produces headings
   like *10:00–20:00*. Asking what each stretch is about produces headings like *Why the loss is a surface*.
2. **A timestamp the model invented is dropped, never clamped.** Sending a reader to the wrong minute of a
   two-hour video is worse than leaving a heading out. Topics closer together than thirty seconds are merged
   into the one before them; a topic that begins a window is pinned to that window's start.
3. **Nothing is ever fabricated.** When a part cannot be written up, the page says so in words — with the
   provider's own reason, and with the class of the failure kept apart, because *"there are no captions here"*,
   *"the model's answer could not be read"* and *"the day's allowance is spent"* are not the same thing to the
   person who asked.
4. **Resumable by default.** Every planned window and every written section is stored under its own key. A rate
   limit, a closed tab or a flat battery costs the wait, not the work. Stopping a run keeps what was written
   and drops the rest, rather than filling the page with apologies for itself.
5. **The artifact is HTML, and PDF is one click.** A PDF library would inflate a 300 KB page and duplicate the
   browser's own good printer. The page is the artifact; the PDF is a rendering of it.
6. **The model list is asked of the provider, never written down.** A hardcoded list is a guess about someone
   else's service: stale the week a model retires, blind to what your key is entitled to, and happy to offer
   models that answer 404. One request with your key returns exactly your models — and doubles as the test that
   the key works, before any notes are paid for.
7. **Nothing external may block the product.** No font CDN, no CSS `@import`, no external script, no embed, no
   store review, no server. The extractor that lifts the page's stylesheet *fails the build* if any `http(s)://`
   survives in it, so a remote dependency cannot creep back in unnoticed.
8. **The interesting logic is testable without a browser.** Everything that decides what the notes say is a
   plain function. The parts that could only be tested on YouTube are kept as thin and as few as possible.

## What it will not do

- It will not write notes for a lecture that has no captions; it says so, and says to open the transcript
  panel once.
- It will not make a free tier behave like a paid one. A long lecture on 8,000 tokens a minute takes as long
  as it takes, and the panel says how long that is.
- It will not hide a failure behind plausible-looking prose. That is the one thing the whole `core.js` is
  organised around.

## Install

**Userscript (recommended).** Install [Tampermonkey](https://www.tampermonkey.net/) or
[Violentmonkey](https://violentmonkey.github.io/), then open
[anikethana21.github.io/4ubyu](https://anikethana21.github.io/4ubyu/) and press *Install*. The script carries
an `@updateURL`, so it keeps itself current from that page.

**Chrome extension.** `npm run build` writes `extension/dist/store/` (a Manifest V3 package: one content
script, one service worker, `storage` and the provider's address as its only permissions). `npm run package`
zips it for the store. The store fee is the only part of this that costs money, so it is deferred; the
userscript is the same program.

## Development

```bash
npm install                 # nothing to install, but this is the habit
npm test                    # 128 JS tests: core, page, pipeline, built artifacts
npm run assets              # regenerate src/assets.js from templates/base_workspace.html
npm run assets:check        # fail if the page's stylesheet has drifted (or gained a remote URL)
npm run build               # write 4ubyu.user.js and extension/dist/store/
npm run build:check         # fail if either build is out of date

npm run try                 # a whole lecture through the pipeline with a stand-in model, no key, no cost
npm run run -- --key gsk_…  # the same, for real, with your key
npm run render -- extension/dev/out/notes-*.json   # draw a saved document, zero model calls
npm run serve               # http://127.0.0.1:8787/ — the generated pages, and the harness at /dev/panel-harness.html
```

`extension/dev/panel-harness.html` is the demo without the cost: it loads the same `src/*.js` the userscript
is built from, hands the panel a made-up 45-minute lecture and a stand-in provider that answers in Groq's
shape, and lets you drive the whole thing — key, model list, estimate, run, progress, download, library — with
no key and no network.

## Tests

```bash
npm test                                              # 106 JavaScript tests
python -X utf8 -m pytest tests -q                     # 98 Python tests (the frozen reference pipeline)
```

The JavaScript suite includes tests that load the **built** userscript and the **built** content script in a
stand-in page, because the failure mode this project kept hitting was a fix that passed its unit test and
never reached the file a user installs.

## Security and privacy

- **No server, no account, no database.** Nothing about you or your lectures is sent anywhere except the
  provider you chose, with the key you pasted, for the notes you asked for.
- **Your key is stored by your script manager** in your browser, like any other userscript setting. It is
  never sent to us, because there is no "us" on the network to send it to.
- **No third-party code, fonts, analytics or CDNs** — in the app or in the pages it produces. `npm run
  assets:check` fails the build if a remote URL appears in the page's stylesheet.
- **No claims of being unhackable.** No software is. What is true here is narrower and checkable: the program
  is one readable file, it asks for the smallest permission set that works, and every note on the page can be
  traced back to the words it came from.

## Repository layout

```text
4ubyu.user.js              the built userscript — what gets installed (generated; do not edit)
index.html                 the install page served by GitHub Pages
extension/
  userscript.js            the userscript's shell: header, storage, YouTube capture, bootstrap
  build.js                 folds src/*.js into the userscript and the extension package
  src/                     core.js · pipeline.js · workspace.js · markdown.js · panel.js · assets.js
  dev/                     run.js · render.js · serve.js · panel-harness.html
  dist/store/              the built Manifest V3 extension package (generated)
tests/js/                  the JavaScript suite, including tests of the built artifacts
core/, api/, scripts/, …   the original server-side prototype: FastAPI, LangGraph, pgvector
templates/, static/        the workspace page the notes page's stylesheet was lifted from
docs/server-prototype.md   that prototype's README, kept for the record
```

The server-side prototype is **frozen**: it still runs, its 98 tests still pass, and it is the reference the
browser pipeline was ported from and the source of many of the tests. It is no longer the product, because a
product that needs a server, a database and an ingest token is a product that can be blocked, rate-limited, or
switched off — and this one cannot.

## Licence

MIT.
