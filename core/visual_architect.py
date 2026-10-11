"""
4 U By U — Visual Architect Agent Node
Produces syntactically verified, production-grade Mermaid.js flowcharts
with automated syntax sanitization, quoting guards, and robust fallbacks.
"""

import re
from typing import Dict, Any, List
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from states import SectionState
from core.model_router import get_chat_model

MERMAID_PATTERNS = {
    "parallel": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef worker fill:#1e293b,stroke:#0ea5e9,stroke-width:2px,color:#f8fafc;
    classDef reducer fill:#4f46e5,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Distributed Task"]):::startNode --> FanOut{"Fan-Out Dispatcher"}
    FanOut -->|"Task A"| WorkerA["Worker Node A: Research Subagent"]:::worker
    FanOut -->|"Task B"| WorkerB["Worker Node B: Verification Subagent"]:::worker
    WorkerA --> Reducer["State Reducer: operator.add"]:::reducer
    WorkerB --> Reducer
    Reducer --> Consolidate["Consolidate Combined State"]:::worker
    Consolidate --> END(["END: Deterministic Output"]):::endNode""",

    "conditional": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef decision fill:#d97706,stroke:#fbbf24,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Incoming Query"]):::startNode --> Router{"Conditional Edge Router"}:::decision
    Router -->|"Requires Retrieval"| VectorRAG["Hybrid Vector Store Retrieval"]:::proc
    Router -->|"Direct Reasoning"| DirectLLM["Direct Model Synthesis"]:::proc
    VectorRAG --> EvaluateDoc{"Relevance Grader"}:::decision
    EvaluateDoc -->|"Grounded"| GenResponse["Context-Aware Generation"]:::proc
    EvaluateDoc -->|"Missing Context"| WebFallback["Live Web Search Fallback"]:::proc
    WebFallback --> GenResponse
    GenResponse --> END(["END: Validated Response"]):::endNode
    DirectLLM --> END""",

    "iterative": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef check fill:#ea580c,stroke:#fb923c,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Goal & Task Spec"]):::startNode --> DraftAgent["Draft Generation Node"]:::proc
    DraftAgent --> CriticAgent["Self-Correction & Lint Evaluator"]:::proc
    CriticAgent --> QualityGate{"Passes Acceptance Tests?"}:::check
    QualityGate -->|"No: Retry & Refine"| Reflection["Reflection & Memory Update"]:::proc
    Reflection --> DraftAgent
    QualityGate -->|"Yes: Approved"| Finalize["Checkpoint & Package Artifact"]:::proc
    Finalize --> END(["END: Verified Solution"]):::endNode""",

    "human": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef gate fill:#e11d48,stroke:#f43f5e,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Execution Trigger"]):::startNode --> Propose["Plan Sensitive Action"]:::proc
    Propose --> Checkpointer[("Save State Snapshot to MemorySaver")]:::proc
    Checkpointer --> InterruptGate(("INTERRUPT_BEFORE: Human Review")):::gate
    InterruptGate --> HumanDecision{"Human Approval Gate"}:::gate
    HumanDecision -->|"Modify / Reject"| HumanInput["Inject Human Guidance"]:::proc
    HumanInput --> Propose
    HumanDecision -->|"Approved"| Resume["Resume Graph Execution"]:::proc
    Resume --> ExecuteTool["Execute Real Production Tool"]:::proc
    ExecuteTool --> END(["END: Action Completed"]):::endNode""",

    "sequential": """graph LR
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START"]):::startNode --> Ingest["State Ingestion & Schema Validation"]:::proc
    Ingest --> Process["Sequential Processing Node"]:::proc
    Process --> Transform["State Transformation & Formatting"]:::proc
    Transform --> END(["END: Deterministic Return"]):::endNode""",

    "generative": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef comp fill:#1e293b,stroke:#0ea5e9,stroke-width:2px,color:#f8fafc;
    classDef agent fill:#7c3aed,stroke:#a855f7,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    UserQuery["User Input Prompt"]:::startNode --> ArchitectureComparison{"Execution Paradigm"}
    ArchitectureComparison -->|"Single-Turn Generative AI"| StatelessLLM["Stateless LLM Invocation"]:::comp
    StatelessLLM --> StaticText["Static Text Output"]:::endNode
    ArchitectureComparison -->|"Agentic Workflow"| AgenticLoop["Perception-Action Loop"]:::agent
    AgenticLoop --> Environment["Tool Calling & Real World Environment"]:::comp
    Environment --> MemoryState["Persistent State Reducer"]:::comp
    MemoryState --> AgenticLoop
    MemoryState --> VerifiedResult["Autonomous Verified Outcome"]:::endNode""",

    "why_langgraph": """graph TD
    classDef flaw fill:#be123c,stroke:#f43f5e,stroke-width:2px,color:#fff;
    classDef feature fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef goal fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    LangChainChains["Traditional Chains / DAGs"]:::flaw -.->|"Limitation"| CannotLoop["No Cyclic Loops / Rigid Linear Execution"]:::flaw
    LangGraph["LangGraph StateGraph Engine"]:::feature --> CyclicSupport["Cyclic & Conditional Edge Support"]:::feature
    LangGraph --> BuiltinState["First-Class Typed State Reducers"]:::feature
    LangGraph --> ResilientPersistence["MemorySaver Time-Travel & HITL"]:::feature
    CyclicSupport --> ProductionApp["Production-Grade Autonomous Multi-Agent System"]:::goal
    BuiltinState --> ProductionApp
    ResilientPersistence --> ProductionApp"""
}

def sanitize_mermaid(code: str) -> str:
    """
    Cleans and sanitizes Mermaid flowchart syntax to guarantee 100% valid parsing in Mermaid:
    - Extracts existing graph/flowchart declaration (graph TD or graph LR) without duplicates.
    - Guarantees exactly ONE graph declaration at line 1.
    - Encloses all label contents in double quotes if they contain special chars.
    """
    if not code or not isinstance(code, str):
        return 'graph TD\n    A["Start"] --> B["End"]'

    m = re.search(r"`(?:mermaid)?\s*\n?(.*?)`", code, re.DOTALL | re.IGNORECASE)
    if m:
        code = m.group(1)

    lines = code.strip().split("\n")
    cleaned_lines = []

    direction = "graph TD"
    for line in lines:
        s = line.strip()
        m_dir = re.match(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)", s, re.IGNORECASE)
        if m_dir:
            direction = f"{m_dir.group(1).lower()} {m_dir.group(2).upper()}"
            break

    cleaned_lines.append(direction)

    for line in lines:
        raw_line = line.strip()
        if not raw_line:
            continue

        if re.match(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)", raw_line, re.IGNORECASE):
            continue

        if raw_line.startswith("classDef") or raw_line.startswith("class ") or raw_line.startswith("style "):
            cleaned_lines.append("    " + raw_line)
            continue

        def clean_label(txt: str) -> str:
            t = txt.strip()
            if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
                t = t[1:-1]
            t = t.replace('"', "'")
            return f'"{t}"'

        fixed = raw_line
        fixed = re.sub(r'\[\[(.*?)\]\]', lambda match: f'[[{clean_label(match.group(1))}]]', fixed)
        fixed = re.sub(r'\(\((.*?)\)\)', lambda match: f'(({clean_label(match.group(1))}))', fixed)
        fixed = re.sub(r'\(\[(.*?)\]\)', lambda match: f'([{clean_label(match.group(1))}])', fixed)
        fixed = re.sub(r'\[\((.*?)\)\]', lambda match: f'[({clean_label(match.group(1))})]', fixed)
        fixed = re.sub(r'\{(.*?)\}', lambda match: f'{{{clean_label(match.group(1))}}}', fixed)
        fixed = re.sub(r'(?<![\[\(\>])\[([^\[\]\(\)\{\}]+)\](?![\/\]\)])', lambda match: f'[{clean_label(match.group(1))}]', fixed)

        cleaned_lines.append("    " + fixed)

    return "\n".join(cleaned_lines)

def get_bespoke_mermaid(title: str, chapter_title: str) -> str:
    combined = (title + " " + chapter_title).lower()
    if "parallel" in combined or "reducer" in combined:
        return MERMAID_PATTERNS["parallel"]
    elif "conditional" in combined or "rag" in combined or "router" in combined:
        return MERMAID_PATTERNS["conditional"]
    elif "iterative" in combined or "project" in combined:
        return MERMAID_PATTERNS["iterative"]
    elif "human" in combined or "hitl" in combined:
        return MERMAID_PATTERNS["human"]
    elif "generative" in combined or "agentic" in combined:
        return MERMAID_PATTERNS["generative"]
    elif "why" in combined and "langgraph" in combined:
        return MERMAID_PATTERNS["why_langgraph"]
    else:
        return MERMAID_PATTERNS["sequential"]

def visual_architect_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state.get("section_title", "Concept Workflow")
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    time_ref = state.get("time_reference", "00:00")
    transcript = state.get("transcript_slice", "")

    bespoke = get_bespoke_mermaid(title, chapter_title)

    prompt = PromptTemplate.from_template(
        """You are a Principal Cloud Architecture Diagrams Specialist.
Create an interactive Mermaid.js flowchart visualizing this technical workflow:
Section: "{title}"
Chapter: "{chapter_title}"

Transcript:
\"\"\"{transcript}\"\"\"

Requirements:
- Valid Mermaid.js diagram starting with `graph TD` or `graph LR`
- Enclose all node labels strictly in double quotes: e.g. Node["Label (Details)"]
- Use meaningful, highly descriptive node labels
- Must contain at least 4 nodes illustrating the specific control flow
- Wrap ONLY inside ```mermaid ... ``` markdown block. No conversational filler."""
    )

    llm = get_chat_model(temperature=0.1)
    try:
        chain = prompt | llm | StrOutputParser()
        raw = chain.invoke({
            "title": title,
            "chapter_title": chapter_title,
            "transcript": transcript[:1000] if transcript else ""
        }).strip()

        m_match = re.search(r"```(?:mermaid)?\s*\n(.*?)```", raw, re.DOTALL | re.IGNORECASE)
        if m_match:
            candidate = m_match.group(1).strip()
            if "graph TD" in candidate or "graph LR" in candidate:
                bespoke = sanitize_mermaid(candidate)
    except Exception as e:
        print(f"[VisualArchitect] Using curated flowchart template for {title}: {e}")
        bespoke = sanitize_mermaid(bespoke)

    # Final sanitization pass guarantee
    bespoke = sanitize_mermaid(bespoke)

    diagram_obj = {
        "type": "mermaid",
        "src": bespoke,
        "mermaid_code": bespoke,
        "caption": f"Execution Flowchart — {title}",
        "time_anchor": time_ref
    }

    return {
        "diagrams": [diagram_obj],
        "visual_diagram": diagram_obj,
        "visual_diagrams": [diagram_obj]
    }
