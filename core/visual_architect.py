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
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef worker fill:#f1f5f9,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef reducer fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START: Distributed Task"]):::start --> FanOut{"Fan-Out Dispatcher"}
    FanOut -->|"Task A"| WorkerA["Worker Node A: Research Subagent"]:::worker
    FanOut -->|"Task B"| WorkerB["Worker Node B: Verification Subagent"]:::worker
    WorkerA --> Reducer["State Reducer: operator.add"]:::reducer
    WorkerB --> Reducer
    Reducer --> Consolidate["Consolidate Combined State"]:::worker
    Consolidate --> END(["END: Deterministic Output"]):::finish""",

    "conditional": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START: Incoming Query"]):::start --> Router{"Conditional Edge Router"}:::decision
    Router -->|"Requires Retrieval"| VectorRAG["Hybrid Vector Store Retrieval"]:::proc
    Router -->|"Direct Reasoning"| DirectLLM["Direct Model Synthesis"]:::proc
    VectorRAG --> EvaluateDoc{"Relevance Grader"}:::decision
    EvaluateDoc -->|"Grounded"| GenResponse["Context-Aware Generation"]:::proc
    EvaluateDoc -->|"Missing Context"| WebFallback["Live Web Search Fallback"]:::proc
    WebFallback --> GenResponse
    GenResponse --> END(["END: Validated Response"]):::finish
    DirectLLM --> END""",

    "iterative": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef check fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START: Draft Assignment"]):::start --> Generator["Author Agent Node"]:::proc
    Generator --> Reviewer{"Evaluator-Optimizer Grader"}:::check
    Reviewer -->|"Critique & Refinements Needed"| Generator
    Reviewer -->|"Quality Threshold Met"| END(["END: Approved Artifact"]):::finish""",

    "human": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef pause fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START: Workflow Initiation"]):::start --> Step1["Autonomous Processing Node"]:::proc
    Step1 --> PersistCheck["Save State: MemorySaver Checkpointer"]:::proc
    PersistCheck --> Gate{"HITL Interruption Barrier"}:::pause
    Gate -->|"Awaiting Approval"| HumanReview["Human Reviewer: Inspect State"]:::pause
    HumanReview -->|"Feedback Provided"| Step1
    HumanReview -->|"Approved"| Resume["Resume Downstream Execution"]:::proc
    Resume --> END(["END: Verified Completion"]):::finish""",

    "generative": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef comp fill:#f1f5f9,stroke:#64748b,stroke-width:2px,color:#0f172a;
    classDef agent fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    UserObjective["User Objective"]:::start --> Paradigm{"Workflow Paradigm"}
    Paradigm -->|"Single-Turn Generative AI"| StatelessLLM["Stateless LLM Invocation"]:::comp
    StatelessLLM --> StaticText["Static Text Output"]:::finish
    Paradigm -->|"Agentic Workflow"| AgenticLoop["Perception-Action Loop"]:::agent
    AgenticLoop --> Environment["Tool Calling & Real World Environment"]:::comp
    Environment --> MemoryState["Persistent State Reducer"]:::comp
    MemoryState --> AgenticLoop
    MemoryState --> VerifiedResult["Autonomous Verified Outcome"]:::finish""",

    "why_langgraph": """graph TD
    classDef flaw fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b;
    classDef feature fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef goal fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    LangChainChains["Traditional Chains / DAGs"]:::flaw -.->|"Limitation"| CannotLoop["No Cyclic Loops / Rigid Linear Execution"]:::flaw
    LangGraph["LangGraph StateGraph Engine"]:::feature --> CyclicSupport["Cyclic & Conditional Edge Support"]:::feature
    LangGraph --> BuiltinState["First-Class Typed State Reducers"]:::feature
    LangGraph --> ResilientPersistence["MemorySaver Time-Travel & HITL"]:::feature
    CyclicSupport --> ProductionApp["Production-Grade Autonomous Multi-Agent System"]:::goal
    BuiltinState --> ProductionApp
    ResilientPersistence --> ProductionApp""",

    "sequential": """graph LR
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START"]):::start --> Ingest["State Ingestion & Schema Validation"]:::proc
    Ingest --> Process["Sequential Processing Node"]:::proc
    Process --> Transform["State Transformation & Formatting"]:::proc
    Transform --> END(["END: Deterministic Return"]):::finish""",

    # ── Machine Learning & Data Science Paradigms ────────────────────
    "ml_workflow": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef check fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    START(["START: Raw Dataset"]):::start --> EDA["Exploratory Data Analysis (EDA)"]:::proc
    EDA --> Cleaning["Data Cleaning & Missing Value Imputation"]:::proc
    Cleaning --> Preproc["Preprocessing (Encoding & Feature Scaling)"]:::proc
    Preproc --> FeatEng["Feature Engineering & Selection"]:::proc
    FeatEng --> Split["Train / Test Stratified Split"]:::check
    Split --> Train["Model Training (Scikit-Learn Estimator)"]:::proc
    Train --> Eval{"Metric Evaluation & Residual Diagnostics"}:::check
    Eval -->|"Overfitting / Low Bias"| FeatEng
    Eval -->|"Acceptable Performance"| Deploy["Production Inference & Model Export (.joblib)"]:::finish""",

    "ml_hierarchy": """graph TD
    classDef ai fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef ml fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef dl fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    AI["Artificial Intelligence (AI)<br/>Science of Intelligent Autonomous Agents"]:::ai --> ML["Machine Learning (ML)<br/>Statistical Learning & Pattern Induction"]:::ml
    ML --> DL["Deep Learning (DL)<br/>Multi-Layer Neural Representation Learning"]:::dl""",

    "trad_vs_ml": """graph LR
    classDef trad fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b;
    classDef ml fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    Data1["Input Data"] --> TradP["Traditional Programming<br/>(Hardcoded Logic)"]:::trad
    Rules1["Rules & Conditions"] --> TradP
    TradP --> Ans1["Output Answers"]

    Data2["Input Data"] --> MLEng["Machine Learning<br/>(Algorithm Optimization)"]:::ml
    Ans2["Known Answers (Labels)"] --> MLEng
    MLEng --> Rules2["Learned Decision Boundary f(x)"]:::ml""",

    "ml_types": """graph TD
    classDef root fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef type fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef task fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;

    ML["Machine Learning Paradigms"]:::root --> Sup["Supervised Learning<br/>(Ground-Truth Labels)"]:::type
    ML --> Unsup["Unsupervised Learning<br/>(Latent Structure Discovery)"]:::type
    ML --> RL["Reinforcement Learning<br/>(Reward-Driven Policy Optimization)"]:::type

    Sup --> Reg["Regression (Continuous Targets)"]:::task
    Sup --> Clf["Classification (Discrete Classes)"]:::task
    Unsup --> Clust["Clustering (K-Means, DBSCAN)"]:::task
    Unsup --> DimRed["Dimensionality Reduction (PCA)"]:::task""",

    "eda_cleaning": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    RawData(["Raw Dataset"]):::start --> Inspect["Inspect df.info(), df.describe() & Null Matrix"]:::proc
    Inspect --> Missing{"Missing Values Detected?"}:::decision
    Missing -->|"Numerical Features"| ImputeNum["Median / Iterative Imputer"]:::proc
    Missing -->|"Categorical Features"| ImputeCat["Mode / Missing Category Flag"]:::proc
    Missing -->|"Zero Missing"| Outliers{"Outlier Anomaly Check"}:::decision
    ImputeNum --> Outliers
    ImputeCat --> Outliers
    Outliers -->|"IQR / Z-Score Extremes"| Winsorize["Winsorization / Clipping"]:::proc
    Outliers -->|"Normal Distributions"| CleanReady(["Clean Data Matrix Ready"]):::finish
    Winsorize --> CleanReady""",

    "preprocessing": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    CleanData(["Cleaned Dataset"]):::start --> SplitCols["Split Feature Types"]:::proc
    SplitCols -->|"Nominal High-Cardinality"| OHE["OneHotEncoder(handle_unknown='ignore')"]:::proc
    SplitCols -->|"Ordinal Ranked"| Ord["OrdinalEncoder()"]:::proc
    SplitCols -->|"Skewed Numerical"| Scale["StandardScaler() / RobustScaler()"]:::proc
    OHE --> ColumnTrans["ColumnTransformer Synthesis"]:::proc
    Ord --> ColumnTrans
    Scale --> ColumnTrans
    ColumnTrans --> ModelPrep(["Transformed Feature Array X"]):::finish""",

    "feature_selection": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    AllFeatures(["Full High-Dimensional Feature Space"]):::start --> Filter["Filter Method: Correlation Heatmap & VarianceThreshold"]:::proc
    Filter --> Statistical["Statistical Test: SelectKBest (ANOVA / Chi2 / f_classif)"]:::proc
    Statistical --> Embedded["Embedded Model Importance: RandomForest / Lasso L1"]:::proc
    Embedded --> SelectedSubset(["Optimal Feature Subset (High Information Gain)"]):::finish""",

    "ml_project": """graph TD
    classDef start fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef proc fill:#f8fafc,stroke:#0284c7,stroke-width:2px,color:#0f172a;
    classDef eval fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef finish fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    ProblemDef(["Problem Definition & Business Objective"]):::start --> DataIngest["Data Load & Stratified Train-Test Split"]:::proc
    DataIngest --> FeaturePipe["Preprocessing & Transformation Pipeline"]:::proc
    FeaturePipe --> ModelFit["Estimator Training & Baseline Validation"]:::proc
    ModelFit --> Tuning["Hyperparameter Optimization (GridSearchCV / Optuna)"]:::proc
    Tuning --> Diagnostics{"Validation & Confusion Matrix Diagnostics"}:::eval
    Diagnostics -->|"Target Performance Verified"| FinalArtifact(["Export Model Pipeline Artifact (.joblib)"]):::finish"""
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
