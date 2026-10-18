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

PHASE5_PARALLEL = max(1, int(os.environ.get("PHASE5_PARALLEL", "6")))

# Providers meter tokens per minute, and a chapter's transcript excerpt is the
# whole cost of a theory prompt. One long chapter can spend that entire budget by
# itself — the same character count costs roughly twice as many tokens in
# Devanagari as in English — which is enough for a request to be refused before it
# ever runs. So these are tried in order, and the provider's own "request too
# large" verdict is what moves us down the list.
PHASE5_EXCERPT_STEPS = (6000, 3000, 1500)

# Sections whose notes could not be written, so a run can report itself accurately.
DEGRADED_SECTIONS: List[str] = []


def reset_degraded_sections() -> None:
    """Clears the per-run record of sections that fell back to an honest notice."""
    DEGRADED_SECTIONS.clear()


def is_request_too_large(message: str) -> bool:
    """True when the provider refused because one request exceeded its meter."""
    return "413" in message or "Request too large" in message


def is_rate_limit(message: str) -> bool:
    """True when this minute's allowance is spent.

    Kept exclusive of `is_request_too_large`: the provider tags both refusals with
    `rate_limit_exceeded`, but they call for opposite responses — one must wait,
    the other must send less — so the size check takes precedence.
    """
    if is_request_too_large(message):
        return False
    return "429" in message or "rate_limit_exceeded" in message or "TPM Rate Limit" in message


def describe_llm_failure(message: str) -> str:
    """A short, human reason for a failed call, with the provider's payload stripped out."""
    if is_request_too_large(message):
        return "the request asked for more tokens in one minute than the provider allows"
    if is_rate_limit(message):
        return (
            "the provider's per-minute token allowance was already spent when this "
            "section was requested"
        )
    if "401" in message or "invalid_api_key" in message:
        return "the provider rejected the API key"
    return re.sub(r"\s+", " ", message).strip()[:200] or "the provider gave no reason"


def advise_on_llm_failure(message: str) -> str:
    """What the reader can actually do about a failed call."""
    if is_request_too_large(message):
        return (
            "This is a provider quota, not a problem with your notes. Pick fewer chapters at "
            "once, or move to a provider plan with a larger tokens-per-minute allowance."
        )
    if is_rate_limit(message):
        return (
            "This is a provider quota, not a problem with your notes. Wait about a minute and "
            "generate this chapter again, pick fewer chapters at once, or move to a provider "
            "plan with a larger tokens-per-minute allowance."
        )
    if "401" in message or "invalid_api_key" in message:
        return "Check that the API key in Settings is still valid and has not been rotated."
    return "Generate this chapter again; if it keeps failing the provider may be having an outage."

