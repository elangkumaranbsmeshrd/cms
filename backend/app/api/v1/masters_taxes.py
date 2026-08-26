"""Masters §3.2 — Taxes. The whole tax engine's admin surface: CRUD on tax
heads plus their slab bands / split components / relief rules / withholding
directions, Duplicate (for a rate change — §3.2's "never edit a locked head,
Duplicate instead"), and a Calculate endpoint that drives the "live worked
example" the spec asks for beside the Add Tax form.

The arithmetic lock (Invariant 10) is checked HERE, in Python, before ever
issuing the UPDATE — not by catching the database trigger's rejection. The
trigger (0002_masters.py, trg_tax_heads_reject_locked_change) still exists
and was proven to fire directly at the DB layer; this mirrors Phase 0's
financial_years.py, where the same "check the business state first, let the
trigger be the defence-in-depth backstop for a direct-SQL bypass" split was
already established.

The lock is FIELD-LEVEL, not record-level (fixed by the Phase 1 audit, which
found the original version rejected every field the instant a head was
locked, including the labels the spec explicitly keeps editable, and made
the spec's own mandatory rate-change sequence — edit the locked head's
Applies Until, then Duplicate — impossible to execute). _LABEL_FIELDS stay
editable regardless of lock state; _ARITHMETIC_FIELDS only reject when the
new value actually differs from the stored one.

Masters §4.3 audit (2026-08): two more gaps fixed in the same spirit.
update_tax_head previously never wrote the child tables at all (a slab band
or split component edit validated then silently vanished) — it now deletes
and reinserts them, gated by the same arithmetic lock as the scalar fields
they sit beside. And tax_type/scope/applies_from were createOnly with no
textual basis (the Status & Deletion Rule's locked list is exactly the six
_ARITHMETIC_FIELDS scalars, nothing about these three) — they now join that
bucket instead of being permanently frozen from the moment of creation.
"""

import logging
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import (
    TaxHead,
    TaxHeadReliefRule,
    TaxHeadSlabBand,
    TaxHeadSplitComponent,
    TaxHeadWithholdingDirection,
)
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import (
    ReliefRuleOut,
    SlabBandIn,
    SlabBandOut,
    SplitComponentIn,
    SplitComponentOut,
    TaxCalculationRequest,
    TaxCalculationResponse,
    TaxHeadCreate,
    TaxHeadOut,
)
from app.services import list_export, tax_engine
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/masters/taxes", tags=["masters"])
SCREEN = "masters.taxes"

logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    """Found live, this pass: every write route below committed with no
    DBAPIError guard at all — the only router in this codebase's Masters
    surface missing it (masters_lookup.py, masters_work_week.py,
    masters_bank_accounts.py, files.py all already have this exact pattern).
    tax_heads carries more per-tax_type CHECK constraints than any other
    table in the schema (ck_tax_heads_slab, _gst_split, _fixed, _decl_cap, …)
    plus ux_tax_heads_scope_name — a name reused in a Scope, or a Slab head
    saved with Slab Application left blank (a real gap this same pass found:
    the frontend field's own hint claimed blank was a valid, working choice;
    ck_tax_heads_slab disagrees and always has) — was a raw 500, not a clean
    error a form could show next to the field that caused it.

    The one collision worth naming outright is ux_tax_heads_scope_name: it is
    by far the most common rejection here (every Duplicate of a head under its
    own name hits it), and the generic fallback sends the reader off to check
    "the figures required for this Tax Type", which is not what went wrong.
    MySQL puts the key name in the 1062 text, so keying off it needs no
    pre-flight SELECT and — unlike a Python-side uniqueness check — stops
    firing on its own the day the index is redefined to include a date
    component, instead of freezing today's schema limitation into the router.
    """
    logger.warning("db constraint violation: %s", exc.orig)
    if "ux_tax_heads_scope_name" in str(exc.orig):
        return HTTPException(
            status.HTTP_409_CONFLICT,
            detail="A tax head with this Tax Name already exists in this Scope — the schema allows only one head per Scope + Tax Name, with no date component, so a new dated version cannot reuse the name. Give this version a distinct Tax Name.",
        )
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)

