"""Layer 2's round-trip check (COMPLETE-TEST-PROMPT.md, the seven-check table
for every endpoint), applied to every endpoint that carries nested or child
data.

Why this file exists, in the prompt's own words:

    "The round-trip check is not optional. The Tax Head PUT bug - silently
    discarding slab bands, split components and relief rules - passed every
    other check and would have been caught by this one alone."

WHAT A ROUND TRIP IS HERE. POST a record with its child collections FULLY
populated, then GET it back in a separate request and assert every scalar AND
every child row survived. Then PUT a change - including changing, ADDING and
REMOVING child rows - GET again, and assert the change persisted and nothing
else was lost.

Asserting on the POST/PUT response alone is explicitly NOT a round trip. The
bug class being hunted is data lost between the write and the store, and a
handler that re-serialises the in-memory ORM object before (or instead of)
touching its child tables answers correctly while having persisted nothing.
Every assertion below is therefore on the re-read.

WHY SUPER_ADMIN EVERYWHERE. A 403/404 from a permission guard and a silently
dropped field both look like "the data isn't there". Driving every request as
Super Admin removes the first explanation entirely, so a failure here can only
be data loss. Permissions are Layer 3's job (tests/security/), and the four
mechanical checks - auth, unknown id, malformed body, never-500 - are already
swept across all 477 endpoints in test_endpoint_contract_sweep.py. Neither is
repeated here.

SHAPE. The real FastAPI app over httpx ASGITransport, `get_db` pinned to
conftest's in-memory `db_session` and `get_current_user` overridden - the same
harness tests/security/test_write_escalation.py and
tests/test_file_download_authz.py already use.

WHAT IT COVERS. Every endpoint whose write schema was confirmed against
app/schemas/ to carry a child collection: Tax Head (slab bands, split
components, relief rules, withholding directions), Invoice and Purchase Bill
(line items plus derived tax lines), Credit Note (lines derived from the
invoice lines it credits), Project (member_ids), Task (subtasks, comments),
Insurance Enrollment (dependents, nominees), Salary Structure (derived
statutory lines), Payroll Run (one derived row per employee), Company Profile
(addresses, number prefix rules), and Compliance Remittance (allocations).
Opportunity and Work Week Policy are covered too, at the prompt's request:
their write schemas turned out to carry NO child collection, so those are
full-field scalar round trips plus, for Work Week, the derived
net_working_hours_per_day and the sibling Saturday-override / Pay-Cycle
collections on the same screen.

WHAT IT FOUND. One real bug of exactly the class described above:
PUT /api/v1/invoices/{id} accepted a changed invoice_date, answered HTTP 200,
and kept the old date - see
test_invoice_put_never_silently_discards_a_changed_invoice_date, which now
stands as its regression test.
"""

import calendar
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.customer import Customer
from app.models.employee import Employee
from app.models.masters import (
    BankAccount,
    CustomerStatus,
    Department,
    Designation,
    EmploymentType,
    HsnSacCode,
    InsurancePlan,
    NumberPrefixRule,
    PaymentMode,
    ServiceCategory,
    TaxHead,
    TaxHeadSplitComponent,
    TaxHeadWithholdingDirection,
)
from app.models.numbering import FinancialYear
from app.models.platform import IndianState, User
from app.models.rbac import Role
from app.models.ticket import Ticket  # noqa: F401  - see the import note below
from app.models.vendor import Vendor
from tests.conftest import seed_canonical

# app.models.ticket is imported purely so the `tickets` table is registered on
# Base.metadata before conftest's db_session fixture calls create_all() - the
# same guard tests/test_invoice_toggles.py documents for the same reason.

API = "/api/v1"


# ================================================================ the harness
@pytest_asyncio.fixture
async def super_admin(db_session) -> User:
    """One real SUPER_ADMIN login over the canonical seeded RBAC policy."""
    await seed_canonical(db_session)
    role = (await db_session.execute(select(Role).where(Role.code == "SUPER_ADMIN"))).scalar_one()
    user = User(
        id=str(uuid.uuid4()),
        email="roundtrip.super@meshrd.in",
        password_hash="x",
        full_name="Round Trip Super Admin",
        role_id=role.id,
        is_enabled=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    app.dependency_overrides[get_current_user] = lambda: user
    return user


@pytest_asyncio.fixture
async def client(db_session, super_admin):
    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


async def _ok(response, *, expect: int = 200):
    assert response.status_code == expect, (
        f"{response.request.method} {response.request.url.path} -> {response.status_code}: {response.text[:400]}"
    )
    return response.json()


# --------------------------------------------------------- comparison helpers
def _numeric(value):
    """Decimal("10.00"), 10, 10.0 and "10.0000" are the same figure. Column
    scale (Numeric(7,4) against Numeric(14,2)) and the JSON encoder both
    reshape what a caller sent, and neither is data loss - comparing the VALUE
    is what this file is about. Booleans are excluded deliberately: bool is an
    int subclass in Python, so True would otherwise compare equal to 1.
    """
    if isinstance(value, bool) or value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _same(sent, got) -> bool:
    if sent == got:
        return True
    a, b = _numeric(sent), _numeric(got)
    return a is not None and b is not None and a == b


def _assert_survived(sent: dict, got: dict, *, where: str, ignore: tuple[str, ...] = ()) -> None:
    """Every key the caller SENT must come back carrying the same value. Extra
    keys in the response (ids, derived totals, snapshots) are expected and are
    not compared: this asserts nothing was lost, not that nothing was added.
    """
    lost = []
    for key, value in sent.items():
        if key in ignore:
            continue
        if key not in got:
            lost.append(f"  {key}: sent {value!r}, ABSENT from the re-read")
        elif not _same(value, got[key]):
            lost.append(f"  {key}: sent {value!r}, read back {got[key]!r}")
    assert not lost, f"{where} - these did not survive the round trip:\n" + "\n".join(lost)


def _assert_children(
    sent_rows: list[dict], got_rows: list[dict], *, where: str, key: str, ignore: tuple[str, ...] = ()
) -> None:
    """Child collections, matched on a natural key rather than list position so
    a reordered response is not reported as data loss - but a MISSING or an
    EXTRA row is.
    """
    sent_keys = sorted(str(row[key]) for row in sent_rows)
    got_keys = sorted(str(row.get(key)) for row in got_rows)
    assert got_keys == sent_keys, f"{where} - child rows lost or invented. Sent {sent_keys}, read back {got_keys}"
    got_by = {str(row[key]): row for row in got_rows}
    for sent in sent_rows:
        _assert_survived(sent, got_by[str(sent[key])], where=f"{where} [{key}={sent[key]}]", ignore=ignore)


# ==========================================================================
#  1. TAX HEAD - the endpoint this whole file exists for
#
#  THREE arithmetic child collections (slab bands, split components, relief
#  rules) plus withholding directions, all replaced wholesale on PUT by
#  masters_taxes.update_tax_head. This is the exact record whose PUT once
#  validated its children and then never wrote them.
# ==========================================================================
def _slab_bands() -> list[dict]:
    """Contiguous, last band open-ended - _validate_slab_bands' rule."""
    return [
        {"sequence_no": 1, "band_from": "0.00", "band_to": "250000.00", "rate_or_amount": "0.0000", "band_label": "Nil"},
        {"sequence_no": 2, "band_from": "250000.00", "band_to": "500000.00", "rate_or_amount": "5.0000", "band_label": "5 percent"},
        {"sequence_no": 3, "band_from": "500000.00", "band_to": None, "rate_or_amount": "20.0000", "band_label": "20 percent and above"},
    ]


def _split_components() -> list[dict]:
    """Shares must sum to exactly 100 - _validate_split_components' rule."""
    return [
        {"sequence_no": 1, "component_name": "Employee Share", "share_pct": "60.0000", "applies_when": "ALWAYS", "condition_rule": None},
        {"sequence_no": 2, "component_name": "Employer Share", "share_pct": "40.0000", "applies_when": "ALWAYS", "condition_rule": {"min_base": 1000}},
    ]


def _relief_rules() -> list[dict]:
    """Legal only on a PAYROLL_INCOME_TAX head - _validate_relief_rules."""
    return [
        {"relief_name": "87A Rebate", "applies_if_base_at_or_below": "700000.00", "relief_type": "FIXED_AMOUNT", "relief_amount": "25000.00", "is_active": True},
        {"relief_name": "Marginal Relief", "applies_if_base_at_or_below": "710000.00", "relief_type": "CAP_TO_EXCESS", "relief_amount": None, "is_active": False},
    ]


def _tax_head_body(**overrides) -> dict:
    """A PAYROLL_INCOME_TAX / SLAB head carrying all three arithmetic child
    collections at once - the only scope-and-type combination the router's own
    validators allow to hold slab bands, split components AND relief rules
    together, which is exactly the record the historical bug destroyed. Every
    optional scalar is populated with a non-default value on purpose: a field
    left at its default cannot prove it was written.
    """
    body = {
        "tax_name": "Income Tax (New Regime)",
        "short_code": "ITNR",
        "scope": "PAYROLL_INCOME_TAX",
        "tax_type": "SLAB",
        "applies_from": "2026-04-01",
        "applies_until": "2027-03-31",
        "rate_pct": None,
        "cgst_rate_pct": None,
        "sgst_rate_pct": None,
        "fixed_amount": None,
        "declaration_cap": "150000.00",
        "slab_application": "PROGRESSIVE",
        "tax_scheme_id": None,
        "print_label": "Income Tax",
        "notes": "Every field on this body is deliberately non-default.",
        "behaviour": {"round_to": 10, "applies_to_arrears": True},
        "creates_onward_liability": True,
        "remitted_to_authority": "Income Tax Department",
        "remittance_period": "MONTHLY",
        "period_aligns_to": "CALENDAR_MONTH",
        "deposit_due_days_after_period_end": 7,
        "liability_arises_on": "PAYMENT",
        "authority_reference_label": "Challan Number",
        "withholding_directions": [],
        "default_calculated_on": "TOTAL",
        "certificate_expected": True,
        "is_active": True,
        "slab_bands": _slab_bands(),
        "split_components": _split_components(),
        "relief_rules": _relief_rules(),
    }
    body.update(overrides)
    return body


_TAX_CHILDREN = ("slab_bands", "split_components", "relief_rules")


async def _get_head(client: AsyncClient, head_id: str) -> dict:
    """There is no GET /masters/taxes/{id} - the list endpoint is the re-read,
    and it builds each row through the same _to_out() the writes use.
    """
    heads = await _ok(await client.get(f"{API}/masters/taxes"))
    match = [h for h in heads if h["id"] == head_id]
    assert match, f"tax head {head_id} vanished from GET /masters/taxes entirely"
    return match[0]


async def test_tax_head_post_then_get_returns_every_field_and_all_three_child_collections(client):
    """POST then GET - never POST then assert on the POST response, because the
    historical bug lived between the write and the store.
    """
    body = _tax_head_body()
    created = await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201)

    stored = await _get_head(client, created["id"])

    _assert_survived(body, stored, where="POST /masters/taxes head fields", ignore=_TAX_CHILDREN)
    _assert_children(body["slab_bands"], stored["slab_bands"], where="tax head slab_bands", key="sequence_no")
    _assert_children(body["split_components"], stored["split_components"], where="tax head split_components", key="sequence_no")
    _assert_children(body["relief_rules"], stored["relief_rules"], where="tax head relief_rules", key="relief_name")


