import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { WorkWeekPolicyRow } from '../masters.api';

// Every list below is the real CHECK-constraint value set from
// alembic/versions/0002_masters.py (ck_wwp_applies_to, ck_wwp_weekly_off,
// ck_wwp_sat_rule, ck_wwp_shortfall) — not guessed, and not a second copy of
// the prototype's display strings. Each one backs BOTH a column's
// staticOptions and its filter's options, so the cell text and the chip text
// cannot drift apart (same discipline as holidays.list.config.ts).
const APPLIES_TO_OPTIONS = [
  { value: 'COMPANY_WIDE', label: 'Company-wide (default)' },
  { value: 'DEPARTMENT', label: 'Department' },
  { value: 'DESIGNATION', label: 'Designation' },
  { value: 'EMPLOYMENT_TYPE', label: 'Employment Type' },
  { value: 'SPECIFIC_EMPLOYEES', label: 'Specific Employees' },
];

const WEEKLY_OFF_OPTIONS = [
  { value: 'SUNDAY', label: 'Sunday' },
  { value: 'SAT_SUN', label: 'Saturday, Sunday' },
  { value: 'SUN_ALT_SAT', label: 'Sunday + alternate Saturday' },
  { value: 'ROTATIONAL_ONE', label: 'Rotational — 1 day/week' },
  { value: 'FRIDAY', label: 'Friday' },
  { value: 'NONE', label: 'None' },
];

// Exported so work-week.tabbed.config.ts's rec-head meta line can resolve the
// active policy's saturday_rule to the same friendly label this column and
// filter use, rather than keeping a second copy of the value set.
export const SATURDAY_RULE_OPTIONS = [
  { value: 'ODD_WORKING', label: 'Odd Saturdays Working (1st, 3rd, 5th)' },
  { value: 'EVEN_WORKING', label: 'Even Saturdays Working (2nd, 4th)' },
  { value: 'ALL_WORKING', label: 'All Saturdays Working' },
  { value: 'ALL_OFF', label: 'All Saturdays Off' },
  { value: 'FIRST_ONLY', label: 'First Saturday Only' },
  { value: 'LAST_ONLY', label: 'Last Saturday Only' },
  { value: 'CUSTOM', label: 'Custom — set each Saturday by hand' },
];

