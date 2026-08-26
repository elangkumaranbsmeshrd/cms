// Masters §0: no sub-master backs Indian states in this codebase, so the
// prototype's own hardcoded 3-value list (app-screens2.js:408's Address —
// State select) is the real option set. Shared here so vendor.record.config
// .ts (edit) and vendor.create.form.config.ts (create) can never drift apart.
export const VENDOR_STATE_OPTIONS = [
  { value: 'Tamil Nadu', label: 'Tamil Nadu' },
  { value: 'Karnataka', label: 'Karnataka' },
  { value: 'Maharashtra', label: 'Maharashtra' },
];

// Mirrors backend/app/schemas/vendor.py's VendorOut exactly — banking/GSTIN/PAN
// fields are optional here because the API omits them entirely (RBAC 'hide')
// for a role lacking 'edit_banking' on vendor.directory, not because they're
// ever really absent for a role that can see them.
export interface VendorRow {
  id: string;
  vendor_name: string;
  vendor_category: string | null;
  gstin?: string | null;
  pan?: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms_days: number;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_pin_code: string | null;
  bank_account_name?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_number_masked?: string | null;
  ifsc_code?: string | null;
  has_bank_details: boolean;
  is_active: boolean;
  approval_status: string; // approved | pending_approval — §6.1
  purchase_bill_count: number;
  expense_count: number;
  has_usage_history: boolean;
  outstanding_amount: number;
  total_spend: number;
}
