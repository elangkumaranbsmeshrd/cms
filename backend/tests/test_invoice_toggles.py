"""Tests for the toggle-gated Invoice business logic in
app/api/v1/invoices.py (11-invoice-module.md §6.2):

  - "Require Second Approval Before an Invoice Locks as Paid" — gated via
    app/services/finance_engine.apply_paid_confirmation_gate, applied at
    every place an invoice can newly resolve to PAID (record_payment here;
    also update_invoice and Credit Note approval, not exercised by this
    file). OFF (default): a payment that fully settles an invoice lands
    directly on PAID. ON: it lands on PEND_PAID instead, and only
    POST /invoices/{id}/confirm-paid (Super Admin only, per
    RolePermissionAction) moves it the rest of the way to PAID.
  - Payment reversal (POST /invoices/{id}/payments/{payment_id}/reverse) —
    blocked once the invoice is genuinely PAID (locked), allowed while it
    sits at PEND_PAID (nothing is locked yet there).
  - "Allow Manager Read-Only Access to Their Projects' Invoices" — a bespoke
    bypass inside list_invoices/get_invoice/download_invoice_pdf (NOT a
    MODE_TOGGLE_GATES entry — confirmed by reading rbac/toggles.py — so it
    only ever widens those three read paths, never edit/send/record_payment/
    confirm_paid/reverse, which stay 404 for Manager regardless of this
    toggle since invoice.list's RolePermission mode for Manager is 'none'
    everywhere else).
  - "Show Non-Financial Dashboard Widgets to HR" — a MODE_TOGGLE_GATES entry
    on invoice.dashboard widening HR 'none' -> 'view'; the route body then
    returns exactly 3 non-financial widgets with every financial figure None.

No existing test in this suite exercised a FastAPI route or flipped a
FeatureToggle row when this module family started (verified by searching
tests/ first, per the task) — tests/test_purchase_bill_toggles.py (written
alongside this file, same task) established the pattern this file copies
exactly: call the real route/dependency functions directly against the
SQLite `db_session` fixture (tests/conftest.py) rather than through an HTTP
client, seed RBAC via seed_canonical(), and resolve permissions by invoking
the real require_screen()/_resolve_invoice_perms() dependency closures so a
404/403 here is the exact same enforcement a real request would hit.

One wrinkle from calling FastAPI route/dependency callables directly instead
of through the framework: parameters declared as `Query(None)` do NOT default
to None when called as plain Python — the unevaluated FieldInfo sentinel is
truthy. Every such parameter is therefore passed explicitly below (see
_call_list).
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.invoices import (
    SCREEN,
    _resolve_invoice_perms,
    confirm_paid,
    create_invoice,
    download_invoice_pdf,
    get_invoice,
    invoice_dashboard,
    list_invoices,
    record_payment,
    reverse_payment,
    send_invoice,
)
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.finance import Invoice
from app.models.masters import CustomerStatus, Department, Designation, EmploymentType, NumberPrefixRule, PaymentMode
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.project import Project
from app.models.rbac import FeatureToggle
# Never referenced directly — imported purely so `app.models.ticket` (and
# thus the `tickets` table) is registered on Base.metadata before
# tests/conftest.py's db_session fixture calls create_all(). invoice_dashboard
# imports Ticket itself, but only lazily, inside the route body — after this
# file's own db_session fixture has already built the SQLite schema for that
# test. Employee/CompanyExpense/ExpenseClaim need no such guard: they're
# already reached transitively (Employee via app.services.org_scope, pulled
# in by invoices.py's own `from app.services import ... org_scope ...`;
# CompanyExpense/ExpenseClaim live in app.models.finance itself, imported at
# the top of invoices.py) — Employee is imported below anyway since this file
# constructs Employee rows directly.
from app.models.ticket import Ticket  # noqa: F401
from app.rbac.deps import require_screen
from app.schemas.finance import InvoiceCreate, InvoiceLineItemIn, InvoicePaymentCreate, InvoicePaymentReverse

from tests.conftest import seed_canonical

SECOND_APPROVAL_TOGGLE = "Require Second Approval Before an Invoice Locks as Paid"
MANAGER_PROJECT_INVOICES_TOGGLE = "Allow Manager Read-Only Access to Their Projects' Invoices"
HR_DASHBOARD_TOGGLE = "Show Non-Financial Dashboard Widgets to HR"

DASHBOARD_SCREEN = "invoice.dashboard"


# ------------------------------------------------------------------ helpers
async def _set_toggle(db, toggle_key: str, enabled: bool) -> None:
    row = (await db.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    if row is None:
        db.add(FeatureToggle(id=str(uuid.uuid4()), toggle_key=toggle_key, module_key="invoice", label=toggle_key, enabled=enabled, default_enabled=False))
    else:
        row.enabled = enabled
    await db.commit()


async def _perms(db, user: User, action: str | None = None):
    """Calls the real require_screen() dependency closure directly — the
    same 404 (invisible screen) / 403 (action not allowed) enforcement a real
    request would hit. x_preview_role must be passed explicitly: called as a
    plain function, the Header(None) default would otherwise bind to the
    (truthy) FieldInfo sentinel instead of None.
    """
    dependency = require_screen(SCREEN, action=action)
    return await dependency(current_user=user, db=db, x_preview_role=None)


async def _dashboard_perms(db, user: User):
    dependency = require_screen(DASHBOARD_SCREEN)
    return await dependency(current_user=user, db=db, x_preview_role=None)


async def _list_perms(db, user: User):
    """invoice.list's own list_invoices/get_invoice/download_invoice_pdf
    resolve permissions through _resolve_invoice_perms, not require_screen
    directly — see that function's docstring: it never raises on an
    invisible screen, because the §6.2 Manager-bypass check has to run
    inside the route body itself.
    """
    return await _resolve_invoice_perms(current_user=user, db=db, x_preview_role=None)


async def _users(db) -> dict[str, User]:
    ids = await seed_canonical(db)
    return {code: await db.get(User, ids[f"user:{code}"]) for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")}


async def _seed_masters(db) -> dict:
    """The minimum every create_invoice call needs: a current Financial
    Year, a Number Prefix Rule for code_type 'INV', a Payment Mode, and a
    Customer — no existing invoice fixture existed in this suite yet
    (verified before writing this), so this is the minimal version built
    straight from what the route/schema actually require.
    """
    fy = FinancialYear(id=str(uuid.uuid4()), label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True)
    rule = NumberPrefixRule(id=str(uuid.uuid4()), code_type="INV", label="Invoice", prefix="INV", include_fy_in_code=True, running_number_digits=4, starting_number=1)
    mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer", code="BANK", requires_reference_number=False)
    cust_status = CustomerStatus(id=str(uuid.uuid4()), name="Active", code="ACTIVE")
    customer = Customer(id=str(uuid.uuid4()), customer_code="CUST-1", financial_year_id=fy.id, company_name="Acme Co", status_id=cust_status.id)
    db.add_all([fy, rule, mode, cust_status, customer])
    await db.commit()
    return {"fy": fy, "payment_mode": mode, "customer": customer}


async def _seed_manager_employee(db, manager_user_id: str, fy_id: str) -> Employee:
    """§6.2's "Allow Manager Read-Only Access to Their Projects' Invoices" is
    Project LEAD only — needs a real Employee row linked to the Manager's
    User (org_scope.get_own_employee_id), which seed_canonical() itself never
    creates (it only seeds Users, not Employees).
    """
    dept = Department(id=str(uuid.uuid4()), name="Delivery")
    designation = Designation(id=str(uuid.uuid4()), name="Engagement Manager")
    emp_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time")
    employee = Employee(
        id=str(uuid.uuid4()), employee_code="EMP-MGR-1", code_financial_year_id=fy_id,
        first_name="Test", last_name="Manager", email="test.manager@example.test",
        department_id=dept.id, designation_id=designation.id, employment_type_id=emp_type.id,
        joining_date=date(2020, 1, 1), user_id=manager_user_id,
    )
    db.add_all([dept, designation, emp_type, employee])
    await db.commit()
    return employee


async def _create_project(db, fy_id: str, customer_id: str, project_lead_id: str) -> Project:
    project = Project(
        id=str(uuid.uuid4()), project_code="PRJ-1", financial_year_id=fy_id,
        project_name="Test Project", customer_id=customer_id, project_lead_id=project_lead_id,
    )
    db.add(project)
    await db.commit()
    return project


def _line_items() -> list[InvoiceLineItemIn]:
    return [InvoiceLineItemIn(description="Consulting", quantity=Decimal("10"), rate=Decimal("100"))]  # subtotal 1000, no tax


async def _create_and_send_invoice(db, accountant: User, customer_id: str, project_id: str | None = None) -> Invoice:
    perms = await _perms(db, accountant, action="edit")
    body = InvoiceCreate(customer_id=customer_id, project_id=project_id, invoice_date=date(2026, 8, 1), line_items=_line_items())
    out = await create_invoice(body=body, db=db, current_user=accountant, perms=perms)
    invoice = await db.get(Invoice, out.id)
    send_perms = await _perms(db, accountant, action="send")
    await send_invoice(invoice_id=invoice.id, db=db, current_user=accountant, perms=send_perms)
    await db.refresh(invoice)
    return invoice


async def _record_payment(db, user: User, invoice: Invoice, amount: Decimal, payment_mode_id: str):
    perms = await _perms(db, user, action="record_payment")
    body = InvoicePaymentCreate(amount_received=amount, payment_mode_id=payment_mode_id, payment_date=date(2026, 8, 10))
    return await record_payment(invoice_id=invoice.id, body=body, db=db, current_user=user, perms=perms)


async def _reverse_payment(db, user: User, invoice: Invoice, payment_id: str, reason: str):
    perms = await _perms(db, user, action="record_payment")
    body = InvoicePaymentReverse(reason=reason)
    return await reverse_payment(invoice_id=invoice.id, payment_id=payment_id, body=body, db=db, current_user=user, perms=perms)


async def _confirm_paid(db, user: User, invoice: Invoice):
    perms = await _perms(db, user, action="confirm_paid")
    return await confirm_paid(invoice_id=invoice.id, db=db, current_user=user, perms=perms)


async def _call_list(db, user: User, **overrides):
    perms = await _list_perms(db, user)
    kwargs = dict(
        db=db, current_user=user, perms=perms, customer_id=None, status_filter=None, financial_year_id=None,
        invoice_date_from=None, invoice_date_to=None, due_date_from=None, due_date_to=None, grand_total_min=None,
        grand_total_max=None, balance_due_min=None, balance_due_max=None, service_category_id=None, tax_head_id=None,
        payment_mode_id=None, created_by=None, last_modified_by=None, overdue=None, ageing=None, search=None, format=None,
    )
    kwargs.update(overrides)
    return await list_invoices(**kwargs)


# ============================== 1. Require Second Approval — OFF (default)
async def test_payment_settles_invoice_to_paid_when_gate_is_off(db_session):
    """OFF (the default, no FeatureToggle row at all): a payment that fully
    settles an invoice moves it straight to PAID, and locks it."""
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id)

    payment = await _record_payment(db_session, accountant, invoice, Decimal("1000"), masters["payment_mode"].id)
    assert payment.amount_received == Decimal("1000")

    await db_session.refresh(invoice)
    assert invoice.status == "PAID"
    assert invoice.paid_at is not None
    assert invoice.is_locked is True


# ================== 2. Require Second Approval — ON: PEND_PAID, then confirm-paid
async def test_payment_lands_on_pend_paid_then_confirm_paid_moves_to_paid(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id)
    await _set_toggle(db_session, SECOND_APPROVAL_TOGGLE, True)

    await _record_payment(db_session, accountant, invoice, Decimal("1000"), masters["payment_mode"].id)
    await db_session.refresh(invoice)
    assert invoice.status == "PEND_PAID"
    assert invoice.paid_at is None
    assert invoice.is_locked is False  # is_locked is `status = 'PAID'` only — PEND_PAID isn't locked yet

    result = await _confirm_paid(db_session, users["SUPER_ADMIN"], invoice)
    assert result.status == "PAID"

    await db_session.refresh(invoice)
    assert invoice.status == "PAID"
    assert invoice.paid_at is not None
    assert invoice.is_locked is True


# ============================== 3. confirm-paid is Super-Admin only
async def test_confirm_paid_forbidden_for_non_super_admin(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id)
    await _set_toggle(db_session, SECOND_APPROVAL_TOGGLE, True)
    await _record_payment(db_session, accountant, invoice, Decimal("1000"), masters["payment_mode"].id)
    await db_session.refresh(invoice)
    assert invoice.status == "PEND_PAID"

    # Accountant can see invoice.list (mode='full') but 'confirm_paid' is a
    # Super-Admin-only RolePermissionAction there — visible screen, action
    # forbidden -> 403, not 404.
    with pytest.raises(HTTPException) as exc:
        await _confirm_paid(db_session, accountant, invoice)
    assert exc.value.status_code == 403


# ============================== 4. Payment reversal gating
async def test_reverse_payment_blocked_once_invoice_is_paid(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id)
    payment = await _record_payment(db_session, accountant, invoice, Decimal("1000"), masters["payment_mode"].id)
    await db_session.refresh(invoice)
    assert invoice.status == "PAID"

    with pytest.raises(HTTPException) as exc:
        await _reverse_payment(db_session, accountant, invoice, payment.id, "test: should be rejected")
    assert exc.value.status_code == 409


async def test_reverse_payment_allowed_while_pend_paid(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id)
    await _set_toggle(db_session, SECOND_APPROVAL_TOGGLE, True)
    payment = await _record_payment(db_session, accountant, invoice, Decimal("1000"), masters["payment_mode"].id)
    await db_session.refresh(invoice)
    assert invoice.status == "PEND_PAID"

    reversed_payment = await _reverse_payment(
        db_session, accountant, invoice, payment.id, "catching a mis-recorded payment before Super Admin confirms"
    )
    assert reversed_payment.status == "REVERSED"

    await db_session.refresh(invoice)
    assert invoice.status == "SENT"
    assert invoice.amount_received == Decimal("0")


# ============================== 5. Manager project-invoices toggle — OFF
async def test_manager_invoice_list_hidden_when_project_toggle_off(db_session):
    """OFF (the default, seed.py: Manager mode 'none'): GET /invoices as
    Manager is a 404 — Layer 1 says the screen doesn't exist for them, and
    nothing widens it while the toggle is off."""
    users = await _users(db_session)

    with pytest.raises(HTTPException) as exc:
        await _call_list(db_session, users["MANAGER"])
    assert exc.value.status_code == 404


# ============================== 6. Manager project-invoices toggle — ON
async def test_manager_sees_led_project_invoices_but_cannot_mutate_when_toggle_on(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    manager = users["MANAGER"]
    employee = await _seed_manager_employee(db_session, manager.id, masters["fy"].id)
    project = await _create_project(db_session, masters["fy"].id, masters["customer"].id, employee.id)
    invoice = await _create_and_send_invoice(db_session, accountant, masters["customer"].id, project_id=project.id)
    await _set_toggle(db_session, MANAGER_PROJECT_INVOICES_TOGGLE, True)

    listed = await _call_list(db_session, manager)
    assert any(row.id == invoice.id for row in listed)

    list_perms = await _list_perms(db_session, manager)
    fetched = await get_invoice(invoice_id=invoice.id, db=db_session, current_user=manager, perms=list_perms)
    assert fetched.id == invoice.id

    pdf_resp = await download_invoice_pdf(invoice_id=invoice.id, db=db_session, current_user=manager, perms=list_perms)
    assert pdf_resp.status_code == 200
    assert pdf_resp.media_type == "application/pdf"

    # edit/send/record_payment/confirm-paid/reverse are NEVER widened by this
    # toggle (it has no ACTION_TOGGLE_GATES/MODE_TOGGLE_GATES entry at all —
    # confirmed by reading rbac/toggles.py; the bypass lives only inside
    # list_invoices/get_invoice/download_invoice_pdf). Manager's invoice.list
    # RolePermission mode stays 'none' everywhere else, so require_screen's
    # Layer 1 check 404s before the action check (Layer 2) is ever reached —
    # a 404, not the 403 a "view only" description might otherwise suggest.
    for action in ("edit", "send", "record_payment"):
        with pytest.raises(HTTPException) as exc:
            await _perms(db_session, manager, action=action)
        assert exc.value.status_code == 404, f"action={action}"


# ============================== 7. HR non-financial dashboard toggle
async def test_hr_dashboard_hidden_when_toggle_off(db_session):
    """OFF (the default, seed.py: HR mode 'none' on invoice.dashboard): the
    screen stays invisible to HR -> 404."""
    users = await _users(db_session)

    with pytest.raises(HTTPException) as exc:
        await _dashboard_perms(db_session, users["HR"])
    assert exc.value.status_code == 404


async def test_hr_dashboard_shows_ops_only_widgets_when_toggle_on(db_session):
    """ON: HR's mode widens 'none' -> 'view' (MODE_TOGGLE_GATES), and
    invoice_dashboard's own role_code=='HR' branch returns exactly the 3
    non-financial widgets, with every financial figure null."""
    users = await _users(db_session)
    await _set_toggle(db_session, HR_DASHBOARD_TOGGLE, True)

    perms = await _dashboard_perms(db_session, users["HR"])
    body = await invoice_dashboard(db=db_session, perms=perms)

    for financial_key in ("total_invoiced", "total_received", "outstanding", "overdue_count", "total_expenses"):
        assert body[financial_key] is None, f"{financial_key} should be null for HR, got {body[financial_key]!r}"
    assert body["overdue_invoices"] == []
    assert body["recent_payments"] == []
    # The 3 non-financial widgets are the entire point of the toggle — real
    # numbers, not nulled out like the financial ones above.
    assert isinstance(body["active_employees"], int)
    assert isinstance(body["active_projects"], int)
    assert isinstance(body["open_tickets"], int)
