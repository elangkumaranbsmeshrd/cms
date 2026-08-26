import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';

interface LeaveBalanceAdjustmentRow {
  readonly id: string;
  readonly employee_id: string;
  readonly leave_type_id: string;
  readonly financial_year_id: string;
  readonly adjustment_days: string;
  readonly reason: string;
  readonly source: string;
  readonly adjusted_by: string;
  readonly adjusted_at: string;
  readonly balance_before: string;
  readonly balance_after: string;
}

// adjusted_by is a raw platform User id, resolved via the cross-cutting
// GET /users (same lookup my-leave.component.ts's own actioned_by uses).
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

const DIRECTION_OPTIONS = [
  { value: 'positive', label: 'Positive (grants)' },
  { value: 'negative', label: 'Negative (corrections)' },
];

/** §2.3 Leave Balance Management's own "Adjustment History" — previously
 * disclosed as deferred (leave_balance.py's own prior docstring: "no listing
 * endpoint exists... an adjustment log that can't be filtered by who made
 * the adjustment is not much of an audit trail"). GET /leave-balances/
 * adjustments now exists (leave_balance.py's list_leave_balance_adjustments)
 * with exactly the filter set §2.3 names: Employee, Leave Type, Adjusted By,
 * Date range, positive/negative. Reuses the leave.balance_management screen
 * id — same pattern as this module's own Carry Forward Run bespoke route —
 * since this is a read-only sub-view of that screen, not a new RBAC surface;
 * reached from its own "Adjustment History" secondary action.
 */
const config: ListScreenConfig<LeaveBalanceAdjustmentRow> = {
  shape: 'list',
  id: 'leave.balance_management',
  title: 'Leave Balance Adjustment History',
  specRef: '§2.3',
  recordNoun: 'adjustment',
  description: 'Every manual correction to a leave balance — append-only, balance before and after recorded on each row.',
  endpoint: '/leave-balances/adjustments',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'employee_id',
      label: 'Employee',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employees',
      optionsRef: { endpoint: '/employees', labelKey: 'first_name' },
    },
    {
      key: 'leave_type_id',
      label: 'Leave Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Leave Types',
      optionsRef: { endpoint: '/masters/leave-types' },
    },
    {
      key: 'adjusted_by',
      label: 'Adjusted By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Anyone',
      optionsFromRows: (rows, refData) => {
        const seen = new Map<string, string>();
        for (const row of rows) {
          if (!seen.has(row.adjusted_by)) seen.set(row.adjusted_by, refData.label(USER_REF, row.adjusted_by));
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label }));
      },
    },
    { key: 'date', label: 'Date', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'date' },
    { key: 'direction', label: 'Direction', kind: 'select', transport: 'server', allLabel: 'Any', options: DIRECTION_OPTIONS },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', ref: { endpoint: '/employees', labelKey: 'first_name' } },
    { key: 'leave_type_id', header: 'Leave Type', ref: { endpoint: '/masters/leave-types' } },
    { key: 'adjusted_at', header: 'Date', type: 'date' },
    { key: 'adjustment_days', header: 'Amount', type: 'number' },
    { key: 'reason', header: 'Reason' },
    { key: 'adjusted_by', header: 'Adjusted By', ref: USER_REF },
    { key: 'balance_before', header: 'Balance Before', type: 'number' },
    { key: 'balance_after', header: 'Balance After', type: 'number' },
  ],
  defaultPageSize: 25,
  emptyText: 'No balance adjustments recorded.',
};

export default config;
