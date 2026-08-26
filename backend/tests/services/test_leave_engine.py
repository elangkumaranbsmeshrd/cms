"""Leave working-days calculation, the hard balance block, the approval
routing rule, Compensatory Hours window/cap validation — and the leave
BALANCE arithmetic: opening balance, proration for a mid-year joiner, the
Remaining formula through approval / rejection / cancellation, carry-forward
lapse, and negative balances.

Spec lines the balance numbers below are hand-computed from:
  APPENDIX-B:314  Remaining = Allowed + Carried Forward - Taken - Pending
  APPENDIX-B:331  Allowed = (Default Annual Quota / 12) x months remaining in
                  the financial year from the Joining Date, ROUNDED TO THE
                  NEAREST HALF-DAY. Carried Forward starts at 0.
  APPENDIX-B:332  carry over that employee's REMAINING balance for that type,
                  CAPPED at that type's Max Carry Forward Days. Anything above
                  the cap is NOT carried forward and is dropped.
  APPENDIX-B:335  BALANCE ADJUSTMENT: amount may be positive or negative.
  APPENDIX-B:324  STATUS TRANSITIONS: APPROVED (days move from Pending into
                  Taken) / REJECTED (Remaining unaffected) / CANCELLED (days
                  return to Remaining immediately).
  APPENDIX-B:64   COMPENSATION WINDOW ... 0 means the SAME PAYROLL PERIOD ONLY.
  APPENDIX-B:65   COMPENSATION CAP ... 0 removes the cap.

Two of those formulas are not Python functions — they ship as real MySQL
STORED GENERATED columns declared in app/models/leave.py. They are tested
here by pulling the SHIPPED expression text off the mapped column and
evaluating it, so a change to the schema formula breaks these tests, and the
expected numbers still come from APPENDIX-B rather than from the code.

The carry-forward CAP itself (min(remaining, cap), clamped at 0) is written
inline inside the preview_carry_forward route in app/api/v1/leave_balance.py
and has no importable seam; the cap arithmetic is therefore spelled out by
hand below and fed into the shipped lapse formula.
"""

import re
from datetime import date
from decimal import Decimal

import pytest

