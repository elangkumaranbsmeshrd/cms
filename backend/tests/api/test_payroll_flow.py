"""Layer 2 functional flow — PAYROLL (COMPLETE-TEST-PROMPT.md, "Per-module
functional flows"), verbatim:

    "Payroll — attendance -> reconciliation -> run -> preview -> confirm ->
    payslip -> **processed period reads back LOCKED figures** (edit the policy
    afterward; assert the payslip does not change) -> reissue"

The bolded step is what this file exists for. A payslip must be reproducible
from the configuration that produced it: once a run is confirmed, editing the
Work Week Policy, the Salary Structure and a Tax Head must not move a single
figure on an issued payslip, nor on the Attendance & Time Basis screens that
explain it. If those figures moved, the company could not defend a number it
had already paid someone.

WHAT IS AND ISN'T TESTED HERE. tests/services/test_payroll_engine.py already
owns the arithmetic (56 unit tests over resolve_pay_period /
calculate_unpaid_leave_deduction / convert_shortfall /
prorate_gross_for_partial_period / compute_income_tax). This file is about the
ENDPOINTS wiring that arithmetic together: it drives the real app over httpx
ASGITransport, records real attendance, reads the real reconciliation, creates
a real run, previews it, confirms it, reads the real payslip, and reissues it.
Nothing is stubbed except what has no bearing on money (there are no
EmailTemplate rows, so email_transport.send_templated_email is a documented
no-op returning None).

Every expected figure below is hand-derived from the seeded inputs, in the
comment block above each assertion — a flow test that only checked 2xx would
pass on a payroll run that paid everyone zero.

Pattern: tests/security/test_write_escalation.py and
tests/test_file_download_authz.py — the real app.main app, get_db pinned to
conftest's db_session, get_current_user overridden per actor, seed_canonical()
for the real RBAC policy. Driven as SUPER_ADMIN throughout: the roles' own
payroll permissions are Layer 3's subject, not this file's.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.employee import Employee, SalaryStructure
from app.models.masters import Department, Designation, EmploymentType, PayCycle, TaxHead, WorkWeekPolicy
from app.models.numbering import FinancialYear
from app.models.payroll import MonthlyHourReconciliation, PayrollRunEmployee, PayslipStatutoryLine
from app.models.platform import User
from tests.conftest import seed_canonical

# ============================================================ the seeded world
#
# The dev Pay Cycle, verbatim: FIXED_CYCLE, Start Day 26, End Day 25, Salary
# Credit Day 30. payroll_engine.resolve_pay_period therefore turns the
# selection "July 2026" into:
#     period_start  2026-06-26   (clamp(June, 26))
#     period_end    2026-07-25   (clamp(July, 25))
#     credit date   2026-07-30   (clamp(July, 30); after the cutoff, so no
#                                 push into August)
# That is §3.1b's own worked example, reproduced here through the API rather
# than asserted against the engine a second time.
PERIOD_MONTH, PERIOD_YEAR = 7, 2026
PERIOD_START, PERIOD_END = date(2026, 6, 26), date(2026, 7, 25)
CREDIT_DATE = date(2026, 7, 30)

# (2026-07-25 - 2026-06-26).days + 1 = 30 — five days of June plus 25 of July.
TOTAL_DAYS = Decimal("30.00")

FY_START, FY_END = date(2026, 4, 1), date(2027, 3, 31)

# Work Week Policy: Gross 9h/day - 1h unpaid break = 8h NET (a real generated
# column, never typed), Sat+Sun off, no working Saturdays, no holidays seeded.
NET_HOURS_PER_DAY = Decimal("8.00")


def _weekdays_in_period() -> list[date]:
    """Mon-Fri between period_start and period_end inclusive. With
    weekly_off_days=SAT_SUN and saturday_rule=ALL_OFF and zero Mandatory
    holidays, this is exactly what leave_engine.calculate_working_days counts,
    which is what both Run Payroll and the reconciliation use."""
    out: list[date] = []
    current = PERIOD_START
    while current <= PERIOD_END:
        if current.isoweekday() <= 5:
            out.append(current)
        current += timedelta(days=1)
    return out


WORKING_DATES = _weekdays_in_period()
WORKING_DAYS = Decimal(len(WORKING_DATES))          # 21
REQUIRED_HOURS = WORKING_DAYS * NET_HOURS_PER_DAY   # 21 x 8 = 168

# The one short day: 09:00-14:00 with a 1h break = 4.00 net worked hours
# against a required 8.00, i.e. exactly half a day's shortfall.
SHORT_DAY = WORKING_DATES[5]
WORKED_HOURS_ATTENDED = (WORKING_DAYS - 1) * NET_HOURS_PER_DAY + Decimal("4.00")  # 20x8 + 4 = 164

# ------------------------------------------------------------------ employee 1
# Salary Structure: Basic 30,000 + HRA 12,000 + Special Allowance 8,000.
# gross_monthly is a generated column: 30000 + 0 + 12000 + 0 + 8000 + 0 = 50000.
E1_BASIC = Decimal("30000.00")
E1_HRA = Decimal("12000.00")
E1_SPECIAL = Decimal("8000.00")
E1_GROSS = Decimal("50000.00")

# ------------------------------------------------------------------ employee 2
# Basic 30,000 only -> gross_monthly 30,000. Deliberately given NO attendance
# at all, so one run carries both a mostly-present employee and a wholly-absent
# one and the two cannot be confused for each other.
E2_BASIC = Decimal("30000.00")
E2_GROSS = Decimal("30000.00")

# ------------------------------------------------------------------- tax heads
# One employee-borne statutory head at a flat 12% of Gross Pay, and one income
# tax head at a flat 10% of annualised taxable income. Neither reduces taxable
# income, so the income tax base is simply gross_monthly x 12.
PF_RATE = Decimal("12")
IT_RATE = Decimal("10")

# compute_income_tax's remaining_payroll_months, from payroll_runs.py:
#   (fy.end_date.year - period_year) * 12 + (fy.end_date.month - period_month) + 1
#   = (2027-2026)*12 + (3-7) + 1 = 12 - 4 + 1 = 9
REMAINING_MONTHS = 9


def _d(value) -> Decimal:
    """Money/hours off the wire. Endpoints with a Pydantic response_model
    serialize Decimal as a STRING ("833.33"); the reconciliation endpoints
    return plain dicts through jsonable_encoder, which yields a FLOAT (833.33).
    Decimal(str(...)) reads both, and Decimal("168.0") == Decimal("168.00")."""
    return Decimal(str(value))


# ================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session):
    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


@pytest_asyncio.fixture
async def world(db_session):
    """The canonical RBAC policy plus the minimum real Masters/Employee data a
    payroll run reads: a Financial Year, the dev Pay Cycle, a company-wide Work
    Week Policy, two statutory heads, three employees (two payable, one with no
    Salary Structure at all so the EXCLUDED_* branch is exercised for real)."""
    ids = await seed_canonical(db_session)
    admin = await db_session.get(User, ids["user:SUPER_ADMIN"])

    fy = FinancialYear(
        id=str(uuid.uuid4()), label="2026-27", start_date=FY_START, end_date=FY_END,
        status="open", is_current=True, created_by=admin.id, updated_by=admin.id,
    )
    department = Department(id=str(uuid.uuid4()), name="Engineering", is_active=True, created_by=admin.id, updated_by=admin.id)
    designation = Designation(id=str(uuid.uuid4()), name="Software Engineer", is_active=True, created_by=admin.id, updated_by=admin.id)
    employment_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time", is_active=True, created_by=admin.id, updated_by=admin.id)
    cycle = PayCycle(
        id=str(uuid.uuid4()), cycle_type="FIXED_CYCLE", start_day=26, end_day=25, salary_credit_day=30,
        effective_from=date(2020, 1, 1), is_active=True, created_by=admin.id, updated_by=admin.id,
    )
    # net_working_hours_per_day is a generated column (gross - unpaid break) —
    # deliberately not passed, exactly as masters_work_week.create_policy does.
    policy = WorkWeekPolicy(
        id=str(uuid.uuid4()), policy_name="Company Standard", applies_to="COMPANY_WIDE",
        effective_from=date(2020, 1, 1), gross_hours_per_day=Decimal("9"), unpaid_break_hours=Decimal("1"),
        grace_window_minutes=0, half_day_threshold_hours=Decimal("4"), count_overtime_beyond_net=False,
        weekly_hour_target=Decimal("40"), weekly_off_days="SAT_SUN", saturday_rule="ALL_OFF",
        working_saturday_hours_mode=None, custom_saturday_hours=None, mandatory_holiday_overrides_saturday=True,
        allow_compensatory_hours=True, compensation_window_days=30, make_up_day_chosen_by=None,
        allow_makeup_on_week_off=False, allow_makeup_on_mandatory_holiday=False, max_comp_hours_per_month=Decimal("0"),
        uncompensated_shortfall_becomes="PRO_RATA_LOP", excess_hours_become=None, is_active=True,
        created_by=admin.id, updated_by=admin.id,
    )
    pf_head = TaxHead(
        id=str(uuid.uuid4()), tax_name="Retirement Fund", short_code="RF", scope="PAYROLL_EMPLOYEE_DEDUCTION",
        tax_type="PERCENTAGE", applies_from=date(2020, 1, 1), rate_pct=PF_RATE, print_label="Retirement Fund",
        behaviour={"borne_by": "EMPLOYEE", "show_on_payslip": True, "reduces_taxable_income": False, "include_in_ctc": False},
        is_active=True, created_by=admin.id, updated_by=admin.id,
    )
    income_tax_head = TaxHead(
        id=str(uuid.uuid4()), tax_name="Income Tax", short_code="IT", scope="PAYROLL_INCOME_TAX",
        tax_type="PERCENTAGE", applies_from=date(2020, 1, 1), rate_pct=IT_RATE, print_label="Income Tax",
        behaviour={"borne_by": "EMPLOYEE", "show_on_payslip": True}, is_active=True,
        created_by=admin.id, updated_by=admin.id,
    )
    db_session.add_all([fy, department, designation, employment_type, cycle, policy, pf_head, income_tax_head])
    await db_session.flush()

    def _employee(code: str, first_name: str) -> Employee:
        return Employee(
            id=str(uuid.uuid4()), employee_code=code, code_financial_year_id=fy.id, first_name=first_name,
            last_name="Flow", email=f"{code.lower()}@flow.test", department_id=department.id,
            designation_id=designation.id, employment_type_id=employment_type.id,
            joining_date=date(2020, 1, 1), employment_status="ACTIVE", bank_name="Test Bank",
            bank_account_number="123456789012", created_by=admin.id, updated_by=admin.id,
        )

    employee1 = _employee("FLOW-1", "Asha")
    employee2 = _employee("FLOW-2", "Bharath")
    employee3 = _employee("FLOW-3", "Chandra")  # no Salary Structure, on purpose
    db_session.add_all([employee1, employee2, employee3])
    await db_session.flush()

    # gross_monthly / variable_pay_annualised are generated columns — never set.
    structure1 = SalaryStructure(
        id=str(uuid.uuid4()), employee_id=employee1.id, financial_year_id=fy.id, effective_from=date(2020, 1, 1),
        changed_by=admin.id, basic_salary_monthly=E1_BASIC, hra_monthly=E1_HRA, special_allowance_monthly=E1_SPECIAL,
        created_by=admin.id, updated_by=admin.id,
    )
    structure2 = SalaryStructure(
        id=str(uuid.uuid4()), employee_id=employee2.id, financial_year_id=fy.id, effective_from=date(2020, 1, 1),
        changed_by=admin.id, basic_salary_monthly=E2_BASIC, created_by=admin.id, updated_by=admin.id,
    )
    db_session.add_all([structure1, structure2])
    await db_session.commit()
    await db_session.refresh(policy)
    await db_session.refresh(structure1)
    await db_session.refresh(structure2)

    # Guard the guard: everything below is derived from these three, so a
    # silent change in the generated-column expressions must fail loudly here
    # rather than quietly re-baseline every expected figure in this file.
    assert policy.net_working_hours_per_day == NET_HOURS_PER_DAY, policy.net_working_hours_per_day
    assert structure1.gross_monthly == E1_GROSS, structure1.gross_monthly
    assert structure2.gross_monthly == E2_GROSS, structure2.gross_monthly
    assert WORKING_DAYS == Decimal("21"), WORKING_DATES

    return {
        "admin": admin, "fy": fy, "policy": policy, "cycle": cycle, "department": department,
        "designation": designation, "employment_type": employment_type, "pf_head": pf_head,
        "income_tax_head": income_tax_head, "e1": employee1, "e2": employee2, "e3": employee3,
        "s1": structure1, "s2": structure2,
    }


async def _record_attendance(client: AsyncClient, employee_id: str) -> None:
    """Every working day of the period through the REAL endpoint. Twenty full
    days (09:00-18:00 less a 1h break = 8.00 net) and one short day
    (09:00-14:00 less the same break = 4.00 net)."""
    for day in WORKING_DATES:
        check_out = "14:00:00" if day == SHORT_DAY else "18:00:00"
        res = await client.post(
            "/api/v1/attendance",
            json={
                "employee_id": employee_id, "attendance_date": day.isoformat(),
                "check_in_time": "09:00:00", "check_out_time": check_out, "break_hours": 1,
            },
        )
        assert res.status_code == 201, f"{day}: {res.status_code} {res.text}"


@pytest_asyncio.fixture
async def attended(world, client):
    """world + employee 1's attendance for the whole period."""
    _as(world["admin"])
    await _record_attendance(client, world["e1"].id)
    return world


