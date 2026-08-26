"""Leave §2.6 Compensatory Hours — reuses the exact same Approval Routing
Rule as My Leave (leave_engine.resolve_routing) per the spec's own note that
§2.6 "reuses it rather than inventing a second one".

ESTIMATE, flagged rather than treated as authoritative: estimated_payroll_impact
needs an hourly rate. Derived as gross_monthly / (net_working_hours_per_day *
total_days_in_period), with total_days_in_period read from the org's actual
active PayCycle via payroll_engine.resolve_pay_period for the shortfall's
month — the SAME days-in-period source A115 (calculate_unpaid_leave_deduction)
and attendance_reconciliation.py's own payroll-impact preview use, instead of
an assumed flat days-per-month, so a 6-day work week or a non-calendar Pay
Cycle doesn't silently skew this preview. Still just a preview, not a payroll
figure — Run Payroll additionally prorates for mid-period joiners/exits, which
this screen has no reason to reproduce.
"""

import calendar
import logging
import uuid
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import AttendanceRecord, Employee, SalaryStructure
from app.models.leave import CompensatoryHourRequest
from app.models.masters import Holiday, PayCycle, SaturdayOverride, WorkWeekPolicy
from app.models.platform import User
from app.models.rbac import Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.leave import CompHoursDecisionRequest, CompHoursRequestCreate, CompHoursRequestOut
from app.services import list_export, org_scope
from app.services.attendance_engine import SaturdayOverrideSnapshot, WorkWeekPolicySnapshot, resolve_day
from app.services.leave_engine import estimate_payroll_impact, resolve_routing, validate_comp_hours_request
from app.services.notify import notify
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.payroll_engine import resolve_pay_period
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/compensatory-hours", tags=["leave"])
SCREEN = "leave.compensatory_hours"

# Hours is a quantity, not currency — right-aligned per the house rule
# (money=left, counts/quantities/hours=right). "Date Earned"/"Hours" are the
# make-up pair (make_up_date / hours_to_work) — the date and amount of
# compensatory time actually earned back, as opposed to Shortfall
# Date/Hours Short, which describe the deficit rather than what was earned.
_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("date_earned", "Date Earned"),
    ColumnSpec("hours", "Hours", align="right"),
    ColumnSpec("status", "Status"),
]


async def _build_export_rows(db: AsyncSession, rows: list[CompensatoryHourRequest]) -> list[dict]:
    export_rows = []
    for row in rows:
        employee = await db.get(Employee, row.employee_id)
        employee_name = f"{employee.first_name} {employee.last_name or ''}".strip() if employee else row.employee_id
        export_rows.append({
            "employee": employee_name, "date_earned": row.make_up_date, "hours": row.hours_to_work, "status": row.status,
        })
    return export_rows


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


def _is_last_saturday(d: date_type) -> bool:
    last_day_of_month = calendar.monthrange(d.year, d.month)[1]
    return d.day + 7 > last_day_of_month


async def _resolve_day_type(db: AsyncSession, policy: WorkWeekPolicy, d: date_type) -> str:
    mandatory = (
        await db.execute(select(Holiday).where(Holiday.holiday_date == d, Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True)))
    ).scalar_one_or_none()
    optional = (
        await db.execute(select(Holiday).where(Holiday.holiday_date == d, Holiday.holiday_type == "OPTIONAL", Holiday.is_active.is_(True)))
    ).scalar_one_or_none()
    override_row = (
        await db.execute(
            select(SaturdayOverride).where(SaturdayOverride.saturday_date == d, (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None)))
        )
    ).scalars().first()
    snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )
    override_snapshot = SaturdayOverrideSnapshot(override_to=override_row.override_to, hours_required=override_row.hours_required) if override_row else None
    day = resolve_day(d, snapshot, is_mandatory_holiday=mandatory is not None, is_optional_holiday=optional is not None, saturday_override=override_snapshot, is_last_saturday_of_month=_is_last_saturday(d))
    if day.day_type in ("WORKING_SATURDAY",):
        return "WORKING_SATURDAY"
    if day.day_type == "WEEKLY_OFF":
        return "WEEKLY_OFF"
    if day.day_type == "MANDATORY_HOLIDAY":
        return "MANDATORY_HOLIDAY"
    if day.day_type == "OPTIONAL_HOLIDAY":
        return "OPTIONAL_HOLIDAY"
    return "WORKING_DAY"


