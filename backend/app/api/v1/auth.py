import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.security import DUMMY_PASSWORD_HASH, hash_password, needs_rehash, verify_password
from app.core.db import get_db
from app.core.rate_limit import (
    enforce_login_rate_limit,
    record_login_failure,
    reset_login_attempts,
    reset_request_within_budget,
)
from app.models.employee import Employee
from app.models.platform import User
from app.models.rbac import PermissionChangeLog, Role
from app.rbac.registry.screens import SCREENS
from app.rbac.resolver import resolve_all_permissions
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    MeOut,
    MePolicy,
    MePolicyScreen,
    PasswordResetRequest,
    RefreshRequest,
    TokenResponse,
)
from app.services import auth_tokens

logger = logging.getLogger("app.security")

router = APIRouter(prefix="/auth", tags=["auth"])
# ARCH-3 §4/§8 specifies GET /api/v1/me (no /auth/ prefix) as the session
# bootstrap the Angular app-initializer calls before first paint — a plain
# top-level "who am I, what may I do" endpoint, distinct from
# employees.py's own GET /employees/me (that one returns the caller's
# EmployeeOut profile record, not an auth/policy snapshot). Kept in this
# file since it's built from the same current_user/token machinery, just
# registered on its own un-prefixed router so the path matches the spec.
me_router = APIRouter(tags=["auth"])


# ARCH-3 §9.4 also puts a `limit_req_zone` in front of this route in nginx
# once a real droplet exists — that's IP-only and stops nothing once an
# attacker has more than one source address. This Redis-backed layer (see
# app/core/rate_limit.py) is scoped per-account too, and is what's actually
# testable in this dev sandbox today.
@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    await enforce_login_rate_limit(request, body.email)
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    # verify_password always runs, against a real hash or the dummy one, so
    # a nonexistent/disabled account can't be told apart from a real one by
    # response timing — see DUMMY_PASSWORD_HASH's docstring.
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not user.is_enabled or not password_ok:
        await record_login_failure(request, body.email)
        logger.warning("failed login attempt for %s", body.email.strip().lower())
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    await reset_login_attempts(request, body.email)

    # Lazy migration off bcrypt (see app/auth/security.py) — a successful
    # login is the only moment the plaintext is available to rehash with.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = datetime.now(timezone.utc)  # ARCH-2 §5.1: tracked, never was until now
    pair = await auth_tokens.issue_token_pair(db, user)
    await db.commit()
    return TokenResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    pair = await auth_tokens.rotate_refresh_token(db, body.refresh_token)
    if pair is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Refresh token is invalid, expired, or revoked")
    return TokenResponse(access_token=pair.access_token, refresh_token=pair.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)) -> None:
    # Revokes only the one session named by this refresh token — "log out
    # this device," not every device. No auth dependency needed: the
    # refresh token itself is the credential being surrendered, same as
    # /auth/login needs no prior auth to present a password.
    await auth_tokens.revoke_refresh_token(db, body.refresh_token)


