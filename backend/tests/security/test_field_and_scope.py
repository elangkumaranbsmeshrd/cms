"""Layer 3 bypass matrix, items 2 (field-level leak) and 3 (scope escape) —
build-docs/COMPLETE-TEST-PROMPT.md §"The bypass matrix".

THE PREMISE: "assume the attacker never opens your UI. They have a valid
low-privilege token and call the API directly with curl. Hiding a button
proves nothing." Every assertion in this file is therefore on the parsed JSON
RESPONSE BODY — `field not in body`, never "the column isn't rendered". A
field hidden only in CSS is defeated by devtools in ten seconds.

Harness copied from tests/test_file_download_authz.py (the doc calls that
"the right shape"): the real app/main.py FastAPI app driven through
httpx.ASGITransport, `get_db` pinned to conftest's in-memory `db_session`,
`get_current_user` overridden per actor, and the real seeded RBAC policy from
conftest's `seed_canonical`.

WHERE THE "SENSITIVE FIELD" DECLARATION ACTUALLY LIVES — this matters, because
guessing field names by hand is exactly what this file is supposed to avoid:

  * app/rbac/field_manifest.json is an INVENTORY, not a policy. It is the
    machine-generated field list for 25 screens (frontend/scripts/generate-
    field-manifest.js parses the Angular configs), and app/rbac/field_sync.py
    turns it into ScreenSensitiveField rows — "this field EXISTS and can be
    governed", not "this field is withheld from anyone".
  * app/rbac/registry/screens.py's `ScreenDef.sensitive_fields` is the second,
    hand-curated source of ScreenSensitiveField rows.
  * app/seed.py's SCREEN_FIELD_PERMISSIONS is the actual per-role RESTRICTION:
    it is what becomes RolePermissionField rows, which is the only thing
    resolver.py reads into `PermissionSet.field_modes`.

So the data-driven sweep below iterates SCREEN_FIELD_PERMISSIONS (every
declared restriction, no hardcoded field names) and cross-checks it against
the union of the other two (every restriction must sit on a field that is
actually administrable). A newly-declared restricted field on an already-
probed screen is picked up automatically; a newly-restricted SCREEN trips
`test_every_restricted_screen_has_a_response_body_probe` until someone wires
a probe for it.

WHAT "HIDDEN" MEANS HERE is read off app/core/serialization/masking.py rather
than assumed. `apply_field_masking` has two distinct contracts:
    mode == "hide"  ->  out.pop(field_key)          # the key is ABSENT
    mode == "mask"  ->  out[field_key] = MASKED_PLACEHOLDER   # present, {"__masked__": true}
Everything SCREEN_FIELD_PERMISSIONS declares today is "hide", so the sweep
asserts absence; the "mask" branch is asserted structurally so it stays
correct if a future declaration uses it.

NOTE ON SEEDING: conftest's `seed_canonical` seeds Roles, Screens,
ScreenActions, RolePermission and RolePermissionAction — Layers 1, 2 and 4.
It deliberately does NOT seed RolePermissionField, so `field_modes` is empty
and Layer 3 is inert under it. `_seed_field_grants` below inserts exactly
app/seed.py's own SCREEN_FIELD_PERMISSIONS rows so this file tests the real
shipped Layer-3 policy without editing conftest.py (which the brief forbids).
"""

import json
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.core.serialization.masking import MASKED_PLACEHOLDER
from app.main import app
from app.models.asset import Asset
from app.models.customer import Customer
from app.models.employee import Employee, SalaryStructure
from app.models.finance import ExpenseClaim
from app.models.platform import User
from app.models.project import Project
from app.models.rbac import FeatureToggle, RolePermissionField
from app.models.vendor import Vendor
from app.rbac.field_sync import MANIFEST_PATH
from app.rbac.registry.screens import SCREENS
from app.seed import SCREEN_FIELD_PERMISSIONS
from tests.conftest import CANONICAL_SCREEN_MODE, seed_canonical

ROLE_CODES = ("SUPER_ADMIN", "MANAGER", "ACCOUNTANT", "HR", "EMPLOYEE")
# resolver.py's VISIBLE_MODES — the modes under which require_screen lets a
# request through at all (anything else is a 404 before the body runs).
VISIBLE_MODES = {"full", "view", "view_team", "own", "team"}


