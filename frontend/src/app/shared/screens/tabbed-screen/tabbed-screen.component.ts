import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { BreadcrumbService } from '../../../core/navigation/breadcrumb.service';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { badgeClass } from '../cell-format';
import { ListScreenComponent } from '../list-screen/list-screen.component';
import { SingletonFormComponent } from '../singleton-form/singleton-form.component';
import { FieldGridComponent } from '../field-grid/field-grid.component';
import { ListScreenConfig, SingletonFormConfig, TabDef, TabFieldsDef, TabStaticDef, TabbedScreenConfig } from '../screen.types';

/** The prototype's record shape (R.record, app-screens2.js:802), which is the
 * house layout for any screen that owns sub-resources: an identity card, a tab
 * bar with count badges, then the active tab's body.
 *
 * The tab bodies are NOT reimplemented here — each one is the real screen
 * component for that shape, rendered with `embedded` set so its own page title
 * is suppressed. Company Profile's Addresses tab is literally the Addresses
 * list screen, so it keeps its filters, chips, export and row actions, and
 * cannot drift from the standalone version because it IS the standalone
 * version.
 *
 * Sub-resources are never "Addresses →" nav buttons: those make the user leave
 * the record and hide how many child rows there are.
 */
@Component({
  selector: 'app-tabbed-screen',
  standalone: true,
  imports: [ListScreenComponent, SingletonFormComponent, FieldGridComponent],
  template: `
    <div class="page-head">
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
    </div>

    @if (config().header; as head) {
      <div class="rec-head">
        <div class="rec-avatar">{{ head.avatar?.(headerRow()) || initial() }}</div>
        <div style="min-width: 0;">
          @if (head.recId?.(headerRow()); as rid) {
            <div class="rec-id">{{ rid }}</div>
          }
          <div class="rec-name">{{ head.name(headerRow()) }}</div>
          <div class="rec-meta">
            @for (m of metaItems(); track $index) {
              @if ($index) {
                <span class="dot"></span>
              }
              <span>{{ m }}</span>
            }
            @if (head.badge?.(headerRow()); as b) {
              @if (metaItems().length) {
                <span class="dot"></span>
              }
              <span class="badge-s {{ badgeCls(b) }}">{{ b }}</span>
            }
          </div>
        </div>
        @if (summaryTiles().length) {
          <div class="rec-summary">
            @for (s of summaryTiles(); track s.label) {
              <div class="s">
                <div class="l">{{ s.label }}</div>
                <div class="v">{{ s.value }}</div>
              </div>
            }
          </div>
        }
      </div>
    }

    <div class="tabs">
      @for (tab of visibleTabs(); track tab.key) {
        <div class="tab" [class.on]="tab.key === activeKey()" role="button" (click)="select(tab.key)">
          {{ tab.label }}
          @if (countFor(tab); as n) {
            <span class="cnt">{{ n }}</span>
          }
        </div>
      }
    </div>

    @if (activeTab(); as tab) {
      @if (tab.kind === 'fields') {
        <app-field-grid [row]="headerRowAsRecord()" [sections]="asFieldsTab(tab).sections(headerRowAsRecord())" />
      } @else if (tab.kind === 'static') {
        <app-field-grid [row]="null" [sections]="asStaticTab(tab).sections" />
      } @else {
        @switch (tab.config.shape) {
          @case ('list') {
            <app-list-screen [config]="$any(tab.config)" [embedded]="true" />
          }
          @case ('singleton') {
            <app-singleton-form [config]="$any(tab.config)" [embedded]="true" />
          }
          @default {
            <div class="card">
              <div class="empty">
                <p>This tab's shape ({{ tab.config.shape }}) can't be embedded yet.</p>
              </div>
            </div>
          }
        }
      }
    }
  `,
})
export class TabbedScreenComponent<T = any> {
  readonly config = input.required<TabbedScreenConfig<T>>();
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly policy = inject(PolicyStore);

  protected readonly headerRow = signal<T | null>(null);
  private readonly selected = signal<string | null>(null);
  /** Child-row counts for the tab badges, keyed by tab. Fetched once per tab
   * that hosts a list, so "Addresses 3" is true on arrival rather than only
   * after the tab is opened. */
  private readonly counts = signal<Record<string, number>>({});
  /** The same fetch's raw rows, keyed by tab — RecordHeaderDef.summary's
   * `tabRows` param reads this, so a header stat can be built from a tab
   * other than the one headerEndpoint feeds (e.g. Email Configuration's
   * Templates/Enabled tiles). Kept separate from `counts` rather than
   * deriving one from the other, since `counts` is post-rowFilter and a
   * summary tile may need the pre-filter rows (or a different filter
   * entirely, like "how many of these are enabled"). */
  private readonly tabRowsByKey = signal<Record<string, readonly unknown[]>>({});

