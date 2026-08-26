"""Employee §2.9 Onboarding Checklist, §2.13 Offboarding / Exit (Resignation
+ Exit Checklist), §2.15 Offer & Appointment Letter.

Exit checklist gating is THE Phase 2 acceptance criterion and lives as a real
trigger (trg_ecs_enforce_gate). Cascade-unlock — opening the step(s) gated by
the one that just completed — is deliberately app-layer (MySQL forbids a
trigger from updating another row of the same table it fires on), performed
here as a second UPDATE immediately after the completing step's own UPDATE
commits, mirroring the migration's own documented split.

employees.employment_status -> 'EXITED' and exit_checklist_steps.status ->
'DONE' for the MARK_EXITED step are two SEPARATE actions, not one: the DB
guard (trg_employees_guard_exit_transition) only requires that step to be
OPEN (not DONE) before the status flip is allowed — mark_exited() below sets
the employment status; completing the step afterwards is a normal call to
complete_exit_step().
"""

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import (
    Employee,
    ExitChecklistStep,
    OfferLetter,
    OfferLetterCustomTerm,
    OnboardingChecklistItem,
    Resignation,
    SalaryStructure,
    SalaryStructureStatutoryLine,
)
from app.models.masters import CompanyProfile, Department, Designation, EmploymentType
from app.models.platform import StoredFile, User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.rbac.scope import apply_scope
from app.schemas.employee import (
    AcknowledgeRequest,
    ExitChecklistStepOut,
    ExitStepActionRequest,
    OfferLetterCreate,
    OfferLetterCustomTermOut,
    OfferLetterCustomTermWrite,
    OfferLetterOut,
    OnboardingCompleteRequest,
    OnboardingItemOut,
    OnboardingQueueRow,
    OnboardingSkipRequest,
    ResignationCreate,
    ResignationOut,
    SendLetterRequest,
)
from app.services import auth_tokens, email_transport, exit_checklist_sync, file_storage, list_export, org_scope, pdf_engine
from app.services.email_transport import Attachment
from app.services.notify import notify
from app.services.numbering import allocate_number, get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(tags=["employee"])
ONBOARDING = "employee.onboarding"
OFFBOARDING = "employee.offboarding"
OFFER_LETTERS = "employee.offer_letters"

_RESIGNATION_LIST_COLUMNS = [
    ColumnSpec("employee_id", "Employee ID"),
    ColumnSpec("status", "Status"),
    ColumnSpec("last_working_day", "Last Working Day"),
    ColumnSpec("submitted_at", "Submitted At"),
    ColumnSpec("manager_acknowledgement_required", "Manager Ack. Required"),
    ColumnSpec("acknowledged_at", "Acknowledged At"),
    ColumnSpec("final_settlement_status", "Final Settlement Status"),
    ColumnSpec("completed_at", "Completed At"),
    ColumnSpec("reason", "Reason"),
]

