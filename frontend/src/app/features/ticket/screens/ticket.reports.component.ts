import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { EM_DASH } from '../../../shared/screens/cell-format';
import { buildDatePresets, CUSTOM_PRESET, DatePreset, FinancialYearLike, resolveRange } from '../../../shared/screens/date-presets';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import {
  TICKET_CATEGORY_REF,
  TICKET_CUSTOMER_REF,
  TICKET_EMPLOYEE_REF,
  TICKET_PRIORITY_OPTIONS,
  TICKET_STATUS_OPTIONS,
  TicketReportsSummary,
} from '../ticket.api';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

/** §2.5 Support Reports (ticket.reports — a SEPARATE RBAC screen key from
 * ticket.list, zero actions: read-only for whoever can open it). Bespoke, not
 * ReportScreenConfig — confirmed by reading report-screen.component.ts:
 * ReportTableDef.tableRows() does `Array.isArray(data) ? data : []` on the
 * RAW source response with no nested-path plucking, but GET
 * /tickets/reports/summary returns ONE combined object with top_customers
 * nested inside it, not a top-level array response. Every filter here is a
 * plain single-value control — unlike ticket.list's same-named filters,
 * every one of this endpoint's query params takes exactly one value
 * (api/v1/tickets.py's support_reports), so multiselect would send something
 * the backend can't parse.
 *
 * KPI row and the two breakdown tables mirror the prototype's own report
 * shape exactly (app-screens.js:403-412): FOUR kpis (Open + In Progress and
 * Resolved / Closed each pre-combined into one tile, then the two average
 * durations) — not one tile per status/priority value, which is what an
 * earlier pass through this file drew instead, silently dropping the
 * prototype's own Share % column in the process. "2 unassigned" /
 * "6 unassigned" style KPI foot text from the prototype's mock is NOT
 * reproduced on the Open + In Progress tile — support_reports (api/v1/
 * tickets.py) returns no unassigned-count breakdown at all, and this screen
 * does not fabricate one.
 *
 * Top customers has no Open-count column even though the prototype's own
 * mock table shows one ('Top customers by ticket volume', Customer/Ticket
 * Count/Open) — support_reports's own top_customers computation
 * (api/v1/tickets.py:480-483) tallies ticket_count only, no per-customer
 * open/closed split; a real gap, flagged in this module's build report
 * rather than invented client-side.
 *
 * Date Range is a preset dropdown (This Month/Last Month/This Quarter/This
 * Financial Year/…/Custom…), not a bare pair of date inputs — §2.5's own
 * words: "Plus the baseline set from the Filter & Export Convention…
 * including the financial-year date presets, which read Masters → Financial
 * Year rather than hardcoding period boundaries." Same buildDatePresets()/
 * resolveRange() machinery ListScreenComponent's own 'daterange' filter kind
 * uses, wired by hand since this is a bespoke component — same technique
 * already used by all-expenses.component.ts's own Period filter.
 *
 * No export anywhere on this screen: the endpoint is a pure aggregate with no
 * flat row list to export (its own docstring: "not a flat row list — same
 * situation as Opportunity's stage-summary").
 */
