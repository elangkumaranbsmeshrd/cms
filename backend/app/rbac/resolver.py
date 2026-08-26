"""Resolves one PermissionSet per (user, screen) — ARCH-2 §3.2.

DEFAULT-DENY on every layer. This is a deliberate correction versus the
prototype: its client-side rowActions defaulted an action to VISIBLE unless a
`roles` array explicitly restricted it, which is exactly how the Timesheets
'Approve' button leaked to Employees (see BUILD-PROMPT §15 and project
memory). The prototype was UX-only and could afford that footgun; the API is
the authority now (Invariant 2), so every layer here defaults to the SAFE
state — none / not-allowed / show — unless a broadening rule is data-verified
present, EXCEPT field visibility, which defaults to shown because forcing an
explicit ScreenDef.sensitive_fields entry for every non-sensitive field would
be absurd. A field is only ever masked/hidden if it is BOTH declared sensitive
in the registry AND has a role_permission_fields row saying so.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import User
from app.models.rbac import (
    FeatureToggle,
    Role,
    RolePermission,
    RolePermissionAction,
    RolePermissionField,
    Screen,
    UserPermissionOverride,
)
from app.rbac.registry.screens import SCREENS, ScreenDef, get_screen
from app.rbac.toggles import ACTION_TOGGLE_GATES, MODE_TOGGLE_GATES

VISIBLE_MODES = {"full", "view", "view_team", "own", "team"}
READONLY_MODES = {"view", "view_team"}


@dataclass(frozen=True)
class PermissionSet:
    screen_key: str
    mode: str  # 'none' | 'full' | 'view' | 'view_team' | 'own' | 'team'
    allowed_actions: frozenset[str] = field(default_factory=frozenset)
    field_modes: dict[str, str] = field(default_factory=dict)  # field_key -> show|mask|hide
    # The resolved (preview-aware) role's code, e.g. "EMPLOYEE". `mode`/`can()`
    # answer "what can this request see/do", which is enough for almost every
    # caller — this exists for the rare endpoint that needs a THIRD question a
    # single mode value can't express: "is this grant a role-wide static one,
    # or did it come from a toggle that widens scope for viewing but not for
    # this specific write" (e.g. tickets.py's reassign/update — see
    # _assert_employee_scoped_write there). Empty string only if the role
    # lookup itself failed, which should not happen for a real FK-backed role.
    role_code: str = ""

    @property
    def visible(self) -> bool:
        return self.mode in VISIBLE_MODES

    @property
    def read_only(self) -> bool:
        return self.mode in READONLY_MODES

    def can(self, action_key: str) -> bool:
        return self.visible and action_key in self.allowed_actions

    def field_mode(self, field_key: str) -> str:
        return self.field_modes.get(field_key, "show")


async def _enabled_toggle_keys(db: AsyncSession) -> set[str]:
    """Every FeatureToggle currently ON. Fetched fresh per resolve call —
    same as everything else here, no caching yet (see resolver.py's own
    module docstring for why that's an accepted, explicit gap for now)."""
    rows = (await db.execute(select(FeatureToggle.toggle_key).where(FeatureToggle.enabled.is_(True)))).scalars()
    return set(rows)


def _apply_toggle_gates(screen_key: str, role_code: str, mode: str, allowed_actions: set[str], enabled_toggles: set[str]) -> None:
    """Mutates `allowed_actions` in place — a toggle can only ADD an action a
    role wouldn't otherwise have (app-rbac.js's ACTIONS functions never
    subtract), and only on a screen this role can already open at all."""
    if mode not in VISIBLE_MODES:
        return
    for (gate_screen_key, action_key), gate in ACTION_TOGGLE_GATES.items():
        if gate_screen_key != screen_key or role_code not in gate.roles:
            continue
        toggle_on = gate.toggle_key in enabled_toggles
        if toggle_on != gate.invert:
            allowed_actions.add(action_key)


def _apply_mode_gate(screen_key: str, role_code: str, mode: str, enabled_toggles: set[str]) -> str:
    """Returns the (possibly widened) mode — called BEFORE
    _apply_toggle_gates, since an action can only ever be granted on top of
    an already-visible mode, and a mode-gate is what makes a previously
    invisible/narrow screen visible/broad in the first place. Never narrows:
    a role's own seeded mode is always at least as open as what a mode-gate
    would set it to, by construction (see ModeGate's own docstring)."""
    gate = MODE_TOGGLE_GATES.get(screen_key)
    if gate is None or role_code not in gate.roles:
        return mode
    return gate.mode if gate.toggle_key in enabled_toggles else mode


async def resolve_permission(db: AsyncSession, user: User, screen_key: str, preview_role_id: str | None = None) -> PermissionSet:
    """`preview_role_id`: RBAC §4.2 "Preview as this role" (Super Admin only,
    enforced by the caller — app/rbac/deps.py's require_screen). Layers 1-3
    resolve for THIS role instead of user.role_id, exactly as
    resolve_all_permissions below already does for GET /me. Layer 4 (scope)
    needs no special handling here at all: it's just `mode`, a field on the
    PermissionSet this function already returns — every caller of
    require_screen() that applies scope (app/rbac/scope.py's apply_scope)
    reads `mode` off the SAME resolved PermissionSet, so a previewed mode of
    'own'/'team' is honoured automatically. The caller's real `owner_id`
    (their own linked Employee row, resolved independently via
    app/services/org_scope.py) is untouched — Super Admin has none, so an
    'own'/'team' scope during preview correctly narrows to zero rows rather
    than either leaking Super Admin's real full-company data (the previous
    behavior) or fabricating a specific other person's data (which is what
    would make this genuine impersonation, and is never done)."""
    screen_def: ScreenDef = get_screen(screen_key)  # raises if the screen doesn't exist — fail loud
    role_id = preview_role_id or user.role_id
    role = await db.get(Role, role_id)
    role_code = role.code if role else ""

    screen_row = (
        await db.execute(select(Screen).where(Screen.screen_key == screen_key))
    ).scalar_one_or_none()
    if screen_row is None:
        # Registry declares the screen but it hasn't been seeded into the DB yet.
        # Fail closed, not open — an unseeded screen is invisible, never full access.
        return PermissionSet(screen_key=screen_key, mode="none")

    # ---- Layer 1 + 4: role default ----
    role_perm = (
        await db.execute(
            select(RolePermission).where(
                RolePermission.role_id == role_id,
                RolePermission.screen_id == screen_row.id,
            )
        )
    ).scalar_one_or_none()
    mode = role_perm.mode if role_perm else "none"

    # ---- Mode-gated widening (RBAC §2.1) — checked BEFORE Layer 2, since a
    # mode-gate can make an otherwise-invisible screen visible at all (e.g.
    # Employee's ticket.reports: 'none' -> 'full'), which the action block
    # right below needs to already know about. Only queried when this screen
    # actually has a gate registered, same cheap-scan-first pattern as the
    # action gates below. (`role` itself is already fetched above — needed
    # unconditionally now for PermissionSet.role_code, not just here.)
    if screen_key in MODE_TOGGLE_GATES:
        enabled_toggles = await _enabled_toggle_keys(db)
        mode = _apply_mode_gate(screen_key, role_code, mode, enabled_toggles)

    # ---- Layer 2: actions, default-deny ----
    allowed_actions: set[str] = set()
    if mode in VISIBLE_MODES:
        rows = (
            await db.execute(
                select(RolePermissionAction).where(
                    RolePermissionAction.role_id == role_id,
                    RolePermissionAction.screen_id == screen_row.id,
                    RolePermissionAction.allowed.is_(True),
                )
            )
        ).scalars()
        allowed_actions = {r.action_key for r in rows}

        # ---- Toggle-gated grants (RBAC §2.1) — only queried when this screen
        # actually has a gate registered, so the common case (no gate at all)
        # costs nothing beyond the cheap in-memory dict scan above.
        if any(k[0] == screen_key for k in ACTION_TOGGLE_GATES):
            enabled_toggles = await _enabled_toggle_keys(db)
            _apply_toggle_gates(screen_key, role_code, mode, allowed_actions, enabled_toggles)

    # ---- Layer 3: field sensitivity, default-show ----
    # NOT gated on `screen_def.sensitive_fields` (the static hand-curated
    # tuple in registry/screens.py, ~7 entries) — that tuple is a legacy,
    # code-reviewed carve-out list, but MASTER-BUILD-PROMPT.md §3.2's real
    # requirement is that EVERY screen's field inventory is auto-derived from
    # its Angular config and synced into ScreenSensitiveField/
    # RolePermissionField (see field_sync.py) — 284 rows across 25 screens as
    # of this build, not 7. Gating this query on the static tuple made the
    # 18 auto-synced screens' field rules silently inert: a Super Admin could
    # hide a field in the (future) admin matrix, the write would succeed, and
    # it would never be enforced, because the resolver never even queried it.
    # The query itself is cheap and indexed either way, so there is no
    # correctness/performance tradeoff to gating it at all — just query it.
    rows = (
        await db.execute(
            select(RolePermissionField).where(
                RolePermissionField.role_id == role_id,
                RolePermissionField.screen_id == screen_row.id,
            )
        )
    ).scalars()
    field_modes = {r.field_key: r.mode for r in rows}

    # ---- Override layer: per-user, on top of everything above ----
    # Skipped entirely under preview — same reasoning as resolve_all_permissions:
    # a per-user override belongs to one specific real person's own row;
    # blending a stranger's individual grant/revoke into an abstract role
    # preview would be incoherent, not a preview of the role.
    if preview_role_id is None:
        overrides = (
            await db.execute(
                select(UserPermissionOverride).where(
                    UserPermissionOverride.user_id == user.id,
                    UserPermissionOverride.screen_id == screen_row.id,
                )
            )
        ).scalars()
        for ov in overrides:
            if ov.layer == "L1":
                mode = ov.override_value
            elif ov.layer == "L2" and ov.action_key:
                if ov.override_value == "allow":
                    allowed_actions.add(ov.action_key)
                else:
                    allowed_actions.discard(ov.action_key)
            elif ov.layer == "L3" and ov.field_key:
                field_modes[ov.field_key] = ov.override_value
            elif ov.layer == "L4":
                mode = ov.override_value

    return PermissionSet(
        screen_key=screen_key,
        mode=mode,
        allowed_actions=frozenset(allowed_actions),
        field_modes=field_modes,
        role_code=role_code,
    )


async def resolve_all_permissions(db: AsyncSession, user: User, preview_role_id: str | None = None) -> dict[str, PermissionSet]:
    """Bulk variant of resolve_permission for EVERY registered screen at
    once — powers GET /api/v1/me, the Angular app-initializer call that
    blocks first paint (ARCH-3 §4/§8). Calling resolve_permission once per
    screen would be up to 4 sequential queries x 81 screens = 324 round
    trips on every login; this is 5 queries total regardless of screen
    count, same default-deny/override semantics as the single-screen path.

    preview_role_id: RBAC §4.2 "Preview as this role" — Super Admin only
    (enforced by the caller, api/v1/auth.py's get_me). When set, Layers 1-3
    (screen mode, action grants, field sensitivity) are resolved for THIS
    role instead of user.role_id. Deliberately NOT part of the preview: the
    per-user override layer below — overrides belong to one specific real
    person's own row, and blending a stranger's individual grant/revoke into
    an abstract role preview would be incoherent, not a preview of the role.

    Layer 4 (scope) is NOT this function's concern either way — this bulk
    path only ever backs GET /me (nav/UI shape), which has no rows to scope
    in the first place. The single-screen `resolve_permission` above is
    where a previewed mode actually reaches list/detail endpoints (every
    `require_screen()` caller applies scope off the SAME resolved
    PermissionSet) — see that function's own docstring for why threading
    `preview_role_id` through there is safe: the real caller's own linked-
    employee id (never the previewed role's) is what an 'own'/'team' scope
    narrows against, so Super Admin previewing lands on zero rows, not a
    specific other person's data.
    """
    role_id = preview_role_id or user.role_id
    screen_rows = (await db.execute(select(Screen))).scalars().all()
    screen_id_by_key = {s.screen_key: s.id for s in screen_rows}

    role_perms = (
        await db.execute(select(RolePermission).where(RolePermission.role_id == role_id))
    ).scalars()
    mode_by_screen_id = {rp.screen_id: rp.mode for rp in role_perms}

    action_rows = (
        await db.execute(
            select(RolePermissionAction).where(
                RolePermissionAction.role_id == role_id, RolePermissionAction.allowed.is_(True)
            )
        )
    ).scalars()
    actions_by_screen_id: dict[str, set[str]] = {}
    for r in action_rows:
        actions_by_screen_id.setdefault(r.screen_id, set()).add(r.action_key)

    field_rows = (
        await db.execute(select(RolePermissionField).where(RolePermissionField.role_id == role_id))
    ).scalars()
    fields_by_screen_id: dict[str, dict[str, str]] = {}
    for r in field_rows:
        fields_by_screen_id.setdefault(r.screen_id, {})[r.field_key] = r.mode

    overrides_by_screen_id: dict[str, list[UserPermissionOverride]] = {}
    if preview_role_id is None:
        for ov in (
            await db.execute(select(UserPermissionOverride).where(UserPermissionOverride.user_id == user.id))
        ).scalars():
            overrides_by_screen_id.setdefault(ov.screen_id, []).append(ov)

    # Fetched ONCE for the whole bulk call, not per screen — one extra role
    # lookup on top of the fixed 5 queries this function already promises
    # regardless of screen count. Unconditional (unlike the toggle-table scan
    # just below, which stays gated): every PermissionSet this function
    # returns now carries role_code, not just the ones on a gated screen —
    # see PermissionSet's own docstring for why a caller might need it.
    role = await db.get(Role, role_id)
    role_code = role.code if role else ""
    enabled_toggles: set[str] = set()
    if ACTION_TOGGLE_GATES or MODE_TOGGLE_GATES:
        enabled_toggles = await _enabled_toggle_keys(db)

    result: dict[str, PermissionSet] = {}
    for screen_key, screen_def in SCREENS.items():
        screen_id = screen_id_by_key.get(screen_key)
        if screen_id is None:
            result[screen_key] = PermissionSet(screen_key=screen_key, mode="none", role_code=role_code)
            continue
        mode = mode_by_screen_id.get(screen_id, "none")
        # Same ordering as resolve_permission: mode-gate BEFORE the
        # VISIBLE_MODES check right below, since it can make an otherwise-
        # invisible screen visible in the first place.
        mode = _apply_mode_gate(screen_key, role_code, mode, enabled_toggles)
        allowed_actions = set(actions_by_screen_id.get(screen_id, ())) if mode in VISIBLE_MODES else set()
        _apply_toggle_gates(screen_key, role_code, mode, allowed_actions, enabled_toggles)
        # Same fix as resolve_permission above — no gate on the static tuple.
        # fields_by_screen_id was already built from ALL RolePermissionField
        # rows for this role (one query for every screen, up top), so this is
        # just a dict lookup either way; the `if screen_def.sensitive_fields`
        # guard was purely and silently dropping the 18 auto-synced screens'
        # data on the floor, not saving any work.
        field_modes = dict(fields_by_screen_id.get(screen_id, {}))
        for ov in overrides_by_screen_id.get(screen_id, ()):
            if ov.layer == "L1":
                mode = ov.override_value
            elif ov.layer == "L2" and ov.action_key:
                if ov.override_value == "allow":
                    allowed_actions.add(ov.action_key)
                else:
                    allowed_actions.discard(ov.action_key)
            elif ov.layer == "L3" and ov.field_key:
                field_modes[ov.field_key] = ov.override_value
            elif ov.layer == "L4":
                mode = ov.override_value
        result[screen_key] = PermissionSet(
            screen_key=screen_key, mode=mode, allowed_actions=frozenset(allowed_actions), field_modes=field_modes,
            role_code=role_code,
        )
    return result
