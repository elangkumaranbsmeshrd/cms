# Invoice module — build brief (saved, not yet dispatched to a fresh agent)

Hand the section below verbatim to a new background Agent (general-purpose, run_in_background: true) to build this module. Build Invoice BEFORE Purchase Bill — both extend the same shared `document-screen.component.ts`, and Purchase Bill's brief assumes Invoice's extension has already landed.

---

You are building the Invoice module frontend for "Meshrd CMS" at `D:\Projects\Company Management Software` (FastAPI+MySQL backend in `backend/`, Angular 19.2 standalone-components frontend with signals in `frontend/`). The backend for this module is 100% already built and working — you are building ONLY the Angular frontend. Several other modules (Employee, Vendor, Customer, RBAC, Leave) are already built this session using the exact conventions below — follow them precisely, don't invent new ones. Ticket is also already built.

## Your scope and hard boundaries

- Build everything under `frontend/src/app/features/invoice/` (new folder): `invoice.api.ts`, `invoice.routes.ts`, `screens/*.ts`.
- You will ALSO need to touch 3 shared-infrastructure files (justified below, real reuse value — not scope creep): `frontend/src/app/shared/screens/screen.types.ts`, `frontend/src/app/shared/screens/document-screen/document-screen.component.ts`, and one line in `frontend/src/app/features/customer/screens/customer.invoices.list.config.ts`. Do not touch any other shared file.
- **DO NOT edit `frontend/src/app/app.routes.ts` or `frontend/src/app/layout/nav-registry.ts`** — other processes may be editing those same two files concurrently for other modules and a collision would corrupt someone's edits. Instead, at the end, report back EXACTLY what to add to each.
- When done, run `cd "D:/Projects/Company Management Software/frontend" && npx ng build --configuration development` and fix every error before reporting done. Since new files won't be reachable from `main.ts`'s import graph until routes are wired centrally, verify for real: create a temp `tsconfig` extending `tsconfig.app.json` scoped to `src/app/features/invoice/**/*.ts` plus the 2 shared files you touched, run `npx ngc` against it, confirm zero errors, then delete the temp tsconfig/output and confirm via `git status` nothing stray remains.
- Do not touch any other module's files.

## Established codebase conventions (from the already-built modules — follow exactly)

**The 14 screen shapes** are in `frontend/src/app/shared/screens/screen.types.ts` (read in full first). Read the real shared components too before writing configs — don't guess field names, especially `document-screen.component.ts` since this module leans on it heavily.

**RefLookup pattern**: `{ endpoint: '/masters/service-categories' }` (defaults `labelKey:'name'`, correct for most Masters sub-masters). Several Masters tables in THIS module do NOT have a `name` field — see the exact `labelKey` table below, get every one right, they were individually verified against the real ORM models.

**Badge CSS classes** — ONLY these exist in `frontend/src/styles/components.css`: `.b-ok`, `.b-warn`, `.b-danger`, `.b-info`, `.b-neutral`, `.b-outline`. There is NO `.b-success` or `.b-warning`. Use `staticOptions` on a `ColumnDef`/`FieldConfig` for enum labels where possible.

**Export/download blob mechanism** (for any custom download button, e.g. the Invoice/Credit Note PDF): copy the exact mechanism from `frontend/src/app/shared/screens/report-screen/report-screen.component.ts`'s `exportTable()` method — `this.http.get(url, {responseType:'blob', observe:'response'})`, extract filename from `Content-Disposition`, create a blob URL, click a synthetic `<a download>`, revoke the URL. Bearer auth is header-only, so a plain `<a href>`/`window.open` would hit the API unauthenticated — this blob mechanism is required, not optional.

**Bespoke component rules (CRITICAL, hit real bugs earlier this session):**
1. Any component taking `input.required<string>()` MUST do input-dependent work in `ngOnInit()`, NEVER the constructor — dynamic-input hosting (`NgComponentOutlet` or similar) applies inputs via `setInput()` AFTER construction; reading in a constructor throws `NG0950` live in the browser even though it builds cleanly.
2. `@else if (expr; as x)` is ILLEGAL — only a PRIMARY `@if` may bind `as`. Nest instead: `} @else { @if (expr; as x) { ... } }`.
3. `[(ngModel)]` on a `Record<string, unknown>`-typed object needs bracket notation: `form['key']`, never `form.key` (`ng build`'s template checker rejects dot-notation; bare `tsc` won't catch this).

