# 4 U By U — Interactive Educational Notes & Tri-Pane Study Workspace

> **"For You, By You"**  
> AI-Synthesized Educational Study Workspace for YouTube Technical Lectures.  
> Directly synthesized from **The Agentic AI & LangGraph Engineering Handbook** and **The Generative AI & RAG Engineering Handbook**.  
> Sibling project to **R-Prep** (AI Resume Preparation Suite on Vercel).

---

## 🏛️ System Architecture Overview

4 U By U divides the screen into an interactive **3-segment resizable workspace**:

```
┌───────────────────────────────────────────────┬───────────────────────────────────┐
│                                               │ TOP-RIGHT PANE:                   │
│ LEFT PANE (Full Viewport Height: 100vh):      │ YouTube Video Player Window       │
│                                               │ • Responsive 16:9 frame           │
│ Educational Notes / Handbook ("Instrument")   │ • YouTube IFrame API sync         │
│ • Sticky Navigation & Section Filter          ├═══════════════════════════════════┤
│ • Clickable Timestamp Badges [▶ 04:25]        │ HORIZONTAL RESIZER (Drag Up/Down) │
│ • Prism.js Syntax-Highlighted Code Blocks     ├───────────────────────────────────┤
│ • Interactive Mermaid.js Architecture Diagrams│ BOTTOM-RIGHT PANE:                │
│ • Reading-Aware Viewport Auto-Seek Observer   │ Docked Contextual RAG Chatbot     │
│                                               │ • Real-time token streaming       │
│                                               │ • Clickable [▶ MM:SS] citations   │
├───────────────────────────────────────────────┴───────────────────────────────────┤
│ VERTICAL RESIZER (Drag Left/Right)                                                │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Strategic Dual-Mode Deployment (Zero-Cost & Anti-Debit Guarantee)

4 U By U merges **Private (Local)** and **Public (Community)** into a single codebase with strict zero-cost safeguards:

| Mode | Configuration | Safeguards & Behavior |
|---|---|---|
| **Private (Default)** | `APP_MODE=private` | Runs 100% locally on your machine. Zero cloud costs, zero auth required, unlimited local storage, local ChromaDB, local transcripts. Immune to credit exhaustion. |
| **Public (Community)** | `APP_MODE=public` | **Strict Zero-Debit Enforced:**<br>1. **Mandatory BYOK:** Public users must supply their own Groq/Gemini/OpenAI/Claude API key. Your personal keys are never used.<br>2. **Storage Circuit Breaker:** Hard-stops with an error if free tier storage approaches 450MB or 150 guides.<br>3. **Zero Linked Cards:** Hosted on non-scaling free tiers (Vercel Hobby, Supabase Free) where automatic charges are impossible. |

---

## 🚀 Quickstart & Local Execution

### 1. Installation
```bash
cd 4_u_by_u
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Leave API keys blank to use the built-in zero-cost tier or paste your free Groq/Gemini key).*

### 3. Launch the Application
```bash
python app.py
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser!

---

## 📂 Project Structure

```
4_u_by_u/
├── app.py                     # FastAPI web server & SSE chat streaming
├── main.py                    # Master end-to-end multi-agent pipeline
├── config.py                  # Dual-mode settings & zero-cost guardrails
├── states.py                  # LangGraph TypedDict schemas & merge reducers
│
├── phase1_ingestion.py        # Sequential metadata & transcript fetch
├── phase2_parallel.py         # Parallel fan-out (Desc, Labels, Topic Gaps)
├── phase3_hitl.py             # HITL topic approval checkpoint
├── phase4_structure.py        # Master outline synthesis agent
├── phase5_chapter_agents.py   # Batched multi-agent chapter graphs (6 sub-agents)
├── phase6_compilation.py      # Chapter compiler & chronological comparator
├── phase7_renderer.py         # Tri-pane HTML workspace renderer
├── phase8_chatbot.py          # Local ChromaDB index & LCEL RAG stream
│
├── core/
│   ├── model_router.py        # Dynamic BYOK regex detector & model factory
│   ├── transcriber.py         # YouTube transcript & timestamp formatter
│   ├── keyframe_extractor.py  # Lecture slide keyframes & Mermaid diagrams
│   ├── library_manager.py     # output/library.json catalog & circuit breaker
│   └── vector_store.py        # Local ChromaDB & HuggingFace embeddings
│
├── templates/
│   ├── index.html             # Landing page & study library dashboard
│   └── base_workspace.html    # 3-segment interactive workspace template
│
├── static/
│   ├── css/ (landing, workspace_layout, themes)
│   └── js/  (landing, workspace_splitter, yt_sync, rag_chat)
│
└── output/
    ├── library.json           # Catalog of all generated handbooks
    └── notes_*.html           # Standalone interactive study handbooks
```
