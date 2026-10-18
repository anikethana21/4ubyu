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
> caption track, the userscript asks YouTube for its own English translation.
> If that is unavailable, the server's translator normalises it instead.

---

## Step 5 — For real content, add your LLM key

Without an LLM key the pipeline still completes, but chapters are placeholders
(`[Study Assistant Notice]`). Real notes need a key:

**Settings → Groq API Key** → paste a key from
[console.groq.com](https://console.groq.com/keys) → save.

It is Fernet-encrypted into your per-user vault and only decrypted for your own
requests. Or set it globally for your local server:

```powershell
$env:GROQ_API_KEY = "gsk_..."
```

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
| Chapters look wrong | Stale page data after SPA navigation | Reload the YouTube page and retry |

---

## Verify without the browser (optional)

The seam that makes this work is covered by tests:

```powershell
python tests/test_phase1_seam.py           # proves Phase 1 makes ZERO network calls
python tests/test_chapter_timestamps.py    # chapter windows stay correct
python tests/test_hitl_chapter_contract.py # approved chapters keep their windows
python tests/test_ingest_store.py          # validation, ownership, expiry, idempotency
```

All 32 pass with no network access and no database.

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
