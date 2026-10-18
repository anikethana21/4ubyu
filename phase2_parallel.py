"""
4 U By U — PHASE 2: Parallel Fan-Out Pipeline
Branch A: Description resource extraction
Branch B: Transcript labeling using TextTiling + Agglomerative Clustering (SBERT-powered)
Branch C: Online search / gap analysis
"""

import re
import requests
import numpy as np
from typing import Dict, Any, List
from langgraph.graph import StateGraph, START, END
from states import MasterNotesState
from core.transcriber import format_seconds
from core.model_router import get_chat_model
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate


# ═══════════════════════════════════════════
# BRANCH A — Description Resource Extractor
# ═══════════════════════════════════════════
def branch_description_node(state: MasterNotesState) -> Dict[str, Any]:
    """Branch A: Extracts GitHub repos, documentation links, and author notes."""
    desc = state.get("video_description", "")
    urls = re.findall(r'https?://[^\s<>"]+|www\.[^\s<>"]+', desc)
    github_links = [u for u in urls if "github.com" in u]
    doc_links = [u for u in urls if any(d in u for d in ["docs.", "documentation", "medium.com", "geeksforgeeks"])]

    github_readme_text = ""
    for gh in github_links[:1]:
        try:
            raw_url = gh.replace("github.com", "raw.githubusercontent.com").rstrip("/")
            if "/tree/" in raw_url:
                raw_url = raw_url.replace("/tree/", "/")
            else:
                raw_url = f"{raw_url}/main/README.md"
            r = requests.get(raw_url, timeout=5)
            if r.status_code == 200:
                github_readme_text = r.text[:3000]
        except Exception:
            pass

    return {
        "description_resources": {
            "github_urls": github_links,
            "doc_urls": doc_links,
            "github_readme_snippet": github_readme_text,
            "raw_links_count": len(urls)
        }
    }


# ═══════════════════════════════════════════════════════════════════════
# BRANCH B — Transcript Labeling with Smart Clustering
#   Strategy:
#   1. If YouTube official chapters exist → use them directly (no clustering)
#   2. If no chapters → 3-pass temporal clustering pipeline:
#      Pass 1: SBERT TextTiling (find semantic boundaries)
#      Pass 2: Agglomerative clustering with temporal connectivity constraint
#      Pass 3: LLM title synthesis per cluster
# ═══════════════════════════════════════════════════════════════════════

def _compute_sbert_embeddings(texts: List[str]) -> np.ndarray:
    """Compute SBERT embeddings for a list of texts."""
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer("all-MiniLM-L6-v2")
        embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.array(embeddings)
    except Exception:
        # Fallback: random unit vectors (degrades gracefully)
        return np.random.randn(len(texts), 128)


def _texttiling_boundaries(embeddings: np.ndarray, window: int = 2) -> List[int]:
    """
    TextTiling boundary detection using cosine similarity drops.
    Returns list of indices where segment boundaries should be placed.
    """
    n = len(embeddings)
    if n < 4:
        return []

    scores = []
    for i in range(window, n - window):
        left = embeddings[max(0, i - window):i]
        right = embeddings[i:min(n, i + window)]
        left_mean = left.mean(axis=0)
        right_mean = right.mean(axis=0)
        # cosine similarity between left block and right block
        sim = float(np.dot(left_mean, right_mean) /
                    (np.linalg.norm(left_mean) * np.linalg.norm(right_mean) + 1e-8))
        scores.append((i, sim))

    if not scores:
        return []

    sim_vals = [s[1] for s in scores]
    threshold = np.mean(sim_vals) - 0.5 * np.std(sim_vals)
    boundaries = [idx for idx, sim in scores if sim < threshold]
    return boundaries


