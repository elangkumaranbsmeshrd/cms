"""Resolves "my own employee_id" and "my direct reports' employee_ids" — the
two building blocks app.rbac.scope.apply_scope needs for every Employee/Leave
screen's 'own'/'team' mode. One place, so every router resolves scope
identically rather than each reinventing the join from user_id to employee_id.

'team' is direct reports only (Employee §2.1's access table), not the whole
downline recursively — Manager scope does not walk reporting_manager_id
transitively.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.platform import User
from app.models.rbac import Role


async def get_own_employee_id(db: AsyncSession, user: User) -> str | None:
    return (await db.execute(select(Employee.id).where(Employee.user_id == user.id))).scalar_one_or_none()


async def get_direct_report_employee_ids(db: AsyncSession, manager_employee_id: str) -> list[str]:
    rows = (
        await db.execute(select(Employee.id).where(Employee.reporting_manager_id == manager_employee_id))
    ).scalars().all()
    return list(rows)


async def assert_employee_in_scope(db: AsyncSession, user: User, perms, target_employee_id: str) -> None:
    """Raises 403/404 unless `perms.mode` actually covers `target_employee_id`.

    Needed by every single-record Employee endpoint (get/update Master
    Record, emergency contacts, ...) that isn't already filtered by a scoped
    list query — a `view_team`/`team` role must not be able to reach an
    out-of-scope employee just by guessing/enumerating their id. Found
    missing by the Phase 2 audit: the Directory LIST endpoint applied scope
    correctly, but the single-record endpoints only checked screen
    visibility, not which specific employee_id the caller may act on.
    """
    from fastapi import HTTPException, status  # local import: avoid a hard fastapi dependency in this service module

    if perms.mode in ("full", "view"):
        return
    own_id = await get_own_employee_id(db, user)
    if perms.mode == "own":
        if own_id != target_employee_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You may only access your own record")
        return
    if perms.mode in ("team", "view_team"):
        if target_employee_id == own_id:
            return
        reports = await get_direct_report_employee_ids(db, own_id) if own_id else []
        if target_employee_id not in reports:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not one of your direct reports")
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Access denied")


async def hr_availability(db: AsyncSession, applicant_user_id: str) -> tuple[bool, bool]:
    """(hr_is_available, applicant_is_sole_active_hr) — the two facts
    resolve_routing (Leave §2.2's Approval Routing Rule, rules 3-5) needs
    about the current state of the HR role, resolved once here rather than
    by leave_requests.py and compensatory_hours.py each re-querying it.
    """
    hr_role = (await db.execute(select(Role).where(Role.code == "HR"))).scalar_one_or_none()
    if hr_role is None:
        return False, False
    active_hr_ids = (
        await db.execute(select(User.id).where(User.role_id == hr_role.id, User.is_enabled.is_(True)))
    ).scalars().all()
    hr_is_available = len(active_hr_ids) > 0
    is_sole = len(active_hr_ids) == 1 and active_hr_ids[0] == applicant_user_id
    return hr_is_available, is_sole
