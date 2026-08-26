import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { BankAccountRow } from '../masters.api';

// Verbatim from the DB CHECK ck_bank_accounts_type (0002_masters.py:384) —
// 'CURRENT'/'SAVINGS', in the prototype's own option order (app-forms.js:163).
const ACCOUNT_TYPE_OPTIONS = [
  { value: 'CURRENT', label: 'Current' },
  { value: 'SAVINGS', label: 'Savings' },
];

// Masters §3.7 Screen Design: "List view shows … masked Account Number (e.g.
// ****4321)", and the build note is explicit that "the masked account number
// is a frontend display concern — the API and the PDF/Excel export return the
// full account number to the (Super Admin only) caller." So this is the ONE
// column where the export deliberately carries more than the screen shows.
function maskedAccountNumber(row: BankAccountRow): string {
  const raw = row.account_number ? String(row.account_number) : '';
  return raw.length > 4 ? `••••${raw.slice(-4)}` : raw;
}

const config: ListScreenConfig<BankAccountRow> = {
  shape: 'list',
  id: 'masters.bank_accounts',
  title: 'Bank Account',
  specRef: '§3.7',
  recordNoun: 'bank account',
  description:
    "The company's own accounts — entirely separate from a vendor's own account. Exactly one account can be Default at a time.",
  endpoint: '/masters/bank-accounts',
  // list_bank_accounts (masters_bank_accounts.py:62) accepts exactly one Query
  // param: format. No ?search=, no ?include_inactive=, no per-field filters —
  // its own export comment says so ("this list has no query filters of its
  // own, so filters_applied is empty"). Export is therefore real, but every
  // filter below has to be client-side.
  exportable: true,
  searchParam: false,
  // §3.0's "that sub-master's name and code fields": nickname is the name,
  // ifsc and the account number are the code-like identifiers someone actually
  // types when hunting for an account.
  searchFields: ['nickname', 'bank_name', 'ifsc', 'account_number'],
  includeInactiveParam: false,
  filters: [
    {
      // Client: the endpoint has no such param (see above). Same for all four.
      key: 'account_type',
      label: 'Account Type',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Account Types',
      options: ACCOUNT_TYPE_OPTIONS,
      predicate: (row, v) => row.account_type === v,
    },
    {
      key: 'is_default',
      label: 'Default',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Default — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_default : !row.is_default),
    },
    {
      // The prototype's "Used — Any" tri-state, and here it maps onto a real
      // response field: BankAccountOut.is_referenced (masters_bank_accounts.py:42
      // — computed from Expense Types' default_bank_account_id today, a real
      // but partial signal until the payment screens feed it too).
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Used — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_referenced : !row.is_referenced),
    },
    {
      // Masters §3.0's Active-by-default rule. The store's own Show-inactive
      // toggle needs an include_inactive param and this endpoint has none, so
      // it is honoured as a defaulted client filter. Consequence worth knowing:
      // because this is engaged by default and cannot round-trip, Export always
      // warns that the file will hold more rows than the screen — which is
      // true, the export returns inactive accounts too.
      key: 'is_active',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'client',
      allLabel: 'All Statuses',
      defaultValue: 'active',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
      predicate: (row, v) => (v === 'active' ? !!row.is_active : !row.is_active),
    },
  ],
  // Column set and headers mirror _LIST_COLUMNS in masters_bank_accounts.py:27
  // one-for-one, so the exported PDF/Excel and the screen are the same table
  // (RBAC §2.2f) rather than two different views of one endpoint.
  columns: [
    { key: 'nickname', header: 'Nickname', cellClass: 'cell-strong' },
    { key: 'bank_name', header: 'Bank Name' },
    { key: 'account_holder_name', header: 'Account Holder Name' },
    { key: 'account_number', header: 'Account Number', cellClass: 'mono', compute: maskedAccountNumber },
    { key: 'account_type', header: 'Account Type', staticOptions: ACCOUNT_TYPE_OPTIONS },
    { key: 'ifsc', header: 'IFSC', type: 'code' },
    { key: 'branch', header: 'Branch' },
    { key: 'upi_id', header: 'UPI ID', cellClass: 'mono' },
    { key: 'is_default', header: 'Default', type: 'status' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Referenced', type: 'status' },
  ],
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/bank-accounts', row.id, 'edit'],
  createRoute: ['/masters/bank-accounts', 'new'],
  createLabel: 'Add Bank Account',
  rowActions: [
    {
      label: 'Set Default',
      endpoint: (row) => `/masters/bank-accounts/${row.id}/set-default`,
      // set_default is gated on action="edit" (masters_bank_accounts.py:169),
      // unlike the two below — this is a normal edit, not a lifecycle change.
      screenAction: 'edit',
      // An inactive account must never become the one pre-selected on every
      // Invoice/Expense/Purchase Bill payment form.
      visible: (row) => !row.is_default && row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/bank-accounts/${row.id}/deactivate`,
      // Masters §3.0 rule 1 — Deactivate is Super Admin only, and the API
      // agrees: deactivate is require_screen(SCREEN, action="delete").
      screenAction: 'delete',
      // Hidden on the Default account because the API refuses outright (409,
      // backed by trg_bank_accounts_reject_deactivate_default) rather than
      // asking for confirmation — §3.7's build note calls this out as stricter
      // than the pop-up the Screen Design describes.
      visible: (row) => row.is_active && !row.is_default,
      confirm:
        'Deactivate this bank account? It stops being offered on new Invoice / Expense / Purchase Bill payments, records that already reference it keep it, and there is no reactivate endpoint — this cannot be undone from this screen.',
    },
    {
      label: 'Delete',
      endpoint: (row) => `/masters/bank-accounts/${row.id}`,
      // A real hard DELETE (masters_bank_accounts.py:213) — the half of Masters
      // §3.0's two-tier lifecycle for a row nothing references yet.
      method: 'DELETE',
      screenAction: 'delete',
      // is_referenced is the server's own "already used in past transactions"
      // signal; the DELETE 409s on any remaining FK anyway (ON DELETE RESTRICT),
      // so this hides the button in the case we can already see is hopeless.
      visible: (row) => !row.is_referenced && !row.is_default,
      confirm:
        'Permanently delete this bank account? This is only possible while nothing references it — if any expense type or payment record still points at it the server will refuse, and Deactivate is the right action instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No bank accounts configured yet.',
};

export default config;