from app.models.leave import LeaveBalance, LeaveCarryForwardLine
from app.services.attendance_engine import WorkWeekPolicySnapshot
from app.services.leave_engine import (
    InsufficientBalanceError,
    calculate_prorated_starting_balance,
    calculate_working_days,
    check_balance_or_raise,
    estimate_payroll_impact,
    resolve_routing,
    round_half,
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


# The two generated-column formulas exactly as app/models/leave.py declares
# them. Both are plain identifier +/- identifier arithmetic, so Python
# evaluates them identically to MySQL.
_REMAINING_SQL = str(LeaveBalance.__table__.c.remaining_days.computed.sqltext)
_LAPSED_SQL = str(LeaveCarryForwardLine.__table__.c.days_lapsed.computed.sqltext)
_PLAIN_ARITHMETIC = re.compile(r"[a-z_]+(?: [-+] [a-z_]+)+")


def _eval_generated_column(expression: str, **columns: Decimal) -> Decimal:
    assert _PLAIN_ARITHMETIC.fullmatch(expression), f"not plain +/- arithmetic: {expression!r}"
    assert set(re.findall(r"[a-z_]+", expression)) == set(columns), f"columns changed: {expression!r}"
    return eval(expression, {"__builtins__": {}}, dict(columns))  # noqa: S307 - guarded above


def remaining_days(
    *, allowed_days: Decimal, carried_forward_days: Decimal, adjustment_days: Decimal, taken_days: Decimal, pending_days: Decimal
) -> Decimal:
    return _eval_generated_column(
        _REMAINING_SQL,
        allowed_days=allowed_days, carried_forward_days=carried_forward_days, adjustment_days=adjustment_days,
        taken_days=taken_days, pending_days=pending_days,
    )


def days_lapsed(*, remaining_days_at_run: Decimal, days_carried_forward: Decimal) -> Decimal:
    return _eval_generated_column(
        _LAPSED_SQL, remaining_days_at_run=remaining_days_at_run, days_carried_forward=days_carried_forward
    )


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


# ===========================================================================
# OPENING BALANCE / ACCRUAL / MID-YEAR JOINER  (APPENDIX-B:331)
#   Allowed = (Default Annual Quota / 12) x months remaining in the FY from
#             the Joining Date, rounded to the nearest half-day.
# There is no monthly accrual in this system: APPENDIX-B:128 allocates the
# whole (prorated) annual quota the moment the Employee record is first saved
# as Active, so this ONE calculation is the accrual.
# The FY used throughout is 2026-04-01 .. 2027-03-31.
# ===========================================================================
FY_END = date(2027, 3, 31)


def test_joining_on_the_first_day_of_the_financial_year_gets_the_whole_quota():
    # Apr 2026 .. Mar 2027 inclusive = 12 months remaining.
    #   allowed = (12 / 12) x 12 = 1 x 12 = 12 days
    q = calculate_prorated_starting_balance(date(2026, 4, 1), FY_END, d("12"))
    assert q.proration_months == d("12")
    assert q.allowed_days == d("12")


def test_mid_year_joiner_gets_exactly_the_months_remaining():
    # Joins 15-Oct-2026. The joining month counts whole, so
    # Oct,Nov,Dec,Jan,Feb,Mar = 6 months remaining.
    #   allowed = (12 / 12) x 6 = 1 x 6 = 6 days
    q = calculate_prorated_starting_balance(date(2026, 10, 15), FY_END, d("12"))
    assert q.proration_months == d("6")
    assert q.allowed_days == d("6")


def test_proration_lands_exactly_on_a_half_day():
    # 6 months remaining on a 15-day quota:
    #   allowed = (15 / 12) x 6 = 1.25 x 6 = 7.5 days
    # Half-days are legal balances (Half-Day = Yes subtracts 0.5), so this
    # must NOT be rounded away to 7 or 8.
    q = calculate_prorated_starting_balance(date(2026, 10, 1), FY_END, d("15"))
    assert q.allowed_days == d("7.5")


def test_proration_rounds_up_to_the_nearest_half_day():
    # Joins 20-Sep-2026: Sep..Mar = 7 months remaining, 10-day quota.
    #   raw = (10 / 12) x 7 = 0.83333... x 7 = 5.833333... days
    #   nearest half-day: |5.8333 - 6.0| = 0.1667 < |5.8333 - 5.5| = 0.3333
    #   -> 6.0
    q = calculate_prorated_starting_balance(date(2026, 9, 20), FY_END, d("10"))
    assert q.proration_months == d("7")
    assert q.allowed_days == d("6")


def test_proration_rounds_down_to_the_nearest_half_day():
    # Joins 05-Nov-2026: Nov..Mar = 5 months remaining, 10-day quota.
    #   raw = (10 / 12) x 5 = 0.83333... x 5 = 4.166666... days
    #   nearest half-day: |4.1667 - 4.0| = 0.1667 < |4.1667 - 4.5| = 0.3333
    #   -> 4.0
    q = calculate_prorated_starting_balance(date(2026, 11, 5), FY_END, d("10"))
    assert q.proration_months == d("5")
    assert q.allowed_days == d("4")


def test_proration_exactly_between_two_half_days_rounds_up():
    # Joins 10-Mar-2027: only March remains = 1 month, 3-day quota.
    #   raw = (3 / 12) x 1 = 0.25 days
    # 0.25 is exactly midway between 0.0 and 0.5. "Nearest half-day" needs a
    # tie-break; half-up (the convention used everywhere else in this
    # codebase) gives the employee the half day.
    q = calculate_prorated_starting_balance(date(2027, 3, 10), FY_END, d("3"))
    assert q.proration_months == d("1")
    assert q.allowed_days == d("0.5")


def test_joining_on_the_very_last_day_of_the_financial_year_still_gets_one_month():
    # The joining month counts as a whole month, so 31-Mar-2027 -> 1 month.
    #   allowed = (12 / 12) x 1 = 1 day
    q = calculate_prorated_starting_balance(date(2027, 3, 31), FY_END, d("12"))
    assert q.proration_months == d("1")
    assert q.allowed_days == d("1")


def test_joining_after_the_financial_year_has_ended_allocates_nothing():
    # Joins 01-May-2027, one month PAST the FY that ends 31-Mar-2027:
    #   raw months = (2027-2027) x 12 + (3 - 5) + 1 = -1  -> floored to 0
    #   allowed = (12 / 12) x 0 = 0 days
    # A negative month count would hand out a negative opening balance.
    q = calculate_prorated_starting_balance(date(2027, 5, 1), FY_END, d("12"))
    assert q.proration_months == d("0")
    assert q.allowed_days == d("0")


def test_joining_date_before_the_financial_year_is_capped_at_twelve_months():
    # A rehire whose joining_date predates the FY:
    #   raw months = (2027-2025) x 12 + (3 - 1) + 1 = 24 + 2 + 1 = 27
    #   capped at 12 -> allowed = (12 / 12) x 12 = 12 days
    # Never more than a full year's quota.
    q = calculate_prorated_starting_balance(date(2025, 1, 1), FY_END, d("12"))
    assert q.proration_months == d("12")
    assert q.allowed_days == d("12")


def test_zero_quota_type_prorates_to_zero_and_never_divides_by_a_variable():
    # APPENDIX-B:315 — a 0 quota (e.g. Work From Home) is legal and reads
    # "Not tracked". 6 months remaining:
    #   allowed = (0 / 12) x 6 = 0 days
    # This is also the divide-by-zero case for this formula: the ONLY divisor
    # is the literal 12 (months in a year), never a caller-supplied number,
    # so a 0 quota is arithmetic, not an error.
    q = calculate_prorated_starting_balance(date(2026, 10, 1), FY_END, d("0"))
    assert q.proration_months == d("6")
    assert q.allowed_days == d("0")


def test_the_quota_actually_drives_the_prorated_allowance():
    # Same joining date, two quotas — nothing here is a constant.
    #   12-day quota, 6 months: (12 / 12) x 6 = 6
    #   24-day quota, 6 months: (24 / 12) x 6 = 12
    six = calculate_prorated_starting_balance(date(2026, 10, 1), FY_END, d("12")).allowed_days
    twelve = calculate_prorated_starting_balance(date(2026, 10, 1), FY_END, d("24")).allowed_days
    assert six == d("6")
    assert twelve == d("12")


def test_round_half_snaps_to_the_nearest_half_day():
    # The half-day rounder itself, at every interesting point:
    assert round_half(d("5.24")) == d("5")      # below the 5.25 midpoint
    assert round_half(d("5.25")) == d("5.5")    # exactly midway -> half up
    assert round_half(d("5.26")) == d("5.5")    # above the midpoint
    assert round_half(d("5.74")) == d("5.5")    # below the 5.75 midpoint
    assert round_half(d("5.75")) == d("6")      # exactly midway -> half up
    assert round_half(d("7.5")) == d("7.5")     # already a half day, untouched
    assert round_half(d("0")) == d("0")


# ===========================================================================
# THE REMAINING FORMULA  (APPENDIX-B:314)
#   Remaining = Allowed + Carried Forward - Taken - Pending
# The shipped generated column adds adjustment_days, the HR balance
# adjustment of APPENDIX-B:335 ("amount may be positive or negative"), which
# APPENDIX-B:314 predates. With no adjustment the two agree exactly.
# ===========================================================================
def test_opening_balance_is_the_allowance_itself():
    # A brand-new employee: allowed 12, carried forward 0 (APPENDIX-B:331
    # "Carried Forward starts at 0 for a new employee"), nothing taken,
    # nothing pending.
    #   remaining = 12 + 0 + 0 - 0 - 0 = 12
    assert remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("0")
    ) == d("12")


