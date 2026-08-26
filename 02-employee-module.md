# Module 2 of 14: Employee

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Employee module.

**Implementation status (2026-08-05):** built and live — FastAPI backend, `app/api/v1/employees.py` + `employee_compensation.py` + `employee_documents.py` + `employee_lifecycle.py` + `tax_declarations.py` + `announcements.py` + `notifications.py` + `attendance.py` + `auth.py`. Every screen below carries an inline **Build status** note reconciled against the real code. The login/password lifecycle (Section 2.2) was rewritten wholesale this pass to reflect a substantial post-launch change: short-lived (15-minute) access tokens with a separate database-backed, single-use-rotating refresh token; `POST /auth/refresh` and `POST /auth/logout`; argon2id hashing with lazy bcrypt migration; password-reuse blocking against the last 5; server-side `must_change_password` enforcement on every route; immediate session revocation the instant a login is disabled; and Redis-backed login rate limiting. Angular frontend not yet started — anything describing on-screen layout/styling remains forward-looking.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Employee Directory](#21-employee-directory)
   - 2.2 [Employee Master Record](#22-employee-master-record)
   - 2.3 [My Profile (Self-Service)](#23-my-profile-self-service)
   - 2.4 [My Leave (Self-Service)](#24-my-leave-self-service)
   - 2.5 [My Payslips (Employee View)](#25-my-payslips-employee-view)
   - 2.6 [My Documents (Self-Service)](#26-my-documents-self-service)
   - 2.7 [My Tickets](#27-my-tickets)
   - 2.8 [My Projects & Tasks](#28-my-projects--tasks)
   - 2.9 [My Assets](#29-my-assets)
   - 2.10 [Employee Dashboard](#210-employee-dashboard)
   - 2.11 [Announcements / Notifications](#211-announcements--notifications)
   - 2.12 [Onboarding Checklist (HR-Facing)](#212-onboarding-checklist-hr-facing)
   - 2.13 [Offboarding / Exit](#213-offboarding--exit)
   - 2.14 [My Tax Declarations (Self-Service)](#214-my-tax-declarations-self-service)
   - 2.15 [Offer & Appointment Letter (HR-Facing)](#215-offer--appointment-letter-hr-facing)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Planned Features (Future Flow)](#7-planned-features-future-flow)
8. [Assumptions & Points to Confirm](#8-assumptions--points-to-confirm)

## 1. Module Overview

The Employee module does two distinct jobs, and every screen below belongs to one or the other:

**It is the HR master record.** This is the one place where every staff member's personal, employment, and account information lives — the record HR creates when someone joins and keeps up to date for as long as they work at Meshrd.

**It is a self-service portal.** Every logged-in person — regardless of role — is also a staff member, and this module is where they check their own leave balance, download their own payslips, see tickets and tasks assigned to them, see what company assets they hold, and upload their own documents. A Manager gets everything a regular Employee gets for themselves, plus a limited, summary-level view of their direct reports.

A few widgets and sections inside this module show data that actually belongs to other modules — leave balances come from Leave, payslip amounts come from Payroll, task lists come from Project, ticket lists come from Ticket, and assigned-asset lists come from Asset Management. This document does not redesign those modules. It only describes what an Employee or Manager sees and can do with that data **from inside the Employee module**. The full rules, statuses, and logic for Leave, Payroll, Project, Ticket, and Asset Management are documented separately, in their own module specs.

This module has nothing to do with Meshrd's retail hardware products or product billing — that side of the business runs on a separate website and is out of scope everywhere in this document.

## 2. Screens

### 2.1 Employee Directory

**What it's for:** The searchable master list of every staff member at Meshrd — the entry point for anyone doing HR, payroll, or account-related work on employees other than themselves.

**Who can open it:** Super Admin, Manager, Accountant, HR. An Employee does not use this screen at all — they see their own record through My Profile (Section 2.3) instead, and cannot browse anyone else's record here.

Note on Manager's view: per the Role-Based Access rules (Section 6), a Manager's extra visibility beyond their own record is limited to their direct reports. So while a Manager can open the Directory, the rows shown to a Manager are filtered to their own direct reports only — not the whole company. Super Admin, Accountant, and HR see every employee.

**Tabs:** None — this is a single table view.

**Columns shown:**

| Column | Notes |
|---|---|
| Employee ID | Auto-generated code, e.g. EMP-2026-0001 (see Section 2.2) |
| Photo | Small thumbnail, or initials if no photo uploaded |
| Name | First Name + Last Name |
| Department | From Masters |
| Designation | From Masters |
| Employment Type | Full Time / Part Time / Contract / Intern |
| Status | Active / Inactive / On Notice / Exited, shown as a colored badge |
| Reporting Manager | Name of their manager, if set |
| Phone | Primary contact number |
| Joining Date | dd-mm-yyyy |
| Actions | View, Edit (Edit hidden for roles that are view-only — see Section 6) |

**Search box:** Searches Name, Employee ID, Email, and Phone.

**Filters:** Department (from Masters), Designation (from Masters), Status (Active / Inactive / On Notice / Exited — multi-select), Employment Type (from Masters, multi-select), Reporting Manager, Work Location, and Joining Date range. Plus the baseline set (search, date range, status, owner, active/inactive) defined in the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Available to every role that can open this screen**, per that convention — filters narrow what a role already sees, never widen it. Manager's Directory is scoped to direct reports, so a Manager filtering by Department is filtering within their own team. Super Admin additionally gets Created By, Last Modified By, and a "show exited employees" toggle.

**Export:** "Export to PDF" and "Export to Excel," exporting exactly the filtered, searched, sorted set currently on screen, with a header block stating which filters produced it.

**Sort options:** Name (A→Z / Z→A), Joining Date (Newest / Oldest first), Department.

**Buttons:**

- **"+ Add Employee"** — opens the Employee Master Record (Section 2.2) in create mode. Visible only to HR and Super Admin (Manager and Accountant have view access to the Directory but cannot create records — see Section 6).
- **Row-level "View"** — opens the Employee Master Record in read mode.
- **Row-level "Edit"** — opens the Employee Master Record in edit mode. Visible only to HR and Super Admin.

**Empty state:** "No employees added yet." with a prompt to add the first employee, shown only to the roles that can add one (HR, Super Admin).

**Pagination:** Standard page controls, 25 rows per page by default, with a page-size selector (10/25/50/100).

**Build status:** built. `GET /employees` with the search (name, Employee ID, email, phone — the ID/phone halves were found missing by the Phase 2 audit and added) and every filter above as query parameters (department, designation, status, employment type, reporting manager, work location, joining-date range), plus `format=pdf|excel` export of exactly the filtered, scoped set with a filters-applied header block. Manager's direct-reports-only scope is enforced server-side — on this list *and* on every single-record endpoint (get/update record, emergency contacts, statutory identifiers, login actions): a Manager guessing another employee's id gets 403, a fix from the Phase 2 audit (the list was scoped but single-record endpoints previously checked only screen visibility). Sort order and pagination are frontend concerns — the API returns the full filtered set. The "show exited employees" toggle and Created By / Last Modified By filters are **deferred** (status filtering covers the exited case via `employment_status=EXITED`).

---

### 2.2 Employee Master Record

**What it's for:** The complete HR record for one staff member — personal details, employment details, login and role, bank and statutory information, salary structure link, emergency contact, documents, and read-only summaries pulled from Asset Management and Leave.

**Who can open it:** HR and Super Admin can create and edit it. Manager and Accountant can open it in read-only mode, and only for employees within their allowed scope (Manager: their own direct reports; Accountant: everyone, but view-only). An Employee does not use this screen for themselves — they use My Profile (Section 2.3), which shows a role-appropriate, partly editable version of the same record.

**Record header (shown above all tabs, on every tab):** Employee ID (read-only, auto-generated — see numbering below), Photo thumbnail, Name, Department, Designation, Status badge.

**Editing model:** The page opens in read mode. An "Edit" button (HR/Super Admin only) unlocks the Personal Details, Employment Details, Bank & Statutory, Salary Structure, Insurance & Benefits, and Emergency Contact tabs together, with a single "Save Changes" button that commits all of them at once and a "Cancel" button that discards changes. Account & Login actions (toggling login, changing role, enabling/disabling, resetting password) and Document verification actions are treated as immediate, individually-confirmed actions rather than part of this Edit/Save flow, since they carry their own confirmation prompts (see below).

**Employee ID / numbering:** Assumption — an Employee ID is auto-generated on save, following the same style as every other module's code: **EMP-\<Financial Year\>-\<4-digit running number\>**, e.g. `EMP-2026-0001`. This isn't yet listed in the Masters module's Number Prefixes table (Company Profile, part e), so it should be added there alongside Customer Code, Invoice Number, and the rest, for Super Admin to configure the same way.

#### Tab: Personal Details

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Photo | File upload (image) | N | JPG/PNG, recommended square crop |
| First Name | Text | Y | 2–50 characters |
| Last Name | Text | N | Up to 50 characters |
| Email | Email | Y | Standard email format; must be unique across all employees, since it is also used as the login identifier when a login is created |
| Phone | Phone | N | 10-digit Indian mobile number |
| Date of Birth | Date | N | Cannot be in the future. Assumption: employee must be at least 18 years old as of the Joining Date |
| Gender | Dropdown | N | Assumption — proposed options: Male / Female / Other / Prefer not to say |
| Current Address | Text area | N | Assumption: added here because Section 2.3 (My Profile) lists Address as something an employee can edit directly, but it wasn't in the original Personal Details field list — it needs a home on the record, and Personal Details is the natural place |

#### Tab: Employment Details

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Department | Dropdown (from Masters) | Y | — |
| Designation | Dropdown (from Masters) | Y | — |
| Joining Date | Date | Y | Cannot be in the future |
| Employment Type | Dropdown (from Masters, Section 3.18) | Y | Full Time / Part Time / Contract / Intern |
| Reporting Manager | Dropdown (existing employees) | N | Cannot select the employee themselves; the system blocks a selection that would create a circular reporting chain (A reports to B, B reports to A) |
| Status | Dropdown | Y | Active / Inactive / On Notice / Exited. Assumption: defaults to Active for a new record, even though the original notes didn't mark it required — a status always needs a value for the rest of the system (approvals, payroll, etc.) to work correctly |

---

#### Tab: Account & Login

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Create Login | Toggle (Yes/No) | Y | Assumption: defaults to No — HR turns this on deliberately when the employee is ready to be given system access, rather than every record automatically getting a login. On the first save with this set to Yes, see "Initial password, generated automatically" below |
| Login Email | Read-only, mirrors Email | N/A | Assumption: the login uses the same Email from Personal Details rather than a separate username field, to avoid two emails going out of sync |
| Set Role | Dropdown | Conditional — required if Create Login = Yes | Super Admin / Employee / Manager / Accountant / HR |
| Extra Permissions | List, with a "+ Add Permission Override" action | N | Shows any per-person permission overrides granted to this specific employee beyond what their Role normally allows (e.g. an early-access grant to a screen their role doesn't normally see). Visible to anyone with access to this tab; only Super Admin can add or remove an entry. Each override is picked from the same toggle list defined for this module in Section 6.3, applied to just this one person instead of their whole role |
| Account Status | Toggle (Enabled/Disabled) | Y | Defaults to Enabled once a login is created. **Built** as two explicit actions — Disable Login and Enable Login (the reversal was found missing by the Phase 2 audit and added, so a mistaken disable isn't permanent). **Disabling immediately ends every live session** — all of that user's refresh tokens are revoked in the same commit, not just their next login attempt blocked (see "How login sessions actually work" below) |
| Must Change Password on Next Login | Read-only, system-set | N/A | Yes immediately after a login is first created, or after Reset Password is used; automatically flips to No once the employee successfully sets their own password. Not directly editable — it's a byproduct of the two actions below, not something HR toggles by hand. **Built, and enforced server-side**: while the flag is set, every API route returns 403 except the change-password endpoint itself — a temporary password cannot be used as a normal credential (this gap was found by the security audit; the flag previously existed but nothing checked it) |
| Reset Password | Button, not a stored field | N/A | **Built.** Generates a new random temporary password, emails it to the employee's registered email (HR never sees it), sets Must Change Password on Next Login to Yes, **and revokes all of that user's refresh tokens** — a session minted under the old, possibly-compromised password cannot survive the reset. Matches the same generate-a-temporary-password pattern used for initial account creation, so there's one consistent mechanism |
| Last Login | Read-only, system field | N/A | **Built** — `last_login_at` is recorded on every successful login |

**Initial password, generated automatically — new in this revision, a real gap before now.** This document previously never actually said what happens the moment Create Login is switched on. Now it does: the system generates a random temporary password immediately, emails it to the employee's registered address as part of their welcome email, and sets Must Change Password on Next Login to Yes. HR never sees or relays the password itself — it goes straight to the employee, the same privacy principle already used for Reset Password.

**Forced change on first login:** logging in with a temporary password (whether from initial creation or a later Reset Password) takes the employee straight to the same Change Own Password form already built into My Profile (Section 2.3) — Current Password (the temporary one), New Password, Confirm New Password — before they can reach anything else in the system. Once saved, Must Change Password on Next Login flips to No and every future login goes straight through as normal. This reuses the existing self-service password screen rather than building a second one; the only difference is that the redirect here is mandatory, not something the employee navigates to themselves.

Turning off **Account Status** (disabling the account) shows a confirm-before-you-go prompt, since it immediately blocks that person from logging in. Turning off **Create Login** entirely (removing login access altogether, not just disabling it) shows a stronger confirmation, since it is a more significant change than a simple disable. **Build status:** Disable/Enable are built (`disable-login` / `enable-login`); a separate "remove the login record entirely" action is **deferred** — the backend deliberately has no user-deletion path (RESTRICT foreign keys everywhere), so disable is the strongest built action.

**How login sessions actually work — built in the Phase 7 hardening round, and a substantial change from earlier revisions of this document, which assumed a single long-lived login token:**

- **Two tokens, not one.** A successful login returns a short-lived **access token** (a 15-minute JWT) plus a **refresh token** (random 256-bit value, valid 30 days). The access token authenticates every API call; when it expires, `POST /auth/refresh` exchanges the refresh token for a fresh pair. Refresh tokens are **single-use** — each exchange revokes the old one in the same step (rotation), so a stolen-then-reused old token fails the very next time it's presented.
- **Refresh tokens are server-revocable.** Only a SHA-256 hash of each refresh token is stored (table `refresh_tokens`, migration 0008); the raw value is never recoverable from the database. This is what makes "end this person's sessions right now" real: **reset-password, change-password, HR's Disable Login, and the exit checklist's Disable Login step all revoke every refresh token for that user immediately** — the person is locked out within at most one access-token lifetime (15 minutes), not whenever an 8-hour token happens to expire.
- **`POST /auth/logout`** revokes the one session named by the presented refresh token ("log out this device"), without touching other sessions.
- **Password hashing is argon2id** (time_cost 3, 64 MiB, parallelism 4). Existing bcrypt hashes still verify (dual-algorithm detection) and are **lazily migrated**: the next successful login transparently rehashes to argon2id — the only moment the plaintext is available.
- **Password reuse is blocked** against the current password plus the **last 5** (a `password_history` table, trimmed at the service layer). Changing your own password also revokes all your refresh tokens.
- **Login brute-force protection:** a Redis fixed-window counter — **5 failed attempts per 15 minutes**, tracked on two independent keys per attempt: one per account (stops a botnet spreading guesses across source IPs) and one per source IP (stops one attacker spraying many accounts). A correct password resets the counters. Redis is best-effort: if it's unreachable, login proceeds unlimited (logged) rather than adding a second single point of failure.
- **Constant-time login:** the password verify always runs — against a real hash or a precomputed dummy argon2id hash for a nonexistent/disabled account — so response timing can't reveal whether an email exists (CWE-208, confirmed exploitable before this fix).
- **Delivery is bearer headers.** The other half of the original ARCH-2 design — HttpOnly/Secure/SameSite **cookie** delivery — is **explicitly deferred until the Angular frontend exists**; switching the delivery mechanism belongs with that frontend's auth-interceptor work.
- **No self-service "forgot password" exists.** There is deliberately **no** public reset-request endpoint; a person who has lost their password asks HR/Super Admin to use Reset Password on their record (which emails a temporary password). If a link-based self-service reset flow is ever wanted, it is a **deferred** future addition, and the seeded `password_reset` email template's `{{reset_link}}` placeholder is the call site to revisit.

#### Tab: Bank & Statutory

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Bank Name | Text | N | — |
| Bank Account Number | Text/Number | N | Numeric, checked for a plausible length |
| Confirm Bank Account Number | Text/Number | N | Assumption: added as a typo safeguard, matching the pattern used for Bank Account in the Masters module — must match Bank Account Number exactly; not stored separately |
| IFSC Code | Text | N | Exactly 11 characters, standard IFSC pattern (4 letters, then "0," then 6 alphanumeric characters) |
| PAN | Text | N | Exactly 10 characters, standard PAN pattern (5 letters, 4 digits, 1 letter — e.g. AAAAA9999A) |
| Aadhaar Number | Text | N | Assumption: added as a common Indian statutory identity field. 12 digits; displayed masked (e.g. XXXX-XXXX-1234) once saved |
| **Statutory Identifiers** | Auto-generated block — one field per tax head that needs one | N/A | **Reworked in this revision.** This tab used to carry three fixed fields: UAN (Universal Account Number), PF Account Number, and ESI Number. All three named a specific Indian statutory scheme and assumed it applied here. They're replaced by a block that renders one text field for every tax head in Masters → Taxes (Section 3.2) with "Requires an Employee Identifier" set to Yes, labelled with that head's own Employee Identifier Label. If no head needs one, the block doesn't appear |

**Why the three named ID fields went away:** they were the same assumption as the salary-structure rows, in a quieter place. A company not registered under those schemes would have had three permanently blank, permanently confusing fields on every employee record; a company registered under some *other* scheme would have had nowhere to put the number that actually matters. The block above handles both without this document naming a single scheme.

PAN and Aadhaar deliberately stayed as named fields rather than joining the block. They are general identity documents used across onboarding, document verification, and letters — not per-tax registration numbers — so they aren't contingent on any tax head existing.

**Build status:** the Statutory Identifiers block is built end-to-end — `GET /employees/{id}/statutory-identifiers` lists them and `PUT /employees/{id}/statutory-identifiers/{tax_head_id}` upserts one, snapshotting the head's label at capture time. (The Phase 2 audit found the table existed with zero API surface; that gap is closed.) An employee changing their own identifier goes through a Profile Change Request (Section 2.3) with `field_key = STATUTORY_IDENTIFIER` plus the target tax head — and an approved request is actually applied to the record (another dead branch the audit found and fixed).

This whole tab is where Payroll's statutory calculations will eventually pull from — the Employee module only stores and displays these values here.

#### Tab: Salary Structure

**Resolved: this tab is now where the salary structure itself is created and edited**, not just a link. This closes the ownership gap flagged in both this module and Payroll (Module 6, Section 5) — neither module owned creating a structure; this is the resolution. Super Admin enters and updates it directly on the employee's own record. Payroll (Module 6) reads from here; it doesn't own or edit it.

**A correction that took two passes to get right, worth recording in full rather than tidying away.** An early revision wrote actual rates into this document's prose ("PF auto-suggested as 12%," Professional Tax "state-specific... not hardcoded" without saying where). The next revision fixed that by pointing each rate at a dedicated Masters sub-master — PF & ESI Rates, Professional Tax Slabs, and so on. That was better, but it only moved the assumption: the *rates* stopped being hardcoded while the *taxes themselves* stayed hardcoded, as permanent named fields on this tab and permanent named sub-masters in Masters. This revision fixes the underlying problem — no tax is named here at all, because which taxes apply was never confirmed. See the Statutory Deductions & Contributions block below.

**Researched and extended in this revision — several standard components were genuinely missing, not just under-specified.** A closer look at how Indian private-sector salary structures are actually built turned up a regulatory rule and several common components this document didn't have. Added below, each flagged with what prompted it.

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Effective From | Date | Y | When this version of the structure starts applying. Cannot be in the future beyond the current financial year |
| Basic Salary (Monthly) | Number (INR) | Y | The core component; other components are commonly set as a proportion of this, though each is entered directly here, not auto-derived |
| Dearness Allowance — DA (Monthly) | Number (INR) | N | New in this revision — was missing entirely. Many private-sector IT companies set this to ₹0, but the field needs to exist: current wage-code rules (Code on Wages, 2019, enforcement phased in from late 2025) require Basic + DA to be at least 50% of total CTC, and that can't be validated if DA doesn't exist as a field. See the validation rule below |
| HRA — House Rent Allowance (Monthly) | Number (INR) | N | — |
| Leave Travel Allowance — LTA (Monthly or Annual) | Number (INR) | N | A standard component covering travel costs. Whether any part of it is tax-exempt is not decided here — that depends entirely on whether a declaration-scope tax head exists allowing it to be claimed (Masters, Section 3.2). Assumption: modeled as an amount the employee can choose to pay out monthly or accumulate and claim, similar in spirit to My Tax Declarations' proof-based claims — flagged as a design detail to confirm before build, since LTA exemption rules have specific conditions (actual journey, block-year restrictions) beyond what a simple monthly field captures |
| Special Allowance (Monthly) | Number (INR) | N | The flexible/balancing component |
| Variable / Performance Pay (Annual or Quarterly) | Number (INR) | N | New in this revision — a performance-linked component, common in private-sector structures and directly relevant to the "performance hike" scenario raised earlier in this project. Distinct from Structure Change History below: Structure Change History tracks revisions to *fixed* pay (a promotion, an annual hike to Basic/HRA/etc.); this field is the *variable* bonus component paid on top, not a change to the fixed structure itself |
| Other Earnings (Monthly) | Number (INR) | N | Any additional fixed monthly earning not covered above |
| **Statutory Deductions & Contributions** | Auto-generated block — one row per applicable tax head | N/A | **Completely reworked in this revision — see the explanation directly below this table.** Not a fixed set of fields. This block renders one row for every head in Masters → Taxes (Section 3.2) whose scope is Payroll — Employee Deduction or Payroll — Employer Contribution, and which is in force on the Effective From date and matches this employee's location, employment type, and tax scheme. Each row shows: the head's Print Label, whether it is employee-borne or company-borne, the calculated monthly amount, and — if the head allows per-employee opt-out — an Applicable toggle. If no such heads are configured, this block does not appear at all |
| Insurance — Employee Contribution (Monthly) | Read-only, pulled from Insurance & Benefits tab | N/A | If the employee is enrolled in a plan with an Employee Contribution amount (Masters, Section 3.19), it appears here as a deduction automatically. This is a benefit premium, not a tax, so it stays a named line rather than joining the block above |
| Gross Monthly | Read-only, computed | N/A | Basic + DA + HRA + LTA (if paid monthly) + Special Allowance + Other Earnings. Variable Pay is not included in Gross Monthly, since it's not a fixed monthly figure — it feeds Annual CTC and shows on whichever payslip it's actually paid out on |
| Net Monthly (before income tax) | Read-only, computed | N/A | Gross Monthly − every employee-borne statutory line in the block above that is currently applicable − Insurance Employee Contribution. Income tax itself is calculated separately, monthly, by Payroll (Module 6) — not shown or entered here |
| Annual CTC | Read-only, computed | N/A | (Gross Monthly × 12) + Variable/Performance Pay (annualized) + (every company-borne statutory line in the block above whose head has Include in Cost to Company set to Yes, × 12) + (Insurance Employer Contribution × 12, from the Insurance & Benefits tab) |

**The Statutory Deductions & Contributions block, explained — this is the biggest change in this revision, and it removes named fields rather than adding them.**

This tab used to carry eight fixed rows: PF Applicable, Employer PF Contribution, Employee PF Contribution, Employer Gratuity Accrual, ESI Applicable, ESI Employer Contribution, Employee ESI Contribution, Professional Tax Applicable, and Professional Tax. Every one of them named a specific Indian statutory item and assumed it applied to this company. **Nobody ever confirmed that it does.** Those rows are gone, replaced by one block that renders whatever Super Admin has actually configured in Masters → Taxes (Section 3.2).

What that means concretely:

- **If PF applies, it appears here** — because someone created a tax head for it, gave it a rate, a base, a ceiling, and an employee/company split. It shows as two rows (one employee-borne, one company-borne) exactly as before, with the same arithmetic. Nothing is lost.
- **If PF doesn't apply, nothing appears** — no greyed-out field, no "Not applicable" text, no row at all. The employee's structure is simply shorter.
- **If some entirely different levy applies** — one nobody involved in writing this document anticipated — it appears here the moment its head is created, with no change to this module, this document, or any code.
- **Rates, ceilings, thresholds, and cut-offs are never entered here and never appear in this document.** They belong to the head. This tab only ever displays the result of applying a head to this one person's pay.

**The per-employee Applicable toggle survives, generalized.** A head can be marked "Per-Employee Opt-Out Allowed" in Masters; heads that are get a toggle on this block, heads that aren't don't. That covers the real case the old fixed toggles existed for — coverage genuinely varying person to person because of wage level, work location, or a documented exemption — without deciding in advance which three components need it. **Editable by Super Admin or Accountant**, the one deliberate exception to "Salary Structure is Super Admin only to edit" (see the role note below): whether a statutory component applies to a given person is a compliance judgment call, not a compensation-setting one. The same decision then flows consistently into this month's payslip, every future payslip, and the Offer & Appointment Letter (Section 2.15), rather than being excluded by hand in three places.

**Location, employment type, and scheme filtering happen automatically.** A head restricted to certain office locations only appears for employees at those locations; one restricted to certain employment types only for those types. This replaces what used to be a state-slab lookup written specifically for Professional Tax — the mechanism is now general, and no module knows the name of any tax that uses it. **Deferred in the build:** the backend currently selects heads for a new structure by scope (Payroll deduction/contribution), active flag, and in-force date window only — per-head location/employment-type/scheme restrictions are not yet applied at generation time. The per-employee Applicable toggle is the built way to exclude a head that doesn't apply to one person.

**One consequence worth stating plainly:** on a fresh installation with no tax heads configured, an employee's Salary Structure shows earnings, Gross Monthly, Net Monthly, and Annual CTC with no statutory lines at all, and Net Monthly equals Gross Monthly. That is correct behaviour, not a broken screen — it accurately reflects a system that has not yet been told which taxes apply. The empty-state text on the block reads: "No statutory deductions or contributions are configured. Add them in Masters → Taxes."

**A validation rule — resolved and built:** Basic Salary + Dearness Allowance must be at least 50% of Annual CTC, per the Code on Wages, 2019 — the four Labour Codes were notified effective November 21, 2025, with enforcement phasing in through 2026. The "warn or hard block" question is answered in the build as **block-unless-overridden**: a non-compliant structure is rejected (422, stating the actual Basic+DA percentage) unless a `wage_code_override_reason` is supplied, in which case it saves with the override reason, who overrode, and when recorded on the structure, alongside stored `basic_plus_da_share_pct` and `is_wage_code_compliant` flags — an auditable exception, not a silent acceptance.

**The "company POV deductions" picture:** every statutory deduction and employer contribution this CMS applies is listed in Payroll's own audit table (Module 6, Section 5) — which is itself now generated from the configured tax heads rather than being a fixed list, for the same reason this block is.

**What wasn't added, and why — Employee Stock Options (ESOPs):** common at startups, and Meshrd is one, so this is worth flagging rather than silently skipping. ESOPs weren't added because their taxation is a materially bigger undertaking than any other component here — a perquisite tax event at exercise (valued at fair market value minus exercise price) and a separate capital gains event at sale, on top of vesting schedules that have nothing to do with monthly payroll at all. If Meshrd grants ESOPs, that's a deliberate future addition — probably its own small module (grant date, vesting schedule, exercise records) rather than a field on this tab — not something to fold in as an afterthought here.

**Structure Change History:** a read-only list below the current structure — Effective From, Effective To (blank if current), Basic Salary, Gross Monthly, Annual CTC, Changed By. Entering a new structure with a new Effective From date (a promotion, an annual hike, a correction) automatically closes out the previous one into this history rather than overwriting it — this is also what gives "salary & leave history" (flagged against Sheet1 earlier) a real, working answer on the salary side, not just Leave's.

**Build status for this tab:** built exactly as versioned-by-date revisions. `POST /employees/{id}/salary-structures` creates a new revision (a new Effective From must post-date the current one; the previous revision's Effective To auto-closes to the day before), `GET .../salary-structures` is the change history, `GET .../salary-structures/current` the live one. The statutory block is generated at save time from every in-force Payroll-scope tax head, each line snapshotting the head's name/label/rate/type so history stays truthful even after a head changes; Gross Monthly and annualised variable pay are stored generated columns in MySQL. One documented engine assumption, flagged in the code rather than silently decided: **every payroll deduction/contribution head is computed against Gross Monthly**, because the Taxes master deliberately carries no per-head "computed on" base field yet. The Applicable toggle is `PUT .../lines/{line_id}/applicability` (Super Admin or Accountant, per the role note below — the DB rejects the toggle on a head that doesn't allow per-employee opt-out), and flipping it recomputes the structure's stored totals. Insurance contributions flow in from active enrollments automatically, as described in the Insurance & Benefits tab.

**What Payroll reads from here:** every earning and deduction line above feeds directly into the monthly pay calculation (Payroll, Module 6, Section 2.1). Tax scheme choice and any declared amounts that reduce taxable income are handled separately, by the employee themselves — see My Tax Declarations (Section 2.14).

**Buttons:** Save, Cancel — part of the same Edit/Save flow as the rest of this record (HR/Super Admin — though see the Role Access note below: only Super Admin edits this specific tab, HR views it).

**A role note specific to this tab:** unlike the rest of the Employee Master Record, where HR has full edit rights, Salary Structure is **Super Admin only** to edit — HR remains view-only here, the same as Accountant. This is a deliberate tightening, not an oversight: compensation-setting is kept with Super Admin specifically, distinct from the rest of HR's onboarding/record-keeping authority. **One narrow exception:** Accountant also gets edit rights on the Applicable toggles inside the Statutory Deductions & Contributions block — however many of them there happen to be — and nothing else on this tab. The reasoning is that "does this statutory component apply to this person" is a compliance fact Accountant is often the one who actually knows, distinct from "how much does this person get paid," which stays with Super Admin. The underlying rates, slabs, ceilings, and thresholds are never edited here at all; they belong to the tax heads in Masters (Section 3.2), and this tab only ever shows the result of applying them to one person's pay.

#### Tab: Insurance & Benefits

**Resolves a gap flagged directly: company-provided insurance wasn't implemented anywhere.** This is distinct from My Tax Declarations (Section 2.14), where an employee may declare their *own* insurance premium — if a declaration-scope tax head exists that allows it. This tab is the opposite direction: Meshrd's own group insurance, offered as a benefit, enrolled into here. It is a benefit, not a tax, which is why it stays its own Masters sub-master rather than becoming a tax head.

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Insurance Plan | Dropdown (from Masters, Section 3.19), multi-select | N | An employee can be enrolled in more than one plan (e.g. both Health and Life) |
| Enrollment Date | Date | Conditional — required if a plan is selected | — |
| Dependents Covered (Health plans only) | Repeatable: Name, Relationship | N | Assumption — proposed as a simple list rather than a separate dependents master, since coverage is the only thing that depends on it |
| Nominee (Life/Accident plans only) | Name, Relationship, Phone | Conditional — required if enrolled in a Life or Personal Accident plan | A nominee is a standard requirement for these plan types |

**Who can open it:** HR and Super Admin can edit (enrolling or changing plans is an onboarding/HR-adjacent action, not a compensation-setting one — deliberately not restricted to Super Admin only, unlike Salary Structure). Employee sees their own enrollment read-only via My Profile.

**What this feeds:** the selected plan's Company Contribution and Employee Contribution (Masters, Section 3.19) flow automatically into the Salary Structure tab's Annual CTC and Net Monthly figures — nothing about the premium amount is entered twice.

**Empty state:** "Not enrolled in any insurance plan yet."

**Build status:** built — enroll (`POST /employees/{id}/insurance-enrollments`, snapshotting the plan's type, name, coverage, and both contribution amounts at enrollment time), add dependents/nominees, and end an enrollment. The conditional rules are enforced: dependents only on Health plans, nominees only on Life/Personal Accident plans, and **at least one nominee is required** to enroll in a Life or Personal Accident plan (found unenforced by the Phase 2 audit and fixed).

#### Tab: Emergency Contact

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Contact Name | Text | N | — |
| Relationship | Dropdown | N | Assumption — proposed options: Spouse / Parent / Sibling / Friend / Other |
| Contact Phone | Phone | N | 10-digit Indian mobile number |

#### Tab: Documents

Shows the same uploaded documents and verification statuses described in full in Section 2.6 (My Documents) — Document Type, File, Uploaded On, Status (Pending Verification / Verified / Rejected), and Rejection Reason if applicable. HR and Super Admin can Verify or Reject a document directly from this tab, exactly as they would from the HR Document Verification Queue in Section 2.6 — this tab is simply that same data, viewed from inside one employee's record instead of across everyone's pending documents.

This tab is distinct from the Offer & Appointment Letter generator (Section 2.15): that generator is HR producing an official letter; this tab is the employee's own uploaded paperwork. Both end up filed against the same employee record.

#### Tab: Assigned Assets (read-only)

Pulled from Asset Management. Shows a simple table: Asset Tag (e.g. AST-2026-0001), Asset Name/Type, Assigned Date, Condition. No add, edit, or reassign actions live here — those happen inside Asset Management itself.

#### Tab: Leave & Attendance Summary (read-only)

**Leave balance (this financial year):** a small table — Leave Type, Allowed, Carried Forward, Taken, Remaining — one row per Leave Type from Masters. Column names corrected to match the Leave module (Module 5).

**Attendance:** shows an **Attendance Method** selector with two options displayed side by side — **Manual Entry** (active) and **Biometric** (greyed out, tagged with a "Coming Soon" badge, not clickable). Below the selector, a recent log: Date, Day Type, Check-In Time, Check-Out Time, Break, Net Worked Hours, Day Status, Recorded By.

**Record Attendance records hours, not presence.** The form captures Check-In, Check-Out and the break, then derives everything that matters: Gross Hours, **Net Worked Hours** (Gross − Break), Required Hours for that date, the Balance, and the resulting **Day Status** — Full Day, Full Day (grace), Half Day or Absent. Every one of those derived figures comes from the **Work Week & Hours policy** covering that employee (Masters, Section 3.20), which is also what makes Day Type resolve correctly: a working Saturday asks for hours, an even Saturday and a Mandatory holiday ask for none. Nothing on this form is typed into a pay-affecting field by hand except the times themselves.

This matters because the day is not decided by whether someone turned up. Nine hours on site with a two-hour lunch is a shortfall, and the form shows that before it is saved, along with how the shortfall may be made up (see Leave, Module 5, Section 2.6).

> **Note:** Only the *biometric feed* is planned — the calculation above is live. The Biometric option is visible now but disabled, so it's clear on the roadmap without being usable yet. For now, only Super Admin can manually record an employee's check-in and check-out time, using a small "+ Record Attendance" action on this tab. The manual entry form and the future biometric feed write to the same underlying attendance record, so turning the Biometric option from "Coming Soon" to active changes only the **Recorded By** source — which is precisely why that field holds either a person or a device/system source rather than being a strict user reference — and requires no restructuring of this tab or of anything downstream in Payroll.

**Build status:** built. `POST /attendance` (RBAC action `record`, seeded to Super Admin only, exactly as above) resolves the Work Week policy covering that employee on that date, plus holidays and Saturday overrides, and derives Day Type, Required Hours, Gross/Net Worked Hours, Balance, and Day Status — nothing pay-affecting is typed in except the times. The record stores `source = MANUAL_ENTRY` and a flexible Recorded By label, ready for the biometric source later. One extra built behaviour beyond this spec: recording a day that is an **Approved compensatory make-up date** (Leave, Module 5, Section 2.6) auto-links the attendance record to that request and fills in its hours-worked/credited/residual-shortfall figures. `GET /attendance` lists with employee/date-range filters and `format=pdf|excel` export, scoped per role (own / direct reports / all). One genuinely open Attendance↔Leave interaction — crediting hours from an Approved leave request onto the same calendar date — is **deferred and flagged in the code** rather than silently invented, since this spec doesn't pin the rule down.

#### Buttons Summary for This Screen

- **Edit** (HR/Super Admin) — unlocks the editable tabs described above.
- **Save Changes / Cancel** (HR/Super Admin) — commits or discards edits.
- **Reset Password** (HR/Super Admin) — see Account & Login tab.
- **Verify / Reject** on each document (HR/Super Admin) — see Documents tab.
- **+ Record Attendance** (Super Admin only) — see Leave & Attendance Summary tab.
- **+ Add Permission Override** (Super Admin only) — see Account & Login tab.
- **Raise Exit / Mark Exited** (HR/Super Admin) — links into the Offboarding workflow, Section 2.13.


### 2.3 My Profile (Self-Service)

**What it's for:** The same employee record as Section 2.2, but opened by the logged-in person about themselves, with fields split by what they can and can't touch directly.

**Who can open it:** All 5 roles — Super Admin, Employee, Manager, Accountant, HR — since everyone is also a staff member with their own record. This screen always shows the logged-in person's own data only; it is never used to view or edit someone else's record (that's Section 2.2, restricted as described there).

**Note on a gap in the source notes:** the original brief places "Bank details" in the view-only, can't-touch bucket, but then separately describes "Bank Account change" as the example of the HR-approval-workflow bucket. Those two statements only make sense together if "view only, can't touch" means *can't edit directly* — i.e., Bank & Statutory fields aren't frozen, they just can't be changed without going through HR approval. That's how this section is written below. The same treatment is extended to Personal Details fields that weren't explicitly placed in any of the three buckets (First Name, Last Name, Email, Date of Birth, Gender) — since changes to these affect login, payslips, and statutory records, they're treated as approval-required rather than freely editable, unlike simple contact-preference fields like Phone and Address.

**Field groups:**

**View only — cannot be changed from this screen at all:**
- Employment Details (Department, Designation, Joining Date, Employment Type, Reporting Manager, Status)
- Salary Structure link
- Role (from Account & Login)

Changes to these need a direct HR action on the Employee Master Record (Section 2.2) — there is no request-a-change path for them from My Profile, since they usually involve a conversation with HR rather than a simple data correction.

**Editable directly — no approval needed:**
- Phone
- Emergency Contact (Name, Relationship, Phone)
- Photo
- Current Address

These fields have a normal Edit → Save flow, right on this screen.

**Editable, but needs HR approval:**
- All Bank & Statutory fields (Bank Name, Bank Account Number, IFSC Code, PAN, Aadhaar Number, UAN, PF Account Number, ESI Number)
- First Name, Last Name, Email, Date of Birth, Gender (Assumption, per the note above)

For these, instead of a direct Save, the button reads **"Request Change."** Clicking it opens a small form showing the current value and a field to enter the proposed new value, plus an optional note. Submitting creates a Pending Change Request (see the full step-by-step in Section 3.2). While a request is pending:
- The field shows a "Pending Approval" badge, and the old value stays in effect and keeps displaying.
- The employee cannot submit another change to the same field until the pending one is resolved.

**"My Change Requests" section:** a small list on this screen showing the employee's own past and pending requests — Field, Old Value, Requested Value, Status (Pending / Approved / Rejected), Date, and HR's reason if rejected. This lets the employee track what happened to a request without needing to ask HR directly.

**Change Own Password (gap found against Sheet1, now added):** every role — Employee, Manager, Accountant, HR, and Super Admin — can change their own login password from My Profile, regardless of what else they can or can't edit on their record. This is a plain security action, not part of the directly-editable or approval-required groups above: a small form (Current Password, New Password, Confirm New Password, all required) with its own Save button. This is separate from the **Reset Password** action on the Account & Login tab (2.2), which is HR/Super Admin resetting *someone else's* password — this one is a person changing their own. **Serves two purposes, as of this revision:** a person can open this voluntarily any time they want a new password, and it's also where a temporary password (from initial account creation or a Reset Password action, Section 2.2) gets replaced — in that second case, the person lands here automatically on their next login rather than choosing to visit it, and can't proceed to the rest of the system until it's done.

**Buttons:** Edit (for the directly-editable group), Save, Cancel, Request Change (for the approval group, per field), Cancel Request (on a still-pending request, to withdraw it), Change Password (opens the form above).

**Build status:** built — `GET/PUT /employees/me` (the PUT accepts only the directly-editable group), `POST /employees/me/change-requests` + `GET /employees/me/change-requests` (own history), and for HR/Super Admin `GET /employees/change-requests` (the pending queue, status-filterable) + `POST /employees/change-requests/{id}/decide` (approve applies the value to the record — including date parsing for Date of Birth — reject requires a reason; either way the employee gets an in-app notification and a templated email). The approval-required field list as built: First Name, Last Name, Email, Date of Birth, Gender, Bank Name, Bank Account Number, IFSC Code, PAN, Aadhaar, **and any Statutory Identifier** (with the target tax head named on the request — a wrinkle this section predates, since identifiers are now per-tax-head rather than fixed fields). A duplicate pending request for the same field is rejected by a DB constraint. The one thing above **not built** is **Cancel Request** — there is no withdraw endpoint for a still-pending change request; deferred until the frontend needs it. The Change Own Password form maps to `POST /auth/change-password`, with the reuse block (current + last 5) and revoke-all-sessions behaviour described in Section 2.2, and the forced-change redirect is enforced server-side (403 on everything else while the flag is set), not just a frontend redirect.

---

### 2.4 My Leave (Self-Service)

**What it's for:** The employee's own leave balance, history, and a way to apply for leave. Full leave rules, approval logic, and balance calculations belong to the Leave module — this screen only shows the employee-facing view of that data.

**Who can open it:** All 5 roles, for their own leave. Manager additionally sees a Team Leave Requests view for direct reports (described briefly below).

**Filters — added in this revision:** Leave Type (from Masters, multi-select), Status (Pending / Approved / Rejected / Cancelled — multi-select), Financial Year, and a From/To date range on the leave dates. On Manager's Team Leave Requests view, the same filters plus Employee. Search covers the reason/comment text. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). The Leave module (Module 5) owns the rules; this screen owns the employee-facing view of them, and its filters match the equivalent Leave module screens so the two never behave differently.

**Export:** "Export to PDF" and "Export to Excel" of the filtered leave history — the same data an employee is often asked to produce for a manager or during an exit process.

**Leave balance table:**

| Column | Notes |
|---|---|
| Leave Type | From Masters (e.g. Casual, Sick, Earned, WFH) |
| Allowed | This financial year's fresh quota |
| Carried Forward | Brought in from last financial year, calculated automatically at year-end — not something anyone types in (corrected to match the Leave module, Module 5 — this column was missing here previously) |
| Taken | Every Approved request for this type, whether the dates are in the past or still upcoming |
| Pending | Applied for, awaiting approval |
| Remaining | Allowed + Carried Forward − Taken − Pending |

**Leave history table:** Leave Type, From Date, To Date, Number of Days, Half-Day (Yes/No), Reason, Status (Pending / Approved / Rejected / Cancelled), Approved By, Applied On.

**"Apply for Leave" button** opens a short form:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Leave Type | Dropdown (from Masters) | Y | — |
| From Date | Date | Y | — |
| To Date | Date | Y | Must be on or after From Date |
| Half-Day | Toggle (Yes/No) | N | If Yes, a First Half / Second Half choice appears |
| Reason | Text area | Y | — |

**Validation — hard block on insufficient balance (corrected to match the Leave module, Module 5):** if the days requested exceed Remaining for that Leave Type, submission is blocked outright, with the exact shortfall shown (e.g. "You have 2 days remaining for Casual Leave, but requested 4") — there is no submit-anyway path. An earlier version of this document described this as a soft warning a Manager could override; that was wrong. The full rule, including the exact working-days calculation, lives in the Leave module. The system separately blocks a request that overlaps dates with an existing Pending or Approved leave.

Submitting routes the request to the right approver automatically. In the common case that's the employee's Reporting Manager (as set on their Employment Details), but the exact routing — including what happens if no Reporting Manager is set, or if the applicant themselves is a Manager/Accountant/HR person — is defined precisely in the Leave module (Module 5), not repeated here. A **Cancel** button is available on any of the employee's own still-Pending requests, to withdraw it before the approver acts.

**Manager's Team Leave Requests (brief mention):** on their own dashboard, a Manager sees a list of pending leave requests from direct reports — Employee Name, Leave Type, Dates, Reason, and that employee's Remaining balance for context — with Approve / Reject buttons. Full approval logic and edge cases belong to the Leave module.

**HR's leave access:** HR can also approve or reject **any** employee's leave request — not only when HR happens to be that person's Reporting Manager — and can view leave balances and history for every employee, company-wide. HR sees this as a company-wide version of the Team Leave Requests list above. The exact routing rule (including what happens with no Reporting Manager set, requests from a Manager/Accountant/HR applicant, and the Super Admin fallback) is defined precisely in the Leave module (Module 5, Section 2.2) — this is only a summary.

**Build status:** built in the Leave module's own routers (leave requests, balances, approvals, compensatory hours), which own the rules as this section says. Additionally built since this section was written: a set of **Leave Reports** (`/leave/reports/…` — balances summary, leave by department, leave by employee, and a leave-liability report), each with filters and `format=pdf|excel` export following the filters.

---

### 2.5 My Payslips (Employee View)

**What it's for:** Viewing and downloading payslips that have already been processed. Running payroll and calculating pay is documented separately, in the Payroll module — this screen is only about an employee viewing and downloading pay already processed.

**Who can open it:** All 5 roles, for their own payslips.

**List:** one row per month, showing Pay Period (Month-Year), Financial Year, Net Pay, Date Processed, and a **Download** button (PDF). Only already-processed months appear here; a month that hasn't been run yet in Payroll simply doesn't show a row.

**Filters:** Financial Year (or plain calendar year), Month range, Net Pay range, and Payslip Status (Processed / Reissued). Search covers Pay Period. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Expanded in this revision** — this screen previously had one filter. It is a list screen like any other, and an employee with several years of payslips needs to narrow them as much as anyone else does. There is no Employee filter here, since every row is already theirs (convention exception b.1); Super Admin's equivalent view does have one.

**Export:** "Export to PDF" and "Export to Excel" on the payslip list itself — the filtered set of pay periods with their totals. This is distinct from the per-payslip Download, which produces one formatted payslip document. Both exist; they answer different questions.

**Opening a payslip** shows the breakup: Earnings (e.g. Basic, HRA, Allowances — exact structure owned by Payroll), Deductions (one line per configured tax head that applied that month, plus any insurance contribution and unpaid-leave adjustment — exact structure owned by Payroll), and Net Pay. This module only displays whatever breakup Payroll has already calculated; it does not compute or edit any of it.

**Build status:** built in the Payroll module — `GET /payroll/payslips/me` (own list), `GET /payroll/payslips/me/{id}`, and the per-payslip PDF download; the admin-side list carries filters and export. Payroll's spec (Module 6) is the source of truth for the exact filter set and the Reissued status.

---

### 2.6 My Documents (Self-Service)

**What it's for:** Where an employee uploads their own personal paperwork (ID proof, certificates, and similar), and tracks whether HR has verified each one.

**Who can open it:** All 5 roles, for their own documents. HR (and Super Admin) additionally get a Document Verification Queue covering everyone — described below.

**Document list (employee's own):**

| Column | Notes |
|---|---|
| Document Type | ID Proof / Educational Certificate / Resume / Offer Letter Copy / Others |
| File Name | Uploaded file |
| Uploaded On | dd-mm-yyyy |
| Status | Pending Verification / Verified / Rejected |
| Rejection Reason | Shown only if Status = Rejected |
| Actions | View/Download; Delete (see rule below) |

**Filters:** Document Type, Status (Pending Verification / Verified / Rejected — multi-select), and Uploaded On date range. Search covers File Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). **Added in this revision** — this list previously had none.

**Export:** "Export to PDF" and "Export to Excel" of the filtered document list. Note this exports the *list* — type, status, dates — not the uploaded files themselves.

**"+ Upload Document" button** opens a small form:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Document Type | Dropdown | Y | ID Proof / Educational Certificate / Resume / Offer Letter Copy / Others |
| File | File upload | Y | Assumption: PDF, JPG, or PNG, up to 5 MB |
| Note | Text | N | Optional context, e.g. "Degree certificate, page 2 of 2" |

An employee can upload more than one file under the same Document Type (for example, multiple Educational Certificates). Every new upload starts at Status = Pending Verification.

**Delete rule:** an employee can delete their own document only while it is still Pending Verification. Once HR has Verified or Rejected it, only HR can remove it — this keeps a clean record of what was actually reviewed. Deleting a document shows a confirm-before-you-go prompt.

**HR Document Verification Queue (HR and Super Admin only):** a single queue across every employee's Pending Verification documents.

| Column | Notes |
|---|---|
| Employee Name | Links to that employee's record |
| Document Type | — |
| Uploaded On | — |
| File | View/Download |
| Actions | Verify / Reject |

**Filters:** Employee, Department (from Masters), Document Type, Status (defaults to Pending Verification, but Verified and Rejected can be included — multi-select), Uploaded On date range, and a "waiting more than N days" toggle for the queue's real purpose, which is finding what has been sitting too long. Search covers Employee Name and File Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Export:** "Export to PDF" and "Export to Excel" of the filtered queue.

Clicking **Verify** sets the document to Verified and notifies the employee. Clicking **Reject** requires a short reason (text, required) before it can be confirmed, sets the document to Rejected, and notifies the employee with that reason so they can correct and re-upload.

**Build status:** built — upload/list/delete against `/employees/{id}/documents` (self-scoped for Employee/Manager/Accountant; HR/Super Admin can act on anyone, and an HR upload is recorded with a distinct `HR_UPLOAD` source), the delete rule enforced exactly as written (an employee may withdraw only their own still-Pending upload; HR/Super Admin may always remove one), and `GET /documents/verification-queue` (Status filter, defaulting to Pending Verification, plus `format=pdf|excel` export). Verify/Reject (`POST /documents/{id}/verify`) enforces the required rejection reason and sends both the in-app notification and a templated email either way. **Deferred:** the queue's Employee/Department/Document Type filters and the "waiting more than N days" toggle — only the Status filter is built so far; and the employee's own list has no dedicated filter parameters yet (it is one person's short list).

**Distinct from the Offer & Appointment Letter generator (Section 2.15):** that tool is HR *generating* an official letter to give to the employee. This screen is the opposite direction — the employee *uploading* their own paperwork. Both are ultimately stored against the same employee record, just produced by different people through different processes.

**Empty state:** "No documents uploaded yet." with a prompt to upload the first one.

---

### 2.7 My Tickets

> **Sidebar location changed 2026-07-30.** This screen still belongs to this module and this spec section — only its position in the left-hand sidebar moved, from Employee to Ticket (Module 4), next to that module's own admin-facing screens. See RBAC, Module 14, Section 3 for the reasoning.

**What it's for:** Support tickets currently assigned to this employee to resolve. Full ticket rules, priority logic, and lifecycle belong to the Ticket module — this screen is the employee-facing view of tickets assigned to them.

**Who can open it:** All 5 roles, for tickets assigned to them. Manager additionally sees their team's ticket load (a count, not full detail).

**List:** Ticket Number, Subject, Requester, Priority (Low / Medium / High / Urgent), Status (Open / In Progress / Resolved / Closed), Assigned On, Due Date (if set).

**Filters:** Status (multi-select), Priority (multi-select), Category (from Masters), Requester, Assigned On date range, Due Date range, and an "Overdue only" toggle. Search covers Ticket Number and Subject. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). **Expanded in this revision** from the original two.

**Export:** "Export to PDF" and "Export to Excel" of the filtered set.

Opening a ticket lets the employee **reply** (add a comment/update) and **change status**. Assumption: from here, an employee can move a ticket between Open, In Progress, and Resolved; moving a ticket to Closed is reserved for whoever confirms resolution on the requester's side, per the full rules in the Ticket module.

**Manager's Team Ticket Load (brief mention):** a simple summary table — Employee Name, Open Count, In Progress Count, Total Assigned — for direct reports. No individual ticket detail here; that's opened from the Ticket module itself or by drilling into a specific person's My Tickets view.

**Empty state:** "No tickets assigned to you right now."

**Build status:** built — `GET /employees/me/tickets` with Status, Priority, Category, Requester, Due Date range, and Overdue-only filters exactly as above (Assigned On range and text search are **deferred**; the wider `/tickets` list carries search and export for admin roles). Reply and change-status act through the Ticket module's own endpoints. Manager's Team Ticket Load appears as the open-team-tickets count on the Dashboard's My Team strip (Section 2.10).

---

### 2.8 My Projects & Tasks

> **Sidebar location changed 2026-07-30.** This screen still belongs to this module and this spec section — only its position in the left-hand sidebar moved, from Employee to Project (Module 10), next to that module's own admin-facing screens. See RBAC, Module 14, Section 3 for the reasoning.

**What it's for:** Every project the employee is part of, and their own tasks/bugs across those projects. Full project rules — sprints, milestones logic, timesheet rules — belong to the Project module. This screen is the employee-facing view.

**Who can open it:** All 5 roles, for their own project involvement.

**My Projects list:** Project Name, Project Status (from the Project module), Their Role on the Project (if tracked).

**My Tasks & Bugs list:** Task/Bug ID, Title, Project, Status (To Do / In Progress / In Review / Done), Priority, Due Date.

**Filters, on both lists — added in this revision, since neither had any.** Projects: Project Status (multi-select), Service Category (from Masters), Customer, and a date range on project start. Tasks & Bugs: Project, Status (multi-select), Priority (multi-select), Type (Task / Bug), Due Date range, and an "Overdue only" toggle. Search covers Project Name on the first list, Task ID and Title on the second. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Export:** each list gets its own "Export to PDF" and "Export to Excel," exporting that list's filtered set.

Opening a task lets the employee **update its status** (limited to the four values above) and **add a comment**. They cannot delete a task or manage sprints — those stay admin/manager-only inside the Project module itself.

**Milestones and Timesheets:** both are planned features, shown as their own tabs on this screen with a "Coming Soon" badge in place of content, occupying the same layout position they'll eventually use, so the real feature can be dropped in later without reshaping this screen.

**Empty state:** "You're not assigned to any projects yet." / "No tasks assigned to you."

**Build status:** built — `GET /employees/me/tasks-and-bugs` returns one combined list of the caller's tasks and bugs, with Status and Type (task/bug) filters and `format=pdf|excel` export; task status updates and comments go through the Project module's endpoints, with delete/sprint management staying admin-side there as this section requires. **Deferred filters:** Project, Priority, Due Date range, Overdue-only, and the separate My Projects list's own filter set — the built surface covers the Tasks & Bugs half first.

---

### 2.9 My Assets

**What it's for:** Company assets currently assigned to the employee (laptop, ID card, and similar), and a way to flag a problem with one. Full asset rules belong to Asset Management — this screen is the employee-facing view.

**Who can open it:** All 5 roles, for assets assigned to them. Manager approves requests raised by direct reports (see below).

**List:** Asset Tag (e.g. AST-2026-0001), Asset Name/Type, Assigned Date, Condition. Read-only — an employee cannot add, edit, or reassign assets themselves; all of that stays inside Asset Management.

**Filters — added in this revision:** Category (from Masters), Condition, and Assigned Date range. Search covers Asset Tag and Asset Name. On the My Requests history below: Request Type, Status (multi-select), and Date Raised range. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Export:** "Export to PDF" and "Export to Excel" on both the asset list and the requests history — useful in its own right when an employee needs to confirm what they hold, at exit or during an audit.

**"Raise Repair / Damage / Return Request" button** opens a short form:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Asset | Dropdown (pre-filled if raised from a specific row) | Y | Must be one of the employee's currently assigned assets |
| Request Type | Dropdown | Y | Repair / Damage Report / Return |
| Description | Text area | Y | — |
| Photo | File upload | N | Assumption: useful for damage reports specifically, to show the issue |

Submitting routes the request to the employee's Reporting Manager for approval; Super Admin can also act on any request as an overseeing role.

**My Requests history:** a small list — Asset, Request Type, Date Raised, Status (Pending / Approved / Rejected / Completed) — so the employee can track what happened after they raised it.

**Empty state:** "No assets assigned to you yet."

**Build status:** built — `GET /employees/me/assets` (Category, Assigned Date range, and search filters), `GET /employees/me/asset-requests` (Request Type, Status, Date Raised range filters), and `POST /employees/me/asset-requests` to raise one; approve/reject live in the Asset module (`/asset-requests/{id}/approve|reject`), routed to the Reporting Manager per its rules. Purchase/current value columns are hidden from this screen for every role (a seeded field-level RBAC rule). Export on these two personal lists is **deferred** (the admin-side asset lists carry it).

---

### 2.10 Employee Dashboard

**What it's for:** The home screen a person lands on right after logging in — a quick snapshot of their own status plus fast links everywhere else.

**Who can open it:** All 5 roles. Manager's version adds a "My Team" strip.

**Widgets (everyone):**

| Widget | Shows |
|---|---|
| Leave balance snapshot | Mini version of the balance table from Section 2.4 |
| Latest payslip | Mini card — period and net pay, links to Section 2.5 |
| Open tickets count | Links to Section 2.7 |
| Pending tasks count | Links to Section 2.8 |
| Assigned assets count | Links to Section 2.9 |
| Company announcements | Mini feed, links to Section 2.11 |
| Recent activity feed | System-generated entries, e.g. "Leave approved," "New payslip available," "Document verified" |
| Quick links | Direct links to every self-service screen in Section 2 |

**Manager's "My Team" strip (additional):** Pending team leave requests (count, with a shortcut to approve), Team ticket load (mini summary from Section 2.6). **Team Payslips was removed from this module** (see the note at the end of Section 6.1) — a Manager gets no payslip-status widget for their reports; team-level pay visibility, if ever needed, belongs to Payroll's own Attendance & Time Basis or Payroll Register screens (Module 6), not this dashboard.

**Empty state:** any widget with nothing to show displays a light, friendly message instead of an empty box (e.g. "No open tickets — nice and clear," "No announcements right now").

**Build status:** built — `GET /employees/me/dashboard` returns every widget above in one response: the leave-balance snapshot, latest-payslip mini card, open-tickets / pending-tasks (tasks + bugs combined, matching Section 2.8's screen) / assigned-assets counts, an announcements mini feed scoped to All-Employees or the caller's department, the recent-activity feed (the caller's latest notifications), and the quick links. The Manager's My Team strip is additive in the same response — pending team leave requests count and open team tickets count — gated on the caller actually holding the Manager role.

---

### 2.11 Announcements / Notifications

**What it's for:** Two related but separate things — company-wide announcements posted by HR/Super Admin, and personal notifications generated automatically for each user.

**Who can open it:** All 5 roles see their own notifications and all published announcements. Posting a new announcement is HR and Super Admin only.

**Announcements:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Title | Text | Y | — |
| Message | Text area | Y | — |
| Post To | Dropdown | Y | Assumption: All Employees, or a specific Department |
| Expiry Date | Date | N | After which it stops showing on dashboards |

Posted announcements appear in the Announcements feed and on the Dashboard's mini feed for everyone in scope.

**Personal notifications** are generated automatically by events elsewhere in the system, including: leave approved/rejected, document verified/rejected, new payslip available, ticket assigned, task due soon, asset request approved/rejected, and profile change request approved/rejected.

**How they show up:** a bell icon in the header shows an unread count. Clicking it opens a panel listing notifications — type/icon, message, timestamp, and a read/unread dot. Clicking an individual notification marks it read and navigates to the relevant screen. A "Mark all as read" action clears the unread count without navigating away. The panel separates Announcements from My Notifications (two tabs, or two clearly labeled sections).

**Filters — added in this revision, on the full-page view of both lists** (the header dropdown panel stays a simple recent list; filtering a notification popover would be over-built). Notifications: Type (leave / document / payslip / ticket / task / asset / profile change — multi-select), Read/Unread, and a date range. Announcements: Posted By, Post To scope, Active/Expired, and a Posted On date range. Search covers message and title text on both. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Export:** available on the Announcements list — a filtered record of what was communicated to whom and when, which HR is periodically asked to produce. Personal notifications are deliberately **not** exportable: they're transient per-user UI state, not a business record, and the underlying events are already exportable from the modules that generated them. Flagged as a judgment call rather than an omission.

**Empty state:** "No notifications yet." / "No announcements right now."

**Build status:** built, with one lifecycle detail this section didn't previously spell out — an announcement has a **Draft → Published → Archived** status: it's created as a draft (title, message, All Employees or specific departments, optional expiry), then explicitly published (which stamps the publish time; a department-scoped one must have at least one target department), and can later be archived. Non-posting roles see Published announcements only. Export (`format=pdf|excel`) is built on the announcements list; the Posted By / scope / Active-Expired / date-range **filters are deferred**. Personal notifications are built exactly as described: list (with unread-only and limit), unread count for the bell badge, mark-one-read (the read timestamp is stamped by a DB trigger), and mark-all-read — no RBAC screen gate, since it's each account's own feed, and deliberately no export. Notification rows are generated by the built events: leave approved/rejected, document verified/rejected, profile change decided, ticket assigned, asset request decided, payslip published, welcome email, and announcements.

---

### 2.12 Onboarding Checklist (HR-Facing)

**What it's for:** Guides HR through everything that needs to happen when someone new joins, as a simple checklist tied to that employee's record.

**Who can open it:** HR and Super Admin.

**Steps (shown as a checklist, most auto-checked when the linked action is completed elsewhere):**

1. **Create Employee Master record** — Personal Details + Employment Details filled in and saved (Section 2.2). Auto-checks on save.
2. **Create login (optional)** — the Create Login toggle switched on in the Account & Login tab. Auto-checks when turned on; can also be explicitly skipped if this employee shouldn't get system access yet.
3. **Assign a Reporting Manager** — set on Employment Details. Auto-checks once a manager is selected; shown as an open reminder if left blank.
4. **Set up this year's leave balance** — automatic. Once the record is saved as Active within a financial year, the system allocates the Default Annual Quota for every Active Leave Type from Masters. Assumption: this is prorated based on the Joining Date rather than granting a full year's quota to someone who joined mid-year. Shown on the checklist purely as a confirmation, since no manual step is needed.
5. **Link a Salary Structure** — set on the Salary Structure tab (or flagged for Payroll to complete). Auto-checks once a structure is linked.
6. **Assign starter assets** — done inside Asset Management (laptop, ID card, etc.); this step is a pointer/reminder into that module, and auto-checks once Asset Management confirms an assignment for this employee.
7. **Send welcome email** — a "Send Welcome Email" button that notifies the new employee (email + in-app notification) with a short checklist pointing them to My Documents (Section 2.6) so they know what to upload. Manual trigger, checked off once sent.

**Empty/complete state:** once all 7 steps are checked, the checklist shows a simple "Onboarding complete" confirmation and collapses out of HR's default to-do view (still viewable if opened directly).

**Build status:** built. The 7 steps are seeded automatically by a database trigger the moment an employee record is created, and the auto-check wiring is real: creating the record checks step 1, assigning a Reporting Manager checks step 3, turning on Create Login checks step 2, and the leave-balance step confirms the automatic prorated allocation (which happens at record-save, per Workflow 3.1 — found missing by the Phase 2 audit and fixed there). `GET /employees/{id}/onboarding` lists the checklist; steps can be explicitly completed (with a note) or **skipped with a required reason** — the skip path is built for the "shouldn't get system access yet" case this section describes. Send Welcome Email is a real templated email plus an in-app notification, one-shot (a second send 409s).

**HR's cross-employee onboarding view — deferred.** The checklist above is per-employee; HR also needs to see everyone currently mid-onboarding at once, which this module didn't previously provide. A list screen: Employee Name, Joining Date, Department, Steps Completed (e.g. "4 of 7"), Oldest Incomplete Step, Days Since Joining. Filters: Department, Joining Date range, Completion status (Not Started / In Progress / Complete), and a specific "stuck on step" filter. Search covers Employee Name. Plus the baseline set and export, per the Filter & Export Convention (RBAC, Module 14, Section 2.2). **Not yet built** — no cross-employee onboarding list endpoint exists; the per-employee checklist is queried record by record. Kept in scope for the frontend phase.

---

### 2.13 Offboarding / Exit

**What it's for:** Two halves of the same process — an employee raising a resignation, and HR working through everything that needs to happen before that person's access ends.

**Who can open it:** Any of the 5 roles can raise their own resignation, from My Profile. Manager acknowledges/approves for direct reports. HR and Super Admin run the exit checklist for anyone.

**Employee side — "Raise Resignation":**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Last Working Day | Date | Y | Must be after today |
| Reason | Text area | N | — |

Submitting sends the request to the employee's Reporting Manager for acknowledgment. Once acknowledged, HR is notified and the exit checklist below becomes active for that employee.

**HR-facing Exit Checklist (per employee). The order below is a rule, not a suggested sequence — each step is locked until the step it depends on is Done.**

1. **Generate the resignation acceptance letter** — HR generates it once the Reporting Manager has acknowledged the resignation, using the letter screen (Section 2.14). Nothing else on this checklist can be actioned until it exists.
2. **Return all assigned assets** — linked to Asset Management (Module 3, Section 2.8, "Reclaim on Exit"). Checks off only once **every** asset previously assigned to this employee shows Returned or Retired. Locked until step 1 is done.
3. **Mark final settlement due** — a flag/placeholder linked to Payroll/Expense; the actual calculation happens in those modules, this just records that a final settlement is owed and tracks whether it's been marked paid. Locked until step 2 is done.
4. **Disable login** — toggles Account Status off on the Account & Login tab (Section 2.2). Locked until step 2 is done.
5. **Change status to Exited** — updates the Status field on Employment Details to "Exited" and records an Exit Date, defaulting to the Last Working Day stated on the letter. Locked until step 2 is done.

**Why assets come after the letter, and everything else after the assets.** Both orderings were added 2026-07-31 and each fixes a real failure.

*Letter before assets.* The letter is what fixes the Last Working Day. Asking someone to hand back their laptop before their leaving date is agreed is both premature and unenforceable — there is no agreed date to hand it back *by*. Once the letter exists, the return deadline is a stated fact rather than a negotiation, and the asset step has something concrete to count back from.

*Assets before settlement, login and status.* Every remaining step reduces the company's leverage. After the final settlement is marked, there is no money left to recover an unreturned laptop from; after the login is disabled, the employee cannot be reached through the system at all; after the status is Exited, they are no longer an employee anyone is chasing. Unreturned equipment is the single thing that most often goes wrong at exit, and it goes wrong precisely because those three steps get done first while asset return is left "to follow up on." Locking them behind a complete asset return makes that sequence impossible rather than merely discouraged.

**No partial exit.** There is no "returned most of them" state. The asset step completes only when the outstanding count is zero — an asset written off as lost must be explicitly marked Retired in Asset Management, by someone with the rights to do that, which is a deliberate decision with a name against it rather than a checklist item quietly ticked.

Disabling the login and changing status to Exited are both irreversible-feeling actions and show a confirm-before-you-go prompt. Once complete, the employee can no longer log in, but their historical records — payslips, tickets, project history, documents — remain intact and viewable by HR, Accountant, and Super Admin for reference.

**Build status — the gating is a real database trigger, not an application convention.** The five steps above are seeded LOCKED by a DB trigger when a resignation is raised, and a second trigger (`trg_ecs_enforce_gate`) refuses to mark any step Done while the step it depends on isn't — including refusing the letter step without a linked, generated acceptance letter, and refusing the asset step while `outstanding_asset_count > 0`. Cascade-unlock (opening the next step when one completes) is app-layer, since MySQL forbids a trigger updating sibling rows. The specifics, all built:

- **Resignation lifecycle:** Submitted → Manager Acknowledged → HR Processing → Completed, with a **Withdraw** action (not previously in this section) available to the applicant or HR/Super Admin while it's still open — withdrawing flips an On Notice employee back to Active. Manager acknowledgment is only *required* when the employee actually has a Reporting Manager, and HR's start-processing works from either Submitted or Acknowledged — the built equivalent of the "Require Manager Acknowledgment" toggle in Section 6.3.
- **Own/team scoping (an IDOR fix from the Phase 2 audit):** raising a resignation is strictly self-only for Employee *and* Manager roles (a Manager's team scope on this screen exists for acknowledging, not for raising on a report's behalf — previously a Manager could raise one against any employee id); HR/Super Admin may record one on someone's behalf. Listing an employee's resignations and viewing an exit checklist both pass through the same scope assertion as every other single-record endpoint.
- **The letter** is generated through the Offer & Appointment Letter engine (Section 2.15) as a third letter type, `RESIGNATION_ACCEPTANCE_LETTER`, which requires the resignation id and Last Working Day, produces a stored PDF, and links itself onto the checklist's step 1 — satisfying the trigger's precondition.
- **Assets are synced live from the Asset module:** every Assign / Transfer / Unassign / Reclaim recalculates the step's outstanding-asset count, and the step **auto-completes the instant the count reaches zero while it's open** (there is no manual Complete for this step — including immediately, for an employee who held nothing). The zero-asset case and the "count can never be quietly skipped" rule both hold at the DB layer.
- **Disable Login (step 4)** disables the account *and revokes all refresh tokens* — sessions end at once, per Section 2.2. **Mark Exited (step 5)** is two calls by design: a DB trigger guards the employment-status flip (it must find the step OPEN), then completing the step closes the resignation as Completed. **Mark final settlement due (step 3)** flags the resignation `DUE`, with a separate mark-settlement-paid action for later.

**HR's cross-employee exit view — partially built.** `GET /resignations` lists every resignation the caller may see (scoped: own / direct reports / all) with `format=pdf|excel` export of exactly that set — Employee, Status, Last Working Day, Submitted, Acknowledgment, Settlement Status, Completed. The screen-specific **filters are deferred** (Department, Last Working Day range, acknowledgment/completion status, and the "assets still outstanding" toggle — the one most likely to be used, since unreturned equipment is what actually goes wrong at exit); assets-outstanding and steps-completed columns live on the per-resignation checklist for now.

---

### 2.14 My Tax Declarations (Self-Service)

> **Sidebar location changed 2026-07-30.** This screen still belongs to this module and this spec section — only its position in the left-hand sidebar moved, into the merged "Leave & Payroll" tab (Modules 5 & 6), since it feeds directly into Payroll's income-tax calculation. See RBAC, Module 14, Section 3 for the reasoning.

**What it's for:** Each financial year, an employee declares the amounts that reduce their taxable income — so Payroll (Module 6) can calculate accurate monthly income tax instead of over- or under-deducting all year and leaving a large correction at filing time.

**Completely rebuilt in this revision — this screen no longer knows what any deduction is called.** It used to be a fixed form: a Tax Regime dropdown with two named options, then five named fields (HRA exemption with a Metro/Non-Metro choice, Section 80C, Section 24 home loan interest, Section 80D health insurance, plus a catch-all), each validated against a cap in a Masters sub-master built specifically to hold those caps. Every one of those names assumed a tax system nobody has confirmed applies here. The screen is now generated entirely from Masters → Taxes (Section 3.2).

**Who can open it:** All 5 roles, for their own declaration only — part of the same baseline every self-service screen in this module follows. HR and Super Admin can view (not edit) any employee's declaration, for verification purposes (see below).

**Scheme selection — shown only if tax schemes exist:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Financial Year | Read-only, auto-set | N/A | The current financial year this declaration applies to |
| Tax Scheme | Dropdown (from Masters → Taxes → Tax Schemes, Section 3.2d) | Conditional | **Only appears if at least one scheme has been configured.** If none exist, the employee sees no scheme choice at all and the screen goes straight to the declaration fields. If schemes exist, this defaults to whichever is marked Is Default, and when the employee may change it is governed by that scheme's own Choice Window setting, not by a rule written here. Each scheme's Description is shown beneath the dropdown so the employee understands what they're choosing between |

**Declaration fields — one per configured declaration head:**

The form renders one row for every tax head in Masters with scope **Employee Declaration / Exemption** that is in force for this financial year and — if schemes are in use — permitted under the scheme this employee selected. Each row carries:

| Column | Source | Notes |
|---|---|---|
| Declaration Name | The head's Tax Name | Whatever Super Admin called it |
| Guidance | The head's Description | Shown as helper text under the field, so the employee knows what qualifies without asking HR |
| Amount Declared (₹) | Employee enters | Validated against the head's Maximum Amount per Period, if one is set. Exceeding it shows the cap inline and blocks Submit rather than silently trimming the figure |
| Proof Upload | File upload (multiple) | **Mandatory if the head has Requires Proof / Reference set to Yes**, optional otherwise. PDF/JPG/PNG, up to 5 MB each, matching the file-size convention used elsewhere in this CMS |

**Where the old HRA Metro/Non-Metro choice went.** That was a two-option dropdown feeding a percentage lookup, built for one exemption in one country. A head that needs a location-dependent figure now uses the general mechanism instead: separate heads restricted by Applicable Locations, each with its own rate. The employee's own office location decides which one they see, and they aren't asked to self-classify their city at all — which is also less error-prone than it was.

**The catch-all survived, and is now the only field on this screen with a fixed name:** an "Other Declared Deduction" row (Amount + Description + optional proof) that appears regardless of configuration. It exists because an employee may legitimately have something to declare that Super Admin hasn't set up a head for yet, and losing that figure until the next configuration change would be worse than accepting it with a description. It is flagged for HR/Accountant attention during verification rather than being fed into the tax calculation automatically — Assumption, and a deliberately conservative one: an uncategorized amount shouldn't silently reduce someone's tax when no head has said it may.

**Declaration Status:** Draft (employee still editing, not yet used in the tax calculation) → Submitted (locked for the financial year, used in Payroll's calculation from the next run onward) → Verified (HR or Accountant has checked the uploaded proofs match the declared amounts). Assumption: the calculation uses the Submitted figures throughout the year regardless of Verified status, since real-time proof-checking on every submission isn't practical — Verified is for HR/Accountant's own audit trail and a possible year-end reconciliation, not a blocking gate on Payroll.

**Buttons:** Save as Draft, Submit (locks it for the financial year), Cancel.

**Build status:** built end-to-end — tax scheme elections (versioned per financial year: a re-election supersedes the previous one rather than editing it), declaration creation with **lines auto-populated from every in-force Employee Declaration-scope tax head plus the fixed "Other" catch-all line**, per-line amount edits validated against the head's cap, per-line proof uploads, Submit (locks the declaration), and verification — both **per-line** verify/reject and a whole-declaration Verified marker. The access split is enforced precisely as this section words it: editing/submitting is self-only (Super Admin alone holds a `manage` action reaching any employee's declaration), while HR and Accountant hold `verify`, which unlocks **viewing** any declaration and recording verification but **not** editing declared amounts — the Phase 2 audit found and fixed a bug where `verify` accidentally granted edit reach too.

**Empty states — two distinct ones, and the difference matters:**

- No declaration heads configured at all: "There are no declarations to make. Your employer has not configured any deductions that reduce taxable income." The screen shows nothing else. It does not show an empty form, and it does not error.
- Heads exist but this employee hasn't declared: "No tax declaration submitted yet for this financial year."

**Connects to Payroll (Module 6):** the income tax calculation reads this employee's selected scheme (if any) and their Submitted declared amounts, and subtracts each one whose head has Reduces Taxable Income set to Yes, before applying whatever income-tax-scope heads are in force. See Payroll's own Section 2.1 for the full method. This is the other half of the tax work described in the Salary Structure tab (Section 2.2).

---

### 2.15 Offer & Appointment Letter (HR-Facing)

**What it's for — a real gap, closed in this revision.** Two earlier sections (2.6 and 2.8) referenced "the separate Offer & Appointment Letter generator that lives elsewhere in the system" without ever specifying where — and there's no standalone Documents module in this CMS's current 14-module structure for it to live in. This is that home: the official Offer Letter or Appointment Letter for a new hire is generated here, inside the Employee module.

**Who can open it:** Accountant, Super Admin. (Corrected 2026-08-03 — this line previously said "HR, Super Admin," contradicting this document's own access table in Section 6.1, which has always given this screen to Accountant with HR at No access. The build follows the access table; the seeded policy even carries a "Not a typo: HR does not get this screen" comment.)

**Where it's triggered from:** a "Generate Letter" action on an Employee record — usable even before that record is fully Active, since an offer typically goes out before someone officially joins.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Employee | Read-only, pre-filled from the record this was opened against | N/A | — |
| Letter Type | Dropdown — Offer Letter / Appointment Letter | Y | — |
| Designation, Department, Joining Date, Employment Type | Read-only, pulled from Employment Details (2.2) | N/A | — |
| Compensation Summary | Read-only, pulled from Salary Structure (2.2) | N/A | Basic, HRA, and other standard components, plus Annual CTC — shown in the letter as the standard compensation breakup |
| Statutory Components Disclosed | Read-only, pulled from the Statutory Deductions & Contributions block on Salary Structure (2.2) | N/A | The letter lists whichever statutory heads will actually apply to this person — by the name Super Admin gave each one in Masters — matching exactly what the Salary Structure tab shows, so an employee never receives a letter promising something different from what their payslip later shows. If no statutory heads apply, this section is omitted from the letter entirely rather than printing an empty heading |
| Custom Terms | Repeatable: Label, Type (Addition/Subtraction), Amount, Recurring (Yes/No) | N | New in this revision, and the direct answer to wanting dynamic fields at appointment stage too — a signing bonus, a relocation allowance, a probation-period adjustment, anything specific to this one hire's negotiation that doesn't belong on the standard Salary Structure. Uses the same field shape as Ad-hoc Payslip Adjustments (Payroll module, Section 2.1a) on purpose |

**What happens to Custom Terms on save:** each one is queued as an Ad-hoc Payslip Adjustment (Payroll, Section 2.1a) against this employee, effective from their Joining Date, automatically — not a manual "remember to add this later" step anymore. If the employee's record isn't Active yet, the adjustment sits queued and picks up automatically the first time payroll runs for them after joining. **Deferred — not yet wired in the build:** the custom-term table carries the queued-adjustment link columns, but generating a letter does not yet create the Ad-hoc Adjustment; until it does, a negotiated term must also be entered manually in Payroll (Section 2.1a), which is exactly the double-entry this paragraph was written to eliminate — flagged for a follow-up rather than quietly dropped.

**Buttons:** Preview, Generate PDF, Send to Employee (email with the letter attached — Assumption: requires the same explicit-permission pattern as any other outbound message in this CMS).

**Build status:** built. A letter is created as a Draft against the employee (`POST /employees/{id}/offer-letters`) with its own letter number (LTR-\<FY\>-\<seq\>) and snapshots of designation, department, employment type, joining date, and — when linked to a Salary Structure — Basic, HRA, Gross Monthly, and Annual CTC, plus that structure's **applicable** statutory lines by their configured print labels, exactly as the field table above requires (omitted entirely when none apply). Custom terms attach while it's still Draft (locked once generated, by DB constraint). **Generate** (`/offer-letters/{id}/generate`) renders and stores the PDF; **Send** (`/offer-letters/{id}/send`) is the genuinely separate second action — it emails the letter **with the generated PDF attached** (to the employee's email, or an override address for a pre-joining candidate) and records sent-at/by/to plus the email log. A third letter type, the Resignation Acceptance Letter, runs through this same engine for the exit checklist (Section 2.13). Preview as a distinct pre-generate render is a frontend concern.

**A pending-adjustments summary, visible on the Employee Master Record itself (2.2):** so anyone reviewing a record — HR checking before an appointment letter goes out, Accountant preparing a payroll run — can see at a glance whether anything is currently queued for that person, without needing to go find it in Payroll. Read-only here; managed in full at Payroll, Section 2.1a.

**Empty state:** "No letter generated yet for this employee."

---

## 3. Workflows

### 3.1 New Employee Onboarding, Start to Finish

1. HR opens the Employee Directory (2.1) and clicks **+ Add Employee**.
2. HR fills in Personal Details and Employment Details and saves. The system auto-generates the Employee ID (e.g. EMP-2026-0001).
3. If this person should have system access, HR opens the Account & Login tab, turns on Create Login, and sets their Role.
4. HR sets a Reporting Manager on Employment Details, if not already set in step 2.
5. The system automatically allocates this financial year's leave balance for every Active Leave Type, prorated from the Joining Date — no manual step needed.
6. HR links a Salary Structure on the Salary Structure tab (or leaves a note for Payroll to complete this).
7. HR or Super Admin assigns starter assets (laptop, ID card, etc.) inside Asset Management, against this employee.
8. HR clicks **Send Welcome Email** on the Onboarding Checklist (2.12). The new employee receives an email and in-app notification with a document checklist.
9. The new employee logs in for the first time, lands on their Dashboard (2.10), and uploads their paperwork through My Documents (2.6).
10. HR verifies each document as it comes in (see Workflow 3.3).
11. Once every step is checked, the Onboarding Checklist (2.12) shows "Onboarding complete."

### 3.2 Profile Change Request → HR Approval

1. The employee opens My Profile (2.3) and finds a field in the approval-required group (e.g. Bank Account Number).
2. They click **Request Change**, enter the new value and an optional note, and submit.
3. The system creates a Pending Change Request tied to that employee, that field, the old value, and the requested new value. The field shows a "Pending Approval" badge; the old value stays in effect.
4. The request appears in HR's Pending Change Requests queue.
5. HR opens it, reviews the old value against the requested value, and either:
   - **Approves** — the Employee Master Record updates to the new value, and the employee is notified.
   - **Rejects** — the value stays as it was, and the employee is notified along with HR's reason.
6. Either way, the request moves out of the pending queue and into the employee's own "My Change Requests" history (2.3), where they can see the outcome.

### 3.3 Document Upload → HR Verification

1. The employee opens My Documents (2.6) and clicks **+ Upload Document**.
2. They choose a Document Type, attach a File, optionally add a Note, and submit.
3. The document appears in the employee's own list at Status = Pending Verification, and simultaneously appears in HR's Document Verification Queue.
4. HR opens the queue, views or downloads the file, and clicks **Verify** or **Reject** (entering a reason if rejecting).
5. The employee's document status updates to Verified or Rejected, and they receive a notification either way.
6. If Rejected, the employee can delete the document (allowed while Pending, but a Rejected one needs HR to remove it — see the delete rule in 2.6) and upload a corrected version, restarting the cycle.

### 3.4 Resignation → Exit Checklist → Account Disabled

1. The employee opens My Profile and selects **Raise Resignation**, entering their Last Working Day and an optional Reason.
2. The request goes to their Reporting Manager, who reviews and acknowledges it.
3. Once acknowledged, HR is notified and the Exit Checklist (2.13) activates for that employee. Only the first step is open; the rest are locked.
4. HR generates the **resignation acceptance letter** (2.14), which fixes the Last Working Day. This unlocks asset return.
5. HR works through **Reclaim on Exit** (Asset Management, Module 3, Section 2.8) until the employee's outstanding asset count reaches zero. Anything genuinely lost is explicitly marked Retired there — it is never quietly skipped. Completing this unlocks the three remaining steps.
6. HR flags the final settlement as due (for Payroll/Expense to process later) and disables the employee's login. Because assets are already back, neither step can strand unreturned equipment behind a closed settlement or an unreachable account.
7. On or after the Last Working Day, HR changes the Employment Status to "Exited" and the Exit Date is recorded.
8. The employee can no longer log in. Their historical payslips, tickets, project history, and documents remain intact and viewable by HR, Accountant, and Super Admin.

### 3.5 Generating an Appointment Letter With a Custom Term

1. HR opens a new (or not-yet-Active) Employee record and clicks **Generate Letter** (2.15).
2. Compensation and statutory-applicability details pull in automatically from Salary Structure (2.2). HR adds any Custom Terms — e.g. a signing bonus negotiated at offer stage — with a Label, Amount, and Type.
3. On save, each Custom Term is queued automatically as an Ad-hoc Payslip Adjustment (Payroll module, Section 2.1a) against this employee, effective from their Joining Date — no separate manual step in Payroll needed.
4. HR generates the PDF and sends it to the candidate.
5. Once the employee joins and their record goes Active, the queued adjustment is picked up the first time payroll runs for them, and shows on their payslip with the same Label used on the letter.

### 3.6 New Login Created → Temporary Password → Forced Change on First Login

1. HR turns on Create Login (2.2) for an employee and sets their Role.
2. The system generates a random temporary password immediately and emails it to the employee's registered address, as part of their welcome email. Must Change Password on Next Login is set to Yes. HR never sees the password itself.
3. The employee logs in using the temporary password.
4. Instead of reaching the normal dashboard, they're taken straight to the Change Own Password form (My Profile, Section 2.3) and must set a new password before doing anything else.
5. Once saved, Must Change Password on Next Login flips to No, and every login after this one goes straight through as normal — though the employee can still voluntarily change their password again any time from the same screen.

This exact same flow (temporary password → forced change on next login) also runs whenever HR or Super Admin uses Reset Password (2.2) later — a lost or compromised password is handled identically to a brand-new account, rather than as a separate mechanism.

---

## 4. UI/UX Notes

- **Table view** for admin-facing lists — Employee Directory (2.1), HR Document Verification Queue (2.6) — with search, filters, sort, and pagination as described in each screen.
- **Card / dashboard style** for self-service screens — My Profile, My Leave, My Payslips, My Documents, My Tickets, My Projects & Tasks, My Assets, and the Dashboard itself — favoring summary cards and short lists over dense tables.
- **Empty states**, matching the tone used throughout this document: "No employees added yet," "No documents uploaded yet," "No assets assigned to you yet," "No tickets assigned to you right now," "You're not assigned to any projects yet," "No notifications yet."
- **Confirm-before-you-go prompts** for anything that can't be casually undone: disabling a login, removing login access entirely, deleting a Pending document, rejecting a document or a change request (since a reason has to be entered), and the two irreversible-feeling exit actions (disable login, mark Exited).
- **Mobile-friendly by default** for every self-service screen — employees will often check their leave balance or download a payslip from their phone, so My Leave, My Payslips, My Documents, My Tickets, My Assets, and the Dashboard should all lay out cleanly on a small screen, not just be a shrunk version of the desktop table view.

## 5. Connected To / Depends on Masters

Connected To: User Login & RBAC, Leave, Payroll, Project, Ticket, Asset Management, Documents (offer letters)

Depends on Masters: Department, Designation, Employment Type, Leave Types, Financial Year, Salary Structure, Company Profile, Taxes (Section 3.2 — every statutory line on Salary Structure, every field on My Tax Declarations, and every per-employee statutory identifier), Insurance Plans, **Email Configuration (Section 3.21, added 2026-07-31 — the server every welcome email, temporary password, offer/appointment letter, document-verification outcome, profile-change outcome and resignation acceptance letter actually sends through, and the template list each one's subject/body/on-off state is edited from)**

Note: **Both resolved.** Employment Type is now Masters sub-master Section 3.18 (Module 1) — the field above has been updated to source from it. Salary Structure is resolved differently: rather than becoming a Masters sub-master, this module (Section 2.2) is now where Super Admin creates and edits it directly, since a salary structure is inherently tied to one specific person's compensation, not a company-wide shared list the way Employment Type is.

**Superseded, and recorded rather than deleted:** an earlier revision pointed the Salary Structure and My Tax Declarations tabs at three purpose-built Masters sub-masters — PF & ESI Rates, Professional Tax Slabs, and Old Regime Deduction Limits. All three no longer exist. Both tabs now read from the single dynamic Taxes sub-master (Masters, Section 3.2), which holds whatever tax heads Super Admin has actually created and names none of them in advance. Insurance Plans (Masters, Section 3.19) is unaffected — it's a benefit, not a tax, and is still what the Insurance & Benefits tab (2.2) enrolls an employee into.

## 6. Role-Based Access

**Important starting point:** every one of the 5 roles is also an individual staff member, so every role has full, ordinary self-service access to their **own** My Profile, My Leave, My Payslips, My Documents, My Tickets, My Projects & Tasks, My Assets, and Dashboard. Those "My ___" screens work identically for everyone when it comes to their own data — **no role's access to their own data should ever be narrower than a plain Employee's.** What differs by role is the **additional** access described below, on top of that shared baseline.

> **Hard rule:** an Employee cannot view another employee's details anywhere in this module — no staff list, no directory, no lookup. Employee Directory (2.1) and the Master Record (2.2) are both "No access" for the Employee role, and every "My ___" screen only ever shows their own data. The only other people an Employee ever sees by name are their own Reporting Manager (as a read-only field on their own profile) and whoever they're directly messaging on a shared ticket or project — never a browsable list of colleagues or anyone else's personal, employment, bank, or salary details.
>
> Own Payslip (2.5) and own Leave balance (2.4) are the opposite case — that access is common to **all five roles equally** (Employee, Manager, Accountant, HR, Super Admin), since everyone is staff. Nothing about this module gives Employee less access to their own data than anyone else gets to theirs.

### 6.1 Screen-by-Screen Access Table

| Screen | Employee | Manager | Accountant | HR | Super Admin |
|---|---|---|---|---|---|
| 2.1 Employee Directory | No access | View, own direct reports only | View, all employees | View + Edit, all employees | Full, all employees |
| 2.2 Employee Master Record (others' records) | No access | View-only, own direct reports | View-only, all employees | Full create/edit, all employees | Full, all employees |
| — Edit Salary Structure specifically | No access | No access | View-only | View-only, except the Applicable toggles in the Statutory Deductions & Contributions block, which Accountant can edit — see 2.2 | Full, all employees |
| — Edit Insurance & Benefits specifically | No access | No access | No access | Full, all employees | Full, all employees |
| 2.3 My Profile | Own record | Own record | Own record | Own record | Own record |
| — Approve/reject profile change requests | No | No | No | Yes, all employees | Yes, all employees |
| 2.4 My Leave | Own record | Own record | Own record | Own record | Own record |
| — Team Leave Requests / leave approval (approve/reject) | No | Yes, own direct reports | No | Yes, any employee, company-wide (corrected — see 2.4) | Yes, any employee |
| 2.5 My Payslips | Own record | Own record | Own record | Own record | Own record |
| 2.6 My Documents | Own record | Own record | Own record | Own record | Own record |
| — HR Document Verification Queue | No | No | No | Yes, all employees | Yes, all employees |
| 2.7 My Tickets | Own record | Own record | Own record | Own record | Own record |
| — Team Ticket Load (count) | No | Yes, own direct reports | No | No | Yes |
| 2.8 My Projects & Tasks | Own record | Own record | Own record | Own record | Own record |
| 2.9 My Assets | Own record | Own record | Own record | Own record | Own record |
| — Approve asset requests | No | Yes, own direct reports | No | No | Yes, any employee |
| 2.10 Employee Dashboard | Own widgets | Own widgets + My Team strip | Own widgets | Own widgets | Own widgets |
| 2.11 Announcements/Notifications | View + own notifications | View + own notifications | View + own notifications | View + own, can post | View + own, can post |
| 2.12 Onboarding Checklist | No access | No access | No access | Yes | Yes |
| 2.13 Offboarding — raise own resignation | Yes | Yes | Yes | Yes | Yes |
| 2.13 Offboarding — acknowledge/process for others | No | Acknowledge, own direct reports | No | Full exit checklist, all employees | Yes |
| 2.14 My Tax Declarations | Own record | Own record | Own record | Own record | Own record |
| — View any employee's declaration (verification) | No | No | View-only, all employees | View-only, all employees | Full, all employees |
| 2.15 Offer & Appointment Letter | No access | No access | Full, all employees | No access | Full, all employees |

**Note — Team Payslips removed.** An earlier revision of this table carried a "2.6 Team Payslips" row, giving a Manager a status-only (Processed/Pending) view of their direct reports' pay, widened to a Net Pay amount by the "Show Salary Amount to Manager" toggle. **That screen has been removed from this module entirely**, per explicit instruction — it no longer exists in the prototype and should not be built. A Manager currently has no payslip-related visibility into their team at all. If team-level pay visibility is wanted back, it belongs to Payroll (Module 6), not here — see the toggle note in Section 6.3.

### 6.2 Summary by Role

- **Employee** — sees and edits only their own data across every screen above; cannot see anyone else's record.
- **Manager** — everything an Employee sees for themselves, plus a limited view of direct reports: team leave requests to approve, team ticket load, team payslip status only (no salary amount by default), and acknowledging a direct report's resignation.
- **Accountant** — full access to payslip and salary data for all employees; view-only on everyone's personal/employment details; no access to change-request or document-verification queues.
- **HR** — full create/edit access to Employee Master Records, document verification, onboarding, and offboarding for everyone; can see payslips for everyone; can also approve or reject any employee's leave request and view leave balances/history company-wide (corrected against the source sheet — not limited to being someone's Reporting Manager).
- **Super Admin** — full access to everything above, including the RBAC settings screen itself.

### 6.3 Nothing Here Is Hardcoded

All of the access described above should be controlled from a central RBAC settings screen, fully designed later in the Roles & Access module — Super Admin picks a role there and sees a list of toggles to turn screens, tabs, or fields on or off for that role. This document only defines what needs to be toggle-able for the Employee module. Concrete examples:

- **"Show Salary Amount to Manager" — retired alongside Team Payslips (see the note at the end of Section 6.1).** This toggle used to widen a Manager's Team Payslips screen from status-only to a visible Net Pay amount. With that screen removed, the toggle has nothing left to control on this module's side. It may still exist on the Payroll side (Module 6) if a team-level payslip view is ever reintroduced there — check that module's own Section 6 rather than assuming this one still applies.
- **"Allow Employee to Edit Bank Details Directly"** — OFF by default: a Bank & Statutory change goes through the HR-approval workflow (3.2). Turned ON: the employee edits it directly on My Profile, no approval needed.
- **"Show Financial Year Management to Manager"** — turned ON for the Manager role, a Financial Year option appears in the Manager's menu (linking into the Masters module); turned OFF, it stays hidden. (Currently OFF by default, consistent with Financial Year being Super-Admin-only in the Masters module.)
- **"Allow Manager to Edit Team Member Employment Details"** — OFF by default: Manager's view of the Employee Master Record (2.2) is read-only, even for their own direct reports. Turned ON: a Manager could update basic Employment Details (e.g. Designation) for their own reports, without full HR-level access.
- **"Require Manager Acknowledgment Before HR Processes Exit"** — ON by default, matching Workflow 3.4 exactly as written (Manager acknowledges first, then HR's checklist activates). Turned OFF: HR can start the exit checklist as soon as the resignation is submitted, without waiting on the Manager.

**Per-person overrides:** on top of these role-level toggles, Super Admin can grant one specific person extra permission beyond what their role normally gets — for example, letting one particular Manager see a screen or field their role doesn't normally get, without turning that on for every Manager. On the Employee Master Record itself, this shows up as the **Extra Permissions** list on the Account & Login tab (Section 2.2), so anyone looking at one person's record can see at a glance whether they have anything beyond their role's defaults. The full design of the settings screen used to grant these (how toggles are grouped, how overrides are audited) belongs in the separate Roles & Access module; this section only defines what the Employee module needs to expose as toggle points.

## 7. Planned Features (Future Flow)

Two things are shown as "Coming Soon" in Section 2 rather than being built right now: Biometric Attendance and Timesheets. Marking them "Coming Soon" isn't the end of their documentation — this section describes how each will actually work once you build it, so that work is a clean add-on to today's design rather than a rebuild of it. Nothing in Section 2 needs to change to make either of these possible later; that's the point of writing this down now.

### 7.1 Biometric Attendance — Future Flow

**Today (already documented in 2.2):** the Attendance Method selector shows Manual Entry (active) and Biometric (greyed out, "Coming Soon"). Only Super Admin can record a check-in/check-out, manually, one employee at a time.

**How it will work once built:**

1. A biometric device (fingerprint or face scanner) is installed at each office location.
2. When an employee checks in or out, the device captures the scan and sends an event — the employee's biometric ID, a timestamp, and the event type (Check-In / Check-Out) — to the CMS through an integration/API layer.
3. The system matches the biometric ID to an Employee record and writes an Attendance entry using the **same underlying structure manual entry already uses today** (Date, Check-In Time, Check-Out Time, Recorded By) — just filled in automatically by the device instead of typed by Super Admin.
4. The Attendance Method selector switches from Manual Entry to Biometric. Assumption: this is a company-wide (or per-office) setting rather than per-employee, since everyone at one office shares the same device.

**What has to be true for this to drop in cleanly, when you get there:**

- **Recorded By** needs to be able to hold either a person (Super Admin's name, in Manual mode today) or a device/system source (e.g. "Biometric — Chennai Office," once live) — worth keeping that field flexible rather than a strict user reference, even before biometric is built.
- Each Employee record will eventually need a **Biometric Enrollment ID**, linking their fingerprint/face template on the device to their Employee ID. Assumption: this field doesn't need to be added now — the exact format depends on whichever biometric hardware/vendor you pick — but it's flagged here so it isn't forgotten when that decision is made.
- **Manual entry should stay available as a fallback** even after biometric goes live — for device outages, forgotten scans, or new joiners not yet enrolled. Assumption: at that point it may make sense to widen manual entry from Super Admin only to also include HR, since attendance corrections are a common HR task — but that's a decision for whenever this is actually built, not now.
- Since Meshrd has two office locations, the device/API layer needs to tag which office an event came from, so it can be shown alongside each entry.

### 7.2 Timesheets — Future Flow

**Today (already documented in 2.8):** a placeholder tab on My Projects & Tasks, showing a "Coming Soon" badge in the position the real feature will occupy.

**How it will work once built:**

1. An employee opens the Timesheets tab and logs time against a specific Project and Task — Date, Hours, and an optional Note, per entry.
2. A day or week view lets them review and edit entries before submitting.
3. Submitted timesheets go to their Reporting Manager for approval. Assumption: this follows the same approval pattern already established for Leave (2.4) and Asset requests (2.9), rather than inventing a new mechanic.
4. Once approved, logged hours become available to the Project module (for tracking effort against tasks) and potentially Payroll (if hourly billing or overtime pay ever applies). Assumption: exactly how those two modules use the data depends on how they're designed when you get there — this module's job is only to capture and route the entries.

**What has to be true for this to drop in cleanly:** nothing extra — the tab position is already reserved in 2.8, and the approval pattern it will reuse (Reporting Manager approves) is already built for Leave and Asset requests.

### 7.3 Milestones — Future Flow (lighter note)

Milestones is paired with Timesheets today as a "Coming Soon" placeholder tab (2.8), though it wasn't separately named in your notes. Assumption: when built, it will likely be a simple, read-only-from-here list of key dates per Project (Milestone Name, Target Date, Status) — full milestone management would belong to the Project module, the same way Assigned Assets (2.2) and Leave & Attendance (2.2) are read-only summaries pulled into the Employee module today, not owned by it.

## 8. Assumptions & Points to Confirm

A quick list of the judgment calls made while writing this document, so they can be confirmed or corrected:

1. **Employee ID format** — proposed as EMP-\<Financial Year\>-\<4-digit number\> (e.g. EMP-2026-0001), matching every other module's code style. Not yet added to the Masters module's Number Prefixes list — recommend adding it there.
2. **Address field** — added to Personal Details (Section 2.2), since My Profile (2.3) references editing an Address that wasn't in the original Personal Details field list.
3. **Bank details access, resolved** — treated as "editable via HR-approval workflow," not fully frozen, to reconcile two statements in the brief that otherwise conflict (see the note at the start of Section 2.3).
4. **Personal Details fields not explicitly categorized** (First Name, Last Name, Email, Date of Birth, Gender) — treated as HR-approval-editable on My Profile, same as Bank & Statutory, rather than freely editable like Phone/Address.
5. **Minimum age** — assumed 18 years old as of Joining Date; not stated in the brief.
6. **Reset Password mechanism — changed in a later revision.** Originally assumed to send a reset link; now generates a temporary password directly and forces a change on next login instead, for consistency with initial account creation. See item 25.
7. **Statutory fields added** (Aadhaar Number, UAN, PF Account Number, ESI Number) — proposed in addition to Bank Account/IFSC/PAN, since the brief explicitly invited "other statutory fields Payroll will need later."
8. **Document file rules** — assumed PDF/JPG/PNG, up to 5 MB; not stated in the brief.
9. **Ticket priority values** — assumed Low/Medium/High/Urgent, matching common defaults; the Ticket module's own spec is the source of truth if it defines something different.
10. **Leave proration on joining mid-year** — assumed the automatic leave-balance setup in Onboarding (3.1) prorates by Joining Date rather than granting a full year's quota regardless of when someone joins.
11. **Employment Type and Salary Structure — both now resolved, this item is historical.** At the time this was written, Employment Type wasn't yet a Masters sub-master and Salary Structure's ownership was unsettled. Both are now fixed: Employment Type is Masters Section 3.18 (see the updated field in Section 2.2), and Salary Structure is owned right here in this module, not Payroll — see items 18 and 19 below for the full corrections.
12. **Role column order** — this document uses Super Admin, Employee, Manager, Accountant, HR throughout, exactly as specified. The Masters module (Module 1) used a slightly different column order in its tables (Super Admin, Manager, HR, Accountant, Employee) — a small cosmetic inconsistency across the two documents, worth a pass to align if you'd like everything to match exactly.
13. **Attendance Method selector** — added a visible Manual Entry / Biometric (Coming Soon, disabled) selector to the Attendance tab, so the roadmap item is visibly on the record instead of only described in a note.
14. **Extra Permissions on the record** — added a list + "+ Add Permission Override" action to the Account & Login tab, so per-person RBAC overrides (Section 6.3) are visible directly on the employee's own record, not just described as a general mechanism.
15. **Planned Features section (7)** — added to give Biometric Attendance and Timesheets a documented future flow now, separate from the current-build screens in Section 2, so building either later is a clean add-on rather than a redesign.
16. **Checked directly against Sheet1 (the source spreadsheet), row by row — here's what changed and what was confirmed correct:**
    - **HR's leave access, corrected.** Sheet1's Leave module row gives HR its own "approve / reject, manage balances, view all" and lists approval as "(Manager / HR)" — not HR only stepping in as a Reporting-Manager fallback, which is what an earlier version of this document had. Fixed in 2.4 and Section 6.
    - **Change Own Password, added.** Sheet1 explicitly lists this for Employee, Manager, and Accountant in the Employee module's own row. This document previously only had HR/Super Admin resetting *someone else's* password (Account & Login tab), with no self-service password change for a person's own account. Added to My Profile (2.3), available to all 5 roles.
    - **Salary structure history, added.** Sheet1 lists "salary & leave history" as a feature. Leave history already existed (2.4); a Structure Change History list has now been added to the Salary Structure tab (2.2) to cover the salary side, distinct from My Payslips' month-by-month view.
    - **"Employee: view staff list," confirmed intentionally excluded.** Sheet1's raw row does list this for the employee role, but you explicitly asked for it to be removed in an earlier round of feedback, and Section 6's hard rule already reflects that. Flagging here just to confirm this wasn't missed — it was a deliberate override of the sheet, not an oversight.
    - **"Basic Salary" as a raw field, confirmed intentionally replaced.** Sheet1's rough notes list a plain "Basic Salary" field on the employee record; this document instead uses the Salary Structure tab (a link into Payroll, plus the history above), matching the more detailed brief you provided when this module was first written. Not a gap — a deliberate, already-made design choice.
    - **"Link / unlink a staff record"** (Sheet1, Employee row, point 10) — resolved: treated as already covered by the existing Create Login / Account Status toggle (2.2) rather than a separate feature. The alternative reading (linking to a pre-hire "candidate" record from the offer-letter process) would be a materially bigger feature — a candidate-tracking system that doesn't otherwise exist anywhere in this 14-module list — so the narrower, lower-risk reading was chosen. Revisit if this turns out to mean the candidate-linking version.
17. **Corrections driven by building the Leave module (Module 5):** three fixes to the My Leave screen (2.4) and the Master Record's leave summary (2.2), all superseded by that module's more detailed, authoritative brief:
    - **Hard block, not a soft warning.** This document previously said an over-balance leave request gets a warning but can still be submitted, with the Reporting Manager approving it "as an exception." The Leave module's brief was explicit that this is a hard block with no override path. Fixed.
    - **Carried Forward column added** to both balance tables (2.2 and 2.4) — this document only had Allotted/Taken/Pending/Remaining, missing the fifth column the Leave module defines as part of the standard balance shape.
    - **"Allotted" renamed to "Allowed"** in both places, for consistent terminology with the Leave module.
18. **Correction driven by building the Payroll module (Module 6):** this document previously claimed Salary Structure was "intentionally left as a Payroll-owned concept." Payroll's own brief confirmed that's wrong — Payroll only reads a Salary Structure, the same as this module does; nobody owns creating or editing one yet. Fixed in Section 5's note to reflect the genuinely open gap instead. Also noted: "Show Salary Amount to Manager" (Section 6) is now explicitly documented as one setting shared with Payroll's Manager view, not a separate toggle per module.
19. **This revision, confirmed and implemented per your explicit direction to resolve open items rather than leave them flagged:**
    - **Employment Type now sources from Masters** (renumbered since to Section 3.18), resolving that gap.
    - **Salary Structure is now fully designed and Super-Admin-editable** on this record (2.2). *Partly superseded by item 26 — the named PF and Professional Tax rows described here no longer exist as fixed fields.*
    - **HR's edit rights on this record now stop short of Salary Structure specifically** — HR keeps full edit everywhere else, but Salary Structure is Super Admin only to edit (HR view-only), a deliberate new tightening called out in 2.2 and the access table (6.1).
    - **My Tax Declarations (2.14) is an entirely new self-service screen.** *Substantially superseded by item 26 — the named regime choice and the five named deduction fields described here have been replaced by configuration-driven ones.* The one design decision from this item that survived unchanged: proof verification is non-blocking (Submitted figures drive the calculation immediately; Verified is an audit trail, not a gate) — still worth confirming that's the right call before this is built.
    - **Export and filters confirmed on the two admin-facing list screens** — Employee Directory (2.1) and the HR Document Verification Queue (2.6). *Extended by item 27: at the time, "every list/table screen in this module" was taken to mean the admin-facing ones, leaving most self-service screens with one filter or none.*
20. **Deep-dive requested on tax/insurance completeness — real gaps found and fixed.** *This entire item is superseded by item 26, and is kept because the reasoning shows exactly how the problem item 26 fixes was created.* The pass moved PF, ESI, Professional Tax, and the Old-Regime deduction caps out of prose and into four purpose-built Masters sub-masters (PF & ESI Rates, Professional Tax Slabs, Old Regime Deduction Limits, Income Tax Slabs), on the stated principle that "every rate or cap that can change year to year is now a Masters field Super Admin edits, never a number written into this document's own text."

    That principle was right and remains in force. The pass just didn't apply it far enough: it made every *rate* configurable while leaving every *tax* hardcoded, as fixed field names in this document and fixed sub-masters in Masters. All four of those sub-masters have since been deleted. The one genuinely separate finding from this pass survived intact — company-provided insurance didn't exist anywhere, and the Insurance & Benefits tab (2.2) plus the Insurance Plans sub-master (Masters, Section 3.19) that fixed it are unaffected, since a benefit is not a tax.

21. **Researched this revision — real components were missing, not just under-specified.** Confirmed via current sources rather than assumed: Dearness Allowance and Gratuity accrual didn't exist as fields at all; LTA and Variable/Performance Pay were absent from the standard earnings list; and the Code on Wages, 2019 (Basic + DA ≥ 50% of CTC) is a real, currently-enforcing rule this Salary Structure needs to validate against, not just calculate around. All added to Section 2.2. *Partly superseded by item 26: the earnings components (DA, LTA, Variable Pay) and the Code on Wages validation all stand; Gratuity accrual is no longer a named field, since it is a statutory contribution and now exists only if someone configures a tax head for it.* ESOPs were researched and deliberately not added — flagged in Section 2.2 with the reasoning, since Meshrd being a startup makes them plausible, but their taxation is a separably-sized undertaking, not a field to bolt onto this tab. (EDLI was also added in this pass and has since been removed, per explicit instruction — see item 22.)
22. **EDLI removed, per explicit instruction.** Was added as an employer-side statutory contribution in the same research pass as Gratuity; removed from the field table, the Annual CTC formula, and the role note above. Gratuity was reviewed against the same instruction and kept, since it wasn't the one asked to be removed.
23. **New — Ad-hoc Payslip Adjustments, designed in the Payroll module (Module 6, Section 2.1a), not here.** Accountant and Super Admin can now add one-off or recurring custom line items to any employee's payslip — a bonus, a recovery, a correction — beyond what's fixed on this Salary Structure tab. Referenced here since it affects what actually shows on a payslip; the full design, including how it connects to a negotiated term in an Appointment Letter, lives in Payroll.
24. **This revision — two real gaps closed, requested directly.** First: PF, ESI, and Professional Tax each got an Applicable toggle (Section 2.2), since none universally applies to every employee — coverage depends on headcount thresholds, wage levels, and location-specific rules. *Generalized by item 26: the toggles are no longer three fixed ones, but one per configured tax head that permits per-employee opt-out. The underlying insight — that applicability is a compliance fact Accountant often owns, not a compensation decision — was correct and is preserved, including Accountant's narrow edit right.* Second: the Offer & Appointment Letter generator, referenced twice in earlier revisions as living "elsewhere in the system," never actually had anywhere to live — there's no standalone Documents module in this CMS's 14-module structure. Built properly now (Section 2.15), including a real connection to Ad-hoc Payslip Adjustments so a signing bonus negotiated at offer stage doesn't need a second manual entry once the person joins.
25. **A real gap in the login flow, closed.** This document never actually said what happens the moment a login is first created — Reset Password existed, but nothing described initial account setup. Fixed: Create Login now generates a random temporary password automatically, emails it directly to the employee (HR never sees it), and forces a change on first login via the same Change Own Password form already built into My Profile (Section 2.3) rather than a second screen. Reset Password (2.2) was also changed to match this same pattern, replacing the earlier reset-link assumption, so initial setup and any later reset behave identically instead of two different mechanisms for the same underlying need.

26. **This revision — every named tax removed from this module, per explicit instruction. The largest correction in this document's history, and it deletes more than it adds.**

    **What prompted it:** it was stated directly that whether the taxes described in these documents actually apply to this company is unknown, and that Super Admin (or Accountant) should be able to add whatever taxes do apply, themselves, rather than receiving a pre-decided list. That instruction invalidated a design assumption running through this entire module.

    **What was removed from this document:**
    - The eight fixed statutory rows on Salary Structure (2.2): PF Applicable, Employer PF Contribution, Employee PF Contribution, Employer Gratuity Accrual, ESI Applicable, ESI Employer Contribution, Employee ESI Contribution, Professional Tax Applicable, and Professional Tax.
    - The three fixed statutory ID fields on Bank & Statutory (2.2): UAN, PF Account Number, ESI Number.
    - The Tax Regime dropdown and its two named options, plus all five named declaration fields on My Tax Declarations (2.14): HRA exemption with its Metro/Non-Metro classification, Section 80C, Section 24 home loan interest, and Section 80D health insurance.
    - Every reference to a rate, cap, slab, threshold, or statutory section number anywhere in this document.

    **What replaced them:** three configuration-driven blocks, all reading Masters → Taxes (Section 3.2) — a Statutory Deductions & Contributions block on Salary Structure, a Statutory Identifiers block on Bank & Statutory, and a fully generated declaration form on My Tax Declarations. Each renders exactly what has been configured and nothing when nothing has been.

    **What deliberately stayed named:** PAN and Aadhaar (general identity documents, not per-tax registrations), the Insurance & Benefits tab and Insurance Plans master (a benefit the company buys, not a levy), all salary earnings components, the Code on Wages Basic + DA validation (a wage-structure rule, not a tax), and the "Other Declared Deduction" catch-all on 2.14.

    **What this document must never reacquire:** a list of which taxes apply. If grooming produces one, it belongs in the system as Tax Head records after build, not in these pages. Section 5's dependency note and Masters' Section 3.2 both carry the same warning.

27. **This revision — filters on every list screen for every role, and filter-based export, per explicit instruction.**

    **What prompted it:** the instruction was that every module must have filters available to all employee roles, that Super Admin must have every filter on every page, and that export must follow the filter. Auditing this module against that found a clear pattern — the two admin-facing screens (Employee Directory, HR Document Verification Queue) had proper filters and export; almost every self-service screen did not. My Payslips had one filter. My Tickets had two. My Leave, My Documents, My Projects & Tasks, My Assets, Team Payslips, and Announcements had none at all.

    That gap came from treating self-service screens as simplified views rather than list screens. An employee with four years of payslips or three years of leave history needs to narrow a list exactly as much as an Accountant does.

    **What changed here:** every list screen in this module now carries a documented filter set plus filter-based export — 2.1, 2.4, 2.5, 2.6 (both the employee's list and HR's queue), 2.7, 2.8, 2.9, and 2.11. **The original version of this note also listed Team Payslips (then 2.6) — that screen has since been removed entirely (see the note at the end of Section 6.1), so it no longer belongs on this list.** Two genuinely missing screens were added while auditing: HR cross-employee views for onboarding (2.12) and exit (2.13), since both existed only as per-employee checklists with no way to see everyone in progress at once.

    **Two deliberate exclusions, flagged rather than buried:** personal notifications are filterable but not exportable (transient UI state, not a business record, and the underlying events export from their own modules); and the header notification popover stays a simple recent list rather than gaining filter controls.

    **Where the rules live:** the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2) defines the baseline filter set, the all-roles rule, Super Admin's superset, and export behaviour. This module's screens list only their own screen-specific filters and inherit the rest — deliberately, so the convention has one home rather than fourteen slightly-different restatements.

---

**Suggested filename:** `02-employee-module.md`
