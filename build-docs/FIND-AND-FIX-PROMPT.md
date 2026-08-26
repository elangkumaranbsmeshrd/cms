# Meshrd CMS — Find & Fix Prompt (session handoff)

**Paste this whole file as the first message of a new session.**

---

## 1. Your job, in one sentence

**Open the running application, find every defect yourself, fix them, and prove each fix — module by
module, screen by screen, as every role.**

**What you must NOT do:** write more planning documents. There are already 13 in `build-docs/`. The project
does not need another prompt, a strategy, a checklist, or a testing framework proposal. It needs defects
found and fixed. **If you catch yourself writing a `.md` instead of opening a screen, stop.**

---

## 2. Project

```
Root:      D:\Projects\Company Management Software
Frontend:  frontend/          Angular 19, runs on http://localhost:4200
Backend:   backend/           FastAPI + MySQL, runs on http://127.0.0.1:8001
Prototype: prototype/         open index.html in a browser — the approved VISUAL reference
Specs:     01-…15-…-module.md at the root — the source of truth for CONTENT
```

**Both servers are expected to be running already.** Verify with:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4200
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/docs
```

**Scale:** 15 modules · 168 screens · 367 API endpoints across 41 routers · 5 roles.
**Built so far:** Masters (claimed complete, isn't) · Employee, Vendor, Customer (partial) · the rest exist
in varying states. Assume nothing is finished until you have seen it work.

**Logins:** `superadmin@ / manager@ / accountant@ / hr@ / employee@meshrd.in`, password `Passw0rd!`
⚠ **These users have `must_change_password=True`** — you will be bounced to a change-password screen.
Handle that first (see Defect #1; fixing the seed solves it).

---

## 3. THE RULE THAT OVERRIDES EVERYTHING

**The prototype is authoritative for VISUAL DESIGN ONLY. The `.md` specs are authoritative for CONTENT AND
PERMISSIONS.**

The prototype was built with hardcoded demo data and **leaks role-restricted fields — it renders HR-only
fields on an Employee's screen.** Copying its role behaviour would build permission bugs deliberately.

| Question | Ask |
|---|---|
| What does it look like? Layout, spacing, colour, icon, button style | **Prototype** |
| Which fields exist? Labels, mandatory, validation, hints? | **`.md` spec's Fields Table** |
| **Which role sees what?** | **`.md` spec §6** + `prototype/app-rbac.js` POLICY/ACTIONS/FIELDS tables |
| Business rules, formulas, status transitions | `build-docs/APPENDIX-B-business-rules.md` |
| Approved decisions, incl. "do NOT build X" | `build-docs/APPENDIX-A-approved-decisions.md` |

---

## 4. Defects already confirmed — do not re-discover these, just fix them

Each was traced to source in a previous session. **Start here.**

### #1 — BLOCKER: no employee record is linked to any login
**Symptom:** My Profile and My Dashboard show *"No employee record is linked to your login"* for every role.
**Root cause:** `Employee.user_id` exists (`backend/app/models/employee.py:44`) but `backend/app/seed.py`
creates the 5 users **without creating matching Employee records or setting `user_id`.**
**Impact:** breaks the **self-service baseline** — a rule stated verbatim in four specs:
> *"every person is, first, an employee themselves… nobody's access to their own leave should ever be
> narrower than a plain Employee's."*

Roughly **10 screens × 5 roles ≈ 50 screen-role combinations are dead**: My Profile · My Dashboard ·
My Leave · My Payslips · My Documents · My Tickets · My Assets · My Projects & Tasks · My Tax Declarations ·
My Expenses.
**Fix:** seed an Employee row per user, linked via `user_id`, with department, designation, employment type,
reporting manager and salary structure so those screens have real data. Also clear
`must_change_password` for the demo users, or the login flow blocks everything.

### #2 — HIGH: raw UUIDs displayed instead of names
**Symptom:** Employee Directory shows `f47abc9e-8d5d-11f1-a936-12014f771860` in Department, Designation and
Employment Type columns.
**Root cause, two parts:**
1. `frontend/src/app/shared/screens/ref-data.service.ts:45` — `return map.get(id) ?? id;` **falls back to
   printing the raw id.** Showing a UUID to a user is never acceptable — it must be `—` or "Unknown".
2. **Orphaned foreign keys** — employees reference Masters rows that no longer exist (a previous session
   wiped the Masters tables without repairing dependent rows).
**Fix:** both. Change the fallback, then repair or reseed the orphaned references. **Audit every FK in
every table for orphans — this is systemic, not local to Employee.**

### #3 — MEDIUM: three filter dropdowns all labelled "Anyone"
`frontend/src/app/features/employee/screens/emp.directory.config.ts:90,93,94` — Reporting Manager,
Created By and Last Modified By all use `allLabel: 'Anyone'`. Indistinguishable on screen.
**Fix:** distinct labels. **Then check every other list config for duplicate `allLabel`s.**

### #4 — HIGH: role switcher ships to production
`frontend/src/app/layout/topbar.component.ts:261` renders a "VIEWING AS / Previewing" role switcher. Its own
comment calls it impersonation. **This must not be available to production users.**
**Fix:** gate to non-production, or Super-Admin-only with an audit-logged, visibly-bannered impersonation
mode.

### #5 — HIGH: unstyled components — CSS classes used but never defined
`frontend/src/app/features/masters/screens/holidays-import.component.ts` uses `class="formbar"`.
**No file in `frontend/src/styles/` defines `.formbar`** — it exists only in `prototype/app.css`. That
screen's button bar renders completely unstyled.
**Find every instance:**
```bash
grep -rhoE 'class="[^"]+"' frontend/src/app --include=*.ts \
  | sed 's/class="//;s/"//' | tr ' ' '\n' | sort -u > /tmp/used.txt