const SHORTFALL_OPTIONS = [
  { value: 'PRO_RATA_LOP', label: 'Pro-rata per hour (Loss of Pay)' },
  { value: 'ROUND_HALF_DAY', label: 'Rounded to nearest half day' },
  { value: 'ROUND_FULL_DAY', label: 'Rounded up to a full day' },
  { value: 'LEAVE_THEN_LOP', label: 'Deduct from leave balance first, then Loss of Pay' },
  { value: 'IGNORE', label: 'Ignore — no payroll impact' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const config: ListScreenConfig<WorkWeekPolicyRow> = {
  shape: 'list',
  id: 'masters.work_week_hours',
  title: 'Work Week Policies',
  specRef: '§3.20',
  recordNoun: 'work week policy',
  // The prototype's own description for this screen (data.js:1525).
  description:
    'Hours per day, the break, the weekly target and the Saturday rule — all dynamic. Nothing here is hard-coded: the odd/even Saturday pattern, the grace window and the shortfall treatment are whatever Super Admin configures. Payroll and Leave both read this screen.',
  endpoint: '/masters/work-week-policies',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/work-week-hours/policies', row.id, 'edit'],
  createRoute: ['/masters/work-week-hours/policies', 'new'],
  createLabel: 'Add Policy',
  // masters_work_week.py's list_policies takes exactly ONE query param —
  // `format`. No ?search=, no ?include_inactive=, no per-field filters at all
  // (this is a bespoke router, not the masters_lookup.py factory). So search is
  // client-side, the "Show inactive" checkbox is suppressed in favour of the
  // real Status filter below, and every filter here is client transport — the
  // screen discloses that beside Export rather than exporting a wider set.
  //
  // Confirmed build-added-beyond-prototype: masters.workweek in the prototype
  // is a 'record' screen (data.js:1525) whose Policies tab is a plain mini()
  // table (app-screens2.js:452-464) with no filter chips at all, only the
  // note above the table. The four filters below (applies_to, saturday_rule,
  // allow_compensatory_hours, status), plus client search and export, are
  // this build's own addition — deliberate, matching the "every list screen
  // gets filters for every role, export always follows the filter"
  // convention used across the rest of Masters (e.g. holidays.list.config.ts),
  // not something the prototype ever offered.
  searchParam: false,
  // §3.0: "Search, across that sub-master's name and code fields." A policy has
  // no code; its name is the only identifier a person would search by.
  searchFields: ['policy_name'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: the endpoint has no ?applies_to=. Note this is the
      // scope dimension the whole sub-master turns on — "a narrower policy
      // always wins over the company-wide default for the people it covers".
      key: 'applies_to',
      label: 'Applies To',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Scopes',
      options: APPLIES_TO_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.applies_to),
    },
    {
      // Client transport: no ?saturday_rule= param exists.
      key: 'saturday_rule',
      label: 'Saturday Rule',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Saturday Rules',
      options: SATURDAY_RULE_OPTIONS,
      predicate: (row, v) => row.saturday_rule === String(v),
    },
    {
      // Client transport: no ?allow_compensatory_hours= param exists. This is
      // the "can these people make a shortfall up instead of losing pay?"
      // question, which is the one thing HR is actually asked about a policy.
      key: 'allow_compensatory_hours',
      label: 'Comp Allowed',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Comp Allowed — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.allow_compensatory_hours : !row.allow_compensatory_hours),
    },
    {
      // §3.0: the Status filter defaults to Active — "retired entries are
      // hidden by default but never silently unreachable". Client transport
      // and an explicit filter rather than the shared "Show inactive"
      // checkbox, because this endpoint has no ?include_inactive= to send;
      // done this way the chip states plainly which set is on screen.
      key: 'status',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'client',
      allLabel: 'Status — Any',
      options: STATUS_OPTIONS,
      defaultValue: 'active',
      predicate: (row, v) => (v === 'active' ? !!row.is_active : !row.is_active),
    },
  ],
  // Masters §3.20 Screen Design, Work Week Policies list, in its own order:
  // "Policy, Applies To, Gross h/day, Break, Net h/day, Weekly Target, Weekly
  // Off, Saturday Rule, Comp Allowed, Shortfall Becomes, Status."
  columns: [
    { key: 'policy_name', header: 'Policy', cellClass: 'cell-strong' },
    { key: 'applies_to', header: 'Applies To', staticOptions: APPLIES_TO_OPTIONS },
    // type 'number' is load-bearing on this one: without it column-policy's
    // MONEY_LABEL regex sees "Gross" in the header and right-aligns it as money.
    { key: 'gross_hours_per_day', header: 'Gross h/day', type: 'number' },
    { key: 'unpaid_break_hours', header: 'Break', type: 'number' },
    // Invariant 3 / §3.20's Fields Table: "derived, never typed" — a STORED
    // GENERATED column in MySQL, present on WorkWeekPolicyOut and therefore on
    // the wire. Declared key-only because masters.api.ts's WorkWeekPolicyRow
    // has not got the field yet, so a compute() referencing it would not type.
    { key: 'net_working_hours_per_day', header: 'Net h/day', type: 'number', cellClass: 'cell-strong' },
    { key: 'weekly_hour_target', header: 'Weekly Target', type: 'number' },
    { key: 'weekly_off_days', header: 'Weekly Off', staticOptions: WEEKLY_OFF_OPTIONS },
    { key: 'saturday_rule', header: 'Saturday Rule', staticOptions: SATURDAY_RULE_OPTIONS },
    { key: 'allow_compensatory_hours', header: 'Comp Allowed', type: 'status' },
    { key: 'uncompensated_shortfall_becomes', header: 'Shortfall Becomes', staticOptions: SHORTFALL_OPTIONS },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
  ],
  // §3.0 rule 1 — "Delete and Deactivate are Super Admin only… only Super Admin
  // sees it"; gated on the same 'delete' RBAC action deactivate_policy itself
  // requires (masters_work_week.py:205). There is deliberately NO Delete here:
  // §3.20's Status & Deletion Rule is "Never hard-deleted", and the router has
  // no DELETE route at all to call.
  //
  // BUILT (§3b) — resolves the QUEUED reversing-a-Deactivate gap that used to
  // sit here: WorkWeekPolicyCreate (backend/app/schemas/masters.py) adds
  // is_active as create-only (never on WorkWeekPolicyWrite, so PUT still
  // can't touch it — the same write-authority boundary masters_lookup.py's
  // create_only_fields enforces), and a real POST /{id}/activate now exists
  // (masters_work_week.py), gated on the same 'delete' screenAction as
  // Deactivate, matching every other lookup's Activate row action this pass.
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/work-week-policies/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/work-week-policies/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm:
        'Deactivating a policy leaves every already-processed payroll period untouched — it only changes future runs. The only Active Company-wide policy cannot be switched off, since that would leave employees with no target to measure against. Continue?',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No work week policies configured.',
};

export default config;
