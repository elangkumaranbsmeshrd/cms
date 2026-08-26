"""Employee §2.16 Announcements. Company-wide feed; Manager/Accountant/
Employee get read-only ('view'), HR/Super Admin get the authoring surface
('full' + the 'post' action).
"""

import logging
import uuid
from datetime import date as date_type
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.employee import Announcement, AnnouncementTarget
from app.models.platform import User
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.employee import AnnouncementCreate, AnnouncementOut
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/announcements", tags=["employee"])
SCREEN = "employee.announcements"

_LIST_COLUMNS = [
    ColumnSpec("title", "Title"),
    ColumnSpec("published_date", "Published Date"),
    ColumnSpec("audience", "Audience/Visibility"),
]


logger = logging.getLogger(__name__)


def _as_client_error(exc: DBAPIError, fallback: str) -> HTTPException:
    logger.warning("db constraint violation: %s", exc.orig)
    return HTTPException(status.HTTP_409_CONFLICT, detail=fallback)


async def _to_out(db: AsyncSession, ann: Announcement) -> AnnouncementOut:
    targets = (await db.execute(select(AnnouncementTarget).where(AnnouncementTarget.announcement_id == ann.id))).scalars().all()
    out = AnnouncementOut.model_validate(ann)
    out.department_ids = [t.department_id for t in targets]
    return out


@router.get("", response_model=None)
async def list_announcements(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN)),
    posted_by: str | None = Query(None),
    target_scope: str | None = Query(None, description="ALL_EMPLOYEES | DEPARTMENT"),
    is_active: bool | None = Query(None, description="Active = no expiry date, or expiry date on/after today. Expired = expiry date before today."),
    posted_on_from: date_type | None = Query(None),
    posted_on_to: date_type | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[AnnouncementOut] | Response:
    stmt = select(Announcement)
    if perms.mode == "view":
        stmt = stmt.where(Announcement.status == "PUBLISHED")
    if posted_by:
        stmt = stmt.where(Announcement.posted_by_user_id == posted_by)
    if target_scope:
        stmt = stmt.where(Announcement.target_scope == target_scope)
    if is_active is not None:
        today = date_type.today()
        active_expr = or_(Announcement.expiry_date.is_(None), Announcement.expiry_date >= today)
        stmt = stmt.where(active_expr if is_active else Announcement.expiry_date < today)
    if posted_on_from:
        stmt = stmt.where(Announcement.published_at >= posted_on_from)
    if posted_on_to:
        stmt = stmt.where(Announcement.published_at <= posted_on_to)
    rows = (await db.execute(stmt.order_by(Announcement.created_at.desc()))).scalars().all()

    if format:
        # RBAC §2.2(f): export exactly the filtered/scoped set on screen —
        # same rows the JSON branch below would return, just re-shaped.
        export_rows = [
            {"title": r.title, "published_date": r.published_at, "audience": r.target_scope}
            for r in rows
        ]
        filters_applied = {
            "posted_by": posted_by, "target_scope": target_scope, "is_active": is_active,
            "posted_on_from": posted_on_from, "posted_on_to": posted_on_to,
        }
        return await list_export.build_export(format, db, current_user, "Announcements", _LIST_COLUMNS, export_rows, filters_applied)

    return [await _to_out(db, r) for r in rows]


@router.post("", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    body: AnnouncementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="post")),
) -> AnnouncementOut:
    row = Announcement(
        id=str(uuid.uuid4()), title=body.title, message=body.message, target_scope=body.target_scope,
        posted_by_user_id=current_user.id, expiry_date=body.expiry_date,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    await db.flush()
    for dept_id in body.department_ids:
        db.add(AnnouncementTarget(id=str(uuid.uuid4()), announcement_id=row.id, department_id=dept_id, created_by=current_user.id, updated_by=current_user.id))
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "Rejected by a database constraint") from exc
    await db.refresh(row)
    return await _to_out(db, row)


@router.post("/{announcement_id}/publish", response_model=AnnouncementOut)
async def publish_announcement(
    announcement_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="post")),
) -> AnnouncementOut:
    row = await db.get(Announcement, announcement_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if row.status != "DRAFT":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Only a Draft announcement can be published")
    row.status = "PUBLISHED"
    row.published_at = datetime.now(timezone.utc)
    row.updated_by = current_user.id
    try:
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        raise _as_client_error(exc, "A department-scoped announcement needs at least one target department") from exc
    await db.refresh(row)
    return await _to_out(db, row)


@router.post("/{announcement_id}/archive", response_model=AnnouncementOut)
async def archive_announcement(
    announcement_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(SCREEN, action="post")),
) -> AnnouncementOut:
    row = await db.get(Announcement, announcement_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    row.status = "ARCHIVED"
    row.updated_by = current_user.id
    await db.commit()
    await db.refresh(row)
    return await _to_out(db, row)
