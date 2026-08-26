"""Project (10-project-module.md) — Directory (§2.1), Add/Edit (§2.2), Task
Board + Task Detail (§2.3/2.4), Sprints (§2.5), Bugs (§2.6), Project Report
(§2.7), Milestones & Timesheets (§2.8). The biggest single module in this
phase — one file, matching how expenses.py bundled its own module's
sub-screens rather than splitting by screen.

Employee-role scoping ('own' mode) means "team member of THIS project," an
app/services/project_scope.py concept, not org_scope.py's reporting
hierarchy — every list endpoint filters by it, every single-record endpoint
re-checks it explicitly (the exact "list scoped, single-record forgotten"
gap the Phase 2 audit found and fixed once already; not repeating it here).
"""

import logging
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.project import Bug, BugComment, Milestone, MilestoneTask, Project, ProjectMember, Sprint, Task, TaskComment, TaskSubtask, TimesheetEntry
from app.models.platform import User
from app.models.rbac import FeatureToggle, Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet, resolve_permission
from app.schemas.project import (
    BugCommentOut,
    BugCommentWrite,
    BugOut,
    BugWrite,
    MilestoneOut,
    MilestoneWrite,
    ProjectOut,
    ProjectWrite,
    SprintOut,
    SprintWrite,
    TaskCommentOut,
    TaskCommentWrite,
    TaskOut,
    TaskStatusUpdate,
    TaskSubtaskOut,
    TaskSubtaskWrite,
    TaskWrite,
    TimesheetBulkApproveResult,
    TimesheetBulkApproveWrite,
    TimesheetEntryOut,
    TimesheetEntryWrite,
)
from app.services import list_export, org_scope, opportunity_engine, project_engine, project_scope
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["project"])
DIRECTORY_SCREEN = "project.directory"
BOARD_SCREEN = "project.board"
SPRINTS_SCREEN = "project.sprints"
MILESTONES_SCREEN = "project.milestones"

