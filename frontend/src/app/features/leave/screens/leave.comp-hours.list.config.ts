import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';

interface CompHoursRow {
  readonly id: string;
  readonly request_number: string;
  readonly financial_year_id: string;
  readonly shortfall_date: string;
  readonly hours_short: string;
  readonly make_up_date: string;
  readonly hours_to_work: string;
  readonly status: string;
  readonly estimated_payroll_impact: string;
  readonly decision_reason: string | null;
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

// §2.6 Compensatory Hours — GET /compensatory-hours/requests is always
// own-scoped server-side regardless of role (same "own, by construction" as
// My Leave), so this is a plain self-service list — no Employee column or
// filter needed. "+ Request Compensatory Hours" opens the bespoke apply
// form (derived fields too complex for FormScreenConfig — see
// leave.comp-hours-apply.component.ts).
//
// §2.6's own filter set includes "Period" (fixed month presets in the
// mock); financial_year_id is the real per-request field this maps onto —
// added below as a 'client' filter (the endpoint takes no such param, but
// every row already carries it). Department has no equivalent at all:
// CompHoursRequestOut carries no department_id/department_name field —
// confirmed backend gap, not built.
//
// Shares its RBAC id ('leave.compensatory_hours') with the separate
// Approvals queue (leave.comp-hours-approvals.list.config.ts) — the
// registry has one screen key covering both the 'request' and 'approve'
// actions (backend/app/rbac/registry/screens.py), so nav-registry.ts can
// only ever point routeForScreen('leave.compensatory_hours') at ONE of the
// two routes (same one-path-per-screen-key limitation as
// employee.documents -> /my-documents). This screen is that default;
// Approvals is reached via the secondary action below instead of its own
// nav entry. The two also share sessionStorage filter persistence
// (list-filters:leave.compensatory_hours) — harmless here since both only
// carry a Status + Financial Year filter.
const config: ListScreenConfig<CompHoursRow> = {
  shape: 'list',
  id: 'leave.compensatory_hours',
  title: 'Compensatory Hours',
  specRef: '§2.6',
  recordNoun: 'request',
  description: 'Your compensatory hour requests, made against an attendance shortfall.',
  endpoint: '/compensatory-hours/requests',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['shortfall_reason'],
  includeInactiveParam: false,
  filters: [
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
    { key: 'shortfall_date', header: 'Shortfall Date', type: 'date' },
    { key: 'hours_short', header: 'Hours Short', type: 'number' },
    { key: 'make_up_date', header: 'Make-Up Date', type: 'date' },
    { key: 'hours_to_work', header: 'Hours to Work', type: 'number' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'estimated_payroll_impact', header: 'Est. Payroll Impact', type: 'money' },
    { key: 'decision_reason', header: 'Decision Reason' },
    // Post-decision outcome — blank while Pending, the actual hours banked
    // against the shortfall once Approved (§2.6: "Approved make-up hours
    // are credited back against the shortfall").
    { key: 'hours_credited', header: 'Hours Credited', type: 'number' },
    { key: 'actioned_by', header: 'Approved By', ref: USER_REF },
  ],
  rowActions: [
    {
      label: 'Cancel',
      endpoint: (row) => `/compensatory-hours/requests/${row.id}/cancel`,
      // cancel_comp_hours_request gates on action="request" — there is no
      // separate 'cancel' action registered for this screen.
      screenAction: 'request',
      visible: (row) => row.status === 'PENDING',
      confirm: 'Cancel this compensatory hour request?',
    },
  ],
  createRoute: ['/leave/compensatory-hours', 'new'],
  createLabel: 'Request Compensatory Hours',
  createScreenAction: 'request',
  secondaryActions: [{ label: 'Approvals Queue', icon: 'check', route: ['/leave/compensatory-hours-approvals'], screenAction: 'approve' }],
  defaultPageSize: 25,
  emptyText: 'No compensatory hour requests yet.',
};

export default config;
