import { FilterDef, FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { CUSTOMER_REF, EMPLOYEE_REF, PROJECT_FY_REF, PROJECT_STATUS_OPTIONS, ProjectRow, USER_REF } from '../project.api';

// §2.2e Super Admin extras. No dedicated "distinct creators" endpoint, same
// technique customer.directory.config.ts's own createdByOptions/
// lastModifiedByOptions use.
function createdByOptions(rows: readonly ProjectRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) seen.set(row.created_by, { value: row.created_by, label: refData.label(USER_REF, row.created_by) });
  }
  return [...seen.values()];
}

function lastModifiedByOptions(rows: readonly ProjectRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) seen.set(row.updated_by, { value: row.updated_by, label: refData.label(USER_REF, row.updated_by) });
  }
  return [...seen.values()];
}

// §1 Project Directory (project.directory) — GET /projects. Every query
// param below confirmed against list_projects() (backend/app/api/v1/
// projects.py). Sort: start_date ascending, server-side (stmt.order_by
// (Project.start_date)) — no client sort needed.
//
// Exported so customer.projects.list.config.ts's embedded tab can import
// this SAME array (minus customer_id) rather than hand-copy it — same
// "cannot drift apart" reasoning opportunity.pipeline.list.config.ts's own
// OPPORTUNITY_PIPELINE_FILTERS already gives; the embed's own comment
// claimed parity with this file that a hand-copy could no longer guarantee
// once this array grew past what customer.projects.list.config.ts had.
export const PROJECT_DIRECTORY_FILTERS: readonly FilterDef<ProjectRow>[] = [
  { key: 'customer_id', label: 'Customer', kind: 'select', transport: 'server', allLabel: 'All Customers', optionsRef: CUSTOMER_REF },
  { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: PROJECT_STATUS_OPTIONS },
  { key: 'project_lead_id', label: 'Project Lead', kind: 'select', transport: 'server', allLabel: 'All Leads', optionsRef: EMPLOYEE_REF },
  { key: 'team_member_id', label: 'Team Member', kind: 'select', transport: 'server', allLabel: 'All Team Members', optionsRef: EMPLOYEE_REF },
  { key: 'start_date', label: 'Start Date', kind: 'daterange', transport: 'server' },
  { key: 'end_date', label: 'End Date', kind: 'daterange', transport: 'server' },
  // §0's numberrange FilterKind (screen.types.ts), auto-suffixing
  // budget_min/budget_max server-side — confirmed live in
  // asset.directory.list.config.ts's own Purchase Value filter, same
  // pattern here. project.directory registers sensitive_fields=("budget",)
  // (app/rbac/registry/screens.py) — hideWhenFieldHidden mirrors Asset's
  // own Purchase Value treatment for the identical reason: a role without
  // "Show Budget" sees neither the Budget column's real value nor a filter
  // that would silently return nothing useful for them.
  { key: 'budget', label: 'Budget', kind: 'numberrange', transport: 'server', hideWhenFieldHidden: 'budget' },
  { key: 'financial_year_id', label: 'Financial Year', kind: 'select', transport: 'server', allLabel: 'All Financial Years', optionsRef: PROJECT_FY_REF },
  { key: 'overdue_only', label: 'Overdue', kind: 'tristate', transport: 'server', allLabel: 'Overdue — Any' },
  { key: 'created', label: 'Created On', kind: 'daterange', transport: 'server' },
  { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
  { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
];

const config: ListScreenConfig<ProjectRow> = {
  shape: 'list',
  id: 'project.directory',
  title: 'Project Directory',
  recordNoun: 'project',
  endpoint: '/projects',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/projects', row.id],
  createRoute: ['/projects', 'new'],
  createLabel: 'Add Project',
  // §1: this is the one screen in the whole module where the default
  // ('edit') would actually be correct — set explicitly anyway, matching
  // every other create button in this app and for clarity against the
  // module's own big RBAC trap (every OTHER screen below needs a different
  // action here).
  createScreenAction: 'edit',
  searchParam: 'search',
  searchFields: ['project_name'],
  includeInactiveParam: false,
  filters: PROJECT_DIRECTORY_FILTERS,
  // §1: column order mirrors data.js:1239 verbatim (code, name, customer,
  // status, start, end, lead, budget) — Project Lead sits AFTER the date
  // pair, not before it.
  columns: [
    { key: 'project_code', header: 'Project Code', type: 'code' },
    { key: 'project_name', header: 'Project Name', cellClass: 'cell-strong' },
    { key: 'customer_id', header: 'Customer', ref: CUSTOMER_REF },
    { key: 'status', header: 'Status', type: 'status', staticOptions: PROJECT_STATUS_OPTIONS },
    { key: 'start_date', header: 'Start Date', type: 'date' },
    { key: 'end_date', header: 'End Date', type: 'date' },
    { key: 'project_lead_id', header: 'Project Lead', ref: EMPLOYEE_REF },
    { key: 'budget', header: 'Budget', type: 'money' },
  ],
  emptyText: 'No projects found.',
};

export default config;
