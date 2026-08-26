import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { columnAlignClass } from '../column-policy';
import { EM_DASH, badgeClass, formatDate, formatMoney, humanizeEnum, isBlank } from '../cell-format';
import { CUSTOM_PRESET, DatePreset, buildDatePresets, resolveRange } from '../date-presets';
import { RefDataService } from '../ref-data.service';
import {
  ColumnDef,
  DateRangeValue,
  FilterDef,
  FilterOption,
  FilterValue,
  ReportScreenConfig,
  ReportSourceDef,
  ReportTableDef,
  ReportTileDef,
  ReportTone,
  SecondaryActionDef,
} from '../screen.types';

/** The prototype's report shape (R.report, app-screens.js:426) — KPI tiles
 * above one or more summary tables, sharing ONE filter bar. leave_reports.py
 * is the real backend this was modelled on: several GET endpoints that all
 * accept the same query params, off one shared filter helper server-side —
 * "the four views can never drift apart" (leave_reports.py:6-10) — and one
 * of those endpoints (`/liability`) returns a single object with no export
 * at all ("genuinely not list-shaped", leave_reports.py:31-33) while the
 * other three return arrays and DO export. `ReportSourceDef` models that
 * duality: a named GET whose response a tile or table reads for itself.
 *
 * There is deliberately no single combined "Export" for the whole screen —
 * with several independently-shaped sources, one button can't honestly say
 * what it exports. Each table carries its own `exportable` and its own
 * "Download this view" button instead (U.card's `foot`, app-screens.js:439),
 * exactly like the prototype's per-table export, which is also how RBAC 14
 * §2.2f's "export follows the filter" stays true per view rather than
 * averaged across views that may not even share row shapes.
 */
