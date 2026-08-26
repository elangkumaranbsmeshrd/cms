"""Compare the LIVE MySQL RBAC matrix against tests/conftest.py's canonical
policy. The existing drift tests all build a throwaway SQLite DB, so nothing
has ever checked the dev database itself for drift -- which is exactly how a
test agent's PUT /rbac/matrix call could quietly change real permissions.
"""
import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from app.core.db import AsyncSessionLocal  # noqa: E402
from app.models.rbac import (  # noqa: E402
    Role,
    RolePermission,
    RolePermissionAction,
    RolePermissionField,
    Screen,
)
from tests.conftest import CANONICAL_ACTIONS, CANONICAL_SCREEN_MODE  # noqa: E402


async def main() -> int:
    async with AsyncSessionLocal() as db:
        roles = {r.id: r.code for r in (await db.execute(select(Role))).scalars()}
        screens = {s.id: s.screen_key for s in (await db.execute(select(Screen))).scalars()}

        live_mode: dict[tuple[str, str], str] = {}
        for rp in (await db.execute(select(RolePermission))).scalars():
            live_mode[(screens[rp.screen_id], roles[rp.role_id])] = rp.mode

        mode_drift = []
        for screen_key, per_role in CANONICAL_SCREEN_MODE.items():
            for role_code, expected in per_role.items():
                actual = live_mode.get((screen_key, role_code), "<missing>")
                if actual != expected:
                    mode_drift.append((screen_key, role_code, expected, actual))

        live_actions: dict[tuple[str, str, str], bool] = {}
        for a in (await db.execute(select(RolePermissionAction))).scalars():
            live_actions[(screens[a.screen_id], roles[a.role_id], a.action_key)] = bool(a.allowed)

        canon_actions = set()
        for screen_key, per_action in CANONICAL_ACTIONS.items():
            for action_key, allowed_roles in per_action.items():
                for role_code in allowed_roles:
                    canon_actions.add((screen_key, role_code, action_key))

        missing = [k for k in canon_actions if not live_actions.get(k, False)]
        extra = [k for k, allowed in live_actions.items() if k not in canon_actions and allowed]
        # A row that exists but is denied matches "absent" semantically; list it
        # separately as junk rather than as a permission difference.
        junk_denied = [k for k, allowed in live_actions.items() if k not in canon_actions and not allowed]

        live_fields = []
        for f in (await db.execute(select(RolePermissionField))).scalars():
            live_fields.append((screens[f.screen_id], roles[f.role_id], f.field_key, f.mode))

    print("=" * 78)
    print(f"MODE DRIFT (Layer 1/4): {len(mode_drift)}")
    for row in mode_drift:
        print(f"   {row[0]:34} {row[1]:14} expected={row[2]:10} actual={row[3]}")

    print(f"\nMISSING ACTION GRANTS (canonical says yes, live says no): {len(missing)}")
    for row in sorted(missing):
        print(f"   {row[0]:34} {row[1]:14} {row[2]}")

    print(f"\nEXTRA ACTION GRANTS (live grants what canonical does not): {len(extra)}")
    for row in sorted(extra):
        print(f"   {row[0]:34} {row[1]:14} {row[2]}")

    print(f"\nJUNK DENIED ROWS (harmless but should not exist): {len(junk_denied)}")
    for row in sorted(junk_denied):
        print(f"   {row[0]:34} {row[1]:14} {row[2]}")

    print(f"\nFIELD RULES currently live: {len(live_fields)}")
    for row in sorted(live_fields):
        print(f"   {row[0]:34} {row[1]:14} {row[2]:24} {row[3]}")

    print("=" * 78)
    return 1 if (mode_drift or missing or extra) else 0


raise SystemExit(asyncio.run(main()))
