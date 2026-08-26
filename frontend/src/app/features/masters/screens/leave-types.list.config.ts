import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { LeaveTypeRow } from '../masters.api';

const config: ListScreenConfig<LeaveTypeRow> = {
  shape: 'list',
  id: 'masters.leave_types',
  title: 'Leave Types',
  specRef: '§3.4',
  recordNoun: 'leave type',
  description:
    'A quota of 0 means the type does not consume a balance — Remaining shows "Not tracked" on My Leave.',
  endpoint: '/masters/leave-types',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/leave-types', row.id, 'edit'],
  createRoute: ['/masters/leave-types', 'new'],
  createLabel: 'Add Leave Type',
  // masters_lookup.py's list_rows accepts only search / include_inactive /
  // format, so these two are the only dimensions that can round-trip to the
  // server; the Carry Forward filter below has to run client-side.
  searchParam: 'search',
  // §3.0: "Search, across that sub-master's name and code fields."
  searchFields: ['name', 'short_code'],
  // The prototype's Status filter (['Active','Inactive','All Statuses']) is
  // this — the shared component renders it as the "Show inactive" toggle, and
  // because it is a real query param the export stays exact.
  includeInactiveParam: 'include_inactive',
  filters: [
    {
      // Client transport: the lookup factory has no ?carry_forward_allowed=
      // param, so sending one would be ignored while the chip claimed a filter
      // was applied.
      key: 'carry_forward_allowed',
      label: 'Carry Forward',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Carry Forward — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.carry_forward_allowed : !row.carry_forward_allowed),
    },
  ],
  columns: [
    { key: 'name', header: 'Leave Type', cellClass: 'cell-strong' },
    { key: 'short_code', header: 'Code', type: 'code' },
    // Not a prototype column, but §3.4's own Screen Design lists it ("List
    // view shows: Name, Short Code, Paid/Unpaid, Default Quota, Status") and
    // it is the field that decides whether Payroll deducts pay. Rendered as
    // the words rather than Yes/No so the header and the cell agree; "Unpaid"
    // picks up the shared badge map's danger tone, which is the right signal
    // here — an unpaid type is one Payroll deducts against.
    { key: 'is_paid', header: 'Paid / Unpaid', type: 'status', compute: (row) => (row.is_paid ? 'Paid' : 'Unpaid') },
    { key: 'default_annual_quota_days', header: 'Default Annual Quota', type: 'number', cellClass: 'mono' },
    { key: 'carry_forward_allowed', header: 'Carry Forward', type: 'status' },
    { key: 'max_carry_forward_days', header: 'Max Carry Forward', type: 'number', cellClass: 'mono' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
  ],
  // §3.0 rule 1 / §3.4 Role Access: "Manager and HR: add and edit only —
  // delete/deactivate stays with Super Admin". Both are gated on the same
  // 'delete' RBAC action the API requires (masters_lookup.py:245, :265).
  //
  // QUEUED — see this group's audit report: masters_lookup.py's factory has no
  // reverse of POST /{id}/deactivate, so a deactivated leave type can never
  // come back via this UI even though the prototype's shared Add/Edit form
  // (app-forms.js:41, 'm.leavetypes') carries Status as a normal editable
  // toggle. This button targets the endpoint that reversal needs
  // (POST /{id}/activate) ahead of the backend adding it — inert (404) until
  // it does, same pattern this session used for Financial Year's End Date.
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/leave-types/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/leave-types/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm:
        'Deactivating removes this type from the leave-application dropdown. Balances and requests already recorded under it are untouched. Continue?',
    },
    {
      // §3.4: "Never hard-deleted once used in any Leave application or
      // balance." There is no usage field on this response to hide the button
      // with, so the guard is the database's own ON DELETE RESTRICT — a
      // referenced row comes back as a clean 409 and the message says so.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/leave-types/${row.id}`,
      screenAction: 'delete',
      confirm:
        'Delete this leave type permanently? This only works while nothing references it — if any employee has a balance or a request under it the server will refuse, and you should deactivate it instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No leave types configured.',
};

export default config;