def test_a_pending_request_is_held_out_of_remaining_immediately():
    # 3 days applied for, not yet decided. APPENDIX-B:314 subtracts Pending,
    # so the days are reserved the moment the request is created — that is
    # what makes the hard block of APPENDIX-B:319 impossible to double-spend.
    #   remaining = 12 + 0 + 0 - 0 - 3 = 9
    assert remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("3")
    ) == d("9")


def test_approval_moves_days_from_pending_to_taken_without_deducting_twice():
    # APPENDIX-B:324 APPROVED: "days move from Pending into Taken; Remaining
    # reflects the new total". Approval is a MOVE, not a second deduction.
    #   while pending: 12 + 0 + 0 - 0 - 3 = 9
    #   on approval:   12 + 0 + 0 - 3 - 0 = 9   <- identical
    while_pending = remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("3")
    )
    after_approval = remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("3"), pending_days=d("0")
    )
    assert while_pending == d("9")
    assert after_approval == d("9")
    assert after_approval == while_pending


def test_rejection_restores_the_days_to_remaining():
    # APPENDIX-B:324 REJECTED: "Remaining unaffected — the days were only ever
    # held in Pending". pending 3 -> 0, taken stays 0.
    #   remaining = 12 + 0 + 0 - 0 - 0 = 12  <- back to the opening balance
    after_rejection = remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("0")
    )
    assert after_rejection == d("12")


