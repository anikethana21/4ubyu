"""
4 U By U - PHASE 5: Parallel Chapter Agent Swarm
Grounded 100% in the instructor's actual spoken lecture audio.
Synthesizes comprehensive, in-depth technical documentation,
cleans and annotates code via the Code Cleaning Agent,
and produces concrete mental models with zero foreign cross-talk.
"""

import asyncio
import os
import re
from typing import Dict, Any, List, Optional, Tuple

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from states import SectionState, SectionContent, ChapterContent, MasterNotesState
from core.model_router import get_chat_model
from core.visual_architect import visual_architect_agent_node, reset_diagram_cache
from core.code_cleaning_agent import run_code_cleaning_agent
from core.transcript_coverage import balanced_transcript_excerpt
from core.llm_failures import (
    EXCERPT_STEPS,
    advise_on_llm_failure,
    degraded_section_notice,
    describe_llm_failure,
    invoke_reading_transcript,
    is_rate_limit,
    is_request_too_large,
)
from core.section_composer import compose_section

PHASE5_PARALLEL = max(1, int(os.environ.get("PHASE5_PARALLEL", "6")))

# "lean" writes each section with a single call; "agents" is the original
# five-agent fan-out, kept so the two can be compared on the same lecture.
PHASE5_MODE = (os.environ.get("PHASE5_MODE") or "lean").strip().lower()

# One section's notes are now written by a single composer call, so the cost of a
# section is one prompt. These steps are what that prompt may spend: it starts
# modest and the provider's own "request too large" verdict moves it down.
PHASE5_EXCERPT_STEPS = EXCERPT_STEPS

# Sections whose notes could not be written, so a run can report itself accurately.
DEGRADED_SECTIONS: List[str] = []


def reset_degraded_sections() -> None:
    """Clears the per-run record of sections that fell back to an honest notice."""
    DEGRADED_SECTIONS.clear()


# Section notes are written from the lecture transcript by
# core.section_composer.compose_section. The large tables of canned Scikit-Learn
# snippets that used to live here, handed out whenever a section merely looked
# like machine learning, are gone: notes that invent content are worse than
# notes that say plainly that a call failed.


# AGENT 1: In-Depth Theory & Architectural Documentation Agent
def theory_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state["section_title"]
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    transcript = state.get("transcript_slice", "")
    domain = state.get("domain") or "machine_learning"
    api_key = state.get("api_key")
    selected_model = state.get("selected_model")

    explanation = ""
    analogy = ""
    failure = ""

    llm = get_chat_model(api_key=api_key, model_name=selected_model)
    if llm:
        try:
            prompt_str = (
                "You are a Senior Principal Technical Curriculum Architect.\n"
                "Task: Document ONLY what the instructor teaches in this segment — no generic filler.\n\n"
                'Topic: "{title}"\n'
                'Chapter: "{chapter_title}"\n'
                "Subject Domain: {domain}\n\n"
                "Spoken Lecture Context (English transcript excerpts):\n"
                "---\n{transcript}\n---\n\n"
                "REQUIREMENTS:\n"
                "1. EXPLANATION: 3-4 paragraphs with markdown headings grounded in the transcript above.\n"
                "   - Core concepts, mechanics, and any formulas (LaTeX \\[ ... \\] or \\( ... \\)).\n"
                "   - Do NOT invent topics not present in the transcript.\n"
                "   - Do NOT output code snippets in EXPLANATION.\n"
                "2. ANALOGY: One vivid mental model for this specific topic.\n\n"
                "Format strictly as:\n"
                "EXPLANATION:\n<detailed paragraphs>\n\nANALOGY:\n<mental model>"
            )
            answer, failure = invoke_reading_transcript(
                llm,
                prompt_str,
                {"title": title, "chapter_title": chapter_title, "domain": domain},
                transcript,
                on_attempt=lambda chars, message: print(
                    f"[TheoryAgent] {title}: {chars} chars of context refused — {message[:150]}"
                ),
            )
            if answer:
                # Split the heading off however the model wrote it. Demanding the
                # exact string "EXPLANATION:" discarded complete, grounded answers
                # whenever a model wrote "**EXPLANATION**" instead — and threw away
                # the call that had already been paid for.
                from core.section_composer import parse_section_composition

                parsed = parse_section_composition(answer)
                explanation = parsed["explanation"]
                analogy = parsed["analogy"]
        except Exception as e:
            failure = str(e).strip()
            print(f"[TheoryAgent] {title}: {failure[:150]}")

    # A model that is unavailable, rate-limited or simply silent must never be
    # papered over with invented content. State the failure plainly and show the
    # instructor's own words instead, so the section is still worth reading and
    # nobody mistakes filler for teaching.
    if not explanation or len(explanation) < 150:
        DEGRADED_SECTIONS.append(title)
        print(f"[TheoryAgent] {title}: notes degraded ({describe_llm_failure(failure)})")
        explanation = degraded_section_notice(failure, transcript)
        analogy = ""

    return {
        "explanation": explanation,
        "analogy": analogy,
        "theory_block": {
            "explanation": explanation,
            "analogies": [analogy] if analogy else []
        }
    }


