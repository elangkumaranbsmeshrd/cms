"""Project (10-project-module.md) — the one piece of cross-table logic
genuinely worth sharing: a Milestone's linked-task progress rollup, read by
both the Milestones list and single-record views so the two can't disagree.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import MilestoneTask, Task


async def milestone_progress(db: AsyncSession, milestone_id: str) -> tuple[int, int] | None:
    """§2.8, A183: "when set, the milestone displays how many of its linked
    tasks are Done (e.g. '3/5 tasks done')." Returns (done_count,
    total_count), or None if this milestone has no linked tasks at all —
    Linked Tasks is optional, and a milestone with none has nothing to roll up.
    """
    task_ids = (await db.execute(select(MilestoneTask.task_id).where(MilestoneTask.milestone_id == milestone_id))).scalars().all()
    if not task_ids:
        return None
    statuses = (await db.execute(select(Task.status).where(Task.id.in_(task_ids)))).scalars().all()
    done_count = sum(1 for s in statuses if s == "DONE")
    return done_count, len(statuses)
