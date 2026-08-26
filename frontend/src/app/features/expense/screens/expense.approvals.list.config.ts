import { ListScreenConfig } from '../../../shared/screens/screen.types';

// §2.2's real columns/filters need more of ExpenseClaimOut than the original
// trimmed view exposed — GET /expenses/approvals returns the FULL
// ExpenseClaimOut (expenses.py's list_pending_approvals: `[ExpenseClaimOut.
// model_validate(c) for c in rows]`, no field trimming server-side), so
// claim_type/bank_account_id/linked_purchase_bill_id below are real response
// fields, not invented ones — this interface was just under-modeling what
// the endpoint already sends.
interface ExpenseApprovalRow {
  readonly id: string;
  readonly employee_id: string;
  readonly expense_type_id: string;
  readonly expense_type_name_snapshot: string;
  readonly claim_type: string;
  readonly vendor_id: string | null;
  readonly linked_purchase_bill_id: string | null;
  readonly amount: string;
  readonly bank_account_id: string | null;
  readonly expense_date: string;
  readonly status: string;
  readonly has_receipt: boolean;
  readonly submitted_at: string;
}

// Verbatim ExpenseClaim.status values (finance.py) — REIMBURSED is included
// only so the Status column's badgeClass()/label mapping is complete; no row
// on THIS screen can ever actually carry it (see below).
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  // §6.1 "Allow Manager to Approve Their Team's Expenses" — a claim sits
  // here, between Pending and Approved, only while that toggle is ON and
  // its employee has a reporting manager (expenses.py's
  // _manager_approval_required); this screen's own queue includes it
  // alongside Pending (list_pending_approvals: `["PENDING"] if
  // is_manager_scoped else ["PENDING", "MGR_APPROVED"]`).
  { value: 'MGR_APPROVED', label: 'Manager Approved' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REIMBURSED', label: 'Reimbursed' },
];

// Verbatim ck_expclaim_claim_type (DB CHECK constraint) — §2.1's own two
// values, carried read-only from the selected Expense Type.
const CLAIM_TYPE_OPTIONS = [
  { value: 'REIMBURSABLE', label: 'Reimbursable' },
  { value: 'COMPANY_PAID', label: 'Company-Paid' },
];

