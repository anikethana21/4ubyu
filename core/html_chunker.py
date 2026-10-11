"""
4 U By U — Advanced Tag-Aware HTML Chunker & Suggestive Question Engine
Uses BeautifulSoup (bs4) to chunk the entire HTML workspace page based on tags:
- <article class="chapter-card">
- <section class="section-block">
- <div class="theory-block">, <div class="code-card">, <div class="keypoints-card">
- <div class="example-card">, <div class="supplement-card">, <div class="visual-diagram-card">
- Tag hierarchies: <h1>-<h4>, <pre><code>, <table>, <blockquote>, <ul>/<ol>
Extracts preloaded suggestive questions that work EXCLUSIVELY from the HTML notes.
"""

import re
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from bs4 import BeautifulSoup
from langchain_core.documents import Document

def clean_slug(text: str) -> str:
    """Generates clean HTML anchor slug."""
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", text.lower()).strip("-")
    return s or "section"

MASTER_ARCHETYPES_OVERVIEW = """# The 5 Core LangGraph Workflow Archetypes (Master Architectural Guide)

LangGraph enables cyclical, stateful, multi-agent AI engineering by modeling workflows as graphs of nodes (pure functions) and edges (control-flow transitions) operating over a shared state whiteboard (`TypedDict`).

### 1. Archetype 1: Sequential Workflow (`sequential_base.py`)
- **Analogy:** Assembly line / relay baton pass.
- **Topology:** `START -> [editor_node] -> [scriptwriter_node] -> [translator_node] -> END`
- **State Pattern:** Single `TypedDict` where each node updates specific keys (`raw_input`, `edited_text`, `script_text`, `final_output`).
- **Core Code Skeleton:**
```python
class PipelineState(TypedDict):
    raw_input: str
    edited_text: str
    script_text: str
    final_output: str

builder = StateGraph(PipelineState)
builder.add_node("editor", editor_node)
builder.add_node("scriptwriter", scriptwriter_node)
builder.add_node("translator", translator_node)

builder.add_edge(START, "editor")
builder.add_edge("editor", "scriptwriter")
builder.add_edge("scriptwriter", "translator")
builder.add_edge("translator", END)
graph = builder.compile()
```

### 2. Archetype 2: Parallel Workflow with Custom Reducer (`parallel_reducers.py`)
- **Analogy:** Reconnaissance squad — multiple scouts gather different intelligence simultaneously.
- **Topology:** Single node fans out to multiple parallel branches which fan back in:
  `START -> +-- [toxicity_node] ---+-> END`
  `         +-- [copyright_node] --+`
  `         +-- [culture_node] ----+`
- **The State Overwrite Problem:** When parallel nodes write to the same state key concurrently, standard dictionary assignment causes race conditions where one node overwrites the others.
- **The Reducer Solution:** Use `typing.Annotated` with a custom reducer function or `operator.add` to merge branch outputs.
```python
def merge_score_dicts(existing: dict, new_update: dict) -> dict:
    if existing is None:
        return new_update
    return {**existing, **new_update}

class AnalyzerState(TypedDict):
    raw_text: str
    safety_scores: Annotated[dict[str, int], merge_score_dicts]

builder = StateGraph(AnalyzerState)
builder.add_node("toxicity", toxicity_node)
builder.add_node("copyright", copyright_node)
builder.add_node("culture", culture_node)

builder.add_edge(START, "toxicity")
builder.add_edge(START, "copyright")
builder.add_edge(START, "culture")
builder.add_edge("toxicity", END)
builder.add_edge("copyright", END)
builder.add_edge("culture", END)
graph = builder.compile()
```

### 3. Archetype 3: Conditional Workflow & Multi-Source RAG (`conditional_RAG.py`)
- **Analogy:** Hospital triage doctor directing patients to specific departments.
- **Topology:** A classification node inspects input, and `add_conditional_edges` routes to specialized RAG retrievers.
- **Core Primitives:** `add_conditional_edges(source, routing_func, path_map)`.
```python
class RAGState(TypedDict):
    query: str
    route: str
    context: str
    response: str

def route_query(state: RAGState) -> str:
    category = state.get("route", "general")
    if "fee" in category:
        return "fee_rag"
    elif "academic" in category:
        return "academic_rag"
    return "general_rag"

builder = StateGraph(RAGState)
builder.add_node("classifier", classifier_node)
builder.add_node("fee_rag", fee_rag_node)
builder.add_node("academic_rag", academic_rag_node)
builder.add_node("general_rag", general_rag_node)
builder.add_node("synthesizer", synthesizer_node)

builder.add_edge(START, "classifier")
builder.add_conditional_edges(
    "classifier",
    route_query,
    {
        "fee_rag": "fee_rag",
        "academic_rag": "academic_rag",
        "general_rag": "general_rag"
    }
)
builder.add_edge("fee_rag", "synthesizer")
builder.add_edge("academic_rag", "synthesizer")
builder.add_edge("general_rag", "synthesizer")
builder.add_edge("synthesizer", END)
graph = builder.compile()
```

### 4. Archetype 4: Iterative / Cyclic Workflow (`iterative_tools.py`)
- **Analogy:** Ruthless book editor — write draft, review critique, reject and loop back until quality threshold is met.
- **Topology:** Evaluator-Optimizer feedback loop with deterministic termination condition (`attempt >= max_attempts` or `APPROVED`).
- **Core Primitives:** Cyclic edge back to writer node guarded by conditional edge.
```python
class IterativeState(TypedDict):
    topic: str
    draft: str
    critique: str
    score: int
    attempts: int

def evaluate_draft(state: IterativeState) -> str:
    if state["score"] >= 85 or state["attempts"] >= 3:
        return "approved"
    return "revise"

builder = StateGraph(IterativeState)
builder.add_node("writer", writer_node)
builder.add_node("reviewer", reviewer_node)

builder.add_edge(START, "writer")
builder.add_edge("writer", "reviewer")
builder.add_conditional_edges(
    "reviewer",
    evaluate_draft,
    {
        "approved": END,
        "revise": "writer"  # CYCLIC FEEDBACK LOOP
    }
)
graph = builder.compile()
```

### 5. Archetype 5: Human-in-the-Loop (HITL) Workflow (`humanintheloop.py`)
- **Analogy:** Nuclear launch authorization key — requires human approval before mission-critical execution.
- **Topology:** Graph pauses at breakpoint, surfaces state to human operator, waits for review/edit, resumes with `Command(resume=...)`.
- **Core Primitives:** `MemorySaver()` checkpointer, `interrupt()` or `interrupt_before=["approval_node"]`, `Command(resume=feedback)`.
```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt, Command

class HITLState(TypedDict):
    topic: str
    draft: str
    human_approved: bool
    feedback: str

def human_approval_node(state: HITLState) -> dict:
    # Pauses graph execution and surfaces draft to human interface
    user_decision = interrupt({"draft_to_review": state["draft"]})
    return {
        "human_approved": user_decision.get("approved", False),
        "feedback": user_decision.get("feedback", "")
    }

checkpointer = MemorySaver()
builder = StateGraph(HITLState)
builder.add_node("writer", writer_node)
builder.add_node("human_gate", human_approval_node)
builder.add_node("publisher", publisher_node)

builder.add_edge(START, "writer")
builder.add_edge("writer", "human_gate")
builder.add_edge("human_gate", "publisher")
builder.add_edge("publisher", END)

graph = builder.compile(checkpointer=checkpointer)
# Execution:
# config = {"configurable": {"thread_id": "thread-1"}}
# graph.invoke({"topic": "Agentic AI"}, config=config) -> PAUSES at human_gate
# graph.invoke(Command(resume={"approved": True}), config=config) -> RESUMES
```
"""

