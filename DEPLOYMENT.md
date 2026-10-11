# 🚀 4 U By U — Deployment Guide & Runbook

This guide covers deployment options for the **4 U By U** Interactive Educational Workspace.

---

## Option 1: Render (Recommended — Free & Easiest)

1. Push your repository to **GitHub**:
   ```bash
   git init
   git add .
   git commit -m "feat: complete production-ready 4 U By U workspace"
   git remote add origin https://github.com/<your-username>/4-u-by-u.git
   git push -u origin main
   ```

2. Open [dashboard.render.com](https://dashboard.render.com) and click **New +** -> **Web Service**.
3. Select your GitHub repository.
4. Render will automatically detect `render.yaml` or you can enter:
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/health`
5. In **Environment Variables**, add:
   - `APP_MODE`: `public`
   - `GROQ_API_KEY`: *(Your Groq API key)*
   - `GEMINI_API_KEY`: *(Your Google Gemini API key)*
   - `TAVILY_API_KEY`: *(Optional for web search)*
6. Click **Create Web Service**. Your app is live with automatic SSL!

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
