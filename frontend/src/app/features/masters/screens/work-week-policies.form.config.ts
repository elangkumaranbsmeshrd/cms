import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { WorkWeekPolicyRow } from '../masters.api';

// Values from the real CHECK constraints (alembic/versions/0002_masters.py,
// ck_wwp_*); labels are the prototype's own option strings (app-forms.js
// 'm.workweek'), so the form, the list's staticOptions and the spec's Fields
// Table all read the same words.
const APPLIES_TO_OPTIONS = [
  { value: 'COMPANY_WIDE', label: 'Company-wide (default)' },
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'DESIGNATION', label: 'Designation' },
  { value: 'EMPLOYMENT_TYPE', label: 'Employment Type' },
  { value: 'SPECIFIC_EMPLOYEES', label: 'Specific Employees' },
];
// KNOWN GAP — SPECIFIC_EMPLOYEES above is selectable but has no field below
// to scope it to anyone. The prototype's own form (app-forms.js:84-85) has
// one generic 'Applies To — Value' select whose hint claims "the list
// changes to match whichever dimension is selected above", but its
// renderer (U.field / U.section, app-core.js:336-372) is a static mockup
// with no onchange wiring at all — that reactivity was never actually
// built — and the field's fixed opts list (app-forms.js:85) never contains
// an employee name anyway, only department/employment-type strings. So even
// the prototype does not really let an admin name specific employees; it
// only gestures at the intent, same as this build now does.
// The three FK selects below (department_id/designation_id/
// employment_type_id) are the faithful realization of that intent for the
// three dimensions the backend actually supports. There is no fourth one
// for SPECIFIC_EMPLOYEES because there is nothing to wire it to yet:
// WorkWeekPolicyWrite (backend/app/schemas/masters.py:293-318) has no
// employee-id list field, ck_wwp_applies_to_match (alembic/versions/
// 0002_masters.py) imposes no requirement at all for SPECIFIC_EMPLOYEES
// (unlike the other three dimensions, each of which requires its FK), and
// WorkWeekPolicyEmployee (backend/app/models/masters.py:400-406) — the
// assignment table this would need — carries its own comment that it has
// "No FK yet" to `employees` because Module 2 doesn't exist until Phase 2.
// 01-masters-module.md:1243 documents this as PARTIAL: the table exists and
// Payroll resolves against it, but no Masters endpoint populates it, so a
// per-employee policy cannot be assigned through this screen's API today.
// Once that endpoint exists, add a multiselect employee field here, visible
// only when applies_to === 'SPECIFIC_EMPLOYEES', wired to it.
const WEEKLY_OFF_OPTIONS = [
  { value: 'SUNDAY', label: 'Sunday' },
  { value: 'SAT_SUN', label: 'Saturday, Sunday' },
  { value: 'SUN_ALT_SAT', label: 'Sunday + alternate Saturday' },
  { value: 'ROTATIONAL_ONE', label: 'Rotational — 1 day/week' },
  { value: 'FRIDAY', label: 'Friday' },
  { value: 'NONE', label: 'None' },
];
const SATURDAY_RULE_OPTIONS = [
  { value: 'ODD_WORKING', label: 'Odd Saturdays Working (1st, 3rd, 5th)' },
  { value: 'EVEN_WORKING', label: 'Even Saturdays Working (2nd, 4th)' },
  { value: 'ALL_WORKING', label: 'All Saturdays Working' },
  { value: 'ALL_OFF', label: 'All Saturdays Off' },
  { value: 'FIRST_ONLY', label: 'First Saturday Only' },
  { value: 'LAST_ONLY', label: 'Last Saturday Only' },
  { value: 'CUSTOM', label: 'Custom — set each Saturday by hand' },
];
const SAT_HOURS_MODE_OPTIONS = [
  { value: 'FULL', label: 'Full day — same as Net Working Hours' },
  { value: 'HALF', label: 'Half day — 50% of Net Working Hours' },
  { value: 'CUSTOM', label: 'Custom hours' },
];
// Exported (§4) — work-week.tabbed.config.ts's new Compensation tab reads
// these same labels for its read-only display, so the tab and this form can
// never show different words for the same stored value.
export const MAKEUP_BY_OPTIONS = [
  { value: 'EMPLOYEE_WITH_APPROVAL', label: 'Employee — subject to approval' },
  { value: 'EMPLOYEE_NO_APPROVAL', label: 'Employee — no approval needed' },
  { value: 'MANAGER_ASSIGNS', label: 'Manager assigns the day' },
];
export const SHORTFALL_OPTIONS = [
  { value: 'PRO_RATA_LOP', label: 'Pro-rata per hour (Loss of Pay)' },
  { value: 'ROUND_HALF_DAY', label: 'Rounded to nearest half day' },
  { value: 'ROUND_FULL_DAY', label: 'Rounded up to a full day' },
  { value: 'LEAVE_THEN_LOP', label: 'Leave balance first, then Loss of Pay' },
  { value: 'IGNORE', label: 'Ignore — no payroll impact' },
];
export const EXCESS_OPTIONS = [
  { value: 'COMP_CREDIT', label: 'Compensatory credit (expires with the window)' },
  { value: 'COMP_OFF_LEAVE', label: 'Comp Off leave balance' },
  { value: 'PAID_OVERTIME', label: 'Paid overtime' },
  { value: 'NOT_TRACKED', label: 'Nothing — not tracked' },
];
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const DESIGNATION_REF = { endpoint: '/masters/designations/options', labelKey: 'label' };
const EMPLOYMENT_TYPE_REF = { endpoint: '/masters/employment-types/options', labelKey: 'label' };

