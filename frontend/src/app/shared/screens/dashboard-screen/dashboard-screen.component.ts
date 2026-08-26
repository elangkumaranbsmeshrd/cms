import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { IconComponent } from '../../ui/icon.component';
import { EM_DASH, badgeClass, formatDate, formatMoney, humanizeEnum, isBlank } from '../cell-format';
import { columnAlignClass } from '../column-policy';
import { RefDataService } from '../ref-data.service';
import {
  ColumnDef,
  DashboardFeedRow,
  DashboardMeterRow,
  DashboardRecordRow,
  DashboardScreenConfig,
  DashboardStatDef,
  DashboardTileDef,
  DashboardTone,
  DashboardWidgetDef,
  DashboardWidgetRow,
} from '../screen.types';
import { RoleButtonDirective } from '../../ui/role-button.directive';

// Tone -> the two CSS custom properties every tinted widget reads
// (`--tone`/`--tone-bg`, e.g. .kpi-ico, .ministat .ico, .feed-ico). The
// prototype passes these as literal `var(--danger)` strings scattered through
// app-screens.js's own KPI/ministat calls (e.g. app-screens.js:98-101); a
// config author names the tone once as a short word instead of repeating a
// CSS var() string in every tile/stat definition.
const TONE_VAR: Record<DashboardTone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};
const TONE_BG_VAR: Record<DashboardTone, string> = {
  accent: 'var(--accent-subtle)',
  success: 'var(--success-bg)',
  warning: 'var(--warning-bg)',
  danger: 'var(--danger-bg)',
  info: 'var(--info-bg)',
};
// badge-s only ships b-ok/b-warn/b-danger/b-info/b-accent (cell-format.ts's
// BADGE_CLASS is keyed by STATUS WORDS, not tones) — a widget's free-text
// badge ("4 pending", "3 active") can't be resolved through that dictionary,
// so DashboardWidgetDef.badgeTone names the badge's colour directly, same
// vocabulary as a tile's `tone`.
const BADGE_TONE_CLASS: Record<DashboardTone, string> = {
  accent: 'b-accent',
  success: 'b-ok',
  warning: 'b-warn',
  danger: 'b-danger',
  info: 'b-info',
};

/** The 'dashboard' shape — the prototype's R.dashboard (app-screens.js:
 * 147-183), one render function that branches on `role` internally rather
 * than five separate screen defs. Here that branch moves OUT of the
 * component and INTO config: a later phase builds one DashboardScreenConfig
 * per role (mirroring R.dashboard's own if/else — financeKpis()+opsKpis()
 * for Super Admin, hrKpis() for HR, myCounts()+teamStrip() for Manager, the
 * bare payslip+leave+quick-links trio for Employee), and this ONE component
 * renders whichever one it's given.
 *
 * No backend endpoint returns a cross-module rollup for any of this —
 * grepped `app/api/v1/*dashboard*` / `*summary*` and every hit
 * (assets.py, invoices.py, payslips.py, tickets.py, ...) is a single
 * module's own summary, none spanning modules. So every tile and every
 * data-bearing widget fetches its OWN real endpoint independently, the same
 * pattern TabbedScreenComponent already uses per-tab (tabbed-screen.
 * component.ts:147-158) — there is no cheaper alternative available today.
 */
