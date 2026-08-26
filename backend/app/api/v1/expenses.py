"""Expense (12-expense-module.md) — My Expenses (§2.1, own baseline for
every role), Expense Approvals (§2.2), All Expenses/Summary + Mark as
Reimbursed (§2.3), Company Expenses (§2.4, its own screen — never a filter
on §2.3, Appendix B verbatim).

CLAIM TYPE SPLIT (Appendix B, verbatim): "Claim Type is derived read-only
from the Expense Type and is NEVER chosen separately. Reimbursable = enters
the reimbursement queue... Company-Paid = skips that queue entirely... and
appears NOWHERE in the reimbursement flow." Enforced in create_expense_claim
below: a Company-Paid Expense Type auto-routes straight into
company_expenses, never touching expense_claims' own approval queue.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.finance import CompanyExpense, ExpenseClaim, ExpenseReimbursement, PurchaseBill
from app.models.masters import ExpenseType, TaxHead
from app.models.platform import User
from app.models.rbac import FeatureToggle, Role
from app.models.vendor import Vendor
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.finance import (
    CompanyExpenseCreate,
    CompanyExpenseOut,
    ExpenseClaimCreate,
    ExpenseClaimOut,
    ExpenseReimburseRequest,
    ExpenseReimbursementOut,
    ExpenseRejectRequest,
)
from app.services import list_export, org_scope
from app.services.finance_engine import build_bank_statement
from app.services.finance_link_guard import check_expense_reimbursement_guard
from app.services.notify import notify
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec
from app.services.tax_head_lookup import validate_head_usable

_MY_EXPENSES_COLUMNS = [
    ColumnSpec("expense_type", "Expense Type"),
    ColumnSpec("vendor", "Vendor"),
    ColumnSpec("expense_date", "Date"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]

_APPROVALS_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("expense_type", "Expense Type"),
    ColumnSpec("vendor", "Vendor"),
    ColumnSpec("expense_date", "Date"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]

_ALL_EXPENSES_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("expense_type", "Expense Type"),
    ColumnSpec("vendor", "Vendor"),
    ColumnSpec("expense_date", "Date"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]

_COMPANY_EXPENSES_COLUMNS = [
    ColumnSpec("vendor", "Vendor"),
    ColumnSpec("expense_type", "Expense Type"),
    ColumnSpec("expense_date", "Date"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]

_STATEMENT_COLUMNS = [
    ColumnSpec("date", "Date"),
    ColumnSpec("description", "Description"),
    ColumnSpec("bank_account", "Bank Account"),
    ColumnSpec("reference", "Reference"),
    ColumnSpec("debit", "Debit", align="left"),
    ColumnSpec("running_balance", "Running Balance", align="left"),
]

router = APIRouter(tags=["expense"])


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _toggle_numeric_value(db: AsyncSession, toggle_key: str) -> Decimal | None:
    return (await db.execute(select(FeatureToggle.numeric_value).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()


async def _employee_reporting_manager_id(db: AsyncSession, employee_id: str) -> str | None:
    from app.models.employee import Employee

    return (await db.execute(select(Employee.reporting_manager_id).where(Employee.id == employee_id))).scalar_one_or_none()


async def _manager_approval_required(db: AsyncSession, claim: ExpenseClaim) -> bool:
    """§6.1 "Allow Manager to Approve Their Team's Expenses" — ON gates
    Accountant's own approve() behind a prior manager sign-off, UNLESS the
    claimant has no reporting manager assigned at all, in which case the
    step is skipped rather than permanently deadlocking the claim (the same
    "narrow to what actually applies, never strand a record with no valid
    path forward" reasoning project.py's own Manager-restriction toggle and
    leave_engine.resolve_routing's HR-unavailable fallback both use).
    """
    if not await _toggle_enabled(db, "Allow Manager to Approve Their Team's Expenses"):
        return False
    manager_id = await _employee_reporting_manager_id(db, claim.employee_id)
    return manager_id is not None


async def _employee_names(db: AsyncSession, employee_ids: set[str]) -> dict[str, str]:
    """Batch first/last-name lookup for export rows — ExpenseClaim (unlike
    Invoice/PurchaseBill) carries no employee_name_snapshot column, so the
    export path resolves names itself rather than adding a schema change
    out of scope for this task.
    """
    if not employee_ids:
        return {}
    from app.models.employee import Employee

    rows = (
        await db.execute(select(Employee.id, Employee.first_name, Employee.last_name).where(Employee.id.in_(employee_ids)))
    ).all()
    return {eid: f"{first} {last or ''}".strip() for eid, first, last in rows}


async def _vendor_names(db: AsyncSession, vendor_ids: set[str]) -> dict[str, str]:
    if not vendor_ids:
        return {}
    rows = (await db.execute(select(Vendor.id, Vendor.vendor_name).where(Vendor.id.in_(vendor_ids)))).all()
    return {vid: name for vid, name in rows}


async def _expense_type_names(db: AsyncSession, expense_type_ids: set[str]) -> dict[str, str]:
    """CompanyExpense (unlike ExpenseClaim) carries no expense_type_name_snapshot either."""
    if not expense_type_ids:
        return {}
    rows = (await db.execute(select(ExpenseType.id, ExpenseType.name).where(ExpenseType.id.in_(expense_type_ids)))).all()
    return {tid: name for tid, name in rows}


# ============================================================= MY EXPENSES
@router.get("/expenses/me", response_model=None)
async def list_my_expenses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.my_expenses")),
    status_filter: list[str] | None = Query(None, alias="status"),
    expense_type_id: str | None = Query(None),
    vendor_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    bank_account_id: str | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    has_receipt: bool | None = Query(None),
    search: str | None = Query(None, description="Matches Description, Expense Type"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ExpenseClaimOut] | Response:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    stmt = select(ExpenseClaim).where(ExpenseClaim.employee_id == own_id)
    if status_filter:
        stmt = stmt.where(ExpenseClaim.status.in_(status_filter))
    if expense_type_id:
        stmt = stmt.where(ExpenseClaim.expense_type_id == expense_type_id)
    if vendor_id:
        stmt = stmt.where(ExpenseClaim.vendor_id == vendor_id)
    if financial_year_id:
        stmt = stmt.where(ExpenseClaim.financial_year_id == financial_year_id)
    if bank_account_id:
        stmt = stmt.where(ExpenseClaim.bank_account_id == bank_account_id)
    if date_from:
        stmt = stmt.where(ExpenseClaim.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(ExpenseClaim.expense_date <= date_to)
    if amount_min is not None:
        stmt = stmt.where(ExpenseClaim.amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(ExpenseClaim.amount <= amount_max)
    if has_receipt is not None:
        stmt = stmt.where(ExpenseClaim.has_receipt == has_receipt)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(ExpenseClaim.description.ilike(pattern) | ExpenseClaim.expense_type_name_snapshot.ilike(pattern))
    rows = (await db.execute(stmt.order_by(ExpenseClaim.expense_date.desc()))).scalars().all()

    if format:
        vendor_names = await _vendor_names(db, {c.vendor_id for c in rows if c.vendor_id})
        export_rows = [
            {
                "expense_type": c.expense_type_name_snapshot,
                "vendor": vendor_names.get(c.vendor_id) if c.vendor_id else None,
                "expense_date": c.expense_date, "amount": c.amount, "status": c.status,
            }
            for c in rows
        ]
        filters_applied = {
            "status": status_filter, "expense_type_id": expense_type_id, "vendor_id": vendor_id,
            "financial_year_id": financial_year_id, "bank_account_id": bank_account_id,
            "date_from": date_from, "date_to": date_to, "amount_min": amount_min, "amount_max": amount_max,
            "has_receipt": has_receipt, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "My Expenses", _MY_EXPENSES_COLUMNS, export_rows, filters_applied)

    return [ExpenseClaimOut.model_validate(c) for c in rows]


@router.post("/expenses", response_model=ExpenseClaimOut, status_code=status.HTTP_201_CREATED)
async def create_expense_claim(
    body: ExpenseClaimCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.my_expenses")),
) -> ExpenseClaimOut:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    if body.expense_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Expense Date cannot be in the future")

    expense_type = await db.get(ExpenseType, body.expense_type_id)
    if expense_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense Type not found")
    if body.tax_head_id is not None:
        tax_head = await db.get(TaxHead, body.tax_head_id)
        if tax_head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
        block_reason = await validate_head_usable(db, tax_head, ("PURCHASE", "SALES_AND_PURCHASE"), body.expense_date)
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
    fy = await get_current_financial_year(db)

    linked_bill = None
    if body.linked_purchase_bill_id is not None:
        linked_bill = await db.get(PurchaseBill, body.linked_purchase_bill_id)
        if linked_bill is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Linked Purchase Bill not found")
        if linked_bill.linked_expense_claim_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="That Purchase Bill is already linked to a different Expense Claim")

    if body.vendor_id is not None:
        vendor_check = await db.get(Vendor, body.vendor_id)
        if vendor_check is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vendor not found")
        if not vendor_check.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This Vendor is deactivated and cannot be selected on a new claim")

    if expense_type.claim_type == "COMPANY_PAID":
        # §2.1 field table, verbatim: "Company-Paid types are listed only
        # for Super Admin and Accountant" — the dropdown-visibility rule
        # this backend enforces server-side, same as every other role gate
        # in this codebase (the API is the authority, not the frontend).
        role = await db.get(Role, current_user.role_id)
        if role.code not in ("SUPER_ADMIN", "ACCOUNTANT"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only Super Admin and Accountant may raise a Company-Paid expense")
        # Never enters the reimbursement queue — routed straight into
        # company_expenses, one-way linked back via source_expense_claim_id.
        claim = ExpenseClaim(
            id=str(uuid.uuid4()), employee_id=own_id, financial_year_id=fy.id, expense_type_id=expense_type.id,
            claim_type="COMPANY_PAID", expense_type_name_snapshot=expense_type.name, expense_type_short_code_snapshot=expense_type.short_code,
            is_recurring_type_snapshot=expense_type.is_recurring, vendor_id=body.vendor_id, amount=body.amount, tax_head_id=body.tax_head_id,
            tax_amount=body.tax_amount, expense_date=body.expense_date, linked_purchase_bill_id=body.linked_purchase_bill_id,
            description=body.description, receipt_stored_file_id=body.receipt_stored_file_id, status="PENDING",
            submitted_at=datetime.now(timezone.utc), created_by=current_user.id, updated_by=current_user.id,
        )
        db.add(claim)
        await db.flush()
        company_row = CompanyExpense(
            id=str(uuid.uuid4()), financial_year_id=fy.id, expense_type_id=expense_type.id, vendor_id=body.vendor_id,
            linked_purchase_bill_id=body.linked_purchase_bill_id, source_expense_claim_id=claim.id, amount=body.amount,
            tax_head_id=body.tax_head_id, tax_amount=body.tax_amount, expense_date=body.expense_date, description=body.description,
            bill_stored_file_id=body.receipt_stored_file_id, status="PENDING", created_by=current_user.id, updated_by=current_user.id,
        )
        db.add(company_row)
        # The double-payment guard/two-way link and vendor usage rollup are
        # not Reimbursable-specific — a Company-Paid claim spending against
        # the same vendor bill needs the identical protection.
        if linked_bill is not None:
            linked_bill.linked_expense_claim_id = claim.id
            linked_bill.updated_by = current_user.id
        if body.vendor_id is not None:
            vendor = await db.get(Vendor, body.vendor_id)
            if vendor is not None:
                vendor.expense_count += 1
                vendor.has_usage_history = True
                vendor.updated_by = current_user.id
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Rejected by a database constraint") from exc
        await db.refresh(claim)
        return claim

    # §6.1 "Set an Auto-Approval Threshold" — OFF by default (every claim
    # needs manual approval, unchanged). ON: a claim at or under the
    # configured amount skips Pending (and, by the same logic, the manager
    # sign-off step above it) and lands directly on Approved — "under a set
    # amount... approve automatically," not "approve automatically but
    # still needs a manager first." approved_by stays null: nobody actually
    # approved it, the threshold did, and that's honestly what null means
    # here rather than attributing it to whoever happened to submit it.
    auto_status = "PENDING"
    auto_approved_at = None
    threshold = await _toggle_numeric_value(db, "Set an Auto-Approval Threshold")
    if await _toggle_enabled(db, "Set an Auto-Approval Threshold") and threshold is not None and body.amount <= threshold:
        auto_status = "APPROVED"
        auto_approved_at = datetime.now(timezone.utc)

    claim = ExpenseClaim(
        id=str(uuid.uuid4()), employee_id=own_id, financial_year_id=fy.id, expense_type_id=expense_type.id,
        claim_type="REIMBURSABLE", expense_type_name_snapshot=expense_type.name, expense_type_short_code_snapshot=expense_type.short_code,
        is_recurring_type_snapshot=expense_type.is_recurring, vendor_id=body.vendor_id, amount=body.amount, tax_head_id=body.tax_head_id,
        tax_amount=body.tax_amount, expense_date=body.expense_date, linked_purchase_bill_id=body.linked_purchase_bill_id,
        description=body.description, receipt_stored_file_id=body.receipt_stored_file_id, status=auto_status,
        approved_at=auto_approved_at, submitted_at=datetime.now(timezone.utc), created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(claim)
    if linked_bill is not None:
        linked_bill.linked_expense_claim_id = claim.id
        linked_bill.updated_by = current_user.id
    if body.vendor_id is not None:
        vendor = await db.get(Vendor, body.vendor_id)
        if vendor is not None:
            vendor.expense_count += 1
            vendor.has_usage_history = True
            vendor.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(claim)
    return claim


@router.get("/expenses/export-statement", response_model=None)
async def my_expense_statement(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.my_expenses")),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.1 Export Statement — Date/Description/Bank Account/Reference/
    Debit/Running Balance. Only Reimbursed rows carry a Bank Account and
    count toward the running balance (Appendix B, verbatim); Pending/
    Approved/Rejected export with a blank Bank Account and are excluded.
    """
    from app.models.masters import BankAccount

    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    stmt = select(ExpenseClaim).where(ExpenseClaim.employee_id == own_id, ExpenseClaim.status == "REIMBURSED")
    if date_from:
        stmt = stmt.where(ExpenseClaim.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(ExpenseClaim.expense_date <= date_to)
    claims = (await db.execute(stmt)).scalars().all()

    rows = []
    for claim in claims:
        bank_name = None
        if claim.bank_account_id is not None:
            account = await db.get(BankAccount, claim.bank_account_id)
            bank_name = account.nickname if account else None
        reference = claim.id if claim.linked_purchase_bill_id is None else f"{claim.id} / {claim.linked_purchase_bill_id}"
        rows.append((claim.expense_date, f"{claim.expense_type_name_snapshot}: {claim.description}", bank_name, reference, claim.amount))

    statement_rows = [
        {"date": l.date, "description": l.description, "bank_account": l.bank_account, "reference": l.reference, "debit": l.debit, "running_balance": l.running_balance}
        for l in build_bank_statement(rows)
    ]

    if format:
        filters_applied = {"date_from": date_from, "date_to": date_to}
        return await list_export.build_export(format, db, current_user, "My Expense Statement", _STATEMENT_COLUMNS, statement_rows, filters_applied)

    return statement_rows


# ============================================================= APPROVALS
@router.get("/expenses/approvals", response_model=None)
async def list_pending_approvals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.approvals")),
    employee_id: str | None = Query(None),
    expense_type_id: str | None = Query(None),
    vendor_id: str | None = Query(None),
    department_id: str | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    submitted_from: date_type | None = Query(None),
    submitted_to: date_type | None = Query(None),
    has_receipt: bool | None = Query(None),
    pending_days: int | None = Query(None, description="Submitted at least N days ago, still awaiting a decision"),
    search: str | None = Query(None, description="Matches Description, Expense Type"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ExpenseClaimOut] | Response:
    # §6.1's Manager-approve toggle widens this screen to MANAGER at mode
    # 'team' (rbac/toggles.py) — scoped here to direct reports only, the
    # same team-scoping convention every other 'team'-mode screen uses. PENDING
    # + MGR_APPROVED are both "still needs someone to act" — a Manager sees
    # only PENDING (their own sign-off step); Accountant/Super Admin see
    # both, since MGR_APPROVED claims are exactly the ones now waiting on
    # THEIR final approve().
    is_manager_scoped = perms.role_code == "MANAGER" and perms.mode == "team"
    statuses = ["PENDING"] if is_manager_scoped else ["PENDING", "MGR_APPROVED"]
    stmt = select(ExpenseClaim).where(ExpenseClaim.status.in_(statuses), ExpenseClaim.claim_type == "REIMBURSABLE")
    if is_manager_scoped:
        own_id = await org_scope.get_own_employee_id(db, current_user)
        direct_reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = stmt.where(ExpenseClaim.employee_id.in_(direct_reports)) if direct_reports else stmt.where(ExpenseClaim.id.is_(None))
    if employee_id:
        stmt = stmt.where(ExpenseClaim.employee_id == employee_id)
    if expense_type_id:
        stmt = stmt.where(ExpenseClaim.expense_type_id == expense_type_id)
    if vendor_id:
        stmt = stmt.where(ExpenseClaim.vendor_id == vendor_id)
    if department_id:
        from app.models.employee import Employee

        dept_employee_ids = (await db.execute(select(Employee.id).where(Employee.department_id == department_id))).scalars().all()
        stmt = stmt.where(ExpenseClaim.employee_id.in_(dept_employee_ids)) if dept_employee_ids else stmt.where(ExpenseClaim.id.is_(None))
    if amount_min is not None:
        stmt = stmt.where(ExpenseClaim.amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(ExpenseClaim.amount <= amount_max)
    if submitted_from:
        stmt = stmt.where(ExpenseClaim.submitted_at >= submitted_from)
    if submitted_to:
        stmt = stmt.where(ExpenseClaim.submitted_at < submitted_to + timedelta(days=1))
    if has_receipt is not None:
        stmt = stmt.where(ExpenseClaim.has_receipt == has_receipt)
    if pending_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=pending_days)
        stmt = stmt.where(ExpenseClaim.submitted_at <= cutoff)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(ExpenseClaim.description.ilike(pattern) | ExpenseClaim.expense_type_name_snapshot.ilike(pattern))
    rows = (await db.execute(stmt.order_by(ExpenseClaim.submitted_at))).scalars().all()

    if format:
        emp_names = await _employee_names(db, {c.employee_id for c in rows})
        vendor_names = await _vendor_names(db, {c.vendor_id for c in rows if c.vendor_id})
        export_rows = [
            {
                "employee": emp_names.get(c.employee_id), "expense_type": c.expense_type_name_snapshot,
                "vendor": vendor_names.get(c.vendor_id) if c.vendor_id else None,
                "expense_date": c.expense_date, "amount": c.amount, "status": c.status,
            }
            for c in rows
        ]
        filters_applied = {
            "employee_id": employee_id, "expense_type_id": expense_type_id, "vendor_id": vendor_id,
            "department_id": department_id, "amount_min": amount_min, "amount_max": amount_max,
            "submitted_from": submitted_from, "submitted_to": submitted_to, "has_receipt": has_receipt,
            "pending_days": pending_days, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Expense Approvals", _APPROVALS_COLUMNS, export_rows, filters_applied)

    return [ExpenseClaimOut.model_validate(c) for c in rows]


# §6.1's three toggles, all built now (were name-only in TOGGLE_DEFAULTS
# with zero gate wiring — none of the generic mechanisms fit: ACTION_TOGGLE_
# GATES only ever ADDS an action, never blocks one; FeatureToggle needed a
# numeric_value column for the threshold; ExpenseClaim needed a real
# intermediate status for the manager step). Applied directly in the route
# bodies below, the same bespoke-toggle-check pattern every other module's
# non-mode/non-action toggle in this codebase uses:
#   - "Require a Receipt Before Approval" — checked in both approve() and
#     manager_approve() below (a manager shouldn't be able to sign off on a
#     receiptless claim any more than Accountant should).
#   - "Set an Auto-Approval Threshold" — checked at submission
#     (create_expense_claim, above), not here — a claim that auto-approved
#     never reaches this queue.
#   - "Allow Manager to Approve Their Team's Expenses" — checked in
#     approve() via _manager_approval_required(); the new manager_approve()
#     endpoint below is that sign-off step itself.
async def _assert_receipt_present_if_required(db: AsyncSession, claim: ExpenseClaim) -> None:
    if await _toggle_enabled(db, "Require a Receipt Before Approval") and not claim.has_receipt:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A receipt must be attached before this claim can be approved")


@router.post("/expenses/{claim_id}/manager-approve", response_model=ExpenseClaimOut)
async def manager_approve_expense_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.approvals", action="manager_approve")),
) -> ExpenseClaim:
    """§6.1 "Allow Manager to Approve Their Team's Expenses" — the sign-off
    step itself, before Accountant's own final approve(). Only reachable at
    all when the toggle is on (manager_approve is ACTION_TOGGLE_GATES-gated
    to MANAGER, rbac/toggles.py) — but still re-checked here, since the
    toggle could be switched off between the button rendering and the click.
    """
    if not await _toggle_enabled(db, "Allow Manager to Approve Their Team's Expenses"):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    claim = await db.get(ExpenseClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    direct_reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
    if claim.employee_id not in direct_reports:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
    if claim.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending claim can receive manager sign-off")
    await _assert_receipt_present_if_required(db, claim)

    claim.status = "MGR_APPROVED"
    claim.manager_approved_by = current_user.id
    claim.manager_approved_at = datetime.now(timezone.utc)
    claim.updated_by = current_user.id
    await db.commit()
    await db.refresh(claim)
    return claim


@router.post("/expenses/{claim_id}/approve", response_model=ExpenseClaimOut)
async def approve_expense_claim(
    claim_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.approvals", action="approve")),
) -> ExpenseClaim:
    claim = await db.get(ExpenseClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if await _manager_approval_required(db, claim):
        if claim.status != "MGR_APPROVED":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This claim needs its manager's sign-off before Accountant can approve it")
    elif claim.status not in ("PENDING", "MGR_APPROVED"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending claim can be approved")
    await _assert_receipt_present_if_required(db, claim)

    claim.status = "APPROVED"
    claim.approved_by = current_user.id
    claim.approved_at = datetime.now(timezone.utc)
    claim.updated_by = current_user.id

    employee = await _get_employee_user(db, claim.employee_id)
    notify(db, recipient_user_id=employee, notification_type="EXPENSE", actor_user_id=current_user.id,
           title="Expense claim approved", body=f"Your claim for {claim.amount} has been approved.", source_module="expense", source_record_id=claim.id)

    await db.commit()
    await db.refresh(claim)
    return claim


@router.post("/expenses/{claim_id}/reject", response_model=ExpenseClaimOut)
async def reject_expense_claim(
    claim_id: str,
    body: ExpenseRejectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.approvals", action="reject")),
) -> ExpenseClaim:
    claim = await db.get(ExpenseClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # A claim waiting on Accountant's final decision — whether it got there
    # straight from Pending or via a manager's sign-off — can always be
    # rejected outright; only approving is gated behind the manager step,
    # never the more conservative rejecting.
    if claim.status not in ("PENDING", "MGR_APPROVED"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending claim can be rejected")
    if not body.rejection_reason.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject a claim")
    claim.status = "REJECTED"
    claim.rejected_by = current_user.id
    claim.rejected_at = datetime.now(timezone.utc)
    claim.rejection_reason = body.rejection_reason
    claim.updated_by = current_user.id

    employee = await _get_employee_user(db, claim.employee_id)
    notify(db, recipient_user_id=employee, notification_type="EXPENSE", actor_user_id=current_user.id,
           title="Expense claim rejected", body=f"Your claim for {claim.amount} was rejected: {body.rejection_reason}", source_module="expense", source_record_id=claim.id)

    await db.commit()
    await db.refresh(claim)
    return claim


async def _get_employee_user(db: AsyncSession, employee_id: str) -> str | None:
    from app.models.employee import Employee

    employee = await db.get(Employee, employee_id)
    return employee.user_id if employee else None


# ========================================================= ALL EXPENSES
@router.get("/expenses", response_model=None)
async def list_all_expenses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.all_expenses")),
    employee_id: str | None = Query(None),
    department_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    expense_type_id: str | None = Query(None),
    vendor_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    bank_account_id: str | None = Query(None),
    approved_by: str | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    approved_from: date_type | None = Query(None),
    approved_to: date_type | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    has_receipt: bool | None = Query(None),
    pending_days: int | None = Query(None, description="Still Pending, submitted at least N days ago"),
    search: str | None = Query(None, description="Matches Description, Expense Type"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ExpenseClaimOut] | Response:
    stmt = select(ExpenseClaim).where(ExpenseClaim.claim_type == "REIMBURSABLE")
    if employee_id:
        stmt = stmt.where(ExpenseClaim.employee_id == employee_id)
    if department_id:
        from app.models.employee import Employee

        dept_employee_ids = (await db.execute(select(Employee.id).where(Employee.department_id == department_id))).scalars().all()
        stmt = stmt.where(ExpenseClaim.employee_id.in_(dept_employee_ids)) if dept_employee_ids else stmt.where(ExpenseClaim.id.is_(None))
    if status_filter:
        stmt = stmt.where(ExpenseClaim.status.in_(status_filter))
    if expense_type_id:
        stmt = stmt.where(ExpenseClaim.expense_type_id == expense_type_id)
    if vendor_id:
        stmt = stmt.where(ExpenseClaim.vendor_id == vendor_id)
    if financial_year_id:
        stmt = stmt.where(ExpenseClaim.financial_year_id == financial_year_id)
    if bank_account_id:
        stmt = stmt.where(ExpenseClaim.bank_account_id == bank_account_id)
    if approved_by:
        stmt = stmt.where(ExpenseClaim.approved_by == approved_by)
    if date_from:
        stmt = stmt.where(ExpenseClaim.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(ExpenseClaim.expense_date <= date_to)
    if approved_from:
        stmt = stmt.where(ExpenseClaim.approved_at >= approved_from)
    if approved_to:
        stmt = stmt.where(ExpenseClaim.approved_at < approved_to + timedelta(days=1))
    if amount_min is not None:
        stmt = stmt.where(ExpenseClaim.amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(ExpenseClaim.amount <= amount_max)
    if has_receipt is not None:
        stmt = stmt.where(ExpenseClaim.has_receipt == has_receipt)
    if pending_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=pending_days)
        stmt = stmt.where(ExpenseClaim.status == "PENDING", ExpenseClaim.submitted_at <= cutoff)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(ExpenseClaim.description.ilike(pattern) | ExpenseClaim.expense_type_name_snapshot.ilike(pattern))
    rows = (await db.execute(stmt.order_by(ExpenseClaim.expense_date.desc()))).scalars().all()

    if format:
        emp_names = await _employee_names(db, {c.employee_id for c in rows})
        vendor_names = await _vendor_names(db, {c.vendor_id for c in rows if c.vendor_id})
        export_rows = [
            {
                "employee": emp_names.get(c.employee_id), "expense_type": c.expense_type_name_snapshot,
                "vendor": vendor_names.get(c.vendor_id) if c.vendor_id else None,
                "expense_date": c.expense_date, "amount": c.amount, "status": c.status,
            }
            for c in rows
        ]
        filters_applied = {
            "employee_id": employee_id, "department_id": department_id, "status": status_filter, "expense_type_id": expense_type_id,
            "vendor_id": vendor_id, "financial_year_id": financial_year_id, "bank_account_id": bank_account_id, "approved_by": approved_by,
            "date_from": date_from, "date_to": date_to, "approved_from": approved_from, "approved_to": approved_to,
            "amount_min": amount_min, "amount_max": amount_max, "has_receipt": has_receipt, "pending_days": pending_days, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "All Expenses", _ALL_EXPENSES_COLUMNS, export_rows, filters_applied)

    return [ExpenseClaimOut.model_validate(c) for c in rows]


@router.get("/expenses/summary")
async def expense_summary(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("expense.all_expenses")),
) -> dict:
    """§2.3, verbatim: "total spend by Expense Type, and total spend by
    month — simple totals, not a full analytics dashboard... 'spend' here
    means Approved + Reimbursed combined (money committed to), with a
    separate, smaller figure for Reimbursed-only (money actually paid out),
    so the two aren't conflated." One of this screen's three named
    capabilities ("All Expenses / Summary") — not a deferred filter/export.
    """
    rows = (
        await db.execute(select(ExpenseClaim).where(ExpenseClaim.claim_type == "REIMBURSABLE", ExpenseClaim.status.in_(("APPROVED", "REIMBURSED"))))
    ).scalars().all()

    by_type: dict[str, Decimal] = {}
    by_month: dict[str, Decimal] = {}
    reimbursed_only = Decimal("0")
    for claim in rows:
        by_type[claim.expense_type_name_snapshot] = by_type.get(claim.expense_type_name_snapshot, Decimal("0")) + claim.amount
        month_key = claim.expense_date.strftime("%Y-%m")
        by_month[month_key] = by_month.get(month_key, Decimal("0")) + claim.amount
        if claim.status == "REIMBURSED":
            reimbursed_only += claim.amount

    return {
        "total_spend": sum(by_type.values(), Decimal("0")),
        "total_reimbursed": reimbursed_only,
        "by_expense_type": [{"expense_type": k, "amount": v} for k, v in sorted(by_type.items())],
        "by_month": [{"month": k, "amount": v} for k, v in sorted(by_month.items())],
    }


@router.post("/expenses/{claim_id}/mark-reimbursed", response_model=ExpenseReimbursementOut, status_code=status.HTTP_201_CREATED)
async def mark_reimbursed(
    claim_id: str,
    body: ExpenseReimburseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.all_expenses", action="mark_reimbursed")),
) -> ExpenseReimbursement:
    claim = await db.get(ExpenseClaim, claim_id)
    if claim is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if claim.status != "APPROVED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Mark as Reimbursed is only available on an Approved claim")

    block_reason = await check_expense_reimbursement_guard(db, claim)
    if block_reason is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=block_reason)

    reimbursement = ExpenseReimbursement(
        id=str(uuid.uuid4()), expense_claim_id=claim.id, financial_year_id=claim.financial_year_id, reimbursed_date=body.reimbursed_date,
        amount=claim.amount, payment_mode_id=body.payment_mode_id, reimbursed_from_bank_account_id=body.reimbursed_from_bank_account_id,
        reference=body.reference, reimbursed_by=current_user.id, reimbursed_at=datetime.now(timezone.utc),
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(reimbursement)

    claim.status = "REIMBURSED"
    claim.bank_account_id = body.reimbursed_from_bank_account_id
    claim.reimbursed_at = reimbursement.reimbursed_at
    claim.updated_by = current_user.id

    employee = await _get_employee_user(db, claim.employee_id)
    notify(db, recipient_user_id=employee, notification_type="EXPENSE", actor_user_id=current_user.id,
           title="Expense reimbursed", body=f"Your claim for {claim.amount} has been reimbursed.", source_module="expense", source_record_id=claim.id)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(reimbursement)
    return reimbursement


# ======================================================== COMPANY EXPENSES
@router.get("/company-expenses", response_model=None)
async def list_company_expenses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.company")),
    status_filter: list[str] | None = Query(None, alias="status"),
    expense_type_id: str | None = Query(None),
    vendor_id: str | None = Query(None),
    paid_from_bank_account_id: str | None = Query(None),
    billing_period_month: int | None = Query(None),
    billing_period_year: int | None = Query(None),
    search: str | None = Query(None, description="Matches Description"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CompanyExpenseOut] | Response:
    stmt = select(CompanyExpense)
    if status_filter:
        stmt = stmt.where(CompanyExpense.status.in_(status_filter))
    if expense_type_id:
        stmt = stmt.where(CompanyExpense.expense_type_id == expense_type_id)
    if vendor_id:
        stmt = stmt.where(CompanyExpense.vendor_id == vendor_id)
    if paid_from_bank_account_id:
        stmt = stmt.where(CompanyExpense.paid_from_bank_account_id == paid_from_bank_account_id)
    if billing_period_month is not None:
        stmt = stmt.where(CompanyExpense.billing_period_month == billing_period_month)
    if billing_period_year is not None:
        stmt = stmt.where(CompanyExpense.billing_period_year == billing_period_year)
    if search:
        stmt = stmt.where(CompanyExpense.description.ilike(f"%{search}%"))
    rows = (await db.execute(stmt.order_by(CompanyExpense.expense_date.desc()))).scalars().all()

    if format:
        vendor_names = await _vendor_names(db, {r.vendor_id for r in rows if r.vendor_id})
        type_names = await _expense_type_names(db, {r.expense_type_id for r in rows})
        export_rows = [
            {
                "vendor": vendor_names.get(r.vendor_id) if r.vendor_id else None,
                "expense_type": type_names.get(r.expense_type_id),
                "expense_date": r.expense_date, "amount": r.amount, "status": r.status,
            }
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "expense_type_id": expense_type_id, "vendor_id": vendor_id,
            "paid_from_bank_account_id": paid_from_bank_account_id, "billing_period_month": billing_period_month,
            "billing_period_year": billing_period_year, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Company Expenses", _COMPANY_EXPENSES_COLUMNS, export_rows, filters_applied)

    return [CompanyExpenseOut.model_validate(r) for r in rows]


@router.post("/company-expenses", response_model=CompanyExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_company_expense(
    body: CompanyExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.company", action="edit")),
) -> CompanyExpense:
    if body.expense_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Expense Date cannot be in the future")
    expense_type = await db.get(ExpenseType, body.expense_type_id)
    if expense_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense Type not found")
    if expense_type.claim_type != "COMPANY_PAID":
        # §2.4: "the type IS the classification" — a Reimbursable type filed
        # here would bypass the reimbursement queue it's supposed to go through.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Company Expenses only accepts Company-Paid Expense Types")
    if body.vendor_id is not None:
        vendor_check = await db.get(Vendor, body.vendor_id)
        if vendor_check is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vendor not found")
        if not vendor_check.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This Vendor is deactivated and cannot be selected on a new expense")
    fy = await get_current_financial_year(db)
    row = CompanyExpense(id=str(uuid.uuid4()), financial_year_id=fy.id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    if body.vendor_id is not None:
        vendor = await db.get(Vendor, body.vendor_id)
        if vendor is not None:
            vendor.expense_count += 1
            vendor.has_usage_history = True
            vendor.updated_by = current_user.id
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.post("/company-expenses/{expense_id}/pay", response_model=CompanyExpenseOut)
async def pay_company_expense(
    expense_id: str,
    paid_from_bank_account_id: str,
    payment_mode_id: str,
    payment_reference: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.company", action="edit")),
) -> CompanyExpense:
    row = await db.get(CompanyExpense, expense_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending company expense can be paid")
    row.status = "PAID"
    row.paid_from_bank_account_id = paid_from_bank_account_id
    row.payment_mode_id = payment_mode_id
    row.payment_reference = payment_reference
    row.paid_on = date_type.today()
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.post("/company-expenses/{expense_id}/cancel", response_model=CompanyExpenseOut)
async def cancel_company_expense(
    expense_id: str,
    cancellation_reason: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.company", action="edit")),
) -> CompanyExpense:
    row = await db.get(CompanyExpense, expense_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending company expense can be cancelled")
    row.status = "CANCELLED"
    row.cancelled_at = datetime.now(timezone.utc)
    row.cancelled_by = current_user.id
    row.cancellation_reason = cancellation_reason
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/company-expenses/export-statement", response_model=None)
async def company_expense_statement(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("expense.company")),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.4 Export Statement — same shape as My Expenses' (§2.1): only Paid
    rows carry a Bank Account / count toward the running balance.
    """
    from app.models.masters import BankAccount

    stmt = select(CompanyExpense).where(CompanyExpense.status == "PAID")
    if date_from:
        stmt = stmt.where(CompanyExpense.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(CompanyExpense.expense_date <= date_to)
    rows_data = (await db.execute(stmt)).scalars().all()

    rows = []
    for row in rows_data:
        expense_type = await db.get(ExpenseType, row.expense_type_id)
        bank_name = None
        if row.paid_from_bank_account_id is not None:
            account = await db.get(BankAccount, row.paid_from_bank_account_id)
            bank_name = account.nickname if account else None
        type_name = expense_type.name if expense_type else "Company Expense"
        description = f"{type_name}: {row.description}" if row.description else type_name
        reference = row.id if row.linked_purchase_bill_id is None else f"{row.id} / {row.linked_purchase_bill_id}"
        rows.append((row.expense_date, description, bank_name, reference, row.amount))

    statement_rows = [
        {"date": l.date, "description": l.description, "bank_account": l.bank_account, "reference": l.reference, "debit": l.debit, "running_balance": l.running_balance}
        for l in build_bank_statement(rows)
    ]

    if format:
        filters_applied = {"date_from": date_from, "date_to": date_to}
        return await list_export.build_export(format, db, current_user, "Company Expense Statement", _STATEMENT_COLUMNS, statement_rows, filters_applied)

    return statement_rows
