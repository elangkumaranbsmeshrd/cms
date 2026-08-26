# Module 3 of 14: Asset Management

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Asset Management module.

> **Implementation status (reconciled against the built backend, 2026-08-03):** this module is **built** — `backend/app/api/v1/assets.py` (endpoints), `backend/app/services/asset_engine.py` (depreciation), `backend/app/services/exit_checklist_sync.py` (reclaim-on-exit sync), `backend/app/models/asset.py` + migration 0006 (5 tables: `assets`, `asset_requests`, `asset_maintenance_log`, `asset_assignment_history`, `asset_files`), RBAC screens `asset.directory` / `asset.maintenance` / `asset.requests` / `asset.reports` / `asset.reclaim` plus the Employee module's `employee.my_assets`. Sections below carry **Built** / **Deferred** notes where the code and the original text diverged.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Asset Directory](#21-asset-directory)
   - 2.2 [Add / Edit Asset (Asset Master Record)](#22-add--edit-asset-asset-master-record)
   - 2.3 [Assign / Transfer / Unassign](#23-assign--transfer--unassign)
   - 2.4 [Maintenance & Service Log](#24-maintenance--service-log)
   - 2.5 [Depreciation & Current Value](#25-depreciation--current-value)
   - 2.6 [Asset Requests (Approval Queue)](#26-asset-requests-approval-queue)
   - 2.7 [Asset Reports](#27-asset-reports)
   - 2.8 [Reclaim on Exit](#28-reclaim-on-exit)
   - 2.9 [Download Asset Card / Asset List](#29-download-asset-card--asset-list)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

Asset Management tracks every company-owned physical asset — laptops, equipment, and anything similar — from the day it's purchased to the day it's retired. Confirmed scope: this explicitly includes office furniture and fixtures (tables, chairs, air conditioners, curtains) and staff ID cards, not just IT/electronics — anything Meshrd owns and issues to staff or keeps on its premises belongs in this module, tracked the same way. For each asset it answers four questions at any point in time: who has it right now, what condition it's in, what it's worth today after depreciation, and what's been done to maintain or repair it.

It connects to three other modules without owning any of them: **Employee** (who an asset is assigned to — and an employee's own view of their assigned assets and their repair/damage/return requests already live in the Employee module's My Assets screen, not here), **Vendor** (who an asset was bought from), and **Purchase Bill** (the purchase record behind an asset). This document is the admin, finance, and HR side of the story: adding and managing assets, categories, assignment history, maintenance, depreciation, reporting, and approving the requests employees raise from their side.

This module has nothing to do with Meshrd's retail hardware products — it only tracks assets Meshrd owns and uses internally, never anything sold to a customer.

## 2. Screens

### 2.1 Asset Directory

**What it's for:** The searchable master list of every company-owned asset — the entry point for anyone managing, financing, or tracking assets.

**Who can open it:** Super Admin, Accountant, HR, and Manager (their direct reports' assets only — same scoping pattern as the Employee Directory in the Employee module). Employee does not use this screen at all; their own assigned assets live in the Employee module's My Assets screen.

**Tabs:** None — single table view.

**Columns shown:**

| Column | Notes |
|---|---|
| Asset Tag | Auto-generated code, e.g. AST-2026-0001 |
| Name | Asset Name |
| Category | From Masters → Asset Categories |
| Status | In Use / In Store / Under Repair / Retired-Disposed, shown as a colored tag |
| Assigned To | Employee name, or "Unassigned" |
| Purchase Value | Hidden by default for Manager (see Section 6) |
| Current Value | The depreciated value as of today (see 2.5); hidden by default for Manager, same as Purchase Value |

**Search box:** Searches Asset Tag, Name, and Serial Number.

**Filters (Built, as query parameters on `GET /assets`):** Category (from Masters), Status (In Use / In Store / Under Repair / Retired-Disposed — multi-select), Assigned Employee, Location, Department, Purchase Date range, Order Date range, Warranty Expiry range (the "expiring in 90 days" preset is a frontend shortcut over the built range parameters, not a separate parameter), and Purchase Value range. Search covers Asset Tag, Asset Name, and Serial Number. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Deferred — Condition filter:** the filter list originally included "Condition," but no Fields Table in this document (or any other module doc) ever defined a Condition field on the asset record — a cross-document inconsistency, since a filter can't exist over a field that was never specified. The backend deliberately did **not** build a Condition column or filter. If asset condition tracking is wanted, it's a new field to specify first (Section 2.2), then a filter to follow it.

**Scoping note (Built):** for a Manager (`view_team` scope), the Assigned Employee filter is superseded by the team scoping itself — the list is already restricted to their direct reports' assets, and the code applies the team restriction in place of a free-form Assigned Employee filter for that mode.

**Available to every role that can open this screen.** Manager's Directory is scoped to their direct reports' assets, so a Manager filtering by Location filters within that set — the scoping does the protecting, not the absence of a filter. **One exception applies here, and it is the convention's own example:** the Purchase Value range filter is hidden from Manager whenever the "Show Purchase Value to Manager" flag is off, because the underlying column is hidden. The field's visibility decides; the filter follows.

Super Admin additionally gets Created By, Last Modified By (both stored on every asset record as standard audit fields), and a "show retired/disposed" toggle (frontend shortcut over the built Status multi-select filter).

**Export (Built):** `GET /assets?format=pdf|excel` exports the filtered set with the applied filters listed in the export header. **As built, the export column set is fixed for every caller** — Asset Tag, Name, Category, Status, Assigned To — Purchase Value and Current Value are simply never in the export columns, for any role, so a masked caller can't pull them out through the export path either. (Stricter than the original "a Manager without Purchase Value exports without Purchase Value" — nobody exports value figures from the Directory; value totals live in Asset Reports, 2.7, where masking is enforced.)

**Sort options:** the backend returns the list Name (A→Z); other sort orders (Purchase Date, Current Value — Current Value being computed live, not a DB column) are a frontend concern over the returned set.

**Buttons:**

- **"+ Add Asset"** — opens the Asset Master Record (2.2) in create mode. Visible to Accountant and Super Admin only (see Section 6 — Manager and HR do not add new asset records here).
- **Row-level "View"** — opens the Asset Master Record in read mode.
- **"Download Asset List"** — see Section 2.9.

**Empty state:** "No assets added yet." (or, when a filter is active and returns nothing, "No assets match your filters.")

**Pagination:** Standard controls, 25 per page by default, page-size selector (10/25/50/100).

---

### 2.2 Add / Edit Asset (Asset Master Record)

**What it's for:** The complete record for one company asset — its identity, purchase details, current condition, assignment, depreciation, and supporting files.

**Who can open it:** Accountant and Super Admin can create and fully edit the core and financial fields. HR can open it to change assignment/status through the dedicated actions on the Assignment tab (2.3), not by editing this form directly. Manager can view it, scoped to their direct reports' assets, with Purchase Value/Current Value hidden by default. See Section 6 for the full field-level breakdown — the short version is that different roles can touch different parts of the same record, not all-or-nothing access.

**Record header (shown on every tab):** Asset Tag, Photo/attachment thumbnail if present, Name, Category, Status tag.

**Tabs on this screen:** Details (the fields below), Assignment History (2.3), Maintenance & Service Log (2.4), Depreciation (2.5).

#### Tab: Details

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Asset Tag | Read-only, auto-generated | N/A | Format AST-\<Financial Year\>-\<4-digit number\>, e.g. AST-2026-0001 — this is already defined in the Masters module's Number Prefixes table (Company Profile, part e), so no new setup is needed here |
| Asset Name | Text | Y | 2–100 characters |
| Category | Dropdown | Y | From Masters → Asset Categories. See the note in Section 5 — this list doesn't exist yet in the Masters module and needs to be added |
| Serial Number | Text | N | Unique if provided (two assets shouldn't share a serial number) |
| Order Date | Date | N | When the purchase order was placed with the vendor — distinct from Purchase Date below, since ordering and receiving an asset can happen weeks apart. Must be on or before Purchase Date, if both are provided |
| Purchase Date | Date | Y | Cannot be in the future |
| Purchase Value (INR) | Number | N | Must be a positive number if provided. Assumption: kept optional exactly as given in the brief, but flagging the consequence — depreciation (2.5) can't be calculated without it, so Current Value simply shows "Not available" until this is filled in |
| Useful Life (Years) | Number | Conditional — required if Purchase Value is filled in | Assumption: added because Straight Line depreciation (2.5) can't be calculated without knowing the asset's useful life, and the brief didn't include a field for it |
| Vendor | Dropdown (links to Vendor module) | N | — |
| Warranty Expiry | Date | N | Must be after Purchase Date, if both are provided |
| Location / Branch | Dropdown | N | **Built as recommended:** sourced from the Addresses in Company Profile (Masters, Section 3.6b) — the record stores a `company_addresses` reference, no new master was created. **Edited only via the dedicated location action** (see below), never through the general edit form |
| Department | Dropdown | N | **Built (code-only field, added during implementation):** references the Departments master. Same edit rule as Location/Branch — changed only through the dedicated location action, and filterable on the Directory (2.1) and Reports (2.7) |
| Status | Dropdown, read-only outside of creation | Y | In Use / In Store / Under Repair / Retired-Disposed. Defaults to In Store on a new record, or In Use if Assigned To is set at creation. After creation, this only changes through the Assign / Transfer / Unassign actions (2.3) — not by editing it here — so every status change is captured in Assignment History |
| Assigned To | Dropdown (employees), editable only at creation | N | Same rule as Status: settable when the asset is first added, then read-only here afterward — changes go through 2.3 |
| Depreciation Method | Dropdown | Y | Straight Line is the only option today. The dropdown and the underlying calculation should be built so more methods (e.g. Written Down Value, the common alternative in Indian accounting) can be added later without a rebuild — same "ready but not built" pattern used for Biometric Attendance in the Employee module |
| Notes | Text area | N | — |
| Retired Date / Retirement Reason | Read-only, system-set | N/A | **Built:** set automatically when the asset is retired — via "Mark Retired/Disposed" here (reason required) or via Reclaim on Exit (2.8). Surfaced in the Retired/Disposed report (2.7) |
| Attachments | File upload (multiple) | N | **Built at the storage layer, linking endpoint deferred.** Uploads go through the shared files endpoint (`backend/app/api/v1/files.py`, magic-byte validated against the declared MIME type): purpose `asset_photo` = JPG/PNG up to 5 MB, purpose `asset_file` = PDF/JPG/PNG up to 10 MB. The `asset_files` link table exists in the schema, but no attach/list-attachments endpoint is wired to it yet — deferred until the frontend needs it. (Asset *request* photos, by contrast, are fully wired: `photo_stored_file_id` on the request, purpose `asset_request_photo`, JPG/PNG 5 MB) |

**Field deliberately not built — Condition:** the Directory's original filter list (2.1) mentioned a "Condition" field, but it was never defined in this Fields Table or anywhere else — a cross-document inconsistency. The backend did not invent it; the asset record has no Condition column. See the Deferred note in 2.1.

**Built endpoints for this screen:** `POST /assets` (create — allocates the Asset Tag from the AST number-prefix rule against the current Financial Year; validates Purchase Date not in future, Order Date ≤ Purchase Date, Warranty Expiry > Purchase Date, Useful Life required when Purchase Value is given, Serial Number uniqueness), `GET /assets/{id}`, `PUT /assets/{id}` (Details-tab fields only — the endpoint strips Assigned To, Location, and Department from the payload so they can never change through the general edit), `POST /assets/{id}/retire` (reason required; 409 if already retired; records Retired Date = today), and `PUT /assets/{id}/location` (Location/Branch + Department — see the access note below).

**Who can edit Location/Branch — an access rule the build made precise:** `PUT /assets/{id}/location` sits under the **assign** action (HR + Super Admin, the 2.3 family), not the general **edit** action (Accountant + Super Admin). So **Accountant cannot change Location/Branch or Department through the general edit** — matching Section 6.1, where Assignment & Location is view-only for Accountant.

**Why Status and Assigned To are locked after creation:** if they were freely editable on this form, someone could change who holds an asset without that change ever appearing in Assignment History (2.3) — which defeats the point of keeping that log. Routing every change through the dedicated actions guarantees the history is complete.

**Buttons:** Save (create or update the Details tab), Cancel, "Mark Retired/Disposed" (see the confirm-before-you-go rule in Section 4).

---

### 2.3 Assign / Transfer / Unassign

**What it's for:** The three administrative actions that change who holds an asset, each one logged permanently in that asset's Assignment History.

**Who can open it:** HR and Super Admin perform these actions directly. Accountant can view this tab but not act on it (view-only on physical assignment, per Section 6). Manager can view their direct reports' assignment history but cannot perform any of these three actions themselves — see the note below on how this reconciles with Manager's request-approval role in Section 2.6.

**The three actions, available as buttons on an asset's record:**

- **Assign** — pick an employee and an effective date. Only available when Status is In Store. Sets Status to In Use.
- **Transfer** — move the asset from its current employee (or department/location) to a new one, with a required reason (text). Only available when Status is In Use. Status stays In Use, just under a new Assigned To.
- **Unassign / Return to Store** — the asset comes back with no new assignment. Sets Status to In Store and clears Assigned To.

Each action opens a small form (Employee/new assignment as relevant, Effective Date, Reason for Transfer specifically) and, on save, adds one row to the **Assignment History** tab: Employee, From Date, To Date (filled in automatically when that assignment ends), Action (Assigned / Transferred / Unassigned), Performed By, Reason (if given).

**Built:** `POST /assets/{id}/assign`, `POST /assets/{id}/transfer`, `POST /assets/{id}/unassign` — all under the **assign** action (HR + Super Admin), with the status preconditions enforced server-side (Assign 409s unless In Store; Transfer and Unassign 409 unless In Use), Transfer's reason required, Effective Date optional (defaults to today), and `GET /assets/{id}/assignment-history` for the read-only tab (Manager sees it team-scoped). Every one of these actions — plus create-with-assignment (2.2), retire (2.2), and reclaim (2.8) — also re-syncs the affected employee's exit-checklist outstanding-asset count via `exit_checklist_sync` (see 2.8), so an exit in progress always reflects the true holdings.

**Correcting an inconsistency in the brief:** the Role-Based Access notes describe Manager as approving "transfer... requests," but Screen 2.6 (Asset Requests) only ever lists three request types an employee can raise from the Employee module — Repair, Damage Report, Return — there's no "Transfer" request type anywhere, and Assign/Transfer/Unassign here is explicitly an administrative action performed directly on the asset record, not something raised as a request. Since Manager also "cannot add, edit, or directly reassign assets," there's no path left by which a transfer could reach Manager for approval. This document treats **Transfer as a pure HR/Super Admin administrative action**, and Manager's approval role (2.6) as covering **Repair, Damage, and Return requests only** — matching Screen 2.6 exactly. If you actually want employees or Managers to be able to request a transfer, that's a new request type to add to both the Employee module and Screen 2.6, not something this document invents on its own — flagged in Section 7.

**Assignment History tab (read-only list):**

| Column | Notes |
|---|---|
| Employee | Who held the asset during this period |
| From Date | — |
| To Date | Blank if this is the current assignment |
| Action | Assigned / Transferred / Unassigned |
| Performed By | The HR or Super Admin user who did it |
| Reason | Shown for Transfer actions |

**Empty state:** "No assignment history yet."

---

### 2.4 Maintenance & Service Log

**What it's for:** A record of everything done to service or repair an asset, both on the asset's own record and as a company-wide list for planning upcoming work.

**Who can open it:** Accountant and Super Admin can add and edit entries (Cost is a financial figure, so this sits with the same roles who manage Purchase Value and Depreciation). HR and Manager can view — Manager scoped to their direct reports' assets. Employee has no access, consistent with the rest of this module.

**Tab on the asset record — Maintenance & Service Log:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Date | Date | Y | Cannot be in the future |
| Description | Text area | Y | What was done |
| Cost | Number (INR) | N | Must be a positive number if provided |
| Next Due Date | Date | N | For recurring service (e.g. annual servicing) |
| Serviced By (Vendor) | Dropdown (links to Vendor module) | N | **Built (code-only field, added during implementation):** who performed the service — also a filter on the company-wide list below |
| Status | Read-only, computed per row | N/A | **Built:** Completed (no Next Due Date) / Overdue (Next Due Date in the past) / Upcoming (Next Due Date today or later) — derived live against today's date on every read, never stored, same pattern as Current Value (2.5) |

**"+ Add Maintenance Entry"** opens this small form. Entries created automatically by an approved repair request (2.6) appear here too, marked as system-generated (`is_system_generated` + a link back to the source request), with the same fields filled in from that request.

**Built:** `GET /assets/{id}/maintenance` (per-asset tab — **Manager's team scoping applies here too**: the per-asset log 404s for a Manager unless the asset belongs to a direct report, the same scope check the Directory uses) and `POST /assets/{id}/maintenance` (add an entry, **edit** action = Accountant + Super Admin). **Deferred — editing an existing entry:** the spec said "add and edit entries," but only add is built; there is no update/delete endpoint for a logged maintenance row yet (an append-only service history so far). Cost/Next Due Date on a system-generated entry therefore can't currently be filled in after the fact — flagged as the one gap in this screen.

**Company-wide list screen (separate from the per-asset tab) — Built as `GET /maintenance`:** shows every maintenance entry across every asset the viewer can see (Manager: direct reports' assets only), with columns Asset Tag, Asset Name, Date, Description, Cost, Next Due Date, and Status (Completed / Overdue / Upcoming — derived from Next Due Date against today's date). **Filters (Built):** Category, Location, Asset (specific), Serviced By/Vendor, Service Date range, Next Due Date range, Cost range, and the quick toggles "Overdue only" and "Upcoming only" (these two toggles are what's built for status narrowing — a full three-value Maintenance Status multi-select filter parameter wasn't built separately, since Completed is simply "neither toggle"). Search covers Asset Tag, Asset Name, and Description. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). **Export (Built):** `format=pdf|excel`, following the filter, with columns Asset, Date, Description, Cost, Status.

**Empty state:** "No maintenance logged yet."

---

### 2.5 Depreciation & Current Value

**What it's for:** Shows what an asset is worth today, calculated automatically — not something anyone types in.

**Who can open it:** Same viewing rules as Purchase Value throughout this module: Accountant and Super Admin always see it; HR sees it by default; Manager does not see it by default (toggle-able — see Section 6).

**How the calculation works (Straight Line, the only method available today):**

Current Value = Purchase Value − (Purchase Value ÷ Useful Life in Years × Number of Years Since Purchase Date). **Built — with one deliberate refinement over the original text:** Current Value is **never a stored column**; it is computed live on every read by `backend/app/services/asset_engine.py` (a pure-function service, no DB access). The original "recalculated automatically at the start of each financial year" is satisfied — and exceeded — by computing it fresh as of *today* on every response (years-since-purchase prorated as days ÷ 365.25), rather than by a batch/cron job this codebase deliberately has no infrastructure for. The ₹0 floor is built: the value never goes negative, even for an asset long past its useful life; results are rounded to 2 decimals.

If Purchase Value or Useful Life is missing on the asset's Details tab, Current Value shows "Not available" instead of a number, rather than guessing. (Built exactly so — the API returns the literal string "Not available" in that case. Note the create/edit validation in 2.2 makes Useful Life required whenever Purchase Value is given, so in practice the only "Not available" case is an asset with no Purchase Value at all.)

**Displayed on the record:** Purchase Value, Useful Life, Depreciation Method, Current Value — all read-only here; the only place Purchase Value, Useful Life, or Depreciation Method can be changed is the Details tab (2.2), by Accountant or Super Admin. **The "As of" label is moot as built:** since the value is computed live per read, "as of" is always today — the response schema carries a `value_as_of_fy_label` slot but nothing populates it; a frontend should treat Current Value as as-of-today.

**Forward-compatibility note — Built as specified:** the calculation dispatches through a method-keyed formula table (`STRAIGHT_LINE` → its formula) — adding Written Down Value later is one new formula entry plus a migration widening the DB CHECK on `depreciation_method`, never a restructure of this screen or the engine's callers. Straight Line remains the only value the database accepts today.

---

### 2.6 Asset Requests (Approval Queue)

**What it's for:** Where Repair, Damage, and Return requests raised by employees (from the Employee module's My Assets screen) get reviewed and actioned.

**Who can open it:** Manager (their direct reports' requests) and Super Admin (any request). Accountant and HR do not act on these — repair/damage/return is an operational, team-level concern, not a financial or HR-onboarding one. See the Section 2.3 note above on why Transfer isn't a request type here.

**List columns:** Employee, Asset, Request Type (Repair / Damage Report / Return), Date Raised, Status (Pending / Approved / Rejected), Description (from the employee's original request, per the Employee module's 2.10). A request may also carry a photo (**Built:** `photo_stored_file_id`, uploaded via the shared files endpoint, purpose `asset_request_photo`, JPG/PNG up to 5 MB, magic-byte validated).

**Filters (Built on `GET /asset-requests`):** Status (Pending / Approved / Rejected — multi-select; **the "Completed" status value in the original filter list was never a defined request status anywhere in this document and was not built** — a request only ever ends Approved or Rejected), Request Type, Requester, Approver, Asset Category, and Date Raised range. Search covers Asset Tag, Asset Name, and Description. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2), with export following the filter (**Built:** `format=pdf|excel`, columns Asset / Employee / Type / Status). Available to every role that can open this screen — an Employee's own requests live on `GET /employees/me/asset-requests` (with their own Type/Status/date filters), a Manager's queue is team-scoped automatically.

**Row actions — Approve / Reject:**

- **Approving a Return request** sets the asset's Status to In Store and clears Assigned To — the same effect as the Unassign action in 2.3, just triggered from here instead of typed in directly.
- **Approving a Repair request** sets the asset's Status to Under Repair and automatically creates a Maintenance & Service Log entry (2.4) — Date = today, Description = the employee's original request description, Cost and Next Due Date left blank for Accountant to fill in once known.
- **Approving a Damage Report** doesn't have an automatic status change specified in the brief. Assumption: treat it the same as a Repair approval (Status → Under Repair, Maintenance Log entry created), since a damage report is effectively a repair need with a different label — flagged in Section 7 in case Damage should instead lead somewhere else, like straight to Retired/Disposed for unrepairable damage.
- **Rejecting** any request leaves the asset's Status unchanged and requires a short reason, which is shown back to the employee (per the Employee module's notification system).

**Built:** `POST /asset-requests/{id}/approve` and `POST /asset-requests/{id}/reject` under the **approve** action (Manager team-scoped — approving outside the team is blocked server-side — plus Super Admin), each 409-guarded so only a Pending request can be actioned. All three approval effects above are wired exactly as described (Return → unassign + history row; Repair and Damage Report → Under Repair + a system-generated Maintenance entry linked back to the request). Both outcomes notify the employee in-app **and** send the templated emails `asset_request_approved` / `asset_request_rejected` from Masters → Email Configuration (Section 3.21), sent after the main commit so an email failure can never roll back the approval itself.

**Empty state:** "No pending requests."

---

### 2.7 Asset Reports

**What it's for:** A simple reporting screen — no editing happens here, just filtered summaries.

**Who can open it:** Accountant, HR, Super Admin (company-wide). Manager sees the same reports scoped to their direct reports' assets only, with the same Purchase/Current Value visibility rule as everywhere else in this module (hidden unless the toggle is on).

**Report views (Built — all three come back from one endpoint, `GET /assets/reports/summary`, so the filters genuinely apply to all views simultaneously):**

- **Count and value by Category** — a table: Category, Number of Assets, Total Purchase Value, Total Current Value (Current Value totals computed live per asset, per 2.5). **Value masking is enforced here directly:** a caller whose resolved field mode for Purchase Value isn't "show" gets counts only, no value totals — and because the check reads the *resolved* per-person mode, a per-person "Show Purchase Value" override (Section 6.5) is honored exactly like everywhere else.
- **Warranty or maintenance due soon** — **Built as an actual list, not just a count:** each due-soon asset comes back with its tag, name, the triggering Warranty Expiry and/or earliest in-window Maintenance Next Due Date, plus a total count. The window is configurable per request (`due_soon_days`, default 30).
- **Retired / Disposed assets** — a list of everything with Status = Retired-Disposed, including the dedicated **Retired Date** (built as a real column, set at retirement — not reconstructed from Assignment History), plus a count.

**Filters (Built, apply across all three views):** Category, Location, Department, Status, Assigned Employee, Purchase Date range, and Purchase Value range; Manager gets the whole report team-scoped. (A separate Financial Year filter wasn't built — the Purchase Date range covers the same slice.) Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Every filter applies to all three views simultaneously, so switching view never silently changes the underlying set.

**Export (Built):** `format=pdf|excel` on the same endpoint, filter list in the header. The report's three views have three different row shapes, so the export covers the one genuinely tabular part — **the by-Category breakdown** — with the same value-masking gate as the JSON (a masked caller exports Category + Count only). Per-view export of the due-soon and retired lists is a frontend concern over the returned JSON (both lists are fully present in the response).

**Empty state:** "No data for this filter yet."

---

### 2.8 Reclaim on Exit

**What it's for:** The Asset Management side of an employee leaving — triggered from the Employee module's Offboarding checklist, and feeding back into it once complete.

**Who can open it:** HR and Super Admin.

**How it connects back to the Employee module:** when an employee's Exit Checklist (Employee module, Section 2.13) reaches its "Return all assigned assets" step, this screen shows that employee's currently assigned assets, pulled by matching Assigned To.

**Where this sits in the exit sequence, clarified 2026-07-31.** This step does not open until HR has generated the resignation acceptance letter, because that letter is what fixes the Last Working Day this return is measured against. And the three steps that follow it in the Employee module — final settlement, disabling the login, and setting status to Exited — stay locked until this screen shows a zero outstanding count. That ordering exists because each of those steps removes a means of recovering equipment: once the settlement is marked there is no money left to deduct from, once the login is off the person cannot be reached through the system, and once they are Exited nobody is chasing them. See Employee module, Section 2.13 for the full reasoning.

**List shown:** Asset Tag, Name, Category, Assigned Date (from Assignment History) — every asset currently assigned to the exiting employee.

**Row action — "Mark Returned":** opens a small choice:

- **Returned, working condition** — same effect as Unassign in 2.3 (Status → In Store, Assigned To cleared).
- **Not working / damaged** — Status → Retired-Disposed instead, with a required reason, and a Retired Date recorded as today. This shows the confirm-before-you-go prompt described in Section 4, since it's not reversible from this screen.

**Completion:** once **every** asset for that employee shows as either returned or retired, the "Return all assigned assets" item on the Employee module's Exit Checklist automatically marks itself complete — HR doesn't check that box manually, it reflects this screen's state. There is no partial completion and no manual override: an asset that cannot be physically recovered has to be explicitly marked **Not working / damaged → Retired-Disposed** above, with a reason and a named person behind it, rather than an outstanding item being waved through on the checklist.

**Built:** `GET /employees/{id}/reclaim-assets` (the currently-assigned list) and `POST /assets/{id}/reclaim` under the **mark_returned** action (HR + Super Admin), with the reason required server-side whenever "Not working / damaged" is chosen. The auto-completion is implemented in `backend/app/services/exit_checklist_sync.py`: every assignment-changing action anywhere in this module recounts the employee's In Use assets into the checklist step's outstanding count, and the instant that count reaches zero while the step is Open, the step marks itself Done (with an auto-completion note and the acting user recorded) and unlocks the steps gated behind it — final settlement, login disable, Exited status. The sync is the *only* legitimate way that step ever completes; a DB trigger separately enforces the gate.

**Empty state:** "This employee has no assets currently assigned." — in which case the checklist item completes immediately.

---

### 2.9 Download Asset Card / Asset List

**What it's for:** Two simple downloads, not full designed templates.

**Who can open it:** Same viewing rules as the screen they're downloaded from — Asset Card from an individual asset's record (2.2), Asset List from the Directory (2.1). Manager can download either for their direct reports' assets only, with Purchase/Current Value included only if that toggle is on for them.

**Asset Card (Built as `GET /assets/{id}/pdf`)** — a single-page printable summary with the company letterhead: Asset Tag, Name, Category, Assigned To, Purchase Date. Purchase Value and Current Value are included only for roles that can already see those fields — the PDF reuses the record endpoint's own masking and team-scope check, so it can never show a caller more than the record's JSON already would (a field under "mask" mode prints as "Masked", never as a figure; a hidden field is omitted entirely).

**Asset List (Built)** — the Directory's `format=pdf|excel` export (2.1), exporting whatever the current search/filter has produced. **As built the formats are PDF and Excel, not CSV** — matching the system-wide export convention — and the column set is the fixed Directory five (see the export note in 2.1: value figures are never in it, for anyone).

---

## 3. Workflows

### 3.1 Add a New Asset and Assign It at Purchase or Onboarding Time

1. Accountant or Super Admin opens the Directory (2.1) and clicks **+ Add Asset**.
2. They fill in the Details tab (2.2) — Asset Name, Category, Purchase Date, and as much of the rest as is known (Purchase Value, Useful Life, Vendor, Warranty Expiry, Location).
3. If the asset is being assigned right away (new hire's laptop, for example), they also set Assigned To in this same step. The system sets Status to In Use and writes the first Assignment History (2.3) entry automatically. If not assigned yet, Status defaults to In Store.
4. Saving generates the Asset Tag (e.g. AST-2026-0001).
5. From this point on, any change to who holds the asset goes through Assign / Transfer / Unassign (2.3), not back through this form.

### 3.2 Employee Raises a Repair/Damage/Return Request → Manager Approves → Status and Assignment Update

1. The employee raises the request from the Employee module's My Assets screen (Repair / Damage Report / Return, per that module's 2.10).
2. It appears in the Asset Requests queue (2.6) for their Reporting Manager, and for Super Admin.
3. Manager (or Super Admin) opens it and Approves or Rejects.
4. On Approve: a Return sets the asset In Store and unassigns it; a Repair or Damage Report sets it Under Repair and creates a Maintenance Log entry (2.4) automatically.
5. On Reject: nothing changes on the asset; the employee is notified with the reason.
6. Either way, the employee is notified of the outcome (per the Employee module's notification system).

### 3.3 Transfer an Asset from One Employee to Another

1. HR or Super Admin opens the asset's record and selects **Transfer** (2.3) — only available while Status is In Use.
2. They pick the new employee and enter a reason.
3. The system closes out the previous Assignment History row (sets its To Date) and opens a new one for the new employee. Status stays In Use throughout.
4. Both the previous and new employee can see this reflected — the previous employee no longer sees the asset in their My Assets screen (Employee module); the new employee now does.

### 3.4 Employee Exits → Assets Reclaimed via the Offboarding Checklist → Status Updates

1. The Employee module's Exit Checklist (2.14) reaches "Reclaim assets" for the exiting employee.
2. HR opens Reclaim on Exit (2.8), which lists everything currently assigned to that employee.
3. For each asset, HR clicks **Mark Returned** and chooses Returned (working) or Not Working/Damaged.
4. Returned assets go back to In Store; damaged ones go to Retired-Disposed with a reason and a Retired Date.
5. Once every asset for that employee is resolved, the Exit Checklist's "Reclaim assets" item marks itself complete automatically.

### 3.5 Maintenance Logged Over an Asset's Life

1. Accountant or Super Admin adds a Maintenance & Service Log entry (2.4) directly on an asset's record whenever work is done — Date, Description, Cost, and a Next Due Date if it's recurring.
2. Alternately, an entry is created automatically when a Repair or Damage request is approved (3.2) — same fields, pre-filled from the request.
3. Every entry stays visible on that asset's own Maintenance tab permanently, building a full service history.
4. The company-wide Maintenance list (2.4) surfaces anything overdue or due soon across every asset, and the Asset Reports screen (2.7) can filter for the same thing at a category or location level.

## 4. UI/UX Notes

- **Table view** for the Directory (2.1), the company-wide Maintenance list (2.4), the Asset Requests queue (2.6), and Asset Reports (2.7).
- **Record page with tabs** for an individual asset — Details, Assignment History, Maintenance & Service Log, Depreciation — the same pattern used for the Employee Master Record in the Employee module.
- **Empty states**, matching the tone used elsewhere: "No assets added yet," "No assets in this category yet," "No maintenance logged yet," "No assignment history yet," "No pending requests."
- **Confirm-before-you-go prompt** before marking an asset Retired/Disposed, whether that happens directly on the Details tab (2.2) or through Reclaim on Exit (2.8) — this status has no further action after it, so it needs a deliberate confirmation.
- **Status as a colored tag everywhere** the asset appears — Directory, Asset Card, Reports, the record header — since it's the main thing people scan for. Assumption: In Use = green, In Store = blue/grey, Under Repair = amber/orange, Retired-Disposed = red/dark grey, matching a fairly standard convention.

---

## 5. Connected To / Depends on Masters

Connected To: Employee (assigned to), Vendor (purchased from), Purchase Bill (linked purchase entry), Employee module's My Assets screen and offboarding checklist

Depends on Masters: Asset Categories, Financial Year, Company Profile (for asset code prefix), **Email Configuration (Section 3.21 — the Asset Request Approved/Rejected email templates)**

**Two notes on this, checked against the Masters module (Module 1):**

- **Asset Categories is now built.** The Masters module (Module 1, Section 3.17) resolved this — a Name/Status list, Super Admin-managed, widened to cover office furniture, fixtures, and ID cards, not just IT/electronics, per the confirmed broader scope for this module.
- **The asset code prefix is already correctly set up.** Company Profile's Number Prefixes table (Masters, Section 3.6e) already has an Asset Code entry (AST-2026-0001 style) — nothing new needed there, this document just confirms the connection.
- **Location/Branch** (Section 2.2) — the recommendation to source it from Company Profile's Addresses (Masters, Section 3.6b) was **accepted and built**: the asset record references `company_addresses` directly, so Company Profile serves this module for both the asset-code prefix and Location/Branch. The built record also references the **Departments** master (the code-only Department field, 2.2) and, on maintenance entries, the **Vendor** module (Serviced By, 2.4).

## 6. Role-Based Access

> **Baseline, shared by all four operational roles:** every Manager, Accountant, and HR person is, first, an employee themselves — so their own assigned assets, and their own repair/damage/return requests, show up exactly the same way an Employee's do: through the Employee module's My Assets screen, never through this module. That's identical for all four operational roles and isn't repeated in the breakdown below. This module only ever covers the admin/finance/HR side — other people's assets, not the viewer's own.
>
> Employee gets nothing beyond that baseline: no Directory, no asset records, no reports here. Manager, Accountant, and HR each get specific additional access on top of the same baseline, screen by screen, below.
>
> **Built — value figures on the My Assets baseline view:** on the Employee module's My Assets screen (`GET /employees/me/assets` and `/employees/me/asset-requests`, built in this module's router), **Purchase Value and Current Value are hidden for every role — including Super Admin, Accountant, and HR**. That view is "what do I hold," not a finance screen; a Super Admin who wants an asset's value opens the Directory. This is stricter than the toggle-gated Manager-only hide on the Directory/Reports, and is seeded as an all-five-roles hide on the `employee.my_assets` screen's field masking.

### 6.1 Field-Level Access on the Asset Master Record

The brief's summary — "Accountant add/edit assets," "HR assign at onboarding, reclaim at exit," "Manager view team's assets" — all describe access to the **same** Asset Master Record, just different parts of it. Rather than leave that as an all-or-nothing screen permission, here's the field-level split, matching who is actually responsible for each kind of data in a real company:

| Field Group | Fields | Accountant | HR | Manager | Super Admin |
|---|---|---|---|---|---|
| Core Info | Asset Name, Category, Serial Number, Warranty Expiry, Notes, Attachments | Edit | View | View, own direct reports | Edit |
| Purchase & Financial | Purchase Date, Purchase Value, Useful Life, Vendor, Depreciation Method, Current Value | Edit | View | Hidden by default (toggle-able) | Edit |
| Assignment & Location | Status, Assigned To, Location/Branch | View | Edit, via Assign/Transfer/Unassign (2.3) only | View, own direct reports | Edit |

**Why split this way:** Accountant owns the financial truth of an asset (what it cost, how it depreciates) because that's what accounting and audits need — but has no business changing who physically holds a laptop, so that stays view-only for them. HR owns the human side (who has what, reclaiming it when someone leaves) but has no reason to edit purchase value or depreciation figures, so that's view-only for them, not hidden — HR still needs to see an asset's value for insurance or replacement conversations. Manager gets visibility into their own team's assets to stay informed, but can't edit anything directly — their only actual action in this module is approving or rejecting their team's Repair/Damage/Return requests (2.6), not touching the asset record itself.

### 6.2 Screen-by-Screen Access Table

| Screen | Employee | Manager | Accountant | HR | Super Admin |
|---|---|---|---|---|---|
| 2.1 Asset Directory | No access | View, own direct reports only | View, all assets | View, all assets | Full, all assets |
| 2.2 Asset Master Record | No access | View-only, own direct reports (see 6.1 for field split) | Add + edit Core Info and Purchase & Financial | View Core Info, edit Assignment & Location only via 2.3 | Full |
| 2.3 Assign / Transfer / Unassign | No access | View history, own direct reports; cannot perform any action | View history only | Perform all three actions | Full |
| 2.4 Maintenance & Service Log | No access | View, own direct reports | Add + edit entries | View | Full |
| 2.5 Depreciation & Current Value | No access | Hidden by default (toggle-able) | Full view (read-only, system-computed) | View | Full |
| 2.6 Asset Requests (approval queue) | No access (raises requests from the Employee module instead) | Approve/reject, own direct reports | No access | No access | Approve/reject, any request |
| 2.7 Asset Reports | No access | View, own direct reports, value figures hidden by default | Full, all assets | Full, all assets | Full |
| 2.8 Reclaim on Exit | No access | No access | No access | Full | Full |
| 2.9 Download Asset Card / List | No access | Own direct reports only, value figures included only if toggle is on | Full | Full | Full |

### 6.3 Summary by Role

- **Employee** — no additional access beyond the baseline; their own assigned-assets view and request-raising live in the Employee module.
- **Manager** — view their direct reports' assigned assets and history; approve or reject Repair/Damage/Return requests from their team; cannot add, edit, or directly reassign assets, and cannot see purchase or current value unless that's specifically turned on for them.
- **Accountant** — adds and edits assets, all purchase value and depreciation fields, and full reporting; view-only on physical assignment and location.
- **HR** — assigns assets at onboarding, transfers and reclaims them at exit, sees assignment status for everyone; view-only on purchase and depreciation figures, never edits them.
- **Super Admin** — full access to everything, including the RBAC settings screen itself. (The source brief left Super Admin blank for this module; treated as full access by default, same as every other module, per the brief's own note.)

### 6.4 A Correction Made While Writing This

The brief's role summary describes Manager as approving "transfer... requests," but Screen 2.6 only ever defines three request types an employee can raise (Repair, Damage Report, Return), and Screen 2.3 treats Transfer as a direct administrative action, not something raised as a request — Manager, in fact, "cannot add, edit, or directly reassign assets" in that same sentence, which rules out Manager being the one to initiate a transfer for approval in the first place. This document resolves it as: **Manager approves Repair/Damage/Return requests only** (matching 2.6 exactly), and **Transfer is an HR/Super Admin administrative action** with no approval step. Full reasoning is in Section 2.3. If a "request a transfer" flow is actually wanted, it's a new feature to design (a new request type in both this module and the Employee module), not something implied by what's already specified.

### 6.5 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module.

**Build status of the toggles below:** the second toggle — **"Show Purchase Value to Manager"** — is fully built, as field-level masking (the RBAC Layer-3 pattern) on `purchase_value` + `current_value` for the `asset.directory` and `asset.reports` screens, hidden from Manager by default, one switch governing both figures across Directory, Reports, and the downloads (2.9), and honoring **per-person overrides** everywhere including the Reports value totals and the Asset Card PDF. The other three named toggles ("Allow Manager to Reassign Assets Directly", "Allow HR to Edit Depreciation Method", "Allow HR to Edit Core Info") are **deferred — not modeled as distinct RBAC actions**: the built permission model for this module has exactly the actions `edit`, `assign`, `approve`, and `mark_returned`, and while the generic RBAC admin can re-grant an existing action to another role or person (which approximates "Allow Manager to Reassign" by granting `assign`), the finer-grained splits the last two toggles describe (Depreciation Method alone, Core Info alone) don't exist as separately grantable units yet. They'd each need a new action or field-permission when actually wanted — deferred because nothing in the confirmed scope turns them on.

Concrete examples, specific to this module:

- **"Allow Manager to Reassign Assets Directly"** — OFF by default: Manager can only approve/reject requests (2.6), not reassign directly. Turned ON: Manager gets a direct "Reassign" button on their team's assets, equivalent to the Transfer action in 2.3.
- **"Show Purchase Value to Manager"** — OFF by default: Manager sees status and assignment only, not what an asset cost (this also controls Current Value and the value columns in Reports/Downloads, since they're the same underlying figures). Turned ON: purchase and current value become visible to them.
- **"Allow HR to Edit Depreciation Method"** — OFF by default: only Accountant and Super Admin can change how an asset depreciates. Turned ON: HR gets that field too, alongside their existing Assignment & Location access.
- **"Allow HR to Edit Core Info"** — Assumption, added for symmetry with the toggle above: OFF by default, HR stays view-only on Asset Name/Category/Serial Number/Notes/Attachments as described in 6.1; Turned ON, HR could correct these directly instead of asking Accountant to.

**Per-person overrides:** same mechanism as every other module — Super Admin can grant one specific person extra permission beyond their role (for example, one particular Manager who also handles asset budgeting could get "Show Purchase Value" turned on just for them), without changing the setting for their whole role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Useful Life (Years)** — added to the Details tab (2.2); Straight Line depreciation can't be calculated without it, and the brief's field list didn't include it. **Built** — and validation makes it required whenever Purchase Value is provided.
2. **Purchase Value kept optional**, exactly as given, even though this means Current Value can't always be calculated — shows "Not available" rather than blocking the record from being saved. **Built exactly so.**
3. **Status and Assigned To locked after creation**, only changeable through Assign/Transfer/Unassign (2.3), so every change is captured in Assignment History rather than silently edited on the main form. **Built** — the general edit endpoint strips them (plus Location/Department) from every update.
4. **Location/Branch reuses Company Profile's Addresses** (Masters 3.6b) rather than becoming a new master — **confirmed and built**; a code-only **Department** field was added alongside it (2.2), both editable only through the dedicated location action.
5. **Asset Categories is now built in Masters** (Section 3.17), not left open — confirmed and resolved, no longer an assumption to flag.
13. **Order Date added** to the Details tab (2.2), distinct from Purchase Date, since ordering and receiving can happen weeks apart — not in the original brief, added to reflect real procurement timing. **Built**, with Order Date ≤ Purchase Date enforced, and Order Date range as a Directory filter.
14. **Export and filters confirmed on every list/table screen in this module** — Asset Directory (2.1), the company-wide Maintenance list (2.4), Asset Requests (2.6), and Asset Reports (2.7) each have `format=pdf|excel` export alongside their filters, per the system-wide convention (RBAC, Module 14, Section 2.2). **Built on all four** — see each screen's Built notes for the exact column sets (the Directory export never carries value figures for anyone; the Reports export covers the by-Category view).

15. **This revision — filter sets expanded on all four list screens, for all roles, with filter-based export.** Per explicit instruction that every module carry filters for every role and that export follow the filter. This module was already among the better-covered ones — all four list screens had filters — but they were thin: the Asset Directory had four, and none of the four screens had a date range, a value range, or a warranty/expiry filter, which are the dimensions an asset list is actually searched on. Now expanded, with the all-roles rule made explicit.

    **One case worth calling out**, because it is the convention's own worked example: the Purchase Value range filter on the Asset Directory is hidden from Manager when "Show Purchase Value to Manager" is off. That is not a filter restriction — it is the column being hidden, with the filter following it. Every other filter on that screen is available to every role that can open it, because filters narrow a role's existing scope rather than widening it.
6. **Transfer-as-a-request inconsistency, resolved** — see Section 6.4. Manager approves Repair/Damage/Return only; Transfer stays an HR/Super Admin direct action. **Built exactly so** — the request type validator accepts only Repair / Damage Report / Return.
7. **Damage Report approval behaves like Repair approval** (Status → Under Repair, Maintenance Log entry created) — the brief only specified this automatic behavior for Repair and Return. **Built as assumed**; still worth confirming whether unrepairable damage should instead go straight to Retired/Disposed.
8. **Retired Date** — **built as a real column** (together with a Retirement Reason), set automatically when Status becomes Retired-Disposed, whether from the retire action (2.2) or Reclaim on Exit (2.8), so Asset Reports (2.7) lists "when" something was retired, not just "that" it was.
9. **Warranty/maintenance "due soon" window** — **built**: 30 days by default, adjustable per request (`due_soon_days`), and the report returns the actual due-soon asset list, not just a count.
10. **Attachment file rules** — **built, refined from the assumption**: asset/request *photos* are JPG/PNG up to 5 MB; asset *documents* (purpose `asset_file`) are PDF/JPG/PNG up to 10 MB; all uploads are magic-byte validated against their declared type (`backend/app/api/v1/files.py`). Note the deferred attach-to-asset endpoint in 2.2.
11. **Status tag colors** — proposed in Section 4 (green/blue-grey/amber/red); not specified in the brief. Frontend concern; no backend involvement.
12. **"Allow HR to Edit Core Info" toggle** — added in Section 6.5 for symmetry with the other two toggles given; not explicitly requested. **Deferred along with the other two named toggles** — see the build-status note in 6.5 ("Show Purchase Value to Manager" is the one that's built).
16. **"Condition" — never specified, deliberately not built.** The 2.1 filter list referenced a Condition field that no Fields Table in this or any other module document ever defined — a cross-document inconsistency. The backend has no Condition column; if condition tracking is wanted, it's a new field to specify in 2.2 first (see the explicit notes in 2.1 and 2.2).
17. **Maintenance entries are append-only as built** — no edit/delete endpoint for a logged entry yet (2.4), so a system-generated entry's Cost/Next Due Date can't be filled in after the fact. Deferred; flagged as this module's one functional gap.
13. **Baseline principle sharpened in Section 6** — an updated brief clarified that a Manager, Accountant, or HR person's *own* assigned assets and requests also flow through the Employee module's My Assets screen, not through this module — the same baseline Employee gets, not something unique to Employee. The module's own screens (Directory, Requests queue, Reports, etc.) were already scoped correctly to "other people's assets, admin/finance/HR side only," so this was a wording fix in the framing, not a change to any access table.

---

**Suggested filename:** `03-asset-management-module.md`
