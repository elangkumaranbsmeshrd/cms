import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { FilterOption, MatrixGroup, MatrixItem, MatrixPendingChange, MatrixScreenConfig } from '../screen.types';
import { RoleButtonDirective } from '../../ui/role-button.directive';

/** The prototype's R.matrix (app-screens2.js:1295) — RBAC's own Permission
 * Matrix screen (14-rbac-module.md §4.2), the reference case this shape was
 * built for (Phase 17 wires the real screen; this file only owns the
 * reusable shell). Grounded directly in the already-built backend contract
 * (`app/api/v1/rbac_admin.py`'s GET/PUT `/rbac/matrix/{role_code}` and
 * `app/schemas/rbac_admin.py`'s MatrixModuleState/MatrixScreenState), not
 * just the prototype's demo data — see MatrixScreenConfig's own comment in
 * screen.types.ts for how the four RBAC layers map onto this shape's rows.
 *
 * Matrix data is fetched ONE COLUMN at a time (a role dropdown, exactly the
 * prototype's `S.view['matrixRole']` switcher) rather than every column
 * rendered side by side — the real backend's GET is itself per-role, and a
 * 168-screen x 900-field grid rendered as N role columns at once would not
 * fit a screen at all. Edits accumulate as PENDING CHANGES (this is the
 * prototype's own copy: "Toggles accumulate as pending edits rather than
 * saving one at a time") and commit together in one request — RBAC 14
 * §3.2's "bulk-apply".
 */
