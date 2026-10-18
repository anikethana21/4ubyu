"""Reading a list a model numbered for us.

Batching is what keeps a run inside a free provider quota — one request that asks
for six chapter titles instead of six requests — but a batched answer can only be
read safely if the numbers are respected. Numbering means a missing or reordered
line costs its own title instead of shifting every later title onto the wrong
chapter.

The parse is deliberately forgiving about decoration. Models write `**3. Title**`
and `### 3) Title` as readily as `3. Title`, and treating those as unparsable
throws away an answer that has already been paid for.
"""

import re
from typing import Dict

# Optional lead-in decoration, then the number, then its separator.
NUMBERED_LINE = re.compile(
    r"^\s*(?:[>#*\-]\s*)*\**\s*(\d{1,3})\s*[.):\-]\s*\**\s*(.+?)\s*\**\s*$"
)


def numbered_items(text: str) -> Dict[int, str]:
    """Map each number a model wrote to the text under it.

    The first answer for a number wins, so a model that repeats itself cannot
    overwrite a good title with a worse one.
    """
    items: Dict[int, str] = {}
    for line in (text or "").splitlines():
        match = NUMBERED_LINE.match(line)
        if not match:
            continue
        number = int(match.group(1))
        value = match.group(2).strip()
        if value and number not in items:
            items[number] = value
    return items
