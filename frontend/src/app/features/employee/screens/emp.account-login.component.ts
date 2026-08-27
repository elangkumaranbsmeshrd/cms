import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { humanizeEnum } from '../../../shared/screens/cell-format';
import { EmployeeRow } from '../employee.api';

const SCREEN = 'employee.master_record';
/** §2.2's Extra Permissions list is per-person RBAC data, and it is gated on
 * RBAC's own screen, not on the employee record — GET/POST/DELETE
 * /rbac/overrides all sit behind `rbac.overrides` (rbac_admin.py), which
 * app/seed.py grants to Super Admin alone. */
const OVERRIDES_SCREEN = 'rbac.overrides';

interface LoginStatus {
  readonly role_name?: string;
  readonly must_change_password?: boolean;
  readonly last_login_at?: string | null;
}

/** OverrideOut (rbac_admin.py) — the same row shape RBAC's own Individual
 * Permission Overrides list renders (rbac.overrides.list.config.ts). */
interface OverrideRow {
  readonly id: string;
  readonly screen_label: string;
  readonly module_key: string;
  readonly layer: string;
  readonly action_key: string | null;
  readonly field_key: string | null;
  readonly override_value: string;
  readonly reason: string;
  readonly granted_by_name: string;
  readonly created_at: string;
}

// §4.3's own L1-L4 vocabulary, kept verbatim from RBAC's own list config so
// one override reads identically in both places.
const LAYER_LABELS: Record<string, string> = { L1: 'Visibility', L2: 'Action', L3: 'Field', L4: 'Scope' };

/** override_value is layer-dependent, NOT a GRANT/REVOKE pair: rbac_admin.py's
 * _OVERRIDE_VALUES_BY_LAYER accepts a screen mode for L1/L4, allow|deny for
 * L2, and a field mode for L3 — it rejects 'GRANT' outright with a 422. These
 * are the values that TAKE something away; everything else widens access. */
const RESTRICTING_VALUES = new Set(['deny', 'hide', 'none']);

const ROLE_OPTIONS = [
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'HR', label: 'HR' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
];

/** §2.2 Tab: Account & Login.
 *
 * A bespoke component rather than the generic 'fields' tab this used to be,
 * for one reason: §2.2's field table ends with **Extra Permissions —
 * "List, with a '+ Add Permission Override' action"** — and a RecordFieldsTab
 * renders actions plus captioned single values only (record-screen.component.
 * ts), with nowhere to put a table. §6.3 is explicit that the list belongs
 * here: "On the Employee Master Record itself, this shows up as the Extra
 * Permissions list on the Account & Login tab (Section 2.2), so anyone
 * looking at one person's record can see at a glance whether they have
 * anything beyond their role's defaults." The same §6.3 sentence is equally
 * explicit that the GRANTING screen is not this module's to build — "the full
 * design of the settings screen used to grant these... belongs in the separate
 * Roles & Access module" — so "+ Add Permission Override" navigates to that
 * screen (rbac/overrides/add) instead of growing a second module/screen/action
 * picker here.
 *
 * Everything else on this tab — the five login actions and the Login Access
 * values — is carried over unchanged from emp.record.config.ts's own tab
 * definition, including each action's separate RBAC gate (Send Welcome Email
 * is `employee.onboarding`'s action, not this record's) and its confirm text.
 * Same bespoke-component-tab precedent as Salary Structure and Insurance &
 * Benefits, which sit beside it on this record for the same kind of reason.
 */
