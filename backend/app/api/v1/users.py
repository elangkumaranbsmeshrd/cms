"""A minimal platform-User id -> display name lookup.

Confirmed absent everywhere else in this backend: dozens of response fields
across Ticket/Project/Asset/Payroll/Leave/Tax & Compliance/Opportunity carry
a raw `users.id` (who raised/approved/logged/ran/processed/voided something)
with no endpoint anywhere that resolves it to a name — every one of those
screens was shipped showing a truncated raw id instead.

Authorization model mirrors files.py's own, for the identical reason: "any
authenticated user... downloading isn't more sensitive than the parent
record's other fields the caller can already see." A user id is already
visible in whatever screen the caller is looking at (they can already see
the Ticket/Payslip/Asset/etc. that names it) — resolving it to a name here
exposes nothing the caller couldn't already see, and there's no natural
single "owning" screen to gate this on since nearly every module needs it.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.platform import User

router = APIRouter(prefix="/users", tags=["users"])


class UserLookupOut(BaseModel):
    id: str
    name: str


@router.get("", response_model=list[UserLookupOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserLookupOut]:
    rows = (await db.execute(select(User.id, User.full_name).where(User.is_enabled.is_(True)))).all()
    return [UserLookupOut(id=r.id, name=r.full_name) for r in rows]
