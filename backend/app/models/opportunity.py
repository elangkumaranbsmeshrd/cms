"""Opportunity (09-opportunity-module.md) — Phase 5. 3 tables."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class Opportunity(Base, AuditMixin):
    __tablename__ = "opportunities"

    opportunity_code: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    stage: Mapped[str] = mapped_column(String(20), nullable=False, default="PROSPECTING")
    probability_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    expected_close_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OpportunityActivity(Base, AuditMixin):
    __tablename__ = "opportunity_activities"

    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("opportunities.id"), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(10), nullable=False)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    related_contact_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("customer_contacts.id"), nullable=True)
    logged_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)


class OpportunityFile(Base, AuditMixin):
    __tablename__ = "opportunity_files"

    opportunity_id: Mapped[str] = mapped_column(String(36), ForeignKey("opportunities.id"), nullable=False)
    stored_file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
