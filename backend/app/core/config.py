from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    database_url_sync: str
    secret_key: str
    # Phase 7 hardening round 2 — ARCH-2 §5.1's own design: a short-lived
    # access token backed by a separate, longer-lived, DB-revocable refresh
    # token (app/services/auth_tokens.py). Was 480 (8h) with no revocation
    # at all — a disabled user's token kept working until it naturally
    # expired. 15 minutes matches ARCH-2's own stated figure.
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    environment: str = "development"

    # Phase 7 hardening: no CORS middleware existed at all before this —
    # harmless in production (BUILD-PROMPT §12: nginx serves Angular and
    # reverse-proxies FastAPI on the same origin, so no cross-origin request
    # ever happens there) but blocks the ordinary case of an Angular dev
    # server on a different port talking to this API locally. Comma-
    # separated; the two common Angular CLI dev ports are the default.
    cors_allowed_origins: str = "http://localhost:4200,http://127.0.0.1:4200"

    # Phase 7 hardening round 2 — backs app/core/rate_limit.py's /auth/login
    # brute-force counters. Best-effort: see that module's own docstring for
    # why an unreachable Redis fails open instead of blocking login.
    redis_url: str = "redis://localhost:6379/0"

    # Phase 6 — cross-cutting infrastructure
    file_storage_root: str = "./storage"
    # Fernet key encrypting EmailServerSettings.password_encrypted/api_key_encrypted
    # at rest. Phase 7 security review: this used to default to a real key
    # value baked directly into source (and therefore into every clone/fork/
    # commit history) — a deployment that forgot to set the real env var
    # would silently encrypt production credentials with a publicly-known
    # key. No default now, same "must be set or the app won't start"
    # requirement as secret_key already had.
    credential_encryption_key: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
