import { formatDate } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { BoardScreenConfig } from '../../../shared/screens/screen.types';
import { BUG_SEVERITY_OPTIONS, BUG_STATUS_OPTIONS, BugRow, EMPLOYEE_REF, USER_REF, bugSeverityLabel, initials } from '../project.api';

const TODAY = () => new Date().toISOString().slice(0, 10);

/** §3 Bugs tab (project.board — SAME screen key as Task Board, a separate
 * BoardScreenConfig instance). Same visibility-only RBAC treatment as Tasks
 * (screenAction:'view' everywhere a default would silently pick 'edit').
 *
 * CRITICAL asymmetry from Task Board: Bugs have NO narrow status-only
 * endpoint — the only route is `PUT /bugs/{id}`, a full replace
 * (update_bug() in projects.py loops `body.model_dump().items()` over
 * every BugWrite field). stageChangeBody therefore spreads the dragged
 * row's own current fields and only replaces status; the config-level
 * default (`{status:newValue}` alone) would either 422 (assignee_id
 * required-shape mismatches aside) or silently null out title/description/
 * severity/assignee/due_date on every drag.
 */
export function buildProjectBugsBoardConfig(projectId: string, refData: RefDataService): BoardScreenConfig<BugRow> {
  return {
    shape: 'board',
    id: 'project.board',
    title: 'Bugs',
    recordNoun: 'bug',
    endpoint: `/projects/${projectId}/bugs`,
    exportable: true,
    rowId: (row) => row.id,
    statusField: 'status',
    columns: BUG_STATUS_OPTIONS,
    // app-screens.js:368-373's own card shape, `isBug` branch: id/title, NO
    // sprint/meta line (bugs don't have one — that line is Task-only), then
    // Severity badge + assignee mini-avatar ('?' when Unassigned, exactly
    // like `U.initials(i.a === 'Unassigned' ? '?' : i.a)`) + due date. Bug's
    // own Reported By has no card-level slot in the prototype either — it
    // only ever shows on the record itself (project.bug-detail.component.ts).
    card: {
      code: (row) => row.id.slice(0, 8),
      title: (row) => row.title,
      badge: (row) => bugSeverityLabel(row.severity),
      avatar: (row) => (row.assignee_id ? initials(refData.label(EMPLOYEE_REF, row.assignee_id)) : '?'),
      due: (row) => (row.due_date ? formatDate(row.due_date) : null),
      dueOverdue: (row) => !!row.due_date && row.due_date < TODAY() && row.status !== 'CLOSED' && row.status !== 'FIXED',
    },
    filters: [
      { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: BUG_STATUS_OPTIONS },
      { key: 'severity', label: 'Severity', kind: 'multiselect', transport: 'server', allLabel: 'All Severities', options: BUG_SEVERITY_OPTIONS },
      { key: 'assignee_id', label: 'Assignee', kind: 'select', transport: 'server', allLabel: 'All Assignees', optionsRef: EMPLOYEE_REF },
      // Bugs has no dedicated "distinct reporters" endpoint — optionsFromRows
      // is screen.types.ts's own documented answer for "a dimension with no
      // dedicated endpoint" (my-tasks-bugs.list.config.ts's own Status filter
      // uses the identical technique): derive the option list from the
      // distinct values actually present, labelled via USER_REF.
      {
        key: 'reported_by',
        label: 'Reported By',
        kind: 'select',
        transport: 'server',
        allLabel: 'All Reporters',
        optionsFromRows: (rows) => [...new Set(rows.map((r) => r.reported_by))].map((id) => ({ value: id, label: refData.label(USER_REF, id) })),
      },
      // A real bool query param (unassigned_only) — unlike Task, Bug.assignee_id
      // is genuinely nullable, so this tristate is satisfiable both ways
      // (confirmed: FastAPI/Pydantic bool coercion accepts the literal
      // 'yes'/'no' strings board-screen.component.ts's own tristate control
      // sends — 'yes' -> True, 'no'/omitted -> False).
      { key: 'unassigned_only', label: 'Unassigned', kind: 'tristate', transport: 'server', allLabel: 'Unassigned — Any' },
      { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server' },
      // §2.6 marks "Overdue only" and "Created On range" Deferred, reasoning
      // Due Date range already "covers the practical query" — reversed here
      // for consistency with Task Board's identical pair, added the same
      // stage, and per the platform-wide "no gaps" directive: neither is
      // schema-blocked (Bug has due_date/created_at via AuditMixin), so the
      // prior deferral was an editorial call, not a technical one.
      { key: 'overdue_only', label: 'Overdue', kind: 'tristate', transport: 'server', allLabel: 'Overdue — Any' },
      { key: 'created', label: 'Created On', kind: 'daterange', transport: 'server' },
      // No separate "Created By" here — Bug.reported_by IS Bug.created_by
      // (create_bug sets both to the same id, with no reassign-reporter
      // action anywhere), so Reported By above already satisfies that
      // baseline dimension; a second, always-identical filter would be
      // clutter. Last Modified By has no such overlap — a Manager/Super
      // Admin editing someone else's bug is the one case Reported By can't
      // show — so RBAC §2.2(e)'s Super-Admin baseline is built for this one.
      {
        key: 'last_modified_by',
        label: 'Last Modified By',
        kind: 'select',
        transport: 'server',
        allLabel: 'Anyone',
        superAdminOnly: true,
        optionsFromRows: (rows) => [...new Set(rows.map((r) => r.updated_by).filter((v): v is string => !!v))].map((id) => ({ value: id, label: refData.label(USER_REF, id) })),
      },
    ],
    searchFields: ['title', 'description'],
    stageChangeEndpoint: (row) => `/bugs/${row.id}`,
    stageChangeMethod: 'PUT',
    stageChangeBody: (row, newValue) => ({
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: newValue,
      assignee_id: row.assignee_id,
      due_date: row.due_date,
    }),
    stageChangeScreenAction: 'view',
    createRoute: ['/projects', projectId, 'bugs', 'new'],
    createLabel: 'Report Bug',
    createScreenAction: 'view',
    rowRoute: (row) => ['/projects', projectId, 'bugs', row.id],
  };
}