@Component({
  selector: 'app-ticket-reports',
  standalone: true,
  imports: [FormsModule, IconComponent, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Support Reports <span class="spec-ref">§2.5</span></h1>
        <p class="page-sub">Ticket volume, priority mix and response times.</p>
      </div>
    </div>

    <div class="filterbar" style="margin-bottom: 16px;">
      <div class="filter-row">
        <select class="fselect" title="Date Range" [(ngModel)]="periodPreset" (ngModelChange)="onPeriodPresetChange()">
          <option value="">All Dates</option>
          @for (p of presets(); track p.value) {
            <option [value]="p.value">{{ p.label }}</option>
          }
        </select>
        @if (periodPreset === CUSTOM_PRESET) {
          <input class="fsearch" type="date" title="From" [(ngModel)]="dateFrom" (ngModelChange)="refetch()" style="max-width: 150px;" />
          <input class="fsearch" type="date" title="To" [(ngModel)]="dateTo" (ngModelChange)="refetch()" style="max-width: 150px;" />
        }
        <select class="fselect" title="Category" [(ngModel)]="categoryId" (ngModelChange)="refetch()">
          <option [ngValue]="null">All Categories</option>
          @for (opt of categoryOptions(); track opt.id) {
            <option [ngValue]="opt.id">{{ opt.label }}</option>
          }
        </select>
        <select class="fselect" title="Assigned To" [(ngModel)]="assignedTo" (ngModelChange)="refetch()">
          <option [ngValue]="null">All Staff</option>
          @for (opt of employeeOptions(); track opt.id) {
            <option [ngValue]="opt.id">{{ opt.label }}</option>
          }
        </select>
        <select class="fselect" title="Customer" [(ngModel)]="customerId" (ngModelChange)="refetch()">
          <option [ngValue]="null">All Customers</option>
          @for (opt of customerOptions(); track opt.id) {
            <option [ngValue]="opt.id">{{ opt.label }}</option>
          }
        </select>
        <select class="fselect" title="Priority" [(ngModel)]="priority" (ngModelChange)="refetch()">
          <option [ngValue]="null">All Priorities</option>
          @for (opt of PRIORITY_OPTIONS; track opt.value) {
            <option [ngValue]="opt.value">{{ opt.label }}</option>
          }
        </select>
        <select class="fselect" title="Status" [(ngModel)]="status" (ngModelChange)="refetch()">
          <option [ngValue]="null">All Statuses</option>
          @for (opt of STATUS_OPTIONS; track opt.value) {
            <option [ngValue]="opt.value">{{ opt.label }}</option>
          }
        </select>
        @if (hasActiveFilters()) {
          <span class="clear" role="button" (click)="clearFilters()">Clear all</span>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this report</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (summary(); as s) {
        <!-- app-screens.js:404-407's own 4 kpis — Open+In Progress and
             Resolved/Closed each pre-combined into one tile (not one tile per
             status value), plus the two average durations. -->
        <div class="grid g-kpi" style="margin-bottom: 16px;">
          <div class="kpi" style="--tone: var(--warning); --tone-bg: var(--warning-bg);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="ticket" [size]="14" /></div>
              <div class="kpi-label">Open + In Progress</div>
            </div>
            <div class="kpi-val num">{{ openAndInProgress(s) }}</div>
          </div>
          <div class="kpi" style="--tone: var(--success); --tone-bg: var(--success-bg);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="check" [size]="14" /></div>
              <div class="kpi-label">Resolved / Closed</div>
            </div>
            <div class="kpi-val num">{{ resolvedAndClosed(s) }}</div>
          </div>
          <div class="kpi" style="--tone: var(--accent); --tone-bg: var(--accent-subtle);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="clock" [size]="14" /></div>
              <div class="kpi-label">Avg First Response</div>
            </div>
            <div class="kpi-val">{{ s.average_first_response_time ?? EM_DASH }}</div>
          </div>
          <div class="kpi" style="--tone: var(--info); --tone-bg: var(--info-bg);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="refresh" [size]="14" /></div>
              <div class="kpi-label">Avg Resolve Time</div>
            </div>
            <div class="kpi-val">{{ s.average_resolve_time ?? EM_DASH }}</div>
          </div>
        </div>

        <!-- app-screens.js:409-410 — a Count + Share breakdown table per
             dimension, not a tile per value (that dropped Share entirely). -->
        <div class="grid g-2" style="margin-bottom: 16px;">
          <div class="card">
            <div class="card-head"><h3>Ticket count by Status</h3></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Status</th><th class="r">Count</th><th class="r">Share</th></tr></thead>
                <tbody>
                  @for (row of breakdown(s.by_status, STATUS_OPTIONS); track row.label) {
                    <tr>
                      <td>{{ row.label }}</td>
                      <td class="r num">{{ row.count }}</td>
                      <td class="r num">{{ row.share }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>Ticket count by Priority</h3></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Priority</th><th class="r">Count</th><th class="r">Share</th></tr></thead>
                <tbody>
                  @for (row of breakdown(s.by_priority, PRIORITY_OPTIONS); track row.label) {
                    <tr>
                      <td>{{ row.label }}</td>
                      <td class="r num">{{ row.count }}</td>
                      <td class="r num">{{ row.share }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Top 10 Customers</h3>
            @if (s.top_customers.length) {
              <span class="sub">{{ s.top_customers.length }} customer{{ s.top_customers.length === 1 ? '' : 's' }}</span>
            }
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th class="r">Ticket Count</th>
                </tr>
              </thead>
              <tbody>
                @for (c of s.top_customers; track c.customer_id) {
                  <tr>
                    <td>{{ customerLabel(c.customer_id) }}</td>
                    <td class="r num">{{ c.ticket_count }}</td>
                  </tr>
                }
                @if (!s.top_customers.length) {
                  <tr>
                    <td colspan="2" class="cell-sub">No tickets match the filters currently applied.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    }
  `,
})
export class TicketReportsComponent {
  private readonly http = inject(HttpClient);
  private readonly refData = inject(RefDataService);

  protected readonly EM_DASH = EM_DASH;
  protected readonly PRIORITY_OPTIONS = TICKET_PRIORITY_OPTIONS;
  protected readonly STATUS_OPTIONS = TICKET_STATUS_OPTIONS;
  protected readonly CUSTOM_PRESET = CUSTOM_PRESET;

  protected dateFrom: string | null = null;
  protected dateTo: string | null = null;
  protected periodPreset = '';
  protected categoryId: string | null = null;
  protected assignedTo: string | null = null;
  protected customerId: string | null = null;
  protected priority: string | null = null;
  protected status: string | null = null;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly summary = signal<TicketReportsSummary | null>(null);
  // §2.2c financial-year presets for the Date Range filter — same source
  // ListScreenComponent's own 'daterange' filter kind reads, wired by hand.
  protected readonly financialYears = signal<readonly FinancialYearLike[]>([]);

  constructor() {
    // Degrades to calendar-only presets on a 403/empty response, same as
    // ListScreenComponent's own daterange kind.
    this.http.get<FinancialYearLike[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows ?? []),
      error: () => this.financialYears.set([]),
    });
    this.fetch();
  }

  protected presets(): readonly DatePreset[] {
    return buildDatePresets(this.financialYears());
  }

  protected onPeriodPresetChange(): void {
    if (this.periodPreset === CUSTOM_PRESET) return; // leave dateFrom/dateTo for manual entry
    if (!this.periodPreset) {
      this.dateFrom = null;
      this.dateTo = null;
    } else {
      const range = resolveRange({ preset: this.periodPreset, from: null, to: null }, this.presets());
      this.dateFrom = range.from;
      this.dateTo = range.to;
    }
    this.refetch();
  }

  protected categoryOptions() {
    return this.refData.options(TICKET_CATEGORY_REF) ?? [];
  }
  protected employeeOptions() {
    return this.refData.options(TICKET_EMPLOYEE_REF) ?? [];
  }
  protected customerOptions() {
    return this.refData.options(TICKET_CUSTOMER_REF) ?? [];
  }

  protected customerLabel(id: string): string {
    return this.refData.label(TICKET_CUSTOMER_REF, id);
  }

  protected hasActiveFilters(): boolean {
    return !!(this.periodPreset || this.categoryId || this.assignedTo || this.customerId || this.priority || this.status);
  }

  protected clearFilters(): void {
    this.dateFrom = this.dateTo = this.categoryId = this.assignedTo = this.customerId = this.priority = this.status = null;
    this.periodPreset = '';
    this.refetch();
  }

  protected refetch(): void {
    this.fetch();
  }

  private fetch(): void {
    let params = new HttpParams();
    if (this.dateFrom) params = params.set('date_from', this.dateFrom);
    if (this.dateTo) params = params.set('date_to', this.dateTo);
    if (this.categoryId) params = params.set('category_id', this.categoryId);
    if (this.assignedTo) params = params.set('assigned_to', this.assignedTo);
    if (this.customerId) params = params.set('customer_id', this.customerId);
    if (this.priority) params = params.set('priority', this.priority);
    // support_reports's own param is `status_filter`, aliased to `status` —
    // the query string key sent here must be the alias (api/v1/tickets.py).
    if (this.status) params = params.set('status', this.status);

    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<TicketReportsSummary>(`${environment.apiBaseUrl}/tickets/reports/summary`, { params }).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this report.');
        this.isLoading.set(false);
      },
    });
  }

  protected openAndInProgress(s: TicketReportsSummary): number {
    return (s.by_status['OPEN'] ?? 0) + (s.by_status['IN_PROGRESS'] ?? 0);
  }

  protected resolvedAndClosed(s: TicketReportsSummary): number {
    return (s.by_status['RESOLVED'] ?? 0) + (s.by_status['CLOSED'] ?? 0);
  }

  /** Count + Share % per value — app-screens.js:409-410's own two tables.
   * Share is against the total across all values in this same breakdown
   * (by_status/by_priority each sum to the same overall ticket count), not
   * against some other denominator. */
  protected breakdown(counts: Record<string, number>, options: readonly { value: string; label: string }[]): { label: string; count: number; share: string }[] {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return options.map((o) => {
      const count = counts[o.value] ?? 0;
      const share = total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
      return { label: o.label, count, share };
    });
  }
}
