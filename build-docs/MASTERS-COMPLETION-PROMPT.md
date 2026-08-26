# Masters Module — Completion Prompt

**Every gap below was found by reading the actual source on both sides — prototype vs built — not assumed.
File paths and line numbers are exact as of 2026-08-06.**

**Revision note:** the first pass of this document checked only the 4 tabbed/record-shape screens and left
the other 17 as "lower risk, not exhaustively checked." That was a mistake — it should have meant "not yet
checked," not "probably fine." This revision goes through every `navHidden` action screen under Masters (25
total, the full set of "+ Button"-reached forms) against the built app. Two more confirmed gaps came out of
that pass (§2 and §3 below). Two items from the first pass have also since been fixed upstream and are
corrected here rather than left stale — see the note at the end of each.

**Fix in this order: §1 → §2 → §3 → §4 (Work Week & Hours) → §5 (Company Profile) → §6 (Tax Schemes) → §7
(data wipe/seed).**

---

## 1. Duplicate Export PDF / Export Excel — one bug, fixes every screen at once

**`frontend/src/app/shared/screens/list-screen/list-screen.component.ts` renders export buttons TWICE on
every single list screen in the whole app**, including every embedded tab (so every tabbed Masters screen
shows it twice per tab):

- **Lines 56–62** — inside `page-actions`, next to the create button: **"Export PDF" / "Export Excel"**
  (full-width buttons, icon size 14). This block renders even when `embedded()` is true — only the title
  above it is gated by `@if (!embedded())`, the action buttons are not.
- **Lines 160–171** — inside the filter row, right-aligned: **"PDF" / "Excel"** (compact buttons, icon size
  13), with the developer's own comment: *"The prototype puts a second, compact export pair inside the
  filter bar... 'Export follows the filter' said in the layout."*

**The prototype has exactly ONE export pair, and it lives in the filter bar** (`U.filterbar` in
`prototype/app-core.js`) — never in the page header. Whoever added the filter-bar pair to match the
prototype correctly identified where it belongs, but never removed the original page-head pair, so both
now render together on every screen.

**Fix:** delete the two buttons at lines 56–62 (`page-actions`). Keep only the filter-row pair. This is a
single change to one shared component — it fixes every list screen and every tabbed screen's embedded tabs
in the entire application, not just Masters.

---

## 2. Holidays — Bulk Import is completely missing from the frontend

**Confirmed by reading `data.js:1612`**: the prototype has a real, full screen for this —
`masters.holidays.import`, "Bulk Import Holidays" — reached from a page action on the Holidays calendar,
Super Admin only. Its form (`app-forms.js:47-54`) is fully specified: Financial Year, Holiday Type (with a
"Mixed — use Type column in file" option), a file upload (.xlsx/.xls/.csv, max 500 rows), and a Skip
Duplicates toggle defaulting on.

**The frontend never built it — and this is not a backend gap.** `holidays.calendar.config.ts` has its own
comment acknowledging exactly this:

> *"'Bulk Import' is deliberately NOT declared as a secondaryAction here... the backend
> (`masters_simple.py:104-136`) takes a parsed `_HolidayImportRow[]` body — and 'import' is already a
> registered, grantable RBAC action for this screen — leaving Bulk Import absent until that screen is
> actually built."*

So: **the backend endpoint exists, RBAC already has the `import` action registered and gated correctly, and
the frontend simply never built the upload screen.** This is the same shape of gap as Tax Schemes (§6) —
everything below the UI is ready, only the screen itself is missing.

**Fix:** build the Bulk Import screen — file upload + Financial Year + Holiday Type + Skip Duplicates
toggle, exactly as the prototype's form specifies — posting to the existing `masters_simple.py` endpoint,
and wire "Bulk Import" as a page action on the Holidays calendar screen, Super Admin only, alongside the
existing "+ Add Holiday."

---

## 3. Email Configuration — header is missing 3 of its summary tiles (minor, but shares a root cause with §4)

Prototype's Email Configuration header shows: **Templates** (count), **Enabled** (count), and **Last Test**
(result of the most recent test send). Built (`email-configuration.tabbed.config.ts`) shows none of these —
confirmed by the config's own comment, which traces the exact cause:

