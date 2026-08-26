// Module 15 — Tax & Compliance. Row shapes mirror backend/app/schemas/compliance.py
// one-for-one (field names, nullability). Decimal fields are typed `string`,
// matching this codebase's own convention for every other Decimal-backed row
// (e.g. leave.approvals.list.config.ts's `days_requested: string`) —
// formatMoney() (cell-format.ts) accepts either a string or a number.
//
// Also carries this module's status-badge-colour option lists (see the
// screen.types.ts / list-screen.component.ts changes this module required)
// and a few small cross-module lookup shapes the bespoke sub-screens fetch
// directly (Masters → Taxes/Bank Accounts/Payment Modes, Customers picker) —
// kept local rather than imported from another feature's own *.api.ts file,
// so this module stays self-contained under features/compliance/ per its
// build scope and doesn't couple to another module's types while that module
// may be mid-build concurrently.
import { FilterOption } from '../../shared/screens/screen.types';

// ================================================================ OBLIGATIONS

export interface ObligationDocumentRow {
  readonly source_type: string;
  readonly source_id: string;
  readonly document_label: string;
  readonly counterparty: string;
  readonly event_date: string;
  readonly amount: string;
  readonly document_total: string;
  readonly calculated_on: string | null;
}

export interface ObligationPeriodRow {
  readonly tax_head_id: string;
  readonly tax_head_name: string;
  readonly remitted_to: string | null;
  readonly source_label: string;
  readonly period_label: string;
  readonly period_from: string;
  readonly period_to: string;
  readonly withheld: string;
  readonly remitted: string;
  readonly outstanding: string;
  readonly due_date: string;
  readonly status: string; // OPEN | DUE_SOON | OVERDUE | PART_REMITTED | REMITTED
  // The head's own configured "what does this jurisdiction call its
  // reference" LABEL text (e.g. "Challan Number") — NOT a specific
  // remittance's reference value. Confirmed against obligation_engine.py:
  // `authority_reference_label=head.authority_reference_label`. A period is
  // a derived grouping that may span zero-to-many real remittances, each
  // with its own distinct reference value, so there is no single "the"
  // value to show at this level.
  readonly authority_reference_label: string | null;
  readonly documents: readonly ObligationDocumentRow[];
}

export interface ObligationByDocumentRow {
  readonly source_type: string;
  readonly source_id: string;
  readonly document_label: string;
  readonly source_label: string;
  readonly counterparty: string;
  readonly event_date: string;
  readonly tax_head_id: string;
  readonly tax_head_name: string;
  readonly calculated_on: string | null;
  readonly document_total: string;
  readonly withheld: string;
  readonly net_paid: string;
  readonly period_label: string;
  readonly remittance_status: string; // OPEN | PART_REMITTED | REMITTED
  // Same head-label-text situation as ObligationPeriodRow.authority_reference_label
  // above, just carried under the non-`_label`-suffixed key on THIS schema
  // (ObligationsByDocumentRow.authority_reference in compliance.py) — the two
  // key names refer to the identical underlying value.
  readonly authority_reference: string | null;
}

export interface ComplianceOverview {
  readonly has_obligation_heads_configured: boolean;
  readonly has_credit_heads_configured: boolean;
  readonly withheld_not_yet_remitted: string;
  readonly due_within_7_days: string;
  readonly overdue_remittances: string;
  readonly remitted_this_fy: string;
  readonly withheld_by_customers_this_fy: string;
  readonly certificate_outstanding: string;
  readonly certified_not_yet_claimed: string;
  readonly credit_claimed_this_fy: string;
  readonly due_soon_and_overdue: readonly ObligationPeriodRow[];
  readonly certificates_outstanding_oldest_first: readonly CertificateRow[];
}

// ================================================================ REMITTANCES

export interface RemittanceAllocationRow {
  readonly source_type: string;
  readonly source_id: string;
  readonly document_label: string;
  readonly amount: string;
}

