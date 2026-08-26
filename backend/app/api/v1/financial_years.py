"""Masters §3.1 Financial Year — the Phase 0 vertical slice proving the RBAC
pattern end-to-end. Deliberately the first real screen: almost every other
module reads it (Invariant 4 — a locked FY freezes everything dated inside
it, for everyone, including Super Admin, WHILE it stays locked).

A002 revisited (migration 0009): that freeze is no longer permanent — Super
Admin has an explicit `POST /{id}/unlock` override, RBAC-gated and enforced
at the DB layer via a session-variable-gated trigger, not just app code. See
unlock_financial_year's own docstring for the mechanism.
"""

import uuid
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.numbering import FinancialYear
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.financial_year import FinancialYearCreate, FinancialYearOut, FinancialYearUpdate
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/masters/financial-years", tags=["masters"])
SCREEN = "masters.financial_year"

# 01-masters-module.md — RBAC §2.2: Status filter is named All/Open/Locked;
# the underlying FinancialYear.status column stores the lowercase "open"/
# "locked" values set in create/lock below.
_LIST_COLUMNS = [
    ColumnSpec("label", "Label/Name"),
    ColumnSpec("start_date", "Start Date"),
    ColumnSpec("end_date", "End Date"),
    ColumnSpec("status", "Status"),
    ColumnSpec("is_current", "Is Current"),
]

# The one place that builds a FinancialYearOut, so `locked_by_name` (a
# resolved name, never the raw id — there is no /users endpoint for a client
# to resolve it itself) is populated identically everywhere a FinancialYear
# is returned.
#
# RBAC Phase 1: FinancialYearOut is a real hand-written class with
# `class Config: from_attributes = True` set INSIDE the class body, so
# constructing it directly (not via model_validate on an ORM row — locked_by_name
# never lives on the FinancialYear row itself) is safe. Masking has to run
# before the response leaves the function (MASTER-BUILD-PROMPT.md §3.2: a
# hidden field must be absent from the API response, including create/update
# echoes), so every call site returns a masked dict, not the FinancialYearOut
# instance, and every route that uses this must set response_model=None —
# otherwise FastAPI's own response_model validation on the way out would
# re-add/reshape the fields masking just removed.
def _masked_fy_out(fy: FinancialYear, locked_by_name: str | None, perms: PermissionSet) -> dict:
    out = FinancialYearOut(
        id=fy.id, label=fy.label, start_date=fy.start_date, end_date=fy.end_date,
        status=fy.status, is_current=fy.is_current,
        locked_at=fy.locked_at, locked_by_name=locked_by_name,
    )
    return apply_field_masking(out.model_dump(), perms)


@router.get("/options", response_model=None)
async def list_financial_year_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """2026-08 RBAC audit fix — the same `label_field`/`/options` contract
    masters_lookup.py documents (Payment Mode, HSN/SAC Code) and
    masters_bank_accounts.py already follows, applied to the one lookup that
    every single screen needs: this router is Super-Admin-only at the screen
    level (seed.py:46, `masters.financial_year`: _super_admin_only), but the
    Financial Year pill lives in the TOPBAR and the "This Financial Year" /
    "Last Financial Year" date-range presets are part of RBAC §2.2(c)'s
    baseline filter set on every list, report, board and calendar screen. So
    Manager/Accountant/HR/Employee were 404ing on `GET /masters/financial-years`
    on essentially every page they can open — while the correct answer is
    emphatically NOT to widen their screen mode in seed.py, which would also
    hand them the standalone Financial Year master (Create / Lock / Unlock /
    Set Current) that §3.1 reserves for Super Admin.

    Gated on plain authentication only, and returns exactly the five fields
    the two real consumers read and no more:
      - `label` + `is_current` — topbar.component.ts's FinancialYearRow, for
        the "FY 2026" pill.
      - `start_date` + `end_date` — date-presets.ts's FinancialYearLike. These
        ARE the preset: `buildDatePresets` resolves "This Financial Year" to
        the row's own two dates precisely so nothing hardcodes an April start.
        A picker that cannot read them cannot filter by financial year at all,
        which is the whole point of the control.
    Deliberately withheld, unlike `list_financial_years` below: `status`,
    `locked_at` and `locked_by_name` — the lifecycle state the Super-Admin-only
    screen exists to manage, which no dropdown or preset needs. Ordered
    newest-first, same as the real list.
    """
    rows = (
        await db.execute(
            select(
                FinancialYear.id, FinancialYear.label, FinancialYear.start_date,
                FinancialYear.end_date, FinancialYear.is_current,
            ).order_by(FinancialYear.start_date.desc())
        )
    ).all()
    return [
        {"id": fy_id, "label": label, "start_date": start_date, "end_date": end_date, "is_current": is_current}
        for fy_id, label, start_date, end_date, is_current in rows
    ]


