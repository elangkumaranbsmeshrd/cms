"""Pay-period resolution, A115's unpaid-leave formula, shortfall conversion,
partial-period proration, and income-tax annualization — boundary values,
not just the happy path (BUILD-PROMPT §14 Definition of Done #7).
"""

from datetime import date
from decimal import Decimal

from app.services.payroll_engine import (
    calculate_unpaid_leave_deduction,
    compute_income_tax,
    convert_shortfall,
    prorate_gross_for_partial_period,
    resolve_pay_period,
)


def d(x: str) -> Decimal:
    return Decimal(x)


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
