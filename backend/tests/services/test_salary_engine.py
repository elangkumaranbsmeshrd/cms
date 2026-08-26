"""Salary Structure derived totals — Gross/Net/Annual CTC arithmetic and the
Code on Wages Basic+DA ≥ 50% boundary.
"""

from decimal import Decimal

from app.services.salary_engine import StatutoryLineAmount, compute_gross_monthly, compute_totals


def d(x: str) -> Decimal:
    return Decimal(x)


def test_gross_monthly_excludes_variable_pay_and_annual_lta():
    gross = compute_gross_monthly(
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"), hra_monthly=d("12000"),
        lta_amount=d("5000"), lta_payout_basis="ANNUAL", special_allowance_monthly=d("3000"), other_earnings_monthly=d("0"),
    )
    assert gross == d("45000.00")  # LTA excluded since it's annual, not monthly


def test_gross_monthly_includes_lta_when_paid_monthly():
    gross = compute_gross_monthly(
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"), hra_monthly=d("12000"),
        lta_amount=d("5000"), lta_payout_basis="MONTHLY", special_allowance_monthly=d("3000"), other_earnings_monthly=d("0"),
    )
    assert gross == d("50000.00")


def test_totals_no_statutory_lines_net_equals_gross():
    # "On a fresh installation with no tax heads configured ... Net Monthly
    # equals Gross Monthly. That is correct behaviour" — Masters §3.2a.
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.net_monthly == totals.gross_monthly == d("50000.00")
    assert totals.annual_ctc == d("600000.00")


def test_totals_with_employee_and_employer_statutory_lines():
    lines = [
        StatutoryLineAmount("pf-employee", "EMPLOYEE", include_in_ctc=False, is_applicable=True, computed_amount_monthly=d("1800")),
        StatutoryLineAmount("pf-employer", "EMPLOYER", include_in_ctc=True, is_applicable=True, computed_amount_monthly=d("1800")),
    ]
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=lines, insurance_employee_contribution_monthly=d("500"), insurance_employer_contribution_monthly=d("500"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.total_employee_statutory_monthly == d("1800.00")
    assert totals.total_employer_statutory_ctc_monthly == d("1800.00")
    assert totals.net_monthly == d("47700.00")  # 50000 - 1800 - 500
    assert totals.annual_ctc == d("627600.00")  # 50000*12 + 1800*12 + 500*12


def test_non_applicable_statutory_line_is_excluded_from_totals():
    lines = [StatutoryLineAmount("pf-employee", "EMPLOYEE", include_in_ctc=False, is_applicable=False, computed_amount_monthly=d("1800"))]
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=lines, insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.total_employee_statutory_monthly == d("0.00")
    assert totals.net_monthly == totals.gross_monthly


def test_employer_line_not_included_in_ctc_is_excluded_from_annual_ctc():
    lines = [StatutoryLineAmount("gratuity", "EMPLOYER", include_in_ctc=False, is_applicable=True, computed_amount_monthly=d("1000"))]
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=lines, insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.total_employer_statutory_ctc_monthly == d("0.00")
    assert totals.annual_ctc == d("600000.00")  # the 1000/month gratuity line never joins CTC


def test_variable_pay_quarterly_annualised_times_four():
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("10000"), variable_pay_frequency="QUARTERLY",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.variable_pay_annualised == d("40000.00")
    assert totals.annual_ctc == d("640000.00")  # 600000 + 40000


def test_variable_pay_annual_not_multiplied():
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("40000"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    assert totals.variable_pay_annualised == d("40000.00")


# ------------------------------------------------------------------- LTA in CTC
# Employee §2.2 counts LTA in Gross Monthly only "if paid monthly", so an ANNUAL
# LTA is correctly absent from gross_monthly. It is still real money the company
# pays, so it has to reach annual_ctc some other way — annualising gross alone
# used to drop it entirely and understate every affected employee's CTC.
def test_annual_lta_is_added_to_annual_ctc():
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
        lta_amount=d("12000"), lta_payout_basis="ANNUAL",
    )
    assert totals.annual_ctc == d("612000.00")  # 50000*12 + 12000


def test_monthly_lta_is_not_double_counted_in_annual_ctc():
    # Under the MONTHLY basis the amount already sits inside gross_monthly, so
    # adding it again at the annual level would pay it twice on paper.
    totals = compute_totals(
        gross_monthly=d("50000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
        lta_amount=d("1000"), lta_payout_basis="MONTHLY",
    )
    assert totals.annual_ctc == d("600000.00")  # 50000*12 exactly, no LTA re-add


# ----------------------------------------------------- Code on Wages boundary
def test_wage_code_compliant_exactly_at_50_percent():
    # basic+DA annual = 30000*12 = 360000; CTC = 50000*12 = 600000 -> exactly 60%... use numbers that land on 50 exactly.
    totals = compute_totals(
        gross_monthly=d("60000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("30000"), dearness_allowance_monthly=d("0"),
    )
    # basic+DA annual = 360000; CTC annual = 720000 -> exactly 50%
    assert totals.basic_plus_da_share_pct == d("50.000")
    assert totals.is_wage_code_compliant is True


def test_wage_code_noncompliant_just_below_50_percent():
    totals = compute_totals(
        gross_monthly=d("60000"), variable_pay_amount=d("0"), variable_pay_frequency="ANNUAL",
        statutory_lines=[], insurance_employee_contribution_monthly=d("0"), insurance_employer_contribution_monthly=d("0"),
        basic_salary_monthly=d("29999"), dearness_allowance_monthly=d("0"),
    )
    assert totals.is_wage_code_compliant is False
