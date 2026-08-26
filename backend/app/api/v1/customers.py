"""Customer (08-customer-module.md) — Customer Directory (§2.1) and
Customer 360 (§2.3): Overview (the master record itself), Contacts,
Activities, Files. Pulled forward from Phase 5 — see alembic/versions/
0005_finance.py's docstring for why. Opportunities/Projects/Tickets tabs are
NOT built here — those modules don't exist yet (Phase 5); a forward
dependency, same pattern as Invoice Dashboard's cross-module widgets.

Also hosts `GET /customers/picker` — the narrow, read-only customer lookup
§6 grants Accountant for Invoice creation ONLY, never full Directory/360
access. Gated on `invoice.list` visibility, not `customer.directory` — it's
conceptually part of Invoice, not a Customer module grant.
"""

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.customer import Customer, CustomerActivity, CustomerContact, CustomerFile
from app.models.masters import CustomerStatus
from app.models.opportunity import Opportunity, OpportunityActivity
from app.models.platform import StoredFile, User
from app.models.project import Project, ProjectMember
from app.models.rbac import FeatureToggle, Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet, resolve_permission
from app.schemas.customer import (
    CustomerActivityOut,
    CustomerActivityWrite,
    CustomerContactOut,
    CustomerContactWrite,
    CustomerFileOut,
    CustomerOut,
    CustomerWrite,
)
from app.services import list_export
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.org_scope import get_own_employee_id
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["customer"])
SCREEN = "customer.directory"
_LIST_COLUMNS = [
    ColumnSpec("customer_code", "Customer Code"),
    ColumnSpec("company_name", "Company Name"),
    ColumnSpec("gstin", "GSTIN"),
    ColumnSpec("status", "Status"),
]
_ACTIVITY_COLUMNS = [
    ColumnSpec("activity_type", "Type"),
    ColumnSpec("activity_date", "Date"),
    ColumnSpec("description", "Description"),
]
_CONTACT_COLUMNS = [
    ColumnSpec("name", "Name"),
    ColumnSpec("designation", "Designation"),
    ColumnSpec("email", "Email"),
    ColumnSpec("phone", "Phone"),
]
_FILE_COLUMNS = [
    ColumnSpec("original_filename", "File Name"),
    ColumnSpec("mime_type", "Type"),
    ColumnSpec("created_at", "Uploaded On"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _manager_restricted_to_own(db: AsyncSession, perms: PermissionSet) -> bool:
    # §6.1 "Restrict Manager to Only Their Own Customers" — the opposite
    # shape from every other toggle in this codebase (OFF = Manager's
    # seeded 'full' mode stands; ON = NARROWS it to Owner-only). toggles.py's
    # own ModeGate is explicitly documented as "never used to narrow" — this
    # can't be expressed as a resolver-level gate, so it's a direct toggle
    # read + an explicit WHERE/ownership check here instead, same class of
    # "mode alone isn't enough, re-check the specific row" pattern
    # leave_balance.py's adjust_leave_balance and tickets.py's
    # _assert_employee_scoped_write already use for their own toggle pairs.
    return perms.role_code == "MANAGER" and await _toggle_enabled(db, "Restrict Manager to Only Their Own Customers")


async def _resolve_customer_perms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_preview_role: str | None = Header(None),
) -> PermissionSet:
    """Same resolution `require_screen(SCREEN)` does (preview-role header
    included), but never raises on an invisible screen — add_activity below
    needs the resolved PermissionSet even for Employee (mode='none', not
    visible at all) to decide whether §6.1's staffing-based bypass applies.
    `require_screen` itself 404s before the route body ever runs, which
    would make that bypass unreachable.
    """
    preview_role_id: str | None = None
    if x_preview_role:
        real_role = await db.get(Role, current_user.role_id)
        if real_role and real_role.code == "SUPER_ADMIN":
            preview_role_row = (await db.execute(select(Role).where(Role.code == x_preview_role))).scalar_one_or_none()
            if preview_role_row:
                preview_role_id = preview_role_row.id
    return await resolve_permission(db, current_user, SCREEN, preview_role_id=preview_role_id)


async def _employee_staffed_on_customer(db: AsyncSession, employee_id: str, customer_id: str) -> bool:
    """§6.1 "Allow Employee to Log Activities on Customers They're Staffed
    On" — staffed means what project_scope.py's is_project_team_member
    already means: the Project's Lead, or on its ProjectMember roster,
    for any Project belonging to this customer.
    """
    member_project_ids = select(ProjectMember.project_id).where(ProjectMember.employee_id == employee_id)
    hit = (
        await db.execute(
            select(Project.id).where(Project.customer_id == customer_id, (Project.project_lead_id == employee_id) | (Project.id.in_(member_project_ids)))
        )
    ).first()
    return hit is not None


async def _get_customer_scoped(db: AsyncSession, current_user: User, perms: PermissionSet, customer_id: str) -> Customer:
    """Every nested Customer 360 endpoint (Contacts/Activities/Files, plus
    the single-record Directory routes) resolves the parent Customer through
    this — never a bare `db.get(Customer, ...)` — so the Manager-scope
    toggle applies uniformly to reads and writes, not just the Directory
    LIST query. Same reasoning as org_scope.assert_employee_in_scope's own
    docstring: a scoped list doesn't stop a direct id-based reach into a
    row outside that scope.
    """
    row = await db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
    if await _manager_restricted_to_own(db, perms):
        own_id = await get_own_employee_id(db, current_user)
        if row.owner_id != own_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return row


# Every endpoint that calls _masked_customer (or otherwise builds a masked
# dict by hand) MUST declare response_model=None on its route — an undeclared
# response_model is inferred by FastAPI from the return type annotation, so a
# bare `-> CustomerOut`/`response_model=CustomerOut` would force the masked
# dict back through CustomerOut's own validation on the way OUT: a "hide"-
# mode field that was popped from the dict either resurrects as null (fields
# with a `= None` default) or 500s with "field required" (fields without
# one, e.g. total_invoiced/received/outstanding/customer_code/status_id —
# none of them default), and a "mask"-mode field (a dict placeholder) always
# 500s against a non-dict-typed field like gstin: str | None. Same class of
# bug as the sharp edge on the way IN, just at the opposite end.
def _masked_customer(row: Customer, perms: PermissionSet) -> dict:
    return apply_field_masking(CustomerOut.model_validate(row).model_dump(), perms)


# ============================================================== DIRECTORY
@router.get("/customers", response_model=None)
async def list_customers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    status_id: list[str] | None = Query(None),
    source_id: str | None = Query(None),
    owner_id: str | None = Query(None),
    outstanding_min: Decimal | None = Query(None),
    outstanding_max: Decimal | None = Query(None),
    has_open_opportunities: bool | None = Query(None),
    created_from: date | None = Query(None),
    created_to: date | None = Query(None),
    last_activity_from: date | None = Query(None),
    last_activity_to: date | None = Query(None),
    created_by: str | None = Query(None, description="Super Admin only"),
    updated_by: str | None = Query(None, description="Super Admin only — 'Last Modified By'"),
    search: str | None = Query(None, description="Matches Company Name, Display Name, GSTIN, Mobile, Email"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    stmt = select(Customer)
    if await _manager_restricted_to_own(db, perms):
        own_id = await get_own_employee_id(db, current_user)
        stmt = stmt.where(Customer.owner_id == own_id)
    if status_id:
        stmt = stmt.where(Customer.status_id.in_(status_id))
    if source_id:
        stmt = stmt.where(Customer.source_id == source_id)
    if owner_id:
        stmt = stmt.where(Customer.owner_id == owner_id)
    if outstanding_min is not None:
        stmt = stmt.where(Customer.outstanding >= outstanding_min)
    if outstanding_max is not None:
        stmt = stmt.where(Customer.outstanding <= outstanding_max)
    if has_open_opportunities is not None:
        # Same "open" definition opportunities.py's own overdue_only filter
        # uses: neither WON nor LOST.
        open_customer_ids = select(Opportunity.customer_id).where(Opportunity.stage.notin_(("WON", "LOST"))).distinct()
        stmt = stmt.where(Customer.id.in_(open_customer_ids)) if has_open_opportunities else stmt.where(Customer.id.notin_(open_customer_ids))
    if created_from:
        stmt = stmt.where(Customer.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Customer.created_at < created_to + timedelta(days=1))
    if last_activity_from:
        stmt = stmt.where(Customer.last_activity_date >= last_activity_from)
    if last_activity_to:
        stmt = stmt.where(Customer.last_activity_date <= last_activity_to)
    # Super Admin only (§2.1) — not enforced here (the filter is simply
    # absent from a non-Super-Admin's own UI, same convention as every other
    # module's Created By/Last Modified By pair) but harmless if called
    # directly, same as this codebase's other superAdminOnly filters.
    if created_by:
        stmt = stmt.where(Customer.created_by == created_by)
    if updated_by:
        stmt = stmt.where(Customer.updated_by == updated_by)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            Customer.company_name.ilike(pattern) | Customer.display_name.ilike(pattern)
            | Customer.gstin.ilike(pattern) | Customer.mobile_number.ilike(pattern) | Customer.email.ilike(pattern)
        )
    rows = (await db.execute(stmt.order_by(Customer.company_name))).scalars().all()
    masked_rows = [_masked_customer(row, perms) for row in rows]

    if format:
        # Status is stored as status_id (a dynamic Masters list, per RBAC
        # §2.2/masters convention — never a hardcoded name); resolve it to
        # the human-readable name for the export column same as the screen
        # would show, one lookup query rather than N+1 per row.
        status_names = {s.id: s.name for s in (await db.execute(select(CustomerStatus))).scalars().all()}
        export_rows = [
            {
                "customer_code": c.get("customer_code"), "company_name": c.get("company_name"), "gstin": c.get("gstin"),
                "status": status_names.get(c.get("status_id"), c.get("status_id")),
            }
            for c in masked_rows
        ]
        filters_applied = {
            "status_id": status_id, "source_id": source_id, "owner_id": owner_id,
            "outstanding_min": outstanding_min, "outstanding_max": outstanding_max, "has_open_opportunities": has_open_opportunities,
            "created_from": created_from, "created_to": created_to, "last_activity_from": last_activity_from, "last_activity_to": last_activity_to,
            "created_by": created_by, "updated_by": updated_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Customers", _LIST_COLUMNS, export_rows, filters_applied)

    return masked_rows


@router.get("/customers/picker")
async def customer_picker(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("invoice.list")),
    search: str | None = Query(None),
) -> list[dict]:
    """§6: Accountant's narrow, read-only customer lookup for Invoice
    creation only — name and billing details, never the full record.
    """
    stmt = select(Customer)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(Customer.company_name.ilike(pattern) | Customer.gstin.ilike(pattern))
    rows = (await db.execute(stmt.order_by(Customer.company_name))).scalars().all()
    return [
        {"id": c.id, "company_name": c.company_name, "display_name": c.display_name, "address": c.address, "gstin": c.gstin}
        for c in rows
    ]


@router.get("/customers/{customer_id}/financial-summary", response_model=None)
async def customer_financial_summary(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("invoice.list", action="view_financial_summary")),
) -> dict:
    """§6.1 "Give Accountant Read Access to Customer Financial Summary" — OFF
    by default. Deliberately narrower than full Customer 360 (§6: "without
    full Customer 360 access") — company name plus the three rollup figures
    only, nothing else off the record. Gated the same way the picker above
    is (invoice.list, not customer.directory — Accountant never gets that
    screen at all), but through an action (view_financial_summary) rather
    than bare screen visibility, since this one really is toggle-gated
    on/off rather than always-on like the picker.
    """
    row = await db.get(Customer, customer_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return {"id": row.id, "company_name": row.company_name, "total_invoiced": row.total_invoiced, "received": row.received, "outstanding": row.outstanding}


@router.post("/customers", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    fy = await get_current_financial_year(db)
    code = await allocate_number(db, "CUST", fy.id, fy.label)
    data = body.model_dump()
    if not data.get("display_name"):
        data["display_name"] = data["company_name"]  # §2.2: "defaults to Company Name if left blank"
    # A restricted Manager who creates a customer without picking an Owner
    # would otherwise immediately lose access to their own new record (the
    # scope check below is a strict owner_id match) — default to themselves.
    if not data.get("owner_id") and await _manager_restricted_to_own(db, perms):
        data["owner_id"] = await get_own_employee_id(db, current_user)
    row = Customer(id=str(uuid.uuid4()), customer_code=code, financial_year_id=fy.id, created_by=current_user.id, updated_by=current_user.id, **data)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _masked_customer(row, perms)


@router.get("/customers/{customer_id}", response_model=None)
async def get_customer(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> dict:
    row = await _get_customer_scoped(db, current_user, perms, customer_id)
    return _masked_customer(row, perms)


@router.put("/customers/{customer_id}", response_model=None)
async def update_customer(
    customer_id: str,
    body: CustomerWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await _get_customer_scoped(db, current_user, perms, customer_id)
    data = body.model_dump()
    if not data.get("display_name"):
        data["display_name"] = data["company_name"]  # §2.2: "defaults to Company Name if left blank"
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return _masked_customer(row, perms)


# ================================================================ CONTACTS
@router.get("/customers/{customer_id}/contacts", response_model=None)
async def list_contacts(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    is_primary: bool | None = Query(None, description="§5's deferred 'Contacts primary/non-primary filter'"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    # Previously returned CustomerContact rows straight through, unmasked —
    # this screen's own perms (already injected above) were never applied.
    await _get_customer_scoped(db, current_user, perms, customer_id)
    stmt = select(CustomerContact).where(CustomerContact.customer_id == customer_id)
    if is_primary is not None:
        stmt = stmt.where(CustomerContact.is_primary == is_primary)
    rows = (await db.execute(stmt)).scalars().all()
    masked_rows = [apply_field_masking(CustomerContactOut.model_validate(r).model_dump(), perms) for r in rows]

    if format:
        export_rows = [
            {"name": c.get("name"), "designation": c.get("designation"), "email": c.get("email"), "phone": c.get("phone")}
            for c in masked_rows
        ]
        filters_applied = {"is_primary": is_primary}
        return await list_export.build_export(format, db, current_user, "Customer Contacts", _CONTACT_COLUMNS, export_rows, filters_applied)

    return masked_rows


@router.post("/customers/{customer_id}/contacts", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_contact(
    customer_id: str,
    body: CustomerContactWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    if body.is_primary:
        await _unmark_previous_primary(db, customer_id, current_user.id)
    row = CustomerContact(id=str(uuid.uuid4()), customer_id=customer_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Only one contact per customer may be marked Primary") from exc
    await db.refresh(row)
    return apply_field_masking(CustomerContactOut.model_validate(row).model_dump(), perms)


async def _unmark_previous_primary(db: AsyncSession, customer_id: str, actor_user_id: str, *, except_contact_id: str | None = None) -> None:
    """§2.3: "Only one contact per customer can be Primary; marking a new
    one automatically un-marks the previous." Same unset-then-set order as
    every other one-Primary guard in this codebase (Company Address, Bank
    Account default) — the DB's own generated-column UNIQUE guard is
    checked per-statement, not deferred, so the old row must be cleared
    first or the new INSERT/UPDATE collides with it.
    """
    stmt = select(CustomerContact).where(CustomerContact.customer_id == customer_id, CustomerContact.is_primary.is_(True))
    if except_contact_id is not None:
        stmt = stmt.where(CustomerContact.id != except_contact_id)
    current_primary = (await db.execute(stmt)).scalar_one_or_none()
    if current_primary is not None:
        current_primary.is_primary = False
        current_primary.updated_by = actor_user_id
        await db.flush()


@router.put("/customers/{customer_id}/contacts/{contact_id}", response_model=None)
async def update_contact(
    customer_id: str,
    contact_id: str,
    body: CustomerContactWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    row = await db.get(CustomerContact, contact_id)
    if row is None or row.customer_id != customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.is_primary and not row.is_primary:
        await _unmark_previous_primary(db, customer_id, current_user.id, except_contact_id=contact_id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Only one contact per customer may be marked Primary") from exc
    await db.refresh(row)
    return apply_field_masking(CustomerContactOut.model_validate(row).model_dump(), perms)


@router.delete("/customers/{customer_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    customer_id: str,
    contact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> None:
    # §2.3, verbatim: "Deleting the current Primary contact leaves the
    # customer with none until another is marked — no automatic promotion."
    await _get_customer_scoped(db, current_user, perms, customer_id)
    row = await db.get(CustomerContact, contact_id)
    if row is None or row.customer_id != customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Both CustomerActivity.related_contact_id and
    # OpportunityActivity.related_contact_id hold this row under ON DELETE
    # RESTRICT, and activities are append-only (see add_activity's own rollup
    # comment) — so a contact someone has already logged a call/meeting
    # against can no longer be deleted without destroying the record of who
    # that activity was with. Same shape as vendors.py's delete_vendor
    # usage-history guard: an app-level check that produces an actionable
    # 409 rather than letting the FK rejection escape as a 500, with the
    # DBAPIError catch below as the second line of defence for any reference
    # this check doesn't know about.
    for referencing in (CustomerActivity, OpportunityActivity):
        hit = (await db.execute(select(referencing.id).where(referencing.related_contact_id == contact_id).limit(1))).first()
        if hit is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="This contact is linked to logged activities — it can no longer be deleted",
            )
    try:
        await db.delete(row)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This contact is referenced by other records — it can no longer be deleted") from exc


# =============================================================== ACTIVITIES
@router.get("/customers/{customer_id}/activities", response_model=None)
async def list_activities(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    activity_type: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    logged_by: str | None = Query(None, description="§5's deferred 'Activities owner filter'"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    stmt = select(CustomerActivity).where(CustomerActivity.customer_id == customer_id)
    if activity_type:
        stmt = stmt.where(CustomerActivity.activity_type == activity_type)
    if date_from:
        stmt = stmt.where(CustomerActivity.activity_date >= date_from)
    if date_to:
        stmt = stmt.where(CustomerActivity.activity_date <= date_to)
    if logged_by:
        stmt = stmt.where(CustomerActivity.logged_by == logged_by)
    rows = (await db.execute(stmt.order_by(CustomerActivity.activity_date.desc(), CustomerActivity.created_at.desc()))).scalars().all()
    masked_rows = [apply_field_masking(CustomerActivityOut.model_validate(r).model_dump(), perms) for r in rows]

    if format:
        export_rows = [
            {"activity_type": a.get("activity_type"), "activity_date": a.get("activity_date"), "description": a.get("description")}
            for a in masked_rows
        ]
        filters_applied = {"activity_type": activity_type, "date_from": date_from, "date_to": date_to, "logged_by": logged_by}
        return await list_export.build_export(format, db, current_user, "Customer Activities", _ACTIVITY_COLUMNS, export_rows, filters_applied)

    return masked_rows


@router.post("/customers/{customer_id}/activities", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_activity(
    customer_id: str,
    body: CustomerActivityWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_customer_perms),
) -> dict:
    # Normal path: Manager/Super Admin, same as every other write on this
    # screen. §6.1 "Allow Employee to Log Activities on Customers They're
    # Staffed On" is the one narrow exception — OFF by default, Employee has
    # zero customer.directory access (perms.visible is False, so the normal
    # path never applies to them) — hence _resolve_customer_perms instead of
    # require_screen(..., action="edit") as the dependency: that helper
    # 404s before this body ever runs, which would make the bypass
    # unreachable. A staffed Employee using the bypass skips
    # _get_customer_scoped's own Manager-restriction check entirely — that
    # check is Manager-specific and orthogonal to this one.
    if perms.visible and perms.can("edit"):
        customer = await _get_customer_scoped(db, current_user, perms, customer_id)
    elif perms.role_code == "EMPLOYEE" and await _toggle_enabled(db, "Allow Employee to Log Activities on Customers They're Staffed On"):
        customer = await db.get(Customer, customer_id)
        if customer is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Customer not found")
        own_id = await get_own_employee_id(db, current_user)
        if own_id is None or not await _employee_staffed_on_customer(db, own_id, customer_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
    else:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
    activity_date = body.activity_date or date.today()
    row = CustomerActivity(
        id=str(uuid.uuid4()), customer_id=customer_id, activity_type=body.activity_type,
        activity_date=activity_date, description=body.description,
        related_contact_id=body.related_contact_id, logged_by=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    # §2.1's "Last Activity date range" rollup — max(), not overwrite, so a
    # backdated activity added after a more recent one can't move this
    # backwards (activities are append-only, so this can't be corrected by
    # editing/deleting the backdated entry afterward).
    if customer.last_activity_date is None or activity_date > customer.last_activity_date:
        customer.last_activity_date = activity_date
        customer.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return apply_field_masking(CustomerActivityOut.model_validate(row).model_dump(), perms)


# ==================================================================== FILES
async def _load_customer_file_out(db: AsyncSession, row: CustomerFile) -> CustomerFileOut:
    # Same join-in-Python pattern as assets.py's _load_asset_file_out —
    # File Name/Type/Size live on StoredFile, not CustomerFile itself.
    stored = await db.get(StoredFile, row.stored_file_id)
    return CustomerFileOut(
        id=row.id, customer_id=row.customer_id, stored_file_id=row.stored_file_id,
        original_filename=stored.original_filename if stored else "", mime_type=stored.mime_type if stored else "",
        size_bytes=stored.size_bytes if stored else 0, created_by=row.created_by, created_at=row.created_at,
    )


@router.get("/customers/{customer_id}/files", response_model=None)
async def list_files(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    mime_type: str | None = Query(None, description="§5's deferred 'Files type filter'"),
    date_from: date | None = Query(None, description="§5's deferred 'Files upload-date filter'"),
    date_to: date | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    rows = (await db.execute(select(CustomerFile).where(CustomerFile.customer_id == customer_id))).scalars().all()
    outs = [await _load_customer_file_out(db, r) for r in rows]
    if mime_type:
        outs = [o for o in outs if o.mime_type == mime_type]
    if date_from:
        outs = [o for o in outs if o.created_at.date() >= date_from]
    if date_to:
        outs = [o for o in outs if o.created_at.date() <= date_to]
    masked_rows = [apply_field_masking(o.model_dump(), perms) for o in outs]

    if format:
        export_rows = [
            {"original_filename": f.get("original_filename"), "mime_type": f.get("mime_type"), "created_at": f.get("created_at")}
            for f in masked_rows
        ]
        filters_applied = {"mime_type": mime_type, "date_from": date_from, "date_to": date_to}
        return await list_export.build_export(format, db, current_user, "Customer Files", _FILE_COLUMNS, export_rows, filters_applied)

    return masked_rows


@router.post("/customers/{customer_id}/files", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_file(
    customer_id: str,
    stored_file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    row = CustomerFile(id=str(uuid.uuid4()), customer_id=customer_id, stored_file_id=stored_file_id, created_by=current_user.id, updated_by=current_user.id)
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return apply_field_masking((await _load_customer_file_out(db, row)).model_dump(), perms)


@router.delete("/customers/{customer_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    customer_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> None:
    await _get_customer_scoped(db, current_user, perms, customer_id)
    row = await db.get(CustomerFile, file_id)
    if row is None or row.customer_id != customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await db.delete(row)
    await db.commit()
