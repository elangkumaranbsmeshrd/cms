import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface TimesheetEntryRow {
  readonly id: string;
  readonly entry_date: string;
  readonly task_id: string | null;
  readonly category: string | null;
  readonly hours: string;
  readonly notes: string | null;
  readonly status: string;
}

const CATEGORY_OPTIONS = [
  { value: 'BENCH', label: 'Bench / Free Time' },
  { value: 'INTERNAL_MEETING', label: 'Internal Meeting' },
  { value: 'TRAINING', label: 'Training / Learning' },
  { value: 'ADMIN_OVERHEAD', label: 'Admin & Overhead' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
];

/** §2.8 My Projects & Tasks, "Timesheets" tab (project.timesheet.mine —
 * NOT employee.my_projects_tasks, a genuinely separate RBAC key) — GET
 * /timesheets/me, own-scoped. Real and built, despite the original module
 * doc describing this tab as "Coming Soon."
 *
 * Logging a new entry (POST /timesheets) was deliberately not wired here for
 * one pass — "a real create form given the scope of everything else." The
 * effect was a self-service screen an employee could read and never write to,
 * with a working endpoint behind it and nothing calling it. It now routes to
 * my-timesheets.log.component.ts; that component's own header explains why the
 * form is a separate route rather than an inline card.
 */
const config: ListScreenConfig<TimesheetEntryRow> = {
  shape: 'list',
  id: 'project.timesheet.mine',
  title: 'Timesheets',
  specRef: '§2.8',
  recordNoun: 'entry',
  description: 'Your own logged hours, task and non-task alike.',
  endpoint: '/timesheets/me',
  createLabel: 'Log Hours',
  createRoute: ['/my-projects-tasks', 'timesheets', 'new'],
  // Gated on VISIBILITY, not on an action — deliberately, and this is why the
  // create button could not simply be switched on. project.timesheet.mine
  // registers actions=() (rbac/registry/screens.py), so the default 'edit'
  // gate is false for every role and would hide the button from everyone.
  //
  // Declaring a new 'log' action to satisfy it would invent a permission the
  // spec does not define. §2.8 is explicit about what the gate actually is:
  // "the My Timesheet screen is visible to every role (anyone can be staffed
  // on a project), but visibility is not membership - logging hours against a
  // project requires actually being that project's Lead or a Member, checked
  // explicitly on the log endpoint (422 otherwise). Screen access never
  // substitutes for the per-project team check."
  //
  // The server agrees: log_timesheet_entry depends on
  // require_screen("project.timesheet.mine") with NO action argument, then
  // re-checks project membership itself. 'open' resolves through
  // PolicyStore.ALWAYS_ALLOWED to canOpen(), which is that same visibility
  // check — so client and server gate on identical grounds. The membership
  // half cannot be known until the projects load, so the form itself says so
  // rather than the button pretending to know.
  createScreenAction: 'open',
  exportable: true,
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
      key: 'date_range',
      label: 'Date',
      kind: 'daterange',
      transport: 'server',
      allLabel: 'All Dates',
      param: 'date',
    },
    // No flat "all my tasks across every project" endpoint exists to back
    // this with real titles the way Team Timesheet's own Task filter does
    // (project.team-timesheet.list.config.ts, scoped to one project) — this
    // screen spans every project a person is staffed on. Options derive from
    // the currently-loaded rows instead, labelled the same truncated-id way
    // the Task column itself already renders (an already-reviewed choice,
    // not re-litigated here), so the filter and the column stay consistent.
    {
      key: 'task_id',
      label: 'Task',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Tasks',
      optionsFromRows: (rows) => [...new Set(rows.map((r) => r.task_id).filter((v): v is string => !!v))].map((id) => ({ value: id, label: id.slice(0, 8) })),
    },
  ],
  columns: [
    { key: 'entry_date', header: 'Date', type: 'date' },
    { key: 'task_id', header: 'Task', type: 'code', compute: (row) => (row.task_id ? row.task_id.slice(0, 8) : '—') },
    { key: 'category', header: 'Category', staticOptions: CATEGORY_OPTIONS, compute: (row) => (row.category ? CATEGORY_OPTIONS.find((c) => c.value === row.category)?.label ?? row.category : 'Task') },
    { key: 'hours', header: 'Hours', type: 'number' },
    { key: 'notes', header: 'Notes' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
  ],
  rowActions: [
    {
      label: 'Submit',
      endpoint: (row) => `/timesheets/${row.id}/submit`,
      // project.timesheet.mine has NO registered actions at all
      // (app/rbac/registry/screens.py: actions=()) — submit_draft_
      // timesheet_entry only gates on require_screen(key), no action=,
      // i.e. "visible screen -> can call this," exactly what
      // PolicyStore.can()'s ALWAYS_ALLOWED list exists for. 'edit' would
      // never resolve true here since it isn't in `s.actions`.
      screenAction: 'view',
      visible: (row) => row.status === 'DRAFT',
      confirm: 'Submit this entry for approval?',
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No hours logged yet.',
};

export default config;
