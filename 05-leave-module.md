# Module 5 of 14: Leave

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Leave module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [My Leave (Self-Service)](#21-my-leave-self-service)
   - 2.2 [Leave Approvals](#22-leave-approvals)
   - 2.3 [Leave Balance Management](#23-leave-balance-management)
   - 2.4 [Company Holiday Calendar](#24-company-holiday-calendar)
   - 2.5 [Leave Reports](#25-leave-reports)
   - 2.6 [Compensatory Hours](#26-compensatory-hours)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

> **Sidebar location changed 2026-07-30.** This module and Payroll (Module 6) now share one left-hand sidebar tab, "Leave & Payroll," instead of two separate ones — they're the two modules an employee thinks of as "time and pay," and they were already tightly coupled (unpaid leave reduces pay, approved leave is credited against hour shortfalls, income tax declarations feed the payroll calculation). Nothing about this module's own screens, fields, or access rules changed; only where it sits in navigation. See RBAC, Module 14, Section 3 for the full reasoning.

The Leave module tracks how many leave days each person has, lets them apply, and routes the request to the right approver. It affects Payroll directly — unpaid leave reduces that month's pay — and it depends on Masters for Leave Types (Casual, WFH, Optional, and similar) and the company Holiday calendar.

Every person in the system is, first, a staff member who takes leave themselves. Applying for leave and checking a balance is identical no matter what role someone holds — Employee, Manager, Accountant, or HR. Only the approval and admin side of this module differs by role, and that difference is the main subject of this document.

This module has nothing to do with Meshrd's retail hardware products — it only tracks internal staff leave.

## 2. Screens

### 2.1 My Leave (Self-Service)

**What it's for:** Checking your own leave balance, applying for leave, and seeing your own history — identical for every role.

**Who can open it:** All 5 roles, for their own leave only.

**Balance panel — one row per Leave Type (sourced from Masters):**

| Column | Meaning |
|---|---|
| Allowed | This year's fresh quota for this Leave Type (Masters' Default Annual Quota) |
| Carried Forward | Brought in from last financial year, calculated automatically at year-end (2.3) — nobody types this in, the same way depreciation in Asset Management is a computed field, not a typed one |
| Taken | Days from every Approved request for this Leave Type, whether the dates are in the past or still upcoming |
| Pending | Days from every request still awaiting a decision |
| Adjustments | Net of HR's manual balance corrections (2.3) — **added in the build**: the code keeps adjustments in their own column (`adjustment_days`) rather than silently mutating Allowed, so the audit trail and the panel agree |
| Remaining | Allowed + Carried Forward + Adjustments − Taken − Pending. **Built as a database-computed column** (`remaining_days`), never recalculated in application code — the one formula everywhere |

If a Leave Type's Default Annual Quota is 0 (Masters allows this for types like WFH that don't consume a quota), Remaining shows "Not tracked" instead of a number, and the balance check below doesn't apply to that type.

**"Apply for Leave" button** opens a form:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Employee | Read-only, locked to the logged-in person | N/A | Cannot be changed on this screen — this is what makes it "my" leave |
| Leave Type | Dropdown (from Masters) | Y | — |
| From Date | Date | Y | — |
| To Date | Date | Y | Must be on or after From Date |
| Half-Day | Toggle (Yes/No) | N | If Yes, a First Half / Second Half choice appears |
| Reason | Text area | Y | — |

**Validation — hard block on insufficient balance (built):** the number of days requested is calculated as working days between From Date and To Date (excluding weekly off days, Mandatory holidays from the Company Holiday Calendar, 2.4, and non-working Saturdays per the applicable Work Week Policy's Saturday rule and any Saturday Overrides), minus 0.5 for a Half-Day. **As built**, the covering Work Week Policy is resolved by the shared specificity rule (Designation > Department > Employment Type > Company-Wide, most recently effective within a tier — `policy_resolution.py`, the same resolver Attendance uses), its id is stored on the request (`working_days_basis_policy_id`), and a date no policy covers refuses the request outright. If that number is more than Remaining for the selected Leave Type, **submission is blocked outright** — there is no submit-anyway option. The message states the shortfall exactly, for example: *"You have 2 days remaining for Casual Leave, but requested 4."* This is a hard rule, not a warning — a request that fails this check simply cannot be created. (If more days are genuinely needed, the fix is a balance adjustment by HR first, Section 2.3 — not an override at the point of applying.)

A second, separate check blocks a request that overlaps dates with an existing Pending or Approved request from the same person. **Built** — a service-layer check (deliberately not a MySQL constraint, which cannot express a date-range overlap) that rejects the request with the overlap named.

**Leave history table:** Leave Type, From Date, To Date, Days, Half-Day (Yes/No), Reason, Status (Pending / Approved / Rejected / Cancelled), Actioned By, Date Applied, Date Actioned.

**Filters.** **Built:** Status. **Deferred (documented here but not yet on the backend endpoint — the list API currently accepts only `status`):** Leave Type (multi-select), Financial Year, a From/To range on the leave dates, a range on Date Applied, Half-Day (Yes/No), Actioned By, and Search over Reason text. These remain the target per the Filter & Export Convention (RBAC, Module 14, Section 2.2) and should land with the Angular frontend's list-screen work; nothing about the data model blocks them.

This is a self-service screen and gets the full treatment regardless — an employee looking back over several years of leave needs to narrow that list exactly as much as HR does. There is no Employee filter here, since every row is already theirs; HR's and Super Admin's equivalent views have one.

**Export (built):** "Export to PDF" and "Export to Excel" of the filtered history — the list endpoint takes `format=pdf|excel` and the export follows whatever filters were applied, with the standard header block. Commonly needed in practice — leave records are requested at appraisal time, during exit, and whenever a balance is disputed.

**"Cancel Request" button (built):** shown only on the applicant's own still-Pending requests — the endpoint enforces both "own request only" and "still Pending only" (an Approved request cannot be cancelled through this action). Cancelling returns the days to Remaining immediately (they were only ever held in Pending, never deducted from Taken).

**Notifications (built):** the applicant is notified automatically, by email (the `leave_approved` / `leave_rejected` templates from Masters' Email Configuration) and in-app, the moment their request is Approved or Rejected.

---

### 2.2 Leave Approvals

**What it's for:** The queue where a pending request actually gets decided — the routing rule below determines who sees what.

**Who can open it:** Manager (requests from their own direct reports), HR (every pending request, company-wide), Super Admin (every pending request, and the last-resort fallback approver).

**Columns:** Employee, Leave Type, Dates, Days, Reason, Date Applied, and **Routed To** — showing who the request is currently sitting with (a specific Reporting Manager's name, "HR," or "Super Admin"), so HR's company-wide view makes clear whose turn it normally is even though HR can act on anything. **Built** — every request carries `routed_to_role`, `routed_to_user_id`, and a human-readable `routing_reason` explaining *why* it routed where it did.

**Filters.** **Built:** Status as a **multi-select** (per RBAC §2.2(c), never single-select); when no Status is supplied the queue defaults to Pending only — this is the action list, not history. **Deferred (not yet on the backend endpoint):** Employee, Department (from Masters), Leave Type (multi-select), Routed To, Date Applied range, Leave Dates range, Days range, the "pending more than N days" toggle — the one an approval queue actually needs, since the failure mode here is a request quietly aging rather than being refused — and Search over Employee Name and Reason. These remain the target per the Filter & Export Convention (RBAC, Module 14, Section 2.2), expected with the frontend's list-screen pass.

**Every filter is available to Manager, HR, and Super Admin alike.** A Manager's queue is already scoped to their own direct reports, so filtering by Employee there searches within that set — the scoping restricts, not the filter list.

**Export (built):** "Export to PDF" and "Export to Excel" of the filtered queue (`format=pdf|excel` on the same endpoint; the export follows the filters).

**Actions — Approve / Reject (built):** Reject requires a reason — the endpoint refuses a rejection whose reason is missing or blank (Section 6.2 — flipped from optional to required in this revision, for consistency with every other rejection flow in this CMS). A Manager in team scope can only decide requests from their own direct reports; deciding an already-decided request is refused.

**Reassign (built):** the reassignment HR's standing override implies (routing rule 6 below) exists as its own action — a still-Pending request can be re-routed to a different approver, recording who reassigned it, when, and from whom. The same team-scope check as Approve/Reject applies: a Manager can only reassign a direct report's request (this check was found missing by the Phase 2 audit and added — previously a team-scoped Manager could reassign any request company-wide).

- **Approve** moves the request out of Pending; its days now count in Taken instead. The applicant is notified.
- **Reject** leaves the request as Rejected; its days were only ever in Pending, so Remaining is unaffected. The applicant is notified, with the reason.

#### The Approval Routing Rule, Written Out Precisely

This is exact, not a general guideline — it needs to be, since it decides who has authority over a real request. **Built verbatim** as `leave_engine.resolve_routing`, shared by leave requests and Compensatory Hours (2.6) — one implementation, unit-tested, called before any request is created:

1. **Default case:** the request goes to the applicant's **Reporting Manager** — the specific person set on that applicant's Employee record (Employment Details tab), not "whoever holds the Manager role" as a group. That person gets a notification the moment the request comes in.
2. **No Reporting Manager set:** the request routes to HR instead.
3. **The applicant themselves is a Manager, Accountant, or HR person, applying for their own leave:** the request routes to HR — always, regardless of whether that applicant happens to have their own Reporting Manager on file. This keeps approval of leave for people in those roles centralized with HR rather than resting on whatever reporting line they happen to sit in.
4. **Nobody is in HR** (no active HR user in the system): the request falls back to Super Admin.
5. **A person never approves their own request.** If a request would route to HR and the applicant *is* the only active HR user, it falls through to Super Admin instead — the same as if HR didn't exist. Assumption, added for the same reason self-approval is blocked everywhere else in this CMS.
6. **HR's standing override:** regardless of where a request is currently routed — a specific Reporting Manager, or Super Admin by fallback — HR can step in and approve, reject, or reassign it at any time. This is a permanent capability, not something that only activates when a request reaches HR by the routing rule above.

---

### 2.3 Leave Balance Management

**What it's for:** HR and Super Admin's admin view of everyone's balances — corrections, and the year-end carry-forward run.

**Who can open it:** HR, Super Admin.

**List (built):** Employee, and the same balance columns as My Leave (2.1) — Allowed, Carried Forward, Adjustments, Taken, Pending, Remaining — one row per employee per Leave Type per Financial Year. **Built filters:** Employee and Financial Year. The export renders three derived columns: Balance (Allowed + Carried Forward + Adjustments — the year's total entitlement), Taken, and Available (the database-computed `remaining_days`).

**Additional filters — deferred (not yet on the backend endpoint):** Leave Type, Department, Designation, Employment Type, Reporting Manager, Employee Status (Active / On Notice / Exited), a Remaining-balance range, search, and two toggles that answer the questions this screen exists for — "negative balance only" and "unused balance above N days," the second being what the year-end carry-forward run is planned against. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). Expected with the frontend's list-screen pass.

**Export (built):** "Export to PDF" and "Export to Excel" of the filtered balance table (`format=pdf|excel`). **Adjustment History — partially built:** every adjustment is *recorded* (see below) but there is no listing endpoint for the history yet; the documented history list with its own filters (Employee, Leave Type, Adjusted By, Date range, positive/negative adjustments) and its own export is **deferred** until that read endpoint is added — an adjustment log that can't be filtered by who made the adjustment is not much of an audit trail, so the filters should arrive together with the endpoint.

**"Adjust Balance" action**, per employee and Leave Type:

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Adjustment Amount | Number (can be positive or negative) | Y | e.g. +5 to grant extra days, −2 to correct an over-grant |
| Reason / Note | Text | Y | Required on every adjustment — e.g. "Pro-rated first-year allowance," "Correcting duplicate grant" |

Every adjustment is logged — **built, stronger than specified:** each adjustment row records Date, Leave Type, Amount, Reason, Adjusted By, **and the balance before and after**, and the table is append-only at the database level (triggers forbid UPDATE and DELETE on `leave_balance_adjustments`) — the same pattern used for asset assignment history in Asset Management and ticket assignment history in the Ticket module, hardened one step further. The adjustment lands in the balance's own Adjustments column, so Remaining updates through the single computed formula rather than by editing Allowed.

**"Run Year-End Carry-Forward" button (built, as a Preview → Commit pair):** the `leave-carry-forward-runs` endpoints implement the calculation for a specified financial-year transition (e.g., "Run carry-forward from FY2026 to FY2027"). **Preview** creates a run in Preview status with one line per employee per Leave Type where Carry Forward Allowed is Yes (per the balance's own snapshot of the Masters setting), each line recording the Remaining at run time, the days carried (capped at that type's Max Carry Forward Days), and — added in the build — the days **lapsed** above the cap, with run-level totals (employee count, line count, total carried, total lapsed). **Commit** applies a Preview run: each line's carried days are added to the employee's Carried Forward for the target financial year, creating the target-year balance row if it doesn't exist yet. Only a Preview run can be committed, and **a given from/to Financial Year pair can only ever be committed once — enforced by a database constraint**, so running it twice is impossible rather than merely inadvisable. A Preview run can also be **cancelled**. This is a manual, deliberate action — not something recalculated silently in the background.

**New employee starting balance — automatic, not a button (built):** when an Employee record is first saved as Active within a financial year (Employee module, Onboarding Checklist, Section 2.13), this module allocates a prorated Allowed balance for every Active Leave Type: (Default Annual Quota ÷ 12) × months remaining in the financial year from the Joining Date, rounded to the nearest half-day. **As built** (`leave_engine.calculate_prorated_starting_balance`), "months remaining" counts the joining month itself as a whole month — an employee joining on the 28th still gets that month's full twelfth — and is capped at 12. This is the authoritative definition of that calculation — the Employee module's onboarding checklist only references it as a completed step.

---

### 2.4 Company Holiday Calendar

**What it's for:** Letting everyone see the official holiday list before they plan or apply for leave.

**Who can open it:** All 5 roles — read-only for everyone, since this is sourced entirely from Masters (Section 3.5) and isn't editable from here at all. Editing the list happens in Masters, by whichever roles are permitted there (Super Admin and Manager, per the Masters module). **Built:** there is no separate Leave-module holidays endpoint — this screen reads the Masters holidays API directly (which also carries the bulk import), which is the point: one list, one source of truth. The leave working-days calculation and Compensatory Hours day-type resolution both read the same Mandatory/Optional data.

**Display:** Holiday Name, Date, Type badge (Mandatory / Optional). A toggle between Calendar view and List view. Mandatory holidays (e.g. Independence Day) are visually distinct from Optional ones — Assumption: a solid tag for Mandatory, an outlined tag for Optional.

**Filters:** Month, Financial Year, Type (Mandatory / Optional — multi-select), and a date range. Search covers Holiday Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2). **All five roles get the identical filter set here** — this screen shows the same company-wide data to everyone, so there is no scoping difference to reflect and no reason for anyone's version to be narrower.

**Export:** "Export to PDF" and "Export to Excel" of the filtered list — added in this revision. A printable holiday calendar for a chosen year is one of the more obviously useful exports in this CMS, and this screen previously had none.

**Empty state:** "No holidays set up for this financial year yet." (would point back to Masters, for whichever role manages it there).

---

### 2.5 Leave Reports

**What it's for:** A read-only reporting screen — no edits happen here.

**Who can open it:** HR, Super Admin, Accountant. Accountant's access is specifically for payroll and financial planning purposes — not because Accountant manages leave day-to-day, which is why Accountant has no approval rights anywhere else in this module.

**Report views (all four built, as separate endpoints under `/leave/reports`):**

- **Leave taken by Type** — table/chart, aggregated per Leave Type (Employees, Allowed, Carried Forward, Taken, Pending, Remaining).
- **Leave taken by Department** — same, grouped by Department (from Masters).
- **Leave taken by Employee** — a sortable table, one row per employee, with **Search** over Employee Name and Employee Code (the one view whose rows are real named records — search over the short taxonomy lists in the other two views would be theatre, per RBAC §2.2's own precedent).
- **Leave Liability** — a single headline figure, shown prominently rather than buried in a table: the total unused leave across every active employee, in days, since this matters for financial provisioning. **Corrected in the build:** this document previously defined it as "sum of Remaining + Carried Forward," but Remaining (`remaining_days`) is a computed column that *already includes* Carried Forward — adding it again would double-count carried days and overstate the provisioning figure. The liability is therefore the total Remaining alone; total Carried Forward is still reported alongside it for visibility, it just isn't added a second time. Uniquely among the four views, Employee Status here **defaults to Active** (still overridable), matching this definition — the other three carry no default so an exited employee's historical figures stay visible.

**Filters (built):** Financial Year (defaulting to the current one), Department, Leave Type, Designation, Employment Type, Reporting Manager, Employee Status, and Leave Status as a multi-select (so a report can include or exclude Pending requests, which materially changes a liability figure — when Pending is excluded, held Pending days are added back to Remaining so an undecided request doesn't move an approved-only figure).

**Date Range — deliberately not implemented, not an omission:** these reports are built on the balance table, one row per employee per Leave Type per Financial Year — a per-year aggregate with no day-by-day breakdown to slice by an arbitrary From/To. Financial Year is the real grain this data supports and is a filter here; a bolted-on date-range control over data that can't honour it would be exactly the "figure that quietly reflects a different filter" this section warns against. RBAC §2.2(c) permits omitting a baseline filter where the dimension genuinely doesn't exist on the data. If a true date-ranged taken-days report is wanted later, it would need to aggregate leave *requests* by date, a different report to be specified fresh.

**All filters apply across all four report views simultaneously** — built by having all four endpoints share one filter helper, so the views cannot drift apart: switching from "by Type" to "Leave Liability" never silently changes the underlying set.

**Buttons (built):** "Export to PDF" and "Export to Excel" (`format=pdf|excel`) on the three list-shaped views. **Leave Liability carries no export** — it is a single headline figure, not a list, so there is nothing list-shaped to export; it appears in JSON with its financial year, employee count, and component totals. **Every export from this screen carries a header block stating the filters that produced it, the result count, who exported it, and when** — on a reporting screen this is the difference between a useful file and a misleading one.

**Empty state:** "No leave data for this date range."

---

### 2.6 Compensatory Hours

**What it's for:** The screen that keeps a bad afternoon from becoming a pay cut. When someone falls short of the day's net working hours, they make the balance up on a day of **their own choosing** — this is where that is requested, approved, and tracked. Approved make-up hours are credited against the shortfall, so Payroll stops treating it as one. Rejected or unclaimed hours fall through to Loss of Pay.

**Why this is a Leave screen and not a Payroll screen.** The rules live in Masters (Work Week & Hours, Section 3.20) and the money consequence lands in Payroll (Attendance & Time Basis, Module 6, Section 2.4), but the thing being requested here is *time off already taken, being paid back* — an application, routed to an approver, with a balance-like consequence. That is this module's shape, and it reuses this module's approval routing rather than inventing a second one.

**Why it is not the same as Comp Off leave.** Comp Off (a Leave Type in Masters, Section 3.4) is a whole day of leave *earned* by working a day off, drawn later from a balance. Compensatory Hours works the other way round: hours are *owed* first and worked afterwards, in the same period, against a specific dated shortfall. Conflating them would let someone bank a full day's leave for a two-hour make-up.

#### Fields (request)

| Field Name | Data Type | Mandatory (Y/N) | Notes/Validation |
|---|---|---|---|
| Request # | System-generated | — | **Built:** allocated from the central numbering service (code type CHR, per financial year) |
| Employee | Reference — read-only, locked to the logged-in person | Y | You can only compensate your own hours — **built:** the endpoint derives the employee from the login and verifies the attendance record belongs to them |
| Shortfall Date | Dropdown of that person's dates that actually recorded a shortfall | Y | Sourced from attendance — **built:** the request references the attendance record itself, and a record with no negative hour balance is refused ("a shortfall cannot be invented to earn credit"). A database constraint allows only one open request per attendance record |
| Hours Short | Number — derived, read-only | — | Required Hours − Net Worked Hours for that date. The ceiling on what may be claimed |
| Day Status That Day | Derived, read-only | — | What the day currently counts as. Approval lifts a Half Day back to Full Day |
| Reason for the Shortfall | Long text | Y | The approver sees this when deciding |
| Make-Up Date | Date | Y | **The employee's choice.** Must fall inside the Compensation Window on their policy, and cannot be a Mandatory holiday |
| Day Type | Derived, read-only | — | Resolved from the work-week policy — a non-working Saturday is permitted where the policy allows it |
| Hours You Will Work | Number | Y | Must be at least Hours Short — **built as an explicit required field** (the Phase 2 audit found an earlier version deriving it silently from the optional planned times). Anything beyond closes the shortfall; it is not banked as extra credit |
| Planned Check-In / Check-Out | Time | N | A break is only deducted if the stretch runs past six hours |
| Window Check | Derived, validated on submit | — | **Built:** a date past the window is refused outright, with the last permissible date stated. The window, cap, and permitted-day settings are also **snapshotted onto the request** so a later policy edit can't rewrite what was checked |
| Monthly Cap Check | Derived, validated on submit | — | **Built:** against Max Compensatory Hours per Month on the policy, counting this request plus every Pending and Approved request whose make-up date falls in the same month |
| Status | Pending / Approved / Rejected / **Cancelled** — system-set | — | Created at Pending. **Cancelled added in the build:** the applicant can cancel their own still-Pending request, same as leave (2.1) |
| Routed To | Derived | — | Same routing rule as leave (Section 2.2) — **built:** literally the same function, with the same routed-to role/user/reason fields stored |
| Payroll Impact if Rejected | Currency — derived | — | Shown up front, so nobody is surprised by their payslip. **Built as a flagged estimate:** the hourly rate is approximated as gross monthly ÷ (net working hours per day × 22) — good enough for the preview, not a payroll figure; the authoritative amount comes from the Payroll run |

#### Screen Design

**Screen type:** A list — Request #, Employee, Department, Shortfall Date, Hours Short, Make-Up Date, Hours Made Up, Reason, Status, Approved By. "+ Request Compensatory Hours." Approve and Reject as row actions for those who hold them; **rejection requires a reason** (built — a blank reason is refused), per the platform-wide default. **Built as two list endpoints:** the applicant's own requests, and an approvals queue (team-scoped for Manager, defaulting to Pending). On Approve, **the shortfall day's attendance record lifts back to Full Day** and the cleared hours are recorded on it (built — the Phase 2 audit found this missing; approval previously only flipped the request's own status). The applicant is notified in-app on either outcome.

**Filters.** **Built:** Status (on both lists; the approvals queue defaults to Pending). **Deferred (not yet on the backend endpoints):** Employee, Department, Period, and Search — per the Filter & Export Convention (RBAC, Module 14, Section 2.2), expected with the frontend's list-screen pass. Export (built, `format=pdf|excel` on both lists) follows the filter.

**Empty state:** "No compensatory hour requests."

#### Role Access

**Super Admin** — full, company-wide. **HR** — full, company-wide, as with Leave Approvals. **Manager** — Team scope: their own requests plus their direct reports', with approval rights over the latter (built — the decide endpoint refuses a request from anyone outside their direct reports). **Accountant** — Own scope only; they hold no approval rights anywhere in this module, consistent with Section 2.2. **Employee** — Own scope only. **Built:** these are the RBAC screen-permission modes seeded for `leave.compensatory_hours` — Employee and Accountant both resolve to "own," Manager to "team," HR and Super Admin to "full" — and they remain editable from the RBAC admin screen per Section 6.2, not hardcoded.

Everyone can raise a request for themselves regardless of role, on the same principle as the rest of this module: every person in the system is first a staff member who occasionally has to leave early.

---

## 3. Workflows

### 3.1 Apply for Leave → Balance Check → Routed → Approved/Rejected → Balance Updates → Applicant Notified

1. The employee opens My Leave (2.1) and clicks **Apply for Leave**, filling in Leave Type, From Date, To Date, Half-Day, and Reason.
2. The system calculates working days requested and checks it against Remaining for that Leave Type. If it exceeds Remaining, submission is blocked with the exact shortfall shown — the request is never created.
3. If it passes, the system checks for overlapping dates against the applicant's own existing Pending/Approved requests, then creates the request at Status = Pending and applies the Approval Routing Rule (2.2) to determine who it goes to: the applicant's Reporting Manager by default, or HR if there's no Reporting Manager set or the applicant themselves is a Manager/Accountant/HR person, or Super Admin if HR is unavailable.
4. The designated approver is notified immediately. The request also appears in HR's company-wide Leave Approvals queue regardless of who it's routed to, since HR can act on anything.
5. The approver opens Leave Approvals (2.2) and Approves or Rejects.
6. On Approve: the request's days move from Pending into Taken; Remaining reflects the new total. On Reject: the request is marked Rejected; Remaining is unaffected, since the days were only ever held in Pending.
7. The applicant is notified of the outcome automatically.

**How an approved request meets the pay-cycle cutoff (built, in Payroll):** a pay period runs on the Pay Cycle's own days (e.g. Start Day 26 / End Day 25), not the calendar month. A multi-day approved request that straddles the cutoff is **clipped per period**: each payroll run counts only the working days of the request that fall inside its own window, re-deriving that portion's working days with the same policy/holiday/Saturday-override construction used at apply time — so a request spanning the 25th/26th boundary is split between the two periods it touches, never counted in full by both. A single-day or half-day request can't partially overlap a period, so it is simply counted by whichever period contains it.

### 3.2 New Employee Onboarding Sets Up Their First-Year Leave Balance

1. HR creates the new employee's record in the Employee module and saves it as Active within the current financial year (Employee module, Section 2.13, Onboarding Checklist step 4).
2. This module allocates a prorated Allowed balance for every Active Leave Type automatically — (Default Annual Quota ÷ 12) × months remaining in the financial year from the Joining Date, rounded to the nearest half-day. No manual step is needed.
3. The Onboarding Checklist's "leave balance" step shows as complete once this has run.
4. The new employee sees their balance the first time they open My Leave (2.1) — Carried Forward starts at 0, since there's no prior year to bring anything in from.

### 3.3 Year-End Carry-Forward Calculation

1. At (or just before) financial year-end, HR or Super Admin opens Leave Balance Management (2.3) and clicks **Run Year-End Carry-Forward**, selecting the financial-year transition (e.g. FY2026 → FY2027).
2. The system creates a **Preview run**: for every employee and every Leave Type where Carry Forward is allowed, one line showing the Remaining at run time, how many days will carry over (capped at that type's Max Carry Forward Days), and how many lapse above the cap — with run totals.
3. HR/Super Admin **commits** the previewed run (or **cancels** it — a cancelled preview is kept for the record but applies nothing).
4. On commit, each employee's Carried Forward figure for the new financial year is increased accordingly (the new year's balance row is created if it doesn't exist yet); anything above the cap lapses, per Masters' Leave Type settings.
5. This is a one-time, deliberate action per financial year — **enforced, not just intended:** a database constraint permits only one committed run per from/to Financial Year pair, ever.

### 3.4 HR Manually Correcting a Balance

1. HR (or Super Admin) opens Leave Balance Management (2.3), finds the employee and Leave Type, and clicks **Adjust Balance**.
2. They enter the adjustment amount (positive or negative) and a required reason.
3. The employee's balance updates immediately (via the Adjustments column and the computed Remaining), and the adjustment is recorded — with balance-before and balance-after — in the append-only adjustment log for future reference.
4. The employee sees the updated Remaining figure the next time they open My Leave (2.1). The earlier Assumption that they'd also be notified of the adjustment, with the reason, is **not built** — no notification fires on an adjustment today; it remains a reasonable transparency improvement if wanted, but is deferred rather than silently claimed.

### 3.5 An Employee Makes Up Hours They Fell Short Of

1. Attendance records a shortfall — someone left early, and the day resolved to Half Day (or a graced Full Day) under the hour bands on their work-week policy (Masters, Section 3.20).
2. They open Compensatory Hours (2.6) and raise a request. The Shortfall Date dropdown offers only dates that genuinely recorded a shortfall, and Hours Short is derived, so the claim cannot exceed what was actually missed.
3. **They nominate the make-up date themselves.** The screen validates it live against their policy: inside the compensation window, under the monthly cap, and on a day type the policy permits — a non-working Saturday is usually allowed, a Mandatory holiday is not.
4. It routes by the same rule as leave (Section 2.2, 6.1) — Reporting Manager, falling back to HR then Super Admin, with HR able to step in on any request.
5. While the request is **Pending**, Payroll suspends the deduction rather than cancelling it (built — the payroll run's hour reconciliation nets pending compensatory hours out of the shortfall it converts to Loss of Pay): the shortfall is visible on Payroll → Attendance's Payroll Impact tab with the pending hours shown against it.
6. On **Approve**, the hours are credited against that specific shortfall, the day lifts back to Full Day (built — the attendance record's day status is updated and the cleared hours recorded on it), and nothing reaches the payslip. On **Reject** — which requires a reason — or if the window closes first, the shortfall converts to Loss of Pay at the next payroll run, at whatever the policy's *Uncompensated Shortfall Becomes* setting specifies.
7. A partial make-up clears only its own hours. The remainder still deducts, and both screens state the split explicitly rather than implying the request resolved everything.

## 4. UI/UX Notes

- **The balance panel is the first thing anyone sees** on this module — a small set of numbers per Leave Type, front and center, not a settings page or a table you have to scroll to find.
- **Status shown as a clear colored tag** everywhere a request appears: Assumption on the convention — Pending = amber, Approved = green, Rejected = red, Cancelled = grey.
- **The blocked-by-balance message states the shortfall exactly** — "You have 2 days remaining for Casual Leave, but requested 4" — never a generic "insufficient balance" error.

## 5. Connected To / Depends on Masters

Connected To: Employee (whose leave it is, and the Reporting Manager field that drives routing), Payroll (unpaid leave affects pay), HR approval override

Depends on Masters: Leave Types (Casual, WFH, Optional, etc.), Holidays (bulk-imported company calendar, some marked Mandatory), Financial Year, **Work Week & Hours (Section 3.20 — the weekly off days and Saturday rule decide which dates actually consume a balance; the compensation window, monthly cap and permitted make-up days govern Compensatory Hours, Section 2.6)**, **Email Configuration (Section 3.21 — the Leave Approved and Leave Rejected email templates)**

**Confirmed already correctly set up in Masters:** Leave Types (Section 3.4) already has Carry Forward Allowed and Max Carry Forward Days fields, which the year-end carry-forward calculation (2.3, 3.3) reads directly — nothing new needed there. Holidays (Section 3.5) already supports Mandatory/Optional tagging and bulk CSV import, which the Company Holiday Calendar (2.4) and the working-days calculation (2.1) both read directly. Financial Year (Section 3.1) is what the carry-forward run and balance reset are scoped to.

---

## 6. Role-Based Access

> **Baseline, shared by all 5 roles:** every person is, first, an employee themselves. Applying for their own leave, viewing their own balance and history, and cancelling their own pending request (My Leave, 2.1) is identical no matter what role they hold — nobody's access to their own leave should ever be narrower than a plain Employee's. This specifically includes Accountant, who has no leave-related access at all in the source spreadsheet's Leave row; that row only ever covered the admin/approval side, not everyday self-service, and the baseline still applies underneath it. What follows is each role's additional access on top of that shared baseline.

> **The baseline includes Compensatory Hours (2.6) for their own shortfalls.** Anyone, in any role, may request to make up hours they personally fell short of — the same reasoning as self-service leave: every person here is first a staff member who occasionally has to leave early. Approving somebody *else's* request is the part that varies by role.

- **Employee** — the baseline only.
- **Manager** — the baseline for themselves, PLUS approving/rejecting requests from their direct reports (via the Routing Rule, 2.2), including their compensatory hour requests (2.6, Team scope).
- **Accountant** — the baseline only, PLUS read access to Leave Reports (2.5) for payroll/financial planning — no approval rights over anyone else's leave or compensatory hours.
- **HR** — the baseline for themselves, PLUS company-wide approve/reject override on any request, balance management and correction (2.3), the fallback-approver role in the Routing Rule, company-wide Compensatory Hours (2.6), and Leave Reports (2.5).
- **Super Admin** — full access to everything, including the RBAC settings screen itself, and the last-resort fallback approver if HR is unavailable.

### 6.1 The Routing Rule, Summarized for Reference

The full precise version is in Section 2.2. In short: Reporting Manager by default → HR if there's no Reporting Manager set or the applicant is themselves a Manager/Accountant/HR person → Super Admin if HR is unavailable → and HR can step in on any request at any time regardless of where it's routed, but never approves their own.

### 6.2 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Allow Manager to Adjust Team Leave Balance"** — OFF by default: only HR/Super Admin can correct a balance (2.3). Turned ON: Manager gets limited adjustment rights for their own direct reports.
- **"Require HR Co-Approval for Leave Longer Than X Days"** — OFF by default: a Manager's approval alone is enough. Turned ON: requests longer than a configured threshold need both Manager and HR sign-off before the balance updates.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **"Taken" defined as all Approved requests, past or future** — not just leave that has already happened — since the balance panel's columns (Allowed, Carried Forward, Adjustments, Taken, Pending, Remaining) have no separate "approved but upcoming" bucket. Flagging this definition explicitly since it drives every balance calculation in this module.
2. **Working-days calculation excludes weekly off days and Mandatory holidays**, not Optional ones, when checking a leave request against Remaining balance. Which Saturdays count as working is not a fixed assumption — it resolves from the Saturday rule on the applicable work-week policy (Masters, Section 3.20), currently odd Saturdays working and even Saturdays off. A Mandatory holiday falling on a working Saturday makes it non-working; an Optional one does not.
2a. **Compensatory Hours is deliberately separate from the Comp Off leave type.** Comp Off is a whole day of leave earned by working a day off and drawn later from a balance; Compensatory Hours is hours owed against a specific dated shortfall and worked afterwards, usually in the same period. Both exist, and conflating them would let a two-hour make-up bank a full day of leave.
3. **A person never approves their own leave request** — if the sole active HR user is the applicant, the request falls to Super Admin instead of HR, the same as if HR didn't exist. Not explicitly stated in the brief, but consistent with self-approval being blocked everywhere else in this CMS.
4. **Adjustment History added** to Leave Balance Management (2.3) for accountability — matching the pattern already used for asset assignment history and ticket assignment history elsewhere.
5. **Carry-forward preview step before committing** — added as a safeguard, since running this bulk action is hard to undo cleanly.
6. **New-balance proration formula** — (Default Annual Quota ÷ 12) × months remaining from Joining Date, rounded to the nearest half-day — this document is the authoritative source for that calculation; the Employee module's onboarding checklist only references it as a completed step.
7. **Reject's comment is now required, not optional** — flipped in this revision for consistency with every other rejection flow in this CMS (Documents, Asset Requests, and now Expense — see that module's own matching change). Previously optional; the toggle that would have restored optional behavior has been removed since required-by-default is now the system-wide norm.
8. **Team Leave Calendar removed entirely, per explicit instruction.** The calendar-visualization screen (previously 2.3) has been removed from this module — it is not being built. The approval routing mechanism (2.2) is unrelated and unaffected; removing the calendar does not change who approves what. Every cross-reference to it (Table of Contents, UI/UX notes, Role-Based Access, the "Show Team Leave Calendar to Accountant" toggle, and the per-person override example) has been removed or rewritten to match. If a coverage-planning visualization is wanted later under a different name or design, it would need to be specified fresh rather than restored from this version.
9. **Export confirmed** on Leave Reports (2.5) — "Export to PDF" and "Export to Excel" alongside the existing "Download Report" button, per the system-wide convention (RBAC, Module 14, Section 2.2). *Extended by item 10 — at the time, Leave Reports was the only screen in this module treated as a list screen.*

10. **This revision — filters and filter-based export on every list screen, for every role, per explicit instruction.** This module was the weakest in the CMS on this: of five screens, only two had any filters at all (the Holiday Calendar had two, Leave Reports had three), and only Leave Reports had export. My Leave's history table, the Leave Approvals queue, and Leave Balance Management had none of either — three screens where filtering is not a convenience but the primary way the screen is used.

    All five now carry documented filter sets and filter-based export. Three additions are worth flagging as more than mechanical, because each one answers the question its screen actually exists to answer: **"pending more than N days"** on the Approvals queue, since the real failure mode there is a request aging rather than being refused; **"negative balance only"** and **"unused above N days"** on Balance Management, the latter being what a year-end carry-forward run is planned against; and **Leave Status** on Reports, since including or excluding Pending requests materially changes the Leave Liability figure and there was previously no way to control it.

    The Company Holiday Calendar is the module's one screen where all five roles see identical data with no scoping difference, so all five get an identical filter set — noted because it's the clearest illustration that the all-roles rule costs nothing where there's nothing to protect.

11. **Doc-vs-code reconciliation (2026-08-03) — this document now reflects the built FastAPI backend.** The material corrections and honest gaps, in one place:
    - **Remaining formula corrected** to Allowed + Carried Forward + **Adjustments** − Taken − Pending, matching the database-computed `remaining_days` column; manual adjustments live in their own column rather than mutating Allowed (2.1, 2.3, 3.4).
    - **Leave Liability double-count corrected** (2.5): Remaining already includes Carried Forward, so the liability is total Remaining alone — "Remaining + Carried Forward" would count carried days twice. Carried Forward is reported alongside, not re-added.
    - **Built beyond the doc's letter:** the carry-forward run is a Preview → Commit → (Cancel) lifecycle with lapsed-days tracking and a one-commit-per-FY-pair database constraint (2.3, 3.3); the adjustment log records balance-before/after and is append-only at the DB level (2.3); a Reassign action with team-scope checks exists on Leave Approvals (2.2); Compensatory Hours gained a Cancelled status, CHR request numbering, policy-setting snapshots on each request, and a one-open-request-per-attendance-record constraint (2.6); approved multi-day leave straddling a pay-cycle cutoff is clipped per pay period in Payroll (3.1).
    - **Deferred, explicitly:** the rich per-screen filter sets of items 10 — the backend list endpoints currently expose Status (multi-select on Leave Approvals; single elsewhere) plus Employee/Financial Year on Balance Management, and the full documented sets await the frontend's list-screen pass; the Adjustment History *listing* endpoint (records exist, no read API yet); the Date Range filter on Leave Reports (the data's grain is Financial Year — a date-ranged report would need to be specified fresh over requests, not balances); Search on the by-Type/by-Department report views (taxonomy lists, deliberately omitted); the balance-adjustment notification to the employee (3.4).
    - **Precision added:** proration counts the joining month as a whole month, capped at 12 (2.3, 3.2); Work Week Policy resolution is the shared specificity rule Designation > Department > Employment Type > Company-Wide (2.1); the Approvals queue defaults to Pending when no Status filter is passed (2.2); Leave Liability defaults Employee Status to Active and carries no export, being a headline figure rather than a list (2.5).

### A correction this module requires in the Employee module (already applied)

Building this module surfaced a direct conflict with how the Employee module (Module 2) described its My Leave screen: it said an over-balance request gets a *warning* but can still be submitted, with the Reporting Manager approving it "as an exception." This module's brief is explicit and exact that it's a **hard block** — no submit-anyway path exists. Since this Leave module is the authoritative source for leave rules (the Employee module explicitly deferred to it), the Employee module has been updated to match: the warning-and-override language is replaced with the hard-block rule above, its balance table now includes a Carried Forward column to match the five-column definition here, and "Allotted" has been renamed "Allowed" for consistent terminology across both documents. See that document's own Assumptions log for the specific edit.

---

**Suggested filename:** `05-leave-module.md`