@router.post("/requests", response_model=CompHoursRequestOut, status_code=status.HTTP_201_CREATED)
async def request_compensatory_hours(
    body: CompHoursRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="request")),
) -> CompensatoryHourRequest:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    employee = await db.get(Employee, own_id)

    shortfall = await db.get(AttendanceRecord, body.shortfall_attendance_record_id)
    if shortfall is None or shortfall.employee_id != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    hours_short = -shortfall.balance_hours if shortfall.balance_hours < 0 else Decimal("0")
    if hours_short <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This attendance record has no shortfall to compensate")

    policy = await db.get(WorkWeekPolicy, shortfall.work_week_policy_id)
    fy = await get_current_financial_year(db)
    make_up_day_type = await _resolve_day_type(db, policy, body.make_up_date)

    # §2.6: "Hours You Will Work — Must be at least Hours Short" — an
    # explicit, required field (found missing by the Phase 2 audit; this
    # previously derived it silently from the optional planned check-in/out
    # times, which the spec marks non-mandatory).
    if body.hours_to_work < hours_short:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Hours You Will Work must be at least the {hours_short} hours short")
    hours_to_work = body.hours_to_work

    month_start = body.make_up_date.replace(day=1)
    month_end = body.make_up_date.replace(day=calendar.monthrange(body.make_up_date.year, body.make_up_date.month)[1])
    existing = (
        await db.execute(
            select(CompensatoryHourRequest).where(
                CompensatoryHourRequest.employee_id == own_id, CompensatoryHourRequest.status.in_(("PENDING", "APPROVED")),
                CompensatoryHourRequest.make_up_date >= month_start, CompensatoryHourRequest.make_up_date <= month_end,
            )
        )
    ).scalars().all()
    month_hours_used = sum((r.hours_to_work for r in existing), Decimal("0"))

    validation = validate_comp_hours_request(
        shortfall_date=shortfall.attendance_date, make_up_date=body.make_up_date, make_up_day_type=make_up_day_type,
        compensation_window_days=policy.compensation_window_days or 0, max_comp_hours_per_month=policy.max_comp_hours_per_month,
        month_hours_already_used=month_hours_used, hours_to_work=hours_to_work,
        allow_makeup_on_week_off=policy.allow_makeup_on_week_off, allow_makeup_on_mandatory_holiday=policy.allow_makeup_on_mandatory_holiday,
    )
    if not validation.within_window:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Make-up date must be on or before {validation.window_last_permissible_date}")
    if not validation.within_monthly_cap:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This would exceed the monthly compensatory hours cap")
    if not validation.day_type_permitted:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"This policy does not allow making up hours on a {make_up_day_type} day")

    structure = (
        await db.execute(select(SalaryStructure).where(SalaryStructure.employee_id == own_id, SalaryStructure.effective_to.is_(None)))
    ).scalar_one_or_none()
    # Same days-in-period source A115 (payroll_engine.calculate_unpaid_leave_
    # deduction) and attendance_reconciliation.py's payroll-impact preview
    # both use — the org's actual active Pay Cycle — rather than an assumed
    # flat days-per-month, so a 6-day work week or a non-calendar Pay Cycle
    # doesn't silently skew this "impact if rejected" estimate. No active
    # Pay Cycle configured falls back to Decimal("0"), same as the prior
    # "no policy hours" fallback — this preview stays informational, it must
    # never block the request.
    cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    total_days_in_period = Decimal("0")
    if cycle is not None:
        resolution = resolve_pay_period(
            shortfall.attendance_date.month, shortfall.attendance_date.year,
            cycle.cycle_type, cycle.start_day, cycle.end_day, cycle.salary_credit_day,
        )
        total_days_in_period = Decimal((resolution.period_end - resolution.period_start).days + 1)
    hourly_rate = (
        structure.gross_monthly / (policy.net_working_hours_per_day * total_days_in_period)
    ) if structure and policy.net_working_hours_per_day and total_days_in_period else Decimal("0")
    impact = estimate_payroll_impact(hours_short, hourly_rate, policy.uncompensated_shortfall_becomes, policy.net_working_hours_per_day)

    role = await db.get(Role, current_user.role_id)
    manager_user_id = None
    if employee.reporting_manager_id:
        manager = await db.get(Employee, employee.reporting_manager_id)
        manager_user_id = manager.user_id if manager else None
    hr_is_available, applicant_is_sole_hr = await org_scope.hr_availability(db, current_user.id)
    routing = resolve_routing(applicant_role_code=role.code, reporting_manager_user_id=manager_user_id, hr_is_available=hr_is_available, applicant_is_sole_active_hr=applicant_is_sole_hr)

    request_number = await allocate_number(db, code_type="CHR", financial_year_id=fy.id, fy_label=fy.label)
    row = CompensatoryHourRequest(
        id=str(uuid.uuid4()), request_number=request_number, employee_id=own_id, financial_year_id=fy.id,
        shortfall_attendance_record_id=shortfall.id, shortfall_date=shortfall.attendance_date, hours_short=hours_short,
        day_status_at_request=shortfall.day_status, shortfall_reason=body.shortfall_reason, make_up_date=body.make_up_date,
        make_up_day_type=make_up_day_type, work_week_policy_id=policy.id, hours_to_work=hours_to_work,
        planned_check_in_time=body.planned_check_in_time, planned_check_out_time=body.planned_check_out_time,
        planned_break_hours=body.planned_break_hours, compensation_window_days_snapshot=policy.compensation_window_days or 0,
        window_last_permissible_date=validation.window_last_permissible_date, max_comp_hours_per_month_snapshot=policy.max_comp_hours_per_month,
        month_hours_used_at_submit=month_hours_used, allow_makeup_on_week_off_snapshot=policy.allow_makeup_on_week_off,
        allow_makeup_on_mandatory_holiday_snapshot=policy.allow_makeup_on_mandatory_holiday, estimated_payroll_impact=impact,
        uncompensated_shortfall_becomes_snapshot=policy.uncompensated_shortfall_becomes,
        routed_to_role=routing.role, routed_to_user_id=routing.user_id, routing_reason=routing.reason,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This attendance record already has an open compensatory hour request") from exc
    await db.refresh(row)
    return row


@router.get("/requests", response_model=None)
async def list_my_comp_hour_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None, description="Matches Reason for the Shortfall"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CompHoursRequestOut] | Response:
    filters_applied = {"status": status_filter, "search": search}
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        if format:
            return await list_export.build_export(format, db, current_user, "My Compensatory Hour Requests", _LIST_COLUMNS, [], filters_applied)
        return []
    stmt = select(CompensatoryHourRequest).where(CompensatoryHourRequest.employee_id == own_id)
    if status_filter:
        stmt = stmt.where(CompensatoryHourRequest.status == status_filter)
    if search:
        stmt = stmt.where(CompensatoryHourRequest.shortfall_reason.ilike(f"%{search}%"))
    rows = list((await db.execute(stmt.order_by(CompensatoryHourRequest.created_at.desc()))).scalars().all())

    if format:
        export_rows = await _build_export_rows(db, rows)
        return await list_export.build_export(format, db, current_user, "My Compensatory Hour Requests", _LIST_COLUMNS, export_rows, filters_applied)

    return [CompHoursRequestOut.model_validate(row) for row in rows]


