import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import {
  TICKET_CATEGORY_REF,
  TICKET_CUSTOMER_REF,
  TICKET_EMPLOYEE_REF,
  TICKET_PRIORITY_OPTIONS,
  TICKET_SATISFACTION_OPTIONS,
  TICKET_STATUS_OPTIONS,
  TICKET_USER_REF,
  TicketRow,
} from '../ticket.api';

// raised_by IS present on every row (TicketOut.raised_by) but list_tickets
// has no dedicated "distinct raisers" endpoint — its option list is derived
// from the ids actually present in the CURRENTLY LOADED rows (screen.types.
// ts's own FilterDef.optionsFromRows doc: "the honest choice for a dimension
// with no dedicated endpoint"), labeled via the same TICKET_USER_REF/
// RefDataService lookup every other User id in this module now resolves through.
export function raisedByOptions(rows: readonly TicketRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.raised_by && !seen.has(row.raised_by)) {
      seen.set(row.raised_by, { value: row.raised_by, label: refData.label(TICKET_USER_REF, row.raised_by) });
    }
  }
  return [...seen.values()];
}

// Same technique as raisedByOptions above, now that TicketOut echoes
// created_by/updated_by (schemas/ticket.py) — Super Admin's own Created By /
// Last Modified By filters (§2.2e) derive their option lists from the ids
// actually present on the loaded rows, labelled via TICKET_USER_REF.
export function createdByOptions(rows: readonly TicketRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) {
      seen.set(row.created_by, { value: row.created_by, label: refData.label(TICKET_USER_REF, row.created_by) });
    }
  }
  return [...seen.values()];
}

export function lastModifiedByOptions(rows: readonly TicketRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) {
      seen.set(row.updated_by, { value: row.updated_by, label: refData.label(TICKET_USER_REF, row.updated_by) });
    }
  }
  return [...seen.values()];
}

/** §2.1 Ticket List (ticket.list) — Super Admin/Manager see every ticket;
 * Employee sees only tickets assigned to them, server-enforced
 * (perms.mode === 'own' narrows the query itself — api/v1/tickets.py's
 * list_tickets), not something this config filters client-side.
 *
 * createScreenAction is set explicitly to 'create': ticket.list has NO 'edit'
 * action registered at all (app/rbac/registry/screens.py's actions tuple is
 * exactly ("create", "reassign", "close")), so leaving this at
 * ListScreenConfig's own 'edit' default would make "+ New Ticket" invisible
 * even to Super Admin/Manager, who hold 'create'.
 */
