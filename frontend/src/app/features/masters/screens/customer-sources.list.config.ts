import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CustomerSourceRow } from '../masters.api';

// §3.0's Created By / Last Modified By pair — see
// service-categories.list.config.ts for why the options are derived from the
// rows on screen rather than from an endpoint of their own.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly CustomerSourceRow[], refData: RefDataService): FilterOption[] => {
    const seen = new Map<string, FilterOption>();
    for (const row of rows) {
      const id = row[key];
      if (id && !seen.has(id)) seen.set(id, { value: id, label: refData.label(USER_REF, id) });
    }
    return [...seen.values()];
  };
}

// masters_lookup.py's factory: the query params this endpoint takes are
// search, include_inactive, is_referenced, created_by, updated_by,
// created_from/created_to and format — §3.0's filter convention in full. The
// row's business fields are {name, code} (masters_simple.py's registration);
// §3.16's own Fields Table lists no others.
//
// The prototype's Status filter is the shared "Show inactive" control that
// `includeInactiveParam` turns on, not a second Status <select> (see
// service-categories.list.config.ts for why the duplicate would mislead).
const config: ListScreenConfig<CustomerSourceRow> = {
  shape: 'list',
  id: 'masters.customer_sources',
  title: 'Customer Source',
  specRef: '§3.16',
  recordNoun: 'customer source',
  // The prototype's own desc for this screen, minus its leading "Re-added
  // 2026-07-31." marker — that is document history (this sub-master was removed
  // and restored a day later, §3.16), not something a user of the screen needs.
  description: 'Where a customer first came from — the field Sales is asked about before anything else, and what credits an acquisition channel for a won deal.',
  endpoint: '/masters/customer-sources',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/customer-sources', row.id, 'edit'],
  createRoute: ['/masters/customer-sources', 'new'],
  createLabel: 'Add Source',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  // BUILT (§3a) — resolves the QUEUED note that used to sit here: a LIVE
  // query against Customer.source_id (masters_lookup.py's `referenced_by`
  // mechanism), not a denormalized/synced usage_count column, so it needed
  // no migration on customer_sources itself.
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
    // "Created By, Last Modified By, and Created On range". Server transport,
    // so the export header names them and exports exactly what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
  ],
  columns: [
    { key: 'name', header: 'Customer Source', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only. The prototype's
  // own form hint for this sub-master says the same thing in as many words:
  // "Deactivation is Super Admin only, as on every sub-master".
  //
  // Activate is the other half of §3.16's "Status: Toggle (Active/Inactive)".
  // It was written against a POST /{id}/activate the factory did not have
  // yet; masters_lookup.py has since grown it, so this is a live action now,
  // not the inert stub the note that used to sit here described (verified in
  // the browser).
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/customer-sources/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/customer-sources/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.16 asks for a confirmation before deactivating a source already assigned to a customer. Customers already credited to it keep it; it just stops being offered on new ones. Continue?',
    },
    {
      // ON DELETE RESTRICT enforces §3.16's "never hard-deleted once assigned to
      // any Customer" — the API answers 409 rather than losing the attribution.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/customer-sources/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this customer source permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No customer sources configured.',
};

export default config;
