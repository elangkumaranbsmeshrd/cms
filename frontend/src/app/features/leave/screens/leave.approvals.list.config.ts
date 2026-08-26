import { formatDate } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { FilterOption, ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';

interface LeaveApprovalRow {
  readonly id: string;
  readonly employee_id: string;
  readonly leave_type_id: string;
  readonly from_date: string;
  readonly to_date: string;
  readonly days_requested: string;
  readonly reason: string;
  readonly status: string;
  readonly applied_at: string;
  readonly routed_to_role: string;
  readonly routed_to_user_id: string | null;
}

// actioned_by/routed_to_user_id are raw platform User ids, resolved via the
// cross-cutting GET /users (same lookup my-leave.component.ts's own
// actioned_by column uses).
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

// routed_to_role is one of REPORTING_MANAGER | HR | SUPER_ADMIN
// (leave_engine.py's resolve_routing) — only the REPORTING_MANAGER case also
// carries a routed_to_user_id; HR/SUPER_ADMIN route to the role itself, no
// specific person, matching §2.2's "Reporting Manager by default -> HR if
// none is set ... -> Super Admin if HR is unavailable."
function routedToLabel(role: string): string {
  return role === 'HR' ? 'HR' : role === 'SUPER_ADMIN' ? 'Super Admin' : role === 'REPORTING_MANAGER' ? 'Reporting Manager' : role;
}
function routedToValue(row: LeaveApprovalRow): string {
  return row.routed_to_user_id ?? row.routed_to_role;
}

// §2.2 Leave Approvals — GET /leave/approvals defaults to ["PENDING"] when no
// ?status= is sent at all (leave_requests.py:319), which is exactly this
// screen's own desired initial view — the Status filter below is left
// without a defaultValue so the first load rides that backend default
// rather than duplicating it client-side.
//
// The spec's own filter set (§2.2) is Employee / Department / Leave Type /
// Routed To, PLUS this revision's own named additions: Date Applied range,
// Leave Dates range, Days range, "pending more than N days", and Search over
// Employee Name + Reason. Every one of these except Department is now a
// real 'server' param on /leave/approvals — Department alone stays
// unbuilt: LeaveRequestOut carries no department_id, and adding one would
// mean a schema change purely for a filter, out of proportion here (unlike
// Leave Balance Management, which already needed the Employee join for
// several OTHER filters and picked this one up for free as a result).
//
// Reassign (leave_requests.py:404) is deliberately NOT wired here: it's
// gated on the same 'approve' action as Approve/Reject (no separate
// 'reassign' RBAC action exists), but its to_user_id has no candidate-list
// endpoint anywhere to populate a picker from — a genuine backend gap, not
// a frontend oversight.
function routedToOptions(rows: readonly LeaveApprovalRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    seen.set(routedToValue(row), row.routed_to_user_id ? refData.label(USER_REF, row.routed_to_user_id) : routedToLabel(row.routed_to_role));
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}
const config: ListScreenConfig<LeaveApprovalRow> = {
  shape: 'list',
  id: 'leave.approvals',
  title: 'Leave Approvals',
  specRef: '§2.2',
  recordNoun: 'leave request',
  description: 'Leave requests awaiting your decision — your team\'s, or company-wide.',
  endpoint: '/leave/approvals',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
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
      // No dedicated endpoint enumerates "who leave can route to" — derived
      // from the rows actually present, same reasoning as rbac.change_log's
      // Module filter (screen.types.ts's own documented use case for this).
      // 'server' transport still works with a rows-derived option list: the
      // options just describe THIS page's own routings, same as every other
      // optionsFromRows filter in this codebase.
      key: 'routed_to',
      label: 'Routed To',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Routings',
      optionsFromRows: routedToOptions,
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS,
    },
    { key: 'applied', label: 'Applied On', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'applied' },
    { key: 'date', label: 'Leave Dates', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'date' },
    { key: 'days', label: 'Days', kind: 'numberrange', transport: 'server', allLabel: 'Any', param: 'days' },
    {
      // §2.2's own named addition: "the real failure mode there is a request
      // aging rather than being refused." Min-only in practice (Max is the
      // numberrange convention's free bonus, not something the spec asked for).
      key: 'pending_days',
      label: 'Pending (days)',
      kind: 'numberrange',
      transport: 'server',
      allLabel: 'Any',
      param: 'pending_days',
    },
  ],
  searchFields: ['reason'],
  columns: [
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'leave_type_id', header: 'Leave Type', ref: { endpoint: '/masters/leave-types' } },
    { key: 'dates', header: 'Dates', compute: (row) => (row.from_date === row.to_date ? formatDate(row.from_date) : `${formatDate(row.from_date)} to ${formatDate(row.to_date)}`) },
    { key: 'days_requested', header: 'Days', type: 'number' },
    { key: 'reason', header: 'Reason' },
    { key: 'applied_at', header: 'Applied On', type: 'date' },
    { key: 'routed_to_user_id', header: 'Routed To', cellClass: 'cell-strong', compute: (row) => routedToValue(row), ref: USER_REF },
    // Days waiting on a decision — no dedicated backend field, computed from
    // the same applied_at every other column already reads.
    { key: 'aging', header: 'Aging (days)', type: 'number', compute: (row) => Math.max(0, Math.floor((Date.now() - new Date(row.applied_at).getTime()) / 86400000)) },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
  ],
  rowActions: [
    {
      label: 'Approve',
      endpoint: (row) => `/leave/approvals/${row.id}/decide`,
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      confirm: 'Approve this leave request?',
      body: () => ({ approve: true }),
    },
    {
      label: 'Reject',
      endpoint: (row) => `/leave/approvals/${row.id}/decide`,
      screenAction: 'approve',
      visible: (row) => row.status === 'PENDING',
      // LeaveDecisionRequest requires a non-blank decision_reason when
      // approve=false (leave_requests.py:349-350) — same window.prompt
      // technique as emp.documents.list.config.ts's Reject action.
      body: () => ({ approve: false, decision_reason: window.prompt('Reason for rejecting this leave request (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No leave requests to review.',
};

export default config;
