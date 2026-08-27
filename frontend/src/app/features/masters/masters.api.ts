// Row shapes for the simple Masters lookups (backend/app/api/v1/masters_simple.py's
// masters_lookup.py factory) — every one returns {id, is_active, ...fields}.
// Holidays is deliberately NOT here yet: its financial_year_id is a required
// FK and Financial Year has no screen built yet to source it from — building
// Holidays without a real way to pick a year would 422 on every create.

export interface ExpenseTypeRow {
  id: string;
  is_active: boolean;
  name: string;
  short_code: string | null;
  claim_type: string; // REIMBURSABLE | COMPANY_PAID
  is_recurring: boolean;
  default_bank_account_id: string | null;
  description: string | null;
  // Factory read_only_fields (masters_simple.py:69-73) — server-computed, on
  // the response but never on the write schema.
  usage_count?: number;
  previous_claim_type?: string | null;
  claim_type_changed_at?: string | null;
}

export interface LeaveTypeRow {
  id: string;
  is_active: boolean;
  name: string;
  short_code: string | null;
  is_paid: boolean;
  default_annual_quota_days: number;
  carry_forward_allowed: boolean;
  max_carry_forward_days: number | null;
  is_quota_tracked: boolean;
}

export interface PaymentModeRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  requires_reference_number: boolean;
  is_referenced: boolean;
}

export interface DepartmentRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  description: string | null;
  is_referenced: boolean;
}

export interface DesignationRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  department_id: string | null;
  level_grade: string | null;
  is_referenced: boolean;
}

export interface HsnSacCodeRow {
  id: string;
  is_active: boolean;
  code: string;
  code_type: string; // HSN | SAC
  description: string;
  // §3.11: each code optionally links to a REAL editable tax head from Masters
  // → Taxes, never a fixed label. All four are real fields on the factory's
  // response (masters_simple.py:186-194).
  linked_tax_head_id: string | null;
  is_custom: boolean;
  custom_gst_type: string | null;
  custom_gst_rate_pct: number | null;
}

export interface ServiceCategoryRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  description: string | null;
  is_referenced: boolean;
}

export interface UnitOfMeasureRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  // Always false — units_of_measure has zero referencing tables anywhere in
  // the schema today (masters_simple.py's registration passes referenced_by
  // =[], a checked "never", not an unchecked omission).
  is_referenced: boolean;
}

export interface TicketCategoryRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  description: string | null;
  is_referenced: boolean;
}

export interface CustomerStatusRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  is_referenced: boolean;
}

export interface CustomerSourceRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  is_referenced: boolean;
}

export interface AssetCategoryRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  description: string | null;
  // Masters §3.17 doesn't spec this — carried over from the prototype's own
  // Add form (app-forms.js:277), feeds Asset Management's Straight Line
  // depreciation as the category's default.
  default_useful_life_years: number | null;
  is_referenced: boolean;
}

export interface EmploymentTypeRow {
  id: string;
  is_active: boolean;
  name: string;
  code: string | null;
  is_referenced: boolean;
}

export interface InsurancePlanRow {
  id: string;
  is_active: boolean;
  plan_name: string;
  plan_type: string; // HEALTH | LIFE | PERSONAL_ACCIDENT
  provider: string | null;
  coverage_amount: number;
  company_contribution_monthly: number;
  employee_contribution_monthly: number;
}

// backend/app/api/v1/masters_bank_accounts.py — bespoke, not the simple-
// lookup factory: a "one default account" singleton rule plus A009 (Confirm
// Account Number is validated on every write, never stored). confirm_
// account_number is write-only and never present in the real GET response,
// so on edit the user must re-type it even to change something unrelated
// like Branch — that's the real backend rule, not a frontend gap.
export interface BankAccountRow {
  id: string;
  is_active: boolean;
  nickname: string;
  bank_name: string;
  account_holder_name: string;
  account_number: string;
  confirm_account_number?: string;
  account_type: string;
  ifsc: string;
  branch: string;
  upi_id: string | null;
  // §3c/§5 — real FK to stored_files (models/masters.py:136), settable via
  // the same 'file' FieldConfig type Company Profile's Documents tab uses.
  upi_qr_file_id: string | null;
  is_default: boolean;
  is_referenced: boolean;
}

// Holidays DOES use the simple-lookup factory (has a real PUT, unlike
// Financial Year) — it just needed Financial Year's screen to exist first
// so financial_year_id has somewhere real to source a value from.
export interface HolidayRow {
  id: string;
  is_active: boolean;
  name: string;
  holiday_date: string;
  financial_year_id: string;
  holiday_type: string; // MANDATORY | OPTIONAL
  recurring_every_year: boolean;
}

