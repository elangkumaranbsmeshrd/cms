import { test, expect, login, authenticate, API } from '../fixtures/auth';
import { watchForProblems, waitForQuiet, settleProblems, summarise } from '../fixtures/console-guard';

/**
 * §8 of E2E-HARDENING-PROMPT.md — "'Not hardcoded' — make it a test, not a
 * code review." Every check below drives the real browser against whatever
 * the live database ACTUALLY contains right now (read via the API first,
 * never assumed empty or assumed seeded) and asserts the rendered UI is
 * consistent with it.
 *
 * Auth follows tests/fixtures/auth.ts exactly: login() over the API +
 * authenticate() to seed sessionStorage before navigation. No storageState —
 * refresh tokens rotate on use and live in sessionStorage, so Playwright's
 * storageState (cookies + localStorage only) would restore nothing.
 */

const FORBIDDEN_TAX_NAME = /\b(GST|PF|ESI|TDS|professional tax)\b/i;

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** "₹1,18,000.00" -> 118000 — strips everything but digits/sign/decimal so a
 * rendered money string can be compared numerically regardless of currency
 * symbol or thousands grouping. */
function parseMoney(text: string): number {
  const cleaned = text.replace(/[^\d.-]/g, '');
  return cleaned ? Number(cleaned) : NaN;
}

/** Reads the `.totals .tr` block a 'document'-shape screen renders
 * (document-screen.component.ts) as {label, value} pairs, in DOM order. */
async function readTotals(page: import('@playwright/test').Page): Promise<{ label: string; value: string }[]> {
  const rows = page.locator('.totals .tr');
  const count = await rows.count();
  const out: { label: string; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    out.push({
      label: ((await row.locator('span').first().textContent()) ?? '').trim(),
      value: ((await row.locator('b').first().textContent()) ?? '').trim(),
    });
  }
  return out;
}