# Percentages/counts stay RIGHT-aligned, money stays LEFT-aligned — this
# project's own reversed convention (pdf_engine.ColumnSpec docstring).
_LIST_COLUMNS = [
    ColumnSpec("tax_name", "Tax Name"),
    ColumnSpec("short_code", "Short Code"),
    ColumnSpec("scope", "Scope"),
    ColumnSpec("tax_type", "Tax Type"),
    ColumnSpec("applies_from", "Applies From"),
    ColumnSpec("applies_until", "Applies Until"),
    ColumnSpec("rate_pct", "Rate %", align="right"),
    ColumnSpec("cgst_rate_pct", "CGST %", align="right"),
    ColumnSpec("sgst_rate_pct", "SGST %", align="right"),
    ColumnSpec("fixed_amount", "Fixed Amount", align="left"),
    ColumnSpec("declaration_cap", "Declaration Cap", align="left"),
    ColumnSpec("is_active", "Status"),
    ColumnSpec("usage_count", "Usage Count", align="right"),
]

# Masters §3.2 Status & Deletion Rule / APPENDIX-B "TAX ARITHMETIC LOCK":
# "Tax Name, Short Code, Description, and Ledger Code stay editable ... Only
# labels stay editable" once a head is locked. Notes absorbs the old
# Ledger Code field per the 2026-07-30 trim (§3.2a's own note).
_LABEL_FIELDS = ("tax_name", "short_code", "applies_until", "print_label", "notes", "remitted_to_authority", "authority_reference_label")
# Masters §4.3 audit: tax_type, scope and applies_from were in NONE of this
# router's three buckets, so update_tax_head silently discarded any change to
# them regardless of lock state — createOnly in the frontend was truthful
# about the bug, not about a spec requirement (the Status & Deletion Rule
# names only "Rate, Amount, slab bands, split component shares, caps, and
# Slab Application" as locking, and the DB trigger below only guards those
# same six columns). They join _ARITHMETIC_FIELDS rather than _LABEL_FIELDS
# because they are structural: tax_type decides which of the arithmetic
# columns are meaningful (the ck_tax_heads_* CHECK constraints enforce that
# pairing at the DB layer) and scope decides which child rows are legal
# (ck_relief_rules table trigger), so letting them change independently of
# the figures they govern, even after first use, would let a locked head's
# numbers be reinterpreted under a different shape without ever tripping the
# lock meant to protect exactly that.
_ARITHMETIC_FIELDS = ("tax_type", "scope", "applies_from", "rate_pct", "cgst_rate_pct", "sgst_rate_pct", "fixed_amount", "declaration_cap", "slab_application")
# Module 15 §7.9: "A head's Liability Arises On setting locks after its first
# remittance. Changing it later would silently re-file every historical
# amount into different periods." A THIRD lock, independent of
# is_arithmetic_locked (which locks on first use in a tax CALCULATION, not
# on a remittance ever being recorded) — found missing entirely by Module
# 15's own close-out audit: these six fields appeared in neither bucket
# above, so PUT silently no-opped any change to them regardless of lock
# state, making a Withholding head's compliance configuration permanently
# stuck at whatever was set on create.
_COMPLIANCE_FIELDS = ("creates_onward_liability", "remittance_period", "period_aligns_to", "deposit_due_days_after_period_end", "liability_arises_on", "certificate_expected")


def _validate_split_components(components: list[SplitComponentIn]) -> None:
    if not components:
        return
    total_share = sum((c.share_pct for c in components), start=components[0].share_pct * 0)
    if total_share != 100:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Split component shares must sum to 100, got {total_share}")


