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

/** Masters §3.3: "Changing Claim Type on a type already in use is not a silent
 * edit. It re-routes every future expense of that type, and would strand
 * existing rows on the wrong screen. It warns explicitly, names how many
 * records already use the type, and leaves those records where they are — the
 * change applies from that point forward, never retroactively."
 *
 * Nothing on this form said any of that. §3.3's own implementation note listed
 * the warning as frontend/deferred alongside the Claim Type / Recurring / Used
 * list filters; the filters were built in a later pass, this half was not.
 * `previewFields` is the only hook a form config has for a read-only line
 * recomputed on every model change (FormScreenConfig.previewFields), so the
 * warning renders there — on screen, next to the Claim Type select, before
 * Save is ever pressed.
 *
 * In-use is stated as yes/no rather than as the count §3.3 asks for, because a
 * count is the one part this API cannot honestly supply. `is_referenced` is a
 * live query over the two tables that carry an expense_type_id
 * (masters_simple.py:106); `usage_count`, the column that would hold the
 * number, is never incremented by anything in this codebase, so printing it
 * would claim "0 records" for a type five expense claims already name. */
function claimTypeChangeImpact(model: Partial<ExpenseTypeRow>): string {
  const m = model as Record<string, unknown>;
  if (!m['id']) {
    return 'New expense type — nothing references it yet, so Claim Type applies from its very first expense.';
  }
  if (!m['is_referenced']) {
    return 'No expense record uses this type yet, so changing Claim Type re-routes nothing that already exists.';
  }
  return (
    'In use: expense records already reference this type. Changing Claim Type re-routes every FUTURE expense ' +
    'of this type — Reimbursable ones into the reimbursement queue, Company-Paid ones straight to Company ' +
    'Expenses — and is never retroactive: the expenses already filed stay exactly where they are.'
  );
}

/** The other half of §3.3's warning, and the reason the API stamps it: the
 * before-write hook records `previous_claim_type` / `claim_type_changed_at`
 * whenever Claim Type changes on an existing row — "the audit trail behind the
 * warning", in §3.3's own words. It was stored and returned but rendered on no
 * screen, so the one question the warning provokes ("has someone already
 * switched this?") had no answer anywhere in the UI. */
function claimTypeHistory(model: Partial<ExpenseTypeRow>): string {
  const m = model as Record<string, unknown>;
  if (!m['id']) return 'Not applicable while adding a new type.';
  const previous = m['previous_claim_type'];
  const changedAt = m['claim_type_changed_at'];
  if (!previous && !changedAt) return 'Never changed since this type was created.';
  const label = CLAIM_TYPE_OPTIONS.find((o) => o.value === String(previous))?.label ?? String(previous ?? '—');
  // Rendered straight from the stored UTC timestamp in the same dd-mm-yyyy
  // shape the rest of Masters uses, with no local-timezone shifting, so the
  // line agrees with the server's own record of when it happened.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(changedAt ?? ''));
  const when = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : String(changedAt ?? 'an unrecorded date');
  return `Changed from ${label} on ${when}. Expenses filed before then kept the old routing.`;
}

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
  previewFields: [
    { label: 'Changing Claim Type — what it affects', compute: claimTypeChangeImpact },
    { label: 'Claim Type last changed', compute: claimTypeHistory },
  ],
};

export default config;
