"""Leave §2.4 Leave Balance Management (HR/Super Admin only) — manual
adjustments (append-only audit trail, DB triggers forbid UPDATE/DELETE on
leave_balance_adjustments) and the year-end Carry Forward run
(Preview -> Commit, one commit ever per from/to FY pair).
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Employee
from app.models.leave import LeaveBalance, LeaveBalanceAdjustment, LeaveCarryForwardLine, LeaveCarryForwardRun
from app.models.masters import LeaveType
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.leave import (
    CarryForwardRunOut,
    CarryForwardRunPreviewRequest,
    LeaveBalanceAdjustmentCreate,
    LeaveBalanceAdjustmentOut,
    LeaveBalanceOut,
)
from app.services import list_export, org_scope
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["leave"])
SCREEN = "leave.balance_management"

# Balance/Taken/Available are all day counts, not currency — right-aligned
# per the house rule (money=left, counts/quantities/days=right).
_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("leave_type", "Leave Type"),
    ColumnSpec("balance", "Balance", align="right"),
    ColumnSpec("taken", "Taken", align="right"),
    ColumnSpec("available", "Available", align="right"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


@router.get("/leave-balances", response_model=None)
async def list_leave_balances(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    employee_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    department_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    employee_status: str | None = Query(None),
    remaining_min: Decimal | None = Query(None),
    remaining_max: Decimal | None = Query(None),
    negative_only: bool = Query(False, description="Remaining < 0 only"),
    # numberrange filter kind's own naming convention (create-list-store.ts:
    # `${param}_min`/`${param}_max`) — §2.3's own "unused balance above N
    # days" toggle is min-only in practice, a distinct, purpose-named filter
    # from the generic Remaining range above even though both key off the
    # same column, since it answers a specific question ("who needs a
    # carry-forward review") the generic range doesn't surface on its own.
    unused_above_days_min: Decimal | None = Query(None, description="Remaining greater than this many days"),
    search: str | None = Query(None, description="Matches Employee Name, Employee Code"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[LeaveBalanceOut] | Response:
    # §6.2 "Allow Manager to Adjust Team Leave Balance" (toggles.py's
    # MODE_TOGGLE_GATES) widens Manager's mode to 'team' — narrow the same
    # way list_leave_approvals does, so a Manager's list view and their
    # actual adjust rights (see adjust_leave_balance below) cover the same set.
    needs_employee_join = bool(department_id or designation_id or employment_type_id or reporting_manager_id or employee_status or search)
    stmt = select(LeaveBalance)
    if needs_employee_join:
        stmt = stmt.join(Employee, Employee.id == LeaveBalance.employee_id)
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=LeaveBalance.employee_id, owner_id=own_id, team_member_ids=reports)
    if employee_id:
        stmt = stmt.where(LeaveBalance.employee_id == employee_id)
    if financial_year_id:
        stmt = stmt.where(LeaveBalance.financial_year_id == financial_year_id)
    if leave_type_id:
        stmt = stmt.where(LeaveBalance.leave_type_id == leave_type_id)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if designation_id:
        stmt = stmt.where(Employee.designation_id == designation_id)
    if employment_type_id:
        stmt = stmt.where(Employee.employment_type_id == employment_type_id)
    if reporting_manager_id:
        stmt = stmt.where(Employee.reporting_manager_id == reporting_manager_id)
    if employee_status:
        stmt = stmt.where(Employee.employment_status == employee_status)
    if remaining_min is not None:
        stmt = stmt.where(LeaveBalance.remaining_days >= remaining_min)
    if remaining_max is not None:
        stmt = stmt.where(LeaveBalance.remaining_days <= remaining_max)
    if negative_only:
        stmt = stmt.where(LeaveBalance.remaining_days < 0)
    if unused_above_days_min is not None:
        stmt = stmt.where(LeaveBalance.remaining_days > unused_above_days_min)
    if search:
        needle = f"%{search}%"
        stmt = stmt.where(or_(Employee.first_name.ilike(needle), Employee.last_name.ilike(needle), Employee.employee_code.ilike(needle)))
    rows = list((await db.execute(stmt)).scalars().all())

    if format:
        export_rows = []
        for row in rows:
            employee = await db.get(Employee, row.employee_id)
            employee_name = f"{employee.first_name} {employee.last_name or ''}".strip() if employee else row.employee_id
            leave_type = await db.get(LeaveType, row.leave_type_id)
            # "Balance" = total entitlement for the year before Taken/Pending
            # are drawn down; "Available" = remaining_days, the DB-computed
            # final figure (also nets out Pending, unlike Balance/Taken alone).
            export_rows.append({
                "employee": employee_name, "leave_type": leave_type.name if leave_type else row.leave_type_id,
                "balance": row.allowed_days + row.carried_forward_days + row.adjustment_days,
                "taken": row.taken_days, "available": row.remaining_days,
            })
        filters_applied = {
            "employee_id": employee_id, "financial_year_id": financial_year_id, "leave_type_id": leave_type_id,
            "department_id": department_id, "designation_id": designation_id, "employment_type_id": employment_type_id,
            "reporting_manager_id": reporting_manager_id, "employee_status": employee_status,
            "remaining_min": remaining_min, "remaining_max": remaining_max, "negative_only": negative_only,
            "unused_above_days_min": unused_above_days_min, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Leave Balances", _LIST_COLUMNS, export_rows, filters_applied)

    return [LeaveBalanceOut.model_validate(row) for row in rows]


@router.post("/leave-balances/adjustments", response_model=LeaveBalanceAdjustmentOut, status_code=status.HTTP_201_CREATED)
async def adjust_leave_balance(
    body: LeaveBalanceAdjustmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="adjust")),
) -> LeaveBalanceAdjustment:
    balance = await db.get(LeaveBalance, body.leave_balance_id)
    if balance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # §6.2 "Allow Manager to Adjust Team Leave Balance" — the toggle grants
    # the 'adjust' action (ACTION_TOGGLE_GATES) without widening `mode` past
    # 'team' (MODE_TOGGLE_GATES), so a Manager holding this action must still
    # be checked against their real direct reports here — same "not one of
    # your direct reports" 403 decide_leave_request uses for the same reason.
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        if balance.employee_id not in reports:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not one of your direct reports")
    balance_before = balance.remaining_days
    balance.adjustment_days += body.adjustment_days
    balance.updated_by = current_user.id
    await db.flush()
    await db.refresh(balance)  # remaining_days is DB-computed — reread it

    row = LeaveBalanceAdjustment(
        id=str(uuid.uuid4()), leave_balance_id=balance.id, employee_id=balance.employee_id, leave_type_id=balance.leave_type_id,
        financial_year_id=balance.financial_year_id, adjustment_days=body.adjustment_days, reason=body.reason,
        adjusted_by=current_user.id, adjusted_at=datetime.now(timezone.utc),
        balance_before=balance_before, balance_after=balance.remaining_days,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


# §2.3: "the documented history list with its own filters (Employee, Leave
# Type, Adjusted By, Date range, positive/negative adjustments)... deferred
# until that read endpoint is added — an adjustment log that can't be
# filtered by who made the adjustment is not much of an audit trail."
# leave_balance_adjustments has been fully populated (with balance_before/
# balance_after, append-only via DB trigger) since the write side was built —
# only this read side was missing.
_ADJUSTMENT_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("leave_type", "Leave Type"),
    ColumnSpec("adjusted_at", "Date"),
    ColumnSpec("adjustment_days", "Amount", align="right"),
    ColumnSpec("reason", "Reason"),
    ColumnSpec("adjusted_by", "Adjusted By"),
    ColumnSpec("balance_before", "Balance Before", align="right"),
    ColumnSpec("balance_after", "Balance After", align="right"),
]


@router.get("/leave-balances/adjustments", response_model=None)
async def list_leave_balance_adjustments(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    employee_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    adjusted_by: str | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    direction: str | None = Query(None, description="positive | negative"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[LeaveBalanceAdjustmentOut] | Response:
    stmt = select(LeaveBalanceAdjustment)
    # Same team-narrowing as list_leave_balances/adjust_leave_balance above —
    # a Manager granted 'adjust' via the toggle sees only their own direct
    # reports' history, not the company-wide log HR/Super Admin get.
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=LeaveBalanceAdjustment.employee_id, owner_id=own_id, team_member_ids=reports)
    if employee_id:
        stmt = stmt.where(LeaveBalanceAdjustment.employee_id == employee_id)
    if leave_type_id:
        stmt = stmt.where(LeaveBalanceAdjustment.leave_type_id == leave_type_id)
    if adjusted_by:
        stmt = stmt.where(LeaveBalanceAdjustment.adjusted_by == adjusted_by)
    if date_from:
        stmt = stmt.where(LeaveBalanceAdjustment.adjusted_at >= date_from)
    if date_to:
        stmt = stmt.where(LeaveBalanceAdjustment.adjusted_at < date_to + timedelta(days=1))
    if direction == "positive":
        stmt = stmt.where(LeaveBalanceAdjustment.adjustment_days > 0)
    elif direction == "negative":
        stmt = stmt.where(LeaveBalanceAdjustment.adjustment_days < 0)
    rows = list((await db.execute(stmt.order_by(LeaveBalanceAdjustment.adjusted_at.desc()))).scalars().all())

    if format:
        export_rows = []
        for row in rows:
            employee = await db.get(Employee, row.employee_id)
            employee_name = f"{employee.first_name} {employee.last_name or ''}".strip() if employee else row.employee_id
            leave_type = await db.get(LeaveType, row.leave_type_id)
            adjuster = await db.get(User, row.adjusted_by)
            export_rows.append({
                "employee": employee_name, "leave_type": leave_type.name if leave_type else row.leave_type_id,
                "adjusted_at": row.adjusted_at, "adjustment_days": row.adjustment_days, "reason": row.reason,
                "adjusted_by": adjuster.full_name if adjuster else row.adjusted_by,
                "balance_before": row.balance_before, "balance_after": row.balance_after,
            })
        filters_applied = {
            "employee_id": employee_id, "leave_type_id": leave_type_id, "adjusted_by": adjusted_by,
            "date_from": date_from, "date_to": date_to, "direction": direction,
        }
        return await list_export.build_export(format, db, current_user, "Leave Balance Adjustment History", _ADJUSTMENT_COLUMNS, export_rows, filters_applied)

    return [LeaveBalanceAdjustmentOut.model_validate(row) for row in rows]


# ------------------------------------------------------------ Carry Forward
@router.post("/leave-carry-forward-runs/preview", response_model=CarryForwardRunOut, status_code=status.HTTP_201_CREATED)
async def preview_carry_forward(
    body: CarryForwardRunPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run_carry_forward")),
) -> CarryForwardRunOut:
    from_fy = await db.get(FinancialYear, body.from_financial_year_id)
    to_fy = await db.get(FinancialYear, body.to_financial_year_id)
    if from_fy is None or to_fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Financial Year not found")
    # Mirrors the DB's own ck_lcfr_distinct_fy CHECK. Without this guard the
    # constraint fires at the flush below — outside the try/except DBAPIError
    # that wraps the commit — and escapes as a 500.
    if from_fy.id == to_fy.id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Carry Forward must run between two different Financial Years — choose a To Financial Year other than the From Financial Year",
        )

    run = LeaveCarryForwardRun(
        id=str(uuid.uuid4()), from_financial_year_id=from_fy.id, to_financial_year_id=to_fy.id,
        previewed_at=datetime.now(timezone.utc), previewed_by=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(run)
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc

    balances = (
        await db.execute(select(LeaveBalance).where(LeaveBalance.financial_year_id == from_fy.id, LeaveBalance.carry_forward_allowed_snapshot.is_(True)))
    ).scalars().all()
    employee_ids: set[str] = set()
    total_carried = Decimal("0")
    total_lapsed = Decimal("0")
    for source in balances:
        cap = source.max_carry_forward_days_snapshot
        carried = min(source.remaining_days, cap) if cap is not None else source.remaining_days
        carried = max(Decimal("0"), carried)
        lapsed = max(Decimal("0"), source.remaining_days - carried)
        line = LeaveCarryForwardLine(
            id=str(uuid.uuid4()), leave_carry_forward_run_id=run.id, employee_id=source.employee_id, leave_type_id=source.leave_type_id,
            source_leave_balance_id=source.id, remaining_days_at_run=source.remaining_days,
            carry_forward_allowed_snapshot=source.carry_forward_allowed_snapshot, max_carry_forward_days_snapshot=cap,
            days_carried_forward=carried, created_by=current_user.id, updated_by=current_user.id,
        )
        db.add(line)
        employee_ids.add(source.employee_id)
        total_carried += carried
        total_lapsed += lapsed

    run.employee_count = len(employee_ids)
    run.line_count = len(balances)
    run.total_days_carried = total_carried
    run.total_days_lapsed = total_lapsed
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(run)
    return await _run_to_out(db, run)


async def _run_to_out(db: AsyncSession, run: LeaveCarryForwardRun) -> CarryForwardRunOut:
    lines = (await db.execute(select(LeaveCarryForwardLine).where(LeaveCarryForwardLine.leave_carry_forward_run_id == run.id))).scalars().all()
    out = CarryForwardRunOut.model_validate(run)
    out.lines = list(lines)
    return out


@router.post("/leave-carry-forward-runs/{run_id}/commit", response_model=CarryForwardRunOut)
async def commit_carry_forward(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run_carry_forward")),
) -> CarryForwardRunOut:
    run = await db.get(LeaveCarryForwardRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if run.status != "PREVIEW":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Preview run can be committed")

    lines = (await db.execute(select(LeaveCarryForwardLine).where(LeaveCarryForwardLine.leave_carry_forward_run_id == run_id))).scalars().all()
    for line in lines:
        target = (
            await db.execute(
                select(LeaveBalance).where(
                    LeaveBalance.employee_id == line.employee_id, LeaveBalance.leave_type_id == line.leave_type_id,
                    LeaveBalance.financial_year_id == run.to_financial_year_id,
                )
            )
        ).scalar_one_or_none()
        if target is None:
            leave_type = await db.get(LeaveType, line.leave_type_id)
            target = LeaveBalance(
                id=str(uuid.uuid4()), employee_id=line.employee_id, leave_type_id=line.leave_type_id,
                financial_year_id=run.to_financial_year_id, allowed_days=leave_type.default_annual_quota_days,
                is_quota_tracked=leave_type.is_quota_tracked, default_annual_quota_snapshot=leave_type.default_annual_quota_days,
                carry_forward_allowed_snapshot=leave_type.carry_forward_allowed, max_carry_forward_days_snapshot=leave_type.max_carry_forward_days,
                created_by=current_user.id, updated_by=current_user.id,
            )
            db.add(target)
            await db.flush()
        target.carried_forward_days += line.days_carried_forward
        target.updated_by = current_user.id
        await db.flush()
        line.target_leave_balance_id = target.id
        line.updated_by = current_user.id

    run.status = "COMMITTED"
    run.committed_at = datetime.now(timezone.utc)
    run.committed_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This from/to Financial Year pair has already been committed") from exc
    await db.refresh(run)
    return await _run_to_out(db, run)


@router.post("/leave-carry-forward-runs/{run_id}/cancel", response_model=CarryForwardRunOut)
async def cancel_carry_forward(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="run_carry_forward")),
) -> CarryForwardRunOut:
    run = await db.get(LeaveCarryForwardRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if run.status != "PREVIEW":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Preview run can be cancelled")
    run.status = "CANCELLED"
    run.cancelled_at = datetime.now(timezone.utc)
    run.updated_by = current_user.id
    await db.commit()
    await db.refresh(run)
    return await _run_to_out(db, run)
