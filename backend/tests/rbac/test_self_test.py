"""BUILD-PROMPT §15: 'a checker that never reports a problem proves nothing —
every quality gate must first be shown to fail on a known-bad input.' This
project has already been bitten by that exact failure twice during the
prototype phase (a coverage checker and an alignment checker that both
silently reported clean while the defect they existed to catch was present).

This test proves find_mismatches() (tests/rbac/matrix.py), which the real
exhaustive matrix test (test_matrix.py) trusts to be silent when everything
is correct, is ALSO capable of being loud when something is wrong. Without
this test, a bug in find_mismatches() itself — e.g. comparing a field against
itself, or a typo that always evaluates True — could make test_matrix.py pass
forever regardless of what the resolver actually does.

The injected fault mirrors a real bug already found in this project's
prototype: an action/screen silently visible to a role it should not be
(the Timesheets 'Approve' button leaking to Employee, prototype session).
"""

from tests.conftest import seed_with_override
from tests.rbac.matrix import find_mismatches


async def test_matrix_checker_detects_a_real_permission_leak(db_session):
    # Deliberately wrong: Employee granted 'full' on a Super-Admin-only screen.
    ids = await seed_with_override(
        db_session,
        {"masters.financial_year": {"EMPLOYEE": "full"}},
    )

    problems = await find_mismatches(db_session, ids)

    assert problems, "find_mismatches() reported NO problems against a deliberately broken permission set — the matrix checker cannot be trusted"
    assert any("EMPLOYEE x masters.financial_year" in p for p in problems), (
        f"find_mismatches() found problems, but not the specific injected one. Found: {problems}"
    )


async def test_matrix_checker_is_silent_on_a_correct_setup(db_session):
    # The companion assertion: a checker that flags everything is as useless
    # as one that flags nothing. Prove it stays silent on the real policy.
    ids = await seed_with_override(db_session, {})  # no override = canonical

    problems = await find_mismatches(db_session, ids)

    assert not problems, f"find_mismatches() falsely flagged a correct permission set: {problems}"