@router.post("/password/reset-request", status_code=status.HTTP_204_NO_CONTENT)
async def request_password_reset(body: PasswordResetRequest, request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """ARCH-2 §5.4's self-service counterpart to HR's Reset Password button
    — the two "converge on one internal function" (auth_tokens.issue_temporary_password).
    Always 204, no matter what: unknown email, disabled account, an account
    with no linked Employee record (nowhere to send the email — the whole
    temp-password/email mechanism is Employee-centric, same boundary
    HR-initiated reset already has), or rate-limited — every branch below
    is a silent no-op. Anything else would make this endpoint an
    account-enumeration oracle, the exact failure mode ARCH-2 calls out by
    name.
    """
    if not await reset_request_within_budget(request, body.email):
        return
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is None or not user.is_enabled:
        return
    employee = (await db.execute(select(Employee).where(Employee.user_id == user.id))).scalar_one_or_none()
    if employee is None:
        return
    await auth_tokens.issue_temporary_password(
        db, user, employee_first_name=employee.first_name, employee_email=employee.email,
        employee_id=employee.id, actor_id=user.id,
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Employee §2.3's forced-change-on-first-login flow (must_change_password
    is set True by create_login/reset_password) had no way to ever complete —
    found by the Phase 2 audit: nothing anywhere ever cleared the flag. Any
    logged-in user may change their own password here; no RBAC screen gate
    since this isn't a screen, it's every account's own credential.
    """
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if verify_password(body.new_password, current_user.password_hash) or await auth_tokens.is_password_reused(
        db, current_user.id, body.new_password
    ):
        # ARCH-2 §5.2: a password_hashes history table blocks reuse — see
        # app/services/auth_tokens.py's PASSWORD_HISTORY_LIMIT.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This password was used too recently — choose a different one")

    await auth_tokens.record_password_history(db, current_user.id, current_user.password_hash)
    current_user.password_hash = hash_password(body.new_password)
    current_user.must_change_password = False
    current_user.updated_by = current_user.id
    # ARCH-2 §5.5: "all other refresh tokens revoked" — simplified to ALL
    # (including the caller's own session, which still gets a same-length
    # window on its now-15-minute access token regardless) rather than
    # threading the caller's own refresh token through this endpoint just
    # to spare it: change-password isn't sent one today, and the security
    # outcome is identical either way, just simpler.
    await auth_tokens.revoke_all_refresh_tokens(db, current_user.id)
    await db.commit()


@me_router.get("/me", response_model=MeOut)
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    # RBAC §4.2 "Preview as this role" — a role CODE ('MANAGER', not an id),
    # matching how the frontend already knows role codes (SessionStore.role).
    preview_role: str | None = Query(None),
) -> MeOut:
    role = await db.get(Role, current_user.role_id)
    preview_role_id: str | None = None
    previewing_as: str | None = None
    if preview_role:
        # Fail closed: anyone other than a REAL Super Admin asking for a
        # preview gets their own real policy back, silently — same "don't
        # reveal what you can't have" posture as require_screen's 404, not
        # a 403 that would confirm the feature exists to a role that can't
        # use it. A real Super Admin asking for an unknown role code also
        # falls through to their own real policy rather than erroring, since
        # this is a pure UX convenience, not something worth failing loud over.
        if role and role.code == "SUPER_ADMIN":
            preview_role_row = (await db.execute(select(Role).where(Role.code == preview_role))).scalar_one_or_none()
            if preview_role_row:
                preview_role_id = preview_role_row.id
                previewing_as = preview_role_row.code
    permissions = await resolve_all_permissions(db, current_user, preview_role_id=preview_role_id)
    screens = {
        key: MePolicyScreen(
            label=SCREENS[key].label, module=SCREENS[key].module,
            mode=perms.mode, actions=sorted(perms.allowed_actions), fields=perms.field_modes,
        )
        for key, perms in permissions.items()
        if perms.mode != "none"  # an invisible screen is omitted entirely, not sent as mode:"none" —
        # same "does not reveal it exists" rule require_screen's 404 already enforces server-side.
    }
    # A cheap global staleness signal for the client's post-403 refetch (§4):
    # the latest RBAC change of ANY kind, anywhere — not scoped to this
    # user/role, since an override on a totally different user still means
    # "policy data changed, re-fetch to be safe" is the correct conservative
    # read. Good enough for "did anything change since I logged in", which
    # is the only question this needs to answer.
    latest_change = (await db.execute(select(func.max(PermissionChangeLog.changed_at)))).scalar_one_or_none()
    version = (latest_change or datetime(1970, 1, 1, tzinfo=timezone.utc)).isoformat()
    return MeOut(
        id=current_user.id, email=current_user.email, full_name=current_user.full_name,
        role=role.code, must_change_password=current_user.must_change_password,
        policy=MePolicy(version=version, screens=screens), previewing_as=previewing_as,
    )
