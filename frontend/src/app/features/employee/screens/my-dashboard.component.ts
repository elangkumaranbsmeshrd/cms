import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { routeForScreen } from '../../../layout/nav-registry';
import { formatMoney } from '../../../shared/screens/cell-format';

interface LeaveBalanceSnapshot {
  readonly leave_type: string;
  readonly allowed_days: number;
  readonly taken_days: number;
  readonly pending_days: number;
  readonly remaining_days: number;
}
interface LatestPayslip {
  readonly payslip_id: string;
  readonly period_month: number;
  readonly period_year: number;
  readonly net_pay: number;
  readonly salary_credit_date: string;
}
interface AnnouncementSnapshot {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly published_at: string;
}
interface ActivityItem {
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly created_at: string;
  readonly is_read: boolean;
}
interface QuickLink {
  readonly screen: string;
  readonly label: string;
  readonly path: string;
}
interface TeamSnapshot {
  readonly pending_leave_requests_count: number;
  readonly open_tickets_count: number;
}
interface DashboardData {
  readonly leave_balance_snapshot: readonly LeaveBalanceSnapshot[];
  readonly latest_payslip: LatestPayslip | null;
  readonly open_tickets_count: number;
  readonly pending_tasks_count: number;
  readonly assigned_assets_count: number;
  readonly announcements: readonly AnnouncementSnapshot[];
  readonly recent_activity: readonly ActivityItem[];
  readonly quick_links: readonly QuickLink[];
  readonly my_team?: TeamSnapshot;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** §2.10 Dashboard — GET /employees/me/dashboard, one bundled response
 * (leave/payslip/counts/announcements/activity/quick links, +my_team for
 * Managers). Bespoke rather than DashboardScreenConfig: that shape's own
 * design is "every widget fetches its own real endpoint independently"
 * (per its doc comment), which doesn't fit an endpoint that's already
 * bundled server-side — some of this data (My Team's ticket count, the
 * announcement feed's own expiry/department filtering) has NO standalone
 * endpoint to point a per-widget fetch at.
 *
 * quick_links[].path is a BACKEND API path, not a frontend route — mapped
 * through routeForScreen(quick_links[].screen) instead of navigated to
 * directly.
 */
@Component({
  selector: 'app-my-dashboard',
  standalone: true,
  imports: [],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Dashboard</h1>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty"><p>{{ loadError() }}</p></div>
    } @else if (!data()) {
      <div class="empty"><p>No employee record is linked to your login.</p></div>
    } @else {
    @if (data(); as d) {
      <div class="grid g-4" style="margin-bottom: 16px;">
        <div class="card"><div class="card-body"><div class="cell-sub">Open Tickets</div><div class="cell-strong" style="font-size: 22px;">{{ d.open_tickets_count }}</div></div></div>
        <div class="card"><div class="card-body"><div class="cell-sub">Pending Tasks</div><div class="cell-strong" style="font-size: 22px;">{{ d.pending_tasks_count }}</div></div></div>
        <div class="card"><div class="card-body"><div class="cell-sub">Assigned Assets</div><div class="cell-strong" style="font-size: 22px;">{{ d.assigned_assets_count }}</div></div></div>
        @if (d.latest_payslip; as p) {
          <div class="card"><div class="card-body"><div class="cell-sub">Latest Payslip — {{ MONTH_NAMES[p.period_month] }} {{ p.period_year }}</div><div class="cell-strong" style="font-size: 22px;">{{ formatMoney(p.net_pay) }}</div></div></div>
        }
      </div>

      @if (d.my_team; as team) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>My Team</h3></div>
          <div class="card-body grid g-2">
            <div><div class="cell-sub">Pending Leave Requests</div><div class="cell-strong">{{ team.pending_leave_requests_count }}</div></div>
            <div><div class="cell-sub">Open Tickets</div><div class="cell-strong">{{ team.open_tickets_count }}</div></div>
          </div>
        </div>
      }

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head"><h3>Leave Balance</h3></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Leave Type</th><th class="r">Allowed</th><th class="r">Taken</th><th class="r">Pending</th><th class="r">Remaining</th></tr>
            </thead>
            <tbody>
              @for (b of d.leave_balance_snapshot; track b.leave_type) {
                <tr>
                  <td>{{ b.leave_type }}</td>
                  <td class="mono r">{{ b.allowed_days }}</td>
                  <td class="mono r">{{ b.taken_days }}</td>
                  <td class="mono r">{{ b.pending_days }}</td>
                  <td class="mono r cell-strong">{{ b.remaining_days }}</td>
                </tr>
              }
              @if (!d.leave_balance_snapshot.length) {
                <tr><td colspan="5" class="cell-sub">No leave balance recorded.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid g-2" style="margin-bottom: 16px; align-items: start;">
        <div class="card">
          <div class="card-head"><h3>Announcements</h3></div>
          <div class="card-body">
            @for (a of d.announcements; track a.id) {
              <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line);">
                <div class="cell-strong">{{ a.title }}</div>
                <div class="cell-sub mono">{{ a.published_at.slice(0, 10) }}</div>
                <div style="margin-top: 4px;">{{ a.message }}</div>
              </div>
            }
            @if (!d.announcements.length) {
              <p class="hint" style="margin: 0;">No announcements right now.</p>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Recent Activity</h3></div>
          <div class="card-body">
            @for (a of d.recent_activity; track a.created_at + a.title) {
              <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line);">
                <div [class.cell-strong]="!a.is_read">{{ a.title }}</div>
                <div class="cell-sub">{{ a.body }}</div>
                <div class="cell-sub mono">{{ a.created_at.slice(0, 10) }}</div>
              </div>
            }
            @if (!d.recent_activity.length) {
              <p class="hint" style="margin: 0;">No recent activity.</p>
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Quick Links</h3></div>
        <div class="card-body filter-row" style="flex-wrap: wrap;">
          @for (link of d.quick_links; track link.screen) {
            <button class="btn sm ghost" type="button" (click)="goTo(link)">{{ link.label }}</button>
          }
        </div>
      </div>
    }
    }
  `,
})
export class MyDashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly formatMoney = formatMoney;
  protected readonly MONTH_NAMES = MONTH_NAMES;

  protected readonly isLoading = signal(true);
  protected readonly data = signal<DashboardData | null>(null);
  /** Only a 404 genuinely means "this login has no Employee row". Every other
   * failure used to land on that same message, so a 500 or a dropped
   * connection told the user something factually untrue about their account. */
  protected readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<DashboardData>(`${environment.apiBaseUrl}/employees/me/dashboard`).subscribe({
      next: (d) => {
        this.data.set(d);
        this.isLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (err.status !== 404) {
          this.loadError.set(
            typeof err.error?.detail === 'string'
              ? err.error.detail
              : 'Could not load your dashboard. Please retry in a moment.',
          );
        }
        this.isLoading.set(false);
      },
    });
  }

  protected goTo(link: QuickLink): void {
    this.router.navigate(routeForScreen(link.screen));
  }
}
