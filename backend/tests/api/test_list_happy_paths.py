"""Layer 2's HAPPY PATH check, swept across every GET list endpoint at once.

COMPLETE-TEST-PROMPT.md asks seven things of every endpoint. Four of them are
mechanical and are already swept in tests/api/test_endpoint_contract_sweep.py
(auth, unknown id, malformed body, never-500) — none of them is repeated here.
Of the three that file deliberately leaves per-endpoint, this one is the happy
path: "2xx + correct response shape".

WHY THIS IS NOT 43 HAND-WRITTEN FILES. The happy path only needs hand-written
per-endpoint fixtures when the ASSERTION is per-endpoint (a figure, a status
transition — that is what test_finance_flows.py and test_payroll_flow.py are
for). "Correct response shape" is not that: every route already DECLARES its
own shape, so the expected answer can be read off the app instead of typed out
134 times, and an endpoint added tomorrow is swept without anyone remembering.

WHAT "CORRECT SHAPE" MEANS HERE, precisely:

  1. 2xx as SUPER_ADMIN against a seeded database. Not "any non-500": a list
     endpoint that 409s because nothing seeded a current Financial Year is a
     broken happy path, and four of them did exactly that before the fixture
     below grew one.
  2. The body is a JSON array or a JSON object — never null, never a bare
     scalar. Checked against what these routes ACTUALLY return, not assumed:
     the list routes here return a BARE JSON ARRAY (no {"items": ..., "total":
     ...} envelope anywhere in this app), while the dashboard/summary/report
     routes on the same sweep return a single JSON object. Where the schema
     declares which of the two it is, that declaration is enforced.
  3. Where a response model is declared, every returned row carries every one
     of that model's REQUIRED fields. This is the assertion with teeth. A list
     endpoint that answers 200 with rows missing half their declared fields
     passes checks 1 and 2 and is exactly the bug this file exists to catch —
     the same class as the Tax Head PUT bug that motivated
     tests/api/test_nested_round_trips.py, seen from the read side.

WHERE THE DECLARATION COMES FROM. Two sources, in order:
  * the OpenAPI schema's response model (`app.openapi()`), and
  * for the ~100 routes written as `response_model=None` — they return a
    StreamingResponse when ?format=pdf|excel is passed, which is what forces
    response_model off — the route function's own RETURN ANNOTATION, e.g.
    `-> list[ExpenseClaimOut] | Response`. The model is just as declared
    there; only FastAPI's schema generator cannot see it.
Both are resolved to the model's SERIALIZATION required-field set (what the
model always emits), which for these schemas is nearly every property.

WHY SUPER_ADMIN. A 404 from a screen guard and a route that returns nothing
look identical from outside. Driving as Super Admin removes the first
explanation, so a failure here is about the response, not about permissions —
scope is tests/api/test_scope_enforcement.py's and tests/security/'s job.

WHY THE FIXTURE SEEDS SO MUCH. `set(row) >= required` over zero rows passes
vacuously. The world below is seeded so that most modelled endpoints return
real rows, and test_the_required_field_check_actually_inspected_rows holds a
floor under it — if a future refactor empties the fixture, the sweep fails
instead of quietly checking nothing.
"""

import calendar
import typing
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest_asyncio
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
from sqlalchemy import select

from app.auth.deps import get_current_user
from app.core.db import get_db
from app.main import app
from app.models.asset import Asset, AssetMaintenanceLog, AssetRequest
from app.models.compliance import (
    CertificateReceipt,
    CreditClaim,
    Remittance,
    WithholdingCertificate,
)
from app.models.customer import Customer
from app.models.employee import (
    Announcement,
    AttendanceRecord,
    Employee,
    EmployeeDocument,
    EmployeeInsuranceEnrollment,
    Notification,
    OnboardingChecklistItem,
    ProfileChangeRequest,
    Resignation,
    SalaryStructure,
)
from app.models.finance import (
    CompanyExpense,
    CreditNote,
    ExpenseClaim,
    Invoice,
    InvoiceLineItem,
    InvoicePayment,
    PurchaseBill,
    PurchaseBillPayment,
)
from app.models.leave import (
    CompensatoryHourRequest,
    LeaveBalance,
    LeaveBalanceAdjustment,
    LeaveRequest,
)
from app.models.masters import (
    AssetCategory,
    BankAccount,
    CompanyAddress,
    CompanyProfile,
    CustomerSource,
    CustomerStatus,
    Department,
    Designation,
    EmailServerSettings,
    EmailTemplate,
    EmploymentType,
    ExpenseType,
    Holiday,
    HsnSacCode,
    InsurancePlan,
    LeaveType,
    NumberPrefixRule,
    PayCycle,
    PaymentMode,
    SaturdayOverride,
    ServiceCategory,
    TaxHead,
    TaxHeadWithholdingDirection,
    TaxScheme,
    TicketCategory,
    UnitOfMeasure,
    WorkWeekPolicy,
)
from app.models.numbering import FinancialYear
from app.models.opportunity import Opportunity
from app.models.payroll import (
    AdhocPayslipAdjustment,
    PayrollRun,
    PayrollRunEmployee,
    Payslip,
    SalaryCertificateRequest,
)
from app.models.platform import IndianState, StoredFile, User
from app.models.project import Project, ProjectMember, TimesheetEntry
from app.models.rbac import FeatureToggle, PermissionChangeLog, Role, Screen, UserPermissionOverride
from app.models.ticket import Ticket
from app.models.vendor import Vendor
from tests.conftest import seed_canonical

API = "/api/v1"

