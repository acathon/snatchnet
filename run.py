"""Entry point — run with: uv run python run.py"""
import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    dev = os.environ.get("FLY_APP_NAME") is None  # reload only in local dev
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=dev,
        reload_excludes=["public/*", "*.lock", "node_modules/*"],
    )
