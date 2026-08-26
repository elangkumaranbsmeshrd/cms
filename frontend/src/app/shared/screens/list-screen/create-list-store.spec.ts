/**
 * Layer 4 — shared spine (COMPLETE-TEST-PROMPT.md §"Frontend unit tests"):
 * `create-list-store` — "filter state, server-param composition, client
 * predicates, sessionStorage persistence". The doc calls this the highest-value
 * frontend file because ~50 list configs run through it.
 *
 * The section that carries the most weight is server-param composition, and the
 * reason is stated in create-list-store.ts's own header: `transport` is the
 * load-bearing member. A filter declared `transport: 'server'` MUST become a
 * real query param, because the same params are handed to the export URL — so
 * the exported PDF's "Filters:" header block states something true and the
 * exported rows are the on-screen rows (RBAC §2.2f). A filter with the wrong
 * transport sends nothing while the chip on screen still claims it is applied:
 * the row count never moves, the export silently contains everything, and
 * nothing anywhere reports a problem. This project has that exact bug in its
 * history, which is why the specs below assert the COMPOSED PARAMS AND THE REAL
 * OUTGOING REQUEST rather than just the store's internal filter state.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { CUSTOM_PRESET, DatePreset, buildDatePresets } from '../date-presets';
import { DateRangeValue, FilterDef, ListScreenConfig, NumberRangeValue } from '../screen.types';
import { createListStore } from './create-list-store';

interface Row {
  id: string;
  name: string;
  status: string;
  city: string;
  amount: number;
  joined_on: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Alpha Traders', status: 'ACTIVE', city: 'Coimbatore', amount: 100, joined_on: '2025-01-15' },
  { id: 'r2', name: 'Bravo Metals', status: 'INACTIVE', city: 'Chennai', amount: 250, joined_on: '2025-06-01' },
  { id: 'r3', name: 'Charlie Foods', status: 'ACTIVE', city: 'Chennai', amount: 900, joined_on: '2026-02-20' },
];

const ENDPOINT = '/spec-rows';
const URL = `${environment.apiBaseUrl}${ENDPOINT}`;

function listConfig(over: Partial<ListScreenConfig<Row>> = {}): ListScreenConfig<Row> {
  return {
    shape: 'list',
    id: 'spec.list',
    title: 'Spec List',
    endpoint: ENDPOINT,
    rowId: (row: Row) => row.id,
    columns: [{ key: 'name', header: 'Name' }],
    ...over,
  };
}

/** A status filter that the endpoint really does accept as a query param. */
function serverStatus(over: Partial<FilterDef<Row>> = {}): FilterDef<Row> {
  return { key: 'status', label: 'Status', kind: 'select', transport: 'server', ...over };
}

/** The same dimension, but applied in JS over the fetched array. */
function clientCity(over: Partial<FilterDef<Row>> = {}): FilterDef<Row> {
  return {
    key: 'city',
    label: 'City',
    kind: 'select',
    transport: 'client',
    predicate: (row: Row, value) => row.city === value,
    ...over,
  };
}

