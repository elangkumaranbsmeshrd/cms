import { FieldConfig, FormScreenConfig } from '../../../shared/screens/screen.types';
import { CUSTOMER_OWNER_REF, CUSTOMER_SOURCE_REF, CUSTOMER_STATUS_REF, CustomerRow } from '../customer.api';

// §2.2 Add / Edit Customer — reached from the Directory's "+ Add Customer"
// and from Customer 360's "Edit" action alike (customer.routes.ts's own
// 'customers/new' and 'customers/:id/edit' both point here, same convention
// opportunity.form.config.ts/opportunity.routes.ts already use).
//
// Customer Code is deliberately NOT a field here: it is server-generated on
// create (allocate_number(db, "CUST", ...) in create_customer,
// api/v1/customers.py) and is not part of CustomerWrite at all — there is
// nothing to submit and, unlike Financial Year's Label/End Date
// (financial-years.form.config.ts's own previewFields), nothing the client
// can correctly compute in advance to preview either (the real value depends
// on server-side sequence state at save time). It is already shown
// prominently once the record exists — the 360 header's rec-id and the
// Overview tab's own Customer Code field (customer.record.component.ts).
//
// "Bank Details" is a real, genuine addition beyond the prototype's own Add/
// Edit Customer popup (app-screens.js:239-260, which has no bank fields at
// all): bank_account_name/bank_name/bank_account_number were added to
// CustomerWrite on 2026-07-31 (see customer.py's own comment) after that
// part of the prototype was last touched — the Directory (§2.1) already
// lists "Customer Bank Account Name"/"Account Number" as real columns, so
// without an editable surface here those columns could never be populated
// by anyone. collected_into_bank_account_id stays OUT of this form — it is
// on CustomerOut only, never CustomerWrite, i.e. system-derived, not
// user-set.
const fields: readonly FieldConfig<CustomerRow>[] = [
  { key: 'company_name', label: 'Company Name', required: true, span: 2, section: 'Company', hint: '2–200 characters' },
  { key: 'display_name', label: 'Display Name', section: 'Company', hint: 'Defaults to Company Name if left blank' },
  { key: 'gstin', label: 'GSTIN', section: 'Company', hint: 'Exactly 15 characters, auto-uppercased', pattern: { re: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, message: 'Invalid GSTIN format' } },
  { key: 'pan', label: 'PAN', section: 'Company', hint: 'Exactly 10 characters', pattern: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: '5 letters, 4 digits, 1 letter — e.g. AAAAA9999A' } },
  { key: 'status_id', label: 'Status', type: 'select', required: true, ref: CUSTOMER_STATUS_REF, section: 'Company', hint: 'From Masters → Customer Status' },
  { key: 'source_id', label: 'Source', type: 'select', ref: CUSTOMER_SOURCE_REF, section: 'Company', hint: 'From Masters → Customer Source (Section 3.16) — where this customer first came from' },
  { key: 'owner_id', label: 'Owner', type: 'select', ref: CUSTOMER_OWNER_REF, section: 'Company' },

  { key: 'mobile_number', label: 'Mobile Number', section: 'Contact', hint: '10-digit Indian mobile number', pattern: { re: /^[0-9]{10}$/, message: 'Mobile Number must be exactly 10 digits' } },
  { key: 'email', label: 'Email', type: 'email', section: 'Contact' },
  { key: 'website', label: 'Website', section: 'Contact', hint: 'Must start with http:// or https://', pattern: { re: /^https?:\/\//, message: 'Website must start with http:// or https://' } },
  { key: 'address', label: 'Address', type: 'textarea', span: 2, section: 'Contact' },
  { key: 'notes', label: 'Notes', type: 'textarea', span: 2, section: 'Contact' },

  { key: 'bank_account_name', label: 'Bank Account Name', section: 'Bank Details' },
  { key: 'bank_name', label: 'Bank', section: 'Bank Details' },
  { key: 'bank_account_number', label: 'Account Number', section: 'Bank Details', hint: '9–18 digits, numbers only', pattern: { re: /^[0-9]{9,18}$/, message: 'Account Number must be 9–18 digits, numbers only' } },
];

const config: FormScreenConfig<CustomerRow> = {
  shape: 'form',
  id: 'customer.directory',
  title: 'Customer',
  listEndpoint: '/customers',
  createEndpoint: '/customers',
  updateEndpoint: (id) => `/customers/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/customers'],
  recordLabel: (row) => row.company_name,
  emptyRow: () => ({
    company_name: '',
    display_name: null,
    gstin: null,
    pan: null,
    status_id: '',
    source_id: null,
    website: null,
    notes: null,
    mobile_number: null,
    email: null,
    address: null,
    owner_id: null,
    bank_account_name: null,
    bank_name: null,
    bank_account_number: null,
  }),
  fields,
  // Lands a newly created Customer straight on its own 360 record rather
  // than back on the Directory table — same reasoning/precedent as
  // opportunity.form.config.ts's own onCreateSuccess. Edit-mode saves always
  // return to listRoute regardless (form-screen.component.ts's save(): "
  // onCreateSuccess only ever applies to the CREATE branch").
  onCreateSuccess: (response) => ['/customers', response.id],
};

export default config;
