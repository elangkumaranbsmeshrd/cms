"""Employee module (02-employee-module.md) — 23 tables. Portable generic
SQLAlchemy types only, per mixins.py's convention: these run the fast
SQLite-backed unit tests. alembic/versions/0003_employee_leave.py is the
schema source of truth — CHECK constraints, generated columns and triggers
live there, not here.
"""

from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Computed, Date, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import AuditMixin


class Employee(Base, AuditMixin):
    __tablename__ = "employees"

    employee_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    code_financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    photo_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    first_name: Mapped[str] = mapped_column(String(50), nullable=False)
    last_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    department_id: Mapped[str] = mapped_column(String(36), ForeignKey("departments.id"), nullable=False)
    designation_id: Mapped[str] = mapped_column(String(36), ForeignKey("designations.id"), nullable=False)
    employment_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("employment_types.id"), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    reporting_manager_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    work_location_address_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("company_addresses.id"), nullable=True)
    employment_status: Mapped[str] = mapped_column(String(12), nullable=False, default="ACTIVE")
    exit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bank_ifsc_code: Mapped[str | None] = mapped_column(String(11), nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(10), nullable=True)
    aadhaar_number: Mapped[str | None] = mapped_column(String(12), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), unique=True, nullable=True)
    login_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    login_removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    welcome_email_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    welcome_email_sent_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    biometric_enrollment_id: Mapped[str | None] = mapped_column(String(191), unique=True, nullable=True)


class EmployeeStatutoryIdentifier(Base, AuditMixin):
    __tablename__ = "employee_statutory_identifiers"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    identifier_label_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    identifier_value: Mapped[str] = mapped_column(String(191), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class EmployeeEmergencyContact(Base, AuditMixin):
    __tablename__ = "employee_emergency_contacts"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(191), nullable=False)
    relationship: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)


class SalaryStructure(Base, AuditMixin):
    __tablename__ = "salary_structures"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    changed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # QUEUED / NOT BUILT — §6 "nothing hardcoded": the DEDUCTION side of
    # payroll is a Masters lookup (TaxHead in models/masters.py, resolved
    # per-structure into SalaryStructureStatutoryLine below), but these six
    # EARNING columns are the mirror-image gap. Basic, Dearness Allowance,
    # HRA, LTA, Special Allowance and Other Earnings are permanent named
    # columns here, and app/api/v1/payroll_runs.py:292-303 hardcodes one
    # literal component_type/label string per column ("HRA"/"House Rent
    # Allowance", "LTA"/"Leave Travel Allowance", etc.) instead of iterating
    # a configured list. A Super Admin who needs a Conveyance Allowance, Meal
    # Coupons, or a non-Indian equivalent of HRA cannot add one without a
    # code change and a migration.
    # Not fixed here because there is nothing to point it at yet: it would
    # need a Masters-driven "Pay Components" registry mirroring TaxHead
    # (component name, taxability flag, default/formula) plus a
    # per-salary-structure line table analogous to
    # SalaryStructureStatutoryLine below (e.g. SalaryStructureEarningLine),
    # with payroll_runs.py iterating the configured components instead of
    # the six fixed if-blocks it has today. That is a new table + Alembic
    # migration + API + frontend screen, not a same-shape read-from-dynamic-
    # source edit.
    basic_salary_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    dearness_allowance_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    hra_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    lta_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    lta_payout_basis: Mapped[str] = mapped_column(String(10), nullable=False, default="MONTHLY")
    special_allowance_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    other_earnings_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    variable_pay_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    variable_pay_frequency: Mapped[str] = mapped_column(String(10), nullable=False, default="ANNUAL")
    # Real STORED GENERATED columns in MySQL — Computed() so the ORM never
    # sends an explicit value (MySQL error 3105 if it did); the API instead
    # computes the same figures via salary_engine for in-request use (e.g.
    # feeding compute_totals) and reads the authoritative DB value back via
    # refresh(). Found as a live bug: previously mirrored as plain columns
    # the API set explicitly, which only worked against the SQLite test DB.
    gross_monthly: Mapped[Decimal] = mapped_column(
        Numeric(14, 2),
        Computed(
            "basic_salary_monthly + dearness_allowance_monthly + hra_monthly "
            "+ (CASE WHEN lta_payout_basis = 'MONTHLY' THEN lta_amount ELSE 0 END) "
            "+ special_allowance_monthly + other_earnings_monthly"
        ),
        nullable=False,
    )
    variable_pay_annualised: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), Computed("variable_pay_amount * (CASE WHEN variable_pay_frequency = 'QUARTERLY' THEN 4 ELSE 1 END)"), nullable=False
    )
    insurance_employee_contribution_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    insurance_employer_contribution_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employee_statutory_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_employer_statutory_ctc_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    net_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    annual_ctc: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    basic_plus_da_share_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False, default=0)
    is_wage_code_compliant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    wage_code_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    wage_code_override_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    wage_code_override_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SalaryStructureStatutoryLine(Base, AuditMixin):
    __tablename__ = "salary_structure_statutory_lines"

    salary_structure_id: Mapped[str] = mapped_column(String(36), ForeignKey("salary_structures.id"), nullable=False)
    tax_head_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=False)
    head_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    print_label_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    scope_snapshot: Mapped[str] = mapped_column(String(40), nullable=False)
    tax_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    rate_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    fixed_amount_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    slab_application_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    computed_base_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    computed_amount_monthly: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    borne_by: Mapped[str] = mapped_column(String(10), nullable=False)
    include_in_ctc_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    per_employee_opt_out_allowed_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_applicable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    applicability_changed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    applicability_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class EmployeeInsuranceEnrollment(Base, AuditMixin):
    __tablename__ = "employee_insurance_enrollments"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    insurance_plan_id: Mapped[str] = mapped_column(String(36), ForeignKey("insurance_plans.id"), nullable=False)
    enrollment_date: Mapped[date] = mapped_column(Date, nullable=False)
    unenrolled_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    plan_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    plan_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    coverage_amount_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    company_contribution_monthly_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    employee_contribution_monthly_snapshot: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE")