# prototype's emp.onboardqueue columns (data.js ~line 1034-1040): Employee,
# Joining Date, Department, Steps Completed, Oldest Incomplete Step, Days
# Since Joining. "Days Since Joining" isn't a stored field anywhere — it's
# computed export-side here the same way emp.record.config.ts's own age-like
# columns are computed client-side, just mirrored server-side so the PDF/
# Excel export (which never runs frontend `compute`) still carries it.
_ONBOARDING_QUEUE_COLUMNS = [
    ColumnSpec("employee_code", "Employee Code"),
    ColumnSpec("employee_name", "Employee"),
    ColumnSpec("department_name", "Department"),
    ColumnSpec("joining_date", "Joining Date"),
    ColumnSpec("steps_completed", "Steps Completed"),
    ColumnSpec("oldest_incomplete_step", "Oldest Incomplete Step"),
    ColumnSpec("days_since_joining", "Days Since Joining"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


# A resignation is "live" — its exit checklist, its acceptance letter and its
# final settlement are all actionable — only while it holds one of these.
# WITHDRAWN and COMPLETED are both terminal.
OPEN_RESIGNATION_STATUSES = ("SUBMITTED", "MANAGER_ACKNOWLEDGED", "HR_PROCESSING")


def _assert_not_withdrawn(resignation: Resignation) -> None:
    """Every offboarding action downstream of the resignation itself has to
    re-check the parent, not just its own row's status. Found live: after
    POST /resignations/{id}/withdraw, HR could still generate and send the
    Resignation Acceptance Letter, tick every exit checklist step DONE and
    drive the final settlement NOT_DUE -> DUE -> PAID, because withdraw only
    flipped resignations.status and each downstream handler looked no
    further than `step.status == 'OPEN'` / `final_settlement_status ==
    'DUE'`. Only the very last hop (employment_status -> EXITED) was
    protected, by trg_employees_guard_exit_transition in the DB.

    Deliberately narrow — WITHDRAWN only, not "any terminal status": a final
    settlement is routinely paid after the employee has already exited and
    the resignation reads COMPLETED, so that case must keep working.
    """
    if resignation.status == "WITHDRAWN":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This resignation has been withdrawn — its exit workflow is closed")


# =============================================================== ONBOARDING
@router.get("/employees/{employee_id}/onboarding", response_model=list[OnboardingItemOut])
async def list_onboarding_items(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(ONBOARDING)),
) -> list[OnboardingChecklistItem]:
    rows = (
        await db.execute(
            select(OnboardingChecklistItem).where(OnboardingChecklistItem.employee_id == employee_id).order_by(OnboardingChecklistItem.ordinal)
        )
    ).scalars().all()
    return list(rows)


def _oldest_incomplete_label(step_key: str) -> str:
    return step_key.replace("_", " ").title()


@router.get("/onboarding-queue", response_model=None)
async def list_onboarding_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ONBOARDING)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[OnboardingQueueRow] | Response:
    """HR/Super Admin's cross-employee onboarding queue (prototype's
    emp.onboardqueue) — every employee currently mid-onboarding, i.e. whose
    onboarding_checklist_items don't yet have every step COMPLETE or
    SKIPPED. `employee.onboarding` has has_scope=False (screens.py:140) —
    same as the per-employee GET /employees/{id}/onboarding this reuses the
    checklist data of — so require_screen(ONBOARDING) alone is the right
    gate, no apply_scope needed.

    Built by grouping OnboardingChecklistItem rows in Python rather than a
    GROUP BY/HAVING query: at 7 rows/employee this is a small in-memory
    fan-out, and the "oldest incomplete step" figure (lowest-ordinal PENDING
    item) needs the individual rows anyway, not just aggregate counts.

    Department is an OUTER join deliberately, not an inner one — an
    employee whose department_id fails to resolve to a live Department row
    (a data-integrity gap, not this endpoint's concern) must still surface
    here rather than silently vanish from HR's onboarding queue; found live
    while verifying this endpoint against the dev DB, where every seeded
    employee's department_id turned out to be a stale id no current
    Department row has (confirmed separately from this task's own scope).
    """
    rows = (
        await db.execute(
            select(OnboardingChecklistItem, Employee, Department)
            .join(Employee, OnboardingChecklistItem.employee_id == Employee.id)
            .outerjoin(Department, Employee.department_id == Department.id)
            .order_by(Employee.id, OnboardingChecklistItem.ordinal)
        )
    ).all()

    grouped: dict[str, list[tuple[OnboardingChecklistItem, Employee, Department | None]]] = {}
    for item, employee, department in rows:
        grouped.setdefault(employee.id, []).append((item, employee, department))

    today = date.today()
    queue: list[OnboardingQueueRow] = []
    for entries in grouped.values():
        total = len(entries)
        done = sum(1 for item, _, _ in entries if item.status in ("COMPLETE", "SKIPPED"))
        if done >= total:
            continue  # fully onboarded — not this queue's concern
        employee = entries[0][1]
        department = entries[0][2]
        oldest_incomplete = next((item for item, _, _ in entries if item.status == "PENDING"), None)
        queue.append(
            OnboardingQueueRow(
                employee_id=employee.id,
                employee_code=employee.employee_code,
                employee_name=f"{employee.first_name} {employee.last_name or ''}".strip(),
                department_id=employee.department_id,
                department_name=department.name if department is not None else "—",
                joining_date=employee.joining_date,
                steps_completed=done,
                steps_total=total,
                oldest_incomplete_step=oldest_incomplete.step_key if oldest_incomplete else None,
            )
        )
    queue.sort(key=lambda r: r.joining_date)  # longest-waiting joiners surface first

    if format:
        export_rows = [
            {
                "employee_code": r.employee_code,
                "employee_name": r.employee_name,
                "department_name": r.department_name,
                "joining_date": r.joining_date,
                "steps_completed": f"{r.steps_completed}/{r.steps_total}",
                "oldest_incomplete_step": _oldest_incomplete_label(r.oldest_incomplete_step) if r.oldest_incomplete_step else "—",
                "days_since_joining": (today - r.joining_date).days,
            }
            for r in queue
        ]
        return await list_export.build_export(format, db, current_user, "Onboarding Queue", _ONBOARDING_QUEUE_COLUMNS, export_rows, {})

    return queue


