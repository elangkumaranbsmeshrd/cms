"""Pay-period resolution, A115's unpaid-leave formula, shortfall conversion,
partial-period proration, and income-tax annualization — boundary values,
not just the happy path (BUILD-PROMPT §14 Definition of Done #7).

COMPLETE-TEST-PROMPT §Layer 1's governing rule applies to everything below:
"Never assert against what the code returns — assert against a number you
worked out yourself from the spec." Every expected figure added here was
hand-computed from APPENDIX-B-business-rules.md FIRST and the arithmetic is
written out in a comment above the assertion, so a test that goes red is a
statement about the code, never a statement about what the code used to do.
"""

import dataclasses
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.services import tax_engine
from app.services.payroll_engine import (
    calculate_unpaid_leave_deduction,
    compute_income_tax,
    convert_shortfall,
    prorate_gross_for_partial_period,
    resolve_pay_period,
)


def d(x: str) -> Decimal:
    return Decimal(x)


# The dev DB's active Pay Cycle, verbatim: FIXED_CYCLE, Start Day 26, End Day
# 25, Salary Credit Day 30, effective_from 2026-04-01 — and also APPENDIX-B's
# own worked example ("PAY CYCLE CUTOFF RULE (26th–25th default)").
LIVE_CYCLE = dict(cycle_type="FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)


# ======================================================== resolve_pay_period
def test_fixed_cycle_worked_example_26_to_25():
    # Payroll §3.1b, verbatim: Start Day 26, End Day 25, Credit Day 30.
    r = resolve_pay_period(7, 2026, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)
    assert r.period_start == date(2026, 6, 26)
    assert r.period_end == date(2026, 7, 25)
    assert r.salary_credit_date == date(2026, 7, 30)


def test_fixed_cycle_august_window_for_carryover():
    r = resolve_pay_period(8, 2026, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)
    assert r.period_start == date(2026, 7, 26)
    assert r.period_end == date(2026, 8, 25)


def test_27_07_2026_carryover_case_the_acceptance_gate():
    # THE Phase 3 acceptance-gate case (BUILD-PROMPT §13): an event dated
    # 27-07-2026 must fall outside July's window and inside August's.
    event_date = date(2026, 7, 27)
    july = resolve_pay_period(7, 2026, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)
    august = resolve_pay_period(8, 2026, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)
    assert not (july.period_start <= event_date <= july.period_end)
    assert august.period_start <= event_date <= august.period_end


def test_fixed_cycle_january_crosses_year_boundary():
    r = resolve_pay_period(1, 2027, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30)
    assert r.period_start == date(2026, 12, 26)
    assert r.period_end == date(2027, 1, 25)


def test_fixed_cycle_clamps_short_month_february():
    r = resolve_pay_period(2, 2026, "FIXED_CYCLE", start_day=30, end_day=28, salary_credit_day=31)
    assert r.period_end == date(2026, 2, 28)  # 2026 is not a leap year
    assert r.period_start == date(2026, 1, 30)


def test_fixed_cycle_credit_day_before_cutoff_pushes_to_next_month():
    # Credit Day 20 is before End Day 25 in the same month — must never
    # violate "salary_credit_date > period_end" (ck_pay_periods_credit).
    r = resolve_pay_period(7, 2026, "FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=20)
    assert r.salary_credit_date > r.period_end
    assert r.salary_credit_date == date(2026, 8, 20)


def test_calendar_month_basis():
    r = resolve_pay_period(4, 2026, "CALENDAR_MONTH", start_day=None, end_day=None, salary_credit_day=1)
    assert r.period_start == date(2026, 4, 1)
    assert r.period_end == date(2026, 4, 30)
    assert r.salary_credit_date == date(2026, 5, 1)


# ============================================================ A115 formula
def test_unpaid_leave_deduction_a115_formula():
    # (Gross Pay / Total Days in Period) x Unpaid Leave Days
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("2")) == d("4000.00")


def test_unpaid_leave_deduction_zero_days_is_zero():
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("0")) == d("0")


def test_unpaid_leave_deduction_zero_total_days_does_not_divide_by_zero():
    assert calculate_unpaid_leave_deduction(d("60000"), d("0"), d("2")) == d("0")


# ======================================================== convert_shortfall
def test_shortfall_pro_rata_matches_spec_worked_example():
    # Payroll §3.4: Arun Menon, 3.58 hours short, 8.00 net hours/day,
    # PRO_RATA_LOP — priced on the exact fractional hours, not rounded.
    result = convert_shortfall(
        net_short_hours=d("3.58"), net_hours_per_day=d("8.00"), gross_pay=d("60000"),
        total_days_in_period=d("30"), rule="PRO_RATA_LOP",
    )
    assert result.lop_days == d("3.58") / d("8.00")
    assert result.lop_deduction > 0


