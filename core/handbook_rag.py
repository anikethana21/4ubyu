"""
4 U By U — Master Handbook RAG Engine & Intelligent Web Gateway
- Indexes HTML handbook chunks using ChromaDB & local vector store.
- Provides preloaded suggestive questions that work EXCLUSIVELY from the handbook HTML.
- Detects out-of-scope or current events queries and seamlessly accesses real-time Web Search.
- Formats answers with superior prompt engineering, citations, code blocks, and anchor jumps.
- Enforces strict modern LangGraph (v0.2+) API rules with ZERO hallucinated parameters.
"""

import os
import re
import shutil
from pathlib import Path
from typing import List, Dict, Any, AsyncGenerator, Optional
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from config import VECTOR_DB_DIR
from core.html_chunker import chunk_workspace_html, CURATED_SUGGESTIVE_QUESTIONS
from core.web_search import search_web_duckduckgo, format_web_context
from core.model_router import get_chat_model
from core.vector_store import get_local_embeddings

HANDBOOK_COLLECTION_NAME = "agentic_handbook_master"
HANDBOOK_CHROMA_DIR = VECTOR_DB_DIR / "handbook_master"

# In-memory document cache for instant retrieval & fallback
_CACHED_DOCS: List[Document] = []
_CACHED_QUESTIONS: List[str] = CURATED_SUGGESTIVE_QUESTIONS

def initialize_handbook_index(html_file_path: Optional[str] = None) -> int:
    """
    Parses and cleanly indexes the target HTML handbook into the vector store.
    Defaults to static/agentic_ai_interactive_handbook.html.
    """
    global _CACHED_DOCS, _CACHED_QUESTIONS

    if not html_file_path:
        default_p = BASE_DIR / "static" / "agentic_ai_interactive_handbook.html"
        html_file_path = str(default_p)

    docs, questions = chunk_workspace_html(html_file_path)
    _CACHED_DOCS = docs
    _CACHED_QUESTIONS = questions

    # Also index GenAI handbook if present to form a multi-book repository
    genai_p = BASE_DIR / "static" / "GenAI_and_RAG_Engineering_Handbook.html" 
    if genai_p.exists():
        extra_docs, extra_q = chunk_workspace_html(str(genai_p))
        _CACHED_DOCS.extend(extra_docs)
        for eq in extra_q:
            if eq not in _CACHED_QUESTIONS:
                _CACHED_QUESTIONS.append(eq)

    print(f"[HandbookRAG] Successfully parsed {len(_CACHED_DOCS)} chunks and {len(_CACHED_QUESTIONS)} questions.")

    # Populate ChromaDB with clean collection (wipe old collection to avoid duplicate buildup)
    try:
        from langchain_chroma import Chroma
    except Exception:
        try:
            from langchain_community.vectorstores import Chroma
        except Exception:
            Chroma = None

    if Chroma and _CACHED_DOCS:
        try:
            if HANDBOOK_CHROMA_DIR.exists():
                shutil.rmtree(HANDBOOK_CHROMA_DIR, ignore_errors=True)
            HANDBOOK_CHROMA_DIR.mkdir(parents=True, exist_ok=True)
            embeddings = get_local_embeddings()
            Chroma.from_documents(
                documents=_CACHED_DOCS,
                embedding=embeddings,
                persist_directory=str(HANDBOOK_CHROMA_DIR),
                collection_name=HANDBOOK_COLLECTION_NAME
            )
            print("[HandbookRAG] ChromaDB index built and persisted cleanly.")
        except Exception as e:
            print(f"[HandbookRAG] Note: Local vector store active with memory fallback: {e}")

    return len(_CACHED_DOCS)

def get_suggestive_questions() -> List[str]:
    """Returns preloaded questions that operate directly on the handbook HTML."""
    if not _CACHED_QUESTIONS:
        initialize_handbook_index()
    return _CACHED_QUESTIONS[:12]

def search_handbook_chunks(query: str, k: int = 4) -> List[Document]:
    """Retrieves top-k relevant HTML chunks using Chroma or keyword matching, with deduplication."""
    if not _CACHED_DOCS:
        initialize_handbook_index()

    retrieved: List[Document] = []

    # Try Chroma first
    try:
        from langchain_chroma import Chroma
    except Exception:
        try:
            from langchain_community.vectorstores import Chroma
        except Exception:
            Chroma = None

    if Chroma and HANDBOOK_CHROMA_DIR.exists():
        try:
            embeddings = get_local_embeddings()
            vs = Chroma(
                persist_directory=str(HANDBOOK_CHROMA_DIR),
                embedding_function=embeddings,
                collection_name=HANDBOOK_COLLECTION_NAME
            )
            # Retrieve more candidates to allow diverse deduplication
            raw_results = vs.similarity_search(query, k=k * 3)
            seen_anchors = set()
            for r in raw_results:
                anchor = r.metadata.get("anchor") or r.metadata.get("section") or r.page_content[:40]
                if anchor not in seen_anchors:
                    seen_anchors.add(anchor)
                    retrieved.append(r)
                if len(retrieved) >= k:
                    break
            if retrieved:
                return retrieved
        except Exception as e:
            print(f"[HandbookRAG] Chroma lookup notice: {e}")

    # Fallback: In-memory keyword & term overlap matching
    q_tokens = set(re.findall(r"\w+", query.lower()))
    scored_docs = []
    seen_anchors = set()
    for d in _CACHED_DOCS:
        anchor = d.metadata.get("anchor") or d.metadata.get("section") or d.page_content[:40]
        if anchor in seen_anchors:
            continue
        content_lower = d.page_content.lower()
        sec_title = (d.metadata.get("section") or d.metadata.get("section_title") or "").lower()
        score = sum(4 for t in q_tokens if t in sec_title) + sum(1 for t in q_tokens if t in content_lower)
        if score > 0:
            scored_docs.append((score, d, anchor))

    scored_docs.sort(key=lambda x: x[0], reverse=True)
    for score, doc, anchor in scored_docs[:k]:
        retrieved.append(doc)

    if retrieved:
        return retrieved

    return _CACHED_DOCS[:k] if _CACHED_DOCS else []

