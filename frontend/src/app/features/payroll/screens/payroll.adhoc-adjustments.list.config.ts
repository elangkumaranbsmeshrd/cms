import { ListScreenConfig, RefLookup } from '../../../shared/screens/screen.types';
import { ADJUSTMENT_STATUS_OPTIONS, ADJUSTMENT_TYPE_OPTIONS, AdhocAdjustmentRow } from '../payroll.api';

// created_by is a raw platform User id (AuditMixin — the row can be created
// by Accountant/HR/Super Admin, not necessarily anyone with a linked
// Employee record), resolved via the cross-cutting GET /users the same way
// payroll.run-history.list.config.ts's own USER_REF resolves run_by.
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

/** §2.1a Ad-hoc Payslip Adjustments. GET /payroll/adhoc-adjustments defaults
 * `status` to ["ACTIVE"] server-side when the param is omitted entirely
 * (adhoc_adjustments.py: `Query(["ACTIVE"], alias="status")`) — the Status
 * filter's own `defaultValue` mirrors that so the on-screen chip state
 * matches what the server would do anyway on first load.
 *
 * The "Employee" and "Applies To" columns split one piece of information
 * (AdhocAdjustmentOut has no denormalised employee NAME for MULTIPLE_
 * EMPLOYEES/ALL_ACTIVE_EMPLOYEES rows, only a count) across the two columns
 * that most naturally carry each half: Employee ref-resolves employee_id and
 * is blank for those two modes (RefDataService's own honest "no id" '—'),
 * while Applies To's compute folds target_employee_count into its own label
 * ("Multiple Employees (12)") for exactly those modes. A single column can't
 * do both — ColumnDef.ref always wins over a plain compute-returned string
 * once `ref` is set (list-screen.component.ts's display()), so there is no
 * way to make ONE column either resolve a name OR print a literal count
 * depending on the row — splitting the duty across the two adjacent columns
 * the spec asks for anyway is the honest option, not a workaround.
 *
 * Column order/set mirrors data.js:1113 (Applies To/Label/Type/Amount/
 * Taxable/Recurring/Created By/Date Added) as closely as the real schema
 * allows: Taxable and Recurring are real booleans on AdhocAdjustmentOut, so
 * both render here (type:'status' on a boolean — the same true/false ->
 * b-ok/b-neutral badge convention payroll.payslips.list.config.ts's own
 * has_unpaid_leave/has_adhoc_adjustments columns already use). "Created By"
 * and "Date Added" ARE now built: AdhocAdjustmentOut exposes created_by/
 * created_at (schemas/payroll.py) — the underlying model column was always
 * written on every insert (adhoc_adjustments.py's create_adhoc_adjustment),
 * this was purely a response-schema gap, now closed. created_by is resolved
 * through USER_REF, the same raw-platform-User-id convention run_by uses on
 * payroll.run-history.list.config.ts. Status (ACTIVE/REMOVED/CONSUMED) is
 * kept, and placed last rather than removed even though the prototype's mock
 * table never shows it: it is real lifecycle data (not in the prototype's
 * simpler mock) that explains why the Remove row action disappears once a
 * row is no longer ACTIVE — dropping it would hide real, already-wired
 * information.
 */
const config: ListScreenConfig<AdhocAdjustmentRow> = {
  shape: 'list',
  id: 'payroll.adhoc_adjustments',
  title: 'Ad-hoc Payslip Adjustments',
  specRef: '§2.1a',
  recordNoun: 'adjustment',
  description: 'One-off or recurring additions and deductions applied to future payroll runs.',
  endpoint: '/payroll/adhoc-adjustments',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['label', 'note'],
  includeInactiveParam: false,
  createRoute: ['/payroll/adhoc-adjustments', 'new'],
  createLabel: 'Add Adjustment',
  createScreenAction: 'edit',
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
      key: 'adjustment_type',
      label: 'Type',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Types',
      options: ADJUSTMENT_TYPE_OPTIONS,
    },
    {
      key: 'is_taxable',
      label: 'Taxable',
      kind: 'tristate',
      transport: 'server',
    },
    {
      key: 'is_recurring',
      label: 'Recurring',
      kind: 'tristate',
      transport: 'server',
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: ADJUSTMENT_STATUS_OPTIONS,
      defaultValue: ['ACTIVE'],
    },
    { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server', allLabel: 'Any', param: 'amount' },
    {
      key: 'created_by',
      label: 'Created By',
      kind: 'select',
      transport: 'server',
      allLabel: 'Anyone',
      optionsFromRows: (rows, refData) => {
        const seen = new Map<string, string>();
        for (const r of rows) {
          if (r.created_by && !seen.has(r.created_by)) seen.set(r.created_by, refData.label(USER_REF, r.created_by));
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      },
    },
    { key: 'date_added', label: 'Date Added', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'date_added' },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', ref: { endpoint: '/employees/options', labelKey: 'label' } },
    {
      key: 'applies_to_mode',
      header: 'Applies To',
      compute: (row) => {
        if (row.applies_to_mode === 'SINGLE_EMPLOYEE') return 'Single Employee';
        if (row.applies_to_mode === 'MULTIPLE_EMPLOYEES') return `Multiple Employees (${row.target_employee_count})`;
        if (row.applies_to_mode === 'ALL_ACTIVE_EMPLOYEES') return `All Active Employees (${row.target_employee_count})`;
        return row.applies_to_mode;
      },
    },
    { key: 'label', header: 'Label' },
    { key: 'adjustment_type', header: 'Type', type: 'status', staticOptions: ADJUSTMENT_TYPE_OPTIONS },
    // ColumnDef.cellClass is a fixed string, not a per-row function — there is
    // no way to style a SUBTRACTION row's Amount differently from an ADDITION
    // row's through this mechanism, so the brief's "negative-styled... if you
    // want a nice touch" is left as a plain money column rather than forcing
    // that through with an unsafe cast.
    { key: 'amount', header: 'Amount', type: 'money' },
    { key: 'is_taxable', header: 'Taxable', type: 'status' },
    { key: 'is_recurring', header: 'Recurring', type: 'status' },
    { key: 'created_by', header: 'Created By', ref: USER_REF },
    { key: 'created_at', header: 'Date Added', type: 'date' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: ADJUSTMENT_STATUS_OPTIONS },
  ],
  rowActions: [
    {
      label: 'Remove',
      endpoint: (row) => `/payroll/adhoc-adjustments/${row.id}/remove`,
      screenAction: 'edit',
      visible: (row) => row.status === 'ACTIVE',
      // The backend does NOT reject a blank removal_reason itself (Pydantic's
      // `removal_reason: str` only requires the KEY to be present, an empty
      // string still satisfies `str`) — unlike Reissue's reason, which the
      // API validates non-blank server-side. RowActionDef has no real way to
      // abort a click: `list-screen.component.ts`'s runAction() calls
      // `action.body?.(row) ?? {}`, so returning null here still sends `{}`
      // (which would merely 422 on the missing key, not the emptier and more
      // dangerous case of a WHITESPACE-only reason, which `str` happily
      // accepts). Throwing here is the one lever that actually works: JS
      // evaluates this call's return value before `this.http.post(...)` is
      // even invoked, so a thrown error prevents any request from being
      // constructed at all — a real client-side abort, not reliance on the
      // backend's own validation as a safety net.
      body: (row) => {
        const reason = window.prompt(`Reason for removing "${row.label}" (required):`, '');
        const trimmed = reason?.trim();
        if (!trimmed) throw new Error('Removal cancelled — a reason is required.');
        return { removal_reason: trimmed };
      },
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No ad-hoc adjustments match the current filters.',
};

export default config;
