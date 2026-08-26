import { ListScreenConfig } from '../../../shared/screens/screen.types';

interface PayslipListRow {
  readonly id: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly financial_year_id: string;
  readonly net_pay: number;
  readonly generated_at: string;
  readonly status: string;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_OPTIONS = [
  { value: 'PROCESSED', label: 'Processed' },
  { value: 'REISSUED', label: 'Reissued' },
];

/** §2.5 My Payslips (payroll.my_payslips) — "one row per month... Only
 * already-processed months appear here." Every documented filter — Financial
 * Year, Month range, Net Pay range, Payslip Status — is a real 'server'
 * param on GET /payroll/payslips/me (list_my_payslips), and the endpoint now
 * accepts `format=pdf|excel` too, so Export is real.
 *
 * "Month range" (period_month_min/_max) uses the 'numberrange' filter kind —
 * a plain numeric range over period_month (1-12), not a calendar date range,
 * so 'daterange' (which suffixes _from/_to) doesn't fit; 'numberrange' does
 * (create-list-store.ts's own `${param}_min`/`${param}_max` convention),
 * same technique this revision used for Leave Approvals' Days filter.
 */
const config: ListScreenConfig<PayslipListRow> = {
  shape: 'list',
  id: 'payroll.my_payslips',
  title: 'My Payslips',
  specRef: '§2.5',
  recordNoun: 'payslip',
  description: 'Payslips already processed. A month not yet run in Payroll simply has no row here.',
  endpoint: '/payroll/payslips/me',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/my-payslips', row.id],
  searchParam: false,
  includeInactiveParam: false,
  filters: [
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Years',
      optionsRef: { endpoint: '/masters/financial-years/options', labelKey: 'label' },
    },
    { key: 'period_month', label: 'Month', kind: 'numberrange', transport: 'server', allLabel: 'All Months', param: 'period_month' },
    {
      // list_my_payslips (payslips.py) already takes `status` as a real
      // server-side multi-select — was wired client-side for no reason
      // this file itself gave; 2026-08-11 production-readiness audit fix.
      key: 'status',
      label: 'Payslip Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: STATUS_OPTIONS,
    },
    // net_pay_min/net_pay_max already accepted server-side too (same
    // handler) and were simply never wired to a frontend control.
    { key: 'net_pay', label: 'Net Pay', kind: 'numberrange', transport: 'server' },
  ],
  columns: [
    { key: 'period_month', header: 'Pay Period', compute: (row) => `${MONTH_NAMES[row.period_month]} ${row.period_year}` },
    { key: 'financial_year_id', header: 'Financial Year', ref: { endpoint: '/masters/financial-years/options', labelKey: 'label' } },
    { key: 'net_pay', header: 'Net Pay', type: 'money' },
    { key: 'generated_at', header: 'Date Processed', type: 'date' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
  ],
  defaultPageSize: 25,
  emptyText: 'No payslips have been processed yet.',
};

export default config;
