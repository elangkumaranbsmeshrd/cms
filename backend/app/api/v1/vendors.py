"""Vendor (07-vendor-module.md) — Directory (§2.1), Add/Edit (§2.2), Usage
(§2.3, read-only tab on the vendor record, not standalone). No Masters
dependency (A257/A259: deliberately no auto-generated Vendor Code).
"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.finance import CompanyExpense, ExpenseClaim, ExpenseReimbursement, PurchaseBill, PurchaseBillPayment
from app.models.platform import User
from app.models.rbac import FeatureToggle
from app.models.vendor import Vendor
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.vendor import VendorOut, VendorUsageRow, VendorWrite
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

# Every endpoint that calls _masked_vendor MUST declare response_model=None
# on its route — an undeclared response_model is inferred by FastAPI from the
# return type annotation, so a bare `-> VendorOut`/`response_model=VendorOut`
# would force the masked dict back through VendorOut's own validation on the
# way OUT: a "hide"-mode field that was popped from the dict either
# resurrects as null (fields with a `= None` default, e.g. the banking/GST
# fields inherited from VendorWrite) or 500s with "field required" (fields
# without one, e.g. bank_account_number_masked/has_bank_details/is_active/
# purchase_bill_count/expense_count/has_usage_history/outstanding_amount/
# total_spend), and a "mask"-mode field (a dict placeholder) always 500s
# against a non-dict-typed field like gstin: str | None. Same class of bug as
# the sharp edge on the way IN, just at the opposite end.
def _masked_vendor(row: Vendor, perms: PermissionSet) -> dict:
    return apply_field_masking(VendorOut.model_validate(row).model_dump(), perms)

router = APIRouter(prefix="/vendors", tags=["vendor"])
SCREEN = "vendor.directory"
_BANKING_FIELDS = {"gstin", "pan", "bank_account_name", "bank_name", "bank_account_number", "ifsc_code"}
# Vendor deliberately has no auto-generated Vendor Code (A257/A259, see this
# module's own docstring) — the export's identifying column is Vendor Name,
# not a code that was never modeled.
_LIST_COLUMNS = [
    ColumnSpec("vendor_name", "Vendor Name"),
    ColumnSpec("gstin", "GSTIN"),
    ColumnSpec("status", "Status"),
    ColumnSpec("outstanding_amount", "Outstanding", align="left"),
]
_USAGE_COLUMNS = [
    ColumnSpec("reference_number", "Document"),
    ColumnSpec("date", "Date"),
    ColumnSpec("amount", "Amount", align="left"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


@router.get("/options", response_model=None)
async def list_vendor_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False, description="A historical record may reference a since-deactivated vendor and still needs its label to resolve"),
) -> list[dict]:
    """Same reasoning, same pattern as masters_bank_accounts.py's own
    `/options` route (2026-08 RBAC audit fix) — found here during Expense
    §2.1's own audit: HR and Employee hold the same 'full' baseline access
    to My Expenses as every other role (§6, verbatim: "nobody's access to
    their own expenses should ever be narrower than a plain Employee's"),
    but the claim form's optional Vendor field was gated on the real
    `vendor.directory` screen (`GET /vendors` below), which is 'none' for
    both roles — silently blocking 2 of the 5 baseline roles from an
    otherwise-optional field on their own screen. Gated on plain
    authentication only, and — unlike `list_vendors` below — never reads
    GSTIN/PAN/banking fields at all, so there is no sensitive value here for
    `apply_field_masking` to need to protect.
    """
    stmt = select(Vendor.id, Vendor.vendor_name, Vendor.is_active)
    if not include_inactive:
        stmt = stmt.where(Vendor.is_active.is_(True))
    rows = (await db.execute(stmt.order_by(Vendor.vendor_name))).all()
    return [{"id": row_id, "label": vendor_name, "is_active": is_active} for row_id, vendor_name, is_active in rows]


@router.get("", response_model=None)
async def list_vendors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    is_active: bool | None = Query(None),
    vendor_category: str | None = Query(None),
    has_bank_details: bool | None = Query(None),
    has_outstanding_bills: bool | None = Query(None, description="has_usage_history AND outstanding_amount > 0"),
    city: str | None = Query(None),
    state: str | None = Query(None),
    payment_terms_min: int | None = Query(None),
    payment_terms_max: int | None = Query(None),
    created_from: date | None = Query(None),
    created_to: date | None = Query(None),
    approval_status: str | None = Query(None, description="approved | pending_approval — §6.1"),
    search: str | None = Query(None, description="Matches Vendor Name, GSTIN, Bank Account Name"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    stmt = select(Vendor)
    if is_active is not None:
        stmt = stmt.where(Vendor.is_active == is_active)
    if vendor_category:
        stmt = stmt.where(Vendor.vendor_category == vendor_category)
    if approval_status:
        stmt = stmt.where(Vendor.approval_status == approval_status)
    # §2.1: "the 'has bank details on file' filter is hidden from Manager
    # too... the field's visibility decides; the filter follows" — ignored
    # rather than erroring, since it's a query-param nuance, not a control.
    if has_bank_details is not None and perms.can("edit_banking"):
        stmt = stmt.where(Vendor.has_bank_details == has_bank_details)
    if has_outstanding_bills is not None:
        stmt = stmt.where(Vendor.outstanding_amount > 0) if has_outstanding_bills else stmt.where(Vendor.outstanding_amount == 0)
    if city:
        stmt = stmt.where(Vendor.address_city == city)
    if state:
        stmt = stmt.where(Vendor.address_state == state)
    if payment_terms_min is not None:
        stmt = stmt.where(Vendor.payment_terms_days >= payment_terms_min)
    if payment_terms_max is not None:
        stmt = stmt.where(Vendor.payment_terms_days <= payment_terms_max)
    if created_from:
        stmt = stmt.where(Vendor.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Vendor.created_at < created_to + timedelta(days=1))
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(Vendor.vendor_name.ilike(pattern) | Vendor.gstin.ilike(pattern) | Vendor.bank_account_name.ilike(pattern))
    rows = (await db.execute(stmt.order_by(Vendor.vendor_name))).scalars().all()
    masked_rows = [_masked_vendor(row, perms) for row in rows]

    if format:
        # Same masked dicts the JSON branch below returns — a masked/hidden
        # GSTIN never resurfaces in the export (RBAC §2.2(f)).
        export_rows = [
            {
                "vendor_name": v.get("vendor_name"), "gstin": v.get("gstin"),
                "status": "Active" if v.get("is_active") else "Inactive", "outstanding_amount": v.get("outstanding_amount"),
            }
            for v in masked_rows
        ]
        filters_applied = {
            "is_active": is_active, "vendor_category": vendor_category, "has_bank_details": has_bank_details,
            "has_outstanding_bills": has_outstanding_bills, "city": city, "state": state,
            "payment_terms_min": payment_terms_min, "payment_terms_max": payment_terms_max,
            "created_from": created_from, "created_to": created_to, "approval_status": approval_status, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Vendors", _LIST_COLUMNS, export_rows, filters_applied)

    return masked_rows


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    body: VendorWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
    inline: bool = Query(False, description="True when created from the lightweight '+ Add New Vendor' modal on Purchase Bill/Expense"),
) -> dict:
    data = body.model_dump()
    if data.get("payment_terms_days") is None:
        data["payment_terms_days"] = 30  # A257
    # Same §6.1 gate update_vendor already enforces — without it, a Manager
    # (who has 'edit' but not 'edit_banking' by default) could set GSTIN/PAN/
    # bank fields on a NEW vendor even though changing them on an existing
    # one is correctly blocked.
    if any(data.get(f) for f in _BANKING_FIELDS) and not perms.can("edit_banking"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Role does not have 'edit_banking' on 'vendor.directory'")
    # §6.1 "Require Approval to Add a New Vendor" — not part of VendorWrite,
    # so a caller can never set this directly; only this toggle check does.
    require_approval = await _toggle_enabled(db, "Require Approval to Add a New Vendor")
    approval_status = "pending_approval" if require_approval else "approved"
    row = Vendor(id=str(uuid.uuid4()), created_inline=inline, approval_status=approval_status, created_by=current_user.id, updated_by=current_user.id, **data)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _masked_vendor(row, perms)


@router.get("/{vendor_id}", response_model=None)
async def get_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict:
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return _masked_vendor(row, perms)


@router.put("/{vendor_id}", response_model=None)
async def update_vendor(
    vendor_id: str,
    body: VendorWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    data = body.model_dump()
    if data.get("payment_terms_days") is None:
        data["payment_terms_days"] = row.payment_terms_days
    # §6.1: "Allow Manager to Edit Vendor Bank & GST Details" toggle, default
    # OFF — Manager holds 'edit' but not 'edit_banking' out of the box, so a
    # banking/GST field change requires the stronger action.
    #
    # A role without edit_banking never sees these fields' real values (Layer
    # 3 masking nulls them out on every GET) — under this codebase's
    # full-replace PUT convention, that role's payload always echoes back
    # whatever their own masked GET showed them, i.e. None. Compared against
    # the TRUE value that would look like "changing" every banking field on
    # every edit. Compare against the masked view (None) instead: a
    # genuine attempted change (any non-None value from a role that can't
    # see the real one) still 403s; an echoed-back None does not, and is
    # simply left untouched below rather than nulling out the real value.
    can_edit_banking = perms.can("edit_banking")
    changing_banking_fields = any(data.get(f) != (getattr(row, f) if can_edit_banking else None) for f in _BANKING_FIELDS)
    if changing_banking_fields and not can_edit_banking:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Role does not have 'edit_banking' on 'vendor.directory'")
    for field, value in data.items():
        if field in _BANKING_FIELDS and not can_edit_banking:
            continue
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _masked_vendor(row, perms)


@router.post("/{vendor_id}/deactivate", response_model=None)
async def deactivate_vendor(
    vendor_id: str,
    reason: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="deactivate")),
) -> dict:
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_active = False
    row.deactivated_at = datetime.now(timezone.utc)
    row.deactivated_by = current_user.id
    row.deactivation_reason = reason
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return _masked_vendor(row, perms)


@router.post("/{vendor_id}/activate", response_model=None)
async def activate_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="activate")),
) -> dict:
    # §2.2: Status is a "Toggle (Active/Inactive)" — the reverse of deactivate,
    # clearing the deactivation audit trail rather than leaving it stale.
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_active = True
    row.deactivated_at = None
    row.deactivated_by = None
    row.deactivation_reason = None
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return _masked_vendor(row, perms)


@router.post("/{vendor_id}/approve", response_model=None)
async def approve_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="approve_vendor")),
) -> dict:
    # §6.1: "new vendors need Accountant or Super Admin sign-off before they
    # can be used on a Purchase Bill" — Manager holds edit/deactivate/
    # activate on this screen but deliberately not this action.
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.approval_status != "pending_approval":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This vendor is not pending approval")
    row.approval_status = "approved"
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return _masked_vendor(row, perms)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="deactivate")),
) -> None:
    # §2.2/Appendix B, verbatim: "The Delete button is simply NOT SHOWN once
    # a vendor has any usage at all" — enforced here as a hard 409, not a
    # UI-only omission, since the API is the authority on permissions. §6.1
    # "Allow Hard Delete of a Vendor" (default OFF) is the documented escape
    # hatch: ON skips this app-level has_usage_history check.
    #
    # That only ever helps when has_usage_history has drifted from reality
    # (the exact "a reference the usage flag somehow missed" case the second
    # line of defence below already anticipates) — every real Purchase Bill/
    # Expense row still holds vendor_id under ON DELETE RESTRICT (0005_
    # finance.py), so a vendor with actual usage still can't be deleted with
    # the toggle on; it 409s below instead, same as always. Deliberate:
    # loosening those FKs to let the toggle cascade through real financial
    # history would be a far more dangerous change than this doc's "not
    # recommended once a vendor has been used" was ever asking for.
    row = await db.get(Vendor, vendor_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    allow_hard_delete = await _toggle_enabled(db, "Allow Hard Delete of a Vendor")
    if row.has_usage_history and not allow_hard_delete:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This vendor has usage history — deactivate instead of deleting")
    try:
        await db.delete(row)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc


@router.get("/{vendor_id}/usage", response_model=None)
async def vendor_usage(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    usage_type: str | None = Query(None, alias="type"),
    status_filter: list[str] | None = Query(None, alias="status"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    paid_from_account_id: str | None = Query(None),
    search: str | None = Query(None, description="Matches Reference Number"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """§2.3: "no totals, no charts, ever" — a pure read-only list, most
    recent first. Both account columns stay blank on an unpaid row on
    purpose (Appendix B: "that is the point").
    """
    if await db.get(Vendor, vendor_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    rows: list[dict] = []

    if usage_type is None or usage_type == "PURCHASE_BILL":
        bills = (await db.execute(select(PurchaseBill).where(PurchaseBill.vendor_id == vendor_id))).scalars().all()
        for bill in bills:
            payment = (
                await db.execute(
                    select(PurchaseBillPayment).where(PurchaseBillPayment.purchase_bill_id == bill.id, PurchaseBillPayment.status == "RECORDED")
                    .order_by(PurchaseBillPayment.payment_date.desc())
                )
            ).scalars().first()
            if status_filter and bill.status not in status_filter:
                continue
            rows.append({
                "type": "PURCHASE_BILL", "reference_number": bill.purchase_bill_code, "date": bill.bill_date.isoformat(),
                "amount": bill.total_amount, "mode": (payment.payment_mode_id if payment else None),
                "paid_from": (payment.paid_from_bank_account_id if payment else None),
                "paid_into": (payment.paid_into_account_name_snapshot if payment else None),
                "account_number_masked": (payment.paid_into_account_number_masked_snapshot if payment else None), "status": bill.status,
            })

    if usage_type is None or usage_type == "EXPENSE":
        claims = (await db.execute(select(ExpenseClaim).where(ExpenseClaim.vendor_id == vendor_id))).scalars().all()
        for claim in claims:
            if status_filter and claim.status not in status_filter:
                continue
            # A claim's own mode isn't recorded until it's actually paid out —
            # that happens on the separate Reimbursement record (Expense,
            # Module 12), same "blank until paid" rule as the account columns.
            reimbursement = (
                await db.execute(
                    select(ExpenseReimbursement).where(ExpenseReimbursement.expense_claim_id == claim.id, ExpenseReimbursement.status == "RECORDED")
                    .order_by(ExpenseReimbursement.reimbursed_date.desc())
                )
            ).scalars().first()
            rows.append({
                "type": "EXPENSE", "reference_number": claim.id, "date": claim.expense_date.isoformat(), "amount": claim.amount,
                "mode": (reimbursement.payment_mode_id if reimbursement else None), "paid_from": claim.bank_account_id,
                "paid_into": None, "account_number_masked": None, "status": claim.status,
            })
        company_expenses = (await db.execute(select(CompanyExpense).where(CompanyExpense.vendor_id == vendor_id))).scalars().all()
        for ce in company_expenses:
            if status_filter and ce.status not in status_filter:
                continue
            rows.append({
                "type": "EXPENSE", "reference_number": ce.id, "date": ce.expense_date.isoformat(), "amount": ce.amount,
                "mode": ce.payment_mode_id, "paid_from": ce.paid_from_bank_account_id, "paid_into": None,
                "account_number_masked": None, "status": ce.status,
            })

    if date_from:
        rows = [r for r in rows if r["date"] >= date_from.isoformat()]
    if date_to:
        rows = [r for r in rows if r["date"] <= date_to.isoformat()]
    if amount_min is not None:
        rows = [r for r in rows if r["amount"] >= amount_min]
    if amount_max is not None:
        rows = [r for r in rows if r["amount"] <= amount_max]
    if paid_from_account_id:
        rows = [r for r in rows if r["paid_from"] == paid_from_account_id]
    if search:
        needle = search.lower()
        rows = [r for r in rows if needle in str(r["reference_number"]).lower()]

    rows.sort(key=lambda r: r["date"], reverse=True)
    masked_rows = [apply_field_masking(row, perms) for row in rows]

    if format:
        # Appendix B, verbatim: "NO TOTALS AND NO CHARTS, EVER" — the plain
        # row list only, no summary/total row appended here or anywhere in
        # list_export.build_export's own header block.
        export_rows = [{"reference_number": r.get("reference_number"), "date": r.get("date"), "amount": r.get("amount")} for r in masked_rows]
        filters_applied = {
            "type": usage_type, "status": status_filter, "date_from": date_from, "date_to": date_to,
            "amount_min": amount_min, "amount_max": amount_max, "paid_from_account_id": paid_from_account_id, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Vendor Usage", _USAGE_COLUMNS, export_rows, filters_applied)

    return masked_rows
