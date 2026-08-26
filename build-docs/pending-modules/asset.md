# Asset Management module — partial build, paused

## Current state

9 files already exist on disk at `frontend/src/app/features/asset/` (written before the build agent was stopped — these are real, untracked, safe files, not wired into `app.routes.ts`/`nav-registry.ts` yet):

- `asset.api.ts`
- `asset.routes.ts`
- `screens/asset.directory.list.config.ts`
- `screens/asset.create.form.config.ts`
- `screens/asset.record.config.ts`
- `screens/asset.assignment-history.component.ts`
- `screens/asset.maintenance.list.config.ts`
- `screens/asset.maintenance-log.component.ts`
- `screens/asset.requests.list.config.ts`
- `screens/asset.reclaim.component.ts`
- `screens/asset.reports.component.ts`

**Not yet confirmed**: whether these files are complete/correct, whether the agent got to adding the `numberrange` FilterKind to shared `screen.types.ts`/`list-screen.component.ts`/`create-list-store.ts` (it was asked to — check those 3 shared files for a `numberrange` case before assuming it's missing), and whether `ng build`/`ngc` passes against this folder.

## To resume

1. Read all 9 files above to assess completeness against the original brief below.
2. Either hand this exact brief to a fresh Agent to finish/verify the module, or continue by hand.
3. Once satisfied, wire `asset.routes.ts` into `app.routes.ts` and add its `SCREEN_ROUTES` entries to `nav-registry.ts` yourself.

## Original build prompt (verbatim, for reference or re-dispatch)

You are building the Asset Management module frontend for "Meshrd CMS" at `D:\Projects\Company Management Software` (FastAPI+MySQL backend in `backend/`, Angular 19.2 standalone-components frontend with signals in `frontend/`). The backend for this module is 100% already built and working — you are building ONLY the Angular frontend. Five other modules (Employee, Vendor, Customer, RBAC, Leave) are already built this session using the exact conventions below — follow them precisely, don't invent new ones.

### Your scope and hard boundaries

- Build everything under `frontend/src/app/features/asset/` (new folder): `asset.api.ts`, `asset.routes.ts`, `screens/*.ts`.
- Create `asset.routes.ts` exporting `assetRoutes: Routes`, mirroring `frontend/src/app/features/rbac/rbac.routes.ts` and `frontend/src/app/features/employee/employee.routes.ts` exactly (read both first — `screenRoute(id, path, configLoader)` from `../../shared/screens/screen-route` for config-driven shapes; hand-written `Route` objects with `canMatch: [screenAccessGuard(id)]` + `data: {screenId, screenPath}` for bespoke components).
- **DO NOT edit `frontend/src/app/app.routes.ts` or `frontend/src/app/layout/nav-registry.ts`** — report back EXACTLY what to add to each.
- When done, run `cd "D:/Projects/Company Management Software/frontend" && npx ng build --configuration development` and fix every error before reporting done.
- Do not touch any other module's files.

### Established codebase conventions (from the 5 already-built modules — follow exactly)

**The 14 screen shapes** are defined in `frontend/src/app/shared/screens/screen.types.ts` (read this file first, it's ~1700 lines and is the single source of truth for every config field). Read the real components too (`frontend/src/app/shared/screens/list-screen/`, `record-screen/`, `form-screen/`) before writing configs — don't guess field names.

**RefLookup pattern** for resolving a raw FK id to a label: `{ endpoint: '/masters/asset-categories' }` (defaults `labelKey: 'name'`, correct for every Masters sub-master). For an Employee id specifically, there is NO `{id,name}` endpoint — `GET /employees` returns `first_name`/`last_name` as separate fields. The established workaround, used repeatedly already: `{ endpoint: '/employees', labelKey: 'first_name' }` (shows first name only — this is accepted, not a bug to fix). For resolving a raw **User** id (as opposed to an Employee id — e.g. `performed_by`, `approved_by`, `created_by` on some rows) there is NO lookup at all anywhere in this backend; the accepted fallback is a truncated id, e.g. `userId.slice(0, 8)`, matching `customer.files.component.ts`'s existing precedent. Know the difference between an Employee id and a User id on every field you resolve — check the Pydantic schema comment/model, don't assume.

**RowActionDef with a required-reason prompt**: `body: () => ({ approve: false, rejection_reason: window.prompt('Reason (required):', '') })` — runs synchronously when the button fires, matches `frontend/src/app/features/employee/screens/emp.documents.list.config.ts`'s Reject action exactly. Copy that file as your template for any Approve/Reject pair.

**Badge CSS classes** — ONLY these exist in `frontend/src/styles/components.css`: `.b-ok`, `.b-warn`, `.b-danger`, `.b-info`, `.b-neutral`, `.b-outline`. There is NO `.b-success` or `.b-warning` — using those silently renders an uncolored badge (a real bug hit and fixed earlier this session). Use `staticOptions` on a `ColumnDef`/`FieldConfig` for enum labels where possible instead of hand-rolling badge classes.

**Export blob-download** (for any bespoke component that needs its own PDF/Excel button, e.g. the Reports screen): copy the exact mechanism from `frontend/src/app/shared/screens/report-screen/report-screen.component.ts`'s `exportTable()` method (lines ~687-726) — `this.http.get(url, {responseType:'blob', observe:'response'})`, extract filename from `Content-Disposition` header, create a blob URL, click a synthetic `<a download>`, revoke the URL. `ListScreenConfig`/`CalendarScreenConfig` get export for free via `exportable: true` — only hand-roll this for a bespoke component.

**Bespoke component rules (CRITICAL, hit real bugs earlier this session):**
1. Any component that takes `input.required<string>()` (e.g. a record tab hosted via `RecordComponentTab`/`NgComponentOutlet`) MUST do all input-dependent work in `ngOnInit()`, NEVER in the constructor. `NgComponentOutlet` applies dynamic inputs via `setInput()` AFTER construction — reading the input in a constructor throws `NG0950` at runtime (this passed a build cleanly and only broke live in the browser). Every bespoke tab/embedded component in this codebase does `export class X implements OnInit { readonly id = input.required<string>(); ngOnInit(): void { this.load(); } }`.
2. Angular's `@else if (expr; as x)` is ILLEGAL syntax — only a PRIMARY `@if` may bind `as`. If you need this, nest: `} @else { @if (expr; as x) { ... } }`.
3. `[(ngModel)]` on a `Record<string, unknown>`-typed form object needs bracket notation: `form['key']`, never `form.key` — `ng build`'s template type-checker rejects dot-notation there (a bare `tsc` won't catch this, only `ng build`).
4. A bespoke component reads its own record via `HttpClient` directly (`inject(HttpClient)`), not through `RefDataService`.

**RBAC action-string discipline (CRITICAL — caused several silent bugs earlier this session that don't error, just permanently hide a button for everyone):** Before writing any `RowActionDef.screenAction`, `RecordActionDef.screenAction`, `createScreenAction`, or a bespoke component's `policy.can(screen, action)` call, you MUST verify the exact action string against TWO sources and they must agree: (a) the real backend endpoint's `require_screen(SCREEN, action="...")` call in `backend/app/api/v1/assets.py` (grep it — some endpoints have NO `action=` at all, meaning visibility-only, and the correct `screenAction` for those is `'view'`, not a made-up verb, because `frontend/src/app/core/rbac/policy.store.ts`'s `ALWAYS_ALLOWED` regex (`/^(view|open|export|download|preview|print|cancel|back|close|clear)/i`) treats a `screenAction` matching it as "visibility-only", exactly mirroring a no-`action=` backend check); (b) the registered `actions=(...)` tuple for that screen key in `backend/app/rbac/registry/screens.py`. A plausible-sounding but wrong action string doesn't error — the button just silently never renders for any role. Full endpoint→action map for this module is given below; it has already been verified against the source for you — use it as-is, but if you add any endpoint call not listed below, verify it yourself the same way before using it.

**`PolicyStore.can(screenId, action)` gates a button; `PolicyStore.canOpen(screenId)` / `policy.isReadOnly(screenId)` are also available** (inject `PolicyStore` from `../../core/rbac/policy.store` in bespoke components).

### Full technical brief for this module (verified against the real backend source — endpoints, fields, RBAC, and gotchas are all confirmed facts, not guesses)

#### 0. Cross-cutting facts

**0.1** No frontend module exists yet at `frontend/src/app/features/asset/`.

**0.2 RBAC screens/actions** (`backend/app/rbac/registry/screens.py`) — this is the authoritative action list, already cross-checked against every `require_screen(...)` call in `backend/app/api/v1/assets.py`:

| Screen key | `has_scope` | `actions` tuple | `sensitive_fields` |
|---|---|---|---|
| `asset.directory` | `True` | `("edit", "assign")` | `("purchase_value", "current_value")` |
| `asset.maintenance` | `True` | `("edit",)` | none |
| `asset.requests` | `True` | `("approve",)` | none |
| `asset.reports` | `True` | `()` — no actions at all | `("purchase_value", "current_value")` |
| `asset.reclaim` | `False` | `("mark_returned",)` | none |

Every GET-only endpoint calls `require_screen(SCREEN)` with NO `action=` — visibility-only (gate buttons on `policy.can(SCREEN,'view')` or just `canOpen`, never invent an action). Every mutating endpoint's real `action=` value, verified exactly:

| Endpoint | Method | `action=` |
|---|---|---|
| `/assets` | GET | none |
| `/assets` | POST | `"edit"` |
| `/assets/{id}` | GET | none |
| `/assets/{id}` | PUT | `"edit"` |
| `/assets/{id}/pdf` | GET | none |
| `/assets/{id}/location` | PUT | `"assign"` — NOT `"edit"`, so Accountant (holds edit, not assign) never sees this button |
| `/assets/{id}/retire` | POST | `"edit"` |
| `/assets/{id}/assign` | POST | `"assign"` |
| `/assets/{id}/transfer` | POST | `"assign"` |
| `/assets/{id}/unassign` | POST | `"assign"` |
| `/assets/{id}/assignment-history` | GET | none |
| `/assets/{id}/maintenance` | GET | none, but gated on **`asset.maintenance`**, not `asset.directory` (cross-module tab, same pattern as Employee record's Documents tab reusing `employee.documents`) |
| `/assets/{id}/maintenance` | POST | `"edit"` on **`asset.maintenance`** |
| `/maintenance` | GET | none, gated `asset.maintenance` |
| `/asset-requests` | GET | none, gated `asset.requests` |
| `/asset-requests/{id}/approve` | POST | `"approve"` |
| `/asset-requests/{id}/reject` | POST | `"approve"` — SAME action as approve, there is no separate `"reject"` action |
| `/assets/reports/summary` | GET | none, gated `asset.reports` (zero actions registered — this screen is permanently read+export only, nothing to gate a write button on) |
| `/employees/{id}/reclaim-assets` | GET | none, gated `asset.reclaim`, `has_scope=False` |
| `/assets/{id}/reclaim` | POST | `"mark_returned"` |

**0.3 Two different id-spaces on the same row — do not conflate.** `Asset.assigned_to`, `AssetAssignmentHistory.employee_id`, `AssetRequest.employee_id` are Employee ids (resolve via `{endpoint:'/employees', labelKey:'first_name'}`). `AssetAssignmentHistory.performed_by`, `AssetRequest.approved_by`, `Asset.created_by`/`updated_by` are User ids (no lookup exists — truncate: `.slice(0,8)`).

**0.4 `current_value` is `Decimal | str | None`** — the literal string `"Not available"` is a valid value (`AssetOut.current_value`, `backend/app/schemas/asset.py`). Do NOT use `type: 'money'` on this column (its `Number("Not available")` is `NaN`, silently renders as a blank dash, hiding the real "Not available" message). Use a `compute` that returns the string as-is when it's a string, else formats the number.

**0.5 No numeric-range `FilterKind` exists** in `screen.types.ts` (`'select' | 'multiselect' | 'tristate' | 'daterange' | 'activeInactive'` are the only 5 kinds — confirmed by reading `list-screen.component.ts`'s filter-bar `@switch`). This module needs a min/max control in 3 places: Purchase Value range (Directory, Reports), Cost range (Maintenance). **Add a new `'numberrange'` FilterKind**: extend the `FilterKind` union in `screen.types.ts`, add a template case in `list-screen.component.ts`'s filter-bar `@switch` (two plain `<input type=number>` bound to a `{min,max}`-shaped value, mirroring the existing `'daterange'` case's `{preset,from,to}` handling structurally), and extend `create-list-store.ts`'s server-param-building logic to emit `${param}_min`/`${param}_max` for a `'numberrange'` filter the same way it already emits `${param}_from`/`${param}_to` for `'daterange'` (read that file's existing logic first, at the point where filters are turned into query params, and mirror its shape exactly — this is shared infrastructure other modules will also want, so make it generic, not Asset-specific). This is real, deliberate scope for you — not optional. **NOTE FOR RESUMER: check whether this was already added before continuing — several other pending modules' briefs assume it already exists.**

**0.6 Exact server param names — get these right or the backend silently ignores the filter:**
- Directory Purchase Date range → `param: 'purchase_date'`
- Directory Order Date range → `param: 'order_date'`
- Directory Warranty Expiry range → `param: 'warranty_expiry'`
- Directory Purchase Value range → `param: 'purchase_value'` (→ your new `_min`/`_max` suffixing)
- Maintenance Service Date range → `param: 'service_date'`
- Maintenance Next Due Date range → `param: 'next_due'` — NOT `'next_due_date'`
- Maintenance Cost range → `param: 'cost'`
- Asset Requests Date Raised range → `param: 'date'` — NOT `'date_raised'`
- Reports Purchase Date range → `param: 'purchase_date'`, Purchase Value range → `param: 'purchase_value'`

**0.7 Masters refs already built, use directly:** `masters.asset_categories` → `RefLookup { endpoint: '/masters/asset-categories' }` (fields: `id,is_active,name,code,description,default_useful_life_years,is_referenced`). `masters.departments` → `{endpoint:'/masters/departments'}`. Vendor → `{endpoint:'/vendors', labelKey:'vendor_name'}` (NOT `name`). Location/Branch (`CompanyAddress`, no `name` field at all) → `{endpoint:'/masters/company-profile/addresses', labelKey:'line1'}` (imperfect but functional; that endpoint takes no query params, fetch unfiltered). Asset-to-asset ref (Maintenance list's Asset filter) → plain `{endpoint:'/assets'}` works cleanly, `AssetOut.name` is a real top-level field.

**0.8 The `'record'` shape has no create-mode anywhere in this codebase yet** — confirmed by reading `record-screen.component.ts` in full: it hard-requires an `:id` route param, no create branch exists. None of the 3 already-built `'record'`-shape modules (Employee/Vendor/Customer) has a working "+Add" flow either — this is a pre-existing gap across the whole app, not something specific to you to fix elsewhere. For THIS module, since the spec explicitly wants "+ Add Asset" opening a create flow, build it as **two separate configs sharing the RBAC id `asset.directory`**: a `FormScreenConfig` at route `assets/new` (create-only — set `createEndpoint: '/assets'` with method POST, omit `updateEndpoint` so it's permanently create-only per `form-screen.component.ts`'s own "no `:id` param = create mode" rule; on success navigate to `/assets/:id`), plus the `RecordScreenConfig` at `assets/:id` for view/tabs/edit. This is new ground — no existing config to copy, design it from `screen.types.ts`'s `FormScreenConfig` interface directly.

#### 1. Screen: Asset Directory (list)

`ListScreenConfig<AssetRow>`, `id: 'asset.directory'`, `endpoint: '/assets'`, `exportable: true`, `defaultPageSize: 25`.

Query params on `GET /assets` (all confirmed): `category_id`, `status` (repeatable, multiselect server), `assigned_to`, `location_address_id`, `department_id`, `purchase_date_from/_to`, `order_date_from/_to`, `warranty_expiry_from/_to`, `purchase_value_min/_max` (your new numberrange filter), `search` (matches Asset Tag/Name/Serial Number), `format` (`pdf|excel`).

Columns: Asset Tag (`type:'code'`), Name (`cellClass:'cell-strong'`), Category (ref asset-categories), Status (`type:'status'`, staticOptions — statuses are `IN_STORE|IN_USE|UNDER_REPAIR|RETIRED_DISPOSED`, confirm exact values by grepping the DB CHECK constraint or `AssetOut`/model in `backend/app/models/asset.py` before hardcoding labels), Assigned To (ref employees), Purchase Value (`type:'money'`), Current Value (custom `compute`, per 0.4).

Filters: Category (select, optionsRef asset-categories), Status (multiselect, server), Assigned Employee (select, optionsRef employees — `hideForRoles: ['MANAGER']` since a Manager's own `assigned_to` param is silently ignored server-side in favor of team-id scoping, confirmed in `assets.py`'s `list_assets`), Location (select, optionsRef per 0.7), Department (select, optionsRef departments), the 3 date ranges (0.6), Purchase Value range (0.5/0.6). Purchase Value filter: set `hideWhenFieldHidden: 'purchase_value'` (this exact convention already exists in `screen.types.ts`'s `FilterDef` doc comment — read it, it's the documented worked example for this precise situation).

Row click → `/assets/:id`. "+ Add Asset" → `createRoute: ['/assets','new']`, `createScreenAction: 'edit'`.

Export columns are a fixed 5-column server-side set (`asset_tag,name,category,status,assigned_to` — Purchase/Current Value NEVER appear in export, for any role, confirmed in `assets.py`'s `_ASSET_LIST_COLUMNS`) — this is server behavior, nothing to configure client-side.

#### 2. Screen: Asset Master Record (record, at `assets/:id`) + its create form (`assets/new`)

Header shown on every tab: Asset Tag, Name, Category, Status. Tabs: Details (fields), Assignment History (bespoke component), Maintenance & Service Log (bespoke component), Depreciation (plain read-only `RecordFieldsTab`).

**Details tab / create form fields** (exact, from `AssetWrite`/`AssetOut` in `backend/app/schemas/asset.py` — read it yourself to get every validator/required-ness exactly right, this summary is a guide not a substitute):
`asset_tag` (read-only, server-generated `AST-<FY>-####`), `name` (required, 2-100 chars), `category_id` (required, FK), `serial_number` (optional, unique — 422 on clash), `order_date` (optional, must be ≤ purchase_date), `purchase_date` (required, not future), `purchase_value` (optional Decimal, masked field, must be > 0 if given), `useful_life_years` (required IF purchase_value given, else 422), `vendor_id` (optional FK), `warranty_expiry` (optional, must be strictly > purchase_date), `location_address_id` (optional FK — **settable at CREATE only**, general PUT strips it server-side), `department_id` (optional FK — same create-only rule), `status` (read-only, server-set), `assigned_to` (optional FK employee — **CREATE-ONLY**, general PUT strips it, changes only via the Assignment tab afterward), `depreciation_method` (required, only `"STRAIGHT_LINE"` accepted by a DB CHECK today — default it, don't offer other options), `notes` (optional). Get the create form and the edit form asymmetric on purpose: create includes Location/Department/Assigned To; edit shows them read-only (their values still display, just not as editable inputs) with a note that they change via the Assignment tab.

`POST /assets/{id}/retire` — `action="edit"`, takes `reason` as a **required query parameter** (`?reason=...`), NOT a JSON body (it's a bare `reason: str` function param with no Pydantic model) — build this as a `RecordActionDef` with a `window.prompt` for the reason, appended to the endpoint URL as a query string, method POST. 409 if already retired.

##### Tab: Assignment History (bespoke `RecordComponentTab`)

Read-only history table (Employee via employee ref, From Date, To Date, Action [`ASSIGNED|TRANSFERRED|UNASSIGNED`], Performed By via User-id truncation per 0.3, Reason) from `GET /assets/{id}/assignment-history`, plus 3 buttons, each opening a small inline form (mirror the inline-card-form convention in `frontend/src/app/features/employee/screens/emp.leave-attendance.component.ts` or `my-leave.component.ts`'s "Apply for Leave" panel):
- **Assign** (only when Status=IN_STORE): `POST /assets/{id}/assign`, body `{employee_id, effective_date?}`.
- **Transfer** (only when Status=IN_USE): `POST /assets/{id}/transfer`, body `{employee_id, effective_date?, reason}` (reason required, non-blank).
- **Unassign** (only when Status=IN_USE): `POST /assets/{id}/unassign`, no body.

All three gated `policy.can('asset.directory', 'assign')` — inject `PolicyStore` directly in this component (`RecordComponentTab` has no `screenId`/`screenAction` fields, gating is entirely your own component's job, unlike `RecordActionDef`). Also put the Location/Department edit UI here (`PUT /assets/{id}/location`, body `{location_address_id, department_id}`, also gated `"assign"` — this is why Accountant sees this tab but can't act on it).

##### Tab: Maintenance & Service Log — per-asset (bespoke `RecordComponentTab`)

Read-only table + "+ Add Maintenance Entry" inline form. `GET /assets/{id}/maintenance` (gated on `asset.maintenance`, not `asset.directory` — team-scope reused from the host asset's own scope check). `POST /assets/{id}/maintenance` — `action="edit"` on `asset.maintenance`. Body `{log_date, description, cost?, next_due_date?, serviced_by_vendor_id?}`. **No update/delete endpoint exists — append-only**, don't build edit/delete UI. Row fields: `id,asset_id,log_date,description,cost,next_due_date,serviced_by_vendor_id,is_system_generated,source_request_id,maintenance_status` (`COMPLETED|OVERDUE|UPCOMING`, computed server-side). Show `is_system_generated` entries with a small badge/note (they come from approved Repair/Damage requests, `cost`/`next_due_date` are null on those and can never be filled in through any UI).

##### Tab: Depreciation (plain `RecordFieldsTab`, all fields non-editable)

Purchase Value, Useful Life, Depreciation Method, Current Value — all already present on the same `AssetOut` the Details tab already loaded (no extra fetch). Formula (server-computed live on every read, never stored): `Purchase Value − (Purchase Value ÷ Useful Life × years-since-purchase, prorated)`, floored at ₹0. Handle the `current_value` string-or-number union per 0.4.

#### 3. Screen: Maintenance & Service Log — company-wide list

`ListScreenConfig`, `id: 'asset.maintenance'`, `endpoint: '/maintenance'`, `exportable: true`. Columns: Asset Tag, Asset Name, Date, Description, Cost (`type:'money'`, NOT masked here — `asset.maintenance` has no `sensitive_fields` registered, a deliberate asymmetry vs `asset.directory`, don't "fix" it), Next Due Date, Status. Filters per 0.5/0.6/0.7: Category, Location, Asset (specific), Serviced By/Vendor, Service Date range, Next Due Date range, Cost range, `overdue_only`/`upcoming_only` (2 separate boolean/tristate filters, params exactly `overdue_only`/`upcoming_only`). Search covers Asset Tag/Name/Description server-side. No create route on this list screen (creation only happens from inside the per-asset tab).

#### 4. Screen: Asset Requests (Approval Queue)

`ListScreenConfig`, `id: 'asset.requests'`, `endpoint: '/asset-requests'`, `exportable: true`. Columns: Employee (ref), Asset (ref `/assets`), Request Type (`REPAIR|DAMAGE_REPORT|RETURN`, staticOptions), Date Raised, Status (`PENDING|APPROVED|REJECTED` — NEVER "Completed", that value doesn't exist), Description, optional photo (`photo_stored_file_id` — if you show it, treat like any other file id, no filename resolution exists, skip a preview unless trivial). Filters: Status (multiselect server), Request Type (select), Requester (select, employees ref), Approver (select, employees ref keyed by **User id** — same 0.3 caveat, label resolution will be imperfect/id-based, that's expected), Asset Category (select), Date Raised range (`param:'date'` per 0.6). Search matches Asset Tag/Name/Description.

Row actions: **Approve** (`POST /asset-requests/{id}/approve`, no body, `screenAction:'approve'`, visible only when status=PENDING) and **Reject** (`POST /asset-requests/{id}/reject`, body `{rejection_reason: window.prompt(...)}` required non-blank, SAME `screenAction:'approve'` per 0.2 — there is no separate reject action, don't invent one).

#### 5. Screen: Asset Reports (bespoke component, NOT `ReportScreenConfig`)

Confirmed by reading `report-screen.component.ts`: each `ReportSourceDef` must resolve to a top-level array for a table, or be read whole for tiles — there's no nested-path selector. `GET /assets/reports/summary` returns ONE compound object (`{count_and_value_by_category:[...], due_soon:[...], due_soon_count, retired_count, retired_assets:[...]}`), so `ReportScreenConfig` cannot cleanly represent 3 differently-shaped sections from one endpoint. Build a bespoke component instead (same class as `my-assets.component.ts`): shared filter bar (Category, Location, Department, Status, Assigned Employee, Purchase Date range, Purchase Value range — hand-rolled plain form controls, no generic `FilterDef` machinery available outside `ListScreenConfig`/`ReportScreenConfig`), one `HttpClient` fetch of `/assets/reports/summary?{querystring}` on filter change, 2 KPI tiles (`due_soon_count`, `retired_count`) + 3 hand-rendered tables (by-Category with Count/Total Purchase Value/Total Current Value — value columns OMITTED from the response when the caller's resolved purchase_value mode isn't "show", handle their absence gracefully; Due Soon with Asset Tag/Name/Warranty Expiry/Maintenance Next Due; Retired with Asset Tag/Name/Retired Date). Download PDF/Excel button on the by-Category table only (`?format=pdf|excel` on the SAME summary endpoint — export covers only that one table server-side) using the blob-download mechanism described above. `id: 'asset.reports'` for RBAC gating (`policy.canOpen`) — zero actions registered on this screen, it's permanently read+export only.

#### 6. Screen: Reclaim on Exit (bespoke component, standalone route `assets/reclaim/:employeeId`)

`GET /employees/{employee_id}/reclaim-assets` (gated `asset.reclaim`, `has_scope=False`, no team-scoping at all — HR/SA only). Lists the exiting employee's `IN_USE` assets (Asset Tag, Name, Category — there is NO "Assigned Date" field on this response, don't invent one, it's a confirmed gap). Row action: **Mark Returned** — build as a small inline form per row (radio: "Returned, working condition" vs "Not working/damaged" + conditional required reason textarea), `POST /assets/{id}/reclaim`, body `{working_condition: bool, reason?: string}` (reason required server-side when `working_condition` is false). `screenAction`/gate: `policy.can('asset.reclaim','mark_returned')`.

**Also wire the Employee module's Exit Checklist link to this screen** — edit `frontend/src/app/features/employee/screens/resignation.exit-checklist.config.ts` (read it first) and add a `route` function to its `ChecklistItemDef`: when `item.step_key === 'RETURN_ALL_ASSETS'`, return `['/assets','reclaim', item.employee_id]` (else `null`) — this wires up a link the Employee module deliberately left unset waiting for this module to exist. This is the ONE file outside `features/asset/` you should touch; everything else stays inside your own folder.

#### 7. Download Asset Card / Asset List (not separate routes)

Two buttons on existing screens, no new RBAC surface: "Download Asset Card" on the Master Record (`GET /assets/{id}/pdf`, `canOpen` only, same blob-download mechanism) and the Directory's own `exportable: true` (already covers "Download Asset List").

### What NOT to build (confirmed absent from the backend — don't invent UI for these)

- A "Condition" field on Asset — never defined anywhere.
- Attachments on Asset (`asset_files` table exists but no attach/list endpoint is wired to it).
- Maintenance entry edit/delete — append-only, no endpoint exists.
- Created By/Last Modified By columns or filters on Asset Directory — `AssetOut` doesn't expose these fields at all, and `list_assets()` has no matching query params. This is a real, confirmed backend gap — do not build it, and don't work around it with a fake client-side field.
- A dedicated "Transfer" REQUEST type — Transfer is only ever a direct HR/SA action via the Assignment tab, never something an employee requests; `AssetRequestWrite.request_type` only validates `REPAIR|DAMAGE_REPORT|RETURN`.
- "Completed" as a request status — only `PENDING|APPROVED|REJECTED` exist.
- A separate "reject" RBAC action — covered above, don't invent one.
- A Financial Year filter on Reports — Purchase Date range is the real substitute.
- Assigned Date column anywhere it isn't actually on the response (Reclaim list, the Employee record's Assigned Assets tab) — it only exists per-asset via the Assignment History endpoint.
