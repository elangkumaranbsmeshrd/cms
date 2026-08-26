import { RecordScreenConfig } from '../../../shared/screens/screen.types';
import { VENDOR_STATE_OPTIONS, VendorRow } from '../vendor.api';
import { buildVendorUsageListConfig } from './vendor.usage.list.config';

// §2.2 Add/Edit Vendor (data.js:1479, app-screens2.js:393-425). The
// prototype's R.record.vendor has ONE tab ("Details") holding three stacked
// sections — Vendor / Address / Bank Details — plus a second "Usage" tab.
// This used to be split into three separate Angular tabs (details/address/
// banking); merged back to match — see each section below for what moved
// and why.
const GSTIN_PATTERN = { re: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, message: 'GSTIN is not a valid 15-character GSTIN' };
const PAN_PATTERN = { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'PAN must be 5 letters, 4 digits, then 1 letter' };
const PHONE_PATTERN = { re: /^[6-9][0-9]{9}$/, message: 'Contact Phone must be a 10-digit Indian mobile number' };
const PIN_PATTERN = { re: /^[0-9]{6}$/, message: 'PIN Code must be exactly 6 digits' };
const BANK_ACCOUNT_PATTERN = { re: /^[0-9]{9,18}$/, message: 'Bank Account Number must be 9-18 digits' };
const IFSC_PATTERN = { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'Invalid IFSC format' };

