# Angular + FastAPI on a Single DigitalOcean Droplet — Architecture for the Meshrd CMS

Grounded in the shipped prototype at `D:\Projects\Company Management Software\prototype\` (`app-core.js`, `app-screens.js`, `app-forms.js`, `app-rbac.js`, `data.js`, `app.css`) and the 14 spec documents. Screen-shape counts below are the actual `type:` census from `data.js`: **70 form, 51 list, 10 record, 4 report, 2 board, 2 calendar, 2 document, 2 checklist, 1 payslip**, plus ~19 bespoke one-offs — 161 screens total, of which 62 are `navHidden` action forms reached from a parent screen.

> **[BUILT-STATE — 2026-08-03] Status of this document.** The **Angular frontend has not been started**: everything in §1–§8 (project structure, stores, screen shapes, RBAC directives, design system, data table, forms, HTTP layer) is still design, not code — no `apps/web/` exists. The deployment half is partially realized: backup/restore scripts are built and drilled, a multi-stage Dockerfile and CI workflow exist, and app-level rate limiting/logging/health checks were built in Phase 7 hardening (`backend/app/core/rate_limit.py`, `logging_config.py`, `app/main.py`). **No droplet, domain, TLS, or git remote exists yet**, so everything in §9–§10 that needs real infrastructure (nginx, certbot, systemd units, GitHub Actions actually running, UAT) remains unverified plan. Per-section notes below mark exactly where built reality diverges.

> **[BUILT-STATE — 2026-08-05] Frontend kickoff — foundation + one screen built and live-verified.** A real Angular app now exists at `frontend/` (not `apps/web/` — this repo's actual sibling-to-`backend/` layout, kept flat rather than matching this doc's illustrative monorepo path). Built and proven end-to-end through a real browser session against the real backend: `core/` (SessionStore, UiStore, AuthService, PolicyStore, both interceptors, both guards, the `*cmsCan` directive), `layout/` (AppShell, Sidebar, Topbar, LoginPage, ForbiddenPage, ComingSoon), `shared/screens/` (ListScreenConfig, ListScreenComponent, createListStore, screenRoute, ScreenHostComponent, column-policy's money-alignment rule), the design tokens/base/component CSS ported from the prototype, and exactly one full vertical screen — Employee Directory (`features/employee/`) — wired to the real `GET /api/v1/employees`. Every OTHER screen this session's login roles can see renders as an honest "coming soon" placeholder in the sidebar rather than a broken link; building out the remaining ~160 screens is follow-on work, not done here. Five concrete divergences from this doc's design, discovered by actually building against the real backend rather than assumed in advance:
>
> 1. **§2's `httpResource`/`resource()` aren't available in Angular 19.2** (the version this environment's Node/npm could actually install — `ng new` needs Node ≥24.15.0 or ≥22.22.3; this machine had 24.14.0, one patch behind, so Angular CLI 19 was used instead of "latest" rather than touching the system Node install other projects on this machine also depend on). `createListStore` (`shared/screens/list-screen/create-list-store.ts`) is a plain `signal()`+`effect()`+`HttpClient` implementation instead — same external shape (`rows`/`total`/`isLoading`/`error`/`reload`), swappable for the real `httpResource` on a future Angular upgrade without touching call sites. Similarly, `provideZonelessChangeDetection()` is still `provideExperimentalZonelessChangeDetection()` at this version.
> 2. **§2's `ListEnvelope<T>`/server-side pagination-sort-scope contract doesn't exist server-side** — confirmed by reading every list router (`employees.py`, `assets.py`, `invoices.py`, `projects.py`, ...): all return a bare `list[T]`, no `{items,total,page,scope,...}` envelope, no `f.`-prefixed filter params, no server `sort=`. Retrofitting that onto 400+ existing, already-audited endpoints wasn't proportionate to a frontend kickoff. `createListStore` instead fetches the full array once and does search/pagination CLIENT-side — a deliberate, disclosed trade that fits this system's actual list sizes (company-internal directories, hundreds of rows, not millions) and is easy to swap per-screen later if one screen's row count ever makes the assumption wrong.
> 3. **§4's `GET /api/v1/me` policy endpoint didn't exist at all** — built for real as part of this kickoff (`backend/app/api/v1/auth.py`'s `get_me()`, `backend/app/rbac/resolver.py`'s new `resolve_all_permissions()` bulk resolver — 5 queries total for every screen at once, not 81 × up to 4 sequential queries). Its response uses the REAL `app.rbac.resolver.PermissionSet` vocabulary throughout — `mode` is `'none'|'full'|'view'|'view_team'|'own'|'team'` (underscore), not this doc's `'view:team'` (colon); field modes are `'show'|'mask'|'hide'`, not this doc's four-state `edit|read|hidden|masked` (the real Layer-3 engine has no native read-vs-edit distinction at the field level — that's an L1/L2 concern — so forcing that mapping would have been lossy fiction). `PolicyStore`/`ScreenAccessGuard` (`core/rbac/`) are written against the real vocabulary. Each policy screen entry also now carries `label`/`module` (static registry data, not permission data) so the client can render real nav labels/groupings without hand-maintaining a second copy of the registry.
> 4. **§8's HttpOnly-cookie token delivery is still not how the backend works** (confirmed again on this pass — `grep`ing the whole backend for `set_cookie`/`HttpOnly` still returns zero hits; both tokens still come back as JSON in the response body). `AuthService`/`auth.interceptor.ts` are built against today's real bearer-token-pair contract: access token in an in-memory signal, refresh token in `sessionStorage` (isolated behind `core/auth/token-storage.ts` so a future cookie migration touches one file). `withViewTransitions()` was also dropped after live-testing showed it throws an uncaught `InvalidStateError` on every route change in this Angular version — a documented rough edge in 19.2's router integration, not a bug in this app; navigation itself works correctly regardless.
> 5. **Fonts are not self-hosted** — no `.woff2` files exist in this repo to vendor yet, so `index.html` loads IBM Plex Sans/Mono from the Google Fonts CDN, same as the prototype already did. `styles/base.css`'s header comment marks this as the one open item versus this doc's stated self-hosting target.
> 6. **§1's zoneless requirement was tried, then reverted to standard zone-based change detection** (`provideZoneChangeDetection({eventCoalescing:true})`, `zone.js` back in the polyfills) after a browser-testing session raised — then largely resolved — a question about whether `provideExperimentalZonelessChangeDetection()` reliably repaints the template after a native-DOM-triggered signal write; the apparent failure turned out to most likely be a flawed same-script synchronous test (checking DOM state before Angular's inherently-async render pass had run) rather than a confirmed framework bug. Reverted anyway rather than re-litigate it further: zoneless is still explicitly "Experimental" at Angular 19.2, and there is no cost to deferring it to a future upgrade where it's stable. **Also built since the previous entry**: the self-service password-reset flow ARCH-2 §5.4 specifies (`POST /api/v1/auth/password/reset-request`, always-204 regardless of outcome, rate-limited, converging with HR's reset button on one shared `auth_tokens.issue_temporary_password()`) plus its frontend page and a show/hide toggle on the login password field — all live-verified end-to-end.
> 7. **Second screen shape built: `record`** — `RecordScreenConfig`/`FieldConfig`/`FieldSection`/`RecordTab`/`RecordHeaderConfig` (`shared/screens/screen.types.ts`) and `RecordScreenComponent` (`shared/screens/record-screen/`), a read-only tabbed detail view, same "config object, not a new component per screen" rhythm §2 specifies. Proven via Employee Master Record (`features/employee/screens/emp.record.config.ts`, route `employees/:id`), wired from the Directory row via `rowRoute`. No edit/write support yet — ships read-only first, matching how the `list` shape itself shipped. **A real `canMatch`+`UrlTree` routing bug was found and fixed while proving this shape**: a guard returning a `UrlTree` (as `screenAccessGuard` does, to redirect to `/403`) redirects the WHOLE navigation the instant Angular's router considers ANY route a match candidate, not only once a route is the final match — so the static `employees` list route (default `pathMatch: 'prefix'`) was intercepting navigation to `employees/:id` and firing ITS OWN (wrong) guard first, surfacing `/403?screen=employee.directory` for a user who was actually being correctly blocked from `employee.master_record`. Fixed structurally by adding `pathMatch: 'full'` inside `screenRoute()` (`shared/screens/screen-route.ts`) itself — every route it produces is a leaf with no children, so this is always correct, not a per-call trade-off. **Any future hand-written route with a `UrlTree`-returning `canMatch` guard needs the same consideration if its path could prefix-match a longer sibling URL.**
> 8. **Both shapes proven a second time on a different module (Vendor), at the low marginal cost this doc's §2 always claimed** — `features/vendor/` (api interface + `vendor.directory.config.ts` list + `vendor.record.config.ts` record + `vendor.routes.ts`), zero new component code, config-only. Notably `vendor.directory` (the RBAC key) backs BOTH the list route (`vendors`) and the record route (`vendors/:id`) — the real backend has no separate detail screen key for Vendor the way Employee does, `GET /vendors` and `GET /vendors/{id}` both gate on the one constant in `vendors.py`, so `screenRoute()` is called twice with the same id, which is correct, not an oversight. **Confirms §4's RBAC field-hide requires zero client-side masking code**: `apply_field_masking()` deletes a `hide`-mode key from the JSON entirely before the response is built; `RecordScreenComponent`'s existing null-fallback (`—` for `null`/`undefined`/`''`) is the exact same code path an absent key hits, so a Manager's RBAC-stripped `gstin`/`pan`/bank fields render safely with no dedicated frontend RBAC-aware rendering branch at all. Live-verified structurally (a genuinely-null field on this vendor rendering `—` as Super Admin) rather than by creating a second Manager login, since the backend's key-stripping itself was already directly HTTP-verified the same day and there is no frontend masking branch to separately break.
> 9. **New shared primitive: `RefDataService`, and a third module (Customer) proven with it.** Every list/detail endpoint the real backend has serializes FK columns (e.g. `Customer.status_id`) as bare Masters-table ids — confirmed by reading `customers.py`: only the PDF/Excel export path resolves them to names, the JSON path Angular consumes never does. Vendor's vertical didn't surface this (it has no FK fields at all), but showing a raw UUID in Customer Directory's Status column would have been a genuinely broken screen, not a stylistic gap, so this was built as a real shared capability rather than special-cased. `shared/screens/ref-data.service.ts`: one id→name `Map` per Masters endpoint, cached behind a `WritableSignal`, exposed as a synchronous `label(ref, id)` (`'…'` in flight, `'—'` for a null id, the raw id as a last-resort fallback) read directly from template interpolations — no `Observable`/`async` pipe, since this app's standing zone-based CD (see point 6) already re-renders once the HTTP response sets the signal. `ColumnDef`/`FieldConfig` both gained an optional `ref?: RefLookup` (`screen.types.ts`); `ListScreenComponent`/`RecordScreenComponent` both consult it before falling back to the raw value. `features/customer/` (list + record, both tabs) proves it with two INDEPENDENT lookups on one screen (Status → `/masters/customer-statuses`, Source → `/masters/customer-sources`), confirming the cache keys correctly per endpoint. Employee's own FK fields (department/designation/etc.) predate this capability and were simply omitted from its record view rather than shown as raw ids — not retrofitted this pass, a real opportunity for later, not a bug.
> 10. **Edit/write support built on the record shape, proven on Customer, then rounded out onto Vendor and Employee the same day** — the capability §3's own note ("No edit support yet") had flagged since the shape was first built. `RecordScreenComponent` gained an Edit/Save/Cancel flow gated by `PolicyStore.can(id, edit.screenAction ?? 'edit')` (the same `'edit'` action name `require_screen(SCREEN, action="edit")` checks server-side, so the button can never show for a role the API would 403 anyway). Edit state lives in a plain mutable `formModel` object (not a signal — `[(ngModel)]="formModel[field.key]"` needs a real assignable target), seeded from a full shallow copy of the loaded row so Save always PUTs every key the real `update_*` endpoint's `for field, value in body.model_dump(): setattr(row, field, value)` pattern expects — omitting an unshown field would silently null it server-side. `FieldConfig` gained `editable?: boolean`; `RecordScreenConfig` gained `edit?: {saveEndpoint, screenAction?}`; `FieldType` gained `'select'`, sourced from the same `RefDataService` cache (point 9) via a new `options()` method — one lookup now serves both read-mode labels and write-mode `<option>` lists. **New safety guard**: a field marked `editable` is still refused an editable input if its RBAC field mode is `'mask'` (current value is a placeholder, not real data) or `'hide'` (not even in the loaded row) — doesn't change Customer's behavior today but protects any future screen that marks a sensitive field editable by mistake. Proven on `features/customer/screens/customer.record.config.ts` (12 editable fields incl. 2 selects) against the real `PUT /customers/{id}`. **A live-testing false alarm worth recording**: a save appeared to mutate an untouched field (`display_name` came back populated after editing only `website`) — ruled out as a frontend bug via direct `ng.getComponent()` state inspection (formModel was confirmed correct immediately before `save()`), then traced to a genuine, spec'd backend default-fill rule in `customers.py`'s `update_customer` (`if not data.get("display_name"): data["display_name"] = data["company_name"]`, §2.2). The lesson: a network-log lookup for a PUT's requestId can resolve to the response body, not the request — verify against the actual outgoing payload or the endpoint's source before concluding the frontend mutated something.
>     **Vendor and Employee proven the same day** (`features/vendor/screens/vendor.record.config.ts`, `features/employee/screens/emp.record.config.ts`): Vendor's edit_banking split was checked against `update_vendor`'s own already-robust server-side handling (masked-view comparison + silent skip for a role lacking `edit_banking`) and `seed.py`'s real role grants before shipping — confirmed the existing hide/mask field guard is sufficient for every role combination that exists today, no extra per-field-action mechanism needed yet. Employee's edit deliberately covers only the already-displayed Personal-tab fields, NOT its FK fields (department/designation/employment_type/reporting_manager/work_location — no picker source exists for Reporting Manager, no confirmed Work Location master) or lifecycle fields (joining_date/exit_date/status/code — server-managed, not part of `EmployeeWrite`'s editable surface in spirit) — verified live that this is still fully safe (not a half-fix) because `startEdit()`'s full-row-copy means the untouched required FK fields round-trip in the PUT body unchanged, confirmed by a real save returning 200 rather than a 422 that would have fired had they gone missing.
> 11. **Settings page built, ported from the prototype, plus a real cross-app CSS gap fixed.** User asked to build out the entire remaining application (~155 screens) with UI/Settings fidelity to the prototype; chose the incremental (not multi-agent Workflow) approach when asked, so this is a standing multi-session effort, not a single increment — this point covers its first slice. **Found first**: `.card`/`.card-body`/`.grid`/`.g-2`/`.g-3`/`.g-4`/`.tabs`/`.tab`/`.kpi`/`.link` were used by `ListScreenComponent`/`RecordScreenComponent` since the FIRST screen this project built, but were never actually copied into `styles/components.css` during the original port — every card on every screen has been rendering with zero border/shadow/radius the whole time, undetected because every prior verification pass checked rendered TEXT (`get_page_text`), never actual computed CSS or a screenshot. Fixed by porting the missing blocks verbatim from `prototype/app.css`. **Then built** `layout/settings-page.component.ts` (route `/settings`, topbar-profile-menu-linked, Super-Admin-gated by checking `session.role()` directly since Settings has no RBAC screen key at all — it configures the shell, not a module) — 4 tabs matching `prototype/app-screens2.js`'s `R.settings` exactly (Appearance/Regional & Financial/System/About), with Appearance fully live: `core/ui/accent.ts`'s `rampFrom()` ported byte-for-byte from the prototype's own formula, `UiStore` rewritten to actually apply its signals via 3 `effect()`s (theme → `data-theme`, accent → the 4 CSS custom properties, scale → `body.style.zoom`), self-initializing with no explicit boot call needed. The other 3 tabs stay decorative on purpose — matching the prototype's own "report what it would do" convention, not a shortcut. About tab's stats are computed live from the real session policy, not hardcoded. Live-verified via direct `getComputedStyle`/DOM checks (not just text) for every control, including hand-verifying the custom-color-picker's `rampFrom` math against a known input/output pair, and confirming the Super-Admin gate both ways (locked empty-state for `employee@meshrd.in`, correct menu-item visibility difference checked via `read_page` since a toggled popover races a same-script click-then-query).
> 12. **Third screen shape built: `form` (create + inline-edit), and 14 of the 15 simple Masters lookups shipped on it.** `masters_lookup.py` (the generic factory backing every simple sub-master) has NO `GET /{id}` endpoint — only list/create/blind-update/deactivate/delete — so the `record` shape (which navigates to `/thing/:id` and GETs it) structurally doesn't fit. `FormScreenConfig`/`FormScreenComponent` (`shared/screens/form-screen/`) handle both create (no `:id`, seeded from `emptyRow()`) and edit (`:id` present — found by fetching the WHOLE list and matching client-side, since there's no single-row read; safe even on a direct URL refresh since `ListScreenComponent` already does the identical fetch for the same screen). `FieldType` gained `'checkbox'`; `FieldConfig` gained `staticOptions` for a `'select'` backed by a fixed backend enum (e.g. Expense Type's `claim_type`) rather than a Masters lookup table. `ListScreenComponent` gained a real "+ Add New" button (`createRoute`, gated on the same `edit` action the create endpoint requires) — the first screen anywhere in the app that can actually create a new record, not just view/edit existing ones. 14 of 15 lookups shipped (`features/masters/`); **Holidays deliberately excluded** (its `financial_year_id` is required and Financial Year has no screen yet — a real dependency, not an oversight) and **HSN/SAC's Linked Tax fields intentionally omitted** (needs Taxes, also unbuilt) — confirmed safe via the same full-row-copy safety net Employee's edit already relies on: the omitted keys are still in the real GET response and round-trip unchanged through `{...row}`. Live-verified a representative sample (plain fields, select-ref, checkboxes+decimals, and the error path) against the real backend rather than all 14 individually, proportionate since the shared mechanism — not the per-screen config — is what could actually break.
> 13. **A fourth interaction shape, `rowActions`, and Financial Year built on it.** `financial_years.py` has no PUT at all — create is POST-only with server-derived Label/End Date, and status only advances via two dedicated one-way action endpoints (`lock`, `set-current`), never a general edit. Neither `record` nor `form` fit "click a button on an existing row, no body." `ListScreenConfig.rowActions` (new): a trailing actions column, each entry gated by `PolicyStore.can(id, screenAction)` matching the real endpoint's own `require_screen(..., action=...)`, an optional `visible(row)` predicate, and an optional `confirm` string for irreversible ones. Fires a bare POST, reloads via the list store's existing `reload()`. `FormScreenConfig.updateEndpoint` made optional to support Financial Year's genuinely create-only form (no `:id/edit` route exists to wire). Live-verified the full lifecycle for real: created FY 2029 from one Start Date field and confirmed Label/End Date were server-derived, Locked FY 2028 for real (irreversible) and confirmed the button disappeared post-reload, Set-Current'd FY 2029 and confirmed the backend's unset-then-set logic reflected correctly.
> 14. **Holidays and Bank Accounts built on the existing shapes; Taxes/Company Profile/Work Week & Hours investigated and correctly deferred as needing real new capability.** Holidays turned out to use the same simple-lookup factory as the other 14 (has a real PUT) — a plain `list`+`form` pair once Financial Year existed to source its `financial_year_id` select from; CSV bulk import (a separate bespoke endpoint) deliberately not built, documented as deferred. Bank Accounts (`masters_bank_accounts.py`, bespoke) fits `list`+`form`+`rowActions` cleanly — a one-default-account singleton (Set Default row action, same unset-then-set pattern as Financial Year) and A009 (Confirm Account Number, write-only, re-validated on every write including edits, never returned by GET) — live-verified the edit-mode blank-confirm-field behavior specifically, including a real rejected save without it and a successful one with it. **Taxes/Company Profile/Work Week & Hours read in full and deliberately NOT built this pass**: Taxes (454 lines) has nested child arrays (slab bands, split components, relief rules, withholding directions) each needing their own row-editor with real cross-field validation, field-level locking that depends on usage history, a Duplicate action, and a live Calculate-preview endpoint. Company Profile and Work Week & Hours are both a singleton main record plus 2-3 separate child-list sub-resources bundled under one nav entry — a shape none of `list`/`record`/`form` represents (all three assume one resource per screen). Correctly identified as needing new capability (nested-array editors, a singleton-plus-sub-resource-tabs shape) rather than rushed into a shallow version.
> 15. **Masters module completed the same day — all 21 real screens now have working frontend coverage**, including Taxes. Re-investigated each remaining screen's real shape before building (avoided wasted work): Work Week & Hours needed NO new capability after all (Policies = `list`+`form`+`rowActions`; Pay Cycle/Saturday Overrides = create-only `list`+`form`, identical to Financial Year's own shape). Company Profile and Email Configuration both needed a genuinely new **`singleton` shape** (`shared/screens/singleton-form/`, `SingletonFormConfig`) for their one-record-no-id-ever main resource (GET null → POST creates, GET a row → PUT edits) — plus `relatedLinks` (on `SingletonFormConfig` and, retrofitted, `ListScreenConfig`) for simple nav between a screen's own bundled sub-resources with no single natural "home." `FieldConfig` gained `createOnly` (exists on Create but not Update — Number Prefix Rule's `code_type`/`label`, Email Template's `template_key` etc. — an input while creating, plain text once editing). Taxes needed a genuinely new **nested-array child-row editor** (`ArrayFieldConfig`/`arrayFields` on `FormScreenConfig`) for Slab Bands/Split Components/Relief Rules — real child collections living inside the parent's own create/update body, not separate endpoints — add-row/remove-row mini-tables, live-verified against the real contiguous-slab-band validation (3 bands, exactly one open-ended, saved and reloaded correctly). `withholding_directions` (a flat 2-value string list) deliberately left without a dedicated control — documented, not silently dropped (the full-object-copy safety net preserves it on edit).
>     **Two real backend fixes made along the way, confirmed via a full pytest re-run each time (149/149 both times)**: (1) `indian_states` — the FK target for Company Address's `state_id` — had a real migration, model, and FK constraint since migration 0001 but zero seed data and zero read endpoint anywhere; seeded all 36 states/UTs with real GST codes and added `GET /masters/company-profile/indian-states`, since a Company Address literally could never be created without it. (2) `add_address` never caught `DBAPIError` at all (unlike every sibling endpoint in the same file) — a bad `address_type` surfaced as a raw `net::ERR_FAILED`, not a clean error; fixed with the same `_as_client_error` pattern already used elsewhere. **This backend has no `--reload`** — both fixes needed a manual server restart, confirmed via a route-existence check (401 vs 404) before re-testing.
>     **The recurring lesson from this whole Masters push, worth restating for every future screen**: every static-enum field this project ever got wrong (Company Address's `address_type` specifically) was guessed from the field name instead of read from the real DB `CHECK` constraint in the alembic migration, and only caught by testing for real. For Work Week Policy and Tax Head (~15 enum fields combined), values were read from the migration FIRST this pass, and every one saved correctly on the first live attempt. **Always grep the migration's `CHECK` constraints before writing a `staticOptions` array — never infer from the field name.**
> 16. **`MASTERS-COMPLETION-PROMPT.md`'s post-"complete" gap-closing punch list (§1–§7) finished 2026-08-08.** `work-week.tabbed.config.ts` rebuilt as a real 6-tab `TabDef` record. A real `'file'` `FieldType` shipped end-to-end (`FileUploadService` wrapping `POST /files` + authenticated blob-view; wired into both `FormScreenComponent` and `SingletonFormComponent`), used first on Company Profile's new Documents tab. Two new generic `FieldConfig` capabilities: `hideWhenRefEmpty` (a field disappears entirely, not just disabled, while its live ref-lookup has zero options — distinct from `visibleWhen`, which only reads the form model) and `section` (titled dividers in `FormScreenComponent`'s otherwise-flat grid); plus `recordActions` on `FormScreenConfig` (edit-mode-only buttons to a child resource's own screen). Tax Schemes became a real standalone sub-master with full CRUD; Taxes' 3 nested child arrays (slab bands/split components/relief rules) moved OUT of inline `arrayFields` into standalone editor screens reached via `recordActions`, since `masters_taxes.py` has no per-child CRUD — editing one still PUTs the whole Tax Head back. Two real backend bugs fixed: `masters_taxes.py`'s write endpoints only guarded the final `commit()` against `DBAPIError`, not the intermediate `flush()`es that actually run the INSERT/UPDATE under this codebase's parent-before-child flush pattern; and `delete_tax_head` wasn't deleting child rows before the parent. **§7**: every Masters demo/test row wiped from the local dev DB and reseeded from `prototype/data.js` verbatim (Taxes deliberately left empty) via a new, kept-in-repo `backend/scripts/wipe_and_reseed_masters.py`. Two DB triggers (`email_send_log`, `email_templates`) are append-only by design — excluded from the wipe, repopulated via `app.seed.seed()`'s own additive logic instead. Each table's wipe needed its own independent transaction (a shared one lets one trigger-protected table's failure silently roll back every already-successful delete). The reseed itself is one flush/commit at the end, so MySQL only ever reports the FIRST constraint violation it hits — cross-checking every remaining table's seed values against the migration's own `CHECK` constraints by hand, before the retry, is what caught `prototype/data.js`'s own Earned Leave row violating `ck_leave_types_cf` (`maxcf:30` against `quota:15` — the prototype's mock data was never validated against this rule) without burning a second full wipe+backup cycle.
> 17. **Employee module, Vendor's 3rd screen, Customer 360's remaining tabs, and all 4 RBAC admin screens completed 2026-08-08 — the whole standing "~13 modules remain" checklist is now down to Leave/Asset/Ticket/Opportunity/Project/Invoice/Expense/Purchase Bill/Payroll/Tax & Compliance (all backend-ready, zero frontend).** Employee Master Record's 6 previously-missing tabs (Account & Login, Bank & Statutory, Salary Structure, Insurance & Benefits, Emergency Contact, Leave & Attendance Summary) plus all 12 self-service screens (My Profile/Leave/Payslips/Documents/Tickets/Projects & Tasks/Assets/Dashboard/Announcements/Onboarding/Offboarding/Tax Declarations/Offer Letters) shipped. Three new shared capabilities, all reused across many screens:
>     - **`RecordActionDef`** — an immediate action button on a record's own fields tab (Create Login/Disable Login/Reset Password/Send Welcome Email), gated by `PolicyStore.can(screenId ?? recordConfig.id, screenAction)`. The `screenId` override exists because a real bug shipped without it: an action's `screenAction` must be checked against whichever RBAC screen key the BACKEND actually registers that specific action on, which is frequently NOT the host record's own screen id (`send_welcome_email` lives on `employee.onboarding`, not `employee.master_record`) — without the override the button silently never renders for any role, with no error anywhere. **Standing rule now: grep the backend's own `require_screen(SCREEN, action=...)` call for the exact endpoint before writing any `screenAction` string — an endpoint that calls `require_screen(SCREEN)` with no `action=` at all is visibility-only and needs `PolicyStore`'s `ALWAYS_ALLOWED` convention (e.g. `'view'`), not a real per-action name that will never be granted.**
>     - **`RecordComponentTab`** (`kind: 'component'`) — hosts an arbitrary bespoke component as a record tab via `NgComponentOutlet` + `ngComponentOutletInputs`, for sub-resources too structurally different for the generic shapes (versioned revisions, nested dependents, dual-table self-service screens). Surfaced a real, easy-to-repeat Angular gotcha: **a component with `input.required<string>()` read inside its own constructor throws `NG0950` when hosted via `NgComponentOutlet`**, even though the identical component works fine with a static template binding — `NgComponentOutlet` applies dynamic inputs via `setInput()` AFTER the constructor already ran, while a static binding resolves before construction. Fixed in all 7 affected components by moving the initial load into `ngOnInit()`. **Any component that might ever be hosted dynamically must do input-dependent work in `ngOnInit()`, never the constructor** — this doesn't type-check differently either way, so only a live browser check (not `ng build`) catches it.
>     - The `'embed'` tab mechanism only switched on `'list'`/`'singleton'` shapes; added a `'checklist'` case (`<app-checklist-screen>`) to support Onboarding as an embedded tab — `ChecklistScreenComponent` already resolves its own `:id` from the route directly, same as the host record, so no factory-function wrapping was needed.
>     
>     Two mechanical mistakes recurred enough this pass to record as house rules: **`@else if (expr; as x)` is only legal on a primary `@if`, never an `@else if` continuation** (nest a plain `@if`/`@else` inside the outer `@else` instead); and **a `[(ngModel)]` target on a `Record<string, unknown>`-typed plain object must use bracket notation (`form['key']`) in templates, never dot notation** — both are `ng build`-time errors invisible to bare `tsc --noEmit`, which doesn't check templates at all.
> 18. **Leave module (Module 5) completed 2026-08-08, same continuous pass — 8 screens, `features/leave/` (new).** My Leave (pre-existing) fixed: it used `.b-warning`/`.b-success`, CSS classes that were never real (only `.b-warn`/`.b-ok` exist in `components.css`) — badges had been rendering uncolored; also added an Adjustments column, `is_quota_tracked`-driven "Not tracked" handling, a real Status filter, PDF/Excel export, and an Actioned By column (a User id with no name-lookup anywhere in this backend, shown truncated per the established `id.slice(0,8)` convention). New: Leave Approvals, Leave Balance Management (+ Adjust via chained `window.prompt`s), Carry-Forward Run (bespoke — no GET/list endpoint exists for a run at all; Preview→Commit/Cancel state lives only in component memory, matching the backend's own one-shot design), Company Holiday Calendar (a read-only `CalendarScreenConfig` mirror reusing `masters.holidays` as its RBAC key, since no dedicated `leave.*` key exists for it), Leave Reports, Compensatory Hours + its separate Approvals queue + a bespoke apply form.
>     - **`ReportScreenConfig`'s first-ever real usage** (Leave Reports) — the shape had existed since Masters but never actually backed a shipped screen. Confirmed working end-to-end live: 8 filters / 3 KPI tiles / 3 tables off 4 named sources, reactive refetch verified by changing the Financial Year filter and watching the chip and every table update together.
>     - **A second real "Masters lookup not actually granted to the role that needs it" RBAC seed bug**, same class as the `masters.holidays` fix in point 16: `masters.leave_types` was seeded `EMPLOYEE:"none"`, `ACCOUNTANT:"none"` — 404'd the Leave Types lookup for both, making Apply for Leave unusable for them. Fixed the same way (grant `"view"`).
>     - **The shared-RBAC-key one-nav-slot limitation (point 16's `employee.documents`→`/my-documents` pattern) recurred twice more**: Compensatory Hours' own-requests screen and its Approvals queue share one RBAC key (one `ScreenDef` covering both `request` and `approve`), solved identically (one canonical route + a `secondaryActions` in-page link to the other). Company Holiday Calendar hits it from the opposite side — `masters.holidays` already owns its one sidebar slot under Masters, so the Leave-side mirror is reachable only via an explicit link on My Leave's own page, never its own Leave-group sidebar entry, confirmed by reading `sidebar.component.ts` directly: the sidebar groups strictly by `screenId.startsWith(module+'.')`, so a second physical route under a different nav group can never surface there regardless of `SCREEN_ROUTES`.
>     - Immediately pipelined into Asset Management + Ticket as full background BUILD agents (their research was already fresh and exhaustive enough to serve as a complete spec) plus fresh research agents for the remaining 7 modules (Opportunity, Purchase Bill, Invoice, Expense, Payroll, Tax & Compliance, Project), run in parallel so research stays ahead of implementation for the rest of the standing checklist.
> 19. **2026-08-08, same day — the remaining 9 modules (Asset Management, Ticket, Expense, Opportunity, Invoice, Tax & Compliance/Module 15, Payroll, Project, Purchase Bill) all completed, wired, and `ng build`-verified. The entire ~161-screen standing checklist this document has tracked since point 5 is now CLOSED.** Each module was researched then built by one dedicated background Agent per module off an exhaustive, backend-source-verified brief; the orchestrating session reviewed every report, merged `app.routes.ts`/`nav-registry.ts` itself (agents were deliberately barred from touching those two shared files, to avoid concurrent-edit collisions across up to 9 parallel builds), and ran a full `ng build` after every single merge — not just once at the end — so any shared-infra regression would be attributable to exactly one change.
>     - **Shared-infra additions, in dependency order**: `numberrange` `FilterKind` (Asset, reused by Opportunity/Project); the `document` shape's real create-mode (`DocumentScreenConfig.createEndpoint`/`emptyRow`/`recordRoute`, `FieldConfig.createOnly`, `DocumentActionDef.kind:'download'` + `.screenId`, `ArrayColumnConfig.ref`) — built by Invoice (deliberately sequenced first among the finance modules, since Purchase Bill needed the identical capability and building both concurrently would have meant two agents extending the same shared component at once); Purchase Bill then found and fixed one more gap Invoice never exercised (`document-screen.component.ts` had no `'file'`-type field rendering at all — ported `form-screen.component.ts`'s working implementation verbatim); a per-status-value `badgeClass` override on `FilterOption` (Tax & Compliance, additive/non-breaking — only engages when the new optional field is set).
>     - **Two real bugs found in already-shipped code, fixed in passing**: `my-payslips.list.config.ts`'s Status filter matched the literal `'GENERATED'`, a value that does not exist (`ck_payslip_status` only allows `PROCESSED`/`REISSUED`) — caught by the Payroll agent cross-checking the real DB constraint instead of trusting the existing file. `customer.activities.component.ts`'s Related-Contact `<select>` used `<option [value]="null">` inside an `ngModel` binding — `SelectControlValueAccessor` only registers `[ngValue]`-bound options, so `[value]="null"` silently round-trips as the string `"null"`, not real `null` — caught by the Project agent hitting the identical pattern in its own new code, verified against `@angular/forms` source, then flagged for its pre-existing twin in Customer.
>     - **A genuine mid-batch pause-and-resume**: the session hit its usage limit partway through; every in-flight background agent was stopped via the actual stop tool (not just left to finish or silently abandoned) the instant the user asked, and the not-yet-landed modules' exact build briefs were written to `build-docs/pending-modules/*.md` as a durability safeguard before the session state could be lost. On resume all agents were relaunched from the identical briefs — nothing was re-researched, re-litigated, or built differently the second time.
>     - **Live-verified post-completion**, fresh browser tab: Invoice Dashboard (real aggregate figures; Recent Payments' Mode column shows raw ids — confirmed as the same pre-existing post-masters-reseed FK staleness already documented in point 18, not a new bug), New Invoice and New Purchase Bill (both create-mode `document` screens, including Purchase Bill's new file-upload field), Tax & Compliance Overview (correctly shows both liability/receivable panels as "not configured," never netted together, since Taxes is intentionally empty in this dev DB), Payroll History (20 real runs) + Run Payroll's Stage 1 form, Project Directory (9 real projects) + a Project Record page's Task Board tab — the single most structurally complex component in this whole batch, since `TabbedScreenComponent` cannot embed `board`/`report` shapes at all, so it hosts `BoardScreenComponent`/`ListScreenComponent`/`ReportScreenComponent` directly and hand-builds its own tab chrome — rendered real cards and correct per-tab count badges with zero real console errors.

---

## 1. Project structure

Angular latest, standalone-only, zoneless, `strict` + `strictTemplates` + `noUncheckedIndexedAccess`.

```
apps/web/
├─ src/
│  ├─ main.ts                        # bootstrapApplication(AppShell, appConfig)
│  ├─ app.config.ts                  # providers: router, http, zoneless
│  ├─ app.routes.ts                  # 5 sidebar groups → 14 lazy module route files
│  ├─ styles/
│  │  ├─ tokens.css                  # :root + :root[data-theme="dark"] (port of app.css §1)
│  │  ├─ base.css                    # reset, type scale, .mono/.num, focus ring
│  │  ├─ components.css              # .btn .card .badge-s .filterbar .table-wrap .kpi …
│  │  └─ fonts.css                   # self-hosted IBM Plex Sans/Mono (woff2, font-display:swap)
│  │
│  ├─ core/                          # singletons. Imported by features, never the reverse.
│  │  ├─ auth/
│  │  │  ├─ session.store.ts         # signal store: user, role, policy, scope
│  │  │  ├─ auth.service.ts          # login, refresh, logout
│  │  │  └─ auth.guard.ts            # canMatch: authenticated
│  │  ├─ rbac/
│  │  │  ├─ policy.model.ts          # ScreenMode, FieldMode, ActionKey
│  │  │  ├─ policy.store.ts          # mode() / can() / fieldMode() / lockReason()
│  │  │  ├─ screen-access.guard.ts   # canMatch: mode !== 'none'
│  │  │  └─ directives/              # *cmsCan, *cmsField, cmsFieldMode
│  │  ├─ http/
│  │  │  ├─ auth.interceptor.ts
│  │  │  ├─ error.interceptor.ts
│  │  │  ├─ request-id.interceptor.ts
│  │  │  └─ list-query.ts            # ListQuery ⇄ HttpParams ⇄ URL
│  │  ├─ ui/
│  │  │  ├─ ui.store.ts              # theme, accent, customAccent, scale, sidebar
│  │  │  ├─ accent.ts                # rampFrom() — port of app-core.js:549
│  │  │  └─ toast.service.ts
│  │  ├─ masters/masters.store.ts    # cached lookup lists (depts, leave types, taxes…)
│  │  └─ format/                     # inr(), inrAbbr(), dmy(), initials()  [pure fns + pipes]
│  │
│  ├─ shared/                        # dumb, reusable, zero feature imports
│  │  ├─ screens/                    # THE 8 SHAPES
│  │  │  ├─ list-screen/             # ListScreenComponent + config types
│  │  │  ├─ form-screen/
│  │  │  ├─ record-screen/           # header + lazy tabs
│  │  │  ├─ board-screen/
│  │  │  ├─ report-screen/
│  │  │  ├─ calendar-screen/
│  │  │  ├─ document-screen/         # invoice / bill / credit note
│  │  │  └─ payslip-screen/
│  │  ├─ data-table/
│  │  │  ├─ data-table.component.ts
│  │  │  ├─ column-policy.ts         # ★ money alignment lives here, and nowhere else
│  │  │  └─ cell.component.ts
│  │  ├─ filters/filter-bar.component.ts
│  │  ├─ fields/                     # one component per FieldType
│  │  ├─ ui/                         # btn, card, badge, kpi, empty, pager, drawer, toast
│  │  └─ export/export.service.ts
│  │
│  ├─ features/                      # one folder per spec module; lazy-loaded
│  │  ├─ dashboard/
│  │  ├─ employee/          02-employee-module.md
│  │  ├─ leave-payroll/     05 + 06   (one sidebar group, per data.js:970)
│  │  ├─ asset/             03
│  │  ├─ ticket/            04
│  │  ├─ project/           10
│  │  ├─ opportunity/       09
│  │  ├─ customer/          08
│  │  ├─ invoice/           11
│  │  ├─ expense/           12
│  │  ├─ purchase-bill/     13
│  │  ├─ vendor/            07
│  │  ├─ masters/           01   (20 sub-masters — one folder, one config file each)
│  │  ├─ rbac/              14
│  │  └─ settings/
│  └─ layout/                        # AppShell, Sidebar, Topbar, Breadcrumbs, LoginPage
```

Each feature folder is the same three-file rhythm:

```
features/employee/
├─ employee.routes.ts        # default-exported Routes[]
├─ screens/
│  ├─ emp.directory.config.ts     # ListScreenConfig — no component
│  ├─ emp.record.config.ts        # RecordScreenConfig
│  ├─ emp.docqueue.config.ts
│  └─ emp.upload.config.ts        # FormScreenConfig (navHidden)
├─ components/                # only bespoke pieces (e.g. onboarding checklist)
└─ employee.api.ts            # typed endpoints + row interfaces
```

**Most screens are a config object, not a component.** That is the single biggest structural decision and it is what the prototype proved: `data.js` describes 51 list screens declaratively and `app-screens.js:14` renders all of them in 16 lines.

### Routing

```ts
// app.routes.ts
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./layout/login.page') },
  {
    path: '',
    component: AppShellComponent,
    canMatch: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.page') },
      { path: 'employee',      loadChildren: () => import('./features/employee/employee.routes') },
      { path: 'leave',         loadChildren: () => import('./features/leave-payroll/leave.routes') },
      { path: 'payroll',       loadChildren: () => import('./features/leave-payroll/payroll.routes') },
      { path: 'assets',        loadChildren: () => import('./features/asset/asset.routes') },
      /* … 14 modules … */
      { path: 'settings',      loadComponent: () => import('./features/settings/settings.page') },
      { path: '403', loadComponent: () => import('./layout/forbidden.page') },
      { path: '**', loadComponent: () => import('./layout/not-found.page') },
    ],
  },
];
```

```ts
// features/employee/employee.routes.ts
import { screenRoute } from '../../shared/screens/screen-route';

