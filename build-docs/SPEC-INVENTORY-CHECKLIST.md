# Meshrd CMS — Complete Spec Inventory Checklist

**1313 checkboxes.** Every screen, tab, field, column, button, filter, status value, empty state and
workflow step the 15 module specs require — extracted mechanically from `NN-*-module.md`.

| | Count |
|---|---|
| Screens | **134** |
| Fields | **795** |
| Workflow / functionality steps | **200** |
| Buttons / actions | **112** |
| Columns | 58 |
| Filter sets | 56 |
| Tabs | 25 |

**Regenerate any time:** `python3 build-docs/_build_inventory.py`
It re-reads the specs and rewrites this file, so it can never drift from them.

---

## How to use this

1. Open a screen in the running app (`http://localhost:4200`).
2. Find its section below.
3. **Tick every line you can actually see.**
4. Anything you cannot tick is a defect — record it and fix it.

**Walk each screen as EVERY role that can open it**, not just Super Admin. Role access comes from the
module spec's own §6 — **never from the prototype**, which leaks role-restricted fields (it renders
HR-only fields on an Employee's screen).

### Marking
- ✅ present and correct
- ❌ **missing entirely** → defect
- ⚠ present but wrong — bad label, wrong input type, read-only when it should be editable, raw UUID
  shown, dropdown missing options, button that does nothing → defect

---

## Three rules that keep this honest

**1. A field counts as present only if it is a RENDERED FIELD.**
A mention in a hint, tooltip or prose does not count. A derived value must render read-only with a lock
and a hint explaining the derivation — not be omitted.

**2. Conditional fields are NOT missing — set the trigger first.**
Several forms hide fields until something is chosen. Add Tax Head reveals CGST/SGST only when Tax Type
is `GST — CGST + SGST`, and reveals six more only when `Creates an Onward Liability` is switched on.
**Set the trigger before marking anything ❌.** A previous audit wrongly reported these as missing and
nearly sent a developer to break working logic.

**3. Every button must DO something.**
Click it. Navigation, a request, a dialog, a state change — something. A control that does nothing is a
bug, not a placeholder.

---

## Previously-confirmed defects — ALL FIXED, do not re-discover them

Every item below was verified against live code and the running database, then fixed. They are kept
here so a future pass recognises them rather than re-reporting them. **Do not treat this table as a
to-do list.**

| # | Defect | Outcome |
|---|---|---|
| 1 | No employee record linked to any login, so every self-service screen was dead | **Fixed.** `seed.py` now creates and links an Employee per demo user. All 5 roles resolve their own record and get 200 from dashboard, leave, expenses and payslips. |
| 2 | Raw UUIDs shown instead of names | **Fixed.** `ref-data.service.ts` renders `Unknown` rather than the id. The underlying cause — `wipe_and_reseed_masters.py` disabling `FOREIGN_KEY_CHECKS` and never repairing dependents, leaving 1,610 orphaned rows — now has `scripts/orphan_audit.py`, wired into that script. |
| 3 | Three filters all labelled "Anyone" | **Fixed**, and swept: 19 screens had same-screen `allLabel` collisions, now none. |
| 4 | Role switcher "ships to production" | **Phantom, as stated.** It is spec-approved (A112) and cannot escalate — the backend honours `X-Preview-Role` only for a caller whose JWT role is genuinely Super Admin, and it can only narrow. What WAS missing is A112's own condition, a persistent preview banner; that is now built. |
| 5 | CSS classes used but never defined | **Fixed.** Nine were genuinely undefined, including `.formbar`, `.hint` and `.clear`. `.soon` was deliberately not ported — the house idiom for that is `badge-s b-outline`. |
| 6 | ~60 Masters gaps | **Mostly closed** by the earlier Masters remediation; verify individually before acting. |

Also closed since this checklist was written: the `must_change_password` flow had no frontend at all,
locking 105 of 117 users out of the product with no recovery path, and an axe sweep went from 139
critical/serious accessibility violations to 0 across all 69 screens.

---

## What this checklist does NOT capture — known limits

Stated so you don't trust it blindly:

- **Fields described only in prose**, never in a table. If a spec says *"the screen also shows a Remarks
  box"* in a paragraph, the extractor cannot see it.
- **Some captured lines are cross-references**, not real fields. They read wrong — skip them.
- **Validation rules and hint text** are not extracted in full; check the spec section itself when a
  field's behaviour matters.

It is a strong ~90% checklist, not a guaranteed 100%. Good enough to find hundreds of real gaps.

---

## Output

Per module, write `defects/<NN>-<module>-defects.md`:

```
### [MODULE] Screen — as [ROLE]
Defect:   one sentence
Expected: what the spec says, with § reference
Actual:   what is on screen
Severity: Blocker | High | Medium | Low
Root cause: file:line, or "not traced"
```

**Severity:** Blocker = wrong money/hours, permission leak, screen won't load · High = missing spec'd
field or action, raw UUID · Medium = wrong label, missing filter · Low = spacing, wording.

---

# Module 1 of 14: Masters

`01-masters-module.md`

## 3.0 Access Model for All Sub-Masters

**Fields (21):**
- [ ] Financial Year
- [ ] Taxes
- [ ] Expense Types
- [ ] Leave Types
- [ ] Holidays
- [ ] Company Profile
- [ ] Bank Account
- [ ] Payment Mode
- [ ] Department
- [ ] Designation / Job Title
- [ ] HSN / SAC Code
- [ ] Service Category
- [ ] Unit of Measure
- [ ] Ticket Categories
- [ ] Customer Status
- [ ] Asset Categories
- [ ] Employment Type
- [ ] Insurance Plans
- [ ] Customer Source
- [ ] Work Week & Hours
- [ ] Email Configuration

