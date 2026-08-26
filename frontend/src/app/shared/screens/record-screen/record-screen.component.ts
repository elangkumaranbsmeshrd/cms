import { NgComponentOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { BreadcrumbService } from '../../../core/navigation/breadcrumb.service';
import { DirtyStateService } from '../../../core/navigation/dirty-state.service';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { environment } from '../../../../environments/environment';
import { FieldConfig, RecordActionDef, RecordComponentTab, RecordEmbedTab, RecordFieldsTab, RecordScreenConfig, RecordSecondaryActionDef, RecordTab, ScreenConfig } from '../screen.types';
import { RefDataService } from '../ref-data.service';
import { ListScreenComponent } from '../list-screen/list-screen.component';
import { SingletonFormComponent } from '../singleton-form/singleton-form.component';
import { ChecklistScreenComponent } from '../checklist-screen/checklist-screen.component';

/** ARCH-3 §3's record shape — one component for every 'record'-shape
 * screen, same "config object, not a component" rhythm as ListScreenComponent.
 * Loads the row itself (route :id -> loadEndpoint), renders a header, tab-
 * switched field sections, and — when `config().edit` is set and the role's
 * policy allows it — an Edit/Save/Cancel flow that PUTs the whole edited
 * record back to `edit.saveEndpoint`.
 */
@Component({
  selector: 'app-record-screen',
  standalone: true,
  imports: [FormsModule, NgComponentOutlet, ListScreenComponent, SingletonFormComponent, ChecklistScreenComponent],
  template: `
    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (error()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this record</b></p>
        <p class="hint">{{ error() }}</p>
      </div>
    } @else {
      @if (row(); as r) {
        <div class="page-head">
          <div>
            <h1 class="page-title">{{ config().header.primary(r) }}</h1>
            <p class="page-sub">
              <span class="mono">{{ config().header.code(r) }}</span>
              &middot; {{ config().header.secondary(r) }}
              @if (config().header.badge; as badgeFn) {
                &middot; <span class="badge-s b-info">{{ badgeFn(r) }}</span>
              }
            </p>
          </div>
          <div class="page-actions">
            @if (canEdit() && !isEditing()) {
              <button class="btn sm primary" type="button" (click)="startEdit(r)">Edit</button>
            }
            @if (isEditing()) {
              <button class="btn sm ghost" type="button" [disabled]="saving()" (click)="cancelEdit()">Cancel</button>
              <button class="btn sm primary" type="button" [disabled]="saving()" (click)="save()">
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
            }
            @for (act of visibleSecondaryActions(r); track act.label) {
              <button class="btn sm ghost" type="button" [disabled]="downloadingAction() === act.label" (click)="runSecondary(act, r)">
                {{ downloadingAction() === act.label ? 'Preparing…' : act.label }}
              </button>
            }
          </div>
        </div>

        @if (saveError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
        }
        @if (secondaryActionError()) {
          <div class="form-error" style="margin: 0 0 14px;">{{ secondaryActionError() }}</div>
        }

        <div class="filterbar" style="padding: 4px 6px;">
          <div class="filter-row">
            @for (tab of config().tabs; track tab.id) {
              <button
                type="button"
                class="btn sm"
                [class.primary]="activeTab() === tab.id"
                [class.ghost]="activeTab() !== tab.id"
                (click)="activeTab.set(tab.id)"
              >
                {{ tab.label }}
              </button>
            }
          </div>
        </div>

        @for (tab of config().tabs; track tab.id) {
          @if (activeTab() === tab.id) {
            @if (isEmbedTab(tab); as embed) {
              @switch (embedConfig(embed).shape) {
                @case ('list') {
                  <app-list-screen [config]="$any(embedConfig(embed))" [embedded]="true" />
                }
                @case ('singleton') {
                  <app-singleton-form [config]="$any(embedConfig(embed))" [embedded]="true" />
                }
                @case ('checklist') {
                  <app-checklist-screen [config]="$any(embedConfig(embed))" [embedded]="true" />
                }
                @default {
                  <div class="card">
                    <div class="empty">
                      <p>This tab's shape ({{ embedConfig(embed).shape }}) can't be embedded yet.</p>
                    </div>
                  </div>
                }
              }
            } @else if (isComponentTab(tab)) {
              @if (isComponentTab(tab); as ctab) {
                <ng-container *ngComponentOutlet="ctab.component; inputs: componentInputs(ctab)" />
              }
            } @else {
              <div class="card">
                <div class="card-body">
                  @if (asFieldsTab(tab).actions; as tabActions) {
                    @if (actionError()) {
                      <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
                    }
                    <div class="filter-row" style="margin-bottom: 18px;">
                      @for (action of tabActions; track action.label) {
                        @if (canFireAction(action) && (!action.visible || action.visible(r))) {
                          @if (action.selectParam; as sp) {
                            <select class="input" style="width: auto;" [(ngModel)]="actionSelectValues[action.label]">
                              @for (opt of sp.options; track opt.value) {
                                <option [value]="opt.value">{{ opt.label }}</option>
                              }
                            </select>
                          }
                          <button
                            class="btn sm ghost"
                            type="button"
                            [disabled]="actionInFlight() === action.label"
                            (click)="fireAction(action, r)"
                          >
                            {{ actionInFlight() === action.label ? 'Working…' : action.label }}
                          </button>
                        }
                      }
                    </div>
                  }
                  @for (section of asFieldsTab(tab).sections; track section.title) {
                    <h3 style="margin: 0 0 10px; font-size: 12.5px;">{{ section.title }}</h3>
                    <div class="grid g-2" style="margin-bottom: 18px;">
                      @for (field of section.fields; track field.label) {
                        @if (!field.hideWhenNoSecondary || secondaryData()[tab.id]) {
                          <div [style.grid-column]="field.span === 2 ? 'span 2' : null">
                            <div class="cell-sub" style="margin-bottom: 2px;">{{ field.label }}</div>
                            @if (isEditing() && isFieldEditable(field)) {
                              @if (field.type === 'select') {
                                <select class="input" [(ngModel)]="formModel[field.key]">
                                  <option [value]="null">—</option>
                                  @for (opt of selectOptions(field); track opt.id) {
                                    <option [value]="opt.id">{{ opt.label }}</option>
                                  }
                                </select>
                              } @else if (field.type === 'checkbox') {
                                <input type="checkbox" [(ngModel)]="formModel[field.key]" />
                              } @else if (field.type === 'textarea') {
                                <textarea class="input" rows="3" [(ngModel)]="formModel[field.key]"></textarea>
                              } @else {
                                <input
                                  class="input"
                                  [type]="field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'"
                                  [(ngModel)]="formModel[field.key]"
                                />
                              }
                              @if (fieldError(field); as err) {
                                <div class="hint" style="color: var(--danger);">{{ err }}</div>
                              }
                            } @else {
                              <div>{{ fieldValue(r, field, tab.id) }}</div>
                            }
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              </div>
            }
          }
        }
      }
    }
  `,
})
export class RecordScreenComponent<T = any> {
  readonly config = input.required<RecordScreenConfig<T>>();
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);

  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly dirty = inject(DirtyStateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly row = signal<T | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly activeTab = signal<string>('');

  protected readonly isEditing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  // Plain mutable object, not a signal — [(ngModel)]="formModel[field.key]"
  // needs a real assignable target; a signal call isn't one. Seeded from a
  // full shallow copy of the loaded row (not just the editable fields) so
  // Save always PUTs every key the backend's Write schema expects — the
  // real update_* endpoints do `for field, value in body.model_dump():
  // setattr(row, field, value)`, so omitting a key would silently null it
  // out server-side rather than just leaving it alone.
  protected formModel: Record<string, unknown> = {};

  // Keyed by RecordFieldsTab.id — see FieldConfig.secondaryEndpoint's own
  // doc. `null` means "fetched, host record has none" (Account & Login's
  // no-login-yet state); absent means "not fetched yet".
  protected readonly secondaryData = signal<Record<string, unknown | null>>({});
  private readonly secondaryFetched = new Set<string>();

  protected readonly actionInFlight = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected actionSelectValues: Record<string, string> = {};

  // ---- page-head secondary actions (RecordSecondaryActionDef) -----------
  protected readonly downloadingAction = signal<string | null>(null);
  protected readonly secondaryActionError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const cfg = this.config();
      if (!this.activeTab()) this.activeTab.set(cfg.tabs[0]?.id ?? '');
      this.reload();
    });

    // Fetches a fields-tab's own secondaryEndpoint (if any) the first time
    // it becomes active — not eagerly for every tab, since most tabs have
    // none and Account & Login's is the only consumer today.
    effect(() => {
      const cfg = this.config();
      const tabId = this.activeTab();
      const currentRow = this.row();
      if (!currentRow || !tabId || this.secondaryFetched.has(tabId)) return;
      const tab = cfg.tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind === 'embed') return;
      const endpoint = (tab as RecordFieldsTab<T>).secondaryEndpoint;
      if (!endpoint) return;
      const id = this.route.snapshot.paramMap.get('id');
      if (!id) return;
      this.secondaryFetched.add(tabId);
      this.http.get(`${environment.apiBaseUrl}${endpoint(id)}`).subscribe({
        next: (data) => this.secondaryData.update((s) => ({ ...s, [tabId]: data })),
        error: () => this.secondaryData.update((s) => ({ ...s, [tabId]: null })),
      });
    });

    // An in-progress edit with changed values blocks Back / a breadcrumb link
    // until the user confirms. Comparing against the loaded row (rather than a
    // "touched" flag) means typing a value and typing it back is not dirty.
    const key = 'record-screen';
    this.dirty.register(key, () => {
      if (!this.isEditing()) return false;
      const original = this.row() as Record<string, unknown> | null;
      if (!original) return false;
      return Object.keys(this.formModel).some((k) => this.formModel[k] !== original[k]);
    });
    this.destroyRef.onDestroy(() => {
      this.dirty.clear(key);
      this.breadcrumbs.setRecordLabel(null);
    });
  }

  protected isEmbedTab(tab: RecordTab<T>): RecordEmbedTab | null {
    return tab.kind === 'embed' ? tab : null;
  }

  protected isComponentTab(tab: RecordTab<T>): RecordComponentTab | null {
    return tab.kind === 'component' ? tab : null;
  }

  protected componentInputs(tab: RecordComponentTab): Record<string, unknown> {
    return { [tab.idInputName]: this.route.snapshot.paramMap.get('id') ?? '' };
  }

  // Resolved once per tab and cached, keyed by tab id — RecordEmbedTab.config
  // may be a `(parentId) => ScreenConfig` factory (Documents' own list needs
  // the host record's real id to build its endpoint), and the template calls
  // this on every change-detection pass. Calling the factory fresh each time
  // would hand app-list-screen a NEW object identity constantly, which its
  // own `input.required<ListScreenConfig>()` would read as a changed config
  // and re-seed/refetch the list on every unrelated click on this page (e.g.
  // toggling Edit). The route id is read once from the snapshot, same as the
  // constructor's own load effect above — this component is recreated per
  // employee (a fresh :id is a fresh route, not an in-place param change).
  private readonly embedConfigCache = new Map<string, ScreenConfig>();

  protected embedConfig(tab: RecordEmbedTab): ScreenConfig {
    const cached = this.embedConfigCache.get(tab.id);
    if (cached) return cached;
    const resolved = typeof tab.config === 'function' ? tab.config(this.route.snapshot.paramMap.get('id') ?? '') : tab.config;
    this.embedConfigCache.set(tab.id, resolved);
    return resolved;
  }

  // Angular's template type-checker can't narrow a union from a method call
  // the way `isEmbedTab` above does for the 'embed' arm — this is the 'fields'
  // arm's equivalent, used only once isEmbedTab(tab) has already returned null.
  protected asFieldsTab(tab: RecordTab<T>): RecordFieldsTab<T> {
    return tab as RecordFieldsTab<T>;
  }

  protected canEdit(): boolean {
    const cfg = this.config();
    return !!cfg.edit && this.policy.can(cfg.id, cfg.edit.screenAction ?? 'edit');
  }

  protected visibleSecondaryActions(row: T): readonly RecordSecondaryActionDef<T>[] {
    const cfg = this.config();
    return (cfg.secondaryActions ?? []).filter(
      (a) => this.policy.can(cfg.id, a.screenAction) && (a.visible?.(row) ?? true),
    );
  }

  // Same auth-and-blob mechanism as list-screen.component.ts's exportAs() /
  // report-screen.component.ts's exportTable() — Bearer auth is header-only,
  // so a plain link/window.open would hit the API unauthenticated.
  protected runSecondary(act: RecordSecondaryActionDef<T>, row: T): void {
    if (act.confirm && !window.confirm(act.confirm)) return;
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.secondaryActionError.set(null);

    if (!act.download) {
      const url = `${environment.apiBaseUrl}${act.endpoint(id)}`;
      const req = act.method === 'DELETE' ? this.http.delete(url) : this.http.post(url, {});
      req.subscribe({
        // A DELETE's own navigateAfter goes somewhere real (the list this
        // record no longer belongs on) — reload() would just 404 fetching
        // a row that's gone. Every existing non-destructive action keeps
        // reloading in place exactly as before (navigateAfter unset).
        next: () => (act.navigateAfter ? this.router.navigate(act.navigateAfter as unknown[]) : this.reload()),
        error: (err) => this.secondaryActionError.set(this.formatError(err)),
      });
      return;
    }

    this.downloadingAction.set(act.label);
    const url = `${environment.apiBaseUrl}${act.endpoint(id)}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.downloadingAction.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `${act.label}.pdf`;
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
        this.downloadingAction.set(null);
        this.secondaryActionError.set(await this.resolveBlobError(err));
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
    return 'That download failed.';
  }

  // A 'mask'-mode field's current value is the server's placeholder string,
  // not real data — saving it back would overwrite the real value with that
  // placeholder. A 'hide'-mode field isn't even in `row()`. Neither is ever
  // safe to render as an editable input, regardless of what the config says.
  protected isFieldEditable(field: FieldConfig<T>): boolean {
    if (!field.editable) return false;
    const mode = this.policy.fieldMode(this.config().id, field.key);
    return mode !== 'mask' && mode !== 'hide';
  }

  protected selectOptions(field: FieldConfig<T>): { id: string; label: string }[] {
    if (field.staticOptions) return field.staticOptions.map((o) => ({ id: o.value, label: o.label }));
    return field.ref ? this.refData.options(field.ref) ?? [] : [];
  }

  protected startEdit(row: T): void {
    this.formModel = { ...(row as any) };
    this.saveError.set(null);
    this.isEditing.set(true);
  }

  protected cancelEdit(): void {
    this.isEditing.set(false);
    this.saveError.set(null);
  }

  /** Advisory only — the API stays the authority. Mirrors FormScreenComponent's
   * own fieldError, same "blank field = no error yet" rule. */
  protected fieldError(field: FieldConfig<T>): string | null {
    const raw = this.formModel[field.key];
    const value = raw === null || raw === undefined ? '' : String(raw);
    if (!value) return null;
    if (field.pattern && !field.pattern.re.test(value)) return field.pattern.message;
    return null;
  }

  protected save(): void {
    const cfg = this.config();
    if (!cfg.edit) return;
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    const editableFields = cfg.tabs.filter((t): t is RecordFieldsTab<T> => t.kind !== 'embed').flatMap((t) => t.sections.flatMap((s) => s.fields));
    const badFormat = editableFields.map((f) => (this.fieldError(f) ? `${f.label}: ${this.fieldError(f)}` : null)).filter(Boolean);
    if (badFormat.length) {
      this.saveError.set(badFormat.join(' '));
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.http.put<T>(`${environment.apiBaseUrl}${cfg.edit.saveEndpoint(id)}`, this.formModel).subscribe({
      next: (updated) => {
        this.row.set(updated);
        this.saving.set(false);
        this.isEditing.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return 'Failed to save changes.';
  }

  protected fieldValue(row: T, field: FieldConfig<T>, tabId?: string): unknown {
    const secondary = tabId ? this.secondaryData()[tabId] : undefined;
    const value = field.compute ? field.compute(row, secondary) : row[field.key];
    if (field.ref) return this.refData.label(field.ref, value as string | null | undefined);
    return value === null || value === undefined || value === '' ? '—' : value;
  }

  // Reloads the host record itself — used on first load AND after a
  // RecordActionDef fires successfully (Create Login/Disable Login/etc. all
  // change fields on the record, e.g. user_id, that the header/tabs read).
  protected reload(): void {
    const cfg = this.config();
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('No record id in the route.');
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    this.http.get<T>(`${environment.apiBaseUrl}${cfg.loadEndpoint(id)}`).subscribe({
      next: (data) => {
        this.row.set(data);
        this.isLoading.set(false);
        // The trail can only show ":id" until the record names itself.
        this.breadcrumbs.setRecordLabel(cfg.header.primary(data));
      },
      error: (err) => {
        this.error.set(err?.error?.detail ?? 'Failed to load this record.');
        this.isLoading.set(false);
      },
    });
    // An action may have changed the active tab's secondary resource too
    // (Create Login takes login-status from null to real) — force a refetch
    // rather than trusting whatever was cached before the action fired.
    this.secondaryFetched.clear();
  }

  protected canFireAction(action: RecordActionDef<T>): boolean {
    return this.policy.can(action.screenId ?? this.config().id, action.screenAction);
  }

  protected fireAction(action: RecordActionDef<T>, row: T): void {
    if (action.confirm && !window.confirm(action.confirm)) return;
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.actionError.set(null);
    this.actionInFlight.set(action.label);
    let url = `${environment.apiBaseUrl}${action.endpoint(id)}`;
    if (action.selectParam) {
      const sp = action.selectParam;
      const value = this.actionSelectValues[action.label] ?? sp.defaultValue ?? sp.options[0]?.value;
      if (value) url += (url.includes('?') ? '&' : '?') + `${sp.param}=${encodeURIComponent(value)}`;
    }
    const body = action.body ? action.body(row) : {};
    const req$ = action.method === 'DELETE' ? this.http.delete(url) : this.http.post(url, body);
    req$.subscribe({
      next: () => {
        this.actionInFlight.set(null);
        this.reload();
      },
      error: (err) => {
        this.actionInFlight.set(null);
        this.actionError.set(this.formatError(err));
      },
    });
  }
}
