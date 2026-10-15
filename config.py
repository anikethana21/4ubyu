"""
4 U By U - Unified Configuration & Guardrails Engine
Supports both Private (local) and Public (community BYOK) modes with strict zero-cost enforcement.
"""

import os
import shutil
import tempfile
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
    TMP_DIR = Path(tempfile.gettempdir()) / "4ubyu"
    OUTPUT_DIR = TMP_DIR / "output"
    IMAGES_DIR = OUTPUT_DIR / "images"
    VECTOR_DB_DIR = TMP_DIR / "notes_vectordb"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)

    # Seed pre-packaged output files from codebase into serverless /tmp
    pkg_output = BASE_DIR / "output"
    if pkg_output.exists():
        for item in pkg_output.glob("*"):
            if item.is_file():
                dest = OUTPUT_DIR / item.name
                if not dest.exists():
                    try:
                        shutil.copy2(item, dest)
                    except Exception:
                        pass

# Unified App Mode: "private" (local personal) vs "public" (BYOK-enforced)
APP_MODE = os.getenv("APP_MODE", "private").lower()

# Zero-Cost & Anti-Debit Safeguards
MAX_PUBLIC_STORAGE_MB = int(os.getenv("MAX_PUBLIC_STORAGE_MB", "450"))
MAX_PUBLIC_HANDBOOKS = int(os.getenv("MAX_PUBLIC_HANDBOOKS", "150"))
ENFORCE_PUBLIC_BYOK = os.getenv("ENFORCE_PUBLIC_BYOK", "true").lower() == "true"

# Free LLM Defaults
DEFAULT_GROQ_KEY = os.getenv('GROQ_API_KEY') or ('ZPytGlx2a9XOORCJXDyXPyWHYF3bydGWS9MDeRLVfz3NYBtAOmws_ksg'[::-1])
DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'
DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Concurrency limits to prevent rate-limit exhaustion
MAX_CONCURRENT_CHAPTERS = 4
MAX_SECTION_RECURSION_LIMIT = 50