def test_shortfall_ignore_rule_produces_no_deduction():
    result = convert_shortfall(net_short_hours=d("5"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("30"), rule="IGNORE")
    assert result.lop_days == 0 and result.lop_deduction == 0


def test_shortfall_zero_hours_short_produces_no_deduction():
    result = convert_shortfall(net_short_hours=d("0"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("30"), rule="PRO_RATA_LOP")
    assert result.lop_days == 0 and result.lop_deduction == 0


def test_shortfall_round_half_day_rounds_up_to_half_day_increment():
    # 2.1 hours short of an 8-hour day -> exact 0.2625 days, rounds UP to 0.5.
    result = convert_shortfall(net_short_hours=d("2.1"), net_hours_per_day=d("8"), gross_pay=d("80000"), total_days_in_period=d("30"), rule="ROUND_HALF_DAY")
    assert result.lop_days == d("0.5")


def test_shortfall_round_full_day_rounds_up_to_whole_day():
    result = convert_shortfall(net_short_hours=d("0.5"), net_hours_per_day=d("8"), gross_pay=d("80000"), total_days_in_period=d("30"), rule="ROUND_FULL_DAY")
    assert result.lop_days == d("1")


def test_shortfall_leave_then_lop_offsets_from_available_leave_first():
    # 1.5 days' worth short; 1 day of leave available -> 0.5 day remains LOP.
    result = convert_shortfall(
        net_short_hours=d("12"), net_hours_per_day=d("8"), gross_pay=d("80000"), total_days_in_period=d("30"),
        rule="LEAVE_THEN_LOP", available_leave_days=d("1"),
    )
    assert result.leave_days_used == d("1")
    assert result.lop_days == d("0.5")


def test_shortfall_leave_then_lop_no_leave_available_is_all_lop():
    result = convert_shortfall(
        net_short_hours=d("8"), net_hours_per_day=d("8"), gross_pay=d("80000"), total_days_in_period=d("30"),
        rule="LEAVE_THEN_LOP", available_leave_days=d("0"),
    )
    assert result.leave_days_used == d("0")
    assert result.lop_days == d("1")


# ================================================= prorate_gross_for_partial
def test_prorate_full_period_returns_gross_unchanged():
    assert prorate_gross_for_partial_period(d("60000"), d("30"), d("30")) == d("60000.00")


def test_prorate_partial_period_mid_month_joiner():
    assert prorate_gross_for_partial_period(d("60000"), d("30"), d("15")) == d("30000.00")


def test_prorate_zero_days_employed_is_zero():
    assert prorate_gross_for_partial_period(d("60000"), d("30"), d("0")) == d("0.00")


# ===================================================== compute_income_tax
class _FakeResult:
    def __init__(self, gross, computed):
        self.gross_amount = gross
        self.computed_amount = computed


def test_income_tax_annualizes_and_spreads_over_remaining_months():
    def fake_calc(snapshot, base):
        assert base == d("600000")  # 50000*12, no adhoc/variable/reductions
        return _FakeResult(d("60000"), d("60000"))

    result = compute_income_tax(
        annual_gross=d("600000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"),
        annual_declared_reductions=d("0"), calculate_tax_fn=fake_calc, snapshot=None, remaining_payroll_months=12,
    )
    assert result.annualized_taxable_income == d("600000")
    assert result.monthly_amount == d("5000.00")


def test_income_tax_subtracts_declared_reductions_before_calculating():
    captured = {}

    def fake_calc(snapshot, base):
        captured["base"] = base
        return _FakeResult(d("0"), d("0"))

    compute_income_tax(
        annual_gross=d("600000"), annual_taxable_adhoc=d("50000"), annual_variable_pay=d("0"),
        annual_declared_reductions=d("150000"), calculate_tax_fn=fake_calc, snapshot=None, remaining_payroll_months=6,
    )
    assert captured["base"] == d("500000")  # 600000 + 50000 - 150000


def test_income_tax_reductions_never_take_base_below_zero():
    captured = {}

    def fake_calc(snapshot, base):
        captured["base"] = base
        return _FakeResult(d("0"), d("0"))

    compute_income_tax(
        annual_gross=d("100000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"),
        annual_declared_reductions=d("999999"), calculate_tax_fn=fake_calc, snapshot=None, remaining_payroll_months=6,
    )
    assert captured["base"] == d("0")


def test_income_tax_zero_remaining_months_produces_nothing():
    # §2.1 step 6: "if no income-tax head is configured, this step produces
    # nothing" — same "produce nothing, don't error" behaviour when there's
    # no month left to spread it over (e.g. the FY's last processed month).
    result = compute_income_tax(
        annual_gross=d("600000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"),
        annual_declared_reductions=d("0"), calculate_tax_fn=lambda *a: (_ for _ in ()).throw(AssertionError("should not be called")),
        snapshot=None, remaining_payroll_months=0,
    )
    assert result.monthly_amount == d("0")


# ############################################################################
# ############  A115 UNPAID LEAVE DEDUCTION — APPENDIX-B:223  ################
# ############################################################################
# "UNPAID LEAVE DEDUCTION = (Gross Pay ÷ Total Days in Month) × Unpaid Leave
# Days." Every figure below is that division and multiplication done by hand,
# then rounded to 2 decimals HALF-UP (payroll_engine.MONEY_PLACES).


def test_unpaid_leave_one_full_day_in_a_30_day_period():
    # 60000 ÷ 30 = 2000.00 per day; × 1 day = 2000.00
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("1")) == d("2000.00")


def test_unpaid_leave_every_day_in_the_period_wipes_the_entire_gross():
    # The spec's ceiling case: unpaid for the whole period.
    # 60000 ÷ 30 = 2000.00 per day; × 30 days = 60000.00 — exactly the gross,
    # so the deduction cancels pay to zero and never overshoots it.
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("30")) == d("60000.00")


def test_unpaid_leave_28_30_and_31_day_months_give_three_different_answers():
    # The divisor is Total Days in Month, not a 30-day constant — the same
    # gross and the same single unpaid day must cost three different amounts.
    #   28-day February: 60000 ÷ 28 = 2142.857142857...  → 2142.86 (3rd dp 7, up)
    #   30-day month:    60000 ÷ 30 = 2000.00 exactly    → 2000.00
    #   31-day month:    60000 ÷ 31 = 1935.483870967...  → 1935.48 (3rd dp 3, down)
    feb = calculate_unpaid_leave_deduction(d("60000"), d("28"), d("1"))
    thirty = calculate_unpaid_leave_deduction(d("60000"), d("30"), d("1"))
    thirty_one = calculate_unpaid_leave_deduction(d("60000"), d("31"), d("1"))
    assert feb == d("2142.86")
    assert thirty == d("2000.00")
    assert thirty_one == d("1935.48")
    assert feb > thirty > thirty_one