@Component({
  selector: 'app-matrix-screen',
  standalone: true,
  imports: [IconComponent, RoleButtonDirective],
  template: `
    <!-- embedded = hosted as a tab body inside a TabbedScreenConfig — same
         suppression convention as ListScreenComponent's own 'embedded' input
         (list-screen.component.ts:30-46). The Save/Discard actions still
         render: they act on this screen's own pending edits regardless of
         who owns the surrounding chrome. -->
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
        @if (canSave() && hasPending()) {
          <button class="btn" type="button" [disabled]="saving()" (click)="discard()">Discard Changes</button>
        }
        @if (canSave()) {
          <button class="btn primary" type="button" [disabled]="!hasPending() || saving()" (click)="save()">
            <app-icon name="check" [size]="14" />{{ saving() ? 'Saving…' : 'Save Changes' }}
          </button>
        }
      </div>
    </div>

    @if (config().helpNote) {
      <div class="rbac-note">
        <app-icon name="info" [size]="14" />
        <div>{{ config().helpNote }}</div>
      </div>
    }

    @if (saveError()) {
      <div class="form-error" style="margin: 0 0 12px;">{{ saveError() }}</div>
    }

    <div class="filterbar">
      <div class="filter-row">
        <span style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary); white-space: nowrap;">{{ config().columns.label }}</span>
        <select class="fselect" style="max-width: 220px;" [value]="selectedColumn()" (change)="selectColumn($any($event.target).value)">
          @for (opt of columnOptions(); track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>

        <div class="searchbox" style="width: 260px;">
          <span class="s-icon"><app-icon name="search" [size]="14" [width]="2" /></span>
          <input
            type="search"
            placeholder="Search modules, screens, actions and fields…"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
          />
        </div>

        @if (moduleOptions().length > 1) {
          <select class="fselect" [title]="config().moduleFilterLabel ?? 'All Modules'" [value]="moduleFilter()" (change)="moduleFilter.set($any($event.target).value)">
            <option value="">{{ config().moduleFilterLabel ?? 'All Modules' }}</option>
            @for (m of moduleOptions(); track m.value) {
              <option [value]="m.value">{{ m.label }}</option>
            }
          </select>
        }

        @if (config().isDefaultItem) {
          <!-- RBAC 14 §3.2: "show only non-default rules by default with a
               show-all toggle." Only offered when the config declares what
               "default" means for a row — see MatrixScreenConfig.isDefaultItem's
               own comment for why this cannot be inferred generically. -->
          <label class="fselect" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; background-image: none; padding-right: 9px;">
            <input type="checkbox" [checked]="showAllDefaults()" (change)="showAllDefaults.set($any($event.target).checked)" />
            {{ config().defaultsToggleLabel ?? 'Show all (including defaults)' }}
          </label>
        }

        <span style="font-size: 11px; color: var(--text-tertiary); margin-left: auto; white-space: nowrap;">{{ summaryLine() }}</span>
      </div>
    </div>

    @if (loading()) {
      <div class="card">
        <div class="empty">
          <p>Loading…</p>
        </div>
      </div>
    } @else if (loadError()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load the permission matrix</b></p>
          <p class="hint">{{ loadError() }}</p>
        </div>
      </div>
    } @else if (!visibleGroups().length) {
      <div class="card">
        <div class="empty">
          <div class="ico">∅</div>
          @if (search() || moduleFilter()) {
            <p>No modules or screens match the current filters.</p>
            <p class="hint"><span class="clear" role="button" (click)="clearFilters()">Clear filters</span></p>
          } @else {
            <p>{{ config().emptyText ?? 'Nothing is configurable here yet.' }}</p>
          }
        </div>
      </div>
    } @else {
      @for (group of visibleGroups(); track group.key) {
        <div class="matrix-mod" [class.open]="isOpen(group.key)">
          <div class="matrix-head" role="button" (click)="toggleGroup(group.key)">
            <span class="chev"><app-icon name="arrow" [size]="13" [width]="2.4" /></span>
            <h4>{{ group.label }}</h4>
            @if (group.specRef) {
              <span class="spec-ref">{{ group.specRef }}</span>
            }
            <span class="meta">{{ group.items.length }} screen{{ group.items.length === 1 ? '' : 's' }} &middot; {{ toggleCount(group) }} field/action toggle{{ toggleCount(group) === 1 ? '' : 's' }}</span>
          </div>
          <div class="matrix-body">
            @for (item of group.items; track item.key) {
              <div class="mscreen">
                <div class="mscreen-top">
                  <span class="nm">{{ item.label }}</span>
                  @if (item.specRef) {
                    <span class="spec-ref">{{ item.specRef }}</span>
                  }
                  <div class="mscreen-ctl">
                    <!-- Layer 1 (visibility) + Layer 4 (scope) are ONE field
                         server-side (session.model.ts's ScreenMode — see the
                         type comment in screen.types.ts) so this is ONE
                         segmented control, not two that could disagree. An
                         item without 'hasScope' never offers the scoped
                         values at all. -->
                    <div class="scope-seg" title="Screen mode — visibility and scope">
                      @for (opt of modeOptionsFor(item); track opt.value) {
                        <button type="button" [class.on]="effectiveMode(item) === opt.value" [disabled]="!canSave()" (click)="setMode(item, opt.value)">
                          {{ opt.label }}
                        </button>
                      }
                    </div>
                  </div>
                </div>

                @if (item.actions.length) {
                  <!-- Layer 2 — per-screen action permissions. -->
                  <div class="mactions">
                    @for (a of item.actions; track a.key) {
                      <span class="mact" [class.on]="effectiveActionAllowed(item, a.key)" role="button" (click)="toggleAction(item, a.key)">
                        <span class="bx">
                          @if (effectiveActionAllowed(item, a.key)) {
                            <app-icon name="check" [size]="9" [width]="3.4" />
                          }
                        </span>
                        {{ a.label }}
                      </span>
                    }
                  </div>
                }

                @if (item.fields.length) {
                  <!-- Layer 3 — per-screen field/behaviour toggles. The
                       prototype attaches this list once PER MODULE (its own
                       demo data, D.toggles[m.label]); the real backend ties
                       ScreenSensitiveField to one screen (MatrixScreenState.
                       fields), which is the more precise model and the one
                       this component follows — see judgmentCalls. Each chip
                       CYCLES fieldModeOptions rather than being a plain
                       on/off, since the real vocabulary has 3 members
                       (show/mask/hide), not 2. -->
                  <div class="mactions" style="border-top: 1px dashed var(--border); margin-top: 9px; padding-top: 9px;">
                    <span style="width: 100%; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600;">
                      Field &amp; behaviour toggles
                    </span>
                    @for (f of item.fields; track f.key) {
                      <span
                        class="mfield"
                        [class.on]="effectiveFieldMode(item, f.key) !== defaultFieldValue()"
                        role="button"
                        [title]="f.label + ': click to cycle'"
                        (click)="cycleField(item, f.key)"
                      >
                        <span class="bx">
                          @if (effectiveFieldMode(item, f.key) !== defaultFieldValue()) {
                            <app-icon name="check" [size]="9" [width]="3.4" />
                          }
                        </span>
                        {{ f.label }}: {{ fieldModeLabel(item, f.key) }}
                      </span>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }
    }
  `,
})
export class MatrixScreenComponent<T = any> {
  readonly config = input.required<MatrixScreenConfig<T>>();
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  protected readonly policy = inject(PolicyStore);

