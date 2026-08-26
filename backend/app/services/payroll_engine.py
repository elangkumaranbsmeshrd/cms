"""Hour-basis payroll calculation (06-payroll-module.md) — isolated and
unit-tested, same discipline as attendance_engine.py / leave_engine.py /
tax_engine.py / salary_engine.py. This is THE Phase 3 acceptance-gate
deliverable (BUILD-PROMPT §13): resolve_pay_period is what makes the
27-07-2026 pay-cycle carryover case (§3.1b) work at all, calculate_
unpaid_leave_deduction is A115 — "this formula is approved and must be the
single formula used wherever unpaid leave reduces pay" — and nothing here
names a tax; every statutory figure still comes from tax_engine.calculate_tax
against a Masters-configured head.

Required Hours / working-day counting deliberately is NOT reimplemented here
— it's leave_engine.calculate_working_days, called directly by the router,
since "how many working days between two dates, given a policy, Saturday
rule and Mandatory holidays" is exactly what that function already is.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
import calendar

MONEY_PLACES = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_PLACES, rounding=ROUND_HALF_UP)


def _clamp_day(year: int, month: int, day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


@dataclass(frozen=True)
class PayPeriodResolution:
    period_start: date
    period_end: date
    salary_credit_date: date


def resolve_pay_period(
    period_month: int,
    period_year: int,
    cycle_type: str,  # 'FIXED_CYCLE' | 'CALENDAR_MONTH'
    start_day: int | None,
    end_day: int | None,
    salary_credit_day: int,
) -> PayPeriodResolution:
    """Masters §3.20c / Payroll §3.1b: resolves a Month/Year selection into
    the actual date range a run covers and when it credits — the Pay
    Cycle's configuration decides, never the calendar month directly.

    Worked example this must reproduce exactly (§3.1b, Start Day 26 / End
    Day 25 / Credit Day 30): "July 2026" -> period_start 2026-06-26,
    period_end 2026-07-25, salary_credit_date 2026-07-30. An employee's
    Approved leave dated 2026-07-27 therefore falls OUTSIDE July's window
    (past the 25th cutoff) and INSIDE August's (26-07 to 25-08) — that
    carryover is a plain consequence of this function resolving both
    months' windows correctly, not special-cased anywhere.

    Both the cutoff day and the credit day clamp to the real last day of a
    short month (e.g. End Day 31 in February lands on the 28th/29th).
    """
    if cycle_type == "CALENDAR_MONTH":
        period_start = date(period_year, period_month, 1)
        period_end = _clamp_day(period_year, period_month, 31)
        credit_month, credit_year = period_month, period_year
    else:
        assert start_day is not None and end_day is not None, "FIXED_CYCLE requires both Start Day and End Day"
        end_month, end_year = period_month, period_year
        period_end = _clamp_day(end_year, end_month, end_day)
        start_month = end_month - 1 if end_month > 1 else 12
        start_year = end_year if end_month > 1 else end_year - 1
        period_start = _clamp_day(start_year, start_month, start_day)
        credit_month, credit_year = end_month, end_year

    salary_credit_date = _clamp_day(credit_year, credit_month, salary_credit_day)
    if salary_credit_date <= period_end:
        # Configured credit day falls on or before the cutoff within the
        # same month — push to next month so credit always follows cutoff
        # (ck_pay_periods_credit's own invariant: salary_credit_date > period_end).
        next_month = credit_month + 1 if credit_month < 12 else 1
        next_year = credit_year if credit_month < 12 else credit_year + 1
        salary_credit_date = _clamp_day(next_year, next_month, salary_credit_day)

    return PayPeriodResolution(period_start=period_start, period_end=period_end, salary_credit_date=salary_credit_date)


def calculate_unpaid_leave_deduction(gross_pay: Decimal, total_days_in_period: Decimal, unpaid_leave_days: Decimal) -> Decimal:
    """A115 — approved as the single unpaid-leave formula in this codebase:
    Deduction = (Gross Pay / Total Days in Period) x Unpaid Leave Days.
    """
    if total_days_in_period <= 0 or unpaid_leave_days <= 0:
        return Decimal("0")
    return _money(gross_pay / total_days_in_period * unpaid_leave_days)


@dataclass(frozen=True)
class ShortfallConversion:
    leave_days_used: Decimal
    lop_days: Decimal
    lop_deduction: Decimal


def convert_shortfall(
    *,
    net_short_hours: Decimal,
    net_hours_per_day: Decimal,
    gross_pay: Decimal,
    total_days_in_period: Decimal,
    rule: str,  # PRO_RATA_LOP | ROUND_HALF_DAY | ROUND_FULL_DAY | LEAVE_THEN_LOP | IGNORE
    available_leave_days: Decimal = Decimal("0"),
) -> ShortfallConversion:
    """Payroll §2.4 "What a shortfall does": whatever survives being offset
    by approved/pending compensation converts per the policy's
    Uncompensated Shortfall Becomes setting. Priced with the SAME per-day
    rate A115 uses (Gross Pay / Total Days in Period), so a day priced as
    LOP here and a day priced as unpaid leave above can never disagree.
    """
    if net_short_hours <= 0 or net_hours_per_day <= 0 or rule == "IGNORE":
        return ShortfallConversion(Decimal("0"), Decimal("0"), Decimal("0"))

    per_day_rate = (gross_pay / total_days_in_period) if total_days_in_period > 0 else Decimal("0")
    exact_days = net_short_hours / net_hours_per_day

    if rule == "ROUND_HALF_DAY":
        lop_days = (exact_days * 2).to_integral_value(rounding=ROUND_CEILING) / 2
    elif rule == "ROUND_FULL_DAY":
        lop_days = exact_days.to_integral_value(rounding=ROUND_CEILING)
    else:  # PRO_RATA_LOP, LEAVE_THEN_LOP — priced on the exact fractional hours
        lop_days = exact_days

    leave_days_used = Decimal("0")
    if rule == "LEAVE_THEN_LOP" and available_leave_days > 0:
        leave_days_used = min(available_leave_days, lop_days)
        lop_days -= leave_days_used

    return ShortfallConversion(leave_days_used=leave_days_used, lop_days=lop_days, lop_deduction=_money(lop_days * per_day_rate))


def prorate_gross_for_partial_period(gross_monthly: Decimal, total_days_in_period: Decimal, days_employed_in_period: Decimal) -> Decimal:
    """Not explicitly specified — a necessary, minimal extension for a
    joiner/leaver mid-period, using the SAME day-based pro-rata shape as
    A115 rather than inventing separate math. A full period (the normal
    case) returns gross_monthly unchanged.
    """
    if total_days_in_period <= 0:
        return Decimal("0")
    if days_employed_in_period >= total_days_in_period:
        return _money(gross_monthly)
    return _money(gross_monthly / total_days_in_period * max(Decimal("0"), days_employed_in_period))


@dataclass(frozen=True)
class IncomeTaxResult:
    annualized_taxable_income: Decimal
    annual_tax_before_relief: Decimal
    annual_tax_computed: Decimal
    monthly_amount: Decimal


def compute_income_tax(
    *,
    annual_gross: Decimal,
    annual_taxable_adhoc: Decimal,
    annual_variable_pay: Decimal,
    annual_declared_reductions: Decimal,
    calculate_tax_fn,  # tax_engine.calculate_tax, injected to avoid a hard import cycle in tests
    snapshot,  # tax_engine.TaxHeadSnapshot
    remaining_payroll_months: int,
) -> IncomeTaxResult:
    """Payroll §2.1 step 6, A126: annualize Gross Monthly x 12 plus taxable
    ad-hoc additions and annualized variable pay (6a), subtract whatever the
    configuration says is deductible (6b), apply the head's slabs/rate and
    Relief Rules (6c/6d — both already inside tax_engine.calculate_tax, not
    reimplemented here), divide by the remaining payroll months (6e).
    """
    if remaining_payroll_months <= 0:
        return IncomeTaxResult(Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"))
    annualized_income = annual_gross + annual_taxable_adhoc + annual_variable_pay
    taxable_base = max(Decimal("0"), annualized_income - annual_declared_reductions)
    result = calculate_tax_fn(snapshot, taxable_base)
    monthly_amount = _money(result.computed_amount / remaining_payroll_months)
    return IncomeTaxResult(
        annualized_taxable_income=taxable_base,
        annual_tax_before_relief=result.gross_amount,
        annual_tax_computed=result.computed_amount,
        monthly_amount=monthly_amount,
    )