  constructor() {
    effect(() => {
      const cfg = this.config();
      this.selected.set(null);
      this.headerRow.set(null);
      this.counts.set({});
      this.tabRowsByKey.set({});

      if (cfg.headerEndpoint) {
        this.http.get<T>(`${environment.apiBaseUrl}${cfg.headerEndpoint}`).subscribe({
          next: (row) => this.headerRow.set(row ?? null),
          // A singleton that hasn't been created yet legitimately returns null
          // or 404 — the header falls back to its own constants.
          error: () => this.headerRow.set(null),
        });
      }

      for (const tab of cfg.tabs) {
        // 'fields'/'static' tabs (§4) have no `.config`/endpoint of their own
        // at all — nothing to fetch a count or summary-source from.
        if (tab.kind === 'fields' || tab.kind === 'static') continue;
        if (tab.config.shape !== 'list') continue;
        const list = tab.config as ListScreenConfig<any>;
        this.http.get<unknown[]>(`${environment.apiBaseUrl}${list.endpoint}`).subscribe({
          next: (rows) => {
            if (!Array.isArray(rows)) return;
            // Every list tab's raw rows are kept for `header.summary` even
            // when hideCount suppresses this same tab's own badge — those are
            // two different consumers of one fetch, not one feature.
            this.tabRowsByKey.update((r) => ({ ...r, [tab.key]: rows }));
            if (tab.hideCount) return;
            const n = list.rowFilter ? rows.filter(list.rowFilter).length : rows.length;
            this.counts.update((c) => ({ ...c, [tab.key]: n }));
          },
          error: () => undefined, // no badge, no summary data — rather than a broken screen
        });
      }
    });

    // "On a tabbed record, the active tab is the last segment." Published from
    // here rather than computed in the service, because only this component
    // knows which tab survived the RBAC filter and the ?tab= param.
    effect(() => {
      const tab = this.visibleTabs().find((t) => t.key === this.activeKey());
      this.breadcrumbs.setTabLabel(tab?.label ?? null);
    });
    this.destroyRef.onDestroy(() => this.breadcrumbs.setTabLabel(null));
  }

  /** §2.2b — a tab whose screen this role cannot open is not shown. Every tab
   * here shares the host's RBAC key today, but a tab can name its own.
   * 'fields'/'static' tabs (§4) have no separate screen/RBAC id at all — they
   * show whenever the host screen itself does, same as any other tab that
   * names no `id`. */
  protected visibleTabs(): readonly TabDef[] {
    return this.config().tabs.filter((t) => {
      if (t.kind === 'fields' || t.kind === 'static') return true;
      const id = (t.config as { id?: string }).id;
      return !id || this.policy.canOpen(id);
    });
  }

  protected activeKey(): string {
    const tabs = this.visibleTabs();
    const chosen = this.selected();
    if (chosen && tabs.some((t) => t.key === chosen)) return chosen;
    // Deep-linkable: ?tab=addresses survives a refresh and a shared URL.
    const fromUrl = this.route.snapshot.queryParamMap.get('tab');
    if (fromUrl && tabs.some((t) => t.key === fromUrl)) return fromUrl;
    return tabs[0]?.key ?? '';
  }

  protected activeTab(): TabDef | undefined {
    return this.visibleTabs().find((t) => t.key === this.activeKey());
  }

  // Template type-narrowing helpers (§4) — Angular's template checker can't
  // narrow TabDef's union from `tab.kind === 'fields'` the way plain
  // TypeScript does, so these mirror record-screen.component.ts's own
  // asFieldsTab pattern for the same reason.
  protected asFieldsTab(tab: TabDef): TabFieldsDef {
    return tab as TabFieldsDef;
  }

  protected asStaticTab(tab: TabDef): TabStaticDef {
    return tab as TabStaticDef;
  }

  /** Generic `T` isn't statically known to satisfy `Record<string, unknown>`
   * (it could be `T[]`, a primitive, anything a config author names) — this
   * is a runtime no-op cast for the one case (§4) that genuinely needs the
   * loose shape, not a claim that headerRow() suddenly changed type. */
  protected headerRowAsRecord(): Record<string, unknown> | null {
    return this.headerRow() as unknown as Record<string, unknown> | null;
  }

  protected select(key: string): void {
    this.selected.set(key);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected countFor(tab: TabDef): number | null {
    const n = this.counts()[tab.key];
    return typeof n === 'number' ? n : null;
  }

  protected metaItems(): string[] {
    const head = this.config().header;
    return (head?.meta?.(this.headerRow()) ?? []).filter((m) => !!m && m !== '—');
  }

  protected summaryTiles(): readonly { label: string; value: string }[] {
    return this.config().header?.summary?.(this.headerRow(), this.tabRowsByKey()) ?? [];
  }

  /** Falls back to the screen's own initial when no avatar is configured. */
  protected initial(): string {
    return this.config().title.trim().charAt(0).toUpperCase();
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }
}
