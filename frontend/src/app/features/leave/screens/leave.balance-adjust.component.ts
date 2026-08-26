import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { formatDate } from '../../../shared/screens/cell-format';

interface EmployeeOption {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string | null;
}
interface LeaveTypeOption {
  readonly id: string;
  readonly name: string;
}
interface LeaveBalanceRow {
  readonly id: string;
  readonly employee_id: string;
  readonly leave_type_id: string;
  readonly remaining_days: string;
}

// §2.3 Adjust Balance — bespoke: l.adjust (prototype/app-forms.js) shows
// Employee/Leave Type/Current Remaining as context alongside the amount,
// plus a live New Remaining preview before saving — richer than
// RowActionDef's single no-body POST (or a window.prompt chain) can
// express, same reasoning as leave.carry-forward.component.ts's own bespoke
// page. Reached via leave.balance-management.list.config.ts's rowRoute.
//
// No GET /leave-balances/{id} exists — only the list GET — so this fetches
// the full list (same size class already accepted by
// leave-carry-forward.component.ts's own full /employees fetch) and finds
// the one row by id, same as employeeName()/leaveTypeName() below mirror
// that component's own manual-fetch style rather than RefDataService (whose
// label() only resolves a single field — first_name alone would drop the
// surname this form needs to show in full).
@Component({
  selector: 'app-leave-balance-adjust',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Adjust Balance</h1>
        <p class="page-sub">Every adjustment requires a reason and is logged to Adjustment History.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (!balance()) {
      <div class="empty"><p>This leave balance could not be found.</p></div>
    } @else {
      <div class="card" style="max-width: 640px;">
        <div class="card-body">
          @if (formError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
          }
          <div class="grid g-2" style="margin-bottom: 12px;">
            <div><div class="cell-sub">Employee</div><div class="cell-strong">{{ employeeName() }}</div></div>
            <div><div class="cell-sub">Leave Type</div><div class="cell-strong">{{ leaveTypeName() }}</div></div>
            <div><div class="cell-sub">Current Remaining</div><div class="mono">{{ balance()!.remaining_days }}</div></div>
            <div></div>
            <div>
              <div class="cell-sub">Adjustment Amount</div>
              <input class="input" type="number" step="0.5" placeholder="e.g. 5 or -2" [(ngModel)]="adjustmentAmount" />
              <div class="hint">Positive to grant extra days, negative to correct an over-grant.</div>
            </div>
            <div>
              <div class="cell-sub">New Remaining</div>
              <div class="mono cell-strong">{{ newRemaining() }}</div>
              <div class="hint">Current Remaining + Adjustment Amount — previewed before saving.</div>
            </div>
            <div style="grid-column: span 2;">
              <div class="cell-sub">Reason / Note</div>
              <textarea class="input" rows="2" placeholder="e.g. Pro-rated first-year allowance / Correcting duplicate grant" [(ngModel)]="reason"></textarea>
            </div>
            <div><div class="cell-sub">Adjusted By</div><div>{{ adjustedBy() }}</div></div>
            <div><div class="cell-sub">Date</div><div class="mono">{{ today() }}</div></div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="submitting()" (click)="cancel()">Cancel</button>
          @if (canAdjust()) {
            <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">
              {{ submitting() ? 'Saving…' : 'Save' }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class LeaveBalanceAdjustComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly balance = signal<LeaveBalanceRow | null>(null);
  private employees: readonly EmployeeOption[] = [];
  private leaveTypes: readonly LeaveTypeOption[] = [];

  protected adjustmentAmount: number | null = null;
  protected reason = '';

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.http.get<EmployeeOption[]>(`${environment.apiBaseUrl}/employees`).subscribe({
      next: (rows) => (this.employees = rows),
      error: () => (this.employees = []),
    });
    this.http.get<LeaveTypeOption[]>(`${environment.apiBaseUrl}/masters/leave-types`).subscribe({
      next: (rows) => (this.leaveTypes = rows),
      error: () => (this.leaveTypes = []),
    });
    this.http.get<LeaveBalanceRow[]>(`${environment.apiBaseUrl}/leave-balances`).subscribe({
      next: (rows) => {
        this.balance.set(rows.find((b) => b.id === id) ?? null);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected canAdjust(): boolean {
    return this.policy.can('leave.balance_management', 'adjust');
  }

  protected employeeName(): string {
    const b = this.balance();
    const e = b && this.employees.find((x) => x.id === b.employee_id);
    return e ? `${e.first_name} ${e.last_name ?? ''}`.trim() : (b?.employee_id ?? '—');
  }

  protected leaveTypeName(): string {
    const b = this.balance();
    return (b && this.leaveTypes.find((t) => t.id === b.leave_type_id)?.name) ?? (b?.leave_type_id ?? '—');
  }

  // A plain method, not `computed()`: adjustmentAmount is an ordinary
  // ngModel-bound property, not a signal, so a computed() would never see it
  // change and would go stale after the first keystroke — this re-derives
  // the preview fresh on every template read instead (same reasoning as
  // my-leave.component.ts's own filteredRequests()).
  protected newRemaining(): string {
    const b = this.balance();
    if (!b) return '—';
    const amount = this.adjustmentAmount;
    if (amount === null || amount === undefined || Number.isNaN(amount)) return b.remaining_days;
    return (Number(b.remaining_days) + Number(amount)).toString();
  }

  protected adjustedBy(): string {
    return this.session.user()?.fullName ?? '—';
  }

  protected today(): string {
    return formatDate(new Date().toISOString());
  }

  protected cancel(): void {
    this.router.navigate(['/leave/balances']);
  }

  protected submit(): void {
    const b = this.balance();
    if (!b || this.adjustmentAmount === null || this.adjustmentAmount === undefined || !this.reason.trim()) {
      this.formError.set('Adjustment Amount and Reason / Note are both required.');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    this.http
      .post(`${environment.apiBaseUrl}/leave-balances/adjustments`, {
        leave_balance_id: b.id,
        adjustment_days: this.adjustmentAmount,
        reason: this.reason.trim(),
      })
      .subscribe({
        next: () => this.router.navigate(['/leave/balances']),
        error: (err) => {
          this.submitting.set(false);
          const detail = err?.error?.detail;
          this.formError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to save this adjustment.');
        },
      });
  }
}
