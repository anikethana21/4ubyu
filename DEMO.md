# DEMO — one lecture, one click, real chapters

This walks you through the **hybrid ingestion path** end to end on your own
machine: the transcript is captured in *your* browser (your residential IP,
where YouTube does not bot-gate), and the server never touches YouTube.

---

## What you will see

1. You open a YouTube lecture you are already watching.
2. A floating **Generate Study Notes** button appears bottom-right.
3. You click it — it reads that lecture's captions and sends them to your server.
4. A new tab opens your workspace with **topics detected by content**, not by
   arbitrary timestamps.
5. You review the chapters (untick, rename), approve, and the multi-agent
   pipeline builds the handbook.

---

## Prerequisites

| Need | Why | Cost |
|---|---|---|
| Python deps installed (`pip install -r requirements.txt`) | runs the server | — |
| [Tampermonkey](https://www.tampermonkey.net/) browser add-on | runs the userscript | free |
| A long random ingest token | authenticates your browser to your server | free |
| A Groq API key (or Gemini) | actually writes the notes | free tier |

> **Tampermonkey works on Chrome, Edge, Firefox, Brave and Opera.** Chrome for
> Android does **not** support extensions — mobile will use the upload path
> (not built yet).

---

## Step 1 — Start your server with an ingest token

Open PowerShell:

```powershell
cd "C:\Users\anike\OneDrive\Documents\Default Project\4ubyu"
```

Generate a token (**this is the string you will paste into the userscript**):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Copy the output, then start the server. Paste your token in place of
`PASTE_YOUR_TOKEN_HERE` — **keep the quotes**:

```powershell
$env:EXTENSION_INGEST_TOKEN = "PASTE_YOUR_TOKEN_HERE"
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

You should see `Uvicorn running on http://127.0.0.1:8000`.

> The token exists only in that PowerShell window and on your own machine. To
> avoid re-pasting it every time, put it in a `.env` file as
> `EXTENSION_INGEST_TOKEN=...` instead.

---

## Step 2 — Install the userscript

**Easiest way:** drag `extension/4ubyu.user.js` from this project into your
browser window. Tampermonkey will open its install page → click **Install**.

**Manual way:** Tampermonkey icon → **Create a new script…** → delete the
template → paste the entire contents of `extension/4ubyu.user.js` → `Ctrl+S`.

---

## Step 3 — Point the userscript at your server

Click the Tampermonkey icon, then **⚙️ Set 4 U By U server URL**:

```
http://127.0.0.1:8000
```

Then **🔑 Set 4 U By U ingest token** and paste the token from Step 1.

Verify with **ℹ️ Show 4 U By U settings** — it should print your server and
`Token : set (xxxxxx…)`.

---

## Step 4 — Test it

1. Open a YouTube lecture **that has captions** (subtitles). Auto-generated
   captions are fine. Try any tutorial longer than ~20 minutes.
2. Wait for the purple **Generate Study Notes** button, bottom-right.
3. Click it. The card narrates each step:
   `Finding this lecture's caption track…` → `Downloading the transcript (en)…`
   → `Sending N caption lines to your workspace…` → `Opening your workspace…`
4. A new tab opens at `http://127.0.0.1:8000/?ingest=…`.
5. The **Human Review** panel lists the detected topics with timestamps.
   Untick anything you do not want, rename titles, then **Approve**.
6. The agent swarm runs and the finished handbook opens.

> **Non-English lectures work too.** If the video only has a Hindi (or other)
> caption track, the userscript asks YouTube for its own English translation, and
> if that is unavailable the notes are written from the original language
> directly. A separate translation pass of the whole lecture — dozens of model
> calls on its own — is off by default; set `TRANSLATE_TRANSCRIPT=1` to have it
> translated first.

---

## Step 5 — For real content, add your LLM key

Without an LLM key the pipeline still completes, but chapters are numbered
placeholders (`Section 1`, `Section 2`, …) and the review screen shows an amber
warning saying so. Real titles need a key:

**Settings → Groq API Key** → paste a key from
[console.groq.com](https://console.groq.com/keys) → save.

It is Fernet-encrypted into your per-user vault and only decrypted for your own
requests. Or set it for your local server by putting it in `4ubyu\.env`, where it
survives a restart:

```
GROQ_API_KEY=gsk_...
```

`$env:GROQ_API_KEY = "gsk_..."` works too, but only until you close that window —
a server started from a new terminal will not see it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No button on the page | Not a `/watch` page, or userscript disabled | Open an actual video; check Tampermonkey is enabled |
| `No ingest token configured` | Step 3 skipped | Set the token via the Tampermonkey menu |
| `Your ingest token was rejected` | Token differs from the server's | Restart the server with the same token, or re-paste it |
| `Could not reach http://…` | Server not running / wrong port | Check `Uvicorn running on …` |
| `This video has no captions available` | Video has no subtitles at all | Pick a different lecture |
| `YouTube returned an empty caption track` | Occasionally YouTube needs a nudge | Click **⋯ → Show transcript** on the video once, then retry |
| Card says `Only N caption lines found` | It is a short clip, not a lecture | Use a full lecture |
| `transcript contains only timestamps` | The caption capture picked up YouTube's screen-reader timestamp labels rather than the captions | Update the userscript, reload the video page, then capture again |
| Chapters are all `Section 1`, `Section 2`, … | The server has no usable LLM key, or the key was refused | The amber banner above the chapter list names the reason; check `GROQ_API_KEY` |
| Chapters look wrong | Stale page data after SPA navigation | Reload the YouTube page and retry |
| A section says **“This section could not be written up”** | That section's model call failed — most often the provider's per-minute token allowance, because the excerpt of the lecture sent with it is large enough to spend the minute on its own | The notice names the cause and quotes the instructor's words for that part. Wait a minute and regenerate, tick fewer chapters, or use a plan with a bigger allowance |
| Every section says it could not be written up | The key is missing, refused, or constantly rate-limited | Check `GROQ_API_KEY`; the server log prints one line per degraded section, with the reason |
| A long lecture degrades partway through | Free tiers meter tokens per minute, and a long lecture needs many sections written | Generate a few chapters at a time. Nothing is ever invented to fill a gap |

> **The capture is checked before it is used.** A transcript made of nothing but
> timestamps is refused with a clear message instead of quietly producing
> chapters with no content behind them.
>
> **So are the notes.** If the model cannot write a section, the section says so,
> names the cause, and shows the instructor's own words instead. It never
> substitutes plausible-sounding prose — you would have no way to tell the
> difference.

---

## Verify without the browser (optional)

The seam that makes this work is covered by tests:

```powershell
python tests/test_phase1_seam.py           # proves Phase 1 makes ZERO network calls
python tests/test_chapter_timestamps.py    # chapter windows stay correct
python tests/test_hitl_chapter_contract.py # approved chapters keep their windows
python tests/test_ingest_store.py          # validation, ownership, expiry, idempotency
python tests/test_degraded_notes.py        # a failed model call never becomes invented notes
python tests/test_section_composer.py      # one call per section, and no invented fragments
python tests/test_chapter_titling.py       # chapter titles are batched, and only for work that is read
python tests/test_model_output.py          # numbered answers are read however the model decorates them
python tests/test_model_router.py          # a keyless router's notice is never mistaken for notes
```

All 75 pass with no network access and no database.

---

## Running inside a free provider quota

Free tiers meter **tokens per minute** (Groq's free tier allows 8,000 for
`gpt-oss-120b`), so what a run costs is really how many times the lecture is sent
to the model. The defaults already spend as little as the pipeline can:

| Setting | Default | What it costs |
|---|---|---|
| Section notes | one call per section | The five specialist agents each re-sent the same excerpt; four of those calls were removed, and the two fields most likely to be invented (diagrams, code) are no longer requested |
| Chapter titles | 6 chapters per call | One call per chapter meant 60+ requests for a four-hour course; intervals of six keep the same tokens in a sixth of the requests |
| Section titles | one call per chapter | The model names every section of a chapter at once, and a name it does not give stays an honest "Section 2" instead of a canned topic name |
| Translation | off | A foreign-language lecture used to cost one call every 4,500 characters — around 45 calls — before a single note was written |
| Phase 2 cluster titling | off | It filled a field nothing read; that was one call per transcript cluster |

Turn any of them back up in `.env`:

```
PHASE5_MODE=agents        # back to the five-agent fan-out
TRANSLATE_TRANSCRIPT=1    # translate non-Latin lectures first
TITLE_BATCH=1             # one model call per chapter title
PHASE5_PARALLEL=6         # how many sections are written at once
```

If a long lecture still runs out of allowance, tick **two or three chapters** at
a time instead of all of them. Nothing is lost: each chapter is saved on its own,
and a section that could not be written says so rather than filling the gap.


---

## Why this design (your interview answer)

> "YouTube bot-gates datacenter IPs, so server-side transcript fetching failed on
> Render. Instead of paying for a residential proxy or storing users' Google
> cookies, I let the browser do the fetching — it is already on the user's own IP
> and already holds a signed caption URL. The server only accepts transcript
> text and public metadata, never cookies. That removed the entire category of
> credential-storage liability and made ingestion work on any host."

And the bug worth telling:

> "The end-to-end run exposed a silent failure: split chapters inherited their
> parent's timestamps, so a 3-hour lecture produced 12 chapters all stamped
> `0:00` with identical transcripts — and a second variant of the same mismatch
> broke the human-review hand-off. I wrote tests to prove it was not my test
> data, found it reproduced on a 30-minute transcript, and fixed both."
