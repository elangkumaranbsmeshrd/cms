import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { ExpenseTypeRow } from '../masters.api';

// `is_referenced` really is on every row of the live response: this
// sub-master registers `referenced_by=[(ExpenseClaim, 'expense_type_id'),
// (CompanyExpense, 'expense_type_id')]` (masters_simple.py:106), which is
// what turns the field on in the factory's generated `out_schema`
// (masters_lookup.py:316). ExpenseTypeRow in masters.api.ts declares the
// three `read_only_fields` but not this one (that file is shared by every
// Masters screen and belongs to another owner this pass), so it's declared
// locally rather than dropped — without it the "Used" column and its
// "Used — Any" filter have no truthful source.
type ExpenseTypeListRow = ExpenseTypeRow & { is_referenced?: boolean };

// Masters §3.3's own wording. The backend stores the raw enum
// (REIMBURSABLE | COMPANY_PAID — masters_simple.py:64), so the same list backs
// both the column's staticOptions and the filter's options; one source keeps
// the chip text and the cell text from drifting apart.
const CLAIM_TYPE_OPTIONS = [
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
  { value: 'COMPANY_PAID', label: 'Company-Paid' },
];

/** §3.3 "Used" — answered by `is_referenced`, a live query against the two
 * tables that really carry an `expense_type_id` (masters_lookup.py's
 * `_referenced_ids`), NOT by the `usage_count` column this column and filter
 * used to read.
 *
 * `usage_count` is a stored counter that nothing in this codebase ever
 * increments — grep `usage_count` across app/: ExpenseType's copy is declared
 * (models/masters.py:64), exposed as a read-only field, and left at 0 forever,
 * because the increment would have to happen in the CONSUMING module and never
 * was written. The visible consequence was concrete: "Travel" is named by 5
 * expense_claims rows, yet the list showed Used = No and therefore offered a
 * Delete button the database's ON DELETE RESTRICT answers with a 409 — while
 * the PDF/Excel export of the very same screen printed Used = Yes for it,
 * since masters_lookup.py:417 has always built the export column from
 * `is_referenced`. Screen and export now agree, and both are right. */
function isUsed(row: ExpenseTypeListRow): boolean {
  return !!row.is_referenced;
}

const config: ListScreenConfig<ExpenseTypeListRow> = {
  shape: 'list',
  id: 'masters.expense_types',
  title: 'Expense Types',
  specRef: '§3.3',
  recordNoun: 'expense type',
  description:
    "Manager can add and edit; Delete and Deactivate stay Super Admin only, as on every sub-master. Claim Type is the field that decides who may raise the expense: Reimbursable types are open to every employee and end in a payout to that person; Company-Paid types (Wi-Fi, rent, hosting) are the company's own running bills, are raised only by Super Admin or Accountant, and never enter the reimbursement queue.",
  endpoint: '/masters/expense-types',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/expense-types', row.id, 'edit'],
  createRoute: ['/masters/expense-types', 'new'],
  createLabel: 'Add Expense Type',
  // masters_lookup.py's list_rows takes exactly three query params —
  // search, include_inactive, format — so these two are the ONLY dimensions
  // that can round-trip; everything below is client transport by necessity.
  searchParam: 'search',
  // §3.0: "Search, across that sub-master's name and code fields."
  searchFields: ['name', 'short_code'],
  // This IS the prototype's Status filter (['Active','Inactive','All
  // Statuses']) — the shared component renders it as the "Show inactive"
  // toggle, and because it's a real query param the export stays exact.
  // A second Status select would duplicate it and could only be client-side.
  includeInactiveParam: 'include_inactive',
  filters: [
    {
      // Client transport: list_rows has no ?claim_type= param at all. Sending
      // one would be silently ignored and the chip would lie about the rows.
      key: 'claim_type',
      label: 'Claim Type',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Claim Types',
      options: CLAIM_TYPE_OPTIONS,
      predicate: (row, v) => row.claim_type === String(v),
    },
    {
      // Client transport: no ?is_recurring= param on the lookup factory.
      key: 'is_recurring',
      label: 'Recurring',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Recurring — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_recurring : !row.is_recurring),
    },
    {
      // Server transport, same as Payment Mode's. `?is_referenced=` is a real,
      // APPLIED query param on this endpoint (masters_lookup.py:371, :405-406)
      // — it is only inert on lookups registered without `referenced_by`, and
      // this one passes both of its real FK consumers. Filtering server-side
      // also makes the export exact: `?format=pdf|excel` re-runs the same
      // filter rather than exporting rows the screen had already hidden.
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'server',
      param: 'is_referenced',
      allLabel: 'Used — Any',
    },
  ],
  columns: [
    { key: 'name', header: 'Expense Type', cellClass: 'cell-strong' },
    { key: 'short_code', header: 'Code', type: 'code' },
    // The prototype's own column type for this one (data.js:1513 —
    // `{ k: 'kind', t: 'Claim Type', type: 'chip' }`). ColumnType gained
    // 'chip' since this config was first written, and it is a different thing
    // from 'status': the chip renders `badge-s b-neutral plain`, whose CSS
    // suppresses the leading status dot (components.css:335) precisely because
    // Reimbursable/Company-Paid is a classification, not a state to watch.
    // staticOptions still map the raw enum to its label (list-screen's
    // display() applies them for every column type).
    { key: 'claim_type', header: 'Claim Type', type: 'chip', staticOptions: CLAIM_TYPE_OPTIONS },
    { key: 'is_recurring', header: 'Recurring', type: 'status' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'is_referenced', header: 'Used', type: 'status' },
  ],
  // §3.0 rule 1 / §3.3 Role Access: "Manager: add and edit only — delete/
  // deactivate stays with Super Admin". Both actions are gated on the same
  // 'delete' RBAC action the API itself requires (masters_lookup.py:245, :265),
  // so a Manager never sees either button.
  rowActions: [
    {
      // §3b — masters_lookup.py's factory always wires POST /{id}/activate
      // alongside /deactivate; this screen never had the row action for it.
      label: 'Activate',
      endpoint: (row) => `/masters/expense-types/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/expense-types/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm:
        'Deactivating hides this expense type from every new expense entry. Existing expenses already filed under it are untouched. Continue?',
    },
    {
      // §3.3 Status & Deletion Rule: "Never hard-deleted once used on any
      // Expense record" — so the button only appears while nothing references
      // the row. Now that isUsed() reads `is_referenced` rather than the dead
      // `usage_count` counter, this genuinely predicts whether the DELETE will
      // succeed; the database's ON DELETE RESTRICT keys are still the real
      // guard (a referenced row comes back as a 409, not a 500).
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/expense-types/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !isUsed(row),
      confirm:
        'Delete this expense type permanently? This is only possible while nothing references it — if any expense already uses it the server will refuse, and you should deactivate it instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No expense types configured.',
};

export default config;
