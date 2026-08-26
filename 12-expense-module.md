# Module 12 of 14: Expense

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Expense module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [My Expenses (Self-Service)](#21-my-expenses-self-service)
   - 2.2 [Expense Approvals](#22-expense-approvals)
   - 2.3 [All Expenses / Summary](#23-all-expenses--summary)
   - 2.4 [Company Expenses](#24-company-expenses)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

Expense covers small day-to-day company spending — tea, snacks, minor purchases — logged with a receipt and approved before it's booked. Every person in the system files these the same way, regardless of role; only reviewing and approving other people's expenses differs.

This module is only about small internal company spending — nothing here relates to Meshrd's retail hardware products.

## 2. Screens

### 2.1 My Expenses (Self-Service)

**What it's for:** Submitting your own expense claims and tracking their status — identical for every role.

**Who can open it:** All 5 roles, for their own expenses.

**"Add Expense" button** opens a form:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Type | Dropdown (from Masters → Expense Types) | Y | Active types only, each shown with its Claim Type. **Reimbursable** types are listed for every role; **Company-Paid** types are listed only for Super Admin and Accountant — see 2.4. **Built — and enforced server-side, not just in the dropdown:** the API (`POST /expenses`) checks the submitter's role and returns 403 if anyone other than Super Admin or Accountant submits a Company-Paid type |
| Claim Type | Read-only, derived from Type | — | Never chosen separately. Reimbursable enters the reimbursement queue and ends in a payout to the claimant; Company-Paid skips that queue entirely and is settled from the company account below |
| Vendor | Dropdown (from the Vendor module) | N | Optional vendor reference — **built** as an optional `vendor_id` on the claim; picking one also updates the vendor's usage rollup (expense count / has-usage-history). **Deferred:** the claim-side vendor picker itself (and its inline "+ Add New Vendor" modal, the Module 7 §3.2 pattern) was flagged during build and deliberately not built — see Workflow 3.2 |
| Amount | Number (INR) | Y | Must be a positive number. This is the total the claimant actually paid, tax included |
| Tax | Dropdown (from Masters → Taxes, Section 3.2 — Purchase scope heads in force on the expense date), plus a directly-enterable Tax Amount | N | **Built** as optional `tax_head_id` + `tax_amount`. When a head is supplied, the API validates it through the shared tax-head usability check (`validate_head_usable`): the head must exist, carry Purchase or Sales-and-Purchase scope, and be in force on the expense date — otherwise 422 |
| Date | Date | Y | Cannot be in the future |
| Linked Purchase Bill | Dropdown (from Purchase Bill, Module 13) | N | Optional. Links this claim to the supplier's own bill for the same spend — see "Why the Purchase Bill link exists" below. **Built as a genuinely two-way link:** creating a claim with a linked bill writes BOTH foreign keys — the claim's `linked_purchase_bill_id` and the bill's `linked_expense_claim_id` — in the same transaction, and returns **409** if that bill is already linked to a different claim |
| Description | Text area | **Y** | **Built as required** (the API schema rejects a claim without one). **Changed in this revision — was optional.** This is the line the approver reads and the line that appears on the bank-statement export, so the amount and type alone are not enough: say what it was for, where, and for whom. A claim with no usable description is the commonest reason an approval stalls |
| Receipt | File upload (image or PDF) | N | Not required to submit — see the approval-side toggle in Section 6 for whether it's required before approval |
| Bank Account | Not on the create form as built | — | **Corrected against the code:** the submission API carries no bank-account field at all. A claim's Bank Account is set in exactly one place — the required "Reimbursed From" field of Mark as Reimbursed (2.3) — which is what guarantees a **Reimbursed** claim always has one and a Pending/Approved/Rejected claim never does. (Company-Paid spend records its account via the Company Expense pay step, 2.4.) The earlier idea of an optional bank account chosen at submission time was not built |

**Why the Purchase Bill link exists (and why it is optional).** The same piece of spending can legitimately reach the system twice: once as a staff claim (someone paid the office Wi-Fi bill on a personal card) and once as the supplier's own invoice, recorded as a Purchase Bill. Nothing about either record reveals that they are the same money. Linked, the two settle as a single amount and each shows the other on its own record; unlinked, the company pays both — the claimant *and* the supplier — and the duplication only surfaces at reconciliation, if at all.

It stays **optional** because most claims have no supplier bill behind them at all — a taxi fare, a team lunch — and making the field mandatory would force a meaningless "None" on the majority of claims to catch the minority. The same link can be made from the other side, on the Purchase Bill itself (Module 13, Section 2.2), and either direction populates both records.

**A cross-document inconsistency found and closed while reworking the tax design.** The Masters module has always listed Expense as a consumer of its Taxes sub-master — first as "Expense (tax on purchases)," and now under the Purchase scope — but this module's form never had a tax field at all. One of the two documents was wrong, and it was this one: a company that recovers tax on its purchases needs the tax component of a claim recorded, not just the total.

Closed conservatively, because this is an expense claim rather than a formal purchase document:

- **The Tax field is optional and never blocks a submission.** Someone claiming a taxi fare should not be stopped by a tax question.
- **Amount stays the full amount paid.** The tax figure is recorded alongside it as a component, not added on top — unlike Invoice and Purchase Bill, where tax increases the total. Getting this backwards would inflate every reimbursement, so it is stated explicitly rather than left to inference.
- **If no Purchase-scope tax head is configured, the field does not appear**, and this screen behaves exactly as it did before — which is also the correct behaviour for a company that has not established whether it deals with purchase taxes at all.

Worth confirming during grooming: whether expense claims should carry tax at all here, or whether anything tax-recoverable is expected to go through Purchase Bill (Module 13) instead. The optional field above is the low-risk answer to a genuine documentation conflict, not a decision that the workflow needs it.

**Status is never set by the person submitting.** It defaults to Pending automatically the moment the form is saved, and only changes when someone with approval rights acts on it (2.2). **Built:** the API stamps `PENDING` and the submission timestamp itself; the create body has no status field. Expense Date is validated server-side — a future date is rejected with 422.

**Company-Paid routing, as built.** When the chosen Type is Company-Paid (and the role check above passes), `POST /expenses` creates the claim **and, in the same transaction, a Company Expense row (2.4)** linked back via `source_expense_claim_id` — the claim never enters the reimbursement queue (the Approvals and All Expenses lists filter to Reimbursable only). The Purchase-Bill two-way link sync and the vendor usage rollup run on this path identically to the Reimbursable one — a Company-Paid claim spending against the same vendor bill needs the same double-payment protection.

No formal auto-generated code applies here (unlike Invoice or Purchase Bill) — an expense is an internal claim, never a document shared with anyone outside the company, so there's no numbering convention to define; it's identified by an internal record ID.

**Expense history table:** past submissions — Type, Vendor, Description, Linked Purchase Bill, Amount, **Bank Account**, Date, Receipt, Status (Pending / Approved / Reimbursed / Rejected).

**Bank Account is a column, not just a form field.** An employee chasing a reimbursement is asking a bank question — *which account did it come from, and can I find it on my statement?* — and answering that from a claim list that shows only Type and Amount is impossible. The column stays blank until the claim is actually Reimbursed, which is precisely what makes it useful: a blank Bank Account on an Approved row is the visible marker that the money has not moved yet.

**Filters — as built** (`GET /expenses/me`): **Status (multi-select)** and **Type**, with export following exactly those filters. An "awaiting reimbursement" check is expressible today as `status=APPROVED`.

**Deferred (documented above, not built):** Vendor, Expense Date range, Amount range, "has receipt attached" (Yes/No), a dedicated "awaiting reimbursement" shortcut, Bank Account, Financial Year, and free-text Search over Description/Vendor Name. Reason: the built filter set covers the working questions this self-service screen answers (what's still pending, what of a given type), and the richer set was cut to keep the list endpoints uniform; the underlying columns (including `has_receipt` and `bank_account_id`) are already returned per row, so these are additive filter parameters when picked up. No Employee filter appears here, since every row is already theirs; the All Expenses view (2.3) has one.

**Export — built:** `format=pdf` and `format=excel` on the list endpoint export the filtered history (columns: Expense Type, Vendor, Date, Amount, Status), with a header block naming the filters applied — plus **"Export Statement"**, described next.

**Export Statement — a bank-statement-shaped export.** The ordinary exports reproduce the table as it appears on screen, which is the right answer for a claim record and the wrong one for reconciliation. Export Statement re-shapes the same filtered rows into the columns a bank statement actually has, in date order:

| Column | Source | Notes |
|---|---|---|
| Date | The expense Date | Ascending, oldest first — the opposite of the on-screen default, because a statement reads forward |
| Description | Description, prefixed with the Expense Type | This is why Description became mandatory: a statement line reading only "Travel" reconciles against nothing |
| Bank Account | Bank Account | Filter to a single account before exporting and the running balance below becomes meaningful |
| Reference | Expense Record ID, and the Linked Purchase Bill where one exists | The audit handle back into the system |
| Debit | Amount | Money leaving the account. There is no Credit column — an expense never adds to a balance |
| Running Balance | Computed down the filtered rows | Opening balance is taken as zero unless a single account is filtered, in which case it is that account's opening balance for the period |

Only rows whose status is **Reimbursed** carry a Bank Account and therefore a real statement line. **As built** (`GET /expenses/export-statement`, `format=pdf|excel` or JSON): the statement selects **Reimbursed rows only** — Pending, Approved and Rejected rows are omitted from the statement entirely rather than exported with a blank Bank Account, a slightly stricter reading than the paragraph above (the balance-distortion outcome is the same: they never touch the running balance). It takes its own date-range filter (`date_from` / `date_to`); the Description column is the Expense Type prefixed onto the Description, and Reference is the record ID plus the Linked Purchase Bill ID where one exists, both exactly as specified. The running balance opens at zero; the single-account opening-balance refinement is **deferred** along with the Bank Account filter it depends on.

**Buttons:** Add Expense, Save, Cancel.

**Empty state:** "No expenses submitted yet."

---

### 2.2 Expense Approvals

**What it's for:** The queue where someone with approval rights actually decides Pending expenses.

**Who can open it:** Accountant, Super Admin.

**A genuine correction to the source data, worth stating plainly:** the source spreadsheet gives Employee "no approve" explicitly, but doesn't give anyone else an approve action either. Manager is NA on this module entirely — consistent with Manager having no access on Invoice or Purchase Bill either (Section 6). Accountant's listed access was "add & view all, summary," with no approve verb written down anywhere. Since something has to actually approve expenses for the system to function, this document assigns that responsibility to Accountant, who already owns the elevated side of this module, with Super Admin as the fallback if Accountant is unavailable — the same fallback pattern already used for HR in the Leave module's routing rule (Module 5).

**Columns:** Employee, Type, Amount, Date, Receipt (viewable inline, or one click away — never buried behind extra navigation, see Section 4), Status.

**As built** (`GET /expenses/approvals`): the queue is **Pending, Reimbursable claims only** — Company-Paid rows never appear here (see 2.1's routing note), ordered oldest submission first. Each row also carries a `has_receipt` flag and the vendor, and the pdf/excel export adds a Vendor column to the list above.

**Actions — Approve / Reject** (`POST /expenses/{id}/approve` and `/reject`, each behind its own RBAC action on the `expense.approvals` screen): Reject requires a reason (flipped from optional to required in this revision, for consistency with Documents and Asset Requests elsewhere in this CMS, and matching the same change made to Leave's rejection flow, Module 5). **Built:** a blank reason is rejected with 422, and acting on anything other than a Pending claim returns 409.

**On Approve:** Status becomes Approved (approver and timestamp recorded) — the expense is reviewed and accepted, but this is distinct from money having actually moved. See Reimbursement, Section 2.3. The submitter is notified. **Built.**

**On Reject:** Status becomes Rejected, with the reason stored; no further action happens to it. The submitter is notified with the reason. **Built.**

**Filters — as built:** **Employee** and **Type**, with the pdf/excel export following them (a Status filter would be meaningless here — the queue is Pending by definition). **Deferred (documented, not built):** Department, Vendor, Amount range, Submitted Date range, "has receipt attached" (Yes/No), "pending more than N days," and free-text Search over Employee Name / Vendor / Description. Reason: the queue is naturally small (Pending only), so Employee + Type already narrow it to a working size; `has_receipt` is returned on every row for the frontend to filter client-side until the parameter lands.

**The receipt filter is the one this queue most needed** — Section 6 carries a toggle for whether a receipt is required before approval, and without a way to filter on it, an approver has no means of finding the claims that rule affects. Note, however, that the toggle itself is also not yet built (Section 6.1), so the filter's absence blocks nothing today; the two should land together.

**Empty state:** "No pending expenses."

---

### 2.3 All Expenses / Summary

**What it's for:** The full, company-wide expense list, a lightweight spend summary, and — new in this revision — marking approved expenses as reimbursed.

**Who can open it:** Accountant, Super Admin.

**List:** every **Reimbursable** claim, company-wide — Employee, Type, Vendor, Amount, Date, Status. **As built** (`GET /expenses`): Company-Paid spend is excluded by design — it lives on its own screen (2.4) and would otherwise sit in a reimbursement-shaped list.

**Filters — as built:** **Status (multi-select)**, **Type**, **Employee**, **Vendor**, **Expense Date range** (`date_from`/`date_to`), and free-text **Search** (added 2026-08-05 — matches Description and Expense Type on the three Expense Claim–backed list screens; Company Expenses' search matches Description only, since that table has no name-snapshot columns to search without a join), with the pdf/excel export following them. **Deferred (documented, not built):** Department, Amount range, Approved By, Approval Date range, Bank Account, "has receipt attached" (Yes/No), "pending more than N days," Financial Year. Reason: the deferred ones need joins (Department), derived predicates (pending-N-days), or a column the row doesn't carry, and were cut uniformly across the module's list endpoints. The receipt filter still earns its place when it lands, for the Section 6 receipt-required toggle to be actionable — but that toggle is itself not built yet (6.1).

**Available in full to every role that can open this screen** — Accountant and Super Admin. The Manager direct-reports scoping described earlier does not apply as built (Manager has no access to this screen at all, per Section 6), and Super Admin's extra Created By / Last Modified By / all-financial-years filters are **deferred** with the rest.

**Status, extended:** Pending / Approved / Reimbursed / Rejected. **Reimbursed is new — resolves the previously-open question of whether Approved meant money had actually moved.** It didn't; now there's a distinct step for it.

**"Mark as Reimbursed" action**, available on any Approved expense:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Reimbursed Date | Date | Y | Defaults to today |
| Mode | Dropdown (from Masters, Section 3.8) | Y | How the reimbursement was paid out |
| Reimbursed From (Bank Account) | Dropdown (from Company Profile, Section 3.7 — Active accounts) | **Y** | **Added 2026-07-31 — this was the gap.** This is the one screen where an expense's Bank Account is actually set: My Expenses and All Expenses (2.1, per the field table there) only show a Bank Account once Status reaches Reimbursed, and nothing upstream of this screen ever populated it. Required, because a real reimbursement has to leave a real account — this is also what the bank-statement export (2.1) reconciles against |
| Reference | Text | N | e.g. a transaction ID |

**As built** (`POST /expenses/{id}/mark-reimbursed`, behind the `mark_reimbursed` RBAC action on this screen): all four fields exist exactly as tabled — Reimbursed From is **required by the API schema**, closing the gap the 2026-07-31 note describes. The action is only available on an Approved claim (409 otherwise), writes a full **Expense Reimbursement record** (date, amount, mode, account, reference, who and when), stamps the claim's Bank Account from Reimbursed From, sets Status to Reimbursed, and notifies the claimant.

**The double-payment gate (shared with Purchase Bill).** Before anything is written, the shared finance link guard runs: if this claim's **Linked Purchase Bill already carries a live (non-reversed) payment**, the reimbursement is refused with **409** — reimbursing the claim too would settle the same spend twice; reverse the bill payment or remove the link first. The mirror check runs on the Purchase Bill side (Module 13): recording a payment against a bill whose linked claim is already reimbursed is refused the same way. This is the mechanism that makes the 2.1 link an actual control rather than an informational cross-reference.

Marking this sets Status to Reimbursed. Assumption: this is a manual confirmation step (Accountant/Super Admin marking that a real payment happened), not an automated payment trigger — this module tracks that reimbursement occurred, it doesn't move money itself, consistent with how the rest of this CMS treats Record Payment / Mark as Reimbursed actions as confirmations of something that happened elsewhere (a bank transfer, a cash handout), not payment-initiation.

**Summary view — built** (`GET /expenses/summary`): total spend by Expense Type and total spend by month — simple totals, not a full analytics dashboard. "Spend" means Approved + Reimbursed combined (money committed to), with a separate, smaller `total_reimbursed` figure for Reimbursed-only (money actually paid out), so the two aren't conflated — implemented exactly as the assumption stated. Reimbursable claims only; Company-Paid spend is not mixed in.

**Buttons:** "Export to PDF" and "Export to Excel," alongside "Download," per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2) — exporting exactly the filtered set shown, with a header block naming the filters that produced it.

**Empty state:** "No expenses recorded yet."

---

### 2.4 Company Expenses

**What it's for:** Meshrd's own running bills — internet / Wi-Fi, electricity, office rent, telephone, cloud hosting, housekeeping. These are the expenses where **the company itself was billed**, not an employee. Nobody paid out of pocket, so nobody is owed a reimbursement.

**Who can open it:** Super Admin and Accountant only. Manager, HR and Employee have no access, and it does not appear in their navigation — a running office bill is not any employee's business, and unlike a claim there is no personal stake to justify a self-service view.

**Why this is a separate screen rather than a filter on 2.3.** The two kinds of expense look identical in a table and behave nothing alike. A staff claim ends in money going *to a person* and has an approval queue, a claimant, and a receipt that person uploaded. A company bill ends in money going *to a supplier*, has no claimant at all, and its "receipt" is the supplier's invoice. Mixing them puts an office rent payment in the reimbursement queue next to a taxi fare, where the only thing stopping someone reimbursing it is that they noticed. Splitting them makes the distinction structural instead of a matter of attention.

**How a row gets here:** entirely from its Expense Type. Types carry a **Claim Type** in Masters (Section 3.3) of either *Reimbursable* or *Company-Paid*; every Company-Paid row appears here and nowhere in the reimbursement flow. The type is the classification — and it is enforced in both directions as built: a Company-Paid type submitted through My Expenses (by Super Admin/Accountant only, 403 otherwise) auto-creates a row here linked via `source_expense_claim_id`, and `POST /company-expenses` **rejects any type that is not Company-Paid with 422** — a Reimbursable type filed here would bypass the reimbursement queue it's supposed to go through.

**List:** Expense Type, Vendor, Linked Purchase Bill, Amount, **Paid From (Bank Account)**, Date, Bill Attached, Status.

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Expense Type | Dropdown (from Masters → Expense Types, Section 3.3) | Y | Company-Paid types only |
| Vendor | Dropdown (from the Vendor module) | N | The supplier who issued the bill. Usually present here, unlike on a staff claim |
| Linked Purchase Bill | Dropdown (from Purchase Bill, Module 13) | N | Where the supplier also raised a formal bill for the same spend |
| Amount | Number (INR) | Y | Positive |
| Paid From (Bank Account) | Dropdown (from Company Profile, Section 3.7 — Active accounts) | N while Pending | Which company account settles it. Matters more here than on a staff claim: this *is* the payment record, there is no separate reimbursement step behind it |
| Date | Date | Y | Cannot be in the future (422, same rule as claims) |
| Bill Attached | File upload | N | The supplier's invoice — the audit source document. Built as `bill_stored_file_id`, with a `has_bill_attached` flag on every row |
| Tax / Tax Amount | Same optional pair as 2.1 | N | **Code-only addition:** `tax_head_id` + `tax_amount` exist here too, keeping the two expense shapes symmetric |
| Billing Period (Month / Year) | Two numbers | N | **Code-only addition** supporting the Recurring note below: `billing_period_month` + `billing_period_year` record which month's bill this row is, so an expected bill that never arrived is findable as an absence |

**Statuses and lifecycle, as built:** a Company Expense is **Pending / Paid / Cancelled** — there is no approval queue and no Reimbursed state here, because nothing is owed to a person. Two actions, both Pending-only (409 otherwise), both behind the screen's `edit` RBAC action:

- **Pay** (`POST /company-expenses/{id}/pay`) — requires **Paid From (Bank Account)** and **Payment Mode**, takes an optional payment reference, stamps today as Paid On, and sets Status to Paid. This is the step that satisfies the "N while Pending" rule on Paid From above: optional at creation, mandatory to settle.
- **Cancel** (`POST /company-expenses/{id}/cancel`) — optional reason, records who and when, sets Status to Cancelled.

Creating a row (directly, or via the Company-Paid claim route) also updates the vendor's usage rollup, same as a claim.

**Recurring.** Masters marks a Company-Paid type as Recurring when it is a standing monthly bill. It changes no approval behaviour; it exists so Accounts can filter the expected bills apart from one-off spend, and so a month where an expected bill *never arrived* is visible as an absence rather than going unnoticed.

**Filters — as built** (`GET /company-expenses`): **Status (multi-select)**, **Type**, and **Vendor**, with the pdf/excel export following them. **Deferred (documented, not built):** Bank Account and Period — the billing-period columns exist on every row (above), so the Period filter is an additive parameter when picked up.

**Export — built:** the standard PDF/Excel exports (columns: Vendor, Expense Type, Date, Amount, Status), plus **Export Statement** (`GET /company-expenses/export-statement`) in the same bank-statement shape defined in 2.1 — which is the form this screen's data most often needs to take, since these rows correspond one-to-one with real debits on a company account. As built it selects **Paid rows only** (the Paid status is this screen's analogue of Reimbursed), takes its own date range, and uses the same Date / Description (type-prefixed) / Bank Account / Reference (ID + linked bill) / Debit / Running Balance columns.

**Empty state:** "No company expenses recorded yet."

---

## 3. Workflows

### 3.1 Submitting an Expense with a Receipt

1. Anyone opens My Expenses (2.1) and clicks **Add Expense**, filling in Type, Amount, Date, and Description (required — see 2.1), and optionally Vendor, Tax, Linked Purchase Bill, and Receipt. (No Bank Account at submission — that is set at reimbursement time, 2.3.)
2. Saving creates it at Status = Pending automatically.
3. Accountant (or Super Admin) reviews it in Expense Approvals (2.2), views the receipt if attached, and Approves or Rejects.
4. The submitter sees the updated Status in their own expense history (2.1). Assumption: they're notified of the outcome, consistent with the notification pattern used for every other approval-style workflow in this CMS.

### 3.2 Adding a New Vendor Inline While Submitting an Expense — DEFERRED

**Status: flagged during build and deliberately not built.** The claim-side vendor picker with its inline "+ Add New Vendor" modal was raised as a gap and explicitly deferred; as built, a claim accepts an optional `vendor_id` referencing a vendor that already exists (created beforehand through the Vendor module, Module 7). The workflow below is retained as the target design for when the frontend picks it up.

1. While filling in the Vendor field on Add Expense (2.1), the person doesn't find the supplier they need.
2. They choose "+ Add New Vendor" directly from the dropdown, which opens the same small inline modal already documented in the Vendor module (Module 7, Section 3.2) — enough to capture a Vendor Name and continue, without losing progress on the expense form underneath.
3. Saving the modal creates the vendor and selects it back on the expense form; the rest of its details can be completed later from the Vendor Directory.

### 3.3 An Open Question — Resolved and Built

The source data doesn't describe a separate "mark as reimbursed/paid" step after Approval — Approved simply means the expense has been reviewed and accepted, not necessarily that money has actually moved yet. **This question is now closed in both design and code:** the Approved-but-not-yet-Paid distinction exists as the Reimbursed status, the Mark as Reimbursed action with its full reimbursement record (2.3), and the Pay step on Company Expenses (2.4). The originally flagged open question is retained here only for its history.

## 4. UI/UX Notes

- **Receipt upload shows a thumbnail/preview**, not just a filename — a reviewer should see roughly what they're looking at without having to open it first.
- **Status shown as a clear colored tag**: Assumption on convention — Pending = amber, Approved = green, Rejected = red.
- **The approval queue surfaces the receipt in one click**, never buried behind extra navigation — reviewers need to see what they're approving quickly, not hunt for it.

## 5. Connected To / Depends on Masters

Connected To: Employee, Vendor (optional), **Purchase Bill (Module 13 — optional two-way link, see Section 2.1, enforced by the shared double-payment guard: reimbursing a claim whose linked bill is paid, or paying a bill whose linked claim is reimbursed, is refused with 409 on either side — see Section 2.3)**

Uses: Expense Type (including its Claim Type — Reimbursable / Company-Paid), Financial Year, Taxes (Purchase scope, optional)

Paid via: Bank Account, Payment Mode (UPI, IMPS)

Depends on Masters: Expense Types, Financial Year, Taxes (Section 3.2 — optional, see the note under Section 2.1's field table)

**Confirmed already set up in Masters:** Expense Types (Section 3.3), Financial Year (Section 3.1), Bank Account (Section 3.7), and Payment Mode (Section 3.8) are all fully defined.

**Corrected this revision:** the Masters module always listed Expense as a consumer of its Taxes sub-master, while this module had no tax field. The dependency is now real and declared on both sides — as an optional field, since whether purchase taxes apply to this company has not been established. See Section 2.1.

## 6. Role-Based Access

> **Baseline, shared by all 5 roles:** every person is, first, an employee themselves. Submitting their own expense, attaching a receipt, and viewing their own history and status (My Expenses, 2.1) is identical no matter what role someone holds — nobody's access to their own expenses should ever be narrower than a plain Employee's. This specifically fixes Manager and HR, who have no access at all in the source spreadsheet for this module — not even for their own claims. What follows is each role's additional access on top of that shared baseline.

**Company Expenses (2.4) sits outside that baseline entirely.** The baseline exists because everyone is an employee with claims of their own; a company Wi-Fi bill is nobody's personal claim, so there is nothing for the baseline to protect. Super Admin and Accountant only.

- **Employee** — the baseline only.
- **Manager** — the baseline only, by default. This is a deliberate choice, not an oversight: it's consistent with Manager having zero access on the other two financial modules, Invoice (Module 11) and Purchase Bill. A toggle below adds team-approval if a more traditional structure is wanted instead.
- **Accountant** — the baseline for themselves, PLUS viewing every employee's expenses, approving/rejecting them, the summary reports, and **Company Expenses (2.4)** — recording and settling the company's own running bills.
- **HR** — the baseline only.
- **Super Admin** — full access to everything, including the RBAC settings screen itself, and the fallback approver if Accountant is unavailable.

Cross-checked directly against the source spreadsheet's Expense row: Super Admin = All, Employee = partial (add own, attach receipt, view own — no approve), Manager = NA, Accountant = partial (add & view all, summary), HR = NA. This confirms both things this document states plainly: the approval gap is real (nobody in the raw data has "approve" written down), and Manager's zero access here is the second confirmation of the rule established in the Invoice module (Module 11, Section 6.1) — **Manager runs relationships and delivery, not money** — right after it was first laid out with evidence.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. **As built,** the module registers four RBAC screens — My Expenses (`expense.my_expenses`, the scoped own-baseline), Expense Approvals (`expense.approvals`, actions `approve`/`reject`), All Expenses / Summary (`expense.all_expenses`, action `mark_reimbursed`), and Company Expenses (`expense.company`, action `edit`) — and every endpoint sits behind the matching screen/action gate, with per-person overrides via the standard RBAC mechanism. The Company-Paid role restriction (Super Admin + Accountant, 403 otherwise) is additionally hardcoded in the create endpoint. **The four toggles below are documented design, not built** — none exists in code today; approvals currently behave as each toggle's OFF default describes, which is why deferring them loses nothing:

- **"Allow Manager to Approve Their Team's Expenses"** — OFF by default, consistent with the "no money movement for Manager" pattern seen across Invoice and Purchase Bill. Turned ON: adds a manager sign-off step before Accountant's final approval.
- **"Require a Receipt Before Approval"** — OFF by default: Accountant can approve at their own discretion even without one attached. Turned ON: the system blocks approval on any submission missing a receipt.
- **"Set an Auto-Approval Threshold"** — OFF by default: every expense needs manual approval, matching the sheet as written. Turned ON: expenses under a set amount (e.g. ₹500) approve automatically — useful for genuinely small stuff like the tea/snacks example this module is named after.
- **"Auto-Mark as Reimbursed When Paid via Payroll"** — Assumption, added alongside the reimbursement feature in 2.3: OFF by default, reimbursement is always a manual confirmation. Turned ON: expenses bundled into an employee's next payslip could auto-mark as Reimbursed instead of needing a separate manual step — a possible future integration with Payroll, not built now.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Date cannot be in the future** — treated as the date of purchase, consistent with date validation used throughout this CMS.
2. **No formal auto-generated Expense code** — confirmed as a deliberate design choice, not a gap: unlike Invoice or Purchase Bill, an expense is never a document shared outside the company, so there's no numbering convention to define.
3. **Notification on approval/rejection outcome** — **built**: the submitter is notified on Approve, on Reject (with the reason), and on Mark as Reimbursed, through the shared notification service.
4. **Reject's comment is now required, not optional** — flipped in this revision for consistency with Documents, Asset Requests, and the matching change made to Leave (Module 5).
5. **"Mark as Reimbursed" — built.** A Status value and action on Approved expenses (Section 2.3), with a full reimbursement record, a required Reimbursed From bank account, and the shared double-payment guard against the linked Purchase Bill. Modeled as a manual confirmation of a payment that happened elsewhere (bank transfer, cash), not a payment-initiation feature.
6. **Confirmed against Sheet1** — the Expense row validates both of this document's central claims precisely: no role in the raw data has an "approve" verb written down anywhere, and Manager = NA confirms the Invoice-established "relationships and delivery, not money" rule a second time.
7. **Export and filters — built on every list screen, to a core set.** All four lists (2.1–2.4) take `format=pdf|excel` and export exactly the filtered set with a header block naming the filters, per the system-wide convention (RBAC, Module 14, Section 2.2). The built filters are the ones with a direct column behind them (Status multi-select, Type, and per-screen Employee/Vendor/date-range); the richer documented set is explicitly deferred per screen — see each screen's Filters paragraph for the deferred list and reason.

8. **This revision — filters on all list screens with filter-based export: partially built, remainder deferred.** Every screen now has filters and filter-following export (the Approvals queue, which had none, gained Employee + Type); free-text Search was added across the module 2026-08-05. The extended sets — "has receipt attached," "pending more than N days," "awaiting reimbursement" as a one-click shortcut, Department, Amount range, Approved By, Bank Account — remain documented above but **deferred**: they need joins, derived predicates, or a column the row doesn't carry, and the columns they'd filter on (`has_receipt`, `bank_account_id`, billing period) are already returned per row, so all of them are additive parameters, not schema changes.

9. **Employee vendor picker on claims — flagged, deferred.** The inline "+ Add New Vendor" flow (Workflow 3.2) is design only; as built, a claim references an existing vendor by ID or none at all.

---

**Suggested filename:** `12-expense-module.md`
