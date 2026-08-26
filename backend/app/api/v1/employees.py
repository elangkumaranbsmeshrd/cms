"""Employee §2.1 Directory, §2.2 Master Record (Personal/Employment/Bank/
Emergency Contact/Account & Login tabs — Salary Structure and Insurance are
governed separately, see employee_compensation.py), §2.3 My Profile +
Profile Change Requests.

Directory is list-only (registry: `actions=()`); every mutation gates on
Master Record's 'edit'/'manage_login', matching the registry comment that
Directory and Master Record are the same underlying data, viewed two ways.
"""

import logging
import secrets
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.security import hash_password
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.employee import Employee, EmployeeEmergencyContact, EmployeeStatutoryIdentifier, ProfileChangeRequest
from app.models.leave import LeaveBalance
from app.models.masters import Department, Designation, LeaveType, TaxHead
from app.models.platform import User
from app.models.rbac import Role
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.employee import (
    CreateLoginOut,
    EmergencyContactOut,
    EmergencyContactWrite,
    EmployeeOut,
    EmployeeWrite,
    LoginStatusOut,
    MyProfileEditableWrite,
    PROFILE_CHANGE_REQUEST_FIELDS,
    ProfileChangeDecision,
    ProfileChangeRequestCreate,
    ProfileChangeRequestOut,
    StatutoryIdentifierOut,
    StatutoryIdentifierWrite,
)
from app.services import auth_tokens, email_transport, list_export, org_scope
from app.services.leave_engine import calculate_prorated_starting_balance
from app.services.notify import notify
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

_LIST_COLUMNS = [
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("name", "Name"),
    ColumnSpec("department", "Department"),
    ColumnSpec("designation", "Designation"),
    ColumnSpec("employment_status", "Employment Status"),
    ColumnSpec("reporting_manager", "Reporting Manager"),
    ColumnSpec("joining_date", "Joining Date"),
]

router = APIRouter(prefix="/employees", tags=["employee"])
DIRECTORY = "employee.directory"
MASTER_RECORD = "employee.master_record"
MY_PROFILE = "employee.my_profile"


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


# Layer 3 (RBAC §3.2/§3.4) call-site pattern, matching customers.py/vendors.py/
# assets.py's already-proven _masked_<x> helper: build the plain dict FastAPI
# would otherwise auto-serialize, then let apply_field_masking hide/mask
# whatever the caller's role has configured for MASTER_RECORD's/DIRECTORY's
# field manifest (aadhaar_number, pan_number, date_of_birth, current_address,
# email, phone, etc. — see app/rbac/field_manifest.json). EmployeeOut's
# model_config = ConfigDict(from_attributes=True) is set INSIDE the real
# `class EmployeeOut(EmployeeWrite):` body (not assigned after the fact via
# create_model(...)), so model_validate(row) on an Employee ORM instance is
# safe here — see this module's own docstring/the master prompt's "sharp
# edge" note.
def _masked_employee(row: Employee, perms: PermissionSet) -> dict:
    return apply_field_masking(EmployeeOut.model_validate(row).model_dump(), perms)