_PROJECT_LIST_COLUMNS = [
    ColumnSpec("project_code", "Project Code"),
    ColumnSpec("project_name", "Name"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("status", "Status"),
    ColumnSpec("lead", "Lead"),
    ColumnSpec("start_date", "Start Date"),
    ColumnSpec("end_date", "End Date"),
    ColumnSpec("budget", "Budget", align="left"),
]
_TASK_LIST_COLUMNS = [
    ColumnSpec("title", "Title"),
    ColumnSpec("assignee", "Assignee"),
    ColumnSpec("status", "Status"),
    ColumnSpec("priority", "Priority"),
    ColumnSpec("due_date", "Due Date"),
]
_SPRINT_LIST_COLUMNS = [
    ColumnSpec("name", "Name"),
    ColumnSpec("start_date", "Start Date"),
    ColumnSpec("end_date", "End Date"),
    ColumnSpec("status", "Status"),
]
_BUG_LIST_COLUMNS = [
    ColumnSpec("title", "Title"),
    ColumnSpec("severity", "Severity"),
    ColumnSpec("status", "Status"),
    ColumnSpec("assignee", "Assignee"),
]
_TEAM_TIMESHEET_LIST_COLUMNS = [
    ColumnSpec("employee", "Employee"),
    ColumnSpec("entry_date", "Date"),
    ColumnSpec("task_category", "Task/Category"),
    ColumnSpec("hours", "Hours", align="right"),
    ColumnSpec("status", "Status"),
]
_MY_TIMESHEET_LIST_COLUMNS = [
    ColumnSpec("entry_date", "Date"),
    ColumnSpec("task_category", "Task/Category"),
    ColumnSpec("hours", "Hours", align="right"),
    ColumnSpec("status", "Status"),
]
_MILESTONE_LIST_COLUMNS = [
    ColumnSpec("milestone_name", "Name"),
    ColumnSpec("target_date", "Target Date"),
    ColumnSpec("status", "Status"),
    ColumnSpec("linked_tasks_count", "Linked Tasks", align="right"),
]
_MY_PROJECTS_LIST_COLUMNS = [
    ColumnSpec("project_code", "Project Code"),
    ColumnSpec("project_name", "Name"),
    ColumnSpec("customer", "Customer"),
    ColumnSpec("status", "Status"),
]
_MY_TASKS_BUGS_LIST_COLUMNS = [
    ColumnSpec("item_type", "Type"),
    ColumnSpec("title", "Title"),
    ColumnSpec("project", "Project"),
    ColumnSpec("status", "Status"),
    ColumnSpec("priority", "Priority"),
    ColumnSpec("due_date", "Due Date"),
]


def _employee_name(employee: Employee) -> str:
    return f"{employee.first_name} {employee.last_name or ''}".strip()


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _toggle_enabled(db: AsyncSession, toggle_key: str) -> bool:
    row = (await db.execute(select(FeatureToggle.enabled).where(FeatureToggle.toggle_key == toggle_key))).scalar_one_or_none()
    return bool(row)


async def _manager_restricted_to_own_projects(db: AsyncSession, perms: PermissionSet) -> bool:
    # §6.1 "Restrict Manager to Only Projects They Manage" — same "OFF =
    # Manager's seeded 'full' stands, ON = narrows" shape as customers.py's/
    # opportunities.py's own Manager-restriction toggles. Deliberately
    # Project LEAD only (project_lead_id), not Lead-or-Member — "projects
    # THEY MANAGE" is narrower than Employee's own team-member scope
    # (project_scope.is_project_team_member, Lead + Members).
    return perms.role_code == "MANAGER" and await _toggle_enabled(db, "Restrict Manager to Only Projects They Manage")


async def _assert_project_access(db: AsyncSession, perms: PermissionSet, current_user: User, project: Project) -> None:
    """The one shared choke point for "may this caller act on/see THIS
    project" — wraps project_scope's own team-membership check and layers
    §6.1's Manager-restriction toggle on top. Every place in this file that
    resolves a project (directly, or via a Task/Bug/Sprint/Milestone/Report
    that belongs to one) goes through this single function rather than each
    re-implementing the check inline — the exact "one spot missed" class of
    gap this module's own docstring already calls out.
    """
    own_id = await org_scope.get_own_employee_id(db, current_user)
    await project_scope.assert_project_scope(db, perms, own_id, project)
    if await _manager_restricted_to_own_projects(db, perms) and project.project_lead_id != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")


async def _hide_budget_from_employee(db: AsyncSession) -> bool:
    return await _toggle_enabled(db, "Hide Budget from Employee's Project View")


async def _resolve_project_perms(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_preview_role: str | None = Header(None),
) -> PermissionSet:
    """Same resolution require_screen(DIRECTORY_SCREEN) does (preview-role
    header included), but never raises on an invisible screen —
    list_projects/get_project need the resolved PermissionSet even for
    Accountant (mode='none') to decide whether §6.1's "Give Accountant Read
    Access to Project Budgets" bypass applies. require_screen itself 404s
    before the route body ever runs, which would make that bypass
    unreachable — same reasoning as customers.py's/opportunities.py's own
    _resolve_*_perms helpers.
    """
    preview_role_id: str | None = None
    if x_preview_role:
        real_role = await db.get(Role, current_user.role_id)
        if real_role and real_role.code == "SUPER_ADMIN":
            preview_role_row = (await db.execute(select(Role).where(Role.code == x_preview_role))).scalar_one_or_none()
            if preview_role_row:
                preview_role_id = preview_role_row.id
    return await resolve_permission(db, current_user, DIRECTORY_SCREEN, preview_role_id=preview_role_id)


async def _load_project_out(db: AsyncSession, project: Project, *, hide_budget: bool = False) -> ProjectOut:
    member_ids = (await db.execute(select(ProjectMember.employee_id).where(ProjectMember.project_id == project.id))).scalars().all()
    out = ProjectOut.model_validate(project)
    out.member_ids = list(member_ids)
    if hide_budget:
        out.budget = None
    return out


# ================================================================= DIRECTORY
@router.get("/projects", response_model=None)
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_project_perms),
    customer_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    project_lead_id: str | None = Query(None),
    team_member_id: str | None = Query(None),
    financial_year_id: str | None = Query(None),
    start_date_from: date_type | None = Query(None),
    start_date_to: date_type | None = Query(None),
    end_date_from: date_type | None = Query(None),
    end_date_to: date_type | None = Query(None),
    budget_min: Decimal | None = Query(None),
    budget_max: Decimal | None = Query(None),
    overdue_only: bool = Query(False, description="Past End Date, not Completed"),
    created_from: date_type | None = Query(None),
    created_to: date_type | None = Query(None),
    created_by: str | None = Query(None, description="Super Admin only"),
    last_modified_by: str | None = Query(None, description="Super Admin only"),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ProjectOut] | Response:
    # §6.1 "Give Accountant Read Access to Project Budgets" — Accountant's
    # mode is 'none' here (require_screen would 404 before this body ever
    # runs), so this is the one bypass on this endpoint. "without task/bug/
    # sprint access" — deliberately does NOT touch _get_project_scoped, the
    # shared choke point every OTHER project-scoped endpoint in this file
    # goes through, so this toggle can never widen anything beyond this list.
    accountant_bypass = perms.role_code == "ACCOUNTANT" and await _toggle_enabled(db, "Give Accountant Read Access to Project Budgets")
    if not perms.visible and not accountant_bypass:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")

    stmt = select(Project)
    if customer_id:
        stmt = stmt.where(Project.customer_id == customer_id)
    if status_filter:
        stmt = stmt.where(Project.status.in_(status_filter))
    if project_lead_id:
        stmt = stmt.where(Project.project_lead_id == project_lead_id)
    if financial_year_id:
        stmt = stmt.where(Project.financial_year_id == financial_year_id)
    if start_date_from:
        stmt = stmt.where(Project.start_date >= start_date_from)
    if start_date_to:
        stmt = stmt.where(Project.start_date <= start_date_to)
    if end_date_from:
        stmt = stmt.where(Project.end_date >= end_date_from)
    if end_date_to:
        stmt = stmt.where(Project.end_date <= end_date_to)
    if budget_min is not None:
        stmt = stmt.where(Project.budget >= budget_min)
    if budget_max is not None:
        stmt = stmt.where(Project.budget <= budget_max)
    if overdue_only:
        stmt = stmt.where(Project.end_date < date_type.today(), Project.status != "COMPLETED")
    if created_from:
        stmt = stmt.where(Project.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Project.created_at < created_to + timedelta(days=1))
    if created_by:
        stmt = stmt.where(Project.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(Project.updated_by == last_modified_by)
    if team_member_id:
        member_project_ids = (await db.execute(select(ProjectMember.project_id).where(ProjectMember.employee_id == team_member_id))).scalars().all()
        stmt = stmt.where(Project.id.in_(member_project_ids)) if member_project_ids else stmt.where(Project.id.is_(None))
    if search:
        stmt = stmt.where(Project.project_name.ilike(f"%{search}%"))
    restrict_to_manager_lead = await _manager_restricted_to_own_projects(db, perms)
    if restrict_to_manager_lead:
        manager_own_id = await org_scope.get_own_employee_id(db, current_user)
        stmt = stmt.where(Project.project_lead_id == manager_own_id)
    elif perms.mode == "own":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        team_ids = await project_scope.team_project_ids(db, own_id) if own_id else set()
        if not team_ids:
            return []
        stmt = stmt.where(Project.id.in_(team_ids))
    rows = (await db.execute(stmt.order_by(Project.start_date))).scalars().all()

    hide_budget = perms.role_code == "EMPLOYEE" and await _hide_budget_from_employee(db)

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        customer_ids = {r.customer_id for r in rows}
        lead_ids = {r.project_lead_id for r in rows}
        customers = {}
        if customer_ids:
            customer_rows = (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all()
            customers = {c.id: c.company_name for c in customer_rows}
        leads = {}
        if lead_ids:
            lead_rows = (await db.execute(select(Employee).where(Employee.id.in_(lead_ids)))).scalars().all()
            leads = {e.id: _employee_name(e) for e in lead_rows}
        export_rows = [
            {
                "project_code": r.project_code, "project_name": r.project_name, "customer": customers.get(r.customer_id),
                "status": r.status, "lead": leads.get(r.project_lead_id), "start_date": r.start_date,
                "end_date": r.end_date, "budget": (None if hide_budget else r.budget),
            }
            for r in rows
        ]
        filters_applied = {
            "customer_id": customer_id, "status": status_filter, "project_lead_id": project_lead_id,
            "team_member_id": team_member_id, "financial_year_id": financial_year_id,
            "start_date_from": start_date_from, "start_date_to": start_date_to,
            "end_date_from": end_date_from, "end_date_to": end_date_to, "budget_min": budget_min,
            "budget_max": budget_max, "overdue_only": overdue_only, "created_from": created_from, "created_to": created_to,
            "created_by": created_by, "last_modified_by": last_modified_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Projects", _PROJECT_LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_project_out(db, row, hide_budget=hide_budget) for row in rows]


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> ProjectOut:
    fy = await get_current_financial_year(db)
    code = await allocate_number(db, "PRJ", fy.id, fy.label)
    data = body.model_dump()
    member_ids = data.pop("member_ids")
    row = Project(id=str(uuid.uuid4()), project_code=code, financial_year_id=fy.id, created_by=current_user.id, updated_by=current_user.id, **data)
    db.add(row)
    for employee_id in set(member_ids):
        db.add(ProjectMember(id=str(uuid.uuid4()), project_id=row.id, employee_id=employee_id, created_by=current_user.id))

    # §2.2/§3.3 Path B: picking an Opportunity auto-marks it Won if it isn't
    # already — the same shared logic Path A (direct Opportunity edit) uses.
    if body.opportunity_id is not None:
        from app.models.opportunity import Opportunity

        opportunity = await db.get(Opportunity, body.opportunity_id)
        if opportunity is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
        await opportunity_engine.mark_opportunity_won(db, opportunity, current_user.id)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_project_out(db, row)


async def _get_project_scoped(db: AsyncSession, project_id: str, perms: PermissionSet, current_user: User) -> Project:
    """Resolve-then-scope for the Directory's own single-record routes —
    Task/Bug/Sprint/Milestone/Report each resolve their PARENT project
    (already in hand from their own db.get) and call _assert_project_access
    directly instead, so as not to fetch the project twice.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _assert_project_access(db, perms, current_user, project)
    return project


@router.get("/projects/{project_id}", response_model=None)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(_resolve_project_perms),
) -> ProjectOut:
    """§6.1 "Give Accountant Read Access to Project Budgets" is the one
    read-only bypass on this endpoint — Accountant's mode is 'none' here, so
    _resolve_project_perms (not require_screen) is what lets that body run
    at all for them.
    """
    if perms.visible:
        project = await _get_project_scoped(db, project_id, perms, current_user)
        hide_budget = perms.role_code == "EMPLOYEE" and await _hide_budget_from_employee(db)
        return await _load_project_out(db, project, hide_budget=hide_budget)
    if perms.role_code == "ACCOUNTANT" and await _toggle_enabled(db, "Give Accountant Read Access to Project Budgets"):
        project = await db.get(Project, project_id)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        return await _load_project_out(db, project)
    raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.put("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    body: ProjectWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY_SCREEN, action="edit")),
) -> ProjectOut:
    row = await _get_project_scoped(db, project_id, perms, current_user)
    data = body.model_dump()
    member_ids = set(data.pop("member_ids"))
    became_won_source = body.opportunity_id is not None and body.opportunity_id != row.opportunity_id
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_by = current_user.id

    for member in (await db.execute(select(ProjectMember).where(ProjectMember.project_id == project_id))).scalars():
        if member.employee_id not in member_ids:
            await db.delete(member)
        else:
            member_ids.discard(member.employee_id)
    for employee_id in member_ids:
        db.add(ProjectMember(id=str(uuid.uuid4()), project_id=project_id, employee_id=employee_id, created_by=current_user.id))

    if became_won_source:
        from app.models.opportunity import Opportunity

        opportunity = await db.get(Opportunity, body.opportunity_id)
        if opportunity is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Opportunity not found")
        await opportunity_engine.mark_opportunity_won(db, opportunity, current_user.id)

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_project_out(db, row)


# ============================================================ TASK BOARD
async def _load_task_out(db: AsyncSession, task: Task) -> TaskOut:
    subtasks = (await db.execute(select(TaskSubtask).where(TaskSubtask.task_id == task.id).order_by(TaskSubtask.sequence))).scalars().all()
    comments = (await db.execute(select(TaskComment).where(TaskComment.task_id == task.id).order_by(TaskComment.created_at))).scalars().all()
    out = TaskOut.model_validate(task)
    out.subtasks = list(subtasks)
    out.comments = list(comments)
    return out


@router.get("/projects/{project_id}/tasks", response_model=None)
async def list_tasks(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
    status_filter: list[str] | None = Query(None, alias="status"),
    assignee_id: str | None = Query(None),
    sprint_id: str | None = Query(None),
    priority: list[str] | None = Query(None),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    overdue_only: bool = Query(False, description="Past Due Date, not Done"),
    created_from: date_type | None = Query(None),
    created_to: date_type | None = Query(None),
    created_by: str | None = Query(None, description="Super Admin only"),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[TaskOut] | Response:
    # Note: no "Unassigned only" toggle here — unlike Bug.assignee_id,
    # Task.assignee_id is NOT NULL in this schema (Assignee is a genuinely
    # required field on Task, per 0006_operations.py), so that filter would
    # be permanently unsatisfiable rather than just usually-empty.
    await _get_project_scoped(db, project_id, perms, current_user)
    stmt = select(Task).where(Task.project_id == project_id)
    if status_filter:
        stmt = stmt.where(Task.status.in_(status_filter))
    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if sprint_id:
        stmt = stmt.where(Task.sprint_id == sprint_id)
    if priority:
        stmt = stmt.where(Task.priority.in_(priority))
    if due_date_from:
        stmt = stmt.where(Task.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(Task.due_date <= due_date_to)
    if overdue_only:
        stmt = stmt.where(Task.due_date < date_type.today(), Task.status != "DONE")
    if created_from:
        stmt = stmt.where(Task.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Task.created_at < created_to + timedelta(days=1))
    if created_by:
        stmt = stmt.where(Task.created_by == created_by)
    if search:
        stmt = stmt.where(or_(Task.title.ilike(f"%{search}%"), Task.description.ilike(f"%{search}%")))
    rows = (await db.execute(stmt)).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        assignee_ids = {r.assignee_id for r in rows}
        assignees = {}
        if assignee_ids:
            assignee_rows = (await db.execute(select(Employee).where(Employee.id.in_(assignee_ids)))).scalars().all()
            assignees = {e.id: _employee_name(e) for e in assignee_rows}
        export_rows = [
            {"title": r.title, "assignee": assignees.get(r.assignee_id), "status": r.status, "priority": r.priority, "due_date": r.due_date}
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "assignee_id": assignee_id, "sprint_id": sprint_id, "priority": priority,
            "due_date_from": due_date_from, "due_date_to": due_date_to, "overdue_only": overdue_only,
            "created_from": created_from, "created_to": created_to, "created_by": created_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Task Board", _TASK_LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_task_out(db, row) for row in rows]


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    project_id: str,
    body: TaskWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskOut:
    # §2.3: "creating a task is not restricted; only deleting one is" — any
    # team member (mode='own', still scope-checked below), Manager, Super Admin.
    project = await _get_project_scoped(db, project_id, perms, current_user)
    # Appendix B: "Both dropdowns are limited to employees on THIS project's
    # team" — Assignee must be the Lead or a Member, not any employee.
    if not await project_scope.is_project_team_member(db, project, body.assignee_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be a Lead or Member of this project")
    row = Task(id=str(uuid.uuid4()), project_id=project.id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_task_out(db, row)


async def _get_task_scoped(db: AsyncSession, task_id: str, perms: PermissionSet, current_user: User) -> Task:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, task.project_id)
    await _assert_project_access(db, perms, current_user, project)
    return task


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskOut:
    task = await _get_task_scoped(db, task_id, perms, current_user)
    return await _load_task_out(db, task)


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    body: TaskWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskOut:
    task = await _get_task_scoped(db, task_id, perms, current_user)
    project = await db.get(Project, task.project_id)
    if not await project_scope.is_project_team_member(db, project, body.assignee_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be a Lead or Member of this project")
    for field, value in body.model_dump().items():
        setattr(task, field, value)
    task.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(task)
    return await _load_task_out(db, task)


@router.put("/tasks/{task_id}/status", response_model=TaskOut)
async def update_task_status(
    task_id: str,
    body: TaskStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskOut:
    """§3.2/§4: drag-and-drop and the Status dropdown are 'the same action
    from two entry points' — a narrow status-only write, unlike the
    full-replace PUT above which requires resending sprint_id/priority/
    due_date or silently clearing them.
    """
    task = await _get_task_scoped(db, task_id, perms, current_user)
    task.status = body.status
    task.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(task)
    return await _load_task_out(db, task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN, action="delete")),
) -> None:
    task = await _get_task_scoped(db, task_id, perms, current_user)
    try:
        await db.delete(task)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This task cannot be deleted while other records (e.g. logged Timesheet entries) still reference it") from exc


@router.post("/tasks/{task_id}/comments", response_model=TaskCommentOut, status_code=status.HTTP_201_CREATED)
async def add_task_comment(
    task_id: str,
    body: TaskCommentWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskComment:
    await _get_task_scoped(db, task_id, perms, current_user)
    row = TaskComment(id=str(uuid.uuid4()), task_id=task_id, author_id=current_user.id, content=body.content)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/tasks/{task_id}/subtasks", response_model=TaskSubtaskOut, status_code=status.HTTP_201_CREATED)
async def add_subtask(
    task_id: str,
    body: TaskSubtaskWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskSubtask:
    await _get_task_scoped(db, task_id, perms, current_user)
    existing_count = (await db.execute(select(TaskSubtask).where(TaskSubtask.task_id == task_id))).scalars().all()
    row = TaskSubtask(id=str(uuid.uuid4()), task_id=task_id, text=body.text, sequence=len(existing_count) + 1, created_by=current_user.id, updated_by=current_user.id)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.put("/subtasks/{subtask_id}", response_model=TaskSubtaskOut)
async def toggle_subtask(
    subtask_id: str,
    is_checked: bool,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> TaskSubtask:
    row = await db.get(TaskSubtask, subtask_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _get_task_scoped(db, row.task_id, perms, current_user)
    row.is_checked = is_checked
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


# =================================================================== SPRINTS
@router.get("/projects/{project_id}/sprints", response_model=None)
async def list_sprints(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SPRINTS_SCREEN)),
    status_filter: list[str] | None = Query(None, alias="status"),
    start_date_from: date_type | None = Query(None),
    start_date_to: date_type | None = Query(None),
    end_date_from: date_type | None = Query(None),
    end_date_to: date_type | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[SprintOut] | Response:
    await _get_project_scoped(db, project_id, perms, current_user)
    stmt = select(Sprint).where(Sprint.project_id == project_id)
    if status_filter:
        stmt = stmt.where(Sprint.status.in_(status_filter))
    if start_date_from:
        stmt = stmt.where(Sprint.start_date >= start_date_from)
    if start_date_to:
        stmt = stmt.where(Sprint.start_date <= start_date_to)
    if end_date_from:
        stmt = stmt.where(Sprint.end_date >= end_date_from)
    if end_date_to:
        stmt = stmt.where(Sprint.end_date <= end_date_to)
    if search:
        stmt = stmt.where(Sprint.name.ilike(f"%{search}%"))
    rows = list((await db.execute(stmt.order_by(Sprint.start_date.desc()))).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        export_rows = [{"name": r.name, "start_date": r.start_date, "end_date": r.end_date, "status": r.status} for r in rows]
        filters_applied = {
            "status": status_filter, "start_date_from": start_date_from, "start_date_to": start_date_to,
            "end_date_from": end_date_from, "end_date_to": end_date_to, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Sprints", _SPRINT_LIST_COLUMNS, export_rows, filters_applied)

    return rows


@router.post("/projects/{project_id}/sprints", response_model=SprintOut, status_code=status.HTTP_201_CREATED)
async def start_sprint(
    project_id: str,
    body: SprintWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SPRINTS_SCREEN, action="manage")),
) -> Sprint:
    await _get_project_scoped(db, project_id, perms, current_user)
    row = Sprint(id=str(uuid.uuid4()), project_id=project_id, status="ACTIVE", created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.put("/sprints/{sprint_id}/tasks", response_model=SprintOut)
async def update_sprint_tasks(
    sprint_id: str,
    task_ids: list[str],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SPRINTS_SCREEN, action="manage")),
) -> Sprint:
    """§2.5 "Update Sprint": a multi-select of the project's tasks, checked
    ones belong to the sprint — a full replace of membership, not additive.
    """
    sprint = await db.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, sprint.project_id)
    await _assert_project_access(db, perms, current_user, project)
    if sprint.status != "ACTIVE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only an Active sprint's tasks can be updated")
    for task in (await db.execute(select(Task).where(Task.sprint_id == sprint_id))).scalars():
        if task.id not in task_ids:
            task.sprint_id = None
            task.updated_by = current_user.id
    for task_id in task_ids:
        task = await db.get(Task, task_id)
        if task is None or task.project_id != sprint.project_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Task {task_id} does not belong to this project")
        task.sprint_id = sprint_id
        task.updated_by = current_user.id
    await db.commit()
    await db.refresh(sprint)
    return sprint


@router.post("/sprints/{sprint_id}/complete", response_model=SprintOut)
async def complete_sprint(
    sprint_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SPRINTS_SCREEN, action="manage")),
) -> Sprint:
    sprint = await db.get(Sprint, sprint_id)
    if sprint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, sprint.project_id)
    await _assert_project_access(db, perms, current_user, project)
    if sprint.status != "ACTIVE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only an Active sprint can be completed")
    # A171: anything still not Done returns to the Backlog, not left tagged
    # to a closed sprint.
    for task in (await db.execute(select(Task).where(Task.sprint_id == sprint_id, Task.status != "DONE"))).scalars():
        task.sprint_id = None
        task.status = "BACKLOG"
        task.updated_by = current_user.id
    sprint.status = "COMPLETED"
    sprint.updated_by = current_user.id
    await db.commit()
    await db.refresh(sprint)
    return sprint


# ===================================================================== BUGS
async def _load_bug_out(db: AsyncSession, bug: Bug) -> BugOut:
    comments = (await db.execute(select(BugComment).where(BugComment.bug_id == bug.id).order_by(BugComment.created_at))).scalars().all()
    out = BugOut.model_validate(bug)
    out.comments = list(comments)
    return out


@router.get("/projects/{project_id}/bugs", response_model=None)
async def list_bugs(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
    status_filter: list[str] | None = Query(None, alias="status"),
    severity: list[str] | None = Query(None),
    assignee_id: str | None = Query(None),
    reported_by: str | None = Query(None),
    unassigned_only: bool = Query(False),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    overdue_only: bool = Query(False, description="Past Due Date, not Closed"),
    created_from: date_type | None = Query(None),
    created_to: date_type | None = Query(None),
    last_modified_by: str | None = Query(None, description="Super Admin only"),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[BugOut] | Response:
    await _get_project_scoped(db, project_id, perms, current_user)
    stmt = select(Bug).where(Bug.project_id == project_id)
    if status_filter:
        stmt = stmt.where(Bug.status.in_(status_filter))
    if severity:
        stmt = stmt.where(Bug.severity.in_(severity))
    if assignee_id:
        stmt = stmt.where(Bug.assignee_id == assignee_id)
    if unassigned_only:
        stmt = stmt.where(Bug.assignee_id.is_(None))
    if reported_by:
        stmt = stmt.where(Bug.reported_by == reported_by)
    if due_date_from:
        stmt = stmt.where(Bug.due_date >= due_date_from)
    if due_date_to:
        stmt = stmt.where(Bug.due_date <= due_date_to)
    if overdue_only:
        stmt = stmt.where(Bug.due_date < date_type.today(), Bug.status != "CLOSED")
    if created_from:
        stmt = stmt.where(Bug.created_at >= created_from)
    if created_to:
        stmt = stmt.where(Bug.created_at < created_to + timedelta(days=1))
    if last_modified_by:
        stmt = stmt.where(Bug.updated_by == last_modified_by)
    if search:
        stmt = stmt.where(or_(Bug.title.ilike(f"%{search}%"), Bug.description.ilike(f"%{search}%")))
    rows = (await db.execute(stmt)).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        assignee_ids = {r.assignee_id for r in rows if r.assignee_id}
        assignees = {}
        if assignee_ids:
            assignee_rows = (await db.execute(select(Employee).where(Employee.id.in_(assignee_ids)))).scalars().all()
            assignees = {e.id: _employee_name(e) for e in assignee_rows}
        export_rows = [
            {"title": r.title, "severity": r.severity, "status": r.status, "assignee": assignees.get(r.assignee_id) if r.assignee_id else None}
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "severity": severity, "assignee_id": assignee_id, "reported_by": reported_by,
            "unassigned_only": unassigned_only, "due_date_from": due_date_from, "due_date_to": due_date_to,
            "overdue_only": overdue_only, "created_from": created_from, "created_to": created_to,
            "last_modified_by": last_modified_by, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Bugs", _BUG_LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_bug_out(db, row) for row in rows]


@router.post("/projects/{project_id}/bugs", response_model=BugOut, status_code=status.HTTP_201_CREATED)
async def create_bug(
    project_id: str,
    body: BugWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> BugOut:
    project = await _get_project_scoped(db, project_id, perms, current_user)
    if body.assignee_id is not None and not await project_scope.is_project_team_member(db, project, body.assignee_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be a Lead or Member of this project")
    row = Bug(id=str(uuid.uuid4()), project_id=project_id, reported_by=current_user.id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_bug_out(db, row)


async def _get_bug_scoped(db: AsyncSession, bug_id: str, perms: PermissionSet, current_user: User) -> Bug:
    bug = await db.get(Bug, bug_id)
    if bug is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, bug.project_id)
    await _assert_project_access(db, perms, current_user, project)
    return bug


@router.get("/bugs/{bug_id}", response_model=BugOut)
async def get_bug(
    bug_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> BugOut:
    bug = await _get_bug_scoped(db, bug_id, perms, current_user)
    return await _load_bug_out(db, bug)


@router.put("/bugs/{bug_id}", response_model=BugOut)
async def update_bug(
    bug_id: str,
    body: BugWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> BugOut:
    bug = await _get_bug_scoped(db, bug_id, perms, current_user)
    if body.assignee_id is not None:
        project = await db.get(Project, bug.project_id)
        if not await project_scope.is_project_team_member(db, project, body.assignee_id):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be a Lead or Member of this project")
    for field, value in body.model_dump().items():
        setattr(bug, field, value)
    bug.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(bug)
    return await _load_bug_out(db, bug)


@router.delete("/bugs/{bug_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bug(
    bug_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN, action="delete")),
) -> None:
    bug = await _get_bug_scoped(db, bug_id, perms, current_user)
    await db.delete(bug)
    await db.commit()


@router.post("/bugs/{bug_id}/comments", response_model=BugCommentOut, status_code=status.HTTP_201_CREATED)
async def add_bug_comment(
    bug_id: str,
    body: BugCommentWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(BOARD_SCREEN)),
) -> BugComment:
    await _get_bug_scoped(db, bug_id, perms, current_user)
    row = BugComment(id=str(uuid.uuid4()), bug_id=bug_id, author_id=current_user.id, content=body.content)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ================================================================ MILESTONES
async def _load_milestone_out(db: AsyncSession, milestone: Milestone) -> MilestoneOut:
    linked = (await db.execute(select(MilestoneTask.task_id).where(MilestoneTask.milestone_id == milestone.id))).scalars().all()
    out = MilestoneOut.model_validate(milestone)
    out.linked_task_ids = list(linked)
    progress = await project_engine.milestone_progress(db, milestone.id)
    if progress is not None:
        out.tasks_done, out.tasks_total = progress
    return out


async def _flip_overdue_milestones(db: AsyncSession, milestones: list[Milestone]) -> None:
    """A174: "Missed is set automatically when Target Date passes while
    still Upcoming" — lazily materialized on read (see 0006_operations.py's
    docstring), the same pattern MonthlyHourReconciliation established.
    """
    today = date_type.today()
    changed = False
    for m in milestones:
        if m.status == "UPCOMING" and m.target_date < today:
            m.status = "MISSED"
            changed = True
    if changed:
        await db.commit()


@router.get("/projects/{project_id}/milestones", response_model=None)
async def list_milestones(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MILESTONES_SCREEN)),
    status_filter: list[str] | None = Query(None, alias="status"),
    target_date_from: date_type | None = Query(None),
    target_date_to: date_type | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[MilestoneOut] | Response:
    await _get_project_scoped(db, project_id, perms, current_user)
    stmt = select(Milestone).where(Milestone.project_id == project_id)
    rows = (await db.execute(stmt.order_by(Milestone.target_date))).scalars().all()
    await _flip_overdue_milestones(db, list(rows))
    if status_filter:
        rows = [r for r in rows if r.status in status_filter]
    if target_date_from:
        rows = [r for r in rows if r.target_date >= target_date_from]
    if target_date_to:
        rows = [r for r in rows if r.target_date <= target_date_to]
    if search:
        rows = [r for r in rows if search.lower() in r.milestone_name.lower()]

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        milestone_ids = [r.id for r in rows]
        link_counts: dict[str, int] = {}
        if milestone_ids:
            link_rows = (await db.execute(select(MilestoneTask.milestone_id).where(MilestoneTask.milestone_id.in_(milestone_ids)))).scalars().all()
            for milestone_id in link_rows:
                link_counts[milestone_id] = link_counts.get(milestone_id, 0) + 1
        export_rows = [
            {"milestone_name": r.milestone_name, "target_date": r.target_date, "status": r.status, "linked_tasks_count": link_counts.get(r.id, 0)}
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "target_date_from": target_date_from, "target_date_to": target_date_to, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Milestones", _MILESTONE_LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_milestone_out(db, row) for row in rows]


@router.post("/projects/{project_id}/milestones", response_model=MilestoneOut, status_code=status.HTTP_201_CREATED)
async def create_milestone(
    project_id: str,
    body: MilestoneWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MILESTONES_SCREEN, action="manage")),
) -> MilestoneOut:
    await _get_project_scoped(db, project_id, perms, current_user)
    data = body.model_dump()
    linked_task_ids = set(data.pop("linked_task_ids"))
    for task_id in linked_task_ids:
        task = await db.get(Task, task_id)
        if task is None or task.project_id != project_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Task {task_id} does not belong to this project")
    row = Milestone(id=str(uuid.uuid4()), project_id=project_id, created_by=current_user.id, updated_by=current_user.id, **data)
    db.add(row)
    await db.flush()
    for task_id in linked_task_ids:
        db.add(MilestoneTask(id=str(uuid.uuid4()), milestone_id=row.id, task_id=task_id, created_by=current_user.id))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_milestone_out(db, row)


@router.put("/milestones/{milestone_id}", response_model=MilestoneOut)
async def update_milestone(
    milestone_id: str,
    body: MilestoneWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MILESTONES_SCREEN, action="manage")),
) -> MilestoneOut:
    row = await db.get(Milestone, milestone_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, row.project_id)
    await _assert_project_access(db, perms, current_user, project)
    data = body.model_dump()
    linked_task_ids = set(data.pop("linked_task_ids"))
    for task_id in linked_task_ids:
        task = await db.get(Task, task_id)
        if task is None or task.project_id != row.project_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Task {task_id} does not belong to this project")
    for field, value in data.items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    for link in (await db.execute(select(MilestoneTask).where(MilestoneTask.milestone_id == milestone_id))).scalars():
        if link.task_id not in linked_task_ids:
            await db.delete(link)
        else:
            linked_task_ids.discard(link.task_id)
    for task_id in linked_task_ids:
        db.add(MilestoneTask(id=str(uuid.uuid4()), milestone_id=milestone_id, task_id=task_id, created_by=current_user.id))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _load_milestone_out(db, row)


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_milestone(
    milestone_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MILESTONES_SCREEN, action="manage")),
) -> None:
    row = await db.get(Milestone, milestone_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, row.project_id)
    await _assert_project_access(db, perms, current_user, project)
    await db.delete(row)
    await db.commit()


# ================================================================== REPORT
@router.get("/projects/{project_id}/report")
async def project_report(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.report")),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    assignee_id: str | None = Query(None),
    sprint_id: str | None = Query(None),
    priority: str | None = Query(None),
    severity: str | None = Query(None),
) -> dict:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # project.report has its own screen mode (no team-membership 'own' mode
    # is seeded for it — Employee gets 'none' — but reuse the same scope
    # helper for consistency should that ever change; 'full' passes through).
    # Also layers the Manager-restriction toggle, same as every other
    # project sub-screen.
    await _assert_project_access(db, perms, current_user, project)

    task_stmt = select(Task).where(Task.project_id == project_id)
    bug_stmt = select(Bug).where(Bug.project_id == project_id)
    if date_from:
        task_stmt = task_stmt.where(Task.created_at >= date_from)
        bug_stmt = bug_stmt.where(Bug.created_at >= date_from)
    if date_to:
        task_stmt = task_stmt.where(Task.created_at <= date_to)
        bug_stmt = bug_stmt.where(Bug.created_at <= date_to)
    if assignee_id:
        task_stmt = task_stmt.where(Task.assignee_id == assignee_id)
        bug_stmt = bug_stmt.where(Bug.assignee_id == assignee_id)
    if sprint_id:
        task_stmt = task_stmt.where(Task.sprint_id == sprint_id)
    if priority:
        task_stmt = task_stmt.where(Task.priority == priority)
    if severity:
        bug_stmt = bug_stmt.where(Bug.severity == severity)

    tasks = (await db.execute(task_stmt.with_only_columns(Task.status))).scalars().all()
    bugs_severity = (await db.execute(bug_stmt.with_only_columns(Bug.severity))).scalars().all()
    bugs_status = (await db.execute(bug_stmt.with_only_columns(Bug.status))).scalars().all()
    return {
        "tasks_by_status": {s: tasks.count(s) for s in ("BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE")},
        # KNOWN §6 GAP — bugs_by_severity keys mirror Bug.severity, which is a
        # plain String(10) column pinned by a DB CHECK constraint
        # (ck_bugs_severity, alembic/versions/0006_operations.py:350:
        # severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), not a Masters-
        # backed lookup — there is no dynamic source to read these keys
        # from yet. Making it dynamic needs: a Masters lookup table for bug
        # severities (schema + migration to drop the CHECK and add an FK,
        # same shape as an existing masters_simple.py lookup router),
        # Bug.severity switched to reference it, and the frontend severity
        # dropdown re-pointed at that endpoint instead of a literal enum.
        # None of that exists yet, so this stays a literal tuple for now —
        # out of scope for a single-file, behavior-preserving pass.
        "bugs_by_severity": {s: bugs_severity.count(s) for s in ("LOW", "MEDIUM", "HIGH", "CRITICAL")},
        "bugs_by_status": {s: bugs_status.count(s) for s in ("OPEN", "IN_PROGRESS", "FIXED", "CLOSED")},
    }


# ================================================================ TIMESHEETS
@router.get("/timesheets/me", response_model=None)
async def my_timesheet(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.timesheet.mine")),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    task_id: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[TimesheetEntryOut] | Response:
    # A login with no linked Employee record (Super Admin, typically) simply has
    # no timesheet — zero rows, NOT an early return: `format` has to keep
    # working here exactly as it does on every other export-capable endpoint in
    # this module, otherwise a client that asked for a PDF and branches on
    # content-type (or triggers a file download) silently gets JSON back from
    # this one endpoint. An empty export is a valid export.
    own_id = await org_scope.get_own_employee_id(db, current_user)
    rows: list[TimesheetEntry] = []
    if own_id is not None:
        stmt = select(TimesheetEntry).where(TimesheetEntry.employee_id == own_id)
        if date_from:
            stmt = stmt.where(TimesheetEntry.entry_date >= date_from)
        if date_to:
            stmt = stmt.where(TimesheetEntry.entry_date <= date_to)
        if status_filter:
            stmt = stmt.where(TimesheetEntry.status.in_(status_filter))
        if task_id:
            stmt = stmt.where(TimesheetEntry.task_id == task_id)
        rows = list((await db.execute(stmt.order_by(TimesheetEntry.entry_date.desc()))).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        entry_task_ids = {r.task_id for r in rows if r.task_id}
        tasks = {}
        if entry_task_ids:
            task_rows = (await db.execute(select(Task).where(Task.id.in_(entry_task_ids)))).scalars().all()
            tasks = {t.id: t.title for t in task_rows}
        export_rows = [
            {"entry_date": r.entry_date, "task_category": tasks.get(r.task_id) if r.task_id else r.category, "hours": r.hours, "status": r.status}
            for r in rows
        ]
        filters_applied = {"date_from": date_from, "date_to": date_to, "status": status_filter, "task_id": task_id}
        return await list_export.build_export(format, db, current_user, "My Timesheet", _MY_TIMESHEET_LIST_COLUMNS, export_rows, filters_applied)

    return [TimesheetEntryOut.model_validate(r) for r in rows]


@router.post("/timesheets", response_model=TimesheetEntryOut, status_code=status.HTTP_201_CREATED)
async def log_timesheet_entry(
    project_id: str,
    body: TimesheetEntryWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.timesheet.mine")),
) -> TimesheetEntry:
    if body.entry_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Date cannot be in the future")
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Project not found")
    # project.timesheet.mine is deliberately 'full' for every role (any
    # employee can be staffed on a project) — that's screen VISIBILITY, not
    # project membership, so it's re-checked here explicitly, the same
    # "list scoped, single-record/action forgotten" lesson as every other
    # Project endpoint in this file.
    if not await project_scope.is_project_team_member(db, project, own_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="You must be a Lead or Member of this project to log hours against it")
    if body.task_id is not None:
        task = await db.get(Task, body.task_id)
        if task is None or task.project_id != project_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Task does not belong to this project")
    data = body.model_dump()
    save_as_draft = data.pop("save_as_draft")
    entry_status = "DRAFT" if save_as_draft else "SUBMITTED"
    row = TimesheetEntry(
        id=str(uuid.uuid4()), project_id=project_id, employee_id=own_id, status=entry_status,
        submitted_at=None if save_as_draft else datetime.now(timezone.utc),
        created_by=current_user.id, updated_by=current_user.id, **data,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


async def _get_own_draft_entry(db: AsyncSession, entry_id: str, current_user: User) -> TimesheetEntry:
    entry = await db.get(TimesheetEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if entry.employee_id != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if entry.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft entry can be edited, submitted, or discarded")
    return entry


@router.put("/timesheets/{entry_id}", response_model=TimesheetEntryOut)
async def update_draft_timesheet_entry(
    entry_id: str,
    body: TimesheetEntryWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.timesheet.mine")),
) -> TimesheetEntry:
    """§2.8: a Draft entry is 'recalculable, discardable' — the employee's
    own working copy before it's Submitted for approval.
    """
    entry = await _get_own_draft_entry(db, entry_id, current_user)
    if body.entry_date > date_type.today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Date cannot be in the future")
    if body.task_id is not None:
        task = await db.get(Task, body.task_id)
        if task is None or task.project_id != entry.project_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Task does not belong to this project")
    data = body.model_dump()
    data.pop("save_as_draft")
    for field, value in data.items():
        setattr(entry, field, value)
    entry.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(entry)
    return entry


@router.delete("/timesheets/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_draft_timesheet_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.timesheet.mine")),
) -> None:
    entry = await _get_own_draft_entry(db, entry_id, current_user)
    await db.delete(entry)
    await db.commit()


@router.post("/timesheets/{entry_id}/submit", response_model=TimesheetEntryOut)
async def submit_draft_timesheet_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("project.timesheet.mine")),
) -> TimesheetEntry:
    entry = await _get_own_draft_entry(db, entry_id, current_user)
    entry.status = "SUBMITTED"
    entry.submitted_at = datetime.now(timezone.utc)
    entry.updated_by = current_user.id
    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/projects/{project_id}/timesheets", response_model=None)
async def team_timesheet(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    employee_id: str | None = Query(None),
    status_filter: list[str] | None = Query(None, alias="status"),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    task_id: str | None = Query(None),
    sprint_id: str | None = Query(None),
    hours_min: float | None = Query(None),
    hours_max: float | None = Query(None),
    stale_days: int | None = Query(None, description="Submitted at least N days ago, still unapproved"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[TimesheetEntryOut] | Response:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    perms = await resolve_permission(db, current_user, "project.timesheet.team")
    own_id = await org_scope.get_own_employee_id(db, current_user)
    # A Project Lead of ANY system role approves their own project's
    # entries too — a per-project designation, not a role (§2.8).
    if not perms.visible and project.project_lead_id != own_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    stmt = select(TimesheetEntry).where(TimesheetEntry.project_id == project_id)
    if employee_id:
        stmt = stmt.where(TimesheetEntry.employee_id == employee_id)
    if status_filter:
        stmt = stmt.where(TimesheetEntry.status.in_(status_filter))
    if date_from:
        stmt = stmt.where(TimesheetEntry.entry_date >= date_from)
    if date_to:
        stmt = stmt.where(TimesheetEntry.entry_date <= date_to)
    if task_id:
        stmt = stmt.where(TimesheetEntry.task_id == task_id)
    if sprint_id:
        task_ids = (await db.execute(select(Task.id).where(Task.project_id == project_id, Task.sprint_id == sprint_id))).scalars().all()
        stmt = stmt.where(TimesheetEntry.task_id.in_(task_ids)) if task_ids else stmt.where(TimesheetEntry.id.is_(None))
    if hours_min is not None:
        stmt = stmt.where(TimesheetEntry.hours >= hours_min)
    if hours_max is not None:
        stmt = stmt.where(TimesheetEntry.hours <= hours_max)
    if stale_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=stale_days)
        stmt = stmt.where(TimesheetEntry.status == "SUBMITTED", TimesheetEntry.submitted_at <= cutoff)
    rows = list((await db.execute(stmt.order_by(TimesheetEntry.entry_date.desc()))).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        employee_ids = {r.employee_id for r in rows}
        entry_task_ids = {r.task_id for r in rows if r.task_id}
        employees = {}
        if employee_ids:
            employee_rows = (await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))).scalars().all()
            employees = {e.id: _employee_name(e) for e in employee_rows}
        tasks = {}
        if entry_task_ids:
            task_rows = (await db.execute(select(Task).where(Task.id.in_(entry_task_ids)))).scalars().all()
            tasks = {t.id: t.title for t in task_rows}
        export_rows = [
            {
                "employee": employees.get(r.employee_id), "entry_date": r.entry_date,
                "task_category": tasks.get(r.task_id) if r.task_id else r.category, "hours": r.hours, "status": r.status,
            }
            for r in rows
        ]
        filters_applied = {
            "employee_id": employee_id, "status": status_filter, "date_from": date_from, "date_to": date_to,
            "task_id": task_id, "sprint_id": sprint_id, "hours_min": hours_min, "hours_max": hours_max,
            "stale_days": stale_days,
        }
        return await list_export.build_export(format, db, current_user, "Team Timesheet", _TEAM_TIMESHEET_LIST_COLUMNS, export_rows, filters_applied)

    return rows


@router.post("/timesheets/{entry_id}/approve", response_model=TimesheetEntryOut)
async def approve_timesheet_entry(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TimesheetEntry:
    entry = await db.get(TimesheetEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    project = await db.get(Project, entry.project_id)
    perms = await resolve_permission(db, current_user, "project.timesheet.team")
    own_id = await org_scope.get_own_employee_id(db, current_user)
    is_project_lead = project.project_lead_id == own_id
    # Same 404-vs-403 convention as team_timesheet on this identical screen:
    # invisible screen + not the Project Lead -> 404 (looks like it doesn't
    # exist), never 403 (which would leak that the action exists at all).
    if not perms.visible and not is_project_lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not (perms.can("approve") or is_project_lead):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the Project Lead, Manager, or Super Admin may approve timesheet entries")
    if entry.status != "SUBMITTED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Submitted entry can be approved")
    entry.status = "APPROVED"
    entry.approved_by = current_user.id
    entry.approved_at = datetime.now(timezone.utc)
    entry.updated_by = current_user.id
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/projects/{project_id}/timesheets/bulk-approve", response_model=TimesheetBulkApproveResult)
async def bulk_approve_timesheet_entries(
    project_id: str,
    body: TimesheetBulkApproveWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TimesheetBulkApproveResult:
    """§2.8's "Deferred on the team view: bulk approve (approval is per
    entry as built)" — reversed here, same reasoning as Bugs' Overdue/Created
    On range: not a technical blocker, just not yet built. Authorization is
    resolved ONCE against this project (unlike the single-entry endpoint,
    which isn't project-scoped and so re-fetches the project per call) —
    same Lead-of-this-project-regardless-of-role OR Manager/Super Admin rule
    as approve_timesheet_entry. Partial success by design: an entry that
    isn't Submitted (already approved by someone else, mid-batch) is
    skipped, not a 409 for the whole batch — a concurrent-approval race is
    an expected case for a bulk action, not an error.
    """
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    perms = await resolve_permission(db, current_user, "project.timesheet.team")
    own_id = await org_scope.get_own_employee_id(db, current_user)
    is_project_lead = project.project_lead_id == own_id
    if not perms.visible and not is_project_lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not (perms.can("approve") or is_project_lead):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the Project Lead, Manager, or Super Admin may approve timesheet entries")
    approved: list[TimesheetEntry] = []
    skipped: list[str] = []
    for entry_id in body.entry_ids:
        entry = await db.get(TimesheetEntry, entry_id)
        if entry is None or entry.project_id != project_id or entry.status != "SUBMITTED":
            skipped.append(entry_id)
            continue
        entry.status = "APPROVED"
        entry.approved_by = current_user.id
        entry.approved_at = datetime.now(timezone.utc)
        entry.updated_by = current_user.id
        approved.append(entry)
    await db.commit()
    for entry in approved:
        await db.refresh(entry)
    return TimesheetBulkApproveResult(approved=[TimesheetEntryOut.model_validate(e) for e in approved], skipped=skipped)


# ==================================================== MY PROJECTS & TASKS
@router.get("/employees/me/projects", response_model=None)
async def my_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_projects_tasks")),
    status_filter: list[str] | None = Query(None, alias="status"),
    customer_id: str | None = Query(None),
    start_date_from: date_type | None = Query(None),
    start_date_to: date_type | None = Query(None),
    search: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ProjectOut] | Response:
    """§2.8 "Filters, on both lists — added in this revision... Projects:
    Project Status (multi-select), Service Category (from Masters), Customer,
    and a date range on project start." Service Category is skipped — Project
    has no such field, the same genuinely-absent dimension already confirmed
    on Customer's and Opportunity's own directories, not a build gap here.
    """
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        if format:
            return await list_export.build_export(format, db, current_user, "My Projects", _MY_PROJECTS_LIST_COLUMNS, [], {})
        return []
    project_ids = await project_scope.team_project_ids(db, own_id)
    if not project_ids:
        rows = []
    else:
        stmt = select(Project).where(Project.id.in_(project_ids))
        if status_filter:
            stmt = stmt.where(Project.status.in_(status_filter))
        if customer_id:
            stmt = stmt.where(Project.customer_id == customer_id)
        if start_date_from:
            stmt = stmt.where(Project.start_date >= start_date_from)
        if start_date_to:
            stmt = stmt.where(Project.start_date <= start_date_to)
        if search:
            stmt = stmt.where(Project.project_name.ilike(f"%{search}%"))
        rows = (await db.execute(stmt.order_by(Project.start_date))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        customer_ids = {r.customer_id for r in rows}
        customers = {}
        if customer_ids:
            customer_rows = (await db.execute(select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all()
            customers = {c.id: c.company_name for c in customer_rows}
        export_rows = [
            {"project_code": r.project_code, "project_name": r.project_name, "customer": customers.get(r.customer_id), "status": r.status}
            for r in rows
        ]
        filters_applied = {
            "status": status_filter, "customer_id": customer_id, "start_date_from": start_date_from,
            "start_date_to": start_date_to, "search": search,
        }
        return await list_export.build_export(format, db, current_user, "My Projects", _MY_PROJECTS_LIST_COLUMNS, export_rows, filters_applied)

    return [await _load_project_out(db, row) for row in rows]


@router.get("/employees/me/tasks-and-bugs", response_model=None)
async def my_tasks_and_bugs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen("employee.my_projects_tasks")),
    status_filter: list[str] | None = Query(None, alias="status"),
    item_type: str | None = Query(None, alias="type", description="task | bug"),
    project_id: str | None = Query(None),
    priority: list[str] | None = Query(None, description="A Bug's own Severity, aliased the same way the row itself is"),
    due_date_from: date_type | None = Query(None),
    due_date_to: date_type | None = Query(None),
    overdue_only: bool = Query(False, description="Past Due Date, not Done/Closed"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        # Same "no linked Employee, but format still needs a real (empty)
        # file rather than a bare JSON [] that ignores the request" fix as
        # my_projects just above — a sibling endpoint with the identical gap.
        if format:
            return await list_export.build_export(format, db, current_user, "My Tasks & Bugs", _MY_TASKS_BUGS_LIST_COLUMNS, [], {})
        return []
    results: list[dict] = []
    if item_type is None or item_type == "task":
        tasks = (await db.execute(select(Task).where(Task.assignee_id == own_id))).scalars().all()
        for t in tasks:
            if status_filter and t.status not in status_filter:
                continue
            if project_id and t.project_id != project_id:
                continue
            if priority and t.priority not in priority:
                continue
            if due_date_from and (t.due_date is None or t.due_date < due_date_from):
                continue
            if due_date_to and (t.due_date is None or t.due_date > due_date_to):
                continue
            if overdue_only and (t.due_date is None or t.due_date >= date_type.today() or t.status == "DONE"):
                continue
            results.append({"type": "task", "id": t.id, "title": t.title, "project_id": t.project_id, "status": t.status, "priority": t.priority, "due_date": t.due_date})
    if item_type is None or item_type == "bug":
        bugs = (await db.execute(select(Bug).where(Bug.assignee_id == own_id))).scalars().all()
        for b in bugs:
            if status_filter and b.status not in status_filter:
                continue
            if project_id and b.project_id != project_id:
                continue
            if priority and b.severity not in priority:
                continue
            if due_date_from and (b.due_date is None or b.due_date < due_date_from):
                continue
            if due_date_to and (b.due_date is None or b.due_date > due_date_to):
                continue
            if overdue_only and (b.due_date is None or b.due_date >= date_type.today() or b.status == "CLOSED"):
                continue
            results.append({"type": "bug", "id": b.id, "title": b.title, "project_id": b.project_id, "status": b.status, "priority": b.severity, "due_date": b.due_date})

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        project_ids = {r["project_id"] for r in results}
        projects = {}
        if project_ids:
            project_rows = (await db.execute(select(Project).where(Project.id.in_(project_ids)))).scalars().all()
            projects = {p.id: p.project_name for p in project_rows}
        export_rows = [
            {
                "item_type": "Task" if r["type"] == "task" else "Bug", "title": r["title"], "project": projects.get(r["project_id"]),
                "status": r["status"], "priority": r["priority"], "due_date": r["due_date"],
            }
            for r in results
        ]
        filters_applied = {
            "status": status_filter, "type": item_type, "project_id": project_id, "priority": priority,
            "due_date_from": due_date_from, "due_date_to": due_date_to, "overdue_only": overdue_only,
        }
        return await list_export.build_export(format, db, current_user, "My Tasks & Bugs", _MY_TASKS_BUGS_LIST_COLUMNS, export_rows, filters_applied)

    return results
