# Meshrd CMS — Complete Test Suite Prompt

**Goal: an enterprise-grade CMS with no known bugs, nothing hardcoded, every function working, verified by
tests — not by clicking around and hoping.**

**Scope: the ENTIRE application.** All 15 modules · 168 screens · 367 API endpoints across 41 routers ·
5 roles · every calculation · every permission boundary. Nothing sampled, nothing assumed, nothing skipped.

---

## 0. Why five layers and not just Playwright

Each layer catches a class of bug the others structurally cannot. Skipping one leaves that class
undetected — this is the reasoning, not ceremony:

| Layer | Catches | Cannot catch |
|---|---|---|
| **1. Calculation** | A payslip that pays the *wrong amount* | Whether the button that runs payroll exists |
| **2. API / integration** | Server accepting invalid data; permissions not enforced server-side | Whether the UI shows the result |
| **3. Security / bypass** | Someone skipping the UI entirely and calling the API directly | Anything about correctness of business math |
| **4. Frontend unit** | Broken form logic, wrong derived field, bad conditional | Whether it's wired to a real endpoint |
| **5. Playwright E2E** | Broken buttons, missing screens, dead links, visual/RBAC leaks | Whether the number on screen is *correct* |

**The one that matters most here is Layer 1.** This system calculates payroll, tax, leave balances and
depreciation. Playwright will happily report green on a payroll run that pays someone ₹8,000 instead of
₹80,000, because it only checks the screen didn't crash. **A UI bug is embarrassing; a wrong payslip is a
legal and financial problem.**

### Current state — verified, not assumed

| Layer | Status |
|---|---|
| Calculation tests | ❌ **None exist** |
| API tests | 🟡 6 test files, all RBAC-toggle focused. **367 endpoints; a handful covered** |
| Security/bypass | 🟡 Partial (`test_file_download_authz.py` is the right shape — needs generalising) |
| Frontend unit | ❌ **Zero `.spec.ts` files.** Karma configured, unused |
| Playwright E2E | 🟡 Installed, config scaffolded, **no tests written** |

---

# LAYER 1 — Calculation correctness (build this first)

**Location:** `backend/tests/calc/test_<domain>_math.py`
**Rule: every formula in `APPENDIX-B-business-rules.md` gets a test with hand-computed expected values.**
Never assert against what the code returns — assert against a number you worked out yourself from the spec.

### The formulas, verbatim from the spec, each needing tests

**1. Unpaid leave deduction** — `APPENDIX-B:223`
```
UNPAID LEAVE DEDUCTION = (Gross Pay ÷ Total Days in Month) × Unpaid Leave Days
```
Cases: 0 unpaid days · 1 day · every day in month · 28/30/31-day months · February in a leap year ·
fractional (half-day) · gross of 0 · rounding at 2 decimals.

**2. Attendance hours** — `APPENDIX-B:105`
```
Gross Hours     = Check-Out − Check-In
Net Worked      = Gross Hours − Break
Balance         = Net Worked − Required Hours for that date
Day Status      = DERIVED from hours, never from presence
```
Cases: the spec's own example (**9 hours on site with a 2-hour lunch is a shortfall** — assert it comes out
negative) · exact match to required · grace window boundary (1 minute inside, 1 minute outside) · half-day
threshold boundary · check-out before check-in (must reject) · overnight shift · missing check-out.

**3. Required hours** — `APPENDIX-B:206`
```
Required Hours = Net Working Hours per Day × working days in period
working days   = calendar weekdays − Mandatory holidays + working Saturdays (per policy's Saturday rule)
```
Cases: **all 7 Saturday rules** (Odd / Even / All Working / All Off / First Only / Last Only / Custom) ·
month with 4 vs 5 Saturdays · mandatory holiday falling on a working Saturday (**holiday must win**) ·
half-day intern policy · 6-day support policy · policy changing mid-period.
**Assert explicitly: nothing in this calculation is a constant.** Change the policy → the number changes.

**4. Straight-line depreciation** — `APPENDIX-B:263`
```
Current Value = Purchase Value − (Purchase Value ÷ Useful Life in Years × Years Since Purchase)
```
Cases: year 0 (= purchase value) · mid-life · exactly end of life (**must be 0, never negative**) · past end
of life (**must clamp at 0**) · useful life of 0 or null (must not divide by zero) · asset purchased today.

**5. Invoice balance** — `APPENDIX-B:426`
```
Balance = Grand Total − Paid
```
Cases: unpaid · part-paid · exactly paid · overpaid · with a credit note applied · multiple payments.

**6. Tax engine — the highest-risk area in the system**
Every path through `tax_engine`:
- **Percentage** · **Fixed Amount** · **GST IGST** · **GST CGST+SGST** (assert CGST + SGST = total)
- **Slab — Progressive**: base spanning 1 band, 2 bands, all bands, exactly on a boundary, above the
  open-ended band