def should_section_include_code(
    title: str,
    chapter_title: str,
    transcript: str,
    procured_code: str,
    is_grounded_repo_code: bool = False,
) -> bool:
    """
    Strict code gating:
    - Never attaches code purely because global repo files exist.
    - Intro, conceptual, philosophy, and overview topics NEVER receive code unless instructor explicitly writes code.
    - Requires genuine grounded repo slice OR explicit in-lecture coding keywords + tokens.
    """
    combined = f"{chapter_title} {title}".lower()

    # Disallow coding on pure introductory, conceptual, or overview topics
    strictly_conceptual = [
        "welcome", "prerequisites", "course overview", "curriculum roadmap",
        "what is machine learning", "philosophy of", "traditional programming",
        "difference between", "difference b/w", "taxonomic hierarchy",
        "taxonomy of ml", "steps for making", "lifecycle", "career", "salary",
        "interview tips", "outro", "summary", "key takeaways", "conclusion",
        "pros and cons", "applications of", "generative ai vs agentic", "why langgraph"
    ]
    if any(k in combined for k in strictly_conceptual):
        # Only override if the transcript contains active code execution statements
        excerpt_check = (transcript or "")[:4000].lower()
        if not any(token in excerpt_check for token in ["def ", "class ", "import ", "plt.", "pd.read_csv", "np.array"]):
            return False

    coding_keywords = [
        "implementation", "implement", "programming", "project", "hands-on",
        "build", "script", "function", "training loop", "notebook", "scikit-learn",
        "pytorch", "tensorflow", "pandas", "numpy", "eda", "data cleaning",
        "preprocessing", "feature engineering", "feature selection", "model training",
        "stategraph", "memorysaver", "workflow"
    ]
    is_explicitly_coding = any(w in combined for w in coding_keywords)

    excerpt = (transcript or "")[:6000]
    has_code_tokens = bool(
        re.search(
            r"(def |import |class |return |pd\.|np\.|\.fit\(|\.predict\(|\.transform\(|```)",
            excerpt,
        )
    )

    # If grounded repo code was specifically settled with high affinity AND tokens match
    if procured_code and is_grounded_repo_code and (has_code_tokens or is_explicitly_coding):
        return True

    return is_explicitly_coding and has_code_tokens

# AGENT 2: Code Agent (Powered by the Code Cleaning Agent)
def code_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state["section_title"]
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    transcript = state.get("transcript_slice", "")
    domain = state.get("domain") or "machine_learning"
    api_key = state.get("api_key")
    selected_model = state.get("selected_model")
    github_files = state.get("github_files") or {}
    procured_code = state.get("procured_code")
    is_grounded_repo_code = bool(state.get("is_grounded_repo_code"))

    if not should_section_include_code(
        title,
        chapter_title,
        transcript,
        procured_code or "",
        is_grounded_repo_code=is_grounded_repo_code,
    ):
        return {"code_blocks": []}

    llm = get_chat_model(api_key=api_key, model_name=selected_model)
    excerpt = balanced_transcript_excerpt(transcript, max_chars=10000)
    repo_for_agent = github_files if is_grounded_repo_code else {}

    cleaning_res = run_code_cleaning_agent(
        chapter_title=f"{chapter_title} - {title}",
        transcript=excerpt,
        domain=domain,
        github_files=repo_for_agent,
        llm=llm,
        procured_code=procured_code if is_grounded_repo_code else None,
    )

    code = cleaning_res.get("code")
    filename = cleaning_res.get("filename", f"{re.sub(r'[^a-zA-Z0-9_]+', '_', title.lower())}.py")
    source_label = cleaning_res.get("source", "Lecture-Grounded Code")

    # Only provide code if genuine code was extracted or relevant
    if not code or len(code.strip()) < 50:
        return {"code_blocks": []}

    cb = {
        "language": "python",
        "code": code,
        "caption": f"{title} — {source_label}",
        "description": f"Verified executable implementation for {title}",
        "filename": filename
    }

    return {"code_blocks": [cb]}

