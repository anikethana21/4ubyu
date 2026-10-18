"""
4 U By U — Resilient YouTube Fetcher (serverless / datacenter hardened).

YouTube aggressively gates *player* requests coming from datacenter IP ranges
(Vercel, AWS Lambda, etc.): the full /watch HTML page is replaced with a
bot-check page and the /api/timedtext transcript endpoint returns 429s. The
lightweight oEmbed endpoint usually keeps working, which is why the deployed
app could show a title but a "00:00 / 0 topics" body.

This module tries several independent, lightweight strategies so ingestion
degrades gracefully instead of silently returning empty data:

Metadata (duration / title / description):
  1. InnerTube player API (multiple clients) — often returns
     `videoDetails.lengthSeconds` even when the watch page is bot-gated.
  2. /embed/ player page HTML.
  3. oEmbed (title / channel / thumbnail only).

Transcript:
  1. InnerTube caption tracks (when the video is playable for any client).
  2. yt-dlp subtitle download (last resort; disabled if unavailable).

Escaping datacenter IP blocks (Render, Vercel, AWS, GCP ...):
  1. YOUTUBE_API_KEY — official Data API v3. Free and never IP-blocked, but it
     provides *metadata only* (title / channel / duration / description). It
     cannot return transcript text.
  2. YT_COOKIES / YT_COOKIES_B64 — a Netscape cookies.txt exported from a
     signed-in browser. Given to yt-dlp this lets it authenticate, which
     bypasses "Sign in to confirm you're not a bot" for *both* metadata and
     subtitles. YT_COOKIES_B64 accepts the base64 of the file (env-var safe).
  3. YT_PROXY_URL — route every request through a residential proxy
     (e.g. http://user:pass@host:port). The most reliable cure; standard
     HTTPS_PROXY / HTTP_PROXY env vars are also honored by urllib.

NOTE: a *cloud* host is not a fix by itself — Render/AWS/GCP datacenter IPs are
gated by YouTube exactly like Vercel's. Only a residential IP, proxy, cookies,
or the official Data API escape the bot check.
"""

from __future__ import annotations

import gzip
import io
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
_INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?key=" + _INNERTUBE_KEY + "&prettyPrint=false"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Client descriptors passed to InnerTube. Order matters: the first client that
# returns usable `videoDetails` wins. WEB reliably returns lengthSeconds even
# when the player is unplayable, so it doubles as a metadata source.
_INNERTUBE_CLIENTS: List[Tuple[str, Dict[str, Any], Dict[str, str]]] = [
    (
        "WEB",
        {"clientName": "WEB", "clientVersion": "2.20240726.00.00", "hl": "en", "gl": "US"},
        {"User-Agent": _UA, "Content-Type": "application/json"},
    ),
    (
        "WEB_EMBEDDED_PLAYER",
        {
            "clientName": "WEB_EMBEDDED_PLAYER",
            "clientVersion": "1.20240723.01.00",
            "hl": "en",
            "gl": "US",
        },
        {"User-Agent": _UA, "Content-Type": "application/json"},
    ),
    (
        "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        {
            "clientName": "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
            "clientVersion": "2.0",
            "hl": "en",
            "gl": "US",
        },
        {"User-Agent": _UA, "Content-Type": "application/json"},
    ),
    (
        "ANDROID",
        {
            "clientName": "ANDROID",
            "clientVersion": "19.29.37",
            "androidSdkVersion": 30,
            "hl": "en",
            "gl": "US",
        },
        {
            "User-Agent": "com.google.android.youtube/19.29.37 (Linux; U; Android 11) gzip",
            "Content-Type": "application/json",
        },
    ),
]


def _opener() -> urllib.request.OpenerDirector:
    """Builds an opener honoring YT_PROXY_URL when present."""
    proxy = os.getenv("YT_PROXY_URL") or os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
    if proxy:
        handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        return urllib.request.build_opener(handler)
    return urllib.request.build_opener()


