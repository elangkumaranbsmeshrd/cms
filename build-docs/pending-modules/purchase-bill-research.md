# Purchase Bill module — research only (no build brief written yet)

**Do not dispatch this to a build agent until Invoice (see `invoice.md`) has been built and merged** — both modules extend the same shared `document-screen.component.ts`; building them concurrently risks a collision on that file. Once Invoice lands, write a build brief for Purchase Bill following the same style as the other files in this folder, using the research below plus whatever the Invoice agent's final report says about the exact shape of its `document`-shape extension (field names for `createEndpoint`, the new `DocumentActionDef` download kind, etc. — Purchase Bill should reuse those exact names, not reinvent them).

---

# Purchase Bill Module (13) — Frontend Implementation Brief

Verified against real backend source and the real frontend codebase on 2026-08-08. Every claim below is either a direct quote/citation from source or explicitly marked as a recommendation/inference. Read **Section 0** first — it changes how this module should be scoped before anyone opens a config file.

## 0. Top-line findings (read before anything else)

1. **Nothing of this module exists in the frontend yet.** `grep -ril "purchase|bill" frontend/src/app/features` returns zero hits outside Masters (HSN/SAC, bank accounts, taxes) and Vendor's own `vendor.usage.list.config.ts` (which mentions `purchase_bill_count` as a rollup number, not a screen). No `features/purchase-bill/` (or similar) folder exists.

2. **Exactly one RBAC screen key governs all three UI screens**: `purchase_bill.list` (`backend/app/rbac/registry/screens.py:235`), `actions=("edit", "record_payment")`, `has_scope=False`. There is no separate `purchase_bill.detail` or `purchase_bill.payment` key — List, Add/Edit, and Record Payment all gate off this one key, exactly like `invoice.list` does for Invoice's four screens.

3. **A real, confirmed backend RBAC gap will block Accountant — the module's own primary/only operative role — from three Masters lookups this module's fields need**: `masters.bank_accounts`, `masters.payment_modes`, `masters.hsn_sac_codes` are all seeded `ACCOUNTANT: "none"` in `backend/app/seed.py`. Because `require_screen()` 404s a screen whose mode isn't in `VISIBLE_MODES`, **`GET /masters/bank-accounts`, `GET /masters/payment-modes`, and `GET /masters/hsn-sac-codes` will all 404 for an Accountant user.** This is not a frontend bug and cannot be worked around in the frontend — it needs a `seed.py` change (flag it, same as Invoice/Expense's identical gap). Full detail in §3.4.

