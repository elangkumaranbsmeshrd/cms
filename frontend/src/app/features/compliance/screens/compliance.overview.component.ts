import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { IconComponent } from '../../../shared/ui/icon.component';
import { formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { ComplianceOverview, OBLIGATION_STATUS_OPTIONS, ObligationPeriodRow } from '../compliance.api';

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

// Same tone->CSS-var mapping as dashboard-screen.component.ts (private to
// that file, so copied rather than imported) — this component reuses that
// shape's `.kpi`/`.grid.g-kpi`/`.kpi-top`/`.kpi-ico`/`.kpi-val` CSS classes
// for visual consistency, not its DashboardScreenConfig machinery (see the
// class doc below for why the dashboard/report shapes don't fit this data).
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
  // U.kpi's own `foot` line (app-core.js:313) — every tile in the prototype
  // carries one. Kept honest: a real derived count where OverviewOut's
  // `due_soon_and_overdue` array actually supports computing one (Due Within
  // 7 Days / Overdue Remittances), a plain qualifying caption everywhere
  // else rather than restating the tile's own already-unabbreviated
  // formatMoney() value a second time (the prototype's own foot repeats its
  // figure only because its TILE value is the abbreviated inrAbbr() form —
  // not true here, so repeating would be pure duplication).
  readonly foot: string;
}

const CUSTOMER_REF = { endpoint: '/customers/picker', labelKey: 'company_name' } as const;

/** §2.1 — the Tax & Compliance landing screen. Bespoke, not `dashboard` or
 * `report`: both those shapes need Array.isArray() on a widget/table's raw
 * top-level fetch, but OverviewOut's two arrays (`due_soon_and_overdue`,
 * `certificates_outstanding_oldest_first`) are nested inside ONE object
 * response from a single `GET /compliance/overview` — under either shape
 * they would render permanently empty.
 *
 * §4's "single most important visual rule": the two panels — Obligations
 * (money held, owed onward) and Credits (claimable back) — are never netted
 * into one combined figure. Built here as two visually separate sections,
 * each carrying its own 4 tiles (§2.1's own table: Obligations = Withheld
 * Not Yet Remitted / Due Within 7 Days / Overdue Remittances / Remitted This
 * FY; Credits = Withheld by Customers This FY / Certificate Outstanding /
 * Certified Not Yet Claimed / Credit Claimed This FY — all 8 are Decimal
 * money figures per OverviewOut, confirmed against schemas/compliance.py;
 * none of the 8 is a count) — nothing on this page ever subtracts one
 * panel's total from the other's, and Due Within 7 Days / Overdue stay two
 * separate tiles rather than being merged into one.
 *
 * Empty states are 3 distinct cases per panel, per §2.1's own text: not
 * configured at all (`has_*_heads_configured` false — the whole panel
 * collapses to a single explanatory callout, no tiles/table), configured
 * but zero activity (tiles render their real ₹0 figures; the table shows
 * its own "nothing outstanding" message), and has data (tiles + a populated
 * table) — the third case needs no special-casing, it's just the normal render.
 */
