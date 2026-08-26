import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ImpactValue, Result as AxeViolation } from 'axe-core';

import { test, expect, login, authenticate, type Role } from '../fixtures/auth';
import { watchForProblems, waitForQuiet } from '../fixtures/console-guard';

/**
 * Cross-cutting accessibility sweep (build-docs/COMPLETE-TEST-PROMPT.md,
 * cross-cutting section):
 *
 *   "Accessibility: add @axe-core/playwright; assert zero critical/serious
 *   violations on every screen. Keyboard-only navigation reaches every
 *   interactive control; visible focus everywhere."
 *
 * Two independent checks, because they catch different bug classes and
 * neither can substitute for the other:
 *
 *   PART 1 — axe-core against every screen SUPER_ADMIN can open (up to 69
 *   routes, the same universe tests/smoke/every-screen-loads.spec.ts walks).
 *   Automated, thorough, but structurally CANNOT verify actual keyboard
 *   operability or that a focus style really paints — axe's own docs say
 *   so (WCAG 2.1.1 / 2.4.7 are flagged "cannot tell" by automated tools).
 *
 *   PART 2 — a manual keyboard Tab-walk + computed-style focus check on a
 *   handful of representative screens. Catches exactly what axe cannot: a
 *   control that LOOKS interactive but is unreachable by keyboard, or is
 *   reachable but paints no visible focus ring.
 *
 * Route map is PARSED from nav-registry.ts source, not imported — same
 * reasoning and the same regex as every-screen-loads.spec.ts's own
 * loadScreenRoutes() (nav-registry.ts imports IconName from an Angular
 * component, so importing the map directly would drag Angular into the test
 * runtime for one string map). That helper isn't exported, so it is
 * reproduced verbatim here rather than re-derived by hand.
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

// Where the machine-readable inventory lands, matching the smoke test's own
// test-results/smoke-<role>.json convention.
const inventoryDir = join(__dirname, '..', '..', 'test-results');
mkdirSync(inventoryDir, { recursive: true });

const ROLE_UNDER_TEST: Role = 'SUPER_ADMIN';

/** The doc's own bar: "zero critical/serious". Moderate/minor are recorded, never fail the build. */
const FAILING_IMPACT = new Set<ImpactValue>(['critical', 'serious']);

interface ViolationRecord {
  id: string;
  impact: ImpactValue | null;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  nodeCount: number;
  sampleTargets: string[];
}

function toViolationRecord(v: AxeViolation): ViolationRecord {
  return {
    id: v.id,
    impact: v.impact ?? null,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
    nodeCount: v.nodes.length,
    // JSON.stringify rather than .join(): a target can itself be a nested
    // array (a shadow-DOM/frame selector segment), which .join() would
    // stringify unhelpfully. This is for human triage only.
    sampleTargets: v.nodes.slice(0, 3).map((n) => JSON.stringify(n.target)),
  };
}

/**
 * Navigate and let the screen settle before it is judged — same wait as
 * every-screen-loads.spec.ts (a content marker, since this app's dev-server
 * HMR socket means networkidle never resolves), then waitForQuiet so a
 * still-in-flight request's DOM mutation doesn't land mid-scan.
 */
async function gotoAndSettle(page: Page, route: string): Promise<{ rendered: boolean }> {
  const problems = watchForProblems(page);
  let rendered = true;
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page
    .locator('.page-title, .rec-head, .empty, h1')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {
      rendered = false;
    });
  await waitForQuiet(problems);
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  return { rendered };
}

// ============================================================================
// PART 1 — axe-core sweep, every screen SUPER_ADMIN can open
// ============================================================================

