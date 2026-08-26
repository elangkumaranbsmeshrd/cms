import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { EMPLOYEE_REF, TIMESHEET_CATEGORY_OPTIONS, TIMESHEET_STATUS_OPTIONS, TimesheetEntryRow } from '../project.api';

/** §3 Team Timesheet tab (project.timesheet.team) — GET
 * /projects/{id}/timesheets. NOT gated via require_screen() at all
 * server-side — team_timesheet()/approve_timesheet_entry() both do a manual
 * resolve_permission() + Project-Lead-override check instead (§7); this
 * config only controls what renders once the HOST record component has
 * already decided the tab is visible (policy.canOpen('project.timesheet
 * .team') OR this project's own project_lead_id === the caller's own
 * employee id) — see project.record.component.ts's own visibleTabs().
 *
 * Category labels copied verbatim from my-timesheets.list.config.ts
 * (project.timesheet.mine) per the brief's own instruction, not re-derived.
 */
export function buildProjectTeamTimesheetListConfig(projectId: string): ListScreenConfig<TimesheetEntryRow> {
  return {
    shape: 'list',
    id: 'project.timesheet.team',
    title: 'Team Timesheet',
    recordNoun: 'entry',
    endpoint: `/projects/${projectId}/timesheets`,
    exportable: true,
    rowId: (row) => row.id,
    searchParam: false,
    includeInactiveParam: false,
    filters: [
      { key: 'employee_id', label: 'Employee', kind: 'select', transport: 'server', allLabel: 'All Employees', optionsRef: EMPLOYEE_REF },
      { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: TIMESHEET_STATUS_OPTIONS },
      { key: 'date', label: 'Date', kind: 'daterange', transport: 'server' },
      { key: 'task_id', label: 'Task', kind: 'select', transport: 'server', allLabel: 'All Tasks', optionsRef: { endpoint: `/projects/${projectId}/tasks`, labelKey: 'title' } },
      { key: 'sprint_id', label: 'Sprint', kind: 'select', transport: 'server', allLabel: 'All Sprints', optionsRef: { endpoint: `/projects/${projectId}/sprints`, labelKey: 'name' } },
      // §2.8's "Deferred on the team view" trio, all reversed here: neither
      // Hours range nor the stale-unapproved toggle is schema-blocked
      // (TimesheetEntry.hours/submitted_at both exist, the latter already
      // unused by any filter anywhere), and the doc's own words flag the
      // stale toggle as "the one with a real downstream consequence" —
      // Approved hours feed Payroll's hour-basis input, so an aging
      // Submitted entry is exactly the kind of thing worth surfacing.
      { key: 'hours', label: 'Hours', kind: 'numberrange', transport: 'server' },
      { key: 'stale_days', label: 'Submitted At Least (Days), Still Unapproved', kind: 'number', transport: 'server' },
    ],
    // Column order mirrors data.js:1270 (Date, Person, Task, Hours, Notes,
    // Status) with Employee inserted right after Date, matching Person's own
    // position there — Task/Category stays split into two columns rather
    // than the prototype's single merged "Task" text cell, the same already-
    // reviewed shape my-timesheets.list.config.ts's own "My Timesheet" tab
    // uses for the identical row (project.timesheet.mine, same
    // TimesheetEntryRow), not re-litigated here. Notes was missing entirely.
    columns: [
      { key: 'entry_date', header: 'Date', type: 'date' },
      { key: 'employee_id', header: 'Employee', ref: EMPLOYEE_REF, cellClass: 'cell-strong' },
      { key: 'task_id', header: 'Task', type: 'code', compute: (row) => (row.task_id ? row.task_id.slice(0, 8) : '—') },
      {
        key: 'category',
        header: 'Category',
        staticOptions: TIMESHEET_CATEGORY_OPTIONS,
        compute: (row) => (row.category ? TIMESHEET_CATEGORY_OPTIONS.find((c) => c.value === row.category)?.label ?? row.category : 'Task'),
      },
      { key: 'hours', header: 'Hours', type: 'number' },
      { key: 'notes', header: 'Notes' },
      { key: 'status', header: 'Status', type: 'status', staticOptions: TIMESHEET_STATUS_OPTIONS },
    ],
    // §2.8's "Deferred on the team view: bulk approve (approval is per
    // entry as built)" — reversed. Operates on the current page's Submitted
    // rows (POST /projects/{id}/timesheets/bulk-approve); same 'approve'
    // screenAction as the per-row button below, so it's gated identically.
    secondaryActions: [
      {
        label: 'Approve All Submitted',
        endpoint: `/projects/${projectId}/timesheets/bulk-approve`,
        screenAction: 'approve',
        confirm: 'Approve every Submitted entry currently on screen?',
        endpointBody: (rows) => {
          const entryIds = rows.filter((r) => r.status === 'SUBMITTED').map((r) => r.id);
          return entryIds.length ? { entry_ids: entryIds } : null;
        },
      },
    ],
    rowActions: [
      {
        label: 'Approve',
        endpoint: (row) => `/timesheets/${row.id}/approve`,
        screenAction: 'approve',
        visible: (row) => row.status === 'SUBMITTED',
        confirm: 'Approve this timesheet entry?',
      },
    ],
    defaultPageSize: 25,
    emptyText: 'No timesheet entries logged for this project yet.',
  };
}