# /health is the one GET outside /api/v1, and it is excluded with cause: it
# does not take the `get_db` override — it pings app.core.db.engine directly
# (that is the entire point of the endpoint, per its own comment), so its
# answer depends on a database outside this test's control. It is also not a
# list endpoint: it returns {"status", "database"} and nothing else. The
# contract sweep already covers it for the checks that do apply.
EXCLUDED = {"/health": "pings the real engine, not the overridden test session"}

TODAY = date.today()
FY_START = date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
FY_END = date(FY_START.year + 1, 3, 31)
PERIOD_MONTH = TODAY.month
PERIOD_YEAR = TODAY.year
# The compliance screens resolve a MONTHLY head's period to exact calendar
# month bounds, and GET /compliance/remittances/documents-in-period matches on
# those bounds EXACTLY — so the sweep has to ask for the same window the
# engine derives, not an arbitrary one.
MONTH_START = TODAY.replace(day=1)
MONTH_END = TODAY.replace(day=calendar.monthrange(TODAY.year, TODAY.month)[1])
NOW = datetime.now(timezone.utc).replace(tzinfo=None)


# ============================================================ the declaration
SPEC = app.openapi()
SCHEMAS = SPEC["components"]["schemas"]


def _api_routes(routes) -> list[APIRoute]:
    """Every APIRoute the app serves.

    FastAPI 0.141 no longer flattens `include_router` into `app.routes` — it
    keeps a lazy wrapper carrying the original router — so this recurses
    through `original_router` rather than assuming a flat list. If a future
    FastAPI changes that shape again, `test_the_sweep_covers_the_real_get_
    surface` fails loudly instead of this quietly resolving zero models.
    """
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
            continue
        inner = getattr(route, "original_router", None)
        if inner is not None:
            found.extend(_api_routes(inner.routes))
    return found


def _model_in(annotation) -> type[BaseModel] | None:
    """The Pydantic model inside `list[X] | Response`, `X | None`, or `X`."""
    origin = typing.get_origin(annotation)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    if origin is list:
        inner = typing.get_args(annotation)[0]
        return inner if isinstance(inner, type) and issubclass(inner, BaseModel) else None
    if origin is not None:
        for arg in typing.get_args(annotation):
            model = _model_in(arg)
            if model is not None:
                return model
    return None


def _annotated_models() -> dict[str, tuple[str, str, frozenset[str]]]:
    """path -> (kind, model name, required fields), read off the route's own
    return annotation. This is the only way to see the model on a route
    declared `response_model=None`, which is most of the list routes here.
    """
    out: dict[str, tuple[str, str, frozenset[str]]] = {}
    for route in _api_routes(app.routes):
        if "GET" not in route.methods:
            continue
        path = route.path if route.path in SPEC["paths"] else API + route.path
        if path not in SPEC["paths"]:
            continue
        try:
            annotation = typing.get_type_hints(route.endpoint).get("return")
        except Exception:  # pragma: no cover - a route whose hints cannot resolve
            continue
        if annotation is None:
            continue
        model = _model_in(annotation)
        if model is None:
            continue
        kind = "list" if typing.get_origin(annotation) is list or "list" in str(annotation) else "obj"
        out[path] = (kind, model.__name__, _required_of(model))
    return out


def _required_of(model: type[BaseModel]) -> frozenset[str]:
    """The fields the model ALWAYS emits. Serialization mode, deliberately:
    a field carrying a default is optional on the way IN but is still always
    present on the way OUT, and "always present on the way out" is exactly
    what a response-shape check is asserting.
    """
    try:
        return frozenset(model.model_json_schema(mode="serialization").get("required", []))
    except Exception:  # pragma: no cover - a model whose schema cannot be built
        return frozenset(name for name, field in model.model_fields.items() if field.is_required())


def _spec_model(path: str) -> tuple[str, str, frozenset[str]] | None:
    operation = SPEC["paths"][path]["get"]
    content = (operation.get("responses", {}).get("200", {}).get("content") or {}).get("application/json")
    schema = (content or {}).get("schema") or {}
    if "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        return "obj", name, frozenset(SCHEMAS[name].get("required", []))
    items = schema.get("items") or {}
    if schema.get("type") == "array" and "$ref" in items:
        name = items["$ref"].rsplit("/", 1)[-1]
        return "list", name, frozenset(SCHEMAS[name].get("required", []))
    return None


def _get_paths() -> list[str]:
    """Every GET the app exposes that is a LIST/collection path.

    Paths carrying an {id} are skipped on purpose: a fabricated id proves
    nothing about a happy path (it is the UNKNOWN-id sweep's input, and that
    sweep already owns it), and seeding a real id for all ~230 of them would
    be a different test entirely.
    """
    return sorted(
        path
        for path, operations in SPEC["paths"].items()
        if "get" in operations and "{" not in path and path not in EXCLUDED
    )


GET_PATHS = _get_paths()
ANNOTATED = _annotated_models()
# The OpenAPI declaration wins where it exists — it is what a client actually
# codes against; the return annotation fills in the rest.
DECLARED: dict[str, tuple[str, str, frozenset[str]]] = {
    path: (_spec_model(path) or ANNOTATED.get(path))
    for path in GET_PATHS
    if _spec_model(path) or path in ANNOTATED
}


# =========================================================== required params
def _required_params(path: str) -> list[str]:
    return [p["name"] for p in SPEC["paths"][path]["get"].get("parameters", []) if p.get("required")]


def _rows(body) -> list[dict]:
    """The JSON objects a response body carries: a collection's rows, or the
    single object a dashboard/summary route returns."""
    if isinstance(body, list):
        return [row for row in body if isinstance(row, dict)]
    return [body] if isinstance(body, dict) else []


