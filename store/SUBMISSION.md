# Chrome Web Store submission — 4 U By U

Everything the dashboard asks for, in the order it asks for it. Copy-paste blocks are
between the `---` rules; the notes around them explain what a reviewer will check.

Assets in this folder:

| File | Used for | Size |
| --- | --- | --- |
| `screenshots/01-estimate.png` | Store listing, screenshot 1 | 1280 × 800 |
| `screenshots/02-writing.png` | screenshot 2 | 1280 × 800 |
| `screenshots/03-done.png` | screenshot 3 | 1280 × 800 |
| `screenshots/04-notes-page.png` | screenshot 4 | 1280 × 800 |
| `screenshots/05-notes-sections.png` | screenshot 5 | 1280 × 800 |
| `screenshots/shots.json` | what each shot is, for future regeneration | — |
| `promo/promo-440x280.png` | Small promo tile (optional in the listing) | 440 × 280 |
| `../extension/assets/icons/icon128.png` | Store icon | 128 × 128 |
| `../extension/dist/4ubyu-extension.zip` | The upload itself | — |

Regenerate the screenshots with `node extension/dev/serve.js` in one terminal and
`node extension/dev/shots.js` in another. The icons come from
`node extension/tools/icons.js`. Neither is needed to publish — both are how the files
here were made.

---

## 0. Before you upload

The review installs the zip on a clean profile. A failure there costs a review cycle, so
these are worth ten minutes:

1. **Load the build unpacked.** `chrome://extensions` → *Developer mode* on → *Load
   unpacked* → choose `extension/dist/store`.
2. **A fresh profile.** Use a new Chrome profile (or `chrome://settings/reset` is too
   much — a second profile is enough), so the extension starts with no stored key.
3. **A real lecture, English captions.** Open a 10–20 minute lecture. The gold
   *✦ Make notes* button should appear bottom-right within a second.
4. **The whole path once:** paste a real Groq key → *Check the key* → the model list
   fills from your key → the estimate appears → *Generate* → progress, the quote, the
   log → *Download the page* → open the file from disk → *Save as PDF* (browser print).
5. **Resume:** start a second run, close the tab halfway, reopen the same lecture. The
   panel should offer the finished parts rather than starting over.
6. **SPA navigation:** click through to another video without reloading. The panel must
   follow the lecture, not go stale.
7. **The English gate:** open a Hindi lecture. It should refuse before any request is
   made, and say why.
8. **Minimise and close:** the dash collapses to a bar that keeps the progress visible;
   × removes the panel for that lecture.

If any of those misbehave, fix it before submitting. The version in the zip is 2.1.8.

---

## 1. The developer account (one time, US$5)

1. Go to <https://chrome.google.com/webstore/devconsole> and sign in.
2. Accept the developer agreement and pay the **one-time US$5** registration fee
   (card). It is not a subscription; it covers up to 20 items.
3. **Verify the account email.** Publishing is blocked until it is verified.
4. **Turn on 2-Step Verification** for the Google account. Google requires it to
   publish, and it is the only thing standing between a leaked password and your item.
5. **Publisher name and contact email.** These are shown publicly on the listing. Use a
   name you are happy to stand behind (your own is fine) and an address you are willing
   to have public — a dedicated `…@gmail.com` is reasonable.
6. **Trader status.** For distribution in the EU, Google asks whether you are a trader
   under the DSA and may ask for a verified address and phone. You can publish without
   it by leaving the EU out of the regions in step 5; you can add the EU later.

The fee is the only cost. There is no review fee and no annual charge.

---

## 2. Create the item and upload

1. Dashboard → **Add new item**.
2. Upload `extension/dist/4ubyu-extension.zip`. Its root holds `manifest.json`, which is
   what the store expects — do not zip the folder.
3. The dashboard reads the name, version and summary from the manifest:
   **4 U By U — Lecture to Study Notes**, v2.1.8.