**Status values:**
- [ ] (?include_inactive= — Active-only by default, exactly the "hidden by default but never silently unreachable" rule), and Export to PDF and Excel (?format=pdf|excel on the same list endpoint, exporting exactly the filtered set through the shared list_export.build_export contract with the RBAC §2.2(f) 

**Workflow / functionality:**
- [ ] Delete and Deactivate are Super Admin only.

## 3.1 Financial Year

**Fields (7):**
- [ ] Financial Year Label
- [ ] Start Date
- [ ] End Date
- [ ] Status
- [ ] Is Current Financial Year
- [ ] Locked By
- [ ] Locked On

**Buttons / actions (1):**
- [ ] + Add Financial Year

## 3.2 Taxes

**Columns (1):**
- [ ] Liability Arises On

**Fields (52):**
- [ ] Tax Name
- [ ] Tax Type
- [ ] Scope
- [ ] Applies From
- [ ] Applies Until
- [ ] Rate (%)
- [ ] CGST Rate (%)
- [ ] SGST Rate (%)
- [ ] Fixed Amount (₹)
- [ ] Declaration Cap (₹)
- [ ] Print Label
- [ ] Creates an Onward Liability
- [ ] Remitted To (Authority)
- [ ] Remittance Period
- [ ] Period Aligns To
- [ ] Deposit Due — Days After Period End
- [ ] Authority Reference Label
- [ ] Withholding Direction
- [ ] Default Calculated On
- [ ] Certificate Expected from Counterparty
- [ ] Notes
- [ ] Status
- [ ] Sales / Billing
- [ ] Purchase
- [ ] Sales / Billing & Purchase
- [ ] Payroll — Employee Deduction
- [ ] Payroll — Employer Contribution
- [ ] Payroll — Income Tax
- [ ] Employee Declaration / Exemption
- [ ] Withholding / Deduction at Source
- [ ] GST — IGST
- [ ] GST — CGST + SGST
- [ ] Percentage
- [ ] Fixed Amount
- [ ] Slab
- [ ] Declaration Cap
- [ ] Band From (₹)
- [ ] Band To (₹)
- [ ] Rate (%) or Amount (₹)
- [ ] Band Label
- [ ] Component Name
- [ ] Share of Total (%)
- [ ] Applies When
- [ ] Condition
- [ ] Scheme Name
- [ ] Description
- [ ] Is Default
- [ ] Choice Window
- [ ] Relief Name
- [ ] Applies If Base Is At Or Below (₹)
- [ ] Relief Type
- [ ] Relief Amount (₹)

**Buttons / actions (1):**
- [ ] + Add Tax

**Empty state:**
- [ ] — and this is a real state, not a formality, because on day one nothing exists here: "No taxes configured yet. Add the taxes, statutory deductions, and contributions that apply to this company. Until at least one is added, invoices and payslips are calculated without any tax." Payroll and Invoice bo

## 3.3 Expense Types

**Fields (7):**
- [ ] Expense Type Name
- [ ] Short Code
- [ ] Claim Type
- [ ] Recurring
- [ ] Default Bank Account
- [ ] Description
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Expense Type

## 3.4 Leave Types

**Fields (8):**
- [ ] Leave Type Name
- [ ] Short Code
- [ ] Paid or Unpaid
- [ ] Default Annual Quota (Days)
- [ ] Carry Forward Allowed
- [ ] Max Carry Forward Days
- [ ] Is Quota Tracked
- [ ] Status

## 3.5 Holidays

**Fields (6):**
- [ ] Holiday Name
- [ ] Date
- [ ] Financial Year
- [ ] Type
- [ ] Recurring Every Year
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Holiday

## 3.6 Company Profile

**Fields (44):**
- [ ] Company Legal Name
- [ ] CIN
- [ ] TAN
- [ ] GSTIN
- [ ] PAN
- [ ] Company Type
- [ ] Year of Incorporation
- [ ] Industry / Business Type
- [ ] MSME Registration Number
- [ ] Phone Number
- [ ] Alternate Phone
- [ ] Official Email
- [ ] Support Email
- [ ] Website
- [ ] Logo
- [ ] Letterhead Template
- [ ] Default Billing Tax
- [ ] Biometric Attendance
- [ ] Biometric Device Endpoint / Reference
- [ ] Registered Address (Primary)
- [ ] Address Type
- [ ] Address Line 1
- [ ] Address Line 2
- [ ] City
- [ ] State
- [ ] PIN Code
- [ ] Mark as Primary
- [ ] General Documents
- [ ] Financial Documents
- [ ] ROC Documents
- [ ] Invoice Template
- [ ] Customer Code
- [ ] Opportunity Code
- [ ] Project Code
- [ ] Invoice Number
- [ ] Purchase Bill Number
- [ ] Ticket Number
- [ ] Asset Code
- [ ] Quotation Number
- [ ] Credit Note Number
- [ ] Employee Code
- [ ] Offer/Appointment/Acceptance Letter Number
- [ ] Compensatory Hour Request Number
- [ ] Remittance Number

**Buttons / actions (2):**
- [ ] Add Another Address
- [ ] Save Changes

## 3.7 Bank Account

**Fields (12):**
- [ ] Account Nickname
- [ ] Bank Name
- [ ] Account Holder Name
- [ ] Account Number
- [ ] Confirm Account Number
- [ ] Account Type
- [ ] IFSC Code
- [ ] Branch
- [ ] UPI ID
- [ ] UPI QR Code
- [ ] Is Default
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Bank Account

## 3.8 Payment Mode

**Fields (3):**
- [ ] Mode Name
- [ ] Requires Reference Number
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Payment Mode

## 3.9 Department

**Fields (4):**
- [ ] Department Name
- [ ] Department Code
- [ ] Description
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Department

## 3.10 Designation / Job Title

**Fields (4):**
- [ ] Designation Name
- [ ] Linked Department
- [ ] Level / Grade
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Designation

## 3.11 HSN / SAC Code

**Fields (7):**
- [ ] Code
- [ ] Type
- [ ] Description
- [ ] Linked Tax
- [ ] Custom GST Type
- [ ] Custom GST Rate (%)
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Code

## 3.12 Service Category

**Fields (3):**
- [ ] Service Category Name
- [ ] Description
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Service Category

## 3.13 Unit of Measure

**Fields (2):**
- [ ] Unit Name
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Unit

## 3.14 Ticket Categories

**Fields (3):**
- [ ] Category Name
- [ ] Description
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Category

## 3.15 Customer Status

**Fields (2):**
- [ ] Status Name
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Status

## 3.16 Customer Source

**Fields (2):**
- [ ] Source Name
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Source

## 3.17 Asset Categories

**Fields (3):**
- [ ] Category Name
- [ ] Description
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Category

## 3.18 Employment Type

**Fields (2):**
- [ ] Employment Type Name
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Employment Type

## 3.19 Insurance Plans

**Fields (7):**
- [ ] Plan Name
- [ ] Type
- [ ] Provider
- [ ] Coverage Amount (₹)
- [ ] Company Contribution
- [ ] Employee Contribution (Monthly, ₹)
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Plan.

## 3.20 Work Week & Hours

**Fields (30):**
- [ ] Policy Name
- [ ] Applies To
- [ ] Applies To — Value
- [ ] Effective From
- [ ] Gross Hours per Day
- [ ] Unpaid Break (hours)
- [ ] Net Working Hours per Day
- [ ] Grace Window (minutes)
- [ ] Half Day Threshold (hours)
- [ ] Count Overtime Beyond Net
- [ ] Weekly Hour Target
- [ ] Weekly Off Day(s)
- [ ] Saturday Rule
- [ ] Hours on a Working Saturday
- [ ] Custom Saturday Hours
- [ ] Mandatory Holiday Overrides Saturday
- [ ] Allow Compensatory Hours
- [ ] Compensation Window (days)
- [ ] Make-Up Day Chosen By
- [ ] Allow Make-Up on a Week Off
- [ ] Allow Make-Up on a Mandatory Holiday
- [ ] Max Compensatory Hours per Month
- [ ] Uncompensated Shortfall Becomes
- [ ] Excess Hours Become
- [ ] Status
- [ ] Cycle Type
- [ ] Start Day
- [ ] End Day
- [ ] Salary Credit Day
- [ ] Resolved Periods

**Buttons / actions (1):**
- [ ] + Add Policy

## 3.21 Email Configuration

**Fields (36):**
- [ ] Sending Enabled
- [ ] Provider
- [ ] SMTP Host
- [ ] SMTP Port
- [ ] Encryption
- [ ] Username
- [ ] Password
- [ ] From Name
- [ ] From Email Address
- [ ] Reply-To Email
- [ ] Template Name
- [ ] Triggered From
- [ ] Enabled
- [ ] Subject Line
- [ ] Body
- [ ] Financial Year
- [ ] Taxes
- [ ] Expense Types
- [ ] Leave Types
- [ ] Holidays
- [ ] Work Week & Hours
- [ ] Company Profile — General Info, Addresses, Bank Details, Documents
- [ ] Company Profile — Number Prefixes
- [ ] Bank Account
- [ ] Payment Mode
- [ ] Department
- [ ] Designation / Job Title
- [ ] HSN / SAC Code
- [ ] Service Category
- [ ] Unit of Measure
- [ ] Ticket Categories
- [ ] Customer Status
- [ ] Asset Categories
- [ ] Employment Type
- [ ] Insurance Plans
- [ ] Email Configuration


# Module 2 of 14: Employee

`02-employee-module.md`

## 2.1 Employee Directory

*The searchable master list of every staff member at Meshrd — the entry point for anyone doing HR, payroll, or account-related work on employees other than themselves.*

**Roles:** Super Admin, Manager, Accountant, HR. An Employee does not use this screen at all — they see their own record through My Profile (Section 2.3) instead, and cannot browse anyone else's record here.

**Tabs (1):**
- [ ] None — this is a single table view

**Fields (11):**
- [ ] Employee ID
- [ ] Photo
- [ ] Name
- [ ] Department
- [ ] Designation
- [ ] Employment Type
- [ ] Status
- [ ] Reporting Manager
- [ ] Phone
- [ ] Joining Date
- [ ] Actions

**Buttons / actions (1):**
- [ ] + Add Employee

**Filters:**
- [ ] Department (from Masters), Designation (from Masters), Status (Active / Inactive / On Notice / Exited — multi-select), Employment Type (from Masters, multi-select), Reporting Manager, Work Location, and Joining Date range. Plus the baseline set (search, date range, status, owner, active/inactive) de

**Empty state:**
- [ ] "No employees added yet." with a prompt to add the first employee, shown only to the roles that can add one (HR, Super Admin).

## 2.2 Employee Master Record

*The complete HR record for one staff member — personal details, employment details, login and role, bank and statutory information, salary structure link, emergency contact, documents, and read-only summaries pulled from Asset Management and Leave.*

**Roles:** HR and Super Admin can create and edit it. Manager and Accountant can open it in read-only mode, and only for employees within their allowed scope (Manager: their own direct reports; Accountant: everyone, but view-only). An Employee does not use this screen for themselves — they 

**Tabs (10):**
- [ ] Personal Details
- [ ] Employment Details
- [ ] Account & Login
- [ ] Bank & Statutory
- [ ] Salary Structure
- [ ] Insurance & Benefits
- [ ] Emergency Contact
- [ ] Documents
- [ ] Assigned Assets (read-only)
- [ ] Leave & Attendance Summary (read-only)

**Fields (49):**
- [ ] Photo
- [ ] First Name
- [ ] Last Name
- [ ] Email
- [ ] Phone
- [ ] Date of Birth
- [ ] Gender
- [ ] Current Address
- [ ] Department
- [ ] Designation
- [ ] Joining Date
- [ ] Employment Type
- [ ] Reporting Manager
- [ ] Status
- [ ] Create Login
- [ ] Login Email
- [ ] Set Role
- [ ] Extra Permissions
- [ ] Account Status
- [ ] Must Change Password on Next Login
- [ ] Reset Password
- [ ] Last Login
- [ ] Bank Name
- [ ] Bank Account Number
- [ ] Confirm Bank Account Number
- [ ] IFSC Code
- [ ] PAN
- [ ] Aadhaar Number
- [ ] Statutory Identifiers
- [ ] Effective From
- [ ] Basic Salary (Monthly)
- [ ] Dearness Allowance — DA (Monthly)
- [ ] HRA — House Rent Allowance (Monthly)
- [ ] Leave Travel Allowance — LTA (Monthly or Annual)
- [ ] Special Allowance (Monthly)
- [ ] Variable / Performance Pay (Annual or Quarterly)
- [ ] Other Earnings (Monthly)
- [ ] Statutory Deductions & Contributions
- [ ] Insurance — Employee Contribution (Monthly)
- [ ] Gross Monthly
- [ ] Net Monthly (before income tax)
- [ ] Annual CTC
- [ ] Insurance Plan
- [ ] Enrollment Date
- [ ] Dependents Covered (Health plans only)
- [ ] Nominee (Life/Accident plans only)
- [ ] Contact Name
- [ ] Relationship
- [ ] Contact Phone

**Buttons / actions (6):**
- [ ] Edit
- [ ] Save Changes
- [ ] Cancel
- [ ] + Add Permission Override
- [ ] Save, Cancel — part of the same Edit/Save flow as the rest of this record (HR/Super Admin — though see the Role Access note below: only Super Admin edits this specific tab, HR views it).
- [ ] + Record Attendance

**Empty state:**
- [ ] "Not enrolled in any insurance plan yet."

## 2.3 My Profile (Self-Service)

*The same employee record as Section 2.2, but opened by the logged-in person about themselves, with fields split by what they can and can't touch directly.*

**Roles:** All 5 roles — Super Admin, Employee, Manager, Accountant, HR — since everyone is also a staff member with their own record. This screen always shows the logged-in person's own data only; it is never used to view or edit someone else's record (that's Section 2.2, restricted as des

**Buttons / actions (1):**
- [ ] Edit (for the directly-editable group), Save, Cancel, Request Change (for the approval group, per field), Cancel Request (on a still-pending request, to withdraw it), Change Password (opens the form above).

## 2.4 My Leave (Self-Service)

*The employee's own leave balance, history, and a way to apply for leave. Full leave rules, approval logic, and balance calculations belong to the Leave module — this screen only shows the employee-facing view of that data.*

**Roles:** All 5 roles, for their own leave. Manager additionally sees a Team Leave Requests view for direct reports (described briefly below).

**Fields (10):**
- [ ] Leave Type
- [ ] Allowed
- [ ] Carried Forward
- [ ] Taken
- [ ] Pending
- [ ] Remaining
- [ ] From Date
- [ ] To Date
- [ ] Half-Day
- [ ] Reason

**Buttons / actions (1):**
- [ ] Apply for Leave

**Filters:**
- [ ] Leave Type (from Masters, multi-select), Status (Pending / Approved / Rejected / Cancelled — multi-select), Financial Year, and a From/To date range on the leave dates. On Manager's Team Leave Requests view, the same filters plus Employee. Search covers the reason/comment text. Plus the baseline set

## 2.5 My Payslips (Employee View)

*Viewing and downloading payslips that have already been processed. Running payroll and calculating pay is documented separately, in the Payroll module — this screen is only about an employee viewing and downloading pay already processed.*

**Roles:** All 5 roles, for their own payslips.

**Filters:**
- [ ] Financial Year (or plain calendar year), Month range, Net Pay range, and Payslip Status (Processed / Reissued). Search covers Pay Period. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

## 2.6 My Documents (Self-Service)

*Where an employee uploads their own personal paperwork (ID proof, certificates, and similar), and tracks whether HR has verified each one.*

**Roles:** All 5 roles, for their own documents. HR (and Super Admin) additionally get a Document Verification Queue covering everyone — described below.

**Fields (9):**
- [ ] Document Type
- [ ] File Name
- [ ] Uploaded On
- [ ] Status
- [ ] Rejection Reason
- [ ] Actions
- [ ] File
- [ ] Note
- [ ] Employee Name

**Buttons / actions (1):**
- [ ] + Upload Document

**Filters:**
- [ ] Document Type, Status (Pending Verification / Verified / Rejected — multi-select), and Uploaded On date range. Search covers File Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Added in this revision — this list previously had none.
- [ ] Employee, Department (from Masters), Document Type, Status (defaults to Pending Verification, but Verified and Rejected can be included — multi-select), Uploaded On date range, and a "waiting more than N days" toggle for the queue's real purpose, which is finding what has been sitting too long. Sear

**Empty state:**
- [ ] "No documents uploaded yet." with a prompt to upload the first one.

## 2.7 My Tickets

*Support tickets currently assigned to this employee to resolve. Full ticket rules, priority logic, and lifecycle belong to the Ticket module — this screen is the employee-facing view of tickets assigned to them.*

**Roles:** All 5 roles, for tickets assigned to them. Manager additionally sees their team's ticket load (a count, not full detail).

**Filters:**
- [ ] Status (multi-select), Priority (multi-select), Category (from Masters), Requester, Assigned On date range, Due Date range, and an "Overdue only" toggle. Search covers Ticket Number and Subject. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Expanded in thi

**Empty state:**
- [ ] "No tickets assigned to you right now."

## 2.8 My Projects & Tasks

*Every project the employee is part of, and their own tasks/bugs across those projects. Full project rules — sprints, milestones logic, timesheet rules — belong to the Project module. This screen is the employee-facing view.*

**Roles:** All 5 roles, for their own project involvement.

**Filters:**
- [ ] Projects: Project Status (multi-select), Service Category (from Masters), Customer, and a date range on project start. Tasks & Bugs: Project, Status (multi-select), Priority (multi-select), Type (Task / Bug), Due Date range, and an "Overdue only" toggle. Search covers Project Name on the first list,

**Empty state:**
- [ ] "You're not assigned to any projects yet." / "No tasks assigned to you."

## 2.9 My Assets

*Company assets currently assigned to the employee (laptop, ID card, and similar), and a way to flag a problem with one. Full asset rules belong to Asset Management — this screen is the employee-facing view.*

**Roles:** All 5 roles, for assets assigned to them. Manager approves requests raised by direct reports (see below).

**Fields (4):**
- [ ] Asset
- [ ] Request Type
- [ ] Description
- [ ] Photo

**Buttons / actions (1):**
- [ ] Raise Repair / Damage / Return Request

**Filters:**
- [ ] Category (from Masters), Condition, and Assigned Date range. Search covers Asset Tag and Asset Name. On the My Requests history below: Request Type, Status (multi-select), and Date Raised range. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Empty state:**
- [ ] "No assets assigned to you yet."

## 2.10 Employee Dashboard

*The home screen a person lands on right after logging in — a quick snapshot of their own status plus fast links everywhere else.*

**Roles:** All 5 roles. Manager's version adds a "My Team" strip.

**Fields (8):**
- [ ] Leave balance snapshot
- [ ] Latest payslip
- [ ] Open tickets count
- [ ] Pending tasks count
- [ ] Assigned assets count
- [ ] Company announcements
- [ ] Recent activity feed
- [ ] Quick links

**Empty state:**
- [ ] any widget with nothing to show displays a light, friendly message instead of an empty box (e.g. "No open tickets — nice and clear," "No announcements right now").

## 2.11 Announcements / Notifications

*Two related but separate things — company-wide announcements posted by HR/Super Admin, and personal notifications generated automatically for each user.*

**Roles:** All 5 roles see their own notifications and all published announcements. Posting a new announcement is HR and Super Admin only.

**Fields (4):**
- [ ] Title
- [ ] Message
- [ ] Post To
- [ ] Expiry Date

**Buttons / actions (1):**
- [ ] Mark all as read

**Filters:**
- [ ] (the header dropdown panel stays a simple recent list; filtering a notification popover would be over-built). Notifications: Type (leave / document / payslip / ticket / task / asset / profile change — multi-select), Read/Unread, and a date range. Announcements: Posted By, Post To scope, Active/Expir

**Empty state:**
- [ ] "No notifications yet." / "No announcements right now."

## 2.12 Onboarding Checklist (HR-Facing)

*Guides HR through everything that needs to happen when someone new joins, as a simple checklist tied to that employee's record.*

**Roles:** HR and Super Admin.

**Buttons / actions (1):**
- [ ] Send Welcome Email

**Empty state:**
- [ ] once all 7 steps are checked, the checklist shows a simple "Onboarding complete" confirmation and collapses out of HR's default to-do view (still viewable if opened directly).

**Workflow / functionality:**
- [ ] Create Employee Master record
- [ ] Create login (optional)
- [ ] Assign a Reporting Manager
- [ ] Set up this year's leave balance
- [ ] Link a Salary Structure
- [ ] Assign starter assets
- [ ] Send welcome email

## 2.13 Offboarding / Exit

*Two halves of the same process — an employee raising a resignation, and HR working through everything that needs to happen before that person's access ends.*

**Roles:** Any of the 5 roles can raise their own resignation, from My Profile. Manager acknowledges/approves for direct reports. HR and Super Admin run the exit checklist for anyone.

**Fields (2):**
- [ ] Last Working Day
- [ ] Reason

**Workflow / functionality:**
- [ ] Generate the resignation acceptance letter
- [ ] Return all assigned assets
- [ ] Mark final settlement due
- [ ] Disable login
- [ ] Change status to Exited

## 2.14 My Tax Declarations (Self-Service)

*Each financial year, an employee declares the amounts that reduce their taxable income — so Payroll (Module 6) can calculate accurate monthly income tax instead of over- or under-deducting all year and leaving a large correction at filing time.*

**Roles:** All 5 roles, for their own declaration only — part of the same baseline every self-service screen in this module follows. HR and Super Admin can view (not edit) any employee's declaration, for verification purposes (see below).

**Fields (6):**
- [ ] Financial Year
- [ ] Tax Scheme
- [ ] Declaration Name
- [ ] Guidance
- [ ] Amount Declared (₹)
- [ ] Proof Upload

**Buttons / actions (1):**
- [ ] Save as Draft, Submit (locks it for the financial year), Cancel.

## 2.15 Offer & Appointment Letter (HR-Facing)

**Roles:** Accountant, Super Admin. (Corrected 2026-08-03 — this line previously said "HR, Super Admin," contradicting this document's own access table in Section 6.1, which has always given this screen to Accountant with HR at No access. The build follows the access table; the seeded polic

**Fields (6):**
- [ ] Employee
- [ ] Letter Type
- [ ] Designation, Department, Joining Date, Employment Type
- [ ] Compensation Summary
- [ ] Statutory Components Disclosed
- [ ] Custom Terms

**Buttons / actions (2):**
- [ ] Generate Letter
- [ ] Preview, Generate PDF, Send to Employee (email with the letter attached — Assumption: requires the same explicit-permission pattern as any other outbound message in this CMS).

**Empty state:**
- [ ] "No letter generated yet for this employee."

## 3.6 New Login Created → Temporary Password → Forced Change on First Login

**Empty state:**
- [ ] , matching the tone used throughout this document: "No employees added yet," "No documents uploaded yet," "No assets assigned to you yet," "No tickets assigned to you right now," "You're not assigned to any projects yet," "No notifications yet."

## 6.1 Screen-by-Screen Access Table

**Fields (24):**
- [ ] 2.1 Employee Directory
- [ ] 2.2 Employee Master Record (others' records)
- [ ] — Edit Salary Structure specifically
- [ ] — Edit Insurance & Benefits specifically
- [ ] 2.3 My Profile
- [ ] — Approve/reject profile change requests
- [ ] 2.4 My Leave
- [ ] — Team Leave Requests / leave approval (approve/reject)
- [ ] 2.5 My Payslips
- [ ] 2.6 My Documents
- [ ] — HR Document Verification Queue
- [ ] 2.7 My Tickets
- [ ] — Team Ticket Load (count)
- [ ] 2.8 My Projects & Tasks
- [ ] 2.9 My Assets
- [ ] — Approve asset requests
- [ ] 2.10 Employee Dashboard
- [ ] 2.11 Announcements/Notifications
- [ ] 2.12 Onboarding Checklist
- [ ] 2.13 Offboarding — raise own resignation
- [ ] 2.13 Offboarding — acknowledge/process for others
- [ ] 2.14 My Tax Declarations
- [ ] — View any employee's declaration (verification)
- [ ] 2.15 Offer & Appointment Letter

## 7.3 Milestones — Future Flow (lighter note)

**Buttons / actions (1):**
- [ ] + Add Permission Override

**Workflow / functionality:**
- [ ] Employee ID format
- [ ] Address field
- [ ] Bank details access, resolved
- [ ] Personal Details fields not explicitly categorized
- [ ] Minimum age
- [ ] Reset Password mechanism — changed in a later revision.
- [ ] Statutory fields added
- [ ] Document file rules
- [ ] Ticket priority values
- [ ] Leave proration on joining mid-year
- [ ] Role column order
- [ ] Attendance Method selector
- [ ] Extra Permissions on the record
- [ ] Planned Features section (7)
- [ ] Corrections driven by building the Leave module (Module 5):
- [ ] Correction driven by building the Payroll module (Module 6):
- [ ] EDLI removed, per explicit instruction.
- [ ] This revision — two real gaps closed, requested directly.
- [ ] A real gap in the login flow, closed.


# Module 3 of 14: Asset Management

`03-asset-management-module.md`

## 2.1 Asset Directory

*The searchable master list of every company-owned asset — the entry point for anyone managing, financing, or tracking assets.*

**Roles:** Super Admin, Accountant, HR, and Manager (their direct reports' assets only — same scoping pattern as the Employee Directory in the Employee module). Employee does not use this screen at all; their own assigned assets live in the Employee module's My Assets screen.

**Tabs (1):**
- [ ] None — single table view

**Fields (7):**
- [ ] Asset Tag
- [ ] Name
- [ ] Category
- [ ] Status
- [ ] Assigned To
- [ ] Purchase Value
- [ ] Current Value

**Buttons / actions (2):**
- [ ] + Add Asset
- [ ] Download Asset List

**Filters:**
- [ ] Category (from Masters), Status (In Use / In Store / Under Repair / Retired-Disposed — multi-select), Assigned Employee, Location, Department, Purchase Date range, Order Date range, Warranty Expiry range (the "expiring in 90 days" preset is a frontend shortcut over the built range parameters, not a 

**Empty state:**
- [ ] "No assets added yet." (or, when a filter is active and returns nothing, "No assets match your filters.")

## 2.2 Add / Edit Asset (Asset Master Record)

*The complete record for one company asset — its identity, purchase details, current condition, assignment, depreciation, and supporting files.*

**Roles:** Accountant and Super Admin can create and fully edit the core and financial fields. HR can open it to change assignment/status through the dedicated actions on the Assignment tab (2.3), not by editing this form directly. Manager can view it, scoped to their direct reports' assets

**Tabs (1):**
- [ ] Details

**Fields (18):**
- [ ] Asset Tag
- [ ] Asset Name
- [ ] Category
- [ ] Serial Number
- [ ] Order Date
- [ ] Purchase Date
- [ ] Purchase Value (INR)
- [ ] Useful Life (Years)
- [ ] Vendor
- [ ] Warranty Expiry
- [ ] Location / Branch
- [ ] Department
- [ ] Status
- [ ] Assigned To
- [ ] Depreciation Method
- [ ] Notes
- [ ] Retired Date / Retirement Reason
- [ ] Attachments

**Buttons / actions (1):**
- [ ] Save (create or update the Details tab), Cancel, "Mark Retired/Disposed" (see the confirm-before-you-go rule in Section 4).

## 2.3 Assign / Transfer / Unassign

*The three administrative actions that change who holds an asset, each one logged permanently in that asset's Assignment History.*

**Roles:** HR and Super Admin perform these actions directly. Accountant can view this tab but not act on it (view-only on physical assignment, per Section 6). Manager can view their direct reports' assignment history but cannot perform any of these three actions themselves — see the note b

**Fields (6):**
- [ ] Employee
- [ ] From Date
- [ ] To Date
- [ ] Action
- [ ] Performed By
- [ ] Reason

**Empty state:**
- [ ] "No assignment history yet."

## 2.4 Maintenance & Service Log

*A record of everything done to service or repair an asset, both on the asset's own record and as a company-wide list for planning upcoming work.*

**Roles:** Accountant and Super Admin can add and edit entries (Cost is a financial figure, so this sits with the same roles who manage Purchase Value and Depreciation). HR and Manager can view — Manager scoped to their direct reports' assets. Employee has no access, consistent with the res

**Fields (6):**
- [ ] Date
- [ ] Description
- [ ] Cost
- [ ] Next Due Date
- [ ] Serviced By (Vendor)
- [ ] Status

**Buttons / actions (1):**
- [ ] + Add Maintenance Entry

**Filters:**
- [ ] Category, Location, Asset (specific), Serviced By/Vendor, Service Date range, Next Due Date range, Cost range, and the quick toggles "Overdue only" and "Upcoming only" (these two toggles are what's built for status narrowing — a full three-value Maintenance Status multi-select filter parameter wasn'

**Empty state:**
- [ ] "No maintenance logged yet."

## 2.6 Asset Requests (Approval Queue)

*Where Repair, Damage, and Return requests raised by employees (from the Employee module's My Assets screen) get reviewed and actioned.*

**Roles:** Manager (their direct reports' requests) and Super Admin (any request). Accountant and HR do not act on these — repair/damage/return is an operational, team-level concern, not a financial or HR-onboarding one. See the Section 2.3 note above on why Transfer isn't a request type he

**Filters:**
- [ ] Status (Pending / Approved / Rejected — multi-select; the "Completed" status value in the original filter list was never a defined request status anywhere in this document and was not built — a request only ever ends Approved or Rejected), Request Type, Requester, Approver, Asset Category, and Date 

**Empty state:**
- [ ] "No pending requests."

## 2.7 Asset Reports

*A simple reporting screen — no editing happens here, just filtered summaries.*

**Roles:** Accountant, HR, Super Admin (company-wide). Manager sees the same reports scoped to their direct reports' assets only, with the same Purchase/Current Value visibility rule as everywhere else in this module (hidden unless the toggle is on).

**Filters:**
- [ ] Category, Location, Department, Status, Assigned Employee, Purchase Date range, and Purchase Value range; Manager gets the whole report team-scoped. (A separate Financial Year filter wasn't built — the Purchase Date range covers the same slice.) Plus the baseline set from the Filter & Export Convent

**Empty state:**
- [ ] "No data for this filter yet."

## 2.8 Reclaim on Exit

*The Asset Management side of an employee leaving — triggered from the Employee module's Offboarding checklist, and feeding back into it once complete.*

**Roles:** HR and Super Admin.

**Empty state:**
- [ ] "This employee has no assets currently assigned." — in which case the checklist item completes immediately.

## 3.5 Maintenance Logged Over an Asset's Life

**Empty state:**
- [ ] , matching the tone used elsewhere: "No assets added yet," "No assets in this category yet," "No maintenance logged yet," "No assignment history yet," "No pending requests."

## 6.1 Field-Level Access on the Asset Master Record

**Columns (1):**
- [ ] Core Info

**Fields (2):**
- [ ] Purchase & Financial
- [ ] Assignment & Location

## 6.2 Screen-by-Screen Access Table

**Fields (9):**
- [ ] 2.1 Asset Directory
- [ ] 2.2 Asset Master Record
- [ ] 2.3 Assign / Transfer / Unassign
- [ ] 2.4 Maintenance & Service Log
- [ ] 2.5 Depreciation & Current Value
- [ ] 2.6 Asset Requests (approval queue)
- [ ] 2.7 Asset Reports
- [ ] 2.8 Reclaim on Exit
- [ ] 2.9 Download Asset Card / List

## 6.5 Nothing Here Is Hardcoded

**Buttons / actions (1):**
- [ ] Reassign

**Workflow / functionality:**
- [ ] Useful Life (Years)
- [ ] Purchase Value kept optional
- [ ] Status and Assigned To locked after creation
- [ ] Location/Branch reuses Company Profile's Addresses
- [ ] Asset Categories is now built in Masters
- [ ] Order Date added
- [ ] Export and filters confirmed on every list/table screen in this module
- [ ] Transfer-as-a-request inconsistency, resolved
- [ ] Damage Report approval behaves like Repair approval
- [ ] Retired Date
- [ ] Warranty/maintenance "due soon" window
- [ ] Attachment file rules
- [ ] Status tag colors
- [ ] "Allow HR to Edit Core Info" toggle
- [ ] "Condition" — never specified, deliberately not built.
- [ ] Maintenance entries are append-only as built
- [ ] Baseline principle sharpened in Section 6


# Module 4 of 14: Ticket

`04-ticket-module.md`

## 2.1 Ticket List

*The full, searchable table of every support ticket — the entry point for anyone working or overseeing support.*

**Roles:** Super Admin and Manager see every ticket. Employee sees only tickets assigned to them — this filtered view is the same underlying data as the Employee module's My Tickets screen, just presented as the full-featured version here. Accountant and HR have no access to this module at 

**Tabs (1):**
- [ ] None — single table view

**Fields (10):**
- [ ] Ticket Number
- [ ] Customer
- [ ] Subject
- [ ] Category
- [ ] Priority
- [ ] Status
- [ ] Assigned To
- [ ] Raised Date
- [ ] Due Date
- [ ] First-Response Time

**Buttons / actions (1):**
- [ ] + New Ticket

**Filters:**
- [ ] Status, Priority, Category (from Masters), Customer, Assigned Staff — all as listed in the brief, and all now multi-select where a single value was previously implied. Added in this revision: Raised By, Raised Date range, Due Date range, Resolved/Closed Date range, an "Overdue only" toggle, an "Unas

**Empty state:**
- [ ] "No tickets yet." / "No tickets match your filters."

## 2.2 New / Edit Ticket

*Creating a new support ticket, or editing one that already exists.*

**Roles:** Manager and Super Admin by default. Employee only if "Allow Staff to Create New Tickets" is turned on for their role (Section 6) — Assumption, added since the brief didn't explicitly say whether Employee can log a new ticket themselves (e.g., if a customer calls them directly), o

**Fields (8):**
- [ ] Customer
- [ ] Category
- [ ] Subject
- [ ] Priority
- [ ] Description
- [ ] Assigned To
- [ ] Due Date
- [ ] Linked Project

**Buttons / actions (1):**
- [ ] Save (create or update), Cancel.

## 2.3 Ticket Detail / Conversation Screen

*The main working screen for a ticket — where staff actually read and respond to a customer issue.*

**Roles:** Manager and Super Admin, any ticket. Employee, only if the ticket is assigned to them — as built, every single-ticket operation (detail, edit, conversation, status, reassign, assignment history) runs through one shared scope check, and a ticket outside the Employee's scope reads 

**Columns (1):**
- [ ] Entry Type

**Fields (2):**
- [ ] Content
- [ ] Attachment

**Buttons / actions (1):**
- [ ] Send Reply, Add Internal Note (the composer's single Send button, its action depending on the Entry Type toggle), Change Status, Reassign (shortcut into 2.4, shown only to roles who can reassign).

**Empty state:**
- [ ] "No replies yet — be the first to respond."

## 2.4 Assign / Reassign Ticket

*Picking who's responsible for a ticket, whether that's a first assignment or handing it to someone else.*

**Roles:** Manager and Super Admin by default. Employee only if "Allow Staff to Reassign Their Own Ticket" is on for their role, and even then only for tickets already assigned to them (Section 6).

**Fields (2):**
- [ ] New Assignee
- [ ] Note

## 2.5 Support Reports

*A simple reporting screen summarizing support activity — no editing happens here.*

**Roles:** Manager and Super Admin by default. Employee only if "Show Support Reports to Staff" is on for their role (Section 6). Accountant and HR have no access.

**Buttons / actions (1):**
- [ ] "Download Report" (CSV/PDF), same simple download pattern used in Asset Reports — deferred in the build: the endpoint returns a pure aggregate, not a flat row list, so there is nothing for the shared list-export engine to render (see "Deferred / not implemented" above).

**Filters:**
- [ ] Date Range (based on Raised Date) as given in the brief. Assumption, added for consistency with other Reports screens in this CMS: also Category, Assigned Staff, Customer, Priority, and Status, for a more granular breakdown. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14,

**Empty state:**
- [ ] "No tickets in this date range."

## 3.3 A Ticket Linked to a Project

**Empty state:**
- [ ] "No tickets yet," "No tickets match your filters," "No replies yet — be the first to respond," "No tickets in this date range."

## 6.2 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] Search fields on the Ticket List
- [ ] Ticket creation restricted to Manager/Super Admin by default
- [ ] Linked Project dropdown filtered by the selected Customer
- [ ] First Public Reply auto-moves Open → In Progress
- [ ] Satisfaction Rating is manually recorded by staff at close
- [ ] Assignment History added
- [ ] Reply/Note attachments added
- [ ] Ticket Categories — resolved.
- [ ] "What does Manager mean" — resolved in Module 11 (Invoice).
- [ ] Checked directly against Sheet1
- [ ] Export and filters confirmed


# Module 5 of 14: Leave

`05-leave-module.md`

## 2.1 My Leave (Self-Service)

*Checking your own leave balance, applying for leave, and seeing your own history — identical for every role.*

**Roles:** All 5 roles, for their own leave only.

**Fields (12):**
- [ ] Allowed
- [ ] Carried Forward
- [ ] Taken
- [ ] Pending
- [ ] Adjustments
- [ ] Remaining
- [ ] Employee
- [ ] Leave Type
- [ ] From Date
- [ ] To Date
- [ ] Half-Day
- [ ] Reason

**Buttons / actions (2):**
- [ ] Apply for Leave
- [ ] Cancel Request

**Filters:**
- [ ] Built: Status. Deferred (documented here but not yet on the backend endpoint — the list API currently accepts only status): Leave Type (multi-select), Financial Year, a From/To range on the leave dates, a range on Date Applied, Half-Day (Yes/No), Actioned By, and Search over Reason text. These remai

## 2.2 Leave Approvals

*The queue where a pending request actually gets decided — the routing rule below determines who sees what.*

**Roles:** Manager (requests from their own direct reports), HR (every pending request, company-wide), Super Admin (every pending request, and the last-resort fallback approver).

**Columns (7):**
- [ ] Employee
- [ ] Leave Type
- [ ] Dates
- [ ] Days
- [ ] Reason
- [ ] Date Applied
- [ ] routed_to_user_id

**Filters:**
- [ ] Built: Status as a multi-select (per RBAC §2.2(c), never single-select); when no Status is supplied the queue defaults to Pending only — this is the action list, not history. Deferred (not yet on the backend endpoint): Employee, Department (from Masters), Leave Type (multi-select), Routed To, Date A

**Workflow / functionality:**
- [ ] Default case:
- [ ] No Reporting Manager set:
- [ ] Nobody is in HR
- [ ] A person never approves their own request.
- [ ] HR's standing override:

## 2.3 Leave Balance Management

*HR and Super Admin's admin view of everyone's balances — corrections, and the year-end carry-forward run.*

**Roles:** HR, Super Admin.

**Fields (2):**
- [ ] Adjustment Amount
- [ ] Reason / Note

**Buttons / actions (2):**
- [ ] Adjust Balance
- [ ] Run Year-End Carry-Forward

## 2.4 Company Holiday Calendar

*Letting everyone see the official holiday list before they plan or apply for leave.*

**Roles:** All 5 roles — read-only for everyone, since this is sourced entirely from Masters (Section 3.5) and isn't editable from here at all. Editing the list happens in Masters, by whichever roles are permitted there (Super Admin and Manager, per the Masters module). Built: there is no s

**Filters:**
- [ ] Month, Financial Year, Type (Mandatory / Optional — multi-select), and a date range. Search covers Holiday Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). All five roles get the identical filter set here — this screen shows the same company-wide data t

**Empty state:**
- [ ] "No holidays set up for this financial year yet." (would point back to Masters, for whichever role manages it there).

## 2.5 Leave Reports

*A read-only reporting screen — no edits happen here.*

**Roles:** HR, Super Admin, Accountant. Accountant's access is specifically for payroll and financial planning purposes — not because Accountant manages leave day-to-day, which is why Accountant has no approval rights anywhere else in this module.

**Buttons / actions (1):**
- [ ] "Export to PDF" and "Export to Excel" (format=pdf|excel) on the three list-shaped views. Leave Liability carries no export — it is a single headline figure, not a list, so there is nothing list-shaped to export; it appears in JSON with its financial year, employee count, and component totals. Every 

**Filters:**
- [ ] Financial Year (defaulting to the current one), Department, Leave Type, Designation, Employment Type, Reporting Manager, Employee Status, and Leave Status as a multi-select (so a report can include or exclude Pending requests, which materially changes a liability figure — when Pending is excluded, h

**Empty state:**
- [ ] "No leave data for this date range."

## 2.6 Compensatory Hours

*The screen that keeps a bad afternoon from becoming a pay cut. When someone falls short of the day's net working hours, they make the balance up on a day of their own choosing — this is where that is requested, approved, and tracked. Approved make-up hours are credited against th*

**Fields (15):**
- [ ] Request #
- [ ] Employee
- [ ] Shortfall Date
- [ ] Hours Short
- [ ] Day Status That Day
- [ ] Reason for the Shortfall
- [ ] Make-Up Date
- [ ] Day Type
- [ ] Hours You Will Work
- [ ] Planned Check-In / Check-Out
- [ ] Window Check
- [ ] Monthly Cap Check
- [ ] Status
- [ ] Routed To
- [ ] Payroll Impact if Rejected

**Buttons / actions (1):**
- [ ] + Request Compensatory Hours.

**Filters:**
- [ ] Built: Status (on both lists; the approvals queue defaults to Pending). Deferred (not yet on the backend endpoints): Employee, Department, Period, and Search — per the Filter & Export Convention (RBAC, Module 14, Section 2.2), expected with the frontend's list-screen pass. Export (built, format=pdf|

**Empty state:**
- [ ] "No compensatory hour requests."

## 3.5 An Employee Makes Up Hours They Fell Short Of

**Workflow / functionality:**
- [ ] They nominate the make-up date themselves.

## 6.2 Nothing Here Is Hardcoded

**Buttons / actions (1):**
- [ ] Download Report

**Workflow / functionality:**
- [ ] "Taken" defined as all Approved requests, past or future
- [ ] A person never approves their own leave request
- [ ] Adjustment History added
- [ ] Carry-forward preview step before committing
- [ ] New-balance proration formula
- [ ] Reject's comment is now required, not optional
- [ ] Team Leave Calendar removed entirely, per explicit instruction.
- [ ] Export confirmed


# Module 6 of 14: Payroll

`06-payroll-module.md`

## 2.1 Run Payroll (+ Payroll History)

*The core monthly calculation — pick a period, calculate pay, review it, then generate payslips.*

**Roles:** Accountant, HR, and Super Admin by default. Manager only if "Allow Manager to Run Payroll" is turned on (Section 6) — see the note in Section 6 for why this defaults off despite what the source sheet originally gave Manager.

**Fields (6):**
- [ ] Month
- [ ] Year
- [ ] Pay Period Covers
- [ ] Salary Credit Date
- [ ] Working Days in Month
- [ ] Employee Selection

**Buttons / actions (2):**
- [ ] Save as Draft
- [ ] Confirm & Generate Payslips

**Filters:**
- [ ] Financial Year, Run Status (Draft / Processed — multi-select), plus Month range, Run By, Run On date range, and Employee Count range *(these four, and the period-label search, are not yet wired as query parameters — see Implementation Status)*. Discarded Drafts never appear in the list. Plus the bas

**Workflow / functionality:**
- [ ] Paid days
- [ ] Unpaid leave
- [ ] Holidays and weekends
- [ ] Statutory deductions and contributions, per employee
- [ ] Income tax, per employee
- [ ] Already-processed skip, per employee:
- [ ] Ad-hoc Adjustments, if any are pending for this employee

## 2.1a Ad-hoc Payslip Adjustments

**Roles:** Accountant, Super Admin.

**Fields (9):**
- [ ] Applies To
- [ ] Label
- [ ] Type
- [ ] Amount (₹)
- [ ] Taxable
- [ ] Recurring
- [ ] Applies To Component
- [ ] Effective From
- [ ] Note / Reason

**Buttons / actions (2):**
- [ ] "+ Add Adjustment," Edit *(not built — no edit endpoint; a wrong adjustment is Removed, reason recorded, and re-added)*, Remove — removal requires a Removal Reason, recorded with who removed it and when. Removing a Recurring adjustment stops it from future runs (any not-yet-applied per-employee targ
- [ ] + Add Adjustment,

**Filters:**
- [ ] Employee, Type (Addition / Subtraction), Taxable (Yes/No), Recurring (Yes/No), Status (multi-select, defaulting to Active), Amount range *(not yet wired)*, Created By *(not yet wired)*, and Date Added range *(not yet wired)*. Search covers the Label and Note text — which matters here more than on mo

**Empty state:**
- [ ] "No pending adjustments for this payroll run."

## 2.2 Payslip — Employee View (Self-Service Baseline)

*Viewing and downloading your own payslips, and requesting a formal Salary Certificate — identical for every role.*

**Roles:** All 5 roles, for their own pay only.

**Buttons / actions (1):**
- [ ] Download Salary Certificate

**Filters:**
- [ ] Financial Year, Month range, Net Pay range, and Payslip Status (Processed / Reissued — multi-select). Search over Pay Period is *not yet wired* (the range filters cover the same question). Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Expanded in this revi

## 2.3 Payslip — Accountant / HR View

*Full payslip access across the whole company, and the ability to correct a payslip after it's been generated.*

**Roles:** Accountant, HR, Super Admin.

**Fields (1):**
- [ ] Reason

**Buttons / actions (1):**
- [ ] Reissue Payslip

**Filters:**
- [ ] Employee, Month, Financial Year, Department (from Masters), Designation *(not yet wired)*, Employment Type, Payslip Status (Processed / Reissued — multi-select), Net Pay range, and toggles for "has ad-hoc adjustments" and "has unpaid leave" — the two reasons a payslip most often needs a second look.

## 3.1b The Pay Cycle Cutoff — a worked example

**Workflow / functionality:**
- [ ] Multi-day leave spanning the cutoff is split, not double-counted.
- [ ] Short months clamp; the credit date always follows the cutoff.

## 3.5 (Future) The Biometric Feed Replaces Manual Entry

**Fields (7):**
- [ ] Employee-borne statutory
- [ ] Company-borne statutory
- [ ] Income tax
- [ ] Insurance premium
- [ ] Unpaid leave
- [ ] Unmet hours
- [ ] Ad-hoc

## 6.1 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] Unpaid leave deduction formula — resolved and built (A115):
- [ ] Already-processed skip is per employee+month
- [ ] Draft vs. Processed, defined
- [ ] Salary Certificate Purpose field
- [ ] Reissue supports both recalculation and manual figure adjustment
- [ ] Payroll Basis (Day/Hour) — resolved:
- [ ] Salary Structure ownership — resolved, no longer open.
- [ ] The Employee module correction is applied
- [ ] Manager's broad access, corrected
- [ ] Sheet1 also lists "Tasks / Projects done" as planned
- [ ] Income tax calculation method
- [ ] Export confirmed


# Module 7 of 14: Vendor

`07-vendor-module.md`

## 2.1 Vendor Directory

*The searchable list of every supplier Meshrd has on file.*

**Roles:** Manager, Accountant, Super Admin. Employee and HR have no access — there's no personal reason a staff member needs to see supplier bank or tax details.

**Columns (1):**
- [ ] Bank Account Name

**Fields (7):**
- [ ] Vendor Name
- [ ] GSTIN
- [ ] Contact Phone / Email
- [ ] Payment Terms
- [ ] Bank
- [ ] Account Number
- [ ] Status

**Buttons / actions (2):**
- [ ] "+ Add Vendor" (opens 2.2 in create mode). Row click opens 2.2 in edit mode.
- [ ] + Add Vendor

**Filters:**
- [ ] Active / Inactive, plus — added in this revision — Vendor Category or Type where one is recorded, City/State, Payment Terms, Created On date range, "has bank details on file" (Yes/No), and "has outstanding bills" (Yes/No). The last two are the questions this directory is actually opened to answer: w

**Empty state:**
- [ ] "No vendors yet — they're often added directly from a Purchase Bill or Expense instead."

## 2.2 Add / Edit Vendor

*Creating a new supplier record, or editing one that already exists.*

**Roles:** Manager, Accountant, Super Admin can add and edit. Bank and GST fields are Accountant/Super-Admin-only by default — see Section 6 for the exact split and the toggle that changes it.

**Fields (13):**
- [ ] Vendor Name
- [ ] GSTIN
- [ ] PAN
- [ ] Contact Email
- [ ] Contact Phone
- [ ] Payment Terms (days)
- [ ] Address — Street
- [ ] Address — City
- [ ] Address — State
- [ ] Address — PIN Code
- [ ] Bank Account Number
- [ ] IFSC Code
- [ ] Status

**Buttons / actions (1):**
- [ ] Save, Cancel, Deactivate/Activate, Delete (only shown for a vendor with zero usage history).

## 2.3 Vendor Usage

*A read-only view of everywhere a vendor has actually been used — the thing that tells someone whether it's safe to deactivate or delete.*

**Roles:** Same as who can view the vendor record — Manager, Accountant, Super Admin.

**Filters:**
- [ ] Type (Purchase Bill / Expense), Status (multi-select), Date range with financial-year presets, Amount range, and Paid From account. Search covers Reference Number. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2), which applies to this screen as to every other

**Empty state:**
- [ ] "No usage yet — this vendor can be safely deleted if no longer needed."

## 3.2 Adding a New Vendor Inline, from Purchase Bill or Expense

**Buttons / actions (1):**
- [ ] + Add New Vendor

## 3.3 Deactivating a Vendor with Usage History

**Empty state:**
- [ ] "No vendors yet — they're often added directly from a Purchase Bill or Expense instead."

## 6.1 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] IFSC Code — added, resolved.
- [ ] PIN Code — added, resolved.
- [ ] Payment Terms defaults to 30 days if left blank
- [ ] No Masters-driven Vendor Code
- [ ] Inline "Add New Vendor" from Purchase Bill/Expense
- [ ] Checked directly against Sheet1
- [ ] Export and filters confirmed


# Module 8 of 14: Customer

`08-customer-module.md`

## 2.1 Customer Directory

*The searchable list of every client company on file.*

**Roles:** Manager, Super Admin. Employee, Accountant, and HR do not open this screen — see Section 6 for what limited exception exists for Accountant elsewhere. As built, this is enforced by the RBAC seed: customer.directory = full for Super Admin and Manager, none for Accountant, HR, Empl

**Columns (2):**
- [ ] Source
- [ ] Account Number

**Fields (7):**
- [ ] Company Name
- [ ] Status
- [ ] Owner
- [ ] Customer Bank Account Name
- [ ] Collected Into
- [ ] Total Invoiced
- [ ] Outstanding

**Buttons / actions (2):**
- [ ] "+ Add Customer" (opens 2.2 in create mode). Row click opens Customer 360 (2.3).
- [ ] + Add Customer

**Filters:**
- [ ] gain Source, drawn live from Masters → Customer Source (Section 3.16). BUILT — source_id query parameter.
- [ ] Status (status_id, multi-select — fixed 2026-08-05, was single-select), Source (source_id), Owner (owner_id) — plus the Search box above. Deferred (described in an earlier revision, not built): Service Category, City/State, Created On date range, Last Activity date range, Total Outstanding range, th

**Empty state:**
- [ ] "No customers yet."

## 2.2 Add / Edit Customer

*Creating a new client company record, or editing one that already exists.*

**Roles:** Manager, Super Admin.

**Fields (15):**
- [ ] Company Name
- [ ] Display Name
- [ ] GSTIN
- [ ] PAN
- [ ] Status
- [ ] Source
- [ ] Website
- [ ] Notes
- [ ] Mobile Number
- [ ] Email
- [ ] Address
- [ ] Owner
- [ ] Customer Bank Account Name
- [ ] Bank Name
- [ ] Bank Account Number

**Buttons / actions (1):**
- [ ] Save, Cancel.

## 2.3 Customer 360

*The single detail page for one customer — everything about that company and its relationship with Meshrd, in one place with tabs, not scattered across screens.*

**Roles:** Manager, Super Admin, for any customer. Accountant, only through the narrow Invoice-creation picker described in Section 6 — never this full page. Employee and HR have no access.

**Tabs (8):**
- [ ] Overview
- [ ] Contacts
- [ ] Activities
- [ ] Opportunities
- [ ] Projects
- [ ] Invoices
- [ ] Tickets
- [ ] Files

**Fields (14):**
- [ ] Name
- [ ] Designation
- [ ] Email
- [ ] Phone
- [ ] Primary Contact
- [ ] Type
- [ ] Date
- [ ] Description
- [ ] Related Contact
- [ ] File Name
- [ ] Uploaded By
- [ ] Uploaded On
- [ ] Size
- [ ] Actions

**Buttons / actions (2):**
- [ ] + Add Activity
- [ ] + Upload File

**Empty state:**
- [ ] "No contacts added yet."
- [ ] "No activities logged yet."
- [ ] "No opportunities yet."
- [ ] "No projects yet."
- [ ] "No invoices yet."
- [ ] "No tickets yet."
- [ ] "No files uploaded yet."

## 3.4 Status Moving from Prospect to Active

**Empty state:**
- [ ] , matching the tone used throughout this document: "No contacts added yet," "No activities logged yet," "No opportunities yet," "No projects yet," "No invoices yet," "No tickets yet," "No files uploaded yet."

## 6.1 Nothing Here Is Hardcoded

**Filters:**
- [ ] Partially built: the Directory carries Status, Source, Owner, and Search (the expanded Directory set is deferred — see 2.1); on the 360 tabs, Activities filters by type and date range, and the cross-module tabs (Opportunities, Projects, Invoices, Tickets) get their owning module's filters and export

**Workflow / functionality:**
- [ ] Search fields on the Customer Directory
- [ ] Display Name defaults to Company Name if left blank
- [ ] Source — removed entirely on 2026-07-30, RESTORED on 2026-07-31.
- [ ] Activity Date defaults to today
- [ ] File upload limits
- [ ] Customer Status Masters gap — resolved, no longer open.
- [ ] Confirmed against Sheet1
- [ ] This document replaces the earlier "Customer Module" specification
- [ ] Export and filters confirmed
- [ ] Customer bank fields vs. Collected Into — as built.


# Module 9 of 14: Opportunity

`09-opportunity-module.md`

## 2.1 Opportunity Pipeline

*The main list of every deal in progress, with two ways to look at it.*

**Roles:** Manager, Super Admin. Employee, Accountant, and HR have no access by default — see Section 6 for the toggles that can open narrow exceptions.

**Buttons / actions (2):**
- [ ] "+ Add Opportunity" (opens 2.2). Row/card click opens the Opportunity Record (2.3), which shows the deal's Details plus its Activities and Files.
- [ ] + Add Opportunity

**Filters:**
- [ ] on GET /opportunities: Customer, Stage (multi-select), Owner, Financial Year, Value range (value_min/value_max), Probability range, Expected Close Date range, "overdue — past expected close, still open" toggle (overdue_only — excludes Won and Lost), Created On range, Lost Reason (case-insensitive te
- [ ] The Stage summary is its own endpoint, GET /opportunities/summary/by-stage (per-stage count and total ₹ value for all five stages), and it accepts the identical filter set and builds its WHERE clause through the same shared filter-building function as the table's GET /opportunities — so the stage co

**Empty state:**
- [ ] "No opportunities yet."

## 2.2 Add / Edit Opportunity

*Creating a new deal, or editing one that already exists.*

**Roles:** Manager, Super Admin.

**Fields (8):**
- [ ] Title
- [ ] Customer
- [ ] Value
- [ ] Stage
- [ ] Probability (%)
- [ ] Expected Close Date
- [ ] Description
- [ ] Owner

**Buttons / actions (1):**
- [ ] Save, Cancel.

## 2.3 Opportunity Record — Activities & Files

*The deal's persistent record — Details (read-only, edited via 2.2) plus a chronological Activities timeline and a Files list, the same shape Customer 360 (Module 8, Section 2.3) uses for the same reason: a deal accumulates calls, emails, meetings, and documents over weeks or mont*

**Roles:** Same access as the rest of this module — Manager, Super Admin.

**Tabs (3):**
- [ ] Details
- [ ] Activities
- [ ] Files

**Fields (9):**
- [ ] Type
- [ ] Date
- [ ] Description
- [ ] Related Contact
- [ ] File Name
- [ ] Uploaded By
- [ ] Uploaded On
- [ ] Size
- [ ] Actions

**Buttons / actions (3):**
- [ ] + Add Activity
- [ ] + Upload File
- [ ] Edit (opens 2.2), Create Invoice (from a Won deal — Section 3.4), Export PDF. Export PDF of a single Opportunity record — deferred: no per-record export endpoint exists in the backend (only the Pipeline's filtered-list export, 2.1); it stays documented as intended but unbuilt until a record-level PD

**Empty state:**
- [ ] "No activities logged yet."
- [ ] "No files uploaded yet."

## 3.4 Starting an Invoice from a Won Opportunity

**Workflow / functionality:**
- [ ] How this is built:

## 6.1 Nothing Here Is Hardcoded

**Buttons / actions (1):**
- [ ] Create Invoice

**Workflow / functionality:**
- [ ] Search fields on the Pipeline Table view — resolved and built (A245):
- [ ] Drag-and-drop between Stage columns
- [ ] Probability auto-suggestion by Stage — implemented
- [ ] Quote — removed entirely on 2026-07-30, on explicit instruction.
- [ ] The Won trigger's two paths — confirmed implemented on both sides.
- [ ] Confirmed against Sheet1
- [ ] Export and filters confirmed and built
- [ ] Reconciled against the built backend (2026-08-03).


# Module 10 of 14: Project

`10-project-module.md`

## 2.1 Project Directory

*The list of every project — full for admin roles, filtered to "mine" for Employee.*

**Roles:** Super Admin and Manager see every project. Employee sees only projects they're a team member on — the same filtered list already summarised in the Employee module's My Projects & Tasks. Accountant and HR have no access by default.

**Columns (6):**
- [ ] Project Name
- [ ] Customer
- [ ] Status
- [ ] Start Date
- [ ] End Date
- [ ] Budget

**Buttons / actions (2):**
- [ ] "+ Add Project" — Manager, Super Admin only. Row click opens the project record (2.2, with its Task Board, Sprints, Bugs, and Report tabs).
- [ ] + Add Project

**Filters:**
- [ ] Customer, Status (multi-select), Project Lead, Team Member (find every project a given person is on), Start Date range, End Date range, and Budget range. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Empty state:**
- [ ] "No projects yet." For an Employee with no assignments: "You're not assigned to any projects yet," matching the wording already used in the Employee module.

## 2.2 Add / Edit Project

*Creating a new project, or editing one that already exists.*

**Roles:** Manager, Super Admin.

**Fields (10):**
- [ ] Project Name
- [ ] Customer
- [ ] Opportunity
- [ ] Status
- [ ] Start Date
- [ ] End Date
- [ ] Budget
- [ ] Description
- [ ] Project Lead
- [ ] Members

**Buttons / actions (1):**
- [ ] Save, Cancel.

## 2.3 Task Board

*The Kanban board where the team actually works — the main day-to-day screen for this module.*

**Roles:** Team members (Employee, Project Lead of any system role, and anyone else on the Members list), Manager, Super Admin — anyone with access to the project at all.

**Columns (5):**
- [ ] Backlog
- [ ] To Do
- [ ] In Progress
- [ ] In Review
- [ ] Done

**Buttons / actions (1):**
- [ ] + Add Task

**Filters:**
- [ ] Status (multi-select), Assignee, Sprint, Priority (multi-select), and Due Date range. Search covers Title and Description. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).
- [ ] — a board filtered to one assignee should show that person's counts, not the project's. Stated explicitly because a Kanban board is the screen where a filter silently applying to only some columns would be least noticeable and most misleading.

**Empty state:**
- [ ] "No tasks yet." per column, or for the whole board: "No tasks on this project yet."

## 2.4 Task Detail

*The full detail behind one card — opened by clicking it on the board.*

**Roles:** Same as the Task Board — any team member, Manager, Super Admin.

**Fields (9):**
- [ ] Title
- [ ] Description
- [ ] Assignee
- [ ] Due Date
- [ ] Status
- [ ] Priority
- [ ] Sprint
- [ ] Comments
- [ ] Sub-tasks

**Buttons / actions (2):**
- [ ] + Add Sub-task
- [ ] Save, Cancel, Delete (Manager/Super Admin only), Add Comment, Add Sub-task.

## 2.5 Sprints

*Short work cycles within a project, kept as a separate view from the general backlog/board (see Section 4).*

**Roles:** Any team member can view which sprint a task belongs to. Managing sprints — Start, Update, Complete — is restricted to Manager and Super Admin (Employee cannot manage sprints, per Section 6).

**Filters:**
- [ ] Status (multi-select), Start Date range, and End Date range. Search covers Sprint Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2), with filter-based export (format=pdf|excel; columns Name, Start Date, End Date, Status). Sorted newest-first by Start Date

**Empty state:**
- [ ] "No sprints yet."

## 2.6 Bugs

*A separate tracker from Tasks, for issues rather than planned work — same board-adjacent structure, kept visually distinct.*

**Roles:** Same as Tasks — any team member, Manager, Super Admin. Delete is Manager/Super Admin only, matching Tasks.

**Fields (8):**
- [ ] Title
- [ ] Description
- [ ] Severity
- [ ] Status
- [ ] Assignee
- [ ] Reported By
- [ ] Due Date
- [ ] Comments

**Filters:**
- [ ] Severity (multi-select), Status (multi-select), Assignee, Reported By, Due Date range, and an "Unassigned only" toggle (which exists here and not on Tasks precisely because a bug's Assignee is optional). Search covers Title and Description. Plus the baseline set from the Filter & Export Convention (

**Empty state:**
- [ ] "No bugs reported yet."

## 2.7 Project Report

*A light summary — counts, not analytics. Task and bug totals at a glance.*

**Roles:** Manager, Super Admin. Built that way: the Report has its own RBAC screen (project.report) seeded with no Employee access, so an Employee calling it gets a 404 — flagged as a toggle candidate in Section 6, and the endpoint already runs the shared per-project scope check so a futur

**Filters:**
- [ ] This screen previously stated "no charts, trends, or date-range filtering — this is deliberately light." Filters were added and built: Date range (on task/bug creation), Assignee, Sprint, Priority (single-select — it filters tasks), and Severity (single-select — it filters bugs). The date range and 

**Empty state:**
- [ ] "Nothing to report yet — add some tasks or bugs first."

## 2.8 Milestones & Timesheets

*Both are now fully designed and built, replacing the "Coming Soon" placeholder this section previously held, per your explicit direction to implement rather than leave planned.*

**Roles:** Any team member can view. Manager and Super Admin can add, edit, and delete — the same split as Tasks and Bugs (2.4, 2.6), where creation and editing are open to the team but deletion is restricted.

**Fields (11):**
- [ ] Milestone Name
- [ ] Target Date
- [ ] Description
- [ ] Linked Tasks
- [ ] Status
- [ ] Date
- [ ] Task
- [ ] Hours
- [ ] Notes
- [ ] Person
- [ ] Save as Draft

**Buttons / actions (1):**
- [ ] + Add Milestone

**Filters:**
- [ ] Status (multi-select) and Target Date range. Search covers Milestone Name. Plus the baseline set and filter-based export (format=pdf|excel; columns Name, Target Date, Status, Linked Tasks count), per the Filter & Export Convention (RBAC, Module 14, Section 2.2). Sorted by Target Date, as specified.
- [ ] Date range, Approval Status (Draft / Submitted / Approved — multi-select), and Task — the team view's filters minus the person picker, which is meaningless there. Filter-based export built (format=pdf|excel; columns Date, Task/Category, Hours, Status).
- [ ] Person, Approval Status (Draft / Submitted / Approved — multi-select), Date range, Task, and Sprint (entries whose task is in that sprint). Plus the baseline set and filter-based export (format=pdf|excel; columns Employee, Date, Task/Category, Hours, Status), per the Filter & Export Convention (RBAC

**Empty state:**
- [ ] "No milestones set for this project yet."
- [ ] "No hours logged yet."

## 6.1 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] Project Lead required on every project
- [ ] "Project Lead" used instead of "Manager"
- [ ] Bug Status values (Open / In Progress / Fixed / Closed)
- [ ] Incomplete tasks return to Backlog when a sprint completes
- [ ] Project Report not opened to Employee by default
- [ ] Budget visible to Employee on the Directory by default
- [ ] Milestones and Timesheets — implemented, not left as Coming Soon
- [ ] Confirmed against Sheet1
- [ ] Closes an open reference in the Payroll module:
- [ ] Export and filters confirmed
- [ ] Reconciled against the built backend (2026-08-03).


# Module 11 of 14: Invoice

`11-invoice-module.md`

## 2.1 Invoice Dashboard

*A landing page of company-wide numbers — how much has been billed, received, and is outstanding, plus a scan of what's overdue and what's recently come in.*

**Roles:** Accountant, Super Admin. HR sees a stripped-down version if a specific toggle is on (Section 6). Employee and Manager have no access.

**Fields (8):**
- [ ] Total Invoiced
- [ ] Received
- [ ] Outstanding
- [ ] Overdue Invoices (count)
- [ ] Total Expenses
- [ ] Active Projects
- [ ] Open Tickets
- [ ] Active Employees

**Empty state:**
- [ ] if there's genuinely nothing yet (a brand new system), each widget shows 0 or ₹0 rather than being hidden — this is a landing page, not a conditional report.

## 2.2 Invoice List

*The full, searchable table of every invoice.*

**Roles:** Accountant, Super Admin.

**Columns (9):**
- [ ] Invoice Number
- [ ] Customer
- [ ] Invoice Date
- [ ] Due Date
- [ ] Status
- [ ] Subtotal
- [ ] Tax
- [ ] Grand Total
- [ ] Received

**Buttons / actions (2):**
- [ ] "+ New Invoice" (opens 2.3 in create mode). Row click opens the invoice record (2.3).
- [ ] + New Invoice

**Filters:**
- [ ] Customer, Status (multi-select — Draft / Sent / Part-Paid / Paid), Invoice Date range, Overdue (Status is not Paid and Due Date has passed — built as a toggle on this list, not a duplicate screen), and the ageing bucket filter — Current / 1–30 / 31–60 / 61–90 / 90+ days overdue, computed by the shar

**Empty state:**
- [ ] "No invoices yet."

## 2.3 New / Edit Invoice

*Creating a new invoice, or editing one that hasn't yet locked.*

**Roles:** Accountant, Super Admin.

**Fields (24):**
- [ ] Customer
- [ ] Opportunity
- [ ] Invoice Date
- [ ] Due Date
- [ ] Reference
- [ ] Service Category
- [ ] Notes
- [ ] Customer Address
- [ ] Financial Year
- [ ] Bank Account
- [ ] Paid
- [ ] Withheld
- [ ] Settled
- [ ] Balance
- [ ] Description
- [ ] HSN Code
- [ ] Quantity
- [ ] Rate
- [ ] Line Total
- [ ] Credited Amount
- [ ] Subtotal
- [ ] Tax
- [ ] Tax Amount
- [ ] Grand Total

**Buttons / actions (3):**
- [ ] + Add Line Item
- [ ] Download
- [ ] Save, Cancel, Send (Draft → Sent — built, 409 unless the invoice is a Draft), Download. All disabled except View and Download once Status = Paid.

**Status values:**
- [ ] Draft / Sent / Part-Paid / Paid.

## 2.4 Record Payment

*Logging money that's actually come in against a specific invoice.*

**Roles:** Accountant, Super Admin. Built: POST /api/v1/invoices/{id}/payments (RBAC action record_payment), only available on an invoice with Status Sent or Part-Paid — any other status is rejected with 409. A payment-history read (GET /api/v1/invoices/{id}/payments) is also built; each pa

**Columns (1):**
- [ ] Customer Withheld Tax

**Fields (10):**
- [ ] Balance Due
- [ ] Withheld So Far on this Invoice
- [ ] Amount Received
- [ ] Withholding Calculated On
- [ ] Withheld Amount (₹)
- [ ] Amount Settled
- [ ] Mode
- [ ] Received Into (Bank Account)
- [ ] Date
- [ ] Reference

**Buttons / actions (1):**
- [ ] Record Payment, Cancel.

## 2.5 Credit Note

*Resolves the previously-open question of how to correct a Paid (locked) invoice — implemented now, per your explicit direction, rather than left as an open question. A Credit Note doesn't edit the original invoice (which stays locked and unchanged, preserving the audit trail); it*

**Roles:** Accountant, Super Admin. Assumption: Super Admin approval is required before a Credit Note takes effect, regardless of who raises it — correcting a locked financial document is exactly the kind of action worth a second set of eyes, consistent with the "Require Second Approval Bef

**Fields (5):**
- [ ] Original Invoice
- [ ] Reason
- [ ] Reason Detail
- [ ] Credit Amount
- [ ] Line Items Affected

**Buttons / actions (2):**
- [ ] Raise Credit Note
- [ ] Save as Draft, Submit for Approval, Approve (Super Admin only), Download.

**Status values:**
- [ ] Draft → Pending Approval → Approved. Built as POST /api/v1/credit-notes, PUT (Draft only — once submitted, no edits, 409), /submit, /approve (RBAC action approve), and /pdf. Approving reduces the original invoice's effective Outstanding balance by the Credit Amount (without reopening or editing the 

**Empty state:**
- [ ] no separate empty state needed — the "Raise Credit Note" action is simply available and unused until needed.

## 6.1 "What Does Manager Mean" — Resolved

**Fields (3):**
- [ ] Customer, Opportunity, Vendor, Ticket, Project
- [ ] Payroll
- [ ] Invoice

## 6.2 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] HSN Code moved to line-item level
- [ ] Tax applies once, to the invoice Subtotal
- [ ] Record Payment restricted to Sent/Part-Paid invoices
- [ ] Over-settlement blocked outright
- [ ] "Create from Project" line-item interpretation
- [ ] Customer Address is read-only with no per-invoice override
- [ ] Currency abbreviation rule
- [ ] Credit Note — implemented, resolved.
- [ ] The Dashboard's cross-module dependency is flagged, not resolved
- [ ] Confirmed against Sheet1
- [ ] "What does Manager mean" is now resolved
- [ ] Export and filters confirmed
- [ ] Doc-vs-code reconciliation (this revision).


# Module 12 of 14: Expense

`12-expense-module.md`

## 2.1 My Expenses (Self-Service)

*Submitting your own expense claims and tracking their status — identical for every role.*

**Roles:** All 5 roles, for their own expenses.

**Fields (13):**
- [ ] Type
- [ ] Claim Type
- [ ] Vendor
- [ ] Amount
- [ ] Tax
- [ ] Date
- [ ] Linked Purchase Bill
- [ ] Description
- [ ] Receipt
- [ ] Bank Account
- [ ] Reference
- [ ] Debit
- [ ] Running Balance

**Buttons / actions (4):**
- [ ] Add Expense
- [ ] + Add New Vendor
- [ ] Export Statement
- [ ] Add Expense, Save, Cancel.

**Filters:**
- [ ] (GET /expenses/me): Status (multi-select) and Type, with export following exactly those filters. An "awaiting reimbursement" check is expressible today as status=APPROVED.

**Empty state:**
- [ ] "No expenses submitted yet."

## 2.2 Expense Approvals

*The queue where someone with approval rights actually decides Pending expenses.*

**Roles:** Accountant, Super Admin.

**Columns (5):**
- [ ] Employee
- [ ] Type
- [ ] Amount
- [ ] Date
- [ ] Status

**Filters:**
- [ ] Employee and Type, with the pdf/excel export following them (a Status filter would be meaningless here — the queue is Pending by definition). Deferred (documented, not built): Department, Vendor, Amount range, Submitted Date range, "has receipt attached" (Yes/No), "pending more than N days," and fre

**Empty state:**
- [ ] "No pending expenses."

## 2.3 All Expenses / Summary

*The full, company-wide expense list, a lightweight spend summary, and — new in this revision — marking approved expenses as reimbursed.*

**Roles:** Accountant, Super Admin.

**Fields (4):**
- [ ] Reimbursed Date
- [ ] Mode
- [ ] Reimbursed From (Bank Account)
- [ ] Reference

**Buttons / actions (2):**
- [ ] Mark as Reimbursed
- [ ] "Export to PDF" and "Export to Excel," alongside "Download," per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2) — exporting exactly the filtered set shown, with a header block naming the filters that produced it.

**Filters:**
- [ ] Status (multi-select), Type, Employee, Vendor, Expense Date range (date_from/date_to), and free-text Search (added 2026-08-05 — matches Description and Expense Type on the three Expense Claim–backed list screens; Company Expenses' search matches Description only, since that table has no name-snapsho

**Empty state:**
- [ ] "No expenses recorded yet."

## 2.4 Company Expenses

*Meshrd's own running bills — internet / Wi-Fi, electricity, office rent, telephone, cloud hosting, housekeeping. These are the expenses where the company itself was billed, not an employee. Nobody paid out of pocket, so nobody is owed a reimbursement.*

**Roles:** Super Admin and Accountant only. Manager, HR and Employee have no access, and it does not appear in their navigation — a running office bill is not any employee's business, and unlike a claim there is no personal stake to justify a self-service view.

**Fields (9):**
- [ ] Expense Type
- [ ] Vendor
- [ ] Linked Purchase Bill
- [ ] Amount
- [ ] Paid From (Bank Account)
- [ ] Date
- [ ] Bill Attached
- [ ] Tax / Tax Amount
- [ ] Billing Period (Month / Year)

**Filters:**
- [ ] (GET /company-expenses): Status (multi-select), Type, and Vendor, with the pdf/excel export following them. Deferred (documented, not built): Bank Account and Period — the billing-period columns exist on every row (above), so the Period filter is an additive parameter when picked up.

**Empty state:**
- [ ] "No company expenses recorded yet."

## 3.2 Adding a New Vendor Inline While Submitting an Expense — DEFERRED

**Buttons / actions (1):**
- [ ] + Add New Vendor

## 6.1 Nothing Here Is Hardcoded

**Buttons / actions (1):**
- [ ] + Add New Vendor

**Workflow / functionality:**
- [ ] Date cannot be in the future
- [ ] No formal auto-generated Expense code
- [ ] Notification on approval/rejection outcome
- [ ] Reject's comment is now required, not optional
- [ ] "Mark as Reimbursed" — built.
- [ ] Confirmed against Sheet1
- [ ] Export and filters — built on every list screen, to a core set.
- [ ] Employee vendor picker on claims — flagged, deferred.


# Module 13 of 14: Purchase Bill

`13-purchase-bill-module.md`

## 2.1 Purchase Bill List

*The full, searchable table of every bill received from a supplier.*

**Roles:** Accountant, Super Admin.

**Columns (9):**
- [ ] Internal Bill ID
- [ ] Vendor
- [ ] Vendor's Bill Number
- [ ] Total
- [ ] Paid
- [ ] Bank Account
- [ ] Status
- [ ] Bill Date
- [ ] Due Date

**Buttons / actions (2):**
- [ ] "+ Add Purchase Bill" (opens 2.2). Row click opens the bill record (2.2).
- [ ] + Add Purchase Bill

**Filters:**
- [ ] Supplier, Status, Financial Year — plus, added in this revision: Bill Date range, Due Date range, Amount range, Outstanding Amount range, Payment Mode where a payment has been recorded, Bank Account, Created By, an Overdue toggle (Status not Paid, Due Date passed), and an ageing bucket filter — Curr

**Empty state:**
- [ ] "No purchase bills recorded yet."

## 2.2 Add / Edit Purchase Bill

*Recording a bill Meshrd has received from a vendor.*

**Roles:** Accountant, Super Admin.

**Columns (1):**
- [ ] Withholding Tax

**Fields (24):**
- [ ] Vendor
- [ ] Vendor Bill Number
- [ ] Bill Date
- [ ] Due Date
- [ ] Notes
- [ ] Attachment
- [ ] Bank Account
- [ ] Linked Expense Claim
- [ ] Withholding Calculated On
- [ ] Withholding Amount (₹)
- [ ] Amount Payable to Vendor
- [ ] Description
- [ ] HSN Code
- [ ] Quantity
- [ ] Rate
- [ ] Line Total
- [ ] Bill Total (what the vendor billed)
- [ ] Withholding @ 10% on Subtotal
- [ ] Paid to the authority, separately
- [ ] Vendor's outstanding balance afterwards
- [ ] Subtotal
- [ ] Tax Amount
- [ ] Total
- [ ] Withholding

**Buttons / actions (3):**
- [ ] + Add New Vendor
- [ ] Download
- [ ] Save, Cancel.

**Status values:**
- [ ] built as Unpaid → Part-Paid → Paid (originally proposed as an inference — the build confirmed it). Flagged explicitly: the source data only says "track due/paid" — it doesn't spell out an exact status set the way Invoice's Draft/Sent/Part-Paid/Paid was spelled out. This three-value set is a reasonab

**Workflow / functionality:**
- [ ] Withholding is deducted from the payment, never added to the bill.
- [ ] A payment can never exceed Amount Payable to Vendor
- [ ] The bill reaches Paid when payments + withholding equal Total.

## 2.3 Record Payment

*Logging a payment Meshrd has made against a bill — mirrors the Invoice module's own Record Payment screen closely.*

**Roles:** Accountant, Super Admin. Only available on a bill with Status Unpaid or Part-Paid, not one already Paid — built (the API rejects a payment against any other status), and carried as its own RBAC action (record_payment) on the Purchase Bill screen, separate from edit.

**Fields (8):**
- [ ] Balance Due
- [ ] Withheld on this Bill
- [ ] Amount
- [ ] Mode
- [ ] Paid From (Meshrd Account)
- [ ] Paid Into (Vendor's Account)
- [ ] Date
- [ ] Reference

**Buttons / actions (1):**
- [ ] Record Payment, Cancel.

## 3.2 Creating a New Vendor Inline While Entering a Bill

**Buttons / actions (1):**
- [ ] + Add New Vendor,

## 6.1 "What Does Manager Mean" — The Complete, Confirmed Picture

**Fields (3):**
- [ ] Customer, Opportunity, Vendor, Ticket, Project
- [ ] Payroll
- [ ] Invoice, Expense, Purchase Bill

## 6.2 Nothing Here Is Hardcoded

**Buttons / actions (1):**
- [ ] Lock Purchase Bill Once Fully Paid

**Workflow / functionality:**
- [ ] HSN Code added at line-item level
- [ ] Tax Amount stays manually overridable even after picking a rate
- [ ] No PDF "Download" generation
- [ ] Bill Date cannot be in the future
- [ ] Status set (Unpaid / Part-Paid / Paid) is an inference
- [ ] Record Payment restricted to Unpaid/Part-Paid bills
- [ ] Mode dropdown sources from the full Masters Payment Mode list
- [ ] Overpayment blocked outright
- [ ] Confirmed against Sheet1
- [ ] A design decision independently validated
- [ ] HSN Code on line items — confirmed correct
- [ ] Export and filters confirmed
- [ ] Reconciled against the built backend (2026-08-03).


# Module 14 of 14: Roles & Access (RBAC)

`14-rbac-module.md`

## 2.1 Every Field/Action Toggle Already Named, Compiled

**Fields (13):**
- [ ] Employee
- [ ] Masters
- [ ] Asset Management
- [ ] Ticket
- [ ] Leave
- [ ] Payroll
- [ ] Vendor
- [ ] Customer
- [ ] Opportunity
- [ ] Project
- [ ] Invoice
- [ ] Expense
- [ ] Purchase Bill

## 2.2 The System-Wide Filter & Export Convention

**Fields (6):**
- [ ] Search
- [ ] Date range
- [ ] Status
- [ ] Owner / Assigned To / Created By
- [ ] Active/Inactive
- [ ] Text — names, codes, statuses, dates, identifiers

**Filters:**
- [ ] , and applied filters show as removable chips above the table, with a "Clear all" control. A user should never have to guess why a list looks empty.

**Status values:**
- [ ] | Every list screen whose records have a status | Multi-select, not single-select — "show me Open and In Progress" is a more common need than either one alone |

**Empty state:**
- [ ] , e.g. "No tickets match Status = Closed and Date = This Month," with the clear-all control right there. A bare "No records found" is not acceptable on a filtered screen.

**Workflow / functionality:**
- [ ] The header cell follows the body cells.
- [ ] Non-money figures keep their right alignment.
- [ ] Identifiers that happen to be numeric are text, not figures
- [ ] A masked amount keeps the alignment of the amount it replaces.

## 2.3 The Settings Screen — Appearance

**Roles:** all five roles, for the Appearance tab. The Regional & Financial and System tabs are Super Admin only.

**Columns (2):**
- [ ] Masters
- [ ] Invoice

**Fields (15):**
- [ ] Theme
- [ ] Accent Colour — presets
- [ ] Accent Colour — custom
- [ ] Display Scale
- [ ] Employee
- [ ] Asset Management
- [ ] Ticket
- [ ] Leave
- [ ] Payroll
- [ ] Vendor
- [ ] Customer
- [ ] Opportunity
- [ ] Project
- [ ] Expense
- [ ] Purchase Bill

## 4.1 Role Directory

*A summary landing view of the 5 roles before drilling into any one of them.*

**Roles:** Super Admin only.

**Columns (2):**
- [ ] Role Name
- [ ] People Count (how many active users currently hold this role)

**Buttons / actions (1):**
- [ ] none beyond navigation — roles themselves aren't created or deleted from this screen.

**Filters:**
- [ ] a "has overrides" toggle and a People Count range. A five-row table needs little filtering, and a search box would be theatre — but "which roles have people deviating from the default?" is a real question, and the Override Count column exists precisely because it matters. Export follows the filter, 

## 4.2 Role Permission Matrix

*The core screen — where every toggle from every module actually gets set, for one role at a time.*

**Roles:** Super Admin only.

**Buttons / actions (2):**
- [ ] Preview as this role
- [ ] Save Changes, Discard Changes — Assumption: toggles on this screen accumulate as pending edits rather than saving instantly one at a time, given how many could plausibly change in one sitting; a single explicit Save commits all of them together. Preview as this role (see above).

**Empty state:**
- [ ] "No screens match your search."

**Workflow / functionality:**
- [ ] For every screen

## 4.3 Individual Permission Overrides

*Where a specific person — not a role — gets extra permission, or has one taken away, without touching anyone else who shares their role.*

**Roles:** Super Admin only.

**Fields (4):**
- [ ] Module
- [ ] Screen
- [ ] Permission
- [ ] Grant or Revoke

**Buttons / actions (2):**
- [ ] + Add Override
- [ ] + Add Override, Remove Override (per row in the Active Overrides list), Save.

**Filters:**
- [ ] Module, Screen, Permission Layer, Grant vs. Revoke, Changed By, and Date range. Plus the baseline set and filter-based export, per Section 2.2. A person accumulating overrides across several modules over a couple of years produces a list nobody can read at a glance, and reviewing "everything granted

**Empty state:**
- [ ] "No overrides for this person — they follow their role's default permissions exactly."

**Workflow / functionality:**
- [ ] Role Default Summary
- [ ] Active Overrides list

## 4.4 Permission Change Log

*An audit trail of every permission change made in this module — not explicitly requested in the source data, but worth including deliberately: this module controls who can see salary data, financial records, and customer information, and changes to those controls should be tracea*

**Roles:** Super Admin only.

**Columns (5):**
- [ ] Date/Time
- [ ] Changed By
- [ ] Permission Changed (Module, Screen, and which layer)
- [ ] Old Value
- [ ] New Value

**Filters:**
- [ ] Assumption — Date Range, Changed By, Target (Role vs. Person) — plus, added in this revision: Module, Screen, Permission Layer (Visibility / Action / Field / Scope), Grant vs. Revoke, and a specific-person or specific-role picker. Search covers the permission name and target name. Plus the baseline 

**Empty state:**
- [ ] "No permission changes recorded yet."

## 5.5 Adding a 6th Role in the Future

**Buttons / actions (1):**
- [ ] Add Role

**Filters:**
- [ ] , and covers three things instead of one: which screens count as list screens (now explicitly including self-service screens), the rule that every role gets every filter on a screen it can open, Super Admin's superset, the baseline filter set every list carries, and export behaviour. Every module po

**Workflow / functionality:**
- [ ] The Matrix saves in a batch
- [ ] Role selector defaults to Employee
- [ ] Person Permission Overrides works on one person at a time
- [ ] The compiled toggle table (Section 2.1) is a snapshot
- [ ] Role Directory and the data model support a 6th role architecturally
- [ ] Confirmed against Sheet1
- [ ] This revision (major update):
- [ ] This revision (tax/insurance deep-dive):
- [ ] This revision (research follow-up, same day):
- [ ] This revision (correction, same day):
- [ ] This revision:


# Module 15: Tax & Compliance

`15-tax-compliance-module.md`

## 1.1 Why this is a module and not a section inside another one

**Workflow / functionality:**
- [ ] It owns a document nothing else can own.
- [ ] Its counterparty does not exist elsewhere.
- [ ] Its deadline is legal, not commercial.
- [ ] It has an off switch.

## 2.1 Tax & Compliance Overview

*The landing screen. Both directions visible together, as two panels that are never netted into a single figure.*

**Roles:** Accountant, Super Admin.

**Fields (2):**
- [ ] Obligations — money held, owed onward
- [ ] Credits — claimable back

**Empty state:**
- [ ] , because "nothing is configured" and "configured but nothing withheld yet" are different facts, and a register that is confidently empty for the wrong reason is worse than one that explains itself. As built, the response's has_obligation_heads_configured / has_credit_heads_configured booleans disti

## 2.2 Obligations — Withheld on Payments

*Reconciling, per head per period, what was withheld from the liability sources against what has actually been deposited.*

**Roles:** Accountant, Super Admin.

**Filters:**
- [ ] Tax Head · Status (multi) · Source (Vendor | Employee) · Due Date from/to · Search (matches Tax Head, Remitted To, Authority Reference) · format=pdf|excel filter-following export.

## 2.3 Obligations — By Document

**Filters:**
- [ ] Tax Head · Date from/to · Search (matches Document, Counterparty, Tax Head) · format=pdf|excel filter-following export. Rows sort newest first.

## 2.4 Remittances

**Filters:**
- [ ] Tax Head · Paid On from/to · Search (matches Remittance ID, Tax Head, Authority Reference) · format=pdf|excel filter-following export, including a Documents Covered column listing each covered document with its allocated amount.

## 2.5 Record Remittance

**Fields (13):**
- [ ] Tax Head
- [ ] Remitted To
- [ ] Period
- [ ] Withheld in this Period
- [ ] Already Remitted
- [ ] Amount Remitted
- [ ] Paid On
- [ ] Paid From (Bank Account)
- [ ] Mode
- [ ] *(Authority Reference)*
- [ ] Receipt Attachment
- [ ] Documents Covered
- [ ] Notes

## 2.6 Credits — Withheld from Receipts

**Filters:**
- [ ] Status (multi) · Customer · Payment Date from/to · Search (matches Invoice Number, Customer, Certificate Ref) · format=pdf|excel filter-following export.

## 2.7 Certificates

**Filters:**
- [ ] Customer · Status (multi) · Certificate Date from/to · Search (matches Certificate Reference, Customer) · format=pdf|excel filter-following export, including a Receipts Covered column listing each covered invoice with its matched amount.

## 6.1 Nothing Here Is Hardcoded

**Workflow / functionality:**
- [ ] The 7-day Due Soon threshold is a fixed platform figure
- [ ] Documents Covered is confirmed by the operator, never inferred.
- [ ] Part-allocation on the final ticked document is permitted
- [ ] The certified amount governs a claim
- [ ] Interest and penalty on a late remittance are not computed.
- [ ] Filing returns is out of scope.
- [ ] Employee-facing tax certificates are out of scope.
- [ ] The company's own income-tax liability is not tracked here.
- [ ] The no-head hiding rule is navigation-only