def _validate_slab_bands(bands: list[SlabBandIn]) -> None:
    """APPENDIX-B "SLAB BAND VALIDATION": bands may not overlap or leave a
    gap, and exactly one band may leave Band To blank ('and above') and it
    must be the last one. Both bounds are inclusive, so contiguity means one
    band's To equals the next band's From exactly. Runs at the API layer
    because MySQL cannot express a deferred, whole-set constraint like this
    (ARCH-1 D0.2/D0.4) — the DB's own generated-column guard only catches
    "more than one open band", not gaps or overlaps.
    """
    if not bands:
        return
    ordered = sorted(bands, key=lambda b: b.band_from)
    for i, band in enumerate(ordered):
        is_last = i == len(ordered) - 1
        if band.band_to is None:
            if not is_last:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Only the last slab band may leave Band To blank ('and above') — the band starting at {band.band_from} is not the last one",
                )
        elif not is_last and ordered[i + 1].band_from != band.band_to:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Slab bands must be contiguous with no gap or overlap: band ending at {band.band_to} is followed by one starting at {ordered[i + 1].band_from}",
            )
    if ordered[-1].band_to is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Exactly one slab band must be open-ended (Band To blank, 'and above'), and it must be the last band",
        )


def _validate_relief_rules(scope: str, relief_rules: list) -> None:
    if relief_rules and scope != "PAYROLL_INCOME_TAX":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Relief rules only apply to Payroll — Income Tax scoped heads")


def _validate_withholding_directions(scope: str, directions: list[str]) -> None:
    # Masters §3.2a Fields Table, Withholding Direction row: "Conditional —
    # required when Scope is Withholding / Deduction at Source. At least one
    # required."
    if scope == "WITHHOLDING_AT_SOURCE" and not directions:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one Withholding Direction is required when Scope is Withholding / Deduction at Source",
        )


def _head_kwargs(body: TaxHeadCreate) -> dict:
    """The full set of tax_heads columns a create/duplicate can set, in ONE
    place. Duplicate previously built this list separately and silently
    dropped tax_scheme_id/behaviour — this shared builder is the fix, since
    both callers now construct the same row the same way.
    """
    return dict(
        tax_name=body.tax_name,
        short_code=body.short_code,
        scope=body.scope,
        tax_type=body.tax_type,
        applies_from=body.applies_from,
        applies_until=body.applies_until,
        rate_pct=body.rate_pct,
        cgst_rate_pct=body.cgst_rate_pct,
        sgst_rate_pct=body.sgst_rate_pct,
        fixed_amount=body.fixed_amount,
        declaration_cap=body.declaration_cap,
        slab_application=body.slab_application,
        tax_scheme_id=body.tax_scheme_id,
        print_label=body.print_label,
        notes=body.notes,
        behaviour=body.behaviour,
        creates_onward_liability=body.creates_onward_liability,
        remitted_to_authority=body.remitted_to_authority,
        remittance_period=body.remittance_period,
        period_aligns_to=body.period_aligns_to,
        deposit_due_days_after_period_end=body.deposit_due_days_after_period_end,
        liability_arises_on=body.liability_arises_on,
        authority_reference_label=body.authority_reference_label,
        default_calculated_on=body.default_calculated_on,
        certificate_expected=body.certificate_expected,
        is_active=body.is_active,
    )


async def _insert_arithmetic_children(db: AsyncSession, head_id: str, body: TaxHeadCreate, user_id: str) -> None:
    """Slab bands, split components and relief rules — the three child row
    families whose rows change what a head computes, so update_tax_head
    (Masters §4.3 audit) only calls this when the head is unlocked, the same
    gate _ARITHMETIC_FIELDS itself is checked against there.
    """
    for band in body.slab_bands:
        db.add(TaxHeadSlabBand(id=str(uuid.uuid4()), tax_head_id=head_id, created_by=user_id, updated_by=user_id, **band.model_dump()))
    for comp in body.split_components:
        db.add(TaxHeadSplitComponent(id=str(uuid.uuid4()), tax_head_id=head_id, created_by=user_id, updated_by=user_id, **comp.model_dump()))
    for relief in body.relief_rules:
        db.add(TaxHeadReliefRule(id=str(uuid.uuid4()), tax_head_id=head_id, created_by=user_id, updated_by=user_id, **relief.model_dump()))


