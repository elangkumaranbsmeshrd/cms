// Shared row interfaces + constants for the whole Payroll module
// (06-payroll-module.md). Mirrors backend/app/schemas/payroll.py, in full,
// for every shape this module's screens consume — the same "one *.api.ts per
// feature module" convention asset.api.ts/customer.api.ts/employee.api.ts
// already establish (row interfaces + any small shared option lists, no
// HTTP service classes; screens call HttpClient directly).
//
// Decimal columns on every Pydantic-model-backed endpoint here (Payroll Runs,
// Ad-hoc Adjustments, Payslips — all real `response_model=...` classes) arrive
// as JSON STRINGS: Pydantic v2's own JSON-mode serialisation of `Decimal`,
// the same already-documented convention asset.api.ts's purchase_value and
// emp.salary-structure.component.ts's basic_salary_monthly rely on. The four
// GET /payroll/attendance/* endpoints are the one exception in this module —
// each declares `response_model=None` and hand-builds a bare dict/list
// (attendance_reconciliation.py) rather than returning a Pydantic model, so
// FastAPI's generic jsonable_encoder serialises those, which emits a real
// JSON number (int/float) for a Decimal, not a string. Typed `number` on
// those four row shapes below for that reason — a genuine backend-serialiser
// difference, not an inconsistency with the rest of this file.
//
// AdhocAdjustmentOut has NO `employee_ids` field (confirmed against the real
// schemas/payroll.py:105-127) — that field exists only on the CREATE schema
// (AdhocAdjustmentCreate, used to submit a new MULTIPLE_EMPLOYEES adjustment),
// never on what GET/List returns. Not modelled on AdhocAdjustmentRow below.

export const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function periodLabel(month: number, year: number): string {
  return `${MONTH_NAMES[month] ?? month} ${year}`;
}

// ============================================================ PAYROLL RUNS
export const RUN_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PROCESSED', label: 'Processed' },
];

export const EMPLOYEE_SELECTION_MODE_OPTIONS = [
  { value: 'ALL_ACTIVE', label: 'All Active Employees' },
  { value: 'SPECIFIC_EMPLOYEES', label: 'Specific Employees' },
];

// payroll_runs.py's own literal assignments (inclusion_status =), exhaustive.
export const INCLUSION_STATUS_OPTIONS = [
  { value: 'INCLUDED', label: 'Included' },
  { value: 'SKIPPED_ALREADY_PROCESSED', label: 'Skipped — Already Processed' },
  { value: 'EXCLUDED_NO_SALARY_STRUCTURE', label: 'Excluded — No Salary Structure' },
  { value: 'EXCLUDED_NOT_ACTIVE', label: 'Excluded — Not Active' },
];

// Mirrors PayrollRunEmployeeOut verbatim (schemas/payroll.py:21-57) — the
// Run Payroll Preview table's row shape, pre-Confirm. Deliberately has NO
// per-tax-head breakdown: only PayslipStatutoryLineOut (post-Confirm, a real
// generated Payslip) carries itemised tax lines — this row only ever has the
// lump total_employee_statutory/total_employer_statutory figures.
export interface PayrollRunEmployeeRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employee_id: string;
  readonly status: string; // DRAFT | PROCESSED — mirrors the parent run's own lifecycle at calc time
  readonly inclusion_status: string;
  readonly skip_reason: string | null;
  readonly gross_monthly_snapshot: string;
  readonly gross_pay: string;
  readonly total_days_in_period: string;
  readonly working_days: string;
  readonly present_days: string;
  readonly paid_leave_days: string;
  readonly unpaid_leave_days: string;
  readonly paid_days: string;
  readonly lop_days: string;
  readonly required_hours: string;
  readonly worked_hours: string;
  readonly comp_credit_hours: string;
  readonly leave_credit_hours: string;
  readonly credited_hours: string;
  readonly balance_hours: string;
  readonly comp_pending_hours: string;
  readonly net_short_hours: string;
  readonly unpaid_leave_deduction: string;
  readonly lop_deduction: string;
  readonly total_earnings: string;
  readonly total_employee_statutory: string;
  readonly total_employer_statutory: string;
  readonly income_tax_amount: string;
  readonly insurance_employee_contribution: string;
  readonly insurance_employer_contribution: string;
  readonly adhoc_addition_total: string;
  readonly adhoc_subtraction_total: string;
  readonly total_deductions: string;
  readonly net_pay: string;
}

