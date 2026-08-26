# Meshrd CMS — End-to-End Hardening & Playwright Verification Prompt

**Goal, in the client's own words:** *"no bugs, no problems, not hardcoded, very clean UI, everything
functional, enterprise-level software."*

**This document is the definition of done for the whole application.** Everything below was verified against
the real repository on 2026-08-06 — ports, credentials, role codes, file paths, and existing test counts are
all real, not placeholders.

---

## 0. The one rule that governs this entire effort

**A feature is not "done" because the code exists. It is done when a Playwright test drives it through the
browser, as the role that owns it, and it works.**

Every prior audit on this project was a *source diff* — reading configs and comparing them to the prototype.
That method found real gaps, but it structurally **cannot** find:

- a field that exists but doesn't save
- a button that renders but throws on click
- a PUT that returns 200 but silently discards child rows *(this exact bug already happened once — the Tax
  Head save discarded slab bands, split components and relief rules; a source diff would never have caught
  it)*
- a filter chip that says "Status: Active" while the table shows everything
- an export that ignores the filter it claims to follow
- a permission hidden in the UI but wide open on the API

**Playwright is how those get found.** Source diffs are done. This phase is behavioural.

---

## 1. Verified environment — use these exact values

| Thing | Value |
|---|---|
| Frontend dev server | `http://localhost:4200` (`cd frontend && npm start`) |
| Backend API | `http://127.0.0.1:8001/api/v1` (already CORS-allowed for :4200 in `app/core/config.py`) |
| Playwright root | project root — `playwright.config.ts`, `testDir: './tests'` |
| Existing backend tests | **22 files** in `backend/tests/` (pytest) — keep them passing |
| Existing frontend unit tests | **0** — Karma is configured in `angular.json` but nothing is written |
| CI | `.github/workflows/backend-ci.yml` + `.github/workflows/playwright.yml` (both exist) |

### The five real seeded users — from `backend/app/seed.py:744-750`

| Role code | Email | Password | Name |
|---|---|---|---|
| `SUPER_ADMIN` | `superadmin@meshrd.in` | `Passw0rd!` | Ravi Shankar |
| `MANAGER` | `manager@meshrd.in` | `Passw0rd!` | Vikram Iyer |
| `ACCOUNTANT` | `accountant@meshrd.in` | `Passw0rd!` | Nisha Kulkarni |
| `HR` | `hr@meshrd.in` | `Passw0rd!` | Fatima Sheikh |
| `EMPLOYEE` | `employee@meshrd.in` | `Passw0rd!` | Arun Menon |

> **⚠ Blocker to handle first:** seeded users are created with **`must_change_password=True`**, and
> `app/auth/deps.py` enforces it server-side. A naive login fixture will be redirected to a
> change-password screen and every test will fail. **Decide and implement one of these before writing any
> test** — do not work around it per-test:
> 1. A `tests/global-setup.ts` that logs in each user once via the API, completes the forced password
>    change, and stores the resulting `storageState` per role. **Recommended** — it tests the real flow once
>    and is fast thereafter.
> 2. A seed flag (`SEED_E2E=1`) that creates these five users with `must_change_password=False`.
>
> Option 1 is better: option 2 means the change-password flow is never exercised at all.

---

## 2. Playwright configuration — replace the scaffold

The generated `playwright.config.ts` is the stock template. Change these:

```ts
testDir: './tests',
use: {
  baseURL: 'http://localhost:4200',
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
},
webServer: [
  { command: 'npm start', cwd: 'frontend', url: 'http://localhost:4200', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  { command: 'uvicorn app.main:app --port 8001', cwd: 'backend', url: 'http://127.0.0.1:8001/docs', reuseExistingServer: !process.env.CI, timeout: 120_000 },
],
globalSetup: './tests/global-setup.ts',
```

**Keep all three browser projects** (chromium, firefox, webkit) — but add a `setup` project dependency so
auth state is built once. Run the full cross-browser matrix in CI; chromium alone is fine locally.

**`fullyParallel: true` is dangerous here and must be reconsidered.** These tests mutate a shared database.
Two tests creating a Department at the same time, or one test wiping Masters while another reads it, will
produce flaky failures that look like product bugs. Either:
- give each test file its own data namespace (prefix every created record, e.g. `E2E-{testId}-Travel`), **or**
- set `workers: 1` for the mutating suites and keep parallelism for read-only ones.

**Do not chase flakes with `retries`.** A test that passes on retry is hiding either a race in the test or a
real bug in the app. Investigate every one.

---

## 3. Test suite structure

Mirror the module structure so a failure names the module immediately.

```
tests/
  global-setup.ts            # login all 5 roles, handle forced password change, save storageState
  fixtures/
    auth.ts                  # test.extend with per-role authenticated pages
    api.ts                   # direct API client for setup/teardown + permission probes
    console-guard.ts         # fails any test that logs a console error (see §5)
  smoke/
    every-screen-loads.spec.ts   # THE most valuable test — see §4
  masters/                   # 21 sub-masters
  employee/  leave/  payroll/  asset/  ticket/
  opportunity/  project/  invoice/  expense/  purchase-bill/
  compliance/  rbac/
  cross-cutting/
    filters-and-export.spec.ts
    back-and-breadcrumbs.spec.ts
    rbac-enforcement.spec.ts
    no-hardcoded-values.spec.ts
    theme-and-ui.spec.ts
```