# ================================================================== the world
@pytest_asyncio.fixture
async def client(db_session):
    async def _db():
        # Stands in for production's fresh per-request session, exactly as
        # tests/api/test_finance_flows.py documents: several rows seeded below
        # carry MySQL/SQLite GENERATED columns (LeaveBalance.remaining_days,
        # ExpenseClaim.has_receipt, Invoice.balance_due) which are not loaded
        # by the INSERT, and a route reading one off a held instance would
        # lazy-load inside a coroutine. Read-only sweep, so an expire can
        # neither hide nor invent state.
        db_session.expire_all()
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def world(db_session) -> dict[str, str]:
    """One seeded company with at least one row behind every list endpoint the
    seeding effort can reach, plus the SUPER_ADMIN login that drives the sweep.

    Rows are inserted directly through the ORM rather than through the API:
    this file is testing the READ side, and driving 40 POST endpoints first
    would make a write bug look like a read bug.
    """
    ids = await seed_canonical(db_session)
    role = (await db_session.execute(select(Role).where(Role.code == "SUPER_ADMIN"))).scalar_one()
    actor = User(
        id=str(uuid.uuid4()), email="happypath.super@meshrd.in", password_hash="x",
        full_name="Happy Path Super Admin", role_id=role.id, is_enabled=True, must_change_password=False,
    )
    db_session.add(actor)
    await db_session.flush()

    fy = FinancialYear(
        id=str(uuid.uuid4()), label=f"FY {FY_START.year}-{FY_END.year % 100}",
        start_date=FY_START, end_date=FY_END, is_current=True,
    )
    state = IndianState(id=str(uuid.uuid4()), name="Tamil Nadu", code="TN", gst_state_code="33")
    department = Department(id=str(uuid.uuid4()), name="Engineering")
    designation = Designation(id=str(uuid.uuid4()), name="Senior Engineer")
    employment_type = EmploymentType(id=str(uuid.uuid4()), name="Full Time")
    leave_type = LeaveType(id=str(uuid.uuid4()), name="Casual Leave", is_paid=True)
    expense_type = ExpenseType(id=str(uuid.uuid4()), name="Travel", claim_type="REIMBURSABLE")
    payment_mode = PaymentMode(id=str(uuid.uuid4()), name="Bank Transfer")
    bank_account = BankAccount(
        id=str(uuid.uuid4()), nickname="Primary Current", bank_name="HDFC Bank",
        account_holder_name="Meshrd Technologies", account_number="500100200300",
        account_type="CURRENT", ifsc="HDFC0000123", branch="Coimbatore",
    )
    asset_category = AssetCategory(id=str(uuid.uuid4()), name="Laptops")
    ticket_category = TicketCategory(id=str(uuid.uuid4()), name="Bug Report")
    customer_status = CustomerStatus(id=str(uuid.uuid4()), name="Active")
    customer_source = CustomerSource(id=str(uuid.uuid4()), name="Referral")
    hsn = HsnSacCode(id=str(uuid.uuid4()), code="998314", code_type="SAC", description="IT consulting")
    service_category = ServiceCategory(id=str(uuid.uuid4()), name="Implementation")
    uom = UnitOfMeasure(id=str(uuid.uuid4()), name="Hours")
    insurance_plan = InsurancePlan(
        id=str(uuid.uuid4()), plan_name="Group Mediclaim", plan_type="GROUP_HEALTH",
        coverage_amount=Decimal("500000.00"), company_contribution_monthly=Decimal("1200.00"),
    )
    tax_scheme = TaxScheme(id=str(uuid.uuid4()), scheme_name="New Regime", choice_window="ANNUAL")
    tax_head = TaxHead(
        id=str(uuid.uuid4()), tax_name="GST 18%", short_code="GST18", scope="SALES_BILLING",
        tax_type="PERCENTAGE", applies_from=FY_START, rate_pct=Decimal("18.0000"), is_active=True,
    )
    # TWO withholding heads, because Compliance reads two opposite flows and
    # they land on different screens: what WE withhold paying a vendor is an
    # obligation to remit, what a CUSTOMER withholds paying us is a credit to
    # claim. Seeding only one leaves half the compliance endpoints answering
    # 200 with an empty list, which passes the required-field check vacuously.
    tds_payable = TaxHead(
        id=str(uuid.uuid4()), tax_name="TDS 194J — Professional Fees", short_code="194J",
        scope="WITHHOLDING_AT_SOURCE", tax_type="PERCENTAGE", applies_from=FY_START,
        rate_pct=Decimal("10.0000"), is_active=True, creates_onward_liability=True,
        remitted_to_authority="Income Tax Department", remittance_period="MONTHLY",
        period_aligns_to="CALENDAR_MONTH", deposit_due_days_after_period_end=7,
        liability_arises_on="PAYMENT_DATE", authority_reference_label="Challan Number",
        default_calculated_on="SUBTOTAL", certificate_expected=True,
    )
    tds_receivable = TaxHead(
        id=str(uuid.uuid4()), tax_name="TDS Withheld By Customer", short_code="194C",
        scope="WITHHOLDING_AT_SOURCE", tax_type="PERCENTAGE", applies_from=FY_START,
        rate_pct=Decimal("10.0000"), is_active=True, certificate_expected=True,
    )
    directions = [
        TaxHeadWithholdingDirection(id=str(uuid.uuid4()), tax_head_id=tds_payable.id, direction="ON_PAYMENTS_MADE"),
        TaxHeadWithholdingDirection(id=str(uuid.uuid4()), tax_head_id=tds_receivable.id, direction="ON_PAYMENTS_RECEIVED"),
    ]
    holiday = Holiday(
        id=str(uuid.uuid4()), name="Pongal", holiday_date=FY_START + timedelta(days=280),
        financial_year_id=fy.id, holiday_type="PUBLIC",
    )
    prefix_rules = [
        NumberPrefixRule(
            id=str(uuid.uuid4()), code_type=code_type, label=label, prefix=code_type,
            include_fy_in_code=True, running_number_digits=4, starting_number=1,
        )
        for code_type, label in (("INV", "Invoice"), ("CN", "Credit Note"), ("PB", "Purchase Bill"))
    ]
    profile = CompanyProfile(
        id=str(uuid.uuid4()), legal_name="Meshrd Technologies Private Limited",
        cin="U72900TZ2019PTC032456", pan="AAACM1234C", company_type="PRIVATE_LIMITED",
        year_of_incorporation=2019, phone="0422400000", official_email="hello@meshrd.in",
    )
    address = CompanyAddress(
        id=str(uuid.uuid4()), address_type="REGISTERED", line1="12 Race Course Road",
        city="Coimbatore", state_id=state.id, pin_code="641018",
    )
    work_week = WorkWeekPolicy(
        id=str(uuid.uuid4()), policy_name="Standard 5-day", applies_to="COMPANY_WIDE", effective_from=FY_START,
        gross_hours_per_day=Decimal("9.00"), unpaid_break_hours=Decimal("1.00"),
        weekly_hour_target=Decimal("40.00"), weekly_off_days="SUN", saturday_rule="ALL_OFF",
    )
    saturday_override = SaturdayOverride(
        id=str(uuid.uuid4()), saturday_date=FY_START + timedelta(days=5), financial_year_id=fy.id,
        override_to="WORKING", hours_required=Decimal("4.00"), reason="Quarter close",
    )
    pay_cycle = PayCycle(id=str(uuid.uuid4()), cycle_type="CALENDAR_MONTH", salary_credit_day=1, effective_from=FY_START)
    email_settings = EmailServerSettings(
        id=str(uuid.uuid4()), provider="MAILGUN", from_name="Meshrd CMS", from_email="no-reply@meshrd.in",
    )
    email_template = EmailTemplate(
        id=str(uuid.uuid4()), template_key="welcome", template_name="Welcome",
        triggered_from_module="employee", subject="Welcome aboard", body="Hello {{name}}",
    )
    db_session.add_all(
        [fy, state, department, designation, employment_type, leave_type, expense_type, payment_mode,
         bank_account, asset_category, ticket_category, customer_status, customer_source, hsn,
         service_category, uom, insurance_plan, tax_scheme, tax_head, tds_payable, tds_receivable,
         *directions, holiday, profile, address, work_week, saturday_override, pay_cycle,
         email_settings, email_template, *prefix_rules]
    )
    await db_session.flush()

    # --------------------------------------------------------------- people
    employee = Employee(
        id=str(uuid.uuid4()), employee_code="EMP-0001", code_financial_year_id=fy.id,
        first_name="Ravi", last_name="Kumar", email="ravi@meshrd.in", department_id=department.id,
        designation_id=designation.id, employment_type_id=employment_type.id,
        joining_date=FY_START - timedelta(days=400), user_id=actor.id,
    )
    onboarding_employee = Employee(
        id=str(uuid.uuid4()), employee_code="EMP-0002", code_financial_year_id=fy.id,
        first_name="Divya", last_name="Nair", email="divya@meshrd.in", department_id=department.id,
        designation_id=designation.id, employment_type_id=employment_type.id,
        joining_date=TODAY - timedelta(days=3), reporting_manager_id=None,
    )
    db_session.add_all([employee, onboarding_employee])
    await db_session.flush()

    # ------------------------------------------------------ customers/vendors
    customer = Customer(
        id=str(uuid.uuid4()), customer_code="CUST-0001", financial_year_id=fy.id,
        company_name="Northwind Traders", display_name="Northwind", status_id=customer_status.id,
        source_id=customer_source.id,
    )
    vendor = Vendor(
        id=str(uuid.uuid4()), vendor_name="Contoso Components", payment_terms_days=30,
        is_active=True, approval_status="approved",
    )
    db_session.add_all([customer, vendor])
    await db_session.flush()

    # ------------------------------------------------------------- finance
    invoice = Invoice(
        id=str(uuid.uuid4()), invoice_number="INV-0001", financial_year_id=fy.id, customer_id=customer.id,
        invoice_date=TODAY - timedelta(days=20), due_date=TODAY + timedelta(days=10),
        customer_name_snapshot=customer.company_name, subtotal=Decimal("100000.00"),
        tax_amount=Decimal("18000.00"), status="SENT",  # grand_total is a GENERATED column
        amount_received=Decimal("100000.00"), withheld_total=Decimal("11800.00"),
    )
    db_session.add(invoice)
    await db_session.flush()
    # The customer paid 100,000 of the 118,000 and withheld 11,800 at source —
    # which is what puts a row on the Credits screen (credits_engine reads
    # InvoicePayment.customer_withheld_tax_head_id, nothing else).
    invoice_payment = InvoicePayment(
        id=str(uuid.uuid4()), invoice_id=invoice.id, financial_year_id=fy.id,
        amount_received=Decimal("100000.00"), balance_due_at_entry=Decimal("118000.00"),
        customer_withheld_tax_head_id=tds_receivable.id,
        tax_head_name_snapshot=tds_receivable.tax_name, withholding_calculated_on="SUBTOTAL",
        withheld_amount=Decimal("11800.00"), payment_mode_id=payment_mode.id,
        received_into_bank_account_id=bank_account.id, payment_date=TODAY - timedelta(days=3),
        recorded_by=actor.id, recorded_at=NOW,
    )
    db_session.add_all(
        [
            invoice_payment,
            InvoiceLineItem(
                id=str(uuid.uuid4()), invoice_id=invoice.id, sequence=1, description="Implementation",
                quantity=Decimal("4.00"), rate=Decimal("25000.00"),
            ),
        ]
    )
    await db_session.flush()
    credit_note = CreditNote(
        id=str(uuid.uuid4()), credit_note_number="CN-0001", invoice_id=invoice.id, customer_id=customer.id,
        financial_year_id=fy.id, invoice_number_snapshot=invoice.invoice_number,
        customer_name_snapshot=customer.company_name, credit_note_date=TODAY - timedelta(days=2),
        reason="RATE_CORRECTION", reason_detail="Agreed rate revision", credit_amount=Decimal("1000.00"),
        raised_by=actor.id,
    )
    # Paid, with 10% withheld — a PAYMENT_DATE head only raises an obligation
    # once the bill is actually settled (obligation_engine skips a bill whose
    # paid_at is None), so both the payment row and paid_at are load-bearing
    # for /compliance/obligations returning anything at all.
    purchase_bill = PurchaseBill(
        id=str(uuid.uuid4()), purchase_bill_code="PB-0001", vendor_bill_number="CC-99",
        vendor_id=vendor.id, financial_year_id=fy.id, vendor_name_snapshot=vendor.vendor_name,
        bill_date=TODAY - timedelta(days=15), subtotal=Decimal("50000.00"),
        withholding_tax_head_id=tds_payable.id, withholding_calculated_on="SUBTOTAL",
        withholding_amount=Decimal("5000.00"), withholding_head_name_snapshot=tds_payable.tax_name,
        withholding_rate_snapshot=Decimal("10.0000"), amount_paid=Decimal("45000.00"),
        status="PAID", paid_at=NOW,
    )
    reimbursable_claim = ExpenseClaim(
        id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
        expense_type_id=expense_type.id, claim_type="REIMBURSABLE",
        expense_type_name_snapshot=expense_type.name, amount=Decimal("2500.00"),
        expense_date=TODAY - timedelta(days=7), description="Client visit cab fare",
        status="PENDING", submitted_at=NOW,
    )
    company_expense = CompanyExpense(
        id=str(uuid.uuid4()), financial_year_id=fy.id, expense_type_id=expense_type.id,
        amount=Decimal("18000.00"), expense_date=TODAY - timedelta(days=9), vendor_id=vendor.id,
        paid_from_bank_account_id=bank_account.id, payment_mode_id=payment_mode.id,
    )
    db_session.add_all([credit_note, purchase_bill, reimbursable_claim, company_expense])
    await db_session.flush()
    db_session.add(
        PurchaseBillPayment(
            id=str(uuid.uuid4()), purchase_bill_id=purchase_bill.id, vendor_id=vendor.id,
            financial_year_id=fy.id, amount=Decimal("45000.00"),
            balance_due_at_entry=Decimal("45000.00"), payment_mode_id=payment_mode.id,
            payment_date=MONTH_START, recorded_by=actor.id, recorded_at=NOW,
        )
    )

    # --------------------------------------------------- projects / tickets
    project = Project(
        id=str(uuid.uuid4()), project_code="PRJ-0001", financial_year_id=fy.id, project_name="Apollo",
        customer_id=customer.id, project_lead_id=employee.id, status="IN_PROGRESS",
        budget=Decimal("500000.00"),
    )
    db_session.add(project)
    await db_session.flush()
    db_session.add_all(
        [
            ProjectMember(id=str(uuid.uuid4()), project_id=project.id, employee_id=employee.id),
            TimesheetEntry(
                id=str(uuid.uuid4()), project_id=project.id, employee_id=employee.id,
                entry_date=TODAY - timedelta(days=1), hours=Decimal("7.50"),
            ),
            Ticket(
                id=str(uuid.uuid4()), ticket_number="TKT-0001", financial_year_id=fy.id,
                customer_id=customer.id, category_id=ticket_category.id, subject="Login fails",
                description="A user cannot sign in", raised_by=actor.id, raised_date=TODAY - timedelta(days=4),
                assigned_to=employee.id, status="OPEN", priority="HIGH",
            ),
            Opportunity(
                id=str(uuid.uuid4()), opportunity_code="OPP-0001", financial_year_id=fy.id,
                title="Phase 2 rollout", customer_id=customer.id, stage="QUALIFYING",
            ),
        ]
    )

    # -------------------------------------------------------------- assets
    asset = Asset(
        id=str(uuid.uuid4()), asset_tag="AST-0001", financial_year_id=fy.id, name="ThinkPad X1",
        category_id=asset_category.id, purchase_date=FY_START, purchase_value=Decimal("120000.00"),
        useful_life_years=3, status="ASSIGNED", assigned_to=employee.id, department_id=department.id,
    )
    db_session.add(asset)
    await db_session.flush()
    db_session.add_all(
        [
            AssetMaintenanceLog(
                id=str(uuid.uuid4()), asset_id=asset.id, log_date=TODAY - timedelta(days=30),
                description="Battery replaced", cost=Decimal("4500.00"),
            ),
            AssetRequest(
                id=str(uuid.uuid4()), asset_id=asset.id, employee_id=employee.id,
                request_type="REPAIR", description="Keyboard sticking", status="PENDING",
            ),
        ]
    )

    # ---------------------------------------------------------- leave/comp
    leave_balance = LeaveBalance(
        id=str(uuid.uuid4()), employee_id=employee.id, leave_type_id=leave_type.id,
        financial_year_id=fy.id, allowed_days=Decimal("12.00"), default_annual_quota_snapshot=Decimal("12.00"),
    )
    db_session.add(leave_balance)
    await db_session.flush()
    attendance = AttendanceRecord(
        id=str(uuid.uuid4()), employee_id=employee.id, attendance_date=TODAY - timedelta(days=2),
        financial_year_id=fy.id, work_week_policy_id=work_week.id,
        policy_name_snapshot=work_week.policy_name, day_type="WORKING", recorded_by_label="Biometric",
    )
    db_session.add(attendance)
    await db_session.flush()
    db_session.add_all(
        [
            LeaveRequest(
                id=str(uuid.uuid4()), employee_id=employee.id, leave_type_id=leave_type.id,
                financial_year_id=fy.id, from_date=TODAY + timedelta(days=5),
                to_date=TODAY + timedelta(days=6), days_requested=Decimal("2.00"),
                working_days_basis_policy_id=work_week.id, reason="Family function",
                paid_type_snapshot="PAID", status="PENDING", routed_to_role="HR",
                routing_reason="Applicant has no reporting manager", applied_at=NOW,
            ),
            LeaveBalanceAdjustment(
                id=str(uuid.uuid4()), leave_balance_id=leave_balance.id, employee_id=employee.id,
                leave_type_id=leave_type.id, financial_year_id=fy.id, adjustment_days=Decimal("1.00"),
                reason="Goodwill credit", adjusted_by=actor.id, adjusted_at=NOW,
                balance_before=Decimal("12.00"), balance_after=Decimal("13.00"),
            ),
            CompensatoryHourRequest(
                id=str(uuid.uuid4()), request_number="COMP-0001", employee_id=employee.id,
                financial_year_id=fy.id, shortfall_attendance_record_id=attendance.id,
                shortfall_date=attendance.attendance_date, hours_short=Decimal("2.00"),
                day_status_at_request="SHORTFALL", shortfall_reason="Power outage",
                make_up_date=TODAY + timedelta(days=3), make_up_day_type="WEEKEND",
                work_week_policy_id=work_week.id, hours_to_work=Decimal("2.00"),
                compensation_window_days_snapshot=30, window_last_permissible_date=TODAY + timedelta(days=28),
                uncompensated_shortfall_becomes_snapshot="LOP", routed_to_role="HR",
                routing_reason="No reporting manager", status="PENDING",
            ),
        ]
    )

    # ------------------------------------------------------------- payroll
    payroll_run = PayrollRun(
        id=str(uuid.uuid4()), financial_year_id=fy.id, period_month=PERIOD_MONTH, period_year=PERIOD_YEAR,
        pay_period_start=TODAY.replace(day=1), pay_period_end=TODAY, salary_credit_date=TODAY,
        pay_cycle_type_snapshot="CALENDAR_MONTH", salary_credit_day_snapshot=1,
        total_days_in_period=Decimal("30.00"), working_days_auto=Decimal("22.00"),
        employee_selection_mode="ALL", run_by=actor.id, run_on=NOW,
    )
    db_session.add(payroll_run)
    await db_session.flush()
    run_employee = PayrollRunEmployee(
        id=str(uuid.uuid4()), payroll_run_id=payroll_run.id, employee_id=employee.id,
        financial_year_id=fy.id, period_month=PERIOD_MONTH, period_year=PERIOD_YEAR,
        total_days_in_period=Decimal("30.00"), working_days=Decimal("22.00"), calculated_at=NOW,
    )
    db_session.add(run_employee)
    await db_session.flush()
    db_session.add_all(
        [
            Payslip(
                id=str(uuid.uuid4()), payroll_run_id=payroll_run.id, payroll_run_employee_id=run_employee.id,
                employee_id=employee.id, financial_year_id=fy.id, pay_period_start=payroll_run.pay_period_start,
                pay_period_end=payroll_run.pay_period_end, salary_credit_date=payroll_run.salary_credit_date,
                pay_cycle_type_snapshot="CALENDAR_MONTH", salary_credit_day_snapshot=1, period_month=PERIOD_MONTH,
                period_year=PERIOD_YEAR, employee_code_snapshot=employee.employee_code,
                employee_name_snapshot=f"{employee.first_name} {employee.last_name}",
                generated_at=NOW, generated_by=actor.id,
            ),
            AdhocPayslipAdjustment(
                id=str(uuid.uuid4()), financial_year_id=fy.id, applies_to_mode="SELECTED",
                label="Diwali bonus", adjustment_type="EARNING", amount=Decimal("5000.00"),
                effective_from=TODAY.replace(day=1),
            ),
            SalaryCertificateRequest(
                id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
                requested_by=actor.id, requested_at=NOW,
                employee_name_snapshot=f"{employee.first_name} {employee.last_name}",
                employee_code_snapshot=employee.employee_code,
            ),
            SalaryStructure(
                id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
                effective_from=FY_START, changed_by=actor.id, basic_salary_monthly=Decimal("50000.00"),
            ),
        ]
    )

    # ------------------------------------------------- employee self-service
    stored_file = StoredFile(
        id=str(uuid.uuid4()), storage_key="documents/aadhaar.pdf", original_filename="aadhaar.pdf",
        mime_type="application/pdf", size_bytes=1024, content_hash="0" * 64,
    )
    db_session.add(stored_file)
    await db_session.flush()
    db_session.add_all(
        [
            EmployeeDocument(
                id=str(uuid.uuid4()), employee_id=employee.id, document_type="AADHAAR",
                file_id=stored_file.id, uploaded_at=NOW, status="PENDING_VERIFICATION",
            ),
            EmployeeInsuranceEnrollment(
                id=str(uuid.uuid4()), employee_id=employee.id, insurance_plan_id=insurance_plan.id,
                enrollment_date=FY_START, plan_type_snapshot=insurance_plan.plan_type,
                plan_name_snapshot=insurance_plan.plan_name,
                coverage_amount_snapshot=insurance_plan.coverage_amount,
            ),
            ProfileChangeRequest(
                id=str(uuid.uuid4()), employee_id=employee.id, requested_by_user_id=actor.id,
                field_key="mobile_number", requested_value="9876543210", status="PENDING",
            ),
            Announcement(
                id=str(uuid.uuid4()), title="Office closed on Friday", message="Maintenance shutdown",
                target_scope="ALL", posted_by_user_id=actor.id,
            ),
            Notification(
                id=str(uuid.uuid4()), recipient_user_id=actor.id, notification_type="LEAVE_APPLIED",
                title="A leave request needs your action", body="Ravi Kumar applied for 2 days",
                source_module="leave",
            ),
            Resignation(
                id=str(uuid.uuid4()), employee_id=employee.id, financial_year_id=fy.id,
                last_working_day=TODAY + timedelta(days=45), submitted_at=NOW,
                submitted_by_user_id=actor.id, status="SUBMITTED",
            ),
            OnboardingChecklistItem(
                id=str(uuid.uuid4()), employee_id=onboarding_employee.id,
                step_key="collect_documents", ordinal=1, status="PENDING",
            ),
        ]
    )

    # ---------------------------------------------------------- compliance
    certificate = WithholdingCertificate(
        id=str(uuid.uuid4()), certificate_reference="TDS-0001", customer_id=customer.id,
        certificate_date=TODAY - timedelta(days=10), covered_from=FY_START, covered_to=TODAY,
        tax_head_id=tds_receivable.id, tax_head_name_snapshot=tds_receivable.tax_name,
        amount_on_certificate=Decimal("11800.00"),
    )
    db_session.add(certificate)
    await db_session.flush()
    db_session.add_all(
        [
            # The certificate is the customer's proof of the 11,800 they
            # withheld on the invoice payment above; the receipt is the link
            # between the two that turns the credit row from "awaiting
            # certificate" into a claimable one.
            CertificateReceipt(
                id=str(uuid.uuid4()), certificate_id=certificate.id,
                invoice_payment_id=invoice_payment.id, amount=Decimal("11800.00"),
            ),
            CreditClaim(
                id=str(uuid.uuid4()), certificate_id=certificate.id, amount_claimable=Decimal("11800.00"),
                claimed_in="ITR", claim_date=TODAY - timedelta(days=5), claimed_by=actor.id,
            ),
            Remittance(
                id=str(uuid.uuid4()), remittance_number="REM-0001", financial_year_id=fy.id,
                tax_head_id=tds_payable.id, tax_head_name_snapshot=tds_payable.tax_name,
                period_label=f"{PERIOD_MONTH:02d}/{PERIOD_YEAR}", period_from=MONTH_START, period_to=MONTH_END,
                amount_remitted=Decimal("2000.00"), paid_on=TODAY - timedelta(days=1),
                paid_from_bank_account_id=bank_account.id, payment_mode_id=payment_mode.id,
                authority_reference="CIN-123456", recorded_by=actor.id,
            ),
        ]
    )

    # ---------------------------------------------------------- RBAC admin
    screen = (await db_session.execute(select(Screen).where(Screen.screen_key == "masters.holidays"))).scalar_one()
    db_session.add_all(
        [
            FeatureToggle(
                id=str(uuid.uuid4()), toggle_key="Allow Manager to Approve Their Team's Expenses",
                module_key="expense", label="Manager approval step", enabled=False, default_enabled=False,
            ),
            UserPermissionOverride(
                id=str(uuid.uuid4()), user_id=actor.id, screen_id=screen.id, layer="SCREEN",
                override_value="full", reason="Covering for the Holidays owner", granted_by=actor.id,
            ),
            PermissionChangeLog(id=str(uuid.uuid4()), changed_by=actor.id, layer="SCREEN"),
        ]
    )

    await db_session.commit()
    # Expunged so the actor stays fully loaded and detached: the client
    # fixture expires the shared session once per request, and
    # get_current_user hands back THIS instance, so an attached (and
    # therefore expirable) User would lazy-load `role_id` inside
    # resolve_permission and raise MissingGreenlet. Every route still re-reads
    # whatever it needs by id through an awaited db.get(). Same reasoning, and
    # the same fix, as tests/api/test_finance_flows.py's `_actors`.
    db_session.expunge(actor)
    app.dependency_overrides[get_current_user] = lambda: actor
    return {
        "actor_id": actor.id, "employee_id": employee.id, "financial_year_id": fy.id,
        "tax_head_id": tax_head.id, "withholding_tax_head_id": tds_payable.id,
        "customer_name": customer.company_name,
        # Comp Hours' preview endpoint asks which shortfall is being made up.
        "attendance_record_id": attendance.id,
    }