export interface RemittanceRow {
  readonly id: string;
  readonly remittance_number: string;
  readonly financial_year_id: string;
  readonly tax_head_id: string;
  readonly tax_head_name_snapshot: string;
  readonly remitted_to_snapshot: string | null;
  readonly period_label: string;
  readonly period_from: string;
  readonly period_to: string;
  readonly amount_remitted: string;
  readonly paid_on: string;
  readonly paid_from_bank_account_id: string;
  readonly paid_from_bank_account_name: string;
  readonly payment_mode_id: string;
  readonly payment_mode_name: string;
  readonly authority_reference: string; // a REAL value here (a logged deposit), unlike the two head-label fields above
  readonly receipt_file_id: string | null;
  readonly notes: string | null;
  readonly recorded_by: string;
  readonly recorded_by_name: string;
  readonly is_reversal: boolean;
  readonly reverses_remittance_id: string | null;
  readonly reversal_reason: string | null;
  readonly documents_covered: readonly RemittanceAllocationRow[];
  readonly created_at: string;
}

export interface RemittanceEligibleDocumentRow {
  readonly source_type: string;
  readonly source_id: string;
  readonly document_label: string;
  readonly counterparty: string;
  readonly withheld_amount: string;
  readonly already_allocated: string;
  readonly outstanding: string;
}

// ==================================================================== CREDITS

export interface CreditRow {
  readonly invoice_payment_id: string;
  readonly invoice_number: string;
  readonly customer_id: string;
  readonly customer_name: string;
  readonly payment_date: string;
  readonly invoice_total: string;
  readonly amount_received: string;
  readonly withheld: string;
  readonly tax_head_id: string;
  readonly certificate_id: string | null;
  readonly certificate_reference: string | null;
  readonly credit_claimed: boolean;
  readonly status: string; // NOT_EXPECTED | AWAITING_CERTIFICATE | CERTIFIED_UNCLAIMED | CLAIMED | VARIANCE
}

// ================================================================= CERTIFICATES

export interface CertificateReceiptRow {
  readonly invoice_payment_id: string;
  readonly invoice_number: string;
  readonly amount: string;
}

export interface CertificateRow {
  readonly id: string;
  readonly certificate_reference: string;
  readonly customer_id: string;
  readonly certificate_date: string;
  readonly covered_from: string;
  readonly covered_to: string;
  readonly tax_head_id: string;
  readonly tax_head_name_snapshot: string;
  readonly amount_on_certificate: string;
  readonly amount_matched: string;
  readonly variance: string;
  readonly attachment_file_id: string | null;
  readonly status: string; // ACTIVE | VOIDED
  readonly voided_at: string | null;
  readonly voided_by: string | null;
  readonly void_reason: string | null;
  readonly receipts_covered: readonly CertificateReceiptRow[];
  readonly created_at: string;
}

export interface CreditClaimRow {
  readonly id: string;
  readonly certificate_id: string;
  readonly amount_claimable: string;
  readonly claimed_in: string;
  readonly claim_reference: string | null;
  readonly claim_date: string;
  readonly notes: string | null;
  readonly claimed_by: string;
  readonly created_at: string;
}

// ======================================================= CROSS-MODULE LOOKUPS
// Minimal shapes for the raw HttpClient calls the bespoke sub-screens make
// directly (no dedicated RefLookup/optionsRef picker exists for these three
// on a plain <select>, or the caller needs more than just {id,label}).

export interface TaxHeadLookup {
  readonly id: string;
  readonly tax_name: string;
  readonly remitted_to_authority: string | null;
  readonly authority_reference_label: string | null;
  readonly creates_onward_liability: boolean;
}

// {id, label} — /options routes (masters_lookup.py's label_field /
// masters_bank_accounts.py's own route), not the gated Masters screens; see
// compliance.remittances-record.component.ts's own comment.
export interface BankAccountOption {
  readonly id: string;
  readonly label: string;
}

export interface PaymentModeOption {
  readonly id: string;
  readonly label: string;
}

export interface CustomerPickerOption {
  readonly id: string;
  readonly company_name: string;
  readonly display_name: string | null;
}

