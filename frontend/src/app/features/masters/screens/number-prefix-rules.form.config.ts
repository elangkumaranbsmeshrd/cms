import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { NumberPrefixRuleRow } from '../masters.api';

// The prototype locks Code Type to a "Fixed list" (app-forms.js:891), and the
// database agrees: ck_prefix_rules_type (0002_masters.py, last widened in
// 0007_tax_compliance.py) allows exactly these seventeen values and rejects
// anything else outright. It was a free-text input here, which meant any typo
// came back as a 422 with no way to discover the legal values.
//
// The thirteen named ones are already seeded (seed.py SEED_NUMBER_PREFIX_RULES)
// and POST 409s on a code type that already has a rule — so on a seeded install
// this create form is really only reachable for the four reserved slots, which
// is exactly the case create_prefix_rule was added for ("a code type Section
// 3.6e doesn't anticipate"). The four carry no label of their own anywhere in
// the spec or the code, so they are not given an invented meaning here.
const CODE_TYPE_OPTIONS = [
  { value: 'INV', label: 'INV — Invoice Number' },
  { value: 'PB', label: 'PB — Purchase Bill Number' },
  { value: 'CUST', label: 'CUST — Customer Code' },
  { value: 'AST', label: 'AST — Asset Code' },
  { value: 'TKT', label: 'TKT — Ticket Number' },
  { value: 'EMP', label: 'EMP — Employee Code' },
  { value: 'PRJ', label: 'PRJ — Project Code' },
  { value: 'OPP', label: 'OPP — Opportunity Code' },
  { value: 'CN', label: 'CN — Credit Note Number' },
  { value: 'QUO', label: 'QUO — Quotation Number' },
  { value: 'LTR', label: 'LTR — Offer / Appointment / Acceptance Letter Number' },
  { value: 'CHR', label: 'CHR — Compensatory Hour Request Number' },
  { value: 'RMT', label: 'RMT — Remittance Number' },
  { value: 'EXP', label: 'EXP — reserved, no generator yet' },
  { value: 'CMP', label: 'CMP — reserved, no generator yet' },
  { value: 'TSK', label: 'TSK — reserved, no generator yet' },
  { value: 'BUG', label: 'BUG — reserved, no generator yet' },
];

function digitsOf(model: Partial<NumberPrefixRuleRow>): number {
  const n = Number(model.running_number_digits ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const config: FormScreenConfig<NumberPrefixRuleRow> = {
  shape: 'form',
  id: 'masters.company_profile',
  title: 'Number Prefix Rule',
  listEndpoint: '/masters/company-profile/number-prefix-rules',
  createEndpoint: '/masters/company-profile/number-prefix-rules',
  // Keyed by code_type (see the list config's own note) — updatePrefixRule
  // is PUT /number-prefix-rules/{code_type}, not an id.
  updateEndpoint: (codeType) => `/masters/company-profile/number-prefix-rules/${codeType}`,
  rowId: (row) => row.code_type,
  listRoute: ['/masters/company-profile/prefix-rules'],
  emptyRow: () => ({
    code_type: '',
    label: '',
    prefix: '',
    include_fy_in_code: true,
    running_number_digits: 4,
    starting_number: 1,
    resets_every_fy: true,
  }),
  fields: [
    // code_type/label only exist on the Create schema — immutable once a
    // rule exists, per NumberPrefixRuleWrite (the PUT body shape) not
    // carrying either field at all.
    {
      key: 'code_type',
      label: 'Code Type',
      type: 'select',
      staticOptions: CODE_TYPE_OPTIONS,
      createOnly: true,
      required: true,
      hint: 'Fixed list — the database rejects any value outside it. One rule per code type; a type that already has one is edited, not re-added.',
    },
    {
      key: 'label',
      label: 'Label',
      createOnly: true,
      required: true,
      span: 2,
      placeholder: 'e.g. Invoice Number',
      hint: 'How this row is named on screen — the Document column of the list.',
    },
    {
      key: 'prefix',
      label: 'Prefix',
      required: true,
      placeholder: 'e.g. INV',
      hint: 'Must be 2–6 uppercase letters, no spaces',
      // Mirrors ck_prefix_rules_prefix (REGEXP '^[A-Z]{2,6}$').
      pattern: { re: /^[A-Z]{2,6}$/, message: 'Prefix must be 2–6 uppercase letters, no spaces' },
    },
    {
      key: 'include_fy_in_code',
      label: 'Include Financial Year in Code',
      type: 'checkbox',
      hint: 'When on, the Financial Year Label is stamped between the prefix and the running number — INV-2026-00001 rather than INV-00001.',
    },
    {
      key: 'running_number_digits',
      label: 'Running Number Digits',
      type: 'number',
      required: true,
      hint: 'Must be between 3 and 6',
      // Mirrors ck_prefix_rules_digits (BETWEEN 3 AND 6).
      pattern: { re: /^[3-6]$/, message: 'Running Number Digits must be between 3 and 6' },
    },
    {
      key: 'starting_number',
      label: 'Starting Number',
      type: 'number',
      required: true,
      // NOT hidden once locked, even though the API 409s on a change: PUT's
      // body requires starting_number, and a field hidden by visibleWhen is
      // not submitted at all — hiding it would turn every edit of a locked
      // rule into a 422. The lock is surfaced in the preview block instead.
      hint: 'Cannot be changed once any code of this type has been generated — only the prefix and future behaviour can be adjusted from then on.',
    },
    {
      key: 'resets_every_fy',
      label: 'Resets Every Financial Year',
      type: 'checkbox',
      hint: 'When on, the running number restarts at the Starting Number on the first record created in each new financial year.',
    },
  ],
  // The prototype's live "Example Preview" (app-forms.js:896). The FY segment
  // stays as the <FY> placeholder deliberately: the label of a financial year
  // is whatever calendar year its start_date falls in (financial_years.py:75),
  // which this form cannot know without a fetch — and inventing "2026" here
  // would be a guess printed as fact.
  previewFields: [
    {
      label: 'Code Format',
      compute: (m) => {
        const running = '0'.repeat(digitsOf(m));
        // Same f-string as numbering.py:64, so the preview cannot drift from
        // what allocate_number() actually renders.
        return m.include_fy_in_code ? `${m.prefix ?? ''}-<FY>-${running}` : `${m.prefix ?? ''}-${running}`;
      },
    },
    {
      label: 'First Code Generated',
      compute: (m) => {
        const first = String(Number(m.starting_number ?? 0)).padStart(digitsOf(m), '0');
        return m.include_fy_in_code ? `${m.prefix ?? ''}-<FY>-${first}` : `${m.prefix ?? ''}-${first}`;
      },
    },
    {
      label: 'Starting Number',
      // Matches the prototype's own lock caption ("Locked — 153 already
      // generated"), driven by the two real response fields.
      compute: (m) =>
        m.starting_number_locked
          ? `Locked — ${m.generated_count ?? 0} code(s) of this type already generated`
          : 'Still editable — no code of this type has been generated yet',
    },
  ],
};

export default config;
