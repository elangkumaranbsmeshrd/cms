import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { test, login, authenticate, ROLES, type Role } from '../fixtures/auth';
import {
  watchForProblems,
  summarise,
  findForbiddenText,
  findPlaceholder,
  waitForQuiet,
  settleProblems,
} from '../fixtures/console-guard';

/**
 * Per-module, per-role visual audit.
 *
 * The smoke suite already answers "does every screen load for every role" as a
 * pass/fail. This answers a different question, and the one a module sign-off
 * actually needs: what does each screen LOOK like to each role, and what is
 * wrong with it that a load check cannot see — an empty table where data should
 * be, a control that renders unstyled, a section the spec requires that simply
 * is not there.
 *
 * So it captures a full-page screenshot per screen per role and writes a JSON
 * inventory alongside, then leaves the judgement to a reader. It deliberately
 * does NOT fail on findings: its job is evidence, not a verdict. A red build
 * here would just mean "this module is not finished yet", which is the premise,
 * not news.
 *
 * Scope it with MODULE, which matches the screen-id prefix:
 *   MODULE=masters npx playwright test tests/module-audit
 * Omit it to sweep everything.
 *
 * Output lands under test-results/module-audit/<module>/<ROLE>/<screen>.png,
 * with findings.json per module.
 */
function loadScreenRoutes(): Record<string, string> {
  const file = join(__dirname, '..', '..', 'frontend', 'src', 'app', 'layout', 'nav-registry.ts');
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
const MODULE = (process.env.MODULE ?? '').trim();

const OUT_ROOT = join(__dirname, '..', '..', 'test-results', 'module-audit');

interface ScreenFinding {
  screenId: string;
  route: string;
  role: string;
  shot: string;
  issues: string[];
  /** What the page actually offered, so a reader can compare against the spec
   * without opening every screenshot. */
  rendered: {
    heading: string | null;
    tabs: string[];
    buttons: string[];
    filters: string[];
    columns: string[];
    rowCount: number;
    emptyText: string | null;
  };
}

/** Everything a reviewer would otherwise have to squint at a screenshot for.
 * Read from the live DOM so it reflects what the role actually sees, including
 * anything RBAC removed. */
async function describeScreen(page: Page): Promise<ScreenFinding['rendered']> {
  return page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const many = (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .map((el) => text(el))
        .filter((s) => s.length > 0 && s.length < 80);

    const table = document.querySelector('table');
    return {
      heading: text(document.querySelector('.page-title, .rec-name, h1')) || null,
      tabs: many('.tab'),
      buttons: Array.from(document.querySelectorAll('button, .btn'))
        .map((el) => text(el) || el.getAttribute('aria-label') || '')
        .filter((s) => s.length > 0 && s.length < 60),
      filters: Array.from(document.querySelectorAll('.fselect, .fsearch, .filter-row select, .filter-row input'))
        .map((el) => el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '')
        .filter(Boolean),
      columns: table ? many('table thead th') : [],
      rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
      emptyText: text(document.querySelector('.empty')) || null,
    };
  });
}

/** Elements carrying a class no loaded stylesheet defines — the "missing files"
 * failure mode, which renders as unstyled content and is invisible to a load
 * check. Compares each element's own classes against every rule in the
 * document's stylesheets. */
async function findUnstyled(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const defined = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = (sheet as CSSStyleSheet).cssRules;
      } catch {
        continue; // cross-origin sheet — not ours
      }
      for (const rule of Array.from(rules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        if (!selector) continue;
        for (const m of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) defined.add(m[1]);
      }
    }
    const orphans = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('[class]'))) {
      for (const cls of Array.from(el.classList)) {
        // Angular's own state classes are never authored in a stylesheet.
        if (cls.startsWith('ng-') || cls.startsWith('cdk-')) continue;
        if (!defined.has(cls)) orphans.add(cls);
      }
    }
    return Array.from(orphans).sort();
  });
}

const modulesOf = (ids: string[]) => Array.from(new Set(ids.map((id) => id.split('.')[0]))).sort();

test.describe('module audit: every screen, every role, with evidence', () => {
  for (const role of ROLES as readonly Role[]) {
    test(`${role}`, async ({ page, request }, testInfo) => {
      testInfo.setTimeout(30 * 60 * 1000);

      const session = await login(request, role);
      await authenticate(page, session);

      const visible = Object.entries(SCREEN_ROUTES).filter(([screenId]) => {
        if (MODULE && !screenId.startsWith(`${MODULE}.`)) return false;
        const policy = session.screens[screenId];
        return policy && policy.mode !== 'none';
      });

      const findings: ScreenFinding[] = [];

      for (const [screenId, route] of visible) {
        const problems = watchForProblems(page);
        const issues: string[] = [];

        try {
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await page
            .locator('.page-title, .rec-head, .rec-name, .empty, h1')
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 })
            .catch(() => issues.push('nothing rendered within 20s (indefinite spinner or blank page)'));

          await waitForQuiet(problems);
          await settleProblems(problems);

          const body = (await page.locator('body').innerText().catch(() => '')) || '';
          const placeholder = findPlaceholder(body);
          if (placeholder) issues.push(`placeholder/error surface: "${placeholder}"`);
          const forbidden = findForbiddenText(body);
          if (forbidden.length) issues.push(`rendered forbidden text: ${forbidden.join(', ')}`);

          const unstyled = await findUnstyled(page);
          if (unstyled.length) issues.push(`classes no stylesheet defines: ${unstyled.join(', ')}`);

          const rendered = await describeScreen(page);

          const moduleName = screenId.split('.')[0];
          const dir = join(OUT_ROOT, moduleName, role);
          mkdirSync(dir, { recursive: true });
          const shot = join(dir, `${screenId}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => issues.push('screenshot failed'));

          issues.push(...summarise(problems));
          findings.push({ screenId, route, role, shot, issues, rendered });
        } catch (err) {
          issues.push(`threw: ${(err as Error).message}`);
          findings.push({
            screenId,
            route,
            role,
            shot: '',
            issues,
            rendered: { heading: null, tabs: [], buttons: [], filters: [], columns: [], rowCount: 0, emptyText: null },
          });
        }
      }

      // One findings file per module per role, so a module's evidence can be
      // read on its own without unpacking a whole-app blob.
      for (const moduleName of modulesOf(findings.map((f) => f.screenId))) {
        const dir = join(OUT_ROOT, moduleName);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, `findings-${role}.json`),
          JSON.stringify(findings.filter((f) => f.screenId.startsWith(`${moduleName}.`)), null, 2),
          'utf8',
        );
      }

      const withIssues = findings.filter((f) => f.issues.length);
      testInfo.attach(`${role}-summary`, {
        body: JSON.stringify({ role, screens: findings.length, screensWithIssues: withIssues.length, findings }, null, 2),
        contentType: 'application/json',
      });

      // Deliberately does not fail — see the file header. The evidence is the
      // deliverable; the verdict is the reader's.
      console.log(
        `[${role}] ${findings.length} screens captured, ${withIssues.length} with issues` +
          (withIssues.length ? `:\n  ${withIssues.map((f) => `${f.screenId}: ${f.issues.join(' | ')}`).join('\n  ')}` : ''),
      );
    });
  }
});
