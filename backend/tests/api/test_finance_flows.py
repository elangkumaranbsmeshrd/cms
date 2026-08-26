"""Layer 2 — the FINANCE module's three functional flows, end to end over the
real HTTP surface (COMPLETE-TEST-PROMPT.md, "Per-module functional flows"):

  - Invoice      — "draft -> send -> part-pay -> pay -> **locked** -> credit
                    note -> balance reduced without reopening the invoice"
  - Expense      — "submit -> approve -> reimburse · receipt-required toggle
                    actually blocks approval"
  - Purchase Bill— "record -> pay -> withholding deducted from payment, not
                    added to it"

Every step drives the REAL endpoint through app.main's FastAPI app, and every
assertion is on a FIGURE, not a status code. A flow test that only checked 2xx
would pass on an invoice that charged nothing, a reimbursement that paid
nothing, and a withholding that was added to the vendor's payment instead of
deducted from it — the three things this file exists to catch.

WHAT THIS FILE DELIBERATELY DOES NOT REPEAT
  - tests/test_invoice_toggles.py — the "Require Second Approval Before an
    Invoice Locks as Paid" gate (PEND_PAID/confirm-paid), payment reversal
    gating, the Manager project-invoices bypass, the HR dashboard widening.
    Every toggle here is left at its seeded default, so these flows are the
    plain, unconfigured path those files never walk.
  - tests/test_expense_toggles.py — the auto-approval threshold, the Manager
    sign-off step, and the receipt toggle's own 422/200 status codes. The
    receipt test below asserts something that file does not: that a BLOCKED
    approval leaves the claim's STATE untouched (still PENDING, approved_by
    still null), that a receipt-bearing claim still approves while the toggle
    is ON, and that the unblocked claim then carries all the way through to a
    reimbursement of the right amount.
  - tests/test_purchase_bill_toggles.py — the attachment gate, the lock-once-
    paid toggle, the Manager read-only widening, the due-date validation.
  - tests/services/test_finance_engine.py — the same arithmetic as PURE unit
    tests on resolve_invoice_status_after_payment / resolve_purchase_bill_
    status / the Invoice.balance_due generated column. This file is the
    end-to-end WIRING between those units and the endpoints: that the routes
    actually feed the engine the right numbers and persist what it returns.

HARNESS NOTE — why get_db expires the session per request. In production every
request opens its own AsyncSession (app/core/db.py: `async with
AsyncSessionLocal()`), so a route always SELECTs the row it is about to read.
This harness pins ONE session across every request, and several finance routes
UPDATE a row and then refresh only their own return value (invoices.
record_payment refreshes the payment, not the invoice; purchase_bills.
create_purchase_bill refreshes the bill, not the vendor it rolled up). That
leaves those rows' GENERATED columns (Invoice.balance_due/is_locked,
PurchaseBill.balance_due, Vendor.bank_account_number_masked) marked expired in
the identity map, and the NEXT request reads them as a lazy load from inside a
plain coroutine — MissingGreenlet under AsyncSession, an artefact of the shared
session and not an application bug. tests/test_purchase_bill_toggles.py works
around exactly this with an explicit per-row `await db.refresh(vendor)`;
expiring once per request is the same workaround applied uniformly, and it
reproduces what a fresh per-request session would have read.
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
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.masters import (
    BankAccount,
    CustomerStatus,
    ExpenseType,
    NumberPrefixRule,
    PaymentMode,
    TaxHead,
    TaxHeadWithholdingDirection,
)
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.models.vendor import Vendor
from tests.conftest import seed_canonical

# Dates are derived from today rather than hardcoded: create_invoice /
# create_purchase_bill / create_expense_claim all reject a future date, and a
# frozen literal would start failing the day the clock passes it.
TODAY = date.today()
INVOICE_DATE = TODAY - timedelta(days=30)
DUE_DATE = TODAY - timedelta(days=5)
FIRST_PAYMENT_DATE = TODAY - timedelta(days=10)
SECOND_PAYMENT_DATE = TODAY - timedelta(days=2)
BILL_DATE = TODAY - timedelta(days=20)
EXPENSE_DATE = TODAY - timedelta(days=7)
TAX_IN_FORCE_FROM = TODAY - timedelta(days=400)

RECEIPT_REQUIRED_TOGGLE = "Require a Receipt Before Approval"


# ================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session):
    async def _get_db_override():
        # See the module docstring: stands in for production's fresh
        # per-request session. Purely an expire (no IO, nothing pending
        # between requests), so it can neither hide nor invent state.
        db_session.expire_all()
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    """The actor for every request from here on. The User handed back is
    DETACHED (see _actors) — resolve_permission reads `user.role_id` as a
    plain attribute, so it must already be loaded rather than expirable by
    the per-request expire above. In production it is: get_current_user
    loads it inside the request's own session.
    """
    app.dependency_overrides[get_current_user] = lambda: user


def _dec(value) -> Decimal:
    """Money off the wire, as a Decimal. Going through str() first means the
    assertion holds whichever JSON form a route produces (a quoted "2750.50"
    from a Decimal-typed response model, or a bare number from an un-modelled
    dict route) and never through a float, which cannot represent paise
    exactly. Decimal comparison is numeric, so 2750.5 == Decimal("2750.50").
    """
    return Decimal(str(value))


# =========================================================== shared scaffolding
async def _actors(db_session) -> dict[str, User]:
    ids = await seed_canonical(db_session)
    users = {
        code: await db_session.get(User, ids[f"user:{code}"])
        for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")
    }
    # Expunged so these five stay fully loaded and detached: the client
    # fixture expires the shared session once per request, and get_current_user
    # is overridden to hand back one of these instances directly, so an
    # attached (and therefore expirable) User would lazy-load `role_id` inside
    # resolve_permission and raise MissingGreenlet. Every route still re-reads
    # whatever it needs by id through an awaited db.get().
    for user in users.values():
        db_session.expunge(user)
    return users


async def _seed_finance_masters(db_session) -> dict[str, str]:
    """Exactly what these three flows' routes actually look up — a current
    Financial Year, the INV/CN/PB number prefix rules, a Payment Mode, a Bank
    Account, a Customer, an approved active Vendor, a sales tax head, a
    withholding head carrying the ON_PAYMENTS_MADE direction, and one
    Reimbursable Expense Type.

    Returns IDS, never ORM instances: the client fixture expires the session
    on every request, so a held instance would be stale and a plain attribute
    access on it would lazy-load outside a greenlet. Anything a test needs to
    re-read is re-fetched with an awaited `db_session.get(...)`.

    Foreign keys are not enforced on the SQLite test engine (documented in
    tests/test_expense_toggles.py), so Department/Designation/EmploymentType —
    which none of these routes ever query — are left as placeholder ids on the
    Employee row below rather than seeded.
    """
    fy = FinancialYear(
        id=str(uuid.uuid4()), label="FY-FLOWS", start_date=TODAY - timedelta(days=180),
        end_date=TODAY + timedelta(days=185), is_current=True,
    )
    prefix_rules = [
        NumberPrefixRule(
            id=str(uuid.uuid4()), code_type=code_type, label=label, prefix=code_type,
            include_fy_in_code=True, running_number_digits=4, starting_number=1,
        )
        for code_type, label in (("INV", "Invoice"), ("CN", "Credit Note"), ("PB", "Purchase Bill"))
    ]
    payment_mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer", code="BANK", requires_reference_number=False)
    bank_account = BankAccount(
        id=str(uuid.uuid4()), nickname="Primary Current", bank_name="HDFC Bank",
        account_holder_name="Meshrd Technologies", account_number="500100200300", account_type="CURRENT",
        ifsc="HDFC0000123", branch="Coimbatore",
    )
    customer_status = CustomerStatus(id=str(uuid.uuid4()), name="Active", code="ACTIVE")
    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-FLOW-1", financial_year_id=fy.id,
        company_name="Northwind Traders", status_id=customer_status.id,
    )
    vendor = Vendor(
        id=str(uuid.uuid4()), vendor_name="Contoso Components", payment_terms_days=30, is_active=True,
        approval_status="approved", bank_account_name="Contoso Components", bank_name="ICICI Bank",
        bank_account_number="777100200300", ifsc_code="ICIC0000456",
    )
    sales_tax_head = TaxHead(
        id=str(uuid.uuid4()), tax_name="Sales Tax 18%", short_code="ST18", scope="SALES_BILLING",
        tax_type="PERCENTAGE", applies_from=TAX_IN_FORCE_FROM, rate_pct=Decimal("18.0000"), is_active=True,
    )
    withholding_head = TaxHead(
        id=str(uuid.uuid4()), tax_name="Withholding 10%", short_code="WH10", scope="WITHHOLDING_AT_SOURCE",
        tax_type="PERCENTAGE", applies_from=TAX_IN_FORCE_FROM, rate_pct=Decimal("10.0000"), is_active=True,
    )
    # validate_head_usable(required_direction="ON_PAYMENTS_MADE") refuses a
    # withholding head that does not carry this row — a purchase bill can only
    # withhold on money going OUT.
    withholding_direction = TaxHeadWithholdingDirection(
        id=str(uuid.uuid4()), tax_head_id=withholding_head.id, direction="ON_PAYMENTS_MADE",
    )
    expense_type = ExpenseType(
        id=str(uuid.uuid4()), name="Travel", short_code="TRV", claim_type="REIMBURSABLE", is_recurring=False,
    )

    db_session.add_all(
        [fy, *prefix_rules, payment_mode, bank_account, customer_status, customer, vendor,
         sales_tax_head, withholding_head, withholding_direction, expense_type]
    )
    await db_session.commit()
    return {
        "financial_year_id": fy.id, "payment_mode_id": payment_mode.id, "bank_account_id": bank_account.id,
        "customer_id": customer.id, "vendor_id": vendor.id, "sales_tax_head_id": sales_tax_head.id,
        "withholding_head_id": withholding_head.id, "expense_type_id": expense_type.id,
    }


async def _link_employee(db_session, user: User, financial_year_id: str) -> str:
    """create_expense_claim 404s a login with no Employee row behind it
    (org_scope.get_own_employee_id) — ownership in this codebase is an
    employee_id, never a user_id.
    """
    tag = uuid.uuid4().hex[:8]
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{tag}", code_financial_year_id=financial_year_id,
        first_name=user.full_name, email=f"{tag}.flows@test.local", department_id="dept-1",
        designation_id="desig-1", employment_type_id="emptype-1", joining_date=TODAY - timedelta(days=900),
        user_id=user.id,
    )
    db_session.add(employee)
    await db_session.commit()
    return employee.id


async def _set_toggle(db_session, toggle_key: str, *, enabled: bool) -> None:
    row = (
        await db_session.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))
    ).scalar_one_or_none()
    if row is None:
        db_session.add(
            FeatureToggle(
                id=str(uuid.uuid4()), toggle_key=toggle_key, module_key="expense", label=toggle_key,
                enabled=enabled, default_enabled=False,
            )
        )
    else:
        row.enabled = enabled
    await db_session.commit()


def _invoice_payload(customer_id: str, tax_head_id: str, **overrides) -> dict:
    """One 118,000 invoice, reused by create and by the locked-edit attempt so
    the PUT differs from the original only in the field it tries to change.

      Implementation     4 x 15,000 = 60,000
      Support retainer   2 x 20,000 = 40,000
                         subtotal   = 100,000
      tax @ 18% of 100,000          =  18,000
      grand total                   = 118,000
    """
    body = {
        "customer_id": customer_id,
        "invoice_date": INVOICE_DATE.isoformat(),
        "due_date": DUE_DATE.isoformat(),
        "tax_head_id": tax_head_id,
        "line_items": [
            {"description": "Implementation", "quantity": "4", "rate": "15000"},
            {"description": "Support retainer", "quantity": "2", "rate": "20000"},
        ],
    }
    body.update(overrides)
    return body


# =============================================================================
# FLOW 1 — Invoice: draft -> send -> part-pay -> pay -> LOCKED -> credit note
# =============================================================================
async def test_invoice_flow_paid_invoice_locks_and_a_credit_note_reduces_the_balance_without_reopening_it(
    db_session, client
):
    users = await _actors(db_session)
    masters = await _seed_finance_masters(db_session)
    accountant, super_admin = users["ACCOUNTANT"], users["SUPER_ADMIN"]

    # ------------------------------------------------------------- DRAFT
    _as(accountant)
    created = await client.post(
        "/api/v1/invoices", json=_invoice_payload(masters["customer_id"], masters["sales_tax_head_id"])
    )
    assert created.status_code == 201, created.text
    invoice = created.json()
    invoice_id = invoice["id"]
    # 60,000 + 40,000 = 100,000 subtotal; 100,000 x 18% = 18,000 tax;
    # 100,000 + 18,000 = 118,000 grand total, none of it received yet.
    assert _dec(invoice["subtotal"]) == Decimal("100000.00")
    assert _dec(invoice["tax_amount"]) == Decimal("18000.00")
    assert _dec(invoice["grand_total"]) == Decimal("118000.00")
    assert _dec(invoice["claim_amount"]) == Decimal("118000.00")
    assert _dec(invoice["balance_due"]) == Decimal("118000.00")
    assert invoice["status"] == "DRAFT"
    assert invoice["is_locked"] is False
    assert len(invoice["line_items"]) == 2
    assert _dec(invoice["line_items"][0]["line_total"]) == Decimal("60000.00")
    assert _dec(invoice["line_items"][1]["line_total"]) == Decimal("40000.00")
    support_line_id = invoice["line_items"][1]["id"]

    # A Draft is not collectable — Draft -> Sent is an explicit action, never
    # payment-derived, so the send step below is load-bearing, not decorative.
    premature = await client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "amount_received": "1000", "payment_mode_id": masters["payment_mode_id"],
            "payment_date": FIRST_PAYMENT_DATE.isoformat(),
        },
    )
    assert premature.status_code == 409, premature.text

    # -------------------------------------------------------------- SEND
    sent = await client.post(f"/api/v1/invoices/{invoice_id}/send")
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "SENT"
    assert sent.json()["sent_at"] is not None
    assert _dec(sent.json()["balance_due"]) == Decimal("118000.00")

    # ---------------------------------------------------------- PART-PAY
    part = await client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "amount_received": "40000", "payment_mode_id": masters["payment_mode_id"],
            "received_into_bank_account_id": masters["bank_account_id"],
            "payment_date": FIRST_PAYMENT_DATE.isoformat(), "reference": "NEFT-0001",
        },
    )
    assert part.status_code == 201, part.text
    assert _dec(part.json()["amount_received"]) == Decimal("40000.00")
    assert _dec(part.json()["balance_due_at_entry"]) == Decimal("118000.00")

    after_part = (await client.get(f"/api/v1/invoices/{invoice_id}")).json()
    # 118,000 - 40,000 = 78,000 still owed.
    assert after_part["status"] == "PART_PAID"
    assert _dec(after_part["amount_received"]) == Decimal("40000.00")
    assert _dec(after_part["balance_due"]) == Decimal("78000.00")
    assert after_part["is_locked"] is False

    # A payment cannot exceed what is actually left — one paise over the
    # 78,000 balance is refused, which is what makes the figure above real.
    overpay = await client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "amount_received": "78000.01", "payment_mode_id": masters["payment_mode_id"],
            "payment_date": SECOND_PAYMENT_DATE.isoformat(),
        },
    )
    assert overpay.status_code == 422, overpay.text

    # --------------------------------------------------- PAY -> LOCKED
    final = await client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "amount_received": "78000", "payment_mode_id": masters["payment_mode_id"],
            "received_into_bank_account_id": masters["bank_account_id"],
            "payment_date": SECOND_PAYMENT_DATE.isoformat(), "reference": "NEFT-0002",
        },
    )
    assert final.status_code == 201, final.text
    assert _dec(final.json()["balance_due_at_entry"]) == Decimal("78000.00")

    paid = (await client.get(f"/api/v1/invoices/{invoice_id}")).json()
    # 40,000 + 78,000 = 118,000 received against a 118,000 claim -> Paid.
    assert paid["status"] == "PAID"
    assert _dec(paid["amount_received"]) == Decimal("118000.00")
    assert _dec(paid["balance_due"]) == Decimal("0.00")
    assert paid["paid_at"] is not None
    assert paid["is_locked"] is True

    # THE LOCK, asserted as behaviour and not just as a flag: a direct PUT is
    # refused, and so is a further payment.
    blocked_edit = await client.put(
        f"/api/v1/invoices/{invoice_id}",
        json=_invoice_payload(masters["customer_id"], masters["sales_tax_head_id"], notes="editing a paid invoice"),
    )
    assert blocked_edit.status_code == 409, blocked_edit.text
    assert "locked" in blocked_edit.json()["detail"].lower()

    blocked_payment = await client.post(
        f"/api/v1/invoices/{invoice_id}/payments",
        json={
            "amount_received": "1", "payment_mode_id": masters["payment_mode_id"],
            "payment_date": SECOND_PAYMENT_DATE.isoformat(),
        },
    )
    assert blocked_payment.status_code == 409, blocked_payment.text

    # ------------------------------------------------------- CREDIT NOTE
    balance_before_credit = _dec(paid["balance_due"])  # 0.00

    raised = await client.post(
        "/api/v1/credit-notes",
        json={
            "invoice_id": invoice_id, "reason": "BILLING_ERROR",
            "reason_detail": "One month of the support retainer was billed twice",
            "credit_amount": "8000", "line_items_affected": [support_line_id],
        },
    )
    assert raised.status_code == 201, raised.text
    credit_note = raised.json()
    credit_note_id = credit_note["id"]
    assert credit_note["status"] == "DRAFT"
    assert credit_note["credit_note_number"].startswith("CN")
    assert _dec(credit_note["credit_amount"]) == Decimal("8000.00")
    # The whole credit lands on the one line it was raised against.
    assert len(credit_note["line_items"]) == 1
    assert _dec(credit_note["line_items"][0]["credited_amount"]) == Decimal("8000.00")

    submitted = await client.post(f"/api/v1/credit-notes/{credit_note_id}/submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "PENDING_APPROVAL"

    # Approval is the Super Admin's own second signature — the Accountant who
    # raised it cannot also approve it.
    self_approval = await client.post(f"/api/v1/credit-notes/{credit_note_id}/approve")
    assert self_approval.status_code == 403, self_approval.text

    _as(super_admin)
    approved = await client.post(f"/api/v1/credit-notes/{credit_note_id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approved_by"] == super_admin.id

    # ---------- the headline: balance reduced, invoice NOT reopened ----------
    _as(accountant)
    after_credit = (await client.get(f"/api/v1/invoices/{invoice_id}")).json()
    balance_after_credit = _dec(after_credit["balance_due"])

    # THE BALANCE MOVED BY EXACTLY THE CREDIT NOTE AMOUNT:
    #   claim  = 118,000 - 8,000 credited          = 110,000
    #   balance= 110,000 - 118,000 already received =  -8,000
    #   delta  = 0.00 - (-8,000.00)                 =   8,000.00  == credit amount
    assert _dec(after_credit["credit_note_total"]) == Decimal("8000.00")
    assert _dec(after_credit["claim_amount"]) == Decimal("110000.00")
    assert balance_after_credit == Decimal("-8000.00")
    assert balance_before_credit - balance_after_credit == Decimal("8000.00"), (
        "a credit note must move the balance by exactly its own amount"
    )

    # ...AND THE INVOICE DID NOT REOPEN. Status must not fall back to any
    # payable state, the Paid lock must still hold, and the money already
    # received must be untouched.
    assert after_credit["status"] == "PAID"
    assert after_credit["status"] not in ("DRAFT", "SENT", "PART_PAID"), (
        "a credit note reopened a locked invoice"
    )
    assert after_credit["is_locked"] is True
    assert after_credit["paid_at"] == paid["paid_at"]
    assert _dec(after_credit["amount_received"]) == Decimal("118000.00")

    # The original invoice's own figures are a historical record — a credit
    # note corrects what is OWED, it never rewrites what was billed.
    assert _dec(after_credit["subtotal"]) == Decimal("100000.00")
    assert _dec(after_credit["tax_amount"]) == Decimal("18000.00")
    assert _dec(after_credit["grand_total"]) == Decimal("118000.00")
    assert _dec(after_credit["line_items"][0]["credited_amount"]) == Decimal("0.00")
    assert _dec(after_credit["line_items"][1]["credited_amount"]) == Decimal("8000.00")

    # And the lock is still a lock after the credit note, not merely before it.
    still_locked = await client.put(
        f"/api/v1/invoices/{invoice_id}",
        json=_invoice_payload(masters["customer_id"], masters["sales_tax_head_id"], notes="post-credit-note edit"),
    )
    assert still_locked.status_code == 409, still_locked.text


# =============================================================================
# FLOW 2 — Expense: submit -> approve -> reimburse
# =============================================================================
async def test_expense_flow_submit_approve_reimburse_pays_out_the_claimed_amount(db_session, client):
    users = await _actors(db_session)
    masters = await _seed_finance_masters(db_session)
    employee, accountant = users["EMPLOYEE"], users["ACCOUNTANT"]
    await _link_employee(db_session, employee, masters["financial_year_id"])

    # ------------------------------------------------------------ SUBMIT
    _as(employee)
    submitted = await client.post(
        "/api/v1/expenses",
        json={
            "expense_type_id": masters["expense_type_id"], "amount": "2750.50",
            "expense_date": EXPENSE_DATE.isoformat(), "description": "Client site visit — flights and cabs",
            "receipt_stored_file_id": str(uuid.uuid4()),
        },
    )
    assert submitted.status_code == 201, submitted.text
    claim = submitted.json()
    claim_id = claim["id"]
    assert claim["status"] == "PENDING"
    assert claim["claim_type"] == "REIMBURSABLE"
    assert claim["has_receipt"] is True
    assert _dec(claim["amount"]) == Decimal("2750.50")
    assert claim["approved_by"] is None

    # It is in the Accountant's approval queue, and only that one claim is.
    _as(accountant)
    queue = await client.get("/api/v1/expenses/approvals")
    assert queue.status_code == 200, queue.text
    assert [row["id"] for row in queue.json()] == [claim_id]

    # ----------------------------------------------------------- APPROVE
    approved = await client.post(f"/api/v1/expenses/{claim_id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approved_by"] == accountant.id
    assert approved.json()["approved_at"] is not None
    # Approving does not move money: the amount is unchanged and nothing is
    # marked as paid out yet.
    assert _dec(approved.json()["amount"]) == Decimal("2750.50")
    assert approved.json()["reimbursed_at"] is None

    assert (await client.get("/api/v1/expenses/approvals")).json() == []

    # --------------------------------------------------------- REIMBURSE
    reimbursed = await client.post(
        f"/api/v1/expenses/{claim_id}/mark-reimbursed",
        json={
            "reimbursed_date": TODAY.isoformat(), "payment_mode_id": masters["payment_mode_id"],
            "reimbursed_from_bank_account_id": masters["bank_account_id"], "reference": "REIMB-0001",
        },
    )
    assert reimbursed.status_code == 201, reimbursed.text
    payout = reimbursed.json()
    # THE FIGURE THAT MATTERS: the employee is paid the claim, in full and
    # exactly — 2,750.50 claimed, 2,750.50 reimbursed.
    assert _dec(payout["amount"]) == Decimal("2750.50")
    assert payout["expense_claim_id"] == claim_id
    assert payout["reimbursed_from_bank_account_id"] == masters["bank_account_id"]
    assert payout["status"] == "RECORDED"

    _as(employee)
    mine = (await client.get("/api/v1/expenses/me")).json()
    assert len(mine) == 1
    assert mine[0]["status"] == "REIMBURSED"
    assert mine[0]["reimbursed_at"] is not None
    assert mine[0]["bank_account_id"] == masters["bank_account_id"]
    assert _dec(mine[0]["amount"]) == Decimal("2750.50")

    # The §2.3 summary separates money COMMITTED to from money actually PAID
    # OUT; a single reimbursed claim is both, and both are the claim's amount.
    _as(accountant)
    summary = (await client.get("/api/v1/expenses/summary")).json()
    assert _dec(summary["total_spend"]) == Decimal("2750.50")
    assert _dec(summary["total_reimbursed"]) == Decimal("2750.50")
    assert [row["expense_type"] for row in summary["by_expense_type"]] == ["Travel"]
    assert _dec(summary["by_expense_type"][0]["amount"]) == Decimal("2750.50")

    # A claim cannot be reimbursed twice.
    again = await client.post(
        f"/api/v1/expenses/{claim_id}/mark-reimbursed",
        json={
            "reimbursed_date": TODAY.isoformat(), "payment_mode_id": masters["payment_mode_id"],
            "reimbursed_from_bank_account_id": masters["bank_account_id"],
        },
    )
    assert again.status_code == 409, again.text


async def test_receipt_required_toggle_blocks_approval_when_on_and_permits_it_when_off(db_session, client):
    """Both directions, because a toggle that NEVER blocks and a toggle that
    ALWAYS blocks each pass a one-sided test.

      ON  + no receipt  -> refused, and the claim is still PENDING afterwards
      ON  + receipt     -> approves (so the toggle is not just blocking all)
      OFF + no receipt  -> approves (so the block was the toggle, not the claim)

    The state re-reads are the part tests/test_expense_toggles.py does not do:
    that file asserts the 422/200 status codes, this one asserts the claim was
    not quietly approved behind the 422, and that the once-blocked claim can
    still be carried through to a real reimbursement afterwards.
    """
    users = await _actors(db_session)
    masters = await _seed_finance_masters(db_session)
    employee, accountant = users["EMPLOYEE"], users["ACCOUNTANT"]
    await _link_employee(db_session, employee, masters["financial_year_id"])

    _as(employee)
    without_receipt = (
        await client.post(
            "/api/v1/expenses",
            json={
                "expense_type_id": masters["expense_type_id"], "amount": "1400.00",
                "expense_date": EXPENSE_DATE.isoformat(), "description": "Taxi, receipt lost",
            },
        )
    ).json()
    with_receipt = (
        await client.post(
            "/api/v1/expenses",
            json={
                "expense_type_id": masters["expense_type_id"], "amount": "600.00",
                "expense_date": EXPENSE_DATE.isoformat(), "description": "Hotel, receipt attached",
                "receipt_stored_file_id": str(uuid.uuid4()),
            },
        )
    ).json()
    assert without_receipt["has_receipt"] is False
    assert with_receipt["has_receipt"] is True

    # ------------------------------------------------------- toggle ON
    await _set_toggle(db_session, RECEIPT_REQUIRED_TOGGLE, enabled=True)

    _as(accountant)
    blocked = await client.post(f"/api/v1/expenses/{without_receipt['id']}/approve")
    assert blocked.status_code == 422, blocked.text
    assert "receipt" in blocked.json()["detail"].lower()

    # The refusal is real, not cosmetic — nothing about the claim moved.
    still_pending = next(
        row for row in (await client.get("/api/v1/expenses")).json() if row["id"] == without_receipt["id"]
    )
    assert still_pending["status"] == "PENDING"
    assert still_pending["approved_by"] is None
    assert still_pending["approved_at"] is None

    # ...and the toggle is not simply blocking everything: the claim that DOES
    # carry a receipt approves while the toggle is still on.
    permitted_with_receipt = await client.post(f"/api/v1/expenses/{with_receipt['id']}/approve")
    assert permitted_with_receipt.status_code == 200, permitted_with_receipt.text
    assert permitted_with_receipt.json()["status"] == "APPROVED"

    # ------------------------------------------------------ toggle OFF
    await _set_toggle(db_session, RECEIPT_REQUIRED_TOGGLE, enabled=False)

    permitted = await client.post(f"/api/v1/expenses/{without_receipt['id']}/approve")
    assert permitted.status_code == 200, permitted.text
    assert permitted.json()["status"] == "APPROVED"
    assert permitted.json()["approved_by"] == accountant.id

    # The claim the toggle had been holding up now completes the flow, paying
    # out its own amount — proof the block was the only thing in the way.
    payout = await client.post(
        f"/api/v1/expenses/{without_receipt['id']}/mark-reimbursed",
        json={
            "reimbursed_date": TODAY.isoformat(), "payment_mode_id": masters["payment_mode_id"],
            "reimbursed_from_bank_account_id": masters["bank_account_id"],
        },
    )
    assert payout.status_code == 201, payout.text
    assert _dec(payout.json()["amount"]) == Decimal("1400.00")


# =============================================================================
# FLOW 3 — Purchase Bill: record -> pay -> withholding DEDUCTED from payment
# =============================================================================
async def test_purchase_bill_flow_withholding_is_deducted_from_the_vendor_payment_not_added_to_it(
    db_session, client
):
    """A276 rule 3, and the sign error that would overpay every vendor.

      subtotal                                    = 100,000
      tax                                         =       0
      total                                       = 100,000
      withholding @ 10% on subtotal               =  10,000
      amount payable to vendor  100,000 - 10,000  =  90,000   <- DEDUCTED
                                100,000 + 10,000  = 110,000   <- what "added" would give

    Every assertion below is chosen so the two answers cannot both pass: the
    payable figure, the refusal of a 100,000 payment, and the vendor rollups.
    """
    users = await _actors(db_session)
    masters = await _seed_finance_masters(db_session)
    accountant = users["ACCOUNTANT"]

    # ------------------------------------------------------------ RECORD
    _as(accountant)
    recorded = await client.post(
        "/api/v1/purchase-bills",
        json={
            "vendor_id": masters["vendor_id"], "vendor_bill_number": "CC-9981",
            "bill_date": BILL_DATE.isoformat(), "bank_account_id": masters["bank_account_id"],
            "withholding_tax_head_id": masters["withholding_head_id"], "withholding_calculated_on": "SUBTOTAL",
            "line_items": [{"description": "Server rack", "quantity": "1", "rate": "100000"}],
        },
    )
    assert recorded.status_code == 201, recorded.text
    bill = recorded.json()
    bill_id = bill["id"]
    assert _dec(bill["subtotal"]) == Decimal("100000.00")
    assert _dec(bill["tax_amount"]) == Decimal("0.00")
    assert _dec(bill["total_amount"]) == Decimal("100000.00")
    # 100,000 x 10% = 10,000 withheld at source.
    assert _dec(bill["withholding_amount"]) == Decimal("10000.00")
    assert bill["withholding_head_name_snapshot"] == "Withholding 10%"

    # THE DIRECTION. 100,000 - 10,000 = 90,000 goes to the vendor. If the sign
    # were wrong this would read 110,000 and every vendor would be overpaid by
    # twice the withholding.
    assert _dec(bill["amount_payable_to_vendor"]) == Decimal("90000.00")
    assert _dec(bill["amount_payable_to_vendor"]) == _dec(bill["total_amount"]) - _dec(bill["withholding_amount"])
    assert _dec(bill["amount_payable_to_vendor"]) < _dec(bill["total_amount"]), (
        "withholding must reduce what the vendor is paid, never increase it"
    )
    assert _dec(bill["balance_due"]) == Decimal("90000.00")
    assert bill["status"] == "UNPAID"

    # A control bill on the same vendor for the same money, WITHOUT
    # withholding: the only difference between the two payables is the
    # withholding, and its sign is then unambiguous.
    control = await client.post(
        "/api/v1/purchase-bills",
        json={
            "vendor_id": masters["vendor_id"], "vendor_bill_number": "CC-9982",
            "bill_date": BILL_DATE.isoformat(),
            "line_items": [{"description": "Server rack", "quantity": "1", "rate": "100000"}],
        },
    )
    assert control.status_code == 201, control.text
    # 90,000 - 100,000 = -10,000: withholding SUBTRACTS exactly its own amount.
    assert _dec(control.json()["amount_payable_to_vendor"]) == Decimal("100000.00")
    assert _dec(bill["amount_payable_to_vendor"]) - _dec(control.json()["amount_payable_to_vendor"]) == -_dec(
        bill["withholding_amount"]
    )

    # The vendor's own payables rollup follows the same direction:
    #   90,000 (withheld bill) + 100,000 (control bill) = 190,000 outstanding.
    vendor = await db_session.get(Vendor, masters["vendor_id"])
    await db_session.refresh(vendor)
    assert vendor.outstanding_amount == Decimal("190000.00")
    assert vendor.total_spend == Decimal("0.00")

    # --------------------------------------------------------------- PAY
    # Paying the full TOTAL is refused — only 90,000 is actually due. Under an
    # "added" withholding the balance would be 110,000 and this would succeed.
    overpay = await client.post(
        f"/api/v1/purchase-bills/{bill_id}/payments",
        json={
            "amount": "100000", "payment_mode_id": masters["payment_mode_id"],
            "payment_date": FIRST_PAYMENT_DATE.isoformat(),
        },
    )
    assert overpay.status_code == 422, overpay.text
    # The refusal names the real balance — 90,000, not the 110,000 an added
    # withholding would have made payable.
    assert "90000" in overpay.json()["detail"]
    assert "110000" not in overpay.json()["detail"]

    first = await client.post(
        f"/api/v1/purchase-bills/{bill_id}/payments",
        json={
            "amount": "40000", "payment_mode_id": masters["payment_mode_id"],
            "paid_from_bank_account_id": masters["bank_account_id"],
            "payment_date": FIRST_PAYMENT_DATE.isoformat(), "reference": "PAY-0001",
        },
    )
    assert first.status_code == 201, first.text
    assert _dec(first.json()["balance_due_at_entry"]) == Decimal("90000.00")
    # Snapshotted vendor banking, never resolved live.
    assert first.json()["paid_into_bank_name_snapshot"] == "ICICI Bank"

    part_paid = (await client.get(f"/api/v1/purchase-bills/{bill_id}")).json()
    # 90,000 - 40,000 = 50,000 left to pay.
    assert part_paid["status"] == "PART_PAID"
    assert _dec(part_paid["amount_paid"]) == Decimal("40000.00")
    assert _dec(part_paid["balance_due"]) == Decimal("50000.00")

    second = await client.post(
        f"/api/v1/purchase-bills/{bill_id}/payments",
        json={
            "amount": "50000", "payment_mode_id": masters["payment_mode_id"],
            "paid_from_bank_account_id": masters["bank_account_id"],
            "payment_date": SECOND_PAYMENT_DATE.isoformat(), "reference": "PAY-0002",
        },
    )
    assert second.status_code == 201, second.text

    settled = (await client.get(f"/api/v1/purchase-bills/{bill_id}")).json()
    # 40,000 + 50,000 = 90,000 paid, + 10,000 withheld = 100,000 total settled.
    # The bill is Paid even though only 90,000 ever left the bank — comparing
    # payments to Total alone would strand it at Part-Paid forever (A276).
    assert settled["status"] == "PAID"
    assert _dec(settled["amount_paid"]) == Decimal("90000.00")
    assert _dec(settled["balance_due"]) == Decimal("0.00")
    assert settled["paid_at"] is not None
    assert _dec(settled["amount_paid"]) + _dec(settled["withholding_amount"]) == _dec(settled["total_amount"])
    assert _dec(settled["amount_paid"]) < _dec(settled["total_amount"]), (
        "the vendor must be paid LESS than the bill total by exactly the withholding"
    )
    assert _dec(settled["total_amount"]) - _dec(settled["amount_paid"]) == Decimal("10000.00")

    # And the vendor's rollups agree: 90,000 of real spend, and the withheld
    # bill's 90,000 payable is fully cleared (the 100,000 control bill remains).
    vendor = await db_session.get(Vendor, masters["vendor_id"])
    await db_session.refresh(vendor)
    # 190,000 - 40,000 - 50,000 = 100,000 (the untouched control bill).
    assert vendor.outstanding_amount == Decimal("100000.00")
    assert vendor.total_spend == Decimal("90000.00")
    assert vendor.purchase_bill_count == 2