// backend/app/api/v1/masters_company_profile.py — singleton (no id) plus
// two real sub-resources. Bank Details deliberately isn't duplicated here
// (spec: "the same list ... shown here for convenience, not a copy") —
// callers use /masters/bank-accounts directly, so this screen links there.
export interface CompanyProfileRow {
  legal_name: string;
  cin: string;
  tan: string | null;
  gstin: string | null;
  pan: string;
  company_type: string;
  year_of_incorporation: number;
  industry: string | null;
  msme_registration_number: string | null;
  phone: string;
  alternate_phone: string | null;
  official_email: string;
  support_email: string | null;
  website: string | null;
  payroll_basis: string;
  // Real on CompanyProfileWrite (:161) — §3.6's default billing tax, chosen
  // from Masters → Taxes. Without it declared the field was unsettable.
  default_billing_tax_head_id: string | null;
  // §5 — the Documents tab's own two fields. Real FKs to stored_files
  // (models/masters.py:339-340), read by pdf_engine.company_logo_bytes() on
  // every generated invoice/payslip/offer letter.
  logo_file_id: string | null;
  letterhead_file_id: string | null;
  // §3.6, "New in this revision" — the biometric input-source gate and the
  // feed reference it makes mandatory once switched on. Off means device
  // payloads are refused outright, so a profile that has never been told
  // otherwise must read as false rather than undefined.
  biometric_attendance: boolean;
  biometric_device_endpoint: string | null;
}

export interface CompanyAddressRow {
  id: string;
  is_active: boolean;
  address_type: string;
  line1: string;
  line2: string | null;
  city: string;
  state_id: string;
  pin_code: string;
  is_primary: boolean;
}

export interface NumberPrefixRuleRow {
  id: string;
  code_type: string;
  label: string;
  prefix: string;
  include_fy_in_code: boolean;
  running_number_digits: number;
  starting_number: number;
  resets_every_fy: boolean;
  starting_number_locked: boolean;
  generated_count: number;
}

// backend/app/api/v1/masters_work_week.py. Enum-shaped fields' allowed
// values are transcribed verbatim from the real DB CHECK constraints
// (alembic/versions/0002_masters.py) — NOT guessed, after Company Address's
// address_type field taught this project's static enums must be read from
// the migration, not inferred from field names.
export interface WorkWeekPolicyRow {
  id: string;
  is_active: boolean;
  policy_name: string;
  applies_to: string; // COMPANY_WIDE | DEPARTMENT | DESIGNATION | EMPLOYMENT_TYPE | SPECIFIC_EMPLOYEES
  department_id: string | null;
  designation_id: string | null;
  employment_type_id: string | null;
  effective_from: string;
  gross_hours_per_day: number;
  unpaid_break_hours: number;
  grace_window_minutes: number;
  half_day_threshold_hours: number | null;
  count_overtime_beyond_net: boolean;
  weekly_hour_target: number;
  weekly_off_days: string; // SUNDAY | SAT_SUN | SUN_ALT_SAT | ROTATIONAL_ONE | FRIDAY | NONE
  saturday_rule: string; // ODD_WORKING | EVEN_WORKING | ALL_WORKING | ALL_OFF | FIRST_ONLY | LAST_ONLY | CUSTOM
  working_saturday_hours_mode: string | null; // FULL | HALF | CUSTOM
  custom_saturday_hours: number | null;
  mandatory_holiday_overrides_saturday: boolean;
  allow_compensatory_hours: boolean;
  compensation_window_days: number | null;
  make_up_day_chosen_by: string | null; // EMPLOYEE_WITH_APPROVAL | EMPLOYEE_NO_APPROVAL | MANAGER_ASSIGNS
  allow_makeup_on_week_off: boolean;
  allow_makeup_on_mandatory_holiday: boolean;
  max_comp_hours_per_month: number;
  uncompensated_shortfall_becomes: string; // PRO_RATA_LOP | ROUND_HALF_DAY | ROUND_FULL_DAY | LEAVE_THEN_LOP | IGNORE
  excess_hours_become: string | null; // COMP_CREDIT | COMP_OFF_LEAVE | PAID_OVERTIME | NOT_TRACKED
  // §3.20: gross hours minus the unpaid break. DERIVED server-side
  // (WorkWeekPolicyOut:319) and never typed — read-only here by construction,
  // since it appears on no write schema.
  net_working_hours_per_day: number;
}

export interface PayCycleRow {
  id: string;
  is_active: boolean;
  cycle_type: string;
  start_day: number | null;
  end_day: number | null;
  salary_credit_day: number;
  effective_from: string;
}

/** §3.20c's Resolved Periods row — "Read-only, derived… Not stored". Every
 * field here is computed per request by GET /masters/pay-cycles/resolved-
 * periods from the ACTIVE pay cycle, through the same resolve_pay_period()
 * Run Payroll pays people by; nothing on this row is a column anywhere. */
export interface ResolvedPeriodRow {
  id: string; // 'yyyy-mm' of the payroll month, not a record id
  payroll_month: string; // 'August 2026' — the month a person asks Run Payroll for
  period_start: string;
  period_end: string;
  salary_credit_date: string;
  days_in_period: number;
}

