# Module 15: Tax & Compliance

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Tax & Compliance module.

> **On the numbering.** This is the fifteenth module, added 2026-07-31. The original fourteen are unchanged and are **not** renumbered — a full renumber would touch cross-references in every other document for no functional gain. The same convention was used when Daily Task was briefly numbered 15; that module was removed, and this one now occupies the number.
>
> **This module replaces Purchase Bill Section 8**, which existed for a few hours on 2026-07-31 as a screen group inside Module 13. It was promoted here the moment payroll withholding came into scope — see Section 1.1.
>
> **Implementation status (2026-08-03): BUILT.** Backend API `backend/app/api/v1/compliance.py` (router prefix `/compliance`), derivation engines `backend/app/services/obligation_engine.py` and `credits_engine.py`, migration `backend/alembic/versions/0007_tax_compliance.py`. Five stored tables: `remittances`, `remittance_allocations`, `withholding_certificates`, `certificate_receipts`, `credit_claims`. **The Obligations and Credits registers themselves are not stored tables** — they are derived live on every read (see 2.2 and 2.6). Sections below note where the build refined the original text.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Tax & Compliance Overview](#21-tax--compliance-overview)
   - 2.2 [Obligations — Withheld on Payments](#22-obligations--withheld-on-payments)
   - 2.3 [Obligations — By Document](#23-obligations--by-document)
   - 2.4 [Remittances](#24-remittances)
   - 2.5 [Record Remittance](#25-record-remittance)
   - 2.6 [Credits — Withheld from Receipts](#26-credits--withheld-from-receipts)
   - 2.7 [Certificates](#27-certificates)
   - 2.8 [Log Withholding Certificate](#28-log-withholding-certificate)
   - 2.9 [Mark Credit Claimed](#29-mark-credit-claimed)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

This module tracks **money the company is holding on somebody else's behalf, and money somebody else is holding on the company's behalf.**

Three separate flows in this CMS deduct tax from a payment and owe it onward to an authority:

| Source | Money came from | Produces |
|---|---|---|
| **Purchase Bill** (Module 13, Section 2.2) — the company withholds from a supplier payment | Vendor | A **liability** — owed to the authority |
| **Payroll** (Module 6, Section 2.1) — the company deducts tax from a salary | Employee | A **liability** — owed to the authority |
| **Invoice → Record Payment** (Module 11, Section 2.4) — a customer withholds from what they pay | Customer | An **asset** — a credit the company can claim |

Before this module, the first two were recorded and then lost — the CMS knew an amount had been deducted and had nowhere to say whether it was ever deposited. The third did not exist at all: a customer paying short left the invoice permanently Part-Paid.

### 1.1 Why this is a module and not a section inside another one

It was briefly built as Purchase Bill Section 8, on the reasoning that a withheld amount is a field on a bill and a module should own a record nothing else owns. **Payroll withholding is what changed the answer**, and the reasoning is worth recording because it is the same test that removed Daily Task:

1. **It owns a document nothing else can own.** A remittance is a real payment out of a real bank account with its own number series (`RMT-<FY>-0000`), its own attachment, its own reference from the authority, and its own void-not-delete rule. There is no existing screen it could be a field on.
2. **Its counterparty does not exist elsewhere.** This CMS models three counterparties — Customer, Vendor, Employee — and every money screen is organised around which of the three is owed. **A tax authority is a fourth**, and it is owed money that came from all three at once. There is no module where "owed to the authority" fits without lying about whose money it is.
3. **Two modules independently flagged the gap and both declined to host it.** Purchase Bill's own Section 7 said: *"most likely in Payroll or a new Compliance module, since payroll-side withholding raises the identical need."*
4. **Its deadline is legal, not commercial.** An overdue invoice is a relationship problem; an overdue deposit is a penalty. Bolting that onto Purchase Bill's Unpaid/Part-Paid/Paid would corrupt a status that means something else.
5. **It has an off switch.** Every screen here is hidden — the whole sidebar tab absent — unless at least one head in Masters Section 3.2 has **Creates an Onward Liability = Yes**. This is the test Daily Task could never pass: it was visible whether or not anyone used it. A company that holds nobody's money pays nothing for this module. *(As built, this is UI-navigation framing, deliberately: the API endpoints stay reachable and simply return empty data, and `GET /compliance/overview` returns two booleans — `has_obligation_heads_configured` and `has_credit_heads_configured` — that the frontend uses to hide the tab and to distinguish the empty states in 2.1.)*

### 1.2 What feeds each register (as built)

Only **two** flows feed Obligations, matching Section 1's own table — vendor withholding (`purchase_bills.withholding_amount`, a head with scope `WITHHOLDING_AT_SOURCE` carrying the `ON_PAYMENTS_MADE` direction) and payroll employee deductions (`payslip_statutory_lines.computed_amount`, heads with scope `PAYROLL_EMPLOYEE_DEDUCTION` or `PAYROLL_INCOME_TAX`). Two adjacent things are **deliberately excluded** from the liability register:

- **Employer contributions** (e.g. Employer PF): never withheld *from* the employee — the company's own direct cost, not money held on somebody else's behalf. Including them would misattribute whose money is at stake and corrupt every Net Paid figure.
- **A `SALES_BILLING` head with Creates an Onward Liability = Yes** (e.g. output GST): the company's own output-tax liability is a different kind of obligation this module was never scoped to track. Such a head is silently excluded from the register rather than guessed into one of the two real source tables.

The third flow — customer withholding (`invoice_payments.withheld_amount`) — feeds **Credits** (2.6) only. A credit-side head is identified by scope `WITHHOLDING_AT_SOURCE` carrying the `ON_PAYMENTS_RECEIVED` direction; the Creates an Onward Liability gate is a liability-side concept and does not apply to it.

## 2. Screens

### 2.1 Tax & Compliance Overview

**What it's for:** The landing screen. Both directions visible together, as **two panels that are never netted into a single figure.**

**Who can open it:** Accountant, Super Admin.

| Panel | Widgets |
|---|---|
| **Obligations** — money held, owed onward | Withheld — Not Yet Remitted · Due Within 7 Days · Overdue Remittances · Remitted This Financial Year |
| **Credits** — claimable back | Withheld by Customers — This FY · Certificate Outstanding · Certified — Not Yet Claimed · Credit Claimed This FY |

**Why they are never netted, because a single "net tax position" figure is the obvious thing to build and it is wrong:** an obligation is not the company's money and an authority is owed it on a legal deadline. A credit is an asset the company may not realise for months. Offsetting them produces a number that is wrong in both directions and, once exported, gives a reader no way to tell which way it leans.

Two supporting tables: **Due Soon & Overdue** (soonest first) and **Certificates Outstanding — Oldest First**. As built, the Certificates Outstanding table lists certificates that are **ACTIVE and not yet claimed**, ordered by certificate date — a perfectly-matched certificate sitting unclaimed is the everyday "chase" case it exists for, and a claimed certificate drops off once settled.

**Financial-year scoping (as built, `GET /compliance/overview`):** the three widgets whose label says "This FY" are FY-windowed; the rest are point-in-time snapshots deliberately unscoped by FY:

- **Remitted This Financial Year** — sums `remittances.amount_remitted` where the remittance's own stamped `financial_year_id` is the current FY. Includes negative reversal rows, so a remit-then-reverse within the same FY correctly nets to zero.
- **Withheld by Customers — This FY** — scoped by each receipt's own payment date.
- **Credit Claimed This FY** — scoped by **claim date**, not the underlying receipt's date: a credit withheld last FY but claimed this FY belongs in this widget.

**Empty states are three distinct cases**, because "nothing is configured" and "configured but nothing withheld yet" are different facts, and a register that is confidently empty for the wrong reason is worse than one that explains itself. As built, the response's `has_obligation_heads_configured` / `has_credit_heads_configured` booleans distinguish "nothing configured" from "configured but zero activity", per panel.

---

### 2.2 Obligations — Withheld on Payments

**What it's for:** Reconciling, per head per period, what was withheld from the liability sources against what has actually been deposited.

**Who can open it:** Accountant, Super Admin.

**This register is derived live, never stored** (as built — `obligation_engine.build_obligation_periods`). A "period" is a computed grouping key, not a row anywhere: withheld amounts already sitting on `purchase_bills.withholding_amount` and `payslip_statutory_lines.computed_amount` are grouped by (tax head, period) and netted against `remittances.amount_remitted` — including negative reversal rows, which is exactly what makes a reversal net out with no special-casing. The Overview widgets and this screen read the same function, so the two can never disagree.

**Columns:** Tax Head · Remitted To · Source · Period · Period From · Period To · Documents · Withheld · Remitted · Outstanding · Due Date · Status · Authority Reference.

**Source** distinguishes Vendor / Employee rows — the two liability flows. *(The original text said the column carries all three sources; as built it never can: the Customer flow is an asset and lives in Credits (2.6), never in this register — see 1.2.)* A period row aggregates one head, and a head is single-source in practice, but a reader must never have to infer whose money a figure represents.

**Period bucketing (as built, `resolve_period_bounds`):** five cadences (Per Document · Monthly · Quarterly · Half-Yearly · Annual) × three alignments (Calendar · Financial Year · Pay Cycle), with the financial year's start month threaded through everywhere a period is derived. Two boundary decisions, flagged rather than guessed:

- **Monthly** aligns to real calendar months under Calendar *or* Financial Year alignment — a financial year's start month doesn't change what a month *is*. Only Quarterly / Half-Yearly / Annual anchor to the FY start month under Financial Year alignment.
- **Quarterly / Half-Yearly / Annual** fall back to Gregorian (January-anchored) boundaries under Pay Cycle alignment — the Pay Cycle concept has no native quarterly or annual shape. Pay Cycle alignment changes behaviour only for Monthly, which reuses the company's one active Pay Cycle row with the same month-clamping math payroll itself uses.

**Event date** per document follows the head's *Liability Arises On*: for a bill, payment date (an unpaid bill has not yet created the liability) or bill date; for a payslip line, salary credit date or pay-period end. Due date = period end + the head's deposit-due days.

**Status precedence** — a period can satisfy several; first match wins: **Remitted** (Remitted ≥ Withheld) → **Overdue** (due date passed, Outstanding > 0) → **Due Soon** (due within 7 days) → **Part-Remitted** (0 < Remitted < Withheld) → **Open**. A partly-remitted overdue period reads *Overdue*, because that is the fact needing action.

**Filters & export (as built, `GET /compliance/obligations`):** Tax Head · Status (multi) · Source (Vendor | Employee) · Due Date from/to · Search (matches Tax Head, Remitted To, Authority Reference) · `format=pdf|excel` filter-following export.

**Payroll periods align to the Pay Cycle, not the calendar**, when the head says so (Masters Section 3.2, *Period Aligns To*). This matters: the pay cycle runs 26th–25th by default (Masters Section 3.20c), so a payroll obligation period that aligned to calendar months would disagree with the payslips that produced it.

---

### 2.3 Obligations — By Document

The drill-down: one row per source document carrying a withheld amount, so any period total traces back to what produced it. Row click opens the source — a Purchase Bill or a payslip. *(The original text also listed invoice payments; as built, customer-side receipts appear only in Credits — see 1.2.)*

**Columns:** Document · Source · Counterparty · Date · Tax Head · Calculated On · Document Total · Withheld · Net Paid · Period · Remittance Status · Authority Reference.

**Per-document Remittance Status (as built):** derived by netting the document's `remittance_allocations` (reversal mirrors are negative, so they net out) against its withheld amount — Open (nothing allocated) · Part-Remitted · Remitted (fully allocated). Net Paid = Document Total − Withheld.

**Filters & export (as built, `GET /compliance/obligations/by-document`):** Tax Head · Date from/to · Search (matches Document, Counterparty, Tax Head) · `format=pdf|excel` filter-following export. Rows sort newest first.

---

### 2.4 Remittances

One row per deposit actually made: Remittance ID · Tax Head · Remitted To · Period · Amount Remitted · Paid On · Paid From · Mode · Authority Reference · Documents Covered · Recorded By.

**A remittance is never editable after save.** A wrong one is corrected by a **reversal** — a negative-signed record referencing the original — never by editing or deleting it. Same principle the Credit Note applies to a locked invoice: the original stays intact and the correction is a separate, linked document. Reversal is Super Admin only and requires a reason.

**As built** (`remittances` table, `POST /compliance/remittances/{id}/reverse`):

- The head name, Remitted To, and the period label/from/to are **snapshotted at record time** — a remittance keeps meaning the same thing even if the head's own settings change later. Reversal shape is DB-enforced (`ck_remittances_reversal_shape`): a normal remittance is positive with no reversal link; a reversal is negative, references the original, and must carry a non-empty reason.
- A reversal takes its own `RMT` number, copies every descriptive field from the original, and is dated the day the correction was made. A reversal cannot itself be reversed, and a remittance can be reversed only once.
- The reversal also **mirrors the original's allocation rows with negated amounts** — otherwise the covered documents would stay permanently "fully allocated" even though the period itself correctly reopens.

**Filters & export (as built, `GET /compliance/remittances`):** Tax Head · Paid On from/to · Search (matches Remittance ID, Tax Head, Authority Reference) · `format=pdf|excel` filter-following export, including a **Documents Covered** column listing each covered document with its allocated amount.

---

### 2.5 Record Remittance

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Tax Head | Read-only, pre-filled | N/A | From the period row |
| Remitted To | Read-only, pre-filled | N/A | From the head (Masters Section 3.2) |
| Period | Read-only, pre-filled | N/A | Label plus the From/To dates |
| Withheld in this Period | Read-only, computed | N/A | Shown for reference |
| Already Remitted | Read-only, computed | N/A | Shown for reference |
| Amount Remitted | Number (INR) | Y | Defaults to the full outstanding figure. A part-remittance is allowed; the period then reads Part-Remitted and stays open for the balance |
| Paid On | Date | Y | Cannot be in the future |
| Paid From (Bank Account) | Dropdown (Masters, Section 3.7 — Active) | Y | Which company account the money left |
| Mode | Dropdown (Masters, Section 3.8) | Y | — |
| *(Authority Reference)* | Text | Y | **Labelled from the head's own Authority Reference Label** — it reads "Challan Number" or "Acknowledgement Number" because that is what the head was configured to call it. This is how no jurisdiction's vocabulary is named in this specification |
| Receipt Attachment | File upload | N | The audit source document |
| Documents Covered | Multi-select of withheld amounts in this period | Y | **Confirmed by the person recording it, never inferred.** The ticked total must equal Amount Remitted, and a **part-allocation on the final ticked document is permitted** — so an odd remittance figure can never force an untrue allocation |
| Notes | Text area | N | — |

**As built** (`POST /compliance/remittances`, with `GET /compliance/remittances/documents-in-period` feeding the multi-select):

- The multi-select offers only documents in the exact (tax head, period) with outstanding withheld amount left, each showing withheld / already-allocated / outstanding. The FY start month is threaded into the period math here too, so an FY-aligned head's documents resolve to the same period the Obligations screen showed.
- Validation runs a **running per-document remaining check**: each ticked entry decrements that document's remaining outstanding, so two entries for the same document can never together allocate past what was ever withheld. Nothing is inferred — no FIFO (Section 7.2/7.3 stand as built).
- The ticked total must equal Amount Remitted exactly; Paid On cannot be in the future; the head must exist and have Creates an Onward Liability = Yes. Allocations are stored in `remittance_allocations` (append-only).
- Receipt Attachment is optional as built — see Section 6.1 on the deferred "require attachment" toggle.

---

### 2.6 Credits — Withheld from Receipts

What customers held back, the certificates evidencing it, and whether the credit has been claimed. Fed by Invoice → Record Payment (Module 11, Section 2.4).

**Columns:** Invoice Number · Customer · Payment Date · Invoice Total · Amount Received · Withheld · Certificate · Certificate Ref · Credit Claimed · Status.

**Status values:** *Not Expected* (head's Certificate Expected is off) · *Awaiting Certificate* · *Certified — Unclaimed* · *Claimed* · *Variance*.

**As built** (`credits_engine.build_credit_rows` — this register is also **derived live, never stored**, from `invoice_payments` rows carrying a withheld amount and a customer-withholding head):

- **Claimed is checked before Variance.** A variance certificate *can* be claimed (the certified figure governs, Section 7.4), and once claimed the credit is fully settled — checking variance first would keep a settled credit permanently reading Variance.
- A **voided** certificate drops its receipts back to *Awaiting Certificate*.

**Filters & export (as built, `GET /compliance/credits`):** Status (multi) · Customer · Payment Date from/to · Search (matches Invoice Number, Customer, Certificate Ref) · `format=pdf|excel` filter-following export.

---

### 2.7 Certificates

One row per certificate logged: Certificate Reference · Customer · Certificate Date · Covered From/To · Tax Head · **Amount on Certificate** · **Amount Matched** · **Variance** · Receipts Covered · Status.

**Where a certificate states a different figure than the receipts it covers, the certified amount is what may be claimed** — not the company's own recorded figure. The authority will accept the certificate, not an internal record. A variance is surfaced for investigation and never auto-corrected in either direction. Voiding is Super Admin only and requires a reason.

**As built** (`withholding_certificates` + `certificate_receipts`): Certificate Reference is unique **per customer** (DB constraint). Amount Matched is computed once at log time from the ticked receipts; Variance is a stored generated column (`amount_on_certificate − amount_matched`). Statuses are ACTIVE / VOIDED; a certificate whose credit has already been claimed **cannot be voided**.

**Filters & export (as built, `GET /compliance/certificates`):** Customer · Status (multi) · Certificate Date from/to · Search (matches Certificate Reference, Customer) · `format=pdf|excel` filter-following export, including a **Receipts Covered** column listing each covered invoice with its matched amount.

---

### 2.8 Log Withholding Certificate

Customer · Certificate Reference (unique per customer) · Certificate Date (not future) · Covered From / Covered To · Tax Head · Amount on Certificate · Receipts Covered (multi-select, computes Amount Matched) · Variance (derived) · Attachment.

**As built** (`POST /compliance/certificates`): every ticked receipt must belong to the selected customer; per receipt, the ticked amount is capped at the receipt's withheld amount **minus what any other certificate has already certified for it** — a cross-certificate cap, so the same receipt can never be certified in full twice and later double-claimed. Certificate Date cannot be in the future; Covered To ≥ Covered From; Amount on Certificate must be positive; a duplicate reference for the same customer is rejected cleanly. There is no later "add more receipts to an existing certificate" workflow — the receipt set is fixed at log time.

---

### 2.9 Mark Credit Claimed

Closes the loop. **Only a certified receipt can be claimed** — an uncertified one has no evidence behind it. Amount Claimable is the **certified** figure.

Fields: Receipts · Certificate Reference · Amount Claimable (read-only) · Claimed In (period / return) · Claim Reference · Claim Date · Notes.

**As built** (`POST /compliance/certificates/{id}/claim`, `credit_claims` table): a claim operates on **a certificate as a whole, once** (DB-unique per certificate) — its receipts ride along; there is no per-receipt partial claim. Amount Claimable is stamped as the certificate's own Amount on Certificate. Only an ACTIVE certificate can be claimed; Claim Date cannot be in the future; a second claim on the same certificate is rejected.

## 3. Workflows

### 3.1 The monthly obligation cycle

1. Bills, payslips and receipts accumulate withheld amounts through the period. Each lands in a period decided by its head's *Period Aligns To* and *Liability Arises On*.
2. Near period end the Accountant opens **Obligations** (2.2), filters to Due Soon, and reconciles each period's total by hand against the underlying documents via **By Document** (2.3).
3. They deposit the money with the authority outside this system.
4. They open **Record Remittance** (2.5), enter the amount and the reference the authority returned, attach the receipt, and confirm which documents it covers.
5. The period moves to Remitted. Anything left reads Part-Remitted and stays open.

### 3.2 The certificate chase

1. A customer pays short; the shortfall is recorded on Invoice → Record Payment (Module 11, Section 2.4). The receipt appears in **Credits** (2.6) as *Awaiting Certificate*.
2. The certificate arrives, often quarterly and covering several receipts. The Accountant logs it (2.8) and ticks the receipts it covers.
3. Where the certificate's figure differs from the receipts', the row reads *Variance* and is investigated. **The certified figure governs.**
4. Once the credit is taken in one of the company's own filings, it is marked claimed (2.9).

### 3.3 Correcting a wrong remittance

A remittance is never edited. Super Admin reverses it with a reason, which writes a negative-signed record referencing the original; the period reopens for the correct amount. As built, the reversal also mirrors the original's Documents Covered rows with negated amounts, so each covered document's own outstanding figure reopens along with the period (see 2.4).

## 4. UI/UX Notes

- **The two panels on the Overview are never combined into one figure.** This is the single most important visual rule in the module.
- Money columns read **left-aligned**; counts, days and percentages right (RBAC, Module 14, Section 2.2 c-i).
- Status tags follow the module convention: Open grey · Due Soon amber · Overdue red · Part-Remitted blue · Remitted green.
- The 7-day *Due Soon* threshold is a fixed platform figure driving a badge colour, on the same footing as the existing ageing buckets. It is not a per-head field, because it decides a colour and not an amount.
- Every list carries the baseline filter set and filter-following export (RBAC, Module 14, Section 2.2). As built, all five list screens (2.2, 2.3, 2.4, 2.6, 2.7) take date-range and search filters plus `format=pdf|excel`, and every export follows the applied filters and stamps them.
- The no-liability-head hiding rule (1.1, item 5) is enforced in navigation only; the API stays reachable and returns empty registers plus the two configured booleans (deliberate — see 1.1).

## 5. Connected To / Depends on Masters

Connected To: **Purchase Bill** (Module 13 — vendor withholding), **Payroll** (Module 6 — employee deductions), **Invoice** (Module 11 — customer withholding and the credits it creates), **Vendor**, **Customer**, **Employee**.

Owns (as built): five stored tables — `remittances`, `remittance_allocations` (Documents Covered), `withholding_certificates`, `certificate_receipts` (Receipts Covered), `credit_claims` — plus the derived Obligations and Credits registers, which are computed on read and stored nowhere (see 2.2 and 2.6). All foreign keys RESTRICT, never CASCADE, except the append-only child rows that die with their own parent document.

Depends on Masters: **Taxes (Section 3.2)** — every head, its *Creates an Onward Liability* gate, remittance period, alignment, due days, and Authority Reference Label; **Bank Account (3.7)**; **Payment Mode (3.8)**; **Financial Year (3.1)**; **Work Week & Hours → Pay Cycle (3.20c)** for payroll-aligned periods; **Company Profile → Number Prefixes (3.6e)** for the `RMT` series.

## 6. Role-Based Access

- **Accountant** — full access to every screen. This is their monthly cycle.
- **Super Admin** — everything, plus the two destructive actions: Reverse Remittance and Void Certificate, both requiring a reason.
- **Manager, HR, Employee** — no access, and the module does not appear in their navigation. This is the company's own tax liability and its claimable credits; there is no personal stake to justify a self-service view, and an employee's own deducted tax reaches them on their payslip (Module 6, Section 2.2), not here.

**As built (RBAC registry):** six screen keys, none reporting-hierarchy scoped — `compliance.overview`, `compliance.obligations`, `compliance.obligations_by_document`, `compliance.remittances` (actions: `record`, `reverse`), `compliance.credits`, `compliance.certificates` (actions: `log`, `void`, `claim` — Mark Credit Claimed operates on a certificate row, so it rides on the Certificates screen rather than a seventh key). Seeded defaults: Accountant full on every screen with `record` and `log`/`claim`; `reverse` and `void` Super Admin only.

### 6.1 Nothing Here Is Hardcoded

- **"Allow Accountant to Reverse a Remittance"** — OFF by default. Reversal stays Super Admin, consistent with every other irreversible correction in this CMS. *(As built, the OFF default is encoded as the seeded role list on the `reverse` action — Super Admin only — reassignable through the RBAC admin screens like every other OFF-by-default toggle, rather than as a separately named feature flag.)*
- **"Require an Attachment Before Recording a Remittance"** — OFF by default. Turning it on blocks a remittance with no receipt attached, the same posture Purchase Bill takes toward its bill scan. *(**Deferred — not built.** The attachment is simply optional today; no enforcement toggle exists in the backend. Deferred because the OFF default means behaviour is identical either way until someone asks to turn it on; adding it is a single validation gate in `record_remittance` when a feature-toggle read path lands.)*

## 7. Assumptions & Points to Confirm

1. **The 7-day Due Soon threshold is a fixed platform figure**, not configurable per head — it drives a badge colour, not an amount.
2. **Documents Covered is confirmed by the operator, never inferred.** No FIFO or automatic allocation is applied, because a wrong allocation is invisible and produces a confidently incorrect filing.
3. **Part-allocation on the final ticked document is permitted**, so an odd remittance figure can never force an untrue allocation.
4. **The certified amount governs a claim**, not the company's recorded figure, whenever the two differ.
5. **Interest and penalty on a late remittance are not computed.** The register shows a period Overdue; what that costs is jurisdiction-specific and nobody has stated the rule.
6. **Filing returns is out of scope.** This records what was deposited and what reference came back; it files nothing and integrates with no authority's systems.
7. **Employee-facing tax certificates are out of scope.** The company issuing an annual deduction certificate to each employee is an obligation *to issue*, not to collect, and belongs with Payroll's document generation rather than in this register. Flagged rather than assumed.
8. **The company's own income-tax liability is not tracked here.** This module is only about money withheld on behalf of others and money others withheld from the company.
9. **A head's *Liability Arises On* setting locks after its first remittance.** Changing it later would silently re-file every historical amount into different periods. *(As built, the lock is broader than this sentence: once any remittance exists against a head, the whole compliance field set locks — Creates an Onward Liability, Remittance Period, Period Aligns To, Deposit Due Days, Liability Arises On, and Certificate Expected — enforced in `masters_taxes.py`, independent of the arithmetic lock, which fires on first use in a calculation instead.)*
10. **Employer contributions and a company's own output-tax head are excluded from the Obligations register** (built — see Section 1.2): neither is money withheld from somebody, so neither belongs in a register of money held on somebody else's behalf.
11. **A receipt's withheld amount is capped across all certificates, not just within one** (built — see Section 2.8), so the same credit can never be certified twice and double-claimed.
12. **The no-head hiding rule is navigation-only** (built — see Section 1.1): the API deliberately stays reachable and answers with empty registers plus the two configured booleans, so the frontend owns the hiding and an API consumer is never lied to with a 404.

---

**Suggested filename:** `15-tax-compliance-module.md`
