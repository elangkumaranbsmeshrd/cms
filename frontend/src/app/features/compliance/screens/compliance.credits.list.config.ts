import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { CREDIT_STATUS_OPTIONS, CreditRow } from '../compliance.api';

// §2.6 Credits — Withheld from Receipts. Derived live, never stored
// (credits_engine.build_credit_rows). No `tax_head_id` filter on this
// endpoint (list_credits' real query params are status/customer_id/
// payment_date_from/payment_date_to/search/format only).
//
// §2.6's own rowActions are 'Log Certificate' (-> tax.cert) and 'Mark
// Claimed' (-> tax.claim) — RowActionDef can't express either (it only
// fires a no-body POST/DELETE against an endpoint, never navigates), so
// this uses the single-target `rowRoute` every row already gets, branched
// on the row's own real state instead of two buttons:
//   - a certificate already exists and isn't fully claimed (certificate_id
//     set, status CERTIFIED_UNCLAIMED/VARIANCE) -> straight to Mark Claimed
//     for that exact certificate;
//   - no certificate yet but one is expected (status AWAITING_CERTIFICATE)
//     -> Log Certificate;
//   - CLAIMED (nothing left to do) and NOT_EXPECTED (no certificate concept
//     applies) get no click-through at all.
// credits_engine.py:93-112 confirms certificate_id is set on a CreditRow in
// exactly the CLAIMED/VARIANCE/CERTIFIED_UNCLAIMED branches and null
// everywhere else (including a VOIDED certificate's row, which reopens to
// AWAITING_CERTIFICATE with cert_id explicitly cleared) — this predicate
// mirrors that exactly, not a guess.
const config: ListScreenConfig<CreditRow> = {
  shape: 'list',
  id: 'compliance.credits',
  title: 'Credits — Withheld from Receipts',
  specRef: '§2.6',
  recordNoun: 'credit',
  description: "What customers held back, the certificates evidencing it, and whether the credit has been claimed.",
  endpoint: '/compliance/credits',
  exportable: true,
  rowId: (row) => row.invoice_payment_id,
  searchParam: 'search',
  searchFields: ['invoice_number', 'customer_name', 'certificate_reference'],
  includeInactiveParam: false,
  // §2.6 filter order: Customer, Status, Certificate Received, Credit
  // Claimed. Payment Date has no counterpart in the prototype's own filter
  // list at all — kept anyway (list_credits genuinely accepts payment_date_
  // from/to server-side, api/v1/compliance.py) and appended last rather than
  // dropped, since it's real backend-wired functionality, not an invented one.
  filters: [
    {
      key: 'customer_id',
      label: 'Customer',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Customers',
      // /customers 403s for Accountant (this screen's primary user);
      // /customers/picker is gated on invoice.list, which Accountant does
      // hold, and is the narrow {id, company_name, ...} lookup built for
      // exactly this kind of cross-module select.
      optionsRef: { endpoint: '/customers/picker', labelKey: 'company_name' },
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: CREDIT_STATUS_OPTIONS,
    },
    // §2.6's "Certificate Received — Any / Yes / No" and "Credit Claimed —
    // Any / Yes / No". No dedicated boolean query param on list_credits for
    // either — client-side over the row's own real certificate_id/
    // credit_claimed fields (both already fetched, neither fabricated).
    {
      key: 'certificate_received',
      label: 'Certificate Received',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Certificate — Any',
      predicate: (row, v) => (v === 'yes' ? row.certificate_id != null : v === 'no' ? row.certificate_id == null : true),
    },
    {
      key: 'credit_claimed',
      label: 'Credit Claimed',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Claimed — Any',
      predicate: (row, v) => (v === 'yes' ? row.credit_claimed === true : v === 'no' ? row.credit_claimed === false : true),
    },
    {
      key: 'payment_date',
      label: 'Payment Date',
      kind: 'daterange',
      transport: 'server',
      param: 'payment_date',
    },
  ],
  // Mirrors api/v1/compliance.py's _CREDITS_COLUMNS one-for-one, including
  // "Certificate" — a separate Yes/No column (whether ANY certificate has
  // ever been logged against this receipt at all, certificate_id != null) —
  // distinct from "Certificate Ref" (the reference text itself). Easy to
  // miss since the spec prose names them together, but the backend's own
  // export column list carries both as independent columns.
  columns: [
    { key: 'invoice_number', header: 'Invoice Number', type: 'code', cellClass: 'cell-strong' },
    { key: 'customer_name', header: 'Customer' },
    { key: 'payment_date', header: 'Payment Date', type: 'date' },
    { key: 'invoice_total', header: 'Invoice Total', type: 'money' },
    { key: 'amount_received', header: 'Amount Received', type: 'money' },
    { key: 'withheld', header: 'Withheld', type: 'money' },
    { key: 'certificate', header: 'Certificate', compute: (row) => !!row.certificate_id },
    { key: 'certificate_reference', header: 'Certificate Ref' },
    // credit_claimed is a plain boolean on CreditRowOut (NOT a money figure —
    // confirmed against schemas/compliance.py) — the `typeof raw === 'boolean'`
    // branch in ListScreenComponent.display() renders it Yes/No automatically.
    { key: 'credit_claimed', header: 'Credit Claimed' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: CREDIT_STATUS_OPTIONS },
  ],
  rowRoute: (row) => {
    if (row.certificate_id && row.status !== 'CLAIMED') return ['/compliance/certificates', row.certificate_id, 'claim'];
    if (row.status === 'AWAITING_CERTIFICATE') return ['/compliance/certificates', 'new'];
    return null;
  },
  defaultPageSize: 25,
  emptyText: 'No customer withholding recorded yet.',
};

export default config;