  // ---- column selector (the prototype's role dropdown) -------------------
  private readonly columnRows = signal<readonly unknown[]>([]);
  protected readonly selectedColumn = signal('');

  protected readonly columnOptions = computed<readonly FilterOption[]>(() => {
    const cfg = this.config().columns;
    if (cfg.options) return cfg.options;
    const mapFn =
      cfg.mapOption ??
      ((row: any) => ({
        value: String(row?.role_code ?? row?.id ?? row?.value ?? ''),
        label: String(row?.role_name ?? row?.name ?? row?.label ?? ''),
      }));
    return this.columnRows().map(mapFn).filter((o) => !!o.value);
  });

  // ---- loaded rows ---------------------------------------------------------
  protected readonly groups = signal<readonly MatrixGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());

  // ---- filters ---------------------------------------------------------
  protected readonly search = signal('');
  protected readonly moduleFilter = signal('');
  protected readonly showAllDefaults = signal(false);

  // ---- pending edits (bulk-apply) ---------------------------------------
  protected readonly pending = signal<ReadonlyMap<string, MatrixPendingChange>>(new Map());
  protected readonly hasPending = computed(() => this.pending().size > 0);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  private readonly originalByKey = computed(() => {
    const map = new Map<string, MatrixItem>();
    for (const g of this.groups()) for (const it of g.items) map.set(it.key, it);
    return map;
  });

  constructor() {
    // (1) Fetch the column list whenever it comes from an endpoint rather
    // than a static list — mirrors ListScreenComponent's own financial-year
    // fetch (list-screen.component.ts:288-301): fetched once per config,
    // and a failure just leaves the dropdown at whatever `options` were
    // already given rather than breaking the screen.
    effect(() => {
      const cfg = this.config();
      this.columnRows.set([]);
      if (!cfg.columns.optionsEndpoint) return;
      this.http.get<unknown[]>(`${environment.apiBaseUrl}${cfg.columns.optionsEndpoint}`).subscribe({
        next: (rows) => this.columnRows.set(Array.isArray(rows) ? rows : []),
        error: () => this.columnRows.set([]),
      });
    });

    // (2) Once options exist, land on the config's declared default (or the
    // first option) — and re-land whenever the current selection falls out
    // of the option list (e.g. a differently-scoped config swapped in).
    effect(() => {
      const opts = this.columnOptions();
      if (!opts.length) return;
      const current = this.selectedColumn();
      if (current && opts.some((o) => o.value === current)) return;
      const preferred = this.config().columns.defaultValue;
      this.selectedColumn.set(preferred && opts.some((o) => o.value === preferred) ? preferred : opts[0].value);
    });

    // (3) Load this column's rows. Only re-runs on a `search()` change when
    // the config actually declares a server searchParam — otherwise the
    // signal is never read here at all, so typing in the search box stays
    // a pure client-side filter (visibleGroups below) with no refetch.
    effect(() => {
      const cfg = this.config();
      const column = this.selectedColumn();
      if (cfg.searchParam) this.search();
      this.pending.set(new Map());
      this.saveError.set(null);
      if (!column) {
        this.groups.set([]);
        this.loading.set(false);
        return;
      }
      this.loadRows();
    });
  }

  private loadRows(): void {
    const cfg = this.config();
    const column = this.selectedColumn();
    this.loading.set(true);
    this.loadError.set(null);
    let params = new HttpParams();
    if (cfg.searchParam) params = params.set(cfg.searchParam, this.search().trim());
    this.http.get<T[]>(`${environment.apiBaseUrl}${cfg.rowsEndpoint(column)}`, { params }).subscribe({
      next: (raw) => {
        const groups = cfg.mapGroups(Array.isArray(raw) ? raw : []);
        this.groups.set(groups);
        // Open by default — an admin tool with real search/filter controls
        // gains nothing from hiding content the way the prototype's demo
        // (only module index 1 pre-opened) did.
        this.expanded.set(new Set(groups.map((g) => g.key)));
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load the permission matrix.');
        this.loading.set(false);
      },
    });
  }

  // ---- column switching ---------------------------------------------------

  protected selectColumn(value: string): void {
    if (value === this.selectedColumn()) return;
    if (this.hasPending() && !window.confirm('Switching roles discards your unsaved changes here. Continue?')) return;
    this.selectedColumn.set(value);
  }

  // ---- group/row visibility ------------------------------------------------

  protected isOpen(key: string): boolean {
    return this.expanded().has(key);
  }

  protected toggleGroup(key: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected readonly moduleOptions = computed<readonly FilterOption[]>(() => this.groups().map((g) => ({ value: g.key, label: g.label })));

  protected readonly visibleGroups = computed<readonly MatrixGroup[]>(() => {
    const cfg = this.config();
    const mf = this.moduleFilter();
    const q = this.search().trim().toLowerCase();
    const showAll = this.showAllDefaults();
    return this.groups()
      .filter((g) => !mf || g.key === mf)
      .map((g) => ({ ...g, items: this.filterItems(g, q, showAll, cfg) }))
      .filter((g) => this.isOpen(g.key) && g.items.length > 0);
  });

  private filterItems(group: MatrixGroup, q: string, showAll: boolean, cfg: MatrixScreenConfig<T>): readonly MatrixItem[] {
    let items = group.items;
    // RBAC 14 §3.2's "search by field name": the real backend's own
    // `search=` param only matches module/screen labels (rbac_admin.py's
    // get_matrix), so an action or field name never round-trips server-side
    // — this client pass is what actually satisfies that half of §3.2 (see
    // judgmentCalls). A group whose OWN label matches keeps every item,
    // exactly the backend's own "whole module matches" rule.
    if (q && !group.label.toLowerCase().includes(q) && !group.key.toLowerCase().includes(q)) {
      items = items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.actions.some((a) => a.label.toLowerCase().includes(q)) ||
          it.fields.some((f) => f.label.toLowerCase().includes(q)),
      );
    }
    if (!showAll && cfg.isDefaultItem) {
      // A row with a pending (unsaved) edit always stays visible — hiding it
      // mid-edit because it now scores as "changed away from default" would
      // make the toggle just fought the user.
      items = items.filter((it) => this.pending().has(it.key) || !cfg.isDefaultItem!(it));
    }
    return items;
  }

  protected clearFilters(): void {
    this.search.set('');
    this.moduleFilter.set('');
  }

  protected toggleCount(group: MatrixGroup): number {
    return group.items.reduce((a, it) => a + it.actions.length + it.fields.length, 0);
  }

  protected summaryLine(): string {
    const groups = this.visibleGroups();
    const screens = groups.reduce((a, g) => a + g.items.length, 0);
    const toggles = groups.reduce((a, g) => a + this.toggleCount(g), 0);
    return `${groups.length} module${groups.length === 1 ? '' : 's'} · ${screens} screen${screens === 1 ? '' : 's'} · ${toggles} field/action toggle${toggles === 1 ? '' : 's'}`;
  }

  // ---- cell read/edit -----------------------------------------------------

  /** Layer 1 options this item may actually take — the scoped values
   * (own/team/view_team, configurable via `scopedModeValues`) only appear
   * once `item.hasScope` is true, matching the prototype's own conditional
   * second segmented control (app-screens2.js:1324's `visible && sc.scope`). */
  protected modeOptionsFor(item: MatrixItem): readonly FilterOption[] {
    const cfg = this.config();
    if (item.hasScope) return cfg.modeOptions;
    const scoped = new Set(cfg.scopedModeValues ?? ['own', 'team', 'view_team']);
    return cfg.modeOptions.filter((o) => !scoped.has(o.value));
  }

  protected effectiveMode(item: MatrixItem): string {
    return this.pending().get(item.key)?.mode ?? item.mode;
  }

  protected effectiveActionAllowed(item: MatrixItem, actionKey: string): boolean {
    const p = this.pending().get(item.key)?.actions?.[actionKey];
    if (p !== undefined) return p;
    return item.actions.find((a) => a.key === actionKey)?.allowed ?? false;
  }

  protected defaultFieldValue(): string {
    return this.config().fieldModeOptions[0]?.value ?? '';
  }

  protected effectiveFieldMode(item: MatrixItem, fieldKey: string): string {
    const p = this.pending().get(item.key)?.fields?.[fieldKey];
    if (p !== undefined) return p;
    return item.fields.find((f) => f.key === fieldKey)?.mode ?? this.defaultFieldValue();
  }

  protected fieldModeLabel(item: MatrixItem, fieldKey: string): string {
    const v = this.effectiveFieldMode(item, fieldKey);
    return this.config().fieldModeOptions.find((o) => o.value === v)?.label ?? v;
  }

  protected canSave(): boolean {
    return this.policy.can(this.config().id, this.config().saveScreenAction ?? 'edit');
  }

  protected setMode(item: MatrixItem, value: string): void {
    if (!this.canSave()) return;
    this.mergePending(item.key, { mode: value });
  }

  protected toggleAction(item: MatrixItem, actionKey: string): void {
    if (!this.canSave()) return;
    this.mergePending(item.key, { actions: { [actionKey]: !this.effectiveActionAllowed(item, actionKey) } });
  }

  protected cycleField(item: MatrixItem, fieldKey: string): void {
    if (!this.canSave()) return;
    const opts = this.config().fieldModeOptions;
    if (!opts.length) return;
    const idx = opts.findIndex((o) => o.value === this.effectiveFieldMode(item, fieldKey));
    const next = opts[(idx + 1) % opts.length].value;
    this.mergePending(item.key, { fields: { [fieldKey]: next } });
  }

  /** Merges one edit into the pending map, then drops the whole entry again
   * if it now matches the originally-loaded row exactly — so "Save Changes"
   * never sends a no-op change, and a toggled-back-and-forth chip correctly
   * stops glowing and stops counting toward `hasPending()`. */
  private mergePending(itemKey: string, patch: { mode?: string; actions?: Record<string, boolean>; fields?: Record<string, string> }): void {
    const original = this.originalByKey().get(itemKey);
    this.pending.update((map) => {
      const next = new Map(map);
      const current = next.get(itemKey);
      const merged: MatrixPendingChange = {
        itemKey,
        mode: 'mode' in patch ? patch.mode : current?.mode,
        actions: patch.actions ? { ...current?.actions, ...patch.actions } : current?.actions,
        fields: patch.fields ? { ...current?.fields, ...patch.fields } : current?.fields,
      };
      if (this.isNoop(original, merged)) next.delete(itemKey);
      else next.set(itemKey, merged);
      return next;
    });
  }

  private isNoop(original: MatrixItem | undefined, change: MatrixPendingChange): boolean {
    if (!original) return false;
    if (change.mode !== undefined && change.mode !== original.mode) return false;
    for (const [k, v] of Object.entries(change.actions ?? {})) {
      if (v !== (original.actions.find((a) => a.key === k)?.allowed ?? false)) return false;
    }
    for (const [k, v] of Object.entries(change.fields ?? {})) {
      if (v !== (original.fields.find((f) => f.key === k)?.mode ?? this.defaultFieldValue())) return false;
    }
    return true;
  }

  // ---- save / discard -------------------------------------------------------

  protected discard(): void {
    this.pending.set(new Map());
    this.saveError.set(null);
  }

  protected save(): void {
    if (this.saving() || !this.hasPending() || !this.canSave()) return;
    const cfg = this.config();
    const changes = [...this.pending().values()];
    const body = cfg.buildSaveBody
      ? cfg.buildSaveBody(changes)
      : { changes: changes.map((p) => ({ screen_key: p.itemKey, mode: p.mode, actions: p.actions, fields: p.fields })) };
    const url = `${environment.apiBaseUrl}${cfg.saveEndpoint(this.selectedColumn())}`;
    this.saving.set(true);
    this.saveError.set(null);
    const req$ = cfg.saveMethod === 'POST' ? this.http.post(url, body) : this.http.put(url, body);
    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.pending.set(new Map());
        this.loadRows();
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.detail ?? 'Saving the permission matrix failed.');
      },
    });
  }
}
