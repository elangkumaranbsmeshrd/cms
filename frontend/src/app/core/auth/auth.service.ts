import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CurrentUser, MeResponseRaw, fromMeResponse } from './session.model';
import { SessionStore } from './session.store';
import { clearStoredRefreshToken, getStoredRefreshToken, setStoredRefreshToken } from './token-storage';

interface TokenResponseRaw {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

/**
 * ARCH-3 §8 designs the auth interceptor around a short-lived access JWT
 * held in memory and a long-lived refresh token in an HttpOnly cookie —
 * explicitly flagged in the doc itself as deferred: "today it issues bearer
 * tokens returned in the response body... no HttpOnly refresh cookie... the
 * migration is deferred to the start of Angular auth work." This IS that
 * work, and the backend still hasn't grown cookie delivery (confirmed:
 * backend/app/api/v1/auth.py's TokenResponse puts both tokens in the JSON
 * body). Built against today's real contract — see token-storage.ts for
 * where the refresh token actually lives in the meantime.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);

  private readonly _accessToken = signal<string | null>(null);
  readonly accessToken = this._accessToken.asReadonly();

  private refreshInFlight: Observable<string> | null = null;

  login(email: string, password: string): Observable<CurrentUser> {
    return this.http.post<TokenResponseRaw>(`${environment.apiBaseUrl}/auth/login`, { email, password }).pipe(
      tap((res) => this.storeTokens(res)),
      switchMap(() => this.fetchMe()),
    );
  }

  /** Called once by the app initializer, before first paint (ARCH-3 §4). */
  restore(): Observable<void> {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      this.session.set(null);
      return of(void 0);
    }
    return this.refreshOnce().pipe(
      switchMap(() => this.fetchMe()),
      map(() => void 0),
      catchError(() => {
        this.logout();
        return of(void 0);
      }),
    );
  }

  /** Single-flight refresh — concurrent 401s from a burst of requests share one call. */
  refreshOnce(): Observable<string> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return throwError(() => new Error('No refresh token'));

    this.refreshInFlight = this.http
      .post<TokenResponseRaw>(`${environment.apiBaseUrl}/auth/refresh`, { refresh_token: refreshToken })
      .pipe(
        tap((res) => this.storeTokens(res)),
        map((res) => res.access_token),
        // Clears the in-flight ref on completion OR error, regardless of
        // subscriber count, so the NEXT 401 starts a fresh refresh instead
        // of replaying a stale/failed one. shareReplay(1) itself is what
        // makes this "single-flight": every 401 that arrives while this
        // observable is still in flight gets the SAME pending HTTP call.
        finalize(() => (this.refreshInFlight = null)),
        shareReplay(1),
      );
    return this.refreshInFlight;
  }

  /** RBAC §4.2 "Preview as this role" — re-fetches /me with a Super-Admin-
   * only ?preview_role= override (backend/app/api/v1/auth.py's get_me);
   * every other role gets their own unmodified policy back (fail-closed,
   * enforced server-side, not just hidden client-side — see that endpoint's
   * own comment). In-memory only, same as theme/accent (ui.store.ts) —
   * resets on a full page reload, matching the prototype's own convention. */
  previewAsRole(roleCode: string): Observable<CurrentUser> {
    return this.fetchMe(roleCode);
  }

  exitPreview(): Observable<CurrentUser> {
    return this.fetchMe();
  }

  /** ARCH-2 §5.4's self-service reset: always resolves (backend always
   * returns 204 regardless of whether the email exists or anything else
   * went wrong server-side — see the endpoint's own docstring). There is
   * deliberately no error branch for the caller to distinguish "sent" from
   * "not sent" — that distinction is exactly what this endpoint exists to
   * hide.
   */
  requestPasswordReset(email: string): Observable<void> {
    return this.http.post<void>(`${environment.apiBaseUrl}/auth/password/reset-request`, { email });
  }

  logout(): void {
    const refreshToken = getStoredRefreshToken();
    clearStoredRefreshToken();
    this._accessToken.set(null);
    this.session.set(null);
    if (refreshToken) {
      // Best-effort — the session is already torn down client-side regardless.
      this.http.post(`${environment.apiBaseUrl}/auth/logout`, { refresh_token: refreshToken }).subscribe({ error: () => {} });
    }
  }

  private fetchMe(previewRole?: string): Observable<CurrentUser> {
    const url = previewRole ? `${environment.apiBaseUrl}/me?preview_role=${encodeURIComponent(previewRole)}` : `${environment.apiBaseUrl}/me`;
    return this.http.get<MeResponseRaw>(url).pipe(
      map(fromMeResponse),
      tap((user) => this.session.set(user)),
    );
  }

  private storeTokens(res: TokenResponseRaw): void {
    this._accessToken.set(res.access_token);
    setStoredRefreshToken(res.refresh_token);
  }
}