async def test_tax_head_put_editing_slab_bands_persists_and_leaves_the_other_two_collections_intact(client):
    """THE headline case. A PUT that changes ONE child collection must write
    that change and must not disturb the other two - the precise shape of the
    bug that motivated this file.
    """
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    edited = _tax_head_body()
    edited["slab_bands"] = [
        {"sequence_no": 1, "band_from": "0.00", "band_to": "300000.00", "rate_or_amount": "0.0000", "band_label": "Nil (raised)"},
        {"sequence_no": 2, "band_from": "300000.00", "band_to": None, "rate_or_amount": "15.0000", "band_label": "15 percent and above"},
    ]
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=edited))

    stored = await _get_head(client, head_id)
    _assert_children(edited["slab_bands"], stored["slab_bands"], where="tax head slab_bands after PUT", key="sequence_no")
    _assert_children(body["split_components"], stored["split_components"], where="split_components disturbed by an unrelated slab-band PUT", key="sequence_no")
    _assert_children(body["relief_rules"], stored["relief_rules"], where="relief_rules disturbed by an unrelated slab-band PUT", key="relief_name")


async def test_tax_head_put_editing_split_components_persists_and_leaves_the_other_two_collections_intact(client):
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    edited = _tax_head_body()
    edited["split_components"] = [
        {"sequence_no": 1, "component_name": "Employee Share", "share_pct": "75.0000", "applies_when": "ALWAYS", "condition_rule": None},
        {"sequence_no": 2, "component_name": "Employer Share", "share_pct": "25.0000", "applies_when": "ALWAYS", "condition_rule": {"min_base": 1000}},
    ]
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=edited))

    stored = await _get_head(client, head_id)
    _assert_children(edited["split_components"], stored["split_components"], where="tax head split_components after PUT", key="sequence_no")
    _assert_children(body["slab_bands"], stored["slab_bands"], where="slab_bands disturbed by an unrelated split-component PUT", key="sequence_no")
    _assert_children(body["relief_rules"], stored["relief_rules"], where="relief_rules disturbed by an unrelated split-component PUT", key="relief_name")


async def test_tax_head_put_editing_relief_rules_persists_and_leaves_the_other_two_collections_intact(client):
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    edited = _tax_head_body()
    edited["relief_rules"] = [
        {"relief_name": "87A Rebate", "applies_if_base_at_or_below": "750000.00", "relief_type": "FIXED_AMOUNT", "relief_amount": "30000.00", "is_active": False},
        {"relief_name": "Standard Deduction Relief", "applies_if_base_at_or_below": "9999999.00", "relief_type": "FIXED_AMOUNT", "relief_amount": "50000.00", "is_active": True},
    ]
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=edited))

    stored = await _get_head(client, head_id)
    _assert_children(edited["relief_rules"], stored["relief_rules"], where="tax head relief_rules after PUT", key="relief_name")
    _assert_children(body["slab_bands"], stored["slab_bands"], where="slab_bands disturbed by an unrelated relief-rule PUT", key="sequence_no")
    _assert_children(body["split_components"], stored["split_components"], where="split_components disturbed by an unrelated relief-rule PUT", key="sequence_no")


async def test_tax_head_put_removing_a_child_row_actually_removes_it_from_every_collection(client):
    """The other half of the child-row contract: a row the caller DROPPED must
    be gone. A handler that only ever inserts (never deletes) passes every
    "the change persisted" assertion above and fails this one.
    """
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    trimmed = _tax_head_body()
    trimmed["slab_bands"] = [
        {"sequence_no": 1, "band_from": "0.00", "band_to": "500000.00", "rate_or_amount": "0.0000", "band_label": "Nil"},
        {"sequence_no": 2, "band_from": "500000.00", "band_to": None, "rate_or_amount": "20.0000", "band_label": "20 percent and above"},
    ]
    trimmed["split_components"] = [
        {"sequence_no": 1, "component_name": "Employee Share", "share_pct": "100.0000", "applies_when": "ALWAYS", "condition_rule": None},
    ]
    trimmed["relief_rules"] = [_relief_rules()[0]]
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=trimmed))

    stored = await _get_head(client, head_id)
    assert len(stored["slab_bands"]) == 2, f"the dropped third slab band survived: {stored['slab_bands']}"
    assert len(stored["split_components"]) == 1, f"the dropped split component survived: {stored['split_components']}"
    assert len(stored["relief_rules"]) == 1, f"the dropped relief rule survived: {stored['relief_rules']}"
    _assert_children(trimmed["slab_bands"], stored["slab_bands"], where="slab_bands after a removal", key="sequence_no")
    _assert_children(trimmed["split_components"], stored["split_components"], where="split_components after a removal", key="sequence_no")
    _assert_children(trimmed["relief_rules"], stored["relief_rules"], where="relief_rules after a removal", key="relief_name")


async def test_tax_head_put_emptying_every_child_collection_leaves_none_behind(client):
    """The extreme of the same rule: send [] for all three and none may remain.
    An insert-only handler leaves all seven rows in place and still answers 200.
    """
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    emptied = _tax_head_body(tax_type="PERCENTAGE", rate_pct="10.0000", slab_application=None)
    emptied["slab_bands"] = []
    emptied["split_components"] = []
    emptied["relief_rules"] = []
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=emptied))

    stored = await _get_head(client, head_id)
    assert stored["slab_bands"] == [], f"slab bands survived being emptied: {stored['slab_bands']}"
    assert stored["split_components"] == [], f"split components survived being emptied: {stored['split_components']}"
    assert stored["relief_rules"] == [], f"relief rules survived being emptied: {stored['relief_rules']}"
    _assert_survived(emptied, stored, where="tax head scalars after emptying its children", ignore=_TAX_CHILDREN)


async def test_tax_head_put_changing_only_a_label_leaves_all_three_collections_untouched(client):
    """A label-only edit is the commonest real edit. It must not cost the head
    its arithmetic children as a side effect of the delete-and-reinsert.
    """
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    relabelled = _tax_head_body(tax_name="Income Tax (New Regime) FY26", print_label="IT (New)", notes="renamed only")
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=relabelled))

    stored = await _get_head(client, head_id)
    assert stored["tax_name"] == "Income Tax (New Regime) FY26"
    assert stored["print_label"] == "IT (New)"
    _assert_children(body["slab_bands"], stored["slab_bands"], where="slab_bands after a label-only PUT", key="sequence_no")
    _assert_children(body["split_components"], stored["split_components"], where="split_components after a label-only PUT", key="sequence_no")
    _assert_children(body["relief_rules"], stored["relief_rules"], where="relief_rules after a label-only PUT", key="relief_name")


async def test_tax_head_withholding_directions_survive_post_and_change_on_put(client):
    """The fourth child collection - a plain list of enum strings on its own
    table, governed by neither lock, and the one Duplicate used to drop.
    """
    body = _tax_head_body(
        tax_name="TDS 194J",
        short_code="194J",
        scope="WITHHOLDING_AT_SOURCE",
        tax_type="PERCENTAGE",
        rate_pct="10.0000",
        slab_application=None,
        declaration_cap=None,
        withholding_directions=["ON_PAYMENTS_MADE", "ON_PAYMENTS_RECEIVED"],
        slab_bands=[],
        split_components=[],
        relief_rules=[],  # relief rules are Payroll-only
    )
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    stored = await _get_head(client, head_id)
    assert sorted(stored["withholding_directions"]) == ["ON_PAYMENTS_MADE", "ON_PAYMENTS_RECEIVED"], stored["withholding_directions"]

    narrowed = dict(body, withholding_directions=["ON_PAYMENTS_MADE"])
    await _ok(await client.put(f"{API}/masters/taxes/{head_id}", json=narrowed))
    stored = await _get_head(client, head_id)
    assert stored["withholding_directions"] == ["ON_PAYMENTS_MADE"], f"the removed direction survived: {stored['withholding_directions']}"


async def test_tax_head_duplicate_carries_every_child_collection_to_the_copy(client):
    """Duplicate is the spec's mandated route for a rate change on a locked
    head, so a copy that loses the children loses the whole configuration.
    """
    body = _tax_head_body()
    head_id = (await _ok(await client.post(f"{API}/masters/taxes", json=body), expect=201))["id"]

    copy_body = _tax_head_body(tax_name="Income Tax (New Regime) FY27", applies_from="2027-04-01", applies_until=None)
    copy = await _ok(await client.post(f"{API}/masters/taxes/{head_id}/duplicate", json=copy_body), expect=201)

    stored = await _get_head(client, copy["id"])
    assert stored["id"] != head_id
    _assert_children(copy_body["slab_bands"], stored["slab_bands"], where="duplicated slab_bands", key="sequence_no")
    _assert_children(copy_body["split_components"], stored["split_components"], where="duplicated split_components", key="sequence_no")
    _assert_children(copy_body["relief_rules"], stored["relief_rules"], where="duplicated relief_rules", key="relief_name")