@Component({
  selector: 'app-dashboard-screen',
  standalone: true,
  imports: [IconComponent, NgTemplateOutlet, RoleButtonDirective],
  template: `
    @if (!embedded()) {
      <div class="page-head">
        <div>
          <h1 class="page-title">
            {{ greeting() }}
            @if (config().specRef) {
              <span class="spec-ref">{{ config().specRef }}</span>
            }
          </h1>
          @if (config().description) {
            <p class="page-sub">{{ config().description }}</p>
          }
        </div>
      </div>
    }

    @if (config().note; as n) {
      <div class="rbac-note {{ noteClass() }}">
        <app-icon name="info" [size]="14" />
        <div>{{ n.text }}</div>
      </div>
    }

    @if ((config().tiles ?? []).length) {
      <div class="grid g-kpi">
        @for (t of config().tiles ?? []; track t.key) {
          <div
            class="kpi"
            [style.--tone]="toneVar(t.tone)"
            [style.--tone-bg]="toneBgVar(t.tone)"
            role="button"
            (click)="openTile(t)"
          >
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon [name]="t.icon" [size]="14" /></div>
              <div class="kpi-label">{{ t.label }}</div>
            </div>
            <div class="kpi-val num">
              {{ tileValue(t) }}
              @if (t.unit) {
                <small> {{ t.unit }}</small>
              }
            </div>
            <div class="kpi-foot">
              @if (tileDelta(t); as d) {
                <span class="delta {{ d.dir }}">{{ d.dir === 'up' ? '▲' : '▼' }} {{ d.text }}</span>
              }
              <span>{{ tileFooter(t) }}</span>
            </div>
          </div>
        }
      </div>
    }

    @for (row of config().widgetRows; track $index) {
      @if (row.strip; as strip) {
        <div class="strip">
          <div class="strip-head">
            <span class="tag">{{ strip.tag }}</span>
            <h3>{{ strip.heading }}</h3>
            @if (strip.meta) {
              <span style="font-size: 11.5px; color: var(--text-secondary);">{{ strip.meta }}</span>
            }
            @if (strip.actionLabel) {
              <button class="btn sm" style="margin-left: auto;" type="button" (click)="navigateStrip(strip)">
                <app-icon name="eye" [size]="13" />{{ strip.actionLabel }}
              </button>
            }
          </div>
          <div class="strip-grid">
            @for (w of row.widgets; track w.key) {
              <ng-container [ngTemplateOutlet]="widgetCard" [ngTemplateOutletContext]="{ $implicit: w }" />
            }
          </div>
        </div>
      } @else {
        <div [class]="rowClass(row)">
          @for (w of row.widgets; track w.key) {
            <ng-container [ngTemplateOutlet]="widgetCard" [ngTemplateOutletContext]="{ $implicit: w }" />
          }
        </div>
      }
    }

    <!-- One template for every widget kind, reused from both the plain-grid
         and the strip-wrapped row above so the six kinds are only written
         out once. -->
    <ng-template #widgetCard let-w>
      @switch (w.kind) {
        @case ('table') {
          <div class="card">
            <div class="card-head">
              <h3>{{ w.title }}</h3>
              @if (w.subtitle) {
                <span class="sub">{{ w.subtitle }}</span>
              }
              @if (widgetBadge(w); as b) {
                <div class="right"><span class="badge-s {{ badgeToneClass(w) }}">{{ b }}</span></div>
              }
            </div>
            <div class="card-body flush">
              @if (isLoading(w)) {
                <div class="empty">
                  <p>Loading…</p>
                </div>
              } @else if (visibleRows(w).length === 0) {
                <div class="empty">
                  <div class="ico">∅</div>
                  <p>{{ w.emptyText ?? 'Nothing here yet.' }}</p>
                </div>
              } @else {
                <!-- .table-wrap scrolls horizontally (components.css:242) and
                     nothing inside a widget table is focusable — the rows carry
                     a (click) but never a tab stop — so a keyboard-only user
                     has no way to reach the columns that overflow the card.
                     tabindex="0" makes the wrap itself focusable and
                     arrow-scrollable (axe scrollable-region-focusable, WCAG
                     2.1.1/2.1.3); role="region" named by the widget's own title
                     stops that new tab stop being announced as an anonymous
                     group. -->
                <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="w.title">
                  <table>
                    <thead>
                      <tr>
                        @for (col of w.columns ?? []; track col.key) {
                          <th [class]="alignClass(col)">{{ col.header }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of visibleRows(w); track $index) {
                        <tr [class.clickable]="!!w.rowRoute" (click)="openWidgetRow(w, row)">
                          @for (col of w.columns ?? []; track col.key) {
                            <td [class]="cellClass(col)">
                              @if (col.type === 'status') {
                                <span class="badge-s {{ badgeCls(rawValue(row, col)) }}">{{ display(row, col) }}</span>
                              } @else {
                                {{ display(row, col) }}
                              }
                            </td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
            @if (w.linkLabel || (w.limit && totalRows(w) > w.limit)) {
              <div class="card-foot">
                @if (w.linkLabel) {
                  <span class="link" role="button" (click)="openWidgetLink(w)"
                    >{{ w.linkLabel }}<app-icon name="arrow" [size]="12" [width]="2.4"
                  /></span>
                }
                @if (w.limit && totalRows(w) > w.limit) {
                  <span class="mono" style="margin-left: auto; font-size: 11.5px; color: var(--text-tertiary);"
                    >Showing {{ w.limit }} of {{ totalRows(w) }}</span
                  >
                }
              </div>
            }
          </div>
        }
        @case ('meters') {
          <div class="card">
            <div class="card-head">
              <h3>{{ w.title }}</h3>
              @if (w.subtitle) {
                <span class="sub">{{ w.subtitle }}</span>
              }
            </div>
            <div class="card-body">
              @if (isLoading(w)) {
                <div class="empty">
                  <p>Loading…</p>
                </div>
              } @else if (meterRows(w).length === 0) {
                <div class="empty">
                  <p>{{ w.emptyText ?? 'Nothing to show.' }}</p>
                </div>
              } @else {
                @for (m of meterRows(w); track m.label) {
                  <div class="meter-row" [style.--tone]="m.tone ?? 'var(--accent)'">
                    <div class="meter-name">{{ m.label }}</div>
                    <div class="meter"><i [style.width.%]="meterPct(m)"></i></div>
                    <div class="meter-val">
                      @if (m.valueText) {
                        <span>{{ m.valueText }}</span>
                      } @else {
                        <b>{{ m.value }}</b
                        ><span> / {{ m.max }}</span>
                      }
                    </div>
                  </div>
                }
              }
            </div>
            @if (w.linkLabel) {
              <div class="card-foot">
                <span class="link" role="button" (click)="openWidgetLink(w)"
                  >{{ w.linkLabel }}<app-icon name="arrow" [size]="12" [width]="2.4"
                /></span>
              </div>
            }
          </div>
        }
        @case ('feed') {
          <div class="card">
            <div class="card-head">
              <h3>{{ w.title }}</h3>
              @if (w.subtitle) {
                <span class="sub">{{ w.subtitle }}</span>
              }
              @if (widgetBadge(w); as b) {
                <div class="right"><span class="badge-s {{ badgeToneClass(w) }}">{{ b }}</span></div>
              }
            </div>
            <div class="card-body flush">
              @if (isLoading(w)) {
                <div class="empty">
                  <p>Loading…</p>
                </div>
              } @else if (feedRows(w).length === 0) {
                <div class="empty">
                  <p>{{ w.emptyText ?? 'Nothing here yet.' }}</p>
                </div>
              } @else {
                <div class="feed">
                  @for (f of feedRows(w); track $index) {
                    <div class="feed-item" [style.--tone]="f.tone ?? 'var(--text-secondary)'">
                      <div class="feed-ico"><app-icon [name]="f.icon" [size]="13" /></div>
                      <div class="feed-body">
                        <div class="feed-title">{{ f.title }}</div>
                        <div class="feed-meta">
                          @if (f.pinned) {
                            <span class="pin">Pinned</span>
                          }
                          <span>{{ f.meta }}</span>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
            @if (w.linkLabel) {
              <div class="card-foot">
                <span class="link" role="button" (click)="openWidgetLink(w)"
                  >{{ w.linkLabel }}<app-icon name="arrow" [size]="12" [width]="2.4"
                /></span>
              </div>
            }
          </div>
        }
        @case ('stats') {
          <div class="grid" [style.grid-template-columns]="statsColumns(w)" style="margin-bottom: 0;">
            @for (st of w.stats ?? []; track st.key) {
              <div class="ministat" role="button" (click)="openStat(st)">
                <div class="ico" [style.--tone]="toneVar(st.tone)" [style.--tone-bg]="toneBgVar(st.tone)">
                  <app-icon [name]="st.icon" [size]="15" />
                </div>
                <div>
                  <div class="n num">{{ statValue(w, st) }}</div>
                  <div class="l">{{ st.label }}</div>
                </div>
                <div class="go"><app-icon name="arrow" [size]="14" [width]="2.2" /></div>
              </div>
            }
          </div>
        }
        @case ('links') {
          <div class="card">
            <div class="card-head">
              <h3>{{ w.title }}</h3>
              @if (w.subtitle) {
                <span class="sub">{{ w.subtitle }}</span>
              }
            </div>
            <div class="card-body">
              <div class="qlinks">
                @for (l of w.links ?? []; track l.label) {
                  <div class="qlink" role="button" (click)="navigateTo(l.route)">
                    <app-icon [name]="l.icon" [size]="14" />{{ l.label }}
                  </div>
                }
              </div>
            </div>
          </div>
        }
        @case ('record') {
          <div class="card">
            <div class="card-head">
              <h3>{{ w.title }}</h3>
              @if (w.subtitle) {
                <span class="sub">{{ w.subtitle }}</span>
              }
              @if (recordBadgeText(w); as b) {
                <div class="right"><span class="badge-s {{ badgeCls(b) }}">{{ b }}</span></div>
              }
            </div>
            <div class="card-body">
              @if (recordLoading(w)) {
                <div class="empty">
                  <p>Loading…</p>
                </div>
              } @else if (!recordRow(w)) {
                <div class="empty">
                  <p>{{ w.emptyText ?? 'Nothing to show yet.' }}</p>
                </div>
              } @else {
                <div class="payslip">
                  @if (recordHeadline(w); as h) {
                    <div class="payslip-top">
                      <div class="per">{{ h.label }}</div>
                      <div class="amt num">{{ h.value }}</div>
                    </div>
                  }
                  <div class="payslip-rows">
                    @for (r of w.recordRows ?? []; track r.label) {
                      <div class="pr" [class.ded]="r.tone === 'danger'">
                        <span>{{ r.label }}</span><b>{{ recordRowText(w, r) }}</b>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
            @if (w.linkLabel) {
              <div class="card-foot">
                <span class="link" role="button" (click)="openWidgetLink(w)"
                  >{{ w.linkLabel }}<app-icon name="arrow" [size]="12" [width]="2.4"
                /></span>
              </div>
            }
          </div>
        }
      }
    </ng-template>
  `,
})
export class DashboardScreenComponent<T = any> {
  readonly config = input.required<DashboardScreenConfig<T>>();
  /** True when hosted as a tab body on a TabbedScreenConfig — suppresses the
   * greeting header, matching ListScreenComponent's own `embedded` input
   * (list-screen.component.ts:267). Dashboards are unlikely to be tabbed in
   * practice, but every shape in this family carries the same input so a
   * later TabbedScreenComponent @switch (screen-host.component.ts's sibling)
   * can host any of them uniformly. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly refData = inject(RefDataService);

  // Raw fetch results, keyed by tile/widget/stat key. A key absent from the
  // map (undefined) means "still loading" — there's no separate loading
  // signal to keep in sync, the same trick TabbedScreenComponent's own
  // `counts` signal relies on for its badge (tabbed-screen.component.ts:129).
  private readonly tileData = signal<Record<string, unknown>>({});
  private readonly widgetData = signal<Record<string, unknown>>({});
  private readonly statData = signal<Record<string, unknown>>({});

  constructor() {
    effect(() => {
      const cfg = this.config();
      this.tileData.set({});
      this.widgetData.set({});
      this.statData.set({});

      for (const tile of cfg.tiles ?? []) {
        this.http.get<unknown>(`${environment.apiBaseUrl}${tile.endpoint}`).subscribe({
          next: (data) => this.tileData.update((m) => ({ ...m, [tile.key]: data })),
          // A tile whose endpoint this role can't reach still renders — an
          // empty array reads as 0 through `compute` (almost always
          // `.length`) rather than leaving the tile stuck on "…" forever.
          error: () => this.tileData.update((m) => ({ ...m, [tile.key]: [] })),
        });
      }

      for (const row of cfg.widgetRows) {
        for (const widget of row.widgets) {
          if (widget.kind === 'stats') {
            for (const stat of widget.stats ?? []) {
              const key = this.statKey(widget, stat);
              this.http.get<unknown>(`${environment.apiBaseUrl}${stat.endpoint}`).subscribe({
                next: (data) => this.statData.update((m) => ({ ...m, [key]: data })),
                error: () => this.statData.update((m) => ({ ...m, [key]: [] })),
              });
            }
            continue;
          }
          if (!widget.endpoint) continue; // 'links' widgets carry no data at all
          this.http.get<unknown>(`${environment.apiBaseUrl}${widget.endpoint}`).subscribe({
            next: (data) => this.widgetData.update((m) => ({ ...m, [widget.key]: data })),
            // 'record' legitimately has nothing yet (payslip not run this
            // period) — null, not []; every other kind falls back to an
            // empty list, which reads as the widget's own empty state.
            error: () => this.widgetData.update((m) => ({ ...m, [widget.key]: widget.kind === 'record' ? null : [] })),
          });
        }
      }
    });
  }

  // ---- header -------------------------------------------------------------

  /** `config().title` is the greeting PREFIX ('Good afternoon'), not the
   * whole line — the prototype appends the signed-in user's first name
   * (app-screens.js:150: `Good afternoon, ${Rl.who.split(' ')[0]}`). */
  protected greeting(): string {
    const first = (this.session.user()?.fullName ?? '').trim().split(/\s+/)[0];
    return first ? `${this.config().title}, ${first}` : this.config().title;
  }

