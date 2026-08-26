"""Layer 2's SCOPE check: an 'own'/'team' role's list endpoint returns THEIR
rows and no one else's.

COMPLETE-TEST-PROMPT.md's seven-check matrix leaves three checks per-endpoint;
the four mechanical ones are swept in tests/api/test_endpoint_contract_sweep.py
and are not repeated here. This file is the scope one, and unlike the happy
path it CANNOT be generic: "their own rows" is a different column, a different
join and a different owner on every screen, so each case below names the
screen, the role, the endpoint and the two rows it is about.

THE SHAPE OF EVERY CASE, and why each half matters:

    1. Seed TWO rows: one belonging to the actor (or, for a Manager, to their
       direct report), one belonging to someone outside that scope entirely.
    2. Fetch a CONTROL first, proving the withheld row genuinely exists and
       that this endpoint can return it. Without that step the whole test is
       vacuous — an endpoint that returned [] for everybody, or a fixture that
       silently failed to insert the second row, would sail through "the other
       row is not in my list". On a company-wide list the control is a
       SUPER_ADMIN fetch of the very same endpoint, which must return BOTH
       rows; on a self-service "my ..." endpoint (where a Super Admin fetch
       returns the Super Admin's own rows and proves nothing) the control is
       the out-of-scope employee fetching it themselves — see `_check`.
    3. Fetch as the scoped actor. Their row must be present (proving the
       endpoint works for them at all) and the other row must be ABSENT.

WHERE "MY OWN" COMES FROM. Ownership in this codebase is an employee_id, never
a user_id (app/services/org_scope.py's get_own_employee_id joins User.id ->
Employee.user_id), and 'team' is direct reports only — resolved from real
Employee.reporting_manager_id links, which the fixture below sets up rather
than faking with a filter parameter.

TWO DIFFERENT ENFORCEMENT MECHANISMS, both covered:
  * apply_scope (app/rbac/scope.py) on a screen whose seeded mode is 'own',
    'team' or 'view_team' — the RBAC layer narrowing the query before any
    filter runs (RBAC Invariant 5).
  * the route body itself, on the self-service "my ..." screens. Those are
    seeded 'full' for every role on purpose — everybody may see My Expenses —
    and the row set is narrowed by the handler doing `where(... == own_id)`.
    A 'full' mode makes apply_scope a no-op there, so if that one line ever
    goes missing, RBAC will not catch it and nothing but a test like this
    will. Each case records which mechanism it exercises.
The `mode` on every case below is asserted against app/seed.py's own
SCREEN_PERMISSIONS table, so a case can never claim a scope the product does
not actually ship.

WHAT THIS FILE DELIBERATELY DOES NOT REPEAT — tests/security/test_field_and_
scope.py already covers, as Layer 3's bypass matrix item 3:
  * MANAGER view_team on employee.directory — list, single record by id, and
    the "can a filter param widen it" attack.
  * MANAGER view_team on asset.directory — same three routes.
  * EMPLOYEE own on project.directory — same three routes.
  * EMPLOYEE 'none' on employee.directory being a 404, not an empty 200.
Everything below is a screen/role pair that file does not touch. The overlap
in method is deliberate (same harness, same "prove it against a Super Admin
fetch" discipline); the endpoints are disjoint.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.asset import Asset, AssetMaintenanceLog, AssetRequest
from app.models.customer import Customer
from app.models.employee import AttendanceRecord, Employee, Resignation
from app.models.finance import ExpenseClaim
from app.models.leave import CompensatoryHourRequest, LeaveBalance, LeaveRequest
from app.models.masters import (
    AssetCategory,
    CustomerStatus,
    Department,
    Designation,
    EmploymentType,
    ExpenseType,
    LeaveType,
    PayCycle,
    TicketCategory,
    WorkWeekPolicy,
)
from app.models.numbering import FinancialYear
from app.models.payroll import PayrollRun, PayrollRunEmployee, Payslip
from app.models.platform import User
from app.models.project import Project, ProjectMember, TimesheetEntry
from app.models.ticket import Ticket
from app.seed import SCREEN_PERMISSIONS
from tests.conftest import CANONICAL_SCREEN_MODE, seed_canonical

API = "/api/v1"
SPEC = app.openapi()

TODAY = date.today()
FY_START = date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
FY_END = date(FY_START.year + 1, 3, 31)
NOW = datetime.now(timezone.utc).replace(tzinfo=None)

# apply_scope needs a period that overlaps the seeded employment window for
# the attendance-reconciliation screens; the pay period is the current month.
PERIOD_MONTH, PERIOD_YEAR = TODAY.month, TODAY.year

BY_APPLY_SCOPE = "app/rbac/scope.py's apply_scope"
BY_THE_ROUTE = "the route body's own where(... == own_id)"


@dataclass(frozen=True)
class ScopeCase:
    """One (screen, role, endpoint) whose row set must be narrowed.

    `mine_key`/`theirs_key` index the seeded world: the row that must come
    back, and the row that must not. `key` is the field on each returned row
    those ids are compared against — `id` for a record list, `employee_id`
    for the two derived per-employee report rows.
    """

    screen: str
    role: str
    mode: str
    path: str
    mine_key: str
    theirs_key: str
    enforced_by: str
    key: str = "id"
    query: str = ""
    control: str = "SUPER_ADMIN"

    @property
    def label(self) -> str:
        return f"{self.role} '{self.mode}' on {self.screen} -> GET {self.path}"


# ------------------------------------------------- EMPLOYEE, scoped to 'own'
EMPLOYEE_CASES = [
    ScopeCase(
        screen="expense.my_expenses", role="EMPLOYEE", mode="full", path=f"{API}/expenses/me",
        mine_key="expense_mine", theirs_key="expense_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="leave.my_leave", role="EMPLOYEE", mode="full", path=f"{API}/leave/requests",
        mine_key="leave_mine", theirs_key="leave_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="leave.my_leave", role="EMPLOYEE", mode="full", path=f"{API}/leave/balances",
        mine_key="balance_mine", theirs_key="balance_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="payroll.my_payslips", role="EMPLOYEE", mode="full", path=f"{API}/payroll/payslips/me",
        mine_key="payslip_mine", theirs_key="payslip_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="employee.my_projects_tasks", role="EMPLOYEE", mode="full", path=f"{API}/employees/me/projects",
        mine_key="project_mine", theirs_key="project_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="employee.my_tickets", role="EMPLOYEE", mode="full", path=f"{API}/employees/me/tickets",
        mine_key="ticket_mine", theirs_key="ticket_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="employee.my_assets", role="EMPLOYEE", mode="full", path=f"{API}/employees/me/assets",
        mine_key="asset_mine", theirs_key="asset_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    ScopeCase(
        screen="project.timesheet.mine", role="EMPLOYEE", mode="full", path=f"{API}/timesheets/me",
        mine_key="timesheet_mine", theirs_key="timesheet_theirs", enforced_by=BY_THE_ROUTE,
        control="OUTSIDER",
    ),
    # The two genuine RBAC-mode 'own' screens an Employee holds that
    # tests/security/test_field_and_scope.py does not already cover.
    ScopeCase(
        screen="ticket.list", role="EMPLOYEE", mode="own", path=f"{API}/tickets",
        mine_key="ticket_mine", theirs_key="ticket_theirs", enforced_by=BY_THE_ROUTE,
    ),
    ScopeCase(
        screen="employee.attendance", role="EMPLOYEE", mode="own", path=f"{API}/attendance",
        mine_key="attendance_mine", theirs_key="attendance_theirs", enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="employee.offboarding", role="EMPLOYEE", mode="own", path=f"{API}/resignations",
        mine_key="resignation_mine", theirs_key="resignation_theirs", enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="leave.compensatory_hours", role="EMPLOYEE", mode="own",
        path=f"{API}/compensatory-hours/requests", mine_key="comp_mine", theirs_key="comp_theirs",
        enforced_by=BY_THE_ROUTE, control="OUTSIDER",
    ),
]

# ------------------------------------- MANAGER, scoped to their direct reports
MANAGER_CASES = [
    ScopeCase(
        screen="leave.approvals", role="MANAGER", mode="team", path=f"{API}/leave/approvals",
        mine_key="leave_mine", theirs_key="leave_theirs", enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="employee.attendance", role="MANAGER", mode="view_team", path=f"{API}/attendance",
        mine_key="attendance_mine", theirs_key="attendance_theirs", enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="leave.compensatory_hours", role="MANAGER", mode="team",
        path=f"{API}/compensatory-hours/approvals", mine_key="comp_mine", theirs_key="comp_theirs",
        enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="employee.offboarding", role="MANAGER", mode="team", path=f"{API}/resignations",
        mine_key="resignation_mine", theirs_key="resignation_theirs", enforced_by=BY_APPLY_SCOPE,
    ),
    ScopeCase(
        screen="asset.requests", role="MANAGER", mode="view_team", path=f"{API}/asset-requests",
        mine_key="asset_request_mine", theirs_key="asset_request_theirs", enforced_by=BY_THE_ROUTE,
    ),
    ScopeCase(
        screen="asset.maintenance", role="MANAGER", mode="view_team", path=f"{API}/maintenance",
        mine_key="maintenance_mine", theirs_key="maintenance_theirs", enforced_by=BY_THE_ROUTE,
    ),
    ScopeCase(
        screen="payroll.attendance_time_basis", role="MANAGER", mode="view_team",
        path=f"{API}/payroll/attendance/monthly-summary", mine_key="report_employee_id",
        theirs_key="outsider_employee_id", enforced_by=BY_THE_ROUTE, key="employee_id",
        query=f"period_month={PERIOD_MONTH}&period_year={PERIOD_YEAR}",
    ),
]

ALL_CASES = EMPLOYEE_CASES + MANAGER_CASES


# =================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session):
    async def _db():
        # See tests/api/test_finance_flows.py's harness note: production opens
        # a fresh session per request, and several rows seeded below carry
        # GENERATED columns (LeaveBalance.remaining_days, ExpenseClaim.
        # has_receipt) that are not loaded by their INSERT. Read-only sweep,
        # so expiring can neither hide nor invent a row.
        db_session.expire_all()
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


async def _actor(db, ids: dict, role_code: str, label: str) -> User:
    user = User(
        id=str(uuid.uuid4()), email=f"{label}@scope.enforcement", password_hash="x",
        full_name=label.title(), role_id=ids[f"role:{role_code}"], is_enabled=True,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def world(db_session) -> dict:
    """One company with a real reporting line and, for every screen under
    test, exactly two rows: one owned by the Employee actor (who reports to
    the Manager actor) and one owned by an employee outside that line.

    The out-of-scope employee reports to NOBODY rather than to a second
    manager: that makes the Manager's direct-report set unambiguous, and it
    means a bug that resolved 'team' to "everyone with a manager" would still
    be caught by the Employee cases.
    """
    ids = await seed_canonical(db_session)
    super_admin = await _actor(db_session, ids, "SUPER_ADMIN", "ravi.super")
    manager_user = await _actor(db_session, ids, "MANAGER", "vikram.manager")
    report_user = await _actor(db_session, ids, "EMPLOYEE", "arun.report")
    outsider_user = await _actor(db_session, ids, "EMPLOYEE", "kiran.outsider")

    fy = FinancialYear(
        id=str(uuid.uuid4()), label=f"FY {FY_START.year}-{FY_END.year % 100}",
        start_date=FY_START, end_date=FY_END, is_current=True,
    )
    department = Department(id=str(uuid.uuid4()), name="Engineering")
    designation = Designation(id=str(uuid.uuid4()), name="Engineer")
    employment_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time")
    leave_type = LeaveType(id=str(uuid.uuid4()), name="Casual Leave", is_paid=True)
    expense_type = ExpenseType(id=str(uuid.uuid4()), name="Travel", claim_type="REIMBURSABLE")
    asset_category = AssetCategory(id=str(uuid.uuid4()), name="Laptops")
    ticket_category = TicketCategory(id=str(uuid.uuid4()), name="Bug Report")
    customer_status = CustomerStatus(id=str(uuid.uuid4()), name="Active")
    work_week = WorkWeekPolicy(
        id=str(uuid.uuid4()), policy_name="Standard 5-day", applies_to="COMPANY_WIDE",
        effective_from=FY_START, gross_hours_per_day=Decimal("9.00"),
        unpaid_break_hours=Decimal("1.00"), weekly_hour_target=Decimal("40.00"),
        weekly_off_days="SUN", saturday_rule="ALL_OFF",
    )
    pay_cycle = PayCycle(
        id=str(uuid.uuid4()), cycle_type="CALENDAR_MONTH", salary_credit_day=1, effective_from=FY_START,
    )
    db_session.add_all(
        [fy, department, designation, employment_type, leave_type, expense_type, asset_category,
         ticket_category, customer_status, work_week, pay_cycle]
    )
    await db_session.flush()

    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-SCOPE", financial_year_id=fy.id,
        company_name="Northwind Traders", status_id=customer_status.id,
    )
    db_session.add(customer)

    def _employee(user: User, code: str, first_name: str, manager_id: str | None) -> Employee:
        return Employee(
            id=str(uuid.uuid4()), employee_code=code, code_financial_year_id=fy.id,
            first_name=first_name, email=f"{code.lower()}@scope.enforcement",
            department_id=department.id, designation_id=designation.id,
            employment_type_id=employment_type.id, joining_date=FY_START - timedelta(days=500),
            user_id=user.id, reporting_manager_id=manager_id, employment_status="ACTIVE",
        )

    manager_employee = _employee(manager_user, "EMP-MGR", "Vikram", None)
    db_session.add(manager_employee)
    await db_session.flush()
    # The real reporting line — 'team' means direct reports, resolved from
    # this column by org_scope.get_direct_report_employee_ids. Faking it with
    # a query parameter would prove nothing about how scope resolves.
    report_employee = _employee(report_user, "EMP-RPT", "Arun", manager_employee.id)
    outsider_employee = _employee(outsider_user, "EMP-OUT", "Kiran", None)
    db_session.add_all([report_employee, outsider_employee])
    await db_session.flush()

    mine, theirs = report_employee, outsider_employee
    seeded: dict[str, str] = {
        "report_employee_id": mine.id,
        "outsider_employee_id": theirs.id,
        "manager_employee_id": manager_employee.id,
        # Both employees sit in the SAME department and every ticket below is
        # raised by the SAME user, so ?department_id=/?raised_by= name a set
        # that spans the scope boundary — which is what makes them a real
        # widening attempt in test_no_filter_parameter_widens_a_scoped_list
        # rather than a filter that happens to select nothing.
        "shared_department_id": department.id,
        "shared_raiser_user_id": super_admin.id,
    }

    # ------------------------------------------ one row each, per screen
    for tag, employee in (("mine", mine), ("theirs", theirs)):
        expense = ExpenseClaim(
            id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
            expense_type_id=expense_type.id, claim_type="REIMBURSABLE",
            expense_type_name_snapshot=expense_type.name, amount=Decimal("2500.00"),
            expense_date=TODAY - timedelta(days=7), description=f"cab fare ({tag})",
            status="PENDING", submitted_at=NOW,
        )
        leave = LeaveRequest(
            id=str(uuid.uuid4()), employee_id=employee.id, leave_type_id=leave_type.id,
            financial_year_id=fy.id, from_date=TODAY + timedelta(days=5),
            to_date=TODAY + timedelta(days=6), days_requested=Decimal("2.00"),
            working_days_basis_policy_id=work_week.id, reason=f"family function ({tag})",
            paid_type_snapshot="PAID", status="PENDING", routed_to_role="MANAGER",
            routing_reason="Reporting manager approves", applied_at=NOW,
        )
        balance = LeaveBalance(
            id=str(uuid.uuid4()), employee_id=employee.id, leave_type_id=leave_type.id,
            financial_year_id=fy.id, allowed_days=Decimal("12.00"),
            default_annual_quota_snapshot=Decimal("12.00"),
        )
        attendance = AttendanceRecord(
            id=str(uuid.uuid4()), employee_id=employee.id, attendance_date=TODAY - timedelta(days=2),
            financial_year_id=fy.id, work_week_policy_id=work_week.id,
            policy_name_snapshot=work_week.policy_name, day_type="WORKING",
            recorded_by_label="Biometric",
        )
        asset = Asset(
            id=str(uuid.uuid4()), asset_tag=f"AST-{tag.upper()}", financial_year_id=fy.id,
            name=f"ThinkPad ({tag})", category_id=asset_category.id, purchase_date=FY_START,
            purchase_value=Decimal("120000.00"), useful_life_years=3, status="ASSIGNED",
            assigned_to=employee.id, department_id=department.id,
        )
        ticket = Ticket(
            id=str(uuid.uuid4()), ticket_number=f"TKT-{tag.upper()}", financial_year_id=fy.id,
            customer_id=customer.id, category_id=ticket_category.id, subject=f"Login fails ({tag})",
            description="A user cannot sign in", raised_by=super_admin.id,
            raised_date=TODAY - timedelta(days=4), assigned_to=employee.id, status="OPEN",
            priority="HIGH",
        )
        project = Project(
            id=str(uuid.uuid4()), project_code=f"PRJ-{tag.upper()}", financial_year_id=fy.id,
            project_name=f"Apollo ({tag})", customer_id=customer.id, project_lead_id=employee.id,
            status="IN_PROGRESS", budget=Decimal("500000.00"),
        )
        resignation = Resignation(
            id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
            last_working_day=TODAY + timedelta(days=45), submitted_at=NOW,
            submitted_by_user_id=super_admin.id, status="SUBMITTED",
        )
        db_session.add_all([expense, leave, balance, attendance, asset, ticket, project, resignation])
        await db_session.flush()

        db_session.add_all(
            [
                ProjectMember(id=str(uuid.uuid4()), project_id=project.id, employee_id=employee.id),
                TimesheetEntry(
                    id=str(uuid.uuid4()), project_id=project.id, employee_id=employee.id,
                    entry_date=TODAY - timedelta(days=1), hours=Decimal("7.50"),
                ),
            ]
        )
        asset_request = AssetRequest(
            id=str(uuid.uuid4()), asset_id=asset.id, employee_id=employee.id,
            request_type="REPAIR", description=f"keyboard sticking ({tag})", status="PENDING",
        )
        maintenance = AssetMaintenanceLog(
            id=str(uuid.uuid4()), asset_id=asset.id, log_date=TODAY - timedelta(days=30),
            description=f"battery replaced ({tag})", cost=Decimal("4500.00"),
        )
        comp_hours = CompensatoryHourRequest(
            id=str(uuid.uuid4()), request_number=f"COMP-{tag.upper()}", employee_id=employee.id,
            financial_year_id=fy.id, shortfall_attendance_record_id=attendance.id,
            shortfall_date=attendance.attendance_date, hours_short=Decimal("2.00"),
            day_status_at_request="SHORTFALL", shortfall_reason=f"power outage ({tag})",
            make_up_date=TODAY + timedelta(days=3), make_up_day_type="WEEKEND",
            work_week_policy_id=work_week.id, hours_to_work=Decimal("2.00"),
            compensation_window_days_snapshot=30,
            window_last_permissible_date=TODAY + timedelta(days=28),
            uncompensated_shortfall_becomes_snapshot="LOP", routed_to_role="MANAGER",
            routing_reason="Reporting manager approves", status="PENDING",
        )
        payroll_run = PayrollRun(
            id=str(uuid.uuid4()), financial_year_id=fy.id, period_month=PERIOD_MONTH,
            period_year=PERIOD_YEAR, pay_period_start=TODAY.replace(day=1), pay_period_end=TODAY,
            salary_credit_date=TODAY, pay_cycle_type_snapshot="CALENDAR_MONTH",
            salary_credit_day_snapshot=1, total_days_in_period=Decimal("30.00"),
            working_days_auto=Decimal("22.00"), employee_selection_mode="ALL",
            run_by=super_admin.id, run_on=NOW,
        )
        db_session.add_all([asset_request, maintenance, comp_hours, payroll_run])
        await db_session.flush()
        run_employee = PayrollRunEmployee(
            id=str(uuid.uuid4()), payroll_run_id=payroll_run.id, employee_id=employee.id,
            financial_year_id=fy.id, period_month=PERIOD_MONTH, period_year=PERIOD_YEAR,
            total_days_in_period=Decimal("30.00"), working_days=Decimal("22.00"), calculated_at=NOW,
        )
        db_session.add(run_employee)
        await db_session.flush()
        payslip = Payslip(
            id=str(uuid.uuid4()), payroll_run_id=payroll_run.id, payroll_run_employee_id=run_employee.id,
            employee_id=employee.id, financial_year_id=fy.id, pay_period_start=payroll_run.pay_period_start,
            pay_period_end=payroll_run.pay_period_end, salary_credit_date=payroll_run.salary_credit_date,
            pay_cycle_type_snapshot="CALENDAR_MONTH", salary_credit_day_snapshot=1,
            period_month=PERIOD_MONTH, period_year=PERIOD_YEAR,
            employee_code_snapshot=employee.employee_code, employee_name_snapshot=employee.first_name,
            generated_at=NOW, generated_by=super_admin.id,
        )
        db_session.add(payslip)
        await db_session.flush()

        seeded.update(
            {
                f"expense_{tag}": expense.id, f"leave_{tag}": leave.id, f"balance_{tag}": balance.id,
                f"attendance_{tag}": attendance.id, f"asset_{tag}": asset.id, f"ticket_{tag}": ticket.id,
                f"project_{tag}": project.id, f"resignation_{tag}": resignation.id,
                f"asset_request_{tag}": asset_request.id, f"maintenance_{tag}": maintenance.id,
                f"comp_{tag}": comp_hours.id, f"payslip_{tag}": payslip.id,
            }
        )
        seeded[f"timesheet_{tag}"] = (
            await db_session.execute(
                TimesheetEntry.__table__.select().where(TimesheetEntry.employee_id == employee.id)
            )
        ).first().id

    await db_session.commit()
    # Detached and fully loaded: the client fixture expires the shared session
    # once per request, and get_current_user hands one of these straight back,
    # so an attached User would lazy-load role_id inside resolve_permission and
    # raise MissingGreenlet. Same fix as tests/api/test_finance_flows.py.
    actors = {
        "SUPER_ADMIN": super_admin, "MANAGER": manager_user,
        "EMPLOYEE": report_user, "OUTSIDER": outsider_user,
    }
    for user in actors.values():
        db_session.expunge(user)
    return {"ids": seeded, "actors": actors}


# ==================================================================== helpers
# RBAC Invariant 5: "role scope is applied before filters, always". A filter
# naming the out-of-scope employee, their department, or the user who raised
# both rows may only ever NARROW what scope already allowed. Which of these an
# endpoint accepts is read off the live schema rather than hardcoded, so a
# filter added tomorrow is attacked automatically.
WIDENING_VALUES = {
    "employee_id": "outsider_employee_id",
    "assigned_to": "outsider_employee_id",
    "department_id": "shared_department_id",
    "raised_by": "shared_raiser_user_id",
}


def _widening_params(path: str) -> list[str]:
    operation = SPEC["paths"][path]["get"]
    return [p["name"] for p in operation.get("parameters", []) if p["name"] in WIDENING_VALUES]


def _values(body, key: str) -> set[str]:
    """The `key` of every object in a list response."""
    assert isinstance(body, list), f"expected a JSON array, got {type(body).__name__}: {str(body)[:120]}"
    return {row[key] for row in body if isinstance(row, dict) and key in row}


async def _check(client, world, case: ScopeCase) -> list[str]:
    """Runs one case and returns its failures (never raises), so a single run
    reports every leak rather than stopping at the first.

    THE CONTROL FETCH is what keeps "the other row isn't in my list" from
    passing vacuously, and which control is correct depends on the endpoint:

      SUPER_ADMIN — for a company-wide list ('full' mode shows everything).
        Both seeded rows must come back, proving the withheld row exists and
        that this endpoint is capable of returning it.
      OUTSIDER — for the self-service "my ..." endpoints, where a Super Admin
        fetch returns the SUPER ADMIN's own (empty) rows and so proves
        nothing. Instead the out-of-scope employee fetches the same endpoint
        themselves: their row must come back to THEM, which proves it exists
        and is reachable, and the actor's row must not — the same withholding
        asserted in the opposite direction.
    """
    failures: list[str] = []
    url = f"{case.path}?{case.query}" if case.query else case.path
    mine, theirs = world["ids"][case.mine_key], world["ids"][case.theirs_key]

    _as(world["actors"]["SUPER_ADMIN" if case.control == "SUPER_ADMIN" else "OUTSIDER"])
    control = await client.get(url)
    if control.status_code != 200:
        return [f"{case.label}: the {case.control} control fetch failed ({control.status_code} {control.text[:120]})"]
    control_rows = _values(control.json(), case.key)

    if case.control == "SUPER_ADMIN":
        if not {mine, theirs} <= control_rows:
            return [
                f"{case.label}: the fixture is not proving anything — Super Admin sees "
                f"{sorted(control_rows & {mine, theirs})} of the two seeded rows"
            ]
    else:
        if theirs not in control_rows:
            return [
                f"{case.label}: the fixture is not proving anything — the out-of-scope employee "
                "cannot see their own row on this endpoint either, so withholding it proves nothing"
            ]
        if mine in control_rows:
            failures.append(
                f"{case.label}: SCOPE LEAK (mirrored) — the out-of-scope employee's own fetch "
                f"returned the actor's row (enforced by {case.enforced_by})"
            )

    _as(world["actors"][case.role])
    scoped = await client.get(url)
    if scoped.status_code != 200:
        return [f"{case.label}: the scoped actor could not read their own screen ({scoped.status_code} {scoped.text[:120]})"]
    returned = _values(scoped.json(), case.key)
    if mine not in returned:
        failures.append(f"{case.label}: their OWN row is missing from their own list")
    if theirs in returned:
        failures.append(
            f"{case.label}: SCOPE LEAK — the out-of-scope row is in the response "
            f"(enforced by {case.enforced_by})"
        )
    if case.control == "SUPER_ADMIN" and not returned <= control_rows:
        failures.append(f"{case.label}: returned rows Super Admin cannot see: {sorted(returned - control_rows)}")
    return failures


# ====================================================================== tests
def test_every_case_names_a_scope_the_product_actually_ships():
    """Guard the table. A case claiming EMPLOYEE is 'own' on a screen that
    ships 'full' would assert a restriction nobody implemented — and one
    claiming 'full' where the product ships 'none' would 404 and look like a
    passing scope test. Checked against BOTH the shipped seed table and the
    policy conftest actually seeds, since a divergence between those two would
    silently change what these tests are exercising.
    """
    wrong: list[str] = []
    for case in ALL_CASES:
        shipped = SCREEN_PERMISSIONS.get(case.screen, {}).get(case.role)
        seeded = CANONICAL_SCREEN_MODE.get(case.screen, {}).get(case.role)
        if shipped != case.mode:
            wrong.append(f"{case.label}: app/seed.py ships mode {shipped!r}, not {case.mode!r}")
        if seeded != case.mode:
            wrong.append(f"{case.label}: conftest seeds mode {seeded!r}, not {case.mode!r}")
    assert not wrong, "the scope table disagrees with the shipped policy:\n  " + "\n  ".join(wrong)

    # Both halves of the brief have to be genuinely covered, not quietly
    # emptied by a future edit.
    assert len(EMPLOYEE_CASES) >= 10, "the 'own' half of this file has been gutted"
    assert len(MANAGER_CASES) >= 6, "the 'team'/'view_team' half of this file has been gutted"
    assert {c.enforced_by for c in ALL_CASES} == {BY_APPLY_SCOPE, BY_THE_ROUTE}, (
        "both enforcement mechanisms must stay covered"
    )


async def test_the_reporting_line_the_team_cases_depend_on_is_real(db_session, world):
    """'team' resolves through Employee.reporting_manager_id, so if the
    fixture ever stopped setting it the Manager cases would still pass — by
    returning nothing at all, for the wrong reason.
    """
    from app.services.org_scope import get_direct_report_employee_ids

    reports = await get_direct_report_employee_ids(db_session, world["ids"]["manager_employee_id"])
    assert reports == [world["ids"]["report_employee_id"]], (
        "the Manager must have exactly one direct report, and the out-of-scope employee must not be it"
    )


async def test_an_employee_sees_only_their_own_rows(client, world):
    """The 'own' half: expenses, leave, payslips, projects, tickets, assets,
    timesheets, attendance, resignation and compensatory hours — each proven
    against a Super Admin fetch of the very same endpoint.
    """
    failures: list[str] = []
    for case in EMPLOYEE_CASES:
        failures += await _check(client, world, case)
    assert not failures, "an 'own'-scoped role saw rows that are not theirs:\n  " + "\n  ".join(failures)


async def test_a_manager_sees_only_their_direct_reports_rows(client, world):
    """The 'team'/'view_team' half. The Manager's team is one real direct
    report (Employee.reporting_manager_id, asserted above); the other employee
    reports to nobody, so a row of theirs appearing here is a genuine leak and
    not an artefact of the fixture.
    """
    failures: list[str] = []
    for case in MANAGER_CASES:
        failures += await _check(client, world, case)
    assert not failures, "a 'team'-scoped Manager saw rows outside their team:\n  " + "\n  ".join(failures)


async def test_no_filter_parameter_widens_a_scoped_list(client, world):
    """RBAC Invariant 5, on this file's own endpoints: "role scope is applied
    before filters, always".

    An endpoint that applied `?employee_id=` INSTEAD of scope — rather than on
    top of it — would pass every assertion above (the unfiltered list is
    correctly narrow) and still hand a scoped caller anyone's rows on request.
    The filters attempted are read off the live schema, and the values name the
    OUT-OF-SCOPE side on purpose: the outsider's employee id, the department
    both employees share, and the user who raised both tickets.
    """
    failures: list[str] = []
    attempted = 0
    for case in ALL_CASES:
        params = _widening_params(case.path)
        if not params:
            continue
        theirs = world["ids"][case.theirs_key]
        _as(world["actors"][case.role])
        base_url = f"{case.path}?{case.query}" if case.query else case.path
        baseline_response = await client.get(base_url)
        if baseline_response.status_code != 200:
            failures.append(f"{case.label}: baseline fetch failed ({baseline_response.status_code})")
            continue
        baseline = _values(baseline_response.json(), case.key)
        for name in params:
            value = world["ids"][WIDENING_VALUES[name]]
            joiner = "&" if "?" in base_url else "?"
            response = await client.get(f"{base_url}{joiner}{name}={value}")
            attempted += 1
            if response.status_code != 200:
                failures.append(f"{case.label} ?{name}= -> {response.status_code} {response.text[:100]}")
                continue
            returned = _values(response.json(), case.key)
            if theirs in returned:
                failures.append(
                    f"{case.label}: SCOPE LEAK via ?{name}={value} — the out-of-scope row came back"
                )
            if not returned <= baseline:
                failures.append(
                    f"{case.label}: ?{name}= widened the row set with {sorted(returned - baseline)}"
                )
    assert attempted >= 8, (
        f"only {attempted} widening attempts were made — the schema walk that finds filter "
        "parameters has stopped finding them, and this test is no longer attacking anything"
    )
    assert not failures, "a filter parameter reached past scope:\n  " + "\n  ".join(failures)