test.describe('accessibility: axe-core sweep', () => {
  test(`${ROLE_UNDER_TEST}: zero critical/serious violations across every reachable screen`, async (
    { page, request },
    testInfo,
  ) => {
    // Up to 69 routes, each getting a full navigation + settle + axe scan.
    testInfo.setTimeout(30 * 60 * 1000);

    const session = await login(request, ROLE_UNDER_TEST);
    await authenticate(page, session);

    const visible = Object.entries(SCREEN_ROUTES).filter(([screenId]) => {
      const policy = session.screens[screenId];
      return policy && policy.mode !== 'none';
    });

    const failures: string[] = [];
    const renderIssues: string[] = [];
    const perScreen: {
      screenId: string;
      route: string;
      rendered: boolean;
      counts: Record<string, number>;
      violations: ViolationRecord[];
    }[] = [];
    const totals: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
    let checked = 0;

    for (const [screenId, route] of visible) {
      const { rendered } = await gotoAndSettle(page, route);
      if (!rendered) {
        // Still scan whatever DOM exists — but flag it, so a suspiciously
        // clean 0-violation entry for a screen that never actually painted
        // doesn't get read as "this screen is accessible".
        renderIssues.push(`${screenId} (${route}): nothing rendered within 20s before the axe scan ran`);
      }

      const results = await new AxeBuilder({ page }).analyze();
      const records = results.violations.map(toViolationRecord);

      const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
      for (const r of records) {
        const key = r.impact ?? 'unknown';
        counts[key] = (counts[key] ?? 0) + 1;
        totals[key] = (totals[key] ?? 0) + 1;
      }

      checked++;
      perScreen.push({ screenId, route, rendered, counts, violations: records });

      for (const r of records) {
        if (r.impact && FAILING_IMPACT.has(r.impact)) {
          failures.push(
            `\n  ${screenId}  (${route})\n` +
              `    [${r.impact}] ${r.id} — ${r.help}\n` +
              `    WCAG: ${r.wcag.join(', ') || 'n/a'}\n` +
              `    ${r.nodeCount} node(s) affected, e.g. ${r.sampleTargets[0] ?? 'n/a'}`,
          );
        }
      }
    }

    const summary = {
      role: ROLE_UNDER_TEST,
      screensScanned: checked,
      totalsByImpact: totals,
      criticalOrSeriousCount: failures.length,
      renderIssues,
      screens: perScreen,
    };
    writeFileSync(
      join(inventoryDir, `accessibility-${ROLE_UNDER_TEST}.json`),
      JSON.stringify(summary, null, 2),
      'utf8',
    );

    await testInfo.attach('accessibility-summary.json', {
      body: JSON.stringify(summary, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('accessibility-summary.txt', {
      body:
        `${ROLE_UNDER_TEST}: ${checked} screens scanned\n` +
        `totals by impact: ${JSON.stringify(totals)}\n` +
        `critical/serious (fails the build): ${failures.length}\n` +
        `moderate/minor (recorded, does not fail): ${totals.moderate + totals.minor}\n` +
        (renderIssues.length ? `render issues:\n${renderIssues.join('\n')}\n` : '') +
        failures.join(''),
      contentType: 'text/plain',
    });

    expect(
      failures,
      `${failures.length} critical/serious axe violation(s) across ${checked} screens:${failures.join('')}`,
    ).toEqual([]);
  });
});

// ============================================================================
// PART 2 — keyboard-only navigation + visible focus, representative screens
// ============================================================================
//
// Not all 69 screens: this is a per-key-press Tab walk plus computed-style
// reads, inherently slower and more manual than the axe pass. One of each
// shape the doc calls out — a list, a record with tabs, a form, and the
// persistent topbar/sidebar chrome that every authenticated screen shares.

const KEYBOARD_NAV_SCREENS: { label: string; route: string }[] = [
  { label: 'Employee Directory (list)', route: '/employees' },
  { label: 'Masters → Work Week & Hours (record with tabs)', route: '/masters/work-week-hours' },
  { label: 'Masters → Company Profile (form)', route: '/masters/company-profile' },
  { label: 'Dashboard (topbar + sidebar chrome)', route: '/dashboard' },
];

interface StyleSnapshot {
  outline: string;
  outlineOffset: string;
  boxShadow: string;
  border: string;
  backgroundColor: string;
}

interface CandidateInfo {
  probeId: string;
  tag: string;
  role: string;
  type: string;
  name: string;
  baseline: StyleSnapshot;
}

interface PrepResult {
  candidates: CandidateInfo[];
  primaryButtonId: string | null;
  textInputId: string | null;
}

/**
 * Tag every visible, enabled, natively-or-ARIA interactive element with a
 * throwaway data attribute so it can be re-identified after each Tab press,
 * and record its UNFOCUSED computed style as a baseline for the
 * visible-focus check. Runs once per screen, right after it settles.
 *
 * "Interactive" = the doc's own list (buttons, inputs, links) plus the ARIA
 * roles and explicit tabindex that stand in for them in this app's shared
 * screen framework (e.g. tabbed-screen.component.ts's tabs are
 * `role="button"` divs, not real <button> elements).
 *
 * tabindex="-1" is deliberately excluded from "expected reachable": that is
 * the standard marker for "focusable via script, intentionally NOT in the
 * Tab sequence" (roving-tabindex widgets), so including it would produce
 * false positives against a correctly-built composite widget.
 */
async function prepareKeyboardAudit(page: Page): Promise<PrepResult> {
  return page.evaluate(() => {
    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (parseFloat(style.opacity || '1') === 0) return false;
      return true;
    }
    function isDisabled(el: Element): boolean {
      const anyEl = el as unknown as { disabled?: boolean };
      if (anyEl.disabled === true) return true;
      if (el.getAttribute('aria-disabled') === 'true') return true;
      if (el.getAttribute('tabindex') === '-1') return true;
      if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return true;
      return false;
    }
    function labelFor(el: Element): string {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const id = el.getAttribute('id');
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl && lbl.textContent && lbl.textContent.trim()) return lbl.textContent.trim();
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return placeholder;
      const text = (el.textContent || '').trim();
      if (text) return text.slice(0, 60);
      const title = el.getAttribute('title');
      if (title) return title;
      return '(unlabelled)';
    }
    function snapshot(el: Element): StyleSnapshotShape {
      const cs = window.getComputedStyle(el);
      return {
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
        border: `${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.borderTopColor}`,
        backgroundColor: cs.backgroundColor,
      };
    }
    interface StyleSnapshotShape {
      outline: string;
      outlineOffset: string;
      boxShadow: string;
      border: string;
      backgroundColor: string;
    }

    (document.activeElement as HTMLElement | null)?.blur();

    const selector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="menuitem"]',
      '[role="combobox"]',
      '[role="textbox"]',
      '[role="option"]',
      '[tabindex]',
    ].join(',');

    const textTypes = ['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'password'];
    const candidates: {
      probeId: string;
      tag: string;
      role: string;
      type: string;
      name: string;
      baseline: StyleSnapshotShape;
    }[] = [];
    let primaryButtonId: string | null = null;
    let textInputId: string | null = null;

    document.querySelectorAll(selector).forEach((el) => {
      if (el.hasAttribute('data-a11y-probe')) return; // matched >1 selector already handled
      if (!isVisible(el) || isDisabled(el)) return;

      const probeId = `a11y-${candidates.length}`;
      el.setAttribute('data-a11y-probe', probeId);
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const type = (el.getAttribute('type') || '').toLowerCase();
      candidates.push({ probeId, tag, role, type, name: labelFor(el), baseline: snapshot(el) });

      if (primaryButtonId === null && el.classList.contains('btn') && el.classList.contains('primary')) {
        primaryButtonId = probeId;
      }
      if (textInputId === null && (tag === 'textarea' || (tag === 'input' && textTypes.includes(type || 'text')))) {
        textInputId = probeId;
      }
    });

    if (primaryButtonId === null) {
      const firstButton = candidates.find((c) => c.tag === 'button');
      if (firstButton) primaryButtonId = firstButton.probeId;
    }

    return { candidates, primaryButtonId, textInputId };
  });
}