export interface SaturdayOverrideRow {
  id: string;
  saturday_date: string;
  financial_year_id: string;
  work_week_policy_id: string | null;
  pattern_says: string | null;
  override_to: string;
  hours_required: number;
  reason: string;
  notify_affected_employees: boolean;
}

// backend/app/api/v1/masters_taxes.py — the biggest sub-master: a parent
// backend/app/api/v1/masters_tax_schemes.py. §6b — optional alternative tax
// regimes; tax_heads.tax_scheme_id tags which declaration heads belong to
// which scheme. Zero rows is a valid, common state (§3.2d).
export interface TaxSchemeRow {
  id: string;
  is_active: boolean;
  scheme_name: string;
  description: string | null;
  is_default: boolean;
  choice_window: string; // ONCE_PER_FY | ANY_TIME | FIXED_AT_JOINING
  is_referenced: boolean;
}

// TaxHead plus 4 real child-row collections that live inside the SAME
// create/update body (TaxHeadCreate), not separate endpoints. No GET/{id}
// either (list-only detail, like the simple lookups) — 'form' shape fits.
// Enum fields transcribed from the real CHECK constraints
// (alembic/versions/0002_masters.py), not guessed.
export interface TaxHeadRow {
  id: string;
  is_active: boolean;
  is_arithmetic_locked: boolean;
  usage_count: number;
  tax_name: string;
  short_code: string | null;
  scope: string;
  tax_type: string;
  applies_from: string;
  applies_until: string | null;
  rate_pct: number | null;
  cgst_rate_pct: number | null;
  sgst_rate_pct: number | null;
  fixed_amount: number | null;
  declaration_cap: number | null;
  slab_application: string | null; // PROGRESSIVE | FLAT_BY_BAND
  // §6b — real FK to tax_schemes (masters.py:46), NULL when no scheme applies
  // or none are configured at all. Only meaningful on payroll/declaration
  // scopes (ARCH-1-database-schema.md:588).
  tax_scheme_id: string | null;
  print_label: string | null;
  notes: string | null;
  creates_onward_liability: boolean;
  remitted_to_authority: string | null;
  remittance_period: string | null; // PER_DOCUMENT | MONTHLY | QUARTERLY | HALF_YEARLY | ANNUAL
  period_aligns_to: string | null; // CALENDAR | FINANCIAL_YEAR | PAY_CYCLE
  deposit_due_days_after_period_end: number | null;
  liability_arises_on: string | null; // SOURCE_DOCUMENT_DATE | PAYMENT_DATE
  authority_reference_label: string | null;
  default_calculated_on: string | null; // SUBTOTAL | TOTAL
  certificate_expected: boolean;
  slab_bands: { sequence_no: number; band_from: number; band_to: number | null; rate_or_amount: number }[];
  split_components: { component_name: string; share_pct: number }[];
  relief_rules: { relief_name: string; applies_if_base_at_or_below: number; relief_type: string; relief_amount: number | null }[];
  // Not exposed as an editable control this pass (only 2 values, but a
  // list-of-strings needs a different UI than the object-row array editor
  // built for the other 3 collections) — the full-object-copy safety net
  // preserves whatever a loaded row already has on edit.
  withholding_directions?: string[];
}

// backend/app/api/v1/masters_email_config.py
export interface EmailServerSettingsRow {
  id: string;
  sending_enabled: boolean;
  provider: string;
  smtp_host: string | null;
  smtp_port: number | null;
  encryption: string | null;
  username: string | null;
  password?: string; // write-only, never returned by GET
  api_key?: string; // write-only, never returned by GET
  credential_hint: string | null;
  from_name: string;
  from_email: string;
  reply_to_email: string | null;
}

export interface EmailTemplateRow {
  id: string;
  template_key: string;
  template_name: string;
  triggered_from_module: string;
  triggered_from_screen: string | null;
  is_enabled: boolean;
  subject: string;
  body: string;
}

export interface EmailSendLogRow {
  id: string;
  email_template_id: string | null; // real on EmailSendLogOut; resolves to the trigger's name
  recipient_email: string;
  subject_snapshot: string;
  sent_at: string;
  delivery_status: string;
  error_detail: string | null;
}

// backend/app/api/v1/financial_years.py — bespoke router, not the simple-
// lookup factory. No PUT at all: label/end_date are server-derived from
// start_date, and status only ever moves via the dedicated lock/set-current/
// unlock action endpoints (never a general-purpose edit). Unlock is Super
// Admin-only (RBAC + a DB trigger that only that one code path can satisfy —
// see migration 0009), reversing the original "locking is categorically
// one-way" decision (A002).
export interface FinancialYearRow {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string; // 'open' | 'locked'
  is_current: boolean;
  // Real columns, stamped by POST /{id}/lock. Previously dropped by the
  // response schema even though the database always had them.
  locked_at: string | null;
  locked_by_name: string | null;
}
