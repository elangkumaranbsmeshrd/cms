import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { IconComponent } from '../../../shared/ui/icon.component';
import { MatrixScreenComponent } from '../../../shared/screens/matrix-screen/matrix-screen.component';
import { MatrixScreenConfig } from '../../../shared/screens/screen.types';
import { buildRbacMatrixConfig, MatrixModuleRow } from './rbac.permission-matrix.config';

interface ToggleRow {
  toggle_key: string;
  module_key: string;
  label: string;
  enabled: boolean;
  numeric_value: number | null;
}

// Name-matched, not module-matched: today only Expense §6.1's "Set an Auto-
// Approval Threshold" needs a companion number (feature_toggles.numeric_value
// backend/app/models/rbac.py), but the admin panel has no other way to know
// which of the ~47 toggles need one, so this is the one place that decides.
const NUMERIC_VALUE_TOGGLES = new Set<string>(['Set an Auto-Approval Threshold']);

// Same module_key -> {label, specRef} grouping as the matrix grid itself
// (rbac.permission-matrix.config.ts's MODULE_META), duplicated as a small
// local lookup rather than imported, since toggles group by the RAW
// module_key ("leave"/"payroll" stay separate keys here — TOGGLE_DEFAULTS,
// app/rbac/toggles.py, never merges them the way the matrix grid's display
// grouping does) and this component only needs label+specRef, not the
// full MODULE_META/sourceKeys machinery mapGroups() uses.
const TOGGLE_MODULE_LABELS: Record<string, { label: string; specRef: string }> = {
  employee: { label: 'Employee', specRef: 'Module 2' },
  leave: { label: 'Leave & Payroll', specRef: 'Modules 5 & 6' },
  payroll: { label: 'Leave & Payroll', specRef: 'Modules 5 & 6' },
  asset: { label: 'Asset Management', specRef: 'Module 3' },
  ticket: { label: 'Ticket', specRef: 'Module 4' },
  project: { label: 'Project', specRef: 'Module 10' },
  opportunity: { label: 'Opportunity', specRef: 'Module 9' },
  customer: { label: 'Customer', specRef: 'Module 8' },
  invoice: { label: 'Invoice', specRef: 'Module 11' },
  expense: { label: 'Expense', specRef: 'Module 12' },
  purchase_bill: { label: 'Purchase Bill', specRef: 'Module 13' },
  compliance: { label: 'Tax & Compliance', specRef: 'Module 15' },
  vendor: { label: 'Vendor', specRef: 'Module 7' },
  masters: { label: 'Masters', specRef: 'Module 1' },
};

interface ToggleGroup {
  key: string;
  label: string;
  specRef: string;
  toggles: ToggleRow[];
}

/** §4.2 Role Permission Matrix. The per-role screen/action/field grid is the
 * generic 'matrix' shape (matrix-screen.component.ts, built exactly for
 * this screen — see MatrixScreenConfig's own header comment — but never
 * actually wired to a real config until now). What that shared shell does
 * NOT model is RBAC §2.1's ~47 FEATURE TOGGLES: module-level policy flags
 * ("Allow Manager to Run Payroll") that are NOT scoped to one role or one
 * screen field, so they can't be expressed as a MatrixItem.fields entry —
 * GET/PUT /rbac/toggles is a deliberately separate, role-independent
 * endpoint (rbac_admin.py's own comment: "a toggle only ever exists to
 * change what the Matrix's own rows mean at resolve time"). This wrapper
 * therefore renders the shared grid for the real per-role matrix, then its
 * own toggles panel (grouped per module, .matrix-mod/.mfield styling to
 * match) below it — plus the prototype's own trailing "Roles & Access"
 * self-block (app-screens2.js:1344-1357) for the one toggle §8 defines
 * about this module itself, since the registry's 4 "rbac"-module screens
 * are deliberately excluded from the configurable grid above (see
 * rbac.permission-matrix.config.ts's own comment on MODULE_META).
 */
