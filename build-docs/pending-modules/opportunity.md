# Opportunity module — build brief (saved, not yet dispatched to a fresh agent)

Hand the section below verbatim to a new background Agent (general-purpose, run_in_background: true) to build this module. No shared-infra dependency on other pending modules — safe to build any time, in parallel with anything else. (It IS the first real consumer of the `board` shape, same as Asset/Project — this is safe since none of them need to MODIFY that already-complete shared component, only use it.)

---

You are building the Opportunity module frontend for "Meshrd CMS" at `D:\Projects\Company Management Software` (FastAPI+MySQL backend in `backend/`, Angular 19.2 standalone-components frontend with signals in `frontend/`). The backend is 100% already built — you are building ONLY the Angular frontend. Several other modules are already built or building concurrently — don't touch their folders.

## Your scope and hard boundaries

- Build everything under `frontend/src/app/features/opportunity/` (new folder): `opportunity.api.ts`, `opportunity.routes.ts`, `screens/*.ts`.
- One small follow-up outside your folder is required and justified: `frontend/src/app/features/customer/screens/customer.opportunities.list.config.ts` already exists and works, but has no `rowRoute` — its own comment says it's waiting on this module. Once your record route exists, add `rowRoute: (row) => ['/opportunities', row.id]` to that file. One line, nothing else in that file needs touching.
- **DO NOT edit `frontend/src/app/app.routes.ts` or `frontend/src/app/layout/nav-registry.ts`** — other processes may be editing those concurrently; report back the exact lines to add instead.
- When done, run `cd "D:/Projects/Company Management Software/frontend" && npx ng build --configuration development` and fix every error before reporting done. Since new files won't be reachable from `main.ts`'s import graph until routes are wired centrally, verify for real: create a temp `tsconfig` extending `tsconfig.app.json` scoped to `src/app/features/opportunity/**/*.ts`, run `npx ngc` against it, confirm zero errors, then delete the temp tsconfig/output and confirm via `git status` nothing stray remains.
- Do not touch any other module's files.

## Established codebase conventions (from already-built modules — follow exactly)

**The 14 screen shapes** live in `frontend/src/app/shared/screens/screen.types.ts` (read in full first). Also read `board-screen.component.ts` in full — check `frontend/src/app/features/asset/` first (may already exist by the time you build) for a live `BoardScreenConfig` usage example to copy from; if it doesn't exist yet, work from the type definitions directly, they're accurate.

**Badge CSS classes**: ONLY `.b-ok`, `.b-warn`, `.b-danger`, `.b-info`, `.b-neutral`, `.b-outline` exist. Good news: `cell-format.ts`'s shared `badgeClass()` dictionary ALREADY has exact entries for this module's stage values (`prospecting:'b-neutral', qualifying:'b-info', proposal:'b-warn', won:'b-ok', lost:'b-danger'`) — any `type:'status'` column on the raw `stage` field gets correct coloring for free, nothing to add.

**`visibleWhen` pattern** for a conditionally-shown/required field (Lost Reason only when Stage=Lost): copy `frontend/src/app/features/masters/screens/taxes.form.config.ts`'s `visibleWhen: whenMethod('SLAB')`-style usage as your direct template. `FormScreenComponent`'s `save()` only requires/submits fields currently passing `visibleWhen` — a hidden field is stripped from the body entirely (not sent as null), which is exactly the "clears any previously stored reason" behavior the backend also does server-side.

**Required-reason window.prompt pattern**: `body: () => ({ field: window.prompt('...', '') })` — precedent at `frontend/src/app/features/leave/screens/leave.approvals.list.config.ts` / `frontend/src/app/features/employee/screens/document-verification-queue.list.config.ts`.

**Bespoke "record page with tabs + page-level action buttons" pattern**: neither `tabbed` nor `record` shape supports what you need for the Opportunity Record screen (detailed in §4 below) — model your bespoke wrapper on `frontend/src/app/features/customer/screens/customer.activities.component.ts` and `customer.files.component.ts` (read both in full), which already solve "a tab body doing its own fetch/CRUD against a sub-resource of a parent record passed in via `@Input`."

