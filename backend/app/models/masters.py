"""Masters module (01-masters-module.md) — the 21 sub-masters, minus
Financial Year which lives in app/models/numbering.py (Phase 0).

Portable generic SQLAlchemy types only, per mixins.py's convention: these run
the RBAC/service-layer unit tests fast against SQLite. The MySQL migration
(alembic/versions/0002_masters.py) is the schema source of truth — CHECK
constraints, generated-column guards and triggers live there, not here.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Computed, Date, DateTime, ForeignKey, Integer, JSON, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


# ============================================================== TAX ENGINE
class TaxScheme(Base, AuditMixin):
    __tablename__ = "tax_schemes"

    scheme_name: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    choice_window: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TaxHead(Base, AuditMixin):
    __tablename__ = "tax_heads"

    tax_name: Mapped[str] = mapped_column(String(191), nullable=False)
    short_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    scope: Mapped[str] = mapped_column(String(40), nullable=False)
    tax_type: Mapped[str] = mapped_column(String(20), nullable=False)
    applies_from: Mapped[date] = mapped_column(Date, nullable=False)
    applies_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    cgst_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    sgst_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    fixed_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    declaration_cap: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    slab_application: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tax_scheme_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_schemes.id"), nullable=True)
    print_label: Mapped[str | None] = mapped_column(String(191), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    behaviour: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    creates_onward_liability: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    remitted_to_authority: Mapped[str | None] = mapped_column(String(191), nullable=True)
    remittance_period: Mapped[str | None] = mapped_column(String(20), nullable=True)
    period_aligns_to: Mapped[str | None] = mapped_column(String(20), nullable=True)
    deposit_due_days_after_period_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    liability_arises_on: Mapped[str | None] = mapped_column(String(30), nullable=True)
    authority_reference_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    default_calculated_on: Mapped[str | None] = mapped_column(String(10), nullable=True)
    certificate_expected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_arithmetic_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    supersedes_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)


class TaxHeadSlabBand(Base, AuditMixin):
    __tablename__ = "tax_head_slab_bands"

    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    sequence_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    band_from: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    band_to: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    rate_or_amount: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    band_label: Mapped[str | None] = mapped_column(String(120), nullable=True)


class TaxHeadSplitComponent(Base, AuditMixin):
    __tablename__ = "tax_head_split_components"

    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    sequence_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    component_name: Mapped[str] = mapped_column(String(120), nullable=False)
    share_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    applies_when: Mapped[str] = mapped_column(String(20), nullable=False, default="ALWAYS")
    condition_rule: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class TaxHeadReliefRule(Base, AuditMixin):
    __tablename__ = "tax_head_relief_rules"

    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    relief_name: Mapped[str] = mapped_column(String(120), nullable=False)
    applies_if_base_at_or_below: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    relief_type: Mapped[str] = mapped_column(String(20), nullable=False)
    relief_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TaxHeadWithholdingDirection(Base, AuditMixin):
    __tablename__ = "tax_head_withholding_directions"

    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    direction: Mapped[str] = mapped_column(String(24), nullable=False)


# ======================================================= NUMBER PREFIX RULES
class NumberPrefixRule(Base, AuditMixin):
    __tablename__ = "number_prefix_rules"

    code_type: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    prefix: Mapped[str] = mapped_column(String(10), nullable=False)
    include_fy_in_code: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    running_number_digits: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    starting_number: Mapped[int] = mapped_column(Integer, nullable=False)
    resets_every_fy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    starting_number_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    generated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


# ============================================================= BANK ACCOUNT
class BankAccount(Base, AuditMixin):
    __tablename__ = "bank_accounts"

    nickname: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_holder_name: Mapped[str] = mapped_column(String(191), nullable=False)
    account_number: Mapped[str] = mapped_column(String(18), nullable=False)
    account_type: Mapped[str] = mapped_column(String(10), nullable=False)
    ifsc: Mapped[str] = mapped_column(String(11), nullable=False)
    branch: Mapped[str] = mapped_column(String(120), nullable=False)
    upi_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    upi_qr_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


# =============================================================== SIMPLE MASTERS
class ExpenseType(Base, AuditMixin):
    __tablename__ = "expense_types"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    short_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    claim_type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_bank_account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("bank_accounts.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    claim_type_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    previous_claim_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class LeaveType(Base, AuditMixin):
    __tablename__ = "leave_types"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    short_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    default_annual_quota_days: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    carry_forward_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_carry_forward_days: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    is_quota_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Holiday(Base, AuditMixin):
    __tablename__ = "holidays"

    name: Mapped[str] = mapped_column(String(191), nullable=False)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    holiday_type: Mapped[str] = mapped_column(String(10), nullable=False)
    recurring_every_year: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    used_in_processed_payroll: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PaymentMode(Base, AuditMixin):
    __tablename__ = "payment_modes"

    name: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    requires_reference_number: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Department(Base, AuditMixin):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Designation(Base, AuditMixin):
    __tablename__ = "designations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    department_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("departments.id"), nullable=True)
    level_grade: Mapped[str | None] = mapped_column(String(60), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class HsnSacCode(Base, AuditMixin):
    __tablename__ = "hsn_sac_codes"

    code: Mapped[str] = mapped_column(String(20), nullable=False)
    code_type: Mapped[str] = mapped_column(String(3), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    linked_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # KNOWN §6 GAP — do not extend this pair, and do not copy this pattern
    # elsewhere. custom_gst_type/custom_gst_rate_pct is a one-off escape
    # hatch that only understands GST: the migration's CHECK constraint
    # (alembic/versions/0002_masters.py, ck_hsn_sac_gst_type) restricts
    # custom_gst_type to the literals 'GST_IGST' / 'GST_CGST_SGST', while
    # linked_tax_head_id right above already gets a fully dynamic, live-
    # validated path to whatever tax heads Masters -> Taxes actually
    # contains (see _hsn_sac_before_write in api/v1/masters_simple.py).
    # The right fix is letting this form create a genuine (possibly
    # draft/unlisted) TaxHead inline and set linked_tax_head_id to it, so
    # every rate — reusable or one-off — flows through the one dynamic tax
    # vocabulary instead of a second, GST-only schema path. Not done here
    # because that needs a new "create tax head inline" API contract that
    # does not exist yet (masters_simple.py's build_lookup_router has no
    # cross-resource create-on-write hook), and this pass fixes only
    # models/masters.py — inventing that contract belongs with the API/
    # frontend changes, not a silent schema edit. Removing these two
    # columns outright would also require a migration to drop the CHECK
    # constraints and backfill any existing is_custom=1 rows onto real tax
    # heads first.
    custom_gst_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    custom_gst_rate_pct: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ServiceCategory(Base, AuditMixin):
    __tablename__ = "service_categories"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class UnitOfMeasure(Base, AuditMixin):
    __tablename__ = "units_of_measure"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class TicketCategory(Base, AuditMixin):
    __tablename__ = "ticket_categories"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CustomerStatus(Base, AuditMixin):
    __tablename__ = "customer_statuses"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CustomerSource(Base, AuditMixin):
    __tablename__ = "customer_sources"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AssetCategory(Base, AuditMixin):
    __tablename__ = "asset_categories"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Masters §3.17 doesn't spec this field — carried over from the prototype
    # (app-forms.js:277), which feeds Asset Management's Straight Line
    # depreciation as the default when a category is picked. Same Integer
    # type as Asset.useful_life_years (models/asset.py) — a category default
    # and one asset's own override must stay directly comparable.
    default_useful_life_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class EmploymentType(Base, AuditMixin):
    __tablename__ = "employment_types"

    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class InsurancePlan(Base, AuditMixin):
    __tablename__ = "insurance_plans"

    plan_name: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    plan_type: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(191), nullable=True)
    coverage_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    company_contribution_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    employee_contribution_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


# ========================================================= COMPANY PROFILE
class CompanyProfile(Base, AuditMixin):
    __tablename__ = "company_profile"

    singleton_lock: Mapped[bool] = mapped_column(Boolean, unique=True, nullable=False, default=True)
    legal_name: Mapped[str] = mapped_column(String(191), nullable=False)
    cin: Mapped[str] = mapped_column(String(30), nullable=False)
    tan: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pan: Mapped[str] = mapped_column(String(10), nullable=False)
    company_type: Mapped[str] = mapped_column(String(60), nullable=False)
    year_of_incorporation: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    industry: Mapped[str | None] = mapped_column(String(191), nullable=True)
    msme_registration_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    phone: Mapped[str] = mapped_column(String(10), nullable=False)
    alternate_phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    official_email: Mapped[str] = mapped_column(String(191), nullable=False)
    support_email: Mapped[str | None] = mapped_column(String(191), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    logo_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    letterhead_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    invoice_template_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    default_billing_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    # A121: gives the Day/Hour payroll basis a home on Company Profile,
    # added via a Phase 3 cross-phase ALTER (0004_payroll.py) — was never
    # mapped onto this model, so it was unreadable/unsettable through the
    # API despite existing in the DB. Only HOUR_BASIS is actually
    # implemented (see the 409 guard in payroll_runs.create_payroll_run);
    # DAY_BASIS remains a legal CHECK value with no engine behind it.
    payroll_basis: Mapped[str] = mapped_column(String(10), nullable=False, default="HOUR_BASIS")
    # Masters §3.6, "New in this revision": an input-source gate, not a
    # calculation setting. Off (the default, and the only safe one) means any
    # inbound device payload is rejected and Payroll -> Attendance shows the
    # Biometric Feed as available-but-inactive rather than pretending a device
    # exists. The endpoint is required only while the toggle is On — a
    # conditional the API enforces, since a CHECK expressing it would also
    # reject every existing row that has the toggle Off and no endpoint.
    biometric_attendance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    biometric_device_endpoint: Mapped[str | None] = mapped_column(String(255), nullable=True)


class CompanyAddress(Base, AuditMixin):
    __tablename__ = "company_addresses"

    address_type: Mapped[str] = mapped_column(String(20), nullable=False)
    line1: Mapped[str] = mapped_column(String(191), nullable=False)
    line2: Mapped[str | None] = mapped_column(String(191), nullable=True)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    state_id: Mapped[str] = mapped_column(String(36), ForeignKey("indian_states.id"), nullable=False)
    pin_code: Mapped[str] = mapped_column(String(6), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CompanyDocument(Base, AuditMixin):
    __tablename__ = "company_documents"

    doc_group: Mapped[str] = mapped_column(String(10), nullable=False)
    file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
    financial_year_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=True)
    title: Mapped[str | None] = mapped_column(String(191), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


# ====================================================== WORK WEEK & HOURS
class WorkWeekPolicy(Base, AuditMixin):
    __tablename__ = "work_week_policies"

    policy_name: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    applies_to: Mapped[str] = mapped_column(String(20), nullable=False)
    department_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("departments.id"), nullable=True)
    designation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("designations.id"), nullable=True)
    employment_type_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employment_types.id"), nullable=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    gross_hours_per_day: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    unpaid_break_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    # Real STORED GENERATED column in MySQL (0002_masters.py) — Computed()
    # here so SQLAlchemy never sends an explicit value for it (MySQL error
    # 3105 if it did) while the attribute stays readable after refresh(), and
    # SQLite (the test DB) derives the same value itself via this expression.
    # Found as a live bug: the ORM previously mirrored this as a plain
    # column the API set explicitly, which works against SQLite but fails
    # every real INSERT/UPDATE against MySQL.
    net_working_hours_per_day: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("gross_hours_per_day - unpaid_break_hours"), nullable=False)
    grace_window_minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    half_day_threshold_hours: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    count_overtime_beyond_net: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    weekly_hour_target: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    weekly_off_days: Mapped[str] = mapped_column(String(20), nullable=False)
    saturday_rule: Mapped[str] = mapped_column(String(20), nullable=False)
    working_saturday_hours_mode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    custom_saturday_hours: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    mandatory_holiday_overrides_saturday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_compensatory_hours: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    compensation_window_days: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    make_up_day_chosen_by: Mapped[str | None] = mapped_column(String(30), nullable=True)
    allow_makeup_on_week_off: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_makeup_on_mandatory_holiday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_comp_hours_per_month: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    uncompensated_shortfall_becomes: Mapped[str] = mapped_column(String(20), nullable=False, default="PRO_RATA_LOP")
    excess_hours_become: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class WorkWeekPolicyEmployee(Base, AuditMixin):
    __tablename__ = "work_week_policy_employees"

    work_week_policy_id: Mapped[str] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=False)
    # No FK yet — `employees` (Module 2) doesn't exist until Phase 2. See the
    # cross-phase note in alembic/versions/0002_masters.py.
    employee_id: Mapped[str] = mapped_column(String(36), nullable=False)


class SaturdayOverride(Base, AuditMixin):
    __tablename__ = "saturday_overrides"

    saturday_date: Mapped[date] = mapped_column(Date, nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    work_week_policy_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=True)
    pattern_says: Mapped[str | None] = mapped_column(String(20), nullable=True)
    override_to: Mapped[str] = mapped_column(String(10), nullable=False)
    hours_required: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    notify_affected_employees: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class PayCycle(Base, AuditMixin):
    __tablename__ = "pay_cycles"

    cycle_type: Mapped[str] = mapped_column(String(20), nullable=False)
    start_day: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    end_day: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    salary_credit_day: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PayPeriod(Base, AuditMixin):
    __tablename__ = "pay_periods"

    pay_cycle_id: Mapped[str] = mapped_column(String(36), ForeignKey("pay_cycles.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    period_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    salary_credit_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


# ===================================================== EMAIL CONFIGURATION
class EmailServerSettings(Base, AuditMixin):
    __tablename__ = "email_server_settings"

    singleton_lock: Mapped[bool] = mapped_column(Boolean, unique=True, nullable=False, default=True)
    sending_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    smtp_host: Mapped[str | None] = mapped_column(String(191), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    encryption: Mapped[str | None] = mapped_column(String(10), nullable=True)
    username: Mapped[str | None] = mapped_column(String(191), nullable=True)
    password_encrypted: Mapped[bytes | None] = mapped_column(nullable=True)
    api_key_encrypted: Mapped[bytes | None] = mapped_column(nullable=True)
    credential_hint: Mapped[str | None] = mapped_column(String(8), nullable=True)
    from_name: Mapped[str] = mapped_column(String(191), nullable=False)
    from_email: Mapped[str] = mapped_column(String(191), nullable=False)
    reply_to_email: Mapped[str | None] = mapped_column(String(191), nullable=True)


class EmailTemplate(Base, AuditMixin):
    __tablename__ = "email_templates"

    template_key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    template_name: Mapped[str] = mapped_column(String(191), nullable=False)
    triggered_from_module: Mapped[str] = mapped_column(String(60), nullable=False)
    triggered_from_screen: Mapped[str | None] = mapped_column(String(60), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    available_placeholders: Mapped[list] = mapped_column(JSON, nullable=False, default=list)


class EmailSendLog(Base):
    __tablename__ = "email_send_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email_template_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("email_templates.id"), nullable=True)
    recipient_email: Mapped[str] = mapped_column(String(191), nullable=False)
    subject_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(10), nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(191), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_record_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    related_record_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
