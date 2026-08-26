"""Toggle-gated Expense business logic (12-expense-module.md §6.1) — API-level
tests against the real routes in app/api/v1/expenses.py:
  - "Set an Auto-Approval Threshold" (create_expense_claim)
  - "Allow Manager to Approve Their Team's Expenses" (list_pending_approvals,
    manager_approve_expense_claim, approve_expense_claim's
    _manager_approval_required gate)
  - "Require a Receipt Before Approval" (_assert_receipt_present_if_required,
    checked in both approve() and manager_approve())
  - reject_expense_claim's PENDING/MGR_APPROVED acceptance and its
    already-existing blank-reason rejection.

Reuses tests/conftest.py's own db_session + seed_canonical exactly the way
tests/rbac/test_matrix.py already does (a fresh in-memory SQLite per test —
db_session is function-scoped, so nothing here needs to reset FeatureToggle
rows between tests). What's new here is wiring app.main's real FastAPI app
through an httpx.AsyncClient with get_db/get_current_user overridden onto
that same session, since no route-level (TestClient/AsyncClient) test
harness existed anywhere in this suite yet — every existing test file only
exercises pure functions (tests/services/*) or the resolver directly
(tests/rbac/*).

Foreign keys are not enforced on the SQLite test engine (confirmed: an
Employee row with department_id/designation_id/employment_type_id pointing
at nothing still inserts cleanly), so master-data rows this module's routes
never actually look up (Department, Designation, EmploymentType, Vendor,
TaxHead) are deliberately not created — only what create_expense_claim etc.
actually queries (ExpenseType, FinancialYear, Employee, FeatureToggle) is
seeded.
"""

import uuid
from datetime import date

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
import pytest_asyncio

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.employee import Employee
from app.models.masters import ExpenseType
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.rbac import FeatureToggle
from tests.conftest import seed_canonical


# ================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session):
    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    """Overrides get_current_user for every request the `client` fixture
    makes from here on, in this test — the same app-level override every
    require_screen() dependency (and get_current_user itself) resolves
    through, regardless of which router pulled it in.
    """
    app.dependency_overrides[get_current_user] = lambda: user


