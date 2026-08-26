import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { EmploymentTypeRow } from '../masters.api';

// masters_lookup.py's factory: search / include_inactive / format are the only
// query params, and masters_simple.py:242-247 declares fields={"name": ...}
// only, so the response row is {id, is_active, name}.
//
// The prototype's Status filter is the shared "Show inactive" control that
// `includeInactiveParam` turns on, not a second Status <select> (see
// service-categories.list.config.ts for why the duplicate would mislead).
//
// BUILT (§3a) — resolves the QUEUED note that used to sit here: Used is now
// a LIVE query against Employee.employment_type_id / WorkWeekPolicy /
// Payslip (masters_lookup.py's `referenced_by` mechanism), not a stored
// usage_count counter, so EmploymentType needed no new migration for it.
const config: ListScreenConfig<EmploymentTypeRow> = {
  shape: 'list',
  id: 'masters.employment_types',
  title: 'Employment Type',
  specRef: '§3.18',
  recordNoun: 'employment type',
  // The prototype's list screen has no desc; this is its own wording from the
  // Add screen (data.js masters.employmenttype.add).
  description: 'The controlled list of employment types staff can be classified under.',
  endpoint: '/masters/employment-types',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/employment-types', row.id, 'edit'],
  createRoute: ['/masters/employment-types', 'new'],
  createLabel: 'Add Employment Type',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  filters: [
    {
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
  ],
  columns: [
    { key: 'name', header: 'Employment Type', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only.
  rowActions: [
    {
      // §3a — no row action reached the factory's activate_row at all here;
      // every sibling lookup already has one.
      label: 'Activate',
      endpoint: (row) => `/masters/employment-types/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/employment-types/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.18 asks for a confirmation before deactivating a type already assigned to an employee. Existing employees keep it; it just stops being offered on new ones. Continue?',
    },
    {
      // ON DELETE RESTRICT enforces §3.18's "never hard-deleted once assigned to
      // any Employee" — the API answers 409 rather than orphaning the record.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/employment-types/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this employment type permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No employment types configured.',
};

export default config;
