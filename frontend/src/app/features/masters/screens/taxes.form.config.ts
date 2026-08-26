import { FieldConfig, FormScreenConfig } from '../../../shared/screens/screen.types';
import { TaxHeadRow } from '../masters.api';

// Masters §3.2's central rule, and the reason every label below describes a
// BEHAVIOUR rather than a tax: "it names no tax, proposes no rate, and assumes
// no country's tax structure … The system is not aware that any specific tax
// exists." So no placeholder here suggests a real levy, an authority, or a
// jurisdiction's paperwork vocabulary — §3.2's own note on Authority Reference
// Label is explicit that the field exists precisely so that vocabulary "ends up
// named" nowhere "in the specification or in code". The prototype's own
// placeholders (app-forms.js 'm.tax.head') do name examples; they are
// deliberately neutralised here, using the same "Whatever this … is called"
// idiom the prototype itself uses on the §3.2 child forms.
//
// The two option lists below are exported because taxes.list.config.ts renders
// the very same enums as column labels (ColumnDef.staticOptions) — one source of
// truth, so a screen and its form can never disagree about what a value reads as.

/** tax_heads.scope — masters_taxes.py / §3.2 "The Scope Options" table. Labels
 * are §3.2's own wording verbatim (which is also the prototype's opts list). */
export const SCOPE_OPTIONS = [
  { value: 'SALES_BILLING', label: 'Sales / Billing' },
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'SALES_AND_PURCHASE', label: 'Sales / Billing & Purchase' },
  { value: 'PAYROLL_EMPLOYEE_DEDUCTION', label: 'Payroll — Employee Deduction' },
  { value: 'PAYROLL_EMPLOYER_CONTRIBUTION', label: 'Payroll — Employer Contribution' },
  { value: 'PAYROLL_INCOME_TAX', label: 'Payroll — Income Tax' },
  { value: 'EMPLOYEE_DECLARATION', label: 'Employee Declaration / Exemption' },
  { value: 'WITHHOLDING_AT_SOURCE', label: 'Withholding / Deduction at Source' },
];

/** tax_heads.tax_type — the CALCULATION METHOD, not a list of taxes: it is what
 * decides which rate fields exist and which branch tax_engine._compute_gross
 * takes. These six values are the backend's own enum members. */
export const TAX_TYPE_OPTIONS = [
  { value: 'GST_IGST', label: 'GST — IGST' },
  { value: 'GST_CGST_SGST', label: 'GST — CGST + SGST' },
  { value: 'PERCENTAGE', label: 'Percentage' },
  { value: 'FIXED_AMOUNT', label: 'Fixed Amount' },
  { value: 'SLAB', label: 'Slab' },
  { value: 'DECLARATION_CAP', label: 'Declaration Cap' },
];

const SLAB_APPLICATION_OPTIONS = [
  { value: 'PROGRESSIVE', label: 'Progressive' },
  { value: 'FLAT_BY_BAND', label: 'Flat by Band' },
];
const REMITTANCE_PERIOD_OPTIONS = [
  { value: 'PER_DOCUMENT', label: 'Per Document' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'HALF_YEARLY', label: 'Half-Yearly' },
  { value: 'ANNUAL', label: 'Annual' },
];
const PERIOD_ALIGNS_OPTIONS = [
  { value: 'CALENDAR', label: 'Calendar' },
  { value: 'FINANCIAL_YEAR', label: 'Financial Year' },
  { value: 'PAY_CYCLE', label: 'Pay Cycle' },
];
const LIABILITY_ARISES_OPTIONS = [
  { value: 'SOURCE_DOCUMENT_DATE', label: 'Source Document Date' },
  { value: 'PAYMENT_DATE', label: 'Payment Date' },
];
const CALCULATED_ON_OPTIONS = [
  { value: 'SUBTOTAL', label: 'Subtotal' },
  { value: 'TOTAL', label: 'Total' },
];

// §3.2 Screen Design: "The form is progressive … Choosing a Slab method reveals
// the band table; choosing Percentage hides it. Nothing irrelevant to the chosen
// scope is ever visible." FormScreenComponent also drops a hidden field from the
// request body, which is what makes switching method CLEAR the rate that no
// longer applies instead of leaving a stale figure on the row.
const whenMethod =
  (...methods: readonly string[]) =>
  (form: Record<string, unknown>) =>
    methods.includes(String(form['tax_type'] ?? ''));