@router.post("/onboarding-items/{item_id}/complete", response_model=OnboardingItemOut)
async def complete_onboarding_item(
    item_id: str,
    body: OnboardingCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ONBOARDING, action="edit")),
) -> OnboardingChecklistItem:
    row = await db.get(OnboardingChecklistItem, item_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already actioned")
    row.status = "COMPLETE"
    row.completed_by = current_user.id
    row.note = body.note
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/onboarding-items/{item_id}/skip", response_model=OnboardingItemOut)
async def skip_onboarding_item(
    item_id: str,
    body: OnboardingSkipRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ONBOARDING, action="edit")),
) -> OnboardingChecklistItem:
    row = await db.get(OnboardingChecklistItem, item_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already actioned")
    row.status = "SKIPPED"
    row.skipped_reason = body.skipped_reason
    row.completed_by = current_user.id
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/employees/{employee_id}/send-welcome-email", response_model=OnboardingItemOut)
async def send_welcome_email(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(ONBOARDING, action="send_welcome_email")),
) -> OnboardingChecklistItem:
    # Real email dispatch is Phase 6 (Mailgun wiring) — this records the send
    # and clears the checklist item, the same "the action is real, the
    # transport is stubbed" split as masters.email_configuration's send_test.
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    item = (
        await db.execute(
            select(OnboardingChecklistItem).where(
                OnboardingChecklistItem.employee_id == employee_id, OnboardingChecklistItem.step_key == "SEND_WELCOME_EMAIL"
            )
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if item.status != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Welcome email already sent")

    employee.welcome_email_sent_at = datetime.now(timezone.utc)
    employee.welcome_email_sent_by = current_user.id
    employee.updated_by = current_user.id
    item.status = "COMPLETE"
    item.completed_by = current_user.id
    item.updated_by = current_user.id

    # notify()'s title/body below are literal strings it just persists as-is
    # (app/services/notify.py has no Masters-driven source to resolve
    # against) — unlike send_templated_email() further down, which reads
    # Masters -> Email Templates. Invariant 12 (email_transport.py's
    # docstring; masters_email_config.py:201) already establishes that
    # disabling an EmailTemplate silences only the email side, never this
    # in-app notification, so EmailTemplate's subject/body can't just be
    # reused here as-is. The same unsourced-literal pattern repeats at ~15
    # other notify() call sites across the backend (assets.py,
    # compensatory_hours.py, credit_notes.py, employee_documents.py,
    # employees.py, expenses.py, leave_requests.py, payroll_runs.py,
    # payslips.py, tickets.py) — fixing the wording here alone would just
    # split one concept across two patterns. What's needed first is either a
    # Notification Templates registry (mirroring EmailTemplate) or an
    # extension of EmailTemplate with a notification title/body variant,
    # built once and adopted at every call site together. The one thing that
    # IS fixed here in the meantime: the company name is no longer a literal
    # ("Meshrd") — it now reads CompanyProfile.legal_name, same singleton row
    # pdf_engine.company_logo_bytes() reads elsewhere in this file.
    #
    # notification_type is 'ONBOARDING', not 'EMPLOYEE': notifications.
    # ck_notif_type has no 'EMPLOYEE' member, so the row this call adds used
    # to be rejected by the CHECK on an UNGUARDED second commit that ran
    # AFTER the checklist item had already been committed COMPLETE — HR got
    # a 500 on an action that had actually run, the step was stuck COMPLETE
    # (409 on every retry), and the in-app notification was never created.
    # This whole endpoint is one onboarding step, so it now writes the item,
    # the employee stamp and the notification in a SINGLE commit — either
    # all of it lands or none of it does — and the email dispatches only
    # after that commit succeeds.
    company = (await db.execute(select(CompanyProfile))).scalar_one_or_none()
    notify(
        db, recipient_user_id=employee.user_id, notification_type="ONBOARDING",
        title=f"Welcome to {company.legal_name if company else 'the company'}",
        body=f"Welcome aboard, {employee.first_name}! Your onboarding has begun.",
        source_module="employee", source_record_id=employee.id, actor_user_id=current_user.id,
    )
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(item)

    await email_transport.send_templated_email(
        db, "welcome_email", employee.email, {"first_name": employee.first_name},
        related_record_type="employee", related_record_id=employee.id,
    )

    return item


# ============================================================== OFFBOARDING
@router.post("/employees/{employee_id}/resignations", response_model=ResignationOut, status_code=status.HTTP_201_CREATED)
async def raise_resignation(
    employee_id: str,
    body: ResignationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="raise_resignation")),
) -> Resignation:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # "Raise own resignation" is self-only for EVERY role (Employee §2.13's
    # access table: "Yes" across all 5) — including Manager, whose "team"
    # mode on this screen exists for the separate *acknowledge* action, not
    # this one. Only HR/Super Admin's "full" mode is a deliberate admin
    # override (recording a resignation on someone's behalf). Found missing
    # for "team" by the Phase 2 audit: the original check only excluded
    # "own" mode, so a Manager could raise a resignation against any
    # employee_id, not just their own.
    if perms.mode in ("own", "team"):
        own_id = await org_scope.get_own_employee_id(db, current_user)
        if own_id != employee_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only raise your own resignation")

    fy = await get_current_financial_year(db)
    row = Resignation(
        id=str(uuid.uuid4()), employee_id=employee_id, financial_year_id=fy.id,
        submitted_at=datetime.now(timezone.utc), submitted_by_user_id=current_user.id,
        manager_acknowledgement_required=employee.reporting_manager_id is not None,
        # ARCH-1 §resignations: final_last_working_day is "the date fixed by
        # the resignation acceptance letter... Defaults from last_working_day".
        # Nothing in app/ ever wrote it, so it read back NULL on every row
        # including COMPLETED ones — the default is seeded here and the letter
        # re-stamps it in generate_offer_letter() when HR fixes a different date.
        final_last_working_day=body.last_working_day,
        created_by=current_user.id, updated_by=current_user.id, **body.model_dump(),
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This employee already has an open resignation") from exc
    await db.refresh(row)
    return row


@router.get("/employees/{employee_id}/resignations", response_model=list[ResignationOut])
async def list_employee_resignations(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING)),
) -> list[Resignation]:
    await org_scope.assert_employee_in_scope(db, current_user, perms, employee_id)
    rows = (await db.execute(select(Resignation).where(Resignation.employee_id == employee_id))).scalars().all()
    return list(rows)