# =========================================================== shared scaffolding
async def _seed_base(db_session):
    """The CANONICAL RBAC policy (so approve/reject/manager-approve are
    gated exactly like production) plus a current Financial Year and one
    Reimbursable Expense Type — the minimum every test below needs before
    it can even call POST /expenses.
    """
    ids = await seed_canonical(db_session)
    users = {code: await db_session.get(User, ids[f"user:{code}"]) for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")}

    fy = FinancialYear(id=str(uuid.uuid4()), label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True)
    db_session.add(fy)
    expense_type = ExpenseType(id=str(uuid.uuid4()), name="Travel", short_code="TRV", claim_type="REIMBURSABLE", is_recurring=False)
    db_session.add(expense_type)
    await db_session.commit()
    return ids, users, expense_type, fy


async def _make_employee(db_session, fy: FinancialYear, user: User, *, reporting_manager_id: str | None = None) -> Employee:
    """Links `user` to a new Employee row — required before that user can
    submit a claim at all (create_expense_claim 404s with no linked
    Employee), and, when `reporting_manager_id` is set, makes them a direct
    report for the manager-approval scoping tests (org_scope.py: 'team' is
    reporting_manager_id, direct reports only).
    """
    tag = uuid.uuid4().hex[:8]
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{tag}", code_financial_year_id=fy.id,
        first_name=user.full_name, email=f"{tag}@test.local", department_id="dept-1",
        designation_id="desig-1", employment_type_id="emptype-1", joining_date=date(2020, 1, 1),
        reporting_manager_id=reporting_manager_id, user_id=user.id,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


async def _make_extra_user(db_session, ids: dict, role_code: str, label: str) -> User:
    """seed_canonical creates exactly ONE user per role — several tests below
    need two distinct people holding the same role (e.g. two different
    direct reports, or an Employee who reports to nobody involved in the
    test), so this mints another login against the role seed_canonical
    already seeded permissions for.
    """
    user = User(id=str(uuid.uuid4()), email=f"{label}@test.local", password_hash="x", full_name=label, role_id=ids[f"role:{role_code}"])
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _set_toggle(db_session, toggle_key: str, *, enabled: bool, numeric_value=None) -> None:
    """Flips a FeatureToggle row directly via the test DB session — the same
    session the `client` fixture's get_db override hands to every route
    call, so a route's `select(FeatureToggle...)` sees this immediately.
    Absence of a row is equivalent to OFF (app/api/v1/expenses.py's
    _toggle_enabled: scalar_one_or_none() -> None -> bool(None) == False),
    so tests only call this for the toggle(s) they actually need ON, or to
    explicitly reconfirm the OFF default.
    """
    row = (await db_session.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    if row is None:
        row = FeatureToggle(id=str(uuid.uuid4()), toggle_key=toggle_key, module_key="expense", label=toggle_key, enabled=enabled, default_enabled=enabled, numeric_value=numeric_value)
        db_session.add(row)
    else:
        row.enabled = enabled
        row.numeric_value = numeric_value
    await db_session.commit()


async def _submit_claim(client: AsyncClient, expense_type_id: str, amount, *, has_receipt: bool = False) -> dict:
    body = {
        "expense_type_id": expense_type_id, "amount": str(amount), "expense_date": date.today().isoformat(),
        "description": "test expense",
    }
    if has_receipt:
        body["receipt_stored_file_id"] = str(uuid.uuid4())
    resp = await client.post("/api/v1/expenses", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ============================================ 1/2/3 — Auto-Approval Threshold
async def test_auto_approval_at_or_under_threshold_lands_approved_when_toggle_on(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Set an Auto-Approval Threshold", enabled=True, numeric_value="1000.00")
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    _as(users["EMPLOYEE"])
    at_threshold = await _submit_claim(client, expense_type.id, "1000.00")
    assert at_threshold["status"] == "APPROVED"
    assert at_threshold["approved_by"] is None, "the threshold approved it, not a person — approved_by must stay null"
    assert at_threshold["approved_at"] is not None

    under_threshold = await _submit_claim(client, expense_type.id, "400.00")
    assert under_threshold["status"] == "APPROVED"
    assert under_threshold["approved_by"] is None


async def test_auto_approval_over_threshold_stays_pending(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Set an Auto-Approval Threshold", enabled=True, numeric_value="1000.00")
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    _as(users["EMPLOYEE"])
    claim = await _submit_claim(client, expense_type.id, "1000.01")
    assert claim["status"] == "PENDING"
    assert claim["approved_by"] is None
    assert claim["approved_at"] is None


async def test_auto_approval_toggle_off_stays_pending_even_under_threshold(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    # Toggle explicitly OFF, with a numeric_value configured (as if it had
    # been set once and then switched off) — proves the amount comparison is
    # gated behind `enabled`, not just behind numeric_value being non-null.
    await _set_toggle(db_session, "Set an Auto-Approval Threshold", enabled=False, numeric_value="1000.00")
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    _as(users["EMPLOYEE"])
    claim = await _submit_claim(client, expense_type.id, "50.00")
    assert claim["status"] == "PENDING"


# ============================== 4 — Manager-approval toggle OFF (the default)
async def test_manager_approval_toggle_off_hides_approvals_from_manager_and_accountant_approves_directly(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    _as(users["MANAGER"])
    resp = await client.get("/api/v1/expenses/approvals")
    assert resp.status_code == 404, "expense.approvals must be invisible (404) to Manager while the toggle is off"

    _as(users["EMPLOYEE"])
    claim = await _submit_claim(client, expense_type.id, "300.00")
    assert claim["status"] == "PENDING"

    _as(users["ACCOUNTANT"])
    resp = await client.post(f"/api/v1/expenses/{claim['id']}/approve")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "APPROVED"


# ============================ 5 — Manager-approval toggle ON, scoped to team
async def test_manager_approval_toggle_on_scopes_to_direct_reports_only(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Allow Manager to Approve Their Team's Expenses", enabled=True)

    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-a")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)
    outsider_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "outsider-a")
    await _make_employee(db_session, fy, outsider_user)  # no reporting_manager_id — not this manager's report

    _as(report_user)
    report_claim = await _submit_claim(client, expense_type.id, "200.00")

    _as(outsider_user)
    outsider_claim = await _submit_claim(client, expense_type.id, "200.00")

    _as(users["MANAGER"])
    denied = await client.post(f"/api/v1/expenses/{outsider_claim['id']}/manager-approve")
    assert denied.status_code == 404, "a claim belonging to a non-report must not be reachable by this manager"

    approved = await client.post(f"/api/v1/expenses/{report_claim['id']}/manager-approve")
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["status"] == "MGR_APPROVED"
    assert body["manager_approved_by"] == users["MANAGER"].id


# ========================= 6 — Accountant approve() gated behind manager step
async def test_accountant_approve_requires_prior_manager_signoff_when_required(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Allow Manager to Approve Their Team's Expenses", enabled=True)

    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-b")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    signed_off_claim = await _submit_claim(client, expense_type.id, "200.00")
    still_pending_claim = await _submit_claim(client, expense_type.id, "250.00")

    _as(users["MANAGER"])
    mgr_resp = await client.post(f"/api/v1/expenses/{signed_off_claim['id']}/manager-approve")
    assert mgr_resp.status_code == 200, mgr_resp.text

    _as(users["ACCOUNTANT"])
    ok = await client.post(f"/api/v1/expenses/{signed_off_claim['id']}/approve")
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "APPROVED"

    conflict = await client.post(f"/api/v1/expenses/{still_pending_claim['id']}/approve")
    assert conflict.status_code == 409, "still-Pending under a required manager step must not be directly approvable"


# ========================================= 7 — Require a Receipt Before Approval
async def test_receipt_required_toggle_blocks_approve_and_manager_approve_without_a_receipt(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Require a Receipt Before Approval", enabled=True)
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    # -- Accountant's own approve() (no manager step involved here) --
    _as(users["EMPLOYEE"])
    no_receipt_claim = await _submit_claim(client, expense_type.id, "150.00", has_receipt=False)

    _as(users["ACCOUNTANT"])
    blocked = await client.post(f"/api/v1/expenses/{no_receipt_claim['id']}/approve")
    assert blocked.status_code == 422

    await _set_toggle(db_session, "Require a Receipt Before Approval", enabled=False)
    allowed = await client.post(f"/api/v1/expenses/{no_receipt_claim['id']}/approve")
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["status"] == "APPROVED"

    # -- manager_approve(), same gate, re-enabled --
    await _set_toggle(db_session, "Require a Receipt Before Approval", enabled=True)
    await _set_toggle(db_session, "Allow Manager to Approve Their Team's Expenses", enabled=True)
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-c")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    no_receipt_report_claim = await _submit_claim(client, expense_type.id, "175.00", has_receipt=False)
    with_receipt_report_claim = await _submit_claim(client, expense_type.id, "175.00", has_receipt=True)

    _as(users["MANAGER"])
    mgr_blocked = await client.post(f"/api/v1/expenses/{no_receipt_report_claim['id']}/manager-approve")
    assert mgr_blocked.status_code == 422

    mgr_allowed = await client.post(f"/api/v1/expenses/{with_receipt_report_claim['id']}/manager-approve")
    assert mgr_allowed.status_code == 200, mgr_allowed.text
    assert mgr_allowed.json()["status"] == "MGR_APPROVED"


# ============================================== 8 — reject() accepts both statuses
async def test_reject_accepts_pending_or_manager_approved(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, "Allow Manager to Approve Their Team's Expenses", enabled=True)

    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-d")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    pending_claim = await _submit_claim(client, expense_type.id, "100.00")
    mgr_approved_claim = await _submit_claim(client, expense_type.id, "120.00")

    _as(users["MANAGER"])
    mgr_resp = await client.post(f"/api/v1/expenses/{mgr_approved_claim['id']}/manager-approve")
    assert mgr_resp.status_code == 200, mgr_resp.text
    assert mgr_resp.json()["status"] == "MGR_APPROVED"

    _as(users["ACCOUNTANT"])
    reject_pending = await client.post(f"/api/v1/expenses/{pending_claim['id']}/reject", json={"rejection_reason": "Not a valid receipt"})
    assert reject_pending.status_code == 200, reject_pending.text
    assert reject_pending.json()["status"] == "REJECTED"

    reject_mgr_approved = await client.post(f"/api/v1/expenses/{mgr_approved_claim['id']}/reject", json={"rejection_reason": "Duplicate claim"})
    assert reject_mgr_approved.status_code == 200, reject_mgr_approved.text
    assert reject_mgr_approved.json()["status"] == "REJECTED"


# ==================================== 9 — blank rejection_reason always rejected
async def test_reject_blank_reason_rejected_regardless_of_toggle_state(db_session, client):
    ids, users, expense_type, fy = await _seed_base(db_session)
    # Both other toggles ON, to confirm the blank-reason check is independent
    # of them (reject_expense_claim never consults either one).
    await _set_toggle(db_session, "Allow Manager to Approve Their Team's Expenses", enabled=True)
    await _set_toggle(db_session, "Require a Receipt Before Approval", enabled=True)
    await _make_employee(db_session, fy, users["EMPLOYEE"])

    _as(users["EMPLOYEE"])
    claim = await _submit_claim(client, expense_type.id, "90.00")

    _as(users["ACCOUNTANT"])
    resp = await client.post(f"/api/v1/expenses/{claim['id']}/reject", json={"rejection_reason": "   "})
    assert resp.status_code == 422