async def _insert_withholding_directions(db: AsyncSession, head_id: str, body: TaxHeadCreate, user_id: str) -> None:
    """Withholding Direction is in no lock bucket at all (§3.2a Fields Table)
    — update_tax_head (Masters §4.3 audit) replaces it unconditionally,
    unlike the three functions above.
    """
    for direction in body.withholding_directions:
        db.add(TaxHeadWithholdingDirection(id=str(uuid.uuid4()), tax_head_id=head_id, direction=direction, created_by=user_id, updated_by=user_id))


async def _insert_children(db: AsyncSession, head_id: str, body: TaxHeadCreate, user_id: str) -> None:
    """Every child row family a create/duplicate can carry, in ONE place —
    Duplicate previously only inserted slab_bands and split_components and
    silently dropped relief_rules and withholding_directions even when the
    caller supplied them; this shared inserter is the fix. A brand-new head
    has no lock yet, so both halves below always run together here — unlike
    update_tax_head, which calls them separately under different conditions.
    """
    await _insert_withholding_directions(db, head_id, body, user_id)
    await _insert_arithmetic_children(db, head_id, body, user_id)


async def _load_children(db: AsyncSession, tax_head_id: str):
    bands = (await db.execute(select(TaxHeadSlabBand).where(TaxHeadSlabBand.tax_head_id == tax_head_id))).scalars().all()
    components = (
        await db.execute(select(TaxHeadSplitComponent).where(TaxHeadSplitComponent.tax_head_id == tax_head_id))
    ).scalars().all()
    reliefs = (
        await db.execute(select(TaxHeadReliefRule).where(TaxHeadReliefRule.tax_head_id == tax_head_id))
    ).scalars().all()
    directions = (
        await db.execute(select(TaxHeadWithholdingDirection).where(TaxHeadWithholdingDirection.tax_head_id == tax_head_id))
    ).scalars().all()
    return list(bands), list(components), list(reliefs), list(directions)


async def _to_out(db: AsyncSession, head: TaxHead, perms: PermissionSet) -> dict:
    """Builds the full TaxHeadOut shape (including child rows) then masks it
    for the caller's resolved PermissionSet — Phase 1 wiring. TaxHeadOut is a
    real `class TaxHeadOut(BaseModel):` body with `model_config` set INSIDE
    the class (not a create_model(...) factory + later attribute
    assignment), so `.model_validate(head)` is safe here — see this router's
    own docstring / MASTER-BUILD-PROMPT.md Phase 1 for why that distinction
    matters. Masking runs on `.model_dump()`, i.e. only over TaxHeadOut's own
    top-level fields (rate_pct, fixed_amount, declaration_cap, etc.) — the
    nested slab_bands/split_components/relief_rules rows are not themselves
    masked, matching the same-shape pattern already used in customers.py's
    `_masked_customer`.
    """
    bands, components, reliefs, directions = await _load_children(db, head.id)
    out = TaxHeadOut.model_validate(head)
    out.slab_bands = [SlabBandOut.model_validate(b) for b in bands]
    out.split_components = [SplitComponentOut.model_validate(c) for c in components]
    out.relief_rules = [ReliefRuleOut.model_validate(r) for r in reliefs]
    out.withholding_directions = [d.direction for d in directions]
    return apply_field_masking(out.model_dump(), perms)


