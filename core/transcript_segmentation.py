"""
Transcript windowing + semantic boundary detection for lecture chapterization.
Shared by Phase 2 labeling and transcript-first chapter detection.
"""

from __future__ import annotations

import numpy as np
from typing import Dict, List, Any, Optional

from core.transcriber import format_seconds


_SBERT_MODEL = None


def compute_sbert_embeddings(texts: List[str]) -> np.ndarray:
    global _SBERT_MODEL
    if not texts:
        return np.array([])
    if _SBERT_MODEL is not None:
        try:
            return np.array(
                _SBERT_MODEL.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            )
        except Exception:
            pass

    try:
        from sentence_transformers import SentenceTransformer

        try:
            model = SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
        except Exception:
            model = SentenceTransformer("all-MiniLM-L6-v2")
        _SBERT_MODEL = model
        return np.array(
            model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        )
    except Exception:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer

            vec = TfidfVectorizer(max_features=128, stop_words="english")
            mat = vec.fit_transform(texts).toarray()
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            return mat / norms
        except Exception:
            return np.random.randn(len(texts), 128)


def texttiling_boundaries(embeddings: np.ndarray, window: int = 2) -> List[int]:
    n = len(embeddings)
    if n < 4:
        return []

    scores = []
    for i in range(window, n - window):
        left = embeddings[max(0, i - window) : i]
        right = embeddings[i : min(n, i + window)]
        left_mean = left.mean(axis=0)
        right_mean = right.mean(axis=0)
        sim = float(
            np.dot(left_mean, right_mean)
            / (np.linalg.norm(left_mean) * np.linalg.norm(right_mean) + 1e-8)
        )
        scores.append((i, sim))

    if not scores:
        return []

    sim_vals = [s[1] for s in scores]
    threshold = np.mean(sim_vals) - 0.5 * np.std(sim_vals)
    return [idx for idx, sim in scores if sim < threshold]


def agglomerative_merge(
    embeddings: np.ndarray,
    boundaries: List[int],
    distance_threshold: float = 0.38,
) -> List[int]:
    try:
        from sklearn.cluster import AgglomerativeClustering
        from scipy.sparse import diags

        n = len(embeddings)
        diagonals = [np.ones(n), np.ones(n - 1), np.ones(n - 1)]
        connectivity = diags(diagonals, [0, 1, -1], shape=(n, n), format="csr")

        model = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=distance_threshold,
            metric="cosine",
            linkage="average",
            connectivity=connectivity,
        )
        return model.fit_predict(embeddings).tolist()
    except Exception:
        n = len(embeddings)
        labels = []
        current = 0
        for i in range(n):
            if i in boundaries:
                current += 1
            labels.append(current)
        return labels


def build_timed_windows(
    timed_transcript: List[Dict[str, Any]],
    window_sec: int = 60,
) -> List[Dict[str, Any]]:
    if not timed_transcript:
        return []

    max_time = timed_transcript[-1].get(
        "end", timed_transcript[-1]["start"] + timed_transcript[-1].get("duration", 5)
    )
    windows: List[Dict[str, Any]] = []
    t = 0.0
    while t < max_time:
        segs = [seg for seg in timed_transcript if t <= seg["start"] < t + window_sec]
        text = " ".join(s["text"] for s in segs)
        windows.append(
            {
                "start_sec": t,
                "timestamp_str": format_seconds(t),
                "text": text,
            }
        )
        t += window_sec

    return [w for w in windows if w["text"].strip()]


def cluster_windows_to_segments(
    windows: List[Dict[str, Any]],
    distance_threshold: float = 0.38,
) -> List[Dict[str, Any]]:
    if not windows:
        return []

    texts = [w["text"] for w in windows]
    embeddings = compute_sbert_embeddings(texts)
    boundaries = texttiling_boundaries(embeddings, window=2)
    cluster_labels = agglomerative_merge(embeddings, boundaries, distance_threshold)

    num_clusters = max(cluster_labels) + 1
    segments: List[Dict[str, Any]] = []
    for c in range(num_clusters):
        c_windows = [windows[i] for i, lbl in enumerate(cluster_labels) if lbl == c]
        if not c_windows:
            continue
        combined_text = " ".join(w["text"] for w in c_windows)
        end_sec = c_windows[-1]["start_sec"] + 60
        segments.append(
            {
                "start_sec": c_windows[0]["start_sec"],
                "end_sec": end_sec,
                "timestamp_str": c_windows[0]["timestamp_str"],
                "text": combined_text,
            }
        )
    return segments
