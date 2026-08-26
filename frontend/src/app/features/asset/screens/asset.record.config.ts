import { RecordScreenConfig } from '../../../shared/screens/screen.types';
import { formatDate, formatMoney, humanizeEnum } from '../../../shared/screens/cell-format';
import { ASSET_STATUS_OPTIONS, AssetRow } from '../asset.api';
import { AssetAssignmentHistoryComponent } from './asset.assignment-history.component';
import { AssetAttachmentsComponent } from './asset.attachments.component';
import { AssetMaintenanceLogComponent } from './asset.maintenance-log.component';

const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };
const VENDOR_REF = { endpoint: '/vendors/options', labelKey: 'label' };
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };

// Same current_value string-or-number handling as
// asset.directory.list.config.ts's own currentValueDisplay — duplicated
// rather than shared, matching this codebase's per-file convention for
// small config-local helpers (RefLookup consts, staticOptions arrays, etc.
// are never centralized into a shared utils module here).
function currentValueDisplay(row: AssetRow): string | null {
  const v = row.current_value;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? formatMoney(n) : v;
}

// §2 Asset Master Record (asset.directory, shape 'record', route
// assets/:id). Header note: RecordHeaderConfig's 4 slots (primary/secondary/
// code/badge) are each a plain `(row) => string` with no injector access, so
// none of them can resolve an FK through RefDataService the way a FieldConfig
// `ref` can (confirmed against every existing *.record.config.ts — none puts
// an FK in its header either). §2's own "Header shown on every tab: Asset
// Tag, Name, Category, Status" therefore renders as Asset Tag/Name/Status
// (all resolvable with no ref) plus Purchase Date as the secondary line;
// Category is shown properly resolved on the Details tab below instead of as
// a raw, unreadable id in the header.
const config: RecordScreenConfig<AssetRow> = {
  shape: 'record',
  id: 'asset.directory',
  title: 'Asset Master Record',
  loadEndpoint: (id) => `/assets/${id}`,
  edit: { saveEndpoint: (id) => `/assets/${id}` },
  header: {
    primary: (row) => row.name,
    secondary: (row) => `Purchase Date ${formatDate(row.purchase_date)}`,
    code: (row) => row.asset_tag,
    badge: (row) => humanizeEnum(row.status),
  },
  // §2 record-level action bar: Save (built-in Edit/Save flow above) /
  // Download Asset Card / Mark Retired-Disposed, in that order — matching
  // the prototype's own R.record actions() array (app-screens2.js:284-286),
  // which puts all three in the persistent header, NOT scoped to the
  // Details tab. "Download Asset Card" — GET /assets/{id}/pdf, canOpen only
  // (no action= server-side at all), same blob-download mechanism as every
  // list/report export in this app. "Mark Retired/Disposed" — POST
  // /assets/{id}/retire, action="edit". `reason` is a REQUIRED QUERY PARAM
  // (bare `reason: str`, not a JSON body) — built via window.prompt(), the
  // same synchronous-prompt-in-the-URL-builder technique RowActionDef's own
  // body-prompt convention uses (emp.documents.list.config.ts's Reject,
  // asset.requests.list.config.ts's own Reject) — cancelling or leaving it
  // blank still submits, same disclosed behaviour as those. Hidden once
  // already retired — 409 otherwise.
  secondaryActions: [
    { label: 'Download Asset Card', icon: 'download', endpoint: (id) => `/assets/${id}/pdf`, screenAction: 'view', download: true },
    {
      label: 'Mark Retired/Disposed',
      endpoint: (id) => `/assets/${id}/retire?reason=${encodeURIComponent(window.prompt('Reason for retiring this asset (required):', '') ?? '')}`,
      screenAction: 'edit',
      visible: (row) => row.status !== 'RETIRED_DISPOSED',
    },
  ],
  tabs: [
    {
      id: 'details',
      label: 'Details',
      // §2's own 3-section Details tab layout, ported 1:1 from the prototype
      // (app-screens2.js:246-269): Identity / Purchase & Depreciation /
      // Assignment & Status. Department (no prototype equivalent — the mock
      // Asset record never had one) is appended to the end of Identity
      // rather than dropped, since it's a real column on the backend Asset
      // model or the record wouldn't be able to show/edit it at all.
      sections: [
        {
          title: 'Identity',
          fields: [
            { key: 'asset_tag', label: 'Asset Tag', hint: 'Auto-generated from the Number Prefixes table' },
            { key: 'name', label: 'Name', editable: true, required: true },
            { key: 'category_id', label: 'Category', type: 'select', ref: CATEGORY_REF, editable: true },
            { key: 'serial_number', label: 'Serial Number', editable: true, hint: 'Unique if provided' },
            // §2.2/§6.1: general PUT strips this server-side — it only ever
            // changes via the Location & Department editor on the
            // Assignment History tab (gated on the 'assign' action, held by
            // Super Admin/HR, not Accountant who only holds 'edit') — so
            // this is never `editable` here even though Vendor right below
            // it, in the same prototype section, is.
            { key: 'location_address_id', label: 'Location', ref: LOCATION_REF, hint: 'Sourced from Company Profile → Addresses. Changed only via the Assignment History tab.' },
            { key: 'vendor_id', label: 'Vendor', type: 'select', ref: VENDOR_REF, editable: true },
            { key: 'department_id', label: 'Department', ref: DEPARTMENT_REF, hint: 'Changed only via the Assignment History tab.' },
          ],
        },
        {
          title: 'Purchase & Depreciation',
          fields: [
            { key: 'order_date', label: 'Order Date', type: 'date', editable: true, hint: 'Must be on or before Purchase Date' },
            { key: 'purchase_date', label: 'Purchase Date', type: 'date', editable: true, required: true },
            { key: 'warranty_expiry', label: 'Warranty Expiry', type: 'date', editable: true },
            { key: 'purchase_value', label: 'Purchase Value', type: 'number', editable: true, hint: 'Depreciation cannot be calculated without it' },
            { key: 'useful_life_years', label: 'Useful Life (Years)', type: 'number', editable: true, hint: 'Required if Purchase Value is filled in' },
            // A DB CHECK accepts only 'STRAIGHT_LINE' today, but the field
            // itself is a real, writable AssetWrite key (update_asset() sets
            // it on every PUT) — a real one-option select, matching the
            // prototype's own "mandatory, one option today" field exactly,
            // rather than downgrading it to a plain read-only display.
            {
              key: 'depreciation_method',
              label: 'Depreciation Method',
              type: 'select',
              editable: true,
              required: true,
              staticOptions: [{ value: 'STRAIGHT_LINE', label: 'Straight Line' }],
              hint: 'Mandatory. Straight Line is the only option today — built so more methods can be added later without a rebuild.',
            },
          ],
        },
        {
          title: 'Assignment & Status',
          fields: [
            {
              key: 'status',
              label: 'Status',
              type: 'status',
              staticOptions: ASSET_STATUS_OPTIONS,
              compute: (row) => humanizeEnum(row.status),
              hint: 'Changes only through Assign / Transfer / Unassign, so Assignment History stays complete',
            },
            { key: 'assigned_to', label: 'Assigned To', ref: EMPLOYEE_REF, hint: 'Changed only via Assign / Transfer / Unassign on the Assignment History tab' },
            { key: 'retired_date', label: 'Retired Date', type: 'date' },
            { key: 'retirement_reason', label: 'Retirement Reason' },
            { key: 'notes', label: 'Notes', type: 'textarea', editable: true, span: 2 },
          ],
        },
      ],
    },
    // §2 Tab: Assignment History — Assign/Transfer/Unassign + Location &
    // Department editor + the read-only history table; see
    // asset.assignment-history.component.ts's own doc comment.
    { kind: 'component', id: 'assignment_history', label: 'Assignment History', component: AssetAssignmentHistoryComponent, idInputName: 'assetId' },
    // §2 Tab: Maintenance & Service Log — per-asset log + "+ Add Maintenance
    // Entry"; gated on asset.maintenance, not asset.directory (cross-module
    // tab, same pattern as Employee record's Documents tab reusing
    // employee.documents) — see asset.maintenance-log.component.ts's own doc.
    { kind: 'component', id: 'maintenance', label: 'Maintenance & Service Log', component: AssetMaintenanceLogComponent, idInputName: 'assetId' },
    // §2.2's Attachments field (Core Info group, §6.1) — closes the
    // disclosed "linking endpoint deferred" gap; see
    // asset.attachments.component.ts's own doc comment.
    { kind: 'component', id: 'attachments', label: 'Attachments', component: AssetAttachmentsComponent, idInputName: 'assetId' },
    // §2 Tab: Depreciation — plain read-only re-display of fields already on
    // the same AssetOut the Details tab already loaded (asset_engine.py
    // computes current_value live on every read, never stored) — no extra
    // fetch, matching TabFieldsDef's own reasoning for this exact situation
    // on the 'tabbed' shape.
    {
      id: 'depreciation',
      label: 'Depreciation',
      sections: [
        {
          title: 'Depreciation',
          fields: [
            { key: 'purchase_value', label: 'Purchase Value', compute: (row) => (row.purchase_value ? formatMoney(row.purchase_value) : null) },
            { key: 'useful_life_years', label: 'Useful Life (Years)' },
            { key: 'depreciation_method', label: 'Depreciation Method', compute: (row) => humanizeEnum(row.depreciation_method) },
            { key: 'current_value', label: 'Current Value', compute: currentValueDisplay },
            // AssetOut.value_as_of_fy_label — a real response field the
            // prototype's own "As of" shows as 'FY 2026–27' (app-screens2.js
            // :1171), but _load_asset_out (assets.py) never actually sets it,
            // so this reads as '—' on every asset today. Left wired rather
            // than dropped: the moment that backend gap closes this starts
            // showing real data with no frontend change needed. Hint carries
            // the prototype's own explanatory rbac-note text (app-screens2.js
            // :1173) since this shape has no separate free-text note slot.
            {
              key: 'value_as_of_fy_label',
              label: 'As of',
              hint: 'Recalculated automatically at the start of each financial year. Current Value = Purchase Value − (Purchase Value ÷ Useful Life × Years Since Purchase); never drops below ₹0. Shows "Not available" when Purchase Value or Useful Life is missing.',
            },
          ],
        },
      ],
    },
  ],
};

export default config;
