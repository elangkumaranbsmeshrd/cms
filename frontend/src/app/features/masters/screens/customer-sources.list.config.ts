import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { CustomerSourceRow } from '../masters.api';

// masters_lookup.py's factory: search / include_inactive / format are the only
// query params, and masters_simple.py:228-233 declares fields={"name": ...}
// only, so the response row is {id, is_active, name}.
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
  // QUEUED — see this group's audit report: masters_lookup.py's factory has no
  // reverse of POST /{id}/deactivate, so a deactivated source can never come
  // back via this UI even though §3.16's own Fields Table lists Status as a
  // normal editable toggle. This button targets the endpoint that reversal
  // needs (POST /{id}/activate) ahead of the backend adding it — inert (404)
  // until it does, same pattern this session used for Financial Year's End Date.
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
