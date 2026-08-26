// Mirrors backend/app/schemas/finance.py's PurchaseBillOut/PurchaseBillLineItemOut/
// PurchaseBillTaxLineOut/PurchaseBillPaymentOut — shared across every Purchase
// Bill screen so the row shapes and the fixed option lists are declared
// exactly once (same convention as invoice.api.ts).

export interface PurchaseBillLineItemRow {
  readonly id: string;
  readonly sequence: number;
  readonly description: string;
  readonly hsn_code_id: string | null;
  readonly quantity: number;
  readonly rate: number;
  readonly line_total: number;
}

export interface PurchaseBillTaxLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly tax_head_id: string | null;
  readonly head_name_snapshot: string | null;
  readonly print_label_snapshot: string | null;
  readonly computed_base: number;
  readonly computed_amount: number;
  readonly entered_amount: number;
  readonly component_name_snapshot: string | null;
}

// PurchaseBillOut, plus tax_amount_override/withholding_amount_override —
// both exist on PurchaseBillCreate (the POST/PUT body) but are NEVER
// returned by GET /purchase-bills/{id}: PurchaseBillOut has no such columns
// at all (confirmed against schemas/finance.py). Declared here anyway,
// optional, purely so FieldConfig<PurchaseBillRow>'s `key: keyof
// PurchaseBillRow` accepts them for the Add/Edit form's own inputs —
// editing an existing bill's overrides therefore always starts blank (the
// API gives no way to know whether a prior save used one, or what it was);
// leaving them blank on Save recomputes tax/withholding from the head's own
// rate, same as Create's own default path. A confirmed, disclosed backend
// asymmetry (identical shape to Invoice's own tax_amount_override — see
// invoice.api.ts's matching comment), not a frontend bug.
export interface PurchaseBillRow {
  readonly id: string;
  readonly purchase_bill_code: string;
  readonly vendor_id: string;
  readonly financial_year_id: string;
  readonly vendor_bill_number: string;
  readonly vendor_name_snapshot: string;
  readonly vendor_gstin_snapshot: string | null;
  readonly bill_date: string;
  readonly due_date: string | null;
  readonly payment_terms_days_snapshot: number | null;
  readonly attachment_stored_file_id: string | null;
  readonly has_attachment: boolean;
  readonly bank_account_id: string | null;
  // Router-computed, not a DB column: latest RECORDED payment's own
  // paid_from_bank_account_id if one exists, else bank_account_id (see
  // api/v1/purchase_bills.py's _load_bill_out). The List column's real
  // source and the Record Payment form's own "Paid From" default both read
  // this instead of bank_account_id directly.
  readonly effective_bank_account_id: string | null;
  readonly linked_expense_claim_id: string | null;
  readonly subtotal: number;
  readonly tax_head_id: string | null;
  readonly tax_amount_override?: number | null;
  readonly tax_amount: number;
  readonly total_amount: number;
  readonly withholding_tax_head_id: string | null;
  readonly withholding_calculated_on: string | null; // 'SUBTOTAL' | 'TOTAL' — see WITHHOLDING_CALCULATED_ON_OPTIONS's own comment
  readonly withholding_amount_override?: number | null;
  readonly withholding_amount: number;
  readonly withholding_head_name_snapshot: string | null;
  readonly amount_payable_to_vendor: number;
  readonly amount_paid: number;
  readonly balance_due: number;
  readonly status: string; // UNPAID | PART_PAID | PAID — never DRAFT/SENT, see PURCHASE_BILL_STATUS_OPTIONS
  readonly paid_at: string | null;
  readonly notes: string | null;
  readonly created_by: string | null;
  readonly updated_by: string | null;
  readonly line_items: readonly PurchaseBillLineItemRow[];
  readonly tax_lines: readonly PurchaseBillTaxLineRow[];
}

export interface PurchaseBillPaymentRow {
  readonly id: string;
  readonly purchase_bill_id: string;
  readonly amount: number;
  readonly balance_due_at_entry: number;
  readonly payment_mode_id: string;
  readonly paid_from_bank_account_id: string | null;
  readonly paid_into_account_name_snapshot: string | null;
  readonly paid_into_bank_name_snapshot: string | null;
  readonly paid_into_account_number_masked_snapshot: string | null;
  readonly payment_date: string;
  readonly reference: string | null;
  readonly status: string;
  readonly recorded_by: string;
  readonly recorded_at: string;
  // paid_into_ifsc_snapshot is captured server-side but deliberately NEVER
  // returned by PurchaseBillPaymentOut (schemas/finance.py) — not declared
  // here at all, so nothing on this screen can attempt to display it.
}

// The exact body POST /purchase-bills/{id}/payments accepts
// (PurchaseBillPaymentCreate). Unlike Invoice's own payment body, there is
// no withholding field here at all — withholding on a Purchase Bill is fixed
// at bill Create/Edit time, never re-entered at payment time.
export interface PurchaseBillPaymentCreateBody {
  readonly amount: number;
  readonly payment_mode_id: string;
  readonly paid_from_bank_account_id: string | null;
  readonly payment_date: string;
  readonly reference: string | null;
}

// ---------------------------------------------------------------------------
// Static option lists — real backend CHECK-constraint/enum values (verified
// against app/api/v1/purchase_bills.py and services/finance_engine.py's own
// resolve_purchase_bill_status).
// ---------------------------------------------------------------------------

// PurchaseBill.status — resolve_purchase_bill_status's own 3-value set
// (finance_engine.py): "status is an inference, no Draft/Sent"
// (13-purchase-bill-module.md §2.2, quoted in the router's own docstring).
// Label text matches the exact words cell-format.ts's own BADGE_CLASS
// dictionary keys on (case/dash/underscore-normalized) — 'unpaid'/
// 'part paid'/'paid' — so the badge colour comes free, no per-option
// override needed.
export const PURCHASE_BILL_STATUS_OPTIONS = [
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PART_PAID', label: 'Part-Paid' },
  { value: 'PAID', label: 'Paid' },
];

