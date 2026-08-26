import { formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { DocumentScreenConfig, DocumentTotalRow } from '../../../shared/screens/screen.types';
import {
  BANK_ACCOUNT_REF,
  CUSTOMER_PICKER_REF,
  HSN_REF,
  INVOICE_FY_REF,
  INVOICE_STATUS_OPTIONS,
  InvoiceRow,
  SERVICE_CATEGORY_REF,
  TAX_REF,
} from '../invoice.api';

// Decimal-backed fields arrive as JSON strings from Pydantic (same reason
// cell-format.ts's own formatMoney() does this) — every arithmetic read
// below goes through this instead of trusting the raw type.
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(value: unknown): string {
  const raw = String(value ?? '');
  return INVOICE_STATUS_OPTIONS.find((o) => o.value === raw)?.label ?? humanizeEnum(raw);
}

// §2.3 New / Edit Invoice — one screen, one route pair (invoices/new +
// invoices/:id), both registered under invoice.list (there is no separate
// invoice.detail screen key — app/rbac/registry/screens.py has exactly three
// keys for this whole module: invoice.dashboard/invoice.list/credit_note.list).
//
// §2.3's Fields Table: "Financial Year | Read-only, auto-set | Built — the
// current open Financial Year at creation, which also drives the Invoice
// Number series." Was undisplayable — InvoiceOut never serialized
// financial_year_id despite the column existing (0014_invoice_gaps.py's own
// production-readiness pass added it) — now a real read-only field below.
const config: DocumentScreenConfig<InvoiceRow> = {
  shape: 'document',
  id: 'invoice.list',
  title: 'Invoice',
  specRef: '§2.3',
  loadEndpoint: (id) => `/invoices/${id}`,
  saveEndpoint: (id) => `/invoices/${id}`,
  createEndpoint: '/invoices',
  recordRoute: (row) => ['/invoices', row.id],
  // customer_id/reference/project_id: optionally handed off via the create
  // route's own query string — Opportunity Record's "Create Invoice" action
  // links here as /invoices/new?customer_id=X&reference=Y, and Project
  // Record's own equivalent additionally passes project_id=Z, so the user
  // doesn't have to re-pick the customer or re-type which deal/project this
  // invoice is for. project_id has no `fields` entry (never a visible form
  // control — §2.3's own words, "the Reference field covers free-text
  // linkage for now") but still round-trips into the create POST body:
  // document-screen.component.ts's save() serialises every formModel key,
  // not just declared fields. Absent for the ordinary "+ New Invoice" entry
  // point, where all three fall back to their original blank defaults.
  emptyRow: (queryParams) => ({
    invoice_number: '',
    financial_year_id: '',
    customer_id: (queryParams['customer_id'] || null) as unknown as string,
    project_id: queryParams['project_id'] || null,
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    reference: queryParams['reference'] || null,
    notes: null,
    customer_name_snapshot: '',
    customer_address_snapshot: null,
    customer_gstin_snapshot: null,
    service_category_id: null,
    bank_account_id: null,
    subtotal: 0,
    tax_head_id: null,
    tax_amount_override: null,
    tax_amount: 0,
    grand_total: 0,
    amount_received: 0,
    credit_note_total: 0,
    claim_amount: 0,
    withheld_total: 0,
    settled_amount: 0,
    balance_due: 0,
    // Seeded so the badge/locked()/note()/Send-visibility all read exactly
    // like a freshly-created row already would, rather than an empty string
    // none of those checks recognise.
    status: 'DRAFT',
    sent_at: null,
    sent_by: null,
    paid_at: null,
    is_locked: false,
    created_by: null,
    updated_by: null,
    line_items: [],
    tax_lines: [],
  }),
  header: {
    icon: 'invoice',
    recId: (row) => row.invoice_number || 'New Invoice',
    name: (row) => row.customer_name_snapshot || '—',
    meta: (row) => [row.due_date ? `Due ${row.due_date}` : '', row.reference ? `Ref ${row.reference}` : ''],
    badge: (row) => statusLabel(row.status),
    summary: (row) => [
      { label: 'Grand Total', value: formatMoney(row.grand_total) },
      { label: 'Paid', value: formatMoney(row.amount_received) },
      { label: 'Balance', value: formatMoney(row.balance_due) },
    ],
  },
  // PEND_PAID (§6.2 "Require Second Approval Before an Invoice Locks as
  // Paid") is deliberately NOT locked — is_locked stays `status = 'PAID'`
  // only (models/finance.py), matching the toggle's own words ("Super Admin
  // must confirm first," not "freeze everything until confirmed"). A
  // Save while pending re-runs the exact same status resolution and can
  // legitimately move it back to Part-Paid, same as any other edit.
  note: (row) =>
    row.status === 'PAID'
      ? 'Locked. A Paid invoice cannot be edited directly — corrections go through a Credit Note.'
      : row.status === 'PEND_PAID'
        ? 'Settled — awaiting Super Admin confirmation before this invoice locks as Paid.'
        : null,
  locked: (row) => row.status === 'PAID',
  fields: [
    {
      key: 'customer_id',
      label: 'Customer',
      type: 'select',
      required: true,
      createOnly: true, // immutable after creation — server 422s a changed customer_id on PUT
      ref: CUSTOMER_PICKER_REF,
      hint: 'Cannot be changed once the invoice is created.',
    },
    {
      key: 'invoice_date',
      label: 'Invoice Date',
      type: 'date',
      required: true,
      hint: 'Cannot be in the future (enforced server-side on create).',
    },
    { key: 'due_date', label: 'Due Date', type: 'date' },
    { key: 'reference', label: 'Reference', type: 'text' },
    { key: 'service_category_id', label: 'Service Category', type: 'select', ref: SERVICE_CATEGORY_REF },
    // §2.3: "the current open Financial Year at creation, which also drives
    // the Invoice Number series." Blank on a not-yet-saved Create — the real
    // FY isn't assigned until the server allocates one on save, same as
    // Invoice Number itself.
    { key: 'financial_year_id', label: 'Financial Year', editable: false, ref: INVOICE_FY_REF },
    { key: 'bank_account_id', label: 'Bank Account', type: 'select', ref: BANK_ACCOUNT_REF },
    {
      key: 'tax_head_id',
      label: 'Tax Head',
      type: 'select',
      ref: TAX_REF,
      hint: 'Leave blank if no billing tax applies — Grand Total will equal Subtotal.',
    },
    {
      key: 'tax_amount_override',
      label: 'Tax Amount Override',
      type: 'number',
      // Only meaningful once a Tax Head is chosen — the server 422s an
      // override with no head (_compute_tax, api/v1/invoices.py), so this
      // hides (and, per visibleWhen's own contract, does not submit) the
      // field otherwise rather than letting the user hit that 422.
      visibleWhen: (m) => !!m['tax_head_id'],
      hint: "Optional — overrides the Tax Head's own computed amount.",
    },
    { key: 'customer_address_snapshot', label: 'Customer Address', editable: false },
    { key: 'customer_gstin_snapshot', label: 'Customer GSTIN', editable: false },
    { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ],
  lineItems: {
    key: 'line_items',
    columns: [
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'hsn_code_id', label: 'HSN/SAC', type: 'select', ref: HSN_REF },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
    ],
    emptyItem: () => ({ description: '', hsn_code_id: null, quantity: 1, rate: 0 }),
    lineTotal: (item) => num(item['quantity']) * num(item['rate']),
  },
  // Subtotal is LIVE — recomputed from the current (possibly just-edited)
  // line items on every render, per DocumentTotalRow's own contract. Tax is
  // NOT live in the same sense: `row` is the last-loaded/last-saved
  // snapshot, not the live formModel (document-screen.component.ts only
  // threads line items through live — see its own comment on why), so the
  // Tax figure (and the split-by-component breakdown, once tax_lines has
  // more than one row) only updates once Save has actually round-tripped —
  // exactly the "one combined Tax row, exact split happens server-side"
  // allowance this screen was built against. A brand-new, not-yet-saved
  // invoice therefore shows no Tax row at all until the first Save, even if
  // a Tax Head is already picked — a disclosed limitation of the shape, not
  // something this config works around.
  totals: (row, items) => {
    const subtotal = items.reduce((sum, item) => sum + num(item['quantity']) * num(item['rate']), 0);
    const rows: DocumentTotalRow[] = [{ label: 'Subtotal', value: formatMoney(subtotal) }];
    if (row.tax_head_id) {
      const taxLines = row.tax_lines ?? [];
      if (taxLines.length > 1) {
        for (const tl of taxLines) {
          const base = tl.print_label_snapshot ?? tl.head_name_snapshot ?? 'Tax';
          rows.push({ label: tl.component_name_snapshot ? `${base} (${tl.component_name_snapshot})` : base, value: formatMoney(tl.computed_amount) });
        }
      } else {
        rows.push({ label: 'Tax', value: formatMoney(row.tax_amount ?? 0) });
      }
    }
    const grandTotal = subtotal + num(row.tax_amount);
    rows.push({ label: 'Grand Total', value: formatMoney(grandTotal), emphasize: true });
    return rows;
  },
  actions: [
    { label: 'Save', kind: 'save', cls: 'primary', screenAction: 'edit' },
    {
      label: 'Send',
      icon: 'send',
      kind: 'endpoint',
      endpoint: (row) => `/invoices/${row.id}/send`,
      screenAction: 'send',
      visible: (row) => row.status === 'DRAFT',
    },
    {
      // No real action gate on the backend GET (require_screen with no
      // action= at all) — 'view' is visibility-only, matching ALWAYS_ALLOWED.
      label: 'Download PDF',
      icon: 'download',
      kind: 'download',
      endpoint: (row) => `/invoices/${row.id}/pdf`,
      screenAction: 'view',
    },
    {
      label: 'Record Payment',
      icon: 'rupee',
      kind: 'route',
      route: (row) => ['/invoices', row.id, 'record-payment'],
      screenAction: 'record_payment',
      visible: (row) => ['SENT', 'PART_PAID'].includes(row.status),
    },
    {
      // §6.2 "Require Second Approval Before an Invoice Locks as Paid" —
      // the confirmation step. 'confirm_paid' is Super Admin only
      // (seed.py) — an Accountant never sees this button at all, matching
      // "Super Admin must confirm first."
      label: 'Confirm Paid',
      icon: 'check',
      kind: 'endpoint',
      endpoint: (row) => `/invoices/${row.id}/confirm-paid`,
      screenAction: 'confirm_paid',
      visible: (row) => row.status === 'PEND_PAID',
      confirm: 'Confirm this invoice as Paid? It will lock immediately — corrections after this go through a Credit Note.',
    },
    {
      label: 'Raise Credit Note',
      icon: 'doc',
      kind: 'route',
      route: (row) => ['/invoices', row.id, 'credit-note'],
      // credit_note.list's own 'raise' action, NOT invoice.list's — this
      // document's own id is invoice.list, which has no 'raise' action
      // registered at all, so this MUST override screenId or the button
      // would never resolve visible for any role.
      screenId: 'credit_note.list',
      screenAction: 'raise',
      visible: (row) => ['PAID', 'PART_PAID'].includes(row.status),
    },
  ],
};

export default config;
