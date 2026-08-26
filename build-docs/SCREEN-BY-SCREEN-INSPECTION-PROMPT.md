# Meshrd CMS — Screen-by-Screen Inspection Prompt

**This is not a test-writing task. This is: open the running application, look at every screen as every
role, compare it against the spec, and write down what is wrong.**

Automated tests cannot do this job. A Playwright sweep reports "green" on a screen showing raw UUIDs in the
Department column, because it has no idea what a Department is supposed to look like. **Only a human or an
agent reading the spec alongside the screen can catch that.** That is this task.

---

## 0. Why this exists — four defects found in 30 seconds on ONE screen

The Employee Directory, viewed as Super Admin, revealed all of these at a glance:

| # | Defect | Root cause |
|---|---|---|
| 1 | **Department / Designation / Employment Type show raw UUIDs** (`f47abc9e-8d5d-11f1…`) instead of "Engineering", "Product Designer", "Full Time" | `ref-data.service.ts:45` — `map.get(id) ?? id` falls back to printing the raw id. Underlying cause: employees reference Masters rows that no longer exist (orphaned FKs) |
| 2 | **Three filter dropdowns all labelled "Anyone"** — indistinguishable | `emp.directory.config.ts:90,93,94` all use `allLabel: 'Anyone'` for Reporting Manager, Created By, Last Modified By |
| 3 | **"VIEWING AS Super Admin" role switcher visible** — a demo/impersonation control that must not ship to production users | `topbar.component.ts:261` |
| 4 | **Onboarding Checklist add buttons missing** | To be traced |

**Also visible: junk test data in a production-looking screen** — "Nisha Out5", "Exit Probe342701", "Divya
Lead5" (twice), "Suresh Iyer" (twice), phone `9999999999`, every Reporting Manager `—`.

**If one screen yields four defects plus data problems, 168 screens will yield hundreds.** That is the
premise of this document.

---

## 1. Source of truth — read this before every screen

| Question | Where the answer lives |
|---|---|
| Which screens exist in this module? | `NN-<module>-module.md` §2 |
| Which fields on this screen? Labels, mandatory, validation, hints? | That screen's **Fields Table** in the spec |
| Which columns, filters, actions, row actions? | The screen's own §2.x section |
| **Which role sees what?** | The module's **§6 Role-Based Access** + `prototype/app-rbac.js` POLICY/ACTIONS/FIELDS |
| What should it look like — layout, buttons, spacing? | `prototype/` (**visual only**) |
| Business rules, formulas, status transitions | `APPENDIX-B-business-rules.md` |
| Approved decisions, including "do NOT build X" | `APPENDIX-A-approved-decisions.md` |