# ============================================================ the declaration
_MANIFEST: dict[str, list[dict[str, str]]] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
MANIFEST_FIELDS: dict[str, set[str]] = {
    screen_key: {entry["field_key"] for entry in entries} for screen_key, entries in _MANIFEST.items()
}


def _restrictions() -> list[tuple[str, str, str, str]]:
    """Every (screen, field, role, mode) app/seed.py declares — flattened, and
    read from the real module, so this file never hardcodes a field name."""
    flat: list[tuple[str, str, str, str]] = []
    for screen_key, per_field in sorted(SCREEN_FIELD_PERMISSIONS.items()):
        for field_key, per_role in sorted(per_field.items()):
            for role_code, mode in sorted(per_role.items()):
                flat.append((screen_key, field_key, role_code, mode))
    return flat


RESTRICTIONS = _restrictions()


# =================================================================== fixtures
@pytest_asyncio.fixture
async def client(db_session):
    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _as(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


@dataclass
class World:
    """One seeded company: five role actors each backed by a real Employee row,
    a genuine reporting line (Employee.reporting_manager_id) under the Manager,
    one out-of-team Employee, and one readable record per probed screen."""

    ids: dict[str, str]
    users: dict[str, User]  # role_code -> the actor holding that role
    employees: dict[str, Employee]  # role_code -> that actor's Employee row
    manager_employee: Employee
    report_employee: Employee
    peer_employee: Employee
    outsider_employee: Employee
    outsider_user: User
    report_user: User
    assets: dict[str, str]  # employee_id -> asset id assigned to them
    vendor_id: str
    customer_id: str
    team_project_id: str
    outside_project_id: str

    def actor(self, role_code: str) -> User:
        return self.users[role_code]


async def _make_actor(
    db, ids: dict, role_code: str, label: str, *, manager_id: str | None = None, department: str = "dept-core"
) -> tuple[User, Employee]:
    """A login plus the Employee row it is linked through. Ownership in this
    codebase is an employee_id, never a user_id (app/services/org_scope.py's
    get_own_employee_id joins User.id -> Employee.user_id), so a user with no
    Employee row can never satisfy an 'own'/'team' scope.
    """
    user = User(
        id=str(uuid.uuid4()), email=f"{label}@scope.test", password_hash="x",
        full_name=label, role_id=ids[f"role:{role_code}"],
    )
    db.add(user)
    await db.flush()
    employee = Employee(
        id=str(uuid.uuid4()), employee_code=f"EMP-{label}", code_financial_year_id="fy-1",
        first_name=label, email=f"{label}.emp@scope.test", department_id=department,
        designation_id="desig-1", employment_type_id="emptype-1", joining_date=date(2020, 1, 1),
        user_id=user.id, reporting_manager_id=manager_id,
    )
    db.add(employee)
    await db.flush()
    return user, employee


async def _seed_field_grants(db, ids: dict) -> None:
    """app/seed.py's SCREEN_FIELD_PERMISSIONS, inserted verbatim as
    RolePermissionField rows — the Layer-3 policy the product actually ships.
    conftest's seed_canonical stops at Layer 2 + 4, so without this every
    `field_modes` is {} and apply_field_masking short-circuits on its own
    `if not perms.field_modes: return payload` guard.
    """
    for screen_key, per_field in SCREEN_FIELD_PERMISSIONS.items():
        for field_key, per_role in per_field.items():
            for role_code, mode in per_role.items():
                db.add(
                    RolePermissionField(
                        id=str(uuid.uuid4()), role_id=ids[f"role:{role_code}"],
                        screen_id=ids[f"screen:{screen_key}"], field_key=field_key, mode=mode,
                    )
                )


@pytest_asyncio.fixture
async def world(db_session) -> World:
    ids = await seed_canonical(db_session)
    await _seed_field_grants(db_session, ids)

    _, manager_employee = await _make_actor(db_session, ids, "MANAGER", "vikram")
    users: dict[str, User] = {}
    employees: dict[str, Employee] = {}
    users["MANAGER"] = await db_session.get(User, manager_employee.user_id)
    employees["MANAGER"] = manager_employee

    # Everyone except the Manager themself reports to the Manager, so
    # 'team'/'view_team' has real members to resolve rather than an empty set.
    for role_code, label in (("SUPER_ADMIN", "ravi"), ("ACCOUNTANT", "nisha"), ("HR", "fatima"), ("EMPLOYEE", "arun")):
        user, employee = await _make_actor(db_session, ids, role_code, label, manager_id=manager_employee.id)
        users[role_code] = user
        employees[role_code] = employee

    report_user, report_employee = users["EMPLOYEE"], employees["EMPLOYEE"]
    _, peer_employee = await _make_actor(db_session, ids, "EMPLOYEE", "divya", manager_id=manager_employee.id)
    outsider_user, outsider_employee = await _make_actor(
        db_session, ids, "EMPLOYEE", "kiran", manager_id=None, department="dept-outside"
    )

    # One asset per actor (so `employee.my_assets` has a row for every role to
    # read) plus one for the out-of-team employee (so `asset.directory`'s
    # view_team scope has something it must NOT return).
    assets: dict[str, str] = {}
    for tag, employee in [(e.first_name, e) for e in list(employees.values()) + [peer_employee, outsider_employee]]:
        asset = Asset(
            id=str(uuid.uuid4()), asset_tag=f"AST-{tag}", financial_year_id="fy-1", name=f"Laptop {tag}",
            category_id="cat-1", purchase_date=date(2024, 1, 1), purchase_value=Decimal("90000.00"),
            useful_life_years=3, status="ASSIGNED", assigned_to=employee.id, department_id=employee.department_id,
        )
        db_session.add(asset)
        assets[employee.id] = asset.id

    vendor = Vendor(
        id=str(uuid.uuid4()), vendor_name="Acme Supplies", gstin="27BBBBB0000B1Z5", pan="BBBBB0000B",
        bank_account_name="Acme Supplies Pvt Ltd", bank_name="HDFC", bank_account_number="123456789012",
        ifsc_code="HDFC0000123", payment_terms_days=30,
    )
    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-1", financial_year_id="fy-1", company_name="Globex",
        display_name="Globex", email="ap@globex.test", mobile_number="9999999999", status_id="st-1",
        source_id="src-1", gstin="27AAAAA0000A1Z5", pan="AAAAA0000A",
        collected_into_bank_account_id="bank-house-1",
    )
    db_session.add_all([vendor, customer])

    # Gives GET /vendors/{id}/usage a real row, so the three usage-only
    # banking columns (paid_from / paid_into / account_number_masked) are
    # asserted against a populated body, not an empty list.
    db_session.add(
        ExpenseClaim(
            id=str(uuid.uuid4()), employee_id=report_employee.id, financial_year_id="fy-1",
            expense_type_id="et-1", claim_type="COMPANY_PAID", expense_type_name_snapshot="Stationery",
            amount=Decimal("2500.00"), expense_date=date(2026, 4, 5), description="printer paper",
            status="PENDING", submitted_at=date.today(), vendor_id=vendor.id, bank_account_id="bank-house-1",
        )
    )

    team_project = Project(
        id=str(uuid.uuid4()), project_code="PRJ-TEAM", financial_year_id="fy-1", project_name="Apollo",
        customer_id=customer.id, status="IN_PROGRESS", budget=Decimal("500000.00"),
        project_lead_id=report_employee.id,
    )
    outside_project = Project(
        id=str(uuid.uuid4()), project_code="PRJ-OTHER", financial_year_id="fy-1", project_name="Zeus",
        customer_id=customer.id, status="IN_PROGRESS", budget=Decimal("900000.00"),
        project_lead_id=outsider_employee.id,
    )
    db_session.add_all([team_project, outside_project])

    db_session.add(
        SalaryStructure(
            id=str(uuid.uuid4()), employee_id=report_employee.id, financial_year_id="fy-1",
            effective_from=date(2026, 4, 1), changed_by=users["SUPER_ADMIN"].id,
            basic_salary_monthly=Decimal("50000.00"),
        )
    )
    await db_session.commit()

    return World(
        ids=ids, users=users, employees=employees, manager_employee=manager_employee,
        report_employee=report_employee, peer_employee=peer_employee, outsider_employee=outsider_employee,
        outsider_user=outsider_user, report_user=report_user, assets=assets, vendor_id=vendor.id,
        customer_id=customer.id, team_project_id=team_project.id, outside_project_id=outside_project.id,
    )


