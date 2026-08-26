import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { badgeClass, formatMoney } from '../cell-format';
import { CUSTOM_PRESET, DatePreset, buildDatePresets, resolveRange, withinRange } from '../date-presets';
import { RefDataService } from '../ref-data.service';
import { BoardColumnDef, BoardScreenConfig, DateRangeValue, FilterDef, FilterOption, FilterValue, NumberRangeValue } from '../screen.types';

/** The kanban/board shape — the prototype's R.board (app-screens.js:339, Task
 * Board & Bugs) and R.pipeline's stage-summary view (app-screens2.js:820,
 * Opportunity Pipeline), collapsed into one config-driven component: columns
 * keyed by a status-like field, a card per row, an optional per-column ₹/
 * metric total, drag-and-drop with a `<select>` fallback per card (MASTER-
 * BUILD §8.2 A14 — drag is never the only path to a stage change).
 *
 * No project/opportunity identity card is rendered here on purpose — that's
 * the host TabbedScreenConfig's `.rec-head` (R.board's own `proj` block,
 * app-screens.js:353-363, is literally the Project record's header). This
 * component owns only what list-screen.component.ts owns for a list: the
 * page head, the filter bar, and the data — which is exactly what lets it
 * be hosted embedded inside a tab later, same as ListScreenComponent already
 * is.
 *
 * The filter bar (search/filters/chips) is deliberately a close copy of
 * ListScreenComponent's own — RBAC 14 §2.2 is "enforced in one place" in
 * spirit (one shared FilterDef<T> contract, cell-format.ts, date-presets.ts),
 * but there is no shared *component* base between the shapes (screen.types.ts
 * itself has no shared base interface either), so each shape's component
 * re-implements the filter chrome against its own data shape rather than
 * forcing an artificial abstraction across two very different bodies (a
 * paged table vs. a column grid).
 */
