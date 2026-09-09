"""Pydantic schemas for the 5 bespoke Masters sub-masters (Taxes, Company
Profile, Bank Account, Work Week & Hours, Email Configuration) — the ones
with real conditional logic or singleton/multi-tab structure, not covered by
the generic lookup factory (app/api/v1/masters_lookup.py).
"""

import re
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


# ============================================================== TAX ENGINE
class SlabBandIn(BaseModel):
    sequence_no: int
    band_from: Decimal
    band_to: Decimal | None = None
    rate_or_amount: Decimal
    band_label: str | None = None


class SlabBandOut(SlabBandIn):
    id: str
    model_config = ConfigDict(from_attributes=True)


class SplitComponentIn(BaseModel):
    sequence_no: int
    component_name: str
    share_pct: Decimal
    applies_when: str = "ALWAYS"
    condition_rule: dict | None = None


class SplitComponentOut(SplitComponentIn):
    id: str
    model_config = ConfigDict(from_attributes=True)


class ReliefRuleIn(BaseModel):
    relief_name: str
    applies_if_base_at_or_below: Decimal
    relief_type: str
    relief_amount: Decimal | None = None
    # Masters §3.2e Fields Table: Status (Active/Inactive), mandatory,
    # defaults Active — tax_head_relief_rules.is_active already exists on the
    # model with this same default; this was the only thing stopping the API
    # from accepting a caller-supplied value for it.
    is_active: bool = True


class ReliefRuleOut(ReliefRuleIn):
    id: str
    model_config = ConfigDict(from_attributes=True)


class TaxHeadCreate(BaseModel):
    tax_name: str
    short_code: str | None = None
    scope: str
    tax_type: str
    applies_from: date
    applies_until: date | None = None
    rate_pct: Decimal | None = None
    cgst_rate_pct: Decimal | None = None
    sgst_rate_pct: Decimal | None = None
    fixed_amount: Decimal | None = None
    declaration_cap: Decimal | None = None
    slab_application: str | None = None
    tax_scheme_id: str | None = None
    print_label: str | None = None
    notes: str | None = None
    behaviour: dict = {}
    creates_onward_liability: bool = False
    remitted_to_authority: str | None = None
    remittance_period: str | None = None
    period_aligns_to: str | None = None
    deposit_due_days_after_period_end: int | None = None
    liability_arises_on: str | None = None
    authority_reference_label: str | None = None
    withholding_directions: list[str] = []
    default_calculated_on: str | None = None
    certificate_expected: bool = False
    # §6a — createOnly, same shape as every other sub-master's own Status
    # field (§4a write-authority rule): settable only here, at creation;
    # afterward moves only through deactivate_tax_head's dedicated action.
    # Was missing from this schema entirely until now — masters_taxes.py had
    # no code path that could ever create an already-inactive head.
    is_active: bool = True
    slab_bands: list[SlabBandIn] = []
    split_components: list[SplitComponentIn] = []
    relief_rules: list[ReliefRuleIn] = []


class TaxHeadOut(BaseModel):
    id: str
    tax_name: str
    short_code: str | None
    scope: str
    tax_type: str
    applies_from: date
    applies_until: date | None
    rate_pct: Decimal | None
    cgst_rate_pct: Decimal | None
    sgst_rate_pct: Decimal | None
    fixed_amount: Decimal | None
    declaration_cap: Decimal | None
    slab_application: str | None
    tax_scheme_id: str | None
    print_label: str | None
    notes: str | None
    behaviour: dict
    creates_onward_liability: bool
    remitted_to_authority: str | None
    remittance_period: str | None
    period_aligns_to: str | None
    deposit_due_days_after_period_end: int | None
    liability_arises_on: str | None
    authority_reference_label: str | None
    withholding_directions: list[str] = []
    default_calculated_on: str | None
    certificate_expected: bool
    is_active: bool
    is_arithmetic_locked: bool
    usage_count: int
    slab_bands: list[SlabBandOut] = []
    split_components: list[SplitComponentOut] = []
    relief_rules: list[ReliefRuleOut] = []

    model_config = ConfigDict(from_attributes=True)


