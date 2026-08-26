"""Closes a real coverage gap in the RBAC drift-protection suite:
test_seed_matches_canonical.py checks SCREEN_PERMISSIONS/SCREEN_ACTION_PERMISSIONS
against tests/conftest.py's CANONICAL_* dicts, but nothing anywhere checks
app/rbac/toggles.py's own three structures — TOGGLE_DEFAULTS,
ACTION_TOGGLE_GATES, MODE_TOGGLE_GATES — for internal consistency with each
other or with the SCREENS registry.

Two real bugs were found by hand in exactly this area during a manual audit:
  1. A dead toggle key: an ACTION_TOGGLE_GATES/MODE_TOGGLE_GATES entry
     referencing a screen_key no longer in the SCREENS registry (or an
     action_key never declared on that screen's own ScreenDef.actions).
  2. A seed.py upsert bug: re-seeding an already-existing FeatureToggle row
     silently did nothing, so a toggle's module_key/default_enabled
     correcting in code (TOGGLE_DEFAULTS) never reached the DB row — while
     the live `enabled` value (Super Admin's own runtime state) must never
     be touched by a reseed either way.

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
from app.models.rbac import FeatureToggle
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