export default [
  screenRoute('emp.directory',  'directory',        () => import('./screens/emp.directory.config')),
  screenRoute('emp.record',     'record/:id',       () => import('./screens/emp.record.config')),
  screenRoute('emp.docqueue',   'documents/queue',  () => import('./screens/emp.docqueue.config')),
  screenRoute('emp.upload',     'documents/upload', () => import('./screens/emp.upload.config')),
] satisfies Routes;
```

`screenRoute()` is a 20-line helper that attaches `canMatch: [screenAccessGuard(screenId)]`, `data: { screenId }`, `title`, and picks the right shape component from the loaded config's `shape` discriminant. One helper, 161 routes, zero copy-paste.

```ts
export function screenRoute(id: ScreenId, path: string, load: () => Promise<{ default: AnyScreenConfig }>): Route {
  return {
    path,
    canMatch: [screenAccessGuard(id)],
    data: { screenId: id },
    title: () => inject(ScreenRegistry).title(id),
    loadComponent: async () => {
      const { default: cfg } = await load();
      inject(ScreenRegistry).register(cfg);            // dev-mode: assert cfg.id === id
      return SHAPE_COMPONENT[cfg.shape];               // list → ListScreenComponent, etc.
    },
    resolve: { config: () => load().then(m => m.default) },
  };
}
```

Bootstrap config:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes,
      withComponentInputBinding(),      // config resolver arrives as an `input()`
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withViewTransitions({ skipInitialTransition: true })),
    provideHttpClient(withFetch(), withInterceptors([
      requestIdInterceptor, authInterceptor, errorInterceptor,
    ])),
    provideAppInitializer(() => inject(SessionService).restore()),  // GET /api/v1/me before first paint
  ],
};
```

