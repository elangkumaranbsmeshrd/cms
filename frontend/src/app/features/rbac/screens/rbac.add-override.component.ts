import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { FIELD_MODE_OPTIONS, MatrixModuleRow, SCREEN_MODE_OPTIONS } from './rbac.permission-matrix.config';
import { RBAC_MODULE_OPTIONS } from './rbac.module-options';

interface PersonOption {
  readonly user_id: string;
  readonly name: string;
}

interface RoleDefaultSummary {
  readonly role_code: string;
  readonly role_name: string;
  readonly modules: readonly MatrixModuleRow[];
}

type MatrixScreen = MatrixModuleRow['screens'][number];

interface PermissionOption {
  readonly value: string; // 'L1' | 'L4' | 'L2:<action_key>' | 'L3:<field_key>'
  readonly label: string;
}

/** §4.3's own r.override form (app-forms.js:840-851) — a bespoke screen, not
 * one of the 14 generic shapes, because every field below but the last two
 * cascades from the one before it (Module -> Screen -> Permission), which
 * FieldConfig has no dependsOn/cascading mechanism for (confirmed absent
 * from screen.types.ts). Reached from rbac.overrides.list.config.ts's own
 * createRoute, same as any other module.directory's "+ Add" button — just
 * pointed at a bespoke component instead of the generic create route,
 * because there is no ScreenConfig shape this fits (rbac.routes.ts already
 * does the identical thing for the Matrix and the list itself).
 *
 * Field order and wording follow the prototype's r.override form exactly:
 * Employee, Role (read-only, from the employee record), Module, Screen
 * (filtered to that module), Permission (filtered to what that screen
 * actually has — a Layer 1 visibility flip, a specific Layer 2 action, a
 * specific Layer 3 field, or the Layer 4 scope — "only options that
 * genuinely exist on that screen appear", app-forms.js:846), Grant or
 * Revoke, and a read-only Role Default reference. `Reason` is a real,
 * required backend field (create_override, rbac_admin.py: "Reason is
 * required") with no counterpart in the prototype's mock form — kept
 * because the live endpoint 422s without it, not invented UI.
 */
