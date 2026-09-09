import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';
import { SCOPE_OPTIONS, TAX_TYPE_OPTIONS } from './taxes.form.config';

// EVERY filter on this screen is client-transport, and that is not a shortcut:
// masters_taxes.py's list_tax_heads takes exactly ONE query parameter — `format`
// (line 232). No ?search=, no ?include_inactive=, no ?scope=, nothing. §3.2's own
// Screen Design says the same in words: "all deferred in the current build; the
// list endpoint takes no query filters yet". A 'server' transport here would send
// a parameter the API silently ignores while the chip claimed a filter was
// applied, so search and every filter run in JS over the fetched array and
// ListScreenComponent discloses the export caveat instead of lying about it.

/** Backend decimals arrive as JSON strings (Pydantic v2 serialises Decimal to
 * str), so "18.0000" has to go through Number() before it reads as "18%". */
function pct(value: number | null): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? `${n}%` : '';
}

// QUEUED / NOT BUILT — ₹ and 'en-IN' are hardcoded below, and this duplicates
// the app's own shared formatMoney() (cell-format.ts) instead of calling it.
// Not fixed in place because there is currently nothing real to switch it to:
// grepped this whole repo for currency_code / currencyCode / company_currency
// / DEFAULT_CURRENCY / currency_symbol — no deployment- or company-level
// currency setting exists in the backend or the frontend. And formatMoney()
// itself is just as hardcoded to en-IN/INR today (cell-format.ts:98-103,
// `new Intl.NumberFormat('en-IN', { currency: 'INR', ... })`), so delegating
// to it now would only relocate the hardcoding, not remove it, and this
// screen — Masters -> Taxes — is the one that most needs to demonstrate
// currency-neutral behaviour, not paper over it. Once a currency setting
// exists somewhere and formatMoney() reads from it, delete this local
// amount() helper and call formatMoney() here instead, so there is one
// formatting path, not two.
function amount(value: number | null): string {
  if (value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '';
}

/** §3.2 Screen Design: each row shows "Rate or Amount (or 'Slab' with the band
 * count)". Which of the five figure columns actually carries the number is
 * decided by tax_type — the same branch tax_engine._compute_gross takes — so
 * one readable column beats five mostly-empty ones. Returning '' lets
 * ListScreenComponent render its em-dash for a head with nothing set. */
function rateOrAmount(row: TaxHeadRow): string {
  switch (row.tax_type) {
    case 'GST_IGST':
    case 'PERCENTAGE':
      return pct(row.rate_pct);
    case 'GST_CGST_SGST': {
      const cgst = pct(row.cgst_rate_pct);
      const sgst = pct(row.sgst_rate_pct);
      return cgst && sgst ? `${cgst} + ${sgst}` : cgst || sgst;
    }
    case 'FIXED_AMOUNT':
      return amount(row.fixed_amount);
    case 'DECLARATION_CAP':
      return amount(row.declaration_cap);
    case 'SLAB': {
      const bands = row.slab_bands?.length ?? 0;
      return bands ? `Slab · ${bands} band${bands === 1 ? '' : 's'}` : 'Slab';
    }
    default:
      return '';
  }
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The same three-part test the backend itself calls "in force" when it decides
 * whether a head may be linked (masters_simple.py:177 — active, applies_from
 * reached, applies_until not passed). Kept identical so the filter and the API
 * cannot disagree about which heads are usable today. ISO dates compare
 * correctly as plain strings. */
function isInForce(row: TaxHeadRow): boolean {
  const today = todayIso();
  return row.is_active && row.applies_from <= today && (!row.applies_until || row.applies_until >= today);
}

/** A loaded TaxHeadRow reshaped into the body PUT/POST /masters/taxes
 * accepts (TaxHeadCreate's own field set) — every scalar/list field the
 * backend can write, nothing it computes (id, usage_count,
 * is_arithmetic_locked, ...). Extracted here (rather than inline in the
 * Duplicate row action below) because §6a's standalone Slab Bands/Split
 * Components/Relief Rules screens (tax-head-child-screen.component.ts) need
 * the identical reconstruction: those screens edit ONE child array but still
 * PUT the tax head's FULL row back, since masters_taxes.py has no
 * independent CRUD for a single child row — see that component's own
 * doc comment for why. One function, so a field added to TaxHeadCreate only
 * ever needs updating in one place. */
export function taxHeadWriteBody(row: TaxHeadRow): Record<string, unknown> {
  return {
    tax_name: row.tax_name,
    short_code: row.short_code,
    scope: row.scope,
    tax_type: row.tax_type,
    tax_scheme_id: row.tax_scheme_id,
    applies_from: row.applies_from,
    applies_until: row.applies_until,
    rate_pct: row.rate_pct,
    cgst_rate_pct: row.cgst_rate_pct,
    sgst_rate_pct: row.sgst_rate_pct,
    fixed_amount: row.fixed_amount,
    declaration_cap: row.declaration_cap,
    slab_application: row.slab_application,
    print_label: row.print_label,
    notes: row.notes,
    creates_onward_liability: row.creates_onward_liability,
    remitted_to_authority: row.remitted_to_authority,
    remittance_period: row.remittance_period,
    period_aligns_to: row.period_aligns_to,
    deposit_due_days_after_period_end: row.deposit_due_days_after_period_end,
    liability_arises_on: row.liability_arises_on,
    authority_reference_label: row.authority_reference_label,
    withholding_directions: row.withholding_directions ?? [],
    default_calculated_on: row.default_calculated_on,
    certificate_expected: row.certificate_expected,
    is_active: row.is_active,
    // Passed through as fetched (each element also carries its own `id`,
    // which TaxHeadCreate's child schemas don't declare and Pydantic v2
    // ignores by default) rather than rebuilt field-by-field, so a new
    // child row type never silently stops being copied.
    slab_bands: row.slab_bands,
    split_components: row.split_components,
    relief_rules: row.relief_rules,
  };
}

/** tax_heads.tax_name is String(191) (app/models/masters.py:34); a name that
 * long plus a suffix would be truncated by MySQL rather than rejected. */
const TAX_NAME_MAX = 191;
const COPY_SUFFIX = ' (copy)';

/** Found live, this pass: Duplicate 409'd on EVERY head and always had.
 * POST /masters/taxes/{id}/duplicate takes a full TaxHeadCreate, and this
 * action was sending the row back verbatim — the same Tax Name, in the same
 * Scope, from the same Applies From, which is precisely the triple
 * `ux_tax_heads_scope_name_from` (migration 0016) makes unique. The server
 * rejected it with "A tax head with this Tax Name already exists in this
 * Scope, effective from this same date", so the button did nothing at all.
 *
 * The copy therefore has to differ in the name or the date before it is sent.
 * The NAME is the safe half to change: it is a label (masters_taxes.py's
 * _LABEL_FIELDS), so it stays editable on the head that lands, whereas
 * Applies From is arithmetic and locks on first use — inventing a date here
 * would be a silent claim about when the new figures take effect, which is
 * exactly the decision §3.2 wants the person making the rate change to take
 * deliberately on the form this action opens. */
function duplicateName(name: string): string {
  const head = name.length + COPY_SUFFIX.length > TAX_NAME_MAX ? name.slice(0, TAX_NAME_MAX - COPY_SUFFIX.length) : name;
  return `${head}${COPY_SUFFIX}`;
}

const config: ListScreenConfig<TaxHeadRow> = {
  shape: 'list',
  id: 'masters.taxes',
  title: 'Taxes',
  specRef: '§3.2',
  recordNoun: 'tax head',
  // The prototype's own desc for this screen (data.js masters.taxes).
  description:
    'One dynamic list where Super Admin defines every tax this company actually applies. Nothing is pre-set and no tax is named anywhere in the specification.',
  endpoint: '/masters/taxes',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/taxes', row.id, 'edit'],
  createRoute: ['/masters/taxes', 'new'],
  // The prototype's action label is per-scope tab ("+ Add Billing Tax", "+ Add
  // Purchase Tax", "+ Add Payroll Tax"); this list is flat and unscoped, so it
  // uses the prototype's own name for the screen those buttons open
  // (masters.taxes.add — "Add Tax Head").
  createLabel: 'Add Tax Head',
  // §3.2 Screen Design: "Search covers Name and Short Code."
  searchParam: false,
  searchFields: ['tax_name', 'short_code'],
  // No ?include_inactive= on this endpoint — it returns active AND inactive
  // heads on every call — so the shared "Show inactive" checkbox is suppressed
  // and the Status filter below does that job client-side instead.
  includeInactiveParam: false,
  filters: [
    {
      // §3.0: "defaulting to Active with an explicit 'include inactive' option
      // — retired entries are hidden by default but never silently
      // unreachable." Since the endpoint hands back everything, the default has
      // to be applied here; 'All Statuses' is the explicit way back to the
      // retired ones.
      key: 'status',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'client',
      allLabel: 'All Statuses',
      defaultValue: 'active',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
      predicate: (row, v) => (v === 'active' ? row.is_active : !row.is_active),
    },
    {
      // §3.2 Screen Design's first listed filter. The prototype expresses the
      // same dimension as three collapsible groups (Billing / Purchase /
      // Payroll tabs, app-screens2.js taxes.tabs) — a multi-select filter is
      // the flat-list equivalent, and §2.2c wants multi- not single-select.
      key: 'scope',
      label: 'Scope',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Scopes',
      options: SCOPE_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.scope),
    },
    {
      // §3.2 Screen Design calls this "Calculation Method"; the Fields Table and
      // the prototype form both call the field Tax Type. Same enum either way.
      key: 'tax_type',
      label: 'Tax Type',
      kind: 'multiselect',
      transport: 'client',
      allLabel: 'All Tax Types',
      options: TAX_TYPE_OPTIONS,
      predicate: (row, v) => (v as readonly string[]).includes(row.tax_type),
    },
    {
      // §3.2 Screen Design: "'currently in force' as a quick toggle". Derived
      // from three fields rather than stored, so it can only ever be a client
      // filter — there is no in-force column to send a parameter for.
      key: 'in_force',
      label: 'In Force',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'In Force — Any',
      predicate: (row, v) => (v === 'yes' ? isInForce(row) : !isInForce(row)),
    },
    {
      // Not in §3.2's filter list, but is_arithmetic_locked is a real field on
      // every row and it answers the question this screen exists to answer
      // before a rate change: which heads can still be edited, and which need
      // the Applies Until + Duplicate route instead. Same shape as the
      // prototype's own "Locked — Any" tri-state on Financial Year.
      key: 'locked',
      label: 'Locked',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Locked — Any',
      predicate: (row, v) => (v === 'yes' ? row.is_arithmetic_locked : !row.is_arithmetic_locked),
    },
  ],
  // §3.2 Screen Design's own row list — "Tax Name, Short Code, Method, Rate or
  // Amount (or 'Slab' with the band count), Applies From, Applies Until,
  // Status" — plus Scope (the prototype's tab grouping, which a flat list has to
  // carry as a column), and the Locked / Usage Count pair the prototype shows on
  // its "Where Used" tab. Every key below is a real field on TaxHeadOut.
  columns: [
    { key: 'tax_name', header: 'Tax Name', cellClass: 'cell-strong' },
    { key: 'short_code', header: 'Short Code', type: 'code' },
    { key: 'scope', header: 'Scope', staticOptions: SCOPE_OPTIONS },
    // Prototype header (app-screens2.js taxTable): 'Type'.
    { key: 'tax_type', header: 'Type', staticOptions: TAX_TYPE_OPTIONS },
    { key: 'rate', header: 'Rate', cellClass: 'mono', compute: rateOrAmount },
    { key: 'applies_from', header: 'Applies From', type: 'date' },
    { key: 'applies_until', header: 'Applies Until', type: 'date' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
    // The arithmetic lock (§3.2's "once a head has been used in any
    // calculation, its numbers lock"), shown as the prototype shows it.
    { key: 'is_arithmetic_locked', header: 'Locked', type: 'status' },
    // Same header the backend's own PDF/Excel export uses (masters_taxes.py
    // _LIST_COLUMNS), so the exported file and the screen read alike.
    { key: 'usage_count', header: 'Usage Count', type: 'number' },
  ],
  rowActions: [
    {
      // §3.2 Screen Design (01-masters-module.md:375): "'Duplicate' on each
      // row, which opens the Add form pre-filled from an existing head."
      // (Not in the JS prototype's own taxTable() render — app-screens2.js:613-621
      // draws a plain 5-column table with no action buttons at all — so this is
      // built from the module spec, which is what every other comment on this
      // screen already treats as authoritative, not from the mock's pixels.)
      // It is also the only route the lock rule leaves open: §3.2 "when a rate
      // genuinely changes … set Applies Until on the old head, then add a new
      // head (usually via Duplicate)" — editing a locked figure is refused
      // outright (masters_taxes.py _ARITHMETIC_FIELDS), so without this action
      // there would be no way to carry a twelve-band slab table into next
      // year's rate at all.
      //
      // POST /masters/taxes/{id}/duplicate (masters_taxes.py:356-394) takes a
      // full TaxHeadCreate rather than an empty body, gated on the same 'edit'
      // screenAction every other write here uses — so this builds the request
      // from the row instead of the `{}` every other row action sends, and,
      // rather than a second "pre-filled create form" mode to build and
      // maintain, routes straight into Edit on the new head (screen.types.ts's
      // RowActionDef.body / .onSuccess exist for exactly this), where the rate
      // and Applies From get changed — the same outcome as a pre-filled form.
      label: 'Duplicate',
      endpoint: (row) => `/masters/taxes/${row.id}/duplicate`,
      screenAction: 'edit',
      // duplicateName() above, not the row's own name — see its comment: an
      // unchanged (scope, tax_name, applies_from) triple is refused by the
      // database, which made this button a no-op on every head.
      body: (row) => ({ ...taxHeadWriteBody(row), tax_name: duplicateName(row.tax_name) }),
      onSuccess: (res) => ['/masters/taxes', (res as { id: string }).id, 'edit'],
    },
    {
      // §3.0 rule 1 — Deactivate is Super Admin only, which is exactly what the
      // 'delete' action gates (require_screen(SCREEN, action="delete") on
      // deactivate_tax_head).
      label: 'Deactivate',
      endpoint: (row) => `/masters/taxes/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm:
        'Deactivating retires this tax head: it stops being offered anywhere, but every document already calculated under it keeps resolving to it. Continue?',
    },
    {
      // DELETE /masters/taxes/{id} exists and 409s when usage_count > 0
      // ("Never hard-deleted once used"), so the row action is only offered on a
      // head nothing has referenced yet — the same test the API applies.
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/taxes/${row.id}`,
      screenAction: 'delete',
      visible: (row) => row.usage_count === 0,
      confirm:
        'Permanently delete this tax head? This only succeeds while nothing has ever used it — once it has been applied to a document or a payslip the server refuses, and Deactivate is the correct action.',
    },
  ],
  defaultPageSize: 50,
  // §3.2's own empty state, which it calls "a real state, not a formality,
  // because on day one nothing exists here".
  emptyText:
    'No taxes configured yet. Add the taxes, statutory deductions, and contributions that apply to this company. Until at least one is added, invoices and payslips are calculated without any tax.',
};

export default config;
