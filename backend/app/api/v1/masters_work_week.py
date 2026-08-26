"""Masters §3.20 — Work Week & Hours. Policies (with the derived
Net Working Hours field and the "exactly one active Company-wide policy"
DB guard proven live in Phase 1's verification pass), Saturday Overrides, and
Pay Cycle (§3.20's own inner tab — "the date window a payroll run actually
covers", added 2026-07-30 on explicit instruction).

The Saturday Calendar and Resolved Periods / Cutoff Reconciliation tabs are
READ views computed from this data (52 rows a year, three months' preview) —
real UI-support endpoints for those belong with Payroll (Phase 3), which is
the actual consumer of the resolution; Phase 1 ships the data these views are
computed FROM, correctly guarded, per BUILD-PROMPT §13's Phase 1 scope
("Work Week & Hours + Pay Cycle" — the masters, not payroll's calculations).
"""

import calendar
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import PayCycle, SaturdayOverride, WorkWeekPolicy
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.masters import (
    PayCycleOut,
    PayCycleWrite,
    SaturdayOverrideOut,
    SaturdayOverrideWrite,
    WorkWeekPolicyCreate,
    WorkWeekPolicyOut,
    WorkWeekPolicyWrite,
)
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/masters/work-week-policies", tags=["masters"])
SCREEN = "masters.work_week_hours"

# Masters §3.20 Screen Design, Work Week Policies list: "Policy, Applies To,
# Gross h/day, Break, Net h/day, Weekly Target, Weekly Off, Saturday Rule,
# Comp Allowed, Shortfall Becomes, Status." Hours are quantities, not money,
# so they align right per this project's own reversed money-vs-quantity
# convention (pdf_engine.ColumnSpec docstring).
_POLICY_LIST_COLUMNS = [
    ColumnSpec("policy_name", "Policy"),
    ColumnSpec("applies_to", "Applies To"),
    ColumnSpec("gross_hours_per_day", "Gross h/day", align="right"),
    ColumnSpec("unpaid_break_hours", "Break", align="right"),
    ColumnSpec("net_working_hours_per_day", "Net h/day", align="right"),
    ColumnSpec("weekly_hour_target", "Weekly Target", align="right"),
    ColumnSpec("weekly_off_days", "Weekly Off"),
    ColumnSpec("saturday_rule", "Saturday Rule"),
    ColumnSpec("allow_compensatory_hours", "Comp Allowed"),
    ColumnSpec("uncompensated_shortfall_becomes", "Shortfall Becomes"),
    ColumnSpec("is_active", "Status"),
]

# Masters §3.20 Screen Design, Saturday Calendar: "Export Calendar — the file
# HR circulates at the start of the year." This endpoint returns the manually
# created override rows (not the full computed 52-row calendar, which is a
# Payroll-phase read view per this module's own docstring above), so the
# export mirrors exactly what list_saturday_overrides already returns.
_SATURDAY_LIST_COLUMNS = [
    ColumnSpec("saturday_date", "Saturday Date"),
    ColumnSpec("pattern_says", "Pattern Says"),
    ColumnSpec("override_to", "Actually"),
    ColumnSpec("hours_required", "Hours Required", align="right"),
    ColumnSpec("reason", "Reason"),
    ColumnSpec("notify_affected_employees", "Employees Notified"),
]


logger = logging.getLogger(__name__)


# DBAPIError catches both native constraint violations (IntegrityError —
# UNIQUE/FK/CHECK, e.g. a second active Company-wide policy, a Fixed-Cycle
# pay cycle missing start/end day) and a rejected trigger SIGNAL
# (OperationalError, e.g. the sole-active-policy or FY-range triggers).
# Found missing by the Phase 1 audit: none of this module's mutating
# endpoints caught either, so any DB-level rejection surfaced as a raw
# unhandled 500 instead of a clean 4xx.
def _as_client_error(exc: DBAPIError) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Rejected by a database constraint")


def _resolve_saturday_pattern(saturday_date, saturday_rule: str) -> str:
    """What a Saturday Rule alone would say for this date, before any
    override — Masters §3.20's "Pattern Says" column, captured on the
    override row at creation time so it stays a snapshot of what was true
    then, not a value that silently drifts if the policy's rule changes
    later (same snapshot discipline as everywhere else in this schema).
    """
    ordinal = (saturday_date.day - 1) // 7 + 1  # 1st..5th Saturday of the month
    last_day = calendar.monthrange(saturday_date.year, saturday_date.month)[1]
    is_last = saturday_date.day + 7 > last_day

    if saturday_rule == "ALL_WORKING":
        return "WORKING"
    if saturday_rule == "ALL_OFF":
        return "WEEK_OFF"
    if saturday_rule == "ODD_WORKING":
        return "WORKING" if ordinal % 2 == 1 else "WEEK_OFF"
    if saturday_rule == "EVEN_WORKING":
        return "WORKING" if ordinal % 2 == 0 else "WEEK_OFF"
    if saturday_rule == "FIRST_ONLY":
        return "WORKING" if ordinal == 1 else "WEEK_OFF"
    if saturday_rule == "LAST_ONLY":
        return "WORKING" if is_last else "WEEK_OFF"
    return "WEEK_OFF"  # CUSTOM — no rule to derive from; the override IS the answer