# AGENT 3: Key Points Agent
def keypoints_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state["section_title"]
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    transcript = state.get("transcript_slice", "")
    domain = state.get("domain") or "machine_learning"
    api_key = state.get("api_key")
    selected_model = state.get("selected_model")

    points = []
    llm = get_chat_model(api_key=api_key, model_name=selected_model)
    if llm:
        try:
            prompt_str = (
                "Extract 4 to 5 concise, high-value practical takeaways from the lecture on: \"" + title + "\"\n"
                "Chapter: \"" + chapter_title + "\" (Domain: " + domain + ")\n\n"
                "Transcript excerpt:\n---\n{transcript}\n---\n\n"
                "Output strictly 4-5 bullet points starting with - :"
            )
            prompt = PromptTemplate.from_template(prompt_str)
            chain = prompt | llm | StrOutputParser()
            result = chain.invoke(
                {"transcript": balanced_transcript_excerpt(transcript, max_chars=8000)}
            )
            if result:
                for line in result.splitlines():
                    line = line.strip()
                    if line.startswith("-") or line.startswith("*") or re.match(r"^\d+\.", line):
                        clean_p = re.sub(r"^[-*\d\.]+\s*", "", line).strip()
                        if clean_p and len(clean_p) > 10:
                            points.append(clean_p)
        except Exception:
            pass

    # No model answer means no key points. The generic Scikit-Learn checklist this
    # used to substitute had nothing to do with most lectures and made an empty
    # section look finished.
    return {"key_points": points[:5]}

# AGENT 4: Pitfalls & Examples Agent
def pitfalls_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state["section_title"]
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    domain = state.get("domain") or "machine_learning"
    api_key = state.get("api_key")
    selected_model = state.get("selected_model")

    pitfalls = []
    examples = []
    llm = get_chat_model(api_key=api_key, model_name=selected_model)
    if llm:
        try:
            prompt_str = (
                "From the lecture transcript below, list the mistakes students make with "
                "\"" + title + "\", and one example the instructor actually used.\n"
                "Chapter: \"" + chapter_title + "\" (Domain: " + domain + ")\n\n"
                "Transcript excerpt:\n---\n{transcript}\n---\n\n"
                "Answer in exactly this shape, each heading on its own line:\n\n"
                "PITFALLS\n"
                "- <mistake> -> <fix>\n\n"
                "EXAMPLE\n"
                "- <one concrete example from the lecture, or \"NONE\">\n"
            )
            prompt = PromptTemplate.from_template(prompt_str)
            chain = prompt | llm | StrOutputParser()
            result = chain.invoke(
                {"transcript": balanced_transcript_excerpt(transcript, max_chars=6000)}
            )
            if result:
                from core.section_composer import parse_section_composition

                parsed = parse_section_composition(result)
                pitfalls = parsed["pitfalls"]
                examples = [{"text": item} for item in parsed["examples"]]
        except Exception:
            pass

    # Nothing is invented when the call fails. An empty list is honest — the
    # renderer shows no pitfalls for this section — whereas the generic
    # Scikit-Learn advice this used to substitute was wrong for most lectures and
    # made the notes look complete when they were not.
    return {"pitfalls": pitfalls[:2], "examples": examples}

