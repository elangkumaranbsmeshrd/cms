# Module 6 of 14: Payroll

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Payroll module.

## Implementation Status — Backend (verified 2026-08-03)

The backend for this module is built and tested — 22 API operations under `/api/v1/payroll/...`, backed by the payroll tables (`payroll_runs`, `payroll_run_employees`, `payslips` plus their earning/statutory/adjustment line tables, `payslip_reissues`, `adhoc_payslip_adjustments` with per-employee targets, `monthly_hour_reconciliations`, `salary_certificate_requests`) — while the Angular frontend has not been started, so every screen below is backend-ready, not rendered UI.

**Built:**

- **Run lifecycle (2.1, 3.1):** creating a run always lands it in Draft with the full calculation already done — the preview-before-confirm rule (Section 4) is structural, since no endpoint goes from a Month/Year selection straight to payslips. Confirm generates payslips and notifies every employee (in-app plus the Payslip Available email); Recalculate and Discard work on Drafts only; a Processed run is permanent. Pay Period Covers, Salary Credit Date, auto-calculated-but-overridable Working Days, and All-active-vs-specific employee selection all work as described.
- **Hour-basis calculation (2.4 feeding 2.1):** pay-cycle resolution including the Section 3.1b cutoff carryover; Required/Worked/Leave-Credit/of-which-Comp hours from one shared reconciliation service used identically by Run Payroll and the Attendance screen; pending compensation suspending a deduction; shortfall conversion per the policy's Uncompensated Shortfall Becomes setting; the approved unpaid-leave formula; proration for mid-period joiners and leavers — applied to the gross, to every individual earning line (Basic, DA, HRA, monthly LTA, Special, Other), and to the per-day rate the shortfall conversion prices with, and mirrored by the Payroll Impact tab so its estimate matches the run; multi-day leave spanning a cutoff split between the two periods it touches.
- **Statutory and income tax (2.1 steps 5–6):** every figure read from Masters → Taxes heads — dates, locations-style applicability, tax-scheme filtering, the per-employee Applicable toggle — with each payslip line snapshotting the head's configuration at calculation time, exactly as the "records the configuration that produced it" paragraph requires.
- **Ad-hoc adjustments (2.1a):** create for one, several, or all active employees; remove with a recorded reason; one-time items consumed on first application, recurring items carried forward; offer-letter Custom Terms queue here automatically.
- **Payslips (2.2, 2.3):** company-wide list with filters and export, self-service list and detail, one letterheaded PDF endpoint serving both the employee's own Download and the admin View, and Reissue (recalculate or manual figure adjustment) with a required Reason and an append-only Reissue History holding old and new figures.
- **Attendance & Time Basis (2.4):** all five tabs exist as endpoints — Monthly Summary, Day-wise Log (every calendar day listed, recorded or not), Payroll Impact (priced with the same conversion Run Payroll uses), Compensation (linking to the live Leave queue), and Biometric Feed (real per-source counts, not fabricated readings). Role access matches Section 2.4: Manager team-scoped, Accountant and Employee excluded.
- **Salary certificates (2.2, 3.2):** generated on demand with an optional Purpose, letterheaded, each request persisted with snapshots and its PDF, plus a self-service history list.
- **Access (6):** five RBAC screen keys — Run Payroll (run/confirm), Ad-hoc Adjustments (edit), My Payslips, Payslip — Accountant/HR View (reissue), Attendance & Time Basis — granted per the role table in Section 6.

**Deferred / not implemented:**

- **Day-basis engine** — only the hour basis is implemented. Payroll Basis lives on Company Profile, but selecting Day Basis makes run creation refuse with an explicit error rather than silently calculating on hours.
- **Section 6.1 live toggles** — the toggle data model exists but is not wired into permission resolution. Each toggle's documented default is enforced by which roles hold the screen permission, and widening one person uses the built per-user permission override. This covers "Allow Manager to Run Payroll," "Allow HR to Add Ad-hoc Payslip Adjustments," "Require Super Admin Approval to Reissue a Payslip," "Hide Ad-hoc Adjustment Labels from Employee," and the off position of "Notify Employee When a Payslip Is Reissued" (currently always on).
- **Ad-hoc adjustment Edit** — no edit endpoint; a wrong adjustment is removed (reason recorded) and re-added.
- **Self-service payslip list export (2.2)** — the per-payslip PDF and the Accountant/HR list export are built; the employee's own filtered-list export is not.
- **Some documented filters** — Payroll History (Month range, Run By, Run On range, Employee Count range, search), adjustments (Amount range, Created By, Date Added range), admin payslips (Designation), Attendance (Hour Status, Work Week Policy) are not yet query parameters; the rest are wired, with filter-based export throughout.
- **Ad-hoc Gross-vs-Net application** — the choice is captured on every line for display and audit but does not branch the arithmetic; both produce identical, money-correct figures because Net Pay is a database-generated column driven off Total Earnings, and a separate Net path needs a schema change first — deliberately deferred rather than risk silently losing money.
- **Biometric device / external HR / mobile check-in inputs** — integration-planned, as this document already states; the Biometric Feed endpoint serves the honest current state (all records manual, no enrollments).

