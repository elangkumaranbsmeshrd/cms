import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export interface UploadedFile {
  readonly id: string;
  readonly original_filename: string;
  readonly mime_type: string;
  readonly size_bytes: number;
}

/** The one generic upload/download pair (POST/GET /files, files.py) every
 * `*_file_id` column across this codebase resolves through — shared by every
 * 'file'-type FieldConfig so the multipart request and the authenticated
 * blob-open are each built once. conversation-screen.component.ts predates
 * this and keeps its own copy deliberately (its pending-attachment-then-send
 * flow is a genuinely different shape, not a plain form field) — left as-is
 * rather than refactored, to avoid regression risk for zero behavior change.
 */
@Injectable({ providedIn: 'root' })
export class FileUploadService {
  private readonly http = inject(HttpClient);

  upload(file: File, purpose: string): Observable<UploadedFile> {
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', purpose);
    return this.http.post<UploadedFile>(`${environment.apiBaseUrl}/files`, form);
  }

  /** Fetches the file's bytes; the caller opens it (see `openBlob`). Kept as
   * two steps rather than one so a caller can distinguish a fetch failure
   * from nothing to do, the same shape every other HttpClient call in this
   * codebase already follows — a service method that both subscribes AND
   * returns the same cold Observable would fire the GET twice if the caller
   * also subscribes. */
  fetch(fileId: string): Observable<Blob> {
    return this.http.get(`${environment.apiBaseUrl}/files/${fileId}`, { responseType: 'blob' });
  }

  /** Auth is Bearer-header-only (auth.interceptor.ts) — a plain <a href> to
   * /files/{id} would hit the API unauthenticated, same reasoning as
   * ListScreenComponent.exportAs() and conversation-screen's own
   * openAttachment. The object URL is left un-revoked on purpose: the new
   * tab needs it to stay alive to actually display/download it. */
  openBlob(blob: Blob): void {
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  }
}