---

## 4. Write this test FIRST — it will find the most bugs per line of code

**`tests/smoke/every-screen-loads.spec.ts`** — for **every screen in `nav-registry.ts`'s `SCREEN_ROUTES`
map**, for **every role that can open it**, assert:

1. The page renders — a `.page-title` or `.rec-head` is visible
2. **Zero console errors** (see §5)
3. **Zero failed network requests** (no 4xx/5xx other than deliberate 403s)
4. It is **not** the `coming-soon` placeholder
5. It is **not** an empty error card ("This screen failed to render", "can't be embedded yet")
6. If it is a list screen: the table, an empty state, or a loading state resolves — never an indefinite spinner

Drive it from the route map, not a hand-written list, so a newly added screen is covered automatically:

```ts
import { SCREEN_ROUTES } from '../../frontend/src/app/layout/nav-registry';
for (const [screenId, route] of Object.entries(SCREEN_ROUTES)) { /* ... */ }
```

**Expect this test to fail a lot on first run. That is the point** — it is the fastest possible inventory of
what is actually broken, and it converts "many functionalities not working" from a feeling into a list.

---

## 5. Zero-tolerance gates — wire these as fixtures, not per-test asserts

Every test inherits these automatically. Any violation fails the test.

**Console errors.** Attach a listener in the fixture; fail on any `console.error` or uncaught page
exception. Allow-list nothing without a written comment explaining why.

**Network failures.** Fail on any response ≥400 that the test did not explicitly expect. A 403 during an
RBAC negative test is expected and asserted; a 500 anywhere is a bug.

**Angular change-detection / hydration errors.** These surface as console errors — the guard above catches
them.

**No `NaN`, `undefined`, `null`, `[object Object]`, or `Invalid Date` rendered anywhere.** Assert the page
body text never contains them. This catches the entire class of formatting bugs cheaply.

---

## 6. What to test per module — the pattern, applied to all 15

For **every** list screen:

- **Loads** with correct columns, empty state, and result count
- **Every filter works** — apply it, assert the row count changes, assert the chip appears, assert "Clear all"
  restores
- **`transport: 'server'` filters actually round-trip** — intercept the network call and assert the query
  param is present. *This is the silent-failure class: a wrong `transport` means the API ignores the param,
  the screen shows unfiltered rows, and the chip lies.*
- **Export follows the filter** — apply a filter, export, and assert the downloaded file's row count matches
  the on-screen count, and its header block names the applied filters
- **Sort and pagination** work
- **Row click** opens the correct record — *by id*, not a fixed demo record

For **every** create/edit form:

- **Create → appears in list → open → values match what was typed** (full round-trip)
- **Edit → save → reopen → change persisted** — *this is where the Tax Head child-row bug lived; test nested
  arrays explicitly*
- **Validation fires** on required fields, formats, min/max
- **Cancel discards and navigates back** to the origin list with filters intact
- **Server validation mirrors client** — POST an invalid payload directly via API, assert 4xx

For **every** record screen with tabs:

- Every tab renders, count badges are correct, per-tab filters and exports work
- **Sub-resources are tabs, never nav buttons**

---

## 7. RBAC — test it as an attacker, not as a UI reviewer

Hiding a button is not security. For every restricted action:

1. **UI layer** — assert the control is absent for the role that shouldn't have it
2. **API layer** — call the endpoint **directly** with that role's token and assert **403**

**Specifically required by the write-authority rule (`MASTER-BUILD-PROMPT.md` §4a):**

- **Delete is Super Admin only, everywhere, and is not grantable.** For each of the other four roles, attempt
  a DELETE on a Masters record via API → assert 403. Assert the control is not merely hidden but rejected.
- **Update defaults to Super Admin only** unless explicitly granted per screen.
- **A locked Financial Year is frozen for everyone including Super Admin** — attempt an edit on a record
  dated inside a locked FY → assert rejection.

**Field-level (Layer 3) must be enforced server-side.** The canonical case: log in as `EMPLOYEE`, open the
Project Directory, and assert **Budget is absent from the API response body** — not merely hidden in the
DOM. A field hidden only in CSS is defeated by devtools in ten seconds.

**Data scope.** Assert Manager sees only their team's rows, Employee only their own — by comparing row
counts against a Super Admin fetch of the same endpoint.

---

## 8. "Not hardcoded" — make it a test, not a code review

Turn the §6 dynamic-configuration rule into automated assertions:

- **Change a value in Masters → assert the dependent screen changes.** E.g. rename a Department → assert the
  Employee form's dropdown shows the new name. This proves the dropdown is data-driven, not a static list.