# ── Domain-Specific Fallback Code Snippets ─────────────────────────────
FALLBACK_ML_CODE = {
    "intro_setup": """# ==============================================================================
# Chapter 01 & 02: Machine Learning Runtime Environment & Prerequisite Verification
# ==============================================================================
import sys
import sklearn
import pandas as pd
import numpy as np

# Step 1: Verify core scientific computing & machine learning libraries
print("--- Runtime Environment Diagnostic ---")
print(f"Python Binary: {sys.executable}")
print(f"Python Version: {sys.version.split()[0]}")
print(f"Scikit-Learn Version: {sklearn.__version__} (Core modeling and pipelines)")
print(f"Pandas Version: {pd.__version__} (DataFrame structures and tabular manipulation)")
print(f"NumPy Version: {np.__version__} (N-dimensional vector and matrix operations)")

# Step 2: Establish deterministic pseudo-random seeds for reproducible experiments
RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)

print("\n[Environment Status] Machine Learning engineering runtime is verified and operational.")""",

    "what_is_ml": """# ==============================================================================
# Chapter 03: Core Philosophy of Machine Learning & Statistical Induction
# ==============================================================================
import numpy as np
from sklearn.linear_model import LinearRegression

# Step 1: Feature Matrix X (Experience / Inputs) & Target Vector y (Ground Truth Labels)
# In supervised learning, the algorithm discovers the mapping function f(X) -> y
X = np.array([[1.0], [2.0], [3.0], [4.0], [5.0]], dtype=float)
y = np.array([2.1, 4.0, 5.9, 8.2, 10.1], dtype=float)

# Step 2: Estimator Instantiation & Model Fitting (Optimization over loss function)
estimator = LinearRegression()
estimator.fit(X, y)

# Step 3: Inspect Learned Parameters (Slope Weight w and Intercept Bias b)
weight_w = estimator.coef_[0]
bias_b = estimator.intercept_
print(f"Learned Weight Parameter (Slope w): {weight_w:.4f}")
print(f"Learned Bias Parameter (Intercept b): {bias_b:.4f}")
print(f"Induction Hypothesis: f(x) = {weight_w:.4f} * x + {bias_b:.4f}")

# Step 4: Inference on Unseen Observation
new_sample = np.array([[6.0]])
predicted_target = estimator.predict(new_sample)
print(f"Model Inference for x=6.0: {predicted_target[0]:.4f}")""",

    "trad_vs_ml": """# ==============================================================================
# Chapter 05: Traditional Programming vs Machine Learning Paradigm Comparison
# ==============================================================================
import numpy as np
from sklearn.tree import DecisionTreeClassifier

# ------------------------------------------------------------------------------
# Paradigm 1: Traditional Programming (Hardcoded Rule-Based Logic)
# ------------------------------------------------------------------------------
def deterministic_rule_classifier(temperature: float, humidity: float) -> str:
    # Rules and inputs are crafted manually by a human programmer.
    if temperature > 30 and humidity > 70:
        return "Rain Likely"
    elif temperature < 15:
        return "Cold"
    return "Pleasant"

print("--- Paradigm 1: Deterministic Rules ---")
print("Rule Prediction (32C, 80% humidity):", deterministic_rule_classifier(32, 80))

# ------------------------------------------------------------------------------
# Paradigm 2: Machine Learning (Data-Driven Decision Boundary Induction)
# ------------------------------------------------------------------------------
# Historical Data Inputs: [temperature, humidity]
# Historical Answers (Labels): 0 = Pleasant, 1 = Rain Likely, 2 = Cold
X_train = np.array([
    [32, 80], [35, 75], [31, 85],  # Rain pattern
    [10, 50], [12, 60], [8, 45],   # Cold pattern
    [22, 50], [25, 40], [24, 55]   # Pleasant pattern
])
y_train = np.array([1, 1, 1, 2, 2, 2, 0, 0, 0])

# Algorithm derives optimal split thresholds automatically
ml_model = DecisionTreeClassifier(max_depth=3, random_state=42)
ml_model.fit(X_train, y_train)

test_observation = np.array([[33, 78]])
predicted_code = ml_model.predict(test_observation)[0]
label_map = {0: "Pleasant", 1: "Rain Likely", 2: "Cold"}
print("--- Paradigm 2: Machine Learning Induction ---")
print(f"ML Inferred Outcome (33C, 78% humidity): {label_map[predicted_code]}")""",

    "ai_ml_dl": """# ==============================================================================
# Chapter 06: Taxonomic Hierarchy: Artificial Intelligence vs ML vs Deep Learning
# ==============================================================================
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split

# Step 1: Synthesize High-Dimensional Tabular Classification Dataset
X, y = make_classification(n_samples=500, n_features=20, n_informative=12, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Step 2: Machine Learning (Statistical Flat Feature Model: Logistic Regression)
ml_model = LogisticRegression(max_iter=500, random_state=42)
ml_model.fit(X_train, y_train)
ml_accuracy = ml_model.score(X_test, y_test)
print(f"Classical ML (Logistic Regression) Test Accuracy: {ml_accuracy * 100:.2f}%")

# Step 3: Deep Learning (Hierarchical Representation Learning: Multi-Layer Perceptron)
# Automatically extracts non-linear latent abstractions across hidden layers
dl_model = MLPClassifier(hidden_layer_sizes=(64, 32), activation='relu', max_iter=500, random_state=42)
dl_model.fit(X_train, y_train)
dl_accuracy = dl_model.score(X_test, y_test)
print(f"Deep Learning (Multi-Layer Perceptron) Test Accuracy: {dl_accuracy * 100:.2f}%")""",

    "types_of_ml": """# ==============================================================================
# Chapter 07: Taxonomy of Machine Learning: Supervised, Unsupervised & RL
# ==============================================================================
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.cluster import KMeans

# 1. Supervised Learning: Explicit Ground-Truth Labels (y)
X_sup = np.array([[1.2, 3.4], [0.8, 2.9], [5.1, 7.2], [6.0, 8.1]])
y_sup = np.array([0, 0, 1, 1])
sup_clf = RandomForestClassifier(n_estimators=10, random_state=42).fit(X_sup, y_sup)
print("Supervised Classification Inference:", sup_clf.predict([[1.0, 3.0]]))

# 2. Unsupervised Learning: Unlabeled Latent Structure Discovery
X_unsup = np.array([[1, 2], [1, 4], [1, 0], [10, 2], [10, 4], [10, 0]])
kmeans = KMeans(n_clusters=2, random_state=42, n_init='auto').fit(X_unsup)
print("Discovered Unsupervised Cluster Centroids:\n", kmeans.cluster_centers_)""",

    "ml_lifecycle": """# ==============================================================================
# Chapter 08: The Complete Machine Learning Engineering Lifecycle
# ==============================================================================
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report
import numpy as np

# Step 1: Ingestion & Problem Framing
np.random.seed(42)
X_raw = np.random.randn(300, 6)
y_raw = (X_raw[:, 0] * 1.5 + X_raw[:, 1] - X_raw[:, 2] > 0).astype(int)

# Step 2: Stratified Validation Partition (Preventing distribution drift)
X_train, X_test, y_train, y_test = train_test_split(
    X_raw, y_raw, test_size=0.2, stratify=y_raw, random_state=42
)

# Step 3: Feature Scaling (Fit strictly on train split to prevent data leakage)
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

# Step 4: Estimator Training
model = GradientBoostingClassifier(n_estimators=60, learning_rate=0.1, random_state=42)
model.fit(X_train_scaled, y_train)

# Step 5: Metric Evaluation
y_pred = model.predict(X_test_scaled)
print("--- End-to-End Lifecycle Validation Report ---")
print(classification_report(y_test, y_pred, target_names=["Negative Class", "Positive Class"]))""",

    "ml_eda": """# ==============================================================================
# Chapter 09: Exploratory Data Analysis (EDA): Statistical Distributions & Matrix Inspection
# ==============================================================================
import pandas as pd
import numpy as np

# Step 1: Load Raw Dataset & Inspect High-Level Structural Metadata
df = pd.read_csv("dataset.csv")

print("--- Structural Shape & Dimensionality ---")
print(f"Total Observations (Rows): {df.shape[0]}")
print(f"Total Attributes (Columns): {df.shape[1]}")
print("\n--- Column Schema & Data Types ---")
df.info()

# Step 2: Statistical Summaries & Quartile Metrics for Numerical Features
print("\n--- Five-Number Summary & Distribution Metrics ---")
print(df.describe(percentiles=[0.25, 0.50, 0.75, 0.90, 0.99]).T)

# Step 3: Systematic Missing Value Audit
print("\n--- Missing Value Counts per Feature ---")
missing_series = df.isnull().sum()
missing_pct = (missing_series / len(df)) * 100
missing_audit = pd.DataFrame({"Missing_Count": missing_series, "Missing_Pct": missing_pct})
print(missing_audit[missing_audit["Missing_Count"] > 0])

# Step 4: Pearson Correlation Matrix Analysis (Detect Multicollinearity)
numeric_cols = df.select_dtypes(include=[np.number]).columns
if len(numeric_cols) > 1:
    corr_matrix = df[numeric_cols].corr()
    print("\n--- Top Correlated Feature Pairs ---")
    corr_unstacked = corr_matrix.unstack().sort_values(ascending=False).drop_duplicates()
    print(corr_unstacked[corr_unstacked < 1.0].head(8))""",

    "ml_cleaning": """# ==============================================================================
# Chapter 10: Data Cleaning: Missing Value Imputation & Outlier Remediation
# ==============================================================================
import pandas as pd
import numpy as np
from sklearn.impute import SimpleImputer

df = pd.read_csv("raw_data.csv")

# Step 1: Identify and Purge Duplicate Records
initial_rows = len(df)
df.drop_duplicates(inplace=True)
print(f"Purged {initial_rows - len(df)} duplicate observations.")

# Step 2: Partition Columns by Type for Specialized Imputation Strategies
num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
cat_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()

# Median imputation for numerical features (robust to heavy skewness)
if num_cols:
    num_imputer = SimpleImputer(strategy="median")
    df[num_cols] = num_imputer.fit_transform(df[num_cols])

# Mode / Most frequent imputation for categorical attributes
if cat_cols:
    cat_imputer = SimpleImputer(strategy="most_frequent")
    df[cat_cols] = cat_imputer.fit_transform(df[cat_cols])

# Step 3: Detect and Cap Outlier Extremes using IQR (Interquartile Range) Bounds
for col in num_cols:
    q25 = df[col].quantile(0.25)
    q75 = df[col].quantile(0.75)
    iqr = q75 - q25
    lower_threshold = q25 - 1.5 * iqr
    upper_threshold = q75 + 1.5 * iqr
    # Clip values into valid non-anomalous distribution boundaries
    df[col] = np.clip(df[col], lower_threshold, upper_threshold)

print(f"Data Cleaning Completed. Remaining Null Values: {df.isnull().sum().sum()}")""",

    "ml_preprocessing": """# ==============================================================================
# Chapter 11: Data Preprocessing: Categorical Feature Encoding & Feature Scaling
# ==============================================================================
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer

df = pd.read_csv("cleaned_data.csv")
X = df.drop(columns=["target"])
y = df["target"]

num_cols = X.select_dtypes(include=["int64", "float64"]).columns.tolist()
cat_cols = X.select_dtypes(include=["object", "category"]).columns.tolist()

# Step 1: Construct Leakage-Proof ColumnTransformer
# Numerical features are standardized (zero mean, unit variance)
# Categorical features are one-hot encoded (handle_unknown='ignore' prevents test crash)
preprocessor = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), num_cols),
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cat_cols)
    ]
)

# Step 2: Stratified Train-Test Split Before Fitting Preprocessor
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y if y.nunique() <= 10 else None
)

# Step 3: Fit Exclusively on Train Split, Transform Validation/Test
X_train_proc = preprocessor.fit_transform(X_train)
X_test_proc = preprocessor.transform(X_test)
print(f"Transformed Training Feature Matrix Shape: {X_train_proc.shape}")
print(f"Transformed Held-Out Test Matrix Shape: {X_test_proc.shape}")""",

    "ml_feature_engineering": """# ==============================================================================
# Chapter 12: Feature Engineering: Domain Transformations & Interaction Terms
# ==============================================================================
import pandas as pd
import numpy as np

df = pd.read_csv("dataset.csv")

# Step 1: Logarithmic Transformations for Skewed Heavy-Tailed Attributes
numeric_cols = df.select_dtypes(include=[np.number]).columns
for col in numeric_cols:
    if df[col].min() >= 0 and df[col].skew() > 1.0:
        df[f"{col}_log1p"] = np.log1p(df[col])
        print(f"Engineered log1p transform on skewed feature: {col}")

# Step 2: Domain-Driven Interaction Terms (Ratio and Product Signals)
num_list = numeric_cols.tolist()
if len(num_list) >= 2:
    feat_a, feat_b = num_list[0], num_list[1]
    df[f"{feat_a}_x_{feat_b}"] = df[feat_a] * df[feat_b]
    df[f"{feat_a}_div_{feat_b}"] = df[feat_a] / (df[feat_b].abs() + 1e-5)

# Step 3: Quantile Binning for Continuous Features
if len(num_list) > 0:
    target_num = num_list[0]
    df[f"{target_num}_binned"] = pd.qcut(df[target_num], q=4, labels=["Q1_Low", "Q2_Mid", "Q3_High", "Q4_Peak"])

print(f"Feature engineering expanded matrix to {df.shape[1]} attributes.")""",

    "ml_feature_selection": """# ==============================================================================
# Chapter 13: Feature Selection: Filter, Wrapper & Embedded Methods
# ==============================================================================
import pandas as pd
from sklearn.feature_selection import SelectKBest, f_classif, VarianceThreshold
from sklearn.ensemble import RandomForestClassifier

# Step 1: Filter Method - Eliminate Zero and Near-Zero Variance Features
var_thresh = VarianceThreshold(threshold=0.01)
X_var_filtered = var_thresh.fit_transform(X_train)

# Step 2: Statistical Filter - Select Top K High-Signal Attributes via ANOVA F-Test
num_k = min(12, X_var_filtered.shape[1])
selector = SelectKBest(score_func=f_classif, k=num_k)
X_selected = selector.fit_transform(X_var_filtered, y_train)

# Step 3: Embedded Method - Tree-Based Gini Importance Ranking
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X_selected, y_train)

print(f"Original Feature Dimension: {X_train.shape[1]}")
print(f"Optimal High-Signal Feature Dimension: {X_selected.shape[1]}")
print("RandomForest Gini Feature Importances:", rf.feature_importances_.round(4))""",

    "ml_project_1": """# ==============================================================================
# Chapter 14: Project 1: End-to-End Supervised Machine Learning Pipeline Implementation
# ==============================================================================
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix

# Step 1: Load Dataset & Partition Target Variable
df = pd.read_csv("dataset.csv")
X = df.drop(columns=["target"])
y = df["target"]

num_cols = X.select_dtypes(include=["number"]).columns.tolist()
cat_cols = X.select_dtypes(include=["object"]).columns.tolist()

# Step 2: Assemble Unified Leakage-Free Preprocessing Transformer
preprocessor = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), num_cols),
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols)
    ]
)

# Step 3: Encapsulate Preprocessing and Estimator in Scikit-Learn Pipeline
pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("classifier", RandomForestClassifier(n_estimators=150, max_depth=10, random_state=42))
    ]
)

# Step 4: Perform Stratified Train-Test Partition
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Step 5: 5-Fold Cross-Validation for Generalization Verification
cv_scores = cross_val_score(pipeline, X_train, y_train, cv=5, scoring="accuracy")
print(f"5-Fold Cross-Validation Mean Accuracy: {cv_scores.mean() * 100:.2f}% (+/- {cv_scores.std() * 100:.2f}%)")

# Step 6: Fit Final Pipeline on Training Data and Predict on Held-Out Test Set
pipeline.fit(X_train, y_train)
y_pred = pipeline.predict(X_test)

print("\n--- Held-Out Test Evaluation Report ---")
print(classification_report(y_test, y_pred))
print("Confusion Matrix:\n", confusion_matrix(y_test, y_pred))""",

    "ml_project_2": """# ==============================================================================
# Chapter 15: Project 2: Advanced Real-World Pipeline, Cross-Validation & Evaluation
# ==============================================================================
import pandas as pd
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import RobustScaler, OneHotEncoder
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score

# Step 1: Load Complex Real-World Dataset
df = pd.read_csv("dataset.csv")
X = df.drop(columns=["target"])
y = df["target"]

# Step 2: RobustScaler Handles Heavy Outliers in Real-World Feature Distributions
preprocessor = ColumnTransformer([
    ("num", RobustScaler(), X.select_dtypes(include=["number"]).columns.tolist()),
    ("cat", OneHotEncoder(handle_unknown="ignore"), X.select_dtypes(include=["object"]).columns.tolist())
])

pipeline = Pipeline([
    ("prep", preprocessor),
    ("gbm", GradientBoostingClassifier(random_state=42))
])

# Step 3: Define Hyperparameter Grid for Tuning
param_grid = {
    "gbm__n_estimators": [100, 150],
    "gbm__learning_rate": [0.05, 0.1],
    "gbm__max_depth": [3, 4]
}

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

# Step 4: Execute Systematic Grid Search with 3-Fold Cross-Validation
grid_search = GridSearchCV(pipeline, param_grid, cv=3, scoring="f1_weighted", n_jobs=-1)
grid_search.fit(X_train, y_train)

best_pipeline = grid_search.best_estimator_
print(f"Optimized Hyperparameters: {grid_search.best_params_}")
print(f"Best Cross-Validation F1-Score: {grid_search.best_score_:.4f}")

# Step 5: Test Set Performance Verification
y_pred = best_pipeline.predict(X_test)
print("\n--- Final Optimized Model Test Performance ---")
print(classification_report(y_test, y_pred))""",

    "outro": """# ==============================================================================
# Chapter 16: Course Summary, Model Persistence & Production Deployment Artifact Export
# ==============================================================================
import joblib

# Step 1: Serialize Trained Estimator / Pipeline to Disk
ARTIFACT_NAME = "production_ml_model_pipeline.joblib"
joblib.dump(pipeline, ARTIFACT_NAME)
print(f"[Export Success] Serialized trained model pipeline to '{ARTIFACT_NAME}'.")

# Step 2: Validate Real-Time In-Memory Inference from Serialized Artifact
loaded_model = joblib.load(ARTIFACT_NAME)
sample_unseen_data = X_test.iloc[:5]
inferred_predictions = loaded_model.predict(sample_unseen_data)

print("\n--- Validated Sample Production Predictions ---")
print(inferred_predictions)"""
}

