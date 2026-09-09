import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { SaturdayCalendarRow } from '../masters.api';

// Masters §3.20 Screen Design, Saturday Calendar: "every Saturday of the
// active Financial Year resolved from the rule: Month, Date, Which (1st…5th),
// Pattern Says, Actually, Hours Required, Override/Note. Fifty-two rows for FY
// 2026–27. Any override or holiday collision is spelled out in the Note
// column. 'Override a Saturday' and 'Export Calendar' — the file HR
// circulates at the start of the year."
//
// This is the resolved view, NOT the handful of manually created override
// rows (which the tab used to show instead, and which are still their own
// screen at /masters/work-week-hours/saturday-overrides). Every override
// appears here anyway — as the Saturday whose Actually disagrees with Pattern
// Says, with its mandatory Reason printed in the Note column, which is the
// whole point of putting the two side by side.
//
// Nothing is stored: GET /masters/work-week-policies/saturday-calendar walks
// the Financial Year and resolves each date through
// attendance_engine.resolve_day — the same function Record Attendance and Run
// Payroll resolve a real day with, so this calendar cannot say one thing while
// payroll does another.
const WORK_STATE_OPTIONS = [
  { value: 'Working', label: 'Working' },
  { value: 'Week Off', label: 'Week Off' },
  { value: 'Holiday', label: 'Holiday' },
];

const config: ListScreenConfig<SaturdayCalendarRow> = {
  shape: 'list',
  id: 'masters.work_week_hours',
  title: 'Saturday Calendar',
  specRef: '§3.20',
  recordNoun: 'Saturday',
  description:
    "Every Saturday of the current Financial Year, resolved from the active Company-wide policy's Saturday Rule. A dated override wins outright; failing that a Mandatory holiday takes the day off the calendar; failing that the pattern decides. Change the rule on the policy and this whole table redraws.",
  endpoint: '/masters/work-week-policies/saturday-calendar',
  // The endpoint takes ?format=pdf|excel — §3.20's own "Export Calendar".
  exportable: true,
  // It also takes financial_year_id / policy_id, but neither is a filter this
  // screen offers yet: both default server-side (the current FY, the active
  // Company-wide policy), which is exactly the calendar the tab is for. A
  // year-picker belongs here once the header can name which year is in view —
  // see work-week.tabbed.config.ts's own note about the missing FY meta item.
  searchParam: false,
  // A resolved Saturday has no name or code; the Note is the only free text on
  // it, and it is where a reader hunts ("which Saturday was the release one?").
  searchFields: ['note', 'month'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: the endpoint resolves a whole year at once and takes
      // no per-column params. Options are derived from the rows actually
      // present rather than hardcoded to twelve months, since the financial
      // year's own start month is configurable (Masters §3.1).
      key: 'month',
      label: 'Month',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Months',
      optionsFromRows: (rows) => {
        const seen: string[] = [];
        for (const row of rows) {
          if (row.month && !seen.includes(row.month)) seen.push(row.month);
        }
        return seen.map((m) => ({ value: m, label: m }));
      },
      predicate: (row, v) => row.month === String(v),
    },
    {
      key: 'actually',
      label: 'Actually',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'Working, Week Off or Holiday',
      options: WORK_STATE_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.actually),
    },
    {
      key: 'pattern_says',
      label: 'Pattern Says',
      kind: 'select',
      transport: 'client',
      allLabel: 'Pattern — Any',
      options: WORK_STATE_OPTIONS.slice(0, 2), // the pattern alone never yields Holiday
      predicate: (row, v) => row.pattern_says === String(v),
    },
    {
      // The question this screen is opened to answer more than any other:
      // which Saturdays did NOT come out the way the rule alone would have
      // said — an override or a Mandatory holiday moved them.
      key: 'note',
      label: 'Differs From Pattern',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Differs — Any',
      formatChip: (v) => (String(v) === 'yes' ? 'Overridden or holiday' : 'Straight from the rule'),
      predicate: (row, v) => (v === 'yes' ? row.actually !== row.pattern_says : row.actually === row.pattern_says),
    },
  ],
  columns: [
    { key: 'month', header: 'Month', cellClass: 'cell-strong' },
    { key: 'saturday_date', header: 'Date', type: 'date' },
    { key: 'which', header: 'Which', type: 'chip' },
    { key: 'pattern_says', header: 'Pattern Says' },
    { key: 'actually', header: 'Actually', type: 'status' },
    { key: 'hours_required', header: 'Hours Required', type: 'number' },
    { key: 'note', header: 'Override / Note' },
  ],
  // A resolved date is not a record: `id` is the ISO date, and there is
  // nothing to open, so no rowRoute — ListScreenComponent then renders
  // non-clickable rows, the same as Resolved Periods.
  rowId: (row) => row.id,
  createRoute: ['/masters/work-week-hours/saturday-overrides', 'new'],
  createLabel: 'Override a Saturday',
  // Fifty-two rows is the whole point ("the file HR circulates at the start of
  // the year"), so the default page holds a full year rather than splitting it
  // across two — 100 is the largest of the three sizes this shape offers.
  defaultPageSize: 100,
  emptyText:
    'No calendar to draw yet — this needs a Financial Year marked current and an active Company-wide policy to resolve Saturdays against.',
};

export default config;
