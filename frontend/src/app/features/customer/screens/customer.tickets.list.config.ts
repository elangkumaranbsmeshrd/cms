import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { createdByOptions, lastModifiedByOptions, raisedByOptions } from '../../ticket/screens/ticket.list.config';
import {
  TICKET_CATEGORY_REF,
  TICKET_EMPLOYEE_REF,
  TICKET_PRIORITY_OPTIONS,
  TICKET_SATISFACTION_OPTIONS,
  TICKET_STATUS_OPTIONS,
  TicketRow,
} from '../../ticket/ticket.api';

/** §2.3 Customer 360, Tab: Tickets — "served by the Ticket module's list
 * endpoint, which accepts customer_id as a filter... Clicking a row opens
 * that ticket's full Detail/Conversation screen." §5's own blanket line —
 * "the cross-module tabs — Opportunities, Projects, Invoices, Tickets —
 * inherit their owning module's own filters and export" — applies here too;
 * filters/export mirror ticket.list.config.ts's own canonical set exactly
 * (minus customer_id itself — every row here is already this one customer).
 *
 * tickets.py's own `customer_id` param takes `list[str]` (multi-select
 * there) — a single-element array still matches it correctly.
 */
export function buildCustomerTicketsListConfig(customerId: string): ListScreenConfig<TicketRow> {
  return {
    shape: 'list',
    id: 'ticket.list',
    title: 'Tickets',
    specRef: '§2.3',
    recordNoun: 'ticket',
    description: 'Support tickets raised by this customer. Read-only here — open the Ticket module to edit.',
    endpoint: `/tickets?customer_id=${customerId}`,
    exportable: true,
    searchParam: 'search',
    searchFields: ['ticket_number', 'subject'],
    includeInactiveParam: false,
    rowId: (row) => row.id,
    rowRoute: (row) => ['/tickets', row.id],
    filters: [
      { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: TICKET_STATUS_OPTIONS },
      { key: 'priority', label: 'Priority', kind: 'multiselect', transport: 'server', allLabel: 'All Priorities', options: TICKET_PRIORITY_OPTIONS },
      { key: 'category_id', label: 'Category', kind: 'multiselect', transport: 'server', allLabel: 'All Categories', optionsRef: TICKET_CATEGORY_REF },
      {
        key: 'assigned_to', label: 'Assigned Staff', kind: 'multiselect', transport: 'server', allLabel: 'All Staff',
        optionsRef: TICKET_EMPLOYEE_REF, hideWhenScopeIsOwn: true,
      },
      // Three people pickers (Raised By plus the two Super Admin extras below)
      // and three date ranges sit in one filter row, and the chrome renders
      // only allLabel inside each <select> — f.label reaches a title tooltip
      // and nothing more. So every one of them names its own field: bare
      // 'Anyone'/'All Dates' repeated left the dropdowns indistinguishable on
      // screen and identical to a screen reader.
      { key: 'raised_by', label: 'Raised By', kind: 'select', transport: 'server', allLabel: 'Raised by Anyone', optionsFromRows: raisedByOptions },
      { key: 'raised_date', label: 'Raised Date', kind: 'daterange', transport: 'server', allLabel: 'All Raised Dates' },
      { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server', allLabel: 'All Due Dates' },
      { key: 'resolved_closed', label: 'Resolved/Closed', kind: 'daterange', transport: 'server', allLabel: 'All Resolved/Closed Dates' },
      { key: 'unassigned_only', label: 'Unassigned Only', kind: 'tristate', transport: 'server', allLabel: 'Any' },
      { key: 'satisfaction_rating', label: 'Satisfaction Rating', kind: 'select', transport: 'server', allLabel: 'Any Rating', options: TICKET_SATISFACTION_OPTIONS },
      { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Created by Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
      { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Modified by Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
    ],
    columns: [
      { key: 'ticket_number', header: 'Ticket Number', type: 'code' },
      { key: 'subject', header: 'Subject', cellClass: 'cell-strong' },
      { key: 'priority', header: 'Priority', type: 'status', staticOptions: TICKET_PRIORITY_OPTIONS },
      { key: 'status', header: 'Status', type: 'status', staticOptions: TICKET_STATUS_OPTIONS },
      { key: 'assigned_to', header: 'Assigned To', ref: TICKET_EMPLOYEE_REF },
    ],
    defaultPageSize: 25,
    emptyText: 'No tickets yet.',
  };
}
