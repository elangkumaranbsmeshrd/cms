import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { AssetRow } from '../asset.api';

const CATEGORY_REF = { endpoint: '/masters/asset-categories/options', labelKey: 'label' };
const VENDOR_REF = { endpoint: '/vendors/options', labelKey: 'label' };
const LOCATION_REF = { endpoint: '/masters/company-profile/addresses/options', labelKey: 'label' };
const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };
const EMPLOYEE_REF = { endpoint: '/employees/options', labelKey: 'label' };

// §0.8/§2 — "+ Add Asset" create flow. record-screen.component.ts has no
// create branch anywhere in this codebase (confirmed: every 'record'-shape
// screen hard-requires an :id route param), so this is a SEPARATE, create-
// only 'form'-shape config sharing the same RBAC id ('asset.directory') as
// asset.record.config.ts, at the sibling route assets/new — no updateEndpoint
// at all, so per form-screen.component.ts's own "no :id param = create mode"
// rule this can never become an edit form even if somehow reached with an id.
//
// Fields are AssetWrite's real keys only (backend/app/schemas/asset.py) —
// asset_tag/status are server-generated and not part of AssetWrite at all
// (nothing to submit, they don't exist until the POST responds), and
// depreciation_method has no input here at all: "STRAIGHT_LINE" is the only
// value a DB CHECK constraint accepts today, so this is silently defaulted
// via emptyRow() below rather than offering a single-option picker.
const config: FormScreenConfig<AssetRow> = {
  shape: 'form',
  id: 'asset.directory',
  title: 'Asset',
  // Never actually read: this route carries no :id param, so
  // form-screen.component.ts's constructor takes its "no id -> create mode"
  // branch and never touches listEndpoint/rowId. Still required by the type.
  listEndpoint: '/assets',
  rowId: (row) => row.id,
  createEndpoint: '/assets',
  // Deliberately no updateEndpoint — permanently create-only.
  emptyRow: () => ({
    name: '',
    // category_id is non-nullable on AssetRow (a saved asset always has one)
    // — '' rather than null, exactly matching company-addresses.form.config
    // .ts's own state_id precedent for a REQUIRED select field on a
    // non-nullable Row type. The required-field pre-check in save() (an
    // empty string counts as missing) catches an unpicked category before
    // this ever reaches the API.
    category_id: '',
    serial_number: null,
    order_date: null,
    purchase_date: '',
    purchase_value: null,
    useful_life_years: null,
    vendor_id: null,
    warranty_expiry: null,
    location_address_id: null,
    department_id: null,
    depreciation_method: 'STRAIGHT_LINE',
    notes: null,
    assigned_to: null,
  }),
  fields: [
    { key: 'name', label: 'Name', required: true, hint: '2–100 characters.' },
    { key: 'category_id', label: 'Category', type: 'select', ref: CATEGORY_REF, required: true },
    { key: 'serial_number', label: 'Serial Number', hint: 'Must be unique across all assets, if given.' },
    { key: 'purchase_date', label: 'Purchase Date', type: 'date', required: true, hint: 'Cannot be in the future.' },
    { key: 'order_date', label: 'Order Date', type: 'date', hint: 'Must be on or before Purchase Date.' },
    { key: 'purchase_value', label: 'Purchase Value', type: 'number', hint: 'Must be a positive number. Requires Useful Life below to be set too.' },
    { key: 'useful_life_years', label: 'Useful Life (Years)', type: 'number', hint: 'Required if Purchase Value is given.' },
    { key: 'vendor_id', label: 'Vendor', type: 'select', ref: VENDOR_REF },
    { key: 'warranty_expiry', label: 'Warranty Expiry', type: 'date', hint: 'Must be strictly after Purchase Date.' },
    // §0.8: Location/Department/Assigned To are settable at creation only —
    // the general PUT strips all three server-side, so the edit-mode record
    // (asset.record.config.ts) shows them read-only with a note to use the
    // Assignment & Location tab instead. This is the ONE place they're ever
    // real inputs.
    { key: 'location_address_id', label: 'Location', type: 'select', ref: LOCATION_REF },
    { key: 'department_id', label: 'Department', type: 'select', ref: DEPARTMENT_REF },
    {
      key: 'assigned_to',
      label: 'Assigned To (Employee)',
      type: 'select',
      ref: EMPLOYEE_REF,
      hint: 'Assigning an employee here immediately sets Status to In Use; leave blank to create it In Store.',
    },
    { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
  ],
  listRoute: ['/assets'],
  // §2.8: opens the new asset's own Master Record afterwards rather than
  // just returning to the Directory list — screen.types.ts's own doc on why
  // FormScreenConfig needed a new onCreateSuccess hook for this.
  onCreateSuccess: (response) => ['/assets', response.id],
};

export default config;