---

## 2. State management: signals + three root stores. No NgRx.

**Decision: signals, with a `ListStore` factory and exactly three root-level stores. NgRx is rejected.**

Why, for a system of this specific shape:

1. **There is almost no client-owned domain state.** Of 161 screens, 51 are server-paged lists, 70 are forms that POST and navigate away, 10 are record views. The "state" of a list screen is `{query, page, sort}` — which belongs in the **URL**, not a store, because the spec requires filter state to survive navigate-into-a-record-and-back within a session (RBAC §2.2c) and requires exports to reproduce exactly what is on screen (§2.2f). URL query params satisfy both for free and make every filtered view linkable.
2. **NgRx costs scale with screen count; benefits don't.** 161 screens × (actions + reducer + effects + selectors + facade) is roughly 800 files of ceremony to express "GET this URL with these params." The genuine NgRx wins — time-travel debugging, cross-feature event choreography, optimistic concurrency — do not apply: this app has approval queues where optimistic updates are actively wrong (a Manager must see what the server decided, not what the client hoped), and no two features need to react to each other's actions.
3. **The dangerous state is global and tiny**: who you are, what you may do, and how the shell looks. Three stores cover it.
4. **Zoneless + signals + `httpResource` gives you the one thing NgRx was really bought for** — a declarative, cancellable, re-fetchable async read with loading/error status, colocated with the thing that needs it.

### The three root stores

```ts
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly _user = signal<CurrentUser | null>(null);
  readonly user = this._user.asReadonly();
  readonly role = computed(() => this._user()?.role ?? null);
  readonly isAuthed = computed(() => this._user() !== null);
  /** Server-issued policy snapshot. UX only — see §4. */
  readonly policy = computed(() => this._user()?.policy ?? EMPTY_POLICY);
  set(u: CurrentUser | null) { this._user.set(u); }
}
```

```ts
@Injectable({ providedIn: 'root' })
export class UiStore {           // theme / accent / customAccent / scale / sidebar — see §5
  readonly theme = signal<'light' | 'dark' | 'system'>('light');
  readonly accent = signal<AccentName | 'custom'>('blue');
  readonly customAccent = signal('#2a4bd7');
  readonly scale = signal(110);
  readonly sidebarCollapsed = signal(false);
}
```

```ts
@Injectable({ providedIn: 'root' })
export class MastersStore {
  private readonly cache = new Map<MasterListId, ResourceRef<MasterOption[]>>();
  /** Every `{ master: 'departments' }` OptionSource in every config resolves through here. */
  list(id: MasterListId, activeOnly = true) {
    const key = `${id}:${activeOnly}` as MasterListId;
    if (!this.cache.has(key)) {
      this.cache.set(key, httpResource<MasterOption[]>(
        () => ({ url: `/api/v1/masters/${id}`, params: { active_only: activeOnly } })));
    }
    return this.cache.get(key)!;
  }
  invalidate(id: MasterListId) { /* called after a Masters save */ }
}
```

That is the complete inventory of application-global state.

### Per-list state: one factory, 51 consumers

```ts
export function createListStore<T>(cfg: ListScreenConfig<T>) {
  const route = inject(ActivatedRoute), router = inject(Router);

  // URL is the source of truth for query state.
  const query = computed<ListQuery>(() => parseListQuery(route.snapshot.queryParamMap, cfg));

  const page = httpResource<ListEnvelope<T>>(() => ({
    url: cfg.endpoint,
    params: toHttpParams(query()),
  }));

  return {
    query,
    rows:        computed(() => page.value()?.items ?? []),
    total:       computed(() => page.value()?.total ?? 0),
    shown:       computed(() => page.value()?.items.length ?? 0),
    scope:       computed(() => page.value()?.scope ?? 'all'),
    isLoading:   page.isLoading,
    error:       page.error,
    reload:      () => page.reload(),
    patchQuery:  (patch: Partial<ListQuery>) =>
      router.navigate([], { relativeTo: route, queryParams: serializeListQuery(patch), queryParamsHandling: 'merge' }),
  };
}
```

### Where you *do* write a real store

Three screens have genuine derived client state and get a per-screen `@Injectable()` provided on the route component:

- **`payroll.run`** — the run wizard: period selection → eligible employee set → per-employee earnings/deductions preview → confirm. Multi-step, cross-field, expensive to recompute. `computed()` chains, one store class.
- **`inv.edit` / `bill.edit` / `inv.creditnote`** — the line-item editor: line totals, per-line tax rows, subtotal/tax/grand total. This is a `FormArray` plus ~8 `computed()`s.
- **`proj.board`** — drag-and-drop reordering with an in-flight optimistic move that must roll back on 409.

Nothing else needs one.

---

## 3. The eight screen shapes, as config

### Shared vocabulary

```ts
export type ScreenId = string;                       // 'emp.directory' — matches app-rbac.js POLICY keys
export type RoleId = 'superadmin' | 'accountant' | 'hr' | 'manager' | 'employee';
export type Scope  = 'all' | 'team' | 'own' | 'view';
export type ScreenShape =
  | 'list' | 'form' | 'record' | 'board' | 'report' | 'calendar' | 'document' | 'payslip' | 'custom';

export type OptionSource =
  | { readonly static: readonly string[] }
  | { readonly master: MasterListId; readonly activeOnly?: boolean }   // Masters-driven, cached
  | { readonly endpoint: string; readonly labelKey: string; readonly valueKey: string };
```

### 3.1 `ListScreenConfig` — the shape that carries 51 screens

