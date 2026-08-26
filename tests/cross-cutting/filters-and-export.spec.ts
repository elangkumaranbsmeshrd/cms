import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { APIRequestContext, Page } from '@playwright/test';

import { test, expect, login, authenticate, API } from '../fixtures/auth';
import { watchForProblems, summarise, waitForQuiet, settleProblems } from '../fixtures/console-guard';

/**
 * COMPLETE-TEST-PROMPT.md, Layer 5 "Test 3 — filters and export": "Apply
 * filter -> row count changes -> chip appears -> clear-all restores ->
 * export file contains exactly the filtered rows and its header states the
 * filters."
 *
 * Three list screens with real, already-seeded data (not fixtures this file
 * creates), each exercising a genuinely `transport: 'server'` filter — the
 * class E2E-HARDENING-PROMPT.md §6 calls out by name as the silent-failure
 * risk: "a wrong `transport` means the API ignores the param, the screen
 * shows unfiltered rows, and the chip lies":
 *
 *   - Employee Directory (employee.directory) — a plain `select` filter
 *     (Status = On Notice), exported to Excel.
 *   - Vendor Directory (vendor.directory) — an `activeInactive` filter
 *     (Status = Active), exported to PDF.
 *   - Asset Directory (asset.directory) — a `multiselect` filter
 *     (Status = In Store), exported to Excel.
 *
 * "Export follows the filter" is checked three independent ways, since the
 * two obvious shortcuts each have a real gap:
 *   1. The on-screen filtered count is cross-checked against a DIRECT API
 *      call carrying the identical query param, fetched moments apart — this
 *      is what actually proves the filter round-trips server-side rather
 *      than the chip merely claiming it does.
 *   2. The export HTTP request itself (captured off the wire, not inferred)
 *      is asserted to carry that same query param — list-screen.component.ts's
 *      own exportAs() sends the export through the SAME serverParams() the
 *      list fetch used, and this checks that wiring directly rather than
 *      trusting the source comment.
 *   3. For the two Excel scenarios, the downloaded FILE is read back with
 *      openpyxl (already installed in backend/.venv for excel_engine.py's
 *      own writer — not a new dependency; there is no xlsx-reading package in
 *      package.json to reuse instead, and none is added here) and its header
 *      block + data-row count are asserted against the ground truth. PDF
 *      content streams come back FlateDecode-compressed (confirmed by hand
 *      against a real export before writing this file) with no reader
 *      available in this repo either — for that one scenario, size/
 *      content-type/request-param is the honest limit of what this suite can
 *      check, exactly the fallback E2E-HARDENING-PROMPT.md's own Test 3
 *      guidance names.
 *
 * Driven as SUPER_ADMIN throughout — this file is about the filter/export
 * MECHANISM, not about which role may see which row; that is
 * rbac-enforcement.spec.ts's job.
 */

/**
 * Navigate to `url` and fail loudly on any console error, uncaught page
 * exception, or unexpected failed request — same gate
 * tests/smoke/every-screen-loads.spec.ts applies, and waitForQuiet for the
 * same reason: a slow response landing after this returns must not get
 * blamed on whatever runs next.
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

interface Count {
  text: string;
  total: number;
  loaded: number;
}

/** list-screen.component.ts's `.count` element: "Showing {total} of
 * {loaded}" — `total` is the filtered count regardless of pagination
 * (createListStore.ts's own `total = computed(() => filtered().length)`),
 * which is exactly the number this test needs. */
async function readCount(page: Page): Promise<Count> {
  const text = (await page.locator('.count').innerText()).trim();
  const m = text.match(/Showing (\d+) of (\d+)/);
  if (!m) throw new Error(`unexpected .count text: "${text}"`);
  return { text, total: Number(m[1]), loaded: Number(m[2]) };
}

/** Waits past the initial "0 of 0" paint before a real (server-)fetch has
 * resolved — `.pager` only renders once loading is done and at least one row
 * matched. */
async function waitForRealCount(page: Page): Promise<Count> {
  await page.locator('.pager').first().waitFor({ state: 'visible', timeout: 15_000 });
  return readCount(page);
}

/** The ground truth this whole file measures the UI against: the exact same
 * endpoint + query param the frontend itself would send, called directly. */
async function apiCount(request: APIRequestContext, token: string, endpoint: string, query?: string): Promise<number> {
  const url = `${API}${endpoint}${query ? `?${query}` : ''}`;
  const res = await request.get(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()}: ${await res.text()}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`GET ${url} did not return an array`);
  return body.length;
}

/** A plain `select`-kind or `activeInactive`-kind filter — both render as a
 * `<select [title]="f.label" [value]="opt.value">` (list-screen.component.ts),
 * a genuine DOM value (not Angular's `[ngValue]` synthetic id), so selecting
 * by the real backend value works directly. */