**Bespoke component rules (CRITICAL, hit real bugs earlier this session):**
1. Any component taking `input.required<string>()` MUST do input-dependent work in `ngOnInit()`, NEVER the constructor.
2. `@else if (expr; as x)` is ILLEGAL — only a PRIMARY `@if` may bind `as`. Nest instead.
3. `[(ngModel)]` on a `Record<string, unknown>`-typed object needs bracket notation: `form['key']`, never `form.key`.

**RBAC**: every `screenAction` below is verified. `frontend/src/app/core/rbac/policy.store.ts`'s `ALWAYS_ALLOWED` regex has no collision with this module's one real action (`edit`).

## Full technical brief (verified against real backend source)

### 0. Top-line facts

**Every write action in this entire module is `"edit"`.** RBAC registry: `"opportunity.pipeline": ScreenDef(has_scope=False, actions=("edit",))`. Seed: SUPER_ADMIN=full, MANAGER=full, ACCOUNTANT=none, HR=none, EMPLOYEE=none; `edit` action → SUPER_ADMIN+MANAGER. There is no `create`/`delete`/`approve` action anywhere — never gate a button on anything but `'edit'` in this whole module.

Every `require_screen()` call, exact:
| Endpoint | `action=` |
|---|---|
| `GET /opportunities` | none |
| `GET /opportunities/summary/by-stage` | none |
| `GET /opportunities/probability-suggestion` | none |
| `POST /opportunities` | `"edit"` |
| `GET /opportunities/{id}` | none |
| `PUT /opportunities/{id}` | `"edit"` |
| `GET /opportunities/{id}/activities` | none |
| `POST /opportunities/{id}/activities` | `"edit"` |
| `GET /opportunities/{id}/files` | none |
| `POST /opportunities/{id}/files` | `"edit"` (query param `stored_file_id`, not a body field) |
| `DELETE /opportunities/{id}/files/{file_id}` | `"edit"` |

**`GET /opportunities`** query params (exact): `customer_id`, `stage` (repeatable/multi), `owner_id`, `financial_year_id`, `value_min`, `value_max`, `probability_min`, `probability_max`, `expected_close_from`/`_to`, `overdue_only` (bool), `created_from`/`_to`, `lost_reason` (ilike), `stale_days` (int), `created_by`, `last_modified_by`, `search` (matches title/customer company_name/display_name), `format`. Rows sort by `expected_close_date` only server-side. **`GET /opportunities/summary/by-stage`** takes the identical param set, returns `{"by_stage": {"PROSPECTING":{"count","total_value"}, "QUALIFYING":{...}, "PROPOSAL":{...}, "WON":{...}, "LOST":{...}}}`.

**No `FilterKind` exists for a plain number, number range, or free text beyond search** (`FilterKind = 'select'|'multiselect'|'tristate'|'daterange'|'activeInactive'` only, unless a `numberrange` kind has landed by the time you build — check `screen.types.ts` first) — **skip building filters for Value range, Probability range, Lost Reason (free text), and stale_days entirely** unless `numberrange` exists, in which case use it for Value/Probability range; only build `overdue_only` as a `tristate` (it degrades acceptably as a 3-way Any/Yes/No for a real boolean param) if you skip the rest.

**`OpportunityWrite`** (POST/PUT body, exact): `title: str` (required), `customer_id: str` (required), `value: Decimal|null` (must be `>0` if given), `stage: str = "PROSPECTING"` (one of `PROSPECTING|QUALIFYING|PROPOSAL|WON|LOST`), `probability_pct: Decimal|null` (0-100), `expected_close_date: date|null`, `description: str|null`, `owner_id: str|null`, `lost_reason: str|null` (required non-blank when `stage==="LOST"`, 422 otherwise; always cleared to null server-side whenever stage isn't Lost). **`OpportunityOut` = same fields + `id, opportunity_code, financial_year_id, last_activity_at`** — no `created_at`/`created_by`/`updated_at` exposed at all (don't build columns for them).

