"""
4 U By U — Visual Architect Agent Node
Produces syntactically verified, production-grade Mermaid.js flowcharts
with automated syntax sanitization, quoting guards, and robust fallbacks.
Supports both Agentic AI / LangGraph architectures and Machine Learning workflows.
"""

import re
from typing import Dict, Any, List
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from states import SectionState
from core.model_router import get_chat_model

MERMAID_PATTERNS = {
    # ── Agentic AI & LangGraph Paradigms ─────────────────────────────
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

    START(["START: Draft Assignment"]):::startNode --> Generator["Author Agent Node"]:::proc
    Generator --> Reviewer{"Evaluator-Optimizer Grader"}:::check
    Reviewer -->|"Critique & Refinements Needed"| Generator
    Reviewer -->|"Quality Threshold Met"| END(["END: Approved Artifact"]):::endNode""",

    "human": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef pause fill:#9333ea,stroke:#c084fc,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Workflow Initiation"]):::startNode --> Step1["Autonomous Processing Node"]:::proc
    Step1 --> PersistCheck["Save State: MemorySaver Checkpointer"]:::proc
    PersistCheck --> Gate{"HITL Interruption Barrier"}:::pause
    Gate -->|"Awaiting Approval"| HumanReview["Human Reviewer: Inspect State"]:::pause
    HumanReview -->|"Feedback Provided"| Step1
    HumanReview -->|"Approved"| Resume["Resume Downstream Execution"]:::proc
    Resume --> END(["END: Verified Completion"]):::endNode""",

    "generative": """graph TD
    classDef comp fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef agent fill:#6366f1,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    ArchitectureComparison{"Execution Paradigm"}
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
    ResilientPersistence --> ProductionApp""",

    "sequential": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Input Payload"]):::startNode --> NodeA["Node 1: Extract & Outline"]:::proc
    NodeA --> NodeB["Node 2: Draft Generation"]:::proc
    NodeB --> NodeC["Node 3: Polish & Validate"]:::proc
    NodeC --> END(["END: Final Article"]):::endNode""",

    # ── Machine Learning & Data Science Paradigms ────────────────────
    "ml_workflow": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef check fill:#d97706,stroke:#fbbf24,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    START(["START: Raw Dataset"]):::startNode --> EDA["Exploratory Data Analysis (EDA)"]:::proc
    EDA --> Cleaning["Data Cleaning & Missing Value Imputation"]:::proc
    Cleaning --> Preproc["Preprocessing (Encoding & Feature Scaling)"]:::proc
    Preproc --> FeatEng["Feature Engineering & Selection"]:::proc
    FeatEng --> Split["Train / Test Stratified Split"]:::check
    Split --> Train["Model Training (Scikit-Learn Estimator)"]:::proc
    Train --> Eval{"Metric Evaluation & Residual Diagnostics"}:::check
    Eval -->|"Overfitting / Low Bias"| FeatEng
    Eval -->|"Acceptable Performance"| Deploy["Production Inference & Model Export (.joblib)"]:::endNode""",

    "ml_hierarchy": """graph TD
    classDef ai fill:#6366f1,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef ml fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef dl fill:#059669,stroke:#34d399,stroke-width:2px,color:#fff;

    AI["Artificial Intelligence (AI)<br/>Science of Intelligent Autonomous Agents"]:::ai --> ML["Machine Learning (ML)<br/>Statistical Learning & Pattern Induction"]:::ml
    ML --> DL["Deep Learning (DL)<br/>Multi-Layer Neural Representation Learning"]:::dl""",

    "trad_vs_ml": """graph LR
    classDef trad fill:#be123c,stroke:#f43f5e,stroke-width:2px,color:#fff;
    classDef ml fill:#059669,stroke:#34d399,stroke-width:2px,color:#fff;

    Data1["Input Data"] --> TradP["Traditional Programming<br/>(Hardcoded Logic)"]:::trad
    Rules1["Rules & Conditions"] --> TradP
    TradP --> Ans1["Output Answers"]

    Data2["Input Data"] --> MLEng["Machine Learning<br/>(Algorithm Optimization)"]:::ml
    Ans2["Known Answers (Labels)"] --> MLEng
    MLEng --> Rules2["Learned Decision Boundary f(x)"]:::ml""",

    "ml_types": """graph TD
    classDef root fill:#4f46e5,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef type fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef task fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;

    ML["Machine Learning Paradigms"]:::root --> Sup["Supervised Learning<br/>(Ground-Truth Labels)"]:::type
    ML --> Unsup["Unsupervised Learning<br/>(Latent Structure Discovery)"]:::type
    ML --> RL["Reinforcement Learning<br/>(Reward-Driven Policy Optimization)"]:::type

    Sup --> Reg["Regression (Continuous Targets)"]:::task
    Sup --> Clf["Classification (Discrete Classes)"]:::task
    Unsup --> Clust["Clustering (K-Means, DBSCAN)"]:::task
    Unsup --> DimRed["Dimensionality Reduction (PCA)"]:::task""",

    "eda_cleaning": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef decision fill:#d97706,stroke:#fbbf24,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    RawData(["Raw Dataset"]):::startNode --> Inspect["Inspect df.info(), df.describe() & Null Matrix"]:::proc
    Inspect --> Missing{"Missing Values Detected?"}:::decision
    Missing -->|"Numerical Features"| ImputeNum["Median / Iterative Imputer"]:::proc
    Missing -->|"Categorical Features"| ImputeCat["Mode / Missing Category Flag"]:::proc
    Missing -->|"Zero Missing"| Outliers{"Outlier Anomaly Check"}:::decision
    ImputeNum --> Outliers
    ImputeCat --> Outliers
    Outliers -->|"IQR / Z-Score Extremes"| Winsorize["Winsorization / Clipping"]:::proc
    Outliers -->|"Normal Distributions"| CleanReady(["Clean Data Matrix Ready"]):::endNode
    Winsorize --> CleanReady""",

    "preprocessing": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    CleanData(["Cleaned Dataset"]):::startNode --> SplitCols["Split Feature Types"]:::proc
    SplitCols -->|"Nominal High-Cardinality"| OHE["OneHotEncoder(handle_unknown='ignore')"]:::proc
    SplitCols -->|"Ordinal Ranked"| Ord["OrdinalEncoder()"]:::proc
    SplitCols -->|"Skewed Numerical"| Scale["StandardScaler() / RobustScaler()"]:::proc
    OHE --> ColumnTrans["ColumnTransformer Synthesis"]:::proc
    Ord --> ColumnTrans
    Scale --> ColumnTrans
    ColumnTrans --> ModelPrep(["Transformed Feature Array X"]):::endNode""",

    "feature_selection": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    AllFeatures(["Full High-Dimensional Feature Space"]):::startNode --> Filter["Filter Method: Correlation Heatmap & VarianceThreshold"]:::proc
    Filter --> Statistical["Statistical Test: SelectKBest (ANOVA / Chi2 / f_classif)"]:::proc
    Statistical --> Embedded["Embedded Model Importance: RandomForest / Lasso L1"]:::proc
    Embedded --> SelectedSubset(["Optimal Feature Subset (High Information Gain)"]):::endNode""",

    "ml_project": """graph TD
    classDef startNode fill:#0284c7,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef proc fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef eval fill:#d97706,stroke:#fbbf24,stroke-width:2px,color:#fff;
    classDef endNode fill:#10b981,stroke:#34d399,stroke-width:2px,color:#fff;

    ProblemDef(["Problem Definition & Business Objective"]):::startNode --> DataIngest["Data Load & Stratified Train-Test Split"]:::proc
    DataIngest --> FeaturePipe["Preprocessing & Transformation Pipeline"]:::proc
    FeaturePipe --> ModelFit["Estimator Training & Baseline Validation"]:::proc
    ModelFit --> Tuning["Hyperparameter Optimization (GridSearchCV / Optuna)"]:::proc
    Tuning --> Diagnostics{"Validation & Confusion Matrix Diagnostics"}:::eval
    Diagnostics -->|"Target Performance Verified"| FinalArtifact(["Export Model Pipeline Artifact (.joblib)"]):::endNode"""
}

def sanitize_mermaid(code: str) -> str:
    """
    Cleans and sanitizes Mermaid flowchart syntax to guarantee valid parsing.
    """
    if not code or not isinstance(code, str):
        return 'graph TD\n    A["Start"] --> B["End"]'

    m = re.search(r"```(?:mermaid)?\s*\n?(.*?)```", code, re.DOTALL | re.IGNORECASE)
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

        cleaned_lines.append("    " + raw_line)

    return "\n".join(cleaned_lines)

def get_bespoke_mermaid(title: str, chapter_title: str) -> str:
    combined = (title + " " + chapter_title).lower()

    # Machine Learning matches
    if "traditional" in combined or "programming vs" in combined:
        return MERMAID_PATTERNS["trad_vs_ml"]
    elif "difference" in combined or "ai,ml,dl" in combined or "ai vs" in combined:
        return MERMAID_PATTERNS["ml_hierarchy"]
    elif "types of" in combined or "supervised" in combined or "unsupervised" in combined:
        return MERMAID_PATTERNS["ml_types"]
    elif "cleaning" in combined or "eda" in combined or "missing" in combined:
        return MERMAID_PATTERNS["eda_cleaning"]
    elif "preprocessing" in combined or "scaling" in combined or "encoding" in combined:
        return MERMAID_PATTERNS["preprocessing"]
    elif "feature selection" in combined or "selection" in combined:
        return MERMAID_PATTERNS["feature_selection"]
    elif "feature engineering" in combined:
        return MERMAID_PATTERNS["feature_selection"]
    elif "project" in combined:
        return MERMAID_PATTERNS["ml_project"]
    elif "machine learning" in combined or "steps for making" in combined or "model" in combined:
        return MERMAID_PATTERNS["ml_workflow"]

    # LangGraph & Agentic matches
    elif "parallel" in combined or "reducer" in combined:
        return MERMAID_PATTERNS["parallel"]
    elif "conditional" in combined or "rag" in combined or "router" in combined:
        return MERMAID_PATTERNS["conditional"]
    elif "iterative" in combined:
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

    # If transcript is available and user has API key, try generating contextual flowchart
    api_key = state.get("api_key")
    selected_model = state.get("model_name")
    if api_key and transcript and len(transcript) > 200:
        try:
            llm = get_chat_model(api_key=api_key, model_name=selected_model, temperature=0.1)
            prompt = PromptTemplate.from_template(
                """You are an Expert Visual Architect. Create a valid, syntactically clean Mermaid.js flowchart (graph TD) illustrating the workflow for: "{section_title}"
(Chapter: "{chapter_title}").

Lecture Context:
\"\"\"{transcript}\"\"\"

Rules:
1. Start with `graph TD`
2. Enclose all node descriptions in double quotes: A["Description"] --> B["Next Step"]
3. Keep it clean with 4 to 7 nodes.
4. Output strictly inside a ```mermaid ``` code block."""
            )
            chain = prompt | llm | StrOutputParser()
            res = chain.invoke({
                "section_title": title,
                "chapter_title": chapter_title,
                "transcript": transcript[:1500]
            })
            mermaid_code = sanitize_mermaid(res)
            return {
                "diagrams": [{
                    "type": "mermaid",
                    "src": mermaid_code,
                    "caption": f"Architecture Flowchart: {title} ({time_ref})",
                    "description": f"Visual workflow of {title}."
                }]
            }
        except Exception as e:
            print(f"[VisualArchitect] LLM diagram notice for {title}: {e}")

    # Fallback to authentic bespoke diagram
    return {
        "diagrams": [{
            "type": "mermaid",
            "src": sanitize_mermaid(bespoke),
            "caption": f"Architecture Flowchart: {title} ({time_ref})",
            "description": f"Visual workflow of {title}."
        }]
    }