def test_cancellation_restores_the_days_to_remaining():
    # APPENDIX-B:324 CANCELLED: "days return to Remaining immediately".
    # Same arithmetic as a rejection — the days were only ever in Pending.
    #   remaining = 12 + 0 + 0 - 0 - 0 = 12
    after_cancellation = remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("0")
    )
    assert after_cancellation == d("12")


def test_carried_forward_days_add_to_the_allowance():
    # Last year's carry-forward lands in its own column and adds:
    #   remaining = 12 + 5 + 0 - 0 - 0 = 17
    assert remaining_days(
        allowed_days=d("12"), carried_forward_days=d("5"), adjustment_days=d("0"), taken_days=d("0"), pending_days=d("0")
    ) == d("17")


def test_remaining_with_every_column_populated_including_half_days():
    # A realistic mid-year row, with half-days everywhere they are legal:
    #   remaining = 12 + 2.5 + 1 - 3.5 - 1 = 11.0
    assert remaining_days(
        allowed_days=d("12"), carried_forward_days=d("2.5"), adjustment_days=d("1"), taken_days=d("3.5"), pending_days=d("1")
    ) == d("11")


def test_a_negative_balance_adjustment_can_drive_remaining_below_zero():
    # APPENDIX-B:335 lets HR post a negative adjustment, and
    # app/api/v1/leave_balance.py exposes a `negative_only` filter for the
    # result, so a negative Remaining is an expected state — the formula must
    # NOT floor at zero the way depreciation does (APPENDIX-B:265 is an asset
    # rule, not a leave rule).
    #   remaining = 12 + 0 + (-15) - 0 - 0 = -3
    assert remaining_days(
        allowed_days=d("12"), carried_forward_days=d("0"), adjustment_days=d("-15"), taken_days=d("0"), pending_days=d("0")
    ) == d("-3")


def test_over_taken_days_also_drive_remaining_below_zero():
    # An HR top-up later reversed, or days taken against a reduced quota:
    #   remaining = 5 + 0 + 0 - 8 - 0 = -3
    assert remaining_days(
        allowed_days=d("5"), carried_forward_days=d("0"), adjustment_days=d("0"), taken_days=d("8"), pending_days=d("0")
    ) == d("-3")