```ts
/** Column kinds. Note MoneyColumn has `align?: never` — see §6. */
interface ColumnBase<T> {
  readonly key: string;                    // dotted path allowed: 'customer.name'
  readonly header: string;                 // ALSO the RBAC field-rule match target (§4)
  readonly width?: string;                 // '160px' | 'minmax(140px,1fr)'
  readonly sortable?: boolean;             // default true
  readonly sortKey?: string;               // server field when it differs from `key`
  readonly compute?: (row: T) => unknown;  // prototype's `calc` (data.js:991 remaining)
  readonly hideFrom?: readonly RoleId[];   // prototype's `hideFrom`
  readonly permissionField?: string;       // override the RBAC label match
  readonly emptyText?: string;             // default '—'
  readonly tooltip?: (row: T) => string | null;
}
type TextColumn<T>   = ColumnBase<T> & { type?: 'text' | 'code' | 'date' | 'person' | 'link'; align?: 'start' };
type NumberColumn<T> = ColumnBase<T> & { type: 'number'; unit?: string; align?: 'end' };
type StatusColumn<T> = ColumnBase<T> & { type: 'status' | 'chip'; align?: never };
type MoneyColumn<T>  = ColumnBase<T> & { type: 'money'; align?: never };   // ← compile error if you try
export type ColumnDef<T> = TextColumn<T> | NumberColumn<T> | StatusColumn<T> | MoneyColumn<T>;

export type DatePresetId =
  | 'this-month' | 'last-month' | 'this-quarter' | 'this-fy' | 'last-fy' | 'all-fy' | 'custom';

export type FilterDef =
  | { kind: 'search';      key: 'q';  placeholder?: string; searches: readonly string[] }
  | { kind: 'select';      key: string; label: string; options: OptionSource; multi?: boolean; default?: string[] }
  | { kind: 'dateRange';   key: string; label: string; field: string; presets?: readonly DatePresetId[] }
  | { kind: 'numberRange'; key: string; label: string; unit?: string }
  | { kind: 'person';      key: string; label: string; scopedPicker: true }   // §2.2b: picker offers only visible people
  | { kind: 'toggle';      key: string; label: string; default?: boolean; superAdminOnly?: boolean };

export interface ActionDef<T> {
  readonly label: string;                  // matched against RBAC ACTIONS (app-rbac.js:212)
  readonly permission?: string;            // explicit key when the label is cosmetic
  readonly icon?: IconName;
  readonly variant?: 'primary' | 'ok' | 'danger' | 'default';
  readonly route?: (row: T) => readonly unknown[];
  readonly confirm?: { title: string; body: string; requireReason?: boolean };
  readonly run?: (row: T, ctx: ActionContext) => Observable<unknown>;
  readonly disabledWhen?: (row: T) => string | null;   // returns the tooltip reason, or null
  readonly refreshOnDone?: boolean;
}

export interface ListScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'list';
  readonly id: ScreenId;
  readonly title: string;
  readonly specRef?: string;               // '§2.1' — rendered in the page head, as in the prototype
  readonly description?: string;
  readonly endpoint: string;               // '/api/v1/employees'
  readonly rowId: (row: T) => string;
  readonly columns: readonly ColumnDef<T>[];
  readonly filters?: readonly FilterDef[]; // baseline set (§2.2c) is injected automatically
  readonly defaultSort?: { key: string; dir: 'asc' | 'desc' };
  readonly defaultPageSize?: 25 | 50 | 100;
  readonly rowRoute?: (row: T) => readonly unknown[];   // prototype's rowGo
  readonly rowActions?: readonly ActionDef<T>[];
  readonly headerActions?: readonly ActionDef<void>[];
  readonly export?: { pdf?: boolean; excel?: boolean; fileStem: string };   // default: both, on
  readonly emptyText?: string;
  readonly views?: readonly ('table' | 'board' | 'calendar')[];
  readonly density?: 'dense' | 'comfortable';           // default 'dense'
  readonly virtualScroll?: boolean;                     // opt-in above ~500 rows/page
}
```

A real one, ported straight from `data.js:894`:

```ts
// features/employee/screens/emp.directory.config.ts
export default {
  shape: 'list',
  id: 'emp.directory',
  title: 'Employee Directory',
  specRef: '§2.1',
  description: "The searchable master list of every staff member.",
  endpoint: '/api/v1/employees',
  rowId: r => r.id,
  defaultSort: { key: 'name', dir: 'asc' },
  columns: [
    { key: 'id',     header: 'Employee ID',      type: 'code' },
    { key: 'name',   header: 'Name',             type: 'person' },
    { key: 'dept',   header: 'Department' },
    { key: 'desig',  header: 'Designation' },
    { key: 'type',   header: 'Employment Type' },
    { key: 'status', header: 'Status',           type: 'status' },
    { key: 'mgr',    header: 'Reporting Manager' },
    { key: 'phone',  header: 'Phone',            type: 'code' },   // numeric identifier → text (§2.2 c-i.3)
    { key: 'join',   header: 'Joining Date',     type: 'date' },
  ],
  filters: [
    { kind: 'search', key: 'q', searches: ['name', 'id', 'email', 'phone'] },
    { kind: 'select', key: 'department',  label: 'Department',      options: { master: 'departments' },  multi: true },
    { kind: 'select', key: 'designation', label: 'Designation',     options: { master: 'designations' }, multi: true },
    { kind: 'select', key: 'status',      label: 'Status',          options: { static: ['Active','On Notice','Exited','Inactive'] }, multi: true },
    { kind: 'select', key: 'emp_type',    label: 'Employment Type', options: { master: 'employment-types' }, multi: true },
    { kind: 'select', key: 'location',    label: 'Work Location',   options: { master: 'locations' },    multi: true },
    { kind: 'dateRange', key: 'joined',   label: 'Joining Date', field: 'join_date',
      presets: ['this-fy','last-fy','this-quarter','custom'] },
  ],
  rowRoute: r => ['/employee/record', r.id],
  headerActions: [{ label: '+ Add Employee', variant: 'primary', icon: 'plus', route: () => ['/employee/record/new'] }],
  export: { pdf: true, excel: true, fileStem: 'employee-directory' },
  emptyText: 'No employees added yet.',
} satisfies ListScreenConfig<EmployeeRow>;
```

Note what is **absent**: search, "include inactive", Created By / Last Modified By, and the Super Admin superset (§2.2e). `ListScreenComponent` injects those itself from the baseline set — that is the whole point of §2.2g ("inherited, never restated"). A per-screen config that restated them would be the bug.

### 3.2 `FieldConfig` and `FormScreenConfig` — the shape that carries 70 screens

```ts
export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'percent'
  | 'select' | 'multiselect' | 'radio' | 'toggle' | 'checkgroup'
  | 'date' | 'dateRange' | 'time' | 'file' | 'person' | 'lookup' | 'readonly';

export interface FieldValidators<T> {
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: { re: RegExp; message: string };
  /** Debounced async uniqueness check. Same endpoint the server uses. */
  readonly unique?: { endpoint: string; field: string; excludeIdFrom?: 'route' };
  /** Cross-field rule; `watch` drives revalidation. */
  readonly crossField?: { watch: readonly (keyof T & string)[]; rule: (v: Partial<T>) => string | null };
  /**
   * REQUIRED. The dotted name of the Pydantic validator / DB constraint this
   * client rule mirrors, e.g. 'LeaveTypeIn.max_carry_forward_lte_quota'.
   * Makes drift greppable: `rg serverRule apps/web | wc -l` must equal the
   * server's registered-validator count in the contract test (§7).
   */
  readonly serverRule: string;
}

export interface FieldConfig<T = Record<string, unknown>> {
  readonly name: string;                       // form control name === API payload key
  readonly label: string;                      // ALSO the RBAC field-rule match target (app-rbac.js FIELDS)
  readonly type: FieldType;
  readonly span?: 1 | 2 | 3;                   // prototype's `span`
  readonly required?: boolean | ((v: Partial<T>) => boolean);
  readonly placeholder?: string;               // prototype's `ph`
  readonly hint?: string;                      // prototype's `hint` — spec prose lives here
  readonly options?: OptionSource;             // prototype's `opts`
  readonly toggleLabel?: string;               // prototype's `on`
  readonly validators?: FieldValidators<T>;
  /** Derived/auto values. Rendered read-only with a lock chip + `reason` as the hint. */
  readonly derived?: {
    readonly from: readonly (keyof T & string)[];
    readonly compute: (v: Partial<T>) => unknown;
    readonly reason: string;                   // "Auto-generated from Financial Year start"
    readonly serverAuthoritative?: boolean;    // true ⇒ never sent in the payload
  };
  readonly readonly?: boolean | ((v: Partial<T>) => boolean);   // prototype's `ro`
  readonly lockLabel?: string;                 // prototype's `lock`
  readonly visibleWhen?: (v: Partial<T>) => boolean;
  readonly file?: { accepts: readonly string[]; maxSizeMb: number; multiple?: boolean };
  readonly permissionField?: string;
}

export interface FormSectionConfig<T> {
  readonly title: string;
  readonly note?: string;
  readonly columns?: 2 | 3;                    // default 3, matching .form-grid
  readonly fields: readonly FieldConfig<T>[];
  readonly collapsedByDefault?: boolean;
}

export interface FormScreenConfig<T = Record<string, unknown>> {
  readonly shape: 'form';
  readonly id: ScreenId;
  readonly title: string;
  readonly specRef?: string;
  readonly navHidden?: boolean;                // 62 of these
  readonly loadEndpoint?: (id: string) => string;
  readonly save: (id: string | null) => { url: string; method: 'POST' | 'PUT' | 'PATCH' };
  readonly sections: readonly FormSectionConfig<T>[];
  readonly buttons: readonly ActionDef<T>[];
  readonly footerNote?: string;
  readonly afterSave?: (saved: T) => readonly unknown[];
  readonly dirtyGuard?: boolean;               // default true → CanDeactivate
}
```

Ported from `app-forms.js:20` (`m.expensetypes`):

```ts
export default {
  shape: 'form', id: 'masters.expensetypes.add', title: 'Add Expense Type', specRef: 'Masters §3.3',
  navHidden: true,
  save: id => ({ url: id ? `/api/v1/masters/expense-types/${id}` : '/api/v1/masters/expense-types',
                 method: id ? 'PUT' : 'POST' }),
  sections: [{
    title: 'Add Expense Type',
    fields: [
      { name: 'name', label: 'Expense Type Name', type: 'text', span: 2, required: true,
        placeholder: 'e.g. Travel, Snacks, Internet / Wi-Fi, Office Rent', hint: 'Must be unique',
        validators: { maxLength: 80, unique: { endpoint: '/api/v1/masters/expense-types/check-name', field: 'name', excludeIdFrom: 'route' },
                      serverRule: 'ExpenseTypeIn.name_unique' } },
      { name: 'short_code', label: 'Short Code', type: 'text', placeholder: 'e.g. TRV, NET',
        validators: { maxLength: 8, pattern: { re: /^[A-Z0-9]+$/, message: 'Uppercase letters and digits only' },
                      serverRule: 'ExpenseTypeIn.short_code_format' } },
      { name: 'claim_type', label: 'Claim Type', type: 'select', required: true,
        options: { static: ['Reimbursable', 'Company-Paid'] },
        hint: 'Reimbursable — an employee paid out of pocket. Company-Paid — the company was billed directly.' },
      { name: 'recurring', label: 'Recurring', type: 'toggle', toggleLabel: 'Yes' },
      { name: 'default_bank_account_id', label: 'Default Bank Account', type: 'select',
        options: { master: 'bank-accounts', activeOnly: true }, hint: 'Optional. Pre-selects the account on Add Expense.' },
      { name: 'description', label: 'Description', type: 'textarea', span: 3 },
      { name: 'is_active', label: 'Status', type: 'toggle', required: true, toggleLabel: 'Active',
        hint: 'Defaults to Active. Deactivation is Super Admin only' },
    ],
  }],
  buttons: [{ label: 'Save', variant: 'primary' }, { label: 'Cancel' }],
  afterSave: () => ['/masters/expense-types'],
} satisfies FormScreenConfig<ExpenseTypeForm>;
```

### 3.3 The other six shapes (interfaces, abridged)

```ts
export interface RecordScreenConfig<T> {
  shape: 'record'; id: ScreenId; title: string; specRef?: string;
  loadEndpoint: (id: string) => string;
  header: { avatar?: (r: T) => string; primary: (r: T) => string; secondary: (r: T) => string;
            code: (r: T) => string; badges?: (r: T) => BadgeSpec[] };
  headerActions?: readonly ActionDef<T>[];
  tabs: readonly {
    id: string; label: string; permissionField?: string;
    /** Each tab is itself one of the shapes → tabs compose, they don't special-case. */
    content: { kind: 'fields'; sections: FormSectionConfig<T>[] }
           | { kind: 'list';   config: () => Promise<{ default: ListScreenConfig<any> }> }
           | { kind: 'custom'; load: () => Promise<Type<unknown>> };
  }[];
}

export interface BoardScreenConfig<T> {
  shape: 'board'; id: ScreenId; title: string;
  endpoint: string; groupBy: keyof T & string;
  columns: readonly { value: string; label: string; wipLimit?: number }[];
  card: { id: (r: T) => string; title: (r: T) => string; badge?: (r: T) => string;
          assignee?: (r: T) => string; due?: (r: T) => string; overdue?: (r: T) => boolean };
  moveEndpoint?: (id: string) => string;   // PATCH { status } — omit to disable DnD
  filters?: readonly FilterDef[];
  /** Board exports as the flat list it is built from (prototype app-screens.js:337). */
  exportAs: ListScreenConfig<T>;
}

export interface ReportScreenConfig {
  shape: 'report'; id: ScreenId; title: string;
  endpoint: string;                     // returns { kpis, tables, series }
  filters: readonly FilterDef[];        // reports are list screens per §2.2a
  kpis: readonly { key: string; label: string; icon: IconName; tone: ToneVar; unit?: string; foot?: string }[];
  tables: readonly { key: string; title: string; columns: readonly ColumnDef<any>[] }[];
  charts?: readonly ChartSpec[];
}

export interface DocumentScreenConfig<T> {   // invoice / bill / credit note
  shape: 'document'; id: ScreenId; title: string;
  loadEndpoint: (id: string) => string;
  letterhead: 'company-profile';                        // Masters §3.6
  parties: { from: 'company'; to: (d: T) => PartyBlock };
  lines: { array: keyof T & string; columns: readonly ColumnDef<any>[]; editable: boolean };
  totals: readonly { label: string; value: (d: T) => number; emphasis?: boolean }[];
  pdfEndpoint: (id: string) => string;                  // server-rendered, same letterhead
  statusActions: readonly ActionDef<T>[];
}
```

