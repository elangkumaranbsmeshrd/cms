import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { humanizeEnum } from '../../../shared/screens/cell-format';
import { BY_DOCUMENT_STATUS_OPTIONS, OBLIGATION_SOURCE_OPTIONS, ObligationByDocumentRow, dedupeTaxHeadOptions } from '../compliance.api';

// §2.3 Obligations — By Document. The drill-down: one row per source
// document carrying a withheld amount, so any period total on §2.2 traces
// back to what produced it. source_type is always exactly one of two
// literals (obligation_engine.py's own SourceAmount.source_type doc) —
// PURCHASE_BILL or PAYSLIP_STATUTORY_LINE, never INVOICE; Obligations tracks
// withholding taken FROM a payment TO a vendor or FROM an employee's pay,
// which Invoice (money owed BY a customer) has no part in.
//
// rowRoute therefore only routes PURCHASE_BILL rows, through to the real
// /purchase-bills/:id record (source_id IS the PurchaseBill's own id there).
// PAYSLIP_STATUTORY_LINE rows stay unlinkable and return null — source_id
// there is a PayslipStatutoryLine id, not even a Payslip id (confirmed
// against obligation_engine.py's _source_amounts_for_head/
// resolve_document_labels, which only ever look the line back up to build a
// label string, never expose the parent payslip_id on this row) — a
// confirmed backend limitation, not a frontend gap, so this doesn't fake a
// link. Same reasoning applies to counterparty, which stays a raw employee
// id for those rows.
const config: ListScreenConfig<ObligationByDocumentRow> = {
  shape: 'list',
  id: 'compliance.obligations_by_document',
  title: 'Obligations — By Document',
  specRef: '§2.3',
  recordNoun: 'document',
  description: 'One row per source document carrying a withheld amount — click through from Obligations to trace a period total back to what produced it.',
  endpoint: '/compliance/obligations/by-document',
  exportable: true,
  rowId: (row) => `${row.source_type}::${row.source_id}`,
  rowRoute: (row) => (row.source_type === 'PURCHASE_BILL' ? ['/purchase-bills', row.source_id] : null),
  searchParam: 'search',
  searchFields: ['document_label', 'counterparty', 'tax_head_name'],
  includeInactiveParam: false,
  // §2.3 filter order: Tax Head, Source, Period, Remittance Status.
  filters: [
    {
      key: 'tax_head_id',
      label: 'Tax Head',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Tax Heads',
      optionsFromRows: (rows) => dedupeTaxHeadOptions(rows.map((r) => [r.tax_head_id, r.tax_head_name] as const)),
    },
    // No `source` query param on obligations_by_document (api/v1/compliance.py)
    // — client-side over the row's own real source_label field, same as this
    // register's Documents column.
    {
      key: 'source',
      label: 'Source',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Sources',
      options: OBLIGATION_SOURCE_OPTIONS,
      predicate: (row, v) => row.source_label === v,
    },
    {
      key: 'date',
      label: 'Date',
      kind: 'daterange',
      transport: 'server',
      param: 'date',
    },
    // §2.3's "Remittance — Any / Remitted / Not Remitted". No dedicated
    // query param server-side, but remittance_status is a real field on
    // every fetched row — a full multiselect over its actual 3-value
    // vocabulary (OPEN/PART_REMITTED/REMITTED) is more precise than the
    // prototype's own collapsed Remitted/Not-Remitted binary, so this uses
    // BY_DOCUMENT_STATUS_OPTIONS (already defined for this row's own status
    // column) rather than re-flattening it back down to two values.
    {
      key: 'remittance_status',
      label: 'Remittance Status',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'Remittance — Any',
      options: BY_DOCUMENT_STATUS_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.remittance_status),
    },
  ],
  // Mirrors api/v1/compliance.py's _BY_DOCUMENT_COLUMNS one-for-one (12 cols).
  columns: [
    { key: 'document_label', header: 'Document', cellClass: 'cell-strong' },
    { key: 'source_label', header: 'Source' },
    { key: 'counterparty', header: 'Counterparty' },
    { key: 'event_date', header: 'Event Date', type: 'date' },
    { key: 'tax_head_name', header: 'Tax Head' },
    // Raw stored value is SUBTOTAL|TOTAL (purchase_bills.withholding_calculated_on
    // / masters TaxHead.default_calculated_on) or null for a payroll-sourced
    // row — humanized here via `compute` since 'status'-typed columns also
    // render a badge pill, which a plain calculation-basis fact doesn't want.
    { key: 'calculated_on', header: 'Calculated On', compute: (row) => (row.calculated_on ? humanizeEnum(row.calculated_on) : null) },
    { key: 'document_total', header: 'Document Total', type: 'money' },
    { key: 'withheld', header: 'Withheld', type: 'money' },
    { key: 'net_paid', header: 'Net Paid', type: 'money' },
    { key: 'period_label', header: 'Period' },
    { key: 'remittance_status', header: 'Remittance Status', type: 'status', staticOptions: BY_DOCUMENT_STATUS_OPTIONS },
    { key: 'authority_reference', header: 'Authority Reference' },
  ],
  defaultPageSize: 25,
  emptyText: 'No withheld documents recorded yet.',
};

export default config;