@Component({
  selector: 'app-emp-account-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (employee(); as e) {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-body">
          @if (actionError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
          }
          <div class="filter-row" style="margin-bottom: 18px;">
            @if (can('manage_login') && !e.user_id) {
              <select class="input" style="width: auto;" aria-label="Role" [(ngModel)]="newLoginRole">
                @for (opt of ROLE_OPTIONS; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
              <button class="btn sm ghost" type="button" [disabled]="inFlight() === 'create'" (click)="createLogin()">
                {{ inFlight() === 'create' ? 'Working…' : 'Create Login' }}
              </button>
            }
            @if (can('manage_login') && e.user_id && !e.login_removed_at) {
              <button class="btn sm ghost" type="button" [disabled]="inFlight() === 'disable'" (click)="disableLogin()">
                {{ inFlight() === 'disable' ? 'Working…' : 'Disable Login' }}
              </button>
            }
            @if (can('manage_login') && e.user_id && e.login_removed_at) {
              <button class="btn sm ghost" type="button" [disabled]="inFlight() === 'enable'" (click)="enableLogin()">
                {{ inFlight() === 'enable' ? 'Working…' : 'Enable Login' }}
              </button>
            }
            @if (can('manage_login') && e.user_id) {
              <button class="btn sm ghost" type="button" [disabled]="inFlight() === 'reset'" (click)="resetPassword()">
                {{ inFlight() === 'reset' ? 'Working…' : 'Reset Password' }}
              </button>
            }
            @if (canSendWelcome()) {
              <button class="btn sm ghost" type="button" [disabled]="inFlight() === 'welcome'" (click)="sendWelcomeEmail()">
                {{ inFlight() === 'welcome' ? 'Working…' : 'Send Welcome Email' }}
              </button>
            }
          </div>

          <h3 style="margin: 0 0 10px; font-size: 12.5px;">Login Access</h3>
          <div class="grid g-2" style="margin-bottom: 18px;">
            <div><div class="cell-sub">Login Email</div><div>{{ e.email }}</div></div>
            <div>
              <div class="cell-sub">Account Status</div>
              <div>{{ e.user_id ? (e.login_removed_at ? 'Disabled' : 'Enabled') : 'No login' }}</div>
            </div>
            @if (loginStatus(); as s) {
              <div><div class="cell-sub">Set Role</div><div>{{ s.role_name ?? '—' }}</div></div>
              <div>
                <div class="cell-sub">Must Change Password on Next Login</div>
                <div>{{ s.must_change_password ? 'Yes' : 'No' }}</div>
              </div>
              <div><div class="cell-sub">Last Login</div><div>{{ lastLoginLabel(s) }}</div></div>
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Extra Permissions</h3>
          @if (canManageOverrides()) {
            <a class="btn sm ghost" [routerLink]="['/rbac/overrides/add']">+ Add Permission Override</a>
          }
        </div>
        <div class="card-body">
          <p class="hint" style="margin: 0 0 12px;">
            Anything this person can do beyond what their role normally allows — or has had taken away — granted to them
            alone rather than to everyone who shares their role.
          </p>
          @if (!e.user_id) {
            <p class="cell-sub" style="margin: 0;">This employee has no login yet, so there is nothing to override.</p>
          } @else if (!canViewOverrides()) {
            <p class="cell-sub" style="margin: 0;">Per-person permission overrides are visible to Super Admin only.</p>
          } @else if (overridesError()) {
            <p class="cell-sub" style="margin: 0;">{{ overridesError() }}</p>
          } @else if (!overrides().length) {
            <p class="cell-sub" style="margin: 0;">No overrides — this person has exactly their role's default access.</p>
          }
        </div>
        @if (e.user_id && canViewOverrides() && overrides().length) {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Screen</th>
                  <th>Permission</th>
                  <th>Set To</th>
                  <th>Reason</th>
                  <th>Granted By</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (o of overrides(); track o.id) {
                  <tr>
                    <td class="cell-strong">{{ o.screen_label }}</td>
                    <td>{{ permissionOf(o) }}</td>
                    <td>
                      <span class="badge-s" [class.b-ok]="!isRestricting(o)" [class.b-danger]="isRestricting(o)">
                        {{ humanizeEnum(o.override_value) }}
                      </span>
                    </td>
                    <td>{{ o.reason }}</td>
                    <td>{{ o.granted_by_name }}</td>
                    <td class="mono">{{ o.created_at.slice(0, 10) }}</td>
                    <td>
                      @if (canManageOverrides()) {
                        <button class="btn sm ghost" type="button" [disabled]="removingId() === o.id" (click)="removeOverride(o)">
                          {{ removingId() === o.id ? 'Removing…' : 'Remove' }}
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
      }
    }
  `,
})
export class EmpAccountLoginComponent implements OnInit {
  readonly employeeId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly ROLE_OPTIONS = ROLE_OPTIONS;
  protected readonly isLoading = signal(true);
  protected readonly employee = signal<EmployeeRow | null>(null);
  protected readonly loginStatus = signal<LoginStatus | null>(null);
  protected readonly overrides = signal<readonly OverrideRow[]>([]);
  protected readonly overridesError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly inFlight = signal<string | null>(null);
  protected readonly removingId = signal<string | null>(null);
  protected newLoginRole = 'EMPLOYEE';

  ngOnInit(): void {
    this.load();
  }

  protected can(action: string): boolean {
    return this.policy.can(SCREEN, action);
  }

  /** §2.12's own action on its own screen key — gated separately from the rest
   * of this tab, exactly as emp.record.config.ts gated it before. */
  protected canSendWelcome(): boolean {
    return this.policy.can('employee.onboarding', 'send_welcome_email');
  }

  protected canViewOverrides(): boolean {
    return this.policy.canOpen(OVERRIDES_SCREEN);
  }

  protected canManageOverrides(): boolean {
    return this.policy.can(OVERRIDES_SCREEN, 'add');
  }

  protected readonly humanizeEnum = humanizeEnum;

  protected isRestricting(row: OverrideRow): boolean {
    return RESTRICTING_VALUES.has(row.override_value);
  }

  protected permissionOf(row: OverrideRow): string {
    const base = LAYER_LABELS[row.layer] ?? row.layer;
    if (row.action_key) return `${base} — ${row.action_key}`;
    if (row.field_key) return `${base} — ${row.field_key}`;
    return base;
  }

  protected lastLoginLabel(s: LoginStatus): string {
    return s.last_login_at ? new Date(s.last_login_at).toLocaleString('en-IN') : 'Never';
  }

  private load(): void {
    const id = this.employeeId();
    this.isLoading.set(true);
    this.http.get<EmployeeRow>(`${environment.apiBaseUrl}/employees/${id}`).subscribe({
      next: (row) => {
        this.employee.set(row);
        this.isLoading.set(false);
        // Both follow-ups depend on whether a login exists at all: login-status
        // 404s without one, and an override is keyed on the users row, not the
        // employee row.
        if (!row.user_id) {
          this.loginStatus.set(null);
          this.overrides.set([]);
          return;
        }
        this.http.get<LoginStatus>(`${environment.apiBaseUrl}/employees/${id}/login-status`).subscribe({
          next: (s) => this.loginStatus.set(s),
          error: () => this.loginStatus.set(null),
        });
        this.loadOverrides(row.user_id);
      },
      error: () => this.isLoading.set(false),
    });
  }

  private loadOverrides(userId: string): void {
    if (!this.canViewOverrides()) return;
    this.overridesError.set(null);
    this.http.get<OverrideRow[]>(`${environment.apiBaseUrl}/rbac/overrides?user_id=${encodeURIComponent(userId)}`).subscribe({
      next: (rows) => this.overrides.set(rows),
      error: () => this.overridesError.set('Could not read this person’s permission overrides.'),
    });
  }

  private fire(key: string, path: string, confirmText?: string): void {
    if (confirmText && !window.confirm(confirmText)) return;
    this.actionError.set(null);
    this.inFlight.set(key);
    this.http.post(`${environment.apiBaseUrl}${path}`, {}).subscribe({
      next: () => {
        this.inFlight.set(null);
        this.load();
      },
      error: (err) => {
        this.inFlight.set(null);
        this.actionError.set(err?.error?.detail ?? 'That action could not be completed.');
      },
    });
  }

  protected createLogin(): void {
    // create-login takes role_code as a QUERY param, not a body (employees.py).
    this.fire('create', `/employees/${this.employeeId()}/create-login?role_code=${encodeURIComponent(this.newLoginRole)}`);
  }

  protected disableLogin(): void {
    this.fire(
      'disable',
      `/employees/${this.employeeId()}/disable-login`,
      'Disable this login? It ends every active session immediately — all of this person’s refresh tokens are revoked at once.',
    );
  }

  protected enableLogin(): void {
    this.fire('enable', `/employees/${this.employeeId()}/enable-login`);
  }

  protected resetPassword(): void {
    this.fire(
      'reset',
      `/employees/${this.employeeId()}/reset-password`,
      'Generate a new temporary password and email it to this employee? Every one of their active sessions will be signed out.',
    );
  }

  protected sendWelcomeEmail(): void {
    this.fire('welcome', `/employees/${this.employeeId()}/send-welcome-email`, "Send this employee's welcome email now?");
  }

  protected removeOverride(row: OverrideRow): void {
    if (!window.confirm('Remove this permission override? This person goes back to their role’s default access for it.')) return;
    this.removingId.set(row.id);
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/rbac/overrides/${row.id}`).subscribe({
      next: () => {
        this.removingId.set(null);
        const userId = this.employee()?.user_id;
        if (userId) this.loadOverrides(userId);
      },
      error: (err) => {
        this.removingId.set(null);
        this.actionError.set(err?.error?.detail ?? 'That override could not be removed.');
      },
    });
  }
}