# ==========================================================================
#  Shared master data for the finance / CRM / people round trips below
# ==========================================================================
@pytest_asyncio.fixture
async def masters(db_session, super_admin) -> dict:
    """The minimum master rows the writes below need, inserted directly rather
    than through their own endpoints: this file is about whether a write
    PERSISTS, so its scaffolding must not itself be under test.

    The Financial Year deliberately straddles today, because Invoice and
    Purchase Bill both reject a document dated in the future and both resolve
    "the current FY" from is_current.
    """
    today = date.today()
    fy = FinancialYear(
        id=str(uuid.uuid4()), label=f"RT{today.year}", start_date=date(today.year - 1, 4, 1),
        end_date=date(today.year + 1, 3, 31), status="open", is_current=True,
    )
    db_session.add(fy)

    for code_type in ("INV", "PB", "CN", "PRJ", "OPP", "EMP", "RMT"):
        db_session.add(NumberPrefixRule(
            id=str(uuid.uuid4()), code_type=code_type, label=f"{code_type} Number", prefix=code_type,
            include_fy_in_code=True, running_number_digits=4, starting_number=1,
        ))

    customer_status = CustomerStatus(id=str(uuid.uuid4()), name="Active", code="ACTIVE")
    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-RT-1", financial_year_id=fy.id, company_name="Roundtrip Clients Ltd",
        status_id=customer_status.id, gstin="29ABCDE1234F1Z5", address="12 Test Road, Bengaluru",
    )
    vendor = Vendor(id=str(uuid.uuid4()), vendor_name="Roundtrip Supplies", payment_terms_days=30)
    category = ServiceCategory(id=str(uuid.uuid4()), name="Consulting", code="CONS")
    hsn_a = HsnSacCode(id=str(uuid.uuid4()), code="998313", code_type="SAC", description="IT consulting")
    hsn_b = HsnSacCode(id=str(uuid.uuid4()), code="998314", code_type="SAC", description="Engineering services")
    bank = BankAccount(
        id=str(uuid.uuid4()), nickname="Primary", bank_name="HDFC", account_holder_name="Meshrd",
        account_number="000111222333", account_type="CURRENT", ifsc="HDFC0000123", branch="MG Road", is_default=True,
    )
    payment_mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer", code="BANK", requires_reference_number=False)

    # Two sales heads so a PUT can genuinely SWAP the head and prove the
    # derived tax_lines were rebuilt rather than left behind.
    sales_tax = TaxHead(
        id=str(uuid.uuid4()), tax_name="GST 18 (Sales)", scope="SALES_BILLING", tax_type="GST_CGST_SGST",
        applies_from=fy.start_date, cgst_rate_pct=Decimal("9"), sgst_rate_pct=Decimal("9"), behaviour={},
    )
    sales_tax_alt = TaxHead(
        id=str(uuid.uuid4()), tax_name="GST 5 (Sales)", scope="SALES_BILLING", tax_type="PERCENTAGE",
        applies_from=fy.start_date, rate_pct=Decimal("5"), behaviour={},
    )
    purchase_tax = TaxHead(
        id=str(uuid.uuid4()), tax_name="GST 18 (Purchase)", scope="PURCHASE", tax_type="PERCENTAGE",
        applies_from=fy.start_date, rate_pct=Decimal("18"), behaviour={},
    )
    # creates_onward_liability + its remittance settings are what make this
    # head remittable, so the Compliance round trip below has a real
    # obligation to allocate against.
    withholding_tax = TaxHead(
        id=str(uuid.uuid4()), tax_name="TDS 194C", scope="WITHHOLDING_AT_SOURCE", tax_type="PERCENTAGE",
        applies_from=fy.start_date, rate_pct=Decimal("2"), behaviour={},
        creates_onward_liability=True, remitted_to_authority="Income Tax Department",
        remittance_period="MONTHLY", period_aligns_to="CALENDAR_MONTH",
        deposit_due_days_after_period_end=7, liability_arises_on="PAYMENT",
        authority_reference_label="Challan Number",
    )
    # The two payroll heads are what create_salary_structure turns into a
    # salary structure's statutory_lines - a DERIVED child collection, so the
    # round trip has to prove the derivation was stored, not just returned.
    pf_employee = TaxHead(
        id=str(uuid.uuid4()), tax_name="PF (Employee)", scope="PAYROLL_EMPLOYEE_DEDUCTION", tax_type="PERCENTAGE",
        applies_from=fy.start_date, rate_pct=Decimal("12"),
        behaviour={"borne_by": "EMPLOYEE", "include_in_ctc": False, "per_employee_opt_out_allowed": True},
    )
    pf_employer = TaxHead(
        id=str(uuid.uuid4()), tax_name="PF (Employer)", scope="PAYROLL_EMPLOYER_CONTRIBUTION", tax_type="PERCENTAGE",
        applies_from=fy.start_date, rate_pct=Decimal("12"),
        behaviour={"borne_by": "EMPLOYER", "include_in_ctc": True, "per_employee_opt_out_allowed": True},
    )
    health_plan = InsurancePlan(
        id=str(uuid.uuid4()), plan_name="Group Health", plan_type="HEALTH", provider="Star",
        coverage_amount=Decimal("500000"), company_contribution_monthly=Decimal("1200"),
        employee_contribution_monthly=Decimal("300"),
    )
    life_plan = InsurancePlan(
        id=str(uuid.uuid4()), plan_name="Group Term Life", plan_type="LIFE", provider="LIC",
        coverage_amount=Decimal("2000000"), company_contribution_monthly=Decimal("800"),
        employee_contribution_monthly=Decimal("0"),
    )
    state = IndianState(id=str(uuid.uuid4()), name="Karnataka", code="KA", gst_state_code="29")
    db_session.add_all([customer_status, customer, vendor, category, hsn_a, hsn_b, bank, payment_mode,
                        sales_tax, sales_tax_alt, purchase_tax, withholding_tax, pf_employee, pf_employer,
                        health_plan, life_plan, state])
    await db_session.flush()
    db_session.add(TaxHeadWithholdingDirection(id=str(uuid.uuid4()), tax_head_id=withholding_tax.id, direction="ON_PAYMENTS_MADE"))
    # The sales head is SPLIT into two named components, so an invoice's
    # derived tax_lines are themselves a child collection built from another
    # record's child collection - one more place a write can quietly lose rows.
    for seq, (name, share) in enumerate((("CGST", Decimal("50")), ("SGST", Decimal("50"))), start=1):
        db_session.add(TaxHeadSplitComponent(
            id=str(uuid.uuid4()), tax_head_id=sales_tax.id, sequence_no=seq,
            component_name=name, share_pct=share, applies_when="ALWAYS",
        ))

    department = Department(id=str(uuid.uuid4()), name="Delivery")
    designation = Designation(id=str(uuid.uuid4()), name="Consultant")
    employment_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time")
    db_session.add_all([department, designation, employment_type])
    await db_session.flush()

    employees = []
    for index in range(3):
        employee = Employee(
            id=str(uuid.uuid4()), employee_code=f"EMP-RT-{index}", code_financial_year_id=fy.id,
            first_name=f"Member{index}", last_name="Roundtrip", email=f"member{index}.roundtrip@test.local",
            department_id=department.id, designation_id=designation.id, employment_type_id=employment_type.id,
            joining_date=date(2020, 1, 1),
        )
        db_session.add(employee)
        employees.append(employee)
    await db_session.commit()

    return {
        "fy": fy, "customer": customer, "vendor": vendor, "category": category,
        "hsn_a": hsn_a, "hsn_b": hsn_b, "bank": bank, "payment_mode": payment_mode,
        "sales_tax": sales_tax, "sales_tax_alt": sales_tax_alt, "purchase_tax": purchase_tax,
        "withholding_tax": withholding_tax, "employees": employees,
        "department": department, "designation": designation, "employment_type": employment_type,
        "pf_employee": pf_employee, "pf_employer": pf_employer,
        "health_plan": health_plan, "life_plan": life_plan, "state": state,
    }


# ==========================================================================
#  2. INVOICE - line items (plus the tax lines derived from them)
# ==========================================================================
def _invoice_body(masters: dict, **overrides) -> dict:
    body = {
        "customer_id": masters["customer"].id,
        "invoice_date": date.today().isoformat(),
        "due_date": (date.today() + timedelta(days=30)).isoformat(),
        "reference": "PO-4471",
        "notes": "Three lines, two of them HSN-coded.",
        "service_category_id": masters["category"].id,
        "bank_account_id": masters["bank"].id,
        "tax_head_id": masters["sales_tax"].id,
        "line_items": [
            {"description": "Discovery workshop", "hsn_code_id": masters["hsn_a"].id, "quantity": "2", "rate": "15000.00"},
            {"description": "Implementation", "hsn_code_id": masters["hsn_b"].id, "quantity": "10", "rate": "8000.00"},
            {"description": "Travel recharge", "hsn_code_id": None, "quantity": "1", "rate": "4500.00"},
        ],
    }
    body.update(overrides)
    return body


