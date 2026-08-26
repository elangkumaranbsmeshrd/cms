"""Tests for the toggle-gated Purchase Bill business logic in
app/api/v1/purchase_bills.py (13-purchase-bill-module.md §6.2):

  - "Require Attachment Before Marking a Bill Paid" — gates record_payment.
  - "Lock Purchase Bill Once Fully Paid" — gates update_purchase_bill (edit).
  - "Give Manager Read-Only Access to Purchase Bills" — a MODE_TOGGLE_GATES
    entry on purchase_bill.list, widening Manager's mode 'none' -> 'view'.

Plus the toggle-INDEPENDENT "Due Date cannot be before Bill Date" validation,
proven on both create and edit.

No existing test in this suite exercises a FastAPI route or flips a
FeatureToggle row (verified by searching tests/ first, per the task) — this
codebase's own style (tests/rbac, tests/services) is to call the real
functions directly rather than go through an HTTP client, so that's what
this file does too:

  - Route functions (create_purchase_bill / update_purchase_bill /
    record_payment / list_purchase_bills) are awaited directly.
  - `perms` is computed by calling the REAL require_screen() dependency
    closure from app/rbac/deps.py directly (not a hand-built PermissionSet),
    so a 404/403 here is the exact same enforcement a real request hits.
  - RBAC is seeded via tests/conftest.py's seed_canonical(), the same
    canonical-policy seeding tests/rbac already relies on.

One wrinkle from calling FastAPI route/dependency callables directly instead
of through the framework: parameters declared as `Query(None)` / `Header(None)`
do NOT default to None when called as plain Python — the unevaluated
FieldInfo sentinel is truthy. Every such parameter is therefore passed
explicitly below.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.purchase_bills import SCREEN, create_purchase_bill, list_purchase_bills, record_payment, update_purchase_bill
from app.models.finance import PurchaseBill
from app.models.masters import NumberPrefixRule, PaymentMode
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.models.vendor import Vendor
from app.rbac.deps import require_screen
from app.schemas.finance import PurchaseBillCreate, PurchaseBillLineItemIn, PurchaseBillPaymentCreate

from tests.conftest import seed_canonical

REQUIRE_ATTACHMENT = "Require Attachment Before Marking a Bill Paid"
LOCK_ONCE_PAID = "Lock Purchase Bill Once Fully Paid"
MANAGER_READ_ONLY = "Give Manager Read-Only Access to Purchase Bills"


# ------------------------------------------------------------------ helpers
async def _set_toggle(db, toggle_key: str, enabled: bool) -> None:
    row = (await db.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    if row is None:
        db.add(FeatureToggle(id=str(uuid.uuid4()), toggle_key=toggle_key, module_key="purchase_bill", label=toggle_key, enabled=enabled, default_enabled=False))
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


async def _users(db) -> dict[str, User]:
    ids = await seed_canonical(db)
    return {code: await db.get(User, ids[f"user:{code}"]) for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")}


async def _seed_masters(db) -> dict:
    """The minimum every create_purchase_bill call needs: a current
    Financial Year, a Number Prefix Rule for code_type 'PB', a Payment Mode,
    and an active, approved Vendor — no existing purchase-bill fixture exists
    in this suite yet (verified before writing this), so this is the minimal
    version built straight from what the route/schema actually require.
    """
    fy = FinancialYear(id=str(uuid.uuid4()), label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True)
    rule = NumberPrefixRule(id=str(uuid.uuid4()), code_type="PB", label="Purchase Bill", prefix="PB", include_fy_in_code=True, running_number_digits=4, starting_number=1)
    mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer", code="BANK", requires_reference_number=False)
    vendor = Vendor(id=str(uuid.uuid4()), vendor_name="Acme Supplies", payment_terms_days=30, is_active=True, approval_status="approved")
    db.add_all([fy, rule, mode, vendor])
    await db.commit()
    # Vendor.bank_account_number_masked/has_bank_details are DB-generated
    # (Computed) columns — never set by the ORM insert, so the instance must
    # be refreshed before record_payment reads them (an un-refreshed access
    # would try to lazy-load synchronously and blow up with MissingGreenlet
    # under AsyncSession).
    await db.refresh(vendor)
    return {"fy": fy, "payment_mode": mode, "vendor": vendor}


def _line_items() -> list[PurchaseBillLineItemIn]:
    return [PurchaseBillLineItemIn(description="Widgets", quantity=Decimal("10"), rate=Decimal("100"))]  # subtotal 1000, no tax/withholding


async def _create_bill(db, accountant: User, vendor_id: str, *, bill_date=None, due_date=None, attachment_stored_file_id=None, vendor_bill_number="VB-1") -> PurchaseBill:
    perms = await _perms(db, accountant, action="edit")
    body = PurchaseBillCreate(
        vendor_id=vendor_id, vendor_bill_number=vendor_bill_number, bill_date=bill_date or date(2026, 8, 1), due_date=due_date,
        attachment_stored_file_id=attachment_stored_file_id, line_items=_line_items(),
    )
    out = await create_purchase_bill(body=body, db=db, current_user=accountant, perms=perms)
    return await db.get(PurchaseBill, out.id)


def _edit_body(bill: PurchaseBill, **overrides) -> PurchaseBillCreate:
    data = dict(
        vendor_id=bill.vendor_id, vendor_bill_number=bill.vendor_bill_number, bill_date=bill.bill_date, due_date=bill.due_date,
        attachment_stored_file_id=bill.attachment_stored_file_id, linked_expense_claim_id=bill.linked_expense_claim_id, line_items=_line_items(),
    )
    data.update(overrides)
    return PurchaseBillCreate(**data)


async def _record_payment(db, user: User, bill: PurchaseBill, amount: Decimal, payment_mode_id: str):
    perms = await _perms(db, user, action="record_payment")
    # create_purchase_bill's own vendor-rollup UPDATE (purchase_bill_count/
    # outstanding_amount/...) marks the vendor row's OTHER Computed columns
    # (bank_account_number_masked, has_bank_details) expired as a side
    # effect — SQLAlchemy defensively re-fetches every generated column after
    # any UPDATE to a row, not just the ones whose inputs changed. Refresh
    # explicitly so record_payment's own read of those columns (snapshotting
    # them onto the payment) is an already-loaded attribute access, not an
    # implicit lazy-load — the latter raises MissingGreenlet under AsyncSession.
    vendor = await db.get(Vendor, bill.vendor_id)
    await db.refresh(vendor)
    body = PurchaseBillPaymentCreate(amount=amount, payment_mode_id=payment_mode_id, payment_date=date(2026, 8, 10))
    return await record_payment(bill_id=bill.id, body=body, db=db, current_user=user, perms=perms)


async def _call_list(db, user: User, **overrides):
    perms = await _perms(db, user)
    kwargs = dict(
        db=db, current_user=user, perms=perms, vendor_id=None, status_filter=None, financial_year_id=None,
        bill_date_from=None, bill_date_to=None, due_date_from=None, due_date_to=None, amount_min=None, amount_max=None,
        outstanding_min=None, outstanding_max=None, payment_mode_id=None, bank_account_id=None, created_by=None,
        last_modified_by=None, overdue=None, ageing=None, search=None, format=None,
    )
    kwargs.update(overrides)
    return await list_purchase_bills(**kwargs)


# ============================== 1. Require Attachment Before Marking a Bill Paid — ON
async def test_require_attachment_on_rejects_payment_without_attachment(db_session):
    """ON, and the bill has no attachment_stored_file_id: record_payment is
    rejected 422, even for a partial payment (the toggle gates recording
    itself, not just the payment that would reach Paid)."""
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    bill = await _create_bill(db_session, accountant, masters["vendor"].id)
    assert bill.has_attachment is False
    await _set_toggle(db_session, REQUIRE_ATTACHMENT, True)

    with pytest.raises(HTTPException) as exc:
        await _record_payment(db_session, accountant, bill, Decimal("500"), masters["payment_mode"].id)
    assert exc.value.status_code == 422
    assert "attached" in exc.value.detail.lower()


async def test_require_attachment_on_allows_payment_with_attachment(db_session):
    """ON, but the bill DOES have an attachment_stored_file_id: the gate does
    not fire, and the payment is recorded normally."""
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    bill = await _create_bill(db_session, accountant, masters["vendor"].id, attachment_stored_file_id=str(uuid.uuid4()))
    assert bill.has_attachment is True
    await _set_toggle(db_session, REQUIRE_ATTACHMENT, True)

    payment = await _record_payment(db_session, accountant, bill, Decimal("500"), masters["payment_mode"].id)
    assert payment.amount == Decimal("500")
    assert bill.status == "PART_PAID"


# ============================== 2. Require Attachment Before Marking a Bill Paid — OFF
async def test_require_attachment_off_allows_payment_without_attachment(db_session):
    """OFF (the default): record_payment succeeds on an unattached bill."""
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    bill = await _create_bill(db_session, accountant, masters["vendor"].id)
    assert bill.has_attachment is False
    # Toggle left untouched -> defaults to OFF (no FeatureToggle row at all).

    payment = await _record_payment(db_session, accountant, bill, Decimal("500"), masters["payment_mode"].id)
    assert payment.amount == Decimal("500")
    assert bill.status == "PART_PAID"


# ============================== 3. Lock Purchase Bill Once Fully Paid — ON
async def test_lock_once_paid_on_rejects_edit_of_paid_bill_but_allows_edit_of_unpaid_bill(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]

    paid_bill = await _create_bill(db_session, accountant, masters["vendor"].id, vendor_bill_number="VB-PAID")
    await _record_payment(db_session, accountant, paid_bill, Decimal("1000"), masters["payment_mode"].id)  # full amount -> PAID
    assert paid_bill.status == "PAID"

    unpaid_bill = await _create_bill(db_session, accountant, masters["vendor"].id, vendor_bill_number="VB-UNPAID")
    assert unpaid_bill.status == "UNPAID"

    await _set_toggle(db_session, LOCK_ONCE_PAID, True)
    edit_perms = await _perms(db_session, accountant, action="edit")

    with pytest.raises(HTTPException) as exc:
        await update_purchase_bill(bill_id=paid_bill.id, body=_edit_body(paid_bill, notes="tried to edit a paid bill"), db=db_session, current_user=accountant, perms=edit_perms)
    assert exc.value.status_code == 409

    result = await update_purchase_bill(bill_id=unpaid_bill.id, body=_edit_body(unpaid_bill, notes="edited fine"), db=db_session, current_user=accountant, perms=edit_perms)
    assert result.notes == "edited fine"


# ============================== 4. Lock Purchase Bill Once Fully Paid — OFF
async def test_lock_once_paid_off_allows_edit_of_paid_bill(db_session):
    """OFF (the default): a Paid bill stays editable — the pre-existing
    behaviour this toggle is layered on top of."""
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]

    bill = await _create_bill(db_session, accountant, masters["vendor"].id)
    await _record_payment(db_session, accountant, bill, Decimal("1000"), masters["payment_mode"].id)
    assert bill.status == "PAID"
    # Toggle left untouched -> defaults to OFF.

    edit_perms = await _perms(db_session, accountant, action="edit")
    result = await update_purchase_bill(bill_id=bill.id, body=_edit_body(bill, notes="still editable"), db=db_session, current_user=accountant, perms=edit_perms)
    assert result.notes == "still editable"


# ============================== 5. Give Manager Read-Only Access to Purchase Bills — OFF
async def test_manager_readonly_off_get_list_is_404(db_session):
    """OFF (the default, seed.py: Manager mode 'none'): GET /purchase-bills
    as Manager is a 404 — Layer 1 says the screen doesn't exist for them."""
    users = await _users(db_session)
    with pytest.raises(HTTPException) as exc:
        await _call_list(db_session, users["MANAGER"])
    assert exc.value.status_code == 404


