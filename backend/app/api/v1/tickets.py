"""Ticket (04-ticket-module.md) — List (§2.1), New/Edit (§2.2), Detail/
Conversation (§2.3), Assign/Reassign (§2.4), Support Reports (§2.5), plus
Employee module's My Tickets (§2.7) self-service view.
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.customer import Customer
from app.models.platform import User
from app.models.project import Project
from app.models.rbac import FeatureToggle
from app.models.ticket import Ticket, TicketAssignmentHistory, TicketEntry
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.ticket import (
    TicketAssignmentHistoryOut,
    TicketEntryOut,
    TicketEntryWrite,
    TicketOut,
    TicketReassignRequest,
    TicketStatusUpdate,
    TicketWrite,
)
from app.services import email_transport, list_export, org_scope, ticket_engine
from app.services.notify import notify
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["ticket"])
SCREEN = "ticket.list"

_LIST_COLUMNS = [
    ColumnSpec("ticket_number", "Ticket Number"),
    ColumnSpec("subject", "Subject"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("priority", "Priority"),
    ColumnSpec("status", "Status"),
    ColumnSpec("assigned_to", "Assigned To"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _load_ticket_out(db: AsyncSession, ticket: Ticket) -> TicketOut:
    out = TicketOut.model_validate(ticket)
    # created_at (AuditMixin) is the precise instant the ticket was raised —
    # raised_date is a DATE only, so combining it with midnight would
    # overstate every same-day duration by however many hours had already
    # elapsed before the ticket was actually raised.
    fr = ticket_engine.first_response_duration(ticket.created_at, ticket.first_response_at)
    rs = ticket_engine.resolve_duration(ticket.created_at, ticket.resolved_at, ticket.closed_at)
    out.first_response_duration = ticket_engine.format_duration(fr)
    out.resolve_duration = ticket_engine.format_duration(rs)
    return out


async def _get_employee(db: AsyncSession, employee_id: str):
    from app.models.employee import Employee

    return await db.get(Employee, employee_id)


async def _get_employee_user(db: AsyncSession, employee_id: str) -> str | None:
    employee = await _get_employee(db, employee_id)
    return employee.user_id if employee else None


async def _assert_linked_project_matches_customer(db: AsyncSession, customer_id: str, linked_project_id: str | None) -> None:
    """§2.2/A218: Linked Project is a UX safeguard against tying a ticket to
    the wrong company's project — the dropdown is filtered to the selected
    Customer's own projects, so the API rejects any mismatch server-side too.
    """
    if linked_project_id is None:
        return
    project = await db.get(Project, linked_project_id)
    if project is None or project.customer_id != customer_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Linked Project must belong to the selected Customer")


# ==================================================================== LIST
@router.get("/tickets", response_model=None)
async def list_tickets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    customer_id: list[str] | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    priority: list[str] | None = Query(None),
    category_id: list[str] | None = Query(None),
    assigned_to: list[str] | None = Query(None),
    raised_by: str | None = Query(None),
    raised_date_from: date_type | None = Query(None),
    raised_date_to: date_type | None = Query(None),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    resolved_closed_from: date_type | None = Query(None),
    resolved_closed_to: date_type | None = Query(None),
    overdue_only: bool = Query(False),
    unassigned_only: bool = Query(False),
    satisfaction_rating: int | None = Query(None),
    created_by: str | None = Query(None),
    last_modified_by: str | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[TicketOut] | Response:
    stmt = select(Ticket)
    if customer_id:
        stmt = stmt.where(Ticket.customer_id.in_(customer_id))
    if status_filter:
        stmt = stmt.where(Ticket.status.in_(status_filter))
    if priority:
        stmt = stmt.where(Ticket.priority.in_(priority))
    if category_id:
        stmt = stmt.where(Ticket.category_id.in_(category_id))
    if raised_by:
        stmt = stmt.where(Ticket.raised_by == raised_by)
    if raised_date_from:
        stmt = stmt.where(Ticket.raised_date >= raised_date_from)
    if raised_date_to:
        stmt = stmt.where(Ticket.raised_date <= raised_date_to)
    if due_date_from:
        stmt = stmt.where(Ticket.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(Ticket.due_date <= due_date_to)
    if resolved_closed_from:
        stmt = stmt.where(or_(Ticket.resolved_at >= resolved_closed_from, Ticket.closed_at >= resolved_closed_from))
    if resolved_closed_to:
        stmt = stmt.where(or_(Ticket.resolved_at <= resolved_closed_to, Ticket.closed_at <= resolved_closed_to))
    if overdue_only:
        stmt = stmt.where(Ticket.due_date < date_type.today(), Ticket.status.in_(("OPEN", "IN_PROGRESS")))
    if unassigned_only:
        stmt = stmt.where(Ticket.assigned_to.is_(None))
    if satisfaction_rating is not None:
        stmt = stmt.where(Ticket.satisfaction_rating == satisfaction_rating)
    if created_by:
        stmt = stmt.where(Ticket.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(Ticket.updated_by == last_modified_by)
    if search:
        stmt = stmt.outerjoin(Customer, Customer.id == Ticket.customer_id).where(
            or_(
                Ticket.subject.ilike(f"%{search}%"),
                Ticket.ticket_number.ilike(f"%{search}%"),
                Customer.company_name.ilike(f"%{search}%"),
                Customer.display_name.ilike(f"%{search}%"),
            )
        )
    if perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        stmt = stmt.where(Ticket.assigned_to == own_id)
    elif assigned_to:
        stmt = stmt.where(Ticket.assigned_to.in_(assigned_to))
    rows = (await db.execute(stmt.order_by(Ticket.raised_date.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered set on screen. Ticket
        # itself only carries customer_id/assigned_to (no name snapshots —
        # unlike Invoice), so resolve the human-readable Customer/Assigned To
        # names for just the rows being exported, same information the UI
        # already shows next to those IDs, nothing more.
        from app.models.employee import Employee

        customer_ids = {r.customer_id for r in rows}
        assignee_ids = {r.assigned_to for r in rows if r.assigned_to is not None}
        customer_names = {
            c.id: (c.display_name or c.company_name)
            for c in (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all()
        } if customer_ids else {}
        employee_names = {
            e.id: f"{e.first_name} {e.last_name}".strip() if e.last_name else e.first_name
            for e in (await db.execute(select(Employee).where(Employee.id.in_(assignee_ids)))).scalars().all()
        } if assignee_ids else {}
        export_rows = [
            {
                "ticket_number": t.ticket_number,
                "subject": t.subject,
                "customer": customer_names.get(t.customer_id, t.customer_id),
                "priority": t.priority,
                "status": t.status,
                "assigned_to": employee_names.get(t.assigned_to, "Unassigned") if t.assigned_to else "Unassigned",
            }
            for t in rows
        ]
        filters_applied = {
            "customer_id": customer_id, "status": status_filter, "priority": priority, "category_id": category_id,
            "assigned_to": assigned_to, "raised_by": raised_by, "raised_date_from": raised_date_from, "raised_date_to": raised_date_to,
            "due_date_from": due_date_from, "due_date_to": due_date_to, "resolved_closed_from": resolved_closed_from,
            "resolved_closed_to": resolved_closed_to, "overdue_only": overdue_only, "unassigned_only": unassigned_only,
            "satisfaction_rating": satisfaction_rating, "created_by": created_by, "last_modified_by": last_modified_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Tickets", _LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_ticket_out(db, row) for row in rows]


@router.post("/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: TicketWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="create")),
) -> TicketOut:
    await _assert_linked_project_matches_customer(db, body.customer_id, body.linked_project_id)
    fy = await get_current_financial_year(db)
    number = await allocate_number(db, "TKT", fy.id, fy.label)
    row = Ticket(
        id=str(uuid.uuid4()), ticket_number=number, financial_year_id=fy.id, raised_by=current_user.id, raised_date=date_type.today(),
        created_by=current_user.id, updated_by=current_user.id, **body.model_dump(),
    )
    db.add(row)
    if row.assigned_to is not None:
        db.add(TicketAssignmentHistory(id=str(uuid.uuid4()), ticket_id=row.id, previous_assignee_id=None, new_assignee_id=row.assigned_to, changed_by=current_user.id))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    if row.assigned_to is not None:
        assignee = await _get_employee(db, row.assigned_to)
        notify(db, recipient_user_id=assignee.user_id if assignee else None, notification_type="TICKET", actor_user_id=current_user.id,
               title="Ticket assigned to you", body=f"{row.ticket_number}: {row.subject}", source_module="ticket", source_record_id=row.id)
        await db.commit()
        if assignee is not None:
            await email_transport.send_templated_email(
                db, "ticket_assigned", assignee.email, {"first_name": assignee.first_name, "ticket_no": row.ticket_number},
                related_record_type="ticket", related_record_id=row.id,
            )
    return await _load_ticket_out(db, row)


async def _get_ticket_scoped(db: AsyncSession, ticket_id: str, perms: PermissionSet, current_user: User) -> Ticket:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        if ticket.assigned_to != own_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
    return ticket


async def _assert_employee_scoped_write(db: AsyncSession, perms: PermissionSet, current_user: User, ticket: Ticket) -> None:
    """§2.4: "Employee only if [the reassign toggle] is on... and even then
    only for tickets already assigned to them" — an unconditional rule, not
    one that only holds while their `mode` happens to be 'own'. update_ticket
    (PUT, which can silently reassign via its own `assigned_to` field) and
    reassign_ticket both call _get_ticket_scoped first, but that helper only
    restricts when `perms.mode == "own"` — correct for the common case, but
    "Allow Staff to View the Full Open Ticket Queue" (a SEPARATE toggle,
    app/rbac/toggles.py's MODE_TOGGLE_GATES) widens mode to 'full' on its own.
    With both toggles on together, `_get_ticket_scoped` alone would wave an
    Employee's write through for ANY ticket, not just their own — this is the
    backstop that keeps the write side restricted regardless of what the view
    side's mode has been widened to. Manager/Super Admin are never affected:
    they hold 'create'/'reassign' as a static, unconditional grant, never
    through this toggle path, so role_code never matches "EMPLOYEE" for them.
    Same 404-not-403 reasoning as _get_ticket_scoped: don't leak that a ticket
    outside this scope exists.
    """
    if perms.role_code != "EMPLOYEE":
        return
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if ticket.assigned_to != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
async def get_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> TicketOut:
    ticket = await _get_ticket_scoped(db, ticket_id, perms, current_user)
    return await _load_ticket_out(db, ticket)


@router.put("/tickets/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    body: TicketWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="create")),
) -> TicketOut:
    # Same scope re-check as every other single-ticket endpoint in this
    # file — 'create' is granted to SUPER_ADMIN/MANAGER by default (both
    # 'full', so this is a no-op today), but the "Allow Staff to Create New
    # Tickets" toggle (§6.2) can grant it to an 'own'-scoped Employee without
    # widening their scope, and this endpoint must not become a way to edit
    # or silently reassign a ticket outside that scope when that happens —
    # see _assert_employee_scoped_write for the case _get_ticket_scoped alone
    # doesn't cover (the queue-view toggle widening mode to 'full' too).
    ticket = await _get_ticket_scoped(db, ticket_id, perms, current_user)
    await _assert_employee_scoped_write(db, perms, current_user, ticket)
    await _assert_linked_project_matches_customer(db, body.customer_id, body.linked_project_id)
    data = body.model_dump()
    # Reassignment through the edit form goes through the same tracked path
    # as the dedicated Reassign action (§2.2: "setting it here has the same
    # effect as using Assign at creation time").
    new_assignee = data.get("assigned_to")
    if new_assignee != ticket.assigned_to:
        db.add(TicketAssignmentHistory(id=str(uuid.uuid4()), ticket_id=ticket.id, previous_assignee_id=ticket.assigned_to, new_assignee_id=new_assignee, changed_by=current_user.id))
    for field, value in data.items():
        setattr(ticket, field, value)
    ticket.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(ticket)
    return await _load_ticket_out(db, ticket)


# ================================================================ CONVERSATION
@router.get("/tickets/{ticket_id}/entries", response_model=list[TicketEntryOut])
async def list_entries(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[TicketEntry]:
    await _get_ticket_scoped(db, ticket_id, perms, current_user)
    return list((await db.execute(select(TicketEntry).where(TicketEntry.ticket_id == ticket_id).order_by(TicketEntry.created_at))).scalars().all())


@router.post("/tickets/{ticket_id}/entries", response_model=TicketEntryOut, status_code=status.HTTP_201_CREATED)
async def add_entry(
    ticket_id: str,
    body: TicketEntryWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> TicketEntry:
    ticket = await _get_ticket_scoped(db, ticket_id, perms, current_user)
    row = TicketEntry(id=str(uuid.uuid4()), ticket_id=ticket_id, author_id=current_user.id, **body.model_dump())
    db.add(row)
    # §2.3/Appendix B: the first Public Reply on a still-Open ticket
    # auto-captures First-Response Time and moves Open -> In Progress, in
    # the same instant. An Internal Note never counts.
    if body.entry_type == "PUBLIC_REPLY" and ticket.first_response_at is None:
        ticket.first_response_at = datetime.now(timezone.utc)
        if ticket.status == "OPEN":
            ticket.status = "IN_PROGRESS"
        ticket.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.put("/tickets/{ticket_id}/status", response_model=TicketOut)
async def update_status(
    ticket_id: str,
    body: TicketStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> TicketOut:
    ticket = await _get_ticket_scoped(db, ticket_id, perms, current_user)
    # §2.7 (Employee module) / Appendix B: an employee can move a ticket
    # between Open, In Progress and Resolved — but moving to CLOSED is
    # reserved for whoever confirms resolution, never the assignee alone.
    if body.status == "CLOSED" and not perms.can("close"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only Manager or Super Admin can close a ticket")
    if body.status == "CLOSED" and body.satisfaction_rating is None:
        # §2.3/§6.2 "Require Satisfaction Rating on Close" — OFF by default
        # (the rating is optional, §2.3's own "skipping is allowed"), but
        # the doc's own "Deferred / not implemented" note flagged this as
        # never enforced even when the toggle is flipped on. Closed now.
        require_rating = (
            await db.execute(
                select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == "Require Satisfaction Rating on Close")
            )
        ).scalar_one_or_none()
        if require_rating:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A Satisfaction Rating is required to close this ticket")
    ticket.status = body.status
    now = datetime.now(timezone.utc)
    if body.status == "RESOLVED" and ticket.resolved_at is None:
        ticket.resolved_at = now
    if body.status == "CLOSED":
        ticket.closed_at = now
        if body.satisfaction_rating is not None:
            ticket.satisfaction_rating = body.satisfaction_rating
    ticket.updated_by = current_user.id
    await db.commit()
    await db.refresh(ticket)
    return await _load_ticket_out(db, ticket)


# =========================================================== ASSIGN/REASSIGN
@router.post("/tickets/{ticket_id}/reassign", response_model=TicketOut)
async def reassign_ticket(
    ticket_id: str,
    body: TicketReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="reassign")),
) -> TicketOut:
    ticket = await _get_ticket_scoped(db, ticket_id, perms, current_user)
    # §2.4: "even then only for tickets already assigned to them" — a rule
    # that holds regardless of the SEPARATE queue-view toggle; see
    # _assert_employee_scoped_write's own docstring for why
    # _get_ticket_scoped's mode=='own' check alone isn't sufficient once that
    # toggle is also on.
    await _assert_employee_scoped_write(db, perms, current_user, ticket)
    previous = ticket.assigned_to
    if previous == body.new_assignee_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Ticket is already assigned to this person")
    ticket.assigned_to = body.new_assignee_id
    ticket.updated_by = current_user.id
    db.add(TicketAssignmentHistory(
        id=str(uuid.uuid4()), ticket_id=ticket.id, previous_assignee_id=previous, new_assignee_id=body.new_assignee_id,
        changed_by=current_user.id, note=body.note,
    ))
    await db.commit()
    await db.refresh(ticket)

    new_assignee = await _get_employee(db, body.new_assignee_id)
    notify(db, recipient_user_id=new_assignee.user_id if new_assignee else None, notification_type="TICKET", actor_user_id=current_user.id,
           title="Ticket assigned to you", body=f"{ticket.ticket_number}: {ticket.subject}", source_module="ticket", source_record_id=ticket.id)
    if previous is not None:
        prev_recipient = await _get_employee_user(db, previous)
        notify(db, recipient_user_id=prev_recipient, notification_type="TICKET", actor_user_id=current_user.id,
               title="Ticket reassigned", body=f"{ticket.ticket_number} has been reassigned to someone else.", source_module="ticket", source_record_id=ticket.id)
    await db.commit()
    if new_assignee is not None:
        # Only the "assigned to you" notification triggers ticket_assigned —
        # the previous assignee's "reassigned away" notify() above stays
        # in-app only, on purpose (that's not an assignment TO them).
        await email_transport.send_templated_email(
            db, "ticket_assigned", new_assignee.email, {"first_name": new_assignee.first_name, "ticket_no": ticket.ticket_number},
            related_record_type="ticket", related_record_id=ticket.id,
        )
    return await _load_ticket_out(db, ticket)


@router.get("/tickets/{ticket_id}/assignment-history", response_model=list[TicketAssignmentHistoryOut])
async def assignment_history(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[TicketAssignmentHistory]:
    await _get_ticket_scoped(db, ticket_id, perms, current_user)
    return list((await db.execute(select(TicketAssignmentHistory).where(TicketAssignmentHistory.ticket_id == ticket_id).order_by(TicketAssignmentHistory.changed_at))).scalars().all())


# ================================================================== REPORTS
# No `format=` export here: unlike the /tickets list above, this endpoint's
# shape is a pure aggregate dict (counts-by-status, counts-by-priority, a
# top-10 customers ranking, two averaged durations) — not a flat row list —
# so there is no "filtered rows" table for list_export.build_export() to
# hand to render_table_pdf/render_excel. Same situation as Opportunity's
# stage-summary; both are skipped from export for the same reason.
@router.get("/tickets/reports/summary")
async def support_reports(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen("ticket.reports")),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    category_id: str | None = Query(None),
    assigned_to: str | None = Query(None),
    customer_id: str | None = Query(None),
    priority: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
) -> dict:
    stmt = select(Ticket)
    if date_from:
        stmt = stmt.where(Ticket.raised_date >= date_from)
    if date_to:
        stmt = stmt.where(Ticket.raised_date <= date_to)
    if category_id:
        stmt = stmt.where(Ticket.category_id == category_id)
    if assigned_to:
        stmt = stmt.where(Ticket.assigned_to == assigned_to)
    if customer_id:
        stmt = stmt.where(Ticket.customer_id == customer_id)
    if priority:
        stmt = stmt.where(Ticket.priority == priority)
    if status_filter:
        stmt = stmt.where(Ticket.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()

    by_status = {s: sum(1 for r in rows if r.status == s) for s in ("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED")}
    # QUEUED / NOT FIXED — §6 "nothing hardcoded": this tuple is Ticket
    # Priority's whole value set, and it is not just a report-endpoint
    # literal — the same four values are baked in three places today:
    #   - DB CHECK ck_tickets_priority (alembic/versions/0006_operations.py:495)
    #   - Ticket.priority (app/models/ticket.py) — plain String(10), no FK
    #   - TicketWrite._validate_priority (app/schemas/ticket.py:25-30)
    # Priority is a pure classification (filter/badge/report only, unlike
    # `status` above, whose values gate real engine behaviour — resolved_at/
    # closed_at only get stamped on the RESOLVED/CLOSED transitions), so it
    # belongs in a Masters lookup the same way Customer Status/Source already
    # are, exactly like this audit's Masters recommendation. Fixing just this
    # line to read from a live table would still leave the CHECK constraint
    # and the Pydantic validator hardcoded underneath it (and this line would
    # get a KeyError the moment a 5th value like CRITICAL existed anywhere
    # else), so a real fix needs, in order: a "Ticket Priorities" Masters
    # table + migration, `priority_id` FK replacing the CHECK constraint,
    # `_validate_priority` reading the live set instead of a literal tuple,
    # and only then this dict built from that same live set. None of that
    # exists yet, so this stays a literal until it does.
    by_priority = {p: sum(1 for r in rows if r.priority == p) for p in ("LOW", "MEDIUM", "HIGH", "URGENT")}
    by_customer: dict[str, int] = {}
    for r in rows:
        by_customer[r.customer_id] = by_customer.get(r.customer_id, 0) + 1
    top_customers = sorted(by_customer.items(), key=lambda kv: kv[1], reverse=True)[:10]

    resolve_durations = [
        d for d in (ticket_engine.resolve_duration(r.created_at, r.resolved_at, r.closed_at) for r in rows) if d is not None
    ]
    response_durations = [
        d for d in (ticket_engine.first_response_duration(r.created_at, r.first_response_at) for r in rows) if d is not None
    ]
    avg_resolve = sum(resolve_durations, timedelta()) / len(resolve_durations) if resolve_durations else None
    avg_response = sum(response_durations, timedelta()) / len(response_durations) if response_durations else None

    return {
        "by_status": by_status,
        "by_priority": by_priority,
        "top_customers": [{"customer_id": cid, "ticket_count": count} for cid, count in top_customers],
        "average_resolve_time": ticket_engine.format_duration(avg_resolve),
        "average_first_response_time": ticket_engine.format_duration(avg_response),
    }


# ============================================================= MY TICKETS
@router.get("/employees/me/tickets", response_model=list[TicketOut])
async def my_tickets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_tickets")),
    status_filter: list[str] | None = Query(None, alias="status"),
    priority: list[str] | None = Query(None),
    category_id: str | None = Query(None),
    raised_by: str | None = Query(None),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    overdue_only: bool = Query(False),
) -> list[TicketOut]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    stmt = select(Ticket).where(Ticket.assigned_to == own_id)
    if status_filter:
        stmt = stmt.where(Ticket.status.in_(status_filter))
    if priority:
        stmt = stmt.where(Ticket.priority.in_(priority))
    if category_id:
        stmt = stmt.where(Ticket.category_id == category_id)
    if raised_by:
        stmt = stmt.where(Ticket.raised_by == raised_by)
    if due_date_from:
        stmt = stmt.where(Ticket.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(Ticket.due_date <= due_date_to)
    if overdue_only:
        stmt = stmt.where(Ticket.due_date < date_type.today(), Ticket.status.in_(("OPEN", "IN_PROGRESS")))
    rows = (await db.execute(stmt.order_by(Ticket.raised_date.desc()))).scalars().all()
    return [await _load_ticket_out(db, row) for row in rows]
