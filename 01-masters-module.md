# Module 1 of 14: Masters

## 1. Module Overview

Masters is the settings and configuration area of the CMS. It holds the small, shared pieces of reference data and company-wide defaults that every other module reads from — mostly as dropdown lists, default values, or numbering rules. Masters does not hold full business records of its own. It never stores a customer, a vendor, an employee, an invoice, or a project — those all live in their own dedicated modules, documented separately.

Masters exists so that the CMS has one single, controlled "shared vocabulary" instead of every module inventing its own version of the same thing. Without it, one module might call the same tax rate two different things, Payment Modes would be typed differently everywhere, and there would be no single place to close a financial year or store the company's own registration details that appear on every invoice and letter. Because Masters is confidential shared configuration, access to it is tightly controlled — creating, editing, and especially deleting entries is almost entirely the Super Admin's job — so day-to-day users work from consistent, pre-approved lists rather than editing configuration on the fly.

Nearly every other module in this CMS depends on at least one part of Masters. The most common dependency is the Financial Year (used to generate almost every auto-numbered code) and the Company Profile (used for prefixes, default tax, bank details, and official company information printed on documents). Section 5 of this document gives the full dependency map, module by module.

## 2. Sub-Master Directory

| # | Sub-Master | One-Line Purpose |
|---|---|---|
| 1 | [Financial Year](#31-financial-year) | Defines the company's financial years and locks a year once it's closed so nothing inside it can change. |
| 2 | [Taxes](#32-taxes) | One dynamic list where Super Admin defines every tax, statutory deduction, and contribution this company actually has to apply — billing taxes, payroll deductions, employer contributions, employee-declared exemptions. Nothing is pre-set. |
| 3 | [Expense Types](#33-expense-types) | Categories used to classify the company's own small purchases. |
| 4 | [Leave Types](#34-leave-types) | Categories of employee leave, such as Casual or Work From Home. |
| 5 | [Holidays](#35-holidays) | The company holiday calendar, including which days are compulsory. |
| 6 | [Company Profile](#36-company-profile) | Meshrd's own official company details, addresses, bank info, documents, and numbering rules. |
| 7 | [Bank Account](#37-bank-account) | Meshrd's own bank accounts, used to receive and make payments. |
| 8 | [Payment Mode](#38-payment-mode) | The accepted ways a payment can be made or received. |
| 9 | [Department](#39-department) | The controlled list of departments staff can belong to. |
| 10 | [Designation / Job Title](#310-designation--job-title) | The controlled list of job titles staff can hold. |
| 11 | [HSN / SAC Code](#311-hsn--sac-code) | Tax classification codes for invoice line items, each optionally linked to a configured billing tax. |
| 12 | [Service Category](#312-service-category) | Meshrd's own service lines, for tagging Opportunities, Projects, and Invoices. |
| 13 | [Unit of Measure](#313-unit-of-measure) | Controlled units (Hours, Days, License, etc.) for invoice line items. |
| 14 | [Ticket Categories](#314-ticket-categories) | Categories used to classify support tickets. |
| 15 | [Customer Status](#315-customer-status) | The lifecycle states a customer record can be in. |
| 16 | [Customer Source](#316-customer-source) | Where a customer first came from — Referral, Website, Cold Outreach, and so on. |
| 17 | [Asset Categories](#317-asset-categories) | Categories for every company-owned physical asset, from laptops to office furniture. |
| 18 | [Employment Type](#318-employment-type) | The controlled list of employment types staff can be classified under. |
| 19 | [Insurance Plans](#319-insurance-plans) | Company-provided health, life, and accident insurance plans offered as an employee benefit. |
| 20 | [Work Week & Hours](#320-work-week--hours) | Hours per day, the unpaid break, the weekly hour target, which Saturdays are working, and what an unmet hour shortfall does to pay. The rules Attendance and Payroll both measure against. |
| 21 | [Email Configuration](#321-email-configuration) | The outbound mail server this CMS sends through, and the dynamic list of email triggers — welcome emails, payslips, approvals, resets — each independently editable and switchable. |

**Customer Source, removed on 2026-07-30, RESTORED on 2026-07-31.** It was taken out entirely — sub-master and the Customer record's Source field together — on an instruction that, on review, only meant removing it from Masters' default view, not deleting the field. Re-added as Section 3.16, and the Customer record's Source field is back (Customer module, Module 8, Section 2.2). Masters was back to **20 sub-masters** at that point, and stands at **21** today after Email Configuration (Section 3.21) was added. **Lesson for this project: "remove X from Masters" is a narrower instruction than "remove X" — a sub-master and the field it feeds are two different things, and taking one out does not by default mean taking out the other.**

**This directory changed in this revision — four sub-masters were removed, not renamed.** Income Tax Slabs (TDS), PF & ESI Rates, Professional Tax Slabs, and Old Regime Deduction Limits each used to be their own fixed sub-master, with named fields for specific Indian statutory items — PF Employer Rate, ESI Wage Threshold, Section 80C Cap, HRA Metro Percentage, Section 87A Rebate, and so on. All four are gone. Every one of those things is now just a record Super Admin creates inside **Taxes (Section 3.2)**, using generic fields that describe *how a tax behaves* rather than *which tax it is*.

**Why this changed, stated plainly, because it is the single most important decision in this module:** nobody has yet confirmed which of those statutory items actually apply to this company. Writing PF, ESI, Professional Tax, and Old Regime deduction caps into the specification as permanent named structures assumed an answer that was never given. If it turns out PF doesn't apply, or that a completely different levy does, the old design needed a documentation change and a code change to cope. The new design needs neither — Super Admin (or Accountant, if given the right) opens Taxes, clicks Add, and describes the tax. The system has no opinion about which taxes exist, and this document names none.

**What this means for everything downstream:** Payroll, Employee, Invoice, Expense, and Purchase Bill no longer read from four differently-shaped tax tables. They all read the one Taxes list, filtered by scope. A payslip's deduction lines, an invoice's tax lines, and an employee's declaration fields are all generated from whatever Super Admin has configured — none of them are fixed lists in code or in these documents.

## 3. Detailed Specification, One Section Per Sub-Master

> **Implementation status convention (reconciled against the built backend, 2026-08-03).** This module is built — FastAPI + MySQL, migrations 0001–0008, all endpoints under `/masters/*`. Each section below now carries an **Implementation status** note recording what is BUILT, what is DEFERRED (with the reason), and where the code corrected something this document previously asserted. One structural fact stated once: **the fifteen simple lookup sub-masters** — Expense Types, Leave Types, Holidays, Payment Mode, Department, Designation, HSN/SAC Code, Service Category, Unit of Measure, Ticket Categories, Customer Status, Customer Source, Asset Categories, Employment Type, Insurance Plans — are all generated from **one generic router factory** (`app/api/v1/masters_lookup.py`, instantiated in `masters_simple.py`), each getting the identical contract: list (with Search + include-inactive Status filter + `?format=pdf|excel` export), create, update, `POST /{id}/deactivate` (Super Admin only, §3.0 rule 1), and `DELETE /{id}` (Super Admin only; the database's ON DELETE RESTRICT foreign keys reject the delete with a 409 once anything references the row — which is exactly the "never hard-deleted once used" rule, enforced by the schema rather than per-endpoint code). Sections 3.3–3.5, 3.8–3.19 are therefore all BUILT; their individual notes below record only what differs from this shared shape. Financial Year, Taxes, Company Profile, Bank Account, Work Week & Hours, and Email Configuration each have bespoke routers, documented in their own sections. The "Starting values" lists proposed in several sections (Service Category, Ticket Categories, Customer Status, Customer Source, Asset Categories, Employment Type) are **not seeded** — they remain data-entry proposals for implementation day; only Number Prefix rules and Email Templates are seeded (see §3.6e and §3.21).

### 3.0 Access Model for All Sub-Masters

This one model governs who can do what across every sub-master below. Each individual section then carries only a short "Role Access" line pointing back here, instead of repeating a near-identical table twenty-one times.

**Permission levels** — on each sub-master, a role has exactly one of these:

- **Manage (Add + Edit)** — can create new entries and change existing ones.
- **View** — can open the section and read the list, but change nothing.
- **No access** — the section is not shown to this role at all.

**Two rules that never change, on every sub-master:**

1. **Delete and Deactivate are Super Admin only.** No other role can ever delete or switch off a Master entry — even on a sub-master they are allowed to add to or edit. Masters is confidential shared configuration, so the power to make an existing option disappear stays with one role. A Manager or HR user who can add and edit entries will simply not see a Delete or Deactivate control; only Super Admin sees it.
2. **A locked Financial Year is frozen for everyone, including Super Admin, while it stays locked.** No record dated inside it can be added, edited, or deleted by anyone — not even the Super Admin who locked it — **until a Super Admin explicitly reopens the year via Unlock** (§3.1, revised 2026-08-05; see the Implementation status note there for why).

**Who can touch what** — everything not spelled out below is Super Admin only, and Super Admin always has full CRUD (Create, Read, Update, Delete/Deactivate) on all 21 sub-masters.

| Sub-Master | Super Admin | Manager | HR | Accountant | Employee |
|---|---|---|---|---|---|
| Financial Year | Full CRUD | No access | No access | No access | No access |
| Taxes | Full CRUD | No access | No access | View (Manage if the RBAC flag is on) | No access |
| Expense Types | Full CRUD | Manage (no delete) | No access | No access | No access |
| Leave Types | Full CRUD | Manage (no delete) | Manage (no delete) | No access | No access |
| Holidays | Full CRUD | Manage (no delete) | No access | No access | No access |
| Company Profile | Full CRUD | View | No access | No access | No access |
| Bank Account | Full CRUD | No access | No access | No access | No access |
| Payment Mode | Full CRUD | No access | No access | No access | No access |
| Department | Full CRUD | No access | No access | No access | No access |
| Designation / Job Title | Full CRUD | No access | No access | No access | No access |
| HSN / SAC Code | Full CRUD | No access | No access | No access | No access |
| Service Category | Full CRUD | No access | No access | No access | No access |
| Unit of Measure | Full CRUD | No access | No access | No access | No access |
| Ticket Categories | Full CRUD | No access | No access | No access | No access |
| Customer Status | Full CRUD | No access | No access | No access | No access |
| Asset Categories | Full CRUD | No access | No access | No access | No access |
| Employment Type | Full CRUD | No access | No access | No access | No access |
| Insurance Plans | Full CRUD | No access | View | No access | No access |
| Customer Source | Full CRUD | No access | No access | No access | No access |
| Work Week & Hours | Full CRUD | View | View | No access | No access |
| Email Configuration | Full CRUD | No access | No access | No access | No access |

**The last three rows were missing from this table until this revision** — Customer Source (Section 3.16), Work Week & Hours (Section 3.20) and Email Configuration (Section 3.21) each had a section of their own but no row here. The "everything not spelled out is Super Admin only" default above did cover them, but silently, and Work Week & Hours in particular needed stating rather than inferring: **Manager and HR get View.** They are the two roles who field "why was I short this month?" — the answer is the hours-per-day, the break, and the Saturday rule on that employee's policy, and they cannot answer it from a screen they cannot open. Changing a rule that moves pay stays Super Admin only, as does adding a policy or overriding a Saturday. Values transcribed from the prototype's own policy table (`app-rbac.js`, `masters.workweek` / `masters.email`), which already carried them.

"Manage (no delete)" means Create + Read + Update, with Delete/Deactivate reserved for Super Admin. Two sub-masters carry an exception to the "Super Admin only" default, both because someone needs to see the configuration without being able to change it by default: Accountant gets View on Taxes, so payroll and invoice figures can be sanity-checked against the tax heads that produced them. HR gets View on Insurance Plans, as the natural point of contact for benefits questions, without setting premium or coverage terms themselves.

**One deliberate escalation path, new in this revision — Accountant can be promoted to Manage on Taxes.** Taxes is the only sub-master in this module where the person most likely to *know* the right answer is not Super Admin. Which levies a company is registered for, what a slab changed to this year, whether a new deduction now applies — that is finance knowledge, and routing every such update through Super Admin creates a bottleneck on exactly the data that changes most often. So the RBAC flag **"Allow Accountant to Manage Taxes"** (RBAC, Module 14, Section 2.1) exists: OFF by default, leaving Accountant view-only; turned ON, Accountant can add and edit tax heads directly. Delete and Deactivate stay with Super Admin either way, per rule 1 above — no exception. Whoever holds the right, the point of this sub-master is that a human with finance knowledge enters the taxes, rather than a developer encoding them.

> **Implementation status — the escalation exists, but not as a named toggle.** The seeded RBAC matrix gives Accountant View on `masters.taxes` and reserves the `edit` action for Super Admin, exactly as the default above. However, the named FeatureToggle rows are modeled and seeded but **not read by the RBAC resolver anywhere** — flipping the "Allow Accountant to Manage Taxes" toggle row does nothing at runtime. What IS live is the **per-person UserPermissionOverride** mechanism via the RBAC admin screens (Module 14): promoting a specific Accountant to Manage on Taxes is done by granting that user an override on the `masters.taxes` edit action. The effect the flag was specified for is achievable today; the switch is per-user, not the single named company-wide flag. Wiring named toggles into the resolver remains DEFERRED (a deliberate Phase 7 finding: named toggles are static seed-time choices only).

**Section visibility follows this table.** The Masters menu shows a role only the sections it can Manage or View:

- **Super Admin** → all 21 sub-masters.
- **Manager** → Expense Types, Holidays, Leave Types, Company Profile (4 sections).
- **HR** → Leave Types (manage) and Insurance Plans (view-only).
- **Accountant** → Taxes only, view-only by default, editable if the RBAC flag above is on.
- **Employee** → no Masters menu item at all.

#### Filters and Export on Every Sub-Master List — One Rule for All 19

**New in this revision.** Every sub-master list screen in this module follows the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). Stated once here rather than repeated in twenty-one "Screen Design" sections:

- **Search**, across that sub-master's name and code fields.
- **Status filter** (Active / Inactive), defaulting to Active with an explicit "include inactive" option — retired entries are hidden by default but never silently unreachable.
- **Financial Year filter**, on every sub-master whose records are scoped to one (Holidays, and any tax head carrying a Financial Year).
- **Used / Unused filter**, specific to this module and genuinely useful here: whether an entry has ever been referenced by a real record. This is what makes "which of these can I safely deactivate?" answerable without opening each one.
- **Created By, Last Modified By, and Created On range** — Masters is confidential shared configuration, and knowing who changed a shared list and when is worth more here than almost anywhere else in the CMS.
- **Export to PDF and Export to Excel**, exporting exactly the filtered set with a header stating the filters applied. This gives Super Admin a printable record of the whole configuration at a point in time, which is the practical form of "what was the system set to when this document was issued?"

**Who gets these:** every role that can open a given sub-master tab, per the convention's all-roles rule. In practice that mostly means Super Admin, since most sub-masters are Super Admin only — but where Manager sees Expense Types, HR sees Leave Types, or Accountant sees Taxes, each gets that tab's full filter set and export, not a reduced version.

**Taxes (Section 3.2) carries more than the shared set**, given how much now lives inside it — Scope, Method, "currently in force," and the Where Used view. Those are documented in its own Screen Design section.

> **Implementation status — Filters & Export.** BUILT, on every Masters list endpoint: **Search** (case-insensitive substring on the identifying field, via `?search=`), **Status** (`?include_inactive=` — Active-only by default, exactly the "hidden by default but never silently unreachable" rule), and **Export to PDF and Excel** (`?format=pdf|excel` on the same list endpoint, exporting exactly the filtered set through the shared `list_export.build_export` contract with the RBAC §2.2(f) header block — filters applied, result count, exported-by, exported-at). Financial Year additionally has its multi-select Status (Open/Locked) filter. DEFERRED, deliberately: the **Used/Unused filter** (it needs cross-module reference data that only exists per-consumer; Bank Account exposes a partial `is_referenced` signal — see §3.7 — and Tax Heads a `usage_count`, but no generic Used filter exists), the **Financial Year filter** on Holidays, and the **Created By / Last Modified By / Created On range** filters (the audit columns exist on every row; the query parameters were consciously not built in this round — extended per-screen filters were deferred system-wide). The bespoke lists (Taxes, Bank Accounts, Work Week Policies, Saturday Overrides, Email Templates, Recent Sends) export but currently take **no query filters at all** beyond what their sections note.

**Important — the system still reads Masters even for roles that cannot see it.** "No access" means a role cannot open the Masters admin screens. It does **not** stop the app from reading a Master's values to fill a dropdown inside a screen that role is allowed to use. An Accountant creating an invoice still sees the list of configured billing taxes, bank accounts, HSN/SAC codes, and payment modes as normal dropdowns — those values come from Masters, but the Accountant never opens Masters itself. Without this, the Invoice, Expense, Payroll, and Employee modules could not function for anyone but Super Admin.

### 3.1 Financial Year

#### Purpose

Every other module that needs a running code (Customer, Invoice, Project, and so on) stamps that code with a Financial Year. This sub-master defines what financial years exist, and lets a year be permanently locked once its books are closed, so nothing dated inside it can be changed by accident.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Financial Year Label | Text (auto-generated) | Y | Auto-filled from the Start Date's year, e.g. "2026" for the year starting 01-Apr-2026; not directly editable |
| Start Date | Date | Y | Must be 1 April of a chosen year; dd-mm-yyyy |
| End Date | Date | Y | Auto-set to 31 March of the following year once Start Date is chosen; not independently editable |
| Status | Dropdown (Open / Locked) | Y | Defaults to "Open"; can only be changed to "Locked," never back |
| Is Current Financial Year | Toggle (system-managed) | N | Only one Financial Year can be marked current at a time; managed automatically based on today's date |
| Locked By | Text (system, read-only) | N | Auto-filled with the user who locked it |
| Locked On | Date (system, read-only) | N | Auto-filled with the date/time it was locked |

Validation: Start Date must be 1 April; Financial Years cannot overlap each other; once Status is set to Locked, every field on the record — and every record dated inside that year, in every module — becomes permanently read-only for all users, Super Admin included.

> **Implementation status — BUILT** (`app/api/v1/financial_years.py`, the Phase 0 vertical slice), with these corrections against the table above:
>
> - **Only the Start Date is entered; Label and End Date are derived, exactly as specified** — but the derivation is more general than "31 March": Label = the Start Date's calendar year, End Date = Start Date + 1 year − 1 day. **The "must be 1 April" validation is not enforced** — any start date is accepted; a duplicate Label (same start year) is rejected with 409. The 1-April convention is a data-entry discipline, not a code rule.
> - **Is Current is not automatic.** The spec's "managed automatically based on today's date" is contradicted by the build: current-year selection is an explicit **`POST /{id}/set-current`** action (Super Admin, its own RBAC action), which unsets the previous current row and refuses a locked year (409). Every downstream module that snapshots "today's FY" reads the one `is_current` row.
> - **Locking:** `POST /{id}/lock` stamps Locked By / Locked On (re-locking an already-locked year returns 409). **Revised 2026-08-05 — Super Admin now has a genuine Unlock.** The original "no unlock endpoint anywhere, a deliberate absence" decision (A002) was explicitly reversed by product decision: `POST /{id}/unlock` exists, gated to Super Admin by RBAC (its own `unlock` screen action). Defence in depth is preserved rather than dropped — `trg_fy_reject_unlock` (migration 0009) still rejects any direct SQL `UPDATE` that flips `locked` back to `open`; it only permits the transition when the current DB session has set `@fy_unlock_allowed = 1`, and `unlock_financial_year` is the only code path in the codebase that ever sets it, resetting it to `NULL` immediately after. Unlocking clears Locked By / Locked On and genuinely reopens the period — every module that checks "is this FY locked" before allowing a write permits edits again, exactly as if the year had never been locked.
> - **Delete of an unreferenced Financial Year is DEFERRED** — no DELETE endpoint exists. The "may be deleted outright if nothing references it" allowance below is not yet available; a mistaken year currently has no removal path via the API.
> - List: multi-select Status filter (`?status=open&status=locked`) + PDF/Excel export, sorted Start Date newest first, per the Screen Design.

Assumption: the Financial Year Label uses the calendar year the year **starts** in (e.g., "2026" = 01-Apr-2026 to 31-Mar-2027). This matches the existing "AST-2026-0001" style asset code already in use elsewhere in the CMS, and is the convention every other module's auto-generated code follows when it inserts a Financial Year into a code (see Section 3.6e).

#### Screen Design

**Screen type:** A tab inside the Masters settings page (see Section 4).

List view shows: Financial Year Label, Start Date, End Date, Status badge (Open/Locked), and a small flag marking the current year. Given the small number of rows this list will ever have, no search box is needed, but a Status filter (All / Open / Locked) is provided. Default sort is Start Date, newest first.

The "+ Add Financial Year" button opens a small pop-up asking only for a Start Date — the Label and End Date are derived automatically and shown as a preview before saving.

A confirmation pop-up is required before locking a year: "Locking freezes everything dated inside this year for every role, including Super Admin, until a Super Admin explicitly reopens it via Unlock. Continue?" **Revised 2026-08-05:** unlocking IS now offered, Super Admin only, via its own confirmation pop-up stating the real consequence: "Reopening this Financial Year makes every record dated inside it editable again, everywhere, for every role — exactly as if it had never been locked. This is a Super Admin override of a rule everyone else still cannot touch. Continue?" The original "not offered anywhere, as a safeguard" assumption was an explicit product decision, not a technical default, and was reversed the same way.

#### Status & Deletion Rule

Financial Year does not use the Active/Inactive pattern the other sub-masters use — it already has its own two-state lifecycle, Open and Locked, which serves the same protective purpose. A Financial Year with no records referencing it anywhere in the CMS may be deleted outright (useful if one was added by mistake). Once any record in any module references it, deletion is disabled and Locking/Unlocking become the only further actions available. Locking applies to everyone: after a year is locked, no user — not even Super Admin — can add, edit, or delete any record dated within it, unless and until a Super Admin reopens the year via Unlock (revised 2026-08-05 — locking is no longer irreversible, Super Admin can reverse it, no other role can).

#### Role Access

Super Admin only — full CRUD. Once a year is **Locked**, it becomes read-only for everyone, Super Admin included, until a Super Admin unlocks it — Unlock is its own RBAC action, Super Admin only, same as Lock. Not shown to any other role. See the Access Model in Section 3.0.

#### Used By

Customer, Opportunity, Project, Invoice, Purchase Bill, Ticket, and Asset Management all insert the Financial Year Label into their auto-generated codes (see Section 3.6e). Leave & Payroll tracks leave balances and payroll runs per financial year. Expense and Purchase Bill use it as a year filter.

---

### 3.2 Taxes

#### Purpose

**The single place where every tax this company applies is defined — by a person, at run time, not by this document and not by a developer.**

This sub-master used to be a list of GST rates only, and four other sub-masters sat elsewhere in this module holding payroll statutory items with fixed, individually-named fields. That whole arrangement is replaced by this one. The reason is direct: **it has not been established which taxes and statutory deductions actually apply to this company.** Any specification that names them in advance is guessing, and a guess baked into field names is expensive to undo later.

So this sub-master models the *shape* of a tax rather than any particular tax. Super Admin (or Accountant, if given the right) adds each tax head as a record: what it's called, where it applies, what it's calculated on, how it's calculated, who bears it, what limits apply, and when it takes effect. A billing tax, a payroll deduction taken from the employee, an employer-borne contribution, an income tax computed across the year, and a deduction an employee declares to reduce their taxable income are all the same kind of record here, distinguished only by the **Applies To** field they're given.

**What this deliberately does not do:** it names no tax, proposes no rate, and assumes no country's tax structure. There is no PF field, no ESI field, no GST field, no regime dropdown, no 80C cap, no rebate threshold. If any of those apply to this company, someone who knows that adds them as records. If they don't, nothing about the system needs changing — the list simply doesn't contain them. The system is not aware that any specific tax exists.

#### Fields Table — a. Tax Head (the main record)

> **Deliberately reduced on 2026-07-30, from 35 fields to 13.** An earlier revision of this table carried a full statutory-engine's worth of fields — Calculated On (Base), Borne By with a two-way share split, Minimum Base, Maximum Base / Ceiling, Cut-Off Base, Maximum Amount per Period, Period Basis, Rounding, Applicable States / Locations, Applicable Employment Types, Per-Employee Opt-Out, Reduces Taxable Income, Include in Cost to Company, Show on Payslip, Requires Proof, Company Registration Number, Requires an Employee Identifier + its Label, and Ledger / Accounting Code. **All of those are removed from scope, on explicit instruction, because the form was too complex to be usable.** Adding a GST rate should not require reading twenty-odd conditional fields.
>
> **What this costs, stated plainly so it isn't discovered later:** a tax needing a wage ceiling, a cut-off threshold, a location restriction, an employment-type restriction, per-employee opt-out, or its own employee identifier number **can no longer be configured** without bringing fields back into this table first. A banded tax is still expressible — Slab remains a Tax Type and the Slab Bands child table (part b) survives — and an employee/company split is still expressible through the Split Components child table (part c), which is where that concern moved. If a real statutory item turns up that needs one of the removed fields, this table is the place to re-add it, not the code.

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Tax Name | Text | Y | Whatever the person adding it calls this tax, e.g. "GST 18% — IGST". Appears in the Invoice dropdown. Must be unique within a Scope |
| Tax Type | Dropdown (GST — IGST / GST — CGST + SGST / Percentage / Fixed Amount / Slab / Declaration Cap) | Y | The one structural choice that decides which rate fields appear. See the type table below |
| Scope | Dropdown | Y | Where the head attaches. Options and their meanings are in the table below |
| Applies From | Date | Y | The first date a document or payroll run uses this head. Records dated before this never see it |
| Applies Until | Date | N | Blank means "still in force." Setting it retires the head from that date forward without touching any record already calculated under it |
| Rate (%) | Number | Conditional — required if Tax Type is GST — IGST or Percentage | A single rate, e.g. 18 for 18% |
| CGST Rate (%) | Number | Conditional — required if Tax Type is GST — CGST + SGST | Half the total, e.g. 9 |
| SGST Rate (%) | Number | Conditional — required if Tax Type is GST — CGST + SGST | Must equal CGST Rate |
| Fixed Amount (₹) | Number | Conditional — required if Tax Type is Fixed Amount | A flat charge regardless of the document value |
| Declaration Cap (₹) | Number | Conditional — required if Tax Type is Declaration Cap | The maximum an employee may declare under this head per year |
| Print Label | Text | N | Short label printed on the invoice or payslip line, e.g. "IGST @ 18%". Defaults to Tax Name if left blank |
| **Creates an Onward Liability** | Toggle (Yes/No) | Y | **Added 2026-07-31. Available on EVERY scope, not only the withholding one.** Yes means the amount this head calculates is money the company holds on somebody else's behalf and must pay to a third party — not revenue, not an expense, and not the counterparty's to receive. It is the single switch that puts a head into the Tax & Compliance register (Module 15), and it is what lets a **payroll** deduction join the same register as a supplier withholding without duplicating any machinery. Defaults to **No**. If no head anywhere has this on, the Tax & Compliance module does not appear at all |
| Remitted To (Authority) | Text | N | Revealed when Creates an Onward Liability = Yes. Free text — whoever this is actually paid to. Groups the register and prints on the remittance record. A label, never arithmetic, so it stays editable after the head's figures lock |
| Remittance Period | Dropdown (Per Document / Monthly / Quarterly / Half-Yearly / Annual) | Conditional — required when Creates an Onward Liability = Yes | How often the accumulated amount is deposited. *Per Document* means each source document is its own obligation with its own due date, rather than being pooled into a period |
| Period Aligns To | Dropdown (Calendar / Financial Year / Pay Cycle) | Conditional — required when Creates an Onward Liability = Yes | *Calendar* — calendar months and quarters. *Financial Year* — counted from the Financial Year start (Section 3.1). *Pay Cycle* — the payroll cycle from Work Week & Hours (Section 3.20c), which for a payroll head is the only alignment that makes the register agree with the payslips that produced it |
| Deposit Due — Days After Period End | Number (days) | Conditional — required when Creates an Onward Liability = Yes | Days added to the period's last day to get the deposit deadline. Expressed as days rather than a fixed calendar day so it survives short months without a second rule. Drives the Due Date, the Due Soon badge and the Overdue state |
| Liability Arises On | Dropdown (Source Document Date / Payment Date) | Conditional — asked when the head can be withheld on payments made | Which date decides the period an amount belongs to. **This must match how the authority actually keys the period** — set it wrong and every total is right in aggregate but filed against the wrong month. Locks once the first remittance is recorded under this head |
| Authority Reference Label | Text | N | What this authority calls the reference on its receipt — "Challan Number", "Acknowledgement Number", whatever it issues. Labels the field on Record Remittance instead of the specification naming it. **This is why no jurisdiction's paperwork vocabulary is hardcoded anywhere in Tax & Compliance** |
| Withholding Direction | Multi-select (On Payments Made / On Payments Received) | Conditional — required when Scope is *Withholding / Deduction at Source* | At least one required. *On Payments Made* puts the head in Purchase Bill's dropdown (Module 13, Section 2.2); *On Payments Received* puts it in Invoice → Record Payment (Module 11, Section 2.4). Both is common and is the reason this is a direction on one head rather than two separate scopes |
| Default Calculated On | Dropdown (Subtotal / Total) | Conditional — Withholding scope only | Defaults to **Subtotal**. Pre-selects the Calculated On dropdown wherever this head is applied. The two bases produce materially different figures |
| Certificate Expected from Counterparty | Toggle (Yes/No) | Conditional — shown when Direction includes *On Payments Received* | Whether the customer is expected to issue a certificate evidencing what they withheld. When Yes, an uncertified receipt joins the chase queue; when No, its status reads *Not Expected* and no chase is raised |
| Notes | Text area | N | Free notes — which authority levies it, any registration number, internal reference. Nothing is validated; it exists so the next person to open this screen understands what a predecessor set up. **This field now absorbs the registration-number and accounting-code details that used to have dedicated fields** |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

**On these fields and the cost of adding them.** The 2026-07-30 trim took this record from 35 fields to 13 because the form had become unusable, and its removal note stated where re-additions belong: *"If a real statutory item turns up that needs one of the removed fields, this table is the place to re-add it, not the code."* This is that case.

**Only one of the fields above is unconditionally visible — the *Creates an Onward Liability* toggle.** Everything else is revealed by it, or by the withholding scope. Someone adding a GST rate sees the same short form the trim produced, plus one toggle they leave off. Only a person setting up a remittance obligation — who is by definition doing something that needs a due date and a period — sees the rest.

The alternative was worse in a specific way: without these, a compliance register cannot compute a due date, cannot decide which period an amount belongs to, cannot tell a payroll obligation from a supplier one, and has to name a jurisdiction's paperwork in code.

#### The Scope Options

Scope is the field that decides what a head *is*. It is a fixed list — not because the taxes are known, but because the places a tax can attach to are: this CMS has documents, payslips, and declarations, and nothing else for a tax to hook onto.

| Scope | What It Means | Where It Surfaces |
|---|---|---|
| Sales / Billing | Charged to a customer on what the company bills out | Invoice line items and totals (Module 11), Credit Notes |
| Purchase | Recorded on what the company buys in | Purchase Bill (Module 13), Expense (Module 12) |
| Sales / Billing & Purchase | One head serving both directions, rather than maintaining two near-identical records | Both of the above |
| Payroll — Employee Deduction | Taken out of an employee's pay, reducing what they receive | Payslip deductions (Module 6), Salary Structure (Module 2, Section 2.2) |
| Payroll — Employer Contribution | Paid by the company on top of pay; never reduces the employee's net | Annual CTC (Module 2, Section 2.2), Payroll's employer-side audit (Module 6, Section 5) |
| Payroll — Income Tax | Computed across the whole year on taxable income, then spread over remaining pay periods | Payroll's per-employee tax calculation (Module 6, Section 2.1) |
| Employee Declaration / Exemption | Not charged at all — an amount the employee declares, which reduces the base an income-tax head computes on | My Tax Declarations (Module 2, Section 2.15) |
| Withholding / Deduction at Source | Not charged on top of anything — held back out of a payment and owed onward to an authority rather than to the counterparty. Direction (paid out / received in) is a field on the head, not a separate scope | Purchase Bill (Module 13, Section 2.2); Invoice → Record Payment (Module 11, Section 2.4); Tax & Compliance (Module 15) |

**History of this list, because it has moved twice and the reasoning matters.**

**2026-07-30 — reduced from eight scopes to seven.** *Withholding / Deduction at Source on Payments* and *Other / Reporting Only* were removed; *Sales / Billing & Purchase* was added, since maintaining two mirror-image records for the same rate was the more common annoyance in practice. The removal was part of a wider field trim done because the Add Tax form had become unusable — **no reason was given for deleting the withholding scope specifically.** The note closed by saying: *"If a genuinely different attachment point turns up during grooming it belongs here as an eighth option — but a new tax never does, since that is a record, not an option."*

**2026-07-31 — withholding restored as ONE eighth scope, and a separate gate added that any scope can use.** The company confirmed during grooming that it withholds from supplier payments, that its customers withhold from what they pay it, **and that it deducts tax from employee salaries** — all three remitted onward to an authority. That is precisely the "genuinely different attachment point" the 2026-07-30 note anticipated: money deducted *from a payment* and owed to a third party who is neither the customer, the supplier, nor the employee.

**One scope with a Direction field, not three scopes.** An earlier revision of this section briefly created three (*On Payments Made* / *On Receipts Collected* / *On Payments & Receipts*), mirroring the *Sales / Billing & Purchase* triplet. That was replaced the same day: the same statutory provision very often governs both directions, and the triplet forced either two near-identical records or a third scope that exists only to say "both". Direction is a property of the head, not a different place it attaches — so it is a field on the head.

**The gate is separate from the scope, and this is the important part.** A new field, **Creates an Onward Liability**, is available on **every** scope — not only the withholding one. It is what puts a head into the remittance register. This matters because **payroll deductions are the same pattern under a different name**: tax deducted from a salary is money held on the employee's behalf and owed to an authority, exactly like tax held back from a supplier. Rather than duplicating the withholding machinery inside Payroll, a payroll head simply turns this toggle on and joins the same register.

So three sources feed one register, with no scope inventing itself for each:

| Source | Scope used | Counterparty the money came from |
|---|---|---|
| Purchase Bill (Module 13, Section 2.2) | Withholding / Deduction at Source, Direction includes *On Payments Made* | Vendor |
| Invoice → Record Payment (Module 11, Section 2.4) | Withholding / Deduction at Source, Direction includes *On Payments Received* | Customer |
| Payroll run (Module 6, Section 2.1) | Payroll — Employee Deduction / Payroll — Income Tax, with **Creates an Onward Liability = Yes** | Employee |

**The two directions are never netted against each other.** What the company holds and owes onward is a **liability**; what a customer held back from it is an **asset** it can claim. A single "net tax position" figure would be wrong in both directions. Tax & Compliance (Module 15) shows them as separate registers for that reason.

**The whole module has an off switch.** If no head anywhere has *Creates an Onward Liability = Yes*, the Tax & Compliance sidebar tab does not exist — the same convention Tax Schemes already uses (*"If no schemes are created, the whole concept disappears from the interface"*). A company that holds nobody's money pays zero screens and zero training for this.

**A consequence worth stating, since it contradicts an earlier approved decision.** The build appendix carries an item (A019) instructing that exactly seven scopes be built and that withholding specifically must *not* be. That decision was taken before anyone had established whether this company withholds; it has now, and the answer is yes in all three directions. A019 is superseded on the strength of its own escape clause. The rule it was protecting — **a new tax is never an option, only a record** — is untouched: no rate, no threshold and no named statutory item appears here.

#### The Tax Types

| Tax Type | What Gets Entered | Typical Use |
|---|---|---|
| GST — IGST | A single Rate (%) | Interstate sales — one combined rate on one line |
| GST — CGST + SGST | CGST Rate (%) and SGST Rate (%), which must match | Intrastate sales — prints as two lines, half each |
| Percentage | A single Rate (%) | Any flat-rate tax on a document or a pay component |
| Fixed Amount | A single Fixed Amount (₹) | A flat periodic levy, regardless of value |
| Slab | A band table (part b below), each band carrying a rate or a rupee figure | A tax that rises in steps with income |
| Declaration Cap | A Declaration Cap (₹) only — the employee enters the actual figure themselves | Declaration / exemption scopes |

The **GST — IGST** and **GST — CGST + SGST** types exist as their own entries rather than being expressed through a generic Percentage plus a split, because the interstate/intrastate choice is the single most frequent decision made on this screen and it should not require understanding component splits to get right.

For **Slab**, one more choice: **Slab Application** — *Progressive* (each band's rate applies only to the portion of the base inside that band, and the total is the sum across bands) or *Flat by Band* (the single band the base lands in determines one rate applied to the entire base). Both patterns exist in real tax systems and produce very different numbers, so this is asked rather than assumed.

#### Fields Table — b. Slab Bands (child rows, only when Method is a Slab type)

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Band From (₹) | Number | Y | Lower bound, inclusive |
| Band To (₹) | Number | N | Upper bound, inclusive. Blank means "and above" — exactly one band may leave this blank, and it must be the last |
| Rate (%) or Amount (₹) | Number | Y | Which of the two is asked for follows the head's Method |
| Band Label | Text | N | Optional display name for this band on reports |

Validation: bands may not overlap, and may not leave a gap between one band's To and the next band's From. The screen shows a warning inline as bands are entered rather than only on save, since a gap is easy to create and hard to spot later.

#### Fields Table — c. Split Components (child rows, optional on any head)

Some taxes are a single headline rate that must be reported as two or more separately-named parts, each going to a different authority. Rather than naming those parts in the specification, a head can carry any number of component rows:

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Component Name | Text | Y | Whatever this portion is called on a document and in a return |
| Share of Total (%) | Number | Y | The portion of the head's calculated amount this component represents |
| Applies When | Dropdown (Always / Only when a condition is met) | Y | If a head splits one way in some situations and stays whole in others, two heads or a condition here express it — see the note below |
| Condition | Text / rule builder | Conditional — required if Applies When is conditional | Assumption: modeled as a simple comparison (e.g. counterparty location matches company location, or does not) rather than a general expression language. Flagged as a build-time design decision — a full rule builder is a materially larger undertaking and probably unnecessary if only a handful of heads ever need one |

Validation: component shares must total 100% of the head's calculated amount. A head with no component rows is simply a single undivided tax, which is the common case.

**What Split Components are for, and what they are not — corrected 2026-07-31.** An earlier revision of this paragraph claimed Split Components had *replaced* the named CGST/SGST/IGST fields, and that the specification no longer needed to know those words. **That was never carried out, and the claim contradicted this section's own Fields Table**, which has always defined `GST — IGST` and `GST — CGST + SGST` as first-class Tax Types with their own rate fields. The contradiction is resolved in favour of the Fields Table, on explicit instruction:

- **GST stays built in.** `GST — IGST` and `GST — CGST + SGST` remain Tax Types. Setting up 18% intrastate GST means choosing `GST — CGST + SGST` and entering 9 and 9 — it does not require understanding component splits. The reasoning in the Tax Type table above stands: interstate-vs-intrastate is the most frequent decision made on this screen, and the Invoice and HSN/SAC flows both depend on the distinction being explicit.
- **Split Components remain, for everything else.** They are the general mechanism for any *other* tax that carries one headline rate but must be reported as two or more separately-named parts going to different authorities — in this jurisdiction or another. They are optional on any head, and they are not how GST is configured.

The portability concern behind the original claim is real but narrower than it was stated: what must never be hardcoded is **which statutory items this company is liable for** — the reason Income Tax Slabs, PF & ESI Rates, Professional Tax Slabs and Old Regime Deduction Limits were deleted as sub-masters. Two structural GST types on a dropdown are not that. No *rate*, no *threshold*, and no *liability* is assumed anywhere by naming them.

#### Fields Table — d. Tax Schemes (a small list inside this sub-master)

Some tax systems let a person choose between alternative sets of rules, where picking one set changes both the rates that apply and which declared deductions are allowed. Whether that is true here is unknown, so it is configurable rather than assumed:

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Scheme Name | Text | Y | Whatever the alternatives are called |
| Description | Text area | N | What choosing this scheme means for the employee, shown to them at the point they choose |
| Is Default | Toggle (Yes/No) | Y | Exactly one scheme may be the default. Employees who never make a choice are assessed under it |
| Choice Window | Dropdown (Once per financial year / Changeable any time / Fixed at joining) | Y | When an employee is allowed to switch. Assumption: proposed options — the real constraint depends on rules nobody has stated yet, so it's a setting |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

**If no schemes are created, the whole concept disappears from the interface** — the Tax Scheme field on a tax head is hidden, and My Tax Declarations (Employee module, Section 2.15) shows no scheme choice at all. This matters: a company with no alternative-scheme system should never see a dropdown asking employees to pick one. The old design hardcoded exactly two schemes and named them; this one shows zero, two, or five depending on what was entered.

#### Fields Table — e. Relief Rules (child rows, optional, income-tax scopes only)

A tax that is calculated and then reduced or waived below a threshold is common enough to need modeling, and specific enough that naming any particular relief would repeat the mistake this revision exists to fix:

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Relief Name | Text | Y | Whatever this relief is called |
| Applies If Base Is At Or Below (₹) | Number | Y | The threshold under which this relief triggers |
| Relief Type | Dropdown (Reduce tax by a fixed amount / Reduce tax to zero / Cap tax at an amount) | Y | — |
| Relief Amount (₹) | Number | Conditional — required unless Relief Type = Reduce tax to zero | The relief applied is the lesser of this figure and the tax actually computed, so it can never turn into a refund |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Implementation Status — Taxes (reconciled 2026-08-03)

**BUILT** (`app/api/v1/masters_taxes.py`, engine in `app/services/tax_engine.py`, models in `app/models/masters.py`, schema + triggers in migration `0002_masters.py`):

- **Tax Head CRUD with all 8 scopes** (DB CHECK constraint: `SALES_BILLING`, `PURCHASE`, `SALES_AND_PURCHASE`, `PAYROLL_EMPLOYEE_DEDUCTION`, `PAYROLL_EMPLOYER_CONTRIBUTION`, `PAYROLL_INCOME_TAX`, `EMPLOYEE_DECLARATION`, `WITHHOLDING_AT_SOURCE`) and all 6 Tax Types (`GST_IGST`, `GST_CGST_SGST`, `PERCENTAGE`, `FIXED_AMOUNT`, `SLAB`, `DECLARATION_CAP`), with conditional-rate CHECK constraints per type. A head also carries a **Short Code** field (in code though absent from the Fields Table above — add it mentally to the table; it appears in the list, the export, and the label-lock bucket) and a **`behaviour` JSON column** — a schemaless extension bag for future per-head behaviour without a migration.
- **All child tables:** Slab Bands, Split Components (including `applies_when` + a `condition_rule` JSON — the "simple comparison, not a rule builder" option the table above flagged is exactly what was built), Relief Rules (restricted to `PAYROLL_INCOME_TAX` scope by both an API check and a DB trigger), and Withholding Directions (at least one required when scope is Withholding, enforced).
- **All compliance fields** (Creates an Onward Liability, Remitted To, Remittance Period, Period Aligns To, Deposit Due days, Liability Arises On, Authority Reference Label, Default Calculated On, Certificate Expected) — feeding Module 15 exactly as described.
- **The field-level lock, in three buckets** — stricter and finer than the prose below: (1) **label fields always editable** regardless of any lock: Tax Name, Short Code, **Applies Until** (deliberately, so the mandated rate-change sequence — retire the old head, Duplicate — is executable on a locked head), Print Label, Notes, Remitted To, Authority Reference Label; (2) **arithmetic fields** (rates, amounts, caps, slab application) reject with 409 once `is_arithmetic_locked` is set by first use in a calculation; (3) **compliance fields** lock independently once the first **Remittance** exists against the head (Module 15 §7.9) — three locks, three different trigger events. Backed by a DB trigger as defence-in-depth.
- **`POST /{id}/duplicate`** — carries the full field set and all child rows, and stamps a `supersedes_tax_head_id` version-chain pointer the plain create does not.
- **`POST /calculate`** — the "live worked example": give it a head and a base amount, get the computed amount with slab-by-slab breakdown, split-component amounts, and reliefs applied. Read-only permission only.
- **Deactivate** (SA-only) and **DELETE**, which 409s once `usage_count > 0` — "never hard-deleted once used," enforced.
- **PDF/Excel export** of the head list.

**Corrections to the prose in this section, from the code:**

- **There is no Borne By field, no Description field, and no Ledger Code field.** They were removed in the 2026-07-30 trim; the lock-rule paragraph below still names "Description, and Ledger Code" as staying editable — read that as **Notes** (which absorbed both) plus the label bucket listed above.
- **Slab bands: the open-ended band is mandatory, not optional.** The validation requires *exactly one* band with a blank Band To, it must be the last, and bands must be exactly contiguous (one band's To equals the next band's From — both bounds inclusive as specified). A fully-bounded band table is rejected.
- **A locked Financial Year does not freeze tax heads, because heads are not FY-scoped.** A head carries Applies From / Applies Until dates, not a Financial Year field; the "locked FY freezes any head scoped to it" sentence below has nothing to attach to and should be read as inapplicable to the built shape.

**DEFERRED:**

- **Tax Schemes admin CRUD (part d).** The `tax_schemes` table and model exist, and the employee-side election flow is fully built (Employee module: per-FY scheme elections with supersede-on-change) — but **there is no Masters endpoint to create or edit a scheme**, and none are seeded. Until an admin CRUD is added, schemes cannot enter the system through the API, which incidentally satisfies the "if no schemes exist the whole concept disappears" rule by default.
- **List filters** (Scope, Status, Financial Year, Method, "currently in force", search) — the list endpoint currently returns all heads with no query filters; export works on the full set. Deferred with the extended-filters round.
- **The Where Used view** — only `usage_count` and `first_used_at` exist per head; no per-module reference map endpoint.

#### Screen Design

**Screen type:** A tab inside the Masters settings page — the largest one, since it now carries what used to be five separate tabs.

**List view** groups by Applies To scope, with a collapsible group per scope, so billing taxes and payroll deductions never sit jumbled in one flat list. Each row shows: Tax Name, Short Code, Method, Rate or Amount (or "Slab" with the band count), Applies From, Applies Until, Status. Filters: Scope, Status, Calculation Method, Tax Scheme, and "currently in force" as a quick toggle — **all deferred in the current build; the list endpoint takes no query filters yet** (see Implementation Status above). Search covers Name and Short Code. Export to PDF/Excel is built. (Borne By, Applicable Location and Financial Year were removed as fields in the 2026-07-30 trim and are no longer columns or filters.)

**"+ Add Tax"** opens a full-page form rather than a pop-up — there are too many fields for a modal, and the fields shown change as choices are made. The form is progressive: **Applies To is chosen first**, and everything after it adapts. Choosing a billing scope hides the payroll-only fields (Employment Types, Tax Scheme, Per-Employee Opt-Out, Include in CTC) entirely rather than greying them out; choosing a payroll scope hides the document-only ones. Choosing a Slab method reveals the band table; choosing Percentage hides it. Nothing irrelevant to the chosen scope is ever visible — the form is long only when the tax genuinely is.

**A live worked example sits beside the form as it's filled in.** Enter a test base figure and the screen shows what this head would deduct or charge on it, including slab-by-slab working, split components, ceilings, and relief. This is deliberately prominent: the person entering a tax is being asked to describe a calculation in the abstract, and the fastest way to catch a wrong ceiling, an inverted slab, or a mis-set Borne By is to see one number come out wrong before it reaches a payslip.

**"Duplicate" on each row**, which opens the Add form pre-filled from an existing head. New rates for a new year are usually the previous year's structure with different figures, and re-entering a twelve-band table by hand invites errors.

**Empty state** — and this is a real state, not a formality, because on day one nothing exists here: "No taxes configured yet. Add the taxes, statutory deductions, and contributions that apply to this company. Until at least one is added, invoices and payslips are calculated without any tax." Payroll and Invoice both handle an empty Taxes list without breaking — they simply produce documents with no tax lines, rather than erroring or falling back to a built-in default. There is no built-in default anywhere in this CMS.

#### Status & Deletion Rule

**Never hard-deleted once used** on any Invoice, Expense, Purchase Bill, payslip, or declaration — Active/Inactive toggle only, so historical records keep resolving to the head that produced them.

**Once a head has been used in any calculation, its numbers lock** — Rate, Amount, slab bands, split component shares, caps, and Slab Application all become read-only, for everyone including Super Admin. Tax Name, Short Code, Print Label, Notes, Applies Until, Remitted To and Authority Reference Label stay editable, since those are labels (or the retirement date the Duplicate flow depends on) rather than arithmetic. (As built: the label/arithmetic/compliance three-bucket lock in the Implementation Status above; Description and Ledger Code no longer exist as fields — Notes absorbed them.) This is a data-integrity lock, deliberately stricter than any role permission: an issued invoice or a processed payslip must always be reproducible from the configuration that produced it.

**When a rate genuinely changes, the correct action is never to edit the existing head.** Set the current head's Applies Until date to the day before the change, then add a new head (usually via Duplicate) with the new figures and an Applies From date. Documents already issued keep resolving to the old head; everything from the new date forward uses the new one. The screen enforces this rather than suggesting it — editing a locked figure is not offered as an option at all, and the tooltip on the disabled field explains the Duplicate route.

**A locked Financial Year (Section 3.1) freezes any head scoped to it**, consistent with the rule that a locked year freezes everything dated inside it.

#### Role Access

Super Admin — full CRUD. Accountant — View by default, upgradable to Manage (add and edit, never delete or deactivate) via the RBAC flag described in Section 3.0. Not shown to any other role. Even with the flag on, neither role can change a figure on a head already used in a calculation — see the Status & Deletion Rule above.

#### Used By

Effectively every module that touches money:

- **Invoice** (Module 11) — line and total taxes, from Sales/Billing scope heads
- **Expense** (Module 12) and **Purchase Bill** (Module 13) — Purchase and Withholding scope heads
- **Employee** (Module 2) — Salary Structure statutory lines, per-employee applicability toggles, and My Tax Declarations
- **Payroll** (Module 6) — every deduction, every employer contribution, and the income tax calculation
- **Company Profile** (Section 3.6a) — the default billing tax selection
- **HSN/SAC Code** (Section 3.11) — each code links to a Sales/Billing scope head

#### The Open Question This Sub-Master Deliberately Leaves Open

Which taxes actually apply to this company is **not answered here, and is not a gap in this document** — it is a data-entry task for whoever holds that knowledge, to be done once at implementation and revisited whenever the law or the company's registrations change. That is the entire point of the redesign. Grooming this section should be about whether the *shape* above can express any tax that turns up, not about which taxes to list.

The one thing worth confirming before build: whether **Applies To** genuinely covers every attachment point (the eight scopes above), and whether the **Condition** field on split components needs to be a real rule builder or can stay a simple comparison. Those two are the places where an unforeseen tax would most likely fail to fit.

---

### 3.3 Expense Types

#### Purpose

A controlled list of categories for company spending, so the Expense module can group and report it consistently. It covers two genuinely different kinds of spend, and the **Claim Type** field below is what separates them.

**Reimbursable** — an employee paid out of their own pocket and is owed the money back: travel, meals, stationery, a training course. Every role can raise one, and it ends in a payout to that person.

**Company-Paid** — the company itself was billed and simply settles it: internet / Wi-Fi, electricity, office rent, telephone, cloud hosting. Nobody is owed anything, so these never enter the reimbursement queue; they are paid straight from a company bank account, and only Super Admin and Accountant can raise them.

**Why this lives on the type and not on each expense.** Whether the Wi-Fi bill is a personal claim is not a per-entry judgement — it is a property of *what Wi-Fi billing is*. Putting the choice on every expense entry invites the wrong answer and offers no way to notice one; putting it on the type means an employee never sees a Company-Paid category in their dropdown at all, and the routing follows automatically. It also means adding a new kind of running bill is one Masters row, not a code change.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Expense Type Name | Text | Y | e.g. Travel, Snacks, Internet / Wi-Fi, Office Rent; must be unique |
| Short Code | Text | N | e.g. TRV, NET. Used in compact views and on the bank-statement export |
| Claim Type | Dropdown (Reimbursable / Company-Paid) | Y | Decides who may raise this expense and what happens at the end — see above. Reimbursable is open to every role and ends in a payout to the claimant; Company-Paid is Super Admin / Accountant only and is settled from a company bank account with no reimbursement step |
| Recurring | Toggle (Yes/No) | N | For standing monthly bills — Wi-Fi, rent, hosting. Changes no approval behaviour; it lets Accounts filter expected bills apart from one-off spend, and makes a month where an expected bill never arrived visible as an absence |
| Default Bank Account | Dropdown (from Company Profile, Section 3.7 — Active accounts) | N | Optional. Pre-selects the account on Add Expense for this type, for the common case where a given bill always leaves the same account. Still editable on the expense itself |
| Description | Text Area | N | Optional clarifying note |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Name, Code, Claim Type, Recurring, Status, Used, Actions. Filters on Status, Claim Type, Recurring and Used. "+ Add Expense Type" opens a pop-up with the fields above. Confirmation pop-up before deactivating a type currently used on any Expense record (this action is available to Super Admin only).

**Changing Claim Type on a type already in use is not a silent edit.** It re-routes every future expense of that type, and would strand existing rows on the wrong screen. It warns explicitly, names how many records already use the type, and leaves those records where they are — the change applies from that point forward, never retroactively.

> **Implementation status — BUILT** via the generic lookup factory (§3 preamble) with all fields above, plus three server-computed read-only fields the API exposes for exactly the paragraph above: `previous_claim_type` and `claim_type_changed_at` (stamped automatically by a before-write hook whenever Claim Type changes on an existing row — the audit trail behind the warning) and `usage_count`. The warning dialog itself, and the Claim Type / Recurring / Used list filters, are frontend/deferred — the API carries Search + Status only.

#### Status & Deletion Rule

Never hard-deleted once used on any Expense record. Active/Inactive toggle only. Deactivation is Super Admin only, per Section 3.0.

#### Role Access

Super Admin: full CRUD. Manager: add and edit only — **delete/deactivate stays with Super Admin**. Not shown to HR, Accountant, or Employee. See Section 3.0.

#### Used By

Expense module — the category dropdown on every expense entry, expense summary-by-type reporting, and, through Claim Type, the routing that decides whether an expense reaches the reimbursement queue (My Expenses / Expense Approvals, Module 12 Sections 2.1–2.2) or Company Expenses (Module 12, Section 2.4).

---

### 3.4 Leave Types

#### Purpose

A controlled list of leave categories (Casual, Work From Home, Optional, and similar) so leave applications, balances, and payroll deductions all work from the same definitions.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Leave Type Name | Text | Y | e.g. Casual Leave, Work From Home, Optional Leave, Earned Leave; must be unique |
| Short Code | Text | N | e.g. "CL"; used in compact views like a leave calendar |
| Paid or Unpaid | Dropdown (Paid / Unpaid) | Y | Drives whether Payroll deducts pay for this leave type |
| Default Annual Quota (Days) | Number | N | Days granted per employee per financial year; 0 is allowed for types like WFH that don't consume a quota |
| Carry Forward Allowed | Toggle (Yes/No) | Y | Defaults to No |
| Max Carry Forward Days | Number | Conditional — required if Carry Forward Allowed = Yes | Must be less than or equal to the Default Annual Quota |
| Is Quota Tracked | Toggle (Yes/No) | Y | **Added in the build** (defaults to Yes). No: this type never consumes a balance at all — the cleaner expression of "types like WFH that don't consume a quota" than a 0 quota. The Leave module reads it when deciding whether an application draws down a balance |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

> **Implementation status — BUILT** via the generic lookup factory, all fields above including the build-added `is_quota_tracked`. The "Max Carry Forward ≤ Default Quota" comparison is not enforced at the API layer.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Name, Short Code, Paid/Unpaid, Default Quota, Status. The Add/Edit form is grouped into two sections: "Basic Info" (Name, Short Code, Paid/Unpaid) and "Quota & Carry Forward" (Default Quota, Carry Forward toggle, Max Carry Forward Days). Confirmation pop-up before deactivating a type that any employee currently has a balance or a pending request under (this action is available to Super Admin only).

#### Status & Deletion Rule

Never hard-deleted once used in any Leave application or balance. Active/Inactive toggle only. Deactivation is Super Admin only, per Section 3.0.

#### Role Access

Super Admin: full CRUD. Manager and HR: add and edit only — **delete/deactivate stays with Super Admin**. Not shown to Accountant or Employee. See Section 3.0.

#### Used By

Leave & Payroll — the leave-application dropdown, balance calculations, and unpaid-leave payroll deductions all read from this list.

---

### 3.5 Holidays

#### Purpose

The company holiday calendar. Payroll and Leave both need to know which days are non-working days, and which of those are compulsory company-wide days off versus optional ones an employee may choose to take.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Holiday Name | Text | Y | e.g. "Independence Day" |
| Date | Date | Y | dd-mm-yyyy; must fall inside the linked Financial Year's date range |
| Financial Year | Dropdown (from Section 3.1) | Y | Ties the holiday to a specific year, for reporting and for scoping bulk imports |
| Type | Dropdown (Mandatory / Optional) | Y | "Mandatory" = compulsory company-wide day off; "Optional" = employee may choose to take it |
| Recurring Every Year | Toggle (Yes/No) | N | Assumption: convenience flag only, for the user's own reference — it does not automatically create next year's entry in this version |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Holiday Name, Date, Type (badge), Financial Year, Status. Filter by Financial Year and Type. Default sort is Date, earliest first.

Two ways to add holidays: **"+ Add Holiday"** (a single-entry pop-up with the fields above) and **"Import CSV"** (a bulk-upload pop-up expecting columns Holiday Name, Date, Type). Before an import is confirmed, a summary pop-up shows how many holidays will be added and flags any duplicate dates found against the existing list. A confirmation pop-up is also shown before deleting or deactivating a past holiday (that action is available to Super Admin only).

> **Implementation status — BUILT** via the generic lookup factory, plus a dedicated bulk **`POST /masters/holidays/import`** endpoint (its own RBAC `import` action, granted to Super Admin and Manager). The endpoint accepts the parsed rows and performs the import; CSV parsing and the pre-confirmation duplicate summary are frontend concerns. Two rules the database enforces directly: a DB trigger rejects any holiday date outside the linked Financial Year's range (surfaced as a clean 409), and the partial-deletion rule below is backed by a `used_in_processed_payroll` flag on each row. The Financial Year and Type list filters are deferred (Search + Status only, per §3.0's status note).

#### Status & Deletion Rule

Holidays are a partial exception to the standard rule. A Holiday that has never been used in a completed Payroll run can be deleted outright by Super Admin — it is simple reference data with nothing pointing to it yet. Once a Payroll run has been calculated for a period containing that holiday's date, it switches to the standard rule: Active/Inactive only, no hard delete. In both cases, delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin: full CRUD (add, edit, bulk import, delete/deactivate). Manager: add, edit, and bulk import only — **delete/deactivate stays with Super Admin**. Not shown to HR, Accountant, or Employee. See Section 3.0.

#### Used By

Leave & Payroll — working-day and payable-day calculations exclude Mandatory holidays; an employee taking an Optional holiday draws from their leave balance.

---

### 3.6 Company Profile

#### Purpose

Company Profile stores Meshrd's own official company information — the details that appear on every invoice, letter, and generated document — plus the background settings (default tax, numbering rules) other modules quietly rely on. Unlike every other sub-master in this document, Company Profile is not a list that grows over time. There is exactly one Company Profile for the whole CMS, created during initial setup.

#### Fields Table — a. General Info

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Company Legal Name | Text | Y | Assumption: added even though not explicitly listed in the original notes, since it's needed on every generated document |
| CIN | Text | Y | Corporate Identification Number |
| TAN | Text | N | Tax Deduction Account Number. **Downgraded from mandatory in this revision** — see the note below the table |
| GSTIN | Text | N | Meshrd's own GSTIN; format-checked by the GST Validator utility. **Downgraded from mandatory in this revision** — see the note below the table |
| PAN | Text | Y | Assumption: added alongside CIN/TAN/GSTIN for completeness, since a company PAN is a standard Indian tax requirement, though it wasn't explicitly listed in the original notes |
| Company Type | Dropdown | Y | e.g. One Person Company (OPC), Private Limited, LLP, Partnership, Proprietorship |
| Year of Incorporation | Number (Year) | Y | 4-digit year |
| Industry / Business Type | Text | N | Free text, e.g. "IT & IoT Services" |
| MSME Registration Number | Text | N | — |
| Phone Number | Phone | Y | 10-digit |
| Alternate Phone | Phone | N | 10-digit |
| Official Email | Email | Y | Standard email format |
| Support Email | Email | N | Standard email format |
| Website | URL | N | Must start with http:// or https:// |
| Logo | Image Upload | N | Shown on invoices, letters, and the CMS header |
| Letterhead Template | File Upload | N | Used when generating offer letters, appointment letters, and other official documents |
| Default Billing Tax | Dropdown (from Taxes, Section 3.2 — Sales/Billing scope heads only) | N | Pre-selected automatically on new Invoices, Expenses, and Purchase Bills; can still be changed per record. **No longer mandatory, changed in this revision** — a company with no billing tax configured must be able to save its own profile, and forcing a selection from a list that may legitimately be empty would block that |
| Biometric Attendance | Toggle (On/Off) | Y | **New in this revision.** Defaults to **Off**. Governs whether attendance may be written by a biometric device or external feed at all. **Off** — manual entry is the only input method; the Biometric Feed tab on Payroll → Attendance (Module 6, Section 2.4) shows the integration as available-but-inactive rather than pretending a device exists, and any inbound device payload is rejected. **On** — device/external-feed input is accepted and written to the same attendance fields manual entry writes to. Switching it On or Off never alters attendance already recorded, and never changes how hours are calculated — this is an input-source switch, not a calculation setting |
| Biometric Device Endpoint / Reference | Text | Conditional — required if Biometric Attendance is On | Where the feed comes from, recorded so the source of an attendance record is auditable. Left deliberately generic: the device, HR system, or mobile check-in service is not chosen in this document |
| Registered Address (Primary) | Read-only summary | N | Automatically shows whichever address is marked Primary in part (b) below; not edited from here directly |

**Why TAN and GSTIN stopped being mandatory here, new in this revision:** both are registrations tied to specific taxes, and this CMS no longer assumes any specific tax applies. A company not registered for a given levy would have been unable to save its own company profile — a hard block created purely by an assumption in the specification. Both fields stay, because if the registrations exist they belong on generated documents, but neither is required to get started.

**Where per-tax registration numbers actually live — corrected against the build:** a tax head no longer carries a dedicated Company Registration Number field (it was removed in the 2026-07-30 trim; Section 3.2's own Fields Table note says the **Notes** field absorbs registration-number details). So the general mechanism is the head's Notes field; the named fields above are kept only because they appear on documents independently of any tax calculation. Nothing needs a new Company Profile field when a new tax is added.

**One field the build added to General Info: Payroll Basis** (`payroll_basis`, dropdown Day Basis / Hour Basis, defaults to `HOUR_BASIS`). It gives the company-wide payroll measurement basis a home on the singleton profile record. Only **Hour Basis** is actually implemented end-to-end (Work Week & Hours, Section 3.20, is its rule set; Run Payroll rejects a run under any other basis with a 409); `DAY_BASIS` is a legal stored value with no engine behind it — explicitly deferred.

#### Fields Table — b. Addresses

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Address Type | Dropdown (Registered Office / Branch Office / Correspondence) | Y | Assumption: option list proposed, since the original notes didn't specify the choices |
| Address Line 1 | Text | Y | — |
| Address Line 2 | Text | N | — |
| City | Text | Y | e.g. Chennai, Coimbatore |
| State | Dropdown (Indian states/UTs) | Y | — |
| PIN Code | Text | Y | Exactly 6 digits |
| Mark as Primary | Toggle | Y | Only one address can be Primary at a time; marking a new one automatically un-marks the previous one |

An "Add Another Address" button allows any number of additional addresses to be stored (for example, both the Chennai and Coimbatore offices).

#### Fields Table — c. Bank Details

This part does not introduce any new fields of its own. It displays and manages the same Bank Account list fully described in Section 3.7 below, shown here for convenience since Company Profile is where bank details are typically reviewed. All fields, validation, and the optional UPI QR Code are defined once in Section 3.7 to avoid repeating them. Note that managing bank accounts (add/edit/deactivate) is Super Admin only — a Manager viewing Company Profile sees the bank details as read-only.

#### Fields Table — d. Document Uploads

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| General Documents | File Upload (multiple) | N | Any supporting company document; each entry stores the file, a user-given label, uploaded-by user, and uploaded-on date |
| Financial Documents | File Upload (multiple), tagged by Financial Year | N | e.g. audited statements; grouped and filterable by Financial Year |
| ROC Documents | File Upload (multiple), tagged by Financial Year | N | Registrar of Companies filings and related paperwork |
| Invoice Template | File Upload (single) | N | The layout file the Invoice module uses to generate invoice PDFs |

#### Fields Table — e. Document / Number Prefixes (Numbering Rule)

One configuration row per code type used across the CMS. Columns: Code Type, Prefix, whether the Financial Year is included in the code, how many digits the running number has, the starting number, and whether the count resets every financial year or keeps going forever.

Proposed starting defaults, all editable by Super Admin:

| Code Type | Prefix | Include FY in Code? | Running Number Digits | Starting Number | Resets Every FY? | Example |
|---|---|---|---|---|---|---|
| Customer Code | CUST | Yes | 4 | 0001 | Yes | CUST-2026-0001 |
| Opportunity Code | OPP | Yes | 4 | 0001 | Yes | OPP-2026-0001 |
| Project Code | PRJ | Yes | 4 | 0001 | Yes | PRJ-2026-0001 |
| Invoice Number | INV | Yes | 5 | 00001 | Yes | INV-2026-00001 |
| Purchase Bill Number | PB | Yes | 4 | 0001 | Yes | PB-2026-0001 |
| Ticket Number | TKT | Yes | 4 | 0001 | Yes | TKT-2026-0001 |
| Asset Code | AST | Yes | 4 | 0001 | Yes | AST-2026-0001 |
| Quotation Number | QUO | Yes | 4 | 0001 | Yes | QUO-2026-0001 |
| Credit Note Number | CN | Yes | 4 | 0001 | Yes | CN-2026-0001 |
| Employee Code | EMP | Yes | 4 | 0001 | Yes | EMP-2026-0001 |
| Offer/Appointment/Acceptance Letter Number | LTR | Yes | 4 | 0001 | Yes | LTR-2026-0001 |
| Compensatory Hour Request Number | CHR | Yes | 4 | 0001 | Yes | CHR-2026-0001 |
| Remittance Number | RMT | Yes | 4 | 0001 | Yes | RMT-2026-0001 |

**The last four rows were added by the build** (seeded in `app/seed.py` alongside the nine above, thirteen rules in all): Employee Code, Letter Number and Compensatory Hour Request Number when the Employee/Leave modules (Phase 2) started allocating numbers for those record types, and Remittance Number for Module 15's RMT-<FY>-0000 series. Same mechanism, no new concepts — exactly the "one configuration row per code type" shape this table was specified as.

**Quotation Number is currently unused.** The Opportunity module's Quote tab, the only thing that generated one, was removed entirely on 2026-07-30 (Opportunity, Module 9, Section 1). The entry is left here rather than deleted, so its numbering series is ready to resume from the same starting point if quoting is ever reintroduced.

Note: "2026" in each example is the Financial Year Label from Section 3.1 — the calendar year the financial year starts in. Invoice Number is proposed with 5 digits (matching an existing "INV-2026-00001" example already seen elsewhere in the CMS); every other code is proposed with 4 digits, matching the existing "AST-2026-0001" asset code style.

Validation: Prefix must be 2–6 uppercase letters, no spaces; Digits must be between 3 and 6; the Starting Number cannot be changed once any code of that type has already been generated (only the prefix and future behavior can be adjusted going forward); when "Resets Every FY" is Yes, the running number restarts at the Starting Number on the first record created in each new financial year.

> **Implementation status — Company Profile (all five parts):**
>
> - **(a) General Info — BUILT.** Singleton enforced at both layers: GET returns the one row (or null before setup), POST creates it exactly once (409 afterwards), PUT edits it; a `singleton_lock` unique column makes a second row impossible in the database. All fields in the table above exist, including the build-added Payroll Basis (see the note under part a). Logo, Letterhead and Invoice Template are stored-file references via the shared file-upload service.
> - **(b) Addresses — BUILT**: list, add, **set-primary** (automatically un-marks the previous Primary, exactly as specified — enforced with a DB one-primary guard), and deactivate. **An edit endpoint for an existing address's fields is not built** — a mistyped address is corrected by adding a replacement and deactivating the old one. State is a controlled dropdown backed by a seeded `indian_states` table.
> - **(c) Bank Details — BUILT as specified**: deliberately *not* a second API — the Company Profile screen reads the same `/masters/bank-accounts` endpoints Section 3.7 defines. Same data, not a copy, exactly per the paragraph above.
> - **(d) Document Uploads — DEFERRED.** The `company_documents` table (with doc group, FY tag, title) exists and is migrated, but **no API endpoints sit in front of it yet** — it was parked behind the cross-cutting file-upload work and never picked back up for this screen. The four upload sections below are not yet operable.
> - **(e) Number Prefixes — BUILT**: list, create (for a code type this table doesn't anticipate), and update by code type. The Starting Number lock is real and double-enforced: the API returns 409 once any code of that type has been generated (`starting_number_locked`), and a DB trigger rejects a direct-SQL change too. Per-rule `generated_count` and `first_generated_at` exist to drive the "already in use (12 invoices exist)" confirmation text., it behaves differently from every other sub-master — it is not a list you add rows to. Inside the Company Profile tab, five inner tabs match parts (a) through (e) above: **General Info**, **Addresses**, **Bank Details**, **Documents**, **Number Prefixes**.

- General Info shows a single form with a "Save Changes" button.
- Addresses shows a repeatable list of address cards with an "Add Another Address" button.
- Bank Details shows the same list used in Section 3.7.
- Documents shows four labeled upload sections (General, Financial, ROC, Invoice Template).
- Number Prefixes shows the settings table above; each row opens a small edit pop-up (Prefix, Include FY toggle, Digits, Starting Number, Resets-per-FY toggle) with a live "Example Preview" so the user sees exactly what the next code will look like before saving.

A confirmation pop-up is required before saving a change to a code type that has already generated at least one record, for example: "Invoice Number is already in use (12 invoices exist). Changing this only affects new invoices going forward — existing invoice numbers will not change. Continue?"

For a Manager (view-only), all five inner tabs are visible but read-only — no Save, Add, or Edit controls appear.

#### Status & Deletion Rule

Company Profile does not use the Active/Inactive pattern described for the other sub-masters, because it isn't a growing list of records — it is one record, created during initial setup, that always exists afterward. It can only be edited, never deleted or deactivated; protection comes entirely from the Role Access line below rather than from a status field.

#### Role Access

Super Admin: full access (edit all five parts; the single profile is never deleted). Manager: view only. Not shown to HR, Accountant, or Employee. See Section 3.0.

#### Used By

Invoice and Purchase Bill (letterhead, logo, bank details, default billing tax, invoice template); the Documents/letters generated for Employee & RBAC (letterhead template, official company details); every module that generates a code, via Number Prefixes; Taxes (referenced by the Default Billing Tax setting).

---

### 3.7 Bank Account

#### Purpose

Stores every bank account Meshrd itself holds, so Invoice, Expense, and Purchase Bill can all show consistent "pay to" / "paid from" account details instead of re-entering them each time.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Account Nickname | Text | Y | e.g. "HDFC – Current Account"; shown wherever the account is picked in a dropdown; must be unique |
| Bank Name | Text | Y | e.g. HDFC Bank |
| Account Holder Name | Text | Y | Normally the Company Legal Name |
| Account Number | Text/Number | Y | Numeric; checked for a plausible length (9–18 digits) |
| Confirm Account Number | Text/Number | Y | Assumption: added as a practical safeguard — must match Account Number exactly; not stored as a separate value |
| Account Type | Dropdown (Current / Savings) | Y | — |
| IFSC Code | Text | Y | Exactly 11 characters, standard IFSC pattern (4 letters, then "0," then 6 alphanumeric characters) |
| Branch | Text | Y | — |
| UPI ID | Text | N | e.g. meshrd@hdfcbank |
| UPI QR Code | Image Upload | N | — |
| Is Default | Toggle | N | Which account is pre-selected across Invoice/Expense/Purchase Bill payment forms; only one account can be Default at a time |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page (this same list is also shown inside Company Profile's "Bank Details" inner tab, Section 3.6c — it is the same data, not a copy).

List view shows: Nickname, Bank Name, masked Account Number (e.g. ****4321), IFSC, Status, and which one is Default. "+ Add Bank Account" opens a pop-up sectioned into "Account Details" (Bank Name, Account Holder, Account Number, Confirm Account Number, IFSC, Branch, Account Type) and "UPI (Optional)" (UPI ID, QR Code).

Two confirmation pop-ups (both Super Admin only): one before deactivating the account currently marked Default ("This is your default account — please choose a new default before deactivating this one."), and a lighter, informational one before deactivating any account already used in past transactions.

> **Implementation status — BUILT** (bespoke router, `app/api/v1/masters_bank_accounts.py`): create, edit, **set-default** (unsets the previous default in the same transaction; a DB generated-column guard makes two defaults impossible), deactivate, and delete (409 once referenced, via ON DELETE RESTRICT). Specifics:
>
> - **Confirm Account Number is validated and never stored**, exactly as the Assumption in the table proposes — it is a write-schema field only, checked on both create and edit, with no database column.
> - **Deactivating the Default account is a hard 409, not a confirmation** — the API refuses outright ("Choose a new default account before deactivating this one"), backed by a DB trigger. Stricter than the pop-up the Screen Design describes.
> - Each row carries a computed **`is_referenced`** flag for the "already used in past transactions" warning — currently derived from Expense Types' Default Bank Account references only, a real but partial signal until every payment screen's references feed it.
> - **The masked account number (****4321) is a frontend display concern** — the API and the PDF/Excel export return the full account number to the (Super Admin only) caller.
> - IFSC/account-number format checks are schema-level lengths; export is built; the list takes no search filter (nickname search deferred).

Never hard-deleted once used in any Invoice, Expense, or Purchase Bill payment record. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role (a Manager can see these accounts as read-only inside Company Profile, but cannot open or edit the Bank Account master itself). See Section 3.0.

#### Used By

Invoice (bank details shown on the invoice, and selected when recording a payment received), Expense (account paid from), Purchase Bill (account paid from), Company Profile (Section 3.6c).

**Expanded 2026-07-31 — every screen that moves money now names an account, and only Active accounts are ever offered.** The full set of consumers:

| Where | Field | Behaviour |
|---|---|---|
| Invoice — New/Edit (Module 11, 2.3) | Bank Account | Optional. Printed on the invoice, and the *default* for Record Payment — never a lock |
| Invoice — Record Payment (Module 11, 2.4) | Received Into | Defaults from the invoice above, stays editable and optional. What bank reconciliation matches on |
| Purchase Bill — Add/Edit (Module 13, 2.2) | Bank Account | Optional. The account the bill is expected to be paid from |
| Purchase Bill — Record Payment (Module 13, 2.3) | Paid From | Defaults from the bill, stays editable. Feeds Vendor Usage's "Paid From" column |
| Expense — Add Expense (Module 12, 2.1) | Bank Account | Optional while Pending. What the bank-statement export groups and reconciles by |
| Expense — Company Expenses (Module 12, 2.4) | Paid From | The account a Company-Paid running bill is settled from |
| Expense Types (Section 3.3) | Default Bank Account | Pre-selects the account for a given type. Still editable on the expense |
| Customer Directory (Module 8, 2.1) | Collected Into | Which Meshrd account a given customer's payments normally land in |
| Vendor Usage (Module 7, 2.3) | Paid From | Read-only history, per payment |

**Deactivating an account does not rewrite history.** It disappears from every dropdown above, but rows already recorded against it keep showing it — a payment that genuinely went to an account Meshrd has since closed still went there, and a record that quietly forgot which account it used would be worse than one naming a closed one.

---

### 3.8 Payment Mode

#### Purpose

A short, controlled list of ways a payment can move, so every module records payments consistently instead of free-typing "upi," "UPI," or "Upi" differently each time.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Mode Name | Text | Y | e.g. Bank Transfer, UPI, IMPS, Cash, Cheque, Card; must be unique |
| Requires Reference Number | Toggle (Yes/No) | N | Assumption: added as a practical convenience flag — typically Yes for Bank Transfer/UPI/IMPS/Cheque, No for Cash |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Mode Name, Requires Reference, Status. "+ Add Payment Mode" opens a small pop-up with the fields above. Confirmation pop-up before deactivating a mode already used on any payment record (Super Admin only).

#### Status & Deletion Rule

Never hard-deleted once used on any payment record. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Invoice (Record Payment mode), Expense (paid via), Purchase Bill (Bill Payment mode).

---

### 3.9 Department

#### Purpose

A controlled list of departments so every employee is assigned a consistent department instead of free text, keeping staff reporting accurate.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Department Name | Text | Y | e.g. Engineering, Design, Sales, HR, Finance, Operations; must be unique |
| Department Code | Text | N | Short code, e.g. "ENG" |
| Description | Text Area | N | — |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Name, Code, Status. "+ Add Department" opens a small pop-up. Confirmation pop-up before deactivating a department currently assigned to any active employee (Super Admin only).

#### Status & Deletion Rule

Never hard-deleted once assigned to any Employee record. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0. (Open point for review: HR maintains staff records, so you may later choose to let HR add/edit Departments — like Leave Types. For now, per the confidential-Masters rule, this stays Super Admin only.)

#### Used By

Employee & RBAC — the Department field on every staff record.

---

### 3.10 Designation / Job Title

#### Purpose

A controlled list of job titles so roles are consistent across staff records, offer letters, and appointment letters, instead of free text.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Designation Name | Text | Y | e.g. Software Engineer, UI/UX Designer, Project Manager, HR Executive; must be unique |
| Linked Department | Dropdown (from Section 3.9) | N | Optional, since some titles span more than one department |
| Level / Grade | Text | N | e.g. Junior, Senior, Lead |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Designation Name, Linked Department, Status. "+ Add Designation" opens a small pop-up. Confirmation pop-up before deactivating a designation currently assigned to any active employee (Super Admin only).

#### Status & Deletion Rule

Never hard-deleted once assigned to any Employee record. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0. (Same open point as Department, Section 3.9: HR could later be given add/edit rights here if you want, but stays Super Admin only for now.)

#### Used By

Employee & RBAC — the Designation field on every staff record. Also read by the offer letters and appointment letters generated later for the Documents area of Employee & RBAC.

---

### 3.11 HSN / SAC Code

#### Purpose

A lookup list of tax classification codes for whatever Meshrd bills or buys. Since Meshrd is primarily a services company, most entries will be SAC codes, but the list stays generic enough to also hold HSN codes for physical goods, on either the selling or the buying side. Each code can be pre-linked to a configured tax head (Taxes, Section 3.2) so a line item doesn't need the rate picked manually every time — the link is optional, since whether any tax applies at all is a configuration question, not something this document decides.

**Corrected on 2026-07-30, on explicit instruction: the link is to a real, editable tax head — never a fixed label typed in here.** An earlier build of this screen stored a generic bucket string like "Output Tax — Services" against a code, which looked like a link but wasn't one — it didn't point at any actual record in Taxes, couldn't distinguish GST — IGST from GST — CGST + SGST, and had no way to change rate. That's backwards from how HSN/SAC linkage actually works: **two different codes routinely carry two different tax types** (one billed mostly interstate under IGST, another mostly intrastate under CGST + SGST), and **the same code's rate can change over time** — GST rates are revised by notification, not by this company's own choice. Linked Tax is now a live dropdown built from whatever heads currently exist in Taxes, Sales/Billing or Purchase scope, in force. To change what an HSN/SAC code charges, Super Admin edits the *tax head* in Taxes (which is itself versioned — Applies From / Applies Until, exactly as Section 3.2 describes) — never this row. The code's own record never needs to be touched for a rate change.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Code | Text/Number | Y | Numeric; typically 4–8 digits; must be unique |
| Type | Dropdown (HSN – Goods / SAC – Services) | Y | — |
| Description | Text | Y | e.g. "Information technology consulting and support services" |
| Linked Tax | Dropdown (every in-force tax head from Taxes, Section 3.2, with Sales/Billing or Purchase scope — built live from whatever currently exists, never a fixed list — plus a fixed "— Custom —" option) | N | Auto-fills the tax on an Invoice or Purchase Bill line item that uses this code. Optional, for the same reason as Company Profile's Default Billing Tax: the list it draws from may legitimately be empty. Two codes can legitimately link to two different tax types (IGST vs. CGST + SGST) or two different rates — nothing here assumes they match |
| Custom GST Type | Dropdown (GST — IGST / GST — CGST + SGST) | Conditional — required if Linked Tax is "— Custom —" | **Added 2026-07-30, on explicit instruction.** For the rate a specific code needs that genuinely isn't configured in Taxes yet — a one-off retail order under an HSN code Meshrd doesn't normally bill, for example. Not saved as a reusable head; if the same rate turns out to recur, it belongs in Taxes properly, linked like any other code |
| Custom GST Rate (%) | Number | Conditional — required if Linked Tax is "— Custom —" | The one-off rate itself, e.g. 28 |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Code, Type, Description, Linked Tax, Status. A search box searches Code and Description; a filter narrows by Type. "+ Add Code" opens a small pop-up with the fields above. Confirmation pop-up before deactivating a code already used on any Invoice line item (Super Admin only).

> **Implementation status — BUILT** via the generic lookup factory, with a bespoke write-time validation enforcing the corrected rule above: a Linked Tax must reference an existing tax head whose scope is Sales/Billing, Purchase, or Sales & Purchase, **and** which is currently in force (active, Applies From ≤ today ≤ Applies Until) — any other head is rejected with 422. The "— Custom —" option is modeled as an `is_custom` flag plus Custom GST Type / Custom GST Rate fields, per the table. Search runs on Code (the Description half of the search, and the Type filter, are deferred).

#### Status & Deletion Rule

Never hard-deleted once used on any Invoice or Purchase Bill line item. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Invoice — the line-item Code field and its auto-filled tax rate. Purchase Bill — the same, for codes linked to a Purchase-scope head. Taxes (Section 3.2) — every Linked Tax option here is read live from there, so a head retired or re-versioned in Taxes is reflected here immediately, with no separate update needed.

---

### 3.12 Service Category

#### Purpose

A controlled list of Meshrd's own service lines — Product Development, Hardware Development, Cloud Computing, and the rest — so Opportunity, Project, and Invoice can each be tagged with which service they're for. This is what makes reporting like "which service line brings in the most revenue" possible. Confirmed and promoted from a recommendation (previous Section 6 of this document) to a built sub-master.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Service Category Name | Text | Y | Must be unique |
| Description | Text Area | N | — |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

Starting values: Product Development, Hardware Development, Cloud Computing, Embedded Software Development, Product/Project Consultation, Designing (UI/UX, Graphics, Branding), Website & Mobile App Development, Internet of Things, AI/ML & Cyber Security, SAP and ERP Solutions, Digital Marketing, Multimedia (Films & Ads) — matching Meshrd's own service list from the company background.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Name, Description, Status. "+ Add Service Category" opens a small pop-up. Confirmation before deactivating a category already tagged on any Opportunity, Project, or Invoice.

#### Status & Deletion Rule

Never hard-deleted once tagged on any Opportunity, Project, or Invoice. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Opportunity, Project, Invoice — a tag on each record, for revenue-by-service-line reporting.

---

### 3.13 Unit of Measure

#### Purpose

A short, controlled list — Hours, Days, Fixed/Lump Sum, License, Unit — so invoice line items have a consistent unit label instead of an ambiguous bare "qty." Confirmed and promoted from a recommendation to a built sub-master.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Unit Name | Text | Y | e.g. Hours, Days, Fixed / Lump Sum, License, Unit; must be unique |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Unit Name, Status. "+ Add Unit" opens a small pop-up. Confirmation before deactivating a unit already used on any line item.

#### Status & Deletion Rule

Never hard-deleted once used on any Invoice line item. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Invoice line items.

---

### 3.14 Ticket Categories

#### Purpose

Resolves the open gap first flagged in the Ticket module (Module 4, Section 5): the New/Edit Ticket screen has a Category field with nowhere to draw its options from. This sub-master is that home — a simple, editable list rather than a hardcoded dropdown.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Category Name | Text | Y | Must be unique |
| Description | Text Area | N | — |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

Proposed starting values, illustrative rather than prescriptive (Super Admin can edit freely): General, Technical Issue, Billing Query, Feature Request, Bug Report, Other.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Category Name, Description, Status. "+ Add Category" opens a small pop-up. Confirmation before deactivating a category already used on any ticket.

#### Status & Deletion Rule

Never hard-deleted once used on any Ticket. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Ticket — the Category field on every ticket.

---

### 3.15 Customer Status

#### Purpose

Resolves the open gap first flagged in the Customer module (Module 8, Section 5): Status is a dropdown field on the customer record with nowhere to draw its options from. This sub-master is that home.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Status Name | Text | Y | Must be unique |
| Status | Toggle (Active/Inactive) — governs whether *this status value* can be selected on new/edited customers | Y | Defaults to Active |

Starting values, carried over directly from the Customer module's own proposal: Prospect, Active, Inactive. Super Admin can add more (e.g. a future "Churned" or "Blacklisted") without a code change.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Status Name, Status. "+ Add Status" opens a small pop-up. Confirmation before deactivating a status value already assigned to any customer.

#### Status & Deletion Rule

Never hard-deleted once assigned to any Customer. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Customer — the Status field on every customer record.

---

### 3.16 Customer Source

#### Purpose

**Removed entirely on 2026-07-30, restored on 2026-07-31 — see the note in Section 2.** Resolves the same open Masters gap that motivated it the first time: Source is a field on the customer record with nowhere to draw its options from, and where a customer first came from is the first thing Sales is asked to record, since it decides which acquisition channel gets credit for a won deal.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Source Name | Text | Y | Must be unique |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

Starting values: Referral, Website, Cold Outreach, Partner, Event / Conference, Inbound Enquiry. Super Admin can add more without a code change.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Source Name, Status, Used. "+ Add Source" opens a small pop-up. Confirmation before deactivating a source already assigned to any customer.

#### Status & Deletion Rule

Never hard-deleted once assigned to any Customer. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Customer — the Source field on the customer record and on the Customer Directory, both restored alongside this sub-master (Customer module, Module 8, Sections 2.1–2.2).

---

### 3.17 Asset Categories

#### Purpose

Resolves the open gap first flagged in the Asset Management module (Module 3, Section 5): the Add/Edit Asset screen has a Category field with nowhere to draw its options from. This sub-master is that home. It also covers the broader scope confirmed for Asset Management: not just IT/electronics, but every company-owned physical asset, including office furniture and fixtures and staff ID cards.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Category Name | Text | Y | Must be unique |
| Description | Text Area | N | — |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

Starting values, widened per the confirmed scope: Laptop, Desktop, Monitor, Mobile Phone, Networking Equipment, ID Card, Furniture (Table, Chair), Air Conditioner, Curtains & Fixtures, Office Equipment, Embedded/IoT Prototyping Kit, Software License, Vehicle, Others. Super Admin can add more as needed — this list isn't meant to be exhaustive on day one.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Category Name, Description, Status. "+ Add Category" opens a small pop-up. Confirmation before deactivating a category already assigned to any asset.

#### Status & Deletion Rule

Never hard-deleted once assigned to any Asset. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Asset Management — the Category field on every asset record.

---

### 3.18 Employment Type

#### Purpose

Resolves the open gap first flagged in the Employee module (Module 2, Section 5): Employment Type was documented as a simple fixed dropdown (Full Time / Part Time / Contract / Intern), with a note that it could become a proper Masters list if wanted. Promoted here for the same reason Department and Designation already are — it's the kind of value HR may need to extend later (e.g. adding "Consultant" or "Freelance") without a code change.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Employment Type Name | Text | Y | Must be unique |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

Starting values, carried directly from the Employee module: Full Time, Part Time, Contract, Intern.

#### Screen Design

**Screen type:** A tab inside the Masters settings page.

List view shows: Employment Type Name, Status. "+ Add Employment Type" opens a small pop-up. Confirmation before deactivating a type already assigned to any employee.

#### Status & Deletion Rule

Never hard-deleted once assigned to any Employee. Active/Inactive toggle only. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin only — full CRUD. Not shown to any other role. See Section 3.0.

#### Used By

Employee — the Employment Type field on every employee record.

---

### 3.19 Insurance Plans

#### Purpose

**Resolves the gap flagged directly: company-provided insurance wasn't implemented anywhere.** This is distinct from an employee's *personal* insurance premium, which — if a tax head exists that allows it to be claimed — is declared by the employee in My Tax Declarations (Employee module, Section 2.15) against a declaration-scope head in Taxes (Section 3.2). This sub-master is the opposite direction: the insurance plan(s) Meshrd itself offers as a benefit — group health, life, or accident cover — configured once here and enrolled into per employee (Employee module, Section 2.2's Insurance & Benefits tab).

**Why this stayed its own sub-master rather than folding into Taxes:** an insurance plan is a benefit the company chooses to buy, not a levy anyone is compelled to pay. It carries coverage amounts, a provider, and enrollment per employee with dependents and nominees — none of which a tax head has or needs. The premium split does behave like a payroll line, and Payroll reads it as one, but the record itself belongs here.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Plan Name | Text | Y | e.g. "Group Mediclaim — Standard" |
| Type | Dropdown (Health / Life / Personal Accident) | Y | — |
| Provider | Text | N | The insurance company underwriting the plan |
| Coverage Amount (₹) | Number | Y | Sum insured |
| Company Contribution | Number (₹) or Percentage — Assumption: modeled as a flat monthly ₹ amount per employee, simpler than a percentage split for a benefit that's usually a fixed premium regardless of salary | Y | What Meshrd pays toward the premium |
| Employee Contribution (Monthly, ₹) | Number | N | Any amount deducted from the employee's own pay, if the plan isn't fully company-funded; 0 if fully covered |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

#### Screen Design

**Screen type:** A tab inside the Masters settings page. A simple list — Plan Name, Type, Coverage Amount, Company Contribution, Employee Contribution, Status. "+ Add Plan."

#### Status & Deletion Rule

Never hard-deleted once any employee is enrolled in it. Active/Inactive toggle only — deactivating stops it from being offered to new enrollments but doesn't remove existing employees' coverage record. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

Super Admin — full CRUD. HR — View only, Assumption: added since HR is the natural point of contact for benefits questions even though they don't set premium/coverage terms. Not shown to Manager, Accountant, or Employee directly (Employee sees their own enrollment through the Employee module, not this Masters list).

#### Used By

Employee — the new Insurance & Benefits tab (Section 2.2) enrolls an employee into one of these plans. Payroll — any Employee Contribution feeds the monthly deduction calculation, and Employer Contribution feeds Annual CTC.

### 3.20 Work Week & Hours

#### Purpose

**Resolves a gap that ran right through Payroll: the CMS measured attendance in days when the company actually pays for hours.** This sub-master holds the rules that define what a working day *is* — how many hours it demands, how much of the time on site is an unpaid break, which Saturdays count, and what happens when somebody doesn't reach the number. Payroll and Leave stop guessing and read it.

The company's actual rule, which this sub-master exists to express: **nine hours on site, one hour of that an unpaid break, so eight hours of real work per day, forty hours a week excluding Saturdays.** Saturdays follow a pattern rather than a flat rule — odd Saturdays (1st, 3rd, 5th) are working, even Saturdays (2nd, 4th) are off. Someone who has to leave halfway through the day for an emergency does **not** simply lose half a day's pay: they work the missing hours on another day **of their own choosing**, and the shortfall clears. Only hours that were never made up reach the payslip as Loss of Pay.

**Why every one of those numbers is a configured field rather than a written-down constant.** The eight-hour day, the one-hour break, the forty-hour week and the odd/even Saturday pattern are this company's current answers, not universal truths. A support team on a rotating six-day week, an intern on half days, and a contractor on a flat six-day week all need different targets against the same attendance data. Hard-coding "8" or "odd Saturdays" would mean a code change every time one of those answers moved, and would quietly misprice everyone who doesn't fit the default. So this sub-master carries **policies**, more than one of them, each scoped to who it covers — and the narrower policy always wins over the company-wide default for the people it names. The same principle already applied to Taxes (Section 3.2): the system describes *how a rule behaves*, never *which rule is correct*.

**Why the Saturday pattern is its own field and not a holiday.** A working Saturday is not a holiday and an off Saturday is not one either — holidays are dated events in the Holidays calendar (Section 3.5), while Saturdays are a recurring pattern that has to be resolved for all fifty-two of them before anyone can count a month's working days. Keeping them separate also settles which one wins when they collide: **a Mandatory holiday always overrides the Saturday rule.** 15-08-2026 is a 3rd Saturday, which the odd pattern would make a working day; Independence Day makes it non-working instead, and required hours for that date drop to zero. An Optional holiday does not override it — the Saturday stays working, and anyone taking the day draws on their leave balance.

#### Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Policy Name | Text | Y | Free text — whatever the company calls it, e.g. "Standard — 40 Hour Week" |
| Applies To | Dropdown (Company-wide / Department / Designation / Employment Type / Specific Employees) | Y | Company-wide is the fallback. Exactly one Company-wide policy may be Active at a time |
| Applies To — Value | Dropdown (contents follow whichever dimension was chosen above) | Y unless Applies To is Company-wide | The department, designation, employment type, or named employees the policy covers |
| Effective From | Date | Y | A policy change never rewrites a payroll period that is already Processed |
| Gross Hours per Day | Number | Y | Total time on site, check-in to check-out |
| Unpaid Break (hours) | Number | Y | Deducted from Gross before anything is credited |
| Net Working Hours per Day | Number — **derived, never typed** | — | Gross − Break. The figure an employee actually has to reach, and the only one Payroll compares against |
| Grace Window (minutes) | Number | N | A day landing within this much of the target still counts as a Full Day. 0 switches grace off |
| Half Day Threshold (hours) | Number | N | At or above this but under the full target, the day is a Half Day. Below it, Absent |
| Count Overtime Beyond Net | Toggle | N | When on, hours past the daily target are banked and can offset a shortfall elsewhere in the same period |
| Weekly Hour Target | Number | Y | Hours per week excluding Saturdays. Payroll checks the monthly total, but this is the figure people quote |
| Weekly Off Day(s) | Dropdown (Sunday / Saturday+Sunday / Sunday + alternate Saturday / Rotational — 1 day per week / Friday / None) | Y | The fixed non-working day(s). Saturdays are handled by the field below because they are a pattern, not a flat rule |
| Saturday Rule | Dropdown (Odd Saturdays Working (1st, 3rd, 5th) / Even Saturdays Working (2nd, 4th) / All Saturdays Working / All Saturdays Off / First Saturday Only / Last Saturday Only / Custom — set each Saturday by hand) | Y | Changing this redraws the whole Saturday Calendar and moves required hours for everyone the policy covers |
| Hours on a Working Saturday | Dropdown (Full day — same as Net / Half day — 50% of Net / Custom hours) | N | Many companies run a working Saturday as a half day |
| Custom Saturday Hours | Number | Y only when the field above is Custom hours | — |
| Mandatory Holiday Overrides Saturday | Toggle | Y | Recommended on. A Mandatory holiday on a working Saturday makes it non-working |
| Allow Compensatory Hours | Toggle | N | The core rule: whether someone may make a shortfall up instead of losing pay |
| Compensation Window (days) | Number | N | How long after the shortfall the make-up day may fall. 0 means the same payroll period only |
| Make-Up Day Chosen By | Dropdown (Employee — subject to approval / Employee — no approval needed / Manager assigns the day) | N | Default lets the employee pick, with their manager confirming |
| Allow Make-Up on a Week Off | Toggle | N | An off Saturday is the most common make-up day in practice |
| Allow Make-Up on a Mandatory Holiday | Toggle | N | Off by default — a mandatory holiday should stay a holiday |
| Max Compensatory Hours per Month | Number | N | A ceiling, so compensation cannot quietly become unpaid overtime. 0 removes the cap |
| Uncompensated Shortfall Becomes | Dropdown (Pro-rata per hour (Loss of Pay) / Rounded to nearest half day / Rounded up to a full day / Deduct from leave balance first, then Loss of Pay / Ignore — no payroll impact) | Y | What Payroll does with hours never made up. Pro-rata is the fairest and the default |
| Excess Hours Become | Dropdown (Compensatory credit — expires with the window / Comp Off leave balance / Paid overtime / Nothing — not tracked) | N | The mirror of the rule above |
| Status | Toggle (Active/Inactive) | Y | Defaults to Active |

**Saturday override (a child record, one row per overridden date).** Separate from the policy, because it flips a single date against the pattern — a release weekend that has to be worked, or an extra day off granted. Fields: Saturday (date, from the active Financial Year), Pattern Says (derived, read-only), Override To (Working / Week Off), Hours Required, **Reason (mandatory)**, Notify Affected Employees (toggle). The reason is mandatory and not negotiable: a Saturday that silently changes pay for the whole company needs a stated cause, and it displays permanently against that date on the Saturday Calendar.

#### Screen Design

**Screen type:** A tab inside the Masters settings page, with six inner tabs — the same treatment Taxes and Company Profile get, because there is genuinely more than one table here.

- **Work Week Policies** — the list: Policy, Applies To, Gross h/day, Break, Net h/day, Weekly Target, Weekly Off, Saturday Rule, Comp Allowed, Shortfall Becomes, Status. "+ Add Policy" and Deactivate.
- **Daily Hours** — the derived breakdown for the default policy, plus a read-only **hour-band table** showing how worked hours become a payable day: Full Day at or above the target, Full Day (grace) inside the grace window, Half Day from the half-day threshold up to the target, Absent below it. Each band shows what it is Paid As and what it deducts. This table is what makes the rule auditable — it is the difference between "the system decided" and "here is the band it fell into."
- **Saturday Calendar** — every Saturday of the active Financial Year resolved from the rule: Month, Date, Which (1st…5th), Pattern Says, Actually, Hours Required, Override/Note. Fifty-two rows for FY 2026–27. Any override or holiday collision is spelled out in the Note column. "Override a Saturday" and "Export Calendar" — the file HR circulates at the start of the year.
- **Compensation** — the compensation rules read-only, plus the open compensatory requests, with a link through to the live queue in Leave (Module 5, Section 2.6).
- **Pay Cycle** — **added 2026-07-30, on explicit instruction.** The date window a payroll run actually covers, which is not the same thing as a calendar month. See the Pay Cycle subsection below for the fields, the reasoning, and the worked example.
- **Where Used** — a read-only map of the screens that read this policy and what a change to it does to each. It exists for the same reason Taxes has one: changing the Saturday rule moves required hours for every employee the same afternoon, and whoever is about to do it should see that before they save.

#### Pay Cycle — Fields Table

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Cycle Type | Dropdown (Fixed Cycle — Custom Start/End Day / Calendar Month — 1st to last day) | Y | Calendar Month ignores Start Day and End Day and simply runs the 1st to the last day of the month, the assumption every earlier revision of this document made silently |
| Start Day | Number, 1–31 | Conditional — required if Cycle Type is Fixed Cycle | The day of the **previous** month a pay period opens |
| End Day | Number, 1–31 | Conditional — required if Cycle Type is Fixed Cycle | The day of the **current** month a pay period closes — this is the cutoff every downstream calculation reads |
| Salary Credit Day | Number, 1–31 | Y | **Added 2026-07-30, on explicit instruction.** The day of the month the bank transfer actually reaches employees' accounts — a separate date from End Day, since payroll needs to be calculated and confirmed after the cutoff before money can move. Currently 30 — 5 days after the default End Day of 25. Clamped automatically to the real last day of a shorter month (e.g. a Credit Day of 30 or 31 still resolves inside February, rather than silently rolling into March) |
| Resolved Periods | Read-only, derived | N/A | Not stored — computed live from Start Day, End Day and Salary Credit Day for whichever months are being previewed, so the effect of a change is visible before it's saved |

**Why this exists.** Payroll had quietly assumed every pay period was the calendar month — 1st to 30th or 31st — everywhere in this specification. Many companies, this one included, run payroll on a fixed cycle instead: commonly the 26th of one month through the 25th of the next, so payroll processing has a few working days before month-end to actually run the numbers and pay out on time. **Nothing about the cycle is hard-coded.** Start Day, End Day and Salary Credit Day are ordinary editable fields — the 26th–25th cycle with a 30th credit date is this company's current answer, not a built-in assumption, and can be changed here at any time. A change never rewrites a period that has already run; it only changes what date range, and what credit date, the *next* Run Payroll (Module 6, Section 2.1) resolves for a given month.

**Salary Credit Date is not the same thing as the cutoff, and the two are deliberately separate fields.** End Day decides which events a run includes; Salary Credit Day decides when the money actually lands, which is always later — there needs to be time between the two for Accountant or Super Admin to run, review, and confirm payroll. Conflating them would either force the cutoff dangerously close to payday, or delay payday to match a cutoff that has no real reason to move.

**The cutoff reconciliation rule, stated precisely — this is the part that actually matters:** any event with a date falling *after* the End Day belongs to the **next** pay period, never the one that just closed. A concrete example, using the default 26th–25th cycle: an employee takes one day of Approved Casual Leave on **27 July 2026**. The July 2026 pay period runs 26 June to 25 July — the 27th is two days past that cutoff, so July's payslip does **not** include it. It is not lost or ignored: it is picked up automatically by the **August 2026** period (26 July to 25 August), which does contain the 27th, and prints there instead. The same rule applies uniformly to every dated input Payroll reads — attendance corrections, compensatory make-up days, ad-hoc adjustments — not leave specifically. Nothing about this needs a person to remember to move it; the date alone decides which run picks it up.

#### Screen Design — Pay Cycle tab

Shows the current Cycle Type, Start Day, End Day and Salary Credit Day read-only, plus a **Resolved Periods** table previewing three consecutive months' actual date ranges and Salary Credited date, all computed from them, and a **Cutoff Reconciliation** table showing any pending carryover — an event whose date has already missed the current period's cutoff and is queued for the next one, with plain-language reasoning next to it. "Edit Pay Cycle" opens the three editable fields, with a live preview of what the very next period would resolve to — its date range and its credit date — before the change is saved.

#### Implementation Status — Work Week & Hours (reconciled 2026-08-03)

**BUILT** (`app/api/v1/masters_work_week.py`):

- **Work Week Policies** — full CRUD + deactivate, every field in the Fields Table. **Net Working Hours per Day is a real STORED GENERATED database column** (Gross − Break) — the API never accepts it, the database computes it; "derived, never typed" is enforced, not conventional. Deactivating the only active Company-wide policy is refused with 409 (API check + DB trigger), exactly the rule below. List has PDF/Excel export.
- **Applies To** — Company-wide / Department / Designation / Employment Type are wired (FK fields on the policy). **Specific Employees is PARTIAL**: the `work_week_policy_employees` assignment table exists and Payroll resolves against it, but no Masters endpoint populates it yet — a per-employee policy cannot currently be assigned through this screen's API.
- **Saturday Overrides** — create and list (with export — the built "Export Calendar" exports the override rows). The date must actually be a Saturday (422 otherwise), **Reason is mandatory** as specified, and **Pattern Says is snapshotted at creation time** from the policy's rule (all six pattern variants — odd/even/all/none/first/last — are resolved in code), so it records what was true then rather than drifting if the rule later changes. Creating an override is its own RBAC action (`override_saturday`, Super Admin). No edit or delete endpoint for an override exists yet.
- **Pay Cycle** — list plus a replace-style POST: editing the cycle deactivates the old row and activates a new one with its own Effective From, which is precisely how "a change never rewrites a period that has already run" is modeled. Fixed Cycle's Start/End Day requirement is a DB CHECK. Resolved periods are stored per run in a `pay_periods` table (period start/end, salary credit date, closed flag) that Payroll fills as it runs.

**DEFERRED — the computed read views.** The **Saturday Calendar** (all fifty-two Saturdays resolved), the **Daily Hours hour-band table**, the **Compensation** tab's read-only rule summary, and the Pay Cycle tab's **Resolved Periods preview / Cutoff Reconciliation** table have no dedicated Masters endpoints — they are read views computed from the data above, and the resolution logic lives with Payroll (its Attendance & Time Basis and Run Payroll flows, which are built and are the actual consumers). The masters ship the guarded data those views are computed from; the browsable previews are frontend work against Payroll's resolution.

*(Note: this Screen Design section describes six inner tabs; Section 4's navigation summary still says five — the Pay Cycle tab, added 2026-07-30, is the sixth.)*

#### Status & Deletion Rule

Never hard-deleted. Active/Inactive toggle only — deactivating a policy leaves every already-Processed payroll period untouched and applies only to future runs, which is also why Effective From exists. A Company-wide policy cannot be deactivated while it is the only Active one, since that would leave employees with no target to measure against. Delete and deactivate are Super Admin only, per Section 3.0.

#### Role Access

**Super Admin — full CRUD.** Every figure here decides pay, so nobody else edits it.

**HR — View only.** HR fields the questions ("is this Saturday working?", "how many hours am I short?") and needs to answer them without being able to change what people are paid.

**Manager — View only.** Same reasoning: a manager approving a compensatory request has to see the window and the cap they are approving against.

**Accountant — no access.** They see the *consequence* on the payroll register, not the rule.

**Employee — no access**, consistent with Masters as a whole. What an employee needs — their own required hours, their own shortfall, their own make-up day — reaches them through Payroll's Attendance screen and Leave's Compensatory Hours screen, not through configuration.

#### Used By

**Payroll — Attendance & Time Basis (Module 6, Section 2.4)** reads Net Hours per Day, the working-day count and the Saturday rule to produce each employee's Required Hours for the period. **Payroll — Run Payroll (Section 2.1)** reads Uncompensated Shortfall Becomes to turn unmet hours into Loss of Pay lines. **Leave — Apply for Leave (Module 5, Section 2.1)** reads the weekly off days and the Saturday rule to decide which dates actually consume a leave balance. **Leave — Compensatory Hours (Module 5, Section 2.6)** reads the window, the monthly cap and the permitted make-up days to accept or refuse a chosen date. **Employee — Record Attendance (Module 2, Section 2.2)** reads Net Hours, the grace window and the half-day threshold to resolve a recorded day into a Day Status. **Dashboard** reads the working-day count for its attendance percentages.

---

### 3.21 Email Configuration

#### Purpose

**Added 2026-07-31.** Every module in this CMS that sends an email — the welcome email and temporary password on Employee onboarding, a payslip going out from Payroll, a leave decision, a ticket assignment, an asset request outcome, the resignation acceptance letter on exit — had that behaviour described only in prose: "the employee is notified." Nothing said *how* the email actually leaves the building, which server it uses, or where its wording could be changed without a code deployment. This sub-master is that home: one place holding the outbound mail server's connection details, and a dynamic list of every trigger that currently exists, each independently switchable and editable.

**Two genuinely different things live on this one screen, and the split matters.** The Server Settings tab is a single record — a company has exactly one mail server it sends through, the same reason Company Profile (Section 3.6) is one record rather than a list. Email Templates is a real list, because *which triggers exist* and *whether each one is currently on* is exactly the kind of thing that has to change without a code change — a new module's notification gets a new row here, not a new hardcoded email-sending function.

#### Fields Table — Server Settings

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Sending Enabled | Toggle (Active/Inactive) | Y | Master switch. Off stops every outbound email from this CMS at once, without touching a single template — the in-app notification bell is unaffected either way, since it does not depend on email delivery |
| Provider | Dropdown (Custom SMTP / SendGrid / Amazon SES / Mailgun / Postmark) | Y | Custom SMTP shows the four connection fields below; a named provider replaces them with a single API Key field, since those services authenticate that way instead |
| SMTP Host | Text | Y, if Provider = Custom SMTP | e.g. smtp.meshrd.in |
| SMTP Port | Number | Y, if Provider = Custom SMTP | Common values: 587 (STARTTLS), 465 (SSL/TLS), 25 (unencrypted — discouraged) |
| Encryption | Dropdown (STARTTLS / SSL-TLS / None) | Y, if Provider = Custom SMTP | — |
| Username | Text | N | — |
| Password | Password (masked) | N | Never shown in full once saved, the same convention used for every stored credential in this CMS |
| From Name | Text | Y | What a recipient sees as the sender name |
| From Email Address | Email | Y | Must be a domain the configured server is authorised to send as, or messages are likely to land in spam or be rejected outright |
| Reply-To Email | Email | N | Optional. Where a recipient's reply actually goes — often a shared support inbox rather than the no-reply sending address |

**Send Test Email** sends one real email through whatever is currently configured, to a chosen address, without waiting for a genuine trigger to fire. This is the fastest way to confirm new credentials actually work before relying on them — recorded on the Recent Sends tab below, same as any other send.

#### Fields Table — Email Templates (one row per trigger)

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Template Name | Read-only | N/A | e.g. "Payslip Available," "Ticket Assigned" — identifies the trigger, not editable here |
| Triggered From | Read-only, chip | N/A | Which module fires this email. What *causes* it to fire is defined at that trigger point, not here — this screen only controls whether it sends and what it says |
| Enabled | Toggle (Yes/No) | Y | Off silences only this specific email. The in-app notification for the same event still fires — Enabled here never suppresses in-app awareness of the underlying event, only its email copy |
| Subject Line | Text | Y | Supports placeholders specific to that trigger — e.g. {{first_name}}, {{month}}, {{ticket_no}} — filled in per recipient at send time |
| Body | Text area | Y | Plain text in this prototype; a production build would offer rich text with the same placeholder set |

Starting rows, one per notification point already documented across the other thirteen modules: Welcome Email, Temporary Password, Offer / Appointment Letter (Employee); Payslip Available, Payslip Reissued (Payroll); Leave Approved, Leave Rejected (Leave); Document Verified, Document Rejected, Profile Change Approved, Profile Change Rejected (Employee); Ticket Assigned (Ticket); Asset Request Approved, Asset Request Rejected (Asset Management); Resignation Acceptance Letter (Employee — Offboarding, Section 2.13); Password Reset (Account, all roles). Super Admin can add a row here the moment a future module introduces a new notification — this list is not meant to be exhaustive beyond what exists today.

#### Screen Design

**Screen type:** Its own record-style screen inside Masters, following the same multi-tab pattern as Company Profile and Taxes, not a simple list — three tabs: **Server Settings**, **Email Templates**, **Recent Sends**.

**Recent Sends** is a small, read-only log — recipient, template, sent-on timestamp, delivery status (Delivered / Bounced) — for troubleshooting one specific delivery. It is deliberately not a volume or spend report; that distinction already established for Vendor Usage (Module 7, Section 2.3) applies here too.

#### Implementation Status — Email Configuration (reconciled 2026-08-03)

**BUILT** (`app/api/v1/masters_email_config.py`, transport in `app/services/email_transport.py`):

- **Server Settings** — singleton (GET / upsert PUT, `singleton_lock` unique column). **Credentials are Fernet-encrypted at rest and never echoed back** — GET returns only a 4-character `credential_hint`; an edit that doesn't resupply the password/API key (toggling Sending Enabled, fixing the From Name) leaves the stored secret untouched rather than wiping it. Custom SMTP takes the four connection fields; a named provider takes a single API key, per the table. **The transport actually implemented is Mailgun (API) and SMTP** — the other named providers in the dropdown are stored-but-untransported values until their adapters are written.
- **Email Templates** — the **16 starting rows are seeded** (`app/seed.py`, one per notification point in the paragraph above). GET/PUT edit only Enabled, Subject and Body (name and owning module are read-only, per the table); each row also carries an `available_placeholders` list so the UI can show that trigger's legal placeholder set. **POST exists to add a new trigger row** — the "future module adds a row, not a function" growth path. **DELETE is rejected outright by a DB trigger** — a template row is never deleted, only disabled, exactly the lifecycle rule below. **Disabling a template silences only the email; the in-app notification for the same event still fires** — this is a system invariant, verified in the build. One seeded-copy correction: the Password Reset template's wording delivers a new temporary password, not a clickable reset link — this codebase's reset flow has no link mechanism.
- **Send Test** — a real send through whatever transport is currently configured (it deliberately bypasses the Sending Enabled master switch, since its whole point is testing credentials before enabling), logged to Recent Sends like any other send, with an explanatory error detail when misconfigured.
- **Recent Sends** — read-only, append-only log: recipient, subject snapshot, sent-at, delivery status, provider message id, error detail, and a related-record reference; exportable. Delivery status as built is Sent / Failed (with error text) rather than the Delivered/Bounced webhook states — bounce tracking would need provider webhooks and is deferred.

#### Status & Deletion Rule

Server Settings is a single record — there is no add/delete, only edit. An Email Template row is never deleted once a trigger exists in the system; Enabled/Disabled is the only lifecycle it has, since disabling a template that later needs re-enabling should not require re-creating it from scratch.

#### Role Access

Super Admin only — full access, including the mail server credentials. Not shown to any other role: an SMTP password is exactly the kind of secret this CMS's confidentiality model (Section 3.0) exists to protect, and unlike a lookup list, nobody else has a legitimate reason to view it, let alone edit it.

#### Used By

Every module that sends a notification email — see the Dependency Summary Table (Section 5) for the full, itemised list. Where a module's own document says "the employee is notified," the email half of that notification is now this sub-master's Email Templates list, not an assumption embedded in that module's own text.

## 4. Masters Menu / Navigation

"Masters" appears as its own item near the bottom of the CMS's main left-hand sidebar, using a gear icon, set apart from the day-to-day operational modules (Customer, Opportunity, Project, and so on) listed above it. This placement signals that it's configuration, not daily work. Assumption: the menu label "Masters" is used consistently in this document; "Settings" would work equally well as the visible label if preferred — the structure below doesn't change either way.

Clicking "Masters" opens one settings page containing a **left-side vertical tab list** of sub-masters. Selecting a tab swaps only the main content area to that sub-master's list — the page itself never reloads or navigates away. Company Profile's tab additionally shows its own five inner tabs (General Info, Addresses, Bank Details, Documents, Number Prefixes) once selected, as described in Section 3.6.

**The tab list is filtered by role** (per the Access Model, Section 3.0), so a user only ever sees the sub-master sections they are allowed to open:

- **Super Admin** sees all 21 sub-master tabs.
- **Manager** sees only Expense Types, Holidays, Leave Types, Company Profile, and Work Week & Hours (view-only).
- **HR** sees Leave Types (manage), Insurance Plans (view-only), and Work Week & Hours (view-only).
- **Accountant** sees Taxes — view-only by default, so payroll and invoice figures can be sanity-checked against the tax heads that produced them, and editable if promoted via a per-user permission override in the RBAC admin screens (the named "Allow Accountant to Manage Taxes" toggle is not wired at runtime — see the Implementation status note in Section 3.0).
- **Employee** has no access to Masters at all — the Masters item does not appear in their sidebar.

Even for the roles that cannot open most of Masters, the modules those roles do use still read Master values to fill their own dropdowns (see the note at the end of Section 3.0). Hiding the rest of the Masters area from them keeps configuration confidential without blocking their day-to-day work.

**Two sub-masters carry their own inner tabs because they genuinely hold more than one table.** Work Week & Hours has six — Work Week Policies, Daily Hours, Saturday Calendar, Compensation, Pay Cycle (added 2026-07-30), and a read-only Where Used — for the reason given in Section 3.20: the Saturday Calendar is a fifty-two-row resolution of the policy's rule, not a field on it, and the hour-band table is what makes a Half Day auditable rather than asserted.

**Taxes gets the largest tab and, given how much now lives inside it, its own inner tabs** — Tax Heads, Tax Schemes, and a read-only "Where Used" view showing which modules currently reference each head. The Where Used view exists because a single head can now drive an invoice line, a payslip deduction, and an employer contribution at once; before deactivating one, whoever is doing it should be able to see everything it touches without hunting through five modules.

This single-page-with-tabs approach is recommended over 21 separate pages for three reasons:

- It keeps every configuration screen inside one predictable, contained area rather than scattered across the main menu.
- It matches how most business software organizes a "Settings" area, so it will feel familiar to new users.
- It makes access control simple to reason about: whether the whole Masters area, and each tab within it, is shown or hidden is decided in one place per role, rather than scattered across many screens.

## 5. Dependency Summary Table

| Master | Depended On By |
|---|---|
| Financial Year | Customer, Opportunity, Project, Invoice, Purchase Bill, Ticket, Asset Management (all via Number Prefixes' Financial Year insertion), Leave & Payroll |
| Taxes | Invoice, Expense, Purchase Bill, Employee (Salary Structure, My Tax Declarations), Payroll (every deduction, contribution, and the income tax calculation), HSN/SAC Code, Company Profile (Default Billing Tax) |
| Expense Types | Expense |
| Leave Types | Leave & Payroll |
| Holidays | Leave & Payroll, Work Week & Hours (a Mandatory holiday overrides a working Saturday) |
| Work Week & Hours | Payroll (Attendance & Time Basis — Required Hours; Run Payroll — Loss of Pay conversion), Leave (Apply for Leave — which dates consume a balance; Compensatory Hours — window, cap, permitted make-up days), Employee (Record Attendance — Day Status resolution), Dashboard (attendance percentages) |
| Company Profile — General Info, Addresses, Bank Details, Documents | Invoice, Purchase Bill, Employee & RBAC (offer/appointment letters) |
| Company Profile — Number Prefixes | Customer, Opportunity, Project, Invoice, Purchase Bill, Ticket, Asset Management (every module with an auto-generated code) |
| Bank Account | Invoice, Expense, Purchase Bill, Company Profile |
| Payment Mode | Invoice, Expense, Purchase Bill |
| Department | Employee & RBAC |
| Designation / Job Title | Employee & RBAC |
| HSN / SAC Code | Invoice, Purchase Bill |
| Service Category | Opportunity, Project, Invoice |
| Unit of Measure | Invoice |
| Ticket Categories | Ticket |
| Customer Status | Customer |
| Asset Categories | Asset Management |
| Employment Type | Employee, and Taxes (a head can be scoped to specific employment types) |
| Insurance Plans | Employee, Payroll |
| Email Configuration | Employee (welcome email, temporary password, offer/appointment letter, document verified/rejected, profile change approved/rejected), Payroll (payslip available/reissued), Leave (approved/rejected), Ticket (assigned), Asset Management (request approved/rejected), Employee — Offboarding (resignation acceptance letter), and every "Reset Password" flow in the CMS |

## 6. Anything Else You'd Recommend

This section previously recommended Service Category and Unit of Measure, and flagged (without recommending a fix) an ownership gap around Salary Structure. Status as of this revision:

- **Service Category and Unit of Measure — built.** See Sections 3.12 and 3.13. No longer open recommendations.
- **Ticket Categories, Customer Status and Customer Source — also built**, resolving the open gaps flagged in the Ticket (Module 4) and Customer (Module 8) documents. See Sections 3.14–3.16. Customer Source was removed entirely on 2026-07-30 and restored on 2026-07-31 — see the note under the Sub-Master Directory above.
- **Asset Categories and Employment Type — also built**, resolving the open gaps flagged in the Asset Management (Module 3) and Employee (Module 2) documents. See Sections 3.17–3.18.
- **Email Configuration — added 2026-07-31.** Every module in this CMS that sends an email — Employee (welcome, temporary password), Payroll (payslip available/reissued), Leave, Ticket, Asset Management, and the exit/offboarding flow — had its email behaviour described in prose ("the employee is notified") with no shared place controlling the server it goes through or the wording it uses. See Section 3.21.
- **Taxes — rebuilt from scratch this revision, and it replaced four other sub-masters while doing so.** Income Tax Slabs (TDS), PF & ESI Rates, Professional Tax Slabs, and Old Regime Deduction Limits no longer exist. Everything they held is now a record Super Admin creates inside Taxes (Section 3.2), described by generic behaviour fields rather than by name. This was the right correction to make before any code exists: those four sub-masters encoded an assumption about which statutory items apply to this company, and that assumption was never confirmed by anyone. See Section 3.2's opening and the note under the Sub-Master Directory for the full reasoning.
- **Salary Structure — resolved differently.** Rather than becoming a Masters sub-master, the Employee module (Module 2, Section 2.2) is now where Super Admin creates and edits a salary structure, directly on the employee record it belongs to. This isn't a Masters-style shared list the same way the others are — a salary structure is inherently tied to one specific person's compensation, not a company-wide dropdown of options. See the Employee module for the full field-level design.

**One thing is deliberately left open, and should stay open until someone with the answer closes it:** which taxes, statutory deductions, and contributions this company is actually liable for. That is a data-entry question, not a specification question — see the closing note of Section 3.2. This document should not acquire a list of them during grooming; if grooming produces such a list, it belongs in the system as Tax Head records once built, not in these pages.

No further additions are flagged as open at this time.

---

**Suggested filename:** `01-masters-module.md`
