import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { TicketCategoryRow } from '../masters.api';

// §3.0's Created By / Last Modified By pair — see
// service-categories.list.config.ts for why the options are derived from the
// rows on screen rather than from an endpoint of their own.
const USER_REF = { endpoint: '/users', labelKey: 'name' };

function peopleOptions(key: 'created_by' | 'updated_by') {
  return (rows: readonly TicketCategoryRow[], refData: RefDataService): FilterOption[] => {
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
// row's business fields are {name, code, description} (masters_simple.py's
// registration); nothing else exists to filter on.
//
// The prototype's Status filter is the shared "Show inactive" control that
// `includeInactiveParam` turns on — not a separate FilterDef (see
// service-categories.list.config.ts for why a second Status select would lie).
const config: ListScreenConfig<TicketCategoryRow> = {
  shape: 'list',
  id: 'masters.ticket_categories',
  title: 'Ticket Categories',
  specRef: '§3.14',
  recordNoun: 'ticket category',
  // The prototype's list screen has no desc; this is its own wording from the
  // Add screen (data.js masters.ticketcategories.add).
  description: 'Categories used to classify support tickets.',
  endpoint: '/masters/ticket-categories',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/ticket-categories', row.id, 'edit'],
  createRoute: ['/masters/ticket-categories', 'new'],
  createLabel: 'Add Category',
  searchParam: 'search',
  includeInactiveParam: 'include_inactive',
  // §3a — masters_simple.py now passes search_field=["name", "code"].
  searchFields: ['name', 'code'],
  // BUILT (§3a) — resolved the QUEUED note that used to sit here. Not a
  // stored/denormalized usage_count column (ExpenseType's pattern): a LIVE
  // query against Ticket.category_id instead (masters_lookup.py's
  // `referenced_by` mechanism), so it needs no write-time sync hook and is
  // correct the moment a real Ticket exists, no migration-on-this-table
  // required.
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
    { key: 'name', header: 'Ticket Category', cellClass: 'cell-strong' },
    { key: 'code', header: 'Code', type: 'code' },
    // Not in the prototype's columns, but §3.14's Screen Design says "List view
    // shows: Category Name, Description, Status" and the field is really stored.
    { key: 'description', header: 'Description' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 — Deactivate and Delete are Super Admin only.
  //
  // Activate is the other half of §3.14's "Status: Toggle (Active/Inactive)".
  // It was written against a POST /{id}/activate the factory did not have
  // yet; masters_lookup.py has since grown it, so this is a live action now,
  // not the inert stub the note that used to sit here described (verified in
  // the browser).
  rowActions: [
    {
      label: 'Activate',
      endpoint: (row) => `/masters/ticket-categories/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/ticket-categories/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: '§3.14 asks for a confirmation before deactivating a category already used on a ticket. Existing tickets keep it; it just stops being offered on new ones. Continue?',
    },
    {
      // ON DELETE RESTRICT enforces §3.14's "never hard-deleted once used on any
      // Ticket" — the API answers 409 instead of orphaning the ticket.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/ticket-categories/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Delete this ticket category permanently? This only succeeds while nothing references it.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No ticket categories configured.',
};

export default config;
