import { RefDataService } from '../../../shared/screens/ref-data.service';
import { FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { TICKET_CATEGORY_REF, TICKET_USER_REF } from '../../ticket/ticket.api';

interface MyTicketRow {
  readonly id: string;
  readonly ticket_number: string;
  readonly subject: string;
  readonly priority: string;
  readonly status: string;
  readonly due_date: string | null;
  readonly assigned_to: string | null;
  readonly category_id: string | null;
  readonly raised_by: string | null;
}

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

// Same technique as ticket.list.config.ts's own raisedByOptions — no
// dedicated "distinct raisers" endpoint exists, so options are honestly
// derived from whichever raisers appear in the rows actually loaded for
// this person's own tickets.
function raisedByOptions(rows: readonly MyTicketRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.raised_by && !seen.has(row.raised_by)) {
      seen.set(row.raised_by, { value: row.raised_by, label: refData.label(TICKET_USER_REF, row.raised_by) });
    }
  }
  return [...seen.values()];
}

/** §2.7 My Tickets (employee.my_tickets) — tickets assigned to the
 * logged-in person, across every role (a real, already-scoped /me
 * endpoint — no employee-id resolution needed, unlike My Documents).
 * List-only: ticket CREATION lives on a different screen key
 * (ticket.list, action 'create') that Employees don't hold by default
 * (seed.py grants it to SUPER_ADMIN/MANAGER only) — a genuine, confirmed
 * gap, not silently worked around. Reply/status-change on an individual
 * ticket also belongs to the Ticket module's own detail screen (task
 * #23), not built here.
 */
const config: ListScreenConfig<MyTicketRow> = {
  shape: 'list',
  id: 'employee.my_tickets',
  title: 'My Tickets',
  specRef: '§2.7',
  recordNoun: 'ticket',
  description: 'Support tickets assigned to you.',
  endpoint: '/employees/me/tickets',
  exportable: false,
  rowId: (row) => row.id,
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS,
    },
    {
      key: 'priority',
      label: 'Priority',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Priorities',
      options: PRIORITY_OPTIONS,
    },
    {
      key: 'overdue_only',
      label: 'Overdue Only',
      kind: 'tristate',
      transport: 'server',
      allLabel: 'Any',
    },
    // §2.7's own filter list also names Category, Requester and Due Date
    // range — my_tickets (tickets.py) already accepted category_id/
    // raised_by/due_date_from/due_date_to server-side; only the frontend
    // wiring was missing. 2026-08-11 production-readiness audit fix.
    {
      key: 'category_id',
      label: 'Category',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Categories',
      optionsRef: TICKET_CATEGORY_REF,
    },
    {
      key: 'raised_by',
      label: 'Requester',
      kind: 'select',
      transport: 'server',
      allLabel: 'Anyone',
      optionsFromRows: raisedByOptions,
    },
    { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'due_date' },
  ],
  columns: [
    { key: 'ticket_number', header: 'Ticket #', type: 'code' },
    { key: 'subject', header: 'Subject', cellClass: 'cell-strong' },
    { key: 'category_id', header: 'Category', ref: TICKET_CATEGORY_REF },
    { key: 'priority', header: 'Priority', type: 'status', staticOptions: PRIORITY_OPTIONS },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'due_date', header: 'Due Date', type: 'date' },
  ],
  defaultPageSize: 25,
  emptyText: 'No tickets are assigned to you.',
};

export default config;