class TaxCalculationRequest(BaseModel):
    tax_head_id: str
    base_amount: Decimal
    as_of: date | None = None


class TaxCalculationResponse(BaseModel):
    tax_head_id: str
    label: str
    base_amount: Decimal
    gross_amount: Decimal
    computed_amount: Decimal
    components: list[dict]
    slab_breakdown: list[dict]
    reliefs_applied: list[dict]


# ============================================================= TAX SCHEMES
# §6b (MASTERS-COMPLETION-PROMPT.md) — app-forms.js 'm.tax.scheme': Scheme
# Name, Description, Is Default, Choice Window, Status. Matches the
# masters_lookup.py create_only_fields convention (§4a write-authority rule)
# rather than that factory itself, because "exactly one default" needs real
# swap logic no generic lookup router has — see masters_tax_schemes.py.
class TaxSchemeWrite(BaseModel):
    scheme_name: str
    description: str | None = None
    is_default: bool = False
    choice_window: str  # ONCE_PER_FY | ANY_TIME | FIXED_AT_JOINING — ck_tax_schemes_window


class TaxSchemeCreate(TaxSchemeWrite):
    is_active: bool = True


class TaxSchemeOut(TaxSchemeWrite):
    id: str
    is_active: bool
    # Live, not stored — same reasoning as masters_lookup.py's own
    # is_referenced (§3a): whether any TaxHead.tax_scheme_id points here,
    # checked before a deactivate/delete is allowed to proceed.
    is_referenced: bool = False
    # The Tax Schemes tab's own "Declaration Heads" column
    # (MASTERS-COMPLETION-PROMPT.md §6b) — how many Tax Heads currently name
    # this scheme, the count `is_referenced` above only reports as a boolean.
    declaration_heads_count: int = 0
    model_config = ConfigDict(from_attributes=True)


# ========================================================= COMPANY PROFILE
class CompanyProfileWrite(BaseModel):
    legal_name: str
    cin: str
    tan: str | None = None
    gstin: str | None = None
    pan: str
    company_type: str
    year_of_incorporation: int
    industry: str | None = None
    msme_registration_number: str | None = None
    phone: str
    alternate_phone: str | None = None
    official_email: str
    support_email: str | None = None
    website: str | None = None
    logo_file_id: str | None = None
    letterhead_file_id: str | None = None
    # Masters §3.6d's fourth upload section, "Invoice Template | File Upload
    # (single) | The layout file the Invoice module uses to generate invoice
    # PDFs". The column has existed since 0002_masters.py (and file_access.py
    # already publishes it org-wide alongside the logo and letterhead, because
    # every generated invoice embeds it), but it was never on this write
    # schema — so nothing in the system could set or read it and
    # invoices.download_invoice_pdf's own "the invoice template set in Company
    # Profile" was pointing at a field no screen could fill.
    invoice_template_file_id: str | None = None
    default_billing_tax_head_id: str | None = None
    payroll_basis: str = "HOUR_BASIS"  # HOUR_BASIS | DAY_BASIS — A121; only HOUR_BASIS is implemented
    # Masters §3.6, "New in this revision". Defaults Off: the spec defines Off
    # as an active refusal ("any inbound device payload is rejected"), so a
    # profile that has never been told otherwise must not accept device writes.
    biometric_attendance: bool = False
    biometric_device_endpoint: str | None = None

    @model_validator(mode="after")
    def _endpoint_required_when_biometric_on(self) -> "CompanyProfileWrite":
        # §3.6: "Conditional — required if Biometric Attendance is On … Where
        # the feed comes from, recorded so the source of an attendance record
        # is auditable." Enforced here rather than as a DB CHECK, which would
        # also reject every existing row that has the toggle Off and no
        # endpoint.
        if self.biometric_attendance and not (self.biometric_device_endpoint or "").strip():
            raise ValueError(
                "A Biometric Device Endpoint / Reference is required when Biometric Attendance is On — "
                "it records where the feed comes from, so the source of an attendance record stays auditable"
            )
        return self

    @field_validator("gstin")
    @classmethod
    def _validate_gstin(cls, v: str | None) -> str | None:
        # Masters §3.6a: "format-checked by the GST Validator utility." Also
        # enforced as a DB CHECK (ck_cp_gstin) — this is defense in depth, so
        # a bad value gets a clean 422 instead of a raw driver error.
        if v is not None and not GSTIN_PATTERN.match(v):
            raise ValueError("GSTIN is not a valid 15-character GSTIN")
        return v