interface FocusRead {
  atBody: boolean;
  probeId: string | null;
  style: StyleSnapshot | null;
}

async function readFocus(page: Page, watchIds: string[]): Promise<FocusRead> {
  return page.evaluate((ids) => {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      return { atBody: true, probeId: null, style: null };
    }
    const probeId = active.getAttribute('data-a11y-probe');
    let style = null;
    if (probeId && ids.includes(probeId)) {
      const cs = window.getComputedStyle(active);
      style = {
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
        border: `${cs.borderTopStyle} ${cs.borderTopWidth} ${cs.borderTopColor}`,
        backgroundColor: cs.backgroundColor,
      };
    }
    return { atBody: false, probeId, style };
  }, watchIds);
}

function styleChanged(a: StyleSnapshot | undefined, b: StyleSnapshot | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.outline !== b.outline ||
    a.outlineOffset !== b.outlineOffset ||
    a.boxShadow !== b.boxShadow ||
    a.border !== b.border ||
    a.backgroundColor !== b.backgroundColor
  );
}

const MAX_TAB_PRESSES_FLOOR = 150;
// If focus hasn't reached anything NEW in this many consecutive presses (and
// hasn't wrapped around to body), treat it as stuck rather than spinning to
// the press ceiling — this is what actually bounds a genuine focus trap.
const STUCK_WINDOW = 15;

interface KeyboardAuditResult {
  totalControls: number;
  reachedCount: number;
  unreached: CandidateInfo[];
  stuckAfterPresses: number | null;
  primaryButton: { candidate: CandidateInfo | null; reached: boolean; visibleChange: boolean };
  textInput: { candidate: CandidateInfo | null; reached: boolean; visibleChange: boolean };
}

