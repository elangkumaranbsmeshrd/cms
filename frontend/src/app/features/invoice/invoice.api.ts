// Mirrors backend/app/schemas/finance.py's InvoiceOut/InvoiceLineItemOut/
// InvoiceTaxLineOut/InvoicePaymentOut and CreditNoteOut/CreditNoteLineItemOut
// — shared across every Invoice/Credit Note screen so the row shapes and the
// fixed option lists are declared exactly once (same convention as
// ticket.api.ts).

export interface InvoiceLineItemRow {
  readonly id: string;
  readonly sequence: number;
  readonly description: string;
  readonly hsn_code_id: string | null;
  readonly quantity: number;
  readonly rate: number;
  readonly line_total: number;
  readonly credited_amount: number;
}

export interface InvoiceTaxLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly tax_head_id: string | null;
  readonly head_name_snapshot: string | null;
  readonly print_label_snapshot: string | null;
  readonly computed_base: number;
  readonly computed_amount: number;
  readonly component_name_snapshot: string | null;
}

// InvoiceOut, plus tax_amount_override — a field that exists on InvoiceCreate
// (the POST/PUT body) but is NEVER returned by GET /invoices/{id}: InvoiceOut
// has no such column at all (confirmed against schemas/finance.py). It is
// declared here anyway, optional, purely so FieldConfig<InvoiceRow>'s
// `key: keyof InvoiceRow` accepts it for the New/Edit form's own input —
// editing an existing invoice's override therefore always starts blank (the
// API gives no way to know whether a prior save used one, or what it was);
// leaving it blank on Save recomputes tax from the head's own rate, same as
// Create's own default path. A confirmed, disclosed backend asymmetry, not a
// frontend bug — see invoice.document.config.ts's own note on this field.
export interface InvoiceRow {
  readonly id: string;
  readonly invoice_number: string;
  readonly financial_year_id: string;
  readonly customer_id: string;
  // Silently set only by the "Create from Project" prefill path — no
  // Opportunity/Project dropdown exists on this form (§2.3's own words:
  // "the Reference field covers free-text linkage for now"). Exists on
  // this row only so §6.2's Manager-invoices toggle has something real to
  // scope by; never rendered as an editable field.
  readonly project_id: string | null;
  readonly invoice_date: string;
  readonly due_date: string | null;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly customer_name_snapshot: string;
  readonly customer_address_snapshot: string | null;
  readonly customer_gstin_snapshot: string | null;
  readonly service_category_id: string | null;
  readonly bank_account_id: string | null;
  readonly subtotal: number;
  readonly tax_head_id: string | null;
  readonly tax_amount_override?: number | null;
  readonly tax_amount: number;
  readonly grand_total: number;
  readonly amount_received: number;
  readonly credit_note_total: number;
  readonly claim_amount: number;
  readonly withheld_total: number;
  readonly settled_amount: number;
  readonly balance_due: number;
  readonly status: string;
  readonly sent_at: string | null;
  readonly sent_by: string | null;
  readonly paid_at: string | null;
  readonly is_locked: boolean;
  readonly created_by: string | null;
  readonly updated_by: string | null;
  readonly line_items: readonly InvoiceLineItemRow[];
  readonly tax_lines: readonly InvoiceTaxLineRow[];
}

export interface InvoicePaymentRow {
  readonly id: string;
  readonly invoice_id: string;
  readonly amount_received: number;
  readonly balance_due_at_entry: number;
  readonly customer_withheld_tax_head_id: string | null;
  readonly withholding_calculated_on: string | null;
  readonly withheld_amount: number;
  readonly amount_settled: number;
  readonly payment_mode_id: string;
  readonly received_into_bank_account_id: string | null;
  readonly payment_date: string;
  readonly reference: string | null;
  readonly status: string;
  readonly reversed_at: string | null;
  readonly reversed_by: string | null;
  readonly reversal_reason: string | null;
  readonly recorded_by: string;
  readonly recorded_at: string;
}

