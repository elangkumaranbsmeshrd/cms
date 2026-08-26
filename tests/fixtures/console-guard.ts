import type { Page, Response } from '@playwright/test';

/**
 * Zero-tolerance gates (§5 of E2E-HARDENING-PROMPT.md), as a collector rather
 * than as per-test asserts, so a spec can decide when to assert and can name
 * the failures it legitimately expects (an RBAC negative test asserts a 403;
 * a 500 anywhere is always a bug).
 */

export interface PageProblems {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/**
 * Noise that is not the app's fault. Every entry needs a written reason —
 * an unexplained allow-list entry is how a real error gets silently ignored.
 */
const IGNORED_CONSOLE = [
  // Angular's dev-mode hydration/CD notices are emitted by `ng serve` only and
  // do not exist in a production build.
  /Angular is running in development mode/i,
  // Chrome emits this for any favicon miss; it is not an app failure.
  /favicon\.ico/i,
];

/** Requests the browser makes that a 4xx on is not an app defect. */
const IGNORED_REQUESTS = [/favicon\.ico/i, /\.map$/i];

export function watchForProblems(page: Page): PageProblems {
  const problems: PageProblems = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    problems.consoleErrors.push(text);
  });

  // An uncaught exception is strictly worse than a console.error: it means a
  // component threw and the view is very likely half-rendered.
  page.on('pageerror', (err) => {
    problems.pageErrors.push(err.message);
  });

  page.on('response', (res: Response) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (IGNORED_REQUESTS.some((re) => re.test(url))) return;
    problems.failedRequests.push(`${status} ${res.request().method()} ${url}`);
  });

  return problems;
}

/**
 * Text that should never reach a user's screen. This one assertion catches the
 * whole class of formatting bugs — a missing null-guard, a bad date parse, an
 * object interpolated instead of a field — far more cheaply than testing each
 * field individually.
 */
export const FORBIDDEN_RENDERED_TEXT = [
  'NaN',
  'undefined',
  '[object Object]',
  'Invalid Date',
  'null,',
] as const;

export function findForbiddenText(body: string): string[] {
  const hits: string[] = [];
  for (const needle of FORBIDDEN_RENDERED_TEXT) {
    if (body.includes(needle)) hits.push(needle);
  }
  return hits;
}

/** Placeholder / failure surfaces that mean a screen is not really built. */
export const NOT_REALLY_BUILT = [
  /coming soon/i,
  /this screen failed to render/i,
  /can'?t be embedded yet/i,
  /not implemented/i,
] as const;

export function findPlaceholder(body: string): string | null {
  for (const re of NOT_REALLY_BUILT) {
    const m = body.match(re);
    if (m) return m[0];
  }
  return null;
}

export function summarise(problems: PageProblems): string {
  const parts: string[] = [];
  if (problems.pageErrors.length) parts.push(`uncaught: ${problems.pageErrors.join(' | ')}`);
  if (problems.consoleErrors.length) parts.push(`console: ${problems.consoleErrors.join(' | ')}`);
  if (problems.failedRequests.length) parts.push(`network: ${problems.failedRequests.join(' | ')}`);
  return parts.join('\n');
}
