# Meshrd CMS — Complete End-to-End Build Prompt

**One prompt. The whole system. The prototype is the reference.**

Every number in this document was verified by reading the actual files on 2026-08-05, not taken from
documentation. Where something is unverified it says so.

---

## 0. Mission

Turn `prototype/` into a working product.

The prototype is a clickable, RBAC-aware, 168-screen HTML/JS build of the entire system. **It is approved.
It is correct. It is the primary reference for UI, fields, actions, filters, roles, copy, and layout.** Your
job is not to redesign it — it is to make it real: real database, real authorization, real persistence, real
validation, and every control actually doing what it claims.

Where the prototype and a `.md` spec disagree on *behaviour*, the spec wins. Where they disagree on *what a
screen looks like or contains*, the prototype wins. Where the built Angular app disagrees with the
prototype, **the prototype wins** — the built app has silently dropped things, and §4 exists because of that.

---

## 1. Verified current state — what exists, what doesn't

Do not rebuild what is built. Do not assume anything below is different from what it says.

### 1.1 The prototype — `prototype/`

| Fact | Value |
|---|---|
| Module groups | **16** — Dashboard, Employee, Leave & Payroll, Asset, Ticket, Project, Opportunity, Customer, Invoice, Expense, Purchase Bill, Tax & Compliance, Vendor, Masters, Roles & Access, Settings |
| Total screens | **168** |
| `navHidden` screens (reached from a button, not the sidebar) | **65** |
| Screens per module | masters 50 · emp 21 · proj 14 · leave 12 · asset 12 · payroll 10 · tax 9 · exp 7 · ticket 6 · inv 6 · rbac 5 · opp 5 · cust 5 · vendor 3 · pb 3 |
| Masters sub-masters | **21** (`01-masters-module.md` §3.1–§3.21) — the 19 in the directory table **plus §3.20 Work Week & Hours and §3.21 Email Configuration**, which were added after that table was last renumbered. The directory table is stale; §3.1–§3.21 is the truth |
| Screen shapes | list **56** · form **73** · record **10** · report **4** · document/checklist/calendar/board **2 each** · plus **~19 bespoke one-off renderers** |
| Bespoke renderers | `payslip` `payrollrun` `matrix` `taxdecl` `taxoverview` `pipeline` `invdash` `expsummary` `depreciation` `dashboard` `conversation` `attendance` `assign` `assetcard` `letter` `leavemy` `feedpage` `settings` `taskdetail` |

**Open `prototype/index.html` in a browser first.** It runs from `file://` with no server. Sign in with any
of the five one-click role chips and walk the app as each role before writing code — the prompt below will
make far more sense afterwards.

Files, in load order (`index.html` loads them with `?v=49` cache-busting):
`app.css` (design tokens) → `data.js` (screen registry + mock data) → `app-rbac.js` (authorization tables)
→ `app-core.js` (router, shell, login, breadcrumb, `U.*` UI builders) → `app-forms.js`
(`window.FORMS_EXT`, form field definitions) → `app-screens.js` + `app-screens2.js` (renderers `R.*`) →
`window.CMS_BOOT()`.

> **⚠ `index.html`'s own header comment is out of date — do not size the build from it.** It documents
> "14 modules, 151 screens" and refers to "88 screens" in its assumptions. The live registry in `data.js`
> now holds **168 screens across 16 module groups** (Tax & Compliance and Settings were added later, among
> others). **Trust `data.js`, not the comment.** The comment is still valuable for its *reasoning* — the
> assumptions A1–A14, the per-role access summaries, and the field-coverage audit notes are all worth
> reading — but every count in it is stale.

### 1.2 Backend — `backend/` — mostly complete, with real holes

**38 API modules** under `app/api/v1/`. Models, schemas, RBAC registry, Alembic migrations all present.

**But 18 routers have no `PUT`/`PATCH` at all**, which is why the frontend has no Edit on those screens:

```
financial_years  expenses  leave_requests  announcements  adhoc_adjustments
employee_documents  employee_lifecycle  attendance  attendance_reconciliation
compensatory_hours  compliance  leave_balance  leave_reports  notifications
payroll_runs  payslips  files  auth
```

Verb counts on the ones that matter (GET/POST/PUT/PATCH/DELETE):

| Router | G | P | PUT | PATCH | DEL | Consequence |
|---|---|---|---|---|---|---|
| `masters_lookup` (factory for 15 lookups) | 1 | 2 | 1 | 0 | 1 | fine |
| `masters_taxes` | 1 | 4 | 1 | 0 | 1 | fine |
| `financial_years` | 1 | 4 | **0** | 0 | **0** | **no edit, no delete — see §4.1** |
| `expenses` | 7 | 7 | **0** | 0 | **0** | claim can never be corrected |
| `leave_requests` | 3 | 4 | **0** | 0 | **0** | request can never be amended |
| `announcements` | 1 | 3 | **0** | 0 | **0** | can't edit or withdraw an announcement |
| `adhoc_adjustments` | 1 | 2 | **0** | 0 | **0** | spec §2.1a requires Edit **and** Remove |
| `invoices` | 5 | 3 | 1 | 0 | **0** | |
| `assets` | 11 | 10 | 2 | 0 | **0** | |
| `employees` | 8 | 8 | 4 | 0 | 1 | |
| `projects` | 13 | 12 | 8 | 0 | 4 | |

### 1.3 Frontend — `frontend/` (Angular 19) — one module of fifteen

**Shared screen spine** (`src/app/shared/screens/`) — 5 config-driven shapes. Already working:
filters + chips + result count + filter-naming empty states · filter persistence via sessionStorage ·
Export PDF/Excel · **export follows the filter, and warns before exporting when a `client`-transport filter
can't be honoured** · row actions with confirm dialogs · Edit/Save/Cancel on records · Cancel navigates to
`listRoute` · cell formatting (badges, ₹ grouping, dd-mm-yyyy) · 47-icon set · FY date presets read from
real Financial Year rows · column policy.

**Masters** — 73 screen routes, 55 config files. Built. **But incomplete against the prototype — see §4.**

**Employee, Customer, Vendor** — 2 screens each (a directory and a *flat field-group* record where the
prototype has tabbed records).

**Eleven modules have no frontend at all** — Leave, Payroll, Asset, Ticket, Opportunity, Project, Invoice,
Expense, Purchase Bill, Tax & Compliance, RBAC admin.

**How `coming-soon` works, and what must happen to it.** It is not a per-module placeholder page — it is a
*fallback*. `layout/nav-registry.ts` holds a `screen_key → route path` map for screens with a real built
component, and `routeForScreen()` returns that path if one exists, else `['/coming-soon', screenId]`. So:

- **A screen stops showing "coming soon" the moment you register its real route in that map.** No separate
  cleanup step, no per-module switch to flip. Build the screen, add the route, the placeholder is gone for
  it.
- **The map is the honest progress tracker.** Its size against the 168-screen inventory is the real
  completion percentage.
- **When the last screen is routed, delete `coming-soon.component.ts` and change the fallback to a
  not-found page.** Keeping a polite placeholder past that point is actively harmful: an unrouted screen
  would silently look intentional instead of surfacing as the bug it now is.

**Missing from the shared spine, everywhere:** breadcrumbs (**zero** occurrences in `src/`) and a Back
control (**zero** — the only "Back" in the app is on the forgot-password page).

---

## 2. The six non-negotiables

These apply to every screen in every module. They are not a checklist item at the end — they are the
definition of a finished screen. **Five of the six exist because the client asked for them explicitly** —
Back, filters, filter-based export, runtime-configurable RBAC down to the field, and UI fidelity to the
prototype.

### ① BACK on every page

Every screen that is not a top-level nav destination gets a visible **Back** control. **65 prototype screens
are `navHidden`** — reached from a button and absent from the sidebar — so without Back the user is
stranded on every one of them.

- Back returns to the **actual origin**, not a guessed parent. A record opened from a filtered list returns
  to that list **with its filters intact** (sessionStorage persistence already makes this work — Back just
  has to navigate to the right route).
- Unknown origin (deep link, refresh, arrived from a notification) → fall back to the config's declared
  parent. Never a dead end.
- **Breadcrumbs on every screen below a module root** — Module › List › Record › Sub-screen, every ancestor
  clickable, record segments showing the record's real identity ("Employees › Priya Raman › Salary
  Structure"), active tab as the last segment.

  **Correction to an earlier reading of the prototype: it DOES have breadcrumbs.** `app-core.js`'s
  `renderCrumb()` fills `<div class="crumb" id="crumb">` in the topbar (index.html) with
  `Meshrd CMS / <Module> / <Screen>`, both leading segments clickable. It is only **three segments deep** —
  no record identity, no tab. So: **port the prototype's trail, then extend it** with the record and tab
  segments. The Angular app currently has neither — zero breadcrumb code of any kind.
- Dirty-state guard before discarding unsaved edits. `record-screen` already tracks `isEditing()`.
- Browser Back behaves identically; a URL alone reproduces the screen including record id, active tab, and
  filters.
- **Built once in the shared spine, configured per screen. Never hand-rolled per page.**

### ② FILTERS on every list screen, for every role

