import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { ServiceCategoryRow } from '../masters.api';

// Labels, required markers, placeholders and hints are the prototype's own
// (app-forms.js 'm.servicecategory'). Its fourth control, Status, is §3b's
// `createOnly` field — settable only when adding a new category
// (masters_lookup.py's create_only_fields). Once a row exists, Status only
// moves through this screen's own Deactivate/Activate row actions (§4a).
const config: FormScreenConfig<ServiceCategoryRow> = {
  shape: 'form',
  id: 'masters.service_categories',
  title: 'Service Category',
  listEndpoint: '/masters/service-categories',
  createEndpoint: '/masters/service-categories',
  updateEndpoint: (id) => `/masters/service-categories/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/service-categories'],
  emptyRow: () => ({ name: '', code: null, description: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Service Category Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Product Development, Cloud Computing, Internet of Things',
      // The uniqueness is a real DB constraint (service_categories.name is
      // unique), surfaced by the API as a 409 rather than enforced here.
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