@pytest_asyncio.fixture
async def swept(world, client) -> dict[str, tuple[int, object]]:
    """Every GET list endpoint driven exactly once as Super Admin.

    One pass shared by every assertion below, so the three checks describe the
    same 134 responses rather than three different ones.
    """
    values = {
        "employee_id": world["employee_id"],
        # The withholding head, not the sales head: the one required-tax_head_id
        # endpoint is Record Remittance's document picker, which only ever asks
        # about a head that creates an onward liability.
        "tax_head_id": world["withholding_tax_head_id"],
        "financial_year_id": world["financial_year_id"],
        "period_from": MONTH_START.isoformat(),
        "period_to": MONTH_END.isoformat(),
        "period_month": str(PERIOD_MONTH),
        "period_year": str(PERIOD_YEAR),
        "stage": "QUALIFYING",  # opportunity_engine's own vocabulary
        "q": world["customer_name"][:8],
        # GET /comp-hours/preview answers §2.6's Day Type / Window Check /
        # Monthly Cap Check before submit, so it needs the shortfall it is
        # compensating and the date being proposed. A future date keeps it
        # inside the make-up window rather than tripping the window check,
        # which would make this a 4xx instead of the happy path being swept.
        "shortfall_attendance_record_id": world["attendance_record_id"],
        "make_up_date": (TODAY + timedelta(days=3)).isoformat(),
    }
    unknown = {
        name for path in GET_PATHS for name in _required_params(path) if name not in values
    }
    assert not unknown, (
        "a GET list endpoint requires a query parameter this sweep has no value for, so it would be "
        f"swept as a 422 rather than a happy path: {sorted(unknown)}"
    )

    results: dict[str, tuple[int, object]] = {}
    for path in GET_PATHS:
        query = "&".join(f"{name}={values[name]}" for name in _required_params(path))
        response = await client.get(f"{path}?{query}" if query else path)
        try:
            body = response.json()
        except ValueError:
            body = None
        results[path] = (response.status_code, body)
    return results


