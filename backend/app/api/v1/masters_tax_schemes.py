"""Masters §3.2d / MASTERS-COMPLETION-PROMPT.md §6b — Tax Schemes. Optional
alternative tax regimes an employee elects between (Standard Scheme, New
Regime, ...); `tax_heads.tax_scheme_id` tags which declaration heads belong
to which scheme. Zero rows is a valid, common state — §3.2d's "disappearance
rule" (APPENDIX-B-business-rules.md) — so this is a genuine sub-master, not
folded into tax_heads.

Not built on masters_lookup.py's generic factory (unlike the 15 simple
lookups it does cover): "exactly one default scheme" needs real swap logic —
setting a new default must clear the previous one in the SAME transaction,
not just collide with `ux_tax_schemes_one_default` (0002_masters.py, a
generated-column unique index, same "constant guard" trick already used for
work_week_policies.ux_wwp_one_company_wide) and force the caller to unwind a
raw IntegrityError. Business state is checked in Python before the write,
same split established by masters_taxes.py / financial_years.py; the DB
constraint stays as defense-in-depth for a direct-SQL bypass.

RBAC: no separate ScreenDef. ARCH-0-prototype-inventory.md lists
`masters.taxes.scheme` with the identical "sa,acct" role set as the parent
`masters.taxes` screen and no distinct permission row — same as
`.slab`/`.split`/`.relief` — so this shares masters.taxes's existing
screen key and its already-seeded "Allow Accountant to Manage Taxes" toggle
rather than registering a second, functionally-identical gate.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import TaxHead, TaxScheme
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import TaxSchemeCreate, TaxSchemeOut, TaxSchemeWrite
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/masters/tax-schemes", tags=["masters"])
SCREEN = "masters.taxes"

_LIST_COLUMNS = [
    ColumnSpec("scheme_name", "Scheme"),
    ColumnSpec("is_default", "Is Default"),
    ColumnSpec("description", "Description"),
    ColumnSpec("choice_window", "Choice Window"),
    ColumnSpec("is_active", "Status"),
    ColumnSpec("declaration_heads_count", "Declaration Heads", align="right"),
]

logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _reference_counts(db: AsyncSession) -> dict[str, int]:
    """One grouped query backing both `is_referenced` (§3a's convention —
    live, not a stored counter) and the Tax Schemes tab's own "Declaration
    Heads" column (§6b), which wants the actual count, not just yes/no.
    Single-row callers (create/update/(de)activate below) still pay for a
    full grouped scan rather than one scheme's own COUNT — this table is
    small enough that the difference is not worth two code paths.
    """
    rows = (
        await db.execute(
            select(TaxHead.tax_scheme_id, func.count(TaxHead.id))
            .where(TaxHead.tax_scheme_id.is_not(None))
            .group_by(TaxHead.tax_scheme_id)
        )
    ).all()
    return {scheme_id: count for scheme_id, count in rows}


async def _to_out(db: AsyncSession, row: TaxScheme, perms: PermissionSet, counts: dict[str, int] | None = None) -> dict:
    # The List passes the grouped counts in so the scan runs once for the
    # whole page rather than once per scheme — the same pre-resolve-and-hand-
    # it-down shape masters_bank_accounts.py's own `referenced` set uses.
    # Single-row callers still omit it and pay for their own scan, exactly as
    # _reference_counts' docstring already allows.
    if counts is None:
        counts = await _reference_counts(db)
    out = TaxSchemeOut.model_validate(row)
    out.declaration_heads_count = counts.get(row.id, 0)
    out.is_referenced = row.id in counts
    return apply_field_masking(out.model_dump(), perms)


async def _clear_other_defaults(db: AsyncSession, exclude_id: str | None) -> None:
    """Masters §3.2d: "Exactly one scheme may be the default." Runs BEFORE
    the caller's own row is written, so by the time that INSERT/UPDATE
    reaches ux_tax_schemes_one_default no other row can still be holding the
    guard value — an automatic swap ("setting a new default clears the
    previous", MASTERS-COMPLETION-PROMPT.md §6b fix #1), not a reject-and-
    ask-the-caller-to-unset-it-first flow like Work Week Policy's Company-
    wide toggle uses. The two sub-masters differ on purpose: a payroll-wide
    policy change is deliberately a slower two-step; which regime is the
    fallback default is a lighter, single-toggle setting, matching the
    prototype's own plain toggle control for it.
    """
    stmt = select(TaxScheme).where(TaxScheme.is_default.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(TaxScheme.id != exclude_id)
    for other in (await db.execute(stmt)).scalars().all():
        other.is_default = False


@router.get("/options", response_model=None)
async def list_tax_scheme_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False, description="A historical record may reference a since-deactivated scheme and still needs its label to resolve"),
) -> list[dict]:
    """Same contract, same reasoning as masters_lookup.py's own `label_field`
    docstring: `masters.taxes` is Super-Admin-full / Accountant-view and no
    access at all for Manager, HR and Employee (seed.py:47), but Tax
    Declaration needs to name the scheme an employee has chosen. Gated on
    plain authentication only; selects `scheme_name` and nothing else, so
    `choice_window`, `is_default`, `description` and the declaration-head
    counts stay behind the real screen permission.
    """
    stmt = select(TaxScheme.id, TaxScheme.scheme_name, TaxScheme.is_active)
    if not include_inactive:
        stmt = stmt.where(TaxScheme.is_active.is_(True))
    rows = (await db.execute(stmt)).all()
    return [{"id": row_id, "label": scheme_name, "is_active": is_active} for row_id, scheme_name, is_active in rows]


@router.get("", response_model=None)
async def list_tax_schemes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    include_inactive: bool = Query(False, description="Masters §3.0: defaults to Active only"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    stmt = select(TaxScheme)
    if not include_inactive:
        stmt = stmt.where(TaxScheme.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()

    if format:
        counts = await _reference_counts(db)
        export_rows = [
            {
                "scheme_name": r.scheme_name,
                "is_default": "Yes" if r.is_default else "No",
                "description": r.description,
                "choice_window": r.choice_window,
                "is_active": "Active" if r.is_active else "Inactive",
                "declaration_heads_count": counts.get(r.id, 0),
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "Tax Schemes", _LIST_COLUMNS, export_rows, {"include_inactive": include_inactive})

    counts = await _reference_counts(db)
    return [await _to_out(db, r, perms, counts) for r in rows]


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_tax_scheme(
    body: TaxSchemeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    if body.is_default:
        await _clear_other_defaults(db, exclude_id=None)
    row = TaxScheme(id=str(uuid.uuid4()), created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A scheme with that name already exists, or another constraint was rejected") from exc
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.put("/{scheme_id}", response_model=None)
async def update_tax_scheme(
    scheme_id: str,
    body: TaxSchemeWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await db.get(TaxScheme, scheme_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.is_default and not row.is_default:
        await _clear_other_defaults(db, exclude_id=row.id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A scheme with that name already exists, or another constraint was rejected") from exc
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.post("/{scheme_id}/deactivate", response_model=None)
async def deactivate_tax_scheme(
    scheme_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),  # §3.0 rule 1: SA only
) -> dict:
    row = await db.get(TaxScheme, scheme_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # §6b fix #6: "Deactivating a scheme that a Tax Head references must be
    # blocked the same way an in-use Tax Head is [blocked from a hard
    # delete]." Checked here — unlike deactivate_tax_head, which only guards
    # its OWN hard-delete route, not deactivate — because an employee's
    # declaration screen resolving tax_scheme_id through a now-invisible
    # scheme would be a worse state than refusing the deactivate outright.
    if row.id in await _reference_counts(db):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This scheme is linked to at least one Tax Head — reassign or remove that link before deactivating it",
        )
    row.is_active = False
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.post("/{scheme_id}/activate", response_model=None)
async def activate_tax_scheme(
    scheme_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),  # §3.0 rule 1: SA only
) -> dict:
    row = await db.get(TaxScheme, scheme_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_active = True
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row, perms)


@router.delete("/{scheme_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_scheme(
    scheme_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> None:
    row = await db.get(TaxScheme, scheme_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.id in await _reference_counts(db):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Still referenced by at least one Tax Head — deactivate instead of deleting")
    await db.delete(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        # fk_tax_heads_scheme is ON DELETE RESTRICT — the check above already
        # covers it, but a row could theoretically be linked between that
        # check and this commit; defense in depth, same pattern as every
        # other delete route in this codebase.
        raise _as_client_error(exc, "Still referenced elsewhere — deactivate instead of deleting") from exc
