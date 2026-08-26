import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { VENDOR_STATE_OPTIONS, VendorRow } from '../vendor.api';

// §2.2 "+ Add Vendor" create flow (data.js:1477). record-screen.component.ts
// has no create branch anywhere in this codebase (every 'record'-shape
// screen hard-requires an :id route param — confirmed on asset.create.form
// .config.ts, the precedent this file follows verbatim), so this is a
// separate, create-only 'form'-shape config sharing the same RBAC id
// ('vendor.directory') as vendor.record.config.ts, at the sibling route
// vendors/new.
//
// Fields are VendorWrite's real keys only (backend/app/schemas/vendor.py).
// is_active/bank_account_number_masked/has_bank_details/purchase_bill_count/
// expense_count/has_usage_history/outstanding_amount/total_spend are all
// server-computed, no VendorWrite counterpart — nothing to submit, none of
// them exist until the POST responds.
//
// gstin/pan/bank_account_name/bank_name/bank_account_number/ifsc_code are
// RBAC 'hide' fields for a role without edit_banking (Manager) on the record
// VIEW (record-screen.component.ts's isFieldEditable, driven by
// PolicyStore.fieldMode) — form-screen.component.ts has no equivalent check
// at all (confirmed: its own isFieldVisible only reads visibleWhen /
// hideWhenRefEmpty, never PolicyStore), so a Manager filling these in here
// and pressing Save gets create_vendor's real 403 rather than the fields
// simply not being offered. The same pre-existing gap already exists on
// asset.create.form.config.ts's own Purchase Value field — not new, not
// vendor-specific, and not something one config file can fix.
const config: FormScreenConfig<VendorRow> = {
  shape: 'form',
  id: 'vendor.directory',
  // §2.2 "+ Add Vendor" — FormScreenConfig has no specRef field (unlike
  // ListScreenConfig/ReportScreenConfig/etc.), so the spec section is only
  // in this comment, not on screen.
  title: 'Vendor',
  // Never actually read: this route carries no :id param, so
  // form-screen.component.ts's constructor takes its "no id -> create mode"
  // branch and never touches listEndpoint/rowId. Still required by the type.
  listEndpoint: '/vendors',
  rowId: (row) => row.id,
  createEndpoint: '/vendors',
  // Deliberately no updateEndpoint — permanently create-only.
  emptyRow: () => ({
    vendor_name: '',
    vendor_category: null,
    gstin: null,
    pan: null,
    contact_email: null,
    contact_phone: null,
    // payment_terms_days is a non-nullable number on VendorRow (it always
    // reads back a real int once saved) — left unset here rather than
    // forced to 0, so the input starts genuinely blank and A257's "defaults
    // to 30 if left blank" server-side rule is what actually fills it.
    address_street: null,
    address_city: null,
    address_state: null,
    address_pin_code: null,
    bank_account_name: null,
    bank_name: null,
    bank_account_number: null,
    ifsc_code: null,
  }),
  fields: [
    { key: 'vendor_name', label: 'Vendor Name', required: true, span: 2, hint: '2–150 characters.', section: 'Vendor' },
    { key: 'gstin', label: 'GSTIN', hint: 'Exactly 15 characters, auto-uppercased.', pattern: { re: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, message: 'GSTIN is not a valid 15-character GSTIN' } },
    { key: 'pan', label: 'PAN', pattern: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'PAN must be 5 letters, 4 digits, then 1 letter' } },
    { key: 'payment_terms_days', label: 'Payment Terms (Days)', type: 'number', hint: 'Defaults to 30 if left blank.' },
    { key: 'contact_email', label: 'Contact Email', type: 'email' },
    { key: 'contact_phone', label: 'Contact Phone', pattern: { re: /^[6-9][0-9]{9}$/, message: 'Contact Phone must be a 10-digit Indian mobile number' } },
    // See this file's own header doc — real column, no prototype
    // counterpart anywhere in Vendor; appended last so it never disturbs
    // the prototype's own field order above it.
    { key: 'vendor_category', label: 'Category' },
    { key: 'address_street', label: 'Street', section: 'Address' },
    { key: 'address_city', label: 'City' },
    { key: 'address_state', label: 'State', type: 'select', staticOptions: VENDOR_STATE_OPTIONS },
    { key: 'address_pin_code', label: 'PIN Code', pattern: { re: /^[0-9]{6}$/, message: 'PIN Code must be exactly 6 digits' } },
    {
      key: 'bank_account_name',
      label: 'Bank Account Name',
      section: "Bank Details — the vendor's own account, for Meshrd to pay them",
    },
    { key: 'bank_name', label: 'Bank' },
    { key: 'bank_account_number', label: 'Bank Account Number', pattern: { re: /^[0-9]{9,18}$/, message: 'Bank Account Number must be 9-18 digits' } },
    {
      key: 'ifsc_code',
      label: 'IFSC Code',
      hint: 'Exactly 11 characters — without it a bill payment cannot be routed by NEFT/RTGS.',
      pattern: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'Invalid IFSC format' },
    },
  ],
  listRoute: ['/vendors'],
  // §2.1's "+ Add Vendor" opens straight into the new vendor's own record
  // (Details/Usage tabs) rather than just returning to the Directory — same
  // house convention asset.create.form.config.ts's own onCreateSuccess
  // already established for "+ Add Asset".
  onCreateSuccess: (response) => ['/vendors', response.id],
};

export default config;
