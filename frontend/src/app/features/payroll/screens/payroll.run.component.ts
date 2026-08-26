import { HttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { badgeClass, formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';
import { EMPLOYEE_SELECTION_MODE_OPTIONS, INCLUSION_STATUS_OPTIONS, MONTH_NAMES, PayrollRunCreateBody, PayrollRunRow, periodLabel } from '../payroll.api';
import { PayrollEmployeePickerComponent } from './payroll.employee-picker.component';

const SCREEN = 'payroll.run';
const EMPLOYEE_REF: RefLookup = { endpoint: '/employees', labelKey: 'first_name' };

/** §2.1 Run Payroll — one bespoke component behind two routes,
 * /payroll/run/new (Stage 1: pick Month/Year/Selection/Working-Days-Override)
 * and /payroll/run/:id (Stage 2: Preview + Recalculate/Discard/Confirm, or a
 * read-only Processed record). A single ListScreenConfig/FormScreenConfig
 * cannot model this: Stage 1 is a one-shot create form with no list behind
 * it, and Stage 2 is a live preview table plus three dedicated no-body POST
 * actions with different RBAC actions from each other ('run' vs 'confirm')
 * — genuinely its own shape, matching this codebase's established "bespoke
 * component, not a distorted generic type" house convention.
 *
 * On a successful Stage 1 submit, the POST response is the FULL run object —
 * Stage 2 renders directly from it with no extra round-trip. The URL is
 * still updated to /payroll/run/{id} via Location.replaceState (not
 * router.navigate): /payroll/run/new and /payroll/run/:id are two distinct
 * Route configs, so a real navigation between them would destroy and
 * recreate this component, discarding the just-rendered state and forcing a
 * redundant GET — replaceState gives the run a real, shareable, refreshable
 * URL without that.
 */
@Component({
  selector: 'app-payroll-run',
  standalone: true,
  imports: [FormsModule, PayrollEmployeePickerComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          Run Payroll
          <span class="spec-ref">§2.1</span>
        </h1>
        <p class="page-sub">Calculate a draft payroll run, review it, then Confirm to generate real payslips.</p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" (click)="backToHistory()">Back to History</button>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this payroll run</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (run(); as r) {
        <!-- ================================ STAGE 2 — Preview / Result ================================ -->
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head">
            <h3>
              {{ periodLabel(r.period_month, r.period_year) }}
              <span class="badge-s {{ badgeCls(r.status) }}" style="margin-left: 8px;">{{ humanize(r.status) }}</span>
            </h3>
          </div>
          <div class="card-body">
            <div class="grid g-4">
              <div><div class="cell-sub">Pay Period Covers</div><div>{{ formatDate(r.pay_period_start) }} to {{ formatDate(r.pay_period_end) }}</div></div>
              <div><div class="cell-sub">Salary Credit Date</div><div>{{ formatDate(r.salary_credit_date) }}</div></div>
              <div>
                <div class="cell-sub">Working Days (effective)</div>
                <div>
                  {{ r.working_days_effective }}
                  @if (r.working_days_override) {
                    <span class="cell-sub">(override — auto was {{ r.working_days_auto }})</span>
                  }
                </div>
              </div>
              <div><div class="cell-sub">Employee Selection</div><div>{{ selectionModeLabel(r.employee_selection_mode) }}</div></div>
              <div><div class="cell-sub">Employee Count</div><div>{{ r.employee_count }}</div></div>
              <div><div class="cell-sub">Total Gross</div><div class="cell-strong">{{ formatMoney(r.total_gross) }}</div></div>
              <div><div class="cell-sub">Total Deductions</div><div class="cell-strong">{{ formatMoney(r.total_employee_deductions) }}</div></div>
              <div><div class="cell-sub">Total Net</div><div class="cell-strong">{{ formatMoney(r.total_net) }}</div></div>
            </div>
            @if (r.work_week_policy_note) {
              <p class="hint" style="margin: 0;">{{ r.work_week_policy_note }}</p>
            }
          </div>
        </div>

        @if (actionError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
        }

        @if (r.status === 'DRAFT') {
          <div class="card" style="margin-bottom: 16px;">
            <div class="card-body" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              @if (canRun()) {
                <button class="btn ghost" type="button" [disabled]="!!actionBusy()" (click)="recalculate(r.id)">
                  {{ actionBusy() === 'recalculate' ? 'Recalculating…' : 'Recalculate' }}
                </button>
                <button class="btn ghost" type="button" [disabled]="!!actionBusy()" (click)="discard(r.id)">
                  {{ actionBusy() === 'discard' ? 'Discarding…' : 'Discard' }}
                </button>
              }
              @if (canConfirm()) {
                <button class="btn primary" type="button" [disabled]="!!actionBusy()" (click)="confirm(r.id)">
                  {{ actionBusy() === 'confirm' ? 'Confirming…' : 'Confirm — Generate Payslips' }}
                </button>
              }
              <span class="hint" style="flex-basis: 100%;">
                Recalculate re-runs the calculation for this SAME period and employee set (picks up corrected attendance, for example) — it
                cannot change Month, Year, Selection, or Working Days Override; Discard and start a new run for that. Confirm is
                <b>irreversible</b>: it generates real payslips and emails every included employee.
              </span>
            </div>
          </div>
        } @else {
          <p class="hint" style="margin-bottom: 16px;">This run is Processed — a permanent record. Nothing on it can be changed here.</p>
        }

        <div class="card">
          <div class="card-head">
            <h3>Preview</h3>
            <span class="sub">{{ r.employees.length }} employee(s)</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Inclusion</th>
                  <th class="r">Gross Pay</th>
                  <th class="r">Unpaid Leave Ded.</th>
                  <th class="r">LOP Ded.</th>
                  <th class="r">Employee Statutory</th>
                  <th class="r">Income Tax</th>
                  <th class="r">Insurance (Employee)</th>
                  <th class="r">Ad-hoc Additions</th>
                  <th class="r">Ad-hoc Subtractions</th>
                  <th class="r">Total Deductions</th>
                  <th class="r">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                @for (row of r.employees; track row.id) {
                  <tr>
                    <td class="cell-strong">{{ employeeName(row.employee_id) }}</td>
                    <td><span class="badge-s {{ badgeCls(row.status) }}">{{ humanize(row.status) }}</span></td>
                    <td>
                      <span class="badge-s {{ inclusionBadgeClass(row.inclusion_status) }}">{{ inclusionLabel(row.inclusion_status) }}</span>
                      @if (row.skip_reason) {
                        <div class="cell-sub">{{ row.skip_reason }}</div>
                      }
                    </td>
                    <td class="mono r">{{ formatMoney(row.gross_pay) }}</td>
                    <td class="mono r">{{ formatMoney(row.unpaid_leave_deduction) }}</td>
                    <td class="mono r">{{ formatMoney(row.lop_deduction) }}</td>
                    <td class="mono r">{{ formatMoney(row.total_employee_statutory) }}</td>
                    <td class="mono r">{{ formatMoney(row.income_tax_amount) }}</td>
                    <td class="mono r">{{ formatMoney(row.insurance_employee_contribution) }}</td>
                    <td class="mono r">{{ formatMoney(row.adhoc_addition_total) }}</td>
                    <td class="mono r">{{ formatMoney(row.adhoc_subtraction_total) }}</td>
                    <td class="mono r cell-strong">{{ formatMoney(row.total_deductions) }}</td>
                    <td class="mono r cell-strong">{{ formatMoney(row.net_pay) }}</td>
                  </tr>
                }
                @if (!r.employees.length) {
                  <tr><td colspan="13" class="cell-sub">No employees in this run.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <!-- ================================ STAGE 1 — New Run ================================ -->
        <div class="card">
          <div class="card-head"><h3>New Payroll Run</h3></div>
          <div class="card-body">
            @if (formError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
            }
            @if (!canRun()) {
              <p class="hint">You do not have permission to run payroll.</p>
            } @else {
              <div class="grid g-2">
                <div>
                  <div class="cell-sub">Month</div>
                  <select class="input" [(ngModel)]="periodMonth">
                    @for (m of monthOptions; track m.value) {
                      <option [ngValue]="m.value">{{ m.label }}</option>
                    }
                  </select>
                </div>
                <div>
                  <div class="cell-sub">Year</div>
                  <input class="input" type="number" [(ngModel)]="periodYear" />
                </div>
                <div style="grid-column: span 2;">
                  <div class="cell-sub">Employee Selection Mode</div>
                  <select class="input" [(ngModel)]="selectionMode">
                    @for (opt of selectionModeOptions; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </select>
                </div>
                @if (selectionMode === 'SPECIFIC_EMPLOYEES') {
                  <div style="grid-column: span 2;">
                    <div class="cell-sub">Employees</div>
                    <app-payroll-employee-picker [selectedIds]="employeeIds" (selectionChange)="employeeIds = $event" />
                  </div>
                }
                <div style="grid-column: span 2;">
                  <div class="cell-sub">Working Days Override (optional)</div>
                  <input class="input" type="number" step="0.5" [(ngModel)]="workingDaysOverride" placeholder="Leave blank to use the auto-calculated value" />
                  <div class="hint">
                    Entered blind — there is no way to preview the auto-calculated working days before you submit. Leave this blank unless
                    you are certain an override is needed; if the auto value would have been correct, Discard the resulting draft and start
                    over.
                  </div>
                </div>
                <div style="grid-column: span 2;">
                  <div class="cell-sub">Payroll Basis</div>
                  <div>Hour-Basis</div>
                  <div class="hint">
                    Reads Attendance &amp; Time Basis (§2.4) — required hours from the work-week policy, worked hours from check-in/check-out.
                    See that screen for the full reconciliation.
                  </div>
                </div>
              </div>
            }
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="submitting()" (click)="backToHistory()">Cancel</button>
            @if (canRun()) {
              <button class="btn primary" type="button" [disabled]="submitting()" (click)="submitStage1()">
                {{ submitting() ? 'Starting…' : 'Start Run' }}
              </button>
            }
          </div>
        </div>
      }
    }
  `,
})
export class PayrollRunComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly run = signal<PayrollRunRow | null>(null);

  // ---- Stage 1 form state -------------------------------------------------
  protected readonly monthOptions = MONTH_NAMES.slice(1).map((label, i) => ({ value: i + 1, label }));
  protected readonly selectionModeOptions = EMPLOYEE_SELECTION_MODE_OPTIONS;
  protected periodMonth = new Date().getMonth() + 1;
  protected periodYear = new Date().getFullYear();
  protected selectionMode: 'ALL_ACTIVE' | 'SPECIFIC_EMPLOYEES' = 'ALL_ACTIVE';
  protected employeeIds: readonly string[] = [];
  protected workingDaysOverride: number | null = null;
  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  // ---- Stage 2 action state ------------------------------------------------
  protected readonly actionBusy = signal<'recalculate' | 'discard' | 'confirm' | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly formatMoney = formatMoney;
  protected readonly formatDate = formatDate;
  protected readonly periodLabel = periodLabel;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return; // /payroll/run/new — Stage 1, nothing to load
    this.isLoading.set(true);
    this.http.get<PayrollRunRow>(`${environment.apiBaseUrl}/payroll/runs/${id}`).subscribe({
      next: (r) => {
        this.run.set(r);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err, 'Failed to load this payroll run.'));
        this.isLoading.set(false);
      },
    });
  }

  protected canRun(): boolean {
    return this.policy.can(SCREEN, 'run');
  }

  protected canConfirm(): boolean {
    return this.policy.can(SCREEN, 'confirm');
  }

  protected employeeName(id: string): string {
    return this.refData.label(EMPLOYEE_REF, id);
  }

  protected humanize(value: string): string {
    return humanizeEnum(value);
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected inclusionLabel(status: string): string {
    return INCLUSION_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? humanizeEnum(status);
  }

  protected inclusionBadgeClass(status: string): string {
    if (status === 'INCLUDED') return 'b-ok';
    if (status === 'SKIPPED_ALREADY_PROCESSED') return 'b-info';
    return 'b-warn'; // EXCLUDED_NO_SALARY_STRUCTURE | EXCLUDED_NOT_ACTIVE
  }

  protected selectionModeLabel(mode: string): string {
    return EMPLOYEE_SELECTION_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? humanizeEnum(mode);
  }

  protected backToHistory(): void {
    this.router.navigate(['/payroll/run']);
  }

  protected submitStage1(): void {
    if (!this.periodMonth || this.periodMonth < 1 || this.periodMonth > 12 || !this.periodYear) {
      this.formError.set('Month and Year are required.');
      return;
    }
    if (this.selectionMode === 'SPECIFIC_EMPLOYEES' && this.employeeIds.length === 0) {
      this.formError.set('Select at least one employee for Specific Employees mode.');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    const body: PayrollRunCreateBody = {
      period_month: this.periodMonth,
      period_year: this.periodYear,
      employee_selection_mode: this.selectionMode,
      employee_ids: this.selectionMode === 'SPECIFIC_EMPLOYEES' ? this.employeeIds : [],
      working_days_override: this.workingDaysOverride,
    };
    this.http.post<PayrollRunRow>(`${environment.apiBaseUrl}/payroll/runs`, body).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.run.set(response);
        // Gives the new run a real, shareable, refreshable URL without a
        // second round-trip — see this component's own header comment.
        this.location.replaceState(`/payroll/run/${response.id}`);
      },
      error: (err) => {
        this.submitting.set(false);
        this.formError.set(this.formatError(err));
      },
    });
  }

  protected recalculate(id: string): void {
    this.actionBusy.set('recalculate');
    this.actionError.set(null);
    this.http.post<PayrollRunRow>(`${environment.apiBaseUrl}/payroll/runs/${id}/recalculate`, {}).subscribe({
      next: (r) => {
        this.actionBusy.set(null);
        this.run.set(r);
      },
      error: (err) => {
        this.actionBusy.set(null);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  protected discard(id: string): void {
    if (!window.confirm('Discard this draft payroll run? This cannot be undone.')) return;
    this.actionBusy.set('discard');
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/payroll/runs/${id}/discard`, {}).subscribe({
      next: () => this.router.navigate(['/payroll/run']),
      error: (err) => {
        this.actionBusy.set(null);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  protected confirm(id: string): void {
    if (!window.confirm('Confirm this payroll run? This is IRREVERSIBLE — it will generate real payslips and email every included employee.')) return;
    this.actionBusy.set('confirm');
    this.actionError.set(null);
    this.http.post<PayrollRunRow>(`${environment.apiBaseUrl}/payroll/runs/${id}/confirm`, {}).subscribe({
      next: (r) => {
        this.actionBusy.set(null);
        this.run.set(r);
      },
      error: (err) => {
        this.actionBusy.set(null);
        this.actionError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown, fallback = 'That action failed.'): string {
    const detail = (err as { error?: { detail?: unknown } } | null)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: unknown) => (d as { msg?: string })?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
