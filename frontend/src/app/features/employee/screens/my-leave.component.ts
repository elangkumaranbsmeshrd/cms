import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';
import { IconComponent } from '../../../shared/ui/icon.component';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

// actioned_by (LeaveRequestRow) is a raw platform User id (whoever
// approved/rejected the request), resolved via the cross-cutting GET /users.
const USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

interface LeaveBalanceRow {
  readonly leave_type_id: string;
  readonly allowed_days: string;
  readonly carried_forward_days: string;
  readonly adjustment_days: string;
  readonly taken_days: string;
  readonly pending_days: string;
  readonly remaining_days: string;
  readonly is_quota_tracked: boolean;
}

interface LeaveRequestRow {
  readonly id: string;
  readonly leave_type_id: string;
  readonly financial_year_id: string;
  readonly from_date: string;
  readonly to_date: string;
  readonly days_requested: string;
  readonly is_half_day: boolean;
  readonly half_day_session: string | null;
  readonly reason: string;
  readonly status: string;
  readonly actioned_by: string | null;
  readonly applied_at: string;
}

interface LeaveTypeOption {
  readonly id: string;
  readonly name: string;
}

interface FinancialYearOption {
  readonly id: string;
  readonly label: string;
}

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** §2.4 My Leave (leave.my_leave) — own balance table + history + Apply
 * form + Cancel. Bespoke, same class as emp.leave-attendance.component.ts
 * (two tables + inline form), hosted as a top-level route the way
 * my-profile.component.ts is — GET /leave/balances and GET /leave/requests
 * are already own-scoped server-side, no /employees/me id resolution
 * needed first (unlike My Documents/My Leave's own sibling screens that do
 * need it).
 *
 * §2.1's full filter set — Status, Leave Type, Financial Year, a From/To
 * range on the leave dates, a range on Date Applied, Half-Day, Actioned By,
 * and Search over Reason — is now entirely real 'server' params on GET
 * /leave/requests (list_my_leave_requests), so Export genuinely reflects
 * every filter, not just Status. Deliberately no Employee filter — "every
 * row is already theirs" (§2.1's own words); HR's/Super Admin's equivalent
 * view is the one that gets it (leave.approvals). The Financial Year filter
 * narrows History only — GET /leave/balances is hard-locked server-side to
 * the CURRENT Financial Year with no override param, so the Balance card
 * above always shows this year regardless of what History's own filter says,
 * matching the prototype's own fixed "FY 2026-27" balance card.
 */