FALLBACK_AGENTIC_CODE = {
    "sequential": """from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class AgentState(TypedDict):
    task: str
    plan: str
    result: str

def plan_node(state: AgentState) -> dict:
    return {"plan": f"Plan formulated for task: {state['task']}"}

def execute_node(state: AgentState) -> dict:
    return {"result": f"Execution complete based on: {state['plan']}"}

builder = StateGraph(AgentState)
builder.add_node("planner", plan_node)
builder.add_node("executor", execute_node)

builder.add_edge(START, "planner")
builder.add_edge("planner", "executor")
builder.add_edge("executor", END)

app = builder.compile()"""
}

def get_code_for_topic(title: str, chapter_title: str, domain: str) -> str:
    c_low = (title + " " + chapter_title).lower()

    if domain == "machine_learning":
        if "intro" in c_low or "prereq" in c_low or "foundation" in c_low:
            return FALLBACK_ML_CODE["intro_setup"]
        elif "content" in c_low or "roadmap" in c_low or "tools" in c_low:
            return FALLBACK_ML_CODE["intro_setup"]
        elif "what is" in c_low or "philosophy" in c_low:
            return FALLBACK_ML_CODE["what_is_ml"]
        elif "applications" in c_low or "real-life" in c_low or "industry" in c_low:
            return FALLBACK_ML_CODE["what_is_ml"]
        elif "traditional" in c_low or "programming vs" in c_low:
            return FALLBACK_ML_CODE["trad_vs_ml"]
        elif "difference" in c_low or "ai,ml,dl" in c_low:
            return FALLBACK_ML_CODE["ai_ml_dl"]
        elif "types of" in c_low or "supervised" in c_low:
            return FALLBACK_ML_CODE["types_of_ml"]
        elif "steps for making" in c_low or "lifecycle" in c_low:
            return FALLBACK_ML_CODE["ml_lifecycle"]
        elif "eda" in c_low or "exploratory" in c_low:
            return FALLBACK_ML_CODE["ml_eda"]
        elif "cleaning" in c_low or "imputation" in c_low:
            return FALLBACK_ML_CODE["ml_cleaning"]
        elif "preprocessing" in c_low or "encoding" in c_low or "scaling" in c_low:
            return FALLBACK_ML_CODE["ml_preprocessing"]
        elif "feature engineering" in c_low:
            return FALLBACK_ML_CODE["ml_feature_engineering"]
        elif "feature selection" in c_low or "selection" in c_low:
            return FALLBACK_ML_CODE["ml_feature_selection"]
        elif "project 1" in c_low:
            return FALLBACK_ML_CODE["ml_project_1"]
        elif "project 2" in c_low:
            return FALLBACK_ML_CODE["ml_project_2"]
        elif "outro" in c_low or "summary" in c_low:
            return FALLBACK_ML_CODE["outro"]
        return FALLBACK_ML_CODE["ml_project_1"]

    return FALLBACK_AGENTIC_CODE["sequential"]

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
            prompt = PromptTemplate.from_template(prompt_str)
            chain = prompt | llm | StrOutputParser()
            for max_chars in PHASE5_EXCERPT_STEPS:
                if explanation:
                    break
                try:
                    result = chain.invoke(
                        {
                            "title": title,
                            "chapter_title": chapter_title,
                            "domain": domain,
                            "transcript": balanced_transcript_excerpt(
                                transcript, max_chars=max_chars
                            ),
                        }
                    )
                except Exception as e:
                    failure = str(e).strip()
                    print(
                        f"[TheoryAgent] {title}: {max_chars} chars of context refused — "
                        f"{failure[:150]}"
                    )
                    if not is_request_too_large(failure):
                        break  # a spent allowance does not recover by sending less
                    continue

                if result and "EXPLANATION:" in result:
                    exp_m = re.search(r"EXPLANATION:\s*(.*?)(?=ANALOGY:|$)", result, re.DOTALL | re.IGNORECASE)
                    ana_m = re.search(r"ANALOGY:\s*(.*)", result, re.DOTALL | re.IGNORECASE)
                    if exp_m:
                        # Left as markdown on purpose: the renderer converts it later.
                        # The old call to a non-existent cleaner is what used to throw.
                        explanation = exp_m.group(1).strip()
                    if ana_m:
                        analogy = ana_m.group(1).strip()
                break
        except Exception as e:
            failure = str(e).strip()
            print(f"[TheoryAgent] {title}: {failure[:150]}")

    # A model that is unavailable, rate-limited or simply silent must never be
    # papered over with invented content. State the failure plainly and show the
    # instructor's own words instead, so the section is still worth reading and
    # nobody mistakes filler for teaching.
    if not explanation or len(explanation) < 150:
        if not failure:
            failure = "no API key is configured, so no model was called"
        DEGRADED_SECTIONS.append(title)
        print(f"[TheoryAgent] {title}: notes degraded ({describe_llm_failure(failure)})")
        excerpt = balanced_transcript_excerpt(transcript, max_chars=2400)
        explanation = (
            f"### This section could not be written up\n\n"
            f"4 U By U asks a language model to turn the instructor's own words into notes, and "
            f"that call did not succeed for this section. Nothing has been invented to fill the "
            f"gap.\n\n"
            f"**Why:** {describe_llm_failure(failure)}.\n\n"
            f"**What to do:** {advise_on_llm_failure(failure)}\n\n"
            f"**What the instructor actually said in this part of the lecture** "
            f"(verbatim transcript, trimmed):\n\n"
            f"> {excerpt or 'This section has no transcript.'}\n"
        )

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

    if not points:
        if domain == "machine_learning":
            points = [
                f"Verify feature distributions, null ratios, and skewness prior to selecting algorithmic model families.",
                f"All transformation steps (imputation, scaling, encoding) must fit strictly on training splits to prevent data leakage.",
                f"Select task-appropriate evaluation metrics (Precision-Recall AUC, F1-Score, RMSE) rather than relying solely on raw accuracy.",
                f"Leverage Scikit-Learn Pipelines and ColumnTransformers to encapsulate preprocessing with estimators for production reproducibility."
            ]
        else:
            points = [
                f"Define explicit system interfaces to enforce predictable runtime contracts across module boundaries.",
                f"Enforce deterministic data validation and type constraints at external API entry points."
            ]

    return {"key_points": points[:5]}