async def _upsert_statutory_identifier(
    db: AsyncSession, employee_id: str, tax_head_id: str, value: str, user_id: str
) -> EmployeeStatutoryIdentifier:
    existing = (
        await db.execute(
            select(EmployeeStatutoryIdentifier).where(
                EmployeeStatutoryIdentifier.employee_id == employee_id, EmployeeStatutoryIdentifier.tax_head_id == tax_head_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.identifier_value = value
        existing.captured_at = datetime.now(timezone.utc)
        existing.updated_by = user_id
        return existing
    tax_head = await db.get(TaxHead, tax_head_id)
    if tax_head is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tax head not found")
    row = EmployeeStatutoryIdentifier(
        id=str(uuid.uuid4()), employee_id=employee_id, tax_head_id=tax_head_id,
        identifier_label_snapshot=tax_head.print_label or tax_head.tax_name,
        identifier_value=value, captured_at=datetime.now(timezone.utc),
        created_by=user_id, updated_by=user_id,
    )
    db.add(row)
    return row


# ================================================================ DIRECTORY
@router.get("", response_model=None)
async def list_employees(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(DIRECTORY)),
    search: str | None = Query(None, description="Case-insensitive match on name, Employee ID, email, or phone"),
    department_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_status: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    work_location_address_id: str | None = Query(None),
    joining_date_from: date | None = Query(None),
    joining_date_to: date | None = Query(None),
    created_by: str | None = Query(None),
    last_modified_by: str | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[EmployeeOut] | Response:
    stmt = select(Employee)
    if perms.mode in ("team", "view_team"):
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=Employee.id, owner_id=own_id, team_member_ids=reports)
    if search:
        # §2.1: "Searches Name, Employee ID, Email, and Phone" — found
        # missing Employee ID/Phone by the Phase 2 audit.
        pattern = f"%{search}%"
        stmt = stmt.where(
            Employee.first_name.ilike(pattern) | Employee.last_name.ilike(pattern) | Employee.email.ilike(pattern)
            | Employee.employee_code.ilike(pattern) | Employee.phone.ilike(pattern)
        )
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if designation_id:
        stmt = stmt.where(Employee.designation_id == designation_id)
    if employment_status:
        stmt = stmt.where(Employee.employment_status == employment_status)
    if employment_type_id:
        stmt = stmt.where(Employee.employment_type_id == employment_type_id)
    if reporting_manager_id:
        stmt = stmt.where(Employee.reporting_manager_id == reporting_manager_id)
    if work_location_address_id:
        stmt = stmt.where(Employee.work_location_address_id == work_location_address_id)
    if joining_date_from:
        stmt = stmt.where(Employee.joining_date >= joining_date_from)
    if joining_date_to:
        stmt = stmt.where(Employee.joining_date <= joining_date_to)
    if created_by:
        stmt = stmt.where(Employee.created_by == created_by)
    if last_modified_by:
        stmt = stmt.where(Employee.updated_by == last_modified_by)
    rows = list((await db.execute(stmt)).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped with
        # human-readable names instead of the raw ids the JSON path carries.
        dept_ids = {r.department_id for r in rows if r.department_id}
        desig_ids = {r.designation_id for r in rows if r.designation_id}
        manager_ids = {r.reporting_manager_id for r in rows if r.reporting_manager_id}
        departments = (
            {d.id: d.name for d in (await db.execute(select(Department).where(Department.id.in_(dept_ids)))).scalars().all()}
            if dept_ids else {}
        )
        designations = (
            {d.id: d.name for d in (await db.execute(select(Designation).where(Designation.id.in_(desig_ids)))).scalars().all()}
            if desig_ids else {}
        )
        managers = (
            {
                e.id: f"{e.first_name} {e.last_name or ''}".strip()
                for e in (await db.execute(select(Employee).where(Employee.id.in_(manager_ids)))).scalars().all()
            }
            if manager_ids else {}
        )
        export_rows = [
            {
                "employee_code": r.employee_code,
                "name": f"{r.first_name} {r.last_name or ''}".strip(),
                "department": departments.get(r.department_id, ""),
                "designation": designations.get(r.designation_id, ""),
                "employment_status": r.employment_status,
                "reporting_manager": managers.get(r.reporting_manager_id, "") if r.reporting_manager_id else "",
                "joining_date": r.joining_date,
            }
            for r in rows
        ]
        filters_applied = {
            "search": search, "department_id": department_id, "designation_id": designation_id,
            "employment_status": employment_status, "employment_type_id": employment_type_id,
            "reporting_manager_id": reporting_manager_id, "work_location_address_id": work_location_address_id,
            "joining_date_from": joining_date_from, "joining_date_to": joining_date_to,
            "created_by": created_by, "last_modified_by": last_modified_by,
        }
        return await list_export.build_export(format, db, current_user, "Employees", _LIST_COLUMNS, export_rows, filters_applied)

    # Layer 3: Directory's own field manifest (email/employee_code/
    # employment_status/joining_date/phone — see field_manifest.json) is
    # narrower than Master Record's, but the mechanism is generic — this was
    # previously returning raw Employee ORM rows straight past masking
    # entirely (`return rows`), the real Layer 3 exposure this pass exists to
    # close on a list endpoint.
    return [_masked_employee(r, perms) for r in rows]


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> dict:
    fy = await get_current_financial_year(db)
    employee_code = await allocate_number(db, code_type="EMP", financial_year_id=fy.id, fy_label=fy.label)
    row = Employee(
        id=str(uuid.uuid4()),
        employee_code=employee_code,
        code_financial_year_id=fy.id,
        created_by=current_user.id,
        updated_by=current_user.id,
        **body.model_dump(),
    )
    db.add(row)
    await db.flush()

    # Leave §2.3: "New employee starting balance — automatic, not a button."
    # Found missing entirely by the Phase 2 audit — leave_requests.py's
    # _get_or_create_balance only ever grants the FULL quota, lazily, the
    # first time the employee applies; this seeds every active leave type's
    # prorated balance right here, at the moment the record is first saved,
    # matching the spec's own trigger point. _get_or_create_balance remains
    # the (unprorated) fallback for a leave type added after this employee
    # was already hired.
    leave_types = (await db.execute(select(LeaveType).where(LeaveType.is_active.is_(True)))).scalars().all()
    for lt in leave_types:
        quota = calculate_prorated_starting_balance(row.joining_date, fy.end_date, lt.default_annual_quota_days)
        db.add(LeaveBalance(
            id=str(uuid.uuid4()), employee_id=row.id, leave_type_id=lt.id, financial_year_id=fy.id,
            allowed_days=quota.allowed_days, is_quota_tracked=lt.is_quota_tracked,
            default_annual_quota_snapshot=lt.default_annual_quota_days,
            carry_forward_allowed_snapshot=lt.carry_forward_allowed, max_carry_forward_days_snapshot=lt.max_carry_forward_days,
            prorated_from_date=row.joining_date, proration_months=quota.proration_months,
            created_by=current_user.id, updated_by=current_user.id,
        ))

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Duplicate email/code or invalid reference") from exc
    await db.refresh(row)
    # response_model was EmployeeOut (a strict schema) — left as-is, FastAPI's
    # own response serialization would re-validate this dict against
    # EmployeeOut and choke on any field masking just removed/replaced, or
    # silently re-add a field hidden a moment ago. Masking has to be the last
    # step before the response leaves this function, so response_model is
    # None here and the dict returned below IS the response body.
    return _masked_employee(row, perms)


# ============================================================= MY PROFILE
# Registered ahead of /{employee_id} so 'me' never resolves as a path id.
#
# NOT wired to apply_field_masking, deliberately — verified, not assumed:
# employee.my_profile has ZERO possible sensitive fields. It carries no
# entry at all in app/rbac/field_manifest.json (only "employee.directory"
# and "employee.master_record" appear there), and its ScreenDef in
# app/rbac/registry/screens.py declares no hand-curated sensitive_fields
# tuple either. RolePermissionField rows are the only thing that ever
# populates PermissionSet.field_modes, and rbac_admin.py's own field-grant
# endpoint validates every field_key against that screen's
# ScreenSensitiveField rows before allowing a RolePermissionField write —
# with zero ScreenSensitiveField rows for this screen, no such grant can
# ever exist through the normal admin path. So for every endpoint below
# gated on MY_PROFILE (get/update /me, change-request create/list/decide,
# the dashboard, and the HR change-request queue), perms.field_modes is
# always {} and apply_field_masking(payload, perms) would be a guaranteed,
# permanent no-op — masking.py's own early return confirms this
# (`if not perms.field_modes: return payload`). Left un-wired rather than
# adding dead calls; if my_profile's manifest is ever regenerated with real
# fields, this is the block to revisit.
@router.get("/me", response_model=EmployeeOut)
async def get_my_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE)),
) -> Employee:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    return await db.get(Employee, own_id)


