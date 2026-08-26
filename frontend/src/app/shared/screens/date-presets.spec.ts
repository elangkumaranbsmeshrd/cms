/**
 * Layer 4 — shared spine (COMPLETE-TEST-PROMPT.md §"Frontend unit tests"):
 * `date-presets` — "every preset, especially financial-year ones reading real
 * FY rows".
 *
 * The reason the FY half of this file carries most of the weight: date-presets.ts
 * opens by quoting RBAC 14 §2.2(c) — "Financial-year presets read Masters →
 * Financial Year (Section 3.1), so they never hardcode a date." That claim is
 * only worth anything if a test proves it, and the only way to prove it is to
 * feed the builder financial years that are NOT April–March and assert the
 * resolved range comes back as those rows' own start_date/end_date. Every FY
 * fixture below is therefore deliberately July–June (and one is a calendar
 * year), so a hardcoded 01-04 → 31-03 assumption anywhere in the resolver would
 * fail these specs rather than pass them by coincidence.
 *
 * The calendar presets are pinned against a mocked clock, because "This Month"
 * on the 15th of a leap-year February and "Last Month" on the 15th of January
 * are exactly the two month-arithmetic boundaries that silently produce an
 * Invalid Date or a 30-day February.
 */
import {
  ALL_TIME_PRESET,
  CUSTOM_PRESET,
  DatePreset,
  FinancialYearLike,
  buildDatePresets,
  resolveRange,
  withinRange,
} from './date-presets';

// A July–June financial year, on purpose. If anything in the resolver assumed
// India's April–March default rather than reading the row, these dates would
// not come back.
const FY_2023: FinancialYearLike = {
  id: 'fy-2023',
  label: '2023-24',
  start_date: '2023-07-01',
  end_date: '2024-06-30',
};
const FY_2024: FinancialYearLike = {
  id: 'fy-2024',
  label: '2024-25',
  start_date: '2024-07-01',
  end_date: '2025-06-30',
};
const FY_2025: FinancialYearLike = {
  id: 'fy-2025',
  label: '2025-26',
  start_date: '2025-07-01',
  end_date: '2026-06-30',
  is_current: true,
};

function preset(list: readonly DatePreset[], value: string): DatePreset {
  const hit = list.find((p) => p.value === value);
  if (!hit) throw new Error(`preset '${value}' was not built; got: ${list.map((p) => p.value).join(', ')}`);
  return hit;
}

function values(list: readonly DatePreset[]): string[] {
  return list.map((p) => p.value);
}

