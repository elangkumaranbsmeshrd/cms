"""Leave working-days calculation, the hard balance block, the approval
routing rule, and Compensatory Hours window/cap validation.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.services.attendance_engine import WorkWeekPolicySnapshot
from app.services.leave_engine import (
    InsufficientBalanceError,
    calculate_working_days,
    check_balance_or_raise,
    resolve_routing,
    validate_comp_hours_request,
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


# ------------------------------------------------------------- working days
def test_half_day_is_always_half_regardless_of_dates():
    days = calculate_working_days(date(2026, 8, 12), date(2026, 8, 12), True, _policy(), set(), {})
    assert days == d("0.5")


def test_five_weekday_span_excludes_sunday():
    # Mon 2026-08-10 to Sun 2026-08-16: Mon-Fri working, Sat (1st, odd->working), Sun off
    days = calculate_working_days(date(2026, 8, 10), date(2026, 8, 16), False, _policy(), set(), {})
    assert days == d("6")  # Mon,Tue,Wed,Thu,Fri,Sat(odd) = 6; Sunday excluded


def test_mandatory_holiday_excluded_even_on_a_working_saturday():
    # 2026-08-15 is an odd (working) Saturday AND a Mandatory holiday
    days = calculate_working_days(date(2026, 8, 15), date(2026, 8, 15), False, _policy(), {date(2026, 8, 15)}, {})
    assert days == d("0")


def test_optional_holiday_still_counts_as_a_working_day():
    # Optional holidays are never excluded from the working-days count —
    # only Mandatory ones are (Leave §7.1's own stated assumption).
    days = calculate_working_days(date(2026, 8, 12), date(2026, 8, 12), False, _policy(), set(), {})
    assert days == d("1")


def test_saturday_override_beats_the_pattern_in_the_day_count():
    # 2026-08-08 (2nd, even, normally off) explicitly overridden to working
    days = calculate_working_days(date(2026, 8, 8), date(2026, 8, 8), False, _policy(), set(), {date(2026, 8, 8): True})
    assert days == d("1")


# --------------------------------------------------------------- hard block
def test_balance_block_exact_boundary_is_allowed():
    check_balance_or_raise("Casual Leave", d("4"), d("4"), True)  # requested == remaining: allowed


def test_balance_block_raises_with_exact_shortfall_message():
    with pytest.raises(InsufficientBalanceError) as exc:
        check_balance_or_raise("Casual Leave", d("2"), d("4"), True)
    assert "You have 2 days remaining for Casual Leave, but requested 4" == str(exc.value)


def test_untracked_quota_never_blocks():
    check_balance_or_raise("Work From Home", d("0"), d("100"), False)  # is_quota_tracked=False -> never raises


# ------------------------------------------------------------------ routing
def test_routes_to_reporting_manager_by_default():
    r = resolve_routing(applicant_role_code="EMPLOYEE", reporting_manager_user_id="mgr-1", hr_is_available=True, applicant_is_sole_active_hr=False)
    assert r.role == "REPORTING_MANAGER"
    assert r.user_id == "mgr-1"


def test_routes_to_hr_when_no_reporting_manager():
    r = resolve_routing(applicant_role_code="EMPLOYEE", reporting_manager_user_id=None, hr_is_available=True, applicant_is_sole_active_hr=False)
    assert r.role == "HR"


def test_manager_applicant_always_routes_to_hr_even_with_a_reporting_manager():
    r = resolve_routing(applicant_role_code="MANAGER", reporting_manager_user_id="mgr-1", hr_is_available=True, applicant_is_sole_active_hr=False)
    assert r.role == "HR"


def test_falls_back_to_super_admin_when_hr_unavailable():
    r = resolve_routing(applicant_role_code="EMPLOYEE", reporting_manager_user_id=None, hr_is_available=False, applicant_is_sole_active_hr=False)
    assert r.role == "SUPER_ADMIN"


def test_sole_hr_applicant_cannot_approve_own_request_falls_to_super_admin():
    r = resolve_routing(applicant_role_code="HR", reporting_manager_user_id=None, hr_is_available=True, applicant_is_sole_active_hr=True)
    assert r.role == "SUPER_ADMIN"


# ---------------------------------------------------------- compensatory hours
def test_comp_hours_within_window_and_cap():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 10), make_up_day_type="WORKING_SATURDAY",
        compensation_window_days=7, max_comp_hours_per_month=d("16"), month_hours_already_used=d("4"),
        hours_to_work=d("4"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_window is True
    assert v.within_monthly_cap is True
    assert v.window_last_permissible_date == date(2026, 8, 12)


def test_comp_hours_exactly_on_the_window_boundary_is_allowed():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 12), make_up_day_type="WEEKLY_OFF",
        compensation_window_days=7, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_window is True


def test_comp_hours_one_day_past_window_is_refused():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 13), make_up_day_type="WORKING_DAY",
        compensation_window_days=7, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_window is False


def test_comp_hours_over_monthly_cap_is_refused():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 6), make_up_day_type="WORKING_DAY",
        compensation_window_days=7, max_comp_hours_per_month=d("10"), month_hours_already_used=d("8"),
        hours_to_work=d("4"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_monthly_cap is False  # 8 + 4 = 12 > 10


def test_comp_hours_mandatory_holiday_refused_when_policy_does_not_permit():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 15), make_up_day_type="MANDATORY_HOLIDAY",
        compensation_window_days=14, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.day_type_permitted is False


def test_comp_hours_week_off_permitted_when_policy_allows():
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 9), make_up_day_type="WEEKLY_OFF",
        compensation_window_days=14, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.day_type_permitted is True
