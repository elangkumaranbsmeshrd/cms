import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth/auth.service';
import { SessionStore } from '../core/auth/session.store';

/**
 * The forced password change that `must_change_password` demands.
 *
 * WHY THIS EXISTS
 * The backend has enforced this flag correctly all along: app/auth/deps.py:44
 * rejects every request from a flagged user with 403 "Password change required
 * before continuing", allowing through exactly two endpoints —
 * POST /auth/change-password and GET /me. The flag is set on every login HR
 * creates (employees.py, create_login), by the seed, and by the "Forgot
 * password?" reset (auth_tokens.py, issue_temporary_password).
 *
 * The frontend had no answer to any of that. There was no route, no screen, and
 * no redirect: `SessionStore.mustChangePassword` was parsed, stored, and then
 * read by nothing in production code. A flagged user logged in successfully,
 * landed on the dashboard, and every screen 403'd. The one Change Password form
 * in the product lives inside My Profile, which loads GET /employees/me — itself
 * 403'd for a flagged user — so the page rendered its "No employee record is
 * linked to your login" empty state and the form inside it never appeared at all.
 * "Forgot password?" re-arms the flag, so the documented recovery path returned
 * the user to the identical dead end.
 *
 * When this was found, 105 of the 117 users in the dev database were in that
 * state: able to authenticate, unable to use the product, with no way out.
 *
 * DESIGN CONSTRAINTS this screen has to respect
 * - It renders from session data alone. It cannot call any API but the two on
 *   the allowlist, because everything else 403s for the very users who need it.
 * - It lives OUTSIDE the authenticated shell. The shell's chrome fetches
 *   reference data on load, all of which would 403.
 * - POST /auth/change-password revokes every refresh token (auth.py, "all other
 *   refresh tokens revoked"), so the session in hand is dead the moment it
 *   succeeds. The only correct next step is a clean re-login — which is also the
 *   right security behaviour, and is why this does not try to keep the user
 *   signed in.
 */
@Component({
  selector: 'app-change-password-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <div class="login-art">
        <div class="login-brand">
          <div class="brand-mark">M</div>
          <div>
            <b>Meshrd</b>
            <span>Company Management</span>
          </div>
        </div>
        <div class="login-pitch">
          <h2>Choose a new password</h2>
          <p>
            Your account is using a temporary password. Set one of your own to finish signing in — this only
            has to be done once.
          </p>
        </div>
        <div class="login-foot">&copy; Meshrd</div>
      </div>
      <div class="login-panel">
        <div class="login-card rise">
          @if (done()) {
            <h1>Password changed</h1>
            <p class="lede">
              Your new password is set. For security, every existing session was signed out — sign in again
              with your new password to continue.
            </p>
            <button class="btn primary btn-block" type="button" (click)="goToLogin()">Go to sign in</button>
          } @else {
            <h1>Set a new password</h1>
            <p class="lede">
              @if (email()) {
                Signed in as <b>{{ email() }}</b
                >.
              }
              Enter the temporary password you signed in with, then choose a new one.
            </p>

            <form (ngSubmit)="submit()">
              <div class="field">
                <label for="cp-current">Current password <span class="req" aria-hidden="true">*</span></label>
                <input
                  class="input"
                  id="cp-current"
                  type="password"
                  name="current_password"
                  aria-label="Current password"
                  aria-required="true"
                  autocomplete="current-password"
                  [(ngModel)]="currentPassword"
                  required
                />
              </div>

              <div class="field">
                <label for="cp-new">New password <span class="req" aria-hidden="true">*</span></label>
                <input
                  class="input"
                  id="cp-new"
                  type="password"
                  name="new_password"
                  aria-label="New password"
                  aria-required="true"
                  autocomplete="new-password"
                  [(ngModel)]="newPassword"
                  required
                />
                <div class="hint">At least 8 characters, and different from any password you've used recently.</div>
              </div>

              <div class="field">
                <label for="cp-confirm">Confirm new password <span class="req" aria-hidden="true">*</span></label>
                <input
                  class="input"
                  id="cp-confirm"
                  type="password"
                  name="confirm_password"
                  aria-label="Confirm new password"
                  aria-required="true"
                  autocomplete="new-password"
                  [(ngModel)]="confirmPassword"
                  required
                />
              </div>

              @if (error()) {
                <div class="form-error" role="alert">{{ error() }}</div>
              }

              <button class="btn primary btn-block" type="submit" [disabled]="submitting() || !canSubmit()">
                {{ submitting() ? 'Saving…' : 'Set new password' }}
              </button>
            </form>

            <p class="lede" style="margin-top: 16px; margin-bottom: 0;">
              <a class="link" role="button" tabindex="0" (click)="signOut()" (keydown.enter)="signOut()" (keydown.space)="signOut()"
                >Sign in as someone else</a
              >
            </p>
          }
        </div>
      </div>
    </div>
  `,
})
export class ChangePasswordPageComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  readonly submitting = signal(false);
  readonly done = signal(false);
  readonly error = signal<string | null>(null);

  readonly email = computed(() => this.session.user()?.email ?? null);

  /** Client-side gate only — the server owns the real rules (reuse history,
   * minimum length). This exists to spare the user a round trip for the two
   * mistakes a form can catch on its own.
   *
   * Deliberately a plain method, not a computed(). The three fields it reads
   * are ngModel-bound properties, not signals, so a computed() over them would
   * capture no dependencies, evaluate once while every field was still empty,
   * and never recompute — leaving the submit button permanently disabled. This
   * app runs zone-based change detection (app.config.ts), so a method call in
   * the template is re-evaluated each cycle and tracks the fields correctly. */
  canSubmit(): boolean {
    return this.currentPassword.length > 0 && this.newPassword.length > 0 && this.confirmPassword.length > 0;
  }

  submit(): void {
    if (this.submitting()) return;

    if (this.newPassword !== this.confirmPassword) {
      this.error.set('The two new passwords do not match.');
      return;
    }
    if (this.newPassword === this.currentPassword) {
      this.error.set('Your new password must be different from your current one.');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);

    this.http
      .post(`${environment.apiBaseUrl}/auth/change-password`, {
        current_password: this.currentPassword,
        new_password: this.newPassword,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.done.set(true);
          // The server revoked every refresh token, so the tokens in hand are
          // already dead. Tear the session down locally to match, rather than
          // leaving a husk that will fail on the next request.
          this.auth.logout();
        },
        error: (err) => {
          this.submitting.set(false);
          // Surface what the server actually said — "Current password is
          // incorrect" and "This password was used too recently" are both
          // specific, actionable messages, and swallowing them behind a
          // generic string is what left this whole flow undiagnosable.
          this.error.set(err?.error?.detail ?? 'Could not change your password. Please try again.');
        },
      });
  }

  goToLogin(): void {
    this.router.navigateByUrl('/login');
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
