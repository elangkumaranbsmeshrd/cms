"""Attendance resolution (Employee §2.2 Leave & Attendance Summary, Masters
§3.20) — isolated and unit-tested, no HTTP/ORM coupling, the same discipline
as tax_engine.py. This is exactly the "genuinely complex, multi-table
derivation" case the Phase 2 migration's docstring flags as better served by
a tested Python function than a MySQL trigger body: resolving one attendance
day reads the covering Work Week policy, its Saturday rule, the Holiday
calendar and any dated Saturday override together.

"The day is not decided by whether someone turned up" — Employee §2.2. Day
Type and Required Hours are resolved from the calendar and the policy alone;
Day Status is then resolved from actual worked hours against that target.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time
from decimal import ROUND_HALF_UP, Decimal

HOURS_PLACES = Decimal("0.01")


def _hours(value: Decimal) -> Decimal:
    return value.quantize(HOURS_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class WorkWeekPolicySnapshot:
    net_working_hours_per_day: Decimal
    grace_window_minutes: int
    half_day_threshold_hours: Decimal | None
    weekly_off_days: str  # SUNDAY | SAT_SUN | SUN_ALT_SAT | ROTATIONAL_ONE | FRIDAY | NONE
    saturday_rule: str  # ODD_WORKING | EVEN_WORKING | ALL_WORKING | ALL_OFF | FIRST_ONLY | LAST_ONLY | CUSTOM
    working_saturday_hours_mode: str | None  # FULL | HALF | CUSTOM
    custom_saturday_hours: Decimal | None
    mandatory_holiday_overrides_saturday: bool


@dataclass(frozen=True)
class SaturdayOverrideSnapshot:
    override_to: str  # WORKING | WEEK_OFF
    hours_required: Decimal


@dataclass(frozen=True)
class DayResolution:
    day_type: str
    saturday_ordinal: int | None
    required_hours: Decimal


@dataclass(frozen=True)
class HoursResolution:
    gross_hours: Decimal
    net_worked_hours: Decimal
    balance_hours: Decimal
    day_status: str


_ISO_WEEKDAY_SATURDAY = 6
_ISO_WEEKDAY_SUNDAY = 7
_ISO_WEEKDAY_FRIDAY = 5


def saturday_ordinal(d: date) -> int:
    return (d.day - 1) // 7 + 1


def is_weekly_off(d: date, weekly_off_days: str) -> bool:
    iso = d.isoweekday()
    if weekly_off_days == "NONE":
        return False
    if weekly_off_days == "SUNDAY":
        return iso == _ISO_WEEKDAY_SUNDAY
    if weekly_off_days == "FRIDAY":
        return iso == _ISO_WEEKDAY_FRIDAY
    if weekly_off_days == "SAT_SUN":
        return iso in (_ISO_WEEKDAY_SATURDAY, _ISO_WEEKDAY_SUNDAY)
    if weekly_off_days in ("SUN_ALT_SAT", "ROTATIONAL_ONE"):
        # Saturday's own on/off status is decided by the Saturday rule, not
        # here — this only covers the fixed weekly off day (Sunday).
        return iso == _ISO_WEEKDAY_SUNDAY
    return False


def saturday_is_working_by_pattern(ordinal: int, saturday_rule: str) -> bool:
    if saturday_rule == "ALL_WORKING":
        return True
    if saturday_rule == "ALL_OFF":
        return False
    if saturday_rule == "ODD_WORKING":
        return ordinal % 2 == 1
    if saturday_rule == "EVEN_WORKING":
        return ordinal % 2 == 0
    if saturday_rule == "FIRST_ONLY":
        return ordinal == 1
    if saturday_rule == "LAST_ONLY":
        # Caller must resolve "is this the last Saturday of the month"
        # itself when it matters (see resolve_day's is_last_saturday arg);
        # treated as non-working here when that context isn't provided.
        return False
    return False  # CUSTOM — the override table IS the answer, not the pattern


def resolve_day(
    attendance_date: date,
    policy: WorkWeekPolicySnapshot,
    *,
    is_mandatory_holiday: bool,
    is_optional_holiday: bool,
    saturday_override: SaturdayOverrideSnapshot | None,
    is_last_saturday_of_month: bool = False,
) -> DayResolution:
    """Day Type and Required Hours — Masters §3.20's stated precedence:
    Mandatory holiday > Saturday override > Saturday pattern > weekly off >
    working day. An Optional holiday does NOT override the Saturday/weekly
    pattern — it only matters if the employee chooses to take it (a Leave
    module concern, not this function's).
    """
    is_saturday = attendance_date.isoweekday() == _ISO_WEEKDAY_SATURDAY
    ordinal = saturday_ordinal(attendance_date) if is_saturday else None

    if is_mandatory_holiday and (not is_saturday or policy.mandatory_holiday_overrides_saturday):
        return DayResolution("MANDATORY_HOLIDAY", ordinal, Decimal("0"))

    if is_saturday:
        if saturday_override is not None:
            working = saturday_override.override_to == "WORKING"
            hours = saturday_override.hours_required if working else Decimal("0")
            return DayResolution("WORKING_SATURDAY" if working else "WEEKLY_OFF", ordinal, hours)

        pattern_working = (
            True
            if policy.saturday_rule == "LAST_ONLY" and is_last_saturday_of_month
            else saturday_is_working_by_pattern(ordinal, policy.saturday_rule)
        )
        if not pattern_working:
            return DayResolution("WEEKLY_OFF", ordinal, Decimal("0"))

        if policy.working_saturday_hours_mode == "HALF":
            hours = policy.net_working_hours_per_day / 2
        elif policy.working_saturday_hours_mode == "CUSTOM":
            hours = policy.custom_saturday_hours or Decimal("0")
        else:  # FULL or unset
            hours = policy.net_working_hours_per_day
        return DayResolution("WORKING_SATURDAY", ordinal, hours)

    if is_weekly_off(attendance_date, policy.weekly_off_days):
        return DayResolution("WEEKLY_OFF", None, Decimal("0"))

    if is_optional_holiday:
        return DayResolution("OPTIONAL_HOLIDAY", None, policy.net_working_hours_per_day)

    return DayResolution("WORKING_DAY", None, policy.net_working_hours_per_day)


def resolve_hours(
    check_in: time | None,
    check_out: time | None,
    break_hours: Decimal,
    required_hours: Decimal,
    policy: WorkWeekPolicySnapshot,
    *,
    spans_midnight: bool = False,
) -> HoursResolution:
    """Gross/Net/Balance and the resulting Day Status. "Record Attendance
    records hours, not presence" (Employee §2.2) — every figure here is
    derived from the two times typed in, never typed directly.
    """
    if check_in is None or check_out is None:
        gross = Decimal("0")
    else:
        start = check_in.hour * 60 + check_in.minute + check_in.second / 60
        end = check_out.hour * 60 + check_out.minute + check_out.second / 60
        if spans_midnight or end < start:
            end += 24 * 60
        gross = Decimal(str((end - start) / 60))

    net = gross - break_hours
    balance = net - required_hours

    if required_hours == 0:
        status = "NOT_REQUIRED"
    elif net >= required_hours:
        status = "FULL_DAY"
    elif policy.grace_window_minutes > 0 and net >= required_hours - Decimal(policy.grace_window_minutes) / 60:
        status = "FULL_DAY_GRACE"
    elif policy.half_day_threshold_hours is not None and net >= policy.half_day_threshold_hours:
        status = "HALF_DAY"
    else:
        status = "ABSENT"

    return HoursResolution(
        gross_hours=_hours(gross),
        net_worked_hours=_hours(net),
        balance_hours=_hours(balance),
        day_status=status,
    )
