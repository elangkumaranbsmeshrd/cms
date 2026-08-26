"""Attendance day-type/hours resolution — the precedence rule (Masters
§3.20: Mandatory holiday > Saturday override > Saturday pattern > weekly off
> working day) and the hour-band boundaries, tested directly rather than
trusted.

Layer 1 discipline (build-docs/COMPLETE-TEST-PROMPT.md): every expected
figure below is worked out BY HAND from build-docs/APPENDIX-B-business-rules.md
with the arithmetic written above the assertion. Nothing here asserts
"whatever the code happened to return".
"""

from collections import Counter, namedtuple
from datetime import date, time, timedelta
from decimal import Decimal

import pytest

from app.services.attendance_engine import (
    SaturdayOverrideSnapshot,
    WorkWeekPolicySnapshot,
    resolve_day,
    resolve_hours,
    saturday_is_working_by_pattern,
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


# ==========================================================================
# LAYER 1 — hand-computed calculation coverage.
#
# Spec sources (build-docs/APPENDIX-B-business-rules.md, by line):
#   :105  Gross Hours = Check-Out - Check-In; Net Worked = Gross - Break;
#         Balance = Net Worked vs Required Hours for that date; Day Status is
#         DERIVED from hours, not from presence.
#   :206  Required Hours = Net Working Hours per Day x working days in the
#         period; working days = calendar weekdays - Mandatory holidays
#         + whichever Saturdays the policy's Saturday rule makes working.
#         "Nothing in this calculation is a constant."
#   :55   Net Working Hours per Day = Gross per Day - Unpaid Break (9 - 1 = 8).
#   :58   Day-status bands, and "Grace Window of 0 switches grace off".
#   :60   A Mandatory holiday overrides a working Saturday when the policy's
#         toggle is on; an Optional holiday NEVER does; a dated Saturday
#         Override row takes precedence over the pattern.
#   :61   Working-Saturday hours = the Net figure / 50% of Net / Custom hours.
#   :207  "Nine hours on site with a two-hour lunch IS a shortfall."
#   :216  Worked example: a 15-minute grace window absorbed 0.17 hours under.
#   :217  Worked example: 4.42 worked against 8.00 required = Half Day.
#   :219  A pay period is 26th-25th, NOT a calendar month.
#
# Calendars counted by hand once here and reused below.
#   AUGUST 2026 (31 days, a 5-Saturday month)
#     Sat 01(1st) 08(2nd) 15(3rd) 22(4th) 29(5th)  -> 5 Saturdays
#     Sun 02 09 16 23 30                           -> 5 Sundays
#     Mon-Fri = 31 - 5 - 5                         -> 21 weekdays
#   FEBRUARY 2026 (28 days, 2026 is not a leap year, a 4-Saturday month)
#     Sat 07(1st) 14(2nd) 21(3rd) 28(4th)          -> 4 Saturdays
#     Sun 01 08 15 22                              -> 4 Sundays
#     Mon-Fri = 28 - 4 - 4                         -> 20 weekdays
#   JULY 2026 (31 days) Sat 04 11 18 25 / Sun 05 12 19 26
# ==========================================================================

AUGUST_2026 = (date(2026, 8, 1), date(2026, 8, 31))
FEBRUARY_2026 = (date(2026, 2, 1), date(2026, 2, 28))

PeriodTotals = namedtuple("PeriodTotals", "required_hours day_types")


def _period_required_hours(start, end, policy, *, mandatory=(), optional=(), overrides=None) -> PeriodTotals:
    """APPENDIX-B:206 written out day by day: the period's Required Hours are
    the sum of each date's own Required Hours, so a weekday contributes the
    Net figure, a Mandatory holiday contributes 0 and a working Saturday
    contributes whatever the policy's working-Saturday hours mode says. The
    only thing this helper does is add up resolve_day's answers — every
    expected total below is computed by hand from the calendar block above.
    """
    mandatory_dates, optional_dates = set(mandatory), set(optional)
    overrides = overrides or {}
    total = Decimal("0")
    day_types: Counter = Counter()
    current = start
    while current <= end:
        resolution = resolve_day(
            current,
            policy,
            is_mandatory_holiday=current in mandatory_dates,
            is_optional_holiday=current in optional_dates,
            saturday_override=overrides.get(current),
            is_last_saturday_of_month=(current + timedelta(days=7)).month != current.month,
        )
        total += resolution.required_hours
        day_types[resolution.day_type] += 1
        current += timedelta(days=1)
    return PeriodTotals(total, day_types)


# ------------------------------------------------ attendance hours (APPENDIX-B:105)
def test_spec_own_example_nine_hours_on_site_with_a_two_hour_lunch_is_a_shortfall():
    # APPENDIX-B:207 verbatim: "Nine hours on site with a two-hour lunch IS a
    # shortfall and the screen must say so."
    #   Gross   = 18:00 - 09:00           = 9.00
    #   Net     = 9.00 - 2.00 break       = 7.00
    #   Balance = 7.00 - 8.00 required    = -1.00  (NEGATIVE = shortfall)
    hours = resolve_hours(time(9, 0), time(18, 0), d("2"), d("8"), _policy())
    assert hours.gross_hours == d("9.00")
    assert hours.net_worked_hours == d("7.00")
    assert hours.balance_hours == d("-1.00")
    assert hours.balance_hours < 0
    # APPENDIX-B:58 bands: 7.00 is under the 8.00 target, outside the 0.25h
    # grace window (8.00 - 0.25 = 7.75 > 7.00) and at/above the 4.00 half-day
    # threshold -> Half Day. Nine hours of presence does NOT buy a Full Day.
    assert hours.day_status == "HALF_DAY"


def test_exact_match_to_required_on_a_non_eight_hour_policy():
    # "8.00" is a company answer, never a constant (APPENDIX-B:55/206). On a
    # 7.5-hour policy the exact-match day is a different clock shape:
    #   Gross   = 17:15 - 09:00        = 8.25
    #   Net     = 8.25 - 0.75 break    = 7.50
    #   Balance = 7.50 - 7.50 required = 0.00 -> Full Day, no grace needed
    policy = _policy(net_working_hours_per_day=d("7.5"))
    hours = resolve_hours(time(9, 0), time(17, 15), d("0.75"), d("7.5"), policy)
    assert hours.net_worked_hours == d("7.50")
    assert hours.balance_hours == d("0.00")
    assert hours.day_status == "FULL_DAY"


def test_grace_window_one_minute_inside_the_boundary_is_full_day_grace():
    # Grace boundary = 8.00 - 15/60 = 7.75. One minute INSIDE it:
    #   Gross = 17:46 - 09:00 = 8h46m = 8.766666.. -> 8.77
    #   Net   = 8.766666.. - 1.00    = 7.766666.. -> 7.77, and 7.77 > 7.75
    hours = resolve_hours(time(9, 0), time(17, 46), d("1"), d("8"), _policy())
    assert hours.net_worked_hours == d("7.77")
    assert hours.day_status == "FULL_DAY_GRACE"


def test_spec_own_grace_worked_example_of_zero_point_one_seven_hours_under():
    # APPENDIX-B:216 worked example: "0.17 hours under on 24-06 kept the day a
    # Full Day".
    #   Gross   = 17:50 - 09:00 = 8h50m = 8.833333.. -> 8.83
    #   Net     = 8.833333.. - 1.00    = 7.833333.. -> 7.83
    #   Balance = 7.833333.. - 8.00                  -> -0.17  (the spec's own figure)
    #   7.8333.. >= 7.75 grace floor -> Full Day (grace)
    hours = resolve_hours(time(9, 0), time(17, 50), d("1"), d("8"), _policy())
    assert hours.net_worked_hours == d("7.83")
    assert hours.balance_hours == d("-0.17")
    assert hours.day_status == "FULL_DAY_GRACE"


def test_grace_window_of_zero_switches_grace_off_entirely():
    # APPENDIX-B:58: "Grace Window of 0 switches grace off." The same 7.75 net
    # that was Full Day (grace) at a 15-minute window has no band to fall into
    # but Half Day once the window is 0:
    #   Net = 8.75 gross - 1.00 = 7.75; 7.75 < 8.00 target, >= 4.00 threshold
    #   Balance = 7.75 - 8.00 = -0.25
    hours = resolve_hours(time(9, 0), time(17, 45), d("1"), d("8"), _policy(grace_window_minutes=0))
    assert hours.net_worked_hours == d("7.75")
    assert hours.balance_hours == d("-0.25")
    assert hours.day_status == "HALF_DAY"


def test_one_minute_below_the_half_day_threshold_is_absent():
    # Half-day threshold 4.00. One minute BELOW it:
    #   Gross = 13:59 - 09:00 = 4h59m = 4.983333.. -> 4.98
    #   Net   = 4.983333.. - 1.00    = 3.983333.. -> 3.98, and 3.98 < 4.00
    hours = resolve_hours(time(9, 0), time(13, 59), d("1"), d("8"), _policy())
    assert hours.net_worked_hours == d("3.98")
    assert hours.day_status == "ABSENT"


def test_spec_own_half_day_worked_example_of_four_point_four_two():
    # APPENDIX-B:217 worked example: "4.42 worked against 8.00 required
    # resolved to Half Day".
    #   Gross   = 14:25:12 - 09:00:00 = 5h25m12s = 5.42
    #   Net     = 5.42 - 1.00 break              = 4.42  (the spec's own figure)
    #   Balance = 4.42 - 8.00                    = -3.58
    hours = resolve_hours(time(9, 0, 0), time(14, 25, 12), d("1"), d("8"), _policy())
    assert hours.net_worked_hours == d("4.42")
    assert hours.balance_hours == d("-3.58")
    assert hours.day_status == "HALF_DAY"


def test_no_half_day_threshold_configured_means_under_target_is_absent():
    # Half Day Threshold is optional in Masters §3.20. With none configured
    # the band does not exist, so 4.00 net against 8.00 required (which WOULD
    # be Half Day on the standard policy) has only Absent left to fall into.
    hours = resolve_hours(time(9, 0), time(14, 0), d("1"), d("8"), _policy(half_day_threshold_hours=None))
    assert hours.net_worked_hours == d("4.00")
    assert hours.day_status == "ABSENT"


def test_day_status_is_derived_from_hours_not_from_presence_present_all_day_but_short():
    # APPENDIX-B:105: "Day Status is DERIVED from hours, not from presence."
    # Someone on site the whole day, 09:00 to 18:00, who spent 4.5 hours of it
    # on break:
    #   Gross   = 9.00; Net = 9.00 - 4.50 = 4.50; Balance = 4.50 - 8.00 = -3.50
    # Nine hours of presence, and the day still resolves to the shortfall band.
    hours = resolve_hours(time(9, 0), time(18, 0), d("4.5"), d("8"), _policy())
    assert hours.gross_hours == d("9.00")  # present the full day
    assert hours.net_worked_hours == d("4.50")
    assert hours.balance_hours == d("-3.50")
    assert hours.day_status == "HALF_DAY"  # NOT Full Day, despite full presence


def test_day_status_derivation_cuts_both_ways_short_presence_can_be_a_full_day():
    # The mirror of the case above, on a half-day intern policy (Net = 4.00):
    # four hours of presence with no break is 4.00 net against 4.00 required,
    # Balance 0.00 -> a genuine Full Day. Presence tells you nothing either way;
    # only the hours against that date's target do.
    policy = _policy(net_working_hours_per_day=d("4"), half_day_threshold_hours=d("2"))
    hours = resolve_hours(time(9, 0), time(13, 0), d("0"), d("4"), policy)
    assert hours.net_worked_hours == d("4.00")
    assert hours.balance_hours == d("0.00")
    assert hours.day_status == "FULL_DAY"


# REGRESSION TEST for a real bug this suite found, now FIXED:
# a backwards pair is only treated as overnight when the caller says so.
def test_check_out_before_check_in_must_be_rejected_not_silently_reinterpreted():
    # COMPLETE-TEST-PROMPT §Layer 1 case list: "check-out before check-in
    # (must reject)". A same-day pair (spans_midnight=False) where Check-Out
    # precedes Check-In cannot produce a real Gross Hours figure -
    # 09:00 - 18:00 = -9 hours - so the entry must be refused, not reinterpreted.
    with pytest.raises(ValueError):
        resolve_hours(time(18, 0), time(9, 0), d("0"), d("8"), _policy(), spans_midnight=False)


def test_overnight_shift_crossing_midnight_with_a_break():
    # An explicitly flagged overnight shift:
    #   21:30 -> 24:00 = 2.50, 00:00 -> 06:15 = 6.25, Gross = 8.75
    #   Net     = 8.75 - 0.75 break    = 8.00
    #   Balance = 8.00 - 8.00 required = 0.00 -> Full Day
    hours = resolve_hours(time(21, 30), time(6, 15), d("0.75"), d("8"), _policy(), spans_midnight=True)
    assert hours.gross_hours == d("8.75")
    assert hours.net_worked_hours == d("8.00")
    assert hours.balance_hours == d("0.00")
    assert hours.day_status == "FULL_DAY"


def test_missing_check_out_contributes_no_worked_hours():
    # No Check-Out means no completed shift, so there is nothing to subtract a
    # break from: Gross = 0.00, Net = 0.00, Balance = 0.00 - 8.00 = -8.00, and
    # the day resolves to Absent on hours alone (the employee may well have
    # been present - APPENDIX-B:105 says presence is not what decides).
    hours = resolve_hours(time(9, 0), None, d("0"), d("8"), _policy())
    assert hours.gross_hours == d("0.00")
    assert hours.net_worked_hours == d("0.00")
    assert hours.balance_hours == d("-8.00")
    assert hours.day_status == "ABSENT"


def test_missing_check_in_is_treated_the_same_as_a_missing_check_out():
    # Symmetric: one half of the pair missing leaves Gross undefined, taken as
    # 0.00. Balance = 0.00 - 8.00 = -8.00.
    hours = resolve_hours(None, time(18, 0), d("0"), d("8"), _policy())
    assert hours.gross_hours == d("0.00")
    assert hours.balance_hours == d("-8.00")
    assert hours.day_status == "ABSENT"


def test_missing_check_out_with_a_break_still_applied_goes_negative():
    # Literal APPENDIX-B:105 arithmetic on an incomplete pair:
    #   Gross = 0.00 (no Check-Out); Net = 0.00 - 1.00 break = -1.00
    # NOTE (reported): a NEGATIVE net worked figure is nonsense as an hours
    # count, and hour_reconciliation.py sums net_worked_hours straight into
    # the period's Worked Hours, so one forgotten check-out with a break typed
    # in quietly removes an hour from the month. Flagged for a product
    # decision (clamp at 0, or refuse to accept a break with no check-out)
    # rather than silently asserted as correct here.
    hours = resolve_hours(time(9, 0), None, d("1"), d("8"), _policy())
    assert hours.net_worked_hours == d("-1.00")
    assert hours.balance_hours == d("-9.00")


def test_hours_worked_on_a_zero_required_day_are_credit_not_a_full_day():
    # A Sunday / Mandatory holiday / non-working Saturday sits at Required 0
    # (APPENDIX-B:215), so the bands do not apply at all:
    #   Gross = 14:00 - 10:00 = 4.00; Net = 4.00; Balance = 4.00 - 0.00 = +4.00
    # A positive balance on a zero-required day is exactly the compensatory
    # make-up shape (APPENDIX-B:218), never a Full Day.
    hours = resolve_hours(time(10, 0), time(14, 0), d("0"), d("0"), _policy())
    assert hours.net_worked_hours == d("4.00")
    assert hours.balance_hours == d("4.00")
    assert hours.day_status == "NOT_REQUIRED"


def test_hours_are_reported_to_the_two_decimal_places_the_spec_states():
    # APPENDIX-B:207/216/217 quote hours to 2 places ("8.00", "0.17", "4.42").
    #   Gross = 18:00:00 - 09:00:30 = 8h59m30s = 8.991666.. -> 8.99
    #   Net   = 8.991666.. - 1.00              = 7.991666.. -> 7.99
    #   Bal   = 7.991666.. - 8.00                           -> -0.01
    #   7.9916.. >= 7.75 grace floor -> Full Day (grace)
    hours = resolve_hours(time(9, 0, 30), time(18, 0, 0), d("1"), d("8"), _policy())
    assert hours.gross_hours == d("8.99")
    assert hours.net_worked_hours == d("7.99")
    assert hours.balance_hours == d("-0.01")
    assert hours.day_status == "FULL_DAY_GRACE"


@pytest.mark.parametrize(
    "check_out,expected_gross",
    [
        # Whole-minute check-outs against a 09:00 check-in, hand-computed:
        (time(17, 0), "8.00"),   # 8h00m = 8.00 exactly
        (time(17, 10), "8.17"),  # 8h10m = 8.166666.. -> 8.17
        (time(17, 20), "8.33"),  # 8h20m = 8.333333.. -> 8.33
        (time(17, 30), "8.50"),  # 8h30m = 8.50 exactly
        (time(17, 40), "8.67"),  # 8h40m = 8.666666.. -> 8.67
        (time(17, 50), "8.83"),  # 8h50m = 8.833333.. -> 8.83
    ],
)
def test_minute_granularity_gross_hours_round_to_two_places(check_out, expected_gross):
    # Minute-granularity input (what the Record Attendance form collects) can
    # never land exactly on a .005 rounding boundary, so these are unambiguous.
    # Second-granularity input CAN - see the reported float-precision note.
    hours = resolve_hours(time(9, 0), check_out, d("0"), d("8"), _policy())
    assert hours.gross_hours == d(expected_gross)


# ---------------------------------------------- required hours (APPENDIX-B:206)
# All seven Saturday rules over August 2026 (5 Saturdays: 01 08 15 22 29,
# 21 weekdays, no holidays), Net = 8.00:
#   ODD_WORKING  1st/3rd/5th work -> 01,15,29 = 3 Sat -> (21 + 3) x 8 = 192
#   EVEN_WORKING 2nd/4th work     -> 08,22    = 2 Sat -> (21 + 2) x 8 = 184
#   ALL_WORKING  every Saturday   -> 5 Sat            -> (21 + 5) x 8 = 208
#   ALL_OFF      none             -> 0 Sat            -> (21 + 0) x 8 = 168
#   FIRST_ONLY   01 only          -> 1 Sat            -> (21 + 1) x 8 = 176
#   LAST_ONLY    29 only          -> 1 Sat            -> (21 + 1) x 8 = 176
#   CUSTOM       the dated Saturday Override rows ARE the answer, so with no
#                override rows no Saturday works    -> (21 + 0) x 8 = 168
@pytest.mark.parametrize(
    "saturday_rule,expected_required_hours",
    [
        ("ODD_WORKING", "192"),
        ("EVEN_WORKING", "184"),
        ("ALL_WORKING", "208"),
        ("ALL_OFF", "168"),
        ("FIRST_ONLY", "176"),
        ("LAST_ONLY", "176"),
        ("CUSTOM", "168"),
    ],
)
def test_required_hours_for_every_one_of_the_seven_saturday_rules(saturday_rule, expected_required_hours):
    totals = _period_required_hours(*AUGUST_2026, _policy(saturday_rule=saturday_rule))
    assert totals.required_hours == d(expected_required_hours)


def test_custom_saturday_rule_reads_its_hours_from_the_dated_override_rows():
    # CUSTOM + two dated Saturday Override rows, one full and one explicitly
    # short (a half working Saturday declared on the row itself):
    #   21 weekdays x 8.00                = 168
    #   08-08 override WORKING  8.00      = +8
    #   22-08 override WORKING  4.00      = +4
    #                                  total 180
    overrides = {
        date(2026, 8, 8): SaturdayOverrideSnapshot(override_to="WORKING", hours_required=d("8")),
        date(2026, 8, 22): SaturdayOverrideSnapshot(override_to="WORKING", hours_required=d("4")),
    }
    totals = _period_required_hours(*AUGUST_2026, _policy(saturday_rule="CUSTOM"), overrides=overrides)
    assert totals.required_hours == d("180")


def test_last_only_pattern_needs_the_calendar_context_the_caller_must_supply():
    # saturday_is_working_by_pattern cannot answer LAST_ONLY on the ordinal
    # alone - "the last Saturday" is a calendar fact about the month, not an
    # ordinal - so it returns False for every ordinal and resolve_day's
    # is_last_saturday_of_month argument is what actually decides.
    assert [saturday_is_working_by_pattern(o, "LAST_ONLY") for o in (1, 2, 3, 4, 5)] == [False] * 5
    # With the context supplied, 29-08-2026 (the last Saturday of August) is a
    # working Saturday at the full Net figure and 22-08-2026 is not.
    last = resolve_day(date(2026, 8, 29), _policy(saturday_rule="LAST_ONLY"), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None, is_last_saturday_of_month=True)
    not_last = resolve_day(date(2026, 8, 22), _policy(saturday_rule="LAST_ONLY"), is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None, is_last_saturday_of_month=False)
    assert (last.day_type, last.required_hours) == ("WORKING_SATURDAY", d("8"))
    assert (not_last.day_type, not_last.required_hours) == ("WEEKLY_OFF", d("0"))


def test_a_four_saturday_month_and_a_five_saturday_month_differ_by_one_working_saturday():
    # Same policy (ODD_WORKING, Net 8.00), different calendars:
    #   Aug 2026 (5 Saturdays): 21 weekdays + Sat 01,15,29 = 24 days x 8 = 192
    #   Feb 2026 (4 Saturdays): 20 weekdays + Sat 07,21    = 22 days x 8 = 176
    #   two working days apart (one weekday, one working Saturday) = 16 hours
    august = _period_required_hours(*AUGUST_2026, _policy()).required_hours
    february = _period_required_hours(*FEBRUARY_2026, _policy()).required_hours
    assert august == d("192")
    assert february == d("176")
    assert august - february == d("16")


def test_a_mandatory_holiday_on_a_working_saturday_wins_and_drops_that_day_to_zero():
    # APPENDIX-B:60's own worked example: 15-08-2026 is the 3rd Saturday, which
    # ODD_WORKING would make working, and Independence Day is a Mandatory
    # holiday. The holiday wins, required hours drop to ZERO for that date:
    #   baseline 192 - 8.00 for 15-08 = 184
    totals = _period_required_hours(*AUGUST_2026, _policy(), mandatory=[date(2026, 8, 15)])
    assert totals.required_hours == d("184")
    assert totals.day_types["MANDATORY_HOLIDAY"] == 1
    assert totals.day_types["WORKING_SATURDAY"] == 2  # 01 and 29 survive; 15 was taken by the holiday


def test_the_holiday_beats_saturday_rule_is_a_policy_toggle_not_a_hardcoded_rule():
    # Same holiday, same Saturday, toggle OFF: the Saturday stays working, so
    # the total is the unreduced 24 x 8 = 192. (APPENDIX-B:60 states the
    # override applies "when 'Mandatory Holiday Overrides Saturday' is on".)
    totals = _period_required_hours(*AUGUST_2026, _policy(mandatory_holiday_overrides_saturday=False), mandatory=[date(2026, 8, 15)])
    assert totals.required_hours == d("192")
    assert totals.day_types["WORKING_SATURDAY"] == 3


def test_an_optional_holiday_never_reduces_required_hours():
    # APPENDIX-B:60/41: an OPTIONAL holiday never overrides anything - the day
    # stays working and whoever takes it draws on their leave balance. 14-08
    # (a Friday) marked Optional leaves the August total untouched at 192.
    totals = _period_required_hours(*AUGUST_2026, _policy(), optional=[date(2026, 8, 14)])
    assert totals.required_hours == d("192")


def test_working_days_decompose_exactly_as_the_formula_states():
    # APPENDIX-B:206: working days = calendar weekdays - Mandatory holidays
    #                                + working Saturdays.
    # August 2026 with 14-08 (a Friday) as a Mandatory holiday, ODD_WORKING:
    #   weekdays 21 - 1 mandatory = 20 working weekdays
    #   working Saturdays        = 01, 15, 29 = 3
    #   weekly off               = 5 Sundays + Sat 08, 22 = 7
    #   20 + 3 + 1 + 7 = 31 calendar days, and (20 + 3) x 8.00 = 184
    totals = _period_required_hours(*AUGUST_2026, _policy(), mandatory=[date(2026, 8, 14)])
    assert totals.day_types["WORKING_DAY"] == 20
    assert totals.day_types["WORKING_SATURDAY"] == 3
    assert totals.day_types["MANDATORY_HOLIDAY"] == 1
    assert totals.day_types["WEEKLY_OFF"] == 7
    assert sum(totals.day_types.values()) == 31
    assert totals.required_hours == d("184")


def test_half_day_intern_policy_is_measured_against_its_own_target():
    # APPENDIX-B:206: "a six-day support team and a half-day intern are
    # measured against their own targets computed the same way."
    # Intern policy: Net Working Hours per Day = 4.00, ODD_WORKING, full-length
    # working Saturdays -> (21 weekdays + 3 Saturdays) x 4.00 = 96
    intern = _period_required_hours(*AUGUST_2026, _policy(net_working_hours_per_day=d("4")))
    assert intern.required_hours == d("96")
    # Same intern policy with half-length working Saturdays (APPENDIX-B:61,
    # 50% of Net = 2.00): 21 x 4.00 + 3 x 2.00 = 84 + 6 = 90
    intern_half_saturdays = _period_required_hours(*AUGUST_2026, _policy(net_working_hours_per_day=d("4"), working_saturday_hours_mode="HALF"))
    assert intern_half_saturdays.required_hours == d("90")


def test_six_day_support_policy_is_measured_against_its_own_target():
    # Six-day week: Sunday off, every Saturday working, Net 8.00
    #   21 weekdays + 5 Saturdays = 26 days x 8.00 = 208
    support = _period_required_hours(*AUGUST_2026, _policy(saturday_rule="ALL_WORKING"))
    assert support.required_hours == d("208")
    # A five-day week over the same calendar: 21 x 8.00 = 168. The support
    # team owes 40 hours more for the identical month.
    five_day = _period_required_hours(*AUGUST_2026, _policy(weekly_off_days="SAT_SUN", saturday_rule="ALL_OFF"))
    assert five_day.required_hours == d("168")
    assert support.required_hours - five_day.required_hours == d("40")


def test_a_policy_change_mid_period_splits_the_period_at_the_effective_from_date():
    # APPENDIX-B:69: work week policy changes are forward-only, which is
    # exactly why Effective From exists. Policy A covers 01-15 Aug, policy B
    # (Net 7.5, every Saturday working) takes effect 16 Aug.
    #   01-15 under A: weekdays 03-07 and 10-14 = 10 x 8.00 = 80
    #                  Saturdays 01 (1st) and 15 (3rd) working = 2 x 8.00 = 16
    #                  Sundays 02, 09 = 0                              -> 96
    #   16-31 under B: weekdays 17-21, 24-28, 31 = 11 x 7.50 = 82.50
    #                  Saturdays 22, 29 working  =  2 x 7.50 = 15.00
    #                  Sundays 16, 23, 30 = 0                          -> 97.50
    #   period total = 96 + 97.50 = 193.50
    policy_a = _policy()
    policy_b = _policy(net_working_hours_per_day=d("7.5"), saturday_rule="ALL_WORKING")
    first_half = _period_required_hours(date(2026, 8, 1), date(2026, 8, 15), policy_a).required_hours
    second_half = _period_required_hours(date(2026, 8, 16), date(2026, 8, 31), policy_b).required_hours
    assert first_half == d("96")
    assert second_half == d("97.5")
    assert first_half + second_half == d("193.5")
    # And the split figure is not either whole-month figure - 24 x 8.00 = 192
    # under A alone, (21 + 5) x 7.50 = 195 under B alone.
    assert _period_required_hours(*AUGUST_2026, policy_a).required_hours == d("192")
    assert _period_required_hours(*AUGUST_2026, policy_b).required_hours == d("195")
    assert first_half + second_half not in (d("192"), d("195"))


def test_required_hours_follow_the_pay_cycle_period_not_the_calendar_month():
    # APPENDIX-B:219: the default cycle is 26th-25th, so "August 2026" is
    # 26-07-2026 to 25-08-2026, NOT 01-31 August.
    #   Jul 27,28,29,30,31 = 5 weekdays (Jul 26 is a Sunday)
    #   Aug 03-07, 10-14, 17-21, 24-25 = 5+5+5+2 = 17 weekdays
    #   weekdays 22 x 8.00 = 176
    #   Saturdays in window: 01 (1st, working), 08 (2nd, off), 15 (3rd,
    #   working), 22 (4th, off) -> 2 working x 8.00 = 16
    #   total 192  (a coincidence that it equals calendar August: the day mix
    #   is different - 22 weekdays + 2 Saturdays, not 21 + 3)
    cycle = _period_required_hours(date(2026, 7, 26), date(2026, 8, 25), _policy())
    assert cycle.day_types["WORKING_DAY"] == 22
    assert cycle.day_types["WORKING_SATURDAY"] == 2
    assert cycle.required_hours == d("192")
    # Independence Day inside the window still wins over the 3rd Saturday:
    #   192 - 8.00 = 184
    with_holiday = _period_required_hours(date(2026, 7, 26), date(2026, 8, 25), _policy(), mandatory=[date(2026, 8, 15)])
    assert with_holiday.required_hours == d("184")


def test_nothing_in_the_required_hours_calculation_is_a_constant():
    # APPENDIX-B:206, the assertion the spec asks for above all others:
    # "Nothing in this calculation is a constant." Same month, same calendar,
    # one policy field changed at a time - the number MUST move every time.
    baseline = _period_required_hours(*AUGUST_2026, _policy()).required_hours
    assert baseline == d("192")  # (21 + 3) x 8.00

    net_seven_and_a_half = _period_required_hours(*AUGUST_2026, _policy(net_working_hours_per_day=d("7.5"))).required_hours
    assert net_seven_and_a_half == d("180")  # 24 x 7.50

    net_six_and_a_half = _period_required_hours(*AUGUST_2026, _policy(net_working_hours_per_day=d("6.5"))).required_hours
    assert net_six_and_a_half == d("156")  # 24 x 6.50

    even_saturdays = _period_required_hours(*AUGUST_2026, _policy(saturday_rule="EVEN_WORKING")).required_hours
    assert even_saturdays == d("184")  # (21 + 2) x 8.00

    half_saturdays = _period_required_hours(*AUGUST_2026, _policy(working_saturday_hours_mode="HALF")).required_hours
    assert half_saturdays == d("180")  # 21 x 8.00 + 3 x 4.00

    custom_saturdays = _period_required_hours(*AUGUST_2026, _policy(working_saturday_hours_mode="CUSTOM", custom_saturday_hours=d("5"))).required_hours
    assert custom_saturdays == d("183")  # 21 x 8.00 + 3 x 5.00

    no_saturdays = _period_required_hours(*AUGUST_2026, _policy(weekly_off_days="SAT_SUN", saturday_rule="ALL_OFF")).required_hours
    assert no_saturdays == d("168")  # 21 x 8.00

    # Every single-field change moved the answer, and five distinct totals came
    # out of one calendar - which is what "configuration-driven" means here.
    changed = [net_seven_and_a_half, net_six_and_a_half, even_saturdays, half_saturdays, custom_saturdays, no_saturdays]
    assert all(value != baseline for value in changed)
    # 180 comes out twice by arithmetic coincidence (24 x 7.50, and
    # 21 x 8.00 + 3 x 4.00), so six single-field changes give five totals.
    assert len(set(changed)) == 5


def test_a_zero_hour_policy_produces_zero_required_hours_and_never_divides_by_zero():
    # The only division in the required-hours path is the 50%-of-Net working
    # Saturday (APPENDIX-B:61). A Net of 0.00 makes it 0.00 / 2 = 0.00 - zero
    # is the numerator, never the divisor - so a zero-hour policy (a
    # fully-suspended or unpaid-intern arrangement) must resolve to 0 required
    # hours for every day of the period rather than raising.
    zero_policy = _policy(net_working_hours_per_day=d("0"), working_saturday_hours_mode="HALF")
    saturday = resolve_day(date(2026, 8, 1), zero_policy, is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert saturday.day_type == "WORKING_SATURDAY"
    assert saturday.required_hours == d("0")  # 0.00 / 2
    totals = _period_required_hours(*AUGUST_2026, zero_policy)
    assert totals.required_hours == d("0")  # 24 working days x 0.00
    # And a day with zero required hours still resolves a status rather than
    # dividing anything: Balance = Net - 0.
    hours = resolve_hours(time(9, 0), time(17, 0), d("0"), d("0"), zero_policy)
    assert hours.balance_hours == d("8.00")
    assert hours.day_status == "NOT_REQUIRED"


def test_custom_saturday_hours_left_unset_resolves_to_zero_not_a_crash():
    # Masters §3.20 requires Custom Saturday Hours only when the mode is
    # Custom; a row saved with the mode set and the hours missing must not
    # blow up the day resolution - it resolves to 0.00 required.
    policy = _policy(working_saturday_hours_mode="CUSTOM", custom_saturday_hours=None)
    saturday = resolve_day(date(2026, 8, 1), policy, is_mandatory_holiday=False, is_optional_holiday=False, saturday_override=None)
    assert saturday.day_type == "WORKING_SATURDAY"
    assert saturday.required_hours == d("0")
    # Over the month that is 21 weekdays x 8.00 + 3 Saturdays x 0.00 = 168
    assert _period_required_hours(*AUGUST_2026, policy).required_hours == d("168")
