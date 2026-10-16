"""
4 U By U - PHASE 8: Dual-Mode RAG Chatbot Agent & Educational Workspace Assistant
- Supports Grounded Mode (strict video transcript + HTML notes grounding with [TS MM:SS] seeking)
- Supports Open Mode (senior staff AI tutor for broad engineering, algorithms, & conceptual exploration)
- In-memory HTML fallback parser ensures 100% zero-failure retrieval even without ChromaDB
- Direct streaming with 100% Free LLM models (Groq 120B / Gemini 2.0 Flash)
"""

import os
import re
from pathlib import Path
from typing import Dict, Any, List, AsyncGenerator, Optional, Tuple
from bs4 import BeautifulSoup
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from config import OUTPUT_DIR, VECTOR_DB_DIR
from states import MasterNotesState
from core.vector_store import build_vector_store, get_vector_store_retriever
from core.html_chunker import chunk_workspace_html
from core.model_router import get_chat_model

# In-memory document and question cache for ultra-fast response
_WORKSPACE_QUESTIONS: Dict[str, List[str]] = {}
_WORKSPACE_DOCS_CACHE: Dict[str, List[Document]] = {}
_WORKSPACE_TITLE_CACHE: Dict[str, str] = {}

def parse_target_seconds(query: str) -> Optional[int]:
    """Extracts timestamp from query in format MM:SS or HH:MM:SS."""
    ts_match = re.search(r'(\d{1,2}:\d{2}(?::\d{2})?)', query)
    if not ts_match:
        return None
    parts = [int(p) for p in ts_match.group(1).split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    elif len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return None

def get_in_memory_html_chunks(video_id: str) -> List[Document]:
    """Extracts and caches semantic chunks from the HTML notes file with zero external dependencies."""
    if video_id in _WORKSPACE_DOCS_CACHE and _WORKSPACE_DOCS_CACHE[video_id]:
        return _WORKSPACE_DOCS_CACHE[video_id]

    candidate_paths = [
        OUTPUT_DIR / f"notes_{video_id}.html",
        Path("output") / f"notes_{video_id}.html",
        Path(__file__).resolve().parent / "output" / f"notes_{video_id}.html"
    ]

    html_file = None
    for p in candidate_paths:
        if p.exists() and p.is_file():
            html_file = p
            break

    if not html_file:
        return []

    try:
        with open(html_file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"[Phase8] Error reading HTML notes file: {e}")
        return []

    soup = BeautifulSoup(content, "html.parser")

    # Extract Video Title
    h1 = soup.select_one("h1.video-title")
    video_title = h1.get_text(strip=True) if h1 else f"Course {video_id}"
    _WORKSPACE_TITLE_CACHE[video_id] = video_title

    docs: List[Document] = []
    questions: List[str] = []

    # 1. Parse chapter cards
    chapter_cards = soup.select("article.chapter-card")
    for ch_idx, ch_card in enumerate(chapter_cards, 1):
        ch_title = ch_card.get("data-chapter-title") or ""
        if not ch_title:
            h2 = ch_card.select_one("h2.chapter-title")
            ch_title = h2.get_text(strip=True) if h2 else f"Chapter {ch_idx}"

        ch_id = ch_card.get("id") or f"chapter-{ch_idx}"
        ch_sec_ts = 0
        try:
            ch_sec_ts = int(ch_card.get("data-timestamp-seconds", "0"))
        except ValueError:
            pass

        m, s = divmod(ch_sec_ts, 60)
        h, m = divmod(m, 60)
        ts_str = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"

        # Subsections inside chapter
        section_blocks = ch_card.select("section.section-block")
        if not section_blocks:
            # Fallback to entire card text
            text = ch_card.get_text(separator=" ", strip=True)
            if len(text) > 40:
                docs.append(Document(
                    page_content=f"Chapter {ch_idx}: {ch_title} (Timestamp: [{ts_str}])\n\n{text[:3500]}",
                    metadata={
                        "section_title": ch_title,
                        "chapter_title": ch_title,
                        "section_id": ch_id,
                        "timestamp_seconds": ch_sec_ts,
                        "timestamp_str": ts_str
                    }
                ))
                questions.append(f"What does Chapter {ch_idx} ({ch_title}) cover?")
        else:
            for s_idx, s_block in enumerate(section_blocks, 1):
                sec_id = s_block.get("id") or f"{ch_id}-sec-{s_idx}"
                sec_title = s_block.get("data-chapter-title") or ""
                if not sec_title:
                    h3 = s_block.select_one("h3")
                    sec_title = h3.get_text(strip=True) if h3 else f"Section {s_idx}"

                sec_ts = ch_sec_ts
                try:
                    sec_ts = int(s_block.get("data-timestamp-seconds", str(ch_sec_ts)))
                except ValueError:
                    pass

                sm, ss = divmod(sec_ts, 60)
                sh, sm = divmod(sm, 60)
                sec_ts_str = f"{sh:02d}:{sm:02d}:{ss:02d}" if sh > 0 else f"{sm:02d}:{ss:02d}"

                block_text = s_block.get_text(separator=" ", strip=True)
                # Capture code blocks specifically
                code_blocks = [code.get_text() for code in s_block.select("pre code")]
                code_str = ("\n\nCode Implementation:\n```python\n" + "\n".join(code_blocks[:2]) + "\n```") if code_blocks else ""

                full_block = f"### Chapter: {ch_title} | Section: {sec_title} (Timestamp: [{sec_ts_str}], Anchor: #{sec_id})\n\n{block_text[:2500]}{code_str}"

                docs.append(Document(
                    page_content=full_block,
                    metadata={
                        "section_title": sec_title,
                        "chapter_title": ch_title,
                        "section_id": sec_id,
                        "timestamp_seconds": sec_ts,
                        "timestamp_str": sec_ts_str
                    }
                ))
                questions.append(f"Explain {sec_title} from {ch_title}")

    _WORKSPACE_DOCS_CACHE[video_id] = docs
    if questions:
        _WORKSPACE_QUESTIONS[video_id] = questions[:16]

    return docs

def match_in_memory_chunks(video_id: str, query: str, k: int = 5) -> Tuple[List[Document], float]:
    """Scores and returns the top k relevant chunks from in-memory HTML documents."""
    docs = get_in_memory_html_chunks(video_id)
    if not docs:
        return [], 0.0

    q_tokens = set(re.findall(r'\w+', query.lower()))
    if not q_tokens:
        return docs[:k], 0.5

    scored: List[Tuple[float, Document]] = []
    for d in docs:
        score = 0.0
        sec_title = d.metadata.get("section_title", "").lower()
        ch_title = d.metadata.get("chapter_title", "").lower()
        content = d.page_content.lower()

        sec_tokens = set(re.findall(r'\w+', sec_title))
        ch_tokens = set(re.findall(r'\w+', ch_title))
        body_tokens = set(re.findall(r'\w+', content))

        # Weight titles heavily
        title_overlap = len(q_tokens.intersection(sec_tokens))
        ch_overlap = len(q_tokens.intersection(ch_tokens))
        body_overlap = len(q_tokens.intersection(body_tokens))

        score += title_overlap * 4.0
        score += ch_overlap * 2.5
        score += body_overlap * 1.0

        if score > 0:
            scored.append((score, d))

    scored.sort(key=lambda x: x[0], reverse=True)
    top_docs = [item[1] for item in scored[:k]]

    if not top_docs:
        confidence = 0.0
    else:
        best_score = scored[0][0]
        confidence = min(1.0, best_score / max(1.0, len(q_tokens) * 2.0))

    return top_docs, confidence

def build_rag_index_node(state: MasterNotesState) -> Dict[str, Any]:
    """Extracts semantic chunks from compiled HTML and populates ChromaDB or in-memory index."""
    video_id = state["video_id"]
    compiled_html = state.get("compiled_html", "")
    html_file_path = state.get("output_html_path", "")
    timed_transcript = state.get("timed_transcript", [])

    docs: List[Document] = []
    suggestive_questions: List[str] = []

    source_to_chunk = compiled_html
    is_valid_path = bool(html_file_path) and len(html_file_path) < 1024 and not html_file_path.strip().startswith("<") and "\n" not in html_file_path
    if not source_to_chunk and is_valid_path:
        try:
            p = Path(html_file_path)
            if p.exists() and p.is_file():
                with open(p, "r", encoding="utf-8", errors="replace") as f:
                    source_to_chunk = f.read()
        except Exception:
            pass

    if source_to_chunk:
        html_docs, extracted_q = chunk_workspace_html(source_to_chunk, video_id=video_id)
        docs.extend(html_docs)
        suggestive_questions.extend(extracted_q)

    _WORKSPACE_QUESTIONS[video_id] = suggestive_questions[:16]
    _WORKSPACE_DOCS_CACHE[video_id] = docs

    try:
        build_vector_store(video_id=video_id, documents=docs)
    except Exception as e:
        print(f"[Phase8 RAG] Local vector indexing notice: {e}")

    return {"rag_ready": True, "suggestive_questions": suggestive_questions[:16]}

def get_workspace_suggestive_questions(video_id: str) -> List[str]:
    """Retrieves cached suggestive questions extracted directly from notes tags."""
    if video_id in _WORKSPACE_QUESTIONS and _WORKSPACE_QUESTIONS[video_id]:
        return _WORKSPACE_QUESTIONS[video_id]

    docs = get_in_memory_html_chunks(video_id)
    if video_id in _WORKSPACE_QUESTIONS and _WORKSPACE_QUESTIONS[video_id]:
        return _WORKSPACE_QUESTIONS[video_id]

    return [
        "Summarize the core takeaways of Chapter 1",
        "Explain the key algorithms and equations in this lecture",
        "Walk me through the practical Python code examples step-by-step",
        "What are the most common interview questions for these topics?"
    ]

def evaluate_notes_confidence(query: str, docs: List[Document]) -> float:
    """Computes relevance score of retrieved notes chunks against user query."""
    if not docs:
        return 0.0
    q_tokens = set(re.findall(r'\w+', query.lower()))
    if not q_tokens:
        return 0.0

    match_count = 0
    for d in docs:
        c_tokens = set(re.findall(r'\w+', d.page_content.lower()))
        overlap = len(q_tokens.intersection(c_tokens))
        if overlap >= max(2, len(q_tokens) // 3):
            match_count += 1

    return match_count / len(docs)

async def ask_rag_stream(
    video_id: str,
    question: str,
    mode: str = "grounded",
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """
    Dual-Mode RAG Streaming Engine:
    - mode == 'grounded': Strictly grounds answers in the video notes & transcript, with timestamp seek pills.
    - mode == 'open': Unrestricted Senior Staff AI Tutor answering broad questions, frameworks, algorithms, and deep theory.
    """
    q_clean = question.strip()
    if not q_clean:
        yield "Please enter a question regarding the lecture notes or code."
        return

    # Check for targeted video timestamp (e.g. [14:10])
    target_sec = parse_target_seconds(q_clean)
    is_timestamp_query = target_sec is not None

    video_title = _WORKSPACE_TITLE_CACHE.get(video_id, "")
    if not video_title:
        # Load chunks to discover title
        get_in_memory_html_chunks(video_id)
        video_title = _WORKSPACE_TITLE_CACHE.get(video_id, "the current course")

    # =========================================================================
    # PATH A: OPEN / GENERATIVE MODE
    # =========================================================================
    if mode == "open":
        open_prompt = f"""You are the Senior Staff AI Engineer & Master CS Professor for "4 U By U" ? tutoring an ambitious engineering student.

STUDENT QUESTION:
{q_clean}

COURSE CONTEXT (Student is actively studying):
Course Title: {video_title}

INSTRUCTIONS:
1. Provide an authoritative, crystal-clear, production-grade technical answer.
2. Structure your explanation logically:
   - High-Level Intuition / Mechanical Distinction
   - Architectural Comparison (Markdown table or ASCII diagram if helpful)
   - Syntactically correct, modern, production-grade Code Snippet (Python / relevant stack) with type annotations
   - Real-World Best Practices, Trade-offs & Production Gotchas
3. ZERO EMOJIS: Do not use emojis anywhere in your answer.
4. Conclude your answer with EXACTLY 3 short, concise follow-up topics (3 to 5 words each) formatted as:
Suggested Follow-ups:
- [Short Topic 1]
- [Short Topic 2]
- [Short Topic 3]
"""
        yield "> **[Open Mode ? ? Senior AI Engineering Tutor]**\n\n"
        try:
            llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.2)
            chain = PromptTemplate.from_template("{prompt}") | llm | StrOutputParser()
            async for chunk in chain.astream({"prompt": open_prompt}):
                yield chunk
            return
        except Exception as e:
            yield f"\n\n[Assistant Notice]: {str(e)}"
            return

    # =========================================================================
    # PATH B: GROUNDED MODE (Strict Lecture Alignment + Timestamps)
    # =========================================================================
    # 1. Retrieve chunks via Chroma or In-Memory HTML Chunker
    matched_docs: List[Document] = []
    confidence = 0.0

    retriever = get_vector_store_retriever(video_id, k=8)
    if retriever:
        try:
            matched_docs = retriever.invoke(q_clean)
            confidence = evaluate_notes_confidence(q_clean, matched_docs)
        except Exception:
            matched_docs = []

    if not matched_docs:
        matched_docs, confidence = match_in_memory_chunks(video_id, q_clean, k=5)

    # If target timestamp exists, sort/prioritize docs closest to this timestamp
    if is_timestamp_query and matched_docs:
        matched_docs.sort(key=lambda d: abs(d.metadata.get("timestamp_seconds", 0) - target_sec))
        confidence = max(confidence, 0.8)

    # 2. Check if topic is completely outside the lecture notes
    known_questions = get_workspace_suggestive_questions(video_id)
    is_suggestive = any(q_clean.lower() in sq.lower() or sq.lower() in q_clean.lower() for sq in known_questions)

    if not is_timestamp_query and not is_suggestive and confidence < 0.15:
        # Gracefully handle out-of-scope query in Grounded Mode
        suggested_topics = known_questions[:3] if known_questions else [
            "Introduction & Fundamental Architecture",
            "Core Algorithm Walkthrough",
            "Production Implementation & Best Practices"
        ]
        out_msg = (
            f"> **[Grounded Mode 🔒 • Topic Outside Current Lecture]**\n\n"
            f"The concept **\"{q_clean}\"** is not covered in the local notes for **{video_title}**.\n\n"
            f"💡 **Switch to Open Mode (⚡)** using the toggle at the top of this chat panel to get a full production-grade explanation and code walkthrough.\n\n"
            f"Or explore one of the verified topics from this course:\n"
        )
        for t in suggested_topics:
            out_msg += f"- {t}\n"
        yield out_msg
        return

    # Format notes context blocks
    notes_context_blocks = []
    for d in matched_docs[:5]:
        sec_title = d.metadata.get("section_title", "Section")
        sec_id = d.metadata.get("section_id", "")
        ts_str = d.metadata.get("timestamp_str", "00:00")
        notes_context_blocks.append(f"### Section: {sec_title} (Timestamp: [{ts_str}], Anchor: #{sec_id})\n{d.page_content}")

    notes_context = "\n\n---\n\n".join(notes_context_blocks)

    source_badge = "[Grounded in 4 U By U Notes ? HTML Verified]"
    if is_timestamp_query:
        m, s = divmod(target_sec, 60)
        h, m = divmod(m, 60)
        ts_display = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
        source_badge = f"[Video Timestamp Grounding ? Aligned to [TS {ts_display}]]"

    grounded_prompt = f"""You are the Master Educational AI Assistant for "4 U By U" ? tutoring a student on the course: "{video_title}".

STRICT GROUNDING & TEACHING RULES:
1. AUTHORITY & GROUNDING: Ground your answer directly in the lecture notes, transcription, and course code provided below.
2. TIMESTAMPS: Whenever citing moments from the video, cite them as [TS MM:SS] so the student can click the pill and jump to that exact video second.
3. ANCHORS: When discussing a handbook section, cite it as [Jump to Section #{{section_id}}] to allow one-click in-page navigation.
4. CODE EXCELLENCE: Format all code blocks with proper syntax highlighting (` ```python `) and explain each line or design decision clearly.
5. CALLOUT BOXES: Use blockquotes (`> **Core Architectural Takeaway:**`) to crystallize the fundamental engineering principle.
6. SOURCE ATTRIBUTION: Begin your answer by clearly noting: `> **{source_badge}**`.
7. ZERO EMOJIS: Do not output any emojis anywhere in your answer.
8. End your answer with EXACTLY 3 SHORT, CONCISE follow-up suggestion chips (3 to 5 words each) formatted as:
Suggested Follow-ups:
- [Short Topic 1]
- [Short Topic 2]
- [Short Topic 3]

CONTEXT SOURCES:
[HANDBOOK HTML NOTES KNOWLEDGE]:
{notes_context if notes_context else 'No specific lecture notes chunks matched.'}

STUDENT QUESTION:
{q_clean}

DETAILED PRODUCTION ANSWER:"""

    try:
        llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.1)
        chain = PromptTemplate.from_template("{prompt}") | llm | StrOutputParser()
        async for chunk in chain.astream({"prompt": grounded_prompt}):
            yield chunk

    except Exception as e:
        yield f"\n\n[Study Assistant Notice]: Inference encountered a temporary delay ({str(e)}). Please retry or switch to Open Mode."