class CompanyProfileOut(CompanyProfileWrite):
    id: str
    model_config = ConfigDict(from_attributes=True)


class IndianStateOut(BaseModel):
    id: str
    name: str
    code: str
    gst_state_code: str
    model_config = ConfigDict(from_attributes=True)


class CompanyAddressWrite(BaseModel):
    address_type: str
    line1: str
    line2: str | None = None
    city: str
    state_id: str
    pin_code: str


class CompanyAddressOut(CompanyAddressWrite):
    id: str
    is_primary: bool
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


class NumberPrefixRuleWrite(BaseModel):
    prefix: str
    include_fy_in_code: bool = True
    running_number_digits: int
    starting_number: int
    resets_every_fy: bool = True


class NumberPrefixRuleCreate(NumberPrefixRuleWrite):
    code_type: str
    label: str


class NumberPrefixRuleOut(BaseModel):
    id: str
    code_type: str
    label: str
    prefix: str
    include_fy_in_code: bool
    running_number_digits: int
    starting_number: int
    resets_every_fy: bool
    starting_number_locked: bool
    generated_count: int
    model_config = ConfigDict(from_attributes=True)


# ============================================================= BANK ACCOUNT
class BankAccountWrite(BaseModel):
    nickname: str
    bank_name: str
    account_holder_name: str
    account_number: str
    confirm_account_number: str  # A009: validated, never stored
    account_type: str
    ifsc: str
    branch: str
    upi_id: str | None = None
    upi_qr_file_id: str | None = None


class BankAccountCreate(BankAccountWrite):
    # §3b — createOnly, same shape as masters_lookup.py's create_only_fields:
    # accepted only here, not on BankAccountUpdate (whose own docstring
    # already excludes is_default/is_active on purpose — "those have their
    # own dedicated endpoints with their own guard logic").
    is_active: bool = True


class BankAccountUpdate(BaseModel):
    """Editing an existing account. account_number is included (accounts do
    occasionally need correcting, e.g. a typo caught after saving) and still
    goes through A009's Confirm Account Number check whenever it's supplied;
    is_default/is_active are deliberately excluded — those have their own
    dedicated endpoints with their own guard logic (set-default, deactivate).
    """

    nickname: str
    bank_name: str
    account_holder_name: str
    account_number: str
    confirm_account_number: str
    account_type: str
    ifsc: str
    branch: str
    upi_id: str | None = None
    upi_qr_file_id: str | None = None


class BankAccountOut(BaseModel):
    id: str
    nickname: str
    bank_name: str
    account_holder_name: str
    account_number: str
    account_type: str
    ifsc: str
    branch: str
    upi_id: str | None
    upi_qr_file_id: str | None
    is_default: bool
    is_active: bool
    # Masters §3.7 Screen Design: a lighter, informational confirmation is
    # shown before deactivating an account already used in past transactions.
    # Phase 1 has exactly one real consumer of bank_accounts (Expense Types'
    # optional default_bank_account_id) — this reflects that, and will grow
    # as Invoice/Expense/Purchase Bill payment records are built in later
    # phases and start referencing accounts too.
    is_referenced: bool = False
    model_config = ConfigDict(from_attributes=True)


# ====================================================== WORK WEEK & HOURS
class WorkWeekPolicyWrite(BaseModel):
    policy_name: str
    applies_to: str
    department_id: str | None = None
    designation_id: str | None = None
    employment_type_id: str | None = None
    effective_from: date
    gross_hours_per_day: Decimal
    unpaid_break_hours: Decimal = Decimal(0)
    grace_window_minutes: int = 0
    half_day_threshold_hours: Decimal | None = None
    count_overtime_beyond_net: bool = False
    weekly_hour_target: Decimal
    weekly_off_days: str
    saturday_rule: str
    working_saturday_hours_mode: str | None = None
    custom_saturday_hours: Decimal | None = None
    mandatory_holiday_overrides_saturday: bool = True
    allow_compensatory_hours: bool = True
    compensation_window_days: int | None = None
    make_up_day_chosen_by: str | None = None
    allow_makeup_on_week_off: bool = False
    allow_makeup_on_mandatory_holiday: bool = False
    max_comp_hours_per_month: Decimal = Decimal(0)
    uncompensated_shortfall_becomes: str = "PRO_RATA_LOP"
    excess_hours_become: str | None = None


