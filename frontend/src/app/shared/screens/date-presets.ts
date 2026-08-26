// RBAC 14 §2.2(c), Date range: "a From/To pair on that screen's primary date,
// plus quick presets: This Month, Last Month, This Quarter, This Financial Year,
// Last Financial Year, Custom. Financial-year presets read Masters → Financial
// Year (Section 3.1), so they never hardcode a date."
//
// That last clause is the whole reason this file exists rather than a literal
// list: the FY presets are resolved from the real /masters/financial-years rows
// at call time. Nothing here assumes an April start — if Super Admin configures
// a different Start Date, the preset follows it, because it IS the row.
import { DateRangeValue } from './screen.types';

export interface FinancialYearLike {
  readonly id: string;
  readonly label?: string | null;
  readonly start_date: string;
  readonly end_date: string;
  readonly is_current?: boolean;
}

export const CUSTOM_PRESET = 'custom';
export const ALL_TIME_PRESET = 'all'; // §2.2e: Super Admin's "All financial years"

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// UTC throughout, for the same reason financial-years.form.config.ts is: a
// local-timezone Date silently shifts a boundary date by a day either side of
// UTC, which would put a 1-April record in the wrong financial year.
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export interface DatePreset {
  readonly value: string;
  readonly label: string;
  /** null = impose no bounds at all (All time / Custom-before-a-choice). */
  readonly resolve: () => { from: string; to: string } | null;
}

/** The calendar presets, which need no Masters data. */
function calendarPresets(): DatePreset[] {
  return [
    {
      value: 'this_month',
      label: 'This Month',
      resolve: () => {
        const t = utcToday();
        const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
        const to = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
        return { from: iso(from), to: iso(to) };
      },
    },
    {
      value: 'last_month',
      label: 'Last Month',
      resolve: () => {
        const t = utcToday();
        const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
        const to = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
        return { from: iso(from), to: iso(to) };
      },
    },
    {
      value: 'this_quarter',
      label: 'This Quarter',
      resolve: () => {
        const t = utcToday();
        const q = Math.floor(t.getUTCMonth() / 3);
        const from = new Date(Date.UTC(t.getUTCFullYear(), q * 3, 1));
        const to = new Date(Date.UTC(t.getUTCFullYear(), q * 3 + 3, 0));
        return { from: iso(from), to: iso(to) };
      },
    },
  ];
}

/** Builds the full preset list, including the financial-year entries derived
 * from the real Masters rows. `years` may be empty (not loaded yet, or the role
 * cannot read that endpoint) — in that case the FY presets are simply absent
 * rather than guessed at. */
export function buildDatePresets(years: readonly FinancialYearLike[]): DatePreset[] {
  const presets = calendarPresets();

  const sorted = [...years].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const current = sorted.find((y) => y.is_current) ?? sorted[0] ?? null;
  const currentIndex = current ? sorted.indexOf(current) : -1;
  const previous = currentIndex >= 0 ? sorted[currentIndex + 1] ?? null : null;

  if (current) {
    presets.push({
      value: 'this_fy',
      label: `This Financial Year (${current.label ?? current.start_date.slice(0, 4)})`,
      resolve: () => ({ from: current.start_date, to: current.end_date }),
    });
  }
  if (previous) {
    presets.push({
      value: 'last_fy',
      label: `Last Financial Year (${previous.label ?? previous.start_date.slice(0, 4)})`,
      resolve: () => ({ from: previous.start_date, to: previous.end_date }),
    });
  }
  // Every other configured year, so "look across them" is possible without
  // reaching for Custom and typing two dates.
  for (const y of sorted) {
    if (y === current || y === previous) continue;
    presets.push({
      value: `fy:${y.id}`,
      label: `FY ${y.label ?? y.start_date.slice(0, 4)}`,
      resolve: () => ({ from: y.start_date, to: y.end_date }),
    });
  }

  presets.push({ value: CUSTOM_PRESET, label: 'Custom…', resolve: () => null });
  return presets;
}

/** Resolves a stored filter value into concrete bounds. A 'custom' value keeps
 * whatever from/to the user typed; a named preset recomputes from today. */
export function resolveRange(
  value: DateRangeValue | null,
  presets: readonly DatePreset[],
): { from: string | null; to: string | null } {
  if (!value) return { from: null, to: null };
  if (!value.preset || value.preset === CUSTOM_PRESET) {
    return { from: value.from ?? null, to: value.to ?? null };
  }
  if (value.preset === ALL_TIME_PRESET) return { from: null, to: null };
  const hit = presets.find((p) => p.value === value.preset);
  const resolved = hit?.resolve() ?? null;
  return resolved ? { from: resolved.from, to: resolved.to } : { from: null, to: null };
}

/** Inclusive on both ends, comparing ISO date strings lexicographically —
 * valid because they are zero-padded fixed-width. */
export function withinRange(raw: unknown, from: string | null, to: string | null): boolean {
  const d = String(raw ?? '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
