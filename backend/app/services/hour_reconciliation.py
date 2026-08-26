"""Aggregates existing attendance_records + policy configuration into a
monthly hour reconciliation (Payroll §2.4) — shared by the standalone
Attendance & Time Basis view and Run Payroll's own calculation, so both
read exactly the same numbers for the same employee+period. Unlike
attendance_engine.py/leave_engine.py/payroll_engine.py, this DOES touch the
database (a monthly aggregate genuinely needs to read existing attendance
rows) — the same DB-touching-service convention already used by
numbering.py, org_scope.py and policy_resolution.py.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import AttendanceRecord, Employee
from app.models.leave import CompensatoryHourRequest
from app.models.masters import Holiday, SaturdayOverride, WorkWeekPolicy
from app.services.attendance_engine import SaturdayOverrideSnapshot, WorkWeekPolicySnapshot, resolve_day
from app.services.leave_engine import calculate_working_days
from app.services.policy_resolution import resolve_policy_for_employee


@dataclass(frozen=True)
class HourReconciliationResult:
    policy: WorkWeekPolicy
    weekday_count: int
    working_saturdays_count: int
    mandatory_holidays_count: int
    working_days: Decimal
    required_hours: Decimal
    worked_hours: Decimal
    comp_credit_hours: Decimal
    leave_credit_hours: Decimal
    comp_pending_hours: Decimal
    comp_approved_hours: Decimal
    comp_rejected_hours: Decimal
    header_note: str


async def reconcile_employee_period(db: AsyncSession, employee: Employee, pay_period_start: date, pay_period_end: date) -> HourReconciliationResult | None:
    policy = await resolve_policy_for_employee(db, employee, pay_period_start)
    if policy is None:
        return None

    mandatory_holidays = (
        await db.execute(
            select(Holiday.holiday_date).where(
                Holiday.holiday_type == "MANDATORY", Holiday.is_active.is_(True),
                Holiday.holiday_date >= pay_period_start, Holiday.holiday_date <= pay_period_end,
            )
        )
    ).scalars().all()
    mandatory_dates = set(mandatory_holidays)
    optional_holidays = set(
        (
            await db.execute(
                select(Holiday.holiday_date).where(
                    Holiday.holiday_type == "OPTIONAL", Holiday.is_active.is_(True),
                    Holiday.holiday_date >= pay_period_start, Holiday.holiday_date <= pay_period_end,
                )
            )
        ).scalars()
    )
    overrides = (
        await db.execute(
            select(SaturdayOverride).where(
                SaturdayOverride.saturday_date >= pay_period_start, SaturdayOverride.saturday_date <= pay_period_end,
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
    working_days = calculate_working_days(pay_period_start, pay_period_end, False, policy_snapshot, mandatory_dates, override_dates)

    # Header-strip breakdown (weekdays vs working Saturdays vs Mandatory
    # holidays) — a day-by-day classification, purely for the informational
    # note; the authoritative working-day COUNT above already comes from
    # leave_engine.calculate_working_days, the same function Leave itself uses.
    weekday_count = 0
    working_saturdays_count = 0
    mandatory_count = 0
    current = pay_period_start
    while current <= pay_period_end:
        override_snapshot = None
        if current in override_dates:
            row = next((o for o in overrides if o.saturday_date == current), None)
            if row is not None:
                override_snapshot = SaturdayOverrideSnapshot(override_to=row.override_to, hours_required=row.hours_required)
        last_day_of_month = calendar.monthrange(current.year, current.month)[1]
        day = resolve_day(
            current, policy_snapshot, is_mandatory_holiday=current in mandatory_dates, is_optional_holiday=current in optional_holidays,
            saturday_override=override_snapshot, is_last_saturday_of_month=(current.day + 7 > last_day_of_month),
        )
        if day.day_type == "MANDATORY_HOLIDAY":
            mandatory_count += 1
        elif day.day_type == "WORKING_SATURDAY":
            working_saturdays_count += 1
        elif day.day_type == "WORKING_DAY":
            weekday_count += 1
        current += timedelta(days=1)

    header_note = (
        f"{weekday_count} weekdays + {working_saturdays_count} working Saturdays "
        f"= {working_days} working days x {policy.net_working_hours_per_day} net hours = {working_days * policy.net_working_hours_per_day} required hours "
        f"(policy: {policy.policy_name}, Saturday rule: {policy.saturday_rule})"
    )

    attendance_rows = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.employee_id == employee.id, AttendanceRecord.attendance_date >= pay_period_start, AttendanceRecord.attendance_date <= pay_period_end
            )
        )
    ).scalars().all()
    worked_hours = sum((r.net_worked_hours for r in attendance_rows), Decimal("0"))
    comp_credit_hours = sum((r.compensatory_credit_hours for r in attendance_rows), Decimal("0"))
    leave_credit_hours = sum((r.leave_credit_hours for r in attendance_rows), Decimal("0"))

    comp_requests = (
        await db.execute(
            select(CompensatoryHourRequest).where(
                CompensatoryHourRequest.employee_id == employee.id,
                CompensatoryHourRequest.shortfall_date >= pay_period_start, CompensatoryHourRequest.shortfall_date <= pay_period_end,
            )
        )
    ).scalars().all()
    comp_pending_hours = sum((r.hours_to_work for r in comp_requests if r.status == "PENDING"), Decimal("0"))
    comp_approved_hours = sum((r.hours_to_work for r in comp_requests if r.status == "APPROVED"), Decimal("0"))
    comp_rejected_hours = sum((r.hours_to_work for r in comp_requests if r.status == "REJECTED"), Decimal("0"))

    return HourReconciliationResult(
        policy=policy, weekday_count=weekday_count, working_saturdays_count=working_saturdays_count, mandatory_holidays_count=mandatory_count,
        working_days=working_days, required_hours=working_days * policy.net_working_hours_per_day, worked_hours=worked_hours,
        comp_credit_hours=comp_credit_hours, leave_credit_hours=leave_credit_hours, comp_pending_hours=comp_pending_hours,
        comp_approved_hours=comp_approved_hours, comp_rejected_hours=comp_rejected_hours, header_note=header_note,
    )