**RBAC action-string discipline**: every `screenAction`/`DocumentActionDef.screenAction`/`RowActionDef.screenAction` in this brief has ALREADY been verified against the real backend `require_screen(SCREEN, action=...)` calls and the RBAC registry's `actions=(...)` tuple — use the exact strings given below. If you add any endpoint call not listed in this brief, verify it yourself the same way (grep the real `require_screen()` call in `backend/app/api/v1/invoices.py`/`credit_notes.py`) before using it. `frontend/src/app/core/rbac/policy.store.ts`'s `ALWAYS_ALLOWED` regex (`/^(view|open|export|download|preview|print|cancel|back|close|clear)/i`) has already been checked against every real action this module uses — no collisions were found (unlike a sibling module, Ticket, whose real "close" action does collide with this regex — Invoice has no such trap, all 5 of its real write actions `edit`/`send`/`record_payment`/`raise`/`approve` are safely gated).

## Full technical brief (verified against real backend source — endpoints, fields, RBAC are all confirmed facts, not guesses)

### 0. Top-line facts

**0.1** No frontend exists yet at `frontend/src/app/features/invoice/`. `frontend/src/app/layout/nav-registry.ts`'s `NAV_GROUPS` already has `{ module: 'invoice', label: 'Invoice' }` — no change needed there, only `SCREEN_ROUTES` entries (report these back, don't add them yourself).

**0.2 RBAC registry** (`backend/app/rbac/registry/screens.py`):
```
"invoice.dashboard": ScreenDef(has_scope=False, actions=())
"invoice.list":       ScreenDef(has_scope=False, actions=("edit", "send", "record_payment"))
"credit_note.list":   ScreenDef(has_scope=False, actions=("raise", "approve"))
```
Seed defaults (`backend/app/seed.py`): all three screens — SUPER_ADMIN=full, MANAGER=**none**, ACCOUNTANT=full, HR=none, EMPLOYEE=none. Action grants: `invoice.list`'s `edit`/`send`/`record_payment` → SUPER_ADMIN+ACCOUNTANT. `credit_note.list`'s `raise` → SUPER_ADMIN+ACCOUNTANT; `approve` → **SUPER_ADMIN only**.

**0.3 `GET /customers/picker` is THE customer source for this entire module — use it everywhere a customer picker is needed (New Invoice, Invoice List's Customer filter, Credit Note List's Customer filter), never `GET /customers`.** Its own docstring confirms it's built specifically for Invoice: gated `require_screen("invoice.list")`, not `customer.directory`. This matters because `customer.directory` is seeded `ACCOUNTANT:"none"` — Accountant (this module's primary user) cannot call `GET /customers` at all, only `/customers/picker`. Response shape: `{id, company_name, display_name, address, gstin}`, takes a `search` param (single value). Use `labelKey: 'company_name'`.

**0.4 Every `require_screen()` call in this module, exact:**

| Endpoint | Method | `action=` |
|---|---|---|
| `GET /invoices/dashboard` | GET | none |
| `GET /invoices` | GET | none |
| `POST /invoices` | POST | `"edit"` |
| `GET /invoices/{id}` | GET | none |
| `GET /invoices/{id}/pdf` | GET | none |
| `PUT /invoices/{id}` | PUT | `"edit"` |
| `POST /invoices/{id}/send` | POST | `"send"` |
| `POST /invoices/{id}/payments` | POST | `"record_payment"` |
| `GET /invoices/{id}/payments` | GET | none |
| `GET /credit-notes` | GET | none |
| `POST /credit-notes` | POST | `"raise"` |
| `PUT /credit-notes/{id}` | PUT | `"raise"` (Draft-only, 409 otherwise) |
| `POST /credit-notes/{id}/submit` | POST | `"raise"` |
| `POST /credit-notes/{id}/approve` | POST | `"approve"` |
| `GET /credit-notes/{id}` | GET | none |
| `GET /credit-notes/{id}/pdf` | GET | none |

