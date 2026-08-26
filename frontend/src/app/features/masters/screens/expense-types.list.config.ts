import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { ExpenseTypeRow } from '../masters.api';

// `usage_count` really is on every row of the live response: masters_simple.py
// passes it (with claim_type_changed_at / previous_claim_type) as one of the
// factory's `read_only_fields`, and masters_lookup.py folds read_only_fields
// into the generated `out_schema`. ExpenseTypeRow in masters.api.ts doesn't
// declare it yet (that file belongs to another owner this pass), so it's
// declared locally instead of dropped — without it the prototype's "Used"
// column and its "Used — Any" filter would have no honest source and would
// have had to be skipped.
type ExpenseTypeListRow = ExpenseTypeRow & { usage_count?: number };

// Masters §3.3's own wording. The backend stores the raw enum
// (REIMBURSABLE | COMPANY_PAID — masters_simple.py:64), so the same list backs
// both the column's staticOptions and the filter's options; one source keeps
// the chip text and the cell text from drifting apart.
const CLAIM_TYPE_OPTIONS = [
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
  { value: 'COMPANY_PAID', label: 'Company-Paid' },
];

/** §3.3 "Used" — the count is server-computed and never caller-writable, so a
 * non-zero value is the only trustworthy statement that an Expense record
 * already references this type. Absent/0 both read as "not used yet". */
function isUsed(row: ExpenseTypeListRow): boolean {
  return Number(row.usage_count ?? 0) > 0;
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
      // Client transport: masters_lookup.py's own docstring says Used/Unused
      // "is still deferred" server-side. It's answerable here only because
      // usage_count rides along on the response.
      key: 'used',
      label: 'Used',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Used — Any',
      predicate: (row, v) => (v === 'yes' ? isUsed(row) : !isUsed(row)),
    },
  ],
  columns: [
    { key: 'name', header: 'Expense Type', cellClass: 'cell-strong' },
    { key: 'short_code', header: 'Code', type: 'code' },
    // The prototype renders Claim Type as a `chip` (app-core.js:236 — a plain
    // neutral badge). ColumnType has no 'chip', and 'status' with an enum that
    // isn't in the badge map produces exactly that neutral badge, so this is
    // the closest honest match rather than bare text.
    { key: 'claim_type', header: 'Claim Type', type: 'status', staticOptions: CLAIM_TYPE_OPTIONS },
    { key: 'is_recurring', header: 'Recurring', type: 'status' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    { key: 'usage_count', header: 'Used', type: 'status', compute: isUsed },
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
      // Expense record" — so the button only appears while usage_count is 0.
      // The database's ON DELETE RESTRICT keys are still the real guard (a
      // referenced row comes back as a 409, not a 500).
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
