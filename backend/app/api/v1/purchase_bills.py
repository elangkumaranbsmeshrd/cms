"""Purchase Bill (13-purchase-bill-module.md) — List (§2.1), Add/Edit
(§2.2), Record Payment (§2.3). A276's withholding rules, this phase's
double-payment guard (finance_link_guard.py), and vendor usage rollups all
come together in confirm/record_payment below.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.finance import PurchaseBill, PurchaseBillLineItem, PurchaseBillPayment, PurchaseBillTaxLine
from app.models.masters import HsnSacCode, TaxHead
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.models.vendor import Vendor
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.finance import PurchaseBillCreate, PurchaseBillOut, PurchaseBillPaymentCreate, PurchaseBillPaymentOut
from app.services import list_export, tax_engine
from app.services.finance_engine import ageing_bucket, resolve_purchase_bill_status
from app.services.finance_link_guard import check_purchase_bill_payment_guard
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec
from app.services.tax_head_lookup import build_tax_head_snapshot, validate_head_usable

_TAX_SCOPES = ("PURCHASE", "SALES_AND_PURCHASE")
_WITHHOLDING_SCOPES = ("WITHHOLDING_AT_SOURCE",)

# Appendix A, A265: no PDF "Download" document is built for Purchase Bill —
# unlike Invoice, there's no external party to send this to. Filtered
# list export (PDF/Excel) is unaffected; only a single-document PDF is excluded.
_LIST_COLUMNS = [
    ColumnSpec("bill_number", "Bill Number"),
    ColumnSpec("vendor", "Vendor"),
    ColumnSpec("bill_date", "Bill Date"),
    ColumnSpec("due_date", "Due Date"),
    ColumnSpec("total", "Total", align="left"),
    ColumnSpec("status", "Status"),
]

router = APIRouter(prefix="/purchase-bills", tags=["purchase_bill"])
SCREEN = "purchase_bill.list"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


@router.get("", response_model=None)
async def list_purchase_bills(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    vendor_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    financial_year_id: str | None = Query(None),
    bill_date_from: date_type | None = Query(None),
    bill_date_to: date_type | None = Query(None),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    amount_min: Decimal | None = Query(None, description="Total"),
    amount_max: Decimal | None = Query(None, description="Total"),
    outstanding_min: Decimal | None = Query(None, description="Balance Due"),
    outstanding_max: Decimal | None = Query(None, description="Balance Due"),
    payment_mode_id: str | None = Query(None, description="Any payment recorded against the bill used this mode"),
    bank_account_id: str | None = Query(None, description="The bill's own account, or any account a payment was made from"),
    created_by: str | None = Query(None, description="Super Admin only"),
    last_modified_by: str | None = Query(None, description="Super Admin only"),
    overdue: bool | None = Query(None),
    ageing: str | None = Query(None, description="Current | 1-30 | 31-60 | 61-90 | 90+"),
    search: str | None = Query(None, description="Matches Vendor Bill Number, Internal Bill ID, Supplier Name"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[PurchaseBillOut] | Response:
    stmt = select(PurchaseBill)
    if vendor_id:
        stmt = stmt.where(PurchaseBill.vendor_id == vendor_id)
    if status_filter:
        stmt = stmt.where(PurchaseBill.status.in_(status_filter))
    if financial_year_id:
        stmt = stmt.where(PurchaseBill.financial_year_id == financial_year_id)
    if bill_date_from:
        stmt = stmt.where(PurchaseBill.bill_date >= bill_date_from)
    if bill_date_to:
        stmt = stmt.where(PurchaseBill.bill_date <= bill_date_to)
    if due_date_from:
        stmt = stmt.where(PurchaseBill.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(PurchaseBill.due_date <= due_date_to)
    if amount_min is not None:
        stmt = stmt.where(PurchaseBill.total_amount >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(PurchaseBill.total_amount <= amount_max)
    if outstanding_min is not None:
        stmt = stmt.where(PurchaseBill.balance_due >= outstanding_min)
    if outstanding_max is not None:
        stmt = stmt.where(PurchaseBill.balance_due <= outstanding_max)
    if payment_mode_id:
        paid_bill_ids = (await db.execute(select(PurchaseBillPayment.purchase_bill_id).where(PurchaseBillPayment.payment_mode_id == payment_mode_id))).scalars().all()
        stmt = stmt.where(PurchaseBill.id.in_(set(paid_bill_ids))) if paid_bill_ids else stmt.where(PurchaseBill.id.is_(None))
    if bank_account_id:
        # §2.1's own "effective" Bank Account (2026-07-31) — the account
        # named on the bill, OR the account any payment actually left from —
        # so this filter matches the same figure the List's own Bank Account
        # column already shows, not just the bill's own declared account.
        paid_from_ids = (await db.execute(select(PurchaseBillPayment.purchase_bill_id).where(PurchaseBillPayment.paid_from_bank_account_id == bank_account_id))).scalars().all()
        stmt = stmt.where((PurchaseBill.bank_account_id == bank_account_id) | (PurchaseBill.id.in_(set(paid_from_ids))))
    if created_by:
        stmt = stmt.where(PurchaseBill.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(PurchaseBill.updated_by == last_modified_by)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(PurchaseBill.vendor_bill_number.ilike(pattern) | PurchaseBill.purchase_bill_code.ilike(pattern) | PurchaseBill.vendor_name_snapshot.ilike(pattern))
    rows = (await db.execute(stmt.order_by(PurchaseBill.bill_date.desc()))).scalars().all()

    today = date_type.today()
    filtered = []
    for bill in rows:
        bucket = ageing_bucket(bill.due_date, today, bill.status == "PAID")
        if overdue is not None:
            is_overdue = bucket is not None and bucket.label != "Current"
            if overdue != is_overdue:
                continue
        if ageing is not None and (bucket is None or bucket.label != ageing):
            continue
        filtered.append(bill)

    if format:
        # RBAC §2.2(f): export exactly the filtered/searched set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        export_rows = [
            {
                "bill_number": bill.purchase_bill_code, "vendor": bill.vendor_name_snapshot, "bill_date": bill.bill_date,
                "due_date": bill.due_date, "total": bill.total_amount, "status": bill.status,
            }
            for bill in filtered
        ]
        filters_applied = {
            "vendor_id": vendor_id, "status": status_filter, "financial_year_id": financial_year_id,
            "bill_date_from": bill_date_from, "bill_date_to": bill_date_to, "due_date_from": due_date_from, "due_date_to": due_date_to,
            "amount_min": amount_min, "amount_max": amount_max, "outstanding_min": outstanding_min, "outstanding_max": outstanding_max,
            "payment_mode_id": payment_mode_id, "bank_account_id": bank_account_id, "created_by": created_by, "last_modified_by": last_modified_by,
            "overdue": overdue, "ageing": ageing, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Purchase Bills", _LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_bill_out(db, bill) for bill in filtered]


async def _load_bill_out(db: AsyncSession, bill: PurchaseBill) -> PurchaseBillOut:
    lines = (await db.execute(select(PurchaseBillLineItem).where(PurchaseBillLineItem.purchase_bill_id == bill.id).order_by(PurchaseBillLineItem.sequence))).scalars().all()
    tax_lines = (await db.execute(select(PurchaseBillTaxLine).where(PurchaseBillTaxLine.purchase_bill_id == bill.id).order_by(PurchaseBillTaxLine.sequence))).scalars().all()
    latest_payment = (
        await db.execute(
            select(PurchaseBillPayment).where(PurchaseBillPayment.purchase_bill_id == bill.id, PurchaseBillPayment.status == "RECORDED")
            .order_by(PurchaseBillPayment.payment_date.desc())
        )
    ).scalars().first()
    out = PurchaseBillOut.model_validate(bill)
    out.line_items = list(lines)
    out.tax_lines = list(tax_lines)
    out.effective_bank_account_id = latest_payment.paid_from_bank_account_id if latest_payment else bill.bank_account_id
    return out


@router.post("", response_model=PurchaseBillOut, status_code=status.HTTP_201_CREATED)
async def create_purchase_bill(
    body: PurchaseBillCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> PurchaseBillOut:
    vendor = await db.get(Vendor, body.vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Vendor not found")
    if not vendor.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cannot bill an inactive vendor")
    # Vendor §6.1 "Require Approval to Add a New Vendor" — "new vendors need
    # Accountant or Super Admin sign-off before they can be used on a
    # Purchase Bill." Mirrors the inactive-vendor gate directly above; same
    # asymmetry as that gate's own precedent (Vendor §3.3's "Differs" note:
    # server-enforced on Purchase Bill only, a picker-only concern on Expense).
    if vendor.approval_status == "pending_approval":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This vendor is pending approval and cannot be billed yet")
    if body.bill_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bill Date cannot be in the future")
    if body.due_date is not None and body.due_date < body.bill_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Due Date cannot be before Bill Date")
    fy = await get_current_financial_year(db)
    code = await allocate_number(db, "PB", fy.id, fy.label)

    subtotal = sum((li.quantity * li.rate for li in body.line_items), Decimal("0"))

    tax_amount = Decimal("0")
    tax_lines: list[dict] = []
    if body.tax_head_id is not None:
        head = await db.get(TaxHead, body.tax_head_id)
        if head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
        block_reason = await validate_head_usable(db, head, _TAX_SCOPES, body.bill_date)
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
        snapshot = await build_tax_head_snapshot(db, head)
        result = tax_engine.calculate_tax(snapshot, subtotal)
        tax_amount = body.tax_amount_override if body.tax_amount_override is not None else result.computed_amount
        for seq, comp in enumerate(result.components or [tax_engine.ComponentAmount(head.tax_name, tax_amount)], start=1):
            tax_lines.append({
                "sequence": seq, "tax_head_id": head.id, "head_name_snapshot": head.tax_name, "print_label_snapshot": head.print_label or head.tax_name,
                "scope_snapshot": head.scope, "tax_type_snapshot": head.tax_type, "rate_snapshot": head.rate_pct,
                "cgst_rate_snapshot": head.cgst_rate_pct, "sgst_rate_snapshot": head.sgst_rate_pct, "fixed_amount_snapshot": head.fixed_amount,
                "computed_base": subtotal, "computed_amount": comp.amount, "entered_amount": (tax_amount if len(result.components or ()) <= 1 else comp.amount),
                "component_name_snapshot": comp.component_name if result.components else None,
            })
    elif body.tax_amount_override is not None:
        tax_amount = body.tax_amount_override

    total_amount = subtotal + tax_amount

    withholding_amount = Decimal("0")
    withholding_head_name = None
    withholding_rate = None
    withholding_calculated_on = body.withholding_calculated_on
    if body.withholding_tax_head_id is not None:
        wh_head = await db.get(TaxHead, body.withholding_tax_head_id)
        if wh_head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Withholding tax head not found")
        block_reason = await validate_head_usable(db, wh_head, _WITHHOLDING_SCOPES, body.bill_date, required_direction="ON_PAYMENTS_MADE")
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
        withholding_calculated_on = body.withholding_calculated_on or "SUBTOTAL"  # persist what actually drove the calc
        basis = subtotal if withholding_calculated_on == "SUBTOTAL" else total_amount
        snapshot = await build_tax_head_snapshot(db, wh_head)
        result = tax_engine.calculate_tax(snapshot, basis)
        withholding_amount = body.withholding_amount_override if body.withholding_amount_override is not None else result.computed_amount
        withholding_head_name = wh_head.tax_name
        withholding_rate = wh_head.rate_pct
        if withholding_amount > total_amount:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Withholding Amount cannot exceed the bill Total")

    linked_claim = None
    if body.linked_expense_claim_id is not None:
        from app.models.finance import ExpenseClaim

        linked_claim = await db.get(ExpenseClaim, body.linked_expense_claim_id)
        if linked_claim is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Linked Expense Claim not found")
        if linked_claim.linked_purchase_bill_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="That Expense Claim is already linked to a different Purchase Bill")

    # A257/A275: Due Date auto-derives from Bill Date + the vendor's own
    # Payment Terms when left blank, so ageing/overdue never silently opts
    # out just because the field was skipped.
    due_date = body.due_date or (body.bill_date + timedelta(days=vendor.payment_terms_days))

    bill = PurchaseBill(
        id=str(uuid.uuid4()), purchase_bill_code=code, vendor_bill_number=body.vendor_bill_number, vendor_id=vendor.id,
        financial_year_id=fy.id, vendor_name_snapshot=vendor.vendor_name, vendor_gstin_snapshot=vendor.gstin,
        bill_date=body.bill_date, due_date=due_date, payment_terms_days_snapshot=vendor.payment_terms_days,
        attachment_stored_file_id=body.attachment_stored_file_id, bank_account_id=body.bank_account_id,
        linked_expense_claim_id=body.linked_expense_claim_id, subtotal=subtotal, tax_head_id=body.tax_head_id, tax_amount=tax_amount,
        tax_amount_is_manual_override=(body.tax_amount_override is not None),
        withholding_tax_head_id=body.withholding_tax_head_id, withholding_calculated_on=withholding_calculated_on,
        withholding_amount=withholding_amount, withholding_amount_is_manual_override=(body.withholding_amount_override is not None),
        withholding_head_name_snapshot=withholding_head_name, withholding_rate_snapshot=withholding_rate, notes=body.notes,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(bill)
    if linked_claim is not None:
        linked_claim.linked_purchase_bill_id = bill.id
        linked_claim.updated_by = current_user.id
    await db.flush()

    for seq, li in enumerate(body.line_items, start=1):
        hsn_snapshot = None
        if li.hsn_code_id is not None:
            hsn = await db.get(HsnSacCode, li.hsn_code_id)
            hsn_snapshot = hsn.code if hsn else None
        db.add(PurchaseBillLineItem(
            id=str(uuid.uuid4()), purchase_bill_id=bill.id, sequence=seq, description=li.description, hsn_code_id=li.hsn_code_id,
            hsn_code_snapshot=hsn_snapshot, quantity=li.quantity, rate=li.rate, created_by=current_user.id, updated_by=current_user.id,
        ))
    for line in tax_lines:
        db.add(PurchaseBillTaxLine(id=str(uuid.uuid4()), purchase_bill_id=bill.id, created_by=current_user.id, updated_by=current_user.id, **line))

    # Vendor usage rollup — plain, API-written (see 0005_finance.py's
    # docstring: no trigger maintains these).
    vendor.purchase_bill_count += 1
    vendor.has_usage_history = True
    vendor.outstanding_amount += (subtotal + tax_amount - withholding_amount)
    vendor.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(bill)
    return await _load_bill_out(db, bill)


@router.get("/{bill_id}", response_model=PurchaseBillOut)
async def get_purchase_bill(
    bill_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> PurchaseBillOut:
    bill = await db.get(PurchaseBill, bill_id)
    if bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await _load_bill_out(db, bill)


@router.put("/{bill_id}", response_model=PurchaseBillOut)
async def update_purchase_bill(
    bill_id: str,
    body: PurchaseBillCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> PurchaseBillOut:
    """§2.2 "Add/Edit Purchase Bill" + §6.1 "Lock Purchase Bill Once Fully
    Paid" — OFF by default: the record stays editable even after reaching
    Paid; ON, an edit on a Paid bill is rejected, mirroring Invoice's own
    always-on lock-on-Paid behaviour (trg_invoices_no_unlock) except here
    it's optional, so the check lives in the route body rather than a DB
    trigger. Recomputes tax/withholding/status exactly like create, and
    adjusts the vendor rollup by the delta rather than re-deriving it, since
    other bills' contributions must stay untouched.
    """
    bill = await db.get(PurchaseBill, bill_id)
    if bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if bill.status == "PAID" and await _toggle_enabled(db, "Lock Purchase Bill Once Fully Paid"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This bill is Paid and locked — it can no longer be edited")
    if body.vendor_id != bill.vendor_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Vendor cannot be changed after creation")
    if body.linked_expense_claim_id != bill.linked_expense_claim_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Linked Expense Claim cannot be changed here — remove the link on the claim itself")
    if body.bill_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bill Date cannot be in the future")
    if body.due_date is not None and body.due_date < body.bill_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Due Date cannot be before Bill Date")

    vendor = await db.get(Vendor, bill.vendor_id)
    old_outstanding_contribution = bill.subtotal + bill.tax_amount - bill.withholding_amount

    subtotal = sum((li.quantity * li.rate for li in body.line_items), Decimal("0"))

    tax_amount = Decimal("0")
    tax_lines: list[dict] = []
    if body.tax_head_id is not None:
        head = await db.get(TaxHead, body.tax_head_id)
        if head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
        block_reason = await validate_head_usable(db, head, _TAX_SCOPES, body.bill_date)
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
        snapshot = await build_tax_head_snapshot(db, head)
        result = tax_engine.calculate_tax(snapshot, subtotal)
        tax_amount = body.tax_amount_override if body.tax_amount_override is not None else result.computed_amount
        for seq, comp in enumerate(result.components or [tax_engine.ComponentAmount(head.tax_name, tax_amount)], start=1):
            tax_lines.append({
                "sequence": seq, "tax_head_id": head.id, "head_name_snapshot": head.tax_name, "print_label_snapshot": head.print_label or head.tax_name,
                "scope_snapshot": head.scope, "tax_type_snapshot": head.tax_type, "rate_snapshot": head.rate_pct,
                "cgst_rate_snapshot": head.cgst_rate_pct, "sgst_rate_snapshot": head.sgst_rate_pct, "fixed_amount_snapshot": head.fixed_amount,
                "computed_base": subtotal, "computed_amount": comp.amount, "entered_amount": (tax_amount if len(result.components or ()) <= 1 else comp.amount),
                "component_name_snapshot": comp.component_name if result.components else None,
            })
    elif body.tax_amount_override is not None:
        # §2.2: "a bill can be recorded correctly before any tax head has
        # been configured at all" — unlike Invoice, direct entry with no
        # head is an intended path here, not a bug.
        tax_amount = body.tax_amount_override

    total_amount = subtotal + tax_amount

    withholding_amount = Decimal("0")
    withholding_head_name = None
    withholding_rate = None
    withholding_calculated_on = body.withholding_calculated_on
    if body.withholding_tax_head_id is not None:
        wh_head = await db.get(TaxHead, body.withholding_tax_head_id)
        if wh_head is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Withholding tax head not found")
        block_reason = await validate_head_usable(db, wh_head, _WITHHOLDING_SCOPES, body.bill_date, required_direction="ON_PAYMENTS_MADE")
        if block_reason is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=block_reason)
        withholding_calculated_on = body.withholding_calculated_on or "SUBTOTAL"  # persist what actually drove the calc
        basis = subtotal if withholding_calculated_on == "SUBTOTAL" else total_amount
        snapshot = await build_tax_head_snapshot(db, wh_head)
        result = tax_engine.calculate_tax(snapshot, basis)
        withholding_amount = body.withholding_amount_override if body.withholding_amount_override is not None else result.computed_amount
        withholding_head_name = wh_head.tax_name
        withholding_rate = wh_head.rate_pct
        if withholding_amount > total_amount:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Withholding Amount cannot exceed the bill Total")

    bill.vendor_bill_number = body.vendor_bill_number
    bill.bill_date = body.bill_date
    bill.due_date = body.due_date or (body.bill_date + timedelta(days=vendor.payment_terms_days))  # A257
    bill.notes = body.notes
    bill.attachment_stored_file_id = body.attachment_stored_file_id
    bill.bank_account_id = body.bank_account_id
    bill.subtotal = subtotal
    bill.tax_head_id = body.tax_head_id
    bill.tax_amount = tax_amount
    bill.tax_amount_is_manual_override = body.tax_amount_override is not None
    bill.withholding_tax_head_id = body.withholding_tax_head_id
    bill.withholding_calculated_on = withholding_calculated_on
    bill.withholding_amount = withholding_amount
    bill.withholding_amount_is_manual_override = body.withholding_amount_override is not None
    bill.withholding_head_name_snapshot = withholding_head_name
    bill.withholding_rate_snapshot = withholding_rate
    bill.status = resolve_purchase_bill_status(bill.amount_paid, withholding_amount, total_amount)
    bill.updated_by = current_user.id

    for row in (await db.execute(select(PurchaseBillLineItem).where(PurchaseBillLineItem.purchase_bill_id == bill.id))).scalars():
        await db.delete(row)
    for row in (await db.execute(select(PurchaseBillTaxLine).where(PurchaseBillTaxLine.purchase_bill_id == bill.id))).scalars():
        await db.delete(row)
    await db.flush()

    for seq, li in enumerate(body.line_items, start=1):
        hsn_snapshot = None
        if li.hsn_code_id is not None:
            hsn = await db.get(HsnSacCode, li.hsn_code_id)
            hsn_snapshot = hsn.code if hsn else None
        db.add(PurchaseBillLineItem(
            id=str(uuid.uuid4()), purchase_bill_id=bill.id, sequence=seq, description=li.description, hsn_code_id=li.hsn_code_id,
            hsn_code_snapshot=hsn_snapshot, quantity=li.quantity, rate=li.rate, created_by=current_user.id, updated_by=current_user.id,
        ))
    for line in tax_lines:
        db.add(PurchaseBillTaxLine(id=str(uuid.uuid4()), purchase_bill_id=bill.id, created_by=current_user.id, updated_by=current_user.id, **line))

    new_outstanding_contribution = subtotal + tax_amount - withholding_amount
    vendor.outstanding_amount += (new_outstanding_contribution - old_outstanding_contribution)
    vendor.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(bill)
    return await _load_bill_out(db, bill)


@router.post("/{bill_id}/payments", response_model=PurchaseBillPaymentOut, status_code=status.HTTP_201_CREATED)
async def record_payment(
    bill_id: str,
    body: PurchaseBillPaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="record_payment")),
) -> PurchaseBillPayment:
    bill = await db.get(PurchaseBill, bill_id)
    if bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if bill.status not in ("UNPAID", "PART_PAID"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Record Payment is only available on an Unpaid or Part-Paid bill")
    if body.amount > bill.balance_due:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Amount cannot exceed the balance due of {bill.balance_due}")
    # §6.2 "Require Attachment Before Marking a Bill Paid" — OFF by default.
    # ON: "the system blocks payment recording until the vendor's bill copy
    # is attached" (the doc's own words describe blocking payment recording
    # itself, not narrowly the one payment that happens to reach Paid) — a
    # partial payment against a still-unattached bill is exactly the gap
    # this toggle exists to close, so every payment attempt is gated here,
    # not just a would-be-final one.
    if not bill.has_attachment and await _toggle_enabled(db, "Require Attachment Before Marking a Bill Paid"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The vendor's bill copy must be attached before a payment can be recorded")

    block_reason = await check_purchase_bill_payment_guard(db, bill)
    if block_reason is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=block_reason)

    vendor = await db.get(Vendor, bill.vendor_id)
    payment = PurchaseBillPayment(
        id=str(uuid.uuid4()), purchase_bill_id=bill.id, vendor_id=bill.vendor_id, financial_year_id=bill.financial_year_id,
        amount=body.amount, balance_due_at_entry=bill.balance_due, payment_mode_id=body.payment_mode_id,
        paid_from_bank_account_id=body.paid_from_bank_account_id or bill.bank_account_id,
        # Snapshotted at insert, never resolved live (Appendix B, verbatim).
        paid_into_account_name_snapshot=vendor.bank_account_name, paid_into_bank_name_snapshot=vendor.bank_name,
        paid_into_account_number_masked_snapshot=vendor.bank_account_number_masked, paid_into_ifsc_snapshot=vendor.ifsc_code,
        payment_date=body.payment_date, reference=body.reference, recorded_by=current_user.id, recorded_at=datetime.now(timezone.utc),
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(payment)

    bill.amount_paid += body.amount
    bill.status = resolve_purchase_bill_status(bill.amount_paid, bill.withholding_amount, bill.total_amount)
    if bill.status == "PAID":
        bill.paid_at = datetime.now(timezone.utc)
    bill.updated_by = current_user.id

    vendor.outstanding_amount -= body.amount
    vendor.total_spend += body.amount
    vendor.updated_by = current_user.id

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(payment)
    return payment


@router.get("/{bill_id}/payments", response_model=list[PurchaseBillPaymentOut])
async def list_payments(
    bill_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[PurchaseBillPayment]:
    return list(
        (await db.execute(select(PurchaseBillPayment).where(PurchaseBillPayment.purchase_bill_id == bill_id).order_by(PurchaseBillPayment.payment_date.desc())))
        .scalars().all()
    )
