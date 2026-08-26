"""Closes a real coverage gap the Phase 5 audit found: test_matrix.py proves
the resolver reads back whatever CANONICAL_SCREEN_MODE/CANONICAL_ACTIONS say
was seeded into the test DB — it never touches app/seed.py, the script that
actually seeds the real database. Two independently-maintained sources
(CANONICAL_* here, hand-written from the spec; app/seed.py's
SCREEN_PERMISSIONS/SCREEN_ACTION_PERMISSIONS, also hand-written from the
spec) could silently drift apart with nothing to catch it. This test is that
catch — a plain dict comparison, no DB involved, so it can't accidentally
inherit test_matrix.py's own blind spot.

Deliberately NOT "derive CANONICAL_* from app.seed" — that would make
test_matrix.py compare seed.py against itself and defeat the whole point of
keeping an independent transcription (see conftest.py's own docstring on
why CANONICAL_* exists and what test_self_test.py proves about it).
"""

from app.seed import SCREEN_ACTION_PERMISSIONS, SCREEN_PERMISSIONS
from tests.conftest import CANONICAL_ACTIONS, CANONICAL_SCREEN_MODE


def test_seed_screen_modes_match_canonical_policy():
    all_screens = set(SCREEN_PERMISSIONS) | set(CANONICAL_SCREEN_MODE)
    problems = []
    for screen_key in sorted(all_screens):
        seeded = SCREEN_PERMISSIONS.get(screen_key)
        canonical = CANONICAL_SCREEN_MODE.get(screen_key)
        if seeded is None:
            problems.append(f"{screen_key}: in CANONICAL_SCREEN_MODE (tests/conftest.py) but missing from app.seed.SCREEN_PERMISSIONS")
        elif canonical is None:
            problems.append(f"{screen_key}: in app.seed.SCREEN_PERMISSIONS but missing from CANONICAL_SCREEN_MODE (tests/conftest.py)")
        elif seeded != canonical:
            problems.append(f"{screen_key}: seed.py={seeded!r} != canonical={canonical!r}")
    assert not problems, "app.seed.SCREEN_PERMISSIONS drifted from tests/conftest.py's CANONICAL_SCREEN_MODE:\n" + "\n".join(problems)


def test_seed_screen_actions_match_canonical_policy():
    all_screens = set(SCREEN_ACTION_PERMISSIONS) | set(CANONICAL_ACTIONS)
    problems = []
    for screen_key in sorted(all_screens):
        seeded = {action: set(roles) for action, roles in SCREEN_ACTION_PERMISSIONS.get(screen_key, {}).items()}
        canonical = {action: set(roles) for action, roles in CANONICAL_ACTIONS.get(screen_key, {}).items()}
        if seeded != canonical:
            problems.append(f"{screen_key}: seed.py={seeded!r} != canonical={canonical!r}")
    assert not problems, "app.seed.SCREEN_ACTION_PERMISSIONS drifted from tests/conftest.py's CANONICAL_ACTIONS:\n" + "\n".join(problems)
