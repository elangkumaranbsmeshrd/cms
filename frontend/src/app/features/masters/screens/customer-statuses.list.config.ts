import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { CustomerStatusRow } from '../masters.api';

// masters_lookup.py's factory: search / include_inactive / format are the only
// query params, and masters_simple.py:221-226 declares fields={"name": ...}
// only, so the response row is {id, is_active, name}.
//
// Note the two different meanings of "status" on this screen, which is why the
// prototype names the columns the way it does: the NAME column holds a customer
// lifecycle state ("Prospect", "Active", "Churned"), while the STATUS column is
// this master row's own Active/Inactive flag — §3.15: it "governs whether this
// status value can be selected on new/edited customers". The shared "Show
// inactive" control (enabled by `includeInactiveParam`) is the filter for the
// second; there is no separate Status FilterDef, which would only duplicate it.
const config: ListScreenConfig<CustomerStatusRow> = {
  shape: 'list',
  id: 'masters.customer_statuses',
  title: 'Customer Status',
  specRef: '§3.15',
  recordNoun: 'customer status',
  // The prototype's list screen has no desc; this is its own wording from the
  // Add screen (data.js masters.customerstatus.add).
  description: 'The lifecycle states a customer record can be in.',
  endpoint: '/masters/customer-statuses',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/customer-statuses', row.id, 'edit'],
  createRoute: ['/masters/customer-statuses', 'new'],
  createLabel: 'Add Status',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  // BUILT (§3a) — resolves the QUEUED note that used to sit here (and its
  // identical siblings on customer-sources / asset-categories /
  // employment-types): a LIVE query against Customer.status_id
  // (masters_lookup.py's `referenced_by` mechanism), not a stored/synced
  // counter column, so it needed no migration on customer_statuses itself
  // and no write-time sync hook wherever a Customer's status changes.
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
    { key: 'name', header: 'Customer Status', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only.
  //
  // QUEUED — see this group's audit report: masters_lookup.py's factory has no
  // reverse of POST /{id}/deactivate, so a deactivated status value can never
  // come back via this UI even though §3.15's own Fields Table lists Status as
  // a normal editable toggle. This button targets the endpoint that reversal
  // needs (POST /{id}/activate) ahead of the backend adding it — inert (404)
  // until it does, same pattern this session used for Financial Year's End Date.
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/customer-statuses/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/customer-statuses/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.15 asks for a confirmation before deactivating a status value already assigned to a customer. Customers already on it keep it; it just stops being selectable on new or edited customers. Continue?',
    },
    {
      // ON DELETE RESTRICT enforces §3.15's "never hard-deleted once assigned to
      // any Customer" — the API answers 409 rather than orphaning the customer.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/customer-statuses/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this customer status permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No customer statuses configured.',
};

export default config;
