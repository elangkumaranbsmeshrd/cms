# Module 9 of 14: Opportunity

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Opportunity module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Opportunity Pipeline](#21-opportunity-pipeline)
   - 2.2 [Add / Edit Opportunity](#22-add--edit-opportunity)
   - 2.3 [Opportunity Record — Activities & Files](#23-opportunity-record--activities--files)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

An Opportunity is a possible deal with an existing Customer — a project proposal that's still being won or lost. It always belongs to a Customer, moves through a set of stages, and, once won, is what turns into an actual Project and later an Invoice. This module doesn't redesign Customer, Project, or Invoice — it documents the deal itself and links out to the rest.

**Quote — removed entirely on 2026-07-30, on explicit instruction.** An earlier revision of this module carried its own Screen 2.3, a price-quote tab on the Opportunity record with line items, tax, a Quote Number, and a downloadable PDF. It no longer exists. An Opportunity is now just the deal — Title, Customer, Value, Stage, Probability, Expected Close Date, Owner — with no itemized pricing tab attached to it. See Section 5 for what this changes downstream in Invoice.

This module is only about proposed deals with Meshrd's B2B service clients — nothing here relates to Meshrd's retail hardware products.

## 2. Screens

### 2.1 Opportunity Pipeline

**What it's for:** The main list of every deal in progress, with two ways to look at it.

**Who can open it:** Manager, Super Admin. Employee, Accountant, and HR have no access by default — see Section 6 for the toggles that can open narrow exceptions.

**View 1 — Table view.** Columns: Title, Customer, Value, Stage, Probability, Expected Close Date, Owner. **Search — built (A245):** one search box covering Title and Customer name (both the customer's company name and display name, case-insensitive contains), applied server-side on `GET /opportunities` via the `search` parameter. **Sort — partially built:** the API returns rows ordered by Expected Close Date; Value (High → Low) is a frontend column-sort concern, not a server ordering.

**Filters — built** on `GET /opportunities`: Customer, Stage (multi-select), Owner, Financial Year, Value range (`value_min`/`value_max`), Probability range, Expected Close Date range, "overdue — past expected close, still open" toggle (`overdue_only` — excludes Won and Lost), Created On range, Lost Reason (case-insensitive text match within the reason, effectively scoping to Lost deals since only they carry one), and "stale — no activity in N days" (`stale_days` — open deals whose last activity is older than N days, or that have never had one). Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Service Category — deliberately not built.** An earlier revision listed "Service Category (from Masters)" as a filter here, but no such field is defined anywhere on an Opportunity — not in this document's Section 2.2 field table, not in the built schema. A filter can't filter on a field that doesn't exist; the reference was a cross-doc inconsistency, and it is explicitly dropped rather than silently omitted. If a Service Category field is ever added to the Opportunity itself, the filter comes with it.

The two toggles are the pipeline questions with real consequences: deals past their expected close date that nobody has moved, and deals nobody has touched in weeks. A pipeline view that can't surface either is a list of optimistic guesses.

**Filters apply to both views — built, structurally.** The Stage summary is its own endpoint, `GET /opportunities/summary/by-stage` (per-stage count and total ₹ value for all five stages), and it accepts the identical filter set and builds its WHERE clause through the same shared filter-building function as the table's `GET /opportunities` — so the stage counts and ₹ totals at the top of each column always reflect exactly the set the table would show, and the two endpoints cannot drift apart. A summary that silently reports on a different set than the table beside it would be worse than no summary — flagged because it's an easy thing to get wrong when one screen has two views.

**Available to every role that can open this screen.** Where a Manager's pipeline is scoped to opportunities they own, filtering by Owner searches within that set. Super Admin gets the full set plus Created By and Last Modified By — both built as `created_by` / `last_modified_by` parameters on the same endpoints.

**Export — built:** `GET /opportunities?format=pdf` / `?format=excel` exports the filtered set (exactly the rows the JSON list would return) with a header block stating the filters applied. Exported columns: Opportunity Code, Title, Customer, Stage, Value, Probability, Expected Close Date.

**View 2 — Stage summary view.** A standard sales-pipeline visual: one column per Stage (Prospecting, Qualifying, Proposal, Won, Lost), each showing a count and total ₹ value at the top, with individual opportunity cards (Title, Customer, Value) listed underneath. Assumption: cards can be dragged between stage columns to change Stage directly from this view — moving a card into Lost still triggers the same immediate reason prompt described in Section 4, not a shortcut around it.

A view switcher toggles between Table and Stage summary.

**Buttons:** "+ Add Opportunity" (opens 2.2). Row/card click opens the Opportunity Record (2.3), which shows the deal's Details plus its Activities and Files.

**Empty state:** "No opportunities yet."

**Pagination (Table view):** Standard controls, 25 per page by default — a frontend concern: the API returns the full filtered set in one response, and the frontend pages it client-side.

---

### 2.2 Add / Edit Opportunity

**What it's for:** Creating a new deal, or editing one that already exists.

**Who can open it:** Manager, Super Admin.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Title | Text | Y | — |
| Customer | Dropdown (from the Customer module) | Y | — |
| Value | Number (INR) | N | Must be a positive number if provided |
| Stage | Dropdown | Y | Prospecting / Qualifying / Proposal / Won / Lost. Defaults to Prospecting on a new record |
| Probability (%) | Number | N | 0–100 |
| Expected Close Date | Date | N | — |
| Description | Text area | N | — |
| Owner | Dropdown (staff) | N | The salesperson responsible for this deal. Not in the original raw field notes, but included here for the same reason as Customer's Owner field (Module 8) — the Pipeline filters by Owner, so the field has to exist for that filter to mean anything |

**Opportunity Code:** auto-generated on save, format OPP-\<Financial Year\>-\<4-digit number\>, e.g. OPP-2026-0001 — already defined in the Masters module's Number Prefixes table (Section 3.6e), nothing new needed there.

**Marking a deal Lost — a required reason, not optional:** the moment Stage is changed to Lost, a prompt appears immediately asking for a **Reason** (text, required) before the change can be saved — see Section 4 for why this can't be deferred to a later step. **Enforced server-side:** the update endpoint rejects a save with Stage = Lost and no non-blank reason (422), so the immediate prompt can't be bypassed by any client. Conversely, saving a deal with any Stage other than Lost clears any previously stored Lost reason — a deal moved back out of Lost doesn't keep a stale reason attached.

**Probability auto-suggestion — built.** When Stage changes, Probability auto-fills to a suggested value: Prospecting = 10%, Qualifying = 30%, Proposal = 60%, Won = 100%, Lost = 0%. It stays manually editable after auto-filling — the suggestion is a starting point for a specific deal, not a lock, since some deals genuinely are more or less likely than their stage alone would suggest. The lookup is exposed as `GET /opportunities/probability-suggestion?stage=…`, serving the same table the Won trigger uses internally, so the frontend never hardcodes its own copy. **One exception to "manually editable":** when a save moves Stage to Won, the shared Won trigger (Section 3.3) sets Probability to 100% server-side — the one case both Won paths must agree on.

**Stage storage note:** the API stores and exchanges Stage as uppercase codes (PROSPECTING / QUALIFYING / PROPOSAL / WON / LOST); the mixed-case names in this document are display labels.

**Buttons:** Save, Cancel.

---

### 2.3 Opportunity Record — Activities & Files

**What it's for:** The deal's persistent record — Details (read-only, edited via 2.2) plus a chronological Activities timeline and a Files list, the same shape Customer 360 (Module 8, Section 2.3) uses for the same reason: a deal accumulates calls, emails, meetings, and documents over weeks or months, and none of that has anywhere to live on the Add/Edit form (2.2) or the Pipeline (2.1). **Added on 2026-07-30**, on explicit instruction, using an existing example (Customer's Activities tab) as the pattern to follow.

**Who can open it:** Same access as the rest of this module — Manager, Super Admin.

**Header:** Opportunity Code, Title, Customer, Owner, Expected Close Date, Stage — plus Value, Probability, and Expected Close Date shown persistently at the top regardless of which tab is open, the same treatment Customer 360 gives its money figures.

#### Tab: Details

The fields from Add/Edit Opportunity (2.2) shown read-only — Title, Opportunity Code, Customer, Value, Stage, Probability, Expected Close Date, Owner, Description — with an Edit action that opens 2.2.

#### Tab: Activities

A chronological timeline of interactions on this deal — calls, emails, meetings, and notes — shown most recent first, as a timeline, not a plain table (see Section 4).

**"+ Add Activity" form:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Type | Dropdown | Y | Call / Email / Meeting / Note |
| Date | Date | Y | Defaults to today, can be backdated to log something that already happened |
| Description | Text area | Y | — |
| Related Contact | Dropdown (from the linked Customer's Contacts tab, Module 8, Section 2.3) | N | Which person at the customer this activity was with, if applicable |

Each entry on the timeline shows Type (icon or badge), Date, Logged By (the user who added it, auto-filled, not editable), Related Contact (if set), and Description.

**Built** as `GET`/`POST /opportunities/{id}/activities`. Type is validated against Call / Email / Meeting / Note; Date defaults to today when omitted and can be backdated; Logged By is set server-side from the authenticated user. The list comes back most recent first (activity date, then creation time). Logging an activity also stamps the deal's last-activity timestamp — this is exactly what the Pipeline's "stale — no activity in N days" filter (2.1) measures. Activities are append-only: there is no edit or delete endpoint, so the timeline is a permanent record.

**Empty state:** "No activities logged yet."

#### Tab: Files

Uploaded documents against this deal — proposals, pricing worksheets, discovery notes, and similar.

| Column | Notes |
|---|---|
| File Name | — |
| Uploaded By | — |
| Uploaded On | dd-mm-yyyy |
| Size | — |
| Actions | View/Download, Delete |

**"+ Upload File"** button — **built as PDF/JPG/PNG/DOCX/XLSX, up to 10 MB**, corrected from the 5 MB / no-XLSX convention an earlier revision stated: the built file service defines the `opportunity_file` category with the Office formats and a 10 MB cap, a deliberate step up from the 5 MB used for Ticket and Employee attachments, because pricing worksheets live here. Files upload through the CMS's central stored-files service and are then attached to the deal via `POST /opportunities/{id}/files` (which records the stored file's id); `GET /opportunities/{id}/files` lists them and `DELETE /opportunities/{id}/files/{file_id}` detaches one. File Name, Uploaded By, Uploaded On, and Size come from the central stored-files record.

**Empty state:** "No files uploaded yet."

**Buttons on the record:** Edit (opens 2.2), Create Invoice (from a Won deal — Section 3.4), Export PDF. **Export PDF of a single Opportunity record — deferred:** no per-record export endpoint exists in the backend (only the Pipeline's filtered-list export, 2.1); it stays documented as intended but unbuilt until a record-level PDF is actually needed.

---

## 3. Workflows

### 3.1 Creating an Opportunity and Moving It Through Stages

1. Manager or Super Admin opens the Pipeline (2.1) and clicks **+ Add Opportunity**, selecting an existing Customer and filling in Title and whatever else is known.
2. The system generates the Opportunity Code (e.g. OPP-2026-0001) and opens the Opportunity Record (2.3) for the new deal.
3. As the deal progresses, Stage is updated — Prospecting → Qualifying → Proposal → Won — either from the Add/Edit form (2.2) or by dragging the card between columns in the Stage summary view (2.1). Along the way, calls, emails, and meetings are logged on the Activities tab (2.3), and documents like proposals or pricing worksheets go on the Files tab (2.3) — so a deal several weeks old isn't just a bare title and a stage tag by the time it's reviewed.

### 3.2 Marking an Opportunity Lost

1. From either the Add/Edit form (2.2) or the Stage summary view (2.1), Stage is changed to Lost.
2. A reason prompt appears immediately — not a separate step later, not something that only surfaces at save time.
3. A Reason is entered and the change is saved. The card moves into the Lost column in Stage summary view, and the deal is excluded from active pipeline totals going forward.

### 3.3 The Won Trigger — Both Directions

This needs documenting precisely, because there are two separate paths to the same outcome, and each module needs to work correctly whether or not the other one already happened.

**Path A — directly, from this module.** Manager or Super Admin changes Stage to Won on the Opportunity record (2.2) or by dragging its card into the Won column (2.1). No reason is required for Won, unlike Lost. This is a plain, direct user action.

**Path B — automatically, as a side effect of Project creation.** When someone creates a new Project (Project module, not yet documented) and picks "Customer → Opportunity from that customer" as its origin, the Project module sets that Opportunity's Stage to Won automatically, as part of creating the Project — the user never has to separately come back to this module and change it by hand.

**What this means for both modules:** this document doesn't assume Path A is the only way in — the underlying "mark this Opportunity Won" action needs to be triggerable both by a direct user action here and by an automatic call from the Project module. When the Project module is documented, it needs to explicitly implement its half of Path B (calling this action when a project is created from a won-in-progress opportunity) — this document flags the requirement now so that later document doesn't miss it, and so this module doesn't assume every Won opportunity was set that way by a person clicking a dropdown here.

**Built exactly this way:** the "mark this Opportunity Won" action is a single shared function (`mark_opportunity_won` in `app/services/opportunity_engine.py`) called from both places — the Opportunity update endpoint when a save moves Stage to Won (Path A), and the Project module's create *and* update endpoints when an Opportunity is picked as a Project's origin (Path B) — so neither path can drift from the other. It sets Stage to Won and Probability to 100%, and is a silent no-op when the Opportunity is already Won, so creating a Project from an already-won deal changes nothing on it. No reason is required for Won, unlike Lost.

### 3.4 Starting an Invoice from a Won Opportunity

1. From a Won Opportunity's record (2.3), the **Create Invoice** button starts a new Invoice, pulling in the Opportunity's Title and Value as a starting point — Title becomes a single starting line item description, Value becomes its Rate at Quantity 1, the same fallback Invoice (Module 11, Section 2.3) uses when starting from a Project. **This changed on 2026-07-30**: an earlier revision pulled full itemized line items across from the Opportunity's own Quote tab; with Quote removed, an Opportunity has no line items of its own to pull, so it now behaves exactly like the Project-origin case.
2. Everything past that point — invoice line items, tax, payment tracking — is the Invoice module's own concern, documented separately.
3. **How this is built:** there is no dedicated Opportunity-side endpoint for it. Create Invoice is a frontend pre-fill — the button opens the Invoice module's standard create flow (Module 11) with one line item pre-filled from the deal's Title and Value; the Invoice module's ordinary create endpoint does the rest. With Quote removed, an Opportunity has no line items of its own, so a single starting line is the only thing there is to pass.

## 4. UI/UX Notes

- **Stage summary view should feel like a sales pipeline at a glance** — count and total value per stage, prominent at the top of each column, not just a filtered list dressed up to look like one.
- **Stage shown as a colored tag** throughout — Table view, Stage summary cards, and the Opportunity record header. Assumption on convention: Prospecting = grey, Qualifying = blue, Proposal = amber, Won = green, Lost = red.
- **The Lost-reason prompt appears immediately** the moment Stage is changed to Lost — not a separate step, not something that can be bypassed by saving first and adding a reason later. If Stage is changed via drag-and-drop in Stage summary view, the same immediate prompt applies there too.
- **The Activities timeline (2.3) uses the same visual treatment as Customer's** — a colored icon per Type (Call, Email, Meeting, Note), most recent first, not a plain table. Keeping the two identical means a person who's used one already knows how to read the other.

## 5. Connected To / Depends on Masters

Connected To: Customer (also for the Related Contact dropdown on an Activity, Module 8, Section 2.3), Project (created from a won opportunity), Invoice (started from a won opportunity)

Owns: Budget (the deal value), Activities and Files on the deal (2.3)

Depends on Masters: Financial Year, Company Profile (for the Opportunity Code prefix)

Needs: An existing Customer record

**Confirmed already correctly set up in Masters:** the code this module needs — Opportunity Code — already exists in Company Profile's Number Prefixes table (Masters, Section 3.6e). No new Masters gap this time, unlike Ticket's Category field or Customer's Status field.

**Quotation Number — orphaned by the Quote removal, kept in Masters rather than deleted.** Company Profile's Number Prefixes table still carries a Quotation Number entry (QUO-\<Financial Year\>-\<4-digit number\>). Nothing in this module generates one any more. It is left in Masters rather than removed, in case a quoting feature is reintroduced later and needs its numbering series to already exist and start from where it would have. Taxes (Section 3.2, Sales/Billing scope) is no longer a dependency of this module — it was only ever read by the Quote tab, which no longer exists here; Invoice (Module 11) still reads it directly for its own tax line.

## 6. Role-Based Access

- **Employee** — no access. The source spreadsheet leaves this cell blank rather than marking it explicitly "NA" — treated as NA here, consistent with how the Customer module (Module 8) handles the same kind of non-personal sales data, rather than inventing an access level that isn't actually there.
- **Manager** — full access: add, edit, and manage every opportunity.
- **Accountant** — no access by default.
- **HR** — no access. Opportunities aren't an HR concern.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Opportunity row: Super Admin = All, Employee = (blank cell), Manager = All, Accountant = NA, HR = NA. This matches the brief exactly, including the precise distinction between a genuinely blank cell and an explicit NA.

**On "what does Manager mean" here:** this is now the fifth module in a row where the question applies (Ticket, Payroll, Vendor, Customer, and now Opportunity). Same resolution as Customer and Vendor: Manager's broad, company-wide access is kept exactly as the source sheet gives it, since sales-pipeline data doesn't carry the personal-privacy weight that made Payroll's case different. The pattern continues to hold: broad Manager access only gets defaulted down where the underlying data is personal.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Restrict Manager to Only Their Own Opportunities"** — OFF by default: Manager sees every deal, matching the source sheet. Turned ON: Manager only sees opportunities where they're the assigned Owner.
- **"Give Accountant Read Access to Pipeline Value"** — OFF by default: Accountant has no access to this module. Turned ON: Accountant can see a read-only summary of total pipeline value by stage, useful for revenue forecasting.
- **"Allow Employee to View the Opportunity Behind Their Assigned Project"** — OFF by default: Employee has no Opportunity module access at all. Turned ON: an employee staffed on a project can see the deal it came from, for context on what was promised to the customer.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Search fields on the Pipeline Table view — resolved and built (A245):** Title and Customer name, both matched server-side (the customer match covers company name and display name). No longer an open assumption.
2. **Drag-and-drop between Stage columns** in Stage summary view — added as a natural interaction for a pipeline board; not explicitly requested, and the same Lost-reason rule applies to it as to the dropdown.
3. **Probability auto-suggestion by Stage — implemented**, per your explicit direction to resolve open design options. See Section 2.2.
4. **Quote — removed entirely on 2026-07-30, on explicit instruction.** The whole screen (line items, Tax, Quote Number, Download) that used to sit at Section 2.3 is gone, along with the four items that used to sit here about it — one quote per opportunity with no versioning, tax defaulting to Company Profile's Default Billing Tax, and so on. None of that is a live question any more because the feature it was about no longer exists. **Section number 2.3 was reused the same day** for the unrelated Opportunity Record (Activities & Files, item 7 below) — the two features are not connected, the number just became free. The Quotation Number entry in Masters' Number Prefixes table is left in place unused, in case a quoting feature returns later — see Section 5.
5. **"Create Invoice" action from a won Opportunity — resolved, then adjusted for the Quote removal.** The Invoice module (Module 11) is now documented; Opportunity's Title and Value pass across as a single starting line item on a new invoice (Invoice, Section 2.3, "Create from a won deal/project") — the same fallback used for a Project-origin invoice, since Quote no longer supplies itemized lines to pull instead.
6. **The Won trigger's two paths — confirmed implemented on both sides.** The Project module (Module 10, Section 2.2) is now documented and implements its half of the automatic trigger exactly as flagged here — picking an Opportunity while creating a Project auto-sets it to Won if it isn't already.
7. **Confirmed against Sheet1** — the Opportunity row matches this brief's Role-Based Access exactly, including the blank-vs-NA distinction for Employee, and confirms Opportunity Code is already correctly set up in Masters.
8. **Export and filters confirmed and built** on the Opportunity Pipeline (2.1), per the system-wide convention (RBAC, Module 14, Section 2.2) — `format=pdf|excel` on the list endpoint, exporting exactly the filtered set with a filters-applied header block.
9. **Opportunity Record — Activities & Files, added on 2026-07-30, on explicit instruction.** A new Section 2.3, built to the same pattern as Customer 360's Activities and Files tabs (Module 8, Section 2.3) — the example given at the time. The Pipeline's row/card click now opens this record instead of the flat Add/Edit form; Add/Edit (2.2) still handles create and field edits, reached from the record's Edit button. This also gives the Pipeline's "stale — no activity in N days" filter (2.1) something real to measure, which it didn't have before this screen existed.

10. **This revision — filter set expanded, applied across both views, with filter-based export, per explicit instruction.** The Pipeline had four filters covering only identity dimensions (Customer, Stage, Owner, Year) and nothing about value, timing, or staleness — which is most of what a pipeline is reviewed for.

    **The most consequential change is not a filter but a rule:** filters now apply to the Stage summary view as well as the Table view, and the stage counts and ₹ totals reflect the filtered set. Previously the document described two views with filters mentioned only on one, which left open the reading that the summary always showed everything. A summary reporting on a different set than the table beside it is a genuine way to mislead someone about pipeline health, so it's now stated explicitly rather than left to inference. **Built as stated** — the summary endpoint shares its filter-building code with the list endpoint (Section 2.1), with one exception from the expanded set: the Service Category filter was never built, because no Service Category field exists on an Opportunity anywhere — the reference was a cross-doc inconsistency, called out and dropped in Section 2.1.

11. **Reconciled against the built backend (2026-08-03).** Everything in Sections 2 and 3 above is marked built, deferred, or corrected against `backend/app/api/v1/opportunities.py` and `app/services/opportunity_engine.py`. The corrections in this pass: file uploads are PDF/JPG/PNG/DOCX/XLSX at 10 MB, not PDF/JPG/PNG/DOCX at 5 MB (2.3, Files); Service Category filter dropped as a cross-doc inconsistency (2.1); per-record Export PDF deferred (2.3); Value column sort and 25-per-page pagination are frontend concerns over a full-set API response (2.1). Additions the code carries beyond the earlier text: the shared summary endpoint, the probability-suggestion endpoint, server-side enforcement of the Lost reason (plus clearing it when a deal leaves Lost), and the Won trigger's server-side 100% probability.

---

**Suggested filename:** `09-opportunity-module.md`