**Differed from this document — all now corrected in place (each also recorded here so the correction isn't silent):**

- Section 2.1 called the calculation "day-basis — the current, primary method"; the built engine prices pay on the hour basis of Section 2.4, which Sections 3.1 and 2.4 already assume. Corrected in place (Section 2.1 heading).
- The unpaid-leave formula divides by the resolved pay period's total days, not the calendar month's — the difference only shows on a non-calendar Pay Cycle. Corrected in place (Section 2.1 step 3, Section 7 item 1).
- Income tax applies one in-force head per employee (the first surviving date and scheme filtering), not "every head" at once; and only the current run's taxable ad-hoc additions are annualized in, not everything "already paid this year." Corrected in place (Section 2.1 step 6).
- Reissue's recalculation deliberately keeps the payslip's existing ad-hoc lines exactly as originally applied — ad-hoc money never moves as a side effect of a reissue — and manual adjustment covers the four top-line figures. The reissue notification is always attempted, with the actual outcome recorded on the history entry. Documented in place (Section 2.3).
- Once a period is Processed, the Attendance screen reads back a locked, materialized reconciliation for it instead of recomputing live, so a later policy edit can never disagree with the payslip it explains. Documented in place (Section 2.4).

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Run Payroll (+ Payroll History)](#21-run-payroll--payroll-history)
   - 2.1a [Ad-hoc Payslip Adjustments](#21a-ad-hoc-payslip-adjustments)
   - 2.2 [Payslip — Employee View (Self-Service Baseline)](#22-payslip--employee-view-self-service-baseline)
   - 2.3 [Payslip — Accountant / HR View](#23-payslip--accountant--hr-view)
   - 2.4 [Attendance & Time Basis](#24-attendance--time-basis)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

> **Sidebar location changed 2026-07-30.** This module and Leave (Module 5) now share one left-hand sidebar tab, "Leave & Payroll," instead of two separate ones. My Tax Declarations (Employee, Module 2, Section 2.14) moved into this same tab too, since it feeds directly into the income-tax calculation below. Nothing about this module's own screens, fields, or access rules changed; only where it sits in navigation. See RBAC, Module 14, Section 3 for the full reasoning.

Payroll calculates and generates monthly pay for every active employee, pulling from their Salary Structure, their approved Leave, and the company Holiday calendar. It's the module that turns a month of attendance and leave into an actual payslip.

Every person in the system is, first, a staff member who gets paid. Viewing and downloading a payslip works identically no matter what role someone holds. Only running payroll and seeing other people's pay differs by role — and, as flagged throughout this document, exactly how much it differs by role needed a deliberate correction from what the source data originally suggested.

This module has nothing to do with Meshrd's retail hardware products — it only pays internal staff.

## 2. Screens

### 2.1 Run Payroll (+ Payroll History)

**What it's for:** The core monthly calculation — pick a period, calculate pay, review it, then generate payslips.

**Who can open it:** Accountant, HR, and Super Admin by default. Manager only if "Allow Manager to Run Payroll" is turned on (Section 6) — see the note in Section 6 for why this defaults off despite what the source sheet originally gave Manager.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Month | Dropdown | Y | — |
| Year | Number/Dropdown | Y | — |
| Pay Period Covers | Read-only, derived | N/A | **Added 2026-07-30.** The actual date range this run covers, resolved from Masters → Work Week & Hours → Pay Cycle (Section 3.20c) — not the calendar month. With the default 26th–25th cycle, "July 2026" resolves to 26-06-2026 through 25-07-2026. Changing the cycle changes this for every future run; it never rewrites a period already run |
| Salary Credit Date | Read-only, derived | N/A | **Added 2026-07-30.** When the bank transfer actually reaches employees' accounts for this run — a separate, later date from Pay Period Covers' cutoff, resolved from the same Pay Cycle's Salary Credit Day. With the default cycle, "July 2026" credits on 30-07-2026, five days after the 25-07-2026 cutoff, leaving room for the run to actually be calculated and confirmed. Also shown on the Payslip itself (Section 2.2) |
| Working Days in Month | Number, auto-calculated, editable | N | Calculated from the calendar minus weekends minus Mandatory holidays (Masters → Holidays), but shown and overridable — e.g. for a special company-wide day off that was never formally added as a Holiday, or a regional variation between the Chennai and Coimbatore offices |
| Employee Selection | Choice: "All active employees" or a specific multi-select list | Y | — |

**Calculating pay (hour-basis — the current, primary method, per Sections 2.4 and 3.1):**

1. Pull each employee's Salary Structure — **resolved**: this is created and edited on the Employee Master Record itself (Employee module, Module 2, Section 2.2), by Super Admin. This module reads it; it doesn't own or edit it.
2. **Paid days** = days present + paid leave. Approved leave counts as present — "Taken" in the Leave module (Module 5) already means every Approved request regardless of date, so this reads directly from that.
3. **Unpaid leave** is deducted from pay. The approved formula (A115), built as the single formula used wherever unpaid leave reduces pay: Deduction = (Gross Pay ÷ Total Days in the resolved Pay Period) × Unpaid Leave Days. The denominator is the resolved period's day count, not the calendar month's — the difference only shows on a non-calendar Pay Cycle. The Loss of Pay conversion (Section 2.4) prices with the same per-day rate, so the two can never disagree.
4. **Holidays and weekends** are non-working, paid days — they're never deducted, whether or not the employee was "present."
5. **Statutory deductions and contributions, per employee** — every tax head in Masters → Taxes (Section 3.2) with scope *Payroll — Employee Deduction* or *Payroll — Employer Contribution* that is in force for this pay period and applies to this employee. Applicability is decided by the head itself: its Applies From/Until dates, its Applicable Locations and Employment Types, the employee's tax scheme if schemes are in use, and the per-employee Applicable toggle on their Salary Structure (Employee module, Section 2.2) where the head permits one. For each applicable head, the amount is whatever the head's own configuration produces — a percentage of its configured base, a fixed amount, or a slab lookup — after applying its Minimum Base, Maximum Base/Ceiling, Cut-Off Base, per-period cap, and rounding rule, in that order. Employee-borne amounts reduce Net Pay; company-borne amounts do not, and feed Annual CTC instead where the head says they should. **This module contains no knowledge of any specific deduction.** It does not know what PF, ESI, or Professional Tax are; it reads heads and applies them.

6. **Income tax, per employee** — heads with scope *Payroll — Income Tax*. As built, **one in-force head applies per employee**: the first head that survives the date-range and tax-scheme filtering (the same scheme election that filters the monthly statutory heads in step 5), not every configured head at once. Unlike the monthly heads above, it is computed across the whole financial year and then spread. The method, in order:

   a. **Annualize** the employee's current monthly Gross (Gross Monthly × 12), plus the taxable ad-hoc additions being applied in *this* run (not everything already paid this year) and any annualized variable pay from the Salary Structure.

   b. **Subtract every reduction the configuration allows** — each declaration line from My Tax Declarations (Employee module, Section 2.15) whose head has *Reduces Taxable Income* set to Yes, at its **amount_declared**, used from the moment the declaration is Submitted and all year after. A Draft declaration is excluded entirely; Verified status is an audit trail only — verification never swaps in the verifier's separately-recorded accepted amount, so what's withheld never silently changes. The head's declaration cap is enforced when the line is entered (a declaration can't exceed it), not re-applied here. Plus any employee-borne monthly statutory deduction whose head also has *Reduces Taxable Income* set to Yes, annualized. Nothing is subtracted unless a head says it may be — there is no built-in standard deduction, and no built-in list of what's deductible.

   c. **Apply the head's calculation** to the resulting figure — its slab bands using its configured Slab Application (progressive, or flat by band), or its flat rate, whichever it's set to.

   d. **Apply the head's Relief Rules**, if it has any — each rule that triggers reduces the computed tax by the lesser of its Relief Amount or the tax itself, so relief can bring tax to zero but never below it.

   e. **Divide by the remaining payroll months** in the financial year to get this month's amount, recalculated automatically whenever Gross, declarations, or scheme choice change partway through the year.

   **If no income-tax head is configured, this step produces nothing and is skipped entirely** — no error, no zero-line on the payslip. That is the correct behaviour for a company that hasn't told the system it withholds income tax.

   Assumption, flagged rather than silently omitted: this method doesn't model a smoothing mechanism for incomes just above a relief threshold (the pattern sometimes called marginal relief), where a small increase in income can trigger a disproportionately larger tax increase. Relief Rules handle the threshold itself but not the taper above it. If a configured head needs that behaviour, it's a real addition to make before build — flagged here as the one calculation shape the current design cannot express.
7. **Already-processed skip, per employee:** if a specific employee already has a Processed run for the selected Month/Year, they're automatically excluded from a new run for that same period — whether running "All active employees" or explicitly selecting them — so nobody gets double-processed. A Draft run (see below) doesn't trigger this skip; only Processed does. **As built,** a skipped person still appears in the run with an explicit skip reason rather than vanishing silently; the same visible-exclusion treatment covers someone with no active Salary Structure, and someone whose employment window (Joining Date to Exit Date) doesn't overlap the pay period at all — while a mid-period joiner or leaver is correctly *included*, at prorated pay (every earning line and the shortfall's per-day rate prorated by their employed days ÷ the period's total days).
8. **Ad-hoc Adjustments, if any are pending for this employee** — see Section 2.1a below, applied before the Preview table is shown. **As built:** every Addition lands once in Total Earnings (Net Pay derives from Total Earnings in the database itself, so an addition can never double-count), every Subtraction lands in Total Deductions; the recorded Gross-vs-Net choice is carried on each line for display and audit but does not branch the arithmetic — a deliberate deferral, see Implementation Status. One-time items are consumed on first application; Recurring items carry forward until removed.

**A processed payslip records the configuration that produced it, not just the result.** Each calculated statutory line stores which tax head it came from and what that head's figures were at the moment of calculation. This is what makes a payslip from two years ago still explainable after the head has been retired and superseded — and it's why tax heads lock once used (Masters, Section 3.2, Status & Deletion Rule) rather than being edited in place.

**Preview step, before anything is finalized:** a table — Employee, Gross Pay, Deductions (Unpaid Leave, one column per applicable employee-borne tax head, Insurance Employee Contribution if enrolled, income tax if any head produces it, and any pending Ad-hoc Adjustments), Net Pay. The deduction columns are built from the configuration, so a run with three configured heads shows three columns and a run with none shows only Unpaid Leave. Two buttons here:

- **"Save as Draft"** — Assumption, added to give the Draft status something concrete to mean: the calculation is saved for review but not finalized, payslips are not generated, and it can be recalculated or discarded freely.
- **"Confirm & Generate Payslips"** — finalizes the run, sets Status to Processed for every employee included, generates their payslips, and notifies each of them. This step cannot be skipped — see Section 4.

**Payroll History tab/section (same screen):** past runs — Month, Year, Status (Draft / Processed), Run By, Run On, Employee Count. Visible to Accountant, HR, Super Admin (and Manager, only if payroll-running is turned on for them) so they can look back at what's already been run.

**Filters — added in this revision:** Financial Year, Run Status (Draft / Processed — multi-select), plus Month range, Run By, Run On date range, and Employee Count range *(these four, and the period-label search, are not yet wired as query parameters — see Implementation Status)*. Discarded Drafts never appear in the list. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Export follows the filter, per that convention.

---

### 2.1a Ad-hoc Payslip Adjustments

**What it's for — requested directly.** Everything on Salary Structure (Employee module, Section 2.2) is fixed and recurring — Basic, HRA, and whatever statutory lines are configured. Real payroll always has things that don't fit that mould: a one-time festival bonus, a recovery for a laptop advance, a correction for last month's error, a signing bonus negotiated at hiring that only Accountant or Super Admin would know about. This screen is where those get added, without needing a permanent change to anyone's Salary Structure.

**Who can open it:** Accountant, Super Admin.

**Fields, per adjustment:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Applies To | Choice — one specific Employee, or Multiple/All Active Employees | Y | The bulk option covers a company-wide addition like a festival bonus everyone gets in the same month, so it doesn't have to be entered one person at a time |
| Label | Text | Y | Free text, e.g. "Diwali Bonus," "Laptop Advance Recovery," "Referral Bonus," "October Tax Correction," "Signing Bonus per Offer Letter" — whatever the Accountant or Super Admin actually knows this to be |
| Type | Dropdown — Addition / Subtraction | Y | — |
| Amount (₹) | Number | Y | Must be a positive number; Type above determines whether it adds to or subtracts from pay |
| Taxable | Toggle (Yes/No) | Y | Whether this amount counts as taxable income when an income-tax head computes its base. A bonus is normally Yes; a reimbursement (e.g. travel already spent and being paid back) is normally No — Assumption: defaults to Yes, since most ad-hoc additions are pay rather than reimbursement, but this needs a human decision each time, not a fixed rule. Has no effect if no income-tax head is configured |
| Recurring | Toggle (Yes/No) | Y | If Yes, applies to every payroll run from this one forward until removed — e.g. a monthly recovery against an advance, spread over several months. If No, applies once, to the next run only |
| Applies To Component | Choice — Gross / Net | Y | **As built:** captured on the adjustment and stamped onto every payslip adjustment line for display and audit, but it does not branch the arithmetic — see the deferral note in Implementation Status. Both choices currently produce identical, money-correct figures |
| Effective From | Date | N | **As built:** defaults to today; a letter-queued adjustment gets the employee's Joining Date. A run only picks up an adjustment whose effective window overlaps its pay period |
| Note / Reason | Text area | N | Internal context, e.g. "Approved by [name], see email dated..." |

**Visibility to the employee:** the Label and Amount appear on the employee's own payslip breakup (Section 2.2), the same as any other line item — this is deliberately transparent by default, not a hidden adjustment. An employee seeing "Diwali Bonus: +₹5,000" or "Laptop Advance Recovery: −₹2,000" on their payslip is the point; a number appearing with no explanation would raise more questions than it answers.

**Connection to hiring and Appointment Letters, now automatic — resolved in this revision.** If a custom term is negotiated at offer stage — a signing bonus, a special one-time allowance — HR records it directly on the Offer & Appointment Letter screen (Employee module, Section 2.16) using this same Label/Type/Amount shape. On save there, it's queued here automatically, effective from the employee's Joining Date — no manual re-entry needed once they've joined and payroll starts running for them. Adjustments created directly on this screen (not via a letter) work exactly as before.

**A note on "hikes" specifically:** a permanent salary increase is not an ad-hoc adjustment — that's a new Salary Structure entry with a new Effective From date (Employee module, Section 2.2), which is already tracked in Structure Change History. This screen is for one-time or short-term items only, not for changing someone's ongoing fixed pay.

**Buttons:** "+ Add Adjustment," Edit *(not built — no edit endpoint; a wrong adjustment is Removed, reason recorded, and re-added)*, Remove — removal requires a **Removal Reason**, recorded with who removed it and when. Removing a Recurring adjustment stops it from future runs (any not-yet-applied per-employee targets are cancelled); it does not undo it from runs already Processed — correcting a past Processed payslip goes through Reissue, Section 2.3, not this screen.

**Filters on the adjustments list — added in this revision:** Employee, Type (Addition / Subtraction), Taxable (Yes/No), Recurring (Yes/No), Status (multi-select, defaulting to Active), Amount range *(not yet wired)*, Created By *(not yet wired)*, and Date Added range *(not yet wired)*. Search covers the Label and Note text — which matters here more than on most screens, since Label is free text and "find every laptop advance recovery still running" is a real question with no other way to answer it. Plus the baseline set and filter-based export, per the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Empty state:** "No pending adjustments for this payroll run."

---

### 2.2 Payslip — Employee View (Self-Service Baseline)

**What it's for:** Viewing and downloading your own payslips, and requesting a formal Salary Certificate — identical for every role.

**Who can open it:** All 5 roles, for their own pay only.

**List:** one row per month — Pay Period, Net Pay, Date Processed, Download button. Only Processed months appear; nothing shows for a month still in Draft or not yet run.

**Filters:** Financial Year, Month range, Net Pay range, and Payslip Status (Processed / Reissued — multi-select). Search over Pay Period is *not yet wired* (the range filters cover the same question). Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). **Expanded in this revision** from a single Year filter — this is a list screen like any other, and self-service is not a reason for a thinner one. No Employee filter appears here, since every row is already the viewer's own; the Accountant/HR view (2.3) and Super Admin's version both have one.

**Export:** "Export to PDF" and "Export to Excel" of the filtered payslip list — the periods and totals, filtered as shown. Separate from the per-payslip Download button, which produces one formatted payslip; both exist because they answer different questions. *The self-service list export is not yet built* — the per-payslip PDF Download and the Accountant/HR list export (2.3) are; see Implementation Status.

**Opening a payslip:** the header shows the period it Covers and, **added 2026-07-30**, the **Salary Credit Date** — the date the transfer actually reaches the employee's account, resolved from Masters → Work Week & Hours → Pay Cycle (Section 3.20c) and always later than the period's own cutoff. Below that: the full breakup — Earnings (Basic, HRA, Special Allowance, Other Earnings, plus any Ad-hoc Additions for that month, Section 2.1a), Deductions (one line per employee-borne tax head that applied that month, each printed under its own Print Label from Masters, plus Insurance Employee Contribution if enrolled, income tax if any head produced it, Unpaid Leave if any, and any Ad-hoc Subtractions), Net Pay. Heads with *Show on Payslip* set to No are calculated but not printed — that setting exists for accrued employer-side items an employee has no reason to see as a deduction. Ad-hoc line items show with their actual Label ("Diwali Bonus," "Laptop Advance Recovery"), not a generic "Adjustment" entry — the whole point is the employee can see what each one is. The specific figures are defined by the employee's Salary Structure and Insurance & Benefits tabs (Employee module, Section 2.2), this month's statutory and income-tax calculation (Section 2.1), and any ad-hoc adjustments (Section 2.1a); this screen only displays what's already been calculated. **The letterheaded PDF (as built)** carries an Employee Details block (name, code, Department, Designation, Pay Period Covers, Salary Credit Date), the Earnings section including each ad-hoc Addition under its own label, the Deductions section including ad-hoc Subtractions and — when present — Unpaid Leave and Loss of Pay lines, and a Net Pay summary; one endpoint serves both the employee's own Download and the admin View. The payslip-available email is sent when the run is Confirmed, not when the payslip is downloaded.

**"Download Salary Certificate" button:** a separate document from a monthly payslip — a formal letter confirming employment and salary, commonly needed for a loan or visa application. Generated on demand, not monthly. Pulls from the Employee record (Name, Employee Code, Designation, Department, Joining Date), Company Profile (official company details and letterhead — Masters, Section 3.6a/e), and the current Salary Structure (Basic, Gross, Net, Annual CTC). Assumption: includes an optional **Purpose** field when requesting it (e.g. "Visa application," "Loan application") since these letters commonly state their purpose, but it isn't a blocking requirement — leaving it blank produces a general-purpose certificate.

---

### 2.3 Payslip — Accountant / HR View

**What it's for:** Full payslip access across the whole company, and the ability to correct a payslip after it's been generated.

**Who can open it:** Accountant, HR, Super Admin.

**Filters:** Employee, Month, Financial Year, Department (from Masters), Designation *(not yet wired)*, Employment Type, Payslip Status (Processed / Reissued — multi-select), Net Pay range, and toggles for "has ad-hoc adjustments" and "has unpaid leave" — the two reasons a payslip most often needs a second look. Search covers Employee Name and Employee Code. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Available in full to Accountant, HR, and Super Admin**, all of whom see every employee on this screen. Super Admin additionally gets Created By, Last Modified By, and an "all financial years" option on the date range.

**Export:** "Export to PDF" and "Export to Excel" of the filtered set, with a header block stating the filters applied — which on a payroll register is not optional politeness. An exported spreadsheet of 12 employees that doesn't say it was filtered to one department will be read as the whole company.

**Table:** Employee, Month, Status, Net Pay, Actions (View, Reissue).

**"Reissue Payslip" action** (for corrections found after generation): opens the original calculation pre-filled with its figures, editable — either let it recalculate from updated attendance/leave data, or manually adjust specific figures for a one-off correction. A **Reason** (text, required) must be given either way before it can be confirmed. **As built**, the two methods are `RECALCULATED` and `MANUAL_ADJUSTMENT`. Recalculation reuses the exact calculation pass Run Payroll itself uses, so a reissue can never drift from how a fresh run would compute the same period — with one deliberate exception: **the payslip's existing ad-hoc lines are kept exactly as originally applied**, never re-derived, so ad-hoc money can never move (or double-apply) as a side effect of a reissue. Manual adjustment covers the four top-line figures — Gross Pay, Total Earnings, Total Deductions, Net Pay.

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Reason | Text area | Y | Why this payslip is being corrected |

**On confirming a reissue:** the payslip updates (Status becomes Reissued, a reissue count and last-reissued timestamp are kept), and a **Reissue History** entry is recorded on it — Date, Reissued By, Reason, method, and the old figures alongside the new ones (gross, earnings, deductions, net, income tax, paid days, LOP days), for audit purposes (the same accountability pattern used for asset assignment history, ticket assignment history, and leave balance adjustment history elsewhere in this CMS). **The history is append-only — a database trigger rejects any update to a recorded entry.** The employee is notified that their payslip was corrected (in-app plus the Payslip Reissued email); the email's actual send outcome is baked into the history entry itself, never asserted in advance. The off position of the notification toggle (Section 6.1) is not yet wired — currently always on.

---

### 2.4 Attendance & Time Basis

**What it's for:** Reconciling, per employee per month, the hours the company required against the hours it actually got — and handing whatever is still missing to Run Payroll as a deduction. **Hours are the unit of account here, not days.** A day is only ever a display convenience; every figure that decides pay is an hour figure.

**This screen is live and it drives payroll.** The only part still to come is the *biometric feed* — a device or an external HR system writing check-in and check-out times instead of Super Admin entering them by hand. That is an input method, not a calculation, and nothing on this screen waits on it. This distinction matters and was previously stated wrongly: the earlier revision of this section marked the whole hour basis as "Planned," which read as though the calculation itself did not exist yet.

#### Where the numbers come from

- **Required Hours** = Net Working Hours per Day × working days in the period, taken from whichever **Work Week & Hours policy (Masters, Section 3.20)** covers that employee. Working days are calendar weekdays, minus Mandatory holidays, plus whichever Saturdays that policy's Saturday rule makes working. Nothing in this calculation is a constant — a support team on a six-day week and an intern on half days are measured against their own targets, computed the same way.
- **Worked Hours** = (Check-Out − Check-In) − the unpaid break, summed across the period. The company's standard day is nine hours on site with a one-hour break, so a full day contributes eight. Sitting at a desk for nine hours with a two-hour lunch is a shortfall, and the screen says so.
- **Leave Credit** = approved leave days × Net Working Hours per Day. Approved leave is credited, not treated as absence.
- **Compensatory Credit** = hours worked under an approved compensatory request (Leave, Section 2.6). **This is an "of which" subset of Worked Hours, never an addition to it** — the same hours counted twice would silently overpay, so the screen labels the column *of which Comp* and the reconciliation adds Worked + Leave only.
- **Credited** = Worked + Leave Credit. **Balance** = Credited − Required. Negative is a shortfall.

#### What a shortfall does

Nothing, if it gets made up. A negative balance is first offset by any **approved** compensatory hours. What survives that is converted using the **Uncompensated Shortfall Becomes** setting on the policy — pro-rata per hour by default, which is the fairest of the available options and the one currently configured. A **pending** compensatory request *suspends* the deduction, it does not cancel it: approve the make-up day and the shortfall clears; reject it, or let the compensation window close, and the full amount converts at the next run. A partial make-up clears only its own hours, and the screen states the remainder explicitly rather than implying the request fixes everything.

Nothing is deducted silently. The employee sees the figure on Leave → Compensatory Hours before it reaches a payslip.

#### Screen Design

**Screen type:** A header strip showing the derivation, then filters, then five tabs.

The header strip exists so the period's arithmetic is never a black box — it reads, for June 2026: *22 weekdays + 2 working Saturdays (1st, 3rd) = 24 working days × 8.00 net hours = 192 required hours*, alongside the policy name and the Saturday rule in force.

- **Monthly Summary** — one row per employee: Req. Hours, Worked, of which Comp, Leave Cr., Credited, Balance, Payable Days, LOP Days, Status. Status is Met, *Short — compensable* (within one day's net hours), or *Short — payroll impact*. Rows open that person's day-wise log.
- **Day-wise Log** — one row per calendar day: Date, Day, Day Type, In, Out, Break, Required, Worked, Comp, Balance, Status, Note. Day Type is resolved from the policy, so Sundays, even Saturdays and Mandatory holidays sit at zero required and cost nothing. Balance on this tab is that day alone — Worked − Required.
- **Payroll Impact** — the only tab that moves money, and the handoff to Run Payroll: Hours Short, Comp Pending, Net Short, LOP Days (net of pending), Est. Deduction, and a plainly-worded next step per person.
- **Compensation** — the period's compensatory requests, with a link to the live queue in Leave.
- **Biometric Feed** — the input sources (biometric device, external HR system, geo-fenced mobile check-in) against the one that is always available (manual entry). Manual entry writes to the same fields a device will, which is why the calculation is not waiting on hardware.

  **Governed by a single switch, new in this revision: Masters → Company Profile → Biometric Attendance (Section 3.6a), defaulting to Off.** With it **Off**, manual entry is the only accepted input, this tab presents the integration as available-but-inactive rather than implying a device is connected, and any inbound device payload is rejected rather than silently stored. With it **On**, feed input is accepted and lands in the same fields manual entry uses. Flipping the switch either way never alters attendance already recorded and never changes how hours are calculated — **it is an input-source switch, not a calculation setting.** This is what lets the whole hour basis ship and run on manual entry now, with hardware integrated later as a configuration change rather than a code change.

  Every attendance record stores **which source wrote it** (manual / device / external system / mobile), so a disputed hour figure can always be traced to its origin. Manual entry remains available whatever the switch says — a device outage must never stop payroll.

#### Filters

Month, Employee, Department, Hour Status *(not yet wired)*, and Work Week Policy *(not yet wired)* — the last one because with several policies in play "who is short" is meaningless without knowing which target they were measured against. The Compensation tab additionally filters by request Status. Export follows the filter, per the platform-wide convention — every tab takes `format=pdf|excel` on the same filtered query.

**Processed periods read back locked figures.** On Confirm & Generate Payslips, Run Payroll materializes the reconciliation it consumed into a locked per-employee row (policy snapshots, hour totals, LOP days, estimated deduction, status). Monthly Summary and Payroll Impact read that locked row back verbatim for a Processed period instead of recomputing live — so a Work Week Policy edit made later can never make this screen disagree with the payslip it explains. The Day-wise Log needs no such lock: each attendance record already snapshots its own day type and required hours at entry time.

#### Role Access

**Super Admin** — full, plus Record Attendance. **HR** — view, company-wide; they answer the shortfall questions. **Manager** — view, Team scope only. **Accountant** — no access to this screen; they see the consequence on the Payroll Register, not the raw hours. **Employee** — no access to the cross-employee view; their own hours reach them through their payslip and their own compensatory requests.

---

## 3. Workflows

### 3.1 Monthly Payroll Run

1. Accountant, HR, or Super Admin (or Manager, if enabled) opens Run Payroll (2.1), selects Month and Year. The screen immediately resolves and shows the actual Pay Period Covers date range for that selection, read from Masters → Work Week & Hours → Pay Cycle — then either "All active employees" or a specific selection is chosen.
2. The system calculates hour-basis pay for everyone included (Section 2.4), pulls in any pending Ad-hoc Adjustments (2.1a), and automatically skips anyone already Processed for that period.
3. The Preview table shows Gross Pay, Deductions (including any ad-hoc subtractions), Net Pay (including any ad-hoc additions) for every employee in the run.
4. The run is either saved as Draft (for later review) or confirmed directly.
5. On **Confirm & Generate Payslips**: Status moves to Processed for everyone in the run, payslips are generated, and every employee is notified that a new payslip is available. Any one-time ad-hoc adjustment that was included is now spent — it doesn't carry forward; a Recurring one remains queued for the next run.

### 3.1b The Pay Cycle Cutoff — a worked example

**Added 2026-07-30, on explicit instruction.** This is the mechanic that makes a non-calendar pay cycle actually work rather than just look configurable.

1. The company's Pay Cycle (Masters, Section 3.20, Pay Cycle tab) is set to Start Day 26, End Day 25 — the common "26th to 25th" pattern. The July 2026 pay period therefore covers 26-06-2026 through 25-07-2026; August 2026 covers 26-07-2026 through 25-08-2026.
2. An employee takes one day of Approved Casual Leave on **27-07-2026**.
3. When July's Run Payroll (2.1) is calculated, its window closes at 25-07-2026 — the 27th falls two days past that cutoff, so this leave day is **not** included in the July calculation or the July payslip.
4. It is not lost. The same date, 27-07-2026, falls inside August's window (26-07 to 25-08), so it is picked up automatically the next time Run Payroll is used for August, and appears on the **August** payslip instead.
5. Nobody has to remember to move it or flag it manually — which period an event belongs to is decided purely by comparing its date against the Pay Cycle's resolved range for each month, the same comparison Run Payroll already does for every other dated input (attendance, compensatory make-up days, ad-hoc adjustments).
6. **Multi-day leave spanning the cutoff is split, not double-counted.** A request running, say, 24-07 through 28-07 contributes only its working days up to 25-07 to July's calculation, and its working days from 26-07 onward to August's — each portion re-derived with the same working-day counting the Leave module itself uses, so no day is ever counted by both periods or by neither.
7. **Short months clamp; the credit date always follows the cutoff.** An End Day (or Credit Day) past the real last day of a month lands on that month's actual last day — End Day 31 in February resolves to the 28th/29th. And if the configured Salary Credit Day would fall on or before the period's own cutoff, the credit date rolls into the following month, so a run's credit date is always later than the period it pays for.

### 3.1a Accountant or Super Admin Adds an Ad-hoc Adjustment

1. Accountant or Super Admin opens Ad-hoc Payslip Adjustments (2.1a), before or during a payroll run.
2. They choose one employee, or Multiple/All Active Employees for something company-wide like a festival bonus.
3. They enter a Label, choose Addition or Subtraction, the Amount, whether it's Taxable, and whether it's Recurring.
4. Saving queues it. It's picked up automatically the next time Run Payroll (2.1) is used for the relevant employee(s), and shows on their payslip with its actual Label once Processed.

### 3.2 Employee Downloads a Payslip or Requests a Salary Certificate

1. The employee opens Payslip — Employee View (2.2), finds the month they need, and clicks Download.
2. Separately, they click **Download Salary Certificate**, optionally noting a Purpose.
3. The system generates the certificate on demand, pulling current details from the Employee record (including Designation and Department, resolved by name), Company Profile, and Salary Structure — it isn't a monthly record the way a payslip is, since it can be requested at any time; **as built, each request is persisted** with its Purpose, the figure snapshots it printed, and the generated PDF, and a self-service history lists the employee's past requests.

### 3.3 Accountant/HR Reissues a Payslip After Finding an Error

1. Accountant or HR opens Payslip — Accountant/HR View (2.3), finds the affected payslip, and clicks **Reissue**.
2. They either let it recalculate from corrected attendance/leave data, or manually adjust the specific figures, and enter a Reason.
3. On confirming, the payslip updates, a Reissue History entry is recorded (old figures, new figures, who, when, why), and — unless turned off — the employee is notified of the correction.

### 3.4 An Employee Falls Short of the Day's Hours and Makes It Up

The rule the company actually runs on, start to finish. Real figures from the prototype, June 2026:

1. Arun Menon checks in at 09:10 on Tuesday 09-06 and leaves at 14:05 for a family medical emergency. Recorded hours: 4.92 gross, less a 0.50 break = **4.42 worked against 8.00 required**. A 3.58-hour shortfall, and the day resolves to **Half Day** under the policy's hour bands.
2. Rather than lose half a day's pay, he opens **Leave → Compensatory Hours (Module 5, Section 2.6)** and requests to make the hours up. He nominates **Saturday 27-06 — a 4th Saturday, normally a week off** — a day he picks himself. The screen validates it against his policy: inside the 30-day compensation window, under the 16-hour monthly cap, and permitted because the policy allows make-up on a non-working Saturday. It would have been refused on 15-08-2026, a Mandatory holiday.
3. Vikram Iyer, his reporting manager, approves it. Until he does, the shortfall is *suspended* — visible on Payroll → Attendance's Payroll Impact tab with the pending hours shown against it, but not yet deducted.
4. Arun works 10:00–14:30 on 27-06. Four hours on a day that required zero, so the day's own balance is **+4.00**, and those four hours are marked as compensatory credit against the 09-06 shortfall — counted once, not twice.
5. June closes at **194.20 worked against 192.00 required, balance +2.20**. No Loss of Pay line. Run Payroll (2.1) sees a full 24 payable days.
6. Had the request been rejected, or had the window closed first, the 3.58 hours would have converted at the policy's **Uncompensated Shortfall Becomes** setting — pro-rata per hour — and appeared on the payslip as Loss of Pay, with the amount visible to Arun before the run.

Two edge cases the same month, both handled by configuration rather than judgement: on 24-06 he was 0.17 hours under and the **15-minute grace window** absorbed it, so the day stayed a Full Day; Rohit Deshmukh was 19.00 hours short with only 8.00 hours of make-up pending, so the screen states that the other 11.00 hours still deduct instead of implying the request clears it.

### 3.5 (Future) The Biometric Feed Replaces Manual Entry

1. A biometric device, an external HR system push, or geo-fenced mobile check-in begins writing check-in and check-out times.
2. Nothing downstream changes. The stored record keeps its shape; only **Recorded By** changes from a person to a device or system source — which is exactly why that field was never a strict user reference.
3. Required Hours, Worked Hours, the hour bands, compensation and the Loss of Pay conversion all continue working as documented above, because they were never reading the input method — only the times.

## 4. UI/UX Notes

- **The preview-before-confirm step in Run Payroll must be impossible to skip** — there is no path from selecting a Month/Year straight to generated payslips without passing through the Preview table first. Payroll mistakes are expensive and hard to undo, so nothing generates silently.
- **Status tags throughout:** Draft / Processed for payroll runs (Assumption on color: Draft = grey, Processed = green). Wherever a day-basis breakdown is shown, **Paid Leave (counted as present)** and **Unpaid Leave (deducted)** need a clear visual difference — not just two rows in a table that look the same, but distinct styling (e.g., color-coded), since confusing the two directly affects someone's pay.
- **Payslip and Salary Certificate downloads should read like an official document** — proper letterhead, company details, and formatting from Company Profile — since employees may need to submit them to a bank, embassy, or landlord, not just keep them for their own records.

## 5. Connected To / Depends on Masters

Connected To: Employee, Leave (approved leave feeds the pay calculation; approved compensatory hours clear an hour shortfall before it becomes a deduction), Attendance (live — Section 2.4; only the biometric input feed is planned)

Depends on Masters: Financial Year, Holidays, Leave Types, **Work Week & Hours (Section 3.20 — Net Working Hours per Day, the working-day count, the Saturday rule, and what an uncompensated shortfall becomes; its Pay Cycle tab — Start Day, End Day — decides what date range a given month's run and payslip actually cover, and the cutoff that defers a late-dated event to next month)**, Taxes (Section 3.2 — every deduction, every employer contribution, the income tax calculation, and the tax schemes employees choose between), Insurance Plans, **Email Configuration (Section 3.21 — the Payslip Available and Payslip Reissued email templates)**

Needs: Salary Structures (Employee module), Insurance & Benefits enrollment (Employee module), My Tax Declarations (Employee module)

**Confirmed already correctly set up in Masters:** Financial Year, Holidays, and Leave Types are all already fully defined (Masters, Sections 3.1, 3.5, 3.4) and this module reads them directly — no new gaps there.

**Resolved — Salary Structure now has an owner.** The Employee module (Module 2, Section 2.2) is where Super Admin creates and edits a Salary Structure, directly on the employee record it belongs to. Payroll reads it; it doesn't own or edit it. This also resolves the correction that was needed in the Employee module (Module 2) — its earlier claim that Salary Structure was "Payroll-owned" was wrong, and has been fixed there.

**The deduction audit is now a runtime screen, not a table in this document — the single biggest change in this revision.**

An earlier revision built a full audit here: two fixed tables naming every deduction and employer contribution this module applies, each pointing at the Masters sub-master holding its rate. That audit answered a real question — "what exactly comes out of pay, and where does each figure come from?" — and the question still deserves an answer. But the tables listed Employee PF Contribution, Employee ESI Contribution, Professional Tax, TDS, Employer PF Contribution, Employer ESI Contribution, and Gratuity Accrual by name, which assumed all seven apply to this company. **That was never confirmed, and per explicit instruction it is no longer assumed.**

So the audit moved. **Masters → Taxes → Where Used (Section 3.2)** shows, at any moment, every configured tax head, its scope, its calculation, its source, and which modules currently consume it — generated from the live configuration rather than written down once. That is a better answer than a static table anyway: it can't drift out of date, and it covers heads nobody anticipated when this document was written.

**What this module applies, stated without naming anything:**

| Category | What Gets Applied | Where the Figures Come From | Where Applicability Comes From |
|---|---|---|---|
| Employee-borne statutory | Every in-force head with scope *Payroll — Employee Deduction* | The head's own rate, slab, ceiling, threshold, cap, and rounding (Masters, 3.2) | The head's date range, locations, employment types, and scheme; plus the per-employee Applicable toggle on Salary Structure (Employee, 2.2) where permitted |
| Company-borne statutory | Every in-force head with scope *Payroll — Employer Contribution* | Same | Same. Feeds Annual CTC (Employee, 2.2) where the head sets Include in Cost to Company; never reduces Net Pay |
| Income tax | Every in-force head with scope *Payroll — Income Tax* | The head's slabs or rate, plus its Relief Rules | The employee's scheme choice and Submitted declarations (Employee, 2.15) |
| Insurance premium | Employee and employer contribution on any enrolled plan | Masters, Insurance Plans (3.18) | Insurance & Benefits enrollment (Employee, 2.2) — a benefit, not a tax, so it stays a named line |
| Unpaid leave | Pro-rata reduction | Calculated here, Section 2.1 | Leave module (Module 5) |
| Unmet hours | Loss of Pay, converted at whatever *Uncompensated Shortfall Becomes* specifies — pro-rata per hour as currently configured | Reconciled in Section 2.4 against Required Hours from the work-week policy | Masters, Work Week & Hours (3.19); cleared in advance by an approved compensatory request (Leave, 2.6) |
| Ad-hoc | Whatever was entered | Section 2.1a | Entered per employee or in bulk |

**Per-employee applicability survives, generalized.** A head marked as permitting per-employee opt-out gets an Applicable toggle on that employee's Salary Structure, editable by Super Admin or Accountant. If set to No, this module skips that head entirely for that person, and the same setting is what the Offer & Appointment Letter (Employee module, Section 2.16) discloses — so nobody gets a letter promising a deduction that doesn't apply, or vice versa. This is the same guarantee the old fixed toggles gave, without deciding in advance which three components needed it.

**Two corrections from earlier revisions, both now moot but recorded rather than erased.** One revision added Tamil Nadu's Labour Welfare Fund as both an employee and employer line, then removed it as a poor fit for this company. Another added and then removed EDLI and Health & Education Cess on explicit instruction. Each of those was an argument about whether one specific named tax belonged in the specification — an argument this design makes unnecessary, since no tax is named in the specification at all. If any of them applies, someone configures it; if not, nobody has to write a paragraph explaining its absence.

**What this module now guarantees:** it calculates nothing on its own authority. Every statutory figure on every payslip traces to a tax head someone deliberately created, and this document contains no rate, no slab, no threshold, and no tax name.

**Export and filters:** every list screen in this module — the Preview and Payroll History on Run Payroll (2.1), the Ad-hoc Adjustments list (2.1a), My Payslips (2.2), and Payslip — Accountant/HR View (2.3) — carries a documented filter set plus "Export to PDF" and "Export to Excel," per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). Filter sets were expanded across all of them in this revision; each is documented on its own screen above.

**The one place amounts are restricted is the column, not the export button.** Manager's view hides salary amounts unless the "Show Salary Amount to Manager" flag is on, and the export mirrors the screen exactly — so universal export access grants Manager nothing they couldn't already see. Every other role's export carries whatever their screen carries.

## 6. Role-Based Access

> **Baseline, shared by all 5 roles:** every person is, first, an employee themselves. Viewing and downloading their own payslip, and downloading their own Salary Certificate, is identical no matter what role someone holds — nobody's access to their own pay should ever be narrower than a plain Employee's. What follows is each role's additional access on top of that shared baseline.

- **Employee** — the baseline only.
- **Manager** — the baseline for themselves, and **nothing else by default.** Does not run payroll unless "Allow Manager to Run Payroll" is turned on (see below), and — since Team Payslips was removed from both this module and the Employee module (see the note directly below) — has no visibility into a direct report's payslip at all, not even a status-only Processed/Pending view.
- **Accountant** — the baseline for themselves, PLUS running payroll, viewing everyone's payslips in full, reissuing payslips, and adding Ad-hoc Payslip Adjustments (2.1a).
- **HR** — the baseline for themselves, PLUS running payroll, viewing everyone's payslips in full, and reissuing payslips. Does **not** get Ad-hoc Payslip Adjustments (2.1a) by default — new in this revision, kept to Accountant and Super Admin specifically, the same narrower-than-general-payroll-access pattern already used for Salary Structure editing (Section 2.2 of the Employee module).
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Payroll row: Super Admin = All, Employee = partial (view/download own payslips), Manager = partial (run payroll, view all), Accountant = partial (run payroll, view all, payslips), HR = partial (run payroll, view all). This matches the brief exactly, including the unusually broad Manager access. That breadth is deliberately not built as-is — see the correction below.

**A correction, previously flagged under a now-removed screen, moved here rather than lost.** The source spreadsheet gives Manager full **"run payroll + view all"** rights for this module — company-wide, the same breadth as Accountant and HR. That's unusually broad for what's normally a people-manager role, and it's the same pattern already flagged in the Ticket module (Module 4, Section 6.1) — "Manager" meaning a broad operations role in some modules (Ticket, and per that document's note, Customer/Opportunity/Vendor) versus a narrow direct-reports-only role in others (Employee, Asset Management, Leave). This document defaults Manager **down** to no payroll access at all beyond their own baseline, with **"Allow Manager to Run Payroll"** available to restore the source sheet's original full access if that's genuinely what's wanted.

**Team Payslips — removed entirely, on explicit instruction, from both this module and the Employee module.** An earlier revision of this module carried its own Screen 2.3, "Payslip — Manager View": a status-only (Processed/Pending) list of a Manager's direct reports' pay, widenable to a visible Net Pay amount by the "Show Salary Amount to Manager" toggle. The Employee module separately carried a near-identical screen under the same name, "Team Payslips (Manager View)" — the same feature, documented twice. **Both are now gone.** A Manager gets no payslip-related visibility into their team at all, from either module. If a team-level pay view is ever wanted back, it should be designed once, in one module, rather than reintroduced as a duplicate in both.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Allow Manager to Run Payroll"** — OFF by default, per the correction above. Turned ON: restores the full company-wide run-and-view-all access the source sheet originally gave Manager.
- **"Show Salary Amount to Manager" — retired alongside Team Payslips.** This toggle used to widen Manager's Team Payslips screen from status-only to a visible Net Pay amount, shared with the same-named toggle in the Employee module. With that screen gone from both modules, the toggle has nothing left to control. Kept here, struck through in spirit rather than deleted outright, so a future revision that reintroduces team-level pay visibility knows this is the setting that used to govern it.
- **"Require Super Admin Approval to Reissue a Payslip"** — OFF by default: Accountant/HR reissue directly. Turned ON: a reissue needs Super Admin sign-off first — useful once the company is bigger and wants tighter financial controls.
- **"Notify Employee When a Payslip Is Reissued"** — Assumption, added alongside the reissue feature in 2.3: ON by default. Turned OFF: a correction can be made without alerting the employee, for cases where that's not appropriate or needed.
- **"Allow HR to Add Ad-hoc Payslip Adjustments"** — New in this revision: OFF by default, kept to Accountant and Super Admin. Turned ON: HR could add one-off bonuses/recoveries too, useful if HR (not Accountant) is who typically knows about a signing bonus or joining incentive from an offer negotiation.
- **"Hide Ad-hoc Adjustment Labels from Employee"** — New in this revision: OFF by default — the actual Label ("Diwali Bonus," "Advance Recovery") shows on the employee's own payslip, per the transparency default in Section 2.1a. Turned ON: the payslip would show a generic "Adjustment" line with the amount but not the reason — flagged as available, but transparency is the recommended default, not this.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role (for example, one particular Manager who also handles budget planning could get "Allow Manager to Run Payroll" turned on just for them, without changing the setting for every Manager). The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Unpaid leave deduction formula — resolved and built (A115):** Deduction = (Gross Pay ÷ Total Days in the resolved Pay Period) × Unpaid Leave Days, the single formula used wherever unpaid leave or Loss of Pay reduces pay. The denominator is the pay period's day count, not the calendar month's.
2. **Already-processed skip is per employee+month**, not a whole month at once — needed so a late joiner or a corrected re-run doesn't block everyone else.
3. **Draft vs. Processed, defined**: Draft = calculated and saved for review, recalculable, no payslips generated; Processed = confirmed, payslips generated and visible to employees, locked (further changes go through Reissue). The brief named both statuses but didn't define what separates them.
4. **Salary Certificate Purpose field** — added as optional, since these letters commonly state their purpose.
5. **Reissue supports both recalculation and manual figure adjustment**, with a required reason either way, plus a Reissue History log — not fully specified, built out for auditability.
6. **Hour-basis "break time" assumed to be a configurable standard deduction** (e.g. 1-hour lunch), not actual break-level clock-in/out — matches what the Employee module's Attendance design actually captures (one Check-In, one Check-Out per day).
7. **Payroll Basis (Day/Hour) — resolved:** it lives on Company Profile in Masters. Only the Hour Basis engine exists; selecting Day Basis makes run creation refuse with an explicit conflict error rather than silently calculating on hours (see Implementation Status).
8. **Salary Structure ownership — resolved, no longer open.** Employee module (Module 2, Section 2.2), Super Admin edits. See Section 5.
9. **The Employee module correction is applied** — confirmed fixed there; no longer flagged as pending.
10. **Manager's broad access, corrected** — the same "what does Manager mean" tension first flagged in the Ticket module (Module 4, Section 6.1). Now fully resolved as of the Invoice module (Module 11, Section 6.1): Manager runs relationships and delivery, never money — which is exactly why Manager's originally broad access here was the right thing to default down.
11. **Sheet1 also lists "Tasks / Projects done" as planned**, alongside Attendance, in this module's connected-to data — possibly a future performance- or project-linked pay component. Not detailed anywhere in this brief, so it isn't built or designed here — flagged only so it isn't lost track of. **Update:** the Project module (Module 10, Section 2.8) now supplies this detail — a planned Timesheets feature there is what would feed this input, once both sides are built.
12. **Income tax calculation method** — annualize current Gross Monthly, subtract whatever the configuration says is deductible, apply the configured head, divide by remaining payroll months in the financial year. *The shape of this method survived item 20 unchanged; only its inputs stopped being named.* It remains a reasonable, standard approach for spreading annual tax liability across monthly deductions, not a definitive implementation of any jurisdiction's tax law — still worth review by whoever has payroll/tax domain expertise before it's built.
13. **Export confirmed** on Payroll History (2.1) and Payslip — Accountant/HR View (2.3), per the system-wide convention (RBAC, Module 14, Section 2.2). *Extended by item 21 to every list screen in this module.*

21. **This revision — filters on every list screen for every role, with filter-based export, per explicit instruction.** Six list screens in this module were audited. My Payslips had one filter (Year); the Accountant/HR view had three; Payroll History, the Manager view, and the Ad-hoc Adjustments list had none. All six now carry documented filter sets and filter-based export.

    **Payroll is the module where universal export access sounds riskiest, so the reasoning is worth stating plainly:** it is safe because export mirrors the screen exactly, and the screen is already role-scoped and column-restricted. A Manager whose table shows Processed/Pending with no amounts exports Processed/Pending with no amounts. The "Show Salary Amount to Manager" flag governs the column, and the export follows the column — no second rule, no separate permission, no way for the export button to become a route to data the screen wouldn't show.

    **Two filters added because they answer questions this module is actually asked:** "has ad-hoc adjustments" and "has unpaid leave" on the Accountant/HR view, which between them cover most reasons a specific payslip gets queried; and free-text search over the Ad-hoc Adjustments Label, since those labels are free text and there was previously no way to find every active recovery against an advance.
14–17. **Four consecutive revisions spent arguing about which named taxes belonged in this module — all superseded by item 20, and kept together here because the pattern is the point.** In order: item 14 added ESI, Professional Tax, and Insurance Employee Contribution as named deductions reading from four Masters sub-masters. Item 15 added the Section 87A rebate and Health & Education Cess to the tax method, after research found the calculation would otherwise overstate tax for employees who legally owed zero. Item 16 added EDLI and Gratuity accrual as employer-side contributions, and removed Labour Welfare Fund as a poor fit for this company's industry. Item 17 removed Cess and EDLI on explicit instruction, while keeping Gratuity and the rebate.

    Every one of those was a genuine, careful correction. Collectively they were four rounds of maintaining a hardcoded list of taxes that nobody had confirmed applied — with each round's research, addition, removal, and justification written into three documents. Item 20 ends that loop by removing the list itself. The research findings aren't lost, they're simply no longer this document's business: if Gratuity applies, someone configures a head for it; if a rebate applies, someone adds a Relief Rule.
18. **New — Ad-hoc Payslip Adjustments (Section 2.1a), designed and added this revision.** Accountant and Super Admin can now add one-off or recurring custom line items — a bonus, a recovery, a correction — to any employee's payslip, separately from the fixed Salary Structure. Design choices worth a second look: defaults to Taxable = Yes (most ad-hoc pay is taxable, but this needs a human decision each time); fully transparent to the employee by default (the actual Label shows on their payslip, not a generic "Adjustment"). HR does not get this by default, unlike general payroll-running access — a toggle exists to widen it if HR is who actually handles offer-negotiated terms in practice. (Its connection to Appointment Letters was originally manual — see item 19, it's automatic now.)
19. **The Appointment Letter connection is now automatic, and statutory components are no longer always-on.** A Custom Term added on the Offer & Appointment Letter screen (Employee module, Section 2.16) queues here automatically, effective from Joining Date — no separate manual entry once the person joins. Separately, statutory components respect an Applicable toggle set on Salary Structure (Employee module, Section 2.2, editable by Super Admin or Accountant) — this module skips the deduction and matching employer contribution entirely for anyone marked not applicable, rather than assuming universal coverage. *Generalized by item 20: this applies to every configured head that permits per-employee opt-out, rather than to three named ones.*

20. **This revision — every named tax removed from this module, per explicit instruction.**

    **What prompted it:** it was stated directly that it isn't known which taxes and statutory deductions apply to this company, and that Super Admin (or Accountant) should add whatever does apply, themselves. Items 14 through 17 above are the clearest evidence of why that instruction was right — four revisions of adding, researching, justifying, and removing individually named taxes, none of which ever established that any of them applied here.

    **What changed in this document:**
    - The step-5 TDS method, which read named Masters sub-masters and applied a named rebate, is replaced by two general steps: statutory heads applied monthly (step 5), and income-tax heads computed annually and spread (step 6). Both read Masters → Taxes (Section 3.2).
    - The Preview table and payslip breakup (2.1, 2.2) build their deduction columns from configuration instead of listing five named ones.
    - Section 5's two audit tables — seven named deductions and contributions with their rate sources — are gone, replaced by a category table that names no tax, plus a pointer to Masters → Taxes → Where Used, which generates the same audit from live configuration and cannot drift stale.

    **What survived unchanged:** the day-basis pay calculation, unpaid-leave handling, the already-processed skip, Ad-hoc Payslip Adjustments (2.1a) in full, the Draft/Processed flow, reissue, and every role permission. None of those ever depended on which taxes exist.

    **One genuine capability gap, flagged not hidden:** the tax-head design can express a relief threshold but not a taper above it (the pattern sometimes called marginal relief). If a configured head needs that, it's a real addition to make before build. See the closing note of Section 2.1, step 6.

    **What this module must never reacquire:** a named tax, a rate, a slab, or a threshold. Masters → Taxes is where those live now.

---

**Suggested filename:** `06-payroll-module.md`