@router.get("/resignations", response_model=None)
async def list_resignations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ResignationOut] | Response:
    stmt = select(Resignation)
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if perms.mode in ("team",):
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        stmt = apply_scope(stmt, perms, owner_column=Resignation.employee_id, owner_id=own_id, team_member_ids=reports)
    elif perms.mode == "own":
        stmt = apply_scope(stmt, perms, owner_column=Resignation.employee_id, owner_id=own_id)
    rows = list((await db.execute(stmt)).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the scoped set on screen — same rows
        # the JSON branch below would return for this caller, just re-shaped.
        export_rows = [
            {
                "employee_id": r.employee_id, "status": r.status, "last_working_day": r.last_working_day,
                "submitted_at": r.submitted_at, "manager_acknowledgement_required": r.manager_acknowledgement_required,
                "acknowledged_at": r.acknowledged_at, "final_settlement_status": r.final_settlement_status,
                "completed_at": r.completed_at, "reason": r.reason,
            }
            for r in rows
        ]
        return await list_export.build_export(format, db, current_user, "Resignations", _RESIGNATION_LIST_COLUMNS, export_rows, {})

    return [ResignationOut.model_validate(r) for r in rows]


@router.post("/resignations/{resignation_id}/acknowledge", response_model=ResignationOut)
async def acknowledge_resignation(
    resignation_id: str,
    body: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="acknowledge")),
) -> Resignation:
    row = await db.get(Resignation, resignation_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "SUBMITTED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already acknowledged or no longer open")
    if perms.mode == "team":
        own_id = await org_scope.get_own_employee_id(db, current_user)
        reports = await org_scope.get_direct_report_employee_ids(db, own_id) if own_id else []
        if row.employee_id not in reports:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not one of your direct reports")

    row.status = "MANAGER_ACKNOWLEDGED"
    row.acknowledged_by_user_id = current_user.id
    row.acknowledged_at = datetime.now(timezone.utc)
    row.acknowledgement_note = body.acknowledgement_note
    row.updated_by = current_user.id
    await db.flush()
    # Cascade-unlock, app-layer: step 1 opens once acknowledgement clears it.
    await db.execute(
        update(ExitChecklistStep)
        .where(ExitChecklistStep.resignation_id == resignation_id, ExitChecklistStep.step_key == "RESIGNATION_ACCEPTANCE_LETTER", ExitChecklistStep.status == "LOCKED")
        .values(status="OPEN")
    )
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/resignations/{resignation_id}/start-processing", response_model=ResignationOut)
async def start_processing_resignation(
    resignation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="process_exit")),
) -> Resignation:
    row = await db.get(Resignation, resignation_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status not in ("SUBMITTED", "MANAGER_ACKNOWLEDGED"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Cannot start processing from this state")
    row.status = "HR_PROCESSING"
    row.exit_checklist_activated_at = datetime.now(timezone.utc)
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/resignations/{resignation_id}/mark-settlement-paid", response_model=ResignationOut)
async def mark_settlement_paid(
    resignation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="process_exit")),
) -> Resignation:
    row = await db.get(Resignation, resignation_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_not_withdrawn(row)
    if row.final_settlement_status != "DUE":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Settlement must be marked Due first (complete the exit checklist's settlement step)")
    row.final_settlement_status = "PAID"
    row.final_settlement_paid_at = datetime.now(timezone.utc)
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/resignations/{resignation_id}/withdraw", response_model=ResignationOut)
async def withdraw_resignation(
    resignation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING)),
) -> Resignation:
    row = await db.get(Resignation, resignation_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status not in ("SUBMITTED", "MANAGER_ACKNOWLEDGED", "HR_PROCESSING"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This resignation is no longer open")
    own_id = await org_scope.get_own_employee_id(db, current_user)
    if own_id != row.employee_id and not perms.can("process_exit"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the applicant or HR/Super Admin may withdraw a resignation")

    row.status = "WITHDRAWN"
    row.updated_by = current_user.id
    employee = await db.get(Employee, row.employee_id)
    if employee.employment_status == "ON_NOTICE":
        employee.employment_status = "ACTIVE"
        employee.updated_by = current_user.id
    # Stand the exit checklist down with the resignation. Anything still
    # OPEN goes back to LOCKED so it stops presenting itself as actionable
    # work on a resignation the employee retracted; steps already DONE are
    # left alone (they are history, and trg_ecs_enforce_gate forbids moving
    # a DONE step backwards anyway). The status guard in complete_exit_step
    # is the real enforcement — this is what HR's screen reads.
    await db.execute(
        update(ExitChecklistStep)
        .where(ExitChecklistStep.resignation_id == resignation_id, ExitChecklistStep.status == "OPEN")
        .values(status="LOCKED")
    )
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/employees/{employee_id}/mark-exited", response_model=ResignationOut)
async def mark_employee_exited(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="process_exit")),
    exit_date: date | None = None,
) -> Resignation:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    employee.employment_status = "EXITED"
    employee.exit_date = exit_date or date.today()
    employee.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "The exit checklist's Mark Exited step is not open yet") from exc

    row = (
        await db.execute(
            select(Resignation).where(Resignation.employee_id == employee_id, Resignation.status == "HR_PROCESSING")
        )
    ).scalar_one_or_none()
    return row


