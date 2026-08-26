# Module 4 of 14: Ticket

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Ticket module.

## Implementation Status — Backend (verified 2026-08-02)

The backend for this module is built and tested — 10 API operations under `/tickets` (list, create, detail, edit, status, entries list/add, reassign, assignment history, reports summary), backed by the `tickets`, `ticket_entries`, and `ticket_assignment_history` tables — while the Angular frontend has not been started, so every screen below is backend-ready, not rendered UI.

**Built:**

- Ticket List (2.1) — list endpoint with the full expanded filter set (multi-select Status / Priority / Category / Customer / Assigned Staff; Raised By; Raised, Due, and Resolved/Closed date ranges; "Overdue only"; "Unassigned only"; Satisfaction Rating; Super Admin's Created By and Last Modified By), search over Ticket Number / Subject / Customer name, Employee scoping to their own assigned tickets, and PDF/Excel export of exactly the filtered set with the filters-applied header block.
- New / Edit Ticket (2.2) — create and update: Ticket Number allocated from the Masters Number Prefixes "TKT" series per financial year, Subject 5–150 enforced, Priority defaults to Medium, an optional Due Date (the `tickets.due_date` column, feeding the list's Due-Date-range and "Overdue only" filters), and Linked Project checked server-side against the selected Customer (a mismatched project is rejected with 422, not just filtered out of the dropdown). Assigning at creation or through the edit form writes an Assignment History entry and notifies the assignee (in-app plus the Ticket Assigned email), same as 2.4.
- Ticket Detail / Conversation (2.3) — single-ticket endpoint plus the conversation thread (list and add entries): Public Reply / Internal Note, optional attachment via the shared file-upload endpoint (PDF/JPG/PNG, 5 MB, magic-byte validated; the entry stores a reference to the uploaded `stored_files` record); the first Public Reply auto-captures First-Response Time and moves Open → In Progress; first-response and resolve durations are returned as "4h 20m"-style badge strings.
- Status flow (2.3) — dedicated status endpoint covering Open / In Progress / Resolved / Closed, with Closed reserved for the 'close' permission (Manager/Super Admin by default) and the optional Satisfaction Rating (integer 1–5) captured at close.
- Assign / Reassign (2.4) — reassign endpoint plus an assignment-history endpoint: each change records Previous Assignee, New Assignee, Changed By, Date, and Note; both the new and previous assignee get an in-app notification and the new assignee gets the Ticket Assigned email (the previous assignee's "reassigned away" notice is in-app only, deliberately — it isn't an assignment to them). Reassigning to the person already assigned is rejected as a no-op (422), so the history never records a change that didn't happen.
- Support Reports (2.5) — summary endpoint returning counts by Status, counts by Priority, top-10 customers by volume, average resolve time, and average first-response time, filterable by Date Range, Category, Assigned Staff, Customer, Priority, and Status.
- Role-Based Access (6) — the Ticket List & Detail screen (Super Admin/Manager full, Employee own-tickets, Accountant/HR none; create/reassign/close actions default to Manager/Super Admin only) and the Support Reports screen (Manager/Super Admin). The Section 6.2 toggles are the standard RBAC grants — 'create' and 'reassign' actions, full scope for the open-queue toggle, the reports screen for staff — with per-person overrides.
- My Tickets — the Employee module §2.7 self-service view referenced in Section 1 exists as its own route (`/employees/me/tickets`), documented in the Employee module.

**Deferred / not implemented:**

- Support Reports export (2.5) — the endpoint returns a pure aggregate (counts, a ranking, two averages), not a flat row list, so there is no filtered-rows table for the shared list-export engine to render; skipped for the same recorded reason as Opportunity's stage summary.
- "Require Satisfaction Rating on Close" (2.3 / 6.2) — not enforced anywhere; the rating is always optional at close.
- Ticket visibility on the customer's own record (3.1 step 8) — the Customer 360 was built before this module existed and its Opportunities/Projects/Tickets tabs were explicitly left out as a forward dependency; a Tickets tab has not been added since.
- Project-side "Linked Tickets" reference (3.3 step 3) — nothing on the Project side surfaces linked tickets; the link lives only on the ticket record.

**Differs from this document:**

- Status changes (2.3 / 6): this document lets anyone with access to a ticket change its status freely; the backend reserves moving to Closed for the 'close' permission — Manager/Super Admin by default — because closing confirms resolution and is never the assignee's call alone. Employee moves Open / In Progress / Resolved freely on their own tickets.
- Contact person (1 / 5): the built ticket record has no Contact-person link — this document's own field list in 2.2 never carried a Contact field, and none exists in the schema.
- Durations: first-response and resolve times are measured from the precise instant the ticket was created rather than the date-only Raised Date, because a date-only start would overstate every same-day duration. Resolve time ends at the Resolved timestamp, falling back to the Closed timestamp when a ticket is closed directly without ever passing through Resolved — so a straight-to-Closed ticket still shows a duration and still counts in the reports average instead of silently dropping out.
- Sorting and pagination (2.1): the API returns the full filtered set in one fixed order (Raised Date, newest first); the sort options and 25-per-page controls are client-side presentation over that set.
- Archived toggle (2.1): tickets have no archived state — including or excluding Closed tickets is simply the Status filter; there is no separate archive to toggle.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Ticket List](#21-ticket-list)
   - 2.2 [New / Edit Ticket](#22-new--edit-ticket)
   - 2.3 [Ticket Detail / Conversation Screen](#23-ticket-detail--conversation-screen)
   - 2.4 [Assign / Reassign Ticket](#24-assign--reassign-ticket)
   - 2.5 [Support Reports](#25-support-reports)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

> **Sidebar location changed 2026-07-30.** My Tickets (Employee, Module 2, Section 2.7) moved from the Employee tab into this module's own sidebar entry, next to Ticket List and the rest of this module's screens. It's still documented under Employee §2.7 — this module didn't gain a new self-service screen, the existing one just sits closer to its subject in navigation now. See RBAC, Module 14, Section 3 for the full reasoning.

The Ticket module is customer support: a Customer has a problem, a ticket gets logged against them, it's assigned to a staff member to resolve, and it's tracked through to close. It connects to the Customer module (who raised it, and which Contact person at that company it's with), the Employee module (who's handling it), and optionally to a Project (if the issue relates to ongoing work already underway for that customer).

A staff member's own personal list of tickets assigned to them is already summarised in the Employee module's My Tickets screen. This document doesn't redesign that — it documents the full ticket record and the detail/reply screen staff actually use to work each ticket, plus the admin and reporting side that sits above individual tickets.

This module has nothing to do with Meshrd's retail hardware products — every ticket here is support for one of Meshrd's B2B service clients, never a retail product buyer.

## 2. Screens

### 2.1 Ticket List

**What it's for:** The full, searchable table of every support ticket — the entry point for anyone working or overseeing support.

**Who can open it:** Super Admin and Manager see every ticket. Employee sees only tickets assigned to them — this filtered view is the same underlying data as the Employee module's My Tickets screen, just presented as the full-featured version here. Accountant and HR have no access to this module at all.

**Tabs:** None — single table view.

**Columns shown:**

| Column | Notes |
|---|---|
| Ticket Number | Auto-generated, e.g. TKT-2026-0001 |
| Customer | Company name |
| Subject | — |
| Category | From Masters, Section 3.14 |
| Priority | Low / Medium / High / Urgent, shown as a colored tag |
| Status | Open / In Progress / Resolved / Closed, shown as a colored tag |
| Assigned To | Staff member's name, or "Unassigned" |
| Raised Date | dd-mm-yyyy |
| Due Date | dd-mm-yyyy, blank if none set; an overdue ticket (Due Date passed, still Open/In Progress) should read as such at a glance |
| First-Response Time | Blank until the first Public Reply; then shown as a small duration badge (e.g. "4h 20m") |

**Search box:** Assumption — searches Ticket Number, Subject, and Customer name, matching the search pattern used in every other list screen in this CMS.

**Filters:** Status, Priority, Category (from Masters), Customer, Assigned Staff — all as listed in the brief, and all now multi-select where a single value was previously implied. Added in this revision: Raised By, Raised Date range, Due Date range, Resolved/Closed Date range, an "Overdue only" toggle, an "Unassigned only" toggle, and Satisfaction Rating where one has been recorded. Search covers Ticket Number, Subject, and Customer Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Available to every role that can open this screen.** An Employee's Ticket List is scoped to their own assigned tickets, so filtering by Assigned Staff there is meaningless and hidden per the convention's exception — every other filter is present and behaves identically for them as for anyone else. If the "Allow Staff to View the Full Open Ticket Queue" flag is on, the Assigned Staff filter appears for them too, because the dimension now means something. Super Admin gets the full set plus Created By, Last Modified By, and a "show closed and archived" toggle.

**Export:** "Export to PDF" and "Export to Excel" of exactly the filtered, searched, sorted set.

**Sort options:** Raised Date (Newest / Oldest), Priority (High → Low), Status.

**Buttons:**

- **"+ New Ticket"** — opens New / Edit Ticket (2.2). Visible to Manager and Super Admin by default; Employee only if the "Allow Staff to Create New Tickets" toggle is on (Section 6).
- **Row click** — opens the Ticket Detail / Conversation screen (2.3).

**Empty state:** "No tickets yet." / "No tickets match your filters."

**Pagination:** Standard controls, 25 per page by default, page-size selector (10/25/50/100).

---

### 2.2 New / Edit Ticket

**What it's for:** Creating a new support ticket, or editing one that already exists.

**Who can open it:** Manager and Super Admin by default. Employee only if "Allow Staff to Create New Tickets" is turned on for their role (Section 6) — Assumption, added since the brief didn't explicitly say whether Employee can log a new ticket themselves (e.g., if a customer calls them directly), only that their *visibility* is limited to tickets assigned to them. Treating ticket creation as an admin/ops action by default, toggle-able, keeps this consistent with the rest of Employee's restricted role here.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Customer | Dropdown (from Customer module) | Y | — |
| Category | Dropdown (from Masters, Section 3.14) | N | — |
| Subject | Text | Y | 5–150 characters |
| Priority | Dropdown | Y | Low / Medium / High / Urgent; defaults to Medium |
| Description | Text area | Y | — |
| Assigned To | Dropdown (staff) | N | Can be left blank and assigned later via 2.4; setting it here has the same effect as using Assign (2.4) at creation time |
| Due Date | Date picker | N | Added in the build (not in the original brief): an optional target date for the ticket. Drives the Due Date range filter and the "Overdue only" toggle on the list (2.1) — a ticket is overdue when its Due Date has passed and it is still Open or In Progress |
| Linked Project | Dropdown (from Project module) | N | Assumption: filtered to only show projects belonging to the Customer already selected above, so you can't accidentally link a ticket to the wrong company's project. The API also enforces this server-side — a project that doesn't belong to the selected Customer is rejected outright, on create and on edit |

**Ticket Number:** auto-generated on save, format TKT-\<Financial Year\>-\<4-digit number\>, e.g. TKT-2026-0001, using the prefix from Company Profile — this is already set up in the Masters module's Number Prefixes table (Section 3.6e), so no new configuration is needed.

**Buttons:** Save (create or update), Cancel.

---

### 2.3 Ticket Detail / Conversation Screen

**What it's for:** The main working screen for a ticket — where staff actually read and respond to a customer issue.

**Who can open it:** Manager and Super Admin, any ticket. Employee, only if the ticket is assigned to them — as built, every single-ticket operation (detail, edit, conversation, status, reassign, assignment history) runs through one shared scope check, and a ticket outside the Employee's scope reads as not found rather than forbidden, so its existence isn't leaked. (Or if "Allow Staff to View the Full Open Ticket Queue" is on, in which case they can open any ticket to read it — see Section 6 for whether that also grants reply rights or view-only). Accountant and HR have no access.

**Ticket header (always visible at the top):** Ticket Number, Customer (name, linking to their Customer profile), Subject, Priority tag, Status tag, Assigned To, First-Response Time badge (once a Public Reply has been sent), Satisfaction Rating (once Closed, if one was captured).

**Conversation thread:** every entry shown in chronological order, each with Author, Timestamp, Type badge (Public Reply or Internal Note), and Content. Optional file attachments per entry — Assumption, added since support conversations commonly need a screenshot or document attached; PDF/JPG/PNG, up to 5 MB, matching the limit used elsewhere in this CMS.

**Reply / Note composer, at the bottom of the thread:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Entry Type | Toggle — Public Reply / Internal Note | Y | Defaults to Public Reply. Must be an obvious, hard-to-miss control (see Section 4) — the risk isn't "sending" an internal note to the customer (notes are never emailed), it's mis-marking an entry as the wrong type, either leaking an internal discussion or leaving the customer without the reply they were expecting |
| Content | Text area | Y | — |
| Attachment | File upload | N | See note above |

**Status control:** a dropdown or button group — Open / In Progress / Resolved / Closed. Moving between Open, In Progress, and Resolved is available to whoever can access the ticket at all (Employee on their own assigned tickets; Manager/Super Admin on any). Moving to **Closed** is a distinct 'close' action reserved for Manager/Super Admin by default — as built, an Employee/assignee cannot close their own ticket, because closing confirms resolution and is never the assignee's call alone (see "Differs from this document" above). Assumption: the first Public Reply on a ticket that's still Open automatically moves it to In Progress, since that's also the moment First-Response Time gets captured — the two naturally happen together.

**Closing a ticket:** moving Status to Closed opens a small optional prompt — **Satisfaction Rating** (1–5, or a Very Satisfied → Very Unsatisfied scale — Assumption on the exact scale). This is filled in by whoever is closing the ticket, based on what the customer said, not an automated customer-facing survey — that would be a reasonable future enhancement, but isn't what's being built now. Skipping the rating and closing anyway is allowed unless "Require Satisfaction Rating on Close" is turned on (Section 6).

**Buttons:** Send Reply, Add Internal Note (the composer's single Send button, its action depending on the Entry Type toggle), Change Status, Reassign (shortcut into 2.4, shown only to roles who can reassign).

**Empty state (conversation thread):** "No replies yet — be the first to respond."

---

### 2.4 Assign / Reassign Ticket

**What it's for:** Picking who's responsible for a ticket, whether that's a first assignment or handing it to someone else.

**Who can open it:** Manager and Super Admin by default. Employee only if "Allow Staff to Reassign Their Own Ticket" is on for their role, and even then only for tickets already assigned to them (Section 6).

**Where it's triggered from:** a row action on the Ticket List (2.1), or the Reassign button on the Detail screen (2.3).

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| New Assignee | Dropdown (staff) | Y | — |
| Note | Text | N | e.g. "Reassigning — I'm on leave next week" |

**On save:** picking the person the ticket is already assigned to is rejected as a no-op — the form must name a genuinely different assignee. Otherwise, Assigned To updates, the new assignee gets a notification, and (Assumption, added for accountability) an **Assignment History** entry is recorded on the ticket — Previous Assignee, New Assignee, Changed By, Date, Note — visible on the Detail screen (2.3), the same pattern used for asset assignment history in the Asset Management module. The previous assignee is also notified that the ticket has moved off their list.

---

### 2.5 Support Reports

**What it's for:** A simple reporting screen summarizing support activity — no editing happens here.

**Who can open it:** Manager and Super Admin by default. Employee only if "Show Support Reports to Staff" is on for their role (Section 6). Accountant and HR have no access.

**Report views:**

- **Ticket count by Status** — Open / In Progress / Resolved / Closed counts.
- **Ticket count by Priority** — Low / Medium / High / Urgent counts.
- **Top customers by ticket volume** — table: Customer, Ticket Count, sorted highest first (Assumption: top 10 shown by default).
- **Average resolve time** — from the ticket's creation instant to Resolved (falling back to Closed for tickets closed without passing through Resolved), shown as a duration. Computed by the same shared calculation the Detail-screen badge uses, so the two figures can never drift.
- **Average first-response time** — from the ticket's creation instant to the first Public Reply, shown as a duration; Internal Notes never count.

**Filters:** Date Range (based on Raised Date) as given in the brief. Assumption, added for consistency with other Reports screens in this CMS: also Category, Assigned Staff, Customer, Priority, and Status, for a more granular breakdown. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2) — including the financial-year date presets, which read Masters → Financial Year rather than hardcoding period boundaries.

**Export follows the filter, and on a Reports screen that matters more than anywhere else** — an exported support report that doesn't state its own date range and filters is the kind of file that gets forwarded and misread. Every export from this screen carries a header block listing the filters that produced it, the result count, who exported it, and when.

**Buttons:** "Download Report" (CSV/PDF), same simple download pattern used in Asset Reports — **deferred in the build**: the endpoint returns a pure aggregate, not a flat row list, so there is nothing for the shared list-export engine to render (see "Deferred / not implemented" above).

**Empty state:** "No tickets in this date range."

---

## 3. Workflows

### 3.1 Ticket Raised → Assigned → Worked → Resolved → Closed

1. Manager, Super Admin, or Employee (if creation is turned on for them) opens Ticket List (2.1) and clicks **+ New Ticket**, filling in Customer, Category, Subject, Priority, Description, and optionally Assigned To and Linked Project.
2. The system generates the Ticket Number (e.g. TKT-2026-0001).
3. If it wasn't assigned at creation, Manager or Super Admin assigns it via 2.4 — the assignee is notified.
4. The assigned staff member opens the ticket (from Ticket List, or from My Tickets in the Employee module) and reads the Description.
5. They send a Public Reply to the customer, or add an Internal Note first if they need to loop in someone internally before responding. The first Public Reply captures First-Response Time and moves Status from Open to In Progress automatically.
6. The conversation continues — more replies, more internal notes — until the issue is fixed.
7. Status is moved to Resolved once the fix is in place, then to Closed once confirmed. Closing prompts an optional Satisfaction Rating.
8. The ticket now shows as Closed everywhere it appears — Ticket List, Support Reports, and the customer's own record in the Customer module.

### 3.2 Reassigning a Ticket to a Different Staff Member

1. Manager or Super Admin (or Employee, if "Allow Staff to Reassign Their Own Ticket" is on, for their own ticket) opens the ticket from the List or the Detail screen and clicks **Reassign**.
2. They pick the new staff member and optionally add a note explaining why.
3. Assigned To updates, an Assignment History entry is recorded, and both the new and previous assignee are notified.
4. The ticket disappears from the previous assignee's My Tickets (Employee module) and appears in the new assignee's.

### 3.3 A Ticket Linked to a Project

1. When creating or editing a ticket (2.2), staff optionally selects a Linked Project, filtered to projects belonging to the Customer already chosen.
2. Once linked, the ticket's header (2.3) shows the Project name as a reference, linking through to it.
3. Assumption, since the Project module isn't documented yet: once it is, the same link should show up on the Project's own side too — a small "Linked Tickets" reference on that record — so the connection is visible from either direction, not just from the ticket.
4. Clearing the Linked Project field on Edit Ticket (2.2) removes the link without affecting the ticket or the project otherwise.

## 4. UI/UX Notes

- **Two-pane layout**, the standard helpdesk pattern: Ticket List (2.1) as a compact left pane — Ticket Number, Customer, Subject, Priority tag, Status tag — and the selected ticket's Detail/Conversation (2.3) as the right pane. Clicking a row loads the conversation on the right without a full page navigation.
- **Status and Priority as separate colored tags**, visible at a glance in both the list and the detail header. Assumption on the color convention: Status — Open = blue, In Progress = amber, Resolved = teal/green, Closed = grey. Priority — Low = grey/green, Medium = blue, High = orange, Urgent = red.
- **Public Reply and Internal Note need a clear visual difference** — different background colors for each entry in the thread (e.g. a white/blue-tinted bubble for Public Reply, a yellow/amber-tinted bubble labeled "Internal" for Internal Note) — and the composer itself should change background or border color depending on which mode is selected, so the distinction is obvious *before* sending, not just after reading it back.
- **First-response time and resolve time as small badges** on the ticket header (2.3) and as a column in the list (2.1) — not something you only find by opening Support Reports.
- **Empty states:** "No tickets yet," "No tickets match your filters," "No replies yet — be the first to respond," "No tickets in this date range."
- Assumption: this module is desktop-first, since support agents typically work tickets at a desk with the two-pane layout above — unlike the Employee module's self-service screens, which were explicitly built mobile-friendly.

## 5. Connected To / Depends on Masters

Connected To: Customer (who raised it), Contacts, Employee (assigned staff), Project (optional link)

Depends on Masters: Financial Year, Company Profile (for ticket number prefix), **Email Configuration (Section 3.21 — the Ticket Assigned email template)**

**The ticket number prefix is already correctly set up** — Company Profile's Number Prefixes table (Masters, Section 3.6e) already has a Ticket Number entry (TKT-2026-0001 style), so nothing new is needed there.

**Resolved — Ticket Categories now has a home.** The Masters module (Module 1, Section 3.14) added Ticket Categories as a new sub-master, resolving the open decision below in favor of Option A. Screen 2.2's Category field now sources from it.

- **Option A — add "Ticket Categories" as a new Masters sub-master** — the option chosen, managed the same way Expense Types or Payment Mode are (a simple Name/Status list, Super Admin-managed by default). This keeps categories editable without a code change, consistent with how every other dropdown-of-options in this CMS works.
- Option B (a fixed, hardcoded dropdown) was the alternative considered and not taken, since centralizing configuration in Masters is the pattern this whole CMS otherwise follows.

**Export and filters:** Ticket List (2.1) and Support Reports (2.5) get "Export to PDF" and "Export to Excel" alongside their filters, per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). Both screens' filter sets were expanded in this revision, and both are available in full to every role that can open the screen — see the note under 2.1 for how role scoping, not filter withholding, is what limits what each role sees.

## 6. Role-Based Access

- **Employee** — handles tickets assigned to them: reply, add internal notes, change status between Open / In Progress / Resolved. Cannot move a ticket to Closed (the 'close' action is Manager/Super Admin by default — see "Differs from this document"), cannot see tickets assigned to someone else, and cannot reassign a ticket to another staff member, by default.
- **Manager** — full access to every ticket: view, reassign, close, and see Support Reports.
- **Accountant** — no access to this module.
- **HR** — no access to this module.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Ticket row: Super Admin = All, Employee = partial (handle own assigned tickets, reply), Manager = All, Accountant = NA, HR = NA. This matches the above exactly — no correction needed for this module.

### 6.1 Open Decision — What Does "Manager" Mean? — Resolved in Module 11

Flagged here as instructed, not resolved at the time: in the Employee and Asset Management modules, Manager's extra access beyond their own data is consistently scoped to their **direct reports only** — a traditional people-manager, seeing just their own team. Here, and per the source sheet, on Customer, Opportunity, and Vendor too, Manager instead gets **full, company-wide access** — every ticket, every customer, regardless of who's assigned or who reports to whom.

At the time, this section reasoned it might come down to HR-type personal data (narrow) versus business records without a natural individual owner (broad) — a plausible theory, but not quite the real rule.

**Update, once the pattern had enough data points:** the Invoice module (Module 11, Section 6.1) is where this resolved definitively. The actual rule is cleaner than the original theory: **Manager has full access to every relationship and delivery module (Customer, Opportunity, Vendor, Ticket, Project) and zero access to every money-movement module (Invoice, Purchase Bill, Expenses).** It isn't about personal versus non-personal data — it's specifically about money. Manager runs relationships and delivery; Manager does not touch money. Payroll (Module 6) fit this same rule for the same underlying reason, even though it was reasoned through differently at the time. See Module 11 for the full resolution.

### 6.2 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Allow Staff to View the Full Open Ticket Queue"** — OFF by default: an Employee only sees tickets assigned to them. Turned ON: they can see every open ticket, useful for a shared "first come" queue model.
- **"Allow Staff to Reassign Their Own Ticket"** — OFF by default: only Manager/Super Admin reassigns. Turned ON: staff can hand their own ticket to a teammate directly.
- **"Show Support Reports to Staff"** — OFF by default: reports are Manager/Super Admin only. Turned ON: individual staff can see the team-wide report too.
- **"Allow Staff to Create New Tickets"** — Assumption, added for the gap noted in Section 2.2: OFF by default, only Manager/Super Admin logs a new ticket. Turned ON: any Employee can create one too, useful if staff often take issues directly from a customer call or email.
- **"Require Satisfaction Rating on Close"** — Assumption, added alongside the rating feature in 2.3: OFF by default, the rating is optional when closing. Turned ON: a ticket can't be moved to Closed without one. **Not built** — the backend never enforces it; the rating is always optional at close (see "Deferred / not implemented" above).

**Per-person overrides:** same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role (for example, one particular Employee who informally leads the support queue could get Support Reports turned on just for them), without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Search fields on the Ticket List** — assumed to be Ticket Number, Subject, and Customer name; not explicitly specified.
2. **Ticket creation restricted to Manager/Super Admin by default**, toggle-able for Employee — the brief specified Employee's *viewing* scope but not whether they can create a new ticket themselves.
3. **Linked Project dropdown filtered by the selected Customer** — a UX safeguard against linking to the wrong company's project, not explicitly requested.
4. **First Public Reply auto-moves Open → In Progress** — a reasonable default tied to First-Response Time capture, not explicitly specified.
5. **Satisfaction Rating is manually recorded by staff at close**, not an automated customer-facing survey — kept simple for this version; an emailed rating link is a reasonable future enhancement, not built now.
6. **Assignment History added** to the ticket record (2.4), matching the pattern already used for asset assignment history in Asset Management — not explicitly requested but consistent with how this CMS tracks "who had this and when" elsewhere.
7. **Reply/Note attachments added** — support conversations commonly need a screenshot or file; not explicitly listed in the brief's field list.
8. **Ticket Categories — resolved.** Now sourced from Masters (Section 3.14, Module 1), per Option A there. No longer an open decision.
9. **"What does Manager mean" — resolved in Module 11 (Invoice).** See Section 6.1 for the update: Manager gets full access to relationship/delivery modules and none to money-movement ones, resolved cleanly rather than left as originally flagged here.
10. **Checked directly against Sheet1** — the Ticket row matches this brief's Role-Based Access section exactly (Super Admin = All, Employee = partial/own tickets, Manager = All, Accountant = NA, HR = NA). No correction needed this time, unlike the Employee module.
11. **Export and filters confirmed** on Ticket List (2.1) and Support Reports (2.5) — "Export to PDF" and "Export to Excel" alongside existing filters, per the system-wide convention (RBAC, Module 14, Section 2.2).

12. **This revision — filter sets expanded on both list screens, for all roles, with filter-based export.** Per explicit instruction. The Ticket List's five brief-specified filters were all single-select and covered no date dimension at all — a support queue with no "raised this week," no "overdue only," and no "unassigned only" is missing the three questions most often asked of it. All added, and the existing five made multi-select.

    **The interesting case here is the Assigned Staff filter for Employee.** It's hidden by default not as a restriction but because an Employee's queue is already only their own tickets, making the filter a control that can return everything or nothing. Turn on "Allow Staff to View the Full Open Ticket Queue" and it appears, because the dimension becomes meaningful. That's the convention's exception (b)(1) working as intended, and this screen is its clearest example in the whole CMS.

---

**Suggested filename:** `04-ticket-module.md`
