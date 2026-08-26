import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { EmploymentTypeRow } from '../masters.api';

// The prototype's 'm.employmenttype' form is Employment Type Name, Code and
// a Status toggle. §3b built Status as `createOnly` — settable only when
// adding a new type (masters_lookup.py's create_only_fields). Once a row
// exists, Status only moves through the list screen's Super-Admin-only
// Deactivate/Activate row actions (§4a).
const config: FormScreenConfig<EmploymentTypeRow> = {
  shape: 'form',
  id: 'masters.employment_types',
  title: 'Employment Type',
  listEndpoint: '/masters/employment-types',
  createEndpoint: '/masters/employment-types',
  updateEndpoint: (id) => `/masters/employment-types/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/employment-types'],
  emptyRow: () => ({ name: '', code: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Employment Type Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Full Time, Part Time, Contract, Intern',
      // employment_types.name is unique in the schema; a clash comes back from
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
      hint: "Defaults to Active. Uncheck to create this type already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