class InsuranceDependent(Base, AuditMixin):
    __tablename__ = "insurance_dependents"

    employee_insurance_enrollment_id: Mapped[str] = mapped_column(String(36), ForeignKey("employee_insurance_enrollments.id"), nullable=False)
    dependent_name: Mapped[str] = mapped_column(String(191), nullable=False)
    relationship: Mapped[str] = mapped_column(String(20), nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class InsuranceNominee(Base, AuditMixin):
    __tablename__ = "insurance_nominees"

    employee_insurance_enrollment_id: Mapped[str] = mapped_column(String(36), ForeignKey("employee_insurance_enrollments.id"), nullable=False)
    nominee_name: Mapped[str] = mapped_column(String(191), nullable=False)
    relationship: Mapped[str] = mapped_column(String(20), nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class EmployeeDocument(Base, AuditMixin):
    __tablename__ = "employee_documents"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    document_type: Mapped[str] = mapped_column(String(30), nullable=False)
    file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(25), nullable=False, default="PENDING_VERIFICATION")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    uploaded_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="EMPLOYEE_UPLOAD")


class ProfileChangeRequest(Base, AuditMixin):
    __tablename__ = "profile_change_requests"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    requested_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    field_key: Mapped[str] = mapped_column(String(30), nullable=False)
    target_tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_value: Mapped[str] = mapped_column(Text, nullable=False)
    employee_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    decided_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Announcement(Base, AuditMixin):
    __tablename__ = "announcements"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    target_scope: Mapped[str] = mapped_column(String(20), nullable=False)
    posted_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")


class AnnouncementTarget(Base, AuditMixin):
    __tablename__ = "announcement_targets"

    announcement_id: Mapped[str] = mapped_column(String(36), ForeignKey("announcements.id"), nullable=False)
    department_id: Mapped[str] = mapped_column(String(36), ForeignKey("departments.id"), nullable=False)


class Notification(Base, AuditMixin):
    __tablename__ = "notifications"

    recipient_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    notification_type: Mapped[str] = mapped_column(String(25), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source_module: Mapped[str] = mapped_column(String(60), nullable=False)
    source_record_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    deep_link_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_send_log_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("email_send_log.id"), nullable=True)


class Resignation(Base, AuditMixin):
    __tablename__ = "resignations"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    last_working_day: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    submitted_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SUBMITTED")
    manager_acknowledgement_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    acknowledged_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    acknowledgement_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    exit_checklist_activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    final_last_working_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    final_settlement_status: Mapped[str] = mapped_column(String(10), nullable=False, default="NOT_DUE")
    final_settlement_marked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    final_settlement_paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OfferLetter(Base, AuditMixin):
    __tablename__ = "offer_letters"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    letter_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    letter_type: Mapped[str] = mapped_column(String(30), nullable=False)
    resignation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("resignations.id"), nullable=True)
    designation_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    department_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    employment_type_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    joining_date_snapshot: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_working_day_snapshot: Mapped[date | None] = mapped_column(Date, nullable=True)
    salary_structure_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("salary_structures.id"), nullable=True)
    basic_salary_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    hra_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    gross_monthly_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    annual_ctc_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    generated_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    pdf_file_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sent_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    sent_to_email: Mapped[str | None] = mapped_column(String(191), nullable=True)
    email_send_log_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("email_send_log.id"), nullable=True)


