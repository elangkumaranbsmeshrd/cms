"""Phase 7 hardening round 2 — /auth/login brute-force protection.

ARCH-3 §9.4's own answer to this is an nginx `limit_req_zone` in front of
the droplet; that's real and should still be layered on once a droplet
exists (see the comment on that endpoint), but it can't be built or
verified here — there is no nginx, no domain, and no Angular frontend yet.
This is the part that CAN be built and live-verified today, and it stays
worth keeping even once nginx exists: it is scoped per-account (nginx's
`$binary_remote_addr` zone only sees the caller's IP, so it does nothing
against a botnet spreading one password guess across many source IPs).

Fixed-window counter in Redis, two independent keys per attempt — one per
account (stops distributed credential stuffing against one victim), one
per source IP (stops one attacker spraying many accounts). Only FAILED
attempts increment the counter; a correct password always resets it.

Redis is treated as best-effort, not a hard dependency of login: if it is
unreachable, we log a warning and let the request through unlimited rather
than taking the whole login path down over a side-channel control. MySQL
being unreachable already fails login outright, so this doesn't lower the
app's real availability floor, and a single-droplet deployment shouldn't
gain a second single point of failure for a defense-in-depth feature.
"""

import logging

import redis.asyncio as redis
from fastapi import HTTPException, Request, status

from app.core.config import get_settings

logger = logging.getLogger("app.security")

LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS = 5

_redis_client: redis.Redis | None = None


def _client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            get_settings().redis_url,
            socket_connect_timeout=1,
            socket_timeout=1,
            decode_responses=True,
        )
    return _redis_client


def _keys(request: Request, email: str) -> tuple[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    return f"loginlimit:acct:{email.strip().lower()}", f"loginlimit:ip:{client_ip}"


async def enforce_login_rate_limit(request: Request, email: str) -> None:
    keys = _keys(request, email)
    try:
        r = _client()
        counts = await r.mget(keys)
    except Exception:
        logger.warning("login rate limit check skipped - redis unavailable", exc_info=True)
        return
    for count in counts:
        if count is not None and int(count) >= LOGIN_MAX_ATTEMPTS:
            logger.warning("login blocked by rate limit for %s", email.strip().lower())
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(LOGIN_WINDOW_SECONDS)},
            )


async def record_login_failure(request: Request, email: str) -> None:
    keys = _keys(request, email)
    try:
        r = _client()
        pipe = r.pipeline()
        for key in keys:
            pipe.incr(key)
            pipe.expire(key, LOGIN_WINDOW_SECONDS, nx=True)
        await pipe.execute()
    except Exception:
        logger.warning("login failure counter not recorded - redis unavailable", exc_info=True)


async def reset_login_attempts(request: Request, email: str) -> None:
    keys = _keys(request, email)
    try:
        await _client().delete(*keys)
    except Exception:
        logger.warning("login attempt counter not reset - redis unavailable", exc_info=True)


# ARCH-2 §5.4's self-service password-reset-request endpoint. Same fixed-
# window, per-account + per-IP shape as login above, but deliberately
# SILENT rather than a 429: that endpoint "always returns 204 regardless of
# whether the email exists" — surfacing a 429 when a caller is over budget
# would still be an information-neutral response (it doesn't reveal account
# existence), but it would violate that literal "always 204" contract for
# no real benefit, since a caller over budget simply doesn't need the email
# resent within the window either way.
RESET_REQUEST_WINDOW_SECONDS = 15 * 60
RESET_REQUEST_MAX_ATTEMPTS = 5


def _reset_request_keys(request: Request, email: str) -> tuple[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    return f"pwresetlimit:acct:{email.strip().lower()}", f"pwresetlimit:ip:{client_ip}"


async def reset_request_within_budget(request: Request, email: str) -> bool:
    """True if this account+IP pair may still trigger a reset email this
    window; also increments the counters as a side effect (every call
    counts, unlike login's separate check/record split — there is no
    "success" state here to reset on, every request is equally sensitive).
    Fails OPEN (returns True) if Redis is unreachable, same reasoning as
    the login limiter above.
    """
    keys = _reset_request_keys(request, email)
    try:
        r = _client()
        counts = await r.mget(keys)
    except Exception:
        logger.warning("reset-request rate limit check skipped - redis unavailable", exc_info=True)
        return True
    if any(count is not None and int(count) >= RESET_REQUEST_MAX_ATTEMPTS for count in counts):
        logger.warning("password reset request blocked by rate limit for %s", email.strip().lower())
        return False
    try:
        pipe = r.pipeline()
        for key in keys:
            pipe.incr(key)
            pipe.expire(key, RESET_REQUEST_WINDOW_SECONDS, nx=True)
        await pipe.execute()
    except Exception:
        logger.warning("reset-request counter not recorded - redis unavailable", exc_info=True)
    return True
