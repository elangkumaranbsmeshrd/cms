import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { UnitOfMeasureRow } from '../masters.api';

// The prototype's 'm.uom' form is Unit Name, Code and a Status toggle. §3b
// built Status as `createOnly` — settable only when adding a new unit
// (masters_lookup.py's create_only_fields). Once a row exists, Status only
// moves through the list screen's Super-Admin-only Deactivate/Activate row
// actions (§4a).
const config: FormScreenConfig<UnitOfMeasureRow> = {
  shape: 'form',
  id: 'masters.units_of_measure',
  title: 'Unit of Measure',
  listEndpoint: '/masters/units-of-measure',
  createEndpoint: '/masters/units-of-measure',
  updateEndpoint: (id) => `/masters/units-of-measure/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/units-of-measure'],
  emptyRow: () => ({ name: '', code: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Unit Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Hours, Days, Fixed / Lump Sum, License, Unit',
      // units_of_measure.name carries a unique constraint; a clash comes back
      // from the API as a 409, not from a check here.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique in the schema.
      key: 'code',
      label: 'Code',
      placeholder: 'e.g. HRS, DAY, LIC',
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
      hint: "Defaults to Active. Uncheck to create this unit already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
