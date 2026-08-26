import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';

interface CompHoursApprovalRow {
  readonly id: string;
  readonly request_number: string;
  readonly employee_id: string;
  readonly financial_year_id: string;
  readonly shortfall_date: string;
  readonly hours_short: string;
  readonly make_up_date: string;
  readonly hours_to_work: string;
  readonly shortfall_reason: string;
  readonly status: string;
  readonly estimated_payroll_impact: string;
  readonly actioned_by: string | null;
  readonly hours_credited: string;
}

// actioned_by is a raw platform User id, resolved via the cross-cutting
// GET /users (same lookup my-leave.component.ts's own actioned_by uses).
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXPIRED', label: 'Expired' },
];

// §2.6 Compensatory Hours — Approvals queue. Unlike Leave Approvals' GET
// (visibility-only), this GET is itself action-gated: require_screen(SCREEN,
// action="approve") on the list endpoint (compensatory_hours.py:283), a real
// asymmetry within the same module — this screen is simply unreachable
// (not just button-less) for anyone without the approve grant. Its own
// ?status= is a single value (default "PENDING" server-side), not a list —
// unlike Leave Approvals' equivalent — so this stays a plain select.
//
// §2.6's own filter set — Employee, Department, Period, Search — is now
// fully real: Employee/Department/Search are 'server' params
// (compensatory_hours.py joins through to Employee for Department/Search),
// Period maps onto the real financial_year_id field, kept 'client' since
// every row already carries it and the endpoint takes no such param.
const config: ListScreenConfig<CompHoursApprovalRow> = {
  shape: 'list',
  id: 'leave.compensatory_hours',
  title: 'Compensatory Hour Approvals',
  specRef: '§2.6',
  recordNoun: 'request',
  description: 'Compensatory hour requests awaiting your decision — your team\'s, or company-wide.',
  endpoint: '/compensatory-hours/approvals',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['employee_id', 'shortfall_reason'],
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
      key: 'department_id',
      label: 'Department',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Departments',
      optionsRef: { endpoint: '/masters/departments' },
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS,
    },
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Financial Years',
      optionsRef: { endpoint: '/masters/financial-years', labelKey: 'label' },
      predicate: (row, v) => row.financial_year_id === v,
    },
  ],
  columns: [
    { key: 'request_number', header: 'Request #', type: 'code' },
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'shortfall_date', header: 'Shortfall Date', type: 'date' },
    { key: 'hours_short', header: 'Hours Short', type: 'number' },
    { key: 'make_up_date', header: 'Make-Up Date', type: 'date' },
    { key: 'hours_to_work', header: 'Hours to Work', type: 'number' },
    { key: 'shortfall_reason', header: 'Reason' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'estimated_payroll_impact', header: 'Est. Payroll Impact', type: 'money' },
    // Post-decision outcome — blank while Pending, the actual hours banked
    // against the shortfall once Approved (§2.6: "Approved make-up hours
    // are credited back against the shortfall").
    { key: 'hours_credited', header: 'Hours Credited', type: 'number' },
    { key: 'actioned_by', header: 'Approved By', ref: USER_REF },
  ],
  rowActions: [
    {
      label: 'Approve',
      endpoint: (row) => `/compensatory-hours/approvals/${row.id}/decide`,
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      confirm: 'Approve this compensatory hour request?',
      body: () => ({ approve: true }),
    },
    {
      label: 'Reject',
      endpoint: (row) => `/compensatory-hours/approvals/${row.id}/decide`,
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      body: () => ({ approve: false, decision_reason: window.prompt('Reason for rejecting this request (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No compensatory hour requests to review.',
};

export default config;