// PurchaseBillCreate.withholding_calculated_on — this module's own literal is
// TOTAL, NOT 'GRAND_TOTAL' (Invoice's identical-looking field uses that
// different literal instead — confirmed against schemas/finance.py, do not
// copy across modules).
export const WITHHOLDING_CALCULATED_ON_OPTIONS = [
  { value: 'SUBTOTAL', label: 'Subtotal' },
  { value: 'TOTAL', label: 'Total' },
];

// GET /purchase-bills' own `ageing` filter — the exact 5 literal bucket
// strings finance_engine.ageing_bucket() returns (Current / 1-30 / 31-60 /
// 61-90 / 90+), used as BOTH the filter's value and label: the query param is
// compared with `bucket.label != ageing` server-side (api/v1/purchase_bills.py),
// so the value sent over the wire must be one of these literals verbatim,
// not a friendlier rewording. Identical set to invoice.api.ts's own
// AGEING_BUCKET_OPTIONS (same shared finance_engine.ageing_bucket()), kept
// as this module's own copy rather than a cross-module import — matching how
// invoice.api.ts/expense.api.ts each already keep their own constants
// instead of importing across feature folders.
export const AGEING_BUCKET_OPTIONS = [
  { value: 'Current', label: 'Current' },
  { value: '1-30', label: '1-30' },
  { value: '31-60', label: '31-60' },
  { value: '61-90', label: '61-90' },
  { value: '90+', label: '90+' },
];

// ---------------------------------------------------------------------------
// RefLookup shorthands reused across every Purchase Bill screen. Every
// labelKey below was individually verified against the real ORM model/schema:
//   Vendor.vendor_name (models/vendor.py) — no `name` field on Vendor.
//   BankAccount.nickname (models/masters.py) — no `name` field on BankAccount.
//   TaxHead.tax_name (models/masters.py) — no `name` field on TaxHead.
//   HsnSacCode.code (models/masters.py) — no `name` field on HsnSacCode.
//   ExpenseClaimOut.description (schemas/finance.py) — no code/number field
//   exists on ExpenseClaim at all; description is the best available label.
// ---------------------------------------------------------------------------

// GET /vendors, filtered to active-only — the New/Edit form's own Vendor
// picker (createOnly there, so only ever exercised while creating a NEW
// bill). Unlike Invoice's CUSTOMER_PICKER_REF, there is no dedicated
// purchase_bill-scoped picker endpoint, and vendor.directory itself is NOT
// one of the known RBAC gaps this module hits — ACCOUNTANT is seeded "full"
// there (confirmed against seed.py's own role_screen_defaults), unlike
// masters.bank_accounts/payment_modes/hsn_sac_codes below — so calling the
// plain directory endpoint directly is safe.
//
// Also excludes approval_status=pending_approval (Vendor §6.1's "Require
// Approval to Add a New Vendor" — create_purchase_bill's own server-side
// gate rejects a pending vendor with a 422) — same picker-proactively-hides
// treatment as is_active above, so this never lets someone pick a vendor
// only to have the submit itself fail.
export const VENDOR_ACTIVE_REF = { endpoint: '/vendors?is_active=true&approval_status=approved', labelKey: 'vendor_name' };
// The List screen's own Vendor filter — every vendor regardless of active
// state, so a bill against a since-deactivated vendor can still be found.
export const VENDOR_REF = { endpoint: '/vendors', labelKey: 'vendor_name' };
// FIXED 2026-08-11 (RBAC audit): the three refs below used to hit the real
// masters.bank_accounts/payment_modes/hsn_sac_codes SCREEN endpoints, which
// 404'd for Accountant (seeded "none"/"view"-only-for-other-reasons there) —
// previously flagged here as a known, un-fixed gap. Rather than widening
// Accountant's screen-level grant (which would also open those Masters
// admin screens standalone, contradicting §3.0/§3.7), the real fix was a
// dedicated `/options` route on each (masters_lookup.py's `label_field` /
// masters_bank_accounts.py's own route) gated on plain authentication only,
// same "not more sensitive than what the caller can already see" precedent
// as CUSTOMER_PICKER_REF/VENDOR_ACTIVE_REF above.
export const BANK_ACCOUNT_REF = { endpoint: '/masters/bank-accounts/options', labelKey: 'label' };
export const TAX_REF = { endpoint: '/masters/taxes', labelKey: 'tax_name' };
export const HSN_REF = { endpoint: '/masters/hsn-sac-codes/options', labelKey: 'label' };
export const PAYMENT_MODE_REF = { endpoint: '/masters/payment-modes/options', labelKey: 'label' };
// GET /expenses ('expense.all_expenses' — ACCOUNTANT is seeded "full" there
// too, confirmed against seed.py, so this is not a further instance of the
// gap above). No code/number field on ExpenseClaim — description is the
// best available label (confirmed against schemas/finance.py's own
// ExpenseClaimOut).
export const EXPENSE_CLAIM_REF = { endpoint: '/expenses', labelKey: 'description' };
// §2.1's own "Available in full... Super Admin additionally gets Last
// Modified By" — created_by/updated_by are raw platform User ids, resolved
// via the same cross-cutting GET /users convention every other created-by/
// last-modified-by filter in this codebase uses (invoice.api.ts's own
// USER_REF, my-leave.component.ts, asset.requests.list.config.ts).
export const USER_REF = { endpoint: '/users', labelKey: 'name' };
export const PURCHASE_BILL_FY_REF = { endpoint: '/masters/financial-years', labelKey: 'label' };
