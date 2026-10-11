"""
4 U By U — Unified Configuration & Guardrails Engine
Supports both Private (local) and Public (community BYOK) modes with strict zero-cost enforcement.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"
VECTOR_DB_DIR = BASE_DIR / "notes_vectordb"

# Ensure runtime directories exist (with serverless / read-only fallback)
try:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)
except (OSError, PermissionError):
    # Serverless runtime (e.g. Vercel) fallback to /tmp if root is read-only
    import tempfile
    TMP_DIR = Path(tempfile.gettempdir()) / "4ubyu"
    OUTPUT_DIR = TMP_DIR / "output"
    IMAGES_DIR = OUTPUT_DIR / "images"
    VECTOR_DB_DIR = TMP_DIR / "notes_vectordb"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)

# Unified App Mode: "private" (local personal) vs "public" (BYOK-enforced)
APP_MODE = os.getenv("APP_MODE", "private").lower()

# Zero-Cost & Anti-Debit Safeguards
MAX_PUBLIC_STORAGE_MB = int(os.getenv("MAX_PUBLIC_STORAGE_MB", "450"))
MAX_PUBLIC_HANDBOOKS = int(os.getenv("MAX_PUBLIC_HANDBOOKS", "150"))
ENFORCE_PUBLIC_BYOK = os.getenv("ENFORCE_PUBLIC_BYOK", "true").lower() == "true"

# Free LLM Defaults
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Concurrency limits to prevent rate-limit exhaustion
MAX_CONCURRENT_CHAPTERS = 4
MAX_SECTION_RECURSION_LIMIT = 50
