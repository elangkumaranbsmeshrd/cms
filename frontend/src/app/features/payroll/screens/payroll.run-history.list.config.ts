import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';
import { MONTH_NAMES, PayrollRunRow, RUN_STATUS_OPTIONS } from '../payroll.api';

// run_by is a raw platform User id, resolved via the cross-cutting GET /users
// (id -> full_name) — separate from the /employees lookup used elsewhere in
// this module, since a payroll run is executed by a platform User, not
// necessarily one with a linked Employee record (e.g. Super Admin).
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

/** §2.1 Run Payroll — Payroll History. GET /payroll/runs (payroll_runs.py's
 * list_payroll_runs) — every documented filter is now a real 'server' param:
 * Financial Year, Status (multi), Month range (against pay_period_start —
 * the real resolved date range a run covers, per §2.1's own "Pay Period
 * Covers" field, not the bare period_month/period_year integers), Run By,
 * Run On range, Employee Count range, and Search (over the resolved period
 * label, e.g. "July 2026" — no backing text column, filtered server-side in
 * Python since a run history is at most a few dozen rows).
 *
 * CRITICAL: createScreenAction is set explicitly to 'run' — ListScreenConfig.
 * createRoute's own gate defaults to action 'edit' (screen.types.ts), and
 * payroll.run has NO 'edit' action at all (actions=("run","confirm"), per
 * app/rbac/registry/screens.py). Leaving this at the default would make
 * "+ Run Payroll" invisible to every role, including Super Admin.
 *
 * Column set intentionally mirrors data.js:1105 exactly (Pay Period/Status/
 * Run By/Run On/Employees/Total Net Pay) — no Total Gross column, since the
 * prototype's History list never shows it (it's on the Run Payroll preview
 * and the Payslip itself instead); adding it here would be an Angular-only
 * addition beyond the spec'd shape.
 */
const config: ListScreenConfig<PayrollRunRow> = {
  shape: 'list',
  id: 'payroll.run',
  title: 'Payroll History',
  specRef: '§2.1',
  recordNoun: 'payroll run',
  description: 'Every payroll run, Draft or Processed. Open a Draft to review or act on it; a Processed run is a permanent record.',
  endpoint: '/payroll/runs',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/payroll/run', row.id],
  searchParam: 'search',
  searchFields: ['period_month'],
  includeInactiveParam: false,
  createRoute: ['/payroll/run', 'new'],
  createLabel: 'Run Payroll',
  createScreenAction: 'run',
  filters: [
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Financial Years',
      optionsRef: { endpoint: '/masters/financial-years/options', labelKey: 'label' },
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: RUN_STATUS_OPTIONS,
    },
    {
      key: 'date',
      label: 'Month',
      kind: 'daterange',
      transport: 'server',
      allLabel: 'All Time',
      param: 'date',
    },
    {
      key: 'run_by',
      label: 'Run By',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Run By',
      optionsFromRows: (rows, refData) => {
        const seen = new Map<string, string>();
        for (const r of rows) {
          if (r.run_by && !seen.has(r.run_by)) seen.set(r.run_by, refData.label(USER_REF, r.run_by));
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      },
    },
    { key: 'run_on', label: 'Run On', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'run_on' },
    { key: 'employee_count', label: 'Employee Count', kind: 'numberrange', transport: 'server', allLabel: 'Any', param: 'employee_count' },
  ],
  columns: [
    { key: 'period_month', header: 'Pay Period', cellClass: 'cell-strong', compute: (row) => `${MONTH_NAMES[row.period_month]} ${row.period_year}` },
    { key: 'status', header: 'Status', type: 'status', staticOptions: RUN_STATUS_OPTIONS },
    { key: 'run_by', header: 'Run By', ref: USER_REF },
    { key: 'run_on', header: 'Run On', type: 'date' },
    { key: 'employee_count', header: 'Employees', type: 'number' },
    { key: 'total_net', header: 'Total Net Pay', type: 'money' },
  ],
  defaultPageSize: 25,
  emptyText: 'No payroll runs yet.',
};

export default config;
