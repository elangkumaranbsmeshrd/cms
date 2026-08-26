# Expense module — build brief (saved, not yet dispatched to a fresh agent)

Hand the section below verbatim to a new background Agent (general-purpose, run_in_background: true) to build this module. No shared-infra dependency on other pending modules — safe to build any time, in parallel with anything else.

---

You are building the Expense module frontend for "Meshrd CMS" at `D:\Projects\Company Management Software` (FastAPI+MySQL backend in `backend/`, Angular 19.2 standalone-components frontend with signals in `frontend/`). The backend is 100% already built and working — you are building ONLY the Angular frontend. Several other modules are already built (Employee, Vendor, Customer, RBAC, Leave, Ticket) — don't touch their folders.

## Your scope and hard boundaries

- Build everything under `frontend/src/app/features/expense/` (new folder): `expense.api.ts`, `expense.routes.ts`, `screens/*.ts`.
- This module needs NO shared-infrastructure changes — everything fits existing shapes/components as-is. Stay entirely inside your own folder.
- **DO NOT edit `frontend/src/app/app.routes.ts` or `frontend/src/app/layout/nav-registry.ts`** — other processes may be editing those same two files concurrently for other modules and a collision would corrupt someone's edits. Instead, at the end, report back EXACTLY what to add to each.
- When done, run `cd "D:/Projects/Company Management Software/frontend" && npx ng build --configuration development` and fix every error before reporting done. Since new files won't be reachable from `main.ts`'s import graph until routes are wired centrally, verify for real: create a temp `tsconfig` extending `tsconfig.app.json` scoped to `src/app/features/expense/**/*.ts`, run `npx ngc` against it, confirm zero errors, then delete the temp tsconfig/output and confirm via `git status` nothing stray remains.
- Do not touch any other module's files.

## Established codebase conventions (from the already-built modules — follow exactly)

**The 14 screen shapes** are defined in `frontend/src/app/shared/screens/screen.types.ts` (read this file in full first). Read the real shared components too before writing configs.

**RefLookup pattern**: `{ endpoint: '/masters/expense-types' }` (defaults `labelKey:'name'`). Some Masters tables do NOT have a `name` field — get every `labelKey` in this brief exactly right, they were individually verified against the real ORM models.

**Badge CSS classes** — ONLY these exist in `frontend/src/styles/components.css`: `.b-ok`, `.b-warn`, `.b-danger`, `.b-info`, `.b-neutral`, `.b-outline`. There is NO `.b-success` or `.b-warning`.

**Required-reason RowActionDef pattern**: `body: () => ({ rejection_reason: window.prompt('Reason (required):', '') })` — synchronous, matches `frontend/src/app/features/employee/screens/emp.documents.list.config.ts`'s Reject action and `frontend/src/app/features/leave/screens/leave.approvals.list.config.ts`'s Reject action exactly — copy these two files as your direct templates for the Approvals screen.

**Bespoke "list + inline form" component pattern**: `frontend/src/app/features/employee/screens/my-leave.component.ts` is your direct template for My Expenses and Company Expenses (both need this same shape: a history table + an inline collapsible Add form + a Status filter + export buttons, all in one component, no generic shape fits). Read it in full and copy its structure: `signal`-based state, `showApply`/`showForm`-style toggle for the inline form, `Record<string, unknown>` form object with bracket-notation binding, a `load()` method, error signals for both the form and row-level actions.

**Bespoke component rules (CRITICAL, hit real bugs earlier this session):**
1. Any component taking `input.required<string>()` MUST do input-dependent work in `ngOnInit()`, NEVER the constructor.
2. `@else if (expr; as x)` is ILLEGAL — only a PRIMARY `@if` may bind `as`. Nest instead: `} @else { @if (expr; as x) { ... } }`.
3. `[(ngModel)]` on a `Record<string, unknown>`-typed object needs bracket notation: `form['key']`, never `form.key`.

**Export blob-download** (for a bespoke component's own export button beyond what `ListScreenConfig.exportable` gives for free): copy the mechanism from `my-leave.component.ts`'s own `exportRequests()` method — `this.http.get(url, {responseType:'blob', observe:'response'})`, extract filename from `Content-Disposition`, synthetic `<a download>` click, revoke.

**RBAC action-string discipline**: every `screenAction` in this brief has ALREADY been verified against the real backend `require_screen(SCREEN, action=...)` calls and the RBAC registry — use the exact strings given below. This module's `ALWAYS_ALLOWED`-regex collision check has already been done (checked against `frontend/src/app/core/rbac/policy.store.ts`'s `/^(view|open|export|download|preview|print|cancel|back|close|clear)/i`) — clean, no collisions found, all 4 real actions (`approve`,`reject`,`mark_reimbursed`,`edit`) gate correctly as real per-role grants.

