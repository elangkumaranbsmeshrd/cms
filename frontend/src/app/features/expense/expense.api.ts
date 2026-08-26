// Mirrors backend/app/schemas/finance.py's ExpenseClaimOut, in full. Money
// fields (amount/tax_amount) are Decimal server-side — typed as string here,
// the same "Decimal-as-string" treatment asset.api.ts's purchase_value/
// current_value already use, since this codebase's own Decimal
// serialization has been observed to vary by endpoint and every consumer in
// this module reads amounts only through cell-format.ts's formatMoney()
// (which accepts either shape) — never relied on for raw arithmetic here.
export interface ExpenseClaimRow {
  id: string;
  employee_id: string;
  financial_year_id: string;
  expense_type_id: string;
  claim_type: string; // REIMBURSABLE | COMPANY_PAID
  expense_type_name_snapshot: string;
  vendor_id: string | null;
  amount: string;
  tax_head_id: string | null;
  tax_amount: string | null;
  expense_date: string;
  linked_purchase_bill_id: string | null;
  description: string;
  receipt_stored_file_id: string | null;
  has_receipt: boolean;
  bank_account_id: string | null;
  status: string; // PENDING | MGR_APPROVED | APPROVED | REJECTED | REIMBURSED
  submitted_at: string;
  manager_approved_by: string | null;
  manager_approved_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reimbursed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

// Mirrors CompanyExpenseOut, in full. NO name-snapshot for expense_type or
// vendor (unlike ExpenseClaimOut above) — both are resolved via client-side
// lookups built from the same Masters/Vendor fetches the Add form's own
// pickers already need, see company-expenses.component.ts.
export interface CompanyExpenseRow {
  id: string;
  expense_type_id: string;
  vendor_id: string | null;
  linked_purchase_bill_id: string | null;
  source_expense_claim_id: string | null;
  amount: string;
  tax_head_id: string | null;
  tax_amount: string | null;
  paid_from_bank_account_id: string | null;
  payment_mode_id: string | null;
  payment_reference: string | null;
  paid_on: string | null;
  expense_date: string;
  billing_period_month: number | null;
  billing_period_year: number | null;
  description: string | null;
  bill_stored_file_id: string | null;
  has_bill_attached: boolean;
  status: string; // PENDING | PAID | CANCELLED
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

// GET /expenses/summary's real response shape — expenses.py's own
// expense_summary() builds this by hand (a plain dict, not a Pydantic
// model: the route's return type is bare `dict`), so it's typed here off
// that function's literal `return {...}` statement rather than off any
// schema class.
export interface ExpenseSummary {
  total_spend: string;
  total_reimbursed: string;
  by_expense_type: readonly { expense_type: string; amount: string }[];
  by_month: readonly { month: string; amount: string }[];
}

// Trimmed option shapes for the Masters/cross-module lookups this module's
// bespoke components fetch and resolve by hand — expense.approvals.list.
// config.ts is the only plain ListScreenConfig in this module and goes
// through the generic RefLookup/RefDataService machinery instead, so it
// needs none of these.
export interface ExpenseTypeOption {
  id: string;
  name: string;
  claim_type: string; // REIMBURSABLE | COMPANY_PAID
  is_active: boolean;
}

// /options routes' own shape (masters_lookup.py's label_field /
// masters_bank_accounts.py's own route) — NOT "nickname"/"name" (2026-08-11 RBAC audit fix).
export interface BankAccountOption {
  id: string;
  label: string;
  is_active: boolean;
}

export interface PaymentModeOption {
  id: string;
  label: string;
  is_active: boolean;
}

// masters_taxes.py's own field name — NOT "name".
// Fed by /masters/taxes/options, which applies the scope and in-force-window
// predicates SERVER-side. scope/applies_from/applies_until are deliberately
// absent: the picker only ever renders tax_name, so keeping them off the wire
// keeps the rest of a tax head's row — rate_pct, cgst/sgst, fixed_amount,
// slab bands — unreachable through a route that has no screen permission.
export interface TaxHeadOption {
  id: string;
  tax_name: string;
  is_active: boolean;
}

// vendors.py's own field name — NOT "name".
export interface VendorOption {
  id: string;
  vendor_name: string;
}

// PurchaseBillOut's real field is purchase_bill_code (backend/app/schemas/
// finance.py) — confirmed against the live list JSON (purchase_bills.py's
// list_purchase_bills returns real PurchaseBillOut rows on its non-export
// branch), not the export-only "bill_number" alias that same file's own
// ?format= branch uses.
export interface PurchaseBillOption {
  id: string;
  purchase_bill_code: string;
}

export interface EmployeeOption {
  id: string;
  first_name: string;
  last_name: string | null;
}
