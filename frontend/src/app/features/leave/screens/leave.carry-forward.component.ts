import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';

interface FinancialYearOption {
  readonly id: string;
  readonly label: string;
}
interface EmployeeOption {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string | null;
}
interface LeaveTypeOption {
  readonly id: string;
  readonly name: string;
}
interface CarryForwardLine {
  readonly id: string;
  readonly employee_id: string;
  readonly leave_type_id: string;
  readonly remaining_days_at_run: string;
  readonly days_carried_forward: string;
  readonly days_lapsed: string;
  readonly max_carry_forward_days_snapshot: string | null;
}
interface CarryForwardRun {
  readonly id: string;
  readonly from_financial_year_id: string;
  readonly to_financial_year_id: string;
  readonly status: string; // PREVIEW | COMMITTED | CANCELLED
  readonly employee_count: number;
  readonly line_count: number;
  readonly total_days_carried: string;
  readonly total_days_lapsed: string;
  readonly lines: readonly CarryForwardLine[];
}

// §2.3b Carry Forward Run — bespoke: no GET/list endpoint exists at all for
// a CarryForwardRunOut (leave_balance.py), so the full Preview response
// lives only in this component's own state for the rest of the session —
// unrecoverable if the user navigates away before Commit, matching the
// backend's own one-shot design rather than working around it.
@Component({
  selector: 'app-leave-carry-forward',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Carry Forward Run</h1>
        <p class="page-sub">Preview, then commit, the year-end leave carry-forward for every eligible balance.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom: 16px;">
      <div class="card-body">
        @if (formError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
        }
        <div class="grid g-2">
          <div>
            <div class="cell-sub">From Financial Year</div>
            <select class="input" [(ngModel)]="fromFyId" [disabled]="!!run()">
              <option [value]="null">—</option>
              @for (fy of financialYears(); track fy.id) {
                <option [value]="fy.id">{{ fy.label }}</option>
              }
            </select>
          </div>
          <div>
            <div class="cell-sub">To Financial Year</div>
            <select class="input" [(ngModel)]="toFyId" [disabled]="!!run()">
              <option [value]="null">—</option>
              @for (fy of financialYears(); track fy.id) {
                <option [value]="fy.id">{{ fy.label }}</option>
              }
            </select>
          </div>
        </div>
      </div>
      <div class="card-foot">
        @if (!run()) {
          <button class="btn primary" type="button" [disabled]="previewing()" (click)="preview()">
            {{ previewing() ? 'Previewing…' : 'Preview' }}
          </button>
        } @else if (run()!.status === 'PREVIEW') {
          <button class="btn ghost" type="button" [disabled]="deciding()" (click)="cancelRun()">Discard Preview</button>
          @if (canRun()) {
            <button class="btn primary" type="button" [disabled]="deciding()" (click)="commitRun()">
              {{ deciding() ? 'Committing…' : 'Commit' }}
            </button>
          }
        } @else {
          <button class="btn ghost" type="button" (click)="reset()">Start a New Run</button>
        }
      </div>
    </div>

    @if (run(); as r) {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Summary</h3></div>
        <div class="card-body grid g-4">
          <div><div class="cell-sub">Status</div><div class="cell-strong">{{ r.status }}</div></div>
          <div><div class="cell-sub">Employees</div><div class="cell-strong">{{ r.employee_count }}</div></div>
          <div><div class="cell-sub">Days Carried</div><div class="cell-strong">{{ r.total_days_carried }}</div></div>
          <div><div class="cell-sub">Days Lapsed</div><div class="cell-strong">{{ r.total_days_lapsed }}</div></div>
          <div style="grid-column: span 4;"><div class="cell-sub">Leave Types In Scope</div><div class="cell-strong">{{ leaveTypesInScope(r.lines) }}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Lines ({{ r.line_count }})</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave Type</th>
                <th class="r">Remaining at Run</th>
                <th class="r">Cap</th>
                <th class="r">Carried Forward</th>
                <th class="r">Lapsed</th>
              </tr>
            </thead>
            <tbody>
              @for (line of r.lines; track line.id) {
                <tr>
                  <td>{{ employeeName(line.employee_id) }}</td>
                  <td>{{ leaveTypeName(line.leave_type_id) }}</td>
                  <td class="mono r">{{ line.remaining_days_at_run }}</td>
                  <td class="mono r">{{ line.max_carry_forward_days_snapshot ?? 'No cap' }}</td>
                  <td class="mono r cell-strong">{{ line.days_carried_forward }}</td>
                  <td class="mono r">{{ line.days_lapsed }}</td>
                </tr>
              }
              @if (!r.lines.length) {
                <tr><td colspan="6" class="cell-sub">No balances are eligible to carry forward between these two years.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class LeaveCarryForwardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly financialYears = signal<readonly FinancialYearOption[]>([]);
  private employees: readonly EmployeeOption[] = [];
  private leaveTypes: readonly LeaveTypeOption[] = [];

  protected fromFyId: string | null = null;
  protected toFyId: string | null = null;

  protected readonly run = signal<CarryForwardRun | null>(null);
  protected readonly previewing = signal(false);
  protected readonly deciding = signal(false);
  protected readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<FinancialYearOption[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows),
      error: () => this.financialYears.set([]),
    });
    this.http.get<EmployeeOption[]>(`${environment.apiBaseUrl}/employees`).subscribe({
      next: (rows) => (this.employees = rows),
      error: () => (this.employees = []),
    });
    this.http.get<LeaveTypeOption[]>(`${environment.apiBaseUrl}/masters/leave-types`).subscribe({
      next: (rows) => (this.leaveTypes = rows),
      error: () => (this.leaveTypes = []),
    });
  }

  protected canRun(): boolean {
    return this.policy.can('leave.balance_management', 'run_carry_forward');
  }

  protected employeeName(id: string): string {
    const e = this.employees.find((x) => x.id === id);
    return e ? `${e.first_name} ${e.last_name ?? ''}`.trim() : id.slice(0, 8);
  }

  protected leaveTypeName(id: string): string {
    return this.leaveTypes.find((t) => t.id === id)?.name ?? id;
  }

  // §2.3's own l.carryfwd form shows a read-only "Leave Types In Scope"
  // field ("only Leave Types where Masters -> Leave Types has Carry Forward
  // Allowed = Yes") — derived here from the distinct leave types actually
  // present in the committed/previewed lines, rather than a second lookup
  // against every Leave Type's own flag.
  protected leaveTypesInScope(lines: readonly CarryForwardLine[]): string {
    if (!lines.length) return 'None eligible';
    return [...new Set(lines.map((l) => this.leaveTypeName(l.leave_type_id)))].join(', ');
  }

  protected preview(): void {
    if (!this.fromFyId || !this.toFyId) {
      this.formError.set('Both From and To Financial Year are required.');
      return;
    }
    if (this.fromFyId === this.toFyId) {
      this.formError.set('From and To Financial Year must be different.');
      return;
    }
    this.previewing.set(true);
    this.formError.set(null);
    this.http
      .post<CarryForwardRun>(`${environment.apiBaseUrl}/leave-carry-forward-runs/preview`, {
        from_financial_year_id: this.fromFyId,
        to_financial_year_id: this.toFyId,
      })
      .subscribe({
        next: (r) => {
          this.previewing.set(false);
          this.run.set(r);
        },
        error: (err) => {
          this.previewing.set(false);
          this.formError.set(err?.error?.detail ?? 'Failed to preview this run.');
        },
      });
  }

  protected commitRun(): void {
    const r = this.run();
    if (!r || !window.confirm('Commit this carry-forward run? This updates every eligible balance and cannot be undone.')) return;
    this.deciding.set(true);
    this.formError.set(null);
    this.http.post<CarryForwardRun>(`${environment.apiBaseUrl}/leave-carry-forward-runs/${r.id}/commit`, {}).subscribe({
      next: (updated) => {
        this.deciding.set(false);
        this.run.set(updated);
      },
      error: (err) => {
        this.deciding.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to commit this run.');
      },
    });
  }

  protected cancelRun(): void {
    const r = this.run();
    if (!r) return;
    this.deciding.set(true);
    this.formError.set(null);
    this.http.post<CarryForwardRun>(`${environment.apiBaseUrl}/leave-carry-forward-runs/${r.id}/cancel`, {}).subscribe({
      next: () => {
        this.deciding.set(false);
        this.reset();
      },
      error: (err) => {
        this.deciding.set(false);
        this.formError.set(err?.error?.detail ?? 'Failed to discard this preview.');
      },
    });
  }

  protected reset(): void {
    this.run.set(null);
    this.fromFyId = null;
    this.toFyId = null;
    this.formError.set(null);
  }
}
