import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { EM_DASH, formatDate, formatMoney, isBlank } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { PAYMENT_MODE_REF } from '../invoice.api';

interface OverdueInvoiceRow {
  readonly invoice_number: string;
  readonly customer: string;
  readonly amount: number;
  readonly due_date: string | null;
}
interface RecentPaymentRow {
  readonly customer: string;
  readonly amount: number;
  readonly mode: string | null; // raw payment_mode_id — resolved via RefDataService, unlike overdue_invoices' customer/amount which are already plain strings
  readonly date: string;
}
// §6.2 "Show Non-Financial Dashboard Widgets to HR" — OFF by default (HR has
// no access at all); ON, HR reaches this same endpoint but every revenue
// figure comes back null and both tables come back empty (invoice_dashboard(),
// api/v1/invoices.py) — never a separate response shape, so this interface
// stays one type with 5 nullable fields rather than a union.
interface InvoiceDashboardData {
  readonly total_invoiced: number | null;
  readonly total_received: number | null;
  readonly outstanding: number | null;
  readonly overdue_count: number | null;
  readonly overdue_invoices: readonly OverdueInvoiceRow[];
  readonly recent_payments: readonly RecentPaymentRow[];
  readonly active_employees: number;
  readonly total_expenses: number | null;
  readonly active_projects: number;
  readonly open_tickets: number;
}

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

// Same tone->CSS-var mapping every bespoke KPI-tile screen in this app
// duplicates locally rather than importing (dashboard-screen.component.ts's
// own private TONE_VAR/TONE_BG_VAR; compliance.overview.component.ts copies
// it for the identical reason stated there) — this component reuses the
// shared `.kpi`/`.grid.g-kpi`/`.kpi-top`/`.kpi-ico`/`.kpi-val`/`.kpi-foot`
// CSS classes for visual consistency, not either generic shape's own fetch
// machinery (see the class doc below for why neither fits this data).
const TONE_VAR: Record<Tone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};
const TONE_BG_VAR: Record<Tone, string> = {
  accent: 'var(--accent-subtle)',
  success: 'var(--success-bg)',
  warning: 'var(--warning-bg)',
  danger: 'var(--danger-bg)',
  info: 'var(--info-bg)',
};

interface Tile {
  readonly label: string;
  readonly icon: string;
  readonly tone: Tone;
  readonly value: string;
  readonly unit?: string;
  readonly foot: string;
  readonly route: readonly string[];
}

const INVOICES_ROUTE = ['/invoices'] as const;

/** The prototype's inrAbbr() (app-core.js), ported verbatim: >=1L as
 * '₹X.XL', >=1K as '₹X.XK', else the plain rupee figure. Dashboard-tile-only
 * — §2.1's own text is explicit that this is the ONE screen in the module
 * that abbreviates ("Large numbers use lakh/thousand abbreviation;
 * individual invoice records never do"), so this deliberately does not live
 * in the shared cell-format.ts formatMoney() every other money cell in the
 * app (including this same dashboard's own two tables) goes through. */
