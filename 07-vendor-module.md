# Module 7 of 14: Vendor

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Vendor module.

## Implementation Status — Backend (verified 2026-08-03)

The backend for this module is built and tested — 8 API operations (list/create, get/update/delete, activate, deactivate, and the usage list) on a single `vendors` table — while the Angular frontend has not been started, so every screen below is backend-ready, not rendered UI.

**Built:**

- Vendor Directory as a list API: filters for Active/Inactive, Vendor Category, "has bank details on file" (available only to roles that can see banking fields), and "has outstanding bills" (usage history with an outstanding amount above zero), plus search across Vendor Name, GSTIN, and Bank Account Name; results sorted Vendor Name A→Z.
- Banking/GST masking exactly as 2.1 and 6.1 describe: GSTIN, PAN, Bank Account Name, Bank, Account Number, and IFSC are hidden from Manager by default via field-level RBAC rules (Layer-3 masking at the serialization boundary, so no individual endpoint can forget it) — on every read, on the Vendor Usage banking columns (Paid From, Paid Into, Account Number), and in exports. "Hidden" is literal: the fields are absent from the response, not blanked or starred. The masked account-number display ("HDFC ••••2201") is a computed column on the table and is now in the hidden set too (fixed 2026-08-05 — it had shipped without its own field-level RBAC entry, so it slipped past the raw-field masking under a different key name; a Manager's Directory response no longer carries it at all).
- The masking round-trips safely through edit: this backend's update is a full-replace PUT, so a role that cannot see the banking fields naturally echoes back its own view of them (absent/blank). The API treats that echo as "no change" and leaves the real stored values untouched; only an actual non-blank value sent by a role without the banking permission is refused. A hidden value can therefore never be wiped out — or guessed at — by an edit from a restricted role.
- Export to PDF and Excel of the filtered set on both the Directory and Vendor Usage, through the shared list-export service; a value hidden on screen never resurfaces in an export.
- Add / Edit with every 2.2 field plus Vendor Category, with the documented validations (GSTIN/PAN auto-uppercased and pattern-checked, 10-digit phone, 6-digit PIN, IFSC pattern, 9–18-digit account number, positive Payment Terms defaulting to 30, name 2–150 characters). The banking/GST split is enforced on both create and edit: a role without the banking permission cannot set or change those fields.
- Vendor Usage as a read-only list of linked Purchase Bills, Expense Claims, and Company Expenses, most recent first, with Type and Status (multi-select) filters and export — no totals, no charts, exactly as 2.3 keeps it. On Purchase Bill rows, Paid From, Paid Into, and the masked account number are carried from the latest recorded-payment snapshot and stay blank on unpaid rows. On expense rows, only Paid From is available — an expense records the paying account but takes no snapshot of the vendor's own account, so Paid Into and the account number are always blank there.
- Activate and Deactivate as dedicated actions; Deactivate accepts an optional reason and records who and when, and Activate clears that trail.
- The usage-gated delete: deleting a vendor with any usage history is rejected by the API itself with a conflict error, not just hidden in the UI. As a second line of defence, a delete that a database foreign-key constraint refuses (a reference the usage flag somehow missed) also comes back as the same clean conflict error, never a server error.
- The usage numbers on a vendor — purchase-bill count, expense count, the has-usage flag, outstanding amount, and total spend — are plain columns written by the Purchase Bill and Expense APIs as those records change, not database triggers or on-the-fly aggregation. "Has bank details" and the masked account-number display are the two exceptions: those are computed by the database from the stored account number.
- Inactive vendors are blocked from new Purchase Bills by the API itself — creating a bill against a deactivated vendor is rejected server-side, not merely hidden from the picker.
- Role access seeded per Section 6: Super Admin, Manager, and Accountant full; HR and Employee none; Manager holds edit/deactivate/activate but not the separate banking-edit action (6.1's first toggle, OFF by default). Delete carries no action of its own — it is gated by the same permission as deactivate, since the two are one decision split by usage.

**Deferred / not implemented:**

- Directory filters City/State, Payment Terms, and Created On date range — not built on the list endpoint; only the filters listed under Built exist.
- Vendor Usage filters beyond Type and Status — the date range with financial-year presets, amount range, Paid From account, and Reference Number search are not built.
- The Mode column on Vendor Usage is always blank — the payment mode is recorded on the payment record but not yet carried through to this list.
- The 6.1 toggles as runtime switches: the feature-toggle table exists but no runtime reads it anywhere in the system — each toggle's OFF default is encoded directly in the seeded role grants, and per-person overrides are the built mechanism for exceptions. Of this module's three, "Allow Manager to Edit Vendor Bank & GST Details" is the one built as a real switchable split (a separate banking-edit action Manager's role lacks by default); "Allow Hard Delete of a Vendor" has its OFF behavior hardcoded with no ON branch; "Require Approval to Add a New Vendor" has no approval workflow — vendors are created directly.
- The inline "+ Add New Vendor" modal (3.2) needs no backend of its own — the existing create API covers it and takes an inline marker so an inline-created vendor is recorded as such. The modal is frontend work.
- An Employee-accessible vendor picker for Expense Claims was flagged during review but deliberately not built: Employee has no vendor access at all (Section 6), and no reduced name-only lookup endpoint exists for them. An Employee's expense claim cannot name a vendor until a role with vendor access attaches one, or until such a picker is built.

**Differs from this document:**

- 2.1 says the export carries "the same column visibility the screen has" — the built export is a fixed column set (Vendor Name, GSTIN, Status, Outstanding), with a hidden value exporting blank; bank columns are not in the export for any role. The usage export is likewise fixed at Document, Date, Amount.
- 2.1's filter paragraph says search covers "Vendor Name and GSTIN" — the built search also matches Bank Account Name, as 2.1's own search-box note already assumed.
- The Manager-hides-the-filter rule for "has bank details" is enforced by the API silently ignoring the parameter for a role without the banking permission, rather than returning an error.
- 2.2 lists Status as a form field — in the backend it is not part of the create/edit payload; it defaults to Active and changes only through the dedicated Activate/Deactivate actions.
- 3.3's "no longer appears in the picker on new Purchase Bills or Expenses" is server-enforced only for Purchase Bills — billing an inactive vendor is rejected by the API. On Expenses, keeping a deactivated vendor out of selection remains a picker (frontend) concern; the expense APIs accept any existing vendor id.
- On usage rows for expenses, the Reference Number is the internal record id — expenses carry no document code to show.
- List endpoints return the full filtered set; pagination is a client-side concern here, as it is throughout this backend.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Vendor Directory](#21-vendor-directory)
   - 2.2 [Add / Edit Vendor](#22-add--edit-vendor)
   - 2.3 [Vendor Usage](#23-vendor-usage)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

Vendor is the supplier master list — the people or companies Meshrd buys from. It's deliberately simple: a directory of suppliers with their tax and payment details, used by the Purchase Bill and Expense modules whenever a bill or a company expense needs to be tied to who it was paid to.

Unlike almost every other module in this CMS, Vendor doesn't depend on any Masters configuration — it's a standalone list. There's also no personal "my own vendor" concept the way there is with leave or a payslip: vendor data isn't tied to an individual staff member, it's shared company procurement data. So there's no self-service baseline to design here — access is role-based from the start, and this document is correspondingly short. This module has nothing to do with Meshrd's retail hardware products or who Meshrd sells to — only who Meshrd buys from.

## 2. Screens

### 2.1 Vendor Directory

**What it's for:** The searchable list of every supplier Meshrd has on file.

**Who can open it:** Manager, Accountant, Super Admin. Employee and HR have no access — there's no personal reason a staff member needs to see supplier bank or tax details.

**Columns shown:**

| Column | Notes |
|---|---|
| Vendor Name | — |
| GSTIN | — |
| Contact Phone / Email | — |
| Payment Terms | Shown in days, e.g. "30 days" |
| Bank Account Name | Added 2026-07-31. **The name on the account** — who the money is actually paid to, e.g. "Chola Technologies Pvt Ltd". This is the primary banking column; see the note below |
| Bank | The bank the account is held at, e.g. "HDFC Bank" |
| Account Number | Masked to the last four digits (e.g. "HDFC ••••2201") — enough to distinguish which of that party's accounts is on file, without exposing a full account number on a list screen |
| Status | Active / Inactive, shown as a colored tag |

**Why the account NAME is the column that matters, corrected 2026-07-31.** This screen originally showed only a masked account number, which answers the wrong question. A masked number tells you nothing a person can verify — "HDFC ••••2201" is not something anyone recognises, and it cannot be checked against anything. **The name on the account is what a person actually verifies before releasing a payment**, and a name that does not match the vendor is the single clearest sign that something is wrong: a changed bank detail, a mistyped entry, or a fraudulent payee. The number is still shown, but as the secondary column it should always have been — it distinguishes *which* of that party's accounts is on file, once the name has already established *whose* account it is.

All three banking columns are withheld from Manager, on the same rule as GSTIN — see the exception note below.

**Search box:** Assumption — searches Vendor Name, GSTIN, and Bank Account Name.

**Filters:** Active / Inactive, plus — added in this revision — Vendor Category or Type where one is recorded, City/State, Payment Terms, Created On date range, "has bank details on file" (Yes/No), and "has outstanding bills" (Yes/No). The last two are the questions this directory is actually opened to answer: who can we pay, and who do we owe. Search covers Vendor Name and GSTIN as before. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Available to every role that can open this screen** — Manager, Accountant, and Super Admin. **One exception applies, and it mirrors the existing field-level rule:** where the "Allow Manager to Edit Vendor Bank & GST Details" flag is off, Manager cannot see bank and tax fields, so the "has bank details on file" filter is hidden from Manager too. The field's visibility decides; the filter follows. Every other filter is identical for all three roles.

**Export:** "Export to PDF" and "Export to Excel" of the filtered set, carrying the same column visibility the screen has — a Manager's export contains no bank or GST columns when those are hidden.

**Sort:** Assumption — Vendor Name (A→Z / Z→A).

**Buttons:** "+ Add Vendor" (opens 2.2 in create mode). Row click opens 2.2 in edit mode.

**Empty state:** "No vendors yet — they're often added directly from a Purchase Bill or Expense instead."

**Pagination:** Standard controls, 25 per page by default.

---

### 2.2 Add / Edit Vendor

**What it's for:** Creating a new supplier record, or editing one that already exists.

**Who can open it:** Manager, Accountant, Super Admin can add and edit. Bank and GST fields are Accountant/Super-Admin-only by default — see Section 6 for the exact split and the toggle that changes it.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Vendor Name | Text | Y | 2–150 characters |
| GSTIN | Text | N | Exactly 15 characters, standard GSTIN pattern (2-digit state code, 10-character PAN, 1 entity code, 1 fixed character, 1 checksum character), auto-uppercased |
| PAN | Text | N | Exactly 10 characters, standard PAN pattern (5 letters, 4 digits, 1 letter — e.g. AAAAA9999A), auto-uppercased |
| Contact Email | Email | N | Standard email format |
| Contact Phone | Phone | N | 10-digit Indian mobile number |
| Payment Terms (days) | Number | N | Positive whole number, e.g. 30. Assumption: defaults to 30 if left blank, matching the example given, so Purchase Bill has something sensible to calculate a due date from |
| Address — Street | Text | N | — |
| Address — City | Text | N | — |
| Address — State | Dropdown (Indian states/UTs) | N | — |
| Address — PIN Code | Text | N | Exactly 6 digits. Added in this revision — every other address in this CMS (Customer, Company Profile) includes one; this was a genuine omission, now fixed |
| Bank Account Number | Text/Number | N | Numeric, checked for a plausible length. This is the **vendor's own** account, for Meshrd to pay them — a completely separate thing from the Bank Account sub-master in Masters, which only holds Meshrd's own accounts |
| IFSC Code | Text | N | Exactly 11 characters, standard IFSC pattern (4 letters, then "0," then 6 alphanumeric characters). Added in this revision — without it, a Bill Payment couldn't actually be routed by NEFT/RTGS; this was a genuine gap, now fixed |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

No auto-generated code (like Customer Code or Asset Tag) applies here — consistent with this module having no Masters dependency, a vendor is identified by its Vendor Name and an internal record ID, not a financial-year-based code.

**Delete vs. Deactivate (a correction the source sheet needed):** the source spreadsheet lists "delete" as a plain capability, but a vendor can be linked to Purchase Bills and Expenses, and deleting one that's already in use would break that history. This document draws the line by usage:

- **A vendor with any usage history** (any linked Purchase Bill or Expense — see 2.3) can only be **Deactivated**, never deleted. Deactivating hides it from selection on new Purchase Bills/Expenses but keeps every past record pointing at it intact.
- **A vendor with zero usage history** can be genuinely deleted, since nothing depends on it yet.

Both actions show a confirm-before-you-go prompt (Section 4). The Delete button is simply not shown (or is disabled with an explanatory tooltip) once a vendor has any usage at all.

**Buttons:** Save, Cancel, Deactivate/Activate, Delete (only shown for a vendor with zero usage history).

---

### 2.3 Vendor Usage

**What it's for:** A read-only view of everywhere a vendor has actually been used — the thing that tells someone whether it's safe to deactivate or delete.

**Who can open it:** Same as who can view the vendor record — Manager, Accountant, Super Admin.

**Where it lives:** a tab or section on the vendor's own record (2.2), not a separate standalone screen.

**List:** Type (Purchase Bill / Expense), Reference Number, Date, Amount, **Mode**, **Paid From (Meshrd Account)**, **Paid Into (Vendor's Account Name)**, **Account Number**, Status — one row per linked record, most recent first.

**The two account columns, added 2026-07-31, and why both are needed.** "How much have we spent with this vendor" was already answerable here; "*which of our accounts did it leave from, and where did it land*" was not, and that is the question asked whenever a payment is queried or a statement is reconciled. **Paid From** is the Meshrd account the money left, carried through from Record Payment (Module 13, Section 2.3). **Paid Into** is the supplier's own account it arrived in, carried through from the vendor's Bank Details (2.2) — **named first, numbered second, for the reason set out in 2.1.** It is shown here rather than only on the vendor record so that a historic payment still shows where it actually went, even after the vendor later changes their account details: the name recorded against a past payment is the evidence that it went to the right party at the time.

Both columns are empty on a row that has not been paid, and that is the point: an Unpaid bill with no account is correct, a Paid one without an account is a gap worth seeing.

**Visible to Accountant and Super Admin only.** Manager can open Vendor Usage and see what was bought and for how much, but not the banking columns — the same line already drawn on the Vendor Directory (2.1), where GSTIN and bank details are withheld from Manager.

**Filters — added in this revision, replacing the earlier "no filters" note.** Type (Purchase Bill / Expense), Status (multi-select), Date range with financial-year presets, Amount range, and **Paid From account**. Search covers Reference Number. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2), which applies to this screen as to every other list in the CMS.

This document previously described Vendor Usage as "a simple list, not a report — no totals, filters, or charts." The filters part no longer holds: a vendor used for three years is a long list, and "what did we buy from them this financial year" is the obvious question. Deliberately kept from the earlier note: still **no totals and no charts** — that stays a list of linked records, not a spend report, since spend reporting belongs to Purchase Bill and Expense.

**Export:** "Export to PDF" and "Export to Excel" of the filtered list.

**Empty state:** "No usage yet — this vendor can be safely deleted if no longer needed."

---

## 3. Workflows

### 3.1 Adding a New Vendor from the Vendor Directory

1. Manager, Accountant, or Super Admin opens the Vendor Directory (2.1) and clicks **+ Add Vendor**.
2. They fill in at least the Vendor Name, and whatever else is known at the time.
3. Saving creates the record at Status = Active, with no usage history yet.

### 3.2 Adding a New Vendor Inline, from Purchase Bill or Expense

1. While filling in a Purchase Bill or an Expense, the person reaches the Vendor field and doesn't find the supplier they need in the dropdown.
2. They choose **"+ Add New Vendor"** directly from that same dropdown, which opens a small inline form as a modal — Vendor Name and whatever else is quick to capture in the moment — without leaving or losing progress on the Purchase Bill/Expense form underneath.
3. Saving the modal creates the vendor and immediately selects it back on the original form, which the person then continues filling in as normal.
4. The rest of the vendor's details (bank account, full address, GSTIN if not captured yet) can be completed later from the Vendor Directory (2.1) — the inline add is meant to be fast, not complete.

### 3.3 Deactivating a Vendor with Usage History

1. Manager, Accountant, or Super Admin opens the vendor's record and checks Vendor Usage (2.3) to see what's linked.
2. If anything is linked, they click **Deactivate** instead of Delete (Delete isn't available once usage exists).
3. A confirm-before-you-go prompt explains that this hides the vendor from new selection but keeps all past Purchase Bills and Expenses pointing at it correctly.
4. Once confirmed, Status becomes Inactive; the vendor no longer appears in the picker on new Purchase Bills or Expenses, but every existing record referencing it is untouched.

## 4. UI/UX Notes

- **Keep this module simple** — a list and a form, nothing more. No dashboard, no reports screen; that level of detail belongs to Purchase Bill and Expense, which are where the money actually moves.
- **Empty state:** "No vendors yet — they're often added directly from a Purchase Bill or Expense instead."
- **Confirm-before-you-go prompt** before deactivating or deleting a vendor with usage history — and Delete is simply unavailable once any usage exists, rather than allowing the action and warning after the fact.

## 5. Connected To / Depends on Masters

Connected To: Purchase Bill, Bill Payment, Expenses (optional — an expense doesn't require a vendor)

Depends on Masters: None — this module is a standalone list

**One clarification worth stating plainly:** the Bank Account Number field on a vendor's own record (2.2) is unrelated to the Bank Account sub-master in Masters (Section 3.7) — that sub-master only ever holds Meshrd's *own* accounts, used for receiving payments on invoices and paying expenses/purchase bills from. A vendor's bank details are just a plain field on their own record, not a link into that master. Worth keeping distinct, since the two are easy to conflate by name alone.

## 6. Role-Based Access

- **Employee** — no access. There's no personal reason a staff member needs to see supplier bank or tax details.
- **Manager** — full access: add, edit, deactivate vendors.
- **Accountant** — add/edit suppliers, including bank and GST details.
- **HR** — no access. Vendors aren't an HR concern.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Vendor row: Super Admin = All, Employee = NA, Manager = All, Accountant = partial (add/edit suppliers, bank & GST details), HR = NA. This matches the brief exactly — no correction needed.

**On "what does Manager mean" here specifically:** this is the third module in a row where that question has come up directly (first flagged in Ticket, Module 4; it also affected Payroll, Module 6). Interestingly, it resolves differently each time on purpose: Payroll defaulted Manager's originally-broad access *down* to a status-only view, because salary is sensitive personal data. Here, Manager's broad "add, edit, deactivate" access is kept exactly as the source sheet gives it, because vendor and procurement data doesn't carry the same personal-privacy weight that payroll does. That's not an inconsistency to resolve — it's a reasonable sign that "what Manager can see company-wide" should be judged per module, based on what the data actually is, rather than forced to a single global rule.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Allow Manager to Edit Vendor Bank & GST Details"** — OFF by default: Manager manages contact and general info, but bank and tax fields stay Accountant/Super-Admin-only. Turned ON: Manager gets full edit rights, matching the source sheet's original grant.
- **"Allow Hard Delete of a Vendor"** — OFF by default: a vendor with usage history can only be deactivated. Turned ON: allows deletion regardless — not recommended once a vendor has been used.
- **"Require Approval to Add a New Vendor"** — OFF by default: any role with vendor access can add one directly. Turned ON: new vendors need Accountant or Super Admin sign-off before they can be used on a Purchase Bill — a common safeguard against fake-vendor fraud.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **IFSC Code — added, resolved.** Was missing, now a real field on the vendor record (2.2). No longer flagged as a gap.
2. **PIN Code — added, resolved.** Was missing from the Address fields, now included (2.2). No longer flagged as a gap.
3. **Payment Terms defaults to 30 days if left blank** — not explicitly stated, added so Purchase Bill has a sensible number to calculate a due date from even if this field is skipped.
4. **No Masters-driven Vendor Code** — confirmed deliberate, consistent with this module's explicit lack of Masters dependency, unlike Customer/Asset/Ticket/etc.
5. **Inline "Add New Vendor" from Purchase Bill/Expense** — assumed to be a lightweight modal (Vendor Name plus whatever's quick to capture), not the full form, so it doesn't derail whatever the person was doing on the Purchase Bill or Expense. The full record gets completed later from the Vendor Directory.
6. **Checked directly against Sheet1** — the Vendor row matches this brief's Role-Based Access exactly, and also confirms "delete" was literally in the source data (Sheet1: "Add, view, edit, delete suppliers"), so the Deactivate-instead-of-Delete correction in this document is a deliberate, already-resolved fix from the brief, not a new finding.
7. **Export and filters confirmed** on the Vendor Directory (2.1), per the system-wide convention (RBAC, Module 14, Section 2.2).

8. **This revision — filters expanded on both list screens, for all roles, with filter-based export, per explicit instruction.** The Vendor Directory had exactly one filter (Active/Inactive) and Vendor Usage had none — this document explicitly said it had none, describing it as "a simple list, not a report."

    That description has been partly revised: Vendor Usage now has filters and export, but deliberately still has **no totals and no charts**. The original reasoning for keeping it simple was sound — spend reporting belongs to Purchase Bill and Expense, not here — and adding filters doesn't turn a list into a report. Flagged because it's a case where an earlier deliberate decision was narrowed rather than reversed.

    **The Directory's two most useful new filters are "has bank details on file" and "has outstanding bills"** — the questions the screen is actually opened to answer. The first is hidden from Manager whenever the existing "Allow Manager to Edit Vendor Bank & GST Details" flag is off, following the field's own visibility rather than adding a new restriction.

---

**Suggested filename:** `07-vendor-module.md`