def chunk_workspace_html(
    html_content_or_path: str,
    video_id: str = ""
) -> Tuple[List[Document], List[str]]:
    """
    Parses and chunks an entire HTML page using BeautifulSoup based on HTML tags.
    Extracts semantic chunks preserving hierarchy, timestamps, and code blocks.
    Extracts preloaded suggestive questions guaranteed to be answered by the HTML.
    """
    html_text = ""
    is_path = (
        bool(html_content_or_path)
        and len(html_content_or_path) < 1024
        and not html_content_or_path.strip().startswith("<")
        and "\n" not in html_content_or_path
    )
    if is_path:
        try:
            p = Path(html_content_or_path)
            if p.exists() and p.is_file():
                with open(p, "r", encoding="utf-8", errors="replace") as f:
                    html_text = f.read()
            else:
                html_text = html_content_or_path
        except (OSError, ValueError):
            html_text = html_content_or_path
    else:
        html_text = html_content_or_path

    if not html_text.strip():
        return [], []

    soup = BeautifulSoup(html_text, "html.parser")
    docs: List[Document] = []
    suggestive_questions: List[str] = []

    # -------------------------------------------------------------
    # CASE A: 4 U By U Tri-Pane Workspace (notes_{video_id}.html)
    # Detects .chapter-card and .section-block elements
    # -------------------------------------------------------------
    chapter_cards = soup.select("article.chapter-card")
    if chapter_cards:
        for ch_idx, ch_card in enumerate(chapter_cards, 1):
            ch_title = ch_card.get("data-chapter-title") or ""
            if not ch_title:
                h2 = ch_card.select_one("h2.chapter-title")
                ch_title = h2.get_text(strip=True) if h2 else f"Chapter {ch_idx}"
            
            ch_id = ch_card.get("id") or f"chapter-{ch_idx}"
            ch_sec_ts = ch_card.get("data-timestamp-seconds", "0")
            try:
                ch_sec_ts = int(ch_sec_ts)
            except ValueError:
                ch_sec_ts = 0

            # Chapter Overview Chunk
            ch_desc_el = ch_card.select_one(".chapter-desc")
            ch_desc = ch_desc_el.get_text(strip=True) if ch_desc_el else ""
            if ch_desc:
                docs.append(Document(
                    page_content=f"Chapter {ch_idx}: {ch_title}\nTimestamp: {ch_sec_ts}s\nOverview: {ch_desc}",
                    metadata={
                        "source": "notes_html",
                        "tag_type": "chapter_overview",
                        "chapter_title": ch_title,
                        "chapter_id": ch_id,
                        "section_title": ch_title,
                        "section_id": ch_id,
                        "timestamp_seconds": ch_sec_ts,
                        "timestamp_str": f"{ch_sec_ts // 60}:{ch_sec_ts % 60:02d}",
                        "anchor": ch_id
                    }
                ))
                suggestive_questions.append(f"Summarize Chapter {ch_idx}: {ch_title}")

            # Parse Subsections inside Chapter
            section_blocks = ch_card.select("section.section-block")
            for s_idx, s_block in enumerate(section_blocks, 1):
                sec_id = s_block.get("id") or f"{ch_id}-sec-{s_idx}"
                sec_title = s_block.get("data-chapter-title") or ""
                if not sec_title:
                    h3 = s_block.select_one("h3.section-title")
                    sec_title = h3.get_text(strip=True) if h3 else f"Section {s_idx}"

                sec_ts = s_block.get("data-timestamp-seconds", "0")
                try:
                    sec_ts = int(sec_ts)
                except ValueError:
                    sec_ts = 0
                ts_str = f"{sec_ts // 60}:{sec_ts % 60:02d}"

                # 1. Theory Block
                theory_el = s_block.select_one(".theory-block")
                theory_text = theory_el.get_text(separator="\n", strip=True) if theory_el else ""

                # 2. Analogy Card
                analogy_el = s_block.select_one(".analogy-card")
                analogy_text = analogy_el.get_text(separator="\n", strip=True) if analogy_el else ""

                # 3. Code Card
                code_el = s_block.select_one(".code-card pre code")
                code_text = code_el.get_text() if code_el else ""
                code_lang = "python"
                if code_el and code_el.get("class"):
                    for c in code_el["class"]:
                        if c.startswith("language-"):
                            code_lang = c.replace("language-", "")

                # 4. Key Points Card
                kp_items = [li.get_text(strip=True) for li in s_block.select(".keypoints-card li")]
                kp_text = "\n- ".join(kp_items)

                # 5. Example Walkthrough Card
                ex_el = s_block.select_one(".example-card")
                ex_text = ex_el.get_text(separator="\n", strip=True) if ex_el else ""

                # 6. Supplement / Advanced Insights
                supp_el = s_block.select_one(".supplement-card")
                supp_text = supp_el.get_text(separator="\n", strip=True) if supp_el else ""

                # Compose rich section document
                parts = [f"Chapter: {ch_title} | Section: {sec_title} (Timestamp: [{ts_str}], Anchor: #{sec_id})"]
                if theory_text:
                    parts.append(f"Theory & Explanation:\n{theory_text}")
                if analogy_text:
                    parts.append(f"Mental Model / Analogy:\n{analogy_text}")
                if code_text:
                    parts.append(f"Code Implementation ({code_lang}):\n```{code_lang}\n{code_text}\n```")
                if kp_text:
                    parts.append(f"Key Points:\n- {kp_text}")
                if ex_text:
                    parts.append(f"Scenario & Walkthrough:\n{ex_text}")
                if supp_text:
                    parts.append(f"Deep-Dive Supplement:\n{supp_text}")

                full_section_doc = "\n\n".join(parts)
                docs.append(Document(
                    page_content=full_section_doc,
                    metadata={
                        "source": "notes_html",
                        "tag_type": "section_block",
                        "chapter_title": ch_title,
                        "chapter_id": ch_id,
                        "section_title": sec_title,
                        "section_id": sec_id,
                        "timestamp_seconds": sec_ts,
                        "timestamp_str": ts_str,
                        "anchor": sec_id
                    }
                ))

                suggestive_questions.append(f"Explain '{sec_title}' discussed at [{ts_str}]")
                if code_text:
                    suggestive_questions.append(f"Explain the code implementation in '{sec_title}' step-by-step")
                if kp_items:
                    suggestive_questions.append(f"What are the core takeaways of '{sec_title}'?")

        seen = set()
        clean_q = [q for q in suggestive_questions if not (q in seen or seen.add(q))]
        return docs, clean_q[:16]

    # -------------------------------------------------------------
    # CASE B: Generic or Markdown-Rendered HTML Handbook
    # -------------------------------------------------------------
    src_md = soup.find(id="source-markdown")
    if src_md and src_md.get_text().strip():
        raw_text = src_md.get_text()
        lines = raw_text.split("\n")
        current_mod = "The Agentic AI & LangGraph Engineering Handbook"
        current_sec = "Overview"
        current_anchor = "overview"
        current_buffer: List[str] = []
        in_code = False

        # Add the master archetypes overview document first
        docs.append(Document(
            page_content=MASTER_ARCHETYPES_OVERVIEW,
            metadata={
                "source": "handbook_html",
                "tag_type": "master_archetypes_overview",
                "chapter_title": "Master Architecture",
                "module": "Master Overview",
                "section_title": "The 5 Core LangGraph Workflow Archetypes",
                "section": "The 5 Core LangGraph Workflow Archetypes",
                "anchor": "the-5-core-langgraph-workflow-archetypes"
            }
        ))
        suggestive_questions.append("What are the 5 core LangGraph workflows and when should I use each?")

        def commit_doc(m: str, s: str, a: str, b: List[str]):
            txt = "\n".join(b).strip()
            # Do not commit empty or tiny subtitle fragments (< 150 chars)
            if len(txt) > 150:
                docs.append(Document(
                    page_content=f"## {m} > {s} (Anchor: #{a})\n\n{txt}",
                    metadata={
                        "source": "handbook_html",
                        "tag_type": "markdown_module",
                        "chapter_title": m,
                        "module": m,
                        "section_title": s,
                        "section": s,
                        "anchor": a
                    }
                ))

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code = not in_code

            if not in_code and (line.startswith("# ") or line.startswith("## ")):
                title = line.lstrip("#").strip()
                commit_doc(current_mod, current_sec, current_anchor, current_buffer)
                current_buffer = []
                if line.startswith("# "):
                    current_mod = title
                    current_sec = title
                else:
                    current_sec = title
                current_anchor = clean_slug(title)
                suggestive_questions.append(f"What does {title} cover in LangGraph?")

            elif not in_code and line.startswith("### "):
                title = line.lstrip("#").strip()
                # For subsections, if current buffer is already long (> 2500 chars), split, otherwise keep together
                buf_len = sum(len(l) for l in current_buffer)
                if buf_len > 2500:
                    commit_doc(current_mod, current_sec, current_anchor, current_buffer)
                    current_buffer = []
                    current_sec = title
                    current_anchor = clean_slug(title)
                else:
                    # Append subheading to current buffer so code stays with theory
                    current_buffer.append(f"\n### {title}\n")
            else:
                current_buffer.append(line)

        commit_doc(current_mod, current_sec, current_anchor, current_buffer)

        seen = set()
        clean_q = [q for q in suggestive_questions if not (q in seen or seen.add(q))]
        return docs, clean_q[:16]

    # CASE C: Standard tag traversal (<section>, <h1>..<h4>, <p>, <pre>, <table>)
    current_sec = soup.title.string if soup.title else "Notes"
    current_anchor = "top"
    current_buffer = []

    for elem in soup.find_all(["h1", "h2", "h3", "h4", "p", "pre", "table", "ul"]):
        if elem.name in ["h1", "h2", "h3"]:
            if current_buffer:
                docs.append(Document(
                    page_content=f"{current_sec}\n\n" + "\n".join(current_buffer).strip(),
                    metadata={"source": "notes_html", "section_title": current_sec, "anchor": current_anchor}
                ))
                current_buffer = []
            current_sec = elem.get_text(strip=True)
            current_anchor = elem.get("id") or clean_slug(current_sec)
            suggestive_questions.append(f"Explain {current_sec}")
        elif elem.name == "pre":
            current_buffer.append(f"```\n{elem.get_text()}\n```")
        else:
            current_buffer.append(elem.get_text(strip=True))

    if current_buffer:
        docs.append(Document(
            page_content=f"{current_sec}\n\n" + "\n".join(current_buffer).strip(),
            metadata={"source": "notes_html", "section_title": current_sec, "anchor": current_anchor}
        ))

    seen = set()
    clean_q = [q for q in suggestive_questions if not (q in seen or seen.add(q))]
    return docs, clean_q[:16]


CURATED_SUGGESTIVE_QUESTIONS = [
    "What are the 5 core LangGraph workflows and when should I use each?",
    "What is the core difference between StateGraph and MessagesState in LangGraph?",
    "Explain Parallel Branching and how operator.add / custom reducers prevent state collision.",
    "Explain Human-In-The-Loop (HITL) breakpoint execution using MemorySaver and interrupt().",
    "How do conditional edges and dynamic routing work in multi-source RAG pipelines?",
    "Show the complete production code for a Cyclic Evaluator-Optimizer feedback loop.",
    "How does the Blog Post Generator work in Chapter 4 Sequential Workflow?",
    "What is the difference between ToolNode and custom conditional routing functions?"
]

# Alias for backwards compatibility
chunk_html_handbook = chunk_workspace_html
