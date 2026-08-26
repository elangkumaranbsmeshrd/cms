import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { formatMoney } from '../../../shared/screens/cell-format';
import { ASSET_STATUS_OPTIONS, AssetRow } from '../asset.api';

const CATEGORY_REF = { endpoint: '/masters/asset-categories' };
// §0.3: GET /employees returns first_name/last_name as separate fields, no
// {id,name} shape — labelKey: 'first_name' is the established workaround
// used repeatedly across every other already-built module.
const EMPLOYEE_REF = { endpoint: '/employees', labelKey: 'first_name' };
// §0.7: CompanyAddress has no `name` field at all — line1 is the imperfect
// but functional stand-in; the endpoint takes no query params, so this
// fetches unfiltered, same as every other RefLookup.
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses', labelKey: 'line1' };
const DEPARTMENT_REF = { endpoint: '/masters/departments' };

// current_value (AssetOut.current_value: Decimal-as-string, OR the literal
// "Not available") can't use ColumnDef's own `type: 'money'` — formatMoney()'s
// Number(raw) on "Not available" is NaN, which silently renders as a blank
// em-dash instead of the real message (§0.4). This compute formats the
// numeric case through the shared formatMoney() and passes any non-numeric
// string (i.e. "Not available") through untouched.
function currentValueDisplay(row: AssetRow): string | null {
  const v = row.current_value;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? formatMoney(n) : v;
}

// §1 Asset Directory (asset.directory). GET /assets — every query param below
// confirmed against list_assets() (backend/app/api/v1/assets.py).
const config: ListScreenConfig<AssetRow> = {
  shape: 'list',
  id: 'asset.directory',
  title: 'Asset Directory',
  specRef: '§2.1',
  recordNoun: 'asset',
  endpoint: '/assets',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  rowRoute: (row) => ['/assets', row.id],
  createRoute: ['/assets', 'new'],
  createLabel: 'Add Asset',
  createScreenAction: 'edit',
  searchParam: 'search',
  searchFields: ['asset_tag', 'name', 'serial_number'],
  includeInactiveParam: false,
  filters: [
    { key: 'category_id', label: 'Category', kind: 'select', transport: 'server', allLabel: 'All Categories', optionsRef: CATEGORY_REF },
    { key: 'status', label: 'Status', kind: 'multiselect', transport: 'server', allLabel: 'All Statuses', options: ASSET_STATUS_OPTIONS },
    // list_assets(): a Manager (perms.mode === 'view_team') is scoped to
    // their direct reports' assets regardless of what assigned_to carries —
    // the param is only read in the `elif assigned_to:` branch, i.e. NEVER
    // for a Manager. Left visible here it would look like a working filter
    // that silently does nothing for exactly one role.
    { key: 'assigned_to', label: 'Assigned Employee', kind: 'select', transport: 'server', allLabel: 'All Employees', optionsRef: EMPLOYEE_REF, hideForRoles: ['MANAGER'] },
    { key: 'location_address_id', label: 'Location', kind: 'select', transport: 'server', allLabel: 'All Locations', optionsRef: LOCATION_REF },
    { key: 'department_id', label: 'Department', kind: 'select', transport: 'server', allLabel: 'All Departments', optionsRef: DEPARTMENT_REF },
    { key: 'purchase_date', label: 'Purchase Date', kind: 'daterange', transport: 'server' },
    { key: 'order_date', label: 'Order Date', kind: 'daterange', transport: 'server' },
    { key: 'warranty_expiry', label: 'Warranty Expiry', kind: 'daterange', transport: 'server' },
    // §0.5/0.6 — the new 'numberrange' FilterKind (screen.types.ts). Server
    // params are purchase_value_min/purchase_value_max.
    // hideWhenFieldHidden is screen.types.ts's own documented worked example
    // for precisely this situation — a role without "Show Purchase Value"
    // sees neither the Purchase Value column nor a filter that would
    // silently return nothing useful for them either.
    { key: 'purchase_value', label: 'Purchase Value', kind: 'numberrange', transport: 'server', hideWhenFieldHidden: 'purchase_value' },
  ],
  columns: [
    { key: 'asset_tag', header: 'Asset Tag', type: 'code' },
    { key: 'name', header: 'Name', cellClass: 'cell-strong' },
    { key: 'category_id', header: 'Category', ref: CATEGORY_REF },
    { key: 'status', header: 'Status', type: 'status', staticOptions: ASSET_STATUS_OPTIONS },
    { key: 'assigned_to', header: 'Assigned To', ref: EMPLOYEE_REF },
    { key: 'purchase_value', header: 'Purchase Value', type: 'money' },
    { key: 'current_value', header: 'Current Value', compute: currentValueDisplay },
  ],
  // §1: export is a fixed 5-column server-side set (asset_tag/name/category/
  // status/assigned_to — _ASSET_LIST_COLUMNS in assets.py). Purchase/Current
  // Value never appear in export for any role — server behavior, nothing to
  // configure client-side.
  emptyText: 'No assets added yet.',
};

export default config;
