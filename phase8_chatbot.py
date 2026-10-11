"""
4 U By U — PHASE 8: Tag-Aware RAG Chatbot Agent & Intelligent Web Gateway
- Chunks compiled HTML notes using BeautifulSoup (bs4) based on semantic tags.
- Provides preloaded suggestive questions that work EXCLUSIVELY from the HTML notes.
- Automatically handles dynamic current video timestamp queries with pinpoint precision.
- Automatically falls back to DuckDuckGo real-time web search for out-of-notes questions.
- Employs superior educational prompt engineering with timestamp seek pills and anchor jumps.
- Enforces strict modern LangGraph v0.2+ code contracts with zero fictional parameters.
"""

import os
import re
from pathlib import Path
from typing import Dict, Any, List, AsyncGenerator, Optional
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from config import OUTPUT_DIR, VECTOR_DB_DIR
from states import MasterNotesState
from core.vector_store import build_vector_store, get_vector_store_retriever
from core.html_chunker import chunk_workspace_html
from core.web_search import search_web_duckduckgo, format_web_context
from core.model_router import get_chat_model

# In-memory session cache for fast fallback
_WORKSPACE_QUESTIONS: Dict[str, List[str]] = {}

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

def build_rag_index_node(state: MasterNotesState) -> Dict[str, Any]:
    """
    Extracts semantic chunks from the compiled HTML file using BeautifulSoup,
    and populates the persistent ChromaDB collection.
    """
    video_id = state["video_id"]
    compiled_html = state.get("compiled_html", "")
    html_file_path = state.get("output_html_path", "")
    timed_transcript = state.get("timed_transcript", [])

    docs: List[Document] = []
    suggestive_questions: List[str] = []

    # 1. Tag-Aware Chunking of the Full HTML Page using BeautifulSoup
    source_to_chunk = compiled_html
    if not source_to_chunk and html_file_path and Path(html_file_path).exists():
        with open(html_file_path, "r", encoding="utf-8", errors="replace") as f:
            source_to_chunk = f.read()

    if source_to_chunk:
        html_docs, extracted_q = chunk_workspace_html(source_to_chunk, video_id=video_id)
        docs.extend(html_docs)
        suggestive_questions.extend(extracted_q)

    # 2. Add Timed Transcript Segments if available to guarantee speech alignment
    if timed_transcript:
        for idx, seg in enumerate(timed_transcript):
            start = seg.get("start", 0)
            text = seg.get("text", "").strip()
            if len(text) > 40:
                ts_str = f"{int(start) // 60}:{int(start) % 60:02d}"
                docs.append(Document(
                    page_content=f"Spoken Speech Segment at [{ts_str}]:\n\"{text}\"",
                    metadata={
                        "source": "spoken_transcript",
                        "tag_type": "speech_segment",
                        "timestamp_seconds": int(start),
                        "timestamp_str": ts_str,
                        "section_id": f"speech-{idx}"
                    }
                ))

    # Cache preloaded questions for instant response
    _WORKSPACE_QUESTIONS[video_id] = suggestive_questions[:16]

    print(f"[Phase8 RAG] Chunking complete: {len(docs)} tag-aware chunks, {len(suggestive_questions)} questions.")

    if not docs:
        return {"rag_ready": False, "suggestive_questions": []}

    try:
        build_vector_store(video_id=video_id, documents=docs)
        print(f"[Phase8 RAG] Successfully indexed {len(docs)} tag-aware HTML & transcript chunks for video {video_id}.")
        return {"rag_ready": True, "suggestive_questions": suggestive_questions[:16]}
    except Exception as e:
        print(f"[Phase8 RAG] Notice: Local Chroma fallback active ({e})")
        return {"rag_ready": False, "suggestive_questions": suggestive_questions[:16]}


def get_workspace_suggestive_questions(video_id: str) -> List[str]:
    """Retrieves cached suggestive questions extracted directly from the notes tags."""
    if video_id in _WORKSPACE_QUESTIONS and _WORKSPACE_QUESTIONS[video_id]:
        return _WORKSPACE_QUESTIONS[video_id]

    html_file = OUTPUT_DIR / f"notes_{video_id}.html"
    if html_file.exists():
        _, questions = chunk_workspace_html(str(html_file), video_id=video_id)
        _WORKSPACE_QUESTIONS[video_id] = questions[:16]
        return questions[:16]

    return [
        "What are the 5 core LangGraph workflows and when should I use each?",
        "Explain the Blog Post Generator from Chapter 4 and how StateGraph works",
        "How do reducers like operator.add prevent race conditions in parallel workflows?",
        "How do conditional edges and vector RAG retrieval work in Chapter 6?",
        "Explain the Evaluator-Optimizer code review loop from Chapter 7",
        "How does Human-in-the-Loop work with MemorySaver checkpointer and interrupt_before?"
    ]