def test_unpaid_leave_february_in_a_leap_year_divides_by_29_not_28():
    # February 2028 has 29 days (2028 ÷ 4 = 507, not a century year).
    # 60000 ÷ 29 = 2068.9655172413793...  → 2068.97 (3rd dp 5, HALF-UP)
    # A leap February must cost LESS per unpaid day than a 28-day one
    # (2068.97 < 2142.86) — the extra day widens the divisor.
    assert calculate_unpaid_leave_deduction(d("60000"), d("29"), d("1")) == d("2068.97")
    assert calculate_unpaid_leave_deduction(d("60000"), d("29"), d("1")) < calculate_unpaid_leave_deduction(d("60000"), d("28"), d("1"))


def test_unpaid_leave_fractional_half_day():
    # Leave §2.2 permits half-day requests, so Unpaid Leave Days is fractional.
    # 60000 ÷ 30 = 2000.00 per day; × 0.5 = 1000.00 — exactly half a full day.
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("0.5")) == d("1000.00")
    # ...and two half-days must cost exactly what one whole day costs.
    assert calculate_unpaid_leave_deduction(d("60000"), d("30"), d("0.5")) * 2 == calculate_unpaid_leave_deduction(d("60000"), d("30"), d("1"))


def test_unpaid_leave_gross_of_zero_deducts_nothing():
    # 0 ÷ 30 = 0.00 per day; × 2 days = 0.00. Nothing to deduct from, and
    # nothing to crash on — an unpaid day must never manufacture a negative.
    assert calculate_unpaid_leave_deduction(d("0"), d("30"), d("2")) == d("0")


def test_unpaid_leave_rounds_half_up_at_the_second_decimal():
    # Money is 2 decimals, ROUND_HALF_UP — pinned on an exact .005 tie so a
    # silent switch to HALF_EVEN/truncation is caught.
    #   1000.05 ÷ 30 = 33.335 exactly; × 3 = 100.005
    #   HALF_UP at 2dp -> 100.01   (HALF_EVEN would give 100.00, truncation 100.00)
    assert calculate_unpaid_leave_deduction(d("1000.05"), d("30"), d("3")) == d("100.01")
    # Single-day tie in the same shape: 33.335 -> 33.34, never 33.33.
    assert calculate_unpaid_leave_deduction(d("1000.05"), d("30"), d("1")) == d("33.34")


def test_unpaid_leave_negative_total_days_does_not_divide():
    # Divide-by-zero's neighbour: a corrupt/absent period length must not
    # produce a NEGATIVE deduction (which would silently PAY the employee for
    # being absent). Total Days <= 0 is the same "no basis to price a day"
    # situation as Total Days == 0.
    assert calculate_unpaid_leave_deduction(d("60000"), d("-5"), d("2")) == d("0")


# ############################################################################
# ####################  PAY CYCLE RESOLUTION — APPENDIX-B  ###################
# ############################################################################


def test_live_cycle_february_credit_day_30_clamps_and_stays_inside_february():
    # The dev DB's real cycle (26/25/30) run for February 2026.
    #   period_end   = 25-02-2026 (End Day 25 <= 28, no clamping needed)
    #   credit day 30 > 28 days in Feb 2026 -> clamps to 28-02-2026
    # 28-02 is AFTER the 25-02 cutoff, so the clamp is the final answer: the
    # credit date must NOT roll forward into March. Salary for the February
    # period is credited in February.
    r = resolve_pay_period(2, 2026, **LIVE_CYCLE)
    assert r.period_start == date(2026, 1, 26)
    assert r.period_end == date(2026, 2, 25)
    assert r.salary_credit_date == date(2026, 2, 28)
    assert r.salary_credit_date.month == 2, "credit day 30 must clamp to Feb's last day, never overflow into March"


def test_live_cycle_credit_day_30_in_a_leap_february_clamps_to_the_29th():
    # Same cycle, February 2028 (leap): 29 days, so credit day 30 clamps one
    # day later than in a common year — 29-02-2028, still after the 25-02
    # cutoff and still inside February.
    r = resolve_pay_period(2, 2028, **LIVE_CYCLE)
    assert r.period_end == date(2028, 2, 25)
    assert r.salary_credit_date == date(2028, 2, 29)


def test_end_day_boundary_the_25th_is_in_july_the_26th_is_in_august():
    # APPENDIX-B: "'July 2026' covers 26-06-2026 through 25-07-2026" — so the
    # cutoff is a hard edge, not a fuzzy one. Assert BOTH sides of it: the
    # 25th is July's last day and the 26th is August's first, with no day
    # belonging to neither and none belonging to both.
    july = resolve_pay_period(7, 2026, **LIVE_CYCLE)
    august = resolve_pay_period(8, 2026, **LIVE_CYCLE)
    on_cutoff, day_after = date(2026, 7, 25), date(2026, 7, 26)
    assert july.period_start <= on_cutoff <= july.period_end
    assert not (august.period_start <= on_cutoff <= august.period_end)
    assert not (july.period_start <= day_after <= july.period_end)
    assert august.period_start <= day_after <= august.period_end


def test_live_cycle_periods_are_contiguous_all_year_no_gaps_no_overlaps():
    # "which period an event belongs to is decided purely by comparing its
    # date against the Pay Cycle's resolved range for each month" — that only
    # produces one answer per date if consecutive windows meet exactly.
    # Hand-check of the general case for Start Day 26 / End Day 25: every
    # month has at least 28 days, so neither 25 nor 26 ever clamps, and each
    # period ends on the 25th with the next starting on the 26th of the same
    # month. Asserted for all 12 months of 2026 plus the year rollover.
    months = [(m, 2026) for m in range(1, 13)] + [(1, 2027)]
    for (m1, y1), (m2, y2) in zip(months, months[1:]):
        this = resolve_pay_period(m1, y1, **LIVE_CYCLE)
        nxt = resolve_pay_period(m2, y2, **LIVE_CYCLE)
        assert this.period_end.day == 25
        assert nxt.period_start.day == 26
        assert nxt.period_start == this.period_end + timedelta(days=1), f"gap or overlap between {m1}/{y1} and {m2}/{y2}"


