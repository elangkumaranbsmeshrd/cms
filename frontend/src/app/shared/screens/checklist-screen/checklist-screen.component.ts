import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { badgeClass, formatDate } from '../cell-format';
import { ChecklistGroupDef, ChecklistHeaderActionDef, ChecklistItemDef, ChecklistScreenConfig, SecondaryActionDef } from '../screen.types';

/** The prototype's checklist shape (R.checklist, app-screens.js:468), which
 * drives Employee Onboarding (§2.13) and Offboarding/Exit (§2.14): a
 * rec-head identity card showing the subject and their progress, then a
 * single ordered (optionally grouped) run of steps. Distinct from the
 * 'record' shape's field tabs — a step here is an ACTION (toggle it, or open
 * the screen that actually completes it), never a display value.
 *
 * `gate` is what makes the exit order real rather than advisory
 * (app-screens.js:480-483, :541-550): a step naming a gate cannot be
 * actioned until the gated-on step is Done, e.g. asset return stays locked
 * until the resignation letter exists.
 *
 * embedded = this checklist is a TAB BODY inside a tabbed record screen
 * (e.g. an employee's own Onboarding tab), so the surrounding page head
 * belongs to the host, not here — same convention as ListScreenComponent's
 * own `embedded` input (list-screen.component.ts).
 */