4. If it complains about the zip, rebuild both:
   `node extension/build.js && node extension/tools/package.js` (in PowerShell, `;`
   instead of `&&`).

---

## 3. Store listing tab

**Name** (from the manifest, 34 characters):

```
4 U By U — Lecture to Study Notes
```

**Summary** (from the manifest, 126 characters — the dashboard shows the manifest's, so
this is only here so you can check it matches):

```
Turn the YouTube lecture you are watching into topic-wise study notes. Your own API key, one HTML file. No account, no server.
```

**Category:** `Education`
**Language:** `English`

**Description** (paste as-is; plain text, no markdown):

---
4 U By U turns the YouTube lecture you are already watching into study notes you can
keep.

Press the gold button on any YouTube lecture, press Generate, and a few minutes later
you have one HTML page: chapters by topic, timestamps that open the lecture at the right
minute, plain-English explanations, analogies, worked examples, code and diagrams where
the lecture had them, and a short check-yourself list after each section. Keep it, print
it, or turn it into a PDF with your browser's own printer.

WHAT MAKES IT DIFFERENT

- It reads the lecture you are already on. Nothing to upload, no link to paste, no
  second app.
- Chapters follow the ideas, not the clock. The timestamps are there to take you back to
  the moment, not to split the page.
- It does not invent what it could not read. If a stretch of the lecture cannot be
  written up, the page says so in words, with the provider's own reason and that
  stretch's own words underneath. A heading that looks real but was made up would be
  worse than a gap.
- It shows the cost before it spends it: how many calls, roughly how many tokens, and
  how many lectures of this size the model's free day still holds.
- Nothing is spent twice. Each finished part is kept on your machine, so a closed tab, a
  rate limit or a dead battery costs you the wait and not the work.

WHAT YOU NEED

A free API key from Groq (console.groq.com/keys). You paste it once and it stays in your
browser. The notes are written with your key and your quota — there is no account with
us, no subscription and no server of ours in the middle.

The estimate is shown before the first call, and the free tier is enough for real work:
on the default model, a one-hour lecture is roughly 42,000 tokens, about four lectures a
day.

PRIVACY

No account, no analytics, no advertising, no tracking, and no server of ours. The
extension does not download or run code from the internet. The only request that leaves
your browser goes to the AI provider you configured, with your own key, and only when you
press Generate. The page you download opens offline and calls nothing.

HONEST LIMITS

- English captions only, for now. The notes are written in English from English captions;
  a lecture in another script is refused before anything is spent, and the panel says
  exactly why.
- Free tiers meter tokens per minute, so a long lecture waits between calls instead of
  failing. Longer lectures take proportionally longer, and the panel shows the wait.
- The notes are written by an AI model. They are a study aid, not a substitute for the
  lecture, and the lecture's own examples are quoted on the page so you can check them.

MIT licensed and developed in the open: https://github.com/anikethana21/4ubyu
---

**Store icon:** `extension/assets/icons/icon128.png`

**Screenshots** (add in this order; the first is what people see in search):

1. `store/screenshots/01-estimate.png` — the panel ready, with the cost shown before it is spent
2. `store/screenshots/02-writing.png` — mid-run: progress, the quote, the log
3. `store/screenshots/03-done.png` — finished: one file, ready to download
4. `store/screenshots/04-notes-page.png` — the page it produces
5. `store/screenshots/05-notes-sections.png` — the notes themselves

They are 1280 × 800, the size the store asks for, captured from the real panel and a real
notes page (the provider was the dev harness, which is why the screenshots can exist
without spending a key).

**Small promo tile (440 × 280):** `store/promo/promo-440x280.png` — optional, and only
shown in some placements. It is drawn from `store/promo/promo.html` by the same script
that takes the screenshots. Skip the marquee (1400 × 560) unless Google offers to feature
the item.

**Homepage URL:** `https://anikethana21.github.io/4ubyu/`
**Support URL:** `https://github.com/anikethana21/4ubyu/issues`

---