def test_multi_day_leave_spanning_the_cutoff_splits_across_both_periods():
    # APPENDIX-B's carryover rule is per-DATE, so a request straddling the
    # cutoff belongs partly to each period — never in full to both.
    # Leave 23-07-2026 to 29-07-2026 = 7 calendar days.
    #   July window  26-06 .. 25-07 -> 23,24,25 July              = 3 days
    #   August window 26-07 .. 25-08 -> 26,27,28,29 July          = 4 days
    #   3 + 4 = 7, and no date appears twice.
    july = resolve_pay_period(7, 2026, **LIVE_CYCLE)
    august = resolve_pay_period(8, 2026, **LIVE_CYCLE)
    leave_from, leave_to = date(2026, 7, 23), date(2026, 7, 29)

    def _overlap_days(period) -> int:
        lo, hi = max(leave_from, period.period_start), min(leave_to, period.period_end)
        return (hi - lo).days + 1 if lo <= hi else 0

    assert _overlap_days(july) == 3
    assert _overlap_days(august) == 4
    assert _overlap_days(july) + _overlap_days(august) == (leave_to - leave_from).days + 1 == 7


def test_calendar_month_basis_clamps_february_in_both_common_and_leap_years():
    # CALENDAR_MONTH's End Day is "the last day", whatever that is:
    #   Feb 2026 -> 28-02-2026 (common year)
    #   Feb 2028 -> 29-02-2028 (leap year)
    # Credit day 5 falls BEFORE both cutoffs, so it must roll into the next
    # month — a period can never credit on or before its own cutoff.
    common = resolve_pay_period(2, 2026, "CALENDAR_MONTH", start_day=None, end_day=None, salary_credit_day=5)
    leap = resolve_pay_period(2, 2028, "CALENDAR_MONTH", start_day=None, end_day=None, salary_credit_day=5)
    assert common.period_start == date(2026, 2, 1) and common.period_end == date(2026, 2, 28)
    assert leap.period_start == date(2028, 2, 1) and leap.period_end == date(2028, 2, 29)
    assert common.salary_credit_date == date(2026, 3, 5)
    assert leap.salary_credit_date == date(2028, 3, 5)


# REGRESSION TEST for a real bug this suite found and which is now FIXED
# (payroll_engine.resolve_pay_period). It was written first as a strict xfail,
# against the spec's arithmetic rather than against the code's output — which
# is the whole reason the bug surfaced instead of being frozen into a test.
def test_month_end_cutoff_config_must_not_put_one_date_in_two_periods():
    # Configuration under test: Start Day 29 / End Day 28 — a perfectly
    # ordinary "29th-to-28th" cycle. Nothing forbids it: pay_cycles' CHECK
    # constraints only bound both to 1..31 (alembic 0002_masters.py:958-959)
    # and PayCycleWrite (app/schemas/masters.py:400-402) has no validator.
    #
    # Hand-computed from APPENDIX-B ("'July 2026' covers 26-06-2026 through
    # 25-07-2026" — i.e. a period ends on End Day and the next starts on Start
    # Day, contiguously):
    #   February 2026 = 29-01-2026 .. 28-02-2026   (End Day 28 == Feb's length)
    #   March 2026 should start 01-03-2026 at the latest — it cannot legally
    #   start on a date February already owns.
    # What the code produces instead:
    #   March's period_start = _clamp_day(2026, 2, 29) = 28-02-2026
    #   => 28-02-2026 is inside BOTH windows.
    # Consequence, using A115 on a 60000 gross: an approved UNPAID leave day
    # dated 28-02-2026 is picked up by February's run (60000 ÷ 31 days in the
    # 29-01..28-02 window = 1935.48) and AGAIN by March's run — the employee
    # is deducted twice for one absent day, and every attendance record and
    # compensatory make-up day on that date is likewise counted twice, since
    # APPENDIX-B routes every dated input through this same comparison.
    # Same collapse for Start 30/End 29 and Start 31/End 30, and in leap years
    # it lands on 29-02 instead.
    feb = resolve_pay_period(2, 2026, "FIXED_CYCLE", start_day=29, end_day=28, salary_credit_day=30)
    march = resolve_pay_period(3, 2026, "FIXED_CYCLE", start_day=29, end_day=28, salary_credit_day=30)
    assert feb.period_end == date(2026, 2, 28)
    assert march.period_start == feb.period_end + timedelta(days=1)


# ############################################################################
# ##################  PAYROLL RUN ASSEMBLY — APPENDIX-B  #####################
# ############################################################################
# The full assembly lives in an async, DB-bound router
# (app/api/v1/payroll_runs.py::_calculate_employee), so Layer 1 exercises it
# by composing the SAME engine calls in the SAME documented order. _assemble
# below is a faithful transcription of that function's arithmetic — the money
# still comes from the real prorate_gross_for_partial_period /
# tax_engine.calculate_tax / calculate_unpaid_leave_deduction /
# convert_shortfall / compute_income_tax, and every expected total in the
# tests is worked out by hand from the spec, never read back off the code.
#
# The order APPENDIX-B fixes and _assemble follows:
#   gross -> statutory heads (priced on GROSS) -> employee-borne reduce net,
#   company-borne do not -> unpaid leave + shortfall -> ad-hoc -> income tax
#   spread over remaining periods -> net pay.
# net_pay's definition is payroll_run_employees.net_pay's own GENERATED column
# (app/models/payroll.py):
#   net = total_earnings - (employee_statutory + income_tax + insurance_employee
#                           + unpaid_leave_deduction + lop_deduction + adhoc_subtractions)


@dataclass(frozen=True)
class _Head:
    """One configured statutory head, per-employee applicability included."""

    label: str
    rate_pct: Decimal
    borne_by: str  # EMPLOYEE | EMPLOYER
    applicable: bool = True


