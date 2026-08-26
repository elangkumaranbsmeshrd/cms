"""Layer 3, matrix items 1 and 4 (COMPLETE-TEST-PROMPT.md).

The premise, verbatim: "assume the attacker never opens your UI. They have a
valid low-privilege token and call the API directly with curl. Hiding a button
proves nothing."

Item 4 is the platform rule this file exists to enforce: delete is
Super-Admin-only, everywhere, and is not grantable. Item 1 is direct object
access — one employee reaching another's records by id.

WHY 404 COUNTS AS A REFUSAL HERE. require_screen 404s a screen the caller
cannot see, rather than 403ing it, so an invisible screen cannot be probed for
existence. So a refusal is 403 (screen visible, action not granted) OR 404
(screen not visible at all). What must never happen is a 2xx — or a 500, which
would mean the guard crashed rather than refused.

That makes "never 2xx" alone a weak assertion: a nonexistent id 404s whether or
not RBAC works. Two things keep this honest:
  - test_no_role_but_super_admin_can_actually_delete_a_real_row deletes a REAL
    row and re-reads it, so the refusal is proven by the row still being there.
  - the same test then deletes it as Super Admin, proving the endpoint really
    does delete and the four refusals were not vacuous.
The breadth sweep over all DELETE endpoints is the guard against a NEW endpoint
shipping without the rule; the real-row test is what proves the rule holds.
"""

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.masters import Department
from app.models.platform import User
from tests.conftest import seed_canonical

NON_SUPER_ADMIN = ("MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")


def _delete_paths() -> list[str]:
    """Every DELETE the app exposes, taken from the live OpenAPI schema rather
    than a hand-written list — an endpoint added tomorrow is swept automatically
    instead of quietly escaping the rule.
    """
    spec = app.openapi()
    return sorted(path for path, ops in spec["paths"].items() if "delete" in ops)


DELETE_PATHS = _delete_paths()


def _concrete(path: str) -> str:
    """Fill every {param} with a well-formed UUID that matches nothing."""
    out = path
    while "{" in out:
        head, _, rest = out.partition("{")
        _, _, tail = rest.partition("}")
        out = f"{head}{uuid.uuid4()}{tail}"
    return out


@pytest_asyncio.fixture
async def actors(db_session):
    """One real User per role code, sharing the canonical seeded policy."""
    await seed_canonical(db_session)
    from sqlalchemy import select

    from app.models.rbac import Role

    roles = {r.code: r for r in (await db_session.execute(select(Role))).scalars()}
    users: dict[str, User] = {}
    for code, role in roles.items():
        user = User(
            id=str(uuid.uuid4()),
            email=f"{code.lower()}.escalation@meshrd.in",
            password_hash="x",
            full_name=f"{code} Escalation",
            role_id=role.id,
            is_enabled=True,
            must_change_password=False,
        )
        db_session.add(user)
        users[code] = user
    await db_session.flush()
    return users


@pytest_asyncio.fixture
async def client(db_session):
    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


# --------------------------------------------------------------- item 4
@pytest.mark.asyncio
async def test_the_delete_sweep_is_not_vacuous():
    """Guard the guard: if the OpenAPI walk ever returns nothing, the sweep
    below would pass while testing zero endpoints.
    """
    assert len(DELETE_PATHS) >= 25, f"expected the app's DELETE surface, found {len(DELETE_PATHS)}"


@pytest.mark.asyncio
async def test_no_non_super_admin_role_gets_a_2xx_from_any_delete_endpoint(actors, client):
    """Every DELETE x every non-Super-Admin role. Data-driven from the schema,
    so this covers endpoints nobody thought to name.
    """
    offenders: list[str] = []
    crashes: list[str] = []
    seen: list[int] = []

    for path in DELETE_PATHS:
        url = _concrete(path)
        for code in NON_SUPER_ADMIN:
            _as(actors[code])
            res = await client.delete(url)
            seen.append(res.status_code)
            if 200 <= res.status_code < 300:
                offenders.append(f"{code} got {res.status_code} from DELETE {path}")
            elif res.status_code >= 500:
                crashes.append(f"{code} got {res.status_code} from DELETE {path}: {res.text[:120]}")

    assert not offenders, "delete is Super-Admin-only and not grantable:\n" + "\n".join(offenders)
    # A 500 means the guard threw instead of refusing — still a failure to
    # refuse cleanly, and it leaks a stack trace to an unprivileged caller.
    assert not crashes, "a DELETE crashed rather than refusing:\n" + "\n".join(crashes)


@pytest.mark.asyncio
async def test_no_role_but_super_admin_can_actually_delete_a_real_row(actors, db_session, client):
    """The non-vacuous core of item 4.

    A nonexistent id 404s whether or not RBAC works, so refusal is proven here
    against a REAL row: each of the four roles attempts the delete, and the row
    is re-read afterwards to confirm it survived. Super Admin then deletes it,
    which proves the endpoint genuinely deletes and the four refusals meant
    something.
    """
    row = Department(id=str(uuid.uuid4()), name="Escalation Target", is_active=True)
    db_session.add(row)
    await db_session.flush()
    url = f"/api/v1/masters/departments/{row.id}"

    for code in NON_SUPER_ADMIN:
        _as(actors[code])
        res = await client.delete(url)
        assert res.status_code in (403, 404), f"{code} got {res.status_code} deleting a Department"
        survivor = await db_session.get(Department, row.id)
        assert survivor is not None, f"{code} actually deleted the row despite HTTP {res.status_code}"

    _as(actors["SUPER_ADMIN"])
    res = await client.delete(url)
    assert 200 <= res.status_code < 300, (
        f"Super Admin could not delete either ({res.status_code}) — the four refusals above prove nothing"
    )


# --------------------------------------------------------------- item 1
@pytest.mark.asyncio
async def test_employee_cannot_reach_another_employees_records_by_id(actors, db_session, client):
    """Direct object access. The attacker holds a valid Employee token and simply
    substitutes someone else's id into the URL.
    """
    from datetime import date

    from app.models.employee import Employee

    # Same construction tests/test_file_download_authz.py uses — the seeded
    # canonical fixture provides these master rows.
    victim = Employee(
        id=str(uuid.uuid4()),
        employee_code="ESC-VICTIM-1",
        code_financial_year_id="fy-1",
        first_name="Victim",
        email="victim.esc@test.local",
        department_id="dept-1",
        designation_id="desig-1",
        employment_type_id="emptype-1",
        joining_date=date(2020, 1, 1),
    )
    db_session.add(victim)
    await db_session.flush()

    _as(actors["EMPLOYEE"])
    for url in (
        f"/api/v1/employees/{victim.id}",
        f"/api/v1/employees/{victim.id}/documents",
        f"/api/v1/employees/{victim.id}/salary-structures",
        f"/api/v1/employees/{victim.id}/insurance-enrollments",
        f"/api/v1/employees/{victim.id}/emergency-contacts",
    ):
        res = await client.get(url)
        assert res.status_code in (403, 404), f"EMPLOYEE reached {url} with HTTP {res.status_code}: {res.text[:160]}"
