import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface RoleDirectoryRow {
  readonly role_code: string;
  readonly role_name: string;
  readonly people_count: number;
  readonly override_count: number;
}

/** §4.1 Role Directory (rbac.role_directory) — "a summary landing view of
 * the 5 roles before drilling into any one of them." Row click opens the
 * Role Permission Matrix (4.2), pre-selected to that role.
 */
const config: ListScreenConfig<RoleDirectoryRow> = {
  shape: 'list',
  id: 'rbac.role_directory',
  title: 'Role Directory',
  specRef: '§4.1',
  recordNoun: 'role',
  description: 'The 5 roles in this system. Click a row to review or change its permissions.',
  endpoint: '/rbac/roles',
  exportable: true,
  rowId: (row) => row.role_code,
  rowRoute: (row) => ['/rbac/matrix', row.role_code],
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'has_overrides',
      label: 'Has Overrides',
      kind: 'tristate',
      transport: 'server',
      allLabel: 'Any',
    },
    // The 'numberrange' FilterKind (screen.types.ts) this screen's own
    // earlier comment was waiting on now exists — built for Asset/
    // Opportunity/Project's own numeric ranges, then never looped back to
    // apply here. Server params are people_count_min/people_count_max
    // (rbac_admin.py's list_roles), matching every other numberrange filter.
    { key: 'people_count', label: 'People Count', kind: 'numberrange', transport: 'server' },
  ],
  columns: [
    { key: 'role_name', header: 'Role Name', cellClass: 'cell-strong' },
    { key: 'people_count', header: 'People Count', type: 'number' },
    { key: 'override_count', header: 'Override Count', type: 'number' },
  ],
  defaultPageSize: 25,
  emptyText: 'No roles found.',
};

export default config;