def evaluate_retrieval_confidence(query: str, docs: List[Document]) -> float:
    """Computes relevance score of retrieved handbook chunks against user query."""
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

async def stream_handbook_chat_response(
    question: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """
    Executes intelligent RAG:
    - Answers exclusively from HTML chunks when relevant.
    - Autonomously accesses real-time Web Search if query is outside the handbook.
    - Streams tokens with superior system prompts, citations, and follow-up chips.
    - Strictly enforces authentic LangGraph v0.2+ code.
    """
    q_clean = question.strip()
    if not q_clean:
        yield "Please provide a question about the handbook or agentic AI architectures."
        return

    # Check if query is one of the preloaded suggestive questions (force HTML mode)
    is_suggestive = any(q_clean.lower() in sq.lower() or sq.lower() in q_clean.lower() for sq in _CACHED_QUESTIONS)

    # 1. Retrieve HTML handbook chunks
    matched_docs = search_handbook_chunks(q_clean, k=4)
    confidence = evaluate_retrieval_confidence(q_clean, matched_docs)

    # Determine whether to access the web
    needs_web = False
    explicit_web_triggers = ["latest", "recent", "news", "today", "2025", "2026", "who is", "weather", "stock", "price"]
    if any(t in q_clean.lower() for t in explicit_web_triggers):
        needs_web = True
    elif not is_suggestive and confidence < 0.2:
        needs_web = True

    web_context = ""
    source_badge = "[Grounded in Interactive Handbook HTML]"
    
    if needs_web:
        source_badge = "[Real-Time Web Intelligence — External Web Grounded]"
        yield f"*[Searching web for '{q_clean}'...]*\n\n"
        web_results = search_web_duckduckgo(q_clean, max_results=4)
        if web_results:
            web_context = format_web_context(web_results)
        else:
            source_badge = "📖 Handbook Knowledge (Web Fallback Empty)"

    # Format handbook context
    handbook_context = "\n\n---\n\n".join([
        f"### {d.metadata.get('module', 'Module')} > {d.metadata.get('section', d.metadata.get('section_title', 'Section'))} (Anchor: #{d.metadata.get('anchor', '')})\n{d.page_content}"
        for d in matched_docs
    ])

    # SUPERIOR PROMPT TEMPLATE WITH STRICT LANGGRAPH v0.2+ RULES
    system_prompt = f"""You are the Master Educational AI Architect for "The Agentic AI & LangGraph Engineering Handbook" based on the masterclass by Sheryians AI School.
You provide crystal-clear, production-grade answers for engineering students and software developers.

STRICT CODE CONVENTIONS & INTEGRITY RULES:
1. AUTHORITY & GROUNDING: Ground your answer directly in the course knowledge provided below. Avoid hallucinating academic filler or non-existent concepts.
2. SYNTACTICALLY CORRECT LANGGRAPH (v0.2+):
   - State definitions: ALWAYS define schemas with `TypedDict` or `MessagesState`.
   - Graph instantiation: ALWAYS pass the state schema: `builder = StateGraph(StateType)`.
   - Node functions: Pure functions taking `(state: StateType) -> dict` returning partial dict updates.
   - Reducers: Use `Annotated[dict, merge_fn]` or `Annotated[list, operator.add]` for fan-in state merging.
   - Edge wiring: `builder.add_edge(START, "node_a")`, `builder.add_edge("node_a", "node_b")`, `builder.add_edge("node_b", END)`.
   - Conditional edges: `builder.add_conditional_edges("source", route_fn, {{"branch_a": "node_a", "branch_b": "node_b"}})`.
   - Human-in-the-Loop (HITL): Use `MemorySaver()` checkpointer, `interrupt()`, and `Command(resume=...)`.
   - ABSOLUTE PROHIBITION: NEVER hallucinate imaginary parameters like `is_parallel=True` or node signatures like `(state, results)`.
3. CITATIONS & ANCHORS: When referencing handbook sections, cite the anchor like [Jump to #{'{anchor}'}] so the user can jump directly in the page.
4. MENTAL MODELS & ANALOGIES: Include real-world analogies (e.g. assembly line, triage doctor, reconnaissance squad, nuclear key) and ASCII flow diagrams.
5. SUGGESTED NEXT TOPICS & ZERO EMOJIS:
   - ABSOLUTE PROHIBITION: DO NOT use any emojis anywhere in your response (no bulbs, no icons).
   - At the very end of your response, output exactly 3 short follow-up topics (strictly 3 to 5 words each) formatted as:
`Suggested Follow-ups:`
- [Follow-up question 1]
- [Follow-up question 2]
- [Follow-up question 3]

KNOWLEDGE SOURCES:

[HANDBOOK HTML KNOWLEDGE]:
{handbook_context if handbook_context else 'No specific handbook chunks matched.'}

[EXTERNAL WEB CONTEXT]:
{web_context if web_context else 'No external web search performed.'}

STUDENT QUESTION:
{q_clean}

DETAILED PRODUCTION ANSWER:"""

    try:
        llm = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.1)
        chain = PromptTemplate.from_template("{prompt}") | llm | StrOutputParser()
        
        # Stream response tokens
        yield f"> **{source_badge}**\n\n"
        async for chunk in chain.astream({"prompt": system_prompt}):
            yield chunk

    except Exception as e:
        yield f"\n\n[AI Assistant Exception]: {str(e)}"
