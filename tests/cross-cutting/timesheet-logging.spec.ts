import { test, expect, login, authenticate, API } from '../fixtures/auth';

/**
 * §2.8's "log hours" form.
 *
 * GET /timesheets/me and POST /timesheets both shipped; nothing ever called
 * the POST. my-timesheets.list.config.ts said so in its own comment, which
 * makes it a deferral rather than a design decision — and the result was a
 * self-service screen an employee could read and never write to. The only way
 * a row reached it was for someone to insert one directly.
 *
 * The test is written to survive any database state, because whether the
 * signed-in person is staffed on a project is environment-dependent and §2.8
 * makes that the gate: "logging hours against a project requires actually
 * being that project's Lead or a Member." Both branches are real behaviour
 * worth asserting, so both are checked rather than one being skipped.
 *
 * It cleans up after itself: the entry it logs is a Draft, and §2.8 makes a
 * Draft the owner's to discard, so the test deletes it through the same API a
 * user would. Nothing is left behind — the residue this repo has spent real
 * effort clearing is not worth reintroducing for a test's convenience.
 */
test.describe('timesheets: logging hours', () => {
  test('the Timesheets tab can log an entry, and validates before it does', async ({ page, request }) => {
    test.setTimeout(120_000);

    const session = await login(request, 'SUPER_ADMIN');
    await authenticate(page, session);

    // Reached the way a user reaches it — the tab's own create button, not a
    // direct URL. A form nobody can navigate to is not built.
    await page.goto('/my-projects-tasks');
    await page.locator('.page-title, h1').first().waitFor({ state: 'visible', timeout: 20_000 });
    // Not anchored: TabbedScreenComponent appends a count badge, so this tab
    // reads "Timesheets" when empty and "Timesheets 3" once it has rows.
    await page.locator('.tab').filter({ hasText: /Timesheets/ }).first().click();

    const logButton = page.getByRole('button', { name: 'Log Hours' });
    await expect(logButton, 'the Timesheets tab must offer a way to log hours').toBeVisible({ timeout: 20_000 });
    await logButton.click();
    await page.waitForURL(/\/my-projects-tasks\/timesheets\/new$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /log hours/i })).toBeVisible();

    // Staffed on nothing? Then the screen must SAY so. §2.8 gates logging on
    // project membership, so an empty project list is a legitimate state — but
    // an empty dropdown that silently 422s on submit is not.
    const emptyState = page.locator('.empty').filter({ hasText: /not on any project/i });
    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toContainText(/Lead or Member/i);
      return;
    }

    // Every control present and carrying a real accessible name.
    for (const name of ['Project', 'Date', 'Task', 'Hours', 'Notes', 'Save as Draft']) {
      await expect(page.getByLabel(name, { exact: true }), `${name} control`).toBeVisible({ timeout: 15_000 });
    }

    // §2.8's five non-task categories. The whole point of the 2026-07-30
    // addition: "if the only way to log time is against a task, that time
    // either goes unrecorded or gets awkwardly padded onto whatever task is
    // open, and either way the day's hours are no longer honest."
    const taskSelect = page.getByLabel('Task', { exact: true });
    const options = (await taskSelect.locator('option').allTextContents()).join('|');
    for (const category of [
      'Bench / Free Time',
      'Internal Meeting',
      'Training / Learning',
      'Admin & Overhead',
      'Other',
    ]) {
      expect(options, `non-task category "${category}" must be selectable`).toContain(category);
    }

    // The date default must be the viewer's LOCAL today, not UTC's. In any
    // timezone east of Greenwich the early-morning hours report yesterday
    // under toISOString(), and since this value is also the input's `max` it
    // would refuse the user's own current day.
    const localToday = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await expect(page.getByLabel('Date', { exact: true }), 'date defaults to local today').toHaveValue(localToday);
    await expect(page.getByLabel('Date', { exact: true })).toHaveAttribute('max', localToday);

    // Validation answers before any request goes out.
    await page.getByRole('button', { name: /^(Submit|Save Draft)$/ }).click();
    await expect(page.getByRole('alert')).toContainText(/required/i);

    // §2.8: the >12h warning is "a frontend plausibility nudge, not enforced
    // by the API" — so it must warn and must NOT block.
    await taskSelect.selectOption({ label: 'Internal Meeting' });
    await page.getByLabel('Hours', { exact: true }).fill('13');
    await expect(page.locator('.hint').filter({ hasText: /unusual/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^(Submit|Save Draft)$/ }),
      'a soft plausibility warning must not disable submit',
    ).toBeEnabled();

    // Log it for real, as a Draft so this test owns it and can take it back.
    const marker = `E2E timesheet probe ${Date.now()}`;
    await page.getByLabel('Hours', { exact: true }).fill('3.5');
    await page.getByLabel('Notes', { exact: true }).fill(marker);
    await page.getByLabel('Save as Draft', { exact: true }).click();
    await page.getByRole('button', { name: 'Save Draft' }).click();

    // Back on the tab, with the entry really on it.
    await page.waitForURL(/\/my-projects-tasks$/, { timeout: 20_000 });
    // Not anchored: TabbedScreenComponent appends a count badge, so this tab
    // reads "Timesheets" when empty and "Timesheets 3" once it has rows.
    await page.locator('.tab').filter({ hasText: /Timesheets/ }).first().click();
    await expect(
      page.locator('table tbody tr').filter({ hasText: 'Internal Meeting' }).first(),
      'the logged entry must appear on the tab it was logged from',
    ).toBeVisible({ timeout: 20_000 });

    // Confirm what was actually STORED, not just what is rendered.
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const listed = await request.get(`${API}/timesheets/me`, { headers: auth });
    expect(listed.ok()).toBeTruthy();
    const rows = (await listed.json()) as {
      id: string;
      category: string | null;
      task_id: string | null;
      hours: string;
      status: string;
      notes: string | null;
    }[];
    const mine = rows.find((r) => r.notes === marker);

    // The discard sits in a finally, not at the end of the happy path. An
    // earlier version cleaned up only on success, so the first failing run
    // left its entry behind — which is exactly the accumulation this repo has
    // spent real effort undoing. A test that can leave residue eventually will.
    try {
      expect(mine, 'the entry should be readable back from the API').toBeTruthy();
      expect(mine!.category, 'non-task time stores a category').toBe('INTERNAL_MEETING');
      expect(mine!.task_id, 'and no task — the API stores one or the other').toBeNull();
      expect(Number(mine!.hours)).toBe(3.5);
      expect(mine!.status, 'Save as Draft must hold it back from approval').toBe('DRAFT');
    } finally {
      // A Draft is the owner's to discard (§2.8), so the test takes back
      // exactly what it created, through the same API a user would.
      if (mine) {
        await request.delete(`${API}/timesheets/${mine.id}`, { headers: auth });
      }
    }
  });
});