# ============================== 6. Give Manager Read-Only Access to Purchase Bills — ON
async def test_manager_readonly_on_get_list_succeeds(db_session):
    """ON: Manager's mode widens 'none' -> 'view', so the list call succeeds."""
    users = await _users(db_session)
    await _set_toggle(db_session, MANAGER_READ_ONLY, True)

    result = await _call_list(db_session, users["MANAGER"])
    assert isinstance(result, list)


async def test_manager_readonly_on_still_blocks_write_actions(db_session):
    """ON: Manager can SEE the screen now, but has no 'record_payment' or
    'edit' action grant on it (no paired ACTION_TOGGLE_GATES entry exists for
    this toggle — it only ever widens the mode) — both still 403."""
    users = await _users(db_session)
    await _set_toggle(db_session, MANAGER_READ_ONLY, True)
    manager = users["MANAGER"]

    with pytest.raises(HTTPException) as exc_payment:
        await _perms(db_session, manager, action="record_payment")
    assert exc_payment.value.status_code == 403

    with pytest.raises(HTTPException) as exc_edit:
        await _perms(db_session, manager, action="edit")
    assert exc_edit.value.status_code == 403


# ============================== 7. Due Date cannot be before Bill Date (unrelated to any toggle)
async def test_due_date_before_bill_date_rejected_on_create(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    perms = await _perms(db_session, accountant, action="edit")
    body = PurchaseBillCreate(
        vendor_id=masters["vendor"].id, vendor_bill_number="VB-BAD-DATES", bill_date=date(2026, 8, 10), due_date=date(2026, 8, 1),
        line_items=_line_items(),
    )

    with pytest.raises(HTTPException) as exc:
        await create_purchase_bill(body=body, db=db_session, current_user=accountant, perms=perms)
    assert exc.value.status_code == 422
    assert "Due Date" in exc.value.detail


async def test_due_date_before_bill_date_rejected_on_edit(db_session):
    users = await _users(db_session)
    masters = await _seed_masters(db_session)
    accountant = users["ACCOUNTANT"]
    bill = await _create_bill(db_session, accountant, masters["vendor"].id)
    edit_perms = await _perms(db_session, accountant, action="edit")
    bad_body = _edit_body(bill, due_date=bill.bill_date - timedelta(days=1))

    with pytest.raises(HTTPException) as exc:
        await update_purchase_bill(bill_id=bill.id, body=bad_body, db=db_session, current_user=accountant, perms=edit_perms)
    assert exc.value.status_code == 422
    assert "Due Date" in exc.value.detail