@Component({
  selector: 'app-rbac-matrix',
  standalone: true,
  imports: [FormsModule, IconComponent, MatrixScreenComponent],
  template: `
    <app-matrix-screen [config]="matrixConfig" />

    @if (toggleGroups().length) {
      <div class="page-head" style="margin-top: 4px;">
        <div>
          <h2 class="page-title" style="font-size: 15px;">Feature Toggles</h2>
          <p class="page-sub">RBAC §2.1's named policy flags — platform-wide, not scoped to the role selected above.</p>
        </div>
      </div>

      @if (toggleError()) {
        <div class="form-error" style="margin: 0 0 12px;">{{ toggleError() }}</div>
      }

      @for (group of toggleGroups(); track group.key) {
        <div class="matrix-mod" [class.open]="isToggleGroupOpen(group.key)">
          <div class="matrix-head" role="button" (click)="toggleToggleGroup(group.key)">
            <span class="chev"><app-icon name="arrow" [size]="13" [width]="2.4" /></span>
            <h4>{{ group.label }}</h4>
            <span class="spec-ref">{{ group.specRef }}</span>
            <span class="meta">{{ group.toggles.length }} toggle{{ group.toggles.length === 1 ? '' : 's' }}</span>
          </div>
          @if (isToggleGroupOpen(group.key)) {
            <div class="matrix-body">
              <div class="mscreen" style="background: var(--surface-sunk);">
                <div class="mscreen-top">
                  <span class="nm" style="color: var(--text-tertiary); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; min-width: 0;">
                    Field &amp; behaviour toggles
                  </span>
                </div>
                <div class="mactions" style="border-top: none; padding-top: 4px;">
                  @for (t of group.toggles; track t.toggle_key) {
                    <span class="mfield" [class.on]="t.enabled" role="button" [title]="t.label + ': click to toggle'" (click)="toggleFeature(t)">
                      <span class="bx">
                        @if (t.enabled) {
                          <app-icon name="check" [size]="9" [width]="3.4" />
                        }
                      </span>
                      {{ t.label }}
                    </span>
                    @if (needsNumericValue(t)) {
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        class="input"
                        style="width: 90px; height: 26px; padding: 2px 8px; font-size: 12px; margin: 0 4px 6px -2px;"
                        placeholder="amount"
                        title="{{ t.label }}: threshold amount"
                        [value]="t.numeric_value ?? ''"
                        [disabled]="!t.enabled"
                        (click)="$event.stopPropagation()"
                        (change)="setNumericValue(t, $event)"
                      />
                    }
                  }
                </div>
              </div>
            </div>
          }
        </div>
      }
    }

    <!-- Prototype's selfBlock (app-screens2.js:1344-1357): the RBAC module's
         own one toggle (§8), rendered outside the configurable grid — "the
         four RBAC screens themselves are not listed for configuration: only
         Super Admin can open this module at all, and for every other role
         it is invisible... it simply does not exist (§1)." -->
    @if (rbacSelfToggles().length) {
      <div class="matrix-mod open">
        <div class="matrix-head" style="cursor: default;">
          <h4>Roles &amp; Access</h4>
          <span class="spec-ref">§8</span>
          <span class="meta">not itself configurable · {{ rbacSelfToggles().length }} toggle{{ rbacSelfToggles().length === 1 ? '' : 's' }}</span>
        </div>
        <div class="matrix-body">
          <div class="mscreen" style="background: var(--surface-sunk);">
            <div class="mscreen-top">
              <span class="nm" style="color: var(--text-tertiary); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; min-width: 0;">
                Field &amp; behaviour toggles
              </span>
            </div>
            <div class="mactions" style="border-top: none; padding-top: 4px;">
              @for (t of rbacSelfToggles(); track t.toggle_key) {
                <span class="mfield" [class.on]="t.enabled" role="button" [title]="t.label + ': click to toggle'" (click)="toggleFeature(t)">
                  <span class="bx">
                    @if (t.enabled) {
                      <app-icon name="check" [size]="9" [width]="3.4" />
                    }
                  </span>
                  {{ t.label }}
                </span>
                @if (needsNumericValue(t)) {
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    class="input"
                    style="width: 90px; height: 26px; padding: 2px 8px; font-size: 12px; margin: 0 4px 6px -2px;"
                    placeholder="amount"
                    title="{{ t.label }}: threshold amount"
                    [value]="t.numeric_value ?? ''"
                    [disabled]="!t.enabled"
                    (click)="$event.stopPropagation()"
                    (change)="setNumericValue(t, $event)"
                  />
                }
              }
            </div>
          </div>
          <div style="padding: 10px 13px; font-size: 11.5px; color: var(--text-tertiary); line-height: 1.5;">
            The four RBAC screens themselves are not listed for configuration: only Super Admin can open this module at all, and for every other role it is invisible — not read-only, not partial, it simply does not exist (§1).
          </div>
        </div>
      </div>
    }
  `,
})
export class RbacMatrixComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected readonly matrixConfig: MatrixScreenConfig<MatrixModuleRow> = buildRbacMatrixConfig(this.route.snapshot.paramMap.get('roleCode') ?? 'EMPLOYEE');

  protected readonly toggleError = signal<string | null>(null);
  private readonly allToggles = signal<readonly ToggleRow[]>([]);
  private readonly toggleExpanded = signal<ReadonlySet<string>>(new Set());

  protected readonly toggleGroups = signal<readonly ToggleGroup[]>([]);
  protected readonly rbacSelfToggles = signal<readonly ToggleRow[]>([]);

  constructor() {
    this.loadToggles();
  }

  private loadToggles(): void {
    this.http.get<ToggleRow[]>(`${environment.apiBaseUrl}/rbac/toggles`).subscribe({
      next: (rows) => {
        this.allToggles.set(rows);
        this.rbacSelfToggles.set(rows.filter((t) => t.module_key === 'rbac'));

        const byModule = new Map<string, ToggleRow[]>();
        for (const t of rows) {
          if (t.module_key === 'rbac') continue;
          const list = byModule.get(t.module_key) ?? [];
          list.push(t);
          byModule.set(t.module_key, list);
        }
        // One group per distinct DISPLAY label (merges leave+payroll's own
        // toggles under the same "Leave & Payroll" heading the matrix grid
        // above uses), built in TOGGLE_MODULE_LABELS's own key order so a
        // module with zero toggles today just never produces a group,
        // rather than a hand-maintained ordering array going stale.
        const groups = new Map<string, ToggleGroup>();
        for (const key of Object.keys(TOGGLE_MODULE_LABELS)) {
          const toggles = byModule.get(key);
          if (!toggles?.length) continue;
          const meta = TOGGLE_MODULE_LABELS[key];
          const existing = groups.get(meta.label);
          if (existing) existing.toggles.push(...toggles);
          else groups.set(meta.label, { key: meta.label, label: meta.label, specRef: meta.specRef, toggles: [...toggles] });
        }
        this.toggleGroups.set([...groups.values()]);
      },
      error: (err) => this.toggleError.set(err?.error?.detail ?? 'Failed to load feature toggles.'),
    });
  }

  protected isToggleGroupOpen(key: string): boolean {
    return this.toggleExpanded().has(key);
  }

  protected toggleToggleGroup(key: string): void {
    this.toggleExpanded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected toggleFeature(toggle: ToggleRow): void {
    const next = !toggle.enabled;
    this.http.put<ToggleRow[]>(`${environment.apiBaseUrl}/rbac/toggles`, { changes: [{ toggle_key: toggle.toggle_key, enabled: next }] }).subscribe({
      next: () => {
        toggle.enabled = next;
        // Re-derive the grouped view/self-toggles from the mutated flat
        // list so the chip's [class.on] picks up the change immediately —
        // the row objects inside toggleGroups()/rbacSelfToggles() are the
        // SAME references as allToggles()'s (never cloned above), so
        // mutating `toggle` in place is enough; re-set the signals only to
        // trigger change detection on the arrays that hold them.
        this.toggleGroups.update((groups) => groups.map((g) => ({ ...g })));
        this.rbacSelfToggles.update((rows) => [...rows]);
      },
      error: (err) => this.toggleError.set(err?.error?.detail ?? 'Failed to update this toggle.'),
    });
  }

  protected needsNumericValue(toggle: ToggleRow): boolean {
    return NUMERIC_VALUE_TOGGLES.has(toggle.toggle_key);
  }

  protected setNumericValue(toggle: ToggleRow, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && Number.isNaN(next)) return;
    if (next === toggle.numeric_value) return;
    this.http.put<ToggleRow[]>(`${environment.apiBaseUrl}/rbac/toggles`, { changes: [{ toggle_key: toggle.toggle_key, enabled: toggle.enabled, numeric_value: next }] }).subscribe({
      next: () => {
        toggle.numeric_value = next;
        this.toggleGroups.update((groups) => groups.map((g) => ({ ...g })));
        this.rbacSelfToggles.update((rows) => [...rows]);
      },
      error: (err) => this.toggleError.set(err?.error?.detail ?? 'Failed to update this threshold.'),
    });
  }
}
