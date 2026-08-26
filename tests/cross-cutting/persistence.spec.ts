import type { Locator, Page } from '@playwright/test';

import { test, expect, login, authenticate } from '../fixtures/auth';
import { watchForProblems, summarise, waitForQuiet, settleProblems } from '../fixtures/console-guard';

/**
 * COMPLETE-TEST-PROMPT.md, Layer 5 "Test 2 — persistence (catches the Tax
 * Head class of bug)": "Create -> reopen -> every field still there. Edit ->
 * reopen -> change persisted, nothing else lost. Especially for screens with
 * child rows."
 *
 * This is the E2E counterpart to backend/tests/api/test_nested_round_trips.py
 * — same invariant ("an API must never take a field, answer 200, and quietly
 * drop it"), driven through the real browser instead of httpx, so it also
 * catches a bug that lives in the FORM (a field never actually wired into the
 * request body) rather than only in the API handler. That file's own doc
 * comment names the two real bugs this exact class of check has already
 * found: the Tax Head PUT silently discarding slab bands/split components/
 * relief rules, and an Invoice PUT silently discarding a changed date.
 *
 * Three screens, chosen to cover both the "every field" case and the "child
 * rows" case the prompt calls out by name, on two different shared
 * components so a bug specific to one editing pattern can't hide behind the
 * other:
 *   - Department (masters.departments) — a plain 'form' screen
 *     (form-screen.component.ts), no child rows, the baseline case.
 *   - Tax Head (masters.taxes) — the HEADLINE case named in the prompt.
 *     Slab Bands live on their own screen (tax-head-child-screen.component.ts),
 *     reached from the edit form's own "Slab Bands" button, and that
 *     component still PUTs the whole head back on save (see its own doc
 *     comment) — exactly the code path the historical bug lived in.
 *   - Purchase Bill (purchase_bill.list) — line items are a DIFFERENT shared
 *     component (document-screen.component.ts) with its OWN inline
 *     arrayFields-like table, so this exercises a second, independent
 *     implementation of "child rows must survive a PUT".
 *
 * All three driven as SUPER_ADMIN — same reasoning
 * test_nested_round_trips.py gives for doing the same: a 403 and a silently
 * dropped field both look like "the data isn't there", and Super Admin
 * removes the permission explanation entirely so a failure here can only be
 * data loss. RBAC itself is covered elsewhere (tests/cross-cutting/
 * rbac-enforcement.spec.ts, per the suite layout).
 *
 * Every created record is prefixed 'E2E-Persist-' and carries a timestamp,
 * per E2E-HARDENING-PROMPT.md §2's own data-namespacing rule — this suite
 * shares one live dev database with the rest of the app (and, per the task
 * brief, with sibling E2E specs other agents are writing concurrently), so a
 * collision on a real name would misattribute someone else's bug to this one.
 */

