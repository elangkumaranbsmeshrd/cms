import { HttpClient } from '@angular/common/http';
import { Injectable, WritableSignal, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { RefLookup } from './screen.types';

/** Backs ColumnDef.ref / FieldConfig.ref — one shared id->label cache per
 * Masters endpoint, fetched once and reused by every screen that references
 * it (Customer Status, Department, ...). A signal, not an Observable+async
 * pipe: List/Record screens call `label()` synchronously from a template
 * interpolation, and zone-based CD already re-renders once the signal is
 * set from the HTTP response, so there's no need to plumb the async pipe
 * (and its CommonModule import) into components that otherwise have none.
 */
@Injectable({ providedIn: 'root' })
export class RefDataService {
  private readonly http = inject(HttpClient);
  private readonly maps = new Map<string, WritableSignal<Map<string, string> | null>>();

  private mapSignal(ref: RefLookup): WritableSignal<Map<string, string> | null> {
    const labelKey = ref.labelKey ?? 'name';
    const cacheKey = `${ref.endpoint}::${labelKey}`;
    let sig = this.maps.get(cacheKey);
    if (!sig) {
      sig = signal<Map<string, string> | null>(null);
      this.maps.set(cacheKey, sig);
      this.http.get<Record<string, unknown>[]>(`${environment.apiBaseUrl}${ref.endpoint}`).subscribe({
        next: (rows) => sig!.set(new Map(rows.map((r) => [String(r['id']), String(r[labelKey])]))),
        // A role that can't see this Masters screen at all (403) still sees
        // the referring record — falls back to showing the raw id rather
        // than blocking the whole screen on a lookup it was never granted.
        error: () => sig!.set(new Map()),
      });
    }
    return sig;
  }

  /** Synchronous: '…' while the lookup is still in flight, '—' for a null
   * id, the raw id itself if the lookup came back but doesn't have it.
   */
  label(ref: RefLookup, id: string | null | undefined): string {
    if (!id) return '—';
    const map = this.mapSignal(ref)();
    if (map === null) return '…';
    return map.get(id) ?? id;
  }

  /** A 'select' field's <option> list — same cache label() reads, just
   * shaped as entries instead of a lookup-by-id. Insertion order matches
   * the endpoint's own row order (Map preserves it); null while loading.
   */
  options(ref: RefLookup): { id: string; label: string }[] | null {
    const map = this.mapSignal(ref)();
    if (map === null) return null;
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }
}
