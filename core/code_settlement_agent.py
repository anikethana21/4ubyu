"""
4 U By U — Grounded Code Procurement & Temporal Settlement Agent
- Automatically extracts GitHub repo URLs from video descriptions.
- Clones / fetches ground-truth source code directly from GitHub trees.
- Parses AST symbols (Classes, Functions, Nodes, Edges, Reducers).
- Aligns and settles code into the exact chapters, sections, and timestamps
  using lexical symbol matching, semantic affinity, and chronological monotonicity.
- Provides granular code slicing (State Schema vs Nodes vs Graph Assembly).
"""

import os
import re
import ast
import requests
from typing import Dict, List, Any, Optional

def extract_github_repos(description: str) -> List[str]:
    """Extracts GitHub repository links from video description."""
    if not description:
        return []
    urls = re.findall(r'https?://github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+', description)
    clean_urls = []
    for u in urls:
        u = u.rstrip(".,/!?;:")
        if u not in clean_urls and not u.endswith("/"):
            clean_urls.append(u)
    return clean_urls

def fetch_github_code_files(github_url: str, local_fallback_dir: Optional[str] = None) -> Dict[str, str]:
    """Fetches all code files from GitHub repository via API, raw files, or local directory."""
    code_map: Dict[str, str] = {}

    # Check local fallback directory first if available
    if local_fallback_dir and os.path.exists(local_fallback_dir):
        for root, _, files in os.walk(local_fallback_dir):
            for f in files:
                if f.endswith((".py", ".js", ".ts", ".ipynb")):
                    p = os.path.join(root, f)
                    try:
                        with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                            code_map[f] = fp.read()
                    except Exception:
                        pass
        if code_map:
            print(f"[CodeSettlementAgent] Loaded {len(code_map)} code files from local repository mirror.")
            return code_map

    m = re.search(r"github\.com/([^/]+)/([^/\s?#]+)", github_url)
    if not m:
        return code_map
    owner, repo = m.group(1), m.group(2).rstrip(".git")

    for branch in ["main", "master"]:
        api_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
        try:
            r = requests.get(api_url, headers={"User-Agent": "4-U-By-U-Agent"}, timeout=8)
            if r.status_code == 200:
                tree = r.json().get("tree", [])
                file_paths = [item["path"] for item in tree if item["path"].endswith((".py", ".js", ".ts", ".ipynb"))]
                for fp in file_paths:
                    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{fp}"
                    raw_r = requests.get(raw_url, headers={"User-Agent": "4-U-By-U-Agent"}, timeout=8)
                    if raw_r.status_code == 200:
                        code_map[fp] = raw_r.text
                if code_map:
                    print(f"[CodeSettlementAgent] Fetched {len(code_map)} files from GitHub ({owner}/{repo} branch {branch}).")
                    break
        except Exception as e:
            print(f"[CodeSettlementAgent] GitHub API fetch notice: {e}")

    return code_map

def parse_python_ast(filename: str, code: str) -> Dict[str, Any]:
    """Extracts AST symbols, line ranges, and logical segments."""
    classes = []
    functions = []
    imports = []
    slices = {
        "state_schema": "",
        "node_functions": "",
        "graph_wiring": "",
        "full_file": code
    }

    try:
        lines = code.split("\n")
        tree = ast.parse(code)
        
        schema_lines = []
        node_lines = []
        wiring_lines = []

        for node in tree.body:
            start_l = node.lineno - 1
            end_l = getattr(node, "end_lineno", node.lineno)
            node_code = "\n".join(lines[start_l:end_l])

            if isinstance(node, ast.ClassDef):
                classes.append(node.name)
                schema_lines.append(node_code)
            elif isinstance(node, ast.FunctionDef):
                functions.append(node.name)
                node_lines.append(node_code)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.Import):
                    for n in node.names:
                        imports.append(n.name)
                elif node.module:
                    imports.append(node.module)
                schema_lines.append(node_code)
            else:
                wiring_lines.append(node_code)

        if schema_lines:
            slices["state_schema"] = "\n\n".join(schema_lines)
        if node_lines:
            slices["node_functions"] = "\n\n".join(node_lines)
        if wiring_lines:
            slices["graph_wiring"] = "\n\n".join(wiring_lines)

    except Exception:
        pass

    return {
        "filename": filename,
        "classes": classes,
        "functions": functions,
        "imports": imports,
        "all_symbols": classes + functions,
        "slices": slices,
        "code": code
    }

def _tokenize(text: str) -> set:
    words = re.findall(r'[a-zA-Z0-9]+', text.lower())
    result = set(words)
    # subword extraction for un-underscored filenames like humanintheloop
    for w in words:
        for sub in ["human", "loop", "rag", "iterative", "parallel", "sequential", "reducer", "state"]:
            if sub in w:
                result.add(sub)
    return result

