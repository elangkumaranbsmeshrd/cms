"""Shared comparison helper used by both the exhaustive matrix test and the
self-test that proves the matrix test can actually fail. Not itself a test
file (no test_ prefix) — imported by both.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import User
from app.rbac.resolver import resolve_permission
from tests.conftest import CANONICAL_ACTIONS, CANONICAL_SCREEN_MODE, ROLE_CODES


async def find_mismatches(db: AsyncSession, ids: dict) -> list[str]:
    """Resolves every (role, screen) pair against the live DB and compares it
    to the canonical prototype-derived policy. Returns a list of human-
    readable mismatch descriptions — empty means everything matched.
    """
    problems: list[str] = []
    for screen_key, per_role in CANONICAL_SCREEN_MODE.items():
        for role_code in ROLE_CODES:
            user = await db.get(User, ids["user:" + role_code])
            perms = await resolve_permission(db, user, screen_key)
            expected_mode = per_role[role_code]
            if perms.mode != expected_mode:
                problems.append(
                    f"{role_code} x {screen_key}: mode was {perms.mode!r}, expected {expected_mode!r}"
                )

            expected_actions = {
                action for action, roles in CANONICAL_ACTIONS.get(screen_key, {}).items() if role_code in roles
            }
            if set(perms.allowed_actions) != expected_actions:
                problems.append(
                    f"{role_code} x {screen_key}: actions were {sorted(perms.allowed_actions)}, "
                    f"expected {sorted(expected_actions)}"
                )
    return problems
