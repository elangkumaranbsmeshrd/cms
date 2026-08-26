import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { BreadcrumbService } from '../../../core/navigation/breadcrumb.service';
import { DirtyStateService } from '../../../core/navigation/dirty-state.service';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { IconComponent } from '../../ui/icon.component';
import { EM_DASH, badgeClass, formatDate, formatMoney, humanizeEnum } from '../cell-format';
import { FileUploadService } from '../file-upload.service';
import { RefDataService } from '../ref-data.service';
import { ArrayColumnConfig, DocumentActionDef, DocumentScreenConfig, DocumentTotalRow, FieldConfig } from '../screen.types';

// ---------------------------------------------------------------------------
// The 'document' shape — the prototype's R.document (prototype/app-
// screens2.js:842-933), the printable-document layout Invoice and Purchase
// Bill detail screens use: a letterhead-style identity header, a body of
// real editable fields, an editable line-items table, a totals block, and a
// row of page actions (Save/Send/Download/Record Payment/…).
//
// Unlike RecordScreenConfig's tabs — read-only display with an Edit toggle —
// a document's own fields are genuinely editable inline, same rhythm as
// SingletonFormConfig: what you see is what Save persists, no separate view/
// edit mode. This is deliberate, not a simplification: the prototype's own
// document fields render as live <input>/<select> controls from the first
// paint (app-screens2.js:867-907), never as inert text waiting for an Edit
// click.
//
// DocumentScreenConfig/DocumentHeaderDef/DocumentLetterheadConfig/
// DocumentLineItemsConfig/DocumentTotalRow/DocumentActionDef all now live in
// screen.types.ts (merged by the integration pass) — imported from there
// rather than declared here, so this file has exactly one definition of each.
// ---------------------------------------------------------------------------

/** ARCH-3 §2's "most screens are a config object, not a component", applied
 * to the one shape whose body is a live, printable-looking document rather
 * than a table or a plain field grid. Loads its own row (route :id ->
 * loadEndpoint, same convention RecordScreenComponent uses), renders the
 * identity card + optional letterhead line + note + editable fields +
 * editable line-items table + totals block, and dispatches every configured
 * page action — including Save, which PUTs the whole form back to
 * `saveEndpoint`.
 */