async function applySelectFilter(page: Page, filterLabel: string, value: string): Promise<void> {
  await page.locator(`select[title="${filterLabel}"]`).selectOption(value);
}

/** A `multiselect`-kind filter renders as a toggle button (same `title`) that
 * opens a checkbox panel; the checkbox is nested inside its own `<label>`, so
 * getByLabel resolves it directly. Re-clicking the toggle closes the panel
 * again so it can't overlap the Export buttons that come next. */
async function applyMultiselectFilter(page: Page, filterLabel: string, optionLabel: string): Promise<void> {
  const toggle = page.locator(`button[title="${filterLabel}"]`);
  await toggle.click();
  const checkbox = page.getByLabel(optionLabel);
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await toggle.click();
}

const PYTHON_EXE = path.join(__dirname, '..', '..', 'backend', '.venv', 'Scripts', 'python.exe');

const READ_XLSX_SCRIPT = [
  'import sys, json',
  'from openpyxl import load_workbook',
  'wb = load_workbook(sys.argv[1], read_only=True, data_only=True)',
  'ws = wb.active',
  'rows = [list(r) for r in ws.iter_rows(values_only=True)]',
  'print(json.dumps(rows, default=str))',
].join('\n');

/** Reads an exported .xlsx back into its raw cell grid, via the SAME
 * openpyxl already installed in backend/.venv for excel_engine.py's own
 * writer — see this file's top comment for why this beats both a hand-rolled
 * ZIP/XML reader and a bare size check. */
function readXlsxRows(filePath: string): unknown[][] {
  const out = execFileSync(PYTHON_EXE, ['-c', READ_XLSX_SCRIPT, filePath], { encoding: 'utf8' });
  return JSON.parse(out) as unknown[][];
}

interface FilterScenario {
  screenLabel: string;
  route: string;
  endpoint: string; // e.g. '/employees' — matches ListScreenConfig.endpoint exactly
  filterLabel: string;
  paramName: string;
  paramValue: string;
  chipText: string;
  applyFilter: (page: Page) => Promise<void>;
  exportFormat: 'pdf' | 'excel';
  deepVerifyExcel: boolean;
}