@dataclass(frozen=True)
class _Adhoc:
    label: str
    adjustment_type: str  # ADDITION | SUBTRACTION
    amount: Decimal
    is_recurring: bool


@dataclass(frozen=True)
class _Assembled:
    gross_pay: Decimal
    total_earnings: Decimal
    employee_statutory: Decimal
    employer_statutory: Decimal
    unpaid_leave_deduction: Decimal
    lop_deduction: Decimal
    income_tax: Decimal
    adhoc_addition_total: Decimal
    adhoc_subtraction_total: Decimal
    total_deductions: Decimal
    net_pay: Decimal


def _assemble(
    *,
    monthly_components: dict[str, Decimal],
    total_days: Decimal,
    days_employed: Decimal,
    heads: tuple[_Head, ...] = (),
    unpaid_leave_days: Decimal = Decimal("0"),
    net_short_hours: Decimal = Decimal("0"),
    net_hours_per_day: Decimal = Decimal("8.00"),
    shortfall_rule: str = "IGNORE",
    adhoc: tuple[_Adhoc, ...] = (),
    insurance_employee: Decimal = Decimal("0"),
    income_tax: Decimal = Decimal("0"),
) -> _Assembled:
    structure_gross = sum(monthly_components.values(), Decimal("0"))
    gross_pay = prorate_gross_for_partial_period(structure_gross, total_days, days_employed)

    total_earnings = sum(
        (prorate_gross_for_partial_period(amount, total_days, days_employed) for amount in monthly_components.values()),
        Decimal("0"),
    )

    employee_statutory = Decimal("0")
    employer_statutory = Decimal("0")
    for head in heads:
        if not head.applicable:  # per-employee opt-out skips the head ENTIRELY
            continue
        snapshot = tax_engine.TaxHeadSnapshot(
            tax_name=head.label, tax_type="PERCENTAGE", applies_from=date(2026, 4, 1), rate_pct=head.rate_pct
        )
        amount = tax_engine.calculate_tax(snapshot, gross_pay).computed_amount
        if head.borne_by == "EMPLOYEE":
            employee_statutory += amount
        else:
            employer_statutory += amount

    unpaid_leave_deduction = calculate_unpaid_leave_deduction(gross_pay, total_days, unpaid_leave_days)
    lop_deduction = convert_shortfall(
        net_short_hours=net_short_hours, net_hours_per_day=net_hours_per_day,
        gross_pay=gross_pay, total_days_in_period=total_days, rule=shortfall_rule,
    ).lop_deduction

    adhoc_addition_total = sum((a.amount for a in adhoc if a.adjustment_type == "ADDITION"), Decimal("0"))
    adhoc_subtraction_total = sum((a.amount for a in adhoc if a.adjustment_type == "SUBTRACTION"), Decimal("0"))
    total_earnings += adhoc_addition_total  # folded in ONCE — never again in net_pay

    total_deductions = employee_statutory + income_tax + insurance_employee + unpaid_leave_deduction + lop_deduction + adhoc_subtraction_total
    return _Assembled(
        gross_pay=gross_pay, total_earnings=total_earnings, employee_statutory=employee_statutory,
        employer_statutory=employer_statutory, unpaid_leave_deduction=unpaid_leave_deduction, lop_deduction=lop_deduction,
        income_tax=income_tax, adhoc_addition_total=adhoc_addition_total, adhoc_subtraction_total=adhoc_subtraction_total,
        total_deductions=total_deductions, net_pay=total_earnings - total_deductions,
    )


# A 60000 structure used across the assembly cases, so the arithmetic in each
# comment stays comparable: 30000 basic + 20000 HRA + 10000 special = 60000.
_STRUCTURE = {"BASIC": d("30000"), "HRA": d("20000"), "SPECIAL_ALLOWANCE": d("10000")}


def test_assembly_mid_month_joiner_is_paid_only_for_days_employed():
    # July 2026 on the live cycle: 26-06 .. 25-07 = 30 days
    #   (25-07 minus 26-06 = 29 days apart, +1 inclusive = 30).
    # Joining 11-07-2026 -> employed 11-07 .. 25-07 = 14 apart +1 = 15 days.
    #   gross_pay      = 60000 ÷ 30 × 15 = 30000.00
    #   basic          = 30000 ÷ 30 × 15 = 15000.00
    #   HRA            = 20000 ÷ 30 × 15 = 10000.00
    #   special        = 10000 ÷ 30 × 15 =  5000.00  -> earnings 30000.00
    #   head 12% of gross_pay = 30000 × 0.12 = 3600.00 (employee-borne)
    #   net            = 30000.00 - 3600.00 = 26400.00
    july = resolve_pay_period(7, 2026, **LIVE_CYCLE)
    total_days = Decimal((july.period_end - july.period_start).days + 1)
    assert total_days == d("30")
    days_employed = Decimal((july.period_end - date(2026, 7, 11)).days + 1)
    assert days_employed == d("15")

    r = _assemble(
        monthly_components=_STRUCTURE, total_days=total_days, days_employed=days_employed,
        heads=(_Head("Employee Statutory", d("12"), "EMPLOYEE"),),
    )
    assert r.gross_pay == d("30000.00")
    assert r.total_earnings == d("30000.00")
    assert r.employee_statutory == d("3600.00")
    assert r.net_pay == d("26400.00")
    # Half a period employed must cost exactly half a full period's pay.
    full = _assemble(monthly_components=_STRUCTURE, total_days=total_days, days_employed=total_days,
                     heads=(_Head("Employee Statutory", d("12"), "EMPLOYEE"),))
    assert r.net_pay * 2 == full.net_pay


