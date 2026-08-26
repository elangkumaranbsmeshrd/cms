# Module 8 of 14: Customer

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Customer module.

**This document supersedes an earlier "Customer Module" specification written at the very start of this documentation project, under a since-abandoned 15-module numbering scheme.** This is the current, authoritative version — built under the present 14-module structure, cross-checked directly against the source spreadsheet, and consistent with every module documented since (the baseline principle, the "what does Manager mean" question, the pattern of flagging open Masters gaps rather than assuming them). If the earlier file is still on hand, it should be treated as retired.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Customer Directory](#21-customer-directory)
   - 2.2 [Add / Edit Customer](#22-add--edit-customer)
   - 2.3 [Customer 360](#23-customer-360)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

**Important distinction, worth stating up front:** "Customer" here means a B2B service client — a company Meshrd does project or consulting work for. It has nothing to do with people who buy Meshrd's own retail hardware products; that's a completely separate system and is never referenced anywhere in this document.

Customer is the CRM core: the client company record, the people who work there, every interaction logged with them, and a live summary of what's been invoiced and what's outstanding. Opportunity, Project, Invoice, and Ticket all point back to a Customer record — this module doesn't redesign any of those, it only shows a rolled-up view and links out to them. Their full specs are documented separately, one module at a time (Ticket already is, in Module 4; Opportunity, Project, and Invoice are still to come).

## 2. Screens

### 2.1 Customer Directory

**What it's for:** The searchable list of every client company on file.

**Build status: BUILT** — `GET /customers` (`backend/app/api/v1/customers.py`, screen key `customer.directory`). The endpoint returns the full customer record per row (after RBAC field masking), so every column below is available to the frontend.

**Who can open it:** Manager, Super Admin. Employee, Accountant, and HR do not open this screen — see Section 6 for what limited exception exists for Accountant elsewhere. As built, this is enforced by the RBAC seed: `customer.directory` = full for Super Admin and Manager, none for Accountant, HR, Employee.

**Columns shown:**

| Column | Notes |
|---|---|
| Company Name | — |
| Status | Prospect / Active / Inactive, shown as a colored tag |
| Owner | The staff member responsible for this account |
| Source | Restored 2026-07-31 — see the note under Section 5. Shown as a chip |
| Customer Bank Account Name | Added 2026-07-31. **The name on the account this customer remits *from***. This is what an unidentified credit on a bank statement is actually matched against — a statement line shows a remitter *name*, not an account number, so without this a payment arriving with no invoice reference cannot be attributed to anyone. It also catches the common case where a group company pays under a different legal name than the one on the invoice |
| Account Number | Masked to the last four digits (e.g. "HDFC ••••9021") — the secondary identifier, distinguishing which of that customer's accounts is on file once the name has established whose it is. As built this masked display value is a database-computed column, `bank_account_number_masked` (bank name + "••••" + last 4). Note: the API also returns the full `bank_account_number` alongside it — the customer's own bank fields (`bank_account_name`, `bank_name`, `bank_account_number`) are customer-relationship data and are **not** masked from Manager; only Collected Into (below) is |
| Collected Into | Added 2026-07-31. Which Meshrd account this customer's payments normally land in, carried from their invoices' Bank Account (Module 11, Section 2.3). Withheld from Manager — it is a company banking detail, not an account-relationship one. As built: `collected_into_bank_account_id`, registered as a sensitive field on `customer.directory` and seeded hidden from Manager via RBAC field masking (the key is absent from Manager's payload, not just null). It is not written from the customer form at all — the Invoice module sets it automatically when an invoice is created with a Bank Account |
| Total Invoiced | ₹, sum across every invoice raised to this customer |
| Outstanding | ₹, Total Invoiced minus Received |

**Both account columns are a reconciliation aid, not a payment instruction.** Nothing in this CMS debits a customer account; these exist so that money arriving in a Meshrd account can be traced back to who sent it and matched to an invoice. Neither is mandatory on the customer record — a prospect who has never paid anything has neither, correctly.

**Filters** gain **Source**, drawn live from Masters → Customer Source (Section 3.16). BUILT — `source_id` query parameter.

**Search box:** BUILT — searches Company Name, Display Name, GSTIN, Mobile Number, and Email (`search` query parameter, substring match across all five), matching the search pattern used across every other directory-style screen in this CMS.

**Filters, as built:** Status (`status_id`, multi-select — fixed 2026-08-05, was single-select), Source (`source_id`), Owner (`owner_id`) — plus the Search box above. **Deferred (described in an earlier revision, not built):** Service Category, City/State, Created On date range, Last Activity date range, Total Outstanding range, the "has open opportunities" toggle, and Super Admin's Created By / Last Modified By / "show inactive customers" extras. Reason: these depend on columns or cross-module lookups the customer record doesn't carry (there is no service-category or city/state field on the record, and no last-activity rollup); they can be added once those fields exist. No new scope is implied by keeping them listed here — they remain deferred until explicitly scheduled.

**Available to every role that can open this screen.** Where Manager's Directory is scoped to customers they own, filtering by Owner there searches within that set — the scoping restricts, not the filter list. (The "Restrict Manager to Only Their Own Customers" toggle itself is a Section 6.1 item; as built, Manager sees all customers, matching the OFF default.)

**Export:** BUILT — the same `GET /customers` endpoint with `?format=pdf` or `?format=excel` returns exactly the filtered, searched set, with a header block stating the filters applied (status, source, owner, search), per the system-wide convention. As built, the export file carries four columns: Customer Code, Company Name, GSTIN, Status (Status resolved from its Masters id to the human-readable name, same as the screen shows).

**Sort:** As built — Company Name A→Z, fixed. The other sort options assumed earlier (Company Name Z→A, Total Invoiced High → Low, Outstanding High → Low) are deferred; the rollup columns exist, so they are frontend/API ordering work only.

**Buttons:** "+ Add Customer" (opens 2.2 in create mode). Row click opens Customer 360 (2.3).

**Empty state:** "No customers yet."

**Pagination:** Standard controls, 25 per page by default. Deferred — the API currently returns the full result set with no page parameters; pagination is a frontend concern until list sizes make server-side paging necessary.

---

### 2.2 Add / Edit Customer

**What it's for:** Creating a new client company record, or editing one that already exists.

**Build status: BUILT** — `POST /customers` (create) and `PUT /customers/{id}` (update), plus `GET /customers/{id}` for the single record; edit action on `customer.directory` is seeded to Super Admin and Manager.

**Who can open it:** Manager, Super Admin.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Company Name | Text | Y | 2–200 characters |
| Display Name | Text | N | Short name used in lists; Assumption: defaults to Company Name if left blank |
| GSTIN | Text | N | Exactly 15 characters, standard GSTIN pattern, auto-uppercased |
| PAN | Text | N | Exactly 10 characters, standard PAN pattern (e.g. AAAAA9999A), auto-uppercased |
| Status | Dropdown (from Masters, Section 3.15) | Y | Prospect / Active / Inactive. Defaults to Prospect on a new record |
| Source | Dropdown (from Masters, Section 3.16) | N | **Removed 2026-07-30, restored 2026-07-31 — see the note under Section 5.** Where this customer first came from — Referral, Website, Cold Outreach, and so on |
| Website | URL | N | Must start with http:// or https:// |
| Notes | Text area | N | — |
| Mobile Number | Phone | N | 10-digit Indian mobile number |
| Email | Email | N | Standard email format |
| Address | Text area | N | — |
| Owner | Dropdown (staff) | N | The person responsible for this account. Not in the original raw field notes, but included here because the Directory (2.1) filters by Owner — a field that's easy to miss but has to exist for that filter to mean anything. As built: `owner_id`, FK to the Employee record |
| Customer Bank Account Name | Text | N | Added 2026-07-31 alongside the Directory columns (2.1) — this table was not updated at the time; corrected now. The name this customer remits *from*, matched against bank-statement credits. `bank_account_name` |
| Bank Name | Text | N | `bank_name` — used to build the masked display value ("HDFC ••••9021") |
| Bank Account Number | Text | N | `bank_account_number`, validated 9–18 digits. A real, writable form field — the masked variant shown on lists is derived from it by the database, never entered directly. These three bank fields are visible to Manager (see 2.1's Account Number note) |

**Not on this form:** Collected Into (`collected_into_bank_account_id`) — it is written automatically by the Invoice module when an invoice is created with a Bank Account, never entered here.

**Display Name default: BUILT** — on both create and update, a blank Display Name is saved as the Company Name (the assumption in the field table above is confirmed in code). GSTIN and PAN auto-uppercasing and pattern validation are also built as specified.

**Customer Code:** auto-generated on save, format CUST-\<Financial Year\>-\<4-digit number\>, e.g. CUST-2026-0001 — already defined in the Masters module's Number Prefixes table (Section 3.6e), and in fact this document's original version is what first proposed that exact numbering convention, before it became the shared pattern every other module's code now follows (Invoice, Ticket, Asset, and the rest). BUILT — allocated by the shared numbering service (`allocate_number` with the CUST prefix) against the current Financial Year on create; the record also stores its `financial_year_id`.

**Buttons:** Save, Cancel.

---

### 2.3 Customer 360

**What it's for:** The single detail page for one customer — everything about that company and its relationship with Meshrd, in one place with tabs, not scattered across screens.

**Who can open it:** Manager, Super Admin, for any customer. Accountant, only through the narrow Invoice-creation picker described in Section 6 — never this full page. Employee and HR have no access.

**Page structure:** a persistent header sits above all tabs, staying visible no matter which one is open — Company Name, Status badge, and the **Total Invoiced / Received / Outstanding** summary strip. This is not part of the Overview tab's content; it's a fixed element of the page itself, so the money picture is always in view even while looking at, say, Activities or Files.

**How those three numbers actually work, as built (corrects an earlier statement — see the Invoices tab below):** `total_invoiced` and `received` are plain stored columns on the customer record, written by the APIs that move money — Invoice creation and update add to Total Invoiced, recording a payment adds to Received, and issuing a Credit Note reduces Total Invoiced. `outstanding` is a database-computed column, always `total_invoiced − received`. They are **not** recomputed by summing the Invoices tab on each page load.

**Tabs:** Overview, Contacts, Activities, Opportunities, Projects, Invoices, Tickets, Files.

#### Tab: Overview

Shows the key fields from the master record (2.2) read-only — Company Name, Display Name, GSTIN, PAN, Status, Website, Notes, Mobile Number, Email, Address, Owner — with an Edit action that opens 2.2. The Total Invoiced / Received / Outstanding numbers are already visible in the persistent header above (see Page structure), so they aren't repeated again as separate content within this tab. BUILT — served by `GET /customers/{id}`, which returns the full record (bank fields and rollups included) after RBAC field masking.

#### Tab: Contacts

The individual people at this client company — not the company itself.

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Name | Text | Y | — |
| Designation | Text | N | e.g. "Procurement Manager" |
| Email | Email | N | Standard email format |
| Phone | Phone | N | 10-digit Indian mobile number |
| Primary Contact | Toggle | N | Only one contact per customer can be Primary; marking a new one automatically un-marks the previous |

**List view:** same fields as columns — Name, Designation, Email, Phone, Primary (badge). **Add/Edit/Delete** actions per contact. Deleting the current Primary contact leaves the customer with none until another is marked — no automatic promotion of a replacement.

**Build status: BUILT** — `GET/POST /customers/{id}/contacts`, `PUT/DELETE /customers/{id}/contacts/{contact_id}`. The one-Primary rule is enforced twice: the API automatically un-marks the previous Primary before saving a new one (the swap described above), and the database itself carries a generated-column UNIQUE guard so at most one Primary per customer can ever exist, even if the API is bypassed. Delete-leaves-none is built as specified.

**Empty state:** "No contacts added yet."

---

#### Tab: Activities

A chronological timeline of interactions — calls, emails, meetings, and notes — shown most recent first, as a timeline, not a plain table (see Section 4).

**"+ Add Activity" form:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Type | Dropdown | Y | Call / Email / Meeting / Note |
| Date | Date | Y | Assumption: defaults to today, can be backdated to log something that already happened |
| Description | Text area | Y | — |
| Related Contact | Dropdown (from the Contacts tab) | N | Which person at the company this activity was with, if applicable |

Each entry on the timeline shows Type (icon or badge), Date, Logged By (the user who added it, auto-filled, not editable), Related Contact (if set), and Description.

**Build status: BUILT** — `GET /customers/{id}/activities` (most recent first: activity date descending, then created-at descending) and `POST /customers/{id}/activities`. Type is stored uppercase: CALL / EMAIL / MEETING / NOTE. Date defaults to today when omitted and can be backdated. Logged By is auto-filled from the authenticated user, exactly as specified. The list endpoint filters by `activity_type`, `date_from`, and `date_to`. Activities are append-only as built — there are no edit or delete endpoints, which suits an audit-style interaction log.

**Empty state:** "No activities logged yet."

#### Tab: Opportunities

**Read-only** list of deals linked to this customer. Columns: Opportunity Name, Stage, Value (₹), Expected Close Date, Owner. As built, this tab is served by the Opportunity module's own list endpoint filtered by `customer_id` — that module is now built and owns everything about the record beyond this summary; clicking a row opens its full record there.

**Empty state:** "No opportunities yet."

#### Tab: Projects

**Read-only** list of projects delivered or in progress for this customer. Columns: Project Name, Status, Start Date, End Date. As built, this tab is served by the Project module's own list endpoint filtered by `customer_id` — that module is now built and owns everything about the record beyond this summary; clicking a row opens its full record there.

**Empty state:** "No projects yet."

---

#### Tab: Invoices

**Read-only** list of invoices raised to this customer. Columns: Invoice Number, Date, Amount, Status (Draft / Sent / Part-Paid / Paid), Balance. **Correction to this document's earlier claim:** the Total Invoiced / Received / Outstanding figures in the page's persistent header are **not** calculated by summing this tab — as built they are stored rollup columns on the customer record, maintained by the Invoice, Payment, and Credit Note APIs (see Page structure above). This tab is served by the Invoice module's own list endpoint filtered by `customer_id`, which carries that module's filters and export. Clicking a row opens that Invoice's full record — the Invoice module (Module 11) owns everything about it beyond this summary.

**Empty state:** "No invoices yet."

#### Tab: Tickets

**Read-only** list of support tickets raised by this customer, matching the Ticket module (Module 4) exactly: Ticket Number, Subject, Priority, Status (Open / In Progress / Resolved / Closed), Assigned To. As built, served by the Ticket module's list endpoint, which accepts `customer_id` as a filter (multi-select there). Clicking a row opens that ticket's full Detail/Conversation screen (Ticket module, Section 2.3).

**Empty state:** "No tickets yet."

#### Tab: Files

Uploaded documents against this customer — contracts, agreements, and similar.

| Column | Notes |
|---|---|
| File Name | — |
| Uploaded By | — |
| Uploaded On | dd-mm-yyyy |
| Size | — |
| Actions | View/Download, Delete |

**"+ Upload File"** button, Assumption: PDF/JPG/PNG/DOCX, up to 5 MB, matching the file-size convention used elsewhere in this CMS.

**Build status: BUILT** — as a two-step flow: the file itself is uploaded through the shared stored-files service (which owns the type/size limits and the View/Download path), then attached with `POST /customers/{id}/files` carrying the `stored_file_id`. `GET /customers/{id}/files` lists attachments; `DELETE /customers/{id}/files/{file_id}` removes one.

**Empty state:** "No files uploaded yet."

---

## 3. Workflows

### 3.1 Adding a New Customer

1. Manager or Super Admin opens the Customer Directory (2.1) and clicks **+ Add Customer**.
2. They fill in Company Name (required), Status (required, defaults to Prospect), and whatever else is known — GSTIN, contact details, Owner.
3. Saving generates the Customer Code (e.g. CUST-2026-0001) and opens Customer 360 (2.3) for the new record.
4. Optionally, right away: they add one or more Contacts (Contacts tab) and log an initial Activity (Activities tab) — e.g. "First call with procurement lead" — so the record isn't just a bare company name from day one.

### 3.2 Logging a Call, Email, Meeting, or Note

1. From Customer 360 (2.3), the user opens the Activities tab and clicks **+ Add Activity**.
2. They pick a Type, confirm or change the Date, write a Description, and optionally link it to a specific Contact.
3. Saving adds it to the top of the timeline (most recent first).

### 3.3 Uploading a File

1. From Customer 360, the user opens the Files tab and clicks **+ Upload File**.
2. They select a file from their device.
3. It appears in the list immediately, with Uploaded By and Uploaded On filled in automatically.

### 3.4 Status Moving from Prospect to Active

A customer's Status typically moves from Prospect to Active once a linked Opportunity is won. The Opportunity module (now built) owns the "won" logic — its shared Won trigger fires from a direct Stage change or from a Project being created against the Opportunity. **As built, that trigger does not touch the customer's Status** — the move from Prospect to Active is a manual edit on Screen 2.2. Deferred: automatic Prospect→Active on Opportunity-won. Reason: Customer Status is a dynamic Masters sub-master (Section 3.15), so "Active" is a row a Super Admin can rename or delete, not a constant the trigger can safely hardcode; automating this needs a designated-status convention first.

## 4. UI/UX Notes

- **The Total Invoiced / Received / Outstanding summary stays visible across every tab** on Customer 360, not just Overview — it's part of the page's persistent header, described in Section 2.3.
- **Activities are shown as a timeline**, most recent first, not a plain table — visually distinct entries with a type icon/badge per item, the way a CRM activity feed normally looks, not a spreadsheet-style list.
- **Empty states**, matching the tone used throughout this document: "No contacts added yet," "No activities logged yet," "No opportunities yet," "No projects yet," "No invoices yet," "No tickets yet," "No files uploaded yet."

## 5. Connected To / Depends on Masters

Connected To: Opportunity, Project, Invoice, Payment, Support Ticket

Owns: Contacts, Activities, Files

Depends on Masters: Financial Year

**Resolved — Customer Status now has a home.** The Masters module (Module 1, Section 3.15) added it as a new sub-master, resolving the open decision below in favor of Option A, the same resolution given to Ticket's Category field (Module 4, Section 5). Screen 2.2's Status field now sources from it. **Customer Source went the same route at the time (Masters Section 3.16), was removed entirely on 2026-07-30, and was RESTORED on 2026-07-31.** The removal took out the sub-master and the customer record's Source field together, on an instruction that on review only meant taking Source out of Masters' own default view — not deleting the field customers are recorded against. Both are back: the sub-master at Masters (Module 1, Section 3.16), and the Source field on Screen 2.2 and the Directory (2.1) column above.

**Export and filters, as built:** the Customer Directory (2.1) has Search + Status/Source/Owner filters and `?format=pdf|excel` export of the filtered set with a filters-applied header, per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). On Customer 360's tabs, the cross-module tabs — Opportunities, Projects, Invoices, Tickets — inherit their owning module's own filters and export by being that module's list endpoint filtered to this customer. Of the tabs this module owns: Activities filters by type and date range (built); Contacts and Files have plain lists with no filters or export.

**Deferred from the earlier revision of this section:** an Activities owner filter and Activities export; Contacts primary/non-primary filter and export; Files type/upload-date filters and export. Reason: small, bounded lists per customer today — the built filter set covers the high-value case (the Invoices tab's status filter answers "what's outstanding" through the Invoice module). The design intent stands: per-tab filter state is independent, and each tab that gains export exports its own filtered set.

## 6. Role-Based Access

- **Employee** — no direct access to this module. If they're staffed on a Project for this customer, they see the customer's name through the Project record, not through here.
- **Manager** — full access: add, edit, and manage every customer, contact, and activity.
- **Accountant** — no direct module access, but gets a lightweight, read-only customer picker (name and billing details only) when creating an Invoice. BUILT — `GET /customers/picker`, returning only id, Company Name, Display Name, Address, and GSTIN, searchable by Company Name or GSTIN. Deliberately gated on the Invoice module's `invoice.list` permission, not `customer.directory` — it is conceptually part of Invoice, not a Customer module grant. The two shouldn't be conflated: Accountant never opens the Customer Directory or Customer 360.
- **HR** — no access. Customers aren't an HR concern.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Customer row: Super Admin = All, Employee = NA, Manager = All, Accountant = NA, HR = NA. This matches the baseline exactly — Accountant's lightweight picker is a deliberate, narrow addition on top of that NA, not a contradiction of it. The built RBAC seed encodes exactly this: `customer.directory` visibility full for Super Admin and Manager, none for the rest; edit action to Super Admin and Manager; and one field-masking rule — `collected_into_bank_account_id` hidden from Manager (the customer's own bank fields are not masked from anyone who can see the record).

**On "what does Manager mean" here:** this is now the fourth module where the question has come up (first Ticket, then Payroll, then Vendor). Same resolution as Vendor: Manager's broad, company-wide access is kept exactly as the source sheet gives it, since customer/CRM data doesn't carry the same personal-privacy weight as payroll. The pattern holding across all four modules so far: broad Manager access gets defaulted down only where the underlying data is personal (payroll); everywhere else (Ticket, Vendor, Customer), it's kept as-is.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Restrict Manager to Only Their Own Customers"** — OFF by default: Manager sees every customer, matching the source sheet. Turned ON: Manager only sees customers where they're the assigned Owner — useful if the company later moves to account-based territories.
- **"Give Accountant Read Access to Customer Financial Summary"** — OFF by default: Accountant only gets the lightweight picker described above. Turned ON: Accountant can also view the Total Invoiced/Received/Outstanding figures for any customer, without full Customer 360 access.
- **"Allow Employee to Log Activities on Customers They're Staffed On"** — OFF by default: Employee has no Customer module access at all. Turned ON: an employee working on that customer's project can add a call/meeting note directly, without getting full CRM access.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

**Build status of the toggles:** the central RBAC admin is built, so screen visibility, edit actions, and the Collected-Into field masking above are all runtime-configurable — all defaults match this section. The three named example toggles are **deferred**: `customer.directory` is registered without ownership scoping (`has_scope=False`), so "Restrict Manager to Only Their Own Customers" has no enforcement path yet; the Accountant financial-summary grant and the Employee activity-logging grant likewise have no dedicated switches. Each can be added through the existing RBAC registry when wanted — no schema change needed for the first one, since Owner is already on the record.

## 7. Assumptions & Points to Confirm

1. **Search fields on the Customer Directory** — assumed to be Company Name, Display Name, GSTIN, Mobile Number, and Email; not explicitly specified. Now BUILT exactly as assumed.
2. **Display Name defaults to Company Name if left blank** — not explicitly specified. Now BUILT, on both create and update.
3. **Source — removed entirely on 2026-07-30, RESTORED on 2026-07-31.** The field and the Masters sub-master that feeds it (Section 3.16) are both back, with a shorter starting value list than the earlier revision had (Referral, Website, Cold Outreach, Partner, Event / Conference, Inbound Enquiry) — Super Admin can add more without a code change, same as any sub-master. See Section 5 for the full account of the removal and restoration.
4. **Activity Date defaults to today**, backdatable — not explicitly specified. Now BUILT as assumed.
5. **File upload limits** (PDF/JPG/PNG/DOCX, 5 MB) — not explicitly specified, matching the convention used elsewhere in this CMS. As built, the limits are owned by the shared stored-files service; customer file attachment only links an already-stored file.
6. **Customer Status Masters gap — resolved, no longer open.** It is now a Masters sub-master (Section 3.15). See Section 5. Customer Source was resolved the same way, then removed entirely, then restored — see item 3 above.
7. **Confirmed against Sheet1** — the Customer row matches this brief's Role-Based Access exactly (Super Admin = All, Employee = NA, Manager = All, Accountant = NA, HR = NA), and independently confirms the Owner field belongs on the record, which this document's original version had already added for the same reason given here.
8. **This document replaces the earlier "Customer Module" specification** written under the original 15-module numbering, before the baseline principle, the "what does Manager mean" question, and the pattern of flagging open Masters gaps had been established. That earlier file should be treated as retired.
9. **Export and filters confirmed** on the Customer Directory (2.1), per the system-wide convention (RBAC, Module 14, Section 2.2). Now BUILT — `?format=pdf|excel` on the list endpoint, export follows the applied filters and states them in a header block.

10. **Filters and filter-based export extended to Customer 360's tabs, and the Directory's filter set expanded, per explicit instruction.** Partially built: the Directory carries Status, Source, Owner, and Search (the expanded Directory set is deferred — see 2.1); on the 360 tabs, Activities filters by type and date range, and the cross-module tabs (Opportunities, Projects, Invoices, Tickets) get their owning module's filters and export via `customer_id`-filtered list endpoints. The remaining tab filters/exports are deferred — see Section 5. The design intent stands, including independent per-tab filter state.

11. **Rollup figures are stored, not summed on read — corrected in this reconciliation.** An earlier revision of the Invoices tab said Total Invoiced / Received / Outstanding were "calculated by summing across everything in this tab, not stored separately." As built it is the reverse: `total_invoiced` and `received` are plain columns on the customer record, written by the Invoice, Payment, and Credit Note APIs, and `outstanding` is a database-computed column (`total_invoiced − received`). See Sections 2.3 (Page structure) and the Invoices tab.

12. **Customer bank fields vs. Collected Into — as built.** The customer's own remitter details (`bank_account_name`, `bank_name`, `bank_account_number`, plus the DB-computed masked display value) are real writable fields on Screen 2.2 and are not masked from Manager. `collected_into_bank_account_id` is the only masked field (hidden from Manager) and has no form write path — the Invoice module sets it automatically. See 2.1's column notes and 2.2.

---

**Suggested filename:** `08-customer-module.md`
