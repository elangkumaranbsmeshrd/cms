import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { CompanyAddressRow } from '../masters.api';

// company_addresses.state_id is a plain FK into the seeded indian_states
// table; masters_company_profile.py:55 is the only endpoint that lists it and
// returns {id, name, code, gst_state_code}, so the default labelKey 'name'
// both resolves the State column and sources the State filter's options —
// one cached fetch shared by the two (RefDataService keys on endpoint).
const STATE_REF = { endpoint: '/masters/company-profile/indian-states' };

// Verbatim from the DB CHECK constraint ck_company_addresses_type
// (alembic/versions/0002_masters.py) — the same three values the form config
// writes, kept here so the column renders a readable label instead of
// REGISTERED_OFFICE and the filter offers exactly what the API accepts.
const ADDRESS_TYPE_OPTIONS = [
  { value: 'REGISTERED_OFFICE', label: 'Registered Office' },
  { value: 'BRANCH_OFFICE', label: 'Branch Office' },
  { value: 'CORRESPONDENCE', label: 'Correspondence' },
];

// The prototype's Addresses tab shows one "Address" column holding the whole
// street part (data.js:740 `line`), not two lines — joined here rather than
// spending a second column on an optional field that is usually empty.
function streetLine(row: CompanyAddressRow): string {
  return [row.line1, row.line2].filter(Boolean).join(', ');
}

const config: ListScreenConfig<CompanyAddressRow> = {
  shape: 'list',
  id: 'masters.company_profile',
  title: 'Company Addresses',
  specRef: '§3.6b',
  recordNoun: 'address',
  description:
    'Only one address can be Primary at a time; the Primary one is what General Info shows as Registered Address.',
  endpoint: '/masters/company-profile/addresses',
  // list_addresses (masters_company_profile.py:123) is a bare
  // `select(CompanyAddress)` with NO Query parameters at all — no search, no
  // include_inactive, and no format. So export is off (nothing server-side
  // builds a PDF/Excel for this list), search is client-side, and every
  // filter below is necessarily transport 'client'.
  exportable: false,
  searchParam: false,
  searchFields: ['line1', 'line2', 'city', 'pin_code'],
  includeInactiveParam: false,
  filters: [
    {
      // Client: the endpoint takes no params whatsoever (see above), so this
      // is a JS filter over the fetched array.
      key: 'address_type',
      label: 'Address Type',
      kind: 'select',
      transport: 'client',
      allLabel: 'All Address Types',
      options: ADDRESS_TYPE_OPTIONS,
      predicate: (row, v) => row.address_type === v,
    },
    {
      // Client for the same reason. Options come from the same indian_states
      // lookup the State column resolves through, so the chip reads
      // "State: Tamil Nadu" rather than a UUID.
      key: 'state_id',
      label: 'State',
      kind: 'select',
      transport: 'client',
      allLabel: 'All States',
      optionsRef: STATE_REF,
      predicate: (row, v) => row.state_id === v,
    },
    {
      key: 'is_primary',
      label: 'Primary',
      kind: 'tristate',
      transport: 'client',
      allLabel: 'Primary — Any',
      predicate: (row, v) => (v === 'yes' ? !!row.is_primary : !row.is_primary),
    },
    {
      // Masters §3.0's "defaulting to Active with an explicit include-inactive
      // option" — normally the store's own Show-inactive toggle, but that
      // needs an `include_inactive` query param and this endpoint has none, so
      // the rule is honoured here as a defaulted client filter instead. Note
      // this is why deactivated addresses aren't visible until it's changed.
      key: 'is_active',
      label: 'Status',
      kind: 'activeInactive',
      transport: 'client',
      allLabel: 'All Statuses',
      defaultValue: 'active',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
      predicate: (row, v) => (v === 'active' ? !!row.is_active : !row.is_active),
    },
  ],
  columns: [
    { key: 'address_type', header: 'Address Type', cellClass: 'cell-strong', staticOptions: ADDRESS_TYPE_OPTIONS },
    { key: 'line1', header: 'Address', compute: streetLine },
    { key: 'city', header: 'City' },
    { key: 'state_id', header: 'State', ref: STATE_REF },
    { key: 'pin_code', header: 'PIN', cellClass: 'mono' },
    { key: 'is_primary', header: 'Primary', type: 'status' },
    { key: 'is_active', header: 'Status', type: 'status', compute: (row) => (row.is_active ? 'Active' : 'Inactive') },
  ],
  rowId: (row) => row.id,
  rowRoute: (row) => ['/masters/company-profile/addresses', row.id, 'edit'],
  createRoute: ['/masters/company-profile/addresses', 'new'],
  // The prototype's own button label on the Addresses tab (app-screens2.js:709).
  createLabel: 'Add Another Address',
  rowActions: [
    {
      label: 'Set Primary',
      endpoint: (row) => `/masters/company-profile/addresses/${row.id}/set-primary`,
      screenAction: 'edit',
      // Deactivated rows excluded deliberately: promoting a retired address to
      // the one General Info prints as Registered Address is never intended,
      // and the API's own swap logic doesn't check is_active.
      visible: (row) => !row.is_primary && row.is_active,
    },
    {
      label: 'Deactivate',
      endpoint: (row) => `/masters/company-profile/addresses/${row.id}/deactivate`,
      // 'edit', NOT 'delete' as on the other sub-masters: masters.company_profile
      // registers exactly one action, `actions=("edit",)`
      // (app/rbac/registry/screens.py:67), and deactivate_address itself is
      // gated on require_screen(SCREEN, action="edit"). Asking for 'delete'
      // here would hide the button from every role, Super Admin included.
      screenAction: 'edit',
      visible: (row) => row.is_active && !row.is_primary,
      confirm:
        'Deactivate this address? It stops being offered wherever addresses are picked, and there is no reactivate endpoint — a replacement has to be added instead.',
    },
  ],
  defaultPageSize: 50,
  emptyText: 'No addresses configured yet.',
};

export default config;
