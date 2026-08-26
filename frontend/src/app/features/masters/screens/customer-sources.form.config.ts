import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { CustomerSourceRow } from '../masters.api';

// The prototype's 'm.customersource' form is Source Name, Code and a Status
// toggle. §3b built Status as `createOnly` — settable only when adding a new
// source (masters_lookup.py's create_only_fields), which the prototype's own
// hint on that toggle already describes as "Super Admin only, as on every
// sub-master" — matching how it moves afterward too, via the list screen's
// Deactivate/Activate row actions (§4a).
const config: FormScreenConfig<CustomerSourceRow> = {
  shape: 'form',
  id: 'masters.customer_sources',
  title: 'Customer Source',
  listEndpoint: '/masters/customer-sources',
  createEndpoint: '/masters/customer-sources',
  updateEndpoint: (id) => `/masters/customer-sources/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/customer-sources'],
  emptyRow: () => ({ name: '', code: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Source Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Referral, Website, Cold Outreach',
      // customer_sources.name is unique in the schema; a clash comes back from
      // the API as a 409 rather than being caught here.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique in the schema.
      key: 'code',
      label: 'Code',
      hint: 'Optional short code, shown on the list and usable in exports. Must be unique if set.',
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
      hint: "Defaults to Active. Uncheck to create this source already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