# ===========================================================================
# CARRY-FORWARD  (APPENDIX-B:332)
#   carry over the employee's REMAINING balance, CAPPED at that Leave Type's
#   Max Carry Forward Days; anything above the cap is dropped.
#
# The cap is bounded by the schema itself —
#   alembic/versions/0002_masters.py:446
#     CONSTRAINT ck_leave_types_cf CHECK (NOT carry_forward_allowed OR
#       (max_carry_forward_days IS NOT NULL AND
#        max_carry_forward_days <= default_annual_quota_days))
# — so a cap LARGER than the annual quota is not a case that can exist, and no
# test below constructs one. Remaining, however, CAN exceed the quota (last
# year's carry-forward plus a positive adjustment), so remaining > cap is
# entirely reachable and is the main case.
# ===========================================================================
def test_carry_forward_is_capped_and_the_excess_lapses():
    # Leave Type: quota 12, cap 5 (5 <= 12, so ck_leave_types_cf is satisfied).
    # Employee ends the year with 8 days remaining.
    #   carried = min(8, 5) = 5   <- capped, so only 5 reach the new year
    #   lapsed  = 8 - 5     = 3   <- dropped, not carried
    assert days_lapsed(remaining_days_at_run=d("8"), days_carried_forward=d("5")) == d("3")


def test_carry_forward_below_the_cap_carries_the_lesser_amount_and_lapses_nothing():
    # Same type (quota 12, cap 5), but only 3 days left.
    #   carried = min(3, 5) = 3   <- the LESSER of the two, not the cap
    #   lapsed  = 3 - 3     = 0
    assert days_lapsed(remaining_days_at_run=d("3"), days_carried_forward=d("3")) == d("0")


def test_carry_forward_exactly_on_the_cap_lapses_nothing():
    # Remaining == cap == 5, the boundary between the two cases above.
    #   carried = min(5, 5) = 5
    #   lapsed  = 5 - 5     = 0
    assert days_lapsed(remaining_days_at_run=d("5"), days_carried_forward=d("5")) == d("0")


def test_carry_forward_carries_half_days_intact():
    # Half-day balances are legal, and the cap is a DECIMAL(5,2):
    #   quota 12, cap 5.5, remaining 7.5
    #   carried = min(7.5, 5.5) = 5.5
    #   lapsed  = 7.5 - 5.5     = 2.0
    assert days_lapsed(remaining_days_at_run=d("7.5"), days_carried_forward=d("5.5")) == d("2")


def test_carry_forward_with_no_cap_carries_everything():
    # max_carry_forward_days_snapshot NULL on the balance row -> the route
    # carries the whole remaining balance.
    #   carried = 8 (uncapped)
    #   lapsed  = 8 - 8 = 0
    assert days_lapsed(remaining_days_at_run=d("8"), days_carried_forward=d("8")) == d("0")


def test_a_negative_remaining_balance_carries_nothing_forward():
    # An employee who ends the year at -3 must not carry a debt into the new
    # year: the route clamps carried at 0 (max(0, min(-3, 5)) = 0).
    #   carried = 0
    # NOTE the shipped days_lapsed column then reports -3 for this line, while
    # the run header's total_days_lapsed adds max(0, -3 - 0) = 0 — see the
    # FINDING in this task's report.
    assert days_lapsed(remaining_days_at_run=d("-3"), days_carried_forward=d("0")) == d("-3")


# --------------------------------------------------------------- hard block
def test_balance_block_exact_boundary_is_allowed():
    check_balance_or_raise("Casual Leave", d("4"), d("4"), True)  # requested == remaining: allowed


def test_balance_block_raises_with_exact_shortfall_message():
    with pytest.raises(InsufficientBalanceError) as exc:
        check_balance_or_raise("Casual Leave", d("2"), d("4"), True)
    assert "You have 2 days remaining for Casual Leave, but requested 4" == str(exc.value)