- **Every screen showing more than one row filters.** Self-service screens ("My Leave", "My Payslips", "My
  Assets"), approval queues, history tables, report views, record-screen tabs, and all 50 Masters screens.
- **Every filter is available to every role that can open the screen.** Role scope is applied to the data
  **before** filtering, so a filter narrows what a role already sees and can never widen it — withholding
  one protects nothing.
- **Super Admin gets every filter on every page**, unscoped, plus Created By, Last Modified By,
  show-inactive/archived, and all-financial-years.
- **Baseline set on every list**, on top of screen-specific filters: search · date range with FY presets
  (read from real Financial Year rows) · multi-select status · owner/assigned-to · active-inactive.
- Two exceptions only, both about a filter being *meaningless* rather than restricted: a dimension where
  every row already belongs to the viewer, and a filter on a field that role cannot see (the column
  governs, the filter follows).
- AND-combining · removable chips · "Clear all" · visible result count ("Showing 24 of 312") · empty state
  names the filters that caused it.

### ③ FILTER-BASED EXPORT on every list screen, for every role

- **Export to PDF and Export to Excel on every list screen, available to every role that can open it.**
- **What exports is exactly what is on screen** — current filters, search, sort, column set. **There is no
  "export everything" that bypasses the filter.** To get everything, clear the filters first.
- **Every exported file carries a header block**: filters applied, result count, who exported, when.
- **Role-hidden columns stay out of that role's export.** The column governs; no second permission rule.
- **`FilterDef.transport` is load-bearing.** `'server'` only after reading that router. A wrong guess fails
  silently: the API ignores the param, the screen shows unfiltered rows, the chip claims a filter is
  applied, and the export header states something untrue. The spine already warns when a `client` filter
  can't be honoured — keep that honest as you scale.

### ④ EVERY PAGE, EVERY ACTION, EVERY FIELD — RBAC-CONFIGURABLE BY SUPER ADMIN, AT RUNTIME

Today the prototype's authorization lives in **static JS tables** and the backend's in **seed data**. The
requirement is that a Super Admin edits permissions **in the running application** and they take effect
immediately — no redeploy, no re-login, no developer.

**This is universal. It is not a feature of a few screens.**

| Layer | Scope of the requirement |
|---|---|
| **1 — Screen visibility** | All **168** screens across all **16** modules |
| **2 — Action permission** | Every page action and every row action on every screen — **except delete, which is Super-Admin-only by platform rule and deliberately not grantable (§4a)** |
| **3 — Field / column visibility** | **Every field on every screen in every module** — `hide` · `read` (locked) · `masked`. Roughly **900+ field instances** exist in the prototype today (~518 form fields + ~383 list columns), before counting fields drawn inline by the bespoke renderers |
| **4 — Data scope** | `own` / `team` / `view:team` / `full` on every list and record |

**On Layer 3 specifically, because it is the one most likely to be built too narrowly.** The prototype
carries field rules for only **7 screens** (Project Directory's Budget, Asset's Purchase Value, Vendor's
bank/GST fields, Employee's Salary Structure block, Asset's Depreciation Method). Those are **seed data,
not the specification.** The requirement is that **every field of every screen in every module is
registered and governable** — Employee, Leave, Payroll, Asset, Ticket, Project, Opportunity, Customer,
Invoice, Expense, Purchase Bill, Tax & Compliance, Vendor, Masters, RBAC, Settings. If a Super Admin wants
to hide a customer's GSTIN from Manager, mask a bank account number from HR, or lock a due date for
Accountant, that must be a few clicks in the admin UI — never a code change and never a request to a
developer.

**Registration must be automatic.** Each screen already declares its fields and columns in its config;
derive the field registry from that at build/startup and sync it into the RBAC tables. A hand-maintained
second list of 900+ fields would be wrong within a week.

See §3 for the model. This is the largest architectural change in the project and must be built **before**
the 11 remaining modules — every screen built afterwards then registers itself automatically, whereas
retrofitting 900 fields across 168 screens later is the expensive path.

### ⑤ UI FIDELITY — reproduce the prototype's layout, placement and composition exactly

**The prototype is not a mood board. It is the UI specification.** Button placement, tab placement, tab
order, what sits in a header versus a body, which control is primary, where a count badge goes, what is a
table versus a timeline — all of it is decided, approved, and must be reproduced. **Do not redesign, do not
"improve", do not reorder.** If a placement looks wrong, raise it — do not silently fix it.

#### The page composition order — every screen, top to bottom

| Order | Block | Placement rules |
|---|---|---|
| 1 | **`page-head`** | Screen title **left** (with its `§` spec ref and, where the grant is view-only, a **Read-only badge**); optional one-line description under it; **all page actions right-aligned** in `page-actions`. The primary action carries `.primary` |
| 2 | **`rec-head`** *(record screens only)* | The identity card: avatar/icon, record **code**, **name**, a `meta` row of secondary facts separated by dots, and a **status badge**. Record-level actions sit **right** in `rec-actions`. Headline figures (e.g. Total Invoiced / Received / Outstanding) sit here as a **persistent summary** — and are then **not repeated** in the body |
| 3 | **`tabs`** | Directly under the identity card. Active tab carries `.on`. **Every tab that counts rows shows a count badge** (`<span class="cnt">`) |
| 4 | **`filterbar`** | One row: **search box on the left** (~216px), then the filter selects in order, then **Export PDF + Export Excel pushed hard right** (`margin-left:auto`). **Below that row: the chips line** — every applied filter as a removable chip, plus the Period and Scope chips, plus Super Admin's "All filters, unscoped" chip |
| 5 | **Content** | `card` = `card-head` (title left, muted sub-label beside it, optional right-slot for a control) → `card-body` → optional `card-foot`. Tables render inside a `table-wrap` |
| 6 | **`formbar`** *(forms only)* | Pinned at the bottom: explanatory **note on the left**, **buttons on the right**, primary last |

#### Table rules

- **The Actions column is always last and right-aligned** (`<th class="r">Actions</th>`), holding the row
  actions inline.
- Money columns right-aligned; codes, dates and IDs in the **mono** face; the identifying column carries
  `cell-strong`; clickable codes carry `cell-accent`.
- A row that opens a record is `clickable`; a **row action's target always beats the row's own target**.

#### Tabs — the worked example the client asked about

**Customer 360 (`cust.360`) has exactly these eight tabs, in this order, and this is what "reproduce the
prototype" means in practice:**

| # | Tab | Count badge | What it actually is |
|---|---|---|---|
| 1 | **Overview** | — | The master record fields, read-only, in a `section` grid. Carries the note that the money summary lives in the header above and is deliberately **not repeated here** |
| 2 | **Contacts** | ✓ | Mini table (Name · Designation · Email · Phone · Primary) **+ a primary "Add Contact" button below the table** |
| 3 | **Activities** | ✓ | **A timeline, not a table** — one `tl-item` per activity, each with a colour-toned dot keyed to type (Meeting = accent, Call = success, Email = info, Note = warning), the actor and date in the head, the description in the body. **+ a primary "Add Activity" button below** |
| 4 | **Opportunities** | ✓ | Mini table + a note that it is **read-only because the Opportunity module owns the deal**; rows link out to that module |
| 5 | **Projects** | ✓ | Mini table, rows link to the Project module |
| 6 | **Invoices** | ✓ | Mini table, rows link to Invoice — **plus the note that this tab is the data source for the header's Total Invoiced / Received / Outstanding figures**, which are summed from here rather than stored |
| 7 | **Tickets** | ✓ | Mini table, rows link to Ticket |
| 8 | **Files** | ✓ | Attachments |

Read `app-screens2.js`'s `RECORDS` entry for `cust` and reproduce it. **Then apply the same treatment to
every other tabbed record** — Employee Master Record, Asset Master Record, Vendor, Opportunity, Project,
Company Profile, Taxes. Each one's tab set, tab order, counts, per-tab body shape, per-tab notes and
per-tab buttons are already decided in the prototype.

#### The principles behind the placements — so you extend them consistently

- **A sub-resource is a tab, never a nav button.** No "Addresses →" links out of a record.
- **Tabs carry counts** so you can see what's there without opening them.
- **A tab that another module owns is read-only and says so**, and links out rather than duplicating edit.
- **Headline figures live in the identity header, once** — never restated in a tab body.
- **A tab's "add" action sits inside that tab, below its content**, not in the page header.
- **Not every tab is a table.** Activities is a timeline because it is chronological. Match the shape to the
  data, exactly as the prototype does.

#### Design system

Port `prototype/app.css` as the design system rather than approximating it: **IBM Plex Sans + IBM Plex
Mono** (tabular numerals on every figure), graphite/ink sidebar, cobalt `#2a4bd7` accent, hairline rules,
`rise` elevation on cards, the badge colour map, and the 47-icon set. Light **and** dark themes.

### ⑥ EVERYTHING DYNAMIC — nothing hardcoded

See §6. If a Super Admin could plausibly want it different, it is configuration, not code.

---

## 3. Runtime-configurable RBAC — build this early

### 3.1 What the prototype already defines (transcribe it, don't invent it)

`prototype/app-rbac.js` is a complete, working authorization matrix. **Verified contents:**

- **`POLICY` — 126 screens × 5 roles.** Each cell is one of **six modes**:
  `full` · `view` · `view:team` · `team` · `own` · `none`.
  (Distribution across all cells: none 298, full 199, own 80, view 38, view:team 9, team 6.)
- **`ACTIONS` — 26 screens** carrying named per-action permissions, e.g.
  `'masters.fy': { 'Lock': ['superadmin'], 'Edit': ['superadmin'] }`. Values are either a role array **or a
  function of role that reads a toggle** — e.g. `'+ New Ticket'` allows Employee only when
  `TOGGLES['Allow Staff to Create New Tickets']` is on.
- **`TOGGLES` — 47 named feature flags** with defaults.
- **`FIELDS` — the field-level layer (Layer 3), and the one the built app has entirely missing.** Screen id
  → an array of rules, each shaped:

  ```js
  { m: /regex on the field or column label/i,
    hide: ['role', …],      // field disappears entirely
    read: ['role', …],      // field visible but locked
    mask: ['role', …],      // value obscured (e.g. ****4321)
    toggle: 'Named RBAC toggle',
    invert: true|false }    // most toggles GRANT when ON; invert flips that
  ```

  **The client's own example is already here, verbatim:**
  ```js
  'proj.directory': [{ m: /^budget/i, hide: ['employee'],
                       toggle: "Hide Budget from Employee's Project View", invert: true }]
  ```
  Others in the table: Purchase Value hidden from Manager on 4 Asset screens (`Show Purchase Value to
  Manager`) · Depreciation Method read-only for HR · Vendor GSTIN/PAN/bank read-only for Manager · the
  whole Salary Structure earnings block read-only for HR/Accountant/Manager (`Allow HR to Edit Salary
  Structure`).

- **`fieldMode(role, screenId, label)`** resolves to `edit` · `read` · `hidden` · `masked`.
- **`lockReason(role, screenId, label)`** returns *why* a field is locked — e.g. `"Allow HR to Edit Salary
  Structure is OFF"`. **Keep this.** A locked field that doesn't say why is a support ticket; one that names
  the toggle is self-explaining, and it is what makes a runtime-configurable permission system usable.
- **`READ_ONLY_ACTIONS`** — a regex (`view|open|export|download|preview|cancel|back|close|clear`) that
  classifies non-mutating actions so a `view` grant still allows them. Keep this concept: **export and back
  must never be blocked by a read-only grant.**
- `mode(role, screenId)` and `can(role, screenId, actionLabel)` are the other two resolution functions.

> **Do not be misled by `frontend/src/app/shared/screens/column-policy.ts`.** Despite the name it is purely
> about number/money column *alignment* and contains no permission logic whatsoever. **The built Angular app
> has no field-level RBAC at all** — `FIELDS`, `fieldMode`, `lockReason` and every rule above are unported.
> This is a from-scratch build, not a migration.

**Seed the database from these tables verbatim.** They are the client-validated matrix — do not re-derive
them from the specs and do not "improve" them during migration.

### 3.2 What to build

**Schema** — tables for: roles (so a 6th role can be created without code) · screens (registry, seeded from
the 168-screen inventory) · actions per screen · **fields per screen** · toggles · role-permission rows
(role × screen → mode) · role-action rows · **role-field rows** · per-user overrides · and a permission
change log.

**The field layer must be open-ended, and universal across all 16 modules — not a copy of the prototype's
seven screens.** The prototype hardcodes field rules for 7 screens because that is all its own specs needed.
Those seven are seed data. The requirement is that **Super Admin can hide, lock, or mask ANY field on ANY
screen in ANY module for ANY role, at runtime, without a code change** — all ~900+ of them. That means:

- **Every screen registers its own field/column inventory automatically** — derived from the screen config
  it already declares (`fields[]` on form/record shapes, `columns[]` on list shapes), synced into the RBAC
  tables at build or startup. Never a hand-maintained second list: 900+ fields curated by hand would be
  stale within a week, and a field missing from the registry is a field nobody can govern.
- **Bespoke renderers must register too.** The ~19 one-off renderers (payslip, payroll run, matrix,
  pipeline, depreciation, letter, conversation…) draw fields inline in templates rather than from a config
  array. Give each an explicit field manifest — historically this is exactly where fields go unregistered
  and silently ungovernable.
- A field rule is a row: screen · field · role · mode (`edit` / `read` / `hidden` / `masked`) · optional
  governing toggle · optional invert.
- **Seed the prototype's 7 screens' rules verbatim** as the starting *default state*, including
  `proj.directory` → Budget hidden from Employee. They are validated defaults — **not the limit of what is
  governable.** Every other field in every other module starts at "visible to whoever can open the screen"
  and is editable from there.
- **Hiding a column hides its filter with it** (§2② exception 2) and **keeps it out of that role's export**
  (§2③). One rule, three enforcement points — implement it once in the spine, not per screen.
- **Enforce on the server.** A hidden field must be absent from the API response for that user, not merely
  hidden in the DOM. `masked` is masked server-side too. Otherwise "Employee cannot see Budget" is a
  CSS-level fiction that any browser devtools session defeats.
- Surface `lockReason` in the UI wherever a field is `read` or `masked`.

**Resolution** — one server-side resolver returning an effective permission set per user, composed as:
role policy → role action grants → field visibility → data scope → **per-user overrides last**. Cache it,
and **invalidate on any permission write** — a permission change must take effect without a redeploy and
without the user logging out.

**Enforcement** — server-side, per request, on every endpoint. The Angular guard and the UI's
show/hide/disable are a courtesy layer, never the control. Every list endpoint applies the **data scope**
(`own` / `team` / `view:team` / `full`) *before* filters.

**Admin UI** — the prototype's own 5 RBAC screens (`rbac.*`): Role Directory, Role Permission Matrix,
Individual Permission Overrides **plus a company-wide overrides view**, Permission Change Log. The matrix is
the primary surface: screen × role, editable, grouped by module, with the 4 layers as sub-rows.

**The matrix must scale to the real numbers** — 168 screens × 5+ roles for Layer 1, and **900+ fields ×
roles** for Layer 3. A flat table of that size is unusable, so: collapse by module → screen → field, filter
by module/role/layer, search by field name, show only non-default rules by default with a "show all"
toggle, and support bulk-apply (e.g. "hide every field matching *bank account* from Manager everywhere").
Without bulk operations, exercising this feature across 16 modules by hand is not realistic.

**Guardrails, all mandatory:**
- Super Admin cannot remove its own access to the RBAC screens — the system must refuse to produce a state
  with no one able to administer it.
- Every permission change is written to the change log with old value, new value, who, and when.
- Changing a role's permission affects everyone holding it — warn with the affected user count first.
- A per-user override is always marked in the UI as "different from role default".
- Toggles are stored and editable in the same admin area; the 47 defaults come from the prototype.

**Adding a 6th role must require no code change** — the prototype claims to be "ready but not built" for
this; make it genuinely true.

---

## 4. Fix Masters against the prototype — the pattern to learn from

Masters is "built" (73 routes, 55 configs) but has silently dropped things. **The client found one; assume
there are more, and audit all 50 prototype Masters screens field-by-field, action-by-action.**

### 4.1 The worked example — Financial Year (FIXED — verified 2026-08-06)

This was the original finding that started this audit. **It has since been fixed and independently
re-verified against the current source**: `financial_years.py` now has `PUT /{fy_id}`, the frontend form
carries a real `updateEndpoint`, and `start_date` is no longer `createOnly`. Kept here as the worked
example of the defect class in §4.3 — do not "fix" it again, and do not assume this table still describes
the running code.

| | Prototype (`masters.fy`) | Built, at time of original finding |
|---|---|---|
| Row actions | `['Edit', 'Lock']` | Set Current · Lock · Unlock — no Edit |
| Form | Add | create-only — no `updateEndpoint` |
| Start Date | enterable | `createOnly: true` — frozen after creation |
| End Date | — | derived `start + 1 year − 1 day`, not enterable |
| Backend | — | `financial_years.py`: 0 PUT, 0 DELETE |

### 4.2 The same defect class — current status (re-verified 2026-08-06)

Of the four forms originally flagged with no `updateEndpoint`:

- **`financial-years`** — **fixed** (see 4.1).
- **`company-addresses`** — **fixed**. `company-addresses.form.config.ts` now carries a real
  `updateEndpoint`; its own comment even records it was "named alongside financial-years as a defect,"
  past tense.
- **`pay-cycles`** — **still create-only.** No `updateEndpoint` in `pay-cycles.form.config.ts`.
- **`saturday-overrides`** — **still create-only.** No `updateEndpoint` in
  `saturday-overrides.form.config.ts`.

**Fix the remaining two** — `pay-cycles` and `saturday-overrides` — backend and frontend, same pattern as
the two already fixed.

### 4.3 The audit you must actually run

For **each** of the 50 prototype Masters screens, compare against its built config and report:

- every field in `app-forms.js` / `FORMS` missing from the built form config
- every field enterable in the prototype but read-only, derived, or `createOnly` in the build
- every dropped `<select>` option
- every page action and **row action** missing (Edit especially)
- every filter and column missing
- whether edit is possible at all
- anything the build added that the prototype lacks (report it — it may be right, but it must be deliberate)

**A field counts as implemented only if it is a rendered field.** A hint, a note, or prose does not count.
Derived values render read-only with a lock affordance and a hint explaining the derivation.

---

## 4a. The write-authority rule — system-wide, no exceptions

**Client instruction, 2026-08-05. This governs every module, every screen, every endpoint.**

### DELETE is Super Admin only. Always.

**No role other than Super Admin may ever delete, void, hard-delete, or deactivate any record anywhere in
this system.** Not on a screen they can otherwise fully manage, not on a record they created themselves,
not with a toggle. **This one is not RBAC-configurable** — it is a fixed platform rule, and the RBAC admin
UI must not offer it as a grantable permission at all.

This is not new: Masters §3.0 already states it as rule 1 — *"Delete and Deactivate are Super Admin only.
No other role can ever delete or switch off a Master entry — even on a sub-master they are allowed to add
to or edit."* The instruction extends that same rule from Masters to the **entire application**.

**How it must appear:** a role without delete rights **does not see the control at all** — no greyed-out
button, no "you don't have permission" toast on click. Masters §3.0 is explicit about this and it is the
house pattern: *"A Manager or HR user who can add and edit entries will simply not see a Delete or
Deactivate control; only Super Admin sees it."*

### PUT / edit defaults to Super Admin only, and is grantable per screen

Every update endpoint ships **restricted to Super Admin by default**. Super Admin can then grant edit
rights on a specific screen to a specific role through the RBAC matrix (§3) — at runtime, no code change.

**Why default-deny-then-grant rather than a hard rule:** a blanket "no role may ever edit" would contradict
behaviour the specs already define and the client already approved — HR editing employee records (Employee
§2.2), Accountant editing invoices, Manager editing tickets. Shipping edit locked down and letting Super
Admin open it deliberately gives the same control without silently breaking documented role access.

**Seeding, and the one thing not to get wrong:** seed the grants from the prototype's `POLICY` table
(§3.1), so a role the client already approved for editing keeps working on day one. **`full` in POLICY
means create + read + update — it does *not* mean delete.** Delete is carved out entirely by the rule above,
whatever POLICY says.

### Applies to every write path, not just the obvious ones

The rule follows the *effect*, not the HTTP verb. A destructive or corrective action routed through `POST`
— void, reverse, cancel, unlock, reissue, discard, bulk-remove — is still a delete or an edit and is
governed identically. Check every action label, not just the method.

### Non-negotiable regardless of role

- **Every update and every delete is audit-logged** — who, when, old value, new value, and a **reason where
  the action is corrective or destructive**. A Super-Admin-only action with no audit trail is worse than a
  broadly-permitted one with a good trail.
- **Enforced server-side, per request.** Hiding the button is presentation; the endpoint is the control.
- **Locked Financial Year still wins.** A locked year is frozen for everyone *including Super Admin* — the
  one documented exception being the explicit, RBAC-gated Unlock action.
- **Super Admin cannot delete itself out of administrability** — the last Super Admin account, and the RBAC
  screens' own permissions, are protected (§3.2 guardrails).

## 5. Backend work that is genuinely required

The backend is "done" but the frontend was constrained by it. Before building any module's UI, check the
router; where an action the prototype shows has no endpoint, **build the endpoint**.

1. **Add `PUT`/`PATCH` where an Edit action exists in the prototype** — start with `financial_years`,
   `expenses`, `leave_requests`, `announcements`, `adhoc_adjustments`, `employee_documents`, and
   **`attendance` (GET/POST only today — a wrong check-out time drives wrong pay and cannot be corrected;
   see §8.3/§8.4)**.
2. **Add `DELETE`/deactivate** where the prototype offers Remove/Void/Deactivate — `adhoc_adjustments`
   (spec §2.1a requires Remove), `announcements`, `invoices` (void/credit-note path), `assets`,
   `attendance`.

**Every endpoint added under 1 and 2 is subject to §4a**: delete Super-Admin-only and not grantable; update
Super-Admin-only by default and grantable per screen; both audit-logged, with a reason on corrective or
destructive actions.
3. **Add query params for every filter the prototype's screens show**, so filters can be
   `transport: 'server'` and exports stay honest. Enumerate per endpoint; today many would be forced to
   `client`.
4. **Add `?format=` export support** on every list endpoint.
5. **RBAC tables + resolver + admin endpoints** (§3).
6. **A settings/configuration store** for everything §6 makes dynamic.
7. Every mutation writes audit fields (created/modified by + timestamp).

---

## 6. Everything dynamic — nothing hardcoded

**The rule:** if a Super Admin could plausibly want it different next year, in another office, or for
another client, it is configuration. Code contains mechanisms; the database contains decisions.

**Specifically forbidden in code:**

- **Any tax.** No PF field, no ESI field, no GST field, no regime dropdown, no 80C cap, no rebate
  threshold. Masters → Taxes is a dynamic tax-head registry describing *behaviour* (scope, base, method,
  slabs, split components, ceilings/cut-offs/caps, relief rules, schemes, effective dates). Payroll,
  Employee, Invoice, Expense, and Purchase Bill read configured heads and know no tax by name. **Empty
  configuration is a valid state** — invoices carry no tax line, payslips no statutory deductions. Correct,
  not a defect.
- **Any date rule.** The Financial Year end-date derivation (§4.1) is the confirmed offender. Also: pay
  cycle cutoff and credit day, leave year boundaries, probation duration, notice period, ageing buckets,
  due-date terms — all configurable.
- **Any rate, threshold, cap, quota, or limit** — PF-style percentages, wage ceilings, leave quotas,
  carry-forward caps, approval thresholds, page sizes.
- **Any option list** that a user could extend — statuses, categories, sources, types, severities,
  priorities, units, payment modes, document types, relationship types. Every one is a Masters lookup, and
  the 15-lookup factory already exists (`masters_lookup.py`).
- **Any numbering format.** Masters → Number Prefixes owns every auto-generated code, including the
  financial-year insertion. Verify it is genuinely used and not shadowed by a format string in code.
- **Any workflow step, status transition, or approval route** that the spec describes as configurable —
  including the leave approval routing rule and its fallbacks.
- **Any role list.** Roles come from the database (§3).
- **Any email or notification text.** Masters → Email Templates already exists — use it.
- **Any label, currency symbol, locale, or date format** that varies by deployment.
- **Company identity** — name, logo, letterhead, addresses, registration numbers all come from Company
  Profile. The string "Meshrd" must not appear in code.

**When you must pick a default**, seed it as a database row with a comment recording why — never a
constant in a source file.

---

## 7. Build order

Each phase depends on the ones before it. **Do not start Phase 4 before Phases 0–2 are done** — every screen
built after them inherits them, and retrofitting 150 screens is the expensive path.

| Phase | Work | Why here |
|---|---|---|
| **0** | **Shared spine**: Back + breadcrumbs (§2①); the new screen shapes the prototype needs beyond the current 5 — board/kanban, document, payslip, report, matrix, dashboard, calendar, checklist, conversation, wizard; extend `screen.types.ts` **additively** (~50 configs depend on it — new optional properties, not renamed ones) | Everything after inherits it |
| **1** | **Runtime RBAC** (§3): schema, resolver, enforcement, seed from `app-rbac.js`, cache invalidation | Retrofitting authorization onto working endpoints is how permission holes are made |
| **2** | **Dynamic-configuration layer** (§6): settings store, verify Masters actually drives every list | Modules must consume config from day one, not be converted later |
| **3** | **Fix Masters** (§4) + the backend holes behind it (§5) | Proves the pattern on a module that already exists; every later module copies it |
| **4** | **Employee** (2 of 21 screens built) — tabbed master record incl. the generated Statutory Identifiers and Statutory Deductions blocks; My Profile; My Leave; My Payslips; Team Payslips; My Documents + HR verification queue; My Tickets; My Projects & Tasks; My Assets; Dashboard; Announcements; Onboarding + HR cross-employee view; Offboarding + HR cross-employee view; My Tax Declarations (fully generated from Masters → Taxes); Offer & Appointment Letter | The people every module references |
| **5** | **Vendor** (3 screens — add Vendor Usage: filters and export, but deliberately **no totals, no charts**) | Small; feeds Expense + Purchase Bill |
| **6** | **Customer** (5 screens — Customer 360 becomes a **tabbed record with 8 tabs**, each independently filtered and exported) | Feeds Opportunity, Project, Invoice, Ticket |
| **7** | **Leave** (12 screens) | Depends on Employee + Masters; feeds Payroll. Approval routing rule is exact — implement it literally |
| **8** | **Asset Management** (12 screens) | Purchase Value column *and its range filter* both hide from Manager under the existing flag |
| **9** | **Ticket** (6 screens) | Assigned Staff filter appears for Employee only when the full-queue toggle is on |
| **10** | **Opportunity** (5 screens) | Pipeline has two views; **filters apply to both, and the stage summary's counts and ₹ totals must reflect the filtered set** |
| **11** | **Project** (14 screens) | Board filters apply to all columns with per-column counts; a board exports as a flat list, not a board |
| **12** | **Invoice** (6 screens) | Includes the Credit Note list. Ageing buckets. Tax dropdown reads configured Sales-scope heads and hides entirely when none exist |
| **13** | **Expense** (7 screens) | Optional Tax field is a **component of** the amount, not added on top |
| **14** | **Purchase Bill** (3 screens) | Tax Amount directly enterable even with no head configured. Ageing buckets. Withholding scope (A276) |
| **15** | **Payroll** (10 screens) | Depends on Employee + Leave + Taxes. **Knows no specific deduction** — reads heads and applies them. Manager's export mirrors the hidden amount column. **Includes Attendance & Time Basis in full (§8.3) and the biometric switch (§8.4)** — the hour basis drives Run Payroll, so build it with the module, not after |
| **16** | **Tax & Compliance** (9 screens) | Depends on Payroll, Invoice, Purchase Bill, Expense being real |
| **17** | **RBAC admin screens** (5 screens) | The §3 engine's UI, once there is a real permission surface to administer |
| **18** | **Shell, Settings, dashboards** (§8) | Cross-cutting polish once every module exists |

---

## 8. Shell, settings, theming, auth

Reproduce the prototype's shell exactly; it is validated. **Read `prototype/index.html`'s markup — the
entire shell is laid out there literally**, and this list is that markup enumerated.

- **App shell**: left sidebar grouped **Overview / People / Operations / Finance / Administration**, active
  item highlighted, `navHidden` screens keep their parent highlighted. Sidebar **collapse** toggle
  (`#collapseBtn`). Sidebar footer holds **Settings** and **Log out** as fixed items.
- **Topbar, left to right** — every one of these exists in the prototype and must exist in the build:
  - sidebar collapse button
  - **breadcrumb** (`#crumb`)
  - **global search** with a `Ctrl K` shortcut hint — "Search employees, invoices, tickets…"
  - **Financial Year pill** showing the current FY and linking to Masters → Financial Year. Drive it from
    the real current FY row; never a hardcoded string
  - **notifications bell** with an unread count badge, opening a popover with **two tabs** — My
    Notifications / Announcements — a "Mark all as read" action, and a footer link into the full screen
  - **theme toggle** (light/dark)
  - **role switcher** ("Viewing as …") — see the impersonation note below
  - **avatar → profile menu**
- **Popovers/overlays**: notification popover, role menu, user menu, a `scrim` behind them, and a
  **toast stack** (`#toasts`).
- **Role switcher** — the prototype's header dropdown that redraws nav and widgets live. Keep it as a
  **demo/impersonation** feature, and make it Super-Admin-only with an audit-logged impersonation banner —
  it must not become a privilege-escalation route in production.
- **Auth**: login, logout, forgot-password, forbidden page. Real authentication; session revocable.
  The prototype's login is a **two-panel screen** — a brand/pitch panel listing the modules, and a sign-in
  card with email, password, a "Sign in as" role select, and **five one-click role chips**. Keep the layout;
  replace the fake auth with real credentials, and drop the role chips (or keep them only in a non-production
  build) since they exist purely to demo RBAC.
- **Settings screen** (Super Admin), **four tabs as built**: **Appearance** · **Regional & Financial** ·
  **System** · **About**. Regional & Financial is explicitly "drawn from Masters where a master already owns
  the value" — honour that: Settings surfaces configuration, it does not become a second place to define it
  (§6).
- **Theme**: light and dark, switching the entire app instantly and persisting per user. Design tokens live
  in `prototype/app.css` — port them as the design system: IBM Plex Sans + IBM Plex Mono (tabular numerals
  on every figure), graphite/ink sidebar, cobalt `#2a4bd7` accent, hairline rules.
- **Dashboards**: the prototype has role-specific dashboards — build each role's, driven by that role's
  real scope.
- **States**: loading, empty, and error on every async surface. Toasts for confirmations. The prototype's
  47-icon set is already ported (`ui/icon.component.ts`).
- **Read-only legibility**: when a role's grant is `view`, the screen says so rather than silently lacking
  buttons — the prototype renders a "Read-only" badge. Keep it.
- **Hidden-field treatment**: where a field is hidden by Layer 3, the prototype renders a **dashed "hidden"
  pill** in place of the value (Manager's Team Payslips show this instead of Net Pay) rather than a blank
  cell. Keep that — a blank reads as missing data, a pill reads as "you don't have access", and the two
  must not look alike. Pair it with `lockReason` (§3.1) so the user can see *why*.
- **Scope chip**: the filter bar shows the active data scope — "Own records" / "My team (5)" /
  "Company-wide". Keep it; it is what makes Layer 4 legible.

### 8.1 Per-role acceptance targets

`index.html` documents how many screens each role could reach in the validated prototype. Use these as
**verification targets** when walking the built app — a large deviation means a policy was transcribed
wrong. (They are prototype-era counts against its own registry, so treat them as close approximations, not
exact assertions.)

| Role | Demo user | Screens | Scope |
|---|---|---|---|
| Super Admin | Ravi Shankar | ~97 | unscoped, everything |
| Manager | Vikram Iyer | ~50 | team — own + direct reports |
| Accountant | Nisha Kulkarni | ~47 | company-wide, finance |
| HR | Fatima Sheikh | ~43 | company-wide, people |
| Employee | Arun Menon | ~22 | own records only |

### 8.2 Prototype limitations that must NOT be carried over

These are deliberate shortcuts of a mock, documented in `index.html`'s own assumptions. Each one is a real
feature in the product:

| Prototype behaviour | What the build must do |
|---|---|
| **A6** — Save/Approve/Reject/Send/Export/Run Payroll show a toast describing what *would* happen | Actually do it. **Treat every `data-toast` string in the prototype as a specification sentence** — it states the intended behaviour precisely |
| **A7** — a row click opens one representative record per module, not that row's record | Every row opens its own record, by id |
| **A5** — theme held in memory only, resets on reload (the prototype brief forbade storage) | Persist theme per user, server-side |
| **A14** — drag-and-drop not wired on the Task Board or the Opportunity pipeline | Implement drag-and-drop; keep the Status dropdown as the equivalent path |
| **A4** — any email/password logs in; header switcher changes role without re-login | Real authentication. The role switcher becomes Super-Admin-only audited impersonation |
| **A9/A10** — mock data ("Meshrd", 148 employees, FY 2026–27, generic tax heads) | Real data. Company identity from Company Profile; **no tax names anywhere** (§6) |

**A13 is REVERSED — build Attendance & Time Basis in full. See §8.3.** The prototype's assumption A13 calls
it "planned, not built"; that assumption is stale, the spec has already moved past it, and the client has
now instructed that it ships complete. Only the *biometric feed* is deferred, and it is deferred behind a
switch rather than left unbuilt — §8.3.

Note this is different again from the `coming-soon` *routing fallback* in §1.3, which must disappear
entirely. Three similar-looking things, three different fates: the routing fallback is deleted, A13 is
built, the biometric feed is built-but-switched-off.

### 8.3 Attendance & Time Basis — build complete (scope change)

**Status: full feature, this build.** The prototype's own header comment and the screen's `§2.5` reference
are both **stale**. The authority is **`06-payroll-module.md` §2.4**, which states plainly: *"This screen is
live and it drives payroll. The only part still to come is the biometric feed."* The spec even records that
an earlier revision marking the whole hour basis as "Planned" was **wrong** and was corrected. Do not build
a placeholder.

**Hours are the unit of account, not days.** A day is a display convenience; every figure that decides pay
is an hour figure.

**The calculation** — nothing in it is a constant:

| Quantity | Derivation |
|---|---|
| **Required Hours** | Net Working Hours per Day × working days in the period, from the employee's **Work Week & Hours policy** (Masters §3.20). Working days = calendar weekdays − Mandatory holidays + whichever Saturdays that policy's Saturday rule makes working |
| **Worked Hours** | (Check-Out − Check-In) − the unpaid break, summed. Break length comes from the policy, never a constant |
| **Leave Credit** | approved leave days × Net Working Hours per Day |
| **Compensatory Credit** | approved compensatory hours — **an "of which" subset of Worked, never added to it.** Counting the same hours twice silently overpays. Label the column *of which Comp* |
| **Credited / Balance** | Credited = Worked + Leave Credit. Balance = Credited − Required. Negative = shortfall |

**Shortfall handling:** offset first by **approved** compensatory hours; whatever survives converts using the
policy's **Uncompensated Shortfall Becomes** setting. A **pending** compensatory request **suspends** the
deduction — it does not cancel it. Approve it and the shortfall clears; reject it or let the window close
and the full amount converts at the next run. A partial make-up clears only its own hours and the screen
states the remainder explicitly. **Nothing is deducted silently** — the employee sees it on Leave →
Compensatory Hours before it reaches a payslip.

**Five tabs — all five already have backing endpoints** in `backend/app/api/v1/attendance_reconciliation.py`
(`/monthly-summary`, `/day-wise-log`, `/payroll-impact`, `/compensation`, `/biometric-feed`):

1. **Monthly Summary** — per employee: Req. Hours, Worked, of which Comp, Leave Cr., Credited, Balance,
   Payable Days, LOP Days, Status (Met / *Short — compensable* / *Short — payroll impact*). Rows open that
   person's day-wise log.
2. **Day-wise Log** — **every calendar day listed, recorded or not**: Date, Day, Day Type, In, Out, Break,
   Required, Worked, Comp, Balance, Status, Note. Day Type resolves from the policy, so Sundays, non-working
   Saturdays and Mandatory holidays sit at zero required and cost nothing.
3. **Payroll Impact** — the only tab that moves money and the handoff to Run Payroll: Hours Short, Comp
   Pending, Net Short, LOP Days (net of pending), Est. Deduction, and a plainly-worded next step per person.
   **Priced with the same conversion Run Payroll uses** — one shared reconciliation service, never a second
   implementation that can drift.
4. **Compensation** — the period's compensatory requests, linking to the live queue in Leave §2.6.
5. **Biometric Feed** — see below.

**A header strip above the tabs shows the period's arithmetic**, so it is never a black box — e.g.
*"22 weekdays + 2 working Saturdays (1st, 3rd) = 24 working days × 8.00 net hours = 192 required hours"* —
alongside the policy name and the Saturday rule in force.

**Processed periods read back locked figures.** On Confirm & Generate Payslips, Run Payroll materializes the
reconciliation it consumed into a locked per-employee row. Monthly Summary and Payroll Impact then read that
row back verbatim instead of recomputing — so a Work Week Policy edited later can never make this screen
disagree with the payslip it explains. The Day-wise Log needs no lock: each record snapshots its own day type
and required hours at entry time.

**Filters:** Month, Employee, Department, **Hour Status**, **Work Week Policy** — the last matters because
with several policies in play "who is short" is meaningless without knowing which target they were measured
against. The Compensation tab adds request Status. **Hour Status and Work Week Policy are not yet query
params on the backend — add them** (§5, item 3), rather than shipping them as `client` transport and breaking
export honesty. Export follows the filter; every tab takes `format=pdf|excel` on the same filtered query.

**Role access (spec §2.4, not the generic default):** **Super Admin** full, plus Record Attendance ·
**HR** view, company-wide — they answer the shortfall questions · **Manager** view, **Team scope only** ·
**Accountant** *no access* — they see the consequence on the Payroll Register, not the raw hours ·
**Employee** *no access* to the cross-employee view; their own hours reach them via their payslip and their
own compensatory requests.

### 8.4 Biometric — build the integration point, ship it switched off

**New scope, per client instruction, and now written into the specs** (Masters §3.6a and Payroll §2.4).

**Masters → Company Profile → General Info gains two fields:**

| Field | Type | Required | Behaviour |
|---|---|---|---|
| **Biometric Attendance** | Toggle On/Off | Y | **Defaults to Off** |
| **Biometric Device Endpoint / Reference** | Text | Conditional — required when the toggle is On | Where the feed comes from, recorded so an attendance record's source is auditable |

**Off** (the shipping default) — manual entry is the only accepted input; the Biometric Feed tab presents the
integration as available-but-inactive rather than implying a device is connected; **any inbound device
payload is rejected, not silently stored.**
**On** — feed input is accepted and written to **the same fields manual entry writes to.**

**Four rules that make this a real switch rather than a stub:**

1. **It is an input-source switch, not a calculation setting.** Flipping it never alters attendance already
   recorded and never changes how hours are computed. The hour basis ships and runs on manual entry today;
   hardware arrives later as a **configuration change, not a code change.**
2. **Every attendance record stores which source wrote it** — manual / device / external system / mobile —
   so a disputed hour figure is always traceable to its origin.
3. **Manual entry stays available whatever the switch says.** A device outage must never stop payroll.
4. **Build the ingestion endpoint now**, gated on the toggle. Deferring the *hardware* is not a reason to
   defer the *seam* — an integration point retrofitted later is where the "device writes a different shape
   than manual entry" bug is born.

The Employee record's Record Attendance form currently shows Biometric as a disabled "Coming Soon" option;
it becomes enabled/disabled by this toggle instead.

**Backend gap to close first:** `attendance.py` has **GET and POST only — no PUT, no DELETE.** A mistyped
check-out time can therefore never be corrected, which is not acceptable for a figure that drives pay. Add
update and delete/void — **both governed by §4a**: delete is Super-Admin-only and not grantable; update is
Super-Admin-only by default and grantable to HR per screen if the client wants it; **both require a reason**,
since an edited attendance record silently changes someone's pay.

---

## 9. Definition of done, per module

- [ ] Every prototype screen for the module exists, is **registered in `nav-registry.ts`'s route map**, and
      no longer falls through to `coming-soon`
- [ ] Every field in the prototype's form definition is a **rendered field**
- [ ] Every page action and row action from the prototype exists and works — **Edit especially**
- [ ] Back + breadcrumbs on every screen below the module root
- [ ] Filters on every list, for every role, plus the baseline set
- [ ] Export PDF + Excel on every list, for every role, following the filter, with the header block
- [ ] Every screen, action, **field/column**, and scope registered in the RBAC tables and editable by Super
      Admin at runtime — verified by actually toggling one in the admin UI and seeing it take effect
- [ ] Field-level rules enforced **server-side** — a hidden field is absent from the API response for that
      role, not merely hidden in the DOM; a hidden column takes its filter and its export column with it
- [ ] Nothing hardcoded that §6 forbids
- [ ] Sub-resources are **tabs with count badges** on a `.rec-head` record screen — never nav buttons
- [ ] **UI fidelity (§2⑤) verified screen-by-screen against the prototype** — same tab set, same tab order,
      same counts, same button placement (page actions right, tab actions inside the tab below its content),
      same body shape per tab (table vs timeline vs section), same header-vs-body split for headline figures.
      Open the prototype screen and the built screen side by side; do not verify from memory
- [ ] Confirm dialogs on destructive actions, stating the specific consequence, using the spec's wording
- [ ] **§4a enforced**: no role but Super Admin can delete/void/deactivate anything (and non-Super-Admins do
      not see the control at all); update is Super-Admin-only unless explicitly granted per screen; both are
      audit-logged with a reason on corrective or destructive actions — **verified by attempting a delete as
      each of the other four roles and getting a server-side rejection**, not merely a hidden button
- [ ] Every button works or is disabled with a visible reason — **a control that does nothing is a bug**
- [ ] Server-side validation mirrors client-side; the API is the authority
- [ ] Backend tests cover the module's endpoints **including permission denials**
- [ ] Walked as all 5 roles with every control clicked

**Report per module:** screens built vs the prototype's list · spec fields traced to rendered fields, with
counts · gaps found between prototype and build · endpoints you had to add · anything deliberately not done
and why · anything you could not verify.

Do not report a module complete because it compiles. Report it complete when you have walked it.

---

## 10. Source-of-truth hierarchy

| Rank | Source | Authoritative for |
|---|---|---|
| 1 | `NN-*-module.md` (15 files) | **Behaviour** — workflows, rules, role rules, field semantics |
| 2 | `prototype/` | **Everything visible** — screens, fields, actions, filters, columns, copy, layout, design tokens, and the RBAC matrix |
| 3 | `build-docs/APPENDIX-A-approved-decisions.md` (A001–A285) | Client-approved decisions, including **negative** ones (things to deliberately not build) |
| 4 | `build-docs/APPENDIX-B-business-rules.md` | Formulas, cutoffs, sequencing locks, status transitions |
| 5 | `build-docs/ARCH-1/2/3` + `BUILD-PROMPT.md` | Schema, stack, conventions |
| 6 | The current `frontend/` code | **Lowest.** It has demonstrably dropped prototype features (§4). Never treat it as the reference |

Surface conflicts rather than silently resolving them. The `.md` files are the living source of truth — if
the build reveals a spec gap, implement the smallest correct thing and write it into the doc, then flag it.
**Never write a tax name into a spec doc.**