# ----------------------------------------------------------- Exit Checklist
@router.get("/resignations/{resignation_id}/exit-checklist", response_model=list[ExitChecklistStepOut])
async def list_exit_checklist(
    resignation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING)),
) -> list[ExitChecklistStep]:
    resignation = await db.get(Resignation, resignation_id)
    if resignation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await org_scope.assert_employee_in_scope(db, current_user, perms, resignation.employee_id)
    rows = (
        await db.execute(select(ExitChecklistStep).where(ExitChecklistStep.resignation_id == resignation_id).order_by(ExitChecklistStep.ordinal))
    ).scalars().all()
    return list(rows)


@router.post("/exit-checklist-steps/{step_id}/complete", response_model=ExitChecklistStepOut)
async def complete_exit_step(
    step_id: str,
    body: ExitStepActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFBOARDING, action="process_exit")),
) -> ExitChecklistStep:
    step = await db.get(ExitChecklistStep, step_id)
    if step is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _assert_not_withdrawn(await db.get(Resignation, step.resignation_id))
    if step.status != "OPEN":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This step is not open")

    step.status = "DONE"
    step.completed_by = current_user.id
    step.completion_note = body.completion_note
    step.confirmation_acknowledged = body.confirmation_acknowledged
    step.updated_by = current_user.id
    try:
        await db.flush()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This step's precondition is not met yet") from exc

    if step.step_key == "DISABLE_LOGIN":
        employee = await db.get(Employee, step.employee_id)
        if employee.user_id is not None:
            user = await db.get(User, employee.user_id)
            user.is_enabled = False
            user.updated_by = current_user.id
            employee.login_removed_at = datetime.now(timezone.utc)
            employee.updated_by = current_user.id
            await auth_tokens.revoke_all_refresh_tokens(db, user.id)
    elif step.step_key == "MARK_FINAL_SETTLEMENT_DUE":
        resignation = await db.get(Resignation, step.resignation_id)
        resignation.final_settlement_status = "DUE"
        resignation.final_settlement_marked_at = datetime.now(timezone.utc)
        resignation.updated_by = current_user.id
    elif step.step_key == "MARK_EXITED":
        resignation = await db.get(Resignation, step.resignation_id)
        resignation.status = "COMPLETED"
        resignation.completed_at = datetime.now(timezone.utc)
        resignation.updated_by = current_user.id

    # Cascade-unlock, app-layer: open every step gated by this one.
    await db.execute(
        update(ExitChecklistStep)
        .where(ExitChecklistStep.gated_by_step_id == step.id, ExitChecklistStep.status == "LOCKED")
        .values(status="OPEN")
    )
    # RETURN_ALL_ASSETS opens with outstanding_asset_count still at its
    # default of 0 unless recomputed now — without this, an employee who
    # already held assets before resigning would sail through the gate on a
    # stale zero (Appendix B's "ZERO-ASSET CASE" also means it completes
    # immediately right here, the instant it opens, if the count really is 0).
    await exit_checklist_sync.sync_outstanding_assets(db, step.employee_id, current_user.id)
    await db.commit()
    await db.refresh(step)
    return step


