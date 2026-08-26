"""Purchase Bill (13), Invoice + Credit Note (11), Expense incl. Company
Expenses (12) — Phase 4. 13 tables.

Every real MySQL `GENERATED ALWAYS AS ... STORED` column is wrapped in
Computed() here, never a plain mapped_column — see alembic/versions/
0005_finance.py's docstring for the full cross-table-rollups-stay-plain /
same-row-arithmetic-is-Computed() split this phase follows (same as Payroll).
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Computed, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


# ============================================================== PURCHASE BILL
class PurchaseBill(Base, AuditMixin):
    __tablename__ = "purchase_bills"

    purchase_bill_code: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    vendor_bill_number: Mapped[str] = mapped_column(String(191), nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    vendor_name_snapshot: Mapped[str] = mapped_column(String(150), nullable=False)
    vendor_gstin_snapshot: Mapped[str | None] = mapped_column(String(15), nullable=True)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_terms_days_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    has_attachment: Mapped[bool] = mapped_column(Boolean, Computed("attachment_stored_file_id IS NOT NULL"), nullable=False)
    bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    linked_expense_claim_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("expense_claims.id"), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    tax_amount_is_manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount"), nullable=False)
    withholding_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    withholding_calculated_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    withholding_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    withholding_amount_is_manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    withholding_head_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    withholding_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    amount_payable_to_vendor: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount - withholding_amount"), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    balance_due: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount - withholding_amount - amount_paid"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="UNPAID")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class PurchaseBillLineItem(Base, AuditMixin):
    __tablename__ = "purchase_bill_line_items"

    purchase_bill_id: Mapped[str] = mapped_column(String(36), ForeignKey("purchase_bills.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    hsn_code_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("hsn_sac_codes.id"), nullable=True)
    hsn_code_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("quantity * rate"), nullable=False)


class PurchaseBillTaxLine(Base, AuditMixin):
    __tablename__ = "purchase_bill_tax_lines"

    purchase_bill_id: Mapped[str] = mapped_column(String(36), ForeignKey("purchase_bills.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    head_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    print_label_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    scope_snapshot: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tax_type_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    cgst_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    sgst_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    fixed_amount_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    computed_base: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    computed_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    entered_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    parent_line_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("purchase_bill_tax_lines.id"), nullable=True)
    component_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    share_pct_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)


class PurchaseBillPayment(Base, AuditMixin):
    __tablename__ = "purchase_bill_payments"

    purchase_bill_id: Mapped[str] = mapped_column(String(36), ForeignKey("purchase_bills.id"), nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    balance_due_at_entry: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    payment_mode_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_modes.id"), nullable=False)
    paid_from_bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    paid_into_account_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    paid_into_bank_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    paid_into_account_number_masked_snapshot: Mapped[str | None] = mapped_column(String(50), nullable=True)
    paid_into_ifsc_snapshot: Mapped[str | None] = mapped_column(String(11), nullable=True)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="RECORDED")
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


# ===================================================== INVOICE + CREDIT NOTE
class Invoice(Base, AuditMixin):
    __tablename__ = "invoices"

    invoice_number: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    # §6.2 "Allow Manager Read-Only Access to Their Projects' Invoices" —
    # silently set only by the "Create from Project" prefill path (0014's
    # own docstring); no Opportunity dropdown/form field exists or is added
    # by this column, that link stays the free-text Reference field.
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id"), nullable=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_gstin_snapshot: Mapped[str | None] = mapped_column(String(15), nullable=True)
    service_category_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("service_categories.id"), nullable=True)
    bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    grand_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount"), nullable=False)
    amount_received: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    credit_note_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    claim_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount - credit_note_total"), nullable=False)
    withheld_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    settled_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("amount_received + withheld_total"), nullable=False)
    balance_due: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("subtotal + tax_amount - credit_note_total - amount_received - withheld_total"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, Computed("status = 'PAID'"), nullable=False)
    pdf_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)


class InvoiceLineItem(Base, AuditMixin):
    __tablename__ = "invoice_line_items"

    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    hsn_code_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("hsn_sac_codes.id"), nullable=True)
    hsn_code_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("quantity * rate"), nullable=False)
    credited_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)


class InvoiceTaxLine(Base, AuditMixin):
    __tablename__ = "invoice_tax_lines"

    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    head_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    print_label_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    scope_snapshot: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tax_type_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    cgst_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    sgst_rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    fixed_amount_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    computed_base: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    computed_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    parent_line_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("invoice_tax_lines.id"), nullable=True)
    component_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    share_pct_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)


class InvoicePayment(Base, AuditMixin):
    __tablename__ = "invoice_payments"

    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    amount_received: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    balance_due_at_entry: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    customer_withheld_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    tax_head_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    print_label_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    withholding_calculated_on: Mapped[str | None] = mapped_column(String(12), nullable=True)
    withheld_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    amount_settled: Mapped[Decimal] = mapped_column(Numeric(14, 2), Computed("amount_received + withheld_amount"), nullable=False)
    payment_mode_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_modes.id"), nullable=False)
    received_into_bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="RECORDED")
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class CreditNote(Base, AuditMixin):
    __tablename__ = "credit_notes"

    credit_note_number: Mapped[str] = mapped_column(String(191), nullable=False, unique=True)
    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    invoice_number_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    customer_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    credit_note_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    reason_detail: Mapped[str] = mapped_column(Text, nullable=False)
    credit_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    raised_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    applied_to_invoice_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pdf_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)


class CreditNoteLineItem(Base, AuditMixin):
    __tablename__ = "credit_note_line_items"

    credit_note_id: Mapped[str] = mapped_column(String(36), ForeignKey("credit_notes.id"), nullable=False)
    invoice_line_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("invoice_line_items.id"), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    description_snapshot: Mapped[str] = mapped_column(String(500), nullable=False)
    quantity_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    line_total_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    credited_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


# ============================================================ EXPENSE MODULE
class ExpenseClaim(Base, AuditMixin):
    __tablename__ = "expense_claims"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    expense_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("expense_types.id"), nullable=False)
    claim_type: Mapped[str] = mapped_column(String(20), nullable=False)
    expense_type_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    expense_type_short_code_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_recurring_type_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    tax_head_name_snapshot: Mapped[str | None] = mapped_column(String(191), nullable=True)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    linked_purchase_bill_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("purchase_bills.id"), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    receipt_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    has_receipt: Mapped[bool] = mapped_column(Boolean, Computed("receipt_stored_file_id IS NOT NULL"), nullable=False)
    bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="PENDING")
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # §6.1 "Allow Manager to Approve Their Team's Expenses" — a distinct
    # sign-off step from Accountant's own approved_by/approved_at below;
    # conflating the two would make "who gave final approval" ambiguous.
    manager_approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    manager_approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejected_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reimbursed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExpenseReimbursement(Base, AuditMixin):
    __tablename__ = "expense_reimbursements"

    expense_claim_id: Mapped[str] = mapped_column(String(36), ForeignKey("expense_claims.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    reimbursed_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    payment_mode_id: Mapped[str] = mapped_column(String(36), ForeignKey("payment_modes.id"), nullable=False)
    reimbursed_from_bank_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="RECORDED")
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reimbursed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    reimbursed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    live_guard: Mapped[str | None] = mapped_column(String(36), Computed("IF(status = 'RECORDED', expense_claim_id, NULL)"), nullable=True)


class CompanyExpense(Base, AuditMixin):
    __tablename__ = "company_expenses"

    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    expense_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("expense_types.id"), nullable=False)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True)
    linked_purchase_bill_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("purchase_bills.id"), nullable=True)
    source_expense_claim_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("expense_claims.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    tax_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    paid_from_bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    payment_mode_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("payment_modes.id"), nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(191), nullable=True)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    billing_period_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    billing_period_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    bill_stored_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    has_bill_attached: Mapped[bool] = mapped_column(Boolean, Computed("bill_stored_file_id IS NOT NULL"), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