describe('create-list-store', () => {
  let httpMock: HttpTestingController;
  let lastSeen: TestRequest | null = null;

  beforeEach(() => {
    sessionStorage.clear();
    lastSeen = null;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function makeStore(cfg: ListScreenConfig<Row>, presets: readonly DatePreset[] = []) {
    const configSignal = signal<ListScreenConfig<Row>>(cfg);
    const presetsSignal = signal<readonly DatePreset[]>(presets);
    const store = TestBed.runInInjectionContext(() => createListStore<Row>(configSignal, presetsSignal));
    TestBed.flushEffects();
    return { store, configSignal, presetsSignal };
  }

  /** Run pending effects, then answer every outstanding list request with `rows`. */
  function settle(rows: Row[] = []): TestRequest[] {
    TestBed.flushEffects();
    const reqs = httpMock.match(() => true);
    for (const req of reqs) req.flush(rows);
    if (reqs.length) lastSeen = reqs[reqs.length - 1];
    return reqs;
  }

  /**
   * The request the screen would actually have sent, after everything settled.
   * A state change that does not alter the composed params legitimately causes
   * NO refetch — `serverParams` never reads a signal the config has switched
   * off — so this falls back to the most recent request the store did issue.
   */
  function lastRequest(rows: Row[] = []): TestRequest {
    settle(rows);
    if (!lastSeen) throw new Error('expected the store to have issued a list request');
    return lastSeen;
  }

  function paramMap(req: TestRequest): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const key of req.request.params.keys()) out[key] = req.request.params.getAll(key) ?? [];
    return out;
  }

  // =========================================================================
  // 1. Filter state
  // =========================================================================
  describe('filter state', () => {
    it('seeds each declared filter with its default, and a multiselect with an empty array', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            serverStatus({ defaultValue: 'ACTIVE' }),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
            clientCity(),
          ],
        }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE', tags: [], city: null });
    });

    it('sets a filter and reads it back', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);
      expect(store.filterValues()['status']).toBe('ACTIVE');
    });

    it('changing a filter replaces the previous value rather than accumulating', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);
      store.setFilter('status', 'INACTIVE');
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'INACTIVE' });
    });

    it('clearing one filter returns a select to null and a multiselect to an empty array', () => {
      const { store } = makeStore(
        listConfig({
          filters: [serverStatus(), { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' }],
        }),
      );
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      store.setFilter('tags', ['a', 'b']);
      settle(ROWS);

      store.clearFilter('status');
      store.clearFilter('tags');
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: null, tags: [] });
    });

    it('clearing one filter leaves the others alone', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus(), clientCity()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      store.setFilter('city', 'Chennai');
      settle(ROWS);

      store.clearFilter('status');
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: null, city: 'Chennai' });
    });

    it('clear-all restores the declared defaults and wipes search and include-inactive', () => {
      const { store } = makeStore(
        listConfig({
          searchParam: 'q',
          includeInactiveParam: 'include_inactive',
          filters: [
            serverStatus({ defaultValue: 'ACTIVE' }),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
          ],
        }),
      );
      settle(ROWS);
      store.setFilter('status', 'INACTIVE');
      store.setFilter('tags', ['x']);
      store.setQuery('bravo');
      store.setIncludeInactive(true);
      settle(ROWS);

      store.clearAll();
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE', tags: [] });
      expect(store.query()).toBe('');
      expect(store.includeInactive()).toBeFalse();
    });

    it('reports only the engaged filters as active chips', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            serverStatus(),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
            { key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server', param: 'joined_on' },
            { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server' },
          ],
        }),
      );
      settle(ROWS);
      expect(store.activeFilters().length).toBe(0);

      store.setFilter('status', 'ACTIVE');
      store.setFilter('tags', []); // an empty multiselect is NOT engaged
      store.setFilter('joined', { preset: null, from: null, to: null } as DateRangeValue);
      store.setFilter('amount', { min: null, max: null } as NumberRangeValue);
      settle(ROWS);
      expect(store.activeFilters().map((f) => f.key)).toEqual(['status']);

      store.setFilter('tags', ['a']);
      store.setFilter('joined', { preset: CUSTOM_PRESET, from: '2025-01-01', to: null } as DateRangeValue);
      store.setFilter('amount', { min: 10, max: null } as NumberRangeValue);
      settle(ROWS);
      expect(store.activeFilters().map((f) => f.key)).toEqual(['status', 'tags', 'joined', 'amount']);
    });

    it('a filter change resets paging back to page 1', () => {
      const many: Row[] = Array.from({ length: 60 }, (_, i) => ({
        id: `x${i}`,
        name: `Row ${i}`,
        status: 'ACTIVE',
        city: 'Chennai',
        amount: i,
        joined_on: '2025-01-01',
      }));
      const { store } = makeStore(listConfig({ defaultPageSize: 25, filters: [serverStatus()] }));
      settle(many);
      expect(store.pageCount()).toBe(3);

      store.setPage(3);
      expect(store.page()).toBe(3);

      store.setFilter('status', 'ACTIVE');
      settle(many);
      expect(store.page()).toBe(1);
      expect(store.rows().length).toBe(25);
    });

    it('clamps a page number to the real range', () => {
      const { store } = makeStore(listConfig({ defaultPageSize: 25 }));
      settle(ROWS);
      store.setPage(99);
      expect(store.page()).toBe(1);
      store.setPage(-4);
      expect(store.page()).toBe(1);
    });

    it('re-seeds from the new screen’s own defaults when the config changes', () => {
      const first = listConfig({ id: 'spec.first', filters: [serverStatus({ defaultValue: 'ACTIVE' })] });
      const second = listConfig({
        id: 'spec.second',
        filters: [{ key: 'kind', label: 'Kind', kind: 'select', transport: 'server', defaultValue: 'DRAFT' }],
      });
      const { store, configSignal } = makeStore(first);
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });

      configSignal.set(second);
      settle(ROWS);
      expect(store.filterValues()).toEqual({ kind: 'DRAFT' });
    });
  });

  // =========================================================================
  // 2. Server-param composition — the one with the bug history
  // =========================================================================
  describe('server-param composition', () => {
    it('a transport:"server" filter really does reach the outgoing query params', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus()] }));
      settle(ROWS);

      store.setFilter('status', 'ACTIVE');
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({ status: 'ACTIVE' });
      expect(req.request.params.get('status')).toBe('ACTIVE');
      expect(req.request.urlWithParams).toBe(`${URL}?status=ACTIVE`);
    });

    it('a transport:"client" filter is NOT sent to the server', () => {
      // The bug this guards: flipping `transport` to 'client' on a filter the
      // endpoint really does support leaves the chip on screen claiming the
      // filter is applied while the request carries nothing.
      const { store } = makeStore(listConfig({ filters: [serverStatus(), clientCity()] }));
      settle(ROWS);

      store.setFilter('status', 'ACTIVE');
      store.setFilter('city', 'Chennai');
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({ status: 'ACTIVE' });
      expect(req.request.params.has('city')).toBeFalse();
      expect(req.request.urlWithParams).not.toContain('city');
      expect(req.request.urlWithParams).toContain('status=ACTIVE');
      // …and the store says so out loud, which is what the export caveat reads.
      expect(store.clientOnlyActive()).toBeTrue();
    });

    it('sends the declared `param` name rather than the filter key when they differ', () => {
      const { store } = makeStore(
        listConfig({ filters: [serverStatus({ key: 'status', param: 'status_id' })] }),
      );
      settle(ROWS);
      store.setFilter('status', 'st-7');
      const req = lastRequest(ROWS);

      expect(paramMap(req)).toEqual({ status_id: ['st-7'] });
      expect(req.request.params.has('status')).toBeFalse();
    });

    it('repeats a multiselect as one param per value', () => {
      const { store } = makeStore(
        listConfig({ filters: [{ key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' }] }),
      );
      settle(ROWS);
      store.setFilter('tags', ['OPEN', 'CLOSED']);
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({ tags: ['OPEN', 'CLOSED'] });
      expect(req.request.params.getAll('tags')).toEqual(['OPEN', 'CLOSED']);
      expect(req.request.urlWithParams).toBe(`${URL}?tags=OPEN&tags=CLOSED`);
    });

    it('sends a tristate filter set to false, because "No" is a real choice', () => {
      const { store } = makeStore(
        listConfig({ filters: [{ key: 'locked', label: 'Locked', kind: 'tristate', transport: 'server' }] }),
      );
      settle(ROWS);
      store.setFilter('locked', false);
      const req = lastRequest(ROWS);
      expect(req.request.params.get('locked')).toBe('false');
    });

    it('splits a server daterange into <param>_from / <param>_to using the resolved preset', () => {
      const presets = buildDatePresets([
        { id: 'fy-2025', label: '2025-26', start_date: '2025-07-01', end_date: '2026-06-30', is_current: true },
      ]);
      const { store } = makeStore(
        listConfig({
          filters: [{ key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server', param: 'joined_on' }],
        }),
        presets,
      );
      settle(ROWS);

      store.setFilter('joined', { preset: 'this_fy', from: null, to: null } as DateRangeValue);
      const req = lastRequest(ROWS);

      // The FY comes from the row, not from an April–March assumption.
      expect(paramMap(req)).toEqual({ joined_on_from: ['2025-07-01'], joined_on_to: ['2026-06-30'] });
    });

    it('sends a custom daterange verbatim, including a one-sided one', () => {
      const { store } = makeStore(
        listConfig({
          filters: [{ key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server', param: 'joined_on' }],
        }),
      );
      settle(ROWS);

      store.setFilter('joined', { preset: CUSTOM_PRESET, from: '2025-01-01', to: '2025-12-31' } as DateRangeValue);
      expect(paramMap(lastRequest(ROWS))).toEqual({
        joined_on_from: ['2025-01-01'],
        joined_on_to: ['2025-12-31'],
      });

      store.setFilter('joined', { preset: CUSTOM_PRESET, from: null, to: '2025-12-31' } as DateRangeValue);
      expect(paramMap(lastRequest(ROWS))).toEqual({ joined_on_to: ['2025-12-31'] });
    });

    it('splits a server numberrange into <param>_min / <param>_max, keeping a zero bound', () => {
      const { store } = makeStore(
        listConfig({ filters: [{ key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server' }] }),
      );
      settle(ROWS);

      store.setFilter('amount', { min: 0, max: 500 } as NumberRangeValue);
      // 0 is a bound a user genuinely typed — it must not be dropped as falsy.
      expect(paramMap(lastRequest(ROWS))).toEqual({ amount_min: ['0'], amount_max: ['500'] });

      store.setFilter('amount', { min: 100, max: null } as NumberRangeValue);
      expect(paramMap(lastRequest(ROWS))).toEqual({ amount_min: ['100'] });
    });

    it('sends the trimmed search text under the configured search param', () => {
      const { store } = makeStore(listConfig({ searchParam: 'q' }));
      settle(ROWS);
      store.setQuery('  bravo  ');
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({ q: 'bravo' });
      expect(req.request.params.get('q')).toBe('bravo');
      expect(store.clientOnlyActive()).toBeFalse();
    });

    it('never sends a search param when the screen declares searchParam: false', () => {
      const { store } = makeStore(listConfig({ searchParam: false }));
      expect(paramMap(lastRequest(ROWS))).toEqual({});

      store.setQuery('bravo');
      TestBed.flushEffects();
      // Not merely absent from the params — the typed text never causes a
      // request at all, because serverParams does not read `query` on a screen
      // whose endpoint has no search param.
      expect(httpMock.match(() => true).length).toBe(0);
      expect(store.serverParams()).toEqual({});
      // Client-side search cannot round-trip, so the store discloses it.
      expect(store.clientOnlyActive()).toBeTrue();
    });

    it('sends include-inactive only while it is switched on', () => {
      const { store } = makeStore(listConfig({ includeInactiveParam: 'include_inactive' }));
      expect(paramMap(lastRequest(ROWS))).toEqual({});

      store.setIncludeInactive(true);
      expect(paramMap(lastRequest(ROWS))).toEqual({ include_inactive: ['true'] });

      store.setIncludeInactive(false);
      expect(paramMap(lastRequest(ROWS))).toEqual({});
    });

    it('never sends include-inactive on a screen that declares includeInactiveParam: false', () => {
      const { store } = makeStore(listConfig({ includeInactiveParam: false }));
      expect(paramMap(lastRequest(ROWS))).toEqual({});

      store.setIncludeInactive(true);
      TestBed.flushEffects();
      expect(httpMock.match(() => true).length).toBe(0);
      expect(store.serverParams()).toEqual({});
    });

    it('composes several server filters into one request at once', () => {
      const { store } = makeStore(
        listConfig({
          searchParam: 'q',
          includeInactiveParam: 'include_inactive',
          filters: [
            serverStatus({ param: 'status_code' }),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
            { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server' },
            clientCity(),
          ],
        }),
      );
      settle(ROWS);
      store.setQuery('alpha');
      store.setIncludeInactive(true);
      store.setFilter('status', 'ACTIVE');
      store.setFilter('tags', ['A']);
      store.setFilter('amount', { min: 50, max: 950 } as NumberRangeValue);
      store.setFilter('city', 'Chennai');

      expect(paramMap(lastRequest(ROWS))).toEqual({
        q: ['alpha'],
        include_inactive: ['true'],
        status_code: ['ACTIVE'],
        tags: ['A'],
        amount_min: ['50'],
        amount_max: ['950'],
      });
    });

    // -----------------------------------------------------------------------
    // Empty / absent values must never become empty query params
    // -----------------------------------------------------------------------
    it('sends no params at all when nothing is filtered', () => {
      const { store } = makeStore(
        listConfig({
          searchParam: 'q',
          includeInactiveParam: 'include_inactive',
          filters: [
            serverStatus(),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
            { key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server' },
            { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server' },
          ],
        }),
      );
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({});
      expect(req.request.params.keys()).toEqual([]);
      expect(req.request.urlWithParams).toBe(URL); // no trailing '?'
    });

    it('drops a null, an empty string and an empty multiselect instead of sending blanks', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            serverStatus(),
            { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
            { key: 'note', label: 'Note', kind: 'text', transport: 'server' },
          ],
        }),
      );
      settle(ROWS);
      store.setFilter('status', null);
      store.setFilter('tags', []);
      store.setFilter('note', '');
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({});
      expect(req.request.urlWithParams).toBe(URL);
      expect(req.request.urlWithParams).not.toContain('status=');
      expect(req.request.urlWithParams).not.toContain('note=');
    });

    it('drops a whitespace-only search rather than sending an empty q', () => {
      const { store } = makeStore(listConfig({ searchParam: 'q' }));
      settle(ROWS);
      store.setQuery('    ');
      expect(paramMap(lastRequest(ROWS))).toEqual({});
    });

    it('drops an unbounded daterange and an unbounded numberrange', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            { key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server', param: 'joined_on' },
            { key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'server' },
          ],
        }),
      );
      settle(ROWS);
      store.setFilter('joined', { preset: CUSTOM_PRESET, from: null, to: null } as DateRangeValue);
      store.setFilter('amount', { min: null, max: null } as NumberRangeValue);
      const req = lastRequest(ROWS);

      expect(store.serverParams()).toEqual({});
      expect(req.request.urlWithParams).toBe(URL);
      expect(req.request.urlWithParams).not.toContain('joined_on_from');
      expect(req.request.urlWithParams).not.toContain('amount_min');
    });

    it('clearing a filter removes its param from the next request', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      expect(paramMap(lastRequest(ROWS))).toEqual({ status: ['ACTIVE'] });

      store.clearFilter('status');
      expect(paramMap(lastRequest(ROWS))).toEqual({});
    });

    it('clear-all restores the declared default as the param, not a blank one', () => {
      const { store } = makeStore(
        listConfig({ searchParam: 'q', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      store.setFilter('status', 'INACTIVE');
      store.setQuery('bravo');
      expect(paramMap(lastRequest(ROWS))).toEqual({ status: ['INACTIVE'], q: ['bravo'] });

      store.clearAll();
      expect(paramMap(lastRequest(ROWS))).toEqual({ status: ['ACTIVE'] });
    });

    it('recomposes the FY params once the financial-year rows finally load', () => {
      // The presets signal is fed by an async /masters/financial-years read, so
      // a persisted this_fy value is composed BEFORE the rows exist. Nothing is
      // invented in the meantime; the store refetches with the real dates as
      // soon as they arrive.
      const { store, presetsSignal } = makeStore(
        listConfig({
          filters: [{ key: 'joined', label: 'Joined', kind: 'daterange', transport: 'server', param: 'joined_on' }],
        }),
        [],
      );
      settle(ROWS);
      store.setFilter('joined', { preset: 'this_fy', from: null, to: null } as DateRangeValue);
      expect(paramMap(lastRequest(ROWS))).toEqual({});

      presetsSignal.set(
        buildDatePresets([
          { id: 'fy-2025', label: '2025-26', start_date: '2025-07-01', end_date: '2026-06-30', is_current: true },
        ]),
      );
      expect(paramMap(lastRequest(ROWS))).toEqual({
        joined_on_from: ['2025-07-01'],
        joined_on_to: ['2026-06-30'],
      });
    });

    it('reload() re-issues the request with the same composed params', () => {
      const { store } = makeStore(listConfig({ filters: [serverStatus()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);

      store.reload();
      const req = httpMock.expectOne((r) => r.url === URL);
      expect(req.request.params.get('status')).toBe('ACTIVE');
      req.flush(ROWS);
    });

    it('surfaces the server’s detail message and stops loading on an error', () => {
      const { store } = makeStore(listConfig());
      TestBed.flushEffects();
      const reqs = httpMock.match(() => true);
      reqs[reqs.length - 1].flush({ detail: 'Not permitted' }, { status: 403, statusText: 'Forbidden' });
      for (const r of reqs.slice(0, -1)) r.flush(ROWS);

      expect(store.error()).toBe('Not permitted');
      expect(store.isLoading()).toBeFalse();
    });
  });

  // =========================================================================
  // 3. Client predicates
  // =========================================================================
  describe('client-side predicates', () => {
    it('a client filter genuinely narrows the row set while allRows stays whole', () => {
      const { store } = makeStore(listConfig({ filters: [clientCity()] }));
      settle(ROWS);
      expect(store.rows().length).toBe(3);

      store.setFilter('city', 'Chennai');
      settle(ROWS);

      expect(store.rows().map((r) => r.id)).toEqual(['r2', 'r3']);
      expect(store.total()).toBe(2);
      // The full fetched set is still available — the filter bar's own option
      // lists are built from it, so it must not collapse to the visible rows.
      expect(store.allRows().length).toBe(3);
      expect(store.loadedTotal()).toBe(3);
      expect(store.clientOnlyActive()).toBeTrue();
    });

    it('a client multiselect narrows to any of the chosen values', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            {
              key: 'city',
              label: 'City',
              kind: 'multiselect',
              transport: 'client',
              predicate: (row: Row, value) => (value as readonly string[]).includes(row.city),
            },
          ],
        }),
      );
      settle(ROWS);
      store.setFilter('city', ['Coimbatore', 'Chennai']);
      settle(ROWS);
      expect(store.rows().length).toBe(3);

      store.setFilter('city', ['Coimbatore']);
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r1']);
    });

    it('a client daterange with no predicate falls back to withinRange on the named field', () => {
      const { store } = makeStore(
        listConfig({
          filters: [{ key: 'joined', label: 'Joined', kind: 'daterange', transport: 'client', param: 'joined_on' }],
        }),
      );
      settle(ROWS);
      store.setFilter('joined', { preset: CUSTOM_PRESET, from: '2025-01-01', to: '2025-12-31' } as DateRangeValue);
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r1', 'r2']);
    });

    it('a client daterange resolves a financial-year preset from the real FY rows', () => {
      const presets = buildDatePresets([
        { id: 'fy-2025', label: '2025-26', start_date: '2025-07-01', end_date: '2026-06-30', is_current: true },
      ]);
      const { store } = makeStore(
        listConfig({
          filters: [{ key: 'joined', label: 'Joined', kind: 'daterange', transport: 'client', param: 'joined_on' }],
        }),
        presets,
      );
      settle(ROWS);
      store.setFilter('joined', { preset: 'this_fy', from: null, to: null } as DateRangeValue);
      settle(ROWS);
      // Only 20-Feb-2026 falls inside a July–June FY 2025-26.
      expect(store.rows().map((r) => r.id)).toEqual(['r3']);
    });

    it('a client numberrange filters inclusively on both bounds', () => {
      const { store } = makeStore(
        listConfig({ filters: [{ key: 'amount', label: 'Amount', kind: 'numberrange', transport: 'client' }] }),
      );
      settle(ROWS);

      store.setFilter('amount', { min: 100, max: 250 } as NumberRangeValue);
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r1', 'r2']);

      store.setFilter('amount', { min: 251, max: null } as NumberRangeValue);
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r3']);

      store.setFilter('amount', { min: null, max: 99 } as NumberRangeValue);
      settle(ROWS);
      expect(store.rows().length).toBe(0);
    });

    it('a client filter declared without a predicate leaves every row alone rather than dropping them all', () => {
      // Deliberate: an under-specified config must not blank the screen.
      const { store } = makeStore(
        listConfig({ filters: [{ key: 'city', label: 'City', kind: 'select', transport: 'client' }] }),
      );
      settle(ROWS);
      store.setFilter('city', 'Chennai');
      settle(ROWS);
      expect(store.rows().length).toBe(3);
      // …but it still counts as engaged, so the export caveat is shown.
      expect(store.clientOnlyActive()).toBeTrue();
    });

    it('stacks several client filters', () => {
      const { store } = makeStore(
        listConfig({
          filters: [
            clientCity(),
            {
              key: 'status',
              label: 'Status',
              kind: 'select',
              transport: 'client',
              predicate: (row: Row, value) => row.status === value,
            },
          ],
        }),
      );
      settle(ROWS);
      store.setFilter('city', 'Chennai');
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r3']);
    });

    it('a rowFilter narrows the screen and counts as a client-only restriction', () => {
      const { store } = makeStore(listConfig({ rowFilter: (row: Row) => row.status === 'ACTIVE' }));
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r1', 'r3']);
      expect(store.loadedTotal()).toBe(2);
      expect(store.allRows().length).toBe(3);
      // The server never saw it, so an export from this tab would carry rows
      // the screen does not show.
      expect(store.clientOnlyActive()).toBeTrue();
      expect(store.serverParams()).toEqual({});
    });

    it('client-side search only looks at the declared searchFields', () => {
      const { store } = makeStore(listConfig({ searchParam: false, searchFields: ['name'] }));
      settle(ROWS);

      store.setQuery('brav');
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r2']);

      // 'r2' is an id, not a name — a search over the whole row would match it.
      store.setQuery('r2');
      settle(ROWS);
      expect(store.rows().length).toBe(0);
    });

    it('client-side search falls back to the whole row when no searchFields are declared', () => {
      const { store } = makeStore(listConfig({ searchParam: false }));
      settle(ROWS);
      store.setQuery('r2');
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r2']);
    });

    it('client-side search runs after the filters, so the count reads against the filtered set', () => {
      const { store } = makeStore(
        listConfig({ searchParam: false, searchFields: ['name'], filters: [clientCity()] }),
      );
      settle(ROWS);
      store.setFilter('city', 'Chennai');
      store.setQuery('a');
      settle(ROWS);
      expect(store.rows().map((r) => r.id)).toEqual(['r2', 'r3']);
      expect(store.total()).toBe(2);
      expect(store.loadedTotal()).toBe(3);
    });

    it('does not report client-only when the engaged filters are all server-side', () => {
      const { store } = makeStore(listConfig({ searchParam: 'q', filters: [serverStatus(), clientCity()] }));
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      store.setQuery('alpha');
      settle(ROWS);
      expect(store.clientOnlyActive()).toBeFalse();
    });

    it('treats a non-array response as an empty list rather than crashing', () => {
      const { store } = makeStore(listConfig());
      TestBed.flushEffects();
      const reqs = httpMock.match(() => true);
      for (const req of reqs) req.flush({ items: [] } as unknown as Row[]);
      expect(store.allRows()).toEqual([]);
      expect(store.rows()).toEqual([]);
      expect(store.total()).toBe(0);
    });
  });

  // =========================================================================
  // 4. sessionStorage persistence
  // =========================================================================
  describe('sessionStorage persistence', () => {
    it('round-trips filters, search and include-inactive for the same screen', () => {
      const cfg = listConfig({
        id: 'spec.persist',
        searchParam: false,
        includeInactiveParam: 'include_inactive',
        filters: [
          serverStatus(),
          { key: 'tags', label: 'Tags', kind: 'multiselect', transport: 'server' },
          { key: 'joined', label: 'Joined', kind: 'daterange', transport: 'client', param: 'joined_on' },
        ],
      });
      const first = makeStore(cfg);
      settle(ROWS);
      first.store.setFilter('status', 'ACTIVE');
      first.store.setFilter('tags', ['A', 'B']);
      first.store.setFilter('joined', {
        preset: CUSTOM_PRESET,
        from: '2025-01-01',
        to: '2025-12-31',
      } as DateRangeValue);
      first.store.setQuery('bravo');
      first.store.setIncludeInactive(true);
      settle(ROWS);

      const second = makeStore(cfg);
      settle(ROWS);
      expect(second.store.filterValues()).toEqual({
        status: 'ACTIVE',
        tags: ['A', 'B'],
        joined: { preset: CUSTOM_PRESET, from: '2025-01-01', to: '2025-12-31' },
      });
      expect(second.store.query()).toBe('bravo');
      expect(second.store.includeInactive()).toBeTrue();
    });

    it('writes under a per-screen key so one screen cannot restore another’s filters', () => {
      const cfg = listConfig({ id: 'spec.a', filters: [serverStatus()] });
      const { store } = makeStore(cfg);
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);

      const raw = sessionStorage.getItem('list-filters:spec.a');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({ values: { status: 'ACTIVE' }, q: '', inactive: false });

      const other = makeStore(listConfig({ id: 'spec.b', filters: [serverStatus()] }));
      settle(ROWS);
      expect(other.store.filterValues()).toEqual({ status: null });
    });

    it('a restored server filter is composed straight back into the query params', () => {
      // Persistence is only worth anything if the restored value actually
      // reaches the wire on the next visit.
      const cfg = listConfig({ id: 'spec.restore', filters: [serverStatus({ param: 'status_code' })] });
      const first = makeStore(cfg);
      settle(ROWS);
      first.store.setFilter('status', 'ACTIVE');
      settle(ROWS);

      makeStore(cfg);
      expect(paramMap(lastRequest(ROWS))).toEqual({ status_code: ['ACTIVE'] });
    });

    it('persists a cleared state too, so clear-all is not undone by the next visit', () => {
      const cfg = listConfig({ id: 'spec.cleared', filters: [serverStatus({ defaultValue: 'ACTIVE' })] });
      const first = makeStore(cfg);
      settle(ROWS);
      first.store.setFilter('status', 'INACTIVE');
      settle(ROWS);
      first.store.clearAll();
      settle(ROWS);

      const second = makeStore(cfg);
      settle(ROWS);
      expect(second.store.filterValues()).toEqual({ status: 'ACTIVE' });
    });

    it('falls back to the declared defaults when nothing is stored', () => {
      const { store } = makeStore(
        listConfig({ id: 'spec.absent', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });
      expect(store.query()).toBe('');
      expect(store.includeInactive()).toBeFalse();
    });

    it('does not throw on a corrupt stored value — it falls back to the defaults', () => {
      sessionStorage.setItem('list-filters:spec.corrupt', '{"values": {broken');
      const { store } = makeStore(
        listConfig({ id: 'spec.corrupt', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });
    });

    it('does not throw on stored JSON of the wrong shape', () => {
      sessionStorage.setItem('list-filters:spec.shape', '"a bare string"');
      const { store } = makeStore(
        listConfig({ id: 'spec.shape', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });
      expect(store.query()).toBe('');
      expect(store.includeInactive()).toBeFalse();
    });

    it('does not throw on a stored literal null', () => {
      sessionStorage.setItem('list-filters:spec.null', 'null');
      const { store } = makeStore(
        listConfig({ id: 'spec.null', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });
    });

    it('survives a browser where sessionStorage itself throws (private mode)', () => {
      // A Safari private window throws SecurityError on both read and write.
      // The store must simply not persist rather than take the screen down.
      spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError: storage is disabled');
      spyOn(Storage.prototype, 'setItem').and.throwError('SecurityError: storage is disabled');

      const { store } = makeStore(
        listConfig({ id: 'spec.private', filters: [serverStatus({ defaultValue: 'ACTIVE' })] }),
      );
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });

      expect(() => store.setFilter('status', 'INACTIVE')).not.toThrow();
      expect(() => store.clearAll()).not.toThrow();
      expect(() => store.setQuery('bravo')).not.toThrow();
      settle(ROWS);
      expect(store.query()).toBe('bravo');
      expect(paramMap(lastRequest(ROWS))).toEqual({ status: ['ACTIVE'] });
    });

    it('restores each screen’s own filters when the config signal switches between them', () => {
      const a = listConfig({ id: 'spec.switch.a', filters: [serverStatus()] });
      const b = listConfig({
        id: 'spec.switch.b',
        filters: [{ key: 'kind', label: 'Kind', kind: 'select', transport: 'server' }],
      });
      sessionStorage.setItem(
        'list-filters:spec.switch.b',
        JSON.stringify({ values: { kind: 'DRAFT' }, q: 'note', inactive: true }),
      );

      const { store, configSignal } = makeStore(a);
      settle(ROWS);
      store.setFilter('status', 'ACTIVE');
      settle(ROWS);

      configSignal.set(b);
      settle(ROWS);
      expect(store.filterValues()).toEqual({ kind: 'DRAFT' });
      expect(store.query()).toBe('note');
      expect(store.includeInactive()).toBeTrue();

      configSignal.set(a);
      settle(ROWS);
      expect(store.filterValues()).toEqual({ status: 'ACTIVE' });
      expect(store.query()).toBe('');
    });
  });
});