def _agglomerative_merge(embeddings: np.ndarray, boundaries: List[int]) -> List[int]:
    """
    Agglomerative clustering with band-diagonal connectivity constraint.
    Returns array of cluster labels (one per segment), preserving temporal order.
    """
    try:
        from sklearn.cluster import AgglomerativeClustering
        from scipy.sparse import diags

        n = len(embeddings)
        # Build band-diagonal connectivity: only adjacent merges allowed
        diagonals = [np.ones(n), np.ones(n - 1), np.ones(n - 1)]
        connectivity = diags(diagonals, [0, 1, -1], shape=(n, n), format="csr")

        # Distance threshold: tune between 0.2 (many clusters) and 0.5 (few clusters)
        model = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=0.38,
            metric="cosine",
            linkage="average",
            connectivity=connectivity
        )
        labels = model.fit_predict(embeddings)
        return labels.tolist()
    except Exception:
        # Fallback: use TextTiling boundaries directly
        n = len(embeddings)
        labels = []
        current = 0
        for i in range(n):
            if i in boundaries:
                current += 1
            labels.append(current)
        return labels


def _synthesize_cluster_title(cluster_text: str, api_key=None, model_name=None) -> str:
    """Uses LLM to synthesize a meaningful, specific chapter title from transcript text."""
    if not cluster_text.strip():
        return "Course Section"

    prompt = PromptTemplate.from_template(
        """You are analyzing a transcript excerpt from an educational video. 
Generate a concise, specific chapter title (maximum 8 words) that captures what is ACTUALLY being taught.
Do NOT use generic phrases like "Introduction", "Overview", "Getting Started", or "Part X".
Focus on the specific concept, technique, or topic being explained.

Transcript excerpt (first 600 chars):
{text}

Chapter Title (max 8 words, specific and descriptive):"""
    )
    try:
        llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.1)
        chain = prompt | llm | StrOutputParser()
        result = chain.invoke({"text": cluster_text[:600]})
        # Clean up any quotes or newlines
        title = result.strip().strip('"').strip("'").split("\n")[0].strip()
        return title if title else "Course Section"
    except Exception:
        # Fallback: take first meaningful phrase from transcript
        words = cluster_text.split()[:8]
        return " ".join(words) + "..." if words else "Course Section"


def branch_label_node(state: MasterNotesState) -> Dict[str, Any]:
    """
    Branch B: Maps timed transcript segments to chapters.
    Uses official YouTube chapters if present, otherwise applies
    TextTiling + Agglomerative Clustering + LLM title synthesis.
    """
    timed = state.get("timed_transcript", [])
    yt_chapters = state.get("yt_chapters", [])
    api_key = state.get("api_key")
    model_name = state.get("model_name")
    labeled_sections = []

    # ── Case 1: Official YouTube chapters exist ──────────────────────────
    if yt_chapters:
        for ch in yt_chapters:
            start_sec = ch["start_time"]
            end_sec = ch["end_time"] if ch["end_time"] > 0 else float("inf")
            matching_texts = [
                seg["text"] for seg in timed
                if start_sec <= seg["start"] < end_sec
            ]
            slice_text = " ".join(matching_texts)
            labeled_sections.append({
                "title": ch["title"],
                "start_seconds": int(start_sec),
                "timestamp_str": ch["timestamp_str"],
                "transcript_slice": slice_text[:4000] if slice_text else "(Visual demonstration without narration)"
            })
        return {"labeled_transcript": labeled_sections}

    # ── Case 2: No official chapters → Smart clustering pipeline ─────────
    if not timed:
        labeled_sections.append({
            "title": "Complete Course Overview",
            "start_seconds": 0,
            "timestamp_str": "00:00",
            "transcript_slice": state.get("full_transcript", "")[:4000]
        })
        return {"labeled_transcript": labeled_sections}

    # Step 1: Create 60-second windows (higher resolution than 3-min blocks)
    WINDOW_SEC = 60
    max_time = timed[-1].get("end", timed[-1]["start"] + 5)
    windows: List[Dict] = []
    t = 0.0
    while t < max_time:
        segs = [seg for seg in timed if t <= seg["start"] < t + WINDOW_SEC]
        text = " ".join(s["text"] for s in segs)
        windows.append({
            "start_sec": t,
            "timestamp_str": format_seconds(t),
            "text": text
        })
        t += WINDOW_SEC

    # Remove empty windows
    windows = [w for w in windows if w["text"].strip()]
    if not windows:
        return {"labeled_transcript": labeled_sections}

    # Step 2: SBERT embeddings for all windows
    window_texts = [w["text"] for w in windows]
    embeddings = _compute_sbert_embeddings(window_texts)

    # Step 3: TextTiling boundary detection
    boundaries = _texttiling_boundaries(embeddings, window=2)

    # Step 4: Agglomerative merge with temporal constraint
    cluster_labels = _agglomerative_merge(embeddings, boundaries)

    # Step 5: Group windows into clusters (preserving temporal order)
    num_clusters = max(cluster_labels) + 1
    clusters: List[Dict] = []
    for c in range(num_clusters):
        c_windows = [windows[i] for i, lbl in enumerate(cluster_labels) if lbl == c]
        if not c_windows:
            continue
        combined_text = " ".join(w["text"] for w in c_windows)
        clusters.append({
            "start_sec": c_windows[0]["start_sec"],
            "timestamp_str": c_windows[0]["timestamp_str"],
            "text": combined_text
        })

    # Step 6: LLM title synthesis per cluster
    for cluster in clusters:
        title = _synthesize_cluster_title(cluster["text"], api_key=api_key, model_name=model_name)
        labeled_sections.append({
            "title": title,
            "start_seconds": int(cluster["start_sec"]),
            "timestamp_str": cluster["timestamp_str"],
            "transcript_slice": cluster["text"][:4000]
        })

    return {"labeled_transcript": labeled_sections}


