import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { test, login, authenticate, ROLES, type Role } from '../fixtures/auth';
import { watchForProblems, summarise, findPlaceholder, waitForQuiet, settleProblems } from '../fixtures/console-guard';

/**
 * The half of a module the screen-level audit cannot see.
 *
 * module-screens.spec.ts walks SCREEN_ROUTES — the top-level list/tabbed route
 * per screen. A completeness critic established what that leaves out: for
 * Masters alone, 21 routes were covered and 62 were not. Every create form,
 * every edit form, every child screen (Tax Head's slab bands, Company Profile's
 * addresses, Holidays' bulk import) and every inner tab body beyond the first
 * had never been opened by anything.
 *
 * That is where the defects actually were. The view-only-role form exposure —
 * a role with 'view' getting a fully editable /new form — existed precisely
 * because nothing in the UI links to those URLs, so no screen-level sweep ever
 * requested one.
 *
 * So this walks the ROUTE TABLE instead of the nav map, and clicks every inner
 * tab on the way.
 *
 * Resolving :id — the interesting part. Rather than guessing which endpoint
 * backs which route, it opens the route's own parent list in the browser,
 * clicks the first row, and reads the id back out of the URL the app itself
 * navigated to. That uses the real linkage, so it cannot drift from it, and a
 * screen with no rows is reported as "no row to open" rather than silently
 * skipped.
 *
 * Scope with MODULE, matching the screen-id prefix:
 *   MODULE=masters npx playwright test tests/module-audit/module-subroutes.spec.ts
 *
 * Evidence lands under test-results/module-audit/<module>/subroutes/.
 * Like its sibling, it reports rather than fails — see that file's header.
 */
interface RouteEntry {
  screenId: string;
  path: string;
}

