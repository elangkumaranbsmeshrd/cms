"""The audit mixin every table in ARCH-1 carries (Schema-wide decision D2):
id, created_at, updated_at, created_by, updated_by.

ORM types here are deliberately portable (generic SQLAlchemy types) so the RBAC
unit tests can run fast against SQLite. The Alembic migration is the source of
truth for the real MySQL 8 schema — see alembic/versions/0001_platform_core.py
and ARCH-1 D0 for the exact MySQL types (CHAR(36), DATETIME(6), etc.). Do not
treat these ORM types as the schema spec.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, declared_attr


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AuditMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)

    @declared_attr
    def created_by(cls) -> Mapped[str | None]:  # noqa: N805
        return mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    @declared_attr
    def updated_by(cls) -> Mapped[str | None]:  # noqa: N805
        return mapped_column(String(36), ForeignKey("users.id"), nullable=True)