@router.put("/me", response_model=EmployeeOut)
async def update_my_profile(
    body: MyProfileEditableWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE, action="edit")),
) -> Employee:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    row = await db.get(Employee, own_id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return row


@router.post("/me/change-requests", response_model=ProfileChangeRequestOut, status_code=status.HTTP_201_CREATED)
async def request_profile_change(
    body: ProfileChangeRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE, action="request_change")),
) -> ProfileChangeRequest:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    field_key = body.field_key.upper()
    if field_key not in {f.upper() for f in PROFILE_CHANGE_REQUEST_FIELDS}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"'{body.field_key}' cannot be changed via a Profile Change Request")
    if (field_key == "STATUTORY_IDENTIFIER") != (body.target_tax_head_id is not None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_tax_head_id is required for, and only for, a STATUTORY_IDENTIFIER request")

    employee = await db.get(Employee, own_id)
    if field_key == "STATUTORY_IDENTIFIER":
        existing_identifier = (
            await db.execute(
                select(EmployeeStatutoryIdentifier).where(
                    EmployeeStatutoryIdentifier.employee_id == own_id, EmployeeStatutoryIdentifier.tax_head_id == body.target_tax_head_id
                )
            )
        ).scalar_one_or_none()
        old_value = existing_identifier.identifier_value if existing_identifier else None
    else:
        old_value = getattr(employee, field_key.lower(), None)
    row = ProfileChangeRequest(
        id=str(uuid.uuid4()),
        employee_id=own_id,
        requested_by_user_id=current_user.id,
        field_key=field_key,
        target_tax_head_id=body.target_tax_head_id,
        old_value=str(old_value) if old_value is not None else None,
        requested_value=body.requested_value,
        employee_note=body.employee_note,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A pending change request already exists for this field") from exc
    await db.refresh(row)
    return row


@router.get("/me/change-requests", response_model=list[ProfileChangeRequestOut])
async def list_my_change_requests(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE)),
) -> list[ProfileChangeRequest]:
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        return []
    rows = (await db.execute(select(ProfileChangeRequest).where(ProfileChangeRequest.employee_id == own_id))).scalars().all()
    return list(rows)


