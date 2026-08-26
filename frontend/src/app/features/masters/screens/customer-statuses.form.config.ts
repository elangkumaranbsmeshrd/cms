import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { CustomerStatusRow } from '../masters.api';

// The prototype's 'm.customerstatus' form is Status Name, Code, and this
// row's own Active/Inactive flag (§3b, `createOnly` — settable only when
// adding a new status value, masters_lookup.py's create_only_fields). Once a
// row exists, that flag only moves through the list screen's Super-Admin-only
// Deactivate/Activate row actions (§4a). Two different meanings of "status"
// on this one screen: the Status Name field holds a customer lifecycle state
// ("Prospect", "Active", "Churned"); the Status field below is this row's own
// meta-flag governing whether that value is selectable at all.
const config: FormScreenConfig<CustomerStatusRow> = {
  shape: 'form',
  id: 'masters.customer_statuses',
  title: 'Customer Status',
  listEndpoint: '/masters/customer-statuses',
  createEndpoint: '/masters/customer-statuses',
  updateEndpoint: (id) => `/masters/customer-statuses/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/customer-statuses'],
  emptyRow: () => ({ name: '', code: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Status Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Prospect, Active, Inactive',
      // customer_statuses.name is unique in the schema; a clash comes back from
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
      hint: "Governs whether this status value can be selected on new/edited customers — a different flag from the Status Name above. Defaults to Active. Uncheck to create it already inactive. Once created, only this screen's own Deactivate/Activate actions move it, Super Admin only.",
    },
  ],
};

export default config;
