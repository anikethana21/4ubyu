"""
4 U By U - Core Code Cleaning & Temporal Reconciliation Agent
Extracts fragmented code clusters from lecture audio, cross-references
GitHub repositories and video description assets, and produces clean,
extensively annotated, production-grade executable scripts.
"""

import re
import ast
from typing import Dict, List, Any, Optional
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.language_models.chat_models import BaseChatModel

def extract_code_tokens_from_transcript(transcript: str) -> List[str]:
    """Identifies spoken and implied coding tokens in lecture transcript slices."""
    if not transcript:
        return []
    
    found_tokens = []
    patterns = [
        r"\b(pandas|numpy|scikit-learn|sklearn|seaborn|matplotlib|scipy)\b",
        r"\b(read_csv|info|describe|isnull|dropna|fillna|drop_duplicates)\b",
        r"\b(SimpleImputer|KNNImputer|StandardScaler|RobustScaler|MinMaxScaler)\b",
        r"\b(OneHotEncoder|OrdinalEncoder|LabelEncoder|ColumnTransformer)\b",
        r"\b(train_test_split|cross_val_score|GridSearchCV|RandomizedSearchCV)\b",
        r"\b(LinearRegression|LogisticRegression|RandomForestClassifier|GradientBoostingClassifier|DecisionTreeClassifier|KMeans)\b",
        r"\b(Pipeline|make_pipeline|classification_report|confusion_matrix|mean_squared_error|r2_score)\b"
    ]
    for pat in patterns:
        matches = re.findall(pat, transcript, re.IGNORECASE)
        found_tokens.extend(matches)
    return list(dict.fromkeys(found_tokens))

def find_best_matching_repo_file(
    chapter_title: str,
    github_files: Dict[str, str]
) -> Optional[tuple[str, str]]:
    """Scans procured GitHub files for the file most relevant to this chapter."""
    if not github_files:
        return None
        
    c_lower = chapter_title.lower()
    best_file = None
    best_score = 0
    
    for filename, code in github_files.items():
        f_lower = filename.lower()
        score = 0
        if any(k in f_lower and k in c_lower for k in ["eda", "clean", "preproc", "feature", "model", "project", "train", "eval"]):
            score += 5
        for word in re.findall(r"\w+", c_lower):
            if len(word) > 3 and word in f_lower:
                score += 2
        if score > best_score:
            best_score = score
            best_file = (filename, code)
            
    return best_file

def clean_and_annotate_code(
    raw_code: str,
    chapter_title: str,
    domain: str = "machine_learning"
) -> str:
    """Post-processes and cleans code with clear formatting and annotations."""
    if not raw_code:
        return ""
        
    code_match = re.search(r"```(?:python)?\s*\n?(.*?)```", raw_code, re.DOTALL | re.IGNORECASE)
    if code_match:
        raw_code = code_match.group(1).strip()
        
    lines = raw_code.splitlines()
    cleaned_lines = [line.rstrip() for line in lines]
    return "\n".join(cleaned_lines).strip()

def run_code_cleaning_agent(
    chapter_title: str,
    transcript: str,
    domain: str,
    github_files: Dict[str, str],
    llm: Optional[BaseChatModel] = None,
    procured_code: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main Code Cleaning Agent:
    1. Gathers all fragmented code cues from chapter transcript cluster.
    2. Cross-references GitHub repository code and description assets.
    3. Merges, cleans, comments, and annotates runnable production code.
    """
    repo_match = find_best_matching_repo_file(chapter_title, github_files)
    repo_code = procured_code or (repo_match[1] if repo_match else "")
    repo_filename = repo_match[0] if repo_match else f"{re.sub(r'[^a-zA-Z0-9_]+', '_', chapter_title.lower())}.py"

    tokens = extract_code_tokens_from_transcript(transcript)
    
    if llm:
        try:
            prompt_str = (
                "You are an Expert Lead Python Engineer and Code Cleaning Specialist.\n"
                "Task: Synthesize, clean, and annotate the complete production-grade Python code for this lecture chapter.\n\n"
                "Chapter: \"" + chapter_title + "\"\n"
                "Subject Domain: " + domain + "\n"
                "Key Coding Tokens Mentioned: " + (", ".join(tokens) if tokens else "standard library workflows") + "\n\n"
                "Available Repository Reference Code (if any):\n"
                "---\n" + (repo_code[:3000] if repo_code else "No external repo snippet available") + "\n---\n\n"
                "Spoken Lecture Context:\n"
                "---\n{transcript}\n---\n\n"
                "INSTRUCTIONS:\n"
                "1. ONLY output code if the instructor actually demonstrates or discusses implementation in the transcript.\n"
                "2. If the segment is conceptual (definitions, comparisons, roadmap) with no coding, output an empty ```python ``` block.\n"
                "3. Use repository reference ONLY for lines/symbols explicitly aligned with this chapter — do NOT paste unrelated modules.\n"
                "4. Prefer faithful reconstruction from the lecture over inventing a full project script.\n"
                "5. Add step headers (# Step 1: ...) and concise inline annotations for non-obvious parameters.\n"
                "6. Include necessary imports at the top.\n"
                "7. Output strictly Python inside a ```python ``` block (empty block if no code belongs here)."
            )
            prompt = PromptTemplate.from_template(prompt_str)
            chain = prompt | llm | StrOutputParser()
            result = chain.invoke({
                "transcript": transcript[:3000] if transcript else ""
            })
            
            cleaned_code = clean_and_annotate_code(result, chapter_title, domain)
            if cleaned_code and len(cleaned_code) > 100:
                return {
                    "code": cleaned_code,
                    "filename": repo_filename,
                    "source": "Synthesized & Cleaned from Lecture Audio + Repo Assets",
                    "tokens_used": tokens
                }
        except Exception as e:
            print(f"[CodeCleaningAgent] LLM cleaning notice for {chapter_title}: {e}")

    if procured_code and repo_code and len(repo_code.strip()) > 100 and tokens:
        return {
            "code": clean_and_annotate_code(repo_code, chapter_title, domain),
            "filename": repo_filename,
            "source": f"Grounded Repository Excerpt ({repo_filename})",
            "tokens_used": tokens,
        }

    return {
        "code": "",
        "filename": repo_filename,
        "source": "No lecture-grounded code",
        "tokens_used": tokens,
    }
