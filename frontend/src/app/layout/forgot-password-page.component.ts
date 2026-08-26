import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-forgot-password-page',
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
          <h2>Forgot your password?</h2>
          <p>Enter your work email and, if there's an account, we'll send a new temporary password to it.</p>
        </div>
        <div class="login-foot">&copy; Meshrd</div>
      </div>
      <div class="login-panel">
        <div class="login-card rise">
          @if (submitted()) {
            <h1>Check your email</h1>
            <p class="lede">If an account exists for <b>{{ email }}</b>, we've sent a new temporary password to it. Sign in with it and you'll be asked to choose a new one.</p>
            <a class="btn primary btn-block" routerLink="/login">Back to sign in</a>
          } @else {
            <h1>Reset your password</h1>
            <p class="lede">We'll email a temporary password to your registered address.</p>
            <form (ngSubmit)="submit()">
              <div class="field">
                <label>Email <span class="req">*</span></label>
                <input class="input" type="email" name="email" [(ngModel)]="email" autocomplete="username" required />
              </div>
              <button class="btn primary btn-block" type="submit" [disabled]="submitting()">
                {{ submitting() ? 'Sending…' : 'Send temporary password' }}
              </button>
            </form>
            <p class="lede" style="margin-top: 16px; margin-bottom: 0;">
              <a class="link" routerLink="/login">&larr; Back to sign in</a>
            </p>
          }
        </div>
      </div>
    </div>
  `,
})
export class ForgotPasswordPageComponent {
  private readonly auth = inject(AuthService);

  email = '';
  readonly submitting = signal(false);
  readonly submitted = signal(false);

  submit(): void {
    this.submitting.set(true);
    // Deliberately no success/error branching in the UI — the backend
    // always 204s and this page always shows the same confirmation, same
    // anti-enumeration property carried all the way to the screen (a
    // network-level failure is the one case genuinely worth surfacing
    // differently, so it still falls through to the same confirmation
    // rather than a dead end — nothing sensitive to protect by showing an
    // error here, and it avoids a confusing half-built error state).
    this.auth.requestPasswordReset(this.email).subscribe({
      next: () => this.finish(),
      error: () => this.finish(),
    });
  }

  private finish(): void {
    this.submitting.set(false);
    this.submitted.set(true);
  }
}