async function auditKeyboardNav(page: Page): Promise<KeyboardAuditResult> {
  const { candidates, primaryButtonId, textInputId } = await prepareKeyboardAudit(page);
  const watchIds = [primaryButtonId, textInputId].filter((x): x is string => x !== null);

  const maxPresses = Math.max(MAX_TAB_PRESSES_FLOOR, candidates.length * 4 + 20);
  const visited = new Set<string>();
  const focusedStyles = new Map<string, StyleSnapshot>();
  let lastProgressIndex = -1;
  let stuckAfterPresses: number | null = null;

  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press('Tab');
    const info = await readFocus(page, watchIds);
    if (info.atBody) break;

    const key = info.probeId ?? `untracked-${i}`;
    const before = visited.size;
    visited.add(key);
    if (visited.size > before) lastProgressIndex = i;
    if (info.probeId && info.style) focusedStyles.set(info.probeId, info.style);

    if (i - lastProgressIndex > STUCK_WINDOW) {
      stuckAfterPresses = i + 1;
      break;
    }
  }

  const unreached = candidates.filter((c) => !visited.has(c.probeId));

  function verdict(id: string | null): { candidate: CandidateInfo | null; reached: boolean; visibleChange: boolean } {
    const candidate = candidates.find((c) => c.probeId === id) ?? null;
    if (!candidate) return { candidate: null, reached: false, visibleChange: false };
    const reached = visited.has(candidate.probeId);
    const visibleChange = reached && styleChanged(candidate.baseline, focusedStyles.get(candidate.probeId));
    return { candidate, reached, visibleChange };
  }

  return {
    totalControls: candidates.length,
    reachedCount: visited.size,
    unreached,
    stuckAfterPresses,
    primaryButton: verdict(primaryButtonId),
    textInput: verdict(textInputId),
  };
}

function describeControl(c: CandidateInfo): string {
  const roleTxt = c.role ? `[role=${c.role}]` : '';
  const typeTxt = c.type ? `[type=${c.type}]` : '';
  return `<${c.tag}>${roleTxt}${typeTxt} "${c.name}"`;
}

test.describe('accessibility: keyboard navigation and visible focus', () => {
  for (const screen of KEYBOARD_NAV_SCREENS) {
    test(`${screen.label}: every control reachable by Tab; visible focus on primary button + text input`, async (
      { page, request },
      testInfo,
    ) => {
      testInfo.setTimeout(90_000);

      const session = await login(request, ROLE_UNDER_TEST);
      await authenticate(page, session);
      await gotoAndSettle(page, screen.route);

      const result = await auditKeyboardNav(page);

      const findings: string[] = [];

      if (result.unreached.length > 0) {
        findings.push(
          `${result.unreached.length}/${result.totalControls} visibly interactive control(s) were never reached ` +
            `by Tab (from a blurred starting point, walking until focus wrapped to <body> or stalled):\n` +
            result.unreached.map((c) => `      - ${describeControl(c)}`).join('\n'),
        );
      }
      if (result.stuckAfterPresses !== null) {
        findings.push(
          `focus stopped advancing to any new control after ${result.stuckAfterPresses} Tab presses ` +
            `(${result.reachedCount}/${result.totalControls} controls reached before it stalled) — ` +
            `looks like a keyboard trap or a cycle among a small subset of controls`,
        );
      }

      if (result.primaryButton.candidate) {
        if (!result.primaryButton.reached) {
          findings.push(
            `primary action button ${describeControl(result.primaryButton.candidate)} was never reached by ` +
              `Tab, so its focus indicator could not be checked`,
          );
        } else if (!result.primaryButton.visibleChange) {
          findings.push(
            `primary action button ${describeControl(result.primaryButton.candidate)} shows NO computed-style ` +
              `change (outline/box-shadow/border/background all identical) when focused via keyboard`,
          );
        }
      }
      if (result.textInput.candidate) {
        if (!result.textInput.reached) {
          findings.push(
            `text input ${describeControl(result.textInput.candidate)} was never reached by Tab, so its focus ` +
              `indicator could not be checked`,
          );
        } else if (!result.textInput.visibleChange) {
          findings.push(
            `text input ${describeControl(result.textInput.candidate)} shows NO computed-style change ` +
              `(outline/box-shadow/border/background all identical) when focused via keyboard`,
          );
        }
      }

      await testInfo.attach(`keyboard-audit-${screen.route.replace(/\//g, '_')}.json`, {
        body: JSON.stringify(
          {
            screen: screen.label,
            route: screen.route,
            totalControls: result.totalControls,
            reachedCount: result.reachedCount,
            unreached: result.unreached,
            stuckAfterPresses: result.stuckAfterPresses,
            primaryButton: result.primaryButton,
            textInput: result.textInput,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });

      expect(
        findings,
        `${screen.label} (${screen.route}) — ${result.reachedCount}/${result.totalControls} controls reached by keyboard:\n  - ${findings.join('\n  - ')}`,
      ).toEqual([]);
    });
  }
});