@Component({
  selector: 'app-my-leave',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Leave</h1>
        <p class="page-sub">Your leave balance, history, and a way to apply.</p>
      </div>
      <div class="page-actions">
        <a class="btn sm ghost" routerLink="/leave/holiday-calendar">Holiday Calendar</a>
        @if (!showApply()) {
          <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportRequests('pdf')">
            {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
          </button>
          <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportRequests('excel')">
            {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
          </button>
          <button class="btn sm primary" type="button" (click)="startApply()">Apply for Leave</button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      <div class="rbac-note">
        <app-icon name="info" [size]="14" />
        <div>
          <b>Self-service screens get the full filter and export treatment.</b>
          Looking back over years of leave needs to be narrowed exactly as much as HR does it. There is no Employee filter here, since every row is already yours.
        </div>
      </div>

      <!-- Every control in this filter bar carries an explicit aria-label. The
           bar is label-less by design — each dimension's name lives in its
           "All Leave Types" option or in a tooltip — so the axe sweep flagged
           this whole run as [serious] label-title-only, and the search box as
           an input named by nothing but its placeholder. A title is a tooltip,
           not a name: it never surfaces on touch, it vanishes on keyboard
           focus, and a screen reader falls back to it only as a last resort. A
           placeholder is worse still — it disappears the moment the user
           types, so the name evaporates exactly when the field has content
           worth naming. The titles stay: they are useful tooltips, and the
           cross-cutting filter E2E helpers select on them. See
           company-expenses.component.ts's own filter-row comment (and
           form-screen.component.ts's [attr.aria-label]) for the full
           reasoning. -->
      <div class="filterbar">
        <div class="filter-row">
          <div class="searchbox">
            <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
            <input type="search" aria-label="Search reason" placeholder="Search reason…" [(ngModel)]="searchFilter" (keyup.enter)="load()" (blur)="load()" />
          </div>
          <select class="fselect" aria-label="Leave Type" title="Leave Type" [(ngModel)]="leaveTypeFilter" (ngModelChange)="load()">
            <option value="">All Leave Types</option>
            @for (t of leaveTypes(); track t.id) {
              <option [value]="t.id">{{ t.name }}</option>
            }
          </select>
          <select class="fselect" aria-label="Status" title="Status" [(ngModel)]="statusFilter" (ngModelChange)="load()">
            <option value="">All Statuses</option>
            @for (s of STATUS_OPTIONS; track s.value) {
              <option [value]="s.value">{{ s.label }}</option>
            }
          </select>
          <select class="fselect" aria-label="Financial Year" title="Financial Year" [(ngModel)]="finYearFilter" (ngModelChange)="load()">
            <option value="">All Financial Years</option>
            @for (fy of financialYears(); track fy.id) {
              <option [value]="fy.id">{{ fy.label }}</option>
            }
          </select>
          <select class="fselect" aria-label="Half-Day" title="Half-Day" [(ngModel)]="halfDayFilter" (ngModelChange)="load()">
            <option value="">Half-Day — Any</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <select class="fselect" aria-label="Actioned By" title="Actioned By" [(ngModel)]="actionedByFilter" (ngModelChange)="load()">
            <option value="">Actioned By — Anyone</option>
            @for (u of actionedByOptions(); track u.id) {
              <option [value]="u.id">{{ u.label }}</option>
            }
          </select>
        </div>
        <div class="filter-row">
          <input class="fsearch" type="date" aria-label="Leave Date From" title="Leave Date From" [(ngModel)]="dateFromFilter" (ngModelChange)="load()" style="max-width: 150px;" />
          <input class="fsearch" type="date" aria-label="Leave Date To" title="Leave Date To" [(ngModel)]="dateToFilter" (ngModelChange)="load()" style="max-width: 150px;" />
          <input class="fsearch" type="date" aria-label="Applied From" title="Applied From" [(ngModel)]="appliedFromFilter" (ngModelChange)="load()" style="max-width: 150px;" />
          <input class="fsearch" type="date" aria-label="Applied To" title="Applied To" [(ngModel)]="appliedToFilter" (ngModelChange)="load()" style="max-width: 150px;" />
          @if (hasActiveFilters()) {
            <span class="clear" role="button" (click)="clearFilters()">Clear all</span>
          }
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Leave Balance (This Financial Year)</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leave Type</th>
                <th class="r">Allowed</th>
                <th class="r">Carried Forward</th>
                <th class="r">Adjustments</th>
                <th class="r">Taken</th>
                <th class="r">Pending</th>
                <th class="r">Remaining</th>
              </tr>
            </thead>
            <tbody>
              @for (b of balances(); track b.leave_type_id) {
                <tr>
                  <td>{{ leaveTypeName(b.leave_type_id) }}</td>
                  @if (b.is_quota_tracked) {
                    <td class="mono r">{{ b.allowed_days }}</td>
                    <td class="mono r">{{ b.carried_forward_days }}</td>
                    <td class="mono r">{{ b.adjustment_days }}</td>
                    <td class="mono r">{{ b.taken_days }}</td>
                    <td class="mono r">{{ b.pending_days }}</td>
                    <td class="mono r cell-strong">{{ b.remaining_days }}</td>
                  } @else {
                    <td colspan="6" class="cell-sub">Not tracked — unlimited, not quota-based</td>
                  }
                </tr>
              }
              @if (!balances().length) {
                <tr><td colspan="7" class="cell-sub">No leave balance recorded for this financial year.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (showApply()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Apply for Leave</h3></div>
          <div class="card-body">
            @if (applyError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ applyError() }}</div>
            }
            <!-- Every control below is captioned by a sibling
                 <div class="cell-sub">, which associates nothing — it is a
                 styled div, not a <label for>, so the caption is visible to a
                 sighted user and invisible to everything else. The axe sweep
                 has never flagged these only because it scans this screen with
                 the Apply card closed; they are unnamed controls the instant
                 anyone opens it. The caption's own text becomes each control's
                 aria-label, exactly as form-screen.component.ts puts the plain
                 field.label on the control itself, and aria-required mirrors
                 submitApply()'s own required set. -->
            <div class="grid g-2" style="margin-bottom: 12px;">
              <div>
                <div class="cell-sub">Employee</div>
                <div class="cell-strong">{{ session.user()?.fullName }}</div>
                <div class="hint">Locked to you</div>
              </div>
              <div>
                <div class="cell-sub">Leave Type</div>
                <select class="input" aria-label="Leave Type" aria-required="true" [(ngModel)]="applyForm['leave_type_id']">
                  <option [value]="null">—</option>
                  @for (t of leaveTypes(); track t.id) {
                    <option [value]="t.id">{{ t.name }}</option>
                  }
                </select>
              </div>
              <div><div class="cell-sub">From Date</div><input class="input" type="date" aria-label="From Date" aria-required="true" [(ngModel)]="applyForm['from_date']" /></div>
              <div><div class="cell-sub">To Date</div><input class="input" type="date" aria-label="To Date" aria-required="true" [(ngModel)]="applyForm['to_date']" /></div>
              <div>
                <div class="cell-sub">Half-Day</div>
                <!-- A bare <span> cannot be tabbed to, reports no role, and
                     announces no on/off state — this toggle was not merely
                     unnamed, it was completely invisible to a keyboard and to
                     a screen reader. role/aria-checked/tabindex give it the
                     switch semantics its appearance already implies and
                     Space/Enter mirror the existing click handler, the same
                     fix form-screen.component.ts applies to its own toggle. -->
                <span
                  class="toggle"
                  role="switch"
                  tabindex="0"
                  aria-label="Half-Day"
                  [attr.aria-checked]="!!applyForm['is_half_day']"
                  [class.on]="applyForm['is_half_day']"
                  (click)="applyForm['is_half_day'] = !applyForm['is_half_day']"
                  (keydown.enter)="applyForm['is_half_day'] = !applyForm['is_half_day']"
                  (keydown.space)="$event.preventDefault(); applyForm['is_half_day'] = !applyForm['is_half_day']"
                >
                  <span class="track"></span>
                </span>
              </div>
              @if (applyForm['is_half_day']) {
                <div>
                  <div class="cell-sub">Which Half</div>
                  <select class="input" aria-label="Which Half" [(ngModel)]="applyForm['half_day_session']">
                    <option value="FIRST_HALF">First Half</option>
                    <option value="SECOND_HALF">Second Half</option>
                  </select>
                </div>
              }
              <div style="grid-column: span 2;">
                <div class="cell-sub">Reason</div>
                <textarea class="input" rows="3" aria-label="Reason" aria-required="true" [(ngModel)]="applyForm['reason']"></textarea>
              </div>
              <div>
                <div class="cell-sub">Remaining for this Leave Type</div>
                <div class="mono cell-strong">{{ remainingForSelectedType() }}</div>
                <div class="hint">Allowed + Carried Forward − Taken − Pending. Insufficient balance is a hard block on submit.</div>
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="applying()" (click)="showApply.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="applying()" (click)="submitApply()">
              {{ applying() ? 'Submitting…' : 'Submit' }}
            </button>
          </div>
        </div>
      }

      <div class="card">
        <div class="card-head">
          <h3>Leave History</h3>
          <span class="cell-sub">{{ requests().length }} request{{ requests().length === 1 ? '' : 's' }}</span>
        </div>
        @if (actionError()) {
          <div class="form-error" style="margin: 14px;">{{ actionError() }}</div>
        }
        @if (exportError()) {
          <div class="form-error" style="margin: 14px;">{{ exportError() }}</div>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leave Type</th>
                <th>From</th>
                <th>To</th>
                <th class="r">Days</th>
                <th>Half-Day</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actioned By</th>
                <th>Applied On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of requests(); track r.id) {
                <tr>
                  <td>{{ leaveTypeName(r.leave_type_id) }}</td>
                  <td class="mono">{{ r.from_date }}</td>
                  <td class="mono">{{ r.to_date }}</td>
                  <td class="mono r">{{ r.days_requested }}</td>
                  <td>{{ r.is_half_day ? (r.half_day_session === 'FIRST_HALF' ? 'First Half' : 'Second Half') : 'No' }}</td>
                  <td>{{ r.reason }}</td>
                  <td>
                    <span class="badge-s" [class.b-warn]="r.status === 'PENDING'" [class.b-ok]="r.status === 'APPROVED'" [class.b-danger]="r.status === 'REJECTED'" [class.b-outline]="r.status === 'CANCELLED'">{{ statusLabel(r.status) }}</span>
                  </td>
                  <td class="mono">{{ actionedByLabel(r.actioned_by) }}</td>
                  <td class="mono">{{ r.applied_at.slice(0, 10) }}</td>
                  <td>
                    @if (r.status === 'PENDING') {
                      <button class="btn sm ghost" type="button" (click)="cancelRequest(r)">Cancel</button>
                    }
                  </td>
                </tr>
              }
              @if (!requests().length) {
                <tr><td colspan="10" class="cell-sub">No leave requests match these filters.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div style="padding: 10px 14px; font-size: 11px; color: var(--text-tertiary);">You are notified by email and in-app the moment a request is Approved or Rejected.</div>
      </div>
    }
  `,
})
export class MyLeaveComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly refData = inject(RefDataService);
  protected readonly session = inject(SessionStore);

  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly balances = signal<readonly LeaveBalanceRow[]>([]);
  protected readonly requests = signal<readonly LeaveRequestRow[]>([]);
  protected readonly leaveTypes = signal<readonly LeaveTypeOption[]>([]);
  protected readonly financialYears = signal<readonly FinancialYearOption[]>([]);
  protected statusFilter = '';
  protected leaveTypeFilter = '';
  protected finYearFilter = '';
  protected halfDayFilter = '';
  protected actionedByFilter = '';
  protected dateFromFilter = '';
  protected dateToFilter = '';
  protected appliedFromFilter = '';
  protected appliedToFilter = '';
  protected searchFilter = '';

  protected readonly showApply = signal(false);
  protected readonly applying = signal(false);
  protected readonly applyError = signal<string | null>(null);
  protected applyForm: Record<string, unknown> = {};

  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<LeaveTypeOption[]>(`${environment.apiBaseUrl}/masters/leave-types`).subscribe({
      next: (rows) => this.leaveTypes.set(rows),
      error: () => this.leaveTypes.set([]),
    });
    this.http.get<FinancialYearOption[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows),
      error: () => this.financialYears.set([]),
    });
    this.load();
  }

  protected leaveTypeName(id: string): string {
    return this.leaveTypes().find((t) => t.id === id)?.name ?? id;
  }

  protected statusLabel(v: string): string {
    return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  protected actionedByLabel(userId: string | null): string {
    return userId ? this.refData.label(USER_REF, userId) : '—';
  }

  // Row-derived, same reasoning as ticket.list.config.ts's own
  // raisedByOptions — no dedicated "who has decided on MY requests"
  // endpoint, so the option list is whatever actioned_by values are
  // actually present on the currently-loaded page.
  protected actionedByOptions(): { id: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const r of this.requests()) {
      if (r.actioned_by && !seen.has(r.actioned_by)) seen.set(r.actioned_by, this.refData.label(USER_REF, r.actioned_by));
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }

  protected hasActiveFilters(): boolean {
    return !!(
      this.statusFilter || this.leaveTypeFilter || this.finYearFilter || this.halfDayFilter ||
      this.actionedByFilter || this.dateFromFilter || this.dateToFilter || this.appliedFromFilter ||
      this.appliedToFilter || this.searchFilter
    );
  }

  protected clearFilters(): void {
    this.statusFilter = this.leaveTypeFilter = this.finYearFilter = this.halfDayFilter = this.actionedByFilter = '';
    this.dateFromFilter = this.dateToFilter = this.appliedFromFilter = this.appliedToFilter = this.searchFilter = '';
    this.load();
  }

  protected remainingForSelectedType(): string {
    const id = this.applyForm['leave_type_id'] as string | null;
    if (!id) return '—';
    const b = this.balances().find((x) => x.leave_type_id === id);
    if (!b) return '—';
    return b.is_quota_tracked ? b.remaining_days : 'Not tracked';
  }

  private buildRequestParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.statusFilter) params.set('status', this.statusFilter);
    if (this.leaveTypeFilter) params.set('leave_type_id', this.leaveTypeFilter);
    if (this.finYearFilter) params.set('financial_year_id', this.finYearFilter);
    if (this.halfDayFilter) params.set('half_day', this.halfDayFilter === 'yes' ? 'true' : 'false');
    if (this.actionedByFilter) params.set('actioned_by', this.actionedByFilter);
    if (this.dateFromFilter) params.set('date_from', this.dateFromFilter);
    if (this.dateToFilter) params.set('date_to', this.dateToFilter);
    if (this.appliedFromFilter) params.set('applied_from', this.appliedFromFilter);
    if (this.appliedToFilter) params.set('applied_to', this.appliedToFilter);
    if (this.searchFilter.trim()) params.set('search', this.searchFilter.trim());
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    this.http.get<LeaveBalanceRow[]>(`${environment.apiBaseUrl}/leave/balances`).subscribe({
      next: (rows) => this.balances.set(rows),
      error: () => this.balances.set([]),
    });
    const qs = this.buildRequestParams().toString();
    this.http.get<LeaveRequestRow[]>(`${environment.apiBaseUrl}/leave/requests${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.requests.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startApply(): void {
    this.applyForm = { leave_type_id: null, from_date: '', to_date: '', is_half_day: false, half_day_session: 'FIRST_HALF', reason: '' };
    this.applyError.set(null);
    this.showApply.set(true);
  }

  protected submitApply(): void {
    if (!this.applyForm['leave_type_id'] || !this.applyForm['from_date'] || !this.applyForm['to_date'] || !this.applyForm['reason']) {
      this.applyError.set('Leave Type, From Date, To Date, and Reason are all required.');
      return;
    }
    this.applying.set(true);
    this.applyError.set(null);
    const body = { ...this.applyForm, half_day_session: this.applyForm['is_half_day'] ? this.applyForm['half_day_session'] : null };
    this.http.post(`${environment.apiBaseUrl}/leave/requests`, body).subscribe({
      next: () => {
        this.applying.set(false);
        this.showApply.set(false);
        this.load();
      },
      error: (err) => {
        this.applying.set(false);
        const detail = err?.error?.detail;
        this.applyError.set(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ') : 'Failed to submit.');
      },
    });
  }

  protected cancelRequest(r: LeaveRequestRow): void {
    if (!window.confirm('Cancel this leave request?')) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}/leave/requests/${r.id}/cancel`, {}).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to cancel this request.'),
    });
  }

  protected exportRequests(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.buildRequestParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/leave/requests?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `My Leave Requests.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: () => {
        this.exporting.set(null);
        this.exportError.set('Failed to export.');
      },
    });
  }
}
