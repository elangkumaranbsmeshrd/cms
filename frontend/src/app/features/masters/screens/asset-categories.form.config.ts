import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { AssetCategoryRow } from '../masters.api';

// Labels, required markers, placeholders and hints are the prototype's own
// (app-forms.js 'm.assetcategories'). Status toggle is §3b's `createOnly`
// field now — settable only when adding a new category (masters_lookup.py's
// create_only_fields). Once a row exists, Status only moves through the list
// screen's Super-Admin-only Deactivate/Activate row actions (§4a).
//
// "Default Useful Life (Years)" is real now (§3a, migration 0011) — the
// prototype's own hint on this field is kept verbatim below.
const config: FormScreenConfig<AssetCategoryRow> = {
  shape: 'form',
  id: 'masters.asset_categories',
  title: 'Asset Category',
  listEndpoint: '/masters/asset-categories',
  createEndpoint: '/masters/asset-categories',
  updateEndpoint: (id) => `/masters/asset-categories/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/asset-categories'],
  emptyRow: () => ({ name: '', code: null, description: null, default_useful_life_years: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Category Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Laptop, Monitor, Furniture, ID Card, Vehicle',
      // asset_categories.name is unique in the schema; a clash comes back from
      // the API as a 409 rather than being caught here.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique in the schema.
      key: 'code',
      label: 'Code',
      hint: 'Optional short code, shown on the list and usable in exports. Must be unique if set.',
    },
    { key: 'description', label: 'Description', type: 'textarea' },
    {
      key: 'default_useful_life_years',
      label: 'Default Useful Life (Years)',
      type: 'number',
      placeholder: '3',
      // The prototype's own hint (app-forms.js:277), kept verbatim.
      hint: 'Not a Masters §3.17 spec field — carried over from the existing prototype, where it feeds the Straight Line depreciation calculation on each asset record. Retained so a wholesale replace loses nothing',
    },
    {
      key: 'is_active',
      label: 'Status',
      type: 'checkbox',
      createOnly: true,
      staticOptions: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
      hint: "Defaults to Active. Uncheck to create this category already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
