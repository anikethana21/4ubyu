"""
4 U By U — Transcript Normalization (non-Latin → English)

YouTube publishes auto-captions in the *spoken* language. For Hinglish, Hindi
and other non-Latin lectures it therefore hands back Devanagari (or CJK, Arabic,
Cyrillic …) text.

This module detects the script of a transcript. Translation into English is
available but **off by default**, because it costs one model call every few
thousand characters and the models that write the notes read the source language
directly — so the cheaper order of work is to pay for notes rather than for a
translation nobody reads. Set ``TRANSLATE_TRANSCRIPT=1`` to translate instead,
segment by segment, so every timestamp is preserved. Either way it runs through
the same BYOK model router as the rest of the pipeline.

Failure policy: never lose data. If a batch cannot be translated it is kept
verbatim, and if translation fails entirely the original transcript is returned
unchanged (i.e. the pipeline degrades to its previous behaviour, never worse).
"""

from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple


def translation_enabled() -> bool:
    """Whether a non-Latin transcript is machine-translated before analysis.

    Off by default. Translating segment by segment costs one model call every few
    thousand characters — dozens of calls for a single lecture, and the largest
    single expense of a run — while the models that write the notes read the
    source language directly. Paying for notes rather than for a translation
    nobody reads is the cheaper order of work. Set ``TRANSLATE_TRANSCRIPT=1`` to
    restore the old behaviour.
    """
    return os.environ.get("TRANSLATE_TRANSCRIPT", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

# Unicode block ranges for the scripts YouTube realistically emits.
_SCRIPT_RANGES = {
    "devanagari": (0x0900, 0x097F),
    "bengali": (0x0980, 0x09FF),
    "gurmukhi": (0x0A00, 0x0A7F),
    "gujarati": (0x0A80, 0x0AFF),
    "oriya": (0x0B00, 0x0B7F),
    "tamil": (0x0B80, 0x0BFF),
    "telugu": (0x0C00, 0x0C7F),
    "kannada": (0x0C80, 0x0CFF),
    "malayalam": (0x0D00, 0x0D7F),
    "sinhala": (0x0D80, 0x0DFF),
    "thai": (0x0E00, 0x0E7F),
    "arabic": (0x0600, 0x06FF),
    "hebrew": (0x0590, 0x05FF),
    "cyrillic": (0x0400, 0x04FF),
    "greek": (0x0370, 0x03FF),
    "han": (0x4E00, 0x9FFF),
    "hiragana": (0x3040, 0x309F),
    "katakana": (0x30A0, 0x30FF),
    "hangul": (0xAC00, 0xD7AF),
}

_LANGUAGE_LABEL = {
    "devanagari": "Hindi / Hinglish",
    "bengali": "Bengali",
    "gurmukhi": "Punjabi",
    "gujarati": "Gujarati",
    "oriya": "Odia",
    "tamil": "Tamil",
    "telugu": "Telugu",
    "kannada": "Kannada",
    "malayalam": "Malayalam",
    "sinhala": "Sinhala",
    "thai": "Thai",
    "arabic": "Arabic",
    "hebrew": "Hebrew",
    "cyrillic": "a Cyrillic-script language",
    "greek": "Greek",
    "han": "Chinese",
    "hiragana": "Japanese",
    "katakana": "Japanese",
    "hangul": "Korean",
}


def _script_of(ch: str) -> Optional[str]:
    cp = ord(ch)
    for name, (lo, hi) in _SCRIPT_RANGES.items():
        if lo <= cp <= hi:
            return name
    return None


def detect_script(text: str, sample: int = 20000) -> str:
    """
    Returns the dominant non-Latin script name, or "latin" when the text is
    (mostly) Latin. A script must account for >=15% of letters to win, so an
    English transcript quoting a few foreign words stays "latin".
    """
    if not text:
        return "latin"
    counts: Dict[str, int] = {}
    letters = 0
    for ch in text[:sample]:
        if ch.isalpha():
            letters += 1
            s = _script_of(ch)
            if s:
                counts[s] = counts.get(s, 0) + 1
    if not letters or not counts:
        return "latin"
    name, n = max(counts.items(), key=lambda kv: kv[1])
    return name if (n / letters) >= 0.15 else "latin"


def needs_translation(text: str) -> bool:
    """True when the transcript is predominantly non-Latin and needs English."""
    return detect_script(text) != "latin"


def _batch_segments(
    segments: List[Dict[str, Any]],
    max_chars: int = 4500,
    max_lines: int = 120,
) -> List[List[Dict[str, Any]]]:
    """Groups consecutive segments into translation batches under a size cap."""
    batches: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    current_chars = 0
    for seg in segments:
        length = len(str(seg.get("text", "")))
        if current and (current_chars + length > max_chars or len(current) >= max_lines):
            batches.append(current)
            current, current_chars = [], 0
        current.append(seg)
        current_chars += length
    if current:
        batches.append(current)
    return batches


_NUMBERED_LINE = re.compile(r"^\s*(\d+)\s*[|:).\-]\s*(.*)$")


def _parse_numbered(output: str, expected: int) -> Dict[int, str]:
    """
    Parses `N | text` lines. If the model dropped the numbers but returned the
    right number of lines, they are mapped positionally.
    """
    mapping: Dict[int, str] = {}
    plain: List[str] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        m = _NUMBERED_LINE.match(stripped)
        if m:
            mapping[int(m.group(1))] = m.group(2).strip()
        else:
            plain.append(stripped)
    if not mapping and len(plain) == expected:
        mapping = {i + 1: t for i, t in enumerate(plain)}
    return mapping


_SYSTEM_PROMPT = (
    "You are a precise subtitle translator. You translate spoken transcripts "
    "into clear, natural English while preserving meaning, names, numbers and "
    "technical terminology. You never summarise, never add commentary, and "
    "never change the number of lines."
)


def _translate_batch(
    batch: List[Dict[str, Any]],
    model: Any,
) -> Dict[int, str]:
    from langchain_core.messages import HumanMessage, SystemMessage

    lines = "\n".join(
        f"{i + 1} | {str(seg.get('text', '')).strip()}" for i, seg in enumerate(batch)
    )
    prompt = (
        f"Translate the {len(batch)} transcript lines below into clear, natural English.\n\n"
        "Rules:\n"
        f"- Output EXACTLY {len(batch)} lines, one per input line.\n"
        "- Prefix every line with its original number and a pipe, e.g. `3 | translated text`.\n"
        "- Never merge, split, reorder, add or remove lines.\n"
        "- Keep technical terms, product names and numbers accurate.\n"
        "- If a line is already English, repeat it unchanged.\n"
        "- Do not add explanations, headings or markdown.\n\n"
        f"Transcript:\n{lines}"
    )
    result = model.invoke(
        [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=prompt)]
    )
    text = getattr(result, "content", None) or str(result)
    return _parse_numbered(text, len(batch))