- **Slab — Flat by Band**: same cases — **assert Progressive and Flat produce DIFFERENT numbers** for the
  same input (the spec calls them materially different; a test that passes for both means the toggle is
  being ignored)
- **Split components**: shares summing to 100 · rejecting shares that don't · component amounts summing to
  the parent
- **Relief rules**: below threshold · exactly on it · above it · relief exceeding the tax (**must clamp to
  zero, never negative**)
- **Declaration cap**: under · exactly at · over
- **Withholding**: on payments made · on payments received · both directions on one head · Subtotal vs
  Total base producing different figures
- **Zero configured heads** → every document produces no tax line, no crash

**7. Leave balance & carry-forward**
Opening balance · accrual · deduction on approval · restoration on rejection/cancellation · carry-forward
capped at the type's max · carry-forward when unused < cap · negative balance handling · pro-rated for a
mid-year joiner · encashment.

**8. Payroll run — full assembly**
Gross → each statutory head applied in order (Minimum Base, Ceiling, Cut-Off, per-period cap, rounding —
**in that exact order**) → employee-borne reduce net, company-borne don't → ad-hoc adjustments → income tax
spread across remaining periods → net pay.
Cases: mid-month joiner · mid-month leaver · employee with every head opted out · unpaid leave + shortfall
together · recurring vs one-time ad-hoc (**one-time is spent, recurring persists** — `APPENDIX-B:237`) ·
reissue recalculating without re-deriving ad-hoc lines.

**9. Number prefix generation**
Format assembly · financial-year insertion · running number increments · resets at FY boundary when
configured · **does NOT reset when not configured** · starting number honoured · concurrent generation
produces no duplicates.

**10. Pay cycle resolution**
An event dated after End Day rolls into the next period · salary credit date clamping in a short month
(**Feb with credit day 30 must not overflow into March**) · multi-day leave spanning a cutoff split across
both periods.

### Layer 1 acceptance
- [ ] Every formula above has tests including **all boundary and error cases listed**
- [ ] Expected values are hand-computed from the spec, with the arithmetic shown in a comment
- [ ] No test asserts "whatever the function returned"
- [ ] Money compared at 2 decimals with explicit rounding; hours at the precision the spec states
- [ ] Every division has a divide-by-zero test

---

# LAYER 2 — API / integration tests

**Location:** `backend/tests/api/test_<router>.py` — one file per router, **41 routers, all covered.**
Reuse the existing `conftest.py` fixtures (`db_session`, `seed_canonical`, `seed_with_override`).

### For EVERY one of the 367 endpoints

| Check | Assert |
|---|---|
| Happy path | 2xx + correct response shape |
| Validation | Bad/missing/wrong-type fields → 422, not 500 |
| Not found | Unknown id → 404, not 500 |
| Auth | No token → 401 |
| Permission | Wrong role → 403 |
| Scope | `own`/`team` role sees only its own rows |
| **Round-trip** | **POST → GET returns what you sent. PUT → GET returns the change.** |

**The round-trip check is not optional.** The Tax Head PUT bug — silently discarding slab bands, split
components and relief rules — passed every other check and would have been caught by this one alone.
**Apply it to every endpoint with nested/child data:** tax heads, work-week policies, company profile,
invoices with line items, purchase bills, payroll runs, employee compensation, opportunities, projects.

### Per-module functional flows (not just endpoints)

- **Masters** — create → edit → deactivate → verify hidden from dropdowns but still on historical records ·
  in-use entry cannot be deleted · locked FY freezes everything dated inside it, **including for Super
  Admin** · unlock is Super-Admin-only and audited
- **Employee** — full lifecycle: create → onboard → salary structure → statutory blocks generated from Taxes
  → documents → offboard → exit. Assert an exited employee's history stays readable
- **Leave** — apply → the exact routing rule (Reporting Manager → HR if none → HR always for Manager/HR/
  Accountant applicants → Super Admin if no HR → **never self-approve**) → approve/reject → balance moves
  correctly → carry-forward run
- **Payroll** — attendance → reconciliation → run → preview → confirm → payslip → **processed period reads
  back LOCKED figures** (edit the policy afterward; assert the payslip does not change) → reissue
- **Invoice** — draft → send → part-pay → pay → **locked** → credit note → balance reduced without
  reopening the invoice
