import { ReportScreenConfig, ReportTileDef, ReportTone } from '../../../shared/screens/screen.types';
import { BUG_SEVERITY_OPTIONS, EMPLOYEE_REF, TASK_PRIORITY_OPTIONS } from '../project.api';

interface ProjectReportData {
  readonly tasks_by_status: Record<string, number>;
  readonly bugs_by_severity: Record<string, number>;
  readonly bugs_by_status: Record<string, number>;
}

function tile(group: keyof ProjectReportData, key: string, label: string, icon: string, tone: ReportTone): ReportTileDef {
  return {
    icon,
    tone,
    label,
    source: 'counts',
    compute: (data) => (data as ProjectReportData)[group]?.[key] ?? 0,
  };
}

/** §3 Report tab (project.report) — GET /projects/{id}/report returns ONE
 * object with 3 nested count-dicts, never an array (confirmed against
 * project_report() in projects.py) — ReportTableDef requires its source to
 * resolve to a top-level array, so this screen is ONLY ReportTileDefs (13:
 * 5 tasks_by_status + 4 bugs_by_severity + 4 bugs_by_status), zero
 * ReportTableDefs. No `format` param exists on this endpoint at all, so
 * nothing here is exportable — genuinely nothing to export, not an
 * oversight.
 *
 * priority/severity are SINGLE selects here (the real params are singular,
 * `priority: str | None`/`severity: str | None`), unlike the Board's own
 * same-named filters which are real multiselects against a different param
 * shape — deliberately not reused as one shared FilterDef between the two
 * screens.
 */
export function buildProjectReportConfig(projectId: string): ReportScreenConfig {
  return {
    shape: 'report',
    id: 'project.report',
    title: 'Project Report',
    description: 'Task and bug counts by status and severity for this project.',
    filters: [
      { key: 'date', label: 'Date', kind: 'daterange', transport: 'server' },
      { key: 'assignee_id', label: 'Assignee', kind: 'select', transport: 'server', allLabel: 'All Assignees', optionsRef: EMPLOYEE_REF },
      { key: 'sprint_id', label: 'Sprint', kind: 'select', transport: 'server', allLabel: 'All Sprints', optionsRef: { endpoint: `/projects/${projectId}/sprints`, labelKey: 'name' } },
      { key: 'priority', label: 'Priority', kind: 'select', transport: 'server', allLabel: 'All Priorities', options: TASK_PRIORITY_OPTIONS },
      { key: 'severity', label: 'Severity', kind: 'select', transport: 'server', allLabel: 'All Severities', options: BUG_SEVERITY_OPTIONS },
    ],
    sources: [{ key: 'counts', endpoint: `/projects/${projectId}/report` }],
    tiles: [
      tile('tasks_by_status', 'BACKLOG', 'Tasks — Backlog', 'list', 'accent'),
      tile('tasks_by_status', 'TODO', 'Tasks — To Do', 'clock', 'info'),
      tile('tasks_by_status', 'IN_PROGRESS', 'Tasks — In Progress', 'refresh', 'info'),
      tile('tasks_by_status', 'IN_REVIEW', 'Tasks — In Review', 'eye', 'purple'),
      tile('tasks_by_status', 'DONE', 'Tasks — Done', 'check', 'success'),
      tile('bugs_by_severity', 'LOW', 'Bugs — Low Severity', 'alert', 'accent'),
      tile('bugs_by_severity', 'MEDIUM', 'Bugs — Medium Severity', 'alert', 'info'),
      tile('bugs_by_severity', 'HIGH', 'Bugs — High Severity', 'alert', 'warning'),
      tile('bugs_by_severity', 'CRITICAL', 'Bugs — Critical Severity', 'alert', 'danger'),
      tile('bugs_by_status', 'OPEN', 'Bugs — Open', 'alert', 'warning'),
      tile('bugs_by_status', 'IN_PROGRESS', 'Bugs — In Progress', 'refresh', 'info'),
      tile('bugs_by_status', 'FIXED', 'Bugs — Fixed', 'check', 'success'),
      tile('bugs_by_status', 'CLOSED', 'Bugs — Closed', 'lock', 'accent'),
    ],
    tables: [],
  };
}
