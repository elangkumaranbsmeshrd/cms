import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { ColumnDef, DateRangeValue, FilterDef, FilterOption, FilterValue, ListScreenConfig, NumberRangeValue, RowActionDef, SecondaryActionDef } from '../screen.types';
import { columnAlignClass } from '../column-policy';
import { EM_DASH, badgeClass, formatDate, formatMoney, humanizeEnum, initials, isBlank } from '../cell-format';
import { CUSTOM_PRESET, DatePreset, buildDatePresets } from '../date-presets';
import { RefDataService } from '../ref-data.service';
import { createListStore } from './create-list-store';

/** ARCH-3 §2's "most screens are a config object, not a component" — this
 * one component renders every 'list'-shape screen, and therefore also owns
 * the whole of RBAC §2.2's filter/chip/count/export convention so that every
 * list inherits it and none can drift from it.
 */
@Component({
  selector: 'app-list-screen',
  standalone: true,
  imports: [IconComponent],
  template: `
    <!-- embedded = this list is a TAB BODY inside a tabbed record screen, so
         the surrounding page head/title belongs to the host, not here. The
         action buttons still render — they act on this list. -->
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
      <!-- Primary first, matching the prototype's own action order
           (app-screens.js:19-23) — the create button is the reason most people
           opened the screen, so it leads. -->
      <div class="page-actions">
        @if (config().createRoute && policy.can(config().id, config().createScreenAction ?? 'edit')) {
          <button class="btn primary" type="button" (click)="openCreate()">
            <app-icon name="plus" [size]="14" />{{ config().createLabel ?? 'Add New' }}
          </button>
        }
        <!-- Export lives ONLY in the filter row below (§ "Export follows the
             filter" — the prototype has exactly one export pair and it sits
             next to the filters that shape it, never up here next to Create).
             A duplicate pair used to render here too; removed — see
             MASTERS-COMPLETION-PROMPT.md §1. -->
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

    <div class="filterbar">
      <div class="filter-row">
        <div class="searchbox">
          <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
          <input type="search" [placeholder]="searchPlaceholder()" [value]="store.query()" (input)="store.setQuery($any($event.target).value)" />
        </div>

        @for (f of visibleFilters(); track f.key) {
          @switch (f.kind) {
            @case ('multiselect') {
              <!-- §2.2c: "Multi-select, not single-select — 'show me Open and
                   In Progress' is a more common need than either one alone." -->
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
            @case ('numberrange') {
              <!-- Mirrors the 'daterange' case above structurally — two plain
                   bounds bound to one {min,max}-shaped filter value, instead
                   of a preset dropdown (no preset concept exists for a bare
                   number the way 'this_fy' does for a date). -->
              <input class="fsearch" type="number" inputmode="decimal" [placeholder]="f.label + ' Min'" [value]="numberMin(f)" (change)="setNumberRange(f, 'min', $any($event.target).value)" style="max-width: 110px;" />
              <input class="fsearch" type="number" inputmode="decimal" [placeholder]="f.label + ' Max'" [value]="numberMax(f)" (change)="setNumberRange(f, 'max', $any($event.target).value)" style="max-width: 110px;" />
            }
            @case ('text') {
              <!-- Committed on blur/Enter (change), not per-keystroke — same
                   convention 'numberrange' below already uses, so a filter
                   fetch doesn't fire on every character typed. -->
              <input class="fsearch" type="search" [placeholder]="f.label" [value]="asString(f)" (change)="store.setFilter(f.key, $any($event.target).value || null)" />
            }
            @case ('number') {
              <input class="fsearch" type="number" inputmode="numeric" [placeholder]="f.label" [value]="asString(f)" (change)="store.setFilter(f.key, $any($event.target).value || null)" style="max-width: 110px;" />
            }
            @case ('activeInactive') {
              <!-- Distinct from the shared "Show inactive" checkbox: that one
                   controls whether the SERVER sends inactive rows at all. This
                   is for endpoints with no include_inactive param, which return
                   both and must be narrowed here. Only one of the two ever
                   appears on a screen (includeInactiveParam is false wherever
                   this kind is used). -->
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="store.setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? 'All Statuses' }}</option>
                @for (opt of optionsFor(f); track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            }
            @case ('tristate') {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="store.setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? f.label + ' — Any' }}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            }
            @default {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="store.setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? 'All ' + f.label }}</option>
                @for (opt of optionsFor(f); track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            }
          }
        }

        @if (config().includeInactiveParam !== false) {
          <!-- Masters §3.0: retired entries "are hidden by default but never
               silently unreachable". -->
          <label class="fselect" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; background-image: none; padding-right: 9px;">
            <input type="checkbox" [checked]="store.includeInactive()" (change)="store.setIncludeInactive($any($event.target).checked)" />
            Show inactive
          </label>
        }

        @if (config().exportable) {
          <!-- The prototype puts a second, compact export pair inside the filter
               bar (app-core.js:216-219), right where the filters that shape the
               export are — "Export follows the filter" said in the layout. -->
          <div style="margin-left: auto; display: flex; gap: 6px;">
            <button class="btn sm" type="button" [disabled]="!!exporting()" (click)="exportAs('pdf')">
              <app-icon name="download" [size]="13" />PDF
            </button>
            <button class="btn sm" type="button" [disabled]="!!exporting()" (click)="exportAs('excel')">
              <app-icon name="download" [size]="13" />Excel
            </button>
          </div>
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
          <span class="clear" role="button" (click)="store.clearAll()">Clear all</span>
        }
        <span class="count">Showing {{ store.total() }} of {{ store.loadedTotal() }}</span>
      </div>
    </div>

    <div class="card">
      @if (store.isLoading()) {
        <div class="empty">
          <p>Loading…</p>
        </div>
      } @else if (store.error()) {
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this list</b></p>
          <p class="hint">{{ store.error() }}</p>
        </div>
      } @else if (store.total() === 0) {
        <!-- §2.2c: "Empty results say which filters caused it… A bare 'No
             records found' is not acceptable on a filtered screen." -->
        <div class="empty">
          <div class="ico">∅</div>
          @if (chips().length) {
            <p>No {{ config().recordNoun ?? 'records' }} match {{ filterSentence() }}.</p>
            <p class="hint"><span class="clear" role="button" (click)="store.clearAll()">Clear all filters</span></p>
          } @else {
            <p>{{ config().emptyText ?? 'No records found.' }}</p>
          }
        </div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                @for (col of visibleColumns(); track col.key) {
                  <th [class]="alignClass(col)">{{ col.header }}</th>
                }
                @if (config().rowActions) {
                  <th style="text-align: right;">Actions</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of store.rows(); track config().rowId(row)) {
                <tr [class.clickable]="hasRoute(row)" (click)="openRow(row)">
                  @for (col of visibleColumns(); track col.key) {
                    <td [class]="cellClass(col)">
                      @if (isMasked(col)) {
                        <span class="masked" [title]="col.maskNote ?? 'Hidden by a field-level permission'">
                          <app-icon name="lock" [size]="11" />hidden
                        </span>
                      } @else if (col.type === 'status') {
                        <span class="badge-s {{ badgeCls(col, rawValue(row, col)) }}">{{ display(row, col) }}</span>
                      } @else if (col.type === 'chip') {
                        @if (isCellBlank(row, col)) {
                          {{ EM_DASH }}
                        } @else {
                          <span class="badge-s b-neutral plain">{{ display(row, col) }}</span>
                        }
                      } @else if (col.type === 'avatar') {
                        @if (isCellBlank(row, col)) {
                          {{ EM_DASH }}
                        } @else {
                          <span style="display: inline-flex; align-items: center; gap: 7px;">
                            <span class="mini-av">{{ avatarInitials(row, col) }}</span>{{ display(row, col) }}
                          </span>
                        }
                      } @else {
                        {{ display(row, col) }}
                      }
                    </td>
                  }
                  @if (config().rowActions; as actions) {
                    <td (click)="$event.stopPropagation()" style="text-align: right; white-space: nowrap;">
                      @for (action of visibleActions(actions, row); track action.label) {
                        <button class="btn sm ghost" type="button" (click)="runAction(action, row)">{{ action.label }}</button>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span>{{ store.total() }} {{ store.total() === 1 ? recordNoun() : recordNounPlural() }}</span>
          <div class="pages">
            <button class="pg" [disabled]="store.page() <= 1" (click)="store.setPage(store.page() - 1)">‹</button>
            @for (p of pageNumbers(); track p) {
              <button class="pg" [class.on]="p === store.page()" (click)="store.setPage(p)">{{ p }}</button>
            }
            <button class="pg" [disabled]="store.page() >= store.pageCount()" (click)="store.setPage(store.page() + 1)">›</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class ListScreenComponent<T = any> {
  readonly config = input.required<ListScreenConfig<T>>();
  /** True when rendered as a tab body — suppresses this component's own page
   * title/description, which the tabbed host already shows. */
  readonly embedded = input(false);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  protected readonly policy = inject(PolicyStore);

  protected readonly CUSTOM = CUSTOM_PRESET;
  protected readonly EM_DASH = EM_DASH;

  // §2.2c: financial-year presets "read Masters → Financial Year (Section 3.1),
  // so they never hardcode a date". Only fetched for screens that actually
  // declare a daterange filter, and a failure degrades to the calendar presets
  // rather than breaking the screen.
  private readonly financialYears = signal<readonly any[]>([]);
  protected readonly presets = computed<readonly DatePreset[]>(() => buildDatePresets(this.financialYears() as any));

  protected readonly store = createListStore(computed(() => this.config()), this.presets);
  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly openPanel = signal<string | null>(null);

  constructor() {
    let fetched = false;
    // Only a screen that actually declares a date-range filter needs the FY
    // rows, and only once — a role without access to that endpoint just gets
    // the calendar presets rather than an error.
    effect(() => {
      if (fetched) return;
      if (!(this.config().filters ?? []).some((f) => f.kind === 'daterange')) return;
      fetched = true;
      this.http.get<any[]>(`${environment.apiBaseUrl}/masters/financial-years/options`).subscribe({
        next: (rows) => this.financialYears.set(rows ?? []),
        error: () => this.financialYears.set([]),
      });
    });
  }

  // ---- filters ----------------------------------------------------------

  /** §2.2b: "There is no such thing as a filter that exists for one role and
   * not another on the same screen" — the only two exclusions are the spec's
   * own: the dimension is meaningless at this scope, or the underlying field is
   * invisible to this role. §2.2e adds Super Admin's own extra filters. */
  protected visibleFilters(): FilterDef<T>[] {
    // The backend's role codes are SCREAMING_SNAKE (seed.py:25 — 'SUPER_ADMIN',
    // 'MANAGER', 'ACCOUNTANT', 'HR', 'EMPLOYEE'), so compare case-insensitively
    // rather than against a guessed spelling: a mismatch here silently hides
    // Super Admin's own filters from Super Admin.
    const role = (this.session.role() ?? '').toUpperCase();
    const id = this.config().id;
    return (this.config().filters ?? []).filter((f) => {
      if (f.superAdminOnly && role !== 'SUPER_ADMIN') return false;
      if (f.hideForRoles?.length && role && f.hideForRoles.some((r) => r.toUpperCase() === role)) return false;
      if (f.hideWhenFieldHidden && this.policy.fieldMode(id, f.hideWhenFieldHidden) === 'hide') return false;
      if (f.hideWhenScopeIsOwn && this.policy.screen(id)?.mode === 'own') return false;
      return true;
    });
  }

  protected optionsFor(f: FilterDef<T>): readonly FilterOption[] {
    if (f.options) return f.options;
    if (f.optionsFromRows) return f.optionsFromRows(this.store.allRows(), this.refData);
    if (f.optionsRef) {
      return (this.refData.options(f.optionsRef) ?? []).map((o) => ({ value: o.id, label: o.label }));
    }
    return [];
  }

  protected asString(f: FilterDef<T>): string {
    const v = this.store.filterValues()[f.key];
    return v === null || v === undefined ? '' : String(v);
  }

  protected isChecked(f: FilterDef<T>, value: string): boolean {
    const v = this.store.filterValues()[f.key];
    return Array.isArray(v) && v.includes(value);
  }

  protected toggleMulti(f: FilterDef<T>, value: string): void {
    const current = this.store.filterValues()[f.key];
    const list = Array.isArray(current) ? [...current] : [];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    this.store.setFilter(f.key, list);
  }

  protected multiLabel(f: FilterDef<T>): string {
    const v = this.store.filterValues()[f.key];
    const list = Array.isArray(v) ? v : [];
    if (!list.length) return f.allLabel ?? `All ${f.label}`;
    const opts = this.optionsFor(f);
    if (list.length === 1) return opts.find((o) => o.value === list[0])?.label ?? String(list[0]);
    return `${f.label}: ${list.length} selected`;
  }

  protected toggleOpenPanel(key: string): void {
    this.openPanel.update((k) => (k === key ? null : key));
  }

  protected datePreset(f: FilterDef<T>): string {
    const v = this.store.filterValues()[f.key] as DateRangeValue | null;
    return v?.preset ?? '';
  }

  protected dateFrom(f: FilterDef<T>): string {
    return (this.store.filterValues()[f.key] as DateRangeValue | null)?.from ?? '';
  }

  protected dateTo(f: FilterDef<T>): string {
    return (this.store.filterValues()[f.key] as DateRangeValue | null)?.to ?? '';
  }

  protected setPreset(f: FilterDef<T>, preset: string): void {
    this.store.setFilter(f.key, preset ? { preset, from: null, to: null } : null);
  }

  protected setCustomDate(f: FilterDef<T>, which: 'from' | 'to', value: string): void {
    const cur = (this.store.filterValues()[f.key] as DateRangeValue | null) ?? { preset: CUSTOM_PRESET, from: null, to: null };
    this.store.setFilter(f.key, { ...cur, preset: CUSTOM_PRESET, [which]: value || null } as DateRangeValue);
  }

  protected numberMin(f: FilterDef<T>): string {
    const v = (this.store.filterValues()[f.key] as NumberRangeValue | null)?.min;
    return v === null || v === undefined ? '' : String(v);
  }

  protected numberMax(f: FilterDef<T>): string {
    const v = (this.store.filterValues()[f.key] as NumberRangeValue | null)?.max;
    return v === null || v === undefined ? '' : String(v);
  }

  protected setNumberRange(f: FilterDef<T>, which: 'min' | 'max', value: string): void {
    const cur = (this.store.filterValues()[f.key] as NumberRangeValue | null) ?? { min: null, max: null };
    const num = value === '' ? null : Number(value);
    this.store.setFilter(f.key, { ...cur, [which]: num === null || Number.isNaN(num) ? null : num } as NumberRangeValue);
  }

  // ---- chips ------------------------------------------------------------

  protected chips(): { key: string; label: string; value: string }[] {
    const out: { key: string; label: string; value: string }[] = [];
    const q = this.store.query().trim();
    if (q) out.push({ key: '__search', label: 'Search', value: q });

    for (const f of this.store.activeFilters()) {
      const v = this.store.filterValues()[f.key];
      out.push({ key: f.key, label: f.label, value: f.formatChip ? f.formatChip(v) : this.chipValue(f, v) });
    }
    if (this.store.includeInactive()) out.push({ key: '__inactive', label: 'Status', value: 'Including inactive' });
    return out;
  }

  private chipValue(f: FilterDef<T>, v: FilterValue): string {
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
    if (f.kind === 'numberrange') {
      const r = v as NumberRangeValue;
      if (r?.min !== null && r?.min !== undefined && r?.max !== null && r?.max !== undefined) return `${r.min} – ${r.max}`;
      if (r?.min !== null && r?.min !== undefined) return `≥ ${r.min}`;
      if (r?.max !== null && r?.max !== undefined) return `≤ ${r.max}`;
      return '';
    }
    if (f.kind === 'tristate') return String(v) === 'yes' ? 'Yes' : 'No';
    return this.optionsFor(f).find((o) => o.value === String(v))?.label ?? String(v);
  }

  protected removeChip(key: string): void {
    if (key === '__search') this.store.setQuery('');
    else if (key === '__inactive') this.store.setIncludeInactive(false);
    else this.store.clearFilter(key);
  }

  /** The sentence in the empty state, e.g. "Status = Closed and Period = This
   * Month" — §2.2c wants the user told which filters emptied the list. */
  protected filterSentence(): string {
    return this.chips().map((c) => `${c.label} = ${c.value}`).join(' and ');
  }

  protected recordNoun(): string {
    return this.config().recordNoun ?? 'record';
  }

  /** Enough English to cover the nouns this module actually uses — without it
   * the pager read "service categorys", "customer statuss", "work week policys". */
  protected recordNounPlural(): string {
    const n = this.recordNoun();
    if (/(s|x|z|ch|sh)$/i.test(n)) return `${n}es`;
    if (/[^aeiou]y$/i.test(n)) return `${n.slice(0, -1)}ies`;
    return `${n}s`;
  }

  /** Names the searched fields using their COLUMN HEADERS, not the raw backend
   * keys — otherwise the most prominent control on the screen reads
   * "Search tax_name or short_code…". */
  protected searchPlaceholder(): string {
    const fields = this.config().searchFields;
    if (!fields?.length) return 'Search…';
    if (fields.length > 2) return `Search ${this.recordNounPlural()}…`;
    const cols = this.config().columns;
    const labels = fields.map((k) => cols.find((c) => c.key === k)?.header ?? humanizeEnum(k));
    return `Search ${labels.join(' or ')}…`;
  }

  // ---- cells ------------------------------------------------------------

  protected alignClass(col: ColumnDef<T>): string {
    return columnAlignClass(col) || '';
  }

  protected cellClass(col: ColumnDef<T>): string {
    return [this.alignClass(col), col.cellClass ?? '', col.type === 'code' || col.type === 'date' ? 'mono' : '']
      .filter(Boolean)
      .join(' ');
  }

  /** RBAC Layer 1/3: same "the field's visibility decides" rule
   * visibleFilters() already applies to filters, now for columns — a
   * sensitiveField in 'hide' mode drops the whole column, header included. */
  protected visibleColumns(): ColumnDef<T>[] {
    const id = this.config().id;
    return this.config().columns.filter((c) => !c.sensitiveField || this.policy.fieldMode(id, c.sensitiveField) !== 'hide');
  }

  protected isMasked(col: ColumnDef<T>): boolean {
    return !!col.sensitiveField && this.policy.fieldMode(this.config().id, col.sensitiveField) === 'mask';
  }

  protected rawValue(row: T, col: ColumnDef<T>): unknown {
    return col.compute ? col.compute(row) : (row as any)[col.key];
  }

  protected isCellBlank(row: T, col: ColumnDef<T>): boolean {
    return isBlank(this.rawValue(row, col));
  }

  protected avatarInitials(row: T, col: ColumnDef<T>): string {
    // The resolved DISPLAY value, not the raw id — for a ref column (e.g.
    // Employee), initials of a UUID would be meaningless.
    return initials(String(this.display(row, col) ?? ''));
  }

  /** The prototype's U.cell() contract: blanks become an em-dash, dates and
   * money are formatted, FK ids resolve through a Masters lookup, and a raw
   * enum member becomes a readable label instead of SCREAMING_SNAKE. */
  protected display(row: T, col: ColumnDef<T>): unknown {
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

  // Prefers a per-option override (ColumnDef.staticOptions[].badgeClass, e.g.
  // Module 15's Open/Due Soon/Overdue/Part-Remitted/Remitted vocabulary,
  // whose colours the shared BADGE_CLASS dictionary either gets wrong for
  // this module or doesn't carry at all) over the shared cell-format.ts
  // lookup — falls back to that shared function whenever no override is
  // declared, so every other screen's badge colour is unchanged.
  protected badgeCls(col: ColumnDef<T>, value: unknown): string {
    const override = col.staticOptions?.find((o) => o.value === String(value))?.badgeClass;
    return override ?? badgeClass(value);
  }

  // ---- paging -----------------------------------------------------------

  /** A windowed numeric pager like the prototype's, rather than a bare
   * "1 / 1" — capped so a 40-page list doesn't render 40 buttons. */
  protected pageNumbers(): number[] {
    const count = this.store.pageCount();
    const current = this.store.page();
    const span = 5;
    let start = Math.max(1, current - Math.floor(span / 2));
    const end = Math.min(count, start + span - 1);
    start = Math.max(1, end - span + 1);
    const out: number[] = [];
    for (let p = start; p <= end; p++) out.push(p);
    return out;
  }

  // ---- actions ----------------------------------------------------------

  protected secondaryActions(): readonly SecondaryActionDef<T>[] {
    return (this.config().secondaryActions ?? []).filter((a) => this.policy.can(this.config().id, a.screenAction));
  }

  protected runSecondary(act: SecondaryActionDef<T>): void {
    if (act.confirm && !window.confirm(act.confirm)) return;
    if (act.route) {
      this.router.navigate(act.route as any[]);
      return;
    }
    if (!act.endpoint) return;
    const body = act.endpointBody ? act.endpointBody(this.store.rows()) : {};
    if (body === null) {
      this.actionError.set('Nothing currently on screen qualifies for this action.');
      return;
    }
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}${act.endpoint}`, body).subscribe({
      next: () => this.store.reload(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'That action failed.'),
    });
  }

  // Per-row, not just per-config: a route function may itself decline to
  // route a SPECIFIC row (returns null/undefined) — see screen.types.ts's
  // own ListScreenConfig.rowRoute doc for why (e.g. Obligations-By-Document).
  protected hasRoute(row: T): boolean {
    const routeFn = this.config().rowRoute;
    return !!routeFn && !!routeFn(row);
  }

  protected openRow(row: T): void {
    const routeFn = this.config().rowRoute;
    const cmds = routeFn?.(row);
    if (cmds) this.router.navigate(cmds as any[]);
  }

  protected openCreate(): void {
    const routeArr = this.config().createRoute;
    if (routeArr) this.router.navigate(routeArr as any[]);
  }

  protected navigateTo(route: readonly unknown[]): void {
    this.router.navigate(route as any[]);
  }

  protected visibleActions(actions: readonly RowActionDef<T>[], row: T): RowActionDef<T>[] {
    return actions.filter((a) => this.policy.can(this.config().id, a.screenAction) && (a.visible?.(row) ?? true));
  }

  protected runAction(action: RowActionDef<T>, row: T): void {
    if (action.confirm && !window.confirm(action.confirm)) return;
    this.actionError.set(null);
    const url = `${environment.apiBaseUrl}${action.endpoint(row)}`;
    const req$ = action.method === 'DELETE' ? this.http.delete(url) : this.http.post(url, action.body?.(row) ?? {});
    req$.subscribe({
      next: (res) => {
        const next = action.onSuccess?.(res);
        if (next) this.router.navigate(next as any[]);
        else this.store.reload();
      },
      error: (err) => this.actionError.set(err?.error?.detail ?? 'That action failed.'),
    });
  }

  // RBAC 14 §2.2f. Auth is Bearer-header-only (auth.interceptor.ts) — a plain
  // <a href> or window.open() would hit the API unauthenticated, so this goes
  // through HttpClient as a blob and is saved via a synthetic click.
  //
  // The export carries the SAME server params the list fetch used, so the PDF's
  // own "Filters:" header block (list_export.py) states something true. Where a
  // filter is client-only the server cannot honour it, and rather than silently
  // exporting a wider set we say so first.
  protected exportAs(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    if (this.store.clientOnlyActive()) {
      const ok = window.confirm(
        'Some active filters are applied in the browser and cannot be sent to the server, ' +
          'so the exported file will contain more rows than the screen shows.\n\n' +
          'Export anyway?',
      );
      if (!ok) return;
    }
    this.exporting.set(format);
    this.actionError.set(null);

    const params = this.store.serverParams();
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const item of v) search.append(k, item);
      else search.set(k, v);
    }
    search.set('format', format);

    const base = `${environment.apiBaseUrl}${this.config().endpoint}`;
    const url = `${base}${base.includes('?') ? '&' : '?'}${search.toString()}`;
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

  // With responseType: 'blob', HttpClient blob-wraps error bodies too — a
  // failed export's JSON {detail: "..."} arrives as err.error being a Blob,
  // not the parsed object err?.error?.detail reads elsewhere in this file.
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
