"""Pydantic schemas for the Employee module (02-employee-module.md) —
Directory/Master Record, Salary Structure, Insurance, Documents, My Profile +
Profile Change Requests, Onboarding, Offboarding/Exit, Offer Letters, Tax
Declarations, Announcements. Attendance schemas live in schemas/leave.py
alongside Leave since attendance_engine.py is shared by both.
"""

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

# The employee's email IS their login identity — create-login copies it
# verbatim into users.email and every temporary-password / welcome mail is
# dispatched to it, so an HR typo produces a permanently unreachable account
# whose password can never be delivered. Validated here (the write side)
# rather than with pydantic's EmailStr because email-validator is not a
# dependency of this project; same "compiled pattern + field_validator"
# idiom customer.py already uses for GSTIN/PAN.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")
# employee_emergency_contacts' own CHECK constraints, mirrored into the
# contract so the OpenAPI schema actually documents what the DB will accept
# (ck_eec_relationship / ck_eec_phone / ck_eec_name).
EMERGENCY_CONTACT_RELATIONSHIPS = ("SPOUSE", "PARENT", "SIBLING", "FRIEND", "OTHER")
INDIAN_MOBILE_PATTERN = re.compile(r"^[6-9][0-9]{9}$")


# ================================================================ EMPLOYEE
class _EmployeeFields(BaseModel):
    """Shared field list. The write side (EmployeeWrite) adds the validators;
    the read side (EmployeeOut) deliberately does NOT inherit them, so a row
    persisted before those rules existed still reads back instead of turning
    every GET into a 500."""

    first_name: str
    last_name: str | None = None
    email: str
    phone: str | None = None
    date_of_birth: date | None = None
    gender: str | None = None
    current_address: str | None = None
    department_id: str
    designation_id: str
    employment_type_id: str
    joining_date: date
    reporting_manager_id: str | None = None
    work_location_address_id: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_ifsc_code: str | None = None
    pan_number: str | None = None
    aadhaar_number: str | None = None
    photo_file_id: str | None = None


class EmployeeWrite(_EmployeeFields):
    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        v = v.strip()
        if not EMAIL_PATTERN.match(v):
            raise ValueError("Enter a valid email address, e.g. name@example.com")
        return v

    @field_validator("first_name")
    @classmethod
    def _validate_first_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("First Name is required")
        return v.strip()


class EmployeeOut(_EmployeeFields):
    id: str
    employee_code: str
    employment_status: str
    exit_date: date | None
    user_id: str | None
    login_created_at: datetime | None
    login_removed_at: datetime | None
    onboarding_completed_at: datetime | None
    created_by: str | None = None
    updated_by: str | None = None
    model_config = ConfigDict(from_attributes=True)


class _EmergencyContactFields(BaseModel):
    contact_name: str
    relationship: str | None = None
    contact_phone: str | None = None
    is_primary: bool = True
    display_order: int = 1