### 1. Invoice Dashboard — bespoke component (NOT `dashboard` or `report` shape)

Both generic shapes fail the same way for this screen: `GET /invoices/dashboard` returns ONE object (not an array at top level), and both `DashboardScreenComponent` and `ReportScreenComponent` do `Array.isArray(data) ? data : []` directly on a widget/table's raw fetch — a table pointed at this endpoint renders permanently empty. Build bespoke, modeled directly on `frontend/src/app/features/employee/screens/my-dashboard.component.ts` (read it as your template).

Response (`GET /invoices/dashboard`, no action):
```
{ total_invoiced, total_received, outstanding: Decimal, overdue_count: int,
  overdue_invoices: [{invoice_number, customer, amount, due_date}],
  recent_payments: [{customer, amount, mode, date}],  // mode = raw payment_mode_id, needs RefDataService resolution to /masters/payment-modes (labelKey 'name', default)
  active_employees, total_expenses, active_projects, open_tickets }
```
`overdue_invoices[].customer` and `recent_payments[].customer` are already plain strings (no ref needed). Only `recent_payments[].mode` needs `RefDataService` — inject it (`frontend/src/app/shared/screens/ref-data.service.ts`) even though the Employee dashboard precedent you're copying doesn't need it (it has no bare-FK fields).

Build: 8 stat tiles (total_invoiced/total_received/outstanding/overdue_count/active_employees/total_expenses/active_projects/open_tickets, all money except the 4 counts) + 2 tables (Overdue Invoices, Recent Payments). Route it wherever you decide `invoice.dashboard` lives (report back for `SCREEN_ROUTES`). Gate the whole route on `PolicyStore.canOpen('invoice.dashboard')` — nothing on it is ever conditionally writable (zero registered actions).

### 2. Invoice List — clean `list` shape, no gaps

`ListScreenConfig<InvoiceRow>`, `id:'invoice.list'`, `endpoint:'/invoices'`, `exportable:true`, `searchParam:'search'` (real server param), `includeInactiveParam:false`, `defaultPageSize:25`.

Query params (exact): `customer_id` (single), `status` (alias `status_filter`, **list/multi-value**), `invoice_date_from`/`invoice_date_to` (single each), `overdue` (bool), `ageing` (single, exact literal values `"Current"|"1-30"|"31-60"|"61-90"|"90+"`), `search` (matches invoice_number/customer_name_snapshot/reference), `format` (`pdf|excel`).

Columns: `invoice_number`(`type:'code'`), `customer_name_snapshot`(text, already denormalized — no ref needed), `invoice_date`(date), `due_date`(date), `status`(`type:'status'`, staticOptions = `DRAFT|SENT|PART_PAID|PAID` — reuse the exact 4-value set already defined in `frontend/src/app/features/customer/screens/customer.invoices.list.config.ts:14-19`, read that file first), `subtotal`/`tax_amount`/`grand_total`/`amount_received`/`balance_due` (all `type:'money'`).

Filters: `customer_id` (select, `optionsRef: {endpoint:'/customers/picker', labelKey:'company_name'}` — per 0.3, NOT `/customers`), `status` (multiselect, server), `invoice_date` range (daterange, server, `param:'invoice_date'` → auto-suffixes to `invoice_date_from`/`_to`, matches exactly), `overdue` (tristate, server, param `overdue`), `ageing` (select, server, param `ageing`, options = the 5 literal bucket labels above as both value and label).

Export columns are a fixed server-side set (`invoice_number,customer,invoice_date,due_date,status,subtotal,tax_amount,grand_total,amount_received,balance_due`) — nothing to configure client-side, this is automatic once `exportable:true`.

`rowRoute: (row) => ['/invoices', row.id]`. `createRoute` → wherever you land "+ New Invoice" (see §4 below), `createScreenAction: 'edit'`.

### 3. Credit Note List — clean `list` shape, no gaps

`ListScreenConfig`, `id:'credit_note.list'`, `endpoint:'/credit-notes'`, `exportable:true`, `defaultPageSize:25`.