## Full technical brief (verified against real backend source)

### 0. Top-line facts

**0.1** No frontend exists yet. `frontend/src/app/layout/nav-registry.ts`'s `NAV_GROUPS` already has `{module:'expense', label:'Expense'}` — no change needed there, only 4 new `SCREEN_ROUTES` entries (report back, don't add yourself).

**0.2 RBAC registry** (`backend/app/rbac/registry/screens.py`):
```
"expense.my_expenses": ScreenDef(has_scope=True,  actions=())                     — ZERO actions registered
"expense.approvals":   ScreenDef(has_scope=False, actions=("approve", "reject"))
"expense.all_expenses":ScreenDef(has_scope=False, actions=("mark_reimbursed",))
"expense.company":     ScreenDef(has_scope=False, actions=("edit",))
```
Seed defaults: `expense.my_expenses` is `full` for ALL 5 roles (behaves like "own" regardless of label — the endpoint always self-scopes via `org_scope.get_own_employee_id`, same pattern as `leave.my_leave`/`payroll.my_payslips`). The other 3: SUPER_ADMIN=full, MANAGER=none, ACCOUNTANT=full, HR=none, EMPLOYEE=none. Action grants: `approve`/`reject`/`mark_reimbursed`/`edit` all → SUPER_ADMIN+ACCOUNTANT only.

**CRITICAL: `expense.my_expenses` has `actions=()` — literally zero actions ever granted, to anyone.** Gate its "+ Add Expense" toggle button on `policy.canOpen('expense.my_expenses')` ONLY — never `policy.can('expense.my_expenses', 'edit')` or any action name, which would evaluate false for every role including Super Admin and silently hide the button forever.

**0.3 Every real endpoint, exact method/params/gate:**

| Endpoint | Method | Screen | `action=` | Params/Body |
|---|---|---|---|---|
| `/expenses/me` | GET | `expense.my_expenses` | none | Query: `status` (list/multi, alias `status_filter`), `expense_type_id`, `search`, `format` |
| `/expenses` | POST | `expense.my_expenses` | none | Body `ExpenseClaimCreate` |
| `/expenses/export-statement` | GET | `expense.my_expenses` | none | Query: `date_from`, `date_to`, `format` — a SEPARATE export from the main list's own `?format=` on `/expenses/me`, different column shape |
| `/expenses/approvals` | GET | `expense.approvals` | none | Query: `employee_id`, `expense_type_id`, `search`, `format` — **no `status` param**, queue is hardcoded server-side to PENDING reimbursable claims only |
| `/expenses/{id}/approve` | POST | `expense.approvals` | `"approve"` | no body |
| `/expenses/{id}/reject` | POST | `expense.approvals` | `"reject"` | Body `{rejection_reason: str}` (required, non-blank) |
| `/expenses` | GET | `expense.all_expenses` | none | Query: `employee_id`, `status` (list, multi), `expense_type_id`, `vendor_id`, `date_from`, `date_to`, `search`, `format` |
| `/expenses/summary` | GET | `expense.all_expenses` | none | **NO query params at all** — always unfiltered |
| `/expenses/{id}/mark-reimbursed` | POST | `expense.all_expenses` | `"mark_reimbursed"` | Body `{reimbursed_date, payment_mode_id, reimbursed_from_bank_account_id, reference?}` |
| `/company-expenses` | GET | `expense.company` | none | Query: `status` (list, multi), `expense_type_id`, `vendor_id`, `search`, `format` |
| `/company-expenses` | POST | `expense.company` | `"edit"` | Body `CompanyExpenseCreate` |
| `/company-expenses/{id}/pay` | POST | `expense.company` | `"edit"` | **QUERY PARAMS, NOT A BODY**: `?paid_from_bank_account_id=...&payment_mode_id=...&payment_reference=...` (first two required, third optional) — build the HTTP call with an empty body and everything in the URL, or it 422s |
| `/company-expenses/{id}/cancel` | POST | `expense.company` | `"edit"` | **QUERY PARAM, NOT A BODY**: `?cancellation_reason=...` (optional) |
| `/company-expenses/export-statement` | GET | `expense.company` | none | Query: `date_from`, `date_to`, `format` — separate export, different columns from the main list |

**No `GET /{id}` single-record endpoint exists for either resource anywhere** — this rules out `record`/`document` shapes entirely for this whole module.