@router.post("/requests/{request_id}/cancel", response_model=CompHoursRequestOut)
async def cancel_comp_hours_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="request")),
) -> CompensatoryHourRequest:
    row = await db.get(CompensatoryHourRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != row.employee_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only cancel your own request")
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Pending request can be cancelled")
    row.status = "CANCELLED"
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/approvals", response_model=None)
async def list_comp_hours_approvals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="approve")),
    status_filter: str | None = Query("PENDING", alias="status"),
    employee_id: str | None = Query(None),
    department_id: str | None = Query(None),
    search: str | None = Query(None, description="Matches Employee Name, Reason for the Shortfall"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[CompHoursRequestOut] | Response:
    stmt = select(CompensatoryHourRequest)
    if department_id or search:
        stmt = stmt.join(Employee, Employee.id == CompensatoryHourRequest.employee_id)
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=CompensatoryHourRequest.employee_id, owner_id=own_id, team_member_ids=reports)
    if status_filter:
        stmt = stmt.where(CompensatoryHourRequest.status == status_filter)
    if employee_id:
        stmt = stmt.where(CompensatoryHourRequest.employee_id == employee_id)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if search:
        needle = f"%{search}%"
        stmt = stmt.where(or_(Employee.first_name.ilike(needle), Employee.last_name.ilike(needle), CompensatoryHourRequest.shortfall_reason.ilike(needle)))
    rows = list((await db.execute(stmt.order_by(CompensatoryHourRequest.created_at))).scalars().all())

    if format:
        export_rows = await _build_export_rows(db, rows)
        filters_applied = {"status": status_filter, "employee_id": employee_id, "department_id": department_id, "search": search}
        return await list_export.build_export(format, db, current_user, "Compensatory Hour Approvals", _LIST_COLUMNS, export_rows, filters_applied)

    return [CompHoursRequestOut.model_validate(row) for row in rows]


@router.post("/approvals/{request_id}/decide", response_model=CompHoursRequestOut)
async def decide_comp_hours_request(
    request_id: str,
    body: CompHoursDecisionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="approve")),
) -> CompensatoryHourRequest:
    row = await db.get(CompensatoryHourRequest, request_id)
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject a compensatory hour request")

    row.status = "APPROVED" if body.approve else "REJECTED"
    row.actioned_by = current_user.id
    row.actioned_at = datetime.now(timezone.utc)
    row.decision_reason = body.decision_reason
    row.updated_by = current_user.id

    if body.approve:
        # §2.6 field table: "Day Status That Day ... Approval lifts a Half
        # Day back to Full Day" — found missing entirely by the Phase 2
        # audit; approval only ever flipped this request's own status.
        shortfall = await db.get(AttendanceRecord, row.shortfall_attendance_record_id)
        if shortfall is not None and shortfall.day_status in ("HALF_DAY", "ABSENT"):
            shortfall.day_status = "FULL_DAY"
            shortfall.shortfall_cleared_hours = row.hours_short
            shortfall.updated_by = current_user.id

    employee = await db.get(Employee, row.employee_id)
    notify(
        db, recipient_user_id=employee.user_id, notification_type="COMPENSATORY_HOURS", actor_user_id=current_user.id,
        title=f"Compensatory hour request {row.status.lower()}",
        body=f"Your compensatory hour request {row.request_number} was {row.status.lower()}." + (f" Reason: {body.decision_reason}" if body.decision_reason else ""),
        source_module="compensatory_hours", source_record_id=row.id,
    )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A person may not approve their own compensatory hour request") from exc
    await db.refresh(row)
    return row
