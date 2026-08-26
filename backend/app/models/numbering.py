"""Financial Year (Masters §3.1) and the concurrency-safe document numbering
allocator (ARCH-1 D7 / D9). Both are platform-core: almost every other module
depends on one or the other before it can generate its own records.
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class FinancialYear(Base, AuditMixin):
    __tablename__ = "financial_years"

    label: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # e.g. "2026"
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open")  # open | locked
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    # A019/A002: locking was originally one-way with no unlock action
    # anywhere, enforced by a BEFORE UPDATE trigger (trg_fy_reject_unlock),
    # not just left to the API layer to remember. Migration 0009 relaxed the
    # trigger to allow exactly one sanctioned exception — see
    # app.api.v1.financial_years.unlock_financial_year — a Super Admin-only,
    # RBAC-gated override; a plain UPDATE from anything else is still rejected.
    reference_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # "Only one current FY" — a Postgres partial-unique in the original design,
    # implemented here as a plain boolean; the MySQL migration enforces
    # uniqueness via the generated-column trick from ARCH-1 D0.1.
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class DocumentNumberSequence(Base, AuditMixin):
    """One row per (code_type, financial_year). Allocation is a single
    UPDATE ... RETURNING-style statement inside the creating transaction,
    never a database SEQUENCE — see ARCH-1 D7 for why.
    """

    __tablename__ = "document_number_sequences"

    code_type: Mapped[str] = mapped_column(String(30), nullable=False)  # e.g. "INVOICE", "EMPLOYEE"
    financial_year_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("financial_years.id"), nullable=True
    )
    prefix: Mapped[str] = mapped_column(String(10), nullable=False)
    digits: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    next_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_issued_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_issued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