const config: RecordScreenConfig<VendorRow> = {
  shape: 'record',
  id: 'vendor.directory',
  title: 'Vendor Record',
  loadEndpoint: (id) => `/vendors/${id}`,
  // PUT /vendors/{id} (vendors.py) already enforces the edit_banking split
  // server-side (a role with 'edit' but not 'edit_banking' has its banking
  // fields silently skipped, never nulled) — the frontend's only job is not
  // to offer an editable banking input to a role that can't even see the
  // real value, which isFieldEditable()'s hide-mode check already covers
  // (Manager: 'edit' but not 'edit_banking', and every one of these fields
  // is 'hide' mode for Manager per seed.py — so they're never even in row()).
  edit: { saveEndpoint: (id) => `/vendors/${id}` },
  header: {
    primary: (row) => row.vendor_name,
    // Prototype's head() shows THREE meta facts (meta: [gstin, city, terms],
    // app-screens2.js:394) — RecordHeaderConfig only has one `secondary`
    // slot (unlike the newer RecordHeaderDef's own `meta` array), so they're
    // joined the same dot-separated way that shape renders multi-fact meta.
    secondary: (row) => [row.gstin, row.address_city, row.payment_terms_days ? `${row.payment_terms_days} days` : null].filter(Boolean).join(' · '),
    // Vendor deliberately has no auto-generated code (A257/A259) — the
    // prototype's own head() hardcodes the literal string 'Vendor' here
    // (app-screens2.js:394), not a per-record id. A raw UUID fragment (the
    // previous behavior) is exactly the kind of Angular-invented stand-in
    // this rebuild is meant to remove.
    code: () => 'Vendor',
    // Pending approval takes priority over Active/Inactive — it's the state
    // that needs someone's attention (§6.1: a pending vendor still defaults
    // to is_active=true, so Active alone would hide the more urgent fact).
    badge: (row) => (row.approval_status === 'pending_approval' ? 'Pending Approval' : row.is_active ? 'Active' : 'Inactive'),
  },
  // §2.2's Save/Deactivate/Delete in the prototype's own actions()
  // (app-screens2.js:424). Delete is real (DELETE /vendors/{id}, 409 once
  // has_usage_history — surfaced via secondaryActionError like any other
  // action failure) and now wired via RecordSecondaryActionDef's own
  // method:'DELETE'/navigateAfter (record-screen.component.ts) — added
  // there specifically because this screen had nothing to wire it to
  // (see git history / this module's own build report for the prior gap).
  secondaryActions: [
    {
      // §6.1 "Require Approval to Add a New Vendor" — Accountant/Super Admin
      // sign-off. Hidden once approved, and hidden for a role lacking
      // approve_vendor even while pending (screenAction handles that).
      label: 'Approve',
      endpoint: (id) => `/vendors/${id}/approve`,
      screenAction: 'approve_vendor',
      visible: (row) => row.approval_status === 'pending_approval',
      confirm: 'Approve this vendor? It can be used on a Purchase Bill once approved.',
    },
    {
      label: 'Deactivate',
      endpoint: (id) => `/vendors/${id}/deactivate`,
      screenAction: 'deactivate',
      visible: (row) => row.is_active,
      confirm: 'Deactivate this vendor? It stops being selectable on new Purchase Bills or Expenses; existing ones keep it.',
    },
    {
      // The reverse direction — the prototype's own mock vendor is always
      // Active so it never shows this button, but §2.2 frames Status as a
      // real two-way toggle and the backend's POST /vendors/{id}/activate
      // is the only way back once deactivated.
      label: 'Activate',
      endpoint: (id) => `/vendors/${id}/activate`,
      screenAction: 'activate',
      visible: (row) => !row.is_active,
    },
    {
      // Backend gates this on the 'deactivate' action, not 'edit'
      // (require_screen(SCREEN, action="deactivate") — vendors.py's own
      // delete_vendor) — same permission as the Deactivate button above,
      // matching §2.2's own framing of Delete as "Deactivate's harder edge".
      label: 'Delete',
      icon: 'trash',
      endpoint: (id) => `/vendors/${id}`,
      screenAction: 'deactivate',
      method: 'DELETE',
      navigateAfter: ['/vendors'],
      confirm: 'Delete this vendor permanently? This only succeeds if it has no Purchase Bill or Expense history — once either exists, Deactivate is the only option.',
    },
  ],
  tabs: [
    {
      id: 'details',
      label: 'Details',
      sections: [
        {
          title: 'Vendor',
          fields: [
            { key: 'vendor_name', label: 'Vendor Name', editable: true, required: true, span: 2, hint: '2–150 characters' },
            // Real Status is a two-way lifecycle move (Deactivate/Activate
            // above, POST-only — is_active is not a VendorWrite field, so it
            // can never be a plain editable input submitted with Save). This
            // is a read-only echo of the prototype's own Status row, not a
            // fake toggle that would silently no-op on save.
            {
              key: 'is_active',
              label: 'Status',
              compute: (row) => (row.is_active ? 'Active' : 'Inactive'),
              hint: 'Defaults to Active on creation. Changed with Deactivate / Activate above, not with Save.',
            },
            {
              // §6.1 — read-only for the same reason Status is: only the
              // Approve action above (POST /vendors/{id}/approve) can move
              // this, never a plain Save.
              key: 'approval_status',
              label: 'Approval',
              compute: (row) => (row.approval_status === 'pending_approval' ? 'Pending Approval' : 'Approved'),
              hint: "Only appears as 'Pending Approval' while the 'Require Approval to Add a New Vendor' toggle is on.",
            },
            { key: 'gstin', label: 'GSTIN', editable: true, hint: 'Exactly 15 characters, auto-uppercased', pattern: GSTIN_PATTERN },
            { key: 'pan', label: 'PAN', editable: true, pattern: PAN_PATTERN },
            { key: 'payment_terms_days', label: 'Payment Terms (Days)', editable: true, hint: 'Defaults to 30 if left blank' },
            { key: 'contact_email', label: 'Contact Email', editable: true, type: 'email' },
            { key: 'contact_phone', label: 'Contact Phone', editable: true, pattern: PHONE_PATTERN },
            // QUEUED / NOT BUILT — no prototype counterpart at all (neither
            // the Directory nor this record shows a Category field/column),
            // but it's a real, independently writable column
            // (vendors.vendor_category, backend/app/models/vendor.py:20) with
            // no Masters sub-master behind it yet (see masters_lookup.py's
            // factory — no 'vendor-categories' entry). Kept per this
            // rebuild's own rule against deleting real backend-wired fields
            // just because the prototype's mock version omitted them;
            // appended last so it never disturbs the prototype's own field
            // order above it. Left as free text for the same reason
            // vendors.py's own vendor_category filter is an exact-string
            // match — fixing that is a Masters addition, not a frontend one.
            { key: 'vendor_category', label: 'Category', editable: true },
          ],
        },
        {
          title: 'Address',
          fields: [
            { key: 'address_street', label: 'Street', editable: true },
            { key: 'address_city', label: 'City', editable: true },
            { key: 'address_state', label: 'State', editable: true, type: 'select', staticOptions: VENDOR_STATE_OPTIONS },
            { key: 'address_pin_code', label: 'PIN Code', editable: true, hint: 'Exactly 6 digits', pattern: PIN_PATTERN },
          ],
        },
        {
          // Prototype's own section title plus its separate trailing note
          // (app-screens2.js:409 / :415 — U.section's 3rd argument) folded
          // into one string: FieldSection has a single `title` slot, no
          // secondary-note slot to hold the two separately.
          title:
            "Bank Details — the vendor's own account, for Meshrd to pay them (completely separate from the Bank Account sub-master in Masters, which holds only Meshrd's own accounts)",
          fields: [
            // Bank Account Name / Bank have no input on the prototype's OWN
            // record form — only Bank Account Number + IFSC do
            // (app-screens2.js:412-414). But bname/bbank are real,
            // independently writable VendorWrite columns, and they are
            // exactly what the Directory's own "Bank Account Name" / "Bank"
            // columns read from — dropping them here would make those two
            // real Directory columns permanently un-settable by anyone, a
            // genuine functionality loss the "prototype's mock form was
            // simpler" carve-out does not cover. Kept, ordered to match the
            // Directory's own bname/bbank/bacc column order.
            { key: 'bank_account_name', label: 'Bank Account Name', editable: true },
            { key: 'bank_name', label: 'Bank', editable: true },
            { key: 'bank_account_number', label: 'Bank Account Number', editable: true, pattern: BANK_ACCOUNT_PATTERN },
            {
              key: 'ifsc_code',
              label: 'IFSC Code',
              editable: true,
              hint: 'Exactly 11 characters — without it a bill payment cannot be routed by NEFT/RTGS',
              pattern: IFSC_PATTERN,
            },
          ],
        },
        // Removed: an Angular-only "Usage Summary" section here (has_usage_
        // history/purchase_bill_count/expense_count/outstanding_amount/
        // total_spend) directly contradicted the prototype's own explicit,
        // repeated rule for this module — §2.3's "deliberately still no
        // totals and no charts — spend reporting belongs to Purchase Bill
        // and Expense," echoed verbatim in vendors.py's vendor_usage()
        // docstring ("no totals, no charts, ever"). Not a case of the
        // prototype's mock being simpler; it's a stated anti-goal this
        // rebuild removes rather than layers over.
      ],
    },
    // §2.3 Vendor Usage — "a tab or section on the vendor's own record, not
    // a separate standalone screen." Embeds the full real list (filters,
    // export, and the extra Mode/Paid-From/Paid-Into/Account-Number columns
    // the standalone §2.3 spec defines) rather than trimming down to the
    // prototype's own 5-column condensed mock preview (type/ref/date/amt/
    // status) — real, already-built, backend-wired capability, kept per the
    // same "don't remove real functionality" rule above.
    {
      kind: 'embed',
      id: 'usage',
      label: 'Usage',
      config: buildVendorUsageListConfig,
    },
  ],
};

export default config;