  protected noteClass(): string {
    const kind = this.config().note?.kind;
    return kind === 'warn' ? 'warn' : kind === 'danger' ? 'danger' : '';
  }

  // ---- tiles ----------------------------------------------------------------

  protected toneVar(tone: DashboardTone): string {
    return TONE_VAR[tone];
  }

  protected toneBgVar(tone: DashboardTone): string {
    return TONE_BG_VAR[tone];
  }

  private tileRaw(t: DashboardTileDef): unknown {
    return this.tileData()[t.key];
  }

  protected tileValue(t: DashboardTileDef): string {
    const data = this.tileRaw(t);
    return data === undefined ? '…' : String(t.compute(data));
  }

  protected tileFooter(t: DashboardTileDef): string {
    const data = this.tileRaw(t);
    return data === undefined ? '' : (t.footer?.(data) ?? '');
  }

  protected tileDelta(t: DashboardTileDef): { dir: 'up' | 'down'; text: string } | null {
    const data = this.tileRaw(t);
    if (data === undefined) return null;
    return t.delta?.(data) ?? null;
  }

  protected openTile(t: DashboardTileDef): void {
    if (t.route) this.router.navigate(t.route as unknown[]);
  }

  // ---- widget rows ----------------------------------------------------------

  protected rowClass(row: DashboardWidgetRow): string {
    return row.layout === 'single' ? 'grid' : `grid ${row.layout}`;
  }