test.describe('§8 dynamic configuration — "nothing hardcoded" as an assertion', () => {
  test('renaming a Department in Masters propagates to screens that depend on it, and the old name is left nowhere behind', async ({
    page,
    request,
  }, testInfo) => {
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    const headers = authHeaders(session.accessToken);

    const before: { id: string; name: string; code: string | null; description: string | null }[] = await request
      .get(`${API}/masters/departments`, { headers })
      .then((r) => r.json());
    expect(before.length, 'seeded Masters data must contain at least one Department for this test to mean anything').toBeGreaterThan(0);

    const target = before[0];
    // Self-healing: if a PREVIOUS run of this same test crashed mid-way and
    // never made it to the restore below, the live name may already carry our
    // own suffix. Strip it so we still restore to the true original rather
    // than compounding suffixes forever.
    const ourSuffix = / \[E2E \d+\]$/;
    const originalName = target.name.replace(ourSuffix, '');
    const newName = `${originalName} [E2E ${Date.now()}]`;

    async function setDepartmentName(name: string): Promise<void> {
      const res = await request.put(`${API}/masters/departments/${target.id}`, {
        headers,
        data: { name, code: target.code, description: target.description },
      });
      expect(res.ok(), `PUT /masters/departments/${target.id} -> ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
    }

    let restored = false;
    try {
      await setDepartmentName(newName);

      // --- Employee Directory's own Department filter (a screen that never
      // opens Masters -> Departments itself) must reflect the rename live. ---
      const listProblems = watchForProblems(page);
      await page.goto('/employees');
      await page.locator('.page-title, .rec-head, h1').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(listProblems);
      await settleProblems(listProblems);
      expect(summarise(listProblems), 'Employee Directory must not break while a Department is being renamed underneath it').toBe('');

      const filterSelect = page.locator('select[title="Department"]');
      await expect(filterSelect, 'Employee Directory\'s Department filter must render').toBeVisible();
      // Read the REAL <option> list, not page.innerText(): a closed native
      // <select>'s non-selected options are generally excluded from
      // innerText, so a body-text scan would silently miss exactly the
      // dropdown this check exists to prove is data-driven.
      const filterOptionLabels = await filterSelect.locator('option').allTextContents();
      expect(filterOptionLabels, 'the new Department name must appear in the Employee Directory filter').toContain(newName);
      expect(filterOptionLabels, 'the OLD Department name must not linger in the Employee Directory filter').not.toContain(originalName);

      // --- Corroborate on a second dependent screen: the Employee form's own
      // Department dropdown (emp.create.form.config.ts), independently
      // fetched and independently rendered from the filter above. ---
      const formProblems = watchForProblems(page);
      await page.goto('/employees/new');
      await page.locator('.page-title, .rec-head, h1').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(formProblems);
      await settleProblems(formProblems);
      expect(summarise(formProblems), 'the Add Employee form must not break while a Department is being renamed underneath it').toBe('');

      const formDepartmentField = page.getByLabel('Department', { exact: true });
      await expect(formDepartmentField, 'the Add Employee form\'s Department field must render').toBeVisible();
      const formOptionLabels = await formDepartmentField.locator('option').allTextContents();
      expect(formOptionLabels, 'the new Department name must appear in the Add Employee form\'s Department dropdown').toContain(newName);
      expect(formOptionLabels, 'the OLD Department name must not linger in the Add Employee form\'s Department dropdown').not.toContain(
        originalName,
      );
    } finally {
      // MUST run even if an assertion above failed mid-test — other specs run
      // concurrently against this same shared database.
      try {
        await setDepartmentName(originalName);
        const after: { id: string; name: string }[] = await request.get(`${API}/masters/departments`, { headers }).then((r) => r.json());
        restored = after.find((d) => d.id === target.id)?.name === originalName;
      } catch (err) {
        testInfo.annotations.push({
          type: 'CRITICAL — SEED DATA NOT RESTORED',
          description: `Department ${target.id} may still be renamed to "${newName}" instead of "${originalName}": ${err}`,
        });
      }
    }

    expect(restored, `Department ${target.id} must be left named "${originalName}", exactly as found`).toBe(true);
  });

  test('Invoice totals stay internally consistent with whatever tax configuration currently exists', async ({ page, request }, testInfo) => {
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    const headers = authHeaders(session.accessToken);

    // Read the REAL state first (doc's own instruction) — never assume the
    // tax configuration is empty just because the central design rule wants
    // it to be a valid state.
    const taxHeads: { id: string; is_active: boolean; scope: string }[] = await request
      .get(`${API}/masters/taxes`, { headers })
      .then((r) => r.json());
    const billingHeads = taxHeads.filter((t) => t.is_active && (t.scope === 'SALES_BILLING' || t.scope === 'SALES_AND_PURCHASE'));
    testInfo.annotations.push({
      type: 'tax configuration observed',
      description: `${taxHeads.length} tax head(s) total; ${billingHeads.length} active and in a billing scope Invoice would use.`,
    });

    // --- Case 1: a brand-new, not-yet-saved Invoice. No tax head is engaged
    // by default (emptyRow's own tax_head_id: null) regardless of how many
    // heads exist in Masters, so this must show no tax line and
    // Subtotal === Grand Total. ---
    const createProblems = watchForProblems(page);
    await page.goto('/invoices/new');
    await page.locator('.page-title, .rec-head').first().waitFor({ state: 'visible', timeout: 20_000 });
    await waitForQuiet(createProblems);
    await settleProblems(createProblems);
    expect(summarise(createProblems), 'a fresh Invoice create screen must render cleanly regardless of tax configuration').toBe('');

    const createTotals = await readTotals(page);
    const createSubtotal = createTotals.find((t) => t.label === 'Subtotal');
    const createGrandTotal = createTotals.find((t) => t.label === 'Grand Total');
    expect(createSubtotal, 'a Subtotal row must always render').toBeTruthy();
    expect(createGrandTotal, 'a Grand Total row must always render').toBeTruthy();

    const createTaxRow = createTotals.find((t) => /tax/i.test(t.label) && t.label !== 'Subtotal' && t.label !== 'Grand Total');
    if (!createTaxRow) {
      expect(
        createGrandTotal!.value,
        'with no tax line shown, Subtotal must equal Grand Total exactly',
      ).toBe(createSubtotal!.value);
    } else {
      // Don't force the "empty" claim if a tax line genuinely rendered —
      // assert the OTHER half of the same rule instead: a tax line implies
      // the totals differ by that line's own amount.
      expect(createGrandTotal!.value, 'a rendered tax line must make Grand Total differ from Subtotal').not.toBe(createSubtotal!.value);
    }

    // --- Case 2: if a SAVED invoice with a tax head applied already exists,
    // open it and prove the OTHER half of the rule for real — a tax line
    // that both renders AND changes the numbers by exactly its own amount.
    // Skipped (not faked) if none exists right now — "don't force a false
    // claim" per the brief. ---
    const invoices: { id: string; tax_head_id: string | null; subtotal: string; tax_amount: string; grand_total: string }[] =
      await request.get(`${API}/invoices`, { headers }).then((r) => r.json());
    const taxedInvoice = invoices.find((i) => i.tax_head_id);

    if (!taxedInvoice) {
      testInfo.annotations.push({
        type: 'skipped sub-case',
        description: 'no saved Invoice with a tax head applied exists right now, so the "tax line present" branch could not be exercised live.',
      });
    } else {
      const recordProblems = watchForProblems(page);
      await page.goto(`/invoices/${taxedInvoice.id}`);
      await page.locator('.page-title, .rec-head').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(recordProblems);
      await settleProblems(recordProblems);
      expect(summarise(recordProblems), 'a saved Invoice with a tax head applied must still render cleanly').toBe('');

      const totals = await readTotals(page);
      const subtotal = totals.find((t) => t.label === 'Subtotal');
      const grandTotal = totals.find((t) => t.label === 'Grand Total');
      const taxRow = totals.find((t) => /tax/i.test(t.label) && t.label !== 'Subtotal' && t.label !== 'Grand Total');

      expect(taxRow, `Invoice ${taxedInvoice.id} has a tax_head_id set via the API, so a Tax line must render`).toBeTruthy();
      expect(grandTotal!.value, 'Grand Total must differ from Subtotal once a tax line is applied').not.toBe(subtotal!.value);

      const impliedTax = parseMoney(grandTotal!.value) - parseMoney(subtotal!.value);
      expect(
        Math.abs(impliedTax - parseMoney(taxRow!.value)),
        `Grand Total minus Subtotal (${impliedTax}) must equal the rendered Tax line (${taxRow!.value}), "by that amount" exactly`,
      ).toBeLessThan(1);
    }
  });

  test('a fresh Tax Head form does not name a specific tax regime', async ({ page, request }) => {
    // KNOWN, SOURCE-CONFIRMED FINDING — not a guess:
    // frontend/src/app/features/masters/screens/taxes.form.config.ts:35-42
    // hardcodes TAX_TYPE_OPTIONS with two of its six choices spelled
    // 'GST — IGST' / 'GST — CGST + SGST'. That file's OWN header comment
    // (lines 4-13) states the opposite intent explicitly: "every label...
    // describes a BEHAVIOUR rather than a tax... The system is not aware
    // that any specific tax exists." The Tax Type field is required and
    // unconditionally visible on a brand-new form, so this is not a code
    // review — it is what the field actually, always offers.
    //
    // test.fail() rather than a weakened assertion: the check below runs at
    // full strength. If this ever starts passing (the enum is renamed to
    // stop naming GST), Playwright reports an "unexpected pass" here, which
    // is exactly the prompt to delete this marker.
    test.fail(true, 'known: TAX_TYPE_OPTIONS names GST explicitly (taxes.form.config.ts:35-42)');

    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    const problems = watchForProblems(page);
    await page.goto('/masters/taxes/new');
    await page.locator('.page-title, .rec-head').first().waitFor({ state: 'visible', timeout: 20_000 });
    await waitForQuiet(problems);
    await settleProblems(problems);

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    // innerText alone under-reports: a closed native <select>'s own,
    // non-selected <option> text is generally excluded from it. Read every
    // <option> on the page directly too — the only reliable way to see what
    // a picker actually OFFERS without literally driving an OS-native
    // dropdown open with the mouse.
    const optionTexts = await page.locator('select option').allTextContents();
    const rendered = [bodyText, ...optionTexts].join('\n');

    const hit = rendered.match(FORBIDDEN_TAX_NAME);
    expect(hit, `a fresh Tax Head form must never name a specific tax regime — found: ${hit?.[0]}`).toBeNull();
  });

  for (const [label, route] of [
    ['Invoice', '/invoices/new'],
    ['Purchase Bill', '/purchase-bills/new'],
  ] as const) {
    test(`a fresh ${label} create screen's own UI text does not name a specific tax regime`, async ({ page, request }) => {
      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);
      const problems = watchForProblems(page);
      await page.goto(route);
      await page.locator('.page-title, .rec-head').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(problems);
      await settleProblems(problems);

      // Body text ONLY here — deliberately not the <option>-scan the Tax Head
      // form check above uses. This screen's Tax Head picker is populated
      // from whatever Masters -> Taxes actually contains, and an
      // organisation is free to NAME its own tax head "TDS" or "GST" if that
      // is genuinely what it is called locally. That is real configured
      // DATA, not a hardcoded UI label — the same distinction the Company
      // Profile check below draws for "Meshrd" inside an email domain. A
      // static heading/hint/placeholder naming a regime would still be
      // caught here, because those always render as real body text.
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      const hit = bodyText.match(FORBIDDEN_TAX_NAME);
      expect(hit, `the ${label} create screen's own static UI text must never name a specific tax regime — found: ${hit?.[0]}`).toBeNull();
    });
  }

  test('the app shell reflects the configured Company Profile name somewhere', async ({ page, request }) => {
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    const headers = authHeaders(session.accessToken);
    const profile: { legal_name: string } = await request.get(`${API}/masters/company-profile`, { headers }).then((r) => r.json());
    expect(profile.legal_name, 'Company Profile must have a legal_name configured for this check to mean anything').toBeTruthy();

    const screens = ['/dashboard', '/masters/departments', '/employees', '/invoices'];
    let sawCompanyName = false;
    for (const route of screens) {
      const problems = watchForProblems(page);
      await page.goto(route);
      await page.locator('.page-title, .rec-head, h1').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(problems);
      await settleProblems(problems);
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      if (bodyText.includes(profile.legal_name)) {
        sawCompanyName = true;
        break;
      }
    }

    // KNOWN, SOURCE-CONFIRMED FINDING:
    // frontend/src/app/layout/topbar.component.ts's own template (the
    // `.brand` block) and its header comment above it both say this
    // explicitly: the topbar's company name/initial are literal "Meshrd" /
    // "CMS" strings, not read from Company Profile, because no RBAC-safe
    // branding endpoint exists yet that every role can call. Kept as
    // test.fail(), not deleted: the moment that gap is closed this flips to
    // an unexpected pass, which is the reminder to remove the marker.
    test.fail(true, 'known: topbar.component.ts hardcodes the brand instead of reading Company Profile (see its own header comment)');
    expect(
      sawCompanyName,
      `Company Profile's legal_name ("${profile.legal_name}") never appeared in the app shell across ${screens.join(', ')}`,
    ).toBe(true);
  });

  test('"Meshrd" never renders as a hardcoded UI label independent of the configured company name', async ({ page, request }) => {
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);
    const headers = authHeaders(session.accessToken);
    const profile: { legal_name: string } = await request.get(`${API}/masters/company-profile`, { headers }).then((r) => r.json());

    // It is fine for "Meshrd" to appear as part of the real, configured
    // company name (this environment's own Company Profile happens to be
    // named "Meshrd Technologies Private Limited") — that is DATA. Strip
    // every occurrence of the exact configured name first, then look for a
    // leftover "Meshrd" that is NOT part of it: that can only be a separate,
    // hardcoded UI label (a heading, a fixed caption, a footer), never a
    // data value, by construction.
    const stripCompanyName = (text: string) => text.split(profile.legal_name).join('');

    const screens = ['/dashboard', '/masters/departments', '/employees', '/invoices'];
    const leaks: string[] = [];
    for (const route of screens) {
      const problems = watchForProblems(page);
      await page.goto(route);
      await page.locator('.page-title, .rec-head, h1').first().waitFor({ state: 'visible', timeout: 20_000 });
      await waitForQuiet(problems);
      await settleProblems(problems);
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      if (/Meshrd/i.test(stripCompanyName(bodyText))) leaks.push(route);
    }

    // KNOWN, SOURCE-CONFIRMED FINDING — same root cause as the test above:
    // topbar.component.ts's `.brand` block renders a literal `<b>Meshrd</b>`
    // on every authenticated screen for every role, independent of whatever
    // Company Profile actually says.
    test.fail(true, 'known: topbar.component.ts renders a literal "Meshrd" brand label on every screen (see its own header comment)');
    expect(leaks, `"Meshrd" rendered as a UI label independent of the configured company name on: ${leaks.join(', ')}`).toEqual([]);
  });

  test('the pre-login page does not hardcode the company brand independent of Company Profile', async ({ page }) => {
    // Same root cause again, called out by name in login-page.component.ts's
    // own header comment: "the brand mark ('M'), 'Meshrd', the 'Company
    // Management' tagline and the '&copy; Meshrd' footer... are literal
    // strings, not read from any dynamic source." No login()/authenticate()
    // needed — this page renders before a session exists.
    test.fail(true, 'known: login-page.component.ts hardcodes "Meshrd" — see its own header comment');

    await page.goto('/login');
    await page.locator('body').waitFor({ state: 'visible' });
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    expect(/Meshrd/i.test(bodyText), 'the pre-login page must not hardcode the "Meshrd" brand').toBe(false);
  });
});
