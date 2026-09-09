import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { LeaveTypeRow } from '../masters.api';

// §3.0's Created By / Last Modified By pair — see
// service-categories.list.config.ts for why the options are derived from the
// rows on screen rather than from an endpoint of their own.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly LeaveTypeRow[], refData: RefDataService): FilterOption[] => {
    const seen = new Map<string, FilterOption>();
    for (const row of rows) {
      const id = row[key];
      if (id && !seen.has(id)) seen.set(id, { value: id, label: refData.label(USER_REF, id) });
    }
    return [...seen.values()];
  };
}

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
  // masters_lookup.py's list_rows takes search, include_inactive,
  // is_referenced, created_by, updated_by, created_from/created_to and format
  // — §3.0's filter convention in full. Carry Forward is the one dimension
  // with no query param of its own, so that filter alone runs client-side.
  searchParam: 'search',
  // §3.0: "Search, across that sub-master's name and code fields." The
  // registration passes search_field=["name", "short_code"] to match; without
  // it the factory's single-column default left the Code column — the one the
  // placeholder invites you to type into — unsearched on the server.
  searchFields: ['name', 'short_code'],
  // The prototype's Status filter (['Active','Inactive','All Statuses']) is
  // this — the shared component renders it as the "Show inactive" toggle, and
  // because it is a real query param the export stays exact.
  includeInactiveParam: 'include_inactive',
  filters: [
    {
      // §3.0's Used/Unused filter — "what makes 'which of these can I safely
      // deactivate?' answerable without opening each one". Server transport,
      // like every other lookup screen that has it (departments, designations,
      // payment-modes, …): masters_simple.py's leave-types router names all
      // four leave_type_id FKs in referenced_by, which turns on both the
      // is_referenced field and the ?is_referenced= query param.
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
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
    // §3.0 / A048's third cross-cutting rule, on every sub-master list:
    // "Created By, Last Modified By, and Created On range" — "Masters is
    // confidential shared configuration, and knowing who changed a shared
    // list and when is worth more here than almost anywhere else in the CMS".
    // Server transport, so the export header names them and the exported file
    // matches what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
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
    // The column the Used filter above reads against — same pairing every
    // other lookup list uses, so "why can't I delete this one?" is answerable
    // from the row itself rather than from the 409 the attempt returns.
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 / §3.4 Role Access: "Manager and HR: add and edit only —
  // delete/deactivate stays with Super Admin". Both are gated on the same
  // 'delete' RBAC action the API requires (masters_lookup.py:245, :265).
  //
  // Activate is the reverse of Deactivate, restoring the other half of §3.4's
  // "Status — Toggle (Active/Inactive)". It was written against a
  // POST /{id}/activate the factory did not have yet; masters_lookup.py has
  // since grown it (it is in the OpenAPI schema alongside /deactivate), so
  // this is a live action now, not the inert stub the old note described.
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
      // balance." `is_referenced` is that rule made visible — the button is
      // hidden on a row any leave request, balance, carry-forward line or
      // adjustment points at, instead of being offered and then refused with
      // a 409. The database's ON DELETE RESTRICT is still the real guard
      // (this is UX only, Invariant 2), which is why the confirm below keeps
      // explaining what a refusal would mean.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/leave-types/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm:
        'Delete this leave type permanently? This only works while nothing references it — if any employee has a balance or a request under it the server will refuse, and you should deactivate it instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No leave types configured.',
};

export default config;