# ===================================================================== tests
def test_the_sweep_covers_the_real_get_surface():
    """Guard the guard. Every assertion below is a loop over these two lists;
    if either silently empties — a broken schema walk, a FastAPI release that
    changes how included routers are stored — the whole file would pass while
    exercising nothing.
    """
    assert len(GET_PATHS) >= 120, f"expected the app's GET list surface, found {len(GET_PATHS)}"
    assert len(DECLARED) >= 50, (
        f"only {len(DECLARED)} of {len(GET_PATHS)} GET endpoints resolved to a declared response model — "
        "the response-model walk has broken, and the required-field check below is now nearly inert"
    )
    # The return-annotation source is the half that can break quietly, since
    # it reads FastAPI internals rather than the published schema — and it is
    # the half that carries most of the list endpoints, because a route that
    # can also stream a PDF/Excel export has to be written response_model=None.
    annotation_only = [path for path in GET_PATHS if path in ANNOTATED and _spec_model(path) is None]
    assert len(annotation_only) >= 35, (
        f"the return-annotation walk contributed only {len(annotation_only)} models — FastAPI's route "
        "storage has changed shape and most list endpoints are no longer being checked against one"
    )


async def test_every_get_list_endpoint_answers_2xx_as_super_admin(swept):
    """Check 1 of the happy path. Not "not a 500" — a 2xx. A list endpoint that
    409s on a company with no current Financial Year, or 404s because the
    caller has no Employee row, has no happy path at all.
    """
    failures = [
        f"GET {path} -> {status} {str(body)[:160]}"
        for path, (status, body) in sorted(swept.items())
        if not 200 <= status < 300
    ]
    assert not failures, "endpoints did not answer their happy path:\n  " + "\n  ".join(failures)


