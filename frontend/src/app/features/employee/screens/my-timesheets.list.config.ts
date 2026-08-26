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
 * Logging a new entry (POST /timesheets) is deliberately not wired here —
 * a real create form given the scope of everything else in this pass;
 * Submit on an existing Draft row is, since it's a bare row action.
 */
const config: ListScreenConfig<TimesheetEntryRow> = {
  shape: 'list',
  id: 'project.timesheet.mine',
  title: 'Timesheets',
  specRef: '§2.8',
  recordNoun: 'entry',
  description: 'Your own logged hours, task and non-task alike.',
  endpoint: '/timesheets/me',
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
