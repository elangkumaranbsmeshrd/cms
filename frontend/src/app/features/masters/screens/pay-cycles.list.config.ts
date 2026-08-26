import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { PayCycleRow } from '../masters.api';

// ck_pay_cycles_type's real value set.
const CYCLE_TYPE_OPTIONS = [
  { value: 'FIXED_CYCLE', label: 'Fixed Cycle — Custom Start/End Day' },
  { value: 'CALENDAR_MONTH', label: 'Calendar Month (1st to last day)' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'superseded', label: 'Superseded' },
];

const config: ListScreenConfig<PayCycleRow> = {
  shape: 'list',
  id: 'masters.work_week_hours',
  title: 'Pay Cycle',
  specRef: '§3.20c',
  recordNoun: 'pay cycle',
  // Masters §3.20c, in its own words: the window a payroll run actually covers
  // is fully dynamic, not the calendar month, and superseding it never
  // rewrites a period that has already been processed.
  description:
    'The date window a payroll run actually covers — fully dynamic, not the calendar month. Start Day and End Day decide what date range a pay period spans, and an event dated after End Day always rolls into the next period. A change never rewrites a period that has already run; it only changes what the next Run Payroll resolves.',
  endpoint: '/masters/pay-cycles',
  // NOT exportable, deliberately: list_pay_cycles takes no `format` param at
  // all (masters_work_week.py:236-245 — "a single settings record with an Edit
  // action, not a list screen"), so an Export button here would 422.
  rowId: (row) => row.id,
  createRoute: ['/masters/work-week-hours/pay-cycles', 'new'],
  // The prototype's own button says "Edit Pay Cycle", but the real endpoint is
  // a replace: POST deactivates the current row and creates a new one with its
  // own Effective From, which is precisely how "a change never rewrites a
  // period that has already run" is modelled. The label says what happens.
  createLabel: 'Replace Pay Cycle',
  // list_pay_cycles declares NO query params whatsoever — not search, not
  // include_inactive, not even format. Everything below is therefore client
  // transport, and both shared toggles are switched off rather than rendering
  // controls that send nothing.
  searchParam: false,
  searchFields: ['cycle_type'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: no ?cycle_type= param on this endpoint.
      key: 'cycle_type',
      label: 'Cycle Type',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Cycle Types',
      options: CYCLE_TYPE_OPTIONS,
      predicate: (row, v) => row.cycle_type === String(v),
    },
    {
      // Client transport (no ?include_inactive= here either), and defaulted to
      // Active because §3.20's Pay Cycle Screen Design is "the current Cycle
      // Type, Start Day, End Day and Salary Credit Day" — the superseded rows
      // are history, reachable in one click via this filter rather than
      // padding the default view. The chip states which set is on screen.
      key: 'status',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'client',
      allLabel: 'Status — Any',
      options: STATUS_OPTIONS,
      defaultValue: 'active',
      predicate: (row, v) => (v === 'active' ? !!row.is_active : !row.is_active),
    },
  ],
  columns: [
    { key: 'cycle_type', header: 'Cycle Type', cellClass: 'cell-strong', staticOptions: CYCLE_TYPE_OPTIONS },
    { key: 'start_day', header: 'Start Day', type: 'number' },
    { key: 'end_day', header: 'End Day', type: 'number' },
    { key: 'salary_credit_day', header: 'Salary Credit Day', type: 'number' },
    { key: 'effective_from', header: 'Effective From', type: 'date' },
    // "Superseded" rather than "Inactive": replace_pay_cycle does not retire a
    // cycle, it supersedes it — and 'superseded' is already in the shared
    // badge map (cell-format.ts) as the neutral Masters state.
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Superseded') },
  ],
  // No row actions: there is no deactivate and no DELETE route on pay_cycles.
  // Superseding is what replace_pay_cycle's POST does, and that is the "+
  // Replace Pay Cycle" button above, not a per-row control.
  defaultPageSize: 50,
  emptyText: 'No pay cycle configured yet — payroll has no period window to resolve against until one exists.',
};

export default config;
