import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { BankAccountRow } from '../masters.api';

// Order and labels from the prototype's own dropdown (app-forms.js:163);
// values from the DB CHECK ck_bank_accounts_type (0002_masters.py:384).
//
// NOT a real Masters lookup — this is a category tag only. grep across
// backend/app confirms nothing branches on account_type's value at all
// (masters_bank_accounts.py just stores and returns it); it is fixed at the
// DB layer by ck_bank_accounts_type CHECK (account_type IN ('CURRENT',
// 'SAVINGS')) and hand-duplicated in bank-accounts.list.config.ts's own copy
// of this same array. A company with an Overdraft, Cash Credit, or NRE/NRO
// account has no way to record it correctly. Fixing this for real means
// promoting Account Type to a seeded Masters lookup table (or at minimum
// dropping the CHECK constraint) and adding CRUD for it — a backend/schema
// change, not something this form config can drive on its own — so this
// stays a hardcoded pair until that lookup exists.
const ACCOUNT_TYPE_OPTIONS = [
  { value: 'CURRENT', label: 'Current' },
  { value: 'SAVINGS', label: 'Savings' },
];

const config: FormScreenConfig<BankAccountRow> = {
  shape: 'form',
  id: 'masters.bank_accounts',
  title: 'Bank Account',
  listEndpoint: '/masters/bank-accounts',
  createEndpoint: '/masters/bank-accounts',
  updateEndpoint: (id) => `/masters/bank-accounts/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/bank-accounts'],
  emptyRow: () => ({
    nickname: '',
    bank_name: '',
    account_holder_name: '',
    account_number: '',
    confirm_account_number: '',
    account_type: 'SAVINGS',
    ifsc: '',
    branch: '',
    upi_id: null,
    upi_qr_file_id: null,
    is_active: true,
  }),
  fields: [
    {
      key: 'nickname',
      label: 'Account Nickname',
      required: true,
      span: 2,
      placeholder: 'e.g. HDFC – Current Account',
      hint: 'Shown wherever the account is picked in a dropdown; must be unique (ux_bank_accounts_nickname)',
    },
    { key: 'bank_name', label: 'Bank Name', required: true, placeholder: 'e.g. HDFC Bank' },
    {
      key: 'account_holder_name',
      label: 'Account Holder Name',
      required: true,
      span: 2,
      hint: 'Normally the Company Legal Name from Company Profile',
    },
    {
      key: 'account_number',
      label: 'Account Number',
      required: true,
      hint: 'Numeric; checked for a plausible length of 9–18 digits',
      // Mirrors ck_bank_accounts_number (REGEXP '^[0-9]{9,18}$').
      pattern: { re: /^[0-9]{9,18}$/, message: 'Account Number must be 9–18 digits, numbers only' },
    },
    // A009: re-entered on every save, including edits that touch nothing
    // else — the real backend re-validates the match on every PUT, not
    // just create, and never returns this field to prefill it. The match
    // itself cannot be checked here (a `pattern` sees only its own value,
    // never the rest of the model), so the API's 422 is the only check.
    {
      key: 'confirm_account_number',
      label: 'Confirm Account Number',
      required: true,
      hint: 'Must match Account Number exactly; never stored as a separate value, and re-entered on every edit because the API re-checks it on PUT too',
      pattern: { re: /^[0-9]{9,18}$/, message: 'Confirm Account Number must be 9–18 digits, numbers only' },
    },
    { key: 'account_type', label: 'Account Type', type: 'select', staticOptions: ACCOUNT_TYPE_OPTIONS, required: true },
    {
      key: 'ifsc',
      label: 'IFSC Code',
      required: true,
      placeholder: 'e.g. HDFC0000521',
      hint: 'Exactly 11 characters — 4 letters, then 0, then 6 alphanumeric characters',
      // Mirrors ck_bank_accounts_ifsc (REGEXP '^[A-Z]{4}0[A-Z0-9]{6}$').
      pattern: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, message: 'IFSC must be 4 letters, then 0, then 6 alphanumeric characters' },
    },
    { key: 'branch', label: 'Branch', required: true, placeholder: 'e.g. T. Nagar' },
    {
      key: 'upi_id',
      label: 'UPI ID',
      placeholder: 'e.g. company@hdfcbank',
      hint: 'Optional',
    },
    {
      key: 'upi_qr_file_id',
      label: 'UPI QR Code',
      type: 'file',
      uploadPurpose: 'bank_upi_qr',
      fileAccept: 'image/jpeg,image/png',
      hint: 'Optional. JPEG or PNG, up to 2MB — shown to customers paying this account by UPI',
    },
    {
      // §3b — createOnly (BankAccountCreate, backend/app/schemas/masters.py),
      // settable only when adding a new account; PUT still excludes it, same
      // as Is Default below. Once a row exists, Status only moves through
      // POST /{id}/deactivate (Super Admin only) — there is still no
      // /activate for this bespoke router (its own list-config comment says
      // so explicitly: "there is no reactivate endpoint... cannot be undone
      // from this screen"), a deliberate stricter lifecycle than the generic
      // lookups get, not extended by this pass.
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: 'Defaults to Active. Uncheck to create this account already inactive.',
    },
  ],
  // One control from the prototype's pop-up is still deliberately absent
  // (Status and UPI QR Code are both built above, §3b/§5):
  //  - Is Default: not on BankAccountWrite/BankAccountUpdate/BankAccountCreate
  //    — create hardcodes is_default=False and the PUT excludes it on purpose
  //    ("those have their own dedicated endpoints with their own guard
  //    logic"). Set from the list screen's Set Default action, which performs
  //    the one-default swap — a second path to the same field via this form
  //    would race it. Not the same class of gap as Status: this one's
  //    exclusion is correct by design, not a missing capability.
};

export default config;