async def test_every_body_is_a_list_or_an_object_in_the_shape_its_schema_declares(swept):
    """Check 2. These routes return a BARE JSON array for a collection and a
    single JSON object for a dashboard/summary — there is no {"items": ...}
    envelope anywhere in this app, and this asserts that stays true. `null` is
    a failure: a client that has to handle both null and [] for the same route
    is being handed the ambiguity the response model exists to remove.
    """
    wrong: list[str] = []
    for path, (status, body) in sorted(swept.items()):
        if not 200 <= status < 300:
            continue  # already reported by the test above
        if body is None:
            wrong.append(f"GET {path} returned null rather than a list or an object")
            continue
        if not isinstance(body, (list, dict)):
            wrong.append(f"GET {path} returned a bare {type(body).__name__}: {str(body)[:80]}")
            continue
        if isinstance(body, list) and any(not isinstance(row, dict) for row in body):
            wrong.append(f"GET {path} returned a list whose rows are not objects")
            continue
        declared = DECLARED.get(path)
        if declared is None:
            continue
        kind, name, _ = declared
        expected = list if kind == "list" else dict
        if not isinstance(body, expected):
            wrong.append(
                f"GET {path} declares {name} as a{'n array' if kind == 'list' else ' single object'} "
                f"but returned a {type(body).__name__}"
            )
    assert not wrong, "response shapes did not match what the app declares:\n  " + "\n  ".join(wrong)


