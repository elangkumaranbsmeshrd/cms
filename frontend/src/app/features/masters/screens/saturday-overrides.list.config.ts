import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { SaturdayOverrideRow } from '../masters.api';

// ck_sat_overrides_to's real value set. Backs the two columns and the two
// filters below, so cell text and chip text cannot drift apart.
const WORK_STATE_OPTIONS = [
  { value: 'WORKING', label: 'Working' },
  { value: 'WEEK_OFF', label: 'Week Off' },
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

/** §3.20's Saturday Calendar carries a Month column ahead of the date, because
 * the calendar is read a month at a time. Sliced straight out of the ISO
 * saturday_date rather than parsed into a Date, so no timezone can shift it. */
function monthOf(row: SaturdayOverrideRow): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(row.saturday_date ?? ''));
  return m ? `${MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** §3.20's "Which (1st…5th)" column — the single most load-bearing fact on the
 * screen, since the whole odd/even Saturday pattern turns on it. Same formula
 * the backend itself uses when it snapshots pattern_says
 * (masters_work_week.py:100, `(day - 1) // 7 + 1`), so the two can never
 * disagree about which Saturday of the month a date is. */
function whichSaturday(row: SaturdayOverrideRow): string {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(String(row.saturday_date ?? ''));
  if (!m) return '';
  return ORDINALS[Math.floor((Number(m[1]) - 1) / 7)] ?? '';
}

// QUEUED / NOT BUILT — the prototype's "Saturday Calendar" tab
// (app-screens2.js:495-513, k:'saturday', D.masters.satCalendar) resolves and
// lists all 52 Saturdays of the active Financial Year — Month, Date, Which,
// Pattern Says, Actually, Hours Required, Note — by walking every Saturday
// from the policy's Saturday Rule and checking each one against a Mandatory
// holiday. This screen (retitled "…Overrides" specifically so it isn't
// mistaken for that) only lists the override rows GET
// /masters/work-week-policies/saturday-overrides actually returns; a
// Saturday nobody has overridden simply doesn't appear here.
// Not stubbed in because there is nothing to resolve against yet:
// 01-masters-module.md:1247 explicitly defers "the computed read views" —
// the Saturday Calendar named first among them — to Payroll's own
// resolution engine (Attendance & Time Basis / Run Payroll), which reads the
// policy's Saturday Rule plus these override rows and is the actual, already
// -built consumer of both. Masters exposes no endpoint that walks a
// financial year and resolves 52 dates; building one here would duplicate
// logic Payroll already owns rather than reuse it. Once Payroll's resolution
// is reachable read-only from the frontend, this screen (or a sibling tab
// next to it) can render the full 52-row calendar against it.
const config: ListScreenConfig<SaturdayOverrideRow> = {
  shape: 'list',
  id: 'masters.work_week_hours',
  title: 'Saturday Calendar Overrides',
  specRef: '§3.20b',
  recordNoun: 'Saturday override',
  // The prototype's own description for this screen (data.js:1614).
  description:
    'Flip a single Saturday against the pattern — a one-off working Saturday before a release, or an extra day off. A Mandatory holiday already wins on its own; this is for everything else.',
  endpoint: '/masters/work-week-policies/saturday-overrides',
  exportable: true,
  rowId: (row) => row.id,
  createRoute: ['/masters/work-week-hours/saturday-overrides', 'new'],
  createLabel: 'Override a Saturday',
  // list_saturday_overrides takes exactly one query param — `format`. No
  // ?search=, no ?include_inactive= (an override has no active flag at all),
  // no per-field filters. Everything below is client transport.
  searchParam: false,
  // An override has neither a name nor a code; Reason is its only free text,
  // and it is mandatory precisely so that it identifies the row.
  searchFields: ['reason'],
  includeInactiveParam: false,
  filters: [
    {
      // Client transport: no ?saturday_date_from/_to on this endpoint. No
      // predicate needed — the store falls back to withinRange over the field
      // named by the key, which is the ISO saturday_date. The preset list here
      // includes the real financial years from Masters §3.1 (RBAC §2.2c), so a
      // whole FY can be selected without also carrying a separate Financial
      // Year select that would filter the same rows twice.
      key: 'saturday_date',
      label: 'Saturday',
      kind: 'daterange',
      transport: 'client',
      allLabel: 'All Dates',
    },
    {
      // Client transport: no ?override_to= param exists.
      key: 'override_to',
      label: 'Actually',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'Working or Week Off',
      options: WORK_STATE_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.override_to),
    },
    {
      // Client transport: no ?pattern_says= param exists. Null on any override
      // created without a policy to resolve against, which is why the
      // predicate compares defensively rather than assuming a value.
      key: 'pattern_says',
      label: 'Pattern Says',
      kind: 'select',
      transport: 'client',
      allLabel: 'Pattern — Any',
      options: WORK_STATE_OPTIONS,
      predicate: (row, v) => (row.pattern_says ?? '') === String(v),
    },
    {
      // Client transport: no ?notify_affected_employees= param exists.
      key: 'notify_affected_employees',
      label: 'Employees Notified',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Notified — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.notify_affected_employees : !row.notify_affected_employees),
    },
  ],
  // Masters §3.20 Screen Design, Saturday Calendar: "Month, Date, Which
  // (1st…5th), Pattern Says, Actually, Hours Required, Override/Note", plus
  // the Employees Notified column the backend's own export carries
  // (_SATURDAY_LIST_COLUMNS).
  columns: [
    { key: 'month', header: 'Month', cellClass: 'cell-strong', compute: monthOf },
    { key: 'saturday_date', header: 'Date', type: 'date' },
    { key: 'which', header: 'Which', compute: whichSaturday },
    { key: 'pattern_says', header: 'Pattern Says', staticOptions: WORK_STATE_OPTIONS },
    { key: 'override_to', header: 'Actually', type: 'status', staticOptions: WORK_STATE_OPTIONS },
    { key: 'hours_required', header: 'Hours Required', type: 'number' },
    { key: 'reason', header: 'Override / Note' },
    { key: 'notify_affected_employees', header: 'Employees Notified', type: 'status' },
  ],
  // No row actions, deliberately: masters_work_week.py's saturday_router has
  // only GET and POST — there is no update, no deactivate and no DELETE route
  // for an override, so a Deactivate button here would have nothing to call.
  defaultPageSize: 50,
  emptyText:
    'No Saturday has been overridden — every Saturday currently resolves straight from its policy\'s own Saturday Rule.',
};

export default config;
