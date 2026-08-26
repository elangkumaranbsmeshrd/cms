# Module 14 of 14: Roles & Access (RBAC)

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the RBAC module.

> **Build status (reconciled against the backend, 2026-08-03).** The FastAPI backend for this module is **built and live**: the four-layer permission engine (`backend/app/rbac/` — registry, resolver, deps, scope), field masking (`backend/app/core/serialization/masking.py`), the shared filter-following export service (`backend/app/services/list_export.py`), and all four §4 admin screens as API endpoints (`backend/app/api/v1/rbac_admin.py`, router prefix `/rbac`, module key `rbac`, Super Admin only). The Angular frontend has not been started — every screen-layout, navigation, and visual convention in this document (including §2.2 c-i and §2.3) describes the frontend and awaits that build. Per-section status notes below mark what is built, what is deferred and why, and what the code does differently from earlier assumptions.

**This is the last of fourteen modules, and the only one every other module depends on.** Every prior document — Masters through Purchase Bill — has already described default role permissions and named a set of toggles ("Show Salary Amount to Manager," "Restrict Manager to Only Their Own Customers," and so on). None of those toggles were real until now. This module is the one screen that makes every one of them actually work.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [The Permission Model](#2-the-permission-model)
   - 2.1 [Every Field/Action Toggle Already Named, Compiled](#21-every-fieldaction-toggle-already-named-compiled)
   - 2.2 [The System-Wide Filter & Export Convention](#22-the-system-wide-filter--export-convention)
   - 2.3 [The Settings Screen — Appearance](#23-the-settings-screen--appearance)
3. [The Screen Inventory](#3-the-screen-inventory)
4. [Screens](#4-screens)
   - 4.1 [Role Directory](#41-role-directory)
   - 4.2 [Role Permission Matrix](#42-role-permission-matrix)
   - 4.3 [Individual Permission Overrides](#43-individual-permission-overrides)
   - 4.4 [Permission Change Log](#44-permission-change-log)
5. [Workflows](#5-workflows)
6. [UI/UX Notes](#6-uiux-notes)
7. [Connected To / Depends on Masters](#7-connected-to--depends-on-masters)
8. [Role-Based Access](#8-role-based-access)
9. [Assumptions & Points to Confirm](#9-assumptions--points-to-confirm)

## 1. Module Overview

RBAC is the control room. Every screen in every one of the other thirteen modules, every action on those screens, every sensitive field, and every scope restriction — all of it is controlled from here, by Super Admin, for every role and, where needed, every individual person.

The core requirement, stated as plainly as it was given: **nothing is permanently fixed.** A Super Admin can take any screen from any module and show it to a role that wouldn't normally see it — Employee viewing something normally Manager-only, or Employee getting into a module whose default is no access at all, like Customer — the same way a screen a role currently has can be hidden from it. Access is a setting everywhere in this system, never a hardcoded rule.

Only Super Admin can open this module at all. Every other role is invisible to it entirely — not read-only, not partial, it simply doesn't exist for them.

This module has nothing to do with Meshrd's retail hardware products — it only controls access within this internal CMS.

## 2. The Permission Model

This is the foundation everything else in this document sits on. Four layers, and all four apply to every module — not just some of them, and not just the ones with an obvious example.

> **Built.** The engine is `app/rbac/resolver.py` (one `PermissionSet` per user+screen, **default-deny on every layer**), enforced by the `require_screen(screen_key, action=...)` dependency in `app/rbac/deps.py` on every protected route. Two behaviours worth stating because they are deliberate: a **Hidden screen returns 404, not 403** — an invisible screen does not reveal that it exists, exactly matching Layer 1's "no reachable URL" rule; a Visible screen with a denied action returns 403. Layer 3 is applied at the serialization boundary (`app/core/serialization/masking.py` — modes `show`/`mask`/`hide`; a route that forgets to check a field still cannot leak it). Layer 4 is applied per-route via `app/rbac/scope.py`'s `apply_scope()`, always before any user filter.
>
> **One data-model fact the code settled:** Layer 1 visibility and Layer 4 scope are **one field** — `RolePermission.mode`, taking `none` / `full` / `view` / `view_team` / `own` / `team`, which encodes both at once. There is no separate scope write path: changing a role's scope IS changing its mode, and the Permission Change Log (§4.4) records any mode change as a single L1 entry.

### Layer 1 — Screen-Level Visibility

For every (Role, Screen) pair, a screen is either **Visible** or **Hidden**. If Hidden, it doesn't appear anywhere in that role's navigation — no greyed-out menu item, no "access denied" page reachable by URL guessing, it simply isn't there. This is the coarsest layer and the one every other layer sits inside: a screen has to be Visible before any of the next three layers mean anything.

### Layer 2 — Action-Level Permissions

For a Visible screen, which specific actions that role can perform on it. The exact action list is different per screen, and it's pulled directly from that screen's own module documentation rather than invented generically here. A few examples of how differently this reads screen to screen:

- Ticket Detail / Conversation (Ticket, Module 4): Reply, Add Internal Note, Change Status, Reassign.
- Asset Master Record (Asset Management, Module 3): Add, Edit — with Delete/Deactivate reserved for Super Admin only, never a toggle-able action for any other role.
- New / Edit Invoice (Invoice, Module 11): Save, Send, Download — with every field locking automatically once Status reaches Paid, regardless of role.
- Expense Approvals (Expense, Module 12): Approve, Reject.

There's no single universal action list this module invents and forces onto every screen — each screen's real action set, as already documented, is what populates this layer for that screen.

### Layer 3 — Field-Level Sensitivity

For a screen with a sensitive field — a salary amount, bank details, a purchase value, and so on — a separate toggle shows or hides just that field, independent of whether the screen itself is Visible. Every module documented so far has at least one example of this. Section 2.1 below compiles the full list already established, since it's what this layer needs to expose.

### Layer 4 — Scope Restriction

Whether a role sees every record in a module, only their team's, or only their own — the same **All / Team / Own** pattern already used throughout the prior thirteen documents (e.g. "Restrict Manager to Only Their Own Customers," "Restrict Manager to Only Projects They Manage"). Not every screen has a meaningful scope dimension — Masters' Financial Year, for instance, is inherently company-wide and singular, with no "team" or "own" version of it — so this layer's control simply doesn't appear on a screen where it wouldn't mean anything, rather than being forced onto every screen regardless of fit.

### The Override Layer, on Top of All Four

Independent of role-level settings, Super Admin can grant or revoke one specific permission for one specific person, without touching the setting for anyone else who shares that role. This applies across all four layers above — a person-specific override can flip a screen's visibility, unlock one action, reveal one sensitive field, or widen one person's scope, all without changing their role's default for anyone else. Screen 4.3 is where this happens.

---

### 2.1 Every Field/Action Toggle Already Named, Compiled

This is what Layer 3 (and several Layer 4 scope toggles) need to expose on the Role Permission Matrix (4.2) — every specific toggle already named across the prior thirteen documents, brought together in one place for the first time. Masters (Module 1) isn't included here since its own access model was already structured as a direct Manage/View/No-access table per sub-master, not as this style of named toggle.

| Module | Toggle | Default | Effect When Turned On |
|---|---|---|---|
| Employee | ~~Show Salary Amount to Manager~~ — **retired.** Team Payslips was removed entirely from both the Employee and Payroll modules (see Employee, Module 2, Section 6.1; Payroll, Module 6, Section 6) — the screen this toggle controlled no longer exists in either. Kept as a struck-through row so a future revision that reintroduces a team-level pay view knows this is the setting name it should reuse. | N/A | N/A |
| Employee | Allow Employee to Edit Bank Details Directly | OFF | Bank & Statutory changes skip the HR-approval queue |
| Employee | Show Financial Year Management to Manager | OFF | A Financial Year option appears in Manager's menu |
| Employee | Allow Manager to Edit Team Member Employment Details | OFF | Manager can edit fields like Designation for their own direct reports |
| Employee | Require Manager Acknowledgment Before HR Processes Exit | ON | Turning this OFF lets HR start the exit checklist immediately, without waiting on Manager |
| Employee | Allow HR to Edit Salary Structure | OFF | New in this revision: HR stays view-only on Salary Structure by default (Section 2.2 of that module); turning this on would extend HR's edit rights to compensation, currently reserved for Super Admin only |
| Employee | Allow HR to Edit Statutory Applicability Toggles | OFF | The per-employee Applicable toggles in the Statutory Deductions & Contributions block (Employee module, Section 2.2) are Super Admin or Accountant by default; turning this on would let HR set these too, without giving HR the rest of Salary Structure. Reworded this revision — there is no longer a fixed set of three toggles; there is one per configured tax head that permits per-employee opt-out |
| Masters | Allow Accountant to Manage Taxes | OFF | **Replaces "Allow Accountant to Edit Statutory Rates in Masters," which pointed at four Masters sub-masters that no longer exist.** Accountant is view-only on Masters → Taxes (Section 3.2) by default. Turned ON: Accountant can add and edit tax heads directly — new levies, new rates, new slabs, new schemes — without needing Super Admin. Delete and Deactivate stay Super Admin only either way, and no role can alter a head already used in a calculation. This is the one toggle in this table that grants access to a Masters sub-master, and it exists because tax configuration is finance knowledge that would otherwise bottleneck on Super Admin every time the law changes |
| Employee | Allow Employee to Change Insurance Plan Mid-Year | OFF | New in this deep-dive revision: insurance enrollment (Insurance & Benefits tab, Employee module Section 2.2) is HR/Super Admin-managed by default, changed at a fixed annual window. Turned ON: an employee could request a plan change themselves at any time, subject to whatever the actual insurance provider allows |
| Asset Management | Allow Manager to Reassign Assets Directly | OFF | Manager gets a direct Reassign button instead of only approving requests |
| Asset Management | Show Purchase Value to Manager | OFF | Purchase Value and Current Value become visible to Manager |
| Asset Management | Allow HR to Edit Depreciation Method | OFF | HR gets that field too, alongside Accountant/Super Admin |
| Asset Management | Allow HR to Edit Core Info | OFF | HR can edit Name/Category/Serial Number/etc. directly, not just view |
| Ticket | Allow Staff to View the Full Open Ticket Queue | OFF | Employee sees every open ticket, not just their own assigned ones |
| Ticket | Allow Staff to Reassign Their Own Ticket | OFF | Staff can hand their own ticket to a teammate directly |
| Ticket | Show Support Reports to Staff | OFF | Individual staff see the team-wide report |
| Ticket | Allow Staff to Create New Tickets | OFF | Any Employee can log a new ticket, not just Manager/Super Admin |
| Ticket | Require Satisfaction Rating on Close | OFF | A ticket can't be moved to Closed without a rating |
| Leave | Allow Manager to Adjust Team Leave Balance | OFF | Manager gets limited balance-adjustment rights for their own direct reports |
| Leave | Require HR Co-Approval for Leave Longer Than X Days | OFF | Long requests need both Manager and HR sign-off |
| Payroll | Allow Manager to Run Payroll | OFF | Restores the full company-wide run-and-view-all access the source data originally gave Manager |
| Payroll | Allow HR to Add Ad-hoc Payslip Adjustments | OFF | New in this revision: kept to Accountant and Super Admin by default. Turned ON: HR could add one-off bonuses/recoveries too |
| Payroll | Hide Ad-hoc Adjustment Labels from Employee | OFF | New in this revision: the actual reason ("Diwali Bonus") shows on the payslip by default. Turned ON: shows a generic "Adjustment" line with the amount only |
| Payroll | Require Super Admin Approval to Reissue a Payslip | OFF | A reissue needs Super Admin sign-off before it takes effect |
| Payroll | Notify Employee When a Payslip Is Reissued | ON | Turning this OFF allows a silent correction with no employee notification |
| Vendor | Allow Manager to Edit Vendor Bank & GST Details | OFF | Manager gets full edit rights on those fields, not just contact/general info |
| Vendor | Allow Hard Delete of a Vendor | OFF | Allows deleting a vendor even with usage history — not recommended |
| Vendor | Require Approval to Add a New Vendor | OFF | New vendors need Accountant or Super Admin sign-off before use |
| Customer | Restrict Manager to Only Their Own Customers | OFF | Manager only sees customers where they're the assigned Owner |
| Customer | Give Accountant Read Access to Customer Financial Summary | OFF | Accountant can view Total Invoiced/Received/Outstanding for any customer |
| Customer | Allow Employee to Log Activities on Customers They're Staffed On | OFF | An employee on that customer's project can add a call/meeting note directly |
| Opportunity | Restrict Manager to Only Their Own Opportunities | OFF | Manager only sees deals where they're the assigned Owner |
| Opportunity | Give Accountant Read Access to Pipeline Value | OFF | Accountant sees a read-only pipeline-value summary by stage |
| Opportunity | Allow Employee to View the Opportunity Behind Their Assigned Project | OFF | An employee staffed on a project can see the deal it came from |
| Project | Restrict Manager to Only Projects They Manage | OFF | Manager only sees/manages projects where they're the assigned Project Lead |
| Project | Give Accountant Read Access to Project Budgets | OFF | Accountant sees the Budget field across all projects |
| Project | Allow Employee to Manage Sprints on Their Own Projects | OFF | A trusted team member can start/update/complete sprints without Manager-level access |
| Project | Show Project Report to Employee | OFF | Team members see the same task/bug counts Manager sees, for their own projects |
| Project | Hide Budget from Employee's Project View | OFF (Budget currently shown) | Hides Budget from Employee's Directory view specifically |
| Invoice | Allow Manager Read-Only Access to Their Projects' Invoices | OFF | Manager can view (not edit or record payments on) invoices tied to projects they lead |
| Invoice | Require Second Approval Before an Invoice Locks as Paid | OFF | Super Admin must confirm before a completing payment locks the invoice |
| Invoice | Show Non-Financial Dashboard Widgets to HR | OFF | HR sees only operational widgets (Active Projects, Open Tickets, Active Employees), never revenue figures |
| Expense | Allow Manager to Approve Their Team's Expenses | OFF | Adds a manager sign-off step before Accountant's final approval |
| Expense | Require a Receipt Before Approval | OFF | Blocks approval on any submission missing a receipt |
| Expense | Set an Auto-Approval Threshold | OFF | Expenses under a set amount (e.g. ₹500) approve automatically |
| Expense | Auto-Mark as Reimbursed When Paid via Payroll | OFF | New in this revision: reimbursement stays a manual confirmation by default; turning this on would let expenses bundled into a payslip auto-mark as Reimbursed |
| Purchase Bill | Require Attachment Before Marking a Bill Paid | OFF | Blocks payment recording until the vendor's bill copy is attached |
| Purchase Bill | Lock Purchase Bill Once Fully Paid | OFF | Mirrors Invoice's lock-on-Paid behavior |
| Purchase Bill | Give Manager Read-Only Access to Purchase Bills | OFF | Manager can view bills and payment status without any edit rights |

That's 46 distinct toggles. Two removed several revisions back: "Show Team Leave Calendar to Accountant" (the Team Leave Calendar screen itself has been removed from the Leave module entirely) and both "Require a Reason on Leave/Expense Rejection" toggles (rejection now requires a reason everywhere in this CMS by default). Seven added across the last four revisions: "Allow HR to Edit Salary Structure" and "Auto-Mark as Reimbursed When Paid via Payroll"; "Allow Accountant to Manage Taxes" and "Allow Employee to Change Insurance Plan Mid-Year"; "Allow HR to Add Ad-hoc Payslip Adjustments" and "Hide Ad-hoc Adjustment Labels from Employee"; and "Allow HR to Edit Statutory Applicability Toggles." Every one of them needs a home on the Role Permission Matrix (4.2), under its module's collapsible section, attached to the specific screen it affects.

**One of those seven was renamed and re-scoped this revision:** "Allow Accountant to Edit Statutory Rates in Masters" became **"Allow Accountant to Manage Taxes."** The old name pointed at four Masters sub-masters that have been deleted. The count stays at 46 — this is the same toggle serving the same purpose against a different underlying design, not a new one.

> **Build status — a known open design tension, stated honestly.** The backend has a `feature_toggles` table and `FeatureToggle` ORM model (`app/models/rbac.py`) built to hold these named toggles — but **no runtime code reads it**: no seed rows are written and no endpoint or resolver consults it. What actually exists instead is each toggle's *default* baked in as static seed-time role permissions (`app/seed.py` — e.g. "Show Purchase Value to Manager" OFF is simply Manager not being granted that sensitive field; "Allow Manager to Run Payroll" OFF is Payroll's run screen not seeded to Manager). Flipping a toggle at runtime therefore has no dedicated switch today; the **live escape hatch is the per-person `UserPermissionOverride`** (§4.3), which does work immediately, or Super Admin editing the role default on the Matrix (§4.2). Whether the named-toggle runtime should ever be built, or whether the Matrix + overrides make it redundant, is deliberately unresolved — this table remains the specification of intent for each toggle's meaning and default.

---

### 2.2 The System-Wide Filter & Export Convention

**Substantially expanded in this revision, per explicit instruction: every module's list screens must carry filters for every role that can open them, Super Admin must have every filter on every page, and export must always follow the filter.** This section is the single definition of all three, referenced from every other module's documentation rather than restated thirteen times.

This is a fixed platform convention, not a per-module toggle. It doesn't appear in the Role Permission Matrix (4.2) as something to turn on or off, because it isn't optional — it's part of what makes a screen a list screen in this CMS at all.

> **Build status.** The backend implements this convention through one shared service, exactly as (g) demands: `app/services/list_export.py` owns the §2.2(f) header block (filters applied, result count, exported by, exported at) and dispatches to the PDF/Excel engines; roughly **63 list endpoints across ~31 routers** accept `format=pdf|excel` and export exactly their filtered, scoped, masked row set — callers pass rows already passed through the same masking the JSON response carries, so an export can never show more than the screen does. **Search and multi-select Status** baseline filters are implemented broadly; scope-before-filters (d) is enforced by `apply_scope()` running before any query filter. **Partially deferred:** the *extended* per-screen filter sets (full date-preset lists, Owner pickers, Super Admin's "Created By"/"Last Modified By" on every screen, "All financial years") are not uniformly present yet — the baseline is; the rest lands screen-by-screen. Filter chips, persistence, and empty-state wording are frontend behaviour awaiting the Angular build.

#### a. What counts as a list screen

Any Directory, List, Queue, Report, Summary, History, or Log screen — anything that shows more than one record in a table or card list. **This includes self-service screens**, which is a change worth stating plainly: My Leave, My Payslips, My Tickets, My Assets, My Documents, My Expenses, My Projects & Tasks, and every other "my own records" screen is a list screen and gets the full treatment. Earlier revisions treated filters on those as optional nice-to-haves, which is why several of them had one filter or none. An Employee looking at four years of their own payslips needs to narrow that list exactly as much as an Accountant looking at everyone's.

Record-detail screens (one Employee Master Record, one Invoice, one Ticket conversation) are not list screens. Those have their own single-record download where relevant — a payslip PDF, an invoice PDF — which is a different thing from exporting a filtered list.

#### b. Every role that can open a list screen gets that screen's filters

**There is no such thing as a filter that exists for one role and not another on the same screen.** If a screen is visible to a role, every filter on it is usable by that role. Filters narrow what a role can already see; they never widen it, so withholding one protects nothing and just makes the screen worse to use.

The rule that does the actual protecting is the scoping rule in (d) below: the *data* a role sees is already limited before any filter is applied. An Employee filtering the Ticket List by "Assigned To" is filtering within their own tickets; a Manager doing the same is filtering within their team's. Same filter control, same behaviour, different underlying set.

**Two narrow exceptions, both about the filter being meaningless rather than restricted:**

1. A filter whose entire dimension is invisible to that role — an Employee has no "Employee" filter on their own payslip list, because every row is theirs. Hiding it removes a control that could only ever return everything or nothing.
2. A filter on a field that role cannot see at all — if Purchase Value is hidden from Manager on the Asset Directory, the Purchase Value range filter goes with it. The field's visibility decides; the filter follows.

Anything outside those two cases is shown to every role that can open the screen.

#### c. The baseline filter set every list screen carries

Regardless of module, every list screen gets these unless the dimension genuinely doesn't exist on that data:

| Filter | Applies To | Notes |
|---|---|---|
| **Search** | Every list screen | Free-text across that screen's identifying fields — name, code, number, title. Each module names its own searched fields |
| **Date range** | Every list screen with a date | A From/To pair on that screen's primary date, plus quick presets: This Month, Last Month, This Quarter, This Financial Year, Last Financial Year, Custom. Financial-year presets read Masters → Financial Year (Section 3.1), so they never hardcode a date |
| **Status** | Every list screen whose records have a status | Multi-select, not single-select — "show me Open and In Progress" is a more common need than either one alone |
| **Owner / Assigned To / Created By** | Every list screen where records belong to a person | Scoped per (d): the picker only ever offers people that role is allowed to see |
| **Active/Inactive** | Every list drawn from a Masters list | Defaults to Active only, with an explicit "include inactive" option rather than silently hiding retired entries |

Module-specific filters sit alongside these, documented in each module's own screen sections.

**Behaviour rules for all filters, everywhere:**

- **Filters combine with AND**, and applied filters show as removable chips above the table, with a "Clear all" control. A user should never have to guess why a list looks empty.
- **The applied filter state persists** for that user, on that screen, within a session — navigating into a record and back does not reset it. Assumption, flagged for confirmation: it does *not* persist across sessions, since a stale filter silently applied at next login is a common source of "the data is missing" reports.
- **Empty results say which filters caused it**, e.g. "No tickets match Status = Closed and Date = This Month," with the clear-all control right there. A bare "No records found" is not acceptable on a filtered screen.
- **Result count is always shown** — "Showing 24 of 312" — so a narrowed list is visibly narrowed.

#### c-i. Column alignment on every table (added 2026-07-31)

A platform convention in the same sense as the rest of this section — not a per-screen styling choice, and not something a module document restates. *(Frontend convention — awaits the Angular build; retained unchanged.)*

| Column holds | Alignment | Applies to |
|---|---|---|
| **Money — any currency amount**: totals, balances, rates in ₹, salaries, purchase and current values, line totals, deductions, net pay | **Left**, in both the header cell and the body cells | Every list screen, every report, every record tab, the invoice/bill line-item editor, and the Subtotal / Tax / Grand Total block |
| Non-money figures — counts, quantities, hours, days, percentages, ageing in days | Right | — |
| Text — names, codes, statuses, dates, identifiers | Left | — |

**Set 2026-07-31, replacing a briefly-held right-aligned rule.** Currency amounts read from the left, aligned with the column heading above them and with the text columns beside them, so a table scans as one continuous left edge rather than a set of columns drifting in from the right. Money figures in this system are shown formatted with the ₹ symbol leading, and a leading symbol is what the eye anchors on — right-aligning pushes that anchor to a different horizontal position on every row.

Four specifics, each of which was a real source of drift:

1. **The header cell follows the body cells.** A left-aligned column of amounts under a right-aligned header reads as a mistake. Header and body are always set together.
2. **Non-money figures keep their right alignment.** Hours, leave days, quantities, percentages and ageing counts are compared for magnitude rather than read as labels, and they carry no leading symbol — so they stay right-aligned. A table can legitimately contain both, as the payroll and attendance screens do.
3. **Identifiers that happen to be numeric are text, not figures** — HSN/SAC codes, PIN codes, invoice numbers, phone numbers, "30 days" payment terms. Left, like any other label.
4. **A masked amount keeps the alignment of the amount it replaces.** Where a field-level permission (Section 2.3) hides a figure from a role, the placeholder sits in the same column alignment, so masking never shifts the layout for that role.

**Implementation note for the build:** this is enforced in one place, not per screen. Every table builder normalises its money columns through a single shared helper, so a new screen inherits the rule automatically and cannot drift from it. Changing the house rule is a one-line change in that helper, not a sweep across every column definition — which is precisely how the earlier inconsistency arose.

#### d. Role scope always applies before filters

Every list screen already has a role-scoped data set, defined in that module's own Role-Based Access section: Employee sees their own records, Manager sees their direct reports' plus their own, Accountant/HR/Super Admin see what their module permissions allow. **Filters operate strictly inside that set, never outside it.**

This is what makes (b) safe. Giving every role the same filter controls grants nobody any additional visibility, because the set being filtered was already restricted. A filter is a lens, not a key.

#### e. Super Admin — every filter, every page

**Super Admin sees every list screen in the CMS, with every filter on it, unscoped.** Where another role's version of a screen has a filter hidden under exception (b)(1) because the dimension is meaningless for them, Super Admin's version has it — an Employee's payslip list has no Employee filter, Super Admin's does.

Super Admin additionally gets, on every list screen:

- **A "Show inactive / archived / deleted-status records" toggle**, off by default, on any screen whose records can be deactivated or soft-deleted.
- **An "All financial years" option** on every date-range filter, since Super Admin is the only role that closes and locks financial years (Masters, Section 3.1) and routinely needs to look across them.
- **A "Created By" and "Last Modified By" filter** on every screen, whether or not other roles get them — this pairs with the audit responsibilities Super Admin already carries in this module.

#### f. Export always follows the filter

**Every list screen gets "Export to PDF" and "Export to Excel," available to every role that can open the screen — not a Super Admin privilege.**

- **What exports is exactly what is on screen**: current filters, current search, current sort, current column set. Exporting the Ticket List with Status = Open and Assigned To = one person exports exactly that set. There is no "export everything" option that bypasses the applied filter — if a user wants everything, they clear the filters first, which is a visible, deliberate act.
- **Export respects role scope identically.** A Manager exporting the Asset Directory exports their team's assets, not the company's. Export is never a backdoor to more data than the screen itself shows — this is the rule that makes universal export access safe.
- **The export states its own filters.** Every exported file carries a header block listing the filters that produced it, the result count, who exported it, and when. A spreadsheet of 24 rows that doesn't say it was filtered to one month is actively misleading once it's been emailed to someone.
- **Format:** PDF uses the same letterhead treatment as other generated documents in this CMS (invoices, payslips, salary certificates), drawn from Company Profile (Masters, Section 3.6). Excel is a plain data export — one row per record, columns matching the screen — not a formatted report.

**One deliberate restriction, and it is about the data, not the button — historical, kept for the principle it illustrates.** Payroll used to carry a Manager-facing Team Payslips screen whose amount column followed a "Show Salary Amount to Manager" flag: a Manager whose screen showed Processed/Pending without amounts exported Processed/Pending without amounts. That screen has since been removed entirely from both Payroll and Employee (see the note in Payroll, Module 6, Section 6), so this specific example no longer applies — but the principle it demonstrated still governs every screen with a role-scoped column: the export matches the screen, so a visibility flag never needs a separate export rule.

#### g. Where this is enforced

This convention is not a per-screen design decision to be re-litigated in each module. Every module's documentation points here, and each module's own screen sections list only the filters *specific to that screen* — the baseline set in (c), the role rule in (b), Super Admin's superset in (e), and the export behaviour in (f) are inherited, never restated.

---

### 2.3 The Settings Screen — Appearance

*(Frontend convention — describes the prototype's shell; awaits the Angular build. Retained unchanged.)*

Documented here, in the module that owns every other cross-cutting convention, because Settings is not part of any of the fourteen functional modules: it configures the shell those modules are drawn inside. It is reached from the fixed link at the bottom-left of the sidebar and from the profile menu — deliberately not from the module tree, which would list the same screen twice at once.

**Who can open it:** all five roles, for the Appearance tab. The Regional & Financial and System tabs are Super Admin only.

> The table below uses a **Control** column rather than the "Field Name" heading used by module Fields Tables. That is deliberate: these are shell preferences, not record fields, and the automated field-coverage check keys on the "Field Name" heading to map a spec table onto a module's screens. Naming these as fields would ask that checker to find them on a module screen they do not belong to.

| Control | Type | Default | Behaviour |
|---|---|---|---|
| Theme | Light / Dark / Match system | Light | Applies instantly across every screen. "Match system" reads the OS preference |
| Accent Colour — presets | Six swatches (Blue, Purple, Green, Amber, Rose, Teal) | Blue | Recolours every accent-tinted element live: primary buttons, active navigation, links, focus rings, chart and meter fills |
| Accent Colour — **custom** | Colour picker (any value) | — | Added 2026-07-31. Opens the OS colour wheel; the interface recolours *while the user drags*, not only on release. See the derivation note below |
| Display Scale | Presets 90 / 100 / 110 / 125 / 150%, plus a free slider from 80–200% | **110%** | Added 2026-07-31. Scales the entire interface live, the way browser zoom does |

**The custom accent derives a full ramp from one colour.** An accent is not one value — it needs a hover shade, a subtle fill for tinted backgrounds, and a hairline for borders, and each of those needs a different treatment in Light than in Dark. Asking a user to pick four colours twice would guarantee unusable combinations. Instead the picker takes a single colour and derives the other three by mixing toward white on Light and toward the dark canvas on Dark — the same relationships the six hand-tuned presets already use. A custom accent therefore stays legible when the theme is switched, without the user choosing anything twice.

**Why Display Scale exists as an application setting rather than leaving it to browser zoom.** Browser zoom is per-site and per-profile: it resets on a cleared profile, does not follow the user to another machine, and is invisible to the application. A display scale that belongs to the user account means a shared workstation or a fresh browser still opens the CMS at the size that person works in. It also does the job that would otherwise fall to every screen carrying its own breakpoints for large and high-density displays — one control, applied once, rather than a responsive rule per screen. **110% is the default** because that is the size this prototype was reviewed and signed off at; 100% remains the design baseline the type scale is specified in.

**All three are held in memory for the session only** and nothing is written to browser storage — consistent with the filter-persistence rule in the System tab, and with this prototype's rule of never persisting outside the session.

## 3. The Screen Inventory

This is the ground truth for what the Role Permission Matrix (4.2) covers — every screen documented across the prior thirteen modules, organized the same way. This document doesn't invent its own screen list; the Matrix is built directly around this one.

**Every screen below that shows more than one record is a list screen**, and therefore carries the filter set, all-roles rule, Super Admin superset, and filter-based export defined in Section 2.2 — without needing a per-screen note here. Four screens were added to this inventory in the same revision, found while auditing filter coverage: HR cross-employee onboarding and exit views (Employee), the Credit Note list (Invoice), and the company-wide overrides view (Section 4.3 of this module).

| Module | Screens |
|---|---|
| **Masters** | Simple Configuration Lists (Financial Year, Expense Types, Leave Types, Payment Modes, Department, Designation, Ticket Categories, Customer Status, **Customer Source**, Asset Categories, Service Category, Unit of Measure, Employment Type); Holidays; **Taxes** (its own multi-tab screen — Tax Heads, Tax Schemes, Where Used — not a simple list); Insurance Plans; **Work Week & Hours** (its own multi-tab screen — Work Week Policies, Daily Hours, Saturday Calendar, Compensation, Where Used); **Email Configuration** (its own multi-tab screen — Server Settings, Email Templates, Recent Sends); Bank Account; HSN/SAC Code; Company Profile (General Info, Addresses, Bank Details, Documents, Number Prefixes tabs) |
| **Employee** | Employee Directory; Employee Master Record (including the fully-designed Salary Structure tab and the Insurance & Benefits tab); My Profile; My Leave; My Payslips (Employee view); My Documents; My Tickets; My Projects & Tasks; My Assets; Employee Dashboard; Announcements/Notifications; Onboarding Checklist (per-employee, plus the new HR cross-employee view); Offboarding/Exit (per-employee, plus the new HR cross-employee view); My Tax Declarations; Offer & Appointment Letter |
| **Asset Management** | Asset Directory; Add/Edit Asset (now including Order Date); Assign/Transfer/Unassign; Maintenance & Service Log; Depreciation & Current Value; Asset Requests; Asset Reports; Reclaim on Exit; Download Asset Card/List |
| **Ticket** | Ticket List; New/Edit Ticket; Ticket Detail/Conversation; Assign/Reassign Ticket; Support Reports |
| **Leave** | My Leave; Leave Approvals; Leave Balance Management; Company Holiday Calendar; Leave Reports — Team Leave Calendar has been removed from this module entirely |
| **Payroll** | Run Payroll (+ Payroll History); Ad-hoc Payslip Adjustments (new); Payslip — Employee View; Payslip — Manager View; Payslip — Accountant/HR View; Attendance & Time-Basis Calculation (planned) |
| **Vendor** | Vendor Directory; Add/Edit Vendor (now including IFSC Code and PIN Code); Vendor Usage |
| **Customer** | Customer Directory; Add/Edit Customer; Customer 360 (Overview, Contacts, Activities, Opportunities, Projects, Invoices, Tickets, Files tabs) |
| **Opportunity** | Opportunity Pipeline; Add/Edit Opportunity (now with Probability auto-suggestion); Opportunity Record (Details, Activities, Files — added 2026-07-30, replaces the old row-click target). Quote was removed entirely on 2026-07-30 — see Opportunity, Module 9, Section 1 |
| **Project** | Project Directory; Add/Edit Project; Task Board; Task Detail; Sprints; Bugs; Project Report; Milestones & Timesheets — now fully built, no longer "planned" |
| **Invoice** | Invoice Dashboard; Invoice List; New/Edit Invoice; Record Payment; Credit Note; Credit Note List (new) |
| **Expense** | My Expenses; Expense Approvals; All Expenses/Summary (now including "Mark as Reimbursed"); **Company Expenses** (added 2026-07-31 — Super Admin and Accountant only; the company's own Company-Paid running bills, which have no claimant and never enter the reimbursement queue) |
| **Purchase Bill** | Purchase Bill List; Add/Edit Purchase Bill (now incl. withholding fields); Record Payment |
| **Tax & Compliance** (Module 15, added 2026-07-31 — additional to the 14 above, same numbering convention Daily Task briefly used) | Overview; Obligations — Withheld on Payments; Obligations — By Document; Remittances; Record Remittance; Credits — Withheld from Receipts; Certificates; Log Certificate; Mark Credit Claimed. **Accountant + Super Admin only.** The whole tab is hidden unless at least one tax head has *Creates an Onward Liability* = Yes |

That's 13 modules and roughly 75 individual screens once Customer 360's 8 tabs and Masters' 23 sub-masters are each counted — the exact figure the Role Permission Matrix's own search bar exists to make manageable (Section 4.2). RBAC itself isn't in this table, since Super Admin already has unconditional full access to it — there's nothing to configure about access to the module that configures access. **Company Expenses (Expense, Section 2.4) was added on 2026-07-31**, taking the screen count to roughly 76. **Daily Task, added as a 15th module on 2026-07-30, was removed entirely on 2026-07-31** — the table is back to the original 14 modules. **Customer Source (Masters, Section 3.16) was removed entirely on 2026-07-30 and restored on 2026-07-31** — its sub-master screen and the Customer record's Source field are both back, bringing the screen count to roughly 78. **Email Configuration (Masters, Section 3.21) was added on 2026-07-31** — a new multi-tab record screen plus two hidden forms, taking the count to roughly 81. **Tax & Compliance (Module 15) was added on 2026-07-31** — nine screens tracking withholding in both directions across three sources (vendor, employee, customer), taking the count to roughly 90.

> **Build status — the registry is code, and it holds exactly 81 screens.** The built ground truth is `app/rbac/registry/screens.py`: a code-as-registry dict of **81 `ScreenDef` entries** (masters 21, employee 15, project 7, compliance 6, leave 5, payroll 5, asset 5, expense 4, rbac 4, invoice 2, ticket 2, and one each for customer, vendor, purchase_bill, credit_note, opportunity), each declaring its module key, action list, scope dimension, and sensitive fields. The count differs from this table's "roughly 90" because several spec screens are governed by a parent screen's key rather than their own registry entry (Customer 360's tabs under one customer screen, Record Payment under its parent list, and so on) — the registry, not this prose count, is authoritative. A **drift-protection test suite** (`tests/rbac/`, notably `test_seed_matches_canonical.py`) keeps `screens.py`, `app/seed.py`'s role-permission tables, and `tests/conftest.py`'s independently-transcribed canonical policy in lockstep — any of the three changing without the others fails CI.
>
> **One correction to the paragraph above:** "RBAC itself isn't in this table" is no longer accurate as built. The four §4 admin screens **are** in the registry, under module key `rbac` (`rbac.role_directory`, `rbac.permission_matrix`, `rbac.overrides`, `rbac.change_log`), seeded Super-Admin-only and gated through the same `require_screen` engine as everything else — the module that configures access is itself access-controlled by its own machinery, rather than special-cased outside it. The practical effect is unchanged: only Super Admin can reach them.

**This table is organized by spec module, which is not the same thing as the left-hand sidebar, and the two were deliberately allowed to diverge on 2026-07-30.** Every screen above still belongs to, and is documented under, the module named in its row — that ownership hasn't changed. What changed is purely where the screen sits in navigation:

- **Leave and Payroll now share one sidebar tab, "Leave & Payroll."** Two spec modules, one nav entry — the same relationship Customer 360 already has with its eight tabs, just applied at the module level instead of the record level. My Tax Declarations (documented under Employee, §2.15) moved into this tab too, since it feeds directly into Payroll's income-tax calculation and answering "why is my declared amount missing from this month's deduction" is easier when the declaration screen and the payslip sit one click apart.
- **My Tickets (Employee §2.7) now sits under the Ticket tab; My Projects & Tasks (Employee §2.8) now sits under the Project tab.** Both are Operations-flavoured self-service screens that were previously grouped with the rest of Employee's People-group screens; they now sit next to the admin-facing screens for the same subject, on the same reasoning as the Leave & Payroll move — an employee checking a specific ticket's status and a manager working the same ticket's queue are one click apart instead of two different sidebar groups apart.

None of this is a Layer 1 visibility change and none of it touches the Role Permission Matrix, which is still organized by spec module (the table above) rather than by sidebar position — Matrix entries would be far harder to audit against this document if the two reorganized independently every time navigation changed.

---

## 4. Screens

### 4.1 Role Directory

> **Built.** `GET /rbac/roles` (`app/api/v1/rbac_admin.py`), Super Admin only via screen key `rbac.role_directory`. Returns exactly the columns below — Role Name, People Count (enabled users holding the role), Override Count (active per-person overrides across the role's people) — with the two filters described (`has_overrides`, `people_count_min`/`people_count_max`) and `format=pdf|excel` export following the filter with the standard §2.2(f) header block.

**What it's for:** A summary landing view of the 5 roles before drilling into any one of them.

**Who can open it:** Super Admin only.

**Columns:** Role Name, People Count (how many active users currently hold this role), Override Count (how many individual permission overrides currently exist for people in this role).

**Filters — added in this revision, for completeness with the convention in Section 2.2:** a "has overrides" toggle and a People Count range. A five-row table needs little filtering, and a search box would be theatre — but "which roles have people deviating from the default?" is a real question, and the Override Count column exists precisely because it matters. Export follows the filter, as everywhere.

**Built for a 6th role, without needing one today:** exactly 5 roles exist right now — Super Admin, Employee, Manager, Accountant, HR. The source data confirms only 3 of an originally-intended 5 were built at first (Admin, Manager, Employee), with Accountant and HR added afterward — so this screen (and the data model behind it) treats all 5 as equally first-class, and is built so a 6th role could be added later without restructuring this screen. Actually adding a new role isn't a feature being built now — see the note in Section 5.5 — this is a "ready but not built" architectural point, the same pattern used for Biometric Attendance and Timesheets elsewhere in this CMS, not a button that exists today.

**Row click:** opens the Role Permission Matrix (4.2), pre-selected to that role.

**Buttons:** none beyond navigation — roles themselves aren't created or deleted from this screen.

---

### 4.2 Role Permission Matrix

> **Built.** `GET /rbac/matrix/{role_code}` returns the full matrix for one role — every registered screen grouped by module, each with its mode (Layer 1+4), its real per-screen action toggles (Layer 2), and its sensitive-field modes (Layer 3) — with a `search` parameter matching module and screen names, exactly the search bar below. `PUT /rbac/matrix/{role_code}` saves a **batch of changes in one call** (matching the Save Changes assumption), writes only genuine deltas, records **every individual change as its own before/after entry in the Permission Change Log** (mode changes as L1, action changes as L2, field changes as L3), and takes effect immediately — the resolver reads live rows per request, so there is no separate publish step. Two notes: because Layer 1 visibility and Layer 4 scope are one `mode` field (see §2), a scope change is saved and logged as an L1 mode change — there is no separate scope control in the API; and **"Preview as this role" is BUILT**, approved by APPENDIX-A A112. `GET /me?preview_role=<CODE>` and the `X-Preview-Role` request header both resolve permissions against the previewed role. The security review that gated it is answered: `app/rbac/deps.py` checks the caller's REAL JWT role before `resolver.py` consults the previewed one, so the header is honoured only for a genuine Super Admin and can only ever NARROW. Verified live across all five roles — a non-Super-Admin sending the header gets byte-identical responses to not sending it, with no scope widening and no field unmasking. It is not impersonation: a real Super Admin has no linked Employee row, so a previewed employee-scope narrowing lands on zero rows, never another person's data.

**What it's for:** The core screen — where every toggle from every module actually gets set, for one role at a time.

**Who can open it:** Super Admin only.

**Layout:**

1. A **role selector** at the top — a single-select dropdown of the 5 roles. Assumption: defaults to Employee on first open, the most restrictive role and a sensible starting point for review.
2. A **search bar**, searching both module names and screen names — necessary given the list runs past 60 screens (Section 3), and nobody should have to expand all 13 module sections and scroll through every one to find a specific toggle.
3. Every module listed as a **collapsible section** (Masters, Employee, Asset Management, Ticket, Leave, Payroll, Vendor, Customer, Opportunity, Project, Invoice, Expense, Purchase Bill — the same 13, in the same order, as Section 3), collapsed by default, expanding to show its screens.
4. **For every screen**, once its module section is expanded:
   - A **Visible / Hidden** toggle (Layer 1). This is the only control shown if the screen is currently Hidden.
   - If Visible, the screen's own **action toggles** appear underneath (Layer 2) — the specific action list documented for that exact screen, never a generic one.
   - If the screen has a sensitive field, its **field-level toggle** appears too (Layer 3) — pulled from the compiled list in Section 2.1.
   - If the screen has a meaningful scope dimension, a **scope selector** appears — All / Team / Own (Layer 4).
   - Not every screen shows all three of the last controls — only the ones that actually apply to that specific screen, per Section 2's note that these layers aren't forced onto screens where they wouldn't mean anything.

**"Preview as this role" button:** Assumption — a genuinely useful addition, flagged as a suggestion rather than a stated requirement, but a strong one for a system this configurable. Lets Super Admin see the app exactly as the selected role would, given the currently *saved* settings (not unsaved draft changes still open on this screen), without needing a second test account to log in as. See Section 6 for how this needs to be visually unmistakable as preview mode.

**Buttons:** Save Changes, Discard Changes — Assumption: toggles on this screen accumulate as pending edits rather than saving instantly one at a time, given how many could plausibly change in one sitting; a single explicit Save commits all of them together. Preview as this role (see above).

**Empty state (search):** "No screens match your search."

---

### 4.3 Individual Permission Overrides

> **Built.** One endpoint serves both views described below: `GET /rbac/overrides` with `user_id` is the per-person view; **omitting `user_id` is the company-wide cross-person view** — the "who has an override on Salary Structure?" question is answerable exactly as this section demanded, filterable by role, module, screen, layer, changed-by, and date range, with `format=pdf|excel` export. `GET /rbac/users/{user_id}/role-default` returns the Role Default Summary (the person's role's full current matrix). `POST /rbac/overrides` creates an override — validating that the layer genuinely exists on that screen (an L2 action must be a real action, an L3 field a real sensitive field, L4 only on screens with a scope dimension) and **requiring a reason** — and `DELETE /rbac/overrides/{override_id}` removes one. Both write a Permission Change Log entry, and both take effect immediately on the person's next request. This per-person override is the live runtime escape hatch for everything the named toggles of §2.1 describe (see the note there).

**What it's for:** Where a specific person — not a role — gets extra permission, or has one taken away, without touching anyone else who shares their role.

**Who can open it:** Super Admin only.

**Layout:**

1. A **person picker** — search/select from active employees (Employee module, Module 2). Assumption: only one person is worked on at a time, rather than a bulk multi-person editor, since overrides are inherently individual by definition.
2. **Role Default Summary** — a read-only reference showing that person's role's current default permissions (from 4.2), so Super Admin can see the baseline before changing anything on top of it.
3. **Active Overrides list** — every override currently applied to this specific person: Module, Screen, Permission Changed (which layer — Visibility/Action/Field/Scope — and which specific one), Granted or Revoked, Changed By, Date. Each row is clearly marked as **"different from role default"** (Section 6) so nobody mistakes an override for how the role normally works.

   **Filters on this list — added in this revision:** Module, Screen, Permission Layer, Grant vs. Revoke, Changed By, and Date range. Plus the baseline set and filter-based export, per Section 2.2. A person accumulating overrides across several modules over a couple of years produces a list nobody can read at a glance, and reviewing "everything granted to this person, ever" is a periodic access-review task, not a one-off.

   **A company-wide overrides view — added in this revision, and it's a real gap rather than a filter tweak.** This screen only ever shows one person's overrides, because it starts with a person picker. There was no way to answer "who in the company has an override on Salary Structure?" — the single most important question in access review, and the one this module exists to make answerable. A second view lists every override across every person: Person, Role, Module, Screen, Permission, Grant/Revoke, Changed By, Date, filterable on all of those, with export. The Role Directory's Override Count column now links into it, pre-filtered to that role.

**"+ Add Override" form:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Module | Dropdown | Y | From the 13 modules in Section 3 |
| Screen | Dropdown, filtered to the selected Module | Y | — |
| Permission | Dropdown, filtered to what that screen actually has (a Layer 1 visibility flip, a specific Layer 2 action, a specific Layer 3 field, or the Layer 4 scope) | Y | Only shows options that genuinely exist on that screen, matching Section 2's note that not every layer applies everywhere |
| Grant or Revoke | Choice | Y | Whether this override adds something the person's role default doesn't have, or removes something it does |

**Buttons:** + Add Override, Remove Override (per row in the Active Overrides list), Save.

**Empty state:** "No overrides for this person — they follow their role's default permissions exactly."

---

### 4.4 Permission Change Log

> **Built — and immutable at the database level.** `GET /rbac/change-log` returns every entry — date/time, changed by, target (role or person), module, screen, layer, and full before/after values — with filters for date range, changed-by, target role, target person, module, and layer, a `search` across permission and target names, and `format=pdf|excel` export with the standard header block. The read-only promise below is not merely an API choice: `permission_change_log` carries **MySQL triggers that reject UPDATE and DELETE outright** (`alembic/versions/0001_platform_core.py` — `trg_pcl_reject_update` / `trg_pcl_reject_delete`, mirrored by grant-level revocation in production), so the trail is append-only regardless of what any application code, present or future, attempts.

**What it's for:** An audit trail of every permission change made in this module — not explicitly requested in the source data, but worth including deliberately: this module controls who can see salary data, financial records, and customer information, and changes to those controls should be traceable. Flagged the same way other sensible additions have been throughout this documentation series — worth building, and it **was** built, not trimmed (see the status note above).

**Who can open it:** Super Admin only.

**Columns:** Date/Time, Changed By, Target (a Role name, or a specific person's name if it was an override), Permission Changed (Module, Screen, and which layer), Old Value, New Value.

**Filters:** Assumption — Date Range, Changed By, Target (Role vs. Person) — plus, added in this revision: Module, Screen, Permission Layer (Visibility / Action / Field / Scope), Grant vs. Revoke, and a specific-person or specific-role picker. Search covers the permission name and target name. Plus the baseline set from the Filter & Export Convention (Section 2.2 of this module).

**This screen is the one place in the CMS where filtering is the whole point.** An audit trail nobody can query is a log file, not an audit trail — "who granted access to salary data, and when" is the question it exists to answer, and answering it requires filtering by module, permission, and grant/revoke together.

**Export:** "Export to PDF" and "Export to Excel" of the filtered log, with the standard header block naming the filters, count, exporter, and timestamp. This is the export most likely to be handed to someone outside the system entirely — an auditor, or whoever is investigating an incident — which is exactly why it must state its own filters on its face.

**Read-only** — nothing on this screen is editable; it's a record of what already happened, not a place to make new changes.

**Empty state:** "No permission changes recorded yet."

---

## 5. Workflows

> **Build status:** workflows 5.1–5.4 are fully supported by the built endpoints (§4.2's matrix GET/PUT and §4.3's override create/remove); every save takes effect on the affected users' very next request, with no separate publish or re-login step. The in-use warning in 5.3 step 2 is frontend behaviour, deferred to the Angular build. 5.5 remains a design goal, not a feature.

### 5.1 Granting Employee Visibility into a Manager-Only Screen

> **This example previously used Payroll's Team Payslips screen** — a Manager-only view Super Admin could widen to Employee, with a shared field-level toggle deciding whether the amount showed alongside status. That screen has since been removed entirely, from both Payroll (Module 6, Section 6) and Employee (Module 2, Section 6.1), so the example below uses Leave Approvals instead. The mechanism it demonstrates — a screen-level Visibility toggle plus, where one exists, a field-level toggle underneath it — is unchanged.

1. Super Admin opens the Role Permission Matrix (4.2) and selects Employee from the role selector.
2. They search for or expand Leave, and find **Leave Approvals** — normally Manager/HR/Super Admin only, hidden from Employee.
3. They switch its Visibility toggle from Hidden to Visible.
4. If the screen carries any field-level toggles of its own, they decide those the same way — on this particular screen there are none, so this step is skipped.
5. They click Save Changes. Every Employee now sees this screen.

### 5.2 Granting Employee Access into a Module They Normally Can't See at All

1. Same screen, Employee still selected. Super Admin expands the Customer module — currently entirely Hidden for Employee, screen by screen.
2. They turn on Visibility for Customer Directory and Customer 360.
3. They set the scope — every customer, or only ones tied to the employee's assigned projects (a Team/Own-equivalent restriction for a module that doesn't otherwise have a personal ownership concept for Employee).
4. Save Changes. Employee now has a working, scoped view into a module that previously didn't exist for them at all.

### 5.3 Hiding a Screen a Role Currently Has

1. The reverse of the above: Super Admin selects a role, finds a currently-Visible screen, and switches its toggle to Hidden.
2. If people in that role are actively using the screen, a warning appears before the change is saved (Section 6) — this isn't a silent removal.
3. Save Changes. The screen disappears from that role's navigation going forward.

### 5.4 Overriding One Specific Person

1. Super Admin opens Individual Permission Overrides (4.3) and searches for one specific Employee.
2. They click **+ Add Override**, pick the Module, Screen, and specific Permission, and choose Grant.
3. Save. That one person now has access their role's default doesn't grant — clearly marked as an override on their own record, and on nobody else's.

### 5.5 Adding a 6th Role in the Future

Not something being built now — a design goal for how this module is architected. The Role Directory (4.1) and the underlying data model behind the Role Permission Matrix are built so a 6th role could be added without restructuring either screen, the same "ready but not built" treatment given to Biometric Attendance and Timesheets elsewhere in this CMS. There's no "Add Role" button or flow documented here, because there isn't one yet.

## 6. UI/UX Notes

- **The Role Permission Matrix needs a search bar and collapsible module sections** — 60+ screens in one flat list isn't usable, and forcing Super Admin to expand all 13 modules just to find one toggle defeats the point of the search bar existing at all.
- **A clear, consistent visual difference between "role default" and "person-specific override"** everywhere both appear — on the Matrix itself (once a person's overrides start diverging from their role), and especially on Individual Permission Overrides (4.3), where every override row is explicitly marked as different from the default, not blended in as if it were normal.
- **Toggling a screen to Hidden for a role that currently has people using it should show a warning, not fail silently** — Super Admin should know, before saving, that real people currently rely on what's about to disappear for them.
- **"Preview as this role" is unmistakably marked as preview mode** — a persistent banner or border, so nobody forgets they're previewing a role and accidentally edits real data while looking at it through someone else's eyes. *Status: built. The switcher shipped first and the marking was missed — an audit found preview mode indicated only by a small topbar pill styled identically to the passive "Viewing as" label it replaced. `app-shell.component.ts` now renders both forms A112 allows: a persistent banner above the topbar naming the previewed role with an Exit control, and an inset border around the whole shell.*

## 7. Connected To / Depends on Masters

Connected To: Every other module in the system — this is the control layer, not a peer module

Depends on Masters: None — if anything, the relationship runs the other way: every other module depends on RBAC, RBAC depends on nothing

Needs: Employees, to have people to assign roles and overrides to; and, practically, the screen inventory (Section 3), to know what it's controlling access to

## 8. Role-Based Access

- **Employee, Manager, Accountant, HR** — no access whatsoever. Not read-only, not partial — this module doesn't exist for them.
- **Super Admin** — full access; the only role that can ever touch this module.

Cross-checked directly against the source spreadsheet's Roles & Access row: Super Admin = All, Employee = NA, Manager = NA, Accountant = NA, HR = NA. This matches exactly, and the raw source text independently confirms this document's own framing — it literally lists "Design roles: Admin, Manager, Accounts/Finance, HR, Staff/Employee (built today: Admin, Manager, Employee)," matching the "3 of 5 intended roles were originally built" note given at the top of this document precisely.

**One toggle, for consistency with every other module's documentation** — closer to a formality than a real requirement, given how locked-down this module is by design:

- **"Give HR Read-Only Access to the Permission Matrix"** — OFF by default: HR has no access to this module at all, matching the source data. Turned ON: HR can view (not edit) the current permission matrix and Permission Change Log — useful for compliance/audit purposes, without granting any change rights. *Status: not built as a named toggle (no named-toggle runtime exists — see §2.1's build note). The seed grants the four `rbac.*` screens to Super Admin only. The capability is nonetheless reachable today: because the RBAC screens sit in the registry like any other, Super Admin could set HR's mode on `rbac.permission_matrix` / `rbac.change_log` to `view` through the Matrix itself, and `edit` would still be denied.*

**Per-person overrides:** notably, this is the one module where the per-person override mechanism used everywhere else doesn't apply to itself in the usual way — Super Admin can't be "overridden," since Super Admin already has full access, and no other role gets individual exceptions into a module that's entirely closed to their role by design. The override mechanism this module *implements* (Section 2, Section 4.3) is a different thing from whether this module can itself be selectively opened for one person — it can't, beyond the single HR-wide toggle above.

## 9. Assumptions & Points to Confirm

1. **"Preview as this role" reflects saved settings, not unsaved draft changes** — so Super Admin previews what's actually live, not a hypothetical they haven't committed to yet. *Confirmed as built: the resolver reads live permission rows per request (there is no draft state to preview), so a preview always reflects what is actually saved.*
2. **The Matrix saves in a batch** (Save Changes / Discard Changes), not instantly per toggle — given how many toggles could plausibly change in one sitting, an explicit save felt safer than instant-apply for a screen this consequential. *Confirmed as built: `PUT /rbac/matrix/{role_code}` accepts the whole batch in one call; only genuine deltas are written and logged.*
3. **Role selector defaults to Employee** on first opening the Matrix — the most restrictive role, a reasonable starting point; not specified in the brief.
4. **Person Permission Overrides works on one person at a time**, not a bulk editor — overrides are individual by nature, so this wasn't designed for bulk editing.
5. **The compiled toggle table (Section 2.1) is a snapshot** — kept current as of this revision (43 toggles, after two rounds of additions and removals); if any prior document is revised again later with a new or renamed toggle, this table would need updating to match; it isn't independently authoritative over the module documents it was compiled from.
6. **Role Directory and the data model support a 6th role architecturally**, but no "Add Role" screen or flow is designed here — matching the brief's explicit instruction that this is a design goal, not something to build out now.
7. **Confirmed against Sheet1** — the Roles & Access row matches this brief's Role-Based Access exactly, and independently validates the "3 of 5 intended roles were originally built" framing given at the top of this document, straight from the raw source text.
8. **This revision (major update):** every one of the other 13 modules was revised in this pass, per your explicit direction to resolve open items rather than leave them flagged. This document has been updated to match all of it:
    - **Masters grew from 11 to 19 sub-masters** — Service Category, Unit of Measure, Ticket Categories, Customer Status, Customer Source (removed, then restored — see below), Income Tax Slabs (TDS), Asset Categories, Employment Type, and a Credit Note numbering entry. Section 3's Screen Inventory reflects this. Masters went to 19 after Customer Source was removed entirely on 2026-07-30 and Work Week & Hours was added the same day (net zero on the count, but a different sub-master), then **Customer Source was restored on 2026-07-31, bringing Masters to 20.**
    - **Leave's Team Leave Calendar was removed entirely** — not narrowed, removed. Section 3 no longer lists it; the "Show Team Leave Calendar to Accountant" toggle is gone from Section 2.1.
    - **Rejection now requires a reason everywhere**, no exceptions — the Leave and Expense toggles that used to make this optional are gone from Section 2.1, since there's no longer a default to toggle away from.
    - **Three genuinely new screens exist**: My Tax Declarations (Employee, 2.15), Credit Note (Invoice, 2.5), and Milestones & Timesheets went from "planned" to fully built (Project, 2.8). All three are in Section 3's inventory and contributed new toggles or notes to Section 2.1 where relevant.
    - **The system-wide export convention (Section 2.2) is new** — it did not exist before this revision, even though other modules had already started referencing it. Every module's "per the system-wide export convention (RBAC, Module 14)" cross-reference now points at real content.
    - This document's own Section 2.1 and Section 3 are the two places most likely to drift out of date if any of the other 13 modules change again — worth re-checking both whenever a future revision touches another module's screens, fields, or toggles.
9. **This revision (tax/insurance deep-dive):** exactly the drift predicted in item 8 above happened, and has been corrected. Masters grew again, from 19 to **23 sub-masters** — PF & ESI Rates, Professional Tax Slabs, Old Regime Deduction Limits, and Insurance Plans, all new. Employee gained a new Insurance & Benefits tab on the Master Record. Two new toggles were added (Section 2.1): "Allow Accountant to Edit PF/ESI/Professional Tax Rates in Masters" and "Allow Employee to Change Insurance Plan Mid-Year." This was driven by a real finding, worth stating plainly: PF and Professional Tax rates were previously written as prose ("12%," "state-specific") directly in the Employee module's own documentation, and company-provided insurance didn't exist anywhere in this CMS at all — only an employee's personal insurance declaration for their own tax benefit did. Both are fixed now, and every rate or cap involved is a Masters field, never a number in a document.
10. **This revision (research follow-up, same day):** a second, deeper pass — this time using actual web research rather than domain assumptions — found more real gaps in the same area, not just under-specification. Missing entirely until now: Dearness Allowance, Section 87A tax rebate, Health & Education Cess, EDLI, Gratuity accrual, and Tamil Nadu's Labour Welfare Fund. Also found: a currently-enforcing wage-code rule (Basic + DA ≥ 50% of CTC) that Salary Structure now validates against. The three Masters sub-masters added in item 9 (PF & ESI Rates, Professional Tax Slabs, Income Tax Slabs) were extended with new fields rather than replaced — the toggle in Section 2.1 was renamed accordingly ("Allow Accountant to Edit Statutory Rates in Masters") to cover the broadened scope without needing a second, near-duplicate toggle. ESOPs were researched and deliberately not added, flagged with reasoning in the Employee module rather than either silently built or silently ignored. If Masters or Employee change again in this area, this document's Section 2.1 and Section 3 are, once more, the two places most likely to have drifted.
11. **This revision (correction, same day):** Labour Welfare Fund, added in item 10 above, has been removed again — a good example of why this drift-tracking exists. LWF's roots are in the Factories Act tradition (welfare funds for industrial and daily-wage workers), and it doesn't fit Meshrd's business as a salaried IT/embedded services company; this was confirmed directly rather than assumed from the general research that first surfaced it as "applicable to Tamil Nadu commercial establishments" without checking the fit for this specific company. Removed from Masters (Professional Tax Slabs, Section 3.21), Employee (Salary Structure, Section 2.2), and Payroll (the deduction audit table, Section 5) — each document now records the removal explicitly rather than silently reverting, the same way this document tracks every other correction. EDLI and Gratuity, added in the same research pass as LWF, were reviewed against the same question and kept — both apply broadly to any organized-sector employer with salaried staff, including IT/services companies, not specifically industrial or daily-wage ones.

12. **This revision:** two more removals, and one new feature. Cess and EDLI — both added in the earlier research passes — are removed, per explicit instruction; recorded at each location (Masters, Employee, Payroll) rather than silently reverted, matching how the LWF removal was handled. New: **Ad-hoc Payslip Adjustments** (Payroll, Module 6, Section 2.1a) — Accountant and Super Admin can now add one-off or recurring custom line items to any payslip (a bonus, a recovery, a correction) without a permanent Salary Structure change. Two new toggles cover it (Section 2.1): whether HR also gets this access, and whether adjustment labels stay visible to the employee (transparent by default). Screen 3's Payroll row updated to include it.
13. **This revision:** two more real gaps closed. PF, ESI, and Professional Tax each gained an Applicable toggle (Employee, Section 2.2) — Accountant now has direct edit rights on these three specifically, a narrow exception to Salary Structure otherwise being Super Admin only, since applicability is a compliance fact rather than a pay decision. A new toggle covers whether HR also gets this. Separately, the Offer & Appointment Letter generator — referenced twice in earlier revisions as living "elsewhere in the system" without ever actually having a home, since there's no standalone Documents module in this CMS's 14-module structure — is now built (Employee, Section 2.16), with a real, automatic connection to Ad-hoc Payslip Adjustments so a signing bonus promised at offer stage doesn't need re-entering once the person joins. Screen 3's Employee row updated to include it.

14. **This revision — Masters shrank for the first time, from 23 sub-masters to 19, and this document's drift-tracking is exactly why that was possible to do cleanly.**

    Items 9 through 13 above record five consecutive revisions of churn in one area: four tax sub-masters added, then extended with researched fields, then partially unwound as individual taxes were judged not to fit or were removed on instruction. Each round was carefully documented. Read together, they show a specification maintaining a hardcoded list of taxes that nobody had confirmed applied to this company.

    Per explicit instruction, that list is gone. **Income Tax Slabs (TDS), PF & ESI Rates, Professional Tax Slabs, and Old Regime Deduction Limits have been deleted from Masters.** Taxes (Masters, Section 3.2) is now a single dynamic sub-master where Super Admin — or Accountant, with the toggle — creates each tax head themselves, described by generic behaviour (scope, base, method, slabs, splits, ceilings, thresholds, relief, effective dates) rather than by name. Masters renumbered: Asset Categories 3.18 → 3.17, Employment Type 3.19 → 3.18, Insurance Plans 3.23 → 3.19.

    **What changed in this document specifically:**
    - Section 2.1's "Allow Accountant to Edit Statutory Rates in Masters" toggle renamed to "Allow Accountant to Manage Taxes" and re-scoped to the single sub-master. Toggle count unchanged at 46.
    - Section 2.1's "Allow HR to Edit Statutory Applicability Toggles" reworded — there is no longer a fixed set of three toggles, but one per configured tax head that permits per-employee opt-out.
    - Section 3's Masters row rebuilt: four sub-masters removed, Taxes promoted out of "Simple Configuration Lists" into its own multi-tab screen.

    **The prediction in item 8 — that Masters and Employee are where drift accumulates — held true five revisions running.** It should now hold less often, since adding a tax no longer changes any document. If this area drifts again, the question to ask first is whether something is being written into a specification that should have been a configuration record instead.

15. **This revision — filters on every list screen for every role, Super Admin's superset, and filter-based export, applied across all fourteen modules, per explicit instruction.**

    **What changed here:** Section 2.2 was the system-wide export convention, referenced by every other module. It is now the **Filter & Export Convention**, and covers three things instead of one: which screens count as list screens (now explicitly including self-service screens), the rule that every role gets every filter on a screen it can open, Super Admin's superset, the baseline filter set every list carries, and export behaviour. Every module points here rather than restating it.

    **The rule that needed stating most plainly** is that filters narrow what a role can already see and never widen it — so withholding a filter from a role protects nothing. Role scope is applied *before* filtering, always, which is what makes universal filter access and universal export access safe. Two narrow exceptions exist, both about a filter being meaningless rather than restricted: a dimension where every row already belongs to the viewer, and a filter on a field that role cannot see.

    **The audit across all fourteen modules found more than thin filter sets.** Self-service screens were near-uniformly unfiltered — My Leave, My Documents, My Assets, My Projects & Tasks, Team Payslips, the Leave Approvals queue, the Expense Approvals queue, and the Bugs tracker had none at all. Four genuinely missing screens turned up while auditing and have been added: HR cross-employee views for onboarding and exit (Employee, 2.13/2.14), the Credit Note list (Invoice, 2.5), and a company-wide overrides view in this module (4.3).

    **Two earlier decisions were deliberately narrowed rather than reversed**, and both are recorded at their own locations: Vendor Usage keeps "no totals, no charts" while gaining filters; Project Report keeps "no charts, no trends" while gaining a date range. Filtering a list does not make it a report, and neither original decision was wrong about the thing it was actually protecting.

    **Two filters close holes rather than adding convenience:** "has receipt attached" on Expense Approvals, which was needed for the existing receipt-required RBAC toggle to be actionable at all; and ageing buckets on the Purchase Bill list, which the Invoice list already had — meaning the CMS could show which customers owed money but not which suppliers were owed.

16. **This revision (2026-08-03) — reconciled against the built FastAPI backend.** The doc was audited against the code and updated to match, per the "docs are living source of truth" rule. In summary: the four §4 admin screens are **built** (`app/api/v1/rbac_admin.py`, all Super-Admin-only under module key `rbac`), with immediate-effect saves, per-change before/after logging, and PDF/Excel export on the three list screens; the four-layer engine is live and default-deny (hidden screen → 404, denied action → 403, masking at the serialization boundary, scope before filters); Layer 1 and Layer 4 are one `RolePermission.mode` field, so scope changes are logged as L1; the Permission Change Log is immutable via DB triggers; the screen registry is code (`app/rbac/registry/screens.py`, exactly 81 screens) held in lockstep with `app/seed.py` and the test suite's canonical policy by drift-protection tests; "Preview as this role" is deferred pending a security review; and the `feature_toggles` table exists but is read by nothing — the §2.1 named toggles live on as seed-time defaults with per-person overrides as the runtime escape hatch, an open design tension recorded honestly in §2.1 rather than papered over. The §3 claim that RBAC's own screens sit outside the registry was corrected — they are registered and self-governed. Frontend conventions (§2.2 c-i, §2.3, filter chips, warnings, navigation) are untouched and await the Angular build.

---

**Suggested filename:** `14-rbac-module.md`
