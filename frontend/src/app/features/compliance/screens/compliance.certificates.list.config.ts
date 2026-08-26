import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { formatMoney } from '../../../shared/screens/cell-format';
import { CERTIFICATE_STATUS_OPTIONS, CertificateRow } from '../compliance.api';

// §2.7 Certificates. No `tax_head_id` filter (list_certificates' real query
// params are customer_id/status/certificate_date_from/certificate_date_to/
// search/format only). No `customer_name` on this row (unlike Credits, which
// already denormalizes it) — a real ref lookup against /customers/picker.
//
// Row click (`rowRoute`) goes to Mark Credit Claimed (§2.9): CertificateOut
// carries no per-row "already claimed" boolean at all (a claim is a
// separate credit_claims row with no reverse pointer on the certificate),
// so there is no way to conditionally hide/show a claim link per row.
// Every row routes there; the claim screen itself shows a VOIDED certificate
// as blocked outright, and surfaces the backend's real 409 ("already
// claimed") through its own save-error banner if that turns out to be the
// case — same "let the real error surface" reasoning as Reverse/Void below.
const config: ListScreenConfig<CertificateRow> = {
  shape: 'list',
  id: 'compliance.certificates',
  title: 'Certificates',
  specRef: '§2.7',
  recordNoun: 'certificate',
  description: 'One row per withholding certificate logged. Click a row to record its claim once the credit has been taken. The certified amount governs a claim, never the company’s own recorded figure.',
  endpoint: '/compliance/certificates',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  searchFields: ['certificate_reference', 'customer_id'],
  includeInactiveParam: false,
  filters: [
    {
      key: 'customer_id',
      label: 'Customer',
      kind: 'select',
      transport: 'server',
      allLabel: 'All Customers',
      optionsRef: { endpoint: '/customers/picker', labelKey: 'company_name' },
    },
    {
      key: 'status',
      label: 'Status',
      kind: 'multiselect',
      transport: 'server',
      allLabel: 'All Statuses',
      options: CERTIFICATE_STATUS_OPTIONS,
    },
    {
      key: 'certificate_date',
      label: 'Certificate Date',
      kind: 'daterange',
      transport: 'server',
      param: 'certificate_date',
    },
    // §2.7's "Has Variance — Any / Yes / No". No dedicated query param on
    // list_certificates — client-side over the row's own real `variance`
    // Decimal (already fetched, non-zero test), not a fabricated flag.
    {
      key: 'has_variance',
      label: 'Has Variance',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Variance — Any',
      predicate: (row, v) => (v === 'yes' ? Number(row.variance) !== 0 : v === 'no' ? Number(row.variance) === 0 : true),
    },
  ],
  // Mirrors api/v1/compliance.py's _CERTIFICATE_COLUMNS one-for-one (11
  // cols), including Receipts Covered — a joined "invoice (amount)" list per
  // certified receipt, same rendering the PDF/Excel export itself does.
  columns: [
    { key: 'certificate_reference', header: 'Certificate Reference', type: 'code', cellClass: 'cell-strong' },
    { key: 'customer_id', header: 'Customer', ref: { endpoint: '/customers/picker', labelKey: 'company_name' } },
    { key: 'certificate_date', header: 'Certificate Date', type: 'date' },
    { key: 'covered_from', header: 'Covered From', type: 'date' },
    { key: 'covered_to', header: 'Covered To', type: 'date' },
    { key: 'tax_head_name_snapshot', header: 'Tax Head' },
    { key: 'amount_on_certificate', header: 'Amount on Certificate', type: 'money' },
    { key: 'amount_matched', header: 'Amount Matched', type: 'money' },
    { key: 'variance', header: 'Variance', type: 'money' },
    {
      key: 'receipts_covered',
      header: 'Receipts Covered',
      compute: (row) => (row.receipts_covered.length ? row.receipts_covered.map((r) => `${r.invoice_number} (${formatMoney(r.amount)})`).join('; ') : null),
    },
    { key: 'status', header: 'Status', type: 'status', staticOptions: CERTIFICATE_STATUS_OPTIONS },
  ],
  createRoute: ['/compliance/certificates', 'new'],
  createLabel: 'Log Certificate',
  createScreenAction: 'log',
  rowRoute: (row) => ['/compliance/certificates', row.id, 'claim'],
  rowActions: [
    {
      label: 'Void',
      endpoint: (row) => `/compliance/certificates/${row.id}/void`,
      screenAction: 'void',
      visible: (row) => row.status === 'ACTIVE',
      // Same "can't perfectly hide, let the real 409 surface" reasoning as
      // Remittances' own Reverse action — a certificate whose credit has
      // already been claimed also can't be voided (backend-enforced), and
      // there's no client-visible signal for that either.
      body: () => ({ reason: window.prompt('Reason for voiding this certificate (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No certificates logged yet.',
};

export default config;
