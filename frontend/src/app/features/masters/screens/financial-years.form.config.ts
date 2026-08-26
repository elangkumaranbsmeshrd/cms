import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { formatDate, humanizeEnum } from '../../../shared/screens/cell-format';
import { FinancialYearRow } from '../masters.api';

// Mirrors financial_years.py's create_financial_year exactly: Label = the
// Start Date's calendar year, End Date = Start Date + 1 year − 1 day. Pure
// UTC integer math (no Date-string-parsing timezone ambiguity) so this can
// never silently disagree with the backend's own relativedelta arithmetic.
function endDateFrom(start: string): string | null {
  const [y, m, d] = (start ?? '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const end = new Date(Date.UTC(y + 1, m - 1, d));
  end.setUTCDate(end.getUTCDate() - 1);
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`;
}

// MASTER-BUILD-PROMPT.md §4.1: a real PUT now exists (financial_years.py) —
// Start Date and End Date are genuinely editable, not derived-and-frozen.
// What stays true from §3.1 is Invariant 4: a LOCKED year is still frozen
// for everyone, including Super Admin — `readOnlyWhen` below reproduces that
// at the record level (the screen has a real updateEndpoint; a locked
// INSTANCE still renders read-only, Save hidden, heading says "View").
// Reused for BOTH Add (no id) and Edit/View-an-existing-year (clicking a
// row — see financial-years.list.config.ts's rowRoute): FormScreenComponent
// handles that split via isEdit() + isReadOnlyRecord().
const config: FormScreenConfig<FinancialYearRow> = {
  shape: 'form',
  id: 'masters.financial_year',
  title: 'Financial Year',
  listEndpoint: '/masters/financial-years',
  createEndpoint: '/masters/financial-years',
  updateEndpoint: (id) => `/masters/financial-years/${id}`,
  readOnlyWhen: (fm) => fm.status === 'locked',
  rowId: (row) => row.id,
  listRoute: ['/masters/financial-years'],
  emptyRow: () => ({ start_date: '' as any }),
  // Same "FY 2030–31" shape as the list's own fyLabel() — the breadcrumb
  // trail should read the same name the row it came from does.
  recordLabel: (row) => {
    const start = String(row.start_date ?? '').slice(0, 4);
    const end = String(row.end_date ?? '').slice(2, 4);
    return start && end ? `FY ${start}–${end}` : row.label;
  },
  fields: [
    {
      key: 'start_date',
      label: 'Start Date',
      type: 'date',
      required: true,
      // No longer createOnly — PUT /masters/financial-years/{id} genuinely
      // accepts a new start_date on an open year (re-deriving Label to
      // match, same rule as create). readOnlyWhen above still freezes the
      // whole form once the loaded year is locked, matching Invariant 4.
      // The prototype's own hint here reads "Must be 1 April of a chosen
      // year", but this backend enforces no such thing — any start date is
      // accepted, and only a second year with the same calendar-year label
      // is rejected. The hint states what is actually true.
      hint: 'Everything below derives a default from this. One financial year per calendar year — a second year starting in the same year is rejected. Locking a year (from the list) freezes it — including this field — until it is unlocked.',
      span: 2,
    },
    // MASTER-BUILD-PROMPT.md §4.1: "make End Date an entered field, not a
    // derived one." Genuinely wired end-to-end now: FinancialYearCreate and
    // FinancialYearUpdate both accept it (financial_years.py), validated
    // server-side as > start_date. Left blank on create, the API applies the
    // same start+1y-1d default it always did; typed here, that value is what
    // actually gets saved — this is a real override, not a preview.
    {
      key: 'end_date',
      label: 'End Date',
      type: 'date',
      required: false,
      hint: 'Defaults to Start Date + 1 year − 1 day if left blank on create. Override only when this company\'s financial year genuinely is not exactly one year minus a day — do not assume it always is.',
      span: 2,
    },
  ],
  // Ported directly from the prototype's own Add Financial Year popup
  // (app-screens.js:297-313) — Start Date is the only real input; this
  // section is exactly what the prototype (and Masters §3.1's Screen
  // Design: "shown as a preview before saving") shows underneath it.
  //
  // On an EXISTING year these are no longer a preview of what saving WOULD
  // produce — formModel is the actually-loaded row, so each compute reads the
  // real field first and only falls back to the create-time default when
  // that field is genuinely absent (i.e. we're still on the Add screen).
  // Before this fix every one of these silently showed 'Open'/'No'/'—' even
  // for an already-locked year, because they read nothing but formModel's
  // start_date.
  previewFields: [
    {
      label: 'Financial Year Label',
      compute: (fm) => (fm.label as string | undefined) ?? (fm.start_date ? String(fm.start_date).split('-')[0] : '—'),
    },
    // End Date moved into `fields` above as a real, overridable input
    // (§4.1) — this preview line no longer duplicates it as a plain "End
    // Date" value. It stays only to show what the convenience default
    // actually computes to (form-screen.component.ts has no way to hide a
    // previewFields row conditionally, so this is worded to read correctly
    // whether or not the field above has been overridden — "the default is
    // X" is true either way, it's just not necessarily what gets saved once
    // overridden).
    {
      label: 'End Date — computed default (Start Date + 1yr − 1d)',
      compute: (fm) => formatDate(endDateFrom(fm.start_date as any)) || '—',
    },
    { label: 'Status', compute: (fm) => humanizeEnum(fm.status) || 'Open' },
    {
      label: 'Is Current Financial Year',
      compute: (fm) => (fm.is_current === undefined ? 'No' : fm.is_current ? 'Yes' : 'No'),
    },
    { label: 'Locked By', compute: (fm) => (fm.locked_by_name as string | null | undefined) || '—' },
    { label: 'Locked On', compute: (fm) => formatDate(fm.locked_at) || '—' },
  ],
};

export default config;