## 4. Privacy practices tab

This tab is where items get rejected, so answer all of it.

**Single purpose** (a sentence or two):

```
Turns the YouTube lecture a person is watching into topic-based study notes, written by an
AI model the person configures with their own API key, and saves them as one self-contained
HTML page that opens offline.
```

**Permission justifications:**

- `storage` —
  ```
  Stores the user's own API key, their model choice, notes they generated, and a local
  usage counter, so they survive a page reload. Nothing in storage is synced or sent
  anywhere.
  ```
- Host permission `https://www.youtube.com/*` —
  ```
  The extension's only interface lives on the YouTube watch page, and it reads the
  caption track and title of the lecture the user is on. Without it there is nothing to
  write notes from.
  ```
- Host permission `https://api.groq.com/*` —
  ```
  The one network destination: the AI provider whose key the user supplied. It is called
  with the user's key to list the models that key can use and to write the notes, and
  only after the user presses Generate.
  ```

**Are you using remote code?** `No, I am not using remote code.`

**About the two content scripts** (worth having ready if a reviewer asks): the package runs
`page-bridge.js` in the page's own world and `content.js` in the isolated world. A content
script cannot see `window.ytInitialPlayerResponse` or the player's methods, and after
YouTube's own single-page navigation the copy in the HTML is the previous video's — so the
bridge reads the player object, and answers the isolated script over a DOM event. It sends
nothing anywhere; it is four functions and a listener, and the test suite loads it and asks
it for a response.

**Data usage** — tick exactly these:

- **Website content** — ticked. Used for: *App functionality*. Explanation: the caption
  text and title of the lecture the user chose are sent to the provider the user
  configured, only when they press Generate, because that is the text the model writes
  the notes from.
- **Authentication information** — ticked. Used for: *App functionality*. Explanation: the
  user's own API key, stored locally and sent only to that provider, in the request
  header, to authenticate the request.
- Everything else (personally identifiable information, health, financial, personal
  communications, location, web history, user activity) — **leave unticked**. It does not
  read or transmit any of them.

**Certifications** — all true, tick all three:

- Not selling or transferring data to third parties outside the approved use.
- Not using or transferring data for purposes unrelated to the single purpose.
- Not using or transferring data to determine creditworthiness or for lending.

**Privacy policy URL:**

```
https://anikethana21.github.io/4ubyu/privacy.html
```

The page is in `privacy.html` at the repository root, served by GitHub Pages. It names
the provider, the two things that leave the browser, everything stored locally, and how to
delete it.

---

## 5. Distribution tab

- **Visibility:** Public
- **Regions:** all, unless you skipped trader verification — then exclude the EU.
- **Pricing:** Free
- **Mature content:** No

---

## 6. Submit

**Test instructions** (the field the reviewer reads first):

```
No account is needed to install or to look around: the panel opens on any YouTube lecture
and shows its key screen.

To see a full run, create a free Groq API key at https://console.groq.com/keys (no payment
method required, takes a minute), paste it into the panel, press "Check the key", then open
a short lecture with English captions — for example a 10-minute lecture — and press
Generate. A run of that size finishes in about a minute on the free tier; a one-hour
lecture waits between calls to stay inside the free tier's tokens-per-minute limit, which
is expected behaviour and is shown in the panel as a wait, not a failure.

Every run is free for you to try: the key is the reviewer's own, and the free tier covers
several lectures a day. There is no login, no payment and no server of ours.
```

Then **Submit for review**.

First review usually takes one to three days, sometimes longer for a new developer
account. A rejection comes with a reason and does not cost anything; fix it and resubmit.

---

## 7. After approval

1. Copy the listing URL and put it in `index.html` and `README.md` next to the userscript
   link.
2. The listing shows the version you uploaded. Future releases: bump `@version` in
   `extension/userscript.js`, `node extension/build.js`, `node extension/tools/package.js`,
   upload, submit. The userscript updates itself; the extension updates through the store.
