/**
 * Regression cover for the `must_change_password` blocker.
 *
 * The backend has always enforced the flag (app/auth/deps.py 403s every
 * endpoint but POST /auth/change-password and GET /me). The frontend enforced
 * nothing: `SessionStore.mustChangePassword` was parsed, stored, and read by no
 * production code at all. A flagged user was admitted to the shell and then hit
 * a 403 on every screen, with no route, screen or redirect anywhere that could
 * clear the flag. 105 of the 117 users in the dev database were in that state
 * when it was found.
 *
 * These tests pin the guard behaviour that closes it, including the case the
 * original bug actually shipped as — `isAuthed() && mustChangePassword()`
 * returning plain `true`.
 */
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';

import { authGuard, changePasswordGuard } from './auth.guard';
import { SessionStore } from './session.store';
import { CurrentUser, EMPTY_POLICY } from './session.model';

function userWith(mustChangePassword: boolean): CurrentUser {
  return {
    id: 'u1',
    email: 'someone@meshrd.in',
    fullName: 'Some One',
    role: 'EMPLOYEE',
    mustChangePassword,
    policy: EMPTY_POLICY,
    previewingAs: null,
  };
}

describe('authGuard / changePasswordGuard', () => {
  let session: SessionStore;

  /** Both guards are CanMatchFn; neither reads its route/segments arguments,
   * so they are invoked in an injection context with throwaway values. */
  const runAuthGuard = (): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => authGuard({} as never, [] as never)) as boolean | UrlTree;

  const runChangePasswordGuard = (): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => changePasswordGuard({} as never, [] as never)) as boolean | UrlTree;

  const pathOf = (result: boolean | UrlTree): string => {
    const router = TestBed.inject(Router);
    return router.serializeUrl(result as UrlTree);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    session = TestBed.inject(SessionStore);
  });

  describe('authGuard', () => {
    it('sends an unauthenticated visitor to /login', () => {
      session.set(null);
      expect(pathOf(runAuthGuard())).toBe('/login');
    });

    it('admits a normal authenticated user', () => {
      session.set(userWith(false));
      expect(runAuthGuard()).toBe(true);
    });

    it('diverts a user who must change their password, instead of admitting them to a shell that 403s', () => {
      // THE BUG: this returned `true`, so the user reached the dashboard and
      // every widget on it failed with "Password change required before
      // continuing" — surfaced as if it were each screen's own error.
      session.set(userWith(true));
      expect(pathOf(runAuthGuard())).toBe('/change-password');
    });

    it('checks authentication before the password flag, so a signed-out visitor still goes to /login', () => {
      session.set(null);
      expect(pathOf(runAuthGuard())).toBe('/login');
    });
  });

  describe('changePasswordGuard', () => {
    it('lets a flagged user reach the screen that is their only way out', () => {
      session.set(userWith(true));
      expect(runChangePasswordGuard()).toBe(true);
    });

    it('also lets an unflagged user change their password voluntarily', () => {
      // This screen is the only change-password form reachable when My Profile
      // is unavailable, so refusing an unflagged user would remove a
      // legitimate self-service path.
      session.set(userWith(false));
      expect(runChangePasswordGuard()).toBe(true);
    });

    it('refuses an anonymous visitor, who has no current password to submit', () => {
      session.set(null);
      expect(pathOf(runChangePasswordGuard())).toBe('/login');
    });
  });
});
