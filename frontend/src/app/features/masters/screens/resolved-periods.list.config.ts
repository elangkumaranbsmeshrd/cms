import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { ResolvedPeriodRow } from '../masters.api';

// Masters §3.20c's Pay Cycle Screen Design: the tab shows the current cycle
// read-only "plus a **Resolved Periods** table previewing three consecutive
// months' actual date ranges and Salary Credited date, all computed from
// them, so the effect of a change is visible before it's saved."
//
// Its own Fields Table marks Resolved Periods "Read-only, derived — Not
// stored", which is why this is a list with no create route, no row route and
// no row actions: there is no record here to open or edit. It sits as its own
// tab beside Pay Cycle rather than inside it because a tabbed screen hosts
// exactly one config per tab (TabDef), and the Pay Cycle tab's own config is
// the cycle list carrying the Replace Pay Cycle action.
//
// NOT exportable: /masters/pay-cycles/resolved-periods takes no `format`
// param — same reason its sibling pay-cycles list sets it false.
const config: ListScreenConfig<ResolvedPeriodRow> = {
  shape: 'list',
  id: 'masters.work_week_hours',
  title: 'Resolved Periods',
  specRef: '§3.20c',
  recordNoun: 'period',
  description:
    "Computed live from the active cycle's Start Day, End Day and Salary Credit Day — nothing here is stored. Any dated event falling after a period's End Day belongs to the NEXT period, never the one that just closed.",
  endpoint: '/masters/pay-cycles/resolved-periods',
  rowId: (row) => row.id,
  // A preview row is not a record: there is nothing to navigate to, and
  // ListScreenComponent renders non-clickable rows when rowRoute is omitted.
  //
  // The endpoint declares no query params at all (it takes the active cycle
  // and today's date and returns exactly three rows), so search and the
  // include-inactive toggle are switched off rather than rendering controls
  // that would send nothing — the same disclosure pay-cycles.list.config.ts
  // makes for the same endpoint family.
  searchParam: false,
  searchFields: ['payroll_month'],
  includeInactiveParam: false,
  columns: [
    // The month a person asks Run Payroll for — deliberately first, because
    // on the seeded 26th–25th cycle it is NOT the month the window starts in,
    // and reading the range without it invites exactly that mistake.
    { key: 'payroll_month', header: 'Payroll Month', cellClass: 'cell-strong' },
    { key: 'period_start', header: 'Period Start', type: 'date' },
    { key: 'period_end', header: 'Period End (Cutoff)', type: 'date' },
    { key: 'days_in_period', header: 'Days', type: 'number' },
    { key: 'salary_credit_date', header: 'Salary Credited', type: 'date' },
  ],
  defaultPageSize: 25,
  emptyText:
    "No pay cycle is active, so there is no window to resolve. Add one on the Pay Cycle tab and three months' periods appear here.",
};

export default config;