async def test_invoice_post_then_get_returns_every_line_item_and_the_derived_tax_lines(client, masters):
    body = _invoice_body(masters)
    created = await _ok(await client.post(f"{API}/invoices", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/invoices/{created['id']}"))

    _assert_survived(body, stored, where="POST /invoices scalars", ignore=("line_items",))
    _assert_children(body["line_items"], stored["line_items"], where="invoice line_items", key="description")
    # 2 x 15000 + 10 x 8000 + 4500 = 114500, at CGST 9 + SGST 9 = two lines.
    assert Decimal(str(stored["subtotal"])) == Decimal("114500"), stored["subtotal"]
    assert len(stored["tax_lines"]) == 2, f"the head's two split components must persist as two tax lines, got {stored['tax_lines']}"
    assert {line["component_name_snapshot"] for line in stored["tax_lines"]} == {"CGST", "SGST"}
    assert sum(Decimal(str(line["computed_amount"])) for line in stored["tax_lines"]) == Decimal("20610.00")


async def test_invoice_put_changing_adding_and_removing_line_items_all_persist(client, masters):
    """One PUT that does all three things at once, because that is what an
    edit screen actually submits: a full replacement list.
    """
    body = _invoice_body(masters)
    invoice_id = (await _ok(await client.post(f"{API}/invoices", json=body), expect=201))["id"]

    edited = _invoice_body(masters, notes="Line 1 repriced, line 3 dropped, a fourth added.")
    edited["line_items"] = [
        {"description": "Discovery workshop", "hsn_code_id": masters["hsn_a"].id, "quantity": "3", "rate": "16000.00"},
        {"description": "Implementation", "hsn_code_id": masters["hsn_b"].id, "quantity": "10", "rate": "8000.00"},
        {"description": "Support retainer", "hsn_code_id": None, "quantity": "6", "rate": "2500.00"},
    ]
    await _ok(await client.put(f"{API}/invoices/{invoice_id}", json=edited))

    stored = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))
    _assert_children(edited["line_items"], stored["line_items"], where="invoice line_items after PUT", key="description")
    descriptions = {line["description"] for line in stored["line_items"]}
    assert "Travel recharge" not in descriptions, "a removed invoice line item survived the PUT"
    assert stored["notes"] == edited["notes"]
    # 3 x 16000 + 10 x 8000 + 6 x 2500 = 143000
    assert Decimal(str(stored["subtotal"])) == Decimal("143000"), stored["subtotal"]


async def test_invoice_put_swapping_the_tax_head_rebuilds_the_tax_lines(client, masters):
    """The derived child collection. A handler that recomputes tax_amount but
    leaves the old tax_lines behind produces a document whose printed
    breakdown contradicts its own total.
    """
    body = _invoice_body(masters)
    invoice_id = (await _ok(await client.post(f"{API}/invoices", json=body), expect=201))["id"]

    swapped = _invoice_body(masters, tax_head_id=masters["sales_tax_alt"].id)
    await _ok(await client.put(f"{API}/invoices/{invoice_id}", json=swapped))

    stored = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))
    assert stored["tax_head_id"] == masters["sales_tax_alt"].id
    assert len(stored["tax_lines"]) == 1, f"the two split-component lines from the old head survived: {stored['tax_lines']}"
    assert Decimal(str(stored["tax_amount"])) == Decimal("5725.00"), stored["tax_amount"]  # 114500 x 5%
    assert stored["tax_lines"][0]["head_name_snapshot"] == "GST 5 (Sales)"


async def test_invoice_put_clearing_optional_fields_persists_the_clear(client, masters):
    """Setting a field back to null is a change like any other, and the one a
    "only copy truthy values" handler silently drops.
    """
    body = _invoice_body(masters)
    invoice_id = (await _ok(await client.post(f"{API}/invoices", json=body), expect=201))["id"]

    cleared = _invoice_body(masters, reference=None, notes=None, service_category_id=None, bank_account_id=None, tax_head_id=None, due_date=None)
    await _ok(await client.put(f"{API}/invoices/{invoice_id}", json=cleared))

    stored = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))
    _assert_survived(cleared, stored, where="invoice optional fields cleared by PUT", ignore=("line_items",))
    assert stored["tax_lines"] == [], f"tax lines survived their head being cleared: {stored['tax_lines']}"
    assert Decimal(str(stored["tax_amount"])) == Decimal("0")


# REGRESSION TEST for a real bug this file found, now FIXED.
async def test_invoice_put_never_silently_discards_a_changed_invoice_date(client, masters):
    """The bug: PUT /invoices/{id} ACCEPTED a changed invoice_date, returned
    HTTP 200, and kept the old one — update_invoice assigned due_date,
    reference, notes, service_category_id, bank_account_id, subtotal,
    tax_head_id and tax_amount, but never invoice_date, and unlike customer_id
    and project_id never refused a changed one either. Exactly the Tax Head
    class of bug this file exists to catch: accepted, acknowledged, not stored.

    THE INVARIANT, which is what this asserts: an API must never take a field,
    answer 200, and quietly drop it. Either it persists or it is refused.

    This route refuses, and that is a deliberate choice rather than the easier
    one. The rest of update_invoice already treats the date as immutable:
    invoice_number embeds the FY label and was allocated from the FY current at
    creation, financial_year_id is snapshotted beside it, and the tax
    recomputation effective-dates against invoice.invoice_date rather than the
    body. A date free to cross into another financial year would leave the
    number, the snapshot and the date disagreeing, and could walk the invoice
    into or out of a locked year. Refusing keeps it consistent with how
    customer_id and project_id are already handled.
    """
    body = _invoice_body(masters)
    invoice_id = (await _ok(await client.post(f"{API}/invoices", json=body), expect=201))["id"]
    original = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))

    moved = _invoice_body(masters, invoice_date=(date.today() - timedelta(days=5)).isoformat())
    response = await client.put(f"{API}/invoices/{invoice_id}", json=moved)
    assert response.status_code == 422, (
        f"a changed invoice_date must be refused, not silently dropped — got {response.status_code}"
    )

    # And the refusal left the record untouched.
    stored = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))
    assert stored["invoice_date"] == original["invoice_date"]


async def test_invoice_put_accepts_an_unchanged_invoice_date(client, masters):
    """The guard must not break the ordinary edit: a PUT that resends the SAME
    date (which every real client does, since it round-trips the whole body)
    still succeeds. A guard that rejected those would make the screen unusable.
    """
    body = _invoice_body(masters)
    invoice_id = (await _ok(await client.post(f"{API}/invoices", json=body), expect=201))["id"]

    same = _invoice_body(masters, notes="edited, same date")
    await _ok(await client.put(f"{API}/invoices/{invoice_id}", json=same))
    stored = await _ok(await client.get(f"{API}/invoices/{invoice_id}"))
    assert stored["notes"] == "edited, same date"


# ==========================================================================
#  3. PURCHASE BILL - line items, plus the withholding configuration that
#     rides on them
# ==========================================================================
def _bill_body(masters: dict, **overrides) -> dict:
    body = {
        "vendor_id": masters["vendor"].id,
        "vendor_bill_number": "VB-9001",
        "bill_date": date.today().isoformat(),
        "due_date": (date.today() + timedelta(days=45)).isoformat(),
        "notes": "Two coded lines and one uncoded.",
        "attachment_stored_file_id": None,
        "bank_account_id": masters["bank"].id,
        "linked_expense_claim_id": None,
        "tax_head_id": masters["purchase_tax"].id,
        "tax_amount_override": None,
        "withholding_tax_head_id": masters["withholding_tax"].id,
        "withholding_calculated_on": "SUBTOTAL",
        "withholding_amount_override": None,
        "line_items": [
            {"description": "Laptops", "hsn_code_id": masters["hsn_a"].id, "quantity": "4", "rate": "60000.00"},
            {"description": "Docking stations", "hsn_code_id": masters["hsn_b"].id, "quantity": "4", "rate": "9000.00"},
            {"description": "Freight", "hsn_code_id": None, "quantity": "1", "rate": "3000.00"},
        ],
    }
    body.update(overrides)
    return body


# The two *_override fields are inputs only: PurchaseBillOut exposes the
# RESULT (tax_amount / withholding_amount) rather than echoing the override,
# so they are compared through those instead of by name.
_BILL_INPUT_ONLY = ("line_items", "tax_amount_override", "withholding_amount_override")


