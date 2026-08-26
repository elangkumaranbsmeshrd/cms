import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { NumberPrefixRuleRow } from '../masters.api';

// The prototype's Number Prefixes tab carries a "Format" column
// (data.js:730 — 'EMP-<FY>-0000'), which is the one thing on this screen that
// tells a reader at a glance what a generated code will look like. Derived,
// not stored: this mirrors numbering.py:64's own f-string exactly —
// `{prefix}-{fy_label}-{running}` when include_fy_in_code, `{prefix}-{running}`
// otherwise — so the preview can't drift from what the allocator actually does.
function codeFormat(row: NumberPrefixRuleRow): string {
  const digits = Number(row.running_number_digits);
  const running = '0'.repeat(Number.isFinite(digits) && digits > 0 ? digits : 0);
  return row.include_fy_in_code ? `${row.prefix}-<FY>-${running}` : `${row.prefix}-${running}`;
}

const config: ListScreenConfig<NumberPrefixRuleRow> = {
  shape: 'list',
  id: 'masters.company_profile',
  title: 'Number Prefix Rules',
  specRef: '§3.6e',
  recordNoun: 'number prefix rule',
  description:
    'Starting Number locks once any code of that type has been generated; only the prefix and future behaviour can change.',
  endpoint: '/masters/company-profile/number-prefix-rules',
  // list_prefix_rules (masters_company_profile.py:199) is a bare
  // `select(NumberPrefixRule)` — no search, no include_inactive, no format
  // param. Hence no export, client-side search, and client-only filters. There
  // is also no is_active column on this table at all (NumberPrefixRuleOut has
  // no such field): a numbering rule is never retired, only edited.
  exportable: false,
  searchParam: false,
  searchFields: ['label', 'code_type', 'prefix'],
  includeInactiveParam: false,
  filters: [
    {
      // Client: the endpoint takes no query params (see above).
      key: 'include_fy_in_code',
      label: 'Includes FY',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Includes FY — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.include_fy_in_code : !row.include_fy_in_code),
    },
    {
      key: 'resets_every_fy',
      label: 'Resets Every FY',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Resets Every FY — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.resets_every_fy : !row.resets_every_fy),
    },
    {
      // This screen's equivalent of the prototype's "Used — Any" tri-state,
      // and the one place in Masters where that dimension is a real server
      // field rather than a guess: starting_number_locked flips the first time
      // allocate_number() issues a code of this type (numbering.py:72).
      key: 'starting_number_locked',
      label: 'Starting Number',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Starting Number — Any',
      formatChip: (v) => (String(v) === 'yes' ? 'Locked' : 'Still editable'),
      predicate: (row, v) => (v === 'yes' ? !!row.starting_number_locked : !row.starting_number_locked),
    },
  ],
  columns: [
    { key: 'label', header: 'Document', cellClass: 'cell-strong' },
    { key: 'code_type', header: 'Code Type', type: 'code' },
    { key: 'prefix', header: 'Prefix', type: 'code' },
    { key: 'format', header: 'Format', cellClass: 'mono', compute: codeFormat },
    { key: 'running_number_digits', header: 'Digits', type: 'number' },
    { key: 'starting_number', header: 'Starting Number', type: 'number' },
    { key: 'generated_count', header: 'Generated', type: 'number' },
    { key: 'resets_every_fy', header: 'Resets Every FY', type: 'status' },
    {
      key: 'starting_number_locked',
      header: 'Locked',
      type: 'status',
      // 'Locked'/'Editable' rather than the raw boolean's Yes/No: badgeClass
      // maps 'locked' to the danger badge (cell-format.ts:20), which is the
      // right signal here — a locked Starting Number is a one-way door.
      compute: (row) => (row.starting_number_locked ? 'Locked' : 'Editable'),
    },
  ],
  // Keyed by code_type, not id — the real PUT endpoint is
  // /number-prefix-rules/{code_type}, so that's what has to travel in the
  // route for edit navigation to hit the right resource.
  rowId: (row) => row.code_type,
  rowRoute: (row) => ['/masters/company-profile/prefix-rules', row.code_type, 'edit'],
  createRoute: ['/masters/company-profile/prefix-rules', 'new'],
  createLabel: 'Add Number Prefix Rule',
  // No rowActions: this router has no delete and no deactivate for prefix
  // rules — every other module resolves its codes through these rows, so a
  // rule is edited, never removed. Nothing to wire, rather than a button that
  // would 405.
  defaultPageSize: 50,
  emptyText: 'No number prefix rules found.',
};

export default config;
