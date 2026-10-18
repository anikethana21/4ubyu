# 🚀 4 U By U — Deployment Guide & Runbook

This guide covers deployment options for the **4 U By U** Interactive Educational Workspace.

---

## Option 1: Render (Recommended — Free & Easiest)

### Step 1 — Set up Supabase (auth, encrypted key vault, workspaces)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → **New query**, paste the contents of **`supabase_schema.sql`** (in this repo) and run it. This creates the `users`, `user_settings`, `workspaces`, `token_blacklist` tables and the `workspaces` storage bucket.
3. From **Settings → API**, copy the **Project URL** and the **`service_role`** key. (Use the service_role key server-side; never expose it in the browser.)

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
   - `YOUTUBE_API_KEY` / `YT_PROXY_URL`: *(optional — leave blank on Render)*

   > **No LLM keys go here.** Groq/Gemini/Eraser keys are entered by each user in
   > the UI, encrypted with Fernet, stored in the Supabase `user_settings` vault,
   > and decrypted per request (BYOK). Only the infrastructure secrets above are
   > deploy-time env vars.
4. Click **Create Web Service**. Your app is live with automatic SSL!

> **Why Render instead of Vercel?** YouTube blocks datacenter/serverless IP ranges.
> On Vercel the backend gets *"Sign in to confirm you're not a bot"* on the player
> API and *RequestBlocked* on the transcript endpoint, so it cannot read a video's
> duration or transcript (the HITL screen then shows `00:00` / no chapters). Render
> runs on regular servers that YouTube does not block, so the full topic
> chapterizer works with no extra configuration.
>
> Render's free instance spins down after ~15 min idle (first request then takes
> ~30–60s to wake) and has 512 MB RAM. If you generate very long handbooks, use a
> paid instance.

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