class EmergencyContactWrite(_EmergencyContactFields):
    # Typed against the table's own CHECK constraints so a bad value is a
    # 422 naming the offending field, not the misleading catch-all 409
    # ("Only one contact may be marked Primary") every DBAPIError on this
    # table used to collapse into. Declaring `relationship` as a Literal also
    # publishes the accepted values in the OpenAPI contract, which a plain
    # `str | None` never did.
    relationship: Literal[EMERGENCY_CONTACT_RELATIONSHIPS] | None = None  # type: ignore[valid-type]

    @field_validator("contact_name")
    @classmethod
    def _validate_contact_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Contact Name is required")
        return v.strip()

    @field_validator("contact_phone")
    @classmethod
    def _validate_contact_phone(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not INDIAN_MOBILE_PATTERN.match(v):
                raise ValueError("Contact Phone must be a 10-digit mobile number starting with 6, 7, 8 or 9")
        return v


class EmergencyContactOut(_EmergencyContactFields):
    id: str
    employee_id: str
    model_config = ConfigDict(from_attributes=True)


class CreateLoginOut(BaseModel):
    user_id: str
    email: str
    # Phase 6 / Mailgun wiring: the temporary password is emailed straight to
    # the employee (Employee §2.2 / Workflow 3.6, "HR never sees or relays
    # the password itself") rather than returned here — always None now.
    # Left on the response shape (not removed) so existing callers reading
    # this field don't break; it simply never carries the secret anymore.
    temporary_password: str | None = None


class LoginStatusOut(BaseModel):
    """Employee §2.2 Account & Login tab's Set Role / Must Change Password on
    Next Login / Last Login fields — all live on the linked `users` row, not
    `employees`, so GET /employees/{id} alone can't render them. A dedicated
    read rather than adding these to EmployeeOut: they're only meaningful
    once employee.user_id is set (no login yet -> this endpoint returns
    null), and EmployeeOut also backs the Directory LIST (list_employees),
    where fetching+joining a User row per employee would be pure waste for
    columns that screen never shows.
    """

    is_enabled: bool
    must_change_password: bool
    last_login_at: datetime | None
    role_name: str


class StatutoryIdentifierWrite(BaseModel):
    identifier_value: str


class StatutoryIdentifierOut(BaseModel):
    id: str
    employee_id: str
    tax_head_id: str
    identifier_label_snapshot: str
    identifier_value: str
    captured_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ============================================================= MY PROFILE
class MyProfileEditableWrite(BaseModel):
    # Employee §2.3: only the low-risk fields are directly editable by the
    # employee themselves; everything else routes through a Profile Change
    # Request (below) so HR can review before it's applied.
    current_address: str | None = None
    phone: str | None = None


PROFILE_CHANGE_REQUEST_FIELDS = {
    "first_name", "last_name", "email", "date_of_birth", "gender", "bank_name",
    "bank_account_number", "bank_ifsc_code", "pan_number", "aadhaar_number",
    "statutory_identifier",
}


class ProfileChangeRequestCreate(BaseModel):
    field_key: str
    requested_value: str
    employee_note: str | None = None
    target_tax_head_id: str | None = None  # required when field_key == "STATUTORY_IDENTIFIER"


class ProfileChangeRequestOut(BaseModel):
    id: str
    employee_id: str
    requested_by_user_id: str
    field_key: str
    target_tax_head_id: str | None
    old_value: str | None
    requested_value: str
    employee_note: str | None
    status: str
    decided_by: str | None
    decided_at: datetime | None
    decision_reason: str | None
    applied_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ProfileChangeDecision(BaseModel):
    approve: bool
    decision_reason: str | None = None


# ========================================================= SALARY STRUCTURE
class SalaryStructureWrite(BaseModel):
    effective_from: date
    change_note: str | None = None
    basic_salary_monthly: Decimal
    dearness_allowance_monthly: Decimal = Decimal("0")
    hra_monthly: Decimal = Decimal("0")
    lta_amount: Decimal = Decimal("0")
    lta_payout_basis: str = "MONTHLY"
    special_allowance_monthly: Decimal = Decimal("0")
    other_earnings_monthly: Decimal = Decimal("0")
    variable_pay_amount: Decimal = Decimal("0")
    variable_pay_frequency: str = "ANNUAL"
    wage_code_override_reason: str | None = None


class StatutoryLineOut(BaseModel):
    id: str
    tax_head_id: str
    head_name_snapshot: str
    print_label_snapshot: str
    borne_by: str
    include_in_ctc_snapshot: bool
    per_employee_opt_out_allowed_snapshot: bool
    computed_amount_monthly: Decimal
    is_applicable: bool
    model_config = ConfigDict(from_attributes=True)


class SalaryStructureOut(BaseModel):
    id: str
    employee_id: str
    financial_year_id: str
    effective_from: date
    effective_to: date | None
    change_note: str | None
    basic_salary_monthly: Decimal
    dearness_allowance_monthly: Decimal
    hra_monthly: Decimal
    lta_amount: Decimal
    lta_payout_basis: str
    special_allowance_monthly: Decimal
    other_earnings_monthly: Decimal
    variable_pay_amount: Decimal
    variable_pay_frequency: str
    gross_monthly: Decimal
    variable_pay_annualised: Decimal
    insurance_employee_contribution_monthly: Decimal
    insurance_employer_contribution_monthly: Decimal
    total_employee_statutory_monthly: Decimal
    total_employer_statutory_ctc_monthly: Decimal
    net_monthly: Decimal
    annual_ctc: Decimal
    basic_plus_da_share_pct: Decimal
    is_wage_code_compliant: bool
    wage_code_override_reason: str | None
    statutory_lines: list[StatutoryLineOut] = []
    model_config = ConfigDict(from_attributes=True)


class StatutoryLineApplicabilityWrite(BaseModel):
    is_applicable: bool


# ================================================================ INSURANCE
class InsuranceDependentWrite(BaseModel):
    dependent_name: str
    relationship: str
    display_order: int = 0


class InsuranceDependentOut(InsuranceDependentWrite):
    id: str
    model_config = ConfigDict(from_attributes=True)


class InsuranceNomineeWrite(BaseModel):
    nominee_name: str
    relationship: str
    contact_phone: str | None = None
    is_primary: bool = True


class InsuranceNomineeOut(InsuranceNomineeWrite):
    id: str
    model_config = ConfigDict(from_attributes=True)


class InsuranceEnrollmentWrite(BaseModel):
    insurance_plan_id: str
    enrollment_date: date
    dependents: list[InsuranceDependentWrite] = []
    nominees: list[InsuranceNomineeWrite] = []


class InsuranceEnrollmentOut(BaseModel):
    id: str
    employee_id: str
    insurance_plan_id: str
    enrollment_date: date
    unenrolled_date: date | None
    plan_type_snapshot: str
    plan_name_snapshot: str
    coverage_amount_snapshot: Decimal
    company_contribution_monthly_snapshot: Decimal
    employee_contribution_monthly_snapshot: Decimal
    status: str
    dependents: list[InsuranceDependentOut] = []
    nominees: list[InsuranceNomineeOut] = []
    model_config = ConfigDict(from_attributes=True)


# ================================================================ DOCUMENTS
class DocumentUpload(BaseModel):
    # employee_documents.ck_ed_type, mirrored into the contract for the same
    # reason EMERGENCY_CONTACT_RELATIONSHIPS is: as a bare `str` the OpenAPI
    # spec advertised "any string" while the DB accepted exactly five values,
    # so a client had no way to know what was legal and a wrong one only
    # surfaced as a generic constraint 409 from the router.
    document_type: Literal["ID_PROOF", "EDUCATIONAL_CERTIFICATE", "RESUME", "OFFER_LETTER_COPY", "OTHER"]
    file_id: str
    note: str | None = None


class DocumentOut(BaseModel):
    id: str
    employee_id: str
    document_type: str
    file_id: str
    # Employee §2.6's document list leads with a "File Name" column
    # ("Uploaded file"), and its search "covers File Name" — but the name lives
    # on StoredFile (models/platform.py), not on EmployeeDocument, so it is
    # joined in by the endpoint. Same shape customers.py's CustomerFileOut and
    # assets.py's AssetFileOut already use for the identical split; blank only
    # if the linked StoredFile row is somehow gone, never a KeyError.
    file_name: str = ""
    note: str | None
    status: str
    uploaded_at: datetime
    uploaded_by_user_id: str | None
    verified_by: str | None
    verified_at: datetime | None
    rejection_reason: str | None
    source: str
    model_config = ConfigDict(from_attributes=True)


class DocumentVerifyDecision(BaseModel):
    approve: bool
    rejection_reason: str | None = None


# =============================================================== ONBOARDING
class OnboardingItemOut(BaseModel):
    id: str
    employee_id: str
    step_key: str
    ordinal: int
    status: str
    is_auto_checked: bool
    completed_at: datetime | None
    completed_by: str | None
    skipped_reason: str | None
    note: str | None
    model_config = ConfigDict(from_attributes=True)


class OnboardingQueueRow(BaseModel):
    """One row of GET /onboarding-queue — HR/Super Admin's
    cross-employee view (prototype's emp.onboardqueue, data.js ~line 1034).
    Built in Python from the same OnboardingChecklistItem rows the
    per-employee GET /employees/{id}/onboarding endpoint reads, not a new
    source of truth — an employee appears here exactly while
    steps_completed < steps_total on that same checklist.
    """

    employee_id: str
    employee_code: str
    employee_name: str
    department_id: str
    department_name: str
    joining_date: date
    steps_completed: int
    steps_total: int
    # Raw step_key (e.g. 'SEND_WELCOME_EMAIL') of the lowest-ordinal step
    # still PENDING — the frontend title-cases it, same as the per-employee
    # checklist's own item titles (emp.onboarding.checklist.config.ts).
    # None only if every step is somehow non-PENDING yet steps_completed
    # still < steps_total (i.e. every remaining step was SKIPPED, not
    # PENDING) — the row still belongs in the queue, it just has nothing to
    # point at as "oldest incomplete".
    oldest_incomplete_step: str | None


class OnboardingCompleteRequest(BaseModel):
    note: str | None = None


class OnboardingSkipRequest(BaseModel):
    skipped_reason: str


# ============================================================== OFFBOARDING
class ResignationCreate(BaseModel):
    last_working_day: date
    reason: str | None = None


class ResignationOut(BaseModel):
    id: str
    employee_id: str
    financial_year_id: str
    last_working_day: date
    reason: str | None
    submitted_at: datetime
    submitted_by_user_id: str
    status: str
    manager_acknowledgement_required: bool
    acknowledged_by_user_id: str | None
    acknowledged_at: datetime | None
    acknowledgement_note: str | None
    exit_checklist_activated_at: datetime | None
    final_last_working_day: date | None
    final_settlement_status: str
    final_settlement_marked_at: datetime | None
    final_settlement_paid_at: datetime | None
    completed_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class AcknowledgeRequest(BaseModel):
    acknowledgement_note: str | None = None


class ExitChecklistStepOut(BaseModel):
    id: str
    resignation_id: str
    employee_id: str
    step_key: str
    ordinal: int
    gated_by_step_id: str | None
    status: str
    outstanding_asset_count: int
    linked_offer_letter_id: str | None
    completed_by: str | None
    completed_at: datetime | None
    completion_note: str | None
    confirmation_acknowledged: bool
    model_config = ConfigDict(from_attributes=True)


class ExitStepActionRequest(BaseModel):
    completion_note: str | None = None
    confirmation_acknowledged: bool = False


# ============================================================= OFFER LETTERS
class OfferLetterCreate(BaseModel):
    letter_type: str
    resignation_id: str | None = None  # required when letter_type == 'ACCEPTANCE'
    joining_date_snapshot: date | None = None
    last_working_day_snapshot: date | None = None
    salary_structure_id: str | None = None


class OfferLetterCustomTermWrite(BaseModel):
    label: str
    adjustment_type: str
    amount: Decimal
    is_recurring: bool = False
    is_taxable: bool = True
    effective_from: date
    display_order: int = 0


class OfferLetterCustomTermOut(OfferLetterCustomTermWrite):
    id: str
    model_config = ConfigDict(from_attributes=True)


class OfferLetterOut(BaseModel):
    id: str
    employee_id: str
    letter_number: str
    financial_year_id: str
    letter_type: str
    resignation_id: str | None
    designation_snapshot: str
    department_snapshot: str
    employment_type_snapshot: str
    joining_date_snapshot: date | None
    last_working_day_snapshot: date | None
    salary_structure_id: str | None
    basic_salary_snapshot: Decimal | None
    hra_snapshot: Decimal | None
    gross_monthly_snapshot: Decimal | None
    annual_ctc_snapshot: Decimal | None
    status: str
    generated_at: datetime | None
    generated_by: str | None
    pdf_file_id: str | None
    sent_at: datetime | None
    sent_by: str | None
    sent_to_email: str | None
    email_send_log_id: str | None
    custom_terms: list[OfferLetterCustomTermOut] = []
    model_config = ConfigDict(from_attributes=True)


class SendLetterRequest(BaseModel):
    to_email: str | None = None  # defaults to the employee's own email


# =========================================================== TAX DECLARATIONS
class TaxSchemeElectionCreate(BaseModel):
    tax_scheme_id: str


class TaxSchemeElectionOut(BaseModel):
    id: str
    employee_id: str
    financial_year_id: str
    tax_scheme_id: str
    scheme_name_snapshot: str
    choice_window_snapshot: str
    was_default: bool
    elected_at: datetime
    elected_by_user_id: str
    superseded_at: datetime | None
    superseded_by_election_id: str | None
    model_config = ConfigDict(from_attributes=True)


class TaxDeclarationLineWrite(BaseModel):
    tax_head_id: str | None = None
    is_other_catch_all: bool = False
    amount_declared: Decimal = Decimal("0")
    other_description: str | None = None


class TaxDeclarationLineProofOut(BaseModel):
    id: str
    tax_declaration_line_id: str
    file_id: str
    uploaded_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TaxDeclarationLineOut(BaseModel):
    id: str
    tax_declaration_id: str
    tax_head_id: str | None
    is_other_catch_all: bool
    declaration_name_snapshot: str
    guidance_snapshot: str | None
    declaration_cap_snapshot: Decimal | None
    requires_proof_snapshot: bool
    reduces_taxable_income_snapshot: bool
    amount_declared: Decimal
    other_description: str | None
    amount_accepted_for_calculation: Decimal
    flagged_for_review: bool
    verification_status: str
    verification_note: str | None
    # Employee §2.14: "Proof Upload | File upload (multiple)". Without the
    # attached proofs coming back, the upload control gave the employee no
    # evidence anything landed — and no way to tell an already-proved line from
    # one still missing its receipt. Populated by tax_declarations.py's
    # _line_to_out; the proof rows themselves are a separate table.
    proofs: list[TaxDeclarationLineProofOut] = []
    model_config = ConfigDict(from_attributes=True)


class TaxDeclarationOut(BaseModel):
    id: str
    employee_id: str
    financial_year_id: str
    tax_scheme_election_id: str | None
    status: str
    submitted_at: datetime | None
    submitted_by_user_id: str | None
    verified_by: str | None
    verified_at: datetime | None
    verification_note: str | None
    total_declared_amount: Decimal
    total_eligible_amount: Decimal
    has_flagged_lines: bool
    lines: list[TaxDeclarationLineOut] = []
    model_config = ConfigDict(from_attributes=True)


class TaxDeclarationVerifyLineDecision(BaseModel):
    verification_status: str  # ACCEPTED | REJECTED | NEEDS_MORE_INFO
    amount_accepted_for_calculation: Decimal | None = None
    verification_note: str | None = None


# ================================================================ ANNOUNCEMENTS
class AnnouncementCreate(BaseModel):
    title: str
    message: str
    # ck_ann_scope allows exactly these two — a Literal so the OpenAPI
    # contract says so and a wrong value is a 422 naming the field, instead
    # of the CHECK rejection escaping as a 500.
    target_scope: Literal["ALL_EMPLOYEES", "DEPARTMENT"]
    department_ids: list[str] = []
    expiry_date: date | None = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        # ck_ann_title: non-blank.
        if not v.strip():
            raise ValueError("Title is required")
        return v.strip()

    @field_validator("message")
    @classmethod
    def _validate_message(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Message is required")
        return v.strip()


class AnnouncementOut(BaseModel):
    id: str
    title: str
    message: str
    target_scope: str
    posted_by_user_id: str
    published_at: datetime | None
    expiry_date: date | None
    status: str
    department_ids: list[str] = []
    model_config = ConfigDict(from_attributes=True)
