import { HttpClient, HttpParams } from '@angular/common/http';
import { Signal, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';

import { environment } from '../../../../environments/environment';
import { DateRangeValue, FilterDef, FilterValue, ListScreenConfig, NumberRangeValue } from '../screen.types';
import { DatePreset, resolveRange, withinRange } from '../date-presets';

/**
 * ARCH-3 §2's createListStore, adapted to the real backend contract: every
 * list endpoint returns a bare array, not the {items,total,page,scope,...}
 * envelope ARCH-3 assumes (confirmed absent across employees/assets/
 * invoices/projects — see the ARCH-3 extraction report). Pagination happens
 * CLIENT-side over the full result set, which is a reasonable trade for this
 * system's actual list sizes (company-internal directories, hundreds not
 * millions of rows).
 *
 * Filtering is deliberately SPLIT, and the split is the whole point:
 *   - `transport: 'server'` filters become real query params. The same params
 *     are handed to the export URL, so the PDF's "Filters:" header block
 *     (list_export.py's `_header_lines`) states something TRUE and the exported
 *     rows are exactly the on-screen rows — RBAC §2.2f.
 *   - `transport: 'client'` filters (and search, where the endpoint has no
 *     `?search=`) run in JS over the fetched array. These CANNOT round-trip,
 *     so `clientOnlyActive()` reports when any is engaged and the component
 *     says so next to Export rather than quietly exporting a different set.
 */
export function createListStore<T>(configSignal: Signal<ListScreenConfig<T>>, presets: Signal<readonly DatePreset[]>) {
  const http = inject(HttpClient);
  const destroyRef = inject(DestroyRef);

  const allRows = signal<T[]>([]);
  const isLoading = signal(true);
  const error = signal<string | null>(null);
  const query = signal('');
  const page = signal(1);
  const filterValues = signal<Record<string, FilterValue>>({});
  // §3.0: "defaulting to Active with an explicit 'include inactive' option".
  const includeInactive = signal(false);

  // §2.2c: "The applied filter state persists for that user, on that screen,
  // within a session — navigating into a record and back does not reset it.
  // …it does not persist across sessions, since a stale filter silently applied
  // at next login is a common source of 'the data is missing' reports."
  // sessionStorage is exactly that lifetime, so the rule needs no expiry logic.
  const storageKey = (cfg: ListScreenConfig<T>) => `list-filters:${cfg.id}`;

  function readPersisted(cfg: ListScreenConfig<T>): { values: Record<string, FilterValue>; q: string; inactive: boolean } | null {
    try {
      const raw = sessionStorage.getItem(storageKey(cfg));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // private mode / disabled storage — filters just don't persist
    }
  }

  function persist(cfg: ListScreenConfig<T>): void {
    try {
      sessionStorage.setItem(
        storageKey(cfg),
        JSON.stringify({ values: filterValues(), q: query(), inactive: includeInactive() }),
      );
    } catch {
      /* non-fatal */
    }
  }

  function defaultsFor(cfg: ListScreenConfig<T>): Record<string, FilterValue> {
    const out: Record<string, FilterValue> = {};
    for (const f of cfg.filters ?? []) out[f.key] = f.defaultValue ?? (f.kind === 'multiselect' ? [] : null);
    return out;
  }

  // Re-seed whenever the screen changes: restore this session's filters for the
  // new screen, or fall back to its declared defaults.
  effect(() => {
    const cfg = configSignal();
    const saved = readPersisted(cfg);
    filterValues.set(saved?.values ?? defaultsFor(cfg));
    query.set(saved?.q ?? '');
    includeInactive.set(saved?.inactive ?? false);
    page.set(1);
  });

  /** The query params that genuinely reach the API — shared by the list fetch
   * and the export, which is what keeps the two in agreement by construction. */
  const serverParams = computed<Record<string, string | string[]>>(() => {
    const cfg = configSignal();
    const values = filterValues();
    const out: Record<string, string | string[]> = {};

    if (cfg.searchParam !== false && cfg.searchParam) {
      const q = query().trim();
      if (q) out[cfg.searchParam] = q;
    }
    if (cfg.includeInactiveParam !== false && cfg.includeInactiveParam && includeInactive()) {
      out[cfg.includeInactiveParam] = 'true';
    }

    for (const f of cfg.filters ?? []) {
      if (f.transport !== 'server') continue;
      const v = values[f.key];
      if (v === null || v === undefined || v === '') continue;
      const param = f.param ?? f.key;
      if (Array.isArray(v)) {
        if (v.length) out[param] = [...v];
      } else if (f.kind === 'daterange') {
        const { from, to } = resolveRange(v as DateRangeValue, presets());
        if (from) out[`${param}_from`] = from;
        if (to) out[`${param}_to`] = to;
      } else if (f.kind === 'numberrange') {
        const { min, max } = v as NumberRangeValue;
        if (min !== null && min !== undefined) out[`${param}_min`] = String(min);
        if (max !== null && max !== undefined) out[`${param}_max`] = String(max);
      } else {
        out[param] = String(v);
      }
    }
    return out;
  });

  function toHttpParams(raw: Record<string, string | string[]>): HttpParams {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) for (const item of v) params = params.append(k, item);
      else params = params.set(k, v);
    }
    return params;
  }

  function load(cfg: ListScreenConfig<T>, params: HttpParams): void {
    isLoading.set(true);
    error.set(null);
    http
      .get<T[]>(`${environment.apiBaseUrl}${cfg.endpoint}`, { params })
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (data) => {
          allRows.set(Array.isArray(data) ? data : []);
          isLoading.set(false);
        },
        error: (err) => {
          error.set(err?.error?.detail ?? 'Failed to load data.');
          isLoading.set(false);
        },
      });
  }

  // Refetches whenever the screen OR any server-transport filter changes.
  effect(() => {
    const cfg = configSignal();
    const params = toHttpParams(serverParams());
    load(cfg, params);
  });

  /** True when a filter is engaged that the server never saw — the honest
   * signal behind the component's export caveat. */
  const clientOnlyActive = computed(() => {
    const cfg = configSignal();
    const values = filterValues();
    // A rowFilter narrows the screen without any user-facing control (it is how
    // a tab scopes itself), and the server never sees it — so an export from a
    // scoped tab would silently contain every row. It counts here for exactly
    // the same reason a client-side filter does.
    if (cfg.rowFilter) return true;
    if (query().trim() && (cfg.searchParam === false || !cfg.searchParam)) return true;
    return (cfg.filters ?? []).some((f) => f.transport === 'client' && isEngaged(f, values[f.key]));
  });

  function isEngaged(filter: FilterDef<T>, v: FilterValue): boolean {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (filter.kind === 'daterange') {
      const d = v as DateRangeValue;
      return !!(d?.preset || d?.from || d?.to);
    }
    if (filter.kind === 'numberrange') {
      const r = v as NumberRangeValue;
      return (r?.min !== null && r?.min !== undefined) || (r?.max !== null && r?.max !== undefined);
    }
    return true;
  }

  const filtered = computed(() => {
    const cfg = configSignal();
    const values = filterValues();
    let rows = allRows();

    // A screen-level rule that is not a user-facing filter (e.g. a sub-resource
    // list that only ever shows rows belonging to one parent).
    if (cfg.rowFilter) rows = rows.filter(cfg.rowFilter);

    for (const f of cfg.filters ?? []) {
      if (f.transport !== 'client') continue;
      const v = values[f.key];
      if (!isEngaged(f, v)) continue;
      if (f.kind === 'daterange') {
        const { from, to } = resolveRange(v as DateRangeValue, presets());
        if (!from && !to) continue;
        const field = f.param ?? f.key;
        rows = rows.filter((row) =>
          f.predicate ? f.predicate(row, v) : withinRange((row as Record<string, unknown>)[field], from, to),
        );
        continue;
      }
      if (f.kind === 'numberrange') {
        const { min, max } = v as NumberRangeValue;
        if ((min === null || min === undefined) && (max === null || max === undefined)) continue;
        const field = f.param ?? f.key;
        rows = rows.filter((row) => {
          if (f.predicate) return f.predicate(row, v);
          const raw = (row as Record<string, unknown>)[field];
          const num = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(num)) return false;
          if (min !== null && min !== undefined && num < min) return false;
          if (max !== null && max !== undefined && num > max) return false;
          return true;
        });
        continue;
      }
      if (!f.predicate) continue; // declared client-side but gave no predicate: do nothing rather than silently drop every row
      rows = rows.filter((row) => f.predicate!(row, v));
    }

    // Search runs last so its "X of Y" reads against the filtered set.
    const q = query().trim().toLowerCase();
    if (q && (cfg.searchParam === false || !cfg.searchParam)) {
      const fields = cfg.searchFields;
      rows = rows.filter((row) => {
        // §3.0 asks for "that sub-master's name and code fields". Falling back
        // to the whole row (the old behaviour) matches ids and internal flags,
        // so a config that names its fields gets the narrower, correct search.
        if (fields?.length) {
          return fields.some((k) => String((row as Record<string, unknown>)[k] ?? '').toLowerCase().includes(q));
        }
        return JSON.stringify(row).toLowerCase().includes(q);
      });
    }
    return rows;
  });

  const total = computed(() => filtered().length);
  // What "of Y" means: the rows this role's current server query returned,
  // before client-side filters and search. Not a global table count — the
  // backend never sends one, and inventing one would be a lie.
  const loadedTotal = computed(() => {
    const cfg = configSignal();
    const rows = allRows();
    return cfg.rowFilter ? rows.filter(cfg.rowFilter).length : rows.length;
  });
  const pageSize = computed(() => configSignal().defaultPageSize ?? 25);
  const pageCount = computed(() => Math.max(1, Math.ceil(total() / pageSize())));
  const rows = computed(() => {
    const start = (page() - 1) * pageSize();
    return filtered().slice(start, start + pageSize());
  });

  const activeFilters = computed(() => {
    const cfg = configSignal();
    const values = filterValues();
    return (cfg.filters ?? []).filter((f) => isEngaged(f, values[f.key]));
  });

  function afterChange(): void {
    page.set(1);
    persist(configSignal());
  }

  return {
    rows,
    // The full server-returned set, BEFORE client filters, search and paging.
    // What `optionsFromRows` must read: feeding it the visible page collapsed a
    // filter's own option list to whatever was already selected, and hid any
    // distinct value that happened to fall on page 2.
    allRows: allRows.asReadonly(),
    total,
    loadedTotal,
    pageSize,
    page: page.asReadonly(),
    pageCount,
    isLoading: isLoading.asReadonly(),
    error: error.asReadonly(),
    query: query.asReadonly(),
    filterValues: filterValues.asReadonly(),
    includeInactive: includeInactive.asReadonly(),
    activeFilters,
    clientOnlyActive,
    serverParams,
    isEngaged,
    setQuery: (q: string) => {
      query.set(q);
      afterChange();
    },
    setFilter: (key: string, value: FilterValue) => {
      filterValues.update((v) => ({ ...v, [key]: value }));
      afterChange();
    },
    setIncludeInactive: (on: boolean) => {
      includeInactive.set(on);
      afterChange();
    },
    clearFilter: (key: string) => {
      const cfg = configSignal();
      const def = (cfg.filters ?? []).find((f) => f.key === key);
      filterValues.update((v) => ({ ...v, [key]: def?.kind === 'multiselect' ? [] : null }));
      afterChange();
    },
    clearAll: () => {
      const cfg = configSignal();
      filterValues.set(defaultsFor(cfg));
      query.set('');
      includeInactive.set(false);
      afterChange();
    },
    setPage: (p: number) => page.set(Math.min(Math.max(1, p), pageCount())),
    reload: () => load(configSignal(), toHttpParams(serverParams())),
  };
}