class WorkWeekPolicyOut(WorkWeekPolicyWrite):
    id: str
    net_working_hours_per_day: Decimal
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


class WorkWeekPolicyCreate(WorkWeekPolicyWrite):
    # §3b — createOnly, same shape as masters_lookup.py's create_only_fields:
    # accepted on create, absent from WorkWeekPolicyWrite (what PUT uses), so
    # a role with plain 'edit' still can't flip Status through an ordinary
    # update — only create-time, or POST /{id}/deactivate|activate (Super
    # Admin only, §4a).
    is_active: bool = True


class SaturdayOverrideWrite(BaseModel):
    saturday_date: date
    financial_year_id: str
    work_week_policy_id: str | None = None
    override_to: str
    hours_required: Decimal
    reason: str
    notify_affected_employees: bool = False


class SaturdayOverrideOut(SaturdayOverrideWrite):
    id: str
    pattern_says: str | None = None
    model_config = ConfigDict(from_attributes=True)


class PayCycleWrite(BaseModel):
    cycle_type: str
    start_day: int | None = None
    end_day: int | None = None
    salary_credit_day: int
    effective_from: date


class PayCycleOut(PayCycleWrite):
    id: str
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


# ===================================================== EMAIL CONFIGURATION
class EmailServerSettingsWrite(BaseModel):
    sending_enabled: bool = False
    provider: str
    smtp_host: str | None = None
    smtp_port: int | None = None
    encryption: str | None = None
    username: str | None = None
    password: str | None = None  # write-only; encrypted before storage, never returned
    api_key: str | None = None  # write-only; encrypted before storage, never returned
    from_name: str
    from_email: str
    reply_to_email: str | None = None


class EmailServerSettingsOut(BaseModel):
    id: str
    sending_enabled: bool
    provider: str
    smtp_host: str | None
    smtp_port: int | None
    encryption: str | None
    username: str | None
    credential_hint: str | None  # last 4 chars only — Masters §3.21's masking convention
    from_name: str
    from_email: str
    reply_to_email: str | None
    model_config = ConfigDict(from_attributes=True)


class EmailTemplateWrite(BaseModel):
    is_enabled: bool
    subject: str
    body: str


class EmailTemplateCreate(BaseModel):
    # Masters §3.21: "Super Admin can add a row here the moment a future
    # module introduces a new notification." template_key is the stable
    # machine key other code fires by; template_name/triggered_from_* are
    # what the seeded starting rows also carry — this is the same shape,
    # just usable for a row that doesn't come from initial seeding.
    template_key: str
    template_name: str
    triggered_from_module: str
    triggered_from_screen: str | None = None
    is_enabled: bool = True
    subject: str
    body: str
    available_placeholders: list = []


class EmailTemplateOut(BaseModel):
    id: str
    template_key: str
    template_name: str
    triggered_from_module: str
    triggered_from_screen: str | None
    is_enabled: bool
    subject: str
    body: str
    available_placeholders: list
    model_config = ConfigDict(from_attributes=True)


class SendTestEmailRequest(BaseModel):
    to_email: str


class EmailSendLogOut(BaseModel):
    id: str
    email_template_id: str | None
    recipient_email: str
    subject_snapshot: str
    sent_at: datetime
    delivery_status: str
    # Real transport wiring (Phase 6) is what first populates these — without
    # them Recent Sends couldn't answer its own stated purpose, "troubleshoot
    # one specific delivery," since a FAILED row gave no reason why.
    provider_message_id: str | None = None
    error_detail: str | None = None
    related_record_type: str | None = None
    related_record_id: str | None = None
    model_config = ConfigDict(from_attributes=True)
