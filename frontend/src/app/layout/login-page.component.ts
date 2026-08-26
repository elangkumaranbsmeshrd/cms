import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';

// §6 "nothing hardcoded": the brand mark ("M"), "Meshrd", the "Company
// Management" tagline and the "&copy; Meshrd" footer in the template below
// are literal strings, not read from any dynamic source. Masters §3.6
// CompanyProfile already has real fields for this (`legal_name`,
// `logo_file_id` — backend/app/schemas/masters.py), but every existing read
// of that data (GET /masters/company-profile and its siblings, in
// backend/app/api/v1/masters_company_profile.py) sits behind
// get_current_user + require_screen RBAC, i.e. requires a live session.
// This page renders BEFORE a session exists, so there is nothing it could
// authenticate a call with. A real fix needs a new *unauthenticated*
// branding endpoint (legal_name + logo only — none of the sensitive Company
// Profile fields such as gstin/pan) that this page and
// forgot-password-page.component.ts (identical hardcoded pattern) can both
// call pre-login. That endpoint doesn't exist yet, so this stays literal
// rather than guessing at a route/response shape nothing backs today.
@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
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
          <h2>Everything the company runs on, in one place.</h2>
          <p>Employees, payroll, assets, tickets, projects, finance, and tax &amp; compliance — one system, one source of truth.</p>
        </div>
        <div class="login-foot">&copy; Meshrd</div>
      </div>
      <div class="login-panel">
        <div class="login-card rise">
          <h1>Welcome back</h1>
          <p class="lede">Sign in to your account</p>

          @if (expiredReason()) {
            <div class="form-error">Your session expired — please sign in again.</div>
          }

          <form (ngSubmit)="submit()">
            <div class="field">
              <label>Email <span class="req">*</span></label>
              <input class="input" type="email" name="email" [(ngModel)]="email" autocomplete="username" required />
            </div>
            <div class="field">
              <div style="display: flex; align-items: baseline; justify-content: space-between;">
                <label style="margin-bottom: 0;">Password <span class="req">*</span></label>
                <a class="link" routerLink="/forgot-password" style="font-size: 11.5px;">Forgot password?</a>
              </div>
              <div style="position: relative; margin-top: 5px;">
                <input
                  class="input"
                  [type]="showPassword() ? 'text' : 'password'"
                  name="password"
                  [(ngModel)]="password"
                  autocomplete="current-password"
                  required
                  style="padding-right: 38px;"
                />
                <button
                  type="button"
                  class="icon-btn"
                  style="position: absolute; right: 3px; top: 3px; height: 30px;"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
                  tabindex="-1"
                >
                  {{ showPassword() ? '🙈' : '👁' }}
                </button>
              </div>
            </div>

            @if (error()) {
              <div class="form-error">{{ error() }}</div>
            }

            <button class="btn primary btn-block" type="submit" [disabled]="submitting()">
              {{ submitting() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  email = '';
  password = '';
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly showPassword = signal(false);
  readonly expiredReason = signal(this.route.snapshot.queryParamMap.get('reason') === 'session-expired');

  submit(): void {
    this.error.set(null);
    this.submitting.set(true);
    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.detail ?? 'Unable to sign in. Check your email and password.');
      },
    });
  }
}
