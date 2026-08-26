"""Pure calculation functions for Phase 4 (Purchase Bill, Invoice, Credit
Note) — no DB access, unit-tested at the boundary values, same isolated-
service pattern as tax_engine.py/payroll_engine.py. Money composition
(subtotal/tax/line totals) reuses tax_engine.calculate_tax() directly in the
routers; what's isolated here is genuinely its own arithmetic: the
Paid/Part-Paid/Unpaid status rule (A276, this phase's literal acceptance
gate) and the ageing-bucket classification shared by both Invoice and
Purchase Bill list screens (A199c: "same shape now built symmetrically...
so payables and receivables are never asymmetric").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


def resolve_purchase_bill_status(amount_paid: Decimal, withholding_amount: Decimal, total_amount: Decimal) -> str:
    """A276, rule 3, verbatim: "the bill reaches Paid when payments +
    withholding = Total — comparing payments to Total alone strands every
    withheld bill at Part-Paid forever." Never returns DRAFT/SENT — Purchase
    Bill has no such states (13-purchase-bill-module.md §2.2: "status is an
    inference, no Draft/Sent").
    """
    settled = amount_paid + withholding_amount
    if settled <= 0:
        return "UNPAID"
    if settled >= total_amount:
        return "PAID"
    return "PART_PAID"


def resolve_invoice_status_after_payment(amount_received: Decimal, withheld_total: Decimal, claim_amount: Decimal) -> str:
    """Invoice §2.3/Appendix B: "an invoice reaches Paid when amount_received
    + withheld_total = claim_amount, NOT when amount_received = grand_total"
    — Claim = Grand Total minus approved Credit Notes. Only ever called after
    Sent (Draft->Sent is a separate, explicit action, never payment-derived);
    the floor this function returns is SENT, never DRAFT, since a payment
    can only be recorded against an already-Sent invoice in the first place.
    """
    settled = amount_received + withheld_total
    if settled <= 0:
        return "SENT"
    if settled >= claim_amount:
        return "PAID"
    return "PART_PAID"


def apply_paid_confirmation_gate(resolved_status: str, toggle_enabled: bool) -> str:
    """Invoice §6.2 "Require Second Approval Before an Invoice Locks as
    Paid" — OFF (the default): unchanged, PAID locks the moment the balance
    is settled. ON: a status that would land on PAID instead lands on
    PEND_PAID (not locked — is_locked is still `status = 'PAID'` only) until
    Super Admin calls POST /invoices/{id}/confirm-paid. Applied identically
    at all three places an invoice can newly reach PAID — record_payment,
    update_invoice (an edit that shrinks the total), and Credit Note
    approval — so the gate can't be bypassed by picking a different path.
    """
    if resolved_status == "PAID" and toggle_enabled:
        return "PEND_PAID"
    return resolved_status


@dataclass(frozen=True)
class StatementLine:
    date: date
    description: str
    bank_account: str | None
    reference: str
    debit: Decimal
    running_balance: Decimal


def build_bank_statement(rows: list[tuple[date, str, str | None, str, Decimal]]) -> list[StatementLine]:
    """Expense §2.1/§2.4 Export Statement: Date (ascending), Description,
    Bank Account, Reference, Debit, Running Balance. "There is NO Credit
    column — an expense never adds to a balance" (Appendix B, verbatim) —
    every row is a debit, opening balance 0, and the running total is purely
    a cumulative sum down the already-filtered, already-sorted rows. This is
    the reconciliation this phase's acceptance gate names ("bank-statement
    export reconciles") — kept pure/isolated/tested so the arithmetic can
    never silently drift from what the caller actually fetched.
    """
    ordered = sorted(rows, key=lambda r: r[0])
    balance = Decimal("0")
    lines = []
    for entry_date, description, bank_account, reference, debit in ordered:
        balance += debit
        lines.append(StatementLine(entry_date, description, bank_account, reference, debit, balance))
    return lines


@dataclass(frozen=True)
class AgeingBucket:
    label: str
    days_overdue: int


def ageing_bucket(due_date: date | None, as_of: date, is_settled: bool) -> AgeingBucket | None:
    """Current / 1-30 / 31-60 / 61-90 / 90+ days overdue (A199c, built
    identically for Invoice and Purchase Bill). No Due Date means never
    Overdue (Invoice §2.3's own explicit rule) — returns None, same as an
    already-fully-settled document (Paid/settled documents don't age).
    """
    if due_date is None or is_settled:
        return None
    days_overdue = (as_of - due_date).days
    if days_overdue <= 0:
        return AgeingBucket("Current", max(days_overdue, 0))
    # QUEUED / NOT BUILT — §6 names "ageing buckets" explicitly among the
    # date rules that must be configurable ("pay cycle cutoff and credit
    # day, leave year boundaries, probation duration, notice period, ageing
    # buckets, due-date terms — all configurable"), so these 30/60/90-day
    # boundaries are a confirmed §6 gap, not an approved exception. Not
    # fixed here because there is currently nothing real to point it at:
    # unlike financial_year_id (a genuine FK to the financial_years table,
    # models/numbering.py), there is no Masters table for ageing-bucket
    # boundaries anywhere in backend/app/models — no model, no migration,
    # no /masters/* route to list or edit one. Rewriting this as a loop over
    # "configured buckets" now would mean inventing that table's shape from
    # scratch with nothing to confirm it against. What would need to exist
    # first: a Masters → Finance Settings (or similar) table holding an
    # ordered list of {label, max_days_overdue} rows, seeded by default with
    # exactly this 30/60/90/90+ shape (per §6's own guidance that empty/
    # default configuration should reproduce current behaviour), plus a
    # GET/PUT route for Super Admin to edit it, before this function can
    # iterate that list instead of comparing against literals. Both callers
    # (api/v1/invoices.py, api/v1/purchase_bills.py) would keep working
    # unchanged since they only consume the returned AgeingBucket.
    if days_overdue <= 30:
        return AgeingBucket("1-30", days_overdue)
    if days_overdue <= 60:
        return AgeingBucket("31-60", days_overdue)
    if days_overdue <= 90:
        return AgeingBucket("61-90", days_overdue)
    return AgeingBucket("90+", days_overdue)