class OfferLetterCustomTerm(Base, AuditMixin):
    __tablename__ = "offer_letter_custom_terms"

    offer_letter_id: Mapped[str] = mapped_column(String(36), ForeignKey("offer_letters.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(191), nullable=False)
    adjustment_type: Mapped[str] = mapped_column(String(15), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_taxable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    # No FK — payslip_adhoc_adjustments is a Phase 3 (Payroll) table.
    queued_adjustment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class ExitChecklistStep(Base, AuditMixin):
    __tablename__ = "exit_checklist_steps"

    resignation_id: Mapped[str] = mapped_column(String(36), ForeignKey("resignations.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    step_key: Mapped[str] = mapped_column(String(35), nullable=False)
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    gated_by_step_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("exit_checklist_steps.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(15), nullable=False, default="LOCKED")
    outstanding_asset_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    linked_offer_letter_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("offer_letters.id"), nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completion_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmation_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class OnboardingChecklistItem(Base, AuditMixin):
    __tablename__ = "onboarding_checklist_items"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    step_key: Mapped[str] = mapped_column(String(30), nullable=False)
    ordinal: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    is_auto_checked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    skipped_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class EmployeeTaxSchemeElection(Base, AuditMixin):
    __tablename__ = "employee_tax_scheme_elections"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    tax_scheme_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_schemes.id"), nullable=False)
    scheme_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    choice_window_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    was_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    elected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    elected_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    superseded_by_election_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employee_tax_scheme_elections.id"), nullable=True)


class TaxDeclaration(Base, AuditMixin):
    __tablename__ = "tax_declarations"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    tax_scheme_election_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employee_tax_scheme_elections.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_declared_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    total_eligible_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    has_flagged_lines: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class TaxDeclarationLine(Base, AuditMixin):
    __tablename__ = "tax_declaration_lines"

    tax_declaration_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_declarations.id"), nullable=False)
    tax_head_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tax_heads.id"), nullable=True)
    is_other_catch_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    declaration_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    guidance_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    declaration_cap_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    requires_proof_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reduces_taxable_income_snapshot: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    amount_declared: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    other_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount_accepted_for_calculation: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="NOT_REVIEWED")
    verification_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class TaxDeclarationLineProof(Base, AuditMixin):
    __tablename__ = "tax_declaration_line_proofs"

    tax_declaration_line_id: Mapped[str] = mapped_column(String(36), ForeignKey("tax_declaration_lines.id"), nullable=False)
    file_id: Mapped[str] = mapped_column(String(36), ForeignKey("stored_files.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    uploaded_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)


class AttendanceRecord(Base, AuditMixin):
    __tablename__ = "attendance_records"

    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False)
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False)
    financial_year_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_years.id"), nullable=False)
    work_week_policy_id: Mapped[str] = mapped_column(String(36), ForeignKey("work_week_policies.id"), nullable=False)
    policy_name_snapshot: Mapped[str] = mapped_column(String(191), nullable=False)
    day_type: Mapped[str] = mapped_column(String(20), nullable=False)
    saturday_ordinal: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    holiday_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("holidays.id"), nullable=True)
    saturday_override_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("saturday_overrides.id"), nullable=True)
    check_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    check_out_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    spans_midnight: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    gross_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    break_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    # Real STORED GENERATED columns in MySQL — see SalaryStructure.gross_monthly
    # above for why these are Computed() rather than plain API-set columns.
    net_worked_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("gross_hours - break_hours"), nullable=False)
    required_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    balance_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), Computed("gross_hours - break_hours - required_hours"), nullable=False)
    day_status: Mapped[str] = mapped_column(String(20), nullable=False, default="NOT_REQUIRED")
    net_hours_per_day_snapshot: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    grace_window_minutes_snapshot: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    half_day_threshold_hours_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    leave_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    leave_request_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leave_requests.id"), nullable=True)
    compensatory_credit_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    is_compensatory_makeup_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    shortfall_cleared_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="MANUAL_ENTRY")
    recorded_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    recorded_by_label: Mapped[str] = mapped_column(String(191), nullable=False)
    recorded_by_device_id: Mapped[str | None] = mapped_column(String(191), nullable=True)
    office_location_address_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("company_addresses.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
