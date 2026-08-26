import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { UnitOfMeasureRow } from '../masters.api';

// masters_lookup.py's factory again: search / include_inactive / format are the
// only query params, and this is the narrowest sub-master of the fifteen —
// masters_simple.py:207-212 declares fields={"name": (str, ...)}, so the whole
// response row is {id, is_active, name}. There is genuinely nothing else to
// filter, sort or show.
//
// The prototype's Status filter is covered by `includeInactiveParam` and the
// shared "Show inactive" control (see service-categories.list.config.ts for the
// full reasoning), so no duplicate Status <select> is declared.
const config: ListScreenConfig<UnitOfMeasureRow> = {
  shape: 'list',
  id: 'masters.units_of_measure',
  title: 'Unit of Measure',
  specRef: '§3.13',
  recordNoun: 'unit',
  // The prototype's list screen has no desc; this is its own wording from the
  // Add screen (data.js masters.uom.add).
  description: 'Controlled units for invoice and quote line items.',
  endpoint: '/masters/units-of-measure',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/units-of-measure', row.id, 'edit'],
  createRoute: ['/masters/units-of-measure', 'new'],
  createLabel: 'Add Unit',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  filters: [
    {
      // Always resolves to "No" today — masters_simple.py registers this
      // lookup with referenced_by=[] (checked: genuinely zero tables
      // anywhere in the schema point at units_of_measure yet), not because
      // the filter itself is fake. Kept for consistency with every sibling
      // lookup rather than silently dropped, and starts reflecting real
      // data the moment some future module's FK is added to that list.
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
  ],
  columns: [
    // The prototype's header is 'Unit', not 'Unit of Measure' — the page title
    // already says which master this is.
    { key: 'name', header: 'Unit', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only, both gated on the
  // 'delete' action the API's own require_screen check uses.
  //
  // QUEUED — see this group's audit report: masters_lookup.py's factory has no
  // reverse of POST /{id}/deactivate, so a deactivated unit can never come back
  // via this UI even though §3.13's own Fields Table lists Status as a normal
  // editable toggle. This button targets the endpoint that reversal needs
  // (POST /{id}/activate) ahead of the backend adding it — inert (404) until it
  // does, same pattern this session used for Financial Year's End Date.
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/units-of-measure/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/units-of-measure/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.13 asks for a confirmation before deactivating a unit already used on a line item. Existing invoices and quotes keep it; it just stops being offered on new ones. Continue?',
    },
    {
      // ON DELETE RESTRICT is what enforces §3.13's "never hard-deleted once
      // used on any Invoice line item" — the API returns 409 rather than
      // orphaning the line.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/units-of-measure/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this unit permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No units configured.',
};

export default config;