`CalendarScreenConfig` and `PayslipScreenConfig` follow the same pattern. **`shape: 'custom'` exists** and is the escape hatch for the ~19 genuine one-offs (`payroll.run` wizard, `rbac.matrix`, `emp.onboarding`, Company Profile's five tabs). Rule of thumb enforced in review: *if a second screen wants the same custom component, it becomes a shape or a config option.*

### Rendering

`ListScreenComponent` is ~200 lines and looks like this:

```ts
@Component({
  selector: 'cms-list-screen',
  imports: [PageHeadComponent, FilterBarComponent, DataTableComponent, PagerComponent, EmptyStateComponent],
  template: `
    <cms-page-head [title]="config().title" [specRef]="config().specRef"
                   [description]="config().description" [actions]="config().headerActions ?? []"
                   [screenId]="config().id" />
    @if (scopeNote(); as n) { <cms-note [kind]="n.kind" [html]="n.html" /> }
    <cms-filter-bar [config]="config()" [query]="store.query()" (change)="store.patchQuery($event)"
                    [shown]="store.shown()" [total]="store.total()" />
    <div class="card rise">
      <div class="card-body flush">
        @if (store.isLoading()) { <cms-table-skeleton [columns]="config().columns.length" /> }
        @else if (store.rows().length === 0) { <cms-empty [config]="config()" [query]="store.query()" /> }
        @else { <cms-data-table [config]="config()" [rows]="store.rows()" /> }
      </div>
      @if (store.total() > 0) { <cms-pager [query]="store.query()" [total]="store.total()" (change)="store.patchQuery($event)" /> }
    </div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListScreenComponent<T> {
  readonly config = input.required<ListScreenConfig<T>>();   // from the route resolver
  protected readonly store = createListStore(this.config());
  protected readonly scopeNote = computed(() => buildScopeNote(this.store.scope(), inject(SessionStore).role()));
}
```

51 screens, one component, and every one of them automatically gains a new baseline filter or export behaviour the day it is added here.

---

## 4. Client-side RBAC — three layers of UX, zero layers of security

> **The API is the authority.** Every guard, directive and hidden button in this section exists so a user is not shown a door they cannot walk through. None of it is a security control. Any client can edit a signal in devtools; if the corresponding FastAPI endpoint does not independently re-derive the same decision from the session's role, scope and the Masters toggles, that endpoint is broken regardless of what the Angular app renders. The rule for the backend team: **every endpoint calls `require(screen_id, action)` and every list query applies the scope predicate server-side** — the client never sends a role, a scope, or a permission, only a session cookie.

> **[BUILT-STATE]** The built API currently delivers auth as **bearer tokens in the `Authorization` header**, not a session cookie. The cookie-based delivery this section (and ARCH-2) assumes is deliberately deferred until the Angular auth-interceptor work actually begins — switching token transport is an interceptor + backend-cookie change best made when there is a real client to verify it against, and bearer headers are what every existing test and manual verification exercises today.

### Policy delivery

`GET /api/v1/me` returns the user plus a policy snapshot — the server-side twin of `app-rbac.js`:

```jsonc
{
  "id": "EMP-2026-0002", "name": "Vikram Iyer", "role": "manager",
  "policy": {
    "version": "2026-07-31T09:14:22Z",
    "screens": {
      "emp.directory":  { "mode": "view:team" },
      "asset.requests": { "mode": "team", "actions": { "Approve": true, "Reject": true } },
      "masters.taxes":  { "mode": "none" },
      "asset.record":   { "mode": "view:team",
                          "fields": { "Purchase Value": { "mode": "hidden", "reason": "Show Purchase Value to Manager is OFF" },
                                      "Depreciation Method": { "mode": "read", "reason": "…" } } }
    }
  }
}
```

Modes are exactly the prototype's: `full | view | view:team | own | team | none` (`app-rbac.js:17-23`). Field modes: `edit | read | hidden | masked`. The server generates this from the same tables that enforce it, so the two cannot diverge by construction — that was the explicit lesson recorded at the top of `app-rbac.js` ("twenty renderers silently ignored `role`").

### Policy store

```ts
@Injectable({ providedIn: 'root' })
export class PolicyStore {
  private readonly session = inject(SessionStore);
  private readonly p = computed(() => this.session.policy());

  mode(screen: ScreenId): ScreenMode { return this.p().screens[screen]?.mode ?? 'none'; }
  canOpen(screen: ScreenId) { return this.mode(screen) !== 'none'; }
  canEdit(screen: ScreenId) { const m = this.mode(screen); return m !== 'none' && m !== 'view' && m !== 'view:team'; }

  /** Read-only verbs are always allowed to anyone who can open the screen (RBAC §2.2f). */
  private static readonly READ_ONLY = /^(view|open|export|download|preview|print|cancel|back|close|clear)/i;

  can(screen: ScreenId, action: string): boolean {
    if (!this.canOpen(screen)) return false;
    if (PolicyStore.READ_ONLY.test(action)) return true;
    const explicit = this.p().screens[screen]?.actions?.[action];
    if (explicit !== undefined) return explicit;
    if (!this.canEdit(screen)) return false;
    if (/^(delete|deactivate)/i.test(action)) return this.session.role() === 'superadmin';
    return true;
  }

  fieldMode(screen: ScreenId, label: string): FieldMode {
    const s = this.p().screens[screen];
    if (!s || s.mode === 'none') return 'hidden';
    const f = s.fields?.[label];
    if (f) return f.mode;
    return s.mode === 'view' || s.mode === 'view:team' ? 'read' : 'edit';
  }

  lockReason(screen: ScreenId, label: string): string {
    return this.p().screens[screen]?.fields?.[label]?.reason
        ?? (this.canEdit(screen) ? '' : `Read-only for ${this.session.role()}`);
  }
}
```

### Layer 1 — route guards (screen visibility)

```ts
export const screenAccessGuard = (id: ScreenId): CanMatchFn => () => {
  const policy = inject(PolicyStore), router = inject(Router);
  if (policy.canOpen(id)) return true;
  return router.createUrlTree(['/403'], { queryParams: { screen: id } });
};
```

`CanMatch` (not `CanActivate`) is deliberate: it prevents the lazy chunk from even downloading, so a Manager never pulls the Payroll bundle. The sidebar is built from the same `canOpen()` predicate, so nav and routing cannot disagree.

### Layer 2 — action permission (structural directive)

```ts
@Directive({ selector: '[cmsCan]' })
export class CanDirective {
  private readonly vcr = inject(ViewContainerRef);
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly policy = inject(PolicyStore);
  private readonly screen = inject(SCREEN_ID);          // provided by the shape component

  readonly cmsCan = input.required<string>();            // the action label
  readonly cmsCanScreen = input<ScreenId>();             // override

  constructor() {
    effect(() => {
      const ok = this.policy.can(this.cmsCanScreen() ?? this.screen, this.cmsCan());
      this.vcr.clear();
      if (ok) this.vcr.createEmbeddedView(this.tpl);
    });
  }
}
```

```html
<button class="btn danger" *cmsCan="'Delete'">Delete</button>
```

In practice you write this rarely — `PageHeadComponent`, `DataTableComponent` and `FormBarComponent` filter their `ActionDef[]` through `policy.can()` internally, exactly as `U.pageHead` / `U.table` / `U.formbar` do in the prototype. That is the invariant worth preserving: **the shared builders enforce, so a screen that forgets cannot leak.**

### Layer 3 — field permission (attribute directive + hidden/masked rendering)

```ts
@Directive({ selector: '[cmsField]' })
export class FieldPermissionDirective {
  readonly cmsField = input.required<string>();          // the field LABEL, matching the policy
  private readonly policy = inject(PolicyStore);
  private readonly screen = inject(SCREEN_ID);
  readonly mode = computed(() => this.policy.fieldMode(this.screen, this.cmsField()));
  readonly reason = computed(() => this.policy.lockReason(this.screen, this.cmsField()));
}
```

`FieldComponent` consumes it and renders one of four ways — mirroring `U.field` (`app-core.js:336`):

| mode | render |
|---|---|
| `edit` | the control |
| `read` | the control, `disabled`, with a lock chip carrying `reason` |
| `masked` | `🔒 hidden` placeholder **in the same column alignment as the value it replaces** (§2.2 c-i.4) |
| `hidden` | nothing, and the control is **removed from the FormGroup** so it is never sent |

The last half-sentence matters: a `hidden` or `read` field must not appear in the PATCH body. `FormScreenComponent` builds the group from `fields.filter(f => policy.fieldMode(id, f.label) === 'edit')` and the rest render as read-only display rows.

### Layer 4 — scope

Scope is **not** implemented client-side at all. The prototype had to fake it (`applyScope`, `SCOPE_RULES`), and the file itself records how that went wrong ("an Employee could see all 8 projects"). With a real backend, the scope predicate lives in the FastAPI query builder; the client only *renders the note* explaining the scope, using `scope` from the list envelope:

```ts
// "Layer 4 — scope. This list is limited to My team (5) before any filter is applied."
```

### The honest failure mode, handled

A stale policy (someone toggled `Allow Accountant to Manage Taxes` while you had the app open) means the UI offers a button the API will reject. `errorInterceptor` catches `403` and:

1. shows a toast: *"The server declined that action. Your permissions may have changed."*
2. calls `SessionService.refreshPolicy()` (a cheap `GET /api/v1/me`),
3. and, if the `policy.version` changed, re-runs the guard on the current route.

That is the correct handling: the client corrects itself toward the server, never the other way.

---

## 5. Design system

### Tokens

`styles/tokens.css` is the prototype's `app.css` §1 verbatim — same variable names, same values, so the visual review already signed off transfers with zero re-derivation.

```css
:root{
  --canvas:#f1f2f5; --surface:#fff; --surface-sunk:#f7f8fa; --surface-raised:#fff;
  --border:#e0e3e9; --border-strong:#c7ccd6; --hairline:#eaecf0;
  --text-primary:#14171d; --text-secondary:#545b68; --text-tertiary:#878e9c; --text-inverse:#fff;
  --accent:#2a4bd7; --accent-hover:#1f3ab0; --accent-subtle:#eaeeff; --accent-line:#c3cffb;
  --success:#05704a; --success-bg:#e4f5ed; --success-line:#a8ddc6;
  --warning:#8f5300; --warning-bg:#fdf0dd; --warning-line:#f0cf9c;
  --danger:#ad2419;  --danger-bg:#fbe8e6;  --danger-line:#f0b8b3;
  --info:#0d6088;    --info-bg:#e4f2f9;    --info-line:#a9d4e8;
  --purple:#5b3aa6;  --purple-bg:#efe9fb;  --purple-line:#c9b8ec;
  --neutral-bg:#edeff3; --neutral-text:#545b68; --neutral-line:#d8dce3;
  --sidebar-bg:#14171e; --sidebar-bg-hover:#1d222c; --sidebar-bg-active:#222a3a;
  --sidebar-text:#959daf; --sidebar-text-active:#fff; --sidebar-border:#232833; --sidebar-muted:#666e80;
  --shadow-sm:0 1px 2px rgb(16 19 26 / .06);
  --shadow-md:0 6px 20px rgb(16 19 26 / .10), 0 1px 3px rgb(16 19 26 / .07);
  --shadow-lg:0 20px 48px rgb(16 19 26 / .22), 0 2px 8px rgb(16 19 26 / .10);
  --r-sm:4px; --r-md:6px; --r-lg:10px;
  --topbar-h:52px; --sidebar-w:246px; --sidebar-w-collapsed:56px;
  --font-sans:"IBM Plex Sans",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --font-mono:"IBM Plex Mono",SFMono-Regular,Consolas,Menlo,monospace;
}
:root[data-theme="dark"]{ --canvas:#0a0c11; --surface:#111419; /* … the full dark block … */ }
```

**Component styles use tokens only.** ESLint rule (`no-restricted-syntax` on `Literal` matching `/^#[0-9a-f]{3,8}$/i` inside `.component.ts` styles / `.css` under `features/`) fails CI on a raw hex outside `tokens.css`. This is the same discipline as the money-alignment rule: one place, enforced.

Fonts are **self-hosted** (`assets/fonts/ibm-plex-{sans,mono}-{400,500,600}.woff2`, `font-display:swap`, `<link rel="preload">` for Sans 400/600). No Google Fonts request — the CSP in §9 has no external `font-src`, and the app must work on a customer network that blocks fonts.googleapis.com.

### Light / dark

Attribute on `<html>`, plus `Match system` from the spec's three-way control:

```ts
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly ui = inject(UiStore);
  private readonly mq = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.mq.matches);

  /** The resolved theme, after 'system' is collapsed. */
  readonly resolved = computed<'light' | 'dark'>(() =>
    this.ui.theme() === 'system' ? (this.systemDark() ? 'dark' : 'light') : this.ui.theme() as 'light' | 'dark');

  constructor() {
    this.mq.addEventListener('change', e => this.systemDark.set(e.matches));
    effect(() => document.documentElement.setAttribute('data-theme', this.resolved()));
    effect(() => applyAccentRamp(this.ui.accent(), this.ui.customAccent(), this.resolved()));
    effect(() => applyScale(this.ui.scale()));
  }
}
```

Because `applyAccentRamp` writes **inline** custom properties on `documentElement`, they beat the stylesheet's `[data-theme]` block — the exact mechanism noted at `app-core.js:533`, which is what lets a live accent change survive a theme switch without recomputation.

### Runtime accent ramp

Direct port of `rampFrom` (`app-core.js:549`), unchanged mixing constants so custom colours look identical to the reviewed prototype:

```ts
// core/ui/accent.ts
type Rgb = [number, number, number];
const hexRgb = (h: string): Rgb => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s[0]!+s[0]!+s[1]!+s[1]!+s[2]!+s[2]!;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: Rgb, b: Rgb, t: number) => a.map((v, i) => v + (b[i]! - v) * t);

const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];
const DARK_CANVAS: Rgb = hexRgb('#0a0c11');    // must equal --canvas in the dark block

export interface AccentRamp { accent: string; hover: string; subtle: string; line: string }

export function rampFrom(hex: string, dark: boolean): AccentRamp {
  const base = hexRgb(hex);
  return dark
    ? { accent: toHex(mix(base, WHITE, .22)), hover: toHex(mix(base, WHITE, .38)),
        subtle: toHex(mix(base, DARK_CANVAS, .84)), line: toHex(mix(base, DARK_CANVAS, .66)) }
    : { accent: hex,                          hover: toHex(mix(base, BLACK, .22)),
        subtle: toHex(mix(base, WHITE, .90)),  line: toHex(mix(base, WHITE, .68)) };
}

/** Six hand-tuned presets, both halves pre-computed — a theme switch is a lookup, not a recompute. */
export const ACCENTS = {
  blue:   { name: 'Blue (default)', light: { accent:'#2a4bd7', hover:'#1f3ab0', subtle:'#eaeeff', line:'#c3cffb' },
                                    dark:  { accent:'#7592ff', hover:'#8fa6ff', subtle:'#18203a', line:'#2c3a63' } },
  purple: { /* … */ }, green: { /* … */ }, amber: { /* … */ }, rose: { /* … */ }, teal: { /* … */ },
} as const satisfies Record<string, { name: string; light: AccentRamp; dark: AccentRamp }>;

export function applyAccentRamp(accent: AccentName | 'custom', custom: string, theme: 'light' | 'dark') {
  const r = accent === 'custom' ? rampFrom(custom, theme === 'dark') : ACCENTS[accent][theme];
  const s = document.documentElement.style;
  s.setProperty('--accent', r.accent);
  s.setProperty('--accent-hover', r.hover);
  s.setProperty('--accent-subtle', r.subtle);
  s.setProperty('--accent-line', r.line);
}
```

The colour-picker input binds with `(input)` not `(change)`, so the interface recolours **while the user drags** — an explicit spec requirement (RBAC §2.3, table row "Accent Colour — custom").

Add one thing the prototype didn't have: an **APCA/WCAG contrast check** on the derived ramp. If `contrast(--accent, --surface) < 3.0`, the settings screen shows an inline warning ("This colour will be hard to read on light backgrounds") rather than silently shipping an illegible primary button. It warns; it does not block — the spec says any value is allowed.

### Display scale

The prototype used `document.body.style.zoom` (`app-core.js:600`). Keep it, deliberately:

```ts
export function applyScale(pct: number) {
  const n = Math.min(200, Math.max(80, Math.round(pct)));
  document.body.style.zoom = String(n / 100);
  document.documentElement.style.setProperty('--ui-scale', String(n / 100));
}
```

**Why `zoom` and not a rem-based scale**, given the type scale is `13px` base and every one of the ~900 CSS declarations in `app.css` is in px: converting 161 screens' worth of px to rem is weeks of work with a long tail of half-pixel regressions, and `zoom` reproduces the exact behaviour that was reviewed and signed off at 110%. `zoom` is now supported in all evergreen engines (Firefox added it in 126), it affects layout (unlike `transform: scale`, which would leave scrollbars and hit-testing wrong), and CDK overlays land inside `<body>` so they scale with it.

Two things to verify once and then leave alone:
- `position: fixed` descendants of a zoomed element (the sidebar, the topbar, `.cdk-overlay-container`) resolve against the zoomed viewport in Chromium/WebKit/Gecko — write a Playwright test at 80% and 200% asserting `sidebar.boundingBox().x === 0` and that a dropdown opens flush under its trigger.
- `--ui-scale` is exported for the two places that need to reason in unzoomed pixels (chart canvas DPR, and any `ResizeObserver` math).

Scale, theme and accent are **session-only, never written to storage** — RBAC §2.3 final paragraph. They live in `UiStore` signals and are additionally pushed to `PATCH /api/v1/me/preferences` so they follow the user to another machine, which is the stated reason Display Scale is an app setting rather than browser zoom. (Server-side persistence is not browser storage; the spec's prohibition is about `localStorage`.)

---

## 6. Data-table strategy

**Build it. Do not adopt AG Grid or Angular Material's table.**

Reasoning specific to this product: the visual language is hairline-ruled, 13px, `--hairline` row separators, `.mono` tabular-nums for codes and amounts, `.cell-accent` for identifiers, `.mini-av` avatars inline with names. Restyling AG Grid to that is more CSS than writing the table, and it fights you on the two things that actually matter here — **column-level RBAC masking** and **the money alignment rule**. Material's `MatTable` gives you almost nothing you need (no filtering, no export, no paging UI) at the cost of a hard dependency. The prototype's `U.table` is 30 lines and does the job; the Angular version is ~180.

### Architecture

```
DataTableComponent
  ├─ input: config: ListScreenConfig<T>, rows: T[]
  ├─ resolvedColumns = computed(() => resolveColumns(config(), policy, role))   ← the ONE pipeline
  ├─ header row: @for over resolvedColumns, sort click → patchQuery({sort})
  ├─ body:      @for (row of rows; track config().rowId(row))
  │              └─ CellComponent [column] [row]  — switches on column.type
  └─ row actions: filtered through policy.can()
```

Server-side everything: paging, sorting, filtering, search. No client-side sort — with `page_size=25` against a 300-row table, client sorting would sort the page, not the data, which is the classic silently-wrong table bug. The header sort control always round-trips.

Virtual scrolling is **opt-in** (`virtualScroll: true`), used on maybe four screens (`payroll.register` at full company size, `proj.timesheets`, audit logs). Everywhere else, 25–100 rows renders instantly and virtual scroll only breaks Ctrl+F and print.

### The money alignment rule, enforced in exactly one place

RBAC §2.2 c-i, with its own implementation note: *"this is enforced in one place, not per screen … Changing the house rule is a one-line change in that helper."*

```ts
// shared/data-table/column-policy.ts
//
// ★ THE SINGLE CONTROL POINT FOR MONEY ALIGNMENT ★
// RBAC Module 14 §2.2 c-i (set 2026-07-31, replacing a briefly-held right-aligned rule).
//
// Money  → LEFT, header and body together.
// Counts, quantities, hours, days, %, ageing → RIGHT.
// Numeric identifiers (HSN, PIN, invoice no, phone, "30 days") → text, LEFT.
// A masked amount keeps the alignment of the amount it replaces.
//
// To flip the whole product back to right-aligned money, change MONEY_ALIGN below.
// Nothing else in the codebase may set alignment on a money column: MoneyColumn
// declares `align?: never`, so an attempt is a compile error.

const MONEY_ALIGN = 'start' as const;
const NUMERIC_ALIGN = 'end' as const;

const MONEY_LABEL =
  /amount|total|value|salary|net pay|gross|balance|cost|price|rate|budget|payable|receivable|deduction|earning|reimburse/i;

export function isMoneyColumn(c: ColumnDef<unknown>): boolean {
  // A column masked by a field permission is still a money column for layout purposes.
  return c.type === 'money' || (c.type === 'masked' && MONEY_LABEL.test(c.header));
}

export interface ResolvedColumn<T> extends ColumnBase<T> {
  readonly type: ColumnType;
  readonly align: 'start' | 'end';
  readonly headerAlign: 'start' | 'end';       // always === align (c-i.1)
  readonly mono: boolean;
  readonly maskReason?: string;
}

export function resolveColumn<T>(c: ColumnDef<T>, masked: boolean, maskReason?: string): ResolvedColumn<T> {
  const type = masked ? 'masked' : (c.type ?? 'text');
  const money = isMoneyColumn({ ...c, type } as ColumnDef<unknown>);
  const numeric = !money && (type === 'number');
  const align = money ? MONEY_ALIGN : numeric ? NUMERIC_ALIGN : 'start';
  return { ...c, type, align, headerAlign: align, maskReason,
           mono: money || numeric || type === 'code' };
}

/** Column-level RBAC + alignment, in the order that makes masking alignment-preserving. */
export function resolveColumns<T>(cfg: ListScreenConfig<T>, policy: PolicyStore, role: RoleId): ResolvedColumn<T>[] {
  return cfg.columns
    .filter(c => !c.hideFrom?.includes(role))
    .filter(c => policy.fieldMode(cfg.id, c.permissionField ?? c.header) !== 'hidden')
    .map(c => {
      const mode = policy.fieldMode(cfg.id, c.permissionField ?? c.header);
      return resolveColumn(c, mode === 'masked', policy.lockReason(cfg.id, c.permissionField ?? c.header));
    });
}
```

Three enforcement layers so this cannot drift:

1. **Type-level** — `MoneyColumn` has `align?: never`. Setting it is a compile error.
2. **Runtime-level** — `DataTableComponent`, `ReportScreenComponent`, `DocumentScreenComponent` and `PayslipScreenComponent` all render exclusively from `ResolvedColumn`; there is no code path that puts a raw `ColumnDef` on screen.
3. **Test-level** — a unit test walks `ScreenRegistry.all()`, collects every column across all 161 configs, and asserts `isMoneyColumn(c) ⇒ resolveColumn(c).align === 'start' && headerAlign === align`. A new screen that adds a money column inherits the rule and the test proves it.

The document/payslip totals blocks (Subtotal / Tax / Grand Total) are not `ColumnDef`s, so they route through a second tiny export from the same file — `moneyClass()` — used by their templates. Same file, same constant, still one place.

### Export

```ts
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly http = inject(HttpClient);
  /**
   * §2.2f — what exports is exactly what is on screen. The client sends the SAME
   * ListQuery it is rendering; it never sends rows. The server re-runs the query
   * under the session's scope, so export cannot be a backdoor to more data than
   * the screen shows, and the header block (filters, count, who, when) is written
   * server-side where those facts are trustworthy.
   */
  download(cfg: ListScreenConfig<any>, query: ListQuery, format: 'pdf' | 'xlsx') {
    const url = `${cfg.endpoint}/export`;
    return this.http.get(url, { params: toHttpParams({ ...query, page: undefined, page_size: undefined, format }),
                                responseType: 'blob', observe: 'response' })
      .pipe(tap(res => saveBlob(res.body!, filenameFrom(res) ?? `${cfg.fileStem}-${today()}.${format}`)));
  }
}
```

Column visibility travels in the query (`cols=id,name,dept,…`) so a Manager's export omits the same columns their screen omits — but the server re-derives visibility anyway and intersects, because a client-supplied column list is a request, not a permission.

---

## 7. Forms

### FormGroup from FieldConfig

```ts
export function buildForm<T>(sections: readonly FormSectionConfig<T>[],
                             policy: PolicyStore, screen: ScreenId,
                             initial: Partial<T> = {}): FormGroup {
  const controls: Record<string, AbstractControl> = {};
  for (const s of sections) for (const f of s.fields) {
    const mode = policy.fieldMode(screen, f.permissionField ?? f.label);
    if (mode === 'hidden') continue;                                  // never in the payload
    const disabled = mode === 'read' || mode === 'masked' || f.readonly === true || !!f.derived;
    controls[f.name] = new FormControl(
      { value: initial[f.name as keyof T] ?? defaultFor(f), disabled },
      { validators: syncValidators(f), asyncValidators: asyncValidators(f), updateOn: f.validators?.unique ? 'blur' : 'change' });
  }
  return new FormGroup(controls);
}
```

Conditional requiredness, conditional readonly and `visibleWhen` are re-evaluated by one effect on the form's `valueChanges` signal, using `setValidators`/`updateValueAndValidity({ emitEvent: false })` to avoid loops.

### Validation mirrors server rules — and proves it

Every `FieldValidators` object **must** carry `serverRule: string` naming the Pydantic validator or DB constraint it mirrors. This is not documentation; it's the key for a contract test:

```
GET /api/v1/_meta/validators   →  ["ExpenseTypeIn.name_unique", "LeaveTypeIn.max_carry_forward_lte_quota", …]
```

A Vitest test (run in CI against the staging API, or against a checked-in snapshot regenerated by a make target) asserts:

- every `serverRule` referenced in the web app exists in that list → **client validates something the server doesn't** (fails: false confidence),
- every server rule flagged `client_mirror=True` is referenced by at least one field → **server rule with no client mirror** (fails: the user only finds out on submit).

This is the cheapest available answer to "validation mirroring server rules," and it is the only one that survives six months of drift.

Client-side validation is **never** the authority. `422` responses carry field-level detail and are mapped back:

```ts
export function applyServerErrors(form: FormGroup, err: HttpErrorResponse) {
  const detail = err.error?.detail as ServerFieldError[] | undefined;
  if (!Array.isArray(detail)) return false;
  for (const d of detail) {
    const path = d.loc.filter(p => p !== 'body').join('.');
    const c = form.get(path);
    if (c) { c.setErrors({ ...(c.errors ?? {}), server: d.msg }); c.markAsTouched(); }
    else   { form.setErrors({ ...(form.errors ?? {}), server: d.msg }); }   // form-level fallback
  }
  form.updateValueAndValidity({ emitEvent: false });
  return true;
}
```

`server` errors clear on the next edit of that control, so the message doesn't linger after the user fixes it.

### Derived / read-only fields

The prototype's rule (`app-forms.js` header) is worth keeping verbatim: *derived values are rendered read-only with a lock label and a hint explaining the derivation, never omitted and never described only in prose.* Concretely:

```ts
{ name: 'label', label: 'Financial Year Label', type: 'readonly',
  derived: { from: ['start_date'], reason: 'Auto-generated from Financial Year start',
             compute: v => v.start_date ? `FY ${fyLabel(v.start_date)}` : '',
             serverAuthoritative: true } }
```

`FormScreenComponent` wires derivation with one effect per derived field:

```ts
for (const f of derivedFields) {
  effect(() => {
    const v = this.formValue();                              // toSignal(form.valueChanges)
    if (f.derived!.from.some(k => v[k] === undefined)) return;
    const next = f.derived!.compute(v);
    const c = this.form.get(f.name)!;
    if (!Object.is(c.value, next)) c.setValue(next, { emitEvent: false });   // no loop, no dirty
  });
}
```

Three rules that keep this honest:

1. `serverAuthoritative: true` fields are **stripped from the payload** (`form.getRawValue()` minus those names). The client's computed value is a preview; the server recomputes and returns the truth, and the form patches from the response.
2. Derived controls are always `disabled`, so `form.value` naturally excludes them and `getRawValue()` is the explicit opt-in.
3. Anything money-shaped and derived (invoice totals, net pay) is `serverAuthoritative` **without exception** — there is no scenario where a rounding difference between a TS `number` and a server `Decimal` is acceptable on an invoice.

Unsaved-changes protection: `CanDeactivateFn` on any route whose config has `dirtyGuard !== false`, checking `form.dirty && !justSaved`.

---

## 8. HTTP layer

### Interceptor chain (order matters)

```ts
provideHttpClient(withFetch(), withInterceptors([
  requestIdInterceptor,   // adds X-Request-Id; the id appears in nginx + app logs + the error toast
  authInterceptor,        // attaches the access token; single-flight refresh on 401
  errorInterceptor,       // maps 400/401/403/404/409/422/5xx to UX; last so it sees refresh failures
]));
```

```ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.accessToken();                       // in-memory signal; refresh token is an HttpOnly cookie
  const authed = token && req.url.startsWith('/api/')
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status !== 401 || req.url.includes('/auth/refresh')) return throwError(() => e);
    return auth.refreshOnce().pipe(                        // shareReplay'd single flight
      switchMap(t => next(req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }))),
      catchError(() => { auth.logout('session-expired'); return throwError(() => e); }));
  }));
};
```

Tokens: short-lived access JWT held **only in a signal** (never `localStorage` — consistent with the no-browser-storage rule and with XSS hygiene), long-lived refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`. Same origin means no CORS config at all, and CSRF is covered by `SameSite=Strict` plus a double-submit header on state-changing requests.

> **[BUILT-STATE]** Not yet how the backend works: today it issues **bearer tokens returned in the response body and sent back as `Authorization` headers** — no HttpOnly refresh cookie, no CSRF double-submit. That design stays the target, but the migration is deferred to the start of Angular auth work (this interceptor is the natural moment to flip both ends at once). CSRF protections are moot until cookies carry credentials, so nothing is insecure about the interim state.

```ts
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService), session = inject(SessionService), router = inject(Router);
  return next(req).pipe(catchError((e: HttpErrorResponse) => {
    const rid = req.headers.get('X-Request-Id');
    switch (e.status) {
      case 0:   toast.error('Cannot reach the server. Check your connection.'); break;
      case 403: toast.warn('The server declined that action. Your permissions may have changed.');
                session.refreshPolicy(); break;
      case 404: if (req.method === 'GET') router.navigate(['/404'], { skipLocationChange: true }); break;
      case 409: toast.warn(e.error?.detail ?? 'This record changed since you opened it. Reload and try again.'); break;
      case 422: break;                                     // handled by the form; never toast a field error
      case 429: toast.warn('Too many requests — slow down for a moment.'); break;
      default:  if (e.status >= 500) toast.error(`Something went wrong. Reference: ${rid}`);
    }
    return throwError(() => e);
  }));
};
```

Surfacing `X-Request-Id` in the 5xx toast is the single highest-value support feature in the whole layer: the user reads you an id, you run `journalctl -u cms-api | grep <id>` and you have the traceback.

### The shared list-query contract

One serializer, used by every list screen, every export, and the URL sync — so "what's on screen" and "what exports" are provably the same object.

```ts
export interface ListQuery {
  page: number;                                   // 1-based
  page_size: 25 | 50 | 100;
  sort?: string;                                  // '-join_date' — '-' prefix = desc
  q?: string;
  filters: Record<string, string[]>;              // multi-select native
  date?: { field: string; from?: string; to?: string; preset?: DatePresetId };
  include_inactive?: boolean;
  cols?: string[];
}
```

Wire format:

```
GET /api/v1/employees
    ?page=1&page_size=25&sort=-join_date&q=nair
    &f.status=Active&f.status=On%20Notice
    &f.department=Engineering
    &date_field=join_date&date_from=2026-04-01&date_to=2027-03-31&date_preset=this-fy
    &include_inactive=false
```

`f.` prefix keeps filter keys in their own namespace so a filter named `sort` or `page` can never collide. Repeated keys are multi-select — no comma-joining, no escaping bugs on values like `Retired-Disposed`.

Response envelope (every list endpoint, without exception):

```jsonc
{
  "items": [ /* … */ ],
  "page": 1, "page_size": 25, "total": 312,
  "scope": "team",                         // drives the Layer-4 note; server-derived
  "applied_filters": [                     // drives the removable chips, in the server's own words
    { "key": "f.status", "label": "Status", "value": "Active, On Notice" },
    { "key": "date",     "label": "Joining Date", "value": "This Financial Year" }
  ],
  "sort": "-join_date"
}
```

`applied_filters` coming back from the server (rather than being reconstructed client-side) is what makes the spec's *"Empty results say which filters caused it"* rule correct even when the server normalises or ignores something.

Sending `date_preset=this-fy` **as well as** the resolved dates matters: the server resolves financial-year presets from Masters §3.1, never from a hardcoded April–March, and the export header block can then say "This Financial Year" rather than a pair of dates.

URL sync: `ListScreenComponent` writes query state to `queryParams` with `replaceUrl: true` for filter tweaks and a real push for page changes — so Back exits the list rather than walking back through nine filter edits, and any filtered view is a shareable link. That also satisfies §2.2's "persists for that user, on that screen, within a session" without a single line of storage code.

---

## 9. DigitalOcean droplet deployment

> **[BUILT-STATE]** No droplet has been provisioned — sizing, firewall, block volume, DO monitoring, TLS and UAT are all still pending real infrastructure. Two things HAVE been built in the meantime:
> 1. A **multi-stage `backend/Dockerfile`** (builder stage with the MySQL client toolchain, slim runtime stage, non-root `appuser`, `HEALTHCHECK` against `/health`) — built, run, and verified healthy locally. This is a **local-dev convenience only** and does not change this section's plan: the droplet still installs MySQL, FastAPI/gunicorn and nginx directly on the box, as specified here. The Dockerfile's own header says the same.
> 2. **`backend/docker-compose.yml`** runs MySQL 8.4 and (Phase 7 round 2) **Redis 7** locally — Redis backs the login rate limiter in §9.4's built-state note.

### 9.1 Sizing

For ~150 employees, realistically 30–60 concurrent users, dense read-heavy screens, PDF/Excel generation, and MySQL co-resident:

| Tier | Droplet | Monthly | Use |
|---|---|---|---|
| Pilot / UAT | `s-2vcpu-4gb` Premium AMD | ~$28 | First 3 months, ≤20 users |
| **Production (recommended)** | **`s-4vcpu-8gb-amd`, 160 GB NVMe** | **~$56** | 150 employees, headroom for payroll runs |
| Headroom | `s-8vcpu-16gb-amd` | ~$112 | Only if DB CPU sustains >60% |

Plus:
- **100 GB Block Storage volume** (~$10/mo) mounted at `/mnt/cms-data`, holding both `mysqlql/` and `files/`. Independently snapshot-able and resizable without resizing the droplet — and it means the droplet stays disposable.
- **DigitalOcean Cloud Firewall**: inbound 22 (from your office IP + GitHub Actions ranges, or via a jump host), 80, 443. Everything else denied. `ufw` mirrors it locally as defence in depth.
- **Weekly droplet backups** (20% of droplet cost) — for fast whole-machine recovery, *not* as the data backup strategy (§9.7).
- **DO Monitoring agent** with alerts: CPU >80%/5min, memory >85%, disk >80% (file storage grows), and a 1-minute uptime check on `https://cms.meshrd.in/api/v1/health`.

Memory budget at 8 GB: MySQL 2.5 GB, gunicorn 5 workers × ~250 MB = 1.25 GB, worker process 250 MB, nginx 100 MB, OS + page cache the rest.

### 9.2 Filesystem layout

```
/opt/cms/
├─ releases/2026-07-31T142200Z/
│  ├─ api/                       # FastAPI source
│  └─ venv/                      # per-release venv → rollback restores deps too
├─ current -> releases/2026-07-31T142200Z
└─ shared/
   ├─ .env                       # 0600 cms:cms
   └─ logs/

/srv/cms/web/                    # Angular build output — ADDITIVE (see §9.9)
/mnt/cms-data/                   # the block volume
├─ mysqlql/                   # PGDATA
└─ files/
   ├─ documents/{employee_id}/   # HR documents (Employee §2.7)
   ├─ payslips/{fy}/{month}/
   ├─ invoices/ bills/ assets/
   ├─ exports/                   # transient, pruned at 24h
   └─ tmp/
```

Users and permissions:

```bash
adduser --system --group --home /opt/cms cms
usermod -aG cms www-data                        # nginx may READ files, never write

install -d -o cms -g cms  -m 0750 /opt/cms/shared
install -d -o cms -g www-data -m 2750 /mnt/cms-data/files      # setgid: new files inherit group
find /mnt/cms-data/files -type d -exec chmod 2750 {} \;
setfacl -R -d -m g:www-data:rx /mnt/cms-data/files             # default ACL for future subdirs
chmod 600 /opt/cms/shared/.env
```

`2750` + the `www-data` group is the specific combination that makes X-Accel-Redirect work without ever letting nginx create or modify a file.

`/etc/fstab` for the volume:

```
UUID=<uuid>  /mnt/cms-data  ext4  defaults,nofail,noatime,discard  0 2
```

### 9.3 File serving — never direct

Payslips and HR documents must not be world-readable by URL. FastAPI authorises, then hands off to nginx:

```python
@router.get("/documents/{doc_id}/download")
async def download(doc_id: str, user: CurrentUser = Depends(current_user), db=Depends(get_db)):
    doc = await documents.get_for_user(db, doc_id, user)      # 403/404 decided here
    return Response(headers={
        "X-Accel-Redirect": f"/protected/{doc.storage_path}",  # e.g. /protected/documents/EMP-.../id.pdf
        "Content-Disposition": f'attachment; filename="{quote(doc.filename)}"',
        "Content-Type": doc.mime,
        "X-Content-Type-Options": "nosniff",
    })
```

nginx does the bytes (sendfile, no Python in the transfer path), and `internal;` makes `/protected/...` unreachable from outside.

### 9.4 nginx

`/etc/nginx/sites-available/cms.meshrd.in`:

```nginx
upstream cms_api {
    server unix:/run/cms/api.sock fail_timeout=0;
    keepalive 16;
}

# Precomputed, so we never gzip the same asset twice.
gzip_static on;

server {
    listen 80;
    listen [::]:80;
    server_name cms.meshrd.in;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name cms.meshrd.in;

    ssl_certificate     /etc/letsencrypt/live/cms.meshrd.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cms.meshrd.in/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.conf;

    # Enable HSTS only after you have verified renewal works twice.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy same-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
       img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; \
       frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;

    client_max_body_size 25m;              # spec caps documents at 5 MB; headroom for multi-file
    access_log /var/log/nginx/cms.access.log combined buffer=32k flush=5s;
    error_log  /var/log/nginx/cms.error.log warn;

    # ---- Angular app -------------------------------------------------------
    root /srv/cms/web;
    index index.html;

    # Hashed build output: immutable, cached hard.
    location ~* ^/(main|polyfills|styles|chunk|scripts)-[A-Z0-9]+\.(js|css)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public";
    }
    location = /index.html {
        add_header Cache-Control "no-store, must-revalidate";
    }
    location = /version.json {
        add_header Cache-Control "no-store";
    }
    location / {
        try_files $uri $uri/ /index.html;    # SPA deep links
    }

    # ---- API ---------------------------------------------------------------
    location /api/ {
        proxy_pass http://cms_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id      $request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout   60s;
        proxy_buffering on;
    }

    # Payroll runs, big exports, PDF batches: longer leash, own location.
    location ~ ^/api/v1/(payroll/runs|.*/export|reports/.*/pdf) {
        proxy_pass http://cms_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;               # stream the file out as it is produced
    }

    # ---- Authorised file delivery (X-Accel-Redirect target) ----------------
    location /protected/ {
        internal;
        alias /mnt/cms-data/files/;
        sendfile on;
        tcp_nopush on;
        add_header X-Content-Type-Options nosniff always;
    }

    location = /api/v1/health { proxy_pass http://cms_api; access_log off; }
}
```

Rate limiting for the login endpoint, in `nginx.conf` `http{}`:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
```
```nginx
location = /api/v1/auth/login {
    limit_req zone=login burst=5 nodelay;
    proxy_pass http://cms_api;  # + the standard proxy_set_header block
}
```

> **[BUILT-STATE]** Login rate limiting now ALSO exists at the application level: `backend/app/core/rate_limit.py` (Phase 7 hardening round 2) implements a fixed-window Redis counter — **5 failed attempts / 15 min**, tracked **per-account AND per-source-IP** independently, reset on successful login, and **failing open** (a Redis outage logs a warning and lets login proceed rather than adding a second single point of failure). The nginx `limit_req_zone` above is **still worth layering on** once a droplet exists — the two catch different attack shapes: nginx's per-IP zone throttles a single noisy source cheaply before it reaches Python, while the app limiter's per-account key stops a botnet spreading one victim's password guesses across many IPs, which nginx cannot see.

### 9.5 gunicorn + uvicorn + systemd

`/opt/cms/shared/gunicorn.conf.py`:

```python
import multiprocessing

bind = "unix:/run/cms/api.sock"
umask = 0o007                       # socket group-accessible to www-data
worker_class = "uvicorn.workers.UvicornWorker"
workers = 5                         # 4 vCPU, async workload. Not 2n+1 — that heuristic is for sync workers.
worker_tmp_dir = "/dev/shm"
timeout = 120
graceful_timeout = 30
keepalive = 5
max_requests = 2000                 # cheap insurance against slow leaks in PDF/Excel libs
max_requests_jitter = 200

# CRITICAL: must stay False. With preload_app=True, `systemctl reload` (SIGHUP)
# re-forks workers from the ALREADY-LOADED parent and your new code is never
# picked up — the deploy silently does nothing. See deploy.sh in §9.9.
preload_app = False

accesslog = "-"                     # → journald
errorlog = "-"
access_log_format = '%({x-request-id}i)s %(h)s "%(r)s" %(s)s %(b)s %(D)sus'
```

> **[BUILT-STATE]** The application side of this contract is now built (`backend/app/core/logging_config.py` + middleware in `app/main.py`): a request-id middleware honours/creates the `x-request-id` header this `access_log_format` reads, stores it in a `contextvar`, and every application log line carries `request_id=…` so app logs correlate with the access line. Two deliberate divergences from §9.8's wording: (a) the format is **plain single-line stdlib logging, not JSON** — chosen because `journalctl -u cms-api` grep-ability is the actual consumption path and one-line-per-event reads better there than JSON blobs; (b) a **global exception handler** logs full tracebacks server-side (tagged with the request id) while returning a generic 500 body. gunicorn/systemd themselves remain unverified until a droplet exists.

`/etc/systemd/system/cms-api.service`:

```ini
[Unit]
Description=Meshrd CMS API (FastAPI/gunicorn)
After=network-online.target mysqlql.service
Wants=network-online.target
Requires=mysqlql.service

[Service]
Type=notify
User=cms
Group=cms
RuntimeDirectory=cms
RuntimeDirectoryMode=0750
WorkingDirectory=/opt/cms/current/api
EnvironmentFile=/opt/cms/shared/.env
ExecStart=/opt/cms/current/venv/bin/gunicorn -c /opt/cms/shared/gunicorn.conf.py app.main:app
ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
TimeoutStopSec=45
Restart=always
RestartSec=3

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/mnt/cms-data/files /opt/cms/shared/logs
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
```

`cms-worker.service` — same shape, `ExecStart=… python -m app.worker`, handles the email outbox (Mailgun), scheduled jobs (leave accrual, warranty-expiry notices, export pruning), and PDF batch generation. Backed by a MySQL-based queue (`SELECT … FOR UPDATE SKIP LOCKED`), not Redis — one fewer daemon on a single box, and the job table is inspectable with SQL when something goes wrong.

### 9.6 MySQL: on the droplet, with an explicit exit criterion

> **[BUILT-STATE] Residual Postgres-era content in this section.** This section (and scattered spots elsewhere in §9: `mysqlql/` in the filesystem layout, `mysqlql.service` in the systemd unit, the `PGPASSFILE`/`mysqldump -Fc`/`pg_restore`/`wal-g`/`pg_stat_statements` fragments in §9.7, `mysql:16`/`pg_isready` in §10's CI YAML) was mechanically renamed from an earlier Postgres draft and its parameters (`shared_buffers`, `work_mem`, WAL settings, `wal-g` PITR) are **Postgres knobs that do not exist in MySQL**. The built state is unambiguous: the backend runs **MySQL 8.4** (utf8mb4, InnoDB, `caching_sha2_password`), backups are **`mysqldump --single-transaction --routines --triggers`** (see `backend/scripts/backup.sh` and the real CI workflow `.github/workflows/backend-ci.yml`, which uses a `mysql:8.4` service with `mysqladmin ping` health checks). The section's ARGUMENT — DB co-resident on the droplet, localhost-only, with written exit criteria for moving to managed hosting — still stands; the tuning block needs re-derivation for InnoDB (`innodb_buffer_pool_size` etc.) when the droplet is provisioned.

**Start self-hosted on the droplet.** For one app server, ~150 users, and an internal-only tool, Managed MySQL ($15–60/mo for the useful tiers) buys you PITR, automated failover and someone else's pager — but costs a network hop on every query (measurable on the dense 25-row-with-joins list screens), a second thing to firewall, and money that is better spent on droplet RAM at this stage.

**Migrate to Managed MySQL the moment any of these is true**, and write this list into the runbook so it's a decision, not a drift:

1. You need point-in-time recovery and haven't actually built and *tested* WAL archiving.
2. You add a second app server (the DB can no longer live on "the" droplet).
3. An audit or customer contract requires DB backups outside the app operator's control.
4. Sustained DB CPU >60% or you start tuning `work_mem` per query.
5. Nobody on the team wants to own a major-version upgrade.

Tuning for 8 GB, `/etc/mysqlql/16/main/conf.d/cms.conf`:

```ini
data_directory = '/mnt/cms-data/mysqlql/16/main'
listen_addresses = 'localhost'          # never exposed; app connects over localhost/unix socket
max_connections = 100

shared_buffers = 2GB
effective_cache_size = 5GB
maintenance_work_mem = 512MB
work_mem = 16MB
wal_buffers = 16MB
min_wal_size = 1GB
max_wal_size = 4GB
checkpoint_completion_target = 0.9
random_page_cost = 1.1                  # NVMe
effective_io_concurrency = 200
default_statistics_target = 100

wal_level = replica                     # required for wal-g / PITR later
archive_mode = on
archive_command = '/usr/local/bin/wal-push %p %f'   # no-op stub until §9.7 tier 2 is enabled

log_min_duration_statement = 500ms
log_checkpoints = on
log_lock_waits = on
log_line_prefix = '%m [%p] %q%u@%d '
shared_preload_libraries = 'pg_stat_statements'
timezone = 'Asia/Kolkata'
```

Connection pool: SQLAlchemy `pool_size=5, max_overflow=5` × 5 workers = 50 peak, comfortably under 100. No pgbouncer needed at this size — add it only if you go to >8 workers.

### 9.7 Backups

> **[BUILT-STATE]** The backup/restore mechanism is BUILT and PROVEN, with one marked gap:
> - `backend/scripts/backup.sh` — dumps via `mysqldump --single-transaction --routines --triggers` (local binary or `docker exec` fallback, same script both places), tars the file tree, and encrypts with openssl AES-256-CBC using `BACKUP_ENCRYPTION_KEY` (openssl over gpg/age: present on every base Ubuntu image with zero extra packages).
> - `backend/scripts/restore.sh` — restores into a `*_restore_test` target DB by default so a drill can never clobber the live database by accident.
> - `backend/scripts/restore_drill.sh` — the acceptance gate was actually RUN: backup → restore into a scratch DB → **table list + per-table row counts compared between source and restored; all 136 tables matched**. The drill verifies data fidelity, not just exit codes.
> - **Off-box upload is a clearly marked TODO** at the end of `backup.sh`: no Spaces bucket or credentials exist until the droplet does, so the `rclone`/`s3cmd` step below cannot be wired in yet. Everything before it (dump, tar, encrypt) runs today. The specific tooling below (`age`, `restic`, `wal-g`, systemd timers, healthchecks.io pings) is therefore still plan, and the DB fragments are Postgres-era (see §9.6 note).

Two independent things get backed up, on different schedules, to a **different failure domain** (DigitalOcean Spaces in a different region from the droplet).

**Database — Tier 1 (mandatory, day one):**

`/usr/local/bin/cms-db-backup`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
export PGPASSFILE=/opt/cms/shared/.pgpass
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/mnt/cms-data/backups/cms-${TS}.dump

install -d -m 0700 -o mysql -g mysql /mnt/cms-data/backups
mysqldump -Fc -Z6 -U cms_backup -h /var/run/mysqlql cms -f "$OUT"

# Encrypt before it leaves the box. Key lives in .env, and ALSO in the password manager.
age -r "$(cat /opt/cms/shared/backup.pub)" -o "${OUT}.age" "$OUT" && rm "$OUT"

rclone copy "${OUT}.age" "spaces:meshrd-cms-backups/db/" --s3-no-check-bucket
find /mnt/cms-data/backups -name '*.age' -mtime +7 -delete       # local: 7 days
logger -t cms-backup "db backup ${TS} ok $(stat -c%s "${OUT}.age") bytes"
```

Retention on Spaces via a bucket lifecycle rule: 30 daily, 12 monthly. Timer: nightly 02:15 IST.

```ini
# /etc/systemd/system/cms-db-backup.timer
[Timer]
OnCalendar=*-*-* 02:15:00 Asia/Kolkata
RandomizedDelaySec=300
Persistent=true
```

**Database — Tier 2 (recommended before go-live):** `wal-g` weekly base backup + continuous WAL push to Spaces, giving RPO ≈ 5 minutes instead of ≈ 24 hours. Payroll and invoices are exactly the data where "we lost today" is not an acceptable sentence.

**Files:** `restic` (dedup + encryption + snapshots, and cheap incrementals over a directory that only grows):

```bash
restic -r s3:https://blr1.digitaloceanspaces.com/meshrd-cms-backups/files \
       backup /mnt/cms-data/files --exclude /mnt/cms-data/files/tmp --exclude /mnt/cms-data/files/exports
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
```

Nightly at 03:00, after the DB dump.

**Restore drill — monthly, calendared, non-negotiable.** A backup you have never restored is a hypothesis. The drill: spin a $12 droplet, `restic restore` the newest snapshot, `pg_restore` the newest dump into a fresh cluster, boot the API against it, log in, open `payroll.register` and one employee record. Record the wall-clock time; that number is your actual RTO. Destroy the droplet. Cost: ~₹40 and 30 minutes.

**Backup monitoring:** each script pings a healthchecks.io (or Uptime Kuma) URL on success. Silence is the alert — a backup cron that has been failing for six weeks is the standard way this goes wrong.

### 9.8 TLS, logs, mail

**TLS:**

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d cms.meshrd.in --agree-tos -m ops@meshrd.in --no-eff-email
# Renewal timer is installed automatically. Verify it, twice, before enabling HSTS:
certbot renew --dry-run
systemctl list-timers certbot.timer
```

Deploy hook so nginx picks up the new cert: `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` → `systemctl reload nginx`.

**Logs:** the app logs structured JSON to stdout; systemd captures it into journald. No app-owned logfiles, no app-owned rotation, no "disk full because someone forgot logrotate."

> **[BUILT-STATE]** Stdout-only logging is built, but **not JSON**: `backend/app/core/logging_config.py` deliberately emits a plain single-line stdlib format (`timestamp level logger request_id=… message`) because journalctl + grep is the read path and one-line events beat JSON blobs there. TLS/certbot above is entirely pending — no domain or droplet exists to issue a certificate against.

```ini
# /etc/systemd/journald.conf.d/cms.conf
[Journal]
Storage=persistent
SystemMaxUse=2G
MaxRetentionSec=30day
```

nginx keeps file logs (its logrotate config ships with the package); override retention:

```
# /etc/logrotate.d/nginx  (edited)
/var/log/nginx/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 $(cat /var/run/nginx.pid)
    endscript
}
```

MySQL logs rotate via `log_rotation_age = 1d`, `log_rotation_size = 100MB`, `log_truncate_on_rotation = on`, 30 files.

**Mailgun:**

```
MAILGUN_API_KEY=...              # in /opt/cms/shared/.env, 0600
MAILGUN_DOMAIN=mail.meshrd.in
MAILGUN_BASE_URL=https://api.mailgun.net/v3     # or api.eu.mailgun.net
MAIL_FROM="Meshrd CMS <no-reply@mail.meshrd.in>"
```

DNS: SPF `v=spf1 include:mailgun.org ~all`, Mailgun's DKIM TXT, MX records for the sending subdomain, and a CNAME for tracking. Use a **subdomain** (`mail.meshrd.in`) so CMS sending reputation is isolated from the company's primary domain.

Sending goes through the `email_outbox` table → `cms-worker` → Mailgun HTTP API (never SMTP from the request path; a slow mail server must never hold an HTTP request open). Masters §3.21 stores the provider config in the DB with credentials encrypted at rest using a key from `.env`; the outbox row records the Mailgun message id. `POST /api/v1/webhooks/mailgun` receives bounce/complaint events with HMAC signature verification and flips the employee's email to "bouncing" so HR sees it rather than wondering why the payslip never arrived.

### 9.9 Zero-ish-downtime deploy

> **[BUILT-STATE]** A `backend/scripts/deploy.sh` exists but is a **written, UNVERIFIED skeleton**: it encodes the load-bearing shape from this section (timestamped release dirs, health-check loop BEFORE the symlink swap, atomic `ln -sfn` + `mv -T` cutover, keep-5 pruning) but leaves the artifact-transfer and migration steps as explicit TODOs — there is no droplet, registry, or SSH target to fill them in against, and guessing was judged worse than a visible gap. Nothing in this section has been exercised on real infrastructure.
>
> The health gate's dependency IS built: **`/health` now performs a real `SELECT 1` against the database and returns 503 when the DB is down** (`app/main.py`), so both this script's health loop and §9.1's DigitalOcean uptime monitor test the DB path, not just process liveness. (The built route is `/health` on the app, not `/api/v1/health` — the nginx proxy will map the public path when it exists.) The Dockerfile's `HEALTHCHECK` hits the same endpoint and was verified healthy in a running container.

`/opt/cms/bin/deploy.sh` (owned by `cms`, `0750`):

```bash
#!/usr/bin/env bash
# Meshrd CMS deploy. Idempotent, atomic, self-rolling-back.
set -Eeuo pipefail

