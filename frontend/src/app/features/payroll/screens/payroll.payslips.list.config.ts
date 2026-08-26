import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';
import { MONTH_NAMES, PAYSLIP_STATUS_OPTIONS, PayslipAdminRow } from '../payroll.api';

const MONTH_FILTER_OPTIONS = MONTH_NAMES.slice(1).map((label, i) => ({ value: String(i + 1), label }));

// generated_by/updated_by are raw platform User ids, resolved via the
// cross-cutting GET /users, same convention payroll.run-history.list.
// config.ts's own USER_REF uses for run_by.
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

/** §2.3 Payslip — Accountant/HR View. GET /payroll/payslips (payslips.py's
 * list_all_payslips).
 *
 * Department column: `department_snapshot` renders honestly off the real
 * field, which is a KNOWN BACKEND BUG — confirm_payroll_run never actually
 * populates it, so every real payslip today shows a blank "—" here. Built
 * against the real field anyway rather than inventing a workaround through a
 * different id (e.g. resolving employee_id -> department some other way),
 * which would break this screen's own snapshot contract (a payslip's
 * Department is supposed to be what it was AT THE TIME, not whatever the
 * employee's current department happens to be today). The `department_id`
 * FILTER, unlike the display column, does function correctly — it's a real
 * column on the Payslip row, just never denormalised into the display
 * string — so the filter is kept.
 *
 * Designation filter: no designation_id FK exists on Payslip, only
 * designation_snapshot (text, captured at generation time — deliberately,
 * see list_all_payslips's own comment) — 'server' transport works fine
 * against a plain string match, the options just come from optionsFromRows
 * over the loaded rows' own snapshots instead of a Masters lookup.
 *
 * Created By / Last Modified By — Super Admin only (§2.3's own words),
 * resolving generated_by/updated_by (schemas/payroll.py, now exposed on
 * PayslipOut). "All Financial Years" needs no special role gating —
 * omitting financial_year_id already returns every year to every role that
 * can open this screen at all.
 *
 * "Month" filter (data.js:1131's 2nd filter, missing until now) maps onto
 * the real `period_month` query param list_all_payslips already accepts
 * (payslips.py:118) — a plain server 'select' over the 12 month names,
 * exactly like every other month-numbered filter in this module.
 *
 * Filters/columns are ordered with data.js:1130-1132's own 4 (Employee/
 * Month/Department/Status) first, in that order, then this module's real
 * extra dimensions (Financial Year/Employment Type/Designation/Net Pay/
 * Has Ad-hoc/Has Unpaid Leave) appended after — genuine backend-wired
 * filters the mock prototype simply never modelled, not drift to remove.
 */
const config: ListScreenConfig<PayslipAdminRow> = {
  shape: 'list',
  id: 'payroll.payslips_admin',
  title: 'Payslips',
  specRef: '§2.3',
  recordNoun: 'payslip',
  description: 'Every processed payslip, company-wide. Open one to see its breakup, download the PDF, or reissue it.',
  endpoint: '/payroll/payslips',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/payroll/payslips', row.id],
  searchParam: 'search',
  searchFields: ['employee_name_snapshot', 'employee_code_snapshot'],
  includeInactiveParam: false,
  filters: [
    {
      key: 'employee_id',
      label: 'Employee',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employees',
      optionsRef: { endpoint: '/employees/options', labelKey: 'label' },
    },
    {
      key: 'period_month',
      label: 'Month',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Months',
      options: MONTH_FILTER_OPTIONS,
    },
    {
      key: 'department_id',
      label: 'Department',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Departments',
      optionsRef: { endpoint: '/masters/departments/options', labelKey: 'label' },
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: PAYSLIP_STATUS_OPTIONS,
    },
    {
      key: 'financial_year_id',
      label: 'Financial Year',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Financial Years',
      optionsRef: { endpoint: '/masters/financial-years/options', labelKey: 'label' },
    },
    {
      key: 'employment_type_id',
      label: 'Employment Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Employment Types',
      optionsRef: { endpoint: '/masters/employment-types/options', labelKey: 'label' },
    },
    {
      key: 'designation',
      label: 'Designation',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Designations',
      optionsFromRows: (rows) => {
        const seen = new Map<string, string>();
        for (const r of rows) {
          const label = r.designation_snapshot;
          if (label && !seen.has(label)) seen.set(label, label);
        }
        return [...seen.values()].sort().map((v) => ({ value: v, label: v }));
      },
    },
    {
      // create-list-store.ts's serverParams() appends _min/_max to `param`
      // (defaulting to `key`) automatically for a 'numberrange' server
      // filter — key 'net_pay' alone already produces net_pay_min/
      // net_pay_max, exactly list_all_payslips's own Query param names.
      key: 'net_pay',
      label: 'Net Pay',
      kind: 'numberrange',
      transport: 'server',
    },
    {
      key: 'has_adhoc_adjustments',
      label: 'Has Ad-hoc Adjustments',
      kind: 'tristate',
      transport: 'server',
    },
    {
      key: 'has_unpaid_leave',
      label: 'Has Unpaid Leave',
      kind: 'tristate',
      transport: 'server',
    },
    // Created By and Last Modified By are both people pickers, and the filter
    // chrome renders only allLabel inside the <select> — f.label reaches a
    // title tooltip and nothing more. Each therefore names its own field; the
    // 'Anyone' the pair used to share made them indistinguishable on screen
    // and identical to a screen reader.
    {
      key: 'created_by',
      label: 'Created By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Created by Anyone',
      superAdminOnly: true,
      optionsFromRows: (rows, refData) => {
        const seen = new Map<string, string>();
        for (const r of rows) {
          if (r.generated_by && !seen.has(r.generated_by)) seen.set(r.generated_by, refData.label(USER_REF, r.generated_by));
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      },
    },
    {
      key: 'updated_by',
      label: 'Last Modified By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Modified by Anyone',
      superAdminOnly: true,
      optionsFromRows: (rows, refData) => {
        const seen = new Map<string, string>();
        for (const r of rows) {
          if (r.updated_by && !seen.has(r.updated_by)) seen.set(r.updated_by, refData.label(USER_REF, r.updated_by));
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      },
    },
  ],
  columns: [
    { key: 'employee_name_snapshot', header: 'Employee', cellClass: 'cell-strong' },
    { key: 'employee_code_snapshot', header: 'Employee Code', type: 'code' },
    { key: 'period_month', header: 'Month', compute: (row) => `${MONTH_NAMES[row.period_month]} ${row.period_year}` },
    { key: 'department_snapshot', header: 'Department' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: PAYSLIP_STATUS_OPTIONS },
    { key: 'gross_pay', header: 'Gross Pay', type: 'money' },
    { key: 'net_pay', header: 'Net Pay', type: 'money' },
    // type: 'status' on a boolean column wraps it in badgeClass()'s own
    // true/false -> b-ok/b-neutral mapping (cell-format.ts) — a colored
    // Yes/No badge, not just plain text.
    { key: 'has_unpaid_leave', header: 'Has Unpaid Leave', type: 'status' },
    { key: 'has_adhoc_adjustments', header: 'Has Ad-hoc Adjustments', type: 'status' },
  ],
  defaultPageSize: 25,
  emptyText: 'No payslips match the current filters.',
};

export default config;