// §2.2 Expense Approvals — GET /expenses/approvals is hardcoded server-side
// to PENDING + REIMBURSABLE claims only (expenses.py's list_pending_
// approvals: `.where(ExpenseClaim.status == "PENDING", ExpenseClaim.
// claim_type == "REIMBURSABLE")`, no ?status= param exists on this endpoint
// at all) — unlike Leave Approvals there is no Status filter here: every row
// on screen is already Pending, and a claim leaving Pending immediately
// leaves this queue too. Direct copy of leave.approvals.list.config.ts's own
// structure per this module's build brief.
const config: ListScreenConfig<ExpenseApprovalRow> = {
  shape: 'list',
  id: 'expense.approvals',
  title: 'Expense Approvals',
  specRef: '§2.2',
  recordNoun: 'expense claim',
  description: 'Reimbursable expense claims awaiting your decision.',
  endpoint: '/expenses/approvals',
  exportable: true,
  rowId: (row) => row.id,
  searchParam: 'search',
  includeInactiveParam: false,
  filters: [
    { key: 'employee_id', label: 'Employee', kind: 'select', transport: 'server', allLabel: 'All Employees', optionsRef: { endpoint: '/employees/options', labelKey: 'label' } },
    // §2.2's own "Department" filter has no home here: ExpenseClaim carries
    // no department reference at all (neither the DB model nor
    // ExpenseClaimOut — confirmed against backend/app/schemas/finance.py),
    // so it would take a JOIN through employee_id -> Employee.department_id
    // that neither this endpoint nor FilterDef.predicate's (row, value)
    // signature can express (predicate gets no employee/department map to
    // join through, unlike optionsFromRows's own (rows, refData) signature).
    // A real fix needs either a department_id param on GET /expenses/
    // approvals or a FilterDef.predicate signature change — both out of this
    // module's frontend-only scope. Flagged rather than faked.
    // Not claim_type-filtered to REIMBURSABLE-only, unlike this module's
    // bespoke components' own Expense Type pickers (which fetch and filter
    // by hand) — optionsRef has no client-side predicate of its own, so a
    // Company-Paid type stays selectable here too; picking one is harmless,
    // it just always yields zero rows (this endpoint is hardcoded to
    // REIMBURSABLE claims regardless of what's asked for). A disclosed,
    // low-stakes limitation of the generic ListScreenConfig shape rather
    // than a bespoke workaround, matching screen.types.ts's own precedent
    // for filters that can't fully express a screen's real constraint.
    { key: 'expense_type_id', label: 'Expense Type', kind: 'select', transport: 'server', allLabel: 'All Expense Types', optionsRef: { endpoint: '/masters/expense-types/options', labelKey: 'label' } },
    // Vendor/Department/Amount/Submitted-date-range/Has-Receipt/Pending-Days
    // all gained real ?params= on GET /expenses/approvals this revision
    // (expenses.py's list_pending_approvals) — closing exactly the gap
    // §2.2's own text flagged: "The receipt filter is the one this queue
    // most needed... the toggle itself is also not yet built" (Section 6.1's
    // "Require a Receipt Before Approval" toggle is now built too, see
    // toggles.py's ACTION_TOGGLE_GATES).
    { key: 'vendor_id', label: 'Vendor', kind: 'select', transport: 'server', allLabel: 'All Vendors', optionsRef: { endpoint: '/vendors/options', labelKey: 'label' } },
    { key: 'department_id', label: 'Department', kind: 'select', transport: 'server', allLabel: 'All Departments', optionsRef: { endpoint: '/masters/departments/options', labelKey: 'label' } },
    { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server', allLabel: 'Any Amount', param: 'amount' },
    { key: 'submitted', label: 'Submitted', kind: 'daterange', transport: 'server', allLabel: 'All Dates', param: 'submitted' },
    { key: 'pending_days', label: 'Pending At Least (Days)', kind: 'number', transport: 'server', allLabel: 'Any Wait' },
    // Client transport: no ?claim_type= param exists on this endpoint (see
    // above) — and since every row here is already REIMBURSABLE by the
    // server's own hardcoded filter, picking Company-Paid always yields zero
    // rows. Same disclosed, low-stakes limitation as Expense Type above;
    // kept because §2.2's own filter table names it regardless.
    { key: 'claim_type', label: 'Claim Type', kind: 'select', transport: 'client', allLabel: 'All Claim Types', options: CLAIM_TYPE_OPTIONS, predicate: (row, v) => row.claim_type === v },
    // Client transport: no ?bank_account_id= param exists either. Also
    // always empty in practice — bank_account_id is only ever populated by
    // Mark as Reimbursed (§2.3), which a still-Pending row on this queue has
    // never been through — but the field is real (ExpenseClaimOut carries
    // it) and §2.2's filter table names it, so it's kept rather than
    // silently dropped, matching Expense Type/Claim Type's own precedent above.
    { key: 'bank_account_id', label: 'Bank Account', kind: 'select', transport: 'client', allLabel: 'All Accounts', optionsRef: { endpoint: '/masters/bank-accounts/options', labelKey: 'label' }, predicate: (row, v) => row.bank_account_id === v },
    { key: 'has_receipt', label: 'Has Receipt', kind: 'tristate', transport: 'server', allLabel: 'Receipt — Any' },
  ],
  columns: [
    { key: 'employee_id', header: 'Employee', cellClass: 'cell-strong', type: 'avatar', ref: { endpoint: '/employees/options', labelKey: 'label' } },
    { key: 'expense_type_name_snapshot', header: 'Type' },
    // Always reads "Reimbursable" on this screen in practice (see the
    // claim_type filter's own comment above) — kept as a real column anyway
    // since §2.2's own column table names it and the field is genuine. 'chip'
    // (not 'status'): the prototype's own U.chip() treatment for this column
    // — a plain neutral tag, since Claim Type isn't a lifecycle/status value.
    { key: 'claim_type', header: 'Claim Type', type: 'chip', staticOptions: CLAIM_TYPE_OPTIONS },
    { key: 'vendor_id', header: 'Vendor', ref: { endpoint: '/vendors/options', labelKey: 'label' } },
    // PurchaseBillOut's real field is purchase_bill_code (confirmed against
    // purchase_bills.py's own non-export response, same field expense.api.ts's
    // PurchaseBillOption already uses) — RefDataService.label() is generic
    // over any endpoint + labelKey, not just the Masters lookup factory.
    { key: 'linked_purchase_bill_id', header: 'Linked Purchase Bill', cellClass: 'mono', ref: { endpoint: '/purchase-bills', labelKey: 'purchase_bill_code' } },
    { key: 'amount', header: 'Amount', type: 'money' },
    // masters_bank_accounts.py's own field name is `nickname`, NOT `name`.
    // Always blank on this screen today (see the filter's own comment above).
    { key: 'bank_account_id', header: 'Bank Account', ref: { endpoint: '/masters/bank-accounts/options', labelKey: 'label' } },
    { key: 'expense_date', header: 'Date', type: 'date' },
    // Raw boolean -> 'status' badge (ListScreenComponent.display() special-
    // cases `typeof raw === 'boolean'` to Yes/No before anything else) —
    // same treatment payroll.payslips.list.config.ts's has_unpaid_leave/
    // has_adhoc_adjustments columns already get. Replaces the earlier plain-
    // text `compute` version so Receipt reads as a colored pill like the
    // prototype's own `type: 'status'` column, not bare text.
    { key: 'has_receipt', header: 'Receipt', type: 'status' },
    { key: 'status', header: 'Status', type: 'status', staticOptions: STATUS_OPTIONS },
  ],
  rowActions: [
    // §6.1 "Allow Manager to Approve Their Team's Expenses" — Manager's own
    // sign-off step, OFF by default (screenAction 'manager_approve' has no
    // static grant anywhere, purely toggle-gated — rbac/toggles.py's
    // ACTION_TOGGLE_GATES — so PolicyStore.can() hides this button entirely
    // for every role/state except MANAGER while the toggle is ON, same
    // mechanism as leave.balance-management's own toggle-only 'adjust').
    {
      label: 'Manager Approve',
      endpoint: (row) => `/expenses/${row.id}/manager-approve`,
      screenAction: 'manager_approve',
      visible: (row) => row.status === 'PENDING',
      confirm: 'Sign off on this expense claim? It still needs final approval from Accountant.',
    },
    {
      label: 'Approve',
      endpoint: (row) => `/expenses/${row.id}/approve`,
      screenAction: 'approve',
      // MGR_APPROVED, not just PENDING — a claim whose employee needs the
      // manager sign-off step above lands here first; approve_expense_claim
      // (expenses.py) itself re-checks and 409s if that step is still owed,
      // this is only the button's own best-effort visibility guess.
      visible: (row) => row.status === 'PENDING' || row.status === 'MGR_APPROVED',
      confirm: 'Approve this expense claim?',
      // No body — approve_expense_claim (expenses.py) takes no request body
      // at all, unlike Leave Approvals' /decide endpoint.
    },
    {
      label: 'Reject',
      endpoint: (row) => `/expenses/${row.id}/reject`,
      screenAction: 'reject',
      visible: (row) => row.status === 'PENDING' || row.status === 'MGR_APPROVED',
      // ExpenseRejectRequest requires a non-blank rejection_reason
      // (reject_expense_claim 422s otherwise) — same window.prompt
      // technique as emp.documents.list.config.ts's and leave.approvals.
      // list.config.ts's own Reject actions.
      body: () => ({ rejection_reason: window.prompt('Reason for rejecting this claim (required):', '') }),
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No expense claims to review.',
};

export default config;