/** Masters §3.20 Fields Table, Net Working Hours per Day: "Number — **derived,
 * never typed**. Gross − Break." It is a STORED GENERATED column server-side
 * (models.masters.WorkWeekPolicy.net_working_hours_per_day is Computed(), and
 * create_policy deliberately never passes it), so it must not appear as an
 * input here either — this is the previewFields mechanism's exact purpose:
 * shown live as the two real inputs change, never submitted. */
function netWorkingHours(model: Partial<WorkWeekPolicyRow>): string {
  // `== null` rather than a bare Number() check: clearing a number input binds
  // null, and Number(null) is 0, which would quietly render a wrong figure
  // instead of admitting there is nothing to derive from yet.
  if (model.gross_hours_per_day == null) return 'Enter Gross Hours per Day to see the derived figure.';
  const gross = Number(model.gross_hours_per_day);
  const brk = Number(model.unpaid_break_hours ?? 0);
  if (!Number.isFinite(gross) || !Number.isFinite(brk)) return '—';
  return `${(gross - brk).toFixed(2)} hours`;
}

const config: FormScreenConfig<WorkWeekPolicyRow> = {
  shape: 'form',
  id: 'masters.work_week_hours',
  title: 'Work Week Policy',
  listEndpoint: '/masters/work-week-policies',
  createEndpoint: '/masters/work-week-policies',
  updateEndpoint: (id) => `/masters/work-week-policies/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/work-week-hours/policies'],
  emptyRow: () => ({
    policy_name: '',
    applies_to: 'COMPANY_WIDE',
    department_id: null,
    designation_id: null,
    employment_type_id: null,
    effective_from: '',
    gross_hours_per_day: 9,
    unpaid_break_hours: 1,
    grace_window_minutes: 15,
    half_day_threshold_hours: 4,
    count_overtime_beyond_net: true,
    weekly_hour_target: 40,
    weekly_off_days: 'SUNDAY',
    saturday_rule: 'ODD_WORKING',
    working_saturday_hours_mode: 'FULL',
    custom_saturday_hours: null,
    mandatory_holiday_overrides_saturday: true,
    allow_compensatory_hours: true,
    compensation_window_days: 30,
    make_up_day_chosen_by: 'EMPLOYEE_WITH_APPROVAL',
    allow_makeup_on_week_off: true,
    allow_makeup_on_mandatory_holiday: false,
    max_comp_hours_per_month: 16,
    uncompensated_shortfall_becomes: 'PRO_RATA_LOP',
    excess_hours_become: 'COMP_CREDIT',
    is_active: true,
  }),
  // One flat list, in the prototype's own four-group order (Policy / Daily
  // Hours / Week Pattern / Shortfall & Compensation) — FormScreenConfig has no
  // section concept, so the order is what carries the grouping.
  fields: [
    // ---- Policy ----------------------------------------------------------
    {
      key: 'policy_name',
      label: 'Policy Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Standard — 40 Hour Week',
      hint: 'Free text — name it however the company talks about it',
    },
    {
      key: 'applies_to',
      label: 'Applies To',
      type: 'select',
      required: true,
      staticOptions: APPLIES_TO_OPTIONS,
      hint: 'Company-wide is the fallback, and exactly one Company-wide policy may be Active at a time. A narrower policy always wins over it for the people it covers',
    },
    // The prototype has ONE "Applies To — Value" select whose contents follow
    // the dimension above; the backend has three separate FK columns and a
    // CHECK (ck_wwp_applies_to_match) that the matching one be non-null. Shown
    // one at a time via visibleWhen, which also means the other two are not
    // submitted at all — so switching Applies To on an existing policy clears
    // the stale FK server-side instead of tripping the constraint.
    {
      key: 'department_id',
      label: 'Applies To — Department',
      type: 'select',
      ref: DEPARTMENT_REF,
      required: true,
      visibleWhen: (model) => model['applies_to'] === 'DEPARTMENT',
      hint: 'Required when Applies To is Department',
    },
    {
      key: 'designation_id',
      label: 'Applies To — Designation',
      type: 'select',
      ref: DESIGNATION_REF,
      required: true,
      visibleWhen: (model) => model['applies_to'] === 'DESIGNATION',
      hint: 'Required when Applies To is Designation',
    },
    {
      key: 'employment_type_id',
      label: 'Applies To — Employment Type',
      type: 'select',
      ref: EMPLOYMENT_TYPE_REF,
      required: true,
      visibleWhen: (model) => model['applies_to'] === 'EMPLOYMENT_TYPE',
      hint: 'Required when Applies To is Employment Type',
    },
    {
      key: 'effective_from',
      label: 'Effective From',
      type: 'date',
      required: true,
      hint: 'A policy change never rewrites a payroll period that has already been processed',
    },
    // ---- Daily Hours -----------------------------------------------------
    {
      key: 'gross_hours_per_day',
      label: 'Gross Hours per Day',
      type: 'number',
      required: true,
      hint: 'Total time on site — from check-in to check-out',
    },
    {
      key: 'unpaid_break_hours',
      label: 'Unpaid Break (hours)',
      type: 'number',
      required: true,
      hint: 'Deducted from Gross before anything is credited',
    },
    {
      key: 'grace_window_minutes',
      label: 'Grace Window (minutes)',
      type: 'number',
      hint: 'A day that lands inside this much of the target still counts as a Full Day. Set 0 to switch grace off entirely',
    },
    {
      key: 'half_day_threshold_hours',
      label: 'Half Day Threshold (hours)',
      type: 'number',
      hint: 'At or above this but below the full target, the day is a Half Day. Below it, the day is Absent',
    },
    {
      key: 'count_overtime_beyond_net',
      label: 'Count Overtime Beyond Net',
      type: 'checkbox',
      hint: 'When on, hours past the daily target are banked and can offset a shortfall elsewhere in the same period',
    },
    // ---- Week Pattern ----------------------------------------------------
    {
      key: 'weekly_hour_target',
      label: 'Weekly Hour Target',
      type: 'number',
      required: true,
      hint: 'Hours per week excluding Saturdays — 5 days × 8 net hours on the default policy. Payroll checks the monthly total, but this is the figure people quote',
    },
    {
      key: 'weekly_off_days',
      label: 'Weekly Off Day(s)',
      type: 'select',
      required: true,
      staticOptions: WEEKLY_OFF_OPTIONS,
      hint: 'The fixed non-working day(s). Saturdays are handled separately below, because they are usually a pattern rather than a flat rule',
    },
    {
      key: 'saturday_rule',
      label: 'Saturday Rule',
      type: 'select',
      required: true,
      staticOptions: SATURDAY_RULE_OPTIONS,
      hint: 'This is the dynamic bit. Odd/even is the common pattern, but nothing forces it — pick any option, or Custom to flip Saturdays one at a time on the Saturday Overrides screen',
    },
    {
      key: 'working_saturday_hours_mode',
      label: 'Hours on a Working Saturday',
      type: 'select',
      staticOptions: SAT_HOURS_MODE_OPTIONS,
      hint: 'Many companies run a working Saturday as a half day. If Custom hours, enter the figure below',
    },
    {
      // ck_wwp_custom_sat_hours: NOT NULL exactly when the mode is CUSTOM —
      // so the field appears (and is required) only then, and is not submitted
      // at all otherwise.
      key: 'custom_saturday_hours',
      label: 'Custom Saturday Hours',
      type: 'number',
      required: true,
      visibleWhen: (model) => model['working_saturday_hours_mode'] === 'CUSTOM',
      placeholder: 'e.g. 5',
      hint: 'Only used when Hours on a Working Saturday is Custom hours',
    },
    {
      key: 'mandatory_holiday_overrides_saturday',
      label: 'Mandatory Holiday Overrides Saturday',
      type: 'checkbox',
      required: true,
      hint: 'Recommended on. A Mandatory holiday falling on a working Saturday makes it non-working; an Optional holiday does not',
    },
    // ---- Shortfall & Compensation ---------------------------------------
    {
      key: 'allow_compensatory_hours',
      label: 'Allow Compensatory Hours',
      type: 'checkbox',
      hint: 'The core rule: someone who leaves halfway through the day can work the missing hours on another day of their own choosing instead of losing pay',
    },
    {
      key: 'compensation_window_days',
      label: 'Compensation Window (days)',
      type: 'number',
      hint: 'How long after the shortfall the make-up day may fall. 0 means it must be inside the same payroll period',
    },
    {
      key: 'make_up_day_chosen_by',
      label: 'Make-Up Day Chosen By',
      type: 'select',
      staticOptions: MAKEUP_BY_OPTIONS,
      hint: 'Default lets the employee pick, with their manager confirming it',
    },
    {
      key: 'allow_makeup_on_week_off',
      label: 'Allow Make-Up on a Week Off',
      type: 'checkbox',
      hint: 'Off Saturdays are the most common make-up day in practice',
    },
    {
      key: 'allow_makeup_on_mandatory_holiday',
      label: 'Allow Make-Up on a Mandatory Holiday',
      type: 'checkbox',
      hint: 'Left off by default — a mandatory holiday should stay a holiday',
    },
    {
      key: 'max_comp_hours_per_month',
      label: 'Max Compensatory Hours per Month',
      type: 'number',
      hint: 'A ceiling, so compensation cannot quietly become unpaid overtime. 0 removes the cap',
    },
    {
      key: 'uncompensated_shortfall_becomes',
      label: 'Uncompensated Shortfall Becomes',
      type: 'select',
      required: true,
      staticOptions: SHORTFALL_OPTIONS,
      hint: 'What Payroll does with hours that were never made up. Pro-rata is the fairest and the default',
    },
    {
      key: 'excess_hours_become',
      label: 'Excess Hours Become',
      type: 'select',
      staticOptions: EXCESS_OPTIONS,
      hint: 'The mirror of the rule above, for people who work past the target',
    },
    {
      // §3b — createOnly (WorkWeekPolicyCreate, backend/app/schemas/masters.py),
      // settable only when adding a new policy. Once a row exists, Status only
      // moves through the list screen's Super-Admin-only Deactivate/Activate
      // row actions (§4a) — both real now; /activate previously didn't exist.
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: 'Defaults to Active. Uncheck to create this policy already inactive — e.g. staging next FY\'s rules before they take effect.',
    },
  ],
  previewFields: [
    { label: 'Net Working Hours per Day (derived — Gross − Break)', compute: netWorkingHours },
  ],
};

export default config;
