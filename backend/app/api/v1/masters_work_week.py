"""Masters §3.20 — Work Week & Hours. Policies (with the derived
Net Working Hours field and the "exactly one active Company-wide policy"
DB guard proven live in Phase 1's verification pass), Saturday Overrides, and
Pay Cycle (§3.20's own inner tab — "the date window a payroll run actually
covers", added 2026-07-30 on explicit instruction).

The Saturday Calendar and Resolved Periods tabs are READ views computed from
this data (52 rows a year, three months' preview). Both are BUILT here now,
and neither re-derives anything: `list_saturday_calendar` resolves each date
through `attendance_engine.resolve_day` and `list_resolved_periods` through
`payroll_engine.resolve_pay_period` — the same two functions Record Attendance
and Run Payroll pay people by, so a preview can never disagree with the run.
The Pay Cycle tab's Cutoff Reconciliation table is the one view still
outstanding: unlike these two it needs live dated events (leave, attendance
corrections, adjustments) sitting past a closed cutoff, which is Payroll's own
data rather than a Masters read.
"""

import calendar
import logging
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import apply_field_masking
from app.models.masters import Holiday, PayCycle, SaturdayOverride, WorkWeekPolicy
from app.models.numbering import FinancialYear
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
from app.services.attendance_engine import (
    SaturdayOverrideSnapshot,
    WorkWeekPolicySnapshot,
    resolve_day,
    saturday_ordinal,
)
from app.services.pdf_engine import ColumnSpec
from app.services.payroll_engine import resolve_pay_period

router = APIRouter(prefix="/masters/work-week-policies", tags=["masters"])
SCREEN = "masters.work_week_hours"

# Masters §3.20c, Screen Design — Pay Cycle tab: "a Resolved Periods table
# previewing three consecutive months' actual date ranges and Salary Credited
# date". Three is the spec's own number, not a page size.
_RESOLVED_PERIOD_PREVIEW_MONTHS = 3

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

# Masters §3.20 Screen Design, Saturday Calendar: "Month, Date, Which
# (1st…5th), Pattern Says, Actually, Hours Required, Override/Note." The
# resolved 52-row view, not the handful of manual override rows below it —
# this is the set "Export Calendar" was always meant to produce ("the file HR
# circulates at the start of the year").
_SATURDAY_CALENDAR_COLUMNS = [
    ColumnSpec("month", "Month"),
    ColumnSpec("saturday_date", "Date"),
    ColumnSpec("which", "Which"),
    ColumnSpec("pattern_says", "Pattern Says"),
    ColumnSpec("actually", "Actually"),
    ColumnSpec("hours_required", "Hours Required", align="right"),
    ColumnSpec("note", "Override / Note"),
]

# The manually created override rows, exported as they are listed. §3.20's own
# "Export Calendar — the file HR circulates at the start of the year" is the
# resolved 52-row export above (_SATURDAY_CALENDAR_COLUMNS); this narrower one
# is the audit trail of what somebody overrode by hand, with the Reason each
# one is required to carry.
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


@router.get("/options", response_model=None)
async def list_policy_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False, description="A past attendance period may name a since-retired policy and still needs its label to resolve"),
) -> list[dict]:
    """The `label_field`/`/options` contract masters_lookup.py documents,
    applied to Work Week Policies: `masters.work_week_hours` is Super-Admin-full,
    Manager/HR view, and nothing at all for Accountant and Employee
    (seed.py:123), while Payroll → Attendance labels the policy each employee
    resolved under. Gated on plain authentication only; selects `policy_name`
    and nothing else, so the hours arithmetic this master is really about
    (gross/break/net hours, weekly target, Saturday rule, compensation window)
    stays behind the real screen permission.
    """
    stmt = select(WorkWeekPolicy.id, WorkWeekPolicy.policy_name, WorkWeekPolicy.is_active)
    if not include_inactive:
        stmt = stmt.where(WorkWeekPolicy.is_active.is_(True))
    rows = (await db.execute(stmt)).all()
    return [{"id": row_id, "label": policy_name, "is_active": is_active} for row_id, policy_name, is_active in rows]


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


# ------------------------------------------------------ Saturday Calendar
_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_ORDINALS = ("1st", "2nd", "3rd", "4th", "5th")
_ISO_SATURDAY = 6

# What resolve_day's day_type means on a Saturday, in the words §3.20's own
# Screen Design uses for the "Actually" column (and the prototype's
# satCalendar rows: Working / Week Off / Holiday).
_DAY_TYPE_LABEL = {
    "WORKING_SATURDAY": "Working",
    "WEEKLY_OFF": "Week Off",
    "MANDATORY_HOLIDAY": "Holiday",
}


def _is_last_saturday(d: date) -> bool:
    return d.day + 7 > calendar.monthrange(d.year, d.month)[1]