# ================================================== response-body inspection
def _objects(payload) -> list[dict]:
    """Every JSON object a response body carries at its top level — a list
    endpoint's rows, or a detail endpoint's single object."""
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


async def _bodies(client: AsyncClient, urls: list[str]) -> tuple[list[dict], list[int]]:
    objects: list[dict] = []
    codes: list[int] = []
    for url in urls:
        resp = await client.get(url)
        codes.append(resp.status_code)
        if resp.status_code == 200:
            objects.extend(_objects(resp.json()))
    return objects, codes


# The read endpoints that actually serve each screen governed by
# SCREEN_FIELD_PERMISSIONS. `world` is the seeded company; `role_code` is who
# is asking (my_assets is per-caller, the rest are not).
_PROBES = {
    "vendor.directory": lambda w, role: [
        "/api/v1/vendors",
        f"/api/v1/vendors/{w.vendor_id}",
        f"/api/v1/vendors/{w.vendor_id}/usage",
    ],
    "customer.directory": lambda w, role: [
        "/api/v1/customers",
        f"/api/v1/customers/{w.customer_id}",
    ],
    "asset.directory": lambda w, role: [
        "/api/v1/assets",
        f"/api/v1/assets/{w.assets[w.report_employee.id]}",
    ],
    "employee.my_assets": lambda w, role: ["/api/v1/employees/me/assets"],
    # Added when budget became a DECLARED restriction (EMPLOYEE: hide)
    # rather than something only a feature toggle could withhold.
    "project.directory": lambda w, role: ["/api/v1/projects"],
}
# asset.reports publishes the same two governed fields under DERIVED key names
# (total_purchase_value / total_current_value on the per-category rollup), so
# a generic "is `purchase_value` in the body" sweep would pass vacuously
# against it. Covered by its own test below instead.
_DEDICATED_PROBE_SCREENS = {"asset.reports"}

