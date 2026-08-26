import { formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { DocumentScreenConfig, DocumentTotalRow } from '../../../shared/screens/screen.types';
import {
  BANK_ACCOUNT_REF,
  EXPENSE_CLAIM_REF,
  HSN_REF,
  PURCHASE_BILL_STATUS_OPTIONS,
  PurchaseBillRow,
  TAX_REF,
  VENDOR_ACTIVE_REF,
  WITHHOLDING_CALCULATED_ON_OPTIONS,
} from '../purchase-bill.api';

// Decimal-backed fields arrive as JSON strings from Pydantic (same reason
// cell-format.ts's own formatMoney() does this) — every arithmetic read
// below goes through this instead of trusting the raw type.
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(value: unknown): string {
  const raw = String(value ?? '');
  return PURCHASE_BILL_STATUS_OPTIONS.find((o) => o.value === raw)?.label ?? humanizeEnum(raw);
}

// §2.2 Add/Edit Purchase Bill — one screen, one route pair (purchase-bills/new
// + purchase-bills/:id), both registered under purchase_bill.list — there is
// no separate purchase_bill.detail screen key at all (app/rbac/registry/
// screens.py has exactly ONE key for this whole module, unlike Invoice's
// three), so every action below gates on it too.
//
// FIXED 2026-08-11 (RBAC audit): Bank Account / HSN Code fields below now
// resolve through BANK_ACCOUNT_REF/HSN_REF's `/options` endpoints
// (purchase-bill.api.ts), not the gated Masters screens — see that file's
// own comment. Accountant no longer 404s on either.
//
// No `locked` here at all — confirmed no lock-on-Paid check exists for this
// module (unlike Invoice's own "Status = Paid" lock): §6.1's "Lock Purchase
// Bill Once Fully Paid" is a FeatureToggle OFF by default (update_purchase_bill's
// own docstring, api/v1/purchase_bills.py), so the record stays editable
// after reaching Paid and this config must not fabricate a lock the backend
// doesn't enforce.
const config: DocumentScreenConfig<PurchaseBillRow> = {
  shape: 'document',
  id: 'purchase_bill.list',
  title: 'Purchase Bill',
  specRef: '§2.2',
  loadEndpoint: (id) => `/purchase-bills/${id}`,
  saveEndpoint: (id) => `/purchase-bills/${id}`,
  createEndpoint: '/purchase-bills',
  recordRoute: (row) => ['/purchase-bills', row.id],
  emptyRow: () => ({
    purchase_bill_code: '',
    vendor_id: null as unknown as string,
    vendor_bill_number: '',
    vendor_name_snapshot: '',
    vendor_gstin_snapshot: null,
    bill_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    payment_terms_days_snapshot: null,
    attachment_stored_file_id: null,
    has_attachment: false,
    bank_account_id: null,
    effective_bank_account_id: null,
    linked_expense_claim_id: null,
    subtotal: 0,
    tax_head_id: null,
    tax_amount_override: null,
    tax_amount: 0,
    total_amount: 0,
    withholding_tax_head_id: null,
    withholding_calculated_on: null,
    withholding_amount_override: null,
    withholding_amount: 0,
    withholding_head_name_snapshot: null,
    amount_payable_to_vendor: 0,
    amount_paid: 0,
    balance_due: 0,
    // Seeded so the badge/note()/Record-Payment-visibility all read exactly
    // like a freshly-created row already would, rather than an empty string
    // none of those checks recognise — resolve_purchase_bill_status() itself
    // never returns anything but UNPAID for a bill with zero settled amount.
    status: 'UNPAID',
    paid_at: null,
    notes: null,
    line_items: [],
    tax_lines: [],
  }),
  header: {
    icon: 'purchase',
    recId: (row) => row.purchase_bill_code || 'New Purchase Bill',
    name: (row) => row.vendor_name_snapshot || '—',
    meta: (row) => [row.vendor_bill_number ? `Vendor Bill #${row.vendor_bill_number}` : '', row.due_date ? `Due ${formatDate(row.due_date)}` : ''],
    badge: (row) => statusLabel(row.status),
    summary: (row) => {
      const tiles: { label: string; value: string }[] = [{ label: 'Total', value: formatMoney(row.total_amount) }];
      if (num(row.withholding_amount) > 0) tiles.push({ label: 'Withholding', value: formatMoney(row.withholding_amount) });
      tiles.push(
        { label: 'Payable', value: formatMoney(row.amount_payable_to_vendor) },
        { label: 'Paid', value: formatMoney(row.amount_paid) },
        { label: 'Balance Due', value: formatMoney(row.balance_due) },
      );
      return tiles;
    },
  },
  // §2.2 / Appendix A265, near-verbatim: no PDF is ever generated for a
  // Purchase Bill (confirmed — no /purchase-bills/{id}/pdf endpoint exists
  // at all, unlike Invoice). Placed as the document's own top note rather
  // than a field hint since it explains a whole missing ACTION (there is no
  // Download button on this screen at all), not one field's behaviour.
  note: () =>
    "No PDF is generated for a Purchase Bill — it's an internal record of something already received, not a document sent to anyone. Open the Attachment field below to view the vendor's own original bill.",
  fields: [
    {
      key: 'vendor_id',
      label: 'Vendor',
      type: 'select',
      required: true,
      createOnly: true, // immutable after creation — server 422s a changed vendor_id on PUT
      ref: VENDOR_ACTIVE_REF,
      hint: 'Cannot be changed once the bill is created.',
    },
    { key: 'vendor_bill_number', label: "Vendor's Bill Number", type: 'text', required: true },
    {
      key: 'bill_date',
      label: 'Bill Date',
      type: 'date',
      required: true,
      hint: 'Cannot be in the future (enforced server-side).',
    },
    {
      key: 'due_date',
      label: 'Due Date',
      type: 'date',
      hint: 'Defaults to Bill Date plus the vendor\'s own Payment Terms when left blank. Should fall on or after Bill Date — not enforced by the server (no such check exists here, unlike some other date pairs in this app).',
    },
    {
      key: 'bank_account_id',
      label: 'Bank Account',
      type: 'select',
      ref: BANK_ACCOUNT_REF,
      hint: 'The account this bill is expected to be paid from. No active-only filter exists server-side — an inactive account may still appear here.',
    },
    {
      key: 'linked_expense_claim_id',
      label: 'Linked Expense Claim',
      type: 'select',
      createOnly: true, // immutable here — server 422s a changed linked_expense_claim_id on PUT; unlink from the claim itself instead
      ref: EXPENSE_CLAIM_REF,
      hint: 'Cannot be changed once the bill is created — remove the link on the Expense Claim itself instead.',
    },
    // §2.2's own field order (prototype/data.js, R.document's bill fields):
    // Withholding block BEFORE the Tax block — kept in that order here too,
    // rather than the more usual "tax first" instinct.
    {
      key: 'withholding_tax_head_id',
      label: 'Withholding Tax',
      type: 'select',
      ref: TAX_REF,
      hint: 'Tax withheld at source before paying the vendor, if any.',
    },
    {
      key: 'withholding_calculated_on',
      label: 'Withholding Calculated On',
      type: 'select',
      staticOptions: WITHHOLDING_CALCULATED_ON_OPTIONS,
      visibleWhen: (m) => !!m['withholding_tax_head_id'],
      hint: 'Defaults to Subtotal when left blank.',
    },
    {
      key: 'withholding_amount_override',
      label: 'Withholding Amount Override',
      type: 'number',
      visibleWhen: (m) => !!m['withholding_tax_head_id'],
      hint: "Optional — overrides the Withholding Tax head's own computed amount. Cannot exceed the bill Total.",
    },
    {
      key: 'tax_head_id',
      label: 'Tax Head',
      type: 'select',
      ref: TAX_REF,
      hint: 'Leave blank if no purchase tax applies.',
    },
    {
      key: 'tax_amount_override',
      label: 'Tax Amount Override',
      type: 'number',
      // Unlike Invoice's equivalent field, direct entry is always allowed
      // here even with no Tax Head chosen at all — §2.2's own "a bill can be
      // recorded correctly before any tax head has been configured"
      // (update_purchase_bill's own comment, api/v1/purchase_bills.py) — so
      // this deliberately carries no visibleWhen gate.
      hint: "Optional — overrides the Tax Head's own computed amount. Can also be entered directly with no Tax Head chosen.",
    },
    {
      key: 'attachment_stored_file_id',
      label: 'Attachment',
      type: 'file',
      span: 2, // matches prototype's own span:2 on this field
      uploadPurpose: 'purchase_bill_attachment',
      fileAccept: 'application/pdf,image/jpeg,image/png',
      hint: "The vendor's own original bill — PDF, JPEG, or PNG, up to 10MB.",
    },
    { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ],
  lineItems: {
    key: 'line_items',
    columns: [
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'hsn_code_id', label: 'HSN Code', type: 'select', ref: HSN_REF },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
    ],
    emptyItem: () => ({ description: '', hsn_code_id: null, quantity: 1, rate: 0 }),
    lineTotal: (item) => num(item['quantity']) * num(item['rate']),
  },
  // Subtotal is LIVE — recomputed from the current (possibly just-edited)
  // line items on every render, per DocumentTotalRow's own contract. Tax/
  // Withholding/Total are NOT live in the same sense: `row` is the
  // last-loaded/last-saved snapshot, not the live formModel
  // (document-screen.component.ts only threads line items through live —
  // see its own comment on why), so those figures only update once Save has
  // actually round-tripped — the same "one combined Tax row, exact split
  // happens server-side" allowance invoice.document.config.ts documents for
  // its own totals block. A brand-new, not-yet-saved bill therefore shows no
  // Tax row at all until the first Save, even if a Tax Head is already
  // picked — a disclosed limitation of the shape, not something this config
  // works around.
  //
  // The Tax row shows whenever a Tax Head is set OR a non-zero tax amount is
  // already on the loaded row (covers a manual override entered with no
  // head at all, per this module's own permissive tax_amount_override rule
  // above) — unlike Invoice, where the row is gated on tax_head_id alone,
  // since Invoice has no equivalent no-head override path.
  totals: (row, items) => {
    const subtotal = items.reduce((sum, item) => sum + num(item['quantity']) * num(item['rate']), 0);
    const rows: DocumentTotalRow[] = [{ label: 'Subtotal', value: formatMoney(subtotal) }];
    if (row.tax_head_id || num(row.tax_amount) > 0) {
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
    const total = subtotal + num(row.tax_amount);
    rows.push({ label: 'Total', value: formatMoney(total), emphasize: true });
    if (num(row.withholding_amount) > 0) {
      rows.push({ label: 'Withholding', value: formatMoney(row.withholding_amount) });
      rows.push({ label: 'Amount Payable to Vendor', value: formatMoney(row.amount_payable_to_vendor) });
    }
    return rows;
  },
  actions: [
    { label: 'Save', kind: 'save', cls: 'primary', screenAction: 'edit' },
    // 'cancel' resolves via PolicyStore's own ALWAYS_ALLOWED list (any role
    // that can open this screen at all can always back out of it) — not a
    // real RBAC action name on purchase_bill.list's own actions=("edit",
    // "record_payment") tuple, same mechanism Download PDF's 'view' relies
    // on in invoice.document.config.ts.
    { label: 'Cancel', kind: 'route', route: () => ['/purchase-bills'], screenAction: 'cancel' },
    {
      label: 'Record Payment',
      icon: 'rupee',
      kind: 'route',
      route: (row) => ['/purchase-bills', row.id, 'record-payment'],
      screenAction: 'record_payment',
      visible: (row) => row.status !== 'PAID',
    },
    // No Download/PDF action — confirmed no such endpoint exists for this
    // module at all (see this config's own top note).
  ],
};

export default config;
