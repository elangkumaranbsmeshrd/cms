import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';
import { ADJUSTMENT_TYPE_OPTIONS, APPLIES_TO_COMPONENT_OPTIONS, APPLIES_TO_MODE_OPTIONS, AdhocAdjustmentCreateBody, AdhocAdjustmentRow } from '../payroll.api';
import { PayrollEmployeePickerComponent } from './payroll.employee-picker.component';

const SCREEN = 'payroll.adhoc_adjustments';
const EMPLOYEE_REF: RefLookup = { endpoint: '/employees/options', labelKey: 'label' };

/** §2.1a "+ Add Adjustment". Bespoke, not FormScreenConfig: the
 * MULTIPLE_EMPLOYEES mode needs the reusable live employee picker, which
 * FormScreenConfig's static-`staticOptions`-only 'checkgroup' field type
 * cannot express (see payroll.employee-picker.component.ts's own doc). No
 * "Effective Until" field — it exists on AdhocAdjustmentOut but no endpoint
 * ever writes it (dead), so it is deliberately not built here.
 */
@Component({
  selector: 'app-payroll-adhoc-adjustments-create',
  standalone: true,
  imports: [FormsModule, PayrollEmployeePickerComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          Add Ad-hoc Adjustment
          <span class="spec-ref">§2.1a</span>
        </h1>
        <p class="page-sub">A one-off or recurring addition/deduction applied to future payroll runs.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        @if (formError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
        }
        @if (!canEdit()) {
          <p class="hint">You do not have permission to add ad-hoc adjustments.</p>
        } @else {
          <div class="grid g-2">
            <div style="grid-column: span 2;">
              <div class="cell-sub">Applies To Mode<span style="color: var(--danger);" aria-hidden="true">*</span></div>
              <select class="input" [(ngModel)]="appliesToMode">
                @for (opt of appliesToModeOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
              <div class="hint">
                The bulk option covers a company-wide addition like a festival bonus everyone gets in the same month, so it does not have to
                be entered one person at a time.
              </div>
            </div>

            @if (appliesToMode === 'SINGLE_EMPLOYEE') {
              <div style="grid-column: span 2;">
                <div class="cell-sub">Employee<span style="color: var(--danger);" aria-hidden="true">*</span></div>
                <select class="input" [(ngModel)]="employeeId">
                  <option [ngValue]="null">—</option>
                  @for (opt of employeeOptions(); track opt.id) {
                    <option [ngValue]="opt.id">{{ opt.label }}</option>
                  }
                </select>
              </div>
            }
            @if (appliesToMode === 'MULTIPLE_EMPLOYEES') {
              <div style="grid-column: span 2;">
                <div class="cell-sub">Employees<span style="color: var(--danger);" aria-hidden="true">*</span></div>
                <app-payroll-employee-picker [selectedIds]="employeeIds" (selectionChange)="employeeIds = $event" />
              </div>
            }

            <div style="grid-column: span 2;">
              <div class="cell-sub">Label<span style="color: var(--danger);" aria-hidden="true">*</span></div>
              <input class="input" [(ngModel)]="form['label']" placeholder="e.g. Diwali Bonus" />
              <div class="hint">
                Free text — whatever this actually is. It prints on the employee payslip exactly as typed, never as a generic "Adjustment".
              </div>
            </div>

            <div>
              <div class="cell-sub">Type<span style="color: var(--danger);" aria-hidden="true">*</span></div>
              <select class="input" [(ngModel)]="form['adjustment_type']">
                @for (opt of adjustmentTypeOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Amount<span style="color: var(--danger);" aria-hidden="true">*</span></div>
              <input class="input" type="number" step="0.01" [(ngModel)]="form['amount']" />
              <div class="hint">Must be a positive number; Type above determines whether it adds to or subtracts from pay.</div>
            </div>

            <div>
              <div class="cell-sub">Taxable</div>
              <span class="toggle" [class.on]="!!form['is_taxable']" (click)="form['is_taxable'] = !form['is_taxable']">
                <span class="track"></span>
              </span>
              <div class="hint">Whether this amount counts as taxable income when an income-tax head computes its base.</div>
            </div>
            <div>
              <div class="cell-sub">Recurring</div>
              <span class="toggle" [class.on]="!!form['is_recurring']" (click)="form['is_recurring'] = !form['is_recurring']">
                <span class="track"></span>
              </span>
              <div class="hint">If Yes, applies to every payroll run from this one forward until removed. If No, applies once, to the next run only.</div>
            </div>

            <div>
              <div class="cell-sub">Applies To Component</div>
              <select class="input" [(ngModel)]="form['applies_to_component']">
                @for (opt of appliesToComponentOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>
            <div>
              <div class="cell-sub">Effective From</div>
              <input class="input" type="date" [(ngModel)]="form['effective_from']" />
              <div class="hint">Optional — defaults to today if left blank.</div>
            </div>

            <div style="grid-column: span 2;">
              <div class="cell-sub">Note</div>
              <textarea class="input" rows="3" [(ngModel)]="form['note']"></textarea>
              <div class="hint">Internal context only — never printed on the payslip.</div>
            </div>
          </div>
        }
      </div>
      <div class="card-foot">
        <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
        @if (canEdit()) {
          <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        }
      </div>
    </div>
  `,
})
export class PayrollAdhocAdjustmentsCreateComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly appliesToModeOptions = APPLIES_TO_MODE_OPTIONS;
  protected readonly adjustmentTypeOptions = ADJUSTMENT_TYPE_OPTIONS;
  protected readonly appliesToComponentOptions = APPLIES_TO_COMPONENT_OPTIONS;

  protected appliesToMode: 'SINGLE_EMPLOYEE' | 'MULTIPLE_EMPLOYEES' | 'ALL_ACTIVE_EMPLOYEES' = 'SINGLE_EMPLOYEE';
  protected employeeId: string | null = null;
  protected employeeIds: readonly string[] = [];
  protected form: Record<string, unknown> = {
    label: '',
    adjustment_type: 'ADDITION',
    amount: 0,
    is_taxable: true,
    is_recurring: false,
    applies_to_component: 'GROSS',
    note: '',
    effective_from: '',
  };

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected employeeOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(EMPLOYEE_REF) ?? [];
  }

  protected cancel(): void {
    this.router.navigate(['/payroll/adhoc-adjustments']);
  }

  protected save(): void {
    const label = String(this.form['label'] ?? '').trim();
    if (!label) {
      this.formError.set('Label is required.');
      return;
    }
    const amount = Number(this.form['amount']);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.formError.set('Amount must be a positive number.');
      return;
    }
    if (this.appliesToMode === 'SINGLE_EMPLOYEE' && !this.employeeId) {
      this.formError.set('Employee is required for Single Employee mode.');
      return;
    }
    if (this.appliesToMode === 'MULTIPLE_EMPLOYEES' && this.employeeIds.length === 0) {
      this.formError.set('Select at least one employee for Multiple Employees mode.');
      return;
    }

    const body: AdhocAdjustmentCreateBody = {
      applies_to_mode: this.appliesToMode,
      employee_id: this.appliesToMode === 'SINGLE_EMPLOYEE' ? this.employeeId : null,
      employee_ids: this.appliesToMode === 'MULTIPLE_EMPLOYEES' ? this.employeeIds : [],
      label,
      adjustment_type: String(this.form['adjustment_type']),
      amount,
      is_taxable: !!this.form['is_taxable'],
      is_recurring: !!this.form['is_recurring'],
      applies_to_component: String(this.form['applies_to_component']),
      note: this.form['note'] ? String(this.form['note']) : null,
      effective_from: this.form['effective_from'] ? String(this.form['effective_from']) : null,
    };

    this.saving.set(true);
    this.formError.set(null);
    this.http.post<AdhocAdjustmentRow>(`${environment.apiBaseUrl}/payroll/adhoc-adjustments`, body).subscribe({
      next: () => this.router.navigate(['/payroll/adhoc-adjustments']),
      error: (err) => {
        this.saving.set(false);
        this.formError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown, fallback = 'Failed to save this adjustment.'): string {
    const detail = (err as { error?: { detail?: unknown } } | null)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: unknown) => (d as { msg?: string })?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
