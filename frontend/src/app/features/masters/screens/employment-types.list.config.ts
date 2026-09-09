import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { EmploymentTypeRow } from '../masters.api';

// masters_lookup.py's factory: search, include_inactive, is_referenced,
// created_by, updated_by, created_from/created_to and format are the query
// params — §3.0's filter convention in full, and nothing else. The row's own
// business fields are {name, code} (masters_simple.py's registration); §3.18's
// Fields Table lists no others.
//
// The prototype's Status filter is the shared "Show inactive" control that
// `includeInactiveParam` turns on, not a second Status <select> (see
// service-categories.list.config.ts for why the duplicate would mislead).
//
// BUILT (§3a) — resolves the QUEUED note that used to sit here: Used is now
// a LIVE query against Employee.employment_type_id / WorkWeekPolicy /
// Payslip (masters_lookup.py's `referenced_by` mechanism), not a stored
// usage_count counter, so EmploymentType needed no new migration for it.

// §3.0's Created By / Last Modified By pair. The ids come back on the row
// (masters_simple.py's `_AUDIT_READ_ONLY`); `/users` turns one into a name.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

// There is no "distinct creators" endpoint, so the option list is derived from
// the rows on screen — the same technique customer.directory.config.ts uses.
function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly EmploymentTypeRow[], refData: RefDataService): FilterOption[] => {
    const seen = new Map<string, FilterOption>();
    for (const row of rows) {
      const id = row[key];
      if (id && !seen.has(id)) seen.set(id, { value: id, label: refData.label(USER_REF, id) });
    }
    return [...seen.values()];
  };
}

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
    // §3.0 / A048's third cross-cutting rule, on every sub-master list:
    // "Created By, Last Modified By, and Created On range — Masters is
    // confidential shared configuration, and knowing who changed a shared list
    // and when is worth more here than almost anywhere else in the CMS."
    // Server transport for all three (masters_lookup.py's list_rows takes
    // created_by / updated_by / created_from / created_to), so the export
    // header names them and exports exactly what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
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