def test_untracked_quota_never_blocks():
    check_balance_or_raise("Work From Home", d("0"), d("100"), False)  # is_quota_tracked=False -> never raises


def test_a_negative_balance_blocks_every_further_request():
    # APPENDIX-B:319 is "days requested > Remaining", with no floor on
    # Remaining. At -3, even a half day is more than what is left:
    #   0.5 > -3  -> blocked
    with pytest.raises(InsufficientBalanceError) as exc:
        check_balance_or_raise("Casual Leave", d("-3"), d("0.5"), True)
    assert "You have -3 days remaining for Casual Leave, but requested 0.5" == str(exc.value)


def test_zero_remaining_still_allows_a_zero_day_request():
    # 0 > 0 is false, so the block is strictly "more than", not "at least".
    check_balance_or_raise("Casual Leave", d("0"), d("0"), True)


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


def test_comp_hours_exactly_on_the_monthly_cap_is_allowed():
    # The cap boundary: "under Max Compensatory Hours per Month" is read as
    # <=, matching the window boundary above.
    #   8 already used + 8 requested = 16, cap 16 -> allowed
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 6), make_up_day_type="WORKING_DAY",
        compensation_window_days=7, max_comp_hours_per_month=d("16"), month_hours_already_used=d("8"),
        hours_to_work=d("8"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_monthly_cap is True


def test_comp_hours_cap_of_zero_removes_the_cap():
    # APPENDIX-B:65 verbatim: "Max Compensatory Hours per Month is a ceiling
    # ... 0 removes the cap." 0 is also the schema DEFAULT
    # (work_week_policies.max_comp_hours_per_month NOT NULL DEFAULT 0), so
    # this is the out-of-the-box configuration: 40 hours must pass.
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 6), make_up_day_type="WORKING_DAY",
        compensation_window_days=7, max_comp_hours_per_month=d("0"), month_hours_already_used=d("0"),
        hours_to_work=d("40"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_monthly_cap is True


def test_comp_hours_window_of_zero_still_permits_a_same_day_make_up():
    # APPENDIX-B:64: a Compensation Window of 0 "means the SAME PAYROLL PERIOD
    # ONLY". The shortfall date is trivially inside its own payroll period, so
    # a same-day make-up is permitted under any reading of that line.
    # (Whether a LATER date in the same payroll period is also permitted is
    # the open question reported as a FINDING for this task — this function
    # takes no payroll-period argument, so it cannot express that rule and no
    # assertion is made about it here.)
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 5), make_up_day_type="WORKING_DAY",
        compensation_window_days=0, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=True, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.within_window is True


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


def test_comp_hours_week_off_refused_when_policy_forbids_it():
    # APPENDIX-B:66: "a week off is permitted only if 'Allow Make-Up on a Week
    # Off' is on" — the toggle has to be able to say no.
    v = validate_comp_hours_request(
        shortfall_date=date(2026, 8, 5), make_up_date=date(2026, 8, 9), make_up_day_type="WEEKLY_OFF",
        compensation_window_days=14, max_comp_hours_per_month=None, month_hours_already_used=d("0"),
        hours_to_work=d("2"), allow_makeup_on_week_off=False, allow_makeup_on_mandatory_holiday=False,
    )
    assert v.day_type_permitted is False


# ===========================================================================
# PAYROLL IMPACT IF REJECTED  (APPENDIX-B:67 / :211)
#   "Uncompensated Shortfall Becomes" — Pro-rata per hour (Loss of Pay)
#   [DEFAULT], Rounded to nearest half day, Rounded up to a full day, Deduct
#   from leave balance first then Loss of Pay, or Ignore (no payroll impact).
# net_hours_per_day comes from the covering work-week policy (Masters §3.20),
# so "a full day" is never the constant 8.
# ===========================================================================
def test_ignore_treatment_costs_nothing():
    # "Ignore (no payroll impact)" -> exactly 0, whatever the shortfall.
    assert estimate_payroll_impact(d("2.5"), d("187.50"), "IGNORE", d("8")) == d("0")