4. **The `document` shape — the shape explicitly built for "Invoice/Purchase Bill detail screens" — is the right fit for screen 2.2, but its current implementation (as of this research) has five confirmed gaps** relative to what this screen needs (no create/POST path at all, no file-upload rendering, line items can't be sourced from a live Masters lookup, totals can't live-recompute anything except line-item-derived figures, and no per-mode field editability). **By the time you build this, check whether Invoice's build already fixed some/all of these** (Invoice's brief instructed it to fix create-mode + `createOnly` field-locking + a download action kind) — Purchase Bill still independently needs: file-upload rendering (`type:'file'` field branch), a `ref` field on `ArrayColumnConfig` for HSN Code (Masters-backed line-item dropdown), and ideally live totals recompute off `tax_amount_override`/`withholding_*` fields (Subtotal already recomputes live off line items alone; Tax/Total/Withholding do not, since `totals()` only receives the frozen loaded `row`, not the live `formModel` — check if Invoice's build widened this).

5. **Screen 2.3 (Record Payment) has no shape that fits at all** — it needs a bespoke Angular component, wired manually into the router (not through `screenRoute()`'s generic `screen-host` dispatch). Detail in §4.3.

6. **The spec's own claim that "+ Add New Vendor" inline-modal precedent is "already established in the Vendor module"** refers to the *spec document*, not to anything actually built. `vendor.directory.config.ts` has no `createRoute`, `vendor.routes.ts` only registers `vendors` and `vendors/:id`, and `RecordScreenComponent` has no create-mode support either. This pattern must be built from scratch if wanted (recommend skipping it — not required for a functional module).

## 1. Module & screen inventory (source of truth: `nav-registry.ts`)

`frontend/src/app/layout/nav-registry.ts`: `{ module: 'purchase_bill', label: 'Purchase Bill' }` — confirms the module key and that it's a top-level nav group. `SCREEN_ROUTES` has no entry for `purchase_bill.list` yet — needs exactly one:
```ts
'purchase_bill.list': '/purchase-bills',
```

| Spec screen | Route (recommended) | Shape |
|---|---|---|
| 2.1 Purchase Bill List | `/purchase-bills` | `list` |
| 2.2 Add / Edit Purchase Bill | `/purchase-bills/new` (create) and `/purchase-bills/:id` (edit) | `document`, extended |
| 2.3 Record Payment | `/purchase-bills/:id/record-payment` | bespoke component |

## 2. Backend contract — verified against `backend/app/api/v1/purchase_bills.py`

Router: `APIRouter(prefix="/purchase-bills", tags=["purchase_bill"])`. `SCREEN = "purchase_bill.list"`.

### 2.1 Every endpoint, RBAC gate, and query param (exact)

| Method & path | RBAC dependency | Action gate | Query params (exact names) |
|---|---|---|---|
| `GET /purchase-bills` | `require_screen(SCREEN)` | none — visibility only | `vendor_id`, `status` (repeatable, alias `status_filter`), `bill_date_from`, `bill_date_to`, `overdue` (bool), `ageing` (`Current`\|`1-30`\|`31-60`\|`61-90`\|`90+`), `search`, `format` (`pdf`\|`excel`) |
| `POST /purchase-bills` | `require_screen(SCREEN, action="edit")` | `edit` | body: `PurchaseBillCreate` |
| `GET /purchase-bills/{bill_id}` | `require_screen(SCREEN)` | none — visibility only | — |
| `PUT /purchase-bills/{bill_id}` | `require_screen(SCREEN, action="edit")` | `edit` | body: `PurchaseBillCreate` (same shape as create) |
| `POST /purchase-bills/{bill_id}/payments` | `require_screen(SCREEN, action="record_payment")` | `record_payment` | body: `PurchaseBillPaymentCreate` |
| `GET /purchase-bills/{bill_id}/payments` | `require_screen(SCREEN)` | none — visibility only | — |

Search matches (line 71): **Vendor Bill Number, Internal Bill ID, Supplier Name** — `PurchaseBill.vendor_bill_number.ilike | .purchase_bill_code.ilike | .vendor_name_snapshot.ilike`.

`format=pdf|excel` re-shapes the filtered/searched set via `list_export.build_export`, columns `Bill Number / Vendor / Bill Date / Due Date / Total / Status` (`_LIST_COLUMNS`) — narrower than the on-screen list (no Paid, Bank Account), that's real export behavior, not a frontend concern to fix.

**Ageing/Overdue are filter-only** — computed per-request server-side (`ageing_bucket()`, `finance_engine.py:85-122`), NOT fields on `PurchaseBillOut`. If you want to show an ageing tag per row, recompute client-side from `due_date`/`status` (buckets: `≤0`=Current, `1-30`, `31-60`, `61-90`, `90+`; `PAID` or null `due_date` = no bucket).

### 2.2 Exact schema fields — `backend/app/schemas/finance.py:11-118`

**`PurchaseBillCreate`** (body for both POST create and PUT edit):
```
vendor_id: str
vendor_bill_number: str
bill_date: date
due_date: date | None = None
notes: str | None = None
attachment_stored_file_id: str | None = None
bank_account_id: str | None = None
linked_expense_claim_id: str | None = None
tax_head_id: str | None = None
tax_amount_override: Decimal | None = None
withholding_tax_head_id: str | None = None
withholding_calculated_on: str | None = None   # 'SUBTOTAL' | 'TOTAL'  ← note: TOTAL here, GRAND_TOTAL on Invoice's equivalent field — different literal, do not copy across modules
withholding_amount_override: Decimal | None = None
line_items: list[PurchaseBillLineItemIn]
```

**`PurchaseBillLineItemIn`**: `description: str`, `hsn_code_id: str | None`, `quantity: Decimal`, `rate: Decimal`. (No `id` — matches `DocumentLineItemsConfig.emptyItem()`'s convention.)

**`PurchaseBillOut`** (response — quoted exactly):
```
id, purchase_bill_code, vendor_id, vendor_bill_number, vendor_name_snapshot,
vendor_gstin_snapshot, bill_date, due_date, payment_terms_days_snapshot,
attachment_stored_file_id, has_attachment, bank_account_id,
effective_bank_account_id,        # added by the router, not a DB column
linked_expense_claim_id, subtotal, tax_head_id, tax_amount, total_amount,
withholding_tax_head_id, withholding_calculated_on, withholding_amount,
withholding_head_name_snapshot, amount_payable_to_vendor, amount_paid,
balance_due, status, paid_at, notes,
line_items: list[PurchaseBillLineItemOut],
tax_lines: list[PurchaseBillTaxLineOut]
```
`PurchaseBillLineItemOut` adds `id`, `sequence`, `line_total` (DB-computed) on top of the `In` fields. `PurchaseBillTaxLineOut`: `id, sequence, tax_head_id, head_name_snapshot, print_label_snapshot, computed_base, computed_amount, entered_amount, component_name_snapshot`.

**`effective_bank_account_id`** is populated by `_load_bill_out()` (router, lines 119-132) — `latest_payment.paid_from_bank_account_id if latest_payment else bill.bank_account_id`. This is the "effective account per row" for the List's Bank Account column.

**DB-computed columns — never send these back on save**: `has_attachment`, `total_amount` (`= subtotal + tax_amount`), `amount_payable_to_vendor` (`= subtotal + tax_amount − withholding_amount`), `balance_due` (`= subtotal + tax_amount − withholding_amount − amount_paid`), and line item `line_total` (`= quantity * rate`).

**`PurchaseBillPaymentCreate`**: `amount: Decimal`, `payment_mode_id: str`, `paid_from_bank_account_id: str | None`, `payment_date: date`, `reference: str | None`.

**`PurchaseBillPaymentOut`**: `id, purchase_bill_id, amount, balance_due_at_entry, payment_mode_id, paid_from_bank_account_id, paid_into_account_name_snapshot, paid_into_bank_name_snapshot, paid_into_account_number_masked_snapshot, payment_date, reference, status, recorded_by, recorded_at`. Note: **`paid_into_ifsc_snapshot` is a real column on the model but NOT in `PurchaseBillPaymentOut`** — captured and stored, never returned. Not fixable frontend-only.

### 2.3 Status & rules — exact logic, quoted

`resolve_purchase_bill_status(amount_paid, withholding_amount, total_amount)` (`services/finance_engine.py:19-31`):
```python
settled = amount_paid + withholding_amount
if settled <= 0: return "UNPAID"
if settled >= total_amount: return "PAID"
return "PART_PAID"
```

**Payment ceiling**: `if body.amount > bill.balance_due: 422`. **Payment status guard**: `if bill.status not in ("UNPAID", "PART_PAID"): 409`.

**Double-payment guard** (`services/finance_link_guard.py:27-50`): blocked with a specific message if the bill's `linked_expense_claim_id` has a live (`status == "RECORDED"`) `ExpenseReimbursement`. Exact block text worth surfacing verbatim from the 409: *"This bill is linked to an Expense Claim that has already been reimbursed — paying the bill too would settle the same spend twice. Reverse the reimbursement first if the bill genuinely needs to be paid separately, or remove the link."*

**Payment default account fallback is server-side**: `paid_from_bank_account_id or bill.bank_account_id` — frontend doesn't need to pre-fill this before submit, though pre-filling for display is still correct UX.

**Create/Edit validation, exact rejection triggers**:
- Vendor not found → 404. Vendor `is_active == False` → 422 `"Cannot bill an inactive vendor"`.
- `bill_date > today` → 422 `"Bill Date cannot be in the future"`.
- Edit only: `vendor_id` changed → 422 `"Vendor cannot be changed after creation"`; `linked_expense_claim_id` changed → 422 `"Linked Expense Claim cannot be changed here — remove the link on the claim itself"`.
- Tax/withholding head not found → 404. Head fails `validate_head_usable()` → 422 with the specific reason string.
- `withholding_amount > total_amount` → 422 `"Withholding Amount cannot exceed the bill Total"`.
- Linked claim already linked elsewhere → 409 `"That Expense Claim is already linked to a different Purchase Bill"`.

**No server-side check that `due_date` is after `bill_date`** — add as a client-side-only check.

## 3. RBAC — verified against `screens.py` + `seed.py`

### 3.1 Screen registration
```python
"purchase_bill.list": ScreenDef(key="purchase_bill.list", module="purchase_bill", label="Purchase Bill", has_scope=False, actions=("edit", "record_payment")),
```

### 3.2 Full role-access table

| Role | Mode | `edit` | `record_payment` |
|---|---|---|---|
| SUPER_ADMIN | full | ✅ | ✅ |
| MANAGER | none | — | — |
| ACCOUNTANT | full | ✅ | ✅ |
| HR | none | — | — |
| EMPLOYEE | none | — | — |

### 3.3 `ALWAYS_ALLOWED` regex trap — checked, clean

Neither `edit` nor `record_payment` matches `/^(view|open|export|download|preview|print|cancel|back|close|clear)/i` — real per-role grant is correctly consulted, not bypassed.

One deliberate, correct use of the regex: a Cancel/Back button on `DocumentActionDef` (which requires `screenAction` even for pure navigation) should use `screenAction: 'cancel'` — `.can()` then falls through to `canOpen(screenId)`, exactly right for a nav-only button.

### 3.4 Cross-module RBAC — the confirmed blocking gap

| Screen key | Endpoint(s) it gates | ACCOUNTANT mode | Reachable by Accountant? |
|---|---|---|---|
| `vendor.directory` | `GET /vendors` | `full` | ✅ Yes |
| `masters.taxes` | `GET /masters/taxes` | `view` | ✅ Yes (read-only, sufficient for a dropdown) |
| `masters.bank_accounts` | `GET /masters/bank-accounts` | **`none`** | ❌ **404** |
| `masters.payment_modes` | `GET /masters/payment-modes` | **`none`** | ❌ **404** |
| `masters.hsn_sac_codes` | `GET /masters/hsn-sac-codes` | **`none`** | ❌ **404** |
| `expense.all_expenses` | `GET /expenses` | `full` | ✅ Yes |

This is a `seed.py` fix (grant `ACCOUNTANT` at least `"view"` on those three screen keys), out of frontend scope, but flag it loudly in the build report — it's the same systemic gap Invoice and Expense both independently hit too.

## 4. Screen shape fit

### 4.1 Screen 2.1 — Purchase Bill List → `ListScreenConfig`. Good fit.

**Filters to build**: Supplier (`vendor_id`, select, `optionsRef:{endpoint:'/vendors', labelKey:'vendor_name'}`), Status (`status`, multiselect, server), Bill Date range (`bill_date`, daterange, server → `bill_date_from`/`_to`), Overdue (`overdue`, tristate, server), Ageing (`ageing`, select, server, options literally `Current`/`1-30`/`31-60`/`61-90`/`90+` — must match backend strings exactly).

**Do NOT build**: Due Date range, Amount range, Outstanding Amount range, Payment Mode filter, Bank Account filter, Created By, Financial Year — none of these have supporting query params on the real endpoint.

**Columns**: Internal Bill ID (`purchase_bill_code`), Vendor (`vendor_name_snapshot`, already denormalized), Vendor's Bill Number (`vendor_bill_number`), Total (`total_amount`, money), Paid (`amount_paid`, money), Bank Account (`effective_bank_account_id`, `ref:{endpoint:'/masters/bank-accounts', labelKey:'nickname'}`), Status (staticOptions), Bill Date, Due Date (date).

**Confirmed spec/schema mismatch — do not build a Last Modified By column**: `PurchaseBillOut` has no `updated_by`/`updated_at`/any last-modified field at all, even though the model has real audit columns — the schema just never projects them.

`createRoute:['/purchase-bills','new']`, `createLabel:'Add Purchase Bill'`, `rowRoute:(row)=>['/purchase-bills',row.id]`. `defaultPageSize:25` (client-side paging over the full fetched set — the API has no server pagination, confirmed).

### 4.2 Screen 2.2 — Add/Edit Purchase Bill → `DocumentScreenConfig`, extended

**Before writing this config, check what Invoice's build (see `invoice.md`) already did to `document-screen.component.ts`/`screen.types.ts`** — reuse its exact field/kind names for create-mode (`createEndpoint`), `createOnly` field-locking, and the download action kind, rather than re-inventing them. Purchase Bill still independently needs, on top of whatever Invoice added:

- **File-upload rendering**: `DocumentScreenComponent`'s field template has no `field.type === 'file'` branch (only `select`/`checkbox`/`checkgroup`/`textarea`/plain text). Port the working branch from `singleton-form.component.ts` (backed by `FileUploadService`, `POST /files` multipart + `purpose` string). Upload purpose to use: **`purchase_bill_attachment`** (`backend/app/api/v1/files.py:42`, PDF/JPEG/PNG up to 10MB).
- **`ArrayColumnConfig.ref` support**: line-item columns only support `type` + `staticOptions`, no `ref` field, no `RefDataService` call anywhere in the line-items block. HSN/SAC Code is a real, growing Masters list (`GET /masters/hsn-sac-codes`) — cannot be reasonably hardcoded. Add `ref?: RefLookup` to `ArrayColumnConfig`, wire the line-items `select` branch to call `refData.options(col.ref)` when present (mirroring exactly how the `fields`-section `selectOptions()` already does it).
- **Live totals**: check if Invoice's build widened `totals(row, items)` to also receive live `formModel`. If not, Tax Amount/Total/Withholding/Amount Payable cannot truly live-recompute (only Subtotal, which is purely line-item-derived, can). This is a real, disclosable UX gap either way — flag whichever state you find it in.
- **Per-mode field editability**: Vendor and Linked Expense Claim must be editable on create but locked on edit — check whether Invoice's `createOnly` fix already covers this generically (it should, if built correctly).

**Field mapping**:

| Spec field | `formModel` key | Type / notes |
|---|---|---|
| Vendor | `vendor_id` | `select`, `ref:{endpoint:'/vendors?is_active=true', labelKey:'vendor_name'}` (baking `is_active=true` into the literal endpoint string works — `GET /vendors` genuinely supports that param). `createOnly:true` |
| Vendor Bill Number | `vendor_bill_number` | text, required |
| Bill Date | `bill_date` | date, required, client max=today |
| Due Date | `due_date` | date, optional. Client-side check "after Bill Date" — not server-enforced |
| Notes | `notes` | textarea |
| Attachment | `attachment_stored_file_id` | `type:'file'`, `uploadPurpose:'purchase_bill_attachment'`, accept PDF/JPEG/PNG |
| Bank Account | `bank_account_id` | `select`, `ref:{endpoint:'/masters/bank-accounts', labelKey:'nickname'}` — **no active-only filter exists on this endpoint at all**, inactive accounts WILL appear, not fixable frontend-only (same gap independently documented in `masters/screens/expense-types.form.config.ts`) |
| Linked Expense Claim | `linked_expense_claim_id` | `select`, `ref:{endpoint:'/expenses', labelKey:'description'}` (no code/number field exists, no unlinked-only filter — best available label). `createOnly:true` |
| Tax Head | `tax_head_id` | `select`, `ref:{endpoint:'/masters/taxes', labelKey:'tax_name'}` — shows every tax head unfiltered, no server or client filter mechanism exists (`GET /masters/taxes` only supports `?format=`); spec's own text anticipates this ("Head validation is server-side, not just a filtered dropdown") |
| Tax Amount (override) | `tax_amount_override` | number — direct entry always allowed, even with no head picked (deliberate, unlike Invoice) |
| Withholding Tax | `withholding_tax_head_id` | same `/masters/taxes` ref, same unfiltered caveat |
| Withholding Calculated On | `withholding_calculated_on` | select, `staticOptions:[{value:'SUBTOTAL',label:'Subtotal'},{value:'TOTAL',label:'Total'}]` — **`TOTAL` not `GRAND_TOTAL`, different from Invoice's equivalent field**. `visibleWhen:(m)=>!!m.withholding_tax_head_id` |
| Withholding Amount (override) | `withholding_amount_override` | number, same `visibleWhen` |

**Line items**: Description (text), HSN Code (`select`, `ref:{endpoint:'/masters/hsn-sac-codes', labelKey:'code'}` — MUST be explicit, `HsnSacCodeOut` has no `name` field, omitting labelKey renders every option as literal `"undefined"`), Quantity (number), Rate (number). `lineTotal:(item)=>Number(item.quantity??0)*Number(item.rate??0)`.

**Totals rows**: Subtotal, Tax Amount, Total (`emphasize:true`), Withholding (only shown when `withholding_amount > 0`), Amount Payable to Vendor (only shown when withholding applies).

**Header**: `icon:'purchase'` (confirmed registered), `recId:(r)=>r.purchase_bill_code`, `name:(r)=>r.vendor_name_snapshot`, `badge:(r)=>r.status`, summary tiles Total/Withholding(if any)/Payable/Paid/Balance Due.

**Status badge colors** — the real shared `badgeClass()` convention (`cell-format.ts`, comment literally `// invoice / bill`) is `unpaid:'b-danger'` (red), `'part paid':'b-warn'` (amber), `paid:'b-ok'` (green) — follow this existing convention, don't invent different colors (a stale spec assumption suggests amber/blue/green, that's wrong, don't build to it).

**Actions**: Save (`kind:'save'`, `screenAction:'edit'`), Cancel (`kind:'route'`, `screenAction:'cancel'`, back to `/purchase-bills`), Record Payment (`kind:'route'`, `screenAction:'record_payment'`, `route:(r)=>['/purchase-bills',r.id,'record-payment']`, `visible:(r)=>r.status!=='PAID'`). **No PDF/Download action** — confirmed no single-document PDF route exists for Purchase Bill anywhere in the backend. `note` when applicable: something like *"No PDF is generated for a Purchase Bill — it's an internal record of something already received. Open the Attachment above to view the vendor's original document."* `locked`: omit — no lock-on-Paid check exists server-side for this module.

**Note on where Record Payment is triggered from**: spec text doesn't explicitly place a Record Payment button on this screen, but the most consistent reading (matching Invoice's own precedent) is a page action, shown only when editing an existing Unpaid/Part-Paid bill — build it that way.

### 4.3 Screen 2.3 — Record Payment → bespoke component, no shape fits

`FormScreenConfig` doesn't fit (real `GET/{id}` exists, and the endpoint is a parent-id-scoped sub-resource create, which `FormScreenConfig`'s fixed-string endpoints can't parameterize). Build a plain standalone Angular component, registered directly as its own `Route` in `purchase-bill.routes.ts` (not via `screenRoute()`, no `ScreenConfig` shape exists for this).

**Important**: `screenAccessGuard()` only checks `policy.canOpen(screenId)` — screen visibility, not the specific `record_payment` action. The bespoke component must independently check `policy.can('purchase_bill.list', 'record_payment')` itself and redirect/block if false (mirroring how `DocumentActionDef`'s own visibility check works for the button that links here).

**Fields** (`POST /purchase-bills/{bill_id}/payments`, body = `PurchaseBillPaymentCreate`):

| Spec field | Backend field | Notes |
|---|---|---|
| Balance Due | *(read-only display)* | from `GET /purchase-bills/{id}`, `balance_due` |
| Withheld on this Bill | *(read-only display)* | `withholding_amount`, shown only when `> 0` |
| Amount | `amount` | number, required, client max-check against `balance_due` |
| Mode | `payment_mode_id` | select, required, `ref:{endpoint:'/masters/payment-modes', labelKey:'name'}` (blocked for Accountant per §3.4) |
| Paid From | `paid_from_bank_account_id` | select, optional, `ref:{endpoint:'/masters/bank-accounts', labelKey:'nickname'}` (blocked for Accountant per §3.4; no active-only filter), default-select to the bill's own `bank_account_id`/`effective_bank_account_id` |
| Paid Into (Vendor's Account) | *(read-only display, post-submit only)* | not entered here — derived server-side, only visible afterward via the resulting payment record's `paid_into_*` fields |
| Date | `payment_date` | date, required |
| Reference | `reference` | text, optional |

Buttons: Record Payment (POST, then navigate to `/purchase-bills/:id`), Cancel (pure nav, no RBAC action needed).

## 5. Masters / cross-module dependency table (consolidated)

| Dependency | Endpoint | `labelKey` | RBAC screen key | ACCOUNTANT reachable? | Known limitation |
|---|---|---|---|---|---|
| Vendor | `GET /vendors` (`?is_active=true` recommended) | `vendor_name` | `vendor.directory` | ✅ `full` | — |
| Bank Account | `GET /masters/bank-accounts` | `nickname` | `masters.bank_accounts` | ❌ `none` | No active-only filter server-side at all |
| Payment Mode | `GET /masters/payment-modes` | `name` | `masters.payment_modes` | ❌ `none` | — |
| HSN/SAC Code | `GET /masters/hsn-sac-codes` | **`code`** (not `name`) | `masters.hsn_sac_codes` | ❌ `none` | Needs `ArrayColumnConfig.ref` support |
| Tax Head (Tax / Withholding) | `GET /masters/taxes` | `tax_name` | `masters.taxes` | ✅ `view` | Unfiltered by scope/date/direction — no endpoint supports it |
| Linked Expense Claim | `GET /expenses` | `description` (best available) | `expense.all_expenses` | ✅ `full` | No "unlinked only" filter, no clean code/number field |

## 6. Module 15 (Tax & Compliance) dependency — confirmed, affects build order

`backend/app/services/obligation_engine.py` reads directly from `PurchaseBill` rows for its Obligations screen (withholding-bearing bills). Confirmed dependency direction: Module 15 reads FROM Purchase Bill, never the reverse — Purchase Bill has zero dependency on Compliance. Only matters for *Module 15's* build/test order (its Obligations screen will show nothing for the `PURCHASE_BILL` source type until real withholding-bearing bills exist) — not a current blocker since Module 15's frontend is separately being built too.

## 7. Routing plan

```
frontend/features/purchase-bill/
  purchase-bill.api.ts
  purchase-bill.routes.ts
  screens/
    purchase-bill.list.config.ts
    purchase-bill.document.config.ts   # used by BOTH /new and /:id
    purchase-bill-record-payment.component.ts
```

```ts
export const purchaseBillRoutes: Routes = [
  screenRoute('purchase_bill.list', 'purchase-bills', () => import('./screens/purchase-bill.list.config')),
  screenRoute('purchase_bill.list', 'purchase-bills/new', () => import('./screens/purchase-bill.document.config')),
  screenRoute('purchase_bill.list', 'purchase-bills/:id', () => import('./screens/purchase-bill.document.config')),
  // record-payment: bespoke, own hand-written Route with canMatch:[screenAccessGuard('purchase_bill.list')]
];
```

`nav-registry.ts` addition: `'purchase_bill.list': '/purchase-bills'`.

## 8. Consolidated gap list

**Backend (out of frontend scope, flag don't fix)**: (1) `seed.py` ACCOUNTANT gap on 3 Masters screens (§3.4). (2) `PurchaseBillOut` missing Last-Modified-By fields. (3) `PurchaseBillPaymentOut` drops `paid_into_ifsc_snapshot`. (4) `GET /masters/bank-accounts` has no active-only filter. (5) No HTTP endpoint exposes a filtered tax-head list. (6) `GET /expenses` has no "exclude linked" filter and `ExpenseClaimOut` has no clean label field.

**Shared frontend infrastructure (`document` shape)**: check Invoice's build first — it should have fixed create-mode, `createOnly`, and a download action kind. Purchase Bill still needs, regardless: file-type field rendering, `ArrayColumnConfig.ref` support, and ideally live totals for tax/withholding fields (not just line-item-derived Subtotal).

**Minor pitfalls**: HSN/SAC `ref` needs explicit `labelKey:'code'`. Status badge colors: follow the real `cell-format.ts` convention (red/amber/green), not a stale spec guess (amber/blue/green). `withholding_calculated_on`'s literal is `TOTAL` here, `GRAND_TOTAL` on Invoice — do not copy across modules.
