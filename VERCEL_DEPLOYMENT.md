# 🚀 Vercel Deployment Guide for 4 U By U

This project is pre-configured for deployment on **Vercel** with the project and domain name set to **`4ubyu`**.

---

## 🌐 Domain Configuration

- **Default Vercel Domain:** `https://4ubyu.vercel.app`
- **Custom Domain:** If you own `4ubyu.com`, `4ubyu.ai`, `4ubyu.org`, or any custom domain:
  1. Go to your Vercel Project Dashboard $\rightarrow$ **Settings** $\rightarrow$ **Domains**.
  2. Enter `4ubyu.com` (or your preferred TLD) and follow the automatic DNS CNAME configuration.

---

## ⚡ Deployment Methods

### Option 1: One-Click GitHub Import (Recommended)

1. Push this repository to GitHub:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/4ubyu.git
   git branch -M master
   git push -u origin master
   ```
2. Open [vercel.com/new](https://vercel.com/new).
3. Import the `4ubyu` repository.
4. Set the project name to **`4ubyu`**.
5. Click **Deploy**. Vercel will automatically build the serverless functions and deploy your live URL at **`https://4ubyu.vercel.app`**.

---

### Option 2: Deploy from Terminal (Vercel CLI)

1. Open a terminal in this directory:
   ```bash
   cd C:\Users\anike\Desktop\4_u_by_u
   ```
2. Run the deployment command:
   ```bash
   npx vercel --prod
   ```
3. Follow the one-time interactive login:
   - When asked **"Set up and deploy?"**, press `Y`.
   - When asked **"Which scope do you want to deploy to?"**, select your account.
   - When asked **"Link to existing project?"**, select `N`.
   - When asked **"What's your project's name?"**, enter **`4ubyu`**.
   - When asked **"In which directory is your code located?"**, press `Enter` (`./`).

---

## 🛠️ Included Vercel Architecture

- **`vercel.json`**: Configures the `@vercel/python` builder and routes:
  - `/static/*` $\rightarrow$ High-speed static CDN delivery
  - `/output/*` $\rightarrow$ Handbook HTML & diagram assets
  - `/*` $\rightarrow$ FastAPI Serverless runtime via `api/index.py`
- **`api/index.py`**: Serverless handler binding the FastAPI ASGI application.
- **`config.py`**: Safe fallback to `/tmp/4ubyu` for serverless environments with read-only filesystems.
- **`.vercelignore`**: Excludes cache, vector stores, and local virtual environments.