_SWEEP = [r for r in RESTRICTIONS if r[0] in _PROBES]
_SWEEP_IDS = [f"{s}|{f}|{role}|{mode}" for s, f, role, mode in _SWEEP]


# =========================================================================
# ITEM 2 — FIELD-LEVEL LEAK
# =========================================================================
# ------------------------------------------ 2.0 the declaration is coherent
def test_every_restricted_field_is_a_declared_sensitive_field():
    """A RolePermissionField row on a field with no ScreenSensitiveField row is
    unadministrable: rbac_admin.py's matrix write path rejects it with
    "'x' is not a sensitive field on screen 'y'", so a Super Admin could never
    lift or re-apply the restriction through the product. ScreenSensitiveField
    rows come from exactly two places (field_sync.py's docstring): the
    auto-synced manifest, and the registry's hand-curated `sensitive_fields`.
    """
    unadministrable = []
    for screen_key, field_key, _role, _mode in RESTRICTIONS:
        declared = MANIFEST_FIELDS.get(screen_key, set()) | set(SCREENS[screen_key].sensitive_fields)
        if field_key not in declared:
            unadministrable.append(f"{screen_key}.{field_key}")
    assert not unadministrable, (
        "restricted in seed.py but declared nowhere (manifest or registry), so the "
        f"Permission Matrix cannot edit them: {unadministrable}"
    )


def test_every_restricted_screen_has_a_response_body_probe():
    """The guard that keeps the sweep honest as the policy grows: a newly
    restricted FIELD on an already-probed screen is picked up automatically by
    the parametrization, but a newly restricted SCREEN needs a read endpoint
    wired here or its restriction is never actually exercised against a body.
    """
    uncovered = sorted(set(SCREEN_FIELD_PERMISSIONS) - set(_PROBES) - _DEDICATED_PROBE_SCREENS)
    assert not uncovered, f"SCREEN_FIELD_PERMISSIONS declares restrictions with no body probe: {uncovered}"


def test_the_sweep_is_not_empty():
    """Cheap self-test: if SCREEN_FIELD_PERMISSIONS or the probe map is ever
    refactored into a shape this file reads as empty, every parametrized
    assertion below would silently vanish rather than fail."""
    assert len(_SWEEP) >= 13, f"expected the shipped restriction set, got {len(_SWEEP)} cases"