# ============================================================= OFFER LETTERS
async def _offer_letter_to_out(db: AsyncSession, letter: OfferLetter) -> OfferLetterOut:
    terms = (
        await db.execute(select(OfferLetterCustomTerm).where(OfferLetterCustomTerm.offer_letter_id == letter.id).order_by(OfferLetterCustomTerm.display_order))
    ).scalars().all()
    out = OfferLetterOut.model_validate(letter)
    out.custom_terms = list(terms)
    return out


def _money_str(v) -> str:
    return f"₹{v:,.2f}" if v is not None else "—"


async def _offer_appointment_letter_sections(db: AsyncSession, letter: OfferLetter, employee: Employee) -> list[tuple[str, list[tuple[str, str]]]]:
    """OFFER_LETTER/APPOINTMENT_LETTER sections: Employment Details,
    Compensation Summary (this letter's own salary snapshot), Statutory
    Components (the linked Salary Structure's applicable lines), Custom
    Terms (this letter's own additions/deductions) — per the OfferLetter
    model, exactly what's tracked for the letter.
    """
    employee_name = f"{employee.first_name} {employee.last_name or ''}".strip()
    sections: list[tuple[str, list[tuple[str, str]]]] = [
        ("Employment Details", [
            ("Employee", employee_name),
            ("Employee ID", employee.employee_code),
            ("Designation", letter.designation_snapshot),
            ("Department", letter.department_snapshot),
            ("Employment Type", letter.employment_type_snapshot),
            ("Joining Date", str(letter.joining_date_snapshot) if letter.joining_date_snapshot else "—"),
        ]),
        ("Compensation Summary", [
            ("Basic Salary (Monthly)", _money_str(letter.basic_salary_snapshot)),
            ("HRA (Monthly)", _money_str(letter.hra_snapshot)),
            ("Gross Monthly", _money_str(letter.gross_monthly_snapshot)),
            ("Annual CTC", _money_str(letter.annual_ctc_snapshot)),
        ]),
    ]

    if letter.salary_structure_id:
        statutory_lines = (
            await db.execute(
                select(SalaryStructureStatutoryLine)
                .where(
                    SalaryStructureStatutoryLine.salary_structure_id == letter.salary_structure_id,
                    SalaryStructureStatutoryLine.is_applicable.is_(True),
                )
                .order_by(SalaryStructureStatutoryLine.display_order)
            )
        ).scalars().all()
        if statutory_lines:
            sections.append((
                "Statutory Components",
                [
                    (line.print_label_snapshot or line.head_name_snapshot, f"{_money_str(line.computed_amount_monthly)} ({line.borne_by.title()})")
                    for line in statutory_lines
                ],
            ))

    custom_terms = (
        await db.execute(select(OfferLetterCustomTerm).where(OfferLetterCustomTerm.offer_letter_id == letter.id).order_by(OfferLetterCustomTerm.display_order))
    ).scalars().all()
    if custom_terms:
        sections.append((
            "Custom Terms",
            [
                (
                    term.label,
                    ("+" if term.adjustment_type == "ADDITION" else "-") + _money_str(term.amount)
                    + (" (Recurring)" if term.is_recurring else " (One-time)"),
                )
                for term in custom_terms
            ],
        ))

    return sections


def _resignation_acceptance_sections(letter: OfferLetter, employee: Employee, resignation: Resignation) -> list[tuple[str, list[tuple[str, str]]]]:
    """RESIGNATION_ACCEPTANCE_LETTER sections cover the resignation's own
    fields, not a salary snapshot — Last Working Day, Reason, Acceptance
    Date. "Acceptance Date" is read as the date this acceptance letter is
    generated (the act that formally accepts the resignation), since
    Resignation itself has no separate accepted_at column — only
    manager_acknowledgement (a distinct, earlier step) and this letter.
    """
    employee_name = f"{employee.first_name} {employee.last_name or ''}".strip()
    return [
        ("Resignation Details", [
            ("Employee", employee_name),
            ("Employee ID", employee.employee_code),
            ("Last Working Day", str(letter.last_working_day_snapshot) if letter.last_working_day_snapshot else "—"),
            ("Reason", resignation.reason or "—"),
            ("Acceptance Date", str(letter.generated_at.date()) if letter.generated_at else "—"),
        ]),
    ]