@router.get("", response_model=None)
async def list_financial_years(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),  # L1 only — viewing needs no action
    status_filter: list[str] | None = Query(None, alias="status"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    locker = aliased(User)
    stmt = select(FinancialYear, locker.full_name).outerjoin(locker, FinancialYear.locked_by == locker.id)
    if status_filter:
        stmt = stmt.where(FinancialYear.status.in_(status_filter))
    result = (await db.execute(stmt.order_by(FinancialYear.start_date.desc()))).all()

    if format:
        export_rows = [
            {
                "label": fy.label, "start_date": fy.start_date, "end_date": fy.end_date,
                "status": fy.status, "is_current": fy.is_current,
            }
            for fy, _locked_by_name in result
        ]
        filters_applied = {"status": status_filter}
        return await list_export.build_export(format, db, current_user, "Financial Years", _LIST_COLUMNS, export_rows, filters_applied)

    return [_masked_fy_out(fy, locked_by_name, perms) for fy, locked_by_name in result]


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_financial_year(
    body: FinancialYearCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),  # L2
) -> dict:
    # Label is always derived from the Start Date's calendar year — that part
    # of §3.1 is unchanged. End Date defaults to the same start+1y-1d
    # arithmetic as before, but MASTER-BUILD-PROMPT.md §4.1 requires it be
    # overridable: a company's financial year is not guaranteed to be exactly
    # one year minus a day (a fiscal-year-change transition period commonly
    # isn't), so hardcoding that arithmetic as the only possible value is
    # exactly the class of assumption this project's own rules forbid.
    label = str(body.start_date.year)
    default_end_date = body.start_date + relativedelta(years=1) - relativedelta(days=1)
    end_date = body.end_date if body.end_date is not None else default_end_date
    if end_date <= body.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="End Date must be after Start Date")

    existing = (await db.execute(select(FinancialYear).where(FinancialYear.label == label))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Financial Year {label} already exists")

    fy = FinancialYear(
        id=str(uuid.uuid4()),
        label=label,
        start_date=body.start_date,
        end_date=end_date,
        status="open",
        is_current=False,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(fy)
    await db.commit()
    await db.refresh(fy)
    return _masked_fy_out(fy, None, perms)  # a newly created year is never locked


@router.put("/{fy_id}", response_model=None)
async def update_financial_year(
    fy_id: str,
    body: FinancialYearUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),  # L2
) -> dict:
    """§4.1: "add PUT .../{id}... make Start Date editable... make End Date
    an entered field." §4.1 also says "Keep the lock rules" — Invariant 4
    freezes a locked year for everyone including Super Admin, and editing its
    own start/end dates is exactly the kind of write that rule exists to
    block, so this checks status the same way lock/set-current already do
    rather than carving out an exception for itself.

    Label is re-derived from the (possibly new) start_date, same rule as
    create — a Financial Year's label always means "the calendar year it
    starts in," never a stored, independently-editable string.
    """
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.id == fy_id))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if fy.status == "locked":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This Financial Year is locked — unlock it first if it needs to change")

    if body.end_date <= body.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="End Date must be after Start Date")

    new_label = str(body.start_date.year)
    if new_label != fy.label:
        clash = (
            await db.execute(select(FinancialYear).where(FinancialYear.label == new_label, FinancialYear.id != fy_id))
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Financial Year {new_label} already exists")

    fy.label = new_label
    fy.start_date = body.start_date
    fy.end_date = body.end_date
    fy.updated_by = current_user.id
    await db.commit()
    await db.refresh(fy)
    return _masked_fy_out(fy, None, perms)  # PUT only reachable while open, so never locked


@router.delete("/{fy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_financial_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),  # L2, Super Admin only
) -> None:
    """Masters §3.0/§3.1's own Status & Deletion Rule (01-masters-module.md):
    "A Financial Year with no records referencing it anywhere in the CMS may
    be deleted outright... Once any record in any module references it,
    deletion is disabled and Locking becomes the only further action
    available." `reference_count` (models/numbering.py) is exactly this
    counter — incremented elsewhere whenever another module snapshots this
    year's id, never here.
    """
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.id == fy_id))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # Caught live by this session's own testing: DELETE originally checked
    # ONLY reference_count, which let a LOCKED-but-unreferenced year be
    # deleted outright — a bigger violation of Invariant 4 than the PUT case
    # above guards against, since it destroys the locked record entirely
    # rather than merely editing it. Unlock first if it genuinely needs to go.
    if fy.status == "locked":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This Financial Year is locked — unlock it first if it needs to be deleted")
    if fy.reference_count > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"This Financial Year is referenced by {fy.reference_count} record(s) elsewhere and can no longer be deleted — lock it instead.",
        )
    await db.delete(fy)
    await db.commit()


