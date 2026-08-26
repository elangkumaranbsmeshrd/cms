"""Payroll §2.4 Attendance & Time Basis — five documented tabs: Monthly
Summary, Day-wise Log, Payroll Impact, Compensation, Biometric Feed. Computed
on demand from existing attendance_records via app/services/
hour_reconciliation.py, the same function Run Payroll itself uses, so the
figures an HR/Manager reviewer sees here can never disagree with what a
payroll run would calculate for the same period — UNLESS that period has
already been Processed, in which case a locked MonthlyHourReconciliation row
(materialized by payroll_runs.confirm_payroll_run) is read back verbatim
instead. Live recomputation would otherwise let a Work Week Policy edit made
AFTER a period is Processed silently change what this screen shows for that
period, disagreeing with the (immutable) Payslip it's meant to explain.

Day-wise Log has no such lock — each AttendanceRecord row already snapshots
its own day_type/required_hours/policy figures at the moment it was entered
(see 0003_employee_leave.py), so a later policy edit can never retroactively
change what a past day showed. Every calendar day in the period is listed
(not just days with a row), so an unrecorded working day still surfaces as
its own line — resolved with the exact same attendance_engine.resolve_day /
resolve_hours functions record_attendance (app/api/v1/attendance.py) uses,
just fed a blank check-in/check-out.

Biometric Feed is the one tab §2.4/§3.5 itself calls "planned" pending
hardware/integration — deliberately left as a real-data stub (actual counts
of AttendanceRecord.source and Employee.biometric_enrollment_id, both fields
the schema already carries per §3.5's "manual entry writes to the same
fields a device will") rather than fabricated device readings.

Role Access (§2.4, verbatim): Super Admin full; HR view, company-wide;
Manager view, Team scope only; Accountant and Employee have NO access to
this screen at all (Accountant sees the consequence on the payslip register,
not raw hours; an Employee's own hours reach them through their payslip and
their own compensatory requests) — reusing employee.attendance's RBAC
'record' action would be wrong here, so this is its own screen key, with no
sub-actions (view-only throughout, same as the existing Monthly Summary tab).
"""

import calendar
from datetime import date as date_type, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import AttendanceRecord, Employee, SalaryStructure
from app.models.leave import CompensatoryHourRequest
from app.models.masters import Holiday, PayCycle, SaturdayOverride
from app.models.payroll import MonthlyHourReconciliation
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.services import list_export, org_scope
from app.services.attendance_engine import SaturdayOverrideSnapshot, WorkWeekPolicySnapshot, resolve_day, resolve_hours
from app.services.hour_reconciliation import reconcile_employee_period
from app.services.payroll_engine import convert_shortfall, prorate_gross_for_partial_period, resolve_pay_period
from app.services.pdf_engine import ColumnSpec
from app.services.policy_resolution import resolve_policy_for_employee

router = APIRouter(prefix="/payroll/attendance", tags=["payroll"])
SCREEN = "payroll.attendance_time_basis"

_MONTHLY_SUMMARY_COLUMNS = [
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("employee_name", "Employee Name"),
    ColumnSpec("required_hours", "Req. Hours", align="right"),
    ColumnSpec("worked_hours", "Worked", align="right"),
    ColumnSpec("comp_credit_hours", "of which Comp", align="right"),
    ColumnSpec("leave_credit_hours", "Leave Cr.", align="right"),
    ColumnSpec("credited_hours", "Credited", align="right"),
    ColumnSpec("balance_hours", "Balance", align="right"),
    ColumnSpec("payable_days", "Payable Days", align="right"),
    ColumnSpec("status", "Status"),
]