> *"tabbed-screen.component.ts's `summaryTiles()` calls `header.summary(headerRow())` with only the
> `headerEndpoint` response... the header only ever gets fed the single `headerEndpoint` row, so this needs
> `tabbed-screen.component.ts` extended to pass already-loaded tab data through to `summary` too... **Same
> class of gap as `work-week.tabbed.config.ts`'s `meta`** (its FY tile is dropped for the identical reason)."*

**This is the same shared-component limitation as §4's tab-embedding gap, one level up: `TabbedScreenComponent` can only feed a header from one endpoint, but a real header often needs data
already being fetched for a different tab** (Templates' own row-count badge, the Recent Sends log). Fixing
this once — letting `summaryTiles()` read from already-loaded tab data, not just `headerEndpoint` — fixes
both Email Configuration's header and Work Week & Hours' missing FY tile in the same change.

**Fix:** extend `TabbedScreenComponent` so a header's `summary()` can read from already-fetched tab data
(Templates count/enabled, Recent Sends' latest row), not only the single `headerEndpoint` response. Lower
priority than §1–§2 and §4–§6 — this is a missing header stat, not a missing feature.

---

## 3a. THE BIGGEST GAP — `Code` and `Used` columns stripped from almost every lookup screen

**This is systemic, affects 10+ screens, and needs a backend migration — treat it as the largest item in
this document.**

**The prototype's shape for every simple lookup is: `Name | Code | Status | Used`** (plus per-screen extras).
Verified across all of them in `data.js`. The `Used` column is not decoration — it's what makes
"which of these can I safely deactivate?" answerable without opening every record, and Masters §3.0 names a
**Used / Unused filter** as a required, module-specific filter for exactly this reason.

**What the built app actually has** — verified column-by-column against every `.list.config.ts`:

| Screen | Prototype columns | Built columns | Missing |
|---|---|---|---|
| **Payment Mode** | Name · **Code** · Status · **Used** | Name · Requires Reference · Status | **Code, Used** |
| **Department** | Name · Code · Head · Status · **Used** | Name · Code · Description · Status | **Used**, Department Head |
| **Designation** | Name · **Code** · Status · **Used** | Name · Linked Dept · Level/Grade · Status | **Code, Used** |
| **Service Category** | Name · **Code** · Status · **Used** | Name · Description · Status | **Code, Used** |
| **Unit of Measure** | Name · **Code** · Status · **Used** | Name · Status | **Code, Used** |
| **Ticket Categories** | Name · **Code** · Status · **Used** | Name · Description · Status | **Code, Used** |
| **Customer Status** | Name · **Code** · Status · **Used** | Name · Status | **Code, Used** |
| **Customer Source** | Name · **Code** · Status · **Used** | Name · Status | **Code, Used** |
| **Asset Categories** | Name · **Code** · **Useful Life (yrs)** · Status · **Used** | Name · Description · Status | **Code, Used, Default Useful Life** |
| **Employment Type** | Name · **Code** · Status · Used | Used · Name · Status | **Code** |
| **HSN / SAC** | Code · Desc · Linked Tax · Status · **Used** | Code · Type · Desc · Linked Tax · Custom Rate · Status | **Used** |

**Done correctly already — do not touch:** Expense Types (`short_code`, `usage_count` both present), Leave
Types (`short_code` present), Insurance Plans, Bank Accounts (`is_referenced` present). These prove the
pattern is achievable and that the others are omissions, not a deliberate design choice.

**Why this needs backend work, not just config edits** — confirmed by reading
`backend/app/models/masters.py`:

- **`code` does not exist as a column** on `payment_modes`, `designations`, `service_categories`,
  `units_of_measure`, `ticket_categories`, `customer_statuses`, `customer_sources`, `asset_categories`, or
  `employment_types`. Only `departments` has it. **A migration is required** to add `code` to the other
  nine.
- **`Used` / usage-count is not exposed** on any of them. `ExpenseType` proves the pattern exists
  (`usage_count`) and `BankAccount` proves another (`is_referenced`) — replicate one of those consistently.
- **`Default Useful Life (yrs)` is missing from `asset_categories` entirely** — and the prototype's own form
  hint says it "feeds the Straight Line depreciation calculation," so this isn't cosmetic: Asset
  Management's depreciation has no per-category default to read.

**Fix:**
1. Migration adding `code` (nullable string, unique per table) to the nine tables lacking it, and
   `default_useful_life_years` to `asset_categories`.
2. Expose a usage count (or `is_referenced` boolean) on every lookup endpoint, matching whichever pattern
   `ExpenseType`/`BankAccount` already established — pick one and use it everywhere, don't ship both.
3. Add `Code` and `Used` columns to all 10 list configs, and the **Used / Unused filter** Masters §3.0
   requires.
4. Add `Code` to the corresponding add/edit forms — it's currently unenterable because the column doesn't
   exist.
5. Add `Default Useful Life (yrs)` to the Asset Categories list and form.

---

## 3b. `Status` field missing from EVERY add/edit form — all 18 of them

**Complete diff done: all 27 prototype form definitions in `app-forms.js` vs all 25 built
`.form.config.ts` / `.singleton.config.ts` files. This is the result, not a sample.**

The prototype puts an explicit **Status toggle, defaulting to Active**, as the last field on every lookup's
add/edit form. **Not one built form has it.** Confirmed on all 18:

`expense-types` · `leave-types` · `holidays` · `work-week-policies` · `bank-accounts` · `payment-modes` ·
`departments` · `designations` · `hsn-sac-codes` · `service-categories` · `units-of-measure` ·
`ticket-categories` · `customer-statuses` · `customer-sources` · `asset-categories` · `employment-types` ·
`insurance-plans` · `taxes`

**A row-level Deactivate action is not a substitute.** The prototype has both, and they do different jobs:
the row action retires an existing record; the form field is how you create something already inactive
(staging next year's config before it goes live) — which is currently impossible anywhere in Masters.

**Fix:** add the Status toggle, defaulting to Active, as the last field on all 18 forms.

---

## 3c. Every other missing form field — the complete list

Same diff, everything that isn't Status. **This is exhaustive for form fields — nothing below is a sample.**

| Form | Missing field(s) | Why it matters |
|---|---|---|
| **Asset Categories** | **`Default Useful Life (Years)`** | The prototype's own hint: *"feeds the Straight Line depreciation calculation."* Asset Management's depreciation has no per-category default to read — this is a functional break, not a cosmetic one |
| **Bank Accounts** | **`Is Default`** toggle · **`UPI QR Code`** (file upload) | `is_default` already exists as a **list column** in the built app, so the flag is displayed but can never be set. The list shows a Default column that nothing can populate |
| **Company Profile** | **`Display Name`** · **`Logo`** (upload) · **`Letterhead Template`** (upload) · **`Registered Address`** (derived read-only, mirrors whichever address is Primary) | Logo and Letterhead are the **Documents tab** content — see §5; they're the same gap seen from the field side. Every generated PDF depends on them |
| **Payment Mode** | *(only Status, §3b)* | — |
| **Units of Measure, Customer Status, Customer Source, Employment Type** | *(only Status, §3b)* | These are genuinely one-field forms in the prototype too |

**Deliberate build additions — correct, keep them, do NOT "fix" back to the prototype:** Leave Types'
`Is Quota Tracked` · Saturday Overrides' `Financial Year`, `Work Week Policy`, `Which Saturday of the month`
· Pay Cycles' `Effective From` · Taxes' `Short Code` and `Slab Application` · HSN's `Use a one-off custom
rate` toggle · Number Prefix Rules' `Label`, `Code Format`, `First Code Generated` · Email Templates'
`Template Key`, `Template Name`, `Triggered From Screen` · Company Profile's `Payroll Basis`. Each is an
improvement on the prototype, not a deviation to reverse.

**Verified as fully correct — no action needed:** `work-week-policies` (all 25 fields present including the
derived `Net Working Hours per Day`), `pay-cycles` (both live preview lines present), `saturday-overrides`
(the prototype's "Pattern Says" is present as "That date falls on a"), `hsn-sac-codes` (all custom-GST
fields present), `insurance-plans`, `expense-types`, `leave-types`, `departments`, `designations`,
`email-templates`, `email-server-settings`, `number-prefix-rules`, `financial-years`, `taxes` — each
matches or exceeds the prototype apart from the Status field in §3b.

---

## 4. Work Week & Hours — 3 of 6 tabs missing

Prototype (`app-screens2.js:450-599`, `RECORDS.workweek.tabs`) has six tabs, in this order: **Work Week
Policies · Daily Hours · Saturday Calendar · Compensation · Pay Cycle · Where Used**.

Built (`work-week.tabbed.config.ts`) has three: **Policies · Saturday Overrides · Pay Cycle**.

**Missing: Daily Hours, Compensation, Where Used.**

**Root cause, already self-documented in the built config's own comment block**: `TabbedScreenComponent`'s
tab-embedding switch (`tabbed-screen.component.ts:96-111`) only implements `@case ('list')` and
`@case ('singleton')`. Every other shape falls into `@default`: *"This tab's shape can't be embedded yet."*
None of the three missing tabs is a filterable list or a singleton form:

- **Daily Hours** and **Compensation** are read-only field displays of a single policy's own fields.
  **The data already exists on the wire** — `WorkWeekPolicyRow` (`masters.api.ts:219-251`) already carries
  every field both tabs would show: `grace_window_minutes`, `half_day_threshold_hours`,
  `allow_compensatory_hours`, `compensation_window_days`, `make_up_day_chosen_by`,
  `allow_makeup_on_week_off`, `allow_makeup_on_mandatory_holiday`, `max_comp_hours_per_month`,
  `uncompensated_shortfall_becomes`, `excess_hours_become`. This is a **display gap, not a backend gap** —
  the Policies tab already fetches this exact row.
- **Where Used** needs no data at all — it's eight fully static rows naming which module/screen reads the
  policy (`app-screens2.js:581-598`). Zero backend work.

**Fix:**
1. Add a new embeddable **read-only field-grid tab shape** to `TabbedScreenComponent`'s switch (the same
   shape a record screen's own field sections already render — reuse that rendering, don't reinvent it).
   Use it for Daily Hours and Compensation, reading fields already present on `WorkWeekPolicyRow`.
2. Add a new embeddable **static-content tab shape** (or reuse the field-grid shape with hardcoded rows) for
   Where Used — content only, no endpoint.
3. Hour-Bands sub-table on Daily Hours (`app-screens2.js:482-491`) needs real band-boundary logic that
   `01-masters-module.md:1247` explicitly defers to Payroll — build the display now with real policy fields,
   flag the Hour-Bands sub-table as pending Payroll's own arithmetic if that logic doesn't exist yet.

---

## 5. Company Profile — Documents tab missing

Prototype (`app-screens2.js:672-787`) has five tabs: **General Info · Addresses · Bank Details ·
Documents · Number Prefixes**.

Built (`company-profile.tabbed.config.ts:68-71`) has four: **General Info · Addresses · Bank Details ·
Number Prefixes.**

**Missing: Documents** — company letterhead template and logo upload (§3.6d), used when generating offer
letters, appointment letters, invoices, and every other official document. This is not a minor tab: every
generated PDF in the system (invoice, payslip, offer letter) depends on the letterhead this tab uploads.

**Fix:** add the Documents tab. It is a simple field/upload form (`singleton` shape already supports file
fields elsewhere in this codebase — check `company-profile.singleton.config.ts`'s existing field handling
before building a new upload mechanism).

---

## 6. Taxes — Tax Schemes cannot be created anywhere in the system

Prototype (`app-screens2.js:606-656`) has five tabs: **Billing Taxes · Purchase Taxes · Payroll Taxes ·
Tax Schemes · Where Used.**

Built (`taxes.tabbed.config.ts:163-167`) has five tabs too, but **substitutes Withholding for Tax
Schemes**: **Billing · Purchase · Payroll · Withholding · Where Used.**

**The Withholding tab is very likely a correct, deliberate addition** — withholding tax on vendor payments
(A276 in `APPENDIX-A-approved-decisions.md`) was confirmed in scope after the prototype was built, and
`Applies To` genuinely includes a Withholding scope in the spec (§3.2). Not a regression.

**But dropping Tax Schemes is a real, confirmed, self-documented gap** — the built config's own comment
(`taxes.tabbed.config.ts:115-134`) states it plainly:

> *"QUEUED / NOT BUILT — the prototype's 4th tab, 'Tax Schemes', has no [route]... `TaxScheme` IS a real
> table (`backend/app/models/masters.py:21`) and `tax_heads.tax_scheme_id` is a real FK to it... but exposes
> NO route under it at all: no GET to list schemes, no POST to create one."*

**Verified independently**: `backend/app/api/v1/masters_taxes.py` has GET/POST/PUT/deactivate/duplicate/
DELETE/calculate on **tax heads** — and nothing at all on schemes.

**This blocks a real downstream feature.** Per Masters §3.2d: *"if no schemes are created, the whole concept
disappears from the interface"* — the Tax Scheme field on a tax head hides, and the employee's declaration
screen shows no scheme choice. Right now that's not a deliberate empty state, it's a permanent one — nobody
can ever create a scheme to make the concept appear, because the CRUD surface doesn't exist.

### 6a. Add Tax Head — rebuild it to the prototype's structure. This is the biggest single-screen difference in Masters.

**Client instruction: the Add Tax Head form must have the prototype's fields and the prototype's structure —
nothing else.** The built form is not "slightly different," it is a different shape of screen.

**Root cause: the build crammed four separate prototype screens into one giant form.** In the prototype,
a Tax Head's child rows each have their **own `navHidden` form screen**, reached from a button:

| Prototype screen id | Label | Fields |
|---|---|---|
| `masters.taxes.add` | Add Tax Head | the 23 fields below |
| `masters.taxes.slab` | **Tax Head — Slab Bands** | Band From (₹) · Band To (₹) · Rate (%) or Amount (₹) · Band Label |
| `masters.taxes.split` | **Tax Head — Split Components** | Component Name · Share of Total (%) · Applies When · Condition |
| `masters.taxes.relief` | **Tax Head — Relief Rules** | Relief Name · Applies If Base Is At Or Below (₹) · Relief Type · Relief Amount (₹) · Status |
| `masters.taxes.scheme` | **Add Tax Scheme** | see 6b below |

The built `taxes.form.config.ts` instead carries **28 fields plus three inline nested-table editors**
(`slab_bands`, `split_components`, `applies_when`, `relief_rules`) all on one page. **That is why it looks
so different** — the prototype's Add Tax Head is a clean 23-field form in 3 sections; the build's is a
single sprawling page with three embedded editable sub-tables.

**Fix — the prototype's exact structure, 3 sections, 23 fields, in this order:**

**Section 1 — "Tax Details"**
`Tax Name`* · `Tax Type`* (select: GST — IGST · GST — CGST + SGST · Percentage · Fixed Amount · Slab ·
Declaration Cap) · `Scope`* (select, the 8 scopes) · `Applies From`* · `Applies Until`

**Section 2 — "Rate — shown based on Tax Type"** *(the whole section is conditional on Tax Type)*
`Rate (%)` · `CGST Rate (%)` · `SGST Rate (%)` · `Fixed Amount (₹)` · `Declaration Cap (₹)`

**Section 3 — "Extra"**
`Print Label` · `Creates an Onward Liability` (toggle — **reveals everything below it**) ·
`Remitted To (Authority)` · `Remittance Period` (select) · `Period Aligns To` (select) ·
`Deposit Due — Days After Period End` · `Liability Arises On` (select) · `Authority Reference Label` ·
`Withholding Direction` (**checkgroup**, withholding scope only, at least one required) ·
`Default Calculated On` (select) · `Certificate Expected from Counterparty` (toggle) · `Notes` (textarea) ·
`Status`* (toggle, defaults Active)

**Move the three child editors OUT into their own screens**, matching `masters.taxes.slab` /
`.split` / `.relief` — reached from buttons on the Tax Head record, exactly as the prototype does it.

**Two build-only fields — DECIDED: keep both. Client confirmed 2026-08-06.**

- **`short_code`** — keep. It backs a **Taxes list column** and a **PDF/Excel export column**
  (`masters_taxes.py:74`); removing the field would blank a column that already ships.
- **`slab_application`** (Progressive / Flat by Band) — keep. It is a real **arithmetic field**
  (`masters_taxes.py:107`), and Masters §3.2 requires the progressive-vs-flat-by-band choice, calling them
  materially different calculations. Removing it makes slab tax mathematically ambiguous.

Both are deliberate improvements on the prototype — **do not remove them in a later "match the prototype"
pass.** Place them where the build already has them: `short_code` after `Tax Name` in Section 1,
`slab_application` after `Declaration Cap` in Section 2.

**So the target is the prototype's 23 fields + these 2 = 25 fields, in 3 sections, with the three child
editors moved out to their own screens.** Everything else on the built form already matches the prototype
and stays as-is.

---

### 6b. Tax Schemes is its OWN SEPARATE tab and its OWN SEPARATE form — build it exactly as the prototype has it

**To be unambiguous, because this is the part to get right:** Tax Schemes is **not** a variant of
Withholding, not a section inside another tab, and not a field on the Tax Head form. In the prototype it
exists in **two distinct places**, and both must be built:

**(a) Its own tab in the Taxes record** — `app-screens2.js:650-654`, tab key `schemes`, label
**"Tax Schemes"**, with a live count badge. Its body is a table with exactly these five columns:

| Column | Type |
|---|---|
| Scheme | text, `cell-strong` |
| Is Default | status badge |
| Description | text |
| Choice Window | text |
| Declaration Heads | number, right-aligned |

…followed by a primary **"+ Add Tax Scheme"** button below the table (disabled, not hidden, when the role
can't manage — `canManage` in the prototype).

**(b) Its own separate form screen** — `data.js:1636`, screen id `masters.taxes.scheme`, label
**"Add Tax Scheme"**, `navHidden` (reached from that button, not the sidebar), Super Admin **and**
Accountant. Fields, from `app-forms.js`'s `'m.tax.scheme'`: **Scheme Name · Description · Is Default ·
Choice Window · Status.**

**The result is SIX tabs on Taxes**, not five: Billing · Purchase · Payroll · **Withholding** ·
**Tax Schemes** · Where Used. Withholding stays (A276, approved after the prototype froze). Tax Schemes is
added alongside it. Neither replaces the other.

**Fix:**
1. Backend: add `GET /masters/tax-schemes` and `POST /masters/tax-schemes`, plus `PUT` and deactivate to
   match the pattern every other sub-master follows — covering `scheme_name`, `description`, `is_default`,
   `choice_window`, `is_active`, the exact fields `'m.tax.scheme'` already defines. Enforce **exactly one
   default scheme at a time** (setting a new default clears the previous), since Masters §3.2d treats
   Is Default as the scheme an employee falls back to when they never choose.
2. Frontend — **the tab**: add `{ key: 'schemes', label: 'Tax Schemes', config: schemes }` to
   `taxes.tabbed.config.ts` as a **sixth** tab, positioned between Withholding and Where Used (the
   prototype's own order puts Schemes immediately before Where Used). Its config is a normal list shape —
   five columns as tabulated above, live count badge, `+ Add Tax Scheme` as its create action.
3. Frontend — **the separate form**: a new `tax-schemes.form.config.ts` plus its own route, reachable from
   the tab's create button. Super Admin and Accountant, per the prototype's `roles`.
4. Wire `tax_scheme_id` on the Tax Head form to populate from the new endpoint instead of being an FK with
   nothing behind it.
5. **Honour §3.2d's disappearing-concept rule once schemes are real**: with zero active schemes, the Tax
   Scheme field on a Tax Head hides entirely, and the employee's tax-declaration screen shows no scheme
   picker. That must become a genuine empty state driven by the data — right now it's permanent because the
   table can never be populated.
6. Deactivating a scheme that a Tax Head references must be blocked the same way an in-use Tax Head is.

---

## 7. Delete ALL demo data currently sitting in the Masters tables — every sub-master, no exceptions

**Before doing anything else in this section: wipe every row in every Masters table in the running
database.** Not just Taxes. Every sub-master, every table. Whatever is in there now — "Sales GST 18% -
227084", test departments, sample designations, anything created while building or testing this module — is
leftover manual test data, not a fixture, and none of it ships.

**Confirmed by reading `backend/app/models/masters.py` directly** — these are every Masters table that
exists, and every one of them must be cleared:

```
tax_schemes  tax_heads  tax_head_slab_bands  tax_head_split_components
tax_head_relief_rules  tax_head_withholding_directions  number_prefix_rules
bank_accounts  expense_types  leave_types  holidays  payment_modes
departments  designations  hsn_sac_codes  service_categories
units_of_measure  ticket_categories  customer_statuses  customer_sources
asset_categories  employment_types  insurance_plans  company_profile
company_addresses  company_documents  work_week_policies
work_week_policy_employees  saturday_overrides  pay_cycles  pay_periods
email_server_settings  email_templates  email_send_log
```

Truncate every one of them (respecting FK order — the `tax_head_*` and `work_week_policy_employees` /
`pay_periods` child tables before their parents). **Do not skip this because a table "looks empty enough" —
verify each one with a row count, not a glance at one screen.**

**Confirm the wipe actually worked by reloading every one of the 21 sub-master screens** and checking each
shows its true empty state (the specific empty-state text each screen defines — e.g. "No financial years
configured," "No departments configured" — never a blank table with no message). A screen that still shows
a stray row after this step means the wipe missed a table.

**Then, and only then, apply the seeding rule below** — this is the *after* state, not a substitute for the
deletion above:

**Two different rules apply, and they must not be conflated:**

- **Taxes must be, and must reset to, completely empty.** This is not a seeding oversight — it is this
  project's central design principle, established explicitly earlier in this build: *"no tax is named
  anywhere in the specification"* (Masters §3.2, and the standing rule recorded in project memory as
  `feedback_dynamic_taxes`). A seeded "Sales GST 18%" row — or any named tax left over from testing —
  directly violates that rule. **Delete every Tax Head row from any environment used for
  demonstration or handoff.** Ship and reset with zero rows in `tax_heads`.

- **Every other sub-master should ship with realistic example data, sourced verbatim from the prototype's
  own arrays** (`prototype/data.js`, `D.masters.*`) — not invented, not left empty. These are ordinary
  configuration lists (Payment Mode, Department, Designation, Leave Types, Expense Types, HSN/SAC, Service
  Category, Unit of Measure, Ticket Categories, Customer Status, Customer Source, Asset Categories,
  Employment Type, Insurance Plans), and an empty screen during review or demo is worse than one seeded with
  the client-approved example rows already sitting in the prototype. Example, exactly as it exists today:

  ```js
  paymentMode: [
    { name: 'Bank Transfer', code: 'BT', status: 'Active' },
    { name: 'NEFT', code: 'NEFT', status: 'Active' },
    // ...
  ]
  ```

  Transcribe each sub-master's array verbatim as a seed migration or fixture. Do not paraphrase the names,
  codes, or values — they are the client-approved examples.

**Add a master-data seed step, separate from the existing RBAC seed, that populates every sub-master except
Taxes from `data.js`, and explicitly leaves `tax_heads`, `tax_head_slab_bands`, `tax_head_split_components`,
`tax_head_relief_rules`, `tax_head_withholding_directions`, and `tax_schemes` empty.**

---

## 8. UI/visual fidelity — verified as largely correct; one thing to actually check

Comparing both screenshots directly: the built app's button hierarchy (blue primary, white/ghost secondary),
card layout, badge styling, tab strip, and identity-header layout already closely match the prototype. **This
is not a broad styling problem** — the concrete visible defect on that screen was the duplicate export row
(§1), not a design mismatch. Do not spend effort re-styling components that already match; verify instead.

**What is worth checking systematically, since it can't be judged from one screenshot:** dark theme parity,
and whether the same duplicate-export pattern or a tab-embedding gap exists on any of the other three tabbed
Masters screens beyond what's listed above, once §1 and §2–4 are fixed and re-rendered.

---

## 9. Coverage of this audit — what was checked, and what still needs a field-level pass

**Checked exhaustively in this revision:** all **25 `navHidden` action screens** under Masters (the full set
of "+ Button"-reached forms in `data.js:1609-1637`), plus all **4 tabbed/record-shape screens** (Taxes, Work
Week & Hours, Company Profile, Email Configuration). That is what surfaced §2 (Holidays Bulk Import) and §3
(Email header tiles) — both of which the first pass missed by treating flat screens as "lower risk."

**A positive finding worth recording, so nobody re-does this work:** the **14 simple lookup sub-masters**
(Payment Mode, Department, Designation, HSN/SAC, Service Category, Unit of Measure, Ticket Categories,
Customer Status, Customer Source, Asset Categories, Employment Type, Expense Types, Leave Types, Insurance
Plans) were checked on **row actions** specifically, because that was the Financial Year defect class. They
are **correct — and in fact more complete than the prototype**. The prototype's flat lookup screens declare
no `rowActions` at all (`app-core.js:279`'s `(s.rowActions || [])` renders zero), whereas the built configs
give every one of them Edit / Deactivate / Delete. `payment-modes.list.config.ts`'s own comment reasons this
through deliberately. **Do not "fix" these to match the prototype — the build is right and the prototype is
the thin one here.**

**Also checked in this revision — all 21 list screens' columns**, which produced §3a (the `Code`/`Used`
gap across 11 screens, needing a backend migration) and §3b (missing Status field on forms). That was the
single largest finding in this document and had been missed by two prior passes.

**Field-by-field diff of all 27 prototype forms vs all 25 built form configs — DONE in this revision.**
That produced §3b (Status missing from all 18 forms) and §3c (the complete list of every other missing
field). §3c also records which forms are verified-correct and which build additions are deliberate
improvements, so nobody re-opens them.

### What this audit now covers exhaustively

| Dimension | Status |
|---|---|
| Module groups, screens, tabs | ✅ complete — all 21 sub-masters, all 4 tabbed screens |
| `navHidden` action screens | ✅ complete — all 25 |
| List columns | ✅ complete — all 21 list screens (→ §3a) |
| Form fields | ✅ complete — all 27 prototype forms vs 25 built (→ §3b, §3c) |
| Row actions | ✅ complete — all lookups (build is *ahead* of prototype here; see below) |
| Backend endpoint coverage | ✅ for the gaps found (Tax Schemes, Holiday import, PUT/DELETE) |

### Two things deliberately NOT covered, stated plainly rather than left implied

1. **Per-field hint text, `req` flags, and `<select>` option arrays** were compared only where a whole field
   was missing. A field that exists in both but has a *different* option list, a dropped hint carrying a
   real rule (e.g. *"Starting Number locks once any code of that type has been generated"*), or a
   mandatory-flag mismatch would not have been caught. This is a genuinely smaller class of defect than
   anything in §1–§7, but it is not zero.
2. **Runtime behaviour.** Everything here is a source diff. Whether a field that *exists* actually saves,
   validates, and round-trips is a different question — the Tax Head PUT bug (silently discarding slab
   bands) was exactly that kind of defect and no source diff would have found it.

### The method that works — use it for the remaining 14 modules

Two earlier passes missed §3a and §3b by reasoning about which screens were "lower risk" and sampling
accordingly. Both gaps were on screens dismissed as low-risk. **Enumerate every item on the prototype side
first — mechanically, into a list — then check each one against the build.** Never conclude from a subset.

---

## Definition of done

- [ ] Export buttons appear exactly once per list screen, everywhere in the app — verified visually, not just by reading the diff
- [ ] **`Code` column and field present on all 10 lookups that lack it** (migration + list + form), and `Default Useful Life (yrs)` on Asset Categories
- [ ] **`Used` column present on all 11 screens that lack it**, using one consistent pattern, plus the Used/Unused filter Masters §3.0 requires
- [ ] **Status toggle added to all 18 forms listed in §3b** — and a record can be created already-inactive
- [ ] **§3c's missing fields all added**: Asset Categories' Default Useful Life · Bank Accounts' Is Default + UPI QR Code · Company Profile's Display Name, Logo, Letterhead, Registered Address
- [ ] Bank Accounts' `Default` list column can actually be set from the form (it currently displays a flag nothing can populate)
- [ ] Holidays has a working Bulk Import screen wired to the existing backend endpoint, Super Admin only
- [ ] Work Week & Hours has all 6 tabs, each showing real data (not a "can't be embedded yet" placeholder)
- [ ] Company Profile has all 5 tabs, Documents tab actually uploads a letterhead/logo that a generated PDF then uses
- [ ] **Add Tax Head rebuilt to the prototype's structure** — 3 sections, **25 fields** (the prototype's 23 + `short_code` + `slab_application`, both confirmed keep), in the prototype's order; Slab Bands, Split Components and Relief Rules moved OUT to their own separate screens (`masters.taxes.slab` / `.split` / `.relief`) instead of inline nested tables
- [ ] **Taxes has SIX tabs** — Billing · Purchase · Payroll · Withholding · **Tax Schemes** · Where Used — with Tax Schemes as its own separate tab (5 columns + count badge) and its own separate `Add Tax Scheme` form screen, exactly as the prototype has it
- [ ] A scheme can be created, edited, set as default (exactly one at a time), and selected on a Tax Head; deactivating a scheme in use is blocked the same way an in-use Tax Head is
- [ ] With zero schemes configured, the Tax Scheme field hides on the Tax Head form and no scheme picker appears on the employee declaration screen — verified by actually deleting all schemes, not assumed
- [ ] **All 33 Masters tables listed in §5 confirmed emptied of pre-existing demo/test data** — verified by row count, not by eyeballing a screen
- [ ] `tax_heads` and every tax child table stay empty after reseeding; every other sub-master is seeded from `data.js`'s own arrays, verbatim, and shows real rows on first load — not its empty state
- [ ] The remaining 17 sub-masters audited field-by-field, action-by-action, against the prototype — report gaps found, same format as this document
- [ ] Re-screenshot every one of the 21 sub-masters against its prototype equivalent before calling Masters complete