// The exact body POST /invoices/{id}/payments accepts (InvoicePaymentCreate).
export interface InvoicePaymentCreateBody {
  readonly amount_received: number;
  readonly customer_withheld_tax_head_id: string | null;
  readonly withholding_calculated_on: string | null; // SUBTOTAL | GRAND_TOTAL — NOT 'TOTAL' (that literal is Purchase Bill's, a different module)
  readonly withheld_amount: number | null;
  readonly payment_mode_id: string;
  readonly received_into_bank_account_id: string | null;
  readonly payment_date: string;
  readonly reference: string | null;
}

export interface CreditNoteLineItemRow {
  readonly id: string;
  readonly invoice_line_item_id: string;
  readonly sequence: number;
  readonly description_snapshot: string;
  readonly quantity_snapshot: number;
  readonly rate_snapshot: number;
  readonly line_total_snapshot: number;
  readonly credited_amount: number;
}

export interface CreditNoteRow {
  readonly id: string;
  readonly credit_note_number: string;
  readonly invoice_id: string;
  readonly customer_id: string;
  readonly invoice_number_snapshot: string;
  readonly customer_name_snapshot: string;
  readonly credit_note_date: string;
  readonly reason: string;
  readonly reason_detail: string;
  readonly credit_amount: number;
  readonly status: string;
  readonly raised_by: string;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly line_items: readonly CreditNoteLineItemRow[];
}

// The exact body POST /credit-notes and PUT /credit-notes/{id} both accept
// (CreditNoteCreate).
export interface CreditNoteWriteBody {
  readonly invoice_id: string;
  readonly reason: string;
  readonly reason_detail: string;
  readonly credit_amount: number;
  readonly line_items_affected: readonly string[];
}

// ---------------------------------------------------------------------------
// Static option lists — real backend CHECK-constraint/enum values (verified
// against app/api/v1/invoices.py, credit_notes.py, and the CreditNote status
// literals used throughout credit_notes.py's own status transitions).
// ---------------------------------------------------------------------------

// Invoice.status. Reuses the exact 4-value set already defined in
// frontend/src/app/features/customer/screens/customer.invoices.list.config.ts
// — same badge/label pair everywhere this status is shown.
export const INVOICE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PART_PAID', label: 'Part-Paid' },
  // §6.2 "Require Second Approval Before an Invoice Locks as Paid" — OFF by
  // default, but the value exists on the wire regardless of the toggle
  // (0014_invoice_gaps.py widened the status CHECK), so it's listed
  // unconditionally here too, same as every other status.
  { value: 'PEND_PAID', label: 'Pending Confirmation' },
  { value: 'PAID', label: 'Paid' },
];

// CreditNote.status — Draft -> Pending Approval -> Approved (credit_notes.py's
// own submit_credit_note/approve_credit_note transitions).
export const CREDIT_NOTE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'APPROVED', label: 'Approved' },
];

// CreditNoteCreate.reason (schemas/finance.py's own inline comment).
export const CREDIT_NOTE_REASON_OPTIONS = [
  { value: 'BILLING_ERROR', label: 'Billing Error' },
  { value: 'CUSTOMER_DISPUTE', label: 'Customer Dispute' },
  { value: 'GOODS_NOT_DELIVERED', label: 'Goods or Service Not Delivered' },
  { value: 'OTHER', label: 'Other' },
];