### 1. Exact schema fields (`backend/app/schemas/finance.py`)

```
ExpenseClaimCreate: expense_type_id, vendor_id?, amount, tax_head_id?, tax_amount?, expense_date,
  linked_purchase_bill_id?, description, receipt_stored_file_id?
  (no status/claim_type/bank_account_id on create — server-derived)

ExpenseClaimOut: id, employee_id, expense_type_id, claim_type, expense_type_name_snapshot,
  vendor_id, amount, tax_head_id, tax_amount, expense_date, linked_purchase_bill_id, description,
  receipt_stored_file_id, has_receipt, bank_account_id, status, submitted_at, approved_by,
  approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_at
  (status values: PENDING|APPROVED|REJECTED|REIMBURSED)

CompanyExpenseCreate: expense_type_id, vendor_id?, linked_purchase_bill_id?, amount, tax_head_id?,
  tax_amount?, paid_from_bank_account_id?, payment_mode_id?, payment_reference?, paid_on?,
  expense_date, billing_period_month?, billing_period_year?, description?, bill_stored_file_id?

CompanyExpenseOut: id, expense_type_id, vendor_id, linked_purchase_bill_id, source_expense_claim_id,
  amount, tax_head_id, tax_amount, paid_from_bank_account_id, payment_mode_id, payment_reference,
  paid_on, expense_date, billing_period_month, billing_period_year, description, bill_stored_file_id,
  has_bill_attached, status, cancelled_at, cancellation_reason
  (status values, confirmed via DB CHECK ck_compexp_status: PENDING|PAID|CANCELLED — NOT
  "Reimbursed", that state only exists on ExpenseClaim, not CompanyExpense)
```
`CompanyExpenseOut` has NO name-snapshot for expense_type or vendor (unlike `ExpenseClaimOut`, which snapshots `expense_type_name_snapshot`) — you must resolve BOTH `expense_type_id` and `vendor_id` via ref lookups on Company Expenses' list, but only `vendor_id` on My Expenses/Approvals/All Expenses (Type is already a plain string there).

### 2. Masters/cross-module refs — exact endpoint + labelKey