# ---------------------------- 2.1 the sweep: declared restriction, real body
@pytest.mark.parametrize("screen_key,field_key,role_code,mode", _SWEEP, ids=_SWEEP_IDS)
async def test_declared_field_restriction_is_enforced_on_the_response_body(
    db_session, client, world, screen_key, field_key, role_code, mode
):
    """Item 2, data-driven over the real policy: for every restriction
    app/seed.py declares, call the screen's own read endpoints as that role and
    assert the field is gone from the PARSED JSON, per masking.py's contract
    for that mode ('hide' -> key absent, 'mask' -> MASKED_PLACEHOLDER)."""
    _as(world.actor(role_code))
    objects, codes = await _bodies(client, _PROBES[screen_key](world, role_code))

    screen_mode = CANONICAL_SCREEN_MODE[screen_key][role_code]
    if screen_mode not in VISIBLE_MODES:
        # Layer 1 already closed the screen; Layer 3 never gets a turn.
        assert all(code == 404 for code in codes), f"{role_code} has mode '{screen_mode}' on {screen_key}: {codes}"
        return

    assert objects, f"{role_code} got no rows at all from {screen_key} — the assertion below would be vacuous"
    if mode == "hide":
        offenders = [obj for obj in objects if field_key in obj]
        assert not offenders, (
            f"{screen_key}.{field_key} is declared 'hide' for {role_code} but the key is present in "
            f"{len(offenders)} response object(s): {[obj.get(field_key) for obj in offenders][:3]}"
        )
    elif mode == "mask":
        leaked = [obj[field_key] for obj in objects if field_key in obj and obj[field_key] != MASKED_PLACEHOLDER]
        assert not leaked, f"{screen_key}.{field_key} declared 'mask' for {role_code} but returned raw: {leaked[:3]}"
    else:
        assert mode == "show", f"unknown field mode {mode!r} — masking.py only implements hide/mask"


@pytest.mark.parametrize(
    "screen_key,field_key",
    sorted({(s, f) for s, f, _r, _m in _SWEEP}),
    ids=lambda v: v if isinstance(v, str) else str(v),
)
async def test_an_unrestricted_role_still_receives_the_field(db_session, client, world, screen_key, field_key):
    """The other half of the assertion: masking must be ROLE-SPECIFIC, not a
    blanket removal that would make the sweep above pass for the wrong reason.
    Every role that can open the screen and has no restriction declared on this
    field must still get the key in its body. (employee.my_assets restricts all
    five roles, so it contributes no cases here — correctly.)
    """
    restricted_roles = set(SCREEN_FIELD_PERMISSIONS[screen_key][field_key])
    candidates = [
        role for role in ROLE_CODES
        if role not in restricted_roles and CANONICAL_SCREEN_MODE[screen_key][role] in VISIBLE_MODES
    ]
    if not candidates:
        pytest.skip(f"{screen_key}.{field_key} is withheld from every role that can open the screen")

    for role_code in candidates:
        _as(world.actor(role_code))
        objects, _ = await _bodies(client, _PROBES[screen_key](world, role_code))
        assert any(field_key in obj for obj in objects), (
            f"{role_code} has no restriction on {screen_key}.{field_key} but never received the key — "
            "masking is removing it unconditionally, which would make the hide assertions meaningless"
        )


# ---------------------- 2.2 asset.reports — the same fields, derived key names
async def test_manager_asset_report_carries_no_value_totals(db_session, client, world):
    """asset.reports rolls purchase/current value up per category, so the
    governed field names never appear verbatim in the body. assets.py reads the
    resolved Layer-3 mode directly (`perms.field_mode("purchase_value")`) and
    drops the derived keys — assert on those derived keys, and prove Accountant
    still gets them."""
    _as(world.actor("MANAGER"))
    manager_rollup = (await client.get("/api/v1/assets/reports/summary")).json()["count_and_value_by_category"]
    assert manager_rollup, "no categories came back — the assertion below would be vacuous"
    for entry in manager_rollup:
        assert "total_purchase_value" not in entry, f"Manager got a purchase-value total: {entry}"
        assert "total_current_value" not in entry, f"Manager got a current-value total: {entry}"
        assert "count" in entry, "the count itself must survive — only the money figures are withheld"

    _as(world.actor("ACCOUNTANT"))
    accountant_rollup = (await client.get("/api/v1/assets/reports/summary")).json()["count_and_value_by_category"]
    assert all("total_purchase_value" in entry for entry in accountant_rollup), (
        "Accountant has no restriction on asset.reports and must still see the totals"
    )


# ---------------- 2.3 the doc's canonical case: EMPLOYEE + Project Directory
# REGRESSION TEST for a real leak this suite found, now FIXED.
async def test_employee_project_directory_body_carries_no_budget(db_session, client, world):
    """Bypass matrix item 2, verbatim: log in as EMPLOYEE, request the Project
    Directory, assert `budget` is absent from the JSON body."""
    _as(world.report_user)
    rows = (await client.get("/api/v1/projects")).json()
    assert rows, "the Employee must see their own project, or this proves nothing"
    for row in rows:
        assert "budget" not in row, f"Employee received Project Budget over the API: {row.get('budget')}"

    detail = (await client.get(f"/api/v1/projects/{world.team_project_id}")).json()
    assert "budget" not in detail, f"Employee received Project Budget by id: {detail.get('budget')}"