// Mirrors PayrollRunOut verbatim (schemas/payroll.py:60-87).
export interface PayrollRunRow {
  readonly id: string;
  readonly financial_year_id: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly pay_period_start: string;
  readonly pay_period_end: string;
  readonly salary_credit_date: string;
  readonly total_days_in_period: string;
  readonly working_days_auto: string;
  readonly working_days_override: string | null;
  readonly working_days_effective: string;
  readonly employee_selection_mode: string;
  readonly status: string; // DRAFT | PROCESSED
  readonly employee_count: number;
  readonly total_gross: string;
  readonly total_employee_deductions: string;
  readonly total_employer_contributions: string;
  readonly total_net: string;
  readonly work_week_policy_note: string | null;
  // run_by/processed_by are raw platform User ids, resolved via GET /users
  // (see payroll.run-history.list.config.ts's own USER_REF) — separate from
  // the Employee-id lookups (/employees) used elsewhere in this module.
  readonly run_by: string;
  readonly run_on: string;
  readonly processed_by: string | null;
  readonly processed_at: string | null;
  readonly discarded_at: string | null;
  readonly notes: string | null;
  readonly employees: readonly PayrollRunEmployeeRow[];
}

// PayrollRunCreate's real request shape (schemas/payroll.py:13-18).
export interface PayrollRunCreateBody {
  readonly period_month: number;
  readonly period_year: number;
  readonly employee_selection_mode: string;
  readonly employee_ids: readonly string[];
  readonly working_days_override: number | null;
}

// ================================================== AD-HOC PAYSLIP ADJUSTMENTS
export const ADJUSTMENT_TYPE_OPTIONS = [
  { value: 'ADDITION', label: 'Addition' },
  { value: 'SUBTRACTION', label: 'Subtraction' },
];

export const ADJUSTMENT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'REMOVED', label: 'Removed' },
  { value: 'CONSUMED', label: 'Consumed' },
];

export const APPLIES_TO_MODE_OPTIONS = [
  { value: 'SINGLE_EMPLOYEE', label: 'Single Employee' },
  { value: 'MULTIPLE_EMPLOYEES', label: 'Multiple Employees' },
  { value: 'ALL_ACTIVE_EMPLOYEES', label: 'All Active Employees' },
];

export const APPLIES_TO_COMPONENT_OPTIONS = [
  { value: 'GROSS', label: 'Gross' },
  { value: 'NET', label: 'Net' },
];

// Mirrors AdhocAdjustmentOut verbatim (schemas/payroll.py:105-127) — no
// `employee_ids` (see this file's header note), and `effective_until` IS kept
// here (it really is on the wire) even though no screen in this module ever
// displays it — masters_taxes-style "the field is real, just dead" honesty,
// matching how the brief for this module explicitly calls out that no
// endpoint ever writes it.
export interface AdhocAdjustmentRow {
  readonly id: string;
  readonly financial_year_id: string;
  readonly applies_to_mode: string;
  readonly employee_id: string | null;
  readonly label: string;
  readonly adjustment_type: string; // ADDITION | SUBTRACTION
  readonly amount: string;
  readonly is_taxable: boolean;
  readonly is_recurring: boolean;
  readonly applies_to_component: string; // GROSS | NET
  readonly note: string | null;
  readonly effective_from: string;
  readonly effective_until: string | null; // dead — no endpoint ever writes it, not surfaced anywhere
  readonly source: string; // e.g. MANUAL | OFFER_LETTER
  readonly offer_letter_id: string | null;
  readonly offer_letter_custom_term_id: string | null;
  readonly status: string; // ACTIVE | REMOVED | CONSUMED
  readonly removed_at: string | null;
  readonly removal_reason: string | null;
  readonly target_employee_count: number;
  readonly applied_employee_count: number;
  readonly created_by: string | null; // raw platform User id — resolve via USER_REF, same as run_by on PayrollRunRow
  readonly created_at: string;
}

