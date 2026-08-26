import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { badgeClass, formatDate, humanizeEnum } from '../cell-format';
import { FinancialYearLike, withinRange } from '../date-presets';
import { CalendarScreenConfig, SecondaryActionDef } from '../screen.types';
import { RoleButtonDirective } from '../../ui/role-button.directive';

// Full/short month names for grouping and the cal-day mini-date box — the
// prototype's cal-month grouping is by bare month abbrev (app-screens.js:452,
// `months.find(x => x.m === h.m)`), which only works because its demo data
// never repeats a month across two different years within one FY. A real
// endpoint has no such guarantee, so grouping/labelling here keys off the
// full 'yyyy-mm' instead — "August 2026" and "August 2027" are never merged.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseIsoDate(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : null;
}

/** The prototype's calendar shape (R.calendar, app-screens.js:444) — a
 * month-by-month grid of events with a Calendar/List view switcher
 * (app-screens.js:454), used today only by Masters → Holidays (editable) and
 * Leave → Company Holiday Calendar (its read-only mirror, app-screens.js:463's
 * "sourced entirely from Masters → Holidays… not editable here"). The Angular
 * build currently renders Masters → Holidays as a plain list rather than this
 * shape — a known divergence, out of scope here; wiring that switch is a
 * later phase's call once this component exists to switch it to.
 *
 * Both screens are driven by the SAME real endpoint returning the SAME rows;
 * only `editable`/`createRoute`/`rowRoute` differ between the two configs, so
 * nothing about the read-only mirror is a special case in this component.
 */