grep -rhoE '^\.[a-z][a-z0-9_-]*' frontend/src/styles/*.css | sed 's/^\.//' | sort -u > /tmp/defined.txt
comm -23 /tmp/used.txt /tmp/defined.txt
```
**Every line printed is an unstyled element.** Port the rule from `prototype/app.css`.
Known never-ported: `.formbar` `.row-actions` `.field-lock` `.form-grid` `.kbd` `.soon` `.unread`.
`.row-actions` and `.field-lock` matter most — row action alignment on every list, and the lock affordance
the specs require on derived fields.

### #6 — MEDIUM: My Projects & Tasks defects
- Empty state reads *"You aren't on any project yet"*; spec §2.8 says *"You're not assigned to any projects
  yet."*
- **Milestones and Timesheets tabs have no "Coming Soon" badge** — spec §2.8 explicitly requires one. This
  needs the `.soon` class from #5.
- Empty state offers no path forward for a role that can create projects.
  *(Note: the absence of an "Add Project" button on this screen is CORRECT — it is the employee-facing view.
  Creation lives in Project Directory, which does have "+ Add Project" —
  `project.directory.list.config.ts:68`. Verified. Do not "fix" this.)*

### #7 — MEDIUM: junk test data visible
"Nisha Out5", "Exit Probe342701", "Divya Lead5" (duplicated), "Suresh Iyer" (duplicated), phone
`9999999999`, every Reporting Manager `—`. Purge and reseed with realistic data.

### #8 — Masters module gaps
`build-docs/MASTERS-COMPLETION-PROMPT.md` documents ~60 confirmed gaps with file/line evidence: duplicate
export buttons on every list, Holidays Bulk Import, `Code`/`Used` columns stripped from ~11 screens, the
`Status` field missing from all 18 forms, Work Week & Hours missing 3 of 6 tabs, Company Profile missing its
Documents tab, Tax Schemes having no backend, Add Tax Head's structure.
**Verify each is still real before fixing** — some may already be done.

---

## 5. The method — repeat for every screen

For **each screen**, for **each role that can open it**:

1. **Open the spec section and the screen side by side.**
2. **Walk this checklist:**
   - **Data** — no raw UUIDs, `null`, `undefined`, `NaN`, `[object Object]`, `SCREAMING_SNAKE`, junk names.
     Dates `dd-mm-yyyy`, money grouped, blanks as `—`
   - **Fields** — every row of the spec's Fields Table is a **rendered field**; a hint or prose mention does
     not count. Labels, mandatory markers, input types, dropdown options, hints all match the spec
   - **Buttons** — every action the spec names exists; **click each one and confirm it does something**;
     correct label, variant, position; **Delete visible ONLY to Super Admin**; destructive actions confirm
   - **Filters/export** — every filter the spec lists; no two share a label; filters actually filter;
     **exactly one** export pair; export honours the filter
   - **Navigation** — breadcrumbs, Back to true origin, Cancel navigates (never toasts), no dead links,
     deep-link works
   - **Roles** — against the spec's §6, **never against the prototype's rendered output**. Correct scope;
     restricted fields absent from the **API response**, not merely hidden in the DOM
   - **Visual** — nothing unstyled, light **and** dark, no horizontal scroll, loading/empty/error states
   - **Console** — zero errors, zero failed requests
3. **Record each defect:**
```
### [MODULE] Screen — as [ROLE]
Defect:   one sentence
Expected: what the spec says, with § reference
Actual:   what is on screen
Severity: Blocker | High | Medium | Low
Root cause: file:line, or "not traced"
```
4. **Fix it.** 5. **Write a regression test.** 6. **Next screen.**

**Severity:** Blocker = wrong money/hours, permission leak, data loss, screen won't load · High = missing
spec'd field or action, broken workflow, raw UUID · Medium = wrong label, missing filter, inconsistency ·
Low = spacing, wording.

---

## 6. Order of work

**Fix #1 first — nothing else can be inspected properly until logins have employee records.**

Then, module by module. After each, produce `defects/<NN>-<module>-defects.md` before starting the next:

| # | Module | Screens | Roles | Watch for |
|---|---|---|---|---|
| 1 | **Employee** | 21 | **All 5** | Defects #1–#3, #6, #7. Master Record's 10 tabs. Statutory blocks generated from Masters→Taxes. Onboarding/Offboarding actions |
| 2 | **Masters** | 50 | SA · Manager(4) · HR(2) · Accountant(Taxes) | Every gap in `MASTERS-COMPLETION-PROMPT.md` |
| 3 | **Leave** | 12 | **All 5** | Approval routing exactly per §2.2; never self-approve; **Accountant's own leave must work** |
| 4 | **Payroll** | 10 | All 5 for payslips | Manager sees no amounts unless flagged; processed periods read back LOCKED figures; Attendance's 6 tabs |
| 5 | **Asset** | 12 | SA·Mgr·HR·Acct | Purchase Value **and its filter** hidden from Manager |
| 6 | **Ticket** | 6 | All 5 | Assigned Staff filter for Employee only when toggle is on |
| 7 | **Customer** | 5 | SA·Mgr | Customer 360's 8 tabs, each independently filtered/exported |
| 8 | **Vendor** | 3 | SA·Mgr·Acct | Bank/GST hidden from Manager per toggle |
| 9 | **Opportunity** | 5 | SA·Mgr | Filters apply to BOTH views; stage totals reflect filter; Lost needs a reason |
| 10 | **Project** | 14 | All 5 | Board filters apply to all columns with per-column counts |
| 11 | **Invoice** | 6 | SA·Acct | Paid invoice locks; Credit Note list; ageing buckets |
| 12 | **Expense** | 7 | **All 5** | **Manager and HR must be able to submit their own** |
| 13 | **Purchase Bill** | 3 | SA·Acct | Withholding deducted from payment, not added |
| 14 | **Tax & Compliance** | 9 | SA·Acct | Register accrues from all four sources |
| 15 | **RBAC** | 5 | SA | Permission change takes effect **without redeploy or re-login**; SA cannot lock itself out |
| 16 | **Shell/Settings/Dashboard** | — | All 5 | Defect #4; Settings' 4 tabs; per-role dashboards |

### The self-service baseline — the rule most likely to be broken
Quoted from Leave §6, Payroll §6, Expense §6:
> *"every person is, first, an employee themselves… nobody's access to their own X should ever be narrower
> than a plain Employee's."*

Expense §6 adds: *"This specifically fixes Manager and HR, who have no access at all in the source
spreadsheet."* Leave §6 says the same for Accountant.

**So every self-service screen must work identically for all 5 roles.** Test each one as all five. The
common failure is a role having no row in the source data and therefore being given nothing.

---

## 7. Cross-cutting passes — after the module sweep

**A. Role matrix.** Every screen × 5 roles: can open? correct scope? correct fields? correct actions?
Produce the grid. Every cell must match the spec's §6.

**B. Data integrity.** Every FK resolves to a live row · no orphans after any delete · the `?? id` fallback
gone · all junk data purged · every module reseeded with realistic, resolvable data.

**C. Production readiness.** Role switcher gated (#4) · no demo credentials on the login screen · no
"coming soon" routing fallback remaining · `must_change_password` flow works · the string "Meshrd" appears
in no component (it comes from Company Profile).

---

## 8. Rules for doing this honestly

1. **Never mark a screen OK without opening it as every applicable role.**
2. **Never sample.** Two previous audits missed real gaps by deciding which screens were "lower risk." Both
   were wrong, both times on the screens they skipped. **Enumerate everything, check each item.**
3. **Compare against the spec, not against what looks reasonable.** A screen can look fine and be missing
   four required fields.
4. **Click every button.** A control that does nothing is a bug, not a placeholder.
5. **Verify before reporting.** A previous session was told CGST and Declaration Cap were "missing" from Add
   Tax Head — they were present, hidden behind the Tax Type dropdown exactly as the prototype does it.
   **A defect list is only useful if everything on it is real.** Phantom defects send developers to break
   working code.
6. **Fix as you go.** Do not accumulate a 300-item list and fix nothing. Find it, fix it, test it, move on.
7. **Screenshot every defect.**
8. **If the spec is genuinely ambiguous, record it as an open question** — do not invent an answer, do not
   silently skip it.

---

## 9. Definition of done, per module

- [ ] Every screen opened as every applicable role
- [ ] Every spec field is a rendered field · every spec action exists and works
- [ ] Zero raw UUIDs, zero console errors, zero dead controls, zero unstyled elements
- [ ] Role behaviour matches the spec's §6 — verified at the **API**, not the DOM
- [ ] Self-service screens work for all 5 roles
- [ ] Light and dark both pass
- [ ] Every defect found has been fixed and has a regression test
- [ ] `defects/<NN>-<module>-defects.md` written, with counts by severity

**Report defects fixed, not documents produced.**