// AdhocAdjustmentCreate's real request shape (schemas/payroll.py:91-102).
export interface AdhocAdjustmentCreateBody {
  readonly applies_to_mode: string;
  readonly employee_id: string | null;
  readonly employee_ids: readonly string[];
  readonly label: string;
  readonly adjustment_type: string;
  readonly amount: number;
  readonly is_taxable: boolean;
  readonly is_recurring: boolean;
  readonly applies_to_component: string;
  readonly note: string | null;
  readonly effective_from: string | null;
}

// ===================================================================== PAYSLIPS
// Payslip.status really does default to "PROCESSED" (backend/app/models/
// payroll.py:231, `String(10), default="PROCESSED"`) — NOT "GENERATED". The
// already-built self-service baseline (employee/screens/my-payslips.list.
// config.ts) filters on {value:'GENERATED', label:'Processed'}, which cannot
// ever match a real row; that file is outside this task's folder boundary so
// it is left untouched, but this module's own admin list uses the verified
// real value below rather than copying that mismatch forward.
export const PAYSLIP_STATUS_OPTIONS = [
  { value: 'PROCESSED', label: 'Processed' },
  { value: 'REISSUED', label: 'Reissued' },
];

export const REISSUE_METHOD_OPTIONS = [
  { value: 'RECALCULATED', label: 'Recalculated' },
  { value: 'MANUAL_ADJUSTMENT', label: 'Manual Adjustment' },
];

export interface PayslipEarningLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly component_type: string;
  readonly label: string;
  readonly amount: string;
  readonly is_taxable: boolean;
  readonly source: string;
  readonly show_on_payslip: boolean;
}

export interface PayslipStatutoryLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly tax_head_id: string;
  readonly head_name_snapshot: string;
  readonly print_label_snapshot: string;
  readonly scope_snapshot: string;
  readonly computed_base: string;
  readonly computed_amount: string;
  readonly borne_by: string;
  readonly show_on_payslip_snapshot: boolean;
}

export interface PayslipAdjustmentLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly label_snapshot: string;
  readonly adjustment_type: string; // ADDITION | SUBTRACTION
  readonly amount: string;
  readonly signed_amount: string;
  readonly applies_to_component: string;
}

// Mirrors PayslipOut verbatim (schemas/payroll.py:172-209) — the admin
// Payslip list row AND (via the 'payslip' shape's loadEndpoint) detail row.
export interface PayslipAdminRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employee_id: string;
  readonly financial_year_id: string;
  readonly pay_period_start: string;
  readonly pay_period_end: string;
  readonly salary_credit_date: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly employee_code_snapshot: string;
  readonly employee_name_snapshot: string;
  readonly designation_snapshot: string | null;
  readonly department_snapshot: string | null; // KNOWN BACKEND BUG — see payroll.payslips.list.config.ts's own note; always blank today
  readonly employment_type_snapshot: string | null;
  readonly employee_bank_name_snapshot: string | null;
  readonly employee_bank_account_masked_snapshot: string | null;
  readonly gross_pay: string;
  readonly total_earnings: string;
  readonly total_deductions: string;
  readonly net_pay: string;
  readonly unpaid_leave_deduction: string;
  readonly lop_deduction: string;
  readonly income_tax_amount: string;
  readonly insurance_employee_contribution: string;
  readonly paid_days: string;
  readonly unpaid_leave_days: string;
  readonly lop_days: string;
  readonly has_unpaid_leave: boolean;
  readonly has_adhoc_adjustments: boolean;
  readonly status: string; // PROCESSED | REISSUED
  readonly reissue_count: number;
  readonly last_reissued_at: string | null;
  readonly generated_at: string;
  // Super Admin's own Created By / Last Modified By filters (§2.3) resolve
  // these — real columns (generated_by/AuditMixin's updated_by), exposed on
  // PayslipOut alongside this revision's filter work.
  readonly generated_by: string;
  readonly updated_by: string | null;
  readonly earning_lines: readonly PayslipEarningLineRow[];
  readonly statutory_lines: readonly PayslipStatutoryLineRow[];
  readonly adjustment_lines: readonly PayslipAdjustmentLineRow[];
}