def translate_segments(
    segments: List[Dict[str, Any]],
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    batch_chars: int = 4500,
    max_workers: int = 4,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Translates segment *text* into English, preserving start/duration/end.

    Returns (segments, translated_any). Batches run concurrently; order is
    preserved. A batch that fails is kept in the original language.
    """
    if not segments:
        return segments, False

    from core.model_router import get_chat_model

    model = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.0)
    batches = _batch_segments(segments, max_chars=batch_chars)

    def run(batch: List[Dict[str, Any]]) -> Optional[Dict[int, str]]:
        try:
            mapping = _translate_batch(batch, model)
        except Exception as e:
            print(f"[Normalizer] Batch translation notice: {e}")
            return None
        # Require most lines to come back or the batch is considered unreliable.
        if len(mapping) >= max(1, int(len(batch) * 0.6)):
            return mapping
        return None

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        results = list(pool.map(run, batches))

    out: List[Dict[str, Any]] = []
    translated_any = False
    for batch, mapping in zip(batches, results):
        if not mapping:
            out.extend(dict(seg) for seg in batch)
            continue
        for i, seg in enumerate(batch, start=1):
            new = dict(seg)
            translation = (mapping.get(i) or "").strip()
            if translation:
                new["text"] = translation
                new["original_text"] = seg.get("text", "")
                translated_any = True
            out.append(new)
    return out, translated_any


def normalize_transcript(
    full_text: str,
    timed_segments: List[Dict[str, Any]],
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
    """
    Detects a non-Latin transcript and translates it to English.

    Returns (full_text, timed_segments, info) where info describes what happened
    so the UI can tell the user the transcript was machine-translated.
    """
    info: Dict[str, Any] = {
        "detected_script": "latin",
        "translated": False,
        "note": "",
    }

    probe_text = full_text or " ".join(
        str(s.get("text", "")) for s in (timed_segments or [])
    )
    script = detect_script(probe_text)
    info["detected_script"] = script

    if script == "latin":
        return full_text, timed_segments, info

    label = _LANGUAGE_LABEL.get(script, "a non-Latin language")

    if not translation_enabled():
        info["note"] = (
            f"Transcript is in {label}. Notes are written from it directly, without a "
            "separate translation pass, to keep a run inside a free provider quota."
        )
        return full_text, timed_segments, info

    print(f"[Normalizer] Detected {label} ({script}) transcript — translating to English.")

    try:
        if timed_segments:
            new_segments, translated = translate_segments(
                timed_segments, api_key=api_key, model_name=model_name
            )
            if translated:
                new_full = " ".join(
                    str(s.get("text", "")) for s in new_segments
                ).strip()
                info.update({
                    "translated": True,
                    "source_language": label,
                    "note": (
                        f"Transcript was in {label} and was automatically "
                        f"translated to English before chapter detection."
                    ),
                })
                return new_full, new_segments, info
        else:
            # No timed segments: translate the plain text in one pass.
            from langchain_core.messages import HumanMessage, SystemMessage
            from core.model_router import get_chat_model

            model = get_chat_model(api_key=api_key, model_name=model_name, temperature=0.0)
            result = model.invoke([
                SystemMessage(content=_SYSTEM_PROMPT),
                HumanMessage(content=(
                    f"Translate this {label} transcript into clear, natural English. "
                    "Output only the translation.\n\n" + full_text[:24000]
                )),
            ])
            translated_text = (getattr(result, "content", None) or "").strip()
            if translated_text:
                info.update({
                    "translated": True,
                    "source_language": label,
                    "note": (
                        f"Transcript was in {label} and was automatically "
                        f"translated to English (no timestamps available)."
                    ),
                })
                return translated_text, timed_segments, info
    except Exception as e:
        print(f"[Normalizer] Translation failed, keeping original transcript: {e}")
        info["error"] = str(e)[:200]

    return full_text, timed_segments, info