@router.post("/{fy_id}/lock", response_model=None)
async def lock_financial_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="lock")),  # L2
) -> dict:
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.id == fy_id))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if fy.status == "locked":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Already locked — use Unlock first if this year needs to be reopened")

    fy.status = "locked"
    fy.locked_at = datetime.now(timezone.utc)
    fy.locked_by = current_user.id
    fy.updated_by = current_user.id
    await db.commit()
    await db.refresh(fy)
    # current_user IS the person who just locked it — no extra query needed.
    return _masked_fy_out(fy, current_user.full_name, perms)


@router.post("/{fy_id}/unlock", response_model=None)
async def unlock_financial_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="unlock")),  # L2, Super Admin only (seed.py)
) -> dict:
    """A002 revisited: locking is no longer categorically one-way — Super
    Admin has an explicit, RBAC-gated override. See migration 0009's
    docstring for the full reasoning; the short version is that
    `trg_fy_reject_unlock` still rejects any UPDATE that flips `locked` back
    to `open` UNLESS the current DB session has set `@fy_unlock_allowed = 1`,
    and this endpoint is the only place in the codebase that ever sets it —
    so a stray script or a different service still can't do this by
    accident, only this one sanctioned, permission-checked path can.

    Reopening genuinely reopens the period: every module that checks "is this
    FY locked" before allowing a write (Invoice, Payroll, Expense, ...) will
    once again permit edits to records dated inside it, exactly as if it had
    never been locked. This is the real, system-wide consequence a Super
    Admin is accepting — not a cosmetic status flip on this one screen.
    """
    fy = (await db.execute(select(FinancialYear).where(FinancialYear.id == fy_id))).scalar_one_or_none()
    if fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if fy.status != "locked":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This Financial Year is not locked")

    await db.execute(text("SET @fy_unlock_allowed = 1"))
    fy.status = "open"
    fy.locked_at = None
    fy.locked_by = None
    fy.updated_by = current_user.id
    await db.commit()
    # Reset immediately — this connection may return to the pool and be reused
    # by a request that has no business unlocking anything.
    await db.execute(text("SET @fy_unlock_allowed = NULL"))
    await db.commit()
    await db.refresh(fy)
    return _masked_fy_out(fy, None, perms)  # no longer locked, so no locker to name


@router.post("/{fy_id}/set-current", response_model=None)
async def set_current_financial_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="set_current")),  # L2
) -> dict:
    """Every downstream module that snapshots a financial_year_id on create
    (Employee, Salary Structure, Leave, Attendance, ...) resolves "today's
    FY" from the one row flagged is_current — see
    app.services.numbering.get_current_financial_year. Unset-then-set, same
    single-active-row order as every other one-active-row guard in this
    schema (Work Week Policy, Pay Cycle, ...).
    """
    fy = await db.get(FinancialYear, fy_id)
    if fy is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if fy.status == "locked":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Cannot set a locked Financial Year as current")

    previous = (await db.execute(select(FinancialYear).where(FinancialYear.is_current.is_(True)))).scalar_one_or_none()
    if previous is not None:
        previous.is_current = False
        previous.updated_by = current_user.id
        await db.flush()

    fy.is_current = True
    fy.updated_by = current_user.id
    await db.commit()
    await db.refresh(fy)
    # The 409 above guarantees fy is not locked, so it never has a locked_by.
    return _masked_fy_out(fy, None, perms)
