"""
Encodes a browser cookies.txt (Netscape format) into the single-line base64
value expected by the YT_COOKIES_B64 environment variable.

Usage:
    python scripts/cookies_to_b64.py path/to/cookies.txt
    python scripts/cookies_to_b64.py            # looks for ./cookies.txt

Export cookies.txt from a session that is signed in to youtube.com first —
e.g. with the "Get cookies.txt LOCALLY" browser extension.
"""

import base64
import pathlib
import sys


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "cookies.txt")
    if not path.exists():
        print(f"File not found: {path}")
        print(
            "Export cookies.txt from a signed-in youtube.com session first\n"
            "(e.g. the 'Get cookies.txt LOCALLY' browser extension), then pass\n"
            "its path as the first argument."
        )
        return 1

    b64 = base64.b64encode(path.read_bytes()).decode()
    print("\nPaste the following as the YT_COOKIES_B64 environment variable:\n")
    print(b64)

    out = path.with_suffix(".b64.txt")
    out.write_text(b64, encoding="utf-8")
    print(f"\n(also saved to {out})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