| Field | Endpoint | labelKey | Notes |
|---|---|---|---|
| Expense Type | `/masters/expense-types` | `name` (default) | Fields: `id,is_active,name,short_code,claim_type('REIMBURSABLE'|'COMPANY_PAID'),is_recurring,default_bank_account_id,description,usage_count`. No server filter beyond `search`/`include_inactive`/`format` — filter to `claim_type` client-side (My Expenses/Approvals/All Expenses want REIMBURSABLE only by default; Company Expenses wants COMPANY_PAID only). |
| Bank Account | `/masters/bank-accounts` | **`nickname`** (NOT `name`) | Takes ONLY a `format` param, no `is_active` filter server-side — filter to active accounts CLIENT-SIDE for every bank-account dropdown in this module. |
| Payment Mode | `/masters/payment-modes` | `name` (default) | |
| Tax Head | `/masters/taxes` | **`tax_name`** (NOT `name`) | Takes only `format` — no server filter. Client-filter to `scope in ('PURCHASE','SALES_AND_PURCHASE')` + `is_active` + `applies_from <= today <= applies_until`. This field is optional and should be hidden entirely (not just left empty) when the filtered option list comes back empty. |
| Vendor | `/vendors` | `vendor_name` (NOT `name`) | Real server filters exist: `is_active`, `vendor_category`, `has_bank_details` — can filter server-side here, unlike the three above. **Gated on `vendor.directory`, which is `none` for HR/Employee** — before fetching, check `policy.canOpen('vendor.directory')`; if false, hide/disable the Vendor picker rather than letting it silently 404. |
| Purchase Bill | `/purchase-bills` | use whatever the real live JSON field is for a human label (check `PurchaseBillOut` yourself, don't assume `bill_number` — that name was only confirmed on the export path, not the live JSON) | **Gated on `purchase_bill.list`, which is `none` for Manager/HR/Employee** — same `canOpen` guard as Vendor before fetching. |

### 3. File upload

Receipt (My Expenses) and Bill Attached (Company Expenses) both use upload purpose `"expense_receipt"` (`backend/app/api/v1/files.py`) — PDF/JPEG/PNG, 5MB cap. There is no separate purpose for the Company Expenses bill — use `expense_receipt` for both. Use the existing `FileUploadService` (`frontend/src/app/shared/screens/` — find it, it's already used by other modules) for the actual upload flow.

### 4. Screen 1: My Expenses (`expense.my_expenses`) — bespoke component, follow `my-leave.component.ts`

Route: whatever flat top-level path you pick (recommend `/my-expenses`, matching the `/my-leave`/`/my-payslips`/`/my-tickets`/`/my-assets` flat-path convention for self-service screens — report back for `SCREEN_ROUTES`).

History table (`GET /expenses/me`) columns: Type (`expense_type_name_snapshot`, plain text, no ref), Vendor (ref `/vendors` `vendor_name`, nullable), Description, Linked Purchase Bill (id only — no label available — show truncated or omit), Amount, Bank Account (ref `/masters/bank-accounts` `nickname`, blank until Reimbursed), Date, Receipt (`has_receipt` — show a "View Receipt" link opening `GET /files/{receipt_stored_file_id}` in a new tab when true, else "—"; there is no thumbnail/preview column type anywhere in this codebase, don't try to build one), Status (badge, staticOptions `PENDING|APPROVED|REJECTED|REIMBURSED`).

Filters: Status (select or multiselect — backend takes a list so multi is fine, transport server), Expense Type (select, server). Both wired as plain bound signals/variables re-triggering `load()`, same as `my-leave.component.ts`'s `statusFilter`.

Inline "+ Add Expense" form (toggle-shown, `POST /expenses`): Expense Type (select — if the current user's role is NOT `SUPER_ADMIN`/`ACCOUNTANT`, per a hardcoded backend role check on `claim_type==='COMPANY_PAID'` types, filter those OUT of the option list client-side; read `SessionStore.role()` to decide), Vendor (optional, hidden/disabled if `!policy.canOpen('vendor.directory')`), Amount (required), Tax Head (optional, hidden when the client-filtered option list is empty), Tax Amount (optional), Expense Date (required), Linked Purchase Bill (optional, hidden/disabled if `!policy.canOpen('purchase_bill.list')`), Description (required), Receipt upload (optional, purpose `expense_receipt`).

Two SEPARATE export mechanisms, both hand-rolled blob-downloads (do not conflate them): (a) `GET /expenses/me?format=pdf|excel&status=...` — the main list's own export, same columns as the table; (b) `GET /expenses/export-statement?date_from=...&date_to=...&format=pdf|excel` — a distinct statement export (Date/Description/Bank Account/Reference/Debit/Running Balance columns server-side, nothing for you to build client-side beyond the download trigger + a small date-range picker for `date_from`/`date_to`).

Gate "+ Add Expense" on `policy.canOpen('expense.my_expenses')` only (0.2 above — no action exists).

### 5. Screen 2: Expense Approvals (`expense.approvals`) — clean `ListScreenConfig`

Near-identical to `frontend/src/app/features/leave/screens/leave.approvals.list.config.ts` — copy its structure directly.

`endpoint: '/expenses/approvals'`, `exportable: true`, `searchParam: 'search'`. Filters: `employee_id` (select, server, `optionsRef:{endpoint:'/employees', labelKey:'first_name'}`), `expense_type_id` (select, server, `optionsRef:{endpoint:'/masters/expense-types'}`). NO Status filter (queue is hardcoded PENDING+REIMBURSABLE server-side, matches spec).

Columns: Employee (ref `/employees` `first_name`), Type (`expense_type_name_snapshot`, plain text), Vendor (ref `/vendors` `vendor_name`), Date (`expense_date`), Amount (money), Status (staticOptions), Receipt (same "View Receipt" link pattern as above, or omit — this is a `ListScreenConfig`, so use a `compute` returning a display string, real click-through isn't natively supported by a plain column; simplest correct option: a `has_receipt` boolean column showing Yes/No).

`rowActions`: **Approve** — `endpoint: (row) => \`/expenses/${row.id}/approve\``, `screenAction:'approve'`, `visible: (row) => row.status === 'PENDING'`, `confirm: 'Approve this expense claim?'`, no body. **Reject** — `endpoint: (row) => \`/expenses/${row.id}/reject\``, `screenAction:'reject'`, `visible: (row) => row.status === 'PENDING'`, `body: () => ({ rejection_reason: window.prompt('Reason for rejecting this claim (required):', '') })`.

No `createRoute`.

### 6. Screen 3: All Expenses / Summary (`expense.all_expenses`) — bespoke component

Two reasons this can't be a plain `ListScreenConfig`: (a) Mark as Reimbursed needs a real 3-field form (date + 2 selects) — `RowActionDef.body` only supports a single synchronous `window.prompt()`, not enough for this; (b) Summary (`GET /expenses/summary`) is a second, structurally distinct data need on the same screen (totals by type, totals by month, `total_reimbursed`) with **zero query params of its own** — wiring Summary as a shared-filter-bar source would misrepresent the numbers, since the real endpoint ignores every filter. Render Summary as its own always-unfiltered block instead.

The filterable list portion alone (`status` multi-select server, `expense_type_id`, `employee_id`, `vendor_id`, `date_from`/`date_to`, `search` — all real server params) — build it as a hand-rolled table inside the bespoke component for visual/behavioral consistency with the shared list screen conventions.

Render: an always-unfiltered Summary block at the top (totals by type, totals by month, `total_reimbursed` — read the actual `GET /expenses/summary` response shape yourself, keep it simple: iterate whatever keys/arrays come back). Below it, a filterable table reading `GET /expenses` with filters: Employee (select), Status (multiselect), Expense Type (select), Vendor (select), Date range (2 plain date inputs, params `date_from`/`date_to`), Search (text input, param `search`).

Columns: Employee (ref, first_name), Type (plain text snapshot), Vendor (ref), Date, Amount, Status. Row action "Mark as Reimbursed" (only when `status === 'APPROVED'`): opens an inline form (same toggle pattern) with Reimbursed Date (required date), Payment Mode (required select, `/masters/payment-modes`), Reimbursed From Bank Account (required select, `/masters/bank-accounts` `nickname`, active-only), Reference (optional text) → `POST /expenses/{id}/mark-reimbursed`, `screenAction:'mark_reimbursed'`, real JSON body this time (not query params).

### 7. Screen 4: Company Expenses (`expense.company`) — bespoke component

Same bundling pattern as My Expenses: list + inline Add form + inline Pay dialog + Cancel action + statement export, all sharing one `edit` action (no split between create/pay/cancel at the RBAC layer — gate all three on `policy.can('expense.company', 'edit')`).

List (`GET /company-expenses`) filters: Status (multiselect, server — `PENDING|PAID|CANCELLED`), Expense Type (select, server), Vendor (select, server), Search (server). Columns: Type (ref `/masters/expense-types`, this resource has NO name snapshot so you must resolve it), Vendor (ref, nullable), Amount, Paid On (`paid_on`, nullable), Expense Date, Status (badge), Bill Attached (`has_bill_attached`, same Yes/No or link-if-present pattern as Receipt elsewhere).

Inline "+ Add Company Expense" form (`POST /company-expenses`): Expense Type (select, client-filtered to `claim_type === 'COMPANY_PAID'` only), Vendor (optional), Linked Purchase Bill (optional, same `canOpen('purchase_bill.list')` guard as My Expenses), Amount (required), Tax Head + Tax Amount (optional, same client-filter-and-hide-when-empty pattern as My Expenses), Paid From Bank Account (optional at create time), Payment Mode (optional at create time), Payment Reference (optional), Paid On (optional date), Expense Date (required), Billing Period Month/Year (optional, plain number inputs), Description (optional), Bill Attached upload (optional, purpose `expense_receipt`).

Row action "Pay" (only when `status === 'PENDING'`): inline form — Paid From Bank Account (required select, active-only), Payment Mode (required select), Payment Reference (optional text) → `POST /company-expenses/{id}/pay?paid_from_bank_account_id=...&payment_mode_id=...&payment_reference=...` — **build this as a query string, empty body**, per §0.3's explicit warning, or it 422s.

Row action "Cancel" (only when `status === 'PENDING'`): `window.confirm` + optional reason via `window.prompt` → `POST /company-expenses/{id}/cancel?cancellation_reason=...` — again query param, empty body, only append the param if a reason was actually given (don't send `cancellation_reason=null` as a literal string).

Statement export (`GET /company-expenses/export-statement?date_from=&date_to=&format=`) — same hand-rolled blob-download pattern as My Expenses' statement export, a separate button/date-range picker from the main list's own `?format=` export.

## When you're done

Report back:
1. Every file you created, one line each.
2. The exact lines to add to `frontend/src/app/app.routes.ts` (import + spread).
3. The exact `SCREEN_ROUTES` entries to add to `frontend/src/app/layout/nav-registry.ts` for all 4 screens.
4. Confirmation that `ng build` passes cleanly (paste the final success output).
5. Any gap, ambiguity, or judgment call you made that a reviewer should know about — especially how you handled the two cross-module RBAC visibility gaps (Vendor/Purchase-Bill pickers 404ing for some roles) and the Receipt "thumbnail" fidelity gap (no preview column type exists).