@Component({
  selector: 'app-calendar-screen',
  standalone: true,
  imports: [IconComponent, RoleButtonDirective],
  template: `
    <div class="page-head" [class.embedded]="embedded()">
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
        @if (canCreate()) {
          <button class="btn primary" type="button" (click)="openCreate()">
            <app-icon name="plus" [size]="14" />{{ config().createLabel ?? 'Add' }}
          </button>
        }
        @for (act of visibleSecondaryActions(); track act.label) {
          <button class="btn" type="button" (click)="runSecondary(act)">
            @if (act.icon) {
              <app-icon [name]="act.icon" [size]="14" />
            }
            {{ act.label }}
          </button>
        }
        @if (config().exportable) {
          <button class="btn" type="button" [disabled]="!!exporting()" (click)="exportAs('pdf')">
            <app-icon name="download" [size]="14" />{{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
          </button>
          <button class="btn" type="button" [disabled]="!!exporting()" (click)="exportAs('excel')">
            <app-icon name="download" [size]="14" />{{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
          </button>
        }
      </div>
    </div>

    @if (actionError()) {
      <div class="form-error" style="margin: 0 0 12px;">{{ actionError() }}</div>
    }

    @if (!cfg().editable && cfg().readOnlyNote) {
      <div class="rbac-note">
        <app-icon name="info" [size]="14" />
        <div [innerHTML]="cfg().readOnlyNote"></div>
      </div>
    }

    <div class="filterbar">
      <div class="filter-row">
        <div class="searchbox">
          <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
          <input type="search" [placeholder]="'Search ' + recordNounPlural() + '…'" [value]="query()" (input)="query.set($any($event.target).value)" />
        </div>

        <select class="fselect" title="Month" [value]="monthValue() ?? ''" (change)="monthValue.set($any($event.target).value || null)">
          <option value="">All Months</option>
          @for (opt of monthOptions(); track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>

        @if (typeOptionsResolved().length) {
          <select class="fselect" title="Type" [value]="typeValue() ?? ''" (change)="typeValue.set($any($event.target).value || null)">
            <option value="">All Types</option>
            @for (opt of typeOptionsResolved(); track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        }

        @if (financialYears().length) {
          <select class="fselect" title="Financial Year" [value]="finYearValue() ?? ''" (change)="finYearValue.set($any($event.target).value || null)">
            <option value="">All Financial Years</option>
            @for (fy of financialYears(); track fy.id) {
              <option [value]="fy.id">{{ fy.label ?? fy.start_date.slice(0, 4) }}</option>
            }
          </select>
        }

        <input class="fsearch" type="date" title="From" [value]="dateFromValue() ?? ''" (change)="dateFromValue.set($any($event.target).value || null)" style="max-width: 150px;" />
        <input class="fsearch" type="date" title="To" [value]="dateToValue() ?? ''" (change)="dateToValue.set($any($event.target).value || null)" style="max-width: 150px;" />

        <div class="seg" style="margin-left: auto;">
          <button type="button" [class.on]="view() === 'cal'" (click)="view.set('cal')">
            <app-icon name="grid" [size]="13" /> Calendar
          </button>
          <button type="button" [class.on]="view() === 'list'" (click)="view.set('list')">
            <app-icon name="list" [size]="13" /> List
          </button>
        </div>
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
        <span class="count">Showing {{ filteredRows().length }} of {{ allRows().length }}</span>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card">
        <div class="empty"><p>Loading…</p></div>
      </div>
    } @else if (error()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this calendar</b></p>
          <p class="hint">{{ error() }}</p>
        </div>
      </div>
    } @else if (filteredRows().length === 0) {
      <div class="card">
        <div class="empty">
          <div class="ico">∅</div>
          @if (chips().length) {
            <p>No {{ recordNounPlural() }} match {{ filterSentence() }}.</p>
            <p class="hint"><span class="clear" role="button" (click)="clearAll()">Clear all filters</span></p>
          } @else {
            <p>{{ config().emptyText ?? ('No ' + recordNounPlural() + ' found.') }}</p>
          }
        </div>
      </div>
    } @else if (view() === 'cal') {
      <div class="cal">
        @for (group of monthGroups(); track group.key) {
          <div class="cal-month">
            <h5>{{ group.label }}</h5>
            @for (row of group.rows; track $index) {
              <div class="cal-day" [class.clickable]="canOpenRow()" (click)="openRow(row)">
                <div class="cal-date">
                  <span class="d">{{ dayOfMonth(row) }}</span>
                  <span class="m">{{ shortMonth(row) }}</span>
                </div>
                <div class="cal-name">
                  {{ cfg().name(row) }}
                  <span class="sub">{{ subLabel(row) }}</span>
                </div>
                @if (typeLabel(row); as tl) {
                  <span class="badge-s {{ typeBadgeClass(row) }}">{{ tl }}</span>
                }
              </div>
            }
          </div>
        }
      </div>
    } @else {
      <div class="card">
        <div class="card-head">
          <h3>{{ config().title }} List</h3>
          <span class="sub">{{ filteredRows().length }} {{ filteredRows().length === 1 ? recordNoun() : recordNounPlural() }}</span>
        </div>
        <div class="card-body flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{{ recordNounTitle() }} Name</th>
                  <th>Date</th>
                  <th>Day</th>
                  @if (cfg().type) {
                    <th>Type</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of filteredRows(); track $index) {
                  <tr [class.clickable]="canOpenRow()" (click)="openRow(row)">
                    <td class="cell-strong">{{ cfg().name(row) }}</td>
                    <td class="mono">{{ formattedDate(row) }}</td>
                    <td>{{ subLabel(row) }}</td>
                    @if (cfg().type) {
                      <td>
                        @if (typeLabel(row); as tl) {
                          <span class="badge-s {{ typeBadgeClass(row) }}">{{ tl }}</span>
                        } @else {
                          —
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
})
export class CalendarScreenComponent<T = any> {
  readonly config = input.required<CalendarScreenConfig<T>>();
  /** True when rendered as a tab body — suppresses this component's own page
   * title/description, matching ListScreenComponent's `embedded` (list-screen.
   * component.ts) so a later phase can host a calendar inside a TabbedScreenConfig. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly policy = inject(PolicyStore);

  protected readonly allRows = signal<T[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);

  protected readonly query = signal('');
  protected readonly monthValue = signal<string | null>(null);
  protected readonly typeValue = signal<string | null>(null);
  // §2.4's own remaining two filters — Financial Year and a plain date
  // range — fetched/filtered the same generic, config-free way Month/Type
  // already are, so every calendar-shaped screen gets them for free (today:
  // Masters -> Holidays and this screen's own Leave -> Company Holiday
  // Calendar mirror, both genuinely date-based lists).
  protected readonly financialYears = signal<readonly FinancialYearLike[]>([]);
  protected readonly finYearValue = signal<string | null>(null);
  protected readonly dateFromValue = signal<string | null>(null);
  protected readonly dateToValue = signal<string | null>(null);
  // Defaults to the prototype's own default (app-screens.js:453, `S.view[s.id] || 'cal'`).
  protected readonly view = signal<'cal' | 'list'>('cal');

  constructor() {
    this.http.get<FinancialYearLike[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
      next: (rows) => this.financialYears.set(rows ?? []),
      // A role that can't read Financial Year at all just doesn't get the
      // filter — same degrade-quietly rule as this file's own Month/Type.
      error: () => this.financialYears.set([]),
    });
    effect(() => {
      const cfg = this.config();
      this.isLoading.set(true);
      this.error.set(null);
      this.query.set('');
      this.monthValue.set(null);
      this.typeValue.set(null);
      this.finYearValue.set(null);
      this.dateFromValue.set(null);
      this.dateToValue.set(null);
      this.http
        .get<T[]>(`${environment.apiBaseUrl}${cfg.endpoint}`)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (rows) => {
            this.allRows.set(Array.isArray(rows) ? rows : []);
            this.isLoading.set(false);
          },
          error: (err) => {
            this.error.set(err?.error?.detail ?? 'Failed to load data.');
            this.isLoading.set(false);
          },
        });
    });
  }

  /** Shorthand the template reaches for constantly — `config()` alone reads
   * fine as a getter call but is noisy repeated a dozen times per template. */
  protected cfg(): CalendarScreenConfig<T> {
    return this.config();
  }

  // ---- derived option lists ----------------------------------------------

  /** Always built from the FULL fetched set, never the filtered one — the
   * same "honest options" rule ListScreenComponent.optionsFor follows via
   * store.allRows(), so picking Month never collapses its own option list. */
  protected readonly monthOptions = computed<{ value: string; label: string }[]>(() => {
    const cfg = this.config();
    const seen = new Map<string, string>();
    for (const row of this.allRows()) {
      const parsed = parseIsoDate(cfg.date(row));
      if (!parsed) continue;
      const key = `${parsed.y}-${String(parsed.m).padStart(2, '0')}`;
      if (!seen.has(key)) seen.set(key, `${MONTH_NAMES[parsed.m - 1]} ${parsed.y}`);
    }
    return Array.from(seen.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }));
  });

  /** `typeOptions` wins when the config names them (so a real backend enum
   * gets real labels/colours); otherwise derived from whatever values are
   * actually present, same fallback FilterDef.optionsFromRows uses elsewhere. */
  protected readonly typeOptionsResolved = computed<{ value: string; label: string; badgeClass?: string }[]>(() => {
    const cfg = this.config();
    if (cfg.typeOptions) return [...cfg.typeOptions];
    if (!cfg.type) return [];
    const seen = new Map<string, string>();
    for (const row of this.allRows()) {
      const raw = cfg.type(row);
      if (raw === null || raw === undefined || raw === '') continue;
      if (!seen.has(raw)) seen.set(raw, humanizeEnum(raw));
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  });

  // ---- filtering ----------------------------------------------------------

  protected readonly filteredRows = computed<T[]>(() => {
    const cfg = this.config();
    let rows = [...this.allRows()].sort((a, b) => (cfg.date(a) || '').localeCompare(cfg.date(b) || ''));

    const month = this.monthValue();
    if (month) {
      rows = rows.filter((row) => {
        const parsed = parseIsoDate(cfg.date(row));
        return !!parsed && `${parsed.y}-${String(parsed.m).padStart(2, '0')}` === month;
      });
    }

    const type = this.typeValue();
    if (type) rows = rows.filter((row) => cfg.type?.(row) === type);

    const fyId = this.finYearValue();
    if (fyId) {
      const fy = this.financialYears().find((y) => y.id === fyId);
      if (fy) rows = rows.filter((row) => withinRange(cfg.date(row), fy.start_date, fy.end_date));
    }

    const dateFrom = this.dateFromValue();
    const dateTo = this.dateToValue();
    if (dateFrom || dateTo) rows = rows.filter((row) => withinRange(cfg.date(row), dateFrom, dateTo));

    const q = this.query().trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const name = cfg.name(row).toLowerCase();
        const sub = this.subLabel(row).toLowerCase();
        return name.includes(q) || sub.includes(q);
      });
    }
    return rows;
  });

  protected readonly monthGroups = computed<{ key: string; label: string; rows: T[] }[]>(() => {
    const cfg = this.config();
    const groups: { key: string; label: string; rows: T[] }[] = [];
    const byKey = new Map<string, { key: string; label: string; rows: T[] }>();
    for (const row of this.filteredRows()) {
      const parsed = parseIsoDate(cfg.date(row));
      const key = parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}` : '—';
      const label = parsed ? `${MONTH_NAMES[parsed.m - 1]} ${parsed.y}` : 'Undated';
      let g = byKey.get(key);
      if (!g) {
        g = { key, label, rows: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.rows.push(row);
    }
    return groups;
  });

  // ---- chips ----------------------------------------------------------------

  protected chips(): { key: string; label: string; value: string }[] {
    const out: { key: string; label: string; value: string }[] = [];
    const q = this.query().trim();
    if (q) out.push({ key: '__search', label: 'Search', value: q });
    const month = this.monthValue();
    if (month) out.push({ key: '__month', label: 'Month', value: this.monthOptions().find((o) => o.value === month)?.label ?? month });
    const type = this.typeValue();
    if (type) out.push({ key: '__type', label: 'Type', value: this.typeOptionsResolved().find((o) => o.value === type)?.label ?? type });
    const fyId = this.finYearValue();
    if (fyId) {
      const fy = this.financialYears().find((y) => y.id === fyId);
      out.push({ key: '__fy', label: 'Financial Year', value: fy?.label ?? fy?.start_date.slice(0, 4) ?? fyId });
    }
    const dateFrom = this.dateFromValue();
    const dateTo = this.dateToValue();
    if (dateFrom || dateTo) out.push({ key: '__date', label: 'Date', value: `${dateFrom ?? '…'} to ${dateTo ?? '…'}` });
    return out;
  }

  protected removeChip(key: string): void {
    if (key === '__search') this.query.set('');
    else if (key === '__month') this.monthValue.set(null);
    else if (key === '__type') this.typeValue.set(null);
    else if (key === '__fy') this.finYearValue.set(null);
    else if (key === '__date') {
      this.dateFromValue.set(null);
      this.dateToValue.set(null);
    }
  }

  protected clearAll(): void {
    this.query.set('');
    this.monthValue.set(null);
    this.typeValue.set(null);
    this.finYearValue.set(null);
    this.dateFromValue.set(null);
    this.dateToValue.set(null);
  }

  protected filterSentence(): string {
    return this.chips()
      .map((c) => `${c.label} = ${c.value}`)
      .join(' and ');
  }

  protected recordNoun(): string {
    return this.config().recordNoun ?? 'event';
  }

  protected recordNounTitle(): string {
    const n = this.recordNoun();
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  /** Enough English for the nouns this shape actually names — see
   * ListScreenComponent.recordNounPlural for the same small rule. */
  protected recordNounPlural(): string {
    const n = this.recordNoun();
    if (/(s|x|z|ch|sh)$/i.test(n)) return `${n}es`;
    if (/[^aeiou]y$/i.test(n)) return `${n.slice(0, -1)}ies`;
    return `${n}s`;
  }

  // ---- per-row display ------------------------------------------------------

  protected dayOfMonth(row: T): string {
    const parsed = parseIsoDate(this.config().date(row));
    return parsed ? String(parsed.d) : '';
  }

  protected shortMonth(row: T): string {
    const parsed = parseIsoDate(this.config().date(row));
    return parsed ? MONTH_ABBR[parsed.m - 1] : '';
  }

  protected formattedDate(row: T): string {
    return formatDate(this.config().date(row));
  }

  /** The prototype's cal-day sub-line is the weekday name (data.js:114's `day:
   * 'Saturday'`, a field on the demo row). A real endpoint has no reason to
   * store a value derivable from its own date column, so this computes it —
   * `sub` stays available for a config that genuinely needs a different
   * subtitle (e.g. "Half day"). */
  protected subLabel(row: T): string {
    const cfg = this.config();
    if (cfg.sub) return cfg.sub(row) ?? '';
    const parsed = parseIsoDate(cfg.date(row));
    if (!parsed) return '';
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  }

  protected typeLabel(row: T): string | null {
    const cfg = this.config();
    const raw = cfg.type?.(row);
    if (raw === null || raw === undefined || raw === '') return null;
    return this.typeOptionsResolved().find((o) => o.value === raw)?.label ?? humanizeEnum(raw);
  }

  /** Explicit `badgeClass` on the matching typeOption wins — needed because
   * cell-format's own badgeClass() has no entry for 'optional' (it maps
   * 'mandatory' to b-danger per its ported BADGE_CLASS table, but leaves
   * 'optional' to fall through to the neutral default), where the prototype
   * colours Optional as the calmer b-outline (app-screens.js:459). A config
   * that wants that exact look sets it; one that doesn't gets the generic
   * fallback rather than nothing. */
  protected typeBadgeClass(row: T): string {
    const cfg = this.config();
    const raw = cfg.type?.(row);
    const explicit = this.typeOptionsResolved().find((o) => o.value === raw)?.badgeClass;
    return explicit ?? badgeClass(raw);
  }

  // ---- actions ----------------------------------------------------------

  /** `editable` is a belt-and-braces gate ON TOP of PolicyStore.can(), not a
   * replacement for it — matching the prototype's own two-part check
   * (app-screens.js:445: `s.editable && (role === 'superadmin' || …)`).
   * Masters → Holidays sets it (data.js:1526 `editable: 1`); Leave → Company
   * Holiday Calendar never does (data.js:1097 has no such flag at all), so
   * that mirror screen stays read-only for every role even if some future
   * RBAC grant gave it an 'edit' action by mistake. */
  protected canCreate(): boolean {
    const cfg = this.config();
    return !!cfg.editable && !!cfg.createRoute && this.policy.can(cfg.id, cfg.createScreenAction ?? 'edit');
  }

  protected visibleSecondaryActions(): readonly SecondaryActionDef[] {
    const cfg = this.config();
    if (!cfg.editable) return [];
    return (cfg.secondaryActions ?? []).filter((a) => this.policy.can(cfg.id, a.screenAction));
  }

  protected runSecondary(act: SecondaryActionDef): void {
    if (act.confirm && !window.confirm(act.confirm)) return;
    if (act.route) {
      this.router.navigate(act.route as any[]);
      return;
    }
    if (!act.endpoint) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}${act.endpoint}`, {}).subscribe({
      next: () => this.reload(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'That action failed.'),
    });
  }

  protected openCreate(): void {
    const route = this.config().createRoute;
    if (route) this.router.navigate(route as any[]);
  }

  /** `rowRoute` is honoured only when `editable` is set — same belt-and-braces
   * reasoning as `canCreate()`: a read-only mirror screen (Leave → Company
   * Holiday Calendar) never gets click-through, even if some future config
   * accidentally names a rowRoute on it. */
  protected canOpenRow(): boolean {
    const cfg = this.config();
    return !!cfg.editable && !!cfg.rowRoute;
  }

  protected openRow(row: T): void {
    const cfg = this.config();
    if (!this.canOpenRow() || !cfg.rowRoute) return;
    this.router.navigate(cfg.rowRoute(row) as any[]);
  }

  private reload(): void {
    const cfg = this.config();
    this.http.get<T[]>(`${environment.apiBaseUrl}${cfg.endpoint}`).subscribe({
      next: (rows) => this.allRows.set(Array.isArray(rows) ? rows : []),
      error: () => undefined,
    });
  }

  // RBAC 14 §2.2f — same blob-download mechanics as ListScreenComponent.exportAs
  // (list-screen.component.ts), duplicated rather than shared because no shape
  // shares a base class here (screen.types.ts's own repeated-but-consistent
  // style, not an oversight).
  protected exportAs(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    const clientOnlyActive = !!(
      this.query().trim() || this.monthValue() || this.typeValue() || this.finYearValue() || this.dateFromValue() || this.dateToValue()
    );
    if (clientOnlyActive) {
      const ok = window.confirm(
        'Month, Type, Financial Year, Date and Search are applied in the browser and cannot be sent to the server, ' +
          'so the exported file will contain more rows than the screen shows.\n\n' +
          'Export anyway?',
      );
      if (!ok) return;
    }
    this.exporting.set(format);
    this.actionError.set(null);

    const url = `${environment.apiBaseUrl}${this.config().endpoint}?format=${format}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `${this.config().title}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
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
