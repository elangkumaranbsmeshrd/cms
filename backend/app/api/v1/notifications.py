"""Employee §2.11 Personal Notifications — every logged-in user's own inbox.
No RBAC screen gate: this isn't a screen with role-differentiated access,
it's each account's own notification feed, same reasoning as auth's
change-password.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Notification
from app.models.platform import User
from app.schemas.notifications import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Where a notification takes you when you click it. deep_link_path is part of
# the response contract (topbar.component.ts does
# `router.navigateByUrl(n.deep_link_path)` when it is set) but notify() has an
# optional `deep_link_path=` parameter that not one of its call sites passes, so
# every stored row is NULL and every notification in the bell is dead. Derived
# here from notification_type instead of left null: a notification is always
# addressed to the person the record is ABOUT, so the destination is that
# person's own self-service screen for that record type — or the record's own
# detail route where one exists (Ticket, Credit Note are the only two).
#
# Every path below is a real, verified route in frontend/src/app (see
# layout/nav-registry.ts's SCREEN_ROUTES and features/*/*.routes.ts) — a
# fabricated one would send the router to the '**' catch-all. A stored
# deep_link_path always wins, so a call site that starts passing a more precise
# path (the better long-term fix — see this module's note in the sweep report)
# needs no change here.
_DEEP_LINKS: dict[str, str] = {
    "ASSET": "/my-assets",
    "COMPENSATORY_HOURS": "/leave/compensatory-hours",
    "CREDIT_NOTE": "/credit-notes/{id}",
    "DOCUMENT": "/my-documents",
    "EXPENSE": "/my-expenses",
    "LEAVE": "/my-leave",
    "ONBOARDING": "/my-profile",
    "PAYSLIP": "/my-payslips",
    "PROFILE_CHANGE": "/my-profile",
    "TICKET": "/tickets/{id}",
}


def _to_out(row: Notification) -> NotificationOut:
    """Serialise one row, filling in deep_link_path when the stored column is
    null. Built through the schema rather than by assigning to the ORM object,
    so a derived value can never be flushed back into the table by a later
    commit on the same session (mark_read below commits on the very row it
    returns)."""
    out = NotificationOut.model_validate(row)
    if out.deep_link_path:
        return out
    template = _DEEP_LINKS.get(row.notification_type)
    if template is None:
        return out
    if "{id}" in template:
        if not row.source_record_id:
            return out
        template = template.replace("{id}", row.source_record_id)
    return out.model_copy(update={"deep_link_path": template})


@router.get("", response_model=list[NotificationOut])
async def list_my_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    unread_only: bool = Query(False),
    limit: int = Query(50, le=200),
) -> list[NotificationOut]:
    stmt = select(Notification).where(Notification.recipient_user_id == current_user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    return [_to_out(r) for r in (await db.execute(stmt)).scalars().all()]


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int]:
    count = (
        await db.execute(
            select(func.count()).select_from(Notification).where(Notification.recipient_user_id == current_user.id, Notification.is_read.is_(False))
        )
    ).scalar_one()
    return {"unread_count": count}


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationOut:
    row = await db.get(Notification, notification_id)
    if row is None or row.recipient_user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_read = True
    row.updated_by = current_user.id
    await db.commit()
    # read_at is stamped by trg_notifications_stamp_read (BEFORE UPDATE),
    # not set here — refresh to pick up the DB's own timestamp.
    await db.refresh(row)
    return _to_out(row)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await db.execute(
        update(Notification).where(Notification.recipient_user_id == current_user.id, Notification.is_read.is_(False)).values(is_read=True, updated_by=current_user.id)
    )
    await db.commit()
