import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { humanizeEnum } from '../../../shared/screens/cell-format';

interface ShortfallOption {
  readonly id: string;
  readonly attendance_date: string;
  readonly balance_hours: string;
  readonly day_status: string;
}

// §2.6 "Request Compensatory Hours" — bespoke: derived/conditional fields
// (Hours to Work must be >= Hours Short; Which Half only when Half-Day)
// don't fit FormScreenConfig's flat field list, and the Shortfall Date
// dropdown's source (GET /attendance filtered client-side to
// balance_hours < 0) isn't a Masters lookup RefLookup can drive.
//
// Resolves its own employee id via /employees/me first (same two-step
// pattern as My Documents) rather than relying on GET /attendance's own
// implicit "own" scoping — a Manager/HR/Super Admin's employee.attendance
// mode is 'team'/'full', so an unscoped call would return their whole
// team's shortfalls instead of just their own.
@Component({
  selector: 'app-leave-comp-hours-apply',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Request Compensatory Hours</h1>
        <p class="page-sub">Make up a shortfall on an earlier attendance day.</p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (!shortfalls().length) {
      <div class="empty"><p>You have no attendance shortfalls to make up.</p></div>
    } @else {
      <div class="card">
        <div class="card-body">
          @if (formError()) {
            <div class="form-error" style="margin: 0 0 14px;">{{ formError() }}</div>
          }
          <div class="grid g-2" style="margin-bottom: 12px;">
            <div>
              <div class="cell-sub">Employee</div>
              <div class="cell-strong">{{ session.user()?.fullName }}</div>
              <div class="hint">Locked to you — you can only compensate your own hours</div>
            </div>
            <div></div>
            <div style="grid-column: span 2;">
              <div class="cell-sub">Shortfall Date</div>
              <select class="input" [(ngModel)]="shortfallId" (ngModelChange)="onShortfallChange()">
                <option [value]="null">—</option>
                @for (s of shortfalls(); track s.id) {
                  <option [value]="s.id">{{ s.attendance_date }} — {{ hoursShort(s) }} hours short</option>
                }
              </select>
            </div>
            @if (selectedShortfall(); as s) {
              <div class="hint">Hours short on this day: <b>{{ hoursShort(s) }}</b>. Hours You Will Work must be at least this many.</div>
              <div>
                <div class="cell-sub">Day Status That Day</div>
                <div>{{ dayStatusLabel(s) }}</div>
                <div class="hint">Approving this request lifts it back to Full Day.</div>
              </div>
            }
            <div style="grid-column: span 2;">
              <div class="cell-sub">Shortfall Reason</div>
              <textarea class="input" rows="2" [(ngModel)]="form['shortfall_reason']"></textarea>
            </div>
            <div><div class="cell-sub">Make-Up Date</div><input class="input" type="date" [(ngModel)]="form['make_up_date']" /></div>
            <div><div class="cell-sub">Hours You Will Work</div><input class="input" type="number" step="0.5" [(ngModel)]="form['hours_to_work']" /></div>
            <div><div class="cell-sub">Planned Check-In (optional)</div><input class="input" type="time" [(ngModel)]="form['planned_check_in_time']" /></div>
            <div><div class="cell-sub">Planned Check-Out (optional)</div><input class="input" type="time" [(ngModel)]="form['planned_check_out_time']" /></div>
            <div><div class="cell-sub">Planned Break Hours</div><input class="input" type="number" step="0.5" [(ngModel)]="form['planned_break_hours']" /></div>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn ghost" type="button" [disabled]="submitting()" (click)="cancel()">Cancel</button>
          <button class="btn primary" type="button" [disabled]="submitting()" (click)="submit()">
            {{ submitting() ? 'Submitting…' : 'Submit' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class LeaveCompHoursApplyComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  protected readonly isLoading = signal(true);
  protected readonly shortfalls = signal<readonly ShortfallOption[]>([]);
  protected shortfallId: string | null = null;
  protected form: Record<string, unknown> = { shortfall_reason: '', make_up_date: '', hours_to_work: 0, planned_check_in_time: '', planned_check_out_time: '', planned_break_hours: 0 };

  protected readonly submitting = signal(false);
  protected readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<{ id: string }>(`${environment.apiBaseUrl}/employees/me`).subscribe({
      next: (me) => {
        this.http.get<ShortfallOption[]>(`${environment.apiBaseUrl}/attendance?employee_id=${me.id}`).subscribe({
          next: (rows) => {
            this.shortfalls.set(rows.filter((r) => Number(r.balance_hours) < 0));
            this.isLoading.set(false);
          },
          error: () => this.isLoading.set(false),
        });
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected hoursShort(s: ShortfallOption): string {
    return (-Number(s.balance_hours)).toFixed(2);
  }

  protected dayStatusLabel(s: ShortfallOption): string {
    return humanizeEnum(s.day_status);
  }

  protected selectedShortfall(): ShortfallOption | undefined {
    return this.shortfalls().find((s) => s.id === this.shortfallId);
  }

  protected onShortfallChange(): void {
    const s = this.selectedShortfall();
    if (s) this.form['hours_to_work'] = Number(this.hoursShort(s));
  }

  protected cancel(): void {
    this.router.navigate(['/leave/compensatory-hours']);
  }

  protected submit(): void {
    if (!this.shortfallId || !this.form['shortfall_reason'] || !this.form['make_up_date'] || !this.form['hours_to_work']) {
      this.formError.set('Shortfall Date, Shortfall Reason, Make-Up Date, and Hours You Will Work are all required.');
      return;
    }
    this.submitting.set(true);
    this.formError.set(null);
    const body = {
      shortfall_attendance_record_id: this.shortfallId,
      shortfall_reason: this.form['shortfall_reason'],
      make_up_date: this.form['make_up_date'],
      hours_to_work: this.form['hours_to_work'],
      planned_check_in_time: this.form['planned_check_in_time'] || null,
      planned_check_out_time: this.form['planned_check_out_time'] || null,
      planned_break_hours: this.form['planned_break_hours'] || 0,
    };
    this.http.post(`${environment.apiBaseUrl}/compensatory-hours/requests`, body).subscribe({
      next: () => this.router.navigate(['/leave/compensatory-hours']),
      error: (err) => {
        this.submitting.set(false);
        const detail = err?.error?.detail;
        this.formError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to submit.');
      },
    });
  }
}
