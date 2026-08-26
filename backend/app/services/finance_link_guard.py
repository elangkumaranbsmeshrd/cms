"""The Expense-Claim <-> Purchase-Bill link's actual double-payment
PREVENTION (not just the 1:1 uniqueness the DB guards) — Phase 4's literal
acceptance gate (BUILD-PROMPT §13: "expense ↔ purchase-bill link prevents
double payment"). Every source doc describes the link as informational
("each shows the other," "settle as a single amount") with no DB mechanism
that actually blocks recording both sides — a genuine, flagged gap (both
research passes converged on it independently). This is the deliberate
addition that closes it: reused identically by both
`payroll_bill_payments`'s record-payment endpoint and
`expense_reimbursements`'s mark-as-reimbursed endpoint, so a linked pair can
never both carry a live payment at once without an explicit reason.

DB-touching (reads existing payment/reimbursement rows), same category as
org_scope.py/policy_resolution.py/hour_reconciliation.py — not a trigger,
because the check itself is a real business-rule read, not a simple
universal invariant.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import ExpenseClaim, ExpenseReimbursement, PurchaseBill, PurchaseBillPayment


async def check_purchase_bill_payment_guard(db: AsyncSession, bill: PurchaseBill) -> str | None:
    """Called before recording a NEW payment against `bill`. Returns a
    block-reason string if `bill.linked_expense_claim_id` already has a live
    (non-reversed) reimbursement recorded — paying the bill too would settle
    the same spend twice. Returns None (clear to proceed) if unlinked, or if
    the linked claim has no live reimbursement yet.
    """
    if bill.linked_expense_claim_id is None:
        return None
    live_reimbursement = (
        await db.execute(
            select(ExpenseReimbursement.id).where(
                ExpenseReimbursement.expense_claim_id == bill.linked_expense_claim_id,
                ExpenseReimbursement.status == "RECORDED",
            )
        )
    ).first()
    if live_reimbursement is not None:
        return (
            "This bill is linked to an Expense Claim that has already been reimbursed — "
            "paying the bill too would settle the same spend twice. Reverse the reimbursement "
            "first if the bill genuinely needs to be paid separately, or remove the link."
        )
    return None


async def check_expense_reimbursement_guard(db: AsyncSession, claim: ExpenseClaim) -> str | None:
    """The mirror check, called before reimbursing `claim`: blocks if its
    linked Purchase Bill already has a live (non-reversed) payment recorded.
    """
    if claim.linked_purchase_bill_id is None:
        return None
    live_payment = (
        await db.execute(
            select(PurchaseBillPayment.id).where(
                PurchaseBillPayment.purchase_bill_id == claim.linked_purchase_bill_id,
                PurchaseBillPayment.status == "RECORDED",
            )
        )
    ).first()
    if live_payment is not None:
        return (
            "This claim is linked to a Purchase Bill that has already been paid — "
            "reimbursing the claim too would settle the same spend twice. Reverse the payment "
            "first if the claim genuinely needs to be reimbursed separately, or remove the link."
        )
    return None