def generate_section_sync(
    section_def: Dict[str, Any],
    chapter_def: Dict[str, Any],
    api_key: str,
    selected_model: str,
    github_files: Optional[Dict[str, str]] = None
) -> SectionContent:
    title = section_def["section_title"]
    domain = section_def.get("domain") or chapter_def.get("domain") or "machine_learning"
    
    initial_state: SectionState = {
        "section_id": section_def["section_id"],
        "section_title": title,
        "chapter_structure": chapter_def,
        "transcript_slice": section_def.get("transcript_slice", ""),
        "time_reference": section_def.get("time_reference", "00:00"),
        "timestamp_seconds": section_def.get("timestamp_seconds", 0),
        "explanation": "",
        "analogy": "",
        "code_blocks": [],
        "key_points": [],
        "pitfalls": [],
        "diagrams": [],
        "api_key": api_key,
        "selected_model": selected_model,
        "domain": domain,
        "github_files": github_files or {},
        "procured_code": section_def.get("procured_code"),
        "procured_filename": section_def.get("procured_filename"),
        "procured_symbols": section_def.get("procured_symbols", []),
        "procured_slice_type": section_def.get("procured_slice_type"),
        "is_grounded_repo_code": section_def.get("is_grounded_repo_code", False)
    }

    if PHASE5_MODE == "agents":
        return _generate_section_with_agents(section_def, chapter_def, title, initial_state)

    # One call writes the whole section. The previous design asked five specialist
    # agents one question each and re-sent the same lecture excerpt five times; on a
    # provider metering tokens per minute that is five times the price for the same
    # notes, and four extra chances to invent content when a call fails.
    composed = compose_section(
        title=title,
        chapter_title=chapter_def.get("chapter_title") or chapter_def.get("title", ""),
        transcript=section_def.get("transcript_slice", ""),
        api_key=api_key,
        model_name=selected_model,
        domain=domain,
    )

    if composed["degraded"]:
        DEGRADED_SECTIONS.append(title)
        print(f"[Phase 5] {title}: notes degraded")

    return {
        "section_id": section_def["section_id"],
        "section_title": title,
        "section_order": section_def.get("section_order", 1),
        "chapter_id": chapter_def.get("chapter_id", ""),
        "time_reference": section_def.get("time_reference", "00:00"),
        "timestamp_seconds": section_def.get("timestamp_seconds", 0),
        "theory_block": {
            "explanation": composed["explanation"],
            "analogies": [composed["analogy"]] if composed["analogy"] else [],
        },
        # Diagrams and code blocks are not requested from the model: they were the
        # two places that produced invented content most readily, and neither is
        # needed to revise from the notes.
        "visual_diagram": None,
        "visual_diagrams": [],
        "code_blocks": [],
        "key_points": composed["key_points"],
        "examples": [{"text": item} for item in composed["examples"]],
        "pitfalls": composed["pitfalls"],
        "supplement_block": None,
        "is_complete": True,
        "external_label": None,
    }


def _generate_section_with_agents(
    section_def: Dict[str, Any],
    chapter_def: Dict[str, Any],
    title: str,
    initial_state: SectionState,
) -> SectionContent:
    """The original five-agent fan-out, kept behind `PHASE5_MODE=agents`.

    It costs five model calls per section and falls back to fixed text when a call
    fails, so the lean composer is the default.
    """
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=5) as executor:
        f_theory = executor.submit(theory_agent_node, initial_state)
        f_code = executor.submit(code_agent_node, initial_state)
        f_key = executor.submit(keypoints_agent_node, initial_state)
        f_pit = executor.submit(pitfalls_agent_node, initial_state)
        f_vis = executor.submit(visual_architect_agent_node, initial_state)

        theory_out = f_theory.result()
        code_out = f_code.result()
        key_out = f_key.result()
        pit_out = f_pit.result()
        vis_out = f_vis.result()

    diag = vis_out.get("visual_diagram") or (
        vis_out.get("diagrams", [None])[0] if vis_out.get("diagrams") else None
    )
    diags = vis_out.get("visual_diagrams") or ([diag] if diag else [])

    return {
        "section_id": section_def["section_id"],
        "section_title": title,
        "section_order": section_def.get("section_order", 1),
        "chapter_id": chapter_def.get("chapter_id", ""),
        "time_reference": section_def.get("time_reference", "00:00"),
        "timestamp_seconds": section_def.get("timestamp_seconds", 0),
        "theory_block": theory_out.get(
            "theory_block",
            {
                "explanation": theory_out.get("explanation", ""),
                "analogies": [theory_out.get("analogy", "")] if theory_out.get("analogy") else [],
            },
        ),
        "visual_diagram": diag,
        "visual_diagrams": diags,
        "code_blocks": code_out.get("code_blocks", []),
        "key_points": key_out.get("key_points", []),
        "examples": pit_out.get("examples", []),
        "pitfalls": pit_out.get("pitfalls", []),
        "supplement_block": None,
        "is_complete": True,
        "external_label": None,
    }