- **Empty configuration is a valid state.** With zero Tax Heads configured: assert an Invoice renders with
  **no tax line** and Subtotal = Grand Total, and a payslip renders with **no statutory deductions** — and
  that neither errors. This is the project's central design rule and must be proven, not assumed.
- **With zero Tax Schemes:** assert the Tax Scheme field is absent from the Tax Head form and no scheme
  picker appears on the employee declaration screen.
- **No tax is ever named in the UI.** Assert no rendered text matches `/\b(GST|PF|ESI|TDS|professional tax)\b/i`
  on a freshly-seeded system with no tax heads. Any hit is a hardcoded tax leaking into the product.
- **Company identity comes from Company Profile.** Change the company name → assert generated PDFs and page
  chrome reflect it. Assert the literal string `Meshrd` appears nowhere in `frontend/src/**` or
  `backend/app/**` outside seed data and comments.
- **Currency/date formats** come from settings, not literals (a known outstanding gap — `₹` is currently
  baked into several field labels; see `taxes.form.config.ts`'s own comment).

---

## 9. Clean UI — the checks worth automating

- **Theme parity** — run a visual snapshot of every screen in **light and dark**. Dark mode is where
  hardcoded colours surface.
- **No horizontal scroll** at 1280px, 1440px, and 1920px on any screen.
- **Back and breadcrumbs exist on every screen below a module root** — assert the breadcrumb trail has the
  right depth and every ancestor segment navigates.
- **Export buttons appear exactly once per list screen** — *there is currently a confirmed duplicate;
  `list-screen.component.ts` renders them in both the page header and the filter bar.* Assert
  `getByRole('button', { name: /export pdf/i })` has count **1**.
- **Every button either works or is visibly disabled with a reason.** Click every enabled button on a screen;
  assert none produces a console error, a 500, or silence.
- **Loading, empty, and error states** render for every async surface — test by stubbing a slow response, an
  empty array, and a 500.

---

## 10. Execution order — do not write 500 tests before fixing anything

1. **Fix the auth blocker** (§1) and land `global-setup.ts`.
2. **Write the smoke test** (§4). Run it. **Triage the failures into a list.** This is your real bug backlog
   — replace guesses with it.
3. **Fix the known-confirmed gaps first** — they are already documented with file/line evidence in
   `build-docs/MASTERS-COMPLETION-PROMPT.md`: duplicate export buttons · Holidays Bulk Import missing ·
   Code/Used columns stripped from 11 screens · Status field missing from 18 forms · Work Week & Hours
   missing 3 tabs · Company Profile missing Documents tab · Tax Schemes having no backend at all · Add Tax
   Head's structural rebuild.
4. **Then module by module**, in the dependency order from `MASTER-BUILD-PROMPT.md` §7: Masters → Employee →
   Vendor → Customer → Leave → Asset → Ticket → Opportunity → Project → Invoice → Expense → Purchase Bill →
   Payroll → Tax & Compliance → RBAC admin. For each: write its tests, run them, fix what fails, keep them
   green.
5. **Cross-cutting suites last** (§7–§9) — they assume the modules exist.

---

## 11. Definition of done — the honest version

- [ ] `npx playwright test` passes on **chromium, firefox and webkit**, with **zero retries needed**
- [ ] `cd backend && pytest` — all 22 existing files still pass, plus new permission-denial tests
- [ ] `cd frontend && npm run build` — zero errors, zero new warnings
- [ ] **Every screen in `SCREEN_ROUTES` loads for every role that can open it** — no console errors, no
      failed requests, no `coming-soon`, no "can't be embedded yet"
- [ ] **`coming-soon.component.ts` is deleted** and the route fallback is a real not-found page
- [ ] Every restricted action returns **403 from the API**, not just a hidden button — proven per role
- [ ] Delete is Super-Admin-only everywhere, verified by attempting it as the other four roles
- [ ] A field hidden by Layer 3 is **absent from the API response**, verified on Project Budget as Employee
- [ ] With zero tax configuration, invoices and payslips render correctly with no tax lines
- [ ] No `NaN` / `undefined` / `[object Object]` / `Invalid Date` renders anywhere
- [ ] Light and dark themes both clean on every screen
- [ ] Both CI workflows green

---

## 12. Two things this prompt will NOT achieve on its own — say so rather than pretend

1. **Playwright cannot prove business-rule correctness.** It can prove a payroll run completes and shows a
   number; it cannot prove the number is *right*. Payroll formulas, tax slab arithmetic, leave accrual, and
   ageing buckets need **unit tests against worked examples from `APPENDIX-B-business-rules.md`** — pytest
   on the backend, not Playwright. Budget for both.

2. **"No bugs" is not a reachable end state; "no known bugs, and a suite that catches regressions" is.** The
   goal to hold is: every bug found once becomes a test, so it can never come back silently. Judge this work
   by whether the suite would catch the Tax Head child-row bug if it were reintroduced today — if it
   wouldn't, the suite isn't finished.

**When reporting progress, report: tests written · tests passing · bugs found · bugs fixed · what you could
not verify.** Never report a module complete because it compiles.