// GET /invoices' own `ageing` filter — the exact 5 literal bucket strings
// finance_engine.ageing_bucket() returns (Current / 1-30 / 31-60 / 61-90 /
// 90+), used as BOTH the filter's value and label: the query param is
// compared with `bucket.label != ageing` server-side (api/v1/invoices.py),
// so the value sent over the wire must be one of these literals verbatim,
// not a friendlier rewording.
//
// badgeClass here doubles this same array as invoice.list.config.ts's own
// Ageing COLUMN staticOptions (prototype data.js's `age` column, type
// 'chip') — an escalating severity scale since none of these literals
// ('Current', '1-30', ...) exist in cell-format.ts's shared BADGE_CLASS
// dictionary (that dictionary is keyed on status WORDS, not day-buckets),
// so every one would otherwise render as a flat neutral grey.
export const AGEING_BUCKET_OPTIONS = [
  { value: 'Current', label: 'Current', badgeClass: 'b-ok' },
  { value: '1-30', label: '1-30', badgeClass: 'b-info' },
  { value: '31-60', label: '31-60', badgeClass: 'b-warn' },
  { value: '61-90', label: '61-90', badgeClass: 'b-warn' },
  { value: '90+', label: '90+', badgeClass: 'b-danger' },
];

// InvoicePaymentCreate.withholding_calculated_on — Invoice's own literal is
// GRAND_TOTAL, NOT "TOTAL" (Purchase Bill's identical-looking field uses that
// different literal instead — confirmed against schemas/finance.py, do not
// copy across modules).
export const WITHHOLDING_CALCULATED_ON_OPTIONS = [
  { value: 'SUBTOTAL', label: 'Subtotal' },
  { value: 'GRAND_TOTAL', label: 'Grand Total' },
];

// ---------------------------------------------------------------------------
// RefLookup shorthands reused across every Invoice/Credit Note screen. Every
// labelKey below was individually verified against the real ORM model (none
// of these five Masters tables has a `name` column):
//   BankAccount.nickname (models/masters.py) — no `name` field on BankAccount.
//   TaxHead.tax_name (models/masters.py) — no `name` field on TaxHead.
//   HsnSacCode.code (models/masters.py) — no `name` field on HsnSacCode.
// ---------------------------------------------------------------------------

// GET /customers/picker — THE customer source for this whole module (New
// Invoice, Invoice List's Customer filter, Credit Note List's Customer
// filter). Gated on invoice.list visibility, not customer.directory — see
// api/v1/customers.py's own module docstring. Never /customers: that
// endpoint is customer.directory-gated, and Accountant (this module's
// primary user) is seeded "none" on customer.directory, so /customers would
// 403 for exactly the role that needs this picker most.
export const CUSTOMER_PICKER_REF = { endpoint: '/customers/picker', labelKey: 'company_name' };
export const SERVICE_CATEGORY_REF = { endpoint: '/masters/service-categories' };
export const INVOICE_FY_REF = { endpoint: '/masters/financial-years', labelKey: 'label' };
// /options, not the gated masters.bank_accounts/payment_modes/hsn_sac_codes
// screen endpoints — same reasoning as CUSTOMER_PICKER_REF above: Accountant
// is this module's primary user and no longer holds standalone `view` on
// those Masters screens (2026-08-11 RBAC audit fix), only on this
// unauthenticated-by-screen id+label picker (masters_lookup.py's
// `label_field` route / masters_bank_accounts.py's own `/options`).
export const BANK_ACCOUNT_REF = { endpoint: '/masters/bank-accounts/options', labelKey: 'label' };
export const TAX_REF = { endpoint: '/masters/taxes', labelKey: 'tax_name' };
export const HSN_REF = { endpoint: '/masters/hsn-sac-codes/options', labelKey: 'label' };
export const PAYMENT_MODE_REF = { endpoint: '/masters/payment-modes/options', labelKey: 'label' };

// Credit Note List's Raised By / Approved By columns (prototype data.js's
// `by` / `appr` columns) — CreditNoteOut.raised_by/.approved_by are raw
// platform-User ids (credit_notes.py: `raised_by=current_user.id`), same
// convention as asset/customer/opportunity's own USER_REF (GET /users ->
// {id, name}, confirmed against api/v1/users.py's UserLookupOut).
export const USER_REF = { endpoint: '/users', labelKey: 'name' };