@router.get("/me/dashboard")
async def get_my_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE)),
) -> dict:
    """Employee §2.10 Employee Dashboard — the landing screen right after
    login. Widgets per §2.10's table: leave balance snapshot (§2.4), latest
    payslip mini-card (§2.5), open tickets/pending tasks/assigned assets
    counts (§2.7/§2.8/§2.9), a company announcements mini feed (§2.11),
    a recent activity feed (this project's Notification rows are exactly the
    "system-generated entries" §2.10 describes), and quick links into every
    self-service screen.

    Gated on employee.my_profile (mode "full" for all 5 roles, per the
    registry's own "always own scope in practice" comment) rather than a new
    screen — §2.10 itself says "All 5 roles" with only the Manager strip
    varying, the same self-service-baseline shape my_profile already governs.

    Manager's "My Team" strip (§2.10, additive) is gated on the caller's
    actual role, not perms.mode — every role's employee.my_profile mode is
    "full", so mode alone can't distinguish a Manager here the way it does
    on Directory/Master Record.
    """
    from app.models.asset import Asset
    from app.models.employee import Announcement, AnnouncementTarget, Notification
    from app.models.leave import LeaveRequest
    from app.models.payroll import Payslip
    from app.models.project import Bug, Task
    from app.models.ticket import Ticket

    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No Employee record is linked to this login")
    employee = await db.get(Employee, own_id)

    # ---- Leave balance snapshot (§2.4's table, mini version) ----
    fy = await get_current_financial_year(db)
    balances = (
        await db.execute(select(LeaveBalance).where(LeaveBalance.employee_id == own_id, LeaveBalance.financial_year_id == fy.id))
    ).scalars().all()
    leave_type_ids = {b.leave_type_id for b in balances}
    leave_type_names = (
        {lt.id: lt.name for lt in (await db.execute(select(LeaveType).where(LeaveType.id.in_(leave_type_ids)))).scalars().all()}
        if leave_type_ids else {}
    )
    leave_balance_snapshot = [
        {
            "leave_type": leave_type_names.get(b.leave_type_id, ""),
            "allowed_days": b.allowed_days, "taken_days": b.taken_days,
            "pending_days": b.pending_days, "remaining_days": b.remaining_days,
        }
        for b in balances
    ]

    # ---- Latest payslip mini-card (§2.5) ----
    latest_payslip = (
        await db.execute(
            select(Payslip).where(Payslip.employee_id == own_id)
            .order_by(Payslip.period_year.desc(), Payslip.period_month.desc()).limit(1)
        )
    ).scalar_one_or_none()
    latest_payslip_card = (
        {
            "payslip_id": latest_payslip.id, "period_month": latest_payslip.period_month,
            "period_year": latest_payslip.period_year, "net_pay": latest_payslip.net_pay,
            "salary_credit_date": latest_payslip.salary_credit_date,
        }
        if latest_payslip is not None else None
    )

    # ---- Open tickets / pending tasks / assigned assets counts (§2.7-§2.9) ----
    open_tickets_count = len(
        (await db.execute(select(Ticket.id).where(Ticket.assigned_to == own_id, Ticket.status.in_(("OPEN", "IN_PROGRESS"))))).all()
    )
    # "My Tasks & Bugs" (§2.8) is a single combined list of work items assigned to the
    # caller — mirror GET /employees/me/tasks-and-bugs by counting both Task and Bug
    # rows here so this widget's count matches the screen its quick_link points at.
    pending_tasks_count = len(
        (await db.execute(select(Task.id).where(Task.assignee_id == own_id, Task.status != "DONE"))).all()
    ) + len(
        (await db.execute(select(Bug.id).where(Bug.assignee_id == own_id, Bug.status.notin_(("FIXED", "CLOSED"))))).all()
    )
    assigned_assets_count = len(
        (await db.execute(select(Asset.id).where(Asset.assigned_to == own_id, Asset.status == "IN_USE"))).all()
    )

    # ---- Company announcements mini feed (§2.11) — published, not expired,
    # scoped to ALL_EMPLOYEES or this employee's own department. ----
    today = date.today()
    candidates = (
        await db.execute(
            select(Announcement).where(Announcement.status == "PUBLISHED")
            .where((Announcement.expiry_date.is_(None)) | (Announcement.expiry_date >= today))
            .order_by(Announcement.published_at.desc()).limit(20)
        )
    ).scalars().all()
    dept_target_ann_ids = set(
        (
            await db.execute(
                select(AnnouncementTarget.announcement_id).where(AnnouncementTarget.department_id == employee.department_id)
            )
        ).scalars().all()
    )
    recent_announcements = [
        {"id": a.id, "title": a.title, "message": a.message, "published_at": a.published_at}
        for a in candidates if a.target_scope == "ALL_EMPLOYEES" or a.id in dept_target_ann_ids
    ][:5]

    # ---- Recent activity feed — this project's Notification rows ----
    recent_notifications = (
        await db.execute(
            select(Notification).where(Notification.recipient_user_id == current_user.id)
            .order_by(Notification.created_at.desc()).limit(10)
        )
    ).scalars().all()
    recent_activity = [
        {"type": n.notification_type, "title": n.title, "body": n.body, "created_at": n.created_at, "is_read": n.is_read}
        for n in recent_notifications
    ]

    quick_links = [
        {"screen": "employee.my_profile", "label": "My Profile", "path": "/employees/me"},
        {"screen": "leave.my_leave", "label": "My Leave", "path": "/leave/balances"},
        {"screen": "payroll.my_payslips", "label": "My Payslips", "path": "/payroll/payslips/me"},
        {"screen": "employee.documents", "label": "My Documents", "path": f"/employees/{own_id}/documents"},
        {"screen": "employee.my_tickets", "label": "My Tickets", "path": "/employees/me/tickets"},
        {"screen": "employee.my_projects_tasks", "label": "My Projects & Tasks", "path": "/employees/me/tasks-and-bugs"},
        {"screen": "employee.my_assets", "label": "My Assets", "path": "/employees/me/assets"},
        {"screen": "employee.announcements", "label": "Announcements", "path": "/announcements"},
    ]

    result: dict = {
        "leave_balance_snapshot": leave_balance_snapshot,
        "latest_payslip": latest_payslip_card,
        "open_tickets_count": open_tickets_count,
        "pending_tasks_count": pending_tasks_count,
        "assigned_assets_count": assigned_assets_count,
        "announcements": recent_announcements,
        "recent_activity": recent_activity,
        "quick_links": quick_links,
    }

    # ---- Manager's "My Team" strip (§2.10, additive) ----
    role = await db.get(Role, current_user.role_id)
    if role is not None and role.code == "MANAGER":
        reports = await org_scope.get_direct_report_employee_ids(db, own_id)
        pending_team_leave_count = 0
        open_team_tickets_count = 0
        if reports:
            pending_team_leave_count = len(
                (
                    await db.execute(
                        select(LeaveRequest.id).where(LeaveRequest.employee_id.in_(reports), LeaveRequest.status == "PENDING")
                    )
                ).all()
            )
            open_team_tickets_count = len(
                (
                    await db.execute(
                        select(Ticket.id).where(Ticket.assigned_to.in_(reports), Ticket.status.in_(("OPEN", "IN_PROGRESS")))
                    )
                ).all()
            )
        result["my_team"] = {
            "pending_leave_requests_count": pending_team_leave_count,
            "open_tickets_count": open_team_tickets_count,
        }

    return result


