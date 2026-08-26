import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { formatMoney } from '../../../shared/screens/cell-format';
import { RemittanceRow, dedupeTaxHeadOptions } from '../compliance.api';

// §2.4 Remittances. Fully denormalized response — no ref lookups needed at
// all. A remittance is never editable after save; a wrong one is corrected
// by Reverse (§3.3), a negative-signed record referencing the original —
// Super Admin only, requires a reason.
const config: ListScreenConfig<RemittanceRow> = {
  shape: 'list',
  id: 'compliance.remittances',
  title: 'Remittances',
  specRef: '§2.4',
  recordNoun: 'remittance',
  description: 'One row per deposit actually made. A remittance is never edited — a wrong one is corrected by a reversal that references the original.',
  endpoint: '/compliance/remittances',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['remittance_number', 'tax_head_name_snapshot', 'authority_reference'],
  includeInactiveParam: false,
  // §2.4 filter order: Tax Head, Period, Paid From, Mode.
  filters: [
    {
      key: 'tax_head_id',
      label: 'Tax Head',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Tax Heads',
      optionsFromRows: (rows) => dedupeTaxHeadOptions(rows.map((r) => [r.tax_head_id, r.tax_head_name_snapshot] as const)),
    },
    {
      key: 'paid_on',
      label: 'Paid On',
      kind: 'daterange',
      transport: 'server',
      param: 'paid_on',
    },
    // §2.4's "Paid From" / "Mode". list_remittances (api/v1/compliance.py)
    // takes no bank-account or payment-mode query param at all — client-side
    // over the row's own real paid_from_bank_account_id/payment_mode_id,
    // options derived from the already-fetched rows exactly like Tax Head
    // above (dedupeTaxHeadOptions is generic over any [id, label] pair
    // despite its name).
    {
      key: 'paid_from_bank_account_id',
      label: 'Paid From',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Accounts',
      optionsFromRows: (rows) => dedupeTaxHeadOptions(rows.map((r) => [r.paid_from_bank_account_id, r.paid_from_bank_account_name] as const)),
      predicate: (row, v) => row.paid_from_bank_account_id === v,
    },
    {
      key: 'payment_mode_id',
      label: 'Mode',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Modes',
      optionsFromRows: (rows) => dedupeTaxHeadOptions(rows.map((r) => [r.payment_mode_id, r.payment_mode_name] as const)),
      predicate: (row, v) => row.payment_mode_id === v,
    },
  ],
  // Mirrors api/v1/compliance.py's _REMITTANCE_COLUMNS one-for-one (including
  // Documents Covered, a joined "label (amount)" list per covered document —
  // same rendering the PDF/Excel export itself does), plus Is Reversal (not
  // in the export's own column set, but a real field on the row and useful
  // on screen to tell an original remittance apart from its own correction
  // at a glance).
  columns: [
    { key: 'remittance_number', header: 'Remittance #', type: 'code', cellClass: 'cell-strong' },
    { key: 'tax_head_name_snapshot', header: 'Tax Head' },
    { key: 'remitted_to_snapshot', header: 'Remitted To' },
    { key: 'period_label', header: 'Period' },
    { key: 'amount_remitted', header: 'Amount Remitted', type: 'money' },
    { key: 'paid_on', header: 'Paid On', type: 'date' },
    { key: 'paid_from_bank_account_name', header: 'Bank Account' },
    { key: 'payment_mode_name', header: 'Payment Mode' },
    { key: 'authority_reference', header: 'Authority Reference' },
    {
      key: 'documents_covered',
      header: 'Documents Covered',
      compute: (row) => (row.documents_covered.length ? row.documents_covered.map((d) => `${d.document_label} (${formatMoney(d.amount)})`).join('; ') : null),
    },
    { key: 'recorded_by_name', header: 'Recorded By' },
    { key: 'is_reversal', header: 'Is Reversal' },
  ],
  rowActions: [
    {
      label: 'Reverse',
      endpoint: (row) => `/compliance/remittances/${row.id}/reverse`,
      screenAction: 'reverse',
      // There's no way to perfectly hide an ALREADY-reversed row client-side
      // (the row itself doesn't carry that fact — only the reversal row
      // links back via reverses_remittance_id). Hidden only for a reversal
      // row itself (which can never itself be reversed); a double-click on
      // an already-reversed original surfaces the backend's real 409 through
      // ListScreenComponent's own error-banner path (runAction()) rather
      // than a client-side cross-row check.
      visible: (row) => !row.is_reversal,
      body: () => ({ reason: window.prompt('Reason for reversing this remittance (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No remittances recorded yet.',
};

export default config;
