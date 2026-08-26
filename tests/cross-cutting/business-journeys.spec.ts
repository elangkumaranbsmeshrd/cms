import { test, expect, login, authenticate, API, type Session } from '../fixtures/auth';
import { watchForProblems, waitForQuiet, settleProblems, summarise } from '../fixtures/console-guard';
import type { Locator } from '@playwright/test';

/**
 * §14 of E2E-HARDENING-PROMPT.md's own "Test 8" — the three whole-business-
 * flow journeys, each driven end to end through the REAL UI (click through
 * real screens, never an API call standing in for one), with every money
 * figure hand-derived from what was actually typed in — the same discipline
 * backend/tests/api/test_payroll_flow.py and test_finance_flows.py already
 * use, now proven reachable through the browser rather than re-asserted at
 * the API layer a second time.
 *
 * A figure is treated as "given" (read via a direct, authenticated API call
 * rather than re-derived from first principles) only where deriving it
 * would mean re-implementing calendar/holiday/Saturday-pattern logic that
 * is already unit-tested elsewhere (attendance_engine.py / leave_engine.py)
 * and is not this test's subject — e.g. a payroll period's own Required
 * Hours. Every MONEY figure downstream of that point (LOP deduction,
 * statutory deductions, income tax, total deductions, net pay) is computed
 * here from that given, against the LIVE Masters -> Taxes configuration
 * read at the moment this test actually runs (never a hardcoded snapshot),
 * so the test stays correct even if a concurrent suite adds or retires a
 * tax head while this one is running.
 *
 * DISCOVERED PLATFORM CONSTRAINT — Leave application is genuinely
 * employee-self-service-only, with no admin-on-behalf path anywhere:
 *   - apply_for_leave (backend/app/api/v1/leave_requests.py:283-289) always
 *     resolves the leave applicant via `_require_own_employee(current_user)`
 *     — grepping the whole backend for every `LeaveRequest(...)`
 *     construction site turns up exactly one, this endpoint.
 *   - An admin-created login's temporary password is BY DESIGN never
 *     surfaced back to the admin who created it — employees.py's own
 *     comment on create_login/reset_password: "HR never sees or relays the
 *     password itself — it goes straight to the employee" — so even
 *     creating a login for the new hire would not let this test act as
 *     them afterward.
 * A single test cannot both create a brand-new employee AND have that SAME
 * employee apply for their own leave — there is no real path to it, for
 * anyone, not just this suite. The apply -> approve round trip is still
 * driven for real below (§ HIRE -> PAY step 4), using the seeded EMPLOYEE
 * account, so the flow itself is genuinely exercised; it is deliberately
 * not chained into the new hire's own payroll figures, which is exactly why
 * that employee's payslip assertions expect zero paid/unpaid leave.
 *
 * DISCOVERED GAP — moving an Opportunity to Won neither creates nor offers
 * to create a Project. opportunity.record.component.ts's own page actions
 * are exactly "Edit" and "Create Invoice" (the latter gated on
 * invoice.list's own 'edit' action, not on Stage at all — it renders
 * whatever stage the deal is in). update_opportunity (opportunities.py:
 * 404-449) runs opportunity_engine.mark_opportunity_won on the Won
 * transition, which only sets probability_pct to 100 — nothing in that path
 * touches Project at all. The only real link between the two is the
 * OPPOSITE direction: Project's own create form (project.form.component.ts)
 * lets a person optionally pick an existing Opportunity for the chosen
 * Customer from a plain dropdown, once the project is being created
 * separately. This journey drives that real (if entirely manual, unprompted)
 * path and asserts the automatic behaviour does not exist, rather than
 * silently assuming the doc's description was already built.
 */

// ============================================================================
// Shared helpers
// ============================================================================

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = 'E2E-Journey';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function moneyToNumber(text: string): number {
  const cleaned = (text ?? '').replace(/[^0-9.-]/g, '');
  return cleaned === '' || cleaned === '-' ? NaN : Number(cleaned);
}