async def test_purchase_bill_post_then_get_returns_every_line_item_and_its_withholding_setup(client, masters):
    body = _bill_body(masters)
    created = await _ok(await client.post(f"{API}/purchase-bills", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/purchase-bills/{created['id']}"))

    _assert_survived(body, stored, where="POST /purchase-bills scalars", ignore=_BILL_INPUT_ONLY)
    _assert_children(body["line_items"], stored["line_items"], where="purchase bill line_items", key="description")
    # 4 x 60000 + 4 x 9000 + 3000 = 279000; tax 18% = 50220; TDS 2% of subtotal = 5580.
    assert Decimal(str(stored["subtotal"])) == Decimal("279000"), stored["subtotal"]
    assert Decimal(str(stored["tax_amount"])) == Decimal("50220.00"), stored["tax_amount"]
    assert Decimal(str(stored["withholding_amount"])) == Decimal("5580.00"), stored["withholding_amount"]
    assert len(stored["tax_lines"]) == 1, stored["tax_lines"]


async def test_purchase_bill_put_changing_adding_and_removing_line_items_all_persist(client, masters):
    body = _bill_body(masters)
    bill_id = (await _ok(await client.post(f"{API}/purchase-bills", json=body), expect=201))["id"]

    edited = _bill_body(masters, vendor_bill_number="VB-9001-R1", notes="Freight dropped, warranty added.")
    edited["line_items"] = [
        {"description": "Laptops", "hsn_code_id": masters["hsn_a"].id, "quantity": "5", "rate": "58000.00"},
        {"description": "Docking stations", "hsn_code_id": masters["hsn_b"].id, "quantity": "4", "rate": "9000.00"},
        {"description": "Extended warranty", "hsn_code_id": None, "quantity": "5", "rate": "4000.00"},
    ]
    await _ok(await client.put(f"{API}/purchase-bills/{bill_id}", json=edited))

    stored = await _ok(await client.get(f"{API}/purchase-bills/{bill_id}"))
    _assert_children(edited["line_items"], stored["line_items"], where="purchase bill line_items after PUT", key="description")
    assert "Freight" not in {line["description"] for line in stored["line_items"]}, "a removed bill line item survived the PUT"
    assert stored["vendor_bill_number"] == "VB-9001-R1"
    # 5 x 58000 + 4 x 9000 + 5 x 4000 = 346000
    assert Decimal(str(stored["subtotal"])) == Decimal("346000"), stored["subtotal"]
    assert Decimal(str(stored["withholding_amount"])) == Decimal("6920.00"), stored["withholding_amount"]


async def test_purchase_bill_put_clearing_the_withholding_head_removes_the_deduction(client, masters):
    """Withholding is a three-field cluster (head, basis, amount). Clearing the
    head must clear the figure with it, not leave a deduction nothing explains.
    """
    body = _bill_body(masters)
    bill_id = (await _ok(await client.post(f"{API}/purchase-bills", json=body), expect=201))["id"]

    cleared = _bill_body(masters, withholding_tax_head_id=None, withholding_calculated_on=None, notes=None, bank_account_id=None)
    await _ok(await client.put(f"{API}/purchase-bills/{bill_id}", json=cleared))

    stored = await _ok(await client.get(f"{API}/purchase-bills/{bill_id}"))
    _assert_survived(cleared, stored, where="purchase bill fields cleared by PUT", ignore=_BILL_INPUT_ONLY)
    assert Decimal(str(stored["withholding_amount"])) == Decimal("0"), stored["withholding_amount"]
    assert stored["withholding_head_name_snapshot"] is None


# ==========================================================================
#  4. CREDIT NOTE - line items derived from the invoice lines it credits
# ==========================================================================
async def _part_paid_invoice(client, masters) -> dict:
    """A Credit Note may only be raised against a Paid or Part-Paid invoice,
    so the round trip needs a real invoice that has actually been sent and
    part-settled first.
    """
    invoice = await _ok(await client.post(f"{API}/invoices", json=_invoice_body(masters)), expect=201)
    await _ok(await client.post(f"{API}/invoices/{invoice['id']}/send"))
    await _ok(
        await client.post(
            f"{API}/invoices/{invoice['id']}/payments",
            json={"amount_received": "50000.00", "payment_mode_id": masters["payment_mode"].id, "payment_date": date.today().isoformat()},
        ),
        expect=201,
    )
    return await _ok(await client.get(f"{API}/invoices/{invoice['id']}"))


async def test_credit_note_post_then_get_returns_a_line_for_every_affected_invoice_line(client, masters):
    invoice = await _part_paid_invoice(client, masters)
    affected = [line["id"] for line in invoice["line_items"] if line["description"] != "Travel recharge"]

    body = {
        "invoice_id": invoice["id"],
        "reason": "BILLING_ERROR",
        "reason_detail": "Workshop and implementation both over-billed by a day.",
        "credit_amount": "12000.00",
        "line_items_affected": affected,
    }
    created = await _ok(await client.post(f"{API}/credit-notes", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/credit-notes/{created['id']}"))
    _assert_survived(body, stored, where="POST /credit-notes scalars", ignore=("line_items_affected",))
    assert sorted(line["invoice_line_item_id"] for line in stored["line_items"]) == sorted(affected), (
        f"credit note child lines do not match the invoice lines sent: {stored['line_items']}"
    )
    assert sum(Decimal(str(line["credited_amount"])) for line in stored["line_items"]) == Decimal("12000.00")


async def test_credit_note_put_narrowing_the_affected_lines_removes_the_dropped_child_row(client, masters):
    invoice = await _part_paid_invoice(client, masters)
    all_lines = [line["id"] for line in invoice["line_items"]]

    body = {
        "invoice_id": invoice["id"],
        "reason": "BILLING_ERROR",
        "reason_detail": "All three lines credited.",
        "credit_amount": "9000.00",
        "line_items_affected": all_lines,
    }
    credit_note_id = (await _ok(await client.post(f"{API}/credit-notes", json=body), expect=201))["id"]
    assert len((await _ok(await client.get(f"{API}/credit-notes/{credit_note_id}")))["line_items"]) == 3

    narrowed = dict(body, reason="CUSTOMER_DISPUTE", reason_detail="Only the travel recharge is disputed.",
                    credit_amount="4500.00", line_items_affected=all_lines[-1:])
    await _ok(await client.put(f"{API}/credit-notes/{credit_note_id}", json=narrowed))

    stored = await _ok(await client.get(f"{API}/credit-notes/{credit_note_id}"))
    _assert_survived(narrowed, stored, where="credit note scalars after PUT", ignore=("line_items_affected",))
    assert [line["invoice_line_item_id"] for line in stored["line_items"]] == all_lines[-1:], (
        f"the two dropped credit-note lines survived: {stored['line_items']}"
    )


# ==========================================================================
#  5. PROJECT - member_ids, a join-table child collection behind a plain list
# ==========================================================================
def _project_body(masters: dict, **overrides) -> dict:
    employees = masters["employees"]
    body = {
        "project_name": "Roundtrip Platform Build",
        "customer_id": masters["customer"].id,
        "opportunity_id": None,
        "status": "IN_PROGRESS",
        "start_date": date(2026, 4, 1).isoformat(),
        "end_date": date(2026, 12, 31).isoformat(),
        "budget": "4500000.00",
        "description": "Every optional field populated so none of them can pass by defaulting.",
        "project_lead_id": employees[0].id,
        "member_ids": [employees[0].id, employees[1].id],
    }
    body.update(overrides)
    return body


async def test_project_post_then_get_returns_every_field_and_every_member(client, masters):
    body = _project_body(masters)
    created = await _ok(await client.post(f"{API}/projects", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/projects/{created['id']}"))
    _assert_survived(body, stored, where="POST /projects scalars", ignore=("member_ids",))
    assert sorted(stored["member_ids"]) == sorted(body["member_ids"]), (
        f"project members lost. Sent {body['member_ids']}, read back {stored['member_ids']}"
    )


async def test_project_put_adding_and_removing_members_persists_both_halves(client, masters):
    """update_project reconciles the membership rows by difference rather than
    replacing them, so add and remove are two distinct code paths and both
    need proving in the same PUT.
    """
    employees = masters["employees"]
    body = _project_body(masters)
    project_id = (await _ok(await client.post(f"{API}/projects", json=body), expect=201))["id"]

    # Drop employees[1], keep employees[0], add employees[2].
    edited = _project_body(masters, member_ids=[employees[0].id, employees[2].id], budget="5100000.00", status="ON_HOLD")
    await _ok(await client.put(f"{API}/projects/{project_id}", json=edited))

    stored = await _ok(await client.get(f"{API}/projects/{project_id}"))
    assert sorted(stored["member_ids"]) == sorted([employees[0].id, employees[2].id]), (
        f"membership PUT did not round-trip. Sent {edited['member_ids']}, read back {stored['member_ids']}"
    )
    assert employees[1].id not in stored["member_ids"], "a removed project member survived the PUT"
    _assert_survived(edited, stored, where="project scalars after PUT", ignore=("member_ids",))


async def test_project_put_emptying_the_member_list_leaves_no_members(client, masters):
    body = _project_body(masters)
    project_id = (await _ok(await client.post(f"{API}/projects", json=body), expect=201))["id"]

    await _ok(await client.put(f"{API}/projects/{project_id}", json=_project_body(masters, member_ids=[])))

    stored = await _ok(await client.get(f"{API}/projects/{project_id}"))
    assert stored["member_ids"] == [], f"members survived being emptied: {stored['member_ids']}"


async def test_project_task_subtasks_and_comments_survive_and_a_status_move_does_not_drop_them(client, masters):
    """A Task carries two child collections of its own (subtasks, comments),
    both appended through their own endpoints. The narrow status-only PUT is
    the interesting case: TaskStatusUpdate exists precisely so a board drag
    does not wipe the rest of the record, and this is what proves it.
    """
    project_id = (await _ok(await client.post(f"{API}/projects", json=_project_body(masters)), expect=201))["id"]
    task_body = {
        "title": "Wire the importer", "description": "Nested round-trip subject",
        "assignee_id": masters["employees"][1].id, "due_date": date(2026, 6, 30).isoformat(),
        "status": "TODO", "priority": "HIGH", "sprint_id": None,
    }
    task = await _ok(await client.post(f"{API}/projects/{project_id}/tasks", json=task_body), expect=201)

    for text in ("Read the spec", "Write the parser", "Add fixtures"):
        await _ok(await client.post(f"{API}/tasks/{task['id']}/subtasks", json={"text": text}), expect=201)
    await _ok(await client.post(f"{API}/tasks/{task['id']}/comments", json={"content": "Blocked on the sample file."}), expect=201)

    tasks = await _ok(await client.get(f"{API}/projects/{project_id}/tasks"))
    stored = next(t for t in tasks if t["id"] == task["id"])
    _assert_survived(task_body, stored, where="task scalars")
    assert [s["text"] for s in stored["subtasks"]] == ["Read the spec", "Write the parser", "Add fixtures"], stored["subtasks"]
    assert [c["content"] for c in stored["comments"]] == ["Blocked on the sample file."], stored["comments"]

    await _ok(await client.put(f"{API}/tasks/{task['id']}/status", json={"status": "IN_REVIEW"}))

    tasks = await _ok(await client.get(f"{API}/projects/{project_id}/tasks"))
    stored = next(t for t in tasks if t["id"] == task["id"])
    assert stored["status"] == "IN_REVIEW"
    assert len(stored["subtasks"]) == 3, f"a status-only move dropped the subtasks: {stored['subtasks']}"
    assert len(stored["comments"]) == 1, f"a status-only move dropped the comments: {stored['comments']}"
    _assert_survived(dict(task_body, status="IN_REVIEW"), stored, where="task scalars after a status-only PUT")


# ==========================================================================
#  6. OPPORTUNITY - named by the prompt; its write schema turned out to carry
#     NO child collection (activities and files are separate append-only
#     sub-resources), so this is the full-field scalar round trip plus a
#     round trip on the activity sub-collection.
# ==========================================================================
def _opportunity_body(masters: dict, **overrides) -> dict:
    body = {
        "title": "Platform modernisation",
        "customer_id": masters["customer"].id,
        "value": "2750000.00",
        "stage": "PROPOSAL",
        "probability_pct": "45",
        "expected_close_date": date(2026, 9, 30).isoformat(),
        "description": "Every optional field populated on purpose.",
        "owner_id": masters["employees"][0].id,
        "lost_reason": None,
    }
    body.update(overrides)
    return body


async def test_opportunity_post_then_get_returns_every_field(client, masters):
    body = _opportunity_body(masters)
    created = await _ok(await client.post(f"{API}/opportunities", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/opportunities/{created['id']}"))
    _assert_survived(body, stored, where="POST /opportunities")


async def test_opportunity_put_changing_every_field_persists_including_the_lost_reason(client, masters):
    body = _opportunity_body(masters)
    opportunity_id = (await _ok(await client.post(f"{API}/opportunities", json=body), expect=201))["id"]

    edited = _opportunity_body(
        masters, title="Platform modernisation (phase 2)", value="3900000.00", stage="LOST",
        probability_pct="0", expected_close_date=date(2026, 11, 15).isoformat(),
        description="Revised after the second workshop.", owner_id=masters["employees"][2].id,
        lost_reason="Lost on price to an incumbent.",
    )
    await _ok(await client.put(f"{API}/opportunities/{opportunity_id}", json=edited))

    stored = await _ok(await client.get(f"{API}/opportunities/{opportunity_id}"))
    _assert_survived(edited, stored, where="PUT /opportunities")


async def test_opportunity_activities_round_trip_through_their_own_collection(client, masters):
    opportunity_id = (await _ok(await client.post(f"{API}/opportunities", json=_opportunity_body(masters)), expect=201))["id"]
    activities = [
        {"activity_type": "CALL", "activity_date": date(2026, 5, 4).isoformat(), "description": "Discovery call with the CTO", "related_contact_id": None},
        {"activity_type": "MEETING", "activity_date": date(2026, 5, 11).isoformat(), "description": "On-site workshop", "related_contact_id": None},
    ]
    for activity in activities:
        await _ok(await client.post(f"{API}/opportunities/{opportunity_id}/activities", json=activity), expect=201)

    stored = await _ok(await client.get(f"{API}/opportunities/{opportunity_id}/activities"))
    _assert_children(activities, stored, where="opportunity activities", key="description")


# ==========================================================================
#  7. EMPLOYEE COMPENSATION - salary structure statutory lines (derived) and
#     insurance enrollment dependents / nominees (caller-supplied)
# ==========================================================================
def _salary_body(**overrides) -> dict:
    body = {
        "effective_from": date(2026, 4, 1).isoformat(),
        "change_note": "Annual revision",
        "basic_salary_monthly": "50000.00",
        "dearness_allowance_monthly": "10000.00",
        "hra_monthly": "20000.00",
        "lta_amount": "0.00",
        "lta_payout_basis": "MONTHLY",
        "special_allowance_monthly": "5000.00",
        "other_earnings_monthly": "0.00",
        "variable_pay_amount": "120000.00",
        "variable_pay_frequency": "ANNUAL",
        "wage_code_override_reason": None,
    }
    body.update(overrides)
    return body


async def test_salary_structure_post_then_get_returns_its_derived_statutory_lines(client, masters):
    employee = masters["employees"][0]
    body = _salary_body()
    await _ok(await client.post(f"{API}/employees/{employee.id}/salary-structures", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/employees/{employee.id}/salary-structures/current"))
    _assert_survived(body, stored, where="POST salary-structures scalars")
    # gross = 50000 + 10000 + 20000 + 5000 = 85000; each PF head is 12% = 10200.
    assert Decimal(str(stored["gross_monthly"])) == Decimal("85000.00"), stored["gross_monthly"]
    names = {line["head_name_snapshot"] for line in stored["statutory_lines"]}
    assert names == {"PF (Employee)", "PF (Employer)"}, f"statutory lines lost between the write and the store: {stored['statutory_lines']}"
    for line in stored["statutory_lines"]:
        assert Decimal(str(line["computed_amount_monthly"])) == Decimal("10200.00"), line
        assert line["is_applicable"] is True


async def test_salary_structure_applicability_put_changes_one_line_and_leaves_the_other_alone(client, masters):
    """The narrowest possible child-row edit: one flag on one line. It must
    persist AND its sibling must be untouched - the same "changing one child
    collection must not disturb the others" rule the Tax Head bug broke.
    """
    employee = masters["employees"][0]
    created = await _ok(
        await client.post(f"{API}/employees/{employee.id}/salary-structures", json=_salary_body()), expect=201
    )
    target = next(line for line in created["statutory_lines"] if line["head_name_snapshot"] == "PF (Employee)")
    sibling = next(line for line in created["statutory_lines"] if line["head_name_snapshot"] == "PF (Employer)")

    await _ok(
        await client.put(
            f"{API}/employees/{employee.id}/salary-structures/{created['id']}/lines/{target['id']}/applicability",
            json={"is_applicable": False},
        )
    )

    stored = await _ok(await client.get(f"{API}/employees/{employee.id}/salary-structures/current"))
    by_id = {line["id"]: line for line in stored["statutory_lines"]}
    assert len(by_id) == 2, f"an applicability edit changed the number of statutory lines: {stored['statutory_lines']}"
    assert by_id[target["id"]]["is_applicable"] is False, "the opt-out did not persist"
    _assert_survived(sibling, by_id[sibling["id"]], where="the untouched sibling statutory line")


async def test_insurance_enrollment_post_then_get_returns_every_dependent(client, masters):
    employee = masters["employees"][0]
    body = {
        "insurance_plan_id": masters["health_plan"].id,
        "enrollment_date": date(2026, 4, 1).isoformat(),
        "dependents": [
            {"dependent_name": "Asha Roundtrip", "relationship": "SPOUSE", "display_order": 1},
            {"dependent_name": "Ravi Roundtrip", "relationship": "CHILD", "display_order": 2},
            {"dependent_name": "Latha Roundtrip", "relationship": "PARENT", "display_order": 3},
        ],
        "nominees": [],
    }
    await _ok(await client.post(f"{API}/employees/{employee.id}/insurance-enrollments", json=body), expect=201)

    enrollments = await _ok(await client.get(f"{API}/employees/{employee.id}/insurance-enrollments"))
    assert len(enrollments) == 1
    stored = enrollments[0]
    _assert_survived(body, stored, where="insurance enrollment scalars", ignore=("dependents", "nominees"))
    _assert_children(body["dependents"], stored["dependents"], where="insurance dependents", key="dependent_name")


async def test_insurance_enrollment_post_then_get_returns_every_nominee(client, masters):
    employee = masters["employees"][1]
    body = {
        "insurance_plan_id": masters["life_plan"].id,
        "enrollment_date": date(2026, 4, 1).isoformat(),
        "dependents": [],
        "nominees": [
            {"nominee_name": "Asha Roundtrip", "relationship": "SPOUSE", "contact_phone": "9876543210", "is_primary": True},
            {"nominee_name": "Ravi Roundtrip", "relationship": "CHILD", "contact_phone": None, "is_primary": False},
        ],
    }
    await _ok(await client.post(f"{API}/employees/{employee.id}/insurance-enrollments", json=body), expect=201)

    stored = (await _ok(await client.get(f"{API}/employees/{employee.id}/insurance-enrollments")))[0]
    _assert_children(body["nominees"], stored["nominees"], where="insurance nominees", key="nominee_name")


async def test_adding_a_dependent_later_does_not_disturb_the_ones_already_stored(client, masters):
    """Appending to one child collection through its own endpoint - the other
    way a nested write can go wrong, by replacing where it meant to add.
    """
    employee = masters["employees"][2]
    body = {
        "insurance_plan_id": masters["health_plan"].id,
        "enrollment_date": date(2026, 4, 1).isoformat(),
        "dependents": [{"dependent_name": "Asha Roundtrip", "relationship": "SPOUSE", "display_order": 1}],
        "nominees": [],
    }
    enrollment = await _ok(await client.post(f"{API}/employees/{employee.id}/insurance-enrollments", json=body), expect=201)

    added = {"dependent_name": "Ravi Roundtrip", "relationship": "CHILD", "display_order": 2}
    await _ok(
        await client.post(f"{API}/employees/{employee.id}/insurance-enrollments/{enrollment['id']}/dependents", json=added),
        expect=201,
    )

    stored = (await _ok(await client.get(f"{API}/employees/{employee.id}/insurance-enrollments")))[0]
    _assert_children(body["dependents"] + [added], stored["dependents"], where="insurance dependents after an append", key="dependent_name")


# ==========================================================================
#  8. COMPANY PROFILE - the singleton, plus the two child collections that
#     hang off the same screen (addresses, number prefix rules)
# ==========================================================================
def _profile_body(masters: dict, **overrides) -> dict:
    body = {
        "legal_name": "Meshrd Technologies Private Limited",
        "cin": "U72900KA2020PTC000001",
        "tan": "BLRM12345F",
        "gstin": "29ABCDE1234F1Z5",
        "pan": "ABCDE1234F",
        "company_type": "PRIVATE_LIMITED",
        "year_of_incorporation": 2020,
        "industry": "Information Technology",
        "msme_registration_number": "UDYAM-KA-03-0000001",
        "phone": "9876543210",
        "alternate_phone": "9876500000",
        "official_email": "hello@meshrd.test",
        "support_email": "support@meshrd.test",
        "website": "https://meshrd.test",
        "logo_file_id": None,
        "letterhead_file_id": None,
        "default_billing_tax_head_id": masters["sales_tax"].id,
        "payroll_basis": "HOUR_BASIS",
    }
    body.update(overrides)
    return body


async def test_company_profile_post_then_get_returns_every_field(client, masters):
    body = _profile_body(masters)
    await _ok(await client.post(f"{API}/masters/company-profile", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/masters/company-profile"))
    _assert_survived(body, stored, where="POST /masters/company-profile")


async def test_company_profile_put_changes_every_field_and_clears_the_optional_ones(client, masters):
    await _ok(await client.post(f"{API}/masters/company-profile", json=_profile_body(masters)), expect=201)

    edited = _profile_body(
        masters, legal_name="Meshrd Technologies Limited", tan=None, gstin=None, company_type="PUBLIC_LIMITED",
        year_of_incorporation=2021, industry=None, msme_registration_number=None, phone="9000000001",
        alternate_phone=None, official_email="contact@meshrd.test", support_email=None, website=None,
        default_billing_tax_head_id=None,
    )
    await _ok(await client.put(f"{API}/masters/company-profile", json=edited))

    stored = await _ok(await client.get(f"{API}/masters/company-profile"))
    _assert_survived(edited, stored, where="PUT /masters/company-profile")


async def test_company_addresses_round_trip_and_an_edit_touches_only_its_own_row(client, masters):
    await _ok(await client.post(f"{API}/masters/company-profile", json=_profile_body(masters)), expect=201)
    addresses = [
        {"address_type": "REGISTERED_OFFICE", "line1": "12 Test Road", "line2": "Level 4", "city": "Bengaluru", "state_id": masters["state"].id, "pin_code": "560001"},
        {"address_type": "BRANCH_OFFICE", "line1": "88 Other Street", "line2": None, "city": "Mysuru", "state_id": masters["state"].id, "pin_code": "570001"},
    ]
    created = [await _ok(await client.post(f"{API}/masters/company-profile/addresses", json=a), expect=201) for a in addresses]

    stored = await _ok(await client.get(f"{API}/masters/company-profile/addresses"))
    _assert_children(addresses, stored, where="company addresses", key="line1")

    edited = {"address_type": "CORRESPONDENCE", "line1": "12 Test Road", "line2": None, "city": "Bengaluru Urban", "state_id": masters["state"].id, "pin_code": "560002"}
    await _ok(await client.put(f"{API}/masters/company-profile/addresses/{created[0]['id']}", json=edited))

    stored = await _ok(await client.get(f"{API}/masters/company-profile/addresses"))
    by_id = {row["id"]: row for row in stored}
    _assert_survived(edited, by_id[created[0]["id"]], where="the edited company address")
    _assert_survived(addresses[1], by_id[created[1]["id"]], where="the company address that was NOT edited")


async def test_number_prefix_rule_round_trips_through_post_and_put(client, masters):
    body = {
        "code_type": "RTX", "label": "Roundtrip Code", "prefix": "RTX", "include_fy_in_code": True,
        "running_number_digits": 5, "starting_number": 100, "resets_every_fy": True,
    }
    await _ok(await client.post(f"{API}/masters/company-profile/number-prefix-rules", json=body), expect=201)

    stored = next(r for r in await _ok(await client.get(f"{API}/masters/company-profile/number-prefix-rules")) if r["code_type"] == "RTX")
    _assert_survived(body, stored, where="POST number-prefix-rules")

    edited = {"prefix": "RTZ", "include_fy_in_code": False, "running_number_digits": 3, "starting_number": 250, "resets_every_fy": False}
    await _ok(await client.put(f"{API}/masters/company-profile/number-prefix-rules/RTX", json=edited))

    stored = next(r for r in await _ok(await client.get(f"{API}/masters/company-profile/number-prefix-rules")) if r["code_type"] == "RTX")
    _assert_survived(edited, stored, where="PUT number-prefix-rules")


# ==========================================================================
#  9. WORK WEEK POLICY - named by the prompt. Its write schema turned out to
#     carry NO child collection; what it does have is a DERIVED field
#     (net_working_hours_per_day) and two sibling collections on the same
#     screen (Saturday overrides, Pay Cycle), all covered here.
# ==========================================================================
def _policy_body(**overrides) -> dict:
    body = {
        "policy_name": "Standard 5-Day",
        "applies_to": "COMPANY_WIDE",
        "department_id": None,
        "designation_id": None,
        "employment_type_id": None,
        "effective_from": date(2026, 4, 1).isoformat(),
        "gross_hours_per_day": "9.00",
        "unpaid_break_hours": "1.00",
        "grace_window_minutes": 15,
        "half_day_threshold_hours": "4.00",
        "count_overtime_beyond_net": True,
        "weekly_hour_target": "40.00",
        "weekly_off_days": "SUN_ALT_SAT",
        "saturday_rule": "ODD_WORKING",
        "working_saturday_hours_mode": "CUSTOM",
        "custom_saturday_hours": "4.00",
        "mandatory_holiday_overrides_saturday": True,
        "allow_compensatory_hours": True,
        "compensation_window_days": 30,
        "make_up_day_chosen_by": "EMPLOYEE_WITH_APPROVAL",
        "allow_makeup_on_week_off": True,
        "allow_makeup_on_mandatory_holiday": False,
        "max_comp_hours_per_month": "8.00",
        "uncompensated_shortfall_becomes": "PRO_RATA_LOP",
        "excess_hours_become": "COMP_CREDIT",
    }
    body.update(overrides)
    return body


async def _get_policy(client: AsyncClient, policy_id: str) -> dict:
    """No GET /masters/work-week-policies/{id} exists - the list is the re-read."""
    policies = await _ok(await client.get(f"{API}/masters/work-week-policies"))
    match = [p for p in policies if p["id"] == policy_id]
    assert match, f"work week policy {policy_id} vanished from its own list"
    return match[0]


async def test_work_week_policy_post_then_get_returns_every_field_and_the_derived_net_hours(client, masters):
    body = _policy_body(is_active=True)
    created = await _ok(await client.post(f"{API}/masters/work-week-policies", json=body), expect=201)

    stored = await _get_policy(client, created["id"])
    _assert_survived(body, stored, where="POST /masters/work-week-policies")
    assert Decimal(str(stored["net_working_hours_per_day"])) == Decimal("8.00"), (
        f"Net Working Hours is derived (9.00 gross - 1.00 break), read back {stored['net_working_hours_per_day']}"
    )


async def test_work_week_policy_put_persists_every_change_and_recomputes_the_derived_field(client, masters):
    created = await _ok(await client.post(f"{API}/masters/work-week-policies", json=_policy_body(is_active=True)), expect=201)

    # is_active is deliberately absent from WorkWeekPolicyWrite (the PUT body)
    # - it moves only through the dedicated activate/deactivate actions.
    edited = _policy_body(
        policy_name="Standard 6-Day Support", applies_to="DEPARTMENT", department_id=masters["department"].id,
        gross_hours_per_day="10.00", unpaid_break_hours="1.50", grace_window_minutes=5,
        half_day_threshold_hours="5.00", count_overtime_beyond_net=False, weekly_hour_target="48.00",
        weekly_off_days="SUNDAY", saturday_rule="ALL_WORKING", working_saturday_hours_mode="FULL",
        custom_saturday_hours=None, mandatory_holiday_overrides_saturday=False, allow_compensatory_hours=False,
        compensation_window_days=None, make_up_day_chosen_by=None, allow_makeup_on_week_off=False,
        allow_makeup_on_mandatory_holiday=True, max_comp_hours_per_month="0.00",
        uncompensated_shortfall_becomes="ROUND_HALF_DAY", excess_hours_become=None,
    )
    await _ok(await client.put(f"{API}/masters/work-week-policies/{created['id']}", json=edited))

    stored = await _get_policy(client, created["id"])
    _assert_survived(edited, stored, where="PUT /masters/work-week-policies")
    assert Decimal(str(stored["net_working_hours_per_day"])) == Decimal("8.50"), (
        f"Net Working Hours did not follow its inputs (10.00 - 1.50), read back {stored['net_working_hours_per_day']}"
    )


async def test_saturday_override_round_trips_with_its_derived_pattern(client, masters):
    policy = await _ok(await client.post(f"{API}/masters/work-week-policies", json=_policy_body(is_active=True)), expect=201)
    body = {
        "saturday_date": "2026-04-11",  # the 2nd Saturday of April 2026 - even, so ODD_WORKING says WEEK_OFF
        "financial_year_id": masters["fy"].id,
        "work_week_policy_id": policy["id"],
        "override_to": "WORKING",
        "hours_required": "4.00",
        "reason": "Quarter-end close",
        "notify_affected_employees": True,
    }
    await _ok(await client.post(f"{API}/masters/work-week-policies/saturday-overrides", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/masters/work-week-policies/saturday-overrides"))
    _assert_children([body], stored, where="saturday overrides", key="saturday_date")
    assert stored[0]["pattern_says"] == "WEEK_OFF", (
        f"the derived pattern_says was not stored: {stored[0]['pattern_says']}"
    )


async def test_pay_cycle_round_trips_and_the_replaced_row_stays_readable(client, masters):
    """A POST here REPLACES which row is active rather than editing one, so the
    round trip has to show both: the new settings stored, and the superseded
    row still on file rather than silently dropped.
    """
    first = {"cycle_type": "FIXED_CYCLE", "start_day": 26, "end_day": 25, "salary_credit_day": 1, "effective_from": "2026-04-01"}
    await _ok(await client.post(f"{API}/masters/pay-cycles", json=first), expect=201)

    stored = await _ok(await client.get(f"{API}/masters/pay-cycles"))
    _assert_children([first], stored, where="pay cycle", key="effective_from")
    assert stored[0]["is_active"] is True

    second = {"cycle_type": "CALENDAR_MONTH", "start_day": None, "end_day": None, "salary_credit_day": 5, "effective_from": "2026-10-01"}
    await _ok(await client.post(f"{API}/masters/pay-cycles", json=second), expect=201)

    stored = await _ok(await client.get(f"{API}/masters/pay-cycles"))
    by_date = {row["effective_from"]: row for row in stored}
    assert set(by_date) == {"2026-04-01", "2026-10-01"}, f"the superseded pay cycle was lost: {stored}"
    _assert_survived(second, by_date["2026-10-01"], where="the new pay cycle")
    _assert_survived(first, by_date["2026-04-01"], where="the superseded pay cycle")
    assert by_date["2026-10-01"]["is_active"] is True and by_date["2026-04-01"]["is_active"] is False


# ==========================================================================
#  10. PAYROLL RUN - `employees`, a derived child row per person in the run,
#      each carrying the figures that become that person's payslip
# ==========================================================================
async def _payroll_ready(client, masters, employee_count: int = 2) -> list:
    """A run needs an active Pay Cycle, a company-wide Work Week policy for
    the working-days derivation, and a salary structure per employee.
    """
    await _ok(await client.post(f"{API}/masters/work-week-policies", json=_policy_body(is_active=True)), expect=201)
    await _ok(
        await client.post(
            f"{API}/masters/pay-cycles",
            json={"cycle_type": "CALENDAR_MONTH", "start_day": None, "end_day": None, "salary_credit_day": 1, "effective_from": "2026-04-01"},
        ),
        expect=201,
    )
    chosen = masters["employees"][:employee_count]
    for employee in chosen:
        await _ok(await client.post(f"{API}/employees/{employee.id}/salary-structures", json=_salary_body()), expect=201)
    return chosen


async def test_payroll_run_post_then_get_returns_a_child_row_for_every_selected_employee(client, masters):
    chosen = await _payroll_ready(client, masters)
    body = {
        "period_month": 5, "period_year": 2026, "employee_selection_mode": "SPECIFIC_EMPLOYEES",
        "employee_ids": [e.id for e in chosen], "working_days_override": "20",
    }
    created = await _ok(await client.post(f"{API}/payroll/runs", json=body), expect=201)

    stored = await _ok(await client.get(f"{API}/payroll/runs/{created['id']}"))
    _assert_survived(body, stored, where="POST /payroll/runs scalars", ignore=("employee_ids",))
    assert sorted(row["employee_id"] for row in stored["employees"]) == sorted(e.id for e in chosen), (
        f"payroll run employee rows lost between the write and the store: {stored['employees']}"
    )
    assert stored["employee_count"] == len(chosen)
    for row in stored["employees"]:
        # gross = 50000 + 10000 + 20000 + 5000, from each employee's structure.
        assert Decimal(str(row["gross_monthly_snapshot"])) == Decimal("85000.00"), row
        assert Decimal(str(row["working_days"])) == Decimal("20.00"), (
            f"the run's working_days_override did not reach its employee rows: {row['working_days']}"
        )


async def test_payroll_run_recalculate_keeps_every_employee_row_and_its_figures(client, masters):
    """Recalculate rebuilds the child rows from scratch. A rebuild that drops
    an employee, or duplicates one, is exactly the silent data loss this file
    exists to catch - and the run's own totals would still look plausible.
    """
    chosen = await _payroll_ready(client, masters)
    created = await _ok(
        await client.post(
            f"{API}/payroll/runs",
            json={"period_month": 5, "period_year": 2026, "employee_selection_mode": "SPECIFIC_EMPLOYEES",
                  "employee_ids": [e.id for e in chosen], "working_days_override": "20"},
        ),
        expect=201,
    )
    before = {row["employee_id"]: row for row in (await _ok(await client.get(f"{API}/payroll/runs/{created['id']}")))["employees"]}

    await _ok(await client.post(f"{API}/payroll/runs/{created['id']}/recalculate"))

    stored = await _ok(await client.get(f"{API}/payroll/runs/{created['id']}"))
    after = {row["employee_id"]: row for row in stored["employees"]}
    assert set(after) == set(before), f"recalculate changed which employees are in the run: {sorted(after)} vs {sorted(before)}"
    for employee_id, row in before.items():
        for field in ("gross_pay", "total_earnings", "total_deductions", "net_pay", "working_days"):
            assert _same(row[field], after[employee_id][field]), (
                f"recalculate moved {field} for {employee_id}: {row[field]} -> {after[employee_id][field]}"
            )


async def test_payroll_run_confirm_keeps_the_employee_rows_readable(client, masters):
    """Confirming freezes the run. The child rows are the payslip source, so
    they must still read back after the status move, not be consumed by it.
    """
    chosen = await _payroll_ready(client, masters, employee_count=1)
    created = await _ok(
        await client.post(
            f"{API}/payroll/runs",
            json={"period_month": 5, "period_year": 2026, "employee_selection_mode": "SPECIFIC_EMPLOYEES",
                  "employee_ids": [chosen[0].id], "working_days_override": "20"},
        ),
        expect=201,
    )
    before = (await _ok(await client.get(f"{API}/payroll/runs/{created['id']}")))["employees"][0]

    await _ok(await client.post(f"{API}/payroll/runs/{created['id']}/confirm"))

    stored = await _ok(await client.get(f"{API}/payroll/runs/{created['id']}"))
    assert stored["status"] != "DRAFT"
    assert len(stored["employees"]) == 1, f"confirming the run lost its employee rows: {stored['employees']}"
    # `status` is the one field confirm is SUPPOSED to move, so it is not part
    # of "nothing else was lost" - whether it moves correctly is a separate
    # question, owned by tests/api/test_payroll_flow.py.
    _assert_survived(before, stored["employees"][0], where="payroll run employee row after confirm", ignore=("status",))


# ==========================================================================
#  11. COMPLIANCE REMITTANCE - documents_covered, a caller-supplied
#      allocation collection. Not on the prompt's own list, but it is a
#      nested write of exactly the same shape, and a lost allocation row is
#      money the register believes is still unremitted.
# ==========================================================================
async def _outstanding_withheld_document(client, masters, db_session) -> tuple[dict, date, date]:
    """A purchase bill with withholding, actually paid, so a real obligation
    exists to allocate against. Returns the eligible document plus the
    calendar-month bounds the head's MONTHLY / CALENDAR_MONTH settings put it in.
    """
    bill = await _ok(await client.post(f"{API}/purchase-bills", json=_bill_body(masters)), expect=201)
    # create_purchase_bill's vendor rollup UPDATE expires the vendor row's
    # OTHER Computed columns, which record_payment then reads - an implicit
    # lazy-load raises MissingGreenlet under AsyncSession. Refreshing here is
    # the same workaround tests/test_purchase_bill_toggles.py documents; it
    # is an artefact of this suite sharing ONE session across requests, not
    # of the endpoint (a real request gets a fresh session and a full SELECT).
    vendor = await db_session.get(Vendor, masters["vendor"].id)
    await db_session.refresh(vendor)
    await _ok(
        await client.post(
            f"{API}/purchase-bills/{bill['id']}/payments",
            json={"amount": "100000.00", "payment_mode_id": masters["payment_mode"].id, "payment_date": date.today().isoformat()},
        ),
        expect=201,
    )
    today = date.today()
    period_from = today.replace(day=1)
    period_to = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    documents = await _ok(
        await client.get(
            f"{API}/compliance/remittances/documents-in-period",
            params={"tax_head_id": masters["withholding_tax"].id, "period_from": period_from.isoformat(), "period_to": period_to.isoformat()},
        )
    )
    assert documents, "no eligible withheld document — the remittance round trip below would be vacuous"
    return documents[0], period_from, period_to


async def test_remittance_post_then_get_returns_every_allocation_it_was_given(client, masters, db_session):
    document, period_from, period_to = await _outstanding_withheld_document(client, masters, db_session)
    body = {
        "tax_head_id": masters["withholding_tax"].id,
        "period_from": period_from.isoformat(),
        "period_to": period_to.isoformat(),
        "amount_remitted": document["outstanding"],
        "paid_on": date.today().isoformat(),
        "paid_from_bank_account_id": masters["bank"].id,
        "payment_mode_id": masters["payment_mode"].id,
        "authority_reference": "CHLN-0001",
        "receipt_file_id": None,
        "notes": "Full month remitted in one challan.",
        "documents_covered": [{"source_type": document["source_type"], "source_id": document["source_id"], "amount": document["outstanding"]}],
    }
    created = await _ok(await client.post(f"{API}/compliance/remittances", json=body), expect=201)

    stored = next(r for r in await _ok(await client.get(f"{API}/compliance/remittances")) if r["id"] == created["id"])
    _assert_survived(body, stored, where="POST /compliance/remittances scalars", ignore=("documents_covered",))
    _assert_children(body["documents_covered"], stored["documents_covered"], where="remittance documents_covered", key="source_id")


async def test_a_part_allocation_is_stored_so_the_remainder_is_still_remittable(client, masters, db_session):
    """The strongest available proof that an allocation row was really
    written: the NEXT remittance can only claim what the first one left, and
    the register derives that from the stored child rows.
    """
    document, period_from, period_to = await _outstanding_withheld_document(client, masters, db_session)
    outstanding = Decimal(str(document["outstanding"]))
    first_half = (outstanding / 2).quantize(Decimal("0.01"))

    def _body(amount: Decimal, reference: str) -> dict:
        return {
            "tax_head_id": masters["withholding_tax"].id, "period_from": period_from.isoformat(), "period_to": period_to.isoformat(),
            "amount_remitted": str(amount), "paid_on": date.today().isoformat(),
            "paid_from_bank_account_id": masters["bank"].id, "payment_mode_id": masters["payment_mode"].id,
            "authority_reference": reference, "receipt_file_id": None, "notes": None,
            "documents_covered": [{"source_type": document["source_type"], "source_id": document["source_id"], "amount": str(amount)}],
        }

    await _ok(await client.post(f"{API}/compliance/remittances", json=_body(first_half, "CHLN-A")), expect=201)

    remaining = await _ok(
        await client.get(
            f"{API}/compliance/remittances/documents-in-period",
            params={"tax_head_id": masters["withholding_tax"].id, "period_from": period_from.isoformat(), "period_to": period_to.isoformat()},
        )
    )
    assert Decimal(str(remaining[0]["already_allocated"])) == first_half, (
        f"the first remittance's allocation row did not persist: already_allocated={remaining[0]['already_allocated']}"
    )
    assert Decimal(str(remaining[0]["outstanding"])) == outstanding - first_half

    # Over-claiming the remainder must now be refused BECAUSE the stored
    # allocation says so - a dropped child row would let this through.
    refused = await client.post(f"{API}/compliance/remittances", json=_body(outstanding, "CHLN-B"))
    assert refused.status_code == 422, f"the stored allocation was not consulted: HTTP {refused.status_code}"

    await _ok(await client.post(f"{API}/compliance/remittances", json=_body(outstanding - first_half, "CHLN-B")), expect=201)
    stored = await _ok(await client.get(f"{API}/compliance/remittances"))
    assert len(stored) == 2
    assert sum(Decimal(str(alloc["amount"])) for row in stored for alloc in row["documents_covered"]) == outstanding