const config: ListScreenConfig<TicketRow> = {
  shape: 'list',
  id: 'ticket.list',
  title: 'Tickets',
  specRef: '§2.1',
  recordNoun: 'ticket',
  description: 'Support tickets raised by customers.',
  endpoint: '/tickets',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['ticket_number', 'subject'],
  includeInactiveParam: false,
  createRoute: ['/tickets', 'new'],
  createLabel: 'New Ticket',
  createScreenAction: 'create',
  filters: [
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: TICKET_STATUS_OPTIONS,
    },
    {
      key: 'priority',
      label: 'Priority',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Priorities',
      options: TICKET_PRIORITY_OPTIONS,
    },
    {
      key: 'category_id',
      label: 'Category',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Categories',
      optionsRef: TICKET_CATEGORY_REF,
    },
    {
      key: 'customer_id',
      label: 'Customer',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Customers',
      optionsRef: TICKET_CUSTOMER_REF,
    },
    {
      // §2.2b exception 1: meaningless while Employee's ticket.list mode is
      // 'own' — the list is already narrowed server-side to tickets assigned
      // to them, so an "Assigned Staff" picker over everyone else would
      // filter to an empty result. hideWhenScopeIsOwn (not hideForRoles):
      // §2.1's own words are explicit that this filter REAPPEARS once "Allow
      // Staff to View the Full Open Ticket Queue" widens their mode to
      // 'full' (backend/app/rbac/toggles.py's MODE_TOGGLE_GATES) — a static
      // role check could never react to that, only the resolved mode can.
      key: 'assigned_to',
      label: 'Assigned Staff',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Staff',
      optionsRef: TICKET_EMPLOYEE_REF,
      hideWhenScopeIsOwn: true,
    },
    // Three people pickers (Raised By plus the two Super Admin extras at the
    // bottom of this array) and three date ranges share one filter row here,
    // and the chrome renders only allLabel inside each <select> — f.label
    // reaches a title tooltip and nothing more. So each all-options text names
    // its own field: repeating 'Anyone'/'All Dates' left those dropdowns
    // indistinguishable on screen and identical to a screen reader.
    {
      // list_tickets's own `raised_by` param takes ONE value, not a list —
      // confirmed against api/v1/tickets.py — the one filter on this screen
      // that is genuinely single-select while every other one here is multi.
      key: 'raised_by',
      label: 'Raised By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Raised by Anyone',
      optionsFromRows: raisedByOptions,
    },
    { key: 'raised_date', label: 'Raised Date', kind: 'daterange', transport: 'server', allLabel: 'All Raised Dates' },
    { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server', allLabel: 'All Due Dates' },
    {
      // The real query param is a single OR across resolved_at/closed_at
      // (api/v1/tickets.py: `or_(Ticket.resolved_at >= ..., Ticket.closed_at
      // >= ...)`), not two separate ranges — one filter, matching the one
      // real param pair (resolved_closed_from/_to, param defaults to key).
      key: 'resolved_closed',
      label: 'Resolved/Closed',
      kind: 'daterange',
      transport: 'server',
      allLabel: 'All Resolved/Closed Dates',
    },
    { key: 'unassigned_only', label: 'Unassigned Only', kind: 'tristate', transport: 'server', allLabel: 'Any' },
    {
      key: 'satisfaction_rating',
      label: 'Satisfaction Rating',
      kind: 'select',
      transport: 'server',
      allLabel: 'Any Rating',
      options: TICKET_SATISFACTION_OPTIONS,
    },
    {
      // §2.2e Super Admin extra filter. TicketOut now echoes created_by
      // (schemas/ticket.py, AuditMixin), so — same technique as raised_by
      // above — the option list is derived from the ids actually present on
      // the loaded rows, labelled via TICKET_USER_REF/RefDataService. The
      // query param itself (list_tickets's own `created_by` clause) already
      // worked; only the dropdown's option source was missing.
      key: 'created_by',
      label: 'Created By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Created by Anyone',
      superAdminOnly: true,
      optionsFromRows: createdByOptions,
    },
    {
      key: 'last_modified_by',
      label: 'Last Modified By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Modified by Anyone',
      superAdminOnly: true,
      optionsFromRows: lastModifiedByOptions,
    },
  ],
  columns: [
    { key: 'ticket_number', header: 'Ticket Number', type: 'code' },
    { key: 'customer_id', header: 'Customer', ref: TICKET_CUSTOMER_REF },
    { key: 'subject', header: 'Subject', cellClass: 'cell-strong' },
    { key: 'category_id', header: 'Category', ref: TICKET_CATEGORY_REF },
    { key: 'priority', header: 'Priority', type: 'status', staticOptions: TICKET_PRIORITY_OPTIONS },
    { key: 'status', header: 'Status', type: 'status', staticOptions: TICKET_STATUS_OPTIONS },
    { key: 'assigned_to', header: 'Assigned To', ref: TICKET_EMPLOYEE_REF },
    { key: 'raised_date', header: 'Raised Date', type: 'date' },
    { key: 'due_date', header: 'Due Date', type: 'date' },
    // TicketOut.first_response_duration is already a formatted string
    // ("4h 20m") or null — displayed as-is, no computation needed here.
    { key: 'first_response_duration', header: 'First Response' },
  ],
  rowRoute: (row) => ['/tickets', row.id],
  defaultPageSize: 25,
  emptyText: 'No tickets found.',
};

export default config;
