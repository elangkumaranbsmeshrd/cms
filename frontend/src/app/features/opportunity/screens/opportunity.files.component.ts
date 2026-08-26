import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';
import { RefDataService } from '../../../shared/screens/ref-data.service';
import { OPPORTUNITY_USER_REF, OpportunityFileRow } from '../opportunity.api';

const SCREEN = 'opportunity.pipeline';

/** Opportunity Record, Tab: Files — modeled directly on
 * customer.files.component.ts (the established precedent for this exact
 * two-step "upload to the shared stored-files service, then attach" flow).
 * Upload via FileUploadService (POST /files, purpose 'opportunity_file' —
 * PDF/JPG/PNG/DOCX/XLSX, 10MB per §0), then POST /opportunities/{id}/files
 * with `stored_file_id` as a QUERY PARAM and an empty body. List/delete via
 * GET/DELETE /opportunities/{id}/files/{file_id}.
 *
 * File Name/Type/Size render for real — GET /opportunities/{id}/files
 * (list_files, api/v1/opportunities.py) joins StoredFile in via
 * _load_opportunity_file_out, the same pattern customers.py/assets.py use.
 * Uploaded By resolves via OPPORTUNITY_USER_REF (GET /users).
 *
 * Bespoke-component rule: this takes input.required<string>(), so the fetch
 * happens in ngOnInit(), never the constructor.
 */
@Component({
  selector: 'app-opportunity-files',
  standalone: true,
  imports: [],
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
          @if (canEdit()) {
            <label class="btn sm ghost" style="cursor: pointer;">
              {{ uploading() ? 'Uploading…' : '+ Upload File' }}
              <input type="file" style="display: none;" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" [disabled]="uploading()" (change)="onFileSelected($event)" />
            </label>
          }
        </div>
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
export class OpportunityFilesComponent implements OnInit {
  readonly opportunityId = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly policy = inject(PolicyStore);
  private readonly fileUpload = inject(FileUploadService);
  protected readonly refData = inject(RefDataService);
  protected readonly USER_REF = OPPORTUNITY_USER_REF;

  protected readonly isLoading = signal(true);
  protected readonly files = signal<readonly OpportunityFileRow[]>([]);
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
    this.http.get<OpportunityFileRow[]>(`${environment.apiBaseUrl}/opportunities/${this.opportunityId()}/files`).subscribe({
      next: (rows) => {
        this.files.set(rows ?? []);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.actionError.set(null);
    this.uploading.set(true);
    this.fileUpload.upload(file, 'opportunity_file').subscribe({
      next: (uploaded) => {
        this.http.post(`${environment.apiBaseUrl}/opportunities/${this.opportunityId()}/files?stored_file_id=${uploaded.id}`, {}).subscribe({
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

  protected view(f: OpportunityFileRow): void {
    this.fileUpload.fetch(f.stored_file_id).subscribe({
      next: (blob) => this.fileUpload.openBlob(blob),
      error: () => this.actionError.set('Could not open that file.'),
    });
  }

  protected remove(f: OpportunityFileRow): void {
    if (!window.confirm('Delete this file?')) return;
    this.actionError.set(null);
    this.http.delete(`${environment.apiBaseUrl}/opportunities/${this.opportunityId()}/files/${f.id}`).subscribe({
      next: () => this.load(),
      error: (err) => this.actionError.set(err?.error?.detail ?? 'Failed to delete this file.'),
    });
  }
}