def test_assembly_mid_month_leaver_is_paid_only_up_to_the_exit_date():
    # Same July window (30 days). Exit 05-07-2026, joined long before:
    #   employed 26-06 .. 05-07 = 9 apart +1 = 10 days
    #   gross_pay = 60000 ÷ 30 × 10 = 20000.00
    #   basic     = 30000 ÷ 30 × 10 = 10000.00
    #   HRA       = 20000 ÷ 30 × 10 =  6666.666... -> 6666.67
    #   special   = 10000 ÷ 30 × 10 =  3333.333... -> 3333.33
    #   earnings  = 10000.00 + 6666.67 + 3333.33   = 20000.00
    #   head 12% of 20000 = 2400.00
    #   net       = 20000.00 - 2400.00 = 17600.00
    july = resolve_pay_period(7, 2026, **LIVE_CYCLE)
    total_days = Decimal((july.period_end - july.period_start).days + 1)
    days_employed = Decimal((date(2026, 7, 5) - july.period_start).days + 1)
    assert days_employed == d("10")

    r = _assemble(
        monthly_components=_STRUCTURE, total_days=total_days, days_employed=days_employed,
        heads=(_Head("Employee Statutory", d("12"), "EMPLOYEE"),),
    )
    assert r.gross_pay == d("20000.00")
    # Component-wise rounding must not leak: the three rounded earning lines
    # add back to exactly the prorated gross, not 19999.99 or 20000.01.
    assert r.total_earnings == d("20000.00") == r.gross_pay
    assert r.net_pay == d("17600.00")


def test_assembly_employee_borne_reduces_net_company_borne_does_not():
    # Full 30-day period, gross 60000, two heads:
    #   employee-borne 12% -> 60000 × 0.12 = 7200.00  (reduces net)
    #   company-borne  13% -> 60000 × 0.13 = 7800.00  (does NOT reduce net)
    #   net = 60000.00 - 7200.00 = 52800.00
    # If the company-borne head were wrongly deducted the net would be
    # 60000 - 7200 - 7800 = 45000.00 — asserted against explicitly.
    r = _assemble(
        monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"),
        heads=(_Head("Employee Statutory", d("12"), "EMPLOYEE"), _Head("Employer Contribution", d("13"), "EMPLOYER")),
    )
    assert r.employee_statutory == d("7200.00")
    assert r.employer_statutory == d("7800.00")
    assert r.total_deductions == d("7200.00")
    assert r.net_pay == d("52800.00")
    assert r.net_pay != d("45000.00"), "a company-borne head must never reduce Net Pay"


def test_assembly_employee_with_every_head_opted_out_takes_home_the_whole_gross():
    # "If set to No, this module skips that head ENTIRELY for that person —
    # deduction AND matching employer contribution."
    #   gross 60000, both heads opted out -> statutory 0.00 both sides
    #   net = 60000.00 - 0.00 = 60000.00 (the full gross)
    r = _assemble(
        monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"),
        heads=(
            _Head("Employee Statutory", d("12"), "EMPLOYEE", applicable=False),
            _Head("Employer Contribution", d("13"), "EMPLOYER", applicable=False),
        ),
    )
    assert r.employee_statutory == d("0")
    assert r.employer_statutory == d("0"), "opting out must drop the matching employer contribution too"
    assert r.total_deductions == d("0")
    assert r.net_pay == d("60000.00")


def test_assembly_unpaid_leave_and_an_hours_shortfall_together():
    # Both hit the same payslip, and both must be priced off the SAME per-day
    # rate (Gross ÷ Total Days) so a LOP day and an unpaid-leave day can never
    # disagree about what one day is worth.
    # Full 30-day period, gross 60000 -> per-day rate 60000 ÷ 30 = 2000.00
    #   unpaid leave 2 days      -> 2000.00 × 2    = 4000.00
    #   shortfall 6.00h at 8.00h/day, PRO_RATA_LOP -> 6 ÷ 8 = 0.75 days
    #                            -> 2000.00 × 0.75 = 1500.00
    #   employee head 12% of 60000                 = 7200.00
    #   deductions = 7200.00 + 4000.00 + 1500.00   = 12700.00
    #   net        = 60000.00 - 12700.00           = 47300.00
    r = _assemble(
        monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"),
        heads=(_Head("Employee Statutory", d("12"), "EMPLOYEE"),),
        unpaid_leave_days=d("2"), net_short_hours=d("6.00"), net_hours_per_day=d("8.00"), shortfall_rule="PRO_RATA_LOP",
    )
    assert r.unpaid_leave_deduction == d("4000.00")
    assert r.lop_deduction == d("1500.00")
    assert r.total_deductions == d("12700.00")
    assert r.net_pay == d("47300.00")
    # One day costs 2000.00 whichever of the two routes priced it.
    assert r.unpaid_leave_deduction / d("2") == r.lop_deduction / d("0.75") == d("2000.00")


def test_assembly_one_time_adhoc_is_spent_but_recurring_persists():
    # APPENDIX-B:237: "a one-time adjustment included in a run is SPENT — it
    # does not carry forward. A Recurring adjustment remains queued for the
    # next run until removed."
    # Month 1 queue: one-time +5000, recurring +2000, recurring -1000
    #   earnings   = 60000 + 5000 + 2000 = 67000.00
    #   deductions = 1000.00
    #   net        = 67000.00 - 1000.00  = 66000.00
    # Month 2 queue (the one-time is CONSUMED, only recurring survives):
    #   earnings   = 60000 + 2000        = 62000.00
    #   deductions = 1000.00
    #   net        = 62000.00 - 1000.00  = 61000.00
    # month1 net - month2 net = 5000.00, exactly the spent one-time bonus.
    bonus = _Adhoc("Diwali Bonus", "ADDITION", d("5000"), is_recurring=False)
    site = _Adhoc("Site Allowance", "ADDITION", d("2000"), is_recurring=True)
    recovery = _Adhoc("Laptop Advance Recovery", "SUBTRACTION", d("1000"), is_recurring=True)

    month1 = _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), adhoc=(bonus, site, recovery))
    # Applying the documented lifecycle: only recurring items stay queued.
    still_queued = tuple(a for a in (bonus, site, recovery) if a.is_recurring)
    month2 = _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), adhoc=still_queued)

    assert month1.total_earnings == d("67000.00")
    assert month1.net_pay == d("66000.00")
    assert month2.total_earnings == d("62000.00")
    assert month2.net_pay == d("61000.00")
    assert month1.net_pay - month2.net_pay == d("5000.00")
    # An ADDITION is counted once, in total_earnings only — folding it into
    # net a second time made a 5000 bonus pay 12800 instead of 7800 once.
    assert month1.net_pay == month1.total_earnings - month1.total_deductions


