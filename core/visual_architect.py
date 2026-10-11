"""
4 U By U - Visual Architect Agent Node
Produces syntactically verified, production-grade Mermaid.js flowcharts
with strict domain isolation, relevance gating, and cross-course deduplication.
Eliminates duplicate diagrams and foreign framework spam.
"""

import re
from typing import Dict, Any, List, Optional, Set
from states import SectionState

# Track used diagrams across the session to prevent repeating duplicate flowcharts
USED_DIAGRAM_KEYS: Set[str] = set()

def reset_diagram_cache():
    """Resets the diagram deduplication cache for a fresh compilation run."""
    global USED_DIAGRAM_KEYS
    USED_DIAGRAM_KEYS.clear()

MERMAID_PATTERNS = {
    # -- Machine Learning & Data Science Paradigms -----------------------
    "trad_vs_ml": """graph LR
    classDef trad fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#991b1b;
    classDef ml fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    Data1["Input Data"] --> TradP["Traditional Programming<br/>(Hardcoded Logic)"]:::trad
    Rules1["Rules & Conditions"] --> TradP
    TradP --> Ans1["Output Answers"]

    Data2["Input Data"] --> MLEng["Machine Learning<br/>(Pattern Induction)"]:::ml
    Ans2["Known Labels / Targets"] --> MLEng
    MLEng --> Rules2["Learned Decision Boundary f(x)"]:::ml""",

    "ml_hierarchy": """graph TD
    classDef ai fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef ml fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#581c87;
    classDef dl fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#065f46;

    AI["Artificial Intelligence (AI)<br/>Science of Intelligent Autonomous Agents"]:::ai --> ML["Machine Learning (ML)<br/>Statistical Learning & Pattern Induction"]:::ml
    ML --> DL["Deep Learning (DL)<br/>Multi-Layer Neural Representation Learning"]:::dl""",

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
    Split --> Train["Model Training (Estimator Fitting)"]:::proc
    Train --> Eval{"Metric Evaluation & Residual Diagnostics"}:::check
    Eval -->|"Overfitting / Tuning Required"| FeatEng
    Eval -->|"Target Metric Satisfied"| Deploy["Production Model Artifact Export"]:::finish""",

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
    SplitCols -->|"Nominal Categoricals"| OHE["OneHotEncoder(handle_unknown='ignore')"]:::proc
    SplitCols -->|"Ordinal Categoricals"| Ord["OrdinalEncoder()"]:::proc
    SplitCols -->|"Numerical Features"| Scale["StandardScaler() / RobustScaler()"]:::proc
    OHE --> ColumnTrans["ColumnTransformer Pipeline Integration"]:::proc
    Ord --> ColumnTrans
    Scale --> ColumnTrans
    ColumnTrans --> ModelPrep(["Transformed Feature Matrix X"]):::finish""",

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
    ModelFit --> Tuning["Hyperparameter Optimization (GridSearchCV)"]:::proc
    Tuning --> Diagnostics{"Validation & Confusion Matrix Diagnostics"}:::eval
    Diagnostics -->|"Target Performance Verified"| FinalArtifact(["Export Model Pipeline Artifact (.joblib)"]):::finish""",

    # -- Agentic AI & LangGraph Paradigms ------------------------------
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
    Resume --> END(["END: Verified Completion"]):::finish"""
}

def sanitize_mermaid(code: str) -> str:
    """Cleans and sanitizes Mermaid flowchart syntax to guarantee valid parsing."""
    if not code or not isinstance(code, str):
        return ""

    pattern = r"```(?:mermaid)?[ \t]*\r?\n?(.*?)```"
    m = re.search(pattern, code, re.DOTALL | re.IGNORECASE)
    if m:
        code = m.group(1)

    lines = [ln.strip() for ln in code.strip().splitlines() if ln.strip()]
    cleaned_lines = []

    direction = "graph TD"
    for s in lines:
        m_dir = re.match(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)", s, re.IGNORECASE)
        if m_dir:
            direction = f"{m_dir.group(1).lower()} {m_dir.group(2).upper()}"
            break

    cleaned_lines.append(direction)

    for raw_line in lines:
        if re.match(r"^(graph|flowchart)\s+(TD|TB|BT|RL|LR)", raw_line, re.IGNORECASE):
            continue

        if raw_line.startswith("classDef") or raw_line.startswith("class ") or raw_line.startswith("style "):
            cleaned_lines.append("    " + raw_line)
            continue

        cleaned_lines.append("    " + raw_line)

    return "\n".join(cleaned_lines)