// §3.2: "Only one of the fields above is unconditionally visible — the Creates
// an Onward Liability toggle. Everything else is revealed by it."
const whenOnwardLiability = (form: Record<string, unknown>) => !!form['creates_onward_liability'];

const whenWithholdingScope = (form: Record<string, unknown>) => form['scope'] === 'WITHHOLDING_AT_SOURCE';

// §6b fix #4 / ARCH-1-database-schema.md:588 ("Only meaningful on
// payroll/declaration scopes") — Tax Scheme is not one of the prototype's 23
// fields at all (tax_scheme_id was added to the schema after the prototype
// froze, same "later, approved addition" shape as Withholding itself), so
// there is no app-forms.js opts list to transcribe a scope gate from; these
// two are the only scopes a "which regime" choice is conceptually meaningful
// for — the others are flat contribution/deduction amounts, not a regime an
// employee elects between.
const whenScope =
  (...scopes: readonly string[]) =>
  (form: Record<string, unknown>) =>
    scopes.includes(String(form['scope'] ?? ''));

// Masters §4.3 audit fix: scope, tax_type and applies_from used to be
// createOnly here with no textual basis for it — the Status & Deletion Rule
// locks only "Rate, Amount, slab bands, split component shares, caps, and
// Slab Application" once a head is used in a calculation, and masters_taxes.py
// silently discarding a PUT to these three (they were in none of its three
// buckets) was a backend bug, not a spec requirement. masters_taxes.py now
// writes them as part of _ARITHMETIC_FIELDS, so they behave exactly like
// Rate/Amount/Slab Application below: editable, and rejected with a 409 (not
// silently dropped) once the head has actually been used in a calculation.
const ARITHMETIC_LOCK_HINT =
  'Locks once this head has been used in a calculation, the same as Rate/Amount/Slab Application below — set Applies Until on the locked head and add a new one with the new figures instead of trying to change it after that.';