@router.get("/change-requests", response_model=list[ProfileChangeRequestOut])
async def list_change_request_queue(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE, action="approve_change")),
    status_filter: str | None = Query("PENDING", alias="status"),
) -> list[ProfileChangeRequest]:
    stmt = select(ProfileChangeRequest)
    if status_filter:
        stmt = stmt.where(ProfileChangeRequest.status == status_filter)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/change-requests/{request_id}/decide", response_model=ProfileChangeRequestOut)
async def decide_change_request(
    request_id: str,
    body: ProfileChangeDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MY_PROFILE, action="approve_change")),
) -> ProfileChangeRequest:
    row = await db.get(ProfileChangeRequest, request_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This request has already been decided")
    if not body.approve and not (body.decision_reason and body.decision_reason.strip()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to reject a change request")

    row.status = "APPROVED" if body.approve else "REJECTED"
    row.decided_by = current_user.id
    row.decided_at = datetime.now(timezone.utc)
    row.decision_reason = body.decision_reason
    row.updated_by = current_user.id

    if body.approve and row.field_key == "STATUTORY_IDENTIFIER":
        # Found dead by the Phase 2 audit: this branch used to just skip
        # applying entirely, so an approved statutory-identifier request
        # never actually reached the employee's record.
        await _upsert_statutory_identifier(db, row.employee_id, row.target_tax_head_id, row.requested_value, current_user.id)
        row.applied_at = datetime.now(timezone.utc)
    elif body.approve:
        employee = await db.get(Employee, row.employee_id)
        target_field = row.field_key.lower()
        value: object = row.requested_value
        if target_field == "date_of_birth":
            value = date.fromisoformat(row.requested_value)
        setattr(employee, target_field, value)
        employee.updated_by = current_user.id
        row.applied_at = datetime.now(timezone.utc)

    notified_employee = await db.get(Employee, row.employee_id)
    notify(
        db, recipient_user_id=notified_employee.user_id, notification_type="PROFILE_CHANGE", actor_user_id=current_user.id,
        title=f"Profile change {row.status.lower()}",
        body=f"Your request to change {row.field_key.replace('_', ' ').title()} was {row.status.lower()}." + (f" Reason: {row.decision_reason}" if row.decision_reason else ""),
        source_module="employee", source_record_id=row.id,
    )

    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)

    await email_transport.send_templated_email(
        db, "profile_change_approved" if row.status == "APPROVED" else "profile_change_rejected",
        notified_employee.email, {"first_name": notified_employee.first_name},
        related_record_type="profile_change_request", related_record_id=row.id,
    )

    return row


# ============================================================= MASTER RECORD
@router.get("/{employee_id}", response_model=None)
async def get_employee(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD)),
) -> dict:
    row = await db.get(Employee, employee_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    return _masked_employee(row, perms)


@router.put("/{employee_id}", response_model=None)
async def update_employee(
    employee_id: str,
    body: EmployeeWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> dict:
    row = await db.get(Employee, employee_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Duplicate email or invalid reference") from exc
    await db.refresh(row)
    return _masked_employee(row, perms)


# --------------------------------------------------------- Emergency Contacts
# Same MASTER_RECORD screen as the record itself (this module's docstring:
# "Personal/Employment/Bank/Emergency Contact/... tabs"), so the same `perms`
# governs these rows too — wired through apply_field_masking for the same
# defense-in-depth reason as the record endpoints above, even though
# field_manifest.json's current employee.master_record entry has no
# contact_name/contact_phone keys yet (so this is a no-op today, not a
# behaviour change) — it becomes correct automatically the day that manifest
# is regenerated to cover the Emergency Contact tab's own fields, with no
# further router change needed.
@router.get("/{employee_id}/emergency-contacts", response_model=None)
async def list_emergency_contacts(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD)),
) -> list[dict]:
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    rows = (
        await db.execute(select(EmployeeEmergencyContact).where(EmployeeEmergencyContact.employee_id == employee_id))
    ).scalars().all()
    return [apply_field_masking(EmergencyContactOut.model_validate(r).model_dump(), perms) for r in rows]


@router.post("/{employee_id}/emergency-contacts", response_model=None, status_code=status.HTTP_201_CREATED)
async def add_emergency_contact(
    employee_id: str,
    body: EmergencyContactWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> dict:
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    row = EmployeeEmergencyContact(
        id=str(uuid.uuid4()), employee_id=employee_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump()
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Only one contact may be marked Primary") from exc
    await db.refresh(row)
    return apply_field_masking(EmergencyContactOut.model_validate(row).model_dump(), perms)


@router.put("/{employee_id}/emergency-contacts/{contact_id}", response_model=None)
async def update_emergency_contact(
    employee_id: str,
    contact_id: str,
    body: EmergencyContactWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> dict:
    row = await db.get(EmployeeEmergencyContact, contact_id)
    if row is None or row.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Only one contact may be marked Primary") from exc
    await db.refresh(row)
    return apply_field_masking(EmergencyContactOut.model_validate(row).model_dump(), perms)


@router.delete("/{employee_id}/emergency-contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_emergency_contact(
    employee_id: str,
    contact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> None:
    row = await db.get(EmployeeEmergencyContact, contact_id)
    if row is None or row.employee_id != employee_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    await db.delete(row)
    await db.commit()


# ------------------------------------------------------ Statutory Identifiers
# Employee §2.2 Bank & Statutory tab: "renders one text field for every tax
# head ... with 'Requires an Employee Identifier' set to Yes." Found with a
# full DB table and zero API surface by the Phase 2 audit.
@router.get("/{employee_id}/statutory-identifiers", response_model=None)
async def list_statutory_identifiers(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD)),
) -> list[dict]:
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    rows = (
        await db.execute(select(EmployeeStatutoryIdentifier).where(EmployeeStatutoryIdentifier.employee_id == employee_id))
    ).scalars().all()
    # identifier_value carries the same PAN/Aadhaar-grade PII the master
    # record's own aadhaar_number/pan_number columns do (§2.2 Bank & Statutory
    # tab) — masked through the same MASTER_RECORD `perms` for the same
    # reason the record and emergency-contact endpoints above are; a no-op
    # today only because field_manifest.json doesn't yet carry an
    # "identifier_value" key for this screen (see the Emergency Contacts note
    # above — same situation, same fix-forward path).
    return [apply_field_masking(StatutoryIdentifierOut.model_validate(r).model_dump(), perms) for r in rows]


@router.put("/{employee_id}/statutory-identifiers/{tax_head_id}", response_model=None)
async def set_statutory_identifier(
    employee_id: str,
    tax_head_id: str,
    body: StatutoryIdentifierWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="edit")),
) -> dict:
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    row = await _upsert_statutory_identifier(db, employee_id, tax_head_id, body.identifier_value, current_user.id)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return apply_field_masking(StatutoryIdentifierOut.model_validate(row).model_dump(), perms)


@router.get("/{employee_id}/login-status", response_model=None)
async def get_login_status(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD)),
) -> dict | None:
    """§2.2's Set Role / Must Change Password on Next Login / Last Login —
    see LoginStatusOut's own docstring for why this is a separate read.
    Returns null when the employee has no login yet (employee.user_id is
    None), which the frontend reads as "Create Login" mode.
    """
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    if employee.user_id is None:
        return None
    user = await db.get(User, employee.user_id)
    role = await db.get(Role, user.role_id)
    return LoginStatusOut(
        is_enabled=user.is_enabled,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        role_name=role.name if role else user.role_id,
    ).model_dump()