RELEASES=/opt/cms/releases
SHARED=/opt/cms/shared
WEB=/srv/cms/web
KEEP=5
TS=$(date -u +%Y-%m-%dT%H%M%SZ)
NEW="$RELEASES/$TS"
PREV=$(readlink -f /opt/cms/current || true)
BUNDLE=${1:?usage: deploy.sh /path/to/release.tar.gz}

log() { printf '\e[36m[deploy %s]\e[0m %s\n' "$TS" "$*"; }
fail() { printf '\e[31m[deploy %s] FAILED:\e[0m %s\n' "$TS" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. unpack
log "unpacking $BUNDLE"
install -d "$NEW"
tar -xzf "$BUNDLE" -C "$NEW"                  # contains api/ and web/
[ -d "$NEW/api" ] && [ -d "$NEW/web" ] || fail "bundle missing api/ or web/"

# ---------------------------------------------------------------- 2. venv
log "building venv"
python3 -m venv "$NEW/venv"
"$NEW/venv/bin/pip" install --quiet --upgrade pip
"$NEW/venv/bin/pip" install --quiet -r "$NEW/api/requirements.txt"

# ---------------------------------------------------------------- 3. migrate
# Expand/contract discipline: a deploy may ADD columns/tables and BACKFILL, but
# never DROP or NOT-NULL a column the currently-running code still writes. The
# drop ships one deploy later. This is what makes the overlap window below safe.
log "running migrations"
( set -a; . "$SHARED/.env"; set +a
  cd "$NEW/api" && "$NEW/venv/bin/alembic" upgrade head ) || fail "migration failed — nothing swapped"

# ---------------------------------------------------------------- 4. static (ADDITIVE)
# No --delete. A browser that loaded index.html 40 seconds ago will still request
# the OLD hashed chunk when the user opens a lazy route. Deleting it is the classic
# post-deploy ChunkLoadError. Old files are pruned by mtime, weekly, in a separate job.
log "syncing web assets (additive)"
rsync -a --checksum "$NEW/web/" "$WEB/"
printf '{"build":"%s"}\n' "$TS" > "$WEB/version.json"

# ---------------------------------------------------------------- 5. atomic swap
log "swapping current -> $TS"
ln -sfn "$NEW" /opt/cms/current.tmp
mv -Tf /opt/cms/current.tmp /opt/cms/current       # rename(2): atomic, no missing-symlink window

# ---------------------------------------------------------------- 6. graceful reload
# gunicorn's SIGHUP re-execs workers one at a time; in-flight requests finish on the
# old worker (graceful_timeout=30). Requires preload_app=False — see §9.5.
log "reloading api"
sudo -n /bin/systemctl reload cms-api
sudo -n /bin/systemctl restart cms-worker          # worker has no in-flight HTTP; a restart is fine
sudo -n /bin/systemctl reload nginx                # drop cached fds pointing into the old release

# ---------------------------------------------------------------- 7. health gate
log "health check"
for i in $(seq 1 30); do
  body=$(curl -fsS --max-time 3 https://cms.meshrd.in/api/v1/health || true)
  if [ "$(printf '%s' "$body" | jq -r '.status // empty')" = "ok" ] \
  && [ "$(printf '%s' "$body" | jq -r '.build // empty')" = "$TS" ]; then
      log "healthy after ${i}s"; HEALTHY=1; break
  fi
  sleep 1
done

if [ "${HEALTHY:-0}" != 1 ]; then
  log "UNHEALTHY — rolling back to $PREV"
  ln -sfn "$PREV" /opt/cms/current.tmp && mv -Tf /opt/cms/current.tmp /opt/cms/current
  sudo -n /bin/systemctl reload cms-api
  sudo -n /bin/systemctl reload nginx
  fail "health check failed; rolled back. Migrations were NOT reverted (expand/contract makes this safe)."
fi

# ---------------------------------------------------------------- 8. prune
log "pruning old releases (keeping $KEEP)"
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP + 1)) | xargs -r rm -rf
log "done: $TS"
```

`/api/v1/health` returns `{"status":"ok","build":"<TS from env>","db":"ok"}` — checking the build id is what makes the gate meaningful; a plain 200 would pass against the *old* process.

Sudo is scoped, not blanket, in `/etc/sudoers.d/cms`:

```
cms ALL=(root) NOPASSWD: /bin/systemctl reload cms-api, /bin/systemctl restart cms-worker, /bin/systemctl reload nginx, /bin/systemctl status cms-api
```

**Why "zero-ish" and not zero:** the SIGHUP reload has a sub-second window where a new connection can hit a worker mid-recycle, and gunicorn's reload is sequential so old and new code overlap for a few seconds. That overlap is exactly why the expand/contract migration rule is mandatory rather than advisory. True zero-downtime (blue/green: two systemd units on `api-blue.sock` / `api-green.sock`, nginx `upstream` swapped by a generated include + `nginx -s reload`) is a ~40-line addition to this script — worth doing when the business starts running payroll during business hours, not before.

**Client-side version drift:** `AppShell` polls `/version.json` every 5 minutes; if `build` differs from the compiled-in value, a non-blocking toast appears — *"A new version is available. Reload when convenient."* Combined with additive static deploys, a user mid-form is never broken by a deploy.

---

## 10. CI/CD

> **[BUILT-STATE]** What exists is one workflow, `.github/workflows/backend-ci.yml` — backend only (import check, `alembic upgrade head`, full pytest against a `mysql:8.4` service container). It is **written and reviewed but has never run**: the repo has no git remote, so GitHub Actions has never seen it. The `web` job below is entirely future (no Angular app), the `contract` job's parity scripts don't exist yet, and `deploy.yml` (droplet SSH, forced-command key, staging environment) is blocked on the droplet. The Postgres-flavored bits in the `api` job YAML (`mysql:16`, `pg_isready`, `mysqlql://` URLs) are superseded by the real workflow's MySQL 8.4 setup — see the §9.6 note.

