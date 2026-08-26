// The value-rendering contract, ported from the prototype's U.cell()/U.badge()/
// inr() (app-core.js:75, :235-247). Kept in ONE module for the same reason
// column-policy.ts exists: RBAC §2.2c-i's "this is enforced in one place, not
// per screen. Every table builder normalises through a single shared helper, so
// a new screen inherits the rule automatically and cannot drift from it."
//
// The prototype's demo data was already human-shaped ('Active', 'Locked',
// 'Mandatory'). The real backend is not — it sends lowercase enum members
// ('open', 'locked'), SCREAMING_SNAKE ('MANDATORY', 'REIMBURSABLE',
// 'GST_CGST_SGST'), ISO dates ('2026-04-01') and raw numbers. So every helper
// here normalises first and then applies the prototype's own mapping, rather
// than assuming the prototype's already-pretty inputs.

// Prototype data.js:20-45, verbatim. Keys are matched case-insensitively and
// with _ / - treated as spaces, so 'open', 'OPEN' and 'Open' all land here.
const BADGE_CLASS: Record<string, string> = {
  // generic
  active: 'b-ok', inactive: 'b-neutral', draft: 'b-neutral', pending: 'b-warn',
  approved: 'b-ok', rejected: 'b-danger', cancelled: 'b-neutral', completed: 'b-ok',
  locked: 'b-danger', open: 'b-warn', closed: 'b-neutral', verified: 'b-ok',
  'pending verification': 'b-warn', submitted: 'b-info', yes: 'b-ok', no: 'b-neutral',
  // employee
  'on notice': 'b-warn', exited: 'b-neutral', 'in progress': 'b-info', 'not started': 'b-neutral',
  // ticket
  resolved: 'b-ok', urgent: 'b-danger', high: 'b-warn', medium: 'b-info', low: 'b-neutral',
  unassigned: 'b-outline',
  // asset
  'in use': 'b-ok', 'in store': 'b-info', 'under repair': 'b-warn', 'retired disposed': 'b-neutral',
  overdue: 'b-danger', upcoming: 'b-info',
  // invoice / bill
  sent: 'b-info', 'part paid': 'b-warn', paid: 'b-ok', unpaid: 'b-danger',
  'pending approval': 'b-warn', reimbursed: 'b-ok', processed: 'b-ok', reissued: 'b-purple',
  // opportunity / project
  prospecting: 'b-neutral', qualifying: 'b-info', proposal: 'b-warn', won: 'b-ok', lost: 'b-danger',
  prospect: 'b-info', 'on hold': 'b-warn', planned: 'b-neutral', fixed: 'b-ok', critical: 'b-danger',
  backlog: 'b-neutral', 'to do': 'b-info', 'in review': 'b-purple', done: 'b-ok',
  reached: 'b-ok', missed: 'b-danger',
  // masters
  mandatory: 'b-danger', optional: 'b-outline', 'in force': 'b-ok', superseded: 'b-neutral',
  visible: 'b-ok', hidden: 'b-neutral', granted: 'b-ok', revoked: 'b-danger',
  // Real backend enum values with no prototype counterpart. 'failed' matters
  // most: Recent Sends exists to spot a failed delivery, and without this a
  // FAILED row fell through to neutral grey — visually identical to a SENT one.
  failed: 'b-danger', working: 'b-ok', 'week off': 'b-neutral',
};

export const EM_DASH = '—';

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function badgeClass(value: unknown): string {
  if (value === true) return BADGE_CLASS['yes'];
  if (value === false) return BADGE_CLASS['no'];
  return BADGE_CLASS[normalizeKey(String(value ?? ''))] ?? 'b-neutral';
}

/** SCREAMING_SNAKE / kebab / lowercase enum member -> the label a person reads.
 * 'REIMBURSABLE' -> 'Reimbursable', 'GST_CGST_SGST' -> 'Gst Cgst Sgst'. A config
 * that needs a better label than title-casing gives sets `staticOptions` on the
 * column and that wins — this is only the fallback so nothing renders as a
 * raw constant. */
export function humanizeEnum(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Mixed case means a human already wrote it ('Part-Paid', 'In Force') — leave
  // it alone. All-lower ('open', 'locked') and all-upper ('MANDATORY',
  // 'REIMBURSABLE') are both machine constants and both get title-cased; the
  // all-lower case is the one that was rendering as a bare "open" on screen.
  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  if (hasLower && hasUpper && !raw.includes('_')) return raw;
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// QUEUED / NOT DEPLOYMENT-CONFIGURABLE — the dd-mm-yyyy swap below is a literal,
// which is §6's "date format that varies by deployment" rule. Not read from
// Company Profile because there is currently nothing real to point it at:
// CompanyProfile (backend/app/models/masters.py:286) and its schema
// (backend/app/schemas/masters.py) have no date_format field at all — confirmed
// absent, not just unwired. settings-page.component.ts's "Regional & Financial"
// tab already shows this same dd-mm-yyyy as a static, admittedly-decorative
// badge (settings-page.component.ts:246) for the identical reason (see that
// file's header comment, lines 9-14). Once a date_format field exists on
// Company Profile and is loaded into ref-data.service.ts (or an app-init config
// call), this function should read it instead of hardcoding the swap.
/** ISO 'yyyy-mm-dd' (what every backend date field sends) -> 'dd-mm-yyyy' (what
 * the prototype shows everywhere). Also accepts a full ISO timestamp. Anything
 * that isn't a recognisable ISO date is returned untouched rather than mangled. */
export function formatDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
}

// QUEUED / NOT DEPLOYMENT-CONFIGURABLE — 'en-IN'/'INR' below are literals, which
// is §6's explicit "currency symbol, locale" rule. This is the ONE shared
// formatMoney() every money-typed column in the app (list, report, board,
// document, dashboard, payslip screens) normalises through, per this file's
// own header comment — so the gap is app-wide, not local. Not read from
// Company Profile because there is currently nothing real to point it at:
// CompanyProfile (backend/app/models/masters.py:286) and its schema
// (backend/app/schemas/masters.py) have no currency_code / currency_symbol /
// locale field at all — confirmed absent, not just unwired (grep for
// currency_symbol/currencySymbol across the repo returns nothing). Building a
// dynamic version now would mean inventing that field's name and shape with no
// backend to confirm it against. Once such a field exists on Company Profile
// and is loaded into ref-data.service.ts (or an app-init config call),
// formatMoney() should construct its Intl.NumberFormat from that instead of
// the hardcoded 'en-IN'/'INR' pair.
/** Indian digit grouping (2,2,3) with a leading rupee symbol — the prototype's
 * inr(). Intl's 'en-IN' does exactly this grouping, so no hand-rolled regex.
 *
 * Rounded to whole rupees, matching the prototype (`Math.round` in its own
 * inr()): these are amounts people read down a column and compare, and a
 * trailing ".00" on every row is noise. Values arrive as Decimal-backed JSON
 * strings from Pydantic, so Number() first. */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMoney(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  return INR.format(n);
}

/** True for the values that should render as an em-dash rather than as empty
 * space — the prototype's `v === undefined || v === null || v === ''` rule. */
export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Up to two initials, uppercased — the prototype's own initials() (app-
 * core.js), used for the `.mini-av` avatar bubble on board cards and now on
 * an 'avatar'-type list column. */
export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]).join('').toUpperCase();
}