@Component({
  selector: 'app-checklist-screen',
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

    @if (loading()) {
      <div class="card">
        <div class="empty">
          <p>Loading…</p>
        </div>
      </div>
    } @else if (error()) {
      <div class="card">
        <div class="empty">
          <div class="ico">⚠</div>
          <p><b>Couldn't load this checklist</b></p>
          <p class="hint">{{ error() }}</p>
        </div>
      </div>
    } @else {
      <div class="rec-head">
        <div class="rec-avatar">{{ avatarText() }}</div>
        <div style="min-width: 0;">
          @if (recId(); as rid) {
            <div class="rec-id">{{ rid }}</div>
          }
          <div class="rec-name">{{ config().header.name(row()) }}</div>
          <div class="rec-meta">
            @for (m of metaItems(); track $index) {
              @if ($index) {
                <span class="dot"></span>
              }
              <span>{{ m }}</span>
            }
          </div>
        </div>
        <div class="rec-summary">
          <div class="s">
            <div class="l">Progress</div>
            <div class="v">{{ doneCount() }} / {{ totalCount() }}</div>
          </div>
          <div class="s">
            <div class="l">Status</div>
            <div class="v"><span class="badge-s {{ badgeCls(statusLabel()) }}">{{ statusLabel() }}</span></div>
          </div>
        </div>
        @if (headerActions().length) {
          <div class="rec-actions">
            @for (act of headerActions(); track act.label) {
              <button class="btn" type="button" (click)="runHeaderAction(act)">
                @if (act.icon) {
                  <app-icon [name]="act.icon" [size]="14" />
                }
                {{ act.label }}
              </button>
            }
          </div>
        }
      </div>

      <div class="card">
        <div class="card-head">
          <h3>{{ config().title }}</h3>
          <span class="sub">{{ totalCount() }} {{ itemNounPlural(totalCount()) }}</span>
        </div>
        <div class="card-body flush">
          <div class="checklist">
            @for (g of groupsWithItems(); track g.group.key) {
              @if (g.group.label) {
                <div class="ck-group-head">{{ g.group.label }}</div>
              }
              @for (item of g.items; track itemTrackKey(item); let i = $index) {
                <div class="ck" [class.done]="isDone(item)" [class.blocked]="isBlocked(g.group, item)">
                  <div class="ck-box">
                    @if (isDone(item)) {
                      <app-icon name="check" [size]="12" [width]="3" />
                    } @else if (isBlocked(g.group, item)) {
                      <app-icon name="lock" [size]="11" />
                    } @else {
                      <span style="font-size: 9.5px; font-weight: 700; color: var(--text-tertiary);">{{ i + 1 }}</span>
                    }
                  </div>
                  <div class="ck-body">
                    <div class="ck-title">{{ itemTitle(item) }}</div>
                    @if (itemDescription(item); as desc) {
                      <div class="ck-desc">{{ desc }}</div>
                    }
                    @if (itemDue(item) || itemOwner(item)) {
                      <div class="ck-desc">
                        @if (itemDue(item); as due) {
                          <b>Due</b> {{ due }}
                        }
                        @if (itemDue(item) && itemOwner(item)) {
                          &nbsp;·&nbsp;
                        }
                        @if (itemOwner(item); as owner) {
                          <b>Owner</b> {{ owner }}
                        }
                      </div>
                    }
                    @if (isBlocked(g.group, item)) {
                      <div class="ck-desc" style="color: var(--warning); margin-top: 3px;">
                        <b>Blocked</b> — "{{ gateTitle(g.group, item) }}" has to be done first.
                      </div>
                    }
                  </div>
                  <div class="ck-act">
                    @if (isDone(item)) {
                      <span class="badge-s b-ok">Done</span>
                    } @else if (isBlocked(g.group, item)) {
                      <span class="badge-s b-warn"><app-icon name="lock" [size]="10" /> Locked</span>
                    } @else {
                      @if (itemRoute(item); as route) {
                        <button class="btn sm" type="button" (click)="navigate(route)">Open</button>
                      }
                      @if (canToggle(item)) {
                        <button class="btn sm" type="button" [disabled]="busy() === itemKey(g.group, item)" (click)="toggle(item)">
                          {{ busy() === itemKey(g.group, item) ? 'Marking…' : 'Mark done' }}
                        </button>
                      }
                    }
                  </div>
                </div>
              }
            }
          </div>
        </div>
        <div class="card-foot">
          @if (doneCount() === totalCount()) {
            <span class="badge-s b-ok">All {{ itemNounPlural(totalCount()) }} complete</span>
          } @else {
            <span style="font-size: 11.5px; color: var(--text-tertiary);">
              {{ outstandingCount() }} {{ itemNounPlural(outstandingCount()) }} outstanding{{ blockedCount() ? ', ' + blockedCount() + ' still locked behind an earlier step' : '' }}.
              Steps auto-check when the linked action completes in its own module.
            </span>
          }
        </div>
      </div>
    }
  `,
})
export class ChecklistScreenComponent<T = any, I = any> {
  readonly config = input.required<ChecklistScreenConfig<T, I>>();
  /** True when rendered as a tab body — suppresses this component's own page
   * title/description, matching ListScreenComponent's own `embedded` input. */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly policy = inject(PolicyStore);

  protected readonly row = signal<T | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  /** The composite key (group:item) of the toggle currently in flight, so the
   * one button that was clicked disables rather than every "Mark done" on
   * the screen. */
  protected readonly busy = signal<string | null>(null);

  constructor() {
    effect(() => {
      const cfg = this.config();
      const id = this.route.snapshot.paramMap.get('id');
      if (!id) {
        this.error.set('No record id in the route.');
        this.loading.set(false);
        return;
      }
      this.load(cfg, id);
    });
  }

  private load(cfg: ChecklistScreenConfig<T, I>, id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<T>(`${environment.apiBaseUrl}${cfg.endpoint(id)}`).subscribe({
      next: (data) => {
        this.row.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.detail ?? "Couldn't load this checklist.");
        this.loading.set(false);
      },
    });
  }

  private reload(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(this.config(), id);
  }

  // ---- header --------------------------------------------------------

  protected recId(): string | null {
    return this.config().header.recId?.(this.row()) ?? null;
  }

  protected metaItems(): string[] {
    return (this.config().header.meta?.(this.row()) ?? []).filter((m) => !!m && m !== '—');
  }

  /** Falls back to the subject's own initials (prototype's U.initials,
   * app-screens.js:473) when no avatar is configured — NOT the screen
   * title's initial, since a checklist's avatar identifies the PERSON. */
  protected avatarText(): string {
    const custom = this.config().header.avatar?.(this.row());
    if (custom) return custom;
    const name = this.config().header.name(this.row()) || '?';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  protected headerActions(): ChecklistHeaderActionDef[] {
    return (this.config().headerActions ?? []).filter((a) => !a.screenAction || this.policy.can(this.config().id, a.screenAction));
  }

  protected runHeaderAction(act: ChecklistHeaderActionDef): void {
    this.router.navigate(act.route as any[]);
  }

  // ---- items ----------------------------------------------------------

  protected groupsWithItems(): { group: ChecklistGroupDef<T, I>; items: readonly I[] }[] {
    const r = this.row();
    if (!r) return [];
    return this.config().groups.map((group) => ({ group, items: group.items(r) }));
  }

  private itemDef(): ChecklistItemDef<I> {
    return this.config().item;
  }

  protected itemKey(group: ChecklistGroupDef<T, I>, item: I): string {
    return `${group.key}:${this.itemDef().id(item)}`;
  }

  // Track expressions may only reference 'item'/'$index' and properties on
  // the containing component — NOT the outer @for's own loop variable (`g`
  // above), so this deliberately doesn't take a group param the way
  // itemKey() does. A step's own id (ChecklistItemDef.id's documented
  // "stable identity") is unique enough for track purposes on its own.
  protected itemTrackKey(item: I): string {
    return this.itemDef().id(item);
  }

  protected itemTitle(item: I): string {
    return this.itemDef().title(item);
  }

  protected itemDescription(item: I): string | null {
    return this.itemDef().description?.(item) ?? null;
  }

  protected itemDue(item: I): string | null {
    const raw = this.itemDef().dueDate?.(item);
    return raw ? formatDate(raw) : null;
  }

  protected itemOwner(item: I): string | null {
    return this.itemDef().owner?.(item) ?? null;
  }

  protected itemRoute(item: I): readonly unknown[] | null {
    return this.itemDef().route?.(item) ?? null;
  }

  protected isDone(item: I): boolean {
    return this.itemDef().done(item);
  }

  /** Every Done step's id, across every group — a superset of "same group"
   * is safe here since a `gate` id that belongs to a different group simply
   * never matches any item and the step is never blocked by it. */
  private doneIds(): Set<string> {
    const def = this.itemDef();
    const ids = new Set<string>();
    for (const { items } of this.groupsWithItems()) {
      for (const item of items) if (def.done(item)) ids.add(def.id(item));
    }
    return ids;
  }

  protected isBlocked(group: ChecklistGroupDef<T, I>, item: I): boolean {
    if (this.isDone(item)) return false;
    const gate = this.itemDef().gate?.(item);
    if (!gate) return false;
    return !this.doneIds().has(gate);
  }

  /** The display title of the step named by `gate`, for the "Blocked — “…”
   * has to be done first" line (app-screens.js:491). */
  protected gateTitle(group: ChecklistGroupDef<T, I>, item: I): string {
    const gate = this.itemDef().gate?.(item);
    if (!gate) return '';
    const def = this.itemDef();
    for (const { items } of this.groupsWithItems()) {
      const hit = items.find((i) => def.id(i) === gate);
      if (hit) return def.title(hit);
    }
    return gate;
  }

  protected canToggle(item: I): boolean {
    const row = this.row();
    if (!row) return false;
    const cfg = this.config();
    const endpoint = cfg.toggleEndpoint(row, item);
    if (!endpoint) return false;
    return this.policy.can(cfg.id, cfg.toggleScreenAction ?? 'edit');
  }

  protected toggle(item: I): void {
    const row = this.row();
    if (!row) return;
    const cfg = this.config();
    const endpoint = cfg.toggleEndpoint(row, item);
    if (!endpoint) return;
    const group = cfg.groups.find((g) => g.items(row).includes(item));
    const key = group ? this.itemKey(group, item) : this.itemDef().id(item);
    if (this.busy()) return;
    this.busy.set(key);
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}${endpoint}`, {}).subscribe({
      next: () => {
        this.busy.set(null);
        this.reload();
      },
      error: (err) => {
        this.busy.set(null);
        this.actionError.set(err?.error?.detail ?? 'That action failed.');
      },
    });
  }

  protected navigate(route: readonly unknown[]): void {
    this.router.navigate(route as any[]);
  }

  // ---- counts / footer --------------------------------------------------

  protected totalCount(): number {
    return this.groupsWithItems().reduce((n, g) => n + g.items.length, 0);
  }

  protected doneCount(): number {
    const def = this.itemDef();
    return this.groupsWithItems().reduce((n, g) => n + g.items.filter((i) => def.done(i)).length, 0);
  }

  protected outstandingCount(): number {
    return this.totalCount() - this.doneCount();
  }

  protected blockedCount(): number {
    return this.groupsWithItems().reduce((n, g) => n + g.items.filter((i) => this.isBlocked(g.group, i)).length, 0);
  }

  protected statusLabel(): string {
    return this.totalCount() > 0 && this.doneCount() === this.totalCount() ? 'Completed' : 'In Progress';
  }

  /** Enough English to cover 'step' — the shape's own default noun, mirroring
   * ListScreenComponent's recordNounPlural (list-screen.component.ts). */
  protected itemNounPlural(n: number): string {
    const noun = this.config().itemNoun ?? 'step';
    const plural = /(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
    return n === 1 ? noun : plural;
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  // ---- page-head secondary actions ---------------------------------------

  protected secondaryActions(): readonly SecondaryActionDef[] {
    return (this.config().secondaryActions ?? []).filter((a) => this.policy.can(this.config().id, a.screenAction));
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
}
