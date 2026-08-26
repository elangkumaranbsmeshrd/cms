import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';

const SCREEN = 'asset.directory';

interface AssetFileRow {
  readonly id: string;
  readonly stored_file_id: string;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly created_at: string;
}

/** §2.2's Attachments field, Core Info group (§6.1) — a real tab here rather
 * than a plain form field, the same structural choice already made for
 * Maintenance & Service Log and Assignment History (both also "on the asset
 * record" per §4's UI notes, both built as their own tab). Closes §2.2's own
 * disclosed gap: the shared /files upload endpoint and the asset_files link
 * table both already existed ("built at the storage layer"), only the
 * link/list endpoints and this UI were missing. Gated on asset.directory's
 * 'edit' action (Accountant + Super Admin, matching Core Info's edit rights
 * in §6.1) — Manager/HR see the list but no upload/remove controls.
 */
@Component({
  selector: 'app-asset-attachments',
  standalone: true,
  imports: [],
  template: `
    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else if (loadError()) {
      <div class="empty">
        <div class="ico">⚠</div>
        <p><b>Couldn't load attachments</b></p>
        <p class="hint">{{ loadError() }}</p>
      </div>
    } @else {
      @if (actionError()) {
        <div class="form-error" style="margin: 0 0 14px;">{{ actionError() }}</div>
      }
      <div class="card">
        <div class="card-head">
          <h3>Attachments</h3>
          @if (canEdit()) {
            <label class="btn sm ghost" style="cursor: pointer;">
              {{ uploading() ? 'Uploading…' : '+ Upload File' }}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style="display: none;" [disabled]="uploading()" (change)="onFileSelected($event)" />
            </label>
          }
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th class="r">Size</th>
                <th>Uploaded On</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (f of files(); track f.id) {
                <tr>
                  <td class="cell-strong">{{ f.original_filename }}</td>
                  <td>{{ f.mime_type }}</td>
                  <td class="mono r">{{ formatSize(f.size_bytes) }}</td>
                  <td class="mono">{{ f.created_at.slice(0, 10) }}</td>
                  <td>
                    <a class="link" (click)="download(f)">View</a>
                    @if (canEdit()) {
                      <a class="link" style="margin-left: 10px;" (click)="remove(f)">Remove</a>
                    }
                  </td>
                </tr>
              }
              @if (!files().length) {
                <tr><td colspan="5" class="cell-sub">No attachments uploaded yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class AssetAttachmentsComponent implements OnInit {
  readonly assetId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly fileUpload = inject(FileUploadService);

  protected readonly isLoading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly files = signal<readonly AssetFileRow[]>([]);
  protected readonly uploading = signal(false);
  protected readonly actionError = signal<string | null>(null);

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

  private load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.http.get<AssetFileRow[]>(`${environment.apiBaseUrl}/assets/${this.assetId()}/files`).subscribe({
      next: (rows) => {
        this.files.set(rows);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.detail ?? 'Failed to load attachments.');
        this.isLoading.set(false);
      },
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // asset_photo (JPG/PNG, 5MB) vs asset_file (PDF/JPG/PNG, 10MB) — same
    // purpose split files.py's own _PURPOSE_RULES already enforces server-side;
    // picked here by MIME type so a photo gets the tighter, correct limit.
    const purpose = file.type === 'image/jpeg' || file.type === 'image/png' ? 'asset_photo' : 'asset_file';
    this.uploading.set(true);
    this.actionError.set(null);
    this.fileUpload.upload(file, purpose).subscribe({
      next: (uploaded) => {
        this.http.post(`${environment.apiBaseUrl}/assets/${this.assetId()}/files`, { stored_file_id: uploaded.id }).subscribe({
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
        this.actionError.set(err?.error?.detail ?? 'Upload failed.');
      },
    });
  }

  protected download(f: AssetFileRow): void {
    this.fileUpload.fetch(f.stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Failed to open this file.'),
    });
  }

  protected remove(f: AssetFileRow): void {
    if (!window.confirm(`Remove "${f.original_filename}"?`)) return;
    this.http.delete(`${environment.apiBaseUrl}/assets/${this.assetId()}/files/${f.id}`).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to remove this file.'),
    });
  }
}