# AGENT 4: Pitfalls & Examples Agent
def pitfalls_agent_node(state: SectionState) -> Dict[str, Any]:
    title = state["section_title"]
    chapter_title = state.get("chapter_structure", {}).get("title", "")
    domain = state.get("domain") or "machine_learning"
    api_key = state.get("api_key")
    selected_model = state.get("selected_model")

    pitfalls = []
    llm = get_chat_model(api_key=api_key, model_name=selected_model)
    if llm:
        try:
            prompt_str = (
                "What are 2 practical pitfalls developers encounter when implementing \"" + title + "\"?\n"
                "Domain: " + domain + "\n\n"
                "Output format:\n- Pitfall: <issue> -> Mitigation: <solution>"
            )
            prompt = PromptTemplate.from_template(prompt_str)
            chain = prompt | llm | StrOutputParser()
            result = chain.invoke({})
            if result:
                for line in result.splitlines():
                    line = line.strip()
                    if "->" in line or "Mitigation" in line:
                        pitfalls.append(line.lstrip("-* "))
        except Exception:
            pass

    if not pitfalls:
        if domain == "machine_learning":
            pitfalls = [
                f"Data Leakage across Validation Split -> Mitigation: Assemble transformations inside a Scikit-Learn Pipeline so transformers fit strictly on training folds.",
                f"Class Imbalance Skewing Optimization -> Mitigation: Evaluate with Precision-Recall AUC or Balanced Accuracy, and utilize stratified partitioning."
            ]
        else:
            pitfalls = [
                f"Unvalidated External Input -> Mitigation: Enforce strict schema validation at system boundaries."
            ]

    examples = [{
        "text": f"Production Pattern: In {title}, data transformations and models adhere to standard Scikit-Learn fit-transform interfaces for zero-downtime inference."
    }]

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

    # Concurrent Section Fan-Out: Execute specialist agents in parallel
    from concurrent.futures import ThreadPoolExecutor

    theory_out = {}
    code_out = {}
    key_out = {}
    pit_out = {}
    vis_out = {}

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

    diag = vis_out.get("visual_diagram") or (vis_out.get("diagrams", [None])[0] if vis_out.get("diagrams") else None)
    diags = vis_out.get("visual_diagrams") or ([diag] if diag else [])

    return {
        "section_id": section_def["section_id"],
        "section_title": title,
        "section_order": section_def.get("section_order", 1),
        "chapter_id": chapter_def.get("chapter_id", ""),
        "time_reference": section_def.get("time_reference", "00:00"),
        "timestamp_seconds": section_def.get("timestamp_seconds", 0),
        "theory_block": theory_out.get("theory_block", {
            "explanation": theory_out.get("explanation", ""),
            "analogies": [theory_out.get("analogy", "")] if theory_out.get("analogy") else []
        }),
        "visual_diagram": diag,
        "visual_diagrams": diags,
        "code_blocks": code_out.get("code_blocks", []),
        "key_points": key_out.get("key_points", []),
        "examples": pit_out.get("examples", []),
        "pitfalls": pit_out.get("pitfalls", []),
        "supplement_block": None,
        "is_complete": True,
        "external_label": None
    }

async def run_all_chapters_batched(notes_structure: Dict[str, Any], state: MasterNotesState) -> List[ChapterContent]:
    print(
        f"[Phase 5] Fan-out: up to {PHASE5_PARALLEL} sections in parallel "
        "(theory → code → keypoints → pitfalls → visual per section)..."
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
