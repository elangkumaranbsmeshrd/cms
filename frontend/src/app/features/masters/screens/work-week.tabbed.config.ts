import { FieldSection, TabbedScreenConfig } from '../../../shared/screens/screen.types';

import policies, { SATURDAY_RULE_OPTIONS } from './work-week-policies.list.config';
import { EXCESS_OPTIONS, MAKEUP_BY_OPTIONS, SHORTFALL_OPTIONS } from './work-week-policies.form.config';
import payCycles from './pay-cycles.list.config';
import resolvedPeriods from './resolved-periods.list.config';
import saturdayCalendar from './saturday-calendar.list.config';

// Masters §3.20 as the prototype renders it (app-screens2.js RECORDS.workweek):
// one record with summary tiles and tabs. Policies, Pay Cycle and Saturday
// Overrides are one screen key server-side and one screen here — previously
// three sibling routes joined by "Pay Cycle →" buttons.
//
// The header's numbers are NOT hardcoded. §3.20's whole point is that hours per
// day, the break, the weekly target and the Saturday rule are whatever Super
// Admin configured, so every tile below is read off the active policy the API
// returns. A 9h day with a 1h break showing 8h net is what the seeded data
// happens to say, not what this file asserts.
interface PolicyLike {
  is_active?: boolean;
  policy_name?: string;
  // Decimal columns: Pydantic v2 serialises these as JSON STRINGS ("9.00"),
  // not numbers, so every read below coerces before formatting.
  gross_hours_per_day?: number | string;
  unpaid_break_hours?: number | string;
  net_working_hours_per_day?: number | string;
  weekly_hour_target?: number | string;
  saturday_rule?: string;
  // §4 — Daily Hours / Compensation tabs' own fields, same wire shape.
  grace_window_minutes?: number | string;
  half_day_threshold_hours?: number | string | null;
  allow_compensatory_hours?: boolean;
  compensation_window_days?: number | string | null;
  make_up_day_chosen_by?: string | null;
  allow_makeup_on_week_off?: boolean;
  allow_makeup_on_mandatory_holiday?: boolean;
  max_comp_hours_per_month?: number | string;
  uncompensated_shortfall_becomes?: string;
  excess_hours_become?: string | null;
}

function activePolicy(rows: PolicyLike[] | null): PolicyLike | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.find((r) => r.is_active) ?? rows[0];
}

function hours(raw: number | string | undefined): string {
  const n = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(n) ? `${n.toFixed(2)} h` : '—';
}

// §4 — Daily Hours / Compensation tabs' own formatting. `activePolicy` above
// already establishes the convention these two tabs also need: read the
// active policy off the SAME /masters/work-week-policies response the
// Policies tab and the header use, never a second endpoint.
function yesNo(v: boolean | undefined): string {
  return v ? 'Yes' : 'No';
}
function days(raw: number | string | null | undefined): string {
  const n = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(n) ? `${n} days` : '—';
}
function minutes(raw: number | string | undefined): string {
  const n = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(n) ? `${n} minutes` : '—';
}
function optionLabel(options: readonly { value: string; label: string }[], value: string | null | undefined): string {
  return options.find((o) => o.value === value)?.label ?? '—';
}

/** §4 — the Daily Hours tab. app-screens2.js:471-492's "Derived From" section
 * is a near-verbatim re-display of fields already on WorkWeekPolicyRow — the
 * exact GET the Policies tab and the header already fetch, so this reads
 * `row` (the tabbed screen's own headerRow) rather than opening a second
 * endpoint for a second copy of the same row. */
function dailyHoursSections(row: Record<string, unknown> | null): readonly FieldSection<Record<string, unknown>>[] {
  const p = activePolicy(row as unknown as PolicyLike[] | null);
  return [
    {
      title: p ? `Derived From "${p.policy_name}"` : 'Derived From — no active policy',
      fields: [
        { key: 'gross_hours_per_day', label: 'Gross Hours per Day', compute: () => hours(p?.gross_hours_per_day) },
        { key: 'unpaid_break_hours', label: 'Unpaid Break (hours)', compute: () => hours(p?.unpaid_break_hours) },
        {
          key: 'net_working_hours_per_day',
          label: 'Net Working Hours per Day',
          compute: () => hours(p?.net_working_hours_per_day),
          hint: 'Gross − Break. The figure Payroll compares against',
        },
        {
          key: 'grace_window_minutes',
          label: 'Grace Window',
          compute: () => minutes(p?.grace_window_minutes),
          hint: 'A day landing within this many minutes of the target still counts as a Full Day',
        },
        { key: 'half_day_threshold_hours', label: 'Half Day Threshold', compute: () => hours(p?.half_day_threshold_hours ?? undefined) },
        {
          key: 'weekly_hour_target',
          label: 'Weekly Hour Target',
          compute: () => hours(p?.weekly_hour_target),
          hint: 'Excludes Saturdays, which follow the Saturday Rule instead',
        },
      ],
    },
    ...hourBandSections(p),
  ];
}