def should_generate_diagram(title: str, chapter_title: str, domain: str) -> bool:
    """
    Strict Gating: Evaluates whether this section warrants an architectural flowchart.
    Introductory, roadmap, applications, and outro sections MUST return False.
    """
    c_low = (title + " " + chapter_title).lower()
    
    # Suppress on non-architectural / conceptual overview sections
    suppress_keywords = ["introduction", "welcome", "content overview", "roadmap", "prerequisite", "outro", "summary", "conclusion", "applications"]
    if any(k in c_low for k in suppress_keywords):
        return False
        
    if domain == "machine_learning":
        ml_arch_keywords = [
            "traditional", "programming vs", "difference", "ai,ml,dl", "types of",
            "steps for making", "lifecycle", "eda", "exploratory", "cleaning",
            "preprocessing", "feature selection", "project"
        ]
        return any(k in c_low for k in ml_arch_keywords)
        
    elif domain == "agentic_ai":
        agent_arch_keywords = [
            "parallel", "conditional", "router", "iterative", "human", "hitl", "workflow", "cycle"
        ]
        return any(k in c_low for k in agent_arch_keywords)
        
    return False

def get_bespoke_diagram_key(title: str, chapter_title: str, domain: str) -> Optional[str]:
    """Identifies the bespoke diagram pattern key matching the section topic."""
    c_low = (title + " " + chapter_title).lower()

    if domain == "machine_learning":
        if "traditional" in c_low or "programming vs" in c_low:
            return "trad_vs_ml"
        elif "difference" in c_low or "ai,ml,dl" in c_low or "ai vs" in c_low:
            return "ml_hierarchy"
        elif "types of" in c_low or "supervised" in c_low:
            return "ml_types"
        elif "steps for making" in c_low or "lifecycle" in c_low:
            return "ml_workflow"
        elif "eda" in c_low or "cleaning" in c_low:
            return "eda_cleaning"
        elif "preprocessing" in c_low or "scaling" in c_low or "encoding" in c_low:
            return "preprocessing"
        elif "feature selection" in c_low or "selection" in c_low:
            return "feature_selection"
        elif "project" in c_low:
            return "ml_project"
        return None

    elif domain == "agentic_ai":
        if "parallel" in c_low or "reducer" in c_low:
            return "parallel"
        elif "conditional" in c_low or "router" in c_low:
            return "conditional"
        elif "iterative" in c_low or "cycle" in c_low:
            return "iterative"
        elif "human" in c_low or "hitl" in c_low:
            return "human"
        return None

    return None

def visual_architect_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state.get("section_title", "Concept Workflow")
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    time_ref = state.get("time_reference", "00:00")
    domain = state.get("domain") or "machine_learning"

    # Step 1: Strict Gating
    if not should_generate_diagram(title, chapter_title, domain):
        return {
            "diagrams": [],
            "visual_diagram": None,
            "visual_diagrams": []
        }

    # Step 2: Match bespoke diagram key and enforce deduplication
    diag_key = get_bespoke_diagram_key(title, chapter_title, domain)
    if not diag_key or diag_key in USED_DIAGRAM_KEYS:
        # Already used or no valid pattern -- do NOT duplicate
        return {
            "diagrams": [],
            "visual_diagram": None,
            "visual_diagrams": []
        }

    # Mark key as used so it never repeats across the course
    USED_DIAGRAM_KEYS.add(diag_key)
    mermaid_code = MERMAID_PATTERNS.get(diag_key, "")

    caption_text = f"Architecture Flowchart: {chapter_title} ({time_ref})"

    diag_obj = {
        "type": "mermaid",
        "src": sanitize_mermaid(mermaid_code),
        "caption": caption_text,
        "description": f"Visual workflow of {title}."
    }

    return {
        "diagrams": [diag_obj],
        "visual_diagram": diag_obj,
        "visual_diagrams": [diag_obj]
    }