@Component({
  selector: 'app-report-screen',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="page-head">
      @if (!embedded()) {
        <div>
          <h1 class="page-title">
            {{ config().title }}
            @if (config().specRef) {
              <span class="spec-ref">{{ config().specRef }}</span>
            }
            @if (policy.isReadOnly(config().id)) {
              <span class="badge-s b-warn" title="You have view-only access to this screen — no changes can be made here.">Read-only</span>
            }
          </h1>
          @if (config().description) {
            <p class="page-sub">{{ config().description }}</p>
          }
        </div>
      }
      <div class="page-actions">
        @for (act of secondaryActions(); track act.label) {
          <button class="btn" type="button" (click)="runSecondary(act)">
            @if (act.icon) {
              <app-icon [name]="act.icon" [size]="14" />
            }
            {{ act.label }}
          </button>
        }
      </div>
    </div>

    @if (actionError()) {
      <div class="form-error" style="margin: 0 0 12px;">{{ actionError() }}</div>
    }

    <!-- §2.5's own warning, carried onto every report screen this shape
         renders rather than restated per report: switching a filter moves
         every tile and table at once, or it moves none of them. -->
    <div class="rbac-note">
      <app-icon name="info" [size]="14" />
      <div><b>All filters apply across every view on this screen simultaneously</b>, so switching view never silently changes the underlying set — a figure that quietly reflects a different filter than the table beside it would be worse than no figure at all.</div>
    </div>

    <div class="filterbar">
      <div class="filter-row">
        <div class="searchbox">
          <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
          <input type="search" placeholder="Search…" [value]="query()" (input)="setQuery($any($event.target).value)" />
        </div>

        @for (f of visibleFilters(); track f.key) {
          @switch (f.kind) {
            @case ('multiselect') {
              <span class="fmulti">
                <button class="fselect" type="button" [title]="f.label" (click)="toggleOpenPanel(f.key)">
                  {{ multiLabel(f) }}
                </button>
                @if (openPanel() === f.key) {
                  <span class="fmulti-panel">
                    @for (opt of optionsFor(f); track opt.value) {
                      <label>
                        <input type="checkbox" [checked]="isChecked(f, opt.value)" (change)="toggleMulti(f, opt.value)" />
                        {{ opt.label }}
                      </label>
                    }
                  </span>
                }
              </span>
            }
            @case ('daterange') {
              <select class="fselect" [title]="f.label" [value]="datePreset(f)" (change)="setPreset(f, $any($event.target).value)">
                <option value="">{{ f.allLabel ?? f.label }}</option>
                @for (p of presets(); track p.value) {
                  <option [value]="p.value">{{ p.label }}</option>
                }
              </select>
              @if (datePreset(f) === CUSTOM) {
                <input class="fsearch" type="date" [value]="dateFrom(f)" (change)="setCustomDate(f, 'from', $any($event.target).value)" style="max-width: 150px;" />
                <input class="fsearch" type="date" [value]="dateTo(f)" (change)="setCustomDate(f, 'to', $any($event.target).value)" style="max-width: 150px;" />
              }
            }
            @case ('activeInactive') {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? 'All Statuses' }}</option>
                @for (opt of optionsFor(f); track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            }
            @case ('tristate') {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? f.label + ' — Any' }}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            }
            @default {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? 'All ' + f.label }}</option>
                @for (opt of optionsFor(f); track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            }
          }
        }
      </div>

      <div class="chips">
        @for (chip of chips(); track chip.key) {
          <span class="chip">
            {{ chip.label }}: <b>{{ chip.value }}</b>
            <span class="rm" role="button" [attr.aria-label]="'Remove ' + chip.label + ' filter'" (click)="removeChip(chip.key)">×</span>
          </span>
        }
        @if (chips().length) {
          <span class="clear" role="button" (click)="clearAll()">Clear all</span>
        }
      </div>
    </div>

    @if (tiles().length) {
      <div class="grid g-kpi">
        @for (tile of tiles(); track tile.label) {
          <div class="kpi" [style.--tone]="toneVar(tile.tone).tone" [style.--tone-bg]="toneVar(tile.tone).bg">
            <div class="kpi-top">
              <div class="kpi-ico"><app-icon [name]="tile.icon" [size]="14" /></div>
              <div class="kpi-label">{{ tile.label }}</div>
            </div>
            <div class="kpi-val num">{{ tileValue(tile) }}@if (tile.unit) {<small> {{ tile.unit }}</small>}</div>
            <div class="kpi-foot">
              @if (tileDelta(tile); as d) {
                <span class="delta {{ tile.dir }}">{{ tile.dir === 'up' ? '▲' : '▼' }} {{ d }}</span>
              }
              <span>{{ tileFoot(tile) }}</span>
            </div>
          </div>
        }
      </div>
    }

    <div class="grid g-2">
      @for (table of config().tables; track table.title) {
        <div class="card">
          <div class="card-head">
            <h3>{{ table.title }}</h3>
            @if (tableRows(table).length) {
              <span class="sub">{{ tableRows(table).length }} row{{ tableRows(table).length === 1 ? '' : 's' }}</span>
            }
          </div>
          <div class="card-body flush">
            @if (tableLoading(table)) {
              <div class="empty"><p>Loading…</p></div>
            } @else if (tableError(table)) {
              @if (tableError(table); as err) {
                <div class="empty">
                  <div class="ico">⚠</div>
                  <p><b>Couldn't load this view</b></p>
                  <p class="hint">{{ err }}</p>
                </div>
              }
            } @else if (!tableRows(table).length) {
              <div class="empty">
                <div class="ico">∅</div>
                <p>{{ table.emptyText ?? 'No records match the filters currently applied.' }}</p>
              </div>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      @for (col of table.columns; track col.key) {
                        <th [class]="alignClass(col)">{{ col.header }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of tableRows(table); track $index) {
                      <tr>
                        @for (col of table.columns; track col.key) {
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
          @if (table.exportable) {
            <div class="card-foot">
              <button class="btn sm ghost" type="button" [disabled]="!!exportingTable()[table.title]" (click)="exportTable(table, 'pdf')">
                <app-icon name="download" [size]="13" />{{ exportingTable()[table.title] === 'pdf' ? 'Exporting…' : 'Download PDF' }}
              </button>
              <button class="btn sm ghost" type="button" [disabled]="!!exportingTable()[table.title]" (click)="exportTable(table, 'excel')">
                <app-icon name="download" [size]="13" />{{ exportingTable()[table.title] === 'excel' ? 'Exporting…' : 'Download Excel' }}
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ReportScreenComponent<T = any> {
  readonly config = input.required<ReportScreenConfig<T>>();
  /** True when hosted as a tab body on a TabbedScreenConfig — suppresses this
   * component's own page title, matching list-screen's own `embedded` input
   * (list-screen.component.ts) since a report may end up embedded the same
   * way once a later phase wires one into a tabbed record. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(SessionStore);
  private readonly refData = inject(RefDataService);
  protected readonly policy = inject(PolicyStore);

  protected readonly CUSTOM = CUSTOM_PRESET;

  private readonly financialYears = signal<readonly any[]>([]);
  protected readonly presets = computed<readonly DatePreset[]>(() => buildDatePresets(this.financialYears() as any));

  protected readonly query = signal('');
  private readonly filterValues = signal<Record<string, FilterValue>>({});
  protected readonly openPanel = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  /** Raw response per source, keyed by ReportSourceDef.key — an object for a
   * headline-figure endpoint, an array for a breakdown endpoint. Undefined
   * until the first fetch for that source resolves. */
  private readonly sourceData = signal<Record<string, unknown>>({});
  private readonly sourceLoading = signal<Record<string, boolean>>({});
  private readonly sourceError = signal<Record<string, string | null>>({});
  protected readonly exportingTable = signal<Record<string, 'pdf' | 'excel' | null>>({});

  // §2.2c: "The applied filter state persists for that user, on that screen,
  // within a session" — same sessionStorage lifetime create-list-store.ts
  // uses for the list shape, so a report screen doesn't quietly behave
  // differently from every list screen beside it in the same module.
  private storageKey(cfg: ReportScreenConfig<T>): string {
    return `report-filters:${cfg.id}`;
  }

  private readPersisted(cfg: ReportScreenConfig<T>): { values: Record<string, FilterValue>; q: string } | null {
    try {
      const raw = sessionStorage.getItem(this.storageKey(cfg));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(this.storageKey(this.config()), JSON.stringify({ values: this.filterValues(), q: this.query() }));
    } catch {
      /* non-fatal */
    }
  }

  private defaultsFor(cfg: ReportScreenConfig<T>): Record<string, FilterValue> {
    const out: Record<string, FilterValue> = {};
    for (const f of cfg.filters ?? []) out[f.key] = f.defaultValue ?? (f.kind === 'multiselect' ? [] : null);
    return out;
  }

  constructor() {
    // Re-seed on screen change, same as create-list-store.ts.
    effect(() => {
      const cfg = this.config();
      const saved = this.readPersisted(cfg);
      this.filterValues.set(saved?.values ?? this.defaultsFor(cfg));
      this.query.set(saved?.q ?? '');
      this.sourceData.set({});
      this.sourceError.set({});
    });

    let fetchedFy = false;
    effect(() => {
      if (fetchedFy) return;
      if (!(this.config().filters ?? []).some((f) => f.kind === 'daterange')) return;
      fetchedFy = true;
      this.http.get<any[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
        next: (rows) => this.financialYears.set(rows ?? []),
        error: () => this.financialYears.set([]),
      });
    });

    // Refetches every named source whenever the screen, a server filter, or
    // the search box changes — the mechanism behind the note above: no
    // source is ever left on a stale filter while another has moved on.
    effect(() => {
      const cfg = this.config();
      const base = this.baseParams();
      const q = this.query().trim();
      for (const src of cfg.sources) {
        const raw = src.searchParam && q ? { ...base, [src.searchParam]: q } : base;
        this.fetchSource(src, this.toHttpParams(raw));
      }
    });
  }

  private fetchSource(src: ReportSourceDef, params: HttpParams): void {
    this.sourceLoading.update((s) => ({ ...s, [src.key]: true }));
    this.sourceError.update((s) => ({ ...s, [src.key]: null }));
    this.http
      .get(`${environment.apiBaseUrl}${src.endpoint}`, { params })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.sourceData.update((s) => ({ ...s, [src.key]: data }));
          this.sourceLoading.update((s) => ({ ...s, [src.key]: false }));
        },
        error: (err) => {
          this.sourceError.update((s) => ({ ...s, [src.key]: err?.error?.detail ?? 'Failed to load this view.' }));
          this.sourceLoading.update((s) => ({ ...s, [src.key]: false }));
        },
      });
  }

  // ---- filters ----------------------------------------------------------

  /** RBAC §2.2b/e, same rule as list-screen.component.ts's visibleFilters(). */
  protected visibleFilters(): FilterDef<any>[] {
    const role = (this.session.role() ?? '').toUpperCase();
    const id = this.config().id;
    return (this.config().filters ?? []).filter((f) => {
      if (f.superAdminOnly && role !== 'SUPER_ADMIN') return false;
      if (f.hideForRoles?.length && role && f.hideForRoles.some((r) => r.toUpperCase() === role)) return false;
      if (f.hideWhenFieldHidden && this.policy.fieldMode(id, f.hideWhenFieldHidden) === 'hide') return false;
      return true;
    });
  }

  protected optionsFor(f: FilterDef<any>): readonly FilterOption[] {
    if (f.options) return f.options;
    if (f.optionsFromRows) {
      // A report has no single "all rows" set the way a list does — fall
      // back to the first source's current data, which is the only rows a
      // client-derived option list could plausibly mean here.
      const first = this.config().sources[0];
      const data = first ? this.sourceData()[first.key] : undefined;
      return f.optionsFromRows(Array.isArray(data) ? (data as any[]) : [], this.refData);
    }
    if (f.optionsRef) {
      return (this.refData.options(f.optionsRef) ?? []).map((o) => ({ value: o.id, label: o.label }));
    }
    return [];
  }

  protected asString(f: FilterDef<any>): string {
    const v = this.filterValues()[f.key];
    return v === null || v === undefined ? '' : String(v);
  }

  protected isChecked(f: FilterDef<any>, value: string): boolean {
    const v = this.filterValues()[f.key];
    return Array.isArray(v) && v.includes(value);
  }

  protected toggleMulti(f: FilterDef<any>, value: string): void {
    const current = this.filterValues()[f.key];
    const list = Array.isArray(current) ? [...current] : [];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    this.setFilter(f.key, list);
  }

  protected multiLabel(f: FilterDef<any>): string {
    const v = this.filterValues()[f.key];
    const list = Array.isArray(v) ? v : [];
    if (!list.length) return f.allLabel ?? `All ${f.label}`;
    const opts = this.optionsFor(f);
    if (list.length === 1) return opts.find((o) => o.value === list[0])?.label ?? String(list[0]);
    return `${f.label}: ${list.length} selected`;
  }

  protected toggleOpenPanel(key: string): void {
    this.openPanel.update((k) => (k === key ? null : key));
  }

  protected datePreset(f: FilterDef<any>): string {
    const v = this.filterValues()[f.key] as DateRangeValue | null;
    return v?.preset ?? '';
  }

  protected dateFrom(f: FilterDef<any>): string {
    return (this.filterValues()[f.key] as DateRangeValue | null)?.from ?? '';
  }

  protected dateTo(f: FilterDef<any>): string {
    return (this.filterValues()[f.key] as DateRangeValue | null)?.to ?? '';
  }

  protected setPreset(f: FilterDef<any>, preset: string): void {
    this.setFilter(f.key, preset ? { preset, from: null, to: null } : null);
  }

  protected setCustomDate(f: FilterDef<any>, which: 'from' | 'to', value: string): void {
    const cur = (this.filterValues()[f.key] as DateRangeValue | null) ?? { preset: CUSTOM_PRESET, from: null, to: null };
    this.setFilter(f.key, { ...cur, preset: CUSTOM_PRESET, [which]: value || null } as DateRangeValue);
  }

  protected setQuery(q: string): void {
    this.query.set(q);
    this.persist();
  }

  protected setFilter(key: string, value: FilterValue): void {
    this.filterValues.update((v) => ({ ...v, [key]: value }));
    this.persist();
  }

  protected clearFilter(key: string): void {
    const def = (this.config().filters ?? []).find((f) => f.key === key);
    this.filterValues.update((v) => ({ ...v, [key]: def?.kind === 'multiselect' ? [] : null }));
    this.persist();
  }

  protected clearAll(): void {
    this.filterValues.set(this.defaultsFor(this.config()));
    this.query.set('');
    this.persist();
  }

  /** The server query params EVERY source is fetched with — the mechanism
   * behind the on-screen note that no view can silently reflect a different
   * filter than the one beside it. Search is excluded here since only
   * sources that declare `searchParam` should ever receive it (mirrors
   * ReportSourceDef.searchParam's own doc). */
  private readonly baseParams = computed<Record<string, string | string[]>>(() => {
    const cfg = this.config();
    const values = this.filterValues();
    const out: Record<string, string | string[]> = {};
    for (const f of cfg.filters ?? []) {
      if (f.transport !== 'server') continue;
      const v = values[f.key];
      if (v === null || v === undefined || v === '') continue;
      const param = f.param ?? f.key;
      if (Array.isArray(v)) {
        if (v.length) out[param] = [...v];
      } else if (f.kind === 'daterange') {
        const { from, to } = resolveRange(v as DateRangeValue, this.presets());
        if (from) out[`${param}_from`] = from;
        if (to) out[`${param}_to`] = to;
      } else {
        out[param] = String(v);
      }
    }
    return out;
  });

  private toHttpParams(raw: Record<string, string | string[]>): HttpParams {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) for (const item of v) params = params.append(k, item);
      else params = params.set(k, v);
    }
    return params;
  }

  // ---- chips --------------------------------------------------------------

  protected chips(): { key: string; label: string; value: string }[] {
    const out: { key: string; label: string; value: string }[] = [];
    const q = this.query().trim();
    if (q) out.push({ key: '__search', label: 'Search', value: q });
    for (const f of this.visibleFilters()) {
      const v = this.filterValues()[f.key];
      if (!this.isEngaged(f, v)) continue;
      out.push({ key: f.key, label: f.label, value: f.formatChip ? f.formatChip(v) : this.chipValue(f, v) });
    }
    return out;
  }

  private isEngaged(f: FilterDef<any>, v: FilterValue): boolean {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (f.kind === 'daterange') {
      const d = v as DateRangeValue;
      return !!(d?.preset || d?.from || d?.to);
    }
    return true;
  }

  private chipValue(f: FilterDef<any>, v: FilterValue): string {
    if (Array.isArray(v)) {
      const opts = this.optionsFor(f);
      return v.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(', ');
    }
    if (f.kind === 'daterange') {
      const d = v as DateRangeValue;
      if (d?.preset && d.preset !== CUSTOM_PRESET) {
        return this.presets().find((p) => p.value === d.preset)?.label ?? d.preset;
      }
      return `${formatDate(d?.from) || '…'} → ${formatDate(d?.to) || '…'}`;
    }
    if (f.kind === 'tristate') return String(v) === 'yes' ? 'Yes' : 'No';
    return this.optionsFor(f).find((o) => o.value === String(v))?.label ?? String(v);
  }

  protected removeChip(key: string): void {
    if (key === '__search') this.setQuery('');
    else this.clearFilter(key);
  }

  // ---- tiles --------------------------------------------------------------

  protected tiles(): readonly ReportTileDef[] {
    return this.config().tiles ?? [];
  }

  private static readonly TONE_VARS: Record<ReportTone, { tone: string; bg: string }> = {
    accent: { tone: 'var(--accent)', bg: 'var(--accent-subtle)' },
    success: { tone: 'var(--success)', bg: 'var(--success-bg)' },
    warning: { tone: 'var(--warning)', bg: 'var(--warning-bg)' },
    danger: { tone: 'var(--danger)', bg: 'var(--danger-bg)' },
    info: { tone: 'var(--info)', bg: 'var(--info-bg)' },
    purple: { tone: 'var(--purple)', bg: 'var(--purple-bg)' },
  };

  protected toneVar(tone: ReportTone): { tone: string; bg: string } {
    return ReportScreenComponent.TONE_VARS[tone] ?? ReportScreenComponent.TONE_VARS.accent;
  }

  protected tileValue(tile: ReportTileDef): string {
    const data = this.sourceData()[tile.source];
    if (data === undefined) return '…';
    try {
      return String(tile.compute(data));
    } catch {
      return EM_DASH;
    }
  }

  protected tileFoot(tile: ReportTileDef): string {
    const data = this.sourceData()[tile.source];
    if (data === undefined || !tile.foot) return '';
    return typeof tile.foot === 'function' ? tile.foot(data) : tile.foot;
  }

  protected tileDelta(tile: ReportTileDef): string | null {
    const data = this.sourceData()[tile.source];
    if (data === undefined || !tile.delta) return null;
    return typeof tile.delta === 'function' ? tile.delta(data) : tile.delta;
  }

  // ---- tables ---------------------------------------------------------------

  protected tableRows(table: ReportTableDef<any>): readonly any[] {
    const data = this.sourceData()[table.source];
    return Array.isArray(data) ? data : [];
  }

  protected tableLoading(table: ReportTableDef<any>): boolean {
    const src = this.sourceOf(table);
    return !!(src && this.sourceLoading()[src.key]);
  }

  protected tableError(table: ReportTableDef<any>): string | null {
    const src = this.sourceOf(table);
    return src ? this.sourceError()[src.key] ?? null : null;
  }

  private sourceOf(table: ReportTableDef<any>): ReportSourceDef | undefined {
    return this.config().sources.find((s) => s.key === table.source);
  }

  protected rowKey(table: ReportTableDef<any>, row: any, index: number): string {
    return table.rowId?.(row) ?? String(index);
  }

  protected alignClass(col: ColumnDef<any>): string {
    return columnAlignClass(col) || '';
  }

  protected cellClass(col: ColumnDef<any>): string {
    return [this.alignClass(col), col.cellClass ?? '', col.type === 'code' || col.type === 'date' ? 'mono' : '']
      .filter(Boolean)
      .join(' ');
  }

  protected rawValue(row: any, col: ColumnDef<any>): unknown {
    return col.compute ? col.compute(row) : row[col.key];
  }

  /** Same value contract as list-screen.component.ts's display() — one
   * shared cell-format.ts pipeline so a report table's Money/Date/Status
   * cells render identically to every list screen's. */
  protected display(row: any, col: ColumnDef<any>): unknown {
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

  // ---- actions ----------------------------------------------------------

  protected secondaryActions(): readonly SecondaryActionDef[] {
    return (this.config().secondaryActions ?? []).filter((a) => this.policy.can(this.config().id, a.screenAction));
  }

  protected runSecondary(act: SecondaryActionDef): void {
    if (act.confirm && !window.confirm(act.confirm)) return;
    if (!act.endpoint) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}${act.endpoint}`, {}).subscribe({
      error: (err) => this.actionError.set(err?.error?.detail ?? 'That action failed.'),
    });
  }

  // Same auth-and-blob mechanism as list-screen.component.ts's exportAs():
  // Bearer auth is header-only, so a plain link/window.open would hit the
  // API unauthenticated. Carries the SAME shared filter params every source
  // was just fetched with, so the export's own "Filters:" header states the
  // truth (RBAC 14 §2.2f).
  protected exportTable(table: ReportTableDef<any>, format: 'pdf' | 'excel'): void {
    const src = this.sourceOf(table);
    if (!src || this.exportingTable()[table.title]) return;
    this.exportingTable.update((s) => ({ ...s, [table.title]: format }));
    this.actionError.set(null);

    const base = this.baseParams();
    const q = this.query().trim();
    const raw = src.searchParam && q ? { ...base, [src.searchParam]: q } : base;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) for (const item of v) search.append(k, item);
      else search.set(k, v);
    }
    search.set('format', format);

    const url = `${environment.apiBaseUrl}${src.endpoint}?${search.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exportingTable.update((s) => ({ ...s, [table.title]: null }));
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `${table.title}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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
        this.exportingTable.update((s) => ({ ...s, [table.title]: null }));
        this.actionError.set(await this.resolveBlobError(err));
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