# --------------------------------------------------------------- Login mgmt
# Employee §2.2 / Workflow 3.6: "HR never sees or relays the password
# itself — it goes straight to the employee." Phase 6 wires real Mailgun/
# SMTP dispatch (app.services.email_transport) — create-login and
# reset-password now email the temporary password instead of returning it;
# the response only confirms the action happened (CreateLoginOut.
# temporary_password stays on the shape but is always None, see the schema).
@router.post("/{employee_id}/create-login", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_login(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="manage_login")),
    role_code: str = Query("EMPLOYEE", description="Role granted to the new login"),
) -> dict:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    if employee.user_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This employee already has a login")

    role = (await db.execute(select(Role).where(Role.code == role_code))).scalar_one_or_none()
    if role is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown role code '{role_code}'")

    temp_password = secrets.token_urlsafe(9)
    user = User(
        id=str(uuid.uuid4()),
        email=employee.email,
        password_hash=hash_password(temp_password),
        full_name=f"{employee.first_name} {employee.last_name or ''}".strip(),
        role_id=role.id,
        must_change_password=True,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(user)
    await db.flush()

    employee.user_id = user.id
    employee.login_created_at = datetime.now(timezone.utc)
    employee.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A login already exists for this email") from exc

    await email_transport.send_templated_email(
        db, "temporary_password", employee.email, {"first_name": employee.first_name, "temp_password": temp_password},
        related_record_type="employee", related_record_id=employee.id,
    )
    # CreateLoginOut.email carries the same "email" field_key employee.
    # master_record's manifest already governs on the record itself — masked
    # here too so a role with email hidden/masked on Master Record doesn't
    # get it handed back unmasked just because this is a different response
    # shape for the same underlying employee.
    return apply_field_masking(CreateLoginOut(user_id=user.id, email=user.email, temporary_password=None).model_dump(), perms)


@router.post("/{employee_id}/disable-login", response_model=None)
async def disable_login(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="manage_login")),
) -> dict:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    if employee.user_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This employee has no login to disable")

    user = await db.get(User, employee.user_id)
    user.is_enabled = False
    user.updated_by = current_user.id
    employee.login_removed_at = datetime.now(timezone.utc)
    employee.updated_by = current_user.id
    # Phase 7 hardening round 2: is_enabled already blocks the next login
    # attempt, but a refresh token issued before this moment would keep
    # minting fresh 15-minute access tokens forever without this — the
    # whole point of a revocable session.
    await auth_tokens.revoke_all_refresh_tokens(db, user.id)
    await db.commit()
    await db.refresh(employee)
    return _masked_employee(employee, perms)