def test_pro_rata_prices_only_the_hours_actually_short():
    # The DEFAULT, "the fairest": 2.5 hours short at Rs.187.50/hour
    #   187.50 x 2.5 = 468.75
    assert estimate_payroll_impact(d("2.5"), d("187.50"), "PRO_RATA_LOP", d("8")) == d("468.75")


def test_leave_then_lop_prices_the_same_as_pro_rata_up_front():
    # APPENDIX-B:67 "Deduct from leave balance first then Loss of Pay" — the
    # leave offset is a payroll-run decision, so the UP-FRONT estimate is the
    # full pro-rata figure, i.e. the worst case shown before submission:
    #   187.50 x 2.5 = 468.75
    assert estimate_payroll_impact(d("2.5"), d("187.50"), "LEAVE_THEN_LOP", d("8")) == d("468.75")


def test_round_up_to_a_full_day_prices_a_whole_working_day():
    # "Rounded up to a full day" — 2.5 hours short costs a whole day:
    #   187.50 x 8 = 1500.00
    assert estimate_payroll_impact(d("2.5"), d("187.50"), "ROUND_FULL_DAY", d("8")) == d("1500.00")


def test_round_to_nearest_half_day_prices_half_a_working_day():
    # "Rounded to nearest half day":
    #   187.50 x 8 / 2 = 1500.00 / 2 = 750.00
    assert estimate_payroll_impact(d("2.5"), d("187.50"), "ROUND_HALF_DAY", d("8")) == d("750.00")


def test_a_full_day_is_the_policy_net_hours_not_a_hardcoded_eight():
    # Masters §3.20's Net Working Hours per Day is dynamic. On a 7.5-hour
    # policy at Rs.200/hour a full day is
    #   200 x 7.5 = 1500.00
    # and a half day is
    #   200 x 7.5 / 2 = 750.00
    # — the SAME money as the 8-hour x Rs.187.50 case above, reached from
    # different inputs, which is only possible if neither figure is a constant.
    assert estimate_payroll_impact(d("1"), d("200"), "ROUND_FULL_DAY", d("7.5")) == d("1500.00")
    assert estimate_payroll_impact(d("1"), d("200"), "ROUND_HALF_DAY", d("7.5")) == d("750.00")


def test_the_hours_short_actually_drive_the_pro_rata_figure():
    # Pro-rata is linear in the hours:
    #   187.50 x 1 = 187.50
    #   187.50 x 4 = 750.00
    assert estimate_payroll_impact(d("1"), d("187.50"), "PRO_RATA_LOP", d("8")) == d("187.50")
    assert estimate_payroll_impact(d("4"), d("187.50"), "PRO_RATA_LOP", d("8")) == d("750.00")


def test_payroll_impact_rounds_half_a_paisa_up():
    # Money, 2 dp, explicit rounding: half an hour short at Rs.120.05/hour
    #   120.05 x 0.5 = 60.025
    # is exactly half a paisa. Half-up gives 60.03 (banker's rounding would
    # give 60.02, because the retained digit 2 is even) — half-up is the
    # convention used by every other money quantize in app/services.
    result = estimate_payroll_impact(d("0.5"), d("120.05"), "PRO_RATA_LOP", d("8"))
    assert result == d("60.03")
    assert result.as_tuple().exponent == -2


def test_zero_hours_short_costs_nothing_on_a_pro_rata_treatment():
    # A fully compensated shortfall: 187.50 x 0 = 0.00
    assert estimate_payroll_impact(d("0"), d("187.50"), "PRO_RATA_LOP", d("8")) == d("0")