@Component({
  selector: 'app-board-screen',
  standalone: true,
  imports: [IconComponent],
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
        @if (config().createRoute && policy.can(config().id, config().createScreenAction ?? 'edit')) {
          <button class="btn primary" type="button" (click)="openCreate()">
            <app-icon name="plus" [size]="14" />{{ config().createLabel ?? 'Add New' }}
          </button>
        }
        @if (config().exportable) {
          <!-- app-screens.js:345's own Export PDF toast, verbatim, as the
               button's title — a board's export is the flat list it is
               built from, not a rendering of the columns themselves. -->
          <button
            class="btn"
            type="button"
            [disabled]="!!exporting()"
            title="A board does not export as a board — it exports as the flat list it is built from, one row per card with its column as the Status value."
            (click)="exportAs('pdf')"
          >
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

    <div class="filterbar">
      <div class="filter-row">
        <div class="searchbox">
          <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
          <input type="search" [placeholder]="searchPlaceholder()" [value]="query()" (input)="setQuery($any($event.target).value)" />
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
            @case ('tristate') {
              <select class="fselect" [title]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)">
                <option value="">{{ f.allLabel ?? f.label + ' — Any' }}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            }
            @case ('numberrange') {
              <!-- Mirrors list-screen.component.ts's own 'numberrange' case
                   — was missing here entirely (this board component
                   re-implements the filter chrome rather than sharing a
                   template, per this file's own header comment), a real gap
                   only exposed once a board config actually declared a
                   numberrange filter (Opportunity's Value/Probability). -->
              <input class="fsearch" type="number" inputmode="decimal" [placeholder]="f.label + ' Min'" [value]="numberMin(f)" (change)="setNumberRange(f, 'min', $any($event.target).value)" style="max-width: 110px;" />
              <input class="fsearch" type="number" inputmode="decimal" [placeholder]="f.label + ' Max'" [value]="numberMax(f)" (change)="setNumberRange(f, 'max', $any($event.target).value)" style="max-width: 110px;" />
            }
            @case ('text') {
              <input class="fsearch" type="search" [placeholder]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)" />
            }
            @case ('number') {
              <input class="fsearch" type="number" inputmode="numeric" [placeholder]="f.label" [value]="asString(f)" (change)="setFilter(f.key, $any($event.target).value || null)" style="max-width: 110px;" />
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
        <span class="count">Showing {{ total() }} of {{ loadedTotal() }}</span>
      </div>
    </div>

    @if (isLoading()) {
      <div class="card">
        <div class="empty">
          <p>Loading…</p>
        </div>
      </div>
    } @else if (error()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this board</b></p>
          <p class="hint">{{ error() }}</p>
        </div>
      </div>
    } @else {
      <!-- One row per column, sized off the config's own column count rather
           than the prototype's fixed .c4 (bugs) / .c5 (tasks/stages) — this
           component serves boards of any width. -->
      <div class="board" [style.grid-template-columns]="boardGridTemplate()">
        @for (col of config().columns; track col.value) {
          <div
            class="bcol"
            [class.drag-over]="dragOverColumn() === col.value"
            (dragover)="onDragOver($event)"
            (dragenter)="onDragEnter(col.value)"
            (dragleave)="onDragLeave(col.value)"
            (drop)="onDrop($event, col.value)"
          >
            <div class="bcol-head">
              <span class="nm">{{ col.label }}</span>
              <span class="cnt" style="margin-left: auto;">{{ columnRows(col).length }}</span>
            </div>
            @if (columnMetric(col); as metric) {
              <div class="bcol-metric">{{ metric }}</div>
            }
            <div class="bcol-body">
              @if (columnRows(col).length) {
                @for (row of columnRows(col); track config().rowId(row)) {
                  <div
                    class="tcard"
                    [attr.draggable]="canChangeStage() ? 'true' : null"
                    [class.dragging]="draggingId() === config().rowId(row)"
                    (dragstart)="onDragStart($event, row)"
                    (dragend)="onDragEnd()"
                    (click)="openRow(row)"
                  >
                    @if (cardCode(row); as code) {
                      <div class="tid">{{ code }}</div>
                    }
                    <div class="tt">{{ cardTitle(row) }}</div>
                    @if (cardSubtitle(row); as sub) {
                      <div style="font-size: 11px; color: var(--text-tertiary); margin: -4px 0 6px;">{{ sub }}</div>
                    }
                    @if (cardMeta(row); as meta) {
                      <div style="display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--accent); margin: 2px 0;">
                        {{ meta }}
                      </div>
                    }
                    @if (cardMoney(row); as money) {
                      <div style="font-size: 13px; font-weight: 650; font-family: 'IBM Plex Mono', monospace; margin: 2px 0 6px;">{{ money }}</div>
                    }
                    <div class="tm">
                      @if (cardBadge(row); as badge) {
                        <span class="badge-s {{ badgeCls(badge) }}">{{ badge }}</span>
                      }
                      @if (cardAvatar(row); as av) {
                        <span class="mini-av" [title]="av">{{ av }}</span>
                      }
                      @if (cardDue(row); as due) {
                        <span class="due" [class.over]="cardDueOverdue(row)">{{ due }}</span>
                      }
                    </div>
                    <!-- The accessible/keyboard-operable equivalent of the drag —
                         MASTER-BUILD §8.2 A14 requires both, drag is never the
                         only path. -->
                    <select
                      class="stage-select"
                      [attr.aria-label]="'Move ' + cardTitle(row) + ' to a different ' + (config().recordNoun ? 'stage' : 'column')"
                      [value]="currentColumnValue(row)"
                      [disabled]="!canChangeStage() || pendingId() === config().rowId(row)"
                      (click)="$event.stopPropagation()"
                      (change)="onSelectChange(row, $any($event.target).value)"
                    >
                      @for (opt of config().columns; track opt.value) {
                        <option [value]="opt.value">{{ opt.label }}</option>
                      }
                    </select>
                  </div>
                }
              } @else {
                <div style="padding: 14px 6px; text-align: center; font-size: 11.5px; color: var(--text-tertiary);">
                  No {{ recordNounPlural() }} here.
                </div>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class BoardScreenComponent<T = any> {
  readonly config = input.required<BoardScreenConfig<T>>();
  /** True when hosted as a tab body — suppresses this component's own page
   * title, exactly like ListScreenComponent's `embedded` (list-screen.
   * component.ts:267): a Project's Tasks/Bugs tabs are this board, embedded. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly refData = inject(RefDataService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly policy = inject(PolicyStore);

  protected readonly CUSTOM = CUSTOM_PRESET;

  private readonly allRows = signal<T[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly filterValues = signal<Record<string, FilterValue>>({});
  protected readonly openPanel = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);

  // Drag-and-drop state. `pendingId` also disables the <select> fallback for
  // the same row while its stage-change request is in flight, so drag and
  // dropdown can't race each other on the same card.
  protected readonly draggingId = signal<string | null>(null);
  protected readonly dragOverColumn = signal<string | null>(null);
  protected readonly pendingId = signal<string | null>(null);

  // Same "only fetch FY rows if a daterange filter is actually declared"
  // trade as ListScreenComponent (list-screen.component.ts:290-301).
  private readonly financialYears = signal<readonly any[]>([]);
  protected readonly presets = computed<readonly DatePreset[]>(() => buildDatePresets(this.financialYears() as any));

  constructor() {
    // Re-seed filters/search/drag-state whenever the screen (config) changes.
    effect(() => {
      const cfg = this.config();
      this.filterValues.set(this.defaultsFor(cfg));
      this.query.set('');
      this.openPanel.set(null);
      this.draggingId.set(null);
      this.dragOverColumn.set(null);
      this.pendingId.set(null);
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

    // Refetches whenever the screen or any server-transport filter changes —
    // same split as createListStore (create-list-store.ts:146-151).
    effect(() => {
      const cfg = this.config();
      const params = this.toHttpParams(this.serverParams());
      this.loadRows(cfg, params);
    });
  }

  // ---- data ---------------------------------------------------------------

  private loadRows(cfg: BoardScreenConfig<T>, params: HttpParams): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.http
      .get<T[]>(`${environment.apiBaseUrl}${cfg.endpoint}`, { params })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.allRows.set(Array.isArray(data) ? data : []);
          this.isLoading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.detail ?? 'Failed to load data.');
          this.isLoading.set(false);
        },
      });
  }

  private reload(): void {
    this.loadRows(this.config(), this.toHttpParams(this.serverParams()));
  }

  /** The query params that reach the API — shared by the board fetch and the
   * export, same reasoning as create-list-store.ts:86-88. */
  protected readonly serverParams = computed<Record<string, string | string[]>>(() => {
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
      } else if (f.kind === 'numberrange') {
        const { min, max } = v as NumberRangeValue;
        if (min !== null && min !== undefined) out[`${param}_min`] = String(min);
        if (max !== null && max !== undefined) out[`${param}_max`] = String(max);
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

  // Board data is small enough to fetch whole (same working set the
  // prototype's D.tasks/D.bugs/D.opportunities are), so unlike list-screen's
  // search there is no server `?search=` param on BoardScreenConfig at all —
  // search always runs client-side over the already-fetched rows.
  protected readonly filtered = computed(() => {
    const cfg = this.config();
    const values = this.filterValues();
    let rows = this.allRows();

    for (const f of cfg.filters ?? []) {
      if (f.transport !== 'client') continue;
      const v = values[f.key];
      if (!this.isEngaged(f, v)) continue;
      if (f.kind === 'daterange') {
        const { from, to } = resolveRange(v as DateRangeValue, this.presets());
        if (!from && !to) continue;
        const field = f.param ?? f.key;
        rows = rows.filter((row) => (f.predicate ? f.predicate(row, v) : withinRange((row as Record<string, unknown>)[field], from, to)));
        continue;
      }
      if (!f.predicate) continue;
      rows = rows.filter((row) => f.predicate!(row, v));
    }

    const q = this.query().trim().toLowerCase();
    if (q) {
      const fields = cfg.searchFields;
      rows = rows.filter((row) => {
        if (fields?.length) return fields.some((k) => String((row as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q));
        return JSON.stringify(row).toLowerCase().includes(q);
      });
    }
    return rows;
  });

  protected readonly total = computed(() => this.filtered().length);
  protected readonly loadedTotal = computed(() => this.allRows().length);

  protected readonly clientOnlyActive = computed(() => {
    const cfg = this.config();
    const values = this.filterValues();
    if (this.query().trim()) return true;
    return (cfg.filters ?? []).some((f) => f.transport === 'client' && this.isEngaged(f, values[f.key]));
  });

  private isEngaged(filter: FilterDef<T>, v: FilterValue): boolean {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (filter.kind === 'daterange') {
      const d = v as DateRangeValue;
      return !!(d?.preset || d?.from || d?.to);
    }
    if (filter.kind === 'numberrange') {
      const r = v as NumberRangeValue;
      return (r?.min !== null && r?.min !== undefined) || (r?.max !== null && r?.max !== undefined);
    }
    return true;
  }

  private defaultsFor(cfg: BoardScreenConfig<T>): Record<string, FilterValue> {
    const out: Record<string, FilterValue> = {};
    for (const f of cfg.filters ?? []) out[f.key] = f.defaultValue ?? (f.kind === 'multiselect' ? [] : null);
    return out;
  }

  // ---- columns / cards ------------------------------------------------------

  /** Grid width sized off the config's own column count — general enough for
   * Bugs' 4, Task Board's 5 or Pipeline's 5, or any other count a later
   * consumer declares (prototype app.css:667-668 hardcodes .c4/.c5 instead). */
  protected boardGridTemplate(): string {
    const n = this.config().columns.length || 1;
    return `repeat(${n}, minmax(200px, 1fr))`;
  }

  protected columnRows(col: BoardColumnDef): T[] {
    const cfg = this.config();
    return this.filtered().filter((row) => String((row as Record<string, unknown>)[cfg.statusField] ?? '') === col.value);
  }

  protected columnMetric(col: BoardColumnDef): string | null {
    if (!col.metricField) return null;
    const rows = this.columnRows(col);
    const sum = rows.reduce((acc, row) => acc + (Number((row as Record<string, unknown>)[col.metricField!]) || 0), 0);
    return formatMoney(sum);
  }

  protected currentColumnValue(row: T): string {
    return String((row as Record<string, unknown>)[this.config().statusField] ?? '');
  }

  protected cardCode(row: T): string | null {
    return this.config().card.code?.(row) ?? null;
  }

  protected cardTitle(row: T): string {
    return this.config().card.title(row);
  }

  protected cardSubtitle(row: T): string | null {
    return this.config().card.subtitle?.(row) ?? null;
  }

  protected cardBadge(row: T): string | null {
    return this.config().card.badge?.(row) ?? null;
  }

  protected cardMoney(row: T): string | null {
    return this.config().card.money?.(row) ?? null;
  }

  protected cardMeta(row: T): string | null {
    return this.config().card.meta?.(row) || null;
  }

  protected cardAvatar(row: T): string | null {
    return this.config().card.avatar?.(row) || null;
  }

  protected cardDue(row: T): string | null {
    return this.config().card.due?.(row) || null;
  }

  protected cardDueOverdue(row: T): boolean {
    return this.config().card.dueOverdue?.(row) ?? false;
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected recordNoun(): string {
    return this.config().recordNoun ?? 'card';
  }

  protected recordNounPlural(): string {
    const n = this.recordNoun();
    if (/(s|x|z|ch|sh)$/i.test(n)) return `${n}es`;
    if (/[^aeiou]y$/i.test(n)) return `${n.slice(0, -1)}ies`;
    return `${n}s`;
  }

  // ---- stage change (drag-drop + <select> fallback) ------------------------

  protected canChangeStage(): boolean {
    return this.policy.can(this.config().id, this.config().stageChangeScreenAction ?? 'edit');
  }

  protected onDragStart(event: DragEvent, row: T): void {
    if (!this.canChangeStage()) {
      event.preventDefault();
      return;
    }
    const id = this.config().rowId(row);
    this.draggingId.set(id);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onDragEnd(): void {
    this.draggingId.set(null);
    this.dragOverColumn.set(null);
  }

  protected onDragOver(event: DragEvent): void {
    // Required so the browser fires `drop` at all — without preventDefault()
    // here every dragover keeps the "not allowed" cursor.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  protected onDragEnter(value: string): void {
    this.dragOverColumn.set(value);
  }

  protected onDragLeave(value: string): void {
    if (this.dragOverColumn() === value) this.dragOverColumn.set(null);
  }

  protected onDrop(event: DragEvent, value: string): void {
    event.preventDefault();
    this.dragOverColumn.set(null);
    const id = this.draggingId();
    this.draggingId.set(null);
    if (!id) return;
    const row = this.filtered().find((r) => this.config().rowId(r) === id);
    if (row) this.changeStage(row, value);
  }

  protected onSelectChange(row: T, value: string): void {
    this.changeStage(row, value);
  }

  private changeStage(row: T, newValue: string): void {
    const cfg = this.config();
    if (!this.canChangeStage()) return;
    if (this.currentColumnValue(row) === newValue) return;

    const id = cfg.rowId(row);
    this.pendingId.set(id);
    this.actionError.set(null);

    const url = `${environment.apiBaseUrl}${cfg.stageChangeEndpoint(row, newValue)}`;
    const body = cfg.stageChangeBody ? cfg.stageChangeBody(row, newValue) : { [cfg.statusField]: newValue };
    const method = cfg.stageChangeMethod ?? 'PUT';
    const req$ = method === 'POST' ? this.http.post(url, body) : method === 'PATCH' ? this.http.patch(url, body) : this.http.put(url, body);

    req$.subscribe({
      next: () => {
        this.pendingId.set(null);
        this.reload();
      },
      error: (err) => {
        this.pendingId.set(null);
        this.actionError.set(err?.error?.detail ?? 'That status change failed.');
      },
    });
  }

  // ---- filters (close copy of ListScreenComponent's — see class doc) -------

  protected visibleFilters(): FilterDef<T>[] {
    const role = (this.session.role() ?? '').toUpperCase();
    const id = this.config().id;
    return (this.config().filters ?? []).filter((f) => {
      if (f.superAdminOnly && role !== 'SUPER_ADMIN') return false;
      if (f.hideForRoles?.length && role && f.hideForRoles.some((r) => r.toUpperCase() === role)) return false;
      if (f.hideWhenFieldHidden && this.policy.fieldMode(id, f.hideWhenFieldHidden) === 'hide') return false;
      return true;
    });
  }

  protected optionsFor(f: FilterDef<T>): readonly FilterOption[] {
    if (f.options) return f.options;
    if (f.optionsFromRows) return f.optionsFromRows(this.allRows(), this.refData);
    if (f.optionsRef) return (this.refData.options(f.optionsRef) ?? []).map((o) => ({ value: o.id, label: o.label }));
    return [];
  }

  protected asString(f: FilterDef<T>): string {
    const v = this.filterValues()[f.key];
    return v === null || v === undefined ? '' : String(v);
  }

  protected numberMin(f: FilterDef<T>): string {
    const v = (this.filterValues()[f.key] as NumberRangeValue | null)?.min;
    return v === null || v === undefined ? '' : String(v);
  }

  protected numberMax(f: FilterDef<T>): string {
    const v = (this.filterValues()[f.key] as NumberRangeValue | null)?.max;
    return v === null || v === undefined ? '' : String(v);
  }

  protected setNumberRange(f: FilterDef<T>, which: 'min' | 'max', value: string): void {
    const cur = (this.filterValues()[f.key] as NumberRangeValue | null) ?? { min: null, max: null };
    const num = value === '' ? null : Number(value);
    this.setFilter(f.key, { ...cur, [which]: num === null || Number.isNaN(num) ? null : num } as NumberRangeValue);
  }

  protected isChecked(f: FilterDef<T>, value: string): boolean {
    const v = this.filterValues()[f.key];
    return Array.isArray(v) && v.includes(value);
  }

  protected toggleMulti(f: FilterDef<T>, value: string): void {
    const current = this.filterValues()[f.key];
    const list = Array.isArray(current) ? [...current] : [];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    this.setFilter(f.key, list);
  }

  protected multiLabel(f: FilterDef<T>): string {
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

  protected datePreset(f: FilterDef<T>): string {
    const v = this.filterValues()[f.key] as DateRangeValue | null;
    return v?.preset ?? '';
  }

  protected dateFrom(f: FilterDef<T>): string {
    return (this.filterValues()[f.key] as DateRangeValue | null)?.from ?? '';
  }

  protected dateTo(f: FilterDef<T>): string {
    return (this.filterValues()[f.key] as DateRangeValue | null)?.to ?? '';
  }

  protected setPreset(f: FilterDef<T>, preset: string): void {
    this.setFilter(f.key, preset ? { preset, from: null, to: null } : null);
  }

  protected setCustomDate(f: FilterDef<T>, which: 'from' | 'to', value: string): void {
    const cur = (this.filterValues()[f.key] as DateRangeValue | null) ?? { preset: CUSTOM_PRESET, from: null, to: null };
    this.setFilter(f.key, { ...cur, preset: CUSTOM_PRESET, [which]: value || null } as DateRangeValue);
  }

  protected setQuery(q: string): void {
    this.query.set(q);
  }

  protected setFilter(key: string, value: FilterValue): void {
    this.filterValues.update((v) => ({ ...v, [key]: value }));
  }

  protected clearFilter(key: string): void {
    const def = (this.config().filters ?? []).find((f) => f.key === key);
    this.filterValues.update((v) => ({ ...v, [key]: def?.kind === 'multiselect' ? [] : null }));
  }

  protected clearAll(): void {
    this.filterValues.set(this.defaultsFor(this.config()));
    this.query.set('');
  }

  // ---- chips ----------------------------------------------------------------

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

  private chipValue(f: FilterDef<T>, v: FilterValue): string {
    if (Array.isArray(v)) {
      const opts = this.optionsFor(f);
      return v.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(', ');
    }
    if (f.kind === 'daterange') {
      const d = v as DateRangeValue;
      if (d?.preset && d.preset !== CUSTOM_PRESET) return this.presets().find((p) => p.value === d.preset)?.label ?? d.preset;
      return `${d?.from ?? '…'} → ${d?.to ?? '…'}`;
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
    if (key === '__search') this.setQuery('');
    else this.clearFilter(key);
  }

  protected searchPlaceholder(): string {
    return `Search ${this.recordNounPlural()}…`;
  }

  // ---- navigation / export ---------------------------------------------------

  protected openRow(row: T): void {
    const routeFn = this.config().rowRoute;
    if (routeFn) this.router.navigate(routeFn(row) as any[]);
  }

  protected openCreate(): void {
    const routeArr = this.config().createRoute;
    if (routeArr) this.router.navigate(routeArr as any[]);
  }

  // RBAC 14 §2.2f, identical mechanics to ListScreenComponent.exportAs
  // (list-screen.component.ts:574-619) — same auth-header requirement (Bearer
  // only, so a plain <a href> would hit the API unauthenticated), same
  // client-only-filter confirmation before a wider export than the screen
  // shows. §7 Phase 11's "a board exports as a flat list" needs no different
  // request here: it's the SAME `?format=pdf|excel` GET against `endpoint`
  // the list shape uses, and the backend already flattens it server-side.
  protected exportAs(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    if (this.clientOnlyActive()) {
      const ok = window.confirm(
        'Some active filters or search are applied in the browser and cannot be sent to the server, ' +
          'so the exported file will contain more rows than the board shows.\n\n' +
          'Export anyway?',
      );
      if (!ok) return;
    }
    this.exporting.set(format);
    this.actionError.set(null);

    const params = this.serverParams();
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