@router.post("/{employee_id}/enable-login", response_model=None)
async def enable_login(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="manage_login")),
) -> dict:
    """Reverses disable-login (Employee §2.2: Disable is a toggle, distinct
    from a stronger, separate "remove access" action) — found missing by the
    Phase 2 audit: disable_login had no way back, permanently locking out
    anyone disabled by mistake, since create_login also refuses to run again
    once employee.user_id is set.
    """
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    if employee.user_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This employee has no login to enable")

    user = await db.get(User, employee.user_id)
    if user.is_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Login is already enabled")
    user.is_enabled = True
    user.updated_by = current_user.id
    employee.login_removed_at = None
    employee.updated_by = current_user.id
    await db.commit()
    await db.refresh(employee)
    return _masked_employee(employee, perms)


@router.post("/{employee_id}/reset-password", response_model=None)
async def reset_password(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(MASTER_RECORD, action="manage_login")),
) -> dict:
    """Employee §2.2's "Reset Password" button — generates a fresh temporary
    password and forces a change on next login. Found missing entirely by
    the Phase 2 audit. Same "HR never sees the password" rule as
    create_login — Phase 6 emails it instead of returning it.

    The seeded "password_reset" template's only placeholder is
    {{reset_link}} (a click-a-link flow) but this endpoint's actual flow has
    never generated a reset link/token — it issues a temporary password, the
    same mechanism create_login uses. Rather than inventing a new
    token/URL scheme not asked for here, the temporary password is passed
    through the template's existing {{reset_link}} placeholder — the
    "same info that was being returned" before, just emailed instead of
    returned. If a genuine link-based reset flow is ever built, this call
    site is the one to revisit.
    """
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    if employee.user_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This employee has no login to reset")

    user = await db.get(User, employee.user_id)
    await auth_tokens.issue_temporary_password(
        db, user, employee_first_name=employee.first_name, employee_email=employee.email,
        employee_id=employee.id, actor_id=current_user.id,
    )
    # Same "email" field_key overlap with employee.master_record's manifest
    # as create_login above.
    return apply_field_masking(CreateLoginOut(user_id=user.id, email=user.email, temporary_password=None).model_dump(), perms)
