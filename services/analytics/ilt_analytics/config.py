"""Settings from the environment and the repository's .env (never committed)."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    """Adds KEY=VALUE lines of the .env file to os.environ (variables already set win)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def analyst_database_url() -> str:
    """Connection string for the ilt_analyst role, which can read only the research views (DDD §9).

    ANALYST_DATABASE_URL if set; otherwise the host and database of APP_DATABASE_URL with the
    ilt_analyst role and ILT_ANALYST_DB_PASSWORD (set on the role by `pnpm db:migrate`).
    """
    load_env()
    if url := os.environ.get("ANALYST_DATABASE_URL"):
        return url
    app_url, password = os.environ.get("APP_DATABASE_URL"), os.environ.get("ILT_ANALYST_DB_PASSWORD")
    if not app_url or not password:
        raise RuntimeError("Set ANALYST_DATABASE_URL, or APP_DATABASE_URL and ILT_ANALYST_DB_PASSWORD (see .env.example)")
    u = urlsplit(app_url)
    # "localhost" can try the IPv6 address first and wait for it to time out (seen on Windows).
    host = "127.0.0.1" if u.hostname in (None, "localhost") else u.hostname
    netloc = f"ilt_analyst:{quote(password, safe='')}@{host}" + (f":{u.port}" if u.port else "")
    return urlunsplit((u.scheme, netloc, u.path, u.query, u.fragment))


def _local(url: str) -> str:
    """The URL with "localhost" as 127.0.0.1 (see analyst_database_url)."""
    u = urlsplit(url)
    if u.hostname != "localhost":
        return url
    return urlunsplit((u.scheme, u.netloc.replace("localhost", "127.0.0.1", 1), u.path, u.query, u.fragment))


def s3_settings() -> dict[str, str]:
    """Endpoint and credentials of the S3 storage (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)."""
    load_env()
    missing = [k for k in ("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY") if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Set {', '.join(missing)} (see .env.example)")
    return {"endpoint": _local(os.environ["S3_ENDPOINT"]), "access_key": os.environ["S3_ACCESS_KEY"], "secret_key": os.environ["S3_SECRET_KEY"]}
