"""Module 15 — Tax & Compliance (15-tax-compliance-module.md). 5 tables.

The Obligations register itself (§2.2) is NOT modeled here — it's a live
aggregation over purchase_bills.withholding_amount / payslip_statutory_lines
.computed_amount, netted against remittance_allocations, computed by
app/services/obligation_engine.py on every read. Only real transactional
documents (a deposit actually made, a certificate actually received, a claim
actually taken) are tables. remittance_allocations and certificate_receipts
are append-only children of an append-only-once-saved parent — reduced
column set (no updated_at/updated_by), same shape as TaskComment/
AssetAssignmentHistory.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Computed, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin, _now


class Remittance(Base, AuditMixin):
    __tablename__ = "remittances"

    remittance_number: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    tax_head_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    remitted_to_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    period_label: Mapped[str] = mapped_column(String(60), nullable=False)
    period_from: Mapped[date] = mapped_column(Date, nullable=False)
    period_to: Mapped[date] = mapped_column(Date, nullable=False)
    amount_remitted: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    paid_from_bank_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=False)
    payment_mode_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_modes.id"), nullable=False)
    authority_reference: Mapped[str] = mapped_column(String(191), nullable=False)
    receipt_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    is_reversal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reverses_remittance_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("remittances.id"), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class RemittanceAllocation(Base):
    __tablename__ = "remittance_allocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    remittance_id: Mapped[str] = mapped_column(String(36), ForeignKey("remittances.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)  # PURCHASE_BILL | PAYSLIP_STATUTORY_LINE
    source_id: Mapped[str] = mapped_column(String(36), nullable=False)  # polymorphic, no FK across the two tables
    amount_allocated: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class WithholdingCertificate(Base, AuditMixin):
    __tablename__ = "withholding_certificates"

    certificate_reference: Mapped[str] = mapped_column(String(191), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    certificate_date: Mapped[date] = mapped_column(Date, nullable=False)
    covered_from: Mapped[date] = mapped_column(Date, nullable=False)
    covered_to: Mapped[date] = mapped_column(Date, nullable=False)
    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    tax_head_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    amount_on_certificate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    amount_matched: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    variance: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("amount_on_certificate - amount_matched"), nullable=False)
    attachment_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    voided_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class CertificateReceipt(Base):
    __tablename__ = "certificate_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    certificate_id: Mapped[str] = mapped_column(String(36), ForeignKey("withholding_certificates.id"), nullable=False)
    invoice_payment_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoice_payments.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class CreditClaim(Base, AuditMixin):
    __tablename__ = "credit_claims"

    certificate_id: Mapped[str] = mapped_column(String(36), ForeignKey("withholding_certificates.id"), unique=True, nullable=False)
    amount_claimable: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    claimed_in: Mapped[str] = mapped_column(String(120), nullable=False)
    claim_reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    claim_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    claimed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