function uniqueLabel(tag: string): string {
  return `E2E-Persist-${tag}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Two decimal places — how a Numeric-backed money/quantity column comes back
 * from the API once it has round-tripped through the database (confirmed
 * live against a real Purchase Bill: quantity "1.00", rate "100.00"). What
 * you TYPE into the input is a plain "3"; what you read back after a save is
 * "3.00" — asserting the typed string against the reopened value would be
 * asserting against the wrong shape, not proving persistence. */
function decimal2(n: number): string {
  return n.toFixed(2);
}

/**
 * Navigate to `url` and fail loudly on any console error, uncaught page
 * exception, or unexpected failed request — the same zero-tolerance gate
 * tests/smoke/every-screen-loads.spec.ts applies, and waitForQuiet for the
 * identical reason that file uses it: a slow response that lands after this
 * function returns would otherwise be blamed on whatever this test does
 * next, not on the screen that actually issued it.
 */
async function openScreen(page: Page, url: string, label: string): Promise<void> {
  const problems = watchForProblems(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page
    .locator('.page-title, .rec-head, .empty, h1')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => undefined);
  await waitForQuiet(problems);
  await settleProblems(problems);
  const gate = summarise(problems);
  expect(gate, `${label} — unexpected page problem(s):\n${gate}`).toBe('');
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
}

/** Click Save and wait for the app to navigate where a successful save
 * should take it. On failure, surfaces whatever `.form-error` the screen
 * itself is showing instead of a bare Playwright timeout — the difference
 * between "the app rejected this" and "this test's assumptions are stale". */
async function saveAndWaitForUrl(page: Page, urlPattern: string | RegExp, timeout = 20_000): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
  try {
    await page.waitForURL(urlPattern, { timeout });
  } catch (err) {
    const formError = await page.locator('.form-error').first().textContent().catch(() => null);
    throw new Error(
      `Save did not navigate to ${String(urlPattern)}. On-screen error: ${formError ?? '(none shown)'}. ${(err as Error).message}`,
    );
  }
}

interface SlabBand {
  seq: string;
  from: string;
  to: string;
  rate: string;
  label: string;
}

/** tax-head-child-screen.component.ts renders each row as five plain
 * <input>s (sequence_no, band_from, band_to, rate_or_amount, band_label) with
 * no id/name/aria-label to key off — position is the only stable handle. */
async function fillSlabRow(row: Locator, band: SlabBand): Promise<void> {
  const inputs = row.locator('input');
  await inputs.nth(0).fill(band.seq);
  await inputs.nth(1).fill(band.from);
  await inputs.nth(2).fill(band.to);
  await inputs.nth(3).fill(band.rate);
  await inputs.nth(4).fill(band.label);
}

async function assertSlabRow(row: Locator, band: SlabBand, where: string): Promise<void> {
  const inputs = row.locator('input');
  await expect(inputs.nth(0), `${where}: sequence_no`).toHaveValue(band.seq);
  await expect(inputs.nth(1), `${where}: band_from`).toHaveValue(band.from);
  await expect(inputs.nth(2), `${where}: band_to`).toHaveValue(band.to);
  await expect(inputs.nth(3), `${where}: rate_or_amount`).toHaveValue(band.rate);
  await expect(inputs.nth(4), `${where}: band_label`).toHaveValue(band.label);
}

interface LineItemInput {
  description: string;
  quantity: number;
  rate: number;
}

/** document-screen.component.ts's line-items row: description (text),
 * hsn_code_id (select — left untouched/null here), quantity (number), rate
 * (number). `input` only ever matches the three text/number boxes — the
 * <select> is a different tag, so no HSN interaction is needed to keep these
 * three positional indices correct. */
async function fillLineItem(row: Locator, item: LineItemInput): Promise<void> {
  const inputs = row.locator('input');
  await inputs.nth(0).fill(item.description);
  await inputs.nth(1).fill(String(item.quantity));
  await inputs.nth(2).fill(String(item.rate));
}

async function assertLineItem(row: Locator, item: LineItemInput, where: string): Promise<void> {
  const inputs = row.locator('input');
  await expect(inputs.nth(0), `${where}: description`).toHaveValue(item.description);
  await expect(inputs.nth(1), `${where}: quantity`).toHaveValue(decimal2(item.quantity));
  await expect(inputs.nth(2), `${where}: rate`).toHaveValue(decimal2(item.rate));
}

/** document-screen.component.ts's top-level fields render as LABEL/CONTROL
 * *siblings* with no `for`/`id` linking them (unlike form-screen.component.ts,
 * which carefully wires controlId/labelId/labelTargetId) — so getByLabel()
 * cannot resolve them. Declaration order from purchase-bill.document.config.ts
 * is stable, so position is used instead: 0 vendor_id, 1 vendor_bill_number,
 * 2 bill_date, 9 notes (indices 3–8 are optional fields this test leaves
 * blank: bank_account_id, linked_expense_claim_id, withholding_tax_head_id,
 * tax_head_id, tax_amount_override, attachment_stored_file_id). */
/** document-screen renders each field as `.field > label` + the control
 * (document-screen.component.ts:153-159). Positional indexing is NOT safe here:
 * `visibleWhen` gates hide fields (a Purchase Bill with no Withholding Tax head
 * hides two of them), so a rendered index does not track the config array at
 * all. Match on the label instead — the label's own text carries the
 * required-field asterisk, so the pattern tolerates a trailing "*". */
function docField(page: Page, label: string): Locator {
  const pattern = new RegExp(`^\\s*${escapeRe(label)}\\s*\\*?\\s*$`);
  return page
    .locator('.field')
    .filter({ has: page.locator('label').filter({ hasText: pattern }) })
    .first();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('persistence — create, reopen, edit, reopen again', () => {
  test('Department — every field survives create and reopen; an edit persists without disturbing the rest', async ({
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    const name = uniqueLabel('Dept');
    const code = `E2E${Date.now() % 100_000}`;
    const description = 'Created by the persistence E2E suite — safe to ignore or delete.';

    await openScreen(page, '/masters/departments/new', 'Department create form');
    await expect(page.getByRole('heading', { name: /add department/i })).toBeVisible();

    await page.getByLabel('Department Name').fill(name);
    await page.getByLabel('Department Code').fill(code);
    await page.getByLabel('Description').fill(description);
    // is_active is left at its default (Active) — it is createOnly, so the
    // ONLY way to prove it round-tripped is to read it back after reopening.

    await saveAndWaitForUrl(page, '**/masters/departments');

    // ---- find the new row through the real UI: search, then click it ----
    await page.getByPlaceholder(/search department or code/i).fill(name);
    const row = page.locator('table tbody tr', { hasText: name });
    await expect(row, 'exactly one row should match this unique department name').toHaveCount(1);
    await row.locator('td').first().click();
    await page.waitForURL(/\/masters\/departments\/[^/]+\/edit$/);
    const editUrl = page.url();

    // ---- CREATE round trip: every field still there ----
    await expect(page.getByLabel('Department Name'), 'Department Name after create').toHaveValue(name);
    await expect(page.getByLabel('Department Code'), 'Department Code after create').toHaveValue(code);
    await expect(page.getByLabel('Description'), 'Description after create').toHaveValue(description);
    await expect(
      page.locator('.field').filter({ has: page.locator('label', { hasText: 'Status' }) }).locator('.readonly-value'),
      'Status (is_active) after create',
    ).toHaveText('Active');

    // ---- EDIT: change name + description, leave code untouched ----
    const editedName = `${name}-EDITED`;
    const editedDescription = `${description} (edited)`;
    await page.getByLabel('Department Name').fill(editedName);
    await page.getByLabel('Description').fill(editedDescription);
    await saveAndWaitForUrl(page, '**/masters/departments');

    // ---- REOPEN (a fresh full navigation, not merely in-memory state) ----
    await openScreen(page, editUrl, 'Department edit form (reopen after edit)');
    await expect(page.getByLabel('Department Name'), 'Department Name after edit+reopen').toHaveValue(editedName);
    await expect(page.getByLabel('Department Code'), 'untouched Department Code after edit+reopen').toHaveValue(code);
    await expect(page.getByLabel('Description'), 'Description after edit+reopen').toHaveValue(editedDescription);
    await expect(
      page.locator('.field').filter({ has: page.locator('label', { hasText: 'Status' }) }).locator('.readonly-value'),
      'untouched Status (is_active) after edit+reopen',
    ).toHaveText('Active');
  });

  test('Tax Head — slab bands survive create, reopen, and an edit to an unrelated field (the historical child-row bug)', async ({
    page,
    request,
  }, testInfo) => {
    testInfo.setTimeout(180_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    const taxName = uniqueLabel('Tax');
    const appliesFrom = '2025-04-01';

    // ---- CREATE: the minimum fields a SLAB head needs (Scope stays at its
    // default, Sales / Billing) ----
    await openScreen(page, '/masters/taxes/new', 'Tax Head create form');
    await expect(page.getByRole('heading', { name: /add tax head/i })).toBeVisible();

    await page.getByLabel('Tax Name').fill(taxName);
    await page.getByLabel('Tax Type').selectOption({ label: 'Slab' });
    await page.getByLabel('Applies From').fill(appliesFrom);
    await page.getByLabel('Slab Application').selectOption({ label: 'Progressive' });

    await saveAndWaitForUrl(page, '**/masters/taxes');

    // ---- find it through the real UI: Billing Taxes is the default tab
    // (scope Sales/Billing) and the search box filters within it ----
    await page.getByPlaceholder(/search tax name or short code/i).fill(taxName);
    const row = page.locator('table tbody tr', { hasText: taxName });
    await expect(row, 'exactly one row should match this unique tax name').toHaveCount(1);
    await row.locator('td').first().click();
    await page.waitForURL(/\/masters\/taxes\/[^/]+\/edit$/);
    const editUrl = page.url();
    const headId = editUrl.match(/\/masters\/taxes\/([^/]+)\/edit/)?.[1];
    if (!headId) throw new Error(`could not extract a Tax Head id from ${editUrl}`);
    const slabBandsUrl = `/masters/taxes/${headId}/slab-bands`;
    const slabBandsUrlPattern = new RegExp(`/masters/taxes/${headId}/slab-bands$`);
    const editUrlPattern = new RegExp(`/masters/taxes/${headId}/edit$`);

    // ---- CREATE round trip on the scalar fields ----
    await expect(page.getByLabel('Tax Name'), 'Tax Name after create').toHaveValue(taxName);
    await expect(page.getByLabel('Applies From'), 'Applies From after create').toHaveValue(appliesFrom);

    // ---- add the child rows the historical bug lost: via the real "Slab
    // Bands" record-action button, not a direct URL hit ----
    await page.getByRole('button', { name: 'Slab Bands' }).click();
    await page.waitForURL(slabBandsUrlPattern);
    await expect(page.getByRole('heading', { name: /slab bands/i })).toBeVisible();

    const addRow = page.getByRole('button', { name: '+ Add Row' });
    await addRow.click();
    await addRow.click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);

    // Contiguous, last band open-ended — masters_taxes.py's own
    // _validate_slab_bands rule, and the exact shape
    // test_nested_round_trips.py's own _slab_bands() helper uses.
    const band1: SlabBand = { seq: '1', from: '0', to: '500000', rate: '5', label: 'Up to 5L' };
    const band2: SlabBand = { seq: '2', from: '500000', to: '', rate: '20', label: 'Above 5L' };

    await fillSlabRow(rows.nth(0), band1);
    await fillSlabRow(rows.nth(1), band2); // band_to left blank -> open-ended

    await saveAndWaitForUrl(page, editUrlPattern);

    // ---- REOPEN the slab bands screen fresh and assert both rows survived
    // exactly as entered ----
    await openScreen(page, slabBandsUrl, 'Tax Head slab bands screen (reopen after create)');
    await assertSlabRow(rows.nth(0), band1, 'slab band 1 after create+reopen');
    await assertSlabRow(rows.nth(1), band2, 'slab band 2 after create+reopen');

    // ---- EDIT an UNRELATED scalar field only — the precise shape of the
    // historical bug: a label-only edit must not cost the head its
    // arithmetic children as a side effect of a delete-and-reinsert ----
    await openScreen(page, editUrl, 'Tax Head edit form (before unrelated edit)');
    const editedName = `${taxName}-EDITED`;
    await page.getByLabel('Tax Name').fill(editedName);
    // form-screen sends an edit save back to cfg.listRoute (taxes.form.config.ts:403),
    // NOT to the edit URL — unlike the Slab Bands child screen above, which does
    // return to /edit. Waiting on editUrlPattern here would match the URL we are
    // ALREADY on and resolve instantly, so the openScreen() below would abort the
    // in-flight PUT and the edit would silently never land.
    await saveAndWaitForUrl(page, '**/masters/taxes');

    // ---- REOPEN: the edit persisted, nothing else moved ----
    await openScreen(page, editUrl, 'Tax Head edit form (reopen after unrelated edit)');
    await expect(page.getByLabel('Tax Name'), 'Tax Name after unrelated edit+reopen').toHaveValue(editedName);
    await expect(page.getByLabel('Applies From'), 'untouched Applies From after unrelated edit+reopen').toHaveValue(
      appliesFrom,
    );

    // ---- REOPEN slab bands: THE finding this file exists to catch, if it
    // regresses. Both rows must be exactly as they were — an edit to
    // tax_name has nothing to do with slab_bands. ----
    await openScreen(page, slabBandsUrl, 'Tax Head slab bands screen (reopen after unrelated edit)');
    await assertSlabRow(rows.nth(0), band1, 'slab band 1 after UNRELATED edit — must be untouched');
    await assertSlabRow(rows.nth(1), band2, 'slab band 2 after UNRELATED edit — must be untouched');
  });

  test('Purchase Bill — line items survive create, reopen, and an edit to one line', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(120_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    const billNumber = uniqueLabel('PB');
    const billDate = '2026-08-20'; // must not be in the future (server-enforced)
    const notes = 'Created by the persistence E2E suite — safe to ignore or delete.';

    await openScreen(page, '/purchase-bills/new', 'Purchase Bill create form');
    // purchase-bill.document.config.ts:92-93 — recId is the allocated code (or the
    // "New Purchase Bill" placeholder); .rec-name is the vendor snapshot, still "—"
    // before a vendor is picked.
    await expect(page.locator('.rec-id')).toHaveText('New Purchase Bill');

    const vendorSelect = docField(page, 'Vendor').locator('select');
    // Vendor options load from VENDOR_ACTIVE_REF (/vendors?is_active=true&
    // approval_status=approved) asynchronously — wait for a real option before
    // picking one, rather than racing the ref-data fetch.
    await expect(vendorSelect.locator('option'), 'vendor options should have loaded').not.toHaveCount(1, {
      timeout: 15_000,
    });
    await vendorSelect.selectOption({ index: 1 });
    const vendorLabel = ((await vendorSelect.locator('option:checked').textContent()) ?? '').trim();
    expect(vendorLabel, 'a real vendor should have been selected').not.toBe('');

    await docField(page, "Vendor's Bill Number").locator('input').fill(billNumber);
    await docField(page, 'Bill Date').locator('input').fill(billDate);
    await docField(page, 'Notes').locator('textarea').fill(notes);

    await page.getByRole('button', { name: 'Add Line Item' }).click();
    await page.getByRole('button', { name: 'Add Line Item' }).click();
    const lineRows = page.locator('table.lineitems tbody tr');
    await expect(lineRows).toHaveCount(2);

    const line1: LineItemInput = { description: 'Widget A', quantity: 3, rate: 100 };
    const line2: LineItemInput = { description: 'Widget B', quantity: 2, rate: 250 };
    await fillLineItem(lineRows.nth(0), line1);
    await fillLineItem(lineRows.nth(1), line2);

    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/purchase-bills\/[0-9a-f-]{36}$/i);
    const billUrl = page.url();

    // ---- CREATE round trip: the header now shows the real allocated code,
    // and both lines survived exactly (money fields normalise to 2dp on
    // round trip — see decimal2()'s own comment) ----
    await expect(page.locator('.rec-id')).not.toHaveText('New Purchase Bill');
    await assertLineItem(lineRows.nth(0), line1, 'line 1 after create');
    await assertLineItem(lineRows.nth(1), line2, 'line 2 after create');

    // ---- REOPEN (a fresh full navigation) ----
    await openScreen(page, billUrl, 'Purchase Bill (reopen after create)');
    // vendor_id is createOnly -> plain read-only text once editing an
    // existing bill, not a <select> any more.
    await expect(docField(page, 'Vendor').locator('.readonly-value'), 'Vendor after create+reopen').toHaveText(vendorLabel);
    await expect(docField(page, "Vendor's Bill Number").locator('input'), "Vendor's Bill Number after create+reopen").toHaveValue(billNumber);
    await expect(docField(page, 'Bill Date').locator('input'), 'Bill Date after create+reopen').toHaveValue(billDate);
    await expect(docField(page, 'Notes').locator('textarea'), 'Notes after create+reopen').toHaveValue(notes);
    await assertLineItem(lineRows.nth(0), line1, 'line 1 after create+reopen');
    await assertLineItem(lineRows.nth(1), line2, 'line 2 after create+reopen');

    // ---- EDIT: change the bill number and ONE line's rate only ----
    const editedBillNumber = `${billNumber}-EDITED`;
    await docField(page, "Vendor's Bill Number").locator('input').fill(editedBillNumber);
    const editedLine1: LineItemInput = { ...line1, rate: 150 };
    await fillLineItem(lineRows.nth(0), editedLine1);

    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(billUrl);

    // ---- REOPEN: the edit persisted, and the UNTOUCHED field/line were not
    // disturbed by it ----
    await openScreen(page, billUrl, 'Purchase Bill (reopen after edit)');
    await expect(docField(page, "Vendor's Bill Number").locator('input'), "Vendor's Bill Number after edit+reopen").toHaveValue(
      editedBillNumber,
    );
    await expect(docField(page, 'Bill Date').locator('input'), 'untouched Bill Date after edit+reopen').toHaveValue(billDate);
    await assertLineItem(lineRows.nth(0), editedLine1, 'edited line 1 after edit+reopen');
    await assertLineItem(lineRows.nth(1), line2, 'untouched line 2 after edit+reopen — must be exactly as created');
  });
});
