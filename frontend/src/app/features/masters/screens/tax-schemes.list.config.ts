import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { TaxSchemeRow } from '../masters.api';

// app-forms.js 'm.tax.scheme' opts, and the DB's own ck_tax_schemes_window —
// exported so tax-schemes.form.config.ts's select and this list's Choice
// Window column can never show two different labels for one stored value.
export const CHOICE_WINDOW_OPTIONS = [
  { value: 'ONCE_PER_FY', label: 'Once per financial year' },
  { value: 'ANY_TIME', label: 'Changeable any time' },
  { value: 'FIXED_AT_JOINING', label: 'Fixed at joining' },
];

// §6b — the prototype's Tax Schemes tab body (app-screens2.js:651-653) is
// exactly this 5-column table plus a "+ Add Tax Scheme" button; built as its
// own ListScreenConfig (not scopedTab() from taxes.tabbed.config.ts, which
// only ever narrows the SAME tax-heads endpoint by scope) because this reads
// a genuinely different resource, /masters/tax-schemes.
const config: ListScreenConfig<TaxSchemeRow> = {
  shape: 'list',
  id: 'masters.taxes',
  title: 'Tax Schemes',
  specRef: '§3.2d',
  recordNoun: 'tax scheme',
  description:
    'Optional alternative tax regimes an employee elects between. Zero, two or five schemes are all valid states — with none configured, the whole concept disappears from the Tax Head form and the employee declaration screen.',
  endpoint: '/masters/tax-schemes',
  exportable: true,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/taxes/schemes', row.id, 'edit'],
  createRoute: ['/masters/taxes/schemes', 'new'],
  createLabel: 'Add Tax Scheme',
  // masters_tax_schemes.list_tax_schemes accepts exactly `include_inactive`
  // and `format` — same "only two dimensions round-trip server-side" shape
  // as every masters_lookup.py-backed screen (see e.g.
  // payment-modes.list.config.ts's own comment on this exact convention),
  // so Status renders as the shared "Show inactive" checkbox, not a
  // 3-option filter, and everything else here is client-side.
  searchParam: false,
  searchFields: ['scheme_name', 'description'],
  includeInactiveParam: 'include_inactive',
  filters: [
    {
      key: 'is_default',
      label: 'Is Default',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Default — Any',
      predicate: (row, v) => (v === 'yes' ? row.is_default : !row.is_default),
    },
    {
      key: 'is_referenced',
      label: 'Used',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Used — Any',
      predicate: (row, v) => (v === 'yes' ? row.is_referenced : !row.is_referenced),
    },
  ],
  // Exactly §6b's own 5-column spec — the prototype's own mini() call
  // (app-screens2.js:652) carries no Status column either; Active/Inactive
  // is visible only through the Show-inactive checkbox and the row actions.
  columns: [
    { key: 'scheme_name', header: 'Scheme', cellClass: 'cell-strong' },
    { key: 'is_default', header: 'Is Default', type: 'status' },
    { key: 'description', header: 'Description' },
    { key: 'choice_window', header: 'Choice Window', staticOptions: CHOICE_WINDOW_OPTIONS },
    { key: 'declaration_heads_count', header: 'Declaration Heads', type: 'number' },
  ],
  rowActions: [
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/tax-schemes/${row.id}/deactivate`,
      screenAction: 'delete',
      visible: (row) => row.is_active,
      confirm: 'Deactivating retires this scheme from every picker. Blocked while any Tax Head still links to it.',
    },
    {
      label: 'Activate',
      endpoint: (row) => `/masters/tax-schemes/${row.id}/activate`,
      screenAction: 'delete',
      visible: (row) => !row.is_active,
    },
    {
      label: 'Delete',
      method: 'DELETE',
      endpoint: (row) => `/masters/tax-schemes/${row.id}`,
      screenAction: 'delete',
      visible: (row) => !row.is_referenced,
      confirm: 'Permanently delete this tax scheme? This only succeeds while no Tax Head links to it.',
    },
  ],
  defaultPageSize: 25,
  emptyText: 'No tax schemes configured yet. Until one exists, the Tax Scheme field is hidden everywhere it would otherwise appear.',
};

export default config;
