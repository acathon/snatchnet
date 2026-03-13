import asyncio
import os
import re
import shutil
import tempfile
from urllib.parse import urlparse, quote

import yt_dlp
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

# ── YouTube-only ──────────────────────────────────────────────────────────────
ALLOWED_DOMAINS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
}

ALLOWED_FORMATS = {"2160p", "1080p", "720p", "480p", "360p", "audio", "mp3"}

# Uses ffmpeg (installed via Scoop) to merge DASH video+audio for 720p+
FORMAT_SELECTORS = {
    "2160p": "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]",
    "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720p":  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480p":  "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]",
    "360p":  "best[height<=360][acodec!=none][vcodec!=none]/best[height<=360]",
    "audio": "bestaudio[ext=m4a]/bestaudio",
    "mp3":   "bestaudio/best",
}

# (quality_key, max_height, display_label)
TIERS = [
    ("2160p", 2160, "2160p Ultra HD · MP4"),
    ("1080p", 1080, "1080p Full HD · MP4"),
    ("720p",  720,  "720p HD · MP4"),
    ("480p",  480,  "480p · MP4"),
    ("360p",  360,  "360p · MP4"),
]


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


class InfoRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def must_be_youtube(cls, v: str) -> str:
        v = v.strip()
        if not validate_youtube_url(v):
            raise ValueError("Only YouTube URLs are supported.")
        return v


# ── POST /api/info ────────────────────────────────────────────────────────────

@router.post("/info")
@limiter.limit("30/minute")
async def get_info(request: Request, body: InfoRequest):
    try:
        data = await asyncio.to_thread(_fetch_info, body.url)
        return JSONResponse(content=data)
    except yt_dlp.utils.DownloadError as e:
        return JSONResponse(status_code=422, content={"error": clean_error(e)})
    except Exception:
        return JSONResponse(status_code=500, content={"error": "Failed to fetch video info. Please try again."})


# ── GET /api/download?url=...&format=... ──────────────────────────────────────
# Downloads to a temp file (with ffmpeg merging for 720p+), then streams it back.
# This is reliable — no IP-bound CDN URL issues.

@router.get("/download")
@limiter.limit("5/minute")
async def download_file(request: Request, url: str, format: str = "720p"):
    if not validate_youtube_url(url):
        return JSONResponse(status_code=400, content={"error": "Invalid YouTube URL."})
    if format not in ALLOWED_FORMATS:
        return JSONResponse(status_code=400, content={"error": "Invalid format."})

    try:
        filepath, ascii_name, utf8_name, media_type = await asyncio.to_thread(_download, url, format)
        file_size = os.path.getsize(filepath)
        tmpdir = os.path.dirname(filepath)

        def file_iter():
            try:
                with open(filepath, "rb") as f:
                    while chunk := f.read(65536):
                        yield chunk
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        # RFC 5987: filename= is ASCII fallback, filename*= is UTF-8 encoded
        content_disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(utf8_name)}"

        return StreamingResponse(
            file_iter(),
            media_type=media_type,
            headers={
                "Content-Disposition": content_disposition,
                "Content-Length": str(file_size),
            },
        )
    except yt_dlp.utils.DownloadError as e:
        return JSONResponse(status_code=422, content={"error": clean_error(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Download failed: {clean_error(e)}"})


# ── Sync workers (run in thread pool) ────────────────────────────────────────

def _fetch_info(url: str) -> dict:
    with yt_dlp.YoutubeDL(ydl_opts()) as ydl:
        data = ydl.extract_info(url, download=False)

    all_fmts = data.get("formats") or []

    # Collect every height that has a video stream (progressive OR DASH)
    available_heights: set[int] = set()
    for f in all_fmts:
        h = f.get("height") or 0
        if h > 0 and (f.get("vcodec") or "none") not in ("none", None, ""):
            available_heights.add(h)

    formats = []
    for quality, max_h, label in TIERS:
        tier_min = max_h // 2  # e.g. 1080p tier covers 541–1080
        if any(tier_min < h <= max_h for h in available_heights):
            # Pick the best candidate in this tier for a filesize estimate
            candidates = [
                f for f in all_fmts
                if tier_min < (f.get("height") or 0) <= max_h
                and (f.get("vcodec") or "none") not in ("none", None, "")
            ]
            best = max(candidates, key=lambda f: (f.get("filesize") or f.get("filesize_approx") or 0))
            formats.append({
                "label": label,
                "quality": quality,
                "ext": "mp4",
                "filesize": best.get("filesize") or best.get("filesize_approx"),
            })

    # Audio
    audio_fmts = [
        f for f in all_fmts
        if (f.get("acodec") or "none") not in ("none", None, "")
        and (f.get("vcodec") or "none") in ("none", None, "")
    ]
    if audio_fmts:
        audio_fmts.sort(key=lambda f: f.get("abr") or f.get("tbr") or 0, reverse=True)
        best = next((f for f in audio_fmts if f.get("ext") == "m4a"), audio_fmts[0])
        ext = best.get("ext") or "m4a"
        formats.append({
            "label": f"Audio · {ext.upper()}",
            "quality": "audio",
            "ext": ext,
            "filesize": best.get("filesize") or best.get("filesize_approx"),
        })
        # MP3 option — always offered when audio is available (converted via ffmpeg)
        formats.append({
            "label": "Audio · MP3",
            "quality": "mp3",
            "ext": "mp3",
            "filesize": None,
        })

    # Format upload_date "YYYYMMDD" → ISO "YYYY-MM-DD" for easy JS parsing
    raw_date = data.get("upload_date") or ""
    upload_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}" if len(raw_date) == 8 else ""

    return {
        "title":       data.get("title") or "Unknown",
        "thumbnail":   data.get("thumbnail"),
        "duration":    data.get("duration") or 0,
        "uploader":    data.get("uploader") or data.get("channel") or "Unknown",
        "channel_url": data.get("channel_url") or data.get("uploader_url") or "",
        "view_count":  data.get("view_count"),
        "like_count":  data.get("like_count"),
        "upload_date": upload_date,
        "description": (data.get("description") or "")[:500],
        "formats":     formats,
    }


def _download(url: str, format: str) -> tuple[str, str, str]:
    """Download to a temp dir using yt-dlp + ffmpeg. Returns (filepath, filename, media_type)."""
    tmpdir = tempfile.mkdtemp(prefix="snatchnet_")
    selector = FORMAT_SELECTORS[format]

    dl_extra: dict = {}
    if format == "mp3":
        dl_extra["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
    elif format not in ("audio",):
        dl_extra["merge_output_format"] = "mp4"

    opts = ydl_opts(
        format=selector,
        outtmpl=os.path.join(tmpdir, "%(title)s.%(ext)s"),
        **dl_extra,
    )

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise

    files = os.listdir(tmpdir)
    if not files:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise ValueError("Download produced no output file.")

    filename = files[0]
    filepath = os.path.join(tmpdir, filename)
    ext = os.path.splitext(filename)[1].lower()

    if format == "mp3":
        media_type = "audio/mpeg"
    elif format == "audio":
        media_type = "audio/mp4"
    else:
        media_type = "video/mp4"
    title = os.path.splitext(filename)[0]
    # ASCII fallback (strip non-ASCII for the plain filename= param)
    ascii_name = re.sub(r'[^\x00-\x7F]', '', re.sub(r'[^\w\s\-.]', '', title)).strip()[:80] or "download"
    ascii_name += ext
    # UTF-8 encoded name for filename*= param (supports any language)
    utf8_name = re.sub(r'[^\w\s\-.]', '', title).strip()[:80] + ext

    return filepath, ascii_name, utf8_name, media_type
