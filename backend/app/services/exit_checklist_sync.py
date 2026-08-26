"""Keeps exit_checklist_steps.outstanding_asset_count (0003_employee_leave.py)
truthful whenever an asset's assignment changes — called from Asset
Management (03) on every Assign/Transfer/Unassign/Reclaim. Without this, the
count stays frozen at its default of 0 forever, and the RETURN_ALL_ASSETS
step's own DB gate trigger (trg_ecs_enforce_gate) is trivially satisfied even
while the employee still holds assets.

Per Appendix B's "ZERO-ASSET CASE": the step completes automatically the
instant the count reaches zero while it's Open — there is no manual
"Complete" action for this step, and the trigger's own "cannot move
backwards" rule means this function is the only thing that can ever
legitimately clear it.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession


async def sync_outstanding_assets(db: AsyncSession, employee_id: str, actor_user_id: str) -> None:
    from app.models.asset import Asset
    from app.models.employee import ExitChecklistStep

    step = (
        await db.execute(
            select(ExitChecklistStep).where(
                ExitChecklistStep.employee_id == employee_id,
                ExitChecklistStep.step_key == "RETURN_ALL_ASSETS",
                ExitChecklistStep.status != "DONE",
            )
        )
    ).scalar_one_or_none()
    if step is None:
        return

    held = (
        await db.execute(select(Asset.id).where(Asset.assigned_to == employee_id, Asset.status == "IN_USE"))
    ).scalars().all()
    step.outstanding_asset_count = len(held)
    step.updated_by = actor_user_id

    if step.status == "OPEN" and step.outstanding_asset_count == 0:
        step.status = "DONE"
        step.completed_by = actor_user_id
        step.completed_at = datetime.now(timezone.utc)
        step.confirmation_acknowledged = True
        step.completion_note = "Auto-completed: no assets remain assigned to this employee."
        await db.execute(
            update(ExitChecklistStep)
            .where(ExitChecklistStep.gated_by_step_id == step.id, ExitChecklistStep.status == "LOCKED")
            .values(status="OPEN")
        )
