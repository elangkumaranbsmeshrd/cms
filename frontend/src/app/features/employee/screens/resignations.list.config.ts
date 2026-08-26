import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface ResignationRow {
  readonly id: string;
  readonly employee_id: string;
  readonly last_working_day: string;
  readonly reason: string | null;
  readonly submitted_at: string;
  readonly status: string;
  readonly final_settlement_status: string | null;
}

const STATUS_OPTIONS = [
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'MANAGER_ACKNOWLEDGED', label: 'Manager Acknowledged' },
  { value: 'HR_PROCESSING', label: 'HR Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
];

/** §2.13 Offboarding — GET /resignations, automatically scoped server-side
 * (Employee/Accountant get 'own', Manager 'team', HR/SA 'full') — the
 * same endpoint serves both "my resignation status" and HR's cross-
 * employee tracking view, no id needed either way. Row click opens the
 * per-resignation exit checklist.
 */
const config: ListScreenConfig<ResignationRow> = {
  shape: 'list',
  id: 'employee.offboarding',
  title: 'Resignations & Exits',
  specRef: '§2.13',
  recordNoun: 'resignation',
  description: 'Every resignation this role can see — your own, your team\'s, or company-wide.',
  endpoint: '/resignations',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/resignations', row.id, 'exit-checklist'],
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.status),
    },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'last_working_day', header: 'Last Working Day', type: 'date' },
    { key: 'submitted_at', header: 'Submitted On', type: 'date' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
    { key: 'final_settlement_status', header: 'Settlement' },
  ],
  rowActions: [
    {
      label: 'Acknowledge',
      endpoint: (row) => `/resignations/${row.id}/acknowledge`,
      screenAction: 'acknowledge',
      visible: (row) => row.status === 'SUBMITTED',
      confirm: 'Acknowledge this resignation?',
    },
    {
      label: 'Start Processing',
      endpoint: (row) => `/resignations/${row.id}/start-processing`,
      screenAction: 'process_exit',
      visible: (row) => row.status === 'MANAGER_ACKNOWLEDGED',
    },
    {
      label: 'Withdraw',
      endpoint: (row) => `/resignations/${row.id}/withdraw`,
      // withdraw_resignation gates on require_screen(OFFBOARDING) with no
      // action= — "applicant or HR/SA," i.e. visibility only, same
      // ALWAYS_ALLOWED reasoning as my-timesheets.list.config.ts's Submit.
      // 'process_exit' would wrongly hide this from the applicant
      // themselves, who legitimately needs it too.
      screenAction: 'view',
      visible: (row) => ['SUBMITTED', 'MANAGER_ACKNOWLEDGED', 'HR_PROCESSING'].includes(row.status),
      confirm: 'Withdraw this resignation?',
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No resignations on file.',
};

export default config;
