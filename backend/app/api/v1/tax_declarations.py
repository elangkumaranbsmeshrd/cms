"""Employee §2.14 My Tax Declarations — Tax Scheme Election + the annual
Tax Declaration (lines auto-populated from every active EMPLOYEE_DECLARATION-
scoped tax head, plus one catch-all "Other" line).

Screen mode is 'full' for every role (seed.py: "own baseline; 'verify'
action unlocks cross-employee view") — there is no dedicated 'own' scope
mode here, so the own/cross-employee split is enforced in-router: any
caller may act on their own employee_id; only a caller holding the 'verify'
action may act on someone else's.
"""

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.services import fy_lock
from app.models.employee import (
    Employee,
    EmployeeTaxSchemeElection,
    TaxDeclaration,
    TaxDeclarationLine,
    TaxDeclarationLineProof,
)
from app.models.masters import TaxHead, TaxScheme
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.employee import (
    TaxDeclarationLineOut,
    TaxDeclarationLineProofOut,
    TaxDeclarationLineWrite,
    TaxDeclarationOut,
    TaxDeclarationVerifyLineDecision,
    TaxSchemeElectionCreate,
    TaxSchemeElectionOut,
)
from app.services import org_scope
from app.services.numbering import get_current_financial_year

router = APIRouter(tags=["employee"])
SCREEN = "employee.tax_declarations"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _guard_own_or_verify(db: AsyncSession, current_user: User, perms: PermissionSet, employee_id: str) -> None:
    """VIEW-ONLY cross-employee guard — for GET endpoints. 'verify' unlocks
    reading any employee's declaration (Employee §2.14: "HR and Super Admin
    can view (not edit) any employee's declaration, for verification
    purposes"), never editing it. Do not use this for a mutation."""
    if perms.can("verify"):
        return
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != employee_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only act on your own tax declarations")


async def _guard_own_or_manage(db: AsyncSession, current_user: User, perms: PermissionSet, employee_id: str) -> None:
    """Edit-type endpoints (elect scheme, create/edit/submit a declaration)
    are self-only UNLESS the caller holds 'manage' (Super Admin's own "Full,
    all employees" reach, §2.14) — found by the Phase 2 audit: reusing
    _guard_own_or_verify here let anyone holding 'verify' (Accountant, HR
    too) edit and submit another employee's declared amounts, contradicting
    the spec's own "view (not edit)" wording for those two roles.
    """
    if perms.can("manage"):
        return
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != employee_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only edit your own tax declarations")


async def _recompute_declaration_totals(db: AsyncSession, declaration: TaxDeclaration) -> None:
    """Re-derive the three header aggregates from the declaration's own lines.

    These used to be written ONLY inside submit and verify, so between those
    two moments the header contradicted the lines sitting right beside it in
    the same payload: a DRAFT reported total_declared_amount 0.00 over lines
    adding up to 105000.00, and a line rejected during verification left
    has_flagged_lines false while that line's own flagged_for_review was
    true. Every handler that can change a line now calls this, so the header
    is never stale.
    """
    lines = (
        await db.execute(select(TaxDeclarationLine).where(TaxDeclarationLine.tax_declaration_id == declaration.id))
    ).scalars().all()
    declaration.total_declared_amount = sum((line.amount_declared for line in lines), Decimal("0"))
    declaration.total_eligible_amount = sum((line.amount_accepted_for_calculation for line in lines), Decimal("0"))
    declaration.has_flagged_lines = any(line.flagged_for_review for line in lines)


async def _line_to_out(db: AsyncSession, line: TaxDeclarationLine) -> TaxDeclarationLineOut:
    """One line plus whatever proofs are attached to it. §2.14 makes Proof
    Upload part of the line ("File upload (multiple)"), so a line that comes
    back without its proofs leaves the screen unable to say whether the
    employee has already attached one — which is exactly what a
    Requires Proof head is asking them to check."""
    out = TaxDeclarationLineOut.model_validate(line)
    out.proofs = list(
        (
            await db.execute(
                select(TaxDeclarationLineProof)
                .where(TaxDeclarationLineProof.tax_declaration_line_id == line.id)
                .order_by(TaxDeclarationLineProof.uploaded_at)
            )
        ).scalars().all()
    )
    return out


