import { ListScreenConfig } from '../../../shared/screens/screen.types';
import { AssetMaintenanceRow } from '../asset.api';

const CATEGORY_REF = { endpoint: '/masters/asset-categories' };
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses', labelKey: 'line1' };
const VENDOR_REF = { endpoint: '/vendors', labelKey: 'vendor_name' };
// §0.7: a plain {endpoint:'/assets'} works cleanly for an asset picker —
// AssetOut.name is a real top-level field, unlike Employee's split
// first_name/last_name. Two separate labelKeys against the SAME endpoint
// (Tag vs Name columns) cache as two independent RefDataService lookups.
const ASSET_REF = { endpoint: '/assets' };
const ASSET_TAG_REF = { endpoint: '/assets', labelKey: 'asset_tag' };

// §2.4's own single "Maintenance Status" filter (All/Completed/Overdue/
// Upcoming) — AssetMaintenanceOut.maintenance_status is a live-computed
// field (_maintenance_status(), assets.py), already present on every row
// the JSON response returns, so a 'client' transport predicate over it is
// real data, not a fabrication — just no dedicated query param exists for
// it server-side (list_all_maintenance() only has overdue_only/
// upcoming_only booleans, which this replaces: as two INDEPENDENT filters
// they could be set together and silently AND into an always-empty result,
// since maintenance_status can never be both Overdue and Upcoming at once).
const MAINTENANCE_STATUS_OPTIONS = [
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'UPCOMING', label: 'Upcoming' },
];

// §3 Maintenance & Service Log — company-wide (asset.maintenance). GET
// /maintenance — every query param below confirmed against
// list_all_maintenance() (backend/app/api/v1/assets.py). No sensitive_fields
// registered on this screen at all (§0.2) — Cost is a deliberate asymmetry
// against asset.directory's own Purchase/Current Value masking, not
// something to "fix" here.
const config: ListScreenConfig<AssetMaintenanceRow> = {
  shape: 'list',
  id: 'asset.maintenance',
  title: 'Maintenance & Service Log',
  specRef: '§2.4',
  recordNoun: 'maintenance entry',
  endpoint: '/maintenance',
  exportable: true,
  defaultPageSize: 25,
  rowId: (row) => row.id,
  // No createRoute — creation only ever happens from inside the per-asset
  // Maintenance & Service Log tab (asset.maintenance-log.component.ts),
  // there is no standalone "+ Add" here.
  searchParam: 'search',
  searchFields: ['asset_tag_col', 'description'],
  includeInactiveParam: false,
  filters: [
    { key: 'category_id', label: 'Category', kind: 'select', transport: 'server', allLabel: 'All Categories', optionsRef: CATEGORY_REF },
    // §2.4 filterNames order: Category, Maintenance Status, Asset.
    { key: 'maintenance_status', label: 'Maintenance Status', kind: 'select', transport: 'client', allLabel: 'All Statuses', options: MAINTENANCE_STATUS_OPTIONS, predicate: (row, v) => row.maintenance_status === v },
    { key: 'asset_id', label: 'Asset', kind: 'select', transport: 'server', allLabel: 'All Assets', optionsRef: ASSET_REF },
    { key: 'location_address_id', label: 'Location', kind: 'select', transport: 'server', allLabel: 'All Locations', optionsRef: LOCATION_REF },
    { key: 'serviced_by_vendor_id', label: 'Serviced By', kind: 'select', transport: 'server', allLabel: 'All Vendors', optionsRef: VENDOR_REF },
    { key: 'service_date', label: 'Service Date', kind: 'daterange', transport: 'server' },
    // §0.6 — NOT 'next_due_date'. list_all_maintenance()'s own query params
    // are next_due_from/next_due_to.
    { key: 'next_due', label: 'Next Due Date', kind: 'daterange', transport: 'server' },
    // §0.5/0.6 — the new 'numberrange' FilterKind; server params are
    // cost_min/cost_max.
    { key: 'cost', label: 'Cost', kind: 'numberrange', transport: 'server' },
  ],
  columns: [
    { key: 'asset_tag_col', header: 'Asset Tag', cellClass: 'mono', compute: (row) => row.asset_id, ref: ASSET_TAG_REF },
    { key: 'asset_name_col', header: 'Asset Name', cellClass: 'cell-strong', compute: (row) => row.asset_id, ref: ASSET_REF },
    { key: 'log_date', header: 'Date', type: 'date' },
    { key: 'description', header: 'Description' },
    { key: 'cost', header: 'Cost', type: 'money' },
    { key: 'next_due_date', header: 'Next Due Date', type: 'date' },
    { key: 'maintenance_status', header: 'Status', type: 'status' },
  ],
  emptyText: 'No maintenance logged yet.',
};

export default config;
