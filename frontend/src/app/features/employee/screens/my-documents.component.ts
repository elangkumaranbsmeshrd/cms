import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { PolicyStore } from '../../../core/rbac/policy.store';
import { FileUploadService } from '../../../shared/screens/file-upload.service';

interface DocumentRow {
  readonly id: string;
  readonly document_type: string;
  readonly file_id: string;
  // §2.6's "File Name" column — joined in from StoredFile.original_filename
  // by employee_documents.py's _to_outs (the document row itself stores only
  // the file_id, which is what this column used to print eight characters of).
  readonly file_name: string;
  readonly note: string | null;
  readonly status: string;
  readonly uploaded_at: string;
  readonly rejection_reason: string | null;
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'ID_PROOF', label: 'ID Proof' },
  { value: 'EDUCATIONAL_CERTIFICATE', label: 'Educational Certificate' },
  { value: 'RESUME', label: 'Resume' },
  { value: 'OFFER_LETTER_COPY', label: 'Offer Letter Copy' },
  { value: 'OTHER', label: 'Others' },
];

const STATUS_OPTIONS = [
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** §2.6 My Documents (self-service half — the HR-wide Verification Queue
 * is document-verification-queue.list.config.ts, a separate screen).
 * Bespoke, top-level: GET/POST /employees/{employee_id}/documents has no
 * /me alias (employee_documents.py), so this resolves its own employee id
 * via GET /employees/me first, same pattern my-leave.component.ts's
 * siblings that DO have a /me alias didn't need. Upload is a real two-step
 * flow: POST /files (multipart, FileUploadService) for a file_id, then
 * POST .../documents (JSON) to attach it — matches employee_documents.py's
 * own build note.
 */
@Component({
  selector: 'app-my-documents',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">My Documents</h1>
        <p class="page-sub">Your own uploaded paperwork and its verification status.</p>
      </div>
      <div class="page-actions">
        @if (canVerify()) {
          <a class="btn sm ghost" [routerLink]="['/documents/verification-queue']">HR Verification Queue</a>
        }
        @if (employeeId() && !showUpload()) {
          <button class="btn sm primary" type="button" (click)="startUpload()">+ Upload Document</button>
        }
      </div>
    </div>

    @if (isLoading()) {
      <div class="empty"><p>Loading…</p></div>
    } @else {
      @if (showUpload()) {
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-head"><h3>Upload Document</h3></div>
          <div class="card-body">
            @if (uploadError()) {
              <div class="form-error" style="margin: 0 0 14px;">{{ uploadError() }}</div>
            }
            <!-- Every control below is captioned by a sibling
                 <div class="cell-sub">, which associates nothing — it is a
                 styled div, not a <label for>, so the caption reaches a
                 sighted user and nothing else. The axe sweep has never flagged
                 these only because it scans this screen with the Upload card
                 closed; they are unnamed controls the instant anyone opens it.
                 The caption's own text becomes each control's aria-label, the
                 way form-screen.component.ts puts the plain field.label on the
                 control itself. Note keeps its placeholder as the hint it
                 actually is ("Optional" is not a name), now that a real name
                 exists alongside it. -->
            <div class="grid g-2">
              <div>
                <div class="cell-sub">Document Type</div>
                <select class="input" aria-label="Document Type" aria-required="true" [(ngModel)]="uploadForm['document_type']">
                  @for (t of DOCUMENT_TYPE_OPTIONS; track t.value) {
                    <option [value]="t.value">{{ t.label }}</option>
                  }
                </select>
              </div>
              <div>
                <div class="cell-sub">File</div>
                <input type="file" aria-label="File" aria-required="true" (change)="onFileSelected($event)" />
              </div>
              <div style="grid-column: span 2;">
                <div class="cell-sub">Note</div>
                <input class="input" aria-label="Note" [(ngModel)]="uploadForm['note']" placeholder="Optional" />
              </div>
            </div>
          </div>
          <div class="card-foot">
            <button class="btn ghost" type="button" [disabled]="uploading()" (click)="showUpload.set(false)">Cancel</button>
            <button class="btn primary" type="button" [disabled]="uploading() || !selectedFile" (click)="submitUpload()">
              {{ uploading() ? 'Uploading…' : 'Upload' }}
            </button>
          </div>
        </div>
      }

      <!-- Every control in this row carries an explicit aria-label. The two
           selects had no name of any kind — not even a title to fall back on —
           so axe flagged them as [critical] select-name and a screen reader
           announced two bare combo boxes. The dimension each one narrows lives only in its "All
           Document Types" / "All Statuses" option, which is the current VALUE,
           not the control's name. See company-expenses.component.ts's own
           filter-row comment for the full reasoning. -->
      <div class="filterbar" style="margin-bottom: 12px;">
        <div class="filter-row">
          <input class="input" style="width: auto;" type="search" aria-label="Search by file name" placeholder="Search file name…" [ngModel]="search()" (ngModelChange)="search.set($event)" />
          <select class="input" style="width: auto;" aria-label="Document Type" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)">
            <option [ngValue]="null">All Document Types</option>
            @for (t of DOCUMENT_TYPE_OPTIONS; track t.value) {
              <option [value]="t.value">{{ t.label }}</option>
            }
          </select>
          <select class="input" style="width: auto;" aria-label="Status" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            <option [ngValue]="null">All Statuses</option>
            @for (s of STATUS_OPTIONS; track s.value) {
              <option [value]="s.value">{{ s.label }}</option>
            }
          </select>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document Type</th>
                <th>File Name</th>
                <th>Uploaded On</th>
                <th>Status</th>
                <th>Rejection Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (d of filteredDocuments(); track d.id) {
                <tr>
                  <td class="cell-strong">{{ typeLabel(d.document_type) }}</td>
                  <td>{{ d.file_name || '—' }}</td>
                  <td class="mono">{{ d.uploaded_at.slice(0, 10) }}</td>
                  <td>
                    <span class="badge-s" [class.b-warn]="d.status === 'PENDING_VERIFICATION'" [class.b-ok]="d.status === 'VERIFIED'" [class.b-danger]="d.status === 'REJECTED'">{{ statusLabel(d.status) }}</span>
                  </td>
                  <td>{{ d.rejection_reason ?? '—' }}</td>
                  <td style="white-space: nowrap;">
                    <button class="btn sm ghost" type="button" [disabled]="viewingId() === d.id" (click)="view(d)">{{ viewingId() === d.id ? 'Opening…' : 'View' }}</button>
                    @if (d.status === 'PENDING_VERIFICATION') {
                      <button class="btn sm ghost" type="button" (click)="remove(d)">Delete</button>
                    }
                  </td>
                </tr>
              }
              @if (!filteredDocuments().length) {
                <tr><td colspan="6" class="cell-sub">No documents uploaded yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class MyDocumentsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fileUpload = inject(FileUploadService);
  private readonly policy = inject(PolicyStore);

  protected readonly DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPE_OPTIONS;
  protected readonly STATUS_OPTIONS = STATUS_OPTIONS;

  protected readonly isLoading = signal(true);
  protected readonly employeeId = signal<string | null>(null);
  protected readonly documents = signal<readonly DocumentRow[]>([]);

  protected readonly typeFilter = signal<string | null>(null);
  protected readonly statusFilter = signal<string | null>(null);
  // §2.6: "Search covers File Name." Client-side, like both filters beside it
  // — GET /employees/{id}/documents takes no ?search= param (this is one
  // person's short list, not a paged directory).
  protected readonly search = signal('');
  protected readonly filteredDocuments = computed(() => {
    const type = this.typeFilter();
    const status = this.statusFilter();
    const q = this.search().trim().toLowerCase();
    return this.documents().filter(
      (d) =>
        (!type || d.document_type === type) &&
        (!status || d.status === status) &&
        // ?? '' for the same reason my-tax-declarations guards proofCount():
        // file_name is new on DocumentOut, and a backend process older than this
        // bundle answers without it.
        (!q || (d.file_name ?? '').toLowerCase().includes(q)),
    );
  });

  protected readonly showUpload = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected uploadForm: Record<string, unknown> = {};
  protected selectedFile: File | null = null;

  protected readonly viewingId = signal<string | null>(null);

  ngOnInit(): void {
    this.http.get<{ id: string }>(`${environment.apiBaseUrl}/employees/me`).subscribe({
      next: (me) => {
        this.employeeId.set(me.id);
        this.load();
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected canVerify(): boolean {
    return this.policy.can('employee.documents', 'verify');
  }

  protected typeLabel(v: string): string {
    return DOCUMENT_TYPE_OPTIONS.find((t) => t.value === v)?.label ?? v;
  }

  protected statusLabel(v: string): string {
    return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
  }

  private load(): void {
    const id = this.employeeId();
    if (!id) return;
    this.isLoading.set(true);
    this.http.get<DocumentRow[]>(`${environment.apiBaseUrl}/employees/${id}/documents`).subscribe({
      next: (rows) => {
        this.documents.set(rows);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  protected startUpload(): void {
    this.uploadForm = { document_type: 'ID_PROOF', note: '' };
    this.selectedFile = null;
    this.uploadError.set(null);
    this.showUpload.set(true);
  }

  protected onFileSelected(event: Event): void {
    this.selectedFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  protected submitUpload(): void {
    const id = this.employeeId();
    if (!id || !this.selectedFile) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    this.fileUpload.upload(this.selectedFile, 'generic').subscribe({
      next: (uploaded) => {
        this.http
          .post(`${environment.apiBaseUrl}/employees/${id}/documents`, { document_type: this.uploadForm['document_type'], file_id: uploaded.id, note: this.uploadForm['note'] || null })
          .subscribe({
            next: () => {
              this.uploading.set(false);
              this.showUpload.set(false);
              this.load();
            },
            error: (err) => {
              this.uploading.set(false);
              this.uploadError.set(err?.error?.detail ?? 'Failed to save this document.');
            },
          });
      },
      error: (err) => {
        this.uploading.set(false);
        this.uploadError.set(err?.error?.detail ?? 'Failed to upload this file.');
      },
    });
  }

  protected view(d: DocumentRow): void {
    this.viewingId.set(d.id);
    this.fileUpload.fetch(d.file_id).subscribe({
      next: (blob) => {
        this.viewingId.set(null);
        this.fileUpload.openBlob(blob);
      },
      error: () => this.viewingId.set(null),
    });
  }

  protected remove(d: DocumentRow): void {
    const id = this.employeeId();
    if (!id || !window.confirm('Delete this document?')) return;
    this.http.delete(`${environment.apiBaseUrl}/employees/${id}/documents/${d.id}`).subscribe({
      next: () => this.load(),
    });
  }
}
