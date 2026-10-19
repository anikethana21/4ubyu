# 🚀 4 U By U — Deployment Guide & Runbook

This guide covers deployment options for the **4 U By U** Interactive Educational Workspace.

---

## Option 1: Render (Recommended — Free & Easiest)

### Step 1 — Set up Supabase (auth, encrypted key vault, workspaces)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → **New query**, paste the contents of **`supabase_schema.sql`** (in this repo) and run it. This creates the `users`, `user_settings`, `workspaces`, `ingest_payloads` and `token_blacklist` tables.
   - Re-running it is safe: the script uses `create table if not exists` and `add column if not exists`, and ends with `notify pgrst, 'reload schema'`. That last line matters — without it a running API keeps answering *"column workspaces.notes_data does not exist"* until it restarts.
3. From **Settings → API**, copy the **Project URL** and the **`service_role`** key. (Use the service_role key server-side; never expose it in the browser.)

### What is stored, and what it costs

A saved workspace is kept as its **notes data** (chapter titles, sections, key
points, timestamps, video metadata) in a `jsonb` column, and the page is drawn
from it on request. The rendered HTML is not stored: it is a function of that
data, more than half of it is the same inlined stylesheet copied into every
workspace, and a stored page cannot be re-rendered when the template improves.

That is **9% of the page it draws**: one twelve-minute chapter's notes came to
15 KB where its rendered page was 168 KB. Extrapolating from that per-section
size, a four-hour course lands near 1 MB — so the free tier's 1 GB holds roughly
a thousand of them, or tens of thousands of single chapters. It also means a
formatting fix reaches every workspace already saved.

A workspace saved by an older version holds the page instead; those still open
(they are read as a page, not re-rendered), so no migration is needed.

### Step 2 — Deploy on Render

1. Push your repository to **GitHub**:
   ```bash
   git init
   git add .
   git commit -m "feat: complete production-ready 4 U By U workspace"
   git remote add origin https://github.com/<your-username>/4-u-by-u.git
   git push -u origin main
   ```

2. Open [dashboard.render.com](https://dashboard.render.com) and click **New +** -> **Blueprint**, then select your GitHub repository. Render will read `render.yaml` automatically.
   *(Alternatively create a **Web Service** manually with: Environment `Python`, Build Command `pip install -r requirements.txt`, Start Command `uvicorn app:app --host 0.0.0.0 --port $PORT`, Health Check Path `/health`.)*
3. In **Environment Variables**, add:
   - `APP_MODE`: `private` (personal, unrestricted) or `public` (BYOK + hard caps)
   - `SUPABASE_URL`: *(your Supabase project URL)*
   - `SUPABASE_KEY`: *(your Supabase anon/service key)*
   - `JWT_SECRET`: *(long random string — signs login sessions; Render can generate it)*
   - `FERNET_KEY`: *(optional — encrypts the per-user key vault; derived from `JWT_SECRET` if blank)*
   - `EXTENSION_INGEST_TOKEN`: *(required for capture — the userscript presents it when posting a transcript)*
   - `INGEST_TTL_HOURS`: *(optional, default 24 — how long a captured transcript is kept)*

   > **No LLM keys go here.** Groq/Gemini/Eraser keys are entered by each user in
   > the UI, encrypted with Fernet, stored in the Supabase `user_settings` vault,
   > and decrypted per request (BYOK). Only the infrastructure secrets above are
   > deploy-time env vars.
4. Click **Create Web Service**. Your app is live with automatic SSL!

---

## Ingestion: the browser reads the captions, not the server

**The server does not fetch YouTube, and on a cloud host it cannot.** Render's
datacenter IPs are gated exactly like Vercel's: the player API returns *"Sign in
to confirm you're not a bot"* and the caption endpoint returns *RequestBlocked*,
which is why a naive deploy reports `00:00` duration and no chapters.

The userscript (`extension/4ubyu.user.js`) captures the transcript **in the
user's own browser**, on the page where the lecture is already playing, and posts
it to `/api/ingest/transcript`. Their residential IP is not gated, and their
cookies never leave their machine — nothing needs them there. This is why no
YouTube configuration is needed on the host at all.

Server-side ingestion still exists and still works **on a residential machine**
(local development, Option 3, a home server): when a request carries no
`ingest_id`, the server fetches the video itself. If you want that path to work
on a datacenter host as well:

| Var | Cost | What it restores |
|---|---|---|
| `YOUTUBE_API_KEY` | Free | Duration + description (+ description chapters). **No transcript.** |
| `YT_COOKIES_B64` | Free | Cookies from a signed-in browser, fed to `yt-dlp` → metadata **and** transcripts. |
| `YT_PROXY_URL` | Paid (~$2–7/mo) | Residential proxy → full ingestion, most reliable. |

- **Get a free Data API key:** [console.cloud.google.com](https://console.cloud.google.com) → new project → *APIs & Services → Library* → enable **YouTube Data API v3** → *Credentials → Create API key*.
- **Get cookies:** install a "Get cookies.txt LOCALLY" browser extension, export `cookies.txt` while signed in to YouTube, then base64-encode it:
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))
  ```
  and paste the result as `YT_COOKIES_B64`. (Cookies expire after some weeks — re-export when transcripts stop.)

> Render's free instance spins down after ~15 min idle (the first request then
> takes ~30–60s to wake) and has 512 MB RAM. The pipeline runs in that budget for
> a normal lecture; a four-hour one is better segmented with **Generate notes** per
> chapter, which also keeps each request inside a free provider's per-minute
> token allowance.

---

## Option 2: Railway

1. Install Railway CLI or connect via [railway.app](https://railway.app).
2. Choose **Deploy from GitHub repo**.
3. Railway automatically detects `Procfile` and `requirements.txt`.
4. Add environment variables in the Railway dashboard (`GROQ_API_KEY`, `APP_MODE=public`).
5. Click **Deploy**.

---

## Option 3: Docker (Any Cloud: AWS / Google Cloud Run / DigitalOcean)

Build and run locally or on a VPS:
```bash
# 1. Build Docker image
docker build -t 4ubyu-workspace .

# 2. Run container
docker run -d -p 8000:8000 --env-file .env --name 4ubyu-workspace 4ubyu-workspace
```

Or run with **Docker Compose**:
```bash
docker compose up -d --build
```

---

## Option 4: Linux VM / VPS (Ubuntu + systemd + Nginx)

1. Clone repo onto server:
   ```bash
   git clone https://github.com/<your-username>/4-u-by-u.git /var/www/4ubyu
   cd /var/www/4ubyu
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Create systemd service (`/etc/systemd/system/4ubyu.service`):
   ```ini
   [Unit]
   Description=4 U By U Workspace
   After=network.target

   [Service]
   User=ubuntu
   WorkingDirectory=/var/www/4ubyu
   ExecStart=/var/www/4ubyu/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
   Restart=always
   EnvironmentFile=/var/www/4ubyu/.env

   [Install]
   WantedBy=multi-user.target
   ```
3. Start service:
   ```bash
   sudo systemctl enable --now 4ubyu
   ```
4. Configure Nginx with reverse proxy to `http://127.0.0.1:8000` and Certbot for SSL.
