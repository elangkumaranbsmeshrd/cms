import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { BreadcrumbService } from '../../../core/navigation/breadcrumb.service';
import { DirtyStateService } from '../../../core/navigation/dirty-state.service';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { ArrayFieldConfig, FieldConfig, FormScreenConfig } from '../screen.types';
import { formatDate, humanizeEnum } from '../cell-format';
import { RefDataService } from '../ref-data.service';
import { FileUploadService } from '../file-upload.service';

/** Bumped once per FormScreenComponent construction, so every instance gets a
 * distinct id namespace for its controls. Module-level (not a static) purely
 * so it can't be reset by anything; it only ever has to be unique within one
 * loaded page. */
let formScreenInstanceSeq = 0;

/** The 'form' shape — one component for every screen with no GET-by-id
 * endpoint to back a 'record' route (the 15 simple Masters lookups today).
 * Doubles as create AND edit: no :id route param means create mode
 * (formModel starts from config.emptyRow()); an :id param means edit mode,
 * and the row is found in a fresh fetch of the WHOLE list (listEndpoint)
 * rather than a dedicated read — matching what the real backend actually
 * offers (masters_lookup.py has no GET /{id} at all).
 */
@Component({
  selector: 'app-form-screen',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <!-- Never "Edit X" when nothing on this record is writable — that
             heading is a promise the screen doesn't keep. -->
        <h1 class="page-title">{{ isEdit() ? (isReadOnlyRecord() ? 'View' : 'Edit') : 'Add' }} {{ config().title }}</h1>
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load this record</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      <div class="card">
        <div class="card-body">
          <div class="grid g-2">
            @for (field of visibleFields(); track field.key; let i = $index) {
              @if (field.section && (i === 0 || field.section !== visibleFields()[i - 1].section)) {
                <div class="form-section-head" style="grid-column: span 2;">
                  <h4>{{ field.section }}</h4>
                </div>
              }
              <div class="field" [class.span-2]="field.span === 2 || field.type === 'textarea'">
                <!-- [attr.for] is null, not omitted, for the shapes below that
                     render no labelable control at all (a read-only <div>, the
                     custom toggle <span>, a checkgroup of several boxes) —
                     a "for" pointing at a non-labelable element is worse than
                     none, because a screen reader follows it and finds nothing
                     to name. Those three get aria-labelledby off labelId()
                     instead, which is why the <label> always carries an id. -->
                <!-- select/textarea/input below carry their OWN [attr.aria-label]
                     set to the plain field.label, rather than relying on this
                     <label>'s content plus aria-hidden on the asterisk. Proven
                     wrong by a real E2E test: getByLabel('Department', {exact:
                     true}) found zero matches even though the asterisk span is
                     correctly aria-hidden — the accessible name computed from
                     this label's content included the "*" anyway, since
                     "exclude aria-hidden descendants from name-from-content"
                     is inconsistently honoured for a for-associated <label> in
                     practice. An explicit aria-label on the control itself
                     takes precedence over label-for content in the accessible
                     name computation, so the announced name is exactly
                     field.label regardless of that inconsistency — the visual
                     asterisk stays for sighted users, required-ness is
                     conveyed separately via aria-required, and the for/id
                     association is kept for click-to-focus. -->
                <label [id]="labelId(field)" [attr.for]="labelTargetId(field)">
                  {{ field.label }}
                  @if (field.required) {
                    <span class="req" aria-hidden="true">*</span>
                  }
                </label>
                @if ((field.createOnly && isEdit()) || isReadOnlyRecord()) {
                  <!-- Two independent reasons a field renders as plain text,
                       not an input: createOnly is a PER-FIELD rule (frozen
                       after creation regardless of the record's own state —
                       Number Prefix Rule's code_type); isReadOnlyRecord() is
                       a PER-RECORD rule (nothing here is editable right now
                       — a locked Financial Year, Invariant 4). Before this,
                       removing createOnly from a field that becomes editable
                       only sometimes (Financial Year's start_date/end_date
                       once a real updateEndpoint existed) left it rendering
                       as a live, typeable <input> even while the record was
                       locked and Save was hidden — technically harmless
                       (save() and the backend both still reject it) but
                       visually lying about what "View" means. -->
                  <div class="readonly-value">{{ readOnlyDisplay(field) }}</div>
                } @else if (field.type === 'file') {
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    @if (formModel[field.key]; as fid) {
                      <span class="badge-s b-ok">{{ fileNameFor(field) ?? 'Uploaded' }}</span>
                      <button class="btn sm ghost" type="button" (click)="viewFile(field)">View</button>
                      <button class="btn sm ghost" type="button" (click)="clearFile(field)">Remove</button>
                    } @else {
                      <span class="cell-sub">No file uploaded.</span>
                    }
                    <label class="btn sm ghost" [for]="controlId(field)" style="cursor: pointer; margin: 0;">
                      {{ isFileUploading(field) ? 'Uploading…' : formModel[field.key] ? 'Replace' : 'Upload' }}
                    </label>
                    <input
                      [id]="controlId(field)"
                      type="file"
                      style="display: none;"
                      [disabled]="isFileUploading(field)"
                      [attr.accept]="field.fileAccept ?? null"
                      (change)="onFileSelected($event, field)"
                    />
                  </div>
                } @else if (field.type === 'select') {
                  <!-- [ngValue], not [value]: a plain [value] binding round-trips
                       through the DOM as a string, so picking the "—" option
                       wrote the literal text "null" into the model and sent it
                       to the API as a 4-character string instead of clearing
                       the field. -->
                  <select class="input" [id]="controlId(field)" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [(ngModel)]="formModel[field.key]">
                    <option [ngValue]="null">—</option>
                    @for (opt of selectOptions(field); track opt.id) {
                      <option [ngValue]="opt.id">{{ opt.label }}</option>
                    }
                  </select>
                } @else if (field.type === 'checkbox') {
                  <!-- A <span> can't be a <label for>'s target, can't be tabbed
                       to, and reports no on/off state — so this control was
                       completely invisible to a keyboard or a screen reader,
                       not merely unnamed. role/aria-checked/tabindex give it
                       the switch semantics its appearance already implies, and
                       Space/Enter mirror the existing click handler. -->
                  <span
                    class="toggle"
                    role="switch"
                    tabindex="0"
                    [id]="controlId(field)"
                    [attr.aria-checked]="!!formModel[field.key]"
                    [attr.aria-labelledby]="labelId(field)"
                    [class.on]="!!formModel[field.key]"
                    (click)="formModel[field.key] = !formModel[field.key]"
                    (keydown.enter)="formModel[field.key] = !formModel[field.key]"
                    (keydown.space)="$event.preventDefault(); formModel[field.key] = !formModel[field.key]"
                  >
                    <span class="track"></span>
                  </span>
                } @else if (field.type === 'checkgroup') {
                  <!-- Each box inside is already named by its own wrapping
                       <label>; what was missing is the name of the SET, which
                       is what the field's own <label> holds. -->
                  <div
                    role="group"
                    [id]="controlId(field)"
                    [attr.aria-labelledby]="labelId(field)"
                    style="display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px;"
                  >
                    @for (opt of selectOptions(field); track opt.id) {
                      <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer;">
                        <input type="checkbox" [checked]="inCheckGroup(field, opt.id)" (change)="toggleCheckGroup(field, opt.id)" />
                        {{ opt.label }}
                      </label>
                    }
                  </div>
                } @else if (field.type === 'textarea') {
                  <textarea class="input" rows="3" [id]="controlId(field)" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [placeholder]="field.placeholder ?? ''" [(ngModel)]="formModel[field.key]"></textarea>
                } @else {
                  <input
                    class="input"
                    [id]="controlId(field)"
                    [type]="inputType(field)"
                    [attr.aria-label]="field.label"
                    [attr.aria-required]="field.required ? 'true' : null"
                    [placeholder]="field.placeholder ?? ''"
                    [(ngModel)]="formModel[field.key]"
                  />
                }
                @if (fieldError(field); as err) {
                  <div class="hint" style="color: var(--danger);">{{ err }}</div>
                } @else if (fileErrorFor(field)) {
                  <div class="hint" style="color: var(--danger);">{{ fileErrorFor(field) }}</div>
                } @else if (field.hint) {
                  <!-- The prototype puts a hint under nearly every input (its
                       field objects carry a hint string); these were dropped
                       entirely, which is most of why these forms read as bare
                       boxes beside the prototype's. -->
                  <div class="hint">{{ field.hint }}</div>
                }
              </div>
            }
          </div>
        @if (config().previewFields; as previews) {
          <div class="form-section-head">
            <h4>Derived automatically — shown as a preview before saving</h4>
          </div>
          <div class="grid g-2">
            @for (p of previews; track p.label) {
              <div class="field">
                <label>{{ p.label }}</label>
                <!-- .readonly-value, not .input: these are DERIVED and can never
                     be typed into, so they must not look like empty inputs
                     waiting for a value. -->
                <div class="readonly-value">{{ p.compute($any(formModel)) }}</div>
              </div>
            }
          </div>
        }
        @for (arr of config().arrayFields ?? []; track arr.key) {
          <div class="form-section-head">
            <h4>{{ arr.label }}</h4>
            <button class="btn sm ghost" type="button" (click)="addArrayItem(arr)">+ Add Row</button>
          </div>
          <div class="table-wrap" style="margin-bottom: 16px;">
            <table>
              <thead>
                <tr>
                  @for (col of arr.columns; track col.key) {
                    <th>{{ col.label }}</th>
                  }
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (item of arrayItems(arr); track $index) {
                  <tr>
                    @for (col of arr.columns; track col.key) {
                      <td>
                        <!-- A <th> only names a cell for a SIGHTED reader
                             scanning the column; the control itself still needs
                             its own name, and no <label> can be added inside a
                             grid of repeated rows without colliding ids. -->
                        @if (col.type === 'select') {
                          <select class="input" [attr.aria-label]="col.label" [(ngModel)]="item[col.key]">
                            <option [value]="null">—</option>
                            @for (opt of col.staticOptions ?? []; track opt.value) {
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
                            [attr.aria-label]="col.label"
                            [type]="col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'"
                            [(ngModel)]="item[col.key]"
                          />
                        }
                      </td>
                    }
                    <td><button class="btn sm ghost" type="button" (click)="removeArrayItem(arr, $index)">Remove</button></td>
                  </tr>
                }
                @if (arrayItems(arr).length === 0) {
                  <tr><td [attr.colspan]="arr.columns.length + 1" class="cell-sub">No rows yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (isEdit() && config().recordActions; as actions) {
          <div class="form-section-head">
            <h4>More</h4>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
            @for (action of actions; track action.label) {
              <button class="btn sm ghost" type="button" (click)="navigate(action.routeFor(recordId()))">
                {{ action.label }}{{ recordActionCount(action) }}
              </button>
            }
          </div>
        }
        </div>
        <div class="card-foot">
          @if (isReadOnlyRecord()) {
            <span class="hint" style="margin-right: auto;">
              Nothing on this record can be changed here — its status moves through the list's own actions instead.
            </span>
            <button class="btn ghost" type="button" (click)="cancel()">Close</button>
          } @else {
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class FormScreenComponent<T = any> {
  readonly config = input.required<FormScreenConfig<T>>();
  /** Per-INSTANCE, not per-field: `field.key` alone is only unique within one
   * form, and this component is rendered more than once on a single page (a
   * tabbed record shows a form per tab, all in the DOM together). Two elements
   * sharing an id makes every `<label for>` on the page resolve to whichever
   * one the browser happens to find first, which is a subtler failure than
   * having no label at all. */
  private readonly instanceId = `fs${++formScreenInstanceSeq}`;
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);
  private readonly dirty = inject(DirtyStateService);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fileUpload = inject(FileUploadService);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected formModel: Record<string, unknown> = {};

  // ---- 'file' fields — see singleton-form.component.ts's own copy of this
  // block for why these are keyed by field.key and kept separate from
  // formModel (which only ever holds the saved file id).
  protected readonly fileUploading = signal<Record<string, boolean>>({});
  private readonly fileErrorsState = signal<Record<string, string | null>>({});
  private readonly fileNames = signal<Record<string, string>>({});
  /** The values as loaded (edit) or as seeded (create). Dirty means "differs
   * from this", so typing a value and undoing it stops being dirty. */
  private pristine: Record<string, unknown> = {};
  /** Set on a successful save so navigating away afterwards never prompts. */
  private saved = false;

  protected isEdit(): boolean {
    return !!this.route.snapshot.paramMap.get('id');
  }

  /** `recordActions`' own routeFor(id) needs the id `isEdit()` already knows
   * is present — no separate null-check on the call site. */
  protected recordId(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  protected navigate(route: readonly unknown[]): void {
    this.router.navigate(route as any[]);
  }

  // ---- Label association. `field.key` is already the stable, unique-within-
  // a-form identifier the template tracks by, so ids stay stable across
  // re-renders; the instance prefix keeps two forms on one page apart. The
  // sanitiser is defensive — every key today is a plain snake_case column
  // name, but an id with a space or a dot in it silently breaks any
  // querySelector/`for` lookup rather than erroring anywhere visible.
  protected controlId(field: FieldConfig<T>): string {
    return `${this.instanceId}-${String(field.key).replace(/[^A-Za-z0-9_-]/g, '-')}`;
  }

  protected labelId(field: FieldConfig<T>): string {
    return `${this.controlId(field)}-label`;
  }

  /** What this field's <label> may legally point `for` at — null for the
   * shapes that render no labelable control (read-only text, the toggle
   * <span>, a checkgroup); those are named by aria-labelledby instead. */
  protected labelTargetId(field: FieldConfig<T>): string | null {
    if ((field.createOnly && this.isEdit()) || this.isReadOnlyRecord()) return null;
    if (field.type === 'checkbox' || field.type === 'checkgroup') return null;
    return this.controlId(field);
  }

  /** " (3)" once the array named by countFrom is loaded and non-empty,
   * otherwise nothing — a bare "Slab Bands" reads fine with zero too. */
  protected recordActionCount(action: { countFrom?: keyof T }): string {
    if (!action.countFrom) return '';
    const arr = this.formModel[action.countFrom as string];
    return Array.isArray(arr) && arr.length ? ` (${arr.length})` : '';
  }

  constructor() {
    effect(() => {
      const cfg = this.config();
      const id = this.route.snapshot.paramMap.get('id');
      this.saveError.set(null);
      this.saved = false;
      this.breadcrumbs.setReadOnlyLeaf(!cfg.updateEndpoint);
      if (!id) {
        this.formModel = { ...cfg.emptyRow() };
        this.pristine = { ...this.formModel };
        this.isLoading.set(false);
        return;
      }
      this.isLoading.set(true);
      this.http.get<T[]>(`${environment.apiBaseUrl}${cfg.listEndpoint}?include_inactive=true`).subscribe({
        next: (rows) => {
          const row = rows.find((r) => cfg.rowId(r) === id);
          if (!row) {
            this.loadError.set('This record could not be found.');
          } else {
            this.formModel = { ...(row as any) };
            this.pristine = { ...this.formModel };
            // Trail was still showing the bare "Edit"/"View" verb until the
            // record loaded — now it names it, same as the record shape does.
            this.breadcrumbs.setRecordLabel(cfg.recordLabel?.(row) ?? null);
            // Re-evaluate now that formModel is populated — the constructor's
            // early !cfg.updateEndpoint check can't see a record-level
            // readOnlyWhen (e.g. a locked Financial Year) until the row is
            // actually loaded.
            this.breadcrumbs.setReadOnlyLeaf(this.isReadOnlyRecord());
          }
          this.isLoading.set(false);
        },
        error: (err) => {
          this.loadError.set(err?.error?.detail ?? 'Failed to load this record.');
          this.isLoading.set(false);
        },
      });
    });

    const key = 'form-screen';
    this.dirty.register(key, () => {
      // A read-only record has nothing to save, so "leave anyway?" would be
      // pure friction — Financial Year's own preview fields still change as
      // you'd expect (they always mirror the loaded row), but there is
      // nothing here that "discarding" could mean.
      if (this.saved || this.saving() || this.isReadOnlyRecord()) return false;
      const keys = new Set([...Object.keys(this.pristine), ...Object.keys(this.formModel)]);
      for (const k of keys) {
        const a = this.formModel[k];
        const b = this.pristine[k];
        // Arrays are the child-row editors (slab bands etc.); compare by value.
        if (Array.isArray(a) || Array.isArray(b)) {
          if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) return true;
          continue;
        }
        // '' and null both mean "empty" across an input round-trip.
        if ((a ?? '') !== (b ?? '')) return true;
      }
      return false;
    });
    this.destroyRef.onDestroy(() => {
      this.dirty.clear(key);
      this.breadcrumbs.setRecordLabel(null);
    });
  }

  protected selectOptions(field: FieldConfig<T>): { id: string; label: string }[] {
    if (field.staticOptions) return field.staticOptions.map((o) => ({ id: o.value, label: o.label }));
    return field.ref ? this.refData.options(field.ref) ?? [] : [];
  }

  /** Progressive disclosure — a field failing any check is neither shown
   * nor submitted (see `save()`), so a hidden field can't quietly carry a
   * stale value into the request body. Three independent reasons a field
   * hides: `visibleWhen` reads THIS form's own model (Tax Head's slab
   * fields, gated on its own tax_type); `hideWhenRefEmpty` reads live
   * external data (Tax Head's Tax Scheme field, §3.2d — gone while
   * /masters/tax-schemes has zero rows, regardless of anything on this
   * form); RBAC Layer 3 — a role whose fieldMode() on this key is 'hide' or
   * 'mask' shouldn't see it here either. record-screen.component.ts's own
   * isFieldEditable() only ever needed to check for 'mask'/'hide' AS EDITABLE
   * (a 'hide' field there is already absent from the fetched row, so it's
   * naturally blank either way) — a CREATE form has no existing row to omit
   * a hidden field FROM, so without this check every field rendered as a
   * live, fillable input regardless of role (the real gap: Vendor/Asset's
   * own "New" forms reuse this shared component and had no field-sensitivity
   * check of their own at all). 'mask' is treated the same as 'hide' here,
   * not shown read-only: there is no real stored value to mask yet on a
   * blank create form, and letting a role set a value it can never see back
   * is worse UX than just not offering the field. */
  private isFieldVisible(f: FieldConfig<T>): boolean {
    if (!(f.visibleWhen?.(this.formModel) ?? true)) return false;
    if (f.hideWhenRefEmpty && !(this.refData.options(f.hideWhenRefEmpty) ?? []).length) return false;
    const mode = this.policy.fieldMode(this.config().id, f.key);
    if (mode === 'hide' || mode === 'mask') return false;
    return true;
  }

  protected visibleFields(): FieldConfig<T>[] {
    return this.config().fields.filter((f) => this.isFieldVisible(f));
  }

  /** A create-only field in edit mode is plain text, so it still has to resolve
   * its label the way the select would — otherwise a field that reads
   * "CGST + SGST" while creating reads "GST_CGST_SGST" ever after. */
  protected readOnlyDisplay(field: FieldConfig<T>): string {
    const raw = this.formModel[field.key];
    if (raw === null || raw === undefined || raw === '') return '—';
    // Financial Year's own Start Date is the reference case: a createOnly
    // date field was rendering the API's raw ISO string ("2030-04-01")
    // instead of dd-mm-yyyy like every other date in the app.
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

  // ---- 'file' fields -----------------------------------------------------

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

  /** Advisory only — the API stays the authority. Shown once the user has put
   * something in the field, so an untouched form isn't pre-covered in red. */
  protected fieldError(field: FieldConfig<T>): string | null {
    const raw = this.formModel[field.key];
    const value = raw === null || raw === undefined ? '' : String(raw);
    if (!value) return null;
    if (field.pattern && !field.pattern.re.test(value)) return field.pattern.message;
    return null;
  }

  // formModel[arr.key] starts undefined for a genuinely empty array (the
  // real GET response omits an empty child collection rather than sending
  // `[]` in some cases) — normalized to a real array on first read so the
  // template and the mutating methods below never have to null-check it.
  protected arrayItems(arr: ArrayFieldConfig<T>): Record<string, unknown>[] {
    if (!Array.isArray(this.formModel[arr.key])) this.formModel[arr.key] = [];
    return this.formModel[arr.key] as Record<string, unknown>[];
  }

  protected addArrayItem(arr: ArrayFieldConfig<T>): void {
    this.arrayItems(arr).push(arr.emptyItem());
  }

  protected removeArrayItem(arr: ArrayFieldConfig<T>, index: number): void {
    this.arrayItems(arr).splice(index, 1);
  }

  /** True once an EXISTING record has no updateEndpoint at all — Financial
   * Year is the reference case: Label/Start/End are immutable by design, and
   * status only ever moves through the list's own row actions (Lock, Set
   * Current), never a form. The template hides Save entirely rather than
   * leaving a button that, per the house rule, must "work or be disabled with
   * a visible reason" — and see the comment on save() for why this used to be
   * silently dangerous, not just confusing.
   *
   * Also true for a record `readOnlyWhen` flags even though the SCREEN has a
   * real updateEndpoint — Financial Year again: editing genuinely works, but
   * a LOCKED year must still read as "View" (Invariant 4), same UI, same
   * reasoning, just triggered by the loaded record's own state instead of
   * the screen's shape. */
  protected isReadOnlyRecord(): boolean {
    if (!this.isEdit()) return false;
    if (!this.config().updateEndpoint) return true;
    return this.config().readOnlyWhen?.(this.formModel as Partial<T>) ?? false;
  }

  protected save(): void {
    const cfg = this.config();
    const id = this.route.snapshot.paramMap.get('id');

    // An existing record with no updateEndpoint must never reach the POST
    // fallback below — id && cfg.updateEndpoint being falsy would otherwise
    // silently fall through to createEndpoint, attempting to CREATE A SECOND
    // ROW from the loaded values instead of doing nothing. Financial Year
    // hits this exactly: opening an existing year and clicking Save would
    // POST a duplicate create (caught server-side by the label-uniqueness
    // check, but as a confusing 409, not as "this can't be edited"). The
    // template's own isReadOnlyRecord() keeps this unreachable in the normal
    // click path; this stays as the actual guard against ever calling save()
    // on such a record — via a stray Enter-key submit, for instance.
    if (this.isReadOnlyRecord()) return;

    // Catch the obvious problems before a round-trip. The server still validates
    // everything — this only spares the user a 422 for something the form already
    // knew about.
    const visible = this.visibleFields();
    const missing = visible.filter((f) => {
      if (!f.required) return false;
      if (f.createOnly && id) return false; // not editable in this mode, so not the user's to fill
      const v = this.formModel[f.key];
      // An empty array counts as missing for a required checkgroup — which is
      // exactly what masters_taxes.py:141-149 enforces for a withholding head.
      if (Array.isArray(v)) return v.length === 0;
      return v === null || v === undefined || v === '';
    });
    if (missing.length) {
      this.saveError.set(`Required: ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    const badFormat = visible.map((f) => (this.fieldError(f) ? `${f.label}: ${this.fieldError(f)}` : null)).filter(Boolean);
    if (badFormat.length) {
      this.saveError.set(badFormat.join(' '));
      return;
    }

    // A hidden field (either reason — see isFieldVisible) must not be
    // submitted — otherwise a value typed/loaded before the field was
    // hidden still reaches the API.
    const hidden = new Set<string>(cfg.fields.filter((f) => !this.isFieldVisible(f)).map((f) => f.key as string));
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.formModel)) {
      if (hidden.has(k)) continue;
      // Belt-and-braces: a <select> that ever round-trips through the DOM can
      // hand back the string "null"/"undefined" instead of a real null. Sending
      // that to a nullable FK column is a 4-character string, not a clear.
      body[k] = v === 'null' || v === 'undefined' || v === '' ? null : v;
    }

    this.saving.set(true);
    this.saveError.set(null);
    const req$ =
      id && cfg.updateEndpoint
        ? this.http.put<T>(`${environment.apiBaseUrl}${cfg.updateEndpoint(id)}`, body)
        : this.http.post<T>(`${environment.apiBaseUrl}${cfg.createEndpoint}`, body);
    req$.subscribe({
      next: (response) => {
        this.saving.set(false);
        // Saved: leaving is no longer discarding anything, so the guard must
        // not prompt on the navigate below.
        this.saved = true;
        // onCreateSuccess only ever applies to the CREATE branch above (never
        // consulted on an edit save) — see its own doc on FormScreenConfig.
        const target = !id && cfg.onCreateSuccess ? cfg.onCreateSuccess(response) : cfg.listRoute;
        this.router.navigate(target as any[]);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(this.formatError(err));
      },
    });
  }

  protected cancel(): void {
    this.router.navigate(this.config().listRoute as any[]);
  }

  private formatError(err: unknown, fallback = 'Failed to save changes.'): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }
}
