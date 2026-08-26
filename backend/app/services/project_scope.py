"""Resolves "am I on this Project's team" — Project's own scoping concept,
distinct from org_scope.py's employee-reporting-hierarchy 'own'/'team'/
'view_team' (a Project's team is a Lead + a Members roster, unrelated to who
reports to whom). Reused identically by every Project-family screen
(Directory, Board, Sprints, Milestones) wherever an Employee-role caller's
`perms.mode == 'own'` needs a real per-project membership check, not just a
role check — the same "list endpoint scoped, single-record endpoint needs
its own explicit check" lesson the Phase 2 audit already forced onto
org_scope.py's own assert_employee_in_scope().
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember


async def is_project_team_member(db: AsyncSession, project: Project, employee_id: str | None) -> bool:
    if employee_id is None:
        return False
    if project.project_lead_id == employee_id:
        return True
    member = (
        await db.execute(select(ProjectMember.id).where(ProjectMember.project_id == project.id, ProjectMember.employee_id == employee_id))
    ).first()
    return member is not None


async def team_project_ids(db: AsyncSession, employee_id: str) -> set[str]:
    """Every project id this employee is Lead or Member on — used to scope
    the Directory/Board/Sprints/Milestones LIST endpoints for an Employee-
    role caller (mode == 'own').
    """
    led = (await db.execute(select(Project.id).where(Project.project_lead_id == employee_id))).scalars().all()
    member_of = (await db.execute(select(ProjectMember.project_id).where(ProjectMember.employee_id == employee_id))).scalars().all()
    return set(led) | set(member_of)


async def assert_project_scope(db: AsyncSession, perms, employee_id: str | None, project: Project) -> None:
    """Raises 404 (matching this codebase's "an out-of-scope record looks
    like it doesn't exist" convention) unless `perms.mode` allows this
    specific project — 'full' always passes; 'own' requires real team
    membership.
    """
    from fastapi import HTTPException, status

    if perms.mode == "full":
        return
    if perms.mode == "own" and await is_project_team_member(db, project, employee_id):
        return
    raise HTTPException(status.HTTP_404_NOT_FOUND)
