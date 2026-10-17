"""Helpers to preserve beginning/middle/end of long lecture slices for LLM agents."""


def balanced_transcript_excerpt(transcript: str, max_chars: int = 14000) -> str:
    """
    Returns a representative excerpt for long chapters instead of truncating only the start.
    """
    text = (transcript or "").strip()
    if len(text) <= max_chars:
        return text

    part = max_chars // 3
    mid_start = max(0, (len(text) // 2) - (part // 2))
    mid_end = min(len(text), mid_start + part)
    return (
        text[:part]
        + "\n\n--- [mid-lecture excerpt] ---\n\n"
        + text[mid_start:mid_end]
        + "\n\n--- [late-lecture excerpt] ---\n\n"
        + text[-part:]
    )
