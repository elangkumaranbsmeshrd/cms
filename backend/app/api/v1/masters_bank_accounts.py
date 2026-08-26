"""Masters §3.7 — Bank Account. Not the generic lookup shape: it carries a
"one default account" singleton (DB-enforced, proven live in Phase 1's
verification pass) and A009's "Confirm Account Number must match but is never
stored" rule.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import MASKED_PLACEHOLDER, apply_field_masking
from app.models.masters import BankAccount, ExpenseType
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import BankAccountCreate, BankAccountOut, BankAccountUpdate, BankAccountWrite
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/masters/bank-accounts", tags=["masters"])
SCREEN = "masters.bank_accounts"

_LIST_COLUMNS = [
    ColumnSpec("nickname", "Nickname"),
    ColumnSpec("bank_name", "Bank Name"),
    ColumnSpec("account_holder_name", "Account Holder Name"),
    ColumnSpec("account_number", "Account Number"),
    ColumnSpec("account_type", "Account Type"),
    ColumnSpec("ifsc", "IFSC"),
    ColumnSpec("branch", "Branch"),
    ColumnSpec("upi_id", "UPI ID"),
    ColumnSpec("is_default", "Default"),
    ColumnSpec("is_active", "Status"),
    ColumnSpec("is_referenced", "Referenced"),
]


async def _referenced_account_ids(db: AsyncSession) -> set[str]:
    # Masters §3.7 Screen Design: a lighter, informational confirmation is
    # shown before deactivating an account already used in past transactions.
    # Phase 1's only real consumer of bank_accounts is Expense Types'
    # optional default_bank_account_id — Invoice/Expense/Purchase Bill
    # payment records (the spec's "nine downstream screens" table) don't
    # exist as modules yet, so this is a real but partial signal, not the
    # full picture the finished system will have.
    rows = (await db.execute(select(ExpenseType.default_bank_account_id).where(ExpenseType.default_bank_account_id.is_not(None)))).scalars().all()
    return {r for r in rows if r is not None}


async def _to_out(db: AsyncSession, row: BankAccount, perms: PermissionSet, referenced: set[str] | None = None) -> dict:
    # account_number/ifsc/etc are real Layer 3 sensitive fields for this
    # screen (see field_manifest.json's masters.bank_accounts entry) — mask
    # here, after the BankAccountOut shape is built but before it leaves the
    # function, same pattern as customers.py's _masked_customer. response_model
    # is None on every endpoint that calls this so FastAPI's own response
    # serialization can't re-add a field this just removed.
    if referenced is None:
        referenced = await _referenced_account_ids(db)
    out = BankAccountOut.model_validate(row)
    out.is_referenced = row.id in referenced
    return apply_field_masking(out.model_dump(), perms)


def _masked_cell(row: dict, field: str) -> object:
    """A field a Layer-3 rule masked comes back from `_to_out` as
    MASKED_PLACEHOLDER (a dict) — fine for the JSON response, but a PDF/Excel
    cell can't render a dict. Same masked/unmasked value either way, just
    reshaped for export.
    """
    value = row.get(field)
    return "•••• Masked ••••" if value == MASKED_PLACEHOLDER else value


@router.get("/options", response_model=None)
async def list_bank_account_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False, description="A historical record (e.g. an old reimbursement) may reference a since-deactivated account and still needs its label to resolve"),
) -> list[dict]:
    """2026-08 RBAC audit fix: same reasoning as masters_lookup.py's own
    `label_field`/`/options` route (Payment Mode, HSN/SAC Code) — Invoice/
    Purchase Bill/Vendor Usage/Customer only ever need id+nickname to power a
    "which account was this paid into" picker, but until now the only way to
    get that was the real `masters.bank_accounts` screen permission, which
    also opens the standalone Bank Account master (account numbers and all)
    that Manager/Accountant should not be able to reach on their own per
    §3.7. Gated on plain authentication only, and — unlike `list_bank_accounts`
    below — never reads account_number/ifsc/branch/upi_id at all, so there is
    no sensitive value here for `apply_field_masking` to need to protect.
    """
    stmt = select(BankAccount.id, BankAccount.nickname, BankAccount.is_active)
    if not include_inactive:
        stmt = stmt.where(BankAccount.is_active.is_(True))
    rows = (await db.execute(stmt)).all()
    return [{"id": row_id, "label": nickname, "is_active": is_active} for row_id, nickname, is_active in rows]


@router.get("", response_model=None)
async def list_bank_accounts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    rows = (await db.execute(select(BankAccount))).scalars().all()
    referenced = await _referenced_account_ids(db)
    masked_rows = [await _to_out(db, r, perms, referenced) for r in rows]

    if format:
        # RBAC §2.2(f): export exactly the set on screen — this list has no
        # query filters of its own, so filters_applied is empty (build_export
        # still stamps the result count / exported-by / exported-at block).
        #
        # Built FROM masked_rows (not the raw ORM rows), same pattern as
        # customers.py's export — Layer 3 masking must apply here too, or a
        # role that only sees account_number masked on screen could still
        # pull the real number out of the PDF/Excel export. `_masked_cell`
        # turns the JSON masking marker into a readable export string rather
        # than dumping the raw `{"__masked__": True}` dict into a cell.
        export_rows = [
            {
                "nickname": _masked_cell(r, "nickname"), "bank_name": _masked_cell(r, "bank_name"),
                "account_holder_name": _masked_cell(r, "account_holder_name"), "account_number": _masked_cell(r, "account_number"),
                "account_type": _masked_cell(r, "account_type"), "ifsc": _masked_cell(r, "ifsc"), "branch": _masked_cell(r, "branch"),
                "upi_id": _masked_cell(r, "upi_id"), "is_default": "Yes" if r.get("is_default") else "No",
                "is_active": "Active" if r.get("is_active") else "Inactive", "is_referenced": "Yes" if r.get("is_referenced") else "No",
            }
            for r in masked_rows
        ]
        return await list_export.build_export(format, db, current_user, "Bank Accounts", _LIST_COLUMNS, export_rows, {})

    return masked_rows


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_bank_account(
    body: BankAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    # A009: Confirm Account Number is validated at the API boundary and never
    # stored — it isn't a model field at all, only a write-schema field.
    if body.account_number != body.confirm_account_number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Account Number and Confirm Account Number must match")

    row = BankAccount(
        id=str(uuid.uuid4()),
        nickname=body.nickname,
        bank_name=body.bank_name,
        account_holder_name=body.account_holder_name,
        account_number=body.account_number,
        account_type=body.account_type,
        ifsc=body.ifsc,
        branch=body.branch,
        upi_id=body.upi_id,
        upi_qr_file_id=body.upi_qr_file_id,
        is_default=False,
        # §3b — createOnly, mirrors masters_lookup.py's create_only_fields.
        is_active=body.is_active,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Duplicate nickname or account number") from exc
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.put("/{account_id}", response_model=None)
async def update_bank_account(
    account_id: str,
    body: BankAccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """Found missing by the Phase 1 audit: Role Access promises Super Admin
    "full CRUD" but only Create existed for an account's own fields — a
    mistyped branch or nickname had no fix short of a hard delete (only
    possible before the account is ever used).
    """
    row = await db.get(BankAccount, account_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.account_number != body.confirm_account_number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Account Number and Confirm Account Number must match")
    row.nickname = body.nickname
    row.bank_name = body.bank_name
    row.account_holder_name = body.account_holder_name
    row.account_number = body.account_number
    row.account_type = body.account_type
    row.ifsc = body.ifsc
    row.branch = body.branch
    row.upi_id = body.upi_id
    row.upi_qr_file_id = body.upi_qr_file_id
    row.updated_by = current_user.id
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Duplicate nickname or account number") from exc
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.post("/{account_id}/set-default", response_model=None)
async def set_default(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    target = await db.get(BankAccount, account_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Unset the old default BEFORE setting the new one — two sequential
    # UPDATEs in one transaction, in this order, so the database's
    # one-default guard (a generated-column UNIQUE, not a deferred
    # constraint — MySQL has none) never sees two rows flagged default at
    # once. Same swap pattern as company_addresses' is_primary.
    current_default = (await db.execute(select(BankAccount).where(BankAccount.is_default.is_(True)))).scalar_one_or_none()
    if current_default is not None and current_default.id != target.id:
        current_default.is_default = False
        current_default.updated_by = current_user.id
        await db.flush()
    target.is_default = True
    target.updated_by = current_user.id
    await db.commit()
    await db.refresh(target)
    return await _to_out(db, target, perms)


@router.post("/{account_id}/deactivate", response_model=None)
async def deactivate(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> dict:
    row = await db.get(BankAccount, account_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.is_default:
        # Matches the DB trigger (trg_bank_accounts_reject_deactivate_default)
        # exactly — checked here first for a clean 409 instead of a raw
        # driver error surfacing as a 500.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Choose a new default account before deactivating this one")
    row.is_active = False
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bank_account(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> None:
    row = await db.get(BankAccount, account_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await db.delete(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Still referenced elsewhere — deactivate instead") from exc
