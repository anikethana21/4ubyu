"""
Core Theory & Markdown Formatter for 4 U By U Workspace
Converts markdown and LaTeX mathematical equations into rich, publication-grade HTML
while stripping forced code snippets and raw artifacts.
"""
import re
import markdown

def clean_theory_markdown(text: str) -> str:
    if not text:
        return ""
    
    # 1. Strip accidental leading raw asterisks or markdown syntax artifacts
    text = re.sub(r'^\s*(\*{2,}|\#{1,6})\s*', '', text).strip()
    
    # 2. Strip accidental code blocks from theory explanation
    text = re.sub(r'```(?:python|py|bash|sh|json)?[\s\S]*?```', '', text, flags=re.DOTALL).strip()
    
    # 3. Strip trailing forced pipeline intro sentences (e.g. 'A practical Python pipeline...')
    text = re.sub(r'(?:A practical|Here is a|A simple)\s+(?:Python|code)\s+pipeline.*?$', '', text, flags=re.IGNORECASE | re.DOTALL).strip()
    
    return text

def format_theory_content(text: str) -> str:
    text = clean_theory_markdown(text)
    if not text:
        return ""

    math_store = {}

    def save_display(m):
        t = f"MATHBLOCK{len(math_store)}XYZ"
        math_store[t] = m.group(0).strip()
        return f"\n\n{t}\n\n"

    def save_inline(m):
        t = f"MATHINLINE{len(math_store)}XYZ"
        math_store[t] = m.group(0).strip()
        return t

    # Protect display math \[ ... \] and $$ ... $$
    text = re.sub(r'\\\[[\s\S]*?\\\]', save_display, text)
    text = re.sub(r'\$\$[\s\S]*?\$\$', save_display, text)
    # Protect inline math \( ... \)
    text = re.sub(r'\\\([\s\S]*?\\\)', save_inline, text)

    # Render Markdown to semantic HTML
    html = markdown.markdown(text, extensions=['fenced_code', 'tables'])

    # Restore Math equations
    for t, orig in math_store.items():
        if "BLOCK" in t:
            wrapped = f'<div class="math-display-card">{orig}</div>'
            html = html.replace(t, wrapped)
        else:
            html = html.replace(t, orig)

    return html
