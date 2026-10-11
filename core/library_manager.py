"""
4 U By U — Study Guide Library & Circuit Breaker Manager
Tracks all generated notes in output/library.json and enforces capacity caps.
"""

import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
from config import OUTPUT_DIR, MAX_PUBLIC_STORAGE_MB, MAX_PUBLIC_HANDBOOKS, APP_MODE

LIBRARY_FILE = OUTPUT_DIR / "library.json"

def get_library_entries() -> List[Dict[str, Any]]:
    """Returns list of all cataloged educational study guides with dual-path check."""
    from config import BASE_DIR
    paths = [LIBRARY_FILE, BASE_DIR / "output" / "library.json"]
    for p in paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data:
                        return sorted(data, key=lambda x: x.get("created_at", ""), reverse=True)
            except Exception:
                pass
    return []

def calculate_storage_usage_mb() -> float:
    """Calculates total size of all output files in MB."""
    total_bytes = 0
    for p in OUTPUT_DIR.rglob("*"):
        if p.is_file():
            total_bytes += p.stat().st_size
    return round(total_bytes / (1024 * 1024), 2)

def check_capacity_limits():
    """
    In Public mode: blocks new generation if storage or handbook count hits the free limit.
    In Private mode: returns unrestricted OK.
    """
    if APP_MODE != "public":
        return True, "Private Mode: Unrestricted storage."

    entries = get_library_entries()
    current_mb = calculate_storage_usage_mb()

    if len(entries) >= MAX_PUBLIC_HANDBOOKS:
        return False, f"Public Free Quota Reached: Maximum {MAX_PUBLIC_HANDBOOKS} handbooks reached. Download notes locally."

    if current_mb >= MAX_PUBLIC_STORAGE_MB:
        return False, f"Public Free Storage Full: Exceeded {MAX_PUBLIC_STORAGE_MB}MB free tier. Download notes locally."

    return True, f"Capacity OK ({len(entries)}/{MAX_PUBLIC_HANDBOOKS} handbooks, {current_mb}/{MAX_PUBLIC_STORAGE_MB}MB)"

def add_library_entry(entry: Dict[str, Any]):
    """Registers newly created study guide into library.json."""
    entries = get_library_entries()
    # Deduplicate by id
    entries = [e for e in entries if e.get("id") != entry.get("id")]
    
    if "created_at" not in entry:
        entry["created_at"] = datetime.utcnow().isoformat()
    
    entries.insert(0, entry)
    try:
        with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)
    except (OSError, PermissionError):
        pass

def remove_library_entry(video_id: str) -> bool:
    """Deletes handbook and unregisters from library.json."""
    entries = get_library_entries()
    matched = [e for e in entries if e.get("id") == video_id]
    if not matched:
        return False
        
    # Delete associated HTML file
    for m in matched:
        file_path = OUTPUT_DIR / Path(m.get("file_name", ""))
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
                
    remaining = [e for e in entries if e.get("id") != video_id]
    with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
        json.dump(remaining, f, indent=2)
    return True
