# Module 10 of 14: Project

Reference document for the development team and Claude Code. This describes screens, fields, workflows, and access rules only — it is not code and must not be treated as one. Read this fully before building any part of the Project module.

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Screens](#2-screens)
   - 2.1 [Project Directory](#21-project-directory)
   - 2.2 [Add / Edit Project](#22-add--edit-project)
   - 2.3 [Task Board](#23-task-board)
   - 2.4 [Task Detail](#24-task-detail)
   - 2.5 [Sprints](#25-sprints)
   - 2.6 [Bugs](#26-bugs)
   - 2.7 [Project Report](#27-project-report)
   - 2.8 [Milestones & Timesheets](#28-milestones--timesheets)
3. [Workflows](#3-workflows)
4. [UI/UX Notes](#4-uiux-notes)
5. [Connected To / Depends on Masters](#5-connected-to--depends-on-masters)
6. [Role-Based Access](#6-role-based-access)
7. [Assumptions & Points to Confirm](#7-assumptions--points-to-confirm)

## 1. Module Overview

> **Sidebar location changed 2026-07-30.** My Projects & Tasks (Employee, Module 2, Section 2.8) moved from the Employee tab into this module's own sidebar entry, next to Project Directory and the rest of this module's screens. It's still documented under Employee §2.8 — this module didn't gain a new self-service screen, the existing one just sits closer to its subject in navigation now. See RBAC, Module 14, Section 3 for the full reasoning.
>
> **As built**, the screen is served by two self-service endpoints in this module's API: `GET /employees/me/projects` (the caller's projects — Lead or Member — with `format=pdf|excel` export) and `GET /employees/me/tasks-and-bugs` (everything assigned to the caller — **Bugs included alongside Tasks**, so a person's pending count reflects both; filterable by Status and by type task/bug, with the same export, a Bug's Severity shown in the Priority column). Both scope purely by "who am I" — no per-role filter differences, no project id needed.

Project is where the actual work happens once a deal is won: a project for a customer, with a team, a task board, sprints, and bug tracking. A staff member's own personal slice of this — their own tasks across whatever projects they're on — is already summarised in the Employee module's My Projects & Tasks screen. This document covers the full project record and the board/sprint/bug tools the team actually works in.

Access here is function-based, not personal: only people actually staffed on a project need to see it, so unlike Leave or Payroll, there's no universal self-service baseline to design in this module.

This module is only about delivery work for Meshrd's B2B service clients — nothing here relates to Meshrd's retail hardware products.

## 2. Screens

### 2.1 Project Directory

**What it's for:** The list of every project — full for admin roles, filtered to "mine" for Employee.

**Who can open it:** Super Admin and Manager see every project. Employee sees only projects they're a team member on — the same filtered list already summarised in the Employee module's My Projects & Tasks. Accountant and HR have no access by default.

**Columns shown:** Project Name, Customer, Status, Start Date, End Date, Budget.

**Filters (built — `GET /projects`):** Customer, Status (multi-select), Project Lead, Team Member (find every project a given person is on), Start Date range, End Date range, and Budget range. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Deferred (documented earlier, not built):** Financial Year, Service Category, the "overdue — past End Date, not Completed" toggle, the "no activity in N days" toggle, and Super Admin's Created By / Last Modified By filters and "show archived/closed projects" toggle. Deferred because the built filter set already covers the source-sheet requirement plus the additions that had a clear query behind them; these remain candidates for a later revision. (There is also no separate archived state on a project — Status is the only lifecycle field — so the archived toggle has nothing to toggle yet.)

**Available to every role that can open this screen.** An Employee's Directory is scoped server-side to projects they're a team member on (Lead or Member — the per-project roster in `project_scope.py`, not the org reporting hierarchy), so filtering by Team Member there searches within that set — the scoping restricts, not the filter list.

**Export (built):** `format=pdf|excel` on the same endpoint returns "Export to PDF" / "Export to Excel" of exactly the filtered, scoped set — same rows the screen shows, with a header block listing the filters applied. Export columns: Project Code, Name, Customer, Status, Lead, Start Date, End Date, Budget.

**Search (built):** Project Name only. (The earlier assumption also included Customer name; searching by customer is covered by the Customer filter instead.)

**Sort (built):** Start Date ascending.

**Buttons:** "+ Add Project" — Manager, Super Admin only. Row click opens the project record (2.2, with its Task Board, Sprints, Bugs, and Report tabs).

**Empty state:** "No projects yet." For an Employee with no assignments: "You're not assigned to any projects yet," matching the wording already used in the Employee module.

**Pagination:** Standard controls, 25 per page by default — a frontend concern; the API returns the full filtered set and the Angular client pages it, the same pattern as every other list endpoint in this backend.

---

### 2.2 Add / Edit Project

**What it's for:** Creating a new project, or editing one that already exists.

**Who can open it:** Manager, Super Admin.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Project Name | Text | Y | 2–150 characters |
| Customer | Dropdown (from the Customer module) | Y | — |
| Opportunity | Dropdown, filtered to the selected Customer's opportunities | N | See the Won-trigger note below — picking one here has a side effect on that Opportunity |
| Status | Dropdown | Y | Not Started / In Progress / On Hold / Completed. Defaults to Not Started |
| Start Date | Date | N | — |
| End Date | Date | N | Must be after Start Date if both are provided |
| Budget | Number (INR) | N | Must be a positive number if provided |
| Description | Text area | N | — |
| Project Lead | Dropdown (employees) | Y | Assumption: required, since a project should always have someone accountable. See the naming note below |
| Members | Multi-select (employees) | N | One or more team members, in addition to the Project Lead |

**A naming clarification, worth stating explicitly:** the brief describes the Team as "one Manager plus Members." This document uses **Project Lead** instead of "Manager" for that single field, to avoid confusing it with the system-wide **Manager role**. The two are unrelated — any employee, regardless of their system role (Employee, Manager, Accountant, HR), can be the Project Lead on a given project, the same way any of them can be a plain Member on another one. An Employee-role person can lead a project; a Manager-role person can be staffed as an ordinary member on someone else's.

**The Won trigger, closing the loop from the Opportunity module:** this is Path B, described in the Opportunity module (Module 9, Section 3.3). When an Opportunity is selected in this field (not left blank), the system checks that Opportunity's current Stage. If it isn't already Won, saving this Project automatically sets that Opportunity's Stage to Won as a side effect — the person creating the project never has to separately go to the Opportunity module and change it by hand. If the Opportunity was already Won (the more common case — a project usually starts after a deal is formally won), nothing changes on it. Leaving this field blank (a project started without a linked Opportunity) skips this entirely.

**Project Code:** auto-generated on save, format PRJ-\<Financial Year\>-\<4-digit number\>, e.g. PRJ-2026-0001 — already defined in the Masters module's Number Prefixes table (Section 3.6e), nothing new needed there.

**Built behavior worth stating (`POST /projects`, `PUT /projects/{id}`):**

- The Won trigger fires on create whenever an Opportunity is selected, and on edit only when the Opportunity field *changes* to a newly linked one — re-saving a project with the same Opportunity attached does not re-fire it. A non-existent Opportunity id is a 404, and both paths use the same shared `mark_opportunity_won` logic as Path A in the Opportunity module.
- Members is saved as a full replace of the roster — the submitted list *is* the team; anyone dropped from it is removed.
- Editing goes through the same per-project scope check as every other single-record endpoint here: a caller whose Directory permission is "own"-scoped can only edit projects they're actually on the team of, and an out-of-scope project answers 404, not 403 (the codebase-wide "an out-of-scope record looks like it doesn't exist" convention).

**Buttons:** Save, Cancel.

---

### 2.3 Task Board

**What it's for:** The Kanban board where the team actually works — the main day-to-day screen for this module.

**Who can open it:** Team members (Employee, Project Lead of any system role, and anyone else on the Members list), Manager, Super Admin — anyone with access to the project at all.

**Columns:** Backlog, To Do, In Progress, In Review, Done.

**Each card shows:** Title, Assignee (avatar/name), Due Date (if set, shown in a color that flags it if overdue).

**Moving a card:** drag-and-drop between columns, or a Status dropdown on the card/detail view — both update the same underlying Status field and have identical effect. **Built as a dedicated narrow endpoint:** `PUT /tasks/{id}/status` accepts a status-only body, so a card move never touches (or accidentally clears) the task's other fields. The general `PUT /tasks/{id}` is a full replace — a caller using it must resend Sprint, Priority, and Due Date or they are silently cleared — which is exactly why the status-only route exists for both drag-and-drop and the dropdown.

**"+ Add Task"** — available to any team member, Manager, or Super Admin (creating a task is not restricted; only deleting one is — see 2.4). Opens Task Detail (2.4) in create mode, defaulting into the Backlog column.

**Filters (built — `GET /projects/{id}/tasks`):** Status (multi-select), Assignee, Sprint, Priority (multi-select), and Due Date range. Search covers Title and Description. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Deferred (documented earlier, not built):** Label/Tag (tasks have no label field in the schema — nothing to filter on), Created By, Created On range, and the "Overdue only" toggle. **Deliberately dropped, not just deferred:** the "Unassigned only" toggle — Assignee is NOT NULL on Task in this schema (it is a genuinely required field), so that filter would be permanently unsatisfiable rather than just usually-empty. Search by Task ID was also not built; tasks are UUID-keyed with no human-readable task number, so there is no ID a person would type.

**Every filter is available to every role that can open the board** — team member, Manager, and Super Admin alike. A board is a shared working surface; there's no scoping difference between team members on the same project, so there's nothing for a narrower filter set to protect.

**Filters apply to all five columns at once, and each column's card count reflects the filtered set** — a board filtered to one assignee should show that person's counts, not the project's. Stated explicitly because a Kanban board is the screen where a filter silently applying to only some columns would be least noticeable and most misleading.

**Export (built):** `format=pdf|excel` returns "Export to PDF" / "Export to Excel" of the filtered board as a flat task list — one row per card, with its column as the Status value (columns: Title, Assignee, Status, Priority, Due Date). A Kanban board doesn't export as a board; it exports as the list it's built from.

**Empty state:** "No tasks yet." per column, or for the whole board: "No tasks on this project yet."

---

### 2.4 Task Detail

**What it's for:** The full detail behind one card — opened by clicking it on the board.

**Who can open it:** Same as the Task Board — any team member, Manager, Super Admin.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Title | Text | Y | — |
| Description | Text area | N | — |
| Assignee | Dropdown (employees on this project's team) | Y | Validated server-side: the assignee must be this project's Lead or a Member — any other employee is rejected (422), on create and on every edit |
| Due Date | Date | N | — |
| Status | Dropdown | Y | Backlog / To Do / In Progress / In Review / Done — matches the board column, changing either one updates the other |
| Priority | Dropdown | N | Low / Medium / High / Urgent — built as a task field (it backs the board's Priority filter and appears in the export) |
| Sprint | Dropdown (this project's sprints) | N | Which sprint, if any, the task currently belongs to — normally managed from the Sprints screen (2.5), but stored on the task |
| Comments | Thread | N/A | Anyone on the team can add a comment; comments are never deleted or edited once posted, only added to — built literally: the API has an add endpoint and nothing else |
| Sub-tasks | Simple checklist | N | Each item: text + a checked/unchecked toggle. "+ Add Sub-task" to add another line. Built as add + check/uncheck; sub-task lines are not deletable |

**Delete:** available on this screen, but restricted — Manager and Super Admin only (Employee cannot delete a task, per Section 6). Shows a confirm-before-you-go prompt. **Built rule:** if other records still reference the task — logged Timesheet entries being the real case — the delete is refused with a 409 and a message saying so, rather than orphaning or cascading over someone's logged hours.

**Buttons:** Save, Cancel, Delete (Manager/Super Admin only), Add Comment, Add Sub-task.

---

### 2.5 Sprints

**What it's for:** Short work cycles within a project, kept as a separate view from the general backlog/board (see Section 4).

**Who can open it:** Any team member can view which sprint a task belongs to. Managing sprints — Start, Update, Complete — is restricted to Manager and Super Admin (Employee cannot manage sprints, per Section 6).

**List columns:** Name, Start Date, End Date, Status (Planned / Active / Completed).

**Filters (built — `GET /projects/{id}/sprints`):** Status (multi-select), Start Date range, and End Date range. Search covers Sprint Name. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2), with filter-based export (`format=pdf|excel`; columns Name, Start Date, End Date, Status). Sorted newest-first by Start Date. A short list on a new project, but a project running two years of two-week sprints has fifty of them — which is exactly when someone needs to find one.

**Deferred:** the "current sprint only" toggle — filtering Status to Active gives the same answer, so it added a control without adding a query.

**"Start Sprint"** (Manager/Super Admin — `POST /projects/{id}/sprints`): a small form — Name\* (text), Start Date\* (date), End Date\* (date, must be after Start Date) — creates the sprint at Status = Active.

**"Update Sprint"** (Manager/Super Admin — `PUT /sprints/{id}/tasks`): add or remove tasks from an Active sprint — a multi-select of the project's tasks, checked ones belong to the sprint. Built as a full replace of sprint membership: the submitted task list *is* the sprint. Every task is validated to belong to this project (422 otherwise), and a sprint that isn't Active refuses the update with a 409.

**"Complete Sprint"** (Manager/Super Admin — `POST /sprints/{id}/complete`): sets Status to Completed; only an Active sprint can be completed (409 otherwise). Built as assumed: any task still not Done when a sprint completes returns to the Backlog — its sprint link is cleared and its Status reset to Backlog — rather than staying tagged to a closed sprint.

**Empty state:** "No sprints yet."

---

### 2.6 Bugs

**What it's for:** A separate tracker from Tasks, for issues rather than planned work — same board-adjacent structure, kept visually distinct.

**Who can open it:** Same as Tasks — any team member, Manager, Super Admin. Delete is Manager/Super Admin only, matching Tasks.

**Board columns / Status values:** Open / In Progress / Fixed / Closed — built as-is (originally flagged as a reasonable default rather than a confirmed requirement; it went into the build unchanged and is now the enforced status set).

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Title | Text | Y | — |
| Description | Text area | N | — |
| Severity | Dropdown | Y | Low / Medium / High / Critical |
| Status | Dropdown | Y | Open / In Progress / Fixed / Closed (see the flag above). Defaults to Open |
| Assignee | Dropdown (employees on this project's team) | N | Optional — but when set, validated server-side to this project's Lead or Members (422 otherwise), same rule as Tasks |
| Reported By | Read-only, auto-set to whoever created the bug | N/A | Backs the Reported By filter below |
| Due Date | Date | N | — |
| Comments | Thread | N/A | Same behavior as Task comments — anyone on the team can add one |

**Visual distinction from Task cards:** every bug card shows its Severity as a colored badge (Assumption: Low = grey, Medium = blue, High = orange, Critical = red), so a bug board never looks like a task board at a glance (see Section 4).

**Filters (built — `GET /projects/{id}/bugs`):** Severity (multi-select), Status (multi-select), Assignee, Reported By, Due Date range, and an "Unassigned only" toggle (which exists here and not on Tasks precisely because a bug's Assignee is optional). Search covers Title and Description. Plus the baseline set from the Filter & Export Convention (RBAC, Module 14, Section 2.2).

**Deferred:** Created On range and the "Overdue only" toggle (the Due Date range filter covers the practical query). Search by Bug ID was not built — bugs are UUID-keyed with no human-readable bug number.

Severity multi-select matters more here than the equivalent filter anywhere else in this module: "show me Critical and High" is the first thing anyone does on a bug tracker, and single-select would make that impossible.

**Available to every role that can open the tracker.** Export (built): `format=pdf|excel` returns the filtered set as a flat list (columns: Title, Severity, Status, Assignee).

**Delete:** Manager, Super Admin only, with a confirm-before-you-go prompt.

**Empty state:** "No bugs reported yet."

---

### 2.7 Project Report

**What it's for:** A light summary — counts, not analytics. Task and bug totals at a glance.

**Who can open it:** Manager, Super Admin. Built that way: the Report has its own RBAC screen (`project.report`) seeded with no Employee access, so an Employee calling it gets a 404 — flagged as a toggle candidate in Section 6, and the endpoint already runs the shared per-project scope check so a future "own"-scoped grant would work without code changes.

**Content:**

- **Tasks by Status** — a count per column (Backlog, To Do, In Progress, In Review, Done).
- **Bugs by Severity** — a count per severity level.
- **Bugs by Status** — a count per status.

**Filters (built — `GET /projects/{id}/report`), and this reversed an earlier decision rather than extending it.** This screen previously stated "no charts, trends, or date-range filtering — this is deliberately light." Filters were added and built: Date range (on task/bug creation), Assignee, Sprint, Priority (single-select — it filters tasks), and Severity (single-select — it filters bugs). The date range and Assignee apply to both tasks and bugs at once.

**What is kept from the original decision:** still **no charts and no trends**. The screen remains counts-and-move-on, not a dashboard. Filtering a count is not the same as visualizing it, and "how many bugs were opened this sprint" is a reasonable question to ask of a summary that already counts bugs.

**Export — deferred.** The Report is the one screen in this module without a built `format=pdf|excel` branch: it returns three small count blocks, not a row list, so the shared list-export engine doesn't fit it as-is. If exported later, the earlier requirement stands — counts as filtered, with a header block stating the date range and filters that produced them, since a count without its date range attached is the exact thing that gets misread once forwarded.

**Empty state:** "Nothing to report yet — add some tasks or bugs first."

---

### 2.8 Milestones & Timesheets

**What it's for:** Both are now fully designed and built, replacing the "Coming Soon" placeholder this section previously held, per your explicit direction to implement rather than leave planned.

#### Milestones

Key dates and deliverables within a project — a higher-level view than individual tasks.

**Who can open it:** Any team member can view. Manager and Super Admin can add, edit, and delete — the same split as Tasks and Bugs (2.4, 2.6), where creation and editing are open to the team but deletion is restricted.

**Fields:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Milestone Name | Text | Y | — |
| Target Date | Date | Y | — |
| Description | Text area | N | — |
| Linked Tasks | Multi-select (this project's tasks) | N | Optional — when set, the milestone shows how many of its linked tasks are Done (e.g. "3/5 tasks done"), giving a rollup view of real progress instead of a date sitting on its own. Built: the API returns tasks-done / tasks-total alongside the milestone, and every linked task is validated to belong to this project (422 otherwise); links are saved as a full replace on edit |
| Status | Dropdown | Y | Upcoming / Reached / Missed. Reached is set manually once the milestone is actually achieved — not automatically inferred from linked-task completion, since a milestone can be reached for reasons beyond just "all tasks done." Missed is set automatically if Target Date passes while Status is still Upcoming — built lazily: the flip happens (and is persisted) whenever the milestone list is read, not via a scheduled job, the same lazy-materialization pattern used elsewhere in this backend |

**Screen:** a list or simple timeline on the project record — Milestone Name, Target Date, Status badge, linked-task progress if set. "+ Add Milestone" (Manager/Super Admin). Sorted by Target Date.

**Filters (built — `GET /projects/{id}/milestones`):** Status (multi-select) and Target Date range. Search covers Milestone Name. Plus the baseline set and filter-based export (`format=pdf|excel`; columns Name, Target Date, Status, Linked Tasks count), per the Filter & Export Convention (RBAC, Module 14, Section 2.2). Sorted by Target Date, as specified.

**Deferred:** the separate "overdue — past Target Date, not Reached" toggle — largely superseded by the lazy Missed flip above: by the time the list renders, an overdue Upcoming milestone already *is* Missed, so filtering Status to Missed answers the same question.

**Empty state:** "No milestones set for this project yet."

#### Timesheets

Hours logged per task, per person — feeding both project effort tracking and Payroll's planned hour-basis calculation.

**Who can open it:** Every team member logs their own hours (the same self-service baseline pattern used throughout this CMS). Manager and Super Admin see a team-wide view across the whole project; a Project Lead approves entries (see Status below), regardless of their system role, since Project Lead is a per-project designation, not tied to the Manager role (Section 2.2).

**Fields per entry:**

| Field Name | Type | Required | Validation / Notes |
|---|---|---|---|
| Date | Date | Y | Cannot be in the future — enforced server-side (422) |
| Task | Dropdown (this project's tasks, plus a fixed set of non-task categories — see below) | Y | Stored as either a Task (validated to belong to this project) or a Category — one or the other |
| Hours | Number | Y | Must be positive and no more than 24 per entry — the 24 cap is a hard server-side rule as built. The soft warning above 12 is a frontend plausibility nudge, not enforced by the API |
| Notes | Text | N | — |
| Person | Read-only, auto-set to the logged-in team member | N/A | — |
| Save as Draft | Checkbox | N | Built: off by default — an entry logs straight to Submitted unless explicitly saved as a Draft first (see Status below) |

**Built precondition for logging at all:** the My Timesheet screen is visible to every role (anyone can be staffed on a project), but visibility is not membership — logging hours against a project requires actually being that project's Lead or a Member, checked explicitly on the log endpoint (422 otherwise). Screen access never substitutes for the per-project team check.

**Added on 2026-07-30, on explicit instruction: hours don't always belong to a task, and the form shouldn't force one.** Finishing a task early with no ready replacement, sitting in an internal meeting, or doing admin work are all real hours in a person's day — if the only way to log time is against a task, that time either goes unrecorded or gets awkwardly padded onto whatever task is open, and either way the day's hours are no longer honest. The Task dropdown now ends with five non-task categories, built exactly as listed: **Bench / Free Time**, **Internal Meeting**, **Training / Learning**, **Admin & Overhead**, **Other**. They go through the exact same Draft → Submitted → Approved flow as a task entry, and Approved hours count toward Payroll's hour-basis input the same way regardless of which one was picked — the categories exist to make *what kind* of non-task time it was visible in the timesheet history, not to change how it's treated downstream.

**Status (built as a three-state flow):** **Draft** (optional — the team member's own working copy) → **Submitted** (logged by the team member; the default when not saved as Draft) → **Approved** (by the Project Lead, or Manager/Super Admin) → **only Approved hours count toward Payroll's hour-basis input**, the same principle already used for Leave, where only Approved requests count as "Taken" (Leave module, Module 5).

**Draft rules, as built:** only the entry's owner can touch a Draft — edit it, discard (delete) it, or submit it. An entry that is no longer a Draft refuses all three with a 409 ("only a Draft entry can be edited, submitted, or discarded"); someone else's entry answers 404, not 403. Draft is the *only* editable or deletable state — once Submitted, an entry can only be Approved. Submitting stamps the submitted-at time (as does logging directly to Submitted).

**Approval rules, as built:** approval is per entry and only a Submitted entry can be approved (409 otherwise). Who may approve: anyone whose role has the approve action on the Team Timesheet screen (Manager, Super Admin), **or the Project Lead of this specific project regardless of their system role** — the endpoint resolves the screen permission manually and then applies the Lead override, since Project Lead is a per-project designation, not a role. A caller who can't see the screen and isn't the Lead gets a 404 (so the action's existence never leaks), while one who can see it but lacks approve rights gets a 403. Approval stamps who approved and when.

**Screens:**

- **My Timesheet** (self-service — `GET /timesheets/me`): the logged-in person's own entries across all their projects, newest first, with a running weekly total (the total is a frontend rendering of the returned rows). **Filters (built):** Date range, Approval Status (Draft / Submitted / Approved — multi-select), and Task — the team view's filters minus the person picker, which is meaningless there. Filter-based export built (`format=pdf|excel`; columns Date, Task/Category, Hours, Status).
- **Team Timesheet** (Manager, Super Admin, Project Lead — `GET /projects/{id}/timesheets`): every team member's entries for the project, with per-person and project totals (frontend rollups of the same rows), and an Approve action per entry. The screen check here mirrors approval: a Project Lead of any system role can open their own project's team view even though their role can't see the screen anywhere else — resolved manually per project, with 404 for everyone else. **Filters (built):** Person, Approval Status (Draft / Submitted / Approved — multi-select), Date range, Task, and Sprint (entries whose task is in that sprint). Plus the baseline set and filter-based export (`format=pdf|excel`; columns Employee, Date, Task/Category, Hours, Status), per the Filter & Export Convention (RBAC, Module 14, Section 2.2).

  **Deferred on the team view:** bulk approve (approval is per entry as built), the Hours range filter, and the "submitted more than N days ago, still unapproved" toggle. The last is the one with a real downstream consequence — Approved hours feed Payroll's planned hour-basis calculation (Module 6), so an unapproved entry aging quietly matters; until the toggle exists, filtering Approval Status to Submitted plus a date range answers the same question manually.

**Empty state:** "No hours logged yet."

**The forward link to Payroll, confirmed:** the Payroll module (Module 6, Section 7) flagged "Tasks / Projects done" as a planned input without detail. This is that detail, now fully specified rather than just referenced: once Payroll's hour-basis calculation is built, it reads Approved Timesheet hours per employee per pay period as one of its inputs, alongside attendance.

---

## 3. Workflows

### 3.1 Creating a Project from a Won Opportunity (or Starting Fresh)

1. Manager or Super Admin opens the Project Directory (2.1) and clicks **+ Add Project**.
2. They select a Customer, then optionally an Opportunity from that customer's list.
3. If an Opportunity is selected and isn't already Won, saving this project automatically sets it to Won (the cross-module trigger described in 2.2).
4. They set Status, dates, Budget, and staff the team — a Project Lead and any Members.
5. The system generates the Project Code (e.g. PRJ-2026-0001). The project is ready to work in — Task Board, Sprints, and Bugs all become available immediately.
6. A project can equally be started with no Opportunity selected at all — useful for internal work or a deal tracked outside this system — and one can be linked later by editing the project.

### 3.2 A Task's Life

1. Anyone with access to the project clicks **+ Add Task** from the Task Board (2.3), filling in at least a Title and an Assignee.
2. It starts in Backlog (or wherever it was created from) and moves across the board — To Do → In Progress → In Review → Done — by drag-and-drop or the Status dropdown on Task Detail (2.4). Both routes call the same narrow status-only endpoint (2.3), so a card move never disturbs the task's other fields.
3. Along the way, anyone on the team can add Comments and check off Sub-tasks.
4. Only Manager or Super Admin can Delete it, at any point in its life — unless Timesheet entries have been logged against it, in which case the delete is refused (409) rather than destroying the record behind someone's approved hours.

### 3.3 A Bug's Life

1. Anyone with access to the project reports a bug (2.6) — Title, Severity, and whatever else is known.
2. It starts at Status = Open, gets assigned, and moves through In Progress → Fixed → Closed as work happens, with comments logged along the way.
3. Only Manager or Super Admin can Delete it.

### 3.4 A Sprint's Life

1. Manager or Super Admin clicks **Start Sprint** (2.5), naming it and setting its dates. Status = Active.
2. They use **Update Sprint** to pull tasks into it from the backlog as work is planned.
3. The team works those tasks across the board as normal — sprint membership doesn't change how a task moves, it's just a grouping.
4. Manager or Super Admin clicks **Complete Sprint** once the cycle ends. Status = Completed; anything still not Done returns to the Backlog for the next sprint to pick up.

### 3.5 Timesheet Entries Feeding Payroll's Hour-Basis Calculation

1. Timesheets (2.8) is built: a team member logs hours against a specific task (or a non-task category) as they work — optionally parked as a Draft first, then Submitted, then Approved by the Project Lead, Manager, or Super Admin.
2. Those entries roll up per person, per project, on the Team Timesheet view.
3. Once Payroll's planned hour-basis calculation (Payroll module, Section 2.5) is also built, it reads Approved entries from this data as one of its inputs, alongside attendance — completing the "Tasks / Projects done" input that module's documentation flagged without detail. The Payroll-side consumption is the remaining forward-looking piece; everything on this module's side of the link exists.

## 4. UI/UX Notes

- **Task Board supports drag-and-drop** between columns, with the Status dropdown on Task Detail as an equivalent alternative — neither is the "real" way, they're the same action from two entry points.
- **Bug cards show Severity as a colored badge**, visually distinct from task cards, so a glance at a board tells you whether you're looking at planned work or reported issues.
- **Sprint view is kept separate from the general backlog/board** — sprints are a planning lens on top of the same tasks, not a second place tasks live; a task belongs to the board first, and optionally to a sprint on top of that.

## 5. Connected To / Depends on Masters

Connected To: Customer, Opportunity (creation trigger), Invoice (a project can be invoiced), Employee (team members)

Owns: Tasks, Bugs, Sprints, Milestones, Timesheets, Budget

Depends on Masters: Financial Year, Company Profile (for the project code prefix)

Needs: An existing Customer, and Employees to staff the team

**Confirmed already correctly set up in Masters:** the Project Code prefix is already defined in Company Profile's Number Prefixes table (Masters, Section 3.6e) — no new gap here.

**Export and filters, as built:** every *list* screen in this module — Project Directory (2.1), Task Board (2.3), Sprints (2.5), Bugs (2.6), Milestones (2.8), My Timesheet and Team Timesheet (2.8), and the two My Projects & Tasks lists (Section 1 note) — carries Search, multi-select Status filters, and a `format=pdf|excel` export that follows the active filters and scoping exactly, per the system-wide Filter & Export Convention (RBAC, Module 14, Section 2.2). The one exception is the Project Report (2.7): its filters are built but its export is deferred, since it returns count blocks rather than a row list. Each screen's built and deferred filters are documented on its own section above.

**Two board-specific rules worth repeating here**, since they're the kind of thing that gets lost between a specification and a build: on the Task Board, filters apply to all five columns at once and each column's card count reflects the filtered set; and a board exports as a flat task list with the column as the Status value, not as a board.

## 6. Role-Based Access

- **Employee** — sees and works on projects they're a team member of: view the board, tasks, and bugs; add comments; move their own tasks across the board. Cannot delete tasks or bugs, and cannot manage sprints (start/update/complete).
- **Manager** — full access: every project, every board, sprint management, and delete rights.
- **Accountant** — no access by default.
- **HR** — no access. Projects aren't an HR concern.
- **Super Admin** — full access to everything, including the RBAC settings screen itself.

Cross-checked directly against the source spreadsheet's Project row: Super Admin = All, Employee = partial (view, tasks & bugs, comments — no delete, no sprints), Manager = All, Accountant = NA, HR = NA. This matches the brief exactly, restriction for restriction.

**How this is enforced in the build:**

- The module registers these RBAC screens: `project.directory`, `project.board` (tasks and bugs share it), `project.sprints` (with a `manage` action), `project.milestones` (with a `manage` action), `project.report`, `project.timesheet.mine`, `project.timesheet.team` (with an `approve` action), and `employee.my_projects_tasks` for the self-service screen. Task/bug delete is the board screen's `delete` action; project create/edit is the directory's `edit` action.
- **Employee's "own" scope means "team member of THIS project"** — the Lead + Members roster, a concept of its own (`project_scope.py`), deliberately distinct from the org reporting hierarchy used by employee-family modules. Every list endpoint filters by it, and every single-record and mutating endpoint re-checks it explicitly — a scoped list is never trusted to protect the record behind it.
- An out-of-scope or invisible record answers **404, never 403** — an out-of-scope project simply looks like it doesn't exist, so neither its existence nor the existence of a restricted action leaks. (The one deliberate 403 is a visible Team Timesheet without approve rights — the screen is legitimately in view there; only the action is denied.)
- The **Project Lead override** on the Team Timesheet and its approve action is resolved manually per project, on top of role permissions — the one place in this module where authority comes from the project record itself rather than from the role matrix.

**On "what does Manager mean" here:** the sixth module in a row where this applies (after Ticket, Payroll, Vendor, Customer, and Opportunity). Same resolution as every non-Payroll case so far: Manager's broad, company-wide access is kept exactly as the source sheet gives it. The pattern remains unbroken — Payroll is still the only module where this got defaulted down, because pay is the only data among these six that's personal rather than operational.

### 6.1 Nothing Here Is Hardcoded

All of the access above should be controlled from the central RBAC settings screen, fully designed later in the Roles & Access module. Concrete examples, specific to this module:

- **"Restrict Manager to Only Projects They Manage"** — OFF by default: Manager sees every project, matching the source sheet. Turned ON: Manager only sees/manages projects where they're the assigned Project Lead.
- **"Give Accountant Read Access to Project Budgets"** — OFF by default: no access. Turned ON: Accountant can see the Budget field across all projects for financial planning, without task/bug/sprint access.
- **"Allow Employee to Manage Sprints on Their Own Projects"** — OFF by default, matching the sheet's explicit "no sprints" restriction. Turned ON: a trusted team member can start, update, and complete sprints without needing Manager-level access.
- **"Show Project Report to Employee"** — Assumption, added since Report access wasn't explicitly granted to Employee in the brief. OFF by default. Turned ON: team members can see the same task/bug counts Manager sees, for their own projects.
- **"Hide Budget from Employee's Project View"** — Assumption, added given the caution already shown around financial figures elsewhere in this CMS (Purchase Value hidden from Manager by default in Asset Management, salary hidden from Manager by default in Payroll). OFF by default here — meaning Budget currently shows to Employee on the Directory (2.1) same as everyone else, since nothing in the brief explicitly restricted it. Turning this ON would hide it from Employee specifically, if that default turns out to be the wrong call.

**Per-person overrides:** the same mechanism as every other module — Super Admin can grant one specific individual extra permission beyond their role, without changing the setting for everyone else in that role. The full settings-screen design belongs in the Roles & Access module; this document only defines what needs to be toggle-able here.

## 7. Assumptions & Points to Confirm

1. **Project Lead required on every project** — not explicitly stated as required, but assumed since a project should always have someone accountable. Built as assumed: the API rejects a project without one.
2. **"Project Lead" used instead of "Manager"** for the team-lead field, to avoid confusion with the system-wide Manager role — see the naming note in Section 2.2. Purely a documentation clarity choice, not a functional change.
3. **Bug Status values (Open / In Progress / Fixed / Closed)** — explicitly flagged in the brief itself as a reasonable default, not a confirmed requirement. Built as the enforced set; changing it now means a migration, not just a doc edit.
4. **Incomplete tasks return to Backlog when a sprint completes** — a common Agile pattern, not explicitly specified. Built as assumed: Complete Sprint clears the sprint link and resets non-Done tasks to Backlog.
5. **Project Report not opened to Employee by default** — not explicitly restricted or granted in the brief; defaulted to Manager/Super Admin only, with a toggle to widen it, rather than assumed open.
6. **Budget visible to Employee on the Directory by default** — flagged, not silently assumed, given the established pattern of hiding financial figures from broad view elsewhere in this CMS (Asset Management, Payroll). A toggle is provided to hide it instead, in case the safer default should actually apply here too.
7. **Milestones and Timesheets — implemented, not left as Coming Soon**, per your explicit direction. As built: Milestones' Reached status is manual rather than auto-inferred from linked tasks (with Missed flipped lazily on read), and Timesheets uses a Draft → Submitted → Approved flow — Draft added in the build as the owner's editable working copy, mirroring Payroll's own Draft state, with logging defaulting straight to Submitted — so only Approved hours count toward Payroll's future hour-basis calculation.
8. **Confirmed against Sheet1** — the Project row matches this brief's Role-Based Access exactly, and confirms the Won-trigger connection appears directly in the raw source text ("Opportunity From that customer change stage to won"), independently validating what the Opportunity module's Section 3.3 already documented.
9. **Closes an open reference in the Payroll module:** that document's Assumptions (Module 6, item 11) flagged "Tasks / Projects done" as a planned Payroll input without detail. Section 2.8 here is that detail, now fully specified — Approved Timesheet hours are what feeds it.
10. **Export and filters confirmed** on the Project Directory (2.1) and Project Report (2.7), per the system-wide convention (RBAC, Module 14, Section 2.2). *Extended by item 11 to every list screen in this module.*

11. **This revision — filters on every list screen for every role, with filter-based export, per explicit instruction.** Five list screens audited: the Project Directory had three filters, the Task Board had two (both marked Assumption), and Sprints, Bugs, and Project Report had none documented at all. The Bugs tracker having no severity filter is the clearest gap of the five — "show me Critical and High" is the first thing anyone does on a bug list.

    **One earlier decision was deliberately reversed, and it's flagged rather than quietly changed.** Project Report previously stated "no charts, trends, or date-range filtering — this is deliberately light." Filters are now added there. What's kept is the part that mattered: still no charts and no trends, still a counts-and-move-on summary. Filtering a count doesn't turn it into a dashboard, and "how many bugs opened this sprint" is a fair question to ask of a screen that already counts bugs.

    **Two board-specific rules were stated that the document previously left to inference**, both easy to build wrong: filters on the Task Board apply to all five columns at once with each column's count reflecting the filtered set; and a board exports as a flat task list with the column as Status, not as a board. A filter that silently applied to only some columns would be near-invisible on a Kanban screen and would misrepresent workload.

12. **Reconciled against the built backend (2026-08-03).** Every screen, field, workflow, and access rule above was checked against the implementation (`backend/app/api/v1/projects.py`, `backend/app/services/project_scope.py`, `backend/app/schemas/project.py`) and marked built, deferred, or corrected in place. The deferred items, gathered in one place: Directory — Financial Year, Service Category, overdue and no-activity toggles, Super Admin's Created By / Last Modified By / archived toggle; Task Board — Label/Tag, Created By, Created On range, Overdue toggle (Unassigned dropped as unsatisfiable, Task-ID search dropped as meaningless on UUIDs); Sprints — "current sprint only" toggle; Bugs — Created On range, Overdue toggle, Bug-ID search; Milestones — overdue toggle (superseded by the lazy Missed flip); Report — export; Team Timesheet — bulk approve, Hours range, "unapproved > N days" toggle. Nothing in the built API exceeds this document's scope; the additions the code forced into the doc (Task Priority and Sprint fields, the narrow status endpoint, the Timesheet Draft state, the task-delete 409, team-membership validation on assignees and hour-logging, the Project Lead approval override, lazy Missed) are all documented on their own screens above.

---

**Suggested filename:** `10-project-module.md`
