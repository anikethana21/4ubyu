"""Reading a provider's refusal correctly, and never inventing content to cover it.

Free tiers meter tokens per minute, and a long lecture can exceed that allowance
with a single request. Providers report the two cases differently but overlap:
a request that is simply too big and one that arrives after the allowance is
spent both come back tagged `rate_limit_exceeded`. They need opposite responses —
one must send less, the other must wait — so the size check is tested first and
the two are kept mutually exclusive.

Everything here is shared by the chapter agents and the section composer so that
a failure is described the same way wherever it happens, and so that a caller
which cannot produce notes says so plainly instead of substituting prose that
merely reads like notes.
"""

import re
from typing import Any, Callable, Dict, Optional, Tuple

EXCERPT_STEPS = (6000, 3000, 1500)

# How much of the lecture a degraded section quotes back to the reader.
NOTICE_EXCERPT_CHARS = 2400


def is_request_too_large(message: str) -> bool:
    """True when the provider refused because one request exceeded its meter."""
    return "413" in message or "Request too large" in message


def is_daily_limit(message: str) -> bool:
    """True when the day's allowance is spent rather than the minute's.

    The two are reported the same way (`429`, `rate_limit_exceeded`) but need
    opposite advice: a per-minute allowance refills while you wait, a daily one
    does not, and "wait a minute and try again" wastes the reader's evening.
    """
    lowered = (message or "").lower()
    return "tokens per day" in lowered or "tpd" in lowered or "per day" in lowered


def is_rate_limit(message: str) -> bool:
    """True when this minute's allowance is spent.

    Kept exclusive of `is_request_too_large` and `is_daily_limit`: all three are
    reported as `rate_limit_exceeded`, but one must send less, one must wait a
    minute, and one must wait for the day to reset, so the size check and the
    daily check take precedence.
    """
    if is_request_too_large(message) or is_daily_limit(message):
        return False
    return "429" in message or "rate_limit_exceeded" in message or "TPM Rate Limit" in message


def describe_llm_failure(message: str) -> str:
    """A short, human reason for a failed call, with the provider's payload stripped out."""
    if is_request_too_large(message):
        return "the request asked for more tokens in one minute than the provider allows"
    if is_daily_limit(message):
        return "the provider's daily token allowance for this model is spent"
    if is_rate_limit(message):
        return (
            "the provider's per-minute token allowance was already spent when this "
            "request was made"
        )
    if "401" in message or "invalid_api_key" in message:
        return "the provider rejected the API key"
    if not message:
        return "the provider returned nothing usable"
    return re.sub(r"\s+", " ", message).strip()[:200] or "the provider gave no reason"


def advise_on_llm_failure(message: str) -> str:
    """What the reader can actually do about a failed call."""
    if is_request_too_large(message):
        return (
            "This is a provider quota, not a problem with your notes. Pick fewer chapters at "
            "once, or move to a provider plan with a larger tokens-per-minute allowance."
        )
    if is_daily_limit(message):
        return (
            "This is a provider quota, not a problem with your notes. The daily allowance "
            "resets tomorrow; until then, use a different model or provider, or generate "
            "fewer chapters at a time. Retrying in a minute will not help."
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


def degraded_section_notice(failure: str, transcript: str) -> str:
    """The note a reader gets when a section could not be written.

    It states the failure, names the cause, says what to do, and then shows the
    instructor's own words for that part of the lecture. Nothing is invented, so
    the reader can still study the section and can tell that the summary is
    missing rather than wrong.

    The cause is whatever the caller recorded. This used to substitute "no model
    was available" whenever the failure text was empty — a cause nothing had
    checked, printed under a heading that promises the reason. An empty failure
    now reads as an empty failure.
    """
    from core.transcript_coverage import balanced_transcript_excerpt

    excerpt = balanced_transcript_excerpt(transcript, max_chars=NOTICE_EXCERPT_CHARS)
    return (
        "### This section could not be written up\n\n"
        "4 U By U asks a language model to turn the instructor's own words into notes, and that "
        "call did not succeed for this section. Nothing has been invented to fill the gap.\n\n"
        f"**Why:** {describe_llm_failure(failure)}.\n\n"
        f"**What to do:** {advise_on_llm_failure(failure)}\n\n"
        "**What the instructor actually said in this part of the lecture** "
        "(verbatim transcript, trimmed):\n\n"
        f"> {excerpt or 'This section has no transcript.'}\n"
    )


def describe_exception(exc: BaseException) -> str:
    """What an exception says, or its type when it says nothing.

    Some client errors carry no message at all, and an empty failure string used
    to be filled in downstream with a cause nobody had checked. The exception's
    own name is at least true.
    """
    text = str(exc).strip()
    return text or f"{type(exc).__name__} with no message"


def invoke_reading_transcript(
    llm: Any,
    prompt_text: str,
    variables: Dict[str, Any],
    transcript: str,
    steps: Tuple[int, ...] = EXCERPT_STEPS,
    on_attempt: Optional[Callable[[int, str], None]] = None,
) -> Tuple[str, str]:
    """Run a prompt over a transcript excerpt, sending less when told to.

    Returns `(answer, failure)`. A `413` means the request was larger than the
    provider's whole per-minute allowance, so the excerpt shrinks and the attempt
    is repeated; a `429` means the allowance is spent, and sending less cannot
    help, so the caller is told instead of being made to wait.
    """
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import PromptTemplate

    from core.transcript_coverage import balanced_transcript_excerpt

    prompt = PromptTemplate.from_template(prompt_text)
    chain = prompt | llm | StrOutputParser()

    failure = ""
    for max_chars in steps:
        try:
            answer = chain.invoke(
                {
                    **variables,
                    "transcript": balanced_transcript_excerpt(transcript, max_chars=max_chars),
                }
            )
        except Exception as exc:
            failure = describe_exception(exc)
            if on_attempt:
                on_attempt(max_chars, failure)
            if not is_request_too_large(failure):
                break
            continue
        if answer and answer.strip():
            return answer, ""
        # The call succeeded and returned nothing usable. That is a different
        # situation from a refusal, and it says so rather than leaving the reason
        # blank for a caller to guess at.
        failure = failure or "the model returned an empty answer"
        break
    return "", failure
