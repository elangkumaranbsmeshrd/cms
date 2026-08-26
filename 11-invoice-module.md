# Module 11 of 14: Invoice

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Invoice module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Invoice Dashboard](#21-invoice-dashboard)
   - 2.2 [Invoice List](#22-invoice-list)
   - 2.3 [New / Edit Invoice](#23-new--edit-invoice)
   - 2.4 [Record Payment](#24-record-payment)
   - 2.5 [Credit Note](#25-credit-note)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

Invoice is billing a Customer for work done, and tracking whether they've paid. An invoice can start from scratch or from a won Opportunity or Project. It's owned by Accountant, not Manager — this is the company's money-in side, and access here is deliberately tighter than the relationship and delivery modules that feed it.

This module is only about billing Meshrd's B2B service clients — nothing here relates to Meshrd's retail hardware products.

## 2. Screens

### 2.1 Invoice Dashboard

**What it's for:** A landing page of company-wide numbers — how much has been billed, received, and is outstanding, plus a scan of what's overdue and what's recently come in.

**Who can open it:** Accountant, Super Admin. HR sees a stripped-down version if a specific toggle is on (Section 6). Employee and Manager have no access.

**Built** — `GET /api/v1/invoices/dashboard` (screen `invoice.dashboard`). All eight widgets return live figures, including the four cross-module ones: Total Expenses (approved/reimbursed reimbursable claims + paid company expenses), Active Projects, Open Tickets, and Active Employees. The "forward dependency" flag below is historical — Expense, Project, Ticket, and Employee all exist now and are wired in.

**A flag worth stating clearly:** this dashboard pulls data from four other modules — Expense, Project, Ticket, and Employee — not just Invoice. It's really a general company/admin home screen that the source spreadsheet happens to file under Invoice's row. It's documented here since that's where the source data has it, but it's a strong candidate to become its own standalone "Admin Dashboard" screen later, once Masters and the Roles & Access module are fully built — nested inside Invoice specifically is a reasonable place to start, not necessarily where it should stay.

**Widgets:**

| Widget | Source |
|---|---|
| Total Invoiced | This module — sum of every invoice's Grand Total |
| Received | This module — sum of all recorded payments |
| Outstanding | This module — Total Invoiced minus Received |
| Overdue Invoices (count) | This module — Status not Paid, Due Date has passed |
| Total Expenses | The Expense module — built: approved/reimbursed reimbursable claims plus paid company expenses |
| Active Projects | The Project module (Module 10) — count of projects with Status not Completed |
| Open Tickets | The Ticket module (Module 4) — count of tickets with Status Open or In Progress |
| Active Employees | The Employee module (Module 2) — count of employees with Status Active |

**Two supporting tables below the widgets:**

- **Overdue Invoices** — Invoice Number, Customer, Amount, Due Date. Built: Status not Paid and Due Date passed; Amount is the invoice's Balance Due.
- **Recent Payments** — Customer, Amount, Mode, Date. Built: the ten most recent recorded payments, joined to the invoice for the customer name.

**Currency formatting on this screen specifically:** large numbers are abbreviated using Indian lakh/thousand notation — ₹2.3L (2.3 lakh, i.e. ₹2,30,000), ₹50.0K (₹50,000) — matching the exact style already used in the source data. Values of ₹1,00,000 or more show as X.XL; values of ₹1,000 or more (but under a lakh) show as X.XK; anything smaller shows the full figure. This abbreviation is specific to dashboard summary widgets — individual invoice records (2.3) always show the full rupee figure, never abbreviated (see Section 4).

**Empty state:** if there's genuinely nothing yet (a brand new system), each widget shows 0 or ₹0 rather than being hidden — this is a landing page, not a conditional report.

**Frontend-deferred:** the ₹X.XL / ₹X.XK abbreviation and the empty-state rendering are display rules for the Angular frontend (not started); the API returns full, unabbreviated figures.

---

### 2.2 Invoice List

**What it's for:** The full, searchable table of every invoice.

**Who can open it:** Accountant, Super Admin.

**Columns (as built, `GET /api/v1/invoices`):** Invoice Number, Customer, Invoice Date, Due Date, Status, Subtotal, Tax, Grand Total, Received, Balance Due — the export carries exactly these; the JSON response additionally returns the full record (withheld/settled/claim amounts, line items, tax lines).

**Filters (built):** Customer, Status (multi-select — Draft / Sent / Part-Paid / Paid), Invoice Date range, **Overdue** (Status is not Paid and Due Date has passed — built as a toggle on this list, not a duplicate screen), and the **ageing bucket** filter — Current / 1–30 / 31–60 / 61–90 / 90+ days overdue, computed by the shared `ageing_bucket` engine (no Due Date = never overdue; Paid invoices don't age). The ageing filter is the one an accounts-receivable list is genuinely worked from; a single Overdue toggle answers "is anything late" but not "how late, and which first."

**Deferred (documented earlier, not yet built):** Financial Year, Due Date range, Grand Total range, Outstanding Amount range, Service Category, Tax applied, Created By, Payment Mode, and the Super Admin extras (Last Modified By, "all financial years"). Reason: the build kept to the filters the receivables workflow is actually worked from (status, dates, overdue/ageing, search); the invoice record does store Service Category, Tax head, and Created By, so these are filter-parameter additions, not schema work. Manager-scoped filtering is moot — Manager has no access to this module (Section 6).

**Export (built):** `?format=pdf` or `?format=excel` on the same endpoint returns exactly the filtered/searched set, with a header block naming the filters applied, the result count, who exported it, and when (shared `list_export` service). **This matters more on this screen than on most:** an exported receivables list is normally sent to someone who wasn't looking at the screen, and a filtered total read as a company-wide total is a real way to misinform a decision.

**Search (built):** covers Invoice Number, Customer Name, and Reference — wider than the original assumption of number + customer only.

**Buttons:** "+ New Invoice" (opens 2.3 in create mode). Row click opens the invoice record (2.3).

**Empty state:** "No invoices yet."

**Pagination:** Standard controls, 25 per page by default.

---

### 2.3 New / Edit Invoice

**What it's for:** Creating a new invoice, or editing one that hasn't yet locked.

**Who can open it:** Accountant, Super Admin.

**Two ways in:**

- **Starting blank** — an empty form, filled in from scratch. Built: `POST /api/v1/invoices`.
- **"Create from a won deal/project"** — **deferred to the frontend**: the backend exposes no prefill endpoint and stores no opportunity/project link on the invoice; this entry path is a frontend convenience that pre-fills an ordinary create call. As designed, it pre-fills Customer, and pulls in a starting line item: since neither an Opportunity nor a Project carries its own itemized billing (Opportunity's Quote tab was removed entirely on 2026-07-30 — see Opportunity module, Module 9, Section 1), a single line item is created using the Opportunity Title or Project Name as Description and the Opportunity Value or Project Budget as Rate (Quantity 1), as a starting point the person can then edit freely. The two origins now behave identically for this purpose.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Customer | Dropdown (from the Customer module) | Y | Built. **Cannot be changed after creation** — an edit that tries is rejected. The invoice snapshots the customer's name, address, and GSTIN at creation, so later customer edits don't rewrite issued invoices |
| Opportunity | Dropdown, filtered to the selected Customer's opportunities | N | **Deferred — not built.** The invoice table carries no opportunity link; tagging which deal an invoice relates to was dropped along with the prefill entry path (the Reference field covers free-text linkage for now) |
| Invoice Date | Date | Y | **Built (code-only in earlier revisions of this doc).** Required. Drives which tax heads are "in force" and the Due Date rule below |
| Due Date | Date | N | Built. Not required, and the consequence stands: an invoice with no Due Date can never appear in the Overdue filter or any ageing bucket (2.2). DB constraint: Due Date, if set, cannot be before Invoice Date |
| Reference | Text | N | **Built (code-only addition).** Free text; included in list Search |
| Service Category | Dropdown (from Masters) | N | **Built (code-only addition).** Stored on the invoice; not yet exposed as a list filter (2.2) |
| Notes | Text area | N | Built |
| Customer Address | Read-only, auto-filled from the Customer record | N/A | Built as a snapshot taken at creation (with name and GSTIN) |
| Financial Year | Read-only, auto-set | N/A | Built — the current open Financial Year at creation, which also drives the Invoice Number series |
| Bank Account | Dropdown (from Masters, Section 3.7 — Active accounts) | N | **Optional and stays editable** — including after the invoice is raised. Which of Meshrd's own accounts the customer should pay into; printed on the invoice and carried through as the *default* on Record Payment (2.4), never as a lock. Leaving it unset is a real choice, not an omission: the account can be decided later, and the invoice simply prints no account |
| Paid | Read-only, computed | N/A | Σ **Amount Received** across every payment (2.4). Unchanged meaning: cash that actually arrived |
| Withheld | Read-only, computed | N/A | **Added 2026-07-31.** Σ **Withheld Amount** across every payment — what customers held back. Row hidden entirely when no withholding applies |
| Settled | Read-only, computed | N/A | **Paid + Withheld.** What has come off the customer's obligation |
| Balance | Read-only, computed | N/A | **Claim − Settled**, where Claim = Grand Total − approved Credit Notes. Changed from "Grand Total minus Paid" |

**Payment Mode was removed from this screen on 2026-07-31.** It sat here as a "suggested payment method" printed on the invoice — a guess made before any money existed, which nothing downstream read and which was never reconciled against what actually happened. The mode a customer really paid by is captured once, on Record Payment (2.4), where the money genuinely arrives. Keeping a second, earlier, non-binding copy of the same field only invited the two to disagree, with no rule for which one was true. Masters → Payment Mode (Section 3.8) is unaffected and still drives the Record Payment dropdown.

**Line Items (repeatable rows):**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Description | Text | Y | — |
| HSN Code | Dropdown (from Masters, Section 3.11) | N | Assumption: moved to line-item level rather than a single invoice-wide field, since Indian GST invoicing conventions attach an HSN/SAC code per specific good or service billed, and a single invoice can reasonably mix line items that need different codes |
| Quantity | Number | Y | Must be a positive number (DB check) |
| Rate | Number (INR) | Y | Must be a positive number (DB check) |
| Line Total | Read-only, computed | N/A | Quantity × Rate — a generated column in the database, never stored independently |
| Credited Amount | Read-only, computed | N/A | **Built (code-only addition).** How much of this line has been credited by approved Credit Notes (2.5) — written back onto the line at approval |

"+ Add Line Item" adds a row; each can be removed. **An invoice with zero line items is rejected outright** — on create, on edit, and again at Send (422). HSN codes are snapshotted per line at save.

**Tax and totals:**

| Field | Meaning |
|---|---|
| Subtotal | Sum of every Line Total |
| Tax | Dropdown, from Masters → Taxes (Section 3.2), showing only heads scoped to Sales/Billing and in force on the invoice date. Customizable per invoice — Company Profile's Default Billing Tax is the starting suggestion, not a lock. **Changed in this revision:** this used to be a GST-specific list with the CGST/SGST vs. IGST split written into the Masters design. Any splitting a tax needs is now expressed by that head's own Split Components, so this screen doesn't know or care whether the selected tax divides into parts, or into how many |
| Tax Amount | Subtotal × the selected head's calculation. If the head has Split Components, the invoice stores **one tax line per component** (each with its component name snapshotted) and this figure is their total. Built: the selected head is validated server-side — it must be scoped Sales/Billing (or Sales & Purchase), active, and in force on the Invoice Date, or the save is rejected with the reason. An explicit Tax Amount override is accepted alongside a selected head, but **an override with no head is rejected** — there is no tax-without-head path on Invoice |
| Grand Total | Subtotal + Tax Amount — a generated column in the database |

**If no billing tax is configured in Masters, the Tax dropdown is hidden entirely** and the invoice is Subtotal = Grand Total. This is correct behaviour, not a broken screen — it is not yet established which taxes this company charges, so an invoice with no tax line is the honest default rather than a zero-rate placeholder. See Masters, Section 3.2. Built exactly this way: no head selected means zero tax and zero tax lines, never a placeholder line.

**Editing (built):** `PUT` recomputes Subtotal, the tax lines, and Tax Amount through the same shared calculation as create (the two can never drift), then **re-derives Status from the new Claim** — an edit while Sent/Part-Paid that reduces the total can legitimately move the invoice straight to Paid.

**Invoice Number:** auto-generated on save, format INV-\<Financial Year\>-\<5-digit number\>, e.g. INV-2026-00001 — already defined in Masters' Number Prefixes table (Section 3.6e) with 5 digits specifically, matching an existing example already in use.

**Status:** Draft / Sent / Part-Paid / Paid.

**The lock on Paid, stated exactly:** once an invoice reaches Status = Paid, it locks — every field becomes read-only. Only viewing and downloading remain available; nothing about a Paid invoice can be edited from this screen again. **Built with two layers:** the API rejects any edit of a locked invoice with 409 ("corrections go through a Credit Note, never a direct edit"), and the database trigger `trg_invoices_no_unlock` blocks any unlock at the storage layer as defense in depth.

**Resolved — a Credit Note flow now handles corrections after locking.** The source data didn't describe how to correct a Paid invoice, and this document originally left it open rather than inventing one quietly. It's now implemented — see Section 2.5. The original invoice itself still never becomes editable again; a Credit Note is a separate, linked document instead, which keeps the audit trail intact.

**"Download" button (built):** `GET /api/v1/invoices/{id}/pdf` produces a real PDF (shared reportlab engine, company letterhead + logo; every user-supplied value is markup-escaped before rendering). Company Profile stores which uploaded file is "the template", not a layout engine, so "using the template" is read as "using the same letterhead treatment" — the same resolution as Credit Note, Payslip, and Salary Certificate. The PDF prints the line items with HSN/SAC, the Subtotal, the tax — **one line per Split Component under its own name, e.g. "GST 18% (CGST): ₹900.00", when the head splits**; a single combined tax line otherwise — the Grand Total, Balance Due, Status, and a "Pay Into" line for the selected Bank Account (omitted when none is set).

**Buttons:** Save, Cancel, Send (Draft → Sent — built, 409 unless the invoice is a Draft), Download. All disabled except View and Download once Status = Paid.

---

### 2.4 Record Payment

**What it's for:** Logging money that's actually come in against a specific invoice.

**Who can open it:** Accountant, Super Admin. Built: `POST /api/v1/invoices/{id}/payments` (RBAC action `record_payment`), only available on an invoice with Status Sent or Part-Paid — any other status is rejected with 409. A payment-history read (`GET /api/v1/invoices/{id}/payments`) is also built; each payment stores the Balance Due at entry.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Balance Due | Read-only | N/A | **Claim − Settled**, where Claim = Grand Total − approved Credit Notes (2.5) and Settled = Received + Withheld. Shown for reference |
| Withheld So Far on this Invoice | Read-only | N/A | Shown only when an earlier payment on this invoice carried withholding, so whoever records the second payment sees why Balance Due is below Claim − Received. Mirrors "Withheld on this Bill" on Purchase Bill §2.3 |
| Amount Received | Number (INR) | Y | **Renamed from "Amount" on 2026-07-31.** Money that actually arrived in the bank. Must be positive. Once a second money field sits beside it, "Amount" is ambiguous between what arrived and what was settled — and removing that ambiguity is the whole point of this change |
| Customer Withheld Tax | Dropdown (from Masters → Taxes, Section 3.2 — heads scoped *Withholding / Deduction at Source* whose **Withholding Direction** includes *On Payments Received*, in force on the payment Date) | N | **Added 2026-07-31.** The tax the customer held back from this payment. Hidden entirely if no such head is configured. The credit it creates is tracked in Module 15 |
| Withholding Calculated On | Dropdown (Invoice Subtotal / Invoice Grand Total) | Conditional — required once a Customer Withheld Tax is selected | Defaults to **Invoice Subtotal**, for the identical reason Purchase Bill §2.2 defaults there |
| Withheld Amount (₹) | Number | Conditional — auto-suggested, stays editable | Suggested as *(head applied to the chosen base) − (already withheld on earlier payments against this invoice)* — the suggestion is a frontend behaviour; the API accepts the operator's figure directly. Stays editable because **the customer's figure governs, not ours** — they decided it, we are recording it. Must be ≥ 0 (DB check) |
| Amount Settled | Read-only, computed | N/A | **Amount Received + Withheld Amount.** What actually comes off the invoice balance. Shown *before* submit, so the operator can see the invoice will close |
| Mode | Dropdown | Y | Sourced from Masters → Payment Mode (Section 3.8), not a separately hardcoded list — the source data's four examples (Bank Transfer, UPI, IMPS, Cash) are the common cases, not an exhaustive restriction. **This is now the only place a payment mode is recorded**, following the removal of the invoice-creation field (2.3) |
| Received Into (Bank Account) | Dropdown (from Masters, Section 3.7 — Active accounts) | N | **Defaults to the account chosen when the invoice was created (2.3), and stays editable.** Customers do pay into a different Meshrd account than the one printed, and forcing the payment record to match the invoice would make it record something untrue. Optional — leave it as "Not recorded" when the receiving account is not yet known. This is the field bank reconciliation matches on, and it is also what makes an invoice's payment history readable account by account |
| Date | Date | Y | — |
| Reference | Text | N | e.g. a transaction ID or cheque number |

**Validation on submit (built):** `Amount Received + Withheld Amount ≤ Balance Due` — over-settlement is rejected with 422 naming the balance due. Amount Received must be positive (DB check). The Customer Withheld Tax head, when supplied, is validated server-side: it must be scoped Withholding/Deduction at Source, carry the *On Payments Received* direction, and be in force on the payment Date — otherwise the submit is rejected with the reason. Withholding Calculated On defaults to Invoice Subtotal server-side when a head is selected. Received Into defaults server-side to the invoice's Bank Account (2.3) when not supplied.

**On submit (built):** Paid, Withheld, Settled and Balance update on the invoice automatically (Settled, Claim, and Balance are generated columns in the database). **Status is decided by `Received + Withheld` against the Claim, not by Received alone** — so a ₹1,00,000 invoice settled by a ₹90,000 receipt with ₹10,000 withheld by the customer reaches **Paid** and locks (2.3), because the customer owes nothing further even though only ₹90,000 arrived. If that sum is more than zero but less than the Claim, Status moves to Part-Paid. Multiple partial payments are supported before an invoice reaches Paid.

**Claim, not Grand Total, is the figure Status compares against** — where Claim = Grand Total − approved Credit Notes (2.5). Using Grand Total alone would leave any credit-noted invoice permanently short of Paid by the credited amount, which is the same failure this section fixes for withholding, arriving by a different route.

Stated explicitly because the naive version of the rule — comparing Received to Grand Total — **leaves every withheld invoice stuck at Part-Paid forever**, permanently overstating receivables, keeping it in the Overdue filter and in every ageing bucket indefinitely. That is not hypothetical: it was this module's live behaviour until 2026-07-31, and it is the mirror image of the failure Purchase Bill §2.3 already names on the payables side.

**One anti-rule, because the wrong instrument sits ready to hand:** *a short receipt caused by customer withholding is never a Credit Note.* The Reason list on 2.5 deliberately gains no new option. A Credit Note reduces what a customer owes as a **correction** — it misstates revenue, needs Super Admin approval, and produces a customer-facing document, for a situation where the customer did nothing wrong and needs no document. The invoice was correct and was settled in full.

**Buttons:** Record Payment, Cancel.

---

### 2.5 Credit Note

**What it's for:** Resolves the previously-open question of how to correct a Paid (locked) invoice — implemented now, per your explicit direction, rather than left as an open question. A Credit Note doesn't edit the original invoice (which stays locked and unchanged, preserving the audit trail); it's a separate document that reduces what the customer owes, referencing the invoice it corrects.

**Who can open it:** Accountant, Super Admin. Assumption: Super Admin approval is required before a Credit Note takes effect, regardless of who raises it — correcting a locked financial document is exactly the kind of action worth a second set of eyes, consistent with the "Require Second Approval Before an Invoice Locks as Paid" toggle already in this module (Section 6.2).

**Where it's triggered from:** a "Raise Credit Note" action on any Paid (or Part-Paid) invoice's record (2.3).

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Original Invoice | Read-only, pre-filled | N/A | The invoice this credit note corrects |
| Reason | Dropdown — Billing Error / Customer Dispute / Goods or Service Not Delivered / Other | Y | Assumption on the option list |
| Reason Detail | Text area | Y | — |
| Credit Amount | Number (INR) | Y | Must be a positive number, and **cannot exceed the remaining creditable amount** — Grand Total minus credits already approved on this invoice, not the full Grand Total. Built this way deliberately: a second Credit Note must not push cumulative credits past the Grand Total, which would drive the Claim negative and force every future status resolution to Paid |
| Line Items Affected | Multi-select (from the original invoice's line items), optional | N | For partial credits tied to specific items; a whole-invoice credit can skip this and just use Credit Amount directly. Built: the Credit Amount is **split across the selected lines proportionally to each line's own total** (never the full amount onto every line), each share capped at its line's total, with the rounding remainder absorbed by the last line so the parts always sum back to the whole. Line snapshots (description, quantity, rate, total) are stored on the credit note |

**Credit Note Number:** auto-generated on save, format CN-\<Financial Year\>-\<4-digit number\>, e.g. CN-2026-0001 — a new numbering series, not reusing the original Invoice Number. Assumption: this needs adding to Masters' Number Prefixes table (Company Profile, part e) alongside the existing eight — flagged here rather than quietly assumed, the same way other Masters gaps have been handled throughout this documentation.

**Status:** Draft → Pending Approval → Approved. Built as `POST /api/v1/credit-notes`, `PUT` (Draft only — once submitted, no edits, 409), `/submit`, `/approve` (RBAC action `approve`), and `/pdf`. Approving reduces the original invoice's effective Outstanding balance by the Credit Amount (without reopening or editing the locked invoice itself — only the invoice's credit-note total moves, and Claim/Balance follow as generated columns), writes each credited share back onto the affected invoice lines, notifies whoever raised it, and generates a downloadable Credit Note PDF, using the same letterhead treatment as an invoice. **Approval also re-derives the invoice's Status against the new Claim** — a Part-Paid invoice whose settled amount now covers the reduced Claim moves to Paid and locks; the recomputation is done against the post-credit Claim in the same pass, precisely so that case is never stranded.

Raising is only allowed against a **Paid or Part-Paid** invoice (409 otherwise). Reason values as built: Billing Error / Customer Dispute / Goods or Service Not Delivered / Other. The customer rollup (total invoiced) is reduced on approval.

**What this doesn't do:** a Credit Note reduces what's owed; it doesn't move money. If money already collected needs to be refunded back to the customer, that's a separate, real bank transaction — outside what this module tracks, the same way this module doesn't initiate payments generally.

**Buttons:** Save as Draft, Submit for Approval, Approve (Super Admin only), Download.

**The Credit Note list — built (`GET /api/v1/credit-notes`).** This document described how a Credit Note is raised and approved but never gave the list view where existing ones are found. Columns as built/exported: Credit Note Number, Original Invoice Number, Customer, Amount, Status (the JSON response additionally carries Reason, Raised By, Approved By, and Date). Filters built: Customer, Status (Draft / Pending Approval / Approved — multi-select), Reason, Date range. Filter-based export built: `?format=pdf|excel` with the same filter-header block as every other list. **Deferred (documented, not yet built):** Credit Amount range, Raised By, and Approved By filters, and the text Search (Credit Note Number / Invoice Number / Customer Name) — the filter set built first is the one the approval workflow runs on (Status + Customer + date); these are parameter additions, not schema work.

**"Pending Approval" is the filter this list exists for** — a credit note sitting unapproved means an invoice's outstanding balance is still overstated, and nothing else in this module surfaces that.

**Empty state (on an invoice with no credit notes):** no separate empty state needed — the "Raise Credit Note" action is simply available and unused until needed.

---

## 3. Workflows

### 3.1 Creating an Invoice — From Scratch, or From a Won Opportunity or Project

1. Accountant or Super Admin opens the Invoice List (2.2) and clicks **+ New Invoice**, either starting blank or choosing "Create from a won deal/project."
2. Whether starting from an Opportunity or a Project, Customer is pulled and a single starting line item is created — from the Opportunity's Title and Value, or the Project's Name and Budget.
3. They fill in or adjust Invoice Date, Due Date, line items, Tax, Bank Account, Reference, and Service Category as needed (Payment Mode no longer exists on this screen — see 2.3).
4. Saving generates the Invoice Number (e.g. INV-2026-00001) at Status = Draft.

### 3.2 Sending an Invoice

1. From the invoice record (2.3), Accountant or Super Admin clicks **Send**.
2. Status moves from Draft to Sent. Assumption: this also makes Record Payment (2.4) available on this invoice, matching the restriction noted there.

### 3.3 Recording a Payment

1. Accountant or Super Admin opens Record Payment (2.4) from a Sent or Part-Paid invoice.
2. They enter the Amount Received (plus any customer withholding), Mode, Date, and an optional Reference, and submit.
3. Paid, Withheld, Settled, and Balance update immediately. Status moves to Part-Paid if the Claim isn't fully settled, or to Paid if Received + Withheld covers it (2.4).
4. This repeats as many times as needed until the invoice reaches Paid.

### 3.4 An Invoice Reaching Paid and Locking

1. The final payment that settles the Claim is recorded (3.3) — or a Credit Note approval reduces the Claim to what's already settled (3.6).
2. Status moves to Paid, and the invoice locks — every field becomes read-only, and the Save/Send actions disappear, leaving only View and Download. Built as an API-level 409 plus the `trg_invoices_no_unlock` database trigger.
3. Any correction needed from this point goes through a Credit Note (2.5, 3.6) — the previously open question is resolved.

### 3.5 An Invoice Going Overdue

1. An invoice with Status Sent or Part-Paid passes its Due Date without reaching Paid.
2. It now matches the Overdue filter on the Invoice List (2.2) and is counted in the Overdue Invoices widget and table on the Dashboard (2.1) — no separate action creates this state, it's simply a date comparison evaluated wherever it's shown.

### 3.6 Raising a Credit Note Against a Locked Invoice

1. Accountant or Super Admin opens a Paid or Part-Paid invoice and clicks **Raise Credit Note** (2.5).
2. They select a Reason, add Reason Detail, and enter the Credit Amount (optionally tied to specific line items).
3. It saves as Draft, then is Submitted for Approval.
4. Super Admin approves it — the original invoice's effective Outstanding balance reduces by the Credit Amount, its Status re-derives against the new Claim (a Part-Paid invoice whose settled amount now covers the Claim reaches Paid and locks), the invoice's own fields stay unchanged, credited amounts are written back to the affected lines, and a Credit Note PDF is available to download.

---

## 4. UI/UX Notes

- **The Dashboard should feel like a real landing page** for Accountant/Super Admin, given how many widgets it carries — not a cramped afterthought screen.
- **Line items need add/remove rows with totals recalculating live** as Quantity or Rate is typed — Line Total, Subtotal, Tax Amount, and Grand Total should all update immediately, not require a manual refresh or save.
- **Status shown as a clear colored tag.** Once Paid, the edit controls visually grey out — not just disabled, but visibly inactive — so nobody tries to change a locked invoice by mistake before finding out the hard way that it's locked.
- **Currency style:** dashboard summary numbers use the abbreviated ₹2.3L / ₹50.0K style (Section 2.1); individual invoice records always show the full rupee figure — a real invoice sent to a customer should never show an abbreviated amount.

## 5. Connected To / Depends on Masters

Connected To: Customer, Opportunity (can start from), Project (can start from), Payment

Uses: Taxes (Sales/Billing scope heads), HSN Code, Financial Year

Payment fields use: Bank Account, Payment Mode, Paid/Balance

Depends on Masters: Financial Year, Taxes (Section 3.2, Sales/Billing scope), Company Profile (bank details, invoice template, and the Credit Note number prefix)

**Confirmed already set up in Masters:** Invoice Number's prefix, HSN/SAC Code, Bank Account, Payment Mode, and Financial Year are all fully defined across the Masters module.

**Changed in this revision — Taxes is no longer "already defined," and that is deliberate.** This document used to record Taxes/GST as confirmed and complete in Masters, "including the CGST/SGST vs. IGST distinction." Masters no longer ships that distinction, or any tax at all: Section 3.2 is now an empty, dynamic list that Super Admin fills with whatever this company actually charges, because which taxes apply was never confirmed. For this module that changes nothing structural — the Tax dropdown still reads Masters — but it does mean an installation with no configured billing tax produces invoices with no tax line, and that is expected rather than a defect.

**Resolved — Credit Note Number now has a prefix.** Masters' Number Prefixes table (Section 3.6e) now includes a ninth entry: CN-\<Financial Year\>-\<4-digit number\>, e.g. CN-2026-0001, matching the style used by the other eight.

**Export and filters:** the Invoice List (2.2) and the Credit Note list (2.5) each carry a documented filter set plus "Export to PDF" and "Export to Excel," per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). Both sets were expanded in this revision — the Invoice List notably gaining an ageing-bucket filter, which is how a receivables list is actually worked.

## 6. Role-Based Access

- **Employee** — no access.
- **Manager** — no access.
- **Accountant** — create invoices, record payments, send and download — the primary owner of this module.
- **HR** — no access. Invoicing isn't an HR concern.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Invoice row: Super Admin = All, Employee = NA, Manager = NA, Accountant = partial (create invoice, record payments, send/download), HR = NA. This matches the brief exactly.

**As built,** the module registers three RBAC screens, all governed by the central resolver: `invoice.dashboard` (view only), `invoice.list` (actions: `edit`, `send`, `record_payment`), and `credit_note.list` (actions: `raise`, `approve`). Every endpoint above names the screen/action it requires, so the role grants are data, not code.

### 6.1 "What Does Manager Mean" — Resolved

This question has followed six modules now — first raised in Ticket (Module 4, Section 6.1), then confirmed the same way in Payroll, Vendor, Customer, Opportunity, and Project. Each time, the source data gave Manager broad, sometimes company-wide access, and each document had to decide whether to keep it as-is or default it down.

Invoice is where the pattern becomes fully legible, because it's the first module where Manager gets nothing at all rather than something narrowed. Laid out together:

| Module | Manager's access |
|---|---|
| Customer, Opportunity, Vendor, Ticket, Project | Full ("All") |
| Payroll | Defaulted down to status-only, from an originally broad grant |
| Invoice | None |

**The rule, stated plainly: Manager runs relationships and delivery, not money.** Every module where Manager has full access is about a customer relationship or the work being delivered to them. Every module touching money moving in or out of the company — Invoice here, and by the same logic Purchase Bill and Expense once they're documented — gives Manager nothing. This also confirms, retroactively, that defaulting Payroll's originally broad "run payroll + view all" access down to a status-only view (Module 6, Section 2.3) was the right call, and for the right reason: payroll is compensation, money leaving the company, not a relationship or delivery concern, even though it wasn't grouped explicitly with Invoice/Purchase Bill/Expense in that module's own brief at the time.

This resolution has been carried back to the Ticket module (Module 4, Section 6.1), where the question was first raised as genuinely open — that document now points here instead of leaving it unresolved.

### 6.2 Nothing Here Is Hardcoded

All of the access above is controlled from the central RBAC settings screen (built — Roles & Access module), including per-person overrides. The three named toggles below are design examples and are **deferred — not built as specific switches**; the general per-role, per-screen, per-action grant mechanism that would express them is what exists today (e.g. granting HR view on `invoice.dashboard` is possible, but the widget-level revenue split is a frontend concern; nothing currently gates the lock behind a second approval):

- **"Allow Manager Read-Only Access to Their Projects' Invoices"** — OFF by default, consistent with the "no money movement for Manager" rule above. Turned ON: Manager can view (not edit or record payments on) invoices tied to projects they lead.
- **"Require Second Approval Before an Invoice Locks as Paid"** — OFF by default: Accountant recording a payment that completes the balance locks the invoice immediately. Turned ON: Super Admin must confirm first — a control for larger amounts.
- **"Show Non-Financial Dashboard Widgets to HR"** — OFF by default: HR has no access to this module at all. Turned ON: HR sees only the operational widgets (Active Projects, Open Tickets, Active Employees), never the revenue figures — splitting the mixed dashboard flagged in 2.1 cleanly by role.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **HSN Code moved to line-item level**, not a single invoice-wide field — see the reasoning in Section 2.3.
2. **Tax applies once, to the invoice Subtotal**, not per line item — a Subtotal → Tax Amount → Grand Total structure, rather than each line item carrying its own rate.
3. **Record Payment's Mode dropdown sources from the full Masters Payment Mode list**, not a hardcoded 4-option list — the source data's examples treated as illustrative, not exhaustive.
4. **Record Payment restricted to Sent/Part-Paid invoices**, excluding Draft — built (409 on any other status).
5. **Over-settlement blocked outright** — Amount Received + Withheld cannot exceed Balance Due; built (422), plus DB checks that Amount Received is positive and Withheld is non-negative.
6. **"Create from Project" line-item interpretation** — a single line item from the Project's Name and Budget, since Project doesn't carry its own itemized billing structure. The source data is vague here; this is one reasonable reading, not a confirmed design.
7. **Customer Address is read-only with no per-invoice override** — kept simple as specified; a billing-address override could be added later if a real need for one comes up.
8. **Currency abbreviation rule** (₹X.XL / ₹X.XK, full figures below ₹1,000) — defined precisely here since the brief only gave examples, not a rule.
9. **Credit Note — implemented, resolved.** A new screen (2.5), per your explicit direction to resolve rather than leave open. Design choices worth a second look: approval gated behind the `approve` RBAC action regardless of who raises it, a new CN-2026-0001 numbering series (now added to Masters, Section 3.6e), and it reduces effective Outstanding without reopening the original locked invoice. The cap as built is **remaining creditable** (Grand Total minus prior approved credits), not the raw Grand Total. Doesn't cover an actual bank refund, which stays a separate real-world transaction outside this module's tracking.
10. **The Dashboard's cross-module dependency is flagged, not resolved** — it's documented here because that's where the source data has it, with an explicit note that it's a candidate to become its own Admin Dashboard screen later.
11. **Confirmed against Sheet1** — the Invoice row matches this brief's Role-Based Access exactly, and independently confirms the Dashboard's full widget set, both tables, and the exact currency examples (₹2.3L, ₹50.0K) are all genuinely part of the source data under this module's row.
12. **"What does Manager mean" is now resolved**, per Section 6.1 — the open question first raised in the Ticket module now has a definitive, evidence-based answer, and that document has been updated to point here rather than left as an open thread.
13. **Export and filters confirmed** on the Invoice List (2.2), per the system-wide convention (RBAC, Module 14, Section 2.2).

14. **This revision — filters expanded, filter-based export confirmed, and a missing list screen found while auditing, per explicit instruction.** The Invoice List had four filters, none covering amount, ageing, or date range beyond a whole year. The most useful addition is the **ageing bucket filter** (Current / 1–30 / 31–60 / 61–90 / 90+ days overdue) — the existing Overdue toggle answers "is anything late" but not "how late, and which to chase first," which is the actual work.

    **The audit also turned up a genuine gap:** the Credit Note feature (2.5) documented how one is raised and approved, but never specified the list view where existing credit notes are found — so there was no way to see pending ones. Added, with filters. This matters beyond tidiness: an unapproved credit note means an invoice's outstanding balance is still overstated, and nothing else in this module surfaced that.

    **Export's filter header is emphasized here more than in other modules for a reason** — a receivables export is normally sent to someone who wasn't looking at the screen, and a filtered total read as a company-wide total misinforms a real decision.

15. **Doc-vs-code reconciliation (this revision).** Reconciled against the built backend (`app/api/v1/invoices.py`, `credit_notes.py`, `services/tax_head_lookup.py`, `finance_engine.py`, `pdf_engine.py`):
    - **Code-only additions now documented:** Invoice Date and Reference as inputs; Service Category on the invoice; customer name/address/GSTIN snapshots; Tax Amount override (only valid alongside a head); per-line Credited Amount write-back; payment history endpoint with Balance-Due-at-entry; customer rollups (total invoiced / received) maintained by this module; Grand Total, Claim, Settled, Balance, Line Total, and is-locked all as DB generated columns; the `trg_invoices_no_unlock` trigger.
    - **Deferred, with reasons noted inline:** the Opportunity link field and the create-from-deal/project prefill (frontend concern, no backend column/endpoint); the extended Invoice List filters (Financial Year, Due Date/amount ranges, Service Category, Tax applied, Created By, Payment Mode, Super Admin extras); Credit Note list's Amount range / Raised By / Approved By filters and its text Search; the three Section 6.2 named toggles (the general RBAC grant mechanism exists; the specific switches don't); all ₹L/₹K display formatting (frontend not started).
    - **Schema-ready but unwired:** payment rows carry a Recorded/Reversed status with reversed-by/at columns, but no reversal endpoint exists yet.
    - **Fixed 2026-08-05:** future-date rejection now applies to both Invoice Date (create) and payment Date (Record Payment) — the flagged gap above was closed the same day it was found, matching every other module. The Due Date ≥ Invoice Date rule still applies on top of it.

---

**Suggested filename:** `11-invoice-module.md`
