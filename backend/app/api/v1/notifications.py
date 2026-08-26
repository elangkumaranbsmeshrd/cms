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


@router.get("", response_model=list[NotificationOut])
async def list_my_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    unread_only: bool = Query(False),
    limit: int = Query(50, le=200),
) -> list[Notification]:
    stmt = select(Notification).where(Notification.recipient_user_id == current_user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


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
) -> Notification:
    row = await db.get(Notification, notification_id)
    if row is None or row.recipient_user_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.is_read = True
    row.updated_by = current_user.id
    await db.commit()
    # read_at is stamped by trg_notifications_stamp_read (BEFORE UPDATE),
    # not set here — refresh to pick up the DB's own timestamp.
    await db.refresh(row)
    return row


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    await db.execute(
        update(Notification).where(Notification.recipient_user_id == current_user.id, Notification.is_read.is_(False)).values(is_read=True, updated_by=current_user.id)
    )
    await db.commit()
