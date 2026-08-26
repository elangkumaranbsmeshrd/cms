import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { SaturdayOverrideRow } from '../masters.api';

// ck_sat_overrides_to's real value set.
const OVERRIDE_TO_OPTIONS = [
  { value: 'WORKING', label: 'Working' },
  { value: 'WEEK_OFF', label: 'Week Off' },
];
const FY_REF = { endpoint: '/masters/financial-years/options', labelKey: 'label' };
const POLICY_REF = { endpoint: '/masters/work-week-policies/options', labelKey: 'label' };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

function isoParts(value: unknown): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** create_saturday_override rejects any date that is not actually a Saturday
 * with a 422 (masters_work_week.py:316). Saying so before the round-trip is
 * the whole value of a preview here. Built through Date.UTC so a browser east
 * or west of UTC cannot name the wrong weekday. */
function dayOfWeek(model: Partial<SaturdayOverrideRow>): string {
  const p = isoParts(model.saturday_date);
  if (!p) return 'Pick a date to check it is a Saturday.';
  const name = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return name === 'Saturday' ? 'Saturday' : `${name} — only a Saturday can be overridden here, so this date will be rejected.`;
}

/** Which Saturday of the month this is — the fact the whole odd/even pattern
 * turns on. Same formula the backend uses to snapshot pattern_says
 * (`(day - 1) // 7 + 1`), so the preview and the stored value agree. */
function whichSaturday(model: Partial<SaturdayOverrideRow>): string {
  const p = isoParts(model.saturday_date);
  if (!p) return '—';
  if (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() !== 6) return '—';
  const ordinal = ORDINALS[Math.floor((p.d - 1) / 7)] ?? '';
  return `${ordinal} Saturday of ${MONTH_ABBR[p.m - 1]} ${p.y}`;
}

// Create-only — the saturday_router has only GET and POST, no update and no
// delete, so masters.routes.ts wires no ':id/edit' route here.
const config: FormScreenConfig<SaturdayOverrideRow> = {
  shape: 'form',
  id: 'masters.work_week_hours',
  title: 'Saturday Override',
  listEndpoint: '/masters/work-week-policies/saturday-overrides',
  createEndpoint: '/masters/work-week-policies/saturday-overrides',
  rowId: (row) => row.id,
  listRoute: ['/masters/work-week-hours/saturday-overrides'],
  emptyRow: () => ({
    saturday_date: '',
    financial_year_id: '',
    work_week_policy_id: null,
    override_to: 'WORKING',
    hours_required: 8,
    reason: '',
    notify_affected_employees: true,
  }),
  fields: [
    {
      key: 'saturday_date',
      label: 'Saturday',
      type: 'date',
      required: true,
      hint: 'Must actually be a Saturday, and should sit inside the Financial Year selected below — the API rejects any other weekday outright',
    },
    {
      // Required by SaturdayOverrideWrite (financial_year_id: str, no
      // default). The prototype leaves it implicit ("only Saturdays inside the
      // active Financial Year"); the real record stores it, so it is asked for.
      key: 'financial_year_id',
      label: 'Financial Year',
      type: 'select',
      ref: FY_REF,
      required: true,
      hint: 'The year this override belongs to — what the Saturday Calendar for that year will show it against',
    },
    {
      key: 'work_week_policy_id',
      label: 'Work Week Policy',
      type: 'select',
      ref: POLICY_REF,
      hint: 'Optional. When set, the server snapshots what that policy\'s Saturday Rule alone would have said for this date into Pattern Says — a record of what was true when the override was made, which will not drift if the rule changes later',
    },
    {
      key: 'override_to',
      label: 'Override To',
      type: 'select',
      required: true,
      staticOptions: OVERRIDE_TO_OPTIONS,
      hint: 'The value that will actually apply, in place of whatever the pattern says',
    },
    {
      key: 'hours_required',
      label: 'Hours Required',
      type: 'number',
      required: true,
      hint: 'Only meaningful when the override is Working. Leave at the policy default unless this particular Saturday is a short day',
    },
    {
      // §3.20: "The reason is mandatory and not negotiable" — and the database
      // agrees (ck_sat_overrides_reason rejects an empty or whitespace-only
      // string), so this is not a soft convention.
      key: 'reason',
      label: 'Reason',
      type: 'textarea',
      required: true,
      span: 2,
      placeholder: 'e.g. Release weekend — all Engineering working',
      hint: 'Required. A Saturday that silently changes pay for the whole company needs a stated cause, and it displays permanently against that date on the Saturday Calendar',
    },
    {
      key: 'notify_affected_employees',
      label: 'Notify Affected Employees',
      type: 'checkbox',
      hint: 'Announces the change to everyone the policy covers, rather than letting them find it on their payslip',
    },
  ],
  // QUEUED / NOT BUILT — the prototype's 'm.satrule' form (app-forms.js:127)
  // also shows a read-only, derived "Pattern Says" field (e.g. "Week Off —
  // 2nd Saturday, even") so the admin sees what the chosen policy's rule
  // already says for this date before overriding it. The backend computes
  // exactly this (_resolve_saturday_pattern, masters_work_week.py:94-117)
  // and snapshots it onto the row as `pattern_says` — but only at create
  // time, AFTER the row exists (masters_work_week.py:331-337). A live
  // PRE-save preview needs the selected work_week_policy_id's own
  // saturday_rule, which is not a field on THIS form — it lives on a
  // different record. dayOfWeek()/whichSaturday() above can be pure
  // functions of formModel because both only ever look at fields already
  // on this form; FormScreenConfig.previewFields.compute (screen.types.ts)
  // is handed nothing but that same formModel, with no way to reach
  // RefDataService or any other cross-record lookup. RefDataService's own
  // cache (ref-data.service.ts) doesn't have a back door either — it stores
  // exactly one string per id, whichever `labelKey` names (policy_name for
  // POLICY_REF above), never the full row, so saturday_rule isn't sitting
  // in an already-fetched cache to pull from. Building this for real means
  // extending previewFields.compute's own signature (and FormScreenComponent,
  // which calls it) to hand callers a resolver — a change to shared screen
  // infrastructure, not something expressible in this config file alone.
  // Once that exists, add a third preview entry here running the same
  // six-way ALL_WORKING / ALL_OFF / ODD_WORKING / EVEN_WORKING / FIRST_ONLY /
  // LAST_ONLY branch _resolve_saturday_pattern uses, against the chosen
  // policy's saturday_rule.
  previewFields: [
    { label: 'That date falls on a', compute: dayOfWeek },
    { label: 'Which Saturday of the month', compute: whichSaturday },
  ],
};

export default config;