@router.get("", response_model=None)
async def list_tax_heads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    heads = (await db.execute(select(TaxHead))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the set on screen — this list has no
        # query filters of its own, so filters_applied is empty (build_export
        # still stamps the result count / exported-by / exported-at block).
        export_rows = [
            {
                "tax_name": h.tax_name, "short_code": h.short_code, "scope": h.scope, "tax_type": h.tax_type,
                "applies_from": h.applies_from, "applies_until": h.applies_until, "rate_pct": h.rate_pct,
                "cgst_rate_pct": h.cgst_rate_pct, "sgst_rate_pct": h.sgst_rate_pct, "fixed_amount": h.fixed_amount,
                "declaration_cap": h.declaration_cap, "is_active": "Active" if h.is_active else "Inactive",
                "usage_count": h.usage_count,
            }
            for h in heads
        ]
        return await list_export.build_export(format, db, current_user, "Tax Heads", _LIST_COLUMNS, export_rows, {})

    return [await _to_out(db, h, perms) for h in heads]


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_tax_head(
    body: TaxHeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    _validate_slab_bands(body.slab_bands)
    _validate_split_components(body.split_components)
    _validate_relief_rules(body.scope, body.relief_rules)
    _validate_withholding_directions(body.scope, body.withholding_directions)

    head = TaxHead(id=str(uuid.uuid4()), created_by=current_user.id, updated_by=current_user.id, **_head_kwargs(body))
    db.add(head)
    try:
        # The early flush (needed so head.id is visible to _insert_children's
        # FK inserts before the parent row itself commits) is what actually
        # sends the INSERT and evaluates tax_heads' own CHECK constraints —
        # found live, this pass: a try/except around commit() ALONE never
        # saw this exception, because it had already escaped here.
        await db.flush()
        await _insert_children(db, head.id, body, current_user.id)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint — check the figures required for this Tax Type, and that the Tax Name is unique within this Scope") from exc
    await db.refresh(head)
    return await _to_out(db, head, perms)


@router.put("/{head_id}", response_model=None)
async def update_tax_head(
    head_id: str,
    body: TaxHeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    head = await db.get(TaxHead, head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    for field in _LABEL_FIELDS:
        setattr(head, field, getattr(body, field))

    # Masters §4.3 audit: the child rows must be loaded (and, below, deleted)
    # BEFORE anything commits — this is the fix for update_tax_head never
    # having written TaxHeadSlabBand / TaxHeadSplitComponent /
    # TaxHeadReliefRule / TaxHeadWithholdingDirection rows at all. Everything
    # below only assigned head-level scalars; an edited slab band or a newly
    # added split component was validated (sometimes) then silently
    # discarded, because nothing ever touched these four tables.
    bands, components, reliefs, directions = await _load_children(db, head_id)

    # Everything below that touches the database — both intermediate
    # flushes (needed to force each DELETE before its re-INSERT, see the
    # comments below) as well as the final commit — is wrapped in ONE
    # try/except: found live, this pass, that a try/except around commit()
    # ALONE never sees a constraint violation raised by an EARLIER flush, and
    # this function has two. The two `raise HTTPException(409, ...)` calls
    # inside (arithmetic/compliance lock conflicts) are plain Python
    # exceptions, not DBAPIError, so wrapping them here changes nothing about
    # how they propagate.
    try:
        if head.is_arithmetic_locked:
            changed = [f for f in _ARITHMETIC_FIELDS if getattr(head, f) != getattr(body, f)]
            if changed:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail=f"This tax head has been used in a calculation and its figures are locked ({', '.join(changed)} changed) — use Duplicate instead",
                )
        else:
            _validate_slab_bands(body.slab_bands)
            _validate_split_components(body.split_components)
            _validate_relief_rules(body.scope, body.relief_rules)
            for field in _ARITHMETIC_FIELDS:
                setattr(head, field, getattr(body, field))
            # Delete-then-_insert_children-style reinsert, same shape
            # create_tax_head already uses — reachable only when unlocked, same
            # gate the scalar fields just above are checked against.
            for row in (*bands, *components, *reliefs):
                await db.delete(row)
            # Live-verified bug (§4.3 audit's own fix, re-tested after landing):
            # without this flush, the DELETEs above and the re-INSERTs below share
            # one autoflush, and MySQL sees the new rows before the old ones are
            # actually gone — a slab band re-saved with the same sequence_no hits
            # ux_slab_bands_seq's (tax_head_id, sequence_no) unique constraint
            # against its own not-yet-deleted predecessor (1062 Duplicate entry).
            # Flushing forces the DELETEs to execute first.
            await db.flush()
            await _insert_arithmetic_children(db, head.id, body, current_user.id)

        # Withholding Direction is governed by neither lock (§3.2a Fields Table),
        # so it is always validated and replaced from the submitted set, the same
        # as _LABEL_FIELDS above.
        _validate_withholding_directions(body.scope, body.withholding_directions)
        for row in directions:
            await db.delete(row)
        await db.flush()  # same delete-before-insert ordering fix as above
        await _insert_withholding_directions(db, head.id, body, current_user.id)

        from app.models.compliance import Remittance  # local: avoids a module-level Masters -> Module 15 import cycle

        has_remittances = (
            await db.execute(select(Remittance.id).where(Remittance.tax_head_id == head_id).limit(1))
        ).scalar_one_or_none() is not None
        if has_remittances:
            changed = [f for f in _COMPLIANCE_FIELDS if getattr(head, f) != getattr(body, f)]
            if changed:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail=f"This tax head already has a remittance recorded against it and its compliance settings are locked ({', '.join(changed)} changed) — Module 15 §7.9",
                )
        else:
            for field in _COMPLIANCE_FIELDS:
                setattr(head, field, getattr(body, field))

        head.updated_by = current_user.id
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint — check the figures required for this Tax Type, and that the Tax Name is unique within this Scope") from exc
    await db.refresh(head)
    return await _to_out(db, head, perms)


@router.post("/{head_id}/deactivate", response_model=None)
async def deactivate_tax_head(
    head_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),  # §3.0 rule 1: SA only, same as every other sub-master
) -> dict:
    head = await db.get(TaxHead, head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    head.is_active = False
    head.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(head)
    return await _to_out(db, head, perms)


@router.post("/{head_id}/duplicate", response_model=None, status_code=status.HTTP_201_CREATED)
async def duplicate_tax_head(
    head_id: str,
    body: TaxHeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """Masters §3.2: "when a rate genuinely changes ... set the current
    head's Applies Until to the day before the change, then add a new head
    (usually via Duplicate) with the new figures." The caller supplies the
    new figures (typically the old ones with a new rate + Applies From); this
    endpoint carries over everything create_tax_head would (same validation,
    same field set, same child rows) plus the one thing only Duplicate adds:
    the version-chain pointer.
    """
    original = await db.get(TaxHead, head_id)
    if original is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    _validate_slab_bands(body.slab_bands)
    _validate_split_components(body.split_components)
    _validate_relief_rules(body.scope, body.relief_rules)
    _validate_withholding_directions(body.scope, body.withholding_directions)

    new_head = TaxHead(
        id=str(uuid.uuid4()),
        supersedes_tax_head_id=original.id,
        created_by=current_user.id,
        updated_by=current_user.id,
        **_head_kwargs(body),
    )
    db.add(new_head)
    try:
        # Same early-flush reasoning as create_tax_head above — the
        # exception surfaces here, not at commit().
        await db.flush()
        await _insert_children(db, new_head.id, body, current_user.id)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint — check the figures required for this Tax Type, and that the Tax Name is unique within this Scope") from exc
    await db.refresh(new_head)
    return await _to_out(db, new_head, perms)


@router.delete("/{head_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tax_head(
    head_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> None:
    head = await db.get(TaxHead, head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if head.usage_count > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Never hard-deleted once used — POST /{head_id}/deactivate instead")
    # fk_slab_bands_head (0002_masters.py:205) and its three siblings are all
    # ON DELETE RESTRICT, not CASCADE — that migration's own comment says so
    # explicitly ("an unused head's bands must be deleted explicitly first,
    # which the API does"), but nothing here actually did: `await
    # db.delete(head)` alone left any head that had ever gained a slab band /
    # split component / relief rule / withholding direction permanently
    # undeletable (a raw FK-restrict 409, not even a helpful one), regardless
    # of usage_count. Found live, this pass.
    bands, components, reliefs, directions = await _load_children(db, head_id)
    for row in (*bands, *components, *reliefs, *directions):
        await db.delete(row)
    # Same ordering fix update_tax_head already needs (its own comment,
    # above): without forcing the child DELETEs to flush first, they and the
    # parent's DELETE can reach MySQL in an order the FK doesn't allow,
    # tripping fk_slab_bands_head (RESTRICT) even though every child row IS
    # being removed in this same transaction.
    await db.flush()
    await db.delete(head)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        # usage_count only tracks calculation use — a head set as e.g.
        # Company Profile's Default Billing Tax can have zero calculations
        # against it and still be ON DELETE RESTRICT'd by that FK.
        raise _as_client_error(exc, "Still referenced elsewhere — deactivate instead of deleting") from exc


def _snapshot_from_row(head: TaxHead, bands, components, reliefs) -> tax_engine.TaxHeadSnapshot:
    return tax_engine.TaxHeadSnapshot(
        tax_name=head.tax_name,
        tax_type=head.tax_type,
        applies_from=head.applies_from,
        applies_until=head.applies_until,
        rate_pct=head.rate_pct,
        cgst_rate_pct=head.cgst_rate_pct,
        sgst_rate_pct=head.sgst_rate_pct,
        fixed_amount=head.fixed_amount,
        declaration_cap=head.declaration_cap,
        slab_application=head.slab_application,
        slab_bands=tuple(
            tax_engine.SlabBand(b.sequence_no, b.band_from, b.band_to, b.rate_or_amount) for b in bands
        ),
        split_components=tuple(
            tax_engine.SplitComponent(c.component_name, c.share_pct) for c in components
        ),
        relief_rules=tuple(
            tax_engine.ReliefRule(r.relief_name, r.applies_if_base_at_or_below, r.relief_type, r.relief_amount)
            for r in reliefs
            if r.is_active
        ),
        print_label=head.print_label,
    )


@router.post("/calculate", response_model=TaxCalculationResponse)
async def calculate(
    body: TaxCalculationRequest,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),  # L1 only — the live worked example is read-only
) -> TaxCalculationResponse:
    """Drives the "live worked example" beside the Add Tax form (Masters
    §3.2's Screen Design) — and is exactly how a document line's own
    calculation would call the engine, so this endpoint doubles as a live
    proof that the isolated tax_engine module is wired correctly end to end.
    """
    head = await db.get(TaxHead, body.tax_head_id)
    if head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Found live, this pass: TaxCalculationRequest has declared `as_of` since
    # it was written and this handler never read it, so "what is this tax on
    # this date" answered with the head's figures whatever the date — a head
    # whose window closed on 2026-05-01 happily returned 12% for 2026-12-01
    # and for 1999-01-01. A silently ignored date on a tax calculator is a
    # wrong number, not a missing feature. This is the same in-force guard
    # tax_head_lookup.validate_head_usable applies to Invoice / Purchase Bill
    # / Expense tax lines, raised exactly the way those three routers raise
    # it (422 + the reason string). Only the date window is checked, not
    # scope or is_active, because this endpoint is the Add Tax form's live
    # worked example: it must still preview a head that is deactivated, or
    # one whose Scope is mid-edit in the form beside it. Omitting as_of keeps
    # the unconditional preview that same form relies on.
    if body.as_of is not None and (head.applies_from > body.as_of or (head.applies_until is not None and head.applies_until < body.as_of)):
        window = f"{head.applies_from.isoformat()} to {head.applies_until.isoformat() if head.applies_until is not None else 'open-ended'}"
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Tax head '{head.tax_name}' is not in force on {body.as_of.isoformat()} (in force {window})",
        )
    bands, components, reliefs, _directions = await _load_children(db, head.id)
    snapshot = _snapshot_from_row(head, bands, components, reliefs)
    result = tax_engine.calculate_tax(snapshot, body.base_amount)
    return TaxCalculationResponse(
        tax_head_id=head.id,
        label=result.label,
        base_amount=result.base_amount,
        gross_amount=result.gross_amount,
        computed_amount=result.computed_amount,
        components=[{"component_name": c.component_name, "amount": c.amount} for c in result.components],
        slab_breakdown=[{"sequence_no": b.sequence_no, "base_in_band": b.base_in_band, "amount": b.amount} for b in result.slab_breakdown],
        reliefs_applied=[{"relief_name": r.relief_name, "relief_applied": r.relief_applied} for r in result.reliefs_applied],
    )
