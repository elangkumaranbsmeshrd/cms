import { ListScreenConfig } from '../../../shared/screens/screen.types';

// Same set leave.reports.config.ts's own Employee Status filter uses.
const EMPLOYEE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ON_NOTICE', label: 'On Notice' },
  { value: 'EXITED', label: 'Exited' },
];

interface LeaveBalanceMgmtRow {
  readonly id: string;
  readonly employee_id: string;
  readonly leave_type_id: string;
  readonly financial_year_id: string;
  readonly allowed_days: string;
  readonly carried_forward_days: string;
  readonly adjustment_days: string;
  readonly taken_days: string;
  readonly pending_days: string;
  readonly remaining_days: string;
  readonly is_quota_tracked: boolean;
}

// §2.3a Leave Balance Management (HR/Super Admin, PLUS Manager over their own
// direct reports once "Allow Manager to Adjust Team Leave Balance" is on —
// rbac/toggles.py's MODE_TOGGLE_GATES/ACTION_TOGGLE_GATES) — GET
// /leave-balances (note: no /leave/ prefix, unlike every other endpoint in
// this module).
//
// §2.3's own full filter set — Leave Type, Department, Designation,
// Employment Type, Reporting Manager, Employee Status, a Remaining-balance
// range, Search, "negative balance only", and "unused balance above N days"
// — is now real 'server' query params (list_leave_balances joins through to
// Employee for the ones that need it). Employee and Financial Year were
// already real; Leave Type is upgraded from 'client' to 'server' below for
// export-completeness now that the endpoint accepts it directly.
const config: ListScreenConfig<LeaveBalanceMgmtRow> = {
  shape: 'list',
  id: 'leave.balance_management',
  title: 'Leave Balance Management',
  specRef: '§2.3',
  recordNoun: 'leave balance',
  description: 'Every employee\'s leave balance for a Financial Year, with manual adjustment.',
  endpoint: '/leave-balances',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['employee_id'],
  includeInactiveParam: false,
  filters: [
    {
      key: 'employee_id',
      label: 'Employee',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employees',
      optionsRef: { endpoint: '/employees', labelKey: 'first_name' },
    },
    {
      key: 'leave_type_id',
      label: 'Leave Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Leave Types',
      optionsRef: { endpoint: '/masters/leave-types' },
    },
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Financial Years',
      optionsRef: { endpoint: '/masters/financial-years', labelKey: 'label' },
    },
    {
      key: 'department_id',
      label: 'Department',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Departments',
      optionsRef: { endpoint: '/masters/departments' },
    },
    {
      key: 'designation_id',
      label: 'Designation',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Designations',
      optionsRef: { endpoint: '/masters/designations' },
    },
    {
      key: 'employment_type_id',
      label: 'Employment Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employment Types',
      optionsRef: { endpoint: '/masters/employment-types' },
    },
    {
      key: 'reporting_manager_id',
      label: 'Reporting Manager',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Managers',
      optionsRef: { endpoint: '/employees', labelKey: 'first_name' },
    },
    {
      key: 'employee_status',
      label: 'Employee Status',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Statuses',
      options: EMPLOYEE_STATUS_OPTIONS,
    },
    { key: 'remaining', label: 'Remaining', kind: 'numberrange', transport: 'server', allLabel: 'Any', param: 'remaining' },
    {
      key: 'negative_only',
      label: 'Negative Balance Only',
      kind: 'tristate',
      transport: 'server',
      allLabel: 'Any',
    },
    {
      // §2.3's own "what the year-end carry-forward run is planned against."
      // Min-only in practice, same reasoning as Leave Approvals' Pending(days).
      key: 'unused_above_days',
      label: 'Unused Above (days)',
      kind: 'numberrange',
      transport: 'server',
      allLabel: 'Any',
      param: 'unused_above_days',
    },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'leave_type_id', header: 'Leave Type', ref: { endpoint: '/masters/leave-types' } },
    { key: 'allowed_days', header: 'Allowed', type: 'number' },
    { key: 'carried_forward_days', header: 'Carried Fwd', type: 'number' },
    { key: 'adjustment_days', header: 'Adjustments', type: 'number' },
    { key: 'taken_days', header: 'Taken', type: 'number' },
    { key: 'pending_days', header: 'Pending', type: 'number' },
    { key: 'remaining_days', header: 'Remaining', type: 'number', cellClass: 'cell-strong' },
  ],
  // §2.3's own rowAction is "Adjust Balance", opening a form with Employee /
  // Leave Type / Current Remaining shown alongside the amount, a live New
  // Remaining preview, and Adjusted By / Date — richer than RowActionDef's
  // single no-body POST (or a window.prompt chain) can express, so this is a
  // rowRoute to a bespoke form (leave.balance-adjust.component.ts) instead,
  // same pattern as Carry Forward Run's own bespoke page.
  rowRoute: (row) => ['/leave/balances', row.id, 'adjust'],
  secondaryActions: [
    { label: 'Carry Forward Run', icon: 'refresh', route: ['/leave/carry-forward'], screenAction: 'run_carry_forward' },
    // 'view' matches PolicyStore's ALWAYS_ALLOWED read-only-verb regex — same
    // reasoning as ticket.detail.component.ts's own conversation screenAction:
    // anyone who can open this screen at all can read its history, no
    // separate action grant needed for a pure read.
    { label: 'Adjustment History', icon: 'clock', route: ['/leave/balances/adjustments'], screenAction: 'view' },
  ],
  defaultPageSize: 25,
  emptyText: 'No leave balances recorded.',
};

export default config;