**CRITICAL: `PUT /opportunities/{id}` requires the COMPLETE `OpportunityWrite` body every time** — the handler does `for field, value in body.model_dump().items(): setattr(row, field, value)` over every field. A partial body (e.g. just `{stage:"WON"}`) either 422s (missing required `title`/`customer_id`) or would null out every other field if it somehow validated. **Any stage-change call (drag-and-drop on the board) must send the dragged row's full current data plus the new stage** — never a partial body.

**Won/Lost mechanics**: moving to `WON` server-side force-sets `probability_pct=100` (ignores whatever you send). Moving to `LOST` requires non-blank `lost_reason`. Moving to anything else always clears `lost_reason` to null.

**File upload**: `POST /files` (multipart `file`+`purpose`) → `{id, original_filename, mime_type, size_bytes}`, purpose `"opportunity_file"` (PDF/JPG/PNG/DOCX/XLSX, 10MB). Then `POST /opportunities/{id}/files?stored_file_id=${uploadedId}` (query param, empty body). `OpportunityFileOut` = `{id, opportunity_id, stored_file_id, created_at, created_by}` — **no filename/size/mime/uploader-name anywhere** once a file is already attached (only available momentarily from the upload response itself, on the same page load). Show File as a truncated id (`stored_file_id.slice(0,8)`) and Uploaded By as a truncated id (`created_by.slice(0,8)`) — matches the exact established precedent at `customer.files.component.ts`, copy its approach directly, including its lack of a Size column (there's no size field to show).

**`OpportunityActivityOut`** = `{id, opportunity_id, activity_type, activity_date, description, related_contact_id, logged_by, created_at}` — `logged_by` is a raw user id with **no name-resolution endpoint anywhere in this backend** (confirmed no general Users-directory GET exists). The established precedent (`customer.activities.component.ts`) doesn't even attempt to render `logged_by` in its template — do the same, just omit it from display rather than showing a raw id nobody can read.

### 1. Refs — exact endpoint + labelKey

| Field | Endpoint | labelKey | Notes |
|---|---|---|---|
| Owner (`owner_id`) | `/employees` | `first_name` | Standard established convention |
| Customer (`customer_id`) | `/customers` | **`company_name`** | `CustomerOut` has no `name` field at all — `RefDataService`'s default labelKey is `'name'`, so you MUST set this explicitly or every customer resolves to the literal string "undefined". This is genuinely the first `ref`/`optionsRef` usage of `/customers` anywhere in this codebase — get the labelKey right. |
| Financial Year (`financial_year_id`) | `/masters/financial-years` | `label` | Standard convention |
| Related Contact (Activity form only) | `GET /customers/{customerId}/contacts` | `name` | NOT a static `RefLookup` (that type only takes a fixed endpoint string, can't vary per parent record) — do a direct `HttpClient.get<ContactOption[]>()` call in your Activities component's `ngOnInit`, using the Opportunity's own already-loaded `customer_id` to build the URL (you already have the parent Opportunity row loaded in the wrapper, pass `customer_id` down as an `@Input` alongside the opportunity id — this avoids an extra fetch `customer.activities.component.ts` doesn't need since there the parent id already IS the customer id). Fields: `id, customer_id, name, designation, email, phone, is_primary`. |

### 2. Screen: Pipeline — two views over one dataset

**Table view — clean `list` shape.** `id:'opportunity.pipeline'`, `endpoint:'/opportunities'`, `searchParam:'search'` (real server param), `exportable:true`, `defaultPageSize:25`. Columns: Title (`cellClass:'cell-strong'`), Customer (`ref:{endpoint:'/customers',labelKey:'company_name'}`), Value (money), Stage (`type:'status'`, staticOptions the 5 values), Probability (`probability_pct`, number, suffix `%` via a `compute`), Expected Close Date (date), Owner (`ref:{endpoint:'/employees',labelKey:'first_name'}`). Filters: Customer (select, server, optionsRef `/customers` `company_name`), Stage (multiselect, server, static 5-option list, `param:'stage'`), Owner (select, server, optionsRef `/employees` `first_name`), Financial Year (select, server, optionsRef `/masters/financial-years` `label`), Expected Close Date range (daterange, server, `param:'expected_close'`), Created On range (daterange, server, `param:'created'`), `overdue_only` (tristate, server), Created By / Last Modified By (select, server, `optionsRef:/employees`, `superAdminOnly:true`). `rowRoute:(row)=>['/opportunities',row.id]`. `createRoute:['/opportunities','new']`, `createScreenAction:'edit'` (correct here — matches the real action).

**Stage-summary/Board view — `BoardScreenConfig`, likely a first-real-usage of this shape (check `frontend/src/app/features/asset/` for a live example first).** Read `board-screen.component.ts` in full to get its exact config field names right. `endpoint:'/opportunities'`, `statusField:'stage'`, 5 columns for `PROSPECTING/QUALIFYING/PROPOSAL/WON/LOST` each with a metric summing `value`. Card content: code from `opportunity_code`, title from `title`, a meta line combining Customer name + Probability (e.g. `"${customerName} · ${probability_pct}%"`), money from `value`.

**CRITICAL — override the default stage-change body or every drag-and-drop 422s.** The board's default PUT body when no override is supplied is just `{stage: newValue}` — per the CRITICAL note in §0, `PUT /opportunities/{id}` requires the COMPLETE `OpportunityWrite`. You MUST supply whatever the config's own override hook is called, building the full body from the dragged row's own already-loaded fields (`title`, `customer_id`, `value`, `probability_pct`, `expected_close_date`, `description`, `owner_id`) plus the new stage. When `newStage === 'LOST'`, call `window.prompt('Reason for marking this opportunity Lost (required):', '')` synchronously inside that same callback and use the result as `lost_reason`; if the user cancels or leaves it blank, abort — don't fire the PUT at all. For any other stage, set `lost_reason: null` explicitly.

**View switcher**: `board` and `list` are two different top-level shapes that can't be composed into one `ScreenConfig`, and neither `tabbed-screen.component.ts` nor `record-screen.component.ts`'s embed-tab switches support hosting a `board`-shape sub-view. **Take the simpler, lower-risk option**: build the Pipeline as TWO separate routes (`/opportunities` for the table, `/opportunities/board` for the board) with a small manual toggle/link between them at the top of each page (a couple of plain `<a routerLink>` buttons, "Table View" / "Stage Summary") rather than attempting an in-page single-config toggle. Both routes share the RBAC id `opportunity.pipeline` — only ONE of the two gets the canonical `SCREEN_ROUTES`/sidebar entry, report both paths back and let the orchestrating session pick `/opportunities` as canonical.

### 3. Screen: Add / Edit Opportunity — `FormScreenConfig`

Same shape already used for non-trivial business objects elsewhere in this codebase (e.g. `masters.taxes`, which also has no `GET /{id}` and relies on the shape's own "re-fetch the whole list, find by id" edit-mode fallback — Opportunity does the same here even though a real `GET /opportunities/{id}` exists, because the `form` shape has no slot to use a by-id GET; this is an accepted, already-precedented trade-off).

Fields: Title (text, required), Customer (select, required, `ref:{endpoint:'/customers',labelKey:'company_name'}`), Value (number, optional), Stage (select, required, default `'PROSPECTING'`, the 5 static options), Probability % (number, optional, 0-100), Expected Close Date (date, optional), Description (textarea, optional), Owner (select, optional, `ref:{endpoint:'/employees',labelKey:'first_name'}`), Lost Reason (text or textarea, `visibleWhen:(form)=>form['stage']==='LOST'`, `required:true`).

**Probability auto-suggestion**: when Stage changes, call `GET /opportunities/probability-suggestion?stage=X` → `{stage, suggested_probability_pct}` and set the Probability field's value ONLY IF the user hasn't already manually edited it this session. There's no built-in `FieldConfig` hook for this — wire it with a small bit of bespoke logic if `FormScreenComponent` exposes a clean way to do so; if wiring this cleanly proves awkward, it's fine to skip this specific nicety and ship the plain editable Probability field with no auto-suggestion — note it as a deliberate simplification in your final report rather than fighting the shape for it.

**Post-create navigation**: `FormScreenConfig` has an `onCreateSuccess?: (response: T) => readonly unknown[]` field for exactly this — check its exact contract in `screen.types.ts`/`form-screen.component.ts` before using it. Set `onCreateSuccess: (response) => ['/opportunities', response.id]` so creating a new Opportunity lands the user on its Record screen.

Route this at `opportunities/new` (create) and `opportunities/:id/edit` (edit) — both pointing at the same config file.

### 4. Screen: Opportunity Record — bespoke component (neither `record` nor `tabbed` shape fits)

Verified: `TabbedScreenConfig`'s template has NO page-actions block at all (no way to add Edit/other buttons alongside tabs); `RecordScreenConfig`'s page-actions block is hardcoded to exactly one behavior (in-place Edit/Save/Cancel toggling the SAME screen's own fields, PUTting back — it cannot navigate to a separate route, and `RecordActionDef` only lives inside one tab's own fields, not at the page level, and only ever fires POST/DELETE, never a route navigation). Build bespoke, route `opportunities/:id`.

On mount: `GET /opportunities/{id}` once into a signal. Header: Opportunity Code, Title, Customer name (resolve via ref), Owner name (resolve via ref), Stage badge, persistent summary tiles for Value/Probability/Expected Close Date (always visible regardless of active tab). Page-action buttons: **Edit** (`router.navigate(['/opportunities', id, 'edit'])`, gated `policy.can('opportunity.pipeline','edit')`). **Do NOT build "Create Invoice" or "Export PDF" buttons** — neither has anywhere real to go (Invoice's frontend doesn't exist yet, and there is no per-record PDF export endpoint on the backend at all for Opportunity) — skip both entirely.

Three tabs (plain client-side tab switching, no router sub-routes needed):
- **Details**: a static read-only field grid off the already-loaded row.
- **Activities**: bespoke, modeled directly on `customer.activities.component.ts` — `GET`/`POST /opportunities/{id}/activities`, list ordered newest-first (already the API's own default order), `TYPE_OPTIONS` for `CALL|EMAIL|MEETING|NOTE`, Related Contact dropdown sourced from `GET /customers/{customer_id}/contacts` (pass the opportunity's own `customer_id` in as an `@Input`). Omit `logged_by` from the template per §0's note.
- **Files**: bespoke, modeled directly on `customer.files.component.ts` — upload via `FileUploadService` with purpose `'opportunity_file'`, then `POST /opportunities/{id}/files?stored_file_id=${uploaded.id}` (query param, empty body), list/delete via `GET`/`DELETE /opportunities/{id}/files/{file_id}` (`screenAction:'edit'` on delete). Render File/Uploaded By as truncated ids per §0, no Size column.

## When you're done

Report back:
1. Every file you created/modified, one line each — including the one-line `customer.opportunities.list.config.ts` addition.
2. The exact lines to add to `frontend/src/app/app.routes.ts`.
3. The exact `SCREEN_ROUTES` entry for `opportunity.pipeline` (pick `/opportunities` as canonical if you built the table/board split as two routes).
4. Confirmation `ng build` passes cleanly.
5. Any gap or judgment call — especially how the Board shape's exact config field names turned out to work in practice, and whether you kept or dropped the Probability auto-suggestion wiring.