  protected navigateStrip(strip: NonNullable<DashboardWidgetRow['strip']>): void {
    if (strip.actionRoute) this.router.navigate(strip.actionRoute as unknown[]);
  }

  // ---- widget data (table / meters / feed) -----------------------------------

  private rawRows(w: DashboardWidgetDef): unknown[] {
    const data = this.widgetData()[w.key];
    return Array.isArray(data) ? data : [];
  }

  protected isLoading(w: DashboardWidgetDef): boolean {
    return this.widgetData()[w.key] === undefined;
  }

  private filteredRows(w: DashboardWidgetDef): unknown[] {
    const rows = this.rawRows(w);
    return w.rowFilter ? rows.filter(w.rowFilter as (row: unknown) => boolean) : rows;
  }

  protected visibleRows(w: DashboardWidgetDef): unknown[] {
    const rows = this.filteredRows(w);
    return w.limit ? rows.slice(0, w.limit) : rows;
  }

  protected totalRows(w: DashboardWidgetDef): number {
    return this.filteredRows(w).length;
  }

  /** The card-head's top-right badge, e.g. expApprovalCard's "4 pending"
   * (app-screens.js:141) — computed from the filtered-but-not-limited rows,
   * so it states the true count even when `limit` is cutting the table down. */
  protected widgetBadge(w: DashboardWidgetDef): string | null {
    if (!w.badge || this.isLoading(w)) return null;
    return w.badge(this.filteredRows(w) as any);
  }