function inrAbbr(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs}`;
}

/** §2.1 Invoice Dashboard — GET /invoices/dashboard, ONE bundled object (not
 * an array), same reason my-dashboard.component.ts is bespoke rather than
 * DashboardScreenConfig/ReportScreenConfig: both generic shapes do
 * `Array.isArray(data) ? data : []` directly on a widget/table's raw fetch,
 * so pointing either at this endpoint renders permanently empty.
 *
 * Two things the prototype's own R.invdash (app-screens2.js) shows that this
 * screen deliberately does NOT reproduce, both confirmed against the real
 * endpoint rather than faked:
 *   - A Period/Customer filter bar — invoice_dashboard() (api/v1/invoices.py)
 *     takes no query params at all; every figure is an unconditional
 *     company-wide total. A filter bar that visibly did nothing on submit
 *     would be worse than no filter bar.
 *   - Page-level Export PDF/Export Excel actions — the same endpoint has no
 *     `format=` branch (unlike GET /invoices, which does, and is already
 *     exportable from the Invoice List screen). A button wired to nothing
 *     would be exactly the kind of fake affordance the real app is supposed
 *     to have replaced.
 */
@Component({
  selector: 'app-invoice-dashboard',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Invoice Dashboard <span class="spec-ref">§2.1</span></h1>
        <p class="page-sub">Company-wide figures pulled from four other modules, live from the real backend.</p>
      </div>
      <div class="page-actions">
        @if (canCreate()) {
          <button class="btn primary" type="button" (click)="createInvoice()">
            <app-icon name="plus" [size]="14" />New Invoice
          </button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load the dashboard</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (data(); as d) {
      <div class="rbac-note">
        <app-icon name="info" [size]="14" />
        <div>
          @if (isRestricted(d)) {
            Operational widgets only — revenue figures are hidden on this account.
          } @else {
            This dashboard pulls from four other modules — Expense, Project, Ticket and Employee — company-wide. Large figures use lakh/thousand abbreviation; individual invoice records always show the full rupee figure.
          }
        </div>
      </div>

      @if (!isRestricted(d)) {
      <div class="grid g-kpi" style="margin-bottom: 16px;">
        @for (t of financeTiles(d); track t.label) {
          <div class="kpi" [style.--tone]="toneVar(t.tone)" [style.--tone-bg]="toneBgVar(t.tone)" role="button" (click)="openTile(t)">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon [name]="t.icon" [size]="14" /></div>
              <div class="kpi-label">{{ t.label }}</div>
            </div>
            <div class="kpi-val num">{{ t.value }}@if (t.unit) {<small> {{ t.unit }}</small>}</div>
            <div class="kpi-foot"><span>{{ t.foot }}</span></div>
          </div>
        }
      </div>
      }

      <div class="grid g-kpi" style="margin-bottom: 16px;">
        @for (t of opsTiles(d); track t.label) {
          <div class="kpi" [style.--tone]="toneVar(t.tone)" [style.--tone-bg]="toneBgVar(t.tone)" role="button" (click)="openTile(t)">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon [name]="t.icon" [size]="14" /></div>
              <div class="kpi-label">{{ t.label }}</div>
            </div>
            <div class="kpi-val num">{{ t.value }}@if (t.unit) {<small> {{ t.unit }}</small>}</div>
            <div class="kpi-foot"><span>{{ t.foot }}</span></div>
          </div>
        }
      </div>

      @if (!isRestricted(d)) {
      <div class="grid g-2">
        <div class="card">
          <div class="card-head">
            <h3>Overdue Invoices</h3>
            <span class="sub">Invoice Number, Customer, Amount, Due Date</span>
          </div>
          <div class="card-body flush">
            @if (!d.overdue_invoices.length) {
              <div class="empty">
                <div class="ico">∅</div>
                <p>No overdue invoices.</p>
              </div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice Number</th>
                      <th>Customer</th>
                      <th class="r">Amount</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of d.overdue_invoices; track r.invoice_number) {
                      <tr class="clickable" (click)="goToInvoices()">
                        <td class="mono cell-accent">{{ r.invoice_number }}</td>
                        <td>{{ r.customer }}</td>
                        <td class="mono r">{{ formatMoney(r.amount) }}</td>
                        <td class="mono">{{ r.due_date ? formatDate(r.due_date) : EM_DASH }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <div class="card-foot">
            <span class="link" role="button" (click)="goToInvoices()">Open the Invoice List<app-icon name="arrow" [size]="12" [width]="2.4" /></span>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>Recent Payments</h3>
            <span class="sub">Customer, Amount, Mode, Date</span>
          </div>
          <div class="card-body flush">
            @if (!d.recent_payments.length) {
              <div class="empty">
                <div class="ico">∅</div>
                <p>No recent payments.</p>
              </div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th class="r">Amount</th>
                      <th>Mode</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of d.recent_payments; track r.customer + r.date + r.amount) {
                      <tr class="clickable" (click)="goToInvoices()">
                        <td>{{ r.customer }}</td>
                        <td class="mono r">{{ formatMoney(r.amount) }}</td>
                        <td>{{ modeLabel(r.mode) }}</td>
                        <td class="mono">{{ formatDate(r.date) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <div class="card-foot">
            <span class="link" role="button" (click)="goToInvoices()">Record a payment<app-icon name="arrow" [size]="12" [width]="2.4" /></span>
          </div>
        </div>
      </div>
      }
      }
    }
  `,
})
export class InvoiceDashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);

  protected readonly EM_DASH = EM_DASH;
  protected readonly formatMoney = formatMoney;
  protected readonly formatDate = formatDate;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly data = signal<InvoiceDashboardData | null>(null);

  ngOnInit(): void {
    this.http.get<InvoiceDashboardData>(`${environment.apiBaseUrl}/invoices/dashboard`).subscribe({
      next: (d) => {
        this.data.set(d);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the dashboard.');
        this.isLoading.set(false);
      },
    });
  }

  protected modeLabel(id: string | null): string {
    if (!id) return EM_DASH;
    const label = this.refData.label(PAYMENT_MODE_REF, id);
    return isBlank(label) ? EM_DASH : label;
  }

  // ---- tiles (prototype: financeKpis()/opsKpis(), app-screens.js) -------

  protected toneVar(tone: Tone): string {
    return TONE_VAR[tone];
  }
  protected toneBgVar(tone: Tone): string {
    return TONE_BG_VAR[tone];
  }

  // Only ever called from inside the template's own `@if (!isRestricted(d))`
  // guard, but the type stays the full (nullable) InvoiceDashboardData
  // regardless — the `?? 0` fallbacks below are belt-and-braces for the
  // type checker, not a real runtime path (a non-restricted response never
  // actually carries a null here).
  protected financeTiles(d: InvoiceDashboardData): readonly Tile[] {
    return [
      { label: 'Total Invoiced', icon: 'rupee', tone: 'accent', value: inrAbbr(d.total_invoiced), foot: formatMoney(d.total_invoiced ?? 0), route: INVOICES_ROUTE },
      { label: 'Received', icon: 'check', tone: 'success', value: inrAbbr(d.total_received), foot: formatMoney(d.total_received ?? 0), route: INVOICES_ROUTE },
      { label: 'Outstanding', icon: 'clock', tone: 'warning', value: inrAbbr(d.outstanding), foot: formatMoney(d.outstanding ?? 0), route: INVOICES_ROUTE },
      {
        label: 'Overdue Invoices',
        icon: 'alert',
        tone: 'danger',
        value: String(d.overdue_count ?? 0),
        unit: 'invoices',
        foot: 'Status not Paid, Due Date passed',
        route: INVOICES_ROUTE,
      },
    ];
  }

  // §6.2 "Show Non-Financial Dashboard Widgets to HR" — Total Expenses is
  // spend, not headcount/ops, so it's excluded here (null) the same way
  // financeTiles() above is skipped entirely, even though both rows sit in
  // the same "ops" grid on screen for Accountant/Super Admin.
  protected opsTiles(d: InvoiceDashboardData): readonly Tile[] {
    const tiles: Tile[] = [];
    if (d.total_expenses !== null) {
      tiles.push({ label: 'Total Expenses', icon: 'expense', tone: 'danger', value: inrAbbr(d.total_expenses), foot: 'From the Expense module', route: ['/expenses', 'all'] });
    }
    tiles.push(
      { label: 'Active Projects', icon: 'project', tone: 'info', value: String(d.active_projects), unit: 'live', foot: 'Status not Completed', route: ['/projects'] },
      { label: 'Open Tickets', icon: 'ticket', tone: 'warning', value: String(d.open_tickets), unit: 'open', foot: 'Status Open or In Progress', route: ['/tickets'] },
      { label: 'Active Employees', icon: 'employee', tone: 'success', value: String(d.active_employees), unit: 'active', foot: 'Status Active', route: ['/employees'] },
    );
    return tiles;
  }

  protected isRestricted(d: InvoiceDashboardData): boolean {
    return d.total_invoiced === null;
  }

  protected openTile(t: Tile): void {
    this.router.navigate(t.route as string[]);
  }

  // ---- navigation ---------------------------------------------------------

  /** Both mini-tables' rows and card-foot links all resolve here, mirroring
   * the prototype's own overdueTable()/paymentsTable() (app-screens.js),
   * which route every row to 'inv.list' rather than a specific record —
   * GET /invoices/dashboard's own overdue_invoices/recent_payments rows
   * carry no invoice id (only invoice_number/customer/amount/due_date —
   * confirmed against invoice_dashboard()'s own return dict,
   * api/v1/invoices.py), so a specific record is not even addressable from
   * this data, same limitation the prototype's static mock has for the
   * identical reason. */
  protected goToInvoices(): void {
    this.router.navigate(['/invoices']);
  }

  protected canCreate(): boolean {
    return this.policy.can('invoice.list', 'edit');
  }

  protected createInvoice(): void {
    this.router.navigate(['/invoices', 'new']);
  }
}
