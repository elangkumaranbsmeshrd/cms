import { FormScreenConfig } from '../../../shared/screens/screen.types';
import { DesignationRow } from '../masters.api';

const DEPARTMENT_REF = { endpoint: '/masters/departments/options', labelKey: 'label' };

// §3.10's Fields Table has a fourth field, "Status (Active/Inactive)"
// (app-forms.js 'm.designation'). §3b built it as `createOnly` — settable
// only when adding a new designation (masters_lookup.py's
// create_only_fields). Once a row exists, Status only moves through the
// list screen's Super-Admin-only Deactivate/Activate row actions (§4a).
const config: FormScreenConfig<DesignationRow> = {
  shape: 'form',
  id: 'masters.designations',
  title: 'Designation / Job Title',
  listEndpoint: '/masters/designations',
  createEndpoint: '/masters/designations',
  updateEndpoint: (id) => `/masters/designations/${id}`,
  rowId: (row) => row.id,
  listRoute: ['/masters/designations'],
  emptyRow: () => ({ name: '', code: null, department_id: null, level_grade: null, is_active: true }),
  fields: [
    {
      key: 'name',
      label: 'Designation Name',
      required: true,
      span: 2,
      placeholder: 'e.g. Software Engineer, UI/UX Designer, Project Manager, HR Executive',
      // §3.10 asks for uniqueness, and the schema now enforces it —
      // ux_designations_name, added by migration 0011 alongside the `code`
      // column. (The note that used to sit here said the opposite; it predated
      // that migration.) A clash comes back as a 409 the form banner shows, so
      // the hint warns first.
      hint: 'Must be unique',
    },
    {
      // §3a — real column now (migration 0011), unique in the schema.
      key: 'code',
      label: 'Code',
      placeholder: 'e.g. SE, UX, PM',
      hint: 'Optional short code, shown on the list and usable in exports. Must be unique if set.',
    },
    {
      key: 'department_id',
      label: 'Linked Department',
      type: 'select',
      ref: DEPARTMENT_REF,
      hint: 'From Masters → Department. Optional, since some titles span more than one department',
    },
    {
      key: 'level_grade',
      label: 'Level / Grade',
      placeholder: 'e.g. Junior, Senior, Lead',
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
      hint: "Defaults to Active. Uncheck to create this designation already inactive. Once created, Status only moves through this screen's own Deactivate/Activate actions, Super Admin only.",
    },
  ],
};

export default config;
