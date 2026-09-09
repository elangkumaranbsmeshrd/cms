import { SingletonFormConfig } from '../../../shared/screens/screen.types';
import { CompanyProfileRow } from '../masters.api';

// company_profile.company_type is a plain VARCHAR(60) with no CHECK constraint
// (0002_masters.py:686), so this list is the spec's own (Masters §3.6a: "e.g.
// One Person Company (OPC), Private Limited, LLP, Partnership, Proprietorship")
// plus Public Limited, rather than something the database dictates.
// ONE_PERSON_COMPANY was missing entirely — a genuine OPC could not describe
// itself on its own profile.
//
// QUEUED / NOT BUILT — this SHOULD be a `ref`-backed dynamic list (the same
// `{ key, type: 'select', ref: { endpoint } }` shape customer.record.config.ts
// uses for status_id/source_id) rather than `staticOptions`, per §6: nothing
// stops the column from holding 'Section 8 Company', 'HUF', 'Trust', or
// 'Cooperative Society' next year, and Super Admin has no way to add a
// seventh value without a source change. Not fixed here because the source
// doesn't exist yet: masters_lookup.py's `build_lookup_router` factory backs
// exactly 15 named sub-masters (masters_lookup.py:1-7) and Company Type is
// not one of them — there is no `company_types` table, no
// GET/POST /masters/company-types route, nothing to point a `ref` at. Adding
// this list as a 16th factory-built sub-master (or a small dedicated dynamic
// list under Company Profile) is a backend change first; once that endpoint
// exists, swap `staticOptions: COMPANY_TYPE_OPTIONS` below for
// `ref: { endpoint: '/masters/company-types' }` and this array can go away.
const COMPANY_TYPE_OPTIONS = [
  { value: 'PRIVATE_LIMITED', label: 'Private Limited' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited' },
  { value: 'ONE_PERSON_COMPANY', label: 'One Person Company (OPC)' },
  { value: 'LLP', label: 'LLP' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'PROPRIETORSHIP', label: 'Proprietorship' },
];

// ck_cp_payroll_basis (0004_payroll.py:846) allows exactly these two. Only
// HOUR_BASIS is implemented end-to-end — Masters §3.6a's own note and Run
// Payroll, which 409s under any other basis — so the second option is offered
// with that stated rather than hidden, since the column genuinely accepts it.
const PAYROLL_BASIS_OPTIONS = [
  { value: 'HOUR_BASIS', label: 'Hour Basis' },
  { value: 'DAY_BASIS', label: 'Day Basis (stored only — no payroll engine behind it)' },
];

// §3.6a is explicit that Default Billing Tax is a "Dropdown (from Taxes,
// Section 3.2 — **Sales/Billing scope heads only**)". The bare
// /masters/taxes/options returns every active head of every scope, so this
// dropdown was offering payroll deductions, employee-declaration heads and
// withholding heads as a company's default OUTPUT tax — values the field is
// specified never to hold. `scope` and `in_force_on` are real query params on
// that endpoint (masters_taxes.list_tax_head_options), and this is the same
// narrowing hsn-sac-codes.form.config.ts already applies for the same reason:
// an option that contradicts the field's own definition is worse than no
// option. SALES_AND_PURCHASE is included because a head scoped to both is a
// billing head too — it is exactly what an invoice charges.
//
// `in_force_on` resolves when this lazily-loaded module is first imported, not
// per render (RefLookup carries a plain endpoint string and RefDataService
// caches one response per endpoint) — verbatim the trade-off documented on the
// HSN/SAC lookup: a session left open across midnight keeps the previous day's
// list until the next navigation, and a head that expired in the meantime is
// still rejected on save by the server.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const BILLING_TAX_REF = {
  endpoint: `/masters/taxes/options?scope=SALES_BILLING&scope=SALES_AND_PURCHASE&in_force_on=${todayIso()}`,
  labelKey: 'label',
};

