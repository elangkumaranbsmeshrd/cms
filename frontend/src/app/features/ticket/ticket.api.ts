// Mirrors backend/app/schemas/ticket.py's TicketOut / TicketEntryOut /
// TicketAssignmentHistoryOut, plus the TicketWrite body both POST /tickets
// and PUT /tickets/{id} accept. Shared across every Ticket screen so the row
// shapes and the fixed option lists (STATUS/PRIORITY, mirroring
// employee/screens/my-tickets.list.config.ts's own constants verbatim) are
// declared exactly once.

export interface TicketRow {
  readonly id: string;
  readonly ticket_number: string;
  readonly financial_year_id: string;
  readonly customer_id: string;
  readonly category_id: string | null;
  readonly subject: string;
  readonly priority: string;
  readonly description: string;
  readonly assigned_to: string | null;
  readonly linked_project_id: string | null;
  readonly status: string;
  readonly raised_by: string;
  readonly raised_date: string;
  readonly due_date: string | null;
  readonly first_response_at: string | null;
  readonly resolved_at: string | null;
  readonly closed_at: string | null;
  readonly satisfaction_rating: number | null;
  // AuditMixin (models/mixins.py) — now echoed on TicketOut (schemas/
  // ticket.py) so the Super-Admin-only Created By / Last Modified By filters
  // below have ids to resolve into optionsFromRows lists via TICKET_USER_REF.
  readonly created_by: string | null;
  readonly updated_by: string | null;
  // Pre-formatted server-side (ticket_engine.format_duration), e.g.
  // "4h 20m", or null — displayed as-is everywhere, never recomputed here.
  readonly first_response_duration: string | null;
  readonly resolve_duration: string | null;
}

// The exact body both POST /tickets and PUT /tickets/{id} accept (TicketWrite,
// schemas/ticket.py) — same 'create' action both ways, there is no separate
// edit action registered for ticket.list at all. linked_project_id has no
// form control anywhere in this module (Project module isn't built yet, and
// the field is nullable both in the schema and the spec) — ticket.form.
// component.ts round-trips whatever the loaded record already had instead of
// silently clearing it on every edit.
export interface TicketWriteBody {
  readonly customer_id: string;
  readonly category_id: string | null;
  readonly subject: string;
  readonly priority: string;
  readonly description: string;
  readonly assigned_to: string | null;
  readonly linked_project_id: string | null;
  readonly due_date: string | null;
}

export interface TicketEntryRow {
  readonly id: string;
  readonly ticket_id: string;
  readonly entry_type: string;
  readonly content: string;
  readonly author_id: string;
  readonly attachment_stored_file_id: string | null;
  readonly created_at: string;
}

export interface TicketAssignmentHistoryRow {
  readonly id: string;
  readonly ticket_id: string;
  readonly previous_assignee_id: string | null;
  readonly new_assignee_id: string;
  readonly changed_by: string;
  readonly changed_at: string;
  readonly note: string | null;
}

export interface TicketReportsSummary {
  readonly by_status: Record<string, number>;
  readonly by_priority: Record<string, number>;
  readonly top_customers: readonly { readonly customer_id: string; readonly ticket_count: number }[];
  readonly average_resolve_time: string | null;
  readonly average_first_response_time: string | null;
}

// ck_tickets_status / TicketStatusUpdate._validate_status (schemas/ticket.py).
export const TICKET_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

// ck_tickets_priority / TicketWrite._validate_priority (schemas/ticket.py).
export const TICKET_PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

// TicketStatusUpdate._validate_rating: 1-5 inclusive (schemas/ticket.py).
// Labels are the prototype's own wording verbatim (app-forms.js's 't.close'
// form: '5 — Very Satisfied' … '1 — Very Unsatisfied'), not a generic "N
// Stars" — this constant backs both the List's Satisfaction Rating filter
// and ticket.close.component.ts's own Satisfaction Rating field.
export const TICKET_SATISFACTION_OPTIONS = [
  { value: '5', label: '5 — Very Satisfied' },
  { value: '4', label: '4 — Satisfied' },
  { value: '3', label: '3 — Neutral' },
  { value: '2', label: '2 — Unsatisfied' },
  { value: '1', label: '1 — Very Unsatisfied' },
];

// RefLookup shorthands reused across every Ticket screen (List columns and
// filters, the New/Edit form, Detail's header and Assignment History table,
// Reports' filters and Top Customers table) — see this module's own
// id-resolution map.
export const TICKET_CATEGORY_REF = { endpoint: '/masters/ticket-categories' };
export const TICKET_CUSTOMER_REF = { endpoint: '/customers', labelKey: 'company_name' };
export const TICKET_EMPLOYEE_REF = { endpoint: '/employees', labelKey: 'first_name' };
// §2.2/§2.3 Linked Project — Project's own id -> project_name (GET /projects,
// schemas/project.py's ProjectOut). The Project module is real
// (backend/app/api/v1/projects.py), so this is a genuine lookup, not a stub —
// see ticket.form.component.ts's own header comment for why the New/Edit
// form still fetches its OWN customer-filtered options separately rather
// than reading through this shared, unfiltered cache.
export const TICKET_PROJECT_REF = { endpoint: '/projects', labelKey: 'project_name' };
// raised_by / created_by / updated_by (Ticket) and author_id (TicketEntry)
// are platform User ids, resolved via GET /users (id -> full_name) — the
// generic cross-cutting lookup added once no Users directory endpoint
// existed anywhere in this backend.
export const TICKET_USER_REF = { endpoint: '/users', labelKey: 'name' };
