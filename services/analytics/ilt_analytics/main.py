"""FastAPI entry point. Run: uvicorn ilt_analytics.main:app --port 8090"""

from fastapi import FastAPI

from . import __version__

app = FastAPI(title="ILT analytics", version=__version__)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
