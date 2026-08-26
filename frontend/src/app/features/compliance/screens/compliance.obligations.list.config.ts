import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { ObligationPeriodRow, OBLIGATION_SOURCE_OPTIONS, OBLIGATION_STATUS_OPTIONS, dedupeTaxHeadOptions } from '../compliance.api';

// §2.2 Obligations — Withheld on Payments. Derived live, never stored
// (obligation_engine.build_obligation_periods) — a "period" row has no real
// id anywhere, so rowId synthesizes one from the (tax head, period) grouping
// key, matching this module's own documented idiom for a derived register.
const config: ListScreenConfig<ObligationPeriodRow> = {
  shape: 'list',
  id: 'compliance.obligations',
  title: 'Obligations — Withheld on Payments',
  specRef: '§2.2',
  recordNoun: 'obligation period',
  description: 'Reconciling, per tax head per period, what was withheld from vendor and payroll payments against what has actually been deposited.',
  endpoint: '/compliance/obligations',
  exportable: true,
  rowId: (row) => `${row.tax_head_id}::${row.period_from}::${row.period_to}`,
  searchParam: 'search',
  searchFields: ['tax_head_name', 'remitted_to', 'authority_reference_label'],
  includeInactiveParam: false,
  // §2.2 filter order: Tax Head, Source, Status, Period, Overdue Only.
  filters: [
    {
      key: 'tax_head_id',
      label: 'Tax Head',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Tax Heads',
      // No dedicated Tax Head picker for just the heads present in THIS
      // register — screen.types.ts's own documented convention: derive from
      // the already-loaded rows rather than a second fetch.
      optionsFromRows: (rows) => dedupeTaxHeadOptions(rows.map((r) => [r.tax_head_id, r.tax_head_name] as const)),
    },
    {
      key: 'source',
      label: 'Source',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Sources',
      options: OBLIGATION_SOURCE_OPTIONS,
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: OBLIGATION_STATUS_OPTIONS,
    },
    // §2.2's own "Period" filter — list_obligations (api/v1/compliance.py)
    // has no period_from/period_to query param at all, only due_date_from/
    // due_date_to, so Due Date is the real, backend-supported stand-in for
    // it (same substitution the Remittances/Certificates screens make with
    // their own real date columns).
    {
      key: 'due_date',
      label: 'Due Date',
      kind: 'daterange',
      transport: 'server',
      param: 'due_date',
    },
    // §2.2's "Overdue — Any / Yes / No". No dedicated boolean query param on
    // list_obligations — client-side over the already-fetched `status`
    // field (real data, not fabricated), same idiom as ticket.list.config's
    // own tristate filters elsewhere in this codebase.
    {
      key: 'overdue_only',
      label: 'Overdue Only',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Overdue — Any',
      predicate: (row, v) => (v === 'yes' ? row.status === 'OVERDUE' : v === 'no' ? row.status !== 'OVERDUE' : true),
    },
  ],
  // Mirrors api/v1/compliance.py's _OBLIGATIONS_COLUMNS' own 13-column SET
  // one-for-one (so the exported PDF/Excel carries every on-screen column,
  // RBAC 14 §2.2f) — Source and Remitted To are transposed from the
  // export's own column order to match §2.2's on-screen column order
  // (data.js: head, src, authority, label, …) exactly; the export itself is
  // unaffected (list_export.py's own _OBLIGATIONS_COLUMNS is untouched).
  columns: [
    { key: 'tax_head_name', header: 'Tax Head', cellClass: 'cell-strong' },
    { key: 'source_label', header: 'Source' },
    { key: 'remitted_to', header: 'Remitted To' },
    { key: 'period_label', header: 'Period' },
    { key: 'period_from', header: 'Period From', type: 'date' },
    { key: 'period_to', header: 'Period To', type: 'date' },
    { key: 'documents', header: 'Documents', type: 'number', compute: (row) => row.documents.length },
    // type:'money' set explicitly on all three — none of these header words
    // ("Withheld"/"Remitted"/"Outstanding") match column-policy.ts's own
    // MONEY_LABEL auto-detection regex, so without this they would render
    // with no alignment class at all rather than the correct one.
    { key: 'withheld', header: 'Withheld', type: 'money' },
    { key: 'remitted', header: 'Remitted', type: 'money' },
    { key: 'outstanding', header: 'Outstanding', type: 'money' },
    { key: 'due_date', header: 'Due Date', type: 'date' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: OBLIGATION_STATUS_OPTIONS },
    { key: 'authority_reference_label', header: 'Authority Reference' },
  ],
  // Opens Record Remittance pre-scoped to this exact tax head/period (§2.5).
  rowRoute: (row) => ['/compliance/remittances/record', row.tax_head_id, row.period_from, row.period_to],
  defaultPageSize: 25,
  emptyText: 'No obligations recorded yet.',
};

export default config;