# REGRESSION TEST for a real leak this suite found, now FIXED.
async def test_project_directory_honours_a_declared_budget_hide(db_session, client, world):
    """The administrable half of the same gap: with Budget explicitly set to
    'hide' for Employee in the RBAC matrix, the field must leave the body."""
    db_session.add(
        RolePermissionField(
            id=str(uuid.uuid4()), role_id=world.ids["role:EMPLOYEE"],
            screen_id=world.ids["screen:project.directory"], field_key="budget", mode="hide",
        )
    )
    await db_session.commit()

    _as(world.report_user)
    rows = (await client.get("/api/v1/projects")).json()
    assert rows, "the Employee must see their own project, or this proves nothing"
    assert all("budget" not in row for row in rows), (
        f"budget='hide' resolved for EMPLOYEE but the list still served it: {[r.get('budget') for r in rows]}"
    )
    detail = (await client.get(f"/api/v1/projects/{world.team_project_id}")).json()
    assert "budget" not in detail, f"budget='hide' ignored by the by-id route: {detail.get('budget')}"


async def test_project_budget_toggle_removes_the_field_from_the_body(db_session, client, world):
    """Pins what the protection that DOES exist actually promises, so the two
    xfails above are not mistaken for "budget is never protected".

    With 'Hide Budget from Employee's Project View' ON, projects.py sets
    `out.budget = None`. It now masks properly, so the KEY is gone too, matching
    from masking.py's own 'hide' contract (`out.pop(field_key)`, key absent).
    Asserted as-is rather than aspirationally: this is the code's real contract.
    """
    db_session.add(
        FeatureToggle(
            id=str(uuid.uuid4()), toggle_key="Hide Budget from Employee's Project View",
            module_key="project", label="Hide Budget from Employee's Project View",
            enabled=True, default_enabled=False,
        )
    )
    await db_session.commit()

    _as(world.report_user)
    rows = (await client.get("/api/v1/projects")).json()
    assert rows
    for row in rows:
        # The toggle now runs through apply_field_masking like every other
        # Layer 3 restriction, and masking.py's 'hide' POPS the key. It used
        # to set the value to None, which still told the reader the field
        # existed — a divergence from the documented hide contract that this
        # assertion originally pinned as the observed behaviour.
        assert "budget" not in row, f"toggle is ON but a figure came through: {row.get('budget')}"

    detail = (await client.get(f"/api/v1/projects/{world.team_project_id}")).json()
    assert "budget" not in detail

    # Not a blanket null: a role the toggle does not name still gets the figure.
    _as(world.actor("SUPER_ADMIN"))
    assert (await client.get(f"/api/v1/projects/{world.team_project_id}")).json()["budget"] is not None


# ------------------------------- 2.4 HR / Accountant + Salary Structure fields
async def test_salary_structure_is_reachable_only_by_the_roles_that_hold_the_screen(db_session, client, world):
    """The boundary that DOES exist on employee.salary_structure: 'view' for HR
    and Accountant, 'none' for Manager and Employee (conftest's canonical
    policy). Manager/Employee get 404 from require_screen before the body runs —
    so no amount of guessing another employee's id reaches a salary figure.
    """
    url = f"/api/v1/employees/{world.report_employee.id}/salary-structures"
    for role_code in ("HR", "ACCOUNTANT", "SUPER_ADMIN"):
        _as(world.actor(role_code))
        resp = await client.get(url)
        assert resp.status_code == 200, f"{role_code} lost salary-structure access: {resp.text}"
        assert resp.json(), f"{role_code} got an empty structure list — nothing was actually read"

    for role_code in ("MANAGER", "EMPLOYEE"):
        _as(world.actor(role_code))
        assert (await client.get(url)).status_code == 404, f"{role_code} must not reach a salary structure at all"
        assert (await client.get(url + "/current")).status_code == 404


