# Module 13 of 14: Purchase Bill

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Purchase Bill module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Purchase Bill List](#21-purchase-bill-list)
   - 2.2 [Add / Edit Purchase Bill](#22-add--edit-purchase-bill)
   - 2.3 [Record Payment](#23-record-payment)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

Purchase Bill is the other side of Invoice: money going out instead of coming in. A supplier (Vendor) sends Meshrd a bill for something purchased, it gets recorded here with GST, and tracked until it's paid. Structurally similar to Invoice, but with one real difference: there's no Draft/Sent stage. A Purchase Bill already exists as a real document from the vendor before anyone records it here — it starts from "received," not "being written."

This module is only about what Meshrd buys from suppliers — nothing here relates to Meshrd's retail hardware products.

## 2. Screens

### 2.1 Purchase Bill List

**What it's for:** The full, searchable table of every bill received from a supplier.

**Who can open it:** Accountant, Super Admin.

**Columns:** Internal Bill ID, Vendor, Vendor's Bill Number, Total, Paid, **Bank Account**, Status, Bill Date, Due Date.

**Bank Account added 2026-07-31.** A Bank Account filter was already documented on this screen, but the column it filters on was never shown — so a user could narrow the list to one account and then have no way to see, per row, which account each bill actually sat against. It carries the account named on the bill (2.2), or the account a payment was actually made from once one is recorded (2.3), which is the figure that matters for reconciliation. The same column exists on the Invoice list (Module 11, Section 2.2) and on both Expense list screens (Module 12), so payables, receivables and claims can all be read account by account.

**Filters:** Supplier, Status, Financial Year — plus, added in this revision: Bill Date range, Due Date range, Amount range, Outstanding Amount range, Payment Mode where a payment has been recorded, Bank Account, Created By, an **Overdue** toggle (Status not Paid, Due Date passed), and an **ageing bucket** filter — Current / 1–30 / 31–60 / 61–90 / 90+ days overdue. Search covers the vendor's Bill Number, the internal Bill ID, and Supplier Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Built (2026-08-03, `GET /purchase-bills`):** Supplier (`vendor_id`), **multi-select Status**, Bill Date range (`bill_date_from`/`bill_date_to`), the **Overdue** toggle, the **ageing bucket** filter (Current / 1-30 / 31-60 / 61-90 / 90+ — a Paid bill or one with no Due Date never ages), and Search across Vendor Bill Number, internal Bill ID, and Supplier Name — all exactly as specified. **Deferred (documented above but not yet in the API):** Due Date range, Amount range, Outstanding Amount range, Payment Mode, Bank Account filter, Created By, and an explicit Financial Year filter — deferred as list-refinement filters with no computation of their own; the columns and underlying fields they would filter on all exist, so adding them is additive query work, not a data-model change.

**The Bank Account column is built** as the *effective* account per row: the account named on the bill (2.2), or the Paid From account of the latest recorded payment once one exists (2.3) — exactly the reconciliation figure described above.

**Ageing matters as much on the payables side as on receivables** (Invoice, Module 11, Section 2.2), and arguably more — a supplier bill quietly passing its due date damages a relationship the company depends on, which is a slower and less visible failure than a customer paying late.

**Available in full to every role that can open this screen** — Accountant and Super Admin. Super Admin additionally gets Last Modified By and an "all financial years" option on every date range.

**Export:** "Export to PDF" and "Export to Excel" of exactly the filtered, searched, sorted set, with a header block naming the filters, the result count, who exported it, and when. **Built:** `format=pdf|excel` on the same `GET /purchase-bills` call — the export re-shapes exactly the rows the JSON response would return, filters and search included, with the filters-applied header block (per the system-wide convention, RBAC Module 14, Section 2.2).

**Search:** Assumption — Internal Bill ID, Vendor's Bill Number, and Vendor name.

**Buttons:** "+ Add Purchase Bill" (opens 2.2). Row click opens the bill record (2.2).

**Empty state:** "No purchase bills recorded yet."

**Pagination:** Standard controls, 25 per page by default. **Deferred:** the API currently returns the full filtered set (ordered by Bill Date, newest first); paging is a frontend/API refinement to add when the Angular frontend is built.

---

### 2.2 Add / Edit Purchase Bill

**What it's for:** Recording a bill Meshrd has received from a vendor.

**Who can open it:** Accountant, Super Admin.

**Two different bill numbers — kept clearly separate, worth stating plainly since it's easy to conflate them:**

- **Internal Purchase Bill ID** — auto-generated on save, format PB-\<Financial Year\>-\<4-digit number\>, e.g. PB-2026-0001, using the prefix from Company Profile in Masters (Section 3.6e) — the same pattern used for asset tags and ticket numbers. This is Meshrd's own reference, never seen by the vendor.
- **Vendor Bill Number** — manually entered, required. This is the vendor's *own* invoice/bill number, printed on their document, needed to match this record back to the physical or PDF bill later. It has nothing to do with the internal ID above, and the two will never look alike or be confused for each other once both are labeled clearly on screen.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Vendor | Dropdown (from the Vendor module), or "+ Add New Vendor" inline | Y | Same inline-add modal pattern already established in the Vendor module (Module 7, Section 3.2). **Built:** an inactive vendor is rejected outright ("Cannot bill an inactive vendor"), and the vendor **cannot be changed on Edit** — a bill stays with the supplier it was recorded against |
| Vendor Bill Number | Text | Y | See above |
| Bill Date | Date | Y | Cannot be in the future — it's the date printed on a document that already exists. **Built** — enforced on both create and edit |
| Due Date | Date | N | **Built:** when left blank, auto-derives as **Bill Date + the vendor's Payment Terms (days)**, so ageing and Overdue never silently opt out just because the field was skipped; the payment-terms figure is snapshotted on the bill. The "must be after Bill Date if provided" check is **not currently enforced server-side** — deferred as a UI-level validation |
| Notes | Text area | N | — |
| Attachment | File upload (image or PDF) | Y in spirit, not technically blocking | A scan or photo of the actual vendor bill — this is the audit source document. Treat it as important, not optional, even though it isn't a hard-blocking required field by default (see the "Require Attachment" toggle, Section 6) |
| Bank Account | Dropdown (from Company Profile in Masters, Section 3.7 — Active accounts) | N | Optional. Which of Meshrd's own accounts this bill is expected to be paid from; carried through as the default on Record Payment (2.3), where it stays editable |
| Linked Expense Claim | Dropdown (from Expense, Module 12) | N | Optional. The staff expense claim covering this same spend — see below. **Built:** a claim already linked to a different bill is rejected (the link is strictly 1:1), and the link **cannot be changed on Edit** — it is removed or remade from the claim side |
| Withholding Tax | Dropdown (from Masters → Taxes, Section 3.2 — heads scoped *Withholding / Deduction at Source* whose **Withholding Direction** includes *On Payments Made*, in force on the Bill Date) | N | **Added 2026-07-31, resolving the gap flagged in Section 7.** Optional. The tax to hold back from what is paid to this supplier. A head whose Direction is only *On Payments Received* governs what customers withhold from us and is deliberately **not** selectable here. Hidden entirely if no such head is configured. What happens to the withheld amount afterwards is Module 15 |
| Withholding Calculated On | Dropdown (Subtotal / Total) | Conditional — required once a Withholding Tax is selected | Defaults to **Subtotal**. Withholding is commonly calculated on the taxable value *before* the purchase tax rather than on the gross, and the two produce materially different figures — so this is asked rather than assumed. **Built:** when a withholding head is selected and this is left blank, the API applies **and persists** SUBTOTAL as the value that actually drove the calculation — the stored record always says which base was used |
| Withholding Amount (₹) | Number | Conditional — auto-filled, stays editable | Auto-computed from the selected head against the chosen base, and still directly editable for the same reason Tax Amount is: the real figure may not land exactly on a configured rate. Cannot exceed Total |
| Amount Payable to Vendor | Read-only, computed | N/A | **Total − Withholding Amount.** This is what actually leaves the bank |

**Why the Expense link exists.** The same piece of spending can reach the system twice: once as the supplier's bill, recorded here, and once as a staff claim in Expense (Module 12) because an employee paid it on a personal card — the office Wi-Fi bill is the standard example. Neither record reveals on its own that they are the same money. Linked, the two settle as a single amount and each shows the other on its own record; unlinked, the company pays the supplier *and* reimburses the employee, and the duplication surfaces only at reconciliation, if at all.

It is deliberately **optional and two-way**: most bills have no staff claim behind them, so making it mandatory would force a meaningless "None" on the majority. The same link can be made from the Expense side (Module 12, Section 2.1), and either direction populates both records.

**Line Items (repeatable rows):**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Description | Text | Y | — |
| HSN Code | Dropdown (from Masters, Section 3.11) | N | Assumption, mirroring the same addition made for Invoice (Module 11): moved to line-item level, since Indian GST record-keeping attaches an HSN/SAC code per specific good or service, and it also matters here for claiming input tax credit |
| Quantity | Number | Y | Must be a positive number |
| Rate | Number (INR) | Y | Must be a positive number |
| Line Total | Read-only, computed | N/A | Quantity × Rate |

**Withholding tax, stated plainly, because getting this backwards misstates both what the supplier is owed and what the company owes the authority.**

When a withholding tax applies, the company does not pay the supplier the full amount. It holds a portion back and remits that portion to the tax authority itself. Worked example:

| | |
|---|---|
| Bill Total (what the vendor billed) | ₹1,00,000 |
| Withholding @ 10% on Subtotal | ₹10,000 |
| **Amount Payable to Vendor** | **₹90,000** |
| Paid to the authority, separately | ₹10,000 |
| Vendor's outstanding balance afterwards | **₹0 — settled in full** |

Four rules follow, and all four must hold:

1. **Withholding is deducted from the payment, never added to the bill.** Total is the vendor's claim and does not change. This is the opposite of how Tax Amount behaves, which is exactly why it is stated rather than inferred.
2. **A payment can never exceed Amount Payable to Vendor** (₹90,000 above), not Total. Attempting more is an error, the same way an over-payment is blocked on Invoice.
3. **The bill reaches Paid when payments + withholding equal Total.** In the example, recording ₹90,000 moves the bill to Paid — the supplier is owed nothing further, even though only ₹90,000 ever left the bank. A bill that reached Paid this way must never appear in an ageing or outstanding-payables view.
4. **The withheld amount becomes a liability to the authority, not to the vendor.** This module records that it was withheld; it does not track remitting it onward. Whether the CMS should also track remittance — due dates, challans, filing periods — is deliberately **not** designed here and is flagged in Section 7 for grooming, since it is a compliance workflow of its own rather than a field on a bill.

**All four rules are built (2026-08-03).** Withholding is stored on the bill and never inflates Total (`Total = Subtotal + Tax Amount`, computed in the database itself); `Amount Payable to Vendor = Total − Withholding` and `Balance Due = Amount Payable − Paid` are likewise database-computed columns, so no code path can drift from them. The payment ceiling is Balance Due (the net figure), Withholding Amount itself cannot exceed Total, and Paid status is resolved by `payments + withholding` against Total — never by payments alone (rule 3, and Section 2.3). A Paid bill drops out of ageing entirely — the ageing calculation returns no bucket for a settled document.

**Head validation is server-side, not just a filtered dropdown (built).** Both the purchase-tax head and the withholding head are validated on create *and* edit: scope must match (Purchase or Sales-and-Purchase for the tax head; Withholding / Deduction at Source for the withholding head), the head must be active and in force on the Bill Date, and the withholding head must carry the *On Payments Made* direction — any miss is rejected with the specific reason, rather than trusting the client to have offered only valid heads. The head's name and rate are snapshotted onto the bill at save.

**Edit is built (2026-08-03), as a full recompute.** The Edit endpoint re-runs exactly the same tax and withholding computation as create — line items and tax lines are replaced wholesale, Subtotal/Tax/Total/Withholding recomputed, blank Due Date re-derived from the vendor's payment terms, and Status re-resolved under the payments-plus-withholding rule (so an edit that changes Total can legitimately move a bill between Part-Paid and Paid). The vendor's outstanding-amount rollup is adjusted **by the delta** between the bill's old and new net contribution, never re-derived from scratch, so other bills' contributions stay untouched. Two things cannot change on Edit: the Vendor and the Linked Expense Claim (see the field table). There is no lock check on a Paid bill, matching the "Lock Purchase Bill Once Fully Paid" toggle's OFF default (Section 6.2).

**Vendor Usage (Module 7, Section 2.3) shows the gross bill figure, not the net paid.** What a supplier was billed and what they were paid differ by the withheld amount, and the relationship view is about the former. The paid figure is on the payment record.

---

**Totals:**

| Field | Meaning |
|---|---|
| Subtotal | Read-only, computed — sum of every Line Total |
| Tax Amount | Assumption: either pick a head from Masters → Taxes (Section 3.2, Purchase scope, in force on the bill date), which auto-fills this figure, or type the exact amount directly — since this bill already exists as a real document, the vendor's own tax figure may not land perfectly on one of the configured heads (rounding, for instance), so a direct override stays available even after picking one. The direct-entry route also means a bill can be recorded correctly before any tax head has been configured at all. **Built exactly so** — a Tax Amount with **no head at all** is an accepted, intended path here (unlike Invoice, where a head is required); with a head, the override wins over the computed figure, and the record flags whether the amount was a manual override |
| Total | Subtotal + Tax Amount. **This is the vendor's claim and is never reduced by withholding** |
| Withholding | Read-only, computed — the Withholding Amount above, shown as a deduction. Row hidden entirely when no withholding applies |
| Amount Payable to Vendor | Read-only, computed — Total − Withholding. What actually leaves the bank, and the ceiling for every payment recorded against this bill |

**Status:** **built** as **Unpaid → Part-Paid → Paid** (originally proposed as an inference — the build confirmed it). Flagged explicitly: the source data only says "track due/paid" — it doesn't spell out an exact status set the way Invoice's Draft/Sent/Part-Paid/Paid was spelled out. This three-value set is a reasonable inference to keep it structurally consistent with Invoice, not something taken directly from the source. There is no Draft or Sent stage here at all — a new bill starts directly at Unpaid, since it's a record of something that already happened, not a document being composed.

**No PDF-generation "Download" button here**, unlike Invoice — there's no one to send a Purchase Bill to; it's an internal record of something Meshrd already received. What matters is being able to open the Attachment quickly (Section 4), not generate a new formatted document.

**Buttons:** Save, Cancel.

---

### 2.3 Record Payment

**What it's for:** Logging a payment Meshrd has made against a bill — mirrors the Invoice module's own Record Payment screen closely.

**Who can open it:** Accountant, Super Admin. Only available on a bill with Status Unpaid or Part-Paid, not one already Paid — **built** (the API rejects a payment against any other status), and carried as its own RBAC action (`record_payment`) on the Purchase Bill screen, separate from `edit`.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Balance Due | Read-only | N/A | Shown for reference. **Measured against Amount Payable to Vendor, not Total** — on a bill with withholding, the balance that can still be paid is the net figure |
| Withheld on this Bill | Read-only | N/A | Shown only when withholding applies, so whoever is releasing the payment can see at a glance why the payable figure is lower than the bill total. Nothing on this screen can change it — it is set on the bill (2.2) |
| Amount | Number (INR) | Y | Must be a positive number, and cannot exceed Balance Due (the net payable figure above). **Built** — the ceiling is the database-computed Balance Due (Amount Payable to Vendor minus payments), never Total, and the balance at the moment of entry is snapshotted onto the payment record |
| Mode | Dropdown | Y | Assumption, matching Invoice's own Record Payment: sourced from the full Masters Payment Mode list (Section 3.8), not a separately hardcoded set — Bank Transfer, UPI, IMPS, and Cash are the common examples, not an exhaustive list |
| Paid From (Meshrd Account) | Dropdown (from Company Profile, Section 3.7 — Active accounts) | N | Which company account the money actually left from. Defaults to the account named on the bill (2.2) and stays editable — a bill can legitimately be settled from a different account than the one it was filed against. **Built:** the default is applied server-side too — a payment sent with no Paid From account falls back to the bill's account automatically. This is what fills the "Paid From" column on Vendor Usage (Module 7, Section 2.3), so a supplier's payment history can be read account by account |
| Paid Into (Vendor's Account) | Read-only, from the vendor record | — | The vendor's own bank account, carried through from Vendor → Bank Details. Read-only here on purpose: a payment screen is the wrong place to change a supplier's account details, and letting it be edited inline is exactly how a payment ends up going somewhere nobody approved. **Built:** the vendor's account name, bank name, masked account number, and IFSC are **snapshotted onto the payment record at the moment it is recorded**, never resolved live afterwards — the payment permanently shows where the money actually went, even if the vendor's bank details change later |
| Date | Date | Y | — |
| Reference | Text | N | e.g. a transaction ID or cheque number |

**On submit:** Balance updates automatically. **Status is decided by `payments + withholding` against Total, not by payments alone** — so a ₹1,00,000 bill with ₹10,000 withheld reaches **Paid** on a ₹90,000 payment, because the supplier is owed nothing further. If that sum is more than zero but less than Total, Status moves to Part-Paid. Multiple partial payments are supported before a bill reaches Paid.

Stated explicitly because the naive version of this rule — comparing payments to Total — would leave every withheld bill stuck at Part-Paid forever, permanently overstating payables by the withheld amount. **Built exactly as stated**, in a single shared status resolver; the moment a bill reaches Paid is also timestamped on the record.

**Double-payment guard (built — code rule, now documented).** Before any payment is recorded, the API checks the bill's Linked Expense Claim (2.2): if that claim already carries a live (non-reversed) reimbursement, the payment is **blocked** with an explanation — paying the bill too would settle the same spend twice. The mirror check exists on the Expense side (a linked claim cannot be reimbursed while the bill has a live payment). This is the mechanism that makes the Expense link genuinely *prevent* double payment rather than merely display it; either the reimbursement is reversed first, or the link removed, before the bill can be paid separately.

**Vendor rollups (built — code rule, now documented).** Recording a bill adds its net payable to the vendor's outstanding amount; each payment reduces that outstanding figure and adds to the vendor's total spend — the figures Vendor Usage (Module 7, Section 2.3) reads. These are maintained directly by the API on each write, not by a database trigger.

**Buttons:** Record Payment, Cancel.

---

## 3. Workflows

### 3.1 Receiving a Bill, Recording It, and Reaching Paid

1. Accountant or Super Admin opens Purchase Bill List (2.1) and clicks **+ Add Purchase Bill**.
2. They select the Vendor (or add one inline), enter the Vendor Bill Number from the physical/PDF document, Bill Date, and Due Date, add line items, and attach a scan or photo of the actual bill.
3. Subtotal, Tax Amount, and Total calculate as line items are entered — Tax Amount can be adjusted directly if it needs to match the vendor's exact figure.
4. Saving generates the Internal Purchase Bill ID (e.g. PB-2026-0001) and sets Status to Unpaid.
5. As the Due Date approaches, the bill is visible on the List (2.1), filterable by Status and Year.
6. Accountant or Super Admin records one or more payments (2.3) until the balance clears, moving Status through Part-Paid to Paid.

### 3.2 Creating a New Vendor Inline While Entering a Bill

1. While selecting a Vendor on Add Purchase Bill (2.2), the person doesn't find the supplier they need.
2. They choose "+ Add New Vendor," which opens the same small inline modal already documented in the Vendor module (Module 7, Section 3.2) — enough to continue without losing progress on the bill.
3. The rest of the vendor's details can be completed later from the Vendor Directory.

## 4. UI/UX Notes

- **The Attachment should be prominent and easy to open** — it's the actual source document for audit purposes, not a nice-to-have tucked away behind a small icon. A thumbnail preview, similar to how receipts are shown in the Expense module, is worth carrying over here too.
- **Status shown as a clear colored tag**: Assumption on convention — Unpaid = amber, Part-Paid = blue, Paid = green.
- **Line items recalculate live**, the same pattern used on Invoice — Line Total, Subtotal, Tax Amount, and Total all update immediately as figures are typed, no manual refresh needed.

## 5. Connected To / Depends on Masters

Connected To: Vendor (supplier), Bill Payment

Uses: Taxes (Purchase scope heads), Financial Year

Paid via: Bank Account, Payment Mode (UPI, IMPS)

Depends on Masters: Financial Year, Taxes (Section 3.2, Purchase scope), Company Profile (for the internal bill ID prefix)

Needs: Suppliers (Vendors) must already exist before a bill can be recorded against one

**Confirmed already set up in Masters:** the internal Purchase Bill ID prefix, Bank Account, Payment Mode, and Financial Year are all fully defined — no new Masters gap turned up here either.

**Changed in this revision:** Taxes is no longer a pre-defined GST list in Masters. Section 3.2 is now a dynamic list Super Admin populates with whatever taxes this company actually deals with, because that was never established. This module is the least affected of the tax-consuming modules, since its Tax Amount was always directly enterable — a bill can still be recorded exactly as the vendor issued it whether or not any head exists to pick from.

**Withholding tax — confirmed and now built (2026-07-31).** This was previously flagged as an open question: the *Withholding / Deduction at Source on Payments* scope existed in Masters (Section 3.2) with no field on this screen to apply it. **The company has confirmed it does withhold from supplier payments**, and the fields are specified in Section 2.2 — Withholding Tax, Withholding Calculated On, Withholding Amount, and the derived Amount Payable to Vendor — along with the four rules governing them and the Paid-status rule in Section 2.3.

**Remittance tracking — previously out of scope, now built as Section 8 (2026-07-31).** This section records that an amount *was withheld*; Section 8 tracks handing it onward to the authority, and tracks the mirror-image case where a customer withholds from what they pay this company.

**Payroll-side withholding remains deliberately out of scope**, on explicit instruction. Tax deducted from employee salaries is the same "withheld and remitted onward" pattern and would be a third source feeding the same register, but it is not in this phase. Section 8's register is built to accept a third source without restructuring; if payroll withholding is brought in, revisit whether these screens should be promoted out of this module into their own.

**Export and filters:** the Purchase Bill List (2.1) carries a documented filter set plus "Export to PDF" and "Export to Excel," per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). The set was expanded in this revision, most usefully with an ageing-bucket filter — this is a payables list, and it is worked by how overdue something is, not by supplier name.

**A small confirmation worth noting:** the source data's own example for a bill number was "INV-2024-001" — the same slightly confusing example first encountered while writing the Masters module's Number Prefixes table (Module 1, Section 3.6e), where it was reasoned to most likely be the vendor's own external reference rather than Meshrd's internal one, without being fully certain at the time. This module's brief confirms that reasoning was correct — the two-bill-number distinction above is exactly that split, made explicit.

## 6. Role-Based Access

- **Employee** — no access.
- **Manager** — no access.
- **Accountant** — add bills, record payments, track due/paid — the clear owner of this module.
- **HR** — no access.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Purchase Bill row: Super Admin = All, Employee = NA, Manager = NA, Accountant = partial (add, record payments, track due/paid), HR = NA. This matches the brief exactly.

### 6.1 "What Does Manager Mean" — The Complete, Confirmed Picture

This is the third and final financial module, and it completes the shape:

| Module | Manager's access |
|---|---|
| Customer, Opportunity, Vendor, Ticket, Project | Full |
| Payroll | Defaulted down from an originally broad grant |
| Invoice, Expense, Purchase Bill | None |

Across every module documented so far, the rule holds without exception: **Manager runs relationships and delivery, and has zero access to money movement.** Five modules give Manager full access because they're about the customer relationship or the work being delivered. Three modules give Manager nothing because they're about money leaving or coming into the company. Payroll fits the money side too, even though it was reasoned through differently (and correctly, in hindsight) before the pattern had enough data points to state outright. This isn't a working theory anymore — it's the confirmed access model for the Manager role across this entire CMS, and it's ready to be built as a single, consistent rule in the Roles & Access module rather than three (or six) separate case-by-case decisions.

### 6.2 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Require Attachment Before Marking a Bill Paid"** — OFF by default: Accountant can record a payment even without the scanned bill attached yet. Turned ON: the system blocks payment recording until the vendor's bill copy is attached.
- **"Lock Purchase Bill Once Fully Paid"** — OFF by default: the record stays editable even after reaching Paid. Turned ON: mirrors Invoice's lock-on-Paid behavior, for consistency between the two financial records.
- **"Give Manager Read-Only Access to Purchase Bills"** — OFF by default, consistent with the confirmed "no money movement for Manager" pattern. Turned ON: Manager can view bills and payment status without any edit rights — useful if the company wants operational visibility without financial control.

**Build status of these toggles:** the code matches every OFF default — payments can be recorded without an attachment, a Paid bill stays editable (no lock check on Edit), and Manager has no access. The toggle *runtime* itself (flipping these ON) is a systemic, documented deferral shared by every module's feature toggles, not a gap specific to Purchase Bill.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **HSN Code added at line-item level**, mirroring the same addition made for Invoice (Module 11) and for the same GST-compliance reasoning.
2. **Tax Amount stays manually overridable even after picking a rate**, since this bill already exists as a real document and the vendor's figure may not land exactly on a predefined Masters rate.
3. **No PDF "Download" generation** — unlike Invoice, there's no external party to send this to; the Attachment is the document that matters here.
4. **Bill Date cannot be in the future** — it's the date on a document that already exists. Built, on both create and edit.
5. **Status set (Unpaid / Part-Paid / Paid) is an inference**, explicitly flagged per the brief's own instruction, not taken directly from the source data. Built as inferred.
6. **Record Payment restricted to Unpaid/Part-Paid bills** — matching the equivalent restriction already used on Invoice. Built.
7. **Mode dropdown sources from the full Masters Payment Mode list**, matching Invoice's own Record Payment screen, rather than a separately hardcoded set. Built — payments reference a Masters Payment Mode.
8. **Overpayment blocked outright**, matching Invoice's same safeguard. Built — the ceiling is the net Balance Due, per Section 2.3.
9. **Confirmed against Sheet1** — the Purchase Bill row matches this brief's Role-Based Access exactly, completing the third and final confirmation of the "relationships and delivery, not money" rule for Manager (Section 6.1).
10. **A design decision independently validated**: the two-bill-number split (internal ID vs. Vendor Bill Number) resolves an ambiguity first noticed while writing the Masters module — this document confirms that early reasoning was correct.
11. **HSN Code on line items — confirmed correct**, no change needed. All other assumptions in this document reviewed and confirmed as-is; nothing else in this module required a decision the way Employee, Leave, Payroll, Vendor, Customer, Opportunity, Project, Invoice, and Expense each did.
12. **Export and filters confirmed** on the Purchase Bill List (2.1), per the system-wide convention (RBAC, Module 14, Section 2.2).

13. **This revision — filter set expanded with filter-based export, per explicit instruction.** This module has one list screen, and it had three filters (Supplier, Status, Year) covering no amount dimension, no due-date dimension, and no way to see what was overdue. Both an Overdue toggle and a full ageing-bucket filter are now present, matching what the Invoice module gained on the receivables side.

    Worth noting the asymmetry that existed before: the Invoice List already had an Overdue filter and this one didn't, even though the two screens are structurally mirror images. A company can see which customers owe it money and, until now, could not see which suppliers it owed — the less visible of the two failures, and the one that damages a relationship the company depends on.

14. **Reconciled against the built backend (2026-08-03).** Everything load-bearing in this document is built and marked as such inline: the four withholding rules and the payments-plus-withholding Paid rule (A276), the SUBTOTAL default persisted on Withholding Calculated On, the Edit endpoint with delta-based vendor rollups, no-head direct Tax Amount entry, Due Date auto-derivation from vendor Payment Terms, the future-Bill-Date and inactive-vendor rejections, server-side tax/withholding head validation, Paid From/Paid Into snapshots on payments, the effective Bank Account column on the list, Search plus multi-select Status filtering, and filter-following PDF/Excel export. Three code-only rules were added to the document from the build: the double-payment guard on the Expense link, the API-maintained vendor rollups, and the no-vendor-change / no-link-change rules on Edit. Deferred, each with its reason stated inline: the extended list filters of Section 2.1 (Due Date range, Amount/Outstanding ranges, Payment Mode, Bank Account filter, Created By, Financial Year), API-side pagination, and the server-side "Due Date after Bill Date" check.

---

## 8. Tax & Compliance — moved to Module 15

Section 8 briefly lived here on 2026-07-31, holding the withholding remittance and certificate screens. **It was promoted to its own module the same day**, when payroll withholding came into scope: a register fed by Purchase Bill, Payroll *and* Invoice has three counterparties and no natural owner among the three, and its counterparty — a tax authority — is a fourth party this CMS models nowhere else.

See **`15-tax-compliance-module.md`**, whose Section 1.1 records the full reasoning.

What stays in this module: the withholding fields on Add / Edit Purchase Bill (Section 2.2) and the payment behaviour on Record Payment (Section 2.3). Those are properties of a bill. What was withheld is a field here; what happens to it afterwards is Module 15.

---

**Suggested filename:** `13-purchase-bill-module.md`