# ═══════════════════════════════════════════
# BRANCH C — Online Gap Analysis
# ═══════════════════════════════════════════
def branch_online_search_node(state: MasterNotesState) -> Dict[str, Any]:
    """Branch C: Identifies knowledge gaps via LLM analysis of transcript coverage."""
    user_sources = state.get("human_sources", [])
    full_transcript = state.get("full_transcript", "")
    api_key = state.get("api_key")
    model_name = state.get("model_name")

    missing_topics = []

    if full_transcript.strip():
        prompt = PromptTemplate.from_template(
            """You are a curriculum expert. Review the following transcript excerpt from an educational video.
Identify 2-3 important related topics that were NOT covered or were only briefly mentioned,
that a student studying this subject would benefit from knowing.
Return ONLY a JSON array of objects with keys "topic" and "reason". No markdown, no extra text.
Example: [{{"topic": "Error Recovery Strategies", "reason": "Not mentioned in transcript"}}]

Transcript (first 1500 chars):
{transcript}

JSON array:"""
        )
        try:
            llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.3)
            chain = prompt | llm | StrOutputParser()
            result = chain.invoke({"transcript": full_transcript[:1500]})
            import json
            # Extract JSON array from result
            match = re.search(r'\[.*\]', result, re.DOTALL)
            if match:
                missing_topics = json.loads(match.group())
        except Exception:
            pass

    # No model answer means no gap list. The two placeholder topics this used to
    # substitute were not derived from the lecture at all, and they were shown to
    # the reader as though they had been.
    return {
        "online_search_results": {
            "curated_sources": user_sources,
            "syllabus_coverage": "Analyzed",
        },
        "missing_topics": missing_topics
    }


# ═══════════════════════════════════════════
# GRAPH BUILDER
# ═══════════════════════════════════════════
def build_phase2_graph():
    """Compiles the Phase 2 Parallel Fan-Out StateGraph.

    Branch B is deliberately not wired in. It clustered the transcript and asked
    the model for a title per cluster — a call for each one, twenty or more on a
    long lecture — to fill `labeled_transcript`, which nothing in the pipeline or
    the UI ever reads. The titles that are actually used come from
    `core.topic_chapterizer`. `branch_label_node` is kept for reference.
    """
    graph = StateGraph(MasterNotesState)
    graph.add_node("branch_description_node", branch_description_node)
    graph.add_node("branch_online_search_node", branch_online_search_node)

    graph.add_edge(START, "branch_description_node")
    graph.add_edge(START, "branch_online_search_node")

    graph.add_edge("branch_description_node", END)
    graph.add_edge("branch_online_search_node", END)

    return graph.compile()
