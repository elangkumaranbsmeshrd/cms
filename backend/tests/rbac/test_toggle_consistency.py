"""Closes a real coverage gap in the RBAC drift-protection suite:
test_seed_matches_canonical.py checks SCREEN_PERMISSIONS/SCREEN_ACTION_PERMISSIONS
against tests/conftest.py's CANONICAL_* dicts, but nothing anywhere checks
app/rbac/toggles.py's own three structures — TOGGLE_DEFAULTS,
ACTION_TOGGLE_GATES, MODE_TOGGLE_GATES — for internal consistency with each
other or with the SCREENS registry.

Three real bugs were found by hand in exactly this area during a manual audit:
  1. A dead toggle key: an ACTION_TOGGLE_GATES/MODE_TOGGLE_GATES entry
     referencing a screen_key no longer in the SCREENS registry (or an
     action_key never declared on that screen's own ScreenDef.actions).
  2. A seed.py upsert bug: re-seeding an already-existing FeatureToggle row
     silently did nothing, so a toggle's module_key/default_enabled
     correcting in code (TOGGLE_DEFAULTS) never reached the DB row — while
     the live `enabled` value (Super Admin's own runtime state) must never
     be touched by a reseed either way.
  3. The same insert-only flaw in the RolePermissionAction loop, found live:
     a PUT /rbac/matrix save wrote allowed=0 onto rows SCREEN_ACTION_PERMISSIONS
     declares as granted, and re-seeding could never repair them — the role
     stayed permanently denied an action the code says it holds, because
     resolve_permission only reads `allowed.is_(True)` rows.

These tests make that whole class of bug catch itself automatically. None of
them hardcode len(TOGGLE_DEFAULTS) or any other toggle count — that number
legitimately grows every time a new module toggle is added, and a
hardcoded-count assertion would just be an annoying thing to keep bumping.

One deliberately-not-written check: "every TOGGLE_DEFAULTS entry must appear
in ACTION_TOGGLE_GATES or MODE_TOGGLE_GATES somewhere." toggles.py's own
module docstring is explicit that this is not the shape of the system — most
toggles are field-level (Layer 3 masking, e.g. sensitive_fields) or read
directly inside a router's own business logic (e.g. Expense's "Set an
Auto-Approval Threshold", "Require a Receipt Before Approval"), and are never
meant to be resolver-level gates at all. Asserting "ungated" is a bug would
just become permanent, ever-growing exception-list noise, exactly what this
file's own docstring elsewhere warns against for toggle counts — so the
reverse direction (gate -> real toggle, dead-toggle bug #1 above) is the only
direction tested.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.seed as seed_module
from app.core.db import Base
from app.models.rbac import FeatureToggle, Role, RolePermissionAction, RolePermissionField, Screen
from app.rbac.registry.screens import SCREENS
from app.rbac.resolver import VISIBLE_MODES
from app.rbac.toggles import ACTION_TOGGLE_GATES, MODE_TOGGLE_GATES, TOGGLE_DEFAULTS
from tests.conftest import ROLE_CODES

# resolver.py's PermissionSet.mode docstring: 'none' | 'full' | 'view' |
# 'view_team' | 'own' | 'team' — VISIBLE_MODES is that set minus 'none'
# (the one mode that means "not visible at all", so it can never be what a
# ModeGate widens TO — see ModeGate's own docstring: "never used to narrow").
ALL_MODES = VISIBLE_MODES | {"none"}


def test_no_duplicate_toggle_keys():
    keys = [toggle_key for toggle_key, _module_key, _default in TOGGLE_DEFAULTS]
    seen: set[str] = set()
    duplicates = {key for key in keys if key in seen or seen.add(key)}
    assert not duplicates, f"TOGGLE_DEFAULTS has duplicate toggle_key(s): {sorted(duplicates)}"


def test_action_toggle_gates_reference_real_screens_and_actions():
    """Generalizes the exact orphan-gate bug the manual audit caught by hand:
    an ACTION_TOGGLE_GATES key naming a screen_key with no ScreenDef, or an
    action_key that screen's own ScreenDef.actions never declares.
    """
    problems = []
    for screen_key, action_key in ACTION_TOGGLE_GATES:
        screen = SCREENS.get(screen_key)
        if screen is None:
            problems.append(f"({screen_key!r}, {action_key!r}): screen_key not in SCREENS registry")
            continue
        if action_key not in screen.actions:
            problems.append(
                f"({screen_key!r}, {action_key!r}): action_key {action_key!r} not declared in "
                f"SCREENS[{screen_key!r}].actions {screen.actions!r}"
            )
    assert not problems, "ACTION_TOGGLE_GATES has orphan (screen_key, action_key) pair(s):\n" + "\n".join(problems)


def test_mode_toggle_gates_reference_real_screens():
    problems = [screen_key for screen_key in MODE_TOGGLE_GATES if screen_key not in SCREENS]
    assert not problems, f"MODE_TOGGLE_GATES references screen_key(s) not in the SCREENS registry: {problems}"


def test_gate_toggle_keys_exist_in_toggle_defaults():
    """The reverse of the dead-toggle bug: a gate pointing at a toggle_key
    TOGGLE_DEFAULTS doesn't actually define. resolve_permission would just
    never match `gate.toggle_key in enabled_toggles` for a key no
    FeatureToggle row could ever have — a silently-permanently-off gate.
    """
    valid_toggle_keys = {toggle_key for toggle_key, _module_key, _default in TOGGLE_DEFAULTS}
    problems = []
    for (screen_key, action_key), gate in ACTION_TOGGLE_GATES.items():
        if gate.toggle_key not in valid_toggle_keys:
            problems.append(
                f"ACTION_TOGGLE_GATES[{(screen_key, action_key)!r}].toggle_key={gate.toggle_key!r} "
                "is not defined in TOGGLE_DEFAULTS"
            )
    for screen_key, gate in MODE_TOGGLE_GATES.items():
        if gate.toggle_key not in valid_toggle_keys:
            problems.append(
                f"MODE_TOGGLE_GATES[{screen_key!r}].toggle_key={gate.toggle_key!r} is not defined in TOGGLE_DEFAULTS"
            )
    assert not problems, "Gate references a toggle_key with no TOGGLE_DEFAULTS entry (dead toggle):\n" + "\n".join(problems)


def test_every_gate_role_is_a_real_role_code():
    valid_roles = set(ROLE_CODES)
    problems = []
    for key, gate in ACTION_TOGGLE_GATES.items():
        unknown = set(gate.roles) - valid_roles
        if unknown:
            problems.append(f"ACTION_TOGGLE_GATES[{key!r}].roles has unknown role code(s): {sorted(unknown)}")
    for key, gate in MODE_TOGGLE_GATES.items():
        unknown = set(gate.roles) - valid_roles
        if unknown:
            problems.append(f"MODE_TOGGLE_GATES[{key!r}].roles has unknown role code(s): {sorted(unknown)}")
    assert not problems, "\n".join(problems)


def test_every_mode_gate_mode_is_a_real_mode():
    problems = [
        f"MODE_TOGGLE_GATES[{screen_key!r}].mode={gate.mode!r} is not one of the real mode strings {sorted(ALL_MODES)}"
        for screen_key, gate in MODE_TOGGLE_GATES.items()
        if gate.mode not in ALL_MODES
    ]
    assert not problems, "\n".join(problems)


async def test_seed_toggle_upsert_corrects_drifted_module_key_and_default_without_resetting_enabled(monkeypatch):
    """Regression test for the Stage 15 seed.py fix. Before that fix, the
    `existing` branch of the TOGGLE_DEFAULTS upsert loop (app/seed.py, "for
    toggle_key, module_key, default_enabled in TOGGLE_DEFAULTS") did nothing
    at all on re-seed: a toggle's module_key/default_enabled correcting in
    code never reached an already-seeded row. `enabled` must still never be
    touched — that's Super Admin's own live runtime state, not something a
    reseed owns (seed.py's own comment on this branch).

    Calls the REAL app.seed.seed(), not a copy of its logic, so a future
    regression in seed.py itself would actually be caught here — not just in
    a hand-maintained duplicate of its upsert logic. seed() hardcodes its own
    module-level AsyncSessionLocal (bound to the real configured database), so
    it's monkeypatched to a throwaway in-memory engine for the duration of
    this test, same reasoning tests/conftest.py's own db_session fixture uses
    for every other RBAC test in this package — this just also needs the
    underlying engine/sessionmaker (not only a session), to point seed()'s
    own session factory at the same throwaway DB the test itself queries
    afterward, which the plain `db_session` fixture doesn't expose.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    toggle_key, code_module_key, code_default_enabled = TOGGLE_DEFAULTS[0]

    async with session_factory() as db:
        db.add(
            FeatureToggle(
                id=str(uuid.uuid4()),
                toggle_key=toggle_key,
                module_key="drifted_module_key",  # deliberately wrong vs. TOGGLE_DEFAULTS' own module_key
                label=toggle_key,
                enabled=True,  # simulates a Super Admin having flipped this toggle on at runtime
                default_enabled=(not code_default_enabled),  # deliberately wrong vs. code's own default
            )
        )
        await db.commit()

    monkeypatch.setattr(seed_module, "AsyncSessionLocal", session_factory)
    try:
        await seed_module.seed()

        async with session_factory() as db:
            row = (
                await db.execute(select(FeatureToggle).where(FeatureToggle.toggle_key == toggle_key))
            ).scalar_one()
    finally:
        await engine.dispose()

    assert row.module_key == code_module_key, (
        f"seed() did not correct a drifted module_key: expected {code_module_key!r}, got {row.module_key!r} — "
        "the Stage 15 upsert fix may have regressed"
    )
    assert row.default_enabled == code_default_enabled, (
        f"seed() did not correct a drifted default_enabled: expected {code_default_enabled!r}, got "
        f"{row.default_enabled!r} — the Stage 15 upsert fix may have regressed"
    )
    assert row.enabled is True, (
        "seed() must never reset a toggle's live `enabled` value back to the code's own default — that's "
        "Super Admin's own runtime state (seed.py's own comment on this branch)"
    )


# A value no seed run could ever produce, so finding it still there after a
# reseed proves the reseed left the column alone rather than coincidentally
# rewriting it to the same thing.
UNDECLARED_MASK_REASON = "set by an operator, never by the code"


async def test_seed_permission_upsert_corrects_drifted_grant_without_erasing_undeclared_state(monkeypatch):
    """Regression test for bug #3 in this module's docstring — the same
    insert-only flaw as the Stage 15 FeatureToggle one, in the two permission
    loops of app/seed.py ("for screen_key, per_action in
    SCREEN_ACTION_PERMISSIONS" / "... SCREEN_FIELD_PERMISSIONS").

    RolePermissionAction.allowed was the live case: a PUT /rbac/matrix save
    wrote allowed=0 onto rows SCREEN_ACTION_PERMISSIONS declares as granted,
    and because that loop was `if not existing: db.add(...)` with no else,
    re-seeding could never repair them. resolve_permission only ever reads
    `allowed.is_(True)` rows, so a False row is indistinguishable from no row:
    the role stayed permanently denied an action the code says it holds.

    RolePermissionField.mode has always been reset here, so it is asserted as
    a guard against that regressing. Its `mask_reason` sibling must NOT be —
    SCREEN_FIELD_PERMISSIONS carries only the mode string, so there is no
    code-declared value for a reseed to restore, exactly the reasoning that
    keeps Stage 15 from resetting FeatureToggle.enabled.

    Same monkeypatched throwaway-engine setup as the toggle test above, and
    for the same reason. Unlike that test the drifted row can't be planted
    before the first seed() — a permission row needs the role_id/screen_id
    seed() itself generates — so this runs the real seed path twice, which
    also exercises its idempotency.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    action_screen_key, per_action = next(iter(seed_module.SCREEN_ACTION_PERMISSIONS.items()))
    action_key, granted_roles = next(iter(per_action.items()))
    action_role_code = granted_roles[0]

    field_screen_key, per_field = next(iter(seed_module.SCREEN_FIELD_PERMISSIONS.items()))
    field_key, per_field_role = next(iter(per_field.items()))
    field_role_code, code_field_mode = next(iter(per_field_role.items()))
    drifted_field_mode = "show" if code_field_mode != "show" else "hide"

    monkeypatch.setattr(seed_module, "AsyncSessionLocal", session_factory)
    try:
        await seed_module.seed()

        async with session_factory() as db:
            action_row = (
                await db.execute(
                    select(RolePermissionAction)
                    .join(Role, Role.id == RolePermissionAction.role_id)
                    .join(Screen, Screen.id == RolePermissionAction.screen_id)
                    .where(
                        Role.code == action_role_code,
                        Screen.screen_key == action_screen_key,
                        RolePermissionAction.action_key == action_key,
                    )
                )
            ).scalar_one()
            assert action_row.allowed is True, "seed() should have granted this action on the first run"
            action_row.allowed = False  # exactly what the live PUT /rbac/matrix save wrote

            field_row = (
                await db.execute(
                    select(RolePermissionField)
                    .join(Role, Role.id == RolePermissionField.role_id)
                    .join(Screen, Screen.id == RolePermissionField.screen_id)
                    .where(
                        Role.code == field_role_code,
                        Screen.screen_key == field_screen_key,
                        RolePermissionField.field_key == field_key,
                    )
                )
            ).scalar_one()
            field_row.mode = drifted_field_mode  # deliberately wrong vs. SCREEN_FIELD_PERMISSIONS
            field_row.mask_reason = UNDECLARED_MASK_REASON
            await db.commit()

        await seed_module.seed()

        async with session_factory() as db:
            repaired_action = (
                await db.execute(select(RolePermissionAction).where(RolePermissionAction.id == action_row.id))
            ).scalar_one()
            repaired_field = (
                await db.execute(select(RolePermissionField).where(RolePermissionField.id == field_row.id))
            ).scalar_one()
    finally:
        await engine.dispose()

    assert repaired_action.allowed is True, (
        f"seed() did not repair a drifted grant: ({action_screen_key!r}, {action_key!r}, {action_role_code!r}) is "
        "declared in SCREEN_ACTION_PERMISSIONS but its row is still allowed=False after a reseed — the "
        "RolePermissionAction upsert fix may have regressed back to insert-only"
    )
    assert repaired_field.mode == code_field_mode, (
        f"seed() did not correct a drifted field mode: expected {code_field_mode!r}, got {repaired_field.mode!r}"
    )
    assert repaired_field.mask_reason == UNDECLARED_MASK_REASON, (
        "seed() must never blank a RolePermissionField.mask_reason — SCREEN_FIELD_PERMISSIONS declares no value "
        "for it, so there is nothing canonical to restore and a reseed would just be losing operator data"
    )