async function runFilterAndExportScenario(
  page: Page,
  request: APIRequestContext,
  token: string,
  outputPath: (name: string) => string,
  s: FilterScenario,
): Promise<void> {
  await openScreen(page, s.route, `${s.screenLabel} list`);

  // ---- baseline: on-screen unfiltered count should agree with the API ----
  const baseline = await waitForRealCount(page);
  const baselineApi = await apiCount(request, token, s.endpoint);
  expect(baseline.total, `${s.screenLabel}: unfiltered on-screen count should match the API`).toBe(baselineApi);

  // ---- apply filter -> row count changes -> chip appears ----
  await s.applyFilter(page);
  await expect(
    page.locator('.count'),
    `${s.screenLabel}: applying ${s.filterLabel} should change the shown count`,
  ).not.toHaveText(baseline.text, { timeout: 15_000 });
  const filtered = await readCount(page);
  const groundTruthFiltered = await apiCount(request, token, s.endpoint, `${s.paramName}=${encodeURIComponent(s.paramValue)}`);

  expect(
    filtered.total,
    `${s.screenLabel}: the on-screen filtered count must equal what the server itself returns for ` +
      `${s.paramName}=${s.paramValue} — this is exactly the silent-failure class where a wrong transport ` +
      `shows unfiltered rows while the chip lies about it`,
  ).toBe(groundTruthFiltered);
  expect(filtered.total, `${s.screenLabel}: filtering by ${s.paramName}=${s.paramValue} should narrow the list`).toBeLessThan(
    baseline.total,
  );

  await expect(
    page.locator('.chip', { hasText: s.chipText }),
    `${s.screenLabel}: a chip naming the applied filter should appear`,
  ).toBeVisible();

  // ---- clear all restores the unfiltered count ----
  await page.locator('.clear', { hasText: 'Clear all' }).click();
  await expect(page.locator('.count'), `${s.screenLabel}: Clear all should restore the unfiltered count`).toHaveText(
    baseline.text,
    { timeout: 15_000 },
  );

  // ---- re-apply, then export, and check the export follows the filter ----
  await s.applyFilter(page);
  await expect(page.locator('.count')).not.toHaveText(baseline.text, { timeout: 15_000 });

  const exportButtonName = s.exportFormat === 'pdf' ? 'PDF' : 'Excel';
  const [download, exportResponse] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((res) => res.url().includes(s.endpoint) && res.url().includes(`format=${s.exportFormat}`)),
    page.getByRole('button', { name: exportButtonName, exact: true }).click(),
  ]);

  expect(exportResponse.status(), `${s.screenLabel}: the export request should succeed`).toBe(200);
  const contentType = exportResponse.headers()['content-type'] ?? '';
  expect(contentType, `${s.screenLabel}: export content-type`).toContain(s.exportFormat === 'pdf' ? 'application/pdf' : 'spreadsheetml');
  // The mechanism-level proof that the export followed the filter, checked
  // directly on the wire rather than assumed from source: list-screen.
  // component.ts's exportAs() is supposed to send the SAME serverParams()
  // the list fetch just used.
  expect(
    exportResponse.url(),
    `${s.screenLabel}: the export request itself must carry the applied filter as a query param`,
  ).toContain(`${s.paramName}=${s.paramValue}`);

  const savePath = outputPath(`${s.screenLabel.replace(/\s+/g, '-')}.${s.exportFormat === 'pdf' ? 'pdf' : 'xlsx'}`);
  await download.saveAs(savePath);
  expect(download.suggestedFilename(), `${s.screenLabel}: exported filename`).toMatch(
    s.exportFormat === 'pdf' ? /\.pdf$/i : /\.xlsx$/i,
  );
  const size = fs.statSync(savePath).size;
  expect(size, `${s.screenLabel}: exported ${s.exportFormat} file should not be empty`).toBeGreaterThan(0);

  if (!s.deepVerifyExcel) return;

  // ---- deep check (Excel only): the file's own header states the filter,
  // and it contains EXACTLY the filtered rows — list_export.py's
  // _header_lines() writes "Filters: k=v" on row 1, "Result count: N" on row
  // 2, a blank separator on row 4, column headers on row 5, then one row per
  // record (excel_engine.py's render_excel) — verified by hand against a
  // real export of this exact endpoint before this file was written. ----
  const rows = readXlsxRows(savePath);
  expect(String(rows[0]?.[0]), `${s.screenLabel}: exported file's header must state the filter that produced it`).toBe(
    `Filters: ${s.paramName}=${s.paramValue}`,
  );
  const resultCountMatch = String(rows[1]?.[0]).match(/^Result count: (\d+)$/);
  expect(resultCountMatch, `${s.screenLabel}: exported file's second header line should read "Result count: N"`).not.toBeNull();
  expect(
    Number(resultCountMatch?.[1]),
    `${s.screenLabel}: the file's own declared result count must match the actual filtered set`,
  ).toBe(groundTruthFiltered);
  const dataRowCount = rows.length - 5; // 3 header lines + 1 blank separator + 1 column-header row
  expect(
    dataRowCount,
    `${s.screenLabel}: exported file must contain EXACTLY the filtered rows — found ${dataRowCount}, expected ${groundTruthFiltered}`,
  ).toBe(groundTruthFiltered);
}

test.describe('filters and export', () => {
  test('Employee Directory — Status filter and Excel export', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(90_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    await runFilterAndExportScenario(page, request, session.accessToken, (name) => testInfo.outputPath(name), {
      screenLabel: 'Employee Directory',
      route: '/employees',
      endpoint: '/employees',
      filterLabel: 'Status',
      paramName: 'employment_status',
      paramValue: 'ON_NOTICE',
      chipText: 'On Notice',
      applyFilter: (p) => applySelectFilter(p, 'Status', 'ON_NOTICE'),
      exportFormat: 'excel',
      deepVerifyExcel: true,
    });
  });

  test('Vendor Directory — Status filter and PDF export', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(90_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    await runFilterAndExportScenario(page, request, session.accessToken, (name) => testInfo.outputPath(name), {
      screenLabel: 'Vendor Directory',
      route: '/vendors',
      endpoint: '/vendors',
      filterLabel: 'Status',
      paramName: 'is_active',
      paramValue: 'true',
      chipText: 'Active',
      applyFilter: (p) => applySelectFilter(p, 'Status', 'true'),
      exportFormat: 'pdf',
      deepVerifyExcel: false,
    });
  });

  test('Asset Directory — Status filter (multiselect) and Excel export', async ({ page, request }, testInfo) => {
    testInfo.setTimeout(90_000);
    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    await runFilterAndExportScenario(page, request, session.accessToken, (name) => testInfo.outputPath(name), {
      screenLabel: 'Asset Directory',
      route: '/assets',
      endpoint: '/assets',
      filterLabel: 'Status',
      paramName: 'status',
      paramValue: 'IN_STORE',
      chipText: 'In Store',
      applyFilter: (p) => applyMultiselectFilter(p, 'Status', 'In Store'),
      exportFormat: 'excel',
      deepVerifyExcel: true,
    });
  });
});
