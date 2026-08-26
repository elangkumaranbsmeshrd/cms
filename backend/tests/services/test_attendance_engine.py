"""Attendance day-type/hours resolution — the precedence rule (Masters
§3.20: Mandatory holiday > Saturday override > Saturday pattern > weekly off
> working day) and the hour-band boundaries, tested directly rather than
trusted.
"""

from datetime import date, time
from decimal import Decimal

from app.services.attendance_engine import (
    SaturdayOverrideSnapshot,
    WorkWeekPolicySnapshot,
    resolve_day,
    resolve_hours,
)


def d(x: str) -> Decimal:
    return Decimal(x)


def _policy(**overrides) -> WorkWeekPolicySnapshot:
    base = dict(
        net_working_hours_per_day=d("8"),
        grace_window_minutes=15,
        half_day_threshold_hours=d("4"),
        weekly_off_days="SUNDAY",
        saturday_rule="ODD_WORKING",
        working_saturday_hours_mode="FULL",
        custom_saturday_hours=None,
        mandatory_holiday_overrides_saturday=True,
    )
    base.update(overrides)
    return WorkWeekPolicySnapshot(**base)


# ------------------------------------------------------------- day type / precedence
def test_ordinary_working_day():
    r = resolve_day(date(2026, 8, 12), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)  # a Wednesday
    assert r.day_type == "WORKING_DAY"
    assert r.required_hours == d("8")


def test_sunday_is_weekly_off():
    r = resolve_day(date(2026, 8, 16), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)  # a Sunday
    assert r.day_type == "WEEKLY_OFF"
    assert r.required_hours == d("0")


def test_odd_saturday_working_by_pattern():
    # 2026-08-01 is the 1st Saturday of August
    r = resolve_day(date(2026, 8, 1), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert r.day_type == "WORKING_SATURDAY"
    assert r.saturday_ordinal == 1
    assert r.required_hours == d("8")


def test_even_saturday_off_by_pattern():
    # 2026-08-08 is the 2nd Saturday
    r = resolve_day(date(2026, 8, 8), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert r.day_type == "WEEKLY_OFF"
    assert r.saturday_ordinal == 2


def test_mandatory_holiday_overrides_a_working_saturday():
    # 2026-08-15 is the 3rd Saturday (odd -> would be working) AND
    # Independence Day — the worked example from Masters §3.20 itself.
    r = resolve_day(date(2026, 8, 15), _policy(), is_mandatory_holiday=True, is_optional_holiday=False, saturday_override=None)
    assert r.day_type == "MANDATORY_HOLIDAY"
    assert r.required_hours == d("0")


def test_optional_holiday_does_not_override_saturday_pattern():
    # Optional holidays never override the pattern — an odd Saturday marked
    # Optional stays a working Saturday; taking it draws on leave balance
    # instead (a Leave module concern, not this function's).
    r = resolve_day(date(2026, 8, 1), _policy(), is_mandatory_holiday=False, is_optional_holiday=True, saturday_override=None)
    assert r.day_type == "WORKING_SATURDAY"


def test_saturday_override_beats_the_pattern():
    # 2026-08-08 (2nd Saturday, normally off) explicitly overridden to Working
    override = SaturdayOverrideSnapshot(override_to="WORKING", hours_required=d("8"))
    r = resolve_day(date(2026, 8, 8), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=override)
    assert r.day_type == "WORKING_SATURDAY"
    assert r.required_hours == d("8")


def test_saturday_override_can_also_turn_a_working_saturday_off():
    override = SaturdayOverrideSnapshot(override_to="WEEK_OFF", hours_required=d("0"))
    r = resolve_day(date(2026, 8, 1), _policy(), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=override)
    assert r.day_type == "WEEKLY_OFF"


def test_working_saturday_half_day_mode():
    r = resolve_day(date(2026, 8, 1), _policy(working_saturday_hours_mode="HALF"), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert r.required_hours == d("4")


def test_working_saturday_custom_hours_mode():
    r = resolve_day(date(2026, 8, 1), _policy(working_saturday_hours_mode="CUSTOM", custom_saturday_hours=d("5")), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert r.required_hours == d("5")


# --------------------------------------------------------------- hours / day status
def test_full_day_exactly_at_target():
    hours = resolve_hours(time(9, 0), time(18, 0), d("1"), d("8"), _policy())  # 9h gross - 1h break = 8h net
    assert hours.net_worked_hours == d("8.00")
    assert hours.day_status == "FULL_DAY"


def test_full_day_grace_just_inside_the_window():
    # required 8h, grace 15min -> 7h45m still counts as Full Day (grace)
    hours = resolve_hours(time(9, 0), time(17, 45), d("1"), d("8"), _policy())  # 8h45 gross - 1h break = 7h45 net
    assert hours.net_worked_hours == d("7.75")
    assert hours.day_status == "FULL_DAY_GRACE"


def test_just_outside_grace_window_is_half_day_not_full():
    # 7h44 net is 1 minute past the 15-minute grace boundary
    hours = resolve_hours(time(9, 0), time(17, 44), d("1"), d("8"), _policy())
    assert hours.day_status == "HALF_DAY"


def test_half_day_at_threshold_boundary():
    hours = resolve_hours(time(9, 0), time(14, 0), d("1"), d("8"), _policy())  # 5h - 1h break = 4h net, threshold=4
    assert hours.net_worked_hours == d("4.00")
    assert hours.day_status == "HALF_DAY"


def test_below_half_day_threshold_is_absent():
    hours = resolve_hours(time(9, 0), time(13, 30), d("1"), d("8"), _policy())  # 4h30 - 1h break = 3h30 net, below threshold 4
    assert hours.day_status == "ABSENT"


def test_not_required_when_required_hours_is_zero():
    hours = resolve_hours(None, None, d("0"), d("0"), _policy())
    assert hours.day_status == "NOT_REQUIRED"


def test_spans_midnight_overnight_shift():
    hours = resolve_hours(time(22, 0), time(6, 0), d("1"), d("8"), _policy(), spans_midnight=True)
    assert hours.gross_hours == d("8.00")
    assert hours.net_worked_hours == d("7.00")


def test_negative_balance_reflects_shortfall():
    hours = resolve_hours(time(9, 0), time(15, 0), d("1"), d("8"), _policy())  # 6h - 1h = 5h net, required 8h
    assert hours.balance_hours == d("-3.00")