  protected badgeToneClass(w: DashboardWidgetDef): string {
    return w.badgeTone ? BADGE_TONE_CLASS[w.badgeTone] : 'b-neutral';
  }

  protected rowKey(w: DashboardWidgetDef, row: unknown, index: number): string {
    return w.rowId ? w.rowId(row as never) : String(index);
  }

  protected openWidgetRow(w: DashboardWidgetDef, row: unknown): void {
    if (w.rowRoute) this.router.navigate(w.rowRoute(row as never) as unknown[]);
  }

  protected openWidgetLink(w: DashboardWidgetDef): void {
    if (w.linkRoute) this.router.navigate(w.linkRoute as unknown[]);
  }

  // ---- table cells (mirrors ListScreenComponent's own display() contract,
  // list-screen.component.ts:456-495, so a mini-table formats identically to
  // the full list screen it can be promoted to later) --------------------

  protected alignClass(col: ColumnDef<unknown>): string {
    return columnAlignClass(col) || '';
  }

  protected cellClass(col: ColumnDef<unknown>): string {
    return [this.alignClass(col), col.cellClass ?? '', col.type === 'code' || col.type === 'date' ? 'mono' : '']
      .filter(Boolean)
      .join(' ');
  }

  protected rawValue(row: unknown, col: ColumnDef<unknown>): unknown {
    return col.compute ? col.compute(row) : (row as Record<string, unknown>)[col.key];
  }