/** §3.20 Screen Design, Daily Hours: "a read-only **hour-band table** showing
 * how worked hours become a payable day: Full Day at or above the target,
 * Full Day (grace) inside the grace window, Half Day from the half-day
 * threshold up to the target, Absent below it. Each band shows what it is
 * Paid As and what it deducts. This table is what makes the rule auditable —
 * it is the difference between 'the system decided' and 'here is the band it
 * fell into.'"
 *
 * The boundaries are NOT a second implementation of the rule: they are read
 * straight off the same three policy fields Payroll's own resolver branches
 * on, in the same order it branches in (app/services/attendance_engine.py's
 * resolve_hours — FULL_DAY, then FULL_DAY_GRACE, then HALF_DAY, then ABSENT;
 * APPENDIX-B "DAY-STATUS BAND RESOLUTION" states the same four bands). So a
 * policy change moves this table the same afternoon it moves everybody's pay,
 * and nothing here is a constant: a Grace Window of 0 removes the grace band
 * outright ("0 switches grace off"), and a policy with no Half Day Threshold
 * has no Half Day band at all — the day is Full Day or Absent.
 *
 * Rendered as a field grid rather than the prototype's six-column mini-table
 * because FieldGridComponent (the only renderer a 'fields' tab has) draws
 * label/value pairs, not tables — so each band is one row reading
 * "range · paid as · deduction".
 */
function hourBandSections(p: PolicyLike | null): readonly FieldSection<Record<string, unknown>>[] {
  if (!p) return [];
  const net = Number(p.net_working_hours_per_day);
  if (!Number.isFinite(net) || net <= 0) return [];

  const graceHours = Number(p.grace_window_minutes ?? 0) / 60;
  const threshold = p.half_day_threshold_hours == null ? null : Number(p.half_day_threshold_hours);
  // The floor of the full-day band once grace is applied — the figure every
  // band below it is measured against.
  const fullDayFloor = graceHours > 0 ? net - graceHours : net;
  const shortfall = optionLabel(SHORTFALL_OPTIONS, p.uncompensated_shortfall_becomes);
  // §3.20's core rule: a shortfall only reaches the payslip if it was never
  // made up, and whether it may be made up at all is the policy's own toggle.
  const madeUp = p.allow_compensatory_hours
    ? `; nothing is deducted if the hours are made up within the compensation window`
    : `; this policy does not allow compensatory hours, so the shortfall cannot be made up`;
  // The prototype prints each band's upper bound one hundredth below the next
  // band's floor (7.99 / 7.74 / 3.99) rather than an open interval, which is
  // how a person reads a band table.
  const just = (v: number) => `${(v - 0.01).toFixed(2)} h`;

  const bands: { key: string; label: string; value: string }[] = [
    {
      key: 'band_full',
      label: 'Full Day',
      value: `${net.toFixed(2)} h and above · paid 1.00 day · no deduction — the net target was met in full`,
    },
  ];
  if (graceHours > 0) {
    bands.push({
      key: 'band_full_grace',
      label: 'Full Day — grace',
      value: `${fullDayFloor.toFixed(2)} h to ${just(net)} · paid 1.00 day · no deduction — inside the ${minutes(p.grace_window_minutes)} grace window configured on this policy`,
    });
  }
  if (threshold != null && threshold < fullDayFloor) {
    bands.push({
      key: 'band_half',
      label: 'Half Day',
      value: `${threshold.toFixed(2)} h to ${just(fullDayFloor)} · paid 0.50 day · deducts half a day${madeUp}`,
    });
  }
  bands.push({
    key: 'band_absent',
    label: 'Absent',
    value: `Below ${(threshold != null && threshold < fullDayFloor ? threshold : fullDayFloor).toFixed(2)} h · paid 0.00 day · the whole day is a shortfall, converted by "${shortfall}"${madeUp}`,
  });

  return [
    {
      title: 'Hour Bands → Day Status',
      fields: bands.map((b) => ({ key: b.key, label: b.label, span: 2 as const, compute: () => b.value })),
    },
  ];
}

/** §4 — the Compensation tab. app-screens2.js:516-528's rule-summary half is
 * the same "already on WorkWeekPolicyRow, just re-displayed" shape as Daily
 * Hours above. */
