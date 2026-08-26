// Mirrors backend/app/schemas/customer.py's CustomerOut. status_id/source_id
// are raw Masters FK ids over the wire (no denormalized name field) — the
// directory/record configs resolve them via RefDataService (screen.ref).
export interface CustomerRow {
  id: string;
  customer_code: string;
  company_name: string;
  display_name: string | null;
  gstin: string | null;
  pan: string | null;
  status_id: string;
  source_id: string | null;
  website: string | null;
  notes: string | null;
  mobile_number: string | null;
  email: string | null;
  address: string | null;
  owner_id: string | null;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_number_masked: string | null;
  // Absent entirely (RBAC 'hide') for Manager — see customer.directory's
  // sensitive_fields in app/rbac/registry/screens.py.
  collected_into_bank_account_id?: string | null;
  total_invoiced: number;
  received: number;
  outstanding: number;
  last_activity_date: string | null;
  created_by: string | null;
  updated_by: string | null;
}

// The exact body both POST /customers and PUT /customers/{id} accept
// (CustomerWrite, schemas/customer.py). collected_into_bank_account_id and
// customer_code are deliberately absent — neither is part of CustomerWrite
// (the first is system-derived, the second is server-generated on create) —
// see customer.form.config.ts's own header comment.
export interface CustomerWriteBody {
  readonly company_name: string;
  readonly display_name: string | null;
  readonly gstin: string | null;
  readonly pan: string | null;
  readonly status_id: string;
  readonly source_id: string | null;
  readonly website: string | null;
  readonly notes: string | null;
  readonly mobile_number: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly owner_id: string | null;
  readonly bank_account_name: string | null;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
}

// RefLookup shorthands shared by the directory/record/form screens — same
// centralising convention opportunity.api.ts/ticket.api.ts already use.
export const CUSTOMER_STATUS_REF = { endpoint: '/masters/customer-statuses/options', labelKey: 'label' };
export const CUSTOMER_SOURCE_REF = { endpoint: '/masters/customer-sources/options', labelKey: 'label' };
// Employee: GET /employees returns first_name/last_name as separate fields,
// no {id,name} shape — labelKey: 'first_name' is the established workaround
// used across every other module (asset.api.ts, opportunity.api.ts, ...).
export const CUSTOMER_OWNER_REF = { endpoint: '/employees/options', labelKey: 'label' };
// The Meshrd bank account a customer's payments are being collected into —
// same /masters/bank-accounts/options lookup invoice.api.ts/purchase-bill.api.ts
// use (2026-08-11 RBAC audit fix — not the gated screen endpoint).
export const CUSTOMER_BANK_ACCOUNT_REF = { endpoint: '/masters/bank-accounts/options', labelKey: 'label' };
// created_by/updated_by are raw platform User ids (AuditMixin), not Employee
// ids — same distinction owner_id/CUSTOMER_OWNER_REF above draws the other way.
export const CUSTOMER_USER_REF = { endpoint: '/users', labelKey: 'name' };
