"""Salary Structure derived totals (Employee §2.2) — isolated and unit-
tested. Each statutory line's own amount comes from tax_engine.calculate_tax
(the same engine every other tax-bearing document in this CMS uses); this
module only does the roll-up arithmetic the Salary Structure tab itself
describes: Gross Monthly, Net Monthly, Annual CTC, and the Code on Wages
Basic+DA ≥ 50% compliance check.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

MONEY_PLACES = Decimal("0.01")

# QUEUED / NOT CONFIGURABLE — this is a statutory rate (India's Code on
# Wages: Basic+DA must be >= 50% of CTC) baked in as a module constant
# instead of read from a Masters-owned config row. §6 treats this class of
# number (a rate tied to a named statutory scheme) as forbidden in code, but
# there is currently nowhere in Masters for a Super Admin to set it:
#   - No table holds it. Compare TaxHead/TaxScheme (backend/app/models/
#     masters.py:21,31), which hold rates *for a named tax* — this threshold
#     isn't a tax head, it's a compliance ceiling on the payroll structure
#     itself, and no "compliance rules" table (or equivalent field) exists
#     anywhere in backend/app/models/masters.py to hold it.
#   - No API route exists to read or write it, so a hardcoded constant is
#     currently the only thing possible here.
#   - The same "50%" is duplicated as a literal in the error message at
#     backend/app/api/v1/employee_compensation.py:247 — the two will drift
#     apart if only one is ever edited.
# Fixing this for real means: add a Masters-owned compliance-rule config
# (new table, e.g. `compliance_rules`, or a dedicated field alongside the
# existing TaxHead config) with a GET/PUT route a Super Admin can use, have
# this module read it at calculation time instead of a constant, and have
# employee_compensation.py's f-string interpolate that same value. None of
# that exists yet, so this stays a documented gap rather than a fix.
WAGE_CODE_MIN_BASIC_DA_SHARE_PCT = Decimal("50")


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class StatutoryLineAmount:
    tax_head_id: str
    borne_by: str  # EMPLOYEE | EMPLOYER
    include_in_ctc: bool
    is_applicable: bool
    computed_amount_monthly: Decimal


@dataclass(frozen=True)
class SalaryTotals:
    gross_monthly: Decimal
    variable_pay_annualised: Decimal
    total_employee_statutory_monthly: Decimal
    total_employer_statutory_ctc_monthly: Decimal
    net_monthly: Decimal
    annual_ctc: Decimal
    basic_plus_da_share_pct: Decimal
    is_wage_code_compliant: bool


def compute_gross_monthly(
    basic_salary_monthly: Decimal,
    dearness_allowance_monthly: Decimal,
    hra_monthly: Decimal,
    lta_amount: Decimal,
    lta_payout_basis: str,
    special_allowance_monthly: Decimal,
    other_earnings_monthly: Decimal,
) -> Decimal:
    """Employee §2.2: "Basic + DA + HRA + LTA (if paid monthly) + Special
    Allowance + Other Earnings. Variable Pay is deliberately excluded."
    """
    lta_component = lta_amount if lta_payout_basis == "MONTHLY" else Decimal("0")
    return _money(
        basic_salary_monthly + dearness_allowance_monthly + hra_monthly
        + lta_component + special_allowance_monthly + other_earnings_monthly
    )


def compute_totals(
    *,
    gross_monthly: Decimal,
    variable_pay_amount: Decimal,
    variable_pay_frequency: str,
    statutory_lines: list[StatutoryLineAmount],
    insurance_employee_contribution_monthly: Decimal,
    insurance_employer_contribution_monthly: Decimal,
    basic_salary_monthly: Decimal,
    dearness_allowance_monthly: Decimal,
) -> SalaryTotals:
    variable_pay_annualised = variable_pay_amount * (4 if variable_pay_frequency == "QUARTERLY" else 1)

    applicable = [line for line in statutory_lines if line.is_applicable]
    total_employee_statutory = sum((line.computed_amount_monthly for line in applicable if line.borne_by == "EMPLOYEE"), Decimal("0"))
    total_employer_statutory_ctc = sum(
        (line.computed_amount_monthly for line in applicable if line.borne_by == "EMPLOYER" and line.include_in_ctc), Decimal("0")
    )

    net_monthly = gross_monthly - total_employee_statutory - insurance_employee_contribution_monthly
    annual_ctc = (
        gross_monthly * 12
        + variable_pay_annualised
        + total_employer_statutory_ctc * 12
        + insurance_employer_contribution_monthly * 12
    )

    basic_plus_da_annual = (basic_salary_monthly + dearness_allowance_monthly) * 12
    basic_plus_da_share_pct = (basic_plus_da_annual / annual_ctc * 100) if annual_ctc > 0 else Decimal("100")

    return SalaryTotals(
        gross_monthly=_money(gross_monthly),
        variable_pay_annualised=_money(variable_pay_annualised),
        total_employee_statutory_monthly=_money(total_employee_statutory),
        total_employer_statutory_ctc_monthly=_money(total_employer_statutory_ctc),
        net_monthly=_money(net_monthly),
        annual_ctc=_money(annual_ctc),
        basic_plus_da_share_pct=basic_plus_da_share_pct.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP),
        is_wage_code_compliant=basic_plus_da_share_pct >= WAGE_CODE_MIN_BASIC_DA_SHARE_PCT,
    )