def compute_settlement_affinity(
    chapter_title: str,
    section_title: str,
    transcript_slice: str,
    parsed_file: Dict[str, Any]
) -> float:
    """
    Computes Settlement Affinity Score A(C_i, S_j) using:
    - 1. Subword filename-to-chapter keyword match
    - 2. Lexical symbol overlap (AST class/function names in transcript)
    - 3. Contextual word overlap
    """
    score = 0.0
    fn_tokens = _tokenize(parsed_file["filename"])
    ch_tokens = _tokenize(chapter_title)
    sec_tokens = _tokenize(section_title)
    t_lower = transcript_slice.lower()

    # Filename to chapter subword overlap (weighted heavily)
    overlap = fn_tokens.intersection(ch_tokens)
    score += len(overlap) * 5.0

    # AST symbol occurrences in spoken transcript
    for sym in parsed_file["all_symbols"]:
        sym_clean = re.sub(r"[_\-]+", " ", sym.lower())
        if sym.lower() in t_lower or sym_clean in t_lower:
            score += 3.0

    # Section title overlap
    sec_overlap = fn_tokens.intersection(sec_tokens)
    score += len(sec_overlap) * 2.0

    # Penalize generic files like states.py if a specific file exists
    if parsed_file["filename"].lower() in ["states.py", "app.py"]:
        score -= 1.0

    return score

def _chapter_transcript(ch: Dict[str, Any]) -> str:
    if ch.get("transcript"):
        return ch["transcript"]
    sections = ch.get("sections") or []
    if sections:
        combined = " ".join([s.get("transcript_slice", "") for s in sections if s.get("transcript_slice")])
        if combined.strip():
            return combined
        return sections[0].get("transcript_slice") or ""
    return ""


def _symbol_hits_in_transcript(parsed_file: Dict[str, Any], transcript: str) -> int:
    t_lower = (transcript or "").lower()
    hits = 0
    for sym in parsed_file.get("all_symbols", []):
        sym_clean = re.sub(r"[_\-]+", " ", sym.lower())
        if sym.lower() in t_lower or sym_clean in t_lower:
            hits += 1
    return hits


def settle_procured_code(
    chapters: List[Dict[str, Any]],
    code_files: Dict[str, str],
    timed_transcript: List[Dict[str, Any]],
    min_affinity: float = 6.0,
) -> List[Dict[str, Any]]:
    """
    One repo file → at most one chapter. Code attaches only when transcript + filename
    affinity is strong (prevents cross-chapter code pollution).
    """
    parsed_files = [parse_python_ast(fn, code) for fn, code in code_files.items()]
    if not parsed_files:
        return chapters

    MIN_AFFINITY = min_affinity
    pairs: List[tuple[float, int, Dict[str, Any]]] = []

    for ch_idx, ch in enumerate(chapters):
        ch_title = ch.get("title") or ch.get("chapter_title", "")
        sections = ch.get("sections") or []
        sec_title = (
            sections[0].get("section_title", ch_title) if sections else ch_title
        )
        ch_transcript = _chapter_transcript(ch)

        for pf in parsed_files:
            aff = compute_settlement_affinity(ch_title, sec_title, ch_transcript, pf)
            sym_hits = _symbol_hits_in_transcript(pf, ch_transcript)
            if sym_hits:
                aff += sym_hits * 2.0
            if aff >= MIN_AFFINITY:
                pairs.append((aff, ch_idx, pf))

    pairs.sort(key=lambda x: x[0], reverse=True)
    used_files: set[str] = set()
    chapter_file: Dict[int, Dict[str, Any]] = {}

    for aff, ch_idx, pf in pairs:
        fn = pf["filename"]
        if fn in used_files or ch_idx in chapter_file:
            continue
        chapter_file[ch_idx] = pf
        used_files.add(fn)
        ch = chapters[ch_idx]
        print(
            f"[CodeSettlement] '{fn}' → Chapter '{ch.get('title') or ch.get('chapter_title')}' "
            f"(affinity {aff:.1f})"
        )

    for ch_idx, ch in enumerate(chapters):
        pf = chapter_file.get(ch_idx)
        sections = ch.get("sections") or []
        if not pf or not sections:
            for sec in sections:
                sec.pop("procured_code", None)
                sec["is_grounded_repo_code"] = False
            continue

        for idx, sec in enumerate(sections):
            sec_title = sec.get("section_title") or sec.get("title") or ""
            sec_lower = sec_title.lower()
            sec_transcript = sec.get("transcript_slice") or _chapter_transcript(ch)

            if not _symbol_hits_in_transcript(pf, sec_transcript) and not any(
                tok in sec_lower for tok in ["code", "implement", "project", "hands-on", "build"]
            ):
                sec.pop("procured_code", None)
                sec["is_grounded_repo_code"] = False
                continue

            if "state" in sec_lower or "schema" in sec_lower:
                assigned_code = pf["slices"].get("state_schema") or pf["code"]
                slice_name = "State Schema Definition"
            elif "node" in sec_lower or "function" in sec_lower:
                assigned_code = pf["slices"].get("node_functions") or pf["code"]
                slice_name = "Pure Node Logic"
            else:
                assigned_code = pf["code"]
                slice_name = "Matched Repository Module"

            sec["procured_code"] = assigned_code
            sec["procured_filename"] = pf["filename"]
            sec["procured_symbols"] = pf["all_symbols"]
            sec["procured_slice_type"] = slice_name
            sec["is_grounded_repo_code"] = True

    return chapters