@router.get("", response_model=None)
async def list_policies(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[WorkWeekPolicyOut] | Response:
    rows = list((await db.execute(select(WorkWeekPolicy))).scalars().all())

    if format:
        # RBAC §2.2(f): export exactly the set on screen — this list has no
        # query filters of its own, so filters_applied is empty (build_export
        # still stamps the result count / exported-by / exported-at block).
        export_rows = [
            {
                "policy_name": p.policy_name, "applies_to": p.applies_to,
                "gross_hours_per_day": p.gross_hours_per_day, "unpaid_break_hours": p.unpaid_break_hours,
                "net_working_hours_per_day": p.net_working_hours_per_day, "weekly_hour_target": p.weekly_hour_target,
                "weekly_off_days": p.weekly_off_days, "saturday_rule": p.saturday_rule,
                "allow_compensatory_hours": "Yes" if p.allow_compensatory_hours else "No",
                "uncompensated_shortfall_becomes": p.uncompensated_shortfall_becomes,
                "is_active": "Active" if p.is_active else "Inactive",
            }
            for p in rows
        ]
        return await list_export.build_export(format, db, current_user, "Work Week Policies", _POLICY_LIST_COLUMNS, export_rows, {})

    # RBAC Layer 3: list responses are real ORM exposure — mask each row
    # through the caller's resolved field modes before it leaves the process.
    return [apply_field_masking(WorkWeekPolicyOut.model_validate(p).model_dump(), perms) for p in rows]


@router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_policy(
    body: WorkWeekPolicyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    # Net Working Hours per Day is DERIVED, never typed (Invariant 3 /
    # Masters §3.20's own Fields Table) — a real STORED GENERATED column in
    # MySQL (models.masters.WorkWeekPolicy.net_working_hours_per_day is
    # Computed()), so it is deliberately NOT passed here; the DB computes it
    # and refresh() below reads it back.
    row = WorkWeekPolicy(
        id=str(uuid.uuid4()),
        created_by=current_user.id,
        updated_by=current_user.id,
        **body.model_dump(),
    )
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    # RBAC Layer 3: a field hidden/masked for this role must not leak back
    # just because this role is the one that created the record.
    return apply_field_masking(WorkWeekPolicyOut.model_validate(row).model_dump(), perms)


@router.put("/{policy_id}", response_model=None)
async def update_policy(
    policy_id: str,
    body: WorkWeekPolicyWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    row = await db.get(WorkWeekPolicy, policy_id)
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
    return apply_field_masking(WorkWeekPolicyOut.model_validate(row).model_dump(), perms)


@router.post("/{policy_id}/deactivate", response_model=None)
async def deactivate_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> dict:
    row = await db.get(WorkWeekPolicy, policy_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.applies_to == "COMPANY_WIDE" and row.is_active:
        others = (
            await db.execute(
                select(WorkWeekPolicy).where(
                    WorkWeekPolicy.applies_to == "COMPANY_WIDE",
                    WorkWeekPolicy.is_active.is_(True),
                    WorkWeekPolicy.id != row.id,
                )
            )
        ).scalars().all()
        if not others:
            # Matches trg_wwp_reject_deactivate_sole_company_wide — checked
            # here first for a clean 409.
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Cannot deactivate the only active Company-wide Work Week policy")
    row.is_active = False
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return apply_field_masking(WorkWeekPolicyOut.model_validate(row).model_dump(), perms)


@router.post("/{policy_id}/activate", response_model=None)
async def activate_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="delete")),
) -> dict:
    # §3b — deactivate_policy had no reverse at all until now, so a policy
    # created (or deactivated) inactive had no way back except editing the
    # database directly. Mirrors masters_lookup.py's activate_row.
    #
    # Live-tested bug, fixed here: activating a SECOND Company-wide policy
    # while one is already active violates ux_wwp_one_company_wide (a real
    # unique index — deactivate_policy's own docstring guards the OPPOSITE
    # direction, losing the last active one, but nothing guarded this one).
    # Without the pre-check below, that surfaced as a raw 500
    # (IntegrityError, "Duplicate entry 'COMPANY_WIDE'"), not a clean 409.
    row = await db.get(WorkWeekPolicy, policy_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.applies_to == "COMPANY_WIDE" and not row.is_active:
        other_active = (
            await db.execute(
                select(WorkWeekPolicy).where(
                    WorkWeekPolicy.applies_to == "COMPANY_WIDE",
                    WorkWeekPolicy.is_active.is_(True),
                    WorkWeekPolicy.id != row.id,
                )
            )
        ).scalar_one_or_none()
        if other_active is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f'"{other_active.policy_name}" is already the active Company-wide policy — deactivate it first, since only one may be active at a time.',
            )
    row.is_active = True
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(WorkWeekPolicyOut.model_validate(row).model_dump(), perms)


# -------------------------------------------------------------- Pay Cycle
pay_cycle_router = APIRouter(prefix="/masters/pay-cycles", tags=["masters"])


@pay_cycle_router.get("", response_model=None)
async def list_pay_cycles(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[dict]:
    # No export wiring here, deliberately: Masters §3.20's own Screen Design
    # for the Pay Cycle tab shows "the current Cycle Type, Start Day, End Day
    # and Salary Credit Day read-only" — a single settings record with an
    # Edit action, not a list screen (unlike Work Week Policies and the
    # Saturday Calendar, which the spec does draw as row-actioned lists).
    # The endpoint still returns a list (deactivated history rows persist
    # alongside the one active row, per replace_pay_cycle's own docstring
    # below), so it gets the same per-row RBAC Layer 3 masking as any other
    # list endpoint; response_model had to drop to None for the same reason
    # as every other masked endpoint in this module — FastAPI's own
    # response_model validation would otherwise re-add fields just removed.
    rows = list((await db.execute(select(PayCycle))).scalars().all())
    return [apply_field_masking(PayCycleOut.model_validate(p).model_dump(), perms) for p in rows]


@pay_cycle_router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def replace_pay_cycle(
    body: PayCycleWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="edit")),
) -> dict:
    """Masters §3.20c: "a change never rewrites a period that has already
    run; it only changes what the NEXT Run Payroll resolves." Modelled as
    replacing which single row is active — deactivate the old one, activate
    the new one, same unset-then-set order as every other one-active-row
    guard in this module (MySQL's generated-column UNIQUE is checked
    per-statement, not deferred).
    """
    current = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    if current is not None:
        current.is_active = False
        current.updated_by = current_user.id
        await db.flush()
    new_cycle = PayCycle(id=str(uuid.uuid4()), is_active=True, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(new_cycle)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(new_cycle)
    return apply_field_masking(PayCycleOut.model_validate(new_cycle).model_dump(), perms)


# -------------------------------------------------------------- Saturday Overrides
saturday_router = APIRouter(prefix="/masters/work-week-policies/saturday-overrides", tags=["masters"])


@saturday_router.get("", response_model=None)
async def list_saturday_overrides(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[SaturdayOverrideOut] | Response:
    rows = list((await db.execute(select(SaturdayOverride))).scalars().all())

    if format:
        # Masters §3.20 Screen Design names "Export Calendar" explicitly as a
        # Saturday Calendar row action — this list has no query filters of
        # its own, so filters_applied is empty (build_export still stamps the
        # result count / exported-by / exported-at block).
        export_rows = [
            {
                "saturday_date": o.saturday_date, "pattern_says": o.pattern_says, "override_to": o.override_to,
                "hours_required": o.hours_required, "reason": o.reason,
                "notify_affected_employees": "Yes" if o.notify_affected_employees else "No",
            }
            for o in rows
        ]
        return await list_export.build_export(format, db, current_user, "Saturday Calendar", _SATURDAY_LIST_COLUMNS, export_rows, {})

    return [apply_field_masking(SaturdayOverrideOut.model_validate(o).model_dump(), perms) for o in rows]


@saturday_router.post("", response_model=None, status_code=status.HTTP_201_CREATED)
async def create_saturday_override(
    body: SaturdayOverrideWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="override_saturday")),
) -> dict:
    if body.saturday_date.isoweekday() != 6:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="saturday_date must actually be a Saturday")

    pattern_says = None
    if body.work_week_policy_id is not None:
        policy = await db.get(WorkWeekPolicy, body.work_week_policy_id)
        if policy is not None:
            pattern_says = _resolve_saturday_pattern(body.saturday_date, policy.saturday_rule)

    row = SaturdayOverride(id=str(uuid.uuid4()), pattern_says=pattern_says, created_by=current_user.id, updated_by=current_user.id, **body.model_dump())
    db.add(row)
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc) from exc
    await db.refresh(row)
    return apply_field_masking(SaturdayOverrideOut.model_validate(row).model_dump(), perms)
