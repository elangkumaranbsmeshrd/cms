"""Employee §2.2 Leave & Attendance Summary tab — "only Super Admin can
manually record an employee's check-in and check-out" today (biometric
feed is Coming Soon per the spec itself). Day Type/Required Hours/Day
Status are resolved by app/services/attendance_engine.py, not typed.

DEFERRED, flagged rather than silently decided: crediting hours from an
Approved leave request onto the same calendar date (leave_credit_hours /
leave_request_id) is a genuine Attendance<->Leave interaction the spec
does not pin down precisely enough to implement without inventing a rule —
left at its default (0 / NULL) here, same "surface it, don't silently
resolve it" discipline as the tax_heads FY-scoping gap in Phase 1.
"""

import calendar
import logging
import uuid
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import AttendanceRecord, Employee
from app.models.leave import CompensatoryHourRequest
from app.models.masters import Holiday, SaturdayOverride
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.leave import AttendanceRecordOut, AttendanceRecordWrite
from app.services import list_export, org_scope
from app.services.attendance_engine import SaturdayOverrideSnapshot, WorkWeekPolicySnapshot, resolve_day, resolve_hours
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec
from app.services.policy_resolution import resolve_policy_for_employee

router = APIRouter(prefix="/attendance", tags=["employee"])
SCREEN = "employee.attendance"

