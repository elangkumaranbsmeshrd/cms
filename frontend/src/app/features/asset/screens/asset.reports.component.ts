import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { formatMoney } from '../../../shared/screens/cell-format';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ASSET_STATUS_OPTIONS } from '../asset.api';
import { RoleButtonDirective } from '../../../shared/ui/role-button.directive';

const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };
const SCREEN = 'asset.reports';

interface CategoryBreakdownRow {
  readonly category_id: string;
  readonly count: number;
  // Omitted entirely by the API (not just null) whenever the caller's
  // resolved purchase_value field mode isn't "show" (assets.py's own
  // can_see_value gate) — `undefined`, not `null`, is the real "hidden" case.
  readonly total_purchase_value?: string;
  readonly total_current_value?: string;
}
interface DueSoonRow {
  readonly id: string;
  readonly asset_tag: string;
  readonly name: string;
  readonly warranty_expiry: string | null;
  readonly maintenance_next_due: string | null;
}
interface RetiredRow {
  readonly id: string;
  readonly asset_tag: string;
  readonly name: string;
  readonly retired_date: string | null;
}
interface AssetReportsSummary {
  readonly count_and_value_by_category: readonly CategoryBreakdownRow[];
  readonly due_soon: readonly DueSoonRow[];
  readonly due_soon_count: number;
  readonly retired_count: number;
  readonly retired_assets: readonly RetiredRow[];
}

/** §5 Asset Reports (asset.reports) — bespoke, not ReportScreenConfig.
 * GET /assets/reports/summary returns ONE compound object with three
 * differently-shaped sections (a by-category breakdown array, a due-soon
 * array, and a retired-assets array, plus two bare counts) — ReportScreenConfig
 * models several INDEPENDENT sources, each resolving to either one object or
 * one array, not three co-dependent sections carved out of a single response
 * (confirmed by reading report-screen.component.ts in full). Filters are
 * hand-rolled plain controls for the same reason: FilterDef/the generic
 * filter-bar machinery only exists on ListScreenConfig/ReportScreenConfig.
 *
 * Zero RBAC actions registered on asset.reports (§0.2) — this screen is
 * permanently read+export only, gated purely on policy.canOpen().
 */