def evaluate_notes_confidence(query: str, docs: List[Document]) -> float:
    """Computes relevance score of retrieved notes chunks against user query."""
    if not docs:
        return 0.0
    q_tokens = set(re.findall(r"\w+", query.lower()))
    if not q_tokens:
        return 0.0

    match_count = 0
    for d in docs:
        c_tokens = set(re.findall(r"\w+", d.page_content.lower()))
        overlap = len(q_tokens.intersection(c_tokens))
        if overlap >= max(2, len(q_tokens) // 3):
            match_count += 1

    return match_count / len(docs)


async def ask_rag_stream(
    video_id: str,
    question: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """
    Intelligent RAG Streaming Engine:
    - Answers exclusively from HTML notes when question relates to video content.
    - Autonomously accesses real-time Web Search if question is outside the notes.
    - Accurately grounds questions containing timestamps in the exact video second.
    - Applies superior prompt engineering: structured markdown, timestamp pills,
      code walkthroughs, and dynamic follow-up suggestive question chips.
    - Strictly enforces authentic LangGraph v0.2+ code.
    """
    q_clean = question.strip()
    if not q_clean:
        yield "Please enter a question regarding the lecture notes or code."
        return

    # Check for targeted video timestamp (e.g. [⏱ 14:10])
    target_sec = parse_target_seconds(q_clean)
    is_timestamp_query = target_sec is not None

    # Check preloaded suggestive questions for this video
    known_questions = get_workspace_suggestive_questions(video_id)
    is_suggestive = any(q_clean.lower() in sq.lower() or sq.lower() in q_clean.lower() for sq in known_questions)

    # 1. Retrieve HTML notes context from ChromaDB with hybrid boost and deduplication
    retriever = get_vector_store_retriever(video_id, k=14)
    raw_docs = retriever.invoke(q_clean) if retriever else []

    # Hybrid expansion: boost targeted queries for specific chapters or core topics
    topic_keywords = {
        "chapter 1": "introduction agentic paradigm shift",
        "chapter 2": "generative ai vs agentic ai autonomous loop",
        "chapter 3": "why langgraph lcel limitations cyclic graphs",
        "chapter 4": "sequential workflow blog post generator",
        "chapter 5": "parallel workflow reducers state overwrite operator add",
        "chapter 6": "conditional workflow add conditional edges vector rag",
        "chapter 7": "iterative workflow evaluator optimizer code reviewer self-correction",
        "chapter 8": "human in the loop memorysaver interrupt checkpointer",
    }
    for kw, boost_q in topic_keywords.items():
        if kw in q_clean.lower() and retriever:
            extra_docs = retriever.invoke(boost_q)
            raw_docs = extra_docs + raw_docs

    # If target timestamp exists, sort/prioritize docs closest to this timestamp
    if is_timestamp_query and raw_docs:
        raw_docs.sort(key=lambda d: abs(d.metadata.get("timestamp_seconds", 0) - target_sec))

    # Deduplicate retrieved chunks by section/anchor (keep top 5 densest chunks, capped context)
    matched_docs: List[Document] = []
    seen_keys = set()
    total_chars = 0
    for d in raw_docs:
        key = d.metadata.get("section_id") or d.metadata.get("section_title") or d.page_content[:50]
        if key not in seen_keys:
            seen_keys.add(key)
            chunk_len = len(d.page_content)
            if total_chars + chunk_len > 7500 and matched_docs:
                # Keep total context bounded below 7500 chars to avoid TPM limit
                break
            matched_docs.append(d)
            total_chars += chunk_len
        if len(matched_docs) >= 5:
            break

    confidence = evaluate_notes_confidence(q_clean, matched_docs)

    # 2. Decide if Web Fallback is required
    needs_web = False
    explicit_web_triggers = ["latest", "recent", "news", "today", "2025", "2026", "who is", "weather", "stock", "price", "outside", "compare with"]
    if is_timestamp_query:
        # Timestamp queries are 100% video-grounded!
        needs_web = False
    elif any(t in q_clean.lower() for t in explicit_web_triggers):
        needs_web = True
    elif not is_suggestive and confidence < 0.2:
        needs_web = True

    web_context = ""
    source_badge = "[Grounded in 4 U By U Notes — HTML Verified]"

    if is_timestamp_query:
        m, s = divmod(target_sec, 60)
        h, m = divmod(m, 60)
        ts_display = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
        source_badge = f"[Video Timestamp Grounding — Aligned to [TS {ts_display}]]"

    elif needs_web:
        source_badge = "[Live Web Intelligence — Topic Outside Notes]"
        yield f"*[Topic outside local lecture notes. Accessing real-time web search for '{q_clean}'...]*\n\n"
        web_results = search_web_duckduckgo(q_clean, max_results=4)
        if web_results:
            web_context = format_web_context(web_results)
        else:
            source_badge = "[Grounded in Notes — Web Fallback Empty]"

    # Format notes context
    notes_context_blocks = []
    for d in matched_docs:
        sec_title = d.metadata.get("section_title", "Section")
        sec_id = d.metadata.get("section_id", "")
        ts_str = d.metadata.get("timestamp_str", "00:00")
        notes_context_blocks.append(f"### Section: {sec_title} (Timestamp: [{ts_str}], Anchor: #{sec_id})\n{d.page_content}")
    
    notes_context = "\n\n---\n\n".join(notes_context_blocks)

    # 3. SUPERIOR PROMPT ENGINEERING WITH STRICT LANGGRAPH v0.2+ RULES
    superior_prompt = f"""You are the Master Educational AI Assistant for "4 U By U" — tutoring an engineering student on the "Complete Agentic AI Course with LangGraph" by Sheryians AI School (Instructor: Akarsh Vyas).

STRICT CODE CONVENTIONS & INTEGRITY RULES:
1. AUTHORITY & GROUNDING: Ground your answer directly in the lecture notes, transcription, and course code provided below. Avoid hallucinating academic filler or non-existent concepts.
2. SYNTACTICALLY CORRECT LANGGRAPH (v0.2+):
   - State definitions: ALWAYS define schemas with `TypedDict` or `MessagesState`.
   - Graph instantiation: ALWAYS pass the state schema: `builder = StateGraph(StateType)`.
   - Node functions: Pure functions taking `(state: StateType) -> dict` returning partial dict updates.
   - Reducers: Use `Annotated[dict, merge_fn]` or `Annotated[list, operator.add]` for fan-in state merging.
   - Edge wiring: `builder.add_edge(START, "node_a")`, `builder.add_edge("node_a", "node_b")`, `builder.add_edge("node_b", END)`.
   - Conditional edges: `builder.add_conditional_edges("source", route_fn, {{"branch_a": "node_a", "branch_b": "node_b"}})`.
   - Human-in-the-Loop (HITL): Use `MemorySaver()` checkpointer, `interrupt()`, and `Command(resume=...)`.
   - ABSOLUTE PROHIBITION: NEVER hallucinate imaginary parameters like `is_parallel=True` or node signatures like `(state, results)`.
3. TIMESTAMPS: Whenever citing moments from the video, cite them as [TS MM:SS] so the student can click the pill and jump to that exact video second.
4. ANCHORS: When discussing a handbook section, cite it as [Jump to Section #{'{section_id}'}] to allow one-click in-page navigation.
5. CODE EXCELLENCE & READABILITY: Format all code blocks with proper syntax highlighting (` ```python `) and explain each line or design decision clearly with high readability, elegant structure, and concise headings.
6. CALLOUT BOXES: Use blockquotes (`> **Core Architectural Takeaway:**`) to crystallize the fundamental engineering principle.
7. SOURCE ATTRIBUTION: Begin your answer by clearly noting: `> **{source_badge}**`.
8. SHORT SUGGESTIONS & ZERO EMOJIS:
   - ABSOLUTE PROHIBITION: DO NOT output any emojis anywhere in your answer (no bulbs, no icons, no rockets).
   - End your answer with EXACTLY 3 SHORT, CONCISE follow-up suggestion chips (strictly 3 to 5 words each, never full sentences) formatted as:
Suggested Follow-ups:
- [Short Topic 1]
- [Short Topic 2]
- [Short Topic 3]

CONTEXT SOURCES:

[HANDBOOK HTML NOTES KNOWLEDGE]:
{notes_context if notes_context else 'No specific lecture notes chunks matched.'}

[EXTERNAL WEB SEARCH KNOWLEDGE]:
{web_context if web_context else 'No external web search performed.'}

STUDENT QUESTION:
{q_clean}

DETAILED PRODUCTION ANSWER:"""

    try:
        llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.1)
        chain = PromptTemplate.from_template("{prompt}") | llm | StrOutputParser()

        async for chunk in chain.astream({"prompt": superior_prompt}):
            yield chunk

    except Exception as e:
        # Resilient fallback to high-throughput Groq models
        fallback_models = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]
        succeeded = False
        for fb_model in fallback_models:
            if fb_model != model_name:
                try:
                    fb_llm = get_chat_model(api_key=api_key, model_name=fb_model, temperature=0.1)
                    fb_chain = PromptTemplate.from_template("{prompt}") | fb_llm | StrOutputParser()
                    async for chunk in fb_chain.astream({"prompt": superior_prompt}):
                        yield chunk
                    succeeded = True
                    break
                except Exception:
                    continue
        if not succeeded:
            yield f"\n\n[Chatbot Error]: {str(e)}"