function compensationSections(row: Record<string, unknown> | null): readonly FieldSection<Record<string, unknown>>[] {
  const p = activePolicy(row as unknown as PolicyLike[] | null);
  return [
    {
      title: p ? `Compensation Rules — "${p.policy_name}"` : 'Compensation Rules — no active policy',
      fields: [
        { key: 'allow_compensatory_hours', label: 'Allow Compensatory Hours', compute: () => yesNo(p?.allow_compensatory_hours) },
        {
          key: 'compensation_window_days',
          label: 'Compensation Window',
          compute: () => days(p?.compensation_window_days),
          hint: 'How long after the shortfall the make-up day may fall',
        },
        { key: 'make_up_day_chosen_by', label: 'Make-Up Day Chosen By', compute: () => optionLabel(MAKEUP_BY_OPTIONS, p?.make_up_day_chosen_by) },
        {
          key: 'allow_makeup_on_week_off',
          label: 'Allow Make-Up on a Week Off',
          compute: () => yesNo(p?.allow_makeup_on_week_off),
          hint: 'An off Saturday is the most common make-up day in practice',
        },
        { key: 'allow_makeup_on_mandatory_holiday', label: 'Allow Make-Up on a Mandatory Holiday', compute: () => yesNo(p?.allow_makeup_on_mandatory_holiday) },
        {
          key: 'max_comp_hours_per_month',
          label: 'Max Compensatory Hours per Month',
          compute: () => hours(p?.max_comp_hours_per_month),
          hint: 'A ceiling, so compensation cannot quietly become unpaid overtime',
        },
        { key: 'uncompensated_shortfall_becomes', label: 'Uncompensated Shortfall Becomes', compute: () => optionLabel(SHORTFALL_OPTIONS, p?.uncompensated_shortfall_becomes) },
        { key: 'excess_hours_become', label: 'Excess Hours Become', compute: () => optionLabel(EXCESS_OPTIONS, p?.excess_hours_become) },
      ],
    },
  ];
}

// KNOWN GAP, deliberately not built here — the prototype's Compensation tab
// also carries an "Open Compensatory Requests" mini-table (app-screens2.js:
// 529-537), live data from D.compRequests linking into Leave → Compensatory
// Hours. Leave (Module 5) has no frontend yet (MASTER-BUILD-PROMPT.md's own
// phase order builds it after Masters); a real backend does already exist
// (backend/app/api/v1/compensatory_hours.py), so once Leave's frontend
// exists, point a genuine 'list'-shape embedded tab at it here rather than
// trying to fold a live per-row table into this fields-grid shape, which
// only ever renders label/value pairs, not a table.

// §4 — Where Used, verbatim from app-screens2.js:581-598 (eight static rows,
// no endpoint, no host data). The completion prompt's own wording sanctions
// this: "a new embeddable static-content tab shape (OR reuse the field-grid
// shape with hardcoded rows)" — one section per module/screen pair, since a
// label/value grid has no native multi-column table shape to hold Module /
// Screen / Reads / Effect side by side.
const WHERE_USED_SECTIONS: readonly FieldSection<Record<string, unknown>>[] = [
  { module: 'Payroll', screen: 'Attendance & Time Basis', reads: 'Net hours/day, working days, Saturday rule', effect: "Required hours per employee per month" },
  { module: 'Payroll', screen: 'Run Payroll', reads: 'Shortfall treatment, payable days', effect: 'Loss of Pay lines on the payslip' },
  { module: 'Leave', screen: 'Apply for Leave', reads: 'Weekly off days, Saturday rule, holidays', effect: 'Which days count against a leave balance' },
  { module: 'Leave', screen: 'Compensatory Hours', reads: 'Window, monthly cap, permitted make-up days', effect: 'Whether a chosen make-up date is accepted' },
  { module: 'Employee', screen: 'Record Attendance', reads: 'Net hours, grace, half-day threshold', effect: 'The Day Status a recorded day resolves to' },
  { module: 'Dashboard', screen: 'Attendance widgets', reads: 'Working days in the period', effect: 'Present / absent percentages' },
  {
    module: 'Payroll', screen: 'Run Payroll, Payslip', reads: 'Pay Cycle — Start Day, End Day',
    effect: "Which calendar dates a given month's payslip actually covers, and which events roll to next month",
  },
  {
    module: 'Daily Task', screen: 'My Daily Tasks, Team Daily Tasks', reads: "Net Working Hours per Day, per employee's own policy",
    effect: 'Standard Working Hours used in the Free Time calculation — never a second, competing setting',
  },
].map((r) => ({
  title: `${r.module} — ${r.screen}`,
  fields: [
    { key: 'reads', label: 'What It Reads', compute: () => r.reads },
    { key: 'effect', label: 'Effect of a Change', compute: () => r.effect },
  ],
}));

