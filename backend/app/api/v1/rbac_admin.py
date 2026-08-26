"""RBAC's own 4 admin screens (14-rbac-module.md §4): Role Directory, Role
Permission Matrix, Individual Permission Overrides, Permission Change Log.

The four-layer data model (Role/Screen/ScreenAction/ScreenSensitiveField/
RolePermission/RolePermissionAction/RolePermissionField/FeatureToggle/
UserPermissionOverride/PermissionChangeLog) has existed since Phase 0 —
this is the first code anywhere in the codebase that actually reads or
writes most of it as an admin surface; every prior phase's RBAC seeding
wrote it, and app/rbac/resolver.py reads it per-request, but nothing let a
Super Admin see or change it without a raw DB write. All 4 screens are
Super Admin only (§4.1-§4.4).

§4.2's "mode" (L1 visibility + L4 scope) is one field on RolePermission by
design (app/rbac/resolver.py's own docstring: 'full'/'view'/'view_team'/
'own'/'team'/'none' encodes both at once) — there is no separate L4 write
path here; changing scope IS changing mode. The Change Log therefore logs
every mode change as a single 'L1' entry, matching how the data model
itself doesn't distinguish the two.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.models.platform import User
from app.models.rbac import (
    FeatureToggle,
    PermissionChangeLog,
    RolePermission,
    RolePermissionAction,
    RolePermissionField,
    Role,
    Screen,
    ScreenAction,
    ScreenSensitiveField,
    UserPermissionOverride,
)
from app.rbac.deps import require_screen
from app.rbac.resolver import PermissionSet
from app.schemas.rbac_admin import (
    ChangeLogOut,
    MatrixActionState,
    MatrixFieldState,
    MatrixModuleState,
    MatrixSaveRequest,
    MatrixScreenState,
    OverrideCreate,
    OverrideOut,
    RoleDefaultSummary,
    RoleDirectoryRow,
    ToggleOut,
    ToggleUpdateRequest,
)
from app.services import list_export
from app.services.pdf_engine import ColumnSpec

router = APIRouter(prefix="/rbac", tags=["rbac-admin"])

_ROLE_SCREEN = "rbac.role_directory"
_MATRIX_SCREEN = "rbac.permission_matrix"
_OVERRIDES_SCREEN = "rbac.overrides"
_CHANGE_LOG_SCREEN = "rbac.change_log"

# The two value vocabularies this module writes. Both are pinned by a DB CHECK
# constraint (ck_role_perm_mode on role_permissions.mode; ck_rpf_mode on
# role_permission_fields.mode, widened to include 'read' by migration 0010) and
# both are read back as-is by app/rbac/resolver.py. Validated here so an
# out-of-range value is a 422 naming the legal set — before this, `mode` and the
# values in `fields` went straight to the DB and the constraint rejection
# surfaced as an unhandled 500, while screen_key in the very same request body
# was already checked properly. Kept as module constants because the override
# path below needs exactly the same two vocabularies.
_SCREEN_MODES = ("none", "full", "view", "view_team", "own", "team")
_FIELD_MODES = ("show", "read", "mask", "hide")

# What a UserPermissionOverride.override_value is allowed to be, per layer —
# derived from what app/rbac/resolver.py actually DOES with it, which is the
# only definition that exists: L1/L4 assign it straight to the effective screen
# mode, L2 compares it to "allow" (anything else revokes the action), L3 assigns
# it straight to the field mode. Unvalidated, a junk L1/L4 value became the
# user's effective screen mode verbatim — a fail-open, since most downstream
# visibility checks ask "is this != none" rather than "is this a real mode".
_OVERRIDE_VALUES_BY_LAYER: dict[str, tuple[str, ...]] = {
    "L1": _SCREEN_MODES,
    "L2": ("allow", "deny"),
    "L3": _FIELD_MODES,
    "L4": _SCREEN_MODES,
}


async def _role_by_code(db: AsyncSession, role_code: str) -> Role:
    role = (await db.execute(select(Role).where(Role.code == role_code))).scalar_one_or_none()
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Role '{role_code}' not found")
    return role


async def _build_matrix(db: AsyncSession, role_id: str) -> list[MatrixModuleState]:
    screens = (await db.execute(select(Screen).order_by(Screen.module_key, Screen.label))).scalars().all()
    if not screens:
        return []
    screen_ids = [s.id for s in screens]

    actions_by_screen: dict[str, list[ScreenAction]] = {}
    for a in (await db.execute(select(ScreenAction).where(ScreenAction.screen_id.in_(screen_ids)))).scalars().all():
        actions_by_screen.setdefault(a.screen_id, []).append(a)
    fields_by_screen: dict[str, list[ScreenSensitiveField]] = {}
    for f in (await db.execute(select(ScreenSensitiveField).where(ScreenSensitiveField.screen_id.in_(screen_ids)))).scalars().all():
        fields_by_screen.setdefault(f.screen_id, []).append(f)

    modes_by_screen = {
        p.screen_id: p.mode
        for p in (await db.execute(select(RolePermission).where(RolePermission.role_id == role_id, RolePermission.screen_id.in_(screen_ids)))).scalars().all()
    }
    allowed_actions_by_screen: dict[str, set[str]] = {}
    for a in (await db.execute(select(RolePermissionAction).where(RolePermissionAction.role_id == role_id, RolePermissionAction.screen_id.in_(screen_ids), RolePermissionAction.allowed.is_(True)))).scalars().all():
        allowed_actions_by_screen.setdefault(a.screen_id, set()).add(a.action_key)
    field_modes_by_screen: dict[str, dict[str, str]] = {}
    for f in (await db.execute(select(RolePermissionField).where(RolePermissionField.role_id == role_id, RolePermissionField.screen_id.in_(screen_ids)))).scalars().all():
        field_modes_by_screen.setdefault(f.screen_id, {})[f.field_key] = f.mode

    modules: dict[str, list[MatrixScreenState]] = {}
    for s in screens:
        modules.setdefault(s.module_key, []).append(MatrixScreenState(
            screen_key=s.screen_key, label=s.label, has_scope=s.has_scope, mode=modes_by_screen.get(s.id, "none"),
            actions=[
                MatrixActionState(action_key=a.action_key, label=a.label, allowed=a.action_key in allowed_actions_by_screen.get(s.id, set()))
                for a in actions_by_screen.get(s.id, [])
            ],
            fields=[
                MatrixFieldState(field_key=f.field_key, label=f.label, mode=field_modes_by_screen.get(s.id, {}).get(f.field_key, "show"))
                for f in fields_by_screen.get(s.id, [])
            ],
        ))
    return [MatrixModuleState(module_key=k, screens=v) for k, v in modules.items()]


# =============================================================== ROLE DIRECTORY
_ROLE_DIRECTORY_COLUMNS = [
    ColumnSpec("role_name", "Role Name"),
    ColumnSpec("people_count", "People Count", align="right"),
    ColumnSpec("override_count", "Override Count", align="right"),
]


@router.get("/roles", response_model=None)
async def role_directory(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_ROLE_SCREEN)),
    has_overrides: bool | None = Query(None),
    people_count_min: int | None = Query(None),
    people_count_max: int | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[RoleDirectoryRow] | Response:
    roles = (await db.execute(select(Role))).scalars().all()
    rows = []
    for role in roles:
        people_count = (await db.execute(select(User).where(User.role_id == role.id, User.is_enabled.is_(True)))).scalars().all()
        user_ids = [u.id for u in (await db.execute(select(User).where(User.role_id == role.id))).scalars().all()]
        override_count = 0
        if user_ids:
            override_count = len((await db.execute(select(UserPermissionOverride).where(UserPermissionOverride.user_id.in_(user_ids)))).scalars().all())
        rows.append(RoleDirectoryRow(role_code=role.code, role_name=role.name, people_count=len(people_count), override_count=override_count))

    if has_overrides is not None:
        rows = [r for r in rows if (r.override_count > 0) == has_overrides]
    if people_count_min is not None:
        rows = [r for r in rows if r.people_count >= people_count_min]
    if people_count_max is not None:
        rows = [r for r in rows if r.people_count <= people_count_max]

    if format:
        export_rows = [{"role_name": r.role_name, "people_count": r.people_count, "override_count": r.override_count} for r in rows]
        filters_applied = {"has_overrides": has_overrides, "people_count_min": people_count_min, "people_count_max": people_count_max}
        return await list_export.build_export(format, db, current_user, "Role Directory", _ROLE_DIRECTORY_COLUMNS, export_rows, filters_applied)

    return rows


# =========================================================== PERMISSION MATRIX
@router.get("/matrix/{role_code}", response_model=list[MatrixModuleState])
async def get_matrix(
    role_code: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(_MATRIX_SCREEN)),
    search: str | None = Query(None, description="Matches module or screen label"),
) -> list[MatrixModuleState]:
    role = await _role_by_code(db, role_code)
    modules = await _build_matrix(db, role.id)
    if search:
        needle = search.lower()
        filtered = []
        for m in modules:
            if needle in m.module_key.lower():
                filtered.append(m)
                continue
            matching_screens = [s for s in m.screens if needle in s.label.lower()]
            if matching_screens:
                filtered.append(MatrixModuleState(module_key=m.module_key, screens=matching_screens))
        modules = filtered
    return modules


@router.put("/matrix/{role_code}", response_model=list[MatrixModuleState])
async def save_matrix(
    role_code: str,
    body: MatrixSaveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_MATRIX_SCREEN, action="edit")),
) -> list[MatrixModuleState]:
    role = await _role_by_code(db, role_code)
    screens_by_key = {s.screen_key: s for s in (await db.execute(select(Screen))).scalars().all()}
    # The registry of what each screen actually HAS — the same two tables
    # create_override() below already validates action_key/field_key against.
    # One query each for the whole request rather than one per change, since a
    # matrix save is normally a whole screen's worth of edits at once.
    actions_by_screen_id: dict[str, set[str]] = {}
    for a in (await db.execute(select(ScreenAction))).scalars().all():
        actions_by_screen_id.setdefault(a.screen_id, set()).add(a.action_key)
    fields_by_screen_id: dict[str, set[str]] = {}
    for f in (await db.execute(select(ScreenSensitiveField))).scalars().all():
        fields_by_screen_id.setdefault(f.screen_id, set()).add(f.field_key)

    for change in body.changes:
        screen = screens_by_key.get(change.screen_key)
        if screen is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown screen '{change.screen_key}'")

        # Validate the whole change up front, before anything is staged on the
        # session — an unknown action_key/field_key used to be persisted as a
        # brand new permission row that GET /rbac/matrix (which lists the
        # SCREEN's actions/fields, not the stored rows) could never show again,
        # so an operator typo created unreachable, un-removable grants.
        if change.mode is not None and change.mode not in _SCREEN_MODES:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown mode '{change.mode}' — must be one of {', '.join(_SCREEN_MODES)}",
            )
        if change.actions:
            valid_actions = actions_by_screen_id.get(screen.id, set())
            for action_key in change.actions:
                if action_key not in valid_actions:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"'{action_key}' is not a real action on screen '{change.screen_key}'",
                    )
        if change.fields:
            valid_fields = fields_by_screen_id.get(screen.id, set())
            for field_key, field_mode in change.fields.items():
                if field_key not in valid_fields:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"'{field_key}' is not a sensitive field on screen '{change.screen_key}'",
                    )
                if field_mode not in _FIELD_MODES:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Unknown field mode '{field_mode}' for '{field_key}' — must be one of {', '.join(_FIELD_MODES)}",
                    )

        # §3.2 guardrail: "Super Admin cannot remove its own access to the RBAC
        # screens — the system must refuse to produce a state with no one able
        # to administer it." _MATRIX_SCREEN specifically, because its own
        # 'edit' action is the one write path every guardrail here depends on
        # — losing Role Directory/Overrides/Change-Log visibility is merely
        # inconvenient, losing edit on the Matrix is unrecoverable without a
        # raw DB write.
        if role.code == "SUPER_ADMIN" and change.screen_key == _MATRIX_SCREEN:
            if change.mode == "none":
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Cannot hide the Permission Matrix from Super Admin — no role would be left able to administer permissions.",
                )
            if change.actions and change.actions.get("edit") is False:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Cannot revoke Super Admin's own Edit right on the Permission Matrix — no role would be left able to change permissions.",
                )

        if change.mode is not None:
            row = (await db.execute(select(RolePermission).where(RolePermission.role_id == role.id, RolePermission.screen_id == screen.id))).scalar_one_or_none()
            old_mode = row.mode if row else "none"
            if change.mode != old_mode:
                if row is None:
                    row = RolePermission(id=str(uuid.uuid4()), role_id=role.id, screen_id=screen.id, mode=change.mode, created_by=current_user.id, updated_by=current_user.id)
                    db.add(row)
                else:
                    row.mode = change.mode
                    row.updated_by = current_user.id
                db.add(PermissionChangeLog(
                    id=str(uuid.uuid4()), changed_by=current_user.id, target_role_id=role.id, screen_id=screen.id,
                    layer="L1", before_value={"mode": old_mode}, after_value={"mode": change.mode},
                ))

        if change.actions:
            existing_rows = {
                r.action_key: r for r in (await db.execute(select(RolePermissionAction).where(RolePermissionAction.role_id == role.id, RolePermissionAction.screen_id == screen.id))).scalars().all()
            }
            for action_key, allowed in change.actions.items():
                row = existing_rows.get(action_key)
                old_allowed = row.allowed if row else False
                if allowed != old_allowed:
                    if row is None:
                        db.add(RolePermissionAction(id=str(uuid.uuid4()), role_id=role.id, screen_id=screen.id, action_key=action_key, allowed=allowed, created_by=current_user.id, updated_by=current_user.id))
                    else:
                        row.allowed = allowed
                        row.updated_by = current_user.id
                    db.add(PermissionChangeLog(
                        id=str(uuid.uuid4()), changed_by=current_user.id, target_role_id=role.id, screen_id=screen.id,
                        layer="L2", before_value={"action_key": action_key, "allowed": old_allowed}, after_value={"action_key": action_key, "allowed": allowed},
                    ))

        if change.fields:
            existing_rows = {
                r.field_key: r for r in (await db.execute(select(RolePermissionField).where(RolePermissionField.role_id == role.id, RolePermissionField.screen_id == screen.id))).scalars().all()
            }
            for field_key, mode in change.fields.items():
                row = existing_rows.get(field_key)
                old_mode = row.mode if row else "show"
                if mode != old_mode:
                    if row is None:
                        db.add(RolePermissionField(id=str(uuid.uuid4()), role_id=role.id, screen_id=screen.id, field_key=field_key, mode=mode, created_by=current_user.id, updated_by=current_user.id))
                    else:
                        row.mode = mode
                        row.updated_by = current_user.id
                    db.add(PermissionChangeLog(
                        id=str(uuid.uuid4()), changed_by=current_user.id, target_role_id=role.id, screen_id=screen.id,
                        layer="L3", before_value={"field_key": field_key, "mode": old_mode}, after_value={"field_key": field_key, "mode": mode},
                    ))

    await db.commit()
    return await _build_matrix(db, role.id)


# =================================================== INDIVIDUAL PERMISSION OVERRIDES
async def _override_to_out(db: AsyncSession, ov: UserPermissionOverride, users: dict[str, User], screens: dict[str, Screen], roles_by_user: dict[str, str]) -> OverrideOut:
    user = users[ov.user_id]
    granted_by = users.get(ov.granted_by)
    screen = screens[ov.screen_id]
    return OverrideOut(
        id=ov.id, user_id=ov.user_id, user_name=user.full_name, role_code=roles_by_user.get(ov.user_id, ""),
        screen_key=screen.screen_key, screen_label=screen.label, module_key=screen.module_key, layer=ov.layer,
        action_key=ov.action_key, field_key=ov.field_key, override_value=ov.override_value, reason=ov.reason,
        granted_by=ov.granted_by, granted_by_name=granted_by.full_name if granted_by else "", created_at=ov.created_at,
    )


_OVERRIDES_COLUMNS = [
    ColumnSpec("user_name", "Person"),
    ColumnSpec("role_code", "Role"),
    ColumnSpec("module_key", "Module"),
    ColumnSpec("screen_label", "Screen"),
    ColumnSpec("layer", "Layer"),
    ColumnSpec("override_value", "Grant/Revoke"),
    ColumnSpec("granted_by_name", "Changed By"),
    ColumnSpec("created_at", "Date"),
]


@router.get("/overrides", response_model=None)
async def list_overrides(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_OVERRIDES_SCREEN)),
    user_id: str | None = Query(None, description="Omit for the company-wide cross-person view"),
    role_code: str | None = Query(None),
    module_key: str | None = Query(None),
    screen_key: str | None = Query(None),
    layer: str | None = Query(None),
    changed_by: str | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[OverrideOut] | Response:
    stmt = select(UserPermissionOverride)
    if user_id:
        stmt = stmt.where(UserPermissionOverride.user_id == user_id)
    if changed_by:
        stmt = stmt.where(UserPermissionOverride.granted_by == changed_by)
    if layer:
        stmt = stmt.where(UserPermissionOverride.layer == layer)
    if date_from:
        stmt = stmt.where(UserPermissionOverride.created_at >= date_from)
    if date_to:
        stmt = stmt.where(UserPermissionOverride.created_at <= date_to)
    overrides = (await db.execute(stmt.order_by(UserPermissionOverride.created_at.desc()))).scalars().all()

    all_user_ids = {o.user_id for o in overrides} | {o.granted_by for o in overrides}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(all_user_ids)))).scalars().all()} if all_user_ids else {}
    screen_ids = {o.screen_id for o in overrides}
    screens = {s.id: s for s in (await db.execute(select(Screen).where(Screen.id.in_(screen_ids)))).scalars().all()} if screen_ids else {}
    roles = {r.id: r.code for r in (await db.execute(select(Role))).scalars().all()}
    roles_by_user = {u.id: roles.get(u.role_id, "") for u in users.values()}

    rows = [await _override_to_out(db, o, users, screens, roles_by_user) for o in overrides]
    if role_code:
        rows = [r for r in rows if r.role_code == role_code]
    if module_key:
        rows = [r for r in rows if r.module_key == module_key]
    if screen_key:
        rows = [r for r in rows if r.screen_key == screen_key]

    if format:
        export_rows = [
            {
                "user_name": r.user_name, "role_code": r.role_code, "module_key": r.module_key, "screen_label": r.screen_label,
                "layer": r.layer, "override_value": r.override_value, "granted_by_name": r.granted_by_name, "created_at": r.created_at,
            }
            for r in rows
        ]
        filters_applied = {"user_id": user_id, "role_code": role_code, "module_key": module_key, "screen_key": screen_key, "layer": layer, "changed_by": changed_by, "date_from": date_from, "date_to": date_to}
        return await list_export.build_export(format, db, current_user, "Individual Permission Overrides", _OVERRIDES_COLUMNS, export_rows, filters_applied)

    return rows


@router.get("/users/{user_id}/role-default", response_model=RoleDefaultSummary)
async def role_default_summary(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(_OVERRIDES_SCREEN)),
) -> RoleDefaultSummary:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Person not found")
    role = await db.get(Role, user.role_id)
    modules = await _build_matrix(db, role.id)
    return RoleDefaultSummary(role_code=role.code, role_name=role.name, modules=modules)


@router.post("/overrides", response_model=OverrideOut, status_code=status.HTTP_201_CREATED)
async def create_override(
    body: OverrideCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_OVERRIDES_SCREEN, action="add")),
) -> UserPermissionOverride:
    user = await db.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Person not found")
    screen = (await db.execute(select(Screen).where(Screen.screen_key == body.screen_key))).scalar_one_or_none()
    if screen is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Screen not found")
    if body.layer not in ("L1", "L2", "L3", "L4"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Layer must be one of L1, L2, L3, L4")
    if body.layer == "L4" and not screen.has_scope:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This screen has no scope dimension")
    if body.layer == "L2":
        valid_actions = {a.action_key for a in (await db.execute(select(ScreenAction).where(ScreenAction.screen_id == screen.id))).scalars().all()}
        if body.action_key not in valid_actions:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"'{body.action_key}' is not a real action on this screen")
    if body.layer == "L3":
        valid_fields = {f.field_key for f in (await db.execute(select(ScreenSensitiveField).where(ScreenSensitiveField.screen_id == screen.id))).scalars().all()}
        if body.field_key not in valid_fields:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"'{body.field_key}' is not a sensitive field on this screen")
    if not body.reason.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Reason is required")
    # override_value is the one field on this body that was reaching the DB
    # unchecked (the column is a bare VARCHAR(20) with no CHECK, unlike layer's
    # ck_upo_layer). The resolver assigns an L1/L4 value straight to the
    # effective screen mode, so junk here became the user's mode verbatim.
    allowed_values = _OVERRIDE_VALUES_BY_LAYER[body.layer]
    if body.override_value not in allowed_values:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{body.override_value}' is not a valid {body.layer} override value — must be one of {', '.join(allowed_values)}",
        )

    row = UserPermissionOverride(
        id=str(uuid.uuid4()), user_id=body.user_id, screen_id=screen.id, layer=body.layer, action_key=body.action_key,
        field_key=body.field_key, override_value=body.override_value, reason=body.reason, granted_by=current_user.id,
        created_by=current_user.id, updated_by=current_user.id,
    )
    db.add(row)
    await db.flush()
    db.add(PermissionChangeLog(
        id=str(uuid.uuid4()), changed_by=current_user.id, target_user_id=body.user_id, screen_id=screen.id,
        layer=body.layer, before_value=None, after_value={"action_key": body.action_key, "field_key": body.field_key, "value": body.override_value, "reason": body.reason},
    ))
    await db.commit()
    await db.refresh(row)

    role = await db.get(Role, user.role_id)
    return await _override_to_out(db, row, {user.id: user, current_user.id: current_user}, {screen.id: screen}, {user.id: role.code})


@router.delete("/overrides/{override_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_override(
    override_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_OVERRIDES_SCREEN, action="remove")),
) -> None:
    row = await db.get(UserPermissionOverride, override_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    db.add(PermissionChangeLog(
        id=str(uuid.uuid4()), changed_by=current_user.id, target_user_id=row.user_id, screen_id=row.screen_id,
        layer=row.layer, before_value={"action_key": row.action_key, "field_key": row.field_key, "value": row.override_value}, after_value=None,
    ))
    await db.delete(row)
    await db.commit()


# ============================================================= PERMISSION CHANGE LOG
_CHANGE_LOG_COLUMNS = [
    ColumnSpec("changed_at", "Date/Time"),
    ColumnSpec("changed_by_name", "Changed By"),
    ColumnSpec("target", "Target"),
    ColumnSpec("module_key", "Module"),
    ColumnSpec("screen_label", "Screen"),
    ColumnSpec("layer", "Layer"),
]


@router.get("/change-log", response_model=None)
async def change_log(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_CHANGE_LOG_SCREEN)),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    changed_by: str | None = Query(None),
    target_role_id: str | None = Query(None),
    target_role_code: str | None = Query(None, description="Convenience alias for target_role_id — the frontend only ever has a role's code (e.g. MANAGER), not its UUID"),
    target_user_id: str | None = Query(None),
    module_key: str | None = Query(None),
    screen_key: str | None = Query(None),
    layer: str | None = Query(None),
    search: str | None = Query(None, description="Matches permission name or target name"),
    format: str | None = Query(None, description="pdf | excel — omit for the normal JSON response"),
) -> list[ChangeLogOut] | Response:
    stmt = select(PermissionChangeLog).order_by(PermissionChangeLog.changed_at.desc())
    if date_from:
        stmt = stmt.where(PermissionChangeLog.changed_at >= date_from)
    if date_to:
        stmt = stmt.where(PermissionChangeLog.changed_at <= date_to)
    if changed_by:
        stmt = stmt.where(PermissionChangeLog.changed_by == changed_by)
    if target_role_code:
        target_role_id = (await _role_by_code(db, target_role_code)).id
    if target_role_id:
        stmt = stmt.where(PermissionChangeLog.target_role_id == target_role_id)
    if target_user_id:
        stmt = stmt.where(PermissionChangeLog.target_user_id == target_user_id)
    if layer:
        stmt = stmt.where(PermissionChangeLog.layer == layer)
    entries = (await db.execute(stmt)).scalars().all()

    user_ids = {e.changed_by for e in entries} | {e.target_user_id for e in entries if e.target_user_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()} if user_ids else {}
    role_ids = {e.target_role_id for e in entries if e.target_role_id}
    roles = {r.id: r for r in (await db.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()} if role_ids else {}
    screen_ids = {e.screen_id for e in entries if e.screen_id}
    screens = {s.id: s for s in (await db.execute(select(Screen).where(Screen.id.in_(screen_ids)))).scalars().all()} if screen_ids else {}

    rows = []
    for e in entries:
        screen = screens.get(e.screen_id) if e.screen_id else None
        if module_key and (screen is None or screen.module_key != module_key):
            continue
        if screen_key and (screen is None or screen.screen_key != screen_key):
            continue
        target_role = roles.get(e.target_role_id).name if e.target_role_id else None
        target_user_name = users.get(e.target_user_id).full_name if e.target_user_id else None
        rows.append(ChangeLogOut(
            id=e.id, changed_at=e.changed_at, changed_by=e.changed_by, changed_by_name=users.get(e.changed_by).full_name if e.changed_by in users else "",
            target_role=target_role, target_user=e.target_user_id, target_user_name=target_user_name,
            screen_key=screen.screen_key if screen else None, screen_label=screen.label if screen else None,
            module_key=screen.module_key if screen else None, layer=e.layer, before_value=e.before_value, after_value=e.after_value,
        ))

    if search:
        needle = search.lower()
        rows = [r for r in rows if needle in (r.screen_label or "").lower() or needle in (r.target_role or "").lower() or needle in (r.target_user_name or "").lower()]

    if format:
        export_rows = [
            {
                "changed_at": r.changed_at, "changed_by_name": r.changed_by_name,
                "target": r.target_role or r.target_user_name or "", "module_key": r.module_key or "",
                "screen_label": r.screen_label or "", "layer": r.layer,
            }
            for r in rows
        ]
        filters_applied = {"date_from": date_from, "date_to": date_to, "changed_by": changed_by, "target_role_code": target_role_code, "target_user_id": target_user_id, "module_key": module_key, "screen_key": screen_key, "layer": layer, "search": search}
        return await list_export.build_export(format, db, current_user, "Permission Change Log", _CHANGE_LOG_COLUMNS, export_rows, filters_applied)

    return rows


# =================================================================== TOGGLES
# §3.2: "Toggles are stored and editable in the same admin area" — not a 5th
# screen, the same _MATRIX_SCREEN gate every other write here uses, since a
# toggle only ever exists to change what the Matrix's own rows mean at
# resolve time (app/rbac/toggles.py's ACTION_TOGGLE_GATES).
@router.get("/toggles", response_model=list[ToggleOut])
async def list_toggles(
    db: AsyncSession = Depends(get_db),
    perms: PermissionSet = Depends(require_screen(_MATRIX_SCREEN)),
    module_key: str | None = Query(None),
    search: str | None = Query(None, description="Matches the toggle's own name"),
) -> list[ToggleOut]:
    rows = (await db.execute(select(FeatureToggle).order_by(FeatureToggle.module_key, FeatureToggle.label))).scalars().all()
    out = [ToggleOut(toggle_key=r.toggle_key, module_key=r.module_key, label=r.label, enabled=r.enabled, default_enabled=r.default_enabled, numeric_value=r.numeric_value) for r in rows]
    if module_key:
        out = [t for t in out if t.module_key == module_key]
    if search:
        needle = search.lower()
        out = [t for t in out if needle in t.label.lower()]
    return out


@router.put("/toggles", response_model=list[ToggleOut])
async def update_toggles(
    body: ToggleUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    perms: PermissionSet = Depends(require_screen(_MATRIX_SCREEN, action="edit")),
) -> list[ToggleOut]:
    rows_by_key = {r.toggle_key: r for r in (await db.execute(select(FeatureToggle))).scalars().all()}
    for change in body.changes:
        row = rows_by_key.get(change.toggle_key)
        if row is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown toggle '{change.toggle_key}'")
        # numeric_value is only ever a real edit when the client actually
        # sent the key — checked via model_fields_set, not "!= row's current
        # value," so a plain enabled-flip (which never includes this key)
        # can't accidentally null out Expense's stored threshold amount.
        numeric_changed = "numeric_value" in change.model_fields_set and change.numeric_value != row.numeric_value
        # Every toggle that carries a number today carries a MONEY AMOUNT
        # (Expense §6.1's auto-approval threshold is the only one), and there is
        # no toggle in the registry for which a negative companion value means
        # anything. Rejected rather than stored: a negative threshold silently
        # changes which expenses auto-approve, with no UI that could show it as
        # wrong.
        if change.numeric_value is not None and change.numeric_value < 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"numeric_value for '{change.toggle_key}' cannot be negative",
            )
        if change.enabled == row.enabled and not numeric_changed:
            continue
        old_enabled, old_numeric = row.enabled, row.numeric_value
        row.enabled = change.enabled
        if numeric_changed:
            row.numeric_value = change.numeric_value
        row.updated_by = current_user.id
        # No screen_id: a toggle isn't owned by one screen (several gate
        # actions on different screens, and some — the ones seeded for
        # modules not built yet — gate nothing reachable at all today).
        db.add(PermissionChangeLog(
            id=str(uuid.uuid4()), changed_by=current_user.id, layer="L2",
            before_value={"toggle_key": change.toggle_key, "enabled": old_enabled, "numeric_value": float(old_numeric) if old_numeric is not None else None},
            after_value={"toggle_key": change.toggle_key, "enabled": change.enabled, "numeric_value": float(row.numeric_value) if row.numeric_value is not None else None},
        ))
    await db.commit()
    rows = (await db.execute(select(FeatureToggle).order_by(FeatureToggle.module_key, FeatureToggle.label))).scalars().all()
    return [ToggleOut(toggle_key=r.toggle_key, module_key=r.module_key, label=r.label, enabled=r.enabled, default_enabled=r.default_enabled, numeric_value=r.numeric_value) for r in rows]
