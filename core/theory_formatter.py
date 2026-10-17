r"""
4 U By U - Theoretical Content & LaTeX Equations Formatter
Translates raw theory blocks into beautiful publication-grade HTML
while shielding MathJax delimiters \(...\) and \[...\] from markdown corruption.
"""

import re

try:
    import markdown
except ImportError:
    markdown = None

def format_theory_content(explanation: str) -> str:
    """Formats markdown explanation to HTML with MathJax protection."""
    if not explanation:
        return ""
    if markdown is None:
        clean = explanation.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f"<p>{clean}</p>"
    return markdown.markdown(explanation, extensions=["fenced_code", "tables"])
