"""Personal Notifications (Employee §2.11) — a thin, reusable creator so
every router that needs to notify someone does it the same way. Found with
a full table and zero writers anywhere by the Phase 2 audit; wired in now at
the highest-value decision points (leave/comp-hours approval, document
verification, profile-change decisions) rather than every single mutation —
retrofitting every action across the whole backend is future work, flagged
here rather than silently left incomplete.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Notification


def notify(
    db: AsyncSession,
    *,
    recipient_user_id: str | None,
    notification_type: str,
    title: str,
    body: str,
    source_module: str,
    actor_user_id: str,
    source_record_id: str | None = None,
    deep_link_path: str | None = None,
) -> None:
    if recipient_user_id is None:
        return  # e.g. an employee record with no linked login yet — nothing to notify
    db.add(Notification(
        id=str(uuid.uuid4()), recipient_user_id=recipient_user_id, notification_type=notification_type,
        title=title, body=body, source_module=source_module, source_record_id=source_record_id,
        deep_link_path=deep_link_path, created_by=actor_user_id, updated_by=actor_user_id,
    ))
