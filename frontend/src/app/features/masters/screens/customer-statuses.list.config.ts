import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CustomerStatusRow } from '../masters.api';

// §3.0's Created By / Last Modified By pair — see
// service-categories.list.config.ts for why the options are derived from the
// rows on screen rather than from an endpoint of their own.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly CustomerStatusRow[], refData: RefDataService): FilterOption[] => {
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
// §3.15's own Fields Table lists no others.
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
    // §3.0 / A048's third cross-cutting rule, on every sub-master list:
    // "Created By, Last Modified By, and Created On range". Server transport,
    // so the export header names them and exports exactly what is on screen.
    { key: 'created_at', label: 'Created On', kind: 'daterange', transport: 'server', param: 'created' },
    { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', optionsFromRows: peopleOptions('created_by') },
    { key: 'updated_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', optionsFromRows: peopleOptions('updated_by') },
  ],
  columns: [
    { key: 'name', header: 'Customer Status', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only.
  //
  // Activate is the other half of §3.15's own Status toggle (the flag that
  // "governs whether this status value can be selected"). It was written
  // against a POST /{id}/activate the factory did not have yet;
  // masters_lookup.py has since grown it, so this is a live action now, not
  // the inert stub the note that used to sit here described (verified in the
  // browser).
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