// ============================================================ STATUS BADGES
// §4's module colour convention: "Open grey · Due Soon amber · Overdue red ·
// Part-Remitted blue · Remitted green." The shared BADGE_CLASS dictionary
// (cell-format.ts) maps 'open' to b-warn (an unrelated Tickets use — wrong
// colour for this module, which wants Open to read as neutral/grey) and has
// no entries at all for the rest of this vocabulary, so every value below
// carries an explicit per-option `badgeClass` (ColumnDef.staticOptions /
// FilterOption, screen.types.ts) rather than relying on the shared fallback.
export const OBLIGATION_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'OPEN', label: 'Open', badgeClass: 'b-neutral' },
  { value: 'DUE_SOON', label: 'Due Soon', badgeClass: 'b-warn' },
  { value: 'OVERDUE', label: 'Overdue', badgeClass: 'b-danger' },
  { value: 'PART_REMITTED', label: 'Part-Remitted', badgeClass: 'b-info' },
  { value: 'REMITTED', label: 'Remitted', badgeClass: 'b-ok' },
];

// Obligations — By Document only ever carries 3 of the 5 (no per-DOCUMENT
// Due Soon concept — obligation_engine nets Due Soon/Overdue per PERIOD;
// by-document only tracks Open/Part-Remitted/Remitted, per
// api/v1/compliance.py's obligations_by_document). Same colours as above for
// the values it shares.
export const BY_DOCUMENT_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'OPEN', label: 'Open', badgeClass: 'b-neutral' },
  { value: 'PART_REMITTED', label: 'Part-Remitted', badgeClass: 'b-info' },
  { value: 'REMITTED', label: 'Remitted', badgeClass: 'b-ok' },
];

// Credits' own 5-value vocabulary has no module-convention colour stated in
// §4 (that paragraph only names the Obligations-side 5) — chosen to carry
// the same semantic weight as the closest Obligations-side analogue: NOT_
// EXPECTED reads like Open (nothing due, grey), AWAITING_CERTIFICATE like a
// thing to chase (amber, same tone as the shared dictionary's own
// 'pending'), CERTIFIED_UNCLAIMED like Part-Remitted (matched but not yet
// closed out, blue), CLAIMED like Remitted (fully settled, green), VARIANCE
// like Overdue (needs investigation, red).
export const CREDIT_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'NOT_EXPECTED', label: 'Not Expected', badgeClass: 'b-neutral' },
  { value: 'AWAITING_CERTIFICATE', label: 'Awaiting Certificate', badgeClass: 'b-warn' },
  { value: 'CERTIFIED_UNCLAIMED', label: 'Certified — Unclaimed', badgeClass: 'b-info' },
  { value: 'CLAIMED', label: 'Claimed', badgeClass: 'b-ok' },
  { value: 'VARIANCE', label: 'Variance', badgeClass: 'b-danger' },
];

// ACTIVE already resolves correctly through the shared dictionary
// ('active' -> b-ok) and VOIDED would already fall back to neutral grey —
// both given an explicit entry anyway so this module's whole status
// vocabulary is self-documenting in one place rather than half-explicit,
// half-relying-on-a-coincidental-shared-dictionary-match.
export const CERTIFICATE_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'ACTIVE', label: 'Active', badgeClass: 'b-ok' },
  { value: 'VOIDED', label: 'Voided', badgeClass: 'b-neutral' },
];

export const OBLIGATION_SOURCE_OPTIONS: readonly FilterOption[] = [
  { value: 'Vendor', label: 'Vendor' },
  { value: 'Employee', label: 'Employee' },
];

/** screen.types.ts's own documented convention for "no dedicated options
 * endpoint" (FilterDef.optionsFromRows) — none of Obligations / By Document /
 * Remittances has a scoped-to-this-register Tax Head picker, so the option
 * list is derived from whichever rows the list itself already fetched.
 * Shared by all three (their row shapes name the same two facts, just
 * sometimes through a `_snapshot`-suffixed key) — callers pass their own
 * [id, label] pair accessor. */
export function dedupeTaxHeadOptions(pairs: readonly (readonly [string, string])[]): FilterOption[] {
  const seen = new Map<string, string>();
  for (const [value, label] of pairs) {
    if (value && !seen.has(value)) seen.set(value, label);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}
