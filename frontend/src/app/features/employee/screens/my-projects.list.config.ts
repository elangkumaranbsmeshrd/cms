import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { CUSTOMER_REF, PROJECT_STATUS_OPTIONS } from '../../project/project.api';

interface MyProjectRow {
  readonly id: string;
  readonly project_code: string;
  readonly project_name: string;
  readonly status: string;
  readonly start_date: string | null;
  readonly end_date: string | null;
}

/** §2.8 My Projects & Tasks, "My Projects" tab (employee.my_projects_tasks)
 * — GET /employees/me/projects, scoped to projects the caller leads or is
 * a member of. Export IS built server-side (projects.py's own my_projects,
 * format=pdf|excel via list_export.build_export) — 2026-08-11 production-
 * readiness audit found this flag stale; corrected.
 *
 * Filters/search/rowRoute added in a later pass: §2.8's own words, "added
 * in this revision, since neither had any" — Status, Customer, and a date
 * range on Start Date, plus search on Project Name. Service Category is
 * skipped — Project has no such field (the same genuinely-absent dimension
 * already confirmed on Customer's and Opportunity's own directories).
 * rowRoute reuses project.directory's own destination — the record itself
 * already scopes correctly to Employee's 'own' mode, no separate route needed.
 */
const config: ListScreenConfig<MyProjectRow> = {
  shape: 'list',
  id: 'employee.my_projects_tasks',
  title: 'My Projects',
  specRef: '§2.8',
  recordNoun: 'project',
  description: 'Projects you lead or are a member of.',
  endpoint: '/employees/me/projects',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/projects', row.id],
  searchParam: 'search',
  searchFields: ['project_name'],
  includeInactiveParam: false,
  filters: [
    { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: PROJECT_STATUS_OPTIONS },
    { key: 'customer_id', label: 'Customer', kind: 'select', transport: 'server', allLabel: 'All Customers', optionsRef: CUSTOMER_REF },
    { key: 'start_date', label: 'Start Date', kind: 'daterange', transport: 'server' },
  ],
  columns: [
    { key: 'project_code', header: 'Code', type: 'code' },
    { key: 'project_name', header: 'Project Name', cellClass: 'cell-strong' },
    { key: 'status', header: 'Status', type: 'status' },
    { key: 'start_date', header: 'Start Date', type: 'date' },
    { key: 'end_date', header: 'End Date', type: 'date' },
  ],
  defaultPageSize: 25,
  emptyText: "You aren't on any project yet.",
};

export default config;