@router.post("/employees/{employee_id}/offer-letters", response_model=OfferLetterOut, status_code=status.HTTP_201_CREATED)
async def create_offer_letter(
    employee_id: str,
    body: OfferLetterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFER_LETTERS, action="edit")),
) -> OfferLetterOut:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.letter_type == "RESIGNATION_ACCEPTANCE_LETTER":
        if body.resignation_id is None or body.last_working_day_snapshot is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A Resignation Acceptance Letter needs its resignation_id and last_working_day_snapshot")
        resignation_for_letter = await db.get(Resignation, body.resignation_id)
        if resignation_for_letter is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Resignation not found")
        # You cannot accept a resignation that has been retracted.
        _assert_not_withdrawn(resignation_for_letter)

    department = await db.get(Department, employee.department_id)
    designation = await db.get(Designation, employee.designation_id)
    employment_type = await db.get(EmploymentType, employee.employment_type_id)

    salary_snapshot = {}
    if body.salary_structure_id:
        structure = await db.get(SalaryStructure, body.salary_structure_id)
        if structure is not None:
            salary_snapshot = dict(
                basic_salary_snapshot=structure.basic_salary_monthly, hra_snapshot=structure.hra_monthly,
                gross_monthly_snapshot=structure.gross_monthly, annual_ctc_snapshot=structure.annual_ctc,
            )

    fy = await get_current_financial_year(db)
    letter_number = await allocate_number(db, code_type="LTR", financial_year_id=fy.id, fy_label=fy.label)
    letter = OfferLetter(
        id=str(uuid.uuid4()), employee_id=employee_id, letter_number=letter_number, financial_year_id=fy.id,
        letter_type=body.letter_type, resignation_id=body.resignation_id,
        designation_snapshot=designation.name, department_snapshot=department.name, employment_type_snapshot=employment_type.name,
        joining_date_snapshot=body.joining_date_snapshot or employee.joining_date,
        last_working_day_snapshot=body.last_working_day_snapshot, salary_structure_id=body.salary_structure_id,
        created_by=current_user.id, updated_by=current_user.id, **salary_snapshot,
    )
    db.add(letter)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This resignation already has an acceptance letter") from exc
    await db.refresh(letter)
    return await _offer_letter_to_out(db, letter)


@router.get("/employees/{employee_id}/offer-letters", response_model=list[OfferLetterOut])
async def list_offer_letters(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(OFFER_LETTERS)),
) -> list[OfferLetterOut]:
    rows = (await db.execute(select(OfferLetter).where(OfferLetter.employee_id == employee_id))).scalars().all()
    return [await _offer_letter_to_out(db, r) for r in rows]


@router.post("/offer-letters/{letter_id}/custom-terms", response_model=OfferLetterCustomTermOut, status_code=status.HTTP_201_CREATED)
async def add_custom_term(
    letter_id: str,
    body: OfferLetterCustomTermWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFER_LETTERS, action="edit")),
) -> OfferLetterCustomTerm:
    letter = await db.get(OfferLetter, letter_id)
    if letter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row = OfferLetterCustomTerm(id=str(uuid.uuid4()), offer_letter_id=letter_id, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "This letter has already been generated — its custom terms are locked") from exc
    await db.refresh(row)
    return row


