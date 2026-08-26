"""Layer 3 — bypass matrix items 10 (injection) and 6 (export bypass).

Premise, verbatim from build-docs/COMPLETE-TEST-PROMPT.md: "assume the
attacker never opens your UI. They have a valid low-privilege token and call
the API directly with curl."

Shape follows tests/test_file_download_authz.py — the real app.main FastAPI
app driven through httpx.ASGITransport, conftest's db_session +
seed_canonical (the real seeded RBAC policy) with get_db/get_current_user
overridden onto that session.

------------------------------------------------------------------ ITEM 10a
`search`/filter params are swept DATA-DRIVEN off app.main's own openapi()
rather than a hand-picked list of three endpoints, so a filter added
tomorrow is covered without touching this file. Two complementary passes,
because neither alone is sufficient:

  * `_sweep_targets()` groups a path's free-text params so every one of them
    can carry a payload in a SINGLE request — FastAPI validates the whole
    query string before the handler runs, so mixing a date-typed param into
    that request would 422 the lot and the text params would never reach
    SQL at all. Date/date-time params therefore get their own pass
    (`test_date_typed_filters_reject_sql_payloads_cleanly`), one request
    each, asserting a clean rejection rather than a crash.
  * `test_a_tautology_never_widens_a_filtered_result_set` then hits every
    param ON ITS OWN, because ANDed filters mask the widening signal: a
    successful OR-injection in `search` still returns zero rows if some
    other equality filter in the same request is ANDed against a payload
    that matches nothing.

The assertion is deliberately NOT "no rows come back". It is:
  1. never a 500, and no DB error text (SQL fragments, driver names, table
     names) surfaced to the caller; and
  2. a tautology payload never returns MORE rows than the same request
     carrying a control string that has the identical non-SQL prefix and no
     metacharacters. If the string reached SQL, `x' OR '1'='1` returns
     everything while `x` returns nothing — that difference is the test.

This codebase uses the SQLAlchemy ORM with parameterised `.ilike()`, and an
earlier audit found zero raw string concatenation (see pyproject.toml's own
asyncmy CVE note: "grep -rn 'text(|cursor()|connection.execute' app/ finds
zero hits"). So everything here is EXPECTED to pass. The point is to prove
that holds across every filter rather than trust the grep once, and to leave
a test that fails the day someone adds a raw f-string query.

------------------------------------------------------------------ ITEM 10b
Path traversal against the file endpoints. app/services/file_storage.py
derives every path from the sha256 of the CONTENT
(`root / hash[:2] / hash`), never from the client's filename, so traversal
is expected to be structurally impossible. `test_upload_filename_cannot_
escape_the_storage_root` pins the invariant that makes it impossible —
storage_key is always 64 hex chars — so the guard survives a future change
that starts trusting the filename.

------------------------------------------------------------------- ITEM 6
"a role's export must contain exactly the columns its screen shows."

Every assertion here is on the BYTES OF THE FILE, never the JSON: xlsx is
re-read with openpyxl (the same library excel_engine writes with), and PDF
text is recovered by inflating reportlab's ASCII85+Flate content streams.
Both extractors are proved non-vacuous by a POSITIVE CONTROL in the same
test — the role that IS entitled to the figure exports it and we assert the
figure is found. A test that only ever asserts absence would pass just as
happily against an extractor that reads nothing at all.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import uuid
import zipfile
import zlib
from datetime import date, datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from openpyxl import load_workbook

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.asset import Asset
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.masters import AssetCategory, Department
from app.models.numbering import FinancialYear
from app.models.payroll import PayrollRun, Payslip
from app.models.platform import StoredFile, User
from app.models.rbac import FeatureToggle, RolePermissionField
from app.models.vendor import Vendor
from app.seed import SCREEN_FIELD_PERMISSIONS
from app.services import file_storage
from tests.conftest import seed_canonical

# ============================================================ payload catalogue
# The six classes named in the bypass matrix. Every one keeps the same
# harmless alphanumeric prefix as CONTROL_VALUE below, so a count difference
# between the two can only come from the metacharacters.
CONTROL_VALUE = "zqxjv"
SQL_PAYLOADS: dict[str, str] = {
    # classic quote-breakers — single and double, plus a backslash that
    # would escape the closing quote in a naively-escaped string
    "quote_breaker": "zqxjv'",
    "double_quote_breaker": 'zqxjv"',
    "backslash_escape": "zqxjv\\'",
    "union_select": "zqxjv' UNION SELECT null,null,null,null,null-- ",
    "stacked_statement": "zqxjv'; DROP TABLE users; -- ",
    "comment_terminator": "zqxjv'/*",
    # ---- always-true tautologies. The trailing "-- " is load-bearing and
    # was added after a negative control proved the textbook payload is
    # BLIND here: every free-text search in this codebase builds
    # `f"%{value}%"`, so a bare `x' OR '1'='1` lands as
    #     LIKE '%x' OR '1'='1%'
    # whose right-hand side compares '1' to '1%' and is false — the payload
    # would report "safe" against a genuinely concatenated query. Commenting
    # out the wrapper's own trailing `%'` is what makes it true, and the same
    # payload is still true in a plain `= 'x'` context, so one string covers
    # both shapes of injection point. (Trailing space so MySQL, which needs
    # whitespace after `--`, treats it as a comment too.)
    "tautology": "zqxjv' OR '1'='1' -- ",
    "tautology_numeric": "zqxjv' OR 1=1 -- ",
    # The canonical LIKE-context breaker: closes the wrapper's own opening
    # `%`, ORs, and re-opens so the statement still parses without a comment.
    "tautology_like_break": "%' OR '1'='1' OR '%",
    # A bare LIKE wildcard. NOT an injection — `%{value}%` makes this match
    # every row the caller may ALREADY see. Swept because it must never
    # widen past that, and used in
    # test_a_wildcard_matches_everything_while_a_tautology_matches_nothing
    # to prove the filters really are wired to a query.
    "wildcard_only": "%",
}
TAUTOLOGY = SQL_PAYLOADS["tautology"]
# Both shapes are compared in the widening sweep: one relies on commenting
# the rest of the pattern away, the other on balancing it, and an injection
# point can be vulnerable to either.
WIDENING_TAUTOLOGIES = (SQL_PAYLOADS["tautology"], SQL_PAYLOADS["tautology_like_break"])

# Fragments that mean a database error reached the client. Any of these in a
# response body is a leak in its own right, whatever the status code.
DB_ERROR_MARKERS = (
    "sqlalchemy", "aiosqlite", "asyncmy", "pymysql", "OperationalError",
    "ProgrammingError", "IntegrityError", "syntax error", "no such column",
    "no such table", "unrecognized token", "SELECT ", "FROM ", "WHERE ",
    "Traceback",
)

# ================================================================== fixtures


@pytest.fixture(autouse=True)
def _quiet_http_log():
    """~1,300 requests are fired below; one INFO line each is noise, not
    signal. Restored on teardown so no other module is affected."""
    log = logging.getLogger("httpx")
    previous = log.level
    log.setLevel(logging.WARNING)
    yield
    log.setLevel(previous)


@pytest_asyncio.fixture
async def client(db_session):
    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    # raise_app_exceptions=False, unlike tests/test_file_download_authz.py's
    # otherwise-identical fixture. Starlette's ServerErrorMiddleware sends
    # the 500 response and THEN re-raises so the server can log it; with the
    # transport default that re-raise lands in the test as a traceback,
    # which would abort the sweeps at their first bad endpoint and hide the
    # rest. Off, the transport behaves like the real gunicorn deployment —
    # the caller gets HTTP 500 — which is both what the attacker in the
    # premise sees and what lets the sweeps enumerate EVERY failure.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


async def _seed_base(db_session) -> tuple[dict, dict[str, User]]:
    ids = await seed_canonical(db_session)
    users = {
        code: await db_session.get(User, ids[f"user:{code}"])
        for code in ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")
    }
    return ids, users


async def _seed_field_policy(db_session, ids: dict) -> None:
    """conftest's seed_canonical seeds Layer 1 (mode) and Layer 2 (actions)
    but no RolePermissionField rows at all, so Layer 3 masking is inert
    under it — every field would read 'show' and every export assertion
    below would pass for the wrong reason.

    This installs the REAL production field policy, imported from
    app/seed.py's own SCREEN_FIELD_PERMISSIONS rather than restated here, so
    these tests track the shipped policy instead of a copy of it that can
    drift. app/seed.py itself is not modified or executed.
    """
    for screen_key, per_field in SCREEN_FIELD_PERMISSIONS.items():
        screen_id = ids[f"screen:{screen_key}"]
        for field_key, per_role in per_field.items():
            for role_code, mode in per_role.items():
                db_session.add(
                    RolePermissionField(
                        id=str(uuid.uuid4()), role_id=ids[f"role:{role_code}"],
                        screen_id=screen_id, field_key=field_key, mode=mode,
                    )
                )
    await db_session.commit()


async def _make_user_with_employee(
    db_session, ids: dict, role_code: str, label: str, reporting_manager_id: str | None = None
) -> tuple[User, Employee]:
    """A login plus the Employee row it is linked through — ownership and
    'team' scope in this codebase are always an employee_id, never a user_id
    (app/services/org_scope.py)."""
    user = User(
        id=str(uuid.uuid4()), email=f"{label}@test.local", password_hash="x",
        full_name=label, role_id=ids[f"role:{role_code}"],
    )
    db_session.add(user)
    await db_session.flush()
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{label}", code_financial_year_id="fy-1",
        first_name=label, email=f"{label}.emp@test.local", department_id="dept-1",
        designation_id="desig-1", employment_type_id="emptype-1", joining_date=date(2020, 1, 1),
        user_id=user.id, reporting_manager_id=reporting_manager_id,
    )
    db_session.add(employee)
    await db_session.commit()
    return user, employee


# ===================================================== openapi-driven targets


def _schema_leaves(schema: dict) -> list[dict]:
    """Every concrete (non-null) branch of a query param's schema. `str |
    None` is an anyOf, `list[str]` nests under items, and a `Decimal` is an
    anyOf of {number} and a pattern-constrained {string}."""
    out: list[dict] = []
    if not isinstance(schema, dict):
        return out
    if schema.get("type") and schema["type"] != "null":
        out.append(schema)
    for key in ("anyOf", "oneOf", "allOf"):
        for sub in schema.get(key) or []:
            out.extend(_schema_leaves(sub))
    if isinstance(schema.get("items"), dict):
        out.extend(_schema_leaves(schema["items"]))
    return out


def _collect_query_params() -> tuple[dict[str, list[str]], list[tuple[str, str]]]:
    """Every GET in the live spec, split into:

      - free_text: {path: [param, ...]} — params FastAPI accepts ANY string
        for, so a whole path's worth can be driven in one request without
        the request being rejected before the handler runs.
      - constrained: [(path, param), ...] — params whose value is validated
        into a date / Decimal / enum before the handler. These are driven
        ONE AT A TIME, because a single invalid value 422s the entire query
        string and would take the free-text params on the same path down
        with it, leaving them never actually exercised.

    That split is the whole reason this is schema-driven and not a name
    list. `Decimal | None` renders as `anyOf: [{number}, {string, pattern},
    {null}]` — a *string* branch, which an earlier version of this file
    happily treated as free text. The result was that /api/v1/customers,
    /api/v1/invoices, /api/v1/projects and 20 other paths returned 422 for
    their `outstanding_max`-style param and their real `search` param was
    never reached. A string leaf only counts as free text when it carries
    no `format` and no `pattern` and shares no branch with a numeric type.

    Paths carrying a path parameter are excluded: a fabricated id 404s
    before any filter is applied, so those requests would prove nothing.
    `format` is excluded because it selects the export renderer rather than
    filtering (item 6's own tests cover it); `preview_role` is an RBAC
    control, not a filter.
    """
    spec = app.openapi()
    free_text: dict[str, list[str]] = {}
    constrained: list[tuple[str, str]] = []
    for path, operations in sorted(spec["paths"].items()):
        operation = operations.get("get")
        if operation is None or "{" in path:
            continue
        for parameter in operation.get("parameters", []):
            if parameter.get("in") != "query" or parameter.get("required"):
                continue
            name = parameter["name"]
            if name in ("format", "preview_role"):
                continue
            leaves = _schema_leaves(parameter.get("schema", {}))
            string_leaves = [leaf for leaf in leaves if leaf["type"] == "string"]
            if not string_leaves:
                continue
            other_types = {leaf["type"] for leaf in leaves} - {"string", "array"}
            takes_any_string = (
                not other_types
                and all(not leaf.get("format") and not leaf.get("pattern") and not leaf.get("enum") for leaf in string_leaves)
            )
            if takes_any_string:
                free_text.setdefault(path, []).append(name)
            else:
                constrained.append((path, name))
    return free_text, constrained


def _required_query_defaults() -> dict[str, dict[str, str]]:
    """{path: {param: valid value}} for every REQUIRED query param on a GET.

    Without these, /api/v1/payroll/attendance/* and friends answer 422
    ("Field required") no matter what is sent, so their optional filters
    would be swept through a request that never reaches the handler at all.
    Values are the schema's own minimum where it declares one, so they are
    valid by construction rather than by guesswork.
    """
    spec = app.openapi()
    required: dict[str, dict[str, str]] = {}
    for path, operations in spec["paths"].items():
        operation = operations.get("get")
        if operation is None or "{" in path:
            continue
        for parameter in operation.get("parameters", []):
            if parameter.get("in") != "query" or not parameter.get("required"):
                continue
            leaves = _schema_leaves(parameter.get("schema", {}))
            leaf = leaves[0] if leaves else {"type": "string"}
            if leaf["type"] in ("integer", "number"):
                value = str(leaf.get("minimum", 1))
            elif leaf.get("format") in ("date", "date-time"):
                value = "2026-04-01"
            elif leaf["type"] == "boolean":
                value = "false"
            else:
                value = str((leaf.get("enum") or ["1"])[0])
            required.setdefault(path, {})[parameter["name"]] = value
    return required


FREE_TEXT_PARAMS, CONSTRAINED_PARAMS = _collect_query_params()
FREE_TEXT_PAIRS = [(path, name) for path, names in FREE_TEXT_PARAMS.items() for name in names]
# The constrained half of the split above: date / Decimal / enum params, which
# _collect_query_params already separated out precisely because each has to be
# driven on its own request.
DATE_PARAMS = CONSTRAINED_PARAMS
REQUIRED_QUERY_DEFAULTS = _required_query_defaults()


def _with_required(path: str, params: dict) -> dict:
    return {**REQUIRED_QUERY_DEFAULTS.get(path, {}), **params}


def _row_count(response) -> int | None:
    """Rows in a list response. Endpoints here return either a bare list or
    a report dict whose values include the row sets; anything else (a scalar
    summary) is uncountable and returns None so the caller skips it."""
    try:
        body = response.json()
    except ValueError:
        return None
    if isinstance(body, list):
        return len(body)
    if isinstance(body, dict):
        lists = [v for v in body.values() if isinstance(v, list)]
        return sum(len(v) for v in lists) if lists else None
    return None


def _leaked_db_error(response, *echoed: str) -> str | None:
    """A DB-error marker in the response body.

    FastAPI's own 422 body echoes the offending value back under "input", so
    a payload containing the word SELECT would otherwise report itself as a
    leak. Every value we sent is removed first (raw and JSON-escaped), so
    what remains is only text the SERVER wrote.
    """
    body = response.text
    for value in echoed:
        body = body.replace(value, "").replace(json.dumps(value)[1:-1], "")
    for marker in DB_ERROR_MARKERS:
        if marker in body:
            return marker
    return None


# =============================================== ITEM 10a — SQL in every filter


@pytest_asyncio.fixture
async def injectable_route():
    """Registers a route that concatenates its `search` param straight into
    SQL — the deliberately-wrong configuration the self-test below needs.
    Torn down completely (route removed, cached spec dropped) so no other
    test in the session ever sees it.
    """
    from fastapi import Depends
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession

    path = "/api/v1/_selftest_injectable"

    @app.get(path)
    async def _injectable(search: str | None = None, db: AsyncSession = Depends(get_db)):
        statement = "SELECT id, display_name FROM customers"
        if search:
            statement += f" WHERE display_name LIKE '%{search}%'"  # noqa: S608 — the point of this fixture
        return [{"id": row[0], "display_name": row[1]} for row in (await db.execute(text(statement))).all()]

    previous_spec, app.openapi_schema = app.openapi_schema, None
    try:
        yield path
    finally:
        app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != path]
        app.openapi_schema = previous_spec


async def test_the_sweep_would_catch_a_raw_fstring_query(db_session, client, injectable_route):
    """The self-test, in the same spirit as tests/rbac/test_self_test.py:
    inject a deliberately wrong configuration and prove the comparison
    catches it. Without this, "no filter widened the result set" is
    indistinguishable from "the comparison cannot detect widening", and every
    other assertion in this file inherits that doubt.

    This is also what caught the FIRST version of these payloads. A textbook
    `x' OR '1'='1` reported this endpoint as SAFE, because the router's
    `f"%{search}%"` wrapper turns it into `LIKE '%x' OR '1'='1%'` — false.
    The payload set was corrected until the sweep actually failed here.
    """
    ids, users = await _seed_base(db_session)
    seeded = await _seed_searchable_rows(db_session, ids)
    _as(users["SUPER_ADMIN"])

    # The vulnerable route must be discoverable by the same enumeration the
    # sweeps use, or a real new endpoint would not be swept either.
    free_text, _ = _collect_query_params()
    assert "search" in free_text.get(injectable_route, []), "the sweep's enumeration missed a new GET filter"

    control = await client.get(injectable_route, params={"search": CONTROL_VALUE})
    assert control.status_code == 200 and _row_count(control) == 0

    widened = [
        payload
        for payload in WIDENING_TAUTOLOGIES
        if _row_count(await client.get(injectable_route, params={"search": payload})) == seeded["customers"]
    ]
    assert widened, (
        f"none of {WIDENING_TAUTOLOGIES} widened a query built by raw string concatenation — "
        "test_a_tautology_never_widens_a_filtered_result_set is not able to detect an injection"
    )

    crashed = [
        name
        for name, payload in SQL_PAYLOADS.items()
        if (await client.get(injectable_route, params={"search": payload})).status_code >= 500
    ]
    assert crashed, (
        "no payload crashed a query built by raw string concatenation — "
        "test_no_filter_param_turns_a_sql_payload_into_a_server_error is not able to detect one"
    )


async def test_the_openapi_sweep_actually_finds_filters_to_sweep(db_session, client):
    """A guard on the two sweeps below, not on the application. Both are
    driven off app.openapi(); if that enumeration ever silently returns
    nothing (a refactor, a spec change, a bad `_schema_leaves`), they would
    pass having tested zero endpoints. These floors are set well under the
    current counts so ordinary growth never trips them.
    """
    assert len(FREE_TEXT_PARAMS) >= 60, f"only {len(FREE_TEXT_PARAMS)} GET paths with free-text filters"
    assert len(FREE_TEXT_PAIRS) >= 250, f"only {len(FREE_TEXT_PAIRS)} free-text filter params"
    assert len(CONSTRAINED_PARAMS) >= 100, f"only {len(CONSTRAINED_PARAMS)} type-constrained filter params"
    assert "search" in {name for _, name in FREE_TEXT_PAIRS}
    # The Decimal-branch regression this split exists for: `search` on these
    # paths must be free text, and their money range filters must not be, or
    # the combined sweep 422s and never reaches the search at all.
    assert "search" in FREE_TEXT_PARAMS["/api/v1/customers"]
    assert ("/api/v1/customers", "outstanding_max") in CONSTRAINED_PARAMS
    assert ("/api/v1/customers", "created_from") in CONSTRAINED_PARAMS


@pytest.mark.parametrize("payload_name", sorted(SQL_PAYLOADS))
async def test_no_filter_param_turns_a_sql_payload_into_a_server_error(
    db_session, client, payload_name
):
    """Every free-text filter on every GET receives every payload class.

    Swept as SUPER_ADMIN deliberately: Layer 1 answers an unauthorised role
    with 404 BEFORE the query is built, so a low-privilege sweep would leave
    most filters never actually reaching SQL. An injection that Super Admin
    cannot trigger cannot be triggered by anyone; the scope-preserving half
    of this matrix is asserted from a low-privilege token in
    `test_a_low_privilege_token_cannot_widen_its_own_scope_by_injection`.

    A path's params go out together for speed, but a combined request that
    does NOT come back 2xx is treated as "this proved nothing" and every
    param is re-driven alone — otherwise one endpoint-level 4xx (a missing
    prerequisite, an unresolvable id in a sibling filter) would silently
    take that path's real `search` param out of the sweep.
    """
    payload = SQL_PAYLOADS[payload_name]
    ids, users = await _seed_base(db_session)
    await _seed_searchable_rows(db_session, ids)
    _as(users["SUPER_ADMIN"])

    failures: list[str] = []
    for path, names in sorted(FREE_TEXT_PARAMS.items()):
        combined = await client.get(path, params=_with_required(path, {name: payload for name in names}))
        marker = _leaked_db_error(combined, payload)
        if combined.status_code < 300 and not marker:
            continue
        for name in names:
            single = await client.get(path, params=_with_required(path, {name: payload}))
            marker = _leaked_db_error(single, payload)
            if single.status_code >= 500 or marker:
                failures.append(
                    f"{path}?{name}= -> HTTP {single.status_code}"
                    + (f" leaking {marker!r}" if marker else "")
                    + f" :: {single.text[:200]}"
                )

    assert not failures, (
        f"{len(failures)} filter param(s) mishandled the {payload_name!r} payload "
        f"({payload!r}):\n  " + "\n  ".join(failures)
    )


async def test_date_typed_filters_reject_sql_payloads_cleanly(db_session, client):
    """The date/date-time params excluded from the combined sweep above.

    These never reach SQL — FastAPI's own parsing rejects a non-date string
    first — but "rejected" has to mean a 422, not an unhandled 500, and the
    rejection body must not echo a driver error. Driven one at a time
    because a single bad value 422s an entire query string.
    """
    _, users = await _seed_base(db_session)
    _as(users["SUPER_ADMIN"])

    failures: list[str] = []
    for path, name in DATE_PARAMS:
        response = await client.get(path, params={name: TAUTOLOGY})
        marker = _leaked_db_error(response, TAUTOLOGY)
        if response.status_code >= 500 or marker:
            failures.append(
                f"{path}?{name}= -> HTTP {response.status_code}"
                + (f" leaking {marker!r}" if marker else "")
            )
    assert not failures, "date filters mishandled a SQL payload:\n  " + "\n  ".join(failures)


async def test_a_tautology_never_widens_a_filtered_result_set(db_session, client):
    """THE injection test. Every free-text filter, one at a time.

    `control` and each tautology share the identical alphanumeric prefix and
    differ only by the SQL metacharacters. Parameterised, all of them are
    matched as literal text and return the same (zero) rows. Concatenated
    into SQL, a tautology returns the whole table while the control still
    returns nothing — so `tautology_rows > control_rows` is the signature of
    a string that reached the query, and is what fails here.

    Two tautology shapes, because one alone is demonstrably blind: see
    SQL_PAYLOADS' own note on the `%{value}%` wrapper.

    Seeded rows exist for several of the swept entities so the comparison is
    made against non-empty tables rather than trivially 0 == 0;
    `test_a_wildcard_matches_everything_while_a_tautology_matches_nothing`
    below then proves those particular filters are genuinely wired to a
    query at all.
    """
    ids, users = await _seed_base(db_session)
    await _seed_searchable_rows(db_session, ids)
    _as(users["SUPER_ADMIN"])

    widened: list[str] = []
    errored: list[str] = []
    compared = 0
    for path, name in FREE_TEXT_PAIRS:
        control = await client.get(path, params=_with_required(path, {name: CONTROL_VALUE}))
        marker = _leaked_db_error(control, CONTROL_VALUE)
        if control.status_code >= 500 or marker:
            errored.append(f"{path}?{name}= (control) -> HTTP {control.status_code} {marker or ''}".strip())
        control_rows = _row_count(control) if control.status_code == 200 else None

        for payload in WIDENING_TAUTOLOGIES:
            response = await client.get(path, params=_with_required(path, {name: payload}))
            marker = _leaked_db_error(response, payload)
            if response.status_code >= 500 or marker:
                errored.append(
                    f"{path}?{name}={payload!r} -> HTTP {response.status_code}"
                    + (f" leaking {marker!r}" if marker else "")
                )
            if control_rows is None or response.status_code != 200:
                continue
            rows = _row_count(response)
            if rows is None:
                continue
            compared += 1
            if rows > control_rows:
                widened.append(
                    f"{path}?{name}={payload!r} returned {rows} rows vs {control_rows} for the control"
                )

    assert not errored, "SQL payload produced a server error:\n  " + "\n  ".join(errored)
    assert not widened, (
        "a tautology payload WIDENED the result set — the string reached SQL:\n  "
        + "\n  ".join(widened)
    )
    assert compared >= 400, f"only {compared} comparisons ran; the sweep is not covering enough"


async def test_a_wildcard_matches_everything_while_a_tautology_matches_nothing(db_session, client):
    """Proves the previous test is not vacuous.

    A filter that is silently ignored would also "not widen", so absence of
    widening on its own is weak evidence. Here, against seeded rows:
      - `search=%` builds `%%%` in the ilike and must return EVERY row the
        caller can see — so the param demonstrably reaches a real query;
      - the same param carrying `' OR '1'='1` must return ZERO — so that
        query treats it as a literal, not as SQL.
    Both halves have to hold for the parameterisation claim to mean anything.
    """
    ids, users = await _seed_base(db_session)
    seeded = await _seed_searchable_rows(db_session, ids)
    _as(users["SUPER_ADMIN"])

    for path, param, expected in (
        ("/api/v1/customers", "search", seeded["customers"]),
        ("/api/v1/vendors", "search", seeded["vendors"]),
        ("/api/v1/employees", "search", seeded["employees"]),
        ("/api/v1/assets", "search", seeded["assets"]),
        ("/api/v1/masters/departments", "search", seeded["departments"]),
    ):
        unfiltered = await client.get(path)
        assert unfiltered.status_code == 200, f"{path}: {unfiltered.text[:200]}"
        assert _row_count(unfiltered) == expected, f"{path} seeding is not what this test assumes"

        wildcard = await client.get(path, params={param: "%"})
        assert wildcard.status_code == 200, wildcard.text[:200]
        assert _row_count(wildcard) == expected, (
            f"{path}?{param}=% returned {_row_count(wildcard)} of {expected} rows — the filter is "
            "not reaching a LIKE query, so the tautology sweep proves nothing about it"
        )

        tautology = await client.get(path, params={param: TAUTOLOGY})
        assert tautology.status_code == 200, tautology.text[:200]
        assert _row_count(tautology) == 0, (
            f"{path}?{param}= with {TAUTOLOGY!r} returned {_row_count(tautology)} rows — "
            "a tautology that matches anything means the string was concatenated into SQL"
        )


async def test_a_low_privilege_token_cannot_widen_its_own_scope_by_injection(db_session, client):
    """The premise's own actor: a plain Employee with a valid token, curl,
    and no UI. Their screens are scope-narrowed ('own'), which is applied as
    an extra WHERE on the same statement the search term goes into — so a
    string that escaped parameterisation could plausibly OR its way past the
    scope clause, not merely past the search clause.

    Asserted on rows they must never see: a second employee's asset and the
    other employees' directory rows.
    """
    ids, users = await _seed_base(db_session)
    await _seed_searchable_rows(db_session, ids)
    employee_user, employee_row = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "lowpriv")
    stranger_user, stranger_row = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "stranger")

    category = AssetCategory(id=str(uuid.uuid4()), name="Laptops")
    db_session.add(category)
    db_session.add(
        Asset(
            id=str(uuid.uuid4()), asset_tag="AST-STRANGER", financial_year_id="fy-1",
            name="Stranger Laptop", category_id=category.id, purchase_date=date(2024, 1, 1),
            assigned_to=stranger_row.id, purchase_value=Decimal("111111.11"), useful_life_years=5,
        )
    )
    await db_session.commit()

    _as(employee_user)
    for path, param in (
        ("/api/v1/employees/me/assets", "search"),
        ("/api/v1/employees/me/tickets", "priority"),
        ("/api/v1/employees/me/projects", "search"),
        ("/api/v1/expenses/me", "search"),
        ("/api/v1/leave/requests", "search"),
    ):
        for payload in SQL_PAYLOADS.values():
            response = await client.get(path, params={param: payload})
            assert response.status_code < 500, f"{path}?{param}={payload!r} -> {response.status_code}"
            if response.status_code != 200:
                continue
            assert _leaked_db_error(response, payload) is None, f"{path} leaked a DB error for {payload!r}"
            body = response.text
            assert "AST-STRANGER" not in body, (
                f"{path}?{param}={payload!r} surfaced another employee's asset — injection escaped 'own' scope"
            )
            assert stranger_row.employee_code not in body, (
                f"{path}?{param}={payload!r} surfaced another employee's record"
            )

    # employee.directory is 'none' for EMPLOYEE — no payload turns a Layer-1
    # 404 into a result set.
    for payload in SQL_PAYLOADS.values():
        denied = await client.get("/api/v1/employees", params={"search": payload})
        assert denied.status_code == 404, f"Employee reached the directory with {payload!r}: {denied.status_code}"


async def _seed_searchable_rows(db_session, ids: dict) -> dict[str, int]:
    """Real rows for the entities the sweeps compare counts on, so the
    comparison runs against non-empty tables. Names are deliberately plain —
    none of them contains any character from the payloads, so a control
    string can never match one by accident.

    The current FinancialYear is a PREREQUISITE, not decoration: without one,
    /api/v1/leave/reports/* and /api/v1/compliance/obligations* answer 409
    ("No Financial Year is marked current") and their filters would never be
    swept at all.
    """
    db_session.add(
        FinancialYear(
            id="fy-1", label="2026", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31),
            status="open", is_current=True,
        )
    )
    db_session.add_all(
        [
            Customer(
                id=str(uuid.uuid4()), customer_code=f"CUS-{n}", financial_year_id="fy-1",
                company_name=f"Customer {n}", display_name=f"Customer {n}", status_id="custstatus-1",
            )
            for n in ("Alpha", "Beta")
        ]
    )
    db_session.add_all(
        [Vendor(id=str(uuid.uuid4()), vendor_name=f"Vendor {n}") for n in ("Alpha", "Beta", "Gamma")]
    )
    departments = [Department(id=str(uuid.uuid4()), name=f"Dept {n}", code=f"D{n[:2].upper()}") for n in ("Alpha", "Beta")]
    db_session.add_all(departments)
    category = AssetCategory(id=str(uuid.uuid4()), name="Monitors")
    db_session.add(category)
    db_session.add_all(
        [
            Asset(
                id=str(uuid.uuid4()), asset_tag=f"AST-{n}", financial_year_id="fy-1", name=f"Asset {n}",
                category_id=category.id, purchase_date=date(2024, 1, 1),
            )
            for n in ("Alpha", "Beta")
        ]
    )
    employees = []
    for label in ("Alpha", "Beta"):
        employees.append(
            Employee(
                id=str(uuid.uuid4()), employee_code=f"EMP-{label}", code_financial_year_id="fy-1",
                first_name=label, email=f"{label}@seed.local", department_id="dept-1",
                designation_id="desig-1", employment_type_id="emptype-1", joining_date=date(2020, 1, 1),
            )
        )
    db_session.add_all(employees)
    await db_session.commit()
    return {"customers": 2, "vendors": 3, "departments": 2, "assets": 2, "employees": 2}


# ================================================ ITEM 10b — path traversal


TRAVERSAL_IDS = [
    "../../../../etc/passwd",
    "..%2F..%2F..%2Fetc%2Fpasswd",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "....//....//etc/passwd",
    "..\\..\\..\\windows\\win.ini",
    "%252e%252e%252fetc%252fpasswd",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "..%00/etc/passwd",
]


@pytest_asyncio.fixture
def storage_root(tmp_path, monkeypatch):
    """A throwaway storage root, plus a planted secret OUTSIDE it. Nothing
    is written into the repo's own ./storage, and any traversal that
    actually escaped would return the sentinel, which every assertion below
    looks for.
    """
    root = tmp_path / "storage"
    root.mkdir()
    (tmp_path / "outside_secret.txt").write_bytes(b"TRAVERSAL-SENTINEL-b2f1")
    monkeypatch.setattr(file_storage, "_storage_root", lambda: root)
    return root


async def test_file_download_ids_cannot_be_used_for_path_traversal(db_session, client, storage_root):
    """`GET /api/v1/files/{file_id}` — the id is a primary-key lookup, and
    the bytes are found by content hash, so a traversal string has nothing
    to traverse. Proved rather than assumed: the download really does read
    from disk (positive control first), and no payload reaches the file
    planted outside the storage root.
    """
    _, users = await _seed_base(db_session)
    _as(users["SUPER_ADMIN"])

    content = b"%PDF-1.4 genuine document"
    content_hash = file_storage.content_hash_of(content)
    row = file_storage.save_upload(content, content_hash, "report.pdf", "application/pdf", users["SUPER_ADMIN"].id)
    db_session.add(row)
    await db_session.commit()

    served = await client.get(f"/api/v1/files/{row.id}")
    assert served.status_code == 200 and served.content == content, (
        "positive control failed — this endpoint is not actually reading bytes off disk, "
        "so the traversal assertions below would prove nothing"
    )

    for payload in TRAVERSAL_IDS:
        response = await client.get(f"/api/v1/files/{payload}")
        assert response.status_code < 500, f"{payload!r} -> HTTP {response.status_code}: {response.text[:200]}"
        assert b"TRAVERSAL-SENTINEL" not in response.content, f"{payload!r} escaped the storage root"
        assert b"root:x:" not in response.content and b"[fonts]" not in response.content, (
            f"{payload!r} served a host file"
        )
        assert _leaked_db_error(response) is None, f"{payload!r} leaked a DB error"


async def test_upload_filename_cannot_escape_the_storage_root(db_session, client, storage_root):
    """`POST /api/v1/files` — the only attacker-controlled string that
    reaches storage is the multipart filename.

    file_storage.save_upload derives the path from the sha256 of the CONTENT
    and stores the filename only as a label, so traversal is structurally
    impossible. The `storage_key` assertion is the guard on that: the day
    someone builds a path from the filename instead, storage_key stops being
    64 hex characters and this fails.
    """
    _, users = await _seed_base(db_session)
    _as(users["SUPER_ADMIN"])

    before = {p for p in storage_root.parent.rglob("*") if p.is_file()}
    for index, name in enumerate(
        (
            "../../../../etc/passwd",
            "..\\..\\..\\windows\\win.ini",
            "/etc/cron.d/evil",
            "report\x00.pdf",
            'evil.pdf"\r\nX-Injected: yes',
            "%2e%2e%2fescape.pdf",
        )
    ):
        content = b"%PDF-1.4 upload " + str(index).encode()
        response = await client.post(
            "/api/v1/files",
            files={"file": (name, content, "application/pdf")},
            data={"purpose": "employee_document"},
        )
        # A rejection is a fine outcome; a crash or an escape is not.
        assert response.status_code < 500, f"{name!r} -> HTTP {response.status_code}: {response.text[:200]}"
        if response.status_code != 201:
            continue

        file_id = response.json()["id"]
        stored = await db_session.get(StoredFile, file_id)
        assert re.fullmatch(r"[0-9a-f]{64}", stored.storage_key), (
            f"storage_key is no longer a content hash ({stored.storage_key!r}) — the upload path is "
            "now derived from client input and traversal is back on the table"
        )
        assert (storage_root / stored.storage_key[:2] / stored.storage_key).is_file()

        download = await client.get(f"/api/v1/files/{file_id}")
        assert download.status_code == 200
        assert download.content == content, "a traversal filename changed which bytes are served"
        disposition = download.headers.get("content-disposition", "")
        assert "\r" not in disposition and "\n" not in disposition and "\x00" not in disposition, (
            f"filename {name!r} smuggled control characters into a response header: {disposition!r}"
        )
        assert "x-injected" not in {k.lower() for k in download.headers}

    written = {p for p in storage_root.parent.rglob("*") if p.is_file()} - before
    escaped = [str(p) for p in written if storage_root not in p.parents]
    assert not escaped, f"upload wrote outside the storage root: {escaped}"


# ============================================ ITEM 6 — export bypass, on bytes


_PDF_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\n?endstream", re.DOTALL)


def _pdf_text(payload: bytes) -> str:
    """Readable text out of a reportlab PDF.

    pdf_engine renders with rl_config.pageCompression on and reportlab's
    default ASCII85+Flate stream filters, so a plain `b"12345" in payload`
    check against a PDF export is ALWAYS false and would silently pass. Each
    stream is un-ASCII85'd and inflated; page content then carries its text
    as literal ASCII inside `(...) Tj` operators, because reportlab's TTF
    subsets map the first 128 codes through unchanged (visible in the
    embedded CMap's identity `<41> <0041>` bfchar rows).

    Callers must still assert a positive control through this function — see
    each test below — so a future reportlab that changes encoding fails
    loudly instead of making every absence assertion vacuous.
    """
    chunks = [payload.decode("latin-1")]
    for match in _PDF_STREAM.finditer(payload):
        blob = match.group(1)
        for decode in (
            lambda b: zlib.decompress(base64.a85decode(b, adobe=True)),
            lambda b: base64.a85decode(b, adobe=True),
            lambda b: zlib.decompress(b),
        ):
            try:
                chunks.append(decode(blob).decode("latin-1"))
                break
            except Exception:
                continue
    return "\n".join(chunks)


def _xlsx_cells(payload: bytes) -> list[str]:
    """Every cell of the exported workbook as text, header block included.
    Used for the COLUMN assertions ("is 'Total Purchase Value' a header
    here?"), which need the cell boundaries."""
    workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    values = [
        str(cell)
        for sheet in workbook.worksheets
        for row in sheet.iter_rows(values_only=True)
        for cell in row
        if cell is not None
    ]
    workbook.close()
    return values


def _xlsx_text(payload: bytes) -> str:
    """Every decompressed part of the .xlsx ZIP, concatenated.

    Used for the LEAK assertions. An xlsx is a ZIP, so `b"987654" in payload`
    against the raw response is meaningless — deflated bytes never match, and
    the check would pass no matter what the file contains. This reads the
    archive out instead, which also covers sharedStrings.xml, every sheet,
    comments and defined names, not just the cells openpyxl surfaces.
    """
    parts = []
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        for name in archive.namelist():
            parts.append(archive.read(name).decode("utf-8", "replace"))
    return "\n".join(parts)


def _assert_is_xlsx(response) -> bytes:
    assert response.status_code == 200, f"expected an export, got {response.status_code}: {response.text[:300]}"
    assert response.content[:2] == b"PK", "not a real xlsx payload"
    return response.content


def _assert_is_pdf(response) -> bytes:
    assert response.status_code == 200, f"expected an export, got {response.status_code}: {response.text[:300]}"
    assert response.content[:4] == b"%PDF", "not a real pdf payload"
    return response.content


def _amount_spellings(amount: Decimal) -> tuple[str, ...]:
    """Every way one money figure can be written into an export.

    excel_engine writes Decimals through `float(v)`, so a cell reads
    987654.21; pdf_engine sends them through `_money()`, which is
    f"{RUPEE}{v:,.2f}" — 987,654.21. An absence assertion that only looked
    for one spelling would miss the leak in the other format entirely.
    """
    return (f"{amount:.2f}", f"{amount:,.2f}", f"{amount:f}".rstrip("0").rstrip("."))


def _assert_absent(haystack: str, amount: Decimal, where: str) -> None:
    for spelling in _amount_spellings(amount):
        assert spelling not in haystack, f"{spelling} LEAKED into {where}"


def _assert_present(haystack: str, amount: Decimal, where: str) -> None:
    assert any(spelling in haystack for spelling in _amount_spellings(amount)), (
        f"positive control failed — {amount} is not readable in {where}, so the matching absence "
        "assertion would pass for the wrong reason"
    )


PURCHASE_VALUE = Decimal("987654.21")
VENDOR_GSTIN = "29ZQXJV4471K1Z9"
VENDOR_PAN = "ZQXJV4471K"
VENDOR_ACCOUNT = "44710000928361"
VENDOR_IFSC = "ZQXJ0004471"
MANAGER_NET = Decimal("311111.11")
STRANGER_NET = Decimal("822222.22")
STRANGER_GROSS = Decimal("933333.33")


async def _seed_asset_for_manager_team(db_session, ids: dict) -> tuple[User, User]:
    """A Manager, a direct report, and one asset assigned to that report —
    asset.reports is view_team for Manager, so the asset has to sit inside
    their team for the export to contain any row at all."""
    manager_user, manager_employee = await _make_user_with_employee(db_session, ids, "MANAGER", "assetmgr")
    _, report_employee = await _make_user_with_employee(
        db_session, ids, "EMPLOYEE", "assetreport", reporting_manager_id=manager_employee.id
    )
    accountant_user = await db_session.get(User, ids["user:ACCOUNTANT"])
    category = AssetCategory(id=str(uuid.uuid4()), name="Workstations")
    db_session.add(category)
    db_session.add(
        Asset(
            id=str(uuid.uuid4()), asset_tag="AST-0001", financial_year_id="fy-1", name="Dev Workstation",
            category_id=category.id, purchase_date=date(2025, 1, 1), assigned_to=report_employee.id,
            purchase_value=PURCHASE_VALUE, useful_life_years=5, status="ASSIGNED",
        )
    )
    await db_session.commit()
    return manager_user, accountant_user


async def test_manager_asset_export_carries_no_purchase_value_in_the_file(db_session, client):
    """Item 6 for asset.reports — "Show Purchase Value to Manager" is OFF by
    default (app/seed.py: purchase_value/current_value -> MANAGER 'hide'),
    so Manager's export must have neither the column nor the figure.

    Accountant runs the identical request first as the positive control: the
    figure IS in their file, which is what proves the xlsx/PDF readers below
    can actually see values at all.
    """
    ids, _ = await _seed_base(db_session)
    await _seed_field_policy(db_session, ids)
    manager_user, accountant_user = await _seed_asset_for_manager_team(db_session, ids)
    path = "/api/v1/assets/reports/summary"

    _as(accountant_user)
    control_xlsx = _assert_is_xlsx(await client.get(path, params={"format": "excel"}))
    assert "Total Purchase Value" in _xlsx_cells(control_xlsx), "positive control: Accountant lost the value column"
    _assert_present(_xlsx_text(control_xlsx), PURCHASE_VALUE, "the Accountant's workbook")
    control_pdf = _pdf_text(_assert_is_pdf(await client.get(path, params={"format": "pdf"})))
    assert "Total Purchase Value" in control_pdf, "positive control: value column missing from the Accountant's PDF"
    _assert_present(control_pdf, PURCHASE_VALUE, "the Accountant's PDF")

    _as(manager_user)
    manager_xlsx = _assert_is_xlsx(await client.get(path, params={"format": "excel"}))
    manager_cells = _xlsx_cells(manager_xlsx)
    assert any("Workstations" in cell for cell in manager_cells), (
        "Manager's export has no rows at all — the absence assertions would be trivially true"
    )
    assert "Total Purchase Value" not in manager_cells and "Total Current Value" not in manager_cells, (
        f"Manager's asset export still carries a value column: {manager_cells}"
    )
    _assert_absent(_xlsx_text(manager_xlsx), PURCHASE_VALUE, "the Manager's asset xlsx")

    manager_pdf = _pdf_text(_assert_is_pdf(await client.get(path, params={"format": "pdf"})))
    assert "Workstations" in manager_pdf, "Manager's PDF has no rows — absence assertions would be trivial"
    assert "Total Purchase Value" not in manager_pdf and "Total Current Value" not in manager_pdf, (
        "Manager's asset PDF still carries a value column"
    )
    _assert_absent(manager_pdf, PURCHASE_VALUE, "the Manager's asset PDF")


async def test_manager_vendor_export_carries_no_bank_or_gst_values_in_the_file(db_session, client):
    """Item 6 for vendor.directory — §2.1's "All three banking columns are
    withheld from Manager, on the same rule as GSTIN" (app/seed.py hides
    gstin/pan/bank_*/ifsc_code for MANAGER).

    The GSTIN COLUMN is part of _LIST_COLUMNS for every caller, so the header
    is present in both files; what must never appear is the VALUE. That is
    what is asserted, on the bytes — plus that the masking placeholder dict
    itself never renders into a cell.
    """
    ids, users = await _seed_base(db_session)
    await _seed_field_policy(db_session, ids)
    vendor = Vendor(
        id=str(uuid.uuid4()), vendor_name="Meridian Supplies", gstin=VENDOR_GSTIN, pan=VENDOR_PAN,
        bank_account_name="Meridian Supplies Pvt Ltd", bank_name="State Bank",
        bank_account_number=VENDOR_ACCOUNT, ifsc_code=VENDOR_IFSC, is_active=True,
        outstanding_amount=Decimal("1500.00"),
    )
    db_session.add(vendor)
    await db_session.commit()
    # bank_account_number_masked / has_bank_details are generated columns —
    # read back rather than written, so the "Bank ••••8361" summary asserted
    # on below is the real one the DB derived, not a value invented here.
    await db_session.refresh(vendor)
    secrets = (VENDOR_GSTIN, VENDOR_PAN, VENDOR_ACCOUNT, VENDOR_IFSC, vendor.bank_account_number_masked, "8361")

    _as(users["ACCOUNTANT"])
    control_cells = _xlsx_cells(_assert_is_xlsx(await client.get("/api/v1/vendors", params={"format": "excel"})))
    assert VENDOR_GSTIN in control_cells, (
        "positive control failed — the Accountant's vendor export does not carry the GSTIN, so the "
        "Manager assertions below would pass for the wrong reason"
    )
    control_pdf = _pdf_text(_assert_is_pdf(await client.get("/api/v1/vendors", params={"format": "pdf"})))
    assert VENDOR_GSTIN in control_pdf, "positive control failed — GSTIN unreadable in the Accountant's PDF"

    _as(users["MANAGER"])
    manager_xlsx = _assert_is_xlsx(await client.get("/api/v1/vendors", params={"format": "excel"}))
    manager_cells = _xlsx_cells(manager_xlsx)
    manager_xml = _xlsx_text(manager_xlsx)
    assert "Meridian Supplies" in manager_cells, (
        "Manager's vendor export has no rows — absence assertions would be trivially true"
    )
    for secret in secrets:
        assert secret not in manager_cells, f"{secret!r} LEAKED into the Manager's vendor xlsx"
        assert secret not in manager_xml, f"{secret!r} survives somewhere inside the xlsx archive"
    assert "__masked__" not in manager_xml, "the masking placeholder itself was written into the workbook"

    manager_pdf = _pdf_text(_assert_is_pdf(await client.get("/api/v1/vendors", params={"format": "pdf"})))
    assert "Meridian Supplies" in manager_pdf, "Manager's vendor PDF has no rows"
    for secret in secrets:
        assert secret not in manager_pdf, f"{secret!r} LEAKED into the Manager's vendor PDF"
    assert "__masked__" not in manager_pdf


async def _seed_payslips(db_session, ids: dict) -> tuple[User, User, Employee]:
    """A Manager with their own payslip, plus a stranger's payslip carrying
    distinct sentinel amounts."""
    manager_user, manager_employee = await _make_user_with_employee(db_session, ids, "MANAGER", "paymgr")
    _, stranger_employee = await _make_user_with_employee(db_session, ids, "EMPLOYEE", "paystranger")
    accountant_user = await db_session.get(User, ids["user:ACCOUNTANT"])

    run = PayrollRun(
        id=str(uuid.uuid4()), financial_year_id="fy-1", period_month=4, period_year=2026,
        pay_period_start=date(2026, 4, 1), pay_period_end=date(2026, 4, 30),
        salary_credit_date=date(2026, 5, 1), pay_cycle_type_snapshot="CALENDAR_MONTH",
        salary_credit_day_snapshot=1, total_days_in_period=Decimal("30.00"),
        working_days_auto=Decimal("22.00"), employee_selection_mode="ALL",
        run_by=accountant_user.id, run_on=datetime(2026, 5, 1), status="CONFIRMED",
        total_gross=STRANGER_GROSS, total_net=STRANGER_NET, employee_count=2,
    )
    db_session.add(run)
    for employee, net in ((manager_employee, MANAGER_NET), (stranger_employee, STRANGER_NET)):
        db_session.add(
            Payslip(
                id=str(uuid.uuid4()), payroll_run_id=run.id, payroll_run_employee_id=str(uuid.uuid4()),
                employee_id=employee.id, financial_year_id="fy-1",
                pay_period_start=date(2026, 4, 1), pay_period_end=date(2026, 4, 30),
                salary_credit_date=date(2026, 5, 1), pay_cycle_type_snapshot="CALENDAR_MONTH",
                salary_credit_day_snapshot=1, period_month=4, period_year=2026,
                employee_code_snapshot=employee.employee_code, employee_name_snapshot=employee.first_name,
                generated_at=datetime(2026, 5, 1), generated_by=accountant_user.id,
                gross_pay=STRANGER_GROSS if net == STRANGER_NET else MANAGER_NET, net_pay=net,
                status="GENERATED",
            )
        )
    await db_session.commit()
    return manager_user, accountant_user, stranger_employee


async def test_manager_payroll_export_produces_no_file_at_all_while_the_flag_is_off(db_session, client):
    """Item 6's headline case, in this codebase's terms.

    The prototype's "Show Salary Amount to Manager" toggle governed a Team
    Payslips screen that RBAC §2.1 removed outright (see toggles.py's own
    note), so there is no longer a Manager payroll export with an amount
    column to strip: with the flag off, payroll.run and payroll.payslips_admin
    are both mode 'none' and Layer 1 answers 404 before any file is rendered.

    Asserted as "no bytes", not merely "no amount column" — a 404 whose body
    is still an xlsx would be the same leak wearing a different status code.
    Then the flag is turned ON and the same request must succeed WITH the
    totals, which is what proves the 404 came from the flag rather than from
    a broken request.
    """
    ids, _ = await _seed_base(db_session)
    await _seed_field_policy(db_session, ids)
    manager_user, accountant_user, _ = await _seed_payslips(db_session, ids)

    _as(accountant_user)
    control_xlsx = _assert_is_xlsx(await client.get("/api/v1/payroll/payslips", params={"format": "excel"}))
    assert "Net" in _xlsx_cells(control_xlsx), "positive control: the Accountant's payslip export lost its Net column"
    control_text = _xlsx_text(control_xlsx)
    _assert_present(control_text, STRANGER_NET, "the Accountant's payslip workbook")
    _assert_present(control_text, MANAGER_NET, "the Accountant's payslip workbook")

    _as(manager_user)
    for path in ("/api/v1/payroll/payslips", "/api/v1/payroll/runs"):
        for export_format in ("excel", "pdf"):
            denied = await client.get(path, params={"format": export_format})
            assert denied.status_code == 404, f"{path}?format={export_format} -> {denied.status_code}"
            assert denied.content[:2] != b"PK" and denied.content[:4] != b"%PDF", (
                f"{path} returned a real file body alongside its {denied.status_code}"
            )
            body = denied.content.decode("latin-1")
            _assert_absent(body, STRANGER_NET, f"the 404 body of {path}")
            _assert_absent(body, STRANGER_GROSS, f"the 404 body of {path}")

    # ... and the same request WITH the toggle on, so the 404s above are
    # attributable to the flag and not to anything else about the request.
    db_session.add(
        FeatureToggle(
            id=str(uuid.uuid4()), toggle_key="Allow Manager to Run Payroll", module_key="payroll",
            label="Allow Manager to Run Payroll", enabled=True, default_enabled=False,
        )
    )
    await db_session.commit()

    granted_xlsx = _assert_is_xlsx(await client.get("/api/v1/payroll/runs", params={"format": "excel"}))
    granted_cells = _xlsx_cells(granted_xlsx)
    assert "Total Net" in granted_cells, f"toggle ON did not restore the payroll export columns: {granted_cells}"
    _assert_present(_xlsx_text(granted_xlsx), STRANGER_NET, "the Manager's payroll export with the flag ON")


async def test_manager_own_payslip_export_contains_only_their_own_amount(db_session, client):
    """payroll.my_payslips is seeded 'full' for EVERY role and the route
    ignores that mode, hard-filtering to the caller's own employee id. The
    export path re-shapes rows AFTER that filter, so this is where a
    scope-losing export would show up — one file containing somebody else's
    net pay.

    Both formats, on the bytes: the caller's own figure must be present
    (which is also the positive control for both extractors) and the other
    employee's must not appear anywhere in the payload.
    """
    ids, _ = await _seed_base(db_session)
    await _seed_field_policy(db_session, ids)
    manager_user, _, stranger_employee = await _seed_payslips(db_session, ids)
    _as(manager_user)

    xlsx = _assert_is_xlsx(await client.get("/api/v1/payroll/payslips/me", params={"format": "excel"}))
    xlsx_text = _xlsx_text(xlsx)
    assert "Net Pay" in _xlsx_cells(xlsx), "the caller's own Net Pay column vanished — nothing left to leak"
    _assert_present(xlsx_text, MANAGER_NET, "the caller's own payslip xlsx")
    _assert_absent(xlsx_text, STRANGER_NET, "the caller's own payslip xlsx (ANOTHER EMPLOYEE'S NET PAY)")
    assert stranger_employee.employee_code not in xlsx_text

    pdf = _pdf_text(_assert_is_pdf(await client.get("/api/v1/payroll/payslips/me", params={"format": "pdf"})))
    _assert_present(pdf, MANAGER_NET, "the caller's own payslip PDF")
    _assert_absent(pdf, STRANGER_NET, "the caller's own payslip PDF (ANOTHER EMPLOYEE'S NET PAY)")
    assert stranger_employee.employee_code not in pdf


async def test_an_unknown_export_format_is_a_422_not_a_500(db_session, client):
    """`format` is a bare `str | None` on ~40 list endpoints, so FastAPI
    never constrains it — list_export.build_export is the only thing that
    does. A curl caller inventing a format must get a clean client error and
    no file, not an unhandled 500.
    """
    ids, users = await _seed_base(db_session)
    await _seed_field_policy(db_session, ids)
    _as(users["SUPER_ADMIN"])

    for path in ("/api/v1/vendors", "/api/v1/customers", "/api/v1/payroll/payslips", "/api/v1/assets"):
        for bad in ("csv", "html", "../../etc/passwd", "", "PDF ", "excel;pdf", "EXCEL"):
            response = await client.get(path, params={"format": bad})
            assert response.status_code < 500, f"{path}?format={bad!r} -> {response.status_code}"
            rendered_a_file = response.content[:2] == b"PK" or response.content[:4] == b"%PDF"
            # build_export lower-cases and strips before matching, and an
            # empty value is simply "no export asked for" (the routers all
            # test `if format:`), so those three spellings may legitimately
            # produce a file or plain JSON. Nothing else may produce a file.
            if bad.strip().lower() not in ("pdf", "excel", ""):
                assert not rendered_a_file, f"{path} rendered a file for format={bad!r}"
                assert response.status_code == 422, f"{path}?format={bad!r} -> {response.status_code}"
