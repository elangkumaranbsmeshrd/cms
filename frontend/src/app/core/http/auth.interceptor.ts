import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { SessionStore } from '../auth/session.store';

/**
 * ARCH-3 §8's interceptor shape, adapted to the real bearer-token contract
 * (see auth.service.ts's header comment) — attach the in-memory access
 * token, and on a 401 (never from /auth/login or /auth/refresh themselves,
 * to avoid an infinite loop) attempt exactly one refresh-and-retry before
 * giving up and logging out.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const session = inject(SessionStore);
  const router = inject(Router);

  const isApi = req.url.startsWith(environment.apiBaseUrl);
  const token = auth.accessToken();
  const previewingAs = session.previewingAs();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // RBAC §4.2 "Preview as this role" — every request carries the previewed
  // role while active (rbac/deps.py's require_screen reads this same
  // header), not just GET /me's own query param, so scope/actions/fields
  // resolve for the previewed role everywhere, not only in the nav.
  if (previewingAs) headers['X-Preview-Role'] = previewingAs;
  const authedReq = isApi && Object.keys(headers).length ? req.clone({ setHeaders: headers }) : req;

  return next(authedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthEndpoint = req.url.includes('/auth/refresh') || req.url.includes('/auth/login');

      // A 403 from the must_change_password gate (app/auth/deps.py) is not a
      // permission problem the user can do anything about on the screen they
      // are on — it means the whole session is fenced off until the password is
      // changed. Without this, each screen rendered the raw server string
      // "Password change required before continuing" as if it were that
      // screen's own error, which is how the missing flow stayed invisible.
      // The guard normally prevents ever getting here; this is the backstop for
      // a flag set mid-session, or a request already in flight.
      if (err.status === 403 && isApi && err.error?.detail === 'Password change required before continuing') {
        router.navigateByUrl('/change-password');
        return throwError(() => err);
      }

      if (err.status !== 401 || !isApi || isAuthEndpoint) {
        return throwError(() => err);
      }
      return auth.refreshOnce().pipe(
        switchMap((newToken) => {
          const retryHeaders: Record<string, string> = { Authorization: `Bearer ${newToken}` };
          if (previewingAs) retryHeaders['X-Preview-Role'] = previewingAs;
          return next(req.clone({ setHeaders: retryHeaders }));
        }),
        catchError((refreshErr) => {
          auth.logout();
          router.navigate(['/login'], { queryParams: { reason: 'session-expired' } });
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
