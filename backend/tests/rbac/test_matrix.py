"""The real exhaustive (role x screen) matrix test — trusted only because
test_self_test.py, run in the same suite, proves find_mismatches() can
actually detect a wrong permission. Run that file's tests too; a green
test_matrix.py alone proves nothing per BUILD-PROMPT §15.
"""

from tests.conftest import seed_canonical
from tests.rbac.matrix import find_mismatches


async def test_full_matrix_matches_canonical_policy(db_session):
    ids = await seed_canonical(db_session)
    problems = await find_mismatches(db_session, ids)
    assert not problems, "RBAC matrix drifted from the canonical (prototype-derived) policy:\n" + "\n".join(problems)


async def test_unseeded_screen_is_invisible_to_everyone(db_session):
    """Fail-closed check (resolver.py's own comment): a screen the registry
    knows about but that has no row in the `screens` table yet must resolve
    to 'none' for every role, never to full access by default.
    """
    from app.models.platform import User
    from app.models.rbac import Role
    from app.rbac.resolver import resolve_permission
    import uuid

    role = Role(id=str(uuid.uuid4()), code="SUPER_ADMIN", name="Super Admin")
    db_session.add(role)
    await db_session.flush()
    user = User(id=str(uuid.uuid4()), email="x@test.local", password_hash="x", full_name="X", role_id=role.id)
    db_session.add(user)
    await db_session.commit()

    perms = await resolve_permission(db_session, user, "masters.financial_year")
    assert perms.mode == "none"
    assert not perms.visible
