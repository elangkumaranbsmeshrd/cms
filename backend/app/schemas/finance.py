"""Pydantic schemas for Purchase Bill (13), Invoice + Credit Note (11), and
Expense incl. Company Expenses (12) — Phase 4.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ============================================================== PURCHASE BILL
class PurchaseBillLineItemIn(BaseModel):
    description: str
    hsn_code_id: str | None = None
    quantity: Decimal
    rate: Decimal


class PurchaseBillLineItemOut(PurchaseBillLineItemIn):
    id: str
    sequence: int
    line_total: Decimal
    model_config = ConfigDict(from_attributes=True)


class PurchaseBillCreate(BaseModel):
    vendor_id: str
    vendor_bill_number: str
    bill_date: date
    due_date: date | None = None
    notes: str | None = None
    attachment_stored_file_id: str | None = None
    bank_account_id: str | None = None
    linked_expense_claim_id: str | None = None
    tax_head_id: str | None = None
    tax_amount_override: Decimal | None = None  # typing over the head's own computed amount
    withholding_tax_head_id: str | None = None
    withholding_calculated_on: str | None = None  # SUBTOTAL | TOTAL
    withholding_amount_override: Decimal | None = None
    line_items: list[PurchaseBillLineItemIn]


class PurchaseBillTaxLineOut(BaseModel):
    id: str
    sequence: int
    tax_head_id: str | None
    head_name_snapshot: str | None
    print_label_snapshot: str | None
    computed_base: Decimal
    computed_amount: Decimal
    entered_amount: Decimal
    component_name_snapshot: str | None
    model_config = ConfigDict(from_attributes=True)


class PurchaseBillOut(BaseModel):
    id: str
    purchase_bill_code: str
    vendor_id: str
    financial_year_id: str
    vendor_bill_number: str
    vendor_name_snapshot: str
    vendor_gstin_snapshot: str | None
    bill_date: date
    due_date: date | None
    payment_terms_days_snapshot: int | None
    attachment_stored_file_id: str | None
    has_attachment: bool
    bank_account_id: str | None
    # §2.1 (2026-07-31 addition): "the account named on the bill, or the
    # account a payment was actually made from once one is recorded — the
    # figure that matters for reconciliation." bank_account_id above is the
    # bill's own field; this is the List column's actual source once paid.
    effective_bank_account_id: str | None = None
    linked_expense_claim_id: str | None
    subtotal: Decimal
    tax_head_id: str | None
    tax_amount: Decimal
    total_amount: Decimal
    withholding_tax_head_id: str | None
    withholding_calculated_on: str | None
    withholding_amount: Decimal
    withholding_head_name_snapshot: str | None
    amount_payable_to_vendor: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    status: str
    paid_at: datetime | None
    notes: str | None
    created_by: str | None
    updated_by: str | None
    line_items: list[PurchaseBillLineItemOut] = []
    tax_lines: list[PurchaseBillTaxLineOut] = []
    model_config = ConfigDict(from_attributes=True)


class PurchaseBillPaymentCreate(BaseModel):
    amount: Decimal
    payment_mode_id: str
    paid_from_bank_account_id: str | None = None
    payment_date: date
    reference: str | None = None


class PurchaseBillPaymentOut(BaseModel):
    id: str
    purchase_bill_id: str
    amount: Decimal
    balance_due_at_entry: Decimal
    payment_mode_id: str
    paid_from_bank_account_id: str | None
    paid_into_account_name_snapshot: str | None
    paid_into_bank_name_snapshot: str | None
    paid_into_account_number_masked_snapshot: str | None
    payment_date: date
    reference: str | None
    status: str
    recorded_by: str
    recorded_at: datetime
    model_config = ConfigDict(from_attributes=True)


# =========================================================== INVOICE
class InvoiceLineItemIn(BaseModel):
    description: str
    hsn_code_id: str | None = None
    quantity: Decimal
    rate: Decimal


class InvoiceLineItemOut(InvoiceLineItemIn):
    id: str
    sequence: int
    line_total: Decimal
    credited_amount: Decimal
    model_config = ConfigDict(from_attributes=True)


class InvoiceCreate(BaseModel):
    customer_id: str
    # §2.3 "Create from a won deal/project": still no Opportunity dropdown
    # (deliberately dropped — Reference stays the free-text link for that).
    # project_id exists only so this ONE prefill path can silently persist
    # which Project an invoice came from, for §6.2's Manager-invoices toggle
    # — never a user-facing form field. Ordinary "starting blank" callers
    # simply never send it.
    project_id: str | None = None
    invoice_date: date
    due_date: date | None = None
    reference: str | None = None
    notes: str | None = None
    service_category_id: str | None = None
    bank_account_id: str | None = None
    tax_head_id: str | None = None
    tax_amount_override: Decimal | None = None
    line_items: list[InvoiceLineItemIn]


class InvoiceTaxLineOut(BaseModel):
    id: str
    sequence: int
    tax_head_id: str | None
    head_name_snapshot: str | None
    print_label_snapshot: str | None
    computed_base: Decimal
    computed_amount: Decimal
    component_name_snapshot: str | None
    model_config = ConfigDict(from_attributes=True)


class InvoiceOut(BaseModel):
    id: str
    invoice_number: str
    financial_year_id: str
    customer_id: str
    project_id: str | None
    invoice_date: date
    due_date: date | None
    reference: str | None
    notes: str | None
    customer_name_snapshot: str
    customer_address_snapshot: str | None
    customer_gstin_snapshot: str | None
    service_category_id: str | None
    bank_account_id: str | None
    subtotal: Decimal
    tax_head_id: str | None
    tax_amount: Decimal
    grand_total: Decimal
    amount_received: Decimal
    credit_note_total: Decimal
    claim_amount: Decimal
    withheld_total: Decimal
    settled_amount: Decimal
    balance_due: Decimal
    status: str
    sent_at: datetime | None
    sent_by: str | None
    paid_at: datetime | None
    is_locked: bool
    created_by: str | None
    updated_by: str | None
    line_items: list[InvoiceLineItemOut] = []
    tax_lines: list[InvoiceTaxLineOut] = []
    model_config = ConfigDict(from_attributes=True)


class InvoicePaymentCreate(BaseModel):
    amount_received: Decimal
    customer_withheld_tax_head_id: str | None = None
    withholding_calculated_on: str | None = None  # SUBTOTAL | GRAND_TOTAL
    withheld_amount: Decimal | None = None
    payment_mode_id: str
    received_into_bank_account_id: str | None = None
    payment_date: date
    reference: str | None = None


class InvoicePaymentOut(BaseModel):
    id: str
    invoice_id: str
    amount_received: Decimal
    balance_due_at_entry: Decimal
    customer_withheld_tax_head_id: str | None
    withholding_calculated_on: str | None
    withheld_amount: Decimal
    amount_settled: Decimal
    payment_mode_id: str
    received_into_bank_account_id: str | None
    payment_date: date
    reference: str | None
    status: str
    reversed_at: datetime | None
    reversed_by: str | None
    reversal_reason: str | None
    recorded_by: str
    recorded_at: datetime
    model_config = ConfigDict(from_attributes=True)


class InvoicePaymentReverse(BaseModel):
    reason: str


# ========================================================= CREDIT NOTE
class CreditNoteCreate(BaseModel):
    invoice_id: str
    reason: str  # BILLING_ERROR | CUSTOMER_DISPUTE | GOODS_NOT_DELIVERED | OTHER
    reason_detail: str
    credit_amount: Decimal
    line_items_affected: list[str] = []  # invoice_line_item_ids, optional


class CreditNoteLineItemOut(BaseModel):
    id: str
    invoice_line_item_id: str
    sequence: int
    description_snapshot: str
    quantity_snapshot: Decimal
    rate_snapshot: Decimal
    line_total_snapshot: Decimal
    credited_amount: Decimal
    model_config = ConfigDict(from_attributes=True)


class CreditNoteOut(BaseModel):
    id: str
    credit_note_number: str
    invoice_id: str
    customer_id: str
    invoice_number_snapshot: str
    customer_name_snapshot: str
    credit_note_date: date
    reason: str
    reason_detail: str
    credit_amount: Decimal
    status: str
    raised_by: str
    submitted_at: datetime | None
    approved_by: str | None
    approved_at: datetime | None
    line_items: list[CreditNoteLineItemOut] = []
    model_config = ConfigDict(from_attributes=True)


# ============================================================ EXPENSE
class ExpenseClaimCreate(BaseModel):
    expense_type_id: str
    vendor_id: str | None = None
    amount: Decimal
    tax_head_id: str | None = None
    tax_amount: Decimal | None = None
    expense_date: date
    linked_purchase_bill_id: str | None = None
    description: str
    receipt_stored_file_id: str | None = None


class ExpenseClaimOut(BaseModel):
    id: str
    employee_id: str
    financial_year_id: str
    expense_type_id: str
    claim_type: str
    expense_type_name_snapshot: str
    vendor_id: str | None
    amount: Decimal
    tax_head_id: str | None
    tax_amount: Decimal | None
    expense_date: date
    linked_purchase_bill_id: str | None
    description: str
    receipt_stored_file_id: str | None
    has_receipt: bool
    bank_account_id: str | None
    status: str
    submitted_at: datetime
    manager_approved_by: str | None
    manager_approved_at: datetime | None
    approved_by: str | None
    approved_at: datetime | None
    rejected_by: str | None
    rejected_at: datetime | None
    rejection_reason: str | None
    reimbursed_at: datetime | None
    created_by: str | None
    updated_by: str | None
    model_config = ConfigDict(from_attributes=True)


class ExpenseRejectRequest(BaseModel):
    rejection_reason: str


class ExpenseReimburseRequest(BaseModel):
    reimbursed_date: date
    payment_mode_id: str
    reimbursed_from_bank_account_id: str
    reference: str | None = None


class ExpenseReimbursementOut(BaseModel):
    id: str
    expense_claim_id: str
    reimbursed_date: date
    amount: Decimal
    payment_mode_id: str
    reimbursed_from_bank_account_id: str
    reference: str | None
    status: str
    reimbursed_by: str
    reimbursed_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CompanyExpenseCreate(BaseModel):
    expense_type_id: str
    vendor_id: str | None = None
    linked_purchase_bill_id: str | None = None
    amount: Decimal
    tax_head_id: str | None = None
    tax_amount: Decimal | None = None
    paid_from_bank_account_id: str | None = None
    payment_mode_id: str | None = None
    payment_reference: str | None = None
    paid_on: date | None = None
    expense_date: date
    billing_period_month: int | None = None
    billing_period_year: int | None = None
    description: str | None = None
    bill_stored_file_id: str | None = None


class CompanyExpenseOut(BaseModel):
    id: str
    expense_type_id: str
    vendor_id: str | None
    linked_purchase_bill_id: str | None
    source_expense_claim_id: str | None
    amount: Decimal
    tax_head_id: str | None
    tax_amount: Decimal | None
    paid_from_bank_account_id: str | None
    payment_mode_id: str | None
    payment_reference: str | None
    paid_on: date | None
    expense_date: date
    billing_period_month: int | None
    billing_period_year: int | None
    description: str | None
    bill_stored_file_id: str | None
    has_bill_attached: bool
    status: str
    cancelled_at: datetime | None
    cancellation_reason: str | None
    model_config = ConfigDict(from_attributes=True)
