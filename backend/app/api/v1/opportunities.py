"""Opportunity (09-opportunity-module.md) — Pipeline (§2.1), Add/Edit (§2.2),
Record: Activities & Files (§2.3). The Won trigger (§3.3, both directions)
lives in app/services/opportunity_engine.py so this router and projects.py
share the exact same "mark this Opportunity Won" logic.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.customer import Customer
from app.models.opportunity import Opportunity, OpportunityActivity, OpportunityFile
from app.models.platform import StoredFile, User
from app.models.project import Project, ProjectMember
from app.models.rbac import FeatureToggle, Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet, resolve_permission
from app.schemas.opportunity import (
    OpportunityActivityOut,
    OpportunityActivityWrite,
    OpportunityFileOut,
    OpportunityOut,
    OpportunityWrite,
)
from app.services import list_export, opportunity_engine
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.org_scope import get_own_employee_id
from app.services.pdf_engine import ColumnSpec

_LIST_COLUMNS = [
    ColumnSpec("opportunity_code", "Opportunity Code"),
    ColumnSpec("title", "Title"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("stage", "Stage"),
    ColumnSpec("value", "Value", align="left"),
    ColumnSpec("probability_pct", "Probability", align="right"),
    ColumnSpec("expected_close_date", "Expected Close Date"),
]

router = APIRouter(prefix="/opportunities", tags=["opportunity"])
SCREEN = "opportunity.pipeline"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _manager_restricted_to_own(db: AsyncSession, perms: PermissionSet) -> bool:
    # §6.1 "Restrict Manager to Only Their Own Opportunities" — same "OFF =
    # Manager's seeded 'full' stands, ON = narrows to Owner-only" shape as
    # customers.py's own _manager_restricted_to_own, and the same reason it
    # can't be a resolver-level ModeGate (toggles.py's own ModeGate is
    # "never used to narrow"). Applied inside _build_opportunity_filters
    # itself (not per-endpoint) so list_opportunities and stage_summary —
    # which MUST agree on the filtered set, per this module's own most
    # important rule — can never drift on this dimension either.
    return perms.role_code == "MANAGER" and await _toggle_enabled(db, "Restrict Manager to Only Their Own Opportunities")


async def _resolve_opportunity_perms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_preview_role: str | None = Header(None),
) -> PermissionSet:
    """Same resolution require_screen(SCREEN) does (preview-role header
    included), but never raises on an invisible screen — stage_summary and
    get_opportunity need the resolved PermissionSet even for Accountant/
    Employee (mode='none', not visible at all) to decide whether one of
    §6.1's two read-only bypasses applies. require_screen itself 404s
    before the route body ever runs, which would make both bypasses
    unreachable — same reasoning as customers.py's _resolve_customer_perms.
    """
    preview_role_id: str | None = None
    if x_preview_role:
        real_role = await db.get(Role, current_user.role_id)
        if real_role and real_role.code == "SUPER_ADMIN":
            preview_role_row = (await db.execute(select(Role).where(Role.code == x_preview_role))).scalar_one_or_none()
            if preview_role_row:
                preview_role_id = preview_role_row.id
    return await resolve_permission(db, current_user, SCREEN, preview_role_id=preview_role_id)


async def _employee_can_view_opportunity(db: AsyncSession, employee_id: str, opportunity_id: str) -> bool:
    """§6.1 "Allow Employee to View the Opportunity Behind Their Assigned
    Project" — staffed means what project_scope.py's is_project_team_member
    means: the Project's Lead, or on its ProjectMember roster, for the one
    Project this Opportunity turned into (Project.opportunity_id).
    """
    member_project_ids = select(ProjectMember.project_id).where(ProjectMember.employee_id == employee_id)
    hit = (
        await db.execute(
            select(Project.id).where(
                Project.opportunity_id == opportunity_id,
                (Project.project_lead_id == employee_id) | (Project.id.in_(member_project_ids)),
            )
        )
    ).first()
    return hit is not None


async def _assert_opportunity_owned_if_restricted(db: AsyncSession, current_user: User, perms: PermissionSet, row: Opportunity) -> None:
    if await _manager_restricted_to_own(db, perms):
        own_id = await get_own_employee_id(db, current_user)
        if row.owner_id != own_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")


def _build_opportunity_filters(
    stmt,
    customer_id: str | None,
    stage: list[str] | None,
    owner_id: str | None,
    financial_year_id: str | None,
    value_min: Decimal | None,
    value_max: Decimal | None,
    probability_min: Decimal | None,
    probability_max: Decimal | None,
    expected_close_from: date_type | None,
    expected_close_to: date_type | None,
    overdue_only: bool,
    created_from: date_type | None,
    created_to: date_type | None,
    lost_reason: str | None,
    stale_days: int | None,
    created_by: str | None,
    last_modified_by: str | None,
    search: str | None,
    manager_own_id: str | None = None,
    restrict_to_manager_own: bool = False,
):
    """Shared by both list_opportunities and stage_summary — Appendix B's
    "stage counts/totals must match the same filtered set as the table" rule
    only holds if both endpoints build the exact same WHERE clause.
    `restrict_to_manager_own`: True when §6.1's Manager-restriction toggle
    applies to the caller — narrows to `manager_own_id` (which may itself be
    None, for a Manager with no linked Employee record — that still means
    "only unowned rows", not "no restriction"; a bare
    `if manager_own_id is not None` would wrongly treat the two as the same
    and skip the restriction entirely, which is the real bug this flag
    exists to avoid).
    """
    if restrict_to_manager_own:
        stmt = stmt.where(Opportunity.owner_id == manager_own_id)
    if customer_id:
        stmt = stmt.where(Opportunity.customer_id == customer_id)
    if stage:
        stmt = stmt.where(Opportunity.stage.in_(stage))
    if owner_id:
        stmt = stmt.where(Opportunity.owner_id == owner_id)
    if financial_year_id:
        stmt = stmt.where(Opportunity.financial_year_id == financial_year_id)
    if value_min is not None:
        stmt = stmt.where(Opportunity.value >= value_min)
    if value_max is not None:
        stmt = stmt.where(Opportunity.value <= value_max)
    if probability_min is not None:
        stmt = stmt.where(Opportunity.probability_pct >= probability_min)
    if probability_max is not None:
        stmt = stmt.where(Opportunity.probability_pct <= probability_max)
    if expected_close_from:
        stmt = stmt.where(Opportunity.expected_close_date >= expected_close_from)
    if expected_close_to:
        stmt = stmt.where(Opportunity.expected_close_date <= expected_close_to)
    if overdue_only:
        stmt = stmt.where(Opportunity.expected_close_date < date_type.today(), Opportunity.stage.notin_(("WON", "LOST")))
    if created_from:
        stmt = stmt.where(Opportunity.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Opportunity.created_at <= created_to)
    if lost_reason:
        stmt = stmt.where(Opportunity.lost_reason.ilike(f"%{lost_reason}%"))
    if stale_days is not None:
        # §2.1 "stale — no activity in N days". An opportunity that has never
        # had an activity logged is measured from when it was CREATED, not
        # treated as unconditionally stale: a bare
        # `last_activity_at IS NULL OR last_activity_at < cutoff` matched
        # every never-touched deal at every threshold, so stale_days=99999
        # ("nothing in 273 years") returned deals created two days ago and
        # the whole filter — plus stage_summary's counts and ₹ totals, which
        # share this helper — degraded to a constant row set.
        cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
        stmt = stmt.where(
            Opportunity.stage.notin_(("WON", "LOST")),
            func.coalesce(Opportunity.last_activity_at, Opportunity.created_at) < cutoff,
        )
    if created_by:
        stmt = stmt.where(Opportunity.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(Opportunity.updated_by == last_modified_by)
    if search:
        stmt = stmt.outerjoin(Customer, Customer.id == Opportunity.customer_id).where(
            or_(Opportunity.title.ilike(f"%{search}%"), Customer.company_name.ilike(f"%{search}%"), Customer.display_name.ilike(f"%{search}%"))
        )
    return stmt


@router.get("", response_model=None)
async def list_opportunities(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    customer_id: str | None = Query(None),
    stage: list[str] | None = Query(None),
    owner_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    value_min: Decimal | None = Query(None),
    value_max: Decimal | None = Query(None),
    probability_min: Decimal | None = Query(None),
    probability_max: Decimal | None = Query(None),
    expected_close_from: date_type | None = Query(None),
    expected_close_to: date_type | None = Query(None),
    overdue_only: bool = Query(False),
    created_from: date_type | None = Query(None),
    created_to: date_type | None = Query(None),
    lost_reason: str | None = Query(None),
    stale_days: int | None = Query(None),
    created_by: str | None = Query(None),
    last_modified_by: str | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[Opportunity] | Response:
    restrict_to_manager_own = await _manager_restricted_to_own(db, perms)
    manager_own_id = await get_own_employee_id(db, current_user) if restrict_to_manager_own else None
    stmt = _build_opportunity_filters(
        select(Opportunity), customer_id, stage, owner_id, financial_year_id, value_min, value_max,
        probability_min, probability_max, expected_close_from, expected_close_to, overdue_only,
        created_from, created_to, lost_reason, stale_days, created_by, last_modified_by, search,
        manager_own_id=manager_own_id, restrict_to_manager_own=restrict_to_manager_own,
    )
    rows = (await db.execute(stmt.order_by(Opportunity.expected_close_date))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered set on screen — same rows
        # the JSON branch below would return, just re-shaped.
        customer_ids = {r.customer_id for r in rows}
        customers = {}
        if customer_ids:
            customer_rows = (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all()
            customers = {c.id: c.company_name for c in customer_rows}
        export_rows = [
            {
                "opportunity_code": r.opportunity_code, "title": r.title, "customer": customers.get(r.customer_id),
                "stage": r.stage, "value": r.value, "probability_pct": r.probability_pct,
                "expected_close_date": r.expected_close_date,
            }
            for r in rows
        ]
        filters_applied = {
            "customer_id": customer_id, "stage": stage, "owner_id": owner_id, "financial_year_id": financial_year_id,
            "value_min": value_min, "value_max": value_max, "probability_min": probability_min, "probability_max": probability_max,
            "expected_close_from": expected_close_from, "expected_close_to": expected_close_to, "overdue_only": overdue_only,
            "created_from": created_from, "created_to": created_to, "lost_reason": lost_reason, "stale_days": stale_days,
            "created_by": created_by, "last_modified_by": last_modified_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Opportunities", _LIST_COLUMNS, export_rows, filters_applied)

    return list(rows)


@router.get("/summary/by-stage")
async def stage_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_opportunity_perms),
    customer_id: str | None = Query(None),
    stage: list[str] | None = Query(None),
    owner_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    value_min: Decimal | None = Query(None),
    value_max: Decimal | None = Query(None),
    probability_min: Decimal | None = Query(None),
    probability_max: Decimal | None = Query(None),
    expected_close_from: date_type | None = Query(None),
    expected_close_to: date_type | None = Query(None),
    overdue_only: bool = Query(False),
    created_from: date_type | None = Query(None),
    created_to: date_type | None = Query(None),
    lost_reason: str | None = Query(None),
    stale_days: int | None = Query(None),
    created_by: str | None = Query(None),
    last_modified_by: str | None = Query(None),
    search: str | None = Query(None),
) -> dict:
    """§2.1 Stage Summary — per-stage counts + ₹ totals over exactly the
    same filtered set as the Pipeline table (Appendix B, most-consequential
    rule for this view).

    §6.1 "Give Accountant Read Access to Pipeline Value" — OFF by default,
    Accountant has zero opportunity.pipeline access otherwise. This is the
    one endpoint that toggle grants: "a read-only summary of total pipeline
    value by stage" is exactly what this already returns, so the toggle
    reuses it rather than standing up a second endpoint that could drift
    from it. Uses _resolve_opportunity_perms (not require_screen) for the
    same reason customers.py's Employee-activity bypass does — Accountant's
    mode is 'none' here, so require_screen would 404 before this body runs.
    """
    if not perms.visible:
        if not (perms.role_code == "ACCOUNTANT" and await _toggle_enabled(db, "Give Accountant Read Access to Pipeline Value")):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
    restrict_to_manager_own = await _manager_restricted_to_own(db, perms)
    manager_own_id = await get_own_employee_id(db, current_user) if restrict_to_manager_own else None
    stmt = _build_opportunity_filters(
        select(Opportunity), customer_id, stage, owner_id, financial_year_id, value_min, value_max,
        probability_min, probability_max, expected_close_from, expected_close_to, overdue_only,
        created_from, created_to, lost_reason, stale_days, created_by, last_modified_by, search,
        manager_own_id=manager_own_id, restrict_to_manager_own=restrict_to_manager_own,
    )
    rows = (await db.execute(stmt)).scalars().all()
    by_stage: dict[str, dict] = {
        s: {"count": 0, "total_value": Decimal("0")} for s in ("PROSPECTING", "QUALIFYING", "PROPOSAL", "WON", "LOST")
    }
    for r in rows:
        entry = by_stage[r.stage]
        entry["count"] += 1
        if r.value:
            entry["total_value"] += r.value
    return {"by_stage": by_stage}


@router.get("/probability-suggestion")
async def probability_suggestion(
    stage: str,
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict:
    """§2.2: Probability auto-fills on Stage change but "stays manually
    editable" — this exposes the same lookup table opportunity_engine.
    mark_opportunity_won() uses internally, so a frontend never has to
    hardcode its own independent copy of the Prospecting=10/Qualifying=30/
    Proposal=60/Lost=0 map.
    """
    return {"stage": stage, "suggested_probability_pct": opportunity_engine.suggest_probability(stage)}


@router.post("", response_model=OpportunityOut, status_code=status.HTTP_201_CREATED)
async def create_opportunity(
    body: OpportunityWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> Opportunity:
    if await db.get(Customer, body.customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
    fy = await get_current_financial_year(db)
    code = await allocate_number(db, "OPP", fy.id, fy.label)
    data = body.model_dump()
    # A restricted Manager who creates a deal without picking an Owner would
    # otherwise immediately lose access to their own new record — default
    # to themselves, same reasoning as customers.py's create_customer.
    if not data.get("owner_id") and await _manager_restricted_to_own(db, perms):
        data["owner_id"] = await get_own_employee_id(db, current_user)
    row = Opportunity(id=str(uuid.uuid4()), opportunity_code=code, financial_year_id=fy.id, created_by=current_user.id, updated_by=current_user.id, **data)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.get("/{opportunity_id}", response_model=OpportunityOut)
async def get_opportunity(
    opportunity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_opportunity_perms),
) -> Opportunity:
    """§6.1's two read-only bypasses both land here — _resolve_opportunity_perms
    (not require_screen) so Accountant/Employee (mode='none') can reach this
    body at all to be considered for one.
    """
    row = await db.get(Opportunity, opportunity_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if perms.visible:
        await _assert_opportunity_owned_if_restricted(db, current_user, perms, row)
        return row
    # §6.1 "Allow Employee to View the Opportunity Behind Their Assigned Project"
    if perms.role_code == "EMPLOYEE" and await _toggle_enabled(db, "Allow Employee to View the Opportunity Behind Their Assigned Project"):
        own_id = await get_own_employee_id(db, current_user)
        if own_id and await _employee_can_view_opportunity(db, own_id, opportunity_id):
            return row
    raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.put("/{opportunity_id}", response_model=OpportunityOut)
async def update_opportunity(
    opportunity_id: str,
    body: OpportunityWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> Opportunity:
    """§3.2/§4: the Lost-reason prompt "appears immediately the moment
    Stage is changed to Lost" — enforced here as a clean 422 before the DB's
    own CHECK would reject it with a less friendly error. §2.2's
    probability-auto-suggestion is a FRONTEND behaviour ("stays manually
    editable after auto-filling") — this endpoint accepts whatever
    probability_pct the caller sends, never overriding it server-side,
    except when Stage reaches Won (mark_opportunity_won always sets 100%,
    matching the one case Path A/B share — see opportunity_engine.py).
    """
    row = await db.get(Opportunity, opportunity_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, row)
    if body.stage == "LOST" and not (body.lost_reason or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required when marking an Opportunity Lost")

    data = body.model_dump()
    became_won = body.stage == "WON" and row.stage != "WON"
    # mark_opportunity_won must run BEFORE the generic field loop below —
    # it no-ops if row.stage is already 'WON', so setting row.stage='WON'
    # first (as the loop would) makes it silently skip the probability
    # auto-fill it's specifically responsible for.
    if became_won:
        await opportunity_engine.mark_opportunity_won(db, row, current_user.id)
    for field, value in data.items():
        if became_won and field in ("stage", "probability_pct"):
            continue  # already set correctly above — don't overwrite
        setattr(row, field, value)
    if body.stage != "LOST":
        row.lost_reason = None
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


# =============================================================== ACTIVITIES
@router.get("/{opportunity_id}/activities", response_model=list[OpportunityActivityOut])
async def list_activities(
    opportunity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[OpportunityActivity]:
    opportunity = await db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, opportunity)
    rows = (
        await db.execute(
            select(OpportunityActivity).where(OpportunityActivity.opportunity_id == opportunity_id)
            .order_by(OpportunityActivity.activity_date.desc(), OpportunityActivity.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


@router.post("/{opportunity_id}/activities", response_model=OpportunityActivityOut, status_code=status.HTTP_201_CREATED)
async def add_activity(
    opportunity_id: str,
    body: OpportunityActivityWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> OpportunityActivity:
    opportunity = await db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, opportunity)
    row = OpportunityActivity(
        id=str(uuid.uuid4()), opportunity_id=opportunity_id, activity_type=body.activity_type,
        activity_date=body.activity_date or date_type.today(), description=body.description,
        related_contact_id=body.related_contact_id, logged_by=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    # §2.1: "stale — no activity in N days" — this is what that filter measures.
    opportunity.last_activity_at = datetime.now(timezone.utc)
    opportunity.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


# ==================================================================== FILES
async def _load_opportunity_file_out(db: AsyncSession, row: OpportunityFile) -> OpportunityFileOut:
    # Same join-in-Python pattern as assets.py's _load_asset_file_out /
    # customers.py's _load_customer_file_out — File Name/Type/Size live on
    # StoredFile, not OpportunityFile itself.
    stored = await db.get(StoredFile, row.stored_file_id)
    return OpportunityFileOut(
        id=row.id, opportunity_id=row.opportunity_id, stored_file_id=row.stored_file_id,
        original_filename=stored.original_filename if stored else "", mime_type=stored.mime_type if stored else "",
        size_bytes=stored.size_bytes if stored else 0, created_by=row.created_by, created_at=row.created_at,
    )


async def _load_opportunity_file_outs(db: AsyncSession, files: list[OpportunityFile]) -> list[OpportunityFileOut]:
    """List counterpart to _load_opportunity_file_out: one `.in_()` query for
    every attachment's StoredFile instead of one db.get each — same
    batch-then-join-in-Python shape as expenses.py's _employee_names/
    _vendor_names, and the same shape assets.py's _load_asset_file_outs and
    customers.py's _load_customer_file_outs use. A row whose StoredFile is
    missing simply isn't in the mapping, which is the same `stored is None`
    the per-row db.get returned — the blank name/type and zero size, never a
    KeyError and never a dropped attachment.
    """
    if not files:
        return []
    stored_rows = (await db.execute(select(StoredFile).where(StoredFile.id.in_({f.stored_file_id for f in files})))).scalars().all()
    stored_by_id = {stored.id: stored for stored in stored_rows}
    outs = []
    for row in files:
        stored = stored_by_id.get(row.stored_file_id)
        outs.append(
            OpportunityFileOut(
                id=row.id, opportunity_id=row.opportunity_id, stored_file_id=row.stored_file_id,
                original_filename=stored.original_filename if stored else "", mime_type=stored.mime_type if stored else "",
                size_bytes=stored.size_bytes if stored else 0, created_by=row.created_by, created_at=row.created_at,
            )
        )
    return outs


@router.get("/{opportunity_id}/files", response_model=list[OpportunityFileOut])
async def list_files(
    opportunity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[OpportunityFileOut]:
    opportunity = await db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, opportunity)
    rows = (await db.execute(select(OpportunityFile).where(OpportunityFile.opportunity_id == opportunity_id))).scalars().all()
    return await _load_opportunity_file_outs(db, list(rows))


@router.post("/{opportunity_id}/files", response_model=OpportunityFileOut, status_code=status.HTTP_201_CREATED)
async def add_file(
    opportunity_id: str,
    stored_file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> OpportunityFileOut:
    opportunity = await db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, opportunity)
    row = OpportunityFile(id=str(uuid.uuid4()), opportunity_id=opportunity_id, stored_file_id=stored_file_id, created_by=current_user.id, updated_by=current_user.id)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_opportunity_file_out(db, row)


@router.delete("/{opportunity_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    opportunity_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> None:
    opportunity = await db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _assert_opportunity_owned_if_restricted(db, current_user, perms, opportunity)
    row = await db.get(OpportunityFile, file_id)
    if row is None or row.opportunity_id != opportunity_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await db.delete(row)
    await db.commit()