GitHub Actions, two workflows, one droplet, one staging environment on the same box.

**`.github/workflows/ci.yml`** — on every push and PR:

```yaml
jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: apps/web/package-lock.json }
      - run: npm ci
        working-directory: apps/web
      - run: npx tsc --noEmit -p tsconfig.json          # strict + strictTemplates
        working-directory: apps/web
      - run: npx ng lint
        working-directory: apps/web
      - run: npx vitest run --coverage                   # incl. the column-policy + serverRule tests
        working-directory: apps/web
      - run: npx ng build --configuration production
        working-directory: apps/web
      - name: Pre-compress for gzip_static
        run: find dist/web/browser -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \) \
               -exec gzip -9 -k {} \;
        working-directory: apps/web
      - uses: actions/upload-artifact@v4
        with: { name: web, path: apps/web/dist/web/browser, retention-days: 14 }

  api:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:16
        env: { MYSQL_ROOT_PASSWORD: test, MYSQL_DATABASE: cms_test }
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 3s --health-retries 10
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12', cache: pip }
      - run: pip install -r apps/api/requirements-dev.txt
      - run: ruff check apps/api && ruff format --check apps/api
      - run: mypy apps/api
      - run: alembic upgrade head && alembic downgrade -1 && alembic upgrade head   # migrations reversible
        working-directory: apps/api
        env: { DATABASE_URL: 'mysqlql://mysql:test@localhost/cms_test' }
      - run: pytest -q --cov=app
        working-directory: apps/api
        env: { DATABASE_URL: 'mysqlql://mysql:test@localhost/cms_test' }

  contract:
    needs: [web, api]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Fails if a client `serverRule` names a validator the server doesn't have,
      # or a server rule marked client_mirror has no client validator. (§7)
      - run: python tools/check_validator_parity.py
      # Fails if a ScreenId used in an Angular route has no policy entry server-side. (§4)
      - run: python tools/check_screen_registry_parity.py
```