# REGRESSION TEST for a real leak this suite found, now FIXED.
async def test_salary_structure_honours_a_declared_field_hide(db_session, client, world):
    """Bypass matrix item 2, HR/Accountant + Salary Structure: a declared
    field restriction on a pay figure must leave the response body."""
    for role_code in ("HR", "ACCOUNTANT"):
        db_session.add(
            RolePermissionField(
                id=str(uuid.uuid4()), role_id=world.ids[f"role:{role_code}"],
                screen_id=world.ids["screen:employee.salary_structure"],
                field_key="basic_salary_monthly", mode="hide",
            )
        )
    await db_session.commit()

    url = f"/api/v1/employees/{world.report_employee.id}/salary-structures"
    for role_code in ("HR", "ACCOUNTANT"):
        _as(world.actor(role_code))
        rows = (await client.get(url)).json()
        assert rows, "no structure came back — the assertion below would be vacuous"
        assert all("basic_salary_monthly" not in row for row in rows), (
            f"basic_salary_monthly='hide' resolved for {role_code} but the body still carries "
            f"{[row.get('basic_salary_monthly') for row in rows]}"
        )


# =========================================================================
# ITEM 3 — SCOPE ESCAPE
# =========================================================================
# employee.directory / employee.master_record are 'view_team' for MANAGER, so
# "their team" here is a genuine Employee.reporting_manager_id structure seeded
# in the `world` fixture, resolved by app/services/org_scope.py and injected by
# app/rbac/scope.py's apply_scope BEFORE any filter (RBAC Invariant 5).
async def test_manager_cannot_read_an_employee_outside_their_team_by_id(db_session, client, world):
    """Item 3(a) — by id. org_scope.assert_employee_in_scope exists precisely
    because the LIST endpoint being scoped is not enough: a view_team role must
    not reach a stranger by guessing or enumerating their employee id."""
    _as(world.actor("MANAGER"))

    denied = await client.get(f"/api/v1/employees/{world.outsider_employee.id}")
    assert denied.status_code == 403, (
        f"Manager reached an employee outside their reporting line by id: {denied.status_code} {denied.text[:200]}"
    )
    assert world.outsider_employee.email not in denied.text

    # The same route must keep working for a real direct report and for self.
    for label, employee_id in (("direct report", world.report_employee.id), ("self", world.manager_employee.id)):
        allowed = await client.get(f"/api/v1/employees/{employee_id}")
        assert allowed.status_code == 200, f"Manager lost access to their own {label}: {allowed.text[:200]}"

    # Super Admin ('full') is the control: the record is genuinely there.
    _as(world.actor("SUPER_ADMIN"))
    assert (await client.get(f"/api/v1/employees/{world.outsider_employee.id}")).status_code == 200


async def test_manager_employee_list_is_their_team_and_nothing_more(db_session, client, world):
    """Item 3 — the row set itself, compared against a Super Admin fetch of the
    same endpoint rather than against a hand-written expectation."""
    _as(world.actor("SUPER_ADMIN"))
    everyone = {row["employee_code"] for row in (await client.get("/api/v1/employees")).json()}

    _as(world.actor("MANAGER"))
    manager_sees = {row["employee_code"] for row in (await client.get("/api/v1/employees")).json()}

    expected = {world.manager_employee.employee_code} | {
        e.employee_code for e in (world.employees["SUPER_ADMIN"], world.employees["ACCOUNTANT"],
                                  world.employees["HR"], world.employees["EMPLOYEE"], world.peer_employee)
    }
    assert manager_sees == expected, "view_team must be exactly self + direct reports"
    assert manager_sees < everyone, "the Manager's row set must be a strict subset of Super Admin's"
    assert world.outsider_employee.employee_code in everyone - manager_sees


async def test_manager_cannot_widen_the_employee_list_with_filter_params(db_session, client, world):
    """Item 3(b) — via filter params. RBAC Invariant 5: "role scope is applied
    before filters, always". A filter naming another department, another
    manager's id, or the out-of-team employee's own attributes may only ever
    narrow what scope already allowed — never re-open it."""
    _as(world.actor("MANAGER"))
    baseline = {row["employee_code"] for row in (await client.get("/api/v1/employees")).json()}

    escapes = [
        f"department_id={world.outsider_employee.department_id}",
        f"reporting_manager_id={world.outsider_employee.id}",
        f"reporting_manager_id={world.employees['SUPER_ADMIN'].id}",
        f"search={world.outsider_employee.first_name}",
        f"search={world.outsider_employee.email}",
        f"created_by={world.actor('SUPER_ADMIN').id}",
        "joining_date_from=1900-01-01&joining_date_to=2100-01-01",
        "employment_status=ACTIVE",
    ]
    for query in escapes:
        resp = await client.get(f"/api/v1/employees?{query}")
        assert resp.status_code == 200, f"?{query} -> {resp.status_code}"
        returned = {row["employee_code"] for row in resp.json()}
        assert returned <= baseline, f"?{query} widened the Manager's row set with {returned - baseline}"
        assert world.outsider_employee.employee_code not in returned, f"?{query} leaked the out-of-team employee"