@Component({
  selector: 'app-document-screen',
  standalone: true,
  imports: [FormsModule, IconComponent],
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
          @if (letterheadLine(); as lh) {
            <p class="page-sub">{{ lh }}</p>
          }
        </div>
      }
      <div class="page-actions">
        @for (act of visibleActions(); track act.label) {
          <button
            class="btn"
            [class.primary]="act.cls === 'primary'"
            type="button"
            [disabled]="saving() || (act.kind === 'download' && downloading())"
            (click)="runAction(act)"
          >
            @if (act.icon) {
              <app-icon [name]="act.icon" [size]="14" />
            }
            {{ act.kind === 'save' && saving() ? 'Saving…' : act.kind === 'download' && downloading() ? 'Downloading…' : act.label }}
          </button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this document</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (row(); as r) {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }

      <div class="rec-head">
        <div class="rec-avatar"><app-icon [name]="config().header.icon" [size]="20" /></div>
        <div style="min-width: 0;">
          <div class="rec-id">{{ config().header.recId(r) }}</div>
          <div class="rec-name">{{ config().header.name(r) }}</div>
          <div class="rec-meta">
            @for (m of metaItems(r); track $index) {
              @if ($index) {
                <span class="dot"></span>
              }
              <span>{{ m }}</span>
            }
            @if (badgeText(r); as b) {
              @if (metaItems(r).length) {
                <span class="dot"></span>
              }
              <span class="badge-s {{ badgeCls(b) }}">{{ b }}</span>
            }
          </div>
        </div>
        @if (summaryTiles(r).length) {
          <div class="rec-summary">
            @for (s of summaryTiles(r); track s.label) {
              <div class="s">
                <div class="l">{{ s.label }}</div>
                <div class="v num">{{ s.value }}</div>
              </div>
            }
          </div>
        }
      </div>

      @if (trustedNote(r); as note) {
        <div class="rbac-note">
          <app-icon name="info" [size]="14" />
          <div [innerHTML]="note"></div>
        </div>
      }

      <div class="card">
        <div class="card-body">
          <div class="form-section">
            <div class="grid g-2">
              @for (field of visibleFields(); track field.key) {
                <div class="field" [class.span-2]="field.span === 2 || field.type === 'textarea'">
                  <label>
                    {{ field.label }}
                    @if (field.required) {
                      <span class="req" aria-hidden="true">*</span>
                    }
                  </label>
                  @if (isLocked() || field.editable === false || (field.createOnly && !isCreateMode())) {
                    <div class="readonly-value">{{ fieldDisplay(field) }}</div>
                  } @else if (field.type === 'file') {
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                      @if (formModel[field.key]; as fid) {
                        <span class="badge-s b-ok">{{ fileNameFor(field) ?? 'Uploaded' }}</span>
                        <button class="btn sm ghost" type="button" (click)="viewFile(field)">View</button>
                        <button class="btn sm ghost" type="button" (click)="clearFile(field)">Remove</button>
                      } @else {
                        <span class="cell-sub">No file uploaded.</span>
                      }
                      <label class="btn sm ghost" [for]="'file-' + field.key" style="cursor: pointer; margin: 0;">
                        {{ isFileUploading(field) ? 'Uploading…' : formModel[field.key] ? 'Replace' : 'Upload' }}
                      </label>
                      <input
                        [id]="'file-' + field.key"
                        type="file"
                        style="display: none;"
                        [disabled]="isFileUploading(field)"
                        [attr.accept]="field.fileAccept ?? null"
                        (change)="onFileSelected($event, field)"
                      />
                    </div>
                  } @else if (field.type === 'select') {
                    <!-- aria-label, not just the sibling <label> above: proven
                         necessary in form-screen.component.ts by a real E2E
                         test — getByLabel(field.label, {exact:true}) found
                         zero matches because the label's computed accessible
                         name included the required-marker asterisk despite it
                         being aria-hidden. An explicit aria-label on the
                         control takes precedence over label content, so the
                         announced name is exactly field.label regardless. -->
                    <select class="input" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [(ngModel)]="formModel[field.key]">
                      <option [ngValue]="null">—</option>
                      @for (opt of selectOptions(field); track opt.id) {
                        <option [ngValue]="opt.id">{{ opt.label }}</option>
                      }
                    </select>
                  } @else if (field.type === 'checkbox') {
                    <!-- role/tabindex/aria-checked/keyboard handlers: a bare
                         <span> is untabbable and reports no on/off state to a
                         screen reader, not merely unnamed. aria-label rather
                         than aria-labelledby, since this component (unlike
                         form-screen.component.ts) has no labelId() helper —
                         field.label directly gives the same accessible name
                         without needing one. -->
                    <span
                      class="toggle"
                      role="switch"
                      tabindex="0"
                      [attr.aria-checked]="!!formModel[field.key]"
                      [attr.aria-label]="field.label"
                      [class.on]="!!formModel[field.key]"
                      (click)="formModel[field.key] = !formModel[field.key]"
                      (keydown.enter)="formModel[field.key] = !formModel[field.key]"
                      (keydown.space)="$event.preventDefault(); formModel[field.key] = !formModel[field.key]"
                    >
                      <span class="track"></span>
                    </span>
                  } @else if (field.type === 'checkgroup') {
                    <!-- Each box is already named by its own wrapping <label>;
                         role="group" + aria-label names the SET, which the
                         outer field <label> above did not (no id to point an
                         aria-labelledby at here). -->
                    <div role="group" [attr.aria-label]="field.label" style="display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px;">
                      @for (opt of selectOptions(field); track opt.id) {
                        <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer;">
                          <input type="checkbox" [checked]="inCheckGroup(field, opt.id)" (change)="toggleCheckGroup(field, opt.id)" />
                          {{ opt.label }}
                        </label>
                      }
                    </div>
                  } @else if (field.type === 'textarea') {
                    <textarea class="input" rows="3" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [placeholder]="field.placeholder ?? ''" [(ngModel)]="formModel[field.key]"></textarea>
                  } @else {
                    <input class="input" [type]="inputType(field)" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [placeholder]="field.placeholder ?? ''" [(ngModel)]="formModel[field.key]" />
                  }
                  @if (fileErrorFor(field)) {
                    <div class="hint" style="color: var(--danger);">{{ fileErrorFor(field) }}</div>
                  } @else if (field.hint) {
                    <div class="hint">{{ field.hint }}</div>
                  }
                </div>
              }
            </div>
          </div>

          <div class="form-section">
            <div class="form-section-head">
              <h4>Line Items</h4>
              <span class="note">{{ lineItemRows().length }} item{{ lineItemRows().length === 1 ? '' : 's' }}</span>
            </div>
            <!-- Focusable ONLY while locked. An editable line-item grid is
                 full of inputs, selects and remove buttons, so a keyboard user
                 already tabs into .table-wrap and drags its horizontal scroll
                 (components.css:242) along with them; a locked document renders
                 those same cells as plain text and the wrap is left with no tab
                 stop at all — the unreachable scroller axe's
                 scrollable-region-focusable (WCAG 2.1.1/2.1.3) flags. Binding
                 the attribute rather than hard-coding it keeps a dead tab stop
                 from being planted in front of the editable grid. -->
            <div
              class="table-wrap"
              [attr.tabindex]="isLocked() ? 0 : null"
              [attr.role]="isLocked() ? 'region' : null"
              [attr.aria-label]="isLocked() ? 'Line items' : null"
            >
              <table class="lineitems">
                <thead>
                  <tr>
                    @for (col of config().lineItems.columns; track col.key) {
                      <th>{{ col.label }}</th>
                    }
                    <th>Line Total</th>
                    @if (!isLocked()) {
                      <th></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (item of lineItemRows(); track $index) {
                    <tr>
                      @for (col of config().lineItems.columns; track col.key) {
                        <td>
                          @if (isLocked()) {
                            {{ lineItemCellDisplay(col, item) }}
                          } @else if (col.type === 'select') {
                            <!-- aria-label = the COLUMN name, per-row: a <th>
                                 only names a cell for a sighted reader, and no
                                 per-row <label> can exist here without id
                                 collisions across repeated rows — same pattern
                                 form-screen.component.ts's own array-field
                                 table already uses. -->
                            <select class="input" [attr.aria-label]="col.label" [(ngModel)]="item[col.key]">
                              <option [value]="null">—</option>
                              @for (opt of arrayColumnOptions(col); track opt.value) {
                                <option [value]="opt.value">{{ opt.label }}</option>
                              }
                            </select>
                          } @else if (col.type === 'checkbox') {
                            <span
                              class="toggle"
                              role="switch"
                              tabindex="0"
                              [attr.aria-checked]="!!item[col.key]"
                              [attr.aria-label]="col.label"
                              [class.on]="!!item[col.key]"
                              (click)="item[col.key] = !item[col.key]"
                              (keydown.enter)="item[col.key] = !item[col.key]"
                              (keydown.space)="$event.preventDefault(); item[col.key] = !item[col.key]"
                            >
                              <span class="track"></span>
                            </span>
                          } @else {
                            <input
                              class="input"
                              [type]="col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'"
                              [attr.aria-label]="col.label"
                              [(ngModel)]="item[col.key]"
                            />
                          }
                        </td>
                      }
                      <td class="num cell-strong">{{ formatLineTotal(item) }}</td>
                      @if (!isLocked()) {
                        <td>
                          <button class="btn sm ghost" type="button" (click)="removeLineItem($index)">
                            <app-icon name="trash" [size]="13" />
                          </button>
                        </td>
                      }
                    </tr>
                  }
                  @if (lineItemRows().length === 0) {
                    <tr>
                      <td [attr.colspan]="config().lineItems.columns.length + (isLocked() ? 1 : 2)" class="cell-sub">No line items yet.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!isLocked()) {
              <div style="margin-top: 10px;">
                <button class="btn" type="button" (click)="addLineItem()">
                  <app-icon name="plus" [size]="14" />Add Line Item
                </button>
              </div>
            }
            <div style="display: flex; margin-top: 14px;">
              <div class="totals">
                @for (t of totalsRows(r); track t.label) {
                  <div class="tr" [class.emph]="t.emphasize">
                    <span>{{ t.label }}</span>
                    <b>{{ t.value }}</b>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
      }
    }
  `,
})
export class DocumentScreenComponent<T = any> {
  readonly config = input.required<DocumentScreenConfig<T>>();
  /** True when rendered as a tab body — suppresses this component's own page
   * title/description, matching ListScreenComponent's/SingletonFormComponent's
   * own `embedded` input (screen.types.ts's TabDef can host any shape). */
  readonly embedded = input(false);

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly dirty = inject(DirtyStateService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly policy = inject(PolicyStore);

  protected readonly row = signal<T | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly downloading = signal(false);
  private readonly letterheadRow = signal<Record<string, unknown> | null>(null);

  // ---- 'file' fields — ported from form-screen.component.ts's own copy of
  // this exact block (singleton-form.component.ts carries a third copy).
  // Keyed by field.key and kept separate from formModel (which only ever
  // holds the saved file id), same reasoning as those two originals.
  protected readonly fileUploading = signal<Record<string, boolean>>({});
  private readonly fileErrorsState = signal<Record<string, string | null>>({});
  private readonly fileNames = signal<Record<string, string>>({});

  // Plain mutable object, not a signal — [(ngModel)] needs a real assignable
  // target. Seeded from a full shallow copy of the loaded row (every key,
  // not just the editable ones) for the same reason RecordScreenComponent's
  // own formModel does: the real update_* endpoints set every field on the
  // Write schema, so omitting a key on save would silently null it out
  // server-side rather than just leaving it alone.
  protected formModel: Record<string, unknown> = {};
  private pristine: Record<string, unknown> = {};

  constructor() {
    // Reacts to config() (the input signal) exactly like RecordScreenComponent's
    // own constructor — a config change re-triggers the load; the :id itself is
    // still read imperatively off route.snapshot, matching that same file.
    effect(() => {
      this.config();
      this.reload();
    });

    let letterheadFetched = false;
    effect(() => {
      const cfg = this.config().letterhead;
      if (!cfg || letterheadFetched) return;
      letterheadFetched = true;
      this.http.get<Record<string, unknown> | null>(`${environment.apiBaseUrl}${cfg.endpoint}`).subscribe({
        next: (data) => this.letterheadRow.set(data ?? null),
        // A role that can't open masters.company_profile, or a profile not
        // yet set up (GET returns null) — either way the line just doesn't
        // render, same fallback TabbedScreenComponent's headerEndpoint uses.
        error: () => this.letterheadRow.set(null),
      });
    });

    const key = 'document-screen';
    this.dirty.register(key, () => {
      if (this.saving() || this.isLocked()) return false;
      const keys = new Set([...Object.keys(this.pristine), ...Object.keys(this.formModel)]);
      for (const k of keys) {
        const a = this.formModel[k];
        const b = this.pristine[k];
        // The line-items array is compared by value — typing a quantity and
        // undoing it must not stay "dirty", same rule FormScreenComponent's
        // own arrayFields comparison uses.
        if (Array.isArray(a) || Array.isArray(b)) {
          if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) return true;
          continue;
        }
        if ((a ?? '') !== (b ?? '')) return true;
      }
      return false;
    });
    this.destroyRef.onDestroy(() => {
      this.dirty.clear(key);
      this.breadcrumbs.setRecordLabel(null);
    });
  }

  /** True when this route has no :id — DocumentScreenConfig.createEndpoint's
   * own create mode, the identical convention FormScreenComponent.isEdit()
   * uses (inverted). */
  protected isCreateMode(): boolean {
    return !this.route.snapshot.paramMap.get('id');
  }

  /** Loads (or reloads) the current route's document — or, with no :id and a
   * configured createEndpoint, seeds a brand-new one from emptyRow() instead
   * of fetching (mirrors FormScreenComponent's own create-vs-edit branch).
   * Also used after an 'endpoint'-kind action succeeds (e.g. a
   * status-changing POST) while editing, so the screen reflects the server's
   * own resulting state rather than a guess. */
  protected reload(): void {
    const cfg = this.config();
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      if (!cfg.createEndpoint) {
        this.loadError.set('No record id in the route.');
        this.isLoading.set(false);
        return;
      }
      const queryParams: Record<string, string> = {};
      for (const key of this.route.snapshot.queryParamMap.keys) {
        queryParams[key] = this.route.snapshot.queryParamMap.get(key) ?? '';
      }
      const seeded = (cfg.emptyRow?.(queryParams) ?? {}) as T;
      this.row.set(seeded);
      this.formModel = { ...(seeded as any) };
      this.pristine = { ...this.formModel };
      this.isLoading.set(false);
      this.loadError.set(null);
      return;
    }
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<T>(`${environment.apiBaseUrl}${cfg.loadEndpoint(id)}`).subscribe({
      next: (data) => {
        this.row.set(data);
        this.formModel = { ...(data as any) };
        this.pristine = { ...this.formModel };
        this.isLoading.set(false);
        this.breadcrumbs.setRecordLabel(cfg.header.name(data));
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load this document.');
        this.isLoading.set(false);
      },
    });
  }

  // ---- header -------------------------------------------------------------

  protected metaItems(row: T): string[] {
    return (this.config().header.meta?.(row) ?? []).filter((m) => !!m && m !== EM_DASH);
  }

  protected badgeText(row: T): string | null {
    return this.config().header.badge?.(row) ?? null;
  }

  protected summaryTiles(row: T): readonly { label: string; value: string }[] {
    return this.config().header.summary?.(row) ?? [];
  }

  protected badgeCls(value: string): string {
    return badgeClass(value);
  }

  protected letterheadLine(): string | null {
    const cfg = this.config().letterhead;
    const data = this.letterheadRow();
    if (!cfg || !data) return null;
    const parts: string[] = [];
    cfg.fields.forEach((f, i) => {
      const v = data[f.key];
      if (v === null || v === undefined || v === '') return;
      // The first configured field is assumed to be the company's own name
      // (legal_name) and reads bare; every field after it is labelled, so
      // the line reads "Meshrd Technologies Pvt Ltd · GSTIN 27ABC…" rather
      // than a wall of unlabelled values.
      parts.push(i === 0 ? String(v) : `${f.label} ${v}`);
    });
    return parts.length ? parts.join(' · ') : null;
  }

  /** Config-authored copy only (DocumentScreenConfig.note is a function a
   * screen author writes in TypeScript source, never user or API data) —
   * the same trust boundary IconComponent's own bypassSecurityTrustHtml
   * already relies on for its frozen icon-path map. The prototype's own
   * U.note() calls carry inline `<b>` for emphasis (app-screens2.js:926-927)
   * and this preserves that instead of flattening it to plain text. */
  protected trustedNote(row: T): SafeHtml | null {
    const raw = this.config().note?.(row) ?? null;
    return raw ? this.sanitizer.bypassSecurityTrustHtml(raw) : null;
  }

  // ---- fields ---------------------------------------------------------

  protected isLocked(): boolean {
    const r = this.row();
    if (!r) return true;
    return this.config().locked?.(r) ?? false;
  }

  /** Progressive disclosure, same rule the 'form'/'singleton' shapes use — a
   * hidden field is neither shown nor submitted. */
  protected visibleFields(): FieldConfig<T>[] {
    return this.config().fields.filter((f) => f.visibleWhen?.(this.formModel) ?? true);
  }

  protected selectOptions(field: FieldConfig<T>): { id: string; label: string }[] {
    if (field.staticOptions) return field.staticOptions.map((o) => ({ id: o.value, label: o.label }));
    return field.ref ? (this.refData.options(field.ref) ?? []) : [];
  }

  protected inCheckGroup(field: FieldConfig<T>, value: string): boolean {
    const cur = this.formModel[field.key];
    return Array.isArray(cur) && cur.includes(value);
  }

  protected toggleCheckGroup(field: FieldConfig<T>, value: string): void {
    const cur = this.formModel[field.key];
    const list = Array.isArray(cur) ? [...cur] : [];
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
    this.formModel[field.key] = list;
  }

  protected inputType(field: FieldConfig<T>): string {
    switch (field.type) {
      case 'date':
        return 'date';
      case 'number':
        return 'number';
      case 'password':
        return 'password';
      case 'email':
        return 'email';
      default:
        return 'text';
    }
  }

  /** A locked or non-editable (FieldConfig.editable === false) field shows
   * plain resolved text instead of a disabled-looking input — same
   * `.readonly-value` treatment FormScreenComponent's createOnly fields get,
   * and the same label-resolution order: static option, then a Masters ref
   * lookup, then a humanized enum fallback. */
  protected fieldDisplay(field: FieldConfig<T>): string {
    const raw = this.formModel[field.key];
    if (raw === null || raw === undefined || raw === '') return EM_DASH;
    if (field.type === 'date') return formatDate(raw);
    const value = String(raw);
    const fromStatic = field.staticOptions?.find((o) => o.value === value)?.label;
    if (fromStatic) return fromStatic;
    if (field.ref) {
      const label = this.refData.label(field.ref, value);
      if (label) return String(label);
    }
    return humanizeEnum(value);
  }

  // ---- 'file' fields ------------------------------------------------------
  // Verbatim port of form-screen.component.ts's own implementation (see that
  // file's identical block for the full rationale) — added because this
  // shared component had NO 'file' branch at all: a type:'file' field fell
  // through to the generic `<input [type]="inputType(field)">` default,
  // whose inputType() has no 'file' case either, so it silently rendered a
  // plain text box directly bound to the stored-file-id column. That let a
  // user hand-type an arbitrary string into `attachment_stored_file_id`
  // instead of ever uploading a real file — a genuine functional gap, not a
  // cosmetic one, first hit by Purchase Bill's own Attachment field (the
  // first 'document'-shape config to declare a 'file' field at all; Invoice
  // has no attachment field on its own document).

  protected isFileUploading(field: FieldConfig<T>): boolean {
    return !!this.fileUploading()[field.key];
  }

  protected fileErrorFor(field: FieldConfig<T>): string | null {
    return this.fileErrorsState()[field.key] ?? null;
  }

  protected fileNameFor(field: FieldConfig<T>): string | null {
    return this.fileNames()[field.key] ?? null;
  }

  protected onFileSelected(event: Event, field: FieldConfig<T>): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // lets the same file be re-picked after a Replace
    if (!file) return;
    this.fileUploading.update((m) => ({ ...m, [field.key]: true }));
    this.fileErrorsState.update((m) => ({ ...m, [field.key]: null }));
    this.fileUpload.upload(file, field.uploadPurpose ?? 'generic').subscribe({
      next: (res) => {
        this.fileUploading.update((m) => ({ ...m, [field.key]: false }));
        this.fileNames.update((m) => ({ ...m, [field.key]: res.original_filename }));
        this.formModel[field.key] = res.id;
      },
      error: (err) => {
        this.fileUploading.update((m) => ({ ...m, [field.key]: false }));
        this.fileErrorsState.update((m) => ({ ...m, [field.key]: this.formatError(err, 'That file could not be uploaded.') }));
      },
    });
  }

  protected viewFile(field: FieldConfig<T>): void {
    const id = this.formModel[field.key];
    if (typeof id !== 'string' || !id) return;
    this.fileUpload.fetch(id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.fileErrorsState.update((m) => ({ ...m, [field.key]: 'Could not open that file.' })),
    });
  }

  protected clearFile(field: FieldConfig<T>): void {
    this.formModel[field.key] = null;
    this.fileNames.update((m) => ({ ...m, [field.key]: '' }));
    this.fileErrorsState.update((m) => ({ ...m, [field.key]: null }));
  }

  // ---- line items -----------------------------------------------------

  // formModel[key] starts undefined for a genuinely empty array (the same
  // gap FormScreenComponent's own arrayItems() normalises) — fixed up on
  // first read so the template and the mutating methods below never have to
  // null-check it.
  protected lineItemRows(): Record<string, unknown>[] {
    const key = this.config().lineItems.key as string;
    if (!Array.isArray(this.formModel[key])) this.formModel[key] = [];
    return this.formModel[key] as Record<string, unknown>[];
  }

  protected addLineItem(): void {
    this.lineItemRows().push(this.config().lineItems.emptyItem());
  }

  protected removeLineItem(index: number): void {
    this.lineItemRows().splice(index, 1);
  }

  protected formatLineTotal(item: Record<string, unknown>): string {
    return formatMoney(this.config().lineItems.lineTotal(item));
  }

  // ---- totals -----------------------------------------------------------

  protected totalsRows(row: T): readonly DocumentTotalRow[] {
    return this.config().totals(row, this.lineItemRows());
  }

  // ---- actions ------------------------------------------------------------

  /** Create mode shows ONLY the 'save' action, regardless of what `visible`
   * or the RBAC gate would otherwise allow — every other kind ('route' to
   * Record Payment/Raise Credit Note, 'endpoint' like Send, 'download' like
   * the PDF) targets a URL built from the row's own :id
   * (`action.route?.(r)`/`action.endpoint?.(r)`), which does not exist yet
   * for an unsaved document. Without this guard, a `visible` callback that
   * merely reads a status field (e.g. Send's `r.status === 'DRAFT'`) can
   * read true against emptyRow()'s own seeded defaults and show a button
   * whose target 404s. */
  protected visibleActions(): DocumentActionDef<T>[] {
    const r = this.row();
    if (!r) return [];
    if (this.isCreateMode()) {
      return this.config().actions.filter((a) => a.kind === 'save' && this.policy.can(a.screenId ?? this.config().id, a.screenAction));
    }
    return this.config().actions.filter((a) => this.policy.can(a.screenId ?? this.config().id, a.screenAction) && (a.visible?.(r) ?? true));
  }

  protected runAction(action: DocumentActionDef<T>): void {
    const r = this.row();
    if (!r) return;
    if (action.kind === 'save') {
      this.save();
      return;
    }
    if (action.confirm && !window.confirm(action.confirm)) return;
    if (action.kind === 'route') {
      const target = action.route?.(r);
      if (target) this.router.navigate(target as any[]);
      return;
    }
    if (action.kind === 'download') {
      const url = action.endpoint?.(r);
      if (url) this.downloadDocument(url);
      return;
    }
    // 'endpoint' — a no-body POST that reloads the document afterwards,
    // exactly like ListScreenComponent's own runSecondary().
    const url = action.endpoint?.(r);
    if (!url) return;
    this.actionError.set(null);
    this.http.post(`${environment.apiBaseUrl}${url}`, {}).subscribe({
      next: () => this.reload(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'That action failed.'),
    });
  }

  // Same auth-and-blob mechanism as list-screen.component.ts's exportAs() /
  // report-screen.component.ts's exportTable() — Bearer auth is
  // header-only (auth.interceptor.ts), so a plain <a href>/window.open would
  // hit the API unauthenticated.
  private downloadDocument(path: string): void {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.actionError.set(null);
    this.http.get(`${environment.apiBaseUrl}${path}`, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.downloading.set(false);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? 'document.pdf';
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
        this.downloading.set(false);
        this.actionError.set(await this.resolveBlobError(err));
      },
    });
  }

  // With responseType: 'blob', HttpClient blob-wraps error bodies too — a
  // failed download's JSON {detail: "..."} arrives as err.error being a
  // Blob, not the parsed object err?.error?.detail reads elsewhere in this
  // file. Same helper as list-screen.component.ts/report-screen.component.ts.
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

  protected save(): void {
    const cfg = this.config();
    const id = this.route.snapshot.paramMap.get('id');
    const isCreate = !id;
    if (isCreate ? !cfg.createEndpoint : !cfg.saveEndpoint) return;

    // A field hidden by `visibleWhen` must not be submitted — a value typed
    // before the field was hidden must not silently reach the API, same
    // rule FormScreenComponent's own save() enforces.
    const hidden = new Set<string>(cfg.fields.filter((f) => !(f.visibleWhen?.(this.formModel) ?? true)).map((f) => f.key as string));
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.formModel)) {
      if (hidden.has(k)) continue;
      // Belt-and-braces: a <select> that round-trips through the DOM can
      // hand back the string "null"/"undefined" instead of a real null.
      body[k] = v === 'null' || v === 'undefined' || v === '' ? null : v;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const req$ = isCreate
      ? this.http.post<T>(`${environment.apiBaseUrl}${cfg.createEndpoint}`, body)
      : this.http.put<T>(`${environment.apiBaseUrl}${cfg.saveEndpoint!(id!)}`, body);
    req$.subscribe({
      next: (data) => {
        this.row.set(data);
        this.formModel = { ...(data as any) };
        this.pristine = { ...this.formModel };
        this.saving.set(false);
        // Only the CREATE branch navigates — an edit save stays on the same
        // :id route, matching FormScreenComponent's own onCreateSuccess,
        // which is likewise never consulted on an edit save.
        if (isCreate) {
          const target = cfg.recordRoute?.(data);
          if (target) this.router.navigate(target as any[]);
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(this.formatError(err));
      },
    });
  }

  // ---- line items: option resolution + locked-mode display ---------------

  /** A 'select' array column's <option> list — same source order as
   * FieldConfig's own selectOptions(): a fixed staticOptions list first,
   * then a Masters `ref` lookup (ArrayColumnConfig.ref, e.g. Invoice line
   * items' HSN/SAC code). */
  protected arrayColumnOptions(col: ArrayColumnConfig): { value: string; label: string }[] {
    if (col.staticOptions) return col.staticOptions.map((o) => ({ value: o.value, label: o.label }));
    if (col.ref) return (this.refData.options(col.ref) ?? []).map((o) => ({ value: o.id, label: o.label }));
    return [];
  }

  /** A locked line item shows plain resolved text — the same label-
   * resolution order as fieldDisplay() above, applied per array-column
   * instead of per-field. Without this a locked (Paid) invoice's HSN/SAC
   * column printed the raw hsn_code_id UUID instead of the code. */
  protected lineItemCellDisplay(col: ArrayColumnConfig, item: Record<string, unknown>): string {
    const raw = item[col.key];
    if (raw === null || raw === undefined || raw === '') return EM_DASH;
    const value = String(raw);
    const fromStatic = col.staticOptions?.find((o) => o.value === value)?.label;
    if (fromStatic) return fromStatic;
    if (col.ref) {
      const label = this.refData.label(col.ref, value);
      if (label) return String(label);
    }
    return value;
  }

  // `fallback` defaults to the original message, so the existing single-arg
  // call site (save()'s own error handler) is unchanged — added only so
  // onFileSelected() above can report a fallback that actually names what
  // failed, matching form-screen.component.ts's own identical two-arg
  // formatError().
  private formatError(err: unknown, fallback = 'Failed to save changes.'): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
