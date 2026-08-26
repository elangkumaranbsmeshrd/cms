"""Masters §3.6 — Company Profile. A singleton (one row, created once, never
deleted), plus two of its five inner tabs as real sub-resources: Addresses
(§3.6b, its own one-Primary-address DB guard) and Number Prefixes (§3.6e,
which every other module's auto-numbering reads).

Bank Details (§3.6c) is deliberately NOT duplicated here — it is explicitly
"the same list ... shown here for convenience, not a copy" per the spec;
callers use /masters/bank-accounts directly. Documents (§3.6d) is deferred:
it depends on a file-upload/serving endpoint (BUILD-PROMPT §10) that is
cross-cutting, not a Phase 1 deliverable — the company_documents table exists
and is migrated, but no API sits in front of it yet.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import CompanyAddress, CompanyProfile, NumberPrefixRule
from app.models.platform import IndianState, User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import (
    CompanyAddressOut,
    CompanyAddressWrite,
    CompanyProfileOut,
    CompanyProfileWrite,
    IndianStateOut,
    NumberPrefixRuleCreate,
    NumberPrefixRuleOut,
    NumberPrefixRuleWrite,
)

logger = logging.getLogger(__name__)


# DBAPIError catches both native constraint violations (IntegrityError —
# UNIQUE/FK/CHECK) and a rejected SIGNAL from a trigger (OperationalError,
# e.g. the starting-number-lock trigger) — found by the Phase 1 audit: these
# PUT handlers previously caught neither, so any DB-level rejection surfaced
# as a raw unhandled 500 instead of a clean 4xx.
def _as_client_error(exc: DBAPIError) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Rejected by a database constraint")

router = APIRouter(prefix="/masters/company-profile", tags=["masters"])
SCREEN = "masters.company_profile"


@router.get("/indian-states", response_model=list[IndianStateOut])
async def list_indian_states(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[IndianState]:
    """Fixed reference data (India's states/UTs + GST state codes, seeded in
    app/seed.py) — the FK company_addresses.state_id points at, and had no
    read endpoint anywhere until now (found while wiring the frontend
    Company Address form: the FK existed since migration 0001, but nothing
    could ever list valid values for it). Gated on this screen since it's
    the sole real consumer today; genuinely reusable reference data if a
    future screen also needs a state picker.

    Left out of the masking pass deliberately: IndianState's only fields
    (id, name, code, gst_state_code) share no field_key with anything in
    masters.company_profile's manifest (checked app/rbac/field_manifest.json
    — that screen's keys are address/profile/prefix-rule fields like
    address_type, gstin, prefix, etc.), so no RolePermissionField row could
    ever resolve a mode against this response — there is nothing here to hide
    or mask.
    """
    return list((await db.execute(select(IndianState).order_by(IndianState.name))).scalars().all())


@router.get("", response_model=None)
async def get_company_profile(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict | None:
    row = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if row is None:
        return None
    # response_model dropped (was CompanyProfileOut | None) because masking
    # must run before the response leaves the function — a strict
    # response_model would re-validate the dict FastAPI's own automatic path
    # produces and silently undo a 'hide'/'mask' on e.g. gstin/pan.
    return apply_field_masking(CompanyProfileOut.model_validate(row).model_dump(), perms)


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_company_profile(
    body: CompanyProfileWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    existing = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Company Profile already exists — use PUT to edit it")
    row = CompanyProfile(id=str(uuid.uuid4()), singleton_lock=True, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    # A field hidden/masked for this role must not leak back just because
    # this role is the one that created the record (MASTER-BUILD-PROMPT §3.2).
    return apply_field_masking(CompanyProfileOut.model_validate(row).model_dump(), perms)


@router.put("", response_model=None)
async def update_company_profile(
    body: CompanyProfileWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Company Profile has not been set up yet — POST first")
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(CompanyProfileOut.model_validate(row).model_dump(), perms)


# ------------------------------------------------------------------ Addresses
@router.get("/addresses/options", response_model=None)
async def list_address_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False, description="An employee or asset may still sit at a since-retired location and needs its label to resolve"),
) -> list[dict]:
    """The `label_field`/`/options` contract masters_lookup.py documents,
    applied to Company Addresses: `masters.company_profile` is Super-Admin-full
    / Manager-view and nothing at all for Accountant, HR and Employee
    (seed.py:69), but a company address is what Employee's Work Location and
    every Asset Location picker point at — so Accountant and HR were 404ing on
    `GET /masters/company-profile/addresses` across the Employee and Asset
    modules. Widening `masters.company_profile` in seed.py would also open the
    company's GSTIN/PAN/TAN/CIN singleton and its number-prefix rules, which is
    exactly the over-grant that docstring exists to prevent.

    Gated on plain authentication only, and returns ONE composed display
    string per row rather than the address record: `line1, city`. That is
    already the minimum a location picker can be read by — line1 alone does not
    distinguish two offices in different cities, city alone does not
    distinguish two offices in the same one — and it is the company's own
    published address, printed on every invoice its counterparties receive.
    `state_id`, `pin_code`, `line2`, `address_type` and `is_primary` are
    deliberately not selected, so nothing beyond that one label is reachable.
    """
    stmt = select(CompanyAddress.id, CompanyAddress.line1, CompanyAddress.city, CompanyAddress.is_active)
    if not include_inactive:
        stmt = stmt.where(CompanyAddress.is_active.is_(True))
    rows = (await db.execute(stmt)).all()
    return [
        {"id": row_id, "label": ", ".join(part for part in (line1, city) if part), "is_active": is_active}
        for row_id, line1, city, is_active in rows
    ]


@router.get("/addresses", response_model=None)
async def list_addresses(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[dict]:
    rows = (await db.execute(select(CompanyAddress))).scalars().all()
    # response_model dropped (was list[CompanyAddressOut]) — same reasoning as
    # get_company_profile above: a strict list response_model would re-shape
    # each dict on the way out and undo the masking just applied on the way in.
    return [apply_field_masking(CompanyAddressOut.model_validate(row).model_dump(), perms) for row in rows]


@router.post("/addresses", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_address(
    body: CompanyAddressWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    # Found missing while wiring the frontend: unlike the singleton profile
    # endpoints above, this one never caught DBAPIError at all, so a bad
    # address_type (ck_company_addresses_type) or state_id (fk_..._state)
    # surfaced as a raw unhandled 500 instead of a clean 4xx — same class of
    # gap this file's own _as_client_error was already built for elsewhere.
    row = CompanyAddress(id=str(uuid.uuid4()), is_primary=False, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(CompanyAddressOut.model_validate(row).model_dump(), perms)


@router.put("/addresses/{address_id}", response_model=None)
async def update_address(
    address_id: str,
    body: CompanyAddressWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """MASTER-BUILD-PROMPT.md §4.2: company-addresses was one of four Masters
    forms with no updateEndpoint — a record that could be created but never
    corrected. Named alongside financial-years (fixed in financial_years.py's
    update_financial_year) as a defect to fix regardless of what the
    prototype's own UI offers, which for this screen is nothing — no Edit
    action, no clickable row (app-screens2.js's `addresses` tab renders only
    an Add Another Address button). Same shape as add_address above:
    address_type/line1/line2/city/state_id/pin_code, DBAPIError caught the
    same way. is_primary/is_active are untouched here — those stay the job of
    set-primary/deactivate, exactly as create leaves them.
    """
    row = await db.get(CompanyAddress, address_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(CompanyAddressOut.model_validate(row).model_dump(), perms)


@router.post("/addresses/{address_id}/set-primary", response_model=None)
async def set_primary_address(
    address_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    target = await db.get(CompanyAddress, address_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not target.is_active:
        # Without this an inactive address could be promoted to Primary, which
        # demoted the live REGISTERED_OFFICE primary and left the company with
        # a primary address that list screens show as Inactive. Unlike Bank
        # Account's default there is no DB guard here at all, so both
        # directions into the primary+inactive state have to be closed in this
        # file: here, and in deactivate_address below.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Activate this address before making it the primary one")
    # Masters §3.6b: "marking a new one automatically un-marks the previous
    # one." MySQL forbids a trigger from updating the same table it fires on,
    # so this swap lives here — unset-then-set, same pattern as Bank Account's
    # default and for the same reason (the one-Primary guard is a generated
    # column with a plain UNIQUE, not a deferred constraint).
    current_primary = (await db.execute(select(CompanyAddress).where(CompanyAddress.is_primary.is_(True)))).scalar_one_or_none()
    if current_primary is not None and current_primary.id != target.id:
        current_primary.is_primary = False
        current_primary.updated_by = current_user.id
        await db.flush()
    target.is_primary = True
    target.updated_by = current_user.id
    await db.commit()
    await db.refresh(target)
    return apply_field_masking(CompanyAddressOut.model_validate(target).model_dump(), perms)


@router.post("/addresses/{address_id}/deactivate", response_model=None)
async def deactivate_address(
    address_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await db.get(CompanyAddress, address_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.is_primary:
        # Same invariant Bank Account states as "Choose a new default account
        # before deactivating this one" — the company must not be left with a
        # Primary address that is Inactive. Bank Account has both an API check
        # and a DB trigger; company_addresses has neither, so this is the only
        # thing standing between a deactivate and that state.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Choose a new primary address before deactivating this one")
    row.is_active = False
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return apply_field_masking(CompanyAddressOut.model_validate(row).model_dump(), perms)


@router.post("/addresses/{address_id}/activate", response_model=None)
async def activate_address(
    address_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """deactivate_address had no counterpart: CompanyAddressWrite carries no
    is_active field, so an address deactivated by mistake could never be
    brought back through the API. That also made set-primary's new is_active
    guard a dead end. Same shape and permission action as deactivate_address,
    matching the deactivate/activate pairs in masters_tax_schemes.py and
    vendors.py.
    """
    row = await db.get(CompanyAddress, address_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_active = True
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return apply_field_masking(CompanyAddressOut.model_validate(row).model_dump(), perms)


# ------------------------------------------------------------ Number Prefixes
@router.get("/number-prefix-rules", response_model=None)
async def list_prefix_rules(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[dict]:
    rows = (await db.execute(select(NumberPrefixRule))).scalars().all()
    # response_model dropped (was list[NumberPrefixRuleOut]) — same reasoning
    # as list_addresses above.
    return [apply_field_masking(NumberPrefixRuleOut.model_validate(row).model_dump(), perms) for row in rows]


@router.post("/number-prefix-rules", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_prefix_rule(
    body: NumberPrefixRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """Found missing by the Phase 1 audit: without this, PUT (which 404s on
    an unknown code_type) was the only route, and app/seed.py's default rows
    (see SEED_NUMBER_PREFIX_RULES) cover the 9 code types Masters §3.6e's
    "Proposed starting defaults" table names — but a Super Admin still needs
    a way to add one Section 3.6e doesn't anticipate.
    """
    existing = (await db.execute(select(NumberPrefixRule).where(NumberPrefixRule.code_type == body.code_type))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"A Number Prefix Rule for {body.code_type} already exists — use PUT to edit it")
    row = NumberPrefixRule(id=str(uuid.uuid4()), created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(NumberPrefixRuleOut.model_validate(row).model_dump(), perms)


@router.put("/number-prefix-rules/{code_type}", response_model=None)
async def update_prefix_rule(
    code_type: str,
    body: NumberPrefixRuleWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = (await db.execute(select(NumberPrefixRule).where(NumberPrefixRule.code_type == code_type))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.starting_number_locked and body.starting_number != row.starting_number:
        # Matches trg_prefix_rules_reject_start_change — checked here first
        # so the rejection is a clean 409, same split as everywhere else.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Starting Number is immutable once any code of this type has been generated")
    row.prefix = body.prefix
    row.include_fy_in_code = body.include_fy_in_code
    row.running_number_digits = body.running_number_digits
    row.starting_number = body.starting_number
    row.resets_every_fy = body.resets_every_fy
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(NumberPrefixRuleOut.model_validate(row).model_dump(), perms)