@Component({
  selector: 'app-compliance-overview',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">
          Tax &amp; Compliance Overview<span class="spec-ref">§2.1</span>
        </h1>
        <p class="page-sub">
          Money the company is holding on somebody else's behalf, and money somebody else is holding on the company's behalf — shown as two panels that are never netted into one figure.
        </p>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card">
        <div class="empty"><p>Loading…</p></div>
      </div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load the overview</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else {
      <!-- Nested, not an @else-if with an "as" binding — "as" is only
           legal on a PRIMARY @if, never on an @else if. -->
      @if (data(); as d) {
      <!-- §2.1/§4's own top-level note (app-screens2.js:1289, U.note ==
           .rbac-note — same component this file already uses below for the
           two "not configured" callouts): the single most important visual
           rule on this screen, stated once before either panel. -->
      <div class="rbac-note" style="margin-bottom: 20px;">
        <app-icon name="info" [size]="14" />
        <div>
          <b>These two panels are never netted into a single figure.</b> What the company withheld from suppliers is a liability it owes an authority; what customers withheld from the company is an asset it can claim back. Offsetting them would produce a number that is wrong in both directions — and worse once exported, because the reader cannot tell which way it leans.
        </div>
      </div>
      <!-- ============================ OBLIGATIONS PANEL ============================ -->
      <div class="panel-head">
        <h2>Obligations — Money Held, Owed Onward</h2>
        <p class="panel-note">A liability. This is not the company's money.</p>
      </div>
      @if (!d.has_obligation_heads_configured) {
        <div class="rbac-note" style="margin-bottom: 22px;">
          <app-icon name="info" [size]="14" />
          <div>No tax head is configured with "Creates an Onward Liability" yet. Set one up in Masters → Taxes to start tracking money withheld from a vendor or payroll payment.</div>
        </div>
      } @else {
        <div class="grid g-kpi">
          @for (t of obligationTiles(d); track t.label) {
            <div class="kpi" [style.--tone]="toneVar(t.tone)" [style.--tone-bg]="toneBgVar(t.tone)">
              <div class="kpi-top">
                <div class="kpi-ico"><app-icon [name]="t.icon" [size]="14" /></div>
                <div class="kpi-label">{{ t.label }}</div>
              </div>
              <div class="kpi-val num">{{ t.value }}</div>
              <div class="kpi-foot"><span>{{ t.foot }}</span></div>
            </div>
          }
        </div>
        <div class="card" style="margin-bottom: 26px;">
          <div class="card-head"><h3>Due Soon &amp; Overdue Obligations</h3></div>
          <div class="card-body flush">
            @if (!d.due_soon_and_overdue.length) {
              <div class="empty">
                <div class="ico">∅</div>
                <p>Nothing is due soon or overdue right now.</p>
              </div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tax Head</th>
                      <th>Source</th>
                      <th>Period</th>
                      <th class="money">Outstanding</th>
                      <th>Due Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of d.due_soon_and_overdue; track periodKey(p)) {
                      <tr>
                        <td class="cell-strong">{{ p.tax_head_name }}</td>
                        <td>{{ p.source_label }}</td>
                        <td>{{ p.period_label }}</td>
                        <td class="money">{{ formatMoney(p.outstanding) }}</td>
                        <td class="mono">{{ formatDate(p.due_date) }}</td>
                        <td><span class="badge-s {{ statusBadge(p.status) }}">{{ statusLabel(p.status) }}</span></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }

      <!-- =============================== CREDITS PANEL =============================== -->
      <div class="panel-head">
        <h2>Credits — Claimable Back</h2>
        <p class="panel-note">An asset, evidenced by a certificate the customer issues.</p>
      </div>
      @if (!d.has_credit_heads_configured) {
        <div class="rbac-note" style="margin-bottom: 22px;">
          <app-icon name="info" [size]="14" />
          <div>No tax head is configured for customer withholding yet. Set one up in Masters → Taxes to start tracking credits the company can claim back.</div>
        </div>
      } @else {
        <div class="grid g-kpi">
          @for (t of creditTiles(d); track t.label) {
            <div class="kpi" [style.--tone]="toneVar(t.tone)" [style.--tone-bg]="toneBgVar(t.tone)">
              <div class="kpi-top">
                <div class="kpi-ico"><app-icon [name]="t.icon" [size]="14" /></div>
                <div class="kpi-label">{{ t.label }}</div>
              </div>
              <div class="kpi-val num">{{ t.value }}</div>
              <div class="kpi-foot"><span>{{ t.foot }}</span></div>
            </div>
          }
        </div>
        <div class="card">
          <div class="card-head"><h3>Certificates Outstanding — Oldest First</h3></div>
          <div class="card-body flush">
            @if (!d.certificates_outstanding_oldest_first.length) {
              <div class="empty">
                <div class="ico">∅</div>
                <p>No certificates are currently outstanding.</p>
              </div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Certificate Reference</th>
                      <th>Customer</th>
                      <th>Certificate Date</th>
                      <th>Tax Head</th>
                      <th class="money">Amount on Certificate</th>
                      <th class="money">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of d.certificates_outstanding_oldest_first; track c.id) {
                      <tr>
                        <td class="cell-strong mono">{{ c.certificate_reference }}</td>
                        <td>{{ customerName(c.customer_id) }}</td>
                        <td class="mono">{{ formatDate(c.certificate_date) }}</td>
                        <td>{{ c.tax_head_name_snapshot }}</td>
                        <td class="money">{{ formatMoney(c.amount_on_certificate) }}</td>
                        <td class="money">{{ formatMoney(c.variance) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      }
      }
    }
  `,
  styles: [
    `
      .panel-head { margin: 4px 0 12px; }
      .panel-head h2 { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
      .panel-head .panel-note { font-size: 11.5px; color: var(--text-tertiary); margin: 4px 0 0; }
    `,
  ],
})
export class ComplianceOverviewComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly refData = inject(RefDataService);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly data = signal<ComplianceOverview | null>(null);

  ngOnInit(): void {
    this.http.get<ComplianceOverview>(`${environment.apiBaseUrl}/compliance/overview`).subscribe({
      next: (res) => {
        this.data.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the compliance overview.');
        this.isLoading.set(false);
      },
    });
  }

  protected toneVar(tone: Tone): string {
    return TONE_VAR[tone];
  }
  protected toneBgVar(tone: Tone): string {
    return TONE_BG_VAR[tone];
  }

  // §2.1's own tone table (app-screens2.js:1262-1265): rupee/danger,
  // clock/warning, alert/danger, check/success — "Withheld — Not Yet
  // Remitted" reads danger (it's a liability sitting unpaid), not warning.
  protected obligationTiles(d: ComplianceOverview): readonly Tile[] {
    const dueSoonCount = this.countByStatus(d, 'DUE_SOON');
    const overdueCount = this.countByStatus(d, 'OVERDUE');
    return [
      {
        label: 'Withheld — Not Yet Remitted', icon: 'rupee', tone: 'danger', value: formatMoney(d.withheld_not_yet_remitted),
        foot: "Held on suppliers' and employees' behalf",
      },
      {
        label: 'Due Within 7 Days', icon: 'clock', tone: 'warning', value: formatMoney(d.due_within_7_days),
        foot: `${dueSoonCount} period${dueSoonCount === 1 ? '' : 's'}`,
      },
      {
        label: 'Overdue Remittances', icon: 'alert', tone: 'danger', value: formatMoney(d.overdue_remittances),
        // §2.1: "Nothing overdue" vs "N periods past its due date" — the
        // count comes from the SAME due_soon_and_overdue rows the table
        // below renders, so it can never disagree with what's on screen.
        foot: overdueCount ? `${overdueCount} period${overdueCount === 1 ? '' : 's'} past its due date` : 'Nothing overdue',
      },
      {
        label: 'Remitted This Financial Year', icon: 'check', tone: 'success', value: formatMoney(d.remitted_this_fy),
        foot: 'Actually deposited with the authority',
      },
    ];
  }

  protected creditTiles(d: ComplianceOverview): readonly Tile[] {
    const certOutstanding = Number(d.certificate_outstanding) > 0;
    return [
      {
        label: 'Withheld by Customers — This FY', icon: 'rupee', tone: 'info', value: formatMoney(d.withheld_by_customers_this_fy),
        foot: 'Held back by customers on their own payments',
      },
      {
        label: 'Certificate Outstanding', icon: 'doc', tone: 'warning', value: formatMoney(d.certificate_outstanding),
        foot: certOutstanding ? 'Chase the customer — no certificate, no claim' : 'All certificates received',
      },
      {
        label: 'Certified — Not Yet Claimed', icon: 'clock', tone: 'info', value: formatMoney(d.certified_not_yet_claimed),
        foot: 'Ready to claim',
      },
      {
        label: 'Credit Claimed This Financial Year', icon: 'check', tone: 'success', value: formatMoney(d.credit_claimed_this_fy),
        foot: "Claimed against the company's own liability",
      },
    ];
  }

  private countByStatus(d: ComplianceOverview, status: string): number {
    return d.due_soon_and_overdue.filter((p) => p.status === status).length;
  }

  protected periodKey(p: ObligationPeriodRow): string {
    return p.tax_head_id + '::' + p.period_from + '::' + p.period_to;
  }

  protected statusBadge(status: string): string {
    return OBLIGATION_STATUS_OPTIONS.find((o) => o.value === status)?.badgeClass ?? 'b-neutral';
  }
  protected statusLabel(status: string): string {
    return OBLIGATION_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? humanizeEnum(status);
  }

  protected customerName(id: string): string {
    return this.refData.label(CUSTOMER_REF, id);
  }

  protected formatDate(v: string): string {
    return formatDate(v);
  }
  protected formatMoney(v: string): string {
    return formatMoney(v);
  }
}
