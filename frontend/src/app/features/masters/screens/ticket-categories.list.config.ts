import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { TicketCategoryRow } from '../masters.api';

// masters_lookup.py's factory: search / include_inactive / format are the only
// query params this endpoint takes, and masters_simple.py:214-219 declares
// fields={name, description}, so the response row is {id, is_active, name,
// description}. Nothing else exists to filter on.
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
  // QUEUED — see this group's audit report: masters_lookup.py's factory has no
  // reverse of POST /{id}/deactivate, so a deactivated category can never come
  // back via this UI even though §3.14's own Fields Table lists Status as a
  // normal editable toggle. This button targets the endpoint that reversal
  // needs (POST /{id}/activate) ahead of the backend adding it — inert (404)
  // until it does, same pattern this session used for Financial Year's End Date.
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