const config: TabbedScreenConfig<PolicyLike[]> = {
  shape: 'tabbed',
  id: 'masters.work_week_hours',
  title: 'Work Week & Hours',
  specRef: '§3.20',
  description:
    'Hours per day, the break, the weekly target and the Saturday rule — all dynamic. Payroll and Leave both read this screen.',
  // The list endpoint itself: the header summarises whichever policy is active.
  headerEndpoint: '/masters/work-week-policies',
  header: {
    avatar: () => 'W',
    recId: () => 'Masters §3.20',
    name: (rows) => activePolicy(rows)?.policy_name ?? 'No active policy',
    meta: (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const active = list.filter((r) => r.is_active).length;
      // QUEUED / NOT BUILT — the current-FY meta item. Prototype meta is
      // [active-policy count, active policy's Saturday Rule, 'FY 2026–27']
      // (app-screens2.js:435). Partially unblocked since (RecordHeaderDef
      // gained a `tabRows` param — MASTERS-COMPLETION-PROMPT.md §3 — so a
      // header accessor CAN now read a different TAB's already-fetched rows,
      // e.g. email-configuration.tabbed.config.ts's `summary` reads its
      // Templates/Recent Sends tabs this way), but that doesn't reach this
      // specific item: Financial Year isn't one of THIS screen's tabs at
      // all (Policies/Daily Hours/Saturday Calendar/Compensation/Pay Cycle/
      // Where Used), so there is no tabRows['financial_years'] to read.
      // Still needs its own fetch — either a genuine third RecordHeaderDef
      // data source (an arbitrary-endpoint sibling to tabRows) or, more
      // simply, reading the Saturday Calendar tab's own `financial_year_id`
      // column back through the already-present FY RefLookup once a
      // specific year is in view. Left out rather than guessed at.
      const rule = SATURDAY_RULE_OPTIONS.find((o) => o.value === activePolicy(list)?.saturday_rule)?.label;
      return [`${active} active ${active === 1 ? 'policy' : 'policies'}`, `${list.length} total`, rule ?? ''].filter(Boolean);
    },
    badge: (rows) => (activePolicy(rows) ? 'Active' : 'Draft'),
    summary: (rows) => {
      const p = activePolicy(rows);
      return [
        { label: 'Gross / Day', value: hours(p?.gross_hours_per_day) },
        { label: 'Unpaid Break', value: hours(p?.unpaid_break_hours) },
        { label: 'Net / Day', value: hours(p?.net_working_hours_per_day) },
        { label: 'Weekly Target', value: hours(p?.weekly_hour_target) },
      ];
    },
  },
  // Tab order follows RECORDS.workweek's own tab array (app-screens2.js:
  // 448-599): Policies, Daily Hours, Saturday Calendar, Compensation, Pay
  // Cycle, Where Used. BUILT — MASTERS-COMPLETION-PROMPT.md §4. Daily Hours
  // and Compensation are 'fields' tabs reading the active policy off this
  // screen's own headerEndpoint (dailyHoursSections/compensationSections
  // above); Where Used is a 'static' tab (WHERE_USED_SECTIONS above). Daily
  // Hours' own "Hour Bands → Day Status" sub-table is built too
  // (hourBandSections above). ONE sub-table remains unbuilt — the
  // Compensation tab's "Open Compensatory Requests" mini-table; see the KNOWN
  // GAP comment above compensationSections for why.
  tabs: [
    // Tab labels are §3.20 Screen Design's own words, not paraphrases: it
    // names the first tab "Work Week Policies" and the third "Saturday
    // Calendar". The third one used to be the manual override rows under the
    // honest label "Saturday Overrides", because no endpoint resolved the
    // year; GET /masters/work-week-policies/saturday-calendar does now, so
    // this is the real fifty-two-row calendar, with every override visible in
    // it as the Saturday whose Actually disagrees with Pattern Says.
    { key: 'policies', label: 'Work Week Policies', config: policies },
    { key: 'daily-hours', label: 'Daily Hours', kind: 'fields', sections: dailyHoursSections },
    { key: 'saturdays', label: 'Saturday Calendar', config: saturdayCalendar },
    { key: 'compensation', label: 'Compensation', kind: 'fields', sections: compensationSections },
    { key: 'pay-cycle', label: 'Pay Cycle', config: payCycles },
    // §3.20c draws Resolved Periods INSIDE the Pay Cycle tab, under the
    // read-only cycle. A TabDef hosts exactly one config, and Pay Cycle's is
    // the cycle list with the Replace action on it — so the preview gets its
    // own tab immediately after, which is the closest this shape expresses.
    // Its count badge is suppressed: "3" is the spec's fixed preview length,
    // not a record count, and badging it would read as data volume.
    { key: 'resolved-periods', label: 'Resolved Periods', config: resolvedPeriods, hideCount: true },
    { key: 'where-used', label: 'Where Used', kind: 'static', sections: WHERE_USED_SECTIONS },
  ],
};

export default config;