// ReissueRequest's real request shape (schemas/payroll.py:212-219).
export interface ReissueRequestBody {
  readonly reason: string;
  readonly reissue_method: string; // RECALCULATED | MANUAL_ADJUSTMENT
  readonly manual_gross_pay: number | null;
  readonly manual_net_pay: number | null;
  readonly manual_total_earnings: number | null;
  readonly manual_total_deductions: number | null;
}

// ============================================================== ATTENDANCE & TIME BASIS
// The 4 endpoints below (attendance_reconciliation.py) all declare
// `response_model=None` and hand-build a bare dict/list rather than returning
// a Pydantic model — see this file's header note on why their Decimal-typed
// fields are modelled as `number` here, not `string` like every row above.

export interface AttendanceMonthlySummaryRow {
  readonly employee_id: string;
  readonly employee_code: string;
  readonly employee_name: string;
  readonly required_hours: number;
  readonly worked_hours: number;
  readonly comp_credit_hours: number;
  readonly leave_credit_hours: number;
  readonly credited_hours: number;
  readonly balance_hours: number;
  readonly comp_pending_hours: number;
  readonly hours_short: number;
  readonly net_short_hours: number;
  readonly payable_days: number;
  readonly status: string; // 'Met' | 'Short — compensable' | 'Short — payroll impact'
  readonly header_note: string | null;
  readonly is_locked: boolean;
}

export interface AttendanceDayWiseLogRow {
  readonly date: string;
  readonly day: string;
  readonly day_type: string;
  readonly check_in_time: string | null;
  readonly check_out_time: string | null;
  readonly break_hours: number;
  readonly required_hours: number;
  readonly worked_hours: number;
  readonly comp_hours: number;
  readonly balance_hours: number;
  readonly status: string;
  readonly note: string | null;
}

export interface AttendancePayrollImpactRow {
  readonly employee_id: string;
  readonly employee_code: string;
  readonly employee_name: string;
  readonly hours_short: number;
  readonly comp_pending_hours: number;
  readonly net_short_hours: number;
  readonly lop_days_net_of_pending: number;
  readonly estimated_deduction: number;
  readonly status: string;
  readonly next_step: string;
  readonly is_locked: boolean;
}

// CompensatoryHourRequest.status — same vocabulary as
// leave.comp-hours-approvals.list.config.ts's own STATUS_OPTIONS.
export const COMPENSATION_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

export interface AttendanceCompensationRow {
  readonly id: string;
  readonly request_number: string;
  readonly employee_id: string;
  readonly employee_code: string;
  readonly employee_name: string;
  readonly shortfall_date: string;
  readonly hours_short: number;
  readonly make_up_date: string;
  readonly hours_to_work: number;
  readonly hours_credited: number;
  readonly residual_shortfall_hours: number;
  readonly status: string;
  readonly routed_to_role: string | null;
  readonly estimated_payroll_impact: number;
  // A literal BACKEND API path ("/compensatory-hours/approvals"), NOT a real
  // Angular route — never bind this straight into a routerLink/router.navigate.
  readonly leave_module_endpoint: string;
}

export interface AttendanceBiometricSourceRow {
  readonly source: string;
  readonly label: string;
  readonly input_status: string; // LIVE | PLANNED
  readonly record_count: number;
}

export interface AttendanceBiometricFeedResponse {
  readonly sources: readonly AttendanceBiometricSourceRow[];
  readonly employees_biometric_enrolled: number;
  readonly employees_total: number;
  readonly note: string;
}

// ============================================================ EMPLOYEE PICKER
// Backs the reusable multi-employee picker (payroll.employee-picker.
// component.ts) — the live, searchable checkbox list Run Payroll's "Specific
// Employees" mode and Ad-hoc Adjustments' "Multiple Employees" mode both
// need. GET /employees returns the full EmployeeOut shape; only these fields
// are actually read by the picker.
export interface EmployeePickerRow {
  readonly id: string;
  readonly employee_code: string;
  readonly first_name: string;
  readonly last_name: string | null;
}
