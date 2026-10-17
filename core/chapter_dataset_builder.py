"""
Chapter Dataset Builder for Neural Network Training
Extracts labeled training data from existing transcripts + chapters
to train a classifier for automatic chapter segmentation.
"""

import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from config import BASE_DIR, OUTPUT_DIR


class ChapterDatasetBuilder:
    """Builds training datasets for NN-based chapter classification."""

    def __init__(self) -> None:
        self.data_dir = BASE_DIR / "data" / "chapter_classification"
        self.data_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # HTML chapter parsing (existing generated handbooks are labels)
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_chapters_from_html(html_path: Path) -> List[Dict[str, Any]]:
        """Extract chapter titles + timestamps from a generated tri-pane HTML."""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            return []

        try:
            html = html_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return []

        soup = BeautifulSoup(html, "html.parser")
        chapters: List[Dict[str, Any]] = []
        for art in soup.find_all("article", class_="chapter-card"):
            title = art.get("data-chapter-title") or ""
            ts = art.get("data-timestamp-seconds", "0")
            text = art.get_text(" ", strip=True)
            try:
                ts_sec = int(float(ts))
            except (TypeError, ValueError):
                ts_sec = 0
            chapters.append({
                "title": title.strip(),
                "timestamp_seconds": ts_sec,
                "text": text[:4000],
            })
        return chapters

    def build_from_existing_outputs(self) -> Dict[str, Any]:
        """
        Build dataset metadata from existing generated notes in output/.
        Each library entry contributes chapter labels extracted from its HTML.
        """
        samples: List[Dict[str, Any]] = []
        library_path = OUTPUT_DIR / "library.json"

        if not library_path.exists():
            print(f"[DatasetBuilder] No library.json found at {library_path}")
            return {"samples": []}

        try:
            library = json.loads(library_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[DatasetBuilder] Could not read library.json: {e}")
            return {"samples": []}

        for entry in library:
            vid = entry.get("id")
            file_name = entry.get("file_name")
            if not vid or not file_name:
                continue
            html_path = OUTPUT_DIR / file_name
            if not html_path.exists():
                continue
            chapters = self._parse_chapters_from_html(html_path)
            if not chapters:
                continue
            samples.append({
                "video_id": vid,
                "title": entry.get("title", ""),
                "channel": entry.get("channel", ""),
                "chapters": chapters,
            })

        print(f"[DatasetBuilder] Found {len(samples)} workspaces with parseable chapters")
        return {"samples": samples}

    # ------------------------------------------------------------------
    # Transcript windowing + label assignment (boundary classification)
    # ------------------------------------------------------------------
    @staticmethod
    def make_boundary_samples(
        timed_transcript: List[Dict[str, Any]],
        chapter_starts: List[int],
        window_sec: int = 60,
    ) -> List[Dict[str, Any]]:
        """
        Convert a timed transcript into window samples where label=1 means the
        window starts a new chapter (nearest chapter start within window).
        """
        from core.transcript_segmentation import build_timed_windows

        windows = build_timed_windows(timed_transcript, window_sec=window_sec)
        if not windows or not chapter_starts:
            return []

        samples: List[Dict[str, Any]] = []
        for w in windows:
            w_start = int(w.get("start_sec", 0))
            # label 1 if a chapter begins inside [w_start, w_start + window_sec)
            is_boundary = any(w_start <= cs < w_start + window_sec for cs in chapter_starts)
            samples.append({
                "start_sec": w_start,
                "text": w.get("text", ""),
                "label": int(is_boundary),
            })
        return samples

    def save_dataset(self, dataset: Dict[str, Any], filename: str = "chapter_dataset.json") -> str:
        out_path = self.data_dir / filename
        out_path.write_text(
            json.dumps(dataset, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"[DatasetBuilder] Saved dataset to {out_path}")
        return str(out_path)

    def load_dataset(self, filename: str = "chapter_dataset.json") -> Dict[str, Any]:
        out_path = self.data_dir / filename
        if not out_path.exists():
            return {"samples": []}
        return json.loads(out_path.read_text(encoding="utf-8"))