**`.github/workflows/deploy.yml`** — staging on merge to `main`, production on a `v*` tag with a required reviewer:

```yaml
on:
  push: { branches: [main] }
  release: { types: [published] }

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event_name == 'release' && 'production' || 'staging' }}
    concurrency: deploy-${{ github.event_name == 'release' && 'prod' || 'staging' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { name: web, path: bundle/web, run-id: ${{ github.event.workflow_run.id }} }
      - run: rsync -a apps/api/ bundle/api/ --exclude __pycache__ --exclude .venv
      - run: tar -czf release.tar.gz -C bundle .
      - uses: webfactory/ssh-agent@v0.9.0
        with: { ssh-private-key: ${{ secrets.DEPLOY_KEY }} }
      - run: |
          scp -o StrictHostKeyChecking=accept-new release.tar.gz \
              cms@${{ secrets.DROPLET_HOST }}:/opt/cms/shared/incoming/release.tar.gz
          ssh cms@${{ secrets.DROPLET_HOST }} deploy     # forced command; see below
      - name: Smoke test
        run: |
          curl -fsS https://${{ vars.APP_HOST }}/api/v1/health | jq -e '.status=="ok"'
          curl -fsS -o /dev/null -w '%{http_code}\n' https://${{ vars.APP_HOST }}/ | grep -q 200
```

**Deploy key hardening** — `~cms/.ssh/authorized_keys` uses a forced command, so a stolen CI key can run exactly one script and nothing else:

```
command="/opt/cms/bin/deploy.sh /opt/cms/shared/incoming/release.tar.gz",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding ssh-ed25519 AAAA... github-actions-deploy
```

(A second key with `command=".../rollback.sh"` gives you a one-command manual rollback that doesn't need interactive shell access either.)

**Staging on the same droplet:** a second nginx `server` block on `staging.cms.meshrd.in`, a `cms-api-staging.service` on `api-staging.sock`, a `cms_staging` database, and `/srv/cms/web-staging`. Costs nothing, and it is where migrations get rehearsed against a **restored copy of last night's production dump** — which is simultaneously the monthly restore drill from §9.7. Two obligations for one job.

**Secrets:** `.env` is *not* in CI. It lives on the droplet, `0600 cms:cms`, and is itself backed up (encrypted, separately, to the password manager). CI knows only `DEPLOY_KEY`, `DROPLET_HOST`, `APP_HOST`. If a new env var is needed, it is added to the droplet by a human, and `deploy.sh` fails fast on a missing required key (`app.settings` validates on import, so gunicorn refuses to start and the health gate rolls back automatically).

**Branch protection:** `main` requires the `web`, `api` and `contract` jobs green plus one review. Production deploys additionally require the `production` GitHub Environment's reviewer approval — which is the cheapest possible change-control record for a system that prints payslips.

---

## Build order (recommended)

1. **Shell + tokens + theme/accent/scale + login + `/api/v1/me`** — the design system and the policy pipe, end to end, on one real screen. Everything else depends on the policy shape being right.
2. **`ListScreenComponent` + `DataTableComponent` + `column-policy.ts` + `FilterBarComponent` + list-query contract**, proven on `emp.directory` and `asset.directory` (the latter exercises `hideFrom` and money masking together).
3. **`FormScreenComponent` + `FieldConfig` renderers + 422 mapping**, proven on the three hardest Masters forms.
4. Then the 14 modules become mostly config authoring, which parallelises across the team and across the 14 spec documents.

The single biggest risk to this plan is someone writing screen #37 as a bespoke component because the config didn't quite fit. The mitigation is the one the prototype already discovered and wrote down: **enforce in the shared builders, not in the screens** — a screen that forgets a rule should still produce correct output.