- **Expense** — submit → approve → reimburse · receipt-required toggle actually blocks approval
- **Purchase Bill** — record → pay → withholding deducted from payment, not added to it
- **Asset** — add → assign → transfer → maintenance → depreciate → reclaim on exit
- **Ticket** — create → assign → converse → resolve → close · satisfaction-required toggle blocks close
- **Opportunity** — stages → **Lost requires a reason** → Won triggers Project creation
- **Project** — create → tasks → sprints → bugs → milestones → timesheets → approved hours feed payroll
- **Customer/Vendor** — CRUD + all 360 tabs return correctly scoped data
- **Tax & Compliance** — liability register accrues from every source (payroll, invoice, bill, expense) →
  remittance → certificate tracking
- **RBAC admin** — change a permission → **takes effect immediately without redeploy or re-login** →
  change log records old/new/who/when → **Super Admin cannot lock itself out**

### Layer 2 acceptance
- [ ] All 41 routers have a test file; all 367 endpoints have at least the 7 checks above
- [ ] Every nested-data endpoint has a round-trip test
- [ ] Every module's functional flow above passes end to end
- [ ] Every RBAC toggle tested both ON and OFF

---

# LAYER 3 — Security / permission-bypass tests

**Location:** `backend/tests/security/`
**Premise: assume the attacker never opens your UI.** They have a valid low-privilege token and call the API
directly with curl. Hiding a button proves nothing.

### The bypass matrix — for every role × every restricted resource

1. **Direct object access** — Employee requests another employee's payslip/salary/documents by id → 403/404
2. **Field-level leak** — Employee requests Project Directory → **assert `budget` is absent from the JSON
   body**, not merely hidden in the DOM. Same for Manager + Purchase Value, Manager + Vendor bank/GST,
   HR/Accountant + Salary Structure fields
3. **Scope escape** — Manager requests an employee outside their team, by id and via filter params
4. **Write escalation** — every non-Super-Admin role attempts DELETE on every deletable resource →
   **403 for all of them, no exceptions** (the platform rule: delete is Super-Admin-only and not grantable)
5. **Mass assignment** — POST/PUT with extra fields the role may not set (`role_id`, `is_super_admin`,
   `status`, `is_arithmetic_locked`) → ignored or rejected, never applied
6. **Export bypass** — a role's export must contain exactly the columns its screen shows. Manager's payroll
   export with the salary flag OFF must have **no amount column in the file itself**
7. **Locked-record bypass** — direct PUT to a Paid invoice / Processed payslip / locked FY record / locked
   tax head → rejected
8. **IDOR on files** — request a file id belonging to another user → 403
9. **Token handling** — expired token · token after logout (**must be revoked, not merely client-deleted**)
   · token from a deactivated user · role changed after token issue → new permissions apply
10. **Injection** — SQL/NoSQL patterns in every search and filter param; path traversal in file endpoints
11. **must_change_password** — a user with the flag set cannot reach any other endpoint until changed

### Layer 3 acceptance
- [ ] Every role × every restricted resource in the matrix, explicitly tested
- [ ] Field-level assertions are on the **response body**, never the rendered page
- [ ] Every delete endpoint refuses all four non-Super-Admin roles

---

# LAYER 4 — Frontend unit tests

**Location:** alongside the file, `*.spec.ts`. Karma is already configured; **there are currently zero.**

### What must be covered

**Shared spine** (highest value — ~50 configs depend on it):
- `create-list-store` — filter state, server-param composition, client predicates, sessionStorage persistence
- `cell-format` — money grouping, dd-mm-yyyy, badge mapping, enum→label, **null/undefined/empty inputs**
- `date-presets` — every preset, especially financial-year ones reading real FY rows
- `column-policy` — alignment rules
- `policy.store` — `canOpen` / `isReadOnly` / `can` / `fieldMode` across all 6 modes; `ALWAYS_ALLOWED` verbs
  permitted on a view-only screen
- `form-screen` — `visibleWhen` progressive disclosure; **hidden fields excluded from submit**; dirty-state
  guard
- `tabbed-screen` — tab switching, count badges, embedded shapes
- Breadcrumb service — trail derivation from routes

**Per-screen logic:**
- Tax Head form — **every `visibleWhen` branch**: each Tax Type revealing the right rate fields, the
  onward-liability toggle revealing its six, withholding scope revealing direction/base/certificate
- Work Week policy — Net Working Hours derived = Gross − Break
- Financial Year — end-date default derivation, and that it stays **overridable**
- Number prefix — live format preview
- Pay cycle — the two preview lines

### Layer 4 acceptance
- [ ] Every file in `shared/screens/` has a spec
- [ ] Every `visibleWhen` branch in every config exercised
- [ ] Every formatter tested with null, undefined, empty string, zero, and negative

---

# LAYER 5 — Playwright E2E

**Location:** `tests/` (per the generated `playwright.config.ts`)

### Fix the blocker first

