"""Layer 3 security — bypass matrix items 5 (MASS ASSIGNMENT) and 7
(LOCKED-RECORD BYPASS), from build-docs/COMPLETE-TEST-PROMPT.md.

The premise, verbatim: "assume the attacker never opens your UI. They have a
valid low-privilege token and call the API directly with curl." Nothing here
consults the frontend's idea of which fields are disabled; every case posts
the extra field straight at the route and then RE-READS the stored record.
Asserting only on the response body would be weaker — a router that echoes a
sanitised shape while quietly persisting the smuggled value would pass that
and still be owned.

Shape copied from tests/test_file_download_authz.py, which the doc calls
"the right shape": the real `app.main` FastAPI app driven through
httpx.ASGITransport, `get_db` pinned to conftest's in-memory SQLite session
and `get_current_user` overridden per actor, with seed_canonical() supplying
the genuine seeded RBAC policy so 'own'/'full'/'none' behave exactly as they
do in production.

HOW THE SMUGGLE TARGETS WERE CHOSEN — not from the doc's example list, but
by diffing each Pydantic WRITE schema in app/schemas/ against the columns its
MODEL actually carries. A column that exists on the row and is deliberately
absent from the write schema is precisely what an attacker would try to
smuggle, because the server is relying on Pydantic's default `extra='ignore'`
rather than on an explicit check. The ones exercised below:

  * User.role_id                       — no user-update route exists at all;
                                         the nearest reachable write surface
                                         to a low-privilege caller is
                                         PUT /employees/me (MyProfileEditableWrite,
                                         which is two fields wide).
    (`is_super_admin`, named in the doc, is not a column in this schema —
     super-admin-ness IS `role_id` pointing at the SUPER_ADMIN role. It is
     posted anyway below, because a caller guessing at field names is exactly
     the threat model.)
  * Employee.employee_code / employment_status / exit_date / user_id /
    code_financial_year_id       — absent from EmployeeWrite (schemas/employee.py)
  * TaxHead.is_arithmetic_locked / usage_count / first_used_at
                                 — absent from TaxHeadCreate (schemas/masters.py)
  * Invoice.invoice_number / status / amount_received / credit_note_total /
    financial_year_id / is_locked / paid_at
                                 — absent from InvoiceCreate (schemas/finance.py)
  * ExpenseClaim.status / employee_id / claim_type / approved_by /
    approved_at / reimbursed_at  — absent from ExpenseClaimCreate
  * `is_active` on every generic Masters lookup — build_lookup_router keeps it
    in `create_only_fields`, so it is on the CREATE schema and off the WRITE
    one. masters_lookup.py's own docstring states the rule this file verifies:
    "the form field is how you create something already inactive," never a way
    to flip an EXISTING row's status — that stays with the dedicated
    activate/deactivate actions, which are gated on the Super-Admin-only
    'delete' action rather than plain 'edit'.

FINDING — the Financial Year lock does not reach outside its own screen.
APPENDIX-B:13 states THE LOCK RULE as absolute: "Once a Financial Year is
Locked, every field on that record AND every record dated inside that year IN
EVERY MODULE becomes permanently read-only. Nothing dated inside it can be
added, edited or deleted by anyone - not even the Super Admin who locked it."
The first half is enforced (financial_years.py checks `status == "locked"` in
update / delete / set-current). The second half is enforced nowhere:
`grep -rn '"locked"' app/` returns hits in app/api/v1/financial_years.py and
nothing else. The final test in this file is the strict xfail proving it, and
it is deliberately NOT weakened to match the implementation.

Two lock behaviours that DO hold, and are asserted rather than assumed: a
PAID invoice refuses a direct PUT, and a tax head whose arithmetic is locked
refuses its numbers to Super Admin while still accepting a label edit.

The MySQL trigger that sets `tax_heads.is_arithmetic_locked` on first use
(alembic 0004_payroll.py) does not exist on SQLite, so the tests that need a
locked head set the column directly — that is the state the trigger produces,
not a shortcut around a check. The check under test lives in Python, in
masters_taxes.update_tax_head, and runs against exactly this column.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.finance import ExpenseClaim, Invoice
from app.models.masters import (
    CustomerStatus,
    Department,
    Designation,
    EmploymentType,
    ExpenseType,
    LeaveType,
    NumberPrefixRule,
    PaymentMode,
    TaxHead,
)
from app.models.numbering import FinancialYear
from app.models.payroll import Payslip
from app.models.platform import User
from tests.conftest import seed_canonical

ROLE_CODES = ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")


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


# =========================================================== shared scaffolding
def _current_fy_window() -> tuple[date, date]:
    """1 April -> 31 March around today (APPENDIX-B:7/8). Derived from the
    clock rather than hardcoded so `invoice_date`/`expense_date` are always
    inside the seeded year AND never in the future, both of which the create
    routes reject outright.
    """
    today = date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


async def _reload(db, model, row_id):
    """The re-read. `db_session` is the SAME session the app just committed
    on and it is configured expire_on_commit=False, so a plain `.get()` would
    hand back the in-memory instance the route mutated — which proves nothing
    about what was stored. `.refresh()` forces a real SELECT.
    """
    row = await db.get(model, row_id)
    await db.refresh(row)
    return row


async def _seed_base(db):
    """Users for all five roles plus the minimum masters every create route
    below dereferences: a current Financial Year, the EMP/INV number prefix
    rules, a Department/Designation/Employment Type for Employee rows, and a
    Customer for invoices.
    """
    ids = await seed_canonical(db)
    users = {code: await db.get(User, ids[f"user:{code}"]) for code in ROLE_CODES}

    start, end = _current_fy_window()
    fy = FinancialYear(
        id=str(uuid.uuid4()), label=str(start.year), start_date=start, end_date=end,
        status="open", is_current=True,
    )
    dept = Department(id=str(uuid.uuid4()), name="Delivery", code="DEL")
    designation = Designation(id=str(uuid.uuid4()), name="Engineer", code="ENG")
    emp_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time")
    inv_rule = NumberPrefixRule(
        id=str(uuid.uuid4()), code_type="INV", label="Invoice", prefix="INV",
        include_fy_in_code=True, running_number_digits=5, starting_number=1,
    )
    emp_rule = NumberPrefixRule(
        id=str(uuid.uuid4()), code_type="EMP", label="Employee", prefix="EMP",
        include_fy_in_code=True, running_number_digits=4, starting_number=1,
    )
    payment_mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer", code="BANK", requires_reference_number=False)
    cust_status = CustomerStatus(id=str(uuid.uuid4()), name="Active", code="ACTIVE")
    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-1", financial_year_id=fy.id,
        company_name="Acme Co", status_id=cust_status.id,
    )
    db.add_all([fy, dept, designation, emp_type, inv_rule, emp_rule, payment_mode, cust_status, customer])
    await db.commit()

    masters = {
        "fy": fy, "dept": dept, "designation": designation, "emp_type": emp_type,
        "payment_mode": payment_mode, "customer": customer,
    }
    return ids, users, masters


async def _employee_for(db, masters: dict, user: User | None, label: str) -> Employee:
    """Ownership in this codebase is an employee_id, never a user_id
    (app/services/org_scope.py) — a login with no Employee row can never
    satisfy an 'own' scope, so every self-service route below needs one.
    """
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{label}", code_financial_year_id=masters["fy"].id,
        first_name=label, last_name="Original", email=f"{label}@test.local", phone="9876543210",
        department_id=masters["dept"].id, designation_id=masters["designation"].id,
        employment_type_id=masters["emp_type"].id, joining_date=date(2020, 1, 1),
        employment_status="ACTIVE", bank_account_number="111122223333",
        user_id=None if user is None else user.id,
    )
    db.add(employee)
    await db.commit()
    return employee


def _invoice_body(customer_id: str, **extra) -> dict:
    body = {
        "customer_id": customer_id,
        "invoice_date": date.today().isoformat(),
        "line_items": [{"description": "Consulting", "quantity": "10", "rate": "100"}],
    }
    body.update(extra)
    return body


# The full, valid Tax Head payload. PUT on this router takes the WHOLE record
# (TaxHeadCreate, not a partial), and update_tax_head's lock compares every
# _ARITHMETIC_FIELDS value against the stored one — so a "label only" edit
# has to resubmit the figures unchanged, exactly as the real edit form does.
TAX_HEAD_BODY = {
    "tax_name": "IGST 18",
    "short_code": "IGST18",
    "scope": "SALES_BILLING",
    "tax_type": "GST_IGST",
    "applies_from": "2020-04-01",
    "rate_pct": "18.0",
    "print_label": "IGST @ 18%",
    "notes": "original note",
}


async def _locked_tax_head(db, client, super_admin: User) -> str:
    """Creates a head through the real route, then sets the column the MySQL
    trigger would set on first use in a calculation (0004_payroll.py).
    """
    _as(super_admin)
    created = await client.post("/api/v1/masters/taxes", json=dict(TAX_HEAD_BODY))
    assert created.status_code == 201, created.text
    head_id = created.json()["id"]

    head = await db.get(TaxHead, head_id)
    head.is_arithmetic_locked = True
    head.usage_count = 3
    head.first_used_at = datetime(2026, 1, 1)
    await db.commit()
    return head_id


# ##########################################################################
# ITEM 5 — MASS ASSIGNMENT
# ##########################################################################

# ========== 1 — the headline: role_id / is_super_admin off a low-privilege token
async def test_employee_cannot_smuggle_role_or_employment_status_through_my_profile(db_session, client):
    """PUT /employees/me is the widest write surface a plain Employee can
    reach, and MyProfileEditableWrite is exactly two fields wide
    (current_address, phone) because Employee §2.3 routes everything else
    through a Profile Change Request for HR to review. Everything else posted
    here — including the doc's literal `role_id` and `is_super_admin` — must
    land nowhere.
    """
    ids, users, masters = await _seed_base(db_session)
    attacker = users["EMPLOYEE"]
    employee = await _employee_for(db_session, masters, attacker, "selfservice")

    _as(attacker)
    resp = await client.put(
        "/api/v1/employees/me",
        json={
            # the two fields this endpoint genuinely owns
            "current_address": "12 New Street",
            "phone": "9000000000",
            # ...and the payload an attacker would append
            "role_id": ids["role:SUPER_ADMIN"],
            "is_super_admin": True,
            "employment_status": "EXITED",
            "employee_code": "EMP-0001",
            "email": "attacker@evil.test",
            "first_name": "Pwned",
            "department_id": "some-other-department",
            "bank_account_number": "999988887777",
            "user_id": str(uuid.uuid4()),
            "code_financial_year_id": "some-other-year",
        },
    )
    assert resp.status_code == 200, resp.text

    stored = await _reload(db_session, Employee, employee.id)
    assert stored.current_address == "12 New Street"  # the legitimate half really applied
    assert stored.phone == "9000000000"
    assert stored.employment_status == "ACTIVE", "employment_status is not self-service"
    assert stored.employee_code == "EMP-selfservice", "the employee code is allocated, never supplied"
    assert stored.email == "selfservice@test.local", "email change must go through a Profile Change Request"
    assert stored.first_name == "selfservice"
    assert stored.department_id == masters["dept"].id
    assert stored.bank_account_number == "111122223333"
    assert stored.user_id == attacker.id, "the login link must not be repointable by its own holder"
    assert stored.code_financial_year_id == masters["fy"].id

    # The privilege escalation itself: the User row behind the token.
    stored_user = await _reload(db_session, User, attacker.id)
    assert stored_user.role_id == ids["role:EMPLOYEE"], "PUT /employees/me granted a role"
    assert stored_user.is_enabled is True
    assert stored_user.must_change_password is False


# ============= 2 — the employee master record: code and lifecycle are not fields
async def test_employee_master_record_write_ignores_code_status_and_login_link(db_session, client):
    """EmployeeWrite carries the 20 personal/employment fields and nothing
    else. employee_code is allocated by services/numbering.allocate_number,
    employment_status/exit_date move only through the Offboarding checklist
    (APPENDIX-B:109's sequencing lock), and user_id only through
    create-login/disable-login. HR holds 'edit' on employee.master_record,
    so this is the most-privileged caller who still must not set them.
    """
    ids, users, masters = await _seed_base(db_session)
    target = await _employee_for(db_session, masters, None, "target")

    _as(users["HR"])

    # (a) PUT — smuggled onto a legitimate rename.
    resp = await client.put(
        f"/api/v1/employees/{target.id}",
        json={
            "first_name": "Renamed", "last_name": "Original", "email": "target@test.local",
            "department_id": masters["dept"].id, "designation_id": masters["designation"].id,
            "employment_type_id": masters["emp_type"].id, "joining_date": "2020-01-01",
            "employee_code": "EMP-0001",
            "employment_status": "EXITED",
            "exit_date": date.today().isoformat(),
            "user_id": str(uuid.uuid4()),
            "code_financial_year_id": "some-other-year",
            "onboarding_completed_at": "2020-01-01T00:00:00",
        },
    )
    assert resp.status_code == 200, resp.text

    stored = await _reload(db_session, Employee, target.id)
    assert stored.first_name == "Renamed"  # the legitimate edit really applied
    assert stored.employee_code == "EMP-target", "employee_code is server-allocated, not caller-supplied"
    assert stored.employment_status == "ACTIVE", "status must move through Offboarding, not a PUT"
    assert stored.exit_date is None
    assert stored.user_id is None, "a login cannot be attached by writing the record"
    assert stored.code_financial_year_id == masters["fy"].id
    assert stored.onboarding_completed_at is None

    # (b) POST — the same fields on create, where the code is being minted.
    created = await client.post(
        "/api/v1/employees",
        json={
            "first_name": "Fresh", "email": "fresh@test.local",
            "department_id": masters["dept"].id, "designation_id": masters["designation"].id,
            "employment_type_id": masters["emp_type"].id, "joining_date": "2021-06-01",
            "employee_code": "EMP-CHOSEN-BY-CALLER",
            "employment_status": "EXITED",
            "user_id": str(uuid.uuid4()),
        },
    )
    assert created.status_code == 201, created.text
    fresh = await _reload(db_session, Employee, created.json()["id"])
    assert fresh.employee_code != "EMP-CHOSEN-BY-CALLER"
    assert fresh.employee_code.startswith("EMP-"), fresh.employee_code
    assert fresh.employment_status == "ACTIVE"
    assert fresh.user_id is None


# ===== 3 — is_active is create-only; flipping an existing row is a delete-gated action
async def test_is_active_on_a_masters_row_cannot_be_flipped_by_a_plain_put(db_session, client):
    """masters_lookup.build_lookup_router's own documented rule: `is_active`
    sits in `create_only_fields`, so it is on the CREATE schema and off the
    WRITE one — "if `is_active` were in `fields` instead, any role granted
    plain 'edit' could flip a row inactive through a normal PUT, bypassing
    the 'delete' action guard deactivate_row/activate_row enforce."

    Leave Types is the sub-master that makes the gap real: HR holds
    mode='full' AND the 'edit' action there (conftest CANONICAL_ACTIONS),
    while 'delete' — which is what deactivate/activate are gated on — is
    Super-Admin-only. So HR is a genuine low-privilege caller with a
    legitimate reason to PUT this row.
    """
    ids, users, masters = await _seed_base(db_session)
    hr, super_admin = users["HR"], users["SUPER_ADMIN"]

    async def _read(row_id: str) -> dict | None:
        listing = await client.get("/api/v1/masters/leave-types?include_inactive=true")
        assert listing.status_code == 200, listing.text
        return next((r for r in listing.json() if r["id"] == row_id), None)

    _as(hr)
    created = await client.post(
        "/api/v1/masters/leave-types",
        json={"name": "Casual Leave", "short_code": "CL", "is_paid": True, "default_annual_quota_days": "12"},
    )
    assert created.status_code == 201, created.text
    row_id = created.json()["id"]

    # The attack: a plain edit that also flips the row inactive.
    flipped = await client.put(
        f"/api/v1/masters/leave-types/{row_id}",
        json={
            "name": "Casual Leave (renamed)", "short_code": "CL", "is_paid": True,
            "default_annual_quota_days": "12", "carry_forward_allowed": False,
            "max_carry_forward_days": None, "is_quota_tracked": True,
            "is_active": False,
        },
    )
    assert flipped.status_code == 200, flipped.text
    assert flipped.json()["is_active"] is True, "the response already leaked a flipped status"

    stored = await _reload(db_session, LeaveType, row_id)
    assert stored.name == "Casual Leave (renamed)"  # the legitimate edit really applied
    assert stored.is_active is True, "PUT flipped is_active, bypassing the delete-gated deactivate action"
    assert (await _read(row_id))["is_active"] is True

    # The dedicated action is the only route, and it is Super-Admin-only.
    denied = await client.post(f"/api/v1/masters/leave-types/{row_id}/deactivate")
    assert denied.status_code == 403, denied.text
    assert (await _reload(db_session, LeaveType, row_id)).is_active is True

    _as(super_admin)
    allowed = await client.post(f"/api/v1/masters/leave-types/{row_id}/deactivate")
    assert allowed.status_code == 200, allowed.text
    assert (await _reload(db_session, LeaveType, row_id)).is_active is False

    # ...and the create-only half is genuinely honoured, so the PUT assertion
    # above is not passing merely because the field is dropped everywhere.
    born_inactive = await client.post(
        "/api/v1/masters/leave-types",
        json={"name": "Retired Type", "is_paid": False, "default_annual_quota_days": "0", "is_active": False},
    )
    assert born_inactive.status_code == 201, born_inactive.text
    assert born_inactive.json()["is_active"] is False
    assert (await _reload(db_session, LeaveType, born_inactive.json()["id"])).is_active is False


# ================ 4 — an invoice's number, status and money received are not inputs
async def test_invoice_write_cannot_set_number_status_or_money_received(db_session, client):
    """InvoiceCreate is what both POST and PUT take. invoice_number comes
    from allocate_number (APPENDIX-B:414's INV-<FY>-<5 digits>), status moves
    only through send / record-payment / confirm-paid, amount_received and
    credit_note_total are written only by the payment and credit-note flows,
    and is_locked/grand_total/balance_due are generated columns. Accountant
    is the role that legitimately owns this screen.
    """
    ids, users, masters = await _seed_base(db_session)
    accountant = users["ACCOUNTANT"]
    _as(accountant)

    # (a) POST — smuggled at creation.
    created = await client.post(
        "/api/v1/invoices",
        json=_invoice_body(
            masters["customer"].id,
            invoice_number="INV-FORGED-00001",
            status="PAID",
            amount_received="1000",
            credit_note_total="500",
            withheld_total="250",
            financial_year_id="some-other-year",
            is_locked=True,
            paid_at="2020-01-01T00:00:00",
            sent_at="2020-01-01T00:00:00",
        ),
    )
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]

    stored = await _reload(db_session, Invoice, invoice_id)
    allocated_number = stored.invoice_number
    assert allocated_number != "INV-FORGED-00001", "the invoice number is allocated, never supplied"
    assert allocated_number.startswith("INV-"), allocated_number
    assert stored.status == "DRAFT", "a new invoice is always a Draft"
    assert stored.amount_received == 0
    assert stored.credit_note_total == 0
    assert stored.withheld_total == 0
    assert stored.financial_year_id == masters["fy"].id
    assert stored.is_locked is False
    assert stored.paid_at is None
    assert stored.sent_at is None

    # (b) PUT — the same smuggle on a legitimate edit of a Draft.
    edited = await client.put(
        f"/api/v1/invoices/{invoice_id}",
        json=_invoice_body(
            masters["customer"].id,
            reference="PO-4471",
            invoice_number="INV-FORGED-00001",
            status="PAID",
            amount_received="1000",
            credit_note_total="500",
            financial_year_id="some-other-year",
            is_locked=True,
            paid_at="2020-01-01T00:00:00",
        ),
    )
    assert edited.status_code == 200, edited.text

    stored = await _reload(db_session, Invoice, invoice_id)
    assert stored.reference == "PO-4471"  # the legitimate edit really applied
    assert stored.invoice_number == allocated_number
    assert stored.status == "DRAFT", "an edit must not settle an invoice"
    assert stored.amount_received == 0, "money received is written only by record-payment"
    assert stored.credit_note_total == 0
    assert stored.financial_year_id == masters["fy"].id
    assert stored.is_locked is False
    assert stored.paid_at is None

    # The API's own view agrees with the row.
    read_back = await client.get(f"/api/v1/invoices/{invoice_id}")
    assert read_back.status_code == 200, read_back.text
    body = read_back.json()
    assert body["invoice_number"] == allocated_number
    assert body["status"] == "DRAFT"
    assert body["amount_received"] == "0.00"
    assert body["is_locked"] is False


# ================== 5 — the arithmetic lock flag cannot be switched off by the caller
async def test_tax_head_arithmetic_lock_flag_cannot_be_smuggled_off(db_session, client):
    """is_arithmetic_locked / usage_count / first_used_at are on the TaxHead
    model and deliberately absent from TaxHeadCreate — they are set by the
    engine on first use, never by a form. If a PUT could clear the flag, the
    lock in the very next request would be gone.
    """
    ids, users, masters = await _seed_base(db_session)
    head_id = await _locked_tax_head(db_session, client, users["SUPER_ADMIN"])

    # Nothing else changed — so if the flag were writable this would be a
    # clean 200 that quietly unlocks the head.
    resp = await client.put(
        f"/api/v1/masters/taxes/{head_id}",
        json=dict(TAX_HEAD_BODY, is_arithmetic_locked=False, usage_count=0, first_used_at=None),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_arithmetic_locked"] is True, "the response already reported the head as unlocked"

    stored = await _reload(db_session, TaxHead, head_id)
    assert stored.is_arithmetic_locked is True, "the arithmetic lock was cleared by a PUT"
    assert stored.usage_count == 3
    assert stored.first_used_at is not None

    # ...and the lock is still doing its job on the very next request.
    still_locked = await client.put(f"/api/v1/masters/taxes/{head_id}", json=dict(TAX_HEAD_BODY, rate_pct="5.0"))
    assert still_locked.status_code == 409, still_locked.text
    assert (await _reload(db_session, TaxHead, head_id)).rate_pct == 18


# ============= 6 — a claimant cannot pre-approve or re-attribute their own claim
async def test_employee_cannot_self_approve_or_re_attribute_an_expense_claim(db_session, client):
    """ExpenseClaimCreate carries the nine fields the claim form has.
    employee_id comes from the caller's own Employee row, financial_year_id
    from the current FY, claim_type from the selected Expense Type
    (APPENDIX-B:34 — Company-Paid is Super Admin/Accountant only), status is
    hardcoded PENDING, and every approved_*/rejected_*/reimbursed_* column is
    written by the approval and reimbursement actions. This is the single
    most valuable mass-assignment target for a low-privilege token in the
    app: it is money, and every role can reach the endpoint.
    """
    ids, users, masters = await _seed_base(db_session)
    attacker = users["EMPLOYEE"]
    await _employee_for(db_session, masters, attacker, "claimant")
    victim = await _employee_for(db_session, masters, None, "victim")

    expense_type = ExpenseType(
        id=str(uuid.uuid4()), name="Travel", short_code="TRV", claim_type="REIMBURSABLE", is_recurring=False,
    )
    company_paid_type = ExpenseType(
        id=str(uuid.uuid4()), name="Office Rent", short_code="RENT", claim_type="COMPANY_PAID", is_recurring=True,
    )
    db_session.add_all([expense_type, company_paid_type])
    await db_session.commit()

    _as(attacker)
    created = await client.post(
        "/api/v1/expenses",
        json={
            "expense_type_id": expense_type.id,
            "amount": "4500",
            "expense_date": date.today().isoformat(),
            "description": "Client visit",
            # the smuggled payload
            "status": "APPROVED",
            "employee_id": victim.id,
            "claim_type": "COMPANY_PAID",
            "financial_year_id": "some-other-year",
            "approved_by": ids["user:SUPER_ADMIN"],
            "approved_at": "2020-01-01T00:00:00",
            "manager_approved_by": ids["user:MANAGER"],
            "reimbursed_at": "2020-01-01T00:00:00",
            "bank_account_id": str(uuid.uuid4()),
        },
    )
    assert created.status_code == 201, created.text

    stored = await _reload(db_session, ExpenseClaim, created.json()["id"])
    assert stored.amount == 4500  # the legitimate half really applied
    assert stored.status == "PENDING", "a claim approved itself on the way in"
    assert stored.employee_id != victim.id, "a claim was filed against another employee"
    assert stored.claim_type == "REIMBURSABLE", "claim_type is derived from the Expense Type, never supplied"
    assert stored.financial_year_id == masters["fy"].id
    assert stored.approved_by is None
    assert stored.approved_at is None
    assert stored.manager_approved_by is None
    assert stored.reimbursed_at is None

    # The Company-Paid route stays shut when it is asked for honestly, too —
    # so the assertion above is a real derivation, not an unreachable branch.
    refused = await client.post(
        "/api/v1/expenses",
        json={
            "expense_type_id": company_paid_type.id, "amount": "4500",
            "expense_date": date.today().isoformat(), "description": "Rent",
        },
    )
    assert refused.status_code == 403, refused.text


# ##########################################################################
# ITEM 7 — LOCKED-RECORD BYPASS
# ##########################################################################

# ======================================= 7 — a PAID invoice refuses a direct PUT
async def test_paid_invoice_refuses_a_direct_put_from_everyone(db_session, client):
    """Invoice.is_locked is `Computed("status = 'PAID'")`, and
    update_invoice's first act after loading the row is to refuse a locked
    one. APPENDIX-B:437 — a correction to a paid invoice goes through a
    Credit Note "without reopening or editing the locked invoice".
    """
    ids, users, masters = await _seed_base(db_session)

    _as(users["ACCOUNTANT"])
    created = await client.post("/api/v1/invoices", json=_invoice_body(masters["customer"].id, reference="ORIGINAL"))
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]

    invoice = await db_session.get(Invoice, invoice_id)
    invoice.status = "PAID"
    invoice.paid_at = datetime(2026, 1, 1)
    await db_session.commit()
    assert (await _reload(db_session, Invoice, invoice_id)).is_locked is True

    for code in ("ACCOUNTANT", "SUPER_ADMIN"):
        _as(users[code])
        resp = await client.put(
            f"/api/v1/invoices/{invoice_id}",
            json=_invoice_body(masters["customer"].id, reference="TAMPERED", notes="tampered"),
        )
        assert resp.status_code == 409, f"{code} edited a Paid invoice: {resp.status_code} {resp.text}"

    stored = await _reload(db_session, Invoice, invoice_id)
    assert stored.reference == "ORIGINAL"
    assert stored.notes is None
    assert stored.status == "PAID"


# ======================== 8 — a PROCESSED payslip has no write endpoint at all
async def test_processed_payslip_cannot_be_written_by_any_actor(db_session, client):
    """APPENDIX-B:236: "Processed is never edited in place" — the only path
    to a Processed payslip's figures is POST /payslips/{id}/reissue, which
    records a PayslipReissue history row. So the strongest possible answer to
    a direct PUT is that no such route is mounted: FastAPI answers 405 on a
    path that exists for GET only. Asserted for every role, and the stored
    figures re-read afterwards, because "405" alone would not rule out some
    other router having claimed the same path.
    """
    ids, users, masters = await _seed_base(db_session)
    employee = await _employee_for(db_session, masters, users["EMPLOYEE"], "payslipowner")

    payslip = Payslip(
        id=str(uuid.uuid4()), payroll_run_id="run-1", payroll_run_employee_id="pre-1",
        employee_id=employee.id, financial_year_id=masters["fy"].id,
        pay_period_start=date(2026, 4, 1), pay_period_end=date(2026, 4, 30),
        salary_credit_date=date(2026, 5, 1), pay_cycle_type_snapshot="CALENDAR_MONTH",
        salary_credit_day_snapshot=1, period_month=4, period_year=2026,
        employee_code_snapshot=employee.employee_code, employee_name_snapshot=employee.first_name,
        gross_pay=50000, total_earnings=50000, total_deductions=5000, net_pay=45000,
        income_tax_amount=2500, paid_days=30, lop_days=0,
        status="PROCESSED", generated_at=datetime(2026, 5, 1), generated_by=users["SUPER_ADMIN"].id,
    )
    db_session.add(payslip)
    await db_session.commit()

    tamper = {"net_pay": "999999", "gross_pay": "999999", "total_deductions": "0",
              "income_tax_amount": "0", "status": "DRAFT", "lop_days": "0"}
    for code in ROLE_CODES:
        _as(users[code])
        put = await client.put(f"/api/v1/payroll/payslips/{payslip.id}", json=tamper)
        assert put.status_code == 405, f"{code} found a PUT on a Processed payslip: {put.status_code} {put.text}"
        patch = await client.patch(f"/api/v1/payroll/payslips/{payslip.id}", json=tamper)
        assert patch.status_code == 405, f"{code} found a PATCH on a Processed payslip: {patch.status_code}"

    stored = await _reload(db_session, Payslip, payslip.id)
    assert stored.net_pay == 45000
    assert stored.gross_pay == 50000
    assert stored.income_tax_amount == 2500
    assert stored.status == "PROCESSED"
    assert stored.reissue_count == 0

    # The one real mutation path is gated: payroll.payslips_admin is 'none'
    # for Employee and Manager, so Layer 1 answers 404 before any body is read.
    for code in ("EMPLOYEE", "MANAGER"):
        _as(users[code])
        reissue = await client.post(
            f"/api/v1/payroll/payslips/{payslip.id}/reissue",
            json={"reason": "because I said so", "reissue_method": "MANUAL_ADJUSTMENT", "new_net_pay": "999999"},
        )
        assert reissue.status_code == 404, f"{code} reached the reissue endpoint: {reissue.status_code}"
    assert (await _reload(db_session, Payslip, payslip.id)).net_pay == 45000


# ===== 9 — a locked tax head: the numbers refuse EVERYONE, the labels still move
async def test_locked_tax_head_numbers_refuse_super_admin_but_labels_still_edit(db_session, client):
    """APPENDIX-B:30, TAX ARITHMETIC LOCK, "deliberately STRICTER than any
    role permission": once a head has been used in ANY calculation its
    numbers are read-only FOR EVERYONE INCLUDING SUPER ADMIN — Rate, Amount,
    slab bands, split component shares, ceilings, thresholds, caps and Borne
    By. "Only labels (Tax Name, Print Label, Notes) stay editable."

    Both halves are asserted, because a lock that also froze the labels would
    break APPENDIX-B:31's mandatory rate-change sequence: set the locked
    head's Applies Until, then Duplicate. masters.taxes is Super-Admin-only
    for 'edit', so Super Admin IS the most privileged caller there is here.
    """
    ids, users, masters = await _seed_base(db_session)
    head_id = await _locked_tax_head(db_session, client, users["SUPER_ADMIN"])
    _as(users["SUPER_ADMIN"])

    # (a) the numbers refuse — one field at a time, so the message names it.
    for field, value in (("rate_pct", "5.0"), ("cgst_rate_pct", "9.0"), ("fixed_amount", "500"),
                         ("declaration_cap", "150000"), ("tax_type", "PERCENTAGE"), ("scope", "PURCHASE"),
                         ("applies_from", "2021-04-01")):
        resp = await client.put(f"/api/v1/masters/taxes/{head_id}", json=dict(TAX_HEAD_BODY, **{field: value}))
        assert resp.status_code == 409, f"Super Admin changed a locked head's {field}: {resp.status_code} {resp.text}"
        assert "locked" in resp.json()["detail"].lower()

    stored = await _reload(db_session, TaxHead, head_id)
    assert stored.rate_pct == 18
    assert stored.cgst_rate_pct is None
    assert stored.fixed_amount is None
    assert stored.tax_type == "GST_IGST"
    assert stored.scope == "SALES_BILLING"
    assert stored.applies_from == date(2020, 4, 1)

    # (b) the labels still move — including Applies Until, which is how the
    # spec's rate-change sequence retires the old head before Duplicate.
    labels = await client.put(
        f"/api/v1/masters/taxes/{head_id}",
        json=dict(
            TAX_HEAD_BODY, tax_name="IGST 18 (superseded)", short_code="IGST18X",
            print_label="IGST @ 18% (old)", notes="retired 2026-03-31",
            applies_until="2026-03-31",
        ),
    )
    assert labels.status_code == 200, f"a label edit on a locked head was refused: {labels.text}"

    stored = await _reload(db_session, TaxHead, head_id)
    assert stored.tax_name == "IGST 18 (superseded)"
    assert stored.print_label == "IGST @ 18% (old)"
    assert stored.notes == "retired 2026-03-31"
    assert stored.applies_until == date(2026, 3, 31)
    assert stored.rate_pct == 18, "a label edit must not disturb the figures"
    assert stored.is_arithmetic_locked is True


# ============ 10 — a locked Financial Year's OWN record is frozen for Super Admin
async def test_locked_financial_year_record_is_frozen_even_for_super_admin(db_session, client):
    """APPENDIX-B:13, the first half of THE LOCK RULE — "every field on that
    record". financial_years.py enforces this in update / delete /
    set-current. masters.financial_year is Super-Admin-only end to end, so
    the caller refused below is the only one who can even see the screen.
    """
    ids, users, masters = await _seed_base(db_session)
    fy_id = masters["fy"].id
    start, end = _current_fy_window()
    _as(users["SUPER_ADMIN"])

    locked = await client.post(f"/api/v1/masters/financial-years/{fy_id}/lock")
    assert locked.status_code == 200, locked.text
    assert locked.json()["status"] == "locked"

    edited = await client.put(
        f"/api/v1/masters/financial-years/{fy_id}",
        json={"start_date": (start + timedelta(days=1)).isoformat(), "end_date": end.isoformat()},
    )
    assert edited.status_code == 409, f"Super Admin edited a locked Financial Year: {edited.text}"

    deleted = await client.delete(f"/api/v1/masters/financial-years/{fy_id}")
    assert deleted.status_code == 409, f"Super Admin deleted a locked Financial Year: {deleted.text}"

    recurrent = await client.post(f"/api/v1/masters/financial-years/{fy_id}/set-current")
    assert recurrent.status_code == 409, recurrent.text

    stored = await _reload(db_session, FinancialYear, fy_id)
    assert stored.status == "locked"
    assert stored.start_date == start
    assert stored.end_date == end


# = 11 — FINDING: the lock does not reach the records dated inside the locked year
@pytest.mark.xfail(
    strict=True,
    reason=(
        "REAL BYPASS of APPENDIX-B:13 (THE LOCK RULE, 'absolute, overrides every role "
        "permission'): 'every record dated inside that year IN EVERY MODULE becomes "
        "permanently read-only. Nothing dated inside it can be added, edited or deleted "
        "by anyone - not even the Super Admin who locked it.' Only the Financial Year's "
        "OWN record is guarded: `grep -rn '\"locked\"' app/` hits app/api/v1/"
        "financial_years.py and no other module. invoices.update_invoice checks "
        "Invoice.is_locked (status='PAID') and never looks at the FY; employees."
        "update_employee, create_invoice and every other write are unguarded too. "
        "Verified live in this suite: Super Admin edits an invoice dated inside a "
        "locked year (200), edits an employee whose code_financial_year_id IS the "
        "locked year (200), and the Accountant mints a brand-new invoice into it (201). "
        "The app-layer guard is absent; no DB trigger backstops it either (0009's "
        "trg_fy_reject_unlock guards only the unlock transition on financial_years "
        "itself). Application code deliberately not changed."
    ),
)
async def test_records_dated_inside_a_locked_financial_year_are_frozen_for_everyone(db_session, client):
    """The interesting half of the lock rule, and the one the doc calls out:
    frozen "including for Super Admin".

    All three writes are attempted and their statuses collected before the
    single assertion, so the failure message names every module that still
    lets the write through rather than stopping at the first one.
    """
    ids, users, masters = await _seed_base(db_session)
    fy_id = masters["fy"].id

    # A record created legitimately, while the year is still open.
    _as(users["ACCOUNTANT"])
    created = await client.post("/api/v1/invoices", json=_invoice_body(masters["customer"].id, reference="ORIGINAL"))
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]
    assert created.json()["financial_year_id"] == fy_id
    employee = await _employee_for(db_session, masters, None, "insidelockedfy")

    # Now the year is locked, by the Super Admin who is then refused below.
    _as(users["SUPER_ADMIN"])
    locked = await client.post(f"/api/v1/masters/financial-years/{fy_id}/lock")
    assert locked.status_code == 200, locked.text

    outcomes: dict[str, int] = {}

    outcomes["edit invoice dated inside the locked FY (Super Admin)"] = (
        await client.put(
            f"/api/v1/invoices/{invoice_id}",
            json=_invoice_body(masters["customer"].id, reference="EDITED-AFTER-LOCK"),
        )
    ).status_code

    outcomes["edit employee whose FY is the locked one (Super Admin)"] = (
        await client.put(
            f"/api/v1/employees/{employee.id}",
            json={
                "first_name": "EditedAfterLock", "email": "insidelockedfy@test.local",
                "department_id": masters["dept"].id, "designation_id": masters["designation"].id,
                "employment_type_id": masters["emp_type"].id, "joining_date": "2020-01-01",
            },
        )
    ).status_code

    _as(users["ACCOUNTANT"])
    outcomes["add a new invoice into the locked FY (Accountant)"] = (
        await client.post("/api/v1/invoices", json=_invoice_body(masters["customer"].id, reference="ADDED-AFTER-LOCK"))
    ).status_code

    assert list(outcomes.values()) == [409, 409, 409], (
        "a locked Financial Year did not freeze the records dated inside it: " + repr(outcomes)
    )
