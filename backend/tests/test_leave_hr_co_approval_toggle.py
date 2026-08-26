"""Leave §6.2 "Require HR Co-Approval for Leave Longer Than X Days" —
API-level tests against the real routes in app/api/v1/leave_requests.py:
  - toggle OFF (the default): a long request still finalizes on ONE decision,
    byte-for-byte the behaviour that shipped before this toggle did anything
  - toggle ON, request OVER the threshold: the first approver's decision no
    longer completes the approval — the request stays PENDING, its days stay
    held in pending_days, and only HR's co-approval grants it
  - toggle ON, request AT or UNDER the threshold: completely unaffected

Same harness as tests/test_expense_toggles.py (whose docstring explains the
httpx.AsyncClient + get_db/get_current_user override setup and why master
data the routes never look up is deliberately not seeded) — this file follows
it deliberately, since the feature under test is modelled on Expense's own
two-step approval.

The two Work Week Policies below are the reason no test here hand-computes a
day count: `days_requested` is whatever leave_engine.calculate_working_days
put on the row, so a NONE/ALL_WORKING policy makes working days equal
calendar days (readable assertions), while the SAT_SUN/ALL_OFF policy in
test_threshold_compares_working_days_not_calendar_days proves the threshold
is compared against the engine's number and not against (to_date - from_date).
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.employee import Employee
from app.models.leave import LeaveBalance
from app.models.masters import LeaveType, WorkWeekPolicy
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.rbac import FeatureToggle
from tests.conftest import seed_canonical

TOGGLE = "Require HR Co-Approval for Leave Longer Than X Days"


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
    app.dependency_overrides[get_current_user] = lambda: user


# ========================================================= shared scaffolding
async def _seed_base(db_session, *, weekly_off_days: str = "NONE", saturday_rule: str = "ALL_WORKING"):
    """Canonical RBAC policy (so decide/hr-co-approve are gated exactly as in
    production), a current Financial Year, one quota-tracked Leave Type with
    room for every request these tests file, and one COMPANY_WIDE Work Week
    Policy — apply_for_leave 409s outright if no policy covers the employee.
    """
    ids = await seed_canonical(db_session)
    users = {code: await db_session.get(User, ids[f"user:{code}"]) for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")}

    fy = FinancialYear(id=str(uuid.uuid4()), label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True)
    db_session.add(fy)
    leave_type = LeaveType(
        id=str(uuid.uuid4()), name="Earned Leave", short_code="EL", is_paid=True,
        default_annual_quota_days=Decimal("60"), carry_forward_allowed=False, is_quota_tracked=True, is_active=True,
    )
    db_session.add(leave_type)
    db_session.add(WorkWeekPolicy(
        id=str(uuid.uuid4()), policy_name=f"Company Wide {uuid.uuid4().hex[:6]}", applies_to="COMPANY_WIDE",
        effective_from=date(2020, 1, 1), gross_hours_per_day=Decimal("9"), unpaid_break_hours=Decimal("1"),
        grace_window_minutes=0, weekly_hour_target=Decimal("40"), weekly_off_days=weekly_off_days,
        saturday_rule=saturday_rule, mandatory_holiday_overrides_saturday=True, is_active=True,
    ))
    await db_session.commit()
    return ids, users, leave_type, fy


async def _make_employee(db_session, fy: FinancialYear, user: User, *, reporting_manager_id: str | None = None) -> Employee:
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
    user = User(id=str(uuid.uuid4()), email=f"{label}@test.local", password_hash="x", full_name=label, role_id=ids[f"role:{role_code}"])
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _set_toggle(db_session, *, enabled: bool, numeric_value=None) -> None:
    """Flips the FeatureToggle row on the same session the `client` fixture
    hands every route call, so the route's own live read sees it immediately.
    An absent row is equivalent to OFF (_toggle_enabled: None -> False), so
    tests only call this to turn it ON or to explicitly reconfirm OFF.
    """
    row = (await db_session.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == TOGGLE))).scalar_one_or_none()
    if row is None:
        db_session.add(FeatureToggle(
            id=str(uuid.uuid4()), toggle_key=TOGGLE, module_key="leave", label=TOGGLE,
            enabled=enabled, default_enabled=False, numeric_value=numeric_value,
        ))
    else:
        row.enabled = enabled
        row.numeric_value = numeric_value
    await db_session.commit()


async def _apply(client: AsyncClient, leave_type_id: str, from_date: date, to_date: date) -> dict:
    resp = await client.post("/api/v1/leave/requests", json={
        "leave_type_id": leave_type_id, "from_date": from_date.isoformat(), "to_date": to_date.isoformat(),
        "is_half_day": False, "reason": "Family trip",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _balance(db_session, employee_id: str) -> LeaveBalance:
    row = (await db_session.execute(select(LeaveBalance).where(LeaveBalance.employee_id == employee_id))).scalar_one()
    await db_session.refresh(row)
    return row


# ============================================ 1 — toggle OFF (the default)
async def test_toggle_off_long_leave_still_approves_on_one_decision(db_session, client):
    """The critical no-regression case: the default path must be exactly what
    it was before this feature existed. The toggle is set explicitly OFF but
    WITH a threshold configured (as if it had been set once and switched off
    again), which proves the day comparison is gated behind `enabled` and not
    merely behind numeric_value being non-null.
    """
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=False, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-off")
    report = await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    request = await _apply(client, leave_type.id, date(2026, 6, 1), date(2026, 6, 10))
    assert request["days_requested"] == "10.00"
    assert request["hr_co_approval_required"] is False

    _as(users["MANAGER"])
    resp = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "APPROVED", "toggle OFF: one manager decision must still be final, however long the leave"
    assert body["hr_co_approval_required"] is False
    assert body["hr_co_approved_by"] is None
    assert body["awaiting_hr_co_approval"] is False
    assert body["actioned_by"] == users["MANAGER"].id

    balance = await _balance(db_session, report.id)
    assert balance.taken_days == Decimal("10.00")
    assert balance.pending_days == Decimal("0.00")


# ================================ 2 — toggle ON, OVER the threshold
async def test_toggle_on_over_threshold_needs_the_hr_step_before_it_can_be_granted(db_session, client):
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-over")
    report = await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    request = await _apply(client, leave_type.id, date(2026, 6, 1), date(2026, 6, 10))
    assert request["days_requested"] == "10.00"

    # -- the manager's decision is now only the FIRST signature --
    _as(users["MANAGER"])
    first = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["status"] == "PENDING", "10 days over a 3-day threshold must not be granted on the manager's decision alone"
    assert body["hr_co_approval_required"] is True
    assert body["awaiting_hr_co_approval"] is True
    assert body["hr_co_approved_by"] is None
    assert body["actioned_by"] == users["MANAGER"].id
    assert body["routed_to_role"] == "HR", "it is waiting on HR now, so the queue must say so"

    # Nothing has been granted, so the days stay held in pending_days.
    balance = await _balance(db_session, report.id)
    assert balance.pending_days == Decimal("10.00")
    assert balance.taken_days == Decimal("0.00")

    # -- the first approver cannot simply decide it a second time --
    again = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert again.status_code == 409, "still-PENDING under an outstanding co-approval must not be re-decidable by the first approver"

    # -- HR's co-approval is what actually grants it --
    _as(users["HR"])
    co = await client.post(f"/api/v1/leave/approvals/{request['id']}/hr-co-approve")
    assert co.status_code == 200, co.text
    granted = co.json()
    assert granted["status"] == "APPROVED"
    assert granted["hr_co_approved_by"] == users["HR"].id
    assert granted["hr_co_approved_at"] is not None
    assert granted["awaiting_hr_co_approval"] is False
    assert granted["actioned_by"] == users["MANAGER"].id, "the co-signature has its own columns; it must not erase the first approver"

    balance = await _balance(db_session, report.id)
    assert balance.pending_days == Decimal("0.00")
    assert balance.taken_days == Decimal("10.00")


# ============================= 3 — toggle ON, AT or UNDER the threshold
async def test_toggle_on_at_or_under_threshold_is_unaffected(db_session, client):
    """"Longer Than X Days" read strictly — a request of exactly X is not
    longer than X, so it finalizes on one decision just like it does with the
    toggle off.
    """
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-under")
    report = await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    at_threshold = await _apply(client, leave_type.id, date(2026, 7, 1), date(2026, 7, 3))
    under_threshold = await _apply(client, leave_type.id, date(2026, 7, 6), date(2026, 7, 7))
    assert at_threshold["days_requested"] == "3.00"
    assert under_threshold["days_requested"] == "2.00"

    _as(users["MANAGER"])
    for request in (at_threshold, under_threshold):
        resp = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "APPROVED", f"{body['days_requested']} days is not longer than 3 — the extra step must not apply"
        assert body["hr_co_approval_required"] is False
        assert body["awaiting_hr_co_approval"] is False

    balance = await _balance(db_session, report.id)
    assert balance.taken_days == Decimal("5.00")
    assert balance.pending_days == Decimal("0.00")


# ================= 4 — the threshold counts what leave_engine counted
async def test_threshold_compares_working_days_not_calendar_days(db_session, client):
    """A Sat/Sun-off policy over a 7-calendar-day span that is only 5 WORKING
    days. With the threshold at 5 the request is unaffected — which it would
    not be if the comparison used (to_date - from_date) instead of the
    days_requested leave_engine.calculate_working_days produced.
    """
    ids, users, leave_type, fy = await _seed_base(db_session, weekly_off_days="SAT_SUN", saturday_rule="ALL_OFF")
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("5"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-workdays")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    # Thu 2026-06-04 .. Wed 2026-06-10 — 7 calendar days, 5 working days.
    request = await _apply(client, leave_type.id, date(2026, 6, 4), date(2026, 6, 10))
    assert request["days_requested"] == "5.00"
    assert (date(2026, 6, 10) - date(2026, 6, 4)).days + 1 == 7

    _as(users["MANAGER"])
    resp = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "APPROVED"
    assert resp.json()["hr_co_approval_required"] is False


# ======================================== 5 — HR's own decision is the signature
async def test_hr_deciding_directly_does_not_demand_a_second_hr_signature(db_session, client):
    """An applicant with no reporting manager routes to HR (leave_engine
    .resolve_routing rule 2). HR approving IS the HR sign-off, so the request
    finalizes in one step rather than waiting on a second HR desk.
    """
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    applicant_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "no-manager")
    await _make_employee(db_session, fy, applicant_user)  # no reporting_manager_id

    _as(applicant_user)
    request = await _apply(client, leave_type.id, date(2026, 8, 3), date(2026, 8, 14))
    assert request["days_requested"] == "12.00"
    assert request["routed_to_role"] == "HR"

    _as(users["HR"])
    resp = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "APPROVED"
    assert body["hr_co_approval_required"] is False
    assert body["actioned_by"] == users["HR"].id


# ================================= 6 — HR can still reject what is waiting
async def test_hr_rejecting_a_request_awaiting_co_approval_releases_the_held_days(db_session, client):
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-reject")
    report = await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    request = await _apply(client, leave_type.id, date(2026, 9, 1), date(2026, 9, 10))

    _as(users["MANAGER"])
    first = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert first.status_code == 200, first.text
    assert first.json()["awaiting_hr_co_approval"] is True

    _as(users["HR"])
    resp = await client.post(
        f"/api/v1/leave/approvals/{request['id']}/decide",
        json={"approve": False, "decision_reason": "Team is short-staffed that fortnight"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "REJECTED"
    assert body["hr_co_approved_at"] is None
    assert body["actioned_by"] == users["HR"].id, "HR made the terminal call, so HR is who actioned it"

    balance = await _balance(db_session, report.id)
    assert balance.pending_days == Decimal("0.00")
    assert balance.taken_days == Decimal("0.00")


# ============================= 7 — the co-approval route's own guards
async def test_hr_co_approve_is_hr_only_and_only_for_a_request_that_is_waiting(db_session, client):
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-guards")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    request = await _apply(client, leave_type.id, date(2026, 10, 1), date(2026, 10, 12))

    # Not waiting on anything yet — nobody has given the first signature.
    _as(users["HR"])
    too_early = await client.post(f"/api/v1/leave/approvals/{request['id']}/hr-co-approve")
    assert too_early.status_code == 409

    _as(users["MANAGER"])
    first = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert first.status_code == 200, first.text

    # A Manager holds `approve` on leave.approvals, but the HR co-approval is
    # not theirs to give — otherwise the second signature would be worthless.
    denied = await client.post(f"/api/v1/leave/approvals/{request['id']}/hr-co-approve")
    assert denied.status_code == 403

    _as(users["SUPER_ADMIN"])
    allowed = await client.post(f"/api/v1/leave/approvals/{request['id']}/hr-co-approve")
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["status"] == "APPROVED"


# ============================ 8 — ON but with no number configured is inert
async def test_toggle_on_without_a_configured_threshold_changes_nothing(db_session, client):
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=None)
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-nonum")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    request = await _apply(client, leave_type.id, date(2026, 11, 2), date(2026, 11, 20))

    _as(users["MANAGER"])
    resp = await client.post(f"/api/v1/leave/approvals/{request['id']}/decide", json={"approve": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "APPROVED", "no 'X Days' configured means there is nothing to be longer than"
    assert resp.json()["hr_co_approval_required"] is False


# ================ 9 — the queue filter that separates the two PENDING kinds
async def test_awaiting_hr_co_approval_filter_isolates_the_co_approval_queue(db_session, client):
    ids, users, leave_type, fy = await _seed_base(db_session)
    await _set_toggle(db_session, enabled=True, numeric_value=Decimal("3"))
    manager_employee = await _make_employee(db_session, fy, users["MANAGER"])
    report_user = await _make_extra_user(db_session, ids, "EMPLOYEE", "report-filter")
    await _make_employee(db_session, fy, report_user, reporting_manager_id=manager_employee.id)

    _as(report_user)
    waiting = await _apply(client, leave_type.id, date(2026, 6, 1), date(2026, 6, 10))
    untouched = await _apply(client, leave_type.id, date(2026, 7, 1), date(2026, 7, 10))

    _as(users["MANAGER"])
    first = await client.post(f"/api/v1/leave/approvals/{waiting['id']}/decide", json={"approve": True})
    assert first.status_code == 200, first.text

    _as(users["HR"])
    resp = await client.get("/api/v1/leave/approvals", params={"awaiting_hr_co_approval": "true"})
    assert resp.status_code == 200, resp.text
    assert [r["id"] for r in resp.json()] == [waiting["id"]]

    resp = await client.get("/api/v1/leave/approvals", params={"awaiting_hr_co_approval": "false"})
    assert resp.status_code == 200, resp.text
    assert [r["id"] for r in resp.json()] == [untouched["id"]]