  protected display(row: unknown, col: ColumnDef<unknown>): unknown {
    const raw = this.rawValue(row, col);
    if (col.ref) {
      const label = this.refData.label(col.ref, raw as string | null | undefined);
      return isBlank(label) ? EM_DASH : label;
    }
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    if (isBlank(raw)) return EM_DASH;
    if (col.staticOptions) {
      const hit = col.staticOptions.find((o) => o.value === String(raw));
      if (hit) return hit.label;
    }
    if (col.type === 'date') return formatDate(raw);
    if (col.type === 'money') return formatMoney(raw);
    if (col.type === 'status') return humanizeEnum(raw);
    return raw;
  }

  protected badgeCls(value: unknown): string {
    return badgeClass(value);
  }

  // ---- meters -----------------------------------------------------------

  protected meterRows(w: DashboardWidgetDef): readonly DashboardMeterRow[] {
    if (!w.meters || this.isLoading(w)) return [];
    return w.meters(this.rawRows(w) as any);
  }

  protected meterPct(m: DashboardMeterRow): number {
    return m.max ? Math.min(100, (m.value / m.max) * 100) : 0;
  }

  // ---- feed ---------------------------------------------------------------

  protected feedRows(w: DashboardWidgetDef): readonly DashboardFeedRow[] {
    if (!w.feedItems || this.isLoading(w)) return [];
    return w.feedItems(this.rawRows(w) as any);
  }

  // ---- stats (bare ministat row) ------------------------------------------

  protected statsColumns(w: DashboardWidgetDef): string {
    const n = (w.stats ?? []).length || 1;
    return `repeat(${n}, minmax(0, 1fr))`;
  }

  private statKey(w: DashboardWidgetDef, st: DashboardStatDef): string {
    return `${w.key}::${st.key}`;
  }

  protected statValue(w: DashboardWidgetDef, st: DashboardStatDef): string {
    const data = this.statData()[this.statKey(w, st)];
    return data === undefined ? '…' : String(st.compute(data));
  }

  protected openStat(st: DashboardStatDef): void {
    if (st.route) this.router.navigate(st.route as unknown[]);
  }

  // ---- links ----------------------------------------------------------------

  protected navigateTo(route: readonly unknown[]): void {
    this.router.navigate(route as unknown[]);
  }

  // ---- record (single-object summary card) -----------------------------

  protected recordLoading(w: DashboardWidgetDef): boolean {
    return this.widgetData()[w.key] === undefined;
  }

  protected recordRow(w: DashboardWidgetDef): Record<string, unknown> | null {
    const data = this.widgetData()[w.key];
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  }

  protected recordHeadline(w: DashboardWidgetDef): { label: string; value: string } | null {
    const row = this.recordRow(w);
    return row && w.recordHeadline ? w.recordHeadline(row as never) : null;
  }

  protected recordBadgeText(w: DashboardWidgetDef): string | null {
    const row = this.recordRow(w);
    return row && w.recordBadge ? w.recordBadge(row as never) : null;
  }

  protected recordRowText(w: DashboardWidgetDef, r: DashboardRecordRow): unknown {
    const row = this.recordRow(w);
    return row ? r.value(row as never) : EM_DASH;
  }
}
