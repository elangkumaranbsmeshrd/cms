import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { humanizeEnum } from '../../../shared/screens/cell-format';

/** GET /compensatory-hours/preview — the derived half of §2.6's field table
 * (Day Type, Window Check, Monthly Cap Check), computed server-side because
 * all three resolve from the covering Work Week Policy, and day-type
 * resolution additionally needs holidays and Saturday overrides. */
interface CompHoursPreview {
  readonly make_up_day_type: string;
  readonly day_type_permitted: boolean;
  readonly compensation_window_days: number;
  readonly window_last_permissible_date: string;
  readonly within_window: boolean;
  readonly max_comp_hours_per_month: string | null;
  readonly month_hours_already_used: string;
  readonly within_monthly_cap: boolean;
}

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
            <div><div class="cell-sub">Make-Up Date</div><input class="input" type="date" [(ngModel)]="form['make_up_date']" (ngModelChange)="refreshPreview()" /></div>
            <div>
              <div class="cell-sub">Day Type</div>
              <span class="badge-s" [class.b-ok]="preview()?.day_type_permitted" [class.b-danger]="preview() && !preview()!.day_type_permitted">{{ dayTypeLabel() }}</span>
              <div class="hint">{{ dayTypeHint() }}</div>
            </div>
            <div><div class="cell-sub">Hours You Will Work</div><input class="input" type="number" step="0.5" [(ngModel)]="form['hours_to_work']" (blur)="refreshPreview()" /></div>
            <div><div class="cell-sub">Planned Check-In (optional)</div><input class="input" type="time" [(ngModel)]="form['planned_check_in_time']" /></div>
            <div><div class="cell-sub">Planned Check-Out (optional)</div><input class="input" type="time" [(ngModel)]="form['planned_check_out_time']" /></div>
            <div><div class="cell-sub">Planned Break Hours</div><input class="input" type="number" step="0.5" [(ngModel)]="form['planned_break_hours']" /></div>
            <div>
              <div class="cell-sub">Window Check</div>
              <span class="badge-s" [class.b-ok]="preview()?.within_window" [class.b-danger]="preview() && !preview()!.within_window">{{ windowCheckLabel() }}</span>
              <div class="hint">{{ windowCheckHint() }}</div>
            </div>
            <div>
              <div class="cell-sub">Monthly Cap Check</div>
              <span class="badge-s" [class.b-ok]="preview()?.within_monthly_cap" [class.b-danger]="preview() && !preview()!.within_monthly_cap">{{ monthlyCapLabel() }}</span>
              <div class="hint">{{ monthlyCapHint() }}</div>
            </div>
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
  protected readonly preview = signal<CompHoursPreview | null>(null);
  protected readonly previewError = signal<string | null>(null);

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
    this.refreshPreview();
  }

  // §2.6's Day Type, Window Check and Monthly Cap Check are all DERIVED,
  // read-only fields on this form — the applicant is meant to read them while
  // choosing a Make-Up Date, not discover them as a 422 on submit. None can be
  // worked out in the browser: the day type resolves from the covering Work
  // Week Policy plus that date's holidays and Saturday overrides, and the
  // window and cap come off the same policy. GET /compensatory-hours/preview
  // runs the exact trio the create endpoint runs, so what is shown here and
  // what submit enforces cannot disagree.
  //
  // Refreshed on the Make-Up Date's own change and on the hours field's BLUR
  // rather than every keystroke — the same split my-leave.component.ts uses
  // between its date/select filters and its typed search box.
  protected refreshPreview(): void {
    const makeUpDate = String(this.form['make_up_date'] ?? '');
    if (!this.shortfallId || !makeUpDate) {
      this.preview.set(null);
      this.previewError.set(null);
      return;
    }
    const params = new URLSearchParams({
      shortfall_attendance_record_id: this.shortfallId,
      make_up_date: makeUpDate,
      // Blank while the user is mid-edit — the cap check reads 0 as "just the
      // hours already claimed this month", which is the honest answer until a
      // number is typed rather than a request failure.
      hours_to_work: String(Number(this.form['hours_to_work']) || 0),
    });
    this.http.get<CompHoursPreview>(`${environment.apiBaseUrl}/compensatory-hours/preview?${params.toString()}`).subscribe({
      next: (row) => {
        this.preview.set(row);
        this.previewError.set(null);
      },
      error: (err) => {
        this.preview.set(null);
        const detail = err?.error?.detail;
        this.previewError.set(typeof detail === 'string' ? detail : 'Could not check this date against your Work Week Policy.');
      },
    });
  }

  protected dayTypeLabel(): string {
    const p = this.preview();
    return p ? humanizeEnum(p.make_up_day_type) : '—';
  }

  protected dayTypeHint(): string {
    const error = this.previewError();
    if (error) return error;
    const p = this.preview();
    if (!p) return 'Resolved from your Work Week Policy once a Make-Up Date is set.';
    return p.day_type_permitted
      ? 'Resolved from your Work Week Policy, which allows making up hours on this kind of day.'
      : 'Your Work Week Policy does not allow making up hours on this kind of day — submitting will be refused.';
  }

  protected windowCheckLabel(): string {
    const p = this.preview();
    if (!p) return '—';
    return p.within_window ? 'Inside the Compensation Window' : 'Past the Compensation Window';
  }

  protected windowCheckHint(): string {
    const p = this.preview();
    if (!p) return 'Checked against the Compensation Window on your Work Week Policy once a Make-Up Date is set.';
    return `Compensation Window: ${p.compensation_window_days} days from the shortfall — last permissible date ${p.window_last_permissible_date}.`;
  }

  protected monthlyCapLabel(): string {
    const p = this.preview();
    if (!p) return '—';
    if (p.max_comp_hours_per_month === null) return 'No monthly cap on this policy';
    return p.within_monthly_cap ? 'Inside the monthly cap' : 'Over the monthly cap';
  }

  protected monthlyCapHint(): string {
    const p = this.preview();
    if (!p) return 'Checked against Max Compensatory Hours per Month on your Work Week Policy once a Make-Up Date is set.';
    if (p.max_comp_hours_per_month === null) return 'Your Work Week Policy sets no Max Compensatory Hours per Month.';
    return `${p.month_hours_already_used} of ${p.max_comp_hours_per_month} hours already claimed for this make-up month, before this request.`;
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
