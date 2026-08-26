import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { ExpenseTypeRow } from '../masters.api';

const CLAIM_TYPE_OPTIONS = [
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
  { value: 'COMPANY_PAID', label: 'Company-Paid' },
];

// §3.3's Fields Table sources Default Bank Account from Company Profile
// (§3.7 — the Bank Accounts sub-master). Its rows are identified by
// `nickname`, not `name`, so the labelKey has to be spelled out or every
// option would render as "undefined".
const BANK_ACCOUNT_REF = { endpoint: '/masters/bank-accounts', labelKey: 'nickname' };

const config: FormScreenConfig<ExpenseTypeRow> = {
  shape: 'form',
  id: 'masters.expense_types',
  title: 'Expense Type',
  listEndpoint: '/masters/expense-types',
  createEndpoint: '/masters/expense-types',
  updateEndpoint: (id) => `/masters/expense-types/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/expense-types'],
  emptyRow: () => ({
    name: '',
    short_code: null,
    claim_type: 'REIMBURSABLE',
    is_recurring: false,
    default_bank_account_id: null,
    description: null,
    is_active: true,
  }),
  // §3b built Status as `createOnly` (masters_lookup.py's
  // create_only_fields) rather than the prototype's shared Add/Edit toggle —
  // reproducing THAT here would also hand Manager (who has 'edit' on this
  // screen per §3.3 Role Access) the same toggle, breaching §3.0 rule 1
  // ("even on a sub-master they are allowed to add to or edit"). createOnly
  // gives Super Admin the create-inactive capability without that leak:
  // settable only when adding a new type; once a row exists, Status only
  // moves through the list screen's Super-Admin-only Deactivate/Activate row
  // actions (both real now — masters_lookup.py's factory always wires
  // POST /{id}/activate alongside /deactivate, unconditionally).
  fields: [
    {
      key: 'name',
      label: 'Expense Type Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Travel, Snacks, Internet / Wi-Fi, Office Rent',
      hint: 'Must be unique',
    },
    {
      key: 'short_code',
      label: 'Short Code',
      placeholder: 'e.g. TRV, NET',
      hint: 'Used in compact views and on the bank-statement export',
    },
    // Masters §3.3: changing this on a type already in use applies from this
    // point forward only — the backend's before_write hook stamps the audit
    // trail (previous_claim_type/claim_type_changed_at) automatically.
    {
      key: 'claim_type',
      label: 'Claim Type',
      type: 'select',
      required: true,
      staticOptions: CLAIM_TYPE_OPTIONS,
      hint: 'Decides who may raise this expense and what happens at the end. Reimbursable — an employee paid out of their own pocket; every role can raise it and it ends in a payout to that person. Company-Paid — the company was billed directly (Wi-Fi, electricity, office rent, cloud hosting); only Super Admin and Accountant can raise it, nobody is owed a reimbursement, and it is settled straight from a company bank account.',
    },
    {
      key: 'is_recurring',
      label: 'Recurring',
      type: 'checkbox',
      hint: 'Turn on for a standing monthly bill — Wi-Fi, rent, hosting. It changes no approval behaviour; it lets Accounts filter expected bills apart from one-off spend, and makes a month where an expected bill never arrived visible as an absence.',
    },
    {
      // Was missing entirely, though it is a real writable field on the API
      // (masters_simple.py:66) and a row in §3.3's Fields Table. The lookup
      // returns every bank account, active or not — RefLookup has no way to
      // ask for the Active-only subset §3.3 specifies.
      key: 'default_bank_account_id',
      label: 'Default Bank Account',
      type: 'select',
      ref: BANK_ACCOUNT_REF,
      hint: 'Optional. Pre-selects the account on Add Expense for this type, for the common case where a given bill always leaves the same account. Still editable on the expense itself.',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      span: 2,
      placeholder: 'Optional clarifying note',
    },
    {
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: "Defaults to Active. Uncheck to create this expense type already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