**⚠ The prototype leaks role-restricted fields** (it renders HR-only fields on an Employee's screen). Use it
for pixels. **Never** use its rendered output to decide who sees what — that comes from the spec's §6.

---

## 2. THE SELF-SERVICE BASELINE — the rule most likely to be broken

Verified, quoted from the specs:

> *"**Baseline, shared by all 5 roles:** every person is, first, an employee themselves… nobody's access to
> their own leave should ever be narrower than a plain Employee's."* — Leave §6
>
> *"…nobody's access to their own pay should ever be narrower than a plain Employee's."* — Payroll §6
>
> *"…nobody's access to their own expenses should ever be narrower than a plain Employee's. **This
> specifically fixes Manager and HR, who have no access at all in the source spreadsheet**."* — Expense §6

**So: every self-service screen must work IDENTICALLY for all 5 roles — Super Admin, Manager, HR,
Accountant, Employee.**

Check every one of these as **all five roles**:

| Screen | Module |
|---|---|
| My Profile · My Documents · My Tickets · My Projects & Tasks · My Assets · My Tax Declarations · Announcements | Employee |
| My Leave (apply, balance, history, cancel own pending) | Leave |
| My Payslips · Salary Certificate download | Payroll |
| My Expenses (submit, attach receipt, own history) | Expense |
| Company Holiday Calendar | Leave |
| Dashboard | Overview |

**Common failure: Accountant has no Leave row in the source data, and Manager/HR have no Expense row — so a
naive build gives them nothing. The spec says the baseline still applies underneath.** If Accountant cannot
apply for their own leave, or Manager cannot submit their own expense, that is a defect.

---

## 3. The inspection procedure — repeat for every screen

For **each screen**, for **each role that can open it**:

### Step 1 — Open the spec and the screen side by side
Have the module `.md` open at that screen's section. Have the running app on that screen.

### Step 2 — Walk this checklist

**A. Data correctness (the class that caught the UUID bug)**
- [ ] Every cell shows a **human-readable value** — no raw UUIDs, no `SCREAMING_SNAKE`, no `null`,
      `undefined`, `NaN`, `[object Object]`, `Invalid Date`
- [ ] FK columns resolve to names, not ids
- [ ] Dates in `dd-mm-yyyy`; money grouped with the right symbol; blanks as `—`
- [ ] No test/junk data visible ("Test", "Probe", "asdf", `9999999999`, duplicated names)
- [ ] Counts and totals are arithmetically right

**B. Fields (against the spec's Fields Table, row by row)**
- [ ] **Every row of the Fields Table is a rendered field** — a hint or prose mention does not count
- [ ] Labels match the spec's wording exactly
- [ ] Mandatory markers match the spec's Y/N
- [ ] Correct input type; derived fields read-only with a lock and an explanatory hint
- [ ] Dropdowns contain the spec's full option list, fed from live Masters data
- [ ] Conditional fields appear/disappear on every branch

**C. Buttons & actions (against the spec's §2.x and §6)**
- [ ] Every action the spec names exists
- [ ] Every button **does something** — click it and confirm
- [ ] Labels match the spec's wording
- [ ] Correct variant and position; primary action leads
- [ ] **Delete/Deactivate visible ONLY to Super Admin, on every screen**
- [ ] Destructive actions confirm, naming the specific consequence
- [ ] No duplicated action (the export-pair bug)

**D. Filters & export**
- [ ] Every filter the spec lists, plus the baseline set
- [ ] **No two filters share a label** (the three "Anyone" dropdowns)
- [ ] Filters actually filter; chips appear; Clear all restores
- [ ] Result count visible and correct
- [ ] **Exactly one** export pair; export honours the filter

**E. Navigation**
- [ ] Breadcrumbs present and correct below module root
- [ ] Back returns to the true origin with filters intact
- [ ] Cancel navigates, never toasts
- [ ] No dead links; no screen still showing "coming soon"
- [ ] Deep-link (paste URL) reproduces the screen

**F. Role correctness (against §6, NOT the prototype)**
- [ ] This role should be able to open this screen at all
- [ ] Scope correct: `own` sees only own rows, `team` only direct reports, `full` everything
- [ ] Field-level: restricted fields hidden/masked per §6 — **and absent from the API response**, not just
      the DOM
- [ ] Read-only roles see the Read-only badge and no mutating controls
- [ ] **Self-service baseline honoured (§2 above)**

**G. Visual**
- [ ] Nothing unstyled (see the `.formbar` class of bug)
- [ ] Aligned, consistent spacing, no overlap or clipping
- [ ] Works in light **and** dark
- [ ] No horizontal page scroll
- [ ] Loading / empty / error states render properly

**H. Console**
- [ ] Zero console errors, zero failed network requests

### Step 3 — Record every defect in this exact format

```
### [MODULE] Screen Name — as [ROLE]
**Defect:** one sentence
**Expected:** what the spec says, with the § reference
**Actual:** what is on screen
**Severity:** Blocker | High | Medium | Low
**Root cause:** file:line if traced, else "not traced"
**Evidence:** screenshot filename
```

**Severity guide**
- **Blocker** — wrong money/hours; a permission leak; data loss; screen won't load
- **High** — missing field or action from the spec; broken workflow; raw UUID shown
- **Medium** — wrong label; missing filter; inconsistent styling
- **Low** — spacing, wording polish

---

## 4. The order — module by module, 168 screens

Work down this list. **Do not skip ahead; do not sample.** After each module, produce that module's defect
list before starting the next.

| # | Module | Screens | Roles to check | Watch especially |
|---|---|---|---|---|
| 1 | **Masters** | 50 | Super Admin (all) · Manager (4 tabs) · HR (2) · Accountant (Taxes) | Every gap in `MASTERS-COMPLETION-PROMPT.md` — verify each is fixed. Code/Used columns, Status field on all 18 forms, Work Week's 6 tabs, Company Profile's Documents tab, Tax Schemes, Add Tax Head structure |
| 2 | **Employee** | 21 | **All 5** — heavy self-service | The 4 confirmed defects in §0. Master Record's 10 tabs. Statutory blocks generated from Taxes. Onboarding/Offboarding add buttons |
| 3 | **Leave** | 12 | **All 5** — baseline applies | Approval routing rule exactly as §2.2 states; never self-approve; Accountant's own leave works |
| 4 | **Payroll** | 10 | All 5 for payslips; SA/HR/Accountant for runs | Manager sees no amounts unless flagged; processed periods read back LOCKED figures; Attendance's 6 tabs |
| 5 | **Asset** | 12 | SA · Manager (team) · HR · Accountant | Purchase Value **and its filter** hidden from Manager |
| 6 | **Ticket** | 6 | All 5 | Assigned Staff filter for Employee only when the toggle is on |
| 7 | **Customer** | 5 | SA · Manager | Customer 360's 8 tabs, each filtered and exported independently |
| 8 | **Vendor** | 3 | SA · Manager · Accountant | Bank/GST fields hidden from Manager per the toggle |
| 9 | **Opportunity** | 5 | SA · Manager | Filters apply to BOTH views; stage totals reflect the filter; Lost requires a reason |
| 10 | **Project** | 14 | All 5 (team-scoped) | Board filters apply to all columns with per-column counts |
| 11 | **Invoice** | 6 | SA · Accountant | Paid invoice locks; Credit Note list; ageing buckets |
| 12 | **Expense** | 7 | **All 5** — baseline applies | Manager and HR must be able to submit their own |
| 13 | **Purchase Bill** | 3 | SA · Accountant | Withholding deducted from payment, not added |
| 14 | **Tax & Compliance** | 9 | SA · Accountant | Register accrues from all four sources |
| 15 | **RBAC** | 5 | SA only | Permission change takes effect **without redeploy or re-login**; SA cannot lock itself out |
| 16 | **Shell / Settings / Dashboard** | — | All 5 | **Role switcher must not ship to production users**; Settings' 4 tabs; per-role dashboards |

---

## 5. Cross-cutting passes — after the module sweep

**Pass A — the 5-role matrix.** Take every screen. For each of the 5 roles, record: can open? correct scope?
correct fields? correct actions? Produce a 168 × 5 grid. **Every cell must match the spec's §6.**

**Pass B — data integrity.** The orphaned-FK problem behind the UUID bug is systemic, not local:
- [ ] Every FK in every table resolves to a live row
- [ ] No orphans left by any delete
- [ ] `ref-data.service.ts:45`'s `?? id` fallback replaced — **never show a raw id to a user**
- [ ] All test/junk data removed
- [ ] Every module reseeded so every screen has realistic, resolvable data

**Pass C — production readiness.**
- [ ] Role switcher / impersonation gated to non-production, or Super-Admin-only with an audit log and a
      visible banner
- [ ] No demo credentials on the login screen
- [ ] No "coming soon" fallback remaining
- [ ] `must_change_password` flow works
- [ ] The string "Meshrd" appears in no component — it comes from Company Profile

---

## 6. Output

Per module, produce `defects/<NN>-<module>-defects.md` containing every defect in the §3 Step 3 format,
ordered Blocker → High → Medium → Low, with a header count:

```
# Employee Module — Defect Report
Screens inspected: 21 of 21 · Roles: 5 · Defects: 34 (3 Blocker, 12 High, 15 Medium, 4 Low)
```

Then one `defects/SUMMARY.md` aggregating all modules, with total counts and the top 20 blockers across the
whole application.

---

## 7. Rules for doing this honestly

1. **Never mark a screen "OK" without opening it as every applicable role.** The four §0 defects were all
   visible immediately — they survived because nobody looked.
2. **Never conclude from a subset.** Two earlier audits on this project missed real gaps by reasoning about
   which screens were "lower risk." Both were wrong. Enumerate everything; check each item.
3. **Compare against the spec, not against what looks reasonable.** A screen can look fine and still be
   missing four fields the Fields Table requires.
4. **Click every button.** A control that does nothing is a bug, not a placeholder.
5. **Screenshot every defect.** A screenshot ends an argument that a description starts.
6. **If the spec is genuinely ambiguous, record it as an open question** — do not invent an answer and do
   not silently skip it.
