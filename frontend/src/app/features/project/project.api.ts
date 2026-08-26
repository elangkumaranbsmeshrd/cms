// Mirrors backend/app/schemas/project.py, in full, across Project/Task/Bug/
// Sprint/Milestone/TimesheetEntry. Decimal columns (Project.budget,
// TimesheetEntry.hours) arrive as JSON STRINGS — Pydantic v2's own
// serialisation, the same already-documented convention AssetRow.purchase_value
// and taxes.list.config.ts rely on elsewhere in this app.
//
// Every status/priority/severity/category value below is a literal
// Python-validated string (a DB CHECK constraint, not a Masters sub-master —
// confirmed against every @field_validator in schemas/project.py) — see
// staticOptions constants at the bottom, reused verbatim across every screen
// in this module rather than re-derived per file.

export interface ProjectRow {
  readonly id: string;
  readonly project_code: string;
  readonly financial_year_id: string;
  readonly project_name: string;
  readonly customer_id: string;
  readonly opportunity_id: string | null;
  readonly status: string; // NOT_STARTED | IN_PROGRESS | ON_HOLD | COMPLETED
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly budget: string | null; // Decimal-as-string; sensitive_fields=("budget",) on project.directory
  readonly description: string | null;
  readonly project_lead_id: string;
  readonly member_ids: readonly string[];
  readonly created_at: string;
  readonly created_by: string | null; // raw User id — resolved via USER_REF
  readonly updated_by: string | null; // raw User id — resolved via USER_REF
}

export interface TaskSubtaskRow {
  readonly id: string;
  readonly task_id: string;
  readonly text: string;
  readonly is_checked: boolean;
  readonly sequence: number;
}

export interface TaskCommentRow {
  readonly id: string;
  readonly task_id: string;
  readonly author_id: string; // raw User id — resolved via USER_REF (GET /users)
  readonly content: string;
  readonly created_at: string;
}

export interface TaskRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly assignee_id: string; // required — Task.assignee_id is NOT NULL
  readonly due_date: string | null;
  readonly status: string; // BACKLOG | TODO | IN_PROGRESS | IN_REVIEW | DONE
  readonly priority: string | null; // LOW | MEDIUM | HIGH | URGENT
  readonly sprint_id: string | null;
  readonly subtasks: readonly TaskSubtaskRow[];
  readonly comments: readonly TaskCommentRow[];
  readonly created_at: string;
  readonly created_by: string | null; // raw User id — resolved via USER_REF
  readonly updated_by: string | null; // raw User id — resolved via USER_REF
}

export interface SprintRow {
  readonly id: string;
  readonly project_id: string;
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: string; // ACTIVE | COMPLETED (PLANNED is defensively supported, never actually produced)
}

export interface BugCommentRow {
  readonly id: string;
  readonly bug_id: string;
  readonly author_id: string; // raw User id, same 0.3 caveat as TaskCommentRow.author_id
  readonly content: string;
  readonly created_at: string;
}

export interface BugRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: string; // LOW | MEDIUM | HIGH | CRITICAL
  readonly status: string; // OPEN | IN_PROGRESS | FIXED | CLOSED
  readonly assignee_id: string | null; // nullable, unlike Task.assignee_id
  readonly due_date: string | null;
  readonly reported_by: string; // raw User id
  readonly comments: readonly BugCommentRow[];
  readonly created_at: string;
  readonly created_by: string | null; // raw User id — resolved via USER_REF
  readonly updated_by: string | null; // raw User id — resolved via USER_REF
}

export interface MilestoneRow {
  readonly id: string;
  readonly project_id: string;
  readonly milestone_name: string;
  readonly target_date: string;
  readonly description: string | null;
  readonly status: string; // UPCOMING | REACHED | MISSED
  readonly linked_task_ids: readonly string[];
  readonly tasks_done: number | null; // both null (not 0/0) when nothing linked
  readonly tasks_total: number | null;
}

export interface TimesheetEntryRow {
  readonly id: string;
  readonly project_id: string;
  readonly employee_id: string;
  readonly entry_date: string;
  readonly task_id: string | null;
  readonly category: string | null; // BENCH | INTERNAL_MEETING | TRAINING | ADMIN_OVERHEAD | OTHER
  readonly hours: string; // Decimal-as-string
  readonly notes: string | null;
  readonly status: string; // DRAFT | SUBMITTED | APPROVED
  readonly submitted_at: string | null;
  readonly approved_by: string | null; // raw User id
  readonly approved_at: string | null;
}

// ---------------------------------------------------------------------------
// Shared refs — §0.3/§5: GET /employees returns first_name/last_name as two
// separate fields, never a single 'name', so labelKey: 'first_name' is the
// established (imperfect but functional) workaround used repeatedly across
// every other already-built module. GET /employees 404s for the EMPLOYEE role
// (§0.6) — RefDataService.label()/.options() already degrade gracefully to
// the raw id / an empty list on that error, so no extra handling is needed
// here to satisfy that requirement.
// ---------------------------------------------------------------------------
export const CUSTOMER_REF = { endpoint: '/customers', labelKey: 'company_name' };
export const EMPLOYEE_REF = { endpoint: '/employees', labelKey: 'first_name' };
// author_id (TaskComment/BugComment) and reported_by (Bug) are platform User
// ids, not Employee ids — resolved separately via the cross-cutting GET /users.
export const USER_REF = { endpoint: '/users', labelKey: 'name' };
export const PROJECT_FY_REF = { endpoint: '/masters/financial-years', labelKey: 'label' };

// ---------------------------------------------------------------------------
// Static option lists — verbatim backend CHECK-constraint values (schemas/
// project.py's own @field_validator lists), never a Masters lookup.
// ---------------------------------------------------------------------------
export const PROJECT_STATUS_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not Started' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
];

export const TASK_STATUS_OPTIONS = [
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'DONE', label: 'Done' },
];

export const TASK_PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

export const BUG_STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'FIXED', label: 'Fixed' },
  { value: 'CLOSED', label: 'Closed' },
];

export const BUG_SEVERITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

// PLANNED is defensively supported (badge/label exists) but the backend never
// actually produces it — start_sprint() always seeds status="ACTIVE" — so no
// screen here builds a flow that expects to see it.
export const SPRINT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PLANNED', label: 'Planned' },
];

export const MILESTONE_STATUS_OPTIONS = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'REACHED', label: 'Reached' },
  { value: 'MISSED', label: 'Missed' },
];

// Verbatim from my-timesheets.list.config.ts (project.timesheet.mine) — same
// backend enum, reused rather than re-derived per the brief's own instruction.
export const TIMESHEET_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
];

export const TIMESHEET_CATEGORY_OPTIONS = [
  { value: 'BENCH', label: 'Bench / Free Time' },
  { value: 'INTERNAL_MEETING', label: 'Internal Meeting' },
  { value: 'TRAINING', label: 'Training / Learning' },
  { value: 'ADMIN_OVERHEAD', label: 'Admin & Overhead' },
  { value: 'OTHER', label: 'Other' },
];

export function taskPriorityLabel(v: string | null): string {
  return TASK_PRIORITY_OPTIONS.find((o) => o.value === v)?.label ?? (v ?? '');
}

export function bugSeverityLabel(v: string): string {
  return BUG_SEVERITY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

// Prototype's initials() (app-core.js:74) — up to the first two space-
// separated words' first letters, uppercased. The Task/Bug board cards'
// `card.avatar` mini-av bubble (board-screen.component.ts) is the one
// consumer today; kept here rather than duplicated per board config since
// both need the identical algorithm on the identical EMPLOYEE_REF labels.
export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]).join('').toUpperCase();
}
