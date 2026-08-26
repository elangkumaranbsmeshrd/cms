"""Leave §2.5 Leave Reports — read-only aggregation. Found entirely
unimplemented by the Phase 2 audit, which left Accountant's read access here
(§6: their only capability anywhere in this module) with nothing to read.

Phase 6: expanded to the full documented view set — "Leave taken by Type",
"Leave taken by Department", "Leave taken by Employee", and the "Leave
Liability" headline figure — sharing one filter helper (`_filtered_balances`)
so the four views can never drift apart, per §2.5's own requirement: "All
filters apply across all four report views simultaneously... switching from
'by Type' to 'Leave Liability' never silently changes the underlying set."

Two filters from §2.5's list are deliberately not implemented, same "left
out rather than invented" stance the original single-view file already took
for a currency-valued liability figure (this revision found that reading
wrong — see `_effective_remaining` — but the reasoning style carries over):

  - **Date Range.** This report is built on LeaveBalance, one row per
    employee per Leave Type per Financial Year — a per-year aggregate with
    no day-by-day breakdown to slice by an arbitrary From/To. Financial
    Year is the real grain this data supports and is already a filter here;
    a bolted-on date-range control over data that can't actually honour it
    would be exactly the "figure that quietly reflects a different filter"
    §2.5 itself warns against. RBAC §2.2(c) permits omitting a baseline
    filter "the dimension genuinely doesn't exist on that data."
  - **Search**, on the by-Type and by-Department views only — rows there are
    a handful of category labels (Leave Types, Departments), not named
    records; RBAC §2.2's own precedent (Section 4.3's override table) is
    that a search box over a short taxonomy list is theatre. Search *is*
    wired on Leave taken by Employee, where rows are real named records.

Leave Liability is genuinely not list-shaped (a single headline figure), so
per this phase's own instruction it carries no PDF/Excel export — the other
three views do, via list_export.build_export like every other list screen.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Employee
from app.models.leave import LeaveBalance
from app.models.masters import Department, LeaveType
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.services import list_export
from app.services.numbering import get_current_financial_year
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/leave/reports", tags=["leave"])
SCREEN = "leave.reports"

# Every figure here is a day count, never currency — right-aligned per the
# house rule (money=left, counts/quantities/days=right). "Employees" is a
# headcount, also right-aligned by the same rule.
_BY_TYPE_COLUMNS = [
    ColumnSpec("leave_type_name", "Leave Type"),
    ColumnSpec("employee_count", "Employees", align="right"),
    ColumnSpec("total_allowed_days", "Allowed", align="right"),
    ColumnSpec("total_carried_forward_days", "Carried Fwd", align="right"),
    ColumnSpec("total_taken_days", "Taken", align="right"),
    ColumnSpec("total_pending_days", "Pending", align="right"),
    ColumnSpec("total_remaining_days", "Remaining", align="right"),
]
_BY_DEPARTMENT_COLUMNS = [
    ColumnSpec("department_name", "Department"),
    ColumnSpec("employee_count", "Employees", align="right"),
    ColumnSpec("total_allowed_days", "Allowed", align="right"),
    ColumnSpec("total_carried_forward_days", "Carried Fwd", align="right"),
    ColumnSpec("total_taken_days", "Taken", align="right"),
    ColumnSpec("total_pending_days", "Pending", align="right"),
    ColumnSpec("total_remaining_days", "Remaining", align="right"),
]
_BY_EMPLOYEE_COLUMNS = [
    ColumnSpec("employee_name", "Employee"),
    ColumnSpec("department_name", "Department"),
    ColumnSpec("total_allowed_days", "Allowed", align="right"),
    ColumnSpec("total_carried_forward_days", "Carried Fwd", align="right"),
    ColumnSpec("total_taken_days", "Taken", align="right"),
    ColumnSpec("total_pending_days", "Pending", align="right"),
    ColumnSpec("total_remaining_days", "Remaining", align="right"),
]


async def _filtered_balances(
    db: AsyncSession,
    financial_year_id: str | None,
    department_id: str | None,
    leave_type_id: str | None,
    designation_id: str | None,
    employment_type_id: str | None,
    reporting_manager_id: str | None,
    employee_status: str | None,
) -> tuple[str, list[tuple[LeaveBalance, Employee, str, str]]]:
    """(balance, employee, leave_type_name, department_name) rows, joined
    and filtered once — shared by every §2.5 view. Returns the resolved
    financial_year_id alongside the rows since callers need it for the
    header block / Liability's own response.
    """
    fy_id = financial_year_id or (await get_current_financial_year(db)).id
    stmt = (
        select(LeaveBalance, Employee, LeaveType.name, Department.name)
        .join(Employee, Employee.id == LeaveBalance.employee_id)
        .join(LeaveType, LeaveType.id == LeaveBalance.leave_type_id)
        .join(Department, Department.id == Employee.department_id)
        .where(LeaveBalance.financial_year_id == fy_id)
    )
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if leave_type_id:
        stmt = stmt.where(LeaveBalance.leave_type_id == leave_type_id)
    if designation_id:
        stmt = stmt.where(Employee.designation_id == designation_id)
    if employment_type_id:
        stmt = stmt.where(Employee.employment_type_id == employment_type_id)
    if reporting_manager_id:
        stmt = stmt.where(Employee.reporting_manager_id == reporting_manager_id)
    if employee_status:
        stmt = stmt.where(Employee.employment_status == employee_status)
    rows = (await db.execute(stmt)).all()
    return fy_id, list(rows)


def _effective_remaining(balance: LeaveBalance, leave_status: list[str] | None) -> Decimal:
    """§2.5: "Leave Status ... so a report can include or exclude Pending
    requests, which materially changes a liability figure." remaining_days
    is a DB-computed column that already nets Pending out (allowed +
    carried_forward + adjustment - taken - pending). When the caller narrows
    Leave Status to APPROVED only (i.e. excludes PENDING), Pending is added
    back here so a not-yet-decided request doesn't move a figure that's
    meant to reflect only what's been formally approved.
    """
    if leave_status and "PENDING" not in {s.upper() for s in leave_status}:
        return balance.remaining_days + balance.pending_days
    return balance.remaining_days


def _employee_label(employee: Employee) -> str:
    return f"{employee.first_name} {employee.last_name or ''}".strip()


# ============================================================== BY TYPE
@router.get("/balances-summary", response_model=None)
async def balances_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None, description="Defaults to the current Financial Year"),
    department_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    employee_status: str | None = Query(None),
    leave_status: list[str] | None = Query(None, description="PENDING and/or APPROVED — narrows what counts against Remaining"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    fy_id, rows = await _filtered_balances(
        db, financial_year_id, department_id, leave_type_id, designation_id, employment_type_id, reporting_manager_id, employee_status,
    )

    totals: dict[str, dict] = {}
    # "Employees" is a headcount, so it counts distinct employees, never
    # balance rows — same accumulate-a-set pattern as leave_liability below.
    seen_employees: dict[str, set[str]] = {}
    for balance, employee, leave_type_name, _department_name in rows:
        bucket = totals.setdefault(leave_type_name, {
            "leave_type_name": leave_type_name, "employee_count": 0,
            "total_allowed_days": Decimal("0"), "total_carried_forward_days": Decimal("0"),
            "total_taken_days": Decimal("0"), "total_pending_days": Decimal("0"), "total_remaining_days": Decimal("0"),
        })
        seen_employees.setdefault(leave_type_name, set()).add(employee.id)
        bucket["employee_count"] = len(seen_employees[leave_type_name])
        bucket["total_allowed_days"] += balance.allowed_days
        bucket["total_carried_forward_days"] += balance.carried_forward_days
        bucket["total_taken_days"] += balance.taken_days
        bucket["total_pending_days"] += balance.pending_days
        bucket["total_remaining_days"] += _effective_remaining(balance, leave_status)

    result = sorted(totals.values(), key=lambda b: b["leave_type_name"])

    if format:
        filters_applied = {
            "financial_year_id": fy_id, "department_id": department_id, "leave_type_id": leave_type_id,
            "designation_id": designation_id, "employment_type_id": employment_type_id,
            "reporting_manager_id": reporting_manager_id, "employee_status": employee_status, "leave_status": leave_status,
        }
        return await list_export.build_export(format, db, current_user, "Leave Taken by Type", _BY_TYPE_COLUMNS, result, filters_applied)

    return result


# ======================================================== BY DEPARTMENT
@router.get("/by-department", response_model=None)
async def leave_by_department(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None, description="Defaults to the current Financial Year"),
    department_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    employee_status: str | None = Query(None),
    leave_status: list[str] | None = Query(None, description="PENDING and/or APPROVED — narrows what counts against Remaining"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    fy_id, rows = await _filtered_balances(
        db, financial_year_id, department_id, leave_type_id, designation_id, employment_type_id, reporting_manager_id, employee_status,
    )

    totals: dict[str, dict] = {}
    # An employee holds one balance row per Leave Type, so counting rows here
    # multiplied the headcount by the number of Leave Types (5 employees x 7
    # types reported as 35). Count distinct employees instead — the same
    # accumulate-a-set pattern leave_liability below already uses.
    seen_employees: dict[str, set[str]] = {}
    for balance, employee, _leave_type_name, department_name in rows:
        bucket = totals.setdefault(department_name, {
            "department_name": department_name, "employee_count": 0,
            "total_allowed_days": Decimal("0"), "total_carried_forward_days": Decimal("0"),
            "total_taken_days": Decimal("0"), "total_pending_days": Decimal("0"), "total_remaining_days": Decimal("0"),
        })
        seen_employees.setdefault(department_name, set()).add(employee.id)
        bucket["employee_count"] = len(seen_employees[department_name])
        bucket["total_allowed_days"] += balance.allowed_days
        bucket["total_carried_forward_days"] += balance.carried_forward_days
        bucket["total_taken_days"] += balance.taken_days
        bucket["total_pending_days"] += balance.pending_days
        bucket["total_remaining_days"] += _effective_remaining(balance, leave_status)

    result = sorted(totals.values(), key=lambda b: b["department_name"])

    if format:
        filters_applied = {
            "financial_year_id": fy_id, "department_id": department_id, "leave_type_id": leave_type_id,
            "designation_id": designation_id, "employment_type_id": employment_type_id,
            "reporting_manager_id": reporting_manager_id, "employee_status": employee_status, "leave_status": leave_status,
        }
        return await list_export.build_export(format, db, current_user, "Leave Taken by Department", _BY_DEPARTMENT_COLUMNS, result, filters_applied)

    return result


# =========================================================== BY EMPLOYEE
@router.get("/by-employee", response_model=None)
async def leave_by_employee(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None, description="Defaults to the current Financial Year"),
    department_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    employee_status: str | None = Query(None),
    leave_status: list[str] | None = Query(None, description="PENDING and/or APPROVED — narrows what counts against Remaining"),
    search: str | None = Query(None, description="Matches Employee Name, Employee Code"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[dict] | Response:
    fy_id, rows = await _filtered_balances(
        db, financial_year_id, department_id, leave_type_id, designation_id, employment_type_id, reporting_manager_id, employee_status,
    )

    totals: dict[str, dict] = {}
    for balance, employee, _leave_type_name, department_name in rows:
        name = _employee_label(employee)
        if search:
            needle = search.lower()
            if needle not in name.lower() and needle not in employee.employee_code.lower():
                continue
        bucket = totals.setdefault(employee.id, {
            "employee_name": name, "employee_code": employee.employee_code, "department_name": department_name,
            "total_allowed_days": Decimal("0"), "total_carried_forward_days": Decimal("0"),
            "total_taken_days": Decimal("0"), "total_pending_days": Decimal("0"), "total_remaining_days": Decimal("0"),
        })
        bucket["total_allowed_days"] += balance.allowed_days
        bucket["total_carried_forward_days"] += balance.carried_forward_days
        bucket["total_taken_days"] += balance.taken_days
        bucket["total_pending_days"] += balance.pending_days
        bucket["total_remaining_days"] += _effective_remaining(balance, leave_status)

    result = sorted(totals.values(), key=lambda b: b["employee_name"])

    if format:
        filters_applied = {
            "financial_year_id": fy_id, "department_id": department_id, "leave_type_id": leave_type_id,
            "designation_id": designation_id, "employment_type_id": employment_type_id,
            "reporting_manager_id": reporting_manager_id, "employee_status": employee_status, "leave_status": leave_status,
            "search": search,
        }
        return await list_export.build_export(format, db, current_user, "Leave Taken by Employee", _BY_EMPLOYEE_COLUMNS, result, filters_applied)

    return result


# ========================================================= LEAVE LIABILITY
@router.get("/liability")
async def leave_liability(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    financial_year_id: str | None = Query(None, description="Defaults to the current Financial Year"),
    department_id: str | None = Query(None),
    leave_type_id: str | None = Query(None),
    designation_id: str | None = Query(None),
    employment_type_id: str | None = Query(None),
    reporting_manager_id: str | None = Query(None),
    # §2.5: "the total unused leave across every active employee" — Active is
    # the documented default here (unlike the other three views, which carry
    # no default so an already-exited employee's historical Taken/Remaining
    # stays visible unless a caller narrows it). Still overridable, per the
    # baseline convention's own "explicit include inactive option" rule.
    employee_status: str | None = Query("ACTIVE"),
    leave_status: list[str] | None = Query(None, description="PENDING and/or APPROVED — narrows what counts against the liability figure"),
) -> dict:
    fy_id, rows = await _filtered_balances(
        db, financial_year_id, department_id, leave_type_id, designation_id, employment_type_id, reporting_manager_id, employee_status,
    )

    # §2.5 says "sum of Remaining + Carried Forward, in days," but
    # leave_balances.remaining_days (app/models/leave.py) is a real Computed()
    # column already defined as
    # "allowed_days + carried_forward_days + adjustment_days - taken_days - pending_days" —
    # carried_forward_days is folded into it once already. Adding
    # total_carried_forward again here would double-count it and overstate
    # this liability-provisioning figure, so the liability is just the total
    # remaining balance; total_carried_forward_days is still reported
    # separately below for visibility, it just isn't added a second time.
    total_remaining = Decimal("0")
    total_carried_forward = Decimal("0")
    employee_ids: set[str] = set()
    for balance, employee, _leave_type_name, _department_name in rows:
        total_remaining += _effective_remaining(balance, leave_status)
        total_carried_forward += balance.carried_forward_days
        employee_ids.add(employee.id)

    return {
        "financial_year_id": fy_id,
        "employee_count": len(employee_ids),
        "total_remaining_days": total_remaining,
        "total_carried_forward_days": total_carried_forward,
        "leave_liability_days": total_remaining,
    }
