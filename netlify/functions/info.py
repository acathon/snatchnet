"""
Netlify Function: POST /api/info
Fetches YouTube video metadata and available download formats.
"""
import json
import re
from urllib.parse import urlparse

import yt_dlp

ALLOWED_DOMAINS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


def validate_youtube_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and (p.hostname or "") in ALLOWED_DOMAINS
    except Exception:
        return False


def clean_error(e: Exception) -> str:
    return re.sub(r"\[.*?\]\s*", "", str(e)).strip() or "An error occurred."


def ydl_opts(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "nocheckcertificate": True, **extra}


def fetch_info(url: str) -> dict:
    with yt_dlp.YoutubeDL(ydl_opts()) as ydl:
        data = ydl.extract_info(url, download=False)

    progressive, audio_only = [], []
    for f in (data.get("formats") or []):
        has_v = (f.get("vcodec") or "none") not in ("none", None, "")
        has_a = (f.get("acodec") or "none") not in ("none", None, "")
        if has_v and has_a:
            progressive.append(f)
        elif has_a:
            audio_only.append(f)

    progressive.sort(key=lambda f: f.get("height") or 0, reverse=True)

    formats = []
    offered = set()
    for f in progressive:
        h = f.get("height") or 0
        tier = None
        if h >= 720 and "720p" not in offered:
            tier = "720p"
        elif h >= 480 and "480p" not in offered:
            tier = "480p"
        elif h >= 360 and "360p" not in offered:
            tier = "360p"
        if tier:
            offered.add(tier)
            formats.append({
                "label": f"{tier} · MP4",
                "quality": tier,
                "ext": "mp4",
                "filesize": f.get("filesize") or f.get("filesize_approx"),
            })

    if audio_only:
        audio_only.sort(key=lambda f: f.get("abr") or f.get("tbr") or 0, reverse=True)
        best = next((f for f in audio_only if f.get("ext") == "m4a"), audio_only[0])
        ext = best.get("ext") or "m4a"
        formats.append({
            "label": f"Audio · {ext.upper()}",
            "quality": "audio",
            "ext": ext,
            "filesize": best.get("filesize") or best.get("filesize_approx"),
        })

    return {
        "title": data.get("title") or "Unknown",
        "thumbnail": data.get("thumbnail"),
        "duration": data.get("duration") or 0,
        "uploader": data.get("uploader") or data.get("channel") or "Unknown",
        "formats": formats,
    }


def handler(event, context):
    # CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "headers": CORS_HEADERS, "body": json.dumps({"error": "Method not allowed."})}

    try:
        body = json.loads(event.get("body") or "{}")
        url = str(body.get("url", "")).strip()
    except Exception:
        return {"statusCode": 400, "headers": CORS_HEADERS, "body": json.dumps({"error": "Invalid request body."})}

    if not validate_youtube_url(url):
        return {
            "statusCode": 400,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Invalid URL. Only YouTube links are supported."}),
        }

    try:
        info = fetch_info(url)
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": json.dumps(info)}
    except yt_dlp.utils.DownloadError as e:
        return {
            "statusCode": 422,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": clean_error(e) or "Could not process this video."}),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Failed to fetch video info. Please try again."}),
        }