const fields: readonly FieldConfig<TaxHeadRow>[] = [
  // ==================== Tax Details (prototype 'm.tax.head' section 1) ===
  {
    key: 'tax_name',
    label: 'Tax Name',
    required: true,
    span: 2,
    section: 'Tax Details',
    placeholder: 'Whatever this tax is called',
    hint: 'Appears wherever this tax can be picked — the Invoice and Quote dropdowns. Keep it unique within a Scope.',
  },
  {
    key: 'short_code',
    label: 'Short Code',
    placeholder: 'Short form, up to 20 characters',
    // Not in the trimmed §3.2 Fields Table or the prototype form, but it is a
    // real column on TaxHeadCreate, it is one of the two fields Search covers
    // (§3.2 Screen Design), and §3.2's lock rule names it as staying editable.
    // §6a — confirmed keep, placed here (right after Tax Name), client-2026-08-06.
    hint: 'Optional short form. Search covers Tax Name and Short Code.',
  },
  {
    key: 'tax_type',
    label: 'Tax Type',
    type: 'select',
    staticOptions: TAX_TYPE_OPTIONS,
    required: true,
    hint: `The one structural choice that decides which rate fields appear below. ${ARITHMETIC_LOCK_HINT}`,
  },
  {
    key: 'scope',
    label: 'Scope',
    type: 'select',
    staticOptions: SCOPE_OPTIONS,
    required: true,
    hint: `Where the head attaches: billing scopes reach Invoice and Quote, purchase scopes reach Purchase Bill and Expense, payroll scopes reach salary runs only. Withholding is the one scope where tax is deducted from a payment rather than added to a document — its Withholding Direction is set in Extra, below. ${ARITHMETIC_LOCK_HINT}`,
  },
  {
    key: 'tax_scheme_id',
    label: 'Tax Scheme',
    type: 'select',
    ref: { endpoint: '/masters/tax-schemes', labelKey: 'scheme_name' },
    visibleWhen: whenScope('PAYROLL_INCOME_TAX', 'EMPLOYEE_DECLARATION'),
    hideWhenRefEmpty: { endpoint: '/masters/tax-schemes', labelKey: 'scheme_name' },
    hint: 'Which alternative regime this declaration head belongs to (Masters → Taxes → Tax Schemes). Hidden entirely while none are configured — §3.2d: zero schemes is a valid, common state, not a broken screen.',
  },
  {
    key: 'applies_from',
    label: 'Applies From',
    type: 'date',
    required: true,
    hint: `The first date a document or payroll run uses this head. Records dated before it never see it. ${ARITHMETIC_LOCK_HINT}`,
  },
  {
    key: 'applies_until',
    label: 'Applies Until',
    type: 'date',
    // §3.2 / masters_taxes.py _LABEL_FIELDS: the one dated field that stays
    // editable even on a locked head — this is deliberately the field the
    // spec's own rate-change sequence ("set Applies Until, then Duplicate")
    // depends on, so it must never be locked or hidden.
    hint: 'Blank means still in force. Setting it retires the head from that date forward without touching anything already calculated under it. Stays editable even after the figures lock.',
  },

  // ==================== Rate — shown based on Tax Type ===================
  // Each of these is "Conditional — required if Tax Type is …" in §3.2's Fields
  // Table, and `required` + `visibleWhen` expresses exactly that: the check in
  // FormScreenComponent.save() runs over VISIBLE fields only. It is not
  // cosmetic — tax_engine._compute_gross asserts on each one, so a head saved
  // without its figure fails the first time anything tries to calculate with it.
  {
    key: 'rate_pct',
    label: 'Rate (%)',
    type: 'number',
    required: true,
    section: 'Rate — shown based on Tax Type',
    visibleWhen: whenMethod('GST_IGST', 'PERCENTAGE'),
    placeholder: '0.00',
    hint: 'A single rate — enter 18 for 18%.',
  },
  {
    key: 'cgst_rate_pct',
    label: 'CGST Rate (%)',
    type: 'number',
    required: true,
    visibleWhen: whenMethod('GST_CGST_SGST'),
    placeholder: '0.00',
    hint: 'Half of the combined rate. The two halves are added together when the tax is calculated.',
  },
  {
    key: 'sgst_rate_pct',
    label: 'SGST Rate (%)',
    type: 'number',
    required: true,
    visibleWhen: whenMethod('GST_CGST_SGST'),
    placeholder: '0.00',
    hint: 'Must equal the CGST Rate.',
  },
  // QUEUED / NOT DEPLOYMENT-CONFIGURABLE — the '₹' baked into this label (and
  // Declaration Cap's, just below) is a literal, the same §6 currency gap
  // already documented in full at cell-format.ts (formatMoney's en-IN/INR
  // literals) and taxes.list.config.ts (this screen's own amount() helper):
  // CompanyProfile has no currency_code / currency_symbol field to read from
  // at all — confirmed absent, not just unwired. Unlike those two this is a
  // static field LABEL, not a formatted value, so there is nothing to
  // delegate to yet either. Once a currency setting exists on Company Profile
  // and is loaded into ref-data.service.ts, either interpolate its symbol
  // into these labels or drop the symbol from the label text and let the
  // formatted value (once that reads from the same setting) carry it instead.
  {
    key: 'fixed_amount',
    label: 'Fixed Amount (₹)',
    type: 'number',
    required: true,
    visibleWhen: whenMethod('FIXED_AMOUNT'),
    placeholder: '0',
    hint: 'A flat charge, regardless of the document value.',
  },
  // Same '₹' literal gap as Fixed Amount above — see that comment.
  {
    key: 'declaration_cap',
    label: 'Declaration Cap (₹)',
    type: 'number',
    required: true,
    visibleWhen: whenMethod('DECLARATION_CAP'),
    placeholder: '0',
    hint: 'The maximum an employee may declare under this head per year.',
  },
  {
    key: 'slab_application',
    label: 'Slab Application',
    type: 'select',
    staticOptions: SLAB_APPLICATION_OPTIONS,
    required: true,
    visibleWhen: whenMethod('SLAB'),
    // Found live, this pass: this was marked NOT required, on the reasoning
    // that tax_engine._compute_slab treats anything other than FLAT_BY_BAND
    // as PROGRESSIVE — true of the engine, but ck_tax_heads_slab (DB CHECK,
    // 0002_masters.py:130) requires slab_application IS NOT NULL for every
    // SLAB-type row regardless, and always has. Saving a Slab head with this
    // left blank was a raw 500 (masters_taxes.py had no DBAPIError guard on
    // any write route at all — fixed alongside this), not a silently-fine
    // Progressive default. Corrected to match what the database actually
    // enforces, not what the engine could tolerate.
    hint: 'Progressive taxes only the portion of the base falling inside each band and adds them up; Flat by Band applies the one band the base lands in to the whole base.',
  },

  // ==================== Extra (prototype 'm.tax.head' section 3) =========
  {
    key: 'print_label',
    label: 'Print Label',
    section: 'Extra',
    placeholder: 'Short label for the document line',
    hint: 'Printed on the invoice or payslip line. Defaults to Tax Name if left blank.',
  },
  {
    key: 'creates_onward_liability',
    label: 'Creates an Onward Liability',
    type: 'checkbox',
    span: 2,
    // §3.2: the gate. Available on EVERY scope — it is what lets a payroll
    // deduction join the same remittance register as a supplier withholding,
    // and if no head anywhere has it on, Module 15 does not appear at all.
    hint: 'Available on every scope. Yes means the amount this head calculates is money the company holds on somebody else\'s behalf and must pay onward to a third party — not revenue, not an expense. This single switch is what puts a head into the Tax & Compliance register, and everything below is revealed by it.',
  },
  {
    key: 'remitted_to_authority',
    label: 'Remitted To (Authority)',
    visibleWhen: whenOnwardLiability,
    placeholder: 'Whoever this is actually paid to',
    hint: 'Groups the remittance register and prints on the remittance record. A label, never arithmetic, so it stays editable after the head\'s figures lock.',
  },
  {
    key: 'remittance_period',
    label: 'Remittance Period',
    type: 'select',
    staticOptions: REMITTANCE_PERIOD_OPTIONS,
    required: true,
    visibleWhen: whenOnwardLiability,
    hint: 'How often the accumulated amount is deposited. Per Document means each source document is its own obligation with its own due date, rather than being pooled into a period.',
  },
  {
    key: 'period_aligns_to',
    label: 'Period Aligns To',
    type: 'select',
    staticOptions: PERIOD_ALIGNS_OPTIONS,
    required: true,
    visibleWhen: whenOnwardLiability,
    hint: 'Calendar — calendar months and quarters. Financial Year — counted from the Financial Year start (§3.1). Pay Cycle — the payroll cycle from Work Week & Hours, which for a payroll head is the only alignment that makes the register agree with the payslips that produced it.',
  },
  {
    key: 'deposit_due_days_after_period_end',
    label: 'Deposit Due — Days After Period End',
    type: 'number',
    required: true,
    visibleWhen: whenOnwardLiability,
    placeholder: '0',
    hint: 'Days added to the last day of the period to get the deadline. Expressed as days rather than a fixed calendar day so it survives short months. Drives the Due Date, the Due Soon badge and the Overdue state.',
  },
  {
    key: 'liability_arises_on',
    label: 'Liability Arises On',
    type: 'select',
    staticOptions: LIABILITY_ARISES_OPTIONS,
    visibleWhen: whenOnwardLiability,
    // Not marked required — §3.2 words this one as "asked when", not "required
    // when", and the API accepts a head without it.
    hint: 'Which date decides the period an amount belongs to. Set it wrong and every total is right in aggregate but filed against the wrong period. Locks once the first remittance is recorded under this head.',
  },
  {
    key: 'authority_reference_label',
    label: 'Authority Reference Label',
    visibleWhen: whenOnwardLiability,
    placeholder: 'What this authority calls the reference on its receipt',
    hint: 'Labels the reference field on Record Remittance. This is the field that keeps any one authority\'s paperwork vocabulary out of the system itself.',
  },
  {
    // §3.2a Fields Table: "Conditional — required when Scope is Withholding /
    // Deduction at Source. At least one required." Enforced server-side by
    // _validate_withholding_directions (masters_taxes.py:141-149), so without
    // this control a withholding head could not be created from the UI at
    // all. The two values are the DB's own CHECK constraint
    // (ck_thwd_direction, migration 0002_masters.py:312) — not an invented
    // list. §6a — moved here from Tax Details to match the prototype's own
    // position (app-forms.js 'm.tax.head' section 3, between Authority
    // Reference Label and Default Calculated On), not a Scope-adjacent field.
    key: 'withholding_directions',
    label: 'Withholding Direction',
    type: 'checkgroup',
    required: true,
    span: 2,
    visibleWhen: whenWithholdingScope,
    staticOptions: [
      { value: 'ON_PAYMENTS_MADE', label: 'On payments this company makes' },
      { value: 'ON_PAYMENTS_RECEIVED', label: 'On payments this company receives' },
    ],
    hint: 'Which side of a payment the deduction happens on. Both may apply to one head.',
  },
  {
    key: 'default_calculated_on',
    label: 'Default Calculated On',
    type: 'select',
    staticOptions: CALCULATED_ON_OPTIONS,
    visibleWhen: whenWithholdingScope,
    hint: 'Withholding scope only. Pre-selects the Calculated On dropdown wherever this head is applied — the two bases produce materially different figures.',
  },
  {
    key: 'certificate_expected',
    label: 'Certificate Expected from Counterparty',
    type: 'checkbox',
    span: 2,
    // §3.2 shows this "when Direction includes On Payments Received". Direction
    // is not capturable in this form yet (see the Scope hint), so the nearest
    // honest gate is the withholding scope itself — a superset, never a
    // narrower condition than the spec's.
    visibleWhen: whenWithholdingScope,
    hint: 'Whether the counterparty is expected to issue a certificate evidencing what they withheld. When on, an uncertified receipt joins the chase queue; when off, it reads Not Expected and no chase is raised.',
  },
  {
    key: 'notes',
    label: 'Notes',
    type: 'textarea',
    span: 2,
    placeholder: 'Any internal notes — who levies it, a registration number, an internal reference',
    hint: 'Nothing here is validated. It exists so the next person to open this screen understands what a predecessor set up.',
  },
  {
    // §6a — createOnly, same §4a write-authority shape as every other
    // sub-master's own Status field this session added: settable only at
    // creation; afterward moves only through this list's own Deactivate row
    // action, Super Admin only. Deliberately deferred out of the earlier
    // §3b/§3c pass specifically until this from-scratch rebuild rather than
    // added once and reshuffled twice.
    key: 'is_active',
    label: 'Status',
    type: 'checkbox',
    createOnly: true,
    staticOptions: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    hint: 'Defaults to Active. Uncheck to create this tax head already inactive.',
  },
];