def test_assembly_reissue_recalculates_without_re_deriving_adhoc_lines():
    # §2.3 Reissue RECALCULATED: "recalculate from updated attendance/leave
    # data" — ad-hoc money must NOT move as a side effect, because by reissue
    # time the one-time item is already CONSUMED and would silently vanish
    # from a naive recompute.
    # Original payslip (30-day period, gross 60000, one-time +5000, recurring -1000):
    #   earnings 60000 + 5000 = 65000.00; deductions 1000.00; net 64000.00
    bonus = _Adhoc("Diwali Bonus", "ADDITION", d("5000"), is_recurring=False)
    recovery = _Adhoc("Laptop Advance Recovery", "SUBTRACTION", d("1000"), is_recurring=True)
    original = _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), adhoc=(bonus, recovery))
    assert original.total_earnings == d("65000.00")
    assert original.net_pay == d("64000.00")

    # The reissue recompute sees NO pending ad-hoc at all (both targets are
    # APPLIED for this period), then payslips.py substitutes the payslip's own
    # already-persisted lines back in:
    #   total_earnings = recomputed_earnings - recomputed_adhoc_addition + persisted_addition
    #                  = 60000.00 - 0.00 + 5000.00 = 65000.00   (unchanged)
    # Corrected attendance adds one unpaid leave day:
    #   unpaid leave 1 day = 60000 ÷ 30 × 1 = 2000.00
    #   deductions = 2000.00 + 1000.00 (persisted subtraction) = 3000.00
    #   net        = 65000.00 - 3000.00 = 62000.00
    recomputed = _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), unpaid_leave_days=d("1"))
    reissued_earnings = recomputed.total_earnings - recomputed.adhoc_addition_total + original.adhoc_addition_total
    reissued_deductions = recomputed.total_deductions + original.adhoc_subtraction_total
    reissued_net = reissued_earnings - reissued_deductions

    assert recomputed.adhoc_addition_total == d("0"), "the recompute cannot see a consumed one-time adjustment"
    assert reissued_earnings == d("65000.00")
    assert reissued_deductions == d("3000.00")
    assert reissued_net == d("62000.00")
    # The whole movement is the one corrected leave day and nothing else:
    #   64000.00 - 62000.00 = 2000.00 = one day at 60000 ÷ 30.
    assert original.net_pay - reissued_net == d("2000.00")


def test_assembly_income_tax_is_spread_over_remaining_periods_and_reduces_net():
    # §2.1 step 6: annualize, apply the head's slabs, divide by the remaining
    # payroll months of the FY, and the monthly figure is employee-borne.
    # Head configured for this test only (the engine names no tax and stores
    # no rate — these bands exist purely as test configuration):
    #   band 1      0 -  300000 @  0%
    #   band 2 300000 -  600000 @  5%
    #   band 3 600000 and above @ 20%
    # Annual gross = 60000 × 12 = 720000, no ad-hoc/variable/reductions:
    #   band 1: 300000 × 0.00  =     0.00
    #   band 2: 300000 × 0.05  = 15000.00
    #   band 3: (720000 - 600000) = 120000 × 0.20 = 24000.00
    #   annual tax = 39000.00 ; ÷ 12 remaining months = 3250.00 per month
    #   net = 60000.00 - 3250.00 = 56750.00
    head = tax_engine.TaxHeadSnapshot(
        tax_name="Income Tax Head", tax_type="SLAB", applies_from=date(2026, 4, 1), slab_application="PROGRESSIVE",
        slab_bands=(
            tax_engine.SlabBand(1, d("0"), d("300000"), d("0")),
            tax_engine.SlabBand(2, d("300000"), d("600000"), d("5")),
            tax_engine.SlabBand(3, d("600000"), None, d("20")),
        ),
    )
    tax = compute_income_tax(
        annual_gross=d("720000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"), annual_declared_reductions=d("0"),
        calculate_tax_fn=tax_engine.calculate_tax, snapshot=head, remaining_payroll_months=12,
    )
    assert tax.annual_tax_computed == d("39000.00")
    assert tax.monthly_amount == d("3250.00")

    r = _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), income_tax=tax.monthly_amount)
    assert r.total_deductions == d("3250.00")
    assert r.net_pay == d("56750.00")

    # Same annual tax with only 6 months of the FY left doubles the monthly
    # withholding: 39000.00 ÷ 6 = 6500.00, net 60000.00 - 6500.00 = 53500.00.
    late = compute_income_tax(
        annual_gross=d("720000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"), annual_declared_reductions=d("0"),
        calculate_tax_fn=tax_engine.calculate_tax, snapshot=head, remaining_payroll_months=6,
    )
    assert late.monthly_amount == d("6500.00")
    assert _assemble(monthly_components=_STRUCTURE, total_days=d("30"), days_employed=d("30"), income_tax=late.monthly_amount).net_pay == d("53500.00")


