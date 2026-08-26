"""Layer 4 — scope, injected into a query BEFORE any filter (RBAC §2.2b,
Invariant 5: 'role scope is applied before filters, always').

Financial Year has_scope=False (company-wide, singular — Masters §3.1), so it
never reached this module in Phase 0. Employee (Phase 2) is the first module
with real per-row ownership, and it settled what "owner" means here: NOT
current_user.id directly (most Employee/Leave tables key on employee_id, and
User.id != Employee.id), but whatever id the caller resolves as "my own
record's id" — see app/services/org_scope.py for the one shared resolver
(Employee.id via Employee.user_id, and direct-report Employee.ids for 'team').
Passed in explicitly as `owner_id` rather than assumed, so this module never
has to guess which column on which table a user's own identity maps to.
"""

from sqlalchemy import ColumnElement
from sqlalchemy.sql import Select

from app.rbac.resolver import PermissionSet


def apply_scope(
    stmt: Select,
    perms: PermissionSet,
    *,
    owner_column: ColumnElement,
    owner_id: str | None,
    team_member_ids: list[str] | None = None,
) -> Select:
    """Narrows `stmt` to what this PermissionSet's scope allows. Callers pass
    the specific ownership column (e.g. Employee.id, LeaveRequest.employee_id)
    and the caller's own id in that same id-space (typically from
    org_scope.get_own_employee_id) rather than this module guessing either.

    `owner_id` may be None (the caller has no linked Employee row at all, e.g.
    a platform-only Super Admin account) — 'own'/'team' then correctly resolve
    to an empty result set rather than raising, since comparing a NOT NULL FK
    column to NULL matches nothing.
    """
    if perms.mode in ("full", "view"):
        return stmt  # all records
    if perms.mode == "own":
        return stmt.where(owner_column == owner_id)
    if perms.mode in ("team", "view_team"):
        if team_member_ids is None:
            raise NotImplementedError(
                "Team scope requires the caller to resolve direct-report ids first — "
                "see app.services.org_scope.get_direct_report_employee_ids."
            )
        ids = team_member_ids + ([owner_id] if owner_id is not None else [])
        if not ids:
            return stmt.where(False)
        return stmt.where(owner_column.in_(ids))
    # mode == 'none' should never reach here — require_screen already blocked it.
    raise ValueError(f"apply_scope called with unscoped mode: {perms.mode!r}")
