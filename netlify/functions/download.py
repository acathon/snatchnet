"""
Netlify Function: GET /api/download?url=...&format=...
Extracts a direct CDN stream URL from yt-dlp and returns a 302 redirect.
The browser follows the redirect and downloads/streams directly from YouTube's CDN.
No file size limits, no proxying.
"""
import json
import re
from urllib.parse import urlparse

import yt_dlp

ALLOWED_DOMAINS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}

ALLOWED_FORMATS = {"720p", "480p", "360p", "audio"}

FORMAT_SELECTORS = {
    "720p":  "best[height<=720][acodec!=none][vcodec!=none]/best[height<=720]",
    "480p":  "best[height<=480][acodec!=none][vcodec!=none]/best[height<=480]",
    "360p":  "best[height<=360][acodec!=none][vcodec!=none]/best[height<=360]",
    "audio": "bestaudio[ext=m4a]/bestaudio",
}


def validate_youtube_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and (p.hostname or "") in ALLOWED_DOMAINS
    except Exception:
        return False


def ydl_opts(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "nocheckcertificate": True, **extra}


def clean_error(e: Exception) -> str:
    return re.sub(r"\[.*?\]\s*", "", str(e)).strip() or "An error occurred."


def get_direct_url(url: str, fmt: str) -> tuple[str, str]:
    selector = FORMAT_SELECTORS[fmt]
    with yt_dlp.YoutubeDL(ydl_opts(format=selector)) as ydl:
        data = ydl.extract_info(url, download=False)

    direct = (
        data.get("url")
        or next((f.get("url") for f in (data.get("requested_formats") or []) if f.get("url")), None)
        or next((f.get("url") for f in reversed(data.get("formats") or []) if f.get("url")), None)
    )
    if not direct:
        raise ValueError("No direct stream URL available.")

    ext = "m4a" if fmt == "audio" else "mp4"
    safe_title = re.sub(r"[^\w\s\-.]", "", data.get("title") or "video").strip()[:80]
    return direct, f"{safe_title}.{ext}"


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*"}, "body": ""}

    params = event.get("queryStringParameters") or {}
    url = (params.get("url") or "").strip()
    fmt = (params.get("format") or "720p").strip()

    if not validate_youtube_url(url):
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "Invalid YouTube URL."}),
        }

    if fmt not in ALLOWED_FORMATS:
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "Invalid format."}),
        }

    try:
        direct_url, filename = get_direct_url(url, fmt)
        return {
            "statusCode": 302,
            "headers": {
                "Location": direct_url,
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Allow-Origin": "*",
            },
            "body": "",
        }
    except yt_dlp.utils.DownloadError as e:
        return {
            "statusCode": 422,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": clean_error(e) or "Download failed."}),
        }
    except Exception:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "Could not retrieve download URL. Please try again."}),
        }
