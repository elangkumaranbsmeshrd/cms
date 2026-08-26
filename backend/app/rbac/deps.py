"""The FastAPI dependency every protected route uses. This is where Invariant
2 ("the API is the authority on permissions") actually gets enforced — not in
the frontend, which only mirrors this for UX.
"""

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.platform import User
from app.models.rbac import Role
from app.rbac.resolver import PermissionSet, resolve_permission


def require_screen(screen_key: str, action: str | None = None):
    """Returns a FastAPI dependency enforcing:
      - Layer 1: the screen is visible to this user's role (else 404, not 403 —
        an invisible screen does not reveal that it exists, matching the
        prototype's 'no greyed-out menu item, no reachable URL' rule).
      - Layer 2: if `action` is given, it is explicitly allowed (else 403).

    Returns the resolved PermissionSet so the route can also apply Layer 3
    (field masking) and Layer 4 (scope) itself — see app/rbac/scope.py and
    app/core/serialization/masking.py.

    RBAC §4.2 "Preview as this role": every protected route reads the same
    `X-Preview-Role` header GET /me already established the contract for
    (auth.py's own `preview_role` query param, mirrored here as a header
    since a header attaches uniformly to every request method, not just one
    GET endpoint — auth.interceptor.ts sets it from SessionStore.previewingAs()).
    Same fail-closed rule as /me: only a REAL Super Admin's preview request is
    honoured; anyone else's header is silently ignored, never trusted at face
    value. Layer 4 (scope) needs no separate propagation here — see
    resolve_permission's own docstring for why threading the previewed role
    into that one resolve call is sufficient for every layer at once.
    """

    async def dependency(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
        x_preview_role: str | None = Header(None),
    ) -> PermissionSet:
        preview_role_id: str | None = None
        if x_preview_role:
            real_role = await db.get(Role, current_user.role_id)
            if real_role and real_role.code == "SUPER_ADMIN":
                preview_role_row = (await db.execute(select(Role).where(Role.code == x_preview_role))).scalar_one_or_none()
                if preview_role_row:
                    preview_role_id = preview_role_row.id
        perms = await resolve_permission(db, current_user, screen_key, preview_role_id=preview_role_id)
        if not perms.visible:
            # 404, not 403: Layer 1 says this screen does not exist for this role.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if action is not None and not perms.can(action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role does not have '{action}' on '{screen_key}'",
            )
        return perms

    return dependency