@Component({
  selector: 'app-rbac-add-override',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Add Permission Override <span class="spec-ref">§4.3</span></h1>
        <p class="page-sub">Grants or revokes one permission for one person, without touching their role default.</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" (click)="back()">Cancel</button>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        @if (formError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
        }
        <div class="grid g-2">
          <div style="grid-column: span 2;">
            <div class="cell-sub">Employee</div>
            <select class="input" [(ngModel)]="employeeId" (ngModelChange)="onEmployeeChange()">
              <option [value]="null">— Select a person —</option>
              @for (p of people(); track p.user_id) {
                <option [value]="p.user_id">{{ p.name }}</option>
              }
            </select>
          </div>

          <div>
            <div class="cell-sub">Role</div>
            <input class="input" [value]="roleDefault()?.role_name ?? '—'" readonly />
          </div>

          <div>
            <div class="cell-sub">Module</div>
            <select class="input" [(ngModel)]="moduleKey" [disabled]="!roleDefault()" (ngModelChange)="onModuleChange()">
              <option [value]="null">—</option>
              @for (m of moduleOptions(); track m.value) {
                <option [value]="m.value">{{ m.label }}</option>
              }
            </select>
          </div>

          <div style="grid-column: span 2;">
            <div class="cell-sub">Screen</div>
            <select class="input" [(ngModel)]="screenKey" [disabled]="!moduleKey" (ngModelChange)="onScreenChange()">
              <option [value]="null">—</option>
              @for (s of screensForModule(); track s.screen_key) {
                <option [value]="s.screen_key">{{ s.label }}</option>
              }
            </select>
            <div class="hint">Filtered to the selected Module — only that module's screens are offered.</div>
          </div>

          <div style="grid-column: span 3;">
            <div class="cell-sub">Permission</div>
            <select class="input" [(ngModel)]="permissionValue" [disabled]="!screenKey">
              <option [value]="null">—</option>
              @for (p of permissionOptions(); track p.value) {
                <option [value]="p.value">{{ p.label }}</option>
              }
            </select>
            <div class="hint">Only options that genuinely exist on this screen appear.</div>
          </div>

          <div>
            <div class="cell-sub">Grant or Revoke</div>
            <select class="input" [(ngModel)]="overrideValue">
              <option value="GRANT">Grant</option>
              <option value="REVOKE">Revoke</option>
            </select>
          </div>

          <div style="grid-column: span 2;">
            <div class="cell-sub">Role Default (for reference)</div>
            <input class="input" [value]="roleDefaultReference()" readonly />
            <div class="hint">The baseline this override departs from. Every saved override row is marked "different from role default".</div>
          </div>

          <div style="grid-column: span 3;">
            <div class="cell-sub">Reason</div>
            <input class="input" [(ngModel)]="reason" placeholder="Required — why this person needs this override" />
          </div>
        </div>
      </div>
      <div class="card-foot">
        <button class="btn ghost" type="button" [disabled]="saving()" (click)="back()">Cancel</button>
        <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  `,
})
export class RbacAddOverrideComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  protected readonly people = signal<readonly PersonOption[]>([]);
  protected employeeId: string | null = null;
  protected readonly roleDefault = signal<RoleDefaultSummary | null>(null);

  protected moduleKey: string | null = null;
  protected screenKey: string | null = null;
  protected permissionValue: string | null = null;
  protected overrideValue: 'GRANT' | 'REVOKE' = 'GRANT';
  protected reason = '';

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  // module_key -> display label, same real-module vocabulary the list's own
  // Module filter uses (RBAC_MODULE_OPTIONS) — falls back to the raw key so
  // an unmapped module never silently disappears from the dropdown.
  private readonly moduleLabel = new Map(RBAC_MODULE_OPTIONS.map((m) => [m.value, m.label]));

  protected readonly moduleOptions = computed(() => (this.roleDefault()?.modules ?? []).map((m) => ({ value: m.module_key, label: this.moduleLabel.get(m.module_key) ?? m.module_key })));

  protected readonly screensForModule = computed<readonly MatrixScreen[]>(() => this.roleDefault()?.modules.find((m) => m.module_key === this.moduleKey)?.screens ?? []);

  private selectedScreen(): MatrixScreen | undefined {
    return this.screensForModule().find((s) => s.screen_key === this.screenKey);
  }

  protected readonly permissionOptions = computed<readonly PermissionOption[]>(() => {
    const screen = this.selectedScreen();
    if (!screen) return [];
    const opts: PermissionOption[] = [{ value: 'L1', label: 'Layer 1 — Screen Visibility (Visible / Hidden)' }];
    for (const a of screen.actions) opts.push({ value: `L2:${a.action_key}`, label: `Layer 2 — Action: ${a.label}` });
    for (const f of screen.fields) opts.push({ value: `L3:${f.field_key}`, label: `Layer 3 — Field: ${f.label}` });
    if (screen.has_scope) opts.push({ value: 'L4', label: 'Layer 4 — Scope: All / Team / Own' });
    return opts;
  });

  /** The role default this override departs from — read from the same
   * screen data the Permission dropdown itself was built from, so it's
   * always in sync with whichever Permission is currently selected. */
  protected readonly roleDefaultReference = computed(() => {
    const screen = this.selectedScreen();
    if (!screen || !this.permissionValue) return '—';
    if (this.permissionValue === 'L1' || this.permissionValue === 'L4') {
      return SCREEN_MODE_OPTIONS.find((o) => o.value === screen.mode)?.label ?? screen.mode;
    }
    if (this.permissionValue.startsWith('L2:')) {
      const key = this.permissionValue.slice(3);
      const action = screen.actions.find((a) => a.action_key === key);
      return action ? (action.allowed ? 'Allowed' : 'Denied') : '—';
    }
    if (this.permissionValue.startsWith('L3:')) {
      const key = this.permissionValue.slice(3);
      const field = screen.fields.find((f) => f.field_key === key);
      return field ? (FIELD_MODE_OPTIONS.find((o) => o.value === field.mode)?.label ?? field.mode) : '—';
    }
    return '—';
  });

  constructor() {
    this.http.get<{ id: string; first_name: string; last_name: string | null; user_id: string | null }[]>(`${environment.apiBaseUrl}/employees`).subscribe({
      next: (rows) => this.people.set(rows.filter((r) => r.user_id).map((r) => ({ user_id: r.user_id as string, name: `${r.first_name} ${r.last_name ?? ''}`.trim() }))),
      error: () => this.people.set([]),
    });
  }

  protected onEmployeeChange(): void {
    this.moduleKey = null;
    this.screenKey = null;
    this.permissionValue = null;
    this.roleDefault.set(null);
    if (!this.employeeId) return;
    this.http.get<RoleDefaultSummary>(`${environment.apiBaseUrl}/rbac/users/${this.employeeId}/role-default`).subscribe({
      next: (rd) => this.roleDefault.set(rd),
      error: (err) => this.formError.set(err?.error?.detail ?? "Failed to load this person's role default."),
    });
  }

  protected onModuleChange(): void {
    this.screenKey = null;
    this.permissionValue = null;
  }

  protected onScreenChange(): void {
    this.permissionValue = null;
  }

  private parsePermission(): { layer: string; action_key: string | null; field_key: string | null } | null {
    const v = this.permissionValue;
    if (!v) return null;
    if (v === 'L1' || v === 'L4') return { layer: v, action_key: null, field_key: null };
    if (v.startsWith('L2:')) return { layer: 'L2', action_key: v.slice(3), field_key: null };
    if (v.startsWith('L3:')) return { layer: 'L3', action_key: null, field_key: v.slice(3) };
    return null;
  }

  protected save(): void {
    const permission = this.parsePermission();
    if (!this.employeeId || !this.screenKey || !permission || !this.reason.trim()) {
      this.formError.set('Employee, Screen, Permission and Reason are all required.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const body = {
      user_id: this.employeeId,
      screen_key: this.screenKey,
      layer: permission.layer,
      action_key: permission.action_key,
      field_key: permission.field_key,
      override_value: this.overrideValue,
      reason: this.reason.trim(),
    };
    this.http.post(`${environment.apiBaseUrl}/rbac/overrides`, body).subscribe({
      next: () => this.router.navigate(['/rbac/overrides']),
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to save this override.');
      },
    });
  }

  protected back(): void {
    this.router.navigate(['/rbac/overrides']);
  }
}
