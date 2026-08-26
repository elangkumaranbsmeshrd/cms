import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { PROJECT_STATUS_OPTIONS, ProjectRow } from '../../project/project.api';
import { PROJECT_DIRECTORY_FILTERS } from '../../project/screens/project.directory.list.config';

/** §2.3 Customer 360, Tab: Projects — "As built, this tab is served by
 * the Project module's own list endpoint filtered by customer_id...
 * clicking a row opens its full record there." Filters/export mirror
 * project.directory.list.config.ts's own canonical set exactly (minus
 * customer_id itself — every row here is already this one customer) —
 * imports the SAME array the Directory table uses rather than a hand-copy,
 * so a filter added there later (this array already grew once, picking up
 * Financial Year/Overdue/Created On/Created By/Last Modified By) can never
 * silently stop showing up here too, matching the Opportunity/Invoice tabs'
 * own established pattern.
 */
export function buildCustomerProjectsListConfig(customerId: string): ListScreenConfig<ProjectRow> {
  return {
    shape: 'list',
    id: 'project.directory',
    title: 'Projects',
    specRef: '§2.3',
    recordNoun: 'project',
    description: 'Projects delivered or in progress for this customer. Read-only here — open the Project module to edit.',
    endpoint: `/projects?customer_id=${customerId}`,
    exportable: true,
    searchParam: 'search',
    searchFields: ['project_name'],
    includeInactiveParam: false,
    rowId: (row) => row.id,
    rowRoute: (row) => ['/projects', row.id],
    filters: PROJECT_DIRECTORY_FILTERS.filter((f) => f.key !== 'customer_id'),
    columns: [
      { key: 'project_name', header: 'Project Name', cellClass: 'cell-strong' },
      { key: 'status', header: 'Status', type: 'status', staticOptions: PROJECT_STATUS_OPTIONS },
      { key: 'start_date', header: 'Start Date', type: 'date' },
      { key: 'end_date', header: 'End Date', type: 'date' },
    ],
    defaultPageSize: 25,
    emptyText: 'No projects yet.',
  };
}