@Component({
  selector: 'app-asset-reports',
  standalone: true,
  imports: [FormsModule, IconComponent, RoleButtonDirective],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">Asset Reports</h1>
        <p class="page-sub">Count &amp; value by category, warranty/maintenance due soon, and retired assets.</p>
      </div>
    </div>

    <div class="filterbar">
      <!-- Every control in this hand-rolled filter row carries an explicit
           aria-label. Nothing here is wrapped in a <label>: the dimension name
           lives in the "All Categories" option, in a tooltip, or in a
           placeholder — so the axe sweep flagged the four selects and the two
           date inputs as [serious] label-title-only and the two number inputs
           as [critical] label on /assets/reports. A title is a tooltip, not a
           label: it never surfaces on touch, it vanishes on keyboard focus,
           and screen readers announce it only as a last resort; a placeholder
           is worse still, since it disappears the moment the user types. The
           titles and placeholders stay — they are useful sighted affordances,
           and title is how the filter E2Es address a filter control — but the
           NAME now comes from aria-label. Same fix as form-screen.component.ts's
           own [attr.aria-label] and the company-expenses filter bar. -->
      <div class="filter-row">
        <select class="fselect" aria-label="Category" title="Category" [(ngModel)]="filters['category_id']" (ngModelChange)="load()">
          <option value="">All Categories</option>
          @for (o of refData.options(CATEGORY_REF) ?? []; track o.id) {
            <option [value]="o.id">{{ o.label }}</option>
          }
        </select>
        <select class="fselect" aria-label="Location" title="Location" [(ngModel)]="filters['location_address_id']" (ngModelChange)="load()">
          <option value="">All Locations</option>
          @for (o of refData.options(LOCATION_REF) ?? []; track o.id) {
            <option [value]="o.id">{{ o.label }}</option>
          }
        </select>
        <select class="fselect" aria-label="Department" title="Department" [(ngModel)]="filters['department_id']" (ngModelChange)="load()">
          <option value="">All Departments</option>
          @for (o of refData.options(DEPARTMENT_REF) ?? []; track o.id) {
            <option [value]="o.id">{{ o.label }}</option>
          }
        </select>
        <select class="fselect" aria-label="Assigned Employee" title="Assigned Employee" [(ngModel)]="filters['assigned_to']" (ngModelChange)="load()">
          <option value="">All Employees</option>
          @for (o of refData.options(EMPLOYEE_REF) ?? []; track o.id) {
            <option [value]="o.id">{{ o.label }}</option>
          }
        </select>
        <input class="fsearch" type="date" aria-label="Purchase Date From" title="Purchase Date From" placeholder="Purchase Date From" [(ngModel)]="filters['purchase_date_from']" (change)="load()" style="max-width: 150px;" />
        <input class="fsearch" type="date" aria-label="Purchase Date To" title="Purchase Date To" placeholder="Purchase Date To" [(ngModel)]="filters['purchase_date_to']" (change)="load()" style="max-width: 150px;" />
        <input class="fsearch" type="number" aria-label="Purchase Value Min" placeholder="Purchase Value Min" [(ngModel)]="filters['purchase_value_min']" (change)="load()" style="max-width: 130px;" />
        <input class="fsearch" type="number" aria-label="Purchase Value Max" placeholder="Purchase Value Max" [(ngModel)]="filters['purchase_value_max']" (change)="load()" style="max-width: 130px;" />
      </div>
      <div class="filter-row" style="margin-top: 10px;">
        <span class="cell-sub" style="align-self: center;">Status:</span>
        @for (s of STATUS_OPTIONS; track s.value) {
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; cursor: pointer;">
            <input type="checkbox" [checked]="isStatusChecked(s.value)" (change)="toggleStatus(s.value)" />
            {{ s.label }}
          </label>
        }
        <span class="clear" role="button" (click)="clearFilters()" style="margin-left: auto;">Clear all</span>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this report</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      <!-- "as" is only legal on a PRIMARY @if — nested here since this is
           the third arm of an @if/@else if/@else chain. -->
      @if (data(); as d) {
      @if (exportError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ exportError() }}</div>
      }

      <div class="grid g-kpi" style="margin-bottom: 16px;">
        <div class="kpi" style="--tone: var(--accent); --tone-bg: var(--accent-subtle);">
          <div class="kpi-top">
            <div class="kpi-ico"><app-icon name="asset" [size]="14" /></div>
            <div class="kpi-label">Total Assets</div>
          </div>
          <div class="kpi-val num">{{ totalCount(d) }}</div>
          <div class="kpi-foot"><span>{{ d.count_and_value_by_category.length }} {{ d.count_and_value_by_category.length === 1 ? 'category' : 'categories' }} in scope</span></div>
        </div>
        @if (hasValueColumns(d)) {
          <div class="kpi" style="--tone: var(--success); --tone-bg: var(--success-bg);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="rupee" [size]="14" /></div>
              <div class="kpi-label">Total Purchase Value</div>
            </div>
            <div class="kpi-val num">{{ formatMoney(totalPurchaseValue(d)) }}</div>
            <div class="kpi-foot"><span>Across every category in scope</span></div>
          </div>
          <div class="kpi" style="--tone: var(--warning); --tone-bg: var(--warning-bg);">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon name="clock" [size]="14" /></div>
              <div class="kpi-label">Current Value</div>
            </div>
            <div class="kpi-val num">{{ formatMoney(totalCurrentValue(d)) }}</div>
            <div class="kpi-foot"><span>Straight Line, as of today</span></div>
          </div>
        }
        <div class="kpi" style="--tone: var(--danger); --tone-bg: var(--danger-bg);">
          <div class="kpi-top">
            <div class="kpi-ico"><app-icon name="alert" [size]="14" /></div>
            <div class="kpi-label">Due Soon</div>
          </div>
          <div class="kpi-val num">{{ d.due_soon_count }}</div>
          <div class="kpi-foot"><span>Warranty or maintenance due within the window</span></div>
        </div>
        <div class="kpi" style="--tone: var(--info); --tone-bg: var(--info-bg);">
          <div class="kpi-top">
            <div class="kpi-ico"><app-icon name="trash" [size]="14" /></div>
            <div class="kpi-label">Retired</div>
          </div>
          <div class="kpi-val num">{{ d.retired_count }}</div>
          <div class="kpi-foot"><span>Retired / Disposed assets</span></div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 16px;">
        <div class="card-head">
          <h3>By Category</h3>
          @if (canExport()) {
            <div class="filter-row">
              <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportCategoryTable('pdf')">
                <app-icon name="download" [size]="13" />{{ exporting() === 'pdf' ? 'Exporting…' : 'Download PDF' }}
              </button>
              <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportCategoryTable('excel')">
                <app-icon name="download" [size]="13" />{{ exporting() === 'excel' ? 'Exporting…' : 'Download Excel' }}
              </button>
            </div>
          }
        </div>
        <!-- Keyboard reachability: a scrolling container with no focusable
             child cannot be reached or scrolled without a mouse. Every cell in
             these report tables is plain text, so the region itself has to be
             the tab stop (axe: scrollable-region-focusable). -->
        <div class="table-wrap" tabindex="0" role="region" aria-label="Assets by category">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th class="r">Count</th>
                @if (hasValueColumns(d)) {
                  <th class="r">Total Purchase Value</th>
                  <th class="r">Total Current Value</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of d.count_and_value_by_category; track row.category_id) {
                <tr>
                  <td>{{ categoryLabel(row.category_id) }}</td>
                  <td class="mono r">{{ row.count }}</td>
                  @if (hasValueColumns(d)) {
                    <td class="mono r">{{ row.total_purchase_value ? formatMoney(row.total_purchase_value) : '—' }}</td>
                    <td class="mono r">{{ row.total_current_value ? formatMoney(row.total_current_value) : '—' }}</td>
                  }
                </tr>
              }
              @if (!d.count_and_value_by_category.length) {
                <tr><td [attr.colspan]="hasValueColumns(d) ? 4 : 2" class="cell-sub">No assets match the filters currently applied.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><h3>Due Soon</h3></div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="Due soon">
            <table>
              <thead>
                <tr><th>Asset Tag</th><th>Name</th><th>Warranty Expiry</th><th>Maintenance Next Due</th></tr>
              </thead>
              <tbody>
                @for (row of d.due_soon; track row.id) {
                  <tr>
                    <td class="mono">{{ row.asset_tag }}</td>
                    <td class="cell-strong">{{ row.name }}</td>
                    <td class="mono">{{ row.warranty_expiry ?? '—' }}</td>
                    <td class="mono">{{ row.maintenance_next_due ?? '—' }}</td>
                  </tr>
                }
                @if (!d.due_soon.length) {
                  <tr><td colspan="4" class="cell-sub">Nothing due soon.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Retired</h3></div>
          <div class="table-wrap" tabindex="0" role="region" aria-label="Retired assets">
            <table>
              <thead>
                <tr><th>Asset Tag</th><th>Name</th><th>Retired Date</th></tr>
              </thead>
              <tbody>
                @for (row of d.retired_assets; track row.id) {
                  <tr>
                    <td class="mono">{{ row.asset_tag }}</td>
                    <td class="cell-strong">{{ row.name }}</td>
                    <td class="mono">{{ row.retired_date ?? '—' }}</td>
                  </tr>
                }
                @if (!d.retired_assets.length) {
                  <tr><td colspan="3" class="cell-sub">No retired assets.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      }
    }
  `,
})
export class AssetReportsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  protected readonly refData = inject(RefDataService);

  protected readonly CATEGORY_REF = CATEGORY_REF;
  protected readonly LOCATION_REF = LOCATION_REF;
  protected readonly DEPARTMENT_REF = DEPARTMENT_REF;
  protected readonly EMPLOYEE_REF = EMPLOYEE_REF;
  protected readonly STATUS_OPTIONS = ASSET_STATUS_OPTIONS;
  protected readonly formatMoney = formatMoney;

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly data = signal<AssetReportsSummary | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  protected filters: Record<string, unknown> = {
    category_id: '',
    location_address_id: '',
    department_id: '',
    assigned_to: '',
    purchase_date_from: '',
    purchase_date_to: '',
    purchase_value_min: '',
    purchase_value_max: '',
    status: [] as string[],
  };

  ngOnInit(): void {
    this.load();
  }

  protected canExport(): boolean {
    return this.policy.canOpen(SCREEN);
  }

  protected isStatusChecked(value: string): boolean {
    return ((this.filters['status'] as string[]) ?? []).includes(value);
  }

  protected toggleStatus(value: string): void {
    const list = [...((this.filters['status'] as string[]) ?? [])];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    this.filters['status'] = list;
    this.load();
  }

  protected hasValueColumns(d: AssetReportsSummary): boolean {
    return d.count_and_value_by_category.some((r) => r.total_purchase_value !== undefined);
  }

  // §2.7's own "Total Assets" / "Total Purchase Value" / "Current Value" KPI
  // tiles (app-screens.js:394-396) — rollups over the SAME by-category
  // breakdown the table below already renders, not a second endpoint. Purchase/
  // Current Value sums are skipped entirely (hasValueColumns above) rather
  // than shown as ₹0 whenever the caller's own purchase_value field mode
  // isn't "show" — same can_see_value gate the by-category table's own two
  // columns already respect (assets.py's asset_reports()).
  protected totalCount(d: AssetReportsSummary): number {
    return d.count_and_value_by_category.reduce((sum, r) => sum + r.count, 0);
  }

  protected totalPurchaseValue(d: AssetReportsSummary): number {
    return d.count_and_value_by_category.reduce((sum, r) => sum + Number(r.total_purchase_value ?? 0), 0);
  }

  protected totalCurrentValue(d: AssetReportsSummary): number {
    return d.count_and_value_by_category.reduce((sum, r) => sum + Number(r.total_current_value ?? 0), 0);
  }

  protected categoryLabel(id: string): string {
    return this.refData.label(CATEGORY_REF, id);
  }

  private buildParams(): HttpParams {
    let params = new HttpParams();
    const f = this.filters;
    const single: readonly string[] = ['category_id', 'location_address_id', 'department_id', 'assigned_to', 'purchase_date_from', 'purchase_date_to', 'purchase_value_min', 'purchase_value_max'];
    for (const key of single) {
      const v = f[key];
      if (v !== null && v !== undefined && v !== '') params = params.set(key, String(v));
    }
    for (const s of (f['status'] as string[]) ?? []) params = params.append('status', s);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<AssetReportsSummary>(`${environment.apiBaseUrl}/assets/reports/summary`, { params: this.buildParams() }).subscribe({
      next: (res) => {
        this.data.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this report.');
        this.isLoading.set(false);
      },
    });
  }

  protected clearFilters(): void {
    this.filters = {
      category_id: '',
      location_address_id: '',
      department_id: '',
      assigned_to: '',
      purchase_date_from: '',
      purchase_date_to: '',
      purchase_value_min: '',
      purchase_value_max: '',
      status: [],
    };
    this.load();
  }

  // Same auth-and-blob mechanism as list-screen.component.ts's exportAs() /
  // report-screen.component.ts's exportTable() — exports the SAME summary
  // endpoint with `?format=`, covering only the By-Category breakdown (the
  // one flat-row shape this report has — asset_reports()'s own export
  // branch, assets.py).
  protected exportCategoryTable(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.buildParams().set('format', format);
    const url = `${environment.apiBaseUrl}/assets/reports/summary?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Asset Reports.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: async (err) => {
        this.exporting.set(null);
        this.exportError.set(await this.resolveBlobError(err));
      },
    });
  }

  private async resolveBlobError(err: unknown): Promise<string> {
    const blob = (err as any)?.error;
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
}
