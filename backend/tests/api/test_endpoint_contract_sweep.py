"""Layer 2's cross-cutting checks, applied to EVERY endpoint at once.

COMPLETE-TEST-PROMPT.md asks seven checks of all 477 endpoints. Four of them
are mechanical and identical everywhere — auth, unknown id, malformed body, and
"never a 500" — so they belong in one schema-driven sweep rather than repeated
by hand in 43 per-router files. An endpoint added tomorrow is covered here
without anyone remembering to write it.

The other three (happy path, scope, round-trip) are genuinely per-endpoint and
live in the per-router files: they need real fixtures and real expected values,
and a generic version of them would either be vacuous or wrong.

WHAT "REFUSED" MEANS HERE. require_screen 404s a screen the caller cannot see
rather than 403ing it, so an invisible screen is indistinguishable from a
missing row by design. Both are refusals. The assertion is therefore on the
status CLASS, never on one exact code — asserting 403 specifically would fail
against a deliberate and documented behaviour.

WHY 500 IS THE HEADLINE ASSERTION. A 500 is never a correct answer to a badly
formed request. It means a guard threw instead of refusing, and it leaks a
stack trace to whoever sent the request. This project has already shipped that
exact bug three separate times — a bare ValueError from list_export escaping as
a 500 on ~40 list endpoints, allocate_number doing the same, and the DBAPIError
handlers that were missing from a dozen routers. Each was found by exercising
an endpoint, never by reading it.
"""

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.platform import User
from tests.conftest import seed_canonical

# Endpoints excluded from the authenticated sweeps, with the reason. Anything
# added here needs a written justification — an unexplained exclusion is how a
# real hole gets skipped forever.
UNAUTHENTICATED_BY_DESIGN = {
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/password/reset-request",
    "/api/v1/auth/password/reset",
    # Not under the /api/v1 prefix, and deliberately open: the Dockerfile's
    # HEALTHCHECK and any load balancer in front of this must reach it
    # without credentials. It returns only {"status", "database"}.
    "/health",
}


def _operations() -> list[tuple[str, str]]:
    spec = app.openapi()
    return sorted(
        (method.upper(), path)
        for path, ops in spec["paths"].items()
        for method in ops
        if method in ("get", "post", "put", "patch", "delete")
    )


OPERATIONS = _operations()
# Paths carrying an {id}: a fabricated id is exactly what the unknown-id sweep
# wants, and it also means the request never mutates a real row.
PARAMETERISED = [(m, p) for m, p in OPERATIONS if "{" in p]
BODY_METHODS = {"POST", "PUT", "PATCH"}


def _concrete(path: str) -> str:
    out = path
    while "{" in out:
        head, _, rest = out.partition("{")
        _, _, tail = rest.partition("}")
        out = f"{head}{uuid.uuid4()}{tail}"
    return out


@pytest_asyncio.fixture
async def super_admin(db_session) -> User:
    await seed_canonical(db_session)
    from sqlalchemy import select

    from app.models.rbac import Role

    role = (await db_session.execute(select(Role).where(Role.code == "SUPER_ADMIN"))).scalar_one()
    user = User(
        id=str(uuid.uuid4()),
        email="sweep.super@meshrd.in",
        password_hash="x",
        full_name="Sweep Super Admin",
        role_id=role.id,
        is_enabled=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def client(db_session):
    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


def test_the_sweep_covers_the_real_surface():
    """Guard the guard: if the schema walk breaks, every sweep below would pass
    while exercising nothing.
    """
    assert len(OPERATIONS) >= 400, f"expected the app's endpoint surface, found {len(OPERATIONS)}"
    assert len(PARAMETERISED) >= 200, f"expected parameterised paths, found {len(PARAMETERISED)}"


@pytest.mark.asyncio
async def test_no_endpoint_answers_an_anonymous_caller(client):
    """Check 4 of the matrix: no token -> 401.

    Runs with get_current_user NOT overridden, so the real dependency decides.
    """
    leaks: list[str] = []
    for method, path in OPERATIONS:
        if path in UNAUTHENTICATED_BY_DESIGN:
            continue
        res = await client.request(method, _concrete(path))
        # 401 is the correct answer. 403 is acceptable if a guard runs first.
        # Anything 2xx means the endpoint served an anonymous caller.
        if res.status_code < 400:
            leaks.append(f"{method} {path} -> {res.status_code}")
    assert not leaks, "endpoints answered an unauthenticated caller:\n  " + "\n  ".join(leaks)


@pytest.mark.asyncio
async def test_an_unknown_id_is_never_a_server_error(super_admin, client):
    """Check 3: unknown id -> 404, not 500.

    Driven as Super Admin so RBAC cannot be what produces the refusal — this
    isolates "the row does not exist" from "you may not see this screen".
    """
    app.dependency_overrides[get_current_user] = lambda: super_admin
    crashes: list[str] = []
    for method, path in PARAMETERISED:
        url = _concrete(path)
        res = await client.request(method, url, json={} if method in BODY_METHODS else None)
        if res.status_code >= 500:
            crashes.append(f"{method} {path} -> {res.status_code}: {res.text[:140]}")
    assert not crashes, (
        "an unknown id produced a server error instead of a refusal:\n  " + "\n  ".join(crashes)
    )


@pytest.mark.asyncio
async def test_a_malformed_body_is_never_a_server_error(super_admin, client):
    """Check 2: bad/missing/wrong-type fields -> 422, not 500.

    Three shapes, because they fail at different layers: an empty object
    (missing required fields), wrong types for everything, and a body that is
    not an object at all.
    """
    app.dependency_overrides[get_current_user] = lambda: super_admin
    bodies = {
        "empty object": {},
        "wrong types": {"name": 12345, "amount": "not-a-number", "date": True, "id": [], "status": {}},
        "not an object": ["unexpected", "list"],
    }
    crashes: list[str] = []
    for method, path in OPERATIONS:
        if method not in BODY_METHODS or path in UNAUTHENTICATED_BY_DESIGN:
            continue
        url = _concrete(path)
        for label, body in bodies.items():
            res = await client.request(method, url, json=body)
            if res.status_code >= 500:
                crashes.append(f"{method} {path} [{label}] -> {res.status_code}: {res.text[:120]}")
    assert not crashes, (
        "a malformed body produced a server error instead of a 422:\n  " + "\n  ".join(crashes)
    )


@pytest.mark.asyncio
async def test_no_endpoint_leaks_a_driver_error_to_the_caller(super_admin, client):
    """A refusal must not hand back the database's own words.

    Distinct from the 500 checks: a route can catch an error, return a tidy
    4xx, and still paste the driver's message — which names tables, columns
    and constraints to whoever sent the request.
    """
    app.dependency_overrides[get_current_user] = lambda: super_admin
    markers = ("Traceback", "sqlalchemy.", "asyncmy", "pymysql", "IntegrityError", "OperationalError", "SELECT ", "INSERT INTO")
    leaks: list[str] = []
    for method, path in PARAMETERISED:
        res = await client.request(method, _concrete(path), json={} if method in BODY_METHODS else None)
        body = res.text[:4000]
        hit = next((m for m in markers if m in body), None)
        if hit:
            leaks.append(f"{method} {path} -> {res.status_code} leaked {hit!r}")
    assert not leaks, "responses leaked database internals:\n  " + "\n  ".join(leaks)
