import { HttpClient, HttpResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { badgeClass, formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';
import {
  AttendanceBiometricFeedResponse,
  AttendanceCompensationRow,
  AttendanceDayWiseLogRow,
  AttendanceMonthlySummaryRow,
  AttendancePayrollImpactRow,
  COMPENSATION_STATUS_OPTIONS,
  MONTH_NAMES,
} from '../payroll.api';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

const DEPARTMENT_REF: RefLookup = { endpoint: '/masters/departments/options', labelKey: 'label' };
const EMPLOYEE_REF: RefLookup = { endpoint: '/employees/options', labelKey: 'label' };
const WORK_WEEK_POLICY_REF: RefLookup = { endpoint: '/masters/work-week-policies/options', labelKey: 'label' };
// attendance_reconciliation.py's own _STATUS_DISPLAY / the 3-value
// vocabulary this component's own hourStatusBadge() already keys off.
const HOUR_STATUS_OPTIONS = ['Met', 'Short — compensable', 'Short — payroll impact'] as const;

type AttendanceTabKey = 'monthly' | 'daywise' | 'impact' | 'compensation' | 'biometric';

/** §2.4 Attendance & Time Basis — five tabs behind one bespoke component
 * (not the 'report' shape): Day-wise Log has a genuinely different MANDATORY
 * employee_id the other tabs don't share, Biometric Feed takes zero params
 * and has no export, and the tabs are switchable rather than all stacked on
 * one page.
 *
 * RBAC: gated purely at the route (canMatch: screenAccessGuard) — the real
 * screen key has has_scope=True but NO actions at all (view-only throughout,
 * per this module's own brief), so no PolicyStore.can() checks appear
 * anywhere in this file.
 */
@Component({
  selector: 'app-payroll-attendance',
  standalone: true,
  imports: [FormsModule, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          Attendance &amp; Time Basis
          <span class="spec-ref">§2.4</span>
        </h1>
        <p class="page-sub">How recorded attendance turns into payable hours and, where it falls short, payroll impact.</p>
      </div>
    </div>

    @if (activeTab() !== 'biometric') {
      <div class="filterbar">
        <!-- Every control in this bar carries its OWN aria-label. axe read this
             one row as six [critical] select-name violations plus a [critical]
             label — the year <input> had no label, no title and no placeholder
             of any kind, so literally nothing identified it. The first
             <option> ("All Departments", "Any Hour Status") names the default
             CHOICE, never the control, and it vanishes the moment a filter is
             applied, which is the same failure mode as naming a field by its
             placeholder. Named exactly the way company-expenses.component.ts's
             filter row is, for the same reason. -->
        <div class="filter-row">
          <select class="input" style="max-width: 160px;" aria-label="Period Month" [(ngModel)]="periodMonth" (ngModelChange)="load()">
            @for (m of monthOptions; track m.value) {
              <option [ngValue]="m.value">{{ m.label }}</option>
            }
          </select>
          <input class="input" style="max-width: 100px;" type="number" aria-label="Period Year" [(ngModel)]="periodYear" (change)="load()" />

          @if (activeTab() !== 'daywise') {
            <select class="fselect" aria-label="Department" [(ngModel)]="departmentId" (ngModelChange)="load()">
              <option [ngValue]="null">All Departments</option>
              @for (opt of departmentOptions(); track opt.id) {
                <option [ngValue]="opt.id">{{ opt.label }}</option>
              }
            </select>
          }

          <!-- Day-wise Log is the one tab where this filter is MANDATORY — that
               tab renders an empty state instead of a table until it is set — so
               aria-required tracks the tab rather than being fixed, and is null
               (absent) rather than "false" everywhere else. -->
          <select class="fselect" aria-label="Employee" [attr.aria-required]="activeTab() === 'daywise' ? 'true' : null" [(ngModel)]="employeeId" (ngModelChange)="load()">
            <option [ngValue]="null">{{ activeTab() === 'daywise' ? 'Select an Employee…' : 'All Employees' }}</option>
            @for (opt of employeeOptions(); track opt.id) {
              <option [ngValue]="opt.id">{{ opt.label }}</option>
            }
          </select>

          @if (activeTab() === 'monthly' || activeTab() === 'impact') {
            <select class="fselect" aria-label="Work Week Policy" [(ngModel)]="workWeekPolicyId" (ngModelChange)="load()">
              <option [ngValue]="null">All Work Week Policies</option>
              @for (opt of workWeekPolicyOptions(); track opt.id) {
                <option [ngValue]="opt.id">{{ opt.label }}</option>
              }
            </select>
            <select class="fselect" aria-label="Hour Status" [(ngModel)]="hourStatus" (ngModelChange)="load()">
              <option [ngValue]="null">Any Hour Status</option>
              @for (opt of hourStatusOptions; track opt) {
                <option [value]="opt">{{ opt }}</option>
              }
            </select>
          }

          @if (activeTab() === 'compensation') {
            <select class="fselect" aria-label="Compensation Status" [(ngModel)]="compensationStatus" (ngModelChange)="load()">
              <option [ngValue]="null">All Statuses</option>
              @for (opt of compensationStatusOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
          }

          <div style="margin-left: auto; display: flex; gap: 6px;">
            <button class="btn sm" type="button" [disabled]="!!exporting()" (click)="exportCurrentTab('pdf')">
              {{ exporting() === 'pdf' ? 'Exporting…' : 'PDF' }}
            </button>
            <button class="btn sm" type="button" [disabled]="!!exporting()" (click)="exportCurrentTab('excel')">
              {{ exporting() === 'excel' ? 'Exporting…' : 'Excel' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (loadError()) {
      <div class="form-error" style="margin: 0 0 14px;">{{ loadError() }}</div>
    }

    <div class="tabs">
      @for (t of tabs; track t.key) {
        <div class="tab" [class.on]="t.key === activeTab()" role="button" (click)="selectTab(t.key)">{{ t.label }}</div>
      }
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @switch (activeTab()) {
        @case ('monthly') {
          <div class="card">
            <div class="card-head">
              <h3>Monthly Summary</h3>
              <span class="sub">{{ monthlyRows().length }} employee(s) — click a row to open their Day-wise Log</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th class="r">Required</th>
                    <th class="r">Worked</th>
                    <th class="r">Comp Credit</th>
                    <th class="r">Leave Credit</th>
                    <th class="r">Credited</th>
                    <th class="r">Balance</th>
                    <th class="r">Comp Pending</th>
                    <th class="r">Hours Short</th>
                    <th class="r">Net Short</th>
                    <th class="r">Payable Days</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of monthlyRows(); track row.employee_id) {
                    <tr class="clickable" (click)="openDaywiseFor(row.employee_id)">
                      <td class="cell-strong">{{ row.employee_name }} <span class="cell-sub">{{ row.employee_code }}</span></td>
                      <td class="mono r">{{ row.required_hours }}</td>
                      <td class="mono r">{{ row.worked_hours }}</td>
                      <td class="mono r">{{ row.comp_credit_hours }}</td>
                      <td class="mono r">{{ row.leave_credit_hours }}</td>
                      <td class="mono r">{{ row.credited_hours }}</td>
                      <td class="mono r">{{ row.balance_hours }}</td>
                      <td class="mono r">{{ row.comp_pending_hours }}</td>
                      <td class="mono r">{{ row.hours_short }}</td>
                      <td class="mono r">{{ row.net_short_hours }}</td>
                      <td class="mono r">{{ row.payable_days }}</td>
                      <td>
                        <span class="badge-s {{ hourStatusBadge(row.status) }}">{{ row.status }}</span>
                        @if (row.is_locked) {
                          <span class="badge-s b-neutral" title="A Processed period is frozen — a later Work Week Policy edit can never change it.">Locked</span>
                        }
                      </td>
                    </tr>
                  }
                  @if (!monthlyRows().length) {
                    <tr><td colspan="12" class="cell-sub">No employees in scope for this period.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        @case ('daywise') {
          @if (!employeeId) {
            <div class="empty"><p>Select an Employee above (or click a row on Monthly Summary) to see their day-wise log.</p></div>
          } @else {
            <div class="card">
              <div class="card-head"><h3>Day-wise Log</h3></div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Day Type</th>
                      <th>In</th>
                      <th>Out</th>
                      <th class="r">Break</th>
                      <th class="r">Required</th>
                      <th class="r">Worked</th>
                      <th class="r">Comp</th>
                      <th class="r">Balance</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of daywiseRows(); track row.date) {
                      <tr>
                        <td class="mono">{{ formatDate(row.date) }}</td>
                        <td>{{ row.day }}</td>
                        <td>{{ humanize(row.day_type) }}</td>
                        <td class="mono">{{ row.check_in_time ?? '—' }}</td>
                        <td class="mono">{{ row.check_out_time ?? '—' }}</td>
                        <td class="mono r">{{ row.break_hours }}</td>
                        <td class="mono r">{{ row.required_hours }}</td>
                        <td class="mono r">{{ row.worked_hours }}</td>
                        <td class="mono r">{{ row.comp_hours }}</td>
                        <td class="mono r">{{ row.balance_hours }}</td>
                        <td>{{ humanize(row.status) }}</td>
                        <td>{{ row.note ?? '—' }}</td>
                      </tr>
                    }
                    @if (!daywiseRows().length) {
                      <tr><td colspan="12" class="cell-sub">No data for this employee and period.</td></tr>
                    }
                  </tbody>
                  @if (daywiseRows().length) {
                    <tfoot>
                      <tr>
                        <td colspan="6" class="cell-strong">Period total</td>
                        <td class="mono r cell-strong">{{ daywiseTotals().required.toFixed(2) }}</td>
                        <td class="mono r cell-strong">{{ daywiseTotals().worked.toFixed(2) }}</td>
                        <td class="mono r cell-strong">{{ daywiseTotals().comp.toFixed(2) }}</td>
                        <td class="mono r cell-strong">{{ daywiseTotals().balance > 0 ? '+' : '' }}{{ daywiseTotals().balance.toFixed(2) }}</td>
                        <td colspan="2"></td>
                      </tr>
                    </tfoot>
                  }
                </table>
              </div>
            </div>
          }
        }
        @case ('impact') {
          <div class="card">
            <div class="card-head"><h3>Payroll Impact</h3></div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th class="r">Hours Short</th>
                    <th class="r">Comp Pending</th>
                    <th class="r">Net Short</th>
                    <th class="r">LOP Days</th>
                    <th>Est. Deduction</th>
                    <th>Status</th>
                    <th>Next Step</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of impactRows(); track row.employee_id) {
                    <tr>
                      <td class="cell-strong">{{ row.employee_name }} <span class="cell-sub">{{ row.employee_code }}</span></td>
                      <td class="mono r">{{ row.hours_short }}</td>
                      <td class="mono r">{{ row.comp_pending_hours }}</td>
                      <td class="mono r">{{ row.net_short_hours }}</td>
                      <td class="mono r">{{ row.lop_days_net_of_pending }}</td>
                      <td class="mono">{{ formatMoney(row.estimated_deduction) }}</td>
                      <td>
                        <span class="badge-s {{ hourStatusBadge(row.status) }}">{{ row.status }}</span>
                        @if (row.is_locked) {
                          <span class="badge-s b-neutral">Locked</span>
                        }
                      </td>
                      <td>{{ row.next_step }}</td>
                    </tr>
                  }
                  @if (!impactRows().length) {
                    <tr><td colspan="8" class="cell-sub">No employees in scope for this period.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        @case ('compensation') {
          <div class="card">
            <div class="card-head">
              <h3>Compensation</h3>
              <button class="btn sm ghost" type="button" (click)="openCompHoursQueue()">Open Compensatory Hours Queue</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request #</th>
                    <th>Employee</th>
                    <th>Shortfall Date</th>
                    <th class="r">Hours Short</th>
                    <th>Make-up Date</th>
                    <th class="r">Hours To Work</th>
                    <th class="r">Hours Credited</th>
                    <th class="r">Residual</th>
                    <th>Status</th>
                    <th>Routed To</th>
                    <th>Est. Impact</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of compensationRows(); track row.id) {
                    <tr>
                      <td class="mono">{{ row.request_number }}</td>
                      <td class="cell-strong">{{ row.employee_name }} <span class="cell-sub">{{ row.employee_code }}</span></td>
                      <td class="mono">{{ formatDate(row.shortfall_date) }}</td>
                      <td class="mono r">{{ row.hours_short }}</td>
                      <td class="mono">{{ formatDate(row.make_up_date) }}</td>
                      <td class="mono r">{{ row.hours_to_work }}</td>
                      <td class="mono r">{{ row.hours_credited }}</td>
                      <td class="mono r">{{ row.residual_shortfall_hours }}</td>
                      <td><span class="badge-s {{ badgeCls(row.status) }}">{{ humanize(row.status) }}</span></td>
                      <td>{{ row.routed_to_role ?? '—' }}</td>
                      <td class="mono">{{ formatMoney(row.estimated_payroll_impact) }}</td>
                    </tr>
                  }
                  @if (!compensationRows().length) {
                    <tr><td colspan="11" class="cell-sub">No compensatory hour requests in this period.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        @case ('biometric') {
          @if (biometric(); as b) {
            <div class="card" style="margin-bottom: 16px;">
              <div class="card-head"><h3>Input Sources</h3></div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Input Status</th>
                      <th class="r">Record Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (s of b.sources; track s.source) {
                      <tr>
                        <td class="cell-strong">{{ s.label }}</td>
                        <td><span class="badge-s {{ s.input_status === 'LIVE' ? 'b-ok' : 'b-neutral' }}">{{ s.input_status === 'LIVE' ? 'Live' : 'Planned' }}</span></td>
                        <td class="mono r">{{ s.record_count }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <div class="card-body">
                <div class="grid g-2" style="margin-bottom: 0;">
                  <div><div class="cell-sub">Employees Biometric-Enrolled</div><div class="cell-strong">{{ b.employees_biometric_enrolled }}</div></div>
                  <div><div class="cell-sub">Employees Total</div><div class="cell-strong">{{ b.employees_total }}</div></div>
                </div>
                <p class="hint" style="margin: 12px 0 0;">{{ b.note }}</p>
              </div>
            </div>
          }
        }
      }
    }
  `,
})
export class PayrollAttendanceComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);

  protected readonly tabs: readonly { key: AttendanceTabKey; label: string }[] = [
    { key: 'monthly', label: 'Monthly Summary' },
    { key: 'daywise', label: 'Day-wise Log' },
    { key: 'impact', label: 'Payroll Impact' },
    { key: 'compensation', label: 'Compensation' },
    { key: 'biometric', label: 'Biometric Feed' },
  ];
  protected readonly activeTab = signal<AttendanceTabKey>('monthly');

  protected readonly monthOptions = MONTH_NAMES.slice(1).map((label, i) => ({ value: i + 1, label }));
  protected readonly compensationStatusOptions = COMPENSATION_STATUS_OPTIONS;
  protected readonly hourStatusOptions = HOUR_STATUS_OPTIONS;
  protected periodMonth = new Date().getMonth() + 1;
  protected periodYear = new Date().getFullYear();
  protected departmentId: string | null = null;
  protected employeeId: string | null = null;
  protected workWeekPolicyId: string | null = null;
  protected hourStatus: string | null = null;
  protected compensationStatus: string | null = null;

  protected readonly isLoading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);

  protected readonly monthlyRows = signal<readonly AttendanceMonthlySummaryRow[]>([]);
  protected readonly daywiseRows = signal<readonly AttendanceDayWiseLogRow[]>([]);
  // Period-total footer row (data.js:1604-1611's own tfoot) — a client-side
  // sum over rows already fetched from the real GET .../day-wise-log
  // response, not a second endpoint call.
  protected readonly daywiseTotals = computed(() => {
    const rows = this.daywiseRows();
    const required = rows.reduce((a, r) => a + r.required_hours, 0);
    const worked = rows.reduce((a, r) => a + r.worked_hours, 0);
    const comp = rows.reduce((a, r) => a + r.comp_hours, 0);
    return { required, worked, comp, balance: worked - required };
  });
  protected readonly impactRows = signal<readonly AttendancePayrollImpactRow[]>([]);
  protected readonly compensationRows = signal<readonly AttendanceCompensationRow[]>([]);
  protected readonly biometric = signal<AttendanceBiometricFeedResponse | null>(null);

  protected readonly formatDate = formatDate;
  protected readonly formatMoney = formatMoney;

  ngOnInit(): void {
    this.load();
  }

  protected departmentOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(DEPARTMENT_REF) ?? [];
  }

  protected employeeOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(EMPLOYEE_REF) ?? [];
  }

  protected workWeekPolicyOptions(): readonly { id: string; label: string }[] {
    return this.refData.options(WORK_WEEK_POLICY_REF) ?? [];
  }

  protected humanize(value: string): string {
    return humanizeEnum(value);
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  /** Monthly Summary and Payroll Impact share the exact same 3-value status
   * vocabulary (attendance_reconciliation.py's own _STATUS_DISPLAY, used by
   * both endpoints) — none of which are real BADGE_CLASS keys in
   * cell-format.ts (the em dash inside "Short — compensable" alone keeps it
   * from matching), so badgeClass() would flatten all three to neutral grey.
   * This gives the three real states distinct, meaningful colors instead. */
  protected hourStatusBadge(status: string): string {
    if (status === 'Met') return 'b-ok';
    if (status === 'Short — compensable') return 'b-warn';
    if (status === 'Short — payroll impact') return 'b-danger';
    return 'b-neutral';
  }

  protected selectTab(tab: AttendanceTabKey): void {
    this.activeTab.set(tab);
    this.load();
  }

  /** §2.4: "Rows [in Monthly Summary] open that person's day-wise log." */
  protected openDaywiseFor(employeeId: string): void {
    this.employeeId = employeeId;
    this.selectTab('daywise');
  }

  // leave_module_endpoint on a Compensation row is a literal BACKEND API path
  // ("/compensatory-hours/approvals"), not an Angular route — hardcoded to
  // the real, already-built frontend route for that same queue instead of
  // ever being fed straight into router.navigate/routerLink.
  protected openCompHoursQueue(): void {
    this.router.navigate(['/leave/compensatory-hours-approvals']);
  }

  private baseParams(): Record<string, string> {
    const out: Record<string, string> = { period_month: String(this.periodMonth), period_year: String(this.periodYear) };
    if (this.departmentId) out['department_id'] = this.departmentId;
    if (this.employeeId) out['employee_id'] = this.employeeId;
    // Only monthly/impact — the two tabs whose own endpoints accept these
    // (attendance_reconciliation.py's monthly_summary/payroll_impact); the
    // template only ever shows these two controls for those tabs anyway.
    if ((this.activeTab() === 'monthly' || this.activeTab() === 'impact') && this.workWeekPolicyId) {
      out['work_week_policy_id'] = this.workWeekPolicyId;
    }
    if ((this.activeTab() === 'monthly' || this.activeTab() === 'impact') && this.hourStatus) {
      out['hour_status'] = this.hourStatus;
    }
    return out;
  }

  protected load(): void {
    this.loadError.set(null);
    switch (this.activeTab()) {
      case 'monthly':
        this.loadMonthly();
        return;
      case 'daywise':
        this.loadDaywise();
        return;
      case 'impact':
        this.loadImpact();
        return;
      case 'compensation':
        this.loadCompensation();
        return;
      case 'biometric':
        this.loadBiometric();
        return;
    }
  }

  private loadMonthly(): void {
    this.isLoading.set(true);
    this.http.get<AttendanceMonthlySummaryRow[]>(`${environment.apiBaseUrl}/payroll/attendance/monthly-summary`, { params: this.baseParams() }).subscribe({
      next: (rows) => {
        this.monthlyRows.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err));
        this.isLoading.set(false);
      },
    });
  }

  private loadDaywise(): void {
    // employee_id has no default on this endpoint at all (required, no
    // fallback) — firing without one would just 422; show a prompt instead.
    if (!this.employeeId) {
      this.daywiseRows.set([]);
      return;
    }
    this.isLoading.set(true);
    const params = { period_month: String(this.periodMonth), period_year: String(this.periodYear), employee_id: this.employeeId };
    this.http.get<AttendanceDayWiseLogRow[]>(`${environment.apiBaseUrl}/payroll/attendance/day-wise-log`, { params }).subscribe({
      next: (rows) => {
        this.daywiseRows.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err));
        this.isLoading.set(false);
      },
    });
  }

  private loadImpact(): void {
    this.isLoading.set(true);
    this.http.get<AttendancePayrollImpactRow[]>(`${environment.apiBaseUrl}/payroll/attendance/payroll-impact`, { params: this.baseParams() }).subscribe({
      next: (rows) => {
        this.impactRows.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err));
        this.isLoading.set(false);
      },
    });
  }

  private loadCompensation(): void {
    this.isLoading.set(true);
    const params = this.baseParams();
    if (this.compensationStatus) params['status'] = this.compensationStatus;
    this.http.get<AttendanceCompensationRow[]>(`${environment.apiBaseUrl}/payroll/attendance/compensation`, { params }).subscribe({
      next: (rows) => {
        this.compensationRows.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err));
        this.isLoading.set(false);
      },
    });
  }

  private loadBiometric(): void {
    this.isLoading.set(true);
    this.http.get<AttendanceBiometricFeedResponse>(`${environment.apiBaseUrl}/payroll/attendance/biometric-feed`).subscribe({
      next: (data) => {
        this.biometric.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(this.formatError(err));
        this.isLoading.set(false);
      },
    });
  }

  // RBAC 14 §2.2f blob-download mechanism, same pattern as list-screen.
  // component.ts's exportAs() — Bearer auth is header-only, so a plain link
  // would hit the API unauthenticated. Biometric Feed has no export button
  // at all (no `format` param on that endpoint), so this is never reachable
  // while that tab is active.
  protected exportCurrentTab(format: 'pdf' | 'excel'): void {
    const tab = this.activeTab();
    if (tab === 'biometric' || this.exporting()) return;
    if (tab === 'daywise' && !this.employeeId) return; // nothing to export yet

    const endpointByTab: Record<Exclude<AttendanceTabKey, 'biometric'>, string> = {
      monthly: '/payroll/attendance/monthly-summary',
      daywise: '/payroll/attendance/day-wise-log',
      impact: '/payroll/attendance/payroll-impact',
      compensation: '/payroll/attendance/compensation',
    };
    const params: Record<string, string> =
      tab === 'daywise'
        ? { period_month: String(this.periodMonth), period_year: String(this.periodYear), employee_id: this.employeeId as string }
        : this.baseParams();
    if (tab === 'compensation' && this.compensationStatus) params['status'] = this.compensationStatus;
    params['format'] = format;

    this.exporting.set(format);
    this.loadError.set(null);
    const search = new URLSearchParams(params).toString();
    const url = `${environment.apiBaseUrl}${endpointByTab[tab]}?${search}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        this.saveBlob(res, `attendance-${tab}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
      },
      error: async (err) => {
        this.exporting.set(null);
        this.loadError.set(await this.resolveBlobError(err));
      },
    });
  }

  private saveBlob(res: HttpResponse<Blob>, fallbackFilename: string): void {
    const blob = res.body;
    if (!blob) return;
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match?.[1] ?? fallbackFilename;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  private async resolveBlobError(err: unknown): Promise<string> {
    const blob = (err as { error?: unknown } | null)?.error;
    if (blob instanceof Blob) {
      try {
        const parsed = JSON.parse(await blob.text());
        if (typeof parsed?.detail === 'string') return parsed.detail;
      } catch {
        // not JSON — fall through to the generic message below
      }
    }
    return 'That export failed.';
  }

  private formatError(err: unknown, fallback = 'Failed to load this view.'): string {
    const detail = (err as { error?: { detail?: unknown } } | null)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: unknown) => (d as { msg?: string })?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
