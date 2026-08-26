"""Platform core: users, roles (as a fixed enum-backed column — see Role in
rbac.py for the reference table used by permission rows), stored files,
Indian states. ARCH-1 'Platform' module tables.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import AuditMixin


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base, AuditMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(191), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(191), nullable=False)
    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("roles.id"), nullable=False)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    role = relationship("Role", foreign_keys=[role_id])


class StoredFile(Base, AuditMixin):
    __tablename__ = "stored_files"

    storage_key: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(127), nullable=False)
    size_bytes: Mapped[int] = mapped_column(nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class IndianState(Base):
    __tablename__ = "indian_states"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    gst_state_code: Mapped[str] = mapped_column(String(2), unique=True, nullable=False)


class RefreshToken(Base):
    """Phase 7 hardening round 2 — see 0008_auth_hardening.py for the full
    reasoning. No AuditMixin: a system-managed session artifact, not
    user-editable business data. Only `token_hash` (a SHA-256 digest, never
    the raw token) is ever looked up by; app/services/auth_tokens.py is the
    only code that should touch this table.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PasswordHistory(Base):
    """Last-N password hashes per user (N enforced in
    app/services/auth_tokens.py, not here) — blocks reuse on
    /auth/change-password per ARCH-2 §5.2. No AuditMixin, same reasoning
    as RefreshToken above.
    """

    __tablename__ = "password_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