The 5 seeded users have `must_change_password=True`. **Every test will hang on the change-password screen
until this is handled.** Either seed test users with the flag cleared, or make the login fixture complete the
change-password flow. Do this before writing anything else.

Users: `superadmin@ / manager@ / accountant@ / hr@ / employee@meshrd.in`, password `Passw0rd!`
Frontend `:4200`, API `127.0.0.1:8001`. Configure `webServer` to start both.

### Test 1 — the sweep (write this first, it produces your bug list)

**Every screen × every role that can open it.** For each: page loads · **zero console errors** · zero failed
network requests · not showing "coming soon" · has a Back control and breadcrumbs (if below module root) ·
has filters and both export buttons (if a list) · **export buttons appear exactly once** · read-only badge
shown when the role is view-only.

Expect a long failure list on the first run. That list is the point.

### Test 2 — persistence (catches the Tax Head class of bug)
Create → reopen → **every field still there**. Edit → reopen → **change persisted, nothing else lost.**
Especially for screens with child rows.

### Test 3 — filters and export
Apply filter → row count changes → chip appears → clear-all restores → **export file contains exactly the
filtered rows** and its header states the filters.

### Test 4 — RBAC visible behaviour
Per role: nav shows only permitted modules · restricted screen by direct URL → 403 page · **Employee cannot
see Budget on Project Directory** · Manager sees no salary amounts unless the flag is on · **no role but
Super Admin sees a Delete control anywhere.**

### Test 5 — runtime RBAC round-trip
As Super Admin, change a permission in the RBAC matrix → log in as that role → **the change is live without
redeploy or re-login** → revert → verify reverted.

### Test 6 — dynamic config proof (nothing hardcoded)
Rename a Department in Masters → **assert the new name appears everywhere it's used** and the old string
appears nowhere. Repeat for a Payment Mode, a Leave Type, and a tax head's Print Label.
**Delete every tax head → invoices and payslips still generate, with no tax lines and no crash.**

### Test 7 — UI quality
Light **and** dark theme on every screen · no horizontal scroll at 1280/1440/1920 · no text clipping ·
loading, empty and error states render · every empty state names its filters when filtered.

### Test 8 — journeys (whole business flows, cross-module)
Hire→pay: create employee → salary structure → leave → attendance → payroll → payslip.
Quote→cash: customer → opportunity → won → project → invoice → payment → credit note.
Procure→pay: vendor → purchase bill → withholding → payment → compliance register.

### Layer 5 acceptance
- [ ] All 168 screens covered by the sweep, for every role that can open them
- [ ] Zero console errors across the whole app
- [ ] All 8 test groups pass in Chromium, Firefox and WebKit

---

# Cross-cutting — also required

- **Accessibility**: add `@axe-core/playwright`; assert zero critical/serious violations on every screen.
  Keyboard-only navigation reaches every interactive control; visible focus everywhere
- **Data integrity**: migrations apply cleanly onto a populated database; concurrent edits handled
  deliberately; **no orphaned child rows after any delete**
- **Load** (last, once stable): `scripts/load_check.py` says outright it is *"not a real load test."* Replace
  with a real one against production-shaped hardware — list endpoints with 10k+ rows, payroll for 500
  employees, 50 concurrent users

---

# Order of work

1. **Fix the Playwright login blocker** — nothing else runs until this works
2. **Layer 5 Test 1 (the sweep)** — generates the real bug list, cheap to write, highest immediate value
3. **Layer 1 calculation tests** — highest risk, currently zero coverage
4. **Layer 3 security tests** — second highest risk
5. **Layer 2 API tests** — module by module, following the build order
6. **Layer 4 frontend unit tests** — shared spine first
7. **Rest of Layer 5** — as each module is completed
8. **Accessibility, then load**

**Then, permanently: every bug found anywhere gets a regression test before it is fixed.** That is the only
mechanism that keeps "no known bugs" true over time.

---

# Definition of done — the goal, stated honestly

- [ ] All 5 layers implemented across all 15 modules, 168 screens, 367 endpoints, 5 roles
- [ ] Every formula in `APPENDIX-B` has hand-computed tests including boundaries and error cases
- [ ] Zero console errors, zero failed requests, zero dead controls, anywhere, for any role
- [ ] No role but Super Admin can delete anything — proven at the API, not the UI
- [ ] No hardcoded value survives Test 6
- [ ] Every layer runs in CI; a failure blocks merge
- [ ] Every historical bug in `MASTERS-COMPLETION-PROMPT.md` has a regression test

**One honest caveat, worth stating rather than pretending otherwise:** "zero bugs" is not a state software
reaches and holds. What *is* achievable, and what this suite delivers, is **zero known bugs plus the
machinery to stop them coming back** — every bug found becomes a permanent test. That is what enterprise-
grade actually means in practice.