_LIST_COLUMNS = [
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("employee_name", "Employee Name"),
    ColumnSpec("attendance_date", "Date"),
    ColumnSpec("day_type", "Day Type"),
    ColumnSpec("check_in_time", "In"),
    ColumnSpec("check_out_time", "Out"),
    ColumnSpec("break_hours", "Break", align="right"),
    ColumnSpec("required_hours", "Required", align="right"),
    ColumnSpec("net_worked_hours", "Worked", align="right"),
    ColumnSpec("balance_hours", "Balance", align="right"),
    ColumnSpec("day_status", "Status"),
    ColumnSpec("note", "Note"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


def _is_last_saturday(d: date_type) -> bool:
    last_day_of_month = calendar.monthrange(d.year, d.month)[1]
    return d.day + 7 > last_day_of_month


@router.get("", response_model=None)
async def list_attendance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    employee_id: str | None = Query(None),
    from_date: date_type | None = Query(None),
    to_date: date_type | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AttendanceRecordOut] | Response:
    stmt = select(AttendanceRecord)
    if perms.mode in ("own", "team", "view_team"):
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id and perms.mode in ("team", "view_team") else []
        stmt = apply_scope(stmt, perms, owner_column=AttendanceRecord.employee_id, owner_id=own_id, team_member_ids=reports)
    if employee_id:
        stmt = stmt.where(AttendanceRecord.employee_id == employee_id)
    if from_date:
        stmt = stmt.where(AttendanceRecord.attendance_date >= from_date)
    if to_date:
        stmt = stmt.where(AttendanceRecord.attendance_date <= to_date)
    rows = (await db.execute(stmt.order_by(AttendanceRecord.attendance_date.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered set on screen — same rows
        # the JSON branch below would return, just re-shaped, with the
        # Employee display fields it doesn't carry natively.
        employee_ids = {r.employee_id for r in rows}
        employees = (
            await db.execute(select(Employee.id, Employee.employee_code, Employee.first_name, Employee.last_name).where(Employee.id.in_(employee_ids)))
        ).all() if employee_ids else []
        employee_by_id = {e.id: e for e in employees}
        export_rows = []
        for r in rows:
            emp = employee_by_id.get(r.employee_id)
            export_rows.append({
                "employee_code": emp.employee_code if emp else None,
                "employee_name": f"{emp.first_name} {emp.last_name or ''}".strip() if emp else None,
                "attendance_date": r.attendance_date, "day_type": r.day_type, "check_in_time": r.check_in_time,
                "check_out_time": r.check_out_time, "break_hours": r.break_hours, "required_hours": r.required_hours,
                "net_worked_hours": r.net_worked_hours, "balance_hours": r.balance_hours, "day_status": r.day_status, "note": r.note,
            })
        filters_applied = {"employee_id": employee_id, "from_date": from_date, "to_date": to_date}
        return await list_export.build_export(format, db, current_user, "Attendance", _LIST_COLUMNS, export_rows, filters_applied)

    return list(rows)


@router.post("", response_model=AttendanceRecordOut, status_code=status.HTTP_201_CREATED)
async def record_attendance(
    body: AttendanceRecordWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="record")),
) -> AttendanceRecord:
    employee = await db.get(Employee, body.employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Employee not found")
    await org_scope.assert_employee_in_scope(db, current_user, perms, body.employee_id)
    fy = await get_current_financial_year(db)
    policy = await resolve_policy_for_employee(db, employee, body.attendance_date)
    if policy is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No Work Week Policy covers this employee on this date")

    mandatory_holiday = (
        await db.execute(
            select(Holiday).where(Holiday.holiday_date == body.attendance_date, Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True))
        )
    ).scalar_one_or_none()
    optional_holiday = (
        await db.execute(
            select(Holiday).where(Holiday.holiday_date == body.attendance_date, Holiday.holiday_type == "OPTIONAL", Holiday.is_active.is_(True))
        )
    ).scalar_one_or_none()
    saturday_override_row = (
        await db.execute(
            select(SaturdayOverride).where(
                SaturdayOverride.saturday_date == body.attendance_date,
                (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None)),
            )
        )
    ).scalars().first()

    policy_snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )
    override_snapshot = (
        SaturdayOverrideSnapshot(override_to=saturday_override_row.override_to, hours_required=saturday_override_row.hours_required)
        if saturday_override_row is not None else None
    )
    day = resolve_day(
        body.attendance_date, policy_snapshot, is_mandatory_holiday=mandatory_holiday is not None,
        is_optional_holiday=optional_holiday is not None, saturday_override=override_snapshot,
        is_last_saturday_of_month=_is_last_saturday(body.attendance_date),
    )
    hours = resolve_hours(
        body.check_in_time, body.check_out_time, body.break_hours, day.required_hours, policy_snapshot, spans_midnight=body.spans_midnight
    )

    row = AttendanceRecord(
        id=str(uuid.uuid4()), employee_id=employee.id, attendance_date=body.attendance_date, financial_year_id=fy.id,
        work_week_policy_id=policy.id, policy_name_snapshot=policy.policy_name, day_type=day.day_type,
        saturday_ordinal=day.saturday_ordinal, holiday_id=(mandatory_holiday or optional_holiday).id if (mandatory_holiday or optional_holiday) else None,
        saturday_override_id=saturday_override_row.id if saturday_override_row else None,
        check_in_time=body.check_in_time, check_out_time=body.check_out_time, spans_midnight=body.spans_midnight,
        gross_hours=hours.gross_hours, break_hours=body.break_hours, required_hours=day.required_hours,
        day_status=hours.day_status, net_hours_per_day_snapshot=policy.net_working_hours_per_day,
        grace_window_minutes_snapshot=policy.grace_window_minutes, half_day_threshold_hours_snapshot=policy.half_day_threshold_hours,
        source="MANUAL_ENTRY", recorded_by_user_id=current_user.id, recorded_by_label=current_user.full_name, note=body.note,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    await db.flush()

    # Auto-link an Approved Compensatory Hour Request whose make-up date is
    # this one — the request itself stays 'APPROVED' (the CHECK constraint
    # has no distinct 'COMPLETED' state); only its own worked-hours fields
    # are filled in once the make-up day is actually recorded.
    comp_request = (
        await db.execute(
            select(CompensatoryHourRequest).where(
                CompensatoryHourRequest.employee_id == employee.id, CompensatoryHourRequest.make_up_date == body.attendance_date,
                CompensatoryHourRequest.status == "APPROVED", CompensatoryHourRequest.makeup_attendance_record_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    if comp_request is not None:
        row.is_compensatory_makeup_day = True
        row.compensatory_credit_hours = min(hours.net_worked_hours, comp_request.hours_to_work)
        comp_request.makeup_attendance_record_id = row.id
        comp_request.hours_actually_worked = hours.net_worked_hours
        comp_request.hours_credited = min(hours.net_worked_hours, comp_request.hours_to_work)
        comp_request.residual_shortfall_hours = max(Decimal("0"), comp_request.hours_to_work - hours.net_worked_hours)
        comp_request.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Attendance already recorded for this employee on this date") from exc
    await db.refresh(row)
    return row