Query params: `customer_id` (single), `status` (alias `status_filter`, **list/multi**), `reason` (**single**, not multi — despite sitting next to a multi-value status param), `date_from`/`date_to` (single each — plain `date`, NOT `credit_note_date`, param name matters), `format`.

Columns: `credit_note_number`(code), `invoice_number_snapshot`(code, label it "Original Invoice"), `customer_name_snapshot`(text), `credit_note_date`(date), `reason`(status, staticOptions below), `credit_amount`(money), `status`(status — values `DRAFT|PENDING_APPROVAL|APPROVED`, or whatever the real 3-state flow is; confirm by grepping the DB CHECK constraint for the credit_notes status column before hardcoding, don't guess).

Reason exact value/label pairs: `BILLING_ERROR→"Billing Error"`, `CUSTOMER_DISPUTE→"Customer Dispute"`, `GOODS_NOT_DELIVERED→"Goods or Service Not Delivered"`, `OTHER→"Other"`.

Filters: `customer_id` (select, optionsRef `/customers/picker` labelKey `company_name`), `status` (multiselect, server), `reason` (single select, server, the 4 options above), date range (daterange, server, `param:'date'` → `date_from`/`date_to`).

`rowRoute` → the Credit Note detail component (§5). No `createRoute` on this list — Credit Notes are only ever raised from an existing invoice's own screen (a `DocumentActionDef` on the Invoice document screen, per §4), not from a list "+Add" button.

### 4. New / Edit Invoice — `document` shape, needs 2 real shared-infra extensions (do these first, they unblock the whole screen)

**Read `frontend/src/app/shared/screens/document-screen/document-screen.component.ts` and its config type (`DocumentScreenConfig` in `screen.types.ts`) in full before starting.** This shape was built for exactly this screen (its own doc comment says so) but has two structural gaps you must fix as real shared capability (Purchase Bill, not yet built, will need the identical fix later — do this properly, not as an Invoice-only hack):

**4a. No create mode.** Today `DocumentScreenComponent` always requires a route `:id` and only ever `PUT`s to `saveEndpoint(id)`. Extend it to support create-mode the same way `frontend/src/app/shared/screens/form-screen/form-screen.component.ts` already does (read that file's `isEditMode()`/create-vs-edit branching as your reference): add an optional `createEndpoint?: string` to `DocumentScreenConfig`, and in the component, when `!route.snapshot.paramMap.get('id')`, seed the form from an `emptyRow()`-style default instead of fetching, and Save does `POST createEndpoint` then `router.navigate(['/invoices', response.id])` (or whatever the config's own base path is — don't hardcode `/invoices`, derive it or add a `recordRoute: (row) => unknown[]` config field) instead of `PUT`.

**4b. Field-level "editable only while creating, then permanently locked" doesn't exist.** `FieldConfig<T>` already HAS a `createOnly?: boolean` field (used by `FormScreenConfig`/`FormScreenComponent` — check `screen.types.ts`'s doc comment on it and `form-screen.component.ts`'s handling) — but verify whether `document-screen.component.ts`'s own field-readonly gate (currently `isLocked() || field.editable === false`, roughly) actually reads `createOnly` too. If it doesn't, wire it in the same way `form-screen.component.ts` does: readonly when NOT in create mode AND `field.createOnly` is true. This is required for Invoice's Customer field (immutable after creation, backed by a real 422 server-side on PUT if changed).

**4c. Also add a proper file-download action kind.** `DocumentActionDef`'s existing `'endpoint'` kind does a no-body POST-and-reload — wrong verb/mechanism for a PDF download (`GET /invoices/{id}/pdf` is a GET returning a binary). Add a `kind: 'download'` to `DocumentActionDef` (or handle it as a special case in the action-dispatch method) that does the blob-download mechanism described in the conventions section above, using `endpoint(row)` as the URL. Wire this the same way for Credit Note's PDF download too if you use `DocumentActionDef` there.

Once these 3 are in place, build the actual Invoice document config:

**Fields** (from `InvoiceCreate`/`InvoiceOut`, `backend/app/schemas/finance.py` — read it yourself for exact validators, this is a guide not a substitute): Customer (`createOnly:true`, select, `ref:{endpoint:'/customers/picker', labelKey:'company_name'}`), Invoice Date (required date, not future — client-side max=today is fine, server only enforces this on create not edit, a confirmed asymmetry, don't worry about matching it exactly), Due Date (optional date), Reference (optional text), Notes (optional textarea), Service Category (optional select, `ref:{endpoint:'/masters/service-categories'}`, default labelKey), Bank Account (optional select, `ref:{endpoint:'/masters/bank-accounts', labelKey:'nickname'}` — NOT `name`, that field doesn't exist on BankAccount), Tax head (optional select, `ref:{endpoint:'/masters/taxes', labelKey:'tax_name'}` — NOT `name`), Tax Amount Override (optional number, only meaningful with a Tax head chosen — 422s otherwise, so hide/disable it when Tax head is empty), Customer Address/GSTIN (`customer_address_snapshot`/`customer_gstin_snapshot`, always `editable:false`, plain snapshot display).

Do NOT build a "Financial Year" field — confirmed `InvoiceOut` never actually serializes `financial_year_id` despite the column existing on the model; there is no way to render it from this API. Skip it entirely rather than fabricating a value.

**Line items** (`DocumentLineItemsConfig`): columns Description (text), HSN/SAC (select, `ref:{endpoint:'/masters/hsn-sac-codes', labelKey:'code'}` — NOT `name`, that field doesn't exist on HsnSacCode), Quantity (number), Rate (money). `lineTotal: (item) => item.quantity * item.rate`. `emptyItem: () => ({description:'', hsn_code_id:null, quantity:1, rate:0})`.

**Totals**: computed live off the current line items array — Subtotal, Tax (sum of computed tax, or per-component if you want to show the split — the response's `tax_lines[]` array has `component_name_snapshot`/`computed_amount` per line if editing an existing saved invoice, but for a NOT-yet-saved live edit you can just show one combined "Tax" row since exact split computation happens server-side), Grand Total (`emphasize:true`).

**Locked**: `(row) => row.status === 'PAID'` — when true, the whole form renders read-only (the shape already supports this via `isLocked()`).

**Header**: icon `'invoice'` (already exists in `frontend/src/app/shared/ui/icon.component.ts`), recId from `invoice_number`, name from `customer_name_snapshot`, badge from `status` (staticOptions = the 4-value set), summary tiles = Grand Total/Paid(`amount_received`)/Balance(`balance_due`).

**Note** (shown when locked): `"Locked. A Paid invoice cannot be edited directly — corrections go through a Credit Note."`

**Actions** (`DocumentActionDef[]`): Save (`kind:'save'`, `screenAction:'edit'`), Send (`kind:'endpoint'`, POST to `/invoices/{id}/send`, `screenAction:'send'`, `visible:(r)=>r.status==='DRAFT'`), Download PDF (`kind:'download'` per 4c, `endpoint:(r)=>'/invoices/'+r.id+'/pdf'`, `screenAction:'view'` — visibility-only, no real action gate on the backend), Record Payment (`kind:'route'`, route to your Record Payment component per §6, `visible:(r)=>['SENT','PART_PAID'].includes(r.status)`, `screenAction:'record_payment'`), Raise Credit Note (`kind:'route'`, route to your Credit Note create component per §5, `visible:(r)=>['PAID','PART_PAID'].includes(r.status)`, `screenAction:'raise'`).

**"Create from a won deal/project" convenience** — no backend support exists for this (no opportunity/project FK on Invoice at all). Skip building this specific convenience entirely; a plain blank "+ New Invoice" is sufficient and matches what the backend actually supports.

### 5. Credit Note create/detail — bespoke component, no shape fits

No shape fits: "Line Items Affected" is a multi-select whose OPTIONS are the parent invoice's own currently-loaded `line_items` array (a dynamic per-record option source nothing in `FieldConfig` supports — `ref` sources from a fixed Masters endpoint, `staticOptions`/`checkgroup` are fixed at config-authoring time). Build bespoke: on mount, fetch the parent `GET /invoices/{invoice_id}` (to show its line items as checkboxes + `grand_total`/`credit_note_total` for a live "remaining creditable" figure), render Reason (select, 4 options from §3), Reason Detail (textarea), Credit Amount (number, client-cap at `grand_total - credit_note_total` for UX, server is authoritative), a checkbox list of the invoice's line items (description + line_total shown per row).

Endpoints: `POST /credit-notes` create (body `{invoice_id, reason, reason_detail, credit_amount, line_items_affected: string[]}`, `screenAction:'raise'`) / `PUT /credit-notes/{id}` edit (Draft-only, 409 otherwise, same action) / `POST /credit-notes/{id}/submit` (no body, `screenAction:'raise'`) / `POST /credit-notes/{id}/approve` (no body, `screenAction:'approve'`) / `GET /credit-notes/{id}/pdf` (blob download per the conventions section, `screenAction:'view'`).

Route this at `invoices/:id/credit-note` (create, reached from the Invoice document's Raise-Credit-Note action) AND `credit-notes/:id` (view/submit/approve an existing one, reached from the Credit Note List's `rowRoute`) — same component, branch on which route param is present, matching the create-vs-edit convention used elsewhere in this codebase.

### 6. Record Payment — bespoke component, no shape fits

Small standalone routed component (`invoices/:id/record-payment`), reads `:id` off `ActivatedRoute` directly (like `DocumentScreenComponent` does), fetches the parent invoice first (for `balance_due`/`withheld_total`/`bank_account_id` display + defaults), then a form:

Fields (from `InvoicePaymentCreate`): Amount Received (required number), Customer Withheld Tax Head (optional select, `ref:{endpoint:'/masters/taxes', labelKey:'tax_name'}`, pre-filter client-side to scope `WITHHOLDING_AT_SOURCE` if you want better UX but the server is authoritative regardless), Withholding Calculated On (select, options exactly `SUBTOTAL`/`GRAND_TOTAL` — **this exact literal is `GRAND_TOTAL` for Invoice, do NOT copy `TOTAL"` which is what the sibling Purchase Bill module's identical-looking field uses instead, they are genuinely different literals**, defaults server-side to `SUBTOTAL` when omitted), Withheld Amount (optional number, only relevant with a withholding head chosen), Payment Mode (required select, `ref:{endpoint:'/masters/payment-modes'}`, default labelKey), Received Into Bank Account (optional select, `ref:{endpoint:'/masters/bank-accounts', labelKey:'nickname'}`, defaults server-side to the invoice's own `bank_account_id` when omitted — pre-fill the form field with that value so the default is visible, not hidden), Payment Date (required date, not future), Reference (optional text).

Show read-only, non-form context: Balance Due (`invoice.balance_due`), Withheld So Far (`invoice.withheld_total`, only when `> 0`), and a live-computed "Amount Settled" = `amount_received + withheld_amount` (recompute on every keystroke, no server round-trip needed).

Submit `POST /invoices/{id}/payments`, `screenAction:'record_payment'`. On success, navigate back to `/invoices/:id`. Server validates `amount_received + withheld_amount <= balance_due` (422 naming the balance if violated) and `payment_date` not future — surface the 422 detail message as-is on failure, don't duplicate the validation logic client-side beyond basic required-field checks.

### 7. Follow-up: wire Customer 360's Invoices tab

`frontend/src/app/features/customer/screens/customer.invoices.list.config.ts` already exists and works (`GET /invoices?customer_id=...`) but has no `rowRoute` — its own comment says it's waiting on this module. Add `rowRoute: (row) => ['/invoices', row.id]` to it (read the file first, it's a one-line addition matching the exact pattern the Tickets tab used once its own module existed).

## When you're done

Report back:
1. Every file you created/modified, one line each — including the 3 shared-infra files and the customer.invoices.list.config.ts one-liner.
2. The exact lines to add to `frontend/src/app/app.routes.ts` (import + spread, following the pattern of the other modules already wired in there).
3. The exact `SCREEN_ROUTES` entries to add to `frontend/src/app/layout/nav-registry.ts` for `invoice.dashboard`/`invoice.list`/`credit_note.list`.
4. Confirmation that `ng build` passes cleanly (paste the final success output).
5. Any gap, ambiguity, or judgment call you made that a reviewer should know about — especially anything about the `document` shape extension, since that's genuinely new shared surface other code may build on later (Purchase Bill needs it next).
