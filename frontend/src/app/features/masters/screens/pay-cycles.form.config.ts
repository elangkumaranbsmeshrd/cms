import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { PayCycleRow } from '../masters.api';

// ck_pay_cycles_type's real value set; labels are the prototype's own
// (app-forms.js 'm.paycycle').
const CYCLE_TYPE_OPTIONS = [
  { value: 'FIXED_CYCLE', label: 'Fixed Cycle — Custom Start/End Day' },
  { value: 'CALENDAR_MONTH', label: 'Calendar Month (1st to last day)' },
];

// ck_pay_cycles_start / _end / _credit are all "BETWEEN 1 AND 31". Advisory
// only — the API stays the authority — but it spares a round-trip for the
// obvious typo.
const DAY_OF_MONTH = { re: /^([1-9]|[12][0-9]|3[01])$/, message: 'Must be a day of the month, 1–31.' };

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** dd-mm-yyyy for a (year, monthIndex, day), with the month index normalised
 * (so -1 rolls back a year) and the day clamped to that month's real length —
 * which is exactly §3.20c's own rule for Salary Credit Day: "a Credit Day of
 * 30 or 31 still resolves inside February, rather than silently rolling into
 * March". Built through Date.UTC so a browser east or west of UTC cannot shift
 * a boundary date by one. */
function dayStamp(year: number, monthIndex: number, day: number): string {
  const anchor = new Date(Date.UTC(year, monthIndex, 1));
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dd = Math.min(Math.max(1, Math.trunc(day)), lastDay);
  return `${String(dd).padStart(2, '0')}-${String(m + 1).padStart(2, '0')}-${y}`;
}

/** The period month this cycle first applies to — taken from Effective From,
 * which is the only date the form actually carries. */
function anchorMonth(model: Partial<PayCycleRow>): { year: number; monthIndex: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(model.effective_from ?? ''));
  return m ? { year: Number(m[1]), monthIndex: Number(m[2]) - 1 } : null;
}

/** Masters §3.20c: "Resolved Periods — not stored, computed live from Start
 * Day, End Day and Salary Credit Day … so the effect of a change is visible
 * before it's saved." That is this preview, and the same arithmetic Payroll
 * applies when it resolves a run. */
function resolvedPeriod(model: Partial<PayCycleRow>): string {
  const anchor = anchorMonth(model);
  if (!anchor) return 'Set Effective From to see the period it resolves to.';
  const { year, monthIndex } = anchor;
  const named = `${MONTH_NAMES[monthIndex]} ${year}`;

  if (model.cycle_type === 'CALENDAR_MONTH') {
    // 31 clamps to the month's real last day inside dayStamp.
    return `${named}: ${dayStamp(year, monthIndex, 1)} → ${dayStamp(year, monthIndex, 31)}`;
  }
  // `== null` first: clearing a number input binds null, and Number(null) is
  // 0, which would silently preview day 01 instead of saying nothing is set.
  if (model.start_day == null || model.end_day == null) return 'Fill in Start Day and End Day to see the period.';
  const start = Number(model.start_day);
  const end = Number(model.end_day);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Fill in Start Day and End Day to see the period.';
  // Start Day is a day of the PREVIOUS month; End Day is the cutoff in the
  // month the period is named for.
  return `${named}: ${dayStamp(year, monthIndex - 1, start)} → ${dayStamp(year, monthIndex, end)} (cutoff)`;
}

function resolvedCreditDate(model: Partial<PayCycleRow>): string {
  const anchor = anchorMonth(model);
  if (!anchor) return '—';
  if (model.salary_credit_day == null) return '—';
  const credit = Number(model.salary_credit_day);
  if (!Number.isFinite(credit)) return '—';
  return `${dayStamp(anchor.year, anchor.monthIndex, credit)} — clamped to the real last day in a shorter month`;
}

// Create-only — replace_pay_cycle is POST only (no PUT): it deactivates the
// current active cycle and creates a new one, which is how §3.20c's "a change
// never rewrites a period that has already run" is modelled. masters.routes.ts
// wires no ':id/edit' route here, which is what keeps edit mode unreachable.
const config: FormScreenConfig<PayCycleRow> = {
  shape: 'form',
  id: 'masters.work_week_hours',
  title: 'Pay Cycle',
  listEndpoint: '/masters/pay-cycles',
  createEndpoint: '/masters/pay-cycles',
  rowId: (row) => row.id,
  listRoute: ['/masters/work-week-hours/pay-cycles'],
  emptyRow: () => ({ cycle_type: 'FIXED_CYCLE', start_day: 26, end_day: 25, salary_credit_day: 30, effective_from: '' }),
  fields: [
    {
      key: 'cycle_type',
      label: 'Cycle Type',
      type: 'select',
      required: true,
      staticOptions: CYCLE_TYPE_OPTIONS,
      hint: 'Calendar Month ignores Start/End Day below and simply runs the 1st to the last day of the month',
    },
    {
      // ck_pay_cycles_fixed_complete: Start/End Day are NOT NULL exactly when
      // the type is FIXED_CYCLE. Hidden for Calendar Month, and a hidden field
      // is not submitted — so switching type cannot carry a stale day through.
      key: 'start_day',
      label: 'Start Day',
      type: 'number',
      required: true,
      visibleWhen: (model) => model['cycle_type'] === 'FIXED_CYCLE',
      pattern: DAY_OF_MONTH,
      hint: '1–31. The day of the previous month a pay period opens. Only used in Fixed Cycle mode',
    },
    {
      key: 'end_day',
      label: 'End Day',
      type: 'number',
      required: true,
      visibleWhen: (model) => model['cycle_type'] === 'FIXED_CYCLE',
      pattern: DAY_OF_MONTH,
      hint: '1–31. The day of the current month a pay period closes — this is the cutoff. An event dated after it always rolls into the next run. Only used in Fixed Cycle mode',
    },
    {
      key: 'salary_credit_day',
      label: 'Salary Credit Day',
      type: 'number',
      required: true,
      pattern: DAY_OF_MONTH,
      hint: "1–31. The day of the month the bank transfer actually reaches employees' accounts — usually a few days after End Day, to leave room for the run to be calculated and confirmed. Clamped automatically to the real last day in a shorter month",
    },
    {
      key: 'effective_from',
      label: 'Effective From',
      type: 'date',
      required: true,
      hint: 'Saving replaces the current cycle from this date onwards. A period that has already been processed keeps the dates it was calculated with',
    },
  ],
  previewFields: [
    { label: 'The first period on this cycle would cover', compute: resolvedPeriod },
    { label: 'Salary would be credited on', compute: resolvedCreditDate },
  ],
};

export default config;
