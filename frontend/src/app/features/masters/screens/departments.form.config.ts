import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { DepartmentRow } from '../masters.api';

// §3.9's Fields Table has a fourth field, "Status (Active/Inactive)"
// (app-forms.js 'm.department'). §3b built it as `createOnly` — settable
// only when adding a new department (masters_lookup.py's
// create_only_fields). Once a row exists, Status only moves through the
// list screen's Super-Admin-only Deactivate/Activate row actions (§4a).
const config: FormScreenConfig<DepartmentRow> = {
  shape: 'form',
  id: 'masters.departments',
  title: 'Department',
  listEndpoint: '/masters/departments',
  createEndpoint: '/masters/departments',
  updateEndpoint: (id) => `/masters/departments/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/departments'],
  emptyRow: () => ({ name: '', code: null, description: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Department Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Engineering, Design, Sales, HR, Finance, Operations',
      // departments.name is UNIQUE in the schema; a clash comes back as a 409
      // ("Duplicate name or invalid reference"), so the hint warns first.
      hint: 'Must be unique',
    },
    {
      key: 'code',
      label: 'Department Code',
      placeholder: 'e.g. ENG',
      // ux_departments_code is UNIQUE in the schema, exactly like the sibling
      // lookups' own Code fields — the hint said only "Short code", so a
      // clashing code came back as a bare 409 the user had no warning about.
      hint: 'Short code. Must be unique if set.',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
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
      hint: "Defaults to Active. Uncheck to create this department already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