async def _declaration_to_out(db: AsyncSession, declaration: TaxDeclaration) -> TaxDeclarationOut:
    lines = (
        await db.execute(
            select(TaxDeclarationLine).where(TaxDeclarationLine.tax_declaration_id == declaration.id).order_by(TaxDeclarationLine.display_order)
        )
    ).scalars().all()
    out = TaxDeclarationOut.model_validate(declaration)
    out.lines = [await _line_to_out(db, line) for line in lines]
    return out


# =========================================================== SCHEME ELECTION
@router.post("/employees/{employee_id}/tax-scheme-elections", response_model=TaxSchemeElectionOut, status_code=status.HTTP_201_CREATED)
async def elect_tax_scheme(
    employee_id: str,
    body: TaxSchemeElectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> EmployeeTaxSchemeElection:
    await _guard_own_or_manage(db, current_user, perms, employee_id)
    scheme = await db.get(TaxScheme, body.tax_scheme_id)
    if scheme is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax scheme not found")
    fy = await get_current_financial_year(db)

    previous = (
        await db.execute(
            select(EmployeeTaxSchemeElection).where(
                EmployeeTaxSchemeElection.employee_id == employee_id,
                EmployeeTaxSchemeElection.financial_year_id == fy.id,
                EmployeeTaxSchemeElection.superseded_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if previous is not None and scheme.choice_window == "ONCE_PER_FY":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This Tax Scheme's choice window only allows one election per Financial Year")

    row = EmployeeTaxSchemeElection(
        id=str(uuid.uuid4()), employee_id=employee_id, financial_year_id=fy.id, tax_scheme_id=scheme.id,
        scheme_name_snapshot=scheme.scheme_name, choice_window_snapshot=scheme.choice_window, was_default=scheme.is_default,
        elected_at=datetime.now(timezone.utc), elected_by_user_id=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    # ORDER MATTERS. ux_etse_current is UNIQUE over the generated column
    # current_guard = IF(superseded_at IS NULL, employee_id:financial_year_id,
    # NULL), so exactly one un-superseded election may exist per employee per
    # FY. Inserting the new row first (what this used to do) meant both rows
    # carried the same guard value for the duration of the transaction and
    # every scheme *change* died on the unique key — an unguarded flush, so
    # it escaped as a 500 and an employee's tax scheme could never be changed
    # once one was on record. Retire the old election first, flush that
    # UPDATE, then insert.
    #
    # superseded_by_election_id can only be set AFTER the insert:
    # fk_etse_superseded_by points back into this same table and InnoDB
    # checks it immediately, so pointing at row.id before row exists would
    # just trade one IntegrityError for another.
    if previous is not None:
        previous.superseded_at = datetime.now(timezone.utc)
        previous.updated_by = current_user.id
        await db.flush()
    db.add(row)
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    if previous is not None:
        previous.superseded_by_election_id = row.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.get("/employees/{employee_id}/tax-scheme-elections", response_model=list[TaxSchemeElectionOut])
async def list_tax_scheme_elections(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[EmployeeTaxSchemeElection]:
    await _guard_own_or_verify(db, current_user, perms, employee_id)
    rows = (
        await db.execute(select(EmployeeTaxSchemeElection).where(EmployeeTaxSchemeElection.employee_id == employee_id))
    ).scalars().all()
    return list(rows)


# ============================================================== DECLARATION
@router.post("/employees/{employee_id}/tax-declarations", response_model=TaxDeclarationOut, status_code=status.HTTP_201_CREATED)
async def create_tax_declaration(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> TaxDeclarationOut:
    await _guard_own_or_manage(db, current_user, perms, employee_id)
    fy = await get_current_financial_year(db)

    election = (
        await db.execute(
            select(EmployeeTaxSchemeElection).where(
                EmployeeTaxSchemeElection.employee_id == employee_id,
                EmployeeTaxSchemeElection.financial_year_id == fy.id,
                EmployeeTaxSchemeElection.superseded_at.is_(None),
            )
        )
    ).scalar_one_or_none()

    declaration = TaxDeclaration(
        id=str(uuid.uuid4()), employee_id=employee_id, financial_year_id=fy.id,
        tax_scheme_election_id=election.id if election else None,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(declaration)
    # ux_td_employee_fy rejects a second declaration for the same employee +
    # FY right here, at the INSERT — outside the try/except around the commit
    # below, which is why the handler's own "already exists" message was
    # unreachable dead code and a duplicate 500'd instead of 409'ing.
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A Tax Declaration for this Financial Year already exists") from exc

    heads = (
        await db.execute(
            select(TaxHead).where(
                TaxHead.scope == "EMPLOYEE_DECLARATION", TaxHead.is_active.is_(True), TaxHead.applies_from <= fy.end_date
            )
        )
    ).scalars().all()
    heads = [h for h in heads if h.applies_until is None or h.applies_until >= fy.start_date]
    for order, head in enumerate(heads):
        behaviour = head.behaviour or {}
        db.add(TaxDeclarationLine(
            id=str(uuid.uuid4()), tax_declaration_id=declaration.id, tax_head_id=head.id,
            declaration_name_snapshot=head.tax_name, guidance_snapshot=head.notes, declaration_cap_snapshot=head.declaration_cap,
            requires_proof_snapshot=bool(behaviour.get("requires_proof", False)),
            reduces_taxable_income_snapshot=bool(behaviour.get("reduces_taxable_income", True)),
            display_order=order, created_by=current_user.id, updated_by=current_user.id,
        ))
    # ck_tdl_other_desc (0003_employee_leave.py) requires a NON-EMPTY
    # other_description whenever is_other_catch_all — found live against
    # real MySQL by the Phase 2 audit: seeding "" here violated the CHECK on
    # every call, something the SQLite test models never catch since CHECK
    # constraints live only in the migration by this codebase's own
    # convention. A placeholder the employee is expected to overwrite via
    # update_declaration_line before submitting.
    db.add(TaxDeclarationLine(
        id=str(uuid.uuid4()), tax_declaration_id=declaration.id, is_other_catch_all=True,
        declaration_name_snapshot="Other", other_description="(not yet specified)", display_order=len(heads),
        created_by=current_user.id, updated_by=current_user.id,
    ))

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A Tax Declaration for this Financial Year already exists") from exc
    await db.refresh(declaration)
    return await _declaration_to_out(db, declaration)


@router.get("/employees/{employee_id}/tax-declarations/current", response_model=TaxDeclarationOut)
async def get_current_tax_declaration(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> TaxDeclarationOut:
    await _guard_own_or_verify(db, current_user, perms, employee_id)
    fy = await get_current_financial_year(db)
    declaration = (
        await db.execute(
            select(TaxDeclaration).where(TaxDeclaration.employee_id == employee_id, TaxDeclaration.financial_year_id == fy.id)
        )
    ).scalar_one_or_none()
    if declaration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Tax Declaration for the current Financial Year yet")
    return await _declaration_to_out(db, declaration)


@router.put("/tax-declaration-lines/{line_id}", response_model=TaxDeclarationLineOut)
async def update_declaration_line(
    line_id: str,
    body: TaxDeclarationLineWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> TaxDeclarationLineOut:
    line = await db.get(TaxDeclarationLine, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    declaration = await db.get(TaxDeclaration, line.tax_declaration_id)
    await _guard_own_or_manage(db, current_user, perms, declaration.employee_id)
    # THE LOCK RULE (APPENDIX-B:13). tax_declaration_lines carries NO FY-lock
    # trigger, so before this guard existed a declared amount inside a frozen
    # year could be rewritten by anyone — including the plain Employee whose
    # declaration it is — and that figure feeds the income-tax calculation.
    await fy_lock.assert_fy_not_locked(db, declaration.financial_year_id, what="This tax declaration")
    if declaration.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This declaration has been submitted — only verification fields may still change")

    line.amount_declared = body.amount_declared
    if line.is_other_catch_all and body.other_description is not None and body.other_description.strip():
        # Only overwrite when a real value is supplied — the CHECK
        # constraint requires this field non-empty at all times for a
        # catch-all line, so blanking it on a save that only touched
        # amount_declared would trip the same CHECK fixed above.
        line.other_description = body.other_description
    line.updated_by = current_user.id
    await _recompute_declaration_totals(db, declaration)
    declaration.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Amount exceeds the declaration cap for this head") from exc
    await db.refresh(line)
    return await _line_to_out(db, line)


@router.post("/tax-declaration-lines/{line_id}/proofs", response_model=TaxDeclarationLineProofOut, status_code=status.HTTP_201_CREATED)
async def upload_proof(
    line_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> TaxDeclarationLineProof:
    line = await db.get(TaxDeclarationLine, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    declaration = await db.get(TaxDeclaration, line.tax_declaration_id)
    await _guard_own_or_manage(db, current_user, perms, declaration.employee_id)

    row = TaxDeclarationLineProof(
        id=str(uuid.uuid4()), tax_declaration_line_id=line_id, file_id=file_id,
        uploaded_at=datetime.now(timezone.utc), uploaded_by_user_id=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This declaration has already been submitted") from exc
    await db.refresh(row)
    return row


@router.post("/employees/{employee_id}/tax-declarations/current/submit", response_model=TaxDeclarationOut)
async def submit_tax_declaration(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="submit")),
) -> TaxDeclarationOut:
    await _guard_own_or_manage(db, current_user, perms, employee_id)
    fy = await get_current_financial_year(db)
    declaration = (
        await db.execute(
            select(TaxDeclaration).where(TaxDeclaration.employee_id == employee_id, TaxDeclaration.financial_year_id == fy.id)
        )
    ).scalar_one_or_none()
    if declaration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if declaration.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already submitted")

    lines = (await db.execute(select(TaxDeclarationLine).where(TaxDeclarationLine.tax_declaration_id == declaration.id))).scalars().all()
    for line in lines:
        if line.requires_proof_snapshot and line.amount_declared > 0:
            proof_count = (
                await db.execute(select(TaxDeclarationLineProof).where(TaxDeclarationLineProof.tax_declaration_line_id == line.id))
            ).scalars().all()
            if not proof_count:
                line.flagged_for_review = True
                line.verification_status = "PROOF_MISSING"

    await _recompute_declaration_totals(db, declaration)
    declaration.status = "SUBMITTED"
    declaration.submitted_at = datetime.now(timezone.utc)
    declaration.submitted_by_user_id = current_user.id
    declaration.updated_by = current_user.id
    await db.commit()
    await db.refresh(declaration)
    return await _declaration_to_out(db, declaration)


@router.post("/tax-declaration-lines/{line_id}/verify", response_model=TaxDeclarationLineOut)
async def verify_declaration_line(
    line_id: str,
    body: TaxDeclarationVerifyLineDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="verify")),
) -> TaxDeclarationLineOut:
    line = await db.get(TaxDeclarationLine, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    line.verification_status = body.verification_status
    line.verification_note = body.verification_note
    line.flagged_for_review = body.verification_status in ("PROOF_MISSING", "REJECTED")
    if body.amount_accepted_for_calculation is not None:
        line.amount_accepted_for_calculation = body.amount_accepted_for_calculation
    elif body.verification_status == "PROOF_MATCHES":
        line.amount_accepted_for_calculation = line.amount_declared
    else:
        line.amount_accepted_for_calculation = Decimal("0")
    line.updated_by = current_user.id
    declaration = await db.get(TaxDeclaration, line.tax_declaration_id)
    await _recompute_declaration_totals(db, declaration)
    declaration.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(line)
    return await _line_to_out(db, line)


@router.post("/employees/{employee_id}/tax-declarations/current/verify", response_model=TaxDeclarationOut)
async def verify_tax_declaration(
    employee_id: str,
    verification_note: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="verify")),
) -> TaxDeclarationOut:
    fy = await get_current_financial_year(db)
    declaration = (
        await db.execute(
            select(TaxDeclaration).where(TaxDeclaration.employee_id == employee_id, TaxDeclaration.financial_year_id == fy.id)
        )
    ).scalar_one_or_none()
    if declaration is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if declaration.status != "SUBMITTED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Must be Submitted before it can be Verified")

    lines = (await db.execute(select(TaxDeclarationLine).where(TaxDeclarationLine.tax_declaration_id == declaration.id))).scalars().all()
    if any(line.verification_status == "NOT_REVIEWED" for line in lines):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Every line must be reviewed before the declaration can be Verified")

    await _recompute_declaration_totals(db, declaration)
    declaration.status = "VERIFIED"
    declaration.verified_by = current_user.id
    declaration.verified_at = datetime.now(timezone.utc)
    declaration.verification_note = verification_note
    declaration.updated_by = current_user.id
    await db.commit()
    await db.refresh(declaration)
    return await _declaration_to_out(db, declaration)
