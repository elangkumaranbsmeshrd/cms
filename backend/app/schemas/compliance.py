"""Pydantic schemas for Module 15 — Tax & Compliance."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ================================================================ OBLIGATIONS
class ObligationDocumentOut(BaseModel):
    source_type: str
    source_id: str
    document_label: str
    counterparty: str
    event_date: date
    amount: Decimal
    document_total: Decimal
    calculated_on: str | None = None


class ObligationPeriodOut(BaseModel):
    tax_head_id: str
    tax_head_name: str
    remitted_to: str | None
    source_label: str
    period_label: str
    period_from: date
    period_to: date
    withheld: Decimal
    remitted: Decimal
    outstanding: Decimal
    due_date: date
    status: str
    authority_reference_label: str | None
    documents: list[ObligationDocumentOut] = []


class ObligationsByDocumentRow(BaseModel):
    source_type: str
    source_id: str
    document_label: str
    source_label: str
    counterparty: str
    event_date: date
    tax_head_id: str
    tax_head_name: str
    calculated_on: str | None
    document_total: Decimal
    withheld: Decimal
    net_paid: Decimal
    period_label: str
    remittance_status: str
    authority_reference: str | None


class OverviewOut(BaseModel):
    # §2.1: "'nothing is configured' and 'configured but nothing withheld
    # yet' are different facts" — these two flags are what let a caller tell
    # the difference; the 8 figures below are byte-identical zero in both cases.
    has_obligation_heads_configured: bool
    has_credit_heads_configured: bool
    withheld_not_yet_remitted: Decimal
    due_within_7_days: Decimal
    overdue_remittances: Decimal
    remitted_this_fy: Decimal
    withheld_by_customers_this_fy: Decimal
    certificate_outstanding: Decimal
    certified_not_yet_claimed: Decimal
    credit_claimed_this_fy: Decimal
    due_soon_and_overdue: list[ObligationPeriodOut]
    certificates_outstanding_oldest_first: list["CertificateOut"]


# ================================================================ REMITTANCES
class DocumentAllocationIn(BaseModel):
    source_type: str
    source_id: str
    amount: Decimal


class RemittanceCreate(BaseModel):
    tax_head_id: str
    period_from: date
    period_to: date
    amount_remitted: Decimal
    paid_on: date
    paid_from_bank_account_id: str
    payment_mode_id: str
    authority_reference: str
    receipt_file_id: str | None = None
    notes: str | None = None
    documents_covered: list[DocumentAllocationIn]


class RemittanceReverseRequest(BaseModel):
    reason: str


class RemittanceAllocationOut(BaseModel):
    source_type: str
    source_id: str
    document_label: str
    amount: Decimal


class RemittanceOut(BaseModel):
    id: str
    remittance_number: str
    financial_year_id: str
    tax_head_id: str
    tax_head_name_snapshot: str
    remitted_to_snapshot: str | None
    period_label: str
    period_from: date
    period_to: date
    amount_remitted: Decimal
    paid_on: date
    paid_from_bank_account_id: str
    paid_from_bank_account_name: str
    payment_mode_id: str
    payment_mode_name: str
    authority_reference: str
    receipt_file_id: str | None
    notes: str | None
    recorded_by: str
    recorded_by_name: str
    is_reversal: bool
    reverses_remittance_id: str | None
    reversal_reason: str | None
    documents_covered: list[RemittanceAllocationOut] = []
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RemittanceEligibleDocumentOut(BaseModel):
    source_type: str
    source_id: str
    document_label: str
    counterparty: str
    withheld_amount: Decimal
    already_allocated: Decimal
    outstanding: Decimal


# ================================================================== CREDITS
class CreditRowOut(BaseModel):
    invoice_payment_id: str
    invoice_number: str
    customer_id: str
    customer_name: str
    payment_date: date
    invoice_total: Decimal
    amount_received: Decimal
    withheld: Decimal
    tax_head_id: str
    certificate_id: str | None
    certificate_reference: str | None
    credit_claimed: bool
    status: str


# ============================================================= CERTIFICATES
class CertificateReceiptIn(BaseModel):
    invoice_payment_id: str
    amount: Decimal


class CertificateCreate(BaseModel):
    customer_id: str
    certificate_reference: str
    certificate_date: date
    covered_from: date
    covered_to: date
    tax_head_id: str
    amount_on_certificate: Decimal
    receipts_covered: list[CertificateReceiptIn]
    attachment_file_id: str | None = None


class CertificateVoidRequest(BaseModel):
    reason: str


class CertificateReceiptOut(BaseModel):
    invoice_payment_id: str
    invoice_number: str
    amount: Decimal


class CertificateOut(BaseModel):
    id: str
    certificate_reference: str
    customer_id: str
    certificate_date: date
    covered_from: date
    covered_to: date
    tax_head_id: str
    tax_head_name_snapshot: str
    amount_on_certificate: Decimal
    amount_matched: Decimal
    variance: Decimal
    attachment_file_id: str | None
    status: str
    voided_at: datetime | None
    voided_by: str | None
    void_reason: str | None
    receipts_covered: list[CertificateReceiptOut] = []
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CreditClaimCreate(BaseModel):
    # No certificate_id here — POST /certificates/{certificate_id}/claim
    # already takes it from the URL path; the router only ever used the path
    # value, so requiring it again in the body was dead, error-prone
    # redundancy (a mismatched body value would have been silently ignored).
    claimed_in: str
    claim_reference: str | None = None
    claim_date: date
    notes: str | None = None


class CreditClaimOut(BaseModel):
    id: str
    certificate_id: str
    amount_claimable: Decimal
    claimed_in: str
    claim_reference: str | None
    claim_date: date
    notes: str | None
    claimed_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


OverviewOut.model_rebuild()
