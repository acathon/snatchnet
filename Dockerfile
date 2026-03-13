FROM python:3.12-slim

# Install ffmpeg (required for DASH stream merging and MP3 conversion)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies via pip (no uv needed in Docker)
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    yt-dlp \
    slowapi \
    python-multipart \
    aiofiles

# Copy application code
COPY app/ ./app/
COPY public/ ./public/
COPY run.py .

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