function authHeaders(session: Session): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}` };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * document-screen.component.ts / *.record-payment.component.ts /
 * credit-note.detail.component.ts's own `.field` wrapper: a <label> and its
 * input/select/textarea are SIBLINGS with no for/id association at all
 * (confirmed by reading every one of those templates in full) — this is the
 * structural stand-in for getByLabel() there.
 */
function docField(scope: Locator, label: string): Locator {
  return scope.locator('.field').filter({ hasText: label }).locator('input, select, textarea').first();
}

/**
 * emp.salary-structure / my-leave / emp.leave-attendance / payroll.run /
 * project-form's own pattern: a bare, unclassed <div> wrapping a
 * `.cell-sub` label text and its control as siblings — same "no for/id"
 * gap as docField above, a different wrapper shape.
 */
function plainField(scope: Locator, label: string): Locator {
  return scope.locator('.cell-sub').filter({ hasText: label }).locator('xpath=following-sibling::*[1]');
}

/** Mon-Fri dates (inclusive) between two ISO dates. Deliberately NOT
 * calendar-policy-aware beyond that: every weekday is unambiguously a
 * working day under every Work Week Policy shape this app can express
 * (weekly_off_days is always at least Sunday-off, and a Saturday's own
 * on/off status never touches Mon-Fri) — so building this list needs no
 * Masters config at all. How many hours are actually OWED for these dates
 * is a separate question this test answers by reading the real, policy-
 * derived Required Hours back off the API, never by re-deriving it here. */
function weekdaysInRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) out.push(isoDate(cur));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return out;
}

// ---- tax head arithmetic, replicated from backend/app/services/tax_engine.py
// _compute_gross() — PERCENTAGE / FIXED_AMOUNT / SLAB (progressive) only,
// the three types any currently-configured head in this live system
// actually uses. Anything else (a relief rule, a split, GST_CGST_SGST,
// DECLARATION_CAP) throws rather than silently mis-pricing a real payslip
// or bill figure — a disclosed scope boundary, not a gap: the tax engine's
// OWN arithmetic is already exhaustively unit-tested in
// backend/tests/services/test_tax_engine.py, so this only needs to cover
// what a head actually configured for THIS run could be.
interface LiveTaxHead {
  id: string;
  tax_name: string;
  scope: string;
  tax_type: string;
  applies_from: string;
  applies_until: string | null;
  rate_pct: string | number | null;
  fixed_amount: string | number | null;
  slab_bands: { sequence_no: number; band_from: string | number; band_to: string | number | null; rate_or_amount: string | number }[];
  relief_rules: unknown[];
  split_components: unknown[];
  tax_scheme_id: string | null;
  behaviour: Record<string, unknown> | null;
  is_active: boolean;
  withholding_directions?: { direction: string }[];
}

function computeTaxAmount(head: LiveTaxHead, base: number): number {
  if ((head.relief_rules ?? []).length) {
    throw new Error(
      `Tax head "${head.tax_name}" carries relief rules — this test's arithmetic helper does not replicate those. ` +
        `Either this is a real find (a relief-bearing head unexpectedly in force for this run) or the test needs a narrower head filter.`,
    );
  }
  if (head.tax_type === 'PERCENTAGE' || head.tax_type === 'GST_IGST') {
    return round2((base * Number(head.rate_pct)) / 100);
  }
  if (head.tax_type === 'FIXED_AMOUNT') {
    return round2(Number(head.fixed_amount));
  }
  if (head.tax_type === 'SLAB') {
    const bands = [...head.slab_bands].sort((a, b) => a.sequence_no - b.sequence_no);
    let total = 0;
    for (const b of bands) {
      const from = Number(b.band_from);
      if (base <= from) continue;
      const upper = b.band_to === null ? base : Number(b.band_to);
      const inBand = Math.min(base, upper) - from;
      if (inBand <= 0) continue;
      total += (inBand * Number(b.rate_or_amount)) / 100;
    }
    return round2(total);
  }
  throw new Error(`Tax head "${head.tax_name}" uses tax_type ${head.tax_type} — not replicated by this test's arithmetic helper.`);
}

function inForce(head: { applies_from: string; applies_until: string | null; is_active: boolean }, asOf: string): boolean {
  return head.is_active && head.applies_from <= asOf && (head.applies_until === null || head.applies_until >= asOf);
}

// A safely-in-the-past FIXED_CYCLE pay period (Start Day 26 / End Day 25 —
// confirmed live via GET /masters/pay-cycles before writing this file, and
// re-confirmed at runtime below rather than trusted blind) — July 2026 both
// starts and ends comfortably before "today" regardless of which machine or
// timezone actually runs this suite.
const PERIOD_MONTH = 7;
const PERIOD_YEAR = 2026;
const PERIOD_START = '2026-06-26';
const PERIOD_END = '2026-07-25';