const config: FormScreenConfig<TaxHeadRow> = {
  shape: 'form',
  id: 'masters.taxes',
  title: 'Tax Head',
  listEndpoint: '/masters/taxes',
  createEndpoint: '/masters/taxes',
  updateEndpoint: (id) => `/masters/taxes/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/taxes'],
  emptyRow: () => ({
    tax_name: '',
    short_code: null,
    scope: 'SALES_BILLING',
    tax_type: 'PERCENTAGE',
    tax_scheme_id: null,
    applies_from: '',
    applies_until: null,
    rate_pct: null,
    cgst_rate_pct: null,
    sgst_rate_pct: null,
    fixed_amount: null,
    declaration_cap: null,
    slab_application: null,
    print_label: null,
    notes: null,
    creates_onward_liability: false,
    remitted_to_authority: null,
    remittance_period: null,
    period_aligns_to: null,
    deposit_due_days_after_period_end: null,
    liability_arises_on: null,
    authority_reference_label: null,
    default_calculated_on: 'SUBTOTAL',
    certificate_expected: false,
    is_active: true,
    slab_bands: [],
    split_components: [],
    relief_rules: [],
  }),
  fields,
  // §6a — Slab Bands, Split Components and Relief Rules moved OUT of this
  // form into their own screens (masters.taxes.slab / .split / .relief in
  // the prototype), matching its "a clean 25-field form, three child editors
  // reached by their own buttons" shape instead of one page with three
  // embedded tables. Edit-mode only (recordActions never shows in create
  // mode) — a brand-new head has no id yet for these screens to load by.
  // See tax-head-child-screen.component.ts's own doc comment for how they
  // still round-trip through this same form's PUT under the hood.
  recordActions: [
    { label: 'Slab Bands', routeFor: (id) => ['/masters/taxes', id, 'slab-bands'], countFrom: 'slab_bands' },
    { label: 'Split Components', routeFor: (id) => ['/masters/taxes', id, 'split-components'], countFrom: 'split_components' },
    { label: 'Relief Rules', routeFor: (id) => ['/masters/taxes', id, 'relief-rules'], countFrom: 'relief_rules' },
  ],
};

export default config;
