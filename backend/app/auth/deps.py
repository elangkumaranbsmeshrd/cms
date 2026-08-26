from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.core.db import get_db
from app.models.platform import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Employee §3.6 step 4: a must_change_password account is meant to be taken
# "straight to the Change Own Password form ... before doing anything else."
# Confirmed by this session's security audit as previously enforced nowhere
# — the flag was set by create_login/reset_password and cleared by
# /auth/change-password, but nothing in between ever checked it, so a
# temporary password worked as a normal, fully-privileged credential
# indefinitely. Mirrors ARCH-2 §5.1's PASSWORD_CHANGE_ALLOWLIST design.
_PASSWORD_CHANGE_ALLOWLIST = {
    ("POST", "/api/v1/auth/change-password"),
    # The Angular shell needs its own session/role/policy snapshot to even
    # render the Change Password screen (whose is this, what's my role) —
    # ARCH-3 §5.1's allowlist names GET /auth/me for the same reason.
    ("GET", "/api/v1/me"),
}


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = decode_access_token(token)
    if user_id is None:
        raise unauthorized
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_enabled:
        raise unauthorized
    if user.must_change_password and (request.method, request.url.path) not in _PASSWORD_CHANGE_ALLOWLIST:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required before continuing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