function loadRoutes(moduleFilter: string): RouteEntry[] {
  const featureRoot = join(__dirname, '..', '..', 'frontend', 'src', 'app', 'features');
  const found = new Map<string, RouteEntry>();

  for (const dir of readdirSync(featureRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let src: string;
    try {
      src = readFileSync(join(featureRoot, dir.name, `${dir.name}.routes.ts`), 'utf8');
    } catch {
      continue; // some feature dirs carry a differently-named routes file, or none
    }

    // screenRoute('<id>', '<path>', …) — the generic shape.
    for (const m of src.matchAll(/screenRoute\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      found.set(m[2], { screenId: m[1], path: m[2] });
    }
    // Bespoke component routes publish the same two values on route data.
    for (const m of src.matchAll(/screenId:\s*'([^']+)'\s*,\s*screenPath:\s*'([^']+)'/g)) {
      found.set(m[2], { screenId: m[1], path: m[2] });
    }
  }

  const all = [...found.values()];
  if (!all.length) throw new Error('parsed zero routes — the route-file shape changed');
  return moduleFilter ? all.filter((r) => r.screenId.startsWith(`${moduleFilter}.`)) : all;
}

const MODULE = (process.env.MODULE ?? '').trim();
const ROUTES = loadRoutes(MODULE);
const OUT_ROOT = join(__dirname, '..', '..', 'test-results', 'module-audit');

/** The static part of a route, i.e. everything before its first parameter.
 * 'masters/taxes/:id/edit' -> 'masters/taxes'. */
const staticPrefix = (path: string) => path.split('/:')[0];

/** Open a list route and click its first row, returning the id the app itself
 * navigated to. Uses the real row linkage rather than assuming an endpoint. */
async function resolveIdFrom(page: Page, listPath: string): Promise<string | null> {
  await page.goto(`/${listPath}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await page
    .locator('.page-title, .rec-name, .empty, h1')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => null);

  // Wait for the table itself, not just the page chrome. The heading renders
  // immediately and the rows arrive from a later fetch, so checking the row
  // count straight after the heading appears reports every populated list as
  // empty — which is exactly what a first run of this file did, on nine
  // Masters routes at once.
  const firstCell = page.locator('table tbody tr td').first();
  await firstCell.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
  if (!(await firstCell.count())) return null;

  const before = page.url();
  await firstCell.click().catch(() => null);
  await page.waitForURL((u) => u.toString() !== before, { timeout: 8_000 }).catch(() => null);

  // A uuid, or any trailing path segment the app routed to.
  const uuid = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const tail = page.url().replace(/[?#].*$/, '').split('/').filter(Boolean).pop();
  return tail && tail !== staticPrefix(listPath).split('/').pop() ? tail : null;
}

interface SubrouteFinding {
  screenId: string;
  path: string;
  url: string;
  role: string;
  issues: string[];
  heading: string | null;
  tabs: { label: string; heading: string | null; rowCount: number; issues: string[] }[];
}

test.describe('module audit: sub-routes and inner tabs', () => {
  for (const role of ROLES as readonly Role[]) {
    test(`${role}`, async ({ page, request }, testInfo) => {
      testInfo.setTimeout(45 * 60 * 1000);

      const session = await login(request, role);
      await authenticate(page, session);

      const openable = ROUTES.filter((r) => {
        const policy = session.screens[r.screenId];
        return policy && policy.mode !== 'none';
      });

      // One resolved id per static prefix, reused by every route under it.
      const idCache = new Map<string, string | null>();
      const findings: SubrouteFinding[] = [];

      for (const route of openable) {
        let url = `/${route.path}`;

        if (route.path.includes('/:')) {
          const prefix = staticPrefix(route.path);
          if (!idCache.has(prefix)) idCache.set(prefix, await resolveIdFrom(page, prefix));
          const id = idCache.get(prefix);
          if (!id) {
            findings.push({
              screenId: route.screenId,
              path: route.path,
              url: '',
              role,
              issues: ['no row to open — the parent list is empty, so this route was not reachable'],
              heading: null,
              tabs: [],
            });
            continue;
          }
          url = `/${route.path.replace(/:[A-Za-z_]+/, id)}`;
        }

        const problems = watchForProblems(page);
        const issues: string[] = [];

        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => issues.push(`goto failed: ${e.message}`));
        await page
          .locator('.page-title, .rec-head, .rec-name, .empty, h1')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 })
          .catch(() => issues.push('nothing rendered within 20s'));
        await waitForQuiet(problems);
        await settleProblems(problems);

        const heading = await page.locator('.page-title, .rec-name, h1').first().innerText().catch(() => null);
        const body = (await page.locator('body').innerText().catch(() => '')) || '';
        const placeholder = findPlaceholder(body);
        if (placeholder) issues.push(`placeholder/error surface: "${placeholder}"`);

        // Every inner tab, not just the one that opens first — the other half
        // of what the screen-level sweep never saw.
        const tabs: SubrouteFinding['tabs'] = [];
        const tabEls = page.locator('.tab');
        for (let i = 0; i < (await tabEls.count()); i++) {
          const tabIssues: string[] = [];
          const label = ((await tabEls.nth(i).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
          await tabEls.nth(i).click().catch(() => tabIssues.push('tab click failed'));
          await waitForQuiet(problems);
          await settleProblems(problems);

          const tabBody = (await page.locator('body').innerText().catch(() => '')) || '';
          const tabPlaceholder = findPlaceholder(tabBody);
          if (tabPlaceholder) tabIssues.push(`placeholder: "${tabPlaceholder}"`);

          tabs.push({
            label,
            heading: await page.locator('.page-title, .rec-name, h1').first().innerText().catch(() => null),
            rowCount: await page.locator('table tbody tr').count().catch(() => 0),
            issues: tabIssues,
          });
        }

        const moduleName = route.screenId.split('.')[0];
        const dir = join(OUT_ROOT, moduleName, 'subroutes', role);
        mkdirSync(dir, { recursive: true });
        const safe = route.path.replace(/[/:]/g, '_');
        await page.screenshot({ path: join(dir, `${safe}.png`), fullPage: true }).catch(() => null);

        issues.push(...summarise(problems));
        findings.push({ screenId: route.screenId, path: route.path, url, role, issues, heading, tabs });
      }

      for (const moduleName of Array.from(new Set(findings.map((f) => f.screenId.split('.')[0])))) {
        const dir = join(OUT_ROOT, moduleName, 'subroutes');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, `findings-${role}.json`),
          JSON.stringify(findings.filter((f) => f.screenId.startsWith(`${moduleName}.`)), null, 2),
          'utf8',
        );
      }

      const bad = findings.filter((f) => f.issues.length || f.tabs.some((t) => t.issues.length));
      const tabCount = findings.reduce((n, f) => n + f.tabs.length, 0);
      console.log(
        `[${role}] ${findings.length} routes, ${tabCount} inner tabs, ${bad.length} with issues` +
          (bad.length
            ? `:\n  ${bad
                .map((f) => `${f.path}: ${[...f.issues, ...f.tabs.flatMap((t) => t.issues.map((i) => `${t.label}: ${i}`))].join(' | ')}`)
                .join('\n  ')}`
            : ''),
      );
    });
  }
});