async def test_every_returned_row_carries_every_required_field_its_model_declares(swept):
    """Check 3 — the one with teeth.

    A 200 whose rows are missing declared fields is invisible to every other
    check in the matrix: auth passes, the id sweep passes, the body is a list,
    nothing 500s. The client is simply handed less than the contract promises.
    """
    missing_fields: list[str] = []
    for path, (_kind, name, required) in sorted(DECLARED.items()):
        status, body = swept[path]
        if not 200 <= status < 300:
            continue
        for row in _rows(body)[:5]:  # a shape failure is systematic; five rows prove it
            missing = required - set(row)
            if missing:
                missing_fields.append(f"GET {path} ({name}) dropped {sorted(missing)}")
                break
    assert not missing_fields, (
        "endpoints returned rows missing fields their own response model declares:\n  "
        + "\n  ".join(missing_fields)
    )


async def test_the_required_field_check_actually_inspected_rows(swept):
    """The vacuity guard for the check above: `required - set(row)` over an
    empty list is empty, so a fixture that stopped seeding would turn the
    strongest assertion in this file into a no-op without failing anything.

    The `world` fixture currently gets a row onto ALL of them; the floor is set
    a little below that so a genuinely new endpoint does not fail the build on
    its first day, while a fixture that quietly stopped seeding still does.
    """
    with_rows = {path for path in DECLARED if _rows(swept[path][1])}
    assert len(with_rows) >= 50, (
        f"only {len(with_rows)} of {len(DECLARED)} modelled endpoints returned a row, so the "
        "required-field check is running mostly on empty lists. Endpoints returning nothing:\n  "
        + "\n  ".join(sorted(set(DECLARED) - with_rows))
    )