_DAY_WISE_LOG_COLUMNS = [
    ColumnSpec("date", "Date"),
    ColumnSpec("day", "Day"),
    ColumnSpec("day_type", "Day Type"),
    ColumnSpec("check_in_time", "In"),
    ColumnSpec("check_out_time", "Out"),
    ColumnSpec("break_hours", "Break", align="right"),
    ColumnSpec("required_hours", "Required", align="right"),
    ColumnSpec("worked_hours", "Worked", align="right"),
    ColumnSpec("comp_hours", "Comp", align="right"),
    ColumnSpec("balance_hours", "Balance", align="right"),
    ColumnSpec("status", "Status"),
    ColumnSpec("note", "Note"),
]

_PAYROLL_IMPACT_COLUMNS = [
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("employee_name", "Employee Name"),
    ColumnSpec("hours_short", "Hours Short", align="right"),
    ColumnSpec("comp_pending_hours", "Comp Pending", align="right"),
    ColumnSpec("net_short_hours", "Net Short", align="right"),
    ColumnSpec("lop_days_net_of_pending", "LOP Days", align="right"),
    ColumnSpec("estimated_deduction", "Est. Deduction", align="left"),
    ColumnSpec("status", "Status"),
    ColumnSpec("next_step", "Next Step"),
]

_COMPENSATION_COLUMNS = [
    ColumnSpec("request_number", "Request Number"),
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("employee_name", "Employee Name"),
    ColumnSpec("shortfall_date", "Shortfall Date"),
    ColumnSpec("hours_short", "Hours Short", align="right"),
    ColumnSpec("make_up_date", "Make-up Date"),
    ColumnSpec("hours_to_work", "Hours To Work", align="right"),
    ColumnSpec("hours_credited", "Hours Credited", align="right"),
    ColumnSpec("residual_shortfall_hours", "Residual Shortfall", align="right"),
    ColumnSpec("status", "Status"),
]

# ck_hourrecon_status only permits these three machine codes on the stored
# row — map back to the exact display prose §2.4 uses ("Status is Met,
# Short — compensable..., or Short — payroll impact") so a locked row reads
# identically to what live recomputation would have shown.
_STATUS_DISPLAY = {"MET": "Met", "SHORT_COMPENSABLE": "Short — compensable", "SHORT_PAYROLL_IMPACT": "Short — payroll impact"}


def _is_last_saturday(d: date_type) -> bool:
    last_day_of_month = calendar.monthrange(d.year, d.month)[1]
    return d.day + 7 > last_day_of_month


def _employee_name(employee: Employee) -> str:
    return f"{employee.first_name} {employee.last_name or ''}".strip()


async def _resolve_active_period(db: AsyncSession, period_month: int, period_year: int):
    cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    if cycle is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No active Pay Cycle configured")
    return resolve_pay_period(period_month, period_year, cycle.cycle_type, cycle.start_day, cycle.end_day, cycle.salary_credit_day)


async def _scoped_employees(
    db: AsyncSession, current_user: User, perms: PermissionSet, *, department_id: str | None, employee_id: str | None,
    period_start: date_type, period_end: date_type, work_week_policy_id: str | None = None,
) -> list[Employee]:
    # Same employment-window/period overlap test as payroll_runs.py's
    # _calculate_employee (days_employed <= 0 -> EXCLUDED_NOT_ACTIVE): joined
    # after the period ended, or fully exited before it began, is excluded
    # even if employment_status still reads ACTIVE/ON_NOTICE — otherwise this
    # tab shows a shortfall/deduction figure for someone Run Payroll would
    # never have included for this period at all.
    stmt = (
        select(Employee)
        .where(Employee.employment_status.in_(("ACTIVE", "ON_NOTICE")))
        .where(Employee.joining_date <= period_end)
        .where((Employee.exit_date.is_(None)) | (Employee.exit_date >= period_start))
    )
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = stmt.where(Employee.id.in_(reports))
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if employee_id:
        stmt = stmt.where(Employee.id == employee_id)
    employees = list((await db.execute(stmt)).scalars().all())
    # §2.4: "Work Week Policy — the last one because with several policies in
    # play 'who is short' is meaningless without knowing which target they
    # were measured against." No work_week_policy_id column exists on
    # Employee (the policy is resolved per-employee by specificity — Masters
    # §3.20's Designation > Department > Employment Type > Company-Wide rule,
    # same resolver Leave uses), so this can't push down into the SELECT
    # above; resolved and filtered here instead, same "server does what it
    # can" convention as every other filter with no backing column.
    if work_week_policy_id:
        kept = []
        for employee in employees:
            policy = await resolve_policy_for_employee(db, employee, period_start)
            if policy is not None and policy.id == work_week_policy_id:
                kept.append(employee)
        employees = kept
    return employees


