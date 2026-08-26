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
  /**
   * When the page last did anything network-ish. Used to wait for a screen to
   * go quiet BEFORE moving on, so a slow response is blamed on the screen that
   * actually issued it rather than on whichever screen is walked next.
   */
  lastActivityAt: number;
  /** Reads whose body identified them as a deliberate domain state. */
  expectedEmptyStates: string[];
  /** In-flight body reads; await via settleProblems() before judging. */
  pendingReads: Promise<void>[];
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
  // The browser narrates EVERY 4xx/5xx as "Failed to load resource: the
  // server responded with a status of NNN". That is not app code logging an
  // error, and it carries strictly less information than the response
  // listener below, which reads the body and can tell an RBAC denial from a
  // deliberate domain empty state. Keeping both double-counts the same event
  // and re-reports as a failure exactly what the listener just cleared.
  // Real console.error() calls from application code are still caught.
  /^Failed to load resource: the server responded with a status of \d+/i,
];

/** Requests the browser makes that a 4xx on is not an app defect. */
const IGNORED_REQUESTS = [/favicon\.ico/i, /\.map$/i];

export function watchForProblems(page: Page): PageProblems {
  const problems: PageProblems = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    lastActivityAt: Date.now(),
    expectedEmptyStates: [],
    pendingReads: [],
  };

  page.on('request', () => {
    problems.lastActivityAt = Date.now();
  });

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
    problems.lastActivityAt = Date.now();
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (IGNORED_REQUESTS.some((re) => re.test(url))) return;

    const line = `${status} ${res.request().method()} ${url}`;

    // A 404 is two completely different events in this API, and conflating
    // them made correct behaviour look like breakage.
    //
    //   {"detail":"Not found"}  -> RBAC denial. require_screen 404s rather
    //      than 403s so an invisible screen cannot be probed. On a screen the
    //      role is supposed to use, that IS a bug.
    //   {"detail":"No Employee record is linked to this login"} -> a domain
    //      empty state, deliberately worded, already handled by the UI. A
    //      Super Admin who is not in the HR system is a legitimate production
    //      state, not a defect.
    //
    // Classify by what the response SAYS, not by its URL — an allow-list of
    // paths would silently absorb a real RBAC failure on the same endpoint.
    // Applies to GET only, and only to the two codes that mean "I cannot give
    // you data, and here is why": 404 (absent) and 409 (preconditions not
    // configured). A GET that explains itself is reporting a STATE. Writes stay
    // strict, and a 400/422 on a read still fails — that would mean the client
    // sent something malformed, which is a defect.
    const isRead = res.request().method() === 'GET';
    if (isRead && (status === 404 || status === 409)) {
      problems.pendingReads.push(
        res
          .text()
          .then((body) => {
            let detail = '';
            try {
              detail = String(JSON.parse(body)?.detail ?? '');
            } catch {
              detail = body.slice(0, 120);
            }
            // A bare, generic message means a gate produced it, not the domain.
            if (/^(not found|forbidden|conflict)$/i.test(detail.trim()) || detail.trim() === '') {
              problems.failedRequests.push(line);
            } else {
              problems.expectedEmptyStates.push(`${line} — ${detail}`);
            }
          })
          .catch(() => {
            // Body unavailable (redirect, aborted). Fail closed: report it.
            problems.failedRequests.push(line);
          }),
      );
      return;
    }

    problems.failedRequests.push(line);
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

/** Resolve every in-flight response-body read, so 404/409 classification is
 * complete before a screen is judged. */
export async function settleProblems(problems: PageProblems): Promise<void> {
  await Promise.allSettled(problems.pendingReads);
}

/**
 * Wait until the page has issued no request and received no response for
 * `quietMs`, capped at `maxMs`.
 *
 * Not networkidle: this app's dev server holds an HMR websocket open, so
 * Playwright's networkidle can never settle. Without this, a response that
 * arrives after we have moved to the next screen is recorded against the wrong
 * screen — which made per-role failure counts wobble between identical runs and
 * pointed at innocent screens.
 */
export async function waitForQuiet(
  problems: PageProblems,
  { quietMs = 700, maxMs = 8000 }: { quietMs?: number; maxMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const idleFor = Date.now() - problems.lastActivityAt;
    if (idleFor >= quietMs) return;
    if (Date.now() >= deadline) return;
    await new Promise((r) => setTimeout(r, Math.min(quietMs - idleFor, 150)));
  }
}
