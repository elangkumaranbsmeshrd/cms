import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';

interface LeaveBalanceRow {
  readonly leave_type_id: string;
  readonly allowed_days: string;
  readonly carried_forward_days: string;
  readonly taken_days: string;
  readonly remaining_days: string;
}

interface AttendanceRow {
  readonly id: string;
  readonly attendance_date: string;
  readonly day_type: string;
  readonly check_in_time: string | null;
  readonly check_out_time: string | null;
  readonly break_hours: string;
  readonly net_worked_hours: string;
  readonly day_status: string;
  readonly recorded_by_label: string;
}

interface LeaveTypeOption {
  readonly id: string;
  readonly name: string;
}

/** §2.2 Leave & Attendance Summary tab (read-only) — leave_balance.py's
 * /leave-balances and attendance.py's /attendance, both filtered to this
 * one employee. "+ Record Attendance" (employee.attendance's own 'record'
 * action, Super Admin only per the spec's own note) is the one write on an
 * otherwise read-only tab, so this is a bespoke component rather than
 * either a plain RecordFieldsTab (there's real tabular data here, not a few
 * field values) or a RecordEmbedTab (two independent tables sharing one
 * tab, not one list screen).
 */
@Component({
  selector: 'app-emp-leave-attendance',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Leave Balance (This Financial Year)</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leave Type</th>
                <th class="r">Allowed</th>
                <th class="r">Carried Forward</th>
                <th class="r">Taken</th>
                <th class="r">Remaining</th>
              </tr>
            </thead>
            <tbody>
              @for (b of balances(); track b.leave_type_id) {
                <tr>
                  <td>{{ leaveTypeName(b.leave_type_id) }}</td>
                  <td class="mono r">{{ b.allowed_days }}</td>
                  <td class="mono r">{{ b.carried_forward_days }}</td>
                  <td class="mono r">{{ b.taken_days }}</td>
                  <td class="mono r cell-strong">{{ b.remaining_days }}</td>
                </tr>
              }
              @if (!balances().length) {
                <tr><td colspan="5" class="cell-sub">No leave balance recorded for this financial year.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Attendance</h3>
          @if (canRecord() && !showForm()) {
            <button class="btn sm ghost" type="button" (click)="startRecord()">+ Record Attendance</button>
          }
        </div>
        <div class="card-body">
          <div class="filter-row" style="margin-bottom: 14px;">
            <span class="btn sm primary" style="pointer-events: none;">Manual Entry</span>
            <span class="btn sm ghost" style="pointer-events: none; opacity: 0.6;" title="Biometric — Coming Soon">
              Biometric <span class="badge-s b-outline">Coming Soon</span>
            </span>
          </div>

          @if (showForm()) {
            <div class="card" style="margin-bottom: 14px;">
              <div class="card-body">
                @if (formError()) {
                  <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
                }
                <div class="grid g-2" style="margin-bottom: 12px;">
                  <div><div class="cell-sub">Date</div><input class="input" type="date" [(ngModel)]="form['attendance_date']" /></div>
                  <div><div class="cell-sub">Break (hours)</div><input class="input" type="number" step="0.5" [(ngModel)]="form['break_hours']" /></div>
                  <div><div class="cell-sub">Check-In</div><input class="input" type="time" [(ngModel)]="form['check_in_time']" /></div>
                  <div><div class="cell-sub">Check-Out</div><input class="input" type="time" [(ngModel)]="form['check_out_time']" /></div>
                  <div style="grid-column: span 2;"><div class="cell-sub">Note</div><input class="input" [(ngModel)]="form['note']" /></div>
                </div>
              </div>
              <div class="card-foot">
                <button class="btn ghost" type="button" [disabled]="saving()" (click)="showForm.set(false)">Cancel</button>
                <button class="btn primary" type="button" [disabled]="saving()" (click)="saveAttendance()">
                  {{ saving() ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </div>
          }

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day Type</th>
                  <th>Check-In</th>
                  <th>Check-Out</th>
                  <th class="r">Break</th>
                  <th class="r">Net Worked Hours</th>
                  <th>Day Status</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                @for (a of attendance(); track a.id) {
                  <tr>
                    <td class="mono">{{ a.attendance_date }}</td>
                    <td>{{ a.day_type }}</td>
                    <td class="mono">{{ a.check_in_time ?? '—' }}</td>
                    <td class="mono">{{ a.check_out_time ?? '—' }}</td>
                    <td class="mono r">{{ a.break_hours }}</td>
                    <td class="mono r">{{ a.net_worked_hours }}</td>
                    <td><span class="badge-s" [class.b-success]="a.day_status.startsWith('Full')" [class.b-warning]="a.day_status === 'Half Day'" [class.b-danger]="a.day_status === 'Absent'">{{ a.day_status }}</span></td>
                    <td>{{ a.recorded_by_label }}</td>
                  </tr>
                }
                @if (!attendance().length) {
                  <tr><td colspan="8" class="cell-sub">No attendance recorded yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
})
export class EmpLeaveAttendanceComponent implements OnInit {
  readonly employeeId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);

  protected readonly isLoading = signal(true);
  protected readonly balances = signal<readonly LeaveBalanceRow[]>([]);
  protected readonly attendance = signal<readonly AttendanceRow[]>([]);
  protected readonly leaveTypes = signal<readonly LeaveTypeOption[]>([]);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected form: Record<string, unknown> = {};

  ngOnInit(): void {
    this.http.get<LeaveTypeOption[]>(`${environment.apiBaseUrl}/masters/leave-types`).subscribe({
      next: (rows) => this.leaveTypes.set(rows),
      error: () => this.leaveTypes.set([]),
    });
    this.load();
  }

  protected canRecord(): boolean {
    return this.policy.can('employee.attendance', 'record');
  }

  protected leaveTypeName(id: string): string {
    return this.leaveTypes().find((t) => t.id === id)?.name ?? id;
  }

  private load(): void {
    const id = this.employeeId();
    this.isLoading.set(true);
    this.http.get<LeaveBalanceRow[]>(`${environment.apiBaseUrl}/leave-balances?employee_id=${id}`).subscribe({
      next: (rows) => this.balances.set(rows),
      error: () => this.balances.set([]),
    });
    this.http.get<AttendanceRow[]>(`${environment.apiBaseUrl}/attendance?employee_id=${id}`).subscribe({
      next: (rows) => {
        this.attendance.set(rows.slice(0, 20));
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startRecord(): void {
    this.form = { attendance_date: '', check_in_time: '', check_out_time: '', break_hours: 0, note: '' };
    this.formError.set(null);
    this.showForm.set(true);
  }

  protected saveAttendance(): void {
    if (!this.form['attendance_date']) {
      this.formError.set('Date is required.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const body = {
      employee_id: this.employeeId(),
      attendance_date: this.form['attendance_date'],
      check_in_time: this.form['check_in_time'] || null,
      check_out_time: this.form['check_out_time'] || null,
      break_hours: this.form['break_hours'] || 0,
      note: this.form['note'] || null,
    };
    this.http.post(`${environment.apiBaseUrl}/attendance`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        const detail = err?.error?.detail;
        this.formError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to save.');
      },
    });
  }
}