async def _create_run(client: AsyncClient, *, month: int = PERIOD_MONTH, year: int = PERIOD_YEAR, mode: str = "ALL_ACTIVE", employee_ids=None) -> dict:
    res = await client.post(
        "/api/v1/payroll/runs",
        json={
            "period_month": month, "period_year": year, "employee_selection_mode": mode,
            "employee_ids": employee_ids or [],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def _by_employee(run: dict) -> dict[str, dict]:
    return {row["employee_id"]: row for row in run["employees"]}


async def _payslip_for(client: AsyncClient, employee_id: str) -> dict:
    res = await client.get("/api/v1/payroll/payslips", params={"employee_id": employee_id})
    assert res.status_code == 200, res.text
    rows = res.json()
    assert len(rows) == 1, f"expected exactly one payslip for {employee_id}, got {len(rows)}"
    return rows[0]


# The figures a payslip is judged by. Every one of these must survive a
# configuration change untouched.
_FROZEN_FIELDS = (
    "gross_pay", "total_earnings", "total_deductions", "net_pay", "unpaid_leave_deduction",
    "lop_deduction", "income_tax_amount", "insurance_employee_contribution", "paid_days",
    "unpaid_leave_days", "lop_days", "pay_period_start", "pay_period_end", "salary_credit_date",
    "period_month", "period_year", "has_unpaid_leave", "employee_code_snapshot",
    "employee_name_snapshot", "department_snapshot", "designation_snapshot",
)


def _figures(payslip: dict) -> dict:
    return {field: payslip[field] for field in _FROZEN_FIELDS}


# ============================================ 1 — the flow, end to end, in money
async def test_attendance_reconciliation_run_preview_confirm_payslip(attended, client, db_session):
    """attendance -> reconciliation -> run -> preview -> confirm -> payslip.

    EMPLOYEE 1 (Asha), hand-derived from the seeded inputs:
      Working days       21 (Mon-Fri between 26-Jun and 25-Jul; Sat/Sun off)
      Required hours     21 x 8.00                       = 168.00
      Worked hours       20 x 8.00 + 4.00                = 164.00
      Hours short        168.00 - 164.00                 =   4.00
      Net short          4.00 - 0 comp pending           =   4.00
      LOP days           4.00 / 8.00 (PRO_RATA_LOP)      =   0.50
      Per-day rate       50,000.00 / 30 days             = 1,666.666...
      LOP deduction      0.50 x 1,666.666... -> 2dp      =  833.33
      Present days       21 - 0 leave - 0.50 LOP         =  20.50
      Paid days          20.50 present + 0 paid leave    =  20.50
      Gross pay          full period, no proration       = 50,000.00
      Total earnings     30,000 Basic + 12,000 HRA + 8,000 Special = 50,000.00
      Retirement Fund    12% x 50,000.00                 = 6,000.00
      Income tax         (50,000 x 12) x 10% = 60,000/yr, over 9 remaining
                         payroll months                  = 6,666.67
      Total deductions   6,000.00 + 6,666.67 + 833.33    = 13,500.00
      NET PAY            50,000.00 - 13,500.00           = 36,500.00

    EMPLOYEE 2 (Bharath), no attendance recorded at all:
      Required 168.00, worked 0 -> net short 168.00 -> LOP days 168/8 = 21.00
      Per-day rate 30,000 / 30 = 1,000.00 -> LOP deduction = 21,000.00
      Present days max(21 - 21, 0) = 0.00
      Retirement Fund 12% x 30,000 = 3,600.00
      Income tax (30,000 x 12) x 10% = 36,000/yr over 9 months = 4,000.00
      Total deductions 3,600 + 4,000 + 21,000 = 28,600.00
      NET PAY 30,000.00 - 28,600.00 = 1,400.00
    """
    _as(attended["admin"])
    e1, e2, e3 = attended["e1"], attended["e2"], attended["e3"]

    # ---------------------------------------------------------- reconciliation
    summary = await client.get(
        "/api/v1/payroll/attendance/monthly-summary",
        params={"period_month": PERIOD_MONTH, "period_year": PERIOD_YEAR},
    )
    assert summary.status_code == 200, summary.text
    rows = {row["employee_id"]: row for row in summary.json()}
    assert set(rows) == {e1.id, e2.id, e3.id}

    assert _d(rows[e1.id]["required_hours"]) == REQUIRED_HOURS == Decimal("168.00")
    assert _d(rows[e1.id]["worked_hours"]) == WORKED_HOURS_ATTENDED == Decimal("164.00")
    assert _d(rows[e1.id]["credited_hours"]) == Decimal("164.00")
    assert _d(rows[e1.id]["balance_hours"]) == Decimal("-4.00")
    assert _d(rows[e1.id]["net_short_hours"]) == Decimal("4.00")
    # 4.00 net short <= one day's net hours (8.00) -> "Short — compensable".
    assert rows[e1.id]["status"] == "Short — compensable"
    assert rows[e1.id]["is_locked"] is False, "nothing is processed yet"

    assert _d(rows[e2.id]["worked_hours"]) == Decimal("0")
    assert _d(rows[e2.id]["net_short_hours"]) == Decimal("168.00")
    assert rows[e2.id]["status"] == "Short — payroll impact"

    impact = await client.get(
        "/api/v1/payroll/attendance/payroll-impact",
        params={"period_month": PERIOD_MONTH, "period_year": PERIOD_YEAR},
    )
    assert impact.status_code == 200, impact.text
    impact_rows = {row["employee_id"]: row for row in impact.json()}
    # The handoff to Run Payroll: this preview must price the shortfall with
    # exactly the figures the run below actually deducts.
    assert _d(impact_rows[e1.id]["hours_short"]) == Decimal("4.00")
    assert _d(impact_rows[e1.id]["lop_days_net_of_pending"]) == Decimal("0.50")
    assert _d(impact_rows[e1.id]["estimated_deduction"]) == Decimal("833.33")
    assert _d(impact_rows[e2.id]["lop_days_net_of_pending"]) == Decimal("21.00")
    assert _d(impact_rows[e2.id]["estimated_deduction"]) == Decimal("21000.00")

    # ------------------------------------------------------- run (lands DRAFT)
    run = await _create_run(client)
    assert run["status"] == "DRAFT", "create_payroll_run must never generate payslips itself"
    assert run["pay_period_start"] == PERIOD_START.isoformat()
    assert run["pay_period_end"] == PERIOD_END.isoformat()
    assert run["salary_credit_date"] == CREDIT_DATE.isoformat()
    assert _d(run["total_days_in_period"]) == TOTAL_DAYS
    assert _d(run["working_days_auto"]) == WORKING_DAYS
    assert _d(run["working_days_effective"]) == WORKING_DAYS

    # --------------------------------------------------- preview (GET the draft)
    preview = await client.get(f"/api/v1/payroll/runs/{run['id']}")
    assert preview.status_code == 200, preview.text
    preview = preview.json()
    assert preview["status"] == "DRAFT"
    rows = _by_employee(preview)
    assert set(rows) == {e1.id, e2.id, e3.id}

    row1 = rows[e1.id]
    assert row1["inclusion_status"] == "INCLUDED"
    assert row1["status"] == "DRAFT"
    assert _d(row1["gross_pay"]) == Decimal("50000.00")
    assert _d(row1["total_earnings"]) == Decimal("50000.00")
    assert _d(row1["required_hours"]) == Decimal("168.00")
    assert _d(row1["worked_hours"]) == Decimal("164.00")
    assert _d(row1["net_short_hours"]) == Decimal("4.00")
    assert _d(row1["lop_days"]) == Decimal("0.50")
    assert _d(row1["lop_deduction"]) == Decimal("833.33")
    assert _d(row1["unpaid_leave_deduction"]) == Decimal("0.00")
    assert _d(row1["present_days"]) == Decimal("20.50")
    assert _d(row1["paid_days"]) == Decimal("20.50")
    assert _d(row1["total_employee_statutory"]) == Decimal("6000.00")
    assert _d(row1["income_tax_amount"]) == Decimal("6666.67")
    assert _d(row1["total_deductions"]) == Decimal("13500.00")
    assert _d(row1["net_pay"]) == Decimal("36500.00")

    row2 = rows[e2.id]
    assert row2["inclusion_status"] == "INCLUDED"
    assert _d(row2["gross_pay"]) == Decimal("30000.00")
    assert _d(row2["lop_days"]) == Decimal("21.00")
    assert _d(row2["lop_deduction"]) == Decimal("21000.00")
    assert _d(row2["present_days"]) == Decimal("0.00")
    assert _d(row2["total_employee_statutory"]) == Decimal("3600.00")
    assert _d(row2["income_tax_amount"]) == Decimal("4000.00")
    assert _d(row2["total_deductions"]) == Decimal("28600.00")
    assert _d(row2["net_pay"]) == Decimal("1400.00")

    # An employee with no Salary Structure is excluded by name, not silently.
    assert rows[e3.id]["inclusion_status"] == "EXCLUDED_NO_SALARY_STRUCTURE"
    assert rows[e3.id]["skip_reason"] == "No active Salary Structure"

    # Run totals are the sum of the INCLUDED rows only.
    assert preview["employee_count"] == 2
    assert _d(preview["total_gross"]) == Decimal("80000.00")           # 50,000 + 30,000
    assert _d(preview["total_employee_deductions"]) == Decimal("42100.00")  # 13,500 + 28,600
    assert _d(preview["total_net"]) == Decimal("37900.00")             # 36,500 + 1,400

    # No payslip exists yet — preview-before-confirm is structural.
    assert (await client.get("/api/v1/payroll/payslips")).json() == []

    # --------------------------------------------------------------- confirm
    confirmed = await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    confirmed = confirmed.json()
    assert confirmed["status"] == "PROCESSED"
    assert confirmed["processed_at"] is not None
    assert confirmed["processed_by"] == attended["admin"].id
    # Confirm recomputes and must land on exactly the same money as the preview.
    assert _d(confirmed["total_gross"]) == Decimal("80000.00")
    assert _d(confirmed["total_net"]) == Decimal("37900.00")
    assert _by_employee(confirmed)[e1.id]["status"] == "PROCESSED"
    assert _by_employee(confirmed)[e2.id]["status"] == "PROCESSED"
    assert _by_employee(confirmed)[e3.id]["status"] == "DRAFT", "an excluded row is never marked Processed"

    # --------------------------------------------------------------- payslip
    payslips = (await client.get("/api/v1/payroll/payslips")).json()
    assert len(payslips) == 2, "one payslip per INCLUDED employee, none for the excluded one"

    payslip1 = await _payslip_for(client, e1.id)
    assert payslip1["status"] == "PROCESSED"
    assert payslip1["employee_code_snapshot"] == "FLOW-1"
    assert payslip1["employee_name_snapshot"] == "Asha Flow"
    assert payslip1["department_snapshot"] == "Engineering"
    assert payslip1["designation_snapshot"] == "Software Engineer"
    assert payslip1["employee_bank_account_masked_snapshot"] == "9012"
    assert payslip1["pay_period_start"] == PERIOD_START.isoformat()
    assert payslip1["pay_period_end"] == PERIOD_END.isoformat()
    assert payslip1["salary_credit_date"] == CREDIT_DATE.isoformat()
    assert _d(payslip1["gross_pay"]) == Decimal("50000.00")
    assert _d(payslip1["total_earnings"]) == Decimal("50000.00")
    assert _d(payslip1["income_tax_amount"]) == Decimal("6666.67")
    assert _d(payslip1["lop_deduction"]) == Decimal("833.33")
    assert _d(payslip1["unpaid_leave_deduction"]) == Decimal("0.00")
    assert _d(payslip1["total_deductions"]) == Decimal("13500.00")
    assert _d(payslip1["net_pay"]) == Decimal("36500.00")
    assert _d(payslip1["paid_days"]) == Decimal("20.50")
    assert _d(payslip1["lop_days"]) == Decimal("0.50")
    assert payslip1["has_unpaid_leave"] is True, "0.50 LOP days is unpaid time"

    earnings = {line["label"]: _d(line["amount"]) for line in payslip1["earning_lines"]}
    assert earnings == {
        "Basic Salary": Decimal("30000.00"),
        "House Rent Allowance": Decimal("12000.00"),
        "Special Allowance": Decimal("8000.00"),
    }
    assert sum(earnings.values()) == _d(payslip1["total_earnings"])

    statutory = {line["print_label_snapshot"]: _d(line["computed_amount"]) for line in payslip1["statutory_lines"]}
    assert statutory == {"Retirement Fund": Decimal("6000.00"), "Income Tax": Decimal("6666.67")}
    bases = {line["print_label_snapshot"]: _d(line["computed_base"]) for line in payslip1["statutory_lines"]}
    # The statutory head prices off this period's Gross Pay; income tax prices
    # off the ANNUALISED taxable income (50,000 x 12) and is then spread over
    # the 9 payroll months left in FY 2026-27 — 60,000.00 / 9 = 6,666.67.
    assert bases["Retirement Fund"] == Decimal("50000.00")
    assert bases["Income Tax"] == Decimal("600000.00")
    assert bases["Income Tax"] * IT_RATE / 100 / REMAINING_MONTHS != statutory["Income Tax"]  # unrounded
    assert (bases["Income Tax"] * IT_RATE / 100 / REMAINING_MONTHS).quantize(Decimal("0.01")) == statutory["Income Tax"]
    # The identity the whole payslip has to satisfy.
    assert _d(payslip1["net_pay"]) == _d(payslip1["total_earnings"]) - _d(payslip1["total_deductions"])
    assert _d(payslip1["total_deductions"]) == sum(statutory.values()) + _d(payslip1["lop_deduction"])

    payslip2 = await _payslip_for(client, e2.id)
    assert _d(payslip2["net_pay"]) == Decimal("1400.00")
    assert _d(payslip2["lop_deduction"]) == Decimal("21000.00")
    assert _d(payslip2["paid_days"]) == Decimal("0.00")

    # The employee's own view must agree with the admin register, figure for
    # figure — the same payslip read through a different screen.
    mine = await client.get(f"/api/v1/payroll/payslips/{payslip1['id']}")
    assert mine.status_code == 200, mine.text
    assert _figures(mine.json()) == _figures(payslip1)

    # And the reconciliation this run consumed is now materialised and LOCKED.
    locked = (
        await db_session.execute(
            select(MonthlyHourReconciliation).where(
                MonthlyHourReconciliation.employee_id == e1.id,
                MonthlyHourReconciliation.period_month == PERIOD_MONTH,
                MonthlyHourReconciliation.period_year == PERIOD_YEAR,
            )
        )
    ).scalar_one()
    assert locked.is_locked is True
    assert locked.worked_hours == Decimal("164.00")
    assert locked.required_hours == Decimal("168.00")
    assert locked.consumed_by_payroll_run_employee_id == row1["id"]


# ================== 2 — the headline: an issued payslip is immune to config edits
async def test_a_confirmed_payslip_does_not_move_when_policy_structure_or_tax_head_change(attended, client, db_session):
    """A payslip must be reproducible from the configuration that produced it.

    After the run is confirmed, this rewrites the three inputs that decide
    every figure on it, through the REAL Masters/Employee endpoints:
      - Work Week Policy: 8.00 -> 12.00 net hours/day, Saturdays all working,
        Sunday-only weekly off, shortfall rounds to a FULL day. That alone
        would take employee 1 from 4.00 hours short to hundreds.
      - Salary Structure: a new revision at 80,000 gross instead of 50,000.
      - Tax Head: the statutory rate from 12% to 25%.

    Every figure on the already-issued payslip must be byte-identical
    afterwards. The final step reissues that same payslip on the RECALCULATED
    method and asserts the figures DO move — which is what proves the
    assertions above were not vacuous.
    """
    _as(attended["admin"])
    e1 = attended["e1"]

    run = await _create_run(client)
    assert (await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")).status_code == 200

    payslip = await _payslip_for(client, e1.id)
    frozen = _figures(payslip)
    frozen_earnings = [(line["label"], line["amount"]) for line in payslip["earning_lines"]]
    frozen_statutory = [
        (line["print_label_snapshot"], line["computed_base"], line["computed_amount"]) for line in payslip["statutory_lines"]
    ]
    assert _d(frozen["net_pay"]) == Decimal("36500.00"), "sanity: the payslip under test is the one derived in test 1"

    async def _stored_rate_snapshots() -> dict[str, Decimal]:
        """The rate each statutory line was CALCULATED at, straight off the
        stored row — PayslipStatutoryLineOut does not expose it, and a frozen
        amount with a re-written rate beside it would not be a reproducible
        payslip."""
        lines = (
            await db_session.execute(select(PayslipStatutoryLine).where(PayslipStatutoryLine.payslip_id == payslip["id"]))
        ).scalars().all()
        return {line.print_label_snapshot: line.rate_snapshot for line in lines}

    frozen_rates = await _stored_rate_snapshots()
    assert frozen_rates["Retirement Fund"] == PF_RATE

    # ------------------------------------------- edit 1: the Work Week Policy
    policy_id = attended["policy"].id
    edited = await client.put(
        f"/api/v1/masters/work-week-policies/{policy_id}",
        json={
            "policy_name": "Company Standard (revised)", "applies_to": "COMPANY_WIDE",
            "effective_from": "2020-01-01", "gross_hours_per_day": "13", "unpaid_break_hours": "1",
            "grace_window_minutes": 0, "half_day_threshold_hours": "6", "count_overtime_beyond_net": False,
            "weekly_hour_target": "72", "weekly_off_days": "SUNDAY", "saturday_rule": "ALL_WORKING",
            "working_saturday_hours_mode": "FULL", "custom_saturday_hours": None,
            "mandatory_holiday_overrides_saturday": True, "allow_compensatory_hours": True,
            "compensation_window_days": 30, "make_up_day_chosen_by": None, "allow_makeup_on_week_off": False,
            "allow_makeup_on_mandatory_holiday": False, "max_comp_hours_per_month": "0",
            "uncompensated_shortfall_becomes": "ROUND_FULL_DAY", "excess_hours_become": None,
        },
    )
    assert edited.status_code == 200, edited.text
    assert _d(edited.json()["net_working_hours_per_day"]) == Decimal("12.00"), "the edit must really have taken"

    # ------------------------------------------ edit 2: the Salary Structure
    revised = await client.post(
        f"/api/v1/employees/{e1.id}/salary-structures",
        json={
            "effective_from": "2026-08-01", "basic_salary_monthly": "60000",
            "special_allowance_monthly": "20000", "change_note": "post-payroll raise",
        },
    )
    assert revised.status_code == 201, revised.text
    assert _d(revised.json()["gross_monthly"]) == Decimal("80000.00")

    # ----------------------------------------------- edit 3: the Tax Head rate
    head = attended["pf_head"]
    retaxed = await client.put(
        f"/api/v1/masters/taxes/{head.id}",
        json={
            "tax_name": head.tax_name, "short_code": head.short_code, "scope": head.scope,
            "tax_type": head.tax_type, "applies_from": "2020-01-01", "rate_pct": "25",
            "print_label": head.print_label, "behaviour": head.behaviour,
        },
    )
    assert retaxed.status_code == 200, retaxed.text
    assert _d(retaxed.json()["rate_pct"]) == Decimal("25")

    # ------------------------------------------------ THE ASSERTION THAT MATTERS
    after = await _payslip_for(client, e1.id)
    assert _figures(after) == frozen, (
        "an ISSUED payslip changed when the configuration behind it was edited — "
        "the company cannot defend a number it has already paid"
    )
    assert [(line["label"], line["amount"]) for line in after["earning_lines"]] == frozen_earnings
    assert [
        (line["print_label_snapshot"], line["computed_base"], line["computed_amount"])
        for line in after["statutory_lines"]
    ] == frozen_statutory
    assert await _stored_rate_snapshots() == frozen_rates, (
        "a statutory line must keep the RATE it was calculated at (12%), not today's (25%)"
    )

    # The single-payslip read and the whole run's stored totals too.
    single = await client.get(f"/api/v1/payroll/payslips/{payslip['id']}")
    assert _figures(single.json()) == frozen
    after_run = (await client.get(f"/api/v1/payroll/runs/{run['id']}")).json()
    assert _d(after_run["total_gross"]) == Decimal("80000.00")
    assert _d(after_run["total_net"]) == Decimal("37900.00")
    assert _d(_by_employee(after_run)[e1.id]["net_pay"]) == Decimal("36500.00")

    # --------------------------------- proof the three edits were not inert
    # Reissue is the one sanctioned path that recomputes an issued payslip.
    # Run it now: if the figures move HERE, the configuration edits above were
    # real, and the payslip surviving them was a genuine result.
    reissued = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={"reason": "prove the configuration edits are live", "reissue_method": "RECALCULATED"},
    )
    assert reissued.status_code == 200, reissued.text
    reissued = reissued.json()
    assert _d(reissued["old_net_pay"]) == Decimal("36500.00")
    assert _d(reissued["new_net_pay"]) != Decimal("36500.00"), (
        "the configuration edits changed nothing even on an explicit recalculation — "
        "the 'payslip did not change' assertions above would be vacuous"
    )
    recomputed = await _payslip_for(client, e1.id)
    assert _d(recomputed["net_pay"]) == _d(reissued["new_net_pay"])
    assert _d(recomputed["net_pay"]) != _d(frozen["net_pay"])
    # A concrete figure, not just "different": the recompute prices off the
    # 80,000.00 revision. Flagged rather than blessed — _calculate_employee
    # always reads the Salary Structure whose effective_to is NULL, so a
    # revision dated 2026-08-01 is what a recalculation of JULY uses.
    assert _d(recomputed["gross_pay"]) == Decimal("80000.00")
    # Also flagged, not blessed: a RECALCULATED reissue rewrites the payslip's
    # scalar figures but leaves its earning/statutory LINE rows untouched, so
    # the printed breakdown stops adding up to the total printed beside it.
    # Delete this assertion (and this comment) when reissue starts rebuilding
    # the lines.
    assert sum((_d(line["amount"]) for line in recomputed["earning_lines"]), Decimal("0")) != _d(recomputed["total_earnings"])
    assert await _stored_rate_snapshots() == frozen_rates, "the reissue did not rewrite the line snapshots either"


# ================ 3 — a processed period reads back LOCKED reconciliation figures
async def test_a_processed_period_reads_back_locked_hour_figures(attended, client):
    """Payroll §2.4: the Attendance & Time Basis screens recompute live for an
    open period, but a PROCESSED one must read its locked
    MonthlyHourReconciliation row verbatim — otherwise a Work Week Policy edit
    silently rewrites the explanation of a payslip that cannot itself change,
    and the two disagree."""
    _as(attended["admin"])
    e1 = attended["e1"]
    params = {"period_month": PERIOD_MONTH, "period_year": PERIOD_YEAR, "employee_id": e1.id}

    before = (await client.get("/api/v1/payroll/attendance/monthly-summary", params=params)).json()[0]
    assert before["is_locked"] is False
    assert _d(before["required_hours"]) == Decimal("168.00")

    run = await _create_run(client)
    assert (await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")).status_code == 200

    locked_summary = (await client.get("/api/v1/payroll/attendance/monthly-summary", params=params)).json()[0]
    locked_impact = (await client.get("/api/v1/payroll/attendance/payroll-impact", params=params)).json()[0]
    assert locked_summary["is_locked"] is True, "confirm must materialise and lock the reconciliation it consumed"
    assert locked_impact["is_locked"] is True
    assert _d(locked_summary["required_hours"]) == Decimal("168.00")
    assert _d(locked_summary["worked_hours"]) == Decimal("164.00")
    assert _d(locked_summary["net_short_hours"]) == Decimal("4.00")
    assert locked_summary["status"] == "Short — compensable"
    assert _d(locked_impact["lop_days_net_of_pending"]) == Decimal("0.50")
    assert _d(locked_impact["estimated_deduction"]) == Decimal("833.33")

    # Now move the policy under it: 8.00 -> 12.00 net hours/day and every
    # Saturday working would make 168.00 required hours impossible to keep.
    assert (
        await client.put(
            f"/api/v1/masters/work-week-policies/{attended['policy'].id}",
            json={
                "policy_name": "Company Standard (revised)", "applies_to": "COMPANY_WIDE",
                "effective_from": "2020-01-01", "gross_hours_per_day": "13", "unpaid_break_hours": "1",
                "grace_window_minutes": 0, "half_day_threshold_hours": "6", "count_overtime_beyond_net": False,
                "weekly_hour_target": "72", "weekly_off_days": "SUNDAY", "saturday_rule": "ALL_WORKING",
                "working_saturday_hours_mode": "FULL", "custom_saturday_hours": None,
                "mandatory_holiday_overrides_saturday": True, "allow_compensatory_hours": True,
                "compensation_window_days": 30, "make_up_day_chosen_by": None, "allow_makeup_on_week_off": False,
                "allow_makeup_on_mandatory_holiday": False, "max_comp_hours_per_month": "0",
                "uncompensated_shortfall_becomes": "ROUND_FULL_DAY", "excess_hours_become": None,
            },
        )
    ).status_code == 200

    after_summary = (await client.get("/api/v1/payroll/attendance/monthly-summary", params=params)).json()[0]
    after_impact = (await client.get("/api/v1/payroll/attendance/payroll-impact", params=params)).json()[0]
    assert after_summary == locked_summary, "a processed period must not be re-explained by a later policy edit"
    assert after_impact == locked_impact

    # Non-vacuity: the same edit visibly moves an OPEN period. June 2026 covers
    # 2026-05-26..2026-06-25, has no attendance and no locked row, so it
    # recomputes live against the new 12.00-hour policy.
    open_period = {"period_month": 6, "period_year": PERIOD_YEAR, "employee_id": e1.id}
    open_row = (await client.get("/api/v1/payroll/attendance/monthly-summary", params=open_period)).json()[0]
    assert open_row["is_locked"] is False
    assert _d(open_row["required_hours"]) % Decimal("12") == 0, (
        f"an open period should be recomputed against the NEW 12.00-hour policy, got {open_row['required_hours']}"
    )
    assert _d(open_row["required_hours"]) != Decimal("168.00")


# ================================================ 4 — confirm is a one-way door
async def test_a_run_cannot_be_confirmed_twice(world, client):
    _as(world["admin"])
    run = await _create_run(client)

    first = await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "PROCESSED"

    second = await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == "Already Processed"

    # The refusal has to be real, not cosmetic: no second set of payslips, and
    # no doubling of the money.
    payslips = (await client.get("/api/v1/payroll/payslips")).json()
    assert len(payslips) == 2
    still = (await client.get(f"/api/v1/payroll/runs/{run['id']}")).json()
    assert _d(still["total_net"]) == _d(first.json()["total_net"])


# ========================== 5 — a period with no attendance behaves sanely
async def test_a_period_with_no_attendance_at_all_pays_only_what_is_owed(world, client):
    """No attendance is not "no data, pay in full" and not a crash — it is a
    full period of shortfall priced by the policy's own rule.

    Employee 1: required 168.00, worked 0 -> net short 168.00
                LOP days 168.00 / 8.00 = 21.00
                per-day rate 50,000 / 30 = 1,666.666... -> 21 x that = 35,000.00
                deductions 6,000.00 RF + 6,666.67 IT + 35,000.00 LOP = 47,666.67
                NET 50,000.00 - 47,666.67 = 2,333.33
    Employee 2: 3,600.00 + 4,000.00 + 21,000.00 = 28,600.00 -> NET 1,400.00
    """
    _as(world["admin"])
    e1, e2 = world["e1"], world["e2"]

    summary = await client.get(
        "/api/v1/payroll/attendance/monthly-summary",
        params={"period_month": PERIOD_MONTH, "period_year": PERIOD_YEAR},
    )
    assert summary.status_code == 200, "an empty period must not 500"
    rows = {row["employee_id"]: row for row in summary.json()}
    assert _d(rows[e1.id]["worked_hours"]) == Decimal("0")
    assert _d(rows[e1.id]["required_hours"]) == Decimal("168.00")

    run = await _create_run(client)
    confirmed = (await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")).json()
    assert confirmed["status"] == "PROCESSED"
    assert confirmed["employee_count"] == 2

    payslip1 = await _payslip_for(client, e1.id)
    assert _d(payslip1["gross_pay"]) == Decimal("50000.00")
    assert _d(payslip1["lop_days"]) == Decimal("21.00")
    assert _d(payslip1["lop_deduction"]) == Decimal("35000.00")
    assert _d(payslip1["total_deductions"]) == Decimal("47666.67")
    assert _d(payslip1["net_pay"]) == Decimal("2333.33")
    assert _d(payslip1["paid_days"]) == Decimal("0.00")
    assert payslip1["has_unpaid_leave"] is True

    payslip2 = await _payslip_for(client, e2.id)
    assert _d(payslip2["net_pay"]) == Decimal("1400.00")

    # 80,000.00 gross - 76,266.67 deductions = 3,733.33 net across both.
    assert _d(confirmed["total_gross"]) == Decimal("80000.00")
    assert _d(confirmed["total_employee_deductions"]) == Decimal("76266.67")
    assert _d(confirmed["total_net"]) == Decimal("3733.33")
    # Nobody was paid their full salary for a month nobody turned up.
    assert _d(confirmed["total_net"]) < _d(confirmed["total_gross"])


# ============ 6 — the status values the code actually defines, not assumed ones
async def test_run_status_transitions_are_the_ones_the_code_defines(world, client):
    """Read from the source, not guessed:
      - payroll_runs.status is pinned by ck_prun_status to ('DRAFT','PROCESSED');
        DISCARDED is a REPORTED status derived from discarded_at
        (_effective_status), never a stored third value.
      - payroll_run_employees.status: 'DRAFT' -> 'PROCESSED' on confirm.
      - payroll_run_employees.inclusion_status: INCLUDED /
        EXCLUDED_NO_SALARY_STRUCTURE / EXCLUDED_NOT_ACTIVE /
        SKIPPED_ALREADY_PROCESSED.
      - payslips.status is pinned by ck_payslip_status to ('PROCESSED','REISSUED').
    """
    _as(world["admin"])
    e1, e3 = world["e1"], world["e3"]

    # ---------------------------------------------- DRAFT -> discard -> DISCARDED
    throwaway = await _create_run(client, mode="SPECIFIC_EMPLOYEES", employee_ids=[e1.id])
    assert throwaway["status"] == "DRAFT"
    assert throwaway["discarded_at"] is None
    discarded = await client.post(f"/api/v1/payroll/runs/{throwaway['id']}/discard")
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["status"] == "DISCARDED"
    assert discarded.json()["discarded_at"] is not None

    # A discarded run is out of the default history but findable under its own
    # reported status, and can never become payslips.
    history = (await client.get("/api/v1/payroll/runs")).json()
    assert throwaway["id"] not in {r["id"] for r in history}
    only_discarded = (await client.get("/api/v1/payroll/runs", params={"status": "DISCARDED"})).json()
    assert [r["id"] for r in only_discarded] == [throwaway["id"]]
    refused = await client.post(f"/api/v1/payroll/runs/{throwaway['id']}/confirm")
    assert refused.status_code == 409
    assert "discarded" in refused.json()["detail"].lower()
    assert (await client.post(f"/api/v1/payroll/runs/{throwaway['id']}/discard")).status_code == 409

    # ------------------------------------------------------- DRAFT -> PROCESSED
    run = await _create_run(client)
    assert run["status"] == "DRAFT"
    assert {row["status"] for row in run["employees"]} == {"DRAFT"}
    assert _by_employee(run)[e3.id]["inclusion_status"] == "EXCLUDED_NO_SALARY_STRUCTURE"

    # A Draft can be recalculated; that is the only status that can.
    recalculated = await client.post(f"/api/v1/payroll/runs/{run['id']}/recalculate")
    assert recalculated.status_code == 200, recalculated.text
    assert recalculated.json()["status"] == "DRAFT"

    confirmed = (await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")).json()
    assert confirmed["status"] == "PROCESSED"

    # PROCESSED is terminal for the run: no recalculate, no discard.
    no_recalc = await client.post(f"/api/v1/payroll/runs/{run['id']}/recalculate")
    assert no_recalc.status_code == 409
    assert no_recalc.json()["detail"] == "Only a Draft run can be recalculated"
    no_discard = await client.post(f"/api/v1/payroll/runs/{run['id']}/discard")
    assert no_discard.status_code == 409
    assert "permanent" in no_discard.json()["detail"]

    payslip = await _payslip_for(client, e1.id)
    assert payslip["status"] == "PROCESSED"
    assert payslip["reissue_count"] == 0
    assert payslip["last_reissued_at"] is None


# ===================== 7 — a second run for a Processed period pays nobody twice
# REGRESSION TEST for a real double-payment exposure this file found, now
# FIXED: confirm_payroll_run flushes before refreshing, so the PROCESSED
# status the A116 guard reads is actually persisted.
async def test_a_second_run_for_an_already_processed_period_skips_every_employee(world, client, db_session):
    """A116: the per-employee+month already-Processed guard. Without it, a
    second run for July issues a second July payslip and pays everyone twice.

    This is the whole reason payroll_run_employees carries a status at all, so
    the row status is asserted here alongside the consequence."""
    _as(world["admin"])
    e1, e2, e3 = world["e1"], world["e2"], world["e3"]

    first = await _create_run(client)
    assert (await client.post(f"/api/v1/payroll/runs/{first['id']}/confirm")).status_code == 200

    # Straight off the stored rows, so the assertion cannot be blamed on the
    # response shape: Confirm generated a real payslip for each of these.
    stored = {
        row.employee_id: row.status
        for row in (
            await db_session.execute(select(PayrollRunEmployee).where(PayrollRunEmployee.payroll_run_id == first["id"]))
        ).scalars().all()
    }
    assert stored[e1.id] == "PROCESSED", "Confirm issued a payslip for this employee but left the run row Draft"
    assert stored[e2.id] == "PROCESSED"

    second = await _create_run(client)
    rows = _by_employee(second)
    assert rows[e1.id]["inclusion_status"] == "SKIPPED_ALREADY_PROCESSED"
    assert rows[e2.id]["inclusion_status"] == "SKIPPED_ALREADY_PROCESSED"
    assert rows[e1.id]["skip_reason"] == f"Already Processed for {PERIOD_MONTH}/{PERIOD_YEAR}"
    assert rows[e3.id]["inclusion_status"] == "EXCLUDED_NO_SALARY_STRUCTURE"
    assert second["employee_count"] == 0
    assert _d(second["total_gross"]) == Decimal("0.00")
    assert _d(second["total_net"]) == Decimal("0.00")

    confirmed_again = await client.post(f"/api/v1/payroll/runs/{second['id']}/confirm")
    assert confirmed_again.status_code == 200, confirmed_again.text
    # Still exactly one payslip per employee, and the money is unchanged — the
    # figures are the no-attendance ones derived in the test above (nobody in
    # this fixture recorded any attendance).
    assert len((await client.get("/api/v1/payroll/payslips")).json()) == 2
    assert _d((await _payslip_for(client, e1.id))["net_pay"]) == Decimal("2333.33")
    assert _d((await _payslip_for(client, e2.id))["net_pay"]) == Decimal("1400.00")


# ================================================================ 8 — reissue
async def test_reissue_recomputes_reproducibly_and_records_old_against_new(attended, client):
    """§2.3 / A119. With nothing changed, a RECALCULATED reissue must land on
    the exact same figures the original run produced — the same reproducibility
    claim the locked-payslip test makes, from the other direction. The Reissue
    History then has to carry old alongside new."""
    _as(attended["admin"])
    e1 = attended["e1"]

    run = await _create_run(client)
    assert (await client.post(f"/api/v1/payroll/runs/{run['id']}/confirm")).status_code == 200
    payslip = await _payslip_for(client, e1.id)
    original = _figures(payslip)
    assert _d(original["net_pay"]) == Decimal("36500.00")

    # A reason is mandatory either way.
    blank = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={"reason": "   ", "reissue_method": "RECALCULATED"},
    )
    assert blank.status_code == 422, blank.text

    reissue = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={"reason": "attendance corrected after review", "reissue_method": "RECALCULATED"},
    )
    assert reissue.status_code == 200, reissue.text
    reissue = reissue.json()
    assert reissue["reissue_number"] == 1
    assert reissue["reissue_method"] == "RECALCULATED"
    assert reissue["reason"] == "attendance corrected after review"
    assert _d(reissue["old_net_pay"]) == Decimal("36500.00")
    assert _d(reissue["new_net_pay"]) == Decimal("36500.00"), (
        "recalculating an unchanged period produced a different number — the run is not reproducible"
    )
    assert _d(reissue["net_pay_delta"]) == Decimal("0.00")
    # Super Admin reissuing IS the approval; the toggle is off by default.
    assert reissue["approval_required"] is False
    assert reissue["approved_by"] is None

    after = await _payslip_for(client, e1.id)
    assert _figures(after) == original, "an unchanged recalculation must not move a single figure"
    assert after["status"] == "REISSUED"
    assert after["reissue_count"] == 1
    assert after["last_reissued_at"] is not None

    # A manual reissue has to state three figures that reconcile.
    incoherent = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={"reason": "manual", "reissue_method": "MANUAL_ADJUSTMENT", "manual_net_pay": "99999.00"},
    )
    assert incoherent.status_code == 422, incoherent.text

    mismatched = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={
            "reason": "manual", "reissue_method": "MANUAL_ADJUSTMENT", "manual_total_earnings": "50000.00",
            "manual_total_deductions": "13500.00", "manual_net_pay": "99999.00",
        },
    )
    assert mismatched.status_code == 422, mismatched.text

    # 50,000.00 earnings - 12,666.67 deductions = 37,333.33 net: the LOP
    # deduction waived after review, everything else left alone.
    manual = await client.post(
        f"/api/v1/payroll/payslips/{payslip['id']}/reissue",
        json={
            "reason": "shortfall waived by HR", "reissue_method": "MANUAL_ADJUSTMENT",
            "manual_gross_pay": "50000.00", "manual_total_earnings": "50000.00",
            "manual_total_deductions": "12666.67", "manual_net_pay": "37333.33",
        },
    )
    assert manual.status_code == 200, manual.text
    manual = manual.json()
    assert manual["reissue_number"] == 2, "the history is append-only and numbered"
    assert _d(manual["old_net_pay"]) == Decimal("36500.00")
    assert _d(manual["new_net_pay"]) == Decimal("37333.33")
    assert _d(manual["net_pay_delta"]) == Decimal("833.33")

    final = await _payslip_for(client, e1.id)
    assert _d(final["net_pay"]) == Decimal("37333.33")
    assert _d(final["total_deductions"]) == Decimal("12666.67")
    assert final["reissue_count"] == 2
    assert final["status"] == "REISSUED"


# =========================== 9 — the not-found / validation shape of the flow
async def test_unknown_ids_and_bad_periods_are_4xx_not_500(world, client):
    _as(world["admin"])
    ghost = str(uuid.uuid4())

    assert (await client.get(f"/api/v1/payroll/runs/{ghost}")).status_code == 404
    assert (await client.post(f"/api/v1/payroll/runs/{ghost}/confirm")).status_code == 404
    assert (await client.post(f"/api/v1/payroll/runs/{ghost}/recalculate")).status_code == 404
    assert (await client.post(f"/api/v1/payroll/runs/{ghost}/discard")).status_code == 404
    assert (await client.get(f"/api/v1/payroll/payslips/{ghost}")).status_code == 404
    assert (
        await client.post(f"/api/v1/payroll/payslips/{ghost}/reissue", json={"reason": "x", "reissue_method": "RECALCULATED"})
    ).status_code == 404

    # Month 13 must be a 422 naming the field, never a 500 out of date().
    assert (
        await client.post(
            "/api/v1/payroll/runs",
            json={"period_month": 13, "period_year": PERIOD_YEAR, "employee_selection_mode": "ALL_ACTIVE"},
        )
    ).status_code == 422
    assert (
        await client.get(
            "/api/v1/payroll/attendance/monthly-summary", params={"period_month": 0, "period_year": PERIOD_YEAR}
        )
    ).status_code == 422
    # SPECIFIC_EMPLOYEES with nothing selected is a stated 422, not an empty run.
    assert (
        await client.post(
            "/api/v1/payroll/runs",
            json={"period_month": PERIOD_MONTH, "period_year": PERIOD_YEAR, "employee_selection_mode": "SPECIFIC_EMPLOYEES"},
        )
    ).status_code == 422
    # A period no Financial Year covers is a clean 409, not a crash.
    orphan = await client.post(
        "/api/v1/payroll/runs",
        json={"period_month": 5, "period_year": 2019, "employee_selection_mode": "ALL_ACTIVE"},
    )
    assert orphan.status_code == 409, orphan.text
    assert "Financial Year" in orphan.json()["detail"]