@router.get("/saturday-calendar", response_model=None)
async def list_saturday_calendar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None, description="Defaults to the Financial Year currently marked current"),
    policy_id: str | None = Query(None, description="Defaults to the active Company-wide policy"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    """Masters §3.20's **Saturday Calendar** tab: "every Saturday of the active
    Financial Year resolved from the rule: Month, Date, Which (1st…5th),
    Pattern Says, Actually, Hours Required, Override/Note. Fifty-two rows for
    FY 2026–27."

    A derived read view — nothing here is stored, exactly like Resolved
    Periods below. And, for the same reason that one calls Payroll's own
    resolve_pay_period rather than re-deriving the window, every row here is
    resolved by **attendance_engine.resolve_day** — the one function Record
    Attendance and Run Payroll already resolve a real day with. A second copy
    of the precedence rule (dated override > Mandatory holiday > Saturday
    pattern) would be free to drift from the one people are actually paid by,
    which would make this calendar worse than not having it: HR circulates it
    at the start of the year.

    Empty rather than an error when there is no current Financial Year or no
    policy to resolve against — there is simply no calendar to draw yet, the
    same way an unset Pay Cycle resolves no periods.
    """
    if financial_year_id:
        fy = await db.get(FinancialYear, financial_year_id)
    else:
        fy = (await db.execute(select(FinancialYear).where(FinancialYear.is_current.is_(True)))).scalar_one_or_none()
    if fy is None:
        return [] if not format else await list_export.build_export(format, db, current_user, "Saturday Calendar", _SATURDAY_CALENDAR_COLUMNS, [], {})

    if policy_id:
        policy = await db.get(WorkWeekPolicy, policy_id)
    else:
        # §3.20: "Company-wide is the fallback. Exactly one Company-wide
        # policy may be Active at a time" — so the company's own calendar is
        # that policy's. A narrower policy covers specific people, not the
        # year everyone reads off the wall.
        policy = (
            await db.execute(
                select(WorkWeekPolicy).where(WorkWeekPolicy.applies_to == "COMPANY_WIDE", WorkWeekPolicy.is_active.is_(True))
            )
        ).scalar_one_or_none()
    if policy is None:
        return [] if not format else await list_export.build_export(format, db, current_user, "Saturday Calendar", _SATURDAY_CALENDAR_COLUMNS, [], {})

    snapshot = WorkWeekPolicySnapshot(
        net_working_hours_per_day=policy.net_working_hours_per_day,
        grace_window_minutes=policy.grace_window_minutes,
        half_day_threshold_hours=policy.half_day_threshold_hours,
        weekly_off_days=policy.weekly_off_days,
        saturday_rule=policy.saturday_rule,
        working_saturday_hours_mode=policy.working_saturday_hours_mode,
        custom_saturday_hours=policy.custom_saturday_hours,
        mandatory_holiday_overrides_saturday=policy.mandatory_holiday_overrides_saturday,
    )

    holidays = (
        await db.execute(
            select(Holiday).where(
                Holiday.financial_year_id == fy.id,
                Holiday.is_active.is_(True),
                Holiday.holiday_date.between(fy.start_date, fy.end_date),
            )
        )
    ).scalars().all()
    holiday_by_date: dict[date, Holiday] = {}
    for h in holidays:
        # A Mandatory holiday is the one that can take a working Saturday off
        # it, so it wins the slot if two land on the same date.
        existing = holiday_by_date.get(h.holiday_date)
        if existing is None or (existing.holiday_type != "MANDATORY" and h.holiday_type == "MANDATORY"):
            holiday_by_date[h.holiday_date] = h

    overrides = (
        await db.execute(
            select(SaturdayOverride).where(
                SaturdayOverride.saturday_date.between(fy.start_date, fy.end_date),
                (SaturdayOverride.work_week_policy_id == policy.id) | (SaturdayOverride.work_week_policy_id.is_(None)),
            )
        )
    ).scalars().all()
    override_by_date = {o.saturday_date: o for o in overrides}

    # First Saturday on or after the year opens, then every seventh day.
    cursor = fy.start_date + timedelta(days=(_ISO_SATURDAY - fy.start_date.isoweekday()) % 7)
    rows: list[dict] = []
    while cursor <= fy.end_date:
        holiday = holiday_by_date.get(cursor)
        override = override_by_date.get(cursor)
        resolution = resolve_day(
            cursor,
            snapshot,
            is_mandatory_holiday=holiday is not None and holiday.holiday_type == "MANDATORY",
            is_optional_holiday=holiday is not None and holiday.holiday_type == "OPTIONAL",
            saturday_override=(
                SaturdayOverrideSnapshot(override_to=override.override_to, hours_required=override.hours_required)
                if override is not None
                else None
            ),
            is_last_saturday_of_month=_is_last_saturday(cursor),
        )

        # "Pattern Says" is what the rule ALONE would have said, before any
        # holiday or override — the column exists precisely so a reader can
        # see which of the two answers won, and why.
        pattern = _resolve_saturday_pattern(cursor, policy.saturday_rule)
        if policy.saturday_rule == "LAST_ONLY":
            pattern = "WORKING" if _is_last_saturday(cursor) else "WEEK_OFF"

        if override is not None:
            note = f"Overridden to {_DAY_TYPE_LABEL.get(resolution.day_type, resolution.day_type)} — {override.reason}"
        elif holiday is not None and holiday.holiday_type == "MANDATORY":
            note = (
                f"{holiday.name} — a Mandatory holiday overrides the Saturday rule"
                if policy.mandatory_holiday_overrides_saturday
                else f"{holiday.name} — Mandatory, but this policy does not let a holiday override the Saturday rule"
            )
        elif holiday is not None:
            note = f"{holiday.name} — an Optional holiday never overrides; anyone taking it draws on their leave balance"
        else:
            note = ""

        rows.append({
            "id": cursor.isoformat(),  # a resolved date, not a record id — nothing here is stored
            "month": f"{_MONTH_ABBR[cursor.month - 1]} {cursor.year}",
            "saturday_date": cursor.isoformat(),
            "which": _ORDINALS[saturday_ordinal(cursor) - 1],
            "pattern_says": "Working" if pattern == "WORKING" else "Week Off",
            "actually": _DAY_TYPE_LABEL.get(resolution.day_type, resolution.day_type),
            "hours_required": float(resolution.required_hours),
            "note": note,
        })
        cursor += timedelta(days=7)

    if format:
        # RBAC §2.2(f): the export is exactly the set on screen, and the two
        # things that decide that set (which year, which policy) are stamped
        # into the file's own Filters block rather than left implicit.
        filters_applied = {"financial_year": fy.label, "policy": policy.policy_name}
        return await list_export.build_export(format, db, current_user, "Saturday Calendar", _SATURDAY_CALENDAR_COLUMNS, rows, filters_applied)

    return [apply_field_masking(row, perms) for row in rows]


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


@pay_cycle_router.get("/resolved-periods", response_model=None)
async def list_resolved_periods(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
) -> list[dict]:
    """Masters §3.20c's **Resolved Periods**: "Read-only, derived... Not
    stored — computed live from Start Day, End Day and Salary Credit Day for
    whichever months are being previewed, so the effect of a change is
    visible before it's saved."

    §3.20's Implementation Status defers this view to "frontend work against
    Payroll's resolution" — so it is Payroll's own resolve_pay_period that
    answers here, called three times, rather than a second copy of the
    clamping and no-overlap rules that would be free to drift from the one
    Run Payroll actually pays people by. The frontend has no equivalent
    resolver and must not grow one for the same reason.

    Three consecutive months from today, per the spec's own wording
    ("previewing three consecutive months' actual date ranges and Salary
    Credited date"). No active cycle yet means no window to resolve, which
    is an empty preview, not an error.
    """
    cycle = (await db.execute(select(PayCycle).where(PayCycle.is_active.is_(True)))).scalar_one_or_none()
    if cycle is None:
        return []

    today = date.today()
    out: list[dict] = []
    for offset in range(_RESOLVED_PERIOD_PREVIEW_MONTHS):
        month = (today.month - 1 + offset) % 12 + 1
        year = today.year + (today.month - 1 + offset) // 12
        resolution = resolve_pay_period(month, year, cycle.cycle_type, cycle.start_day, cycle.end_day, cycle.salary_credit_day)
        out.append(
            apply_field_masking(
                {
                    # The month a person asks Run Payroll for — NOT the month
                    # the window happens to start in, which on a 26th–25th
                    # cycle is the previous one. Naming it the way the payroll
                    # run names it is the whole point of the preview.
                    "id": f"{year}-{month:02d}",
                    "payroll_month": f"{calendar.month_name[month]} {year}",
                    "period_start": resolution.period_start.isoformat(),
                    "period_end": resolution.period_end.isoformat(),
                    "salary_credit_date": resolution.salary_credit_date.isoformat(),
                    "days_in_period": (resolution.period_end - resolution.period_start).days + 1,
                },
                perms,
            )
        )
    return out


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
        # Titled "Saturday Overrides", not "Saturday Calendar": §3.20's own
        # "Export Calendar" is list_saturday_calendar's fifty-two-row export,
        # and two files claiming the same name would be worse than either. This
        # list has no query filters of its own, so filters_applied is empty
        # (build_export still stamps the result count / exported-by /
        # exported-at block).
        export_rows = [
            {
                "saturday_date": o.saturday_date, "pattern_says": o.pattern_says, "override_to": o.override_to,
                "hours_required": o.hours_required, "reason": o.reason,
                "notify_affected_employees": "Yes" if o.notify_affected_employees else "No",
            }
            for o in rows
        ]
        return await list_export.build_export(format, db, current_user, "Saturday Overrides", _SATURDAY_LIST_COLUMNS, export_rows, {})

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