// Exported so company-profile.documents.singleton.config.ts (§5) can seed the
// SAME defaults. Both tabs are independent SingletonFormComponent instances
// pointed at the one /masters/company-profile resource (TabbedScreenComponent
// mounts only the active tab, so their formModel/exists state never
// collides) — but each always submits its OWN full formModel on Save. If the
// Documents tab is opened before General Info has ever been filled in, Save
// there still POSTs a full, valid-shaped (if mostly blank) CompanyProfileWrite
// — the same 422s General Info's own blank Save would hit, not a different,
// more confusing failure from a second, drifted set of defaults.
export function emptyCompanyProfileRow(): Partial<CompanyProfileRow> {
  return {
    legal_name: '',
    cin: '',
    tan: null,
    gstin: null,
    pan: '',
    company_type: 'PRIVATE_LIMITED',
    year_of_incorporation: new Date().getFullYear(),
    industry: null,
    msme_registration_number: null,
    phone: '',
    alternate_phone: null,
    official_email: '',
    support_email: null,
    website: null,
    default_billing_tax_head_id: null,
    payroll_basis: 'HOUR_BASIS',
    biometric_attendance: false,
    biometric_device_endpoint: null,
  };
}

const config: SingletonFormConfig<CompanyProfileRow> = {
  shape: 'singleton',
  id: 'masters.company_profile',
  title: 'Company Profile',
  // §3.6: "General Info shows a single form with a 'Save Changes' button." This
  // screen edits a profile that already exists, so the generic 'Save' read as
  // if it were creating one.
  submitLabel: 'Save Changes',
  loadEndpoint: '/masters/company-profile',
  createEndpoint: '/masters/company-profile',
  updateEndpoint: '/masters/company-profile',
  emptyRow: emptyCompanyProfileRow,
  // Mandatory/hint text follows Masters §3.6a's Fields Table and the
  // prototype's General Info tab (app-screens2.js:680-700); every `pattern`
  // below transcribes a real DB CHECK on company_profile rather than a
  // plausible-looking regex.
  fields: [
    { key: 'legal_name', label: 'Company Legal Name', required: true, span: 2, hint: 'Printed on every generated document — invoices, payslips, letters' },
    { key: 'company_type', label: 'Company Type', type: 'select', staticOptions: COMPANY_TYPE_OPTIONS, required: true },
    { key: 'cin', label: 'CIN', required: true, hint: 'Corporate Identification Number' },
    {
      key: 'pan',
      label: 'PAN',
      required: true,
      hint: 'Exactly 10 characters — five letters, four digits, one letter',
      pattern: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'PAN must be 5 letters, 4 digits, then 1 letter' }, // ck_cp_pan
    },
    {
      key: 'tan',
      label: 'TAN',
      hint: 'Tax Deduction Account Number. Optional — a company not registered for a given levy must still be able to save its profile',
    },
    {
      key: 'gstin',
      label: 'GSTIN',
      hint: 'Optional. Exactly 15 characters: 2-digit state code, 10-character PAN, entity number, Z, checksum',
      // ck_cp_gstin, and the same GSTIN_PATTERN the API validates with
      // (app/schemas/masters.py:13) — checked in three places, deliberately.
      pattern: {
        re: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
        message: 'GSTIN is not a valid 15-character GSTIN',
      },
    },
    {
      key: 'year_of_incorporation',
      label: 'Year of Incorporation',
      type: 'number',
      required: true,
      hint: '4-digit year', // ck_cp_year: between 1850 and 2200
    },
    { key: 'industry', label: 'Industry / Business Type', hint: 'Free text, e.g. "IT & IoT Services"' },
    { key: 'msme_registration_number', label: 'MSME Registration Number' },
    {
      key: 'phone',
      label: 'Phone Number',
      required: true,
      placeholder: '9876543210',
      hint: 'Exactly 10 digits, no spaces or country code',
      pattern: { re: /^[0-9]{10}$/, message: 'Phone Number must be exactly 10 digits' }, // ck_cp_phone
    },
    {
      key: 'alternate_phone',
      label: 'Alternate Phone',
      hint: 'Optional. Exactly 10 digits, no spaces or country code',
      pattern: { re: /^[0-9]{10}$/, message: 'Alternate Phone must be exactly 10 digits' }, // ck_cp_alt_phone
    },
    { key: 'official_email', label: 'Official Email', type: 'email', required: true, hint: 'Standard email format' },
    { key: 'support_email', label: 'Support Email', type: 'email', hint: 'Optional. Standard email format' },
    {
      key: 'website',
      label: 'Website',
      hint: 'Must start with http:// or https://',
      pattern: { re: /^https?:\/\//, message: 'Website must start with http:// or https://' }, // ck_cp_website
    },
    {
      // Real, writable FK (app/schemas/masters.py CompanyProfileWrite ->
      // default_billing_tax_head_id) declared on CompanyProfileRow — same
      // `ref` shape hsn-sac-codes.form.config.ts's Linked Tax field uses,
      // narrowed server-side to §3.6a's "Sales/Billing scope heads only" (see
      // BILLING_TAX_REF above), which is also what the prototype's own General
      // Info tab filters this list to (app-screens2.js:699).
      key: 'default_billing_tax_head_id',
      label: 'Default Billing Tax',
      type: 'select',
      ref: BILLING_TAX_REF,
      hint: 'Every in-force Sales/Billing tax head from Masters → Taxes — only the starting suggestion pre-filled on a new Invoice or Quote, never a lock; changed per document any time. Optional — a company with none configured can still save this profile.',
    },
    {
      key: 'payroll_basis',
      label: 'Payroll Basis',
      type: 'select',
      staticOptions: PAYROLL_BASIS_OPTIONS,
      required: true,
      hint: 'Read by Run Payroll. Only Hour Basis is implemented end-to-end — required hours come from Masters → Work Week & Hours (§3.20), worked hours from Attendance. A run under any other basis is rejected with a 409.',
    },
    // §3.6, "New in this revision". An input-source gate, not a calculation
    // setting: switching it never alters attendance already recorded and never
    // changes how hours are computed. Off is the default because §3.6 defines
    // Off as an active refusal — "any inbound device payload is rejected", and
    // Payroll → Attendance's Biometric Feed tab shows the integration as
    // available-but-inactive rather than pretending a device exists.
    {
      key: 'biometric_attendance',
      label: 'Biometric Attendance',
      type: 'checkbox',
      required: true,
      hint: 'Off — manual entry is the only way attendance gets recorded, and any inbound device payload is rejected. On — a device or external feed may write to the same attendance fields manual entry writes to. Switching this never changes attendance already recorded, and never changes how hours are calculated.',
    },
    {
      key: 'biometric_device_endpoint',
      label: 'Biometric Device Endpoint / Reference',
      type: 'text',
      // §3.6 makes this conditional, not optional: required once the toggle is
      // On. The server enforces the same rule (CompanyProfileWrite's own
      // validator), so a form bypass cannot save an On toggle with no source.
      visibleWhen: (m) => !!m['biometric_attendance'],
      hint: 'Where the feed comes from — a device, an HR system, or a mobile check-in service. Recorded so the source of an attendance record stays auditable.',
    },
  ],
  // Two things Masters §3.6a's Fields Table and the prototype's General Info
  // tab carry that are still NOT bindable here (Default Billing Tax used to
  // be a third — it's a real field above now; Logo/Letterhead Template used
  // to be a fourth — built, but as the Documents tab's own fields,
  // company-profile.documents.singleton.config.ts, §5, not here: General
  // Info stays the identity/registration fields only, matching the
  // prototype's own tab split):
  //  - Registered Address (Primary): a read-only summary the spec derives
  //    from whichever Addresses row is is_primary (app-screens2.js:696,
  //    ro:1 lock:'From Addresses'). It is not a field on the profile response
  //    at all, and — now that sub-resources are TABS, not "→" nav links —
  //    Addresses is a sibling tab on company-profile.tabbed.config.ts, not
  //    something this file links to either. Showing the derived value on
  //    General Info needs a new SingletonFormConfig capability (a read-only
  //    field sourced from a secondary GET — fetch
  //    /masters/company-profile/addresses, find is_primary=true — distinct
  //    from FieldConfig.compute, which SingletonFormComponent's template
  //    never actually reads) plus render support in
  //    singleton-form.component.ts. Both are shared framework files, not this
  //    one, so it's out of scope for a one-file fix.
  //  - Display Name: prototype-only. No column, no schema field, nothing to
  //    persist it to.
};

export default config;