# ======================================================== MONTHLY SUMMARY
@router.get("/monthly-summary", response_model=None)
async def monthly_summary(
    period_month: int,
    period_year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    department_id: str | None = Query(None),
    employee_id: str | None = Query(None),
    work_week_policy_id: str | None = Query(None),
    hour_status: str | None = Query(None, description="Met | Short — compensable | Short — payroll impact"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    resolution = await _resolve_active_period(db, period_month, period_year)
    employees = await _scoped_employees(
        db, current_user, perms, department_id=department_id, employee_id=employee_id,
        period_start=resolution.period_start, period_end=resolution.period_end, work_week_policy_id=work_week_policy_id,
    )

    locked_by_employee = {
        r.employee_id: r
        for r in (
            await db.execute(
                select(MonthlyHourReconciliation).where(
                    MonthlyHourReconciliation.period_month == period_month, MonthlyHourReconciliation.period_year == period_year,
                    MonthlyHourReconciliation.is_locked.is_(True),
                )
            )
        ).scalars().all()
    }

    rows = []
    for employee in employees:
        locked = locked_by_employee.get(employee.id)
        if locked is not None:
            rows.append({
                "employee_id": employee.id, "employee_code": employee.employee_code, "employee_name": _employee_name(employee),
                "required_hours": locked.required_hours, "worked_hours": locked.worked_hours, "comp_credit_hours": locked.comp_credit_hours,
                "leave_credit_hours": locked.leave_credit_hours, "credited_hours": locked.credited_hours, "balance_hours": locked.balance_hours,
                "comp_pending_hours": locked.comp_pending_hours, "hours_short": locked.hours_short, "net_short_hours": locked.net_short_hours,
                "payable_days": locked.working_days, "status": _STATUS_DISPLAY.get(locked.status, locked.status), "header_note": locked.next_step_note, "is_locked": True,
            })
            continue
        recon = await reconcile_employee_period(db, employee, resolution.period_start, resolution.period_end)
        if recon is None:
            continue
        hours_short = max(recon.required_hours - (recon.worked_hours + recon.leave_credit_hours), 0)
        net_short = max(hours_short - recon.comp_pending_hours, 0)
        if net_short <= 0:
            resolved_status = "Met"
        elif net_short <= recon.policy.net_working_hours_per_day:
            resolved_status = "Short — compensable"
        else:
            resolved_status = "Short — payroll impact"
        rows.append({
            "employee_id": employee.id, "employee_code": employee.employee_code, "employee_name": _employee_name(employee),
            "required_hours": recon.required_hours, "worked_hours": recon.worked_hours, "comp_credit_hours": recon.comp_credit_hours,
            "leave_credit_hours": recon.leave_credit_hours, "credited_hours": recon.worked_hours + recon.leave_credit_hours,
            "balance_hours": recon.worked_hours + recon.leave_credit_hours - recon.required_hours,
            "comp_pending_hours": recon.comp_pending_hours, "hours_short": hours_short, "net_short_hours": net_short,
            "payable_days": recon.working_days, "status": resolved_status, "header_note": recon.header_note, "is_locked": False,
        })

    # §2.4: "Hour Status (not yet wired)." Derived per-row above (from either
    # the locked snapshot or a live reconciliation), never a stored column,
    # so filtered here rather than pushed into a WHERE clause — same
    # Python-side convention work_week_policy_id above already uses.
    if hour_status:
        rows = [r for r in rows if r["status"] == hour_status]

    if format:
        filters_applied = {
            "period_month": period_month, "period_year": period_year, "department_id": department_id,
            "employee_id": employee_id, "work_week_policy_id": work_week_policy_id, "hour_status": hour_status,
        }
        return await list_export.build_export(format, db, current_user, "Attendance — Monthly Summary", _MONTHLY_SUMMARY_COLUMNS, rows, filters_applied)
    return rows


# ========================================================== DAY-WISE LOG
@router.get("/day-wise-log", response_model=None)
async def day_wise_log(
    period_month: int,
    period_year: int,
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.4: "Rows [in Monthly Summary] open that person's day-wise log" —
    one row per calendar day of the resolved pay period, Date/Day/Day Type/
    In/Out/Break/Required/Worked/Comp/Balance/Status/Note. Every day in the
    period is listed, whether or not an AttendanceRecord exists for it —
    a working day with no record is resolved the same way record_attendance
    resolves a genuine entry (attendance_engine.resolve_hours with a blank
    check-in/check-out), so it correctly shows as ABSENT rather than being
    silently omitted, and a zero-required day (Sunday, Mandatory holiday,
    non-working Saturday) correctly costs nothing either way.
    """
    resolution = await _resolve_active_period(db, period_month, period_year)
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Employee not found")
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)

    policy = await resolve_policy_for_employee(db, employee, resolution.period_start)
    if policy is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="No Work Week Policy covers this employee on this date")

    mandatory_dates = set(
        (
            await db.execute(
                select(Holiday.holiday_date).where(
                    Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True),
                    Holiday.holiday_date >= resolution.period_start, Holiday.holiday_date <= resolution.period_end,
                )
            )
        ).scalars()
    )
    optional_dates = set(
        (
            await db.execute(
                select(Holiday.holiday_date).where(
                    Holiday.holiday_type == "OPTIONAL", Holiday.is_active.is_(True),
                    Holiday.holiday_date >= resolution.period_start, Holiday.holiday_date <= resolution.period_end,
                )
            )
        ).scalars()
    )
    overrides = (
        await db.execute(
            select(SaturdayOverride).where(
                SaturdayOverride.saturday_date >= resolution.period_start, SaturdayOverride.saturday_date <= resolution.period_end,
                (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None)),
            )
        )
    ).scalars().all()
    override_by_date = {o.saturday_date: o for o in overrides}

    records = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.employee_id == employee_id, AttendanceRecord.attendance_date >= resolution.period_start,
                AttendanceRecord.attendance_date <= resolution.period_end,
            )
        )
    ).scalars().all()
    record_by_date = {r.attendance_date: r for r in records}

    policy_snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day, grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours, weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule, working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours, mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )

    rows = []
    current = resolution.period_start
    while current <= resolution.period_end:
        override_row = override_by_date.get(current)
        override_snapshot = SaturdayOverrideSnapshot(override_to=override_row.override_to, hours_required=override_row.hours_required) if override_row else None
        day = resolve_day(
            current, policy_snapshot, is_mandatory_holiday=current in mandatory_dates, is_optional_holiday=current in optional_dates,
            saturday_override=override_snapshot, is_last_saturday_of_month=_is_last_saturday(current),
        )
        record = record_by_date.get(current)
        if record is not None:
            rows.append({
                "date": current, "day": current.strftime("%A"), "day_type": record.day_type,
                "check_in_time": record.check_in_time, "check_out_time": record.check_out_time,
                "break_hours": record.break_hours, "required_hours": record.required_hours,
                "worked_hours": record.net_worked_hours, "comp_hours": record.compensatory_credit_hours,
                "balance_hours": record.balance_hours, "status": record.day_status, "note": record.note,
            })
        else:
            hours = resolve_hours(None, None, Decimal("0"), day.required_hours, policy_snapshot)
            rows.append({
                "date": current, "day": current.strftime("%A"), "day_type": day.day_type,
                "check_in_time": None, "check_out_time": None, "break_hours": Decimal("0"), "required_hours": day.required_hours,
                "worked_hours": Decimal("0"), "comp_hours": Decimal("0"), "balance_hours": hours.balance_hours,
                "status": hours.day_status, "note": None,
            })
        current += timedelta(days=1)

    if format:
        filters_applied = {"period_month": period_month, "period_year": period_year, "employee_id": employee_id}
        title = f"Day-wise Attendance Log — {employee.employee_code}"
        return await list_export.build_export(format, db, current_user, title, _DAY_WISE_LOG_COLUMNS, rows, filters_applied)
    return rows


# ======================================================== PAYROLL IMPACT
@router.get("/payroll-impact", response_model=None)
async def payroll_impact(
    period_month: int,
    period_year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    department_id: str | None = Query(None),
    employee_id: str | None = Query(None),
    work_week_policy_id: str | None = Query(None),
    hour_status: str | None = Query(None, description="Met | Short — compensable | Short — payroll impact"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.4: "the only tab that moves money, and the handoff to Run Payroll:
    Hours Short, Comp Pending, Net Short, LOP Days (net of pending), Est.
    Deduction, and a plainly-worded next step per person." Uses the SAME
    payroll_engine.convert_shortfall a real payroll run prices a shortfall
    with (§2.4 "What a shortfall does": priced with the same per-day rate as
    A115), fed the SAME prorated gross_pay a mid-period joiner/exit would get
    from Run Payroll (payroll_runs.py's days_employed/prorate_gross_for_
    partial_period logic, reproduced here), so this preview can never
    disagree with what Run Payroll would actually deduct for an unprocessed
    period. A Processed period instead reads its locked
    MonthlyHourReconciliation row verbatim, same rule as Monthly Summary.
    """
    resolution = await _resolve_active_period(db, period_month, period_year)
    total_days_in_period = Decimal((resolution.period_end - resolution.period_start).days + 1)
    employees = await _scoped_employees(
        db, current_user, perms, department_id=department_id, employee_id=employee_id,
        period_start=resolution.period_start, period_end=resolution.period_end, work_week_policy_id=work_week_policy_id,
    )

    locked_by_employee = {
        r.employee_id: r
        for r in (
            await db.execute(
                select(MonthlyHourReconciliation).where(
                    MonthlyHourReconciliation.period_month == period_month, MonthlyHourReconciliation.period_year == period_year,
                    MonthlyHourReconciliation.is_locked.is_(True),
                )
            )
        ).scalars().all()
    }

    rows = []
    for employee in employees:
        locked = locked_by_employee.get(employee.id)
        if locked is not None:
            rows.append({
                "employee_id": employee.id, "employee_code": employee.employee_code, "employee_name": _employee_name(employee),
                "hours_short": locked.hours_short, "comp_pending_hours": locked.comp_pending_hours, "net_short_hours": locked.net_short_hours,
                "lop_days_net_of_pending": locked.lop_days_net_of_pending, "estimated_deduction": locked.estimated_deduction,
                "status": _STATUS_DISPLAY.get(locked.status, locked.status), "next_step": locked.next_step_note, "is_locked": True,
            })
            continue
        recon = await reconcile_employee_period(db, employee, resolution.period_start, resolution.period_end)
        if recon is None:
            continue
        hours_short = max(recon.required_hours - (recon.worked_hours + recon.leave_credit_hours), Decimal("0"))
        net_short = max(hours_short - recon.comp_pending_hours, Decimal("0"))
        structure = (
            await db.execute(select(SalaryStructure).where(SalaryStructure.employee_id == employee.id, SalaryStructure.effective_to.is_(None)))
        ).scalar_one_or_none()
        # Same days_employed derivation as payroll_runs.py's _calculate_employee
        # (§ its "Moved ahead of everything else that prices off it" comment) —
        # a mid-period joiner/exit must be priced off the PRORATED gross, not
        # the raw structure.gross_monthly, or this preview's Est. Deduction
        # won't match what Run Payroll actually deducts for that person.
        days_employed = total_days_in_period
        if employee.joining_date > resolution.period_start:
            days_employed = Decimal((resolution.period_end - employee.joining_date).days + 1)
        if employee.exit_date is not None and employee.exit_date < resolution.period_end:
            days_employed = min(days_employed, Decimal((employee.exit_date - max(employee.joining_date, resolution.period_start)).days + 1))
        gross_pay = (
            prorate_gross_for_partial_period(structure.gross_monthly, total_days_in_period, days_employed)
            if structure is not None else Decimal("0")
        )
        shortfall = convert_shortfall(
            net_short_hours=net_short, net_hours_per_day=recon.policy.net_working_hours_per_day, gross_pay=gross_pay,
            total_days_in_period=total_days_in_period, rule=recon.policy.uncompensated_shortfall_becomes,
        )
        if net_short <= 0:
            hour_status = "Met"
            next_step = "No action needed — hours are Met."
        elif net_short <= recon.policy.net_working_hours_per_day:
            hour_status = "Short — compensable"
            next_step = f"{net_short} hour(s) short, within one day's net hours — clears if a pending compensatory request is approved before the next payroll run, else converts to Loss of Pay."
        else:
            hour_status = "Short — payroll impact"
            next_step = f"{shortfall.lop_days} day(s) convert to Loss of Pay (est. ₹{shortfall.lop_deduction}) at the next payroll run unless compensated first."
        rows.append({
            "employee_id": employee.id, "employee_code": employee.employee_code, "employee_name": _employee_name(employee),
            "hours_short": hours_short, "comp_pending_hours": recon.comp_pending_hours, "net_short_hours": net_short,
            "lop_days_net_of_pending": shortfall.lop_days, "estimated_deduction": shortfall.lop_deduction,
            "status": hour_status, "next_step": next_step, "is_locked": False,
        })

    if hour_status:
        rows = [r for r in rows if r["status"] == hour_status]

    if format:
        filters_applied = {
            "period_month": period_month, "period_year": period_year, "department_id": department_id,
            "employee_id": employee_id, "work_week_policy_id": work_week_policy_id, "hour_status": hour_status,
        }
        return await list_export.build_export(format, db, current_user, "Attendance — Payroll Impact", _PAYROLL_IMPACT_COLUMNS, rows, filters_applied)
    return rows


# ========================================================== COMPENSATION
@router.get("/compensation", response_model=None)
async def compensation(
    period_month: int,
    period_year: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    department_id: str | None = Query(None),
    employee_id: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.4: "the period's compensatory requests, with a link to the live
    queue in Leave." Matched to the period the same way hour_reconciliation.
    py matches a compensatory request to a period — by shortfall_date, the
    same field Run Payroll's own comp_pending/comp_approved totals are keyed
    on — not make_up_date, which can legitimately fall in a different pay
    cycle window (§3.4's worked example). `leave_module_endpoint` on each row
    is the existing live queue (app/api/v1/compensatory_hours.py's own
    /approvals) this tab links out to, not a duplicate of it.
    """
    resolution = await _resolve_active_period(db, period_month, period_year)

    stmt = (
        select(CompensatoryHourRequest, Employee)
        .join(Employee, Employee.id == CompensatoryHourRequest.employee_id)
        .where(CompensatoryHourRequest.shortfall_date >= resolution.period_start, CompensatoryHourRequest.shortfall_date <= resolution.period_end)
    )
    if perms.mode == "view_team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=CompensatoryHourRequest.employee_id, owner_id=own_id, team_member_ids=reports)
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if employee_id:
        stmt = stmt.where(CompensatoryHourRequest.employee_id == employee_id)
    if status_filter:
        stmt = stmt.where(CompensatoryHourRequest.status == status_filter)

    pairs = (await db.execute(stmt.order_by(CompensatoryHourRequest.shortfall_date))).all()
    rows = [
        {
            "id": req.id, "request_number": req.request_number, "employee_id": req.employee_id,
            "employee_code": emp.employee_code, "employee_name": _employee_name(emp),
            "shortfall_date": req.shortfall_date, "hours_short": req.hours_short, "make_up_date": req.make_up_date,
            "hours_to_work": req.hours_to_work, "hours_credited": req.hours_credited, "residual_shortfall_hours": req.residual_shortfall_hours,
            "status": req.status, "routed_to_role": req.routed_to_role, "estimated_payroll_impact": req.estimated_payroll_impact,
            "leave_module_endpoint": "/compensatory-hours/approvals",
        }
        for req, emp in pairs
    ]

    if format:
        filters_applied = {
            "period_month": period_month, "period_year": period_year, "department_id": department_id,
            "employee_id": employee_id, "status": status_filter,
        }
        return await list_export.build_export(format, db, current_user, "Attendance — Compensation", _COMPENSATION_COLUMNS, rows, filters_applied)
    return rows


# ========================================================= BIOMETRIC FEED
@router.get("/biometric-feed")
async def biometric_feed(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict:
    """§2.4/§3.5, verbatim: "the planned input sources (biometric device,
    external HR system, geo-fenced mobile check-in) against the one that is
    live (manual entry). Manual entry writes to the same fields a device
    will, which is why the calculation is not waiting on hardware."

    DELIBERATE STUB — every figure below is real (an actual count of
    AttendanceRecord.source, grouped, and of Employee.biometric_enrollment_id
    being non-null), never a fabricated device reading. Both columns already
    exist in the schema for exactly this purpose (0003_employee_leave.py's
    ck_ar_source; Employee.biometric_enrollment_id) and simply have nothing
    but MANUAL_ENTRY rows and NULL enrollments today, because no device or
    integration has ever written to them — which is the honest state of a
    "planned" input source, not a gap in this endpoint.
    """
    counts = dict((await db.execute(select(AttendanceRecord.source, func.count(AttendanceRecord.id)).group_by(AttendanceRecord.source))).all())
    enrolled = (await db.execute(select(func.count(Employee.id)).where(Employee.biometric_enrollment_id.is_not(None)))).scalar_one()
    total_employees = (await db.execute(select(func.count(Employee.id)).where(Employee.employment_status.in_(("ACTIVE", "ON_NOTICE"))))).scalar_one()
    return {
        "sources": [
            {"source": "MANUAL_ENTRY", "label": "Manual Entry (Super Admin)", "input_status": "LIVE", "record_count": counts.get("MANUAL_ENTRY", 0)},
            {"source": "BIOMETRIC_DEVICE", "label": "Biometric Device", "input_status": "PLANNED", "record_count": counts.get("BIOMETRIC_DEVICE", 0)},
            {"source": "EXTERNAL_HR_SYSTEM", "label": "External HR System", "input_status": "PLANNED", "record_count": counts.get("EXTERNAL_HR_SYSTEM", 0)},
            {"source": "MOBILE_CHECKIN", "label": "Geo-fenced Mobile Check-in", "input_status": "PLANNED", "record_count": counts.get("MOBILE_CHECKIN", 0)},
        ],
        "employees_biometric_enrolled": enrolled,
        "employees_total": total_employees,
        "note": (
            "Biometric device, external HR system, and geo-fenced mobile check-in are planned input sources pending "
            "hardware/integration (§2.4, §3.5) — not yet live. Manual entry already writes to the same attendance "
            "fields a device will, so no downstream calculation (Required/Worked Hours, compensation, Loss of Pay) "
            "is waiting on this."
        ),
    }
