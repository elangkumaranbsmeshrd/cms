"""Asset Management (03-asset-management-module.md) — Phase 5. 5 tables.

No stored current_value/depreciation-as-of column on Asset — computed live
by app/services/asset_engine.py on every read, never a batch/cron job (this
codebase has no scheduler). asset_assignment_history is an append-only log,
same reduced shape as Ticket's assignment history.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin, _now


class Asset(Base, AuditMixin):
    __tablename__ = "assets"

    asset_tag: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_categories.id"), nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(191), nullable=True)
    order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    purchase_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    useful_life_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True)
    warranty_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    location_address_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("company_addresses.id"), nullable=True)
    department_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("departments.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="IN_STORE")
    assigned_to: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    depreciation_method: Mapped[str] = mapped_column(String(20), nullable=False, default="STRAIGHT_LINE")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    retired_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    retirement_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class AssetRequest(Base, AuditMixin):
    __tablename__ = "asset_requests"

    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    request_type: Mapped[str] = mapped_column(String(15), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    photo_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class AssetMaintenanceLog(Base, AuditMixin):
    __tablename__ = "asset_maintenance_log"

    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    log_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    serviced_by_vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True)
    is_system_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_request_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("asset_requests.id"), nullable=True)


class AssetAssignmentHistory(Base):
    __tablename__ = "asset_assignment_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    action: Mapped[str] = mapped_column(String(15), nullable=False)
    performed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class AssetFile(Base, AuditMixin):
    __tablename__ = "asset_files"

    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id"), nullable=False)
    stored_file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
