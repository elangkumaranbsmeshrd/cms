"""Vendor module (07-vendor-module.md). 1 table — deliberately no Masters
dependency (no auto-generated Vendor Code, A257/A259), unlike every other
directory-style master in this schema.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, Computed, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class Vendor(Base, AuditMixin):
    __tablename__ = "vendors"

    vendor_name: Mapped[str] = mapped_column(String(150), nullable=False)
    vendor_category: Mapped[str | None] = mapped_column(String(191), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(191), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    payment_terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    address_street: Mapped[str | None] = mapped_column(String(191), nullable=True)
    address_city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address_state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address_pin_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    bank_account_name: Mapped[str | None] = mapped_column(String(191), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(191), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(34), nullable=True)
    bank_account_number_masked: Mapped[str | None] = mapped_column(
        String(50), Computed("CASE WHEN bank_account_number IS NULL THEN NULL ELSE CONCAT(COALESCE(bank_name, ''), ' ••••', SUBSTR(bank_account_number, -4)) END"), nullable=True
    )
    ifsc_code: Mapped[str | None] = mapped_column(String(11), nullable=True)
    has_bank_details: Mapped[bool] = mapped_column(Boolean, Computed("bank_account_number IS NOT NULL"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # §6.1 "Require Approval to Add a New Vendor" toggle, default OFF — every
    # vendor is created 'approved' unless the toggle is on, in which case a
    # new vendor starts 'pending_approval' until Accountant/Super Admin signs
    # off (vendors.py's approve_vendor endpoint is the only writer of this
    # field after creation).
    approval_status: Mapped[str] = mapped_column(String(20), nullable=False, default="approved")
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deactivated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    deactivation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_inline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Rollups — plain, API-written (see 0005_finance.py's docstring: no
    # trigger maintains these). Drive the Delete-vs-Deactivate reference
    # guard: the Delete button is withheld once has_usage_history is true.
    purchase_bill_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expense_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_usage_history: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    outstanding_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_spend: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
