import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, login, authenticate, ROLES } from '../fixtures/auth';
import {
  watchForProblems,
  summarise,
  findForbiddenText,
  findPlaceholder,
  waitForQuiet,
  settleProblems,
} from '../fixtures/console-guard';

/**
 * §4 of E2E-HARDENING-PROMPT.md — the highest-value test in the suite.
 *
 * For every screen in SCREEN_ROUTES, for every role that can open it, assert
 * the page actually renders, logs no console errors, issues no failed
 * requests, is not a placeholder, and renders no NaN/undefined/[object Object].
 *
 * Driven from the route map rather than a hand-written list, so a screen added
 * tomorrow is covered without touching this file.
 *
 * The map is PARSED from source rather than imported: nav-registry.ts imports
 * IconName from an Angular component, so importing it would drag Angular into
 * the test runtime for the sake of one string map.
 */
function loadScreenRoutes(): Record<string, string> {
  const file = join(
    __dirname,
    '..',
    '..',
    'frontend',
    'src',
    'app',
    'layout',
    'nav-registry.ts',
  );
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('SCREEN_ROUTES');
  if (start === -1) throw new Error('SCREEN_ROUTES not found in nav-registry.ts');
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n};', open);
  const block = src.slice(open, close);

  const routes: Record<string, string> = {};
  for (const m of block.matchAll(/'([a-z0-9_]+\.[a-z0-9_]+)'\s*:\s*'([^']+)'/g)) {
    routes[m[1]] = m[2];
  }
  if (Object.keys(routes).length === 0) throw new Error('parsed zero routes — the map shape changed');
  return routes;
}

const SCREEN_ROUTES = loadScreenRoutes();

// Where the machine-readable inventory lands, for triage and for fixing.
const inventoryDir = join(__dirname, '..', '..', 'test-results');
mkdirSync(inventoryDir, { recursive: true });

test.describe('every screen loads, for every role that can open it', () => {
  for (const role of ROLES) {
    test(`${role}`, async ({ page, request }, testInfo) => {
      // One test per role rather than per screen: a role's session is set up
      // once, and the report names the role while the failure list names every
      // broken screen at once — which is the inventory this test exists to
      // produce. Generous timeout because it walks up to 69 routes.
      testInfo.setTimeout(15 * 60 * 1000);

      const session = await login(request, role);
      await authenticate(page, session);

      const visible = Object.entries(SCREEN_ROUTES).filter(([screenId]) => {
        const policy = session.screens[screenId];
        return policy && policy.mode !== 'none';
      });

      const failures: string[] = [];
      const problems404: string[] = [];
      const perScreen: { screenId: string; route: string; issues: string[] }[] = [];
      let checked = 0;

      for (const [screenId, route] of visible) {
        const problems = watchForProblems(page);
        const issues: string[] = [];

        try {
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          // Let the screen's own data load settle. networkidle is unreliable
          // against a dev server with HMR sockets open, so wait on the app's
          // own rendered result instead.
          await page
            .locator('.page-title, .rec-head, .empty, h1')
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => issues.push('nothing rendered within 20s (indefinite spinner or blank page)'));

          // Let this screen's own requests finish before judging it. Without
          // this, a slow response lands during the NEXT screen's listener
          // window and blames an innocent screen.
          await waitForQuiet(problems);
          // Finish classifying 404 bodies before judging this screen.
          await settleProblems(problems);

          const body = (await page.locator('body').innerText().catch(() => '')) || '';

          const placeholder = findPlaceholder(body);
          if (placeholder) issues.push(`placeholder/error surface: "${placeholder}"`);

          const forbidden = findForbiddenText(body);
          if (forbidden.length) issues.push(`rendered forbidden text: ${forbidden.join(', ')}`);

          if (/loading/i.test(body) && body.trim().length < 40) {
            issues.push('still showing only a loading state');
          }
        } catch (err) {
          issues.push(`navigation threw: ${(err as Error).message}`);
        }

        await settleProblems(problems);
        const gate = summarise(problems);
        if (gate) issues.push(gate);

        // Detach listeners so the next route starts clean.
        page.removeAllListeners('console');
        page.removeAllListeners('pageerror');
        page.removeAllListeners('response');

        for (const f of problems.failedRequests) {
          const m = f.match(/^404 GET (\S+)/);
          if (m) problems404.push(m[1].replace(/\?.*$/, ''));
        }

        checked++;
        perScreen.push({ screenId, route, issues });
        if (issues.length) {
          failures.push(`\n  ${screenId}  (${route})\n    - ${issues.join('\n    - ')}`);
        }
      }

      // Emit STRUCTURED results, not just prose. Parsing Playwright's console
      // output to build the bug inventory misattributes failures across roles,
      // because all errors are printed together at the end of the run — which
      // produced a confidently wrong list once already.
      const inventory = {
        role,
        checked,
        failed: failures.length,
        endpoints404: [...new Set(problems404)].sort(),
        screens: perScreen,
      };
      writeFileSync(
        join(inventoryDir, `smoke-${role}.json`),
        JSON.stringify(inventory, null, 2),
        'utf8',
      );

      // Attach the full inventory so a CI run is as useful as a local one.
      await testInfo.attach(`${role}-screens-checked.txt`, {
        body: `${role}: ${checked} screens checked, ${failures.length} with problems\n${failures.join('\n')}`,
        contentType: 'text/plain',
      });

      expect(
        failures,
        `${role}: ${failures.length} of ${checked} screens have problems:${failures.join('')}`,
      ).toEqual([]);
    });
  }
});

test('the route map itself is sane', async () => {
  const routes = Object.entries(SCREEN_ROUTES);
  expect(routes.length).toBeGreaterThan(50);
  for (const [screenId, route] of routes) {
    expect(route, `${screenId} must be an absolute path`).toMatch(/^\//);
    expect(route, `${screenId} must not contain an unresolved :param`).not.toMatch(/:/);
  }
});
