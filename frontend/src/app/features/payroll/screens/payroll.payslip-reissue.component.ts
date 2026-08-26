import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatMoney } from '../../../shared/screens/cell-format';
import { MONTH_NAMES, PayslipAdminRow, REISSUE_METHOD_OPTIONS, ReissueRequestBody } from '../payroll.api';

const SCREEN = 'payroll.payslips_admin';

/** §2.3 Reissue. Bespoke, not FormScreenConfig: that shape's updateEndpoint
 * always PUTs to a resource-identified URL — the real endpoint here is
 * `POST /payroll/payslips/{id}/reissue` (payslips.py:296), a different verb
 * to a sub-resource action URL, which FormScreenConfig cannot express.
 *
 * Loads the current payslip first so the 4 manual-figure inputs start from
 * its real current values (a sensible starting point for a correction, not
 * blank/zero) — shown only once Method is switched to MANUAL_ADJUSTMENT.
 */
@Component({
  selector: 'app-payroll-payslip-reissue',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          Reissue Payslip
          <span class="spec-ref">§2.3</span>
        </h1>
        @if (payslip(); as p) {
          <p class="page-sub">{{ p.employee_name_snapshot }} · {{ MONTH_NAMES[p.period_month] }} {{ p.period_year }} · Current Net Pay {{ formatMoney(p.net_pay) }}</p>
        }
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" (click)="cancel()">Back to Payslip</button>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this payslip</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      <div class="card">
        <div class="card-body">
          @if (formError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
          }
          @if (!canReissue()) {
            <p class="hint">You do not have permission to reissue payslips.</p>
          } @else {
            <div class="grid g-2">
              <div style="grid-column: span 2;">
                <div class="cell-sub">Reason<span style="color: var(--danger);" aria-hidden="true">*</span></div>
                <textarea class="input" rows="3" [(ngModel)]="reason" placeholder="Why this payslip is being corrected"></textarea>
                <div class="hint">
                  Required either way — whether the payslip is recalculated from updated attendance/leave data or specific figures are
                  adjusted manually. Recorded in Reissue History alongside Date, Reissued By, and the old figures next to the new.
                </div>
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Method</div>
                <select class="input" [(ngModel)]="method">
                  @for (opt of methodOptions; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }}</option>
                  }
                </select>
                <div class="hint">
                  Recalculated re-runs the same calculation Run Payroll itself uses for this period. Manual Adjustment lets you enter the
                  four headline figures directly.
                </div>
              </div>

              @if (method === 'MANUAL_ADJUSTMENT') {
                <div><div class="cell-sub">Gross Pay</div><input class="input" type="number" step="0.01" [(ngModel)]="manualGrossPay" /></div>
                <div><div class="cell-sub">Total Earnings</div><input class="input" type="number" step="0.01" [(ngModel)]="manualTotalEarnings" /></div>
                <div><div class="cell-sub">Total Deductions</div><input class="input" type="number" step="0.01" [(ngModel)]="manualTotalDeductions" /></div>
                <div><div class="cell-sub">Net Pay</div><input class="input" type="number" step="0.01" [(ngModel)]="manualNetPay" /></div>
              }
            </div>
          }
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="submitting()" (click)="cancel()">Cancel</button>
          @if (canReissue()) {
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">
              {{ submitting() ? 'Reissuing…' : 'Reissue' }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class PayrollPayslipReissueComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly policy = inject(PolicyStore);

  protected readonly MONTH_NAMES = MONTH_NAMES;
  protected readonly formatMoney = formatMoney;
  protected readonly methodOptions = REISSUE_METHOD_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly payslip = signal<PayslipAdminRow | null>(null);

  protected reason = '';
  protected method: 'RECALCULATED' | 'MANUAL_ADJUSTMENT' = 'RECALCULATED';
  protected manualGrossPay: number | null = null;
  protected manualTotalEarnings: number | null = null;
  protected manualTotalDeductions: number | null = null;
  protected manualNetPay: number | null = null;

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  private payslipId(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  ngOnInit(): void {
    const id = this.payslipId();
    if (!id) {
      this.loadError.set('No payslip id in the route.');
      this.isLoading.set(false);
      return;
    }
    this.http.get<PayslipAdminRow>(`${environment.apiBaseUrl}/payroll/payslips/${id}`).subscribe({
      next: (p) => {
        this.payslip.set(p);
        this.manualGrossPay = Number(p.gross_pay);
        this.manualTotalEarnings = Number(p.total_earnings);
        this.manualTotalDeductions = Number(p.total_deductions);
        this.manualNetPay = Number(p.net_pay);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err, 'Failed to load this payslip.'));
        this.isLoading.set(false);
      },
    });
  }

  protected canReissue(): boolean {
    return this.policy.can(SCREEN, 'reissue');
  }

  protected cancel(): void {
    this.router.navigate(['/payroll/payslips', this.payslipId()]);
  }

  protected submit(): void {
    if (!this.reason.trim()) {
      this.formError.set('A reason is required to reissue a payslip.');
      return;
    }
    const body: ReissueRequestBody = {
      reason: this.reason.trim(),
      reissue_method: this.method,
      manual_gross_pay: this.method === 'MANUAL_ADJUSTMENT' ? this.manualGrossPay : null,
      manual_net_pay: this.method === 'MANUAL_ADJUSTMENT' ? this.manualNetPay : null,
      manual_total_earnings: this.method === 'MANUAL_ADJUSTMENT' ? this.manualTotalEarnings : null,
      manual_total_deductions: this.method === 'MANUAL_ADJUSTMENT' ? this.manualTotalDeductions : null,
    };
    this.submitting.set(true);
    this.formError.set(null);
    this.http.post(`${environment.apiBaseUrl}/payroll/payslips/${this.payslipId()}/reissue`, body).subscribe({
      next: () => this.router.navigate(['/payroll/payslips', this.payslipId()]),
      error: (err) => {
        this.submitting.set(false);
        this.formError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown, fallback = 'Failed to reissue this payslip.'): string {
    const detail = (err as { error?: { detail?: unknown } } | null)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: unknown) => (d as { msg?: string })?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