async def run_all_chapters_batched(notes_structure: Dict[str, Any], state: MasterNotesState) -> List[ChapterContent]:
    if PHASE5_MODE == "agents":
        print(
            f"[Phase 5] Fan-out: up to {PHASE5_PARALLEL} sections in parallel, "
            "five specialist agents each (PHASE5_MODE=agents)..."
        )
    else:
        print(
            f"[Phase 5] Up to {PHASE5_PARALLEL} sections in parallel, "
            f"one model call each ({PHASE5_MODE})."
        )
    reset_diagram_cache()
    reset_degraded_sections()

    chapters_def = notes_structure.get("chapters", [])
    domain = notes_structure.get("domain") or state.get("domain") or "machine_learning"
    api_key = state.get("api_key", "")
    selected_model = state.get("model_name", "")
    github_files = state.get("github_files") or {}

    sem = asyncio.Semaphore(PHASE5_PARALLEL)
    work: List[Tuple[int, Dict[str, Any], Dict[str, Any]]] = []

    for idx, ch in enumerate(chapters_def, 1):
        ch["domain"] = domain
        for s in ch.get("sections", []):
            s["domain"] = domain
            work.append((idx, ch, s))

    async def _run_section(ch_idx: int, ch: Dict[str, Any], s: Dict[str, Any]) -> Tuple[int, str, SectionContent]:
        ch_title = ch.get("chapter_title") or ch.get("title", f"Chapter {ch_idx}")
        async with sem:
            content = await asyncio.to_thread(
                generate_section_sync,
                s,
                ch,
                api_key,
                selected_model,
                github_files,
            )
        return ch_idx, ch.get("chapter_id", f"ch_{ch_idx:02d}"), content

    results = await asyncio.gather(*[_run_section(i, ch, s) for i, ch, s in work])

    by_chapter: Dict[str, List[SectionContent]] = {}
    chapter_meta: Dict[str, Dict[str, Any]] = {}
    for ch_idx, ch in enumerate(chapters_def, 1):
        cid = ch.get("chapter_id", f"ch_{ch_idx:02d}")
        chapter_meta[cid] = ch
        by_chapter[cid] = []

    for ch_idx, cid, sec_content in results:
        by_chapter.setdefault(cid, []).append(sec_content)

    generated_chapters: List[ChapterContent] = []
    for ch_idx, ch in enumerate(chapters_def, 1):
        ch_title = ch.get("chapter_title") or ch.get("title", f"Chapter {ch_idx}")
        ch_id = ch.get("chapter_id", f"ch_{ch_idx:02d}")
        secs = by_chapter.get(ch_id, [])
        secs.sort(key=lambda x: x.get("section_order", 0))
        print(f"[Phase 5] Chapter {ch_idx}/{len(chapters_def)} done: {ch_title} ({len(secs)} sections)")
        generated_chapters.append(
            {
                "chapter_id": ch_id,
                "chapter_order": ch.get("chapter_order", ch_idx),
                "chapter_title": ch_title,
                "title": ch_title,
                "timestamp_str": ch.get("timestamp_str", "00:00"),
                "timestamp_seconds": ch.get("timestamp_seconds", 0),
                "overview": ch.get("overview", f"Comprehensive breakdown of {ch_title}."),
                "chapter_summary": ch.get(
                    "chapter_summary",
                    f"Core concepts and implementation techniques in {ch_title}.",
                ),
                "sections": secs,
            }
        )

    if DEGRADED_SECTIONS:
        shown = "; ".join(DEGRADED_SECTIONS[:5])
        more = f" (+{len(DEGRADED_SECTIONS) - 5} more)" if len(DEGRADED_SECTIONS) > 5 else ""
        print(
            f"[Phase 5] {len(DEGRADED_SECTIONS)} of {len(work)} sections could not be "
            f"synthesised and carry an honest notice instead of notes: {shown}{more}"
        )
    else:
        print(f"[Phase 5] All {len(work)} sections synthesised from the lecture.")

    return generated_chapters

parallel_chapter_agent_swarm = run_all_chapters_batched