def _http_bytes(url: str, headers: Optional[Dict[str, str]] = None,
                data: Optional[bytes] = None, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with _opener().open(req, timeout=timeout) as res:
        raw = res.read()
        if (res.headers.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        return raw


def _http_json(url: str, headers: Optional[Dict[str, str]] = None,
               data: Optional[bytes] = None, timeout: int = 15) -> Dict[str, Any]:
    return json.loads(_http_bytes(url, headers=headers, data=data, timeout=timeout).decode("utf-8", "ignore"))


def _cookiefile() -> Optional[str]:
    """
    Returns a path to a Netscape-format cookies.txt, or None.

    Accepts either:
      * YT_COOKIES     — a filesystem path to a cookies.txt file
      * YT_COOKIES_B64 — the base64-encoded contents of cookies.txt

    Exporting browser cookies lets yt-dlp authenticate, which reliably bypasses
    YouTube's "Sign in to confirm you're not a bot" gate on datacenter IPs.
    """
    path = os.getenv("YT_COOKIES")
    if path and os.path.exists(path):
        return path
    b64 = (os.getenv("YT_COOKIES_B64") or "").strip()
    if b64:
        try:
            import base64
            import tempfile

            raw = base64.b64decode(b64)
            fd, tmp = tempfile.mkstemp(prefix="4ubyu_cookies_", suffix=".txt")
            with os.fdopen(fd, "wb") as f:
                f.write(raw)
            return tmp
        except Exception as e:
            print(f"[YouTubeFetch] cookie decode notice: {e}")
    return None


def ingestion_hint() -> str:
    """Config-aware, actionable advice for restoring full ingestion."""
    api = bool(os.getenv("YOUTUBE_API_KEY") or os.getenv("YT_API_KEY"))
    proxy = bool(os.getenv("YT_PROXY_URL"))
    cookies = bool(_cookiefile())
    fixes: List[str] = []
    if not api:
        fixes.append(
            "set YOUTUBE_API_KEY (free, metadata only: duration + description)"
        )
    if not (cookies or proxy):
        fixes.append(
            "set YT_COOKIES_B64 (exported browser cookies) or YT_PROXY_URL "
            "(residential proxy) to restore transcripts"
        )
    if not fixes:
        return "Configured YouTube sources could not access this video."
    return "To fix: " + "; ".join(fixes) + "."


def innertube_player(video_id: str, timeout: int = 15) -> Optional[Dict[str, Any]]:
    """
    Calls YouTube's InnerTube player API across several clients.

    Returns the first response dict that contains `videoDetails` (even when the
    video is reported UNPLAYABLE — duration/title are still present), or None.
    """
    best: Optional[Dict[str, Any]] = None
    for name, client_ctx, hdrs in _INNERTUBE_CLIENTS:
        try:
            payload = {
                "context": {"client": client_ctx},
                "videoId": video_id,
                "contentCheckOk": True,
                "racyCheckOk": True,
            }
            resp = _http_json(_INNERTUBE_URL, headers=hdrs,
                              data=json.dumps(payload).encode(), timeout=timeout)
            vd = resp.get("videoDetails") or {}
            if not vd:
                continue
            playable = (resp.get("playabilityStatus") or {}).get("status") in ("OK", "PLAYABLE")
            # Prefer a playable response (it carries caption tracks); otherwise
            # keep the first response that at least gives us videoDetails.
            if playable:
                resp["_client"] = name
                return resp
            if best is None:
                resp["_client"] = name
                best = resp
        except Exception:
            continue
    return best


def fetch_metadata_ytdlp(video_id: str) -> Dict[str, Any]:
    """
    Metadata via yt-dlp. With YT_COOKIES / YT_PROXY_URL configured this works
    from datacenter IPs where the watch page and InnerTube are bot-gated.

    Returns a dict with any of: title, channel, duration, description, thumbnail.
    """
    try:
        import yt_dlp  # type: ignore
    except Exception:
        return {}

    opts: Dict[str, Any] = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    cookie = _cookiefile()
    if cookie:
        opts["cookiefile"] = cookie
    proxy = os.getenv("YT_PROXY_URL")
    if proxy:
        opts["proxy"] = proxy

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=False
            )
    except Exception as e:
        print(f"[YouTubeFetch] yt-dlp metadata notice: {e}")
        return {}
    if not info:
        return {}

    out: Dict[str, Any] = {}
    if info.get("title"):
        out["title"] = info["title"]
    channel = info.get("uploader") or info.get("channel")
    if channel:
        out["channel"] = channel
    if info.get("duration"):
        try:
            out["duration"] = int(info["duration"])
        except (TypeError, ValueError):
            pass
    desc = (info.get("description") or "").strip()
    if desc:
        out["description"] = desc
    if info.get("thumbnail"):
        out["thumbnail"] = info["thumbnail"]
    return out


def fetch_metadata_fallback(video_id: str) -> Dict[str, Any]:
    """
    Best-effort metadata from InnerTube + the /embed/ page.

    Returns a dict with any of: title, channel, duration, duration_str,
    description, thumbnail. Empty dict when nothing could be retrieved.
    """
    out: Dict[str, Any] = {}

    # Official YouTube Data API first when a key is configured — the only
    # metadata source reliably allowed from datacenter/serverless IPs.
    api = fetch_youtube_data_api(video_id)
    if api:
        out.update(api)

    player = innertube_player(video_id)
    if player:
        vd = player.get("videoDetails") or {}
        title = (vd.get("title") or "").strip()
        if title:
            out["title"] = title
        author = (vd.get("author") or "").strip()
        if author:
            out["channel"] = author
        try:
            length = int(vd.get("lengthSeconds") or 0)
        except (TypeError, ValueError):
            length = 0
        if length > 0:
            out["duration"] = length
        desc = (vd.get("shortDescription") or "").strip()
        if desc:
            out["description"] = desc
        thumbs = (vd.get("thumbnail") or {}).get("thumbnails") or []
        if thumbs:
            out["thumbnail"] = thumbs[-1].get("url")

    # Embed page as a secondary duration/title source (often less gated).
    if not out.get("duration") or not out.get("title"):
        try:
            html = _http_bytes(
                f"https://www.youtube.com/embed/{video_id}",
                headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
                timeout=10,
            ).decode("utf-8", "ignore")
            if not out.get("title"):
                m = re.search(r'"title":"(.*?)"', html)
                if m:
                    out["title"] = m.group(1)
            if not out.get("duration"):
                for pat in (
                    r'"lengthSeconds":"(\d+)"',
                    r'"approxDurationMs":"(\d+)"',
                    r'itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"',
                ):
                    m = re.search(pat, html)
                    if not m:
                        continue
                    if pat.startswith('"approxDurationMs"'):
                        out["duration"] = int(int(m.group(1)) / 1000)
                    elif pat.startswith('"lengthSeconds"'):
                        out["duration"] = int(m.group(1))
                    else:
                        h, mi, s = (int(g or 0) for g in m.groups())
                        out["duration"] = h * 3600 + mi * 60 + s
                    break
        except Exception:
            pass

    # Final fallback: yt-dlp. Only attempted when a cookie file or proxy is
    # configured, since a bare datacenter request would just be bot-gated (and
    # slow). With cookies this recovers duration *and* description.
    if (not out.get("duration") or not out.get("description")) and (
        _cookiefile() or os.getenv("YT_PROXY_URL")
    ):
        yt = fetch_metadata_ytdlp(video_id)
        for k, v in yt.items():
            if not out.get(k):
                out[k] = v

    return out


def fetch_youtube_data_api(video_id: str) -> Dict[str, Any]:
    """
    Official YouTube Data API v3 lookup (requires YOUTUBE_API_KEY). This is the
    only metadata source that is reliably allowed from datacenter/serverless
    IPs, so it is preferred when a key is configured.

    Returns a dict with any of: title, channel, duration, description.
    """
    key = os.getenv("YOUTUBE_API_KEY") or os.getenv("YT_API_KEY")
    if not key:
        return {}
    try:
        url = (
            "https://www.googleapis.com/youtube/v3/videos"
            f"?id={urllib.parse.quote(video_id)}"
            f"&part=snippet,contentDetails&key={urllib.parse.quote(key)}"
        )
        data = _http_json(url, headers={"User-Agent": _UA}, timeout=15)
        items = data.get("items") or []
        if not items:
            return {}
        item = items[0]
        snippet = item.get("snippet") or {}
        details = item.get("contentDetails") or {}
        out: Dict[str, Any] = {}
        if snippet.get("title"):
            out["title"] = snippet["title"]
        if snippet.get("channelTitle"):
            out["channel"] = snippet["channelTitle"]
        if snippet.get("description"):
            out["description"] = snippet["description"]
        thumbs = (snippet.get("thumbnails") or {})
        if thumbs:
            last = list(thumbs.values())[-1]
            if last.get("url"):
                out["thumbnail"] = last["url"]
        iso = details.get("duration") or ""
        m = re.match(
            r"P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso
        )
        if m:
            d, h, mi, s = (int(g or 0) for g in m.groups())
            out["duration"] = d * 86400 + h * 3600 + mi * 60 + s
        return out
    except Exception as e:
        print(f"[YouTubeFetch] Data API notice: {e}")
        return {}


def probe(video_id: str, timeout: int = 12) -> Dict[str, Any]:
    """
    Diagnostics: reports what each ingestion source returns from *this* host so
    operators can see exactly which YouTube endpoint is blocked. Never raises.
    """
    report: Dict[str, Any] = {}

    # Watch page
    try:
        html = _http_bytes(
            f"https://www.youtube.com/watch?v={video_id}",
            headers={
                "User-Agent": _UA,
                "Accept-Language": "en-US,en;q=0.9",
                "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+478; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg;",
            },
            timeout=timeout,
        ).decode("utf-8", "ignore")
        tm = re.search(r"<title>(.*?)</title>", html)
        report["watch_page"] = {
            "ok": True,
            "bytes": len(html),
            "has_itemprop_duration": 'itemprop="duration"' in html,
            "has_lengthSeconds": '"lengthSeconds"' in html,
            "has_shortDescription": '"shortDescription"' in html,
            "has_player_response": "ytInitialPlayerResponse" in html,
            "html_title": tm.group(1)[:80] if tm else None,
        }
    except Exception as e:
        report["watch_page"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}"}

    # InnerTube per-client
    innertube = []
    for name, ctx, hdrs in _INNERTUBE_CLIENTS:
        try:
            payload = {
                "context": {"client": ctx},
                "videoId": video_id,
                "contentCheckOk": True,
                "racyCheckOk": True,
            }
            resp = _http_json(_INNERTUBE_URL, headers=hdrs,
                              data=json.dumps(payload).encode(), timeout=timeout)
            ps = resp.get("playabilityStatus") or {}
            caps = (
                (resp.get("captions") or {})
                .get("playerCaptionsTracklistRenderer", {})
                .get("captionTracks", [])
            )
            innertube.append({
                "client": name,
                "status": ps.get("status"),
                "reason": (ps.get("reason") or "")[:80],
                "has_details": bool(resp.get("videoDetails")),
                "length": (resp.get("videoDetails") or {}).get("lengthSeconds"),
                "captions": len(caps),
            })
        except Exception as e:
            innertube.append({"client": name, "error": f"{type(e).__name__}: {str(e)[:120]}"})
    report["innertube"] = innertube

    # oEmbed
    try:
        _http_json(
            f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
            headers={"User-Agent": _UA}, timeout=timeout,
        )
        report["oembed"] = {"ok": True}
    except Exception as e:
        report["oembed"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}

    # Transcript API
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore

        tl = YouTubeTranscriptApi().list(video_id)
        count = sum(1 for _ in tl)
        report["transcript_api"] = {"ok": True, "tracks": count}
    except Exception as e:
        report["transcript_api"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}"}

    report["youtube_api_key_set"] = bool(os.getenv("YOUTUBE_API_KEY") or os.getenv("YT_API_KEY"))
    report["proxy_set"] = bool(os.getenv("YT_PROXY_URL"))
    report["ytdlp_cookies_set"] = bool(_cookiefile())
    return report


def _parse_caption_json3(payload: bytes) -> List[Dict[str, Any]]:
    """Parses a timedtext `fmt=json3` payload into timed segments."""
    try:
        data = json.loads(payload.decode("utf-8", "ignore"))
    except Exception:
        return []
    segments: List[Dict[str, Any]] = []
    for ev in data.get("events") or []:
        segs = ev.get("segs") or []
        text = "".join(s.get("utf8", "") for s in segs).strip()
        if not text:
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", 0)) / 1000.0
        segments.append({"start": start, "duration": dur, "end": start + dur, "text": text})
    return segments


def fetch_captions(video_id: str) -> List[Dict[str, Any]]:
    """
    Fetches caption segments via InnerTube caption tracks when the video is
    playable for at least one client. Returns [] on failure.
    """
    player = innertube_player(video_id)
    if not player:
        return []
    tracks = (
        (player.get("captions") or {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not tracks:
        return []

    # Prefer English (manual or ASR), else the first available track.
    chosen = None
    for t in tracks:
        if (t.get("languageCode") or "").startswith("en"):
            chosen = t
            if t.get("kind") != "asr":
                break
    if not chosen:
        chosen = tracks[0]

    base = chosen.get("baseUrl")
    if not base:
        return []

    for fmt in ("json3", "srv3", "vtt"):
        try:
            sep = "&" if "?" in base else "?"
            payload = _http_bytes(base + sep + "fmt=" + fmt, headers={"User-Agent": _UA}, timeout=20)
            if fmt == "json3":
                segs = _parse_caption_json3(payload)
                if segs:
                    return segs
            else:
                # Fallback: extract <text start= dur=>...</text> from XML
                text = payload.decode("utf-8", "ignore")
                items = re.findall(
                    r'<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>(.*?)</text>',
                    text, re.DOTALL,
                )
                segs = []
                for start, dur, raw in items:
                    clean = re.sub(r"<[^>]+>", "", raw)
                    clean = (clean.replace("&amp;", "&").replace("&#39;", "'")
                             .replace("&quot;", '"').replace("&gt;", ">").replace("&lt;", "<")).strip()
                    if clean:
                        s = float(start)
                        d = float(dur) if dur else 0.0
                        segs.append({"start": s, "duration": d, "end": s + d, "text": clean})
                if segs:
                    return segs
        except Exception:
            continue
    return []


def fetch_subtitles_ytdlp(video_id: str) -> List[Dict[str, Any]]:
    """
    Last-resort subtitle fetch through yt-dlp. Returns timed segments or [].
    Honors YT_PROXY_URL through yt-dlp's `proxy` option.
    """
    try:
        import yt_dlp  # type: ignore
    except Exception:
        return []

    import tempfile
    from pathlib import Path

    tmpdir = Path(tempfile.mkdtemp(prefix="4ubyu_subs_"))
    opts: Dict[str, Any] = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-US", "en-GB"],
        "subtitlesformat": "json3/vtt/best",
        "outtmpl": str(tmpdir / "%(id)s.%(ext)s"),
    }
    proxy = os.getenv("YT_PROXY_URL")
    if proxy:
        opts["proxy"] = proxy
    cookie = _cookiefile()
    if cookie:
        opts["cookiefile"] = cookie
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    except Exception:
        return []

    files = sorted(tmpdir.glob("*"))
    for f in files:
        try:
            if f.suffix == ".json3":
                segs = _parse_caption_json3(f.read_bytes())
                if segs:
                    return segs
            elif f.suffix in (".vtt", ".srt"):
                return _parse_vtt_like(f.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue
    return []


def _parse_vtt_like(text: str) -> List[Dict[str, Any]]:
    """Minimal WebVTT/SRT parser producing timed segments."""
    def to_sec(ts: str) -> float:
        ts = ts.replace(",", ".")
        parts = ts.split(":")
        try:
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
            if len(parts) == 2:
                return int(parts[0]) * 60 + float(parts[1])
        except Exception:
            return 0.0
        return 0.0

    segments: List[Dict[str, Any]] = []
    cur_start: Optional[float] = None
    cur_end: Optional[float] = None
    buf: List[str] = []

    def flush():
        if cur_start is not None and buf:
            text = " ".join(buf).strip()
            if text:
                segments.append({
                    "start": cur_start,
                    "duration": max(0.0, (cur_end or cur_start) - cur_start),
                    "end": cur_end or cur_start,
                    "text": text,
                })

    for line in text.splitlines():
        s = line.strip()
        if "-->" in s:
            flush()
            buf = []
            left, _, right = s.partition("-->")
            cur_start = to_sec(left.strip().split(" ")[0])
            cur_end = to_sec(right.strip().split(" ")[0])
        elif s and cur_start is not None and not s.isdigit() and s.upper() != "WEBVTT":
            buf.append(re.sub(r"<[^>]+>", "", s))
    flush()
    return segments