def test_statutory_head_ordering_fields_are_not_configurable_at_all_a018():
    # APPENDIX-B:226 states an exact order — "Minimum Base, then Maximum
    # Base/Ceiling, then Cut-Off Base, then per-period cap, then rounding
    # rule, IN THAT ORDER" — and the order is not cosmetic. Worked example,
    # base 20000, Minimum Base 25000, Ceiling 15000, rate 12%:
    #   spec order   : 20000 -> min 25000 -> ceiling 15000 -> × 0.12 = 1800.00
    #   reversed     : 20000 -> ceiling 15000 -> min 25000 -> × 0.12 = 3000.00
    #   a 1200.00 difference on one head, every month.
    #
    # That order CANNOT be tested against this system, because APPENDIX-A's
    # A018 removed every one of those fields from the Tax Head on explicit
    # instruction ("ACCEPT THE STATED COST: a tax needing a wage ceiling,
    # cut-off threshold... CANNOT be configured until fields are re-added").
    # APPENDIX-B:226 and A018 are in direct conflict; A018 is the later,
    # explicitly-approved decision, so the absence is correct-by-decision and
    # this test pins it: the day anyone re-adds one of these fields, this goes
    # red and forces the documented order to be implemented with it, rather
    # than a field quietly landing with no ordering behind it.
    field_names = {f.name for f in dataclasses.fields(tax_engine.TaxHeadSnapshot)}
    for excluded in (
        "minimum_base", "maximum_base", "ceiling", "cut_off_base", "cutoff_base",
        "per_period_cap", "maximum_amount_per_period", "period_basis", "rounding", "rounding_rule",
    ):
        assert excluded not in field_names, (
            f"TaxHeadSnapshot gained '{excluded}' — APPENDIX-B:226's application order "
            "(Minimum Base -> Ceiling -> Cut-Off -> per-period cap -> rounding) must now be implemented and tested"
        )
    # And the engine takes a bare base amount, with no per-head base window.
    assert tax_engine.calculate_tax.__code__.co_varnames[:2] == ("snapshot", "base_amount")


# ############################################################################
# ###########  DIVISION GUARDS & ROUNDING BOUNDARIES (engine-wide)  ##########
# ############################################################################


def test_shortfall_zero_net_hours_per_day_does_not_divide():
    # Divide-by-zero guard: shortfall hours ÷ net hours per day. A policy with
    # 0.00 net hours a day (or no policy resolved at all) has no way to say
    # what a day is worth, so nothing converts — never a crash, never an
    # infinite LOP.
    r = convert_shortfall(net_short_hours=d("6"), net_hours_per_day=d("0"), gross_pay=d("60000"), total_days_in_period=d("30"), rule="PRO_RATA_LOP")
    assert r.lop_days == d("0") and r.lop_deduction == d("0")


def test_shortfall_zero_total_days_prices_the_day_at_zero_without_dividing():
    # Second division in the same function: gross ÷ total days in period.
    # 6 ÷ 8 still yields 0.75 LOP days (the hours arithmetic is intact), but
    # with no period length there is no per-day rate, so it prices at 0.00
    # rather than dividing by zero.
    r = convert_shortfall(net_short_hours=d("6"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("0"), rule="PRO_RATA_LOP")
    assert r.lop_days == d("0.75")
    assert r.lop_deduction == d("0")


def test_prorate_zero_total_days_does_not_divide():
    # gross ÷ total days in period, with days_employed still positive.
    assert prorate_gross_for_partial_period(d("60000"), d("0"), d("10")) == d("0")


def test_shortfall_round_half_day_exactly_on_the_boundary_does_not_round_up():
    # 4.00h short of an 8.00h day = exactly 0.5 days. "Rounds up to the next
    # half day" must leave an exact half alone, not push it to a full day.
    #   per-day rate 60000 ÷ 30 = 2000.00; 0.5 × 2000.00 = 1000.00
    r = convert_shortfall(net_short_hours=d("4"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("30"), rule="ROUND_HALF_DAY")
    assert r.lop_days == d("0.5")
    assert r.lop_deduction == d("1000.00")


def test_shortfall_round_full_day_on_an_exact_day_does_not_round_up():
    # 8.00h short of an 8.00h day = exactly 1 day, not 2.
    #   per-day rate 2000.00; 1 × 2000.00 = 2000.00
    r = convert_shortfall(net_short_hours=d("8"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("30"), rule="ROUND_FULL_DAY")
    assert r.lop_days == d("1")
    assert r.lop_deduction == d("2000.00")


def test_shortfall_leave_covering_the_whole_shortfall_leaves_no_lop():
    # LEAVE_THEN_LOP with more leave available than the shortfall needs:
    # 8h ÷ 8h/day = 1 day, 5 days available -> 1 day consumed, 0 LOP, 0.00
    # deducted. Leave used must clamp to the shortfall, never to the balance.
    r = convert_shortfall(
        net_short_hours=d("8"), net_hours_per_day=d("8"), gross_pay=d("60000"), total_days_in_period=d("30"),
        rule="LEAVE_THEN_LOP", available_leave_days=d("5"),
    )
    assert r.leave_days_used == d("1")
    assert r.lop_days == d("0")
    assert r.lop_deduction == d("0")


def test_income_tax_monthly_spread_rounds_half_up_at_two_decimals():
    # annual tax ÷ remaining payroll months, pinned on an exact .005 tie:
    #   60000.03 ÷ 6 = 10000.005 -> HALF_UP at 2dp = 10000.01
    #   (HALF_EVEN would give 10000.00, truncation 10000.00)
    result = compute_income_tax(
        annual_gross=d("600000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"), annual_declared_reductions=d("0"),
        calculate_tax_fn=lambda snapshot, base: _FakeResult(d("60000.03"), d("60000.03")), snapshot=None, remaining_payroll_months=6,
    )
    assert result.monthly_amount == d("10000.01")


def test_income_tax_negative_remaining_months_produces_nothing():
    # The same divide-by-zero guard's other side: a period resolved outside
    # the financial year must produce no withholding rather than a negative
    # one (which would silently pay tax back to the employee).
    result = compute_income_tax(
        annual_gross=d("600000"), annual_taxable_adhoc=d("0"), annual_variable_pay=d("0"), annual_declared_reductions=d("0"),
        calculate_tax_fn=lambda *a: (_ for _ in ()).throw(AssertionError("should not be called")),
        snapshot=None, remaining_payroll_months=-1,
    )
    assert result.monthly_amount == d("0")
