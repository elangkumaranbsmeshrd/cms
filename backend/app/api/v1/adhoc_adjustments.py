"""Payroll §2.1a Ad-hoc Payslip Adjustments — Accountant/Super Admin only by
default (A133); HR gains it only via the "Allow HR to Add Ad-hoc Payslip
Adjustments" toggle (§6.1), modelled the same way as every other toggle in
this codebase: an extra RolePermissionAction row, not a code branch.

A134a: an Offer/Appointment Letter's Custom Term queues here automatically
on generation (Employee §2.16) — see employee_lifecycle.py's
generate_offer_letter, which creates the AdhocPayslipAdjustment and stamps
offer_letter_custom_terms.queued_adjustment_id/queued_at directly, the same
"the API performs the cross-table effect, not a trigger" pattern already
established for exit-checklist cascade-unlock.
"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Employee
from app.models.payroll import AdhocAdjustmentEmployee, AdhocPayslipAdjustment
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.payroll import AdhocAdjustmentCreate, AdhocAdjustmentOut, AdhocAdjustmentRemove
from app.services import list_export
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/payroll/adhoc-adjustments", tags=["payroll"])
SCREEN = "payroll.adhoc_adjustments"

_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("label", "Label"),
    ColumnSpec("type", "Type"),
    ColumnSpec("amount", "Amount", align="left"),
    ColumnSpec("status", "Status"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


@router.get("", response_model=None)
async def list_adhoc_adjustments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    employee_id: str | None = Query(None),
    adjustment_type: str | None = Query(None),
    is_taxable: bool | None = Query(None),
    is_recurring: bool | None = Query(None),
    status_filter: list[str] | None = Query(["ACTIVE"], alias="status"),  # Appendix B: status filters are multi-select, never single-select
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    created_by: str | None = Query(None),
    date_added_from: date | None = Query(None),
    date_added_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches Label or Note"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AdhocAdjustmentOut] | Response:
    stmt = select(AdhocPayslipAdjustment)
    if employee_id:
        stmt = stmt.where(AdhocPayslipAdjustment.employee_id == employee_id)
    if adjustment_type:
        stmt = stmt.where(AdhocPayslipAdjustment.adjustment_type == adjustment_type)
    if is_taxable is not None:
        stmt = stmt.where(AdhocPayslipAdjustment.is_taxable == is_taxable)
    if is_recurring is not None:
        stmt = stmt.where(AdhocPayslipAdjustment.is_recurring == is_recurring)
    if status_filter:
        stmt = stmt.where(AdhocPayslipAdjustment.status.in_(status_filter))
    if amount_min is not None:
        stmt = stmt.where(AdhocPayslipAdjustment.amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(AdhocPayslipAdjustment.amount <= amount_max)
    if created_by:
        stmt = stmt.where(AdhocPayslipAdjustment.created_by == created_by)
    if date_added_from:
        stmt = stmt.where(AdhocPayslipAdjustment.created_at >= date_added_from)
    if date_added_to:
        stmt = stmt.where(AdhocPayslipAdjustment.created_at < date_added_to + timedelta(days=1))
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(AdhocPayslipAdjustment.label.ilike(pattern) | AdhocPayslipAdjustment.note.ilike(pattern))
    rows = (await db.execute(stmt.order_by(AdhocPayslipAdjustment.created_at.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/searched set on screen —
        # same rows the JSON branch below would return, just re-shaped. This
        # screen is Accountant/Super Admin(/HR-with-toggle) only, all of whom
        # can already see every employee's name elsewhere in the app, so
        # resolving employee_id -> a display name here (the same way
        # Invoice's export re-shapes customer_id -> customer name) does not
        # show the caller anything beyond what their role already sees.
        single_ids = {r.employee_id for r in rows if r.applies_to_mode == "SINGLE_EMPLOYEE" and r.employee_id}
        names: dict[str, str] = {}
        if single_ids:
            emp_rows = (await db.execute(select(Employee.id, Employee.first_name, Employee.last_name).where(Employee.id.in_(single_ids)))).all()
            names = {emp_id: f"{first} {last or ''}".strip() for emp_id, first, last in emp_rows}

        def _employee_display(r: AdhocPayslipAdjustment) -> str:
            if r.applies_to_mode == "SINGLE_EMPLOYEE":
                return names.get(r.employee_id, r.employee_id or "—")
            if r.applies_to_mode == "ALL_ACTIVE_EMPLOYEES":
                return "All Active Employees"
            return f"Multiple Employees ({r.target_employee_count})"

        export_rows = [
            {"employee": _employee_display(r), "label": r.label, "type": r.adjustment_type, "amount": r.amount, "status": r.status}
            for r in rows
        ]
        filters_applied = {
            "employee_id": employee_id, "adjustment_type": adjustment_type, "is_taxable": is_taxable,
            "is_recurring": is_recurring, "status": status_filter, "amount_min": amount_min, "amount_max": amount_max,
            "created_by": created_by, "date_added_from": date_added_from, "date_added_to": date_added_to, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Ad-hoc Adjustments", _LIST_COLUMNS, export_rows, filters_applied)

    return [AdhocAdjustmentOut.model_validate(r) for r in rows]


@router.post("", response_model=AdhocAdjustmentOut, status_code=status.HTTP_201_CREATED)
async def create_adhoc_adjustment(
    body: AdhocAdjustmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> AdhocPayslipAdjustment:
    if body.applies_to_mode == "SINGLE_EMPLOYEE" and not body.employee_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="employee_id is required for SINGLE_EMPLOYEE")
    if body.applies_to_mode == "MULTIPLE_EMPLOYEES" and not body.employee_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="employee_ids is required for MULTIPLE_EMPLOYEES")

    fy = await get_current_financial_year(db)
    row = AdhocPayslipAdjustment(
        id=str(uuid.uuid4()), financial_year_id=fy.id, applies_to_mode=body.applies_to_mode,
        employee_id=body.employee_id if body.applies_to_mode == "SINGLE_EMPLOYEE" else None,
        label=body.label, adjustment_type=body.adjustment_type, amount=body.amount, is_taxable=body.is_taxable,
        is_recurring=body.is_recurring, applies_to_component=body.applies_to_component, note=body.note,
        effective_from=body.effective_from or date.today(), created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    await db.flush()

    target_ids = await _resolve_targets(db, body.applies_to_mode, body.employee_id, body.employee_ids)
    for emp_id in target_ids:
        db.add(AdhocAdjustmentEmployee(id=str(uuid.uuid4()), adhoc_payslip_adjustment_id=row.id, employee_id=emp_id, created_by=current_user.id, updated_by=current_user.id))
    row.target_employee_count = len(target_ids)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


async def _resolve_targets(db: AsyncSession, mode: str, employee_id: str | None, employee_ids: list[str]) -> list[str]:
    if mode == "SINGLE_EMPLOYEE":
        return [employee_id]
    if mode == "MULTIPLE_EMPLOYEES":
        return employee_ids
    rows = (await db.execute(select(Employee.id).where(Employee.employment_status == "ACTIVE"))).scalars().all()
    return list(rows)


@router.post("/{adjustment_id}/remove", response_model=AdhocAdjustmentOut)
async def remove_adhoc_adjustment(
    adjustment_id: str,
    body: AdhocAdjustmentRemove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> AdhocPayslipAdjustment:
    """§2.1a: "removing a Recurring adjustment stops it from future runs; it
    does not undo it from runs already Processed — correcting a past
    Processed payslip goes through Reissue, not this screen." Any PENDING
    (not-yet-applied) per-employee target rows are cancelled so they never
    surface in a future run's calculation.
    """
    row = await db.get(AdhocPayslipAdjustment, adjustment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "ACTIVE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already removed or consumed")

    row.status = "REMOVED"
    row.removed_at = datetime.now(timezone.utc)
    row.removed_by = current_user.id
    row.removal_reason = body.removal_reason
    row.updated_by = current_user.id

    targets = (await db.execute(select(AdhocAdjustmentEmployee).where(AdhocAdjustmentEmployee.adhoc_payslip_adjustment_id == row.id, AdhocAdjustmentEmployee.status == "PENDING"))).scalars().all()
    for t in targets:
        t.status = "CANCELLED"
        t.cancelled_at = datetime.now(timezone.utc)
        t.cancelled_by = current_user.id
        t.updated_by = current_user.id

    await db.commit()
    await db.refresh(row)
    return row