/** An independent last-day-of-month, not the implementation's Date.UTC(y, m+1, 0) trick. */
function lastDayOfMonth(year: number, monthIndex1Based: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monthIndex1Based === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return table[monthIndex1Based - 1];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

describe('date-presets', () => {
  // -------------------------------------------------------------------------
  // Which presets exist at all
  // -------------------------------------------------------------------------
  describe('buildDatePresets — the preset list', () => {
    it('builds every preset in declaration order when the FY rows are present', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      expect(values(list)).toEqual([
        'this_month',
        'last_month',
        'this_quarter',
        'this_fy',
        'last_fy',
        'fy:fy-2023',
        CUSTOM_PRESET,
      ]);
    });

    it('every preset carries a non-empty human label', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      for (const p of list) {
        expect(p.label).toBeTruthy();
        expect(p.label).not.toContain('undefined');
        expect(p.label).not.toContain('[object Object]');
      }
    });

    it('every preset resolves to either null bounds or a well-formed yyyy-mm-dd pair', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      for (const p of list) {
        const range = p.resolve();
        if (range === null) continue;
        expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(range.from <= range.to).toBeTrue();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Calendar presets — pinned to a fixed clock so month arithmetic is provable
  // -------------------------------------------------------------------------
  describe('calendar presets against a fixed clock', () => {
    afterEach(() => {
      jasmine.clock().uninstall();
    });

    function at(year: number, monthIndex0: number, day: number): readonly DatePreset[] {
      jasmine.clock().install();
      // Local-time construction on purpose: date-presets.ts's utcToday() reads
      // the LOCAL calendar parts and re-stamps them at UTC midnight, precisely
      // so the boundary date does not drift a day either side of UTC.
      jasmine.clock().mockDate(new Date(year, monthIndex0, day, 12, 0, 0));
      return buildDatePresets([]);
    }

    it('This Month spans the whole of a leap-year February', () => {
      const list = at(2024, 1, 15);
      expect(preset(list, 'this_month').resolve()).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    });

    it('This Month spans the whole of a non-leap February', () => {
      const list = at(2023, 1, 15);
      expect(preset(list, 'this_month').resolve()).toEqual({ from: '2023-02-01', to: '2023-02-28' });
    });

    it('This Month is correct on the last day of a 31-day month', () => {
      const list = at(2025, 0, 31);
      expect(preset(list, 'this_month').resolve()).toEqual({ from: '2025-01-01', to: '2025-01-31' });
    });

    it('This Month is correct on the first day of a 30-day month', () => {
      const list = at(2025, 8, 1);
      expect(preset(list, 'this_month').resolve()).toEqual({ from: '2025-09-01', to: '2025-09-30' });
    });

    it('Last Month steps back one month within the same year', () => {
      const list = at(2024, 11, 15);
      expect(preset(list, 'last_month').resolve()).toEqual({ from: '2024-11-01', to: '2024-11-30' });
    });

    it('Last Month rolls back across the year boundary', () => {
      const list = at(2025, 0, 15);
      expect(preset(list, 'last_month').resolve()).toEqual({ from: '2024-12-01', to: '2024-12-31' });
    });

    it('Last Month from the 31st does not overflow into a short month', () => {
      // The classic month-arithmetic trap: 31 March minus one month.
      const list = at(2025, 2, 31);
      expect(preset(list, 'last_month').resolve()).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    });

    it('This Quarter covers Jan–Mar in Q1', () => {
      const list = at(2025, 1, 10);
      expect(preset(list, 'this_quarter').resolve()).toEqual({ from: '2025-01-01', to: '2025-03-31' });
    });

    it('This Quarter covers Apr–Jun in Q2', () => {
      const list = at(2025, 4, 10);
      expect(preset(list, 'this_quarter').resolve()).toEqual({ from: '2025-04-01', to: '2025-06-30' });
    });

    it('This Quarter covers Jul–Sep in Q3', () => {
      const list = at(2025, 7, 10);
      expect(preset(list, 'this_quarter').resolve()).toEqual({ from: '2025-07-01', to: '2025-09-30' });
    });

    it('This Quarter covers Oct–Dec in Q4, on the very last day of the year', () => {
      const list = at(2025, 11, 31);
      expect(preset(list, 'this_quarter').resolve()).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    });

    it('the quarter preset is the CALENDAR quarter, independent of the configured financial year', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2025, 7, 10, 12, 0, 0)); // 10 Aug 2025
      // FY runs July–June here; This Quarter must still be Jul–Sep, and must
      // not be silently re-based onto the FY start.
      const list = buildDatePresets([FY_2025]);
      expect(preset(list, 'this_quarter').resolve()).toEqual({ from: '2025-07-01', to: '2025-09-30' });
    });
  });

  describe('calendar presets against the real clock', () => {
    it('This Month starts on the 1st of today’s month and ends on its real last day', () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      const range = preset(buildDatePresets([]), 'this_month').resolve();
      expect(range).toEqual({
        from: `${y}-${pad(m)}-01`,
        to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`,
      });
    });

    it('Last Month ends the day before This Month starts', () => {
      const list = buildDatePresets([]);
      const thisMonth = preset(list, 'this_month').resolve();
      const lastMonth = preset(list, 'last_month').resolve();
      expect(thisMonth).not.toBeNull();
      expect(lastMonth).not.toBeNull();
      const gapDays =
        (Date.parse(`${thisMonth!.from}T00:00:00Z`) - Date.parse(`${lastMonth!.to}T00:00:00Z`)) / 86_400_000;
      expect(gapDays).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Financial-year presets — the ones the doc singles out
  // -------------------------------------------------------------------------
  describe('financial-year presets read the real FY rows', () => {
    it('This Financial Year resolves to the current row’s own start_date/end_date, not April–March', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      const range = preset(list, 'this_fy').resolve();
      expect(range).toEqual({ from: FY_2025.start_date, to: FY_2025.end_date });
      // Said explicitly, because this is the assertion the spec's "never
      // hardcode a date" clause actually rests on.
      expect(range!.from).toBe('2025-07-01');
      expect(range!.from.endsWith('-04-01')).toBeFalse();
      expect(range!.to.endsWith('-03-31')).toBeFalse();
    });

    it('Last Financial Year resolves to the row immediately older than the current one', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      expect(preset(list, 'last_fy').resolve()).toEqual({ from: FY_2024.start_date, to: FY_2024.end_date });
    });

    it('follows an entirely different FY convention — a calendar-year FY resolves Jan→Dec', () => {
      const calendarFy: FinancialYearLike = {
        id: 'fy-cal',
        label: 'CY2026',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: true,
      };
      const prior: FinancialYearLike = {
        id: 'fy-cal-prev',
        label: 'CY2025',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
      };
      const list = buildDatePresets([prior, calendarFy]);
      expect(preset(list, 'this_fy').resolve()).toEqual({ from: '2026-01-01', to: '2026-12-31' });
      expect(preset(list, 'last_fy').resolve()).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });

    it('resolves a non-standard FY that is not even twelve months long', () => {
      // A transition/stub year — Masters allows any start/end pair, so the
      // preset must simply carry them through.
      const stub: FinancialYearLike = {
        id: 'fy-stub',
        label: 'Transition',
        start_date: '2026-07-01',
        end_date: '2026-09-30',
        is_current: true,
      };
      const list = buildDatePresets([stub]);
      expect(preset(list, 'this_fy').resolve()).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    });

    it('labels the FY presets from the row’s own label', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      expect(preset(list, 'this_fy').label).toBe('This Financial Year (2025-26)');
      expect(preset(list, 'last_fy').label).toBe('Last Financial Year (2024-25)');
      expect(preset(list, 'fy:fy-2023').label).toBe('FY 2023-24');
    });

    it('falls back to the start year when a row has no label', () => {
      const unlabelled: FinancialYearLike = { id: 'fy-x', start_date: '2027-07-01', end_date: '2028-06-30' };
      const list = buildDatePresets([unlabelled]);
      expect(preset(list, 'this_fy').label).toBe('This Financial Year (2027)');
    });

    it('tolerates a null label the same way as an absent one', () => {
      const nulled: FinancialYearLike = {
        id: 'fy-n',
        label: null,
        start_date: '2027-07-01',
        end_date: '2028-06-30',
      };
      expect(preset(buildDatePresets([nulled]), 'this_fy').label).toBe('This Financial Year (2027)');
    });

    it('honours is_current even when it is not the newest row, and picks the next-older as Last FY', () => {
      // Masters lets Super Admin set a past year current while a future year
      // already exists; the presets must follow the flag, not the sort order.
      const future: FinancialYearLike = { id: 'fy-2026', label: '2026-27', start_date: '2026-07-01', end_date: '2027-06-30' };
      const list = buildDatePresets([FY_2023, FY_2024, future]);
      const withFlag = buildDatePresets([
        FY_2023,
        { ...FY_2024, is_current: true },
        future,
      ]);
      // Without any flag, the newest row wins.
      expect(preset(list, 'this_fy').resolve()).toEqual({ from: future.start_date, to: future.end_date });
      expect(preset(list, 'last_fy').resolve()).toEqual({ from: FY_2024.start_date, to: FY_2024.end_date });
      // With the flag on the middle row, that row wins and the future year is
      // still offered as its own fy:<id> entry.
      expect(preset(withFlag, 'this_fy').resolve()).toEqual({ from: FY_2024.start_date, to: FY_2024.end_date });
      expect(preset(withFlag, 'last_fy').resolve()).toEqual({ from: FY_2023.start_date, to: FY_2023.end_date });
      expect(preset(withFlag, 'fy:fy-2026').resolve()).toEqual({ from: future.start_date, to: future.end_date });
    });

    it('sorts by start_date regardless of the order the API returned the rows in', () => {
      const shuffled = buildDatePresets([FY_2024, FY_2025, FY_2023]);
      expect(values(shuffled)).toEqual([
        'this_month',
        'last_month',
        'this_quarter',
        'this_fy',
        'last_fy',
        'fy:fy-2023',
        CUSTOM_PRESET,
      ]);
      expect(preset(shuffled, 'this_fy').resolve()).toEqual({ from: FY_2025.start_date, to: FY_2025.end_date });
    });

    it('offers every remaining configured year as its own fy:<id> preset', () => {
      const older: FinancialYearLike = { id: 'fy-2022', label: '2022-23', start_date: '2022-07-01', end_date: '2023-06-30' };
      const list = buildDatePresets([older, FY_2023, FY_2024, FY_2025]);
      expect(values(list).filter((v) => v.startsWith('fy:'))).toEqual(['fy:fy-2023', 'fy:fy-2022']);
      expect(preset(list, 'fy:fy-2022').resolve()).toEqual({ from: older.start_date, to: older.end_date });
      expect(preset(list, 'fy:fy-2023').resolve()).toEqual({ from: FY_2023.start_date, to: FY_2023.end_date });
    });

    it('does not duplicate the current/previous years into the fy:<id> tail', () => {
      const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);
      expect(values(list)).not.toContain('fy:fy-2025');
      expect(values(list)).not.toContain('fy:fy-2024');
    });

    it('does not mutate the caller’s FY array while sorting', () => {
      const rows = [FY_2024, FY_2025, FY_2023];
      buildDatePresets(rows);
      expect(rows.map((r) => r.id)).toEqual(['fy-2024', 'fy-2025', 'fy-2023']);
    });
  });

  // -------------------------------------------------------------------------
  // Degenerate cases the doc calls out explicitly
  // -------------------------------------------------------------------------
  describe('degenerate FY data', () => {
    it('with no FY rows at all, omits the FY presets rather than guessing at them', () => {
      const list = buildDatePresets([]);
      expect(values(list)).toEqual(['this_month', 'last_month', 'this_quarter', CUSTOM_PRESET]);
      expect(values(list)).not.toContain('this_fy');
      expect(values(list)).not.toContain('last_fy');
    });

    it('with exactly one FY row, offers This FY but no Last FY', () => {
      const list = buildDatePresets([FY_2025]);
      expect(values(list)).toEqual(['this_month', 'last_month', 'this_quarter', 'this_fy', CUSTOM_PRESET]);
      expect(preset(list, 'this_fy').resolve()).toEqual({ from: FY_2025.start_date, to: FY_2025.end_date });
    });

    it('a stored this_fy value resolves to no bounds when the FY rows have not loaded', () => {
      // The real transient: the list store composes its params before
      // /masters/financial-years answers (or for a role that cannot read it).
      // No bounds is the honest answer — the alternative would be inventing a
      // financial year, which is exactly what this file exists to avoid.
      expect(resolveRange({ preset: 'this_fy', from: null, to: null }, buildDatePresets([]))).toEqual({
        from: null,
        to: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Custom + resolveRange
  // -------------------------------------------------------------------------
  describe('the Custom preset', () => {
    it('is always offered, and resolves to null bounds by itself', () => {
      expect(preset(buildDatePresets([]), CUSTOM_PRESET).resolve()).toBeNull();
      expect(preset(buildDatePresets([FY_2025]), CUSTOM_PRESET).label).toBe('Custom…');
    });

    it('keeps the dates the user typed', () => {
      const list = buildDatePresets([FY_2025]);
      expect(resolveRange({ preset: CUSTOM_PRESET, from: '2026-01-01', to: '2026-03-31' }, list)).toEqual({
        from: '2026-01-01',
        to: '2026-03-31',
      });
    });

    it('with no dates at all resolves to no bounds and does not throw', () => {
      const list = buildDatePresets([FY_2025]);
      expect(resolveRange({ preset: CUSTOM_PRESET, from: null, to: null }, list)).toEqual({
        from: null,
        to: null,
      });
    });

    it('accepts a one-sided custom range', () => {
      const list = buildDatePresets([FY_2025]);
      expect(resolveRange({ preset: CUSTOM_PRESET, from: '2026-01-01', to: null }, list)).toEqual({
        from: '2026-01-01',
        to: null,
      });
      expect(resolveRange({ preset: CUSTOM_PRESET, from: null, to: '2026-03-31' }, list)).toEqual({
        from: null,
        to: '2026-03-31',
      });
    });
  });

  describe('resolveRange', () => {
    const list = buildDatePresets([FY_2023, FY_2024, FY_2025]);

    it('returns no bounds for a null value', () => {
      expect(resolveRange(null, list)).toEqual({ from: null, to: null });
    });

    it('treats a value with no preset as a raw From/To pair', () => {
      expect(resolveRange({ preset: null, from: '2025-08-01', to: '2025-08-31' }, list)).toEqual({
        from: '2025-08-01',
        to: '2025-08-31',
      });
    });

    it('resolves this_fy through the preset list to the real row dates', () => {
      expect(resolveRange({ preset: 'this_fy', from: null, to: null }, list)).toEqual({
        from: FY_2025.start_date,
        to: FY_2025.end_date,
      });
    });

    it('resolves last_fy and an explicit fy:<id> the same way', () => {
      expect(resolveRange({ preset: 'last_fy', from: null, to: null }, list)).toEqual({
        from: FY_2024.start_date,
        to: FY_2024.end_date,
      });
      expect(resolveRange({ preset: 'fy:fy-2023', from: null, to: null }, list)).toEqual({
        from: FY_2023.start_date,
        to: FY_2023.end_date,
      });
    });

    it('ignores any stale from/to carried alongside a named preset', () => {
      // The stored value keeps the user's last custom dates; a named preset
      // must recompute rather than leak them.
      expect(resolveRange({ preset: 'this_fy', from: '1999-01-01', to: '1999-12-31' }, list)).toEqual({
        from: FY_2025.start_date,
        to: FY_2025.end_date,
      });
    });

    it('imposes no bounds for the All-financial-years preset, even with dates present', () => {
      expect(resolveRange({ preset: ALL_TIME_PRESET, from: '2025-01-01', to: '2025-12-31' }, list)).toEqual({
        from: null,
        to: null,
      });
    });

    it('returns no bounds — not a crash — for a preset value nothing in the list knows', () => {
      expect(resolveRange({ preset: 'fy:deleted-year', from: null, to: null }, list)).toEqual({
        from: null,
        to: null,
      });
    });

    it('returns no bounds against an empty preset list', () => {
      expect(resolveRange({ preset: 'this_fy', from: null, to: null }, [])).toEqual({ from: null, to: null });
    });
  });

  // -------------------------------------------------------------------------
  // withinRange — the client-side half of every daterange filter
  // -------------------------------------------------------------------------
  describe('withinRange', () => {
    it('is inclusive on both ends', () => {
      expect(withinRange('2025-07-01', '2025-07-01', '2026-06-30')).toBeTrue();
      expect(withinRange('2026-06-30', '2025-07-01', '2026-06-30')).toBeTrue();
    });

    it('excludes a day either side of the range', () => {
      expect(withinRange('2025-06-30', '2025-07-01', '2026-06-30')).toBeFalse();
      expect(withinRange('2026-07-01', '2025-07-01', '2026-06-30')).toBeFalse();
    });

    it('compares only the date half of a timestamp', () => {
      expect(withinRange('2026-06-30T23:59:59Z', '2025-07-01', '2026-06-30')).toBeTrue();
      expect(withinRange('2026-07-01T00:00:00Z', '2025-07-01', '2026-06-30')).toBeFalse();
    });

    it('applies a one-sided bound', () => {
      expect(withinRange('2025-01-01', '2024-01-01', null)).toBeTrue();
      expect(withinRange('2023-01-01', '2024-01-01', null)).toBeFalse();
      expect(withinRange('2023-01-01', null, '2024-01-01')).toBeTrue();
      expect(withinRange('2025-01-01', null, '2024-01-01')).toBeFalse();
    });

    it('keeps any real date when both bounds are absent', () => {
      expect(withinRange('2025-01-01', null, null)).toBeTrue();
    });

    it('drops a row whose date is null, undefined or empty rather than throwing', () => {
      expect(withinRange(null, null, null)).toBeFalse();
      expect(withinRange(undefined, null, null)).toBeFalse();
      expect(withinRange('', '2025-01-01', '2025-12-31')).toBeFalse();
      expect(withinRange(null, '2025-01-01', '2025-12-31')).toBeFalse();
    });

    it('does not produce NaN or Invalid Date for junk input', () => {
      expect(() => withinRange({ nope: true }, '2025-01-01', '2025-12-31')).not.toThrow();
      expect(withinRange({ nope: true }, '2025-01-01', '2025-12-31')).toBeFalse();
    });
  });
});
