import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { RefLookup } from '../../../shared/screens/screen.types';

const SCREEN = 'customer.directory';

// created_by is a raw platform User id (whoever was logged in when they
// uploaded this file), resolved via the cross-cutting GET /users.
const CUSTOMER_USER_REF: RefLookup = { endpoint: '/users', labelKey: 'name' };

const TYPE_OPTIONS = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX' },
];

interface CustomerFileRow {
  readonly id: string;
  readonly stored_file_id: string;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly created_at: string;
  readonly created_by: string | null;
}

/** §2.3 Customer 360, Tab: Files — uploaded documents (contracts,
 * agreements) against this customer. Two-step flow per the spec's own
 * build note: upload through the shared stored-files service
 * (FileUploadService, POST /files), then attach with POST
 * /customers/{id}/files?stored_file_id=X. Bespoke rather than the generic
 * 'file' FieldConfig (that's for a single *_file_id column on a row; this
 * is a repeatable list of attachments, structurally closer to
 * emp.documents.list.config.ts — but that tab deliberately left upload
 * unbuilt, so there's no existing "upload into a list" precedent to reuse
 * wholesale here).
 *
 * File Name/Type/Size now render for real — GET /customers/{id}/files
 * (list_files, api/v1/customers.py) joins StoredFile in via
 * _load_customer_file_out, the same pattern assets.py's own
 * _load_asset_file_out already uses. §5's deferred "Files type/upload-date
 * filters and export" are real 'server' params on the same endpoint.
 */
@Component({
  selector: 'app-customer-files',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Files</h3>
          <div style="display: flex; gap: 8px; align-items: center;">
            <select class="fselect" title="Type" [(ngModel)]="typeFilter" (ngModelChange)="load()">
              <option value="">All Types</option>
              @for (t of TYPE_OPTIONS; track t.value) {
                <option [value]="t.value">{{ t.label }}</option>
              }
            </select>
            <input class="fsearch" type="date" title="Uploaded From" [(ngModel)]="dateFromFilter" (ngModelChange)="load()" style="max-width: 150px;" />
            <input class="fsearch" type="date" title="Uploaded To" [(ngModel)]="dateToFilter" (ngModelChange)="load()" style="max-width: 150px;" />
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportFiles('pdf')">
              {{ exporting() === 'pdf' ? 'Exporting…' : 'Export PDF' }}
            </button>
            <button class="btn sm ghost" type="button" [disabled]="!!exporting()" (click)="exportFiles('excel')">
              {{ exporting() === 'excel' ? 'Exporting…' : 'Export Excel' }}
            </button>
            @if (canEdit()) {
              <label class="btn sm ghost" style="cursor: pointer;">
                {{ uploading() ? 'Uploading…' : '+ Upload File' }}
                <input type="file" style="display: none;" accept=".pdf,.jpg,.jpeg,.png,.docx" [disabled]="uploading()" (change)="onFileSelected($event)" />
              </label>
            }
          </div>
        </div>
        @if (exportError()) {
          <div class="form-error" style="margin: 14px;">{{ exportError() }}</div>
        }
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Uploaded By</th>
                <th>Uploaded On</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (f of files(); track f.id) {
                <tr>
                  <td>{{ f.original_filename }}</td>
                  <td class="mono">{{ f.created_by ? refData.label(USER_REF, f.created_by) : '—' }}</td>
                  <td class="mono">{{ f.created_at.slice(0, 10) }}</td>
                  <td class="mono">{{ formatSize(f.size_bytes) }}</td>
                  <td style="white-space: nowrap;">
                    <button class="btn sm ghost" type="button" (click)="view(f)">View</button>
                    @if (canEdit()) {
                      <button class="btn sm ghost" type="button" (click)="remove(f)">Delete</button>
                    }
                  </td>
                </tr>
              }
              @if (!files().length) {
                <tr><td colspan="5" class="cell-sub">No files uploaded yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class CustomerFilesComponent implements OnInit {
  readonly customerId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly refData = inject(RefDataService);
  protected readonly USER_REF = CUSTOMER_USER_REF;
  protected readonly TYPE_OPTIONS = TYPE_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly files = signal<readonly CustomerFileRow[]>([]);
  protected readonly uploading = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected typeFilter = '';
  protected dateFromFilter = '';
  protected dateToFilter = '';
  protected readonly exporting = signal<'pdf' | 'excel' | null>(null);
  protected readonly exportError = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected canEdit(): boolean {
    return this.policy.can(SCREEN, 'edit');
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.typeFilter) params.set('mime_type', this.typeFilter);
    if (this.dateFromFilter) params.set('date_from', this.dateFromFilter);
    if (this.dateToFilter) params.set('date_to', this.dateToFilter);
    return params;
  }

  protected load(): void {
    this.isLoading.set(true);
    const qs = this.buildParams().toString();
    this.http.get<CustomerFileRow[]>(`${environment.apiBaseUrl}/customers/${this.customerId()}/files${qs ? '?' + qs : ''}`).subscribe({
      next: (rows) => {
        this.files.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected exportFiles(format: 'pdf' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(format);
    this.exportError.set(null);
    const params = this.buildParams();
    params.set('format', format);
    const url = `${environment.apiBaseUrl}/customers/${this.customerId()}/files?${params.toString()}`;
    this.http.get(url, { responseType: 'blob', observe: 'response' }).subscribe({
      next: (res) => {
        this.exporting.set(null);
        const blob = res.body;
        if (!blob) return;
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const filename = match?.[1] ?? `Customer Files.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      },
      error: () => {
        this.exporting.set(null);
        this.exportError.set('Failed to export.');
      },
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.actionError.set(null);
    this.uploading.set(true);
    this.fileUpload.upload(file, 'customer_file').subscribe({
      next: (uploaded) => {
        this.http
          .post(`${environment.apiBaseUrl}/customers/${this.customerId()}/files?stored_file_id=${uploaded.id}`, {})
          .subscribe({
            next: () => {
              this.uploading.set(false);
              this.load();
            },
            error: (err) => {
              this.uploading.set(false);
              this.actionError.set(err?.error?.detail ?? 'Failed to attach this file.');
            },
          });
      },
      error: (err) => {
        this.uploading.set(false);
        this.actionError.set(err?.error?.detail ?? 'Failed to upload this file.');
      },
    });
  }

  protected view(f: CustomerFileRow): void {
    this.fileUpload.fetch(f.stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Could not open that file.'),
    });
  }

  protected remove(f: CustomerFileRow): void {
    if (!window.confirm('Delete this file?')) return;
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/customers/${this.customerId()}/files/${f.id}`).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to delete this file.'),
    });
  }
}
