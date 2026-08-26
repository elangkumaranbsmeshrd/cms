"""Phase 7 hardening round 2 — the DB-revocable half of ARCH-2 §5.1's token
design (see 0008_auth_hardening.py for the full reasoning). Every caller
that needs to end a user's sessions — password reset/change, disabling a
login — goes through revoke_all_refresh_tokens here rather than touching
`refresh_tokens` directly, so the revocation rule lives in exactly one place.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import create_access_token, hash_password, verify_password
from app.core.config import get_settings
from app.models.platform import PasswordHistory, RefreshToken, User
from app.services import email_transport

# ARCH-2 §5.2's "a password_hashes history table of the last N hashes blocks
# reuse" doesn't pin down N — 5 is a reasonable, commonly-used default and is
# enforced here (a service-layer trim of app/models/platform.PasswordHistory
# rows), not at the DB layer.
PASSWORD_HISTORY_LIMIT = 5


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def issue_token_pair(db: AsyncSession, user: User) -> TokenPair:
    raw_refresh = secrets.token_urlsafe(32)
    settings = get_settings()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    ))
    return TokenPair(access_token=create_access_token(user.id), refresh_token=raw_refresh)


async def rotate_refresh_token(db: AsyncSession, raw_refresh_token: str) -> TokenPair | None:
    """Exchanges a valid, unexpired, unrevoked refresh token for a new pair,
    revoking the old one in the same step (rotation) — a stolen-then-reused
    old token fails the very next time it's presented. Returns None (the
    caller 401s) if the token is unknown/expired/already revoked, or if the
    user it belongs to has since been disabled.
    """
    row = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(raw_refresh_token)))
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    now = datetime.now(timezone.utc)
    if row.expires_at.replace(tzinfo=timezone.utc) < now:
        return None
    user = await db.get(User, row.user_id)
    if user is None or not user.is_enabled:
        return None
    row.revoked_at = now
    pair = await issue_token_pair(db, user)
    await db.commit()
    return pair


async def revoke_refresh_token(db: AsyncSession, raw_refresh_token: str) -> None:
    row = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(raw_refresh_token)))
    ).scalar_one_or_none()
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        await db.commit()


async def revoke_all_refresh_tokens(db: AsyncSession, user_id: str) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def issue_temporary_password(db: AsyncSession, user: User, *, employee_first_name: str, employee_email: str, employee_id: str, actor_id: str) -> None:
    """ARCH-2 §5.4: HR's "Reset Password" button and the self-service
    reset-request endpoint "converge on one internal function... so there's
    one consistent mechanism instead of two different ones for what's
    conceptually the same need." Generates a fresh temp password, forces a
    change on next login, kills every existing session, emails it — never
    returns the plaintext to the caller either way (HR never sees it;
    self-service gets a generic "check your email" response regardless of
    outcome).
    """
    temp_password = secrets.token_urlsafe(9)
    user.password_hash = hash_password(temp_password)
    user.must_change_password = True
    user.updated_by = actor_id
    await revoke_all_refresh_tokens(db, user.id)
    await db.commit()
    await email_transport.send_templated_email(
        db, "password_reset", employee_email, {"first_name": employee_first_name, "reset_link": temp_password},
        related_record_type="employee", related_record_id=employee_id,
    )


async def is_password_reused(db: AsyncSession, user_id: str, plain_password: str) -> bool:
    recent_hashes = (
        await db.execute(
            select(PasswordHistory.password_hash)
            .where(PasswordHistory.user_id == user_id)
            .order_by(PasswordHistory.created_at.desc())
            .limit(PASSWORD_HISTORY_LIMIT)
        )
    ).scalars().all()
    return any(verify_password(plain_password, h) for h in recent_hashes)


async def record_password_history(db: AsyncSession, user_id: str, password_hash: str) -> None:
    db.add(PasswordHistory(user_id=user_id, password_hash=password_hash))
    await db.flush()
    stale_ids = (
        await db.execute(
            select(PasswordHistory.id)
            .where(PasswordHistory.user_id == user_id)
            .order_by(PasswordHistory.created_at.desc())
            .offset(PASSWORD_HISTORY_LIMIT)
        )
    ).scalars().all()
    if stale_ids:
        await db.execute(delete(PasswordHistory).where(PasswordHistory.id.in_(stale_ids)))
