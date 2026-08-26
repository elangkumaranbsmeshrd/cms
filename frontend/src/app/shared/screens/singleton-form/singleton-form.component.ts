import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { SessionStore } from '../../../core/auth/session.store';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FieldConfig, SingletonFormConfig, SingletonTestActionDef } from '../screen.types';
import { RefDataService } from '../ref-data.service';
import { FileUploadService } from '../file-upload.service';

/** The 'singleton' shape — Company Profile and Email Configuration's Server
 * Settings, the ONE record a screen has (no id, ever). GET may return null
 * (nothing created yet), in which case Save POSTs; otherwise Save PUTs.
 * Related sub-resources (Addresses, Templates, ...) are separate full
 * screens linked from here, not tabs — see SingletonFormConfig's own doc.
 */
@Component({
  selector: 'app-singleton-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <!-- No relatedLinks row here any more: sub-resources are TABS on the
         tabbed host, not "Addresses →" buttons that navigate away. -->
    @if (!embedded()) {
      <div class="page-head">
        <div>
          <h1 class="page-title">{{ config().title }}</h1>
        </div>
      </div>
    }

    @if (isLoading()) {
      <div class="empty">
        <p>Loading…</p>
      </div>
    } @else {
      @if (saveError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ saveError() }}</div>
      }
      @if (!canEdit()) {
        <div class="empty">
          <div class="ico">🔒</div>
          <p>You don't have access to edit this screen.</p>
        </div>
      } @else {
        <div class="card">
          <div class="card-body">
            <div class="grid g-2">
              @for (field of visibleFields(); track field.key) {
                <div class="field" [class.span-2]="field.span === 2 || field.type === 'textarea'">
                  <label>
                    {{ field.label }}
                    @if (field.required) {
                      <span class="req" aria-hidden="true">*</span>
                    }
                  </label>
                  @if (field.type === 'select') {
                    <!-- [ngValue], not [value]: a plain [value] round-trips
                         through the DOM as a string, so picking "—" wrote the
                         literal text "null" into the model.
                         aria-label, not just the sibling <label> above: proven
                         necessary in form-screen.component.ts by a real E2E
                         test — the label's computed accessible name included
                         the required-marker asterisk despite it being
                         aria-hidden. An explicit aria-label on the control
                         takes precedence, so the announced name is exactly
                         field.label regardless. -->
                    <select class="input" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [(ngModel)]="formModel[field.key]">
                      <option [ngValue]="null">—</option>
                      @for (opt of selectOptions(field); track opt.id) {
                        <option [ngValue]="opt.id">{{ opt.label }}</option>
                      }
                    </select>
                  } @else if (field.type === 'checkbox') {
                    <!-- role/tabindex/aria-checked/keyboard handlers: a bare
                         <span> is untabbable and reports no on/off state. -->
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
                  } @else if (field.type === 'textarea') {
                    <textarea class="input" rows="3" [attr.aria-label]="field.label" [attr.aria-required]="field.required ? 'true' : null" [placeholder]="field.placeholder ?? ''" [(ngModel)]="formModel[field.key]"></textarea>
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
                  } @else {
                    <input
                      class="input"
                      [type]="inputType(field)"
                      [attr.aria-label]="field.label"
                      [attr.aria-required]="field.required ? 'true' : null"
                      [placeholder]="field.placeholder ?? ''"
                      [(ngModel)]="formModel[field.key]"
                    />
                  }
                  @if (fileErrorFor(field); as err) {
                    <div class="hint" style="color: var(--danger);">{{ err }}</div>
                  } @else if (field.hint) {
                    <div class="hint">{{ field.hint }}</div>
                  }
                </div>
              }
            </div>

            @if (config().testAction; as ta) {
              <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
                @if (!testOpen()) {
                  @if (canTest(ta)) {
                    <button class="btn" type="button" (click)="openTest(ta)">{{ ta.label }}</button>
                  }
                } @else {
                  <div class="grid g-2">
                    <div class="field">
                      <label>
                        {{ ta.promptLabel }}
                        <span class="req" aria-hidden="true">*</span>
                      </label>
                      <input class="input" type="email" [attr.aria-label]="ta.promptLabel" aria-required="true" [placeholder]="ta.promptPlaceholder ?? ''" [(ngModel)]="testValue" />
                      <div class="hint">Defaults to your own signed-in address.</div>
                    </div>
                    @if (ta.usingLabel) {
                      <div class="field">
                        <label>Using Server</label>
                        <div class="readonly-value">{{ usingServerLabel(ta) }}</div>
                        <div class="hint">From Server Settings — this proves the saved configuration actually works, not a separate hardcoded test path.</div>
                      </div>
                    }
                  </div>
                  @if (testError()) {
                    <div class="form-error">{{ testError() }}</div>
                  }
                  @if (testResult()) {
                    <div class="form-success">{{ testResult() }}</div>
                  }
                  <div style="margin-top: 12px; display: flex; gap: 10px;">
                    <button class="btn ghost" type="button" [disabled]="testSending()" (click)="closeTest()">Cancel</button>
                    <button class="btn primary" type="button" [disabled]="testSending()" (click)="sendTest(ta)">
                      {{ testSending() ? 'Sending…' : ta.label }}
                    </button>
                  </div>
                }
              </div>
            }
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="saving()" (click)="reload()">Discard Changes</button>
            <button class="btn primary" type="button" [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      }
    }
  `,
  styles: [
    `.form-success {
      margin-top: 12px; padding: 10px 12px; border: 1px solid var(--success-line); background: var(--success-bg);
      border-radius: var(--r-md); font-size: 12px; color: var(--success); line-height: 1.5;
    }`,
  ],
})
export class SingletonFormComponent<T = any> {
  readonly config = input.required<SingletonFormConfig<T>>();
  /** True when rendered as a tab body — the tabbed host owns the page title. */
  readonly embedded = input(false);
  private readonly http = inject(HttpClient);
  private readonly refData = inject(RefDataService);
  private readonly policy = inject(PolicyStore);
  private readonly session = inject(SessionStore);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly router = inject(Router);

  protected readonly isLoading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly exists = signal(false);
  protected formModel: Record<string, unknown> = {};

  // ---- 'file' fields — keyed by field.key, since a config can carry more
  // than one (Company Profile's Documents tab: Logo + Letterhead). Kept
  // separate from formModel, which only ever holds the saved file id.
  protected readonly fileUploading = signal<Record<string, boolean>>({});
  private readonly fileErrorsState = signal<Record<string, string | null>>({});
  // The upload response's own filename, so a file picked THIS session reads
  // as "logo-2026.png" rather than the bare "Uploaded" badge a page reload
  // (where only the id round-trips, never a filename) falls back to — see
  // emp.documents.list.config.ts's fileLabel() for the same absence noted
  // on a different screen.
  private readonly fileNames = signal<Record<string, string>>({});

  // ---- testAction (Email Configuration's "Send Test Email") -------------
  protected readonly testOpen = signal(false);
  protected testValue = '';
  protected readonly testSending = signal(false);
  protected readonly testError = signal<string | null>(null);
  protected readonly testResult = signal<string | null>(null);

  protected navigate(route: readonly unknown[]): void {
    this.router.navigate(route as any[]);
  }

  constructor() {
    effect(() => {
      this.config();
      this.reload();
    });
  }

  protected canEdit(): boolean {
    return this.policy.can(this.config().id, this.config().screenAction ?? 'edit');
  }

  protected reload(): void {
    const cfg = this.config();
    this.isLoading.set(true);
    this.saveError.set(null);
    this.http.get<T | null>(`${environment.apiBaseUrl}${cfg.loadEndpoint}`).subscribe({
      next: (data) => {
        if (data) {
          this.formModel = { ...(data as any) };
          this.exists.set(true);
        } else {
          this.formModel = { ...cfg.emptyRow() };
          this.exists.set(false);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.formModel = { ...cfg.emptyRow() };
        this.exists.set(false);
        this.isLoading.set(false);
      },
    });
  }

  protected selectOptions(field: FieldConfig<T>): { id: string; label: string }[] {
    if (field.staticOptions) return field.staticOptions.map((o) => ({ id: o.value, label: o.label }));
    return field.ref ? this.refData.options(field.ref) ?? [] : [];
  }

  /** Progressive disclosure, same two independent reasons form-screen.
   * component.ts's own isFieldVisible checks — see that comment. No singleton
   * field uses either today; kept consistent so the shared FieldConfig type
   * behaves the same regardless of which shape renders it. */
  protected visibleFields(): FieldConfig<T>[] {
    return this.config().fields.filter((f) => {
      if (!(f.visibleWhen?.(this.formModel) ?? true)) return false;
      if (f.hideWhenRefEmpty && !(this.refData.options(f.hideWhenRefEmpty) ?? []).length) return false;
      return true;
    });
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

  protected save(): void {
    const cfg = this.config();
    this.saving.set(true);
    this.saveError.set(null);
    const req$ = this.exists()
      ? this.http.put(`${environment.apiBaseUrl}${cfg.updateEndpoint}`, this.formModel)
      : cfg.createMethod === 'PUT'
        ? this.http.put(`${environment.apiBaseUrl}${cfg.createEndpoint}`, this.formModel)
        : this.http.post(`${environment.apiBaseUrl}${cfg.createEndpoint}`, this.formModel);
    req$.subscribe({
      next: (data) => {
        this.formModel = { ...(data as any) };
        this.exists.set(true);
        this.saving.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown, fallback = 'Failed to save changes.'): string {
    const detail = (err as any)?.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
    return fallback;
  }

  // ---- testAction (Email Configuration's "Send Test Email") -------------

  protected canTest(ta: SingletonTestActionDef<T>): boolean {
    return this.policy.can(this.config().id, ta.screenAction ?? 'edit');
  }

  protected usingServerLabel(ta: SingletonTestActionDef<T>): string {
    return ta.usingLabel ? ta.usingLabel(this.formModel as Partial<T>) : '';
  }

  protected openTest(ta: SingletonTestActionDef<T>): void {
    this.testValue = ta.defaultValue?.() ?? this.session.user()?.email ?? '';
    this.testError.set(null);
    this.testResult.set(null);
    this.testOpen.set(true);
  }

  protected closeTest(): void {
    this.testOpen.set(false);
  }

  protected sendTest(ta: SingletonTestActionDef<T>): void {
    const value = this.testValue.trim();
    if (!value) {
      this.testError.set(`${ta.promptLabel} is required.`);
      return;
    }
    this.testSending.set(true);
    this.testError.set(null);
    this.testResult.set(null);
    this.http.post(`${environment.apiBaseUrl}${ta.endpoint}`, ta.buildBody(value)).subscribe({
      next: (res) => {
        this.testSending.set(false);
        this.testResult.set(ta.resultMessage ? ta.resultMessage(res) : 'Sent.');
      },
      error: (err) => {
        this.testSending.set(false);
        this.testError.set(this.formatError(err, 'That test failed.'));
      },
    });
  }
}
