import { formatDate } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { BoardScreenConfig } from '../../../shared/screens/screen.types';
import { EMPLOYEE_REF, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, TaskRow, USER_REF, initials, taskPriorityLabel } from '../project.api';

const TODAY = () => new Date().toISOString().slice(0, 10);

// A Task's own sprint tag line (app-screens.js:370) reads the same endpoint
// the Sprint filter's optionsRef below already points at — one for a single
// sprint_id -> name lookup (card.meta), one for the whole option list. Kept
// as one constant so neither drifts from the other.
function sprintRef(projectId: string) {
  return { endpoint: `/projects/${projectId}/sprints`, labelKey: 'name' };
}

/** §3 Task Board tab (project.board) — a factory since the endpoint/routes
 * are scoped to ONE project, matching buildEmployeeDocumentsListConfig's own
 * reasoning for the identical need elsewhere in this codebase. `refData` is
 * passed in already-injected by the caller (a component) rather than this
 * factory calling inject() itself — BoardCardFieldsDef's functions are plain
 * closures with no DI access of their own (unlike ColumnDef.ref, which
 * ListScreenComponent resolves generically), so the only safe way to read
 * RefDataService's cache from inside `card.meta` is to close over an
 * instance obtained in a real injection context beforehand.
 *
 * §0's RBAC trap: this whole screen is visibility-only (no 'edit' action
 * exists on project.board at all — only 'delete' does) — every gate below
 * that would otherwise default to 'edit' is set to 'view' explicitly, which
 * PolicyStore.can() resolves via its ALWAYS_ALLOWED list to a bare
 * canOpen(id) check, matching create_task/update_task/update_task_status's
 * identical require_screen(BOARD_SCREEN) with no action= at all.
 */
export function buildProjectTasksBoardConfig(projectId: string, refData: RefDataService): BoardScreenConfig<TaskRow> {
  return {
    shape: 'board',
    id: 'project.board',
    title: 'Task Board',
    recordNoun: 'task',
    endpoint: `/projects/${projectId}/tasks`,
    exportable: true,
    rowId: (row) => row.id,
    statusField: 'status',
    // TASK_STATUS_OPTIONS is declared in workflow order (Backlog -> To Do ->
    // In Progress -> In Review -> Done), which is also the correct
    // left-to-right board column order — reused rather than duplicated.
    columns: TASK_STATUS_OPTIONS,
    // app-screens.js:368-373's own card shape: id/title, an accent-tinted
    // sprint tag line (tasks only — never bugs), then a bottom row of
    // Priority badge + assignee mini-avatar + due date. `meta` carries the
    // sprint tag (screen.types.ts's own BoardCardFieldsDef.meta doc names
    // this exact case), NOT assignee/priority — those already have their
    // own dedicated slots (avatar/badge) below.
    card: {
      code: (row) => row.id.slice(0, 8),
      title: (row) => row.title,
      meta: (row) => (row.sprint_id ? refData.label(sprintRef(projectId), row.sprint_id).replace(/ —.*$/, '') : null),
      badge: (row) => (row.priority ? taskPriorityLabel(row.priority) : ''),
      avatar: (row) => initials(refData.label(EMPLOYEE_REF, row.assignee_id)),
      due: (row) => (row.due_date ? formatDate(row.due_date) : null),
      dueOverdue: (row) => !!row.due_date && row.due_date < TODAY() && row.status !== 'DONE',
    },
    filters: [
      { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: TASK_STATUS_OPTIONS },
      { key: 'assignee_id', label: 'Assignee', kind: 'select', transport: 'server', allLabel: 'All Assignees', optionsRef: EMPLOYEE_REF },
      { key: 'sprint_id', label: 'Sprint', kind: 'select', transport: 'server', allLabel: 'All Sprints', optionsRef: sprintRef(projectId) },
      { key: 'priority', label: 'Priority', kind: 'multiselect', transport: 'server', allLabel: 'All Priorities', options: TASK_PRIORITY_OPTIONS },
      { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server' },
      { key: 'overdue_only', label: 'Overdue', kind: 'tristate', transport: 'server', allLabel: 'Overdue — Any' },
      { key: 'created', label: 'Created On', kind: 'daterange', transport: 'server' },
      {
        key: 'created_by',
        label: 'Created By',
        kind: 'select',
        transport: 'server',
        allLabel: 'Anyone',
        superAdminOnly: true,
        optionsFromRows: (rows) => [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))].map((id) => ({ value: id, label: refData.label(USER_REF, id) })),
      },
    ],
    searchFields: ['title', 'description'],
    stageChangeEndpoint: (row) => `/tasks/${row.id}/status`,
    // Task.status has its own narrow status-only endpoint (TaskStatusUpdate) —
    // the default `{status:newValue}` body is exactly right here, unlike Bugs.
    stageChangeScreenAction: 'view',
    createRoute: ['/projects', projectId, 'tasks', 'new'],
    createLabel: 'Add Task',
    createScreenAction: 'view',
    rowRoute: (row) => ['/projects', projectId, 'tasks', row.id],
  };
}