@router.post("/offer-letters/{letter_id}/generate", response_model=OfferLetterOut)
async def generate_offer_letter(
    letter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFER_LETTERS, action="generate")),
) -> OfferLetterOut:
    letter = await db.get(OfferLetter, letter_id)
    if letter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if letter.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already generated")
    # create_offer_letter() blocks a NEW acceptance letter on a withdrawn
    # resignation, but a letter drafted while the resignation was still live
    # and only generated afterwards slipped straight through — verified live:
    # withdraw -> generate returned 200 and produced the acceptance PDF. Same
    # parent-status re-check every other offboarding action does.
    if letter.letter_type == "RESIGNATION_ACCEPTANCE_LETTER" and letter.resignation_id is not None:
        _assert_not_withdrawn(await db.get(Resignation, letter.resignation_id))

    employee = await db.get(Employee, letter.employee_id)
    letter.status = "GENERATED"
    letter.generated_at = datetime.now(timezone.utc)
    letter.generated_by = current_user.id
    letter.updated_by = current_user.id

    resignation: Resignation | None = None
    if letter.letter_type == "RESIGNATION_ACCEPTANCE_LETTER":
        resignation = await db.get(Resignation, letter.resignation_id)
        step = (
            await db.execute(
                select(ExitChecklistStep).where(
                    ExitChecklistStep.resignation_id == letter.resignation_id, ExitChecklistStep.step_key == "RESIGNATION_ACCEPTANCE_LETTER"
                )
            )
        ).scalar_one_or_none()
        if step is not None:
            step.linked_offer_letter_id = letter.id
            step.updated_by = current_user.id
        # This IS the moment the last working day becomes final (ARCH-1:
        # "the date fixed by the resignation acceptance letter"), so the
        # letter's own snapshot is written back onto the resignation here —
        # the only writer of final_last_working_day besides the default
        # seeded at raise_resignation().
        if resignation is not None and letter.last_working_day_snapshot is not None:
            resignation.final_last_working_day = letter.last_working_day_snapshot
            resignation.updated_by = current_user.id
        letter_type_label = "Resignation Acceptance Letter"
        sections = _resignation_acceptance_sections(letter, employee, resignation)
    else:
        letter_type_label = letter.letter_type.replace("_", " ").title()
        sections = await _offer_appointment_letter_sections(db, letter, employee)

    company, logo = await pdf_engine.company_logo_bytes(db)
    content = pdf_engine.render_document_pdf(f"{letter_type_label} — {letter.letter_number}", company, sections, logo)
    stored_file = file_storage.save_upload(content, file_storage.content_hash_of(content), f"{letter.letter_number}.pdf", "application/pdf", current_user.id)
    db.add(stored_file)
    # There's no ORM relationship() between OfferLetter and StoredFile — just
    # a raw FK column — so without an explicit flush here, SQLAlchemy's
    # unit-of-work can emit this UPDATE before the StoredFile INSERT within
    # the same commit, tripping fk_ol_pdf_file (found live, Phase 6 close-out
    # verification). payslips.py's two save_upload() call sites already flush
    # before assigning the FK; this one didn't.
    await db.flush()
    letter.pdf_file_id = stored_file.id

    await db.commit()
    await db.refresh(letter)

    # Generate PDF and Send to Employee are two SEPARATE buttons/actions
    # (02-employee-module.md §2.15; workflow 3.5 step 4). The email — with
    # the letter PDF attached — fires from send_offer_letter() below, not
    # here; this action only produces the PDF and stores pdf_file_id.
    return await _offer_letter_to_out(db, letter)


@router.post("/offer-letters/{letter_id}/send", response_model=OfferLetterOut)
async def send_offer_letter(
    letter_id: str,
    body: SendLetterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(OFFER_LETTERS, action="send")),
) -> OfferLetterOut:
    letter = await db.get(OfferLetter, letter_id)
    if letter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if letter.status != "GENERATED":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Must be Generated before it can be Sent")
    if letter.pdf_file_id is None:
        # Shouldn't happen — GENERATED is only ever set alongside pdf_file_id,
        # in the same commit, by generate_offer_letter() — but guard rather
        # than send an email with no attachment.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Generate the PDF before sending")
    # Same re-check as generate_offer_letter(): an acceptance letter already
    # GENERATED before the employee retracted must not still be emailed out
    # as though the resignation stood.
    if letter.letter_type == "RESIGNATION_ACCEPTANCE_LETTER" and letter.resignation_id is not None:
        _assert_not_withdrawn(await db.get(Resignation, letter.resignation_id))

    employee = await db.get(Employee, letter.employee_id)
    to_email = body.to_email or employee.email
    letter.status = "SENT"
    letter.sent_at = datetime.now(timezone.utc)
    letter.sent_by = current_user.id
    letter.sent_to_email = to_email
    letter.updated_by = current_user.id
    await db.commit()
    await db.refresh(letter)

    # "Send to Employee" is the genuinely separate action that emails the
    # letter — with the already-generated PDF attached (02-employee-
    # module.md §2.15). Generate PDF (above, in generate_offer_letter) no
    # longer sends anything itself.
    stored_file = await db.get(StoredFile, letter.pdf_file_id)
    pdf_bytes = file_storage.read_bytes(stored_file)
    attachment = Attachment(filename=f"{letter.letter_number}.pdf", content=pdf_bytes, mime_type="application/pdf")

    if letter.letter_type == "RESIGNATION_ACCEPTANCE_LETTER":
        resignation = await db.get(Resignation, letter.resignation_id)
        log = await email_transport.send_templated_email(
            db, "resignation_acceptance_letter", to_email,
            {"first_name": employee.first_name, "resignation_date": str(resignation.submitted_at.date())},
            related_record_type="offer_letter", related_record_id=letter.id, attachment=attachment,
        )
    else:
        letter_type_label = letter.letter_type.replace("_", " ").title()
        log = await email_transport.send_templated_email(
            db, "offer_appointment_letter", to_email,
            {"first_name": employee.first_name, "letter_type": letter_type_label},
            related_record_type="offer_letter", related_record_id=letter.id, attachment=attachment,
        )

    if log is not None:
        letter.email_send_log_id = log.id
        await db.commit()
        await db.refresh(letter)

    return await _offer_letter_to_out(db, letter)