async def test_manager_cannot_reach_another_teams_asset_by_id_or_filter(db_session, client, world):
    """The same two routes on a second view_team screen — asset.directory,
    which scopes on Asset.assigned_to rather than Employee.id, so this is a
    genuinely different code path from the Employee Directory above."""
    outsider_asset_id = world.assets[world.outsider_employee.id]

    _as(world.actor("MANAGER"))
    by_id = await client.get(f"/api/v1/assets/{outsider_asset_id}")
    assert by_id.status_code == 404, f"Manager reached an out-of-team asset by id: {by_id.status_code}"

    baseline = {row["asset_tag"] for row in (await client.get("/api/v1/assets")).json()}
    assert baseline, "the Manager must see their own team's assets, or this proves nothing"

    for query in (
        f"assigned_to={world.outsider_employee.id}",
        f"department_id={world.outsider_employee.department_id}",
        "purchase_value_min=0",
        "status=ASSIGNED",
    ):
        resp = await client.get(f"/api/v1/assets?{query}")
        assert resp.status_code == 200, f"?{query} -> {resp.status_code}"
        returned = {row["asset_tag"] for row in resp.json()}
        assert returned <= baseline, f"?{query} widened the Manager's asset set with {returned - baseline}"

    _as(world.actor("SUPER_ADMIN"))
    everything = {row["asset_tag"] for row in (await client.get("/api/v1/assets")).json()}
    assert baseline < everything
    assert (await client.get(f"/api/v1/assets/{outsider_asset_id}")).status_code == 200


async def test_employee_own_scope_on_project_directory_by_id_and_filter(db_session, client, world):
    """The 'own' half of item 3, on project.directory (EMPLOYEE mode 'own',
    resolved through app/services/project_scope.py's real membership check
    rather than a role check). Same two routes: by id, and via filter params."""
    _as(world.actor("SUPER_ADMIN"))
    all_projects = {row["project_code"] for row in (await client.get("/api/v1/projects")).json()}
    assert {"PRJ-TEAM", "PRJ-OTHER"} <= all_projects

    _as(world.report_user)
    mine = {row["project_code"] for row in (await client.get("/api/v1/projects")).json()}
    assert mine == {"PRJ-TEAM"}, f"'own' scope returned someone else's projects: {mine}"
    assert mine < all_projects

    denied = await client.get(f"/api/v1/projects/{world.outside_project_id}")
    assert denied.status_code == 404, f"Employee reached a project they are not on, by id: {denied.status_code}"
    assert (await client.get(f"/api/v1/projects/{world.team_project_id}")).status_code == 200

    for query in (
        f"project_lead_id={world.outsider_employee.id}",
        f"team_member_id={world.outsider_employee.id}",
        f"customer_id={world.customer_id}",
        "budget_min=0",
        "search=Zeus",
        "status=IN_PROGRESS",
    ):
        resp = await client.get(f"/api/v1/projects?{query}")
        assert resp.status_code == 200, f"?{query} -> {resp.status_code}"
        returned = {row["project_code"] for row in resp.json()}
        assert returned <= mine, f"?{query} widened the Employee's project set with {returned - mine}"
        assert "PRJ-OTHER" not in returned, f"?{query} leaked a project the Employee is not on"


async def test_employee_holds_no_directory_screen_at_all(db_session, client, world):
    """The narrowest scope of all: employee.directory is 'none' for EMPLOYEE, so
    the list endpoint is a 404 (Layer 1), not an empty 200 — an invisible screen
    must not reveal that it exists (rbac/deps.py)."""
    _as(world.report_user)
    assert (await client.get("/api/v1/employees")).status_code == 404
    assert (await client.get(f"/api/v1/employees/{world.outsider_employee.id}")).status_code == 404

    # ...but the caller's own record stays reachable through the self-service
    # screen (employee.my_profile, 'full' for every role).
    me = await client.get("/api/v1/employees/me")
    assert me.status_code == 200
    assert me.json()["email"] == world.report_employee.email
