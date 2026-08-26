import { FilterDef, FilterOption, ListScreenConfig } from '../../../shared/screens/screen.types';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import {
  AGEING_BUCKET_OPTIONS,
  BANK_ACCOUNT_REF,
  CUSTOMER_PICKER_REF,
  INVOICE_FY_REF,
  INVOICE_STATUS_OPTIONS,
  InvoiceRow,
  PAYMENT_MODE_REF,
  SERVICE_CATEGORY_REF,
  TAX_REF,
  USER_REF,
} from '../invoice.api';

// §2.2e Super Admin extras. No dedicated "distinct creators" endpoint, same
// technique customer.directory.config.ts's own createdByOptions/
// lastModifiedByOptions use.
function createdByOptions(rows: readonly InvoiceRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.created_by && !seen.has(row.created_by)) seen.set(row.created_by, { value: row.created_by, label: refData.label(USER_REF, row.created_by) });
  }
  return [...seen.values()];
}

function lastModifiedByOptions(rows: readonly InvoiceRow[], refData: RefDataService): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const row of rows) {
    if (row.updated_by && !seen.has(row.updated_by)) seen.set(row.updated_by, { value: row.updated_by, label: refData.label(USER_REF, row.updated_by) });
  }
  return [...seen.values()];
}

// §2.2 Invoice List — GET /invoices, exportable (list_export's own
// _LIST_COLUMNS in api/v1/invoices.py). customer_id/status/invoice_date
// range/overdue/ageing all real server-side query params (confirmed against
// list_invoices' own Query(...) signature) — every filter below carries
// transport: 'server' for exactly that reason, so the export's own
// "Filters:" header states something true (RBAC 14 §2.2f).
//
// Mirrors finance_engine.ageing_bucket() (Current / 1-30 / 31-60 / 61-90 /
// 90+ — the exact literals AGEING_BUCKET_OPTIONS/the Ageing filter already
// use). GET /invoices never serializes a per-row ageing bucket field
// (confirmed absent from schemas/finance.py's InvoiceOut — the backend only
// ever computes one to FILTER by, never to return), so the Ageing column
// below derives it client-side from two fields that ARE real and already on
// every row (due_date, status), using the identical hardcoded 30/60/90-day
// boundaries the backend itself hardcodes (finance_engine.py's own comment:
// a disclosed, not-yet-configurable constant on both sides). This states
// nothing the server doesn't already agree with — it only surfaces the same
// bucket the Ageing filter already assumes exists as its own visible column,
// matching the prototype's `age` column (data.js's own D.invoices rows).
function ageingBucket(row: InvoiceRow): string | null {
  // PEND_PAID (§6.2's second-approval gate) is settled in substance — the
  // balance is at zero, only Super Admin's confirmation is pending — so it
  // ages out the same way PAID does, matching list_invoices' own identical
  // server-side reasoning (api/v1/invoices.py).
  if (row.status === 'PAID' || row.status === 'PEND_PAID' || !row.due_date) return null;
  // Parsed from the y/m/d components directly (same regex cell-format.ts's
  // own formatDate() uses) rather than `new Date(row.due_date)` + setHours(0)
  // — an ISO date-only string parses as UTC midnight, and reducing THAT to
  // local midnight silently shifts the calendar day by one in any
  // negative-UTC-offset timezone. Building both dates straight from local
  // y/m/d components sidesteps the UTC round-trip entirely.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.due_date);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysOverdue = Math.round((today.getTime() - due.getTime()) / 86400000);
  if (daysOverdue <= 0) return 'Current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

// Exported so customer.invoices.list.config.ts's embedded tab can import
// this SAME array (minus customer_id) rather than hand-copy it — same
// "cannot drift apart" reasoning opportunity.pipeline.list.config.ts's own
// OPPORTUNITY_PIPELINE_FILTERS/project.directory.list.config.ts's own
// PROJECT_DIRECTORY_FILTERS already give; the embed's own comment claimed
// parity with this file that a hand-copy could no longer guarantee once
// this array grew past what it had (4 filters -> 13).
export const INVOICE_LIST_FILTERS: readonly FilterDef<InvoiceRow>[] = [
  {
    key: 'customer_id',
    label: 'Customer',
    kind: 'select',
    transport: 'server',
    optionsRef: CUSTOMER_PICKER_REF,
    allLabel: 'All Customers',
  },
  { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', options: INVOICE_STATUS_OPTIONS },
  // param:'invoice_date' -> auto-suffixed to invoice_date_from/invoice_date_to
  // by createListStore's own daterange handling, matching the real
  // list_invoices() query params exactly.
  { key: 'invoice_date', label: 'Invoice Date', kind: 'daterange', transport: 'server', param: 'invoice_date' },
  { key: 'overdue', label: 'Overdue', kind: 'tristate', transport: 'server' },
  { key: 'ageing', label: 'Ageing', kind: 'select', transport: 'server', options: AGEING_BUCKET_OPTIONS, allLabel: 'All Ageing' },
  // §2.2's own "Deferred" list, all reversed here — the doc's own reason
  // was never that these are schema-blocked: "the invoice record does
  // store Service Category, Tax head, and Created By... these are filter-
  // parameter additions, not schema work."
  { key: 'financial_year_id', label: 'Financial Year', kind: 'select', transport: 'server', allLabel: 'All Financial Years', optionsRef: INVOICE_FY_REF },
  { key: 'due_date', label: 'Due Date', kind: 'daterange', transport: 'server', param: 'due_date' },
  { key: 'grand_total', label: 'Grand Total', kind: 'numberrange', transport: 'server' },
  { key: 'balance_due', label: 'Outstanding Amount', kind: 'numberrange', transport: 'server', param: 'balance_due' },
  { key: 'service_category_id', label: 'Service Category', kind: 'select', transport: 'server', allLabel: 'All Categories', optionsRef: SERVICE_CATEGORY_REF },
  { key: 'tax_head_id', label: 'Tax Applied', kind: 'select', transport: 'server', allLabel: 'All Taxes', optionsRef: TAX_REF },
  { key: 'payment_mode_id', label: 'Payment Mode', kind: 'select', transport: 'server', allLabel: 'All Modes', optionsRef: PAYMENT_MODE_REF },
  { key: 'created_by', label: 'Created By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: createdByOptions },
  { key: 'last_modified_by', label: 'Last Modified By', kind: 'select', transport: 'server', allLabel: 'Anyone', superAdminOnly: true, optionsFromRows: lastModifiedByOptions },
];

const config: ListScreenConfig<InvoiceRow> = {
  shape: 'list',
  id: 'invoice.list',
  title: 'Invoices',
  specRef: '§2.2',
  description: 'Every invoice this role can see, live from the real backend.',
  endpoint: '/invoices',
  exportable: true,
  searchParam: 'search', // matches invoice_number / customer_name_snapshot / reference server-side
  searchFields: ['invoice_number', 'customer_name_snapshot', 'reference'],
  includeInactiveParam: false,
  recordNoun: 'invoice',
  rowId: (row) => row.id,
  rowRoute: (row) => ['/invoices', row.id],
  createRoute: ['/invoices', 'new'],
  createLabel: 'New Invoice',
  createScreenAction: 'edit',
  // §2.2's own column set, in the prototype's exact order (data.js: no, cust,
  // total, paid, wh, settled, bal, acc, status, due, age) — Invoice Date,
  // Subtotal and Tax are deliberately NOT list columns here (the prototype
  // never shows them on this screen; they stay on the New/Edit document
  // screen's own rec-head/totals instead, same place the prototype puts them).
  columns: [
    // Prototype: 'mono cell-accent' (data.js). type 'code' supplies the mono
    // half automatically (ListScreenComponent.cellClass); cellClass supplies
    // the accent half — see components.css's .cell-accent rule.
    { key: 'invoice_number', header: 'Invoice Number', type: 'code', cellClass: 'cell-accent' },
    { key: 'customer_name_snapshot', header: 'Customer', cellClass: 'cell-strong' }, // already denormalized onto the row — no ref lookup needed
    { key: 'grand_total', header: 'Total', type: 'money' },
    { key: 'amount_received', header: 'Paid', type: 'money' },
    { key: 'withheld_total', header: 'Withheld', type: 'money' },
    { key: 'settled_amount', header: 'Settled', type: 'money' },
    { key: 'balance_due', header: 'Balance', type: 'money' },
    { key: 'bank_account_id', header: 'Bank Account', ref: BANK_ACCOUNT_REF },
    { key: 'status', header: 'Status', type: 'status', staticOptions: INVOICE_STATUS_OPTIONS },
    { key: 'due_date', header: 'Due Date', type: 'date' },
    { key: 'ageing', header: 'Ageing', type: 'status', compute: ageingBucket, staticOptions: AGEING_BUCKET_OPTIONS },
  ],
  filters: INVOICE_LIST_FILTERS,
  defaultPageSize: 25,
  emptyText: 'No invoices yet.',
};

export default config;
