import { ListScreenConfig } from '../../../shared/screens/screen.types';

// GET /employees/me/tasks-and-bugs returns a synthetic union — a Task and a
// Bug row shape, tagged by `type`. `priority` doubles for a Bug's own
// `severity` (aliased server-side), per the real endpoint's own behavior.
interface MyTaskOrBugRow {
  readonly type: 'task' | 'bug';
  readonly id: string;
  readonly title: string;
  readonly project_id: string;
  readonly status: string;
  readonly priority: string;
  readonly due_date: string | null;
}

const TYPE_OPTIONS = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
];

// A Task's own `priority` (LOW/MEDIUM/HIGH/URGENT) and a Bug's `severity`,
// aliased into this same synthetic `priority` field (LOW/MEDIUM/HIGH/
// CRITICAL) — a static, deduped union rather than optionsFromRows, since
// (unlike Status, whose two vocabularies barely overlap) this is a small,
// fixed enum where a currently-empty page shouldn't hide a real choice
// (e.g. "Critical" simply because no bug happens to be on the loaded page).
const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' }, // Task only
  { value: 'CRITICAL', label: 'Critical' }, // Bug's Severity only
];

/** §2.8 My Projects & Tasks, "My Tasks & Bugs" tab — GET
 * /employees/me/tasks-and-bugs. `rowId` uses `${type}-${id}` since a Task
 * and a Bug can share the same id space. rowRoute now wired — the Project
 * module owns Task/Bug detail and is built (project.task-detail.component
 * .ts / project.bug-detail.component.ts), the dependency the original
 * "no rowRoute yet" note was waiting on.
 *
 * Export flipped on and Project/Priority/Due Date range/Overdue-only added
 * — §2.8's own "Deferred filters" list, closed now that the Tasks & Bugs
 * half (built first, per that same note) has the backend support to match.
 */
const config: ListScreenConfig<MyTaskOrBugRow> = {
  shape: 'list',
  id: 'employee.my_projects_tasks',
  title: 'My Tasks & Bugs',
  specRef: '§2.8',
  recordNoun: 'item',
  description: 'Tasks and bugs assigned to you, across every project.',
  endpoint: '/employees/me/tasks-and-bugs',
  exportable: true,
  rowId: (row) => `${row.type}-${row.id}`,
  rowRoute: (row) => (row.type === 'task' ? ['/projects', row.project_id, 'tasks', row.id] : ['/projects', row.project_id, 'bugs', row.id]),
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      optionsFromRows: (rows) => [...new Set(rows.map((r) => r.status))].map((v) => ({ value: v, label: v })),
    },
    {
      key: 'type',
      label: 'Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'Tasks & Bugs',
      options: TYPE_OPTIONS,
    },
    {
      key: 'project_id',
      label: 'Project',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Projects',
      optionsRef: { endpoint: '/employees/me/projects', labelKey: 'project_name' },
    },
    { key: 'priority', label: 'Priority', kind: 'multiselect', transport: 'server', allLabel: 'All Priorities', options: PRIORITY_OPTIONS },
    { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server' },
    { key: 'overdue_only', label: 'Overdue', kind: 'tristate', transport: 'server', allLabel: 'Overdue — Any' },
  ],
  columns: [
    { key: 'type', header: 'Type', type: 'status', staticOptions: TYPE_OPTIONS },
    { key: 'title', header: 'Title', cellClass: 'cell-strong' },
    { key: 'status', header: 'Status', type: 'status' },
    { key: 'priority', header: 'Priority', type: 'status', staticOptions: PRIORITY_OPTIONS },
    { key: 'due_date', header: 'Due Date', type: 'date' },
  ],
  defaultPageSize: 25,
  // The other half of §2.8's verbatim empty state, the pair to My Projects':
  // "No tasks assigned to you." The previous wording had borrowed My Tickets'
  // phrasing ("Nothing assigned to you right now.") instead. "Tasks" covers
  // the bugs in this union too — that is the spec's own shorthand for this
  // combined list, not an omission.
  emptyText: 'No tasks assigned to you.',
};

export default config;