test.describe('whole-business-flow journeys', () => {
  // ==========================================================================
  // JOURNEY 1 — HIRE -> PAY
  // ==========================================================================
  test('HIRE -> PAY: employee, salary structure, leave, attendance, payroll run, payslip', async ({ page, request, context }, testInfo) => {
    testInfo.setTimeout(6 * 60 * 1000);
    page.on('dialog', (d) => d.accept());
    const problems = watchForProblems(page);

    const admin = await login(request, 'SUPER_ADMIN');
    await authenticate(page, admin);

    const firstName = `${PREFIX}-Hire-${RUN_ID}`;
    const email = `e2e-journey-hire-${RUN_ID}@example.test`;
    const JOINING_DATE = '2023-01-15';
    const GROSS_MONTHLY = 60000;

    // Confirm the pay cycle this whole journey's arithmetic leans on hasn't
    // moved out from under it before spending the next several minutes
    // walking the UI — a clean, early, named failure beats a confusing one
    // at the payroll step.
    const cyclesRes = await request.get(`${API}/masters/pay-cycles`, { headers: authHeaders(admin) });
    expect(cyclesRes.ok(), await cyclesRes.text()).toBeTruthy();
    const cycles = (await cyclesRes.json()) as { is_active: boolean; cycle_type: string; start_day: number; end_day: number }[];
    const activeCycle = cycles.find((c) => c.is_active);
    expect(activeCycle, 'no active Pay Cycle is configured — Journey 1 cannot resolve a pay period at all').toBeTruthy();
    expect(activeCycle!.cycle_type, 'this journey assumes the live FIXED_CYCLE pay cycle').toBe('FIXED_CYCLE');
    expect(activeCycle!.start_day).toBe(26);
    expect(activeCycle!.end_day).toBe(25);

    // ------------------------------------------------------------ 1. HIRE
    await page.goto('/employees/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Employee', { timeout: 20_000 });
    await page.getByLabel('First Name').fill(firstName);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Department').selectOption({ label: 'Engineering' });
    await page.getByLabel('Designation').selectOption({ label: 'Engineer' });
    await page.getByLabel('Joining Date').fill(JOINING_DATE);
    await page.getByLabel('Employment Type').selectOption({ label: 'Full Time' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await page.waitForURL(/\/employees\/[^/]+$/, { timeout: 20_000 });
    const employeeId = page.url().split('/employees/')[1].split('?')[0];
    await expect(page.locator('.page-title')).toContainText(firstName, { timeout: 20_000 });
    const employeeCode = (await page.locator('.page-sub .mono').first().innerText()).trim();
    expect(employeeCode.length).toBeGreaterThan(0);
    await waitForQuiet(problems);

    // ------------------------------------------------------ 2. SALARY STRUCTURE
    await page.getByRole('button', { name: 'Salary Structure', exact: true }).click();
    await expect(page.getByRole('button', { name: /Create Salary Structure/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Create Salary Structure/ }).click();
    await plainField(page.locator('body'), 'Effective From').fill(JOINING_DATE);
    await plainField(page.locator('body'), 'Basic Salary (Monthly)').fill(String(GROSS_MONTHLY));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Current Structure', { exact: false })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    const structuresRes = await request.get(`${API}/employees/${employeeId}/salary-structures`, { headers: authHeaders(admin) });
    expect(structuresRes.ok(), await structuresRes.text()).toBeTruthy();
    const structures = (await structuresRes.json()) as { effective_to: string | null; gross_monthly: string }[];
    const currentStructure = structures.find((s) => !s.effective_to);
    expect(currentStructure, 'the just-created salary structure must be the CURRENT one (no effective_to)').toBeTruthy();
    expect(Number(currentStructure!.gross_monthly)).toBe(GROSS_MONTHLY);

    // ------------------------------------------------------------- 3. ATTENDANCE
    const attendanceDates = weekdaysInRange(PERIOD_START, PERIOD_END).slice(0, 3);
    expect(attendanceDates.length).toBe(3);

    await page.getByRole('button', { name: 'Leave & Attendance', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ Record Attendance' })).toBeVisible({ timeout: 20_000 });
    for (const date of attendanceDates) {
      await page.getByRole('button', { name: '+ Record Attendance' }).click();
      await plainField(page.locator('body'), 'Date').fill(date);
      await plainField(page.locator('body'), 'Check-In').fill('09:00');
      await plainField(page.locator('body'), 'Check-Out').fill('18:00');
      await plainField(page.locator('body'), 'Break (hours)').fill('1');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: '+ Record Attendance' })).toBeVisible({ timeout: 20_000 });
    }
    await waitForQuiet(problems);

    const attendanceRes = await request.get(`${API}/attendance`, { params: { employee_id: employeeId }, headers: authHeaders(admin) });
    expect(attendanceRes.ok(), await attendanceRes.text()).toBeTruthy();
    const attendanceRows = (await attendanceRes.json()) as { net_worked_hours: string; attendance_date: string }[];
    expect(attendanceRows.length, 'exactly the 3 attendance rows just entered, no more').toBe(3);
    const workedTotal = attendanceRows.reduce((sum, r) => sum + Number(r.net_worked_hours), 0);
    expect(workedTotal, '3 days x 8.00 net hours (09:00-18:00 less a 1h break)').toBe(24);

    // ---------------------------------------------- 4. LEAVE (apply + approve)
    // See this file's own header doc for why this cannot be the new hire.
    const employeeActor = await login(request, 'EMPLOYEE');
    const page2 = await context.newPage();
    page2.on('dialog', (d) => d.accept());
    const problems2 = watchForProblems(page2);
    await authenticate(page2, employeeActor);

    await page2.goto('/my-leave', { waitUntil: 'domcontentloaded' });
    await expect(page2.locator('.page-title')).toContainText('My Leave', { timeout: 20_000 });

    const existingRes = await request.get(`${API}/leave/requests`, { headers: authHeaders(employeeActor) });
    expect(existingRes.ok(), await existingRes.text()).toBeTruthy();
    const existing = (await existingRes.json()) as { from_date: string; to_date: string; status: string }[];
    const busy = new Set(existing.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').flatMap((r) => weekdaysInRange(r.from_date, r.to_date)));
    let probe = new Date('2026-09-01T00:00:00Z');
    let leaveDate = '';
    for (let i = 0; i < 60; i++) {
      const iso = isoDate(probe);
      const dow = probe.getUTCDay();
      if (dow !== 0 && dow !== 6 && !busy.has(iso)) {
        leaveDate = iso;
        break;
      }
      probe = new Date(probe.getTime() + 86_400_000);
    }
    expect(leaveDate, 'could not find a single free weekday within 60 days for the leave application').not.toBe('');

    const leaveReason = `${PREFIX} leave application ${RUN_ID}`;
    await page2.getByRole('button', { name: 'Apply for Leave', exact: true }).click();
    await plainField(page2.locator('body'), 'Leave Type').selectOption({ label: 'Casual Leave' });
    await plainField(page2.locator('body'), 'From Date').fill(leaveDate);
    await plainField(page2.locator('body'), 'To Date').fill(leaveDate);
    await plainField(page2.locator('body'), 'Reason').fill(leaveReason);
    await page2.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page2.getByText(leaveReason)).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems2);

    await page.goto('/leave/approvals', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Leave Approvals', { timeout: 20_000 });
    const leaveRow = page.locator('tbody tr', { hasText: leaveReason });
    await expect(leaveRow).toBeVisible({ timeout: 20_000 });
    await leaveRow.getByRole('button', { name: 'Approve', exact: true }).click();
    // Default view is status=PENDING only — an approved row drops off it.
    await expect(page.locator('tbody tr', { hasText: leaveReason })).toHaveCount(0, { timeout: 20_000 });
    await waitForQuiet(problems);

    const leaveCheckRes = await request.get(`${API}/leave/requests`, { headers: authHeaders(employeeActor) });
    const mineAfter = (await leaveCheckRes.json()) as { reason: string; status: string }[];
    const myLeave = mineAfter.find((r) => r.reason === leaveReason);
    expect(myLeave?.status, 'the leave request must actually have moved to APPROVED, not just vanished from the queue').toBe('APPROVED');
    await page2.close();

    // --------------------------------------------------------------- 5. PAYROLL
    await page.goto('/payroll/run/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Run Payroll', { timeout: 20_000 });
    await plainField(page.locator('body'), 'Month').selectOption({ label: 'July' });
    await plainField(page.locator('body'), 'Year').fill(String(PERIOD_YEAR));
    await plainField(page.locator('body'), 'Employee Selection Mode').selectOption({ label: 'Specific Employees' });
    await expect(page.getByPlaceholder('Search employees by name or code…')).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('Search employees by name or code…').fill(employeeCode);
    const pickerRow = page.locator('label', { hasText: employeeCode });
    await expect(pickerRow).toHaveCount(1, { timeout: 20_000 });
    await pickerRow.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Start Run', exact: true }).click();
    await expect(page.getByText('Preview', { exact: true })).toBeVisible({ timeout: 30_000 });
    await waitForQuiet(problems);

    const runId = page.url().split('/payroll/run/')[1].split('?')[0];
    expect(runId).toBeTruthy();

    const runRes = await request.get(`${API}/payroll/runs/${runId}`, { headers: authHeaders(admin) });
    expect(runRes.ok(), await runRes.text()).toBeTruthy();
    const run = await runRes.json();
    expect(run.pay_period_start).toBe(PERIOD_START);
    expect(run.pay_period_end).toBe(PERIOD_END);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empRow = (run.employees as any[]).find((e) => e.employee_id === employeeId);
    expect(empRow, 'the new hire must appear in their own SPECIFIC_EMPLOYEES run').toBeTruthy();
    expect(empRow.inclusion_status).toBe('INCLUDED');

    const grossPay = Number(empRow.gross_pay);
    expect(grossPay, 'full period, employee joined long before it — no proration').toBe(GROSS_MONTHLY);
    expect(Number(empRow.worked_hours)).toBe(24);
    expect(Number(empRow.unpaid_leave_days), 'no leave overlaps THIS employee — see this file\'s header doc').toBe(0);
    expect(Number(empRow.unpaid_leave_deduction)).toBe(0);
    expect(Number(empRow.paid_leave_days)).toBe(0);

    const totalDaysInPeriod = Number(empRow.total_days_in_period);
    expect(totalDaysInPeriod, '5 days of June + 25 of July').toBe(30);
    const perDayRate = grossPay / totalDaysInPeriod;
    const lopDays = Number(empRow.lop_days);
    // The system's own reported shortfall (required vs worked hours,
    // policy-derived) drives this — not re-derived here — but the DEDUCTION
    // it produces from that shortfall is computed independently below and
    // must match exactly.
    const expectedLopDeduction = round2(lopDays * perDayRate);
    expect(Number(empRow.lop_deduction)).toBeCloseTo(expectedLopDeduction, 2);
    expect(lopDays, 'only 3 of the period\'s working days were attended — a real, non-zero shortfall').toBeGreaterThan(0);

    const taxesRes = await request.get(`${API}/masters/taxes`, { headers: authHeaders(admin) });
    expect(taxesRes.ok(), await taxesRes.text()).toBeTruthy();
    const allHeads = (await taxesRes.json()) as LiveTaxHead[];
    const periodEnd = run.pay_period_end as string;
    const employeeDeductionHeads = allHeads.filter(
      (h) => h.tax_scheme_id === null && inForce(h, periodEnd) && (h.scope === 'PAYROLL_EMPLOYEE_DEDUCTION' || h.scope === 'PAYROLL_EMPLOYER_CONTRIBUTION'),
    );
    let expectedEmployeeStatutory = 0;
    for (const head of employeeDeductionHeads) {
      const borneBy = (head.behaviour?.['borne_by'] as string | undefined) ?? (head.scope === 'PAYROLL_EMPLOYEE_DEDUCTION' ? 'EMPLOYEE' : 'EMPLOYER');
      if (borneBy !== 'EMPLOYEE') continue;
      expectedEmployeeStatutory += computeTaxAmount(head, grossPay);
    }
    expectedEmployeeStatutory = round2(expectedEmployeeStatutory);
    expect(Number(empRow.total_employee_statutory)).toBeCloseTo(expectedEmployeeStatutory, 2);

    const incomeHeads = allHeads.filter((h) => h.tax_scheme_id === null && inForce(h, periodEnd) && h.scope === 'PAYROLL_INCOME_TAX');
    let expectedIncomeTax = 0;
    if (incomeHeads.length) {
      const fyRes = await request.get(`${API}/masters/financial-years`, { headers: authHeaders(admin) });
      const fys = (await fyRes.json()) as { is_current: boolean; end_date: string }[];
      const fy = fys.find((f) => f.is_current);
      expect(fy, 'no current Financial Year — cannot annualise income tax').toBeTruthy();
      const fyEnd = new Date(`${fy!.end_date}T00:00:00Z`);
      const remainingMonths = Math.max(1, Math.min(12, (fyEnd.getUTCFullYear() - PERIOD_YEAR) * 12 + (fyEnd.getUTCMonth() + 1 - PERIOD_MONTH) + 1));
      const annualIncome = grossPay * 12;
      const annualTax = computeTaxAmount(incomeHeads[0], annualIncome);
      expectedIncomeTax = round2(annualTax / remainingMonths);
    }
    expect(Number(empRow.income_tax_amount)).toBeCloseTo(expectedIncomeTax, 2);

    expect(Number(empRow.total_earnings), 'Basic Salary is the only earning line for this structure').toBe(GROSS_MONTHLY);
    const expectedTotalDeductions = round2(expectedEmployeeStatutory + expectedIncomeTax + expectedLopDeduction);
    expect(Number(empRow.total_deductions)).toBeCloseTo(expectedTotalDeductions, 2);
    const expectedNetPay = round2(Number(empRow.total_earnings) - expectedTotalDeductions);
    expect(Number(empRow.net_pay)).toBeCloseTo(expectedNetPay, 2);

    // The same figures, read straight off the Stage 2 preview TABLE in the
    // browser — proving the UI's own numbers, not just the API's, are real.
    const previewRow = page.locator('table tbody tr').first();
    const previewCells = previewRow.locator('td');
    await expect(previewCells.nth(3)).toContainText(String(Math.trunc(grossPay)));
    expect(moneyToNumber(await previewCells.nth(5).innerText())).toBeCloseTo(expectedLopDeduction, 2);
    expect(moneyToNumber(await previewCells.nth(6).innerText())).toBeCloseTo(expectedEmployeeStatutory, 2);
    expect(moneyToNumber(await previewCells.nth(7).innerText())).toBeCloseTo(expectedIncomeTax, 2);
    expect(moneyToNumber(await previewCells.nth(11).innerText())).toBeCloseTo(expectedTotalDeductions, 2);
    expect(moneyToNumber(await previewCells.nth(12).innerText())).toBeCloseTo(expectedNetPay, 2);

    // --------------------------------------------------------------- CONFIRM
    await page.getByRole('button', { name: /Confirm.*Generate Payslips/ }).click();
    await expect(page.getByText('This run is Processed', { exact: false })).toBeVisible({ timeout: 30_000 });
    await waitForQuiet(problems);

    // ------------------------------------------------------------- PAYSLIP
    await page.goto('/payroll/payslips', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Payslips', { timeout: 20_000 });
    await page.locator('input[type=search]').first().fill(employeeCode);
    const payslipListRow = page.locator('tbody tr', { hasText: employeeCode });
    await expect(payslipListRow).toHaveCount(1, { timeout: 20_000 });
    await payslipListRow.click();
    await page.waitForURL(/\/payroll\/payslips\/[^/]+$/, { timeout: 20_000 });
    const payslipId = page.url().split('/payroll/payslips/')[1].split('?')[0];
    await expect(page.locator('.rec-name')).toContainText(firstName, { timeout: 20_000 });
    await waitForQuiet(problems);

    const payslipRes = await request.get(`${API}/payroll/payslips/${payslipId}`, { headers: authHeaders(admin) });
    expect(payslipRes.ok(), await payslipRes.text()).toBeTruthy();
    const payslip = await payslipRes.json();
    expect(Number(payslip.gross_pay)).toBe(GROSS_MONTHLY);
    expect(Number(payslip.total_deductions)).toBeCloseTo(expectedTotalDeductions, 2);
    expect(Number(payslip.net_pay), 'THE headline figure: net pay reflects exactly the salary structure and attendance entered above').toBeCloseTo(expectedNetPay, 2);
    expect(Number(payslip.lop_deduction)).toBeCloseTo(expectedLopDeduction, 2);
    expect(Number(payslip.unpaid_leave_days)).toBe(0);
    expect(payslip.status).toBe('PROCESSED');

    const summaryTiles = page.locator('.rec-summary .s');
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Gross' }).locator('.v').innerText())).toBeCloseTo(GROSS_MONTHLY, 2);
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Deductions' }).locator('.v').innerText())).toBeCloseTo(expectedTotalDeductions, 2);
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Net Pay' }).locator('.v').innerText())).toBeCloseTo(expectedNetPay, 2);

    // The LOP line must be visibly on the printed breakup too, not just in
    // the totals — it is a real, non-zero deduction on this payslip.
    const lopLine = page.locator('.pr.ded', { hasText: 'Loss of Pay Deduction' });
    await expect(lopLine).toBeVisible();
    expect(moneyToNumber(await lopLine.locator('b').innerText())).toBeCloseTo(expectedLopDeduction, 2);

    await settleProblems(problems);
    await settleProblems(problems2);
    expect(summarise(problems), summarise(problems)).toBe('');
  });

  // ==========================================================================
  // JOURNEY 2 — QUOTE -> CASH
  // ==========================================================================
  test('QUOTE -> CASH: customer, opportunity, won, project, invoice, payment, credit note', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(6 * 60 * 1000);
    page.on('dialog', (d) => d.accept());
    const problems = watchForProblems(page);

    const admin = await login(request, 'SUPER_ADMIN');
    await authenticate(page, admin);

    const companyName = `${PREFIX}-Cash Customer ${RUN_ID}`;
    const oppTitle = `${PREFIX}-Cash Opportunity ${RUN_ID}`;

    // ----------------------------------------------------------- 1. CUSTOMER
    await page.goto('/customers/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Customer', { timeout: 20_000 });
    await page.getByLabel('Company Name').fill(companyName);
    await page.getByLabel('Status', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 20_000 });
    const customerId = page.url().split('/customers/')[1].split('?')[0];
    await waitForQuiet(problems);

    const customerRes = await request.get(`${API}/customers/${customerId}`, { headers: authHeaders(admin) });
    expect(customerRes.ok(), await customerRes.text()).toBeTruthy();
    const customer = await customerRes.json();
    expect(customer.company_name).toBe(companyName);

    // --------------------------------------------------------- 2. OPPORTUNITY
    await page.goto('/opportunities/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Opportunity', { timeout: 20_000 });
    await page.getByLabel('Title', { exact: true }).fill(oppTitle);
    await page.getByLabel('Customer', { exact: true }).selectOption({ label: companyName });
    await page.getByLabel('Value', { exact: true }).fill('100000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/opportunities\/[^/]+$/, { timeout: 20_000 });
    const opportunityId = page.url().split('/opportunities/')[1].split('?')[0];
    await expect(page.locator('.rec-name')).toContainText(oppTitle, { timeout: 20_000 });
    await waitForQuiet(problems);

    // No auto-Project / offer exists anywhere yet — confirmed with a clean
    // slate BEFORE Won, so the "still none after Won" check below is not
    // vacuous (a pre-existing Project on this brand-new opportunity would
    // make that assertion meaningless).
    const projectsBefore = await request.get(`${API}/projects`, { headers: authHeaders(admin) });
    expect(projectsBefore.ok(), await projectsBefore.text()).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await projectsBefore.json()).some((p: any) => p.opportunity_id === opportunityId)).toBe(false);

    // -------------------------------------------------------------- 3. WON
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForURL(/\/opportunities\/[^/]+\/edit$/, { timeout: 20_000 });
    await page.getByLabel('Stage', { exact: true }).selectOption({ label: 'Won' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // form-screen.component.ts's save() always returns an EDIT to listRoute
    // (the Pipeline table), never back to the record — onCreateSuccess is
    // only ever consulted on the create branch.
    await page.waitForURL(/\/opportunities$/, { timeout: 20_000 });
    await waitForQuiet(problems);

    await page.goto(`/opportunities/${opportunityId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.badge-s', { hasText: 'Won' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    // *** THE FINDING *** — per this file's own header doc: moving Stage to
    // Won neither creates nor offers to create a Project. Asserted directly
    // rather than assumed: the page's only actions are Edit/Create Invoice
    // (never anything Project-shaped), and no Project has appeared for this
    // opportunity as a side effect of the PUT above.
    await expect(page.getByRole('button', { name: /project/i })).toHaveCount(0);
    const projectsAfterWon = await request.get(`${API}/projects`, { headers: authHeaders(admin) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      (await projectsAfterWon.json()).some((p: any) => p.opportunity_id === opportunityId),
      'moving an Opportunity to Won must not silently create a Project — none is expected, and none exists',
    ).toBe(false);

    // The real, working (if entirely manual) link: create a Project and
    // pick this Won opportunity from its own Customer-scoped dropdown.
    const projectName = `${PREFIX}-Cash Project ${RUN_ID}`;
    await page.goto('/projects/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Project', { timeout: 20_000 });
    await plainField(page.locator('body'), 'Project Name').fill(projectName);
    await plainField(page.locator('body'), 'Customer').selectOption({ label: companyName });
    await expect(page.getByText('Loading opportunities')).toHaveCount(0, { timeout: 20_000 });
    await plainField(page.locator('body'), 'Opportunity').selectOption({ label: oppTitle });
    await plainField(page.locator('body'), 'Project Lead').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/projects\/[^/]+$/, { timeout: 20_000 });
    const projectId = page.url().split('/projects/')[1].split('?')[0];
    await waitForQuiet(problems);

    const projectRes = await request.get(`${API}/projects/${projectId}`, { headers: authHeaders(admin) });
    expect(projectRes.ok(), await projectRes.text()).toBeTruthy();
    const project = await projectRes.json();
    expect(project.opportunity_id, 'the Project must actually be linked to the Won opportunity picked in its own dropdown').toBe(opportunityId);
    expect(project.customer_id).toBe(customerId);

    // ------------------------------------------------------------- 4. INVOICE
    // Reached via the Opportunity's own "Create Invoice" action, which hands
    // off customer_id/reference on the query string — same real path a
    // person would use, not a hand-typed URL replicating it by luck.
    await page.goto(`/opportunities/${opportunityId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Create Invoice', exact: true }).click();
    await page.waitForURL(/\/invoices\/new/, { timeout: 20_000 });

    const LINE_DESCRIPTION = `${PREFIX} Consulting`;
    const RATE = 50000;
    await page.getByRole('button', { name: 'Add Line Item', exact: true }).click();
    const lineRow = page.locator('table.lineitems tbody tr').first();
    await lineRow.locator('input[type=text]').first().fill(LINE_DESCRIPTION);
    const qtyRateInputs = lineRow.locator('input[type=number]');
    await qtyRateInputs.nth(0).fill('1');
    await qtyRateInputs.nth(1).fill(String(RATE));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+$/, { timeout: 20_000 });
    const invoiceId = page.url().split('/invoices/')[1].split('?')[0];
    await waitForQuiet(problems);

    const invoiceAfterCreate = await (await request.get(`${API}/invoices/${invoiceId}`, { headers: authHeaders(admin) })).json();
    expect(invoiceAfterCreate.customer_id, 'the invoice must actually be for the customer handed off from the opportunity').toBe(customerId);
    expect(Number(invoiceAfterCreate.subtotal)).toBe(RATE);
    expect(Number(invoiceAfterCreate.grand_total), 'no tax head chosen — Grand Total equals Subtotal exactly').toBe(RATE);
    expect(invoiceAfterCreate.status).toBe('DRAFT');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.badge-s', { hasText: 'Sent' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    // --------------------------------------------------------- 5. PAYMENT(S)
    const FIRST_PAYMENT = 30000;
    const SECOND_PAYMENT = RATE - FIRST_PAYMENT;
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+\/record-payment$/, { timeout: 20_000 });
    await docField(page.locator('body'), 'Amount Received').fill(String(FIRST_PAYMENT));
    await docField(page.locator('body'), 'Payment Mode').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+$/, { timeout: 20_000 });
    await expect(page.locator('.badge-s', { hasText: 'Part' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    let invoiceAfterFirstPayment = await (await request.get(`${API}/invoices/${invoiceId}`, { headers: authHeaders(admin) })).json();
    expect(invoiceAfterFirstPayment.status).toBe('PART_PAID');
    expect(Number(invoiceAfterFirstPayment.balance_due)).toBe(RATE - FIRST_PAYMENT);

    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+\/record-payment$/, { timeout: 20_000 });
    await docField(page.locator('body'), 'Amount Received').fill(String(SECOND_PAYMENT));
    await docField(page.locator('body'), 'Payment Mode').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByText('Locked.', { exact: false })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    let invoicePaid = await (await request.get(`${API}/invoices/${invoiceId}`, { headers: authHeaders(admin) })).json();
    expect(invoicePaid.status).toBe('PAID');
    expect(Number(invoicePaid.amount_received)).toBe(RATE);
    expect(Number(invoicePaid.balance_due)).toBe(0);
    expect(invoicePaid.is_locked).toBe(true);
    const balanceBeforeCredit = Number(invoicePaid.balance_due);

    // --------------------------------------------------------- 6. CREDIT NOTE
    const CREDIT_AMOUNT = 5000;
    const creditReasonDetail = `${PREFIX} credit note ${RUN_ID}`;
    await page.getByRole('button', { name: 'Raise Credit Note', exact: true }).click();
    await page.waitForURL(/\/invoices\/[^/]+\/credit-note$/, { timeout: 20_000 });
    await docField(page.locator('body'), 'Reason', ).selectOption({ index: 1 });
    await docField(page.locator('body'), 'Credit Amount').fill(String(CREDIT_AMOUNT));
    await docField(page.locator('body'), 'Reason Detail').fill(creditReasonDetail);
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.waitForURL(/\/credit-notes\/[^/]+$/, { timeout: 20_000 });
    const creditNoteId = page.url().split('/credit-notes/')[1].split('?')[0];
    await expect(page.locator('.badge-s', { hasText: 'Draft' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click();
    await expect(page.locator('.badge-s', { hasText: 'Pending Approval' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.locator('.badge-s', { hasText: 'Approved' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    const creditNote = await (await request.get(`${API}/credit-notes/${creditNoteId}`, { headers: authHeaders(admin) })).json();
    expect(creditNote.status).toBe('APPROVED');
    expect(Number(creditNote.credit_amount)).toBe(CREDIT_AMOUNT);

    // ------------------------------- 7. THE HEADLINE: balance moved, invoice did NOT reopen
    await page.goto(`/invoices/${invoiceId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Invoice', { timeout: 20_000 });
    await waitForQuiet(problems);

    const invoiceAfterCredit = await (await request.get(`${API}/invoices/${invoiceId}`, { headers: authHeaders(admin) })).json();
    const balanceAfterCredit = Number(invoiceAfterCredit.balance_due);
    expect(Number(invoiceAfterCredit.credit_note_total)).toBe(CREDIT_AMOUNT);
    expect(Number(invoiceAfterCredit.claim_amount)).toBe(RATE - CREDIT_AMOUNT);
    expect(balanceBeforeCredit - balanceAfterCredit, 'the balance must move by EXACTLY the credit note amount').toBe(CREDIT_AMOUNT);
    expect(invoiceAfterCredit.status, 'a credit note must never reopen a locked (Paid) invoice').toBe('PAID');
    expect(invoiceAfterCredit.is_locked).toBe(true);
    expect(Number(invoiceAfterCredit.amount_received), 'money already received is untouched by a credit note').toBe(RATE);

    // The SAME figures, read straight off the UI's own rec-summary tiles.
    const summaryTiles = page.locator('.rec-summary .s');
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Balance' }).locator('.v').innerText())).toBeCloseTo(balanceAfterCredit, 2);
    await expect(page.locator('.badge-s', { hasText: 'Paid' })).toBeVisible();

    await settleProblems(problems);
    expect(summarise(problems), summarise(problems)).toBe('');
  });

  // ==========================================================================
  // JOURNEY 3 — PROCURE -> PAY
  // ==========================================================================
  test('PROCURE -> PAY: vendor, purchase bill, withholding, payment, compliance register', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(6 * 60 * 1000);
    page.on('dialog', (d) => d.accept());
    const problems = watchForProblems(page);

    const admin = await login(request, 'SUPER_ADMIN');
    await authenticate(page, admin);

    // ------------------------------------------------- 1. WITHHOLDING TAX HEAD
    // Masters -> Taxes was checked live before writing this file: the
    // WITHHOLDING_AT_SOURCE heads that exist there today all carry an EMPTY
    // withholding_directions array, so none of them can actually be applied
    // to a Purchase Bill at all (validate_head_usable requires
    // ON_PAYMENTS_MADE) — a minimal one is created here instead, per this
    // journey's own brief.
    const taxName = `${PREFIX} Withholding ${RUN_ID}`;
    const RATE_PCT = 10;
    await page.goto('/masters/taxes/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Tax Head', { timeout: 20_000 });
    await page.getByLabel('Tax Name', { exact: true }).fill(taxName);
    await page.getByLabel('Scope', { exact: true }).selectOption({ label: 'Withholding / Deduction at Source' });
    await page.getByLabel('Applies From', { exact: true }).fill('2024-01-01');
    await page.getByLabel('Rate (%)', { exact: true }).fill(String(RATE_PCT));
    await page.getByRole('switch', { name: 'Creates an Onward Liability' }).click();
    await page.getByLabel('Remitted To (Authority)').fill(`${PREFIX} Authority`);
    await page.getByLabel('Remittance Period', { exact: true }).selectOption({ label: 'Monthly' });
    await page.getByLabel('Period Aligns To', { exact: true }).selectOption({ label: 'Calendar' });
    await page.getByLabel('Deposit Due', { exact: false }).fill('7');
    await page.getByLabel('On payments this company makes').check();
    await page.getByLabel('Default Calculated On', { exact: true }).selectOption({ label: 'Subtotal' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/masters\/taxes$/, { timeout: 20_000 });
    await waitForQuiet(problems);

    const taxesRes = await request.get(`${API}/masters/taxes`, { headers: authHeaders(admin) });
    expect(taxesRes.ok(), await taxesRes.text()).toBeTruthy();
    const taxHeads = (await taxesRes.json()) as LiveTaxHead[];
    const withholdingHead = taxHeads.find((h) => h.tax_name === taxName);
    expect(withholdingHead, 'the new withholding tax head must actually have saved').toBeTruthy();
    expect(withholdingHead!.withholding_directions?.some((d) => d.direction === 'ON_PAYMENTS_MADE')).toBe(true);

    // ------------------------------------------------------------- 2. VENDOR
    const vendorName = `${PREFIX} Vendor ${RUN_ID}`;
    await page.goto('/vendors/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Vendor', { timeout: 20_000 });
    await page.getByLabel('Vendor Name', { exact: true }).fill(vendorName);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/vendors\/[^/]+$/, { timeout: 20_000 });
    const vendorId = page.url().split('/vendors/')[1].split('?')[0];
    await waitForQuiet(problems);

    const vendorRes = await request.get(`${API}/vendors/${vendorId}`, { headers: authHeaders(admin) });
    expect(vendorRes.ok(), await vendorRes.text()).toBeTruthy();
    expect((await vendorRes.json()).vendor_name).toBe(vendorName);

    // ------------------------------------------------------- 3. PURCHASE BILL
    const SUBTOTAL = 100000;
    const billNumber = `BILL-${RUN_ID}`;
    await page.goto('/purchase-bills/new', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Add Purchase Bill', { timeout: 20_000 });
    await docField(page.locator('body'), 'Vendor', ).selectOption({ label: vendorName });
    await docField(page.locator('body'), "Vendor's Bill Number").fill(billNumber);
    await docField(page.locator('body'), 'Withholding Tax').selectOption({ label: taxName });
    await page.getByRole('button', { name: 'Add Line Item', exact: true }).click();
    const billLineRow = page.locator('table.lineitems tbody tr').first();
    await billLineRow.locator('input[type=text]').first().fill(`${PREFIX} Server Hardware`);
    const billQtyRate = billLineRow.locator('input[type=number]');
    await billQtyRate.nth(0).fill('1');
    await billQtyRate.nth(1).fill(String(SUBTOTAL));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(/\/purchase-bills\/[^/]+$/, { timeout: 20_000 });
    const billId = page.url().split('/purchase-bills/')[1].split('?')[0];
    await waitForQuiet(problems);

    const EXPECTED_WITHHOLDING = round2((SUBTOTAL * RATE_PCT) / 100);
    const EXPECTED_PAYABLE = round2(SUBTOTAL - EXPECTED_WITHHOLDING);
    const billAfterCreate = await (await request.get(`${API}/purchase-bills/${billId}`, { headers: authHeaders(admin) })).json();
    expect(Number(billAfterCreate.subtotal)).toBe(SUBTOTAL);
    expect(Number(billAfterCreate.total_amount), 'no purchase tax head chosen — Total equals Subtotal').toBe(SUBTOTAL);
    expect(Number(billAfterCreate.withholding_amount), '10% of the 100,000 subtotal').toBeCloseTo(EXPECTED_WITHHOLDING, 2);
    expect(Number(billAfterCreate.amount_payable_to_vendor), 'Total minus withholding — DEDUCTED, never added').toBeCloseTo(EXPECTED_PAYABLE, 2);
    expect(Number(billAfterCreate.balance_due)).toBeCloseTo(EXPECTED_PAYABLE, 2);
    expect(billAfterCreate.status).toBe('UNPAID');

    const summaryTiles = page.locator('.rec-summary .s');
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Withholding' }).locator('.v').innerText())).toBeCloseTo(EXPECTED_WITHHOLDING, 2);
    expect(moneyToNumber(await summaryTiles.filter({ hasText: 'Payable' }).locator('.v').innerText())).toBeCloseTo(EXPECTED_PAYABLE, 2);

    // --------------------------------------------------------------- 4. PAYMENT
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/purchase-bills\/[^/]+\/record-payment$/, { timeout: 20_000 });
    await docField(page.locator('body'), 'Amount', ).fill(String(EXPECTED_PAYABLE));
    await docField(page.locator('body'), 'Mode', ).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Record Payment', exact: true }).click();
    await page.waitForURL(/\/purchase-bills\/[^/]+$/, { timeout: 20_000 });
    await expect(page.locator('.badge-s', { hasText: 'Paid' })).toBeVisible({ timeout: 20_000 });
    await waitForQuiet(problems);

    const billPaid = await (await request.get(`${API}/purchase-bills/${billId}`, { headers: authHeaders(admin) })).json();
    expect(billPaid.status).toBe('PAID');
    expect(Number(billPaid.amount_paid)).toBeCloseTo(EXPECTED_PAYABLE, 2);
    expect(Number(billPaid.balance_due)).toBe(0);
    // The vendor is paid LESS than the bill total by exactly the withholding
    // — the sign that proves this is a deduction, not an addition.
    expect(Number(billPaid.amount_paid) + Number(billPaid.withholding_amount)).toBeCloseTo(SUBTOTAL, 2);

    // ---------------------------------------------------- 5. COMPLIANCE REGISTER
    await page.goto('/compliance/obligations', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title')).toContainText('Obligations', { timeout: 20_000 });
    await page.locator('input[type=search]').first().fill(taxName);
    await waitForQuiet(problems);

    const obligationRow = page.locator('tbody tr', { hasText: taxName });
    await expect(obligationRow, 'the withheld amount from this Purchase Bill must show up in its own tax head\'s obligation period').toHaveCount(1, { timeout: 20_000 });
    const obligationCells = obligationRow.locator('td');
    // Columns per compliance.obligations.list.config.ts: Tax Head(0) Source(1)
    // Remitted To(2) Period(3) Period From(4) Period To(5) Documents(6)
    // Withheld(7) Remitted(8) Outstanding(9) Due Date(10) Status(11) Authority Ref(12).
    expect(Number(await obligationCells.nth(6).innerText())).toBe(1);
    expect(moneyToNumber(await obligationCells.nth(7).innerText()), 'Withheld must equal exactly 10% of the 100,000 bill subtotal').toBeCloseTo(EXPECTED_WITHHOLDING, 2);
    expect(moneyToNumber(await obligationCells.nth(8).innerText()), 'nothing has been remitted to the authority yet').toBe(0);
    expect(moneyToNumber(await obligationCells.nth(9).innerText())).toBeCloseTo(EXPECTED_WITHHOLDING, 2);

    // Cross-checked directly against the derived register's own API too.
    const obligationsApiRes = await request.get(`${API}/compliance/obligations`, { headers: authHeaders(admin) });
    expect(obligationsApiRes.ok(), await obligationsApiRes.text()).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obligationsApi = (await obligationsApiRes.json()) as any[];
    const apiRow = obligationsApi.find((r) => r.tax_head_id === withholdingHead!.id);
    expect(apiRow, 'the same period must be findable straight off the API the screen itself reads').toBeTruthy();
    expect(Number(apiRow.withheld)).toBeCloseTo(EXPECTED_WITHHOLDING, 2);
    expect(Number(apiRow.remitted)).toBe(0);
    expect(Number(apiRow.outstanding)).toBeCloseTo(EXPECTED_WITHHOLDING, 2);

    await settleProblems(problems);
    expect(summarise(problems), summarise(problems)).toBe('');
  });
});
