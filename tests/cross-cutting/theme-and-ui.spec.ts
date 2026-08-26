import { test, expect, login, authenticate, API } from '../fixtures/auth';
import { watchForProblems, waitForQuiet, settleProblems, summarise } from '../fixtures/console-guard';

/**
 * §9 of E2E-HARDENING-PROMPT.md — "Clean UI — the checks worth automating."
 *
 * Auth follows tests/fixtures/auth.ts exactly: login() over the API +
 * authenticate() to seed sessionStorage before navigation (no storageState —
 * refresh tokens rotate on use and live in sessionStorage).
 */

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Every wait-selector used across the suite so far, kept identical to
 * tests/smoke/every-screen-loads.spec.ts: whichever heading shape the screen
 * uses, or its empty state, counts as "rendered". */
const RENDERED = '.page-title, .rec-head, .empty, h1';

async function goAndSettle(
  page: import('@playwright/test').Page,
  route: string,
): Promise<ReturnType<typeof watchForProblems>> {
  const problems = watchForProblems(page);
  await page.goto(route);
  await page.locator(RENDERED).first().waitFor({ state: 'visible', timeout: 20_000 });
  await waitForQuiet(problems);
  await settleProblems(problems);
  return problems;
}

test.describe('§9 clean UI — automated checks', () => {
  test.describe('no horizontal scroll on the page body', () => {
    test('a representative sample of screens across shapes never overflows the page body at 1280/1440/1920px', async ({
      page,
      request,
    }, testInfo) => {
      testInfo.setTimeout(5 * 60 * 1000); // 8 screens x 3 viewports = 24 navigations

      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);
      const headers = authHeaders(session.accessToken);
      const employees: { id: string }[] = await request.get(`${API}/employees`, { headers }).then((r) => r.json());
      const employeeId = employees[0]?.id;
      expect(employeeId, 'need at least one real Employee to test the record-with-tabs shape').toBeTruthy();

      // One or two of each shape named in the brief: list, record-with-tabs,
      // form, dashboard.
      const screens: { shape: string; route: string }[] = [
        { shape: 'list', route: '/masters/departments' },
        { shape: 'list', route: '/employees' },
        { shape: 'record with tabs', route: `/employees/${employeeId}` },
        { shape: 'record with tabs (tabbed)', route: '/masters/company-profile' },
        { shape: 'form', route: '/masters/departments/new' },
        { shape: 'form (document)', route: '/invoices/new' },
        { shape: 'dashboard', route: '/invoices/dashboard' },
        { shape: 'dashboard (home)', route: '/dashboard' },
      ];
      const viewports = [
        { width: 1280, height: 900 },
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
      ];

      const overflowing: string[] = [];
      for (const { shape, route } of screens) {
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          const problems = watchForProblems(page);
          await page.goto(route);
          await page
            .locator(RENDERED)
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => {
              /* surfaced below via the width check failing to find a sane body anyway */
            });
          await waitForQuiet(problems);
          await settleProblems(problems);

          // The project's own convention (frontend/src/styles/components.css):
          // wide inner content (.table-wrap, .tabs, .board) is explicitly
          // given its OWN overflow-x: auto so it scrolls internally — this
          // check is deliberately about the outer PAGE BODY only, exactly the
          // brief's own suggested check.
          const { scrollWidth, innerWidth } = await page.evaluate(() => ({
            scrollWidth: document.body.scrollWidth,
            innerWidth: window.innerWidth,
          }));
          // 1px tolerance for sub-pixel layout rounding only — not to mask
          // real overflow.
          if (scrollWidth > innerWidth + 1) {
            overflowing.push(
              `${shape} (${route}) at ${viewport.width}px: document.body.scrollWidth=${scrollWidth} > window.innerWidth=${innerWidth}`,
            );
          }
        }
      }

      expect(overflowing, `${overflowing.length} screen/viewport combination(s) overflow the page body horizontally:\n${overflowing.join('\n')}`).toEqual(
        [],
      );
    });
  });

  test.describe('back and breadcrumbs', () => {
    test('the rendered trail has the right depth below a module root, and none below a true root', async ({
      page,
      request,
    }, testInfo) => {
      testInfo.setTimeout(3 * 60 * 1000);
      // Defensive only: nothing in this flow should ever touch a dirty form
      // (we navigate fresh and click immediately), but auto-accept any
      // window.confirm so a DirtyStateService false-positive can't hang the
      // test — Playwright's default is to DISMISS dialogs, which would look
      // exactly like "the breadcrumb link silently failed to navigate".
      page.on('dialog', (d) => d.accept());

      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);
      const headers = authHeaders(session.accessToken);
      const employees: { id: string }[] = await request.get(`${API}/employees`, { headers }).then((r) => r.json());
      const employeeId = employees[0]?.id;
      expect(employeeId, 'need at least one real Employee to test a record-shape nested screen').toBeTruthy();

      // Selectors straight from the real markup this renders
      // (frontend/src/app/layout/breadcrumbs.component.ts): a <nav class="crumb">
      // whose children are either a linked <a> (an ancestor) or a
      // <span class="here"> (the current, unlinked crumb) — matching the
      // trail depths breadcrumb.service.spec.ts already proves at the unit
      // level, fed real URLs here instead of that spec's stubbed router.
      const crumbs = () => page.locator('nav.crumb a, nav.crumb span.here');
      const backButton = () => page.locator('.icon-btn[aria-label="Back"]');

      // --- Control: a module-root screen has nowhere above it to go, so Back
      // must be ABSENT, and the trail is exactly [module heading, screen]. ---
      await goAndSettle(page, '/employees');
      await expect(backButton(), 'a module-root screen (/employees) must not show a Back control').toHaveCount(0);
      await expect(crumbs(), '/employees is a module root: exactly two crumbs (module, screen)').toHaveCount(2);

      // --- Below a module root: Back is visible, and the trail grows by
      // exactly one crumb per real registered ancestor screen. ---
      const nested: { route: string; expectedDepth: number; note: string }[] = [
        { route: `/employees/${employeeId}`, expectedDepth: 3, note: 'record with tabs, one level below Employee Directory' },
        { route: '/masters/departments/new', expectedDepth: 3, note: 'Add form, one level below the Department list' },
        { route: '/employees/onboarding-queue', expectedDepth: 3, note: 'a literal nested list route' },
        { route: '/masters/email-configuration/templates/new', expectedDepth: 4, note: 'two real registered ancestors deep' },
      ];

      const wrongDepth: string[] = [];
      for (const { route, expectedDepth, note } of nested) {
        await goAndSettle(page, route);
        await expect(backButton(), `${route} (${note}) is below a module root, so Back must be visible`).toBeVisible();

        const labels = await crumbs().allTextContents();
        if (labels.length !== expectedDepth) {
          wrongDepth.push(`${route} (${note}): expected ${expectedDepth} crumbs, rendered ${labels.length} -> [${labels.join(' / ')}]`);
        }

        // The final crumb is always where you already are — never a link.
        const lastTag = await crumbs().last().evaluate((el) => el.tagName);
        expect(lastTag, `${route}: the final breadcrumb must render as unlinked text, not <a>`).toBe('SPAN');
      }
      expect(wrongDepth, wrongDepth.join('\n')).toEqual([]);

      // --- Every ancestor segment navigates. ---
      await goAndSettle(page, '/masters/departments/new');
      const ancestorLink = page.locator('nav.crumb a').first();
      await expect(ancestorLink, 'Add Department must have exactly one linked ancestor crumb (the Department list)').toBeVisible();
      await ancestorLink.click();
      await expect(page).toHaveURL(/\/masters\/departments$/);

      // --- Back itself: with no in-app navigation history to fall back on
      // (a fresh page.goto is indistinguishable from a deep link or a
      // refresh), it must land on the nearest ancestor the trail knows about
      // — never a dead end. ---
      await goAndSettle(page, '/masters/departments/new');
      await backButton().click();
      await expect(page).toHaveURL(/\/masters\/departments$/);
    });
  });

  test.describe('export buttons appear exactly once per list screen', () => {
    test('the historical list-screen.component.ts duplicate (page header + filter bar) does not reproduce', async ({
      page,
      request,
    }) => {
      // The doc's own selector is getByRole('button', { name: /export pdf/i }),
      // which matches literal "Export PDF" text. Screens built on the shared
      // ListScreenComponent instead label this control just "PDF" next to a
      // download icon (frontend/src/app/shared/screens/list-screen/list-screen.component.ts,
      // whose own template comment records the historical duplicate as
      // ALREADY REMOVED: "Export lives ONLY in the filter row below... A
      // duplicate pair used to render here too; removed"). Using the doc's
      // literal regex against those screens would report "0 export buttons"
      // — a different, false finding, not "the duplicate reproduces". /pdf/i
      // matches both that shared "PDF" control and the hand-rolled "Export
      // PDF" text other screens use, so it tests the actual claim: does the
      // control that exports this list to PDF appear more than once.
      const PDF_EXPORT_BUTTON = /pdf/i;
      const screens = ['/masters/departments', '/masters/designations', '/employees', '/my-leave'];

      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);

      const violations: string[] = [];
      for (const route of screens) {
        await goAndSettle(page, route);
        const count = await page.getByRole('button', { name: PDF_EXPORT_BUTTON }).count();
        if (count !== 1) violations.push(`${route}: found ${count} PDF-export button(s), expected exactly 1`);
      }

      expect(violations, violations.join('\n')).toEqual([]);
    });

    test('My Expenses can show two differently-purposed "Export PDF" buttons at once', async ({ page, request }, testInfo) => {
      // A DIFFERENT, freshly-found instance of the same underlying problem
      // ("more than one control claiming to export this screen to PDF"), not
      // the doc's named list-screen.component.ts case. My Expenses
      // (frontend/src/app/features/expense/screens/my-expenses.component.ts)
      // hand-rolls two INDEPENDENT export pairs, both literally labelled
      // "Export PDF": one for a bank-Statement export (behind its own
      // "Export Statement" toggle), one for the Expense History list
      // (always visible). They are not shown together by default, but
      // opening the Statement panel — a single click, no special role or
      // state needed — puts both on screen simultaneously with an identical
      // label doing two different things. That is a real, user-reachable
      // ambiguity, so it is asserted at full strength rather than only
      // checked on initial load.
      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);
      await goAndSettle(page, '/my-expenses');

      const pdfButtons = page.getByRole('button', { name: /pdf/i });
      await expect(pdfButtons, 'on initial load, My Expenses must show exactly one PDF export control').toHaveCount(1);

      await page.getByRole('button', { name: /export statement/i }).click();
      await expect(page.getByRole('heading', { name: 'Export Statement' }), 'the Export Statement panel must open').toBeVisible();

      const afterCount = await pdfButtons.count();
      testInfo.annotations.push({
        type: 'finding',
        description: `After opening "Export Statement" on /my-expenses, ${afterCount} button(s) match /pdf/i — both literally "Export PDF", exporting different things.`,
      });
      expect(
        afterCount,
        'two identically-labelled "Export PDF" buttons doing different things on one screen is the same class of problem the historical duplicate was — a user cannot tell them apart.',
      ).toBe(1);
    });
  });

  test.describe('loading, empty and error states', () => {
    test('a list filtered to zero matching rows shows a real empty-state message, never a stuck spinner or a blank body', async ({
      page,
      request,
    }) => {
      const session = await login(request, 'SUPER_ADMIN');
      await authenticate(page, session);
      const problems = await goAndSettle(page, '/employees');

      // Filter to a value guaranteed to match nothing real.
      const searchBox = page.locator('.searchbox input[type="search"]');
      await expect(searchBox).toBeVisible();
      await searchBox.fill('zzz-nonexistent-e2e-probe-742');
      // Same `problems` listener, still attached: waitForQuiet here waits out
      // the NEW server round-trip this filter change triggers, exactly like
      // every-screen-loads.spec.ts does per screen.
      await waitForQuiet(problems);
      await settleProblems(problems);

      const emptyState = page.locator('.card .empty');
      await expect(emptyState, 'a zero-result filtered list must show its empty-state card, not stay blank').toBeVisible();

      const message = ((await emptyState.locator('p').first().textContent()) ?? '').trim();
      expect(message.length, 'the empty state must show real text, not a blank paragraph').toBeGreaterThan(0);
      expect(message, 'the empty state must not be a stuck "Loading" message').not.toMatch(/^Loading/i);
      expect(message, 'a filtered empty state should name the filter, not a bare generic fallback').toMatch(/no|match|found/i);

      // The list itself must be gone, not rendered-empty underneath the card.
      await expect(page.locator('.table-wrap table'), 'no table should render once the list is genuinely empty').toHaveCount(0);

      // An empty result is a normal state, not an error — filtering to zero
      // rows must not itself have produced a console/network problem.
      expect(summarise(problems), 'filtering to zero results must not cause a console/network error').toBe('');
    });
  });
});
