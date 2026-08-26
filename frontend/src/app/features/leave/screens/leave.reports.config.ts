import { ReportScreenConfig } from '../../../shared/screens/screen.types';

interface LeaveBreakdownRow {
  readonly leave_type_name?: string;
  readonly department_name?: string;
  readonly employee_name?: string;
  readonly employee_count?: number;
  readonly total_allowed_days: string;
  readonly total_carried_forward_days: string;
  readonly total_taken_days: string;
  readonly total_pending_days: string;
  readonly total_remaining_days: string;
}

interface LeaveLiability {
  readonly employee_count: number;
  readonly total_remaining_days: string;
  readonly total_carried_forward_days: string;
  readonly leave_liability_days: string;
}

const EMPLOYEE_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ON_NOTICE', label: 'On Notice' },
  { value: 'EXITED', label: 'Exited' },
];

const LEAVE_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
];

// §2.5 Leave Reports — the ReportScreenConfig shape's first real consumer;
// leave_reports.py is the exact backend it was modelled on (see
// report-screen.component.ts's own doc comment). Four sources sharing one
// filter bar: three breakdown arrays (by Type / by Department / by
// Employee, each independently exportable) plus one headline-figure object
// (Liability, no export — "genuinely not list-shaped", leave_reports.py:31-33).
//
// Two filters the spec lists are deliberately omitted, per leave_reports.py's
// own header comment: Date Range (this data has no day-by-day grain to slice
// by — Financial Year is the real grain and is already a filter here), and
// Search on the by-Type/by-Department views (a handful of category labels,
// not named records — Search IS wired on by-Employee, whose rows are real
// named records).
const config: ReportScreenConfig<LeaveBreakdownRow> = {
  shape: 'report',
  id: 'leave.reports',
  title: 'Leave Reports',
  specRef: '§2.5',
  description: 'Leave taken by Type, Department, and Employee, plus the company-wide leave liability.',
  filters: [
    { key: 'financial_year_id', label: 'Financial Year', kind: 'select', transport: 'server', allLabel: 'Current Financial Year', optionsRef: { endpoint: '/masters/financial-years/options', labelKey: 'label' } },
    { key: 'department_id', label: 'Department', kind: 'select', transport: 'server', allLabel: 'All Departments', optionsRef: { endpoint: '/masters/departments/options', labelKey: 'label' } },
    { key: 'leave_type_id', label: 'Leave Type', kind: 'select', transport: 'server', allLabel: 'All Leave Types', optionsRef: { endpoint: '/masters/leave-types' } },
    { key: 'designation_id', label: 'Designation', kind: 'select', transport: 'server', allLabel: 'All Designations', optionsRef: { endpoint: '/masters/designations/options', labelKey: 'label' } },
    { key: 'employment_type_id', label: 'Employment Type', kind: 'select', transport: 'server', allLabel: 'All Employment Types', optionsRef: { endpoint: '/masters/employment-types/options', labelKey: 'label' } },
    { key: 'reporting_manager_id', label: 'Reporting Manager', kind: 'select', transport: 'server', allLabel: 'All Managers', optionsRef: { endpoint: '/employees/options', labelKey: 'label' } },
    { key: 'employee_status', label: 'Employee Status', kind: 'select', transport: 'server', allLabel: 'All Statuses', options: EMPLOYEE_STATUS_OPTIONS },
    { key: 'leave_status', label: 'Leave Status', kind: 'multiselect', transport: 'server', allLabel: 'Pending + Approved', options: LEAVE_STATUS_OPTIONS },
  ],
  sources: [
    { key: 'by_type', endpoint: '/leave/reports/balances-summary' },
    { key: 'by_department', endpoint: '/leave/reports/by-department' },
    { key: 'by_employee', endpoint: '/leave/reports/by-employee', searchParam: 'search' },
    { key: 'liability', endpoint: '/leave/reports/liability' },
  ],
  // §2.5's own 4 KPIs are Leave Liability / Days Taken (FY) / Pending
  // Requests / Avg Days per Employee. The first is below; Days Taken and Avg
  // Days are real rollups over sources already fetched for the tables below
  // (ReportTileDef.compute reads whatever the source actually returned — "a
  // tile that's really a rollup over a breakdown endpoint," this type's own
  // doc comment). Pending Requests is NOT built: it's a count of pending
  // leave REQUESTS, and every one of leave_reports.py's four sources
  // aggregates DAYS, never a request count — nothing here to roll up, a
  // confirmed backend gap rather than a mislabelled "Pending (days)" tile.
  // Employees in Scope / Carried Forward are kept even though neither is in
  // the spec's own 4 — real figures from the same already-fetched liability
  // source, not fabricated, so trimming them would be removing working
  // functionality rather than fixing a drift.
  tiles: [
    { icon: 'leave', tone: 'warning', label: 'Leave Liability', source: 'liability', compute: (d) => (d as LeaveLiability).leave_liability_days, unit: 'days', foot: 'Unused leave across every employee in scope' },
    {
      icon: 'check', tone: 'success', label: 'Days Taken (FY)', source: 'by_type', unit: 'days',
      compute: (d) => (d as LeaveBreakdownRow[]).reduce((sum, row) => sum + Number(row.total_taken_days || 0), 0),
      foot: 'Summed across every Leave Type in scope',
    },
    {
      icon: 'employee', tone: 'info', label: 'Avg Days / Employee', source: 'by_employee', unit: 'days',
      compute: (d) => {
        const rows = d as LeaveBreakdownRow[];
        return rows.length ? (rows.reduce((sum, row) => sum + Number(row.total_taken_days || 0), 0) / rows.length).toFixed(1) : '0';
      },
      foot: (d) => {
        const n = (d as LeaveBreakdownRow[]).length;
        return `Across ${n} employee${n === 1 ? '' : 's'} in scope`;
      },
    },
    { icon: 'employee', tone: 'accent', label: 'Employees in Scope', source: 'liability', compute: (d) => (d as LeaveLiability).employee_count },
    { icon: 'refresh', tone: 'info', label: 'Carried Forward', source: 'liability', compute: (d) => (d as LeaveLiability).total_carried_forward_days, unit: 'days' },
  ],
  tables: [
    {
      title: 'Leave Taken by Type',
      source: 'by_type',
      exportable: true,
      emptyText: 'No data for this filter yet.',
      columns: [
        { key: 'leave_type_name', header: 'Leave Type', cellClass: 'cell-strong' },
        { key: 'employee_count', header: 'Employees', type: 'number' },
        { key: 'total_allowed_days', header: 'Allowed', type: 'number' },
        { key: 'total_carried_forward_days', header: 'Carried Fwd', type: 'number' },
        { key: 'total_taken_days', header: 'Taken', type: 'number' },
        { key: 'total_pending_days', header: 'Pending', type: 'number' },
        { key: 'total_remaining_days', header: 'Remaining', type: 'number' },
      ],
    },
    {
      title: 'Leave Taken by Department',
      source: 'by_department',
      exportable: true,
      emptyText: 'No data for this filter yet.',
      columns: [
        { key: 'department_name', header: 'Department', cellClass: 'cell-strong' },
        { key: 'employee_count', header: 'Employees', type: 'number' },
        { key: 'total_allowed_days', header: 'Allowed', type: 'number' },
        { key: 'total_carried_forward_days', header: 'Carried Fwd', type: 'number' },
        { key: 'total_taken_days', header: 'Taken', type: 'number' },
        { key: 'total_pending_days', header: 'Pending', type: 'number' },
        { key: 'total_remaining_days', header: 'Remaining', type: 'number' },
      ],
    },
    {
      title: 'Leave Taken by Employee',
      source: 'by_employee',
      exportable: true,
      emptyText: 'No data for this filter yet.',
      columns: [
        { key: 'employee_name', header: 'Employee', cellClass: 'cell-strong' },
        { key: 'department_name', header: 'Department' },
        { key: 'total_allowed_days', header: 'Allowed', type: 'number' },
        { key: 'total_carried_forward_days', header: 'Carried Fwd', type: 'number' },
        { key: 'total_taken_days', header: 'Taken', type: 'number' },
        { key: 'total_pending_days', header: 'Pending', type: 'number' },
        { key: 'total_remaining_days', header: 'Remaining', type: 'number' },
      ],
    },
  ],
};

export default config;
