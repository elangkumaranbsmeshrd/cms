import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test';

export const API = 'http://127.0.0.1:8001/api/v1';

/** The five seeded roles (backend/app/seed.py). */
export const ROLES = ['SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'HR', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const LOGINS: Record<Role, string> = {
  SUPER_ADMIN: 'superadmin@meshrd.in',
  MANAGER: 'manager@meshrd.in',
  ACCOUNTANT: 'accountant@meshrd.in',
  HR: 'hr@meshrd.in',
  EMPLOYEE: 'employee@meshrd.in',
};
const PASSWORD = 'Passw0rd!';

/** What /me returns under `policy.screens` — the same data the app builds its nav from. */
export interface ScreenPolicy {
  label: string;
  module: string;
  mode: 'none' | 'full' | 'view' | 'view_team' | 'own' | 'team';
  actions: string[];
  fields: Record<string, string>;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  screens: Record<string, ScreenPolicy>;
}

/**
 * Log in over the API.
 *
 * Deliberately NOT Playwright's storageState. This app keeps its access token
 * in an in-memory signal and its refresh token in sessionStorage
 * (frontend/src/app/core/auth/token-storage.ts), and storageState captures
 * cookies + localStorage only — it would silently restore nothing.
 *
 * Refresh tokens also ROTATE on use (app/services/auth_tokens.py), so a token
 * cannot be shared across tests: each caller gets its own.
 */
export async function login(request: APIRequestContext, role: Role): Promise<Session> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: LOGINS[role], password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`login failed for ${role}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();

  const me = await request.get(`${API}/me`, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!me.ok()) throw new Error(`/me failed for ${role}: ${me.status()}`);
  const mine = await me.json();

  // If a fresh seed ever reinstates must_change_password, fail loudly here
  // rather than letting every downstream test redirect to the change-password
  // screen and report a misleading failure.
  if (mine.must_change_password) {
    throw new Error(
      `${role} has must_change_password set. Clear it for the seeded test users, ` +
        `or the whole suite will be redirected to the change-password screen.`,
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    screens: mine.policy?.screens ?? {},
  };
}

/**
 * Put a page into an authenticated state.
 *
 * Seeds sessionStorage before any app code runs, so the app bootstraps from
 * the refresh token exactly as it would after a real reload.
 */
export async function authenticate(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ([key, token]) => {
      try {
        // SEED ONLY IF ABSENT. This runs on every navigation, and refresh
        // tokens rotate on use: after the first page load the app has already
        // exchanged this token and stored a fresh one. Overwriting it on the
        // next navigation would replay a spent token and 401 the session —
        // which looked exactly like every screen being broken.
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, token);
        }
      } catch {
        // Private-mode style failures: let the app show its own logged-out
        // state rather than throwing inside an init script.
      }
    },
    ['meshrd_refresh_token', session.refreshToken] as const,
  );
}

type Fixtures = {
  /** Sign in as a role and hand back a page already carrying its session. */
  as: (role: Role) => Promise<{ page: Page; session: Session }>;
};

export const test = base.extend<Fixtures>({
  as: async ({ page, request }, use) => {
    await use(async (role: Role) => {
      const session = await login(request, role);
      await authenticate(page, session);
      return { page, session };
    });
  },
});

export { expect };
