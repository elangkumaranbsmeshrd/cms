import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { SessionStore } from './session.store';

/** Gates the entire authenticated shell — distinct from screenAccessGuard,
 * which gates one screen within it. Unauthenticated → straight to /login.
 */
export const authGuard: CanMatchFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if (!session.isAuthed()) return router.createUrlTree(['/login']);

  // A user carrying must_change_password is authenticated but cannot use any
  // screen: the backend 403s every endpoint except POST /auth/change-password
  // and GET /me (app/auth/deps.py). Letting them into the shell produces a
  // dashboard where every widget fails, which is exactly the state this flow
  // was found in. Sending them to the change-password screen is the only
  // action available to them, so the guard makes it the only destination.
  //
  // This covers the deep-link and restored-session paths too, not just a fresh
  // login — AuthService.restore() rehydrates a flagged session on a page
  // reload, and without this check that lands right back in the broken shell.
  if (session.mustChangePassword()) return router.createUrlTree(['/change-password']);

  return true;
};

/** Gates /change-password itself. The screen posts the caller's CURRENT password,
 * so it is meaningless without a session — an anonymous visitor would only ever
 * get a 401 out of it. Anyone signed in may use it, flagged or not: a voluntary
 * password change is a legitimate reason to be here, and refusing an unflagged
 * user would remove the only self-service change-password form that is reachable
 * when My Profile is unavailable. */
export const changePasswordGuard: CanMatchFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.isAuthed() ? true : router.createUrlTree(['/login']);
};
