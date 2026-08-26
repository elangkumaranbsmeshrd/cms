"""Leave §2.1 My Leave (apply/cancel — always "own", by construction, same
as Employee's My Profile) and §2.2 Leave Approvals (Manager 'team', HR/Super
Admin 'full'). Working-days calculation, the hard balance block, and the
Approval Routing Rule are leave_engine.py, called before any INSERT so the
API can return the exact shortfall/routing reason.
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
from app.models.leave import LeaveBalance, LeaveRequest
from app.models.masters import Holiday, LeaveType, SaturdayOverride
from app.models.platform import User
from app.models.rbac import FeatureToggle, Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.leave import LeaveBalanceOut, LeaveDecisionRequest, LeaveReassignRequest, LeaveRequestCreate, LeaveRequestOut
from app.services import email_transport, list_export, org_scope
from app.services.attendance_engine import WorkWeekPolicySnapshot
from app.services.leave_engine import InsufficientBalanceError, calculate_working_days, check_balance_or_raise, resolve_routing
from app.services.notify import notify
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec
from app.services.policy_resolution import resolve_policy_for_employee

router = APIRouter(prefix="/leave", tags=["leave"])
MY_LEAVE = "leave.my_leave"
APPROVALS = "leave.approvals"

# Days is a count of leave days, not a currency amount — right-aligned per
# the house rule (money=left, counts/quantities/days=right).
_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("leave_type", "Leave Type"),
    ColumnSpec("from_date", "Start Date"),
    ColumnSpec("to_date", "End Date"),
    ColumnSpec("days_requested", "Days", align="right"),
    ColumnSpec("status", "Status"),
]


async def _build_export_rows(db: AsyncSession, rows: list[LeaveRequest]) -> list[dict]:
    export_rows = []
    for row in rows:
        employee = await db.get(Employee, row.employee_id)
        employee_name = f"{employee.first_name} {employee.last_name or ''}".strip() if employee else row.employee_id
        leave_type = await db.get(LeaveType, row.leave_type_id)
        export_rows.append({
            "employee": employee_name, "leave_type": leave_type.name if leave_type else row.leave_type_id,
            "from_date": row.from_date, "to_date": row.to_date, "days_requested": row.days_requested, "status": row.status,
        })
    return export_rows


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


# ================================================== HR CO-APPROVAL (§6.2)
# "Require HR Co-Approval for Leave Longer Than X Days" (rbac/toggles.py
# TOGGLE_DEFAULTS, module "leave", OFF by default). Built on the same shape
# as Expense's own two-step approval (api/v1/expenses.py): the toggle is read
# LIVE at the moment of the decision — never snapshotted onto the row at
# apply time — so flipping it takes effect on the very next decision instead
# of only on requests created afterwards, matching _toggle_enabled in
# expenses.py / purchase_bills.py / compliance.py / invoices.py.
HR_CO_APPROVAL_TOGGLE = "Require HR Co-Approval for Leave Longer Than X Days"

# The roles whose own approval already IS the HR signature, so demanding a
# further co-approval on top of it would be asking the same desk twice:
# HR itself, and Super Admin — leave_engine.resolve_routing already treats
# Super Admin as HR's designated stand-in (rules 4/5: "Nobody is in HR:
# falls back to Super Admin"), which is also what keeps this step from ever
# stranding a request in an org with no active HR user, the same "narrow to
# what actually applies, never strand a record with no valid path forward"
# reasoning expenses.py's _manager_approval_required uses for a claimant
# with no reporting manager.
_HR_SIGNATORY_ROLES = ("HR", "SUPER_ADMIN")


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _toggle_numeric_value(db: AsyncSession, toggle_key: str) -> Decimal | None:
    return (await db.execute(select(FeatureToggle.numeric_value).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()


def _awaiting_hr_co_approval(row: LeaveRequest) -> bool:
    """"First approver has signed, HR co-approval still outstanding" — the
    intermediate state, expressed entirely in columns that already exist.

    Expense models its equivalent step as a real intermediate STATUS
    (MGR_APPROVED). Leave cannot: leave_requests.status is CHECK-constrained
    to ('PENDING','APPROVED','REJECTED','CANCELLED') (migration
    0003_employee_leave.py, ck_lr_status) and adding a fifth value needs a
    migration. It does not need one, though — hr_co_approval_required /
    hr_co_approved_by / hr_co_approved_at have been real columns on this
    table since that same migration (lines 610-612) and were simply never
    written to. Still-PENDING + flagged + not yet co-approved is exactly the
    "Manager decided, HR co-approval still pending" state, and leaving the
    status at PENDING is also what keeps the request correctly visible in the
    Approvals queue (which defaults to status=PENDING) while it waits.
    """
    return row.status == "PENDING" and bool(row.hr_co_approval_required) and row.hr_co_approved_at is None


async def _hr_co_approval_threshold(db: AsyncSession, row: LeaveRequest, approver_role_code: str) -> Decimal | None:
    """The configured "X Days" when THIS request, approved by THIS approver,
    needs the extra HR signature — None when it does not, which is always the
    case while the toggle is off (the default: behaviour then is byte-for-byte
    what it was before this was built).

    days_requested is whatever leave_engine.calculate_working_days already
    put on the row at apply time — half-days, weekly offs, the covering Work
    Week Policy's Saturday rule and Mandatory holidays are all already
    accounted for there, so nothing is re-counted here. "Longer Than X Days"
    is read strictly: a request at exactly the threshold is unaffected.
    """
    if not await _toggle_enabled(db, HR_CO_APPROVAL_TOGGLE):
        return None
    threshold = await _toggle_numeric_value(db, HR_CO_APPROVAL_TOGGLE)
    # Toggle on but no number configured: nothing to compare against, so no
    # request can be "longer than X" — same `threshold is not None` guard
    # expenses.py's own auto-approval threshold check uses rather than
    # inventing a fallback number nobody chose.
    if threshold is None:
        return None
    if row.days_requested <= threshold:
        return None
    if row.hr_co_approved_at is not None:
        return None  # already co-approved; the step is done, not owed twice
    if approver_role_code in _HR_SIGNATORY_ROLES:
        return None  # this approver's own signature IS the HR one
    return threshold


async def _release_pending_balance(db: AsyncSession, row: LeaveRequest, *, approve: bool, user_id: str) -> None:
    """Moves the request's days out of pending_days once, at the moment the
    request reaches a terminal status — never at the intermediate
    co-approval step, where nothing has been granted yet and the days must
    stay held in pending_days.
    """
    balance = (
        await db.execute(
            select(LeaveBalance).where(
                LeaveBalance.employee_id == row.employee_id, LeaveBalance.leave_type_id == row.leave_type_id,
                LeaveBalance.financial_year_id == row.financial_year_id,
            )
        )
    ).scalar_one_or_none()
    if balance is None:
        return
    balance.pending_days -= row.days_requested
    if approve:
        balance.taken_days += row.days_requested
    balance.updated_by = user_id


async def _require_own_employee(db: AsyncSession, current_user: User) -> Employee:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    return await db.get(Employee, own_id)


async def _get_or_create_balance(db: AsyncSession, employee_id: str, leave_type: LeaveType, fy_id: str, user_id: str) -> LeaveBalance:
    balance = (
        await db.execute(
            select(LeaveBalance).where(LeaveBalance.employee_id == employee_id, LeaveBalance.leave_type_id == leave_type.id, LeaveBalance.financial_year_id == fy_id)
        )
    ).scalar_one_or_none()
    if balance is None:
        balance = LeaveBalance(
            id=str(uuid.uuid4()), employee_id=employee_id, leave_type_id=leave_type.id, financial_year_id=fy_id,
            allowed_days=leave_type.default_annual_quota_days, is_quota_tracked=leave_type.is_quota_tracked,
            default_annual_quota_snapshot=leave_type.default_annual_quota_days,
            carry_forward_allowed_snapshot=leave_type.carry_forward_allowed, max_carry_forward_days_snapshot=leave_type.max_carry_forward_days,
            created_by=user_id, updated_by=user_id,
        )
        db.add(balance)
        await db.flush()
        # remaining_days is a real DB-computed column (Computed()) — after
        # INSERT it's expired on this object, and a bare attribute read under
        # async SQLAlchemy raises MissingGreenlet instead of implicitly
        # reloading (found live: check_balance_or_raise below reads it
        # immediately after creation).
        await db.refresh(balance)
    return balance


# ================================================================= MY LEAVE
@router.get("/requests", response_model=None)
async def list_my_leave_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_LEAVE)),
    status_filter: str | None = Query(None, alias="status"),
    leave_type_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    date_from: date_type | None = Query(None, description="Leave From Date, inclusive"),
    date_to: date_type | None = Query(None, description="Leave From Date, inclusive"),
    applied_from: date_type | None = Query(None),
    applied_to: date_type | None = Query(None),
    half_day: bool | None = Query(None),
    actioned_by: str | None = Query(None),
    search: str | None = Query(None, description="Matches Reason"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[LeaveRequestOut] | Response:
    filters_applied = {
        "status": status_filter, "leave_type_id": leave_type_id, "financial_year_id": financial_year_id,
        "date_from": date_from, "date_to": date_to, "applied_from": applied_from, "applied_to": applied_to,
        "half_day": half_day, "actioned_by": actioned_by, "search": search,
    }
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        if format:
            return await list_export.build_export(format, db, current_user, "My Leave Requests", _LIST_COLUMNS, [], filters_applied)
        return []
    stmt = select(LeaveRequest).where(LeaveRequest.employee_id == own_id)
    if status_filter:
        stmt = stmt.where(LeaveRequest.status == status_filter)
    if leave_type_id:
        stmt = stmt.where(LeaveRequest.leave_type_id == leave_type_id)
    if financial_year_id:
        stmt = stmt.where(LeaveRequest.financial_year_id == financial_year_id)
    if date_from:
        stmt = stmt.where(LeaveRequest.from_date >= date_from)
    if date_to:
        stmt = stmt.where(LeaveRequest.from_date <= date_to)
    if applied_from:
        stmt = stmt.where(LeaveRequest.applied_at >= applied_from)
    if applied_to:
        stmt = stmt.where(LeaveRequest.applied_at < applied_to + timedelta(days=1))
    if half_day is not None:
        stmt = stmt.where(LeaveRequest.is_half_day.is_(half_day))
    if actioned_by:
        stmt = stmt.where(LeaveRequest.actioned_by == actioned_by)
    if search:
        stmt = stmt.where(LeaveRequest.reason.ilike(f"%{search}%"))
    rows = list((await db.execute(stmt.order_by(LeaveRequest.applied_at.desc()))).scalars().all())

    if format:
        export_rows = await _build_export_rows(db, rows)
        return await list_export.build_export(format, db, current_user, "My Leave Requests", _LIST_COLUMNS, export_rows, filters_applied)

    return [LeaveRequestOut.model_validate(row) for row in rows]


@router.get("/balances", response_model=list[LeaveBalanceOut])
async def list_my_leave_balances(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_LEAVE)),
) -> list[LeaveBalance]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    fy = await get_current_financial_year(db)
    rows = (
        await db.execute(select(LeaveBalance).where(LeaveBalance.employee_id == own_id, LeaveBalance.financial_year_id == fy.id))
    ).scalars().all()
    return list(rows)


@router.post("/requests", response_model=LeaveRequestOut, status_code=status.HTTP_201_CREATED)
async def apply_for_leave(
    body: LeaveRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_LEAVE, action="apply")),
) -> LeaveRequest:
    employee = await _require_own_employee(db, current_user)
    leave_type = await db.get(LeaveType, body.leave_type_id)
    if leave_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Leave type not found")

    # §2.1: "A second, separate check blocks a request that overlaps dates
    # with an existing Pending or Approved request from the same person" —
    # found missing entirely by the Phase 2 audit. The migration's own
    # docstring already flags this as deliberately service-layer-only (no
    # MySQL equivalent), so it belongs here, not the DB.
    overlapping = (
        await db.execute(
            select(LeaveRequest.id).where(
                LeaveRequest.employee_id == employee.id, LeaveRequest.status.in_(("PENDING", "APPROVED")),
                LeaveRequest.from_date <= body.to_date, LeaveRequest.to_date >= body.from_date,
            )
        )
    ).first()
    if overlapping is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This overlaps an existing Pending or Approved leave request")

    fy = await get_current_financial_year(db)
    policy = await resolve_policy_for_employee(db, employee, body.from_date)
    if policy is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No Work Week Policy covers this employee on this date")

    mandatory_dates = set(
        (
            await db.execute(
                select(Holiday.holiday_date).where(
                    Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True),
                    Holiday.holiday_date >= body.from_date, Holiday.holiday_date <= body.to_date,
                )
            )
        ).scalars()
    )
    overrides = (
        await db.execute(
            select(SaturdayOverride).where(
                SaturdayOverride.saturday_date >= body.from_date, SaturdayOverride.saturday_date <= body.to_date,
                (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None)),
            )
        )
    ).scalars().all()
    override_dates = {o.saturday_date: (o.override_to == "WORKING") for o in overrides}

    policy_snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )
    days_requested = calculate_working_days(body.from_date, body.to_date, body.is_half_day, policy_snapshot, mandatory_dates, override_dates)

    balance = await _get_or_create_balance(db, employee.id, leave_type, fy.id, current_user.id)
    try:
        check_balance_or_raise(leave_type.name, balance.remaining_days, days_requested, balance.is_quota_tracked)
    except InsufficientBalanceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    role = await db.get(Role, current_user.role_id)
    manager_user_id = None
    if employee.reporting_manager_id:
        manager = await db.get(Employee, employee.reporting_manager_id)
        manager_user_id = manager.user_id if manager else None
    hr_is_available, applicant_is_sole_hr = await org_scope.hr_availability(db, current_user.id)
    routing = resolve_routing(
        applicant_role_code=role.code, reporting_manager_user_id=manager_user_id,
        hr_is_available=hr_is_available, applicant_is_sole_active_hr=applicant_is_sole_hr,
    )

    # §6.2's "Require HR Co-Approval for Leave Longer Than X Days" is
    # deliberately NOT evaluated here. hr_co_approval_required is written by
    # decide_leave_request, at the moment of the decision, from a live read
    # of the toggle and its numeric_value — writing it at apply time would
    # make it a snapshot of the toggle's state on the day the employee
    # happened to submit, which is neither how any other toggle in this
    # codebase behaves nor what a Super Admin flipping the switch expects.
    row = LeaveRequest(
        id=str(uuid.uuid4()), employee_id=employee.id, leave_type_id=leave_type.id, financial_year_id=fy.id,
        from_date=body.from_date, to_date=body.to_date, is_half_day=body.is_half_day, half_day_session=body.half_day_session,
        days_requested=days_requested, working_days_basis_policy_id=policy.id, reason=body.reason,
        paid_type_snapshot="PAID" if leave_type.is_paid else "UNPAID",
        routed_to_role=routing.role, routed_to_user_id=routing.user_id, routing_reason=routing.reason,
        applied_at=datetime.now(timezone.utc), created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    balance.pending_days += days_requested
    balance.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.post("/requests/{request_id}/cancel", response_model=LeaveRequestOut)
async def cancel_leave_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_LEAVE, action="cancel")),
) -> LeaveRequest:
    row = await db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != row.employee_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only cancel your own leave request")
    # §2.1: "shown only on the applicant's own still-Pending requests ...
    # they were only ever held in Pending, never deducted from Taken." An
    # Approved request is not cancellable through this action — found
    # over-permissive by the Phase 2 audit (previously also accepted
    # APPROVED and reversed taken_days, a transition the spec never describes).
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a still-Pending request can be cancelled")

    balance = (
        await db.execute(
            select(LeaveBalance).where(LeaveBalance.employee_id == row.employee_id, LeaveBalance.leave_type_id == row.leave_type_id, LeaveBalance.financial_year_id == row.financial_year_id)
        )
    ).scalar_one_or_none()
    if balance is not None:
        balance.pending_days -= row.days_requested
        balance.updated_by = current_user.id

    row.status = "CANCELLED"
    row.cancelled_at = datetime.now(timezone.utc)
    row.cancelled_by_user_id = current_user.id
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


# ================================================================ APPROVALS
@router.get("/approvals", response_model=None)
async def list_leave_approvals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(APPROVALS)),
    status_filter: list[str] | None = Query(None, alias="status"),  # RBAC §2.2(c): multi-select, never single-select
    employee_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    routed_to: str | None = Query(None, description="A routed_to_user_id, or the literal role 'HR'/'SUPER_ADMIN'"),
    applied_from: date_type | None = Query(None),
    applied_to: date_type | None = Query(None),
    date_from: date_type | None = Query(None, description="Leave From Date, inclusive"),
    date_to: date_type | None = Query(None, description="Leave From Date, inclusive"),
    days_min: Decimal | None = Query(None),
    days_max: Decimal | None = Query(None),
    # numberrange filter kind's own naming convention (create-list-store.ts:
    # `${param}_min`/`${param}_max`) — "pending N+ days" (§2.2's own named
    # addition) is the min side; max is a bonus the convention gives for free.
    pending_days_min: int | None = Query(None, description="Days since applied_at, at least this many"),
    pending_days_max: int | None = Query(None, description="Days since applied_at, at most this many"),
    awaiting_hr_co_approval: bool | None = Query(
        None, description="§6.2: true = has its first approval and still needs the HR co-approval signature"
    ),
    search: str | None = Query(None, description="Matches Employee Name, Reason"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[LeaveRequestOut] | Response:
    stmt = select(LeaveRequest)
    if search:
        stmt = stmt.join(Employee, Employee.id == LeaveRequest.employee_id)
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=LeaveRequest.employee_id, owner_id=own_id, team_member_ids=reports)
    # No status filter supplied: preserve the endpoint's long-standing implicit
    # default of showing only Pending requests (this is the Approvals queue —
    # callers that never pass ?status= expect their action list, not history).
    effective_status = status_filter if status_filter else ["PENDING"]
    stmt = stmt.where(LeaveRequest.status.in_(effective_status))
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    if leave_type_id:
        stmt = stmt.where(LeaveRequest.leave_type_id == leave_type_id)
    if routed_to:
        stmt = stmt.where(
            LeaveRequest.routed_to_user_id == routed_to if routed_to not in ("HR", "SUPER_ADMIN") else LeaveRequest.routed_to_role == routed_to
        )
    if applied_from:
        stmt = stmt.where(LeaveRequest.applied_at >= applied_from)
    if applied_to:
        stmt = stmt.where(LeaveRequest.applied_at < applied_to + timedelta(days=1))
    if date_from:
        stmt = stmt.where(LeaveRequest.from_date >= date_from)
    if date_to:
        stmt = stmt.where(LeaveRequest.from_date <= date_to)
    if days_min is not None:
        stmt = stmt.where(LeaveRequest.days_requested >= days_min)
    if days_max is not None:
        stmt = stmt.where(LeaveRequest.days_requested <= days_max)
    if pending_days_min is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=pending_days_min)
        stmt = stmt.where(LeaveRequest.applied_at <= cutoff)
    if pending_days_max is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=pending_days_max)
        stmt = stmt.where(LeaveRequest.applied_at >= cutoff)
    if awaiting_hr_co_approval is not None:
        # The SQL form of _awaiting_hr_co_approval() — how HR isolates the
        # co-approval queue from ordinary still-undecided requests, both of
        # which are status=PENDING.
        awaiting = (LeaveRequest.hr_co_approval_required.is_(True)) & (LeaveRequest.hr_co_approved_at.is_(None)) & (LeaveRequest.status == "PENDING")
        stmt = stmt.where(awaiting) if awaiting_hr_co_approval else stmt.where(~awaiting)
    if search:
        needle = f"%{search}%"
        stmt = stmt.where(or_(Employee.first_name.ilike(needle), Employee.last_name.ilike(needle), LeaveRequest.reason.ilike(needle)))
    rows = list((await db.execute(stmt.order_by(LeaveRequest.applied_at))).scalars().all())

    if format:
        export_rows = await _build_export_rows(db, rows)
        filters_applied = {
            "status": effective_status, "employee_id": employee_id, "leave_type_id": leave_type_id, "routed_to": routed_to,
            "applied_from": applied_from, "applied_to": applied_to, "date_from": date_from, "date_to": date_to,
            "days_min": days_min, "days_max": days_max, "pending_days_min": pending_days_min, "pending_days_max": pending_days_max,
            "awaiting_hr_co_approval": awaiting_hr_co_approval, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Leave Approvals", _LIST_COLUMNS, export_rows, filters_applied)

    return [LeaveRequestOut.model_validate(row) for row in rows]


@router.post("/approvals/{request_id}/decide", response_model=LeaveRequestOut)
async def decide_leave_request(
    request_id: str,
    body: LeaveDecisionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(APPROVALS, action="approve")),
) -> LeaveRequest:
    row = await db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already decided")
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        if row.employee_id not in reports:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not one of your direct reports")
    if not body.approve and not (body.decision_reason and body.decision_reason.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject a leave request")

    employee = await db.get(Employee, row.employee_id)
    caller_is_hr_signatory = perms.role_code in _HR_SIGNATORY_ROLES

    # §6.2: once the first approver has signed, the request belongs to HR.
    # Its status is still PENDING (see _awaiting_hr_co_approval on why), which
    # without this check would let the same Manager decide it a second time
    # and silently overwrite their own signature.
    if _awaiting_hr_co_approval(row) and not caller_is_hr_signatory:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This request already has its first approval and is waiting on HR co-approval",
        )

    threshold = await _hr_co_approval_threshold(db, row, perms.role_code) if body.approve else None
    if threshold is not None:
        # ---- FIRST signature only: hold the request open for HR ----
        # The balance is deliberately untouched: nothing has been granted, so
        # the days stay held in pending_days rather than moving to taken_days.
        if employee is not None and employee.user_id == current_user.id:
            # The DB's own trg_leave_requests_block_self_approval (migration
            # 0003) only fires when status actually CHANGES, and this step
            # leaves it at PENDING — so the invariant it enforces has to be
            # restated here rather than relied on from the trigger.
            raise HTTPException(status.HTTP_409_CONFLICT, detail="A person may not approve their own leave request")
        row.hr_co_approval_required = True
        row.actioned_by = current_user.id
        row.actioned_at = datetime.now(timezone.utc)
        row.decision_reason = body.decision_reason
        # It is genuinely waiting on HR now, so the queue should say so —
        # routed_to_role is CHECK-constrained to REPORTING_MANAGER/HR/
        # SUPER_ADMIN (ck_lr_routed_role) and 'HR' is exactly this state.
        # Without this the second approver would have no way to find it.
        row.routed_to_role = "HR"
        row.routed_to_user_id = None
        row.routing_reason = (
            f"{row.routing_reason} | First approval given; {row.days_requested} days exceeds the "
            f"{threshold}-day HR co-approval threshold, so HR must co-approve before it is granted"
        )
        row.updated_by = current_user.id
        if employee is not None:
            notify(
                db, recipient_user_id=employee.user_id, notification_type="LEAVE", actor_user_id=current_user.id,
                title="Leave request awaiting HR co-approval",
                body=f"Your leave request for {row.from_date} to {row.to_date} was approved and now needs HR co-approval.",
                source_module="leave", source_record_id=row.id,
            )
        try:
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            raise _as_client_error(exc, "Rejected by a database constraint") from exc
        await db.refresh(row)
        return row

    # ---- terminal decision — unchanged from before this feature existed
    # whenever the toggle is off, which is the default ----
    await _release_pending_balance(db, row, approve=body.approve, user_id=current_user.id)

    if body.approve and _awaiting_hr_co_approval(row):
        # HR (or Super Admin) supplying the outstanding co-signature through
        # the plain decide endpoint — identical effect to POST
        # .../hr-co-approve below. actioned_by/actioned_at are deliberately
        # left pointing at the FIRST approver: the co-signature has its own
        # two columns, and overwriting would erase who actually made the call.
        row.hr_co_approved_by = current_user.id
        row.hr_co_approved_at = datetime.now(timezone.utc)
    else:
        row.actioned_by = current_user.id
        row.actioned_at = datetime.now(timezone.utc)
    row.status = "APPROVED" if body.approve else "REJECTED"
    row.decision_reason = body.decision_reason
    row.updated_by = current_user.id

    notify(
        db, recipient_user_id=employee.user_id, notification_type="LEAVE", actor_user_id=current_user.id,
        title=f"Leave request {row.status.lower()}",
        body=f"Your leave request for {row.from_date} to {row.to_date} was {row.status.lower()}." + (f" Reason: {body.decision_reason}" if body.decision_reason else ""),
        source_module="leave", source_record_id=row.id,
    )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A person may not approve their own leave request") from exc
    await db.refresh(row)

    await email_transport.send_templated_email(
        db, "leave_approved" if body.approve else "leave_rejected", employee.email,
        {"first_name": employee.first_name, "start_date": str(row.from_date), "end_date": str(row.to_date)},
        related_record_type="leave_request", related_record_id=row.id,
    )

    return row


@router.post("/approvals/{request_id}/hr-co-approve", response_model=LeaveRequestOut)
async def hr_co_approve_leave_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(APPROVALS, action="approve")),
) -> LeaveRequest:
    """§6.2 "Require HR Co-Approval for Leave Longer Than X Days" — the
    second signature itself, the counterpart of expenses.py's
    manager_approve_expense_claim (there the EXTRA step comes first and
    Accountant closes it; here the normal approver goes first and HR closes
    it). decide() with approve=true does exactly the same thing for an HR/
    Super Admin caller — this exists so the Approvals screen has an
    unambiguous "Co-approve" action to call, and so the intent is recorded
    as a co-approval rather than as an ordinary decision.

    NOTE it deliberately does NOT 404 when the toggle is off, unlike
    manager_approve_expense_claim's own re-check. A request that already
    reached this state must stay completable even if Super Admin flips the
    toggle off while it sits in the queue — otherwise turning a feature off
    would strand live records. The toggle still fully controls whether any
    NEW request can ever enter this state (_hr_co_approval_threshold, read
    live in decide()), which is what "off means off" has to mean here.
    """
    if perms.role_code not in _HR_SIGNATORY_ROLES:
        # leave.approvals' registered actions are ("approve",) only
        # (rbac/registry/screens.py), so require_screen cannot express "HR
        # only" for this route on its own — restated here, the same
        # server-side role check expenses.py's create_expense_claim uses for
        # its Company-Paid gate. The API is the authority, not the frontend.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only HR or Super Admin can give the HR co-approval")
    row = await db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not _awaiting_hr_co_approval(row):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This request is not waiting on an HR co-approval")

    await _release_pending_balance(db, row, approve=True, user_id=current_user.id)
    row.hr_co_approved_by = current_user.id
    row.hr_co_approved_at = datetime.now(timezone.utc)
    row.status = "APPROVED"
    row.updated_by = current_user.id
    # actioned_by/actioned_at stay pointed at the first approver — same
    # reasoning as decide()'s own co-approval branch.

    employee = await db.get(Employee, row.employee_id)
    if employee is not None:
        notify(
            db, recipient_user_id=employee.user_id, notification_type="LEAVE", actor_user_id=current_user.id,
            title="Leave request approved",
            body=f"Your leave request for {row.from_date} to {row.to_date} was approved after HR co-approval.",
            source_module="leave", source_record_id=row.id,
        )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A person may not approve their own leave request") from exc
    await db.refresh(row)

    if employee is not None:
        await email_transport.send_templated_email(
            db, "leave_approved", employee.email,
            {"first_name": employee.first_name, "start_date": str(row.from_date), "end_date": str(row.to_date)},
            related_record_type="leave_request", related_record_id=row.id,
        )

    return row


@router.post("/approvals/{request_id}/reassign", response_model=LeaveRequestOut)
async def reassign_leave_request(
    request_id: str,
    body: LeaveReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(APPROVALS, action="approve")),
) -> LeaveRequest:
    row = await db.get(LeaveRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending request can be reassigned")
    # Found missing by the Phase 2 audit: unlike the sibling decide_leave_request,
    # this had no team-scope check at all — a Manager in "team" mode could
    # reassign any employee's pending request company-wide, not just a
    # direct report's.
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        if row.employee_id not in reports:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not one of your direct reports")

    row.reassigned_from_user_id = row.routed_to_user_id
    row.reassigned_by = current_user.id
    row.reassigned_at = datetime.now(timezone.utc)
    row.routed_to_user_id = body.to_user_id
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row